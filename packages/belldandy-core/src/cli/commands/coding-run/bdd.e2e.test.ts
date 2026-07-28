import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { CODING_RUN_PROTOCOL_VERSION } from "../../../coding-run/contracts.js";
import { startGatewayServer } from "../../../server.js";
import { cleanupGlobalMemoryManagersForTest, resolveWebRoot, withEnv } from "../../../server-testkit.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const projectRoot = path.resolve(packageRoot, "../..");
const builtBddPath = path.join(packageRoot, "dist", "bin", "bdd.js");
const tscPath = path.join(projectRoot, "node_modules", "typescript", "bin", "tsc");

type ChildResult = {
  exitCode: number | null;
  stderr: string;
  stdout: string;
};

afterEach(async () => {
  await cleanupGlobalMemoryManagersForTest();
});

beforeAll(async () => {
  const result = await runNode(tscPath, ["-b", "--pretty", "false"], packageRoot);
  expect(result.exitCode, result.stderr).toBe(0);
  expect(fs.existsSync(builtBddPath)).toBe(true);
}, 30_000);

describe("built bdd coding-run stdio bridge", () => {
  it("forwards one control frame to the real Gateway and keeps stdout parseable NDJSON", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-coding-run-stdio-binary-"));
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
    });

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(server.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        const result = await runBdd(["coding-run", "stdio", "--state-dir", stateDir], `${JSON.stringify({
          version: CODING_RUN_PROTOCOL_VERSION,
          type: "control.request",
          id: "stdio-cancel-1",
          control: {
            version: CODING_RUN_PROTOCOL_VERSION,
            operation: "cancel",
            binding: { conversationId: "missing-conversation", agentRunId: "missing-run" },
          },
        })}\n`);

        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        expect(parseJsonl(result.stdout)).toEqual([{
          version: CODING_RUN_PROTOCOL_VERSION,
          type: "control.response",
          id: "stdio-cancel-1",
          ok: false,
          error: {
            code: "run_mismatch",
            message: "Conversation run binding no longer matches the active Conversation run.",
          },
        }]);
      });
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);
});

function parseJsonl(stdout: string): Array<Record<string, unknown>> {
  return stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function runBdd(args: string[], stdin: string): Promise<ChildResult> {
  return runNode(builtBddPath, args, packageRoot, stdin);
}

async function runNode(entryPath: string, args: string[], cwd: string, stdin = ""): Promise<ChildResult> {
  return new Promise<ChildResult>((resolve, reject) => {
    const child = spawn(process.execPath, [entryPath, ...args], {
      cwd,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
    child.stdin.end(stdin);
  });
}
