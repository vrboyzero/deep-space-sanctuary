import fs from "node:fs/promises";
import path from "node:path";

import { SubTaskSupervisorFanInResolutionRuntime } from "../subtask-supervisor-fan-in-resolution-runtime.ts";

const [stateDir, inputPath, receiptId] = process.argv.slice(2);
if (!stateDir || !inputPath || !receiptId || typeof process.send !== "function") {
  throw new Error("Fan-in crash child requires state, input, receipt, and IPC arguments.");
}

function holdUntilTerminated() {
  return new Promise(() => {});
}

const originalRename = fs.rename.bind(fs);
fs.rename = async (sourcePath, targetPath) => {
  if (path.basename(String(targetPath)) === `${receiptId}.json`) {
    const record = JSON.parse(await fs.readFile(sourcePath, "utf-8"));
    if (record.result?.status === "completed") {
      await originalRename(sourcePath, targetPath);
      const lockPath = `${targetPath}.lock`;
      const lock = JSON.parse(await fs.readFile(lockPath, "utf-8"));
      await fs.writeFile(lockPath, JSON.stringify({ ...lock, createdAtMs: 0 }), "utf-8");
      process.send({ type: "completed_before_cleanup" });
      return holdUntilTerminated();
    }
  }
  return originalRename(sourcePath, targetPath);
};

try {
  const input = JSON.parse(await fs.readFile(inputPath, "utf-8"));
  const runtime = new SubTaskSupervisorFanInResolutionRuntime({ stateDir });
  await runtime.confirm({ ...input, receiptId, confirm: true });
  process.send({ type: "error", message: "Fan-in confirm passed the crash point unexpectedly." });
} catch (error) {
  process.send({ type: "error", message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
}
