export function createMemoryViewerSharePromoteAction({
  getState,
  sendReq,
  makeId,
  getActiveAgentId,
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

  async function promote(item) {
    if (disposed || !item?.id) return null;
    const actionGeneration = ++generation;
    const reason = promptAction(
      t("memory.sharePromotePrompt", {}, "Enter the reason for promoting this memory to the shared layer."),
      t("memory.sharePromotePromptDefault", {}, "Manual promotion from memory viewer"),
    );
    if (reason === null || !isCurrent(actionGeneration)) return null;

    const trimmedReason = String(reason || "").trim();
    if (!trimmedReason) {
      showNotice?.(
        t("memory.sharePromoteFailedTitle", {}, "Shared Promotion Failed"),
        t("memory.sharePromotePrompt", {}, "Enter the reason for promoting this memory to the shared layer."),
        "error",
      );
      return null;
    }

    const token = Symbol("memory-share-promote");
    pendingActions.add(token);
    try {
      const res = await sendReq({
        type: "req",
        id: makeId(),
        method: "memory.share.promote",
        params: {
          chunkId: item.id,
          reason: trimmedReason,
          agentId: getActiveAgentId(),
        },
      });
      if (!isCurrent(actionGeneration)) return null;
      if (!res?.ok) {
        showNotice?.(
          t("memory.sharePromoteFailedTitle", {}, "Shared Promotion Failed"),
          res?.error?.message || t("memory.memoryReadFailed", {}, "Failed to read memory data."),
          "error",
          4200,
        );
        return null;
      }

      showNotice?.(
        t("memory.sharePromoteSuccessTitle", {}, "Shared Promotion Complete"),
        t(
          "memory.sharePromoteSuccessMessage",
          { count: Number(res.payload?.promotedCount) || 0 },
          "The shared copy has been written and the private copy is kept.",
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
      // dispose 或新 action 获得 owner 后，迟到 rejection 只完成物理结算。
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
      memorySharePromoteGeneration: generation,
      pendingMemorySharePromoteActionCount: pendingActions.size,
    };
  }

  return { dispose, getRuntimeSnapshot, promote };
}
