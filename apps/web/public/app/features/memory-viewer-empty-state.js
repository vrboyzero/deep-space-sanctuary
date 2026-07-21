function renderEmptyState(panel, message) {
  if (!panel) return;
  const ownerDocument = panel.ownerDocument ?? document;
  const empty = ownerDocument.createElement("div");
  empty.className = "memory-viewer-empty";
  empty.textContent = String(message ?? "");
  panel.replaceChildren(empty);
}

export function createMemoryViewerEmptyStateFeature({ refs }) {
  const { memoryViewerListEl, memoryViewerDetailEl } = refs;
  return {
    renderListEmpty(message) {
      renderEmptyState(memoryViewerListEl, message);
    },
    renderDetailEmpty(message) {
      renderEmptyState(memoryViewerDetailEl, message);
    },
  };
}
