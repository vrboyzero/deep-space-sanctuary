export function createMemoryViewerShareBatchAction({
  getState,
  getSelectedIds,
  getActiveAgentId,
  buildBatchState,
  promptAction,
  sendClaimRequest,
  sendReviewRequest,
  render,
  formatActionLabel,
  formatCount,
  showNotice,
  loadMemoryViewer,
  loadMemoryDetail,
  t,
} = {}) {
  const pendingActions = new Set();
  let generation = 0;
  let disposed = false;

  function isCurrent(expectedGeneration) {
    return !disposed && generation === expectedGeneration;
  }

  async function run(action) {
    if (disposed) return null;
    const state = getState();
    if (state.sharedReviewBatchBusy === true) return null;
    const batchState = buildBatchState(state.items, getSelectedIds(), getActiveAgentId());
    const eligibleItems = batchState.actions[action] || [];
    if (!eligibleItems.length) return null;

    const actionGeneration = ++generation;
    let note = "";
    if (action === "approved" || action === "rejected" || action === "revoked") {
      const promptKey = action === "approved"
        ? "memory.shareReviewPromptApprove"
        : action === "rejected"
          ? "memory.shareReviewPromptReject"
          : "memory.shareReviewPromptRevoke";
      const promptValue = promptAction(t(promptKey, {}, "Optional note"), "");
      if (promptValue === null || !isCurrent(actionGeneration)) return null;
      note = String(promptValue || "").trim();
    }

    const token = Symbol("memory-share-batch");
    state.sharedReviewBatchBusy = true;
    pendingActions.add(token);
    render();
    let successCount = 0;
    const errors = [];
    try {
      for (const item of eligibleItems) {
        const res = action === "claim" || action === "release"
          ? await sendClaimRequest(item, action, "chunk")
          : await sendReviewRequest(item, action, note, "chunk");
        if (!isCurrent(actionGeneration)) return null;
        if (res?.ok) {
          successCount += 1;
        } else {
          errors.push(res?.error?.message || t("memory.memoryReadFailed", {}, "Failed to read memory data."));
        }
      }

      state.sharedReviewBatchBusy = false;
      if (successCount > 0) {
        const successTitle = action === "claim" || action === "release"
          ? t("memory.shareClaimSuccessTitle", {}, "Shared Claim Updated")
          : t("memory.shareReviewSuccessTitle", {}, "Shared Review Updated");
        showNotice?.(
          successTitle,
          t(
            "memory.sharedReviewBatchSuccessMessage",
            {
              action: formatActionLabel(action),
              count: formatCount(successCount),
              skipped: formatCount(batchState.selectedCount - successCount),
            },
            `${action} applied to ${formatCount(successCount)} selected item(s).`,
          ),
          errors.length ? "info" : "success",
          3200,
        );
      }
      if (!successCount && errors.length) {
        showNotice?.(
          t("memory.sharedReviewBatchFailedTitle", {}, "Batch Shared Review Failed"),
          errors[0],
          "error",
          4200,
        );
      }
      if (!isCurrent(actionGeneration)) return null;
      await loadMemoryViewer(false);
      if (!isCurrent(actionGeneration)) return null;
      const selectedId = typeof state.selectedId === "string" ? state.selectedId.trim() : "";
      if (selectedId) {
        await loadMemoryDetail(selectedId);
      }
      return isCurrent(actionGeneration)
        ? { successCount, errorCount: errors.length }
        : null;
    } catch (error) {
      if (!isCurrent(actionGeneration)) return null;
      throw error;
    } finally {
      pendingActions.delete(token);
      if (isCurrent(actionGeneration) && state.sharedReviewBatchBusy) {
        // 异常路径不能把 batch bar 永久留在 busy；正常路径仍由 reload 重绘。
        state.sharedReviewBatchBusy = false;
        render();
      }
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    generation += 1;
    const state = getState?.();
    if (state && typeof state === "object") {
      state.sharedReviewBatchBusy = false;
    }
  }

  function getRuntimeSnapshot() {
    return {
      disposed,
      memoryShareBatchGeneration: generation,
      pendingMemoryShareBatchActionCount: pendingActions.size,
    };
  }

  return { dispose, getRuntimeSnapshot, run };
}
