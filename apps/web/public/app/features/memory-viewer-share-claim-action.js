export function createMemoryViewerShareClaimAction({
  getState,
  sendRequest,
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

  async function claim(item, action, scope = "chunk") {
    if (disposed || !item?.id) return null;
    const actionGeneration = ++generation;
    const token = Symbol("memory-share-claim");
    pendingActions.add(token);
    try {
      const res = await sendRequest(item, action, scope);
      if (!isCurrent(actionGeneration)) return null;
      if (!res?.ok) {
        showNotice?.(
          t("memory.shareClaimFailedTitle", {}, "Failed to Update Shared Claim"),
          res?.error?.message || t("memory.memoryReadFailed", {}, "Failed to read memory data."),
          "error",
          4200,
        );
        return null;
      }

      showNotice?.(
        t("memory.shareClaimSuccessTitle", {}, "Shared Claim Updated"),
        t(
          "memory.shareClaimSuccessMessage",
          {
            action,
            count: Number(res.payload?.claimedCount) || 0,
            scope: res.payload?.mode || scope,
          },
          "Shared review claim has been updated.",
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
      // owner 已失效时抑制迟到 rejection，保留 active rejection 的原传播契约。
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
      memoryShareClaimGeneration: generation,
      pendingMemoryShareClaimActionCount: pendingActions.size,
    };
  }

  return { claim, dispose, getRuntimeSnapshot };
}
