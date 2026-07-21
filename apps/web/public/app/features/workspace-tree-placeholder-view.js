export function createWorkspaceTreePlaceholderView({
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  return {
    render(target, key, fallback, { compact = false, muted = false } = {}) {
      if (!target) return;
      const ownerDocument = target.ownerDocument ?? document;
      const placeholder = ownerDocument.createElement("div");
      placeholder.className = "tree-loading";
      placeholder.textContent = String(t(key, {}, fallback) ?? "");
      if (compact) {
        placeholder.style.padding = "4px 8px";
        placeholder.style.fontSize = "12px";
      }
      if (muted) {
        placeholder.style.color = "var(--text-muted)";
      }
      target.replaceChildren(placeholder);
    },
  };
}
