import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AgentRunPromptOverride, BelldandyAgent } from "@belldandy/agent";
import { isAgentRunEventV1 } from "../../../coding-run/contracts.js";
import { startGatewayServer } from "../../../server.js";
import { cleanupGlobalMemoryManagersForTest, resolveWebRoot, withEnv } from "../../../server-testkit.js";
import { resolveAgentRunCliOptions, resolveAgentRunPrompt, runAgentRunCommand } from "./run.js";

afterEach(async () => {
  await cleanupGlobalMemoryManagersForTest();
});

describe("bdd agent run", () => {
  it("uses --prompt before stdin and accepts piped prompt text", async () => {
    const direct = await resolveAgentRunPrompt({
      prompt: "direct prompt",
      stdinIsTTY: false,
      readStdin: async () => "ignored stdin",
    });
    expect(direct).toEqual({ ok: true, prompt: "direct prompt" });

    const piped = await resolveAgentRunPrompt({
      stdinIsTTY: false,
      readStdin: async () => "  piped prompt\n",
    });
    expect(piped).toEqual({ ok: true, prompt: "piped prompt" });
  });

  it("does not read an interactive stdin stream without --prompt", async () => {
    const result = await resolveAgentRunPrompt({
      stdinIsTTY: true,
      readStdin: async () => {
        throw new Error("stdin must not be read");
      },
    });

    expect(result).toMatchObject({ ok: false });
  });

  it("normalizes bounded coding-run CLI options before sending them to Gateway", () => {
    expect(resolveAgentRunCliOptions({
      timeout: "5000",
      cwd: "packages/belldandy-core",
      toolAllow: "file_read,run_command,file_read",
      toolDeny: "run_command",
      permissionMode: "accept-edits",
      maxTurns: "3",
      maxTokens: "1200",
      maxCostUsd: "0.25",
    })).toEqual({
      ok: true,
      timeoutMs: 5000,
      codingRun: {
        cwd: path.resolve("packages/belldandy-core"),
        toolAllow: ["file_read", "run_command"],
        toolDeny: ["run_command"],
        permissionMode: "acceptEdits",
        maxWallTimeMs: 5000,
        maxTurns: 3,
        maxTokens: 1200,
        maxCostUsd: 0.25,
      },
    });
    expect(resolveAgentRunCliOptions({ permissionMode: "bypassPermissions" })).toMatchObject({
      ok: false,
      message: expect.stringContaining("permission-mode"),
    });
  });

  it("writes only independently valid v1 JSONL events to stdout", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-cli-"));
    const agent: BelldandyAgent = {
      async *run(input) {
        yield { type: "status", status: "running" };
        yield { type: "delta", delta: `echo:${input.text}` };
        yield { type: "final", text: `echo:${input.text}` };
        yield { type: "status", status: "done" };
      },
    };
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
    });
    const stdout: string[] = [];
    const stderr: string[] = [];

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(server.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        const exitCode = await runAgentRunCommand({
          stateDir,
          prompt: "hello",
          jsonl: true,
          writeStdout: (text) => stdout.push(text),
          writeStderr: (text) => stderr.push(text),
        });

        expect(exitCode).toBe(0);
      });

      const lines = stdout.join("").trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(6);
      const events = lines.map((line) => JSON.parse(line) as unknown);
      expect(events.every(isAgentRunEventV1)).toBe(true);
      expect(events.map((event) => (event as { type: string }).type)).toEqual([
        "run.started",
        "run.status",
        "message.delta",
        "run.status",
        "run.status",
        "run.completed",
      ]);
      expect(stderr).toEqual([]);
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("projects coding-run restrictions into the Agent launch spec", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-coding-run-"));
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
        expect(await runAgentRunCommand({
          stateDir,
          prompt: "run with controls",
          jsonl: true,
          timeoutMs: 5_000,
          codingRun: {
            cwd,
            toolAllow: ["file_read", "run_command"],
            toolDeny: ["run_command"],
            permissionMode: "confirm",
            maxWallTimeMs: 5_000,
            maxTurns: 3,
            maxTokens: 1200,
          },
          writeStdout: () => {},
          writeStderr: () => {},
        })).toBe(0);
      });

      expect(observedLaunchSpec).toEqual({
        cwd,
        isolationMode: "cwd",
        commandSandbox: "required",
        toolSet: ["file_read", "run_command"],
        toolDeny: ["run_command"],
        permissionMode: "confirm",
        maxRunWallTimeMs: 5_000,
        toolLoopIterationBudget: 3,
        maxTotalTokens: 1200,
      });
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("writes a hash-bound change artifact into the headless terminal event", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-change-artifact-"));
    const cwd = path.join(stateDir, "workspace");
    await fs.promises.mkdir(cwd, { recursive: true });
    await fs.promises.writeFile(path.join(cwd, "note.txt"), "before\n", "utf-8");
    const agent: BelldandyAgent = {
      async *run() {
        await fs.promises.writeFile(path.join(cwd, "note.txt"), "after\n", "utf-8");
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
    const stdout: string[] = [];

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(server.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        expect(await runAgentRunCommand({
          stateDir,
          prompt: "change note",
          jsonl: true,
          codingRun: { cwd },
          writeStdout: (text) => stdout.push(text),
          writeStderr: () => {},
        })).toBe(0);
      });

      const terminal = JSON.parse(stdout.join("").trim().split("\n").at(-1) ?? "{}") as {
        type?: string;
        binding?: { agentRunId?: string };
        payload?: { changes?: Record<string, unknown> };
      };
      expect(terminal).toMatchObject({
        type: "run.completed",
        payload: {
          changes: {
            status: "available",
            revisionId: expect.any(String),
            baselineId: expect.any(String),
            snapshotId: expect.any(String),
            changedFileCount: 1,
            baselineHash: expect.stringMatching(/^sha256:/),
            currentHash: expect.stringMatching(/^sha256:/),
            diffHash: expect.stringMatching(/^sha256:/),
            recoveryGuarantee: "detect_only",
            recoveryReason: "checkpoint_missing",
            artifactPath: expect.any(String),
            patchPath: expect.any(String),
          },
        },
      });
      expect(terminal.payload?.changes?.revisionId).toBe(terminal.binding?.agentRunId);
      await expect(fs.promises.readFile(String(terminal.payload?.changes?.artifactPath), "utf-8"))
        .resolves.toContain(String(terminal.payload?.changes?.revisionId));
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("injects cwd project rules into one coding run without mixing state identity rules", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-project-rules-"));
    const workspaceRoot = path.join(stateDir, "workspace");
    const packageDir = path.join(workspaceRoot, "packages", "core");
    const cwd = path.join(packageDir, "src");
    let observedPromptDeltas: Array<Record<string, unknown>> | undefined;
    let observedPromptOverride: AgentRunPromptOverride | undefined;
    const agent: BelldandyAgent = {
      async *run(input) {
        observedPromptDeltas = input.meta?.promptDeltas as Array<Record<string, unknown>> | undefined;
        observedPromptOverride = input.promptOverride;
        yield { type: "final", text: "done" };
      },
    };

    try {
      await fs.promises.mkdir(path.join(workspaceRoot, ".git"), { recursive: true });
      await fs.promises.mkdir(cwd, { recursive: true });
      await fs.promises.writeFile(path.join(stateDir, "AGENTS.md"), "identity-only-rule\n", "utf-8");
      await fs.promises.writeFile(path.join(workspaceRoot, "AGENTS.md"), "root-project-rule\n", "utf-8");
      await fs.promises.writeFile(path.join(packageDir, "AGENTS.md"), "package-project-rule\n", "utf-8");

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
          expect(await runAgentRunCommand({
            stateDir,
            prompt: "follow project rules",
            jsonl: true,
            timeoutMs: 5_000,
            codingRun: { cwd },
            writeStdout: () => {},
            writeStderr: () => {},
          })).toBe(0);
        });
      } finally {
        await server.close();
      }

      const projectRulesDelta = observedPromptDeltas?.find((delta) => delta.deltaType === "project-rules");
      expect(projectRulesDelta).toMatchObject({
        role: "system",
        source: "project-rules",
        metadata: {
          cwd: await fs.promises.realpath(cwd),
          root: await fs.promises.realpath(workspaceRoot),
          rootSource: "git",
          sourceCount: 2,
        },
      });
      const deltaText = String(projectRulesDelta?.text ?? "");
      expect(deltaText.indexOf("root-project-rule")).toBeLessThan(deltaText.indexOf("package-project-rule"));
      expect(deltaText).not.toContain("identity-only-rule");
      expect(observedPromptOverride).toMatchObject({
        text: expect.stringContaining("# Bounded Coding Run"),
        metadata: {
          codingRunPromptMode: "bounded-coding-run-v1",
        },
      });
      expect(observedPromptOverride?.text).not.toContain("identity-only-rule");
    } finally {
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("fails before starting when the selected Agent cannot enforce maxCostUsd", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-cost-capability-"));
    const agent: BelldandyAgent = {
      async *run() {
        yield { type: "final", text: "unexpected" };
      },
    };
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
    });
    const stderr: string[] = [];

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(server.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        expect(await runAgentRunCommand({
          stateDir,
          prompt: "cost limited",
          jsonl: true,
          codingRun: { maxCostUsd: 0.25 },
          writeStdout: () => {},
          writeStderr: (text) => stderr.push(text),
        })).toBe(4);
      });
      expect(stderr.join("")).toContain("cannot enforce maxCostUsd");
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("reports an empty prompt through stderr with the stable input exit code", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runAgentRunCommand({
      stateDir: path.join(os.tmpdir(), "belldandy-agent-cli-empty"),
      prompt: "   ",
      jsonl: true,
      writeStdout: (text) => stdout.push(text),
      writeStderr: (text) => stderr.push(text),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("non-empty prompt");
  });

  it("replaces a completed terminal event when final output fails the requested schema", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-schema-"));
    const agent: BelldandyAgent = {
      async *run() {
        yield { type: "final", text: JSON.stringify({ answer: "not the required shape" }) };
      },
    };
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
    });
    const stdout: string[] = [];
    const stderr: string[] = [];

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(server.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        const exitCode = await runAgentRunCommand({
          stateDir,
          prompt: "return JSON",
          jsonl: true,
          outputSchema: {
            type: "object",
            required: ["summary"],
            properties: { summary: { type: "string" } },
            additionalProperties: false,
          },
          writeStdout: (text) => stdout.push(text),
          writeStderr: (text) => stderr.push(text),
        });

        expect(exitCode).toBe(6);
      });

      const events = stdout.join("").trim().split("\n").map((line) => JSON.parse(line) as {
        type: string;
        payload: { error?: { code?: string } };
      });
      expect(events.at(-1)).toMatchObject({
        type: "run.failed",
        payload: { error: { code: "output_schema_invalid" } },
      });
      expect(events.some((event) => event.type === "run.completed")).toBe(false);
      expect(stderr).toEqual([]);
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("normalizes one fenced JSON result before emitting a schema-validated terminal event", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-schema-fence-"));
    const agent: BelldandyAgent = {
      async *run() {
        yield {
          type: "final",
          text: [
            "The requested result is below.",
            "",
            "```json",
            '{"summary":"valid"}',
            "```",
          ].join("\n"),
        };
      },
    };
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
    });
    const stdout: string[] = [];

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(server.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        const exitCode = await runAgentRunCommand({
          stateDir,
          prompt: "return JSON",
          jsonl: true,
          outputSchema: {
            type: "object",
            required: ["summary"],
            properties: { summary: { const: "valid" } },
            additionalProperties: false,
          },
          writeStdout: (text) => stdout.push(text),
          writeStderr: () => {},
        });

        expect(exitCode).toBe(0);
      });

      const events = stdout.join("").trim().split("\n").map((line) => JSON.parse(line) as {
        type: string;
        payload: { output?: { text?: string } };
      });
      expect(events.at(-1)).toMatchObject({
        type: "run.completed",
        payload: { output: { text: '{"summary":"valid"}' } },
      });
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("sends an exact output schema contract to the Agent before validating its final JSON", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-schema-contract-"));
    let observedPrompt = "";
    const agent: BelldandyAgent = {
      async *run(input) {
        observedPrompt = input.text;
        yield {
          type: "final",
          text: JSON.stringify({
            symbol: "lateSegmentAnchor",
            sourcePath: "src/segments/segment-071.mjs",
            lineHint: 97,
          }),
        };
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
        expect(await runAgentRunCommand({
          stateDir,
          prompt: "Locate lateSegmentAnchor and return the requested JSON.",
          jsonl: true,
          codingRun: { cwd: stateDir },
          outputSchema: {
            type: "object",
            required: ["symbol", "sourcePath", "lineHint"],
            additionalProperties: false,
            properties: {
              symbol: { const: "lateSegmentAnchor" },
              sourcePath: { const: "src/segments/segment-071.mjs" },
              lineHint: { const: 97 },
            },
          },
          writeStdout: () => {},
          writeStderr: () => {},
        })).toBe(0);
      });

      expect(observedPrompt).toContain("## Output Schema Contract");
      expect(observedPrompt).toContain('"lineHint":{"const":97}');
      expect(observedPrompt).toContain("Return only raw JSON that validates against this schema.");
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
