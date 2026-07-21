function createStatCard(ownerDocument, card) {
  const cardElement = ownerDocument.createElement("div");
  cardElement.className = "memory-stat-card";

  const labelElement = ownerDocument.createElement("span");
  labelElement.className = "memory-stat-label";
  labelElement.textContent = typeof card?.label === "string" ? card.label : "";

  const valueElement = ownerDocument.createElement("strong");
  valueElement.className = "memory-stat-value";
  valueElement.textContent = typeof card?.value === "string" ? card.value : "";

  cardElement.append(labelElement, valueElement);
  return cardElement;
}

export function createMemoryViewerOutboundAuditStatsView() {
  return {
    render({ container, cards } = {}) {
      if (!container) return;
      const ownerDocument = container.ownerDocument ?? document;
      const statCards = Array.isArray(cards) ? cards : [];
      container.replaceChildren(...statCards.map((card) => createStatCard(ownerDocument, card)));
    },
  };
}
