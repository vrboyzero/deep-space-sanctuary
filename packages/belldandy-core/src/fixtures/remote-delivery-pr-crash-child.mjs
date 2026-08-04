import fs from "node:fs/promises";
import path from "node:path";

import { RemoteDeliveryRuntime } from "../remote-delivery-runtime.ts";

const [
  stateDir,
  remoteDir,
  receiptId,
  pullRequestPath,
  createLogPath,
  title,
  body,
  phase,
] = process.argv.slice(2);

if (!stateDir
  || !remoteDir
  || !receiptId
  || !pullRequestPath
  || !createLogPath
  || !title
  || body === undefined
  || (phase !== "started" && phase !== "created")
  || typeof process.send !== "function") {
  throw new Error("Remote pull request crash child requires state, remote, receipt, PR store, payload, phase, and IPC arguments.");
}

function holdUntilTerminated() {
  return new Promise(() => {});
}

async function readPullRequest() {
  try {
    return JSON.parse(await fs.readFile(pullRequestPath, "utf-8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

const pullRequests = {
  async findOpen(input) {
    const record = await readPullRequest();
    return record?.state === "OPEN"
      && record.repository === input.repository
      && record.headBranch === input.headBranch
      && record.baseBranch === input.baseBranch
      ? record
      : undefined;
  },
  async create(input) {
    await fs.appendFile(createLogPath, "create\n", "utf-8");
    const record = {
      number: 41,
      url: "https://github.com/vrboyzero/deep-space-sanctuary/pull/41",
      state: "OPEN",
      repository: input.repository,
      headBranch: input.headBranch,
      baseBranch: input.baseBranch,
      headCommit: input.headCommit,
    };
    await fs.writeFile(pullRequestPath, `${JSON.stringify(record)}\n`, { encoding: "utf-8", flag: "wx" });
    return record;
  },
  async get(input) {
    const record = await readPullRequest();
    return record?.repository === input.repository && record.number === input.number ? record : undefined;
  },
};

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
  if (phase === "created" && path.basename(path.dirname(String(targetPath))) === "audit") {
    const record = JSON.parse(await fs.readFile(sourcePath, "utf-8"));
    if (record.status === "succeeded" && record.pullRequestNumber === 41) {
      process.send({ type: "created" });
      return holdUntilTerminated();
    }
  }
  return originalRename(sourcePath, targetPath);
};

try {
  const runtime = new RemoteDeliveryRuntime({
    stateDir,
    targets: [{
      remote: "private",
      url: remoteDir,
      pushBranches: ["feature/process-crash"],
      pullRequestBases: ["main"],
      repository: "vrboyzero/deep-space-sanctuary",
    }],
    pullRequests,
  });
  await runtime.confirm({ operation: "pull_request", receiptId, confirm: true, title, body });
  process.send({ type: "error", message: `Remote pull request passed unexpected ${phase} crash point.` });
} catch (error) {
  process.send({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
}
