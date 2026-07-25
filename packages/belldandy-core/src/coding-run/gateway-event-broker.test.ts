import { describe, expect, it } from "vitest";

import { createCodingRunGatewayEventBroker } from "./gateway-event-broker.js";

describe("CodingRunGatewayEventBroker", () => {
  it("按精确 Conversation binding 缓冲并从 cursor 续读单调 v1 事件", () => {
    const broker = createCodingRunGatewayEventBroker();
    const binding = { conversationId: "conversation-1", agentRunId: "run-1" };

    expect(broker.registerConversationRun(binding)).toBe(true);
    expect(broker.publishGatewayEvent({
      event: "agent.status",
      payload: { conversationId: "conversation-1", runId: "run-1", status: "running" },
    })).toBe(true);

    const received: number[] = [];
    const subscription = broker.subscribe({
      binding,
      cursor: 1,
      onEvent: (event) => received.push(event.seq),
    });
    expect(subscription).toMatchObject({ ok: true, earliestSeq: 1, latestSeq: 2 });
    if (!subscription.ok) throw new Error("expected successful subscription");

    subscription.subscription.activate();
    expect(received).toEqual([2]);

    broker.publishGatewayEvent({
      event: "chat.delta",
      payload: { conversationId: "conversation-1", runId: "run-1", delta: "hello" },
    });
    expect(received).toEqual([2, 3]);
  });

  it("拒绝陈旧 binding、无效 cursor 与已过期 cursor，且不放行迟到事件", () => {
    const broker = createCodingRunGatewayEventBroker({ maxEventsPerRun: 2 });
    const binding = { conversationId: "conversation-1", agentRunId: "run-1" };
    broker.registerConversationRun(binding);
    broker.publishGatewayEvent({
      event: "agent.status",
      payload: { conversationId: "conversation-1", runId: "run-1", status: "running" },
    });
    broker.publishGatewayEvent({
      event: "chat.delta",
      payload: { conversationId: "conversation-1", runId: "run-1", delta: "hello" },
    });

    expect(broker.subscribe({
      binding: { conversationId: "other", agentRunId: "run-1" },
      onEvent: () => undefined,
    })).toMatchObject({ ok: false, code: "run_mismatch" });
    expect(broker.subscribe({
      binding,
      cursor: 0,
      onEvent: () => undefined,
    })).toMatchObject({ ok: false, code: "cursor_expired", earliestSeq: 2 });
    expect(broker.subscribe({
      binding,
      cursor: 99,
      onEvent: () => undefined,
    })).toMatchObject({ ok: false, code: "invalid_cursor" });

    broker.publishGatewayEvent({
      event: "chat.final",
      payload: { conversationId: "conversation-1", runId: "run-1", text: "done" },
    });
    expect(broker.publishGatewayEvent({
      event: "chat.delta",
      payload: { conversationId: "conversation-1", runId: "run-1", delta: "late" },
    })).toBe(false);
  });

  it("在订阅响应激活前维持重放顺序", () => {
    const broker = createCodingRunGatewayEventBroker();
    const binding = { conversationId: "conversation-1", agentRunId: "run-1" };
    broker.registerConversationRun(binding);
    const received: number[] = [];
    const subscription = broker.subscribe({ binding, onEvent: (event) => received.push(event.seq) });
    if (!subscription.ok) throw new Error("expected successful subscription");

    broker.publishGatewayEvent({
      event: "agent.status",
      payload: { conversationId: "conversation-1", runId: "run-1", status: "running" },
    });
    subscription.subscription.activate();

    expect(received).toEqual([1, 2]);
  });
});
