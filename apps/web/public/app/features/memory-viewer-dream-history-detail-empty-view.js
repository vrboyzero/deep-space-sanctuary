export function createMemoryViewerDreamHistoryDetailEmptyView() {
  return {
    render({ container, text = "" } = {}) {
      if (!container) return;
      const ownerDocument = container.ownerDocument ?? document;
      const emptyElement = ownerDocument.createElement("div");
      emptyElement.className = "memory-viewer-empty";
      emptyElement.textContent = typeof text === "string" ? text : "";
      container.replaceChildren(emptyElement);
    },
  };
}
