import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(workspaceRoot, "benchmarks", "coding-run-client", "v1", "external-consumer.mjs");

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
    await fs.copyFile(fixturePath, consumerEntrypoint, fs.constants.COPYFILE_EXCL);
    const { stdout } = await execFileAsync(process.execPath, [consumerEntrypoint, workspaceRoot], {
      cwd: temporaryRoot,
      windowsHide: true,
      maxBuffer: 1_048_576,
    });
    const consumerResult = parseConsumerResult(stdout);
    result = {
      schemaVersion: "coding-run-client-external-consumer/v1",
      consumer: "packed-core-self-reference",
      ...consumerResult,
    };
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
  return { ...result, temporaryRootRemoved: !(await pathExists(temporaryRoot)) };
}

function parseConsumerResult(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text || Buffer.byteLength(text, "utf8") > 1_048_576) {
    throw new Error("External consumer returned an empty or oversized result.");
  }
  return JSON.parse(text);
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
