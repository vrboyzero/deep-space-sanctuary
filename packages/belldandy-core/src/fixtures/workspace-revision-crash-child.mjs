import { fileWriteTool } from "../../../belldandy-skills/src/builtin/file.ts";
import { CodingRunReconciliationJournal } from "../coding-run/reconciliation-journal.ts";
import { WorkspaceRevisionRuntime } from "../workspace-revision.ts";

const [stateDir, workspaceRoot, phase, conversationId, agentRunId, toolCallId] = process.argv.slice(2);
if (!stateDir
  || !workspaceRoot
  || (phase !== "prepared" && phase !== "committed")
  || !conversationId
  || !agentRunId
  || !toolCallId
  || typeof process.send !== "function") {
  throw new Error("Workspace revision crash child requires state, binding, phase, and IPC arguments.");
}

const binding = { conversationId, agentRunId };
const workspaceRevisionRuntime = new WorkspaceRevisionRuntime({ stateDir });
const journal = new CodingRunReconciliationJournal(stateDir, {
  workspaceMutationEvidenceStore: workspaceRevisionRuntime,
});

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

function holdUntilTerminated() {
  return new Promise(() => {});
}

const crashObserver = {
  async prepareMutations(input) {
    await workspaceRevisionRuntime.prepareMutations(input);
    if (phase === "prepared") {
      process.send({ type: "prepared" });
      await holdUntilTerminated();
    }
  },
  async commitMutations(input) {
    await workspaceRevisionRuntime.commitMutations(input);
    if (phase === "committed") {
      process.send({ type: "committed" });
      await holdUntilTerminated();
    }
  },
};

try {
  journal.record(event(1, "run.started", { status: "running" }));
  journal.record(event(2, "tool.started", {
    tool: { id: toolCallId, name: "file_write" },
  }));
  await fileWriteTool.execute({
    path: "durable.txt",
    content: "written-once",
  }, {
    conversationId,
    agentRunId,
    toolCallId,
    workspaceRoot,
    workspaceRevisionId: agentRunId,
    workspaceMutationObserver: crashObserver,
    policy: {
      allowedPaths: [],
      deniedPaths: [".git", "node_modules"],
      allowedDomains: [],
      deniedDomains: [],
      maxTimeoutMs: 5_000,
      maxResponseBytes: 1_024,
    },
  });
  process.send({ type: "error", message: `File mutation passed unexpected ${phase} crash point.` });
} catch (error) {
  process.send({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
}
