import { createPanelTaskScope } from "./panel-task-scope.js";

export function createMemoryDetailStatsListenerLifecycle({
  openTaskFromAudit,
  openSourcePath,
  loadCandidateDetail,
  switchMode,
  loadGoals,
} = {}) {
  const taskScope = createPanelTaskScope();
  let bindingScope = null;

  function clearListeners() {
    bindingScope?.dispose();
    bindingScope = null;
  }

  function bindClickListeners(container, selector, currentBindingScope, handler) {
    container.querySelectorAll(selector).forEach((node) => {
      const listener = async () => {
        if (!taskScope.isActive()
          || bindingScope !== currentBindingScope
          || !currentBindingScope.isActive()) return;
        await handler(node);
      };
      currentBindingScope.addEventListener(node, "click", listener);
    });
  }

  function bindStatsAuditJumpLinks(container) {
    clearListeners();
    if (!taskScope.isActive() || !container?.querySelectorAll) return false;

    // Stats DOM 会整块重绘；独立 binding scope 可同时阻断旧节点与已捕获 callback。
    const currentBindingScope = createPanelTaskScope();
    currentBindingScope.activate();
    bindingScope = currentBindingScope;
    try {
      bindClickListeners(container, "[data-open-task-id]", currentBindingScope, async (node) => {
        await openTaskFromAudit?.(node.getAttribute("data-open-task-id"));
      });
      bindClickListeners(container, "[data-open-source]", currentBindingScope, async (node) => {
        await openSourcePath?.(node.getAttribute("data-open-source"));
      });
      bindClickListeners(container, "[data-open-candidate-id]", currentBindingScope, async (node) => {
        await loadCandidateDetail?.(node.getAttribute("data-open-candidate-id"));
      });
      bindClickListeners(container, "[data-open-goal-id]", currentBindingScope, async (node) => {
        const goalId = node.getAttribute("data-open-goal-id");
        if (!goalId) return;
        switchMode?.("goals");
        await loadGoals?.(true, goalId);
      });
    } catch (error) {
      if (bindingScope === currentBindingScope) clearListeners();
      throw error;
    }
    if (currentBindingScope.getRuntimeSnapshot().listenerCount === 0) clearListeners();
    return true;
  }

  function activate() {
    if (!taskScope.activate()) return false;
    clearListeners();
    return true;
  }

  function deactivate() {
    if (!taskScope.deactivate()) return false;
    clearListeners();
    return true;
  }

  function dispose() {
    if (!taskScope.dispose()) return false;
    clearListeners();
    return true;
  }

  function getRuntimeSnapshot() {
    const snapshot = taskScope.getRuntimeSnapshot();
    return {
      disposed: snapshot.disposed,
      retainedStatsAuditListenerCount: bindingScope?.getRuntimeSnapshot().listenerCount ?? 0,
    };
  }

  activate();

  return {
    activate,
    bindStatsAuditJumpLinks,
    deactivate,
    dispose,
    getRuntimeSnapshot,
  };
}
