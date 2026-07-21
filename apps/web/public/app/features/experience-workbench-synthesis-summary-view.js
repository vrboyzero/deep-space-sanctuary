function createSummaryCard(ownerDocument, { label, value }) {
  const card = ownerDocument.createElement("div");
  card.className = "memory-detail-card";

  const labelEl = ownerDocument.createElement("span");
  labelEl.className = "memory-detail-label";
  labelEl.textContent = String(label ?? "");

  const valueEl = ownerDocument.createElement("div");
  valueEl.className = "memory-detail-text";
  valueEl.textContent = String(value ?? "");

  card.append(labelEl, valueEl);
  return card;
}

export function createExperienceWorkbenchSynthesisSummaryView({ refs }) {
  const { experienceSynthesisModalSummaryEl } = refs;

  return {
    render({ cards }) {
      if (!experienceSynthesisModalSummaryEl) return;
      const ownerDocument = experienceSynthesisModalSummaryEl.ownerDocument ?? document;
      const summaryCards = Array.isArray(cards) ? cards : [];
      experienceSynthesisModalSummaryEl.replaceChildren(
        ...summaryCards.map((card) => createSummaryCard(ownerDocument, card)),
      );
    },
  };
}
