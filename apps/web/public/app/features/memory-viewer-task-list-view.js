function createTaskRow(ownerDocument, row) {
  const item = ownerDocument.createElement("div");
  item.className = "memory-list-item";
  item.classList.toggle("active", row?.isActive === true);
  item.setAttribute("data-task-id", typeof row?.id === "string" ? row.id : "");

  const title = ownerDocument.createElement("div");
  title.className = "memory-list-item-title";
  title.textContent = typeof row?.title === "string" ? row.title : "";

  const meta = ownerDocument.createElement("div");
  meta.className = "memory-list-item-meta";
  const metaItems = Array.isArray(row?.meta) ? row.meta : [];
  for (const entry of metaItems) {
    const metaItem = ownerDocument.createElement("span");
    if (entry?.kind === "shared") {
      metaItem.className = "memory-badge memory-badge-shared";
    }
    metaItem.textContent = typeof entry?.text === "string" ? entry.text : "";
    meta.append(metaItem);
  }

  const snippet = ownerDocument.createElement("div");
  snippet.className = "memory-list-item-snippet";
  snippet.textContent = typeof row?.snippet === "string" ? row.snippet : "";
  item.append(title, meta, snippet);
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

export function createMemoryViewerTaskListView() {
  return {
    render({ container, rows, pagination } = {}) {
      if (!container) return;
      const ownerDocument = container.ownerDocument ?? document;
      const taskRows = Array.isArray(rows) ? rows : [];
      const children = taskRows.map((row) => createTaskRow(ownerDocument, row));
      if (pagination) {
        children.push(createPaginationFooter(ownerDocument, pagination));
      }
      container.replaceChildren(...children);
    },
  };
}
