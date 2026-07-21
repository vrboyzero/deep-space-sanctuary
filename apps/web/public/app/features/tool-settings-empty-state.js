export function createToolSettingsEmptyStateView({ ownerDocument, t }) {
  return {
    render(target, messageKey, fallback) {
      if (!target) return;
      const emptyState = ownerDocument.createElement("div");
      emptyState.className = "tool-settings-empty";
      emptyState.textContent = t(messageKey, {}, fallback);
      if (typeof target.replaceChildren === "function") {
        target.replaceChildren(emptyState);
      } else {
        target.textContent = "";
        target.appendChild(emptyState);
      }
    },
  };
}
