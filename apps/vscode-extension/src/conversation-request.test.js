import path from "node:path";

import { describe, expect, it } from "vitest";

import { readConversationBinding, resolveWorkspaceCwd } from "./conversation-request.cjs";

describe("VS Code Conversation request helpers", () => {
  it("prefers the active editor workspace and rejects non-file or relative workspace paths", () => {
    const first = { uri: { fsPath: path.join(process.cwd(), "first") } };
    const active = { uri: { fsPath: path.join(process.cwd(), "active") } };
    const workspace = {
      workspaceFolders: [first],
      getWorkspaceFolder: () => active,
    };

    expect(resolveWorkspaceCwd(workspace, { scheme: "file" })).toBe(path.resolve(active.uri.fsPath));
    expect(resolveWorkspaceCwd({ workspaceFolders: [{ uri: { fsPath: "relative" } }] })).toBeUndefined();
    expect(resolveWorkspaceCwd({ workspaceFolders: [{ uri: { fsPath: process.cwd() } }] }, { scheme: "vscode-remote" })).toBeUndefined();
  });

  it("accepts only a complete Conversation binding returned by the stdio bridge", () => {
    expect(readConversationBinding({
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
    })).toEqual({ conversationId: "conversation-1", agentRunId: "run-1" });
    expect(readConversationBinding({ binding: { conversationId: "conversation-1" } })).toBeUndefined();
    expect(readConversationBinding({ binding: { conversationId: "conversation-1", agentRunId: "run\n1" } })).toBeUndefined();
  });
});
