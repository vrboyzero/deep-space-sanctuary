function createTextElement(ownerDocument, tagName, className, value) {
  const element = ownerDocument.createElement(tagName);
  element.className = className;
  element.textContent = String(value ?? "");
  return element;
}

function createCheckbox(ownerDocument, checkbox) {
  if (!checkbox) return null;
  const label = ownerDocument.createElement("label");
  label.className = `experience-synthesis-source-select${checkbox.required ? " is-required" : ""}`;

  const input = ownerDocument.createElement("input");
  input.type = "checkbox";
  input.setAttribute("data-synthesis-source-id", String(checkbox.candidateId ?? ""));
  input.setAttribute("aria-label", String(checkbox.label ?? ""));
  input.checked = Boolean(checkbox.checked);
  input.disabled = Boolean(checkbox.disabled);
  label.append(input, createTextElement(ownerDocument, "span", "", checkbox.label));
  return label;
}

function createOverwriteCompare(ownerDocument, compare) {
  if (!compare) return null;
  const card = ownerDocument.createElement("div");
  card.className = "memory-detail-card";

  const header = ownerDocument.createElement("div");
  header.className = "goal-summary-header";
  const headerContent = ownerDocument.createElement("div");
  headerContent.append(
    createTextElement(ownerDocument, "div", "goal-summary-title", compare.title),
    createTextElement(ownerDocument, "div", "goal-summary-text", compare.summary),
  );
  header.append(headerContent);

  const grid = ownerDocument.createElement("div");
  grid.className = "memory-detail-grid";
  for (const [label, content] of [
    [compare.currentLabel, compare.currentContent],
    [compare.nextLabel, compare.nextContent],
  ]) {
    const contentCard = ownerDocument.createElement("div");
    contentCard.className = "memory-detail-card";
    contentCard.append(
      createTextElement(ownerDocument, "span", "memory-detail-label", label),
      createTextElement(ownerDocument, "pre", "memory-detail-pre", content),
    );
    grid.append(contentCard);
  }
  card.append(header, grid);
  return card;
}

function createSourceRow(ownerDocument, row) {
  const sourceRow = ownerDocument.createElement("div");
  sourceRow.className = `experience-synthesis-row${row?.synthesized ? " experience-candidate-synthesized" : ""}`;
  sourceRow.setAttribute("data-synthesis-preview-candidate-id", String(row?.candidateId ?? ""));

  const main = ownerDocument.createElement("div");
  main.className = "experience-synthesis-row-main";
  main.append(createTextElement(ownerDocument, "div", "experience-synthesis-row-title", row?.title));

  const meta = ownerDocument.createElement("div");
  meta.className = "experience-synthesis-row-meta";
  const safeMeta = Array.isArray(row?.meta) ? row.meta : [];
  meta.append(...safeMeta.map((value) => createTextElement(ownerDocument, "span", "", value)));
  main.append(
    meta,
    createTextElement(ownerDocument, "div", "experience-synthesis-row-summary", row?.summary),
  );

  const side = ownerDocument.createElement("div");
  side.className = "experience-synthesis-row-side";
  const checkbox = createCheckbox(ownerDocument, row?.checkbox);
  if (checkbox) side.append(checkbox);
  side.append(createTextElement(
    ownerDocument,
    "span",
    row?.synthesized ? "memory-badge experience-synthesized-badge" : "memory-badge",
    row?.badgeLabel,
  ));

  sourceRow.append(main, side);
  return sourceRow;
}

export function createExperienceWorkbenchSynthesisListView() {
  return {
    render({ container, overwriteCompare, rows }) {
      if (!container) return;
      const ownerDocument = container.ownerDocument ?? document;
      const safeRows = Array.isArray(rows) ? rows : [];
      const children = [];
      const compare = createOverwriteCompare(ownerDocument, overwriteCompare);
      if (compare) children.push(compare);
      children.push(...safeRows.map((row) => createSourceRow(ownerDocument, row)));
      container.replaceChildren(...children);
    },
  };
}
