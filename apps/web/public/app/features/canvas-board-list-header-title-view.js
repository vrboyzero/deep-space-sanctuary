const CANVAS_BOARD_LIST_TITLE_STYLE = "font-size:16px;font-weight:600;color:var(--text-main);";

export function createCanvasBoardListHeaderTitleView({ ownerDocument }) {
  return {
    render(header, title) {
      if (!header) return;

      const element = ownerDocument.createElement("span");
      element.className = "canvas-board-list-title";
      element.setAttribute("style", CANVAS_BOARD_LIST_TITLE_STYLE);
      element.textContent = String(title ?? "");
      header.replaceChildren(element);
    },
  };
}
