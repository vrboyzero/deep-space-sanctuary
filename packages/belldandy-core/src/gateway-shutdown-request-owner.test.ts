import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { GatewayShutdownRequest, GatewayShutdownResult } from "./gateway-shutdown-coordinator.js";
import { createGatewayShutdownRequestOwner } from "./gateway-shutdown-request-owner.js";

function createResult(kind: GatewayShutdownResult["request"]["kind"], exitCode: number): GatewayShutdownResult {
  return {
    generation: 1,
    request: { kind, exitCode },
    outcome: "completed",
    startedAtMs: 0,
    finishedAtMs: 1,
    durationMs: 1,
    completedStepCount: 1,
    skippedStepCount: 0,
    failures: [],
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Gateway shutdown request owner", () => {
  it("keeps the first system restart request through countdown and competing entries", async () => {
    vi.useFakeTimers();
    const broadcasts: unknown[] = [];
    const exit = vi.fn();
    const requestShutdown = vi.fn(async (request: GatewayShutdownRequest) => (
      createResult(request.kind, request.exitCode)
    ));
    const owner = createGatewayShutdownRequestOwner({
      requestShutdown,
      broadcast: (frame) => broadcasts.push(frame),
      exit,
    });

    const first = owner.requestSystemRestart("settings updated");
    const duplicate = owner.requestConfigRestart(".env.local");
    const signal = owner.requestSignal("SIGTERM");

    expect(duplicate).toBe(first);
    expect(signal).toBe(first);
    expect(requestShutdown).not.toHaveBeenCalled();
    expect(broadcasts).toEqual([{
      type: "event",
      event: "agent.status",
      payload: { status: "restarting", reason: "settings updated", countdown: 3 },
    }]);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(broadcasts).toHaveLength(4);
    expect(broadcasts[3]).toEqual({
      type: "event",
      event: "agent.status",
      payload: { status: "restarting", reason: "settings updated", countdown: 0 },
    });
    expect(requestShutdown).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300);
    await expect(first).resolves.toMatchObject({ request: { kind: "system_restart", exitCode: 100 } });
    expect(requestShutdown).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(100);
    expect(owner.getRuntimeSnapshot()).toMatchObject({
      state: "completed",
      requestKind: "system_restart",
      exitCode: 100,
      requestCount: 3,
      ignoredRequestCount: 2,
    });
  });

  it("runs config restart after one status broadcast and preserves exit code 100", async () => {
    vi.useFakeTimers();
    const broadcast = vi.fn();
    const exit = vi.fn();
    const requestShutdown = vi.fn(async () => createResult("config_restart", 100));
    const owner = createGatewayShutdownRequestOwner({ requestShutdown, broadcast, exit });

    const completion = owner.requestConfigRestart(".env.local");

    expect(broadcast).toHaveBeenCalledWith({
      type: "event",
      event: "agent.status",
      payload: { status: "restarting", reason: ".env.local changed" },
    });
    expect(requestShutdown).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    await completion;
    expect(requestShutdown).toHaveBeenCalledWith({ kind: "config_restart", exitCode: 100 });
    expect(exit).toHaveBeenCalledWith(100);
  });

  it("installs one signal pair, detaches it on first signal, and exits gracefully after shutdown", async () => {
    const signalTarget = new EventEmitter();
    const exit = vi.fn();
    const requestShutdown = vi.fn(async () => createResult("signal", 0));
    const owner = createGatewayShutdownRequestOwner({ requestShutdown, exit });

    owner.installSignalHandlers(signalTarget);
    owner.installSignalHandlers(signalTarget);
    expect(signalTarget.listenerCount("SIGINT")).toBe(1);
    expect(signalTarget.listenerCount("SIGTERM")).toBe(1);

    signalTarget.emit("SIGTERM");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));

    expect(requestShutdown).toHaveBeenCalledWith({ kind: "signal", exitCode: 0 });
    expect(signalTarget.listenerCount("SIGINT")).toBe(0);
    expect(signalTarget.listenerCount("SIGTERM")).toBe(0);
    signalTarget.emit("SIGINT");
    expect(requestShutdown).toHaveBeenCalledTimes(1);
  });
});
