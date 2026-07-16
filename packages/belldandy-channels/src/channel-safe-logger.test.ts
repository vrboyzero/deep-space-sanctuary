import { describe, expect, it } from "vitest";

import {
  ChannelSafeLogger,
  createChannelApprovalPreview,
  createChannelPublicFailureMessage,
} from "./channel-safe-logger.js";

describe("ChannelSafeLogger", () => {
  it("records message diagnostics without retaining body or sensitive context", () => {
    const records: unknown[] = [];
    const logger = new ChannelSafeLogger({
      info: (_message, data) => records.push(data),
      warn: (_message, data) => records.push(data),
      error: (_message, data) => records.push(data),
    });

    logger.info({
      channel: "feishu",
      event: "tool_result",
      messageId: "message-1",
      body: "Authorization: Bearer body-secret",
      context: {
        toolName: "web_fetch",
        output: "body-secret",
        retry: 1,
      },
    });

    const serialized = JSON.stringify(records[0]);
    expect(serialized).toContain("bodyBytes");
    expect(serialized).toContain("bodyHash");
    expect(serialized).not.toContain("body-secret");
    expect(serialized).not.toContain('"output"');
  });

  it("bounds approval previews and never returns internal failure text", () => {
    const preview = createChannelApprovalPreview(`token=preview-secret ${"x".repeat(512)}`, 48);
    const message = createChannelPublicFailureMessage();

    expect(preview).not.toContain("preview-secret");
    expect(preview).toContain("[TRUNCATED]");
    expect(message).toBe("请求处理失败，请稍后重试。");
  });
});
