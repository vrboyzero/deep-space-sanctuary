import crypto from "node:crypto";
import { redactSensitiveText, redactSensitiveValue, type JsonObject } from "@belldandy/protocol";
import type {
  Tool,
  ToolCallRequest,
  ToolCallResult,
  ToolContext,
  ToolPolicy,
  ToolAuditLog,
  AgentCapabilities,
  GoalCapabilities,
  BridgeSubtaskSemantics,
  BridgeSessionGovernanceCapabilities,
  ConversationAccessKind,
  ConversationStoreInterface,
  ITokenCounterService,
  ToolExecutionRuntimeContext,
  ToolPermissionController,
  ToolRuntimeLaunchSpec,
  ToolCatalogEntry,
  ToolCatalogFamilyEntry,
  ToolDiscoveryEntry,
  ToolDiscoveryEntriesOptions,
  ToolDiscoveryFamilyDefinition,
  MCPRuntimeCapabilities,
  WorkspaceMutationObserver,
  WorkflowRuntimeCapabilities,
} from "./types.js";
import { getToolContract, type ToolContract, type ToolExecutionAdmission } from "./tool-contract.js";
import {
  evaluateCommandSandboxAdmission,
  normalizeCommandSandboxRequirement,
} from "./command-sandbox.js";
import { buildCommandPermissionPreview, parseCommandPlan, sanitizeCommandPlanForAudit } from "./command-plan.js";
import {
  evaluateLaunchPermissionMode,
  evaluateLaunchRolePolicy,
  normalizeLaunchPermissionMode,
  normalizeLaunchAllowedToolFamilies,
  normalizeLaunchMaxToolRiskLevel,
  normalizeLaunchRole,
} from "./runtime-policy.js";
import {
  evaluateToolContractAccess,
  type ToolContractDenialReason,
  type ToolContractAccessDecision,
  type ToolContractAccessPolicy,
  resolveSafeScopesForChannel,
} from "./security-matrix.js";
import { isAbortError, raceWithAbort, readAbortReason } from "./abort-utils.js";
import {
  applyToolResultOutputAdmission,
  createToolExecutionDeadlineAdmission,
} from "./tool-execution-admission.js";
import {
  buildFailureToolCallResult,
  normalizeToolCallResultFailureKind,
} from "./failure-kind.js";
import {
  ToolAuditDispatcher,
  type ToolAuditDispatcherSnapshot,
  type ToolAuditSink,
} from "./tool-audit-dispatcher.js";

/** 默认策略（最小权限） */
export const DEFAULT_POLICY: ToolPolicy = {
  allowedPaths: [],
  deniedPaths: [".git", "node_modules", ".env"],
  allowedDomains: [],
  deniedDomains: [],
  maxTimeoutMs: 30_000,
  maxResponseBytes: 512_000,
  exec: {
    quickTimeoutMs: 5_000,
    longTimeoutMs: 300_000,
    nonInteractive: { enabled: true },
  },
};

export const DEFAULT_MAX_BATCH_TOOL_CALLS = 32;
export const DEFAULT_MAX_CONCURRENT_TOOL_CALLS = 4;

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

/** Logger 接口，供工具在 context 中使用 */
export type ToolExecutorLogger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug?(message: string): void;
};

export type ToolExecutorOptions = {
  tools: Tool[];
  workspaceRoot: string;
  /** 当前 Gateway / CLI 运行时的 stateDir；未提供时回退为 workspaceRoot */
  stateDir?: string;
  /** 额外允许的文件操作根目录（Agent 可读写这些目录下的文件） */
  extraWorkspaceRoots?: string[];
  /** 始终可用的保留工具名（不受 disabled 开关影响） */
  alwaysEnabledTools?: string[];
  policy?: Partial<ToolPolicy>;
  /** 审计旁路 sink；允许异步实现，但不会阻塞 Tool 执行结果。 */
  auditLogger?: ToolAuditSink;
  /** 审计 sink 等待期间最多保留的事件数。 */
  maxAuditQueueSize?: number;
  agentCapabilities?: AgentCapabilities;
  goalCapabilities?: GoalCapabilities;
  /** 可选：传入后注入到 ToolContext，供工具使用 */
  logger?: ToolExecutorLogger;
  /** 可选：运行时判断工具是否被禁用（用于调用设置开关） */
  isToolDisabled?: (toolName: string) => boolean;
  /** 可选：运行时判断工具是否允许给指定 Agent 使用（用于 per-agent toolWhitelist 与运行角色限制） */
  isToolAllowedForAgent?: (
    toolName: string,
    agentId?: string,
    role?: ToolRuntimeLaunchSpec["role"],
  ) => boolean;
  /** 可选：运行时判断工具是否允许在指定会话中使用（用于 goal channel 等场景） */
  isToolAllowedInConversation?: (toolName: string, conversationId: string, agentId?: string) => boolean;
  /** 可选：按 Agent 返回轻量能力偏好目录（仅用于搜索排序等软路由） */
  getAgentCatalogPreferences?: (agentId?: string) => { methods?: string[]; skills?: string[] } | undefined;
  /** 可选：会话存储（用于缓存等功能） */
  conversationStore?: ConversationStoreInterface;
  /** 可选：当前运行时允许读取的会话类别白名单 */
  allowedConversationKinds?: ConversationAccessKind[];
  /** 可选：事件广播回调（用于工具主动推送事件到前端） */
  broadcast?: (event: string, payload: Record<string, unknown>) => void;
  /** 可选：MCP 调用能力（由 Gateway 注入，供 bridge mcp transport 复用现有 MCP runtime） */
  mcp?: MCPRuntimeCapabilities;
  /** 由 core 注入的受控文件变更观察器；仅文件工具使用。 */
  workspaceMutationObserver?: WorkspaceMutationObserver;
  /** 可选：bridge session 与 subtask runtime 的治理接线能力 */
  bridgeSessionGovernance?: BridgeSessionGovernanceCapabilities;
  /** 可选：仅用于运行时观测的工具广播观察器 */
  broadcastObserver?: (event: string, payload: Record<string, unknown>, meta: {
    conversationId: string;
    agentId?: string;
    toolName: string;
  }) => void;
  /** 可选：当某个会话的 token counter 被绑定后触发 */
  onTokenCounterSet?: (conversationId: string, counter: ITokenCounterService) => void;
  /** 可选：统一 contract 安全矩阵策略 */
  contractAccessPolicy?: ToolContractAccessPolicy;
  /** confirm 模式的窄权限决策接口；缺失时继续失败关闭。 */
  permissionController?: ToolPermissionController;
  /** 生产运行时要求每个注册 Tool 都具备名称一致的治理 contract。 */
  requireToolContracts?: boolean;
  /** 初始 Tool pool 的 inventory 来源；动态注册可单独指定。 */
  initialToolOrigin?: ToolRegistrationOrigin;
  /** 可选：按会话延迟加载的工具名 */
  deferredToolNames?: string[];
  /** executeAll 单批最多接收的 Tool Call 数量。 */
  maxBatchToolCalls?: number;
  /** executeAll 单批最多并行执行的 Tool Call 数量。 */
  maxConcurrentToolCalls?: number;
};

export type ToolRegistrationOrigin =
  | "builtin"
  | "core"
  | "mcp"
  | "plugin"
  | "channel"
  | "workflow"
  | "runtime";

export type ToolRegistryInventoryEntry = {
  name: string;
  origin: ToolRegistrationOrigin;
  originId?: string;
  loadingMode: "core" | "deferred";
  contractName?: string;
  contractStatus: "governed" | "missing" | "name-mismatch";
  family?: ToolContract["family"];
  executionAdmission?: ToolExecutionAdmission;
};

export type ToolRegistryReplacement = {
  name: string;
  previousOrigin: ToolRegistrationOrigin;
  nextOrigin: ToolRegistrationOrigin;
};

export type ToolRegistryInventory = {
  catalogGeneration: number;
  totalToolCount: number;
  governedToolCount: number;
  missingContractNames: string[];
  contractNameMismatchNames: string[];
  originCounts: Record<ToolRegistrationOrigin, number>;
  replacementCount: number;
  replacements: ToolRegistryReplacement[];
  entries: ToolRegistryInventoryEntry[];
};

const MAX_LEGACY_DEFERRED_TOOL_SELECTIONS = 16;

export type RegisterToolOptions = {
  /** 标记该 Tool 的运行时来源，供 Doctor 和治理 inventory 使用。 */
  origin?: ToolRegistrationOrigin;
  /** 可选来源标识，例如 plugin id 或 MCP server id。 */
  originId?: string;
  /**
   * 仅用于已有显式覆盖路径。普通重复注册会失败，避免静默覆盖。
   * 保留字段名以兼容现有调用方，替换记录会进入 inventory。
   */
  silentReplace?: boolean;
};

type ToolRegistrationMetadata = {
  origin: ToolRegistrationOrigin;
  originId?: string;
};

const TOOL_REGISTRATION_ORIGINS: ToolRegistrationOrigin[] = [
  "builtin",
  "core",
  "mcp",
  "plugin",
  "channel",
  "workflow",
  "runtime",
];

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => normalizeOptionalString(item))
    .filter((item): item is string => Boolean(item));
  return items.length > 0 ? [...new Set(items)] : undefined;
}

function normalizeLaunchPositiveInteger(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function normalizeLaunchPositiveNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function normalizeBridgeSubtaskSemantics(value: unknown): BridgeSubtaskSemantics | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const kind = normalizeOptionalString(record.kind);
  if (kind !== "analyze" && kind !== "review" && kind !== "patch") {
    return undefined;
  }
  const normalized: BridgeSubtaskSemantics = {
    kind,
    targetId: normalizeOptionalString(record.targetId),
    action: normalizeOptionalString(record.action),
    goalId: normalizeOptionalString(record.goalId),
    goalNodeId: normalizeOptionalString(record.goalNodeId),
    summary: normalizeOptionalString(record.summary),
  };
  return normalized;
}

function normalizeRuntimeLaunchSpec(value: ToolRuntimeLaunchSpec | undefined): ToolRuntimeLaunchSpec | undefined {
  if (!value) return undefined;
  const normalized: ToolRuntimeLaunchSpec = {
    agentId: normalizeOptionalString(value.agentId),
    profileId: normalizeOptionalString(value.profileId),
    instruction: normalizeOptionalString(value.instruction),
    channel: normalizeOptionalString(value.channel),
    background: typeof value.background === "boolean" ? value.background : undefined,
    timeoutMs: Number.isFinite(Number(value.timeoutMs)) && Number(value.timeoutMs) > 0 ? Number(value.timeoutMs) : undefined,
    cwd: normalizeOptionalString(value.cwd),
    toolSet: normalizeStringList(value.toolSet),
    toolDeny: normalizeStringList(value.toolDeny),
    permissionMode: normalizeOptionalString(value.permissionMode),
    isolationMode: normalizeOptionalString(value.isolationMode),
    commandSandbox: normalizeCommandSandboxRequirement(value.commandSandbox),
    maxRunWallTimeMs: normalizeLaunchPositiveInteger(value.maxRunWallTimeMs),
    toolLoopIterationBudget: normalizeLaunchPositiveInteger(value.toolLoopIterationBudget),
    maxTotalTokens: normalizeLaunchPositiveInteger(value.maxTotalTokens),
    maxCostUsd: normalizeLaunchPositiveNumber(value.maxCostUsd),
    parentTaskId: normalizeOptionalString(value.parentTaskId),
    role: normalizeLaunchRole(value.role),
    allowedToolFamilies: normalizeLaunchAllowedToolFamilies(value.allowedToolFamilies),
    maxToolRiskLevel: normalizeLaunchMaxToolRiskLevel(value.maxToolRiskLevel),
    policySummary: normalizeOptionalString(value.policySummary),
    bridgeSubtask: normalizeBridgeSubtaskSemantics(value.bridgeSubtask),
  };
  return Object.values(normalized).some((item) => item !== undefined) ? normalized : undefined;
}

const GOVERNED_BRIDGE_INTERNAL_TOOL_NAMES = new Set([
  "bridge_session_start",
  "bridge_session_write",
  "bridge_session_close",
]);

const STICKY_STARWEAVER_DEFERRED_TOOL_PREFIXES = [
  "mcp_starweaver_central_starweaver_",
  "mcp_starweaver_starweaver_",
];

const STARWEAVER_SMOKE_EXACT_TOOL_SEARCH_QUERY =
  "starweaver_runtime_describe starweaver_wake_signals_peek starweaver_command_peek starweaver_agent_delivery_peek";

const STARWEAVER_SMOKE_EXACT_TOOL_SEARCH_SELECT = [
  "mcp_starweaver_central_starweaver_runtime_describe",
  "mcp_starweaver_central_starweaver_wake_signals_peek",
  "mcp_starweaver_central_starweaver_command_peek",
  "mcp_starweaver_central_starweaver_agent_delivery_peek",
];

function isStickyStarweaverDeferredTool(toolName: string): boolean {
  return STICKY_STARWEAVER_DEFERRED_TOOL_PREFIXES.some((prefix) => toolName.startsWith(prefix));
}

function normalizeAgentWhitelistMode(
  value: unknown,
): "default" | "governed_bridge_internal" | undefined {
  if (value !== "default" && value !== "governed_bridge_internal") {
    return undefined;
  }
  return value;
}

function shouldBypassAgentWhitelist(
  toolName: string,
  launchSpec: ToolRuntimeLaunchSpec | undefined,
  runtimeContext?: ToolExecutionRuntimeContext,
): boolean {
  if (normalizeAgentWhitelistMode(runtimeContext?.agentWhitelistMode) !== "governed_bridge_internal") {
    return false;
  }
  if (!normalizeOptionalString(runtimeContext?.bridgeGovernanceTaskId)) {
    return false;
  }
  if (!launchSpec?.bridgeSubtask) {
    return false;
  }
  return GOVERNED_BRIDGE_INTERNAL_TOOL_NAMES.has(toolName);
}

export type ToolAvailabilityReasonCode =
  | "available"
  | "blocked-by-security-matrix"
  | "unsupported-channel"
  | "outside-safe-scope"
  | "missing-contract"
  | "disabled-by-settings"
  | "not-in-agent-whitelist"
  | "conversation-restricted"
  | "excluded-by-launch-toolset"
  | "denied-by-launch-tool-deny"
  | "blocked-by-launch-role-policy"
  | "blocked-by-launch-permission-mode";

export interface ToolAvailabilityState {
  name: string;
  available: boolean;
  alwaysEnabled: boolean;
  reasonCode: ToolAvailabilityReasonCode;
  reasonMessage: string;
  contractReason?: ToolContractDenialReason;
}

type ToolContextSnapshot = {
  loaded: Set<string>;
  available: Tool[];
  exposed: Tool[];
};

type ToolArgumentValidationIssue = {
  path: string;
  code: "missing_required" | "invalid_type" | "invalid_value";
  message: string;
  expected?: string;
  receivedType?: string;
};

type ToolArgumentPreflightResult = {
  arguments: JsonObject;
  corrected: boolean;
  blocked: boolean;
  corrections: string[];
  issues: ToolArgumentValidationIssue[];
};

const TOOL_SEARCH_ARGUMENT_ALIASES: Record<string, string> = {
  expandFamily: "expandFamilies",
  family: "expandFamilies",
  families: "expandFamilies",
  load: "select",
  loadTools: "select",
  selected: "select",
  selectedTools: "select",
  unloadTools: "unload",
  keep: "shrinkTo",
  keepLoaded: "shrinkTo",
  reset: "resetLoaded",
  topic: "query",
  intent: "query",
};

function cloneJsonObject(value: JsonObject): JsonObject {
  try {
    return JSON.parse(JSON.stringify(value)) as JsonObject;
  } catch {
    return { ...value };
  }
}

function describeValueType(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeTrimmedString(value: string): string {
  return value.trim();
}

function normalizeStringArrayValue(value: unknown): string[] | undefined {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => normalizeTrimmedString(item))
      .filter(Boolean);
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .flatMap((item) => typeof item === "string" ? item.split(",") : [])
    .map((item) => normalizeTrimmedString(item))
    .filter(Boolean);
}

function applyToolSearchArgumentAliases(args: JsonObject, corrections: string[]): void {
  for (const [alias, canonical] of Object.entries(TOOL_SEARCH_ARGUMENT_ALIASES)) {
    if (!(alias in args) || canonical in args) {
      continue;
    }
    args[canonical] = args[alias];
    delete args[alias];
    corrections.push(`Mapped \`${alias}\` to \`${canonical}\`.`);
  }
}

function normalizeToolSearchArguments(args: JsonObject, corrections: string[]): void {
  applyToolSearchArgumentAliases(args, corrections);

  for (const key of ["query"] as const) {
    if (typeof args[key] === "string") {
      const normalized = normalizeWhitespace(args[key] as string);
      if (normalized !== args[key]) {
        args[key] = normalized;
        corrections.push(`Trimmed whitespace in \`${key}\`.`);
      }
    }
  }

  if (
    typeof args.query === "string"
    && normalizeWhitespace(args.query) === STARWEAVER_SMOKE_EXACT_TOOL_SEARCH_QUERY
    && !("select" in args)
  ) {
    args.select = [...STARWEAVER_SMOKE_EXACT_TOOL_SEARCH_SELECT];
    corrections.push("Auto-filled `select` for the fixed StarWeaver smoke exact-query path.");
  }

  for (const key of ["expandFamilies", "select", "unload", "shrinkTo"] as const) {
    if (!(key in args)) {
      continue;
    }
    const normalized = normalizeStringArrayValue(args[key]);
    if (!normalized) {
      continue;
    }
    const original = args[key];
    args[key] = normalized;
    if (!Array.isArray(original)) {
      corrections.push(`Coerced \`${key}\` from ${describeValueType(original)} to string[].`);
    } else if (JSON.stringify(original) !== JSON.stringify(normalized)) {
      corrections.push(`Normalized \`${key}\` entries into trimmed string values.`);
    }
  }

  if (typeof args.resetLoaded === "string") {
    const normalized = normalizeWhitespace(args.resetLoaded).toLowerCase();
    if (normalized === "true" || normalized === "false") {
      args.resetLoaded = normalized === "true";
      corrections.push("Coerced `resetLoaded` from string to boolean.");
    }
  }

  if (typeof args.maxResults === "string") {
    const parsed = Number.parseInt(normalizeWhitespace(args.maxResults), 10);
    if (Number.isFinite(parsed)) {
      args.maxResults = parsed;
      corrections.push("Coerced `maxResults` from string to number.");
    }
  }
}

function normalizeArgumentsBySchema(
  args: JsonObject,
  schema: Tool["definition"]["parameters"] | undefined,
): {
  corrected: boolean;
  corrections: string[];
  issues: ToolArgumentValidationIssue[];
} {
  if (!schema || typeof schema !== "object") {
    return { corrected: false, corrections: [], issues: [] };
  }

  const corrections: string[] = [];
  const issues: ToolArgumentValidationIssue[] = [];
  const properties = schema.properties ?? {};

  for (const [key, property] of Object.entries(properties)) {
    if (!(key in args)) {
      continue;
    }
    const currentValue = args[key];
    switch (property.type) {
      case "string": {
        if (typeof currentValue === "string") {
          const enumValues = Array.isArray(property.enum)
            ? property.enum.filter((item): item is string => typeof item === "string")
            : [];
          if (enumValues.length > 0) {
            if (enumValues.includes(currentValue)) {
              break;
            }
            const trimmed = normalizeTrimmedString(currentValue);
            if (trimmed !== currentValue && enumValues.includes(trimmed)) {
              args[key] = trimmed;
              corrections.push(`Trimmed whitespace in \`${key}\`.`);
              break;
            }
            issues.push({
              path: key,
              code: "invalid_value",
              message: `参数 \`${key}\` 的取值不在允许列表中。`,
              expected: enumValues.join(", "),
              receivedType: describeValueType(currentValue),
            });
          }
        } else if (
          typeof currentValue === "number"
          || typeof currentValue === "boolean"
        ) {
          args[key] = String(currentValue);
          corrections.push(`Coerced \`${key}\` from ${describeValueType(currentValue)} to string.`);
        } else {
          issues.push({
            path: key,
            code: "invalid_type",
            message: `参数 \`${key}\` 必须是 string。`,
            expected: "string",
            receivedType: describeValueType(currentValue),
          });
        }
        break;
      }
      case "number": {
        if (typeof currentValue === "number" && Number.isFinite(currentValue)) {
          break;
        }
        if (typeof currentValue === "string") {
          const parsed = Number(currentValue.trim());
          if (Number.isFinite(parsed)) {
            args[key] = parsed;
            corrections.push(`Coerced \`${key}\` from string to number.`);
            break;
          }
        }
        issues.push({
          path: key,
          code: "invalid_type",
          message: `参数 \`${key}\` 必须是 number。`,
          expected: "number",
          receivedType: describeValueType(currentValue),
        });
        break;
      }
      case "boolean": {
        if (typeof currentValue === "boolean") {
          break;
        }
        if (typeof currentValue === "string") {
          const normalized = currentValue.trim().toLowerCase();
          if (normalized === "true" || normalized === "false") {
            args[key] = normalized === "true";
            corrections.push(`Coerced \`${key}\` from string to boolean.`);
            break;
          }
        }
        issues.push({
          path: key,
          code: "invalid_type",
          message: `参数 \`${key}\` 必须是 boolean。`,
          expected: "boolean",
          receivedType: describeValueType(currentValue),
        });
        break;
      }
      case "array": {
        if (Array.isArray(currentValue)) {
          if (property.items?.type === "string") {
            if (currentValue.every((item) => typeof item === "string")) {
              break;
            }
            if (currentValue.every((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")) {
              const normalized = currentValue.map((item) => typeof item === "string" ? item : String(item));
              if (JSON.stringify(currentValue) !== JSON.stringify(normalized)) {
                args[key] = normalized;
                corrections.push(`Coerced \`${key}\` array entries to strings.`);
              }
              break;
            }
            issues.push({
              path: key,
              code: "invalid_type",
              message: `参数 \`${key}\` 必须是 string[]。`,
              expected: "string[]",
              receivedType: describeValueType(currentValue),
            });
          }
          break;
        }
        if (property.items?.type === "string") {
          const normalized = normalizeStringArrayValue(currentValue);
          if (normalized) {
            args[key] = normalized;
            corrections.push(`Coerced \`${key}\` from ${describeValueType(currentValue)} to string[].`);
            break;
          }
        }
        issues.push({
          path: key,
          code: "invalid_type",
          message: `参数 \`${key}\` 必须是 array。`,
          expected: "array",
          receivedType: describeValueType(currentValue),
        });
        break;
      }
      case "object": {
        if (
          currentValue
          && typeof currentValue === "object"
          && !Array.isArray(currentValue)
        ) {
          break;
        }
        if (typeof currentValue === "string") {
          try {
            const parsed = JSON.parse(currentValue);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              args[key] = parsed as JsonObject[keyof JsonObject];
              corrections.push(`Parsed \`${key}\` from JSON string into object.`);
              break;
            }
          } catch {
            // noop
          }
        }
        issues.push({
          path: key,
          code: "invalid_type",
          message: `参数 \`${key}\` 必须是 object。`,
          expected: "object",
          receivedType: describeValueType(currentValue),
        });
        break;
      }
      default:
        break;
    }
  }

  for (const key of schema.required ?? []) {
    const value = args[key];
    if (
      typeof value === "undefined"
      || value === null
      || (typeof value === "string" && !value.trim())
      || (Array.isArray(value) && value.length === 0)
    ) {
      issues.push({
        path: key,
        code: "missing_required",
        message: `缺少必填参数 \`${key}\`。`,
      });
    }
  }

  return {
    corrected: corrections.length > 0,
    corrections,
    issues,
  };
}

function buildToolArgumentCorrectionHints(
  schema: Tool["definition"]["parameters"] | undefined,
  issues: ToolArgumentValidationIssue[],
): string[] {
  const hints = new Set<string>();
  for (const issue of issues) {
    const property = schema?.properties?.[issue.path];
    switch (issue.code) {
      case "missing_required":
        hints.add(`补上必填字段 \`${issue.path}\`。`);
        break;
      case "invalid_type":
        if (property?.type === "array" && property.items?.type === "string") {
          hints.add(`把 \`${issue.path}\` 改成字符串数组，例如 \`{\"${issue.path}\":[\"...\"]}\`。`);
        } else if (property?.type) {
          hints.add(`把 \`${issue.path}\` 改成 ${property.type} 类型。`);
        }
        break;
      case "invalid_value":
        hints.add(`检查 \`${issue.path}\` 的取值是否合法。`);
        break;
      default:
        break;
    }
  }
  return Array.from(hints);
}

function summarizeArgumentValidationIssues(issues: ToolArgumentValidationIssue[]): string {
  if (issues.length === 0) {
    return "参数校验失败。";
  }
  if (issues.length === 1) {
    return issues[0]?.message ?? "参数校验失败。";
  }
  return `${issues[0]?.message ?? "参数校验失败。"} 另有 ${issues.length - 1} 个参数问题。`;
}

function buildToolArgumentPreflightMetadata(
  tool: Tool,
  preflight: ToolArgumentPreflightResult,
): JsonObject | undefined {
  if (!preflight.corrected && preflight.issues.length === 0) {
    return undefined;
  }
  const correctionHints = buildToolArgumentCorrectionHints(tool.definition.parameters, preflight.issues);
  return {
    repairAction: preflight.blocked ? "tool_arguments_invalid" : "tool_arguments_corrected",
    argumentValidation: {
      corrected: preflight.corrected,
      blocked: preflight.blocked,
      corrections: preflight.corrections,
      issues: preflight.issues.map((issue) => ({
        path: issue.path,
        code: issue.code,
        message: issue.message,
        ...(issue.expected ? { expected: issue.expected } : {}),
        ...(issue.receivedType ? { receivedType: issue.receivedType } : {}),
      })),
      correctionHints,
    },
  };
}

function mergeToolResultMetadata(result: ToolCallResult, extraMetadata?: JsonObject): ToolCallResult {
  if (!extraMetadata) {
    return result;
  }
  const existingMetadata = result.metadata && typeof result.metadata === "object" && !Array.isArray(result.metadata)
    ? result.metadata
    : undefined;
  return {
    ...result,
    metadata: existingMetadata
      ? { ...existingMetadata, ...extraMetadata }
      : extraMetadata,
  };
}

function preflightToolArguments(tool: Tool, args: JsonObject): ToolArgumentPreflightResult {
  const normalizedArgs = cloneJsonObject(args);
  const toolSpecificCorrections: string[] = [];

  if (tool.definition.name === "tool_search") {
    normalizeToolSearchArguments(normalizedArgs, toolSpecificCorrections);
  }

  const schemaNormalization = normalizeArgumentsBySchema(normalizedArgs, tool.definition.parameters);
  const corrections = [...toolSpecificCorrections, ...schemaNormalization.corrections];
  const dedupedCorrections = Array.from(new Set(corrections));
  const issues = schemaNormalization.issues.filter((issue, index, list) =>
    list.findIndex((candidate) => candidate.path === issue.path && candidate.code === issue.code) === index,
  );

  return {
    arguments: normalizedArgs,
    corrected: dedupedCorrections.length > 0,
    blocked: issues.length > 0,
    corrections: dedupedCorrections,
    issues,
  };
}

export class ToolExecutor {
  private readonly tools: Map<string, Tool>;
  private readonly toolRegistrationMetadata = new Map<string, ToolRegistrationMetadata>();
  private readonly registryReplacements: ToolRegistryReplacement[] = [];
  private catalogGeneration = 0;
  private readonly workspaceRoot: string;
  private readonly stateDir: string;
  private readonly extraWorkspaceRoots: string[];
  private readonly alwaysEnabledTools: Set<string>;
  private readonly policy: ToolPolicy;
  private readonly auditDispatcher?: ToolAuditDispatcher;
  private agentCapabilities?: AgentCapabilities;
  private goalCapabilities?: GoalCapabilities;
  private readonly logger?: ToolExecutorLogger;
  private readonly isToolDisabled?: (toolName: string) => boolean;
  private readonly isToolAllowedForAgent?: (
    toolName: string,
    agentId?: string,
    role?: ToolRuntimeLaunchSpec["role"],
  ) => boolean;
  private readonly isToolAllowedInConversation?: (toolName: string, conversationId: string, agentId?: string) => boolean;
  private readonly getAgentCatalogPreferences?: (agentId?: string) => { methods?: string[]; skills?: string[] } | undefined;
  private readonly contractAccessPolicy?: ToolContractAccessPolicy;
  private readonly permissionController?: ToolPermissionController;
  private readonly requireToolContracts: boolean;
  private conversationStore?: ConversationStoreInterface; // 移除 readonly，允许后期绑定
  private allowedConversationKinds?: ConversationAccessKind[];
  private readonly tokenCounters = new Map<string, ITokenCounterService>(); // 每个 conversation 的 token 计数器
  private readonly deferredToolNames: Set<string>;
  private readonly loadedDeferredToolNames = new Map<string, Set<string>>();
  private broadcast?: (event: string, payload: Record<string, unknown>) => void;
  private mcp?: MCPRuntimeCapabilities;
  private workspaceMutationObserver?: WorkspaceMutationObserver;
  private bridgeSessionGovernance?: BridgeSessionGovernanceCapabilities;
  private workflowRuntime?: WorkflowRuntimeCapabilities;
  private broadcastObserver?: (event: string, payload: Record<string, unknown>, meta: {
    conversationId: string;
    agentId?: string;
    toolName: string;
  }) => void;
  private readonly onTokenCounterSet?: (conversationId: string, counter: ITokenCounterService) => void;
  private readonly maxBatchToolCalls: number;
  private readonly maxConcurrentToolCalls: number;

  constructor(options: ToolExecutorOptions) {
    this.tools = new Map();
    this.workspaceRoot = options.workspaceRoot;
    this.stateDir = options.stateDir ?? options.workspaceRoot;
    this.extraWorkspaceRoots = options.extraWorkspaceRoots ?? [];
    this.alwaysEnabledTools = new Set(options.alwaysEnabledTools ?? []);
    this.policy = { ...DEFAULT_POLICY, ...options.policy };
    this.auditDispatcher = options.auditLogger
      ? new ToolAuditDispatcher(options.auditLogger, { maxQueueSize: options.maxAuditQueueSize })
      : undefined;
    this.agentCapabilities = options.agentCapabilities;
    this.goalCapabilities = options.goalCapabilities;
    this.logger = options.logger;
    this.isToolDisabled = options.isToolDisabled;
    this.isToolAllowedForAgent = options.isToolAllowedForAgent;
    this.isToolAllowedInConversation = options.isToolAllowedInConversation;
    this.getAgentCatalogPreferences = options.getAgentCatalogPreferences;
    this.contractAccessPolicy = options.contractAccessPolicy;
    this.permissionController = options.permissionController;
    this.requireToolContracts = options.requireToolContracts ?? false;
    this.deferredToolNames = new Set(options.deferredToolNames ?? []);
    this.conversationStore = options.conversationStore;
    this.allowedConversationKinds = options.allowedConversationKinds;
    this.broadcast = options.broadcast;
    this.mcp = options.mcp;
    this.workspaceMutationObserver = options.workspaceMutationObserver;
    this.bridgeSessionGovernance = options.bridgeSessionGovernance;
    this.broadcastObserver = options.broadcastObserver;
    this.onTokenCounterSet = options.onTokenCounterSet;
    this.maxBatchToolCalls = normalizePositiveInteger(
      options.maxBatchToolCalls,
      DEFAULT_MAX_BATCH_TOOL_CALLS,
    );
    this.maxConcurrentToolCalls = normalizePositiveInteger(
      options.maxConcurrentToolCalls,
      DEFAULT_MAX_CONCURRENT_TOOL_CALLS,
    );

    for (const tool of options.tools) {
      this.registerTool(tool, { origin: options.initialToolOrigin ?? "builtin" });
    }
  }

  /**
   * Late-bind agentCapabilities (for cases where the orchestrator is created after the executor).
   */
  setAgentCapabilities(caps: AgentCapabilities): void {
    this.agentCapabilities = caps;
  }

  setGoalCapabilities(caps: GoalCapabilities): void {
    this.goalCapabilities = caps;
  }

  /**
   * Late-bind conversationStore (for cases where the store is created after the executor).
   */
  setConversationStore(store: ConversationStoreInterface): void {
    this.conversationStore = store;
  }

  setAllowedConversationKinds(kinds?: ConversationAccessKind[]): void {
    this.allowedConversationKinds = kinds;
  }

  setBroadcast(
    broadcast?: (event: string, payload: Record<string, unknown>) => void,
  ): void {
    this.broadcast = broadcast;
  }

  setMcpCapabilities(mcp?: MCPRuntimeCapabilities): void {
    this.mcp = mcp;
  }

  setBridgeSessionGovernance(
    governance?: BridgeSessionGovernanceCapabilities,
  ): void {
    this.bridgeSessionGovernance = governance;
  }

  setWorkflowRuntime(runtime?: WorkflowRuntimeCapabilities): void {
    this.workflowRuntime = runtime;
  }

  setBroadcastObserver(
    observer?: (event: string, payload: Record<string, unknown>, meta: {
      conversationId: string;
      agentId?: string;
      toolName: string;
    }) => void,
  ): void {
    this.broadcastObserver = observer;
  }

  /**
   * Set token counter for a specific conversation (for task-level token tracking).
   */
  setTokenCounter(conversationId: string, counter: ITokenCounterService): void {
    this.tokenCounters.set(conversationId, counter);
    if (!this.onTokenCounterSet) {
      return;
    }
    try {
      this.onTokenCounterSet(conversationId, counter);
    } catch (error) {
      this.logger?.warn(
        `Token counter set callback failed for conversation ${conversationId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Clear token counter for a specific conversation (cleanup after run).
   */
  clearTokenCounter(conversationId: string): void {
    this.tokenCounters.delete(conversationId);
  }

  /**
   * 释放会话级纯内存状态。持久化的 loaded selection 仍由 ConversationStore 拥有，
   * 后续恢复同一会话时可重新加载，不能在这里写入空 selection 改变用户状态。
   */
  releaseConversation(conversationId: string): void {
    this.tokenCounters.delete(conversationId);
    this.loadedDeferredToolNames.delete(conversationId);

    // Tool 自己拥有内部 registry；单个清理失败不能阻断其他 owner 或顶层会话释放。
    for (const tool of this.tools.values()) {
      if (!tool.releaseConversation) {
        continue;
      }
      try {
        tool.releaseConversation(conversationId);
      } catch (error) {
        const failureKind = error instanceof Error ? error.name : "unknown_error";
        this.logger?.warn(
          `Tool conversation cleanup failed for ${tool.definition.name}: ${failureKind}`,
        );
      }
    }
  }

  /**
   * Get token counter for a specific conversation (used by hooks for auto boundary detection).
   */
  getTokenCounter(conversationId: string): ITokenCounterService | undefined {
    return this.tokenCounters.get(conversationId);
  }

  /** 获取所有工具定义（用于发送给模型），已过滤禁用工具和 Agent 白名单 */
  getDefinitions(
    agentId?: string,
    conversationId?: string,
    runtimeContext?: ToolExecutionRuntimeContext,
  ): { type: "function"; function: { name: string; description: string; parameters: object } }[] {
    const snapshot = this.buildToolContextSnapshot(agentId, conversationId, runtimeContext);
    return snapshot.exposed.map(t => ({
      type: "function" as const,
      function: {
        name: t.definition.name,
        description: t.definition.description,
        parameters: t.definition.parameters,
      },
    }));
  }

  /** 获取所有已注册工具名（不经过 disabled 过滤，用于调用设置列表） */
  getRegisteredToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /** 获取单个已注册 Tool 的 contract，供动态注册后的治理路径查询。 */
  getRegisteredToolContract(name: string): ToolContract | undefined {
    const tool = this.tools.get(name);
    return tool ? getToolContract(tool) : undefined;
  }

  /**
   * 返回稳定的运行时注册清单。它不替代权限判定，只用于诊断 coverage 和来源漂移。
   */
  getRegistryInventory(): ToolRegistryInventory {
    const originCounts = Object.fromEntries(
      TOOL_REGISTRATION_ORIGINS.map((origin) => [origin, 0]),
    ) as Record<ToolRegistrationOrigin, number>;
    const entries = Array.from(this.tools.entries())
      .map(([name, tool]) => {
        const registration = this.toolRegistrationMetadata.get(name) ?? { origin: "runtime" as const };
        const contract = getToolContract(tool);
        const contractStatus = !contract
          ? "missing" as const
          : contract.name === name
            ? "governed" as const
            : "name-mismatch" as const;
        originCounts[registration.origin] += 1;
        return {
          name,
          origin: registration.origin,
          ...(registration.originId ? { originId: registration.originId } : {}),
          loadingMode: tool.definition.loadingMode ?? "core",
          ...(contract ? { contractName: contract.name } : {}),
          ...(contract ? { family: contract.family } : {}),
          ...(contract?.executionAdmission ? { executionAdmission: contract.executionAdmission } : {}),
          contractStatus,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));

    return {
      catalogGeneration: this.catalogGeneration,
      totalToolCount: entries.length,
      governedToolCount: entries.filter((entry) => entry.contractStatus === "governed").length,
      missingContractNames: entries
        .filter((entry) => entry.contractStatus === "missing")
        .map((entry) => entry.name),
      contractNameMismatchNames: entries
        .filter((entry) => entry.contractStatus === "name-mismatch")
        .map((entry) => entry.name),
      originCounts,
      replacementCount: this.registryReplacements.length,
      replacements: this.registryReplacements.map((replacement) => ({ ...replacement })),
      entries,
    };
  }

  getCatalogEntries(
    agentId?: string,
    conversationId?: string,
    runtimeContext?: ToolExecutionRuntimeContext,
  ): ToolCatalogEntry[] {
    const snapshot = this.buildToolContextSnapshot(agentId, conversationId, runtimeContext);
    return this.buildCatalogEntriesFromAvailableTools(snapshot.available, snapshot.loaded);
  }

  getDiscoveryFamilyEntries(
    agentId?: string,
    conversationId?: string,
    runtimeContext?: ToolExecutionRuntimeContext,
  ): ToolCatalogFamilyEntry[] {
    const snapshot = this.buildToolContextSnapshot(agentId, conversationId, runtimeContext);
    return this.buildDiscoveryFamilyEntriesFromAvailableTools(snapshot.available, snapshot.loaded);
  }

  getDiscoveryEntries(
    agentId?: string,
    conversationId?: string,
    runtimeContext?: ToolExecutionRuntimeContext,
    options?: ToolDiscoveryEntriesOptions,
  ): ToolDiscoveryEntry[] {
    const snapshot = this.buildToolContextSnapshot(agentId, conversationId, runtimeContext);
    const familyEntries = this.buildDiscoveryFamilyEntriesFromAvailableTools(snapshot.available, snapshot.loaded);
    const familyById = new Map(familyEntries.map((entry) => [entry.id, entry]));
    const expandedFamilyIds = new Set(
      (options?.expandedFamilyIds ?? [])
        .map((item) => item.trim())
        .filter(Boolean),
    );
    const toolEntries = this.buildCatalogEntriesFromAvailableTools(snapshot.available, snapshot.loaded)
      .filter((entry) => {
        if (!entry.discoveryFamilyId) {
          return true;
        }
        const family = familyById.get(entry.discoveryFamilyId);
        if (!family || family.gateMode !== "hidden-until-expanded") {
          return true;
        }
        return expandedFamilyIds.has(entry.discoveryFamilyId);
      });

    const results: ToolDiscoveryEntry[] = [];
    const pushedFamilies = new Set<string>();
    for (const family of familyEntries) {
      results.push(family);
      pushedFamilies.add(family.id);
      if (family.gateMode !== "hidden-until-expanded" || expandedFamilyIds.has(family.id)) {
        for (const tool of toolEntries) {
          if (tool.discoveryFamilyId === family.id) {
            results.push(tool);
          }
        }
      }
    }

    for (const tool of toolEntries) {
      if (!tool.discoveryFamilyId || !pushedFamilies.has(tool.discoveryFamilyId)) {
        results.push(tool);
      }
    }

    return results;
  }

  buildDeferredToolDiscoveryPromptSummary(
    agentId?: string,
    conversationId?: string,
    runtimeContext?: ToolExecutionRuntimeContext,
  ): string | undefined {
    const familyEntries = this.getDiscoveryFamilyEntries(agentId, conversationId, runtimeContext)
      .filter((entry) => entry.gateMode === "hidden-until-expanded");
    if (familyEntries.length === 0) {
      return undefined;
    }

    const lines: string[] = [
      "## Builtin Heavy Tool Discovery",
      "",
      "Some builtin tool families are intentionally gated to reduce prompt bloat and accidental misselection.",
      "Use the following workflow for heavy builtin families:",
      "1. Use `tool_search` or `tool_search {\"query\":\"...\"}` to inspect family summaries or exact deferred tool matches first.",
      "2. If the query already returns the exact deferred tool names you need, load them in the same turn with `tool_search {\"select\":[\"tool_name\"]}` instead of waiting for another search turn.",
      "3. Only use `tool_search {\"expandFamilies\":[\"family_id\"]}` when you need to open a gated family to discover exact member names first.",
      "4. If an exact schema is already loaded and still visible in this conversation, call it directly instead of searching again.",
      "Routing note: do not treat `dream` / 梦境 / memory-runtime work as `canvas` by default. Use the canvas family only for explicit board / node / edge / layout tasks.",
      "",
      "Heavy builtin families:",
    ];

    for (const family of familyEntries) {
      lines.push(
        `- ${family.id} (${family.title}) | tools=${family.toolCount} | loaded=${family.loadedToolCount} | ${family.summary}`,
      );
    }

    return lines.join("\n");
  }

  getLoadedDeferredToolNames(conversationId: string): Set<string> {
    const persisted = this.conversationStore?.getLoadedToolNames?.(conversationId) ?? [];
    const cached = this.loadedDeferredToolNames.get(conversationId);
    if (cached && persisted.length === 0) {
      if (cached.size === 0) {
        this.loadedDeferredToolNames.delete(conversationId);
      }
      return new Set(cached);
    }
    const merged = new Set<string>([
      ...persisted,
      ...(cached ? Array.from(cached) : []),
    ]);
    const normalized = this.normalizeLoadedDeferredToolNames(conversationId, merged);
    if (normalized.size > 0) {
      this.loadedDeferredToolNames.set(conversationId, normalized);
    } else {
      this.loadedDeferredToolNames.delete(conversationId);
    }
    return new Set(normalized);
  }

  getLoadedDeferredToolList(conversationId: string): string[] {
    return Array.from(this.getLoadedDeferredToolNames(conversationId)).sort((left, right) => left.localeCompare(right));
  }

  private async persistLoadedDeferredToolNames(conversationId: string, toolNames: Iterable<string>): Promise<string[]> {
    const next = new Set<string>();
    for (const rawName of toolNames) {
      const name = rawName.trim();
      if (!name || !this.isDeferredTool(name) || !this.tools.has(name)) {
        continue;
      }
      next.add(name);
    }
    const normalized = Array.from(this.normalizeLoadedDeferredToolNames(conversationId, next))
      .sort((left, right) => left.localeCompare(right));
    if (normalized.length > 0) {
      this.loadedDeferredToolNames.set(conversationId, new Set(normalized));
    } else {
      // 空选择仍持久化到 store，但不应为只读或已清空的高基数会话保留内存项。
      this.loadedDeferredToolNames.delete(conversationId);
    }
    await this.conversationStore?.setLoadedToolNames?.(conversationId, normalized);
    return normalized;
  }

  async loadDeferredTools(conversationId: string, toolNames: string[]): Promise<string[]> {
    const next = this.getLoadedDeferredToolNames(conversationId);
    const loadedNow: string[] = [];

    for (const rawName of toolNames) {
      const name = rawName.trim();
      if (!name || !this.isDeferredTool(name) || !this.tools.has(name)) {
        continue;
      }
      if (!next.has(name)) {
        next.add(name);
      }
      loadedNow.push(name);
    }

    await this.persistLoadedDeferredToolNames(conversationId, next);
    return loadedNow;
  }

  async unloadDeferredTools(conversationId: string, toolNames: string[]): Promise<string[]> {
    const next = this.getLoadedDeferredToolNames(conversationId);
    const removed: string[] = [];

    for (const rawName of toolNames) {
      const name = rawName.trim();
      if (!name) {
        continue;
      }
      if (next.delete(name)) {
        removed.push(name);
      }
    }

    await this.persistLoadedDeferredToolNames(conversationId, next);
    return removed.sort((left, right) => left.localeCompare(right));
  }

  async shrinkLoadedDeferredTools(conversationId: string, toolNamesToKeep: string[]): Promise<string[]> {
    const allowed = new Set(
      toolNamesToKeep
        .map((item) => item.trim())
        .filter(Boolean),
    );
    const current = this.getLoadedDeferredToolNames(conversationId);
    const retained = Array.from(current).filter((name) => allowed.has(name));
    await this.persistLoadedDeferredToolNames(conversationId, retained);
    return retained.sort((left, right) => left.localeCompare(right));
  }

  async clearLoadedDeferredTools(conversationId: string): Promise<void> {
    await this.persistLoadedDeferredToolNames(conversationId, []);
  }

  async consumeLoadedDeferredToolsForNextTurn(conversationId: string): Promise<string[]> {
    const current = this.getLoadedDeferredToolList(conversationId);
    if (current.length === 0) {
      return [];
    }
    const sticky = current.filter((name) => isStickyStarweaverDeferredTool(name));
    await this.persistLoadedDeferredToolNames(conversationId, sticky);
    return current;
  }

  /** 获取单个工具在当前上下文下的可见性结果 */
  getToolAvailability(
    toolName: string,
    agentId?: string,
    conversationId?: string,
    runtimeContext?: ToolExecutionRuntimeContext,
  ): ToolAvailabilityState | undefined {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return undefined;
    }
    return this.evaluateToolAvailability(tool, agentId, conversationId, runtimeContext);
  }

  /** 获取所有已注册工具在当前上下文下的可见性结果 */
  getRegisteredToolAvailabilities(
    agentId?: string,
    conversationId?: string,
    runtimeContext?: ToolExecutionRuntimeContext,
  ): ToolAvailabilityState[] {
    return Array.from(this.tools.values()).map((tool) =>
      this.evaluateToolAvailability(tool, agentId, conversationId, runtimeContext),
    );
  }

  /** 获取当前运行时可见的工具契约元数据 */
  getContracts(agentId?: string, conversationId?: string, runtimeContext?: ToolExecutionRuntimeContext): ToolContract[] {
    const snapshot = this.buildToolContextSnapshot(agentId, conversationId, runtimeContext);
    return snapshot.available.flatMap((tool) => {
      const contract = getToolContract(tool);
      return contract ? [contract] : [];
    });
  }

  /** 获取所有已注册工具的契约元数据（不过滤 disabled / allowlist） */
  getRegisteredToolContracts(): ToolContract[] {
    return Array.from(this.tools.values()).flatMap((tool) => {
      const contract = getToolContract(tool);
      return contract ? [contract] : [];
    });
  }

  /** 检查工具是否存在 */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /** 动态注册工具 */
  registerTool(tool: Tool, options?: RegisterToolOptions): void {
    const toolName = tool.definition.name;
    if (!toolName || toolName !== toolName.trim()) {
      throw new Error("Tool registration requires a non-empty trimmed tool name.");
    }

    const contract = getToolContract(tool);
    if (contract && contract.name !== toolName) {
      throw new Error(`Tool "${toolName}" has a contract name mismatch: ${contract.name}`);
    }
    if (this.requireToolContracts && !contract) {
      throw new Error(`Tool "${toolName}" is missing a ToolContract in this strict runtime.`);
    }

    const previous = this.toolRegistrationMetadata.get(toolName);
    if (this.tools.has(toolName) && !options?.silentReplace) {
      throw new Error(`Duplicate tool registration: ${toolName}`);
    }
    const origin = options?.origin ?? "runtime";
    if (previous) {
      this.registryReplacements.push({
        name: toolName,
        previousOrigin: previous.origin,
        nextOrigin: origin,
      });
    }
    this.tools.set(toolName, tool);
    this.toolRegistrationMetadata.set(toolName, {
      origin,
      ...(options?.originId ? { originId: options.originId } : {}),
    });
    this.catalogGeneration += 1;
  }

  /** 返回不含审计正文的旁路水位，供运行诊断识别 sink 故障或背压。 */
  getAuditRuntimeSnapshot(): ToolAuditDispatcherSnapshot | undefined {
    return this.auditDispatcher?.getSnapshot();
  }

  /** 动态注销工具 */
  unregisterTool(name: string): boolean {
    const deleted = this.tools.delete(name);
    if (deleted) {
      this.toolRegistrationMetadata.delete(name);
      this.catalogGeneration += 1;
    }
    return deleted;
  }

  /** 获取已注册的工具数量 */
  getToolCount(): number {
    return this.tools.size;
  }

  /** 执行工具调用 */
  async execute(
    request: ToolCallRequest,
    conversationId: string,
    agentId?: string,
    userUuid?: string,
    senderInfo?: any,
    roomContext?: any,
    runtimeContext?: ToolExecutionRuntimeContext,
  ): Promise<ToolCallResult> {
    const start = Date.now();
    const launchSpec = normalizeRuntimeLaunchSpec(runtimeContext?.launchSpec);
    const parentAbortSignal = runtimeContext?.abortSignal;

    const tool = this.tools.get(request.name);

    if (!tool) {
      const result = buildFailureToolCallResult({
        id: request.id,
        name: request.name,
        start,
        error: `未知工具：${request.name}`,
        failureKind: "input_error",
      });
      this.audit(result, conversationId, request.arguments);
      return result;
    }

    // 防御性检查：拒绝已禁用或不在 Agent 白名单中的工具调用
    const availability = this.evaluateToolAvailability(tool, agentId, conversationId, runtimeContext);
    if (!availability.allowed) {
      const result = buildFailureToolCallResult({
        id: request.id,
        name: request.name,
        start,
        error: availability.reasonMessage,
        failureKind: "permission_or_policy",
      });
      this.audit(result, conversationId, request.arguments);
      return result;
    }

    const commandJobAction = request.name === "command_job" && typeof request.arguments.action === "string"
      ? request.arguments.action
      : undefined;
    const commandSandboxAdmission = commandJobAction && commandJobAction !== "start"
      ? { allowed: true } as const
      : await evaluateCommandSandboxAdmission({
        family: getToolContract(tool)?.family,
        launchSpec,
        readEnv: (name) => {
          const value = process.env[name];
          return value && value.trim() ? value.trim() : undefined;
        },
      });
    if (!commandSandboxAdmission.allowed) {
      const result = buildFailureToolCallResult({
        id: request.id,
        name: request.name,
        start,
        error: commandSandboxAdmission.message,
        failureKind: "permission_or_policy",
        metadata: commandSandboxAdmission.metadata,
      });
      this.audit(result, conversationId, request.arguments);
      return result;
    }

    if ((request.name === "run_command" || (request.name === "command_job" && commandJobAction === "start"))
      && getToolContract(tool)?.family === "command-exec"
      && launchSpec?.commandSandbox === "required") {
      const commandPlan = parseCommandPlan(request.arguments.commandPlan);
      if (!commandPlan.ok) {
        const result = buildFailureToolCallResult({
          id: request.id,
          name: request.name,
          start,
          error: commandPlan.message,
          failureKind: "input_error",
          metadata: { commandPlanErrorCode: commandPlan.code },
        });
        this.audit(result, conversationId, request.arguments);
        return result;
      }
    }

    const argumentPreflight = preflightToolArguments(tool, request.arguments);
    const argumentValidationMetadata = buildToolArgumentPreflightMetadata(tool, argumentPreflight);
    const effectiveArguments = argumentPreflight.arguments;

    if (argumentPreflight.corrected) {
      this.logger?.warn?.(
        `[tool-args] corrected tool arguments for ${request.name}: ${argumentPreflight.corrections.join(" | ")}`,
      );
    }
    if (argumentPreflight.blocked) {
      const result = buildFailureToolCallResult({
        id: request.id,
        name: request.name,
        start,
        error: `工具参数未通过预检：${summarizeArgumentValidationIssues(argumentPreflight.issues)}`,
        failureKind: "input_error",
        metadata: argumentValidationMetadata,
      });
      this.audit(result, conversationId, request.arguments);
      return result;
    }

    const deadlineAdmission = createToolExecutionDeadlineAdmission(tool, this.policy, parentAbortSignal);
    const abortSignal = deadlineAdmission?.abortSignal ?? parentAbortSignal;
    const context: ToolContext = {
      conversationId,
      workspaceRoot: this.workspaceRoot,
      stateDir: this.stateDir,
      abortSignal,
      extraWorkspaceRoots: this.extraWorkspaceRoots.length > 0 ? this.extraWorkspaceRoots : undefined,
      defaultCwd: launchSpec?.cwd,
      workspaceRevisionId: normalizeOptionalString(runtimeContext?.workspaceRevisionId),
      workspaceMutationObserver: this.workspaceMutationObserver,
      agentId,
      agentCatalogPreferences: this.getAgentCatalogPreferences?.(agentId),
      launchSpec,
      userUuid, // 传递UUID
      senderInfo, // 传递发送者信息
      roomContext, // 传递房间上下文
      conversationStore: this.conversationStore, // 传递会话存储（用于缓存）
      allowedConversationKinds: this.allowedConversationKinds,
      bridgeSessionGovernance: this.bridgeSessionGovernance,
      bridgeGovernanceTaskId: normalizeOptionalString(runtimeContext?.bridgeGovernanceTaskId),
      readEnv: (name) => {
        const value = process.env[name];
        return value && value.trim() ? value.trim() : undefined;
      },
      tokenCounter: this.tokenCounters.get(conversationId), // 传递 token 计数器（任务级统计）
      broadcast: this.broadcast
        ? (event, payload) => {
          const broadcast = this.broadcast;
          this.broadcastObserver?.(event, payload, {
            conversationId,
            agentId,
            toolName: request.name,
          });
          broadcast?.(event, payload);
        }
        : undefined, // 传递事件广播回调（扩展 B）
      policy: this.policy,
      agentCapabilities: this.agentCapabilities,
      goalCapabilities: this.goalCapabilities,
      logger: this.logger ? {
        info: (m) => this.logger!.info(m),
        warn: (m) => this.logger!.warn(m),
        error: (m) => this.logger!.error(m),
        debug: this.logger!.debug ? (m) => this.logger!.debug!(m) : () => {},
        trace: () => {},
      } : undefined,
      mcp: this.mcp,
      workflowRuntime: this.workflowRuntime,
    };

    if (abortSignal?.aborted) {
      const result = buildFailureToolCallResult({
        id: request.id,
        name: request.name,
        start,
        error: readAbortReason(abortSignal),
        failureKind: "environment_error",
      });
      deadlineAdmission?.cleanup();
      this.audit(result, conversationId, request.arguments);
      return result;
    }

    if (this.requiresPendingPermission(tool, launchSpec, runtimeContext)) {
      let decision: "allow" | "deny" = "deny";
      try {
        const commandPreview = buildCommandPermissionPreview({
          toolName: request.name,
          arguments: effectiveArguments,
        });
        decision = await this.permissionController!.request({
          conversationId,
          agentRunId: runtimeContext!.agentRunId!.trim(),
          ...(normalizeOptionalString(runtimeContext?.worktreeId)
            ? { worktreeId: normalizeOptionalString(runtimeContext?.worktreeId) }
            : {}),
          toolCallId: request.id,
          toolName: request.name,
          ...(commandPreview ? { commandPreview } : {}),
          ...(parentAbortSignal ? { abortSignal: parentAbortSignal } : {}),
        });
      } catch {
        // 权限控制器故障不得让需要确认的工具降级为可执行。
      }
      if (decision !== "allow") {
        const result = buildFailureToolCallResult({
          id: request.id,
          name: request.name,
          start,
          error: "Tool permission was not granted.",
          failureKind: "permission_or_policy",
        });
        this.audit(result, conversationId, request.arguments);
        return result;
      }
    }

    try {
      const execution = tool.execute(effectiveArguments, context);
      const executedResult = await raceWithAbort(execution, abortSignal);
      if (deadlineAdmission?.wasTimedOut()) {
        const result = buildFailureToolCallResult({
          id: request.id,
          name: request.name,
          start,
          error: `工具执行超时（${deadlineAdmission.deadlineMs}ms）`,
          failureKind: "environment_error",
          metadata: {
            deadlineExceeded: true,
            deadlineMs: deadlineAdmission.deadlineMs,
            lateResultDiscarded: true,
          },
        });
        this.audit(result, conversationId, request.arguments);
        return result;
      }
      const result = applyToolResultOutputAdmission(
        tool,
        normalizeToolCallResultFailureKind(executedResult),
        this.policy,
      );
      // 确保 id 匹配请求
      result.id = request.id;
      result.durationMs = Date.now() - start;
      const finalResult = mergeToolResultMetadata(result, argumentValidationMetadata);
      this.audit(finalResult, conversationId, request.arguments);
      return finalResult;
    } catch (err) {
      const result = buildFailureToolCallResult({
        id: request.id,
        name: request.name,
        start,
        error: deadlineAdmission?.wasTimedOut()
          ? `工具执行超时（${deadlineAdmission.deadlineMs}ms）`
          : isAbortError(err)
          ? readAbortReason(abortSignal)
          : (err instanceof Error ? err.message : String(err)),
        metadata: deadlineAdmission?.wasTimedOut()
          ? {
            ...(argumentValidationMetadata ?? {}),
            deadlineExceeded: true,
            deadlineMs: deadlineAdmission.deadlineMs,
            lateResultDiscarded: true,
          }
          : argumentValidationMetadata,
        ...(isAbortError(err) || deadlineAdmission?.wasTimedOut()
          ? { failureKind: "environment_error" as const }
          : {}),
      });
      this.audit(result, conversationId, request.arguments);
      return result;
    } finally {
      deadlineAdmission?.cleanup();
    }
  }

  /** 批量执行：整批先校验容量，再用有序 worker pool 限制并行数。 */
  async executeAll(
    requests: ToolCallRequest[],
    conversationId: string,
    agentId?: string,
    userUuid?: string,
    senderInfo?: any,
    roomContext?: any,
    runtimeContext?: ToolExecutionRuntimeContext,
  ): Promise<ToolCallResult[]> {
    if (requests.length > this.maxBatchToolCalls) {
      const error = `Tool batch size ${requests.length} exceeds limit ${this.maxBatchToolCalls}.`;
      return requests.map((request) => {
        const result = buildFailureToolCallResult({
          id: request.id,
          name: request.name,
          start: Date.now(),
          error,
          failureKind: "permission_or_policy",
          metadata: {
            batchRejected: true,
            batchSize: requests.length,
            batchLimit: this.maxBatchToolCalls,
          },
        });
        this.audit(result, conversationId, request.arguments);
        return result;
      });
    }

    const results = new Array<ToolCallResult>(requests.length);
    let nextIndex = 0;
    const workerCount = Math.min(this.maxConcurrentToolCalls, requests.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= requests.length) {
          return;
        }
        const request = requests[index]!;
        results[index] = await this.execute(
          request,
          conversationId,
          agentId,
          userUuid,
          senderInfo,
          roomContext,
          runtimeContext,
        );
      }
    });
    await Promise.all(workers);
    return results;
  }

  private audit(result: ToolCallResult, conversationId: string, args: JsonObject): void {
    if (!this.auditDispatcher) return;

    // 审计事件先在当前调用栈完成有界脱敏，再交给旁路 dispatcher 异步投递。
    try {
      const auditArguments = sanitizeCommandPlanForAudit(args);
      const redactedArguments = redactSensitiveValue(auditArguments, {
        maxDepth: 6,
        maxKeys: 50,
        maxArrayEntries: 50,
        maxStringBytes: 1024,
        maxTotalBytes: 4096,
      }) as JsonObject;
      this.auditDispatcher.enqueue({
        timestamp: new Date().toISOString(),
        conversationId,
        toolName: result.name,
        argumentsSummary: summarizeAuditText(JSON.stringify(redactedArguments)),
        safeArguments: projectSafeAuditArguments(auditArguments),
        success: result.success,
        outputSummary: summarizeAuditText(result.output),
        errorSummary: result.error ? summarizeAuditText(result.error) : undefined,
        failureKind: result.failureKind,
        durationMs: result.durationMs,
      });
    } catch {
      try {
        this.logger?.warn?.("[tool-audit] audit sink failed; tool result was preserved");
      } catch {
        // 日志实现本身不可用时保持审计旁路，不再传播第二个异常。
      }
    }
  }

  private evaluateToolAvailability(
    tool: Tool,
    agentId?: string,
    conversationId?: string,
    runtimeContext?: ToolExecutionRuntimeContext,
  ):
    | ({ allowed: true } & ToolAvailabilityState)
    | ({ allowed: false } & ToolAvailabilityState & { reason: "contract" | "runtime" | "disabled" | "agent" | "conversation"; contractDecision?: ToolContractAccessDecision }) {
    const toolName = tool.definition.name;
    const alwaysEnabled = this.alwaysEnabledTools.has(toolName);
    const launchSpec = normalizeRuntimeLaunchSpec(runtimeContext?.launchSpec);
    const bypassAgentWhitelist = shouldBypassAgentWhitelist(toolName, launchSpec, runtimeContext);
    const contractAccessPolicy = this.resolveContractAccessPolicy(runtimeContext);

    if (contractAccessPolicy) {
      const contractDecision = evaluateToolContractAccess(tool, contractAccessPolicy);
      if (!contractDecision.allowed) {
        return {
          ...this.buildAvailabilityState(toolName, alwaysEnabled, false, contractDecision.reason),
          allowed: false,
          reason: "contract",
          contractDecision,
        };
      }
    }

    if (launchSpec?.toolDeny?.includes(toolName)) {
      return {
        ...this.buildAvailabilityState(toolName, alwaysEnabled, false, "denied-by-launch-tool-deny"),
        allowed: false,
        reason: "runtime",
      };
    }

    if (launchSpec?.toolSet && !launchSpec.toolSet.includes(toolName)) {
      return {
        ...this.buildAvailabilityState(toolName, alwaysEnabled, false, "excluded-by-launch-toolset"),
        allowed: false,
        reason: "runtime",
      };
    }

    const rolePolicyDecision = evaluateLaunchRolePolicy(tool, launchSpec);
    if (!rolePolicyDecision.allowed) {
      return {
        name: toolName,
        available: false,
        alwaysEnabled,
        reasonCode: "blocked-by-launch-role-policy",
        reasonMessage: rolePolicyDecision.reasonMessage,
        allowed: false,
        reason: "runtime",
      };
    }

    const permissionDecision = evaluateLaunchPermissionMode(tool, launchSpec);
    if (!permissionDecision.allowed && !this.requiresPendingPermission(tool, launchSpec, runtimeContext)) {
      return {
        name: toolName,
        available: false,
        alwaysEnabled,
        reasonCode: "blocked-by-launch-permission-mode",
        reasonMessage: permissionDecision.reasonMessage,
        allowed: false,
        reason: "runtime",
      };
    }

    if (!alwaysEnabled && this.isToolDisabled?.(toolName)) {
      return {
        ...this.buildAvailabilityState(toolName, alwaysEnabled, false, "disabled-by-settings"),
        allowed: false,
        reason: "disabled",
      };
    }

    if (!bypassAgentWhitelist && this.isToolAllowedForAgent && !this.isToolAllowedForAgent(toolName, agentId, launchSpec?.role)) {
      return {
        ...this.buildAvailabilityState(toolName, alwaysEnabled, false, "not-in-agent-whitelist"),
        allowed: false,
        reason: "agent",
      };
    }

    if (conversationId && this.isToolAllowedInConversation && !this.isToolAllowedInConversation(toolName, conversationId, agentId)) {
      return {
        ...this.buildAvailabilityState(toolName, alwaysEnabled, false, "conversation-restricted"),
        allowed: false,
        reason: "conversation",
      };
    }

    return {
      ...this.buildAvailabilityState(toolName, alwaysEnabled, true, "available"),
      allowed: true,
    };
  }

  private requiresPendingPermission(
    tool: Tool,
    launchSpec: ToolRuntimeLaunchSpec | undefined,
    runtimeContext?: ToolExecutionRuntimeContext,
  ): boolean {
    return normalizeLaunchPermissionMode(launchSpec?.permissionMode) === "confirm"
      && getToolContract(tool)?.needsPermission === true
      && Boolean(this.permissionController)
      && Boolean(normalizeOptionalString(runtimeContext?.agentRunId));
  }

  private resolveContractAccessPolicy(
    runtimeContext?: ToolExecutionRuntimeContext,
  ): ToolContractAccessPolicy | undefined {
    const runtimeChannel = runtimeContext?.channel;
    if (!runtimeChannel) {
      return this.contractAccessPolicy;
    }

    const runtimeSafeScopes = new Set(resolveSafeScopesForChannel(runtimeChannel));
    const basePolicy = this.contractAccessPolicy;
    const allowedSafeScopes = basePolicy?.allowedSafeScopes
      ? [...new Set(basePolicy.allowedSafeScopes)].filter((scope) => runtimeSafeScopes.has(scope))
      : [...runtimeSafeScopes];

    return {
      ...basePolicy,
      channel: runtimeChannel,
      allowedSafeScopes,
    };
  }

  private getAvailableTools(
    agentId?: string,
    conversationId?: string,
    runtimeContext?: ToolExecutionRuntimeContext,
  ): Tool[] {
    return Array.from(this.tools.values()).filter((tool) =>
      this.evaluateToolAvailability(tool, agentId, conversationId, runtimeContext).allowed,
    );
  }

  private getExposedTools(
    agentId?: string,
    conversationId?: string,
    runtimeContext?: ToolExecutionRuntimeContext,
  ): Tool[] {
    return this.buildToolContextSnapshot(agentId, conversationId, runtimeContext).exposed;
  }

  private buildToolContextSnapshot(
    agentId?: string,
    conversationId?: string,
    runtimeContext?: ToolExecutionRuntimeContext,
  ): ToolContextSnapshot {
    const available = this.getAvailableTools(agentId, conversationId, runtimeContext);
    if (!conversationId) {
      return {
        loaded: new Set<string>(),
        available,
        exposed: available,
      };
    }
    const loaded = this.getLoadedDeferredToolNames(conversationId);
    const exposed = available.filter((tool) => {
      if (!this.isDeferredTool(tool.definition.name)) {
        return true;
      }
      return loaded.has(tool.definition.name);
    });
    return { loaded, available, exposed };
  }

  private buildCatalogEntriesFromAvailableTools(
    available: Tool[],
    loaded: Set<string>,
  ): ToolCatalogEntry[] {
    return available.map((tool) => {
      const deferred = this.isDeferredTool(tool.definition.name);
      return {
        kind: "tool",
        name: tool.definition.name,
        description: tool.definition.description,
        shortDescription: tool.definition.shortDescription?.trim() || tool.definition.description,
        keywords: tool.definition.keywords ?? [],
        tags: tool.definition.tags ?? [],
        loadingMode: deferred ? "deferred" : "core",
        loaded: deferred ? loaded.has(tool.definition.name) : true,
        discoveryFamilyId: tool.definition.discoveryFamily?.id,
      };
    });
  }

  private buildDiscoveryFamilyEntriesFromAvailableTools(
    available: Tool[],
    loaded: Set<string>,
  ): ToolCatalogFamilyEntry[] {
    const families = new Map<string, {
      definition: ToolDiscoveryFamilyDefinition;
      toolCount: number;
      loadedToolCount: number;
    }>();

    for (const tool of available) {
      const family = tool.definition.discoveryFamily;
      if (!family) continue;
      const entry = families.get(family.id) ?? {
        definition: family,
        toolCount: 0,
        loadedToolCount: 0,
      };
      entry.toolCount += 1;
      if (loaded.has(tool.definition.name)) {
        entry.loadedToolCount += 1;
      }
      families.set(family.id, entry);
    }

    return Array.from(families.values())
      .sort((left, right) => {
        const leftOrder = left.definition.order ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = right.definition.order ?? Number.MAX_SAFE_INTEGER;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return left.definition.title.localeCompare(right.definition.title);
      })
      .map((entry) => ({
        kind: "family",
        id: entry.definition.id,
        title: entry.definition.title,
        summary: entry.definition.summary,
        keywords: entry.definition.keywords ?? [],
        toolCount: entry.toolCount,
        loadedToolCount: entry.loadedToolCount,
        loadingMode: "deferred",
        gateMode: entry.definition.gateMode ?? "none",
      }));
  }

  private isDeferredTool(toolName: string): boolean {
    const tool = this.tools.get(toolName);
    if (tool?.definition.loadingMode === "deferred") {
      return true;
    }
    if (tool?.definition.loadingMode === "core") {
      return false;
    }
    return this.deferredToolNames.has(toolName);
  }

  private normalizeLoadedDeferredToolNames(
    conversationId: string,
    toolNames: Iterable<string>,
  ): Set<string> {
    const normalized = Array.from(new Set(
      Array.from(toolNames)
        .map((item) => item.trim())
        .filter((item) => item && this.isDeferredTool(item) && this.tools.has(item)),
    ));
    if (normalized.length <= MAX_LEGACY_DEFERRED_TOOL_SELECTIONS) {
      return new Set(normalized);
    }

    const recentToolNames = this.readRecentDeferredToolNames(conversationId, normalized);
    const pruned: string[] = [];
    const seen = new Set<string>();
    for (const name of recentToolNames) {
      if (!seen.has(name)) {
        pruned.push(name);
        seen.add(name);
      }
    }
    for (const name of normalized) {
      if (pruned.length >= MAX_LEGACY_DEFERRED_TOOL_SELECTIONS) {
        break;
      }
      if (!seen.has(name)) {
        pruned.push(name);
        seen.add(name);
      }
    }

    if (pruned.length < normalized.length) {
      this.logger?.warn?.(
        `[tool-search] auto-pruned stale deferred tool selections for ${conversationId}: ${normalized.length} -> ${pruned.length}`,
      );
      void this.conversationStore?.setLoadedToolNames?.(conversationId, pruned);
    }

    return new Set(pruned);
  }

  private readRecentDeferredToolNames(
    conversationId: string,
    candidateNames: string[],
  ): string[] {
    const conversationStore = this.conversationStore as (ConversationStoreInterface & {
      getToolDigests?: (
        conversationId: string,
        limit?: number,
      ) => Array<{ toolName?: string }>;
    }) | undefined;
    const digests = conversationStore?.getToolDigests?.(conversationId, 64) ?? [];
    if (digests.length === 0) {
      return [];
    }
    const candidates = new Set(candidateNames);
    const recent: string[] = [];
    const seen = new Set<string>();
    for (let index = digests.length - 1; index >= 0; index -= 1) {
      const toolName = normalizeOptionalString(digests[index]?.toolName);
      if (!toolName || !candidates.has(toolName) || seen.has(toolName)) {
        continue;
      }
      recent.push(toolName);
      seen.add(toolName);
      if (recent.length >= MAX_LEGACY_DEFERRED_TOOL_SELECTIONS) {
        break;
      }
    }
    return recent;
  }

  private buildAvailabilityState(
    toolName: string,
    alwaysEnabled: boolean,
    available: boolean,
    reason: ToolAvailabilityReasonCode | ToolContractDenialReason | undefined,
  ): ToolAvailabilityState {
    const normalizedReason = this.normalizeAvailabilityReasonCode(reason);
    return {
      name: toolName,
      available,
      alwaysEnabled,
      reasonCode: normalizedReason,
      reasonMessage: this.describeAvailabilityReason(toolName, normalizedReason),
      contractReason: this.isContractDenialReason(reason) ? reason : undefined,
    };
  }

  private normalizeAvailabilityReasonCode(
    reason: ToolAvailabilityReasonCode | ToolContractDenialReason | undefined,
  ): ToolAvailabilityReasonCode {
    switch (reason) {
      case "available":
      case "disabled-by-settings":
      case "not-in-agent-whitelist":
      case "conversation-restricted":
      case "excluded-by-launch-toolset":
      case "denied-by-launch-tool-deny":
      case "blocked-by-launch-role-policy":
      case "blocked-by-launch-permission-mode":
        return reason;
      case "channel":
        return "unsupported-channel";
      case "safe-scope":
        return "outside-safe-scope";
      case "missing-contract":
        return "missing-contract";
      case "blocked":
        return "blocked-by-security-matrix";
      default:
        return "blocked-by-security-matrix";
    }
  }

  private isContractDenialReason(
    reason: ToolAvailabilityReasonCode | ToolContractDenialReason | undefined,
  ): reason is ToolContractDenialReason {
    return reason === "blocked" || reason === "channel" || reason === "safe-scope" || reason === "missing-contract";
  }

  private describeAvailabilityReason(
    toolName: string,
    reasonCode: ToolAvailabilityReasonCode,
  ): string {
    switch (reasonCode) {
      case "available":
        return `工具 ${toolName} 当前可用`;
      case "blocked-by-security-matrix":
        return `工具 ${toolName} 当前被安全矩阵阻止`;
      case "unsupported-channel":
        return `工具 ${toolName} 不允许在当前端使用`;
      case "outside-safe-scope":
        return `工具 ${toolName} 超出当前安全域`;
      case "missing-contract":
        return `工具 ${toolName} 缺少 contract，当前安全矩阵不允许使用`;
      case "disabled-by-settings":
        return `工具 ${toolName} 已被禁用`;
      case "not-in-agent-whitelist":
        return `工具 ${toolName} 不在当前 Agent 白名单内`;
      case "conversation-restricted":
        return `工具 ${toolName} 不允许在当前会话中使用`;
      case "excluded-by-launch-toolset":
        return `工具 ${toolName} 不在当前 launchSpec 的 toolSet 内`;
      case "denied-by-launch-tool-deny":
        return `工具 ${toolName} 被当前 launchSpec 的 toolDeny 拒绝`;
      case "blocked-by-launch-role-policy":
        return `工具 ${toolName} 被当前 launchSpec 的 role policy 阻止`;
      case "blocked-by-launch-permission-mode":
        return `工具 ${toolName} 被当前 launchSpec 的 permissionMode 阻止`;
      default:
        return `工具 ${toolName} 当前不可用`;
    }
  }
}

function summarizeAuditText(value: string): { bytes: number; sha256: string } {
  const redacted = redactSensitiveText(value);
  return {
    bytes: Buffer.byteLength(redacted, "utf-8"),
    sha256: crypto.createHash("sha256").update(redacted, "utf-8").digest("hex"),
  };
}

function projectSafeAuditArguments(args: JsonObject): { ackMatched?: boolean } | undefined {
  return typeof args.ackMatched === "boolean"
    ? { ackMatched: args.ackMatched }
    : undefined;
}
