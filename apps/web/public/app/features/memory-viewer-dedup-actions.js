export function createMemoryViewerDedupActions({
  getModalState,
  isConnected,
  sendReq,
  makeId,
  getActiveAgentId,
  buildFilter,
  render,
  showNotice,
  loadMemoryViewer,
  t = (_key, _params, fallback) => fallback ?? "",
} = {}) {
  const pendingActions = new Set();
  let generation = 0;
  let disposed = false;

  function isCurrent(expectedGeneration) {
    return !disposed && expectedGeneration === generation;
  }

  async function openPreview() {
    if (disposed) return null;
    const actionGeneration = ++generation;
    const token = Symbol("memory-dedup-preview");
    pendingActions.add(token);
    const state = getModalState();
    state.open = true;
    state.loading = true;
    state.applying = false;
    state.error = "";
    state.report = null;
    state.result = null;
    render();
    try {
      if (!isConnected()) {
        state.loading = false;
        state.error = t("memory.dedupPreviewDisconnected", {}, "当前未连接到服务器，无法执行重复预检。");
        render();
        return null;
      }
      const res = await sendReq({
        type: "req",
        id: makeId(),
        method: "memory.dedup.preview",
        params: { agentId: getActiveAgentId(), filter: buildFilter() },
      });
      if (!isCurrent(actionGeneration)) return null;
      state.loading = false;
      if (!res?.ok) {
        state.error = res?.error?.message || t("memory.dedupPreviewFailed", {}, "重复预检失败。");
        render();
        return null;
      }
      state.report = res.payload?.report ?? null;
      render();
      return state.report;
    } catch (error) {
      if (!isCurrent(actionGeneration)) return null;
      state.loading = false;
      state.error = error instanceof Error ? error.message : String(error);
      render();
      return null;
    } finally {
      pendingActions.delete(token);
    }
  }

  async function apply() {
    if (disposed) return null;
    const state = getModalState();
    const report = state.report && typeof state.report === "object" ? state.report : null;
    if (!report || state.loading || state.applying || state.result) return null;
    if (!Array.isArray(report.groups) || report.groups.length <= 0) {
      state.error = t("memory.dedupApplyNothing", {}, "当前没有可清理的重复组。");
      render();
      return null;
    }
    const actionGeneration = ++generation;
    const token = Symbol("memory-dedup-apply");
    pendingActions.add(token);
    state.applying = true;
    state.error = "";
    render();
    try {
      const res = await sendReq({
        type: "req",
        id: makeId(),
        method: "memory.dedup.apply",
        params: { agentId: getActiveAgentId(), filter: buildFilter(), confirmed: true },
      });
      if (!isCurrent(actionGeneration)) return null;
      state.applying = false;
      if (!res?.ok) {
        state.error = res?.error?.message || t("memory.dedupApplyFailed", {}, "重复清理失败。");
        render();
        return null;
      }
      state.result = res.payload?.result ?? null;
      render();
      showNotice?.(
        t("memory.dedupNoticeTitle", {}, "记忆重复清理已完成"),
        state.result?.backupPath || "已生成备份并完成清理。",
        "success",
        3200,
      );
      await loadMemoryViewer(true);
      if (!isCurrent(actionGeneration)) return null;
      return state.result;
    } catch (error) {
      if (!isCurrent(actionGeneration)) return null;
      state.applying = false;
      state.error = error instanceof Error ? error.message : String(error);
      render();
      return null;
    } finally {
      pendingActions.delete(token);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    generation += 1;
    const state = getModalState?.();
    if (state) {
      state.loading = false;
      state.applying = false;
    }
  }

  function getRuntimeSnapshot() {
    return { dedupActionGeneration: generation, disposed, pendingDedupActionCount: pendingActions.size };
  }

  return { apply, dispose, getRuntimeSnapshot, openPreview };
}
