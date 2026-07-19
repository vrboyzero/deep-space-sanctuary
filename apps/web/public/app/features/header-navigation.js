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
  let disposed = false;
  const listenerEntries = [];

  function addOwnedListener(target, type, handler) {
    if (!target) return;
    target.addEventListener(type, handler);
    listenerEntries.push({ target, type, handler });
  }

  function refreshMultiPageLink() {
    if (disposed || !openWebChatTabLink) return;
    const nextHref = typeof buildMultiPageUrl === "function"
      ? buildMultiPageUrl()
      : (globalThis.location?.href || "/");
    openWebChatTabLink.href = nextHref;
    openWebChatTabLink.target = "_blank";
    openWebChatTabLink.rel = "noopener noreferrer";
  }

  function openGoalsPage() {
    if (disposed) return undefined;
    switchMode?.("goals");
    return loadGoals?.(false);
  }

  function openBridgePage() {
    if (disposed) return undefined;
    switchMode?.("bridge");
    return loadBridgeSessions?.(false);
  }

  function openChatPage() {
    if (disposed) return;
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

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const { target, type, handler } of listenerEntries) {
      target.removeEventListener(type, handler);
    }
    listenerEntries.length = 0;
  }

  function getRuntimeSnapshot() {
    return {
      listenerCount: listenerEntries.length,
      disposed,
    };
  }

  refreshMultiPageLink();
  addOwnedListener(goGoalsPageBtn, "click", handleGoalsClick);
  addOwnedListener(goBridgePageBtn, "click", handleBridgeClick);
  addOwnedListener(goChatPageBtn, "click", handleChatClick);
  addOwnedListener(openWebChatTabLink, "click", handleMultiPageLinkClick);

  return {
    dispose,
    getRuntimeSnapshot,
    refreshMultiPageLink,
    openGoalsPage,
    openBridgePage,
    openChatPage,
  };
}
