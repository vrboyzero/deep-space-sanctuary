import { describe, expect, it } from "vitest";

import { formatToolAuditLogMessage, shouldDebugToolAuditLog } from "./tool-audit-log.js";

describe("shouldDebugToolAuditLog", () => {
  it("downgrades StarWeaver polling reads even when the poll fails", () => {
    expect(shouldDebugToolAuditLog({
      toolName: "mcp_starweaver_central_agent_wake_notifications",
      arguments: {},
    })).toBe(true);
  });

  it("keeps acknowledgement calls at info level", () => {
    expect(shouldDebugToolAuditLog({
      toolName: "mcp_starweaver_central_agent_wake_notifications",
      arguments: { ackMatched: true },
    })).toBe(false);
  });

  it("does not downgrade unrelated tools", () => {
    expect(shouldDebugToolAuditLog({
      toolName: "mcp_other_tool",
      arguments: {},
    })).toBe(false);
  });

  it("keeps acknowledgement calls at info level after raw arguments are removed", () => {
    expect(shouldDebugToolAuditLog({
      toolName: "mcp_starweaver_central_agent_wake_notifications",
      safeArguments: { ackMatched: true },
    })).toBe(false);
  });

  it("formats failed audit messages from stable summaries without raw error text", () => {
    const message = formatToolAuditLogMessage({
      toolName: "opaque_diagnostic",
      success: false,
      durationMs: 12,
      failureKind: "business_logic_error",
      errorSummary: {
        bytes: 38,
        sha256: "a".repeat(64),
      },
      error: "internalMarker=customer-private-error",
    });

    expect(message).toContain("business_logic_error");
    expect(message).toContain("38 bytes");
    expect(message).toContain("aaaaaaaaaaaa");
    expect(message).not.toContain("customer-private-error");
  });
});
