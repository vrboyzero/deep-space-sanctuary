function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function createMemoryDetailSourceExplanationLifecycle({
  isConnected,
  sendReq,
  makeId,
  getMemoryViewerState,
  getCurrentAgentSelection,
  renderTaskDetail,
  showNotice,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const pendingReads = new Set();
  let generation = 0;
  let disposed = false;

  function getState() {
    return getMemoryViewerState?.() ?? {};
  }

  function getAgentId(state = getState()) {
    return normalizeString(state.activeAgentId || getCurrentAgentSelection?.()) || "default";
  }

  function matchesTask(task, taskId, conversationId) {
    if (!task) return false;
    return taskId
      ? task.id === taskId
      : task.conversationId === conversationId;
  }

  function isCurrent(expectedGeneration, taskId, conversationId, agentId) {
    const state = getState();
    return !disposed
      && generation === expectedGeneration
      && getAgentId(state) === agentId
      && matchesTask(state.selectedTask, taskId, conversationId);
  }

  async function loadTaskSourceExplanation(taskId, conversationId = "") {
    if (disposed) return;
    const normalizedTaskId = normalizeString(taskId);
    const normalizedConversationId = normalizeString(conversationId);
    const state = getState();
    const selectedTask = state.selectedTask;
    if (!selectedTask || (!normalizedTaskId && !normalizedConversationId)) return;
    if (!isConnected?.()) {
      showNotice?.(
        t("memory.taskSourceExplanationLoadFailedTitle", {}, "来源解释加载失败"),
        t("memory.disconnectedDetail", {}, "连接完成后可查看任务与记忆。"),
        "error",
      );
      return;
    }
    if (!matchesTask(selectedTask, normalizedTaskId, normalizedConversationId)
      || selectedTask.sourceExplanationLoading) return;

    const requestGeneration = ++generation;
    const requestAgentId = getAgentId(state);
    const pendingToken = Symbol("source-explanation-read");
    pendingReads.add(pendingToken);
    selectedTask.sourceExplanationLoading = true;
    selectedTask.sourceExplanationError = "";
    renderTaskDetail?.(selectedTask);

    try {
      const res = await sendReq({
        type: "req",
        id: makeId(),
        method: "memory.explain_sources",
        params: {
          ...(normalizedTaskId ? { taskId: normalizedTaskId } : {}),
          ...(normalizedConversationId ? { conversationId: normalizedConversationId } : {}),
          agentId: requestAgentId,
        },
      });
      if (!isCurrent(requestGeneration, normalizedTaskId, normalizedConversationId, requestAgentId)) return;
      const latestTask = getState().selectedTask;
      if (!res?.ok) {
        latestTask.sourceExplanation = null;
        latestTask.sourceExplanationError = res?.error?.message
          || t("memory.taskSourceExplanationLoadFailed", {}, "来源解释加载失败。");
        return;
      }
      latestTask.sourceExplanation = res.payload?.explanation ?? null;
      latestTask.sourceExplanationError = "";
    } catch (error) {
      if (!isCurrent(requestGeneration, normalizedTaskId, normalizedConversationId, requestAgentId)) return;
      const latestTask = getState().selectedTask;
      latestTask.sourceExplanation = null;
      latestTask.sourceExplanationError = error instanceof Error
        ? error.message
        : String(error);
    } finally {
      // generation 只截止逻辑提交，pending 直到真实请求结算后才释放。
      pendingReads.delete(pendingToken);
      if (isCurrent(requestGeneration, normalizedTaskId, normalizedConversationId, requestAgentId)) {
        const latestTask = getState().selectedTask;
        latestTask.sourceExplanationLoading = false;
        renderTaskDetail?.(latestTask);
      }
    }
  }

  function clearGeneration() {
    if (disposed) return;
    generation += 1;
    const selectedTask = getState().selectedTask;
    if (selectedTask?.sourceExplanationLoading) {
      selectedTask.sourceExplanationLoading = false;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    generation += 1;
    const selectedTask = getState().selectedTask;
    if (selectedTask?.sourceExplanationLoading) {
      selectedTask.sourceExplanationLoading = false;
    }
  }

  function getRuntimeSnapshot() {
    return {
      disposed,
      sourceExplanationGeneration: generation,
      pendingSourceExplanationReadCount: pendingReads.size,
    };
  }

  return {
    clearGeneration,
    dispose,
    getRuntimeSnapshot,
    loadTaskSourceExplanation,
  };
}
