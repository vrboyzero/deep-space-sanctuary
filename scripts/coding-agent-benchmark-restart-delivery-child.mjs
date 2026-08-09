import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [
  phase,
  stateDirValue,
  workspaceValue,
  baselineCommit,
  conversationId,
  agentRunId,
  toolCallId,
  reconciliationJournalPath,
  workspaceRevisionPath,
  userWorktreeRuntimePath,
  fileToolPath,
] = process.argv.slice(2);

if ((phase !== "before_restart" && phase !== "after_restart")
  || !stateDirValue
  || !workspaceValue
  || !baselineCommit
  || !conversationId
  || !agentRunId
  || !toolCallId
  || !reconciliationJournalPath
  || !workspaceRevisionPath
  || !userWorktreeRuntimePath
  || !fileToolPath
  || typeof process.send !== "function") {
  throw new Error("Restart delivery child requires a phase, binding, workspace, and production module paths.");
}

const stateDir = path.resolve(stateDirValue);
const workspace = path.resolve(workspaceValue);
const processBindingId = `restart-process-${process.pid}-${crypto.randomUUID()}`;
const binding = { conversationId, agentRunId };
const owner = { conversationId, runId: agentRunId };

const [journalModule, revisionModule, userWorktreeModule, fileToolModule] = await Promise.all([
  import(pathToFileURL(path.resolve(reconciliationJournalPath)).href),
  import(pathToFileURL(path.resolve(workspaceRevisionPath)).href),
  import(pathToFileURL(path.resolve(userWorktreeRuntimePath)).href),
  import(pathToFileURL(path.resolve(fileToolPath)).href),
]);

const { CodingRunReconciliationJournal } = journalModule;
const { WorkspaceRevisionRuntime } = revisionModule;
const { UserWorktreeRuntime } = userWorktreeModule;
const { fileWriteTool } = fileToolModule;
if (typeof CodingRunReconciliationJournal !== "function"
  || typeof WorkspaceRevisionRuntime !== "function"
  || typeof UserWorktreeRuntime !== "function"
  || typeof fileWriteTool?.execute !== "function") {
  throw new Error("Restart delivery child could not load the production owners.");
}

const workspaceRevisionRuntime = new WorkspaceRevisionRuntime({ stateDir });
const journal = new CodingRunReconciliationJournal(stateDir, {
  workspaceMutationEvidenceStore: workspaceRevisionRuntime,
});
const userWorktrees = new UserWorktreeRuntime(stateDir);

try {
  if (phase === "before_restart") {
    await runBeforeRestart();
    await new Promise(() => {});
  } else {
    await runAfterRestart();
  }
} catch (error) {
  await send({
    type: "error",
    processBindingId,
    message: error instanceof Error ? error.message : String(error ?? "unknown error"),
  }).catch(() => undefined);
  process.exitCode = 1;
}

async function runBeforeRestart() {
  const worktree = await userWorktrees.create({ cwd: workspace, owner });
  if (worktree.status !== "ready" || worktree.baseCommit !== baselineCommit) {
    throw new Error("Restart delivery worktree did not bind the fixture baseline.");
  }

  journal.record(event(1, "run.started", { status: "running" }));
  journal.record(event(2, "tool.started", {
    tool: { id: toolCallId, name: "file_write" },
  }));
  const result = await fileWriteTool.execute({
    path: "workspace/durable.txt",
    content: "side-effect-count=1\n",
  }, {
    conversationId,
    agentRunId,
    toolCallId,
    workspaceRoot: worktree.worktreePath,
    stateDir,
    workspaceRevisionId: agentRunId,
    workspaceMutationObserver: workspaceRevisionRuntime,
    policy: {
      allowedPaths: ["workspace"],
      deniedPaths: [".git", "node_modules"],
      allowedDomains: [],
      deniedDomains: [],
      maxTimeoutMs: 5_000,
      maxResponseBytes: 1_024,
    },
  });
  if (result?.success !== true) {
    throw new Error("Restart delivery production file write did not complete.");
  }
  journal.record(event(3, "tool.completed", {
    tool: { id: toolCallId, name: "file_write", success: true },
  }));
  const content = await fs.readFile(
    path.join(worktree.worktreePath, "workspace", "durable.txt"),
    "utf-8",
  );
  await send({
    type: "side_effect_completed",
    processBindingId,
    worktreeId: worktree.worktreeId,
    completedSideEffectCount: readSideEffectCount(content),
  });
}

async function runAfterRestart() {
  const reconciliation = await journal.reconcile(binding);
  const worktrees = await userWorktrees.listStatus();
  const owned = worktrees.filter((worktree) => worktree.owner?.conversationId === conversationId
    && worktree.owner?.runId === agentRunId);
  if (owned.length !== 1
    || owned[0].status !== "blocked"
    || owned[0].currentCommit !== baselineCommit
    || owned[0].trackedChanges !== 1
    || owned[0].untrackedChanges !== 0
    || owned[0].conflictChanges !== 0
    || owned[0].extraCommitCount !== 0) {
    throw new Error("Restart delivery could not reattach the exact persisted worktree.");
  }
  const worktree = owned[0];
  const worktreeContent = await fs.readFile(
    path.join(worktree.worktreePath, "workspace", "durable.txt"),
    "utf-8",
  );
  const completedSideEffectCount = readSideEffectCount(worktreeContent);
  if (reconciliation.state !== "applied"
    || reconciliation.journalState !== "available"
    || reconciliation.appliedOperationCount !== 1
    || reconciliation.uncertainOperationCount !== 0
    || completedSideEffectCount !== 1) {
    throw new Error("Restart delivery reconciliation did not prove one applied side effect.");
  }

  const preview = await userWorktrees.preview({
    operation: "apply",
    worktreeId: worktree.worktreeId,
  });
  if (preview.canConfirm !== true || !preview.receipt?.receiptId
    || preview.target?.head !== baselineCommit) {
    throw new Error("Restart delivery local apply preview is not confirmable.");
  }
  const confirmation = await userWorktrees.confirm({
    operation: "apply",
    worktreeId: worktree.worktreeId,
    receiptId: preview.receipt.receiptId,
    confirm: true,
  });
  if (confirmation.outcome !== "succeeded" || confirmation.applied !== true) {
    throw new Error("Restart delivery local apply confirmation did not succeed.");
  }
  const deliveredContent = await fs.readFile(path.join(workspace, "workspace", "durable.txt"), "utf-8");
  if (readSideEffectCount(deliveredContent) !== 1) {
    throw new Error("Restart delivery local result did not preserve the single side effect.");
  }

  await send({
    type: "reconciliation_completed",
    processBindingId,
    worktreeId: worktree.worktreeId,
    reattached: true,
    reconciliation,
    completedSideEffectCount,
    replayedSideEffectCount: 0,
    localDeliveryStatus: "completed",
    remoteWriteCount: 0,
  });
}

function event(seq, type, payload) {
  return {
    version: "v1",
    seq,
    timestampMs: Date.now(),
    source: "conversation",
    binding,
    type,
    payload,
  };
}

function readSideEffectCount(value) {
  const match = /^side-effect-count=(\d+)\r?\n?$/u.exec(String(value));
  if (!match) throw new Error("Restart delivery side effect counter is invalid.");
  return Number(match[1]);
}

function send(message) {
  return new Promise((resolve, reject) => {
    process.send(message, (error) => (error ? reject(error) : resolve()));
  });
}
