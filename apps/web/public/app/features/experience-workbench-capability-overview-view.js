function createTextElement(ownerDocument, tagName, className, value) {
  const element = ownerDocument.createElement(tagName);
  element.className = className;
  element.textContent = String(value ?? "");
  return element;
}

function createAction(ownerDocument, className, attributeName, attributeValue, label, disabled) {
  const action = ownerDocument.createElement("button");
  action.className = className;
  action.setAttribute(attributeName, String(attributeValue ?? ""));
  action.textContent = String(label ?? "");
  action.disabled = Boolean(disabled);
  return action;
}

function createReviewAction(ownerDocument, candidateId, actionName, label, disabled) {
  const action = createAction(
    ownerDocument,
    "memory-usage-action-btn",
    "data-capability-review-candidate-action",
    actionName,
    label,
    disabled,
  );
  action.setAttribute("data-capability-review-candidate-id", candidateId);
  return action;
}

function createCandidateRow(ownerDocument, item) {
  const candidateId = String(item?.candidateId ?? "");
  const taskId = String(item?.taskId ?? "");
  const row = ownerDocument.createElement("div");
  row.className = `memory-usage-overview-row experience-capability-row${item?.synthesized ? " experience-candidate-synthesized" : ""}`;

  const main = ownerDocument.createElement("div");
  main.className = "memory-usage-overview-row-main experience-capability-row-main";
  main.append(createTextElement(ownerDocument, "div", "memory-usage-overview-key", item?.title));

  const meta = ownerDocument.createElement("div");
  meta.className = "memory-usage-overview-meta";
  if (candidateId) {
    meta.append(createTextElement(ownerDocument, "span", "experience-capability-candidate-id", item?.candidateIdLabel));
  }
  meta.append(createTextElement(ownerDocument, "span", "", item?.statusLabel));
  if (taskId) {
    meta.append(createTextElement(ownerDocument, "span", "", item?.taskLabel));
  }
  if (item?.skillFreshnessStatus) {
    meta.append(createTextElement(ownerDocument, "span", "", item.skillFreshnessStatus));
  }
  meta.append(createTextElement(ownerDocument, "span", "", item?.updatedAtLabel));
  main.append(meta);

  const badges = ownerDocument.createElement("div");
  badges.className = "memory-detail-badges";
  badges.append(
    createTextElement(ownerDocument, "span", "memory-badge", item?.typeLabel),
    createTextElement(ownerDocument, "span", "memory-badge", item?.statusLabel),
  );
  if (item?.synthesized) {
    badges.append(createTextElement(ownerDocument, "span", "memory-badge experience-synthesized-badge", item?.synthesizedLabel));
  }
  if (item?.skillFreshnessSummary) {
    badges.append(createTextElement(ownerDocument, "span", "memory-badge", item.skillFreshnessSummary));
  }
  main.append(
    badges,
    createTextElement(ownerDocument, "div", "experience-capability-summary", item?.summary),
  );

  const actions = ownerDocument.createElement("div");
  actions.className = "experience-capability-actions";
  actions.append(createAction(
    ownerDocument,
    "memory-usage-action-btn",
    "data-capability-open-candidate-id",
    candidateId,
    item?.openCandidateLabel,
    false,
  ));
  if (taskId) {
    actions.append(createAction(
      ownerDocument,
      "memory-usage-action-btn",
      "data-capability-open-task-id",
      taskId,
      item?.openTaskLabel,
      false,
    ));
  }
  actions.append(
    createAction(
      ownerDocument,
      "memory-usage-action-btn",
      "data-capability-synthesize-candidate-id",
      candidateId,
      item?.synthesizeLabel,
      item?.synthesizeDisabled,
    ),
    createReviewAction(
      ownerDocument,
      candidateId,
      "accept",
      item?.acceptLabel,
      item?.acceptDisabled,
    ),
    createReviewAction(
      ownerDocument,
      candidateId,
      "reject",
      item?.rejectLabel,
      item?.rejectDisabled,
    ),
  );

  row.append(main, actions);
  return row;
}

function createLane(ownerDocument, lane) {
  const safeItems = Array.isArray(lane?.items) ? lane.items : [];
  const laneType = lane?.type === "skill" ? "skill" : "method";
  const laneElement = ownerDocument.createElement("div");
  laneElement.className = "memory-usage-overview-lane";

  const head = ownerDocument.createElement("div");
  head.className = "memory-usage-overview-head";
  const headMain = ownerDocument.createElement("div");
  headMain.className = "experience-capability-lane-head-main";
  headMain.append(
    createTextElement(ownerDocument, "span", "memory-usage-overview-title", lane?.title),
    createTextElement(ownerDocument, "span", "memory-stat-caption", lane?.countLabel),
  );
  head.append(
    headMain,
    createAction(
      ownerDocument,
      "memory-usage-action-btn experience-capability-bulk-btn",
      "data-capability-bulk-reject-type",
      laneType,
      lane?.bulkRejectLabel,
      lane?.bulkRejectDisabled,
    ),
  );
  laneElement.append(head);

  if (!safeItems.length) {
    laneElement.append(createTextElement(
      ownerDocument,
      "div",
      "memory-usage-overview-empty",
      lane?.emptyLabel,
    ));
    return laneElement;
  }

  const list = ownerDocument.createElement("div");
  list.className = "memory-usage-overview-list";
  list.append(...safeItems.map((item) => createCandidateRow(ownerDocument, item)));
  laneElement.append(list);
  return laneElement;
}

export function createExperienceWorkbenchCapabilityOverviewView() {
  return {
    render({ container, title, caption, resynthesize, lanes }) {
      if (!container) return;
      const ownerDocument = container.ownerDocument ?? document;
      const safeResynthesize = resynthesize && typeof resynthesize === "object" ? resynthesize : {};
      const safeLanes = Array.isArray(lanes) ? lanes : [];

      const card = ownerDocument.createElement("div");
      card.className = "memory-stat-card memory-stat-card-wide memory-usage-overview-card experience-capability-card";

      const head = ownerDocument.createElement("div");
      head.className = "memory-stat-card-head";
      head.append(
        createTextElement(ownerDocument, "span", "memory-stat-label", title),
        createTextElement(ownerDocument, "span", "memory-stat-caption", caption),
      );
      card.append(head);

      const resynthesizeBar = ownerDocument.createElement("div");
      resynthesizeBar.className = "experience-resynthesize-bar";
      const input = ownerDocument.createElement("input");
      input.className = "input input-sm experience-resynthesize-input";
      input.setAttribute("data-experience-resynthesize-asset-path", "1");
      input.value = String(safeResynthesize.assetPath ?? "");
      input.placeholder = String(safeResynthesize.placeholder ?? "");
      input.disabled = Boolean(safeResynthesize.inputDisabled);
      const preview = createAction(
        ownerDocument,
        "memory-usage-action-btn",
        "data-experience-resynthesize-preview",
        "1",
        safeResynthesize.previewLabel,
        safeResynthesize.previewDisabled,
      );
      const fillSelected = createAction(
        ownerDocument,
        "button goal-inline-action-secondary",
        "data-experience-resynthesize-fill-selected",
        "1",
        safeResynthesize.fillSelectedLabel,
        safeResynthesize.fillSelectedDisabled,
      );
      fillSelected.title = String(safeResynthesize.fillSelectedTitle ?? "");
      resynthesizeBar.append(input, preview, fillSelected);
      card.append(resynthesizeBar);

      const grid = ownerDocument.createElement("div");
      grid.className = "memory-usage-overview-grid";
      grid.append(...safeLanes.map((lane) => createLane(ownerDocument, lane)));
      card.append(grid);

      container.replaceChildren(card);
    },
  };
}
