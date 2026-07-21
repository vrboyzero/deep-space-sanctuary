import { setRuntimeStyles } from "./runtime-style-registry.js";

function createTextElement(ownerDocument, tagName, className, value) {
  const element = ownerDocument.createElement(tagName);
  if (className) element.className = className;
  element.textContent = String(value ?? "");
  return element;
}

function normalizeTone(value) {
  return value === "skill" ? "skill" : "method";
}

function normalizePercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(100, Math.max(0, numeric));
}

function createActionButton(ownerDocument, action) {
  const kind = typeof action?.kind === "string" ? action.kind : "";
  const value = String(action?.value ?? "");
  if (!value) return null;
  const attributeName = {
    candidate: "data-open-candidate-id",
    task: "data-open-task-id",
    source: "data-open-source",
  }[kind];
  if (!attributeName) return null;
  const button = createTextElement(ownerDocument, "button", "memory-usage-action-btn", action?.label);
  button.setAttribute(attributeName, value);
  return button;
}

function createUsageLane(ownerDocument, lane) {
  const tone = normalizeTone(lane?.tone);
  const items = Array.isArray(lane?.items) ? lane.items : [];
  const laneElement = ownerDocument.createElement("div");
  laneElement.className = "memory-usage-overview-lane";

  const head = ownerDocument.createElement("div");
  head.className = "memory-usage-overview-head";
  head.append(createTextElement(ownerDocument, "span", "memory-usage-overview-title", lane?.title));
  if (lane?.topLabel) head.append(createTextElement(ownerDocument, "span", "memory-stat-caption", lane.topLabel));
  laneElement.append(head);

  if (!items.length) {
    laneElement.append(createTextElement(ownerDocument, "div", "memory-usage-overview-empty", lane?.emptyLabel));
    return laneElement;
  }

  const list = ownerDocument.createElement("div");
  list.className = "memory-usage-overview-list";
  for (const item of items) {
    const row = ownerDocument.createElement("div");
    row.className = "memory-usage-overview-row";

    const main = ownerDocument.createElement("div");
    main.className = "memory-usage-overview-row-main";
    main.append(createTextElement(ownerDocument, "div", "memory-usage-overview-key", item?.assetKey));

    const meta = ownerDocument.createElement("div");
    meta.className = "memory-usage-overview-meta";
    const metaItems = Array.isArray(item?.meta) ? item.meta : [];
    meta.append(...metaItems.map((value) => createTextElement(ownerDocument, "span", "", value)));
    main.append(meta);

    const badges = ownerDocument.createElement("div");
    badges.className = "memory-detail-badges";
    const badgeItems = Array.isArray(item?.badges) ? item.badges : [];
    badges.append(...badgeItems.map((badge) => createTextElement(
      ownerDocument,
      "span",
      badge?.className || "memory-badge",
      badge?.label,
    )));
    const actionItems = Array.isArray(item?.actions) ? item.actions : [];
    badges.append(...actionItems.map((action) => createActionButton(ownerDocument, action)).filter(Boolean));
    main.append(badges);

    const track = ownerDocument.createElement("div");
    track.className = "memory-usage-overview-bar-track";
    const fill = ownerDocument.createElement("div");
    fill.className = `memory-usage-overview-bar-fill memory-usage-overview-bar-${tone}`;
    setRuntimeStyles(fill, { width: `${normalizePercent(item?.barPercent)}%` });
    track.append(fill);

    row.append(
      main,
      track,
      createTextElement(ownerDocument, "div", "memory-usage-overview-metrics", item?.metrics),
    );
    list.append(row);
  }
  laneElement.append(list);
  return laneElement;
}

export function createExperienceWorkbenchUsageOverviewView() {
  return {
    render({ container, title, caption, showLanes, lanes } = {}) {
      if (!container) return;
      const ownerDocument = container.ownerDocument ?? document;
      const card = ownerDocument.createElement("div");
      card.className = "memory-stat-card memory-stat-card-wide memory-usage-overview-card";

      const head = ownerDocument.createElement("div");
      head.className = "memory-stat-card-head";
      head.append(
        createTextElement(ownerDocument, "span", "memory-stat-label", title),
        createTextElement(ownerDocument, "span", "memory-stat-caption", caption),
      );
      card.append(head);

      if (showLanes) {
        const grid = ownerDocument.createElement("div");
        grid.className = "memory-usage-overview-grid";
        const safeLanes = Array.isArray(lanes) ? lanes : [];
        grid.append(...safeLanes.map((lane) => createUsageLane(ownerDocument, lane)));
        card.append(grid);
      }
      container.replaceChildren(card);
    },
  };
}
