import { createPanelTaskScope } from "./panel-task-scope.js";

function formatPlanStatus(status, t) {
  switch (status) {
    case "active":
      return t("panel.sessionPlanStatusActive", {}, "Active");
    case "blocked":
      return t("panel.sessionPlanStatusBlocked", {}, "Blocked");
    case "completed":
      return t("panel.sessionPlanStatusCompleted", {}, "Completed");
    case "cancelled":
      return t("panel.sessionPlanStatusCancelled", {}, "Cancelled");
    default:
      return t("panel.sessionPlanStatusDraft", {}, "Draft");
  }
}

function formatPlanMode(mode, t) {
  return mode === "manual"
    ? t("panel.sessionPlanModeManual", {}, "Manual")
    : t("panel.sessionPlanModeAgent", {}, "Agent");
}

function formatPlanUpdatedBy(updatedBy, t) {
  switch (updatedBy) {
    case "user":
      return t("panel.sessionPlanUpdatedByUser", {}, "User");
    case "system":
      return t("panel.sessionPlanUpdatedBySystem", {}, "System");
    default:
      return t("panel.sessionPlanUpdatedByAgent", {}, "Agent");
  }
}

function formatPlanStepStatus(status, t) {
  switch (status) {
    case "in_progress":
      return t("panel.sessionPlanStepStatusInProgress", {}, "In Progress");
    case "blocked":
      return t("panel.sessionPlanStepStatusBlocked", {}, "Blocked");
    case "completed":
      return t("panel.sessionPlanStepStatusCompleted", {}, "Completed");
    case "skipped":
      return t("panel.sessionPlanStepStatusSkipped", {}, "Skipped");
    default:
      return t("panel.sessionPlanStepStatusPending", {}, "Pending");
  }
}

function resolveCurrentStep(planState) {
  if (!planState || !Array.isArray(planState.steps) || !planState.currentStepId) {
    return null;
  }
  return planState.steps.find((step) => step?.id === planState.currentStepId) || null;
}

function countCompletedSteps(planState) {
  if (!Array.isArray(planState?.steps)) return 0;
  return planState.steps.filter((step) => step?.status === "completed" || step?.status === "skipped").length;
}

function buildPlanRefLabel(ref, t) {
  if (!ref || typeof ref !== "object") return "";
  if (ref.kind === "goal") {
    const label = ref.label || ref.nodeId || ref.goalId || "-";
    return t("panel.sessionPlanRefGoal", { label }, `Goal · ${label}`);
  }
  if (ref.kind === "workflow") {
    const label = ref.label || ref.workflowName || ref.journalId || "-";
    return t("panel.sessionPlanRefWorkflow", { label }, `Workflow · ${label}`);
  }
  if (ref.kind === "subtask") {
    const label = ref.label || ref.sessionId || ref.taskId || "-";
    return t("panel.sessionPlanRefSubtask", { label }, `Subtask · ${label}`);
  }
  return "";
}

function buildSummaryText(planState, t) {
  const currentStep = resolveCurrentStep(planState);
  if (planState?.blocker) {
    return `${t("panel.sessionPlanBlockerLabel", {}, "Blocker")}: ${planState.blocker}`;
  }
  if (currentStep?.title && planState?.nextAction) {
    return `${t("panel.sessionPlanCurrentStepLabel", {}, "Current Step")}: ${currentStep.title} · ${t("panel.sessionPlanNextActionLabel", {}, "Next Action")}: ${planState.nextAction}`;
  }
  if (planState?.nextAction) {
    return `${t("panel.sessionPlanNextActionLabel", {}, "Next Action")}: ${planState.nextAction}`;
  }
  if (currentStep?.summary) {
    return currentStep.summary;
  }
  if (planState?.summary) {
    return planState.summary;
  }
  if (currentStep?.title) {
    return `${t("panel.sessionPlanCurrentStepLabel", {}, "Current Step")}: ${currentStep.title}`;
  }
  return t("panel.sessionPlanSummaryFallback", {}, "Plan is ready. Click to view details.");
}

function buildBadgeClassNames(kind) {
  if (kind === "blocked") return "memory-badge-shared";
  if (kind === "completed") return "memory-badge-private";
  return "";
}

function createPlanTextElement(ownerDocument, tagName, className, value) {
  const element = ownerDocument.createElement(tagName);
  element.className = className;
  element.textContent = String(value ?? "");
  return element;
}

function createPlanBadgeElement(ownerDocument, value, className = "") {
  return createPlanTextElement(
    ownerDocument,
    "span",
    ["memory-badge", className].filter(Boolean).join(" "),
    value,
  );
}

function createPlanElement(ownerDocument, tagName, className = "") {
  const element = ownerDocument.createElement(tagName);
  if (className) element.className = className;
  return element;
}

function createPlanActionElement(ownerDocument, tagName, className, label, action, title) {
  const element = createPlanTextElement(ownerDocument, tagName, className, label);
  if (title) {
    element.title = String(title);
  }
  if (tagName === "button") {
    element.type = "button";
    element.setAttribute("aria-label", String(title));
    element.setAttribute("data-plan-action", action);
  }
  return element;
}

function createPlanModalContent({
  ownerDocument,
  planState,
  currentStep,
  completedSteps,
  totalSteps,
  focusedStepId,
  focusedRefKey,
  workflowStatusByJournalId,
  formatDateTime,
  t,
}) {
  const fragment = ownerDocument.createDocumentFragment();
  const summary = createPlanElement(ownerDocument, "div", "session-plan-modal-summary");
  summary.append(
    createPlanTextElement(
      ownerDocument,
      "div",
      "session-plan-modal-plan-title",
      planState?.title || t("panel.sessionPlanTitle", {}, "Current Plan"),
    ),
  );
  if (planState?.summary) {
    summary.append(
      createPlanTextElement(ownerDocument, "div", "session-plan-modal-plan-summary", planState.summary),
    );
  }
  const summaryChips = createPlanElement(ownerDocument, "div", "session-plan-modal-chip-row");
  summaryChips.append(
    createPlanBadgeElement(ownerDocument, formatPlanStatus(planState?.status, t), buildBadgeClassNames(planState?.status)),
    createPlanBadgeElement(ownerDocument, formatPlanMode(planState?.mode, t)),
    createPlanBadgeElement(
      ownerDocument,
      t("panel.sessionPlanRevision", { revision: String(planState?.revision || 0) }, `r${planState?.revision || 0}`),
    ),
  );
  summary.append(summaryChips);
  fragment.append(summary);

  const grid = createPlanElement(ownerDocument, "div", "session-plan-modal-grid");
  const gridItems = [
    [
      t("panel.sessionPlanCurrentStepLabel", {}, "Current Step"),
      currentStep?.title || "-",
    ],
    [
      t("panel.sessionPlanNextActionLabel", {}, "Next Action"),
      planState?.nextAction || "-",
    ],
    [
      t("panel.sessionPlanBlockerLabel", {}, "Blocker"),
      planState?.blocker || currentStep?.blocker || "-",
    ],
  ];
  for (const [label, value] of gridItems) {
    const card = createPlanElement(ownerDocument, "div", "session-plan-modal-card");
    card.append(
      createPlanTextElement(ownerDocument, "span", "session-plan-modal-card-label", label),
      createPlanTextElement(ownerDocument, "div", "session-plan-modal-card-value", value),
    );
    grid.append(card);
  }
  fragment.append(grid);

  const section = createPlanElement(ownerDocument, "section", "session-plan-modal-section");
  const sectionHead = createPlanElement(ownerDocument, "div", "session-plan-modal-section-head");
  const sectionTitle = createPlanTextElement(
    ownerDocument,
    "div",
    "session-plan-modal-section-title",
    t("panel.sessionPlanStepListLabel", {}, "Steps"),
  );
  const progress = createPlanElement(ownerDocument, "div", "session-plan-modal-chip-row");
  progress.append(
    createPlanBadgeElement(
      ownerDocument,
      t(
        "panel.sessionPlanProgress",
        { completed: String(completedSteps), total: String(totalSteps) },
        `Steps ${completedSteps}/${totalSteps}`,
      ),
    ),
  );
  sectionHead.append(sectionTitle, progress);
  section.append(sectionHead);

  const stepList = createPlanElement(ownerDocument, "div", "session-plan-step-list");
  if (Array.isArray(planState?.steps) && planState.steps.length > 0) {
    for (const step of planState.steps) {
      const isCurrent = Boolean(currentStep?.id && currentStep.id === step?.id);
      const isFocused = Boolean(step?.id && focusedStepId === step.id);
      const stepItem = createPlanElement(
        ownerDocument,
        "div",
        [
          "session-plan-step-item",
          isCurrent ? "is-current" : "",
          step?.status === "blocked" ? "is-blocked" : "",
          isFocused ? "is-continuation-focus" : "",
        ].filter(Boolean).join(" "),
      );
      stepItem.setAttribute("data-plan-step-id", String(step?.id || ""));
      const stepHead = createPlanElement(ownerDocument, "div", "session-plan-step-head");
      const titleRow = createPlanElement(ownerDocument, "div", "session-plan-step-title-row");
      titleRow.append(
        createPlanBadgeElement(ownerDocument, formatPlanStepStatus(step?.status, t), buildBadgeClassNames(step?.status)),
      );
      if (isCurrent) {
        titleRow.append(
          createPlanBadgeElement(
            ownerDocument,
            t("panel.sessionPlanStepCurrent", {}, "Current"),
            "memory-badge-private",
          ),
        );
      }
      const stepAction = buildStepAction(step);
      const stepTitle = step?.title || "-";
      titleRow.append(
        stepAction
          ? createPlanActionElement(
            ownerDocument,
            "button",
            "session-plan-step-title session-plan-step-action",
            stepTitle,
            stepAction,
            stepTitle,
          )
          : createPlanTextElement(ownerDocument, "span", "session-plan-step-title", stepTitle),
      );
      stepHead.append(
        titleRow,
        createPlanTextElement(ownerDocument, "span", "session-plan-step-time", formatDateTime(step?.updatedAt)),
      );
      stepItem.append(stepHead);
      if (step?.summary) {
        stepItem.append(createPlanTextElement(ownerDocument, "div", "session-plan-step-summary", step.summary));
      }
      if (step?.blocker) {
        stepItem.append(
          createPlanTextElement(
            ownerDocument,
            "div",
            "session-plan-step-blocker",
            `${t("panel.sessionPlanBlockerLabel", {}, "Blocker")}: ${step.blocker}`,
          ),
        );
      }

      if (Array.isArray(step?.refs) && step.refs.length > 0) {
        const refs = createPlanElement(ownerDocument, "div", "session-plan-step-refs");
        for (const ref of step.refs) {
          const label = buildPlanRefLabel(ref, t);
          if (!label) continue;
          const action = buildRefAction(ref);
          const focusKey = buildRefFocusKey(ref);
          const journalId = typeof ref?.journalId === "string" ? ref.journalId.trim() : "";
          const workflowState = ref?.kind === "workflow"
            ? workflowStatusByJournalId?.[journalId]
            : null;
          const workflowStatus = ref?.kind === "workflow"
            ? buildWorkflowStatusText(workflowState, t)
            : "";
          const workflowStatusClass = ref?.kind === "workflow"
            ? normalizeWorkflowStatus(workflowState?.status)
            : "";
          const classNames = [
            "memory-badge",
            "session-plan-ref-badge",
            focusKey && focusedRefKey === focusKey ? "is-continuation-focus" : "",
            workflowStatusClass ? `is-workflow-${workflowStatusClass}` : "",
          ].filter(Boolean).join(" ");
          const title = workflowStatus || label;
          const badge = action
            ? createPlanActionElement(ownerDocument, "button", classNames, label, action, title)
            : createPlanActionElement(ownerDocument, "span", classNames, label, "", title);
          const entry = createPlanElement(ownerDocument, "span", "session-plan-ref-entry");
          entry.append(badge);
          if (workflowStatus) {
            entry.append(createPlanTextElement(ownerDocument, "span", "session-plan-ref-status", workflowStatus));
          }
          refs.append(entry);
        }
        stepItem.append(refs);
      }
      stepList.append(stepItem);
    }
  } else {
    stepList.append(
      createPlanTextElement(
        ownerDocument,
        "div",
        "session-plan-empty",
        t("panel.sessionPlanEmptySteps", {}, "No steps in the current plan yet."),
      ),
    );
  }
  section.append(stepList);
  fragment.append(section);
  return fragment;
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildPlanAction(action) {
  if (!action || typeof action !== "object") return "";
  try {
    return JSON.stringify(action);
  } catch {
    return "";
  }
}

function parsePlanAction(rawValue) {
  if (typeof rawValue !== "string" || !rawValue.trim()) return null;
  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function buildStepAction(step) {
  const stepId = typeof step?.id === "string" ? step.id.trim() : "";
  if (!stepId) return "";
  return buildPlanAction({ kind: "step", stepId });
}

function buildRefAction(ref) {
  if (!ref || typeof ref !== "object" || typeof ref.kind !== "string") return "";
  switch (ref.kind) {
    case "goal":
      if (typeof ref.goalId !== "string" || !ref.goalId.trim()) return "";
      if (typeof ref.nodeId === "string" && ref.nodeId.trim()) {
        return buildPlanAction({
          kind: "continuation",
          action: {
            kind: "node",
            goalId: ref.goalId.trim(),
            nodeId: ref.nodeId.trim(),
          },
          refKind: "goal",
          refKey: `goal:${ref.goalId.trim()}:${ref.nodeId.trim()}`,
        });
      }
      return buildPlanAction({
        kind: "continuation",
        action: {
          kind: "goal",
          goalId: ref.goalId.trim(),
        },
        refKind: "goal",
        refKey: `goal:${ref.goalId.trim()}`,
      });
    case "subtask": {
      const taskId = typeof ref.taskId === "string" ? ref.taskId.trim() : "";
      const sessionId = typeof ref.sessionId === "string" ? ref.sessionId.trim() : "";
      if (sessionId) {
        return buildPlanAction({
          kind: "continuation",
          action: {
            kind: "session",
            sessionId,
            taskId,
          },
          refKind: "subtask",
          refKey: `subtask:${sessionId}:${taskId}`,
        });
      }
      if (!taskId) return "";
      return buildPlanAction({
        kind: "continuation",
        action: {
          kind: "session",
          taskId,
        },
        refKind: "subtask",
        refKey: `subtask:${taskId}`,
      });
    }
    case "workflow": {
      const journalId = typeof ref.journalId === "string" ? ref.journalId.trim() : "";
      if (!journalId) return "";
      return buildPlanAction({
        kind: "workflow",
        journalId,
        workflowName: typeof ref.workflowName === "string" ? ref.workflowName.trim() : "",
        refKind: "workflow",
        refKey: `workflow:${journalId}`,
      });
    }
    default:
      return "";
  }
}

function buildRefFocusKey(ref) {
  if (!ref || typeof ref !== "object" || typeof ref.kind !== "string") return "";
  switch (ref.kind) {
    case "goal": {
      const goalId = typeof ref.goalId === "string" ? ref.goalId.trim() : "";
      const nodeId = typeof ref.nodeId === "string" ? ref.nodeId.trim() : "";
      if (!goalId) return "";
      return nodeId ? `goal:${goalId}:${nodeId}` : `goal:${goalId}`;
    }
    case "subtask": {
      const sessionId = typeof ref.sessionId === "string" ? ref.sessionId.trim() : "";
      const taskId = typeof ref.taskId === "string" ? ref.taskId.trim() : "";
      if (sessionId) return `subtask:${sessionId}:${taskId}`;
      if (taskId) return `subtask:${taskId}`;
      return "";
    }
    case "workflow": {
      const journalId = typeof ref.journalId === "string" ? ref.journalId.trim() : "";
      return journalId ? `workflow:${journalId}` : "";
    }
    default:
      return "";
  }
}

function normalizeWorkflowStatus(status) {
  const normalized = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (!normalized) return "";
  if (normalized === "error" || normalized === "budget_exceeded") return "blocked";
  if (normalized === "done") return "completed";
  if (normalized === "running" || normalized === "stopping" || normalized === "partial") return "active";
  return normalized;
}

function formatWorkflowStatus(status, t) {
  switch (normalizeWorkflowStatus(status)) {
    case "active":
      return t("panel.sessionPlanWorkflowStatusActive", {}, "Running");
    case "blocked":
      return t("panel.sessionPlanWorkflowStatusBlocked", {}, "Failed");
    case "completed":
      return t("panel.sessionPlanWorkflowStatusCompleted", {}, "Completed");
    default:
      return t("panel.sessionPlanWorkflowStatusUnknown", {}, "Unknown");
  }
}

function buildWorkflowStatusText(workflowState, t) {
  if (!workflowState || typeof workflowState !== "object") return "";
  if (workflowState.missing === true) {
    return t("panel.sessionPlanWorkflowMissing", {}, "Workflow run is not active.");
  }
  if (workflowState.errorMessage) {
    return workflowState.errorMessage;
  }
  const statusText = formatWorkflowStatus(workflowState.status, t);
  const workflowName = typeof workflowState.workflowName === "string" && workflowState.workflowName.trim()
    ? workflowState.workflowName.trim()
    : "";
  if (workflowName) {
    return t(
      "panel.sessionPlanWorkflowStatusLine",
      { workflow: workflowName, status: statusText },
      `${workflowName} · ${statusText}`,
    );
  }
  return statusText;
}

export function createPlanPanelFeature({
  refs,
  isConnected,
  getActiveConversationId,
  onOpenPlanAction,
  onLoadWorkflowStatus,
  escapeHtml,
  formatDateTime,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const {
    sessionPlanPanelEl,
    sessionPlanSummaryEl,
    sessionPlanModalEl,
    sessionPlanModalTitleEl,
    sessionPlanModalMetaEl,
    sessionPlanModalContentEl,
    sessionPlanModalCloseBtn,
  } = refs;

  const state = {
    conversationId: null,
    planState: null,
    modalOpen: false,
    lastSource: "",
    focusedStepId: "",
    focusedRefKey: "",
    workflowStatusByJournalId: {},
  };
  const taskScope = createPanelTaskScope();

  function addOwnedListener(target, type, handler) {
    taskScope.addEventListener(target, type, handler);
  }

  function hasRenderablePlan() {
    return Boolean(
      taskScope.isActive()
      && isConnected()
      && getActiveConversationId()
      && state.planState
      && typeof state.planState === "object",
    );
  }

  function syncVisibility() {
    if (!taskScope.isActive()) return false;
    const visible = hasRenderablePlan();
    sessionPlanPanelEl?.classList.toggle("hidden", !visible);
    if (!visible) {
      state.modalOpen = false;
    }
    return visible;
  }

  function closeModal() {
    if (!taskScope.isActive()) return;
    state.modalOpen = false;
    renderModal();
  }

  function openModal() {
    if (!taskScope.isActive()) return;
    if (!hasRenderablePlan()) return;
    state.modalOpen = true;
    renderModal();
  }

  function renderModal() {
    if (!taskScope.isActive() || !sessionPlanModalEl) return;
    const visible = syncVisibility();
    const shouldOpen = visible && state.modalOpen;
    sessionPlanModalEl.classList.toggle("hidden", !shouldOpen);
    if (!shouldOpen) {
      if (!visible) sessionPlanModalContentEl?.replaceChildren();
      return;
    }

    const planState = state.planState;
    const currentStep = resolveCurrentStep(planState);
    const completedSteps = countCompletedSteps(planState);
    const totalSteps = Array.isArray(planState?.steps) ? planState.steps.length : 0;
    const metaParts = [
      formatPlanStatus(planState?.status, t),
      formatPlanMode(planState?.mode, t),
      t(
        "panel.sessionPlanProgress",
        { completed: String(completedSteps), total: String(totalSteps) },
        `Steps ${completedSteps}/${totalSteps}`,
      ),
      t("panel.sessionPlanRevision", { revision: String(planState?.revision || 0) }, `r${planState?.revision || 0}`),
      t(
        "panel.sessionPlanUpdatedBy",
        { actor: formatPlanUpdatedBy(planState?.updatedBy, t) },
        `Updated by ${formatPlanUpdatedBy(planState?.updatedBy, t)}`,
      ),
      t(
        "panel.sessionPlanUpdatedAt",
        { time: formatDateTime(planState?.updatedAt) },
        `Updated ${formatDateTime(planState?.updatedAt)}`,
      ),
    ];
    if (state.lastSource) {
      metaParts.push(t("panel.sessionPlanSource", { source: state.lastSource }, `Source: ${state.lastSource}`));
    }

    if (sessionPlanModalTitleEl) {
      sessionPlanModalTitleEl.textContent = t("panel.sessionPlanTitle", {}, "Current Plan");
    }
    if (sessionPlanModalMetaEl) {
      sessionPlanModalMetaEl.textContent = metaParts.join(" · ");
    }
    if (sessionPlanModalCloseBtn) {
      const closeText = t("panel.sessionPlanClose", {}, "Close");
      sessionPlanModalCloseBtn.title = closeText;
      sessionPlanModalCloseBtn.setAttribute("aria-label", closeText);
    }
    if (sessionPlanModalContentEl) {
      const ownerDocument = sessionPlanModalContentEl.ownerDocument ?? document;
      sessionPlanModalContentEl.replaceChildren(createPlanModalContent({
        ownerDocument,
        planState,
        currentStep,
        completedSteps,
        totalSteps,
        focusedStepId: state.focusedStepId,
        focusedRefKey: state.focusedRefKey,
        workflowStatusByJournalId: state.workflowStatusByJournalId,
        formatDateTime,
        t,
      }));
    }
  }

  function render() {
    if (!taskScope.isActive() || !sessionPlanSummaryEl) return;
    const visible = syncVisibility();
    if (!visible) {
      sessionPlanSummaryEl.replaceChildren();
      renderModal();
      return;
    }

    const planState = state.planState;
    const currentStep = resolveCurrentStep(planState);
    const completedSteps = countCompletedSteps(planState);
    const totalSteps = Array.isArray(planState?.steps) ? planState.steps.length : 0;
    const updatedAt = t(
      "panel.sessionPlanUpdatedAt",
      { time: formatDateTime(planState?.updatedAt) },
      `Updated ${formatDateTime(planState?.updatedAt)}`,
    );
    const updatedBy = t(
      "panel.sessionPlanUpdatedBy",
      { actor: formatPlanUpdatedBy(planState?.updatedBy, t) },
      `Updated by ${formatPlanUpdatedBy(planState?.updatedBy, t)}`,
    );
    const summaryText = buildSummaryText(planState, t);
    const openTitle = t("panel.sessionPlanOpenFull", {}, "Click to view the full plan");

    const ownerDocument = sessionPlanSummaryEl.ownerDocument ?? document;
    const card = ownerDocument.createElement("div");
    card.className = "session-plan-card is-interactive";
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.title = String(openTitle ?? "");
    card.setAttribute("aria-label", String(openTitle ?? ""));

    const head = ownerDocument.createElement("div");
    head.className = "session-plan-card-head";
    const titleRow = ownerDocument.createElement("div");
    titleRow.className = "session-plan-title-row";
    const title = createPlanTextElement(
      ownerDocument,
      "div",
      "session-plan-title",
      planState?.title || t("panel.sessionPlanTitle", {}, "Current Plan"),
    );
    const badges = ownerDocument.createElement("div");
    badges.className = "session-plan-badges";
    badges.append(
      createPlanBadgeElement(
        ownerDocument,
        formatPlanStatus(planState?.status, t),
        buildBadgeClassNames(planState?.status),
      ),
      createPlanBadgeElement(ownerDocument, formatPlanMode(planState?.mode, t)),
      createPlanBadgeElement(
        ownerDocument,
        t(
          "panel.sessionPlanProgress",
          { completed: String(completedSteps), total: String(totalSteps) },
          `Steps ${completedSteps}/${totalSteps}`,
        ),
      ),
      ...(currentStep
        ? [createPlanBadgeElement(
            ownerDocument,
            t("panel.sessionPlanStepCurrent", {}, "Current"),
            "memory-badge-private",
          )]
        : []),
    );
    titleRow.append(title, badges);

    const meta = ownerDocument.createElement("div");
    meta.className = "session-plan-meta";
    meta.append(
      createPlanTextElement(
        ownerDocument,
        "span",
        "",
        t(
          "panel.sessionPlanRevision",
          { revision: String(planState?.revision || 0) },
          `r${planState?.revision || 0}`,
        ),
      ),
      createPlanTextElement(ownerDocument, "span", "", updatedBy),
      createPlanTextElement(ownerDocument, "span", "", updatedAt),
    );
    head.append(titleRow, meta);
    const summary = createPlanTextElement(
      ownerDocument,
      "div",
      "session-plan-summary-text",
      summaryText,
    );
    card.append(head, summary);
    sessionPlanSummaryEl.replaceChildren(card);
    renderModal();
  }

  function clear() {
    if (!taskScope.isActive()) return;
    taskScope.invalidateTasks();
    state.conversationId = null;
    state.planState = null;
    state.modalOpen = false;
    state.lastSource = "";
    state.focusedStepId = "";
    state.focusedRefKey = "";
    state.workflowStatusByJournalId = {};
    render();
  }

  function setPlanState(planState, options = {}) {
    if (!taskScope.isActive()) return;
    const activeConversationId = getActiveConversationId();
    const conversationId = typeof options?.conversationId === "string"
      ? options.conversationId
      : activeConversationId || "";
    if (conversationId && activeConversationId && conversationId !== activeConversationId) {
      return;
    }
    state.conversationId = conversationId || null;
    state.planState = planState && typeof planState === "object" && !Array.isArray(planState)
      ? planState
      : null;
    state.lastSource = typeof options?.source === "string" ? options.source : "";
    if (!state.planState) {
      taskScope.invalidateTasks();
      state.modalOpen = false;
      state.focusedStepId = "";
      state.focusedRefKey = "";
      state.workflowStatusByJournalId = {};
    } else if (!state.focusedStepId && state.planState.currentStepId) {
      state.focusedStepId = state.planState.currentStepId;
    }
    render();
  }

  function setFocusedStep(stepId) {
    if (!taskScope.isActive()) return;
    state.focusedStepId = typeof stepId === "string" ? stepId.trim() : "";
    if (state.focusedStepId) {
      state.focusedRefKey = "";
    }
    renderModal();
  }

  function setFocusedRef(refKey) {
    if (!taskScope.isActive()) return;
    state.focusedRefKey = typeof refKey === "string" ? refKey.trim() : "";
    renderModal();
  }

  async function loadWorkflowStatus(journalId) {
    if (!taskScope.isActive()) return;
    const normalizedJournalId = typeof journalId === "string" ? journalId.trim() : "";
    if (!normalizedJournalId) return;
    if (typeof onLoadWorkflowStatus !== "function") return;
    const requestTask = taskScope.beginTask();
    if (!requestTask) return;
    try {
      const workflowState = await onLoadWorkflowStatus({ journalId: normalizedJournalId });
      // 底层 Promise 无法取消时，只允许当前激活代次的最新读取提交 workflow 正文。
      if (!requestTask.isCurrent()) return;
      state.workflowStatusByJournalId = {
        ...state.workflowStatusByJournalId,
        [normalizedJournalId]: workflowState && typeof workflowState === "object"
          ? workflowState
          : {
            status: "",
            missing: true,
          },
      };
      renderModal();
    } finally {
      requestTask.settle();
    }
  }

  async function handlePlanAction(action) {
    if (!taskScope.isActive()) return;
    const kind = typeof action?.kind === "string" ? action.kind : "";
    if (!kind) return;
    if (kind === "step") {
      setFocusedStep(action.stepId);
      return;
    }
    if (kind === "workflow") {
      setFocusedRef(typeof action?.refKey === "string" ? action.refKey : "");
      if (typeof action?.journalId === "string" && action.journalId.trim()) {
        await loadWorkflowStatus(action.journalId);
      }
      return;
    }
    if (kind === "continuation") {
      setFocusedRef(typeof action?.refKey === "string" ? action.refKey : "");
      if (typeof onOpenPlanAction === "function" && action.action && typeof action.action === "object") {
        await onOpenPlanAction(action.action);
      }
    }
  }

  function handlePlanUpdated(payload) {
    if (!taskScope.isActive()) return;
    const conversationId = typeof payload?.conversationId === "string" ? payload.conversationId : "";
    if (!conversationId || conversationId !== getActiveConversationId()) return;
    setPlanState(payload?.cleared === true ? null : payload?.planState || null, {
      conversationId,
      source: typeof payload?.source === "string" ? payload.source : "event",
    });
  }

  function handleSummaryClick(event) {
    if (!taskScope.isActive()) return;
    const trigger = event.target instanceof Element ? event.target.closest(".session-plan-card.is-interactive") : null;
    if (!trigger) return;
    openModal();
  }

  function handleSummaryKeydown(event) {
    if (!taskScope.isActive()) return;
    const trigger = event.target instanceof Element ? event.target.closest(".session-plan-card.is-interactive") : null;
    if (!trigger || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    openModal();
  }

  function handleModalCloseClick() {
    closeModal();
  }

  function handleModalClick(event) {
    if (!taskScope.isActive()) return;
    const trigger = event.target instanceof Element ? event.target.closest("[data-plan-action]") : null;
    if (trigger) {
      const action = parsePlanAction(trigger.getAttribute("data-plan-action") || "");
      if (action) {
        void handlePlanAction(action);
      }
      return;
    }
    if (event.target === sessionPlanModalEl) {
      closeModal();
    }
  }

  function handleDocumentKeydown(event) {
    if (!taskScope.isActive() || event.key !== "Escape" || !state.modalOpen) return;
    closeModal();
  }

  function activate() {
    if (!taskScope.activate()) return false;
    addOwnedListener(sessionPlanSummaryEl, "click", handleSummaryClick);
    addOwnedListener(sessionPlanSummaryEl, "keydown", handleSummaryKeydown);
    addOwnedListener(sessionPlanModalCloseBtn, "click", handleModalCloseClick);
    addOwnedListener(sessionPlanModalEl, "click", handleModalClick);
    addOwnedListener(document, "keydown", handleDocumentKeydown);
    render();
    return true;
  }

  function deactivate() {
    if (!taskScope.deactivate()) return false;
    state.conversationId = null;
    state.planState = null;
    state.modalOpen = false;
    state.lastSource = "";
    state.focusedStepId = "";
    state.focusedRefKey = "";
    state.workflowStatusByJournalId = {};
    sessionPlanPanelEl?.classList.add("hidden");
    sessionPlanSummaryEl?.replaceChildren();
    sessionPlanModalEl?.classList.add("hidden");
    sessionPlanModalTitleEl?.replaceChildren();
    sessionPlanModalMetaEl?.replaceChildren();
    sessionPlanModalContentEl?.replaceChildren();
    return true;
  }

  function dispose() {
    if (taskScope.getRuntimeSnapshot().disposed) return false;
    deactivate();
    return taskScope.dispose();
  }

  function getRuntimeSnapshot() {
    const snapshot = taskScope.getRuntimeSnapshot();
    return {
      listenerCount: snapshot.listenerCount,
      pendingWorkflowStatusRequestCount: snapshot.pendingTaskCount,
      modalOpen: state.modalOpen,
      disposed: snapshot.disposed,
    };
  }

  activate();

  return {
    activate,
    clear,
    deactivate,
    dispose,
    getRuntimeSnapshot,
    handlePlanUpdated,
    refreshLocale() {
      if (!taskScope.isActive()) return;
      render();
    },
    setPlanState,
    setFocusedRef,
    setFocusedStep,
  };
}
