import fs from "node:fs/promises";
import path from "node:path";
import type { ToolContext } from "../../types.js";
import {
  BRIDGE_CONFIG_FILE_NAME,
  type BridgeActionConfig,
  type BridgeCategory,
  type BridgeConfig,
  type BridgeCwdPolicy,
  type BridgeSessionMode,
  type BridgeTargetConfig,
  type BridgeTransport,
} from "./types.js";

const DEFAULT_BRIDGE_CONFIG: BridgeConfig = {
  version: "1.0.0",
  targets: [],
};

function stripUtf8Bom(raw: string): string {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
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

function normalizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const normalized = Object.entries(value as Record<string, unknown>)
    .reduce<Record<string, string>>((acc, [key, raw]) => {
      const normalizedKey = normalizeOptionalString(key);
      const normalizedValue = normalizeOptionalString(raw);
      if (!normalizedKey || !normalizedValue) {
        return acc;
      }
      acc[normalizedKey] = normalizedValue;
      return acc;
    }, {});
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeCategory(value: unknown): BridgeCategory | undefined {
  const normalized = normalizeOptionalString(value);
  switch (normalized) {
    case "agent-cli":
    case "ide-cli":
    case "mcp":
      return normalized;
    default:
      return undefined;
  }
}

function normalizeTransport(value: unknown): BridgeTransport | undefined {
  const normalized = normalizeOptionalString(value);
  switch (normalized) {
    case "exec":
    case "pty":
    case "acp-stdio":
    case "mcp":
      return normalized;
    default:
      return undefined;
  }
}

function normalizeSessionMode(value: unknown): BridgeSessionMode | undefined {
  const normalized = normalizeOptionalString(value);
  switch (normalized) {
    case "oneshot":
    case "persistent":
      return normalized;
    default:
      return undefined;
  }
}

function normalizeCwdPolicy(value: unknown): BridgeCwdPolicy | undefined {
  const normalized = normalizeOptionalString(value);
  switch (normalized) {
    case "workspace-only":
    case "target-default":
      return normalized;
    default:
      return undefined;
  }
}

function normalizePositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : undefined;
}

function normalizeFirstTurnStrategy(value: unknown): BridgeActionConfig["firstTurnStrategy"] {
  const normalized = normalizeOptionalString(value);
  switch (normalized) {
    case "start-args-prompt":
    case "write":
      return normalized;
    default:
      return undefined;
  }
}

function normalizeStartupSequence(value: unknown): BridgeActionConfig["startupSequence"] {
  if (!Array.isArray(value)) return undefined;
  const sequence = value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return undefined;
      }
      const data = normalizeOptionalString((item as { data?: unknown }).data);
      if (!data) return undefined;
      const waitMs = normalizePositiveInt((item as { waitMs?: unknown }).waitMs);
      return {
        data,
        ...(waitMs ? { waitMs } : {}),
      };
    })
    .filter((item): item is NonNullable<BridgeActionConfig["startupSequence"]>[number] => Boolean(item));
  return sequence.length > 0 ? sequence : undefined;
}

function normalizeActionConfig(actionName: string, raw: unknown): BridgeActionConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Bridge action "${actionName}" 必须是对象。`);
  }
  const template = normalizeStringArray((raw as { template?: unknown }).template);
  return {
    template,
    allowStructuredArgs: normalizeStringArray((raw as { allowStructuredArgs?: unknown }).allowStructuredArgs),
    description: normalizeOptionalString((raw as { description?: unknown }).description),
    mcpToolName: normalizeOptionalString((raw as { mcpToolName?: unknown }).mcpToolName),
    firstTurnStrategy: normalizeFirstTurnStrategy((raw as { firstTurnStrategy?: unknown }).firstTurnStrategy),
    firstTurnHint: normalizeOptionalString((raw as { firstTurnHint?: unknown }).firstTurnHint),
    recommendedReadWaitMs: normalizePositiveInt((raw as { recommendedReadWaitMs?: unknown }).recommendedReadWaitMs),
    startupReadWaitMs: normalizePositiveInt((raw as { startupReadWaitMs?: unknown }).startupReadWaitMs),
    startupSequence: normalizeStartupSequence((raw as { startupSequence?: unknown }).startupSequence),
  };
}

function normalizeActions(raw: unknown): Record<string, BridgeActionConfig> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Bridge target.actions 必须是对象。");
  }

  const actions: Record<string, BridgeActionConfig> = {};
  for (const [actionName, actionConfig] of Object.entries(raw as Record<string, unknown>)) {
    const normalizedName = normalizeOptionalString(actionName);
    if (!normalizedName) continue;
    actions[normalizedName] = normalizeActionConfig(normalizedName, actionConfig);
  }

  if (Object.keys(actions).length === 0) {
    throw new Error("Bridge target 至少需要一个 action。");
  }

  return actions;
}

function normalizeTargetConfig(index: number, raw: unknown): BridgeTargetConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Bridge target[${index}] 必须是对象。`);
  }

  const record = raw as Record<string, unknown>;
  const id = normalizeOptionalString(record.id);
  const category = normalizeCategory(record.category);
  const transport = normalizeTransport(record.transport);
  const cwdPolicy = normalizeCwdPolicy(record.cwdPolicy);
  const sessionMode = normalizeSessionMode(record.sessionMode);
  const entryRecord = record.entry && typeof record.entry === "object" && !Array.isArray(record.entry)
    ? record.entry as Record<string, unknown>
    : undefined;
  const binary = normalizeOptionalString(entryRecord?.binary);
  const env = normalizeStringRecord(entryRecord?.env);
  const mcpRecord = entryRecord?.mcp && typeof entryRecord.mcp === "object" && !Array.isArray(entryRecord.mcp)
    ? entryRecord.mcp as Record<string, unknown>
    : undefined;
  const mcpServerId = normalizeOptionalString(mcpRecord?.serverId);
  const mcpToolName = normalizeOptionalString(mcpRecord?.toolName);

  if (!id) throw new Error(`Bridge target[${index}] 缺少 id。`);
  if (!category) throw new Error(`Bridge target "${id}" 的 category 非法。`);
  if (!transport) throw new Error(`Bridge target "${id}" 的 transport 非法。`);
  if (!cwdPolicy) throw new Error(`Bridge target "${id}" 的 cwdPolicy 非法。`);
  if (!sessionMode) throw new Error(`Bridge target "${id}" 的 sessionMode 非法。`);
  if (transport === "mcp") {
    if (!mcpServerId || !mcpToolName) {
      throw new Error(`Bridge target "${id}" 缺少 entry.mcp.serverId 或 entry.mcp.toolName。`);
    }
  } else if (!binary) {
    throw new Error(`Bridge target "${id}" 缺少 entry.binary。`);
  }

  return {
    id,
    category,
    transport,
    enabled: record.enabled !== false,
    entry: {
      ...(binary ? { binary } : {}),
      ...(env ? { env } : {}),
      ...(mcpServerId && mcpToolName
        ? {
            mcp: {
              serverId: mcpServerId,
              toolName: mcpToolName,
            },
          }
        : {}),
    },
    cwdPolicy,
    sessionMode,
    defaultTimeoutMs: normalizePositiveInt(record.defaultTimeoutMs),
    maxOutputBytes: normalizePositiveInt(record.maxOutputBytes),
    idleTimeoutMs: normalizePositiveInt(record.idleTimeoutMs),
    defaultCwd: normalizeOptionalString(record.defaultCwd),
    actions: normalizeActions(record.actions),
  };
}

export function resolveBridgeConfigPath(
  context: Pick<ToolContext, "workspaceRoot">,
): string {
  return path.join(context.workspaceRoot, BRIDGE_CONFIG_FILE_NAME);
}

export async function loadBridgeConfig(
  context: Pick<ToolContext, "workspaceRoot">,
): Promise<BridgeConfig> {
  const configPath = resolveBridgeConfigPath(context);
  const raw = await fs.readFile(configPath, "utf-8").catch((error: NodeJS.ErrnoException | Error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  });

  if (!raw) {
    return DEFAULT_BRIDGE_CONFIG;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripUtf8Bom(raw));
  } catch (error) {
    throw new Error(`Bridge 配置 JSON 解析失败: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Bridge 配置根节点必须是对象。");
  }

  const record = parsed as Record<string, unknown>;
  const targetsRaw = Array.isArray(record.targets) ? record.targets : [];
  const targets = targetsRaw.map((item, index) => normalizeTargetConfig(index, item));
  const seenIds = new Set<string>();
  for (const target of targets) {
    if (seenIds.has(target.id)) {
      throw new Error(`Bridge target id 重复: ${target.id}`);
    }
    seenIds.add(target.id);
  }

  return {
    version: normalizeOptionalString(record.version) ?? DEFAULT_BRIDGE_CONFIG.version,
    workspaceRoots: normalizeStringArray(record.workspaceRoots),
    extraWorkspaceRoots: normalizeStringArray(record.extraWorkspaceRoots),
    targets,
  };
}
