export function createMemoryViewerDreamRunAction({
  getState,
  isConnected,
  sendReq,
  makeId,
  getActiveAgentId,
  normalizeRuntime,
  render,
  showNotice,
  loadDreamHistory,
  loadDreamRuntimeStatus,
  t,
} = {}) {
  const pendingActions = new Set();
  let generation = 0;
  let disposed = false;

  function isCurrent(expectedGeneration) {
    return !disposed && generation === expectedGeneration;
  }

  async function run() {
    if (disposed) return null;
    const state = getState();
    if (state.dreamBusy) return null;
    if (!isConnected()) {
      showNotice?.(
        t("memory.dreamRunDisconnectedTitle", {}, "Dream 运行失败"),
        t("memory.dreamRunDisconnectedMessage", {}, "当前未连接到服务器，无法触发 dream.run。"),
        "error",
      );
      return null;
    }

    const actionGeneration = ++generation;
    const agentId = getActiveAgentId();
    const token = Symbol("dream-run");
    state.dreamBusy = true;
    pendingActions.add(token);
    render();
    try {
      const res = await sendReq({
        type: "req",
        id: makeId(),
        method: "dream.run",
        params: { agentId },
      });
      if (!isCurrent(actionGeneration)) return null;
      if (!res?.ok) {
        showNotice?.(
          t("memory.dreamRunFailedTitle", {}, "Dream 运行失败"),
          res?.error?.message || t("memory.dreamRunFailedMessage", {}, "dream.run 调用失败。"),
          "error",
        );
        return null;
      }

      const previousConversationId = state.dreamRuntime?.requested?.defaultConversationId ?? null;
      state.dreamRuntime = {
        ...normalizeRuntime(res.payload, agentId),
        requested: { agentId, defaultConversationId: previousConversationId },
      };
      render();
      if (!isCurrent(actionGeneration)) return null;
      showNotice?.(
        t("memory.dreamRunSuccessTitle", {}, "Dream 已运行"),
        res.payload?.record?.summary || t("memory.dreamRunSuccessMessage", {}, "已生成新的 dream 记录。"),
        res.payload?.record?.status === "failed" ? "warn" : "success",
        2600,
      );
      if (!isCurrent(actionGeneration)) return null;
      if (state.dreamHistoryOpen) {
        void loadDreamHistory(true, agentId);
      }
      if (!isCurrent(actionGeneration)) return null;
      void loadDreamRuntimeStatus({
        requestToken: Number(state.requestToken || 0),
        agentId,
      });
      return res.payload;
    } catch (error) {
      // 已释放 action 的 rejection 只完成物理结算，不再向页面传播。
      if (!isCurrent(actionGeneration)) return null;
      throw error;
    } finally {
      pendingActions.delete(token);
      if (isCurrent(actionGeneration)) {
        state.dreamBusy = false;
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
      state.dreamBusy = false;
    }
  }

  function getRuntimeSnapshot() {
    return {
      disposed,
      dreamRunGeneration: generation,
      pendingDreamRunActionCount: pendingActions.size,
    };
  }

  return { dispose, getRuntimeSnapshot, run };
}
