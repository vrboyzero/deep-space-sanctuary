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
        placeholder.classList.add("tree-loading--compact");
      }
      if (muted) {
        placeholder.classList.add("tree-loading--muted");
      }
      target.replaceChildren(placeholder);
    },
  };
}
