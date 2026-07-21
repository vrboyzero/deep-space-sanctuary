function renderEmptyState(panel, message) {
  if (!panel) return;
  const ownerDocument = panel.ownerDocument ?? document;
  const empty = ownerDocument.createElement("div");
  empty.className = "memory-viewer-empty";
  empty.textContent = String(message ?? "");
  panel.replaceChildren(empty);
}

export function createGoalsOverviewEmptyStateFeature({ refs }) {
  const { goalsListEl, goalsDetailEl } = refs;
  return {
    renderListEmpty(message) {
      renderEmptyState(goalsListEl, message);
    },
    renderDetailEmpty(message) {
      renderEmptyState(goalsDetailEl, message);
    },
  };
}
