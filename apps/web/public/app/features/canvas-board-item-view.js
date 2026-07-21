function createTextNode(ownerDocument, className, text) {
  const element = ownerDocument.createElement("div");
  element.className = className;
  element.textContent = text;
  return element;
}

export function createCanvasBoardItemView({ ownerDocument }) {
  return {
    render(item, board) {
      if (!item) return;

      const name = String(board?.name ?? "").replace(".json", "");
      const id = String(board?.id ?? "");
      item.replaceChildren(
        createTextNode(ownerDocument, "canvas-board-item-name", name),
        createTextNode(ownerDocument, "canvas-board-item-meta", `ID: ${id}`),
      );
    },
  };
}
