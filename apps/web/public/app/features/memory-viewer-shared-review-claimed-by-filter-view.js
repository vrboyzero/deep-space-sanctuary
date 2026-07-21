function createOptionElement(ownerDocument, option, fallbackLabel) {
  const optionElement = ownerDocument.createElement("option");
  const value = typeof option?.value === "string" ? option.value : "";
  const label = typeof option?.label === "string" && option.label.trim()
    ? option.label.trim()
    : fallbackLabel;
  optionElement.value = value;
  optionElement.textContent = label;
  return optionElement;
}

export function createMemoryViewerSharedReviewClaimedByFilterView() {
  return {
    render({ select, options, selectedValue, fallbackLabel = "-" } = {}) {
      if (!select) return;
      const ownerDocument = select.ownerDocument ?? document;
      const safeFallbackLabel = typeof fallbackLabel === "string" ? fallbackLabel : "-";
      const targetOptions = Array.isArray(options) ? options : [];
      select.replaceChildren(...targetOptions.map((option) => (
        createOptionElement(ownerDocument, option, safeFallbackLabel)
      )));
      select.value = typeof selectedValue === "string" ? selectedValue : "";
    },
  };
}
