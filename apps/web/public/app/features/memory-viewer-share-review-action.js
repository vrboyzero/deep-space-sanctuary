export function createMemoryViewerShareReviewAction({
  getState,
  sendRequest,
  promptAction,
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

  async function review(item, decision, scope = "chunk") {
    if (disposed || !item?.id) return null;
    const actionGeneration = ++generation;
    const promptKey = decision === "approved"
      ? "memory.shareReviewPromptApprove"
      : decision === "rejected"
        ? "memory.shareReviewPromptReject"
        : "memory.shareReviewPromptRevoke";
    const note = promptAction(t(promptKey, {}, "Optional note"), "");
    if (note === null || !isCurrent(actionGeneration)) return null;

    const token = Symbol("memory-share-review");
    pendingActions.add(token);
    try {
      const res = await sendRequest(item, decision, note, scope);
      if (!isCurrent(actionGeneration)) return null;
      if (!res?.ok) {
        showNotice?.(
          t("memory.shareReviewFailedTitle", {}, "Failed to Update Shared Review"),
          res?.error?.message || t("memory.memoryReadFailed", {}, "Failed to read memory data."),
          "error",
          4200,
        );
        return null;
      }

      showNotice?.(
        t("memory.shareReviewSuccessTitle", {}, "Shared Review Updated"),
        t(
          "memory.shareReviewSuccessMessage",
          {
            decision,
            count: Number(res.payload?.reviewedCount) || 0,
            scope: res.payload?.mode || scope,
          },
          "Shared status has been updated.",
        ),
        "success",
        2600,
      );
      if (!isCurrent(actionGeneration)) return null;
      await loadMemoryViewer(false);
      if (!isCurrent(actionGeneration)) return null;
      const state = getState?.();
      const selectedId = typeof state?.selectedId === "string" ? state.selectedId.trim() : "";
      if (selectedId) {
        await loadMemoryDetail(selectedId);
      }
      return isCurrent(actionGeneration) ? res.payload : null;
    } catch (error) {
      // dispose 或新 review 获得 owner 后，迟到 rejection 只完成物理结算。
      if (!isCurrent(actionGeneration)) return null;
      throw error;
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
    return {
      disposed,
      memoryShareReviewGeneration: generation,
      pendingMemoryShareReviewActionCount: pendingActions.size,
    };
  }

  return { dispose, getRuntimeSnapshot, review };
}
