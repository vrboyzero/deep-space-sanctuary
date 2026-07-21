function getMetaClassName(kind) {
  if (kind === "badge") return "memory-badge";
  if (kind === "shared") return "memory-badge memory-badge-shared";
  if (kind === "hybrid") return "memory-badge memory-badge-hybrid";
  if (kind === "private") return "memory-badge memory-badge-private";
  return "";
}

function createSharedReviewRow(ownerDocument, row) {
  const item = ownerDocument.createElement("div");
  item.className = "memory-list-item";
  item.classList.toggle("active", row?.isActive === true);
  item.setAttribute("data-shared-review-memory-id", typeof row?.id === "string" ? row.id : "");
  item.setAttribute("data-shared-review-target-agent-id", typeof row?.targetAgentId === "string" ? row.targetAgentId : "");

  const head = ownerDocument.createElement("div");
  head.className = "memory-list-item-head";
  const selector = ownerDocument.createElement("label");
  selector.className = "memory-list-selector";
  const checkbox = ownerDocument.createElement("input");
  checkbox.type = "checkbox";
  checkbox.setAttribute("data-shared-review-select", typeof row?.id === "string" ? row.id : "");
  checkbox.checked = row?.isSelected === true;
  selector.append(checkbox);
  const title = ownerDocument.createElement("div");
  title.className = "memory-list-item-title";
  title.textContent = typeof row?.title === "string" ? row.title : "";
  head.append(selector, title);

  const meta = ownerDocument.createElement("div");
  meta.className = "memory-list-item-meta";
  for (const value of Array.isArray(row?.meta) ? row.meta : []) {
    const metaItem = ownerDocument.createElement("span");
    metaItem.className = getMetaClassName(value?.kind);
    metaItem.textContent = typeof value?.text === "string" ? value.text : "";
    meta.append(metaItem);
  }

  const snippet = ownerDocument.createElement("div");
  snippet.className = "memory-list-item-snippet";
  snippet.textContent = typeof row?.snippet === "string" ? row.snippet : "";
  item.append(head, meta, snippet);
  return item;
}

function createPaginationFooter(ownerDocument, pagination) {
  const footer = ownerDocument.createElement("div");
  footer.className = "memory-list-pagination";

  const summary = ownerDocument.createElement("div");
  summary.className = "memory-list-pagination-summary";
  summary.textContent = typeof pagination?.summary === "string" ? pagination.summary : "";

  const actions = ownerDocument.createElement("div");
  actions.className = "memory-list-pagination-actions";
  const createButton = (action, label, disabled) => {
    const button = ownerDocument.createElement("button");
    button.className = "memory-usage-action-btn";
    button.setAttribute("data-memory-list-page-action", action);
    button.disabled = disabled === true;
    button.textContent = typeof label === "string" ? label : "";
    return button;
  };
  actions.append(
    createButton("prev", pagination?.previousLabel, pagination?.previousDisabled),
    createButton("next", pagination?.nextLabel, pagination?.nextDisabled),
  );
  footer.append(summary, actions);
  return footer;
}

export function createMemoryViewerSharedReviewListView() {
  return {
    render({ container, rows, pagination } = {}) {
      if (!container) return;
      const ownerDocument = container.ownerDocument ?? document;
      const children = (Array.isArray(rows) ? rows : [])
        .map((row) => createSharedReviewRow(ownerDocument, row));
      if (pagination) children.push(createPaginationFooter(ownerDocument, pagination));
      container.replaceChildren(...children);
    },
  };
}
