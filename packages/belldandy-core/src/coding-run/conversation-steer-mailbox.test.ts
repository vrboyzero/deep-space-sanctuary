import { describe, expect, it, vi } from "vitest";

import { ConversationSteerMailbox } from "./conversation-steer-mailbox.js";

describe("ConversationSteerMailbox", () => {
  it("keeps enqueue idempotent, bounded, and free of prompt content in public views", () => {
    const mailbox = new ConversationSteerMailbox({
      binding: { conversationId: "conversation-a", agentRunId: "run-a" },
      maxQueued: 1,
      createId: () => "steer-1",
      now: () => 10,
    });

    const first = mailbox.enqueue({ prompt: "focus on the failing test", idempotencyKey: "request-1" });
    const replay = mailbox.enqueue({ prompt: "focus on the failing test", idempotencyKey: "request-1" });
    const conflict = mailbox.enqueue({ prompt: "change direction", idempotencyKey: "request-1" });
    const full = mailbox.enqueue({ prompt: "also inspect logs", idempotencyKey: "request-2" });

    expect(first).toMatchObject({
      ok: true,
      replayed: false,
      item: {
        commandId: "steer-1",
        intent: "steer",
        status: "queued",
        promptChars: 25,
        sourceBinding: { conversationId: "conversation-a", agentRunId: "run-a" },
      },
    });
    expect(replay).toMatchObject({ ok: true, replayed: true, item: { commandId: "steer-1" } });
    expect(conflict).toMatchObject({ ok: false, code: "idempotency_conflict" });
    expect(full).toMatchObject({ ok: false, code: "queue_full" });
    expect(JSON.stringify(first)).not.toContain("focus on the failing test");
    expect(JSON.stringify(first)).not.toContain("request-1");
  });

  it("delivers queued input once at the next model-call boundary and then seals atomically", async () => {
    let now = 20;
    const onDeliver = vi.fn(async () => undefined);
    const mailbox = new ConversationSteerMailbox({
      binding: { conversationId: "conversation-a", agentRunId: "run-a" },
      createId: () => "steer-1",
      now: () => now++,
      onDeliver,
    });
    const queued = mailbox.enqueue({ prompt: "use the smaller patch", idempotencyKey: "request-1" });
    if (!queued.ok) throw new Error("expected steer acceptance");

    await expect(mailbox.consumePending({ modelCallIndex: 2 })).resolves.toEqual([{
      commandId: "steer-1",
      prompt: "use the smaller patch",
    }]);
    await expect(mailbox.consumePending({ modelCallIndex: 3 })).resolves.toEqual([]);
    expect(onDeliver).toHaveBeenCalledOnce();
    expect(mailbox.getStatus("steer-1")).toMatchObject({
      status: "delivered",
      deliveredModelCallIndex: 2,
      hasError: false,
    });
    expect(mailbox.sealIfIdle()).toBe(true);
    expect(mailbox.enqueue({ prompt: "too late", idempotencyKey: "request-2" }))
      .toMatchObject({ ok: false, code: "not_active" });
  });

  it("fails delivery errors and unconsumed input when the run closes", async () => {
    const mailbox = new ConversationSteerMailbox({
      binding: { conversationId: "conversation-a", agentRunId: "run-a" },
      createId: (() => {
        let id = 0;
        return () => `steer-${++id}`;
      })(),
      onDeliver: async ({ prompt }) => {
        if (prompt === "cannot persist") throw new Error("private persistence failure");
      },
    });
    const failing = mailbox.enqueue({ prompt: "cannot persist", idempotencyKey: "request-1" });
    const pending = mailbox.enqueue({ prompt: "still queued", idempotencyKey: "request-2" });
    if (!failing.ok || !pending.ok) throw new Error("expected steer acceptance");

    await expect(mailbox.consumePending({ modelCallIndex: 2 })).resolves.toEqual([{
      commandId: pending.item.commandId,
      prompt: "still queued",
    }]);
    expect(mailbox.getStatus(failing.item.commandId)).toMatchObject({ status: "failed", hasError: true });

    const late = mailbox.enqueue({ prompt: "run will end first", idempotencyKey: "request-3" });
    if (!late.ok) throw new Error("expected late steer acceptance");
    expect(mailbox.close("run ended")).toBe(1);
    expect(mailbox.getStatus(late.item.commandId)).toMatchObject({ status: "failed", hasError: true });
    expect(JSON.stringify(mailbox.getStatus(failing.item.commandId))).not.toContain("private persistence failure");
  });
});
