const META_KIND_CLASS_NAMES = Object.freeze({
  badge: "memory-badge",
  private: "memory-badge memory-badge-private",
  shared: "memory-badge memory-badge-shared",
  hybrid: "memory-badge memory-badge-hybrid",
});

function createDiagnostics(ownerDocument, diagnostics) {
  const card = ownerDocument.createElement("div");
  card.className = "memory-detail-card";

  const title = ownerDocument.createElement("div");
  title.className = "memory-detail-title";
  title.textContent = typeof diagnostics?.title === "string" ? diagnostics.title : "";

  const badges = ownerDocument.createElement("div");
  badges.className = "memory-detail-badges";
  for (const value of Array.isArray(diagnostics?.badges) ? diagnostics.badges : []) {
    const badge = ownerDocument.createElement("span");
    badge.className = "memory-badge";
    badge.textContent = typeof value === "string" ? value : "";
    badges.append(badge);
  }

  const lines = (Array.isArray(diagnostics?.lines) ? diagnostics.lines : []).map((value) => {
    const line = ownerDocument.createElement("div");
    line.className = "memory-detail-text";
    line.textContent = typeof value === "string" ? value : "";
    return line;
  });
  card.append(title, badges, ...lines);
  return card;
}

function createMemoryRow(ownerDocument, row) {
  const item = ownerDocument.createElement("div");
  item.className = "memory-list-item";
  item.classList.toggle("active", row?.isActive === true);
  item.setAttribute("data-memory-id", typeof row?.id === "string" ? row.id : "");

  const title = ownerDocument.createElement("div");
  title.className = "memory-list-item-title";
  title.textContent = typeof row?.title === "string" ? row.title : "";

  const meta = ownerDocument.createElement("div");
  meta.className = "memory-list-item-meta";
  for (const entry of Array.isArray(row?.meta) ? row.meta : []) {
    const metaItem = ownerDocument.createElement("span");
    const className = Object.hasOwn(META_KIND_CLASS_NAMES, entry?.kind)
      ? META_KIND_CLASS_NAMES[entry.kind]
      : "";
    if (className) metaItem.className = className;
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

export function createMemoryViewerMemoryListView() {
  return {
    render({ container, diagnostics, rows, pagination } = {}) {
      if (!container) return;
      const ownerDocument = container.ownerDocument ?? document;
      const children = [];
      if (diagnostics) children.push(createDiagnostics(ownerDocument, diagnostics));
      children.push(...(Array.isArray(rows) ? rows : []).map((row) => createMemoryRow(ownerDocument, row)));
      if (pagination) children.push(createPaginationFooter(ownerDocument, pagination));
      container.replaceChildren(...children);
    },
  };
}
