import {
  resolveAgentProfileCatalogMetadata,
  type AgentProfileCatalogMetadata,
  type AgentRegistry,
} from "@belldandy/agent";
import type { RuntimeResilienceDoctorReport } from "./runtime-resilience.js";
import { buildRuntimeResilienceDiagnosticSummary } from "./runtime-resilience-diagnostics.js";

type LaunchRole = "default" | "commander" | "coder" | "researcher" | "verifier";
type LaunchRiskLevel = "low" | "medium" | "high" | "critical";
type HandoffStyle = "summary" | "structured";

type CatalogDefaultLike = {
  role?: LaunchRole;
  permissionMode?: string;
  allowedToolFamilies?: string[];
  maxToolRiskLevel?: LaunchRiskLevel;
  handoffStyle?: HandoffStyle;
  whenToUse?: string[];
  methods?: string[];
  skills?: string[];
};

type DelegationReasonLike = {
  source?: string;
  intentKind?: string;
  intentSummary?: string;
  expectedDeliverableSummary?: string;
  aggregationMode?: string;
  contextKeys?: string[];
  sourceAgentIds?: string[];
};

type LaunchSpecLike = {
  agentId?: string;
  profileId?: string;
  role?: LaunchRole;
  permissionMode?: string;
  allowedToolFamilies?: string[];
  maxToolRiskLevel?: LaunchRiskLevel;
  policySummary?: string;
  delegation?: DelegationReasonLike;
};

export type AgentLaunchExplainability = {
  catalogDefault: {
    role: LaunchRole | null;
    permissionMode: string | null;
    allowedToolFamilies: string[];
    maxToolRiskLevel: LaunchRiskLevel | null;
    handoffStyle: HandoffStyle | null;
    whenToUse: string[];
    methods: string[];
    skills: string[];
  } | null;
  suggestedLaunch?: {
    source: string | null;
    agentId: string | null;
    profileId: string | null;
    role: LaunchRole | null;
    permissionMode: string | null;
    allowedToolFamilies: string[];
    maxToolRiskLevel: LaunchRiskLevel | null;
    policySummary: string | null;
    handoffStyle: HandoffStyle | null;
  } | null;
  effectiveLaunch: {
    source: "catalog_default" | "runtime_launch_spec";
    agentId: string | null;
    profileId: string | null;
    role: LaunchRole | null;
    permissionMode: string | null;
    allowedToolFamilies: string[];
    maxToolRiskLevel: LaunchRiskLevel | null;
    policySummary: string | null;
    handoffStyle: HandoffStyle | null;
  } | null;
  delegationReason: {
    source: string | null;
    intentKind: string | null;
    intentSummary: string | null;
    expectedDeliverableSummary: string | null;
    aggregationMode: string | null;
    contextKeys: string[];
    sourceAgentIds: string[];
  } | null;
  runtimeResilience: {
    alertLevel: string | null;
    alertCode: string | null;
    alertMessage: string | null;
    dominantReason: string | null;
    reasonClusterSummary: string | null;
    mixedSignalHint: string | null;
    recoveryHint: string | null;
    configuredFallbackCount: number;
    latestStatus: string | null;
    latestHeadline: string | null;
    latestRoute: string | null;
    compactionRoute: string | null;
    latestSignal: string | null;
    latestRouteBehavior: string | null;
    latestReasonSummary: string | null;
    overallReasonSummary: string | null;
    totalsSummary: string | null;
    compactionAuxSummaryVerdict: {
      strategy: string | null;
      enabled: boolean | null;
      reason: string | null;
    } | null;
  } | null;
};

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean),
  )];
}

function resolveCatalogMetadata(
  agentRegistry: Pick<AgentRegistry, "getProfile"> | undefined,
  agentId: string | undefined,
  profileId: string | undefined,
): AgentProfileCatalogMetadata | undefined {
  const targetProfileId = normalizeOptionalString(profileId) ?? normalizeOptionalString(agentId) ?? "default";
  const profile = agentRegistry?.getProfile(targetProfileId);
  return profile ? resolveAgentProfileCatalogMetadata(profile) : undefined;
}

function buildCatalogDefaultView(source: AgentProfileCatalogMetadata | CatalogDefaultLike | undefined) {
  if (!source) return null;
  const role = ("role" in source ? source.role : undefined) ?? ("defaultRole" in source ? source.defaultRole ?? null : null);
  const permissionMode = normalizeOptionalString(
    "defaultPermissionMode" in source
      ? source.defaultPermissionMode
      : "permissionMode" in source
        ? source.permissionMode
        : undefined,
  );
  const allowedToolFamilies = normalizeStringArray(
    "defaultAllowedToolFamilies" in source
      ? source.defaultAllowedToolFamilies
      : "allowedToolFamilies" in source
        ? source.allowedToolFamilies
        : undefined,
  );
  const maxToolRiskLevel = (
    ("defaultMaxToolRiskLevel" in source
      ? source.defaultMaxToolRiskLevel
      : "maxToolRiskLevel" in source
        ? source.maxToolRiskLevel
        : undefined) ?? null
  ) as LaunchRiskLevel | null;
  const handoffStyle = normalizeOptionalString(source.handoffStyle) as HandoffStyle | null;
  const whenToUse = normalizeStringArray(source.whenToUse);
  const methods = normalizeStringArray(source.methods);
  const skills = normalizeStringArray(source.skills);

  if (!role && !permissionMode && !allowedToolFamilies.length && !maxToolRiskLevel && !handoffStyle && !whenToUse.length && !methods.length && !skills.length) {
    return null;
  }

  return {
    role: role ?? null,
    permissionMode,
    allowedToolFamilies,
    maxToolRiskLevel,
    handoffStyle,
    whenToUse,
    methods,
    skills,
  };
}

function buildDelegationReasonView(source: DelegationReasonLike | undefined) {
  if (!source) return null;
  const view = {
    source: normalizeOptionalString(source.source),
    intentKind: normalizeOptionalString(source.intentKind),
    intentSummary: normalizeOptionalString(source.intentSummary),
    expectedDeliverableSummary: normalizeOptionalString(source.expectedDeliverableSummary),
    aggregationMode: normalizeOptionalString(source.aggregationMode),
    contextKeys: normalizeStringArray(source.contextKeys),
    sourceAgentIds: normalizeStringArray(source.sourceAgentIds),
  };
  if (
    !view.source
    && !view.intentKind
    && !view.intentSummary
    && !view.expectedDeliverableSummary
    && !view.aggregationMode
    && !view.contextKeys.length
    && !view.sourceAgentIds.length
  ) {
    return null;
  }
  return view;
}

function buildRuntimeResilienceView(source: RuntimeResilienceDoctorReport | undefined) {
  if (!source) return null;
  const diagnostics = buildRuntimeResilienceDiagnosticSummary(source);
  const latestRoute = source.latest?.finalProfileId
    ? `${source.latest.finalProfileId}/${source.latest.finalModel ?? "-"}`
    : null;
  const compactionRoute = source.routing.compaction?.route
    ? `${source.routing.compaction.route.provider}/${source.routing.compaction.route.model}`
    : null;
  const view = {
    alertLevel: diagnostics.alertLevel,
    alertCode: diagnostics.alertCode,
    alertMessage: diagnostics.alertMessage,
    dominantReason: diagnostics.dominantReason,
    reasonClusterSummary: diagnostics.reasonClusterSummary,
    mixedSignalHint: diagnostics.mixedSignalHint,
    recoveryHint: diagnostics.recoveryHint,
    configuredFallbackCount: source.routing.fallbacks.length,
    latestStatus: normalizeOptionalString(source.latest?.finalStatus),
    latestHeadline: normalizeOptionalString(source.latest?.headline),
    latestRoute,
    compactionRoute,
    latestSignal: diagnostics.latestSignal,
    latestRouteBehavior: diagnostics.latestRouteBehavior,
    latestReasonSummary: diagnostics.latestReasonSummary,
    overallReasonSummary: diagnostics.overallReasonSummary,
    totalsSummary: diagnostics.totalsSummary,
    compactionAuxSummaryVerdict: source.routing.compaction?.auxSummaryVerdict
      ? {
        strategy: normalizeOptionalString(source.routing.compaction.auxSummaryVerdict.strategy),
        enabled: typeof source.routing.compaction.auxSummaryVerdict.enabled === "boolean"
          ? source.routing.compaction.auxSummaryVerdict.enabled
          : null,
        reason: normalizeOptionalString(source.routing.compaction.auxSummaryVerdict.reason),
      }
      : null,
  };
  if (
    !view.alertLevel
    && !view.alertCode
    && !view.alertMessage
    && !view.dominantReason
    && !view.reasonClusterSummary
    && !view.mixedSignalHint
    && !view.recoveryHint
    && view.configuredFallbackCount <= 0
    && !view.latestStatus
    && !view.latestHeadline
    && !view.latestRoute
    && !view.compactionRoute
    && !view.latestSignal
    && !view.latestRouteBehavior
    && !view.latestReasonSummary
    && !view.overallReasonSummary
    && !view.totalsSummary
    && !view.compactionAuxSummaryVerdict
  ) {
    return null;
  }
  return view;
}

export function buildAgentLaunchExplainability(input: {
  agentRegistry?: Pick<AgentRegistry, "getProfile">;
  agentId?: string;
  profileId?: string;
  catalog?: AgentProfileCatalogMetadata;
  catalogDefaultOverride?: CatalogDefaultLike;
  launchSpec?: LaunchSpecLike;
  delegationReason?: DelegationReasonLike;
  runtimeResilience?: RuntimeResilienceDoctorReport;
}): AgentLaunchExplainability | undefined {
  const catalog = input.catalog
    ?? resolveCatalogMetadata(
      input.agentRegistry,
      input.launchSpec?.agentId ?? input.agentId,
      input.launchSpec?.profileId ?? input.profileId,
    );
  const catalogDefault = buildCatalogDefaultView(
    input.catalogDefaultOverride
      ? {
        role: input.catalogDefaultOverride.role ?? catalog?.defaultRole,
        permissionMode: input.catalogDefaultOverride.permissionMode ?? catalog?.defaultPermissionMode,
        allowedToolFamilies: input.catalogDefaultOverride.allowedToolFamilies ?? catalog?.defaultAllowedToolFamilies,
        maxToolRiskLevel: input.catalogDefaultOverride.maxToolRiskLevel ?? catalog?.defaultMaxToolRiskLevel,
        handoffStyle: input.catalogDefaultOverride.handoffStyle ?? catalog?.handoffStyle,
        whenToUse: input.catalogDefaultOverride.whenToUse ?? catalog?.whenToUse,
        methods: input.catalogDefaultOverride.methods ?? catalog?.methods,
        skills: input.catalogDefaultOverride.skills ?? catalog?.skills,
      }
      : catalog,
  );
  const effectiveLaunch = (() => {
    const agentId = normalizeOptionalString(input.launchSpec?.agentId) ?? normalizeOptionalString(input.agentId);
    const profileId = normalizeOptionalString(input.launchSpec?.profileId) ?? normalizeOptionalString(input.profileId);
    const role = input.launchSpec?.role ?? catalogDefault?.role ?? null;
    const permissionMode = normalizeOptionalString(input.launchSpec?.permissionMode) ?? catalogDefault?.permissionMode ?? null;
    const allowedToolFamilies = normalizeStringArray(input.launchSpec?.allowedToolFamilies);
    const maxToolRiskLevel = input.launchSpec?.maxToolRiskLevel ?? catalogDefault?.maxToolRiskLevel ?? null;
    const policySummary = normalizeOptionalString(input.launchSpec?.policySummary);
    const handoffStyle = catalogDefault?.handoffStyle ?? null;
    const resolvedAllowedToolFamilies = allowedToolFamilies.length > 0
      ? allowedToolFamilies
      : catalogDefault?.allowedToolFamilies ?? [];

    if (!agentId && !profileId && !role && !permissionMode && !resolvedAllowedToolFamilies.length && !maxToolRiskLevel && !policySummary && !handoffStyle) {
      return null;
    }

    return {
      source: input.launchSpec ? "runtime_launch_spec" as const : "catalog_default" as const,
      agentId: agentId ?? null,
      profileId: profileId ?? null,
      role,
      permissionMode,
      allowedToolFamilies: resolvedAllowedToolFamilies,
      maxToolRiskLevel,
      policySummary,
      handoffStyle,
    };
  })();
  const delegationReason = buildDelegationReasonView(input.delegationReason ?? input.launchSpec?.delegation);
  const runtimeResilience = buildRuntimeResilienceView(input.runtimeResilience);

  if (!catalogDefault && !effectiveLaunch && !delegationReason && !runtimeResilience) {
    return undefined;
  }

  return {
    catalogDefault,
    effectiveLaunch,
    delegationReason,
    runtimeResilience,
  };
}
