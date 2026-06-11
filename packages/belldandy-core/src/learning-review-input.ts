import type { ExperienceCandidate, TaskExperienceDetail } from "@belldandy/memory";

import type { GoalReviewGovernanceSummary } from "./goals/types.js";
import {
  buildMemoryClassSignalViews,
  formatMemoryClassSignalCoverage,
  type MemoryClassSignalView,
} from "./memory-class-registry-view.js";
import {
  buildEpisodicTaskFreshnessView,
  buildGovernanceFreshnessFromGoalReview,
  buildMemoryFreshnessView,
  buildProceduralExperienceFreshnessView,
  buildProfileSemanticFreshnessView,
  formatMemoryFreshnessCoverage,
  type MemoryFreshnessView,
} from "./memory-freshness-view.js";
import type { MindProfileSnapshot } from "./mind-profile-snapshot.js";
import type { SkillFreshnessAssessment } from "./skill-freshness.js";

export type LearningReviewInput = {
  summary: {
    available: boolean;
    headline: string;
    memorySignalCount: number;
    taskSignalCount: number;
    candidateSignalCount: number;
    reviewSignalCount: number;
    availableClassCount: number;
    missingClassCount: number;
    nudgeCount: number;
  };
  summaryLines: string[];
  nudges: string[];
  memoryClassSignals: MemoryClassSignalView[];
  memoryFreshness: MemoryFreshnessView;
};

function truncateText(value: string | undefined, maxLength = 140): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 3))}...` : normalized;
}

function dedupeStrings(values: Array<string | undefined>, limit = values.length): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = truncateText(value, 180);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

export function buildLearningReviewInput(input: {
  mindProfileSnapshot?: MindProfileSnapshot;
  taskExperienceDetail?: TaskExperienceDetail;
  experienceCandidate?: ExperienceCandidate;
  experienceCandidateSkillFreshness?: SkillFreshnessAssessment;
  goalReviewGovernanceSummary?: GoalReviewGovernanceSummary;
}): LearningReviewInput {
  const mind = input.mindProfileSnapshot;
  const task = input.taskExperienceDetail;
  const candidate = input.experienceCandidate;
  const governance = input.goalReviewGovernanceSummary;
  const candidateSnapshot = candidate?.sourceTaskSnapshot;
  const taskMemoryLinkCount = Array.isArray(task?.memoryLinks) ? task.memoryLinks.length : 0;
  const taskArtifactCount = Array.isArray(task?.artifactPaths) ? task.artifactPaths.length : 0;
  const taskToolCallCount = Array.isArray(task?.toolCalls) ? task.toolCalls.length : 0;

  const memoryLinkCount = Array.isArray(candidateSnapshot?.memoryLinks) ? candidateSnapshot.memoryLinks.length : 0;
  const artifactCount = Array.isArray(candidateSnapshot?.artifactPaths) ? candidateSnapshot.artifactPaths.length : 0;
  const toolCallCount = Array.isArray(candidateSnapshot?.toolCalls) ? candidateSnapshot.toolCalls.length : 0;
  const privateMemoryCount = Number(mind?.memory.privateMemoryCount) || 0;
  const sharedMemoryCount = Number(mind?.memory.sharedMemoryCount) || 0;
  const acceptedUnpublishedCount = Array.isArray(governance?.actionableReviews)
    ? governance.actionableReviews.filter((item) => item.status === "accepted").length
    : 0;
  const pendingReviewCount = Number(governance?.reviewStatusCounts?.pending_review) || 0;
  const needsRevisionCount = Number(governance?.reviewStatusCounts?.needs_revision) || 0;
  const overdueReviewCount = Number(governance?.workflowOverdueCount) || 0;
  const memoryClassSignals = buildMemoryClassSignalViews({
    presentClasses: [
      ...(mind ? ["profile_semantic" as const] : []),
      ...(task ? ["episodic_task" as const] : []),
      ...(candidate ? ["procedural_experience" as const] : []),
      ...(governance ? ["governance" as const] : []),
    ],
    partialClasses: [
      ...(!candidate && (Number(mind?.summary.usageLinkedCount) || 0) > 0 ? ["procedural_experience" as const] : []),
    ],
    noteByClass: {
      profile_semantic: mind
        ? mind.summary.hasUserProfile
          ? "Mind profile snapshot is anchored by canonical profile state."
          : "Mind profile snapshot exists, but the explicit user profile anchor is still weak."
        : "Mind profile snapshot is not attached.",
      project_semantic: "Current learning/review input still does not attach an explicit project semantic signal.",
      episodic_task: task
        ? `Task detail is attached with memories=${taskMemoryLinkCount}, tools=${taskToolCallCount}, artifacts=${taskArtifactCount}.`
        : "Task detail is not attached.",
      procedural_experience: candidate
        ? `${candidate.type} candidate is attached as the current procedural experience signal.`
        : (Number(mind?.summary.usageLinkedCount) || 0) > 0
          ? "Only usage-linked experience traces are attached; no explicit candidate is attached yet."
          : "No procedural experience signal is attached.",
      governance: governance
        ? `Governance summary is attached with pending=${pendingReviewCount}, overdue=${overdueReviewCount}.`
        : "Governance summary is not attached.",
    },
  });
  const availableClassCount = memoryClassSignals.filter((item) => item.status === "available").length;
  const missingClassCount = memoryClassSignals.filter((item) => item.status === "missing").length;
  const memoryFreshness = buildMemoryFreshnessView({
    items: [
      buildProfileSemanticFreshnessView(mind),
      buildEpisodicTaskFreshnessView(task),
      buildProceduralExperienceFreshnessView({
        candidate,
        skillFreshness: input.experienceCandidateSkillFreshness,
        usageLinkedCount: !candidate ? Number(mind?.summary.usageLinkedCount) || 0 : 0,
      }),
      buildGovernanceFreshnessFromGoalReview(governance),
    ],
  });

  const summaryLines = dedupeStrings([
    mind?.profile.headline ? `Mind snapshot: ${mind.profile.headline}` : undefined,
    (mind?.profile.treeSummaryLines?.[0] || mind?.profile.summaryLines?.[0])
      ? `Profile anchor: ${mind?.profile.treeSummaryLines?.[0] || mind?.profile.summaryLines?.[0]}`
      : undefined,
    mind?.experience.topUsageResidents?.[0]?.headline ? `Experience anchor: ${mind.experience.topUsageResidents[0].headline}` : undefined,
    task
      ? `Task evidence: status=${task.status}, memories=${taskMemoryLinkCount}, tools=${taskToolCallCount}, artifacts=${taskArtifactCount}${task.summary ? `, summary=${truncateText(task.summary, 96)}` : ""}`
      : undefined,
    candidate
      ? `${candidate.type} candidate: memories=${memoryLinkCount}, tools=${toolCallCount}, artifacts=${artifactCount}${candidate.summary ? `, summary=${truncateText(candidate.summary, 96)}` : ""}`
      : undefined,
    governance
      ? `Review queue: pending=${pendingReviewCount}, overdue=${overdueReviewCount}, accepted-unpublished=${acceptedUnpublishedCount}, needs_revision=${needsRevisionCount}`
      : undefined,
    governance?.recommendations?.[0] ? `Review focus: ${governance.recommendations[0]}` : undefined,
    memoryClassSignals.length > 0
      ? `Classed signals: ${formatMemoryClassSignalCoverage(memoryClassSignals)}`
      : undefined,
    memoryFreshness.summary.available
      ? `Freshness: ${formatMemoryFreshnessCoverage(memoryFreshness.items)}`
      : undefined,
  ], 7);

  const nudges = dedupeStrings([
    mind && !mind.identity.hasUserProfile
      ? "建议先补 USER.md，避免 learning/review 缺少稳定用户画像锚点。"
      : undefined,
    mind && privateMemoryCount + sharedMemoryCount <= 1
      ? "当前 durable memory 信号偏弱；复杂任务后优先补 durable fact / preference。"
      : undefined,
    mind && (Number(mind.summary.usageLinkedCount) || 0) > 0
      ? "优先回顾高频 methods/skills 的最新 usage。"
      : undefined,
    task && taskMemoryLinkCount <= 0
      ? "当前任务缺少 source memory links；若要沉淀经验，优先补证据链。"
      : undefined,
    task && taskToolCallCount <= 0 && taskArtifactCount <= 0
      ? "当前任务工具/产物信号偏弱；若要生成经验候选，先确认是否真的形成了可复用执行路径。"
      : undefined,
    candidate && memoryLinkCount <= 0
      ? "当前候选缺少 source memory links，审阅时优先补证据再决定。"
      : undefined,
    candidate?.type === "method" && toolCallCount <= 0
      ? "当前 method candidate 缺少工具调用证据，需核对步骤是否来自真实执行记录。"
      : undefined,
    candidate?.type === "skill"
      ? "审阅 skill candidate 时优先核对能力缺口、适用场景与风险约束是否闭合。"
      : undefined,
    governance && overdueReviewCount > 0
      ? "存在超 SLA suggestion review，建议先执行 review scan / escalation。"
      : undefined,
    governance && acceptedUnpublishedCount > 0
      ? "存在已通过但未发布的 suggestion，优先处理 publish 收口。"
      : undefined,
    governance && needsRevisionCount > 0
      ? "存在 needs_revision 的 suggestion，建议先补证据或草稿再推进。"
      : undefined,
    summaryLines.length > 0
      ? "当前输入已具备最小 learning/review 条件，可继续进入 candidate / governance 审阅。"
      : undefined,
  ], 6);

  const memorySignalCount = mind
    ? Number(mind.summary.hasUserProfile ? 1 : 0)
      + Number(privateMemoryCount > 0 ? 1 : 0)
      + Number(sharedMemoryCount > 0 ? 1 : 0)
      + Number((Number(mind.summary.usageLinkedCount) || 0) > 0 ? 1 : 0)
    : 0;
  const taskSignalCount = task
    ? Number(taskMemoryLinkCount > 0 ? 1 : 0)
      + Number(taskToolCallCount > 0 ? 1 : 0)
      + Number(taskArtifactCount > 0 ? 1 : 0)
      + Number(Boolean(task.summary || task.reflection || task.outcome || task.objective) ? 1 : 0)
    : 0;
  const candidateSignalCount = candidate
    ? Number(memoryLinkCount > 0 ? 1 : 0)
      + Number(toolCallCount > 0 ? 1 : 0)
      + Number(artifactCount > 0 ? 1 : 0)
      + Number(candidate.summary ? 1 : 0)
    : 0;
  const reviewSignalCount = governance
    ? Number(pendingReviewCount > 0 ? 1 : 0)
      + Number(overdueReviewCount > 0 ? 1 : 0)
      + Number(acceptedUnpublishedCount > 0 ? 1 : 0)
      + Number(needsRevisionCount > 0 ? 1 : 0)
    : 0;

  const headlineParts = [
    memorySignalCount > 0 ? `memory=${memorySignalCount}` : "",
    taskSignalCount > 0 ? `task=${taskSignalCount}` : "",
    candidateSignalCount > 0 ? `candidate=${candidateSignalCount}` : "",
    reviewSignalCount > 0 ? `review=${reviewSignalCount}` : "",
    memoryClassSignals.length > 0 ? `classes=${availableClassCount}/${memoryClassSignals.length}` : "",
    `nudges=${nudges.length}`,
  ].filter(Boolean);

  return {
    summary: {
      available: summaryLines.length > 0 || nudges.length > 0,
      headline: headlineParts.join(", ") || "learning/review input is empty",
      memorySignalCount,
      taskSignalCount,
      candidateSignalCount,
      reviewSignalCount,
      availableClassCount,
      missingClassCount,
      nudgeCount: nudges.length,
    },
    summaryLines,
    nudges,
    memoryClassSignals,
    memoryFreshness,
  };
}
