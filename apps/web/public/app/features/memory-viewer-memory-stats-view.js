import { setRuntimeStyles } from "./runtime-style-registry.js";

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

function getCategoryToneClass(key) {
  switch (key) {
    case "preference":
      return "memory-category-bar-preference";
    case "experience":
      return "memory-category-bar-experience";
    case "fact":
      return "memory-category-bar-fact";
    case "decision":
      return "memory-category-bar-decision";
    case "entity":
      return "memory-category-bar-entity";
    case "other":
      return "memory-category-bar-other";
    default:
      return "memory-category-bar-uncategorized";
  }
}

function createCategoryDistribution(ownerDocument, distribution) {
  const cardElement = ownerDocument.createElement("div");
  cardElement.className = "memory-stat-card memory-stat-card-wide";

  const headElement = ownerDocument.createElement("div");
  headElement.className = "memory-stat-card-head";
  const labelElement = ownerDocument.createElement("span");
  labelElement.className = "memory-stat-label";
  labelElement.textContent = typeof distribution?.label === "string" ? distribution.label : "";
  const captionElement = ownerDocument.createElement("span");
  captionElement.className = "memory-stat-caption";
  captionElement.textContent = typeof distribution?.caption === "string" ? distribution.caption : "";
  headElement.append(labelElement, captionElement);
  cardElement.append(headElement);

  const rows = Array.isArray(distribution?.rows) ? distribution.rows : [];
  if (!rows.length) return cardElement;

  const chartElement = ownerDocument.createElement("div");
  chartElement.className = "memory-category-chart";
  for (const row of rows) {
    const rowElement = ownerDocument.createElement("div");
    rowElement.className = row?.active === true ? "memory-category-row active" : "memory-category-row";

    const nameElement = ownerDocument.createElement("div");
    nameElement.className = "memory-category-name";
    nameElement.textContent = typeof row?.label === "string" ? row.label : "";

    const trackElement = ownerDocument.createElement("div");
    trackElement.className = "memory-category-bar-track";
    const fillElement = ownerDocument.createElement("div");
    fillElement.className = `memory-category-bar-fill ${getCategoryToneClass(row?.key)}`;
    const widthPercent = Number(row?.widthPercent);
    setRuntimeStyles(fillElement, {
      width: `${Number.isFinite(widthPercent) ? Math.min(100, Math.max(0, widthPercent)) : 0}%`,
    });
    trackElement.append(fillElement);

    const metricsElement = ownerDocument.createElement("div");
    metricsElement.className = "memory-category-metrics";
    const countElement = ownerDocument.createElement("span");
    countElement.className = "memory-category-count";
    countElement.textContent = typeof row?.count === "string" ? row.count : "";
    const percentElement = ownerDocument.createElement("span");
    percentElement.className = "memory-category-percent";
    percentElement.textContent = typeof row?.percent === "string" ? row.percent : "";
    metricsElement.append(countElement, percentElement);

    rowElement.append(nameElement, trackElement, metricsElement);
    chartElement.append(rowElement);
  }
  cardElement.append(chartElement);
  return cardElement;
}

export function createMemoryViewerMemoryStatsView() {
  return {
    render({ container, cards, distribution } = {}) {
      if (!container) return;
      const ownerDocument = container.ownerDocument ?? document;
      const children = (Array.isArray(cards) ? cards : [])
        .map((card) => createStatCard(ownerDocument, card));
      if (distribution) children.push(createCategoryDistribution(ownerDocument, distribution));
      container.replaceChildren(...children);
    },
  };
}
