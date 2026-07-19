function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function createExperienceWorkbenchSkillFreshnessFeature({
  getGeneration,
  getPendingActionKey,
  isConnected,
  isOwnerCurrent,
  loadCandidateDetail,
  notifyDisconnected,
  notifyFailure,
  notifySuccess,
  renderSelectedCandidate,
  requestUpdate,
  setPendingActionKey,
  syncPendingUi,
} = {}) {
  const pendingTokens = new Set();

  function isCurrent(generation) {
    return typeof isOwnerCurrent === "function" ? isOwnerCurrent(generation) : true;
  }

  async function refreshCandidate(candidateId, generation) {
    if (!isCurrent(generation)) return;
    if (candidateId) {
      await loadCandidateDetail?.(candidateId);
      return;
    }
    renderSelectedCandidate?.();
  }

  async function updateSkillFreshnessStaleMark(input = {}) {
    const sourceCandidateId = normalizeText(input.sourceCandidateId);
    const skillKey = normalizeText(input.skillKey);
    const candidateId = normalizeText(input.candidateId);
    const stale = input.stale !== false;
    if (!sourceCandidateId && !skillKey) return null;
    if (!isConnected?.()) {
      notifyDisconnected?.();
      return null;
    }
    if (getPendingActionKey?.()) return null;

    const generation = getGeneration?.();
    if (!isCurrent(generation)) return null;
    const pendingToken = Symbol("experience-skill-freshness");
    pendingTokens.add(pendingToken);
    setPendingActionKey?.(`skill-freshness:${sourceCandidateId || skillKey}:${stale ? "stale" : "active"}`);
    syncPendingUi?.();

    try {
      const res = await requestUpdate?.({ sourceCandidateId, skillKey, stale });
      if (!isCurrent(generation)) return null;
      if (!res || !res.ok) {
        notifyFailure?.(res?.error?.message);
        return null;
      }
      notifySuccess?.();
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
          try {
            await refreshCandidate(candidateId, generation);
          } catch (error) {
            if (isCurrent(generation)) {
              notifyFailure?.(error instanceof Error ? error.message : undefined);
            }
          }
        }
      } finally {
        // Owner 可以先失效，但真实更新与详情刷新完成前不能释放 token。
        pendingTokens.delete(pendingToken);
      }
    }
  }

  function getPendingCount() {
    return pendingTokens.size;
  }

  return {
    getPendingCount,
    updateSkillFreshnessStaleMark,
  };
}
