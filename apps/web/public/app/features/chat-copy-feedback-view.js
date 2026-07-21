export function createChatCopyFeedbackView({ t }) {
  function capture(button) {
    return button ? Array.from(button.childNodes) : [];
  }

  function showCopied(button) {
    if (!button) return;
    button.textContent = t("chat.copied", {}, "Copied");
  }

  function restore(button, children) {
    if (!button) return;
    if (typeof button.replaceChildren === "function") {
      button.replaceChildren(...children);
      return;
    }
    button.textContent = "";
    button.append(...children);
  }

  return {
    capture,
    restore,
    showCopied,
  };
}
