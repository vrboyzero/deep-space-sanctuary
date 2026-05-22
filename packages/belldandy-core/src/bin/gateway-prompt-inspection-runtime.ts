import crypto from "node:crypto";

import {
  buildProviderNativeSystemBlocks,
  renderSystemPromptSections,
  resolveAgentProfileMetadata,
  type AgentProfile,
  type AgentPromptDelta,
  type AgentPromptSnapshot,
  type AgentPromptSnapshotMessage,
  type ProviderNativeSystemBlock,
  type SystemPromptBuildResult,
  type SystemPromptSection,
} from "@belldandy/agent";
import type { IdentityAuthorityProfile } from "@belldandy/protocol";
import type { ToolExecutor } from "@belldandy/skills";

import { persistConversationPromptSnapshot } from "../conversation-prompt-snapshot.js";
import { resolveResidentMemoryPolicy } from "../resident-memory-policy.js";
import { resolveResidentStateBindingView } from "../resident-state-binding.js";
import { PromptSnapshotStore } from "../prompt-snapshot-store.js";
import {
  applyPromptExperimentsToSections,
  buildPromptTokenBreakdown,
  readPromptTruncationReasonFromMetadata,
  withDeltaPromptMetrics,
  withProviderNativeSystemBlockPromptMetrics,
  withSectionPromptMetrics,
  type PromptExperimentConfig,
  type PromptTextMetrics,
} from "../prompt-observability.js";
import { buildToolBehaviorObservability } from "../tool-behavior-observability.js";
import {
  cloneProviderNativeSystemBlocks,
  createGatewaySystemPromptSection,
  isRecord,
  readResidentPromptMetadata,
  renderProviderNativeSystemBlocksText,
  stripStructuredRuntimeIdentityFromSystemPrompt,
} from "./gateway-prompt-runtime.js";
import type { ProviderCacheSupport } from "../provider-capability.js";

type GatewayLogger = {
  info: (scope: string, message: string, data?: unknown) => void;
  warn: (scope: string, message: string, data?: unknown) => void;
};

function computeSystemPromptFingerprint(input: {
  text: string;
  providerNativeSystemBlocks: ProviderNativeSystemBlock[];
  sectionIds?: string[];
}): string {
  const hash = crypto.createHash("sha256").update(JSON.stringify({
    text: input.text,
    providerNativeSystemBlocks: input.providerNativeSystemBlocks.map((block) => ({
      id: block.id,
      type: block.blockType,
      text: block.text,
      cacheControlEligible: block.cacheControlEligible === true,
    })),
    sectionIds: input.sectionIds ?? [],
  })).digest("hex");
  return hash.slice(0, 16);
}

function stableUniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function computeStructureSignature(input: {
  sectionIds?: string[];
  providerNativeBlockIds?: string[];
  providerNativeBlockTypes?: string[];
  providerNativeCacheEligibleBlockIds?: string[];
  toolBehaviorIncluded?: string[];
}): string {
  const hash = crypto.createHash("sha256").update(JSON.stringify({
    sectionIds: input.sectionIds ?? [],
    providerNativeBlockIds: input.providerNativeBlockIds ?? [],
    providerNativeBlockTypes: input.providerNativeBlockTypes ?? [],
    providerNativeCacheEligibleBlockIds: input.providerNativeCacheEligibleBlockIds ?? [],
    toolBehaviorIncluded: input.toolBehaviorIncluded ?? [],
  })).digest("hex");
  return hash.slice(0, 16);
}

function buildPromptStructureMetadata(input: {
  sections: SystemPromptSection[];
  providerNativeSystemBlocks: ProviderNativeSystemBlock[];
  toolBehaviorIncluded?: string[];
}): {
  sectionIds: string[];
  providerNativeBlockIds: string[];
  providerNativeBlockTypes: string[];
  providerNativeCacheEligibleBlockIds: string[];
  toolBehaviorIncluded: string[];
  structureSignature: string;
  orderingGuard: {
    status: "stable" | "risk";
    reasons: string[];
  };
} {
  const sectionIds = input.sections.map((section) => section.id);
  const providerNativeBlockIds = input.providerNativeSystemBlocks.map((block) => block.id);
  const providerNativeBlockTypes = stableUniqueStrings(
    input.providerNativeSystemBlocks.map((block) => block.blockType),
  );
  const providerNativeCacheEligibleBlockIds = input.providerNativeSystemBlocks
    .filter((block) => block.cacheControlEligible === true)
    .map((block) => block.id);
  const toolBehaviorIncluded = stableUniqueStrings(input.toolBehaviorIncluded ?? []);
  const orderingReasons: string[] = [];

  for (const section of input.sections) {
    if (section.source === "runtime" || section.source === "profile" || section.source === "meta") {
      orderingReasons.push("dynamic_runtime_sections_present");
      break;
    }
  }
  const hasNonEmptyBlockSourceIds = input.providerNativeSystemBlocks.some(
    (block) => block.sourceSectionIds.length > 0 || block.sourceDeltaIds.length > 0,
  );
  if (hasNonEmptyBlockSourceIds) {
    orderingReasons.push("provider_native_blocks_depend_on_runtime_composition");
  }
  if (toolBehaviorIncluded.length > 0) {
    orderingReasons.push("tool_contract_list_injected");
  }

  return {
    sectionIds,
    providerNativeBlockIds,
    providerNativeBlockTypes,
    providerNativeCacheEligibleBlockIds,
    toolBehaviorIncluded,
    structureSignature: computeStructureSignature({
      sectionIds,
      providerNativeBlockIds,
      providerNativeBlockTypes,
      providerNativeCacheEligibleBlockIds,
      toolBehaviorIncluded,
    }),
    orderingGuard: {
      status: orderingReasons.length > 0 ? "risk" : "stable",
      reasons: orderingReasons.length > 0 ? orderingReasons : ["deterministic_structure_only"],
    },
  };
}

function readStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function classifyPrefixDrift(input: {
  previous?: {
    systemPromptFingerprint?: string;
    sectionIds?: string[];
    providerNativeBlockIds?: string[];
    providerNativeBlockTypes?: string[];
    providerNativeCacheEligibleBlockIds?: string[];
    toolBehaviorIncluded?: string[];
    structureSignature?: string;
    cacheSupport?: string;
  };
  current: {
    systemPromptFingerprint: string;
    sectionIds: string[];
    providerNativeBlockIds: string[];
    providerNativeBlockTypes: string[];
    providerNativeCacheEligibleBlockIds: string[];
    toolBehaviorIncluded: string[];
    structureSignature: string;
    cacheSupport?: string;
  };
}): {
  status: "first_snapshot" | "stable" | "drifted";
  changed: boolean;
  reasons: string[];
  previousFingerprint?: string;
  currentFingerprint: string;
} {
  const previous = input.previous;
  const current = input.current;
  if (!previous?.systemPromptFingerprint) {
    return {
      status: "first_snapshot",
      changed: false,
      reasons: ["first_snapshot_for_conversation"],
      currentFingerprint: current.systemPromptFingerprint,
    };
  }

  const reasons: string[] = [];
  if (previous.systemPromptFingerprint !== current.systemPromptFingerprint) {
    reasons.push("system_prompt_fingerprint_changed");
  }
  if (!arraysEqual(previous.sectionIds ?? [], current.sectionIds)) {
    reasons.push("section_id_order_changed");
  }
  if (!arraysEqual(previous.providerNativeBlockIds ?? [], current.providerNativeBlockIds)) {
    reasons.push("provider_native_block_order_changed");
  }
  if (!arraysEqual(previous.providerNativeBlockTypes ?? [], current.providerNativeBlockTypes)) {
    reasons.push("provider_native_block_type_set_changed");
  }
  if (!arraysEqual(previous.providerNativeCacheEligibleBlockIds ?? [], current.providerNativeCacheEligibleBlockIds)) {
    reasons.push("provider_native_cache_eligible_blocks_changed");
  }
  if (!arraysEqual(previous.toolBehaviorIncluded ?? [], current.toolBehaviorIncluded)) {
    reasons.push("tool_contract_list_changed");
  }
  if ((previous.structureSignature ?? "") !== current.structureSignature) {
    reasons.push("prompt_structure_signature_changed");
  }
  if ((previous.cacheSupport ?? "unknown") !== (current.cacheSupport ?? "unknown")) {
    reasons.push("cache_support_changed");
  }

  return {
    status: reasons.length > 0 ? "drifted" : "stable",
    changed: reasons.length > 0,
    reasons: reasons.length > 0 ? reasons : ["fingerprint_stable"],
    previousFingerprint: previous.systemPromptFingerprint,
    currentFingerprint: current.systemPromptFingerprint,
  };
}

function buildPrefixWarmState(input: {
  currentFingerprint: string;
  currentCacheSupport?: string;
  currentCreatedAt?: number;
  previous?: {
    systemPromptFingerprint?: string;
    createdAt?: number;
    cacheSupport?: string;
  };
  drift: {
    status: "first_snapshot" | "stable" | "drifted";
  };
}): {
  eligible: boolean;
  status: "cold" | "warming" | "warm_candidate" | "drifted" | "unsupported";
  samePrefixAsPrevious: boolean;
  previousAgeMs?: number;
  reason: string;
} {
  const cacheSupport = input.currentCacheSupport ?? "unknown";
  if (cacheSupport !== "supported") {
    return {
      eligible: false,
      status: "unsupported",
      samePrefixAsPrevious: false,
      reason: "provider_cache_not_supported",
    };
  }

  const samePrefixAsPrevious = input.previous?.systemPromptFingerprint === input.currentFingerprint;
  const previousAgeMs = typeof input.previous?.createdAt === "number" && typeof input.currentCreatedAt === "number"
    ? Math.max(0, input.currentCreatedAt - input.previous.createdAt)
    : undefined;

  if (input.drift.status === "drifted") {
    return {
      eligible: true,
      status: "drifted",
      samePrefixAsPrevious,
      ...(typeof previousAgeMs === "number" ? { previousAgeMs } : {}),
      reason: "prefix_drift_detected",
    };
  }
  if (!samePrefixAsPrevious) {
    return {
      eligible: true,
      status: "cold",
      samePrefixAsPrevious: false,
      ...(typeof previousAgeMs === "number" ? { previousAgeMs } : {}),
      reason: "no_matching_previous_prefix",
    };
  }
  if (typeof previousAgeMs === "number" && previousAgeMs < 5_000) {
    return {
      eligible: true,
      status: "warming",
      samePrefixAsPrevious: true,
      previousAgeMs,
      reason: "matching_prefix_recently_seen_may_still_be_warming",
    };
  }
  return {
    eligible: true,
    status: "warm_candidate",
    samePrefixAsPrevious: true,
    ...(typeof previousAgeMs === "number" ? { previousAgeMs } : {}),
    reason: "matching_prefix_seen_in_previous_snapshot",
  };
}

function buildWarmupCoordination(input: {
  cacheSupport?: string;
  prefixWarmState?: {
    eligible?: boolean;
    status?: "cold" | "warming" | "warm_candidate" | "drifted" | "unsupported";
    reason?: string;
    previousAgeMs?: number;
  };
  prefixDrift?: {
    status?: "first_snapshot" | "stable" | "drifted";
  };
  orderingGuard?: {
    status?: "stable" | "risk";
  };
}): {
  eligible: boolean;
  status: "unsupported" | "cold" | "warming" | "warm_candidate" | "drifted";
  recommendation: "proceed" | "proceed_with_caution" | "delay_if_possible";
  reason: string;
  previousAgeMs?: number;
} {
  if ((input.cacheSupport ?? "unknown") !== "supported" || !input.prefixWarmState) {
    return {
      eligible: false,
      status: "unsupported",
      recommendation: "proceed",
      reason: "provider_cache_not_supported",
    };
  }
  const warmState = input.prefixWarmState;
  if (warmState.status === "drifted" || input.prefixDrift?.status === "drifted") {
    return {
      eligible: true,
      status: "drifted",
      recommendation: "delay_if_possible",
      reason: "prefix_drift_detected",
      ...(typeof warmState.previousAgeMs === "number" ? { previousAgeMs: warmState.previousAgeMs } : {}),
    };
  }
  if (warmState.status === "warming") {
    return {
      eligible: true,
      status: "warming",
      recommendation: "delay_if_possible",
      reason: input.orderingGuard?.status === "risk"
        ? "matching_prefix_recent_but_ordering_risk_present"
        : (warmState.reason ?? "matching_prefix_recently_seen_may_still_be_warming"),
      ...(typeof warmState.previousAgeMs === "number" ? { previousAgeMs: warmState.previousAgeMs } : {}),
    };
  }
  if (warmState.status === "cold") {
    return {
      eligible: true,
      status: "cold",
      recommendation: "proceed_with_caution",
      reason: warmState.reason ?? "no_matching_previous_prefix",
      ...(typeof warmState.previousAgeMs === "number" ? { previousAgeMs: warmState.previousAgeMs } : {}),
    };
  }
  return {
    eligible: true,
    status: "warm_candidate",
    recommendation: input.orderingGuard?.status === "risk" ? "proceed_with_caution" : "proceed",
    reason: input.orderingGuard?.status === "risk"
      ? "warm_candidate_with_ordering_risk"
      : (warmState.reason ?? "matching_prefix_seen_in_previous_snapshot"),
    ...(typeof warmState.previousAgeMs === "number" ? { previousAgeMs: warmState.previousAgeMs } : {}),
  };
}

function computeCacheFamilyKey(input: {
  cacheSupport?: string;
  model?: string;
  structureSignature?: string;
  systemPromptFingerprint?: string;
}): string | undefined {
  if ((input.cacheSupport ?? "unknown") !== "supported") {
    return undefined;
  }
  const model = typeof input.model === "string" ? input.model.trim() : "";
  const structureSignature = typeof input.structureSignature === "string" ? input.structureSignature.trim() : "";
  const fingerprint = typeof input.systemPromptFingerprint === "string" ? input.systemPromptFingerprint.trim() : "";
  const parts = [model, structureSignature, fingerprint].filter(Boolean);
  if (parts.length === 0) {
    return undefined;
  }
  const hash = crypto.createHash("sha256").update(parts.join("|")).digest("hex");
  return hash.slice(0, 16);
}

function buildCacheFamilyAffinity(input: {
  cacheSupport?: string;
  currentFamilyKey?: string;
  previousFamilyKey?: string;
  previousExists: boolean;
}): {
  status: "unknown" | "aligned" | "mismatch";
  familyKey?: string;
  previousFamilyKey?: string;
  reason: string;
} {
  if ((input.cacheSupport ?? "unknown") !== "supported") {
    return {
      status: "unknown",
      reason: "provider_cache_not_supported",
    };
  }
  if (!input.currentFamilyKey) {
    return {
      status: "unknown",
      reason: "cache_family_key_unavailable",
    };
  }
  if (!input.previousExists || !input.previousFamilyKey) {
    return {
      status: "unknown",
      familyKey: input.currentFamilyKey,
      reason: "no_previous_cache_family",
    };
  }
  if (input.previousFamilyKey === input.currentFamilyKey) {
    return {
      status: "aligned",
      familyKey: input.currentFamilyKey,
      previousFamilyKey: input.previousFamilyKey,
      reason: "same_cache_family_as_previous",
    };
  }
  return {
    status: "mismatch",
    familyKey: input.currentFamilyKey,
    previousFamilyKey: input.previousFamilyKey,
    reason: "cache_family_changed_since_previous_snapshot",
  };
}

export function createGatewayPromptInspectionRuntime({
  stateDir,
  logger,
  promptSnapshotStore,
  promptSnapshotMaxPersistedRuns,
  promptSnapshotHeartbeatMaxRuns,
  promptSnapshotEmailThreadMaxRuns,
  promptSnapshotRetentionDays,
  agentWorkspaceCache,
  resolveAgentWorkspaceCacheEntry,
  dynamicSystemPromptBuild,
  toolExecutor,
  promptExperimentConfig,
  isTtsEnabled,
  providerCacheSupport,
  providerCapabilitySource,
}: {
  stateDir: string;
  logger: GatewayLogger;
  promptSnapshotStore: PromptSnapshotStore;
  promptSnapshotMaxPersistedRuns: number;
  promptSnapshotHeartbeatMaxRuns: number;
  promptSnapshotEmailThreadMaxRuns: number;
  promptSnapshotRetentionDays: number;
  agentWorkspaceCache: Map<string, {
    build: SystemPromptBuildResult;
    authorityProfile?: IdentityAuthorityProfile;
  }>;
  resolveAgentWorkspaceCacheEntry?: (profile: AgentProfile) => {
    build: SystemPromptBuildResult;
    authorityProfile?: IdentityAuthorityProfile;
  } | undefined;
  dynamicSystemPromptBuild: SystemPromptBuildResult;
  toolExecutor: ToolExecutor;
  promptExperimentConfig?: PromptExperimentConfig;
  isTtsEnabled: () => boolean;
  providerCacheSupport?: ProviderCacheSupport;
  providerCapabilitySource?: "env" | "unknown";
}) {
  function persistPromptSnapshot(snapshot: AgentPromptSnapshot): void {
    promptSnapshotStore.save(snapshot);
    void persistConversationPromptSnapshot({
      stateDir,
      snapshot,
      retention: {
        defaultMaxRunsPerConversation: promptSnapshotMaxPersistedRuns,
        heartbeatMaxRuns: promptSnapshotHeartbeatMaxRuns,
        emailThreadMaxRuns: promptSnapshotEmailThreadMaxRuns,
        maxAgeDays: promptSnapshotRetentionDays,
      },
    }).catch((error) => {
      logger.warn("prompt-snapshot", `Failed to persist prompt snapshot for conversation "${snapshot.conversationId}"`, error);
    });
  }

  function buildPromptInspectionProviderNativeSystemBlocks(input: {
    sections?: SystemPromptSection[];
    deltas?: AgentPromptDelta[];
    snapshot?: AgentPromptSnapshot;
    fallbackText?: string;
    tokenEstimateModel?: string;
  }): Array<ProviderNativeSystemBlock & PromptTextMetrics> {
    const snapshotBlocks = cloneProviderNativeSystemBlocks(input.snapshot?.providerNativeSystemBlocks);
    const resolvedBlocks = snapshotBlocks && snapshotBlocks.length > 0
      ? snapshotBlocks
      : buildProviderNativeSystemBlocks({
        sections: input.sections,
        deltas: input.deltas,
        fallbackText: input.fallbackText,
      });
    const tokenEstimateContext = input.tokenEstimateModel ? { model: input.tokenEstimateModel } : undefined;
    return resolvedBlocks.map((block) => withProviderNativeSystemBlockPromptMetrics(block, tokenEstimateContext));
  }

  function buildEffectiveAgentPromptInspection(profile: AgentProfile): {
    scope?: "agent" | "run";
    agentId: string;
    displayName: string;
    model: string;
    conversationId?: string;
    runId?: string;
    createdAt?: number;
    text: string;
    truncated: boolean;
    maxChars?: number;
    totalChars: number;
    finalChars: number;
    sections: Array<SystemPromptSection & PromptTextMetrics>;
    droppedSections: Array<SystemPromptSection & PromptTextMetrics>;
    deltas: Array<AgentPromptDelta & PromptTextMetrics>;
    providerNativeSystemBlocks: Array<ProviderNativeSystemBlock & PromptTextMetrics>;
    messages?: Array<Record<string, unknown>>;
    metadata: Record<string, unknown>;
  } {
    const workspaceEntry = agentWorkspaceCache.get(profile.id) ?? resolveAgentWorkspaceCacheEntry?.(profile);
    const baseBuild = workspaceEntry?.build ?? dynamicSystemPromptBuild;
    const visibleToolContracts = toolExecutor.getContracts(profile.id);
    const registeredToolContractNames = new Set(toolExecutor.getRegisteredToolContracts().map((contract) => contract.name));
    const toolBehaviorContracts = buildToolBehaviorObservability({
      contracts: visibleToolContracts,
      disabledContractNamesConfigured: promptExperimentConfig?.disabledToolContractNames,
      disabledContractNamesApplied: (promptExperimentConfig?.disabledToolContractNames ?? [])
        .filter((name) => registeredToolContractNames.has(name)),
    });
    const sections = [...baseBuild.sections];

    if (isTtsEnabled()) {
      sections.push(createGatewaySystemPromptSection({
        id: "tts-mode",
        label: "tts-mode",
        source: "runtime",
        priority: 130,
        text: `## [SYSTEM MODE: VOICE/TTS ENABLED]
The user has enabled text-to-speech. Audio will be generated automatically by the system.
You do NOT need to call any TTS tool — just respond with text as usual.
Do NOT include any <audio> HTML tags or [Download] links in your response.
Keep responses concise and natural for spoken delivery.`,
      }));
    }

    if (profile.systemPromptOverride) {
      sections.push(createGatewaySystemPromptSection({
        id: "profile-override",
        label: "profile-override",
        source: "profile",
        priority: 140,
        text: profile.systemPromptOverride.trim(),
      }));
    }

    const builtinPromptDiscoverySummary = toolExecutor.buildDeferredToolDiscoveryPromptSummary(profile.id);

    if (toolBehaviorContracts.summary) {
      sections.push(createGatewaySystemPromptSection({
        id: "tool-behavior-contracts",
        label: "tool-behavior-contracts",
        source: "runtime",
        priority: 105,
        text: toolBehaviorContracts.summary,
      }));
    }

    sections.push(createGatewaySystemPromptSection({
      id: "workspace-tool-routing",
      label: "workspace-tool-routing",
      source: "runtime",
      priority: 106,
      text: `## Workspace Tool Routing
When the user asks about repository files, inspect the workspace with tools instead of guessing from memory.
- For locating files or directories, prefer \`list_files\`.
- For reading a known file, prefer \`file_read\`.
- For localized edits to existing files, prefer \`apply_patch\` in the same run instead of replying with only a plan or suggested diff. Use raw patch text only: the first line must be \`*** Begin Patch\`, and do not wrap it in \`apply_patch(...)\` or a code fence.
- For new files, full-file replacement, or deferred schemas that are not visible yet, use \`tool_search\` first and then load the exact tool needed for the next turn.
If the user explicitly asked for analysis only, you may stop after inspection without editing.`,
    }));

    if (builtinPromptDiscoverySummary) {
      sections.push(createGatewaySystemPromptSection({
        id: "builtin-discovery",
        label: "builtin-discovery",
        source: "runtime",
        priority: 107,
        text: builtinPromptDiscoverySummary,
      }));
    }

    const promptExperimentResult = applyPromptExperimentsToSections(sections, promptExperimentConfig);
    const text = renderSystemPromptSections(promptExperimentResult.sections);
    const tokenEstimateModel = profile.model;
    const providerNativeSystemBlocks = buildPromptInspectionProviderNativeSystemBlocks({
      sections: promptExperimentResult.sections,
      fallbackText: text,
      tokenEstimateModel,
    });
    const promptStructure = buildPromptStructureMetadata({
      sections: promptExperimentResult.sections,
      providerNativeSystemBlocks,
      toolBehaviorIncluded: toolBehaviorContracts.included,
    });
    const tokenBreakdown = buildPromptTokenBreakdown({
      systemPromptText: text,
      sections: promptExperimentResult.sections,
      droppedSections: [...baseBuild.droppedSections, ...promptExperimentResult.droppedSections],
      providerNativeSystemBlocks,
      model: tokenEstimateModel,
    });
    const systemPromptFingerprint = computeSystemPromptFingerprint({
      text,
      providerNativeSystemBlocks,
      sectionIds: promptStructure.sectionIds,
    });
    const cacheFamilyKey = computeCacheFamilyKey({
      cacheSupport: providerCacheSupport ?? "unknown",
      model: profile.model,
      structureSignature: promptStructure.structureSignature,
      systemPromptFingerprint,
    });
    const resolvedProfileMetadata = resolveAgentProfileMetadata(profile);
    const memoryPolicy = resolveResidentMemoryPolicy(stateDir, profile);
    const residentStateBinding = resolveResidentStateBindingView(stateDir, profile);
    return {
      scope: "agent",
      agentId: profile.id,
      displayName: profile.displayName,
      model: profile.model,
      text,
      truncated: baseBuild.truncated,
      maxChars: baseBuild.maxChars,
      totalChars: text.length,
      finalChars: text.length,
      sections: promptExperimentResult.sections.map((section) => withSectionPromptMetrics(section, { model: tokenEstimateModel })),
      droppedSections: [...baseBuild.droppedSections, ...promptExperimentResult.droppedSections].map((section) => withSectionPromptMetrics(section, { model: tokenEstimateModel })),
      deltas: [],
      providerNativeSystemBlocks,
      metadata: {
        workspaceDir: resolvedProfileMetadata.workspaceDir,
        residentProfile: {
          kind: resolvedProfileMetadata.kind,
          workspaceBinding: resolvedProfileMetadata.workspaceBinding,
          workspaceDir: resolvedProfileMetadata.workspaceDir,
          sessionNamespace: resolvedProfileMetadata.sessionNamespace,
          memoryMode: resolvedProfileMetadata.memoryMode,
        },
        memoryPolicy: {
          memoryMode: memoryPolicy.memoryMode,
          managerStateDir: memoryPolicy.managerStateDir,
          privateStateDir: memoryPolicy.privateStateDir,
          sharedStateDir: memoryPolicy.sharedStateDir,
          includeSharedMemoryReads: memoryPolicy.includeSharedMemoryReads,
          readTargets: [...memoryPolicy.readTargets],
          writeTarget: memoryPolicy.writeTarget,
          summary: memoryPolicy.summary,
        },
        residentStateBinding,
        includesTtsMode: isTtsEnabled(),
        hasProfileOverride: Boolean(profile.systemPromptOverride),
        ...(typeof baseBuild.maxChars === "number" ? { systemPromptMaxChars: baseBuild.maxChars } : {}),
        baseFinalChars: baseBuild.finalChars,
        baseSectionCount: baseBuild.sections.length,
        finalSectionCount: promptExperimentResult.sections.length,
        deltaCount: 0,
        deltaChars: 0,
        includesHookSystemPrompt: false,
        sectionIds: promptStructure.sectionIds,
        providerNativeSystemBlockCount: providerNativeSystemBlocks.length,
        providerNativeSystemBlockChars: tokenBreakdown.providerNativeSystemBlockEstimatedChars,
        providerNativeBlockIds: promptStructure.providerNativeBlockIds,
        providerNativeSystemBlockTypes: promptStructure.providerNativeBlockTypes,
        providerNativeCacheEligibleBlockIds: promptStructure.providerNativeCacheEligibleBlockIds,
        toolBehaviorIncluded: promptStructure.toolBehaviorIncluded,
        structureSignature: promptStructure.structureSignature,
        cacheFamilyKey,
        orderingGuard: promptStructure.orderingGuard,
        systemPromptFingerprint,
        cacheSupport: providerCacheSupport ?? "unknown",
        capabilitySource: providerCapabilitySource ?? "unknown",
        providerCacheEligible: providerNativeSystemBlocks.some((block) => block.cacheControlEligible === true),
        tokenBreakdown,
        ...(baseBuild.truncationReason ? { truncationReason: { ...baseBuild.truncationReason } } : {}),
        toolBehaviorObservability: {
          counts: toolBehaviorContracts.counts,
          included: toolBehaviorContracts.included,
          ...(toolBehaviorContracts.summary ? { summary: toolBehaviorContracts.summary } : {}),
          ...(toolBehaviorContracts.experiment ? { experiment: toolBehaviorContracts.experiment } : {}),
        },
        promptExperiments: {
          disabledSectionIdsConfigured: promptExperimentConfig?.disabledSectionIds ?? [],
          disabledSectionIdsApplied: promptExperimentResult.disabledSectionIdsApplied,
          sectionPriorityOverridesConfigured: promptExperimentConfig?.sectionPriorityOverrides ?? {},
          sectionPriorityOverridesApplied: promptExperimentResult.sectionPriorityOverridesApplied,
          disabledToolContractNamesConfigured: promptExperimentConfig?.disabledToolContractNames ?? [],
          disabledToolContractNamesApplied: (promptExperimentConfig?.disabledToolContractNames ?? [])
            .filter((name) => registeredToolContractNames.has(name)),
        },
      },
    };
  }

  function normalizePromptSnapshotMessages(messages: AgentPromptSnapshotMessage[]): Array<Record<string, unknown>> {
    return messages.map((message) => ({
      role: message.role,
      content: Array.isArray(message.content)
        ? message.content.map((part) => ({ ...part }))
        : message.content,
      ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    }));
  }

  function summarizeContextInjectionMetadata(
    deltas: Array<AgentPromptDelta & PromptTextMetrics>,
    prependContextChars: number,
  ): Record<string, unknown> | undefined {
    const contextDeltas = deltas.filter((delta) => delta.source === "context-injection");
    if (contextDeltas.length === 0 && prependContextChars <= 0) {
      return undefined;
    }
    const blockTags: string[] = [];
    const blockLineCounts: Record<string, number> = {};
    let autoRecallObservability: Record<string, unknown> | undefined;

    for (const delta of contextDeltas) {
      const metadata = delta.metadata && typeof delta.metadata === "object" ? delta.metadata as Record<string, unknown> : undefined;
      const blockTag = typeof metadata?.blockTag === "string" && metadata.blockTag.trim()
        ? metadata.blockTag.trim()
        : "";
      if (blockTag) {
        blockTags.push(blockTag);
        const lineCount = typeof metadata?.lineCount === "number" && Number.isFinite(metadata.lineCount)
          ? Math.max(0, Math.trunc(metadata.lineCount))
          : 0;
        blockLineCounts[blockTag] = (blockLineCounts[blockTag] ?? 0) + lineCount;
      }
      if ((blockTag === "auto-recall" || blockTag === "auto-recall-summary") && metadata?.observability && typeof metadata.observability === "object") {
        autoRecallObservability = metadata.observability as Record<string, unknown>;
      }
    }

    return {
      prependContextChars,
      totalBlockCount: contextDeltas.length,
      blockTags: [...new Set(blockTags)],
      blockLineCounts,
      ...(autoRecallObservability ? { autoRecall: autoRecallObservability } : {}),
    };
  }

  function buildRunPromptInspection(snapshot: AgentPromptSnapshot, profile?: AgentProfile): {
    scope: "run";
    agentId: string;
    displayName?: string;
    model?: string;
    conversationId: string;
    runId?: string;
    createdAt: number;
    text: string;
    truncated: boolean;
    maxChars?: number;
    totalChars: number;
    finalChars: number;
    sections: Array<SystemPromptSection & PromptTextMetrics>;
    droppedSections: Array<SystemPromptSection & PromptTextMetrics>;
    deltas: Array<AgentPromptDelta & PromptTextMetrics>;
    providerNativeSystemBlocks: Array<ProviderNativeSystemBlock & PromptTextMetrics>;
    messages: Array<Record<string, unknown>>;
    metadata: Record<string, unknown>;
  } {
    const baseInspection = profile ? buildEffectiveAgentPromptInspection(profile) : undefined;
    const snapshotProviderNativeBlocks = cloneProviderNativeSystemBlocks(snapshot.providerNativeSystemBlocks);
    const structuredSplitPrompt = snapshotProviderNativeBlocks.length === 0
      ? stripStructuredRuntimeIdentityFromSystemPrompt({
        systemPrompt: snapshot.systemPrompt,
        deltas: snapshot.deltas,
      })
      : undefined;
    const staticPromptText = snapshotProviderNativeBlocks.length > 0
      ? renderProviderNativeSystemBlocksText(
        snapshotProviderNativeBlocks.filter((block) => block.blockType !== "dynamic-runtime"),
      )
      : (structuredSplitPrompt?.primaryText || snapshot.systemPrompt).trim();
    const sections: SystemPromptSection[] = [];
    const deltaRecords: AgentPromptDelta[] = [];
    let droppedSections: Array<SystemPromptSection & PromptTextMetrics> = [];
    let truncated = false;
    let maxChars: number | undefined;

    if (snapshot.hookSystemPromptUsed) {
      sections.push(createGatewaySystemPromptSection({
        id: "hook-system-prompt",
        label: "hook-system-prompt",
        source: "runtime",
        priority: 145,
        text: staticPromptText || snapshot.systemPrompt,
      }));
    } else if (
      baseInspection
      && snapshotProviderNativeBlocks.length > 0
      && renderProviderNativeSystemBlocksText(
        snapshotProviderNativeBlocks.filter((block) => block.blockType !== "dynamic-runtime"),
      ) === baseInspection.text
    ) {
      sections.push(...baseInspection.sections);
      droppedSections = baseInspection.droppedSections;
      truncated = baseInspection.truncated;
      maxChars = baseInspection.maxChars;
    } else if (baseInspection && structuredSplitPrompt?.primaryText === baseInspection.text) {
      sections.push(...baseInspection.sections);
      droppedSections = baseInspection.droppedSections;
      truncated = baseInspection.truncated;
      maxChars = baseInspection.maxChars;
    } else if (staticPromptText || snapshot.systemPrompt) {
      sections.push(createGatewaySystemPromptSection({
        id: "runtime-system-prompt",
        label: "runtime-system-prompt",
        source: "runtime",
        priority: 145,
        text: staticPromptText || snapshot.systemPrompt,
      }));
    }

    if (snapshot.deltas && snapshot.deltas.length > 0) {
      for (const delta of snapshot.deltas) {
        deltaRecords.push({ ...delta });
      }
    }

    const deltas = deltaRecords.map((delta) => withDeltaPromptMetrics(delta, profile?.model ? { model: profile.model } : undefined));
    const providerNativeSystemBlocks = buildPromptInspectionProviderNativeSystemBlocks({
      sections: snapshot.hookSystemPromptUsed ? undefined : sections,
      deltas: deltaRecords,
      snapshot,
      fallbackText: snapshot.systemPrompt,
      tokenEstimateModel: profile?.model,
    });
    const measuredSections = sections.map((section) => withSectionPromptMetrics(section, profile?.model ? { model: profile.model } : undefined));
    const toolBehaviorIncluded = isRecord(snapshot.inputMeta?.toolBehaviorObservability)
      ? readStringArray(snapshot.inputMeta.toolBehaviorObservability.included)
      : [];
    const promptStructure = buildPromptStructureMetadata({
      sections,
      providerNativeSystemBlocks,
      toolBehaviorIncluded,
    });
    const tokenBreakdown = buildPromptTokenBreakdown({
      systemPromptText: snapshot.systemPrompt,
      sections,
      droppedSections,
      deltas,
      providerNativeSystemBlocks,
      model: profile?.model,
    });
    const currentFingerprint = computeSystemPromptFingerprint({
      text: snapshot.systemPrompt,
      providerNativeSystemBlocks,
      sectionIds: promptStructure.sectionIds,
    });
    const previousSnapshot = promptSnapshotStore.getPrevious({
      conversationId: snapshot.conversationId,
      runId: snapshot.runId,
      agentId: snapshot.agentId ?? profile?.id,
    });
    const previousProviderNativeBlocks = cloneProviderNativeSystemBlocks(previousSnapshot?.providerNativeSystemBlocks);
    const previousInputMeta = isRecord(previousSnapshot?.inputMeta) ? previousSnapshot.inputMeta : undefined;
    const previousSectionIds = readStringArray(previousInputMeta?.sectionIds);
    const previousProviderNativeBlockIds = readStringArray(previousInputMeta?.providerNativeBlockIds);
    const previousProviderNativeBlockTypes = readStringArray(previousInputMeta?.providerNativeSystemBlockTypes);
    const previousProviderNativeCacheEligibleBlockIds = readStringArray(previousInputMeta?.providerNativeCacheEligibleBlockIds);
    const previousToolBehaviorIncluded = readStringArray(previousInputMeta?.toolBehaviorIncluded);
    const previousFingerprint = previousSnapshot
      ? computeSystemPromptFingerprint({
        text: previousSnapshot.systemPrompt,
        providerNativeSystemBlocks: previousProviderNativeBlocks,
        sectionIds: previousSectionIds,
      })
      : undefined;
    const prefixDrift = classifyPrefixDrift({
      previous: previousSnapshot
        ? {
          systemPromptFingerprint: previousFingerprint,
          sectionIds: previousSectionIds,
          providerNativeBlockIds: previousProviderNativeBlockIds,
          providerNativeBlockTypes: previousProviderNativeBlockTypes,
          providerNativeCacheEligibleBlockIds: previousProviderNativeCacheEligibleBlockIds,
          toolBehaviorIncluded: previousToolBehaviorIncluded,
          structureSignature: typeof previousInputMeta?.structureSignature === "string"
            ? previousInputMeta.structureSignature
            : undefined,
          cacheSupport: typeof previousSnapshot.inputMeta?.cacheSupport === "string"
            ? previousSnapshot.inputMeta.cacheSupport
            : undefined,
        }
        : undefined,
      current: {
        systemPromptFingerprint: currentFingerprint,
        sectionIds: promptStructure.sectionIds,
        providerNativeBlockIds: promptStructure.providerNativeBlockIds,
        providerNativeBlockTypes: promptStructure.providerNativeBlockTypes,
        providerNativeCacheEligibleBlockIds: promptStructure.providerNativeCacheEligibleBlockIds,
        toolBehaviorIncluded: promptStructure.toolBehaviorIncluded,
        structureSignature: promptStructure.structureSignature,
        cacheSupport: typeof baseInspection?.metadata?.cacheSupport === "string"
          ? baseInspection.metadata.cacheSupport
          : (providerCacheSupport ?? "unknown"),
      },
    });
    const prefixWarmState = buildPrefixWarmState({
      currentFingerprint,
      currentCacheSupport: typeof baseInspection?.metadata?.cacheSupport === "string"
        ? baseInspection.metadata.cacheSupport
        : (providerCacheSupport ?? "unknown"),
      currentCreatedAt: snapshot.createdAt,
      previous: previousSnapshot
        ? {
          systemPromptFingerprint: previousFingerprint,
          createdAt: previousSnapshot.createdAt,
          cacheSupport: typeof previousSnapshot.inputMeta?.cacheSupport === "string"
            ? previousSnapshot.inputMeta.cacheSupport
            : undefined,
        }
        : undefined,
      drift: {
        status: prefixDrift.status,
      },
    });
    const warmupCoordination = buildWarmupCoordination({
      cacheSupport: typeof baseInspection?.metadata?.cacheSupport === "string"
        ? baseInspection.metadata.cacheSupport
        : (providerCacheSupport ?? "unknown"),
      prefixWarmState,
      prefixDrift: {
        status: prefixDrift.status,
      },
      orderingGuard: promptStructure.orderingGuard,
    });
    const currentCacheFamilyKey = computeCacheFamilyKey({
      cacheSupport: typeof baseInspection?.metadata?.cacheSupport === "string"
        ? baseInspection.metadata.cacheSupport
        : (providerCacheSupport ?? "unknown"),
      model: profile?.model,
      structureSignature: promptStructure.structureSignature,
      systemPromptFingerprint: currentFingerprint,
    });
    const previousCacheFamilyKey = typeof previousInputMeta?.cacheFamilyKey === "string"
      ? previousInputMeta.cacheFamilyKey
      : computeCacheFamilyKey({
        cacheSupport: typeof previousSnapshot?.inputMeta?.cacheSupport === "string"
          ? previousSnapshot.inputMeta.cacheSupport
          : undefined,
        model: profile?.model,
        structureSignature: typeof previousInputMeta?.structureSignature === "string"
          ? previousInputMeta.structureSignature
          : undefined,
        systemPromptFingerprint: previousFingerprint,
      });
    const cacheFamilyAffinity = buildCacheFamilyAffinity({
      cacheSupport: typeof baseInspection?.metadata?.cacheSupport === "string"
        ? baseInspection.metadata.cacheSupport
        : (providerCacheSupport ?? "unknown"),
      currentFamilyKey: currentCacheFamilyKey,
      previousFamilyKey: previousCacheFamilyKey,
      previousExists: Boolean(previousSnapshot),
    });
    const residentPromptMetadata = readResidentPromptMetadata(isRecord(snapshot.inputMeta) ? snapshot.inputMeta : undefined);
    const contextInjection = summarizeContextInjectionMetadata(deltas, snapshot.prependContext?.length ?? 0);
    const snapshotTruncationReason = isRecord(snapshot.inputMeta)
      ? readPromptTruncationReasonFromMetadata(snapshot.inputMeta as Record<string, unknown>)
      : undefined;
    if (
      droppedSections.length === 0
      && snapshotTruncationReason?.droppedSectionIds?.length
      && baseInspection?.droppedSections?.length
    ) {
      const droppedSectionIdSet = new Set(snapshotTruncationReason.droppedSectionIds);
      droppedSections = baseInspection.droppedSections.filter((section) => droppedSectionIdSet.has(section.id));
    }

    return {
      scope: "run",
      agentId: snapshot.agentId ?? profile?.id ?? "default",
      displayName: profile?.displayName,
      model: profile?.model,
      conversationId: snapshot.conversationId,
      runId: snapshot.runId,
      createdAt: snapshot.createdAt,
      text: snapshot.systemPrompt,
      truncated: snapshotTruncationReason ? true : truncated,
      maxChars: snapshotTruncationReason?.maxChars ?? maxChars,
      totalChars: snapshot.systemPrompt.length,
      finalChars: snapshot.systemPrompt.length,
      sections: measuredSections,
      droppedSections,
      deltas,
      providerNativeSystemBlocks,
      messages: normalizePromptSnapshotMessages(snapshot.messages),
      metadata: {
        ...(baseInspection?.metadata ?? {}),
        ...residentPromptMetadata,
        snapshotScope: "run",
        snapshotCreatedAt: snapshot.createdAt,
        includesHookSystemPrompt: snapshot.hookSystemPromptUsed === true,
        hasPrependContext: Boolean(snapshot.prependContext),
        prependContextChars: snapshot.prependContext?.length ?? 0,
        includesRuntimeIdentityContext: deltas.some((delta) => delta.deltaType === "runtime-identity"),
        deltaCount: deltas.length,
        deltaChars: tokenBreakdown.deltaEstimatedChars,
        deltaTypes: [...new Set(deltas.map((delta) => delta.deltaType))],
        sectionIds: promptStructure.sectionIds,
        providerNativeSystemBlockCount: providerNativeSystemBlocks.length,
        providerNativeSystemBlockChars: tokenBreakdown.providerNativeSystemBlockEstimatedChars,
        providerNativeBlockIds: promptStructure.providerNativeBlockIds,
        providerNativeSystemBlockTypes: promptStructure.providerNativeBlockTypes,
        providerNativeCacheEligibleBlockIds: promptStructure.providerNativeCacheEligibleBlockIds,
        toolBehaviorIncluded: promptStructure.toolBehaviorIncluded,
        structureSignature: promptStructure.structureSignature,
        cacheFamilyKey: currentCacheFamilyKey,
        orderingGuard: promptStructure.orderingGuard,
        systemPromptFingerprint: currentFingerprint,
        cacheSupport: typeof baseInspection?.metadata?.cacheSupport === "string"
          ? baseInspection.metadata.cacheSupport
          : (providerCacheSupport ?? "unknown"),
        capabilitySource: typeof baseInspection?.metadata?.capabilitySource === "string"
          ? baseInspection.metadata.capabilitySource
          : (providerCapabilitySource ?? "unknown"),
        providerCacheEligible: providerNativeSystemBlocks.some((block) => block.cacheControlEligible === true),
        prefixDrift,
        prefixWarmState,
        warmupCoordination,
        cacheFamilyAffinity,
        ...(contextInjection ? { contextInjection } : {}),
        tokenBreakdown,
        ...(snapshotTruncationReason ? { truncationReason: snapshotTruncationReason } : {}),
        inputMeta: snapshot.inputMeta ? { ...snapshot.inputMeta } : undefined,
      },
    };
  }

  return {
    persistPromptSnapshot,
    buildEffectiveAgentPromptInspection,
    buildRunPromptInspection,
  };
}
