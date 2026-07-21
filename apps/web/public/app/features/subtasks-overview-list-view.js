function createTextElement(ownerDocument, tagName, className, text) {
  const element = ownerDocument.createElement(tagName);
  element.className = className;
  element.textContent = String(text ?? "");
  return element;
}

export function createSubtasksOverviewListView({
  refs,
  formatStatus,
  getStatusToneClass,
  formatDateTime,
  summarizeSourcePath,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const { subtasksListEl } = refs;

  return {
    render({ items, selectedId, activeConversationId, conversationId, continuationFocusSessionId }) {
      if (!subtasksListEl) return;
      const ownerDocument = subtasksListEl.ownerDocument ?? document;
      const listItems = items.map((item) => {
        const taskId = item?.id || "";
        const sessionId = item?.sessionId || "";
        const isActive = item?.id === selectedId;
        const isCurrentConversation = !conversationId
          && activeConversationId
          && item?.parentConversationId === activeConversationId;
        const isContinuationFocus = continuationFocusSessionId
          && typeof item?.sessionId === "string"
          && item.sessionId.trim() === continuationFocusSessionId;
        const progressText = item?.progress?.message || item?.summary || item?.instruction || "";

        const listItem = ownerDocument.createElement("div");
        listItem.className = `memory-list-item subtask-list-item${isActive ? " active" : ""}${isContinuationFocus ? " is-continuation-focus" : ""}`;
        listItem.setAttribute("data-subtask-id", String(taskId));
        listItem.setAttribute("data-subtask-session-id", String(sessionId));

        const head = ownerDocument.createElement("div");
        head.className = "subtask-list-item-head";
        head.append(createTextElement(ownerDocument, "div", "memory-list-item-title", taskId || "-"));

        const badges = ownerDocument.createElement("div");
        badges.className = "memory-detail-badges";
        if (isCurrentConversation) {
          badges.append(createTextElement(ownerDocument, "span", "memory-badge memory-badge-shared", t("subtasks.currentConversation", {}, "current")));
        }
        if (item?.archivedAt) {
          badges.append(createTextElement(ownerDocument, "span", "memory-badge", t("subtasks.archivedBadge", {}, "archived")));
        }
        badges.append(createTextElement(
          ownerDocument,
          "span",
          `memory-badge subtask-status-badge ${getStatusToneClass(item?.status)}`,
          formatStatus(item?.status),
        ));
        head.append(badges);

        const firstMeta = ownerDocument.createElement("div");
        firstMeta.className = "memory-list-item-meta";
        firstMeta.append(createTextElement(ownerDocument, "span", "", item?.agentId || "-"));
        if (sessionId) {
          firstMeta.append(createTextElement(ownerDocument, "span", "", sessionId));
        }
        firstMeta.append(createTextElement(ownerDocument, "span", "", formatDateTime(item?.updatedAt || item?.createdAt)));

        const snippet = createTextElement(
          ownerDocument,
          "div",
          "memory-list-item-snippet",
          progressText || t("subtasks.noSummary", {}, "No summary yet."),
        );

        const secondMeta = ownerDocument.createElement("div");
        secondMeta.className = "memory-list-item-meta";
        secondMeta.append(createTextElement(ownerDocument, "span", "", summarizeSourcePath(item?.parentConversationId || "-")));
        if (item?.outputPath) {
          secondMeta.append(createTextElement(ownerDocument, "span", "", summarizeSourcePath(item.outputPath)));
        }

        listItem.append(head, firstMeta, snippet, secondMeta);
        return listItem;
      });
      subtasksListEl.replaceChildren(...listItems);
    },
  };
}
