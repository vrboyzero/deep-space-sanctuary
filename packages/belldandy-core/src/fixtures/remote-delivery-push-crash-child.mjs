import fs from "node:fs/promises";
import path from "node:path";

import { RemoteDeliveryRuntime } from "../remote-delivery-runtime.ts";

const [stateDir, remoteDir, receiptId, phase] = process.argv.slice(2);
if (!stateDir
  || !remoteDir
  || !receiptId
  || (phase !== "started" && phase !== "pushed")
  || typeof process.send !== "function") {
  throw new Error("Remote push crash child requires state, remote, receipt, phase, and IPC arguments.");
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
  if (phase === "pushed" && path.basename(path.dirname(String(targetPath))) === "audit") {
    const record = JSON.parse(await fs.readFile(sourcePath, "utf-8"));
    if (record.status === "succeeded") {
      process.send({ type: "pushed" });
      return holdUntilTerminated();
    }
  }
  return originalRename(sourcePath, targetPath);
};

try {
  const runtime = new RemoteDeliveryRuntime({
    stateDir,
    targets: [{ remote: "private", url: remoteDir, pushBranches: ["main"] }],
  });
  await runtime.confirm({ operation: "push", receiptId, confirm: true });
  process.send({ type: "error", message: `Remote push passed unexpected ${phase} crash point.` });
} catch (error) {
  process.send({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
}
