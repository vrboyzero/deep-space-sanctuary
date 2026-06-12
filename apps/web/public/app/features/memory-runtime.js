import { isExperienceDraftGenerateNoticeEnabled } from "./experience-draft-notice-mode.js";

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
      Number(memoryViewerState.requestToken || 0) !== requestToken
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
      Number(memoryViewerState.requestToken || 0) !== requestToken
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
    const memoryViewerState = getMemoryViewerState();
    if (!candidateId || !isConnected()) return;
    const requestToken = Number(memoryViewerState.requestToken || 0);
    const requestAgentId = String(memoryViewerState.activeAgentId || getCurrentAgentSelection()).trim() || "default";
    const id = makeId();
    const res = await sendReq({ type: "req", id, method: "experience.candidate.get", params: { candidateId, agentId: requestAgentId } });
    if (
      Number(memoryViewerState.requestToken || 0) !== requestToken
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

  function formatExperienceDedupMatchLabel(match) {
    if (!match || typeof match !== "object") return "";
    return String(match.title || match.key || match.candidateId || "").trim();
  }

  function buildExperienceDedupConfirmMessage(result, candidateType) {
    const typeLabel = candidateType === "method"
      ? t("memory.candidateDedupTypeMethod", {}, "method")
      : t("memory.candidateDedupTypeSkill", {}, "skill");
    if (!result || typeof result !== "object") return "";

    if (result.decision === "duplicate_existing") {
      const exactLabel = formatExperienceDedupMatchLabel(result.exactMatch);
      return t(
        "memory.candidateDedupDuplicateConfirm",
        { type: typeLabel, target: exactLabel || "-" },
        `检测到已有重复 ${typeLabel} 候选：${exactLabel || "-" }\n\n点击“确定”将直接打开现有候选；点击“取消”则停止本次生成。`,
      );
    }

    if (result.decision === "similar_existing") {
      const topMatches = Array.isArray(result.similarMatches)
        ? result.similarMatches
          .slice(0, 3)
          .map((item) => formatExperienceDedupMatchLabel(item))
          .filter(Boolean)
        : [];
      return t(
        "memory.candidateDedupSimilarConfirm",
        { type: typeLabel, targets: topMatches.join(" / ") || "-" },
        `检测到已有相似 ${typeLabel}：${topMatches.join(" / ") || "-"}\n\n点击“确定”继续生成新的候选；点击“取消”则停止本次生成。`,
      );
    }

    return "";
  }

  async function checkExperienceCandidateDuplicate(taskId, candidateType) {
    const id = makeId();
    const res = await sendReq({
      type: "req",
      id,
      method: "experience.candidate.check_duplicate",
      params: {
        taskId,
        candidateType,
        agentId: getCurrentAgentSelection(),
      },
    });
    if (!res || !res.ok) {
      showNotice(
        t("memory.candidateDedupCheckFailedTitle", {}, "生成前去重预检失败"),
        res?.error?.message || t("memory.candidateDedupCheckFailedMessage", {}, "experience.candidate.check_duplicate 调用失败。"),
        "error",
      );
      return null;
    }
    return res.payload ?? null;
  }

  async function generateExperienceCandidate(taskId, candidateType) {
    if (!isConnectedNow()) {
      showNotice(
        t("memory.candidateGenerateUnavailableTitle", {}, "无法生成经验候选"),
        t("memory.disconnectedList", {}, "Not connected to the server."),
        "error",
      );
      return null;
    }

    const normalizedTaskId = typeof taskId === "string" ? taskId.trim() : "";
    const normalizedType = candidateType === "method" || candidateType === "skill" ? candidateType : "";
    if (!normalizedTaskId || !normalizedType) return null;

    const memoryViewerState = getMemoryViewerState();
    const pendingKey = `generate:${normalizedType}:${normalizedTaskId}`;
    if (memoryViewerState.pendingExperienceActionKey) return null;
    memoryViewerState.pendingExperienceActionKey = pendingKey;
    rerenderExperienceDetail(normalizedTaskId);

    try {
      const duplicateCheck = await checkExperienceCandidateDuplicate(normalizedTaskId, normalizedType);
      if (!duplicateCheck) {
        return null;
      }

      if (duplicateCheck.decision === "duplicate_existing") {
        const confirmed = typeof window !== "undefined" && typeof window.confirm === "function"
          ? window.confirm(buildExperienceDedupConfirmMessage(duplicateCheck, normalizedType))
          : true;
        if (!confirmed) {
          return null;
        }
        if (duplicateCheck.exactMatch?.candidateId) {
          await loadCandidateDetail(duplicateCheck.exactMatch.candidateId);
          showNotice(
            t("memory.candidateDedupOpenedExistingTitle", {}, "已打开现有候选"),
            formatExperienceDedupMatchLabel(duplicateCheck.exactMatch)
            || t("memory.candidateGenerateReusedTitle", {}, "已打开现有经验候选"),
            "info",
            2200,
          );
          return memoryViewerState.selectedCandidate ?? null;
        }
      } else if (duplicateCheck.decision === "similar_existing") {
        const confirmed = typeof window !== "undefined" && typeof window.confirm === "function"
          ? window.confirm(buildExperienceDedupConfirmMessage(duplicateCheck, normalizedType))
          : true;
        if (!confirmed) {
          return null;
        }
      }

      const id = makeId();
      const res = await sendReq({
        type: "req",
        id,
        method: "experience.candidate.generate",
        params: {
          taskId: normalizedTaskId,
          candidateType: normalizedType,
          agentId: getCurrentAgentSelection(),
        },
      });
      if (!res || !res.ok) {
        showNotice(
          t("memory.candidateGenerateFailedTitle", {}, "生成经验候选失败"),
          res?.error?.message || t("memory.candidateGenerateFailedMessage", {}, "experience.candidate.generate 调用失败。"),
          "error",
        );
        return null;
      }

      const candidate = res.payload?.candidate ?? null;
      const shouldShowDraftGenerateNotice = isExperienceDraftGenerateNoticeEnabled();
      if (res.payload?.reusedExisting || shouldShowDraftGenerateNotice) {
        const isSkill = normalizedType === "skill";
        showNotice(
          res.payload?.reusedExisting
            ? t("memory.candidateGenerateReusedTitle", {}, "已打开现有经验候选")
            : (isSkill
              ? t("memory.skillDraftGenerateSuccessTitle", {}, "Skill Draft 已生成")
              : t("memory.methodDraftGenerateSuccessTitle", {}, "Method Draft 已生成")),
          candidate?.title
            ? String(candidate.title)
            : res.payload?.reusedExisting
              ? t("memory.candidateGenerateSuccessMessage", {}, "已为当前任务准备经验候选。")
              : (isSkill
                ? t("memory.skillDraftGenerateSuccessMessage", {}, "已为当前任务生成新的 Skill Draft。")
                : t("memory.methodDraftGenerateSuccessMessage", {}, "已为当前任务生成新的 Method Draft。")),
          "success",
          2200,
        );
      }

      await loadTaskDetail(normalizedTaskId);
      if (candidate?.id) {
        await loadCandidateDetail(candidate.id);
      }
      return candidate;
    } catch (error) {
      showNotice(
        t("memory.candidateGenerateFailedTitle", {}, "生成经验候选失败"),
        error instanceof Error ? error.message : String(error),
        "error",
      );
      return null;
    } finally {
      memoryViewerState.pendingExperienceActionKey = null;
      rerenderExperienceDetail(normalizedTaskId);
    }
  }

  async function reviewExperienceCandidate(candidateId, decision, options = {}) {
    if (!isConnectedNow()) {
      showNotice(
        t("memory.candidateReviewUnavailableTitle", {}, "无法提交候选审核"),
        t("memory.disconnectedList", {}, "Not connected to the server."),
        "error",
      );
      return null;
    }

    const normalizedCandidateId = typeof candidateId === "string" ? candidateId.trim() : "";
    const normalizedDecision = decision === "accept" || decision === "reject" ? decision : "";
    const taskId = typeof options?.taskId === "string" ? options.taskId.trim() : "";
    if (!normalizedCandidateId || !normalizedDecision) return null;

    const memoryViewerState = getMemoryViewerState();
    const pendingKey = `candidate:${normalizedCandidateId}:${normalizedDecision}`;
    if (memoryViewerState.pendingExperienceActionKey) return null;
    memoryViewerState.pendingExperienceActionKey = pendingKey;
    rerenderExperienceDetail(taskId, normalizedCandidateId);

    try {
      const id = makeId();
      const res = await sendReq({
        type: "req",
        id,
        method: normalizedDecision === "accept" ? "experience.candidate.accept" : "experience.candidate.reject",
        params: {
          candidateId: normalizedCandidateId,
          agentId: getCurrentAgentSelection(),
        },
      });
      if (!res || !res.ok) {
        showNotice(
          t("memory.candidateReviewFailedTitle", {}, "候选审核失败"),
          res?.error?.message || t("memory.candidateReviewFailedMessage", {}, "经验候选状态更新失败。"),
          "error",
        );
        return null;
      }

      const candidate = res.payload?.candidate ?? null;
      showNotice(
        normalizedDecision === "accept"
          ? t("memory.candidateAcceptSuccessTitle", {}, "候选已接受")
          : t("memory.candidateRejectSuccessTitle", {}, "候选已拒绝"),
        candidate?.title
          ? String(candidate.title)
          : t("memory.candidateReviewSuccessMessage", {}, "经验候选状态已更新。"),
        "success",
        2200,
      );

      if (taskId) {
        await loadTaskDetail(taskId);
      }
      await loadCandidateDetail(normalizedCandidateId);
      return candidate;
    } catch (error) {
      showNotice(
        t("memory.candidateReviewFailedTitle", {}, "候选审核失败"),
        error instanceof Error ? error.message : String(error),
        "error",
      );
      return null;
    } finally {
      memoryViewerState.pendingExperienceActionKey = null;
      rerenderExperienceDetail(taskId, normalizedCandidateId);
    }
  }

  async function updateSkillFreshnessStaleMark(input = {}) {
    if (!isConnectedNow()) {
      showNotice(
        t("memory.skillFreshnessUpdateUnavailableTitle", {}, "无法更新 Skill Freshness"),
        t("memory.disconnectedList", {}, "Not connected to the server."),
        "error",
      );
      return null;
    }

    const sourceCandidateId = typeof input.sourceCandidateId === "string" ? input.sourceCandidateId.trim() : "";
    const skillKey = typeof input.skillKey === "string" ? input.skillKey.trim() : "";
    const taskId = typeof input.taskId === "string" ? input.taskId.trim() : "";
    const candidateId = typeof input.candidateId === "string" ? input.candidateId.trim() : "";
    const stale = input.stale !== false;
    if (!sourceCandidateId && !skillKey) return null;

    const memoryViewerState = getMemoryViewerState();
    const pendingKey = `skill-freshness:${sourceCandidateId || skillKey}:${stale ? "stale" : "active"}`;
    if (memoryViewerState.pendingExperienceActionKey) return null;
    memoryViewerState.pendingExperienceActionKey = pendingKey;
    rerenderExperienceDetail(taskId, candidateId);

    try {
      const id = makeId();
      const res = await sendReq({
        type: "req",
        id,
        method: "experience.skill.freshness.update",
        params: {
          ...(sourceCandidateId ? { sourceCandidateId } : {}),
          ...(skillKey ? { skillKey } : {}),
          stale,
          agentId: getCurrentAgentSelection(),
        },
      });
      if (!res || !res.ok) {
        showNotice(
          t("memory.skillFreshnessUpdateFailedTitle", {}, "Skill Freshness 更新失败"),
          res?.error?.message || t("memory.skillFreshnessUpdateFailedMessage", {}, "无法更新 stale 标记。"),
          "error",
        );
        return null;
      }

      showNotice(
        stale
          ? t("memory.skillFreshnessMarkedStaleTitle", {}, "已标记 stale")
          : t("memory.skillFreshnessClearedStaleTitle", {}, "已取消 stale"),
        skillKey || sourceCandidateId || t("memory.skillFreshnessUpdateSuccessMessage", {}, "Skill Freshness 已更新。"),
        "success",
        2200,
      );

      await loadTaskUsageOverview();
      if (taskId) {
        await loadTaskDetail(taskId);
      }
      if (candidateId) {
        await loadCandidateDetail(candidateId);
      }
      return res.payload?.skillFreshness ?? null;
    } catch (error) {
      showNotice(
        t("memory.skillFreshnessUpdateFailedTitle", {}, "Skill Freshness 更新失败"),
        error instanceof Error ? error.message : String(error),
        "error",
      );
      return null;
    } finally {
      memoryViewerState.pendingExperienceActionKey = null;
      rerenderExperienceDetail(taskId, candidateId);
    }
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

  return {
    clearMemoryTaskGoalFilter,
    loadCandidateDetail,
    loadMemoryChunkViewer,
    loadMemoryDetail,
    loadMemoryViewer,
    loadMemoryViewerStats,
    loadTaskDetail,
    loadTaskUsageOverview,
    loadTaskViewer,
    generateExperienceCandidate,
    openGoalTaskViewer,
    openMemoryFromAudit,
    openTaskFromAudit,
    refreshMemoryLocale,
    reviewExperienceCandidate,
    resolveMemoryDetailTargetAgentId,
    switchMemoryViewerTab,
    syncMemoryTaskGoalFilterUi,
    syncMemoryViewerUi,
    updateSkillFreshnessStaleMark,
    getCurrentAgentLabel,
  };
}
