export function createHeaderNavigationFeature({
  refs,
  switchMode,
  loadGoals,
  focusPrompt,
  buildMultiPageUrl,
} = {}) {
  const {
    openWebChatTabLink,
    goGoalsPageBtn,
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
    openChatPage() {
      switchMode?.("chat");
      focusPrompt?.();
    },
  };
}
