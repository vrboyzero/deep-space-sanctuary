import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ToolEnabledAgent, type AgentRunPromptOverride, type BelldandyAgent } from "@belldandy/agent";
import { CODING_RUN_CAPABILITIES, isAgentRunEventV1 } from "../../../coding-run/contracts.js";
import { startGatewayServer } from "../../../server.js";
import { cleanupGlobalMemoryManagersForTest, resolveWebRoot, withEnv } from "../../../server-testkit.js";
import {
  resolveAgentRunCliOptions,
  resolveAgentRunCwd,
  resolveAgentRunPrompt,
  runAgentRunCommand,
} from "./run.js";

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
      automationProfile: "bare",
      toolArgumentPolicy: "bounded-navigation-v1",
      modelLoopBudgetPolicy: "cost-containment-v1",
      maxTurns: "3",
      maxTokens: "1200",
      maxCostUsd: "0.25",
      requireCapability: "journal,trace,journal",
      requireTool: "file_read,file_read",
      requireMcpServer: "repo-index",
      requirePlugin: "review-plugin",
      requireSkill: "review",
    })).toEqual({
      ok: true,
      timeoutMs: 5000,
      codingRun: {
        cwd: path.resolve("packages/belldandy-core"),
        toolAllow: ["file_read", "run_command"],
        toolDeny: ["run_command"],
        permissionMode: "acceptEdits",
        automationProfile: "bare",
        toolArgumentPolicy: "bounded-navigation-v1",
        modelLoopBudgetPolicy: "cost-containment-v1",
        maxWallTimeMs: 5000,
        maxTurns: 3,
        maxTokens: 1200,
        maxCostUsd: 0.25,
        requiredCapabilities: {
          schemaVersion: 1,
          capabilities: ["journal", "trace"],
          tools: ["file_read"],
          mcpServers: ["repo-index"],
          plugins: ["review-plugin"],
          skills: ["review"],
        },
      },
    });
    expect(resolveAgentRunCliOptions({ permissionMode: "bypassPermissions" })).toMatchObject({
      ok: false,
      message: expect.stringContaining("permission-mode"),
    });
    expect(resolveAgentRunCliOptions({ automationProfile: "resident" })).toMatchObject({
      ok: false,
      message: expect.stringContaining("automation-profile"),
    });
    expect(resolveAgentRunCliOptions({ toolArgumentPolicy: "unknown" })).toMatchObject({
      ok: false,
      message: expect.stringContaining("tool-argument-policy"),
    });
    expect(resolveAgentRunCliOptions({ modelLoopBudgetPolicy: "unknown" })).toMatchObject({
      ok: false,
      message: expect.stringContaining("model-loop-budget-policy"),
    });
    expect(resolveAgentRunCliOptions({ requireCapability: "tools" })).toMatchObject({
      ok: false,
      message: expect.stringContaining("tools"),
    });
  });

  it("preserves cross-platform absolute cwd values for a remote Gateway", () => {
    const gatewayWorkspace = "\\\\wsl.localhost\\Ubuntu-22.04\\var\\tmp\\coding-agent-fixtures\\run-1\\workspace";

    expect(resolveAgentRunCwd(gatewayWorkspace, path.posix)).toBe(gatewayWorkspace);
    expect(resolveAgentRunCliOptions({ cwd: gatewayWorkspace })).toEqual({
      ok: true,
      codingRun: { cwd: gatewayWorkspace },
    });
    expect(resolveAgentRunCliOptions({ cwd: "fixtures/run-1/workspace" })).toEqual({
      ok: true,
      codingRun: { cwd: path.resolve("fixtures/run-1/workspace") },
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
      expect(events[0]).toMatchObject({ payload: { capabilities: CODING_RUN_CAPABILITIES } });
      expect(events.at(-1)).toMatchObject({
        payload: { usage: { status: "incomplete", reason: "usage_not_reported" } },
      });
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
            toolArgumentPolicy: "bounded-navigation-v1",
            modelLoopBudgetPolicy: "cost-containment-v1",
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
        toolArgumentPolicy: "bounded-navigation-v1",
        modelLoopBudgetPolicy: "cost-containment-v1",
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

  it("projects a bare run without prior history, project rules, or commander deltas", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-bare-profile-"));
    const cwd = path.join(stateDir, "workspace");
    const conversationId = "bare-profile-conversation";
    const observedInputs: Parameters<BelldandyAgent["run"]>[0][] = [];
    const agent: BelldandyAgent = {
      async *run(input) {
        observedInputs.push(input);
        yield { type: "final", text: "done" };
      },
    };

    try {
      await fs.promises.mkdir(path.join(cwd, ".git"), { recursive: true });
      await fs.promises.writeFile(path.join(cwd, "AGENTS.md"), "implicit-project-rule\n", "utf-8");
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
            conversationId,
            prompt: "remember this prior turn",
            jsonl: true,
            writeStdout: () => {},
            writeStderr: () => {},
          })).toBe(0);
          expect(await runAgentRunCommand({
            stateDir,
            conversationId,
            prompt: "parallel review the project",
            jsonl: true,
            codingRun: {
              cwd,
              automationProfile: "bare",
              toolAllow: ["file_read"],
              toolDeny: ["run_command"],
              permissionMode: "plan",
              maxTurns: 2,
              maxTokens: 800,
            },
            writeStdout: () => {},
            writeStderr: () => {},
          })).toBe(0);
        });
      } finally {
        await server.close();
      }

      expect(observedInputs).toHaveLength(2);
      const bareInput = observedInputs[1];
      expect(bareInput.automationProfile).toBe("bare");
      expect(bareInput.history).toEqual([]);
      expect(bareInput.meta?.promptDeltas).toBeUndefined();
      expect(bareInput.promptOverride).toMatchObject({
        metadata: {
          codingRunPromptMode: "bounded-coding-run-v1",
          automationProfile: "bare",
        },
      });
      expect(bareInput.promptOverride?.text).not.toContain("AGENTS.md");
      expect(bareInput.meta?._agentLaunchSpec).toMatchObject({
        cwd,
        commandSandbox: "required",
        toolSet: ["file_read"],
        toolDeny: ["run_command"],
        permissionMode: "plan",
        toolLoopIterationBudget: 2,
        maxTotalTokens: 800,
      });
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

  it("preserves an Agent structured-output failure code and original output through Gateway", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-schema-runtime-failure-"));
    const agent: BelldandyAgent = {
      async *run() {
        yield { type: "final", text: "runtime-original-invalid" };
        yield {
          type: "status",
          status: "error",
          code: "output_schema_invalid",
          error: "Final output is not valid JSON.",
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
        expect(await runAgentRunCommand({
          stateDir,
          prompt: "return JSON",
          jsonl: true,
          outputSchema: { type: "object" },
          writeStdout: (text) => stdout.push(text),
          writeStderr: () => {},
        })).toBe(6);
      });

      const events = stdout.join("").trim().split("\n").map((line) => JSON.parse(line) as {
        type: string;
        payload: { error?: { code?: string; message?: string }; output?: { text?: string } };
      });
      expect(events.at(-1)).toMatchObject({
        type: "run.failed",
        payload: {
          error: {
            code: "output_schema_invalid",
            message: "Final output is not valid JSON.",
          },
          output: { text: "runtime-original-invalid" },
        },
      });
      expect(events.some((event) => event.type === "run.completed")).toBe(false);
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
    let observedStructuredOutput: Parameters<BelldandyAgent["run"]>[0]["structuredOutput"];
    const agent: BelldandyAgent = {
      async *run(input) {
        observedPrompt = input.text;
        observedStructuredOutput = input.structuredOutput;
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
      expect(observedStructuredOutput?.schema).toMatchObject({
        required: ["symbol", "sourcePath", "lineHint"],
        properties: {
          lineHint: { const: 97 },
        },
      });
      expect(observedStructuredOutput?.validateOutput(JSON.stringify({
        symbol: "lateSegmentAnchor",
        sourcePath: "src/segments/segment-071.mjs",
        lineHint: 97,
      }))).toEqual({
        ok: true,
        outputText: '{"symbol":"lateSegmentAnchor","sourcePath":"src/segments/segment-071.mjs","lineHint":97}',
      });
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("repairs one structured output through the real Agent, Gateway, and CLI path", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-schema-integration-"));
    const providerPayloads: Array<Record<string, unknown>> = [];
    const providerResponses = [
      {
        choices: [{ message: { content: "not-json" } }],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      },
      {
        choices: [{ message: { content: '{"summary":"repaired"}' } }],
        usage: { prompt_tokens: 4, completion_tokens: 3 },
      },
    ];
    const provider = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        providerPayloads.push(JSON.parse(Buffer.concat(chunks).toString("utf-8")) as Record<string, unknown>);
        const payload = providerResponses.shift();
        response.writeHead(payload ? 200 : 500, { "content-type": "application/json" });
        response.end(JSON.stringify(payload ?? { error: { message: "unexpected model call" } }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      provider.once("listening", resolve);
      provider.once("error", reject);
      provider.listen(0, "127.0.0.1");
    });
    const providerAddress = provider.address();
    if (!providerAddress || typeof providerAddress === "string") throw new Error("Provider did not expose a port.");
    const execute = vi.fn();
    const toolExecutor = {
      getDefinitions: () => [{
        type: "function" as const,
        function: {
          name: "mutate_workspace",
          description: "Mutates the workspace",
          parameters: { type: "object" },
        },
      }],
      getRegisteredToolContract: () => undefined,
      consumeLoadedDeferredToolsForNextTurn: async () => [],
      setTokenCounter: () => {},
      clearTokenCounter: () => {},
      releaseConversation: () => {},
      execute,
    } as any;
    const agent = new ToolEnabledAgent({
      baseUrl: `http://127.0.0.1:${providerAddress.port}/v1`,
      apiKey: "test-key",
      model: "test-model",
      toolExecutor,
      streamingEnabled: true,
    });
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
          prompt: "return JSON",
          jsonl: true,
          outputSchema: {
            type: "object",
            required: ["summary"],
            properties: { summary: { const: "repaired" } },
            additionalProperties: false,
          },
          writeStdout: (text) => stdout.push(text),
          writeStderr: () => {},
        })).toBe(0);
      });

      expect(providerPayloads).toHaveLength(2);
      expect(providerPayloads[0]?.tools).toHaveLength(1);
      expect(providerPayloads[1]?.tools).toBeUndefined();
      expect(execute).not.toHaveBeenCalled();
      const events = stdout.join("").trim().split("\n").map((line) => JSON.parse(line) as {
        type: string;
        payload: Record<string, any>;
      });
      expect(events.filter((event) => event.type === "message.delta")
        .map((event) => String(event.payload.delta ?? "")).join(""))
        .toBe('{"summary":"repaired"}');
      expect(JSON.stringify(events)).not.toContain("not-json");
      expect(events.find((event) => event.type === "run.usage")).toMatchObject({
        payload: {
          usage: {
            input: 7,
            output: 5,
            modelCalls: 2,
            providerReportedModelCalls: 2,
            completeness: {
              status: "complete",
              reason: "provider_reported_all_model_calls",
            },
          },
        },
      });
      expect(events.at(-1)).toMatchObject({
        type: "run.completed",
        payload: {
          output: { text: '{"summary":"repaired"}' },
          usage: {
            status: "complete",
            reason: "provider_reported_all_model_calls",
            modelCalls: 2,
            providerReportedModelCalls: 2,
          },
        },
      });
    } finally {
      await server.close();
      await new Promise<void>((resolve) => provider.close(() => resolve()));
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
