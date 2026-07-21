function createTextElement(ownerDocument, tagName, className, value) {
  const element = ownerDocument.createElement(tagName);
  element.className = className;
  element.textContent = String(value ?? "");
  return element;
}

function createAssetAction(ownerDocument, attributeName, assetPath, label, disabled) {
  const action = ownerDocument.createElement("button");
  action.className = "memory-usage-action-btn";
  action.setAttribute(attributeName, String(assetPath ?? ""));
  action.textContent = String(label ?? "");
  action.disabled = Boolean(disabled);
  return action;
}

function createAssetCard(ownerDocument, item) {
  const card = ownerDocument.createElement("div");
  card.className = `experience-asset-card${item.selected ? " experience-candidate-synthesized" : ""}`;
  card.setAttribute("data-experience-asset-path", String(item.assetPath ?? ""));

  const main = ownerDocument.createElement("div");
  main.className = "experience-capability-row-main";
  main.append(createTextElement(ownerDocument, "div", "memory-usage-overview-key", item.title));

  const meta = ownerDocument.createElement("div");
  meta.className = "memory-usage-overview-meta";
  meta.append(
    createTextElement(ownerDocument, "span", "", item.typeLabel),
    createTextElement(ownerDocument, "span", "", item.pathLabel),
  );
  if (item.selectedLabel) {
    meta.append(createTextElement(ownerDocument, "span", "", item.selectedLabel));
  }
  main.append(meta);

  const badges = ownerDocument.createElement("div");
  badges.className = "memory-detail-badges";
  badges.append(
    createTextElement(ownerDocument, "span", "memory-badge", item.typeLabel),
    createTextElement(ownerDocument, "span", "memory-badge memory-badge-shared", item.publishedLabel),
  );
  if (item.metadataName) {
    badges.append(createTextElement(ownerDocument, "span", "memory-badge", item.metadataName));
  }
  main.append(
    badges,
    createTextElement(ownerDocument, "div", "memory-inline-item-path", item.assetPath),
    createTextElement(ownerDocument, "div", "experience-capability-summary", item.summary),
  );

  const actions = ownerDocument.createElement("div");
  actions.className = "experience-capability-actions";
  actions.append(
    createAssetAction(
      ownerDocument,
      "data-experience-published-asset-preview",
      item.assetPath,
      item.previewLabel,
      item.previewDisabled,
    ),
    createAssetAction(
      ownerDocument,
      "data-experience-published-asset-open-source",
      item.assetPath,
      item.openSourceLabel,
      item.openSourceDisabled,
    ),
  );
  card.append(main, actions);
  return card;
}

export function createExperienceWorkbenchAssetLaneView() {
  return {
    render({ container, title, countLabel, emptyLabel, message, items }) {
      if (!container) return;
      const ownerDocument = container.ownerDocument ?? document;
      const safeItems = Array.isArray(items) ? items : [];
      const lane = ownerDocument.createElement("div");
      lane.className = "memory-usage-overview-lane";

      const head = ownerDocument.createElement("div");
      head.className = "memory-usage-overview-head";
      const headMain = ownerDocument.createElement("div");
      headMain.className = "experience-capability-lane-head-main";
      headMain.append(
        createTextElement(ownerDocument, "span", "memory-usage-overview-title", title),
        createTextElement(ownerDocument, "span", "memory-stat-caption", countLabel),
      );
      head.append(headMain);
      lane.append(head);

      if (message || !safeItems.length) {
        lane.append(createTextElement(
          ownerDocument,
          "div",
          "memory-usage-overview-empty",
          message || emptyLabel,
        ));
      } else {
        const list = ownerDocument.createElement("div");
        list.className = "memory-usage-overview-list";
        list.append(...safeItems.map((item) => createAssetCard(ownerDocument, item)));
        lane.append(list);
      }

      container.replaceChildren(lane);
    },
  };
}
