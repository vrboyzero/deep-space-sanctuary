import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function runCodingRunClientExternalConsumer() {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-coding-run-client-consumer-"));
  const tarballPath = path.join(temporaryRoot, "belldandy-core.tgz");
  const packageRoot = path.join(temporaryRoot, "node_modules", "@belldandy", "core");
  const consumerEntrypoint = path.join(temporaryRoot, "consumer.mjs");
  let result;
  try {
    const corepack = resolveCorepackInvocation();
    await execFileAsync(corepack.executable, [
      ...corepack.prefixArguments,
      "pnpm", "--filter", "@belldandy/core", "pack", "--out", tarballPath,
    ], { cwd: workspaceRoot, windowsHide: true });
    await fs.mkdir(packageRoot, { recursive: true });
    await execFileAsync("tar", ["-xzf", tarballPath, "-C", packageRoot, "--strip-components=1"], {
      cwd: workspaceRoot,
      windowsHide: true,
    });
    const packageJson = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
    assert.deepEqual(packageJson.exports["./coding-run-client"], {
      types: "./dist/coding-run-client.d.ts",
      import: "./dist/coding-run-client.js",
      default: "./dist/coding-run-client.js",
    });
    await fs.writeFile(
      consumerEntrypoint,
      'export * from "@belldandy/core/coding-run-client";\n',
      { encoding: "utf8", flag: "wx" },
    );
    const module = await import(pathToFileURL(consumerEntrypoint).href);
    const operations = await runLifecycle(module.CodingRunClient);
    result = {
      schemaVersion: "coding-run-client-external-consumer/v1",
      consumer: "packed-core-self-reference",
      protocolVersion: module.CODING_RUN_PROTOCOL_VERSION,
      compatibility: module.CODING_RUN_CLIENT_COMPATIBILITY,
      operations,
      contentMode: "none",
    };
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
  return { ...result, temporaryRootRemoved: !(await pathExists(temporaryRoot)) };
}

async function runLifecycle(CodingRunClient) {
  let requestIndex = 0;
  let client;
  client = new CodingRunClient({
    createRequestId: () => `external-${++requestIndex}`,
    write: async (line) => {
      const request = JSON.parse(line);
      queueMicrotask(() => client.consume(`${JSON.stringify(responseFor(request))}\n`));
    },
  });
  const operations = [];
  await client.start({ prompt: "Inspect the workspace.", cwd: workspaceRoot }); operations.push("start");
  await client.subscribeRun({ conversationId: "conversation-1", agentRunId: "run-1" }); operations.push("subscribe");
  await client.respondPermission({ agentRunId: "run-1", toolCallId: "tool-allow", decision: "allow" }); operations.push("respond_allow");
  await client.respondPermission({ agentRunId: "run-1", toolCallId: "tool-deny", decision: "deny" }); operations.push("respond_deny");
  await client.cancel({ conversationId: "conversation-1", agentRunId: "run-1" }); operations.push("cancel");
  await client.readArtifact({ agentRunId: "run-1" }); operations.push("read_artifact");
  client.close(); operations.push("close");
  return operations;
}

function responseFor(request) {
  const type = request.type.replace("request", "response");
  if (request.type === "conversation.request") {
    return { version: "v1", type, id: request.id, ok: true, result: { binding: { conversationId: "conversation-1", agentRunId: "run-1" } } };
  }
  return { version: "v1", type, id: request.id, ok: true, result: { accepted: true, contentMode: "none" } };
}

function resolveCorepackInvocation() {
  if (process.platform !== "win32") return { executable: "corepack", prefixArguments: [] };
  return {
    executable: process.execPath,
    prefixArguments: [path.join(path.dirname(process.execPath), "node_modules", "corepack", "dist", "corepack.js")],
  };
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url))) {
  runCodingRunClientExternalConsumer()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
