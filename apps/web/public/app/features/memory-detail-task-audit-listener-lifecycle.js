export function createMemoryDetailTaskAuditListenerLifecycle({
  getState,
  getMemoryRuntimeFeature,
  openTaskFromAudit,
  loadCandidateDetail,
  openExperienceCandidate,
  switchMode,
  loadGoals,
  openGoalTaskViewer,
  renderTaskDetail,
  renderDetailEmpty,
  openMemoryFromAudit,
  loadTaskSourceExplanation,
  t = (_key, _params, fallback) => fallback ?? "",
} = {}) {
  const listenerDisposers = new Set();
  let disposed = false;

  function clearListeners() {
    for (const disposeListener of listenerDisposers) disposeListener();
    listenerDisposers.clear();
  }

  function bindClickListeners(container, selector, handler) {
    container.querySelectorAll(selector).forEach((node) => {
      const listener = async () => {
        if (disposed) return;
        await handler(node);
      };
      node.addEventListener("click", listener);
      listenerDisposers.add(() => node.removeEventListener("click", listener));
    });
  }

  function bindTaskAuditJumpLinks(container) {
    // Detail DOM 会整块重绘；每次 bind 先释放上一批闭包，避免旧节点继续持有状态。
    clearListeners();
    if (disposed || !container?.querySelectorAll) return;

    bindClickListeners(container, "[data-open-task-id]", async (node) => {
      await openTaskFromAudit?.(node.getAttribute("data-open-task-id"));
    });
    bindClickListeners(container, "[data-open-candidate-id]", async (node) => {
      await loadCandidateDetail?.(node.getAttribute("data-open-candidate-id"));
    });
    bindClickListeners(container, "[data-open-experience-candidate-id]", async (node) => {
      await openExperienceCandidate?.(node.getAttribute("data-open-experience-candidate-id"));
    });
    bindClickListeners(container, "[data-open-goal-id]", async (node) => {
      const goalId = node.getAttribute("data-open-goal-id");
      if (!goalId) return;
      switchMode?.("goals");
      await loadGoals?.(true, goalId);
    });
    bindClickListeners(container, "[data-open-goal-tasks]", async (node) => {
      const goalId = node.getAttribute("data-open-goal-tasks");
      if (!goalId) return;
      await openGoalTaskViewer?.(goalId);
    });
    bindClickListeners(container, "[data-close-candidate-panel]", async () => {
      const state = getState?.() ?? {};
      state.selectedCandidate = null;
      if (state.selectedTask) {
        renderTaskDetail?.(state.selectedTask);
        return;
      }
      renderDetailEmpty?.(t("memory.selectTask", {}, "Please select a task."));
    });
    bindClickListeners(container, "[data-open-memory-id]", async (node) => {
      await openMemoryFromAudit?.(node.getAttribute("data-open-memory-id"));
    });
    bindClickListeners(container, "[data-load-task-source-explanation]", async (node) => {
      await loadTaskSourceExplanation?.(
        node.getAttribute("data-load-task-source-explanation"),
        node.getAttribute("data-load-task-conversation-id"),
      );
    });
    bindClickListeners(container, "[data-generate-experience-type]", async (node) => {
      await getMemoryRuntimeFeature?.()?.generateExperienceCandidate?.(
        node.getAttribute("data-generate-experience-task-id"),
        node.getAttribute("data-generate-experience-type"),
      );
    });
    bindClickListeners(container, "[data-review-candidate-action]", async (node) => {
      await getMemoryRuntimeFeature?.()?.reviewExperienceCandidate?.(
        node.getAttribute("data-review-candidate-id"),
        node.getAttribute("data-review-candidate-action"),
        { taskId: node.getAttribute("data-review-candidate-task-id") },
      );
    });
    bindClickListeners(container, "[data-skill-freshness-stale-action]", async (node) => {
      await getMemoryRuntimeFeature?.()?.updateSkillFreshnessStaleMark?.({
        sourceCandidateId: node.getAttribute("data-skill-freshness-source-candidate-id"),
        skillKey: node.getAttribute("data-skill-freshness-skill-key"),
        taskId: node.getAttribute("data-skill-freshness-task-id"),
        candidateId: node.getAttribute("data-skill-freshness-candidate-id"),
        stale: node.getAttribute("data-skill-freshness-stale-action") !== "clear",
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
      retainedTaskAuditListenerCount: listenerDisposers.size,
    };
  }

  return {
    bindTaskAuditJumpLinks,
    dispose,
    getRuntimeSnapshot,
  };
}
