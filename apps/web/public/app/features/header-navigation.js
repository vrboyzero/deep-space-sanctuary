import { createPanelTaskScope } from "./panel-task-scope.js";

export function createHeaderNavigationFeature({
  refs,
  switchMode,
  loadGoals,
  loadBridgeSessions,
  focusPrompt,
  buildMultiPageUrl,
} = {}) {
  const {
    openWebChatTabLink,
    goGoalsPageBtn,
    goBridgePageBtn,
    goChatPageBtn,
  } = refs ?? {};
  const taskScope = createPanelTaskScope();

  function addOwnedListener(target, type, handler) {
    if (!target) return;
    taskScope.addEventListener(target, type, handler);
  }

  function refreshMultiPageLink() {
    if (!taskScope.isActive() || !openWebChatTabLink) return;
    const nextHref = typeof buildMultiPageUrl === "function"
      ? buildMultiPageUrl()
      : (globalThis.location?.href || "/");
    openWebChatTabLink.href = nextHref;
    openWebChatTabLink.target = "_blank";
    openWebChatTabLink.rel = "noopener noreferrer";
  }

  function openGoalsPage() {
    if (!taskScope.isActive()) return undefined;
    switchMode?.("goals");
    return loadGoals?.(false);
  }

  function openBridgePage() {
    if (!taskScope.isActive()) return undefined;
    switchMode?.("bridge");
    return loadBridgeSessions?.(false);
  }

  function openChatPage() {
    if (!taskScope.isActive()) return;
    switchMode?.("chat");
    focusPrompt?.();
  }

  async function handleGoalsClick() {
    await openGoalsPage();
  }

  async function handleBridgeClick() {
    await openBridgePage();
  }

  function handleChatClick() {
    openChatPage();
  }

  function handleMultiPageLinkClick() {
    refreshMultiPageLink();
  }

  function activate() {
    if (!taskScope.activate()) return false;
    refreshMultiPageLink();
    addOwnedListener(goGoalsPageBtn, "click", handleGoalsClick);
    addOwnedListener(goBridgePageBtn, "click", handleBridgeClick);
    addOwnedListener(goChatPageBtn, "click", handleChatClick);
    addOwnedListener(openWebChatTabLink, "click", handleMultiPageLinkClick);
    return true;
  }

  function deactivate() {
    return taskScope.deactivate();
  }

  function dispose() {
    return taskScope.dispose();
  }

  function getRuntimeSnapshot() {
    const snapshot = taskScope.getRuntimeSnapshot();
    return {
      listenerCount: snapshot.listenerCount,
      disposed: snapshot.disposed,
    };
  }

  activate();

  return {
    activate,
    deactivate,
    dispose,
    getRuntimeSnapshot,
    refreshMultiPageLink,
    openGoalsPage,
    openBridgePage,
    openChatPage,
  };
}
