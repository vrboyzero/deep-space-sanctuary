import type {
  ExperienceCandidate,
  ExperienceUsageSummary,
  MemoryClass,
  MemorySourceInventoryDoctorReport,
  MemorySourceInventoryGovernanceSummary,
  MemoryTreeReportRecord,
  TaskExperienceDetail,
} from "@belldandy/memory";
import { getMemoryClassContract } from "@belldandy/memory";

import type { GoalReviewGovernanceSummary } from "./goals/types.js";
import type { MindProfileSnapshot } from "./mind-profile-snapshot.js";
import {
  findSkillFreshnessForUsage,
  type SkillFreshnessAssessment,
  type SkillFreshnessSnapshot,
} from "./skill-freshness.js";

export type MemoryFreshnessStatus = "fresh" | "active" | "stale" | "superseded" | "review_required";

export interface MemoryFreshnessSignalView {
  code: string;
  severity: "info" | "warn";
  summary: string;
}

export interface MemoryFreshnessItemView {
  memoryClass: MemoryClass;
  label: string;
  status: MemoryFreshnessStatus;
  freshnessHeadline: string;
  freshnessSignals: MemoryFreshnessSignalView[];
  lastUpdatedAt?: string;
  lastConfirmedAt?: string;
  lastUsedAt?: string;
  reviewedAt?: string;
  supersededAt?: string;
  note?: string;
}

export interface MemoryFreshnessView {
  summary: {
    available: boolean;
    itemCount: number;
    freshCount: number;
    activeCount: number;
    staleCount: number;
    supersededCount: number;
    reviewRequiredCount: number;
    headline: string;
  };
  items: MemoryFreshnessItemView[];
}

type BuildOptions = {
  nowMs?: number;
};

type BuildItemInput = {
  memoryClass: MemoryClass;
  status?: MemoryFreshnessStatus;
  freshnessHeadline?: string;
  freshnessSignals?: readonly MemoryFreshnessSignalView[];
  lastUpdatedAt?: string;
  lastConfirmedAt?: string;
  lastUsedAt?: string;
  reviewedAt?: string;
  supersededAt?: string;
  note?: string;
};

type ProfileSemanticFreshnessEntryInput = {
  updatedAt?: string;
  lastConfirmedAt?: string;
};

const MEMORY_FRESHNESS_SHORT_LABELS: Record<MemoryClass, string> = {
  profile_semantic: "profile",
  project_semantic: "project",
  episodic_task: "task",
  procedural_experience: "experience",
  governance: "governance",
};

export function buildMemoryFreshnessView(
  input: {
    items?: Array<MemoryFreshnessItemView | null | undefined>;
  } = {},
): MemoryFreshnessView {
  const items = (input.items ?? []).filter((item): item is MemoryFreshnessItemView => Boolean(item));
  const freshCount = items.filter((item) => item.status === "fresh").length;
  const activeCount = items.filter((item) => item.status === "active").length;
  const staleCount = items.filter((item) => item.status === "stale").length;
  const supersededCount = items.filter((item) => item.status === "superseded").length;
  const reviewRequiredCount = items.filter((item) => item.status === "review_required").length;
  return {
    summary: {
      available: items.length > 0,
      itemCount: items.length,
      freshCount,
      activeCount,
      staleCount,
      supersededCount,
      reviewRequiredCount,
      headline: items.length > 0 ? formatMemoryFreshnessCoverage(items) : "no freshness signals",
    },
    items,
  };
}

export function formatMemoryFreshnessCoverage(items: readonly MemoryFreshnessItemView[]): string {
  return items
    .map((item) => `${MEMORY_FRESHNESS_SHORT_LABELS[item.memoryClass]}=${item.status}`)
    .join(", ");
}

export function buildProfileSemanticFreshnessView(
  snapshot: MindProfileSnapshot | undefined,
  options: BuildOptions = {},
): MemoryFreshnessItemView | undefined {
  if (!snapshot) {
    return undefined;
  }
  return buildProfileSemanticFreshnessFromStateEntries({
    hasUserProfile: snapshot.summary.hasUserProfile,
    stateEntries: Array.isArray(snapshot.profile.stateEntries)
      ? snapshot.profile.stateEntries.map((item) => ({
        updatedAt: item.updatedAt,
        lastConfirmedAt: item.lastConfirmedAt,
      }))
      : [],
  }, options);
}

export function buildProfileSemanticFreshnessFromStateEntries(input: {
  hasUserProfile?: boolean;
  stateEntries?: Array<ProfileSemanticFreshnessEntryInput | null | undefined>;
}, options: BuildOptions = {}): MemoryFreshnessItemView | undefined {
  const stateEntries = (input.stateEntries ?? []).filter((item): item is ProfileSemanticFreshnessEntryInput => Boolean(item));
  if (!input.hasUserProfile && stateEntries.length <= 0) {
    return undefined;
  }
  const lastUpdatedAt = readLatestIso(stateEntries.map((item) => item.updatedAt));
  const lastConfirmedAt = readLatestIso(stateEntries.map((item) => item.lastConfirmedAt));
  const ageStatus = resolveAgeStatus(lastConfirmedAt ?? lastUpdatedAt, options.nowMs, 30, 180);
  const status: MemoryFreshnessStatus = lastConfirmedAt && ageStatus !== "stale"
    ? "fresh"
    : ageStatus;
  const signals: MemoryFreshnessSignalView[] = [];
  if (input.hasUserProfile) {
    signals.push({
      code: "profile_anchor_present",
      severity: "info",
      summary: "存在显式用户画像锚点。",
    });
  }
  if (stateEntries.length > 0) {
    signals.push({
      code: "profile_state_entries_visible",
      severity: "info",
      summary: `当前暴露 ${stateEntries.length} 条 profile state 结构化字段。`,
    });
  }
  if (lastConfirmedAt) {
    signals.push({
      code: "profile_state_confirmed",
      severity: "info",
      summary: `最近一次显式确认时间为 ${lastConfirmedAt}。`,
    });
  }
  if (ageStatus === "stale" && (lastConfirmedAt || lastUpdatedAt)) {
    signals.push({
      code: "profile_state_recency_old",
      severity: "warn",
      summary: "当前 profile state 最近确认/更新时间较久，建议在后续合适场景中补确认。",
    });
  }
  return buildMemoryFreshnessItem({
    memoryClass: "profile_semantic",
    status,
    lastUpdatedAt,
    lastConfirmedAt,
    freshnessSignals: signals,
    freshnessHeadline: lastConfirmedAt
      ? `Profile state 最近一次确认于 ${lastConfirmedAt}`
      : stateEntries.length > 0
        ? `Profile state 当前可见 ${stateEntries.length} 条结构化字段`
        : "Mind/profile snapshot 已附着，但显式 profile state 字段仍偏少",
  });
}

export function cloneMemoryFreshnessView(
  view: MemoryFreshnessView | undefined,
): MemoryFreshnessView | undefined {
  if (!view) {
    return undefined;
  }
  return {
    summary: {
      ...view.summary,
    },
    items: view.items.map((item) => ({
      ...item,
      freshnessSignals: item.freshnessSignals.map((signal) => ({ ...signal })),
    })),
  };
}

export function readMemoryFreshnessView(value: unknown): MemoryFreshnessView | undefined {
  if (!isObjectRecord(value)) {
    return undefined;
  }
  const summary = isObjectRecord(value.summary) ? value.summary : undefined;
  const items = Array.isArray(value.items)
    ? value.items
      .map((item) => readMemoryFreshnessItemView(item))
      .filter((item): item is MemoryFreshnessItemView => Boolean(item))
    : [];
  if (!summary && items.length <= 0) {
    return undefined;
  }
  return {
    summary: {
      available: summary?.available === true || items.length > 0,
      itemCount: readOptionalFiniteInteger(summary?.itemCount) ?? items.length,
      freshCount: readOptionalFiniteInteger(summary?.freshCount) ?? items.filter((item) => item.status === "fresh").length,
      activeCount: readOptionalFiniteInteger(summary?.activeCount) ?? items.filter((item) => item.status === "active").length,
      staleCount: readOptionalFiniteInteger(summary?.staleCount) ?? items.filter((item) => item.status === "stale").length,
      supersededCount: readOptionalFiniteInteger(summary?.supersededCount) ?? items.filter((item) => item.status === "superseded").length,
      reviewRequiredCount: readOptionalFiniteInteger(summary?.reviewRequiredCount) ?? items.filter((item) => item.status === "review_required").length,
      headline: readOptionalString(summary?.headline) ?? (items.length > 0 ? formatMemoryFreshnessCoverage(items) : "no freshness signals"),
    },
    items,
  };
}

export function buildProjectSemanticFreshnessFromInventory(input: {
  generatedAt?: string;
  governance?: MemorySourceInventoryGovernanceSummary;
  reportRecord?: Pick<MemoryTreeReportRecord, "status" | "createdAt" | "updatedAt"> | null;
  note?: string;
}, options: BuildOptions = {}): MemoryFreshnessItemView | undefined {
  if (!input.governance && !input.generatedAt && !input.reportRecord) {
    return undefined;
  }
  const lastUpdatedAt = readLatestIso([
    input.reportRecord?.updatedAt,
    input.generatedAt,
    input.reportRecord?.createdAt,
  ]);
  const suggestedReviewFamilyCount = Number(input.governance?.suggestedReviewFamilyCount) || 0;
  const highRiskFamilyCount = Number(input.governance?.highRiskFamilyCount) || 0;
  const ageStatus = resolveAgeStatus(lastUpdatedAt, options.nowMs, undefined, 30);
  let status: MemoryFreshnessStatus = ageStatus;
  if (input.reportRecord?.status === "superseded") {
    status = "superseded";
  } else if (suggestedReviewFamilyCount > 0 || highRiskFamilyCount > 0) {
    status = "review_required";
  } else if (status === "fresh") {
    status = "active";
  }
  const signals: MemoryFreshnessSignalView[] = [{
    code: "derived_project_semantic_view",
    severity: "info",
    summary: "当前 project semantic 仍来自 inventory/tree 派生读模型，不是显式 project truth state。",
  }];
  if (suggestedReviewFamilyCount > 0) {
    signals.push({
      code: "project_semantic_review_families",
      severity: "warn",
      summary: `存在 ${suggestedReviewFamilyCount} 个 source family 需要 review，项目语义投影可能需要收口。`,
    });
  }
  if (highRiskFamilyCount > 0) {
    signals.push({
      code: "project_semantic_high_risk_families",
      severity: "warn",
      summary: `存在 ${highRiskFamilyCount} 个高风险 source family，项目语义投影可靠性需要关注。`,
    });
  }
  if (status === "stale") {
    signals.push({
      code: "project_semantic_observation_old",
      severity: "warn",
      summary: "当前 project semantic 观测时间较久，建议重新跑 inventory / tree 观测。",
    });
  }
  return buildMemoryFreshnessItem({
    memoryClass: "project_semantic",
    status,
    lastUpdatedAt,
    freshnessSignals: signals,
    freshnessHeadline: status === "review_required"
      ? "Project semantic 派生观测出现 review 信号"
      : "Project semantic 目前仍通过派生 inventory/tree 视图被观测",
    note: input.note,
  });
}

export function buildEpisodicTaskFreshnessView(
  task: TaskExperienceDetail | undefined,
  options: BuildOptions = {},
): MemoryFreshnessItemView | undefined {
  if (!task) {
    return undefined;
  }
  const lastUpdatedAt = readLatestIso([
    task.resumeContext?.updatedAt,
    task.workRecap?.updatedAt,
    task.updatedAt,
    task.finishedAt,
    task.startedAt,
  ]);
  const ageStatus = resolveAgeStatus(lastUpdatedAt, options.nowMs, 7, 30);
  let status: MemoryFreshnessStatus = ageStatus;
  if (task.status === "running") {
    status = ageStatus === "stale" ? "stale" : "active";
  } else if (task.status === "failed") {
    status = "review_required";
  } else if (task.status === "partial" && ageStatus === "stale") {
    status = "stale";
  } else if (
    task.status === "success"
    && (task.workRecap?.updatedAt || task.resumeContext?.updatedAt)
    && ageStatus !== "stale"
  ) {
    status = "fresh";
  }
  const activityCount = Array.isArray(task.activities) ? task.activities.length : 0;
  const signals: MemoryFreshnessSignalView[] = [{
    code: "task_status",
    severity: task.status === "failed" ? "warn" : "info",
    summary: `任务状态为 ${task.status}。`,
  }];
  if (task.workRecap?.updatedAt) {
    signals.push({
      code: "task_work_recap_attached",
      severity: "info",
      summary: `work recap 最近更新时间为 ${task.workRecap.updatedAt}。`,
    });
  }
  if (task.resumeContext?.updatedAt) {
    signals.push({
      code: "task_resume_context_attached",
      severity: "info",
      summary: `resume context 最近更新时间为 ${task.resumeContext.updatedAt}。`,
    });
  }
  if (activityCount > 0) {
    signals.push({
      code: "task_activity_evidence",
      severity: "info",
      summary: `当前 task detail 挂载 ${activityCount} 条活动证据。`,
    });
  }
  if (status === "stale") {
    signals.push({
      code: "task_context_old",
      severity: "warn",
      summary: "当前任务的 recap / resume 上次更新时间较久，恢复工作前建议先刷新上下文。",
    });
  }
  return buildMemoryFreshnessItem({
    memoryClass: "episodic_task",
    status,
    lastUpdatedAt,
    freshnessSignals: signals,
    freshnessHeadline: status === "fresh"
      ? "Task recap / resume context 已形成较新的恢复锚点"
      : status === "stale"
        ? "Task recap / resume context 已偏旧"
        : `Task detail 当前状态为 ${task.status}`,
  });
}

export function buildProceduralExperienceFreshnessView(input: {
  candidate?: ExperienceCandidate;
  skillFreshness?: SkillFreshnessAssessment;
  usageLinkedCount?: number;
}, options: BuildOptions = {}): MemoryFreshnessItemView | undefined {
  if (!input.candidate && !(Number(input.usageLinkedCount) > 0)) {
    return undefined;
  }
  const candidate = input.candidate;
  if (candidate?.metadata?.synthesisConsumed?.consumed) {
    return buildMemoryFreshnessItem({
      memoryClass: "procedural_experience",
      status: "superseded",
      lastUpdatedAt: readLatestIso([candidate.acceptedAt, candidate.reviewedAt, candidate.createdAt]),
      reviewedAt: candidate.reviewedAt ?? candidate.acceptedAt,
      supersededAt: candidate.metadata.synthesisConsumed.consumedAt,
      freshnessSignals: [{
        code: "candidate_synthesis_consumed",
        severity: "warn",
        summary: `当前候选已被后续合成候选 ${candidate.metadata.synthesisConsumed.consumedByCandidateId} 消费。`,
      }],
      freshnessHeadline: "当前 procedural experience 候选已被后续合成结果替代",
    });
  }
  if (input.skillFreshness) {
    return buildProceduralExperienceFreshnessFromSkillFreshness(input.skillFreshness, candidate);
  }
  if (candidate) {
    const lastUpdatedAt = readLatestIso([candidate.acceptedAt, candidate.reviewedAt, candidate.createdAt]);
    const ageStatus = resolveAgeStatus(lastUpdatedAt, options.nowMs, 30, 120);
    let status: MemoryFreshnessStatus = ageStatus;
    if (candidate.status === "draft" || candidate.status === "reviewed") {
      status = "review_required";
    } else if (candidate.status === "rejected") {
      status = "stale";
    } else if (candidate.status === "accepted" || candidate.status === "published") {
      status = ageStatus === "stale" ? "stale" : ageStatus === "active" ? "active" : "fresh";
    }
    const signals: MemoryFreshnessSignalView[] = [{
      code: "experience_candidate_status",
      severity: status === "review_required" || status === "stale" ? "warn" : "info",
      summary: `当前 ${candidate.type} candidate 状态为 ${candidate.status}。`,
    }];
    if (status === "stale") {
      signals.push({
        code: "experience_candidate_old",
        severity: "warn",
        summary: "当前 experience candidate 长时间未更新，建议核对是否需要淘汰、重写或重新审阅。",
      });
    }
    return buildMemoryFreshnessItem({
      memoryClass: "procedural_experience",
      status,
      lastUpdatedAt,
      reviewedAt: candidate.reviewedAt ?? candidate.acceptedAt,
      freshnessSignals: signals,
      freshnessHeadline: status === "review_required"
        ? "当前 procedural experience 候选仍待 review / publish 收口"
        : `当前 procedural experience 候选状态为 ${candidate.status}`,
    });
  }
  return buildMemoryFreshnessItem({
    memoryClass: "procedural_experience",
    status: "active",
    freshnessSignals: [{
      code: "experience_usage_linked_only",
      severity: "info",
      summary: `当前仅挂载 usage-linked experience 线索 ${Number(input.usageLinkedCount) || 0} 条，尚无显式 candidate。`,
    }],
    freshnessHeadline: "当前 procedural experience 仅暴露 usage-linked 线索",
  });
}

export function buildProceduralExperienceFreshnessFromSkillSnapshot(
  snapshot: SkillFreshnessSnapshot | undefined,
): MemoryFreshnessItemView | undefined {
  if (!snapshot?.summary?.available) {
    return undefined;
  }
  const lastUsedAt = readLatestIso(snapshot.items.map((item) => item.usage?.lastUsedAt));
  let status: MemoryFreshnessStatus = "fresh";
  if (snapshot.summary.needsPatchCount > 0 || snapshot.summary.needsNewSkillCount > 0) {
    status = "review_required";
  } else if (snapshot.summary.warnCount > 0) {
    status = "stale";
  }
  const signals: MemoryFreshnessSignalView[] = [];
  if (snapshot.summary.warnCount > 0) {
    signals.push({
      code: "skill_freshness_warn",
      severity: "warn",
      summary: `存在 ${snapshot.summary.warnCount} 条 stale procedural signal。`,
    });
  }
  if (snapshot.summary.needsPatchCount > 0) {
    signals.push({
      code: "skill_freshness_needs_patch",
      severity: "warn",
      summary: `存在 ${snapshot.summary.needsPatchCount} 条 skill 需要 patch / 修订。`,
    });
  }
  if (snapshot.summary.needsNewSkillCount > 0) {
    signals.push({
      code: "skill_freshness_needs_new_skill",
      severity: "warn",
      summary: `存在 ${snapshot.summary.needsNewSkillCount} 条新 skill 缺口信号。`,
    });
  }
  if (signals.length <= 0) {
    signals.push({
      code: "skill_freshness_healthy",
      severity: "info",
      summary: "当前 procedural experience 没有显式 freshness 风险。",
    });
  }
  return buildMemoryFreshnessItem({
    memoryClass: "procedural_experience",
    status,
    lastUsedAt,
    freshnessSignals: signals,
    freshnessHeadline: snapshot.summary.headline,
  });
}

export function buildProceduralExperienceFreshnessFromTaskDetail(
  task: TaskExperienceDetail | undefined,
  skillFreshnessSnapshot: SkillFreshnessSnapshot | undefined,
  options: BuildOptions = {},
): MemoryFreshnessItemView | undefined {
  if (!task) {
    return undefined;
  }
  const usages = [
    ...(Array.isArray(task.usedMethods) ? task.usedMethods : []),
    ...(Array.isArray(task.usedSkills) ? task.usedSkills : []),
  ];
  if (usages.length <= 0) {
    return undefined;
  }
  const skillAssessments = (Array.isArray(task.usedSkills) ? task.usedSkills : [])
    .map((item) => findSkillFreshnessForUsage(skillFreshnessSnapshot, item))
    .filter((item): item is SkillFreshnessAssessment => Boolean(item));
  const lastUsedAt = readLatestIso(usages.map((item) => item.lastUsedAt ?? item.createdAt));
  const ageStatus = resolveAgeStatus(lastUsedAt, options.nowMs, 30, 120);
  let status: MemoryFreshnessStatus = ageStatus;
  if (skillAssessments.some((item) => item.status === "needs_patch" || item.status === "needs_new_skill")) {
    status = "review_required";
  } else if (skillAssessments.some((item) => item.status === "warn_stale")) {
    status = "stale";
  } else if (status === "active" && usages.length > 0) {
    status = "active";
  }
  const signals: MemoryFreshnessSignalView[] = [{
    code: "task_experience_usage_links",
    severity: status === "stale" || status === "review_required" ? "warn" : "info",
    summary: `当前 task detail 关联 ${usages.length} 条 reusable experience usage。`,
  }];
  for (const assessment of skillAssessments.slice(0, 2)) {
    for (const signal of assessment.signals.slice(0, 1)) {
      signals.push({
        code: signal.code,
        severity: signal.severity,
        summary: signal.summary,
      });
    }
  }
  return buildMemoryFreshnessItem({
    memoryClass: "procedural_experience",
    status,
    lastUsedAt,
    freshnessSignals: signals,
    freshnessHeadline: status === "review_required"
      ? "Task 关联的 reusable experience 出现待处理 freshness 信号"
      : "Task 已挂载 reusable experience usage 证据",
  });
}

export function buildGovernanceFreshnessFromGoalReview(
  governance: GoalReviewGovernanceSummary | undefined,
  options: BuildOptions = {},
): MemoryFreshnessItemView | undefined {
  if (!governance) {
    return undefined;
  }
  const acceptedUnpublishedCount = Array.isArray(governance.actionableReviews)
    ? governance.actionableReviews.filter((item) => item.status === "accepted").length
    : 0;
  return buildGovernanceFreshnessView({
    generatedAt: governance.generatedAt,
    workflowPendingCount: Number(governance.workflowPendingCount) || 0,
    workflowOverdueCount: Number(governance.workflowOverdueCount) || 0,
    needsRevisionCount: Number(governance.reviewStatusCounts?.needs_revision) || 0,
    acceptedUnpublishedCount,
    checkpointWorkflowPendingCount: Number(governance.checkpointWorkflowPendingCount) || 0,
    checkpointWorkflowOverdueCount: Number(governance.checkpointWorkflowOverdueCount) || 0,
  }, options);
}

export type GovernanceFreshnessInput = {
  generatedAt?: string;
  workflowPendingCount?: number;
  workflowOverdueCount?: number;
  needsRevisionCount?: number;
  acceptedUnpublishedCount?: number;
  checkpointWorkflowPendingCount?: number;
  checkpointWorkflowOverdueCount?: number;
};

export function buildGovernanceFreshnessView(
  governance: GovernanceFreshnessInput | undefined,
  options: BuildOptions = {},
): MemoryFreshnessItemView | undefined {
  if (!governance) {
    return undefined;
  }
  const pendingCount = Number(governance.workflowPendingCount) || 0;
  const overdueCount = Number(governance.workflowOverdueCount) || 0;
  const needsRevisionCount = Number(governance.needsRevisionCount) || 0;
  const acceptedUnpublishedCount = Number(governance.acceptedUnpublishedCount) || 0;
  const checkpointPendingCount = Number(governance.checkpointWorkflowPendingCount) || 0;
  const checkpointOverdueCount = Number(governance.checkpointWorkflowOverdueCount) || 0;
  if (
    !governance.generatedAt
    && pendingCount <= 0
    && overdueCount <= 0
    && needsRevisionCount <= 0
    && acceptedUnpublishedCount <= 0
    && checkpointPendingCount <= 0
    && checkpointOverdueCount <= 0
  ) {
    return undefined;
  }
  const ageStatus = resolveAgeStatus(governance.generatedAt, options.nowMs, 7, 30);
  const reviewRequired = pendingCount > 0
    || overdueCount > 0
    || needsRevisionCount > 0
    || acceptedUnpublishedCount > 0
    || checkpointPendingCount > 0
    || checkpointOverdueCount > 0;
  const status: MemoryFreshnessStatus = reviewRequired ? "review_required" : ageStatus;
  const signals: MemoryFreshnessSignalView[] = [];
  if (pendingCount > 0) {
    signals.push({
      code: "governance_pending_review",
      severity: "warn",
      summary: `存在 ${pendingCount} 条待处理 review workflow。`,
    });
  }
  if (overdueCount > 0) {
    signals.push({
      code: "governance_overdue_review",
      severity: "warn",
      summary: `存在 ${overdueCount} 条超 SLA 的 review workflow。`,
    });
  }
  if (needsRevisionCount > 0) {
    signals.push({
      code: "governance_needs_revision",
      severity: "warn",
      summary: `存在 ${needsRevisionCount} 条 needs_revision suggestion。`,
    });
  }
  if (acceptedUnpublishedCount > 0) {
    signals.push({
      code: "governance_accepted_unpublished",
      severity: "warn",
      summary: `存在 ${acceptedUnpublishedCount} 条已 accepted 但尚未 publish 的 suggestion。`,
    });
  }
  if (checkpointPendingCount > 0) {
    signals.push({
      code: "governance_pending_checkpoint",
      severity: "warn",
      summary: `存在 ${checkpointPendingCount} 条待处理 checkpoint approval。`,
    });
  }
  if (checkpointOverdueCount > 0) {
    signals.push({
      code: "governance_overdue_checkpoint",
      severity: "warn",
      summary: `存在 ${checkpointOverdueCount} 条超 SLA 的 checkpoint approval。`,
    });
  }
  if (signals.length <= 0) {
    signals.push({
      code: "governance_queue_clear",
      severity: "info",
      summary: "当前治理队列没有待处理 review / checkpoint / publish 项。",
    });
  }
  return buildMemoryFreshnessItem({
    memoryClass: "governance",
    status,
    lastUpdatedAt: governance.generatedAt,
    freshnessSignals: signals,
    freshnessHeadline: status === "review_required"
      ? "当前治理队列存在待收口项"
      : "当前治理队列状态稳定",
  });
}

export function buildGovernanceFreshnessFromInventory(input: {
  governance?: MemorySourceInventoryGovernanceSummary;
  generatedAt?: string;
  reportRecord?: Pick<MemoryTreeReportRecord, "status" | "createdAt" | "updatedAt"> | null;
}, options: BuildOptions = {}): MemoryFreshnessItemView | undefined {
  if (!input.governance && !input.generatedAt && !input.reportRecord) {
    return undefined;
  }
  const lastUpdatedAt = readLatestIso([
    input.reportRecord?.updatedAt,
    input.generatedAt,
    input.reportRecord?.createdAt,
  ]);
  const suggestedReviewFamilyCount = Number(input.governance?.suggestedReviewFamilyCount) || 0;
  const highRiskFamilyCount = Number(input.governance?.highRiskFamilyCount) || 0;
  const ageStatus = resolveAgeStatus(lastUpdatedAt, options.nowMs, 7, 30);
  let status: MemoryFreshnessStatus = ageStatus;
  if (input.reportRecord?.status === "superseded") {
    status = "superseded";
  } else if (
    input.reportRecord?.status === "ready"
    || suggestedReviewFamilyCount > 0
    || highRiskFamilyCount > 0
  ) {
    status = "review_required";
  } else if (input.reportRecord?.status === "approved" || input.reportRecord?.status === "applied") {
    status = "fresh";
  }
  const signals: MemoryFreshnessSignalView[] = [];
  if (suggestedReviewFamilyCount > 0) {
    signals.push({
      code: "inventory_review_required",
      severity: "warn",
      summary: `存在 ${suggestedReviewFamilyCount} 个 source family 需要 review。`,
    });
  }
  if (highRiskFamilyCount > 0) {
    signals.push({
      code: "inventory_high_risk_family",
      severity: "warn",
      summary: `存在 ${highRiskFamilyCount} 个高风险 source family。`,
    });
  }
  if (input.reportRecord?.status === "superseded") {
    signals.push({
      code: "inventory_report_superseded",
      severity: "warn",
      summary: "当前 inventory governance report 已被 supersede。",
    });
  }
  if (signals.length <= 0) {
    signals.push({
      code: "inventory_governance_stable",
      severity: "info",
      summary: "当前 inventory governance 没有显式 review / supersede 压力。",
    });
  }
  return buildMemoryFreshnessItem({
    memoryClass: "governance",
    status,
    lastUpdatedAt,
    freshnessSignals: signals,
    freshnessHeadline: status === "review_required"
      ? "当前 inventory governance 需要 review 收口"
      : status === "superseded"
        ? "当前 inventory governance report 已被 supersede"
        : "当前 inventory governance 状态稳定",
  });
}

export function buildMemoryFreshnessFromInventoryDoctorReport(
  report: MemorySourceInventoryDoctorReport | undefined,
  options: BuildOptions = {},
): MemoryFreshnessView {
  return buildMemoryFreshnessView({
    items: [
      buildProjectSemanticFreshnessFromInventory({
        governance: report?.summary,
        generatedAt: report?.generatedAt,
        note: "仅观测到 project semantic 的派生 inventory/tree 读面，本批未补 project truth state。",
      }, options),
      buildGovernanceFreshnessFromInventory({
        governance: report?.summary,
        generatedAt: report?.generatedAt,
      }, options),
    ],
  });
}

function buildProceduralExperienceFreshnessFromSkillFreshness(
  skillFreshness: SkillFreshnessAssessment,
  candidate?: ExperienceCandidate,
): MemoryFreshnessItemView {
  let status: MemoryFreshnessStatus;
  switch (skillFreshness.status) {
    case "warn_stale":
      status = "stale";
      break;
    case "needs_patch":
    case "needs_new_skill":
      status = "review_required";
      break;
    default:
      status = "fresh";
      break;
  }
  return buildMemoryFreshnessItem({
    memoryClass: "procedural_experience",
    status,
    lastUpdatedAt: readLatestIso([candidate?.acceptedAt, candidate?.reviewedAt, candidate?.createdAt]),
    lastUsedAt: skillFreshness.usage?.lastUsedAt,
    reviewedAt: candidate?.reviewedAt ?? candidate?.acceptedAt,
    freshnessSignals: skillFreshness.signals.map((item) => ({
      code: item.code,
      severity: item.severity,
      summary: item.summary,
    })),
    freshnessHeadline: skillFreshness.headline,
  });
}

function buildMemoryFreshnessItem(input: BuildItemInput): MemoryFreshnessItemView {
  const contract = getMemoryClassContract(input.memoryClass);
  const freshnessSignals = dedupeFreshnessSignals(input.freshnessSignals ?? []);
  const warningSignal = freshnessSignals.find((item) => item.severity === "warn");
  return {
    memoryClass: input.memoryClass,
    label: contract.label,
    status: input.status ?? "active",
    freshnessHeadline: input.freshnessHeadline
      ?? warningSignal?.summary
      ?? `${contract.label} freshness is ${input.status ?? "active"}.`,
    freshnessSignals,
    ...(input.lastUpdatedAt ? { lastUpdatedAt: input.lastUpdatedAt } : {}),
    ...(input.lastConfirmedAt ? { lastConfirmedAt: input.lastConfirmedAt } : {}),
    ...(input.lastUsedAt ? { lastUsedAt: input.lastUsedAt } : {}),
    ...(input.reviewedAt ? { reviewedAt: input.reviewedAt } : {}),
    ...(input.supersededAt ? { supersededAt: input.supersededAt } : {}),
    ...(input.note ? { note: input.note } : {}),
  };
}

function dedupeFreshnessSignals(signals: readonly MemoryFreshnessSignalView[]): MemoryFreshnessSignalView[] {
  const seen = new Set<string>();
  const result: MemoryFreshnessSignalView[] = [];
  for (const signal of signals) {
    const key = `${signal.code}:${signal.summary}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(signal);
  }
  return result;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readMemoryFreshnessItemView(value: unknown): MemoryFreshnessItemView | undefined {
  if (!isObjectRecord(value)) {
    return undefined;
  }
  const memoryClass = normalizeMemoryClass(value.memoryClass);
  if (!memoryClass) {
    return undefined;
  }
  const status = normalizeMemoryFreshnessStatus(value.status);
  const label = readOptionalString(value.label) ?? getMemoryClassContract(memoryClass).label;
  const freshnessSignals = Array.isArray(value.freshnessSignals)
    ? value.freshnessSignals
      .map((signal) => readMemoryFreshnessSignalView(signal))
      .filter((signal): signal is MemoryFreshnessSignalView => Boolean(signal))
    : [];
  return {
    memoryClass,
    label,
    status: status ?? "active",
    freshnessHeadline: readOptionalString(value.freshnessHeadline)
      ?? freshnessSignals.find((item) => item.severity === "warn")?.summary
      ?? `${label} freshness is ${status ?? "active"}.`,
    freshnessSignals,
    ...(readOptionalString(value.lastUpdatedAt) ? { lastUpdatedAt: readOptionalString(value.lastUpdatedAt) } : {}),
    ...(readOptionalString(value.lastConfirmedAt) ? { lastConfirmedAt: readOptionalString(value.lastConfirmedAt) } : {}),
    ...(readOptionalString(value.lastUsedAt) ? { lastUsedAt: readOptionalString(value.lastUsedAt) } : {}),
    ...(readOptionalString(value.reviewedAt) ? { reviewedAt: readOptionalString(value.reviewedAt) } : {}),
    ...(readOptionalString(value.supersededAt) ? { supersededAt: readOptionalString(value.supersededAt) } : {}),
    ...(readOptionalString(value.note) ? { note: readOptionalString(value.note) } : {}),
  };
}

function readMemoryFreshnessSignalView(value: unknown): MemoryFreshnessSignalView | undefined {
  if (!isObjectRecord(value)) {
    return undefined;
  }
  const code = readOptionalString(value.code);
  const summary = readOptionalString(value.summary);
  const severity = value.severity === "warn" ? "warn" : value.severity === "info" ? "info" : undefined;
  if (!code || !summary || !severity) {
    return undefined;
  }
  return {
    code,
    severity,
    summary,
  };
}

function normalizeMemoryClass(value: unknown): MemoryClass | undefined {
  return value === "profile_semantic"
    || value === "project_semantic"
    || value === "episodic_task"
    || value === "procedural_experience"
    || value === "governance"
    ? value
    : undefined;
}

function normalizeMemoryFreshnessStatus(value: unknown): MemoryFreshnessStatus | undefined {
  return value === "fresh"
    || value === "active"
    || value === "stale"
    || value === "superseded"
    || value === "review_required"
    ? value
    : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readOptionalFiniteInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : undefined;
}

function resolveAgeStatus(
  iso: string | undefined,
  nowMs = Date.now(),
  freshWithinDays?: number,
  staleAfterDays?: number,
): Extract<MemoryFreshnessStatus, "fresh" | "active" | "stale"> {
  const ageDays = readAgeDays(iso, nowMs);
  if (ageDays === undefined) {
    return "active";
  }
  if (Number.isFinite(staleAfterDays) && ageDays >= Number(staleAfterDays)) {
    return "stale";
  }
  if (Number.isFinite(freshWithinDays) && ageDays <= Number(freshWithinDays)) {
    return "fresh";
  }
  return "active";
}

function readAgeDays(iso: string | undefined, nowMs: number): number | undefined {
  const timestamp = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }
  return (nowMs - timestamp) / (1000 * 60 * 60 * 24);
}

function readLatestIso(values: Array<string | undefined>): string | undefined {
  let bestValue: string | undefined;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    const timestamp = Date.parse(String(value ?? ""));
    if (!Number.isFinite(timestamp) || timestamp < bestMs) {
      continue;
    }
    bestMs = timestamp;
    bestValue = value;
  }
  return bestValue;
}

export function readLatestUsageAt(items: ExperienceUsageSummary[]): string | undefined {
  return readLatestIso(items.map((item) => item.lastUsedAt ?? item.createdAt));
}
