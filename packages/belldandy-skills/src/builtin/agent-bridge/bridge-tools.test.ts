import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ToolContext } from "../../types.js";
import { loadBridgeConfig } from "./config.js";
import { bridgeTargetListTool } from "./tool-bridge-targets.js";
import { bridgeTargetDiagnoseTool } from "./tool-bridge-diagnose.js";
import { bridgeRunTool } from "./tool-bridge-run.js";

describe("agent bridge P0 tools", () => {
  let tempDir: string;
  let baseContext: ToolContext;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-bridge-"));
    baseContext = {
      conversationId: "test-conv",
      workspaceRoot: tempDir,
      policy: {
        allowedPaths: [],
        deniedPaths: [],
        allowedDomains: [],
        deniedDomains: [],
        maxTimeoutMs: 10_000,
        maxResponseBytes: 4_096,
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
      },
    };
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function writeBridgeConfig(): Promise<void> {
    const config = {
      version: "1.0.0",
      targets: [
        {
          id: "node-inline",
          category: "agent-cli",
          transport: "exec",
          enabled: true,
          entry: { binary: "node" },
          cwdPolicy: "workspace-only",
          sessionMode: "oneshot",
          defaultTimeoutMs: 5_000,
          maxOutputBytes: 4_096,
          actions: {
            inline: {
              template: ["-e"],
              allowStructuredArgs: ["script"],
            },
            guided: {
              template: ["-e"],
              allowStructuredArgs: ["script", "prompt"],
              firstTurnStrategy: "start-args-prompt",
              firstTurnHint: "首回合建议随 start 提交 prompt。",
              recommendedReadWaitMs: 8000,
            },
          },
        },
        {
          id: "codex-mcp",
          category: "mcp",
          transport: "mcp",
          enabled: true,
          entry: {
            mcp: {
              serverId: "codex",
              toolName: "task_once",
            },
          },
          cwdPolicy: "workspace-only",
          sessionMode: "oneshot",
          defaultTimeoutMs: 5_000,
          maxOutputBytes: 4_096,
          actions: {
            analyze: {
              allowStructuredArgs: ["objective", "scope", "constraints", "expectedOutput", "cwd"],
              description: "通过 MCP 包装的一次性 codex 只读分析",
              mcpToolName: "analyze_once",
            },
            review: {
              allowStructuredArgs: ["objective", "scope", "constraints", "expectedOutput", "cwd"],
              description: "通过 MCP 包装的一次性 codex 代码审查",
              mcpToolName: "review_once",
            },
            patch: {
              allowStructuredArgs: ["objective", "scope", "constraints", "expectedOutput", "cwd"],
              description: "通过 MCP 包装的一次性 codex 小范围改动",
              mcpToolName: "patch_once",
            },
            exec: {
              allowStructuredArgs: ["mode", "objective", "scope", "constraints", "expectedOutput", "cwd"],
              description: "通过 MCP 包装的一次性 codex 执行（兼容入口）",
              mcpToolName: "task_once",
            },
          },
        },
        {
          id: "codex-mcp_cli",
          category: "agent-cli",
          transport: "exec",
          enabled: true,
          entry: { binary: "codex" },
          cwdPolicy: "workspace-only",
          sessionMode: "oneshot",
          defaultTimeoutMs: 5_000,
          maxOutputBytes: 4_096,
          actions: {
            exec: {
              template: ["exec", "--sandbox", "workspace-write"],
              allowStructuredArgs: ["prompt"],
            },
          },
        },
      ],
    };
    await fs.writeFile(path.join(tempDir, "agent-bridge.json"), JSON.stringify(config, null, 2), "utf-8");
  }

  it("loads bridge config files with UTF-8 BOM", async () => {
    const config = {
      version: "1.0.0",
      targets: [
        {
          id: "node-inline",
          category: "agent-cli",
          transport: "exec",
          enabled: true,
          entry: { binary: "node" },
          cwdPolicy: "workspace-only",
          sessionMode: "oneshot",
          actions: {
            inline: {
              template: ["-e"],
              allowStructuredArgs: ["script"],
            },
          },
        },
      ],
    };
    await fs.writeFile(
      path.join(tempDir, "agent-bridge.json"),
      `\uFEFF${JSON.stringify(config, null, 2)}`,
      "utf-8",
    );

    await expect(loadBridgeConfig(baseContext)).resolves.toMatchObject({
      version: "1.0.0",
      targets: [
        {
          id: "node-inline",
          transport: "exec",
          actions: {
            inline: {
              template: ["-e"],
              allowStructuredArgs: ["script"],
            },
          },
        },
      ],
    });
  });

  it("lists configured bridge targets", async () => {
    await writeBridgeConfig();

    const result = await bridgeTargetListTool.execute({}, baseContext);

    expect(result.success).toBe(true);
    const payload = JSON.parse(result.output) as {
      targets: Array<{
        id: string;
        transport: string;
        actions: Array<{
          name: string;
          firstTurnStrategy?: string;
          firstTurnHint?: string;
          recommendedReadWaitMs?: number;
        }>;
      }>;
    };
    expect(payload.targets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "node-inline",
        transport: "exec",
      }),
      expect.objectContaining({
        id: "codex-mcp",
        transport: "mcp",
      }),
      expect.objectContaining({
        id: "codex-mcp_cli",
        transport: "exec",
      }),
    ]));
    expect(payload.targets[0]).toMatchObject({
      id: "node-inline",
      transport: "exec",
    });
    expect(payload.targets[0].actions[0]?.name).toBe("inline");
    expect(payload.targets[0].actions[1]).toMatchObject({
      name: "guided",
      firstTurnStrategy: "start-args-prompt",
      firstTurnHint: "首回合建议随 start 提交 prompt。",
      recommendedReadWaitMs: 8000,
    });
  });

  it("runs a configured exec target and writes artifact summary", async () => {
    await writeBridgeConfig();

    const result = await bridgeRunTool.execute({
      targetId: "node-inline",
      action: "inline",
      args: {
        script: "process.stdout.write('bridge-ok')",
      },
    }, baseContext);

    expect(result.success).toBe(true);
    const payload = JSON.parse(result.output) as {
      stdout: string;
      exitCode: number | null;
      artifactPath: string;
      commandPreview: string;
    };
    expect(payload.stdout).toBe("bridge-ok");
    expect(payload.exitCode).toBe(0);
    expect(payload.commandPreview).toContain("node -e");

    const summaryRaw = await fs.readFile(payload.artifactPath, "utf-8");
    const summary = JSON.parse(summaryRaw) as {
      targetId: string;
      action: string;
      stdout: { path?: string };
    };
    expect(summary.targetId).toBe("node-inline");
    expect(summary.action).toBe("inline");
    expect(summary.stdout.path).toBeTruthy();
  });

  it("rejects structured args not declared by the target action", async () => {
    await writeBridgeConfig();

    const result = await bridgeRunTool.execute({
      targetId: "node-inline",
      action: "inline",
      args: {
        unsafe: "--inspect",
      },
    }, baseContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("不允许结构化参数");
  });

  it("renders structured prompt into template placeholders instead of appending it positionally", async () => {
    const config = {
      version: "1.0.0",
      targets: [
        {
          id: "claude-session-like",
          category: "agent-cli",
          transport: "exec",
          enabled: true,
          entry: { binary: "claude" },
          cwdPolicy: "workspace-only",
          sessionMode: "oneshot",
          actions: {
            interactive: {
              template: ["--dangerously-skip-permissions", "-p", "{{prompt}}"],
              allowStructuredArgs: ["prompt"],
            },
          },
        },
      ],
    };
    await fs.writeFile(path.join(tempDir, "agent-bridge.json"), JSON.stringify(config, null, 2), "utf-8");

    const result = await bridgeRunTool.execute({
      targetId: "claude-session-like",
      action: "interactive",
      args: {
        prompt: "inspect the startup chain",
      },
    }, baseContext);

    expect(result.success).toBe(false);
    expect(result.output).toContain("\"commandPreview\": \"claude --dangerously-skip-permissions -p \\\"inspect the startup chain\\\"\"");
  });

  it("rejects cwd outside the allowed workspace scope", async () => {
    await writeBridgeConfig();

    const result = await bridgeRunTool.execute({
      targetId: "node-inline",
      action: "inline",
      cwd: "../outside",
      args: {
        script: "process.stdout.write('bridge-ok')",
      },
    }, baseContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("越界");
  });

  it("runs a configured mcp target via injected MCP runtime capability", async () => {
    await writeBridgeConfig();
    const callTool = vi.fn(async () => ({
      result: "mcp-ok",
      source: "codex-wrapper",
    }));
    baseContext.mcp = { callTool };
    baseContext.launchSpec = {
      parentTaskId: "task-bridge-1",
      bridgeSubtask: {
        kind: "analyze",
        goalId: "goal-123",
        goalNodeId: "node-456",
        summary: "只读分析当前 bridge 行为",
      },
    };

    const result = await bridgeRunTool.execute({
      targetId: "codex-mcp",
      action: "analyze",
      cwd: ".",
      args: {
        objective: "Summarize this project.",
        scope: ["."],
      },
    }, baseContext);

    expect(result.success).toBe(true);
    expect(callTool).toHaveBeenCalledWith({
      serverId: "codex",
      toolName: "analyze_once",
      arguments: {
        objective: "Summarize this project.",
        scope: ["."],
        cwd: tempDir,
      },
    });

    const payload = JSON.parse(result.output) as {
      transport: string;
      bridgeSubtask: {
        kind: string;
        targetId: string;
        action: string;
        goalId?: string;
        goalNodeId?: string;
      };
      serverId: string;
      toolName: string;
      stdout: string;
      artifactPath: string;
      commandPreview: string;
    };
    expect(payload.transport).toBe("mcp");
    expect(payload.bridgeSubtask).toEqual({
      kind: "analyze",
      targetId: "codex-mcp",
      action: "analyze",
      goalId: "goal-123",
      goalNodeId: "node-456",
      summary: "只读分析当前 bridge 行为",
    });
    expect(payload.serverId).toBe("codex");
    expect(payload.toolName).toBe("analyze_once");
    expect(payload.stdout).toContain("mcp-ok");
    expect(payload.commandPreview).toContain("mcp:codex/analyze_once");

    const summaryRaw = await fs.readFile(payload.artifactPath, "utf-8");
    const summary = JSON.parse(summaryRaw) as {
      targetId: string;
      action: string;
      commandPreview: string;
      bridgeSubtask?: {
        kind: string;
        targetId: string;
        action: string;
        goalId?: string;
        goalNodeId?: string;
      };
    };
    expect(summary.targetId).toBe("codex-mcp");
    expect(summary.action).toBe("analyze");
    expect(summary.commandPreview).toContain("mcp:codex/analyze_once");
    expect(summary.bridgeSubtask).toMatchObject({
      kind: "analyze",
      targetId: "codex-mcp",
      action: "analyze",
      goalId: "goal-123",
      goalNodeId: "node-456",
    });
  });

  it("returns fallback guidance when an mcp bridge_run fails and a cli fallback target exists", async () => {
    await writeBridgeConfig();
    baseContext.launchSpec = {
      bridgeSubtask: {
        kind: "analyze",
        summary: "MCP 失败时回退 CLI",
      },
    };
    baseContext.mcp = {
      callTool: vi.fn(async () => {
        throw new Error("MCP 工具调用失败: codex/analyze_once");
      }),
    };

    const result = await bridgeRunTool.execute({
      targetId: "codex-mcp",
      action: "analyze",
      args: {
        objective: "Summarize this project.",
      },
    }, baseContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("建议回退 bridge target \"codex-mcp_cli\"");
    const payload = JSON.parse(result.output) as {
      transport: string;
      bridgeSubtask?: {
        kind: string;
        action: string;
        targetId: string;
      };
      recommendation: {
        nextStep: string;
        fallbackTargetId: string;
      };
    };
    expect(payload.transport).toBe("mcp");
    expect(payload.bridgeSubtask).toMatchObject({
      kind: "analyze",
      action: "analyze",
      targetId: "codex-mcp",
    });
    expect(payload.recommendation.fallbackTargetId).toBe("codex-mcp_cli");
    expect(payload.recommendation.nextStep).toContain("回退");
  });

  it("suggests bridge_target_diagnose when an mcp bridge_run fails without a cli fallback target", async () => {
    const config = {
      version: "1.0.0",
      targets: [
        {
          id: "codex-mcp",
          category: "mcp",
          transport: "mcp",
          enabled: true,
          entry: {
            mcp: {
              serverId: "codex",
              toolName: "task_once",
            },
          },
          cwdPolicy: "workspace-only",
          sessionMode: "oneshot",
          defaultTimeoutMs: 5_000,
          maxOutputBytes: 4_096,
          actions: {
            analyze: {
              allowStructuredArgs: ["objective"],
              mcpToolName: "analyze_once",
            },
          },
        },
      ],
    };
    await fs.writeFile(path.join(tempDir, "agent-bridge.json"), JSON.stringify(config, null, 2), "utf-8");
    baseContext.mcp = {
      callTool: vi.fn(async () => {
        throw new Error("MCP runtime 未初始化。");
      }),
    };

    const result = await bridgeRunTool.execute({
      targetId: "codex-mcp",
      action: "analyze",
      args: {
        objective: "Summarize this project.",
      },
    }, baseContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("bridge_target_diagnose");
    const payload = JSON.parse(result.output) as {
      recommendation: {
        nextStep: string;
        fallbackTargetId?: string;
      };
    };
    expect(payload.recommendation.fallbackTargetId).toBeUndefined();
    expect(payload.recommendation.nextStep).toContain("bridge_target_diagnose");
  });

  it("diagnoses a ready mcp bridge target with server and tool visibility", async () => {
    await writeBridgeConfig();
    baseContext.mcp = {
      callTool: vi.fn(),
      getDiagnostics: vi.fn(() => ({
        initialized: true,
        toolCount: 1,
        serverCount: 1,
        connectedCount: 1,
        servers: [
          {
            id: "codex",
            name: "codex",
            status: "connected",
            toolCount: 1,
            resourceCount: 0,
          },
        ],
        tools: [
          {
            serverId: "codex",
            toolName: "analyze_once",
            bridgedName: "mcp_codex_analyze_once",
          },
        ],
      })),
    };

    const result = await bridgeTargetDiagnoseTool.execute({
      targetId: "codex-mcp",
      action: "analyze",
    }, baseContext);

    expect(result.success).toBe(true);
    const payload = JSON.parse(result.output) as {
      available: boolean;
      status: string;
      recommendation: { nextStep: string };
      checks: Array<{ id: string; status: string }>;
    };
    expect(payload.available).toBe(true);
    expect(payload.status).toBe("ready");
    expect(payload.recommendation.nextStep).toContain("可直接使用");
    expect(payload.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "mcp-server", status: "pass" }),
      expect.objectContaining({ id: "mcp-tool", status: "pass" }),
    ]));
  });

  it("diagnoses missing MCP runtime and suggests fixing runtime first", async () => {
    await writeBridgeConfig();

    const result = await bridgeTargetDiagnoseTool.execute({
      targetId: "codex-mcp",
      action: "analyze",
    }, baseContext);

    expect(result.success).toBe(true);
    const payload = JSON.parse(result.output) as {
      available: boolean;
      status: string;
      recommendation: { nextStep: string };
      checks: Array<{ id: string; status: string }>;
    };
    expect(payload.available).toBe(false);
    expect(payload.status).toBe("unavailable");
    expect(payload.recommendation.nextStep).toContain("BELLDANDY_MCP_ENABLED=true");
    expect(payload.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "mcp-runtime", status: "fail" }),
    ]));
  });
});
