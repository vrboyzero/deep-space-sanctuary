import type { SubTaskRecord, SubTaskRuntimeStore } from "./task-runtime.js";

function isTerminalStatus(status: string): boolean {
  return status === "done" || status === "error" || status === "timeout"
    || status === "stopped" || status === "interrupted";
}

export function createSubTaskTakeoverDispatcher(input: {
  runtimeStore: Pick<SubTaskRuntimeStore, "getTask">;
  takeoverRunningSubTask: (taskId: string, agentId: string, message?: string) => Promise<SubTaskRecord | undefined>;
  takeoverFinishedSubTask: (taskId: string, agentId: string, message?: string) => Promise<SubTaskRecord | undefined>;
}) {
  return async (taskId: string, agentId: string, message?: string): Promise<SubTaskRecord | undefined> => {
    const current = await input.runtimeStore.getTask(taskId);
    if (!current) return undefined;
    if (current.archivedAt) {
      throw new Error("Archived subtasks cannot be taken over.");
    }
    if (current.status === "running" && current.sessionId) {
      return input.takeoverRunningSubTask(taskId, agentId, message);
    }
    if (isTerminalStatus(current.status)) {
      return input.takeoverFinishedSubTask(taskId, agentId, message);
    }
    throw new Error(`Subtask takeover only supports running or finished tasks. Current status: ${current.status}`);
  };
}
