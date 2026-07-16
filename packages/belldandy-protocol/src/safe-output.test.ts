import { describe, expect, it } from "vitest";

import {
  createPublicFailureEnvelope,
  readResponseTextBounded,
  redactSensitiveText,
  redactSensitiveUrl,
  redactSensitiveValue,
} from "./safe-output.js";

describe("safe output contracts", () => {
  it("redacts nested credentials, header values, and sensitive URL query parameters", () => {
    const redacted = redactSensitiveValue({
      request: {
        headers: {
          Authorization: "Bearer top-secret-token",
          cookie: "session=super-secret",
        },
        payload: [
          { api_key: "nested-api-key" },
          { endpoint: "https://example.test/callback?token=query-secret&safe=ok" },
        ],
      },
    }) as Record<string, any>;

    expect(redacted.request.headers.Authorization).toBe("[REDACTED]");
    expect(redacted.request.headers.cookie).toBe("[REDACTED]");
    expect(redacted.request.payload[0].api_key).toBe("[REDACTED]");
    expect(redacted.request.payload[1].endpoint).toContain("token=%5BREDACTED%5D");
    expect(JSON.stringify(redacted)).not.toContain("top-secret-token");
    expect(JSON.stringify(redacted)).not.toContain("nested-api-key");
    expect(JSON.stringify(redacted)).not.toContain("query-secret");
  });

  it("bounds diagnostic strings and handles circular values without throwing", () => {
    const circular: Record<string, unknown> = { message: "x".repeat(4096) };
    circular.self = circular;

    const redacted = redactSensitiveValue(circular, {
      maxStringBytes: 32,
      maxTotalBytes: 64,
    }) as Record<string, unknown>;

    expect(String(redacted.message)).toContain("[TRUNCATED]");
    expect(redacted.self).toBe("[CIRCULAR]");
  });

  it("removes bearer credentials from text and returns a stable public failure", () => {
    const text = redactSensitiveText("upstream failed: Authorization: Bearer leaked-token");
    const failure = createPublicFailureEnvelope({
      code: "internal_error",
      error: new Error("database password=not-for-user"),
    });

    expect(text).not.toContain("leaked-token");
    expect(failure).toEqual({
      code: "internal_error",
      message: "请求处理失败，请稍后重试。",
      retryable: true,
    });
    expect(JSON.stringify(failure)).not.toContain("not-for-user");
  });

  it("redacts URL userinfo together with sensitive query parameters", () => {
    const redacted = redactSensitiveUrl("https://owner:password@example.test/callback?token=query-secret&safe=ok");

    expect(redacted).not.toContain("owner");
    expect(redacted).not.toContain("password");
    expect(redacted).not.toContain("query-secret");
    expect(redacted).toContain("token=%5BREDACTED%5D");
  });

  it("reads error responses with a byte limit and redacts retained text", async () => {
    const result = await readResponseTextBounded(
      new Response(`Authorization: Bearer response-secret\n${"x".repeat(4096)}`),
      { maxBytes: 64 },
    );

    expect(result.truncated).toBe(true);
    expect(result.bytes).toBe(64);
    expect(result.text).not.toContain("response-secret");
  });
});
