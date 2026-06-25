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

  function refreshMultiPageLink() {
    if (!openWebChatTabLink) return;
    const nextHref = typeof buildMultiPageUrl === "function"
      ? buildMultiPageUrl()
      : (globalThis.location?.href || "/");
    openWebChatTabLink.href = nextHref;
    openWebChatTabLink.target = "_blank";
    openWebChatTabLink.rel = "noopener noreferrer";
  }

  refreshMultiPageLink();

  goGoalsPageBtn?.addEventListener("click", async () => {
    switchMode?.("goals");
    await loadGoals?.(false);
  });

  goBridgePageBtn?.addEventListener("click", async () => {
    switchMode?.("bridge");
    await loadBridgeSessions?.(false);
  });

  goChatPageBtn?.addEventListener("click", () => {
    switchMode?.("chat");
    focusPrompt?.();
  });

  openWebChatTabLink?.addEventListener("click", () => {
    refreshMultiPageLink();
  });

  return {
    refreshMultiPageLink,
    openGoalsPage() {
      switchMode?.("goals");
      return loadGoals?.(false);
    },
    openBridgePage() {
      switchMode?.("bridge");
      return loadBridgeSessions?.(false);
    },
    openChatPage() {
      switchMode?.("chat");
      focusPrompt?.();
    },
  };
}
