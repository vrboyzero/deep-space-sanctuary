export function createCanvasResourcePickerEmptyView({ ownerDocument }) {
  return {
    render(body, message) {
      if (!body) return;

      const empty = ownerDocument.createElement("div");
      empty.className = "canvas-picker-empty";
      empty.textContent = String(message ?? "");
      body.replaceChildren(empty);
    },
  };
}
