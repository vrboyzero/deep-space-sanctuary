import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  isPermissionToolCompleted,
  readPermissionRequest,
  summarizePermissionRequest,
} = require("./permission-request.cjs");

describe("VS Code pending permission summary", () => {
  it("keeps only the exact control binding and safe tool summary", () => {
    const request = readPermissionRequest({
      version: "v1",
      seq: 4,
      type: "permission.requested",
      binding: { agentRunId: "run-1", conversationId: "conversation-1" },
      payload: {
        permission: {
          toolCallId: "tool-1",
          toolName: "apply_patch",
          worktreeId: "worktree-1",
          arguments: { token: "must-not-leak" },
          output: "must-not-leak",
        },
      },
    });

    expect(request).toEqual({
      agentRunId: "run-1",
      toolCallId: "tool-1",
      toolName: "apply_patch",
      worktreeId: "worktree-1",
    });
    expect(summarizePermissionRequest(request)).toBe("apply_patch (tool-1)");
    expect(JSON.stringify(request)).not.toContain("must-not-leak");
  });

  it("fails closed for incomplete requests and clears only the matching completed tool", () => {
    const request = {
      agentRunId: "run-1",
      toolCallId: "tool-1",
      toolName: "apply_patch",
    };
    expect(readPermissionRequest({
      type: "permission.requested",
      binding: { agentRunId: "run-1" },
      payload: { permission: { toolName: "apply_patch" } },
    })).toBeUndefined();
    expect(isPermissionToolCompleted({
      type: "tool.completed",
      binding: { agentRunId: "run-1" },
      payload: { tool: { id: "tool-1" } },
    }, request)).toBe(true);
    expect(isPermissionToolCompleted({
      type: "tool.completed",
      binding: { agentRunId: "other-run" },
      payload: { tool: { id: "tool-1" } },
    }, request)).toBe(false);
  });
});
