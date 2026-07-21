function createFallbackCard(ownerDocument, label) {
  const card = ownerDocument.createElement("div");
  card.className = "memory-stat-card";

  const labelElement = ownerDocument.createElement("span");
  labelElement.className = "memory-stat-label";
  labelElement.textContent = typeof label === "string" ? label : "";

  const valueElement = ownerDocument.createElement("strong");
  valueElement.className = "memory-stat-value";
  valueElement.textContent = "--";

  card.append(labelElement, valueElement);
  return card;
}

export function createMemoryViewerStatsFallbackView() {
  return {
    render({ container, labels } = {}) {
      if (!container) return;
      const ownerDocument = container.ownerDocument ?? document;
      const fallbackLabels = Array.isArray(labels) ? labels : [];
      container.replaceChildren(...fallbackLabels.map((label) => createFallbackCard(ownerDocument, label)));
    },
  };
}
