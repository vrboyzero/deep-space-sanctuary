export function createMemoryDetailStatsListenerLifecycle({
  openTaskFromAudit,
  openSourcePath,
  loadCandidateDetail,
  switchMode,
  loadGoals,
} = {}) {
  const listenerDisposers = new Set();
  let disposed = false;

  function clearListeners() {
    for (const disposeListener of listenerDisposers) disposeListener();
    listenerDisposers.clear();
  }

  function addClickListener(node, listener) {
    node.addEventListener("click", listener);
    listenerDisposers.add(() => node.removeEventListener("click", listener));
  }

  function bindStatsAuditJumpLinks(container) {
    clearListeners();
    if (disposed || !container?.querySelectorAll) return;
    container.querySelectorAll("[data-open-task-id]").forEach((node) => {
      addClickListener(node, async () => {
        await openTaskFromAudit?.(node.getAttribute("data-open-task-id"));
      });
    });
    container.querySelectorAll("[data-open-source]").forEach((node) => {
      addClickListener(node, async () => {
        await openSourcePath?.(node.getAttribute("data-open-source"));
      });
    });
    container.querySelectorAll("[data-open-candidate-id]").forEach((node) => {
      addClickListener(node, async () => {
        await loadCandidateDetail?.(node.getAttribute("data-open-candidate-id"));
      });
    });
    container.querySelectorAll("[data-open-goal-id]").forEach((node) => {
      addClickListener(node, async () => {
        const goalId = node.getAttribute("data-open-goal-id");
        if (!goalId) return;
        switchMode?.("goals");
        await loadGoals?.(true, goalId);
      });
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
      retainedStatsAuditListenerCount: listenerDisposers.size,
    };
  }

  return {
    bindStatsAuditJumpLinks,
    dispose,
    getRuntimeSnapshot,
  };
}
