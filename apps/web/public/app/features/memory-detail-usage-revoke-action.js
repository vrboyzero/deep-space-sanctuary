function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function createMemoryDetailUsageRevokeAction({
  getState,
  isConnected,
  sendReq,
  makeId,
  getActiveAgentId,
  showNotice,
  renderTaskDetail,
  renderMemoryViewerStats,
  loadTaskUsageOverview,
  loadTaskDetail,
  t = (_key, _params, fallback) => fallback ?? "",
} = {}) {
  const pendingActions = new Set();
  let generation = 0;
  let activeBusyKey = "";
  let disposed = false;

  function isCurrent(expectedGeneration) {
    return !disposed && generation === expectedGeneration;
  }

  function renderBusyState(taskId, includeStats = false) {
    const state = getState?.() ?? {};
    if (state.selectedTask?.id === taskId) {
      renderTaskDetail?.(state.selectedTask);
    }
    if (includeStats) renderMemoryViewerStats?.(state.stats);
  }

  function releaseBusy() {
    const state = getState?.();
    if (state && activeBusyKey && state.pendingUsageRevokeId === activeBusyKey) {
      state.pendingUsageRevokeId = null;
    }
    activeBusyKey = "";
  }

  async function revoke(usageId, taskId, assetKey = "") {
    if (disposed) return undefined;
    const normalizedUsageId = normalizeString(usageId);
    const normalizedTaskId = normalizeString(taskId);
    const normalizedAssetKey = normalizeString(assetKey);
    if (!normalizedUsageId || !normalizedTaskId) return undefined;
    if (!(typeof isConnected === "function" ? isConnected() : isConnected)) {
      showNotice?.(
        t("memory.usageRevokeUnavailableTitle", {}, "Unable to revoke usage"),
        t("memory.disconnectedList", {}, "Not connected to the server."),
        "error",
      );
      return undefined;
    }

    const state = getState?.() ?? {};
    if (state.pendingUsageRevokeId) return undefined;
    const actionGeneration = ++generation;
    const token = Symbol("usage-revoke-action");
    activeBusyKey = normalizedUsageId;
    state.pendingUsageRevokeId = normalizedUsageId;
    pendingActions.add(token);
    renderBusyState(normalizedTaskId);

    try {
      const res = await sendReq({
        type: "req",
        id: makeId(),
        method: "experience.usage.revoke",
        params: {
          usageId: normalizedUsageId,
          agentId: normalizeString(getActiveAgentId?.()) || "default",
        },
      });
      if (!isCurrent(actionGeneration)) return undefined;
      if (!res?.ok || !res.payload?.revoked) {
        showNotice?.(
          t("memory.usageRevokeFailedTitle", {}, "Revoke failed"),
          res?.error?.message || t("memory.usageRevokeFailedMessage", {}, "Usage was not revoked."),
          "error",
        );
        return undefined;
      }

      showNotice?.(
        t("memory.usageRevokedTitle", {}, "Usage revoked"),
        normalizedAssetKey
          ? t(
            "memory.usageRevokedWithAsset",
            { assetKey: normalizedAssetKey },
            `${normalizedAssetKey} was removed from the current task usage record.`,
          )
          : t("memory.usageRevokedMessage", {}, "This experience usage record has been revoked."),
        "success",
        2200,
      );
      if (!isCurrent(actionGeneration)) return undefined;
      await Promise.all([
        loadTaskUsageOverview?.(),
        loadTaskDetail?.(normalizedTaskId),
      ]);
      if (!isCurrent(actionGeneration)) return undefined;
    } catch (error) {
      if (!isCurrent(actionGeneration)) return undefined;
      showNotice?.(
        t("memory.usageRevokeFailedTitle", {}, "Revoke failed"),
        error instanceof Error ? error.message : String(error),
        "error",
      );
    } finally {
      // generation 只截止逻辑提交，pending 直到 RPC/reload 链真实结算后才释放。
      pendingActions.delete(token);
      if (isCurrent(actionGeneration)) {
        releaseBusy();
        renderBusyState(normalizedTaskId, true);
      }
    }
    return undefined;
  }

  function clearGeneration() {
    if (disposed) return;
    generation += 1;
    releaseBusy();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    generation += 1;
    releaseBusy();
  }

  function getRuntimeSnapshot() {
    return {
      disposed,
      usageRevokeGeneration: generation,
      pendingUsageRevokeActionCount: pendingActions.size,
    };
  }

  return {
    clearGeneration,
    dispose,
    getRuntimeSnapshot,
    revoke,
  };
}
