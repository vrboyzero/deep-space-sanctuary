import type { BridgeSubtaskSemantics, DelegationProtocol, ToolContractFamily } from "@belldandy/skills";
import type { AgentRegistry } from "./agent-registry.js";
import { resolveAgentProfileCatalogMetadata, type AgentProfileCatalogMetadata } from "./agent-profile.js";

export const DEFAULT_AGENT_LAUNCH_TIMEOUT_MS = 120_000;

export type AgentLaunchRole = "default" | "commander" | "coder" | "researcher" | "verifier";

export type AgentLaunchSpec = {
  instruction: string;
  parentConversationId: string;
  agentId: string;
  profileId: string;
  modelOverride?: string;
  background: boolean;
  timeoutMs: number;
  channel: string;
  context?: Record<string, unknown>;
  cwd?: string;
  toolSet?: string[];
  permissionMode?: string;
  isolationMode?: string;
  parentTaskId?: string;
  role?: AgentLaunchRole;
  allowedToolFamilies?: string[];
  maxToolRiskLevel?: "low" | "medium" | "high" | "critical";
  maxRunWallTimeMs?: number;
  toolLoopIterationBudget?: number;
  maxTotalTokens?: number;
  maxCostUsd?: number;
  maxHighRiskToolCalls?: number;
  /**
   * 单次运行的工具调用次数上限；0 表示不限制（编码运行专用，
   * 由 12 turns / 64k tokens / 成本上限继续约束，防止无限循环）。
   */
  maxToolCalls?: number;
  policySummary?: string;
  delegationProtocol?: DelegationProtocol;
  bridgeSubtask?: BridgeSubtaskSemantics;
};

export type AgentLaunchSpecInput = {
  instruction: string;
  parentConversationId: string;
  agentId?: string;
  profileId?: string;
  modelOverride?: string;
  background?: boolean;
  timeoutMs?: number;
  channel?: string;
  context?: Record<string, unknown>;
  cwd?: string;
  toolSet?: string[];
  permissionMode?: string;
  isolationMode?: string;
  parentTaskId?: string;
  role?: AgentLaunchRole;
  allowedToolFamilies?: string[];
  maxToolRiskLevel?: "low" | "medium" | "high" | "critical";
  maxRunWallTimeMs?: number;
  toolLoopIterationBudget?: number;
  maxTotalTokens?: number;
  maxCostUsd?: number;
  maxHighRiskToolCalls?: number;
  maxToolCalls?: number;
  policySummary?: string;
  delegationProtocol?: DelegationProtocol;
  bridgeSubtask?: BridgeSubtaskSemantics;
};

function patchDelegationProtocolLaunchDefaults(
  protocol: DelegationProtocol | undefined,
  catalog: AgentProfileCatalogMetadata | undefined,
): DelegationProtocol | undefined {
  if (!protocol || !catalog) return protocol;

  const nextLaunchDefaults = {
    ...protocol.launchDefaults,
    permissionMode: protocol.launchDefaults.permissionMode ?? catalog.defaultPermissionMode,
    allowedToolFamilies: protocol.launchDefaults.allowedToolFamilies ?? catalog.defaultAllowedToolFamilies,
    maxToolRiskLevel: protocol.launchDefaults.maxToolRiskLevel ?? catalog.defaultMaxToolRiskLevel,
  };

  return {
    ...protocol,
    launchDefaults: nextLaunchDefaults,
  };
}

function resolveCatalogMetadata(
  agentRegistry: Pick<AgentRegistry, "getProfile"> | undefined,
  input: AgentLaunchSpecInput,
  defaults: Partial<Omit<AgentLaunchSpec, "instruction" | "parentConversationId">>,
): AgentProfileCatalogMetadata | undefined {
  const profileId = normalizeOptionalString(input.profileId)
    ?? normalizeOptionalString(input.agentId)
    ?? normalizeOptionalString(defaults.profileId)
    ?? normalizeOptionalString(defaults.agentId)
    ?? "default";
  const profile = agentRegistry?.getProfile(profileId);
  return profile ? resolveAgentProfileCatalogMetadata(profile) : undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeToolSet(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  if (!items.length) return undefined;
  return [...new Set(items)];
}

function normalizeRole(value: unknown): AgentLaunchRole | undefined {
  if (value !== "default" && value !== "commander" && value !== "coder" && value !== "researcher" && value !== "verifier") {
    return undefined;
  }
  return value;
}

function normalizeRiskLevel(value: unknown): AgentLaunchSpec["maxToolRiskLevel"] | undefined {
  if (value !== "low" && value !== "medium" && value !== "high" && value !== "critical") {
    return undefined;
  }
  return value;
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : undefined;
}

function normalizePositiveNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function normalizeNonNegativeInteger(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : undefined;
}

function normalizeContext(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return undefined;
  return Object.fromEntries(entries);
}

function normalizeBridgeSubtask(value: unknown): BridgeSubtaskSemantics | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const kind = normalizeOptionalString(record.kind);
  if (kind !== "analyze" && kind !== "review" && kind !== "patch") {
    return undefined;
  }
  return {
    kind,
    targetId: normalizeOptionalString(record.targetId),
    action: normalizeOptionalString(record.action),
    goalId: normalizeOptionalString(record.goalId),
    goalNodeId: normalizeOptionalString(record.goalNodeId),
    summary: normalizeOptionalString(record.summary),
  };
}

function normalizeDelegationStringArray(value: unknown): string[] | undefined {
  return normalizeToolSet(value);
}

function normalizeDelegationToolFamilies(
  value: unknown,
): DelegationProtocol["launchDefaults"]["allowedToolFamilies"] | undefined {
  return normalizeDelegationStringArray(value) as ToolContractFamily[] | undefined;
}

function normalizeDelegationTeamRole(
  value: unknown,
): NonNullable<DelegationProtocol["team"]>["memberRoster"][number]["role"] | undefined {
  if (value !== "default" && value !== "commander" && value !== "coder" && value !== "researcher" && value !== "verifier") {
    return undefined;
  }
  return value;
}

function normalizeDelegationAuthorityRelation(
  value: unknown,
): NonNullable<DelegationProtocol["team"]>["memberRoster"][number]["authorityRelationToManager"] | undefined {
  const normalized = normalizeOptionalString(value);
  if (normalized !== "self" && normalized !== "superior" && normalized !== "peer" && normalized !== "subordinate" && normalized !== "unknown") {
    return undefined;
  }
  return normalized;
}

function normalizeDelegationTeam(
  team: DelegationProtocol["team"] | undefined,
): DelegationProtocol["team"] | undefined {
  if (!team) {
    return undefined;
  }

  const id = normalizeOptionalString(team.id);
  const mode = team.mode;
  const sharedGoal = normalizeOptionalString(team.sharedGoal);
  const managerAgentId = normalizeOptionalString(team.managerAgentId);
  const managerIdentityLabel = normalizeOptionalString(team.managerIdentityLabel);
  const currentLaneId = normalizeOptionalString(team.currentLaneId);
  const memberRoster = Array.isArray(team.memberRoster)
    ? team.memberRoster
      .map((member) => {
        const laneId = normalizeOptionalString(member?.laneId);
        if (!laneId) {
          return undefined;
        }
        const agentId = normalizeOptionalString(member.agentId);
        const role = normalizeDelegationTeamRole(member.role);
        const identityLabel = normalizeOptionalString(member.identityLabel);
        const authorityRelationToManager = normalizeDelegationAuthorityRelation(member.authorityRelationToManager);
        const reportsTo = normalizeDelegationStringArray(member.reportsTo);
        const mayDirect = normalizeDelegationStringArray(member.mayDirect);
        const scopeSummary = normalizeOptionalString(member.scopeSummary);
        const dependsOn = normalizeDelegationStringArray(member.dependsOn);
        const handoffTo = normalizeDelegationStringArray(member.handoffTo);
        return {
          laneId,
          ...(agentId ? { agentId } : {}),
          ...(role ? { role } : {}),
          ...(identityLabel ? { identityLabel } : {}),
          ...(authorityRelationToManager ? { authorityRelationToManager } : {}),
          ...(reportsTo ? { reportsTo } : {}),
          ...(mayDirect ? { mayDirect } : {}),
          ...(scopeSummary ? { scopeSummary } : {}),
          ...(dependsOn ? { dependsOn } : {}),
          ...(handoffTo ? { handoffTo } : {}),
        };
      })
      .filter(Boolean) as NonNullable<DelegationProtocol["team"]>["memberRoster"]
    : [];

  if (!id || memberRoster.length === 0) {
    return undefined;
  }

  return {
    id,
    mode,
    ...(sharedGoal ? { sharedGoal } : {}),
    ...(managerAgentId ? { managerAgentId } : {}),
    ...(managerIdentityLabel ? { managerIdentityLabel } : {}),
    ...(currentLaneId && memberRoster.some((member) => member.laneId === currentLaneId) ? { currentLaneId } : {}),
    memberRoster,
  };
}

function normalizeDelegationProtocol(
  protocol: DelegationProtocol | undefined,
): DelegationProtocol | undefined {
  if (!protocol) return undefined;

  const expectedDeliverableSummary = normalizeOptionalString(protocol.expectedDeliverable?.summary)
    ?? normalizeOptionalString(protocol.intent?.summary)
    ?? "Execute delegated work.";
  const ownershipOutOfScope = normalizeDelegationStringArray(protocol.ownership?.outOfScope);
  const ownershipWriteScope = normalizeDelegationStringArray(protocol.ownership?.writeScope);
  const acceptanceVerificationHints = normalizeDelegationStringArray(protocol.acceptance?.verificationHints);
  const deliverableRequiredSections = normalizeDelegationStringArray(protocol.deliverableContract?.requiredSections);
  const ownershipScopeSummary = normalizeOptionalString(protocol.ownership?.scopeSummary)
    ?? normalizeOptionalString(protocol.intent?.summary)
    ?? expectedDeliverableSummary;
  const doneDefinition = normalizeOptionalString(protocol.acceptance?.doneDefinition)
    ?? expectedDeliverableSummary;
  const deliverableSummary = normalizeOptionalString(protocol.deliverableContract?.summary)
    ?? expectedDeliverableSummary;
  const team = normalizeDelegationTeam(protocol.team);

  return {
    ...protocol,
    intent: {
      ...protocol.intent,
      summary: normalizeOptionalString(protocol.intent.summary) ?? expectedDeliverableSummary,
    },
    contextPolicy: {
      ...protocol.contextPolicy,
      contextKeys: normalizeDelegationStringArray(protocol.contextPolicy?.contextKeys) ?? [],
    },
    expectedDeliverable: {
      ...protocol.expectedDeliverable,
      summary: expectedDeliverableSummary,
    },
    aggregationPolicy: {
      ...protocol.aggregationPolicy,
      sourceAgentIds: normalizeDelegationStringArray(protocol.aggregationPolicy?.sourceAgentIds),
    },
    launchDefaults: {
      ...protocol.launchDefaults,
      permissionMode: normalizeOptionalString(protocol.launchDefaults?.permissionMode),
      allowedToolFamilies: normalizeDelegationToolFamilies(protocol.launchDefaults?.allowedToolFamilies),
      maxToolRiskLevel: normalizeRiskLevel(protocol.launchDefaults?.maxToolRiskLevel),
    },
    ...(protocol.ownership || ownershipOutOfScope || ownershipWriteScope ? {
      ownership: {
        scopeSummary: ownershipScopeSummary,
        ...(ownershipOutOfScope ? { outOfScope: ownershipOutOfScope } : {}),
        ...(ownershipWriteScope ? { writeScope: ownershipWriteScope } : {}),
      },
    } : {}),
    ...(protocol.acceptance || acceptanceVerificationHints ? {
      acceptance: {
        doneDefinition,
        ...(acceptanceVerificationHints ? { verificationHints: acceptanceVerificationHints } : {}),
      },
    } : {}),
    ...(protocol.deliverableContract || deliverableRequiredSections ? {
      deliverableContract: {
        format: protocol.deliverableContract?.format ?? protocol.expectedDeliverable.format,
        summary: deliverableSummary,
        ...(deliverableRequiredSections ? { requiredSections: deliverableRequiredSections } : {}),
      },
    } : {}),
    ...(team ? { team } : {}),
  };
}

export function normalizeAgentLaunchSpec(
  input: AgentLaunchSpecInput,
  defaults: Partial<Omit<AgentLaunchSpec, "instruction" | "parentConversationId">> = {},
): AgentLaunchSpec {
  const profileId = normalizeOptionalString(input.profileId)
    ?? normalizeOptionalString(input.agentId)
    ?? normalizeOptionalString(defaults.profileId)
    ?? normalizeOptionalString(defaults.agentId)
    ?? "default";
  const agentId = normalizeOptionalString(input.agentId)
    ?? normalizeOptionalString(defaults.agentId)
    ?? profileId;
  const timeoutMs = Number.isFinite(Number(input.timeoutMs)) && Number(input.timeoutMs) > 0
    ? Number(input.timeoutMs)
    : Number.isFinite(Number(defaults.timeoutMs)) && Number(defaults.timeoutMs) > 0
      ? Number(defaults.timeoutMs)
      : DEFAULT_AGENT_LAUNCH_TIMEOUT_MS;

  return {
    instruction: String(input.instruction ?? "").trim(),
    parentConversationId: normalizeOptionalString(input.parentConversationId) ?? "system",
    agentId,
    profileId,
    modelOverride: normalizeOptionalString(input.modelOverride) ?? normalizeOptionalString(defaults.modelOverride),
    background: input.background ?? defaults.background ?? true,
    timeoutMs,
    channel: normalizeOptionalString(input.channel) ?? normalizeOptionalString(defaults.channel) ?? "subtask",
    context: normalizeContext(input.context) ?? normalizeContext(defaults.context),
    cwd: normalizeOptionalString(input.cwd) ?? normalizeOptionalString(defaults.cwd),
    toolSet: normalizeToolSet(input.toolSet) ?? normalizeToolSet(defaults.toolSet),
    permissionMode: normalizeOptionalString(input.permissionMode) ?? normalizeOptionalString(defaults.permissionMode),
    isolationMode: normalizeOptionalString(input.isolationMode) ?? normalizeOptionalString(defaults.isolationMode),
    parentTaskId: normalizeOptionalString(input.parentTaskId) ?? normalizeOptionalString(defaults.parentTaskId),
    role: normalizeRole(input.role) ?? normalizeRole(defaults.role),
    allowedToolFamilies: normalizeToolSet(input.allowedToolFamilies) ?? normalizeToolSet(defaults.allowedToolFamilies),
    maxToolRiskLevel: normalizeRiskLevel(input.maxToolRiskLevel) ?? normalizeRiskLevel(defaults.maxToolRiskLevel),
    maxRunWallTimeMs: normalizePositiveInteger(input.maxRunWallTimeMs) ?? normalizePositiveInteger(defaults.maxRunWallTimeMs),
    toolLoopIterationBudget: normalizePositiveInteger(input.toolLoopIterationBudget)
      ?? normalizePositiveInteger(defaults.toolLoopIterationBudget),
    maxTotalTokens: normalizePositiveInteger(input.maxTotalTokens) ?? normalizePositiveInteger(defaults.maxTotalTokens),
    maxCostUsd: normalizePositiveNumber(input.maxCostUsd) ?? normalizePositiveNumber(defaults.maxCostUsd),
    maxHighRiskToolCalls: normalizeNonNegativeInteger(input.maxHighRiskToolCalls)
      ?? normalizeNonNegativeInteger(defaults.maxHighRiskToolCalls),
    maxToolCalls: normalizeNonNegativeInteger(input.maxToolCalls)
      ?? normalizeNonNegativeInteger(defaults.maxToolCalls),
    policySummary: normalizeOptionalString(input.policySummary) ?? normalizeOptionalString(defaults.policySummary),
    delegationProtocol: normalizeDelegationProtocol(input.delegationProtocol)
      ?? normalizeDelegationProtocol(defaults.delegationProtocol),
    bridgeSubtask: normalizeBridgeSubtask(input.bridgeSubtask) ?? normalizeBridgeSubtask(defaults.bridgeSubtask),
  };
}

export function normalizeAgentLaunchSpecWithCatalog(
  input: AgentLaunchSpecInput,
  options: {
    agentRegistry?: Pick<AgentRegistry, "getProfile">;
    defaults?: Partial<Omit<AgentLaunchSpec, "instruction" | "parentConversationId">>;
  } = {},
): AgentLaunchSpec {
  const defaults = options.defaults ?? {};
  const catalog = resolveCatalogMetadata(options.agentRegistry, input, defaults);
  const patchedInput: AgentLaunchSpecInput = {
    ...input,
    delegationProtocol: patchDelegationProtocolLaunchDefaults(input.delegationProtocol, catalog),
  };
  const patchedDefaults: Partial<Omit<AgentLaunchSpec, "instruction" | "parentConversationId">> = {
    ...defaults,
    delegationProtocol: input.delegationProtocol
      ? defaults.delegationProtocol
      : patchDelegationProtocolLaunchDefaults(defaults.delegationProtocol, catalog),
  };

  return normalizeAgentLaunchSpec(patchedInput, {
    ...patchedDefaults,
    role: normalizeRole(patchedInput.role) ?? normalizeRole(patchedDefaults.role) ?? catalog?.defaultRole,
    permissionMode: normalizeOptionalString(patchedInput.permissionMode)
      ?? normalizeOptionalString(patchedDefaults.permissionMode)
      ?? catalog?.defaultPermissionMode,
    allowedToolFamilies: normalizeToolSet(patchedInput.allowedToolFamilies)
      ?? normalizeToolSet(patchedDefaults.allowedToolFamilies)
      ?? catalog?.defaultAllowedToolFamilies,
    maxToolRiskLevel: normalizeRiskLevel(patchedInput.maxToolRiskLevel)
      ?? normalizeRiskLevel(patchedDefaults.maxToolRiskLevel)
      ?? catalog?.defaultMaxToolRiskLevel,
  });
}
