function createTextElement(ownerDocument, tagName, className, text) {
  const element = ownerDocument.createElement(tagName);
  element.className = className;
  element.textContent = String(text ?? "");
  return element;
}

function createActionButton(ownerDocument, { className, attribute, goalId, label }) {
  const button = createTextElement(ownerDocument, "button", className, label);
  button.setAttribute(attribute, String(goalId ?? ""));
  return button;
}

export function createGoalsOverviewListView({
  refs,
  isConversationForGoal,
  formatGoalStatus,
  formatDateTime,
  summarizeSourcePath,
  formatGoalPathSource,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const { goalsListEl } = refs;

  return {
    render({ items, selectedId, activeConversationId }) {
      if (!goalsListEl) return;
      const ownerDocument = goalsListEl.ownerDocument ?? document;
      const listItems = items.map((goal) => {
        const isActive = goal.id === selectedId;
        const isCurrentConversation = isConversationForGoal(activeConversationId, goal.id);
        const objective = goal.objective ? String(goal.objective).trim() : "";
        const archived = goal.status === "archived";

        const item = ownerDocument.createElement("div");
        item.className = `memory-list-item goal-list-item${isActive ? " active" : ""}`;
        item.setAttribute("data-goal-id", String(goal.id ?? ""));

        const head = ownerDocument.createElement("div");
        head.className = "goal-list-item-head";
        head.append(createTextElement(ownerDocument, "div", "memory-list-item-title", goal.title || goal.id));
        if (isCurrentConversation) {
          head.append(createTextElement(ownerDocument, "span", "memory-badge memory-badge-shared", "当前"));
        }
        if (archived) {
          head.append(createTextElement(ownerDocument, "span", "memory-badge", t("goals.archivedBadge", {}, "archived")));
        }

        const statusMeta = ownerDocument.createElement("div");
        statusMeta.className = "memory-list-item-meta";
        statusMeta.append(
          createTextElement(ownerDocument, "span", "", formatGoalStatus(goal.status)),
          createTextElement(ownerDocument, "span", "", goal.currentPhase || "-"),
          createTextElement(ownerDocument, "span", "", formatDateTime(goal.updatedAt || goal.createdAt)),
        );

        const snippet = createTextElement(
          ownerDocument,
          "div",
          "memory-list-item-snippet",
          objective || t("goals.noObjective", {}, "No objective yet. Open NORTHSTAR.md to add the goal description."),
        );

        const sourceMeta = ownerDocument.createElement("div");
        sourceMeta.className = "goal-list-item-meta";
        sourceMeta.append(
          createTextElement(ownerDocument, "span", "", summarizeSourcePath(goal.goalRoot || "-")),
          createTextElement(ownerDocument, "span", "", formatGoalPathSource(goal.pathSource)),
        );

        const actions = ownerDocument.createElement("div");
        actions.className = "goal-list-item-actions";
        if (!archived) {
          actions.append(
            createActionButton(ownerDocument, {
              className: "button goal-inline-action",
              attribute: "data-goal-resume",
              goalId: goal.id,
              label: t("goals.resume", {}, "Resume"),
            }),
            createActionButton(ownerDocument, {
              className: "button goal-inline-action goal-inline-action-secondary",
              attribute: "data-goal-pause",
              goalId: goal.id,
              label: t("goals.pause", {}, "Pause"),
            }),
            createActionButton(ownerDocument, {
              className: "button goal-inline-action goal-inline-action-secondary",
              attribute: "data-goal-archive",
              goalId: goal.id,
              label: t("goals.archive", {}, "Archive"),
            }),
          );
        }

        item.append(head, statusMeta, snippet, sourceMeta, actions);
        return item;
      });
      goalsListEl.replaceChildren(...listItems);
    },
  };
}
