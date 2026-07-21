export function createCanvasResourcePickerItemView({ ownerDocument }) {
  return {
    render(row, item) {
      if (!row) return;

      const name = ownerDocument.createElement("div");
      name.className = "canvas-picker-item-name";
      name.textContent = String(item?.name ?? "");

      const children = [name];
      if (item?.desc) {
        const description = ownerDocument.createElement("div");
        description.className = "canvas-picker-item-desc";
        description.textContent = String(item.desc);
        children.push(description);
      }
      row.replaceChildren(...children);
    },
  };
}
