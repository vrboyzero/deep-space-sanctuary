export function createMemoryViewerDreamConsolidationActions({
  getState,
  sendReq,
  makeId,
  getActiveAgentId,
  promptAction,
  confirmAction,
  showNotice,
  loadDreamHistory,
  loadDreamHistoryDetail,
  loadDreamRuntimeStatus,
  t = (_key, _params, fallback) => fallback ?? "",
} = {}) {
  const pendingActions = new Set();
  let generation = 0;
  let disposed = false;

  function isCurrent(expectedGeneration) {
    return !disposed && generation === expectedGeneration;
  }

  async function review(decision) {
    if (disposed) return null;
    const state = getState();
    const dreamId = typeof state.selectedDreamHistoryId === "string" ? state.selectedDreamHistoryId.trim() : "";
    const selectedItem = state.selectedDreamHistoryItem;
    if (!dreamId || !selectedItem) return null;
    const actionGeneration = ++generation;
    const note = promptAction(
      decision === "approved"
        ? t("memory.dreamConsolidationReviewApprovePrompt", {}, "可选备注：为什么批准这些低风险画像 patch？")
        : t("memory.dreamConsolidationReviewRejectPrompt", {}, "可选备注：为什么拒绝这批整理建议？"),
      "",
    );
    if (note === null || !isCurrent(actionGeneration)) return null;
    const approvedCandidatePaths = decision === "approved"
      ? (Array.isArray(selectedItem?.consolidation?.profilePatchCandidates)
        ? selectedItem.consolidation.profilePatchCandidates
          .map((candidate) => typeof candidate?.profilePath === "string" ? candidate.profilePath.trim() : "")
          .filter(Boolean)
        : [])
      : [];
    const agentId = getActiveAgentId();
    const token = Symbol("dream-consolidation-review");
    pendingActions.add(token);
    try {
      const res = await sendReq({
        type: "req",
        id: makeId(),
        method: "dream.consolidation.review",
        params: { agentId, dreamId, decision, note, approvedCandidatePaths },
      });
      if (!isCurrent(actionGeneration)) return null;
      if (!res?.ok) {
        showNotice?.(
          t("memory.dreamConsolidationReviewFailedTitle", {}, "Dream 整理审批失败"),
          res?.error?.message || t("memory.dreamConsolidationReviewFailedMessage", {}, "无法更新 Dream consolidation review。"),
          "error",
          4200,
        );
        return null;
      }
      showNotice?.(
        t("memory.dreamConsolidationReviewSuccessTitle", {}, "Dream 整理审批已更新"),
        res.payload?.record?.consolidation?.review?.status || t("memory.dreamConsolidationReviewSuccessMessage", {}, "Dream consolidation review 已更新。"),
        "success",
        2600,
      );
      await loadDreamHistory(false, agentId);
      if (!isCurrent(actionGeneration)) return null;
      await loadDreamHistoryDetail(dreamId, agentId);
      return isCurrent(actionGeneration) ? res.payload : null;
    } catch (error) {
      if (!isCurrent(actionGeneration)) return null;
      showNotice?.(t("memory.dreamConsolidationReviewFailedTitle", {}, "Dream 整理审批失败"), error instanceof Error ? error.message : String(error), "error", 4200);
      return null;
    } finally {
      pendingActions.delete(token);
    }
  }

  async function apply() {
    if (disposed) return null;
    const state = getState();
    const dreamId = typeof state.selectedDreamHistoryId === "string" ? state.selectedDreamHistoryId.trim() : "";
    if (!dreamId) return null;
    const actionGeneration = ++generation;
    const confirmed = confirmAction(t("memory.dreamConsolidationApplyConfirm", {}, "这会写入 canonical profile state。是否继续应用已批准的低风险画像 patch？"));
    if (!confirmed || !isCurrent(actionGeneration)) return null;
    const note = promptAction(t("memory.dreamConsolidationApplyPrompt", {}, "可选备注：本次 Dream consolidation apply 的说明"), "");
    if (note === null || !isCurrent(actionGeneration)) return null;
    const agentId = getActiveAgentId();
    const token = Symbol("dream-consolidation-apply");
    pendingActions.add(token);
    try {
      const res = await sendReq({
        type: "req",
        id: makeId(),
        method: "dream.consolidation.apply",
        params: { agentId, dreamId, confirmed: true, note },
      });
      if (!isCurrent(actionGeneration)) return null;
      if (!res?.ok) {
        showNotice?.(t("memory.dreamConsolidationApplyFailedTitle", {}, "Dream 整理应用失败"), res?.error?.message || t("memory.dreamConsolidationApplyFailedMessage", {}, "无法应用 Dream consolidation patch。"), "error", 4200);
        return null;
      }
      showNotice?.(
        t("memory.dreamConsolidationApplySuccessTitle", {}, "Dream 整理 patch 已应用"),
        t("memory.dreamConsolidationApplySuccessMessage", { count: String(res.payload?.appliedPatchCount || 0) }, `已应用 ${String(res.payload?.appliedPatchCount || 0)} 条低风险画像 patch。`),
        "success",
        2600,
      );
      await loadDreamHistory(false, agentId);
      if (!isCurrent(actionGeneration)) return null;
      await loadDreamHistoryDetail(dreamId, agentId);
      if (!isCurrent(actionGeneration)) return null;
      void loadDreamRuntimeStatus({ requestToken: Number(state.requestToken || 0), agentId });
      return res.payload;
    } catch (error) {
      if (!isCurrent(actionGeneration)) return null;
      showNotice?.(t("memory.dreamConsolidationApplyFailedTitle", {}, "Dream 整理应用失败"), error instanceof Error ? error.message : String(error), "error", 4200);
      return null;
    } finally {
      pendingActions.delete(token);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    generation += 1;
  }

  function getRuntimeSnapshot() {
    return { disposed, dreamConsolidationGeneration: generation, pendingDreamConsolidationActionCount: pendingActions.size };
  }

  return { apply, dispose, getRuntimeSnapshot, review };
}
