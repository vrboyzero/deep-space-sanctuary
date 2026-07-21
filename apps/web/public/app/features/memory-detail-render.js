import { extractTaskContextTargets } from "./memory-viewer.js";
import {
  formatResidentSourceScopeLabel,
  getResidentSourceBadgeClass,
} from "./memory-source-view.js";
import {
  formatSkillFreshnessStatusLabel,
  getSkillFreshnessBadgeClass,
} from "./skill-freshness-view.js";
import { isCompactGovernanceDetailMode } from "./governance-detail-mode.js";
import { createMemoryDetailPathListenerLifecycle } from "./memory-detail-path-listener-lifecycle.js";
import { createMemoryDetailSourceExplanationLifecycle } from "./memory-detail-source-explanation-lifecycle.js";
import { createMemoryDetailStatsListenerLifecycle } from "./memory-detail-stats-listener-lifecycle.js";
import { createMemoryDetailTaskAuditListenerLifecycle } from "./memory-detail-task-audit-listener-lifecycle.js";
import { createMemoryDetailTaskDetailView } from "./memory-detail-task-detail-view.js";
import { createMemoryDetailUsageRevokeAction } from "./memory-detail-usage-revoke-action.js";
import { createMemoryDetailUsageRevokeListenerLifecycle } from "./memory-detail-usage-revoke-listener-lifecycle.js";

export function buildTaskSourceExplanationItems(
  explanation,
  t = (_key, _params, fallback) => fallback ?? "",
) {
  const refs = Array.isArray(explanation?.sourceRefs) ? explanation.sourceRefs : [];
  return refs
    .map((item) => {
      const label = formatTaskSourceReferenceLabel(item?.kind, item?.label, t);
      const previews = Array.isArray(item?.previews)
        ? item.previews
          .map((value) => typeof value === "string" ? value.trim() : "")
          .filter(Boolean)
        : [];
      const activityIds = Array.isArray(item?.activityIds)
        ? item.activityIds
          .map((value) => typeof value === "string" ? value.trim() : "")
          .filter(Boolean)
        : [];
      if (!label && !previews.length && !activityIds.length) {
        return null;
      }
      return {
        kind: typeof item?.kind === "string" ? item.kind : "",
        label,
        previews,
        activityIds,
      };
    })
    .filter(Boolean);
}

export function buildTaskSourceActivityReference(
  activityIds,
  t = (_key, _params, fallback) => fallback ?? "",
) {
  const normalized = Array.isArray(activityIds)
    ? activityIds
      .map((value) => typeof value === "string" ? value.trim() : "")
      .filter(Boolean)
    : [];
  if (!normalized.length) return null;
  return {
    activityIds: normalized,
    badgeLabel: t("memory.taskSourceRefActivities", { count: String(normalized.length) }, `活动 ${normalized.length}`),
    title: t("memory.taskSourceActivityIds", { ids: normalized.join(", ") }, `Activity IDs: ${normalized.join(", ")}`),
  };
}

function formatTaskSourceReferenceLabel(
  kind,
  fallbackLabel,
  t = (_key, _params, fallback) => fallback ?? "",
) {
  switch (kind) {
    case "task_summary":
      return t("memory.taskSourceRefTaskSummary", {}, "任务摘要");
    case "work_recap":
      return t("memory.taskSourceRefWorkRecap", {}, "Work Recap");
    case "resume_context":
      return t("memory.taskSourceRefResumeContext", {}, "Resume Context");
    case "activity_worklog":
      return t("memory.taskSourceRefActivityWorklog", {}, "Activity / Worklog");
    default:
      return typeof fallbackLabel === "string" && fallbackLabel.trim() ? fallbackLabel.trim() : "";
  }
}

export function createMemoryDetailRenderFeature({
  refs,
  isConnected,
  sendReq,
  makeId,
  getMemoryViewerState,
  getMemoryViewerFeature,
  getMemoryRuntimeFeature,
  getGoalDisplayName,
  getCurrentAgentSelection,
  renderMemoryViewerDetailEmpty,
  renderMemoryViewerStats,
  loadTaskUsageOverview,
  loadTaskDetail,
  loadCandidateDetail,
  openExperienceCandidate,
  openTaskFromAudit,
  openMemoryFromAudit,
  openSourcePath,
  loadGoals,
  switchMode,
  openGoalTaskViewer,
  showNotice,
  formatDateTime,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const {
    memoryViewerDetailEl,
    memoryViewerStatsEl,
    memoryChunkCategoryFilterEl,
  } = refs;
  const taskDetailView = createMemoryDetailTaskDetailView({
    t,
    formatDateTime,
    formatDuration,
    formatCount,
    formatUsageVia,
    summarizeSourcePath,
  });
  const sourceExplanationLifecycle = createMemoryDetailSourceExplanationLifecycle({
    isConnected,
    sendReq,
    makeId,
    getMemoryViewerState,
    getCurrentAgentSelection,
    renderTaskDetail: (task) => renderTaskDetail(task),
    showNotice,
    t,
  });
  const usageRevokeAction = createMemoryDetailUsageRevokeAction({
    getState: getMemoryViewerState,
    isConnected,
    sendReq,
    makeId,
    getActiveAgentId: getCurrentAgentSelection,
    showNotice,
    renderTaskDetail: (task) => renderTaskDetail(task),
    renderMemoryViewerStats,
    loadTaskUsageOverview,
    loadTaskDetail,
    t,
  });
  const statsListenerLifecycle = createMemoryDetailStatsListenerLifecycle({
    openTaskFromAudit,
    openSourcePath,
    loadCandidateDetail,
    switchMode,
    loadGoals,
  });
  const pathListenerLifecycle = createMemoryDetailPathListenerLifecycle({ openSourcePath });
  const taskAuditListenerLifecycle = createMemoryDetailTaskAuditListenerLifecycle({
    getState: getMemoryViewerStateValue,
    getMemoryRuntimeFeature: getMemoryRuntimeFeatureValue,
    openTaskFromAudit,
    loadCandidateDetail,
    openExperienceCandidate,
    switchMode,
    loadGoals,
    openGoalTaskViewer,
    renderTaskDetail: (task) => renderTaskDetail(task),
    renderDetailEmpty: renderMemoryViewerDetailEmpty,
    openMemoryFromAudit,
    loadTaskSourceExplanation: (taskId, conversationId) => loadTaskSourceExplanation(taskId, conversationId),
    t,
  });
  const usageRevokeListenerLifecycle = createMemoryDetailUsageRevokeListenerLifecycle({
    getState: getMemoryViewerState,
    confirmAction: (message) => window.confirm(message),
    revokeTaskUsage: (usageId, taskId, assetKey) => revokeTaskUsage(usageId, taskId, assetKey),
    t,
  });

  function getMemoryViewerStateValue() {
    return getMemoryViewerState?.() ?? {};
  }

  function getMemoryViewerFeatureValue() {
    return getMemoryViewerFeature?.() ?? null;
  }

  function getMemoryRuntimeFeatureValue() {
    return getMemoryRuntimeFeature?.() ?? null;
  }

  function getTaskGoalId(task) {
    const goalId = task?.metadata?.goalId;
    return typeof goalId === "string" && goalId.trim() ? goalId.trim() : "";
  }

  function summarizeSourcePath(sourcePath) {
    if (!sourcePath) return "(unknown source)";
    const normalized = String(sourcePath).replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length <= 3) return normalized;
    return parts.slice(-3).join("/");
  }

  function formatDuration(ms) {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "-";
    if (ms < 1000) return `${Math.round(ms)} ms`;
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} s`;
    const minutes = Math.floor(seconds / 60);
    const remainSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainSeconds}s`;
  }

  function formatLineRange(startLine, endLine) {
    if (typeof startLine === "number" && typeof endLine === "number") return `${startLine}-${endLine}`;
    if (typeof startLine === "number") return String(startLine);
    return "-";
  }

  function formatScore(score) {
    if (typeof score !== "number" || !Number.isFinite(score)) return "--";
    return score.toFixed(3);
  }

  function normalizeMemoryVisibility(value) {
    return value === "shared" ? "shared" : "private";
  }

  function formatMemoryCategory(value) {
    switch (value) {
      case "preference":
        return t("memory.filters.categoryPreference", {}, "Preference");
      case "experience":
        return t("memory.filters.categoryExperience", {}, "Experience");
      case "fact":
        return t("memory.filters.categoryFact", {}, "Fact");
      case "decision":
        return t("memory.filters.categoryDecision", {}, "Decision");
      case "entity":
        return t("memory.filters.categoryEntity", {}, "Entity");
      case "other":
        return t("memory.filters.categoryOther", {}, "Other");
      default:
        return t("memory.filters.categoryUncategorized", {}, "Uncategorized");
    }
  }

  function getActiveMemoryCategoryLabel() {
    const value = memoryChunkCategoryFilterEl?.value || "";
    if (!value) return t("memory.filters.categoryAll", {}, "All Categories");
    if (value === "uncategorized") return t("memory.filters.categoryUncategorized", {}, "Uncategorized");
    return formatMemoryCategory(value);
  }

  function formatCount(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "--";
    return new Intl.NumberFormat("zh-CN").format(value);
  }

  function getLatestExperienceUsageTimestamp(...groups) {
    const timestamps = groups
      .flat()
      .map((item) => item?.createdAt || item?.lastUsedAt)
      .filter(Boolean)
      .map((value) => new Date(value).getTime())
      .filter((value) => Number.isFinite(value));
    if (!timestamps.length) return undefined;
    return new Date(Math.max(...timestamps)).toISOString();
  }

  function formatUsageVia(value) {
    switch (value) {
      case "tool":
        return "tool";
      case "search":
        return "search";
      case "auto_suggest":
        return "auto";
      default:
        return "manual";
    }
  }

  function getMemoryCategoryDistributionEntries(stats) {
    const buckets = stats?.categoryBuckets || {};
    const ordered = [
      { key: "preference", label: t("memory.filters.categoryPreference", {}, "Preference"), count: buckets.preference || 0 },
      { key: "experience", label: t("memory.filters.categoryExperience", {}, "Experience"), count: buckets.experience || 0 },
      { key: "fact", label: t("memory.filters.categoryFact", {}, "Fact"), count: buckets.fact || 0 },
      { key: "decision", label: t("memory.filters.categoryDecision", {}, "Decision"), count: buckets.decision || 0 },
      { key: "entity", label: t("memory.filters.categoryEntity", {}, "Entity"), count: buckets.entity || 0 },
      { key: "other", label: t("memory.filters.categoryOther", {}, "Other"), count: buckets.other || 0 },
      { key: "uncategorized", label: t("memory.filters.categoryUncategorized", {}, "Uncategorized"), count: stats?.uncategorized || 0 },
    ];
    return ordered.filter((entry) => entry.count > 0);
  }

  function getVisibilityBadgeClass(visibility) {
    return visibility === "shared" ? "memory-badge-shared" : "memory-badge-private";
  }

  function getMemoryCategoryDistributionViewModel(stats) {
    const entries = getMemoryCategoryDistributionEntries(stats);
    const label = t("memory.categoryDistributionTitle", {}, "Category Distribution");
    if (!entries.length) {
      return {
        label,
        caption: t("memory.categoryDistributionEmpty", {}, "No categorized samples"),
        rows: [],
      };
    }

    const total = entries.reduce((sum, entry) => sum + entry.count, 0);
    const activeKey = memoryChunkCategoryFilterEl?.value || "";
    return {
      label,
      caption: t("memory.categoryDistributionTotal", { total: formatCount(total) }, `Library ${formatCount(total)}`),
      rows: entries.map((entry) => {
        const percent = total > 0 ? (entry.count / total) * 100 : 0;
        return {
          key: entry.key,
          label: entry.label,
          count: formatCount(entry.count),
          percent: `${percent.toFixed(percent >= 10 ? 0 : 1)}%`,
          widthPercent: Number(Math.max(percent, entry.count > 0 ? 3 : 0).toFixed(2)),
          active: activeKey === entry.key,
        };
      }),
    };
  }

  function createTaskUsageOverviewLaneViewModel(title, items, tone) {
    const safeItems = Array.isArray(items) ? items : [];
    const normalizedTone = tone === "skill" ? "skill" : "method";
    const emptyLabel = t("memory.usageOverviewEmptyLane", {}, "No records");
    if (!safeItems.length) {
      return {
        tone: normalizedTone,
        title,
        topLabel: "",
        emptyLabel,
        items: [],
      };
    }

    const maxCount = safeItems.reduce((max, item) => Math.max(max, Number(item?.usageCount) || 0), 0);
    return {
      tone: normalizedTone,
      title,
      topLabel: `Top ${formatCount(safeItems.length)}`,
      emptyLabel,
      items: safeItems.map((item) => {
        const usageCount = Number(item?.usageCount) || 0;
        const percent = maxCount > 0 ? (usageCount / maxCount) * 100 : 0;
        const sourceView = item?.sourceView || null;
        const skillFreshness = normalizedTone === "skill" && item?.skillFreshness ? item.skillFreshness : null;
        return {
          assetKey: item?.assetKey || "-",
          meta: [
            item?.sourceCandidateId ? `candidate ${item.sourceCandidateId}` : "",
            item?.sourceCandidateTitle || "",
            skillFreshness ? formatSkillFreshnessStatusLabel(skillFreshness.status, t) : "",
            sourceView ? formatResidentSourceScopeLabel(sourceView) : "",
            `${t("memory.usageOverviewRecentAt", {}, "Recent")} ${formatDateTime(item?.lastUsedAt)}`,
          ].filter(Boolean),
          badges: [
            skillFreshness
              ? {
                className: `memory-badge ${getSkillFreshnessBadgeClass(skillFreshness.status)}`,
                label: formatSkillFreshnessStatusLabel(skillFreshness.status, t),
              }
              : null,
            sourceView
              ? {
                className: `memory-badge ${getResidentSourceBadgeClass(sourceView)}`,
                label: formatResidentSourceScopeLabel(sourceView),
              }
              : null,
          ].filter(Boolean),
          actions: [
            item?.sourceCandidateId
              ? { kind: "candidate", value: item.sourceCandidateId, label: t("memory.openCandidate", {}, "Candidate") }
              : null,
            item?.lastUsedTaskId
              ? { kind: "task", value: item.lastUsedTaskId, label: t("memory.openRecentTask", {}, "Recent Task") }
              : null,
            item?.sourceCandidatePublishedPath
              ? { kind: "source", value: item.sourceCandidatePublishedPath, label: t("memory.openArtifact", {}, "Open Artifact") }
              : null,
          ].filter(Boolean),
          barPercent: Math.min(100, Math.max(0, Number(Math.max(percent, usageCount > 0 ? 10 : 0).toFixed(2)))),
          metrics: formatCount(usageCount),
        };
      }),
    };
  }


  function getTaskUsageOverviewViewModel() {
    const memoryViewerState = getMemoryViewerStateValue();
    const overview = memoryViewerState.usageOverview || {};
    const methods = Array.isArray(overview.methods) ? overview.methods : [];
    const skills = Array.isArray(overview.skills) ? overview.skills : [];
    const loading = Boolean(overview.loading);
    const showLanes = loading || methods.length > 0 || skills.length > 0;
    return {
      title: t("memory.usageOverviewTitle", {}, "Experience Usage Overview"),
      caption: loading
        ? t("memory.usageOverviewLoading", {}, "Refreshing statistics…")
        : showLanes
          ? t("memory.usageOverviewCaption", {}, "Shown by cumulative global usage count")
          : t("memory.usageOverviewEmpty", {}, "No usage data yet"),
      showLanes,
      lanes: showLanes
        ? [
          createTaskUsageOverviewLaneViewModel(t("memory.usageOverviewHotMethods", {}, "Hot Methods"), methods, "method"),
          createTaskUsageOverviewLaneViewModel(t("memory.usageOverviewHotSkills", {}, "Hot Skills"), skills, "skill"),
        ]
        : [],
    };
  }

  function createCandidateDetailPanel(candidate, ownerDocument) {
    return getMemoryViewerFeatureValue()?.createCandidateDetailPanel(candidate, ownerDocument) || null;
  }

  async function loadTaskSourceExplanation(taskId, conversationId = "") {
    return sourceExplanationLifecycle.loadTaskSourceExplanation(taskId, conversationId);
  }

  function renderTaskDetail(task) {
    if (!memoryViewerDetailEl) return;
    const memoryViewerState = getMemoryViewerStateValue();
    if (!task) {
      renderMemoryViewerDetailEmpty(t("memory.taskMissing", {}, "Task not found."));
      return;
    }

    const usedMethods = Array.isArray(task.usedMethods) ? task.usedMethods : [];
    const usedSkills = Array.isArray(task.usedSkills) ? task.usedSkills : [];
    const lastUsageAt = getLatestExperienceUsageTimestamp(usedMethods, usedSkills);
    const candidatePanel = createCandidateDetailPanel(
      memoryViewerState.selectedCandidate,
      memoryViewerDetailEl.ownerDocument,
    );
    const goalId = getTaskGoalId(task);
    const contextTargets = extractTaskContextTargets(task);
    const sourceExplanation = task.sourceExplanation || null;
    const sourceExplanationItems = buildTaskSourceExplanationItems(sourceExplanation, t).map((item) => ({
      ...item,
      activityReference: buildTaskSourceActivityReference(item.activityIds, t),
    }));
    const sourceExplanationLoading = task.sourceExplanationLoading === true;
    const sourceExplanationError = typeof task.sourceExplanationError === "string" ? task.sourceExplanationError.trim() : "";
    const sourceExplanationUpdatedAt = sourceExplanation?.updatedAt ? formatDateTime(sourceExplanation.updatedAt) : "";
    const hasLoadedSourceExplanation = Boolean(sourceExplanation && sourceExplanation.taskId === task.id);
    const pendingActionKey = typeof memoryViewerState.pendingExperienceActionKey === "string"
      ? memoryViewerState.pendingExperienceActionKey
      : "";
    const compactGovernanceDetailMode = isCompactGovernanceDetailMode();

    taskDetailView.render({
      container: memoryViewerDetailEl,
      task,
      candidatePanel,
      goalId,
      goalDisplayName: goalId ? getGoalDisplayName(goalId) : "",
      contextTargets,
      sourceExplanationItems,
      sourceExplanationLoading,
      sourceExplanationError,
      sourceExplanationUpdatedAt,
      hasLoadedSourceExplanation,
      pendingActionKey,
      pendingUsageRevokeId: memoryViewerState.pendingUsageRevokeId || "",
      selectedCandidate: memoryViewerState.selectedCandidate || null,
      lastUsageAt,
      compact: compactGovernanceDetailMode,
    });
    bindMemoryPathLinks();
    bindTaskAuditJumpLinks();
    bindTaskUsageRevokeButtons(task);
  }

  function bindMemoryPathLinks() {
    pathListenerLifecycle.bindMemoryPathLinks(memoryViewerDetailEl);
  }

  function bindStatsAuditJumpLinks() {
    statsListenerLifecycle.bindStatsAuditJumpLinks(memoryViewerStatsEl);
  }

  function bindTaskAuditJumpLinks() {
    taskAuditListenerLifecycle.bindTaskAuditJumpLinks(memoryViewerDetailEl);
  }

  function bindTaskUsageRevokeButtons(task) {
    usageRevokeListenerLifecycle.bindTaskUsageRevokeButtons(memoryViewerDetailEl, task?.id);
  }

  async function revokeTaskUsage(usageId, taskId, assetKey = "") {
    return usageRevokeAction.revoke(usageId, taskId, assetKey);
  }

  function clearGeneration() {
    sourceExplanationLifecycle.clearGeneration();
    usageRevokeAction.clearGeneration();
  }

  function dispose() {
    sourceExplanationLifecycle.dispose();
    usageRevokeAction.dispose();
    statsListenerLifecycle.dispose();
    pathListenerLifecycle.dispose();
    taskAuditListenerLifecycle.dispose();
    usageRevokeListenerLifecycle.dispose();
  }

  function getRuntimeSnapshot() {
    return {
      ...sourceExplanationLifecycle.getRuntimeSnapshot(),
      ...usageRevokeAction.getRuntimeSnapshot(),
      ...statsListenerLifecycle.getRuntimeSnapshot(),
      ...pathListenerLifecycle.getRuntimeSnapshot(),
      ...taskAuditListenerLifecycle.getRuntimeSnapshot(),
      ...usageRevokeListenerLifecycle.getRuntimeSnapshot(),
    };
  }

  return {
    bindMemoryPathLinks,
    bindStatsAuditJumpLinks,
    bindTaskAuditJumpLinks,
    formatCount,
    formatDuration,
    formatLineRange,
    formatMemoryCategory,
    formatScore,
    getActiveMemoryCategoryLabel,
    getLatestExperienceUsageTimestamp,
    getTaskGoalId,
    getVisibilityBadgeClass,
    normalizeMemoryVisibility,
    getMemoryCategoryDistributionViewModel,
    renderTaskDetail,
    getTaskUsageOverviewViewModel,
    revokeTaskUsage,
    summarizeSourcePath,
    buildTaskSourceExplanationItems,
    clearGeneration,
    dispose,
    getRuntimeSnapshot,
  };
}
