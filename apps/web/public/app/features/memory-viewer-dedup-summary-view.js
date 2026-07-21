function createSummaryCard(ownerDocument, card) {
  const cardElement = ownerDocument.createElement("div");
  cardElement.className = "memory-detail-card";

  const labelElement = ownerDocument.createElement("span");
  labelElement.className = "memory-detail-label";
  labelElement.textContent = String(card?.label ?? "");

  const valueElement = ownerDocument.createElement("div");
  valueElement.className = "memory-detail-text";
  valueElement.textContent = String(card?.value ?? "");

  cardElement.append(labelElement, valueElement);
  return cardElement;
}

export function createMemoryViewerDedupSummaryView() {
  return {
    render({ container, cards } = {}) {
      if (!container) return;
      const ownerDocument = container.ownerDocument ?? document;
      const summaryCards = Array.isArray(cards) ? cards : [];
      container.replaceChildren(...summaryCards.map((card) => createSummaryCard(ownerDocument, card)));
    },
  };
}
