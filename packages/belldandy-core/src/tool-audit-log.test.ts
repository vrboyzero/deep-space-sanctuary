import { describe, expect, it } from "vitest";

import { shouldDebugToolAuditLog } from "./tool-audit-log.js";

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
});
