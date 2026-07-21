function createDreamHistoryEntry(ownerDocument, entry) {
  const item = ownerDocument.createElement("div");
  item.className = "memory-list-item";
  item.classList.toggle("active", entry?.isActive === true);
  item.setAttribute("data-dream-history-id", typeof entry?.id === "string" ? entry.id : "");

  const title = ownerDocument.createElement("div");
  title.className = "memory-list-item-title";
  title.textContent = typeof entry?.title === "string" ? entry.title : "";

  const meta = ownerDocument.createElement("div");
  meta.className = "memory-list-item-meta";
  const metaItems = Array.isArray(entry?.meta) ? entry.meta : [];
  for (const value of metaItems) {
    const metaItem = ownerDocument.createElement("span");
    metaItem.textContent = typeof value === "string" ? value : "";
    meta.append(metaItem);
  }

  const snippet = ownerDocument.createElement("div");
  snippet.className = "memory-list-item-snippet";
  snippet.textContent = typeof entry?.snippet === "string" ? entry.snippet : "";
  item.append(title, meta, snippet);
  return item;
}

export function createMemoryViewerDreamHistoryListView() {
  return {
    render({ container, entries, emptyText } = {}) {
      if (!container) return;
      const ownerDocument = container.ownerDocument ?? document;
      const historyEntries = Array.isArray(entries) ? entries : [];
      if (historyEntries.length <= 0) {
        const empty = ownerDocument.createElement("div");
        empty.className = "memory-viewer-empty";
        empty.textContent = typeof emptyText === "string" ? emptyText : "";
        container.replaceChildren(empty);
        return;
      }
      container.replaceChildren(...historyEntries.map((entry) => createDreamHistoryEntry(ownerDocument, entry)));
    },
  };
}
