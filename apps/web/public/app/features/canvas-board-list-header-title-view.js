export function createCanvasBoardListHeaderTitleView({ ownerDocument }) {
  return {
    render(header, title) {
      if (!header) return;

      const element = ownerDocument.createElement("span");
      element.className = "canvas-board-list-title";
      element.textContent = String(title ?? "");
      header.replaceChildren(element);
    },
  };
}
