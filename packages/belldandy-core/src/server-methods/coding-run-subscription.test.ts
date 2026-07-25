import { describe, expect, it, vi } from "vitest";

import { CODING_RUN_PROTOCOL_VERSION } from "../coding-run/contracts.js";
import { createCodingRunGatewayEventBroker } from "../coding-run/gateway-event-broker.js";
import { handleCodingRunSubscriptionMethod } from "./coding-run-subscription.js";

describe("coding.run.subscribe", () => {
  it("只在完整 binding 匹配时订阅，并在响应后按 seq 投递重放事件", async () => {
    const broker = createCodingRunGatewayEventBroker();
    broker.registerConversationRun({ conversationId: "conversation-1", agentRunId: "run-1" });
    broker.publishGatewayEvent({
      event: "agent.status",
      payload: { conversationId: "conversation-1", runId: "run-1", status: "running" },
    });
    const closeHandlers: Array<() => void> = [];
    const send = vi.fn();
    const ws = {
      readyState: 1,
      send,
      once: (event: string, handler: () => void) => {
        if (event === "close") closeHandlers.push(handler);
      },
    };

    const response = handleCodingRunSubscriptionMethod({
      type: "req",
      id: "subscribe-1",
      method: "coding.run.subscribe",
      params: {
        version: CODING_RUN_PROTOCOL_VERSION,
        binding: { conversationId: "conversation-1", agentRunId: "run-1" },
        cursor: 1,
      },
    }, ws as never, { eventBroker: broker });

    expect(response).toMatchObject({
      ok: true,
      payload: { earliestSeq: 1, latestSeq: 2 },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(send).toHaveBeenCalledWith(expect.stringContaining('"event":"coding.run.event"'));
    expect(send).toHaveBeenCalledWith(expect.stringContaining('"seq":2'));

    closeHandlers.forEach((handler) => handler());
    broker.publishGatewayEvent({
      event: "chat.delta",
      payload: { conversationId: "conversation-1", runId: "run-1", delta: "after-close" },
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("拒绝不完整、陈旧或过期 cursor 的订阅请求", () => {
    const broker = createCodingRunGatewayEventBroker({ maxEventsPerRun: 1 });
    broker.registerConversationRun({ conversationId: "conversation-1", agentRunId: "run-1" });
    broker.publishGatewayEvent({
      event: "agent.status",
      payload: { conversationId: "conversation-1", runId: "run-1", status: "running" },
    });
    const ws = { readyState: 1, send: vi.fn(), once: vi.fn() };

    expect(handleCodingRunSubscriptionMethod({
      type: "req",
      id: "invalid",
      method: "coding.run.subscribe",
      params: { version: CODING_RUN_PROTOCOL_VERSION, binding: { conversationId: "conversation-1" } },
    }, ws as never, { eventBroker: broker })).toMatchObject({ ok: false, error: { code: "invalid_params" } });

    expect(handleCodingRunSubscriptionMethod({
      type: "req",
      id: "stale",
      method: "coding.run.subscribe",
      params: {
        version: CODING_RUN_PROTOCOL_VERSION,
        binding: { conversationId: "other", agentRunId: "run-1" },
      },
    }, ws as never, { eventBroker: broker })).toMatchObject({ ok: false, error: { code: "run_mismatch" } });

    expect(handleCodingRunSubscriptionMethod({
      type: "req",
      id: "expired",
      method: "coding.run.subscribe",
      params: {
        version: CODING_RUN_PROTOCOL_VERSION,
        binding: { conversationId: "conversation-1", agentRunId: "run-1" },
        cursor: 0,
      },
    }, ws as never, { eventBroker: broker })).toMatchObject({ ok: false, error: { code: "cursor_expired" } });
  });
});
