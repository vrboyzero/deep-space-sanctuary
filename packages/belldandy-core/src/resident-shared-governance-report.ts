import type { AgentRegistry } from "@belldandy/agent";
import {
  buildTeamSharedMemoryReadinessReport,
  buildMemorySourceCoveragePolicyExplanations,
  describeMemorySourceCoverageItem,
  type MemorySourceCoveragePolicyExplanation,
  type MemoryManager,
  type MemorySourceInventoryConfiguredSource,
  type MemorySourceInventoryItem,
  type MemorySourceInventoryReport,
  type MemoryTreeReportRecord,
} from "@belldandy/memory";

import type { ResolvedResidentMemoryPolicy } from "./resident-memory-policy.js";
import type { ScopedMemoryManagerRecord } from "./resident-memory-managers.js";
import { listResidentSharedReviewQueue } from "./resident-shared-memory.js";

const SHARED_GOVERNANCE_REPORT_VERSION = "p16-shared-governance-preview-v1";
const COVERAGE_ITEM_LIMIT = 8;

type SharedGovernanceRiskLevel = "low" | "medium" | "high";
type SharedGovernanceSuggestedAction = "review" | "keep";

type SharedGovernanceCoverageItem = {
  id: string;
  label: string;
  sourceKind: string;
  sourceClass: string;
  scope: string;
  status: string;
  searchPolicy: string;
  fileCount: number;
  rowCount: number;
  totalBytes: number;
  note?: string;
  lastUpdatedAt?: string;
  explanation: string;
};

type SharedGovernanceCoverageSummary = {
  headline: string;
  indexedFiles: number;
  indexedChunks: number;
  presentCount: number;
  searchableCount: number;
  summaryInputOnlyCount: number;
  inventoryOnlyCount: number;
  missingOrDeclaredCount: number;
  presentByScope: {
    private: number;
    shared: number;
    team: number;
  };
  searchable: SharedGovernanceCoverageItem[];
  summaryInputOnly: SharedGovernanceCoverageItem[];
  inventoryOnly: SharedGovernanceCoverageItem[];
  missingOrDeclared: SharedGovernanceCoverageItem[];
  explanations: MemorySourceCoveragePolicyExplanation[];
};

type SharedGovernanceSuggestion = {
  id: string;
  action: SharedGovernanceSuggestedAction;
  category:
    | "shared_review_queue"
    | "shared_review_blocked"
    | "team_shared_memory"
    | "coverage_attention"
    | "coverage_baseline"
    | "review_surface";
  title: string;
  rationale: string;
  count?: number;
};

export type ResidentSharedGovernancePreviewReport = {
  version: string;
  generatedAt: string;
  boundary: {
    agentId?: string;
    reviewerAgentId?: string;
    memoryMode: string;
    readTargets: string[];
    writeTarget: string;
    includeSharedMemoryReads: boolean;
    summary: string;
  };
  promoteReview: {
    promoteUnits: Array<"chunk" | "source">;
    reviewUnits: Array<"chunk" | "source">;
    nodeReviewSupported: false;
    requiresReason: true;
    claimMode: "centralized_reviewer_claim";
    claimTimeoutMs: number;
    secretGuardApplies: true;
    directSharedWrite: boolean;
    summary: string;
  };
  sharedQueue: {
    summary: ReturnType<typeof listResidentSharedReviewQueue>["summary"];
    uniqueSourcePathCount: number;
    topItems: Array<{
      id: string;
      sourcePath: string;
      targetAgentId: string;
      targetDisplayName: string;
      targetMemoryMode: string;
      reviewStatus: string;
      claimOwner?: string;
      claimTimedOut: boolean;
      actionableByReviewer: boolean;
      blockedByOtherReviewer: boolean;
      updatedAt?: string;
      reason?: string;
    }>;
  };
  teamSharedMemory: Awaited<ReturnType<typeof buildTeamSharedMemoryReadinessReport>>;
  coverage: SharedGovernanceCoverageSummary;
  governance: {
    riskLevel: SharedGovernanceRiskLevel;
    headline: string;
    suggestionCounts: Record<SharedGovernanceSuggestedAction, number>;
    suggestions: SharedGovernanceSuggestion[];
  };
  reviewSurfaceAssessment: {
    mode: "report_ledger_first";
    source: {
      currentSupport: "shared_queue_chunk_or_source";
      recommendation: "keep_existing_direct_share_flow";
      rationale: string;
    };
    node: {
      currentSupport: "derived_projection_only";
      recommendation: "defer_direct_node_review";
      rationale: string;
    };
    summary: string;
  };
};

export type ResidentSharedGovernanceDoctorCheck = {
  id: string;
  name: string;
  status: "pass" | "warn";
  message: string;
  detail?: Record<string, unknown>;
};

export type ResidentSharedGovernanceDoctorReport = {
  generatedAt: string;
  headline: string;
  summary: {
    riskLevel: SharedGovernanceRiskLevel;
    memoryMode: string;
    readTargets: string[];
    writeTarget: string;
    pendingCount: number;
    actionableCount: number;
    blockedCount: number;
    overdueCount: number;
    searchableCount: number;
    summaryInputOnlyCount: number;
    inventoryOnlyCount: number;
    uniqueSourcePathCount: number;
    suggestionCounts: Record<SharedGovernanceSuggestedAction, number>;
    topSuggestions: SharedGovernanceSuggestion[];
    reviewSurfaceMode: string;
    coverageHeadline: string;
    coverageExplanations: SharedGovernanceCoverageSummary["explanations"];
    latestReport?: {
      id: string;
      status: string;
      scope: string;
      agentId?: string;
      updatedAt?: string;
    };
  };
  report: ResidentSharedGovernancePreviewReport;
  checks: ResidentSharedGovernanceDoctorCheck[];
};

export async function buildResidentSharedGovernancePreview(input: {
  stateDir: string;
  manager: MemoryManager;
  residentPolicy?: ResolvedResidentMemoryPolicy;
  residentRecords?: ScopedMemoryManagerRecord[];
  agentRegistry?: AgentRegistry;
  reviewerAgentId?: string;
  configuredSources?: MemorySourceInventoryConfiguredSource[];
  teamSharedMemoryEnabled?: boolean;
}): Promise<{
  report: ResidentSharedGovernancePreviewReport;
  summary: Record<string, unknown>;
  details: Record<string, unknown>;
}> {
  const generatedAt = new Date().toISOString();
  const reviewerAgentId = normalizeOptionalString(input.reviewerAgentId);
  const residentPolicy = input.residentPolicy;
  const inventoryReport = await input.manager.previewSourceInventory({
    configuredSources: input.configuredSources,
  });
  const queue = (input.residentRecords?.length ?? 0) > 0
    ? listResidentSharedReviewQueue({
      records: input.residentRecords ?? [],
      agentRegistry: input.agentRegistry,
      reviewerAgentId,
      limit: 100,
      includeContent: false,
      filter: {
        actionableOnly: false,
      },
    })
    : buildEmptySharedReviewQueue(reviewerAgentId);
  const teamSharedMemory = await buildTeamSharedMemoryReadinessReport({
    stateDir: input.stateDir,
    enabled: input.teamSharedMemoryEnabled === true,
  });
  const coverage = buildCoverageSummary(inventoryReport);
  const uniqueSourcePathCount = new Set(queue.items.map((item) => item.sourcePath)).size;
  const reviewSurfaceAssessment = {
    mode: "report_ledger_first" as const,
    source: {
      currentSupport: "shared_queue_chunk_or_source" as const,
      recommendation: "keep_existing_direct_share_flow" as const,
      rationale: "source 级共享审批已经可以通过 sourcePath 直接 promote/claim/review；本阶段不再额外开一套 source 级 report mutation，避免治理动作分叉。",
    },
    node: {
      currentSupport: "derived_projection_only" as const,
      recommendation: "defer_direct_node_review" as const,
      rationale: "node 仍是整理层投影，不是 canonical 来源；如果现在直接做 node 级审批/改写，会绕开 canonicalize -> ingest -> lifecycle 主链路。",
    },
    summary: "阶段性结论是继续以 report ledger 作为统一治理台账：source 级直接共享动作保留在现有 share flow，node 级 direct review 暂缓。",
  };
  const suggestions = buildGovernanceSuggestions({
    residentPolicy,
    queue,
    teamSharedMemory,
    coverage,
    reviewSurfaceAssessment,
  });
  const governance = buildGovernanceSummary(queue, coverage, teamSharedMemory, suggestions);
  const report: ResidentSharedGovernancePreviewReport = {
    version: SHARED_GOVERNANCE_REPORT_VERSION,
    generatedAt,
    boundary: {
      agentId: residentPolicy?.agentId,
      reviewerAgentId,
      memoryMode: residentPolicy?.memoryMode ?? "unknown",
      readTargets: [...(residentPolicy?.readTargets ?? [])],
      writeTarget: residentPolicy?.writeTarget ?? "private",
      includeSharedMemoryReads: residentPolicy?.includeSharedMemoryReads === true,
      summary: residentPolicy?.summary ?? "Resident memory policy is not available.",
    },
    promoteReview: {
      promoteUnits: ["chunk", "source"],
      reviewUnits: ["chunk", "source"],
      nodeReviewSupported: false,
      requiresReason: true,
      claimMode: "centralized_reviewer_claim",
      claimTimeoutMs: queue.summary.claimTimeoutMs,
      secretGuardApplies: true,
      directSharedWrite: residentPolicy?.writeTarget === "shared",
      summary: residentPolicy?.writeTarget === "shared"
        ? "当前 resident 直接写入 shared 层，不需要再走 promote/review。"
        : "当前 resident 默认先写 private；提升到 shared 时需要 reason、claim/review 和 secret guard。",
    },
    sharedQueue: {
      summary: queue.summary,
      uniqueSourcePathCount,
      topItems: queue.items.slice(0, 10).map((item) => ({
        id: item.id,
        sourcePath: item.sourcePath,
        targetAgentId: item.targetAgentId,
        targetDisplayName: item.targetDisplayName,
        targetMemoryMode: item.targetMemoryMode,
        reviewStatus: item.reviewStatus,
        claimOwner: item.claimOwner,
        claimTimedOut: item.claimTimedOut,
        actionableByReviewer: item.actionableByReviewer,
        blockedByOtherReviewer: item.blockedByOtherReviewer,
        updatedAt: item.updatedAt,
        reason: normalizeOptionalString(item.metadata?.sharedPromotion?.reason),
      })),
    },
    teamSharedMemory,
    coverage,
    governance,
    reviewSurfaceAssessment,
  };
  return {
    report,
    summary: {
      version: report.version,
      memoryMode: report.boundary.memoryMode,
      readTargets: report.boundary.readTargets,
      writeTarget: report.boundary.writeTarget,
      queueTotalCount: report.sharedQueue.summary.totalCount,
      queuePendingCount: report.sharedQueue.summary.pendingCount,
      queueActionableCount: report.sharedQueue.summary.reviewerActionableCount,
      queueBlockedCount: report.sharedQueue.summary.blockedCount,
      queueOverdueCount: report.sharedQueue.summary.overdueCount,
      queueUniqueSourcePathCount: report.sharedQueue.uniqueSourcePathCount,
      teamSharedMemoryEnabled: report.teamSharedMemory.enabled,
      teamSharedMemoryAvailable: report.teamSharedMemory.available,
      searchablePresentCount: report.coverage.searchableCount,
      summaryInputOnlyPresentCount: report.coverage.summaryInputOnlyCount,
      inventoryOnlyPresentCount: report.coverage.inventoryOnlyCount,
      missingOrDeclaredCount: report.coverage.missingOrDeclaredCount,
      governance: report.governance,
      reviewSurfaceAssessment: report.reviewSurfaceAssessment,
    },
    details: {
      report,
      inventory: {
        totals: inventoryReport.totals,
        searchable: report.coverage.searchable,
        summaryInputOnly: report.coverage.summaryInputOnly,
        inventoryOnly: report.coverage.inventoryOnly,
        missingOrDeclared: report.coverage.missingOrDeclared,
      },
      queue: {
        summary: queue.summary,
        items: report.sharedQueue.topItems,
      },
      configuredSources: input.configuredSources ?? [],
    },
  };
}

function buildEmptySharedReviewQueue(reviewerAgentId?: string) {
  return {
    items: [],
    summary: {
      totalCount: 0,
      pendingCount: 0,
      claimedCount: 0,
      unclaimedCount: 0,
      overdueCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      revokedCount: 0,
      claimTimeoutMs: 0,
      reviewerAgentId,
      reviewerClaimedCount: 0,
      reviewerActionableCount: 0,
      blockedCount: 0,
      byAgent: [],
      byReviewer: [],
    },
  };
}

function buildCoverageSummary(report: MemorySourceInventoryReport): SharedGovernanceCoverageSummary {
  const searchable = selectCoverageItems(report.items, "searchable");
  const summaryInputOnly = selectCoverageItems(report.items, "summary-input-only");
  const inventoryOnly = selectCoverageItems(report.items, "inventory-only");
  const missingOrDeclared = report.items
    .filter((item) => item.status !== "present")
    .map((item) => toCoverageItem(item))
    .slice(0, COVERAGE_ITEM_LIMIT);
  const presentItems = report.items.filter((item) => item.status === "present");
  const presentByScope = presentItems.reduce<SharedGovernanceCoverageSummary["presentByScope"]>((acc, item) => {
    if (item.scope === "private" || item.scope === "shared" || item.scope === "team") {
      acc[item.scope] += 1;
    }
    return acc;
  }, { private: 0, shared: 0, team: 0 });
  const searchableCount = presentItems.filter((item) => item.admission.searchPolicy === "searchable").length;
  const summaryInputOnlyCount = presentItems.filter((item) => item.admission.searchPolicy === "summary-input-only").length;
  const inventoryOnlyCount = presentItems.filter((item) => item.admission.searchPolicy === "inventory-only").length;
  const missingOrDeclaredCount = report.items.filter((item) => item.status !== "present").length;
  return {
    headline: `present searchable=${searchableCount}, summary-input-only=${summaryInputOnlyCount}, inventory-only=${inventoryOnlyCount}, missing/declared=${missingOrDeclaredCount}`,
    indexedFiles: report.totals.indexedFiles,
    indexedChunks: report.totals.indexedChunks,
    presentCount: presentItems.length,
    searchableCount,
    summaryInputOnlyCount,
    inventoryOnlyCount,
    missingOrDeclaredCount,
    presentByScope,
    searchable,
    summaryInputOnly,
    inventoryOnly,
    missingOrDeclared,
    explanations: buildMemorySourceCoveragePolicyExplanations(),
  };
}

function selectCoverageItems(
  items: MemorySourceInventoryItem[],
  searchPolicy: "searchable" | "summary-input-only" | "inventory-only",
): SharedGovernanceCoverageItem[] {
  return items
    .filter((item) => item.status === "present" && item.admission.searchPolicy === searchPolicy)
    .map((item) => toCoverageItem(item))
    .slice(0, COVERAGE_ITEM_LIMIT);
}

function toCoverageItem(item: MemorySourceInventoryItem): SharedGovernanceCoverageItem {
  return {
    id: item.id,
    label: item.label,
    sourceKind: item.sourceKind,
    sourceClass: item.sourceClass,
    scope: item.scope,
    status: item.status,
    searchPolicy: item.admission.searchPolicy,
    fileCount: item.stats.fileCount,
    rowCount: item.stats.rowCount,
    totalBytes: item.stats.totalBytes,
    note: item.notes[0],
    lastUpdatedAt: item.stats.lastUpdatedAt,
    explanation: describeMemorySourceCoverageItem(item),
  };
}

function buildGovernanceSuggestions(input: {
  residentPolicy?: ResolvedResidentMemoryPolicy;
  queue: ReturnType<typeof listResidentSharedReviewQueue>;
  teamSharedMemory: Awaited<ReturnType<typeof buildTeamSharedMemoryReadinessReport>>;
  coverage: SharedGovernanceCoverageSummary;
  reviewSurfaceAssessment: ResidentSharedGovernancePreviewReport["reviewSurfaceAssessment"];
}): SharedGovernanceSuggestion[] {
  const suggestions: SharedGovernanceSuggestion[] = [];
  const { queue, teamSharedMemory, coverage } = input;

  if (queue.summary.pendingCount > 0) {
    suggestions.push({
      id: "shared-review-queue",
      action: "review",
      category: "shared_review_queue",
      title: `有 ${queue.summary.pendingCount} 条 shared 提升仍待审`,
      rationale: queue.summary.reviewerActionableCount > 0
        ? `其中 ${queue.summary.reviewerActionableCount} 条当前 reviewer 可直接处理。`
        : "当前待审项还未完成 review，shared 边界的真实执行口径仍不稳定。",
      count: queue.summary.pendingCount,
    });
  }

  if (queue.summary.blockedCount > 0 || queue.summary.overdueCount > 0) {
    suggestions.push({
      id: "shared-review-blocked",
      action: "review",
      category: "shared_review_blocked",
      title: "shared 审批队列存在阻塞或超时项",
      rationale: `blocked=${queue.summary.blockedCount}，overdue=${queue.summary.overdueCount}。需要确认 claim 是否失活、是否应该释放给其他 reviewer。`,
      count: queue.summary.blockedCount + queue.summary.overdueCount,
    });
  }

  if (!teamSharedMemory.enabled) {
    suggestions.push({
      id: "team-shared-disabled",
      action: "keep",
      category: "team_shared_memory",
      title: "team shared memory 继续保持默认关闭",
      rationale: "当前仍以显式启用和 secret guard 作为默认安全边界，先保持保守策略。",
    });
  }

  if (coverage.inventoryOnlyCount > 0 || coverage.summaryInputOnlyCount > 0) {
    suggestions.push({
      id: "coverage-attention",
      action: "review",
      category: "coverage_attention",
      title: "存在已落盘但不直接进入搜索的来源",
      rationale: `summary-input-only=${coverage.summaryInputOnlyCount}，inventory-only=${coverage.inventoryOnlyCount}。需要确认这些来源是否符合“只做整理输入或只做治理盘点”的预期。`,
      count: coverage.summaryInputOnlyCount + coverage.inventoryOnlyCount,
    });
  } else {
    suggestions.push({
      id: "coverage-baseline",
      action: "keep",
      category: "coverage_baseline",
      title: "当前检索覆盖口径保持清晰",
      rationale: "当前盘点来源已基本能区分 direct searchable 与非 searchable，不需要额外扩大自动纳管范围。",
    });
  }

  suggestions.push({
    id: "review-surface-mode",
    action: "keep",
    category: "review_surface",
    title: "继续维持 report ledger first 的治理入口",
    rationale: input.reviewSurfaceAssessment.summary,
  });

  if (input.residentPolicy?.writeTarget === "shared") {
    suggestions.push({
      id: "shared-resident-direct-write",
      action: "keep",
      category: "team_shared_memory",
      title: "shared resident 继续保持直接写 shared",
      rationale: "该 resident 本身就在 shared 层工作，不应再套一层 promote/review 流程。",
    });
  }

  return suggestions;
}

function buildGovernanceSummary(
  queue: ReturnType<typeof listResidentSharedReviewQueue>,
  coverage: SharedGovernanceCoverageSummary,
  teamSharedMemory: Awaited<ReturnType<typeof buildTeamSharedMemoryReadinessReport>>,
  suggestions: SharedGovernanceSuggestion[],
): ResidentSharedGovernancePreviewReport["governance"] {
  const suggestionCounts = suggestions.reduce<Record<SharedGovernanceSuggestedAction, number>>((acc, item) => {
    acc[item.action] += 1;
    return acc;
  }, { review: 0, keep: 0 });
  const riskLevel = resolveGovernanceRiskLevel(queue, coverage);
  return {
    riskLevel,
    headline: `shared governance ${riskLevel}: pending=${queue.summary.pendingCount}, actionable=${queue.summary.reviewerActionableCount}, summary-input-only=${coverage.summaryInputOnlyCount}, inventory-only=${coverage.inventoryOnlyCount}, teamEnabled=${teamSharedMemory.enabled}`,
    suggestionCounts,
    suggestions,
  };
}

export function buildResidentSharedGovernanceDoctorReport(input: {
  preview: ResidentSharedGovernancePreviewReport;
  latestReport?: MemoryTreeReportRecord | null;
}): ResidentSharedGovernanceDoctorReport {
  const latestReport = input.latestReport
    ? {
      id: input.latestReport.id,
      status: input.latestReport.status,
      scope: input.latestReport.scope,
      agentId: input.latestReport.agentId,
      updatedAt: input.latestReport.updatedAt,
    }
    : undefined;
  const summary: ResidentSharedGovernanceDoctorReport["summary"] = {
    riskLevel: input.preview.governance.riskLevel,
    memoryMode: input.preview.boundary.memoryMode,
    readTargets: [...input.preview.boundary.readTargets],
    writeTarget: input.preview.boundary.writeTarget,
    pendingCount: input.preview.sharedQueue.summary.pendingCount,
    actionableCount: input.preview.sharedQueue.summary.reviewerActionableCount,
    blockedCount: input.preview.sharedQueue.summary.blockedCount,
    overdueCount: input.preview.sharedQueue.summary.overdueCount,
    searchableCount: input.preview.coverage.searchableCount,
    summaryInputOnlyCount: input.preview.coverage.summaryInputOnlyCount,
    inventoryOnlyCount: input.preview.coverage.inventoryOnlyCount,
    uniqueSourcePathCount: input.preview.sharedQueue.uniqueSourcePathCount,
    suggestionCounts: input.preview.governance.suggestionCounts,
    topSuggestions: input.preview.governance.suggestions.slice(0, 5),
    reviewSurfaceMode: input.preview.reviewSurfaceAssessment.mode,
    coverageHeadline: input.preview.coverage.headline,
    coverageExplanations: input.preview.coverage.explanations,
    ...(latestReport ? { latestReport } : {}),
  };
  const headline = buildResidentSharedGovernanceDoctorHeadline(summary);
  return {
    generatedAt: input.preview.generatedAt,
    headline,
    summary,
    report: input.preview,
    checks: [
      {
        id: "memory_shared_governance",
        name: "Memory Shared Governance",
        status: summary.pendingCount > 0 || summary.blockedCount > 0 || summary.inventoryOnlyCount > 0 || summary.summaryInputOnlyCount > 0
          ? "warn"
          : "pass",
        message: headline,
        detail: {
          memoryMode: summary.memoryMode,
          readTargets: summary.readTargets,
          writeTarget: summary.writeTarget,
          pendingCount: summary.pendingCount,
          actionableCount: summary.actionableCount,
          blockedCount: summary.blockedCount,
          overdueCount: summary.overdueCount,
          searchableCount: summary.searchableCount,
          summaryInputOnlyCount: summary.summaryInputOnlyCount,
          inventoryOnlyCount: summary.inventoryOnlyCount,
          uniqueSourcePathCount: summary.uniqueSourcePathCount,
          suggestionCounts: summary.suggestionCounts,
          topSuggestions: summary.topSuggestions,
          reviewSurfaceMode: summary.reviewSurfaceMode,
          coverageHeadline: summary.coverageHeadline,
          coverageExplanations: summary.coverageExplanations,
          ...(latestReport ? { latestReport } : {}),
        },
      },
    ],
  };
}

function resolveGovernanceRiskLevel(
  queue: ReturnType<typeof listResidentSharedReviewQueue>,
  coverage: SharedGovernanceCoverageSummary,
): SharedGovernanceRiskLevel {
  if (queue.summary.pendingCount > 0 && (queue.summary.reviewerActionableCount > 0 || queue.summary.blockedCount > 0 || queue.summary.overdueCount > 0)) {
    return "high";
  }
  if (coverage.inventoryOnlyCount > 0 || coverage.summaryInputOnlyCount > 0 || queue.summary.pendingCount > 0) {
    return "medium";
  }
  return "low";
}

function buildResidentSharedGovernanceDoctorHeadline(
  summary: ResidentSharedGovernanceDoctorReport["summary"],
): string {
  const latestReportHint = summary.latestReport
    ? `, latestReport=${summary.latestReport.status}`
    : "";
  if (summary.pendingCount > 0 || summary.blockedCount > 0 || summary.overdueCount > 0) {
    return `Memory shared governance needs review: pending=${summary.pendingCount}, actionable=${summary.actionableCount}, blocked=${summary.blockedCount}, overdue=${summary.overdueCount}, sourcePaths=${summary.uniqueSourcePathCount}, inventory-only=${summary.inventoryOnlyCount}, summary-input-only=${summary.summaryInputOnlyCount}${latestReportHint}.`;
  }
  if (summary.inventoryOnlyCount > 0 || summary.summaryInputOnlyCount > 0) {
    return `Memory shared governance layered: searchable=${summary.searchableCount}, sourcePaths=${summary.uniqueSourcePathCount}, summary-input-only=${summary.summaryInputOnlyCount}, inventory-only=${summary.inventoryOnlyCount}, mode=${summary.memoryMode}${latestReportHint}.`;
  }
  return `Memory shared governance stable: mode=${summary.memoryMode}, writeTarget=${summary.writeTarget}, searchable=${summary.searchableCount}, sourcePaths=${summary.uniqueSourcePathCount}${latestReportHint}.`;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}
