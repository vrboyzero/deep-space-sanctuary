import crypto from "node:crypto";
import type { JsonObject } from "@belldandy/protocol";
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
  ToolRuntimeLaunchSpec,
  ToolCatalogEntry,
  ToolCatalogFamilyEntry,
  ToolDiscoveryEntry,
  ToolDiscoveryEntriesOptions,
  ToolDiscoveryFamilyDefinition,
  MCPRuntimeCapabilities,
  WorkflowRuntimeCapabilities,
} from "./types.js";
import { getToolContract, type ToolContract } from "./tool-contract.js";
import {
  evaluateLaunchPermissionMode,
  evaluateLaunchRolePolicy,
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
import { isAbortError, readAbortReason } from "./abort-utils.js";
import {
  buildFailureToolCallResult,
  normalizeToolCallResultFailureKind,
} from "./failure-kind.js";

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
  auditLogger?: (log: ToolAuditLog) => void;
  agentCapabilities?: AgentCapabilities;
  goalCapabilities?: GoalCapabilities;
  /** 可选：传入后注入到 ToolContext，供工具使用 */
  logger?: ToolExecutorLogger;
  /** 可选：运行时判断工具是否被禁用（用于调用设置开关） */
  isToolDisabled?: (toolName: string) => boolean;
  /** 可选：运行时判断工具是否允许给指定 Agent 使用（用于 per-agent toolWhitelist） */
  isToolAllowedForAgent?: (toolName: string, agentId?: string) => boolean;
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
  /** 可选：按会话延迟加载的工具名 */
  deferredToolNames?: string[];
};

const MAX_LEGACY_DEFERRED_TOOL_SELECTIONS = 16;

type RegisterToolOptions = {
  silentReplace?: boolean;
};

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
    permissionMode: normalizeOptionalString(value.permissionMode),
    isolationMode: normalizeOptionalString(value.isolationMode),
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
  private readonly workspaceRoot: string;
  private readonly stateDir: string;
  private readonly extraWorkspaceRoots: string[];
  private readonly alwaysEnabledTools: Set<string>;
  private readonly policy: ToolPolicy;
  private readonly auditLogger?: (log: ToolAuditLog) => void;
  private agentCapabilities?: AgentCapabilities;
  private goalCapabilities?: GoalCapabilities;
  private readonly logger?: ToolExecutorLogger;
  private readonly isToolDisabled?: (toolName: string) => boolean;
  private readonly isToolAllowedForAgent?: (toolName: string, agentId?: string) => boolean;
  private readonly isToolAllowedInConversation?: (toolName: string, conversationId: string, agentId?: string) => boolean;
  private readonly getAgentCatalogPreferences?: (agentId?: string) => { methods?: string[]; skills?: string[] } | undefined;
  private readonly contractAccessPolicy?: ToolContractAccessPolicy;
  private conversationStore?: ConversationStoreInterface; // 移除 readonly，允许后期绑定
  private allowedConversationKinds?: ConversationAccessKind[];
  private readonly tokenCounters = new Map<string, ITokenCounterService>(); // 每个 conversation 的 token 计数器
  private readonly deferredToolNames: Set<string>;
  private readonly loadedDeferredToolNames = new Map<string, Set<string>>();
  private broadcast?: (event: string, payload: Record<string, unknown>) => void;
  private mcp?: MCPRuntimeCapabilities;
  private bridgeSessionGovernance?: BridgeSessionGovernanceCapabilities;
  private workflowRuntime?: WorkflowRuntimeCapabilities;
  private broadcastObserver?: (event: string, payload: Record<string, unknown>, meta: {
    conversationId: string;
    agentId?: string;
    toolName: string;
  }) => void;
  private readonly onTokenCounterSet?: (conversationId: string, counter: ITokenCounterService) => void;

  constructor(options: ToolExecutorOptions) {
    this.tools = new Map(options.tools.map(t => [t.definition.name, t]));
    this.workspaceRoot = options.workspaceRoot;
    this.stateDir = options.stateDir ?? options.workspaceRoot;
    this.extraWorkspaceRoots = options.extraWorkspaceRoots ?? [];
    this.alwaysEnabledTools = new Set(options.alwaysEnabledTools ?? []);
    this.policy = { ...DEFAULT_POLICY, ...options.policy };
    this.auditLogger = options.auditLogger;
    this.agentCapabilities = options.agentCapabilities;
    this.goalCapabilities = options.goalCapabilities;
    this.logger = options.logger;
    this.isToolDisabled = options.isToolDisabled;
    this.isToolAllowedForAgent = options.isToolAllowedForAgent;
    this.isToolAllowedInConversation = options.isToolAllowedInConversation;
    this.getAgentCatalogPreferences = options.getAgentCatalogPreferences;
    this.contractAccessPolicy = options.contractAccessPolicy;
    this.deferredToolNames = new Set(options.deferredToolNames ?? []);
    this.conversationStore = options.conversationStore;
    this.allowedConversationKinds = options.allowedConversationKinds;
    this.broadcast = options.broadcast;
    this.mcp = options.mcp;
    this.bridgeSessionGovernance = options.bridgeSessionGovernance;
    this.broadcastObserver = options.broadcastObserver;
    this.onTokenCounterSet = options.onTokenCounterSet;
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
      return new Set(cached);
    }
    const merged = new Set<string>([
      ...persisted,
      ...(cached ? Array.from(cached) : []),
    ]);
    const normalized = this.normalizeLoadedDeferredToolNames(conversationId, merged);
    this.loadedDeferredToolNames.set(conversationId, normalized);
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
    this.loadedDeferredToolNames.set(conversationId, new Set(normalized));
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
    if (this.tools.has(tool.definition.name) && !options?.silentReplace) {
      (this.logger?.warn ?? console.warn)(`[ToolExecutor] 工具 "${tool.definition.name}" 已存在，将被覆盖`);
    }
    this.tools.set(tool.definition.name, tool);
  }

  /** 动态注销工具 */
  unregisterTool(name: string): boolean {
    return this.tools.delete(name);
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
    const abortSignal = runtimeContext?.abortSignal;

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

    const context: ToolContext = {
      conversationId,
      workspaceRoot: this.workspaceRoot,
      stateDir: this.stateDir,
      abortSignal,
      extraWorkspaceRoots: this.extraWorkspaceRoots.length > 0 ? this.extraWorkspaceRoots : undefined,
      defaultCwd: launchSpec?.cwd,
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
      this.audit(result, conversationId, request.arguments);
      return result;
    }

    try {
      const result = normalizeToolCallResultFailureKind(await tool.execute(effectiveArguments, context));
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
        error: isAbortError(err)
          ? readAbortReason(abortSignal)
          : (err instanceof Error ? err.message : String(err)),
        metadata: argumentValidationMetadata,
        ...(isAbortError(err) ? { failureKind: "environment_error" as const } : {}),
      });
      this.audit(result, conversationId, request.arguments);
      return result;
    }
  }

  /** 批量执行（并行） */
  async executeAll(
    requests: ToolCallRequest[],
    conversationId: string,
    agentId?: string,
    userUuid?: string,
    senderInfo?: any,
    roomContext?: any,
    runtimeContext?: ToolExecutionRuntimeContext,
  ): Promise<ToolCallResult[]> {
    return Promise.all(requests.map((req) => this.execute(
      req,
      conversationId,
      agentId,
      userUuid,
      senderInfo,
      roomContext,
      runtimeContext,
    )));
  }

  private audit(result: ToolCallResult, conversationId: string, args: JsonObject): void {
    if (!this.auditLogger) return;

    // 脱敏：不记录可能包含敏感信息的完整输出
    const safeOutput = result.output.length > 200
      ? result.output.slice(0, 200) + "...(truncated)"
      : result.output;

    this.auditLogger({
      timestamp: new Date().toISOString(),
      conversationId,
      toolName: result.name,
      arguments: sanitizeArgs(args),
      success: result.success,
      output: safeOutput,
      error: result.error,
      failureKind: result.failureKind,
      durationMs: result.durationMs,
    });
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
    if (!permissionDecision.allowed) {
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

    if (!bypassAgentWhitelist && this.isToolAllowedForAgent && !this.isToolAllowedForAgent(toolName, agentId)) {
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
      case "blocked-by-launch-role-policy":
        return `工具 ${toolName} 被当前 launchSpec 的 role policy 阻止`;
      case "blocked-by-launch-permission-mode":
        return `工具 ${toolName} 被当前 launchSpec 的 permissionMode 阻止`;
      default:
        return `工具 ${toolName} 当前不可用`;
    }
  }
}

/** 脱敏参数（移除可能的敏感字段） */
function sanitizeArgs(args: JsonObject): JsonObject {
  const sensitiveKeys = ["password", "token", "key", "secret", "api_key", "apikey"];
  const result: JsonObject = {};

  for (const [k, v] of Object.entries(args)) {
    if (sensitiveKeys.some(s => k.toLowerCase().includes(s))) {
      result[k] = "[REDACTED]";
    } else {
      result[k] = v;
    }
  }

  return result;
}
