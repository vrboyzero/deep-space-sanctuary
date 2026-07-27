import { describe, expect, it } from "vitest";

import { ConversationFollowUpQueue } from "./conversation-follow-up-queue.js";

const binding = { conversationId: "conversation-1", agentRunId: "run-1" } as const;

describe("ConversationFollowUpQueue", () => {
  it("replays the same idempotent enqueue and rejects changed content", () => {
    const queue = createQueue();
    const first = queue.enqueue({ binding, prompt: "continue with tests", idempotencyKey: "request-1" });
    const replay = queue.enqueue({ binding, prompt: "continue with tests", idempotencyKey: "request-1" });
    const conflict = queue.enqueue({ binding, prompt: "change the implementation", idempotencyKey: "request-1" });

    expect(first).toMatchObject({ ok: true, replayed: false, item: { status: "queued", promptChars: 19 } });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(conflict).toEqual({
      ok: false,
      code: "idempotency_conflict",
      message: "idempotencyKey is already bound to different follow-up content.",
    });
    expect(JSON.stringify(first)).not.toContain("continue with tests");
    expect(JSON.stringify(first)).not.toContain("request-1");
  });

  it("enforces a fixed per-run queue capacity", () => {
    const queue = createQueue({ maxQueuedPerRun: 2 });
    expect(queue.enqueue({ binding, prompt: "one", idempotencyKey: "one" }).ok).toBe(true);
    expect(queue.enqueue({ binding, prompt: "two", idempotencyKey: "two" }).ok).toBe(true);
    expect(queue.enqueue({ binding, prompt: "three", idempotencyKey: "three" })).toEqual({
      ok: false,
      code: "queue_full",
      message: "Conversation follow-up queue is full for this run.",
    });
  });

  it("claims one command, reserves the Conversation, and records the next exact binding", () => {
    const queue = createQueue();
    const accepted = queue.enqueue({ binding, prompt: "continue", idempotencyKey: "request-1" });
    if (!accepted.ok) throw new Error("expected enqueue success");

    const claim = queue.claimNext({ binding, conversationAvailable: true });
    expect(claim).toMatchObject({
      commandId: accepted.item.commandId,
      queueBinding: binding,
      prompt: "continue",
    });
    expect(queue.isRegistrationAllowed("conversation-1")).toBe(false);
    expect(queue.isRegistrationAllowed("conversation-1", accepted.item.commandId)).toBe(true);

    const nextBinding = { conversationId: "conversation-1", agentRunId: "run-2" };
    expect(queue.markDelivered({
      queueBinding: binding,
      commandId: accepted.item.commandId,
      nextBinding,
    })).toBe(true);
    expect(queue.isRegistrationAllowed("conversation-1")).toBe(true);
    expect(queue.getStatus(binding, accepted.item.commandId)).toMatchObject({
      status: "delivered",
      sourceBinding: binding,
      nextBinding,
      hasError: false,
    });
  });

  it("fails queued commands when the terminal handoff is no longer serial", () => {
    const queue = createQueue();
    const first = queue.enqueue({ binding, prompt: "one", idempotencyKey: "one" });
    const second = queue.enqueue({ binding, prompt: "two", idempotencyKey: "two" });
    if (!first.ok || !second.ok) throw new Error("expected enqueue success");

    expect(queue.claimNext({ binding, conversationAvailable: false })).toBeUndefined();
    expect(queue.getStatus(binding, first.item.commandId)).toMatchObject({ status: "failed", hasError: true });
    expect(queue.getStatus(binding, second.item.commandId)).toMatchObject({ status: "failed", hasError: true });
  });

  it("distinguishes replacement intent and supports replay-only lookup", () => {
    const queue = createQueue();
    expect(queue.hasPending(binding)).toBe(false);
    const accepted = queue.enqueue({
      binding,
      intent: "replace",
      prompt: "replace the current turn",
      idempotencyKey: "replace-1",
    });
    if (!accepted.ok) throw new Error("expected replacement enqueue success");

    expect(queue.hasPending(binding)).toBe(true);
    expect(accepted.item).toMatchObject({ intent: "replace", status: "queued" });
    expect(queue.replay({
      binding,
      intent: "replace",
      prompt: "replace the current turn",
      idempotencyKey: "replace-1",
    })).toEqual({ ...accepted, replayed: true });
    expect(queue.replay({
      binding,
      intent: "follow_up",
      prompt: "replace the current turn",
      idempotencyKey: "replace-1",
    })).toMatchObject({ ok: false, code: "idempotency_conflict" });
    expect(queue.replay({
      binding,
      intent: "replace",
      prompt: "missing",
      idempotencyKey: "missing",
    })).toBeUndefined();
  });
});

function createQueue(options: { maxQueuedPerRun?: number } = {}): ConversationFollowUpQueue {
  let sequence = 0;
  let now = 100;
  return new ConversationFollowUpQueue({
    ...options,
    createId: () => `follow-up-${++sequence}`,
    now: () => ++now,
  });
}
