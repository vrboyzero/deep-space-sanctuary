export function createMemoryViewerDedupWarningView() {
  return {
    render({ container, lines } = {}) {
      if (!container) return;
      const ownerDocument = container.ownerDocument ?? document;
      const warningLines = Array.isArray(lines)
        ? lines.filter((line) => typeof line === "string" && line.trim())
        : [];
      const warningElements = warningLines.map((line) => {
        const warningElement = ownerDocument.createElement("div");
        warningElement.textContent = line;
        return warningElement;
      });
      container.replaceChildren(...warningElements);
    },
  };
}
