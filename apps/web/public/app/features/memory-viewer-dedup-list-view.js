function createDedupRow(ownerDocument, row) {
  const rowElement = ownerDocument.createElement("div");
  rowElement.className = "experience-synthesis-row";

  const mainElement = ownerDocument.createElement("div");
  mainElement.className = "experience-synthesis-row-main";

  const titleElement = ownerDocument.createElement("div");
  titleElement.className = "experience-synthesis-row-title";
  titleElement.textContent = typeof row?.title === "string" ? row.title : "";

  const metaElement = ownerDocument.createElement("div");
  metaElement.className = "experience-synthesis-row-meta";
  const metaItems = Array.isArray(row?.meta) ? row.meta : [];
  metaElement.replaceChildren(...metaItems.map((item) => {
    const itemElement = ownerDocument.createElement("span");
    itemElement.textContent = typeof item === "string" ? item : "";
    return itemElement;
  }));

  const snippetElement = ownerDocument.createElement("div");
  snippetElement.className = "memory-list-item-snippet";
  snippetElement.textContent = typeof row?.snippet === "string" ? row.snippet : "";

  mainElement.append(titleElement, metaElement, snippetElement);
  rowElement.append(mainElement);
  return rowElement;
}

export function createMemoryViewerDedupListView() {
  return {
    render({ container, rows, emptyText = "" } = {}) {
      if (!container) return;
      const ownerDocument = container.ownerDocument ?? document;
      const normalizedRows = Array.isArray(rows) ? rows : [];
      if (normalizedRows.length > 0) {
        container.replaceChildren(...normalizedRows.map((row) => createDedupRow(ownerDocument, row)));
        return;
      }

      const emptyElement = ownerDocument.createElement("div");
      emptyElement.className = "memory-viewer-empty";
      emptyElement.textContent = typeof emptyText === "string" ? emptyText : "";
      container.replaceChildren(emptyElement);
    },
  };
}
