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
import { WorkspaceRevisionRuntime } from "../workspace-revision.js";

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

  it("captures a run-start change snapshot and reads its first hunk after the terminal event", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-tui-change-snapshot-"));
    temporaryDirectories.push(stateDir);
    const cwd = path.join(stateDir, "workspace");
    await fs.mkdir(cwd, { recursive: true });
    await fs.writeFile(path.join(cwd, "note.txt"), "before\n", "utf-8");
    const runtime = new CodingTuiRuntime({ stateDir, cwd, client: createClient() });

    const binding = await runtime.requestConversation("Change note");
    await fs.writeFile(path.join(cwd, "note.txt"), "after\n", "utf-8");
    const result = await runtime.completeChangeSnapshot(binding.agentRunId);

    expect(result).toMatchObject({
      status: "available",
      snapshot: {
        files: [{ path: "note.txt", status: "modified" }],
        recovery: { recoveryGuarantee: "detect_only", reason: "checkpoint_missing" },
      },
      page: {
        hunks: [expect.objectContaining({ path: "note.txt", patch: expect.stringContaining("-before") })],
      },
    });
  });

  it("projects an exact recovery guarantee when the current run checkpoint covers its diff", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-tui-change-recovery-"));
    temporaryDirectories.push(stateDir);
    const cwd = path.join(stateDir, "workspace");
    const file = path.join(cwd, "note.txt");
    await fs.mkdir(cwd, { recursive: true });
    await fs.writeFile(file, "before\n", "utf-8");
    const runtime = new CodingTuiRuntime({ stateDir, cwd, client: createClient() });

    const binding = await runtime.requestConversation("Change note");
    const revisions = new WorkspaceRevisionRuntime({ stateDir });
    const targets = [{ absolutePath: file, relativePath: "note.txt" }];
    await revisions.prepareMutations({
      revisionId: binding.agentRunId,
      workspaceRoot: cwd,
      toolName: "file_write",
      targets,
    });
    await fs.writeFile(file, "after\n", "utf-8");
    await revisions.commitMutations({
      revisionId: binding.agentRunId,
      workspaceRoot: cwd,
      toolName: "file_write",
      targets,
    });

    await expect(runtime.completeChangeSnapshot(binding.agentRunId)).resolves.toMatchObject({
      status: "available",
      snapshot: { recovery: { recoveryGuarantee: "exact", checkpointId: binding.agentRunId } },
    });
  });

  it("recomputes the current run diff from its original baseline after a restore", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-tui-change-recompute-"));
    temporaryDirectories.push(stateDir);
    const cwd = path.join(stateDir, "workspace");
    const file = path.join(cwd, "note.txt");
    await fs.mkdir(cwd, { recursive: true });
    await fs.writeFile(file, "before\n", "utf-8");
    const runtime = new CodingTuiRuntime({ stateDir, cwd, client: createClient() });

    const binding = await runtime.requestConversation("Change note");
    await fs.writeFile(file, "agent change\n", "utf-8");
    const changed = await runtime.completeChangeSnapshot(binding.agentRunId);
    await fs.writeFile(file, "before\n", "utf-8");
    const recomputed = await runtime.recomputeChangeSnapshot(binding.agentRunId);

    expect(changed).toMatchObject({ status: "available", snapshot: { files: [{ path: "note.txt" }] } });
    expect(recomputed).toMatchObject({
      status: "available",
      snapshot: { files: [], recovery: { recoveryGuarantee: "detect_only", reason: "no_changes" } },
    });
    await expect(runtime.recomputeChangeSnapshot("unknown-run")).resolves.toBeUndefined();
  });

  it("retains the last available run diff when restore-time recomputation cannot read its baseline", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-tui-change-recompute-failure-"));
    temporaryDirectories.push(stateDir);
    const cwd = path.join(stateDir, "workspace");
    const file = path.join(cwd, "note.txt");
    await fs.mkdir(cwd, { recursive: true });
    await fs.writeFile(file, "before\n", "utf-8");
    const runtime = new CodingTuiRuntime({ stateDir, cwd, client: createClient() });

    const binding = await runtime.requestConversation("Change note");
    await fs.writeFile(file, "agent change\n", "utf-8");
    const completed = await runtime.completeChangeSnapshot(binding.agentRunId);
    expect(completed).toMatchObject({ status: "available", snapshot: { files: [{ path: "note.txt" }] } });
    const baselineId = completed?.snapshot?.baseline.baselineId;
    expect(baselineId).toBeTruthy();
    await fs.rm(path.join(stateDir, "artifacts", "workspace-change-snapshots", baselineId!, "manifest.json"));

    await expect(runtime.recomputeChangeSnapshot(binding.agentRunId)).resolves.toMatchObject({ status: "unavailable" });
    await expect(runtime.completeChangeSnapshot(binding.agentRunId)).resolves.toBe(completed);
  });

  it("keeps the conversation available when its optional change snapshot cannot be captured", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-tui-change-unavailable-"));
    temporaryDirectories.push(root);
    const stateFile = path.join(root, "state-file");
    const cwd = path.join(root, "workspace");
    await fs.writeFile(stateFile, "not a directory", "utf-8");
    await fs.mkdir(cwd, { recursive: true });
    const client = createClient();
    const runtime = new CodingTuiRuntime({ stateDir: stateFile, cwd, client });

    await expect(runtime.requestConversation("Change note")).resolves.toEqual({
      conversationId: "conversation-1",
      agentRunId: "run-1",
    });
    await expect(runtime.completeChangeSnapshot("run-1")).resolves.toMatchObject({ status: "unavailable" });
    expect(client.conversation).toHaveBeenCalledTimes(1);
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

  it("preserves restore conflict hashes and evidence artifact metadata from Gateway", async () => {
    const runtime = new CodingTuiRuntime({
      stateDir: "E:\\state",
      cwd: "E:\\workspace",
      client: createClient(),
      invokeGateway: vi.fn(async (input) => ({
        ok: true as const,
        payload: input.parsePayload({
          revisionId: "run-1",
          workspaceId: "workspace-1",
          workspaceRoot: "E:\\workspace",
          createdAtMs: 1,
          updatedAtMs: 2,
          changedFileCount: 1,
          recoveryGuarantee: "exact" as const,
          canRestore: false,
          changes: [{
            relativePath: "src/app.ts",
            action: "conflict" as const,
            reason: "current file hash differs from the recorded tool result",
            recordedAfterHash: "a".repeat(64),
            currentHash: "b".repeat(64),
          }],
          conflictArtifact: {
            artifactPath: "E:\\state\\workspace-revisions\\workspace-1\\run-1\\restore-conflicts\\evidence.json",
            capturedAtMs: 3,
            conflictCount: 1,
          },
        }),
        paired: true,
        wsUrl: "ws://127.0.0.1:28889",
      })),
    });

    await expect(runtime.previewRevision("run-1", "workspace-1")).resolves.toMatchObject({
      canRestore: false,
      changes: [{
        relativePath: "src/app.ts",
        action: "conflict",
        recordedAfterHash: "a".repeat(64),
        currentHash: "b".repeat(64),
      }],
      conflictArtifact: { conflictCount: 1 },
    });
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
