import fs from "node:fs/promises";

import { SubTaskSupervisorWorktreeDisposalRuntime } from "../subtask-supervisor-worktree-disposal-runtime.ts";
import { SubTaskRuntimeStore } from "../task-runtime.ts";
import { SubTaskWorktreeRuntime } from "../worktree-runtime.ts";

const [stateDir, inputPath] = process.argv.slice(2);
if (!stateDir || !inputPath || typeof process.send !== "function") {
  throw new Error("Disposal crash child requires state, input and IPC arguments.");
}

const originalCleanup = SubTaskWorktreeRuntime.prototype.cleanupTaskRuntime;
SubTaskWorktreeRuntime.prototype.cleanupTaskRuntime = async function (...args) {
  const result = await originalCleanup.apply(this, args);
  const taskId = String(args[0]);
  const lockPath = `${stateDir}/subtasks/supervisor-worktree-disposal/locks/${taskId}.json.lock`;
  const lock = JSON.parse(await fs.readFile(lockPath, "utf-8"));
  await fs.writeFile(lockPath, JSON.stringify({ ...lock, createdAtMs: 0 }), "utf-8");
  process.send({ type: "cleanup_applied" });
  await new Promise(() => {});
  return result;
};

try {
  const input = JSON.parse(await fs.readFile(inputPath, "utf-8"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();
  const runtime = new SubTaskSupervisorWorktreeDisposalRuntime({
    stateDir,
    runtimeStore: store,
    worktreeRuntime: new SubTaskWorktreeRuntime(stateDir),
  });
  await runtime.confirm(input);
  process.send({ type: "error", message: "Disposal child passed the expected crash point." });
} catch (error) {
  process.send({ type: "error", message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
}
