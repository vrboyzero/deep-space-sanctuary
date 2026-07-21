export function createCanvasResourcePickerDialogView({ ownerDocument }) {
  return {
    render(dialog, { title, manualLabel }) {
      if (!dialog) {
        return { body: null, closeButton: null, manualButton: null };
      }

      const header = ownerDocument.createElement("div");
      header.className = "canvas-picker-header";
      const titleElement = ownerDocument.createElement("span");
      titleElement.textContent = String(title ?? "");
      const closeButton = ownerDocument.createElement("button");
      closeButton.className = "canvas-picker-close";
      closeButton.textContent = "\u00D7";
      header.append(titleElement, closeButton);

      const body = ownerDocument.createElement("div");
      body.className = "canvas-picker-body";

      const footer = ownerDocument.createElement("div");
      footer.className = "canvas-picker-footer";
      const manualButton = ownerDocument.createElement("button");
      manualButton.className = "canvas-picker-manual";
      manualButton.textContent = String(manualLabel ?? "");
      footer.appendChild(manualButton);

      dialog.replaceChildren(header, body, footer);
      return { body, closeButton, manualButton };
    },
  };
}
