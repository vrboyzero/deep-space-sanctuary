export function createMemoryRuntimeExperienceReviewAction({
  getState,
  isConnected,
  sendReq,
  makeId,
  getActiveAgentId,
  showNotice,
  rerender,
  loadTaskDetail,
  loadCandidateDetail,
  t,
} = {}) {
  const pendingActions = new Set();
  let generation = 0;
  let disposed = false;

  function isCurrent(expectedGeneration) {
    return !disposed && generation === expectedGeneration;
  }

  async function review(candidateId, decision, options = {}) {
    if (disposed) return null;
    if (!isConnected()) {
      showNotice?.(
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

    const state = getState();
    if (state.pendingExperienceActionKey) return null;
    const actionGeneration = ++generation;
    const pendingKey = `candidate:${normalizedCandidateId}:${normalizedDecision}`;
    const token = Symbol("experience-review");
    state.pendingExperienceActionKey = pendingKey;
    pendingActions.add(token);
    rerender(taskId, normalizedCandidateId);

    try {
      const response = await sendReq({
        type: "req",
        id: makeId(),
        method: normalizedDecision === "accept" ? "experience.candidate.accept" : "experience.candidate.reject",
        params: {
          candidateId: normalizedCandidateId,
          agentId: getActiveAgentId(),
        },
      });
      if (!isCurrent(actionGeneration)) return null;
      if (!response?.ok) {
        showNotice?.(
          t("memory.candidateReviewFailedTitle", {}, "候选审核失败"),
          response?.error?.message
            || t("memory.candidateReviewFailedMessage", {}, "经验候选状态更新失败。"),
          "error",
        );
        return null;
      }

      const candidate = response.payload?.candidate ?? null;
      showNotice?.(
        normalizedDecision === "accept"
          ? t("memory.candidateAcceptSuccessTitle", {}, "候选已接受")
          : t("memory.candidateRejectSuccessTitle", {}, "候选已拒绝"),
        candidate?.title
          ? String(candidate.title)
          : t("memory.candidateReviewSuccessMessage", {}, "经验候选状态已更新。"),
        "success",
        2200,
      );

      if (!isCurrent(actionGeneration)) return null;
      if (taskId) {
        await loadTaskDetail(taskId);
        if (!isCurrent(actionGeneration)) return null;
      }
      await loadCandidateDetail(normalizedCandidateId);
      return isCurrent(actionGeneration) ? candidate : null;
    } catch (error) {
      // dispose 后迟到 rejection 只用于完成物理结算。
      if (!isCurrent(actionGeneration)) return null;
      showNotice?.(
        t("memory.candidateReviewFailedTitle", {}, "候选审核失败"),
        error instanceof Error ? error.message : String(error),
        "error",
      );
      return null;
    } finally {
      pendingActions.delete(token);
      if (isCurrent(actionGeneration) && state.pendingExperienceActionKey === pendingKey) {
        state.pendingExperienceActionKey = null;
        rerender(taskId, normalizedCandidateId);
      }
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    generation += 1;
    const state = getState?.();
    if (state && typeof state === "object" && String(state.pendingExperienceActionKey || "").startsWith("candidate:")) {
      state.pendingExperienceActionKey = null;
    }
  }

  function getRuntimeSnapshot() {
    return {
      disposed,
      memoryRuntimeExperienceReviewGeneration: generation,
      pendingMemoryRuntimeExperienceReviewActionCount: pendingActions.size,
    };
  }

  return { dispose, getRuntimeSnapshot, review };
}
