import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { BelldandyAgent } from "@belldandy/agent";
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

describe("built bdd agent CLI", () => {
  it("accepts stdin and enforces an output schema for run and continue", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-binary-"));
    const conversationId = "built-agent-conversation";
    const schemaPath = path.join(stateDir, "output-schema.json");
    await fs.promises.writeFile(schemaPath, JSON.stringify({
      type: "object",
      required: ["echo"],
      properties: { echo: { type: "string" } },
      additionalProperties: false,
    }), "utf-8");
    const agent: BelldandyAgent = {
      async *run(input) {
        if (input.text.startsWith("invalid\n\n") && input.text.includes("## Output Schema Contract")) {
          yield { type: "final", text: "not-json" };
          return;
        }
        yield { type: "final", text: JSON.stringify({ echo: input.text }) };
      },
    };
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
    });

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(server.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        const sharedArgs = [
          "--jsonl",
          "--conversation-id", conversationId,
          "--state-dir", stateDir,
          "--output-schema", schemaPath,
        ];
        const first = await runBdd(["agent", "run", ...sharedArgs], "first request\n");
        expect(first.exitCode, first.stderr).toBe(0);
        expect(first.stderr).toBe("");
        expect(parseJsonl(first.stdout).at(-1)).toMatchObject({
          type: "run.completed",
          binding: { conversationId },
        });

        const continued = await runBdd(["agent", "continue", ...sharedArgs], "second request\n");
        expect(continued.exitCode, continued.stderr).toBe(0);
        expect(continued.stderr).toBe("");
        expect(parseJsonl(continued.stdout).at(-1)).toMatchObject({
          type: "run.completed",
          binding: { conversationId },
        });

        const invalid = await runBdd([
          "agent", "run",
          "--jsonl",
          "--prompt", "invalid",
          "--state-dir", stateDir,
          "--output-schema", schemaPath,
        ]);
        expect(invalid.exitCode, invalid.stderr).toBe(6);
        expect(invalid.stderr).toBe("");
        expect(parseJsonl(invalid.stdout).at(-1)).toMatchObject({
          type: "run.failed",
          payload: { error: { code: "output_schema_invalid" } },
        });
      });
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("passes bounded coding-run controls through the built CLI", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-controls-binary-"));
    const cwd = path.join(stateDir, "workspace");
    await fs.promises.mkdir(cwd);
    let observedLaunchSpec: Record<string, unknown> | undefined;
    const agent: BelldandyAgent = {
      async *run(input) {
        observedLaunchSpec = input.meta?._agentLaunchSpec as Record<string, unknown> | undefined;
        yield { type: "final", text: "done" };
      },
    };
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
    });

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(server.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        const result = await runBdd([
          "agent", "run",
          "--jsonl",
          "--prompt", "apply bounded controls",
          "--state-dir", stateDir,
          "--cwd", cwd,
          "--tool-allow", "file_read,run_command",
          "--tool-deny", "run_command",
          "--permission-mode", "confirm",
          "--timeout", "5000",
          "--max-turns", "3",
          "--max-tokens", "1200",
        ]);
        expect(result.exitCode, result.stderr).toBe(0);
      });

      expect(observedLaunchSpec).toEqual({
        commandSandbox: "required",
        cwd,
        isolationMode: "cwd",
        toolSet: ["file_read", "run_command"],
        toolDeny: ["run_command"],
        permissionMode: "confirm",
        maxRunWallTimeMs: 5000,
        toolLoopIterationBudget: 3,
        maxTotalTokens: 1200,
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

async function runBdd(args: string[], stdin = ""): Promise<ChildResult> {
  return await runNode(builtBddPath, args, packageRoot, stdin);
}

async function runNode(entryPath: string, args: string[], cwd: string, stdin = ""): Promise<ChildResult> {
  return await new Promise<ChildResult>((resolve, reject) => {
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
