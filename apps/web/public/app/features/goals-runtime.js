function getGoalCheckpointActionConfig(action) {
  const actionMap = {
    approve: {
      method: "goal.checkpoint.approve",
      modalTitleKey: "goals.checkpointApproveTitle",
      modalTitleFallback: "Approve Checkpoint",
      successTitleKey: "goals.checkpointApproveSuccessTitle",
      successTitleFallback: "Checkpoint approved",
      submitLabelKey: "goals.checkpointApproveSubmit",
      submitLabelFallback: "Approve",
      defaultSummaryKey: "goals.checkpointApproveSummary",
      defaultSummaryFallback: "Approved",
      actorLabelKey: "goals.checkpointApproveActorLabel",
      actorLabelFallback: "Reviewer",
      noteLabelKey: "goals.checkpointApproveNoteLabel",
      noteLabelFallback: "Approval Note",
      notePlaceholderKey: "goals.checkpointApproveNotePlaceholder",
      notePlaceholderFallback: "Optional, for example: verification passed and the next node can start",
      noteHelpKey: "goals.checkpointApproveNoteHelp",
      noteHelpFallback: "Optional. Record the approval basis, verification result, or extra notes.",
      noteRequired: false,
      hintKey: "goals.checkpointApproveHint",
      hintFallback: "Approving advances the checkpoint to the next state and writes the summary into the progress timeline.",
    },
    reject: {
      method: "goal.checkpoint.reject",
      modalTitleKey: "goals.checkpointRejectTitle",
      modalTitleFallback: "Reject Checkpoint",
      successTitleKey: "goals.checkpointRejectSuccessTitle",
      successTitleFallback: "Checkpoint rejected",
      submitLabelKey: "goals.checkpointRejectSubmit",
      submitLabelFallback: "Reject",
      defaultSummaryKey: "goals.checkpointRejectSummary",
      defaultSummaryFallback: "Rejected",
      actorLabelKey: "goals.checkpointRejectActorLabel",
      actorLabelFallback: "Reviewer",
      noteLabelKey: "goals.checkpointRejectNoteLabel",
      noteLabelFallback: "Rejection Reason",
      notePlaceholderKey: "goals.checkpointRejectNotePlaceholder",
      notePlaceholderFallback: "Required, for example: more changes are needed before resubmission",
      noteHelpKey: "goals.checkpointRejectNoteHelp",
      noteHelpFallback: "Required. Rejection must include a clear reason instead of only a status change.",
      noteRequired: true,
      hintKey: "goals.checkpointRejectHint",
      hintFallback: "Rejecting keeps the checkpoint record and gives future recovery actions a clear rationale.",
    },
    expire: {
      method: "goal.checkpoint.expire",
      modalTitleKey: "goals.checkpointExpireTitle",
      modalTitleFallback: "Mark Checkpoint Expired",
      successTitleKey: "goals.checkpointExpireSuccessTitle",
      successTitleFallback: "Checkpoint marked expired",
      submitLabelKey: "goals.checkpointExpireSubmit",
      submitLabelFallback: "Mark Expired",
      defaultSummaryKey: "goals.checkpointExpireSummary",
      defaultSummaryFallback: "Expired",
      actorLabelKey: "goals.checkpointExpireActorLabel",
      actorLabelFallback: "Operator",
      noteLabelKey: "goals.checkpointExpireNoteLabel",
      noteLabelFallback: "Expiration Reason",
      notePlaceholderKey: "goals.checkpointExpireNotePlaceholder",
      notePlaceholderFallback: "Required, for example: review timed out and needs to be requested again",
      noteHelpKey: "goals.checkpointExpireNoteHelp",
      noteHelpFallback: "Required. Explain why the current checkpoint should be invalidated.",
      noteRequired: true,
      hintKey: "goals.checkpointExpireHint",
      hintFallback: "Expiration fits review timeouts, stale context, or artifacts replaced by a newer version.",
    },
    reopen: {
      method: "goal.checkpoint.reopen",
      modalTitleKey: "goals.checkpointReopenTitle",
      modalTitleFallback: "Reopen Checkpoint",
      successTitleKey: "goals.checkpointReopenSuccessTitle",
      successTitleFallback: "Checkpoint reopened",
      submitLabelKey: "goals.checkpointReopenSubmit",
      submitLabelFallback: "Reopen",
      defaultSummaryKey: "goals.checkpointReopenSummary",
      defaultSummaryFallback: "Reopened",
      actorLabelKey: "goals.checkpointReopenActorLabel",
      actorLabelFallback: "Requester",
      noteLabelKey: "goals.checkpointReopenNoteLabel",
      noteLabelFallback: "Reopen Note",
      notePlaceholderKey: "goals.checkpointReopenNotePlaceholder",
      notePlaceholderFallback: "Required, for example: supplemental changes are complete and review can restart",
      noteHelpKey: "goals.checkpointReopenNoteHelp",
      noteHelpFallback: "Required. Explain why the checkpoint is reopened and what should happen next.",
      noteRequired: true,
      hintKey: "goals.checkpointReopenHint",
      hintFallback: "Reopening returns the checkpoint to an actionable state while preserving history.",
    },
  };
  return actionMap[action] || null;
}

function formatDateTimeLocalValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (input) => String(input).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseDateTimeLocalValue(value) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function createGoalsRuntimeFeature({
  refs,
  isConnected,
  sendReq,
  makeId,
  getGoalsState,
  getGoalsOverviewFeature,
  getGoalsDetailFeature,
  getGoalById,
  loadGoals,
  showNotice,
  formatDateTime,
  escapeHtml,
  onResumeGoal,
  onPauseGoal,
  onArchiveGoal,
  onDeleteGoal,
  onOpenSourcePath,
  onOpenTask,
  onOpenGoalTaskViewer,
  onOpenGoalBoard,
  onOpenGoalBoardList,
  onGenerateGoalHandoff,
  onLoadGoalReviewGovernanceData,
  onLoadGoalTrackingData,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const {
    goalsSection,
    goalsDetailEl,
    goalCheckpointActionModal,
    goalCheckpointActionTitleEl,
    goalCheckpointActionHintEl,
    goalCheckpointActionContextEl,
    goalCheckpointActionReviewerEl,
    goalCheckpointActionReviewerRoleEl,
    goalCheckpointActionRequestedByEl,
    goalCheckpointActionActorLabelEl,
    goalCheckpointActionActorEl,
    goalCheckpointActionSlaAtEl,
    goalCheckpointActionSummaryEl,
    goalCheckpointActionNoteLabelEl,
    goalCheckpointActionNoteHelpEl,
    goalCheckpointActionNoteEl,
    goalCheckpointActionCloseBtn,
    goalCheckpointActionCancelBtn,
    goalCheckpointActionSubmitBtn,
  } = refs;

  let pendingGoalCheckpointAction = null;

  function renderGoalsLoading(message) {
    getGoalsOverviewFeature?.()?.renderGoalsLoading(message);
  }

  function renderGoalsSummary(items) {
    getGoalsOverviewFeature?.()?.renderGoalsSummary(items);
  }

  function renderGoalsEmpty(message) {
    getGoalsOverviewFeature?.()?.renderGoalsEmpty(message);
  }

  function renderGoalList(items) {
    getGoalsOverviewFeature?.()?.renderGoalList(items);
  }

  function renderGoalDetail(goal) {
    return getGoalsDetailFeature?.()?.renderGoalDetail(goal);
  }

  function refreshGoalsLocale() {
    if (!goalsSection) return;
    if (!isConnected()) {
      renderGoalsLoading(t("goals.loadingDisconnected", {}, "Disconnected"));
      return;
    }
    const goalsState = getGoalsState();
    if (Array.isArray(goalsState.items) && goalsState.items.length) {
      renderGoalsSummary(goalsState.items);
      renderGoalList(goalsState.items);
      renderGoalDetail(getGoalById(goalsState.selectedId));
      return;
    }
    if (goalsState.loadSeq > 0) {
      renderGoalsLoading(t("goals.loading", {}, "Loading..."));
    }
  }

  function resetGoalCheckpointActionForm() {
    if (goalCheckpointActionTitleEl) goalCheckpointActionTitleEl.textContent = t("goals.checkpointActionModalTitle", {}, "Checkpoint Action");
    if (goalCheckpointActionHintEl) {
      goalCheckpointActionHintEl.textContent = t("goals.checkpointActionHint", {}, "Complete checkpoint review or state transitions here instead of using temporary prompts.");
    }
    if (goalCheckpointActionContextEl) goalCheckpointActionContextEl.innerHTML = "";
    if (goalCheckpointActionReviewerEl) goalCheckpointActionReviewerEl.value = "";
    if (goalCheckpointActionReviewerRoleEl) goalCheckpointActionReviewerRoleEl.value = "";
    if (goalCheckpointActionRequestedByEl) goalCheckpointActionRequestedByEl.value = "";
    if (goalCheckpointActionActorLabelEl) goalCheckpointActionActorLabelEl.textContent = t("goals.checkpointActionActorLabel", {}, "Reviewer");
    if (goalCheckpointActionActorEl) goalCheckpointActionActorEl.value = "";
    if (goalCheckpointActionSlaAtEl) goalCheckpointActionSlaAtEl.value = "";
    if (goalCheckpointActionSummaryEl) {
      goalCheckpointActionSummaryEl.value = "";
      goalCheckpointActionSummaryEl.placeholder = t("goals.checkpointActionSummaryPlaceholder", {}, "For example: approved / rejected / expired / reopened");
    }
    if (goalCheckpointActionNoteLabelEl) goalCheckpointActionNoteLabelEl.textContent = t("goals.checkpointActionNoteLabel", {}, "Note");
    if (goalCheckpointActionNoteHelpEl) {
      goalCheckpointActionNoteHelpEl.textContent = t("goals.checkpointActionNoteHelp", {}, "Some actions require a reason so the status is not left without context.");
    }
    if (goalCheckpointActionNoteEl) {
      goalCheckpointActionNoteEl.value = "";
      goalCheckpointActionNoteEl.placeholder = t("goals.checkpointActionNotePlaceholder", {}, "Add review notes, expiration reasons, or reopen details");
    }
  }

  function setGoalCheckpointActionBusy(busy) {
    const config = pendingGoalCheckpointAction
      ? getGoalCheckpointActionConfig(pendingGoalCheckpointAction.action)
      : null;
    const submitLabel = config
      ? t(config.submitLabelKey, {}, config.submitLabelFallback)
      : t("common.submit", {}, "Submit");
    if (goalCheckpointActionCloseBtn) goalCheckpointActionCloseBtn.disabled = busy;
    if (goalCheckpointActionCancelBtn) goalCheckpointActionCancelBtn.disabled = busy;
    if (goalCheckpointActionSubmitBtn) {
      goalCheckpointActionSubmitBtn.disabled = busy;
      goalCheckpointActionSubmitBtn.textContent = busy
        ? t("goals.checkpointActionSubmitting", { label: submitLabel }, `${submitLabel}...`)
        : submitLabel;
    }
    if (goalCheckpointActionReviewerEl) goalCheckpointActionReviewerEl.disabled = busy;
    if (goalCheckpointActionReviewerRoleEl) goalCheckpointActionReviewerRoleEl.disabled = busy;
    if (goalCheckpointActionRequestedByEl) goalCheckpointActionRequestedByEl.disabled = busy;
    if (goalCheckpointActionActorEl) goalCheckpointActionActorEl.disabled = busy;
    if (goalCheckpointActionSlaAtEl) goalCheckpointActionSlaAtEl.disabled = busy;
    if (goalCheckpointActionSummaryEl) goalCheckpointActionSummaryEl.disabled = busy;
    if (goalCheckpointActionNoteEl) goalCheckpointActionNoteEl.disabled = busy;
  }

  function findTrackedGoalCheckpoint(goalId, checkpointId) {
    if (!goalId || !checkpointId) return null;
    const goalsState = getGoalsState();
    return goalsState.trackingCheckpoints.find((item) => item.goalId === goalId && item.id === checkpointId) || null;
  }

  function renderGoalCheckpointActionContext(context) {
    if (!goalCheckpointActionContextEl || !context) return;
    goalCheckpointActionContextEl.innerHTML = `
      <div class="goal-checkpoint-action-context-item">
        <span class="goal-summary-label">${escapeHtml(t("goals.checkpointActionContextGoal", {}, "Goal"))}</span>
        <strong>${escapeHtml(context.goalId)}</strong>
      </div>
      <div class="goal-checkpoint-action-context-item">
        <span class="goal-summary-label">${escapeHtml(t("goals.checkpointActionContextNode", {}, "Node"))}</span>
        <strong>${escapeHtml(context.nodeId)}</strong>
      </div>
      <div class="goal-checkpoint-action-context-item">
        <span class="goal-summary-label">${escapeHtml(t("goals.checkpointActionContextCheckpoint", {}, "Checkpoint"))}</span>
        <strong>${escapeHtml(context.checkpointId)}</strong>
      </div>
      <div class="goal-checkpoint-action-context-item">
        <span class="goal-summary-label">${escapeHtml(t("goals.checkpointActionContextStatus", {}, "Status"))}</span>
        <strong>${escapeHtml(context.status || "-")}</strong>
      </div>
      <div class="goal-checkpoint-action-context-item">
        <span class="goal-summary-label">${escapeHtml(t("goals.checkpointActionContextReviewer", {}, "Reviewer"))}</span>
        <strong>${escapeHtml(context.reviewer || "-")}</strong>
      </div>
      <div class="goal-checkpoint-action-context-item">
        <span class="goal-summary-label">${escapeHtml(t("goals.checkpointActionContextSla", {}, "SLA"))}</span>
        <strong>${escapeHtml(context.slaAt ? formatDateTime(context.slaAt) : "-")}</strong>
      </div>
    `;
  }

  function toggleGoalCheckpointActionModal(show, context = null) {
    if (!goalCheckpointActionModal) return;
    if (show) {
      const nextContext = context && typeof context === "object" ? { ...context } : null;
      const config = nextContext ? getGoalCheckpointActionConfig(nextContext.action) : null;
      if (!nextContext || !config) return;
      pendingGoalCheckpointAction = nextContext;
      resetGoalCheckpointActionForm();
      if (goalCheckpointActionTitleEl) goalCheckpointActionTitleEl.textContent = t(config.modalTitleKey, {}, config.modalTitleFallback);
      if (goalCheckpointActionHintEl) goalCheckpointActionHintEl.textContent = t(config.hintKey, {}, config.hintFallback);
      if (goalCheckpointActionReviewerEl) goalCheckpointActionReviewerEl.value = nextContext.reviewer || "";
      if (goalCheckpointActionReviewerRoleEl) goalCheckpointActionReviewerRoleEl.value = nextContext.reviewerRole || "";
      if (goalCheckpointActionRequestedByEl) goalCheckpointActionRequestedByEl.value = nextContext.requestedBy || "";
      if (goalCheckpointActionActorLabelEl) goalCheckpointActionActorLabelEl.textContent = t(config.actorLabelKey, {}, config.actorLabelFallback);
      if (goalCheckpointActionActorEl) {
        goalCheckpointActionActorEl.value = config.method === "goal.checkpoint.reopen"
          ? nextContext.requestedBy || ""
          : nextContext.decidedBy || "";
      }
      if (goalCheckpointActionSlaAtEl) goalCheckpointActionSlaAtEl.value = formatDateTimeLocalValue(nextContext.slaAt);
      if (goalCheckpointActionSummaryEl) goalCheckpointActionSummaryEl.value = nextContext.summary || t(config.defaultSummaryKey, {}, config.defaultSummaryFallback);
      if (goalCheckpointActionNoteLabelEl) goalCheckpointActionNoteLabelEl.textContent = t(config.noteLabelKey, {}, config.noteLabelFallback);
      if (goalCheckpointActionNoteHelpEl) goalCheckpointActionNoteHelpEl.textContent = t(config.noteHelpKey, {}, config.noteHelpFallback);
      if (goalCheckpointActionNoteEl) {
        goalCheckpointActionNoteEl.placeholder = t(config.notePlaceholderKey, {}, config.notePlaceholderFallback);
        goalCheckpointActionNoteEl.value = nextContext.note || "";
      }
      renderGoalCheckpointActionContext(nextContext);
      setGoalCheckpointActionBusy(false);
      goalCheckpointActionModal.classList.remove("hidden");
      setTimeout(() => {
        if (config.noteRequired) {
          goalCheckpointActionNoteEl?.focus();
        } else {
          goalCheckpointActionSummaryEl?.focus();
          goalCheckpointActionSummaryEl?.select();
        }
      }, 0);
      return;
    }

    pendingGoalCheckpointAction = null;
    resetGoalCheckpointActionForm();
    setGoalCheckpointActionBusy(false);
    goalCheckpointActionModal.classList.add("hidden");
  }

  async function runGoalCheckpointAction(goalId, nodeId, checkpointId, action) {
    if (!isConnected()) {
      showNotice(t("goals.checkpointActionFailedTitle", {}, "Checkpoint action failed"), t("goals.notConnected", {}, "Not connected to the server."), "error");
      return;
    }

    const config = getGoalCheckpointActionConfig(action);
    if (!config) return;
    if (!goalCheckpointActionModal) {
      showNotice(t("goals.checkpointActionFailedTitle", {}, "Checkpoint action failed"), t("goals.checkpointActionModalMissing", {}, "The checkpoint action panel is not initialized."), "error");
      return;
    }

    const checkpoint = findTrackedGoalCheckpoint(goalId, checkpointId);
    toggleGoalCheckpointActionModal(true, {
      action,
      goalId,
      nodeId,
      checkpointId,
      status: checkpoint?.status || "",
      reviewer: checkpoint?.reviewer || "",
      reviewerRole: checkpoint?.reviewerRole || "",
      requestedBy: checkpoint?.requestedBy || "",
      decidedBy: checkpoint?.decidedBy || "",
      slaAt: checkpoint?.slaAt || "",
      summary: checkpoint?.summary || "",
      note: checkpoint?.note || "",
    });
  }

  async function submitGoalCheckpointActionForm() {
    if (!pendingGoalCheckpointAction) return;
    if (!isConnected()) {
      showNotice(t("goals.checkpointActionFailedTitle", {}, "Checkpoint action failed"), t("goals.notConnected", {}, "Not connected to the server."), "error");
      return;
    }

    const context = pendingGoalCheckpointAction;
    const config = getGoalCheckpointActionConfig(context.action);
    if (!config) return;

    const reviewer = goalCheckpointActionReviewerEl?.value.trim() || "";
    const reviewerRole = goalCheckpointActionReviewerRoleEl?.value.trim() || "";
    const requestedBy = goalCheckpointActionRequestedByEl?.value.trim() || "";
    const actor = goalCheckpointActionActorEl?.value.trim() || "";
    const slaAt = parseDateTimeLocalValue(goalCheckpointActionSlaAtEl?.value || "") || "";
    const defaultSummary = t(config.defaultSummaryKey, {}, config.defaultSummaryFallback);
    const summary = goalCheckpointActionSummaryEl?.value.trim() || defaultSummary;
    const note = goalCheckpointActionNoteEl?.value.trim() || "";
    const noteLabel = t(config.noteLabelKey, {}, config.noteLabelFallback);
    if (config.noteRequired && !note) {
      showNotice(
        t("goals.checkpointActionFailedTitle", {}, "Checkpoint action failed"),
        t("goals.checkpointActionNoteRequired", { label: noteLabel }, `${noteLabel} is required.`),
        "error",
      );
      goalCheckpointActionNoteEl?.focus();
      return;
    }

    setGoalCheckpointActionBusy(true);
    try {
      const res = await sendReq({
        type: "req",
        id: makeId(),
        method: config.method,
        params: {
          goalId: context.goalId,
          nodeId: context.nodeId,
          checkpointId: context.checkpointId,
          reviewer: reviewer || undefined,
          reviewerRole: reviewerRole || undefined,
          requestedBy: (context.action === "reopen" ? actor : requestedBy) || undefined,
          decidedBy: (context.action === "approve" || context.action === "reject" || context.action === "expire")
            ? (actor || undefined)
            : undefined,
          slaAt: slaAt || undefined,
          summary: summary || defaultSummary,
          note: note || undefined,
        },
      });
      if (!res || !res.ok) {
        showNotice(t("goals.checkpointActionFailedTitle", {}, "Checkpoint action failed"), res?.error?.message || t("goals.unknownError", {}, "Unknown error."), "error");
        return;
      }

      toggleGoalCheckpointActionModal(false);
      await loadGoals(true, context.goalId);
      showNotice(
        t(config.successTitleKey, {}, config.successTitleFallback),
        t("goals.checkpointActionUpdatedMessage", { goalId: context.goalId, nodeId: context.nodeId }, `${context.goalId} / ${context.nodeId} updated.`),
        "success",
        2200,
      );
    } catch (error) {
      showNotice(t("goals.checkpointActionFailedTitle", {}, "Checkpoint action failed"), error instanceof Error ? error.message : String(error), "error");
    } finally {
      if (pendingGoalCheckpointAction) {
        setGoalCheckpointActionBusy(false);
      }
    }
  }

  function bindGoalDetailActions(goal) {
    if (!goalsDetailEl || !goal) return;
    goalsDetailEl.querySelectorAll("[data-goal-resume-detail]").forEach((node) => {
      node.addEventListener("click", () => {
        const goalId = node.getAttribute("data-goal-resume-detail");
        if (!goalId) return;
        void onResumeGoal(goalId);
      });
    });
    goalsDetailEl.querySelectorAll("[data-goal-pause-detail]").forEach((node) => {
      node.addEventListener("click", () => {
        const goalId = node.getAttribute("data-goal-pause-detail");
        if (!goalId) return;
        void onPauseGoal(goalId);
      });
    });
    goalsDetailEl.querySelectorAll("[data-goal-archive-detail]").forEach((node) => {
      node.addEventListener("click", () => {
        const goalId = node.getAttribute("data-goal-archive-detail");
        if (!goalId) return;
        void onArchiveGoal(goalId);
      });
    });
    goalsDetailEl.querySelectorAll("[data-goal-delete-detail]").forEach((node) => {
      node.addEventListener("click", () => {
        const goalId = node.getAttribute("data-goal-delete-detail");
        if (!goalId) return;
        void onDeleteGoal(goalId);
      });
    });
    goalsDetailEl.querySelectorAll("[data-open-source]").forEach((node) => {
      node.addEventListener("click", () => {
        const sourcePath = node.getAttribute("data-open-source");
        if (!sourcePath) return;
        void onOpenSourcePath(sourcePath);
      });
    });
    goalsDetailEl.querySelectorAll("[data-open-task-id]").forEach((node) => {
      node.addEventListener("click", () => {
        const taskId = node.getAttribute("data-open-task-id");
        if (!taskId) return;
        void onOpenTask(taskId);
      });
    });
    goalsDetailEl.querySelectorAll("[data-open-goal-tasks]").forEach((node) => {
      node.addEventListener("click", () => {
        const goalId = node.getAttribute("data-open-goal-tasks");
        if (!goalId) return;
        void onOpenGoalTaskViewer(goalId);
      });
    });
    goalsDetailEl.querySelectorAll("[data-goal-resume-last-node]").forEach((node) => {
      node.addEventListener("click", () => {
        const goalId = node.getAttribute("data-goal-resume-last-node");
        if (!goalId) return;
        const lastNodeId = node.getAttribute("data-goal-last-node-id");
        void onResumeGoal(goalId, { nodeId: lastNodeId || undefined });
      });
    });
    goalsDetailEl.querySelectorAll("[data-open-goal-board]").forEach((node) => {
      node.addEventListener("click", () => {
        const boardId = node.getAttribute("data-open-goal-board");
        void onOpenGoalBoard(boardId, goal.id);
      });
    });
    goalsDetailEl.querySelectorAll("[data-open-goal-board-list]").forEach((node) => {
      node.addEventListener("click", () => {
        const goalId = node.getAttribute("data-open-goal-board-list") || goal.id;
        void onOpenGoalBoardList(goalId);
      });
    });
    goalsDetailEl.querySelectorAll("[data-goal-checkpoint-action]").forEach((node) => {
      node.addEventListener("click", () => {
        const action = node.getAttribute("data-goal-checkpoint-action");
        const goalId = node.getAttribute("data-goal-checkpoint-goal-id") || goal.id;
        const nodeId = node.getAttribute("data-goal-checkpoint-node-id");
        const checkpointId = node.getAttribute("data-goal-checkpoint-id");
        if (!action || !goalId || !nodeId || !checkpointId) return;
        void runGoalCheckpointAction(goalId, nodeId, checkpointId, action);
      });
    });
    goalsDetailEl.querySelectorAll("[data-goal-generate-handoff]").forEach((node) => {
      node.addEventListener("click", () => {
        const goalId = node.getAttribute("data-goal-generate-handoff") || goal.id;
        if (!goalId) return;
        void onGenerateGoalHandoff(goalId);
      });
    });
  }

  return {
    bindGoalDetailActions,
    loadGoals,
    refreshGoalsLocale,
    renderGoalDetail,
    renderGoalList,
    renderGoalsEmpty,
    renderGoalsLoading,
    renderGoalsSummary,
    runGoalCheckpointAction,
    submitGoalCheckpointActionForm,
    toggleGoalCheckpointActionModal,
  };
}
