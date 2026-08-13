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
const taskProjectionConformancePath = path.resolve(
  "benchmarks/task-projection/v1/consumer-conformance.json",
);

async function readTaskProjectionConformanceFixture(): Promise<{
  sequence: Array<{
    page: Record<string, unknown>;
    expected: {
      status: string;
      reasonCategory: string;
      reasonCode: string;
      allowedActions: string[];
    };
  }>;
  contentBearingPage: Record<string, unknown>;
}> {
  return JSON.parse(await fs.readFile(taskProjectionConformancePath, "utf8"));
}

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

  it("reads one stable snapshot hunk at a time without recomputing the workspace", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-tui-hunk-pages-"));
    temporaryDirectories.push(stateDir);
    const cwd = path.join(stateDir, "workspace");
    await fs.mkdir(cwd, { recursive: true });
    await fs.writeFile(path.join(cwd, "one.txt"), "one before\n", "utf-8");
    await fs.writeFile(path.join(cwd, "two.txt"), "two before\n", "utf-8");
    const runtime = new CodingTuiRuntime({ stateDir, cwd, client: createClient() });

    const binding = await runtime.requestConversation("Change both files");
    await fs.writeFile(path.join(cwd, "one.txt"), "one after\n", "utf-8");
    await fs.writeFile(path.join(cwd, "two.txt"), "two after\n", "utf-8");
    const result = await runtime.completeChangeSnapshot(binding.agentRunId);

    expect(result).toMatchObject({
      status: "available",
      snapshot: { hunkCount: 2 },
      page: { hunks: [expect.objectContaining({ path: "one.txt" })], nextCursor: expect.any(String) },
    });
    const second = await runtime.readChangeSnapshotPage(
      result!.snapshot!.snapshotId,
      result!.page!.nextCursor,
    );
    expect(second).toMatchObject({
      snapshotId: result!.snapshot!.snapshotId,
      diffHash: result!.snapshot!.diffHash,
      hunks: [expect.objectContaining({ path: "two.txt" })],
    });
    expect(second.nextCursor).toBeUndefined();
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

  it("forwards an active run steer with the exact Conversation binding", async () => {
    const client = createClient();
    const runtime = new CodingTuiRuntime({ stateDir: "E:\\state", cwd: "E:\\workspace", client });

    await runtime.steer(
      { conversationId: "conversation-1", agentRunId: "run-1" },
      "  Focus on the failing test.  ",
    );

    expect(client.control).toHaveBeenCalledWith({
      version: "v1",
      operation: "conversation.steer",
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
      prompt: "Focus on the failing test.",
      idempotencyKey: expect.stringMatching(/^tui-steer-/),
    });
  });

  it("loads validated pending permissions through the paired Gateway", async () => {
    const invokeGateway = vi.fn(async (input: {
      method: string;
      parsePayload: (payload: Record<string, unknown>) => unknown;
    }) => ({
      ok: true as const,
      payload: input.parsePayload({
        permissions: [{
          conversationId: "conversation-1",
          agentRunId: "run-1",
          worktreeId: "worktree-1",
          toolCallId: "tool-1",
          toolName: "command_job",
          commandPreview: {
            action: "cancel",
            jobId: "11111111-1111-4111-8111-111111111111",
            secret: "must-not-leak",
          },
        }],
      }),
      paired: true,
      wsUrl: "ws://127.0.0.1:28889",
    }));
    const runtime = new CodingTuiRuntime({
      stateDir: "E:\\state",
      cwd: "E:\\workspace",
      client: createClient(),
      invokeGateway,
    });

    const permissions = await runtime.listPendingPermissions();

    expect(permissions).toEqual([{
      agentRunId: "run-1",
      worktreeId: "worktree-1",
      toolCallId: "tool-1",
      toolName: "command_job",
      commandPreview: {
        kind: "command",
        action: "cancel",
        jobId: "11111111-1111-4111-8111-111111111111",
      },
    }]);
    expect(JSON.stringify(permissions)).not.toContain("must-not-leak");
    expect(invokeGateway).toHaveBeenCalledWith(expect.objectContaining({
      method: "coding.run.permission.list",
      params: {},
    }));
  });

  it("reads a bounded TaskProjection page without creating a local task state owner", async () => {
    const projection = {
      schemaVersion: "task-projection/v1" as const,
      taskId: "task-1",
      status: "running" as const,
      owner: {
        source: "conversation" as const,
        binding: { conversationId: "conversation-1", agentRunId: "run-1" },
      },
      evidence: { observedAtMs: 10, reasonCategory: "running" as const, reasonCode: "owner_running" },
      allowedActions: ["observe", "cancel"] as const,
      capabilityClosure: {
        schemaVersion: "task-capability-closure/v1" as const,
        evaluatedAtMs: 10,
        status: "satisfied" as const,
        capabilities: Object.fromEntries([
          "tools", "languageToolchain", "sandbox", "approvalChannel", "worktree", "journal",
          "trace", "verifier", "mcp", "plugin", "skill",
        ].map((name) => [name, { required: false, state: "available" as const }])) as Record<string, { required: false; state: "available" }>,
      },
      supportingEvidence: {
        worktree: { status: "missing" as const, lifecycle: "discarded" as const, observedAtMs: 11 },
      },
    };
    const invokeGateway = vi.fn(async (input: {
      method: string;
      params?: Record<string, unknown>;
      parsePayload: (payload: Record<string, unknown>) => unknown;
    }) => ({
      ok: true as const,
      payload: input.parsePayload({
        epoch: "gateway-1",
        revision: 4,
        totalCount: 2,
        items: [projection],
        nextCursor: { epoch: "gateway-1", revision: 4, offset: 1 },
      }),
      paired: true,
      wsUrl: "ws://127.0.0.1:28889",
    }));
    const runtime = new CodingTuiRuntime({
      stateDir: "E:\\state",
      cwd: "E:\\workspace",
      client: createClient(),
      invokeGateway,
    });

    const page = await runtime.listTaskProjections({
      limit: 1,
      cursor: { epoch: "gateway-1", revision: 4, offset: 0 },
    });

    expect(page).toMatchObject({
      epoch: "gateway-1",
      revision: 4,
      totalCount: 2,
      items: [expect.objectContaining({
        taskId: "task-1",
        status: "running",
        supportingEvidence: { worktree: { status: "missing", lifecycle: "discarded", observedAtMs: 11 } },
      })],
      nextCursor: { epoch: "gateway-1", revision: 4, offset: 1 },
    });
    expect(invokeGateway).toHaveBeenCalledWith(expect.objectContaining({
      method: "task.projection.list",
      params: { limit: 1, cursor: { epoch: "gateway-1", revision: 4, offset: 0 } },
    }));
    expect(JSON.stringify(page)).not.toMatch(/prompt|toolArgs|content/);
  });

  it("fails closed when a TaskProjection page contains prompt content", async () => {
    const fixture = await readTaskProjectionConformanceFixture();
    const invokeGateway = vi.fn(async (input: {
      parsePayload: (payload: Record<string, unknown>) => unknown;
    }) => ({
      ok: true as const,
      payload: input.parsePayload(fixture.contentBearingPage),
      paired: true,
      wsUrl: "ws://127.0.0.1:28889",
    }));
    const runtime = new CodingTuiRuntime({
      stateDir: "E:\\state",
      cwd: "E:\\workspace",
      client: createClient(),
      invokeGateway,
    });

    await expect(runtime.listTaskProjections()).rejects.toThrow("invalid TaskProjection");
  });

  it("preserves the fixed TaskProjection event sequence across the TUI consumer", async () => {
    const fixture = await readTaskProjectionConformanceFixture();
    let pageIndex = 0;
    const invokeGateway = vi.fn(async (input: {
      parsePayload: (payload: Record<string, unknown>) => unknown;
    }) => ({
      ok: true as const,
      payload: input.parsePayload(fixture.sequence[pageIndex++].page),
      paired: true,
      wsUrl: "ws://127.0.0.1:28889",
    }));
    const runtime = new CodingTuiRuntime({
      stateDir: "E:\\state",
      cwd: "E:\\workspace",
      client: createClient(),
      invokeGateway,
    });

    for (const step of fixture.sequence) {
      const page = await runtime.listTaskProjections();
      const item = page.items[0];
      expect({
        status: item.status,
        reasonCategory: item.evidence.reasonCategory,
        reasonCode: item.evidence.reasonCode,
        allowedActions: item.allowedActions,
      }).toEqual(step.expected);
    }
  });

  it("lists a bounded safe workspace target projection and switches only after exact revalidation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-tui-worktree-switch-"));
    temporaryDirectories.push(root);
    const launchCwd = path.join(root, "launch");
    const worktreeCwd = path.join(root, "managed");
    await fs.mkdir(launchCwd, { recursive: true });
    await fs.mkdir(worktreeCwd, { recursive: true });
    let returnMismatchedExactTarget = false;
    const worktree = {
      worktreeId: "worktree-1",
      owner: { conversationId: "secret-conversation", runId: "secret-run" },
      worktreePath: worktreeCwd,
      repoRoot: launchCwd,
      baseCommit: "a".repeat(40),
      currentCommit: "b".repeat(40),
      branch: "bdd/worktree-1",
      dirty: true,
      trackedChanges: 1,
      untrackedChanges: 0,
      conflictChanges: 0,
      extraCommitCount: 0,
      status: "ready",
      blockers: [],
      retention: { status: "retained", reason: "secret-retention" },
      error: "must-not-leak",
    };
    const invokeGateway = vi.fn(async (input: {
      method: string;
      params?: Record<string, unknown>;
      parsePayload: (payload: Record<string, unknown>) => unknown;
    }) => ({
      ok: true as const,
      payload: input.parsePayload(input.method === "workspace.revision.list"
        ? {
          checkpoints: [{
            revisionId: "revision-launch",
            workspaceId: "workspace-launch",
            workspaceRoot: launchCwd,
            createdAtMs: 1,
            updatedAtMs: 2,
            changedFileCount: 1,
            recoveryGuarantee: "exact",
          }, {
            revisionId: "revision-managed",
            workspaceId: "workspace-managed",
            workspaceRoot: worktreeCwd,
            createdAtMs: 3,
            updatedAtMs: 4,
            changedFileCount: 2,
            recoveryGuarantee: "exact",
          }],
        }
        : {
          worktrees: input.params?.worktreeId
            ? [{ ...worktree, worktreeId: returnMismatchedExactTarget ? "worktree-other" : worktree.worktreeId }]
            : [worktree, ...Array.from({ length: 120 }, (_value, index) => ({
              ...worktree,
              worktreeId: `worktree-${index + 2}`,
              worktreePath: path.join(root, `managed-${index + 2}`),
            }))],
        }),
      paired: true,
      wsUrl: "ws://127.0.0.1:28889",
    }));
    const client = createClient();
    const runtime = new CodingTuiRuntime({
      stateDir: root,
      cwd: launchCwd,
      client,
      invokeGateway,
    });

    const targets = await runtime.listWorkspaceTargets();

    expect(targets).toHaveLength(100);
    expect(targets[0]).toMatchObject({ targetKey: "launch", kind: "launch", cwd: launchCwd, status: "ready" });
    expect(targets[1]).toEqual({
      targetKey: "worktree:worktree-1",
      kind: "managed",
      worktreeId: "worktree-1",
      cwd: worktreeCwd,
      branch: "bdd/worktree-1",
      status: "ready",
      dirty: true,
      trackedChanges: 1,
      untrackedChanges: 0,
      conflictChanges: 0,
      extraCommitCount: 0,
    });
    expect(JSON.stringify(targets)).not.toContain("secret-");
    expect(JSON.stringify(targets)).not.toContain("must-not-leak");

    await expect(runtime.switchWorkspace("worktree:worktree-1")).resolves.toMatchObject({
      targetKey: "worktree:worktree-1",
      cwd: worktreeCwd,
    });
    expect(runtime.cwd).toBe(worktreeCwd);
    expect(invokeGateway).toHaveBeenLastCalledWith(expect.objectContaining({
      method: "workspace.worktree.status",
      params: { worktreeId: "worktree-1" },
    }));
    await runtime.requestConversation("Inspect managed worktree");
    expect(client.conversation).toHaveBeenLastCalledWith(expect.objectContaining({ cwd: worktreeCwd }));
    await expect(runtime.listRevisions()).resolves.toEqual([
      expect.objectContaining({ revisionId: "revision-managed", workspaceRoot: worktreeCwd }),
    ]);

    returnMismatchedExactTarget = true;
    await expect(runtime.switchWorkspace("worktree:worktree-1")).rejects.toThrow("exact");
    expect(runtime.cwd).toBe(worktreeCwd);
  });

  it("uses paired Gateway preview and confirmation without accepting a caller-supplied refspec", async () => {
    const workspaceRoot = path.resolve(os.tmpdir(), "belldandy-tui-remote-delivery-workspace");
    const stateDir = path.resolve(os.tmpdir(), "belldandy-tui-remote-delivery-state");
    const invokeGateway = vi.fn(async (input: {
      method: string;
      params?: Record<string, unknown>;
      parsePayload: (payload: Record<string, unknown>) => unknown;
    }) => {
      const payload = input.method === "workspace.remote_delivery.targets"
        ? {
          targets: [{
            remote: "private",
            url: "https://github.com/example/private.git",
            pushBranches: ["main"],
            pullRequestBases: ["main"],
            repository: "example/private",
            secret: "must-not-leak",
          }],
        }
        : input.method.endsWith(".preview")
          ? {
            operation: "push",
            canConfirm: true,
            blockers: [],
            approval: { mode: "user_interaction", delegable: false, rememberable: false },
            source: { repoRoot: workspaceRoot, branch: "main", commit: "a".repeat(40), upstream: null },
            target: { remote: "private", url: "https://github.com/example/private.git", branch: "main", expectedOid: "b".repeat(40) },
            diff: { baseOid: "b".repeat(40), sha256: "c".repeat(64), byteLength: 12 },
            receipt: { receiptId: "remote-delivery-receipt", expiresAtMs: 9999999999999 },
          }
          : {
            operation: "push",
            outcome: "succeeded",
            applied: true,
            blockers: [],
            postcondition: { remoteOid: "a".repeat(40) },
          };
      return {
        ok: true as const,
        payload: input.parsePayload(payload),
        paired: true,
        wsUrl: "ws://127.0.0.1:28889",
      };
    });
    const runtime = new CodingTuiRuntime({
      stateDir,
      cwd: workspaceRoot,
      client: createClient(),
      invokeGateway,
    });

    await expect(runtime.listRemoteDeliveryTargets()).resolves.toEqual([{
      remote: "private",
      url: "https://github.com/example/private.git",
      pushBranches: ["main"],
      pullRequestBases: ["main"],
      repository: "example/private",
    }]);
    const preview = await runtime.previewRemotePush("private", "main");
    expect(preview).toMatchObject({
      canConfirm: true,
      approval: { mode: "user_interaction", delegable: false, rememberable: false },
      receipt: { receiptId: "remote-delivery-receipt" },
    });
    await expect(runtime.confirmRemotePush("remote-delivery-receipt")).resolves.toMatchObject({ applied: true });
    expect(invokeGateway).toHaveBeenNthCalledWith(2, expect.objectContaining({
      method: "workspace.remote_delivery.push.preview",
      params: { cwd: workspaceRoot, remote: "private", targetBranch: "main" },
    }));
    expect(invokeGateway).toHaveBeenNthCalledWith(3, expect.objectContaining({
      method: "workspace.remote_delivery.push.confirm",
      params: { receiptId: "remote-delivery-receipt", confirm: true },
    }));
  });

  it("preserves an uncertain applied remote push for manual reconciliation", async () => {
    const runtime = new CodingTuiRuntime({
      stateDir: path.resolve(os.tmpdir(), "belldandy-tui-remote-delivery-uncertain-state"),
      cwd: path.resolve(os.tmpdir(), "belldandy-tui-remote-delivery-uncertain-workspace"),
      client: createClient(),
      invokeGateway: vi.fn(async (input) => ({
        ok: true as const,
        payload: input.parsePayload({
          operation: "push",
          outcome: "uncertain",
          applied: true,
          blockers: ["audit_persistence_failed"],
          postcondition: { remoteOid: "a".repeat(40) },
        }),
        paired: true,
        wsUrl: "ws://127.0.0.1:28889",
      })),
    });

    await expect(runtime.confirmRemotePush("remote-delivery-receipt")).resolves.toMatchObject({
      outcome: "uncertain",
      applied: true,
      blockers: ["audit_persistence_failed"],
      postcondition: { remoteOid: "a".repeat(40) },
    });
  });

  it("keeps a run change snapshot bound to its launch workspace after the TUI cwd changes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-tui-worktree-run-snapshot-"));
    temporaryDirectories.push(root);
    const firstCwd = path.join(root, "first");
    const secondCwd = path.join(root, "second");
    await fs.mkdir(firstCwd, { recursive: true });
    await fs.mkdir(secondCwd, { recursive: true });
    await fs.writeFile(path.join(firstCwd, "note.txt"), "before\n", "utf-8");
    const runtime = new CodingTuiRuntime({
      stateDir: root,
      cwd: firstCwd,
      client: createClient(),
      invokeGateway: vi.fn(async (input) => ({
        ok: true as const,
        payload: input.parsePayload({
          worktrees: [{
            worktreeId: "worktree-2",
            worktreePath: secondCwd,
            branch: "bdd/worktree-2",
            status: "ready",
            dirty: false,
            trackedChanges: 0,
            untrackedChanges: 0,
            conflictChanges: 0,
            extraCommitCount: 0,
          }],
        }),
        paired: true,
        wsUrl: "ws://127.0.0.1:28889",
      })),
    });

    const binding = await runtime.requestConversation("Change note");
    await fs.writeFile(path.join(firstCwd, "note.txt"), "after\n", "utf-8");
    await runtime.switchWorkspace("worktree:worktree-2");

    await expect(runtime.completeChangeSnapshot(binding.agentRunId)).resolves.toMatchObject({
      status: "available",
      snapshot: { files: [{ path: "note.txt" }] },
    });
    expect(runtime.cwd).toBe(secondCwd);
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

  it("loads validated command job summaries through the paired Gateway", async () => {
    const invokeGateway = vi.fn(async (input: {
      method: string;
      parsePayload: (payload: Record<string, unknown>) => unknown;
    }) => ({
      ok: true as const,
      payload: input.parsePayload({
        jobs: [{
          jobId: "11111111-1111-4111-8111-111111111111",
          status: "running",
          stdinMode: "pty",
          createdAt: 1,
          updatedAt: 2,
          pid: 4101,
          supportsResize: true,
          oldestCursor: 0,
          nextCursor: 20,
          recovery: {
            lifecycle: "active",
            process: "attached",
            output: "memory_only",
            stdin: "live_only",
            mutationReplay: "forbidden",
          },
        }, {
          jobId: "99999999-9999-4999-8999-999999999999",
          status: "lost",
          stdinMode: "pty",
          createdAt: 1,
          updatedAt: 2,
          supportsResize: true,
          oldestCursor: 0,
          nextCursor: 0,
        }],
      }),
      paired: true,
      wsUrl: "ws://127.0.0.1:28889",
    }));
    const runtime = new CodingTuiRuntime({
      stateDir: "E:\\state",
      cwd: "E:\\workspace",
      client: createClient(),
      invokeGateway,
    });

    await expect(runtime.listCommandJobs()).resolves.toEqual([
      expect.objectContaining({
        jobId: "11111111-1111-4111-8111-111111111111",
        status: "running",
      nextCursor: 20,
      recovery: expect.objectContaining({ lifecycle: "active", mutationReplay: "forbidden" }),
      }),
    ]);
    expect(invokeGateway).toHaveBeenCalledWith(expect.objectContaining({
      method: "command.job.list",
      params: {},
    }));
  });

  it("reads a bounded command job output page from an exact cursor", async () => {
    const jobId = "22222222-2222-4222-8222-222222222222";
    const invokeGateway = vi.fn(async (input: {
      method: string;
      params?: Record<string, unknown>;
      parsePayload: (payload: Record<string, unknown>) => unknown;
    }) => ({
      ok: true as const,
      payload: input.parsePayload({
        jobId,
        status: "running",
        stdinMode: "pipe",
        createdAt: 1,
        updatedAt: 2,
        supportsResize: false,
        oldestCursor: 0,
        output: "page two",
        startCursor: 8,
        nextCursor: 16,
        hasMore: true,
        cursorExpired: false,
        cursorAdjusted: false,
        recovery: {
          lifecycle: "active",
          process: "attached",
          output: "memory_only",
          stdin: "live_only",
          mutationReplay: "forbidden",
        },
      }),
      paired: true,
      wsUrl: "ws://127.0.0.1:28889",
    }));
    const runtime = new CodingTuiRuntime({
      stateDir: "E:\\state",
      cwd: "E:\\workspace",
      client: createClient(),
      invokeGateway,
    });

    await expect(runtime.readCommandJob(jobId, 8)).resolves.toMatchObject({
      jobId,
      output: "page two",
      startCursor: 8,
      nextCursor: 16,
      hasMore: true,
    });
    expect(invokeGateway).toHaveBeenCalledWith(expect.objectContaining({
      method: "command.job.read",
      params: { jobId, cursor: 8, maxBytes: 16 * 1024 },
    }));
  });

  it("cancels the exact command job and validates the returned binding", async () => {
    const jobId = "33333333-3333-4333-8333-333333333333";
    const invokeGateway = vi.fn(async (input: {
      method: string;
      parsePayload: (payload: Record<string, unknown>) => unknown;
    }) => ({
      ok: true as const,
      payload: input.parsePayload({
        jobId,
        status: "cancelled",
        stdinMode: "closed",
        createdAt: 1,
        updatedAt: 3,
        endedAt: 3,
        terminationReason: "cancelled",
        supportsResize: false,
        oldestCursor: 0,
        nextCursor: 0,
        recovery: {
          lifecycle: "settled",
          process: "not_applicable",
          output: "memory_only",
          stdin: "closed",
          mutationReplay: "forbidden",
        },
      }),
      paired: true,
      wsUrl: "ws://127.0.0.1:28889",
    }));
    const runtime = new CodingTuiRuntime({
      stateDir: "E:\\state",
      cwd: "E:\\workspace",
      client: createClient(),
      invokeGateway,
    });

    await expect(runtime.cancelCommandJob(jobId)).resolves.toMatchObject({
      jobId,
      status: "cancelled",
      terminationReason: "cancelled",
    });
    expect(invokeGateway).toHaveBeenCalledWith(expect.objectContaining({
      method: "command.job.cancel",
      params: { jobId },
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
