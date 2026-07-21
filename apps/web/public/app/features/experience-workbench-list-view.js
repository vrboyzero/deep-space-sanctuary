function createTextElement(ownerDocument, tagName, className, value) {
  const element = ownerDocument.createElement(tagName);
  element.className = className;
  element.textContent = String(value ?? "");
  return element;
}

export function createExperienceWorkbenchListView({ refs }) {
  const { experienceWorkbenchListEl } = refs;

  return {
    render({ items }) {
      if (!experienceWorkbenchListEl) return;
      const ownerDocument = experienceWorkbenchListEl.ownerDocument ?? document;
      const listItems = items.map((item) => {
        const listItem = ownerDocument.createElement("div");
        listItem.className = `memory-list-item${item.active ? " active" : ""}${item.synthesisLabel ? " experience-candidate-synthesized" : ""}`;
        listItem.setAttribute("data-experience-candidate-id", String(item.id ?? ""));

        const meta = ownerDocument.createElement("div");
        meta.className = "memory-list-item-meta";
        meta.append(
          createTextElement(ownerDocument, "span", "", item.typeLabel),
          createTextElement(ownerDocument, "span", "", item.statusLabel),
        );
        if (item.taskLabel) {
          meta.append(createTextElement(ownerDocument, "span", "", item.taskLabel));
        }
        if (item.synthesisLabel) {
          meta.append(createTextElement(ownerDocument, "span", "memory-badge experience-synthesized-badge", item.synthesisLabel));
        }
        if (item.publishedLabel) {
          meta.append(createTextElement(ownerDocument, "span", "memory-badge memory-badge-shared", item.publishedLabel));
        }
        if (item.freshnessLabel) {
          meta.append(createTextElement(ownerDocument, "span", "memory-badge", item.freshnessLabel));
        }
        meta.append(createTextElement(ownerDocument, "span", "", item.updatedAtLabel));

        listItem.append(
          createTextElement(ownerDocument, "div", "memory-list-item-title", item.title),
          meta,
          createTextElement(ownerDocument, "div", "memory-list-item-snippet", item.summary),
        );
        return listItem;
      });
      experienceWorkbenchListEl.replaceChildren(...listItems);
    },
  };
}
