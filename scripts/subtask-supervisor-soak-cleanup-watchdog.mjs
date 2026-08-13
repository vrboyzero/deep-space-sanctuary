import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const parentPid = Number(process.argv[2]);
const rootDir = path.resolve(String(process.argv[3] ?? ""));
const temporaryRoot = path.resolve(os.tmpdir());

if (!Number.isSafeInteger(parentPid) || parentPid <= 0) {
  throw new Error("Cleanup watchdog parent PID is invalid.");
}
if (path.dirname(rootDir) !== temporaryRoot || !path.basename(rootDir).startsWith("belldandy-p2a-soak-")) {
  throw new Error("Cleanup watchdog root is outside the exact P2-A temporary boundary.");
}

while (isProcessAlive(parentPid)) {
  await delay(500);
}
await fs.rm(rootDir, { recursive: true, force: true });

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
