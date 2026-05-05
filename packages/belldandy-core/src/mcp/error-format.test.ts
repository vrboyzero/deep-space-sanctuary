import { describe, expect, test } from "vitest";

import { formatMcpToolError } from "./error-format.js";

describe("formatMcpToolError", () => {
  test("includes structured content and text details when MCP tool fails", () => {
    const message = formatMcpToolError(
      {
        isError: true,
        error: "Schema validation failed",
        structuredContent: {
          issues: [
            {
              path: ["intent"],
              message: "Required"
            }
          ]
        },
        content: [
          {
            type: "text",
            text: "{\"expected\":\"{ intent: {...} }\"}"
          }
        ]
      } as never,
      "MCP 工具调用失败: starweaver_intent_submit"
    );

    expect(message).toContain("MCP 工具调用失败: starweaver_intent_submit");
    expect(message).toContain("Schema validation failed");
    expect(message).toContain("\"issues\"");
    expect(message).toContain("\"expected\"");
  });
});
