/**
 * Agent Profile 配置体系
 *
 * 为多 Agent 预备的配置层。每个 AgentProfile 描述一个 Agent 的完整配置，
 * 通过 `model` 字段引用 models.json 中的 ModelProfile（避免重复存储密钥）。
 */

import fs from "node:fs";

import type { ToolContractFamily, ToolContractRiskLevel } from "@belldandy/skills";
import type { ModelProfile } from "./failover-client.js";

// ─── Types ───────────────────────────────────────────────────────────────

const AGENT_PROFILE_KINDS = ["resident", "worker"] as const;
const AGENT_WORKSPACE_BINDINGS = ["current", "custom"] as const;
const AGENT_MEMORY_MODES = ["shared", "isolated", "hybrid"] as const;
const AGENT_DEFAULT_ROLES = ["default", "coder", "researcher", "verifier"] as const;
const AGENT_PERMISSION_MODES = ["plan", "acceptEdits", "confirm"] as const;
const AGENT_HANDOFF_STYLES = ["summary", "structured"] as const;

export type AgentProfileKind = typeof AGENT_PROFILE_KINDS[number];
export type AgentWorkspaceBinding = typeof AGENT_WORKSPACE_BINDINGS[number];
export type AgentMemoryMode = typeof AGENT_MEMORY_MODES[number];
export type AgentProfileDefaultRole = typeof AGENT_DEFAULT_ROLES[number];
export type AgentProfileDefaultPermissionMode = typeof AGENT_PERMISSION_MODES[number];
export type AgentProfileHandoffStyle = typeof AGENT_HANDOFF_STYLES[number];

export type AgentProfileCatalogMetadata = {
  whenToUse: string[];
  defaultRole: AgentProfileDefaultRole;
  defaultPermissionMode?: AgentProfileDefaultPermissionMode;
  defaultAllowedToolFamilies?: ToolContractFamily[];
  defaultMaxToolRiskLevel?: ToolContractRiskLevel;
  methods: string[];
  skills: string[];
  handoffStyle: AgentProfileHandoffStyle;
};

/**
 * Agent Profile：描述一个可配置的 Agent 人格/能力集
 */
export type AgentProfile = {
  /** 唯一标识（如 "default", "coder", "researcher"） */
  id: string;
  /** 显示名称（用于日志和 UI） */
  displayName: string;
  /**
   * 模型引用：
   * - "primary" → 使用环境变量配置（BELLDANDY_OPENAI_*）
   * - 其他字符串 → 引用 models.json 中 ModelProfile.name 匹配的条目
   */
  model: string;
  /** 追加到系统提示词末尾的额外内容 */
  systemPromptOverride?: string;
  /** @deprecated 使用 workspaceDir 替代。指向不同的 SOUL 文件（如 "SOUL-coder.md"） */
  soulFile?: string;
  /** Agent 类型。resident 会进入 Resident roster；worker 供后续委派/子代理语义使用 */
  kind?: AgentProfileKind;
  /** 工作区绑定模式。current 表示跟随当前项目；custom 为后续异项目绑定预留 */
  workspaceBinding?: AgentWorkspaceBinding;
  /** Agent 专属 workspace 目录名（位于 ~/.star_sanctuary/agents/{workspaceDir}/），默认等于 id */
  workspaceDir?: string;
  /** 会话命名空间。默认等于 agent id 的安全 token */
  sessionNamespace?: string;
  /** 记忆模式。默认 hybrid */
  memoryMode?: AgentMemoryMode;
  /** 何时优先使用该 Agent */
  whenToUse?: string[];
  /** launch 默认角色 */
  defaultRole?: AgentProfileDefaultRole;
  /** launch 默认 permissionMode */
  defaultPermissionMode?: AgentProfileDefaultPermissionMode;
  /** launch 默认允许的工具族 */
  defaultAllowedToolFamilies?: ToolContractFamily[];
  /** launch 默认最大工具风险等级 */
  defaultMaxToolRiskLevel?: ToolContractRiskLevel;
  /** 推荐注入或优先参考的 skills */
  skills?: string[];
  /** 推荐优先参考的 methods（按方法文件名标识） */
  methods?: string[];
  /** handoff 风格，供 catalog / inspect / launch default 使用 */
  handoffStyle?: AgentProfileHandoffStyle;
  /** 是否启用工具（覆盖环境变量 BELLDANDY_TOOLS_ENABLED） */
  toolsEnabled?: boolean;
  /** 可用工具白名单（仅这些工具对该 Agent 可用） */
  toolWhitelist?: string[];
  /** 最大输入 token 数覆盖 */
  maxInputTokens?: number;
  /** 单次模型调用最大输出 token 数覆盖（调大可避免长输出被截断导致工具调用 JSON 损坏） */
  maxOutputTokens?: number;
};

/**
 * agents.json 文件结构
 */
export type AgentConfigFile = {
  agents: AgentProfile[];
};

export type ResolvedAgentProfileMetadata = {
  kind: AgentProfileKind;
  workspaceBinding: AgentWorkspaceBinding;
  workspaceDir: string;
  sessionNamespace: string;
  memoryMode: AgentMemoryMode;
  catalog: AgentProfileCatalogMetadata;
};

export const MANUAL_MODEL_OVERRIDE_PREFIX = "manual:";

// ─── Functions ───────────────────────────────────────────────────────────

function normalizeEnumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return (allowed as readonly string[]).includes(normalized) ? normalized as T[number] : undefined;
}

function normalizeSessionNamespace(value: string, fallback: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || fallback;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  return items.length > 0 ? [...new Set(items)] : undefined;
}

function stripUtf8Bom(raw: string): string {
  return raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
}

const ROLE_DEFAULT_ALLOWED_TOOL_FAMILIES: Partial<Record<AgentProfileDefaultRole, ToolContractFamily[]>> = {
  coder: ["workspace-read", "workspace-write", "patch", "command-exec", "memory", "goal-governance"],
  researcher: ["network-read", "workspace-read", "browser", "memory", "goal-governance"],
  verifier: ["workspace-read", "command-exec", "browser", "memory", "goal-governance"],
};

const ROLE_DEFAULT_PERMISSION_MODE: Partial<Record<AgentProfileDefaultRole, AgentProfileDefaultPermissionMode>> = {
  researcher: "plan",
  coder: "confirm",
  verifier: "confirm",
};

const ROLE_DEFAULT_MAX_RISK_LEVEL: Partial<Record<AgentProfileDefaultRole, ToolContractRiskLevel>> = {
  researcher: "medium",
  coder: "high",
  verifier: "high",
};

const BUILTIN_WORKER_PROFILES: readonly AgentProfile[] = [
  {
    id: "commander",
    displayName: "Commander",
    model: "primary",
    kind: "worker",
    workspaceBinding: "current",
    workspaceDir: "commander",
    memoryMode: "hybrid",
    whenToUse: [
      "需要拆解复杂任务并协调多个 Agent 分工",
      "需要在实现、审查、返工、验收之间做编排与收口",
    ],
    defaultRole: "default",
    defaultPermissionMode: "confirm",
    defaultAllowedToolFamilies: [
      "workspace-read",
      "browser",
      "memory",
      "goal-governance",
      "session-orchestration",
    ],
    defaultMaxToolRiskLevel: "high",
    handoffStyle: "structured",
  },
  {
    id: "verifier",
    displayName: "Verifier",
    model: "primary",
    kind: "worker",
    workspaceBinding: "current",
    workspaceDir: "verifier",
    memoryMode: "hybrid",
    whenToUse: [
      "需要独立做验证、回归检查与证据审查",
      "需要在交付前确认结论有测试或可观察行为支撑",
    ],
    defaultRole: "verifier",
    handoffStyle: "structured",
  },
] as const;

/**
 * 构建隐式的 "default" profile（始终存在，映射到环境变量配置）
 */
export function buildDefaultProfile(): AgentProfile {
  return {
    id: "default",
    displayName: "Belldandy",
    model: "primary",
    kind: "resident",
    workspaceBinding: "current",
    memoryMode: "hybrid",
  };
}

export function buildBuiltinWorkerProfiles(): AgentProfile[] {
  return BUILTIN_WORKER_PROFILES.map((profile) => ({
    ...profile,
    whenToUse: profile.whenToUse ? [...profile.whenToUse] : undefined,
    defaultAllowedToolFamilies: profile.defaultAllowedToolFamilies
      ? [...profile.defaultAllowedToolFamilies]
      : undefined,
    methods: profile.methods ? [...profile.methods] : undefined,
    skills: profile.skills ? [...profile.skills] : undefined,
  }));
}

export function resolveAgentProfileKind(profile: Pick<AgentProfile, "kind">): AgentProfileKind {
  return profile.kind === "worker" ? "worker" : "resident";
}

export function isResidentAgentProfile(profile: Pick<AgentProfile, "kind">): boolean {
  return resolveAgentProfileKind(profile) === "resident";
}

export function resolveAgentWorkspaceBinding(profile: Pick<AgentProfile, "workspaceBinding">): AgentWorkspaceBinding {
  return profile.workspaceBinding === "custom" ? "custom" : "current";
}

export function resolveAgentWorkspaceDir(profile: Pick<AgentProfile, "id" | "workspaceDir">): string {
  if (typeof profile.workspaceDir === "string" && profile.workspaceDir.trim()) {
    return profile.workspaceDir.trim();
  }
  return profile.id.trim() || "default";
}

export function resolveAgentSessionNamespace(profile: Pick<AgentProfile, "id" | "sessionNamespace">): string {
  const raw = typeof profile.sessionNamespace === "string" && profile.sessionNamespace.trim()
    ? profile.sessionNamespace.trim()
    : profile.id;
  return normalizeSessionNamespace(raw, "default");
}

export function resolveAgentMemoryMode(profile: Pick<AgentProfile, "memoryMode">): AgentMemoryMode {
  return profile.memoryMode === "shared" || profile.memoryMode === "isolated" || profile.memoryMode === "hybrid"
    ? profile.memoryMode
    : "hybrid";
}

export function resolveAgentProfileDefaultRole(
  profile: Pick<AgentProfile, "defaultRole">,
): AgentProfileDefaultRole {
  return profile.defaultRole === "coder"
    || profile.defaultRole === "researcher"
    || profile.defaultRole === "verifier"
    ? profile.defaultRole
    : "default";
}

export function resolveAgentProfileCatalogMetadata(
  profile: Pick<
    AgentProfile,
    "kind"
    | "whenToUse"
    | "defaultRole"
    | "defaultPermissionMode"
    | "defaultAllowedToolFamilies"
    | "defaultMaxToolRiskLevel"
    | "methods"
    | "skills"
    | "handoffStyle"
  >,
): AgentProfileCatalogMetadata {
  const defaultRole = resolveAgentProfileDefaultRole(profile);
  const defaultAllowedToolFamilies = normalizeStringArray(profile.defaultAllowedToolFamilies) as ToolContractFamily[] | undefined;
  return {
    whenToUse: normalizeStringArray(profile.whenToUse) ?? [],
    defaultRole,
    defaultPermissionMode: profile.defaultPermissionMode === "plan"
      || profile.defaultPermissionMode === "acceptEdits"
      || profile.defaultPermissionMode === "confirm"
      ? profile.defaultPermissionMode
      : ROLE_DEFAULT_PERMISSION_MODE[defaultRole],
    defaultAllowedToolFamilies: defaultAllowedToolFamilies ?? ROLE_DEFAULT_ALLOWED_TOOL_FAMILIES[defaultRole],
    defaultMaxToolRiskLevel: profile.defaultMaxToolRiskLevel === "low"
      || profile.defaultMaxToolRiskLevel === "medium"
      || profile.defaultMaxToolRiskLevel === "high"
      || profile.defaultMaxToolRiskLevel === "critical"
      ? profile.defaultMaxToolRiskLevel
      : ROLE_DEFAULT_MAX_RISK_LEVEL[defaultRole],
    methods: normalizeStringArray(profile.methods) ?? [],
    skills: normalizeStringArray(profile.skills) ?? [],
    handoffStyle: profile.handoffStyle === "structured"
      ? "structured"
      : resolveAgentProfileKind(profile) === "worker"
        ? "structured"
        : "summary",
  };
}

export function resolveAgentProfileMetadata(
  profile: Pick<
    AgentProfile,
    | "id"
    | "kind"
    | "workspaceBinding"
    | "workspaceDir"
    | "sessionNamespace"
    | "memoryMode"
    | "whenToUse"
    | "defaultRole"
    | "defaultPermissionMode"
    | "defaultAllowedToolFamilies"
    | "defaultMaxToolRiskLevel"
    | "methods"
    | "skills"
    | "handoffStyle"
  >,
): ResolvedAgentProfileMetadata {
  return {
    kind: resolveAgentProfileKind(profile),
    workspaceBinding: resolveAgentWorkspaceBinding(profile),
    workspaceDir: resolveAgentWorkspaceDir(profile),
    sessionNamespace: resolveAgentSessionNamespace(profile),
    memoryMode: resolveAgentMemoryMode(profile),
    catalog: resolveAgentProfileCatalogMetadata(profile),
  };
}

/**
 * 从 agents.json 加载 Agent Profile 列表。
 * 文件不存在或解析失败时静默返回空数组。
 */
export async function loadAgentProfiles(filePath: string): Promise<AgentProfile[]> {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(stripUtf8Bom(raw)) as unknown;

    if (!data || typeof data !== "object") return [];

    const file = data as Record<string, unknown>;
    const agents = file.agents;
    if (!Array.isArray(agents)) return [];

    const valid: AgentProfile[] = [];
    for (const entry of agents) {
      if (!entry || typeof entry !== "object") continue;
      const obj = entry as Record<string, unknown>;

      // id 和 model 为必填
      if (typeof obj.id !== "string" || !obj.id.trim()) continue;
      if (typeof obj.model !== "string" || !obj.model.trim()) continue;

      valid.push({
        id: obj.id.trim(),
        displayName: typeof obj.displayName === "string" ? obj.displayName : obj.id.trim(),
        model: obj.model.trim(),
        systemPromptOverride: typeof obj.systemPromptOverride === "string" ? obj.systemPromptOverride : undefined,
        soulFile: typeof obj.soulFile === "string" ? obj.soulFile : undefined,
        kind: normalizeEnumValue(obj.kind, AGENT_PROFILE_KINDS),
        workspaceBinding: normalizeEnumValue(obj.workspaceBinding, AGENT_WORKSPACE_BINDINGS),
        workspaceDir: typeof obj.workspaceDir === "string" && obj.workspaceDir.trim() ? obj.workspaceDir.trim() : undefined,
        sessionNamespace: typeof obj.sessionNamespace === "string" && obj.sessionNamespace.trim() ? obj.sessionNamespace.trim() : undefined,
        memoryMode: normalizeEnumValue(obj.memoryMode, AGENT_MEMORY_MODES),
        whenToUse: normalizeStringArray(obj.whenToUse),
        defaultRole: normalizeEnumValue(obj.defaultRole, AGENT_DEFAULT_ROLES),
        defaultPermissionMode: normalizeEnumValue(obj.defaultPermissionMode, AGENT_PERMISSION_MODES),
        defaultAllowedToolFamilies: normalizeStringArray(obj.defaultAllowedToolFamilies) as ToolContractFamily[] | undefined,
        defaultMaxToolRiskLevel: normalizeEnumValue(obj.defaultMaxToolRiskLevel, ["low", "medium", "high", "critical"] as const),
        methods: normalizeStringArray(obj.methods),
        skills: normalizeStringArray(obj.skills),
        handoffStyle: normalizeEnumValue(obj.handoffStyle, AGENT_HANDOFF_STYLES),
        toolsEnabled: typeof obj.toolsEnabled === "boolean" ? obj.toolsEnabled : undefined,
        toolWhitelist: Array.isArray(obj.toolWhitelist) ? obj.toolWhitelist.filter((s): s is string => typeof s === "string") : undefined,
        maxInputTokens: typeof obj.maxInputTokens === "number" && obj.maxInputTokens > 0 ? obj.maxInputTokens : undefined,
        maxOutputTokens: typeof obj.maxOutputTokens === "number" && obj.maxOutputTokens > 0 ? obj.maxOutputTokens : undefined,
      });
    }

    return valid;
  } catch {
    // 文件不存在或解析失败，静默返回空数组
    return [];
  }
}

/**
 * 将 AgentProfile 的 model 引用解析为实际的模型配置。
 *
 * @param modelRef - AgentProfile.model 字段值
 * @param primaryConfig - 环境变量配置（baseUrl/apiKey/model）
 * @param fallbacks - models.json 中加载的 ModelProfile 列表
 * @returns 解析后的模型配置，找不到时 fallback 到 primary
 */
export function resolveModelConfig(
  modelRef: string,
  primaryConfig: {
    baseUrl: string;
    apiKey: string;
    model: string;
    protocol?: string;
    wireApi?: string;
    requestTimeoutMs?: number;
    maxRetries?: number;
    retryBackoffMs?: number;
    proxyUrl?: string;
    thinking?: Record<string, unknown>;
    reasoningEffort?: string;
    options?: Record<string, unknown>;
    requestBodyExtras?: Record<string, unknown>;
    messageLayout?: "single_system_only";
  },
  fallbacks: ModelProfile[],
): {
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol?: string;
  wireApi?: string;
  requestTimeoutMs?: number;
  maxRetries?: number;
  retryBackoffMs?: number;
  proxyUrl?: string;
  thinking?: Record<string, unknown>;
  reasoningEffort?: string;
  options?: Record<string, unknown>;
  requestBodyExtras?: Record<string, unknown>;
  messageLayout?: "single_system_only";
  source: "primary" | "named" | "manual";
} {
  const normalizedModelRef = typeof modelRef === "string" ? modelRef.trim() : "";
  if (modelRef === "primary") {
    return { ...primaryConfig, source: "primary" };
  }

  if (normalizedModelRef.startsWith(MANUAL_MODEL_OVERRIDE_PREFIX)) {
    const manualModel = normalizedModelRef.slice(MANUAL_MODEL_OVERRIDE_PREFIX.length).trim();
    if (manualModel) {
      return {
        ...primaryConfig,
        model: manualModel,
        source: "manual",
      };
    }
  }

  // 在 fallbacks 中按 id 查找
  const found = fallbacks.find((f) => f.id === normalizedModelRef);
  if (found) {
    return {
      baseUrl: found.baseUrl,
      apiKey: found.apiKey,
      model: found.model,
      protocol: found.protocol,
      wireApi: found.wireApi,
      requestTimeoutMs: found.requestTimeoutMs,
      maxRetries: found.maxRetries,
      retryBackoffMs: found.retryBackoffMs,
      proxyUrl: found.proxyUrl,
      thinking: found.thinking,
      reasoningEffort: found.reasoningEffort,
      options: found.options,
      requestBodyExtras: found.requestBodyExtras,
      messageLayout: found.messageLayout,
      source: "named",
    };
  }

  // 找不到，fallback 到 primary
  return { ...primaryConfig, source: "primary" };
}
