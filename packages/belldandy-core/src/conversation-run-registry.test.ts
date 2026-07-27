import { describe, expect, it, vi } from "vitest";

import { ConversationRunRegistry } from "./conversation-run-registry.js";
import { ConversationSteerMailbox } from "./coding-run/conversation-steer-mailbox.js";

describe("ConversationRunRegistry runtime snapshot", () => {
  it("persists a recovery marker before exposing a durable run and settles it explicitly", async () => {
    const recoveryStore = {
      markActive: vi.fn(async () => undefined),
      markSettled: vi.fn(async () => true),
      lookup: vi.fn(async () => ({ state: "lost" as const, marker: {
        source: "conversation" as const,
        binding: { conversationId: "conversation-a", agentRunId: "run-a" },
        state: "active" as const,
        ownerInstanceId: "old",
        ownerProcessId: 1,
        startedAtMs: 1,
        updatedAtMs: 2,
      } })),
    };
    const registry = new ConversationRunRegistry({ recoveryStore });
    await registry.registerDurable({
      conversationId: "conversation-a",
      runId: "run-a",
      startedAt: 1,
      state: "running",
      stop: vi.fn(() => true),
    });

    expect(recoveryStore.markActive).toHaveBeenCalledWith({
      source: "conversation",
      binding: { conversationId: "conversation-a", agentRunId: "run-a" },
      startedAtMs: 1,
    });
    expect(registry.getRun("conversation-a", "run-a")).toBeDefined();
    await expect(registry.getRecoveryStatus("conversation-a", "run-a")).resolves.toMatchObject({ state: "lost" });
    await expect(registry.settleRecoveryMarker("conversation-a", "run-a")).resolves.toBe(true);
    expect(recoveryStore.markSettled).toHaveBeenCalledWith({
      source: "conversation",
      binding: { conversationId: "conversation-a", agentRunId: "run-a" },
    });
  });

  it("does not expose a durable run when its recovery marker cannot be written", async () => {
    const registry = new ConversationRunRegistry({
      recoveryStore: {
        markActive: vi.fn(async () => { throw new Error("marker unavailable"); }),
        markSettled: vi.fn(async () => false),
        lookup: vi.fn(async () => ({ state: "not_found" as const })),
      },
    });

    await expect(registry.registerDurable({
      conversationId: "conversation-a",
      runId: "run-a",
      startedAt: 1,
      state: "running",
      stop: vi.fn(() => true),
    })).rejects.toThrow("marker unavailable");
    expect(registry.getRun("conversation-a", "run-a")).toBeUndefined();
  });

  it("accepts follow-up only for the sole exact run and reserves serial handoff", async () => {
    const registry = new ConversationRunRegistry();
    registry.register({
      conversationId: "conversation-a",
      runId: "run-a",
      startedAt: 1,
      state: "running",
      stop: vi.fn(() => true),
    });
    const accepted = registry.enqueueFollowUp({
      binding: { conversationId: "conversation-a", agentRunId: "run-a" },
      prompt: "continue",
      idempotencyKey: "follow-up-request",
    });
    expect(accepted).toMatchObject({ ok: true, replayed: false, item: { status: "queued" } });
    if (!accepted.ok) throw new Error("expected follow-up acceptance");

    registry.clear("conversation-a", "run-a");
    const claim = registry.claimNextFollowUp({ conversationId: "conversation-a", agentRunId: "run-a" });
    expect(claim).toMatchObject({ commandId: accepted.item.commandId, prompt: "continue" });
    expect(registry.isConversationStartAllowed("conversation-a")).toBe(false);
    expect(registry.isConversationStartAllowed("conversation-a", accepted.item.commandId)).toBe(true);
    expect(() => registry.register({
      conversationId: "conversation-a",
      runId: "external-run",
      startedAt: 2,
      state: "running",
      stop: vi.fn(() => true),
    })).toThrow("reserved for a claimed follow-up");

    await registry.registerDurable({
      conversationId: "conversation-a",
      runId: "follow-up-run",
      startedAt: 3,
      state: "running",
      stop: vi.fn(() => true),
    }, {
      followUp: claim,
    });
    expect(registry.getFollowUpStatus(
      { conversationId: "conversation-a", agentRunId: "run-a" },
      accepted.item.commandId,
    )).toMatchObject({
      status: "delivered",
      nextBinding: { conversationId: "conversation-a", agentRunId: "follow-up-run" },
    });
  });

  it("rejects follow-up for a stale or concurrently owned Conversation binding", () => {
    const registry = new ConversationRunRegistry();
    registry.register({
      conversationId: "conversation-a",
      runId: "run-a",
      startedAt: 1,
      state: "running",
      stop: vi.fn(() => true),
    });
    registry.register({
      conversationId: "conversation-a",
      runId: "run-b",
      startedAt: 2,
      state: "running",
      stop: vi.fn(() => true),
    });

    expect(registry.enqueueFollowUp({
      binding: { conversationId: "conversation-a", agentRunId: "run-a" },
      prompt: "stale",
      idempotencyKey: "stale",
    })).toMatchObject({ ok: false, code: "run_mismatch" });
    expect(registry.enqueueFollowUp({
      binding: { conversationId: "conversation-a", agentRunId: "run-b" },
      prompt: "busy",
      idempotencyKey: "busy",
    })).toMatchObject({ ok: false, code: "not_active" });
  });

  it("registers one replacement before stopping the exact run and replays without stopping twice", async () => {
    const registry = new ConversationRunRegistry();
    const stop = vi.fn(() => true);
    registry.register({
      conversationId: "conversation-a",
      runId: "run-a",
      startedAt: 1,
      state: "running",
      stop,
    });

    const first = await registry.replaceActiveRun({
      binding: { conversationId: "conversation-a", agentRunId: "run-a" },
      prompt: "replace this turn",
      idempotencyKey: "replace-request",
    });
    const replay = await registry.replaceActiveRun({
      binding: { conversationId: "conversation-a", agentRunId: "run-a" },
      prompt: "replace this turn",
      idempotencyKey: "replace-request",
    });
    const different = await registry.replaceActiveRun({
      binding: { conversationId: "conversation-a", agentRunId: "run-a" },
      prompt: "another replacement",
      idempotencyKey: "replace-request-2",
    });

    expect(first).toMatchObject({
      ok: true,
      replayed: false,
      stopRequested: true,
      item: { intent: "replace", status: "queued" },
    });
    expect(replay).toMatchObject({
      ok: true,
      replayed: true,
      stopRequested: true,
      item: { commandId: first.ok ? first.item.commandId : "missing" },
    });
    expect(different).toMatchObject({ ok: false, code: "not_active" });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(registry.getRun("conversation-a", "run-a")?.state).toBe("stop_requested");
  });

  it("rejects replacement behind a queued follow-up and fails it when stop cannot be requested", async () => {
    const registry = new ConversationRunRegistry();
    registry.register({
      conversationId: "conversation-a",
      runId: "run-a",
      startedAt: 1,
      state: "running",
      stop: () => true,
    });
    expect(registry.enqueueFollowUp({
      binding: { conversationId: "conversation-a", agentRunId: "run-a" },
      prompt: "already queued",
      idempotencyKey: "follow-up",
    }).ok).toBe(true);
    await expect(registry.replaceActiveRun({
      binding: { conversationId: "conversation-a", agentRunId: "run-a" },
      prompt: "replace",
      idempotencyKey: "replace",
    })).resolves.toMatchObject({ ok: false, code: "queue_conflict" });

    const failing = new ConversationRunRegistry();
    failing.register({
      conversationId: "conversation-b",
      runId: "run-b",
      startedAt: 1,
      state: "running",
      stop: () => { throw new Error("private stop error"); },
    });
    const failed = await failing.replaceActiveRun({
      binding: { conversationId: "conversation-b", agentRunId: "run-b" },
      prompt: "replacement secret",
      idempotencyKey: "replace-failed",
    });
    expect(failed).toMatchObject({
      ok: true,
      stopRequested: false,
      item: { intent: "replace", status: "failed", hasError: true },
    });
    expect(JSON.stringify(failed)).not.toContain("replacement secret");
    expect(JSON.stringify(failed)).not.toContain("private stop error");
  });

  it("accepts steer only through the sole exact run mailbox and fails pending input on clear", async () => {
    const registry = new ConversationRunRegistry();
    const mailbox = new ConversationSteerMailbox({
      binding: { conversationId: "conversation-a", agentRunId: "run-a" },
      createId: () => "steer-1",
    });
    registry.register({
      conversationId: "conversation-a",
      runId: "run-a",
      startedAt: 1,
      state: "running",
      stop: () => true,
    }, { steering: mailbox });

    const first = registry.enqueueSteer({
      binding: { conversationId: "conversation-a", agentRunId: "run-a" },
      prompt: "focus tests",
      idempotencyKey: "request-1",
    });
    const replay = registry.enqueueSteer({
      binding: { conversationId: "conversation-a", agentRunId: "run-a" },
      prompt: "focus tests",
      idempotencyKey: "request-1",
    });
    expect(first).toMatchObject({ ok: true, replayed: false, item: { commandId: "steer-1" } });
    expect(replay).toMatchObject({ ok: true, replayed: true, item: { commandId: "steer-1" } });
    expect(registry.enqueueSteer({
      binding: { conversationId: "conversation-a", agentRunId: "stale" },
      prompt: "wrong run",
      idempotencyKey: "request-2",
    })).toMatchObject({ ok: false, code: "run_mismatch" });

    registry.clear("conversation-a", "run-a");
    expect(registry.getSteerStatus(
      { conversationId: "conversation-a", agentRunId: "run-a" },
      "steer-1",
    )).toMatchObject({ status: "failed", hasError: true });
  });

  it("reports steer as unavailable when the active Agent has no safe model boundary", () => {
    const registry = new ConversationRunRegistry();
    registry.register({
      conversationId: "conversation-a",
      runId: "run-a",
      startedAt: 1,
      state: "running",
      stop: () => true,
    });

    expect(registry.enqueueSteer({
      binding: { conversationId: "conversation-a", agentRunId: "run-a" },
      prompt: "cannot inject",
      idempotencyKey: "request-1",
    })).toMatchObject({ ok: false, code: "not_available" });
  });

  it("does not replace a run while accepted steer input is still pending", async () => {
    const registry = new ConversationRunRegistry();
    const binding = { conversationId: "conversation-a", agentRunId: "run-a" };
    registry.register({
      conversationId: binding.conversationId,
      runId: binding.agentRunId,
      startedAt: 1,
      state: "running",
      stop: () => true,
    }, {
      steering: new ConversationSteerMailbox({ binding }),
    });
    expect(registry.enqueueSteer({
      binding,
      prompt: "already accepted",
      idempotencyKey: "steer-1",
    })).toMatchObject({ ok: true });

    await expect(registry.replaceActiveRun({
      binding,
      prompt: "replacement",
      idempotencyKey: "replace-1",
    })).resolves.toMatchObject({ ok: false, code: "queue_conflict" });
    expect(registry.getRun(binding.conversationId, binding.agentRunId)?.state).toBe("running");
  });

  it("counts running and stop-requested handles without returning run identities", () => {
    const registry = new ConversationRunRegistry();
    registry.register({
      conversationId: "conversation-a",
      runId: "run-a",
      startedAt: 1,
      state: "running",
      stop: vi.fn(() => true),
    });
    registry.register({
      conversationId: "conversation-b",
      runId: "run-b",
      startedAt: 2,
      state: "stop_requested",
      stop: vi.fn(() => true),
    });
    registry.register({
      conversationId: "conversation-c",
      runId: "run-c",
      startedAt: 3,
      state: "stopped",
      stop: vi.fn(() => true),
    });

    expect(registry.getRuntimeSnapshot()).toEqual({
      activeCount: 2,
      stopRequestedCount: 1,
    });

    registry.clear("conversation-a", "run-a");
    registry.clear("conversation-b", "run-b");
    expect(registry.getRuntimeSnapshot()).toEqual({
      activeCount: 0,
      stopRequestedCount: 0,
    });
  });

  it("stops accepting late runs and requests every active run to stop", async () => {
    const registry = new ConversationRunRegistry();
    const firstStop = vi.fn(async () => true);
    const secondStop = vi.fn(async () => {
      throw new Error("stop failed");
    });
    registry.register({
      conversationId: "conversation-a",
      runId: "run-a",
      startedAt: 1,
      state: "running",
      stop: firstStop,
    });
    registry.register({
      conversationId: "conversation-b",
      runId: "run-b",
      startedAt: 2,
      state: "running",
      stop: secondStop,
    });

    registry.stopAccepting();

    await expect(registry.requestStopAll("gateway_shutdown")).rejects.toThrow(
      "Failed to stop 1 of 2 active conversation runs.",
    );
    expect(firstStop).toHaveBeenCalledWith("gateway_shutdown");
    expect(secondStop).toHaveBeenCalledWith("gateway_shutdown");
    expect(registry.getRuntimeSnapshot()).toEqual({
      activeCount: 2,
      stopRequestedCount: 2,
    });
    expect(() => registry.register({
      conversationId: "conversation-c",
      runId: "run-c",
      startedAt: 3,
      state: "running",
      stop: vi.fn(() => true),
    })).toThrow("Conversation run registry is not accepting new runs.");
  });

  it("waits for active runs to settle and supports bounded drain cancellation", async () => {
    const registry = new ConversationRunRegistry();
    registry.register({
      conversationId: "conversation-a",
      runId: "run-a",
      startedAt: 1,
      state: "running",
      stop: vi.fn(() => true),
    });
    let settled = false;
    const drain = registry.waitForIdle().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    registry.markStopped("conversation-a", "run-a", "gateway_shutdown");
    await drain;
    expect(settled).toBe(true);

    const blockedRegistry = new ConversationRunRegistry();
    blockedRegistry.register({
      conversationId: "conversation-b",
      runId: "run-b",
      startedAt: 2,
      state: "running",
      stop: vi.fn(() => true),
    });
    const controller = new AbortController();
    const blockedDrain = blockedRegistry.waitForIdle(controller.signal);
    controller.abort(new Error("deadline"));
    await expect(blockedDrain).rejects.toThrow("deadline");
  });
});
