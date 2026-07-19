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
  let disposed = false;
  const listenerEntries = [];

  function addOwnedListener(target, type, handler) {
    if (!target) return;
    target.addEventListener(type, handler);
    listenerEntries.push({ target, type, handler });
  }

  function hasRenderablePlan() {
    return Boolean(
      !disposed
      && isConnected()
      && getActiveConversationId()
      && state.planState
      && typeof state.planState === "object",
    );
  }

  function syncVisibility() {
    if (disposed) return false;
    const visible = hasRenderablePlan();
    sessionPlanPanelEl?.classList.toggle("hidden", !visible);
    if (!visible) {
      state.modalOpen = false;
    }
    return visible;
  }

  function closeModal() {
    if (disposed) return;
    state.modalOpen = false;
    renderModal();
  }

  function openModal() {
    if (disposed) return;
    if (!hasRenderablePlan()) return;
    state.modalOpen = true;
    renderModal();
  }

  function renderModal() {
    if (disposed || !sessionPlanModalEl) return;
    const visible = syncVisibility();
    const shouldOpen = visible && state.modalOpen;
    sessionPlanModalEl.classList.toggle("hidden", !shouldOpen);
    if (!shouldOpen) return;

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
      const stepsMarkup = Array.isArray(planState?.steps) && planState.steps.length > 0
        ? planState.steps.map((step) => {
          const isCurrent = Boolean(currentStep?.id && currentStep.id === step?.id);
          const isFocused = Boolean(step?.id && state.focusedStepId === step.id);
          const stepAction = buildStepAction(step);
          const refsMarkup = Array.isArray(step?.refs) && step.refs.length > 0
            ? `
              <div class="session-plan-step-refs">
                ${step.refs
                  .map((ref) => {
                    const label = buildPlanRefLabel(ref, t);
                    if (!label) return "";
                    const action = buildRefAction(ref);
                    const focusKey = buildRefFocusKey(ref);
                    const journalId = typeof ref?.journalId === "string" ? ref.journalId.trim() : "";
                    const workflowState = ref?.kind === "workflow"
                      ? state.workflowStatusByJournalId?.[journalId]
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
                      focusKey && state.focusedRefKey === focusKey ? "is-continuation-focus" : "",
                      workflowStatusClass ? `is-workflow-${workflowStatusClass}` : "",
                    ].filter(Boolean).join(" ");
                    const title = workflowStatus || label;
                    const badgeMarkup = !action
                      ? `<span class="${classNames}" title="${escapeAttribute(title)}">${escapeHtml(label)}</span>`
                      : `
                        <button
                          type="button"
                          class="${classNames}"
                          data-plan-action="${escapeAttribute(action)}"
                          title="${escapeAttribute(title)}"
                          aria-label="${escapeAttribute(title)}"
                        >${escapeHtml(label)}</button>
                      `;
                    const statusMarkup = workflowStatus
                      ? `<span class="session-plan-ref-status">${escapeHtml(workflowStatus)}</span>`
                      : "";
                    return `
                      <span class="session-plan-ref-entry">
                        ${badgeMarkup}
                        ${statusMarkup}
                      </span>
                    `;
                  })
                  .join("")}
              </div>
            `
            : "";
          return `
            <div class="session-plan-step-item${isCurrent ? " is-current" : ""}${step?.status === "blocked" ? " is-blocked" : ""}${isFocused ? " is-continuation-focus" : ""}" data-plan-step-id="${escapeAttribute(step?.id || "")}">
              <div class="session-plan-step-head">
                <div class="session-plan-step-title-row">
                  <span class="memory-badge ${buildBadgeClassNames(step?.status)}">${escapeHtml(formatPlanStepStatus(step?.status, t))}</span>
                  ${isCurrent ? `<span class="memory-badge memory-badge-private">${escapeHtml(t("panel.sessionPlanStepCurrent", {}, "Current"))}</span>` : ""}
                  ${stepAction
                    ? `
                      <button
                        type="button"
                        class="session-plan-step-title session-plan-step-action"
                        data-plan-action="${escapeAttribute(stepAction)}"
                        title="${escapeAttribute(step?.title || "-")}"
                        aria-label="${escapeAttribute(step?.title || "-")}"
                      >${escapeHtml(step?.title || "-")}</button>
                    `
                    : `<span class="session-plan-step-title">${escapeHtml(step?.title || "-")}</span>`}
                </div>
                <span class="session-plan-step-time">${escapeHtml(formatDateTime(step?.updatedAt))}</span>
              </div>
              ${step?.summary ? `<div class="session-plan-step-summary">${escapeHtml(step.summary)}</div>` : ""}
              ${step?.blocker ? `<div class="session-plan-step-blocker">${escapeHtml(t("panel.sessionPlanBlockerLabel", {}, "Blocker"))}: ${escapeHtml(step.blocker)}</div>` : ""}
              ${refsMarkup}
            </div>
          `;
        }).join("")
        : `<div class="session-plan-empty">${escapeHtml(t("panel.sessionPlanEmptySteps", {}, "No steps in the current plan yet."))}</div>`;

      sessionPlanModalContentEl.innerHTML = `
        <div class="session-plan-modal-summary">
          <div class="session-plan-modal-plan-title">${escapeHtml(planState?.title || t("panel.sessionPlanTitle", {}, "Current Plan"))}</div>
          ${planState?.summary ? `<div class="session-plan-modal-plan-summary">${escapeHtml(planState.summary)}</div>` : ""}
          <div class="session-plan-modal-chip-row">
            <span class="memory-badge ${buildBadgeClassNames(planState?.status)}">${escapeHtml(formatPlanStatus(planState?.status, t))}</span>
            <span class="memory-badge">${escapeHtml(formatPlanMode(planState?.mode, t))}</span>
            <span class="memory-badge">${escapeHtml(t("panel.sessionPlanRevision", { revision: String(planState?.revision || 0) }, `r${planState?.revision || 0}`))}</span>
          </div>
        </div>
        <div class="session-plan-modal-grid">
          <div class="session-plan-modal-card">
            <span class="session-plan-modal-card-label">${escapeHtml(t("panel.sessionPlanCurrentStepLabel", {}, "Current Step"))}</span>
            <div class="session-plan-modal-card-value">${escapeHtml(currentStep?.title || "-")}</div>
          </div>
          <div class="session-plan-modal-card">
            <span class="session-plan-modal-card-label">${escapeHtml(t("panel.sessionPlanNextActionLabel", {}, "Next Action"))}</span>
            <div class="session-plan-modal-card-value">${escapeHtml(planState?.nextAction || "-")}</div>
          </div>
          <div class="session-plan-modal-card">
            <span class="session-plan-modal-card-label">${escapeHtml(t("panel.sessionPlanBlockerLabel", {}, "Blocker"))}</span>
            <div class="session-plan-modal-card-value">${escapeHtml(planState?.blocker || currentStep?.blocker || "-")}</div>
          </div>
        </div>
        <section class="session-plan-modal-section">
          <div class="session-plan-modal-section-head">
            <div class="session-plan-modal-section-title">${escapeHtml(t("panel.sessionPlanStepListLabel", {}, "Steps"))}</div>
            <div class="session-plan-modal-chip-row">
              <span class="memory-badge">${escapeHtml(t("panel.sessionPlanProgress", { completed: String(completedSteps), total: String(totalSteps) }, `Steps ${completedSteps}/${totalSteps}`))}</span>
            </div>
          </div>
          <div class="session-plan-step-list">${stepsMarkup}</div>
        </section>
      `;
    }
  }

  function render() {
    if (disposed || !sessionPlanSummaryEl) return;
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

    sessionPlanSummaryEl.innerHTML = `
      <div class="session-plan-card is-interactive" role="button" tabindex="0" title="${escapeHtml(openTitle)}" aria-label="${escapeHtml(openTitle)}">
        <div class="session-plan-card-head">
          <div class="session-plan-title-row">
            <div class="session-plan-title">${escapeHtml(planState?.title || t("panel.sessionPlanTitle", {}, "Current Plan"))}</div>
            <div class="session-plan-badges">
              <span class="memory-badge ${buildBadgeClassNames(planState?.status)}">${escapeHtml(formatPlanStatus(planState?.status, t))}</span>
              <span class="memory-badge">${escapeHtml(formatPlanMode(planState?.mode, t))}</span>
              <span class="memory-badge">${escapeHtml(t("panel.sessionPlanProgress", { completed: String(completedSteps), total: String(totalSteps) }, `Steps ${completedSteps}/${totalSteps}`))}</span>
              ${currentStep ? `<span class="memory-badge memory-badge-private">${escapeHtml(t("panel.sessionPlanStepCurrent", {}, "Current"))}</span>` : ""}
            </div>
          </div>
          <div class="session-plan-meta">
            <span>${escapeHtml(t("panel.sessionPlanRevision", { revision: String(planState?.revision || 0) }, `r${planState?.revision || 0}`))}</span>
            <span>${escapeHtml(updatedBy)}</span>
            <span>${escapeHtml(updatedAt)}</span>
          </div>
        </div>
        <div class="session-plan-summary-text">${escapeHtml(summaryText)}</div>
      </div>
    `;
    renderModal();
  }

  function clear() {
    if (disposed) return;
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
    if (disposed) return;
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
    if (disposed) return;
    state.focusedStepId = typeof stepId === "string" ? stepId.trim() : "";
    if (state.focusedStepId) {
      state.focusedRefKey = "";
    }
    renderModal();
  }

  function setFocusedRef(refKey) {
    if (disposed) return;
    state.focusedRefKey = typeof refKey === "string" ? refKey.trim() : "";
    renderModal();
  }

  async function loadWorkflowStatus(journalId) {
    if (disposed) return;
    const normalizedJournalId = typeof journalId === "string" ? journalId.trim() : "";
    if (!normalizedJournalId) return;
    if (typeof onLoadWorkflowStatus !== "function") return;
    const workflowState = await onLoadWorkflowStatus({ journalId: normalizedJournalId });
    // 底层 Promise 无法取消时，退出后的结果也不能重新持有 workflow 正文或触发渲染。
    if (disposed) return;
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
  }

  async function handlePlanAction(action) {
    if (disposed) return;
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
    if (disposed) return;
    const conversationId = typeof payload?.conversationId === "string" ? payload.conversationId : "";
    if (!conversationId || conversationId !== getActiveConversationId()) return;
    setPlanState(payload?.cleared === true ? null : payload?.planState || null, {
      conversationId,
      source: typeof payload?.source === "string" ? payload.source : "event",
    });
  }

  function handleSummaryClick(event) {
    if (disposed) return;
    const trigger = event.target instanceof Element ? event.target.closest(".session-plan-card.is-interactive") : null;
    if (!trigger) return;
    openModal();
  }

  function handleSummaryKeydown(event) {
    if (disposed) return;
    const trigger = event.target instanceof Element ? event.target.closest(".session-plan-card.is-interactive") : null;
    if (!trigger || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    openModal();
  }

  function handleModalCloseClick() {
    closeModal();
  }

  function handleModalClick(event) {
    if (disposed) return;
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
    if (disposed || event.key !== "Escape" || !state.modalOpen) return;
    closeModal();
  }

  addOwnedListener(sessionPlanSummaryEl, "click", handleSummaryClick);
  addOwnedListener(sessionPlanSummaryEl, "keydown", handleSummaryKeydown);
  addOwnedListener(sessionPlanModalCloseBtn, "click", handleModalCloseClick);
  addOwnedListener(sessionPlanModalEl, "click", handleModalClick);
  addOwnedListener(document, "keydown", handleDocumentKeydown);

  function dispose() {
    if (disposed) return;
    disposed = true;
    state.conversationId = null;
    state.planState = null;
    state.modalOpen = false;
    state.lastSource = "";
    state.focusedStepId = "";
    state.focusedRefKey = "";
    state.workflowStatusByJournalId = {};
    for (const { target, type, handler } of listenerEntries) {
      target.removeEventListener(type, handler);
    }
    listenerEntries.length = 0;
    sessionPlanPanelEl?.classList.add("hidden");
    sessionPlanSummaryEl?.replaceChildren();
    sessionPlanModalEl?.classList.add("hidden");
    sessionPlanModalTitleEl?.replaceChildren();
    sessionPlanModalMetaEl?.replaceChildren();
    sessionPlanModalContentEl?.replaceChildren();
  }

  function getRuntimeSnapshot() {
    return {
      listenerCount: listenerEntries.length,
      modalOpen: state.modalOpen,
      disposed,
    };
  }

  render();

  return {
    clear,
    dispose,
    getRuntimeSnapshot,
    handlePlanUpdated,
    refreshLocale() {
      if (disposed) return;
      render();
    },
    setPlanState,
    setFocusedRef,
    setFocusedStep,
  };
}
