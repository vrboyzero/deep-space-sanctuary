import { extractTaskContextTargets } from "./memory-viewer.js";
import {
  formatResidentSourceScopeLabel,
  formatResidentSourceSummary,
  getResidentSourceBadgeClass,
} from "./memory-source-view.js";
import {
  formatSkillFreshnessStatusLabel,
  getSkillFreshnessBadgeClass,
  renderSkillFreshnessDetail,
} from "./skill-freshness-view.js";
import { isCompactGovernanceDetailMode, renderGovernanceFullOnly } from "./governance-detail-mode.js";
import { createMemoryDetailPathListenerLifecycle } from "./memory-detail-path-listener-lifecycle.js";
import { createMemoryDetailSourceExplanationLifecycle } from "./memory-detail-source-explanation-lifecycle.js";
import { createMemoryDetailStatsListenerLifecycle } from "./memory-detail-stats-listener-lifecycle.js";
import { createMemoryDetailTaskAuditListenerLifecycle } from "./memory-detail-task-audit-listener-lifecycle.js";
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
  escapeHtml,
  formatDateTime,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const {
    memoryViewerDetailEl,
    memoryViewerStatsEl,
    memoryChunkCategoryFilterEl,
  } = refs;
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

  function getMemoryCategoryToneClass(key) {
    switch (key) {
      case "preference":
        return "memory-category-bar-preference";
      case "experience":
        return "memory-category-bar-experience";
      case "fact":
        return "memory-category-bar-fact";
      case "decision":
        return "memory-category-bar-decision";
      case "entity":
        return "memory-category-bar-entity";
      case "other":
        return "memory-category-bar-other";
      default:
        return "memory-category-bar-uncategorized";
    }
  }

  function getVisibilityBadgeClass(visibility) {
    return visibility === "shared" ? "memory-badge-shared" : "memory-badge-private";
  }

  function renderMemoryCategoryDistribution(stats) {
    const entries = getMemoryCategoryDistributionEntries(stats);
    if (!entries.length) {
      return `
        <div class="memory-stat-card memory-stat-card-wide">
          <div class="memory-stat-card-head">
            <span class="memory-stat-label">${escapeHtml(t("memory.categoryDistributionTitle", {}, "Category Distribution"))}</span>
            <span class="memory-stat-caption">${escapeHtml(t("memory.categoryDistributionEmpty", {}, "No categorized samples"))}</span>
          </div>
        </div>
      `;
    }

    const total = entries.reduce((sum, entry) => sum + entry.count, 0);
    const activeKey = memoryChunkCategoryFilterEl?.value || "";
    return `
      <div class="memory-stat-card memory-stat-card-wide">
        <div class="memory-stat-card-head">
          <span class="memory-stat-label">${escapeHtml(t("memory.categoryDistributionTitle", {}, "Category Distribution"))}</span>
          <span class="memory-stat-caption">${escapeHtml(t("memory.categoryDistributionTotal", { total: formatCount(total) }, `Library ${formatCount(total)}`))}</span>
        </div>
        <div class="memory-category-chart">
          ${entries.map((entry) => {
            const percent = total > 0 ? (entry.count / total) * 100 : 0;
            const isActive = activeKey === entry.key;
            return `
              <div class="memory-category-row ${isActive ? "active" : ""}">
                <div class="memory-category-name">${escapeHtml(entry.label)}</div>
                <div class="memory-category-bar-track">
                  <div class="memory-category-bar-fill ${getMemoryCategoryToneClass(entry.key)}" style="width:${Math.max(percent, entry.count > 0 ? 3 : 0).toFixed(2)}%"></div>
                </div>
                <div class="memory-category-metrics">
                  <span class="memory-category-count">${formatCount(entry.count)}</span>
                  <span class="memory-category-percent">${percent.toFixed(percent >= 10 ? 0 : 1)}%</span>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  function renderTaskUsageOverviewLane(title, items, tone) {
    const safeItems = Array.isArray(items) ? items : [];
    if (!safeItems.length) {
      return `
        <div class="memory-usage-overview-lane">
          <div class="memory-usage-overview-head">
            <span class="memory-usage-overview-title">${escapeHtml(title)}</span>
          </div>
          <div class="memory-usage-overview-empty">${escapeHtml(t("memory.usageOverviewEmptyLane", {}, "No records"))}</div>
        </div>
      `;
    }

    const maxCount = safeItems.reduce((max, item) => Math.max(max, Number(item?.usageCount) || 0), 0);
    return `
      <div class="memory-usage-overview-lane">
        <div class="memory-usage-overview-head">
          <span class="memory-usage-overview-title">${escapeHtml(title)}</span>
          <span class="memory-stat-caption">Top ${formatCount(safeItems.length)}</span>
        </div>
        <div class="memory-usage-overview-list">
          ${safeItems.map((item) => {
            const usageCount = Number(item?.usageCount) || 0;
            const percent = maxCount > 0 ? (usageCount / maxCount) * 100 : 0;
            const sourceView = item?.sourceView || null;
            const skillFreshness = tone === "skill" && item?.skillFreshness ? item.skillFreshness : null;
            return `
              <div class="memory-usage-overview-row">
                <div class="memory-usage-overview-row-main">
                  <div class="memory-usage-overview-key">${escapeHtml(item?.assetKey || "-")}</div>
                  <div class="memory-usage-overview-meta">
                    ${item?.sourceCandidateId ? `<span>candidate ${escapeHtml(item.sourceCandidateId)}</span>` : ""}
                    ${item?.sourceCandidateTitle ? `<span>${escapeHtml(item.sourceCandidateTitle)}</span>` : ""}
                    ${skillFreshness ? `<span>${escapeHtml(formatSkillFreshnessStatusLabel(skillFreshness.status, t))}</span>` : ""}
                    ${sourceView ? `<span>${escapeHtml(formatResidentSourceScopeLabel(sourceView))}</span>` : ""}
                    <span>${escapeHtml(t("memory.usageOverviewRecentAt", {}, "Recent"))} ${escapeHtml(formatDateTime(item?.lastUsedAt))}</span>
                  </div>
                  <div class="memory-detail-badges">
                    ${skillFreshness ? `<span class="memory-badge ${getSkillFreshnessBadgeClass(skillFreshness.status)}">${escapeHtml(formatSkillFreshnessStatusLabel(skillFreshness.status, t))}</span>` : ""}
                    ${sourceView ? `<span class="memory-badge ${getResidentSourceBadgeClass(sourceView)}">${escapeHtml(formatResidentSourceScopeLabel(sourceView))}</span>` : ""}
                    ${item?.sourceCandidateId ? `<button class="memory-usage-action-btn" data-open-candidate-id="${escapeHtml(item.sourceCandidateId)}">${escapeHtml(t("memory.openCandidate", {}, "Candidate"))}</button>` : ""}
                    ${item?.lastUsedTaskId ? `<button class="memory-usage-action-btn" data-open-task-id="${escapeHtml(item.lastUsedTaskId)}">${escapeHtml(t("memory.openRecentTask", {}, "Recent Task"))}</button>` : ""}
                    ${item?.sourceCandidatePublishedPath ? `<button class="memory-usage-action-btn" data-open-source="${escapeHtml(item.sourceCandidatePublishedPath)}">${escapeHtml(t("memory.openArtifact", {}, "Open Artifact"))}</button>` : ""}
                  </div>
                </div>
                <div class="memory-usage-overview-bar-track">
                  <div class="memory-usage-overview-bar-fill memory-usage-overview-bar-${tone}" style="width:${Math.max(percent, usageCount > 0 ? 10 : 0).toFixed(2)}%"></div>
                </div>
                <div class="memory-usage-overview-metrics">${formatCount(usageCount)}</div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  function renderTaskUsageItems(items, assetType) {
    const memoryViewerState = getMemoryViewerStateValue();
    const safeItems = Array.isArray(items) ? items : [];
    if (!safeItems.length) {
      return `<div class="memory-detail-text">${escapeHtml(t("memory.noUsageRecords", { assetType }, `No ${assetType} usage records.`))}</div>`;
    }

    return `
      <div class="memory-usage-list">
        ${safeItems.map((item) => {
          const sourceView = item?.sourceView || null;
          const skillFreshness = assetType === "skill" && item?.skillFreshness ? item.skillFreshness : null;
          const skillFreshnessTarget = skillFreshness?.sourceCandidateId || skillFreshness?.skillKey || "";
          const skillFreshnessStaleBusy = typeof memoryViewerState.pendingExperienceActionKey === "string"
            && memoryViewerState.pendingExperienceActionKey === `skill-freshness:${skillFreshnessTarget}:${skillFreshness?.manualStaleMark ? "active" : "stale"}`;
          return `
          <div class="memory-usage-item">
            <div class="memory-usage-item-head">
              <div class="memory-usage-item-key">${escapeHtml(item.assetKey || "-")}</div>
              <div class="memory-usage-item-actions">
              <div class="memory-detail-badges">
                ${skillFreshness ? `<span class="memory-badge ${getSkillFreshnessBadgeClass(skillFreshness.status)}">${escapeHtml(formatSkillFreshnessStatusLabel(skillFreshness.status, t))}</span>` : ""}
                ${item.sourceCandidateStatus ? `<span class="memory-badge">${escapeHtml(item.sourceCandidateStatus)}</span>` : ""}
                ${item.sourceCandidateId ? `<span class="memory-badge">candidate ${escapeHtml(item.sourceCandidateId)}</span>` : ""}
                ${sourceView ? `<span class="memory-badge ${getResidentSourceBadgeClass(sourceView)}">${escapeHtml(formatResidentSourceScopeLabel(sourceView))}</span>` : ""}
              </div>
              <div class="memory-detail-badges">
                <span class="memory-badge">${escapeHtml(formatUsageVia(item.usedVia))}</span>
                <span class="memory-badge">${escapeHtml(t("memory.usageCountTotal", {}, "Total"))} ${formatCount(item.usageCount)}</span>
              </div>
              ${item.sourceCandidateId ? `<button class="memory-usage-action-btn" data-open-candidate-id="${escapeHtml(item.sourceCandidateId)}">${escapeHtml(t("memory.openCandidate", {}, "Candidate"))}</button>` : ""}
              ${item.sourceCandidateTaskId ? `<button class="memory-usage-action-btn" data-open-task-id="${escapeHtml(item.sourceCandidateTaskId)}">${escapeHtml(t("memory.usageSourceTask", {}, "Source Task"))}</button>` : ""}
              ${item.sourceCandidatePublishedPath ? `<button class="memory-usage-action-btn" data-open-source="${escapeHtml(item.sourceCandidatePublishedPath)}">${escapeHtml(t("memory.openArtifact", {}, "Open Artifact"))}</button>` : ""}
              ${item.lastUsedTaskId && item.lastUsedTaskId !== item.taskId ? `<button class="memory-usage-action-btn" data-open-task-id="${escapeHtml(item.lastUsedTaskId)}">${escapeHtml(t("memory.usageRecentTask", {}, "Recent Task"))}</button>` : ""}
              <button
                class="memory-usage-action-btn"
                  data-revoke-usage-id="${escapeHtml(item.usageId || "")}"
                  data-revoke-task-id="${escapeHtml(item.taskId || "")}"
                  data-revoke-asset-key="${escapeHtml(item.assetKey || "")}"
                  ${memoryViewerState.pendingUsageRevokeId === item.usageId ? "disabled" : ""}
                >${escapeHtml(memoryViewerState.pendingUsageRevokeId === item.usageId
                  ? t("memory.usageRevoking", {}, "Revoking…")
                  : t("memory.usageRevoke", {}, "Revoke"))}</button>
              </div>
            </div>
            <div class="memory-usage-item-meta">
              <span>usage ${escapeHtml(item.usageId || "-")}</span>
              <span>${escapeHtml(t("memory.usageUsedAtTask", {}, "Used in task"))} ${escapeHtml(formatDateTime(item.createdAt))}</span>
              <span>${escapeHtml(t("memory.usageRecentGlobal", {}, "Global recent"))} ${escapeHtml(formatDateTime(item.lastUsedAt || item.createdAt))}</span>
              ${skillFreshness?.summary ? `<span>${escapeHtml(skillFreshness.summary)}</span>` : ""}
              ${item.sourceCandidateId ? `<span>candidate ${escapeHtml(item.sourceCandidateId)}</span>` : ""}
              ${item.sourceCandidateTitle ? `<span>${escapeHtml(item.sourceCandidateTitle)}</span>` : ""}
              ${sourceView ? `<span>${escapeHtml(formatResidentSourceSummary(sourceView))}</span>` : ""}
              ${item.sourceCandidateTaskId ? `<span>${escapeHtml(t("memory.usageSourceTask", {}, "Source Task"))} ${escapeHtml(item.sourceCandidateTaskId)}</span>` : ""}
              ${item.lastUsedTaskId ? `<span>${escapeHtml(t("memory.usageRecentTask", {}, "Recent Task"))} ${escapeHtml(item.lastUsedTaskId)}</span>` : ""}
            </div>
            ${skillFreshness ? renderSkillFreshnessDetail(skillFreshness, {
              escapeHtml,
              t,
              maxSignals: 2,
              actions: {
                sourceCandidateId: skillFreshness.sourceCandidateId || item.sourceCandidateId || "",
                skillKey: skillFreshness.skillKey || item.assetKey || "",
                taskId: item.taskId || "",
                candidateId: memoryViewerState.selectedCandidate?.taskId === item.taskId
                  ? memoryViewerState.selectedCandidate.id || ""
                  : item.sourceCandidateId || "",
                staleBusy: Boolean(skillFreshnessStaleBusy),
              },
            }) : ""}
          </div>
        `;
        }).join("")}
      </div>
    `;
  }

  function renderTaskUsageOverviewCard() {
    const memoryViewerState = getMemoryViewerStateValue();
    const overview = memoryViewerState.usageOverview || {};
    const methods = Array.isArray(overview.methods) ? overview.methods : [];
    const skills = Array.isArray(overview.skills) ? overview.skills : [];
    const loading = Boolean(overview.loading);

    if (!loading && !methods.length && !skills.length) {
      return `
        <div class="memory-stat-card memory-stat-card-wide memory-usage-overview-card">
          <div class="memory-stat-card-head">
            <span class="memory-stat-label">${escapeHtml(t("memory.usageOverviewTitle", {}, "Experience Usage Overview"))}</span>
            <span class="memory-stat-caption">${escapeHtml(t("memory.usageOverviewEmpty", {}, "No usage data yet"))}</span>
          </div>
        </div>
      `;
    }

    return `
      <div class="memory-stat-card memory-stat-card-wide memory-usage-overview-card">
        <div class="memory-stat-card-head">
          <span class="memory-stat-label">${escapeHtml(t("memory.usageOverviewTitle", {}, "Experience Usage Overview"))}</span>
          <span class="memory-stat-caption">${escapeHtml(loading
            ? t("memory.usageOverviewLoading", {}, "Refreshing statistics…")
            : t("memory.usageOverviewCaption", {}, "Shown by cumulative global usage count"))}</span>
        </div>
        <div class="memory-usage-overview-grid">
          ${renderTaskUsageOverviewLane(t("memory.usageOverviewHotMethods", {}, "Hot Methods"), methods, "method")}
          ${renderTaskUsageOverviewLane(t("memory.usageOverviewHotSkills", {}, "Hot Skills"), skills, "skill")}
        </div>
      </div>
    `;
  }

  function renderCandidateDetailPanel(candidate) {
    return getMemoryViewerFeatureValue()?.renderCandidateDetailPanel(candidate) || "";
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

    const title = task.title || task.objective || task.summary || task.id;
    const activities = Array.isArray(task.activities) ? task.activities : [];
    const toolCalls = Array.isArray(task.toolCalls) ? task.toolCalls : [];
    const memoryLinks = Array.isArray(task.memoryLinks) ? task.memoryLinks : [];
    const artifactPaths = Array.isArray(task.artifactPaths) ? task.artifactPaths : [];
    const workRecap = task.workRecap || null;
    const resumeContext = task.resumeContext || null;
    const usedMethods = Array.isArray(task.usedMethods) ? task.usedMethods : [];
    const usedSkills = Array.isArray(task.usedSkills) ? task.usedSkills : [];
    const lastUsageAt = getLatestExperienceUsageTimestamp(usedMethods, usedSkills);
    const candidatePanel = renderCandidateDetailPanel(memoryViewerState.selectedCandidate);
    const goalId = getTaskGoalId(task);
    const contextTargets = extractTaskContextTargets(task);
    const sourceExplanation = task.sourceExplanation || null;
    const sourceExplanationItems = buildTaskSourceExplanationItems(sourceExplanation, t);
    const sourceExplanationLoading = task.sourceExplanationLoading === true;
    const sourceExplanationError = typeof task.sourceExplanationError === "string" ? task.sourceExplanationError.trim() : "";
    const sourceExplanationUpdatedAt = sourceExplanation?.updatedAt ? formatDateTime(sourceExplanation.updatedAt) : "";
    const hasLoadedSourceExplanation = Boolean(sourceExplanation && sourceExplanation.taskId === task.id);
    const pendingActionKey = typeof memoryViewerState.pendingExperienceActionKey === "string"
      ? memoryViewerState.pendingExperienceActionKey
      : "";
    const generateMethodBusy = pendingActionKey === `generate:method:${task.id}`;
    const generateSkillBusy = pendingActionKey === `generate:skill:${task.id}`;
    const compactGovernanceDetailMode = isCompactGovernanceDetailMode();

    memoryViewerDetailEl.innerHTML = `
      <div class="memory-detail-shell">
        ${renderGovernanceFullOnly(candidatePanel)}
        <div class="memory-detail-header">
          <div>
            <div class="memory-detail-title">${escapeHtml(title)}</div>
            <div class="memory-list-item-meta">
              <span>${escapeHtml(task.id)}</span>
              <span>${escapeHtml(task.conversationId || "-")}</span>
            </div>
          </div>
          <div class="memory-detail-badges">
            <span class="memory-badge">${escapeHtml(task.status || "unknown")}</span>
            <span class="memory-badge">${escapeHtml(task.source || "unknown")}</span>
            ${task.agentId ? `<span class="memory-badge">${escapeHtml(task.agentId)}</span>` : ""}
            ${goalId ? `<span class="memory-badge memory-badge-shared">${escapeHtml(getGoalDisplayName(goalId))}</span>` : ""}
          </div>
        </div>

        <div class="memory-detail-card">
          <div class="goal-summary-header">
            <div>
              <div class="goal-summary-title">${escapeHtml(t("memory.contextSummaryTitle", {}, "上下文链"))}</div>
              <div class="goal-summary-text">${escapeHtml(t("memory.contextSummaryTaskText", {}, "把长期任务、会话、关联记忆与经验候选入口压缩到一处。"))}</div>
            </div>
          </div>
          <div class="memory-detail-badges">
            ${goalId ? `<span class="memory-badge memory-badge-shared">${escapeHtml(getGoalDisplayName(goalId))}</span>` : ""}
            ${task.conversationId ? `<span class="memory-badge">${escapeHtml(t("memory.contextConversation", {}, "会话"))} ${escapeHtml(summarizeSourcePath(task.conversationId))}</span>` : ""}
            <span class="memory-badge">${escapeHtml(t("memory.contextLinkedMemories", {}, "关联记忆"))} ${escapeHtml(String(contextTargets.memoryCount))}</span>
            <span class="memory-badge">${escapeHtml(t("memory.contextCandidates", {}, "经验候选"))} ${escapeHtml(String(contextTargets.candidateCount))}</span>
            <span class="memory-badge">${escapeHtml(t("memory.contextArtifacts", {}, "产物"))} ${escapeHtml(String(contextTargets.artifactCount))}</span>
          </div>
          <div class="goal-detail-actions">
            ${goalId ? `<button class="button" data-open-goal-id="${escapeHtml(goalId)}">${escapeHtml(t("memory.openGoal", {}, "Open Long Task"))}</button>` : ""}
            ${goalId ? `<button class="button goal-inline-action-secondary" data-open-goal-tasks="${escapeHtml(goalId)}">${escapeHtml(t("memory.filterTasksByGoal", {}, "Filter Tasks by Goal"))}</button>` : ""}
            ${contextTargets.firstMemoryId ? `<button class="button goal-inline-action-secondary" data-open-memory-id="${escapeHtml(contextTargets.firstMemoryId)}">${escapeHtml(t("memory.contextOpenFirstMemory", {}, "打开关联记忆"))}</button>` : ""}
            ${contextTargets.firstCandidateId ? `<button class="button goal-inline-action-secondary" data-open-candidate-id="${escapeHtml(contextTargets.firstCandidateId)}">${escapeHtml(t("memory.contextOpenFirstCandidate", {}, "打开经验候选"))}</button>` : ""}
            ${contextTargets.firstCandidateId ? `<button class="button goal-inline-action-secondary" data-open-experience-candidate-id="${escapeHtml(contextTargets.firstCandidateId)}">${escapeHtml(t("memory.contextOpenFirstCandidateWorkbench", {}, "在经验能力中打开"))}</button>` : ""}
            ${contextTargets.firstArtifactPath ? `<button class="button goal-inline-action-secondary" data-open-source="${escapeHtml(contextTargets.firstArtifactPath)}">${escapeHtml(t("memory.contextOpenFirstArtifact", {}, "打开相关产物"))}</button>` : ""}
          </div>
        </div>

        <div class="memory-detail-grid">
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.taskStartTime", {}, "Started At"))}</span><div class="memory-detail-text">${escapeHtml(formatDateTime(task.startedAt))}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.taskEndTime", {}, "Finished At"))}</span><div class="memory-detail-text">${escapeHtml(formatDateTime(task.finishedAt))}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.taskDuration", {}, "Duration"))}</span><div class="memory-detail-text">${escapeHtml(formatDuration(task.durationMs))}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">Token</span><div class="memory-detail-text">${escapeHtml(formatCount(task.tokenTotal))}</div></div>
          ${goalId ? `<div class="memory-detail-card"><span class="memory-detail-label">Goal</span><div class="memory-detail-text">${escapeHtml(getGoalDisplayName(goalId))}</div></div>` : ""}
        </div>

        <div class="memory-detail-grid memory-detail-grid-usage">
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.methodUsageCount", {}, "Method Usage Count"))}</span><div class="memory-detail-text">${escapeHtml(formatCount(usedMethods.length))}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.skillUsageCount", {}, "Skill Usage Count"))}</span><div class="memory-detail-text">${escapeHtml(formatCount(usedSkills.length))}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.statLastUsedAt", {}, "Last Used At"))}</span><div class="memory-detail-text">${escapeHtml(formatDateTime(lastUsageAt))}</div></div>
        </div>

        <div class="memory-detail-card">
          <div class="goal-summary-header">
            <div>
              <div class="goal-summary-title">${escapeHtml(t("memory.experienceActionsTitle", {}, "经验候选操作"))}</div>
              <div class="goal-summary-text">${escapeHtml(t("memory.experienceActionsHint", {}, "从当前任务直接生成 method / skill candidate，并在右侧继续审核。"))}</div>
            </div>
          </div>
          <div class="goal-detail-actions">
            <button
              class="memory-usage-action-btn"
              data-generate-experience-type="method"
              data-generate-experience-task-id="${escapeHtml(task.id || "")}"
              ${generateMethodBusy ? "disabled" : ""}
            >${escapeHtml(generateMethodBusy
              ? t("memory.generateMethodCandidateBusy", {}, "生成 method 中…")
              : t("memory.generateMethodCandidate", {}, "生成 method candidate"))}</button>
            <button
              class="memory-usage-action-btn"
              data-generate-experience-type="skill"
              data-generate-experience-task-id="${escapeHtml(task.id || "")}"
              ${generateSkillBusy ? "disabled" : ""}
            >${escapeHtml(generateSkillBusy
              ? t("memory.generateSkillCandidateBusy", {}, "生成 skill 中…")
              : t("memory.generateSkillCandidate", {}, "生成 skill candidate"))}</button>
          </div>
        </div>

        ${task.objective ? `<div class="memory-detail-card"><span class="memory-detail-label">目标说明</span><div class="memory-detail-text">${escapeHtml(task.objective)}</div></div>` : ""}
        ${task.summary ? `<div class="memory-detail-card"><span class="memory-detail-label">摘要</span><div class="memory-detail-text">${escapeHtml(task.summary)}</div></div>` : ""}
        ${task.outcome ? `<div class="memory-detail-card"><span class="memory-detail-label">结果</span><div class="memory-detail-text">${escapeHtml(task.outcome)}</div></div>` : ""}
        ${!compactGovernanceDetailMode && workRecap ? `
          <div class="memory-detail-card">
            <span class="memory-detail-label">Work Recap</span>
            <div class="memory-detail-text">${escapeHtml(workRecap.headline || "-")}</div>
            ${Array.isArray(workRecap.confirmedFacts) && workRecap.confirmedFacts.length ? `
              <div class="memory-inline-list">
                ${workRecap.confirmedFacts.map((item) => `
                  <div class="memory-inline-item">
                    <div class="memory-detail-text">${escapeHtml(item)}</div>
                  </div>
                `).join("")}
              </div>
            ` : ""}
            ${Array.isArray(workRecap.pendingActions) && workRecap.pendingActions.length ? `
              <div class="memory-detail-label">待继续 / 下一步</div>
              <div class="memory-inline-list">
                ${workRecap.pendingActions.map((item) => `
                  <div class="memory-inline-item">
                    <div class="memory-detail-text">${escapeHtml(item)}</div>
                  </div>
                `).join("")}
              </div>
            ` : ""}
            ${Array.isArray(workRecap.blockers) && workRecap.blockers.length ? `
              <div class="memory-detail-label">Blockers</div>
              <div class="memory-inline-list">
                ${workRecap.blockers.map((item) => `
                  <div class="memory-inline-item">
                    <div class="memory-detail-text">${escapeHtml(item)}</div>
                  </div>
                `).join("")}
              </div>
            ` : ""}
          </div>
        ` : ""}
        ${!compactGovernanceDetailMode && resumeContext ? `
          <div class="memory-detail-card">
            <span class="memory-detail-label">Resume Context</span>
            ${resumeContext.currentStopPoint ? `<div class="memory-detail-text">${escapeHtml(`当前停点：${resumeContext.currentStopPoint}`)}</div>` : ""}
            ${resumeContext.nextStep ? `<div class="memory-detail-text">${escapeHtml(`下一步：${resumeContext.nextStep}`)}</div>` : ""}
            ${Array.isArray(resumeContext.blockers) && resumeContext.blockers.length ? `
              <div class="memory-inline-list">
                ${resumeContext.blockers.map((item) => `
                  <div class="memory-inline-item">
                    <div class="memory-detail-text">${escapeHtml(item)}</div>
                  </div>
                `).join("")}
              </div>
            ` : ""}
          </div>
        ` : ""}
        ${renderGovernanceFullOnly(`
        <div class="memory-detail-card">
          <div class="goal-summary-header">
            <div>
              <div class="goal-summary-title">${escapeHtml(t("memory.taskSourceExplanationTitle", {}, "来源解释"))}</div>
              <div class="goal-summary-text">${escapeHtml(t("memory.taskSourceExplanationHint", {}, "按需查看当前 stop / recap / recent activity 分别来自哪一层任务记忆。"))}</div>
            </div>
            <div class="memory-detail-badges">
              ${hasLoadedSourceExplanation ? `<span class="memory-badge">${escapeHtml(t("memory.taskSourceExplanationSourceCount", { count: String(sourceExplanationItems.length) }, `来源 ${sourceExplanationItems.length}`))}</span>` : ""}
              ${sourceExplanationUpdatedAt ? `<span class="memory-badge">${escapeHtml(t("memory.taskSourceExplanationUpdatedAt", { time: sourceExplanationUpdatedAt }, `更新于 ${sourceExplanationUpdatedAt}`))}</span>` : ""}
            </div>
          </div>
          <div class="goal-detail-actions">
            <button
              class="button goal-inline-action-secondary"
              data-load-task-source-explanation="${escapeHtml(task.id || "")}"
              data-load-task-conversation-id="${escapeHtml(task.conversationId || "")}"
              ${sourceExplanationLoading ? "disabled" : ""}
            >${escapeHtml(sourceExplanationLoading
              ? t("memory.taskSourceExplanationLoadingShort", {}, "正在读取来源…")
              : hasLoadedSourceExplanation
                ? t("memory.taskSourceExplanationReload", {}, "刷新来源解释")
                : t("memory.taskSourceExplanationLoad", {}, "查看来源解释"))}</button>
          </div>
          ${sourceExplanationError ? `<div class="memory-detail-text">${escapeHtml(sourceExplanationError)}</div>` : ""}
          ${sourceExplanationItems.length ? `
            <div class="memory-inline-list">
              ${sourceExplanationItems.map((item) => {
                const activityRef = buildTaskSourceActivityReference(item.activityIds, t);
                return `
                  <div class="memory-inline-item">
                    <div class="memory-inline-item-head">
                      ${item.label ? `<span class="memory-badge">${escapeHtml(item.label)}</span>` : ""}
                      ${activityRef
                        ? `<span class="memory-badge" title="${escapeHtml(activityRef.title)}">${escapeHtml(activityRef.badgeLabel)}</span>`
                        : ""}
                    </div>
                    ${item.previews.map((preview) => `<div class="memory-detail-text">${escapeHtml(preview)}</div>`).join("")}
                  </div>
                `;
              }).join("")}
            </div>
          ` : `
            <div class="memory-detail-text">${escapeHtml(sourceExplanationLoading
              ? t("memory.taskSourceExplanationLoading", {}, "正在读取 stop / recap 的来源…")
              : hasLoadedSourceExplanation
                ? t("memory.taskSourceExplanationEmpty", {}, "当前没有可展示的来源解释。")
                : t("memory.taskSourceExplanationEmptyIdle", {}, "需要时再点击查看来源解释。"))}</div>
          `}
        </div>
        `)}
        ${!compactGovernanceDetailMode && task.reflection ? `<div class="memory-detail-card"><span class="memory-detail-label">复盘</span><div class="memory-detail-text">${escapeHtml(task.reflection)}</div></div>` : ""}

        ${renderGovernanceFullOnly(`
        <div class="memory-detail-card">
          <span class="memory-detail-label">Activity / Worklog (${activities.length})</span>
          ${activities.length ? `
            <div class="memory-inline-list">
              ${activities.map((activity) => `
                <div class="memory-inline-item">
                  <div class="memory-inline-item-head">
                    <span class="memory-badge">${escapeHtml(activity.state || "completed")}</span>
                    <span class="memory-badge">${escapeHtml(activity.kind || "activity")}</span>
                    <span class="memory-badge">${escapeHtml(formatDateTime(activity.happenedAt || activity.recordedAt))}</span>
                  </div>
                  <div class="memory-detail-text">${escapeHtml(activity.title || "-")}</div>
                  ${activity.summary ? `<div class="memory-detail-text">${escapeHtml(activity.summary)}</div>` : ""}
                  ${Array.isArray(activity.files) && activity.files.length ? `
                    <div class="memory-detail-text">
                      ${activity.files.map((filePath) => `<button class="memory-path-link" data-open-source="${escapeHtml(filePath)}">${escapeHtml(filePath)}</button>`).join("")}
                    </div>
                  ` : ""}
                  ${Array.isArray(activity.artifactPaths) && activity.artifactPaths.length ? `
                    <div class="memory-detail-text">
                      ${activity.artifactPaths.map((artifactPath) => `<button class="memory-path-link" data-open-source="${escapeHtml(artifactPath)}">${escapeHtml(artifactPath)}</button>`).join("")}
                    </div>
                  ` : ""}
                  ${Array.isArray(activity.memoryChunkIds) && activity.memoryChunkIds.length ? `
                    <div class="memory-detail-text">
                      ${activity.memoryChunkIds.map((chunkId) => `<button class="memory-path-link" data-open-memory-id="${escapeHtml(chunkId)}">${escapeHtml(chunkId)}</button>`).join("")}
                    </div>
                  ` : ""}
                  ${activity.error ? `<div class="memory-detail-text">${escapeHtml(activity.error)}</div>` : ""}
                </div>
              `).join("")}
            </div>
          ` : `<div class="memory-detail-text">No activity records.</div>`}
        </div>
        `)}

        ${renderGovernanceFullOnly(`
        <div class="memory-detail-card">
          <span class="memory-detail-label">${escapeHtml(t("memory.methodUsageTitle", {}, "Method Usage"))} (${usedMethods.length})</span>
          ${renderTaskUsageItems(usedMethods, "method")}
        </div>
        `)}

        ${renderGovernanceFullOnly(`
        <div class="memory-detail-card">
          <span class="memory-detail-label">${escapeHtml(t("memory.skillUsageTitle", {}, "Skill Usage"))} (${usedSkills.length})</span>
          ${renderTaskUsageItems(usedSkills, "skill")}
        </div>
        `)}

        ${renderGovernanceFullOnly(`
        <div class="memory-detail-card">
          <span class="memory-detail-label">工具调用（${toolCalls.length}）</span>
          ${toolCalls.length ? `
            <div class="memory-inline-list">
              ${toolCalls.map((call) => `
                <div class="memory-inline-item">
                  <div class="memory-inline-item-head">
                    <span class="memory-badge">${escapeHtml(call.toolName || "unknown")}</span>
                    <span class="memory-badge">${call.success ? "成功" : "失败"}</span>
                    <span class="memory-badge">${escapeHtml(formatDuration(call.durationMs))}</span>
                  </div>
                  ${call.note ? `<div class="memory-detail-text">${escapeHtml(call.note)}</div>` : ""}
                </div>
              `).join("")}
            </div>
          ` : `<div class="memory-detail-text">${escapeHtml(t("memory.noToolCalls", {}, "No tool call records."))}</div>`}
        </div>
        `)}

        ${renderGovernanceFullOnly(`
        <div class="memory-detail-card">
          <span class="memory-detail-label">${escapeHtml(t("memory.linkedMemoriesTitle", {}, "Linked Memories"))} (${memoryLinks.length})</span>
          ${memoryLinks.length ? `
            <div class="memory-inline-list">
              ${memoryLinks.map((link) => `
                <div class="memory-inline-item">
                  <div class="memory-inline-item-head">
                    <span class="memory-badge">${escapeHtml(link.relation || "used")}</span>
                    ${link.memoryType ? `<span class="memory-badge">${escapeHtml(link.memoryType)}</span>` : ""}
                    ${link.sourceView ? `<span class="memory-badge ${getResidentSourceBadgeClass(link.sourceView)}">${escapeHtml(formatResidentSourceScopeLabel(link.sourceView))}</span>` : ""}
                    <button class="memory-path-link" data-open-memory-id="${escapeHtml(link.chunkId || "")}">${escapeHtml(link.chunkId || "打开记忆")}</button>
                  </div>
                  ${link.sourcePath ? `<button class="memory-path-link" data-open-source="${escapeHtml(link.sourcePath)}">${escapeHtml(link.sourcePath)}</button>` : ""}
                  ${link.snippet ? `<div class="memory-detail-text">${escapeHtml(link.snippet)}</div>` : ""}
                </div>
              `).join("")}
            </div>
          ` : `<div class="memory-detail-text">${escapeHtml(t("memory.noLinkedMemories", {}, "No linked memories."))}</div>`}
        </div>
        `)}

        ${renderGovernanceFullOnly(`
        <div class="memory-detail-card">
          <span class="memory-detail-label">${escapeHtml(t("memory.artifactsTitle", {}, "Artifacts"))} (${artifactPaths.length})</span>
          ${artifactPaths.length ? `
            <div class="memory-inline-list">
              ${artifactPaths.map((artifactPath) => `
                <div class="memory-inline-item">
                  <button class="memory-path-link" data-open-source="${escapeHtml(artifactPath)}">${escapeHtml(artifactPath)}</button>
                </div>
              `).join("")}
            </div>
          ` : `<div class="memory-detail-text">${escapeHtml(t("memory.noArtifacts", {}, "No artifact paths."))}</div>`}
        </div>
        `)}
      </div>
    `;
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
    renderMemoryCategoryDistribution,
    renderTaskDetail,
    renderTaskUsageOverviewCard,
    revokeTaskUsage,
    summarizeSourcePath,
    buildTaskSourceExplanationItems,
    clearGeneration,
    dispose,
    getRuntimeSnapshot,
  };
}
