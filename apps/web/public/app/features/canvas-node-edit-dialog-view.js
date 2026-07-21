export function createCanvasNodeEditDialogView({ ownerDocument }) {
  return {
    render(dialog, {
      dialogTitle,
      titleLabel,
      contentLabel,
      saveLabel,
      title,
      content,
    }) {
      if (!dialog) {
        return {
          closeButton: null,
          saveButton: null,
          titleInput: null,
          contentInput: null,
        };
      }

      const header = ownerDocument.createElement("div");
      header.className = "canvas-picker-header";
      const dialogTitleElement = ownerDocument.createElement("span");
      dialogTitleElement.textContent = String(dialogTitle ?? "");
      const closeButton = ownerDocument.createElement("button");
      closeButton.className = "canvas-picker-close";
      closeButton.textContent = "\u00D7";
      header.append(dialogTitleElement, closeButton);

      const body = ownerDocument.createElement("div");
      body.className = "canvas-picker-body canvas-picker-body--edit";

      const titleLabelElement = ownerDocument.createElement("label");
      titleLabelElement.className = "canvas-edit-label";
      titleLabelElement.textContent = String(titleLabel ?? "");
      const titleInput = ownerDocument.createElement("input");
      titleInput.className = "canvas-edit-title";
      titleInput.defaultValue = String(title ?? "");
      titleInput.value = String(title ?? "");

      const contentLabelElement = ownerDocument.createElement("label");
      contentLabelElement.className = "canvas-edit-label";
      contentLabelElement.textContent = String(contentLabel ?? "");
      const contentInput = ownerDocument.createElement("textarea");
      contentInput.className = "canvas-edit-content";
      contentInput.setAttribute("rows", "5");
      const initialContent = String(content || "");
      contentInput.textContent = initialContent;
      contentInput.value = initialContent;

      body.append(titleLabelElement, titleInput, contentLabelElement, contentInput);

      const footer = ownerDocument.createElement("div");
      footer.className = "canvas-picker-footer";
      const saveButton = ownerDocument.createElement("button");
      saveButton.className = "canvas-picker-save";
      saveButton.textContent = String(saveLabel ?? "");
      footer.appendChild(saveButton);

      dialog.replaceChildren(header, body, footer);
      return { closeButton, saveButton, titleInput, contentInput };
    },
  };
}
