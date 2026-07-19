import { isExperienceDraftGenerateNoticeEnabled } from "./experience-draft-notice-mode.js";
import { createMemoryRuntimeExperienceGenerateAction } from "./memory-runtime-experience-generate-action.js";
import { createMemoryRuntimeExperienceReviewAction } from "./memory-runtime-experience-review-action.js";
import { createMemoryRuntimeIngressLifecycle } from "./memory-runtime-ingress-lifecycle.js";
import { createMemoryRuntimeReadLifecycle } from "./memory-runtime-read-lifecycle.js";
import { createMemoryRuntimeSkillFreshnessAction } from "./memory-runtime-skill-freshness-action.js";

export function createMemoryRuntimeFeature({
  refs,
  isConnected,
  sendReq,
  makeId,
  getMemoryViewerState,
  getMemoryViewerFeature,
  getCurrentAgentSelection,
  getGoalDisplayName,
  switchMode,
  loadGoals,
  showNotice,
  renderMemoryViewerStats,
  renderTaskList,
  renderMemoryList,
  renderSharedReviewList,
  renderTaskDetail,
  renderCandidateOnlyDetail,
  renderMemoryDetail,
  renderMemoryViewerListEmpty,
  renderMemoryViewerDetailEmpty,
  getCurrentAgentLabel,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const {
    memoryViewerSection,
    memoryTaskGoalFilterBarEl,
    memoryTaskGoalFilterLabelEl,
  } = refs;
  const ingressLifecycle = createMemoryRuntimeIngressLifecycle();
  const readLifecycle = createMemoryRuntimeReadLifecycle();
  const experienceGenerateAction = createMemoryRuntimeExperienceGenerateAction({
    getState: getMemoryViewerState,
    isConnected: isConnectedNow,
    sendReq,
    makeId,
    getActiveAgentId: getCurrentAgentSelection,
    confirmAction: (message) => (typeof window !== "undefined" && typeof window.confirm === "function"
      ? window.confirm(message)
      : true),
    showNotice,
    rerender: rerenderExperienceDetail,
    loadTaskDetail,
    loadCandidateDetail,
    isDraftNoticeEnabled: isExperienceDraftGenerateNoticeEnabled,
    t,
  });
  const experienceReviewAction = createMemoryRuntimeExperienceReviewAction({
    getState: getMemoryViewerState,
    isConnected: isConnectedNow,
    sendReq,
    makeId,
    getActiveAgentId: getCurrentAgentSelection,
    showNotice,
    rerender: rerenderExperienceDetail,
    loadTaskDetail,
    loadCandidateDetail,
    t,
  });
  const skillFreshnessAction = createMemoryRuntimeSkillFreshnessAction({
    getState: getMemoryViewerState,
    isConnected: isConnectedNow,
    sendReq,
    makeId,
    getActiveAgentId: getCurrentAgentSelection,
    showNotice,
    rerender: rerenderExperienceDetail,
    loadTaskUsageOverview,
    loadTaskDetail,
    loadCandidateDetail,
    t,
  });

  function getFeature() {
    return getMemoryViewerFeature?.();
  }

  function isConnectedNow() {
    return typeof isConnected === "function" ? isConnected() : Boolean(isConnected);
  }

  function rerenderExperienceDetail(taskId = "", candidateId = "") {
    const memoryViewerState = getMemoryViewerState();
    if (taskId && memoryViewerState.selectedTask?.id === taskId) {
      renderTaskDetail(memoryViewerState.selectedTask);
      return;
    }
    if (candidateId && memoryViewerState.selectedCandidate?.id === candidateId) {
      renderCandidateOnlyDetail(memoryViewerState.selectedCandidate);
    }
  }

  function switchMemoryViewerTab(tab) {
    return getFeature()?.switchMemoryViewerTab(tab);
  }

  function syncMemoryViewerUi() {
    return getFeature()?.syncMemoryViewerUi();
  }

  async function loadMemoryViewer(forceSelectFirst = false) {
    return getFeature()?.loadMemoryViewer(forceSelectFirst);
  }

  async function loadMemoryViewerStats() {
    return getFeature()?.loadMemoryViewerStats();
  }

  async function loadTaskUsageOverview() {
    return getFeature()?.loadTaskUsageOverview();
  }

  async function loadTaskViewer(forceSelectFirst = false) {
    return getFeature()?.loadTaskViewer(forceSelectFirst);
  }

  async function loadMemoryChunkViewer(forceSelectFirst = false) {
    return getFeature()?.loadMemoryChunkViewer(forceSelectFirst);
  }

  function resolveMemoryDetailTargetAgentId(chunkId) {
    const memoryViewerState = getMemoryViewerState();
    if (!chunkId || memoryViewerState.tab !== "sharedReview") return undefined;
    const selected = Array.isArray(memoryViewerState.items)
      ? memoryViewerState.items.find((item) => item?.id === chunkId)
      : null;
    return typeof selected?.targetAgentId === "string" && selected.targetAgentId.trim()
      ? selected.targetAgentId.trim()
      : undefined;
  }

  function syncMemoryTaskGoalFilterUi() {
    if (!memoryTaskGoalFilterBarEl || !memoryTaskGoalFilterLabelEl) return;
    const memoryViewerState = getMemoryViewerState();
    const goalId = memoryViewerState.goalIdFilter;
    const visible = memoryViewerState.tab === "tasks" && Boolean(goalId);
    memoryTaskGoalFilterBarEl.classList.toggle("hidden", !visible);
    if (!visible) return;
    memoryTaskGoalFilterLabelEl.textContent = `当前仅查看长期任务：${getGoalDisplayName(goalId)} (${goalId})`;
  }

  async function clearMemoryTaskGoalFilter() {
    const memoryViewerState = getMemoryViewerState();
    if (!memoryViewerState.goalIdFilter) return;
    memoryViewerState.goalIdFilter = null;
    syncMemoryTaskGoalFilterUi();
    if (memoryViewerState.tab === "tasks") {
      await loadMemoryViewer(true);
    }
  }

  async function openGoalTaskViewer(goalId) {
    if (!goalId) return;
    const memoryViewerState = getMemoryViewerState();
    if (memoryViewerState.tab !== "tasks") {
      memoryViewerState.tab = "tasks";
      memoryViewerState.items = [];
      memoryViewerState.selectedTask = null;
      memoryViewerState.selectedCandidate = null;
    }
    memoryViewerState.goalIdFilter = goalId;
    memoryViewerState.selectedId = null;
    syncMemoryViewerUi();
    syncMemoryTaskGoalFilterUi();
    switchMode("memory");
    await loadMemoryViewer(true);
    showNotice(
      t("goals.taskViewSwitchedTitle", {}, "Switched to task view"),
      t(
        "goals.taskViewSwitchedMessage",
        { goalName: getGoalDisplayName(goalId) },
        `Now showing only tasks related to ${getGoalDisplayName(goalId)}.`,
      ),
      "info",
      2200,
    );
  }

  async function loadTaskDetail(taskId, requestContext = null) {
    return readLifecycle.run("task", ({ isCurrent }) => (
      loadTaskDetailCurrent(taskId, requestContext, isCurrent)
    ));
  }

  async function loadTaskDetailCurrent(taskId, requestContext, isLifecycleCurrent) {
    const memoryViewerState = getMemoryViewerState();
    const previousSelectedTask = memoryViewerState.selectedTask?.id === taskId
      ? memoryViewerState.selectedTask
      : null;
    if (!taskId) {
      memoryViewerState.selectedTask = null;
      memoryViewerState.selectedCandidate = null;
      memoryViewerState.pendingUsageRevokeId = null;
      renderMemoryViewerDetailEmpty(t("memory.selectTask", {}, "Please select a task."));
      renderMemoryViewerStats(memoryViewerState.stats);
      return;
    }

    renderMemoryViewerDetailEmpty(t("memory.taskDetailLoadingShort", {}, "Loading task details…"));
    const requestToken = Number(requestContext?.requestToken ?? memoryViewerState.requestToken ?? 0);
    const requestAgentId = String(requestContext?.agentId || memoryViewerState.activeAgentId || getCurrentAgentSelection()).trim() || "default";
    const id = makeId();
    const res = await sendReq({ type: "req", id, method: "memory.task.get", params: { taskId, agentId: requestAgentId } });
    if (
      !isLifecycleCurrent()
      || Number(memoryViewerState.requestToken || 0) !== requestToken
      || (String(memoryViewerState.activeAgentId || getCurrentAgentSelection()).trim() || "default") !== requestAgentId
    ) {
      return;
    }
    if (!res || !res.ok) {
      memoryViewerState.selectedTask = null;
      memoryViewerState.selectedCandidate = null;
      memoryViewerState.pendingUsageRevokeId = null;
      renderMemoryViewerDetailEmpty(res?.error?.message || t("memory.taskDetailLoadFailed", {}, "Failed to load task details."));
      renderMemoryViewerStats(memoryViewerState.stats);
      return;
    }

    const nextTask = res.payload?.task ? { ...res.payload.task } : null;
    if (nextTask && previousSelectedTask?.sourceExplanation?.taskId === nextTask.id) {
      nextTask.sourceExplanation = previousSelectedTask.sourceExplanation;
      nextTask.sourceExplanationError = previousSelectedTask.sourceExplanationError || "";
      nextTask.sourceExplanationLoading = false;
    }
    memoryViewerState.selectedTask = nextTask;
    memoryViewerState.experienceQueryView = res.payload?.queryView ?? memoryViewerState.experienceQueryView ?? null;
    if (
      memoryViewerState.selectedCandidate?.taskId
      && memoryViewerState.selectedTask?.id
      && memoryViewerState.selectedCandidate.taskId !== memoryViewerState.selectedTask.id
    ) {
      memoryViewerState.selectedCandidate = null;
    }
    memoryViewerState.pendingUsageRevokeId = null;
    renderTaskList(memoryViewerState.items);
    renderTaskDetail(memoryViewerState.selectedTask);
    renderMemoryViewerStats(memoryViewerState.stats);
  }

  async function loadMemoryDetail(chunkId, requestContext = null, options = {}) {
    return readLifecycle.run("memory", ({ isCurrent }) => (
      loadMemoryDetailCurrent(chunkId, requestContext, options, isCurrent)
    ));
  }

  async function loadMemoryDetailCurrent(chunkId, requestContext, options, isLifecycleCurrent) {
    const memoryViewerState = getMemoryViewerState();
    if (!chunkId) {
      renderMemoryViewerDetailEmpty(t("memory.selectMemory", {}, "Please select a memory."));
      return;
    }

    renderMemoryViewerDetailEmpty(t("memory.memoryDetailLoadingShort", {}, "Loading memory details…"));
    const requestToken = Number(requestContext?.requestToken ?? memoryViewerState.requestToken ?? 0);
    const requestAgentId = String(
      options?.targetAgentId
      || resolveMemoryDetailTargetAgentId(chunkId)
      || requestContext?.agentId
      || memoryViewerState.activeAgentId
      || getCurrentAgentSelection(),
    ).trim() || "default";
    const id = makeId();
    const res = await sendReq({ type: "req", id, method: "memory.get", params: { chunkId, agentId: requestAgentId } });
    if (
      !isLifecycleCurrent()
      || Number(memoryViewerState.requestToken || 0) !== requestToken
      || (String(memoryViewerState.activeAgentId || getCurrentAgentSelection()).trim() || "default") !== requestAgentId
    ) {
      return;
    }
    if (!res || !res.ok) {
      renderMemoryViewerDetailEmpty(res?.error?.message || t("memory.memoryDetailLoadFailed", {}, "Failed to load memory details."));
      return;
    }

    if (memoryViewerState.tab === "sharedReview") {
      renderSharedReviewList(memoryViewerState.items);
    } else {
      renderMemoryList(memoryViewerState.items);
    }
    memoryViewerState.memoryQueryView = res.payload?.queryView ?? memoryViewerState.memoryQueryView ?? null;
    const queueItem = memoryViewerState.tab === "sharedReview" && Array.isArray(memoryViewerState.items)
      ? memoryViewerState.items.find((item) => item?.id === chunkId)
      : null;
    renderMemoryDetail(queueItem && res.payload?.item
      ? {
        ...res.payload.item,
        targetAgentId: queueItem.targetAgentId,
        targetDisplayName: queueItem.targetDisplayName,
        targetMemoryMode: queueItem.targetMemoryMode,
        reviewStatus: queueItem.reviewStatus,
        claimOwner: queueItem.claimOwner,
        claimAgeMs: queueItem.claimAgeMs,
        claimExpiresAt: queueItem.claimExpiresAt,
        claimTimedOut: queueItem.claimTimedOut,
        actionableByReviewer: queueItem.actionableByReviewer,
        blockedByOtherReviewer: queueItem.blockedByOtherReviewer,
      }
      : res.payload?.item);
  }

  async function openTaskFromAudit(taskId) {
    if (!taskId) return;
    const memoryViewerState = getMemoryViewerState();
    if (memoryViewerState.tab !== "tasks") {
      memoryViewerState.tab = "tasks";
      memoryViewerState.items = [];
      memoryViewerState.selectedTask = null;
      syncMemoryViewerUi();
    }

    memoryViewerState.selectedId = taskId;
    await loadTaskViewer(false);

    if (!Array.isArray(memoryViewerState.items) || !memoryViewerState.items.some((item) => item.id === taskId)) {
      memoryViewerState.selectedId = taskId;
      renderTaskList(Array.isArray(memoryViewerState.items) ? memoryViewerState.items : []);
      await loadTaskDetail(taskId);
    }
  }

  async function openMemoryFromAudit(chunkId) {
    if (!chunkId) return;
    const memoryViewerState = getMemoryViewerState();
    if (memoryViewerState.tab !== "memories") {
      memoryViewerState.tab = "memories";
      memoryViewerState.items = [];
      memoryViewerState.selectedTask = null;
      memoryViewerState.selectedCandidate = null;
      syncMemoryViewerUi();
    }

    memoryViewerState.selectedId = chunkId;
    await loadMemoryChunkViewer(false);

    if (!Array.isArray(memoryViewerState.items) || !memoryViewerState.items.some((item) => item.id === chunkId)) {
      memoryViewerState.selectedId = chunkId;
      renderMemoryList(Array.isArray(memoryViewerState.items) ? memoryViewerState.items : []);
      await loadMemoryDetail(chunkId);
    }
  }

  async function loadCandidateDetail(candidateId) {
    return readLifecycle.run("candidate", ({ isCurrent }) => (
      loadCandidateDetailCurrent(candidateId, isCurrent)
    ));
  }

  async function loadCandidateDetailCurrent(candidateId, isLifecycleCurrent) {
    const memoryViewerState = getMemoryViewerState();
    if (!candidateId || !isConnected()) return;
    const requestToken = Number(memoryViewerState.requestToken || 0);
    const requestAgentId = String(memoryViewerState.activeAgentId || getCurrentAgentSelection()).trim() || "default";
    const id = makeId();
    const res = await sendReq({ type: "req", id, method: "experience.candidate.get", params: { candidateId, agentId: requestAgentId } });
    if (
      !isLifecycleCurrent()
      || Number(memoryViewerState.requestToken || 0) !== requestToken
      || (String(memoryViewerState.activeAgentId || getCurrentAgentSelection()).trim() || "default") !== requestAgentId
    ) {
      return;
    }
    if (!res || !res.ok) {
      showNotice("候选详情加载失败", res?.error?.message || "无法读取 candidate。", "error");
      return;
    }
    memoryViewerState.selectedCandidate = res.payload?.candidate
      ? {
        ...res.payload.candidate,
        ...(res.payload?.memoryFreshness && typeof res.payload.memoryFreshness === "object"
          ? { memoryFreshness: res.payload.memoryFreshness }
          : {}),
      }
      : null;
    memoryViewerState.experienceQueryView = res.payload?.queryView ?? memoryViewerState.experienceQueryView ?? null;
    if (memoryViewerState.tab === "tasks" && memoryViewerState.selectedTask) {
      renderTaskDetail(memoryViewerState.selectedTask);
    } else {
      renderCandidateOnlyDetail(memoryViewerState.selectedCandidate);
    }
  }

  function generateExperienceCandidate(taskId, candidateType) {
    return experienceGenerateAction.generate(taskId, candidateType);
  }

  function reviewExperienceCandidate(candidateId, decision, options = {}) {
    return experienceReviewAction.review(candidateId, decision, options);
  }

  function updateSkillFreshnessStaleMark(input = {}) {
    return skillFreshnessAction.update(input);
  }

  function refreshMemoryLocale() {
    if (!memoryViewerSection) return;
    const memoryViewerState = getMemoryViewerState();
    syncMemoryViewerUi();
    if (!isConnected()) {
      renderMemoryViewerStats(null);
      renderMemoryViewerListEmpty(t("memory.disconnectedList", {}, "Not connected to the server."));
      renderMemoryViewerDetailEmpty(t("memory.disconnectedDetail", {}, "Tasks and memories will be available after connection is ready."));
      return;
    }
    renderMemoryViewerStats(memoryViewerState.stats);
    if (memoryViewerState.tab === "tasks") {
      renderTaskList(memoryViewerState.items);
      if (memoryViewerState.selectedTask) {
        renderTaskDetail(memoryViewerState.selectedTask);
        return;
      }
      if (memoryViewerState.selectedCandidate) {
        renderCandidateOnlyDetail(memoryViewerState.selectedCandidate);
        return;
      }
      renderMemoryViewerDetailEmpty(t("memory.selectTask", {}, "Please select a task."));
      return;
    }
    if (memoryViewerState.tab === "sharedReview") {
      renderSharedReviewList(memoryViewerState.items);
    } else if (memoryViewerState.tab === "outboundAudit") {
      void getFeature()?.loadExternalOutboundAuditViewer?.(false);
      return;
    } else {
      renderMemoryList(memoryViewerState.items);
    }
    if (memoryViewerState.selectedId) {
      void loadMemoryDetail(memoryViewerState.selectedId);
      return;
    }
    renderMemoryViewerDetailEmpty(t("memory.selectMemory", {}, "Please select a memory."));
  }

  function dispose() {
    ingressLifecycle.dispose();
    skillFreshnessAction.dispose();
    experienceReviewAction.dispose();
    experienceGenerateAction.dispose();
    readLifecycle.dispose();
  }

  function getRuntimeSnapshot() {
    return {
      ...ingressLifecycle.getRuntimeSnapshot(),
      ...readLifecycle.getRuntimeSnapshot(),
      ...experienceGenerateAction.getRuntimeSnapshot(),
      ...experienceReviewAction.getRuntimeSnapshot(),
      ...skillFreshnessAction.getRuntimeSnapshot(),
    };
  }

  return {
    clearMemoryTaskGoalFilter: ingressLifecycle.guardAsync(clearMemoryTaskGoalFilter),
    loadCandidateDetail: ingressLifecycle.guardAsync(loadCandidateDetail),
    loadMemoryChunkViewer: ingressLifecycle.guardAsync(loadMemoryChunkViewer),
    loadMemoryDetail: ingressLifecycle.guardAsync(loadMemoryDetail),
    loadMemoryViewer: ingressLifecycle.guardAsync(loadMemoryViewer),
    loadMemoryViewerStats: ingressLifecycle.guardAsync(loadMemoryViewerStats),
    loadTaskDetail: ingressLifecycle.guardAsync(loadTaskDetail),
    loadTaskUsageOverview: ingressLifecycle.guardAsync(loadTaskUsageOverview),
    loadTaskViewer: ingressLifecycle.guardAsync(loadTaskViewer),
    generateExperienceCandidate: ingressLifecycle.guardAsync(generateExperienceCandidate),
    openGoalTaskViewer: ingressLifecycle.guardAsync(openGoalTaskViewer),
    openMemoryFromAudit: ingressLifecycle.guardAsync(openMemoryFromAudit),
    openTaskFromAudit: ingressLifecycle.guardAsync(openTaskFromAudit),
    refreshMemoryLocale: ingressLifecycle.guard(refreshMemoryLocale),
    reviewExperienceCandidate: ingressLifecycle.guardAsync(reviewExperienceCandidate),
    resolveMemoryDetailTargetAgentId: ingressLifecycle.guard(resolveMemoryDetailTargetAgentId),
    switchMemoryViewerTab: ingressLifecycle.guard(switchMemoryViewerTab),
    syncMemoryTaskGoalFilterUi: ingressLifecycle.guard(syncMemoryTaskGoalFilterUi),
    syncMemoryViewerUi: ingressLifecycle.guard(syncMemoryViewerUi),
    updateSkillFreshnessStaleMark: ingressLifecycle.guardAsync(updateSkillFreshnessStaleMark),
    getCurrentAgentLabel,
    dispose,
    getRuntimeSnapshot,
  };
}
