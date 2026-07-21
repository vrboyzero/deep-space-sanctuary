function renderEmptyState(panel, message) {
  if (!panel) return;
  const ownerDocument = panel.ownerDocument ?? document;
  const empty = ownerDocument.createElement("div");
  empty.className = "memory-viewer-empty";
  empty.textContent = String(message ?? "");
  panel.replaceChildren(empty);
}

export function createExperienceWorkbenchEmptyStateFeature({ refs }) {
  const {
    experienceWorkbenchListEl,
    experienceWorkbenchDetailEl,
    experienceWorkbenchUsageOverviewEl,
    experienceWorkbenchCapabilityOverviewEl,
    experienceSynthesisModalListEl,
  } = refs;
  return {
    renderListEmpty(message) {
      renderEmptyState(experienceWorkbenchListEl, message);
    },
    renderDetailEmpty(message) {
      renderEmptyState(experienceWorkbenchDetailEl, message);
    },
    renderUsageOverviewEmpty(message) {
      renderEmptyState(experienceWorkbenchUsageOverviewEl, message);
    },
    renderCapabilityOverviewEmpty(message) {
      renderEmptyState(experienceWorkbenchCapabilityOverviewEl, message);
    },
    renderSynthesisListEmpty(message) {
      renderEmptyState(experienceSynthesisModalListEl, message);
    },
  };
}
