import fs from "node:fs";
import fsp from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import {
  type EnvDirSource,
  type StateDirBootstrapSource,
  loadStateDirBootstrapInfo,
} from "@star-sanctuary/distribution";
import { readMcpRoutingDoctorReport } from "../mcp-config-routing.js";

import type {
  AgentRegistry,
  CompactionRuntimeReport,
  ConversationStore,
  SessionTimelineProjection,
  SessionTranscriptExportBundle,
} from "@belldandy/agent";
import type { GatewayReqFrame, GatewayResFrame } from "@belldandy/protocol";
import {
  DURABLE_EXTRACTION_REQUEST_RATE_LIMIT_REASON_CODE,
  DURABLE_EXTRACTION_REQUEST_RATE_LIMIT_REASON_MESSAGE,
  buildMemorySourceInventoryDoctorReport,
  getGlobalMemoryManager,
  type DreamRuntime,
  type DurableExtractionRuntime,
} from "@belldandy/memory";
import type {
  ToolContractChannel,
  ToolExecutionRuntimeContext,
  ToolExecutor,
  SkillRegistry,
} from "@belldandy/skills";
import {
  buildCameraRuntimeDoctorReport,
  listToolContractsV2,
  TOOL_SETTINGS_CONTROL_NAME,
} from "@belldandy/skills";
import type { PluginRegistry } from "@belldandy/plugins";

import type { BackgroundContinuationRuntimeDoctorReport } from "../background-continuation-runtime.js";
import {
  buildAssistantModeRuntimeReport,
  type AssistantModeRuntimeReport,
  DEFAULT_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE,
  parseAssistantExternalDeliveryPreference,
} from "../assistant-mode-runtime.js";
import { buildChannelSecurityDoctorReport } from "../channel-security-doctor.js";
import {
  applyTimelineProjectionFilter,
  applyTranscriptExportProjection,
  normalizeConversationIdPrefix,
  normalizeTimelineKinds,
  normalizeTranscriptEventTypes,
  normalizeTranscriptRestoreView,
  parsePositiveInteger,
} from "../conversation-debug-projection.js";
import { listRecentConversationExports } from "../conversation-export-index.js";
import type { CronRuntimeDoctorReport } from "../cron/observability.js";
import { buildAssistantModeGoalRuntimeSummary } from "../assistant-mode-goals.js";
import { buildBridgeRecoveryDiagnostics } from "../bridge-recovery-diagnostics.js";
import { buildDeploymentBackendsDoctorReport } from "../deployment-backends.js";
import { buildExtensionGovernanceReport } from "../extension-governance.js";
import { loadExtensionMarketplaceState } from "../extension-marketplace-state.js";
import type { ExtensionHostState } from "../extension-host.js";
import { buildExtensionRuntimeReport } from "../extension-runtime.js";
import {
  buildExternalOutboundDoctorReport,
  type ExternalOutboundDoctorReport,
} from "../external-outbound-doctor.js";
import type { ExternalOutboundAuditStore } from "../external-outbound-audit-store.js";
import type { ExternalOutboundConfirmationStore } from "../external-outbound-confirmation-store.js";
import {
  buildEmailOutboundDoctorReport,
  type EmailOutboundDoctorReport,
} from "../email-outbound-doctor.js";
import type { EmailOutboundAuditStore } from "../email-outbound-audit-store.js";
import {
  buildEmailInboundDoctorReport,
  type EmailInboundDoctorReport,
} from "../email-inbound-doctor.js";
import type { EmailInboundAuditStore } from "../email-inbound-audit-store.js";
import type { EmailFollowUpReminderStore } from "../email-follow-up-reminder-store.js";
import { buildLearningReviewInput } from "../learning-review-input.js";
import { buildMemoryClassConsumerView } from "../memory-class-consumer-view.js";
import {
  buildGovernanceFreshnessFromInventory,
  buildMemoryFreshnessView,
  buildProceduralExperienceFreshnessFromSkillSnapshot,
  buildProfileSemanticFreshnessView,
  buildProjectSemanticFreshnessFromInventory,
} from "../memory-freshness-view.js";
import { buildLearningReviewNudgeRuntimeReport } from "../learning-review-nudge-runtime.js";
import type {
  MemoryRuntimeBudgetGuard,
  RateLimitState,
  SlidingWindowRateLimiter,
} from "../memory-runtime-budget.js";
import { buildMemoryRuntimeDoctorReport } from "../memory-runtime-introspection.js";
import { buildMindProfileSnapshot } from "../mind-profile-snapshot.js";
import { buildPromptObservabilitySummary, formatPromptObservabilityHeadline, toPromptObservabilityView } from "../prompt-observability.js";
import { buildAgentRoster } from "../query-runtime-agent-roster.js";
import type { QueryRuntimeTraceStore } from "../query-runtime-trace.js";
import type { RuntimeResourceObservability } from "../runtime-resource-observability.js";
import { readConfiguredMemorySourcesStore } from "../memory-configured-sources-store.js";
import type { ScopedMemoryManagerRecord } from "../resident-memory-managers.js";
import { buildResidentAgentObservabilitySnapshot } from "../resident-agent-observability.js";
import {
  buildResidentSharedGovernanceDoctorReport,
  buildResidentSharedGovernancePreview,
} from "../resident-shared-governance-report.js";
import { ResidentAgentRuntimeRegistry } from "../resident-agent-runtime.js";
import { resolveResidentStateBindingViewForAgent } from "../resident-state-binding.js";
import { buildOptionalCapabilitiesDoctorReport } from "../optional-capabilities-doctor.js";
import { buildPreflightCompressionGovernanceReport } from "../preflight-compression-governance.js";
import type { RuntimeResilienceDoctorReport } from "../runtime-resilience.js";
import { buildRuntimeResilienceDiagnosticSummary } from "../runtime-resilience-diagnostics.js";
import {
  buildSkillFreshnessSnapshot,
} from "../skill-freshness.js";
import { buildDelegationObservabilitySnapshot } from "../subtask-result-envelope.js";
import type { SubTaskRuntimeStore } from "../task-runtime.js";
import { buildToolBehaviorObservability, readConfiguredPromptExperimentToolContracts } from "../tool-behavior-observability.js";
import { buildToolContractV2Observability } from "../tool-contract-v2-observability.js";
import type { ToolsConfigManager } from "../tools-config.js";
import { buildAgentLaunchExplainability } from "../agent-launch-explainability.js";
import type { GoalManager } from "../goals/manager.js";
import type { ObsidianCommonsRuntime } from "../obsidian-commons-runtime.js";

type SystemDoctorMethodContext = {
  stateDir: string;
  requestChannel?: ToolContractChannel;
  envDir?: string;
  envSource?: EnvDirSource;
  agentFactory: () => unknown;
  agentRegistry?: AgentRegistry;
  conversationStore: ConversationStore;
  durableExtractionRuntime?: DurableExtractionRuntime;
  memoryBudgetGuard: MemoryRuntimeBudgetGuard;
  durableExtractionRequestRateLimiter: SlidingWindowRateLimiter;
  toolsConfigManager?: ToolsConfigManager;
  toolExecutor?: ToolExecutor;
  externalOutboundAuditStore?: ExternalOutboundAuditStore;
  externalOutboundConfirmationStore?: ExternalOutboundConfirmationStore;
  emailOutboundAuditStore?: EmailOutboundAuditStore;
  emailInboundAuditStore?: EmailInboundAuditStore;
  emailFollowUpReminderStore?: EmailFollowUpReminderStore;
  pluginRegistry?: PluginRegistry;
  extensionHost?: Pick<ExtensionHostState, "extensionRuntime" | "lifecycle">;
  skillRegistry?: SkillRegistry;
  getCompactionRuntimeReport?: () => CompactionRuntimeReport | undefined;
  getRuntimeResilienceReport?: () => RuntimeResilienceDoctorReport | undefined;
  queryRuntimeTraceStore: QueryRuntimeTraceStore;
  runtimeResourceObservability: RuntimeResourceObservability;
  residentAgentRuntime: ResidentAgentRuntimeRegistry;
  residentMemoryManagers?: ScopedMemoryManagerRecord[];
  getCronRuntimeDoctorReport?: () => Promise<CronRuntimeDoctorReport | undefined>;
  getBackgroundContinuationRuntimeDoctorReport?: () => Promise<BackgroundContinuationRuntimeDoctorReport | undefined>;
  resolveDreamRuntime?: (agentId?: string) => DreamRuntime | null;
  resolveDreamDefaultConversationId?: (agentId?: string) => string;
  resolveCommonsExportRuntime?: () => ObsidianCommonsRuntime | null;
  inspectAgentPrompt?: (input: {
    agentId?: string;
    conversationId?: string;
    runId?: string;
  }) => Promise<any>;
  subTaskRuntimeStore?: SubTaskRuntimeStore;
  goalManager?: GoalManager;
  /** 动态工作流运行时（用于 doctor 观测） */
  workflowRuntime?: import("@belldandy/skills").WorkflowRuntimeCapabilities;
};

type DoctorPerformanceStage = {
  name: string;
  durationMs: number;
  status: "ok" | "error";
  error?: string;
};

type DoctorPerformanceSummary = {
  startedAt: string;
  finishedAt: string;
  totalMs: number;
  stages: DoctorPerformanceStage[];
};

type TimedDoctorStageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

type DoctorSurface = "summary" | "full";

type MemoryEvaluationStatus = "pass" | "warn";

type MemoryEvaluationSummary = {
  available: boolean;
  status: MemoryEvaluationStatus;
  headline: string;
  profileStateFieldCount: number;
  freshnessReviewRequiredCount: number;
  freshnessStaleCount: number;
  governancePendingCount: number;
  governanceClaimedCount: number;
  dreamProfilePatchBacklogCount: number;
  dreamStaleBacklogCount: number;
  dreamContradictionBacklogCount: number;
  experienceUsageLinkedResidentCount: number;
  signals: string[];
};

const SYSTEM_DOCTOR_SUMMARY_CACHE_TTL_MS = 1500;
const SYSTEM_DOCTOR_FULL_CACHE_TTL_MS = 5000;

const doctorResponseCache = new Map<string, {
  expiresAt: number;
  response: GatewayResFrame;
}>();
const doctorResponseInflight = new Map<string, Promise<GatewayResFrame>>();

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeDoctorSurface(value: unknown): DoctorSurface {
  return typeof value === "string" && value.trim().toLowerCase() === "summary"
    ? "summary"
    : "full";
}

function buildMemoryEvaluationSummary(input: {
  mindProfileSnapshot?: any;
  memoryFreshness?: any;
  residentAgents?: any;
  dreamRuntime?: any;
}): MemoryEvaluationSummary | undefined {
  const profileStateFieldCount = Array.isArray(input.mindProfileSnapshot?.profile?.stateEntries)
    ? input.mindProfileSnapshot.profile.stateEntries.length
    : 0;
  const freshnessReviewRequiredCount = Number(input.memoryFreshness?.summary?.reviewRequiredCount) || 0;
  const freshnessStaleCount = Number(input.memoryFreshness?.summary?.staleCount) || 0;
  const governancePendingCount = Number(input.residentAgents?.summary?.sharedGovernanceCounts?.pendingCount) || 0;
  const governanceClaimedCount = Number(input.residentAgents?.summary?.sharedGovernanceCounts?.claimedCount) || 0;
  const experienceUsageLinkedResidentCount = Number(input.residentAgents?.summary?.experienceUsageLinkedCount) || 0;
  const latestDreamConsolidation = input.dreamRuntime?.latestRun?.consolidation
    ?? (Array.isArray(input.dreamRuntime?.state?.recentRuns) ? input.dreamRuntime.state.recentRuns[0]?.consolidation : null);
  const dreamProfilePatchBacklogCount = Array.isArray(latestDreamConsolidation?.profilePatchCandidates)
    ? latestDreamConsolidation.profilePatchCandidates.length
    : 0;
  const dreamStaleBacklogCount = Array.isArray(latestDreamConsolidation?.staleCandidates)
    ? latestDreamConsolidation.staleCandidates.length
    : 0;
  const dreamContradictionBacklogCount = Array.isArray(latestDreamConsolidation?.contradictionCandidates)
    ? latestDreamConsolidation.contradictionCandidates.length
    : 0;

  const available = profileStateFieldCount > 0
    || freshnessReviewRequiredCount > 0
    || freshnessStaleCount > 0
    || governancePendingCount > 0
    || governanceClaimedCount > 0
    || dreamProfilePatchBacklogCount > 0
    || dreamStaleBacklogCount > 0
    || dreamContradictionBacklogCount > 0
    || experienceUsageLinkedResidentCount > 0;
  if (!available) {
    return undefined;
  }

  const signals: string[] = [];
  if (profileStateFieldCount > 0) {
    signals.push(`profile coverage=${profileStateFieldCount}`);
  }
  if (freshnessReviewRequiredCount > 0 || freshnessStaleCount > 0) {
    signals.push(`freshness review=${freshnessReviewRequiredCount}, stale=${freshnessStaleCount}`);
  }
  if (governancePendingCount > 0 || governanceClaimedCount > 0) {
    signals.push(`shared governance pending=${governancePendingCount}, claimed=${governanceClaimedCount}`);
  }
  if (dreamProfilePatchBacklogCount > 0 || dreamStaleBacklogCount > 0 || dreamContradictionBacklogCount > 0) {
    signals.push(`dream backlog patch=${dreamProfilePatchBacklogCount}, stale=${dreamStaleBacklogCount}, contradiction=${dreamContradictionBacklogCount}`);
  }
  if (experienceUsageLinkedResidentCount > 0) {
    signals.push(`experience-linked residents=${experienceUsageLinkedResidentCount}`);
  }

  const status: MemoryEvaluationStatus = freshnessReviewRequiredCount > 0
    || freshnessStaleCount > 0
    || governancePendingCount > 0
    || governanceClaimedCount > 0
    || dreamProfilePatchBacklogCount > 0
    || dreamStaleBacklogCount > 0
    || dreamContradictionBacklogCount > 0
    ? "warn"
    : "pass";

  const headline = status === "warn"
    ? `Memory evaluation needs attention: profile=${profileStateFieldCount}, freshness review=${freshnessReviewRequiredCount}, shared pending=${governancePendingCount}, dream patch backlog=${dreamProfilePatchBacklogCount}.`
    : `Memory evaluation baseline is readable: profile=${profileStateFieldCount}, freshness active, shared queue clear, dream backlog clear.`;

  return {
    available,
    status,
    headline,
    profileStateFieldCount,
    freshnessReviewRequiredCount,
    freshnessStaleCount,
    governancePendingCount,
    governanceClaimedCount,
    dreamProfilePatchBacklogCount,
    dreamStaleBacklogCount,
    dreamContradictionBacklogCount,
    experienceUsageLinkedResidentCount,
    signals,
  };
}

function stabilizeDoctorCacheValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stabilizeDoctorCacheValue(item));
  }
  if (isObjectRecord(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        if (key === "forceRefresh") {
          return acc;
        }
        acc[key] = stabilizeDoctorCacheValue(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function isCacheableDoctorRequest(params: Record<string, unknown>): boolean {
  return Object.keys(params).every((key) => key === "surface" || key === "forceRefresh");
}

function buildDoctorCacheKey(
  params: Record<string, unknown>,
  surface: DoctorSurface,
  ctx: Pick<SystemDoctorMethodContext, "stateDir" | "envDir">,
): string {
  return JSON.stringify({
    surface,
    stateDir: path.resolve(ctx.stateDir),
    envDir: path.resolve(ctx.envDir ?? ctx.stateDir),
    params: stabilizeDoctorCacheValue(params),
  });
}

function cloneDoctorResponse(response: GatewayResFrame, id: string): GatewayResFrame {
  return {
    ...response,
    id,
  };
}

function resolveDoctorCacheTtlMs(surface: DoctorSurface): number {
  return surface === "summary"
    ? SYSTEM_DOCTOR_SUMMARY_CACHE_TTL_MS
    : SYSTEM_DOCTOR_FULL_CACHE_TTL_MS;
}

function readCachedDoctorResponse(cacheKey: string, id: string): GatewayResFrame | undefined {
  const cached = doctorResponseCache.get(cacheKey);
  if (!cached) {
    return undefined;
  }
  if (cached.expiresAt <= Date.now()) {
    doctorResponseCache.delete(cacheKey);
    return undefined;
  }
  return cloneDoctorResponse(cached.response, id);
}

function formatRateLimitState(rateLimit: RateLimitState): string {
  if (!rateLimit.configured) {
    return "unlimited";
  }
  const base = `${rateLimit.observedRuns}/${rateLimit.maxRuns} in ${rateLimit.windowMs}ms`;
  if (rateLimit.status === "limited") {
    return `${base}, retryAfter=${rateLimit.retryAfterMs ?? 0}ms`;
  }
  return base;
}

async function readConfiguredMemorySourcesForDoctor(stateDir: string) {
  try {
    const store = await readConfiguredMemorySourcesStore(stateDir);
    return store.sources;
  } catch {
    return [];
  }
}

async function statIfExists(targetPath: string): Promise<fs.Stats | null> {
  try {
    return await fsp.stat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function hasTranscriptExportArtifacts(bundle: SessionTranscriptExportBundle | undefined): boolean {
  if (!bundle) {
    return false;
  }
  return bundle.summary.eventCount > 0 || bundle.restore.rawMessages.length > 0;
}

function hasTimelineArtifacts(timeline: SessionTimelineProjection | undefined): boolean {
  if (!timeline) {
    return false;
  }
  return timeline.summary.eventCount > 0
    || timeline.summary.messageCount > 0
    || timeline.items.some((item) => item.kind !== "restore_result");
}

function resolveDoctorEnvSource(
  _envDir: string,
  _stateDir: string,
  _envSource?: EnvDirSource,
): EnvDirSource {
  return "state_dir";
}

function buildConfigSourceDoctorReport(ctx: Pick<SystemDoctorMethodContext, "envDir" | "envSource" | "stateDir">) {
  const stateDir = path.resolve(ctx.stateDir);
  const envDir = stateDir;
  const source = resolveDoctorEnvSource(envDir, stateDir, ctx.envSource);
  const bootstrap = loadStateDirBootstrapInfo(process.env);
  const stateDirSource: StateDirBootstrapSource = bootstrap.source;
  const stateDirSourceLabel = stateDirSource === "bootstrap_env"
    ? "bootstrap env"
    : stateDirSource === "process_env"
      ? "process env"
      : "default home";
  const sourceLabel = "state-dir config";
  const headline = `Using state-dir config from ${stateDir}; stateDir source=${stateDirSourceLabel}; Gateway reads .env / .env.local from BELLDANDY_STATE_DIR on every start.`;

  return {
    envDir,
    stateDir,
    source,
    stateDirSource,
    stateDirSourceLabel,
    ...(bootstrap.bootstrapFilePath ? { stateDirBootstrapFilePath: bootstrap.bootstrapFilePath } : {}),
    sourceLabel,
    stateDirActive: true,
    projectRootWins: false,
    resolutionOrder: [
      `stateDir source (${stateDirSourceLabel})`,
      "state-dir config (BELLDANDY_STATE_DIR)",
    ],
    headline,
  };
}

function roundDoctorDurationMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 10) {
    return Number(value.toFixed(2));
  }
  if (value < 100) {
    return Number(value.toFixed(1));
  }
  return Math.round(value);
}

function formatDoctorStageError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

function captureDoctorStage<T>(
  stages: DoctorPerformanceStage[],
  name: string,
  fn: () => Promise<T> | T,
): Promise<TimedDoctorStageResult<T>> {
  const stage: DoctorPerformanceStage = {
    name,
    durationMs: 0,
    status: "ok",
  };
  stages.push(stage);
  const startedAt = performance.now();
  return Promise.resolve()
    .then(fn)
    .then((value) => {
      stage.durationMs = roundDoctorDurationMs(performance.now() - startedAt);
      return { ok: true, value } satisfies TimedDoctorStageResult<T>;
    })
    .catch((error) => {
      stage.durationMs = roundDoctorDurationMs(performance.now() - startedAt);
      stage.status = "error";
      stage.error = formatDoctorStageError(error);
      return { ok: false, error } satisfies TimedDoctorStageResult<T>;
    });
}

function unwrapDoctorStageResult<T>(result: TimedDoctorStageResult<T>): T {
  if (result.ok) {
    return result.value;
  }
  throw result.error;
}

function pushDoctorWarnCheck(
  checks: Array<{ id: string; name: string; status: string; message: string }>,
  id: string,
  name: string,
  error: unknown,
): void {
  checks.push({
    id,
    name,
    status: "warn",
    message: formatDoctorStageError(error),
  });
}

function extractScopedMemoryAgentId(params: Record<string, unknown>): string | undefined {
  if (typeof params.agentId === "string" && params.agentId.trim()) {
    return params.agentId.trim();
  }
  if (typeof params.conversationId === "string" && params.conversationId.trim()) {
    return undefined;
  }
  const filter = isObjectRecord(params.filter) ? params.filter : undefined;
  if (filter && typeof filter.agentId === "string" && filter.agentId.trim()) {
    return filter.agentId.trim();
  }
  return undefined;
}

function extractDreamAgentId(params: Record<string, unknown>): string {
  if (typeof params.dreamAgentId === "string" && params.dreamAgentId.trim()) {
    return params.dreamAgentId.trim();
  }
  return extractScopedMemoryAgentId(params) ?? "default";
}

function extractReviewerMemoryAgentId(params: Record<string, unknown>): string | undefined {
  if (typeof params.reviewerAgentId === "string" && params.reviewerAgentId.trim()) {
    return params.reviewerAgentId.trim();
  }
  return extractScopedMemoryAgentId(params);
}

function resolveScopedMemoryManager(params: Record<string, unknown> = {}) {
  const conversationId = typeof params.conversationId === "string" && params.conversationId.trim()
    ? params.conversationId.trim()
    : undefined;
  const agentId = extractScopedMemoryAgentId(params);
  return getGlobalMemoryManager({
    agentId,
    conversationId,
  });
}

function resolveResidentMemoryManagerRecord(
  agentId: string | undefined,
  records: ScopedMemoryManagerRecord[] = [],
): ScopedMemoryManagerRecord | undefined {
  const normalizedAgentId = typeof agentId === "string" && agentId.trim()
    ? agentId.trim()
    : "default";
  return records.find((item) => item.agentId === normalizedAgentId)
    ?? records.find((item) => item.agentId === "default");
}

function resolveScopedResidentMemoryPolicy(
  params: Record<string, unknown> = {},
  records: ScopedMemoryManagerRecord[] = [],
) {
  return resolveResidentMemoryManagerRecord(extractScopedMemoryAgentId(params), records)?.policy
    ?? resolveResidentMemoryManagerRecord("default", records)?.policy;
}

async function buildScopedSkillFreshnessSnapshot(
  stateDir: string,
  manager: ReturnType<typeof resolveScopedMemoryManager>,
) {
  return buildSkillFreshnessSnapshot({
    manager,
    stateDir,
  });
}

async function buildDreamRuntimeDoctorReport(
  ctx: Pick<SystemDoctorMethodContext, "resolveDreamRuntime" | "resolveDreamDefaultConversationId">,
  params: Record<string, unknown>,
) {
  if (typeof ctx.resolveDreamRuntime !== "function") {
    return undefined;
  }
  const agentId = extractDreamAgentId(params);
  const defaultConversationId = typeof ctx.resolveDreamDefaultConversationId === "function"
    ? ctx.resolveDreamDefaultConversationId(agentId)
    : undefined;
  const runtime = ctx.resolveDreamRuntime(agentId);
  if (!runtime) {
    return {
      requested: {
        agentId,
        defaultConversationId: defaultConversationId ?? null,
      },
      availability: {
        enabled: false,
        available: false,
        reason: "dream runtime unavailable",
      },
      state: null,
      latestRun: null,
      autoSummary: null,
      headline: `Dream runtime is unavailable for agent ${agentId}.`,
    };
  }

  const state = await runtime.getState();
  const latestRun = state.recentRuns[0] ?? null;
  const availability = runtime.getAvailability();
  const autoSummary = state.lastAutoTrigger
    ? {
        triggerMode: state.lastAutoTrigger.triggerMode,
        attemptedAt: state.lastAutoTrigger.attemptedAt,
        executed: state.lastAutoTrigger.executed,
        ...(state.lastAutoTrigger.runId ? { runId: state.lastAutoTrigger.runId } : {}),
        ...(state.lastAutoTrigger.status ? { status: state.lastAutoTrigger.status } : {}),
        ...(state.lastAutoTrigger.skipCode ? { skipCode: state.lastAutoTrigger.skipCode } : {}),
        ...(state.lastAutoTrigger.signalGateCode ? { signalGateCode: state.lastAutoTrigger.signalGateCode } : {}),
        ...(state.lastAutoTrigger.skipReason ? { skipReason: state.lastAutoTrigger.skipReason } : {}),
        ...(state.lastAutoTrigger.signal ? { signal: { ...state.lastAutoTrigger.signal } } : {}),
        ...(state.cooldownUntil ? { cooldownUntil: state.cooldownUntil } : {}),
        ...(state.failureBackoffUntil ? { failureBackoffUntil: state.failureBackoffUntil } : {}),
      }
    : null;
  const headline = !availability.enabled
    ? `Dream runtime is blocked: ${availability.reason ?? "unknown reason"}.`
    : latestRun?.status === "failed"
      ? `Latest dream failed at ${latestRun.finishedAt ?? latestRun.requestedAt ?? "-"}.`
      : latestRun?.generationMode === "fallback"
        ? `Latest dream completed in fallback mode at ${latestRun.finishedAt ?? latestRun.requestedAt ?? "-"}.`
        : !availability.available
          ? `Dream runtime has no active LLM route; fallback mode remains available.`
      : latestRun
        ? `Latest dream ${latestRun.status} at ${latestRun.finishedAt ?? latestRun.requestedAt ?? "-"}.`
        : "Dream runtime is ready and has no runs yet.";

  return {
    requested: {
      agentId,
      defaultConversationId: defaultConversationId ?? null,
    },
    availability,
    state,
    latestRun,
    autoSummary,
    headline,
  };
}

async function buildDreamCommonsDoctorReport(
  ctx: Pick<SystemDoctorMethodContext, "resolveCommonsExportRuntime">,
) {
  if (typeof ctx.resolveCommonsExportRuntime !== "function") {
    return undefined;
  }
  const runtime = ctx.resolveCommonsExportRuntime();
  if (!runtime) {
    return {
      availability: {
        enabled: false,
        available: false,
        reason: "commons export runtime unavailable",
      },
      state: null,
      headline: "Commons export runtime is unavailable.",
    };
  }
  const availability = runtime.getAvailability();
  const state = await runtime.getState();
  const headline = !availability.available
    ? `Commons export is blocked: ${availability.reason ?? "unknown reason"}.`
    : state.status === "failed"
      ? `Commons export failed at ${state.lastFailureAt ?? state.updatedAt}.`
      : state.lastSuccessAt
        ? `Commons export last completed at ${state.lastSuccessAt}.`
        : "Commons export is ready and has no runs yet.";
  return {
    availability,
    state,
    headline,
  };
}

export async function handleSystemDoctorMethod(
  req: GatewayReqFrame,
  ctx: SystemDoctorMethodContext,
): Promise<GatewayResFrame | null> {
  if (req.method !== "system.doctor") return null;
  const params = isObjectRecord(req.params) ? req.params : {};
  const doctorSurface = normalizeDoctorSurface(params.surface);
  const summaryOnly = doctorSurface === "summary";
  const forceRefresh = params.forceRefresh === true;
  const doctorRequestCacheable = !forceRefresh && isCacheableDoctorRequest(params);
  const doctorCacheKey = doctorRequestCacheable
    ? buildDoctorCacheKey(params, doctorSurface, ctx)
    : undefined;
  if (doctorRequestCacheable && doctorCacheKey) {
    const cached = readCachedDoctorResponse(doctorCacheKey, req.id);
    if (cached) {
      return cached;
    }
    const inFlight = doctorResponseInflight.get(doctorCacheKey);
    if (inFlight) {
      return cloneDoctorResponse(await inFlight, req.id);
    }
  }

  const responsePromise = (async (): Promise<GatewayResFrame> => {
    const doctorRequestStartedAt = performance.now();
    const doctorPerformanceStages: DoctorPerformanceStage[] = [];
    const doctorStartedAtIso = new Date().toISOString();

  const conversationId = typeof params.conversationId === "string" ? params.conversationId.trim() : "";
  const includeTranscript = params.includeTranscript === true;
  const includeTimeline = params.includeTimeline === true;
  const timelinePreviewChars = typeof params.timelinePreviewChars === "number" && Number.isFinite(params.timelinePreviewChars)
    ? Math.max(24, Math.floor(params.timelinePreviewChars))
    : undefined;
  const transcriptEventTypes = normalizeTranscriptEventTypes(Array.isArray(params.transcriptEventTypes)
    ? params.transcriptEventTypes.filter((value): value is string => typeof value === "string")
    : undefined);
  const transcriptEventLimit = parsePositiveInteger(typeof params.transcriptEventLimit === "number" ? params.transcriptEventLimit : undefined);
  const transcriptRestoreView = normalizeTranscriptRestoreView(typeof params.transcriptRestoreView === "string"
    ? params.transcriptRestoreView.trim()
    : undefined);
  const timelineKinds = normalizeTimelineKinds(Array.isArray(params.timelineKinds)
    ? params.timelineKinds.filter((value): value is string => typeof value === "string")
    : undefined);
  const timelineLimit = parsePositiveInteger(typeof params.timelineLimit === "number" ? params.timelineLimit : undefined);
  const includeConversationCatalog = params.includeConversationCatalog === true;
  const includeRecentExports = params.includeRecentExports === true;
  const conversationIdPrefix = normalizeConversationIdPrefix(typeof params.conversationIdPrefix === "string"
    ? params.conversationIdPrefix
    : undefined);
  const conversationListLimit = parsePositiveInteger(typeof params.conversationListLimit === "number" ? params.conversationListLimit : undefined);
  const recentExportLimit = parsePositiveInteger(typeof params.recentExportLimit === "number" ? params.recentExportLimit : undefined);
  type MCPDoctorDiagnostics = NonNullable<Awaited<ReturnType<typeof import("../mcp/index.js")["getMCPDiagnostics"]>>> & {
    loadError?: string;
  };
  const checks: any[] = [
    { id: "node", name: "Node.js Environment", status: "pass", message: process.version },
    { id: "memory_db", name: "Vector Database", status: "pass", message: "OK" },
  ];

  const baselineResult = await captureDoctorStage(doctorPerformanceStages, "baseline", async () => {
    const dbPath = path.join(ctx.stateDir, "memory.sqlite");
    const stat = await statIfExists(dbPath);
    if (stat?.isFile()) {
      checks[1].message = `Size: ${(stat.size / 1024).toFixed(1)} KB`;
    } else {
      checks[1].status = "warn";
      checks[1].message = "Not created yet";
    }

    try {
      ctx.agentFactory();
      checks.push({ id: "agent_config", name: "Agent Configuration", status: "pass", message: "Valid" });
    } catch {
      checks.push({ id: "agent_config", name: "Agent Configuration", status: "fail", message: "Missing API Keys" });
    }

    const configSource = buildConfigSourceDoctorReport(ctx);
    checks.push({
      id: "config_source",
      name: "Config Source",
      status: "pass",
      message: configSource.headline,
    });

    const channelSecurity = buildChannelSecurityDoctorReport({
      stateDir: ctx.stateDir,
      channels: {
        discord: {
          enabled:
            String(process.env.BELLDANDY_DISCORD_ENABLED ?? "false").trim().toLowerCase() === "true"
            && Boolean(String(process.env.BELLDANDY_DISCORD_BOT_TOKEN ?? "").trim()),
        },
        feishu: {
          enabled:
            Boolean(String(process.env.BELLDANDY_FEISHU_APP_ID ?? "").trim())
            && Boolean(String(process.env.BELLDANDY_FEISHU_APP_SECRET ?? "").trim()),
        },
        qq: {
          enabled:
            Boolean(String(process.env.BELLDANDY_QQ_APP_ID ?? "").trim())
            && Boolean(String(process.env.BELLDANDY_QQ_APP_SECRET ?? "").trim()),
        },
        community: (() => {
          const communityConfigPath = path.join(ctx.stateDir, "community.json");
          try {
            if (!fs.existsSync(communityConfigPath)) {
              return { enabled: false };
            }
            const parsed = JSON.parse(fs.readFileSync(communityConfigPath, "utf-8")) as {
              endpoint?: unknown;
              agents?: Array<{ name?: unknown }>;
            };
            const accountIds = Array.isArray(parsed.agents)
              ? parsed.agents
                .map((item) => (typeof item?.name === "string" ? item.name.trim() : ""))
                .filter(Boolean)
              : [];
            return {
              enabled: Boolean(accountIds.length) && typeof parsed.endpoint === "string" && Boolean(parsed.endpoint.trim()),
              ...(accountIds.length ? { accountIds } : {}),
            };
          } catch {
            return { enabled: false };
          }
        })(),
      },
    });
    for (const item of channelSecurity.items) {
      checks.push({
        id: `channel_security_${item.channel}`,
        name: `Channel Security (${item.channel})`,
        status: item.status,
        message: item.message,
      });
    }

    return {
      configSource,
      channelSecurity,
    };
  });
  const { configSource, channelSecurity } = unwrapDoctorStageResult(baselineResult);

  const memoryRuntimeStage = captureDoctorStage(doctorPerformanceStages, "memory_runtime", () => buildMemoryRuntimeDoctorReport({
    conversationStore: ctx.conversationStore,
    compactionRuntimeReport: ctx.getCompactionRuntimeReport?.(),
    durableExtractionRuntime: ctx.durableExtractionRuntime,
    stateDir: ctx.stateDir,
    teamSharedMemoryEnabled: process.env.BELLDANDY_TEAM_SHARED_MEMORY_ENABLED === "true",
    sessionDigestRateLimit: ctx.memoryBudgetGuard.getSessionDigestRateLimitState(),
    durableExtractionRequestRateLimit: ctx.durableExtractionRequestRateLimiter.getState(
      DURABLE_EXTRACTION_REQUEST_RATE_LIMIT_REASON_CODE,
      DURABLE_EXTRACTION_REQUEST_RATE_LIMIT_REASON_MESSAGE,
    ),
    durableExtractionRunRateLimit: ctx.memoryBudgetGuard.getDurableExtractionRunRateLimitState(),
  }));
  const memoryTreeJobsStage = captureDoctorStage(doctorPerformanceStages, "memory_tree_jobs", () => {
    const manager = resolveScopedMemoryManager(params);
    return manager?.getMemoryTreeJobReport({
      kinds: ["topic", "profile", "global"],
    });
  });
  const memorySourceInventoryStage = captureDoctorStage(doctorPerformanceStages, "memory_source_inventory", async () => {
    const manager = resolveScopedMemoryManager(params);
    if (!manager) {
      return undefined;
    }
    const configuredSources = await readConfiguredMemorySourcesForDoctor(ctx.stateDir);
    const report = await manager.previewSourceInventory({
      configuredSources,
    });
    return buildMemorySourceInventoryDoctorReport(report);
  });
  const memorySharedGovernanceStage = captureDoctorStage(doctorPerformanceStages, "memory_shared_governance", async () => {
    const manager = resolveScopedMemoryManager(params);
    if (!manager) {
      return undefined;
    }
    const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
    const configuredSources = await readConfiguredMemorySourcesForDoctor(ctx.stateDir);
    const preview = await buildResidentSharedGovernancePreview({
      stateDir: ctx.stateDir,
      manager,
      residentPolicy,
      residentRecords: ctx.residentMemoryManagers,
      agentRegistry: ctx.agentRegistry,
      reviewerAgentId: extractReviewerMemoryAgentId(params) ?? residentPolicy?.agentId ?? "default",
      configuredSources,
      teamSharedMemoryEnabled: process.env.BELLDANDY_TEAM_SHARED_MEMORY_ENABLED === "true",
    });
    const latestReport = manager.listMemoryTreeReports(1, {
      reportType: "shared_governance_preview",
      ...(residentPolicy?.agentId ? { agentId: residentPolicy.agentId } : {}),
    })[0] ?? null;
    return buildResidentSharedGovernanceDoctorReport({
      preview: preview.report,
      latestReport,
    });
  });
  const memoryTreeLifecycleStage = captureDoctorStage(doctorPerformanceStages, "memory_tree_lifecycle", () => {
    const manager = resolveScopedMemoryManager(params);
    return manager?.getMemoryTreeLifecycleReport({
      kinds: ["topic", "profile", "global"],
    });
  });
  const optionalCapabilitiesStage = captureDoctorStage(doctorPerformanceStages, "optional_capabilities", () => buildOptionalCapabilitiesDoctorReport());
  const cameraRuntimeStage = captureDoctorStage(doctorPerformanceStages, "camera_runtime", () => buildCameraRuntimeDoctorReport({
    context: {
      conversationId: "system.doctor",
      workspaceRoot: process.cwd(),
      stateDir: ctx.stateDir,
    },
  }));
  const extensionMarketplaceStage = captureDoctorStage(doctorPerformanceStages, "extension_marketplace", async () => {
    try {
      return {
        ...(await loadExtensionMarketplaceState(ctx.stateDir)),
        loadError: undefined as string | undefined,
      };
    } catch (error) {
      return {
        knownMarketplaces: {
          version: 1 as const,
          marketplaces: {},
          updatedAt: new Date(0).toISOString(),
        },
        installedExtensions: {
          version: 1 as const,
          extensions: {},
          updatedAt: new Date(0).toISOString(),
        },
        summary: {
          knownMarketplaceCount: 0,
          autoUpdateMarketplaceCount: 0,
          installedExtensionCount: 0,
          installedPluginCount: 0,
          installedSkillPackCount: 0,
          pendingExtensionCount: 0,
          brokenExtensionCount: 0,
          disabledExtensionCount: 0,
        },
        loadError: error instanceof Error ? error.message : String(error),
      };
    }
  });
  const dreamRuntimeStage = captureDoctorStage(doctorPerformanceStages, "dream_runtime", () => buildDreamRuntimeDoctorReport(ctx, params));
  const dreamCommonsStage = captureDoctorStage(doctorPerformanceStages, "dream_commons", () => buildDreamCommonsDoctorReport(ctx));
  const cronRuntimeStage = captureDoctorStage(doctorPerformanceStages, "cron_runtime", async () => ctx.getCronRuntimeDoctorReport?.());
  const backgroundContinuationRuntimeStage = captureDoctorStage(
    doctorPerformanceStages,
    "background_continuation_runtime",
    async () => ctx.getBackgroundContinuationRuntimeDoctorReport?.(),
  );
  const externalOutboundRuntimeStage = captureDoctorStage(doctorPerformanceStages, "external_outbound_runtime", async () => {
    if (!ctx.externalOutboundAuditStore) {
      return undefined;
    }
    return buildExternalOutboundDoctorReport({
      auditStore: ctx.externalOutboundAuditStore,
      confirmationStore: ctx.externalOutboundConfirmationStore,
      requireConfirmation: String(process.env.BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION ?? "true").trim().toLowerCase() !== "false",
    });
  });
  const emailOutboundRuntimeStage = captureDoctorStage(doctorPerformanceStages, "email_outbound_runtime", async () => {
    if (!ctx.emailOutboundAuditStore) {
      return undefined;
    }
    return buildEmailOutboundDoctorReport({
      auditStore: ctx.emailOutboundAuditStore,
      requireConfirmation: String(process.env.BELLDANDY_EMAIL_OUTBOUND_REQUIRE_CONFIRMATION ?? "true").trim().toLowerCase() !== "false",
    });
  });
  const emailInboundRuntimeStage = captureDoctorStage(doctorPerformanceStages, "email_inbound_runtime", async () => {
    if (!ctx.emailInboundAuditStore) {
      return undefined;
    }
    return buildEmailInboundDoctorReport({
      auditStore: ctx.emailInboundAuditStore,
      enabled: String(process.env.BELLDANDY_EMAIL_IMAP_ENABLED ?? "false").trim().toLowerCase() === "true",
      host: process.env.BELLDANDY_EMAIL_IMAP_HOST,
      username: process.env.BELLDANDY_EMAIL_IMAP_USER,
      password: process.env.BELLDANDY_EMAIL_IMAP_PASS,
      accountId: process.env.BELLDANDY_EMAIL_IMAP_ACCOUNT_ID,
      mailbox: process.env.BELLDANDY_EMAIL_IMAP_MAILBOX,
      requestedAgentId: process.env.BELLDANDY_EMAIL_INBOUND_AGENT_ID,
      port: Number(process.env.BELLDANDY_EMAIL_IMAP_PORT ?? "993"),
      secure: String(process.env.BELLDANDY_EMAIL_IMAP_SECURE ?? "true").trim().toLowerCase() !== "false",
      pollIntervalMs: Number(process.env.BELLDANDY_EMAIL_IMAP_POLL_INTERVAL_MS ?? "60000"),
      connectTimeoutMs: Number(process.env.BELLDANDY_EMAIL_IMAP_CONNECT_TIMEOUT_MS ?? "10000"),
      socketTimeoutMs: Number(process.env.BELLDANDY_EMAIL_IMAP_SOCKET_TIMEOUT_MS ?? "20000"),
      bootstrapMode: String(process.env.BELLDANDY_EMAIL_IMAP_BOOTSTRAP_MODE ?? "latest").trim().toLowerCase() === "all"
        ? "all"
        : "latest",
      recentWindowLimit: Number(process.env.BELLDANDY_EMAIL_IMAP_RECENT_WINDOW_LIMIT ?? "0"),
    });
  });
  const mcpRuntimeStage = captureDoctorStage(doctorPerformanceStages, "mcp_runtime", async () => {
    const enabled = (process.env.BELLDANDY_MCP_ENABLED ?? "false") === "true";
    if (!enabled) {
      return { enabled, diagnostics: null as MCPDoctorDiagnostics | null };
    }
    try {
      const mcpModule = await import("../mcp/index.js");
      return {
        enabled,
        diagnostics: mcpModule.getMCPDiagnostics() as MCPDoctorDiagnostics | null,
      };
    } catch (error) {
      return {
        enabled,
        diagnostics: {
          initialized: false,
          toolCount: 0,
          serverCount: 0,
          connectedCount: 0,
          summary: {
            recentErrorServers: 0,
            recoveryAttemptedServers: 0,
            recoverySucceededServers: 0,
            persistedResultServers: 0,
            truncatedResultServers: 0,
          },
          servers: [],
          loadError: error instanceof Error ? error.message : String(error),
        } satisfies MCPDoctorDiagnostics,
      };
    }
  });

  const overviewSyncResult = await captureDoctorStage(doctorPerformanceStages, "overview_sync", async () => {
    // Hook 指标会在运行期持续变化；有 live Registry 时不能复用启动时的 Host 快照。
    const extensionRuntimeBase = (ctx.pluginRegistry || ctx.skillRegistry)
      ? buildExtensionRuntimeReport({
        pluginRegistry: ctx.pluginRegistry,
        skillRegistry: ctx.skillRegistry,
        toolsConfigManager: ctx.toolsConfigManager,
      })
      : (ctx.extensionHost?.extensionRuntime ?? buildExtensionRuntimeReport({
        pluginRegistry: ctx.pluginRegistry,
        skillRegistry: ctx.skillRegistry,
        toolsConfigManager: ctx.toolsConfigManager,
      }));
    const deploymentBackends = buildDeploymentBackendsDoctorReport({
      stateDir: ctx.stateDir,
    });
    const runtimeResilience = ctx.getRuntimeResilienceReport?.();
    const runtimeResilienceDiagnostics = runtimeResilience
      ? buildRuntimeResilienceDiagnosticSummary(runtimeResilience)
      : undefined;
    const extensionRuntime = ctx.extensionHost
      ? {
        ...extensionRuntimeBase,
        host: {
          lifecycle: ctx.extensionHost.lifecycle,
        },
      }
      : extensionRuntimeBase;
    const queryRuntime = ctx.queryRuntimeTraceStore.getSummary();
    const runtimeResources = ctx.runtimeResourceObservability.getSummary();
    return {
      extensionRuntimeBase,
      deploymentBackends,
      runtimeResilience,
      runtimeResilienceDiagnostics,
      extensionRuntime,
      queryRuntime,
      runtimeResources,
    };
  });
  const {
    extensionRuntimeBase,
    deploymentBackends,
    runtimeResilience,
    runtimeResilienceDiagnostics,
    extensionRuntime,
    queryRuntime,
    runtimeResources,
  } = unwrapDoctorStageResult(overviewSyncResult);

  const [
    memoryRuntimeResult,
    memoryTreeJobsResult,
    memorySourceInventoryResult,
    memorySharedGovernanceResult,
    memoryTreeLifecycleResult,
    optionalCapabilitiesResult,
    cameraRuntimeResult,
    extensionMarketplaceResult,
    dreamRuntimeResult,
    dreamCommonsResult,
    cronRuntimeResult,
    backgroundContinuationRuntimeResult,
    externalOutboundRuntimeResult,
    emailOutboundRuntimeResult,
    emailInboundRuntimeResult,
    mcpRuntimeResult,
  ] = await Promise.all([
    memoryRuntimeStage,
    memoryTreeJobsStage,
    memorySourceInventoryStage,
    memorySharedGovernanceStage,
    memoryTreeLifecycleStage,
    optionalCapabilitiesStage,
    cameraRuntimeStage,
    extensionMarketplaceStage,
    dreamRuntimeStage,
    dreamCommonsStage,
    cronRuntimeStage,
    backgroundContinuationRuntimeStage,
    externalOutboundRuntimeStage,
    emailOutboundRuntimeStage,
    emailInboundRuntimeStage,
    mcpRuntimeStage,
  ]);

  const memoryRuntime = unwrapDoctorStageResult(memoryRuntimeResult);
  const memoryTreeJobs = unwrapDoctorStageResult(memoryTreeJobsResult);
  const memorySourceInventory = unwrapDoctorStageResult(memorySourceInventoryResult);
  const memorySharedGovernance = unwrapDoctorStageResult(memorySharedGovernanceResult);
  const memoryTreeLifecycle = unwrapDoctorStageResult(memoryTreeLifecycleResult);
  const optionalCapabilities = unwrapDoctorStageResult(optionalCapabilitiesResult);
  const cameraRuntime = unwrapDoctorStageResult(cameraRuntimeResult);
  const extensionMarketplace = unwrapDoctorStageResult(extensionMarketplaceResult);
  const dreamRuntime = unwrapDoctorStageResult(dreamRuntimeResult);
  const dreamCommons = unwrapDoctorStageResult(dreamCommonsResult);

  let cronRuntime: CronRuntimeDoctorReport | undefined;
  let backgroundContinuationRuntime: BackgroundContinuationRuntimeDoctorReport | undefined;
  let externalOutboundRuntime: ExternalOutboundDoctorReport | undefined;
  let emailOutboundRuntime: EmailOutboundDoctorReport | undefined;
  let emailInboundRuntime: EmailInboundDoctorReport | undefined;
  let assistantModeRuntime: AssistantModeRuntimeReport | undefined;
  let goalRuntimeSummary: Awaited<ReturnType<typeof buildAssistantModeGoalRuntimeSummary>> | undefined;

  if (cronRuntimeResult.ok) {
    cronRuntime = cronRuntimeResult.value;
  } else {
    pushDoctorWarnCheck(checks, "cron_runtime", "Cron Runtime", cronRuntimeResult.error);
  }
  if (backgroundContinuationRuntimeResult.ok) {
    backgroundContinuationRuntime = backgroundContinuationRuntimeResult.value;
  } else {
    pushDoctorWarnCheck(checks, "background_continuation_runtime", "Background Continuation Runtime", backgroundContinuationRuntimeResult.error);
  }
  if (externalOutboundRuntimeResult.ok) {
    externalOutboundRuntime = externalOutboundRuntimeResult.value;
  } else {
    pushDoctorWarnCheck(checks, "external_outbound_runtime", "External Outbound Runtime", externalOutboundRuntimeResult.error);
  }
  if (emailOutboundRuntimeResult.ok) {
    emailOutboundRuntime = emailOutboundRuntimeResult.value;
  } else {
    pushDoctorWarnCheck(checks, "email_outbound_runtime", "Email Outbound Runtime", emailOutboundRuntimeResult.error);
  }
  if (emailInboundRuntimeResult.ok) {
    emailInboundRuntime = emailInboundRuntimeResult.value;
  } else {
    pushDoctorWarnCheck(checks, "email_inbound_runtime", "Email Inbound Runtime", emailInboundRuntimeResult.error);
  }

  const extensionGovernance = buildExtensionGovernanceReport({
    extensionRuntime: extensionRuntimeBase,
    extensionMarketplace: extensionMarketplace.loadError ? undefined : extensionMarketplace,
    extensionHostLifecycle: ctx.extensionHost?.lifecycle,
    loadError: extensionMarketplace.loadError,
  });
  const mcpRuntime = unwrapDoctorStageResult(mcpRuntimeResult);
  const mcpRouting = await readMcpRoutingDoctorReport(ctx.stateDir);

  checks.push({
    id: "session_digest_runtime",
    name: "Session Digest Runtime",
    status: memoryRuntime.sessionDigest.rateLimit.status === "limited" ? "warn" : "pass",
    message: memoryRuntime.sessionDigest.rateLimit.status === "limited"
      ? `Available, but rate limited: ${formatRateLimitState(memoryRuntime.sessionDigest.rateLimit)}`
      : `Available (${formatRateLimitState(memoryRuntime.sessionDigest.rateLimit)})`,
  });
  const compactionRuntime = memoryRuntime.compactionRuntime;
  if (compactionRuntime) {
    checks.push({
      id: "compaction_runtime",
      name: "Compaction Runtime",
      status: compactionRuntime.circuitBreaker.open || compactionRuntime.totals.failures > 0
        ? "warn"
        : "pass",
      message: compactionRuntime.circuitBreaker.open
        ? `Circuit open (${compactionRuntime.circuitBreaker.remainingSkips} skips remaining), failures=${compactionRuntime.totals.failures}, PTL retries=${compactionRuntime.totals.promptTooLongRetries}`
        : `attempts=${compactionRuntime.totals.attempts}, warnings=${compactionRuntime.totals.warningHits}, blocking=${compactionRuntime.totals.blockingHits}, PTL retries=${compactionRuntime.totals.promptTooLongRetries}`,
    });
  }

  const durableAvailability = memoryRuntime.durableExtraction.availability;
  const durableRunRateLimit = memoryRuntime.durableExtraction.rateLimit.run;
  checks.push({
    id: "durable_extraction_runtime",
    name: "Durable Extraction Runtime",
    status: !durableAvailability.available
      ? durableAvailability.enabled ? "fail" : "warn"
      : durableRunRateLimit.status === "limited" ? "warn" : "pass",
    message: !durableAvailability.available
      ? durableAvailability.reasonMessages.join(" ") || "Unavailable"
      : durableRunRateLimit.status === "limited"
        ? `Available, but run rate limited: ${formatRateLimitState(durableRunRateLimit)}`
        : `Available (${formatRateLimitState(durableRunRateLimit)})`,
  });
  if (memoryRuntime.durableExtraction.guidance) {
    checks.push({
      id: "durable_extraction_policy",
      name: "Durable Extraction Policy",
      status: "pass",
      message: `${memoryRuntime.durableExtraction.guidance.policyVersion}: ${memoryRuntime.durableExtraction.guidance.summary}`,
    });
  }
  checks.push({
    id: "team_shared_memory",
    name: "Team Shared Memory",
    status: memoryRuntime.sharedMemory.enabled ? "pass" : "warn",
    message: memoryRuntime.sharedMemory.enabled
      ? `enabled at ${memoryRuntime.sharedMemory.scope.relativeRoot} (${memoryRuntime.sharedMemory.scope.fileCount} files), secret guard ready, sync plan ${memoryRuntime.sharedMemory.syncPolicy.status}`
      : `disabled by default, path ${memoryRuntime.sharedMemory.scope.relativeRoot}, secret guard ready, sync plan ${memoryRuntime.sharedMemory.syncPolicy.status}`,
  });
  if (memoryTreeJobs) {
    checks.push(...memoryTreeJobs.checks);
  } else {
    checks.push({
      id: "memory_tree_jobs",
      name: "Memory Tree Jobs",
      status: "warn",
      message: "Memory manager unavailable.",
    });
  }
  if (memorySourceInventory) {
    checks.push(...memorySourceInventory.checks);
  } else {
    checks.push({
      id: "memory_source_inventory",
      name: "Memory Source Inventory",
      status: "warn",
      message: "Memory manager unavailable.",
    });
  }
  if (memorySharedGovernance) {
    checks.push(...memorySharedGovernance.checks);
  } else {
    checks.push({
      id: "memory_shared_governance",
      name: "Memory Shared Governance",
      status: "warn",
      message: "Memory manager unavailable.",
    });
  }
  if (memoryTreeLifecycle) {
    checks.push(...memoryTreeLifecycle.checks);
  } else {
    checks.push({
      id: "memory_tree_lifecycle",
      name: "Memory Tree Lifecycle",
      status: "warn",
      message: "Memory manager unavailable.",
    });
  }
  checks.push({
    id: "deployment_backends",
    name: "Deployment Backends",
    status: deploymentBackends.summary.warningCount > 0
      || deploymentBackends.summary.selectedResolved === false
      ? "warn"
      : "pass",
    message: deploymentBackends.headline,
  });
  checks.push({
    id: "optional_capabilities",
    name: "Optional Capabilities",
    status: optionalCapabilities.summary.warnCount > 0 ? "warn" : "pass",
    message: optionalCapabilities.summary.headline,
  });
  // ── 动态工作流 WorkflowRuntime 观测 ──
  if (ctx.workflowRuntime) {
    try {
      const activeRuns = ctx.workflowRuntime.listActiveRuns?.() ?? [];
      const runningCount = activeRuns.filter((r) => r.status === "running").length;
      const doneCount = activeRuns.filter((r) => r.status === "done").length;
      const errorCount = activeRuns.filter((r) => r.status === "error" || r.status === "budget_exceeded").length;
      checks.push({
        id: "workflow_runtime",
        name: "Workflow Runtime",
        status: errorCount > 0 ? "warn" : "pass",
        message: `Active runs: ${activeRuns.length} (running=${runningCount}, done=${doneCount}, error=${errorCount})`,
        details: { activeRuns },
      });
    } catch (err) {
      checks.push({
        id: "workflow_runtime",
        name: "Workflow Runtime",
        status: "warn",
        message: `Failed to read workflow runtime status: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  } else {
    checks.push({
      id: "workflow_runtime",
      name: "Workflow Runtime",
      status: "warn",
      message: "Workflow runtime not available (memory manager may be disabled).",
    });
  }
  if (cameraRuntime) {
    checks.push({
      id: "camera_runtime",
      name: "Camera Runtime",
      status: cameraRuntime.summary.errorCount > 0
        ? "warn"
        : cameraRuntime.summary.warningCount > 0
          ? "warn"
          : "pass",
      message: cameraRuntime.summary.headline,
    });
  }
  if (runtimeResilienceDiagnostics) {
    checks.push({
      id: "runtime_resilience",
      name: "Runtime Resilience",
      status: runtimeResilienceDiagnostics.alertLevel,
      message: `${runtimeResilienceDiagnostics.alertCode}: ${runtimeResilienceDiagnostics.alertMessage}`,
    });
  }
  if (runtimeResilience?.routing.compaction?.auxSummaryVerdict) {
    const verdict = runtimeResilience.routing.compaction.auxSummaryVerdict;
    checks.push({
      id: "runtime_resilience_compaction_aux_verdict",
      name: "Runtime Resilience Compaction Aux Verdict",
      status: verdict.enabled ? "pass" : "warn",
      message: `${verdict.strategy} / ${verdict.reason} / enabled=${verdict.enabled ? "yes" : "no"}`,
    });
  }
  checks.push({
    id: "query_runtime_trace",
    name: "Query Runtime Trace",
    status: "pass",
    message: `Enabled (${queryRuntime.activeTraceCount} active traces, ${queryRuntime.traces.length} retained, ${queryRuntime.totalObservedEvents} observed events)`,
  });
  checks.push({
    id: "runtime_resources",
    name: "Runtime Resources",
    status: runtimeResources.available ? "pass" : "warn",
    message: runtimeResources.headline,
  });
  if (cronRuntime) {
    checks.push({
      id: "cron_runtime",
      name: "Cron Runtime",
      status: !cronRuntime.scheduler.enabled
        ? cronRuntime.totals.totalJobs > 0 ? "warn" : "pass"
        : cronRuntime.scheduler.running && cronRuntime.totals.invalidNextRunJobs === 0
          ? "pass"
          : "warn",
      message: cronRuntime.headline,
    });
  }
  if (backgroundContinuationRuntime) {
    checks.push({
      id: "background_continuation_runtime",
      name: "Background Continuation Runtime",
      status: backgroundContinuationRuntime.totals.failedRuns > 0
        ? "warn"
        : "pass",
      message: backgroundContinuationRuntime.headline,
    });
  }
  if (externalOutboundRuntime) {
    checks.push({
      id: "external_outbound_runtime",
      name: "External Outbound Runtime",
      status: externalOutboundRuntime.health?.status ?? (
        externalOutboundRuntime.totals.failedCount > 0 || !externalOutboundRuntime.requireConfirmation
          ? "warn"
          : "pass"
      ),
      message: externalOutboundRuntime.headline,
    });
  }
  if (emailOutboundRuntime) {
    checks.push({
      id: "email_outbound_runtime",
      name: "Email Outbound Runtime",
      status: emailOutboundRuntime.totals.failedCount > 0 || !emailOutboundRuntime.requireConfirmation
        ? "warn"
        : "pass",
      message: emailOutboundRuntime.headline,
    });
  }
  if (emailInboundRuntime) {
    checks.push({
      id: "email_inbound_runtime",
      name: "Email Inbound Runtime",
      status: emailInboundRuntime.totals.failedCount > 0 || !emailInboundRuntime.setup.runtimeExpected
        ? "warn"
        : "pass",
      message: emailInboundRuntime.headline,
    });
  }
  const hookBridgeSummary = ctx.extensionHost?.lifecycle.hookBridge;
  const extensionHookMessage = hookBridgeSummary && hookBridgeSummary.availableHookCount > 0
    ? `, legacy hooks ${hookBridgeSummary.bridgedHookCount}/${hookBridgeSummary.availableHookCount} bridged`
    : "";
  checks.push({
    id: "extension_runtime",
    name: "Extension Runtime",
    status: extensionRuntime.summary.pluginLoadErrorCount > 0 ? "warn" : "pass",
    message: `plugins ${extensionRuntime.summary.pluginCount} (${extensionRuntime.summary.disabledPluginCount} disabled, ${extensionRuntime.summary.pluginLoadErrorCount} load errors), skills ${extensionRuntime.summary.skillCount} (${extensionRuntime.summary.disabledSkillCount} disabled, ${extensionRuntime.summary.ineligibleSkillCount} ineligible)${extensionHookMessage}`,
  });
  checks.push({
    id: "extension_marketplace",
    name: "Extension Marketplace",
    status: extensionMarketplace.loadError
      ? "warn"
      : extensionMarketplace.summary.brokenExtensionCount > 0
        ? "warn"
        : "pass",
    message: extensionMarketplace.loadError
      ? `Unavailable: ${extensionMarketplace.loadError}`
      : `marketplaces ${extensionMarketplace.summary.knownMarketplaceCount} (${extensionMarketplace.summary.autoUpdateMarketplaceCount} auto-update), installed ${extensionMarketplace.summary.installedExtensionCount} (${extensionMarketplace.summary.installedPluginCount} plugins, ${extensionMarketplace.summary.installedSkillPackCount} skill-packs, ${extensionMarketplace.summary.brokenExtensionCount} broken, ${extensionMarketplace.summary.disabledExtensionCount} disabled)`,
  });
  checks.push({
    id: "extension_governance",
    name: "Extension Governance",
    status: extensionGovernance.loadError
      ? "warn"
      : extensionGovernance.summary.installedBrokenExtensionCount > 0
        ? "warn"
        : extensionGovernance.layers.hostLoad.lifecycleAvailable
          && extensionGovernance.summary.loadedMarketplaceExtensionCount
            < extensionGovernance.summary.installedEnabledExtensionCount
          ? "warn"
          : "pass",
    message: extensionGovernance.loadError
      ? `Unavailable: ${extensionGovernance.loadError}`
      : `ledger enabled ${extensionGovernance.summary.installedEnabledExtensionCount}/${extensionGovernance.summary.installedExtensionCount}, host loaded ${extensionGovernance.summary.loadedMarketplaceExtensionCount} (${extensionGovernance.summary.loadedMarketplacePluginCount} plugins, ${extensionGovernance.summary.loadedMarketplaceSkillPackCount} skill-packs), runtime policy disabled ${extensionGovernance.summary.runtimePolicyDisabledPluginCount} plugins / ${extensionGovernance.summary.runtimePolicyDisabledSkillCount} skills`,
  });
  const mcpDiag = mcpRuntime.diagnostics;
  const mcpRecoverySummary = mcpDiag && mcpDiag.summary.recoveryAttemptedServers > 0
    ? `, recovery ${mcpDiag.summary.recoverySucceededServers}/${mcpDiag.summary.recoveryAttemptedServers}`
    : "";
  const mcpPersistedSummary = mcpDiag && mcpDiag.summary.persistedResultServers > 0
    ? `, persisted refs ${mcpDiag.summary.persistedResultServers}`
    : "";
  checks.push({
    id: "mcp_runtime",
    name: "MCP Runtime",
    status: !mcpRuntime.enabled
      ? "pass"
      : mcpDiag?.loadError
        ? "warn"
        : mcpDiag && mcpDiag.connectedCount > 0
          ? "pass"
          : "warn",
    message: !mcpRuntime.enabled
      ? "Disabled"
      : mcpDiag?.loadError
        ? `Unavailable: ${mcpDiag.loadError}`
        : mcpDiag
          ? `${mcpDiag.connectedCount}/${mcpDiag.serverCount} connected, ${mcpDiag.toolCount} tools${mcpRecoverySummary}${mcpPersistedSummary}`
      : "Unavailable",
  });
  checks.push({
    id: "starweaver_mcp_routing",
    name: "Starweaver MCP Routing",
    status: mcpRouting.parseError
      ? "warn"
      : mcpRouting.starweaver.status === "central_primary" || mcpRouting.starweaver.status === "not_configured"
        ? "pass"
        : "warn",
    message: mcpRouting.parseError
      ? `Unavailable: ${mcpRouting.parseError}`
      : mcpRouting.starweaver.headline,
  });

  let conversationDebug: Record<string, unknown> | undefined;
  let conversationCatalog: Record<string, unknown> | undefined;
  let recentConversationExports: Record<string, unknown> | undefined;
  let promptObservability: Record<string, unknown> | undefined;
  let toolBehaviorObservability: Record<string, unknown> | undefined;
  let toolContractV2Observability: Record<string, unknown> | undefined;
  let preflightCompressionGovernance: Awaited<ReturnType<typeof buildPreflightCompressionGovernanceReport>> | undefined;
  let residentAgents: any;
  let mindProfileSnapshot: any;
  let learningReviewInput: any;
  let learningReviewNudgeRuntime: any;
  let memoryClassConsumer: any;
  let memoryFreshness: any;
  let memoryEvaluation: MemoryEvaluationSummary | undefined;
  let skillFreshness: any;
  let delegationObservability: any;
  let bridgeRecoveryDiagnostics: any;

  if (!summaryOnly && conversationId) {
    const conversationSnapshot = ctx.conversationStore.get(conversationId);
    const transcriptExportRaw = includeTranscript
      ? await ctx.conversationStore.buildConversationTranscriptExport(conversationId, { mode: "internal" })
      : undefined;
    const timelineRaw = includeTimeline
      ? await ctx.conversationStore.buildConversationTimeline(conversationId, { previewChars: timelinePreviewChars })
      : undefined;
    const transcriptExport = transcriptExportRaw
      ? applyTranscriptExportProjection(transcriptExportRaw, {
        eventTypes: transcriptEventTypes,
        eventLimit: transcriptEventLimit,
        restoreView: transcriptRestoreView,
      })
      : undefined;
    const timeline = timelineRaw
      ? applyTimelineProjectionFilter(timelineRaw, {
        kinds: timelineKinds,
        limit: timelineLimit,
      })
      : undefined;
    const available = Boolean(conversationSnapshot)
      || hasTranscriptExportArtifacts(transcriptExport)
      || hasTimelineArtifacts(timeline);
    const messageCount = conversationSnapshot?.messages.length ?? transcriptExport?.restore.rawMessages.length ?? 0;
    const details: string[] = [];
    if (messageCount > 0) {
      details.push(`${messageCount} messages`);
    }
    if (includeTranscript && transcriptExport) {
      details.push(`transcript ${transcriptExport.summary.eventCount} events`);
    }
    if (includeTimeline && timeline) {
      details.push(`timeline ${timeline.summary.itemCount} items`);
    }
    if (details.length === 0) {
      details.push("metadata only");
    }

    checks.push({
      id: "conversation_debug",
      name: "Conversation Debug",
      status: available ? "pass" : "warn",
      message: available
        ? `${conversationId} available (${details.join(", ")})`
        : `${conversationId} not found or transcript data is empty`,
    });

    conversationDebug = {
      conversationId,
      available,
      messageCount,
      updatedAt: conversationSnapshot?.updatedAt,
      requested: {
        includeTranscript,
        includeTimeline,
        ...(transcriptEventTypes ? { transcriptEventTypes } : {}),
        ...(typeof transcriptEventLimit === "number" ? { transcriptEventLimit } : {}),
        ...(transcriptRestoreView ? { transcriptRestoreView } : {}),
        ...(timelineKinds ? { timelineKinds } : {}),
        ...(typeof timelineLimit === "number" ? { timelineLimit } : {}),
        ...(includeTimeline ? { timelinePreviewChars: timelinePreviewChars ?? 120 } : {}),
      },
      ...(includeTranscript ? { transcriptExport } : {}),
      ...(includeTimeline ? { timeline } : {}),
    };
  }
  if (!summaryOnly && includeConversationCatalog) {
    const items = await ctx.conversationStore.listPersistedConversations({
      conversationIdPrefix,
      limit: conversationListLimit,
    });
    checks.push({
      id: "conversation_catalog",
      name: "Conversation Catalog",
      status: "pass",
      message: `${items.length} exportable conversations${conversationIdPrefix ? ` for prefix ${conversationIdPrefix}` : ""}`,
    });
    conversationCatalog = {
      items,
      filter: {
        ...(conversationIdPrefix ? { conversationIdPrefix } : {}),
        ...(typeof conversationListLimit === "number" ? { limit: conversationListLimit } : {}),
      },
    };
  }
  if (!summaryOnly && includeRecentExports) {
    const items = await listRecentConversationExports({
      stateDir: ctx.stateDir,
      conversationIdPrefix,
      limit: recentExportLimit,
    });
    checks.push({
      id: "conversation_export_index",
      name: "Conversation Export Index",
      status: "pass",
      message: `${items.length} recent export records${conversationIdPrefix ? ` for prefix ${conversationIdPrefix}` : ""}`,
    });
    recentConversationExports = {
      items,
      filter: {
        ...(conversationIdPrefix ? { conversationIdPrefix } : {}),
        ...(typeof recentExportLimit === "number" ? { limit: recentExportLimit } : {}),
      },
    };
  }

  if (!summaryOnly && ctx.inspectAgentPrompt) {
    const promptAgentId = typeof params.promptAgentId === "string" && params.promptAgentId.trim()
      ? params.promptAgentId.trim()
      : undefined;
    const promptConversationId = typeof params.promptConversationId === "string" && params.promptConversationId.trim()
      ? params.promptConversationId.trim()
      : undefined;
    const promptRunId = typeof params.promptRunId === "string" && params.promptRunId.trim()
      ? params.promptRunId.trim()
      : undefined;
    try {
      const inspection = await ctx.inspectAgentPrompt({
        agentId: promptAgentId,
        conversationId: promptConversationId,
        runId: promptRunId,
      });
      const residentStateBinding = resolveResidentStateBindingViewForAgent(
        ctx.stateDir,
        ctx.agentRegistry,
        promptAgentId ?? inspection.agentId,
      );
      const launchExplainability = buildAgentLaunchExplainability({
        agentRegistry: ctx.agentRegistry,
        agentId: promptAgentId ?? inspection.agentId,
        runtimeResilience,
      });
      const summary = buildPromptObservabilitySummary(inspection);
      const summaryView = toPromptObservabilityView(summary, {
        truncated: inspection.truncated,
        includesHookSystemPrompt: inspection.metadata?.includesHookSystemPrompt === true,
        hasPrependContext: inspection.metadata?.hasPrependContext === true,
      });
      checks.push({
        id: "prompt_observability",
        name: "Prompt Observability",
        status: "pass",
        message: formatPromptObservabilityHeadline(summaryView),
      });
      promptObservability = {
        requested: {
          ...(promptAgentId ? { agentId: promptAgentId } : {}),
          ...(promptConversationId ? { conversationId: promptConversationId } : {}),
          ...(promptRunId ? { runId: promptRunId } : {}),
        },
        summary,
        ...(residentStateBinding ? { residentStateBinding } : {}),
        ...(launchExplainability ? { launchExplainability } : {}),
      };
    } catch (error) {
      checks.push({
        id: "prompt_observability",
        name: "Prompt Observability",
        status: "warn",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const preflightCompressionStage = await captureDoctorStage(
    doctorPerformanceStages,
    "preflight_compression_governance",
    async () => buildPreflightCompressionGovernanceReport({ stateDir: ctx.stateDir }),
  );
  preflightCompressionGovernance = unwrapDoctorStageResult(preflightCompressionStage);
  checks.push(...preflightCompressionGovernance.checks);

  if (!summaryOnly && ctx.agentRegistry && (ctx.residentMemoryManagers?.length ?? 0) > 0) {
    const roster = await buildAgentRoster({
      stateDir: ctx.stateDir,
      agentRegistry: ctx.agentRegistry,
      residentAgentRuntime: ctx.residentAgentRuntime,
    });
    residentAgents = await buildResidentAgentObservabilitySnapshot({
      agents: roster,
      residentMemoryManagers: ctx.residentMemoryManagers,
      conversationStore: ctx.conversationStore,
      subTaskRuntimeStore: ctx.subTaskRuntimeStore,
    });
    checks.push({
      id: "resident_agents",
      name: "Resident Agents",
      status: residentAgents.summary.totalCount > 0 ? "pass" : "warn",
      message: residentAgents.summary.headline,
    });
    mindProfileSnapshot = await buildMindProfileSnapshot({
      stateDir: ctx.stateDir,
      residentAgents,
      residentMemoryManagers: ctx.residentMemoryManagers,
      agentId: typeof params.mindAgentId === "string" && params.mindAgentId.trim()
        ? params.mindAgentId.trim()
        : undefined,
    });
    checks.push({
      id: "mind_profile_snapshot",
      name: "Mind / Profile Snapshot",
      status: mindProfileSnapshot.summary.available ? "pass" : "warn",
      message: mindProfileSnapshot.summary.headline,
    });
    learningReviewInput = buildLearningReviewInput({
      mindProfileSnapshot,
    });
  learningReviewNudgeRuntime = await buildLearningReviewNudgeRuntimeReport({
      stateDir: ctx.stateDir,
    });
    checks.push({
      id: "learning_review_input",
      name: "Learning / Review Input",
      status: learningReviewInput.summary.available || learningReviewNudgeRuntime.summary.available ? "pass" : "warn",
      message: learningReviewNudgeRuntime.summary.available
        ? learningReviewNudgeRuntime.summary.headline
        : learningReviewInput.summary.headline,
    });
  }

  if (!summaryOnly) {
    const assistantModeStage = await captureDoctorStage(doctorPerformanceStages, "assistant_mode_runtime", async () => {
      let resolvedDelegationObservability: typeof delegationObservability;
      if (ctx.subTaskRuntimeStore) {
        const subtaskItems = await ctx.subTaskRuntimeStore.listTasks(undefined, { includeArchived: true });
        resolvedDelegationObservability = buildDelegationObservabilitySnapshot(subtaskItems);
      }
      const resolvedGoalRuntimeSummary = await buildAssistantModeGoalRuntimeSummary({
        goalReader: ctx.goalManager,
      });
      const resolvedAssistantModeRuntime = buildAssistantModeRuntimeReport({
        assistantModeEnabled: (() => {
          const raw = process.env.BELLDANDY_ASSISTANT_MODE_ENABLED;
          if (typeof raw !== "string" || !raw.trim()) return undefined;
          return raw.trim().toLowerCase() === "true";
        })(),
        assistantModeConfigured: typeof process.env.BELLDANDY_ASSISTANT_MODE_ENABLED === "string"
          && Boolean(process.env.BELLDANDY_ASSISTANT_MODE_ENABLED.trim()),
        heartbeatEnabled: String(process.env.BELLDANDY_HEARTBEAT_ENABLED ?? "false").trim().toLowerCase() === "true",
        heartbeatInterval: process.env.BELLDANDY_HEARTBEAT_INTERVAL,
        heartbeatActiveHours: process.env.BELLDANDY_HEARTBEAT_ACTIVE_HOURS,
        cronEnabled: String(process.env.BELLDANDY_CRON_ENABLED ?? "false").trim().toLowerCase() === "true",
        cronRuntime,
        backgroundContinuationRuntime,
        externalOutboundRuntime,
        residentAgents,
        delegationObservability: resolvedDelegationObservability,
        goals: resolvedGoalRuntimeSummary,
        externalOutboundRequireConfirmation: String(process.env.BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION ?? "true").trim().toLowerCase() !== "false",
        externalDeliveryPreference: parseAssistantExternalDeliveryPreference(
          process.env.BELLDANDY_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE
            ?? DEFAULT_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE,
        ),
        starweaverActiveNotifyEnabled:
          String(process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_ENABLED ?? "false").trim().toLowerCase() === "true",
        starweaverActiveNotifyPollIntervalMs:
          Number(process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS ?? "5000"),
      });
      return {
        delegationObservability: resolvedDelegationObservability,
        goalRuntimeSummary: resolvedGoalRuntimeSummary,
        assistantModeRuntime: resolvedAssistantModeRuntime,
      };
    });
    {
      const assistantModeState = unwrapDoctorStageResult(assistantModeStage);
      delegationObservability = assistantModeState.delegationObservability;
      goalRuntimeSummary = assistantModeState.goalRuntimeSummary;
      assistantModeRuntime = assistantModeState.assistantModeRuntime;
    }
    if (assistantModeRuntime) {
      checks.push({
        id: "assistant_mode",
        name: "Assistant Mode",
        status: assistantModeRuntime.status === "attention" || assistantModeRuntime.status === "disabled"
          ? "warn"
          : "pass",
        message: assistantModeRuntime.headline,
      });
    }

    skillFreshness = unwrapDoctorStageResult(await captureDoctorStage(
      doctorPerformanceStages,
      "skill_freshness",
      () => buildScopedSkillFreshnessSnapshot(
        ctx.stateDir,
        resolveScopedMemoryManager(params),
      ),
    ));
    checks.push({
      id: "skill_freshness",
      name: "Skill Freshness",
      status: (skillFreshness.summary.warnCount + skillFreshness.summary.needsPatchCount + skillFreshness.summary.needsNewSkillCount) > 0
        ? "warn"
        : skillFreshness.summary.available
          ? "pass"
          : "warn",
      message: skillFreshness.summary.headline,
    });

    if (delegationObservability) {
      const delegationHasProtocolGap = delegationObservability.summary.activeCount > delegationObservability.summary.protocolBackedCount;
      checks.push({
        id: "delegation_protocol",
        name: "Delegation Protocol",
        status: delegationHasProtocolGap ? "warn" : "pass",
        message: delegationObservability.summary.headline,
      });
    }
  }

  memoryClassConsumer = buildMemoryClassConsumerView({
    presentClasses: [
      ...(mindProfileSnapshot ? ["profile_semantic" as const] : []),
      ...(memorySourceInventory || memorySharedGovernance ? ["governance" as const] : []),
    ],
    partialClasses: [
      ...(memoryTreeJobs || memoryTreeLifecycle || memorySourceInventory ? ["project_semantic" as const] : []),
      ...(skillFreshness?.summary?.available ? ["procedural_experience" as const] : []),
    ],
    noteByClass: {
      profile_semantic: mindProfileSnapshot
        ? "system.doctor has an explicit mind/profile snapshot anchored by the profile layer."
        : "system.doctor did not attach a mind/profile snapshot in this run.",
      project_semantic: memoryTreeJobs || memoryTreeLifecycle || memorySourceInventory
        ? "system.doctor currently observes project semantic through tree and inventory views, not an explicit project truth payload."
        : "system.doctor has no project semantic observability signal attached in this run.",
      episodic_task: "system.doctor is not a task-scoped endpoint, so episodic task signals stay on task-oriented RPC surfaces.",
      procedural_experience: skillFreshness?.summary?.available
        ? "system.doctor currently exposes procedural experience mainly through freshness and lifecycle projections."
        : "system.doctor did not attach a procedural experience projection in this run.",
      governance: memorySourceInventory || memorySharedGovernance
        ? "system.doctor exposes governance through inventory, shared governance, and lifecycle observability."
        : "system.doctor did not attach governance observability in this run.",
    },
    includeRegistry: !summaryOnly,
  });
  checks.push({
    id: "memory_class_registry",
    name: "Memory Class Registry",
    status: memoryClassConsumer.memoryClassCoverage.availableCount > 0 || memoryClassConsumer.memoryClassCoverage.partialCount > 0
      ? "pass"
      : "warn",
    message: memoryClassConsumer.memoryClassCoverage.headline,
  });
  memoryFreshness = buildMemoryFreshnessView({
    items: [
      buildProfileSemanticFreshnessView(mindProfileSnapshot),
      buildProjectSemanticFreshnessFromInventory({
        governance: memorySourceInventory?.summary,
        generatedAt: memorySourceInventory?.generatedAt,
        note: "system.doctor 当前只通过 inventory/tree 观察 project semantic，本批未补 project truth state。",
      }),
      buildProceduralExperienceFreshnessFromSkillSnapshot(skillFreshness),
      buildGovernanceFreshnessFromInventory({
        governance: memorySourceInventory?.summary,
        generatedAt: memorySourceInventory?.generatedAt,
      }),
    ],
  });
  if (memoryFreshness.summary.available) {
    checks.push({
      id: "memory_freshness",
      name: "Memory Freshness",
      status: memoryFreshness.summary.reviewRequiredCount > 0
        || memoryFreshness.summary.staleCount > 0
        || memoryFreshness.summary.supersededCount > 0
        ? "warn"
        : "pass",
      message: memoryFreshness.summary.headline,
    });
  }
  memoryEvaluation = buildMemoryEvaluationSummary({
    mindProfileSnapshot,
    memoryFreshness,
    residentAgents,
    dreamRuntime,
  });
  if (memoryEvaluation?.available) {
    checks.push({
      id: "memory_evaluation",
      name: "Memory Evaluation",
      status: memoryEvaluation.status,
      message: memoryEvaluation.headline,
    });
  }

  if (!summaryOnly && ctx.toolExecutor) {
    const toolAgentId = typeof params.toolAgentId === "string" && params.toolAgentId.trim()
      ? params.toolAgentId.trim()
      : undefined;
    const toolConversationId = typeof params.toolConversationId === "string" && params.toolConversationId.trim()
      ? params.toolConversationId.trim()
      : undefined;
    const toolTaskId = typeof params.toolTaskId === "string" && params.toolTaskId.trim()
      ? params.toolTaskId.trim()
      : undefined;
    const visibilityTask = toolTaskId && ctx.subTaskRuntimeStore
      ? await ctx.subTaskRuntimeStore.getTask(toolTaskId)
      : undefined;
    const visibilityAgentId = toolAgentId || visibilityTask?.agentId;
    const visibilityConversationId = toolConversationId || visibilityTask?.parentConversationId;
    const residentStateBinding = resolveResidentStateBindingViewForAgent(
      ctx.stateDir,
      ctx.agentRegistry,
      visibilityAgentId,
    );
    const launchExplainability = buildAgentLaunchExplainability({
      agentRegistry: ctx.agentRegistry,
      agentId: visibilityAgentId,
      profileId: visibilityTask?.launchSpec?.profileId,
      launchSpec: visibilityTask?.launchSpec,
      runtimeResilience,
    });
    const runtimeContext = buildToolRuntimeContext(ctx.requestChannel, visibilityTask?.launchSpec);
    bridgeRecoveryDiagnostics = visibilityTask
      ? buildBridgeRecoveryDiagnostics({
          toolExecutor: ctx.toolExecutor,
          task: visibilityTask,
          agentId: visibilityAgentId,
          conversationId: visibilityConversationId,
        })
      : undefined;
    const visibleContracts = ctx.toolExecutor.getContracts(
      visibilityAgentId,
      visibilityConversationId,
      runtimeContext,
    ).filter((contract) => contract.name !== TOOL_SETTINGS_CONTROL_NAME);
    const observability = buildToolBehaviorObservability({
      contracts: visibleContracts,
      disabledContractNamesConfigured: readConfiguredPromptExperimentToolContracts(),
    });
    const visibleToolNamesForV2 = visibleContracts.map((contract) => contract.name);
    const visibleContractV2 = visibleContracts.length > 0 ? listToolContractsV2(visibleContracts) : [];
    const contractV2Observability = buildToolContractV2Observability({
      contracts: visibleContractV2,
      registeredToolNames: visibleToolNamesForV2,
    });
    const contractV2Summary = contractV2Observability.summary;
    checks.push({
      id: "tool_behavior_observability",
      name: "Tool Behavior Observability",
      status: observability.included.length > 0 ? "pass" : "warn",
      message: observability.included.length > 0
        ? `${observability.included.length} behavior contract(s) visible for ${visibilityAgentId ?? "default"}`
        : `No behavior contracts visible for ${visibilityAgentId ?? "default"}`,
    });
    if (bridgeRecoveryDiagnostics) {
      checks.push({
        id: "bridge_recovery_diagnostics",
        name: "Bridge Recovery",
        status: bridgeRecoveryDiagnostics.status === "allowed" ? "pass" : "warn",
        message: bridgeRecoveryDiagnostics.headline,
      });
    }
    toolBehaviorObservability = {
      requested: {
        ...(toolAgentId ? { agentId: toolAgentId } : {}),
        ...(toolConversationId ? { conversationId: toolConversationId } : {}),
        ...(toolTaskId ? { taskId: toolTaskId } : {}),
      },
      visibilityContext: {
        agentId: visibilityAgentId ?? "default",
        conversationId: visibilityConversationId ?? null,
        ...(bridgeRecoveryDiagnostics ? { bridgeRecoveryDiagnostics } : {}),
        ...(launchExplainability ? { launchExplainability } : {}),
        ...(residentStateBinding ? { residentStateBinding } : {}),
        ...(visibilityTask
          ? {
            taskId: visibilityTask.id,
            launchSpec: visibilityTask.launchSpec,
          }
          : {}),
      },
      counts: {
        visibleToolContractCount: visibleContracts.length,
        includedContractCount: observability.counts.includedContractCount,
        behaviorContractCount: observability.counts.includedContractCount,
      },
      registryInventory: ctx.toolExecutor.getRegistryInventory(),
      included: observability.included,
      contracts: observability.contracts,
      ...(observability.summary ? { summary: observability.summary } : {}),
      ...(observability.experiment ? { experiment: observability.experiment } : {}),
    };
    toolContractV2Observability = {
      requested: {
        ...(toolAgentId ? { agentId: toolAgentId } : {}),
        ...(toolConversationId ? { conversationId: toolConversationId } : {}),
        ...(toolTaskId ? { taskId: toolTaskId } : {}),
      },
      visibilityContext: {
        agentId: visibilityAgentId ?? "default",
        conversationId: visibilityConversationId ?? null,
        ...(bridgeRecoveryDiagnostics ? { bridgeRecoveryDiagnostics } : {}),
        ...(launchExplainability ? { launchExplainability } : {}),
        ...(residentStateBinding ? { residentStateBinding } : {}),
        ...(visibilityTask
          ? {
            taskId: visibilityTask.id,
            launchSpec: visibilityTask.launchSpec,
          }
          : {}),
      },
      summary: contractV2Summary,
      contracts: contractV2Observability.contracts,
    };
  }

  const doctorPerformance: DoctorPerformanceSummary = {
    startedAt: doctorStartedAtIso,
    finishedAt: new Date().toISOString(),
    totalMs: roundDoctorDurationMs(performance.now() - doctorRequestStartedAt),
    stages: doctorPerformanceStages,
  };

    return {
    type: "res",
    id: req.id,
    ok: true,
    payload: {
      surface: doctorSurface,
      checks,
      performance: doctorPerformance,
      configSource,
      memoryRuntime,
      ...(memoryTreeJobs ? { memoryTreeJobs } : {}),
      ...(memorySourceInventory ? { memorySourceInventory } : {}),
      ...(memorySharedGovernance ? { memorySharedGovernance } : {}),
      ...(memoryTreeLifecycle ? { memoryTreeLifecycle } : {}),
      deploymentBackends,
      optionalCapabilities,
      ...(cameraRuntime ? { cameraRuntime } : {}),
      ...(runtimeResilience ? { runtimeResilience } : {}),
      ...(runtimeResilienceDiagnostics ? { runtimeResilienceDiagnostics } : {}),
      extensionRuntime,
      extensionMarketplace,
      extensionGovernance,
      queryRuntime,
      runtimeResources,
      ...(cronRuntime ? { cronRuntime } : {}),
      ...(backgroundContinuationRuntime ? { backgroundContinuationRuntime } : {}),
      ...(externalOutboundRuntime ? { externalOutboundRuntime } : {}),
      ...(emailOutboundRuntime ? { emailOutboundRuntime } : {}),
      ...(emailInboundRuntime ? { emailInboundRuntime } : {}),
      ...(assistantModeRuntime ? { assistantModeRuntime } : {}),
      mcpRuntime,
      mcpRouting,
      ...(channelSecurity.items.length ? { channelSecurity } : {}),
      ...(promptObservability ? { promptObservability } : {}),
      ...(toolBehaviorObservability ? { toolBehaviorObservability } : {}),
      ...(toolContractV2Observability ? { toolContractV2Observability } : {}),
      ...(preflightCompressionGovernance ? { preflightCompressionGovernance } : {}),
      ...(bridgeRecoveryDiagnostics ? { bridgeRecoveryDiagnostics } : {}),
      ...(residentAgents ? { residentAgents } : {}),
      ...(memoryClassConsumer ? {
        memoryClassSignals: memoryClassConsumer.memoryClassSignals,
        memoryClassCoverage: memoryClassConsumer.memoryClassCoverage,
        ...(memoryClassConsumer.memoryClassRegistry ? { memoryClassRegistry: memoryClassConsumer.memoryClassRegistry } : {}),
      } : {}),
      ...(memoryFreshness?.summary?.available ? { memoryFreshness } : {}),
      ...(memoryEvaluation?.available ? { memoryEvaluation } : {}),
        ...(mindProfileSnapshot ? { mindProfileSnapshot } : {}),
        ...(learningReviewInput ? { learningReviewInput } : {}),
        ...(dreamRuntime ? { dreamRuntime } : {}),
        ...(dreamCommons ? { dreamCommons } : {}),
        ...(learningReviewNudgeRuntime ? { learningReviewNudgeRuntime } : {}),
      ...(skillFreshness ? { skillFreshness } : {}),
      ...(delegationObservability ? { delegationObservability } : {}),
      ...(conversationDebug ? { conversationDebug } : {}),
      ...(conversationCatalog ? { conversationCatalog } : {}),
      ...(recentConversationExports ? { recentConversationExports } : {}),
    },
  };
  })();

  if (doctorRequestCacheable && doctorCacheKey) {
    doctorResponseInflight.set(doctorCacheKey, responsePromise);
  }

  try {
    const response = await responsePromise;
    if (doctorRequestCacheable && doctorCacheKey) {
      doctorResponseCache.set(doctorCacheKey, {
        expiresAt: Date.now() + resolveDoctorCacheTtlMs(doctorSurface),
        response,
      });
    }
    return cloneDoctorResponse(response, req.id);
  } finally {
    if (doctorRequestCacheable && doctorCacheKey) {
      doctorResponseInflight.delete(doctorCacheKey);
    }
  }
}

function buildToolRuntimeContext(
  _requestChannel?: ToolContractChannel,
  launchSpec?: ToolExecutionRuntimeContext["launchSpec"],
): ToolExecutionRuntimeContext | undefined {
  return {
    ...(launchSpec ? { launchSpec } : {}),
    channel: "gateway",
  };
}
