function createButton(ownerDocument, {
  dataAttribute,
  key,
  label,
  disabled,
} = {}, onClick) {
  const button = ownerDocument.createElement("button");
  const safeKey = typeof key === "string" ? key : "";
  button.className = "memory-usage-action-btn";
  button.setAttribute(dataAttribute, safeKey);
  button.disabled = disabled === true;
  button.textContent = typeof label === "string" ? label : "";
  if (typeof onClick === "function") {
    button.addEventListener("click", () => onClick(safeKey));
  }
  return button;
}

export function createMemoryViewerSharedReviewBatchBarView() {
  return {
    clear({ container } = {}) {
      if (!container) return;
      container.replaceChildren();
    },

    render({
      container,
      summary,
      selectionButtons,
      actionButtons,
      onSelect,
      onAction,
    } = {}) {
      if (!container) return;
      const ownerDocument = container.ownerDocument ?? document;
      const summaryElement = ownerDocument.createElement("div");
      summaryElement.className = "memory-shared-review-batch-summary";
      summaryElement.textContent = typeof summary === "string" ? summary : "";

      const actionsElement = ownerDocument.createElement("div");
      actionsElement.className = "memory-shared-review-batch-actions";
      const safeSelectionButtons = Array.isArray(selectionButtons) ? selectionButtons : [];
      const safeActionButtons = Array.isArray(actionButtons) ? actionButtons : [];
      for (const button of safeSelectionButtons) {
        actionsElement.append(createButton(ownerDocument, {
          dataAttribute: "data-shared-review-batch-select",
          key: button?.key,
          label: button?.label,
          disabled: button?.disabled,
        }, onSelect));
      }
      for (const button of safeActionButtons) {
        actionsElement.append(createButton(ownerDocument, {
          dataAttribute: "data-shared-review-batch-action",
          key: button?.key,
          label: button?.label,
          disabled: button?.disabled,
        }, onAction));
      }

      container.replaceChildren(summaryElement, actionsElement);
    },
  };
}
