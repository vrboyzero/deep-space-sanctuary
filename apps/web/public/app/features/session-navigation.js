export function createSessionNavigationFeature({
  refs,
  setActiveConversationId,
  getActiveConversationId,
  renderCanvasGoalContext,
  switchMode,
  getChatEventsFeature,
  loadConversationMeta,
  getSessionDigestFeature,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const { messagesEl } = refs;
  const SESSION_OPEN_NOTE_SELECTOR = "[data-session-open-note]";

  function renderSessionOpenNote(text) {
    if (!(messagesEl instanceof Element)) return null;
    messagesEl.querySelectorAll(SESSION_OPEN_NOTE_SELECTOR).forEach((node) => node.remove());
    const normalizedText = typeof text === "string" ? text.trim() : "";
    if (!normalizedText) return null;
    const note = document.createElement("div");
    note.className = "system-msg";
    note.setAttribute("data-session-open-note", "true");
    note.textContent = normalizedText;
    const emailBanner = messagesEl.querySelector("[data-email-inbound-session-banner]");
    if (emailBanner instanceof Element) {
      emailBanner.insertAdjacentElement("afterend", note);
    } else {
      messagesEl.insertBefore(note, messagesEl.firstChild);
    }
    return note;
  }

  function openConversationSession(conversationId, hintText, options = {}) {
    if (!conversationId) return;
    const switchToChat = options.switchToChat !== false;
    const renderHint = options.renderHint !== false;
    const systemNoticeText = typeof options.systemNoticeText === "string"
      ? options.systemNoticeText.trim()
      : "";
    setActiveConversationId(conversationId);
    renderCanvasGoalContext?.();
    if (switchToChat) {
      switchMode("chat");
    }
    getChatEventsFeature?.()?.resetStreamingState();
    if (messagesEl && renderHint) {
      messagesEl.textContent = "";
      const hint = document.createElement("div");
      hint.className = "system-msg";
      hint.textContent = hintText || t(
        "canvas.switchedConversationHint",
        { conversationId },
        `Switched to conversation: ${conversationId}`,
      );
      messagesEl.appendChild(hint);
    }
    void Promise.resolve(loadConversationMeta(conversationId, { showGoalEntryBanner: true }))
      .finally(() => {
        if (!systemNoticeText) return;
        if (typeof getActiveConversationId === "function" && getActiveConversationId() !== conversationId) {
          return;
        }
        renderSessionOpenNote(systemNoticeText);
      });
    void getSessionDigestFeature?.()?.loadSessionDigest(conversationId);
  }

  return {
    openConversationSession,
  };
}
