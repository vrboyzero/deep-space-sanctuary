const BODY_STYLE = "padding:12px;";
const LABEL_STYLE = "display:block;margin-bottom:8px;color:var(--text-muted);font-size:12px;";
const TITLE_INPUT_STYLE = "width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-main);color:var(--text-main);margin-bottom:12px;box-sizing:border-box;";
const CONTENT_INPUT_STYLE = "width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-main);color:var(--text-main);resize:vertical;box-sizing:border-box;";

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
      body.className = "canvas-picker-body";
      body.setAttribute("style", BODY_STYLE);

      const titleLabelElement = ownerDocument.createElement("label");
      titleLabelElement.setAttribute("style", LABEL_STYLE);
      titleLabelElement.textContent = String(titleLabel ?? "");
      const titleInput = ownerDocument.createElement("input");
      titleInput.className = "canvas-edit-title";
      titleInput.setAttribute("style", TITLE_INPUT_STYLE);
      titleInput.defaultValue = String(title ?? "");
      titleInput.value = String(title ?? "");

      const contentLabelElement = ownerDocument.createElement("label");
      contentLabelElement.setAttribute("style", LABEL_STYLE);
      contentLabelElement.textContent = String(contentLabel ?? "");
      const contentInput = ownerDocument.createElement("textarea");
      contentInput.className = "canvas-edit-content";
      contentInput.setAttribute("rows", "5");
      contentInput.setAttribute("style", CONTENT_INPUT_STYLE);
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
