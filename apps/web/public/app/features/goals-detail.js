import { isCompactGovernanceDetailMode } from "./governance-detail-mode.js";

function createGoalDetailElement(ownerDocument, tagName, className = "", text) {
  const element = ownerDocument.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text ?? "");
  return element;
}

function createGoalDetailButton(ownerDocument, className, label, attributes = {}) {
  const button = createGoalDetailElement(ownerDocument, "button", className, label);
  for (const [name, value] of Object.entries(attributes)) {
    button.setAttribute(name, String(value ?? ""));
  }
  return button;
}

function createGoalDetailValueCard(ownerDocument, label, value, valueClass = "memory-detail-text") {
  const card = createGoalDetailElement(ownerDocument, "div", "memory-detail-card");
  card.append(
    createGoalDetailElement(ownerDocument, "span", "memory-detail-label", label),
    createGoalDetailElement(ownerDocument, "div", valueClass, value),
  );
  return card;
}

function createGoalDetailSummaryHeader(ownerDocument, title, text, trailingElement) {
  const header = createGoalDetailElement(ownerDocument, "div", "goal-summary-header");
  const copy = createGoalDetailElement(ownerDocument, "div");
  copy.append(
    createGoalDetailElement(ownerDocument, "div", "goal-summary-title", title),
    createGoalDetailElement(ownerDocument, "div", "goal-summary-text", text),
  );
  header.append(copy);
  if (trailingElement) header.append(trailingElement);
  return header;
}

function createGoalDetailPanelCard(ownerDocument, {
  cardClass,
  panelId,
  loadingText,
  title = "",
  text = "",
}) {
  const card = createGoalDetailElement(ownerDocument, "div", `memory-detail-card ${cardClass}`);
  if (title || text) {
    card.append(createGoalDetailSummaryHeader(ownerDocument, title, text));
  }
  const panel = createGoalDetailElement(ownerDocument, "div");
  panel.id = panelId;
  panel.append(createGoalDetailElement(ownerDocument, "div", "memory-viewer-empty", loadingText));
  card.append(panel);
  return card;
}

export function createGoalsDetailFeature({
  refs,
  getActiveConversationId,
  isConversationForGoal,
  escapeHtml,
  formatGoalStatus,
  formatDateTime,
  formatGoalPathSource,
  goalDocFilePath,
  goalRuntimeFilePath,
  goalBaseConversationId,
  onBindDetailActions,
  onLoadGoalCanvasData,
  onLoadGoalTrackingData,
  onLoadGoalCapabilityData,
  onLoadGoalProgressData,
  onLoadGoalHandoffData,
  onLoadGoalReviewGovernanceData,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const { goalsDetailEl } = refs;

  function buildGoalRuntimeSummaryCard(ownerDocument, goal, options) {
    const {
      activeNodeId,
      lastNodeId,
      lastRunId,
      isCurrentConversation,
    } = options;
    const currentChannel = goal.activeConversationId || goalBaseConversationId(goal.id);
    const badge = createGoalDetailElement(
      ownerDocument,
      "span",
      isCurrentConversation ? "memory-badge memory-badge-shared" : "memory-badge",
      isCurrentConversation
        ? t("goals.currentChannelBadge", {}, "current channel")
        : t("goals.resumableBadge", {}, "resumable"),
    );
    const card = createGoalDetailElement(ownerDocument, "div", "memory-detail-card goal-summary-card");
    card.append(createGoalDetailSummaryHeader(
      ownerDocument,
      t("goals.summaryTitle", {}, "Runtime Summary"),
      t("goals.summaryText", {}, "Overview of the current goal channel, recent nodes, and execution records."),
      badge,
    ));
    const grid = createGoalDetailElement(ownerDocument, "div", "goal-summary-grid");
    const items = [
      [t("goals.summaryStatus", {}, "Status"), formatGoalStatus(goal.status)],
      [t("goals.summaryCurrentNode", {}, "Current Node"), activeNodeId || "-"],
      [t("goals.summaryLastNode", {}, "Last Node"), lastNodeId || "-"],
      [t("goals.summaryLastRun", {}, "Last Run"), lastRunId || "-"],
    ];
    for (const [label, value] of items) {
      const item = createGoalDetailElement(ownerDocument, "div", "goal-summary-item");
      item.append(
        createGoalDetailElement(ownerDocument, "span", "goal-summary-label", label),
        createGoalDetailElement(ownerDocument, "strong", "goal-summary-value", value),
      );
      grid.append(item);
    }
    card.append(grid, createGoalDetailElement(ownerDocument, "div", "memory-detail-pre", currentChannel));
    return card;
  }

  function buildGoalRecoveryCard(ownerDocument, goal, options) {
    const {
      activeNodeId,
      lastNodeId,
      isCurrentConversation,
    } = options;
    let title = t("goals.detailRecoveryTitle", {}, "Recovery Suggestion");
    let text = t("goals.detailRecoveryBase", {}, "You can directly enter the base goal channel for this long task.");
    let actions = [{
      label: t("goals.detailEnterBase", {}, "Enter Base Channel"),
      attributes: { "data-goal-resume-detail": goal.id },
    }];

    if (goal.status === "executing" && isCurrentConversation) {
      title = t("goals.detailContinueCurrentTitle", {}, "Continue Current Channel");
      text = t("goals.detailContinueCurrentText", {}, "You are already in this long task channel. Continue the current context first to avoid duplicate recovery.");
      actions = [
        {
          label: t("goals.detailRefreshCurrent", {}, "Refresh and Continue"),
          attributes: { "data-goal-resume-detail": goal.id },
        },
        {
          label: t("goals.detailOpenTasks", {}, "View Related Tasks"),
          attributes: { "data-open-goal-tasks": goal.id },
        },
      ];
    } else if (goal.status === "executing" && activeNodeId) {
      title = t("goals.detailResumeActiveNodeTitle", {}, "Resume Current Node");
      text = t(
        "goals.detailResumeActiveNodeText",
        { nodeId: activeNodeId },
        `The current recorded active node is ${activeNodeId}. If handoff shows an open checkpoint, replay should resume this node first.`,
      );
      actions = [
        {
          label: t("goals.detailResumeCurrentNode", {}, "Resume Current Node"),
          attributes: {
            "data-goal-resume-last-node": goal.id,
            "data-goal-last-node-id": activeNodeId,
          },
        },
        {
          label: t("goals.detailEnterBase", {}, "Enter Base Channel"),
          attributes: { "data-goal-resume-detail": goal.id },
        },
      ];
    } else if (lastNodeId) {
      title = t("goals.detailResumeLastNodeTitle", {}, "Resume Last Node");
      text = t("goals.detailResumeLastNodeText", { nodeId: lastNodeId }, `Detected the last active node ${lastNodeId}. Resuming from it is more continuous than going back to the base channel.`);
      actions = [
        {
          label: t("goals.detailResumeLastNode", {}, "Resume Last Node"),
          attributes: {
            "data-goal-resume-last-node": goal.id,
            "data-goal-last-node-id": lastNodeId,
          },
        },
        {
          label: t("goals.detailEnterBase", {}, "Enter Base Channel"),
          attributes: { "data-goal-resume-detail": goal.id },
        },
      ];
    } else if (goal.status === "planning" || goal.status === "aligning" || goal.status === "ready") {
      title = t("goals.detailEnterBaseFirstTitle", {}, "Enter Base Channel First");
      text = t("goals.detailEnterBaseFirstText", {}, "There is no node history to resume yet. Enter the base goal channel first to continue breaking down the plan and tasks.");
      actions = [
        {
          label: t("goals.detailEnterBase", {}, "Enter Base Channel"),
          attributes: { "data-goal-resume-detail": goal.id },
        },
        {
          label: t("goals.detailOpenNorthstar", {}, "Open NORTHSTAR.md"),
          attributes: { "data-open-source": goal.northstarPath },
        },
      ];
    }

    const card = createGoalDetailElement(ownerDocument, "div", "memory-detail-card goal-recovery-card");
    card.append(createGoalDetailSummaryHeader(ownerDocument, title, text));
    const actionContainer = createGoalDetailElement(ownerDocument, "div", "goal-detail-actions");
    actionContainer.append(...actions.map((action) => createGoalDetailButton(
      ownerDocument,
      "button",
      action.label,
      action.attributes,
    )));
    card.append(actionContainer);
    return card;
  }

  function renderGoalDetail(goal) {
    if (!goalsDetailEl) return;
    if (!goal) {
      const ownerDocument = goalsDetailEl.ownerDocument ?? document;
      const empty = ownerDocument.createElement("div");
      empty.className = "memory-viewer-empty";
      empty.textContent = t("goals.detailSelect", {}, "Select a long task on the left to view details.");
      goalsDetailEl.replaceChildren(empty);
      return;
    }

    const activeConversationId = getActiveConversationId();
    const isCurrentConversation = isConversationForGoal(activeConversationId, goal.id);
    const objective = goal.objective ? String(goal.objective).trim() : "";
    const lastNodeId = typeof goal.lastNodeId === "string" && goal.lastNodeId.trim() ? goal.lastNodeId.trim() : "";
    const lastRunId = typeof goal.lastRunId === "string" && goal.lastRunId.trim() ? goal.lastRunId.trim() : "";
    const activeNodeId = typeof goal.activeNodeId === "string" && goal.activeNodeId.trim() ? goal.activeNodeId.trim() : "";
    const archived = goal.status === "archived";
    const ownerDocument = goalsDetailEl.ownerDocument ?? document;
    const runtimeSummaryCard = buildGoalRuntimeSummaryCard(ownerDocument, goal, {
      activeNodeId,
      lastNodeId,
      lastRunId,
      isCurrentConversation,
    });
    const recoveryCard = buildGoalRecoveryCard(ownerDocument, goal, {
      activeNodeId,
      lastNodeId,
      isCurrentConversation,
    });
    const compactGovernanceDetailMode = isCompactGovernanceDetailMode();

    const shell = createGoalDetailElement(ownerDocument, "div", "memory-detail-shell");
    const header = createGoalDetailElement(ownerDocument, "div", "memory-detail-header");
    const headerCopy = createGoalDetailElement(ownerDocument, "div");
    headerCopy.append(
      createGoalDetailElement(ownerDocument, "div", "memory-detail-title", goal.title || goal.id),
      createGoalDetailElement(
        ownerDocument,
        "div",
        "memory-list-item-snippet",
        objective || t("goals.detailNoObjective", {}, "No objective yet. Open NORTHSTAR.md or 00-goal.md to continue improving it."),
      ),
    );
    const badges = createGoalDetailElement(ownerDocument, "div", "memory-detail-badges");
    badges.append(
      createGoalDetailElement(ownerDocument, "span", "memory-badge memory-badge-shared", formatGoalStatus(goal.status)),
      createGoalDetailElement(ownerDocument, "span", "memory-badge", goal.currentPhase || "-"),
    );
    if (isCurrentConversation) {
      badges.append(createGoalDetailElement(
        ownerDocument,
        "span",
        "memory-badge memory-badge-shared",
        t("goals.currentChannelBadge", {}, "current channel"),
      ));
    }
    if (archived) {
      badges.append(createGoalDetailElement(ownerDocument, "span", "memory-badge", t("goals.archivedBadge", {}, "archived")));
    }
    header.append(headerCopy, badges);
    shell.append(header, runtimeSummaryCard, recoveryCard);

    if (!compactGovernanceDetailMode) {
      shell.append(createGoalDetailPanelCard(ownerDocument, {
        cardClass: "goal-handoff-card",
        panelId: "goalHandoffPanel",
        loadingText: t("goals.detailHandoffLoading", {}, "Loading handoff.md ..."),
      }));
    }
    shell.append(createGoalDetailPanelCard(ownerDocument, {
      cardClass: "goal-governance-card",
      panelId: "goalGovernancePanel",
      loadingText: t("goals.detailGovernanceLoading", {}, "Summarizing review governance / approval workflow ..."),
    }));

    const detailGrid = createGoalDetailElement(ownerDocument, "div", "memory-detail-grid");
    const detailItems = [
      [t("goals.detailUpdatedAt", {}, "Updated At"), formatDateTime(goal.updatedAt || goal.createdAt)],
      [t("goals.detailCreatedAt", {}, "Created At"), formatDateTime(goal.createdAt)],
      [t("goals.detailPathSource", {}, "Path Source"), formatGoalPathSource(goal.pathSource)],
      [t("goals.detailActiveNode", {}, "Current Active Node"), activeNodeId || "-"],
      [t("goals.detailLastNode", {}, "Last Active Node"), lastNodeId || "-"],
      [t("goals.detailLastActiveAt", {}, "Last Active At"), formatDateTime(goal.lastActiveAt)],
      [t("goals.detailLastPausedAt", {}, "Last Paused At"), formatDateTime(goal.pausedAt)],
      [t("goals.detailArchivedAt", {}, "Archived At"), formatDateTime(goal.archivedAt)],
      [t("goals.detailArchiveReason", {}, "Archive Reason"), goal.archiveReason || "-"],
    ];
    detailGrid.append(...detailItems.map(([label, value]) => createGoalDetailValueCard(ownerDocument, label, value)));
    if (!compactGovernanceDetailMode) {
      detailGrid.append(createGoalDetailValueCard(ownerDocument, "长期任务 ID", goal.id));
      const lastRunCard = createGoalDetailValueCard(
        ownerDocument,
        t("goals.detailLastRunId", {}, "Last Run ID"),
        lastRunId ? "" : "-",
      );
      if (lastRunId) {
        lastRunCard.lastElementChild.replaceChildren(createGoalDetailButton(
          ownerDocument,
          "memory-path-link",
          lastRunId,
          { "data-open-task-id": lastRunId },
        ));
      }
      detailGrid.append(lastRunCard);
    }
    shell.append(detailGrid);

    shell.append(createGoalDetailValueCard(
      ownerDocument,
      t("goals.detailChannel", {}, "Execution Channel"),
      goal.activeConversationId || goalBaseConversationId(goal.id),
      "memory-detail-pre",
    ));

    if (!compactGovernanceDetailMode) {
      const pathCard = createGoalDetailElement(ownerDocument, "div", "memory-detail-card");
      pathCard.append(createGoalDetailElement(
        ownerDocument,
        "span",
        "memory-detail-label",
        t("goals.detailKeyPaths", {}, "Key Paths"),
      ));
      const pathList = createGoalDetailElement(ownerDocument, "div", "goal-path-list");
      const paths = [
        [t("goals.detailOpenGoalDoc", {}, "Open 00-goal"), goalDocFilePath(goal, "00-goal.md")],
        [t("goals.detailOpenNorthstar", {}, "Open NORTHSTAR.md"), goal.northstarPath],
        [t("goals.detailOpenTasksGraph", {}, "Open Tasks Graph"), goal.tasksPath],
        [t("goals.detailOpenCapabilityPlans", {}, "Open capability-plans.json"), goalRuntimeFilePath(goal, "capability-plans.json")],
        [t("goals.detailOpenCheckpoints", {}, "Open checkpoints.json"), goalRuntimeFilePath(goal, "checkpoints.json")],
        [t("goals.detailOpenProgress", {}, "Open progress"), goal.progressPath],
        [t("goals.detailOpenHandoff", {}, "Open handoff"), goal.handoffPath],
        [t("goals.detailOpenState", {}, "Open state.json"), goalRuntimeFilePath(goal, "state.json")],
        [t("goals.detailOpenRuntime", {}, "Open runtime.json"), goalRuntimeFilePath(goal, "runtime.json")],
      ];
      pathList.append(...paths.map(([label, path]) => createGoalDetailButton(
        ownerDocument,
        "button goal-path-button",
        label,
        { "data-open-source": path },
      )));
      pathCard.append(pathList);
      shell.append(pathCard);

      const rootGrid = createGoalDetailElement(ownerDocument, "div", "memory-detail-grid");
      rootGrid.append(
        createGoalDetailValueCard(ownerDocument, "任务根目录", goal.goalRoot || "-", "memory-detail-pre"),
        createGoalDetailValueCard(ownerDocument, "文档根目录", goal.docRoot || "-", "memory-detail-pre"),
        createGoalDetailValueCard(ownerDocument, "运行态根目录", goal.runtimeRoot || "-", "memory-detail-pre"),
      );
      shell.append(rootGrid);
    }

    const detailActions = createGoalDetailElement(ownerDocument, "div", "goal-detail-actions");
    detailActions.append(createGoalDetailButton(
      ownerDocument,
      "button",
      t("goals.detailOpenTasks", {}, "View Related Tasks"),
      { "data-open-goal-tasks": goal.id },
    ));
    if (archived) {
      detailActions.append(createGoalDetailButton(
        ownerDocument,
        "button goal-inline-action-secondary",
        t("goals.delete", {}, "Delete"),
        { "data-goal-delete-detail": goal.id },
      ));
    } else {
      detailActions.append(createGoalDetailButton(
        ownerDocument,
        "button",
        t("goals.detailResumeAndEnter", {}, "Resume and Enter"),
        { "data-goal-resume-detail": goal.id },
      ));
      if (lastNodeId) {
        detailActions.append(createGoalDetailButton(
          ownerDocument,
          "button",
          t("goals.detailResumeLastNode", {}, "Resume Last Node"),
          {
            "data-goal-resume-last-node": goal.id,
            "data-goal-last-node-id": lastNodeId,
          },
        ));
      }
      detailActions.append(
        createGoalDetailButton(
          ownerDocument,
          "button goal-inline-action-secondary",
          t("goals.pause", {}, "Pause"),
          { "data-goal-pause-detail": goal.id },
        ),
        createGoalDetailButton(
          ownerDocument,
          "button goal-inline-action-secondary",
          t("goals.archive", {}, "Archive"),
          { "data-goal-archive-detail": goal.id },
        ),
      );
    }
    shell.append(detailActions);

    if (!compactGovernanceDetailMode) {
      shell.append(createGoalDetailPanelCard(ownerDocument, {
        cardClass: "goal-canvas-card",
        panelId: "goalCanvasPanel",
        loadingText: t("goals.detailBoardLoading", {}, "Loading board-ref.json ..."),
      }));
    }
    shell.append(createGoalDetailPanelCard(ownerDocument, {
      cardClass: "goal-tracking-card",
      panelId: "goalTrackingPanel",
      loadingText: t("goals.detailTrackingLoading", {}, "Loading tasks.json / checkpoints.json ..."),
      title: t("goals.detailTrackingTitle", {}, "Checkpoint / Node Tracking"),
      text: t("goals.detailTrackingText", {}, "Reads structured execution progress for the current long task from tasks.json and checkpoints.json."),
    }));
    if (!compactGovernanceDetailMode) {
      shell.append(
        createGoalDetailPanelCard(ownerDocument, {
          cardClass: "goal-capability-card",
          panelId: "goalCapabilityPanel",
          loadingText: t("goals.detailCapabilityLoading", {}, "Loading capability-plans.json ..."),
          title: t("goals.detailCapabilityTitle", {}, "Capability Plan"),
          text: t("goals.detailCapabilityText", {}, "Reads pre-execution plans and post-run actual usage from capability-plans.json."),
        }),
        createGoalDetailPanelCard(ownerDocument, {
          cardClass: "goal-progress-card",
          panelId: "goalProgressPanel",
          loadingText: t("goals.detailProgressLoading", {}, "Loading progress.md ..."),
          title: t("goals.detailProgressTitle", {}, "Execution Timeline"),
          text: t("goals.detailProgressText", {}, "Reads node transitions and checkpoint approval timeline from progress.md."),
        }),
      );
    }
    goalsDetailEl.replaceChildren(shell);

    onBindDetailActions?.(goal);
    onLoadGoalCanvasData?.(goal);
    onLoadGoalTrackingData?.(goal);
    onLoadGoalCapabilityData?.(goal);
    onLoadGoalProgressData?.(goal);
    onLoadGoalHandoffData?.(goal);
    onLoadGoalReviewGovernanceData?.(goal);
  }

  return {
    renderGoalDetail,
  };
}
