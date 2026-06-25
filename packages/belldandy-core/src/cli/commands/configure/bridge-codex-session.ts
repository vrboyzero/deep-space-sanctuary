import fs from "node:fs/promises";
import path from "node:path";

import { defineCommand } from "citty";

import { createCLIContext } from "../../shared/context.js";
import { writeJsonFile } from "./mcp-config-compat.js";

const BRIDGE_CONFIG_FILE_NAME = "agent-bridge.json";
const DEFAULT_VERSION = "1.0.0";

type BridgeActionConfig = {
  template: string[];
  allowStructuredArgs?: string[];
  description?: string;
  firstTurnStrategy?: "start-args-prompt" | "write";
  firstTurnHint?: string;
  recommendedReadWaitMs?: number;
};

type BridgeTargetConfig = {
  id: string;
  category: "agent-cli" | "ide-cli" | "mcp";
  transport: "exec" | "pty" | "acp-stdio" | "mcp";
  enabled: boolean;
  entry: {
    binary?: string;
    env?: Record<string, string>;
    mcp?: {
      serverId: string;
      toolName: string;
    };
  };
  cwdPolicy: "workspace-only" | "target-default";
  sessionMode: "oneshot" | "persistent";
  defaultTimeoutMs?: number;
  maxOutputBytes?: number;
  idleTimeoutMs?: number;
  defaultCwd?: string;
  actions: Record<string, BridgeActionConfig>;
};

type BridgeConfig = {
  version?: string;
  workspaceRoots?: string[];
  extraWorkspaceRoots?: string[];
  targets?: BridgeTargetConfig[];
};

export interface ConfigureCodexSessionOptions {
  stateDir: string;
  workspaceRoot: string;
  extraWorkspaceRoots?: string[];
  codexCommand: string;
  targetId: string;
}

export interface ConfigureCodexSessionResult {
  changed: boolean;
  stateDir: string;
  workspaceRoot: string;
  extraWorkspaceRoots: string[];
  bridgePath: string;
  targetId: string;
  createdFiles: string[];
  updatedFiles: string[];
  nextSteps: string[];
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
    return {
      existed: true,
      value: JSON.parse(raw) as T,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        existed: false,
        value: fallback,
      };
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
  if (JSON.stringify(previous) === JSON.stringify(nextItem)) {
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

function buildCodexSessionTarget(options: {
  targetId: string;
  workspaceRoot: string;
  extraWorkspaceRoots?: string[];
  codexCommand: string;
}): BridgeTargetConfig {
  const template = ["--sandbox", "workspace-write"];
  for (const root of options.extraWorkspaceRoots ?? []) {
    template.push("--add-dir", root);
  }
  return {
    id: options.targetId,
    category: "agent-cli",
    transport: "pty",
    enabled: true,
    entry: {
      binary: options.codexCommand,
    },
    cwdPolicy: "workspace-only",
    sessionMode: "persistent",
    defaultCwd: options.workspaceRoot,
    actions: {
      interactive: {
        template,
        allowStructuredArgs: ["prompt"],
        description: "通过 Codex CLI 启动持续 bridge session，并由 bridge_session_* 工具持续驱动。",
        firstTurnStrategy: "start-args-prompt",
        firstTurnHint: "首回合建议随 bridge_session_start.prompt 一起提交任务，再先 read 一次观察启动输出。",
        recommendedReadWaitMs: 10_000,
      },
    },
  };
}

export async function configureCodexSession(
  options: ConfigureCodexSessionOptions,
): Promise<ConfigureCodexSessionResult> {
  const stateDir = path.resolve(options.stateDir);
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const bridgePath = path.join(stateDir, BRIDGE_CONFIG_FILE_NAME);
  const bridgeLoaded = await readJsonFile<BridgeConfig>(bridgePath, defaultBridgeConfig());
  const extraWorkspaceRoots = resolveExtraWorkspaceRoots({
    explicit: options.extraWorkspaceRoots,
    existing: [
      ...normalizeStringArray(bridgeLoaded.value.extraWorkspaceRoots),
      ...normalizeStringArray(bridgeLoaded.value.workspaceRoots),
    ],
    workspaceRoot,
  });

  const nextBridge = {
    version: bridgeLoaded.value.version ?? DEFAULT_VERSION,
    workspaceRoots: [workspaceRoot, ...extraWorkspaceRoots],
    extraWorkspaceRoots,
    targets: Array.isArray(bridgeLoaded.value.targets) ? [...bridgeLoaded.value.targets] : [],
  } satisfies BridgeConfig;

  const targetUpsert = upsertById(nextBridge.targets ?? [], buildCodexSessionTarget({
    targetId: options.targetId,
    workspaceRoot,
    extraWorkspaceRoots,
    codexCommand: options.codexCommand,
  }));
  nextBridge.targets = targetUpsert.items;

  const bridgeChanged = !bridgeLoaded.existed
    || targetUpsert.changed
    || JSON.stringify({
      version: bridgeLoaded.value.version ?? DEFAULT_VERSION,
      workspaceRoots: normalizeStringArray(bridgeLoaded.value.workspaceRoots),
      extraWorkspaceRoots: normalizeStringArray(bridgeLoaded.value.extraWorkspaceRoots),
      targets: Array.isArray(bridgeLoaded.value.targets) ? bridgeLoaded.value.targets : [],
    }) !== JSON.stringify(nextBridge);

  const createdFiles: string[] = [];
  const updatedFiles: string[] = [];
  if (bridgeChanged) {
    await writeJsonFile(bridgePath, nextBridge);
    if (bridgeLoaded.existed) {
      updatedFiles.push(bridgePath);
    } else {
      createdFiles.push(bridgePath);
    }
  }

  return {
    changed: bridgeChanged,
    stateDir,
    workspaceRoot,
    extraWorkspaceRoots,
    bridgePath,
    targetId: options.targetId,
    createdFiles,
    updatedFiles,
    nextSteps: [
      `启动 Gateway 后，优先用 bridge_session_start 调 ${options.targetId}.interactive。`,
      "首回合建议把任务写进 bridge_session_start.prompt，而不是 start 后立刻 write。",
      extraWorkspaceRoots.length > 0
        ? `当前 session 额外开放目录：${extraWorkspaceRoots.join(", ")}。`
        : "如果需要跨项目访问，请同步配置 BELLDANDY_EXTRA_WORKSPACE_ROOTS 或传入 --extra-workspace-roots。",
      "在 WebChat 顶部 `桥接` 页查看 session 列表、运行状态和 live tail。",
    ],
  };
}

export default defineCommand({
  meta: {
    name: "codex-session",
    description: "Generate a persistent codex_session bridge target",
  },
  args: {
    json: { type: "boolean", description: "JSON output" },
    "state-dir": { type: "string", description: "Override state directory" },
    "workspace-root": { type: "string", description: "Workspace root used by the bridge target default cwd" },
    "extra-workspace-roots": { type: "string", description: "Comma-separated extra workspace roots mirrored into CLI --add-dir" },
    "codex-command": { type: "string", description: "Codex CLI command name", default: "codex" },
    "target-id": { type: "string", description: "Bridge session target id", default: "codex_session" },
  },
  async run({ args }) {
    const ctx = createCLIContext({ json: args.json, stateDir: args["state-dir"] });
    const workspaceRoot = args["workspace-root"] ? String(args["workspace-root"]) : process.cwd();
    const result = await configureCodexSession({
      stateDir: ctx.stateDir,
      workspaceRoot,
      extraWorkspaceRoots: parseCommaSeparatedRoots(args["extra-workspace-roots"]),
      codexCommand: String(args["codex-command"] ?? "codex"),
      targetId: String(args["target-id"] ?? "codex_session"),
    });

    if (ctx.json) {
      ctx.output(result);
      return;
    }

    if (result.changed) {
      ctx.success("Codex session bridge 配置已生成");
    } else {
      ctx.log("Codex session bridge 配置已是最新状态");
    }
    ctx.log(`  stateDir: ${result.stateDir}`);
    ctx.log(`  agent-bridge.json: ${result.bridgePath}`);
    ctx.log(`  targetId: ${result.targetId}`);
    for (const step of result.nextSteps) {
      ctx.log(`  next: ${step}`);
    }
  },
});
