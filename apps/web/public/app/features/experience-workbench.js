import { extractCandidateContextTargets } from "./memory-viewer.js";
import { isCompactGovernanceDetailMode } from "./governance-detail-mode.js";

const EXPERIENCE_CANDIDATE_PAGE_SIZE = 100;
const EXPERIENCE_CANDIDATE_MAX_PAGES = 50;

function normalizeCandidateType(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized === "skill" ? "skill" : "method";
}

function normalizeCandidateStatus(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "accepted" || normalized === "rejected" || normalized === "draft") {
    return normalized;
  }
  return "";
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeWorkbenchTab(value) {
  const normalized = normalizeText(value);
  if (
    normalized === "candidates"
    || normalized === "capability-acquisition"
    || normalized === "assets"
    || normalized === "usage-overview"
  ) {
    return normalized;
  }
  return "capability-acquisition";
}

function hasOwn(source, key) {
  return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function parseTimestamp(value) {
  const time = Date.parse(typeof value === "string" ? value : "");
  return Number.isFinite(time) ? time : 0;
}

function compareCandidateByUpdatedAtDesc(left, right) {
  const leftTime = parseTimestamp(left?.updatedAt || left?.createdAt);
  const rightTime = parseTimestamp(right?.updatedAt || right?.createdAt);
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

function comparePublishedAssetByTypeAndTitle(left, right) {
  const leftType = normalizeCandidateType(left?.type);
  const rightType = normalizeCandidateType(right?.type);
  if (leftType !== rightType) {
    return leftType.localeCompare(rightType);
  }
  const leftLabel = normalizeText(left?.title) || normalizeText(left?.key) || normalizeText(left?.publishedPath);
  const rightLabel = normalizeText(right?.title) || normalizeText(right?.key) || normalizeText(right?.publishedPath);
  return leftLabel.localeCompare(rightLabel);
}

function countExperienceStats(items) {
  const stats = {
    total: 0,
    methods: 0,
    skills: 0,
    draft: 0,
    accepted: 0,
    rejected: 0,
  };
  for (const item of Array.isArray(items) ? items : []) {
    stats.total += 1;
    const type = normalizeCandidateType(item?.type);
    if (type === "skill") {
      stats.skills += 1;
    } else {
      stats.methods += 1;
    }
    const status = normalizeCandidateStatus(item?.status);
    if (status === "draft") stats.draft += 1;
    if (status === "accepted") stats.accepted += 1;
    if (status === "rejected") stats.rejected += 1;
  }
  return stats;
}

function normalizeExperienceStatValue(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function mergeExperienceStats(stats, fallback) {
  const safeFallback = fallback && typeof fallback === "object"
    ? fallback
    : countExperienceStats([]);
  if (!stats || typeof stats !== "object") {
    return safeFallback;
  }
  return {
    total: normalizeExperienceStatValue(stats.total, safeFallback.total),
    methods: normalizeExperienceStatValue(stats.methods, safeFallback.methods),
    skills: normalizeExperienceStatValue(stats.skills, safeFallback.skills),
    draft: normalizeExperienceStatValue(stats.draft, safeFallback.draft),
    accepted: normalizeExperienceStatValue(stats.accepted, safeFallback.accepted),
    rejected: normalizeExperienceStatValue(stats.rejected, safeFallback.rejected),
  };
}

function getExperienceStatsStatusKey(status) {
  return status === "draft" || status === "accepted" || status === "rejected"
    ? status
    : "";
}

function updateExperienceStatsForStatusTransition(stats, fromStatus, toStatus) {
  if (!stats || typeof stats !== "object") {
    return stats;
  }
  const nextStats = mergeExperienceStats(stats, stats);
  const fromKey = getExperienceStatsStatusKey(fromStatus);
  const toKey = getExperienceStatsStatusKey(toStatus);
  if (fromKey && Number.isFinite(nextStats[fromKey])) {
    nextStats[fromKey] = Math.max(0, nextStats[fromKey] - 1);
  }
  if (toKey && Number.isFinite(nextStats[toKey])) {
    nextStats[toKey] += 1;
  }
  return nextStats;
}

function updateExperienceStatsForBulkReject(stats, count) {
  if (!stats || typeof stats !== "object") {
    return stats;
  }
  const rejectedCount = Number(count);
  if (!Number.isFinite(rejectedCount) || rejectedCount <= 0) {
    return mergeExperienceStats(stats, stats);
  }
  const nextStats = mergeExperienceStats(stats, stats);
  nextStats.draft = Math.max(0, nextStats.draft - rejectedCount);
  nextStats.rejected += rejectedCount;
  return nextStats;
}

function renderExperienceCandidateFreshnessSummary(memoryFreshness, escapeHtml) {
  const summary = memoryFreshness?.summary && typeof memoryFreshness.summary === "object"
    ? memoryFreshness.summary
    : null;
  if (!summary?.available || !summary.headline) {
    return "";
  }
  return `
    <div class="tool-settings-policy-note" style="margin-bottom:12px;">
      <div><strong>Memory Freshness：</strong>${escapeHtml(summary.headline)}</div>
      <div>review_required=${escapeHtml(String(summary.reviewRequiredCount || 0))} / stale=${escapeHtml(String(summary.staleCount || 0))} / superseded=${escapeHtml(String(summary.supersededCount || 0))}</div>
    </div>
  `;
}

export function createExperienceWorkbenchFeature({
  refs,
  isConnected,
  sendReq,
  makeId,
  getExperienceWorkbenchState,
  getMemoryViewerState,
  getSelectedAgentId,
  getSelectedAgentLabel,
  renderCandidateDetailPanel,
  renderTaskUsageOverviewCard,
  loadTaskUsageOverview,
  generateExperienceCandidate,
  openToolSettingsTab,
  escapeHtml,
  formatDateTime,
  openTaskFromWorkbench,
  openMemoryFromWorkbench,
  openSourcePath,
  showNotice,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const {
    experienceWorkbenchSection,
    experienceWorkbenchTitleEl,
    experienceWorkbenchStatsEl,
    experienceWorkbenchTabCandidatesBtn,
    experienceWorkbenchTabCapabilityAcquisitionBtn,
    experienceWorkbenchTabAssetsBtn,
    experienceWorkbenchTabUsageOverviewBtn,
    experienceWorkbenchCandidatesPaneEl,
    experienceWorkbenchCapabilityPaneEl,
    experienceWorkbenchCapabilityOverviewEl,
    experienceWorkbenchAssetsPaneEl,
    experienceWorkbenchAssetsListEl,
    experienceWorkbenchAssetsDetailEl,
    experienceWorkbenchUsagePaneEl,
    experienceWorkbenchUsageOverviewEl,
    experienceWorkbenchQueryEl,
    experienceWorkbenchTypeFilterEl,
    experienceWorkbenchStatusFilterEl,
    experienceWorkbenchResetFiltersBtn,
    experienceWorkbenchCleanupConsumedBtn,
    experienceGenerateTaskIdEl,
    experienceGenerateMethodBtn,
    experienceGenerateSkillBtn,
    experienceWorkbenchListEl,
    experienceWorkbenchDetailEl,
    experienceSynthesisModalEl,
    experienceSynthesisModalTitleEl,
    experienceSynthesisModalSummaryEl,
    experienceSynthesisModalStatusEl,
    experienceSynthesisModalListEl,
    experienceSynthesisModalCloseBtn,
    experienceSynthesisModalCancelBtn,
    experienceSynthesisModalSubmitBtn,
    experienceSynthesisModalConsumeSourcesEl,
    experienceSynthesisModalConsumeSourcesLabelEl,
  } = refs;

  let uiBound = false;
  let pendingGenerateActionKey = "";

  function getSynthesisModalState() {
    const state = getExperienceWorkbenchState();
    if (!state.synthesisModal || typeof state.synthesisModal !== "object") {
      state.synthesisModal = {
        open: false,
        loading: false,
        submitting: false,
        error: "",
        seedCandidateId: "",
        seedAssetPath: "",
        preview: null,
        markSourcesConsumed: true,
        createdCandidate: null,
      };
    }
    if (typeof state.synthesisModal.seedAssetPath !== "string") {
      state.synthesisModal.seedAssetPath = "";
    }
    if (typeof state.synthesisModal.markSourcesConsumed !== "boolean") {
      state.synthesisModal.markSourcesConsumed = true;
    }
    if (!state.synthesisModal.createdCandidate || typeof state.synthesisModal.createdCandidate !== "object") {
      state.synthesisModal.createdCandidate = null;
    }
    return state.synthesisModal;
  }

  function ensurePublishedAssetState() {
    const state = getExperienceWorkbenchState();
    if (typeof state.selectedAssetPath !== "string") {
      state.selectedAssetPath = "";
    }
    if (!state.selectedAsset || typeof state.selectedAsset !== "object") {
      state.selectedAsset = null;
    }
    if (typeof state.selectedAssetLoading !== "boolean") {
      state.selectedAssetLoading = false;
    }
    if (typeof state.selectedAssetError !== "string") {
      state.selectedAssetError = "";
    }
    return state;
  }

  function getPublishedAssetsByType() {
    const safeItems = getPublishedAssetItems();
    return {
      methods: safeItems.filter((item) => normalizeCandidateType(item?.type) === "method"),
      skills: safeItems.filter((item) => normalizeCandidateType(item?.type) === "skill"),
    };
  }

  function getPublishedAssetItems() {
    const state = getExperienceWorkbenchState();
    const safeItems = Array.isArray(state.publishedAssets) ? [...state.publishedAssets] : [];
    safeItems.sort(comparePublishedAssetByTypeAndTitle);
    return safeItems;
  }

  function getSelectedPublishedAssetPath() {
    ensurePublishedAssetState();
    return normalizeText(getExperienceWorkbenchState().selectedAssetPath);
  }

  function findPublishedAssetInState(assetPath) {
    const normalizedAssetPath = normalizeText(assetPath);
    if (!normalizedAssetPath) return null;
    return getPublishedAssetItems().find((item) => normalizeText(item?.publishedPath) === normalizedAssetPath) || null;
  }

  function getActiveAgentId() {
    const state = getExperienceWorkbenchState();
    const selectedAgentId = typeof getSelectedAgentId === "function"
      ? String(getSelectedAgentId() || "").trim()
      : "";
    return selectedAgentId || String(state.activeAgentId || "default").trim() || "default";
  }

  function createRequestContext() {
    const state = getExperienceWorkbenchState();
    state.requestToken = Number(state.requestToken || 0) + 1;
    state.activeAgentId = getActiveAgentId();
    return {
      requestToken: state.requestToken,
      agentId: state.activeAgentId,
    };
  }

  function isRequestCurrent(requestContext) {
    const state = getExperienceWorkbenchState();
    return Number(state.requestToken || 0) === Number(requestContext?.requestToken || 0)
      && String(state.activeAgentId || "default").trim() === String(requestContext?.agentId || "default").trim();
  }

  function getPendingActionKey() {
    const memoryViewerState = typeof getMemoryViewerState === "function" ? getMemoryViewerState() : null;
    return typeof memoryViewerState?.pendingExperienceActionKey === "string"
      ? memoryViewerState.pendingExperienceActionKey
      : "";
  }

  function getActiveTab() {
    const state = getExperienceWorkbenchState();
    return normalizeWorkbenchTab(state.activeTab);
  }

  function setActiveTab(nextTab) {
    const state = getExperienceWorkbenchState();
    state.activeTab = normalizeWorkbenchTab(nextTab);
  }

  function getFilters() {
    const state = getExperienceWorkbenchState();
    const filters = state.filters && typeof state.filters === "object" ? state.filters : {};
    return {
      query: normalizeText(filters.query),
      type: normalizeCandidateType(filters.type || "") === "skill"
        ? "skill"
        : normalizeText(filters.type) === "method"
          ? "method"
          : "",
      status: normalizeCandidateStatus(filters.status),
    };
  }

  function hasActiveFilters() {
    const filters = getFilters();
    return Boolean(filters.query || filters.type || filters.status);
  }

  function setFilters(nextFilters = {}) {
    const state = getExperienceWorkbenchState();
    state.filters = {
      ...getFilters(),
      query: normalizeText(nextFilters.query ?? getFilters().query),
      type: normalizeText(nextFilters.type ?? getFilters().type),
      status: normalizeText(nextFilters.status ?? getFilters().status),
    };
  }

  function syncFilterUi() {
    const filters = getFilters();
    if (experienceWorkbenchQueryEl) experienceWorkbenchQueryEl.value = filters.query;
    if (experienceWorkbenchTypeFilterEl) experienceWorkbenchTypeFilterEl.value = filters.type;
    if (experienceWorkbenchStatusFilterEl) experienceWorkbenchStatusFilterEl.value = filters.status;
    if (experienceGenerateTaskIdEl) {
      experienceGenerateTaskIdEl.value = normalizeText(getExperienceWorkbenchState().generateTaskId);
    }
    syncGenerateControls();
  }

  function applyExperienceWorkbenchContext(options = {}) {
    const state = getExperienceWorkbenchState();
    const filters = options?.filters && typeof options.filters === "object" ? options.filters : null;
    if (filters) {
      setFilters({
        ...(hasOwn(filters, "query") ? { query: filters.query } : {}),
        ...(hasOwn(filters, "type") ? { type: filters.type } : {}),
        ...(hasOwn(filters, "status") ? { status: filters.status } : {}),
      });
    }
    if (hasOwn(options, "generateTaskId")) {
      state.generateTaskId = normalizeText(options.generateTaskId);
    }
    if (hasOwn(options, "candidateId")) {
      const candidateId = normalizeText(options.candidateId);
      state.selectedId = candidateId || null;
      if (!candidateId || String(state.selectedCandidate?.id || "") !== candidateId) {
        state.selectedCandidate = null;
      }
      if (candidateId && !hasOwn(options, "tab")) {
        setActiveTab("candidates");
      }
    }
    if (hasOwn(options, "tab")) {
      setActiveTab(options.tab);
    }
    syncFilterUi();
  }

  function syncGenerateControls() {
    const state = getExperienceWorkbenchState();
    const taskId = normalizeText(state.generateTaskId);
    const pendingActionKey = pendingGenerateActionKey || getPendingActionKey();
    const methodBusy = taskId ? pendingActionKey === `generate:method:${taskId}` : false;
    const skillBusy = taskId ? pendingActionKey === `generate:skill:${taskId}` : false;
    const hasPendingAction = Boolean(pendingActionKey);
    if (experienceGenerateMethodBtn) {
      experienceGenerateMethodBtn.disabled = !taskId || hasPendingAction;
      experienceGenerateMethodBtn.textContent = methodBusy
        ? t("memory.generateMethodCandidateBusy", {}, "生成 method 中…")
        : t("experience.generateMethod", {}, "Generate method");
    }
    if (experienceGenerateSkillBtn) {
      experienceGenerateSkillBtn.disabled = !taskId || hasPendingAction;
      experienceGenerateSkillBtn.textContent = skillBusy
        ? t("memory.generateSkillCandidateBusy", {}, "生成 skill 中…")
        : t("experience.generateSkill", {}, "Generate skill");
    }
  }

  function syncExperienceWorkbenchTabUi() {
    const activeTab = getActiveTab();
    if (experienceWorkbenchTabCandidatesBtn) {
      experienceWorkbenchTabCandidatesBtn.classList.toggle("active", activeTab === "candidates");
    }
    if (experienceWorkbenchTabCapabilityAcquisitionBtn) {
      experienceWorkbenchTabCapabilityAcquisitionBtn.classList.toggle("active", activeTab === "capability-acquisition");
    }
    if (experienceWorkbenchTabAssetsBtn) {
      experienceWorkbenchTabAssetsBtn.classList.toggle("active", activeTab === "assets");
    }
    if (experienceWorkbenchTabUsageOverviewBtn) {
      experienceWorkbenchTabUsageOverviewBtn.classList.toggle("active", activeTab === "usage-overview");
    }
    if (experienceWorkbenchCandidatesPaneEl) {
      experienceWorkbenchCandidatesPaneEl.classList.toggle("hidden", activeTab !== "candidates");
    }
    if (experienceWorkbenchCapabilityPaneEl) {
      experienceWorkbenchCapabilityPaneEl.classList.toggle("hidden", activeTab !== "capability-acquisition");
    }
    if (experienceWorkbenchAssetsPaneEl) {
      experienceWorkbenchAssetsPaneEl.classList.toggle("hidden", activeTab !== "assets");
    }
    if (experienceWorkbenchUsagePaneEl) {
      experienceWorkbenchUsagePaneEl.classList.toggle("hidden", activeTab !== "usage-overview");
    }
  }

  function getEmptyExperienceMessage() {
    return hasActiveFilters()
      ? t("experience.emptyFiltered", {}, "No experience candidates match the current filters.")
      : t("experience.empty", {}, "No experience candidates yet.");
  }

  function getFilteredExperienceItems() {
    const state = getExperienceWorkbenchState();
    const filters = getFilters();
    const query = filters.query.toLowerCase();
    return (Array.isArray(state.items) ? state.items : []).filter((item) => {
      if (filters.type && normalizeCandidateType(item?.type) !== filters.type) {
        return false;
      }
      if (filters.status && normalizeCandidateStatus(item?.status) !== filters.status) {
        return false;
      }
      if (!query) return true;
      const haystack = [
        item?.id,
        item?.title,
        item?.slug,
        item?.summary,
        item?.taskId,
        item?.sourceTaskSnapshot?.taskId,
        item?.publishedPath,
      ]
        .map((value) => normalizeText(value).toLowerCase())
        .filter(Boolean)
        .join("\n");
      return haystack.includes(query);
    });
  }

  function getCapabilityDraftItemsByType() {
    const state = getExperienceWorkbenchState();
    const safeItems = Array.isArray(state.draftItems) ? [...state.draftItems] : [];
    safeItems.sort(compareCapabilityDraftCandidate);
    return {
      methods: safeItems.filter((item) => normalizeCandidateType(item?.type) === "method"),
      skills: safeItems.filter((item) => normalizeCandidateType(item?.type) === "skill"),
    };
  }

  function getConsumedDraftCount() {
    const state = getExperienceWorkbenchState();
    return (Array.isArray(state.items) ? state.items : []).filter((item) => (
      normalizeCandidateStatus(item?.status) === "draft" && isSynthesisConsumedCandidate(item)
    )).length;
  }

  function syncExperienceWorkbenchHeaderTitle() {
    if (!experienceWorkbenchTitleEl) return;
    const agentName = typeof getSelectedAgentLabel === "function"
      ? String(getSelectedAgentLabel() || "").trim()
      : "";
    experienceWorkbenchTitleEl.textContent = agentName
      ? t("experience.titleWithAgent", { agentName }, `${agentName} Experience Workbench`)
      : t("experience.title", {}, "Experience Workbench");
  }

  function syncCleanupConsumedButton() {
    if (!experienceWorkbenchCleanupConsumedBtn) return;
    const consumedDraftCount = getConsumedDraftCount();
    experienceWorkbenchCleanupConsumedBtn.classList.toggle("hidden", consumedDraftCount <= 0);
    experienceWorkbenchCleanupConsumedBtn.disabled = Boolean(getPendingActionKey());
  }

  function renderExperienceWorkbenchListEmpty(message) {
    if (!experienceWorkbenchListEl) return;
    experienceWorkbenchListEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(message)}</div>`;
  }

  function renderExperienceWorkbenchDetailEmpty(message) {
    if (!experienceWorkbenchDetailEl) return;
    experienceWorkbenchDetailEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(message)}</div>`;
  }

  function renderExperienceWorkbenchUsageOverviewEmpty(message) {
    if (!experienceWorkbenchUsageOverviewEl) return;
    experienceWorkbenchUsageOverviewEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(message)}</div>`;
  }

  function renderExperienceWorkbenchCapabilityOverviewEmpty(message) {
    if (!experienceWorkbenchCapabilityOverviewEl) return;
    experienceWorkbenchCapabilityOverviewEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(message)}</div>`;
  }

  function summarizePathLabel(value) {
    const normalized = normalizeText(value).replace(/\\/g, "/");
    if (!normalized) return "-";
    const segments = normalized.split("/").filter(Boolean);
    if (segments.length <= 3) return normalized;
    return segments.slice(-3).join("/");
  }

  function resolveExperienceDisplayTaskId(candidate) {
    const snapshotTaskId = normalizeText(candidate?.sourceTaskSnapshot?.taskId);
    return snapshotTaskId || normalizeText(candidate?.taskId);
  }

  function isSynthesizedCandidate(candidate) {
    return normalizeText(candidate?.metadata?.draftOrigin?.kind).toLowerCase() === "synthesized";
  }

  function compareCapabilityDraftCandidate(left, right) {
    const leftSynthesized = isSynthesizedCandidate(left);
    const rightSynthesized = isSynthesizedCandidate(right);
    if (leftSynthesized !== rightSynthesized) {
      return leftSynthesized ? -1 : 1;
    }
    return compareCandidateByUpdatedAtDesc(left, right);
  }

  function getSynthesisSourceCount(candidate) {
    const sourceCount = Number(candidate?.metadata?.synthesis?.sourceCount);
    return Number.isFinite(sourceCount) && sourceCount > 0 ? sourceCount : 0;
  }

  function isSynthesisConsumedCandidate(candidate) {
    return candidate?.metadata?.synthesisConsumed?.consumed === true;
  }

  function getSynthesisConsumedInfo(candidate) {
    const metadata = candidate?.metadata?.synthesisConsumed;
    if (!metadata || metadata.consumed !== true) {
      return null;
    }
    const consumedByCandidateId = normalizeText(metadata.consumedByCandidateId);
    const consumedAt = normalizeText(metadata.consumedAt);
    const consumedRunId = normalizeText(metadata.consumedRunId);
    return consumedByCandidateId || consumedAt || consumedRunId
      ? {
        consumedByCandidateId,
        consumedAt,
        consumedRunId,
      }
      : null;
  }

  function upsertExperienceCandidateList(items, candidate, options = {}) {
    const safeItems = Array.isArray(items) ? [...items] : [];
    const normalizedCandidateId = normalizeText(candidate?.id);
    if (!normalizedCandidateId) {
      return safeItems;
    }
    const draftOnly = options?.draftOnly === true;
    const nextItems = safeItems.filter((item) => normalizeText(item?.id) !== normalizedCandidateId);
    if (!draftOnly || normalizeCandidateStatus(candidate?.status) === "draft") {
      nextItems.unshift(candidate);
    }
    nextItems.sort(compareCandidateByUpdatedAtDesc);
    return nextItems;
  }

  function formatCandidateTypeLabel(value) {
    return normalizeCandidateType(value) === "skill"
      ? t("experience.listTypeSkill", {}, "Skill")
      : t("experience.listTypeMethod", {}, "Method");
  }

  function formatCandidateStatusLabel(value) {
    const normalized = normalizeCandidateStatus(value);
    if (normalized === "draft") return t("experience.listStatusDraft", {}, "Draft");
    if (normalized === "accepted") return t("experience.listStatusAccepted", {}, "Accepted");
    if (normalized === "rejected") return t("experience.listStatusRejected", {}, "Rejected");
    return t("experience.listStatusUnknown", {}, "Unknown");
  }

  function formatSynthesisRelationLabel(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === "same_family") {
      return t("experience.synthesizeRelationSameFamily", {}, "同类");
    }
    return t("experience.synthesizeRelationSimilar", {}, "近似");
  }

  function renderExperienceWorkbenchStats(stats = null) {
    if (!experienceWorkbenchStatsEl) return;
    const safeStats = stats && typeof stats === "object"
      ? stats
      : {
        total: "--",
        methods: "--",
        skills: "--",
        draft: "--",
        accepted: "--",
        rejected: "--",
      };
    experienceWorkbenchStatsEl.innerHTML = `
      <div class="memory-stat-card">
        <span class="memory-stat-label">${escapeHtml(t("experience.statTotal", {}, "Candidates"))}</span>
        <strong class="memory-stat-value">${escapeHtml(String(safeStats.total))}</strong>
      </div>
      <div class="memory-stat-card">
        <span class="memory-stat-label">${escapeHtml(t("experience.statMethods", {}, "Methods"))}</span>
        <strong class="memory-stat-value">${escapeHtml(String(safeStats.methods))}</strong>
      </div>
      <div class="memory-stat-card">
        <span class="memory-stat-label">${escapeHtml(t("experience.statSkills", {}, "Skills"))}</span>
        <strong class="memory-stat-value">${escapeHtml(String(safeStats.skills))}</strong>
      </div>
      <div class="memory-stat-card">
        <span class="memory-stat-label">${escapeHtml(t("experience.statDraft", {}, "Draft"))}</span>
        <strong class="memory-stat-value">${escapeHtml(String(safeStats.draft))}</strong>
      </div>
      <div class="memory-stat-card">
        <span class="memory-stat-label">${escapeHtml(t("experience.statAccepted", {}, "Accepted"))}</span>
        <strong class="memory-stat-value">${escapeHtml(String(safeStats.accepted))}</strong>
      </div>
      <div class="memory-stat-card">
        <span class="memory-stat-label">${escapeHtml(t("experience.statRejected", {}, "Rejected"))}</span>
        <strong class="memory-stat-value">${escapeHtml(String(safeStats.rejected))}</strong>
      </div>
    `;
  }

  function bindExperienceWorkbenchListActions() {
    if (!experienceWorkbenchListEl) return;
    experienceWorkbenchListEl.querySelectorAll("[data-experience-candidate-id]").forEach((node) => {
      node.addEventListener("click", async () => {
        const candidateId = node.getAttribute("data-experience-candidate-id");
        await loadExperienceCandidateDetail(candidateId);
      });
    });
  }

  function renderExperienceWorkbenchList(items) {
    if (!experienceWorkbenchListEl) return;
    const state = getExperienceWorkbenchState();
    const safeItems = Array.isArray(items) ? items : [];
    if (!safeItems.length) {
      renderExperienceWorkbenchListEmpty(getEmptyExperienceMessage());
      return;
    }
    experienceWorkbenchListEl.innerHTML = safeItems.map((item) => {
      const title = item?.title || item?.slug || item?.id || t("memory.candidateUntitled", {}, "Untitled Candidate");
      const summary = item?.summary || t("experience.listNoSummary", {}, "No summary yet.");
      const isActive = String(item?.id || "") === String(state.selectedId || "");
      const skillFreshnessStatus = typeof item?.skillFreshness?.status === "string"
        ? item.skillFreshness.status.trim()
        : "";
      const displayTaskId = resolveExperienceDisplayTaskId(item);
      const synthesized = isSynthesizedCandidate(item);
      const synthesisSourceCount = getSynthesisSourceCount(item);
      return `
        <div class="memory-list-item ${isActive ? "active" : ""} ${synthesized ? "experience-candidate-synthesized" : ""}" data-experience-candidate-id="${escapeHtml(String(item?.id || ""))}">
          <div class="memory-list-item-title">${escapeHtml(title)}</div>
          <div class="memory-list-item-meta">
            <span>${escapeHtml(formatCandidateTypeLabel(item?.type))}</span>
            <span>${escapeHtml(formatCandidateStatusLabel(item?.status))}</span>
            ${displayTaskId ? `<span>${escapeHtml(t("experience.listTaskLabel", {}, "Task"))} ${escapeHtml(displayTaskId)}</span>` : ""}
            ${synthesized ? `<span class="memory-badge experience-synthesized-badge">${escapeHtml(t("experience.synthesizedBadge", { count: String(synthesisSourceCount || 0) }, synthesisSourceCount > 0 ? `合成稿 · ${synthesisSourceCount}` : "合成稿"))}</span>` : ""}
            ${item?.publishedPath ? `<span class="memory-badge memory-badge-shared">${escapeHtml(t("experience.listPublishedBadge", {}, "Published"))}</span>` : ""}
            ${skillFreshnessStatus ? `<span class="memory-badge">${escapeHtml(skillFreshnessStatus)}</span>` : ""}
            <span>${escapeHtml(formatDateTime(item?.updatedAt || item?.createdAt))}</span>
          </div>
          <div class="memory-list-item-snippet">${escapeHtml(summary)}</div>
        </div>
      `;
    }).join("");
    bindExperienceWorkbenchListActions();
  }

  function bindExperienceWorkbenchDetailActions() {
    if (!experienceWorkbenchDetailEl) return;
    experienceWorkbenchDetailEl.querySelectorAll("[data-open-task-id]").forEach((node) => {
      node.addEventListener("click", async () => {
        const taskId = node.getAttribute("data-open-task-id");
        await openTaskFromWorkbench?.(taskId);
      });
    });
    experienceWorkbenchDetailEl.querySelectorAll("[data-open-memory-id]").forEach((node) => {
      node.addEventListener("click", async () => {
        const chunkId = node.getAttribute("data-open-memory-id");
        await openMemoryFromWorkbench?.(chunkId);
      });
    });
    experienceWorkbenchDetailEl.querySelectorAll("[data-open-source]").forEach((node) => {
      node.addEventListener("click", async () => {
        const sourcePath = node.getAttribute("data-open-source");
        const lineRaw = node.getAttribute("data-open-line");
        const startLine = lineRaw ? Number.parseInt(lineRaw, 10) : undefined;
        await openSourcePath?.(sourcePath, { startLine });
      });
    });
    experienceWorkbenchDetailEl.querySelectorAll("[data-open-candidate-id]").forEach((node) => {
      node.addEventListener("click", async () => {
        const candidateId = node.getAttribute("data-open-candidate-id");
        await loadExperienceCandidateDetail(candidateId);
      });
    });
    experienceWorkbenchDetailEl.querySelectorAll("[data-open-experience-candidate-id]").forEach((node) => {
      node.addEventListener("click", async () => {
        const candidateId = node.getAttribute("data-open-experience-candidate-id");
        await loadExperienceCandidateDetail(candidateId);
      });
    });
    experienceWorkbenchDetailEl.querySelectorAll("[data-open-tool-settings-tab]").forEach((node) => {
      node.addEventListener("click", async () => {
        const tab = node.getAttribute("data-open-tool-settings-tab");
        await openToolSettingsTab?.(tab);
      });
    });
    experienceWorkbenchDetailEl.querySelectorAll("[data-review-candidate-action]").forEach((node) => {
      node.addEventListener("click", async () => {
        const candidateId = node.getAttribute("data-review-candidate-id");
        const action = node.getAttribute("data-review-candidate-action");
        await reviewExperienceCandidate(candidateId, action);
      });
    });
    experienceWorkbenchDetailEl.querySelectorAll("[data-skill-freshness-stale-action]").forEach((node) => {
      node.addEventListener("click", async () => {
        await updateSkillFreshnessStaleMark({
          sourceCandidateId: node.getAttribute("data-skill-freshness-source-candidate-id"),
          skillKey: node.getAttribute("data-skill-freshness-skill-key"),
          taskId: node.getAttribute("data-skill-freshness-task-id"),
          candidateId: node.getAttribute("data-skill-freshness-candidate-id"),
          stale: node.getAttribute("data-skill-freshness-stale-action") !== "clear",
        });
      });
    });
    experienceWorkbenchDetailEl.querySelectorAll("[data-close-candidate-panel]").forEach((node) => {
      node.addEventListener("click", () => {
        const state = getExperienceWorkbenchState();
        state.selectedId = null;
        state.selectedCandidate = null;
        void syncExperienceWorkbenchUi({ preferFirst: true, loadDetailIfNeeded: true });
      });
    });
  }

  function bindExperienceWorkbenchUsageOverviewActions() {
    if (!experienceWorkbenchUsageOverviewEl) return;
    experienceWorkbenchUsageOverviewEl.querySelectorAll("[data-open-task-id]").forEach((node) => {
      node.addEventListener("click", async () => {
        const taskId = node.getAttribute("data-open-task-id");
        await openTaskFromWorkbench?.(taskId);
      });
    });
    experienceWorkbenchUsageOverviewEl.querySelectorAll("[data-open-source]").forEach((node) => {
      node.addEventListener("click", async () => {
        const sourcePath = node.getAttribute("data-open-source");
        await openSourcePath?.(sourcePath);
      });
    });
    experienceWorkbenchUsageOverviewEl.querySelectorAll("[data-open-candidate-id]").forEach((node) => {
      node.addEventListener("click", async () => {
        const candidateId = node.getAttribute("data-open-candidate-id");
        setActiveTab("candidates");
        syncExperienceWorkbenchTabUi();
        await loadExperienceCandidateDetail(candidateId);
      });
    });
  }

  function renderExperienceWorkbenchCapabilityLane(title, items, laneType) {
    const safeItems = Array.isArray(items) ? items : [];
    const rawLaneType = typeof laneType === "string" ? laneType.trim().toLowerCase() : "";
    const normalizedLaneType = rawLaneType === "skill" ? "skill" : "method";
    const pendingActionKey = getPendingActionKey();
    const bulkRejectBusy = pendingActionKey === `bulk-reject:${normalizedLaneType}`;
    const bulkRejectDisabled = !safeItems.length || (Boolean(pendingActionKey) && !bulkRejectBusy);
    const laneHead = `
      <div class="memory-usage-overview-head">
        <div class="experience-capability-lane-head-main">
          <span class="memory-usage-overview-title">${escapeHtml(title)}</span>
          <span class="memory-stat-caption">${escapeHtml(t("experience.capabilityDraftCount", { count: String(safeItems.length) }, `Draft ${safeItems.length}`))}</span>
        </div>
        <button
          class="memory-usage-action-btn experience-capability-bulk-btn"
          data-capability-bulk-reject-type="${escapeHtml(normalizedLaneType)}"
          ${bulkRejectDisabled ? "disabled" : ""}
        >${escapeHtml(bulkRejectBusy
          ? t("experience.capabilityBulkRejectBusy", {}, "全部拒绝中…")
          : t("experience.capabilityBulkReject", {}, "全部拒绝"))}</button>
      </div>
    `;
    if (!safeItems.length) {
      return `
        <div class="memory-usage-overview-lane">
          ${laneHead}
          <div class="memory-usage-overview-empty">${escapeHtml(t("experience.capabilityLaneEmpty", {}, "暂无 draft 候选"))}</div>
        </div>
      `;
    }

    return `
      <div class="memory-usage-overview-lane">
        ${laneHead}
        <div class="memory-usage-overview-list">
          ${safeItems.map((item) => {
            const acceptBusy = pendingActionKey === `candidate:${item?.id}:accept`;
            const rejectBusy = pendingActionKey === `candidate:${item?.id}:reject`;
            const synthesizeBusy = pendingActionKey === `synthesize-preview:${item?.id}` || pendingActionKey === `synthesize-create:${item?.id}`;
            const reviewDisabled = Boolean(pendingActionKey) && !acceptBusy && !rejectBusy;
            const skillFreshnessStatus = normalizeText(item?.skillFreshness?.status);
            const skillFreshnessSummary = normalizeText(item?.skillFreshness?.summary);
            const summary = normalizeText(item?.summary) || t("experience.listNoSummary", {}, "No summary yet.");
            const displayTaskId = resolveExperienceDisplayTaskId(item);
            const synthesized = isSynthesizedCandidate(item);
            const synthesisSourceCount = getSynthesisSourceCount(item);
            const candidateId = normalizeText(item?.id);
            return `
              <div class="memory-usage-overview-row experience-capability-row ${synthesized ? "experience-candidate-synthesized" : ""}">
                <div class="memory-usage-overview-row-main experience-capability-row-main">
                  <div class="memory-usage-overview-key">${escapeHtml(item?.title || item?.slug || item?.id || t("memory.candidateUntitled", {}, "Untitled Candidate"))}</div>
                  <div class="memory-usage-overview-meta">
                    ${candidateId ? `<span class="experience-capability-candidate-id">${escapeHtml(`ID · ${candidateId}`)}</span>` : ""}
                    <span>${escapeHtml(formatCandidateStatusLabel(item?.status))}</span>
                    ${displayTaskId ? `<span>${escapeHtml(t("experience.listTaskLabel", {}, "Task"))} ${escapeHtml(displayTaskId)}</span>` : ""}
                    ${skillFreshnessStatus ? `<span>${escapeHtml(skillFreshnessStatus)}</span>` : ""}
                    <span>${escapeHtml(formatDateTime(item?.updatedAt || item?.createdAt))}</span>
                  </div>
                  <div class="memory-detail-badges">
                    <span class="memory-badge">${escapeHtml(formatCandidateTypeLabel(item?.type))}</span>
                    <span class="memory-badge">${escapeHtml(formatCandidateStatusLabel(item?.status))}</span>
                    ${synthesized ? `<span class="memory-badge experience-synthesized-badge">${escapeHtml(t("experience.synthesizedBadge", { count: String(synthesisSourceCount || 0) }, synthesisSourceCount > 0 ? `合成稿 · ${synthesisSourceCount}` : "合成稿"))}</span>` : ""}
                    ${skillFreshnessSummary ? `<span class="memory-badge">${escapeHtml(skillFreshnessSummary)}</span>` : ""}
                  </div>
                  <div class="experience-capability-summary">${escapeHtml(summary)}</div>
                </div>
                <div class="experience-capability-actions">
                  <button class="memory-usage-action-btn" data-capability-open-candidate-id="${escapeHtml(String(item?.id || ""))}">${escapeHtml(t("experience.capabilityViewDetail", {}, "查看详情"))}</button>
                  ${displayTaskId ? `<button class="memory-usage-action-btn" data-capability-open-task-id="${escapeHtml(displayTaskId)}">${escapeHtml(t("experience.capabilityOpenTask", {}, "打开任务"))}</button>` : ""}
                  <button
                    class="memory-usage-action-btn"
                    data-capability-synthesize-candidate-id="${escapeHtml(String(item?.id || ""))}"
                    ${synthesizeBusy || reviewDisabled ? "disabled" : ""}
                  >${escapeHtml(synthesizeBusy
                    ? t("experience.capabilitySynthesizeBusy", {}, "合成准备中…")
                    : t("experience.capabilitySynthesize", {}, "合成"))}</button>
                  <button
                    class="memory-usage-action-btn"
                    data-capability-review-candidate-action="accept"
                    data-capability-review-candidate-id="${escapeHtml(String(item?.id || ""))}"
                    ${acceptBusy || reviewDisabled ? "disabled" : ""}
                  >${escapeHtml(acceptBusy
                    ? t("memory.candidateReviewAccepting", {}, "接受中…")
                    : t("memory.candidateAcceptAndPublish", {}, "接受并发布"))}</button>
                  <button
                    class="memory-usage-action-btn"
                    data-capability-review-candidate-action="reject"
                    data-capability-review-candidate-id="${escapeHtml(String(item?.id || ""))}"
                    ${rejectBusy || reviewDisabled ? "disabled" : ""}
                  >${escapeHtml(rejectBusy
                    ? t("memory.candidateReviewRejecting", {}, "拒绝中…")
                    : t("memory.candidateReject", {}, "拒绝"))}</button>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  function bindExperienceWorkbenchCapabilityActions() {
    if (!experienceWorkbenchCapabilityOverviewEl) return;
    experienceWorkbenchCapabilityOverviewEl.querySelectorAll("[data-experience-resynthesize-asset-path]").forEach((node) => {
      node.addEventListener("input", () => {
        const state = getExperienceWorkbenchState();
        state.resynthesizeAssetPath = node.value;
      });
    });
    experienceWorkbenchCapabilityOverviewEl.querySelectorAll("[data-experience-resynthesize-preview]").forEach((node) => {
      node.addEventListener("click", async () => {
        const state = getExperienceWorkbenchState();
        await openExperienceSynthesisModalByAssetPath(state.resynthesizeAssetPath);
      });
    });
    experienceWorkbenchCapabilityOverviewEl.querySelectorAll("[data-experience-resynthesize-fill-selected]").forEach((node) => {
      node.addEventListener("click", () => {
        const state = getExperienceWorkbenchState();
        const publishedPath = normalizeText(state.selectedCandidate?.publishedPath);
        if (!publishedPath) return;
        state.resynthesizeAssetPath = publishedPath;
        renderExperienceWorkbenchCapabilityOverviewPanel();
      });
    });
    experienceWorkbenchCapabilityOverviewEl.querySelectorAll("[data-capability-open-candidate-id]").forEach((node) => {
      node.addEventListener("click", async () => {
        const candidateId = node.getAttribute("data-capability-open-candidate-id");
        if (!candidateId) return;
        setActiveTab("candidates");
        syncExperienceWorkbenchTabUi();
        await loadExperienceCandidateDetail(candidateId);
      });
    });
    experienceWorkbenchCapabilityOverviewEl.querySelectorAll("[data-capability-open-task-id]").forEach((node) => {
      node.addEventListener("click", async () => {
        const taskId = node.getAttribute("data-capability-open-task-id");
        await openTaskFromWorkbench?.(taskId);
      });
    });
    experienceWorkbenchCapabilityOverviewEl.querySelectorAll("[data-capability-review-candidate-action]").forEach((node) => {
      node.addEventListener("click", async () => {
        const candidateId = node.getAttribute("data-capability-review-candidate-id");
        const action = node.getAttribute("data-capability-review-candidate-action");
        await reviewExperienceCandidate(candidateId, action);
      });
    });
    experienceWorkbenchCapabilityOverviewEl.querySelectorAll("[data-capability-synthesize-candidate-id]").forEach((node) => {
      node.addEventListener("click", async () => {
        const candidateId = node.getAttribute("data-capability-synthesize-candidate-id");
        await openExperienceSynthesisModal(candidateId);
      });
    });
    experienceWorkbenchCapabilityOverviewEl.querySelectorAll("[data-capability-bulk-reject-type]").forEach((node) => {
      node.addEventListener("click", async () => {
        const candidateType = node.getAttribute("data-capability-bulk-reject-type");
        await bulkRejectExperienceCandidates(candidateType);
      });
    });
  }

  function renderExperienceWorkbenchCapabilityOverviewPanel() {
    if (!experienceWorkbenchCapabilityOverviewEl) return;
    const state = getExperienceWorkbenchState();
    const { methods, skills } = getCapabilityDraftItemsByType();

    const caption = state.draftItemsError
      ? state.draftItemsError
      : state.draftItemsLoading
        ? t("experience.capabilityLoading", {}, "正在刷新 draft 能力候选…")
        : (!methods.length && !skills.length)
          ? t("experience.capabilityEmpty", {}, "当前没有可处理的 draft method / skill 候选。")
          : t("experience.capabilityCaption", {}, "仅显示 draft 候选；已接受 / 已拒绝请到“经验候选”页签查看。");
    const selectedPublishedPath = normalizeText(state.selectedCandidate?.publishedPath);
    const resynthesizePendingKey = normalizeText(getPendingActionKey());
    const resynthesizeBusy = resynthesizePendingKey.startsWith("synthesize-preview:asset:")
      || resynthesizePendingKey.startsWith("synthesize-create:asset:");

    experienceWorkbenchCapabilityOverviewEl.innerHTML = `
      <div class="memory-stat-card memory-stat-card-wide memory-usage-overview-card experience-capability-card">
        <div class="memory-stat-card-head">
          <span class="memory-stat-label">${escapeHtml(t("experience.capabilityTitle", {}, "能力获取"))}</span>
          <span class="memory-stat-caption">${escapeHtml(caption)}</span>
        </div>
        <div class="experience-resynthesize-bar">
          <input
            class="input input-sm experience-resynthesize-input"
            data-experience-resynthesize-asset-path="1"
            value="${escapeHtml(normalizeText(state.resynthesizeAssetPath || ""))}"
            placeholder="${escapeHtml(t("experience.resynthesizePlaceholder", {}, "粘贴已发布 method/skill 路径（methods/*.md 或 skills/*/SKILL.md）"))}"
            ${resynthesizeBusy ? "disabled" : ""}
          />
          <button
            class="memory-usage-action-btn"
            data-experience-resynthesize-preview="1"
            ${resynthesizeBusy ? "disabled" : ""}
          >${escapeHtml(resynthesizeBusy
            ? t("experience.resynthesizePreviewBusy", {}, "预览中…")
            : t("experience.resynthesizePreview", {}, "再合成预览"))}</button>
          <button
            class="button goal-inline-action-secondary"
            data-experience-resynthesize-fill-selected="1"
            ${selectedPublishedPath && !resynthesizeBusy ? "" : "disabled"}
            title="${escapeHtml(selectedPublishedPath || "")}"
          >${escapeHtml(t("experience.resynthesizeFillSelected", {}, "从当前候选填充"))}</button>
        </div>
        <div class="memory-usage-overview-grid">
          ${renderExperienceWorkbenchCapabilityLane(t("experience.capabilityMethodLane", {}, "Method Draft"), methods, "method")}
          ${renderExperienceWorkbenchCapabilityLane(t("experience.capabilitySkillLane", {}, "Skill Draft"), skills, "skill")}
        </div>
      </div>
    `;
    bindExperienceWorkbenchCapabilityActions();
  }

  function renderExperienceWorkbenchPublishedAssetLane(container, title, items, laneType, options = {}) {
    if (!container) return;
    const safeItems = Array.isArray(items) ? items : [];
    const normalizedLaneType = normalizeCandidateType(laneType);
    const pendingActionKey = getPendingActionKey();
    const selectedAssetPath = getSelectedPublishedAssetPath();
    const laneHead = `
      <div class="memory-usage-overview-head">
        <div class="experience-capability-lane-head-main">
          <span class="memory-usage-overview-title">${escapeHtml(title)}</span>
          <span class="memory-stat-caption">${escapeHtml(t("experience.publishedAssetCount", { count: String(safeItems.length) }, `Published ${safeItems.length}`))}</span>
        </div>
      </div>
    `;
    const laneBody = options.message
      ? `<div class="memory-usage-overview-empty">${escapeHtml(options.message)}</div>`
      : !safeItems.length
        ? `<div class="memory-usage-overview-empty">${escapeHtml(t("experience.publishedAssetLaneEmpty", {}, "暂无已发布资产"))}</div>`
        : `
          <div class="memory-usage-overview-list">
            ${safeItems.map((item) => {
              const publishedPath = normalizeText(item?.publishedPath);
              const isSelected = publishedPath
                && (publishedPath === selectedAssetPath || publishedPath === normalizeText(getExperienceWorkbenchState().resynthesizeAssetPath));
              const previewBusy = pendingActionKey === `synthesize-preview:asset:${publishedPath}`
                || pendingActionKey === `synthesize-create:asset:${publishedPath}`;
              const rowDisabled = Boolean(pendingActionKey) && !previewBusy;
              const titleText = item?.title || item?.key || publishedPath || t("memory.candidateUntitled", {}, "Untitled Candidate");
              const summary = normalizeText(item?.summary) || t("experience.listNoSummary", {}, "No summary yet.");
              const metadataName = normalizeText(item?.metadata?.name);
              const metadataDescription = normalizeText(item?.metadata?.description);
              return `
                <div class="experience-asset-card ${isSelected ? "experience-candidate-synthesized" : ""}" data-experience-asset-path="${escapeHtml(publishedPath)}">
                  <div class="experience-capability-row-main">
                    <div class="memory-usage-overview-key">${escapeHtml(titleText)}</div>
                    <div class="memory-usage-overview-meta">
                      <span>${escapeHtml(formatCandidateTypeLabel(normalizedLaneType))}</span>
                      <span>${escapeHtml(summarizePathLabel(publishedPath))}</span>
                      ${isSelected ? `<span>${escapeHtml(t("experience.publishedAssetSelected", {}, "已选中"))}</span>` : ""}
                    </div>
                    <div class="memory-detail-badges">
                      <span class="memory-badge">${escapeHtml(formatCandidateTypeLabel(normalizedLaneType))}</span>
                      <span class="memory-badge memory-badge-shared">${escapeHtml(t("experience.listPublishedBadge", {}, "Published"))}</span>
                      ${metadataName ? `<span class="memory-badge">${escapeHtml(metadataName)}</span>` : ""}
                    </div>
                    <div class="memory-inline-item-path">${escapeHtml(publishedPath)}</div>
                    <div class="experience-capability-summary">${escapeHtml(metadataDescription || summary)}</div>
                  </div>
                  <div class="experience-capability-actions">
                    <button
                      class="memory-usage-action-btn"
                      data-experience-published-asset-preview="${escapeHtml(publishedPath)}"
                      ${publishedPath && !rowDisabled ? "" : "disabled"}
                    >${escapeHtml(previewBusy
                      ? t("experience.resynthesizePreviewBusy", {}, "预览中…")
                      : t("experience.publishedAssetPreview", {}, "预览再合成"))}</button>
                    <button
                      class="memory-usage-action-btn"
                      data-experience-published-asset-open-source="${escapeHtml(publishedPath)}"
                      ${publishedPath && !rowDisabled ? "" : "disabled"}
                    >${escapeHtml(t("experience.publishedAssetOpen", {}, "打开文件"))}</button>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        `;

    container.innerHTML = `
      <div class="memory-usage-overview-lane">
        ${laneHead}
        ${laneBody}
      </div>
    `;
  }

  function bindExperienceWorkbenchAssetsActions(container) {
    if (!container) return;
    container.querySelectorAll("[data-experience-asset-path]").forEach((node) => {
      node.addEventListener("click", (event) => {
        if (event.target instanceof Element && event.target.closest("button")) {
          return;
        }
        const state = ensurePublishedAssetState();
        state.selectedAssetPath = node.getAttribute("data-experience-asset-path") || "";
        renderExperienceWorkbenchAssetsPanel();
      });
    });
    container.querySelectorAll("[data-experience-published-asset-preview]").forEach((node) => {
      node.addEventListener("click", async () => {
        const assetPath = node.getAttribute("data-experience-published-asset-preview");
        const state = ensurePublishedAssetState();
        state.selectedAssetPath = assetPath || "";
        renderExperienceWorkbenchAssetsPanel();
        await openExperienceSynthesisModalByAssetPath(assetPath);
      });
    });
    container.querySelectorAll("[data-experience-published-asset-open-source]").forEach((node) => {
      node.addEventListener("click", async () => {
        const sourcePath = node.getAttribute("data-experience-published-asset-open-source");
        if (!sourcePath) return;
        const state = ensurePublishedAssetState();
        state.selectedAssetPath = sourcePath;
        renderExperienceWorkbenchAssetsPanel();
        await openSourcePath?.(sourcePath);
      });
    });
  }

  function renderExperienceWorkbenchAssetsPanel() {
    const state = ensurePublishedAssetState();
    const { methods, skills } = getPublishedAssetsByType();
    state.selectedAsset = null;
    state.selectedAssetLoading = false;
    state.selectedAssetError = "";
    const loadingMessage = t("experience.assetsLoading", {}, "正在读取已发布资产…");
    const errorMessage = state.publishedAssetsError || "";
    const message = state.publishedAssetsLoading ? loadingMessage : errorMessage;
    renderExperienceWorkbenchPublishedAssetLane(
      experienceWorkbenchAssetsListEl,
      t("experience.publishedMethodLane", {}, "Published Methods"),
      methods,
      "method",
      message ? { message } : {},
    );
    renderExperienceWorkbenchPublishedAssetLane(
      experienceWorkbenchAssetsDetailEl,
      t("experience.publishedSkillLane", {}, "Published Skills"),
      skills,
      "skill",
      message ? { message } : {},
    );
    bindExperienceWorkbenchAssetsActions(experienceWorkbenchAssetsListEl);
    bindExperienceWorkbenchAssetsActions(experienceWorkbenchAssetsDetailEl);
  }

  function renderExperienceWorkbenchUsageOverviewPanel() {
    if (!experienceWorkbenchUsageOverviewEl) return;
    const markup = typeof renderTaskUsageOverviewCard === "function"
      ? renderTaskUsageOverviewCard()
      : "";
    if (!markup) {
      renderExperienceWorkbenchUsageOverviewEmpty(t("experience.usageOverviewWaiting", {}, "Waiting for experience usage overview..."));
      return;
    }
    experienceWorkbenchUsageOverviewEl.innerHTML = markup;
    bindExperienceWorkbenchUsageOverviewActions();
  }

  function findExperienceCandidateInState(candidateId) {
    const normalizedCandidateId = normalizeText(candidateId);
    if (!normalizedCandidateId) return null;
    const state = getExperienceWorkbenchState();
    if (String(state.selectedCandidate?.id || "") === normalizedCandidateId) {
      return state.selectedCandidate;
    }
    const draftCandidate = Array.isArray(state.draftItems)
      ? state.draftItems.find((item) => String(item?.id || "") === normalizedCandidateId)
      : null;
    if (draftCandidate) return draftCandidate;
    return Array.isArray(state.items)
      ? state.items.find((item) => String(item?.id || "") === normalizedCandidateId) || null
      : null;
  }

  function applyReviewedExperienceCandidate(candidate, previousStatus = "") {
    if (!candidate || typeof candidate !== "object") return;
    const state = getExperienceWorkbenchState();
    const normalizedCandidateId = normalizeText(candidate.id);
    if (!normalizedCandidateId) return;
    const previousCandidate = findExperienceCandidateInState(normalizedCandidateId);
    const resolvedPreviousStatus = normalizeCandidateStatus(previousStatus || previousCandidate?.status);
    const nextStatus = normalizeCandidateStatus(candidate.status);
    state.items = Array.isArray(state.items)
      ? state.items.map((item) => String(item?.id || "") === normalizedCandidateId ? { ...item, ...candidate } : item)
      : [];
    state.draftItems = Array.isArray(state.draftItems)
      ? state.draftItems.filter((item) => String(item?.id || "") !== normalizedCandidateId)
      : [];
    if (String(state.selectedId || "") === normalizedCandidateId) {
      state.selectedCandidate = { ...(previousCandidate || {}), ...candidate };
    }
    state.stats = updateExperienceStatsForStatusTransition(state.stats, resolvedPreviousStatus, nextStatus);
  }

  async function loadExperienceWorkbenchUsageOverview() {
    if (!experienceWorkbenchUsageOverviewEl) return;
    if (!isConnected?.()) {
      renderExperienceWorkbenchUsageOverviewEmpty(t("experience.disconnected", {}, "Connect to the server to view experience candidates."));
      return;
    }
    if (typeof loadTaskUsageOverview !== "function" || typeof renderTaskUsageOverviewCard !== "function") {
      renderExperienceWorkbenchUsageOverviewEmpty(t("memory.usageOverviewEmpty", {}, "No usage data yet"));
      return;
    }
    const pending = loadTaskUsageOverview();
    renderExperienceWorkbenchUsageOverviewPanel();
    await pending;
    renderExperienceWorkbenchUsageOverviewPanel();
  }

  async function requestExperienceCandidateList(requestContext, input = {}) {
    const limit = Number.isInteger(input.limit) && input.limit > 0
      ? input.limit
      : EXPERIENCE_CANDIDATE_PAGE_SIZE;
    const offset = Number.isInteger(input.offset) && input.offset > 0 ? input.offset : 0;
    const params = {
      limit,
      offset,
      agentId: requestContext.agentId,
    };
    if (input.filter && typeof input.filter === "object") {
      params.filter = input.filter;
    }
    return sendReq({
      type: "req",
      id: makeId(),
      method: "experience.candidate.list",
      params,
    });
  }

  async function requestExperienceCandidateReview(candidateId, decision, options = {}) {
    const normalizedCandidateId = normalizeText(candidateId);
    const normalizedDecision = decision === "accept" || decision === "reject" ? decision : "";
    if (!normalizedCandidateId || !normalizedDecision) return null;
    const publishTargetPath = normalizeText(options.publishTargetPath);
    return sendReq({
      type: "req",
      id: makeId(),
      method: normalizedDecision === "accept" ? "experience.candidate.accept" : "experience.candidate.reject",
      params: {
        candidateId: normalizedCandidateId,
        agentId: getActiveAgentId(),
        ...(options.confirmed === true ? { confirmed: true } : {}),
        ...(publishTargetPath ? { publishTargetPath } : {}),
      },
    });
  }

  async function requestExperienceCandidateBulkReject(candidateType) {
    const normalizedCandidateType = typeof candidateType === "string" ? candidateType.trim().toLowerCase() : "";
    if (normalizedCandidateType !== "method" && normalizedCandidateType !== "skill") return null;
    return sendReq({
      type: "req",
      id: makeId(),
      method: "experience.candidate.reject_bulk",
      params: {
        agentId: getActiveAgentId(),
        filter: {
          type: normalizedCandidateType,
        },
      },
    });
  }

  async function requestPublishedExperienceAssetList(requestContext, input = {}) {
    const limit = Number.isInteger(input.limit) && input.limit > 0 ? input.limit : 200;
    return sendReq({
      type: "req",
      id: makeId(),
      method: "experience.asset.list",
      params: {
        agentId: requestContext.agentId,
        limit,
      },
    });
  }

  async function requestPublishedExperienceAssetRead(requestContext, assetPath) {
    const normalizedAssetPath = normalizeText(assetPath);
    if (!normalizedAssetPath) return null;
    return sendReq({
      type: "req",
      id: makeId(),
      method: "experience.asset.read",
      params: {
        agentId: requestContext.agentId,
        assetPath: normalizedAssetPath,
      },
    });
  }

  async function requestExperienceCandidateCleanupConsumed() {
    return sendReq({
      type: "req",
      id: makeId(),
      method: "experience.candidate.cleanup_consumed",
      params: {
        agentId: getActiveAgentId(),
      },
    });
  }

  async function requestExperienceCandidateSynthesizePreview(candidateId) {
    const normalizedCandidateId = normalizeText(candidateId);
    if (!normalizedCandidateId) return null;
    return sendReq({
      type: "req",
      id: makeId(),
      method: "experience.candidate.synthesize.preview",
      params: {
        candidateId: normalizedCandidateId,
        agentId: getActiveAgentId(),
        limit: 50,
      },
    });
  }

  async function requestExperienceCandidateSynthesizeCreate(candidateId, sourceCandidateIds = [], options = {}) {
    const normalizedCandidateId = normalizeText(candidateId);
    if (!normalizedCandidateId) return null;
    const normalizedSourceCandidateIds = Array.isArray(sourceCandidateIds)
      ? sourceCandidateIds.map((item) => normalizeText(item)).filter(Boolean)
      : [];
    const markSourcesConsumed = options?.markSourcesConsumed !== false;
    return sendReq({
      type: "req",
      id: makeId(),
      method: "experience.candidate.synthesize.create",
      timeoutMs: 420_000,
      params: {
        candidateId: normalizedCandidateId,
        agentId: getActiveAgentId(),
        ...(normalizedSourceCandidateIds.length ? { sourceCandidateIds: normalizedSourceCandidateIds } : {}),
        markSourcesConsumed,
      },
    });
  }

  function buildExperiencePublishConfirmMessage(candidate) {
    const safeCandidate = candidate && typeof candidate === "object" ? candidate : {};
    const title = normalizeText(safeCandidate.title)
      || normalizeText(safeCandidate.slug)
      || normalizeText(safeCandidate.id)
      || t("memory.candidateUntitled", {}, "Untitled Candidate");
    const typeLabel = formatCandidateTypeLabel(safeCandidate.type);
    return t(
      "experience.reviewAcceptConfirmMessage",
      { type: typeLabel, title },
      `Confirm accepting and publishing this ${typeLabel} candidate?\n\n${title}`,
    );
  }

  function buildExperienceOverwriteConfirmMessage(candidate, publishTargetPath) {
    const safeCandidate = candidate && typeof candidate === "object" ? candidate : {};
    const title = normalizeText(safeCandidate.title)
      || normalizeText(safeCandidate.slug)
      || normalizeText(safeCandidate.id)
      || t("memory.candidateUntitled", {}, "Untitled Candidate");
    const typeLabel = formatCandidateTypeLabel(safeCandidate.type);
    const pathLabel = summarizePathLabel(publishTargetPath || "");
    return t(
      "experience.reviewOverwriteConfirmMessage",
      { type: typeLabel, title, path: pathLabel },
      `确认接受并用这个 ${typeLabel} 候选覆盖原文件？\n\n${title}\n${pathLabel}`,
    );
  }

  async function loadAllExperienceCandidateItems(requestContext, input = {}) {
    const limit = Number.isInteger(input.limit) && input.limit > 0
      ? input.limit
      : EXPERIENCE_CANDIDATE_PAGE_SIZE;
    const maxPages = Number.isInteger(input.maxPages) && input.maxPages > 0
      ? input.maxPages
      : EXPERIENCE_CANDIDATE_MAX_PAGES;
    const items = [];
    let offset = 0;
    for (let page = 0; page < maxPages; page += 1) {
      const res = await requestExperienceCandidateList(requestContext, {
        limit,
        offset,
        filter: input.filter,
      });
      if (!isRequestCurrent(requestContext)) {
        return { ok: false, aborted: true };
      }
      if (!res || !res.ok) {
        return { ok: false, error: res?.error };
      }
      const pageItems = Array.isArray(res.payload?.items) ? res.payload.items : [];
      items.push(...pageItems);
      if (pageItems.length < limit) {
        return { ok: true, items };
      }
      offset += pageItems.length;
    }
    return { ok: true, items, truncated: true };
  }

  function applyBulkRejectedExperienceCandidates(candidateType, count) {
    const normalizedCandidateType = typeof candidateType === "string" ? candidateType.trim().toLowerCase() : "";
    if (normalizedCandidateType !== "method" && normalizedCandidateType !== "skill") return 0;
    const state = getExperienceWorkbenchState();
    const rejectedIds = new Set(
      (Array.isArray(state.draftItems) ? state.draftItems : [])
        .filter((item) => normalizeCandidateType(item?.type) === normalizedCandidateType)
        .map((item) => normalizeText(item?.id))
        .filter(Boolean),
    );
    const reviewedAt = new Date().toISOString();
    state.draftItems = Array.isArray(state.draftItems)
      ? state.draftItems.filter((item) => normalizeCandidateType(item?.type) !== normalizedCandidateType)
      : [];
    state.items = Array.isArray(state.items)
      ? state.items.map((item) => {
        const candidateId = normalizeText(item?.id);
        if (!candidateId || !rejectedIds.has(candidateId) || normalizeCandidateStatus(item?.status) !== "draft") {
          return item;
        }
        return {
          ...item,
          status: "rejected",
          reviewedAt: item?.reviewedAt || reviewedAt,
          rejectedAt: reviewedAt,
          acceptedAt: null,
        };
      })
      : [];
    if (rejectedIds.has(normalizeText(state.selectedCandidate?.id))) {
      state.selectedCandidate = {
        ...(state.selectedCandidate || {}),
        status: "rejected",
        reviewedAt: state.selectedCandidate?.reviewedAt || reviewedAt,
        rejectedAt: reviewedAt,
        acceptedAt: null,
      };
    }
    state.stats = updateExperienceStatsForBulkReject(state.stats, count);
    return rejectedIds.size;
  }

  function applyCreatedExperienceCandidate(candidate) {
    if (!candidate || typeof candidate !== "object") return;
    const normalizedCandidateId = normalizeText(candidate.id);
    if (!normalizedCandidateId) return;
    const state = getExperienceWorkbenchState();
    state.items = upsertExperienceCandidateList(state.items, candidate);
    state.draftItems = upsertExperienceCandidateList(state.draftItems, candidate, { draftOnly: true });
    state.selectedId = normalizedCandidateId;
    state.selectedCandidate = {
      ...(findExperienceCandidateInState(normalizedCandidateId) || {}),
      ...candidate,
    };
    state.stats = mergeExperienceStats(state.stats, countExperienceStats(state.items));
  }

  function renderExperienceSynthesisModal() {
    if (
      !experienceSynthesisModalEl
      || !experienceSynthesisModalTitleEl
      || !experienceSynthesisModalSummaryEl
      || !experienceSynthesisModalStatusEl
      || !experienceSynthesisModalListEl
      || !experienceSynthesisModalSubmitBtn
      || !experienceSynthesisModalCancelBtn
      || !experienceSynthesisModalCloseBtn
    ) {
      return;
    }

    const modalState = getSynthesisModalState();
    const preview = modalState.preview && typeof modalState.preview === "object" ? modalState.preview : null;
    const seedCandidate = preview?.seedCandidate || findExperienceCandidateInState(modalState.seedCandidateId);
    const createdCandidate = modalState.createdCandidate && typeof modalState.createdCandidate === "object"
      ? modalState.createdCandidate
      : null;
    const createdCandidateId = normalizeText(createdCandidate?.id);
    const createdCandidateTitle = normalizeText(createdCandidate?.title)
      || normalizeText(createdCandidate?.slug)
      || createdCandidateId;
    const candidateType = normalizeCandidateType(preview?.candidateType || seedCandidate?.type);
    const isSkill = candidateType === "skill";
    const totalCount = Number(preview?.totalCount);
    const taskCount = Number(preview?.taskCount);
    const sourceCandidateIds = Array.isArray(preview?.sourceCandidateIds)
      ? preview.sourceCandidateIds.map((item) => normalizeText(item)).filter(Boolean)
      : [];
    const sameFamilyCount = Number(preview?.sameFamilyCount);
    const similarCount = Number(preview?.similarCount);
    const selectedSameFamilyCount = Number(preview?.selectedSameFamilyCount);
    const selectedSourceCount = Number(preview?.selectedSourceCount);
    const selectedSimilarCount = Number(preview?.selectedSimilarCount);
    const maxSimilarSourceCount = Number(preview?.maxSimilarSourceCount);
    const templatePath = normalizeText(preview?.templateInfo?.path);
    const seedTitle = normalizeText(seedCandidate?.title)
      || normalizeText(seedCandidate?.slug)
      || normalizeText(seedCandidate?.id)
      || t("memory.candidateUntitled", {}, "Untitled Candidate");
    const seedDisplayTaskId = resolveExperienceDisplayTaskId(seedCandidate);
    const overwriteTargetPath = normalizeText(modalState.seedAssetPath);
    const seedContent = normalizeText(seedCandidate?.content);
    const createdContent = normalizeText(createdCandidate?.content);
    const showOverwriteCompare = Boolean(createdCandidateId && overwriteTargetPath && seedContent && createdContent);
    const previewItems = Array.isArray(preview?.items) ? preview.items : [];
    const derivedSameFamilyCount = previewItems.filter((item) => normalizeText(item?.relation).toLowerCase() === "same_family").length;
    const derivedSimilarCount = Math.max(0, previewItems.length - derivedSameFamilyCount);
    const effectiveSameFamilyCount = Number.isFinite(sameFamilyCount) && sameFamilyCount >= 0
      ? sameFamilyCount
      : derivedSameFamilyCount;
    const effectiveSimilarCount = Number.isFinite(similarCount) && similarCount >= 0
      ? similarCount
      : derivedSimilarCount;
    const effectiveSelectedSourceCount = Number.isFinite(selectedSourceCount) && selectedSourceCount > 0
      ? selectedSourceCount
      : sourceCandidateIds.length;
    const effectiveSelectedSameFamilyCount = Number.isFinite(selectedSameFamilyCount) && selectedSameFamilyCount >= 0
      ? selectedSameFamilyCount
      : Math.min(effectiveSameFamilyCount, Math.max(0, effectiveSelectedSourceCount - 1));
    const effectiveSelectedSimilarCount = Number.isFinite(selectedSimilarCount) && selectedSimilarCount >= 0
      ? selectedSimilarCount
      : Math.max(0, Math.max(0, effectiveSelectedSourceCount - 1) - effectiveSelectedSameFamilyCount);
    const effectiveMaxSimilarSourceCount = Number.isFinite(maxSimilarSourceCount) && maxSimilarSourceCount > 0
      ? maxSimilarSourceCount
      : Math.max(0, effectiveSelectedSameFamilyCount + effectiveSelectedSimilarCount);
    const statusText = modalState.loading
      ? t("experience.synthesizeModalLoading", {}, "正在检索同类与近似草稿…")
      : modalState.error
        ? modalState.error
        : createdCandidateId
          ? t(
            "experience.synthesizeModalCreatedStatus",
            { title: createdCandidateTitle || t("memory.candidateUntitled", {}, "Untitled Candidate") },
            `已生成新草稿：${createdCandidateTitle || t("memory.candidateUntitled", {}, "Untitled Candidate")}。可直接继续接受并发布，或先关闭窗口稍后处理。`,
          )
        : (Number.isFinite(totalCount)
            && totalCount > 1
            && effectiveMaxSimilarSourceCount > 0
          ? t(
            "experience.synthesizeModalSelectionNotice",
            {
              total: String(totalCount),
              sameFamily: String(effectiveSameFamilyCount),
              selected: String(effectiveSelectedSourceCount),
              selectedSameFamily: String(effectiveSelectedSameFamilyCount),
              similar: String(effectiveSelectedSimilarCount),
              matchedSimilar: String(effectiveSimilarCount),
              max: String(effectiveMaxSimilarSourceCount),
            },
            `共命中 ${totalCount} 个候选，其中同类 ${effectiveSameFamilyCount} 个、近似 ${effectiveSimilarCount} 个。系统会优先选择同类草稿；若不足 ${effectiveMaxSimilarSourceCount} 个相似来源，再从近似草稿补位。本次将提交 ${effectiveSelectedSourceCount} 条来源，其中同类 ${effectiveSelectedSameFamilyCount} 个、近似 ${effectiveSelectedSimilarCount} 个。`,
          )
          : "");

    experienceSynthesisModalEl.classList.toggle("hidden", !modalState.open);
    experienceSynthesisModalTitleEl.textContent = isSkill
      ? t("experience.synthesizeModalTitleSkill", {}, "合成 Skill 草稿")
      : t("experience.synthesizeModalTitleMethod", {}, "合成 Method 草稿");

    experienceSynthesisModalSummaryEl.innerHTML = `
      <div class="memory-detail-card">
        <span class="memory-detail-label">${escapeHtml(t("experience.synthesizeModalTotal", {}, "候选总数"))}</span>
        <div class="memory-detail-text">${escapeHtml(Number.isFinite(totalCount) ? String(totalCount) : "--")}</div>
      </div>
      <div class="memory-detail-card">
        <span class="memory-detail-label">${escapeHtml(t("experience.synthesizeModalTaskCount", {}, "涉及任务数"))}</span>
        <div class="memory-detail-text">${escapeHtml(Number.isFinite(taskCount) ? String(taskCount) : "--")}</div>
      </div>
      <div class="memory-detail-card">
        <span class="memory-detail-label">${escapeHtml(t("experience.synthesizeModalSeedLabel", {}, "种子草稿"))}</span>
        <div class="memory-detail-text">${escapeHtml(seedTitle)}</div>
      </div>
      <div class="memory-detail-card">
        <span class="memory-detail-label">${escapeHtml(t("experience.synthesizeModalSameFamilyCount", {}, "同类命中"))}</span>
        <div class="memory-detail-text">${escapeHtml(Number.isFinite(effectiveSameFamilyCount) ? String(effectiveSameFamilyCount) : "--")}</div>
      </div>
      <div class="memory-detail-card">
        <span class="memory-detail-label">${escapeHtml(t("experience.synthesizeModalSimilarCount", {}, "近似命中"))}</span>
        <div class="memory-detail-text">${escapeHtml(Number.isFinite(effectiveSimilarCount) ? String(effectiveSimilarCount) : "--")}</div>
      </div>
      <div class="memory-detail-card">
        <span class="memory-detail-label">${escapeHtml(t("experience.synthesizeModalSelectedCount", {}, "本次参与"))}</span>
        <div class="memory-detail-text">${escapeHtml(Number.isFinite(effectiveSelectedSourceCount) ? String(effectiveSelectedSourceCount) : "--")}</div>
      </div>
      <div class="memory-detail-card">
        <span class="memory-detail-label">${escapeHtml(t("experience.synthesizeModalSelectedMixLabel", {}, "参与构成"))}</span>
        <div class="memory-detail-text">${escapeHtml(t(
          "experience.synthesizeModalSelectedMixValue",
          {
            sameFamily: String(Number.isFinite(effectiveSelectedSameFamilyCount) ? effectiveSelectedSameFamilyCount : 0),
            similar: String(Number.isFinite(effectiveSelectedSimilarCount) ? effectiveSelectedSimilarCount : 0),
          },
          `同类 ${Number.isFinite(effectiveSelectedSameFamilyCount) ? effectiveSelectedSameFamilyCount : 0} · 近似 ${Number.isFinite(effectiveSelectedSimilarCount) ? effectiveSelectedSimilarCount : 0}`,
        ))}</div>
      </div>
      <div class="memory-detail-card">
        <span class="memory-detail-label">${escapeHtml(t("experience.synthesizeModalTemplateLabel", {}, "模板"))}</span>
        <div class="memory-detail-text">${escapeHtml(templatePath ? summarizePathLabel(templatePath) : "-")}</div>
      </div>
      ${createdCandidateId ? `
        <div class="memory-detail-card">
          <span class="memory-detail-label">${escapeHtml(t("experience.synthesizeModalCreatedDraftLabel", {}, "新草稿"))}</span>
          <div class="memory-detail-text">${escapeHtml(createdCandidateTitle || createdCandidateId)}</div>
        </div>
      ` : ""}
      ${showOverwriteCompare ? `
        <div class="memory-detail-card">
          <span class="memory-detail-label">${escapeHtml(t("experience.synthesizeModalOverwriteTargetLabel", {}, "覆盖目标"))}</span>
          <div class="memory-detail-text">${escapeHtml(summarizePathLabel(overwriteTargetPath))}</div>
        </div>
      ` : ""}
    `;

    if (experienceSynthesisModalConsumeSourcesEl) {
      experienceSynthesisModalConsumeSourcesEl.checked = modalState.markSourcesConsumed !== false;
      experienceSynthesisModalConsumeSourcesEl.disabled = modalState.submitting;
    }
    if (experienceSynthesisModalConsumeSourcesLabelEl) {
      experienceSynthesisModalConsumeSourcesLabelEl.textContent = t(
        "experience.synthesizeConsumeSourcesLabel",
        {},
        "合成成功后，将本次参与的旧草稿标记为已消化",
      );
    }

    experienceSynthesisModalStatusEl.classList.toggle("hidden", !statusText);
    experienceSynthesisModalStatusEl.textContent = statusText;

    if (modalState.loading) {
      experienceSynthesisModalListEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(t("experience.synthesizeModalLoading", {}, "正在检索同类与近似草稿…"))}</div>`;
    } else if (!previewItems.length && !seedCandidate) {
      experienceSynthesisModalListEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(t("experience.synthesizeModalEmpty", {}, "没有可用于合成的近似草稿。"))}</div>`;
    } else {
      const rows = [];
      if (showOverwriteCompare) {
        rows.push(`
          <div class="memory-detail-card">
            <div class="goal-summary-header">
              <div>
                <div class="goal-summary-title">${escapeHtml(t("experience.overwriteCompareTitle", {}, "覆盖前对比"))}</div>
                <div class="goal-summary-text">${escapeHtml(t("experience.overwriteCompareSummary", {}, "左侧为当前已发布资产，右侧为本次新合成草稿。确认无误后再执行覆盖。"))}</div>
              </div>
            </div>
            <div class="memory-detail-grid">
              <div class="memory-detail-card">
                <span class="memory-detail-label">${escapeHtml(t("experience.overwriteCompareCurrent", {}, "当前已发布资产"))}</span>
                <pre class="memory-detail-pre">${escapeHtml(seedContent)}</pre>
              </div>
              <div class="memory-detail-card">
                <span class="memory-detail-label">${escapeHtml(t("experience.overwriteCompareNext", {}, "新合成草稿"))}</span>
                <pre class="memory-detail-pre">${escapeHtml(createdContent)}</pre>
              </div>
            </div>
          </div>
        `);
      }
      if (seedCandidate) {
        rows.push(`
          <div class="experience-synthesis-row experience-candidate-synthesized" data-synthesis-preview-candidate-id="${escapeHtml(String(seedCandidate.id || ""))}">
            <div class="experience-synthesis-row-main">
              <div class="experience-synthesis-row-title">${escapeHtml(seedTitle)}</div>
              <div class="experience-synthesis-row-meta">
                <span>${escapeHtml(formatCandidateTypeLabel(candidateType))}</span>
                <span>${escapeHtml(formatCandidateStatusLabel(seedCandidate.status))}</span>
                ${seedDisplayTaskId ? `<span>${escapeHtml(t("experience.listTaskLabel", {}, "Task"))} ${escapeHtml(seedDisplayTaskId)}</span>` : ""}
              </div>
              <div class="experience-synthesis-row-summary">${escapeHtml(normalizeText(seedCandidate.summary) || t("experience.listNoSummary", {}, "No summary yet."))}</div>
            </div>
            <div class="experience-synthesis-row-side">
              <span class="memory-badge experience-synthesized-badge">${escapeHtml(t("experience.synthesizeModalSeedLabel", {}, "种子草稿"))}</span>
            </div>
          </div>
        `);
      }
      previewItems.forEach((item) => {
        const displayTaskId = normalizeText(item?.sourceTaskId) || normalizeText(item?.taskId);
        rows.push(`
          <div class="experience-synthesis-row" data-synthesis-preview-candidate-id="${escapeHtml(String(item?.candidateId || ""))}">
            <div class="experience-synthesis-row-main">
              <div class="experience-synthesis-row-title">${escapeHtml(item?.title || item?.slug || item?.candidateId || t("memory.candidateUntitled", {}, "Untitled Candidate"))}</div>
              <div class="experience-synthesis-row-meta">
                <span>${escapeHtml(formatCandidateStatusLabel(item?.status))}</span>
                ${displayTaskId ? `<span>${escapeHtml(t("experience.listTaskLabel", {}, "Task"))} ${escapeHtml(displayTaskId)}</span>` : ""}
                <span>score ${escapeHtml(Number.isFinite(Number(item?.score)) ? Number(item.score).toFixed(2) : "--")}</span>
              </div>
              <div class="experience-synthesis-row-summary">${escapeHtml(normalizeText(item?.summary) || t("experience.listNoSummary", {}, "No summary yet."))}</div>
            </div>
            <div class="experience-synthesis-row-side">
              <span class="memory-badge">${escapeHtml(formatSynthesisRelationLabel(item?.relation))}</span>
            </div>
          </div>
        `);
      });
      experienceSynthesisModalListEl.innerHTML = rows.join("");
    }

    experienceSynthesisModalSubmitBtn.textContent = createdCandidateId
      ? (modalState.submitting
        ? (showOverwriteCompare
          ? t("experience.synthesizeOverwriteCreatedBusy", {}, "覆盖发布中…")
          : t("experience.synthesizeAcceptCreatedBusy", {}, "接受并发布中…"))
        : (showOverwriteCompare
          ? t("experience.synthesizeOverwriteCreated", {}, "接受并覆盖原文件")
          : t("experience.synthesizeAcceptCreated", {}, "接受并发布新草稿")))
      : (modalState.submitting
        ? (isSkill
          ? t("experience.synthesizeSubmitBusySkill", {}, "合成 Skill 中…")
          : t("experience.synthesizeSubmitBusyMethod", {}, "合成 Method 中…"))
        : (isSkill
          ? t("experience.synthesizeSubmitSkill", {}, "合成 Skill")
          : t("experience.synthesizeSubmitMethod", {}, "合成 Method")));
    experienceSynthesisModalSubmitBtn.disabled = modalState.loading
      || modalState.submitting
      || (!createdCandidateId && !sourceCandidateIds.length);
    experienceSynthesisModalCancelBtn.disabled = modalState.submitting;
    experienceSynthesisModalCloseBtn.disabled = modalState.submitting;
  }

  function closeExperienceSynthesisModal(options = {}) {
    const modalState = getSynthesisModalState();
    const force = options?.force === true;
    if (modalState.submitting && !force) {
      return;
    }
    modalState.open = false;
    modalState.loading = false;
    modalState.submitting = false;
    modalState.error = "";
    modalState.seedCandidateId = "";
    modalState.seedAssetPath = "";
    modalState.preview = null;
    modalState.markSourcesConsumed = true;
    modalState.createdCandidate = null;
    renderExperienceSynthesisModal();
  }

  async function openExperienceSynthesisModal(candidateId) {
    const normalizedCandidateId = normalizeText(candidateId);
    if (!normalizedCandidateId) return null;
    if (!isConnected?.()) {
      showNotice(
        t("experience.synthesizePreviewFailedTitle", {}, "合成预览失败"),
        t("experience.disconnected", {}, "Connect to the server to view experience candidates."),
        "error",
      );
      return null;
    }
    if (getPendingActionKey()) return null;

    const modalState = getSynthesisModalState();
    modalState.open = true;
    modalState.loading = true;
    modalState.submitting = false;
    modalState.error = "";
    modalState.seedCandidateId = normalizedCandidateId;
    modalState.seedAssetPath = "";
    modalState.preview = null;
    modalState.markSourcesConsumed = true;
    modalState.createdCandidate = null;
    renderExperienceSynthesisModal();

    const memoryViewerState = typeof getMemoryViewerState === "function" ? getMemoryViewerState() : null;
    if (memoryViewerState) {
      memoryViewerState.pendingExperienceActionKey = `synthesize-preview:${normalizedCandidateId}`;
    }
    renderExperienceWorkbenchCapabilityOverviewPanel();
    syncGenerateControls();

    try {
      const res = await requestExperienceCandidateSynthesizePreview(normalizedCandidateId);
      if (!res || !res.ok) {
        modalState.error = res?.error?.message || t("experience.synthesizePreviewFailedTitle", {}, "合成预览失败");
        showNotice(
          t("experience.synthesizePreviewFailedTitle", {}, "合成预览失败"),
          modalState.error,
          "error",
        );
        return null;
      }
      modalState.preview = res.payload ?? null;
      return res.payload ?? null;
    } finally {
      modalState.loading = false;
      if (memoryViewerState) {
        memoryViewerState.pendingExperienceActionKey = null;
      }
      renderExperienceWorkbenchCapabilityOverviewPanel();
      syncGenerateControls();
      renderExperienceSynthesisModal();
    }
  }

  async function openExperienceSynthesisModalByAssetPath(assetPath) {
    const normalizedAssetPath = normalizeText(assetPath);
    if (!normalizedAssetPath) return null;
    if (!isConnected?.()) {
      showNotice(
        t("experience.synthesizePreviewFailedTitle", {}, "合成预览失败"),
        t("experience.disconnected", {}, "Connect to the server to view experience candidates."),
        "error",
      );
      return null;
    }
    if (getPendingActionKey()) return null;

    const modalState = getSynthesisModalState();
    modalState.open = true;
    modalState.loading = true;
    modalState.submitting = false;
    modalState.error = "";
    modalState.seedCandidateId = "";
    modalState.seedAssetPath = normalizedAssetPath;
    modalState.preview = null;
    modalState.markSourcesConsumed = true;
    modalState.createdCandidate = null;
    renderExperienceSynthesisModal();

    const memoryViewerState = typeof getMemoryViewerState === "function" ? getMemoryViewerState() : null;
    if (memoryViewerState) {
      memoryViewerState.pendingExperienceActionKey = `synthesize-preview:asset:${normalizedAssetPath}`;
    }
    renderExperienceWorkbenchCapabilityOverviewPanel();
    syncGenerateControls();

    try {
      const res = await sendReq({
        type: "req",
        id: makeId(),
        method: "experience.candidate.synthesize.preview",
        params: {
          assetPath: normalizedAssetPath,
          agentId: getActiveAgentId(),
          limit: 50,
        },
      });
      if (!res || !res.ok) {
        modalState.error = res?.error?.message || t("experience.synthesizePreviewFailedTitle", {}, "合成预览失败");
        showNotice(
          t("experience.synthesizePreviewFailedTitle", {}, "合成预览失败"),
          modalState.error,
          "error",
        );
        return null;
      }
      modalState.preview = res.payload ?? null;
      return res.payload ?? null;
    } finally {
      modalState.loading = false;
      if (memoryViewerState) {
        memoryViewerState.pendingExperienceActionKey = null;
      }
      renderExperienceWorkbenchCapabilityOverviewPanel();
      syncGenerateControls();
      renderExperienceSynthesisModal();
    }
  }

  async function submitExperienceSynthesis() {
    const modalState = getSynthesisModalState();
    const preview = modalState.preview && typeof modalState.preview === "object" ? modalState.preview : null;
    const createdCandidateRecord = modalState.createdCandidate && typeof modalState.createdCandidate === "object"
      ? modalState.createdCandidate
      : null;
    const createdCandidateId = normalizeText(modalState.createdCandidate?.id);
    const candidateId = normalizeText(modalState.seedCandidateId);
    const assetPath = normalizeText(modalState.seedAssetPath);
    const sourceCandidateIds = Array.isArray(preview?.sourceCandidateIds)
      ? preview.sourceCandidateIds.map((item) => normalizeText(item)).filter(Boolean)
      : [];
    const markSourcesConsumed = modalState.markSourcesConsumed !== false;
    if (createdCandidateId) {
      if (!isConnected?.() || getPendingActionKey()) {
        return null;
      }
      modalState.submitting = true;
      modalState.error = "";
      renderExperienceWorkbenchCapabilityOverviewPanel();
      syncGenerateControls();
      renderExperienceSynthesisModal();
      try {
        const acceptedCandidate = await reviewExperienceCandidate(createdCandidateId, "accept", assetPath
          ? {
            publishTargetPath: assetPath,
            confirmMessage: buildExperienceOverwriteConfirmMessage(createdCandidateRecord, assetPath),
          }
          : {});
        if (acceptedCandidate) {
          closeExperienceSynthesisModal({ force: true });
          return acceptedCandidate;
        }
        return null;
      } finally {
        modalState.submitting = false;
        renderExperienceWorkbenchCapabilityOverviewPanel();
        syncGenerateControls();
        renderExperienceSynthesisModal();
      }
    }
    if ((!candidateId && !assetPath) || !sourceCandidateIds.length) {
      return null;
    }
    if (!isConnected?.()) {
      showNotice(
        t("experience.synthesizeCreateFailedTitle", {}, "合成失败"),
        t("experience.disconnected", {}, "Connect to the server to view experience candidates."),
        "error",
      );
      return null;
    }
    if (getPendingActionKey()) return null;

    const memoryViewerState = typeof getMemoryViewerState === "function" ? getMemoryViewerState() : null;
    if (memoryViewerState) {
      memoryViewerState.pendingExperienceActionKey = candidateId
        ? `synthesize-create:${candidateId}`
        : `synthesize-create:asset:${assetPath}`;
    }
    modalState.submitting = true;
    modalState.error = "";
    renderExperienceWorkbenchCapabilityOverviewPanel();
    syncGenerateControls();
    renderExperienceSynthesisModal();

    try {
      const res = await sendReq({
        type: "req",
        id: makeId(),
        method: "experience.candidate.synthesize.create",
        timeoutMs: 420_000,
        params: {
          ...(candidateId ? { candidateId } : {}),
          ...(assetPath ? { assetPath } : {}),
          agentId: getActiveAgentId(),
          ...(sourceCandidateIds.length ? { sourceCandidateIds } : {}),
          markSourcesConsumed,
        },
      });
      if (!res || !res.ok) {
        modalState.error = res?.error?.message || t("experience.synthesizeCreateFailedTitle", {}, "合成失败");
        showNotice(
          t("experience.synthesizeCreateFailedTitle", {}, "合成失败"),
          modalState.error,
          "error",
        );
        return null;
      }

      const createdCandidate = res.payload?.candidate ?? null;
      modalState.createdCandidate = createdCandidate;
      modalState.error = "";
      const consumedSourceCount = Number(res.payload?.consumedSourceCount);
      showNotice(
        t("experience.synthesizeCreateSuccessTitle", {}, "合成草稿已创建"),
        markSourcesConsumed
          ? t(
            "experience.synthesizeCreateSuccessMessageConsumed",
            {
              count: String(Number(res.payload?.sourceCount) || sourceCandidateIds.length),
              consumed: String(Number.isFinite(consumedSourceCount) ? consumedSourceCount : 0),
            },
            `已生成新的合成 draft，并汇总 ${sourceCandidateIds.length} 个来源草稿；其中 ${Number.isFinite(consumedSourceCount) ? consumedSourceCount : 0} 个旧草稿已标记为已消化。`,
          )
          : t(
            "experience.synthesizeCreateSuccessMessage",
            { count: String(Number(res.payload?.sourceCount) || sourceCandidateIds.length) },
            `已生成新的合成 draft，并汇总 ${sourceCandidateIds.length} 个来源草稿。`,
          ),
        "success",
        2800,
      );
      if (createdCandidate?.id) {
        applyCreatedExperienceCandidate(createdCandidate);
        await syncExperienceWorkbenchUi({ preferFirst: false, loadDetailIfNeeded: false });
      }
      await loadExperienceWorkbench(false);
      renderExperienceSynthesisModal();
      return createdCandidate;
    } finally {
      modalState.submitting = false;
      if (memoryViewerState) {
        memoryViewerState.pendingExperienceActionKey = null;
      }
      renderExperienceWorkbenchCapabilityOverviewPanel();
      syncGenerateControls();
      renderExperienceSynthesisModal();
    }
  }

  function renderExperienceAggregatePanel(candidate) {
    if (!candidate || typeof candidate !== "object") return "";
    const compactGovernanceDetailMode = isCompactGovernanceDetailMode();
    const snapshot = candidate.sourceTaskSnapshot && typeof candidate.sourceTaskSnapshot === "object"
      ? candidate.sourceTaskSnapshot
      : {};
    const contextTargets = extractCandidateContextTargets(candidate);
    const memoryLinks = Array.isArray(snapshot.memoryLinks) ? snapshot.memoryLinks : [];
    const artifactPaths = Array.isArray(snapshot.artifactPaths) ? snapshot.artifactPaths : [];
    const toolCalls = Array.isArray(snapshot.toolCalls) ? snapshot.toolCalls : [];
    const learningReviewInput = candidate.learningReviewInput && typeof candidate.learningReviewInput === "object"
      ? candidate.learningReviewInput
      : null;
    const memoryFreshness = candidate.memoryFreshness && typeof candidate.memoryFreshness === "object"
      ? candidate.memoryFreshness
      : null;
    const skillFreshness = candidate.skillFreshness && typeof candidate.skillFreshness === "object"
      ? candidate.skillFreshness
      : null;
    const normalizedType = normalizeCandidateType(candidate.type);
    const indexTab = normalizedType === "skill" ? "skills" : "methods";
    const indexLabel = normalizedType === "skill"
      ? t("experience.openSkillsTab", {}, "进入技能列表")
      : t("experience.openMethodsTab", {}, "进入方法列表");
    const displayTaskId = resolveExperienceDisplayTaskId(candidate);
    const publishedLabel = candidate.publishedPath
      ? summarizePathLabel(candidate.publishedPath)
      : t("experience.aggregateNotPublished", {}, "未发布");
    const learningHeadline = learningReviewInput?.summary?.headline
      || learningReviewInput?.summaryLines?.[0]
      || "-";
    const toolCallCount = toolCalls.length;
    const synthesized = isSynthesizedCandidate(candidate);
    const synthesisSourceCount = getSynthesisSourceCount(candidate);
    const synthesisConsumedInfo = getSynthesisConsumedInfo(candidate);
    return `
      <div class="memory-detail-card">
        <div class="goal-summary-header">
          <div>
            <div class="goal-summary-title">${escapeHtml(t("experience.aggregateTitle", {}, "候选聚合视图"))}</div>
            <div class="goal-summary-text">${escapeHtml(t("experience.aggregateSummary", {}, "把候选状态、来源上下文和已发布资产入口压缩到一处，便于快速决策。"))}</div>
          </div>
          <div class="memory-detail-badges">
            <span class="memory-badge">${escapeHtml(formatCandidateTypeLabel(candidate.type))}</span>
            <span class="memory-badge">${escapeHtml(formatCandidateStatusLabel(candidate.status))}</span>
            ${synthesized ? `<span class="memory-badge experience-synthesized-badge">${escapeHtml(t("experience.synthesizedBadge", { count: String(synthesisSourceCount || 0) }, synthesisSourceCount > 0 ? `合成稿 · ${synthesisSourceCount}` : "合成稿"))}</span>` : ""}
            ${candidate.publishedPath ? `<span class="memory-badge memory-badge-shared">${escapeHtml(t("experience.listPublishedBadge", {}, "Published"))}</span>` : ""}
            ${skillFreshness?.summary || skillFreshness?.status ? `<span class="memory-badge">${escapeHtml(String(skillFreshness.summary || skillFreshness.status))}</span>` : ""}
          </div>
        </div>
        ${renderExperienceCandidateFreshnessSummary(memoryFreshness, escapeHtml)}
        <div class="memory-detail-grid">
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("experience.aggregateTaskLabel", {}, "来源任务"))}</span><div class="memory-detail-text">${displayTaskId ? `<button class="memory-path-link" data-open-task-id="${escapeHtml(displayTaskId)}">${escapeHtml(displayTaskId)}</button>` : "-"}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("experience.aggregateSlugLabel", {}, "标识"))}</span><div class="memory-detail-text">${escapeHtml(candidate.slug || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("experience.aggregatePublishedLabel", {}, "发布资产"))}</span><div class="memory-detail-text">${candidate.publishedPath ? `<button class="memory-path-link" data-open-source="${escapeHtml(candidate.publishedPath)}">${escapeHtml(publishedLabel)}</button>` : escapeHtml(publishedLabel)}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("experience.aggregateUpdatedLabel", {}, "最近更新时间"))}</span><div class="memory-detail-text">${escapeHtml(formatDateTime(candidate.updatedAt || candidate.createdAt))}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("experience.aggregateMemoriesLabel", {}, "来源记忆"))}</span><div class="memory-detail-text">${escapeHtml(String(memoryLinks.length || contextTargets.memoryCount || 0))}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("experience.aggregateArtifactsLabel", {}, "来源产物"))}</span><div class="memory-detail-text">${escapeHtml(String(artifactPaths.length || contextTargets.artifactCount || 0))}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("experience.aggregateToolCallsLabel", {}, "工具调用"))}</span><div class="memory-detail-text">${escapeHtml(String(toolCallCount))}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("experience.aggregateLearningLabel", {}, "Learning / Review"))}</span><div class="memory-detail-text">${escapeHtml(learningHeadline)}</div></div>
          ${compactGovernanceDetailMode ? "" : synthesized ? `<div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("experience.aggregateSynthesizedLabel", {}, "草稿来源"))}</span><div class="memory-detail-text">${escapeHtml(t("experience.synthesizedBadge", { count: String(synthesisSourceCount || 0) }, synthesisSourceCount > 0 ? `合成稿 · ${synthesisSourceCount}` : "合成稿"))}</div></div>` : ""}
          ${compactGovernanceDetailMode ? "" : synthesized ? `<div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("experience.aggregateSynthesisSourcesLabel", {}, "合成来源数"))}</span><div class="memory-detail-text">${escapeHtml(String(synthesisSourceCount || 0))}</div></div>` : ""}
          ${compactGovernanceDetailMode ? "" : synthesisConsumedInfo ? `<div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("experience.aggregateConsumedLabel", {}, "已消化状态"))}</span><div class="memory-detail-text">${synthesisConsumedInfo.consumedByCandidateId ? `<button class="memory-path-link" data-open-candidate-id="${escapeHtml(synthesisConsumedInfo.consumedByCandidateId)}">${escapeHtml(t("experience.aggregateConsumedValue", { id: synthesisConsumedInfo.consumedByCandidateId }, `已被合成稿 ${synthesisConsumedInfo.consumedByCandidateId} 消化`))}</button>` : escapeHtml(t("experience.aggregateConsumedFallback", {}, "已被后续合成消化"))}</div></div>` : ""}
          ${compactGovernanceDetailMode ? "" : synthesisConsumedInfo ? `<div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("experience.aggregateConsumedAtLabel", {}, "消化时间"))}</span><div class="memory-detail-text">${escapeHtml(synthesisConsumedInfo.consumedAt ? formatDateTime(synthesisConsumedInfo.consumedAt) : "-")}</div></div>` : ""}
        </div>
        <div class="goal-detail-actions">
          ${contextTargets.sourceTaskId ? `<button class="button goal-inline-action-secondary" data-open-task-id="${escapeHtml(contextTargets.sourceTaskId)}">${escapeHtml(t("memory.contextOpenSourceTask", {}, "打开来源任务"))}</button>` : ""}
          ${contextTargets.publishedPath ? `<button class="button goal-inline-action-secondary" data-open-source="${escapeHtml(contextTargets.publishedPath)}">${escapeHtml(t("memory.contextOpenPublishedArtifact", {}, "打开发布产物"))}</button>` : ""}
          <button class="button goal-inline-action-secondary" data-open-tool-settings-tab="${escapeHtml(indexTab)}">${escapeHtml(indexLabel)}</button>
        </div>
      </div>
    `;
  }

  function renderSelectedExperienceCandidate() {
    const state = getExperienceWorkbenchState();
    if (!experienceWorkbenchDetailEl) return;
    if (!state.selectedCandidate) {
      renderExperienceWorkbenchDetailEmpty(t("experience.detailSelect", {}, "Select a candidate on the left to view details."));
      return;
    }
    experienceWorkbenchDetailEl.innerHTML = `
      <div class="memory-detail-shell">
        ${renderExperienceAggregatePanel(state.selectedCandidate)}
        ${renderCandidateDetailPanel(state.selectedCandidate)}
      </div>
    `;
    bindExperienceWorkbenchDetailActions();
  }

  async function loadPublishedExperienceAssetDetail(assetPath, requestContext = null) {
    const state = ensurePublishedAssetState();
    const normalizedAssetPath = normalizeText(assetPath);
    if (!normalizedAssetPath) {
      state.selectedAssetPath = "";
      state.selectedAsset = null;
      state.selectedAssetLoading = false;
      state.selectedAssetError = "";
      renderExperienceWorkbenchAssetsPanel();
      return;
    }

    state.selectedAssetPath = normalizedAssetPath;
    state.selectedAsset = null;
    state.selectedAssetLoading = true;
    state.selectedAssetError = "";
    if (getActiveTab() !== "assets") {
      setActiveTab("assets");
      syncExperienceWorkbenchTabUi();
    }
    renderExperienceWorkbenchAssetsPanel();

    const activeRequest = requestContext ?? {
      requestToken: Number(state.requestToken || 0),
      agentId: String(state.activeAgentId || getActiveAgentId()).trim() || "default",
    };
    const res = await requestPublishedExperienceAssetRead(activeRequest, normalizedAssetPath);
    if (!isRequestCurrent(activeRequest)) {
      return;
    }

    state.selectedAssetLoading = false;
    if (!res || !res.ok) {
      state.selectedAsset = null;
      state.selectedAssetError = res?.error?.message || t("experience.assetsDetailLoadFailed", {}, "已发布资产详情加载失败。");
      renderExperienceWorkbenchAssetsPanel();
      return;
    }
    state.selectedAsset = res.payload?.asset ?? null;
    state.selectedAssetError = "";
    renderExperienceWorkbenchAssetsPanel();
  }

  async function loadExperienceCandidateDetail(candidateId, requestContext = null) {
    const state = getExperienceWorkbenchState();
    const normalizedCandidateId = typeof candidateId === "string" ? candidateId.trim() : "";
    if (!normalizedCandidateId) {
      state.selectedId = null;
      state.selectedCandidate = null;
      renderExperienceWorkbenchList(getFilteredExperienceItems());
      renderExperienceWorkbenchDetailEmpty(t("experience.detailSelect", {}, "Select a candidate on the left to view details."));
      return;
    }

    state.selectedId = normalizedCandidateId;
    renderExperienceWorkbenchList(getFilteredExperienceItems());
    renderExperienceWorkbenchDetailEmpty(t("experience.detailLoading", {}, "Loading candidate details..."));

    const activeRequest = requestContext ?? {
      requestToken: Number(state.requestToken || 0),
      agentId: String(state.activeAgentId || getActiveAgentId()).trim() || "default",
    };
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "experience.candidate.get",
      params: {
        candidateId: normalizedCandidateId,
        agentId: activeRequest.agentId,
      },
    });
    if (!isRequestCurrent(activeRequest)) {
      return;
    }
    if (!res || !res.ok) {
      state.selectedCandidate = null;
      renderExperienceWorkbenchDetailEmpty(res?.error?.message || t("experience.detailLoadFailed", {}, "Failed to load candidate details."));
      return;
    }
    state.selectedCandidate = res.payload?.candidate
      ? {
        ...res.payload.candidate,
        ...(res.payload?.memoryFreshness && typeof res.payload.memoryFreshness === "object"
          ? { memoryFreshness: res.payload.memoryFreshness }
          : {}),
      }
      : null;
    renderSelectedExperienceCandidate();
  }

  async function syncExperienceWorkbenchUi(options = {}) {
    const state = getExperienceWorkbenchState();
    ensurePublishedAssetState();
    const preferFirst = options.preferFirst !== false;
    const loadDetailIfNeeded = options.loadDetailIfNeeded === true;
    const filteredItems = getFilteredExperienceItems();
    const activeTab = getActiveTab();
    state.stats = mergeExperienceStats(state.stats, countExperienceStats(state.items));
    renderExperienceWorkbenchStats(state.stats);
    syncExperienceWorkbenchTabUi();
    syncCleanupConsumedButton();
    renderExperienceWorkbenchCapabilityOverviewPanel();
    renderExperienceWorkbenchAssetsPanel();
    renderExperienceSynthesisModal();

    if (activeTab === "assets") {
      const assetItems = getPublishedAssetItems();
      const selectedAssetVisible = assetItems.some((item) => normalizeText(item?.publishedPath) === getSelectedPublishedAssetPath());
      if (!selectedAssetVisible) {
        state.selectedAssetPath = preferFirst && assetItems[0]?.publishedPath
          ? normalizeText(assetItems[0].publishedPath)
          : "";
        state.selectedAsset = null;
        state.selectedAssetLoading = false;
        state.selectedAssetError = "";
      }
      renderExperienceWorkbenchAssetsPanel();
      return;
    }

    const selectedVisible = filteredItems.some((item) => String(item?.id || "") === String(state.selectedId || ""));
    if (!selectedVisible) {
      state.selectedId = preferFirst && filteredItems[0]?.id ? String(filteredItems[0].id) : null;
      state.selectedCandidate = null;
    }

    renderExperienceWorkbenchList(filteredItems);
    if (!state.selectedId) {
      renderExperienceWorkbenchDetailEmpty(
        filteredItems.length
          ? t("experience.detailSelect", {}, "Select a candidate on the left to view details.")
          : getEmptyExperienceMessage(),
      );
      return;
    }

    if (state.selectedCandidate && String(state.selectedCandidate.id || "") === String(state.selectedId)) {
      renderSelectedExperienceCandidate();
      return;
    }
    if (loadDetailIfNeeded) {
      await loadExperienceCandidateDetail(state.selectedId);
      return;
    }
    renderExperienceWorkbenchDetailEmpty(t("experience.detailSelect", {}, "Select a candidate on the left to view details."));
  }

  async function loadExperienceWorkbench(forceSelectFirst = false) {
    syncExperienceWorkbenchHeaderTitle();
    syncFilterUi();
    syncExperienceWorkbenchTabUi();
    const state = getExperienceWorkbenchState();
    ensurePublishedAssetState();
    state.activeAgentId = getActiveAgentId();
    if (!isConnected?.()) {
      const disconnectedMessage = t("experience.disconnected", {}, "Connect to the server to view experience candidates.");
      state.items = [];
      state.draftItems = [];
      state.draftItemsLoading = false;
      state.draftItemsError = "";
      state.publishedAssets = [];
      state.publishedAssetsLoading = false;
      state.publishedAssetsError = disconnectedMessage;
      state.selectedAssetPath = "";
      state.selectedAsset = null;
      state.selectedAssetLoading = false;
      state.selectedAssetError = "";
      state.stats = null;
      state.selectedId = null;
      state.selectedCandidate = null;
      closeExperienceSynthesisModal();
      renderExperienceWorkbenchStats(null);
      renderExperienceWorkbenchListEmpty(disconnectedMessage);
      renderExperienceWorkbenchDetailEmpty(disconnectedMessage);
      renderExperienceWorkbenchCapabilityOverviewEmpty(disconnectedMessage);
      renderExperienceWorkbenchAssetsPanel();
      renderExperienceWorkbenchUsageOverviewEmpty(disconnectedMessage);
      syncCleanupConsumedButton();
      return;
    }

    const requestContext = createRequestContext();
    state.draftItemsLoading = true;
    state.draftItemsError = "";
    state.publishedAssetsLoading = true;
    state.publishedAssetsError = "";
    if (!state.stats || typeof state.stats !== "object") {
      renderExperienceWorkbenchStats(null);
    }
    renderExperienceWorkbenchListEmpty(t("experience.loading", {}, "Loading experience candidates..."));
    renderExperienceWorkbenchDetailEmpty(t("experience.detailLoading", {}, "Loading candidate details..."));
    renderExperienceWorkbenchCapabilityOverviewPanel();
    if (getActiveTab() === "usage-overview") {
      renderExperienceWorkbenchUsageOverviewPanel();
    }

    const [res, draftRes, statsRes, publishedAssetsRes] = await Promise.all([
      requestExperienceCandidateList(requestContext, { limit: 120 }),
      loadAllExperienceCandidateItems(requestContext, {
        limit: EXPERIENCE_CANDIDATE_PAGE_SIZE,
        maxPages: EXPERIENCE_CANDIDATE_MAX_PAGES,
        filter: { status: "draft", synthesisConsumed: false },
      }),
      sendReq({
        type: "req",
        id: makeId(),
        method: "experience.candidate.stats",
        params: {
          agentId: requestContext.agentId,
        },
      }),
      requestPublishedExperienceAssetList(requestContext),
    ]);
    if (!isRequestCurrent(requestContext)) {
      return;
    }
    if (!res || !res.ok) {
      const loadFailedMessage = res?.error?.message || t("experience.loadFailed", {}, "Failed to load experience candidates.");
      state.items = [];
      state.draftItems = [];
      state.draftItemsLoading = false;
      state.draftItemsError = loadFailedMessage;
      state.publishedAssets = [];
      state.publishedAssetsLoading = false;
      state.publishedAssetsError = loadFailedMessage;
      state.selectedAssetPath = "";
      state.selectedAsset = null;
      state.selectedAssetLoading = false;
      state.selectedAssetError = "";
      state.stats = null;
      state.selectedId = null;
      state.selectedCandidate = null;
      renderExperienceWorkbenchStats(null);
      renderExperienceWorkbenchListEmpty(loadFailedMessage);
      renderExperienceWorkbenchDetailEmpty(loadFailedMessage);
      renderExperienceWorkbenchCapabilityOverviewEmpty(state.draftItemsError);
      renderExperienceWorkbenchAssetsPanel();
      renderExperienceWorkbenchUsageOverviewEmpty(loadFailedMessage);
      syncCleanupConsumedButton();
      return;
    }

    state.items = Array.isArray(res.payload?.items) ? res.payload.items : [];
    state.draftItems = draftRes?.ok && Array.isArray(draftRes.items) ? draftRes.items : [];
    state.draftItemsLoading = false;
    state.draftItemsError = draftRes?.ok
      ? ""
      : draftRes?.error?.message || t("experience.capabilityLoadFailed", {}, "Failed to load draft capability candidates.");
    state.stats = mergeExperienceStats(statsRes?.payload?.stats, countExperienceStats(state.items));
    state.publishedAssets = publishedAssetsRes?.ok && Array.isArray(publishedAssetsRes.payload?.items)
      ? publishedAssetsRes.payload.items
      : [];
    state.publishedAssetsLoading = false;
    state.publishedAssetsError = publishedAssetsRes?.ok
      ? ""
      : publishedAssetsRes?.error?.message || t("experience.publishedAssetLoadFailed", {}, "Failed to load published assets.");
    if (!findPublishedAssetInState(state.selectedAssetPath)) {
      state.selectedAssetPath = "";
      state.selectedAsset = null;
      state.selectedAssetLoading = false;
      state.selectedAssetError = "";
    }
    syncCleanupConsumedButton();
    const filteredItems = getFilteredExperienceItems();
    const hasExistingSelection = state.selectedId && filteredItems.some((item) => String(item?.id || "") === String(state.selectedId));
    if (!hasExistingSelection) {
      state.selectedId = forceSelectFirst !== false && filteredItems[0]?.id
        ? String(filteredItems[0].id)
        : null;
      state.selectedCandidate = null;
    }
    await syncExperienceWorkbenchUi({ preferFirst: forceSelectFirst !== false, loadDetailIfNeeded: true });
    if (getActiveTab() === "usage-overview") {
      await loadExperienceWorkbenchUsageOverview();
    }
  }

  async function openExperienceWorkbench(options = {}) {
    const candidateId = normalizeText(options.candidateId);
    applyExperienceWorkbenchContext(options);
    await loadExperienceWorkbench(candidateId ? false : options.preferFirst !== false);
    if (candidateId) {
      await loadExperienceCandidateDetail(candidateId);
    }
  }

  async function reviewExperienceCandidate(candidateId, decision, options = {}) {
    const normalizedCandidateId = typeof candidateId === "string" ? candidateId.trim() : "";
    const normalizedDecision = decision === "accept" || decision === "reject" ? decision : "";
    const publishTargetPath = normalizeText(options.publishTargetPath);
    if (!normalizedCandidateId || !normalizedDecision) return null;
    if (!isConnected?.()) {
      showNotice(
        t("experience.reviewFailedTitle", {}, "Candidate action failed"),
        t("experience.disconnected", {}, "Connect to the server to view experience candidates."),
        "error",
      );
      return null;
    }
    if (getPendingActionKey()) return null;
    const currentCandidate = findExperienceCandidateInState(normalizedCandidateId);
    const previousCandidateStatus = normalizeCandidateStatus(currentCandidate?.status);

    const memoryViewerState = typeof getMemoryViewerState === "function" ? getMemoryViewerState() : null;
    if (memoryViewerState) {
      memoryViewerState.pendingExperienceActionKey = `candidate:${normalizedCandidateId}:${normalizedDecision}`;
    }
    renderSelectedExperienceCandidate();
    renderExperienceWorkbenchCapabilityOverviewPanel();
    syncGenerateControls();

    let reviewedCandidate = null;
    try {
      let res;
      if (normalizedDecision === "accept" && publishTargetPath) {
        const confirmed = typeof window === "object" && typeof window.confirm === "function"
          ? window.confirm(options.confirmMessage || buildExperienceOverwriteConfirmMessage(currentCandidate, publishTargetPath))
          : true;
        if (!confirmed) {
          return null;
        }
        res = await requestExperienceCandidateReview(normalizedCandidateId, normalizedDecision, {
          confirmed: true,
          publishTargetPath,
        });
      } else {
        res = await requestExperienceCandidateReview(normalizedCandidateId, normalizedDecision);
        if (
          normalizedDecision === "accept"
          && res
          && !res.ok
          && res.error?.code === "confirmation_required"
        ) {
          const confirmed = typeof window === "object" && typeof window.confirm === "function"
            ? window.confirm(buildExperiencePublishConfirmMessage(currentCandidate))
            : true;
          if (confirmed) {
            res = await requestExperienceCandidateReview(normalizedCandidateId, normalizedDecision, { confirmed: true });
          }
        }
      }
      if (!res || !res.ok) {
        showNotice(
          t("experience.reviewFailedTitle", {}, "Candidate action failed"),
          res?.error?.message || t("experience.reviewFailedTitle", {}, "Candidate action failed"),
          "error",
        );
        return null;
      }
      showNotice(
        normalizedDecision === "accept"
          ? t("experience.reviewAcceptSuccessTitle", {}, "Candidate accepted")
          : t("experience.reviewRejectSuccessTitle", {}, "Candidate rejected"),
        normalizedDecision === "accept"
          ? t("experience.reviewAcceptSuccessMessage", {}, "The experience candidate was accepted and published.")
          : t("experience.reviewRejectSuccessMessage", {}, "The experience candidate was rejected."),
        "success",
        2200,
      );
      reviewedCandidate = res.payload?.candidate ?? null;
      return reviewedCandidate;
    } finally {
      if (memoryViewerState) {
        memoryViewerState.pendingExperienceActionKey = null;
      }
      if (reviewedCandidate) {
        applyReviewedExperienceCandidate(reviewedCandidate, previousCandidateStatus);
        await syncExperienceWorkbenchUi({ preferFirst: false, loadDetailIfNeeded: false });
      } else {
        renderExperienceWorkbenchCapabilityOverviewPanel();
      }
      syncGenerateControls();
      await loadExperienceWorkbench(false);
    }
  }

  async function bulkRejectExperienceCandidates(candidateType) {
    const normalizedCandidateType = typeof candidateType === "string" ? candidateType.trim().toLowerCase() : "";
    if (normalizedCandidateType !== "method" && normalizedCandidateType !== "skill") return null;
    if (!isConnected?.()) {
      showNotice(
        t("experience.reviewFailedTitle", {}, "Candidate action failed"),
        t("experience.disconnected", {}, "Connect to the server to view experience candidates."),
        "error",
      );
      return null;
    }
    if (getPendingActionKey()) return null;
    const { methods, skills } = getCapabilityDraftItemsByType();
    const laneItems = normalizedCandidateType === "skill" ? skills : methods;
    const draftCount = laneItems.length;
    const typeLabel = formatCandidateTypeLabel(normalizedCandidateType);
    if (!draftCount) {
      showNotice(
        t("experience.capabilityBulkRejectEmptyTitle", {}, "没有可拒绝的候选"),
        t("experience.capabilityBulkRejectEmptyMessage", { type: typeLabel }, `当前没有可拒绝的 ${typeLabel} draft 候选。`),
        "info",
        2400,
      );
      return null;
    }
    const confirmed = typeof window === "object" && typeof window.confirm === "function"
      ? window.confirm(t(
        "experience.capabilityBulkRejectConfirm",
        { type: typeLabel, count: String(draftCount) },
        `确认拒绝全部 ${draftCount} 个 ${typeLabel} draft 候选？\n\n系统会通过单次批量操作处理，避免逐条点击。`,
      ))
      : true;
    if (!confirmed) {
      return null;
    }

    const memoryViewerState = typeof getMemoryViewerState === "function" ? getMemoryViewerState() : null;
    if (memoryViewerState) {
      memoryViewerState.pendingExperienceActionKey = `bulk-reject:${normalizedCandidateType}`;
    }
    renderExperienceWorkbenchCapabilityOverviewPanel();
    syncGenerateControls();

    let rejectedCount = 0;
    try {
      const res = await requestExperienceCandidateBulkReject(normalizedCandidateType);
      if (!res || !res.ok) {
        showNotice(
          t("experience.reviewFailedTitle", {}, "Candidate action failed"),
          res?.error?.message || t("experience.reviewFailedTitle", {}, "Candidate action failed"),
          "error",
        );
        return null;
      }
      rejectedCount = Math.max(0, Number(res.payload?.count) || 0);
      if (!rejectedCount) {
        showNotice(
          t("experience.capabilityBulkRejectEmptyTitle", {}, "没有可拒绝的候选"),
          t("experience.capabilityBulkRejectEmptyMessage", { type: typeLabel }, `当前没有可拒绝的 ${typeLabel} draft 候选。`),
          "info",
          2400,
        );
        return res.payload ?? null;
      }
      applyBulkRejectedExperienceCandidates(normalizedCandidateType, rejectedCount);
      await syncExperienceWorkbenchUi({ preferFirst: false, loadDetailIfNeeded: false });
      showNotice(
        t("experience.capabilityBulkRejectSuccessTitle", {}, "批量拒绝完成"),
        t("experience.capabilityBulkRejectSuccessMessage", { count: String(rejectedCount), type: typeLabel }, `已批量拒绝 ${rejectedCount} 个 ${typeLabel} draft 候选。`),
        "success",
        2600,
      );
      return res.payload ?? null;
    } finally {
      if (memoryViewerState) {
        memoryViewerState.pendingExperienceActionKey = null;
      }
      syncGenerateControls();
      await loadExperienceWorkbench(false);
    }
  }

  async function updateSkillFreshnessStaleMark(input = {}) {
    const sourceCandidateId = normalizeText(input.sourceCandidateId);
    const skillKey = normalizeText(input.skillKey);
    const candidateId = normalizeText(input.candidateId);
    const stale = input.stale !== false;
    if (!sourceCandidateId && !skillKey) return null;
    if (!isConnected?.()) {
      showNotice(
        t("experience.skillFreshnessUpdateFailedTitle", {}, "Skill freshness update failed"),
        t("experience.disconnected", {}, "Connect to the server to view experience candidates."),
        "error",
      );
      return null;
    }
    if (getPendingActionKey()) return null;

    const memoryViewerState = typeof getMemoryViewerState === "function" ? getMemoryViewerState() : null;
    const pendingKey = `skill-freshness:${sourceCandidateId || skillKey}:${stale ? "stale" : "active"}`;
    if (memoryViewerState) {
      memoryViewerState.pendingExperienceActionKey = pendingKey;
    }
    renderSelectedExperienceCandidate();
    syncGenerateControls();

    try {
      const res = await sendReq({
        type: "req",
        id: makeId(),
        method: "experience.skill.freshness.update",
        params: {
          ...(sourceCandidateId ? { sourceCandidateId } : {}),
          ...(skillKey ? { skillKey } : {}),
          stale,
          agentId: getActiveAgentId(),
        },
      });
      if (!res || !res.ok) {
        showNotice(
          t("experience.skillFreshnessUpdateFailedTitle", {}, "Skill freshness update failed"),
          res?.error?.message || t("experience.skillFreshnessUpdateFailedTitle", {}, "Skill freshness update failed"),
          "error",
        );
        return null;
      }
      showNotice(
        t("experience.skillFreshnessUpdatedTitle", {}, "Skill freshness updated"),
        t("experience.skillFreshnessUpdatedMessage", {}, "The freshness state for this candidate has been refreshed."),
        "success",
        2200,
      );
      return res.payload ?? null;
    } finally {
      if (memoryViewerState) {
        memoryViewerState.pendingExperienceActionKey = null;
      }
      syncGenerateControls();
      if (candidateId) {
        await loadExperienceCandidateDetail(candidateId);
      } else {
        renderSelectedExperienceCandidate();
      }
    }
  }

  async function handleGenerateExperience(candidateType) {
    const state = getExperienceWorkbenchState();
    const taskId = normalizeText(state.generateTaskId);
    if (!taskId) {
      showNotice(
        t("experience.generateTaskRequiredTitle", {}, "Task ID required"),
        t("experience.generateTaskRequiredMessage", {}, "Provide the source taskId before generating a method or skill candidate."),
        "info",
        2400,
      );
      return null;
    }
    if (pendingGenerateActionKey || getPendingActionKey()) {
      return null;
    }
    pendingGenerateActionKey = `generate:${candidateType}:${taskId}`;
    syncGenerateControls();
    try {
      const candidate = await generateExperienceCandidate?.(taskId, candidateType);
      await loadExperienceWorkbench(false);
      if (candidate?.id) {
        const nextState = getExperienceWorkbenchState();
        nextState.selectedId = String(candidate.id);
        nextState.selectedCandidate = candidate;
        await syncExperienceWorkbenchUi({ preferFirst: false, loadDetailIfNeeded: true });
        return candidate;
      }
      await syncExperienceWorkbenchUi({ preferFirst: true, loadDetailIfNeeded: true });
      return null;
    } finally {
      pendingGenerateActionKey = "";
      syncGenerateControls();
    }
  }

  function bindUi() {
    if (uiBound) return;
    uiBound = true;
    if (experienceWorkbenchQueryEl) {
      experienceWorkbenchQueryEl.addEventListener("input", () => {
        setFilters({ query: experienceWorkbenchQueryEl.value });
        void syncExperienceWorkbenchUi({ preferFirst: true, loadDetailIfNeeded: true });
      });
    }
    if (experienceWorkbenchTypeFilterEl) {
      experienceWorkbenchTypeFilterEl.addEventListener("change", () => {
        setFilters({ type: experienceWorkbenchTypeFilterEl.value });
        void syncExperienceWorkbenchUi({ preferFirst: true, loadDetailIfNeeded: true });
      });
    }
    if (experienceWorkbenchStatusFilterEl) {
      experienceWorkbenchStatusFilterEl.addEventListener("change", () => {
        setFilters({ status: experienceWorkbenchStatusFilterEl.value });
        void syncExperienceWorkbenchUi({ preferFirst: true, loadDetailIfNeeded: true });
      });
    }
    if (experienceWorkbenchResetFiltersBtn) {
      experienceWorkbenchResetFiltersBtn.addEventListener("click", () => {
        setFilters({ query: "", type: "", status: "" });
        syncFilterUi();
        void syncExperienceWorkbenchUi({ preferFirst: true, loadDetailIfNeeded: true });
      });
    }
    if (experienceWorkbenchCleanupConsumedBtn) {
      experienceWorkbenchCleanupConsumedBtn.addEventListener("click", () => {
        void cleanupConsumedExperienceCandidates();
      });
    }
    if (experienceGenerateTaskIdEl) {
      experienceGenerateTaskIdEl.addEventListener("input", () => {
        const state = getExperienceWorkbenchState();
        state.generateTaskId = experienceGenerateTaskIdEl.value;
        syncGenerateControls();
      });
    }
    if (experienceGenerateMethodBtn) {
      experienceGenerateMethodBtn.addEventListener("click", () => {
        void handleGenerateExperience("method");
      });
    }
    if (experienceGenerateSkillBtn) {
      experienceGenerateSkillBtn.addEventListener("click", () => {
        void handleGenerateExperience("skill");
      });
    }
    if (experienceWorkbenchTabCandidatesBtn) {
      experienceWorkbenchTabCandidatesBtn.addEventListener("click", () => {
        setActiveTab("candidates");
        syncExperienceWorkbenchTabUi();
      });
    }
    if (experienceWorkbenchTabCapabilityAcquisitionBtn) {
      experienceWorkbenchTabCapabilityAcquisitionBtn.addEventListener("click", () => {
        setActiveTab("capability-acquisition");
        syncExperienceWorkbenchTabUi();
        renderExperienceWorkbenchCapabilityOverviewPanel();
      });
    }
    if (experienceWorkbenchTabAssetsBtn) {
      experienceWorkbenchTabAssetsBtn.addEventListener("click", () => {
        setActiveTab("assets");
        syncExperienceWorkbenchTabUi();
        void syncExperienceWorkbenchUi({ preferFirst: true, loadDetailIfNeeded: true });
      });
    }
    if (experienceWorkbenchTabUsageOverviewBtn) {
      experienceWorkbenchTabUsageOverviewBtn.addEventListener("click", () => {
        setActiveTab("usage-overview");
        syncExperienceWorkbenchTabUi();
        void loadExperienceWorkbenchUsageOverview();
      });
    }
    if (experienceSynthesisModalCloseBtn) {
      experienceSynthesisModalCloseBtn.addEventListener("click", () => {
        closeExperienceSynthesisModal();
      });
    }
    if (experienceSynthesisModalCancelBtn) {
      experienceSynthesisModalCancelBtn.addEventListener("click", () => {
        closeExperienceSynthesisModal();
      });
    }
    if (experienceSynthesisModalSubmitBtn) {
      experienceSynthesisModalSubmitBtn.addEventListener("click", () => {
        void submitExperienceSynthesis();
      });
    }
    if (experienceSynthesisModalConsumeSourcesEl) {
      experienceSynthesisModalConsumeSourcesEl.addEventListener("change", () => {
        getSynthesisModalState().markSourcesConsumed = experienceSynthesisModalConsumeSourcesEl.checked !== false;
      });
    }
    if (experienceSynthesisModalEl) {
      experienceSynthesisModalEl.addEventListener("click", (event) => {
        if (event.target === experienceSynthesisModalEl) {
          closeExperienceSynthesisModal();
        }
      });
    }
  }

  async function cleanupConsumedExperienceCandidates() {
    const consumedDraftCount = getConsumedDraftCount();
    if (consumedDraftCount <= 0) return null;
    if (!isConnected?.()) {
      showNotice(
        "清理旧稿失败",
        t("experience.disconnected", {}, "Connect to the server to view experience candidates."),
        "error",
      );
      return null;
    }
    const confirmed = window.confirm(`确认清理 ${consumedDraftCount} 个已消化旧草稿？此操作会删除这些 draft 候选。`);
    if (!confirmed) return null;

    const res = await requestExperienceCandidateCleanupConsumed();
    if (!res || !res.ok) {
      showNotice(
        "清理旧稿失败",
        res?.error?.message || "未能清理已消化旧草稿。",
        "error",
      );
      return null;
    }

    await loadExperienceWorkbench(false);
    await syncExperienceWorkbenchUi({ preferFirst: true, loadDetailIfNeeded: true });
    showNotice(
      "旧稿已清理",
      `已清理 ${Number(res.payload?.count) || 0} 个已消化旧草稿。`,
      "success",
      2600,
    );
    return res.payload ?? null;
  }

  function resetExperienceWorkbenchStateForAgent(agentId = getActiveAgentId()) {
    const state = getExperienceWorkbenchState();
    state.requestToken = Number(state.requestToken || 0) + 1;
    state.activeAgentId = String(agentId || "default").trim() || "default";
    state.items = [];
    state.draftItems = [];
    state.draftItemsLoading = false;
    state.draftItemsError = "";
    state.selectedId = null;
    state.selectedCandidate = null;
    state.selectedAssetPath = "";
    state.selectedAsset = null;
    state.selectedAssetLoading = false;
    state.selectedAssetError = "";
    state.stats = null;
    state.activeTab = "capability-acquisition";
    state.resynthesizeAssetPath = "";
    state.synthesisModal = {
      open: false,
      loading: false,
      submitting: false,
      error: "",
      seedCandidateId: "",
      seedAssetPath: "",
      preview: null,
      markSourcesConsumed: true,
    };
    renderExperienceSynthesisModal();
  }

  async function refreshExperienceWorkbenchForAgentSwitch(agentId = getActiveAgentId()) {
    resetExperienceWorkbenchStateForAgent(agentId);
    syncExperienceWorkbenchHeaderTitle();
    syncFilterUi();
    if (!experienceWorkbenchSection || experienceWorkbenchSection.classList.contains("hidden")) {
      return;
    }
    await loadExperienceWorkbench(true);
  }

  return {
    applyExperienceWorkbenchContext,
    bindUi,
    loadExperienceWorkbench,
    loadExperienceCandidateDetail,
    openExperienceWorkbench,
    renderExperienceWorkbenchStats,
    renderExperienceWorkbenchListEmpty,
    renderExperienceWorkbenchDetailEmpty,
    resetExperienceWorkbenchStateForAgent,
    refreshExperienceWorkbenchForAgentSwitch,
    syncExperienceWorkbenchHeaderTitle,
    syncExperienceWorkbenchUi,
  };
}
