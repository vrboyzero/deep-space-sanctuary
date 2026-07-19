function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function createMemoryDetailUsageRevokeListenerLifecycle({
  getState,
  confirmAction,
  revokeTaskUsage,
  t = (_key, _params, fallback) => fallback ?? "",
} = {}) {
  const listenerDisposers = new Set();
  let disposed = false;

  function clearListeners() {
    for (const disposeListener of listenerDisposers) disposeListener();
    listenerDisposers.clear();
  }

  function bindTaskUsageRevokeButtons(container, taskId) {
    clearListeners();
    const fallbackTaskId = normalizeString(taskId);
    if (disposed || !fallbackTaskId || !container?.querySelectorAll) return;
    container.querySelectorAll("[data-revoke-usage-id]").forEach((node) => {
      const listener = async () => {
        if (disposed) return;
        const usageId = normalizeString(node.getAttribute("data-revoke-usage-id"));
        const effectiveTaskId = normalizeString(node.getAttribute("data-revoke-task-id")) || fallbackTaskId;
        const assetKey = normalizeString(node.getAttribute("data-revoke-asset-key"));
        if (!usageId || !effectiveTaskId || getState?.()?.pendingUsageRevokeId) return;
        const confirmed = confirmAction?.(
          t(
            "memory.usageRevokeConfirm",
            { target: assetKey || usageId },
            `Confirm revoking this usage record?\n\n${assetKey || usageId}`,
          ),
        );
        if (!confirmed || disposed) return;
        await revokeTaskUsage?.(usageId, effectiveTaskId, assetKey);
      };
      node.addEventListener("click", listener);
      listenerDisposers.add(() => node.removeEventListener("click", listener));
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearListeners();
  }

  function getRuntimeSnapshot() {
    return {
      disposed,
      retainedUsageRevokeButtonListenerCount: listenerDisposers.size,
    };
  }

  return {
    bindTaskUsageRevokeButtons,
    dispose,
    getRuntimeSnapshot,
  };
}
