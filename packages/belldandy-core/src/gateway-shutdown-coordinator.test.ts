import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GatewayShutdownCoordinator,
  type GatewayShutdownStepContext,
} from "./gateway-shutdown-coordinator.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("GatewayShutdownCoordinator", () => {
  it("runs registered resources in phase order and singleflights duplicate requests", async () => {
    const events: string[] = [];
    const coordinator = new GatewayShutdownCoordinator();

    coordinator.register({
      id: "transport",
      phase: "close_transport",
      run: () => {
        events.push("transport");
      },
    });
    coordinator.register({
      id: "intake",
      phase: "stop_intake",
      run: () => {
        events.push("intake");
      },
    });
    coordinator.register({
      id: "flush",
      phase: "flush_state",
      run: () => {
        events.push("flush");
      },
    });

    const first = coordinator.requestShutdown({ kind: "signal", exitCode: 0 });
    const duplicate = coordinator.requestShutdown({ kind: "config_restart", exitCode: 100 });

    expect(duplicate).toBe(first);
    await expect(first).resolves.toMatchObject({
      generation: 1,
      outcome: "completed",
      request: { kind: "signal", exitCode: 0 },
      completedStepCount: 3,
      skippedStepCount: 0,
      failures: [],
    });
    expect(coordinator.requestShutdown({ kind: "manual", exitCode: 1 })).toBe(first);
    expect(events).toEqual(["intake", "flush", "transport"]);
    expect(coordinator.getRuntimeSnapshot()).toEqual({
      state: "completed",
      generation: 1,
      registeredStepCount: 3,
      completedStepCount: 3,
      skippedStepCount: 0,
      failureCount: 0,
      currentPhase: null,
      currentStepId: null,
      requestKind: "signal",
    });
  });

  it("continues after throw and timeout, aborts the timed-out step, and ignores late settlement", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    let timedOutContext: GatewayShutdownStepContext | undefined;
    let settleLateStep: (() => void) | undefined;
    const coordinator = new GatewayShutdownCoordinator({
      defaultStepTimeoutMs: 25,
      globalTimeoutMs: 200,
    });

    coordinator.register({
      id: "throws",
      phase: "abort_active",
      run: () => {
        events.push("throws");
        throw new Error("private runtime detail");
      },
    });
    coordinator.register({
      id: "hangs",
      phase: "drain",
      run: (context) => {
        events.push("hangs");
        timedOutContext = context;
        return new Promise<void>((resolve) => {
          settleLateStep = resolve;
        });
      },
    });
    coordinator.register({
      id: "transport",
      phase: "close_transport",
      run: () => {
        events.push("transport");
      },
    });

    const shutdown = coordinator.requestShutdown({ kind: "manual", exitCode: 0 });
    await vi.advanceTimersByTimeAsync(25);

    const result = await shutdown;
    expect(timedOutContext?.signal.aborted).toBe(true);
    expect(events).toEqual(["throws", "hangs", "transport"]);
    expect(result).toMatchObject({
      outcome: "completed_with_failures",
      completedStepCount: 1,
      skippedStepCount: 0,
      failures: [
        { stepId: "throws", phase: "abort_active", kind: "step_error" },
        { stepId: "hangs", phase: "drain", kind: "step_timeout" },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("private runtime detail");

    settleLateStep?.();
    await Promise.resolve();
    expect(coordinator.getRuntimeSnapshot()).toMatchObject({
      state: "completed",
      completedStepCount: 1,
      failureCount: 2,
    });
  });

  it("does not start remaining resources after the global deadline is exhausted", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const coordinator = new GatewayShutdownCoordinator({
      defaultStepTimeoutMs: 100,
      globalTimeoutMs: 30,
    });

    coordinator.register({
      id: "global-hang",
      phase: "stop_intake",
      run: ({ signal }) => {
        events.push("global-hang");
        return new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    });
    coordinator.register({
      id: "must-not-start",
      phase: "close_transport",
      run: () => {
        events.push("must-not-start");
      },
    });

    const shutdown = coordinator.requestShutdown({ kind: "signal", exitCode: 0 });
    await vi.advanceTimersByTimeAsync(30);

    await expect(shutdown).resolves.toMatchObject({
      outcome: "global_timeout",
      completedStepCount: 0,
      skippedStepCount: 1,
      failures: [
        { stepId: "global-hang", phase: "stop_intake", kind: "global_timeout" },
      ],
    });
    expect(events).toEqual(["global-hang"]);
  });
});
