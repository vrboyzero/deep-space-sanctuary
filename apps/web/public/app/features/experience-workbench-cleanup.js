export function createExperienceWorkbenchCleanupFeature({
  confirmCleanup,
  getConsumedDraftCount,
  getGeneration,
  getPendingActionKey,
  isConnected,
  isOwnerCurrent,
  loadExperienceWorkbench,
  notifyDisconnected,
  notifyFailure,
  notifySuccess,
  requestCleanup,
  setPendingActionKey,
  syncExperienceWorkbenchUi,
  syncPendingUi,
} = {}) {
  const pendingTokens = new Set();

  function isCurrent(generation) {
    return typeof isOwnerCurrent === "function" ? isOwnerCurrent(generation) : true;
  }

  async function cleanupConsumedExperienceCandidates() {
    const consumedDraftCount = Math.max(0, Number(getConsumedDraftCount?.()) || 0);
    if (consumedDraftCount <= 0) return null;
    if (!isConnected?.()) {
      notifyDisconnected?.();
      return null;
    }
    if (getPendingActionKey?.()) return null;
    const confirmed = typeof confirmCleanup === "function" ? confirmCleanup(consumedDraftCount) : true;
    if (!confirmed) return null;

    const generation = getGeneration?.();
    if (!isCurrent(generation)) return null;
    const pendingToken = Symbol("experience-cleanup-consumed");
    pendingTokens.add(pendingToken);
    setPendingActionKey?.("cleanup-consumed");
    syncPendingUi?.();

    try {
      const res = await requestCleanup?.();
      if (!isCurrent(generation)) return null;
      if (!res || !res.ok) {
        notifyFailure?.(res?.error?.message);
        return null;
      }
      await loadExperienceWorkbench?.(false);
      if (!isCurrent(generation)) return null;
      await syncExperienceWorkbenchUi?.({ preferFirst: true, loadDetailIfNeeded: true });
      if (!isCurrent(generation)) return null;
      notifySuccess?.(Math.max(0, Number(res.payload?.count) || 0));
      return res.payload ?? null;
    } catch (error) {
      if (!isCurrent(generation)) return null;
      notifyFailure?.(error instanceof Error ? error.message : undefined);
      return null;
    } finally {
      try {
        if (isCurrent(generation)) {
          setPendingActionKey?.(null);
          syncPendingUi?.();
        }
      } finally {
        // Owner 可以先失效，但真实 cleanup 请求必须完成后才能释放 token。
        pendingTokens.delete(pendingToken);
      }
    }
  }

  function getPendingCount() {
    return pendingTokens.size;
  }

  return {
    cleanupConsumedExperienceCandidates,
    getPendingCount,
  };
}
