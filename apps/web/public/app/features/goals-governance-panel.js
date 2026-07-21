import { isCompactGovernanceDetailMode } from "./governance-detail-mode.js";

function renderGovernanceEmptyState(panel, message) {
  if (!panel) return;
  const ownerDocument = panel.ownerDocument ?? document;
  const empty = ownerDocument.createElement("div");
  empty.className = "memory-viewer-empty";
  empty.textContent = message;
  panel.replaceChildren(empty);
}

function createGovernanceElement(ownerDocument, tagName, className = "", text) {
  const element = ownerDocument.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text ?? "");
  return element;
}

function createGovernanceButton(ownerDocument, className, label, attributes = {}) {
  const button = createGovernanceElement(ownerDocument, "button", className, label);
  for (const [name, value] of Object.entries(attributes)) {
    button.setAttribute(name, String(value ?? ""));
  }
  return button;
}

function appendGovernanceMeta(ownerDocument, parent, values) {
  const meta = createGovernanceElement(ownerDocument, "div", "memory-list-item-meta");
  for (const value of values) {
    if (value !== undefined && value !== null && String(value) !== "") {
      meta.append(createGovernanceElement(ownerDocument, "span", "", value));
    }
  }
  parent.append(meta);
  return meta;
}

function appendGovernanceTextBlock(ownerDocument, parent, className, text, label = "") {
  if (text === undefined || text === null || String(text) === "") return null;
  const block = createGovernanceElement(ownerDocument, "div", className);
  if (label) block.append(createGovernanceElement(ownerDocument, "span", "", label));
  block.append(createGovernanceElement(ownerDocument, "span", "", text));
  parent.append(block);
  return block;
}

export function createGoalsGovernancePanelFeature({
  refs,
  escapeHtml,
  formatDateTime,
  goalRuntimeFilePath,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const { goalsDetailEl } = refs;

  function formatGovernanceStatus(status) {
    const normalized = typeof status === "string" ? status.trim().toLowerCase() : "";
    if (!normalized) return "未知";
    if (normalized === "pending" || normalized === "required" || normalized === "waiting_user") return "待处理";
    if (normalized === "approved" || normalized === "accepted") return "已通过";
    if (normalized === "rejected") return "已拒绝";
    if (normalized === "expired") return "已过期";
    if (normalized === "overdue") return "已逾期";
    if (normalized === "escalated") return "已升级";
    if (normalized === "sent") return "已发送";
    if (normalized === "failed" || normalized === "error") return "失败";
    return status;
  }

  function formatGovernanceTargetType(targetType) {
    const normalized = typeof targetType === "string" ? targetType.trim().toLowerCase() : "";
    if (!normalized) return "未知对象";
    if (normalized === "checkpoint") return "Checkpoint";
    if (normalized === "suggestion_review") return "建议评审";
    if (normalized === "template") return "模板";
    return targetType;
  }

  function isExperienceSuggestionType(suggestionType) {
    return suggestionType === "method_candidate" || suggestionType === "skill_candidate";
  }

  function renderGoalGovernanceFreshnessSummary(ownerDocument, memoryFreshness) {
    const summary = memoryFreshness?.summary && typeof memoryFreshness.summary === "object"
      ? memoryFreshness.summary
      : null;
    if (!summary?.available || !summary.headline) {
      return null;
    }
    const note = createGovernanceElement(ownerDocument, "div", "tool-settings-policy-note");
    note.classList.add("goal-section-space-bottom-12");
    const headline = createGovernanceElement(ownerDocument, "div");
    headline.append(
      createGovernanceElement(ownerDocument, "strong", "", "治理 freshness："),
      createGovernanceElement(ownerDocument, "span", "", summary.headline),
    );
    note.append(headline, createGovernanceElement(
      ownerDocument,
      "div",
      "",
      `review_required=${summary.reviewRequiredCount || 0} / stale=${summary.staleCount || 0} / superseded=${summary.supersededCount || 0}`,
    ));
    return note;
  }

  function formatBridgeRuntimeState(runtimeState) {
    const normalized = typeof runtimeState === "string" ? runtimeState.trim().toLowerCase() : "";
    if (!normalized) return "未知";
    if (normalized === "active") return "活跃";
    if (normalized === "runtime-lost") return "运行态丢失";
    if (normalized === "orphaned") return "孤儿清理";
    if (normalized === "closed") return "已关闭";
    return runtimeState;
  }

  function formatBridgeCloseReason(closeReason) {
    const normalized = typeof closeReason === "string" ? closeReason.trim().toLowerCase() : "";
    if (!normalized) return "未记录";
    if (normalized === "manual") return "手动关闭";
    if (normalized === "idle-timeout") return "空闲超时";
    if (normalized === "runtime-lost") return "运行态丢失";
    if (normalized === "orphan") return "孤儿清理";
    return closeReason;
  }

  function renderGoalBridgeGovernanceSection(ownerDocument, summary) {
    if (!summary || typeof summary !== "object") return null;
    const items = Array.isArray(summary.items) ? summary.items : [];
    const card = createGovernanceElement(ownerDocument, "div", "memory-detail-card");
    card.classList.add("goal-section-space-bottom-12");
    card.append(
      createGovernanceElement(ownerDocument, "div", "goal-summary-title", "Bridge 治理摘要"),
      createGovernanceElement(
        ownerDocument,
        "div",
        "goal-summary-text",
        "汇总最近 bridge 运行任务的运行态归因、阻塞原因与产物入口，便于在 Goal 治理层直接判断是否需要恢复或重拉起。",
      ),
    );
    const grid = createGovernanceElement(ownerDocument, "div", "goal-summary-grid");
    grid.classList.add("goal-section-space-top-10");
    const stats = [
      ["Bridge 节点", summary.bridgeNodeCount || 0],
      ["活跃会话", summary.activeCount || 0],
      ["运行态丢失", summary.runtimeLostCount || 0],
      ["孤儿清理", summary.orphanedCount || 0],
      ["结构化阻塞", summary.blockedCount || 0],
      ["产物 / 转录", `${summary.artifactCount || 0} / ${summary.transcriptCount || 0}`],
    ];
    for (const [label, value] of stats) {
      const stat = createGovernanceElement(ownerDocument, "div", "goal-summary-item");
      stat.append(
        createGovernanceElement(ownerDocument, "span", "goal-summary-label", label),
        createGovernanceElement(ownerDocument, "strong", "goal-summary-value", value),
      );
      grid.append(stat);
    }
    card.append(grid);

    if (!items.length) {
      const empty = createGovernanceElement(ownerDocument, "div", "memory-viewer-empty", "当前没有 bridge 治理摘要项。");
      empty.classList.add("goal-section-space-top-12");
      card.append(empty);
      return card;
    }

    const list = createGovernanceElement(ownerDocument, "div", "goal-tracking-list");
    list.classList.add("goal-section-space-top-12");
    for (const item of items) {
      const itemElement = createGovernanceElement(ownerDocument, "div", "goal-tracking-item");
      const head = createGovernanceElement(ownerDocument, "div", "goal-tracking-item-head");
      head.append(createGovernanceElement(ownerDocument, "span", "goal-tracking-item-title", item.title || item.nodeId || "-"));
      if (item.runtimeState) {
        head.append(createGovernanceElement(
          ownerDocument,
          "span",
          `memory-badge${item.runtimeState === "active" ? " memory-badge-shared" : ""}`,
          formatBridgeRuntimeState(item.runtimeState),
        ));
      }
      itemElement.append(head);
      appendGovernanceMeta(ownerDocument, itemElement, [
        item.nodeId || "-",
        item.taskId,
        item.closeReason ? formatBridgeCloseReason(item.closeReason) : "",
      ]);
      const summaryLines = Array.isArray(item.summaryLines) ? item.summaryLines : [];
      if (summaryLines.length || item.blockReason) {
        const note = createGovernanceElement(ownerDocument, "div", "tool-settings-policy-note");
        note.append(...summaryLines.map((line) => createGovernanceElement(ownerDocument, "div", "", line)));
        if (item.blockReason) {
          note.append(createGovernanceElement(ownerDocument, "div", "", `阻塞归因: ${item.blockReason}`));
        }
        itemElement.append(note);
      }
      if (item.artifactPath) appendGovernanceMeta(ownerDocument, itemElement, ["Bridge 产物", item.artifactPath]);
      if (item.transcriptPath) appendGovernanceMeta(ownerDocument, itemElement, ["Bridge Transcript", item.transcriptPath]);
      const actions = createGovernanceElement(ownerDocument, "div", "goal-detail-actions");
      if (item.taskId) actions.append(createGovernanceButton(
        ownerDocument,
        "button goal-inline-action-secondary",
        "打开运行任务",
        { "data-open-task-id": item.taskId },
      ));
      if (item.artifactPath) actions.append(createGovernanceButton(
        ownerDocument,
        "button goal-inline-action-secondary",
        "打开 bridge 产物",
        { "data-open-source": item.artifactPath },
      ));
      if (item.transcriptPath) actions.append(createGovernanceButton(
        ownerDocument,
        "button goal-inline-action-secondary",
        "打开 bridge transcript",
        { "data-open-source": item.transcriptPath },
      ));
      itemElement.append(actions);
      list.append(itemElement);
    }
    card.append(list);
    return card;
  }

  function renderCommanderFocusSection(ownerDocument, summary) {
    if (!summary || typeof summary !== "object") return null;
    const delegationResults = Array.isArray(summary.delegationResults) ? summary.delegationResults : [];
    const checkLines = Array.isArray(summary.checkLines) ? summary.checkLines : [];
    const reasons = Array.isArray(summary.reasons) ? summary.reasons : [];
    const workOrderPaths = Array.isArray(summary.workOrderPaths) ? summary.workOrderPaths : [];
    const reworkTargetAgentIds = Array.isArray(summary.reworkTargetAgentIds) ? summary.reworkTargetAgentIds : [];
    const card = createGovernanceElement(ownerDocument, "div", "memory-detail-card");
    card.classList.add("goal-section-space-bottom-12");
    card.append(
      createGovernanceElement(ownerDocument, "div", "goal-summary-title", "Commander Review / Fan-in"),
      createGovernanceElement(
        ownerDocument,
        "div",
        "goal-summary-text",
        "聚合当前 focus commander 节点的 fan-in 摘要、收口建议、delegation lane 结果与 review/work-order 入口。",
      ),
    );
    const grid = createGovernanceElement(ownerDocument, "div", "goal-summary-grid");
    grid.classList.add("goal-section-space-top-10");
    const stats = [
      ["当前节点", summary.nodeTitle || summary.nodeId || "-"],
      ["治理模式", summary.governanceMode || "-"],
      ["执行模式", summary.executionMode || "-"],
      ["Review 状态", formatGovernanceStatus(summary.reviewStatus || "-")],
      ["Final Approval", summary.finalApprovalMode || "-"],
      ["返工次数", summary.reworkRevisionCount || 0],
    ];
    for (const [label, value] of stats) {
      const stat = createGovernanceElement(ownerDocument, "div", "goal-summary-item");
      stat.append(
        createGovernanceElement(ownerDocument, "span", "goal-summary-label", label),
        createGovernanceElement(ownerDocument, "strong", "goal-summary-value", value),
      );
      grid.append(stat);
    }
    card.append(grid);

    const badges = createGovernanceElement(ownerDocument, "div", "memory-detail-badges");
    badges.classList.add("goal-section-space-top-10");
    if (summary.commanderAgentId) badges.append(createGovernanceElement(ownerDocument, "span", "memory-badge", `Commander: ${summary.commanderAgentId}`));
    if (summary.planId) badges.append(createGovernanceElement(ownerDocument, "span", "memory-badge", `Plan: ${summary.planId}`));
    if (summary.runId) badges.append(createGovernanceElement(ownerDocument, "span", "memory-badge", `Run: ${summary.runId}`));
    card.append(badges);
    appendGovernanceTextBlock(ownerDocument, card, "memory-detail-text", summary.fanInSummary);
    appendGovernanceTextBlock(ownerDocument, card, "memory-detail-text", summary.nextAction, "Next: ");
    appendGovernanceTextBlock(ownerDocument, card, "memory-detail-text", summary.managerActionHint, "Hint: ");
    appendGovernanceTextBlock(ownerDocument, card, "memory-detail-text", summary.lastReworkReason, "Last Rework: ");
    if (summary.lastReworkAt) appendGovernanceMeta(ownerDocument, card, ["Rework At", formatDateTime(summary.lastReworkAt)]);

    if (summary.reworkContext?.quickSummary || summary.reworkContext?.historySummary) {
      const title = createGovernanceElement(ownerDocument, "div", "goal-summary-title", "Rework Context");
      title.classList.add("goal-section-space-top-12");
      card.append(title);
      appendGovernanceTextBlock(ownerDocument, card, "memory-detail-text", summary.reworkContext?.quickSummary, "Quick: ");
      appendGovernanceTextBlock(ownerDocument, card, "memory-detail-text", summary.reworkContext?.historySummary);
    }
    if (reworkTargetAgentIds.length) {
      const title = createGovernanceElement(ownerDocument, "div", "goal-summary-title", "Rework Targets");
      title.classList.add("goal-section-space-top-12");
      const targetBadges = createGovernanceElement(ownerDocument, "div", "memory-detail-badges");
      targetBadges.append(...reworkTargetAgentIds.map((item) => createGovernanceElement(ownerDocument, "span", "memory-badge", item)));
      card.append(title, targetBadges);
    }
    if (reasons.length) {
      const note = createGovernanceElement(ownerDocument, "div", "tool-settings-policy-note");
      note.append(...reasons.map((item) => createGovernanceElement(ownerDocument, "div", "", item)));
      card.append(note);
    }
    if (checkLines.length) {
      const title = createGovernanceElement(ownerDocument, "div", "goal-summary-title", "Acceptance Checks");
      title.classList.add("goal-section-space-top-12");
      const note = createGovernanceElement(ownerDocument, "div", "tool-settings-policy-note");
      note.append(...checkLines.map((item) => createGovernanceElement(ownerDocument, "div", "", item)));
      card.append(title, note);
    }

    if (delegationResults.length) {
      const title = createGovernanceElement(ownerDocument, "div", "goal-summary-title", "Delegation Lanes");
      title.classList.add("goal-section-space-top-12");
      const list = createGovernanceElement(ownerDocument, "div", "goal-tracking-list");
      for (const item of delegationResults) {
        const itemElement = createGovernanceElement(ownerDocument, "div", "goal-tracking-item");
        const head = createGovernanceElement(ownerDocument, "div", "goal-tracking-item-head");
        head.append(createGovernanceElement(
          ownerDocument,
          "span",
          "goal-tracking-item-title",
          `${item.agentId || "-"}${item.role ? ` · ${item.role}` : ""}`,
        ));
        if (item.status) head.append(createGovernanceElement(ownerDocument, "span", "memory-badge", item.status));
        itemElement.append(head);
        if (item.summary) itemElement.append(createGovernanceElement(ownerDocument, "div", "memory-list-item-snippet", item.summary));
        appendGovernanceMeta(ownerDocument, itemElement, [item.taskId, item.outputPath]);
        const actions = createGovernanceElement(ownerDocument, "div", "goal-detail-actions");
        if (item.taskId) actions.append(createGovernanceButton(
          ownerDocument,
          "button goal-inline-action-secondary",
          "打开运行任务",
          { "data-open-task-id": item.taskId },
        ));
        if (item.outputPath) actions.append(createGovernanceButton(
          ownerDocument,
          "button goal-inline-action-secondary",
          "打开产物",
          { "data-open-source": item.outputPath },
        ));
        itemElement.append(actions);
        list.append(itemElement);
      }
      card.append(title, list);
    } else {
      const empty = createGovernanceElement(ownerDocument, "div", "memory-viewer-empty", "当前还没有可展示的 delegation lane 结果。");
      empty.classList.add("goal-section-space-top-12");
      card.append(empty);
    }

    const actions = createGovernanceElement(ownerDocument, "div", "goal-detail-actions");
    actions.classList.add("goal-section-space-top-12");
    if (summary.reviewPath) actions.append(createGovernanceButton(
      ownerDocument,
      "button goal-inline-action-secondary",
      "打开 review",
      { "data-open-source": summary.reviewPath },
    ));
    if (summary.commanderPlanPath) actions.append(createGovernanceButton(
      ownerDocument,
      "button goal-inline-action-secondary",
      "打开 commander plan",
      { "data-open-source": summary.commanderPlanPath },
    ));
    actions.append(...workOrderPaths.map((item) => createGovernanceButton(
      ownerDocument,
      "button goal-inline-action-secondary",
      "打开 work-order",
      { "data-open-source": item },
    )));
    card.append(actions);
    return card;
  }

  function renderGoalReviewGovernancePanelLoading() {
    const panel = goalsDetailEl?.querySelector("#goalGovernancePanel");
    renderGovernanceEmptyState(panel, "正在汇总 review governance / approval workflow …");
  }

  function renderGoalReviewGovernancePanelError(message) {
    const panel = goalsDetailEl?.querySelector("#goalGovernancePanel");
    renderGovernanceEmptyState(panel, message);
  }

  function renderGoalReviewGovernancePanel(goal, data) {
    const panel = goalsDetailEl?.querySelector("#goalGovernancePanel");
    if (!panel || !goal) return;
    if (!data) {
      renderGovernanceEmptyState(panel, "当前还没有评审治理汇总。");
      return;
    }
    const ownerDocument = panel.ownerDocument ?? document;
    const compactGovernanceDetailMode = isCompactGovernanceDetailMode();
    const reviewers = Array.isArray(data.reviewers) ? data.reviewers : [];
    const templates = Array.isArray(data.templates) ? data.templates : [];
    const notifications = Array.isArray(data.notifications) ? data.notifications : [];
    const notificationDispatches = Array.isArray(data.notificationDispatches) ? data.notificationDispatches : [];
    const actionableReviews = Array.isArray(data.actionableReviews) ? data.actionableReviews : [];
    const actionableCheckpoints = Array.isArray(data.actionableCheckpoints) ? data.actionableCheckpoints : [];
    const fragment = ownerDocument.createDocumentFragment();

    const header = createGovernanceElement(ownerDocument, "div", "goal-summary-header");
    const headerCopy = createGovernanceElement(ownerDocument, "div");
    headerCopy.append(
      createGovernanceElement(ownerDocument, "div", "goal-summary-title", "评审治理 / 统一审批"),
      createGovernanceElement(
        ownerDocument,
        "div",
        "goal-summary-text",
        "在当前长期任务详情中汇总评审人、模板、建议评审、checkpoint 工作流与提醒状态。",
      ),
    );
    const headerActions = createGovernanceElement(ownerDocument, "div", "goal-detail-actions");
    headerActions.append(
      createGovernanceButton(ownerDocument, "button", "执行审批扫描", { "data-goal-approval-scan": goal.id }),
      createGovernanceButton(
        ownerDocument,
        "button goal-inline-action-secondary",
        "打开通知记录",
        { "data-open-source": data.notificationsPath || goalRuntimeFilePath(goal, "review-notifications.json") },
      ),
    );
    if (!compactGovernanceDetailMode) {
      headerActions.append(createGovernanceButton(
        ownerDocument,
        "button goal-inline-action-secondary",
        "打开分发队列",
        { "data-open-source": data.notificationDispatchesPath || goalRuntimeFilePath(goal, "review-notification-dispatches.json") },
      ));
      if (data.governanceConfigPath) {
        headerActions.append(createGovernanceButton(
          ownerDocument,
          "button goal-inline-action-secondary",
          "打开治理配置",
          { "data-open-source": data.governanceConfigPath },
        ));
      }
    }
    header.append(headerCopy, headerActions);
    fragment.append(header);

    const summaryGrid = createGovernanceElement(ownerDocument, "div", "goal-summary-grid");
    const summaryStats = [
      ["待评审", data.workflowPendingCount],
      ["评审逾期", data.workflowOverdueCount],
      ["待处理 Checkpoint", data.checkpointWorkflowPendingCount],
      ["Checkpoint 逾期", data.checkpointWorkflowOverdueCount],
    ];
    if (!compactGovernanceDetailMode) {
      summaryStats.push(
        ["评审人", reviewers.length],
        ["模板", templates.length],
        ["分发记录", data.notificationDispatchCounts?.total || notificationDispatches.length || 0],
      );
    }
    for (const [label, value] of summaryStats) {
      const stat = createGovernanceElement(ownerDocument, "div", "goal-summary-item");
      stat.append(
        createGovernanceElement(ownerDocument, "span", "goal-summary-label", label),
        createGovernanceElement(ownerDocument, "strong", "goal-summary-value", value),
      );
      summaryGrid.append(stat);
    }
    fragment.append(summaryGrid);

    const freshness = renderGoalGovernanceFreshnessSummary(ownerDocument, data.memoryFreshness);
    if (freshness) fragment.append(freshness);
    if (!compactGovernanceDetailMode) {
      const commander = renderCommanderFocusSection(ownerDocument, data.commanderFocus);
      const bridge = renderGoalBridgeGovernanceSection(ownerDocument, data.bridgeGovernanceSummary);
      if (commander) fragment.append(commander);
      if (bridge) fragment.append(bridge);
      if (data.learningReviewInput) {
        const learningCard = createGovernanceElement(ownerDocument, "div", "memory-detail-card");
        learningCard.classList.add("goal-section-space-bottom-12");
        learningCard.append(createGovernanceElement(ownerDocument, "div", "goal-summary-title", "Learning / Review Input"));
        const badges = createGovernanceElement(ownerDocument, "div", "memory-detail-badges");
        badges.append(createGovernanceElement(
          ownerDocument,
          "span",
          "memory-badge",
          data.learningReviewInput.summary?.headline || "-",
        ));
        learningCard.append(badges);
        const summaryLines = Array.isArray(data.learningReviewInput.summaryLines) ? data.learningReviewInput.summaryLines : [];
        const nudges = Array.isArray(data.learningReviewInput.nudges) ? data.learningReviewInput.nudges : [];
        learningCard.append(...summaryLines.slice(0, 4).map((line) => createGovernanceElement(
          ownerDocument,
          "div",
          "memory-detail-text",
          line,
        )));
        learningCard.append(...nudges.slice(0, 4).map((line) => createGovernanceElement(
          ownerDocument,
          "div",
          "memory-detail-text",
          `Nudge: ${line}`,
        )));
        fragment.append(learningCard);
      }
    }

    const columns = createGovernanceElement(ownerDocument, "div", "goal-tracking-columns");
    const reviewColumn = createGovernanceElement(ownerDocument, "div", "goal-tracking-column");
    reviewColumn.append(createGovernanceElement(ownerDocument, "div", "goal-summary-title", "待处理建议评审"));
    if (actionableReviews.length) {
      const reviewList = createGovernanceElement(ownerDocument, "div", "goal-tracking-list");
      for (const item of actionableReviews) {
        const itemElement = createGovernanceElement(ownerDocument, "div", "goal-tracking-item");
        const head = createGovernanceElement(ownerDocument, "div", "goal-tracking-item-head");
        head.append(
          createGovernanceElement(ownerDocument, "span", "goal-tracking-item-title", item.title),
          createGovernanceElement(ownerDocument, "span", "memory-badge", formatGovernanceStatus(item.status)),
        );
        itemElement.append(head);
        appendGovernanceMeta(ownerDocument, itemElement, [item.id, item.suggestionType, item.reviewer]);
        const actions = createGovernanceElement(ownerDocument, "div", "goal-detail-actions");
        if (isExperienceSuggestionType(item.suggestionType)) {
          actions.append(createGovernanceButton(
            ownerDocument,
            "button goal-inline-action-secondary",
            t("goals.openExperienceWorkbench", {}, "在经验能力中打开"),
            {
              "data-goal-open-experience": "true",
              "data-goal-open-experience-candidate-id": item.experienceCandidateId || "",
              "data-goal-open-experience-type": item.experienceType || "",
              "data-goal-open-experience-query": item.title || item.suggestionId || item.id || "",
            },
          ));
        }
        const suggestionAttributes = {
          "data-goal-suggestion-goal-id": goal.id,
          "data-goal-suggestion-review-id": item.id,
          "data-goal-suggestion-type": item.suggestionType,
          "data-goal-suggestion-id": item.suggestionId,
        };
        actions.append(
          createGovernanceButton(ownerDocument, "button goal-inline-action", "通过", {
            "data-goal-suggestion-decision": "accepted",
            ...suggestionAttributes,
          }),
          createGovernanceButton(ownerDocument, "button goal-inline-action-secondary", "拒绝", {
            "data-goal-suggestion-decision": "rejected",
            ...suggestionAttributes,
          }),
          createGovernanceButton(ownerDocument, "button goal-inline-action-secondary", "升级", {
            "data-goal-suggestion-escalate": "true",
            ...suggestionAttributes,
          }),
        );
        itemElement.append(actions);
        reviewList.append(itemElement);
      }
      reviewColumn.append(reviewList);
    } else {
      reviewColumn.append(createGovernanceElement(ownerDocument, "div", "memory-viewer-empty", "当前没有待处理的建议评审。"));
    }
    if (!compactGovernanceDetailMode) {
      reviewColumn.append(createGovernanceElement(ownerDocument, "div", "goal-summary-title", "模板"));
      if (templates.length) {
        const templateList = createGovernanceElement(ownerDocument, "div", "goal-tracking-list");
        for (const item of templates) {
          const itemElement = createGovernanceElement(ownerDocument, "div", "goal-tracking-item");
          const head = createGovernanceElement(ownerDocument, "div", "goal-tracking-item-head");
          head.append(
            createGovernanceElement(ownerDocument, "span", "goal-tracking-item-title", item.title),
            createGovernanceElement(ownerDocument, "span", "memory-badge", item.mode),
          );
          itemElement.append(head);
          appendGovernanceMeta(ownerDocument, itemElement, [item.id, item.target]);
          templateList.append(itemElement);
        }
        reviewColumn.append(templateList);
      } else {
        reviewColumn.append(createGovernanceElement(ownerDocument, "div", "memory-viewer-empty", "当前组织治理还没有配置模板。"));
      }
    }
    columns.append(reviewColumn);

    const checkpointColumn = createGovernanceElement(ownerDocument, "div", "goal-tracking-column");
    checkpointColumn.append(createGovernanceElement(ownerDocument, "div", "goal-summary-title", "待处理 Checkpoint"));
    if (actionableCheckpoints.length) {
      const checkpointList = createGovernanceElement(ownerDocument, "div", "goal-tracking-list");
      for (const item of actionableCheckpoints) {
        const itemElement = createGovernanceElement(ownerDocument, "div", "goal-tracking-item");
        const head = createGovernanceElement(ownerDocument, "div", "goal-tracking-item-head");
        head.append(
          createGovernanceElement(ownerDocument, "span", "goal-tracking-item-title", item.title),
          createGovernanceElement(
            ownerDocument,
            "span",
            `memory-badge${item.status === "approved" ? " memory-badge-shared" : ""}`,
            formatGovernanceStatus(item.status),
          ),
        );
        itemElement.append(head);
        appendGovernanceMeta(ownerDocument, itemElement, [
          item.id,
          item.nodeId,
          item.reviewer,
          item.slaAt ? formatDateTime(item.slaAt) : "",
        ]);
        const actions = createGovernanceElement(ownerDocument, "div", "goal-detail-actions");
        const checkpointAttributes = {
          "data-goal-checkpoint-goal-id": goal.id,
          "data-goal-checkpoint-node-id": item.nodeId || "",
          "data-goal-checkpoint-id": item.id,
        };
        actions.append(
          createGovernanceButton(ownerDocument, "button goal-inline-action", "批准", {
            "data-goal-checkpoint-action": "approve",
            ...checkpointAttributes,
          }),
          createGovernanceButton(ownerDocument, "button goal-inline-action-secondary", "拒绝", {
            "data-goal-checkpoint-action": "reject",
            ...checkpointAttributes,
          }),
          createGovernanceButton(ownerDocument, "button goal-inline-action-secondary", "升级", {
            "data-goal-checkpoint-escalate": "true",
            ...checkpointAttributes,
          }),
        );
        itemElement.append(actions);
        checkpointList.append(itemElement);
      }
      checkpointColumn.append(checkpointList);
    } else {
      checkpointColumn.append(createGovernanceElement(ownerDocument, "div", "memory-viewer-empty", "当前没有待处理的 checkpoint 工作流。"));
    }

    if (!compactGovernanceDetailMode) {
      checkpointColumn.append(createGovernanceElement(ownerDocument, "div", "goal-summary-title", "最近通知"));
      if (notifications.length) {
        const notificationList = createGovernanceElement(ownerDocument, "div", "goal-tracking-list");
        for (const item of notifications.slice().reverse().slice(0, 6)) {
          const itemElement = createGovernanceElement(ownerDocument, "div", "goal-tracking-item");
          const head = createGovernanceElement(ownerDocument, "div", "goal-tracking-item-head");
          head.append(
            createGovernanceElement(ownerDocument, "span", "goal-tracking-item-title", item.kind || "通知"),
            createGovernanceElement(ownerDocument, "span", "memory-badge", formatGovernanceTargetType(item.targetType)),
          );
          itemElement.append(head, createGovernanceElement(ownerDocument, "div", "memory-list-item-snippet", item.message || ""));
          appendGovernanceMeta(ownerDocument, itemElement, [
            item.targetId || "",
            item.recipient,
            item.createdAt ? formatDateTime(item.createdAt) : "",
          ]);
          notificationList.append(itemElement);
        }
        checkpointColumn.append(notificationList);
      } else {
        checkpointColumn.append(createGovernanceElement(ownerDocument, "div", "memory-viewer-empty", "当前还没有提醒或升级通知。"));
      }

      checkpointColumn.append(createGovernanceElement(ownerDocument, "div", "goal-summary-title", "分发渠道 / 队列"));
      if (notificationDispatches.length) {
        const dispatchMeta = createGovernanceElement(ownerDocument, "div", "memory-list-item-meta");
        dispatchMeta.classList.add("goal-section-space-bottom-10");
        dispatchMeta.append(
          createGovernanceElement(
            ownerDocument,
            "span",
            "",
            `按渠道：${Object.entries(data.notificationDispatchCounts?.byChannel || {}).map(([key, value]) => `${key}=${value}`).join(" | ") || "无"}`,
          ),
          createGovernanceElement(
            ownerDocument,
            "span",
            "",
            `按状态：${Object.entries(data.notificationDispatchCounts?.byStatus || {}).map(([key, value]) => `${formatGovernanceStatus(key)}=${value}`).join(" | ") || "无"}`,
          ),
        );
        checkpointColumn.append(dispatchMeta);
        const dispatchList = createGovernanceElement(ownerDocument, "div", "goal-tracking-list");
        for (const item of notificationDispatches.slice().reverse().slice(0, 8)) {
          const itemElement = createGovernanceElement(ownerDocument, "div", "goal-tracking-item");
          const head = createGovernanceElement(ownerDocument, "div", "goal-tracking-item-head");
          head.append(
            createGovernanceElement(ownerDocument, "span", "goal-tracking-item-title", item.channel),
            createGovernanceElement(ownerDocument, "span", "memory-badge", formatGovernanceStatus(item.status)),
          );
          itemElement.append(head, createGovernanceElement(ownerDocument, "div", "memory-list-item-snippet", item.message || ""));
          appendGovernanceMeta(ownerDocument, itemElement, [
            `${item.targetType || ""}:${item.targetId || ""}`,
            item.recipient,
            item.routeKey,
            item.createdAt ? formatDateTime(item.createdAt) : "",
          ]);
          dispatchList.append(itemElement);
        }
        checkpointColumn.append(dispatchList);
      } else {
        checkpointColumn.append(createGovernanceElement(ownerDocument, "div", "memory-viewer-empty", "当前还没有实际分发或队列记录。"));
      }
    }
    columns.append(checkpointColumn);
    fragment.append(columns);
    panel.replaceChildren(fragment);
  }

  return {
    renderGoalReviewGovernancePanel,
    renderGoalReviewGovernancePanelError,
    renderGoalReviewGovernancePanelLoading,
  };
}
