export function createMemoryRuntimeSkillFreshnessAction({
  getState,
  isConnected,
  sendReq,
  makeId,
  getActiveAgentId,
  showNotice,
  rerender,
  loadTaskUsageOverview,
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

  async function update(input = {}) {
    if (disposed) return null;
    if (!isConnected()) {
      showNotice?.(
        t("memory.skillFreshnessUpdateUnavailableTitle", {}, "无法更新 Skill Freshness"),
        t("memory.disconnectedList", {}, "Not connected to the server."),
        "error",
      );
      return null;
    }

    const sourceCandidateId = typeof input.sourceCandidateId === "string" ? input.sourceCandidateId.trim() : "";
    const skillKey = typeof input.skillKey === "string" ? input.skillKey.trim() : "";
    const taskId = typeof input.taskId === "string" ? input.taskId.trim() : "";
    const candidateId = typeof input.candidateId === "string" ? input.candidateId.trim() : "";
    const stale = input.stale !== false;
    if (!sourceCandidateId && !skillKey) return null;

    const state = getState();
    if (state.pendingExperienceActionKey) return null;
    const actionGeneration = ++generation;
    const pendingKey = `skill-freshness:${sourceCandidateId || skillKey}:${stale ? "stale" : "active"}`;
    const token = Symbol("skill-freshness");
    state.pendingExperienceActionKey = pendingKey;
    pendingActions.add(token);
    rerender(taskId, candidateId);

    try {
      const response = await sendReq({
        type: "req",
        id: makeId(),
        method: "experience.skill.freshness.update",
        params: {
          ...(sourceCandidateId ? { sourceCandidateId } : {}),
          ...(skillKey ? { skillKey } : {}),
          stale,
          agentId: getActiveAgentId(),
        },
      });
      if (!isCurrent(actionGeneration)) return null;
      if (!response?.ok) {
        showNotice?.(
          t("memory.skillFreshnessUpdateFailedTitle", {}, "Skill Freshness 更新失败"),
          response?.error?.message
            || t("memory.skillFreshnessUpdateFailedMessage", {}, "无法更新 stale 标记。"),
          "error",
        );
        return null;
      }

      showNotice?.(
        stale
          ? t("memory.skillFreshnessMarkedStaleTitle", {}, "已标记 stale")
          : t("memory.skillFreshnessClearedStaleTitle", {}, "已取消 stale"),
        skillKey || sourceCandidateId
          || t("memory.skillFreshnessUpdateSuccessMessage", {}, "Skill Freshness 已更新。"),
        "success",
        2200,
      );

      if (!isCurrent(actionGeneration)) return null;
      await loadTaskUsageOverview();
      if (!isCurrent(actionGeneration)) return null;
      if (taskId) {
        await loadTaskDetail(taskId);
        if (!isCurrent(actionGeneration)) return null;
      }
      if (candidateId) {
        await loadCandidateDetail(candidateId);
      }
      return isCurrent(actionGeneration) ? response.payload?.skillFreshness ?? null : null;
    } catch (error) {
      // dispose 后迟到 rejection 只用于完成物理结算。
      if (!isCurrent(actionGeneration)) return null;
      showNotice?.(
        t("memory.skillFreshnessUpdateFailedTitle", {}, "Skill Freshness 更新失败"),
        error instanceof Error ? error.message : String(error),
        "error",
      );
      return null;
    } finally {
      pendingActions.delete(token);
      if (isCurrent(actionGeneration) && state.pendingExperienceActionKey === pendingKey) {
        state.pendingExperienceActionKey = null;
        rerender(taskId, candidateId);
      }
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    generation += 1;
    const state = getState?.();
    if (state && typeof state === "object" && String(state.pendingExperienceActionKey || "").startsWith("skill-freshness:")) {
      state.pendingExperienceActionKey = null;
    }
  }

  function getRuntimeSnapshot() {
    return {
      disposed,
      memoryRuntimeSkillFreshnessGeneration: generation,
      pendingMemoryRuntimeSkillFreshnessActionCount: pendingActions.size,
    };
  }

  return { dispose, getRuntimeSnapshot, update };
}
