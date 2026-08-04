import fs from "node:fs/promises";
import path from "node:path";

import { UserWorktreeRuntime } from "../user-worktree-runtime.ts";

const [stateDir, worktreeId, receiptId, phase] = process.argv.slice(2);
if (!stateDir
  || !worktreeId
  || !receiptId
  || (phase !== "started" && phase !== "staged")
  || typeof process.send !== "function") {
  throw new Error("User worktree stage crash child requires state, receipt, phase, and IPC arguments.");
}

function holdUntilTerminated() {
  return new Promise(() => {});
}

const originalWriteFile = fs.writeFile.bind(fs);
fs.writeFile = async (filePath, data, options) => {
  if (phase === "started" && path.basename(path.dirname(String(filePath))) === "audit") {
    const record = JSON.parse(String(data));
    if (record.status === "started") {
      await originalWriteFile(filePath, data, options);
      process.send({ type: "started" });
      return holdUntilTerminated();
    }
  }
  return originalWriteFile(filePath, data, options);
};

const originalRename = fs.rename.bind(fs);
fs.rename = async (sourcePath, targetPath) => {
  if (phase === "staged" && path.basename(path.dirname(String(targetPath))) === "audit") {
    const record = JSON.parse(await fs.readFile(sourcePath, "utf-8"));
    if (record.status === "succeeded") {
      process.send({ type: "staged" });
      return holdUntilTerminated();
    }
  }
  return originalRename(sourcePath, targetPath);
};

try {
  const runtime = new UserWorktreeRuntime(stateDir);
  await runtime.confirm({
    operation: "stage",
    worktreeId,
    receiptId,
    confirm: true,
  });
  process.send({ type: "error", message: `Worktree stage passed unexpected ${phase} crash point.` });
} catch (error) {
  process.send({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
}
