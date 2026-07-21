function createStatCard(ownerDocument, card) {
  const cardElement = ownerDocument.createElement("div");
  cardElement.className = "memory-stat-card";

  const labelElement = ownerDocument.createElement("span");
  labelElement.className = "memory-stat-label";
  labelElement.textContent = typeof card?.label === "string" ? card.label : "";

  const valueElement = ownerDocument.createElement("strong");
  valueElement.className = card?.compact === true
    ? "memory-stat-value memory-stat-value-compact"
    : "memory-stat-value";
  valueElement.textContent = typeof card?.value === "string" ? card.value : "";
  cardElement.append(labelElement, valueElement);

  if (typeof card?.caption === "string" && card.caption) {
    const captionElement = ownerDocument.createElement("div");
    captionElement.className = "memory-stat-caption";
    captionElement.textContent = card.caption;
    cardElement.append(captionElement);
  }

  return cardElement;
}

export function createMemoryViewerTaskStatsView() {
  return {
    render({ container, cards } = {}) {
      if (!container) return;
      const ownerDocument = container.ownerDocument ?? document;
      const statCards = Array.isArray(cards) ? cards : [];
      container.replaceChildren(...statCards.map((card) => createStatCard(ownerDocument, card)));
    },
  };
}
