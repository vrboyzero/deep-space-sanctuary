import { describe, expect, it, vi } from "vitest";

import {
  BackgroundRunCoordinator,
  type BackgroundRunClaimResult,
} from "./background-run-coordinator.js";
import { evaluateBackgroundRunBusy } from "./background-run-busy-policy.js";
import { DreamAutomationRuntime } from "./dream-automation-runtime.js";
import type { MemoryBackgroundJobClaim } from "./memory-background-job-scheduler.js";

function requireClaim(result: BackgroundRunClaimResult) {
  if ("reason" in result) {
    throw new Error(`Expected claim to be accepted: ${result.reason}`);
  }
  return result;
}

describe("dream automation runtime", () => {
  it("uses the Memory scheduler and forwards its claim signal into auto Dream", async () => {
    const controller = new AbortController();
    const complete = vi.fn();
    const claim: MemoryBackgroundJobClaim = {
      generation: 1,
      signal: controller.signal,
      complete: async <T>(commit: () => T | Promise<T>) => {
        complete();
        return { applied: true, value: await commit() };
      },
      release: vi.fn(async () => undefined),
    };
    const jobScheduler = {
      acquire: vi.fn(async () => claim),
    };
    const dreamRuntime = {
      getState: vi.fn(async () => ({ lastDreamAt: null })),
      maybeAutoRun: vi.fn(async () => ({
        executed: true,
        triggerMode: "heartbeat",
        state: { status: "idle" },
        record: { id: "dream-scheduled" },
      })),
      getBackgroundJobTokenEstimate: vi.fn(() => 1_200),
    };
    const runtime = new DreamAutomationRuntime({
      heartbeatEnabled: true,
      cronEnabled: true,
      agentIds: ["default"],
      resolveDreamRuntime: () => dreamRuntime as any,
      resolveDefaultConversationId: () => "agent:default:main",
      jobScheduler,
    });

    await expect(runtime.handleHeartbeatEvent({ status: "ran" })).resolves.toMatchObject({
      executed: true,
      runId: "dream-scheduled",
    });
    expect(jobScheduler.acquire).toHaveBeenCalledWith({
      family: "dream",
      agentId: "default",
      priority: "low",
      estimatedTokenUnits: 1_200,
      signal: expect.any(AbortSignal),
    });
    expect(dreamRuntime.maybeAutoRun).toHaveBeenCalledWith(expect.objectContaining({
      signal: controller.signal,
    }));
    expect(complete).toHaveBeenCalledTimes(1);
    await runtime.stopAndDrain();
  });

  it("runs automatic dream for the oldest eligible agent", async () => {
    const runtimes = new Map<string, any>([
      ["default", {
        getState: vi.fn(async () => ({
          lastDreamAt: "2026-04-19T12:00:00.000Z",
        })),
        maybeAutoRun: vi.fn(async () => ({
          executed: false,
          triggerMode: "heartbeat",
          state: { status: "idle" },
          skipCode: "cooldown_active",
          skipReason: "cooldown active",
        })),
      }],
      ["coder", {
        getState: vi.fn(async () => ({
          lastDreamAt: "2026-04-18T12:00:00.000Z",
        })),
        maybeAutoRun: vi.fn(async () => ({
          executed: true,
          triggerMode: "heartbeat",
          state: { status: "idle" },
          record: {
            id: "dream-1",
          },
        })),
      }],
    ]);

    const runtime = new DreamAutomationRuntime({
      heartbeatEnabled: true,
      cronEnabled: false,
      agentIds: ["default", "coder"],
      resolveDreamRuntime: (agentId) => runtimes.get(agentId ?? "default") ?? null,
      resolveDefaultConversationId: (agentId) => `agent:${agentId ?? "default"}:main`,
    });

    const result = await runtime.handleHeartbeatEvent({
      status: "ran",
      conversationId: "heartbeat-1",
    });

    expect(result).toMatchObject({
      source: "heartbeat",
      attempted: true,
      executed: true,
      agentId: "coder",
      runId: "dream-1",
    });
    expect(runtimes.get("coder").maybeAutoRun).toHaveBeenCalledWith(expect.objectContaining({
      triggerMode: "heartbeat",
      conversationId: "agent:coder:main",
    }));
  });

  it("skips automatic dream when cron driver is disabled", async () => {
    const runtime = new DreamAutomationRuntime({
      heartbeatEnabled: false,
      cronEnabled: false,
      agentIds: ["default"],
      resolveDreamRuntime: () => null,
      resolveDefaultConversationId: () => "agent:default:main",
    });

    const result = await runtime.handleCronEvent({
      status: "ok",
      sourceId: "job-1",
    });

    expect(result).toMatchObject({
      source: "cron",
      attempted: false,
      executed: false,
      skipCode: "driver_disabled",
    });
  });

  it("waits for shared capacity before starting an automatic dream", async () => {
    const coordinator = new BackgroundRunCoordinator({ maxConcurrentRuns: 1 });
    const blockingClaim = requireClaim(coordinator.tryClaim({ kind: "cron", key: "blocking" }));
    const dreamRuntime = {
      getState: vi.fn(async () => ({ lastDreamAt: null })),
      maybeAutoRun: vi.fn(async () => ({
        executed: true,
        triggerMode: "heartbeat",
        state: { status: "idle" },
        record: { id: "dream-queued" },
      })),
    };
    const runtime = new DreamAutomationRuntime({
      heartbeatEnabled: true,
      cronEnabled: true,
      agentIds: ["default"],
      resolveDreamRuntime: () => dreamRuntime as any,
      resolveDefaultConversationId: () => "agent:default:main",
      runCoordinator: coordinator,
    });

    const run = runtime.handleHeartbeatEvent({ status: "ran" });
    await vi.waitFor(() => {
      expect(coordinator.getRuntimeSnapshot().queuedByKind.dream).toBe(1);
    });
    expect(dreamRuntime.maybeAutoRun).not.toHaveBeenCalled();

    blockingClaim.release();
    await expect(run).resolves.toMatchObject({
      executed: true,
      runId: "dream-queued",
    });
    expect(dreamRuntime.maybeAutoRun).toHaveBeenCalledTimes(1);
  });

  it("cancels queued dream admission when the runtime stops", async () => {
    const coordinator = new BackgroundRunCoordinator({ maxConcurrentRuns: 1 });
    const blockingClaim = requireClaim(coordinator.tryClaim({ kind: "heartbeat", key: "blocking" }));
    const dreamRuntime = {
      getState: vi.fn(async () => ({ lastDreamAt: null })),
      maybeAutoRun: vi.fn(async () => ({
        executed: true,
        triggerMode: "cron",
        state: { status: "idle" },
        record: { id: "dream-stopped" },
      })),
    };
    const runtime = new DreamAutomationRuntime({
      heartbeatEnabled: true,
      cronEnabled: true,
      agentIds: ["default"],
      resolveDreamRuntime: () => dreamRuntime as any,
      resolveDefaultConversationId: () => "agent:default:main",
      runCoordinator: coordinator,
    });

    const run = runtime.handleCronEvent({ status: "ok" });
    await vi.waitFor(() => {
      expect(coordinator.getRuntimeSnapshot().queuedByKind.dream).toBe(1);
    });

    runtime.stop();
    await expect(run).resolves.toMatchObject({
      source: "cron",
      executed: false,
      skipCode: "runtime_stopped",
    });
    await expect(runtime.stopAndDrain()).resolves.toBeUndefined();

    expect(dreamRuntime.maybeAutoRun).not.toHaveBeenCalled();
    expect(coordinator.getRuntimeSnapshot().queuedByKind.dream).toBe(0);
    blockingClaim.release();
  });

  it("drains an accepted dream without publishing its late success after stop", async () => {
    const coordinator = new BackgroundRunCoordinator({ maxConcurrentRuns: 1 });
    const debug = vi.fn();
    let finishDream!: () => void;
    const dreamGate = new Promise<void>((resolve) => {
      finishDream = resolve;
    });
    const dreamRuntime = {
      getState: vi.fn(async () => ({ lastDreamAt: null })),
      maybeAutoRun: vi.fn(async () => {
        await dreamGate;
        return {
          executed: true,
          triggerMode: "heartbeat",
          state: { status: "idle" },
          record: { id: "dream-late" },
        };
      }),
    };
    const runtime = new DreamAutomationRuntime({
      heartbeatEnabled: true,
      cronEnabled: true,
      agentIds: ["default"],
      resolveDreamRuntime: () => dreamRuntime as any,
      resolveDefaultConversationId: () => "agent:default:main",
      runCoordinator: coordinator,
      logger: { debug },
    });

    const run = runtime.handleHeartbeatEvent({ status: "ran" });
    await vi.waitFor(() => {
      expect(dreamRuntime.maybeAutoRun).toHaveBeenCalledTimes(1);
    });
    let drained = false;
    const drain = runtime.stopAndDrain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    finishDream();
    await expect(run).resolves.toMatchObject({
      executed: false,
      skipCode: "runtime_stopped",
    });
    await drain;

    expect(debug).not.toHaveBeenCalledWith(
      "dream automation executed",
      expect.anything(),
    );
    expect(coordinator.getRuntimeSnapshot().activeByKind.dream).toBe(0);
  });

  it("coordinates concurrent heartbeat and cron triggers per agent", async () => {
    const coordinator = new BackgroundRunCoordinator({ maxConcurrentRuns: 2 });
    let finishDefaultDream!: () => void;
    const defaultGate = new Promise<void>((resolve) => {
      finishDefaultDream = resolve;
    });
    const runtimes = new Map<string, any>([
      ["default", {
        getState: vi.fn(async () => ({ lastDreamAt: "2026-07-18T00:00:00.000Z" })),
        maybeAutoRun: vi.fn(async () => {
          await defaultGate;
          return {
            executed: true,
            triggerMode: "heartbeat",
            state: { status: "idle" },
            record: { id: "dream-default" },
          };
        }),
      }],
      ["coder", {
        getState: vi.fn(async () => ({ lastDreamAt: "2026-07-19T00:00:00.000Z" })),
        maybeAutoRun: vi.fn(async () => ({
          executed: true,
          triggerMode: "cron",
          state: { status: "idle" },
          record: { id: "dream-coder" },
        })),
      }],
    ]);
    const runtime = new DreamAutomationRuntime({
      heartbeatEnabled: true,
      cronEnabled: true,
      agentIds: ["default", "coder"],
      resolveDreamRuntime: (agentId) => runtimes.get(agentId ?? "default") ?? null,
      resolveDefaultConversationId: (agentId) => `agent:${agentId ?? "default"}:main`,
      runCoordinator: coordinator,
    });

    const heartbeatRun = runtime.handleHeartbeatEvent({ status: "ran" });
    await vi.waitFor(() => {
      expect(runtimes.get("default").maybeAutoRun).toHaveBeenCalledTimes(1);
    });
    const cronRun = runtime.handleCronEvent({ status: "ok" });
    await vi.waitFor(() => {
      expect(coordinator.getRuntimeSnapshot().queuedByKind.dream).toBe(1);
    });

    finishDefaultDream();
    await expect(heartbeatRun).resolves.toMatchObject({
      source: "heartbeat",
      agentId: "default",
      runId: "dream-default",
    });
    await expect(cronRun).resolves.toMatchObject({
      source: "cron",
      agentId: "coder",
      runId: "dream-coder",
    });
    expect(runtimes.get("coder").maybeAutoRun).toHaveBeenCalledTimes(1);

    runtime.stop();
    await runtime.stopAndDrain();
  });

  it("excludes its admitted claim when evaluating gateway busy state", async () => {
    const coordinator = new BackgroundRunCoordinator({ maxConcurrentRuns: 1 });
    const isBusy = vi.fn((context) => evaluateBackgroundRunBusy(
      coordinator.getRuntimeSnapshot(),
      context,
    ).busy);
    const dreamRuntime = {
      getState: vi.fn(async () => ({ lastDreamAt: null })),
      maybeAutoRun: vi.fn(async () => ({
        executed: true,
        triggerMode: "heartbeat",
        state: { status: "idle" },
        record: { id: "dream-self-claim" },
      })),
    };
    const runtime = new DreamAutomationRuntime({
      heartbeatEnabled: true,
      cronEnabled: true,
      agentIds: ["default"],
      resolveDreamRuntime: () => dreamRuntime as any,
      resolveDefaultConversationId: () => "agent:default:main",
      runCoordinator: coordinator,
      isBusy,
    });

    await expect(runtime.handleHeartbeatEvent({ status: "ran" })).resolves.toMatchObject({
      executed: true,
      runId: "dream-self-claim",
    });
    expect(isBusy).toHaveBeenCalledWith(expect.objectContaining({ ownClaimKind: "dream" }));

    runtime.stop();
    await runtime.stopAndDrain();
  });

  it("does not treat its finalized source claim as unrelated busy work", async () => {
    const coordinator = new BackgroundRunCoordinator({ maxConcurrentRuns: 2 });
    const sourceClaim = requireClaim(coordinator.tryClaim({ kind: "heartbeat", key: "source" }));
    const isBusy = vi.fn((context) => evaluateBackgroundRunBusy(
      coordinator.getRuntimeSnapshot(),
      context,
    ).busy);
    const dreamRuntime = {
      getState: vi.fn(async () => ({ lastDreamAt: null })),
      maybeAutoRun: vi.fn(async () => ({
        executed: true,
        triggerMode: "heartbeat",
        state: { status: "idle" },
        record: { id: "dream-from-heartbeat" },
      })),
    };
    const runtime = new DreamAutomationRuntime({
      heartbeatEnabled: true,
      cronEnabled: true,
      agentIds: ["default"],
      resolveDreamRuntime: () => dreamRuntime as any,
      resolveDefaultConversationId: () => "agent:default:main",
      runCoordinator: coordinator,
      isBusy,
    });

    await expect(runtime.handleHeartbeatEvent({ status: "ran" })).resolves.toMatchObject({
      executed: true,
      runId: "dream-from-heartbeat",
    });
    expect(isBusy).toHaveBeenCalledWith({
      ownClaimKind: "dream",
      relatedClaimKind: "heartbeat",
    });

    sourceClaim.release();
    runtime.stop();
    await runtime.stopAndDrain();
  });
});
