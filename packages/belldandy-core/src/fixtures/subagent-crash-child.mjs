import fs from "node:fs/promises";

import { createSubTaskAgentCapabilities, SubTaskRuntimeStore } from "../task-runtime.ts";

const [stateDir, spawnLogPath] = process.argv.slice(2);
if (!stateDir || !spawnLogPath || typeof process.send !== "function") {
  throw new Error("Subagent crash child requires state, spawn log, and IPC arguments.");
}

function holdUntilTerminated() {
  return new Promise(() => {});
}

async function waitForAttachedTask(store) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const tasks = await store.listTasks("conversation-process-crash");
    if (tasks.some((task) => task.sessionId === "sub-process-crash-1" && task.status === "running")) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the attached subagent task to persist.");
}

try {
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();
  const capabilities = createSubTaskAgentCapabilities({
    runtimeStore: store,
    orchestrator: {
      listSessions: () => [],
      spawn: async (options) => {
        await fs.appendFile(spawnLogPath, "spawn\n", "utf-8");
        options.onSessionCreated?.("sub-process-crash-1", "coder");
        await waitForAttachedTask(store);
        process.send({ type: "session_attached" });
        return holdUntilTerminated();
      },
    },
  });

  await capabilities.spawnSubAgent({
    parentConversationId: "conversation-process-crash",
    parentOperation: {
      agentRunId: "run-process-crash",
      toolCallId: "tool-process-crash",
    },
    agentId: "coder",
    instruction: "Hold until the subagent process is terminated.",
  });
  process.send({ type: "error", message: "Subagent passed the expected crash point." });
} catch (error) {
  process.send({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
}
