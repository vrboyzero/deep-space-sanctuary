import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CodingTuiRuntime,
  inspectWorkspaceChanges,
  type TuiCodingRunClient,
} from "./runtime.js";

const execFile = promisify(execFileCallback);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

function createClient(): TuiCodingRunClient & {
  conversation: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  control: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  return {
    conversation: vi.fn(async () => ({
      ok: true as const,
      result: { binding: { conversationId: "conversation-1", agentRunId: "run-1" } },
    })),
    subscribe: vi.fn(async () => ({ ok: true as const, result: { earliestSeq: 1, latestSeq: 0 } })),
    control: vi.fn(async () => ({ ok: true as const, result: { accepted: true } })),
    close: vi.fn(async () => undefined),
  };
}

describe("CodingTuiRuntime", () => {
  it("starts a constrained conversation and subscribes to the returned binding", async () => {
    const client = createClient();
    const runtime = new CodingTuiRuntime({
      stateDir: "E:\\state",
      cwd: "E:\\workspace",
      client,
    });

    await expect(runtime.requestConversation("Inspect this repository", "conversation-existing")).resolves.toEqual({
      conversationId: "conversation-1",
      agentRunId: "run-1",
    });
    expect(client.conversation).toHaveBeenCalledWith({
      version: "v1",
      text: "Inspect this repository",
      cwd: path.resolve("E:\\workspace"),
      conversationId: "conversation-existing",
    });
    expect(client.subscribe).toHaveBeenCalledWith({
      version: "v1",
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
      cursor: 0,
    });
  });

  it("forwards permission and cancellation controls with exact bindings", async () => {
    const client = createClient();
    const runtime = new CodingTuiRuntime({ stateDir: "E:\\state", cwd: "E:\\workspace", client });

    await runtime.respondPermission({
      agentRunId: "run-1",
      toolCallId: "tool-1",
      toolName: "file_write",
      worktreeId: "worktree-1",
    }, "allow");
    await runtime.cancel({ conversationId: "conversation-1", agentRunId: "run-1" });

    expect(client.control).toHaveBeenNthCalledWith(1, {
      version: "v1",
      operation: "permission.respond",
      binding: { agentRunId: "run-1", worktreeId: "worktree-1" },
      toolCallId: "tool-1",
      decision: "allow",
    });
    expect(client.control).toHaveBeenNthCalledWith(2, {
      version: "v1",
      operation: "cancel",
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
      reason: "Cancelled from TUI.",
    });
  });

  it("previews revisions without applying and only writes after an explicit apply call", async () => {
    const client = createClient();
    const invokeGateway = vi.fn(async (input: { method: string; params?: Record<string, unknown> }) => ({
      ok: true as const,
      payload: {
        revisionId: String(input.params?.revisionId),
        workspaceId: "workspace-1",
        workspaceRoot: "E:\\workspace",
        createdAtMs: 1,
        updatedAtMs: 2,
        changedFileCount: 1,
        recoveryGuarantee: "exact" as const,
        canRestore: true,
        applied: input.params?.apply === true,
        changes: [{ relativePath: "src/app.ts", action: "restore" as const }],
      },
      paired: true,
      wsUrl: "ws://127.0.0.1:28889",
    }));
    const runtime = new CodingTuiRuntime({
      stateDir: "E:\\state",
      cwd: "E:\\workspace",
      client,
      invokeGateway,
    });

    const preview = await runtime.previewRevision("run-1", "workspace-1");
    expect(preview.canRestore).toBe(true);
    expect(invokeGateway).toHaveBeenNthCalledWith(1, expect.objectContaining({
      method: "workspace.revision.preview",
      params: { revisionId: "run-1", workspaceId: "workspace-1" },
    }));

    const result = await runtime.restoreRevision("run-1", "workspace-1");
    expect(result.applied).toBe(true);
    expect(invokeGateway).toHaveBeenNthCalledWith(2, expect.objectContaining({
      method: "workspace.revision.restore",
      params: { revisionId: "run-1", workspaceId: "workspace-1", apply: true },
    }));
  });
});

describe("inspectWorkspaceChanges", () => {
  it("reports bounded read-only Git and worktree state", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-tui-workspace-"));
    temporaryDirectories.push(directory);
    await execFile("git", ["init"], { cwd: directory });
    await execFile("git", ["config", "user.email", "tui@example.com"], { cwd: directory });
    await execFile("git", ["config", "user.name", "TUI Test"], { cwd: directory });
    await fs.writeFile(path.join(directory, "tracked.txt"), "before\n", "utf-8");
    await execFile("git", ["add", "tracked.txt"], { cwd: directory });
    await execFile("git", ["commit", "-m", "initial"], { cwd: directory });
    await fs.writeFile(path.join(directory, "tracked.txt"), "after\n", "utf-8");
    await fs.writeFile(path.join(directory, "untracked.txt"), "new\n", "utf-8");

    const summary = await inspectWorkspaceChanges(directory);

    expect(summary.repoRoot).toBe(path.resolve(directory));
    expect(summary.trackedChanges).toBe(1);
    expect(summary.untrackedChanges).toBe(1);
    expect(summary.conflictChanges).toBe(0);
    expect(summary.changedPaths).toEqual(expect.arrayContaining(["tracked.txt", "untracked.txt"]));
    expect(summary.error).toBeUndefined();
    await expect(fs.readFile(path.join(directory, "tracked.txt"), "utf-8")).resolves.toBe("after\n");
  });
});
