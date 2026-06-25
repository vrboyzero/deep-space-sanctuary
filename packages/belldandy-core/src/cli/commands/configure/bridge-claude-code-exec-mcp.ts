import fs from "node:fs/promises";
import path from "node:path";

import { defineCommand } from "citty";

import { createCLIContext } from "../../shared/context.js";
import {
  buildCompatibleMcpOutput,
  readCompatibleMcpConfig,
  type CompatibleMcpConfig,
  type CompatibleMcpServerConfig,
  writeJsonFile,
} from "./mcp-config-compat.js";

const MCP_CONFIG_FILE_NAME = "mcp.json";
const BRIDGE_CONFIG_FILE_NAME = "agent-bridge.json";
const DEFAULT_VERSION = "1.0.0";
const DEFAULT_TIMEOUT_MS = 900_000;
const DEFAULT_OUTPUT_BYTES = 262_144;

type BridgeActionConfig = {
  template: string[];
  allowStructuredArgs?: string[];
  description?: string;
  mcpToolName?: string;
};

type BridgeTargetConfig = {
  id: string;
  category: "agent-cli" | "ide-cli" | "mcp";
  transport: "exec" | "pty" | "acp-stdio" | "mcp";
  enabled: boolean;
  entry: {
    binary?: string;
    mcp?: {
      serverId: string;
      toolName: string;
    };
  };
  cwdPolicy: "workspace-only" | "target-default";
  sessionMode: "oneshot" | "persistent";
  defaultTimeoutMs?: number;
  maxOutputBytes?: number;
  defaultCwd?: string;
  actions: Record<string, BridgeActionConfig>;
};

type BridgeConfig = {
  version?: string;
  workspaceRoots?: string[];
  extraWorkspaceRoots?: string[];
  targets?: BridgeTargetConfig[];
};

export interface ConfigureClaudeCodeExecMcpOptions {
  stateDir: string;
  repoRoot: string;
  workspaceRoot: string;
  extraWorkspaceRoots?: string[];
  claudeCommand: string;
  gitBashPath?: string;
  serverId: string;
  targetId: string;
  fallbackTargetId: string;
}

export interface ConfigureClaudeCodeExecMcpResult {
  changed: boolean;
  stateDir: string;
  repoRoot: string;
  workspaceRoot: string;
  extraWorkspaceRoots: string[];
  wrapperScriptPath: string;
  mcpPath: string;
  bridgePath: string;
  serverId: string;
  targetId: string;
  fallbackTargetId: string;
  gitBashPath?: string;
  createdFiles: string[];
  updatedFiles: string[];
  nextSteps: string[];
}

function defaultMCPConfig(): CompatibleMcpConfig {
  return {
    version: DEFAULT_VERSION,
    servers: [],
    settings: {
      defaultTimeout: 30_000,
      debug: false,
      toolPrefix: true,
    },
  };
}

function defaultBridgeConfig(): BridgeConfig {
  return {
    version: DEFAULT_VERSION,
    targets: [],
  };
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<{ existed: boolean; value: T }> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as T;
    return { existed: true, value: parsed };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { existed: false, value: fallback };
    }
    throw error;
  }
}

function upsertById<T extends { id: string }>(items: T[], nextItem: T): { items: T[]; changed: boolean } {
  const index = items.findIndex((item) => item.id === nextItem.id);
  if (index === -1) {
    return {
      items: [...items, nextItem],
      changed: true,
    };
  }
  const previous = items[index];
  const previousSerialized = JSON.stringify(previous);
  const nextSerialized = JSON.stringify(nextItem);
  if (previousSerialized === nextSerialized) {
    return {
      items,
      changed: false,
    };
  }
  const cloned = [...items];
  cloned[index] = nextItem;
  return {
    items: cloned,
    changed: true,
  };
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeOptionalString(item))
    .filter((item): item is string => Boolean(item));
}

function parseCommaSeparatedRoots(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeExtraWorkspaceRoots(roots: string[], workspaceRoot: string): string[] {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const root of roots) {
    const resolved = path.resolve(root);
    if (!resolved || resolved === resolvedWorkspaceRoot || seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    normalized.push(resolved);
  }

  return normalized;
}

function resolveExtraWorkspaceRoots(options: {
  explicit?: string[];
  existing?: string[];
  workspaceRoot: string;
}): string[] {
  const explicit = normalizeExtraWorkspaceRoots(options.explicit ?? [], options.workspaceRoot);
  if (explicit.length > 0) {
    return explicit;
  }

  const existing = normalizeExtraWorkspaceRoots(options.existing ?? [], options.workspaceRoot);
  if (existing.length > 0) {
    return existing;
  }

  return normalizeExtraWorkspaceRoots(
    parseCommaSeparatedRoots(process.env.BELLDANDY_EXTRA_WORKSPACE_ROOTS),
    options.workspaceRoot,
  );
}

function buildClaudeBridgeServer(options: {
  serverId: string;
  wrapperScriptPath: string;
  workspaceRoot: string;
  extraWorkspaceRoots?: string[];
  claudeCommand: string;
  gitBashPath?: string;
}): CompatibleMcpServerConfig {
  const args = [
    options.wrapperScriptPath,
    "--workspace-root",
    options.workspaceRoot,
    "--default-cwd",
    options.workspaceRoot,
    "--claude-command",
    options.claudeCommand,
  ];
  for (const root of options.extraWorkspaceRoots ?? []) {
    args.push("--extra-workspace-root", root);
  }
  if (typeof options.gitBashPath === "string" && options.gitBashPath.trim()) {
    args.push("--git-bash-path", options.gitBashPath.trim());
  }
  return {
    id: options.serverId,
    name: options.serverId,
    description: "Claude Code 一次性执行的最小 MCP wrapper，由 `bdd configure bridge claude-code-exec-mcp` 生成。",
    transport: {
      type: "stdio",
      command: "node",
      args,
    },
    autoConnect: true,
    enabled: true,
    timeout: DEFAULT_TIMEOUT_MS,
    retryCount: 1,
    retryDelay: 1000,
  };
}

function buildClaudeMcpTarget(options: {
  targetId: string;
  serverId: string;
  workspaceRoot: string;
}): BridgeTargetConfig {
  return {
    id: options.targetId,
    category: "agent-cli",
    transport: "mcp",
    enabled: true,
    entry: {
      mcp: {
        serverId: options.serverId,
        toolName: "task_once",
      },
    },
    cwdPolicy: "workspace-only",
    sessionMode: "oneshot",
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_OUTPUT_BYTES,
    defaultCwd: options.workspaceRoot,
    actions: {
      analyze: {
        template: [],
        allowStructuredArgs: ["objective", "scope", "constraints", "expectedOutput", "model", "cwd"],
        description: "通过 MCP wrapper 调用 Claude Code 做只读分析",
        mcpToolName: "analyze_once",
      },
      review: {
        template: [],
        allowStructuredArgs: ["objective", "scope", "constraints", "expectedOutput", "model", "cwd"],
        description: "通过 MCP wrapper 调用 Claude Code 做一次性代码审查",
        mcpToolName: "review_once",
      },
      patch: {
        template: [],
        allowStructuredArgs: ["objective", "scope", "constraints", "expectedOutput", "model", "cwd"],
        description: "通过 MCP wrapper 调用 Claude Code 做小范围一次性改动",
        mcpToolName: "patch_once",
      },
      exec: {
        template: [],
        allowStructuredArgs: ["mode", "objective", "scope", "constraints", "expectedOutput", "model", "cwd"],
        description: "通过 MCP wrapper 调用 Claude Code 做结构化一次性执行（兼容入口）",
        mcpToolName: "task_once",
      },
    },
  };
}

function buildClaudeCliFallbackTarget(options: {
  targetId: string;
  workspaceRoot: string;
  extraWorkspaceRoots?: string[];
  claudeCommand: string;
}): BridgeTargetConfig {
  const template = ["--print", "--output-format", "json", "--dangerously-skip-permissions"];
  for (const root of options.extraWorkspaceRoots ?? []) {
    template.push("--add-dir", root);
  }
  return {
    id: options.targetId,
    category: "agent-cli",
    transport: "exec",
    enabled: true,
    entry: {
      binary: options.claudeCommand,
    },
    cwdPolicy: "workspace-only",
    sessionMode: "oneshot",
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_OUTPUT_BYTES,
    defaultCwd: options.workspaceRoot,
    actions: {
      exec: {
        template,
        allowStructuredArgs: ["prompt", "model"],
        description: "Claude Code CLI 回退路径，仅在 MCP 路径不可用时使用",
      },
    },
  };
}

export async function configureClaudeCodeExecMcp(options: ConfigureClaudeCodeExecMcpOptions): Promise<ConfigureClaudeCodeExecMcpResult> {
  const stateDir = path.resolve(options.stateDir);
  const repoRoot = path.resolve(options.repoRoot);
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const wrapperScriptPath = path.join(repoRoot, "packages", "belldandy-mcp", "scripts", "claude-bridge-server.mjs");
  const mcpPath = path.join(stateDir, MCP_CONFIG_FILE_NAME);
  const bridgePath = path.join(stateDir, BRIDGE_CONFIG_FILE_NAME);

  await fs.access(wrapperScriptPath);

  const mcpLoaded = await readCompatibleMcpConfig(mcpPath, defaultMCPConfig());
  const bridgeLoaded = await readJsonFile<BridgeConfig>(bridgePath, defaultBridgeConfig());
  const extraWorkspaceRoots = resolveExtraWorkspaceRoots({
    explicit: options.extraWorkspaceRoots,
    existing: [
      ...normalizeStringArray(bridgeLoaded.value.extraWorkspaceRoots),
      ...normalizeStringArray(bridgeLoaded.value.workspaceRoots),
    ],
    workspaceRoot,
  });

  const nextMcp = {
    version: mcpLoaded.internal.version ?? DEFAULT_VERSION,
    servers: Array.isArray(mcpLoaded.internal.servers) ? [...mcpLoaded.internal.servers] : [],
    settings: mcpLoaded.internal.settings ?? defaultMCPConfig().settings,
  } satisfies CompatibleMcpConfig;
  const nextBridge = {
    version: bridgeLoaded.value.version ?? DEFAULT_VERSION,
    workspaceRoots: [workspaceRoot, ...extraWorkspaceRoots],
    extraWorkspaceRoots,
    targets: Array.isArray(bridgeLoaded.value.targets) ? [...bridgeLoaded.value.targets] : [],
  } satisfies BridgeConfig;

  const serverUpsert = upsertById(nextMcp.servers ?? [], buildClaudeBridgeServer({
    serverId: options.serverId,
    wrapperScriptPath,
    workspaceRoot,
    extraWorkspaceRoots,
    claudeCommand: options.claudeCommand,
    gitBashPath: options.gitBashPath,
  }));
  nextMcp.servers = serverUpsert.items;
  const mcpOutput = buildCompatibleMcpOutput(mcpLoaded, defaultMCPConfig(), serverUpsert.items.find((item) => item.id === options.serverId)!);

  const mcpTargetUpsert = upsertById(nextBridge.targets ?? [], buildClaudeMcpTarget({
    targetId: options.targetId,
    serverId: options.serverId,
    workspaceRoot,
  }));
  const cliTargetUpsert = upsertById(mcpTargetUpsert.items, buildClaudeCliFallbackTarget({
    targetId: options.fallbackTargetId,
    workspaceRoot,
    extraWorkspaceRoots,
    claudeCommand: options.claudeCommand,
  }));
  nextBridge.targets = cliTargetUpsert.items;

  const createdFiles: string[] = [];
  const updatedFiles: string[] = [];
  const mcpChanged = mcpOutput.changed;
  const bridgeChanged = !bridgeLoaded.existed
    || mcpTargetUpsert.changed
    || cliTargetUpsert.changed
    || JSON.stringify({
      version: bridgeLoaded.value.version ?? DEFAULT_VERSION,
      workspaceRoots: normalizeStringArray(bridgeLoaded.value.workspaceRoots),
      extraWorkspaceRoots: normalizeStringArray(bridgeLoaded.value.extraWorkspaceRoots),
      targets: Array.isArray(bridgeLoaded.value.targets) ? bridgeLoaded.value.targets : [],
    }) !== JSON.stringify(nextBridge);

  if (mcpChanged) {
    await writeJsonFile(mcpPath, mcpOutput.value);
    if (mcpLoaded.existed) {
      updatedFiles.push(mcpPath);
    } else {
      createdFiles.push(mcpPath);
    }
  }

  if (bridgeChanged) {
    await writeJsonFile(bridgePath, nextBridge);
    if (bridgeLoaded.existed) {
      updatedFiles.push(bridgePath);
    } else {
      createdFiles.push(bridgePath);
    }
  }

  return {
    changed: mcpChanged || bridgeChanged,
    stateDir,
    repoRoot,
    workspaceRoot,
    extraWorkspaceRoots,
    wrapperScriptPath,
    mcpPath,
    bridgePath,
    serverId: options.serverId,
    targetId: options.targetId,
    fallbackTargetId: options.fallbackTargetId,
    gitBashPath: options.gitBashPath ? path.resolve(options.gitBashPath) : undefined,
    createdFiles,
    updatedFiles,
    nextSteps: [
      "运行 `bdd doctor`，确认 mcp.json 已被正常加载。",
      `启动 Gateway 后，用 bridge_target_diagnose 检查 targetId=${options.targetId}。`,
      `优先使用 ${options.targetId}；若 MCP 路径失败，可回退 ${options.fallbackTargetId}。`,
      extraWorkspaceRoots.length > 0
        ? `当前 bridge 额外开放目录：${extraWorkspaceRoots.join(", ")}。`
        : "如果需要跨项目访问，请同步配置 BELLDANDY_EXTRA_WORKSPACE_ROOTS 或传入 --extra-workspace-roots。",
      "如果 Windows 下 Claude CLI 仍提示 git-bash 探测失败，请检查当前环境是否能被 Claude 自身识别到 bash.exe。",
    ],
  };
}

export default defineCommand({
  meta: {
    name: "claude-code-exec-mcp",
    description: "Generate a minimal claude_code_exec -> mcp bridge configuration",
  },
  args: {
    json: { type: "boolean", description: "JSON output" },
    "state-dir": { type: "string", description: "Override state directory" },
    "repo-root": { type: "string", description: "Repository root that contains packages/belldandy-mcp/scripts/claude-bridge-server.mjs" },
    "workspace-root": { type: "string", description: "Workspace root used by claude-bridge and bridge targets" },
    "extra-workspace-roots": { type: "string", description: "Comma-separated extra workspace roots mirrored into bridge cwd allowlist and CLI --add-dir" },
    "claude-command": { type: "string", description: "Claude Code CLI command name", default: "claude" },
    "git-bash-path": { type: "string", description: "Optional explicit bash.exe path for Claude Code on Windows" },
    "server-id": { type: "string", description: "MCP server id", default: "claude-bridge" },
    "target-id": { type: "string", description: "Bridge MCP target id", default: "claude_code_exec" },
    "fallback-target-id": { type: "string", description: "Fallback CLI target id" },
  },
  async run({ args }) {
    const ctx = createCLIContext({ json: args.json, stateDir: args["state-dir"] });
    const repoRoot = args["repo-root"] ? String(args["repo-root"]) : process.cwd();
    const workspaceRoot = args["workspace-root"] ? String(args["workspace-root"]) : process.cwd();
    const targetId = String(args["target-id"] ?? "claude_code_exec");
    const fallbackTargetId = args["fallback-target-id"]
      ? String(args["fallback-target-id"])
      : `${targetId}_cli`;
    const result = await configureClaudeCodeExecMcp({
      stateDir: ctx.stateDir,
      repoRoot,
      workspaceRoot,
      extraWorkspaceRoots: parseCommaSeparatedRoots(args["extra-workspace-roots"]),
      claudeCommand: String(args["claude-command"] ?? "claude"),
      gitBashPath: args["git-bash-path"] ? String(args["git-bash-path"]) : undefined,
      serverId: String(args["server-id"] ?? "claude-bridge"),
      targetId,
      fallbackTargetId,
    });

    if (ctx.json) {
      ctx.output(result);
      return;
    }

    if (result.changed) {
      ctx.success("Claude MCP bridge 配置已生成");
    } else {
      ctx.log("Claude MCP bridge 配置已是最新状态");
    }
    ctx.log(`  stateDir: ${result.stateDir}`);
    ctx.log(`  mcp.json: ${result.mcpPath}`);
    ctx.log(`  agent-bridge.json: ${result.bridgePath}`);
    ctx.log(`  serverId: ${result.serverId}`);
    ctx.log(`  targetId: ${result.targetId}`);
    ctx.log(`  fallbackTargetId: ${result.fallbackTargetId}`);
    if (result.gitBashPath) {
      ctx.log(`  gitBashPath: ${result.gitBashPath}`);
    }
    for (const step of result.nextSteps) {
      ctx.log(`  next: ${step}`);
    }
  },
});
