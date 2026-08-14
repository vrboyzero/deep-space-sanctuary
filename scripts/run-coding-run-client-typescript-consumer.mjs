import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(workspaceRoot, "benchmarks", "coding-run-client", "v1", "typescript-consumer.ts");

export async function runCodingRunClientTypeScriptConsumer() {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-coding-run-client-ts-consumer-"));
  const tarballPath = path.join(temporaryRoot, "belldandy-core.tgz");
  const packageRoot = path.join(temporaryRoot, "node_modules", "@belldandy", "core");
  const consumerSource = path.join(temporaryRoot, "consumer.ts");
  const consumerRunner = path.join(temporaryRoot, "consumer-runner.mjs");
  let result;
  try {
    const corepack = resolveCorepackInvocation();
    await runCommand(corepack.executable, [
      ...corepack.prefixArguments,
      "pnpm", "--filter", "@belldandy/core", "pack", "--out", tarballPath,
    ], { cwd: workspaceRoot, windowsHide: true });
    await fs.mkdir(packageRoot, { recursive: true });
    await runCommand("tar", ["-xzf", tarballPath, "-C", packageRoot, "--strip-components=1"], {
      cwd: workspaceRoot,
      windowsHide: true,
    });
    await Promise.all([
      fs.copyFile(fixturePath, consumerSource),
      fs.writeFile(
        path.join(temporaryRoot, "package.json"),
        `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
        { encoding: "utf8", flag: "wx" },
      ),
      fs.writeFile(
        path.join(temporaryRoot, "tsconfig.json"),
        `${JSON.stringify({
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            lib: ["ES2022", "DOM"],
            strict: true,
            skipLibCheck: false,
            noEmitOnError: true,
            outDir: "dist",
          },
          files: ["consumer.ts"],
        }, null, 2)}\n`,
        { encoding: "utf8", flag: "wx" },
      ),
      fs.writeFile(
        consumerRunner,
        [
          'import { runTypeScriptConsumer } from "./dist/consumer.js";',
          "const result = await runTypeScriptConsumer(process.argv[2]);",
          "process.stdout.write(`${JSON.stringify(result)}\\n`);",
          "",
        ].join("\n"),
        { encoding: "utf8", flag: "wx" },
      ),
    ]);

    await runCommand(process.execPath, [resolveTypeScriptCompiler(), "--project", "tsconfig.json"], {
      cwd: temporaryRoot,
      windowsHide: true,
    });
    const { stdout } = await runCommand(process.execPath, [consumerRunner, workspaceRoot], {
      cwd: temporaryRoot,
      windowsHide: true,
      maxBuffer: 1_048_576,
    });
    const lifecycle = parseConsumerResult(stdout);
    assert.equal(lifecycle.protocolVersion, "v1");
    result = {
      schemaVersion: "coding-run-client-typescript-consumer/v1",
      consumer: "packed-core-typescript-nodenext",
      compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", strict: true },
      ...lifecycle,
    };
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
  return { ...result, temporaryRootRemoved: !(await pathExists(temporaryRoot)) };
}

function resolveCorepackInvocation() {
  if (process.platform !== "win32") return { executable: "corepack", prefixArguments: [] };
  return {
    executable: process.execPath,
    prefixArguments: [path.join(path.dirname(process.execPath), "node_modules", "corepack", "dist", "corepack.js")],
  };
}

function resolveTypeScriptCompiler() {
  return path.join(workspaceRoot, "node_modules", "typescript", "bin", "tsc");
}

function parseConsumerResult(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text || Buffer.byteLength(text, "utf8") > 1_048_576) {
    throw new Error("TypeScript consumer returned an empty or oversized result.");
  }
  return JSON.parse(text);
}

async function runCommand(executable, args, options) {
  try {
    return await execFileAsync(executable, args, options);
  } catch (error) {
    const stdout = String(error?.stdout ?? "").slice(-4_000).trim();
    const stderr = String(error?.stderr ?? "").slice(-4_000).trim();
    const details = [stdout && `stdout:\n${stdout}`, stderr && `stderr:\n${stderr}`].filter(Boolean).join("\n");
    throw new Error(
      `Command failed (${error?.code ?? "unknown"}): ${executable} ${args.join(" ")}${details ? `\n${details}` : ""}`,
      { cause: error },
    );
  }
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
  runCodingRunClientTypeScriptConsumer()
    .then((runResult) => process.stdout.write(`${JSON.stringify(runResult)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
