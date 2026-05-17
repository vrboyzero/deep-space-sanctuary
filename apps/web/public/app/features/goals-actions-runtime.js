export function createGoalsActionsRuntimeFeature({
  refs,
  isConnected,
  sendReq,
  makeId,
  getGoalById,
  loadGoals,
  goalBaseConversationId,
  openConversationSession,
  isConversationForGoal,
  getActiveConversationId,
  setActiveConversationId,
  renderCanvasGoalContext,
  getChatEventsFeature,
  loadGoalHandoffData,
  loadGoalReviewGovernanceData,
  loadGoalTrackingData,
  loadGoalCapabilityData,
  getGoalsRuntimeFeature,
  getGoalActionActor,
  showNotice,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const {
    goalCreateModal,
    goalCreateTitleEl,
    goalCreateObjectiveEl,
    goalCreateRootEl,
    goalCreateAutoResumeEl,
    goalCreateSubmitBtn,
    goalCheckpointActionModal,
    goalCheckpointActionSummaryEl,
    goalCheckpointActionNoteEl,
    goalCheckpointActionSubmitBtn,
  } = refs;

  function resetGoalCreateForm() {
    if (goalCreateTitleEl) goalCreateTitleEl.value = "";
    if (goalCreateObjectiveEl) goalCreateObjectiveEl.value = "";
    if (goalCreateRootEl) goalCreateRootEl.value = "";
    if (goalCreateAutoResumeEl) goalCreateAutoResumeEl.checked = true;
  }

  function toggleGoalCreateModal(show) {
    if (!goalCreateModal) return;
    if (show) {
      resetGoalCreateForm();
      goalCreateModal.classList.remove("hidden");
      setTimeout(() => goalCreateTitleEl?.focus(), 0);
      return;
    }
    goalCreateModal.classList.add("hidden");
  }

  function toggleGoalCheckpointActionModal(show, context = null) {
    return getGoalsRuntimeFeature?.()?.toggleGoalCheckpointActionModal(show, context);
  }

  async function submitGoalCheckpointActionForm() {
    return getGoalsRuntimeFeature?.()?.submitGoalCheckpointActionForm();
  }

  async function runGoalApprovalScan(goalId, options = {}) {
    if (!isConnected()) {
      showNotice("无法执行审批扫描", "未连接到服务器。", "error");
      return;
    }
    const goal = getGoalById(goalId);
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "goal.approval.scan",
      params: {
        goalId,
        autoEscalate: options.autoEscalate !== false,
      },
    });
    if (!res?.ok) {
      showNotice("审批扫描失败", res?.error?.message || "goal.approval.scan 调用失败。", "error");
      return;
    }
    showNotice("审批扫描完成", res.payload?.summary || "已刷新 approval workflow 状态。", "success");
    if (goal) {
      void loadGoalReviewGovernanceData(goal);
      void loadGoalTrackingData(goal);
    }
  }

  async function runGoalSuggestionReviewDecision(goalId, input) {
    if (!isConnected()) {
      showNotice("无法执行 suggestion review", "未连接到服务器。", "error");
      return;
    }
    const actor = window.prompt("审批人 / Reviewer", getGoalActionActor()) || getGoalActionActor();
    const note = window.prompt("审批备注（可留空）", "") || "";
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "goal.suggestion_review.decide",
      params: {
        goalId,
        reviewId: input.reviewId,
        suggestionType: input.suggestionType || undefined,
        suggestionId: input.suggestionId || undefined,
        decision: input.decision,
        reviewer: actor,
        decidedBy: actor,
        note: note || undefined,
      },
    });
    if (!res?.ok) {
      showNotice("suggestion review 失败", res?.error?.message || "goal.suggestion_review.decide 调用失败。", "error");
      return;
    }
    showNotice("suggestion review 已提交", `${input.decision} 已写入审批流。`, "success");
    const goal = getGoalById(goalId);
    if (goal) void loadGoalReviewGovernanceData(goal);
  }

  async function runGoalSuggestionReviewEscalation(goalId, input) {
    if (!isConnected()) {
      showNotice("无法升级 suggestion review", "未连接到服务器。", "error");
      return;
    }
    const escalatedTo = window.prompt("升级到的 Reviewer", "") || "";
    const reason = window.prompt("升级原因", "Need escalation") || "";
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "goal.suggestion_review.escalate",
      params: {
        goalId,
        reviewId: input.reviewId,
        suggestionType: input.suggestionType || undefined,
        suggestionId: input.suggestionId || undefined,
        escalatedBy: getGoalActionActor(),
        escalatedTo: escalatedTo || undefined,
        reason: reason || undefined,
        force: true,
      },
    });
    if (!res?.ok) {
      showNotice("suggestion review 升级失败", res?.error?.message || "goal.suggestion_review.escalate 调用失败。", "error");
      return;
    }
    showNotice("suggestion review 已升级", "当前审批 stage 已升级。", "success");
    const goal = getGoalById(goalId);
    if (goal) void loadGoalReviewGovernanceData(goal);
  }

  async function runGoalCheckpointEscalation(goalId, nodeId, checkpointId) {
    if (!isConnected()) {
      showNotice("无法升级 checkpoint", "未连接到服务器。", "error");
      return;
    }
    const escalatedTo = window.prompt("升级到的 Reviewer", "") || "";
    const reason = window.prompt("升级原因", "Need escalation") || "";
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "goal.checkpoint.escalate",
      params: {
        goalId,
        nodeId,
        checkpointId,
        escalatedBy: getGoalActionActor(),
        escalatedTo: escalatedTo || undefined,
        reason: reason || undefined,
        force: true,
      },
    });
    if (!res?.ok) {
      showNotice("checkpoint 升级失败", res?.error?.message || "goal.checkpoint.escalate 调用失败。", "error");
      return;
    }
    showNotice("checkpoint 已升级", "当前 checkpoint 审批 stage 已升级。", "success");
    const goal = getGoalById(goalId);
    if (goal) {
      void loadGoalReviewGovernanceData(goal);
      void loadGoalTrackingData(goal);
    }
  }

  async function saveGoalCapabilityGovernance(goalId, nodeId, input) {
    if (!isConnected()) {
      showNotice("无法保存治理设置", "未连接到服务器。", "error");
      return null;
    }
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "goal.capability.update",
      params: {
        goalId,
        nodeId,
        executionMode: input.executionMode || undefined,
        governanceMode: input.governanceMode || undefined,
        commanderAgentId: input.commanderAgentId || undefined,
        preferredAgents: Array.isArray(input.preferredAgents) ? input.preferredAgents : undefined,
        finalApprovalMode: input.finalApprovalMode || undefined,
      },
    });
    if (!res?.ok) {
      showNotice("治理设置保存失败", res?.error?.message || "goal.capability.update 调用失败。", "error");
      return null;
    }
    showNotice("治理设置已保存", "当前节点的 capability governance 已更新。", "success");
    const goal = getGoalById(goalId);
    if (goal) {
      void loadGoalCapabilityData?.(goal);
      void loadGoalTrackingData(goal);
      void loadGoalReviewGovernanceData(goal);
    }
    return res.payload?.plan || null;
  }

  async function runGoalCommanderDecision(goalId, nodeId, input) {
    if (!isConnected()) {
      showNotice("无法执行 commander 决策", "未连接到服务器。", "error");
      return null;
    }
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "goal.capability.commander_decide",
      params: {
        goalId,
        nodeId,
        decision: input.decision,
        summary: input.summary || undefined,
        note: input.note || undefined,
        requireUserApproval: typeof input.requireUserApproval === "boolean" ? input.requireUserApproval : undefined,
      },
    });
    if (!res?.ok) {
      showNotice("Commander 决策失败", res?.error?.message || "goal.capability.commander_decide 调用失败。", "error");
      return null;
    }
    const decision = input.decision || "decision";
    showNotice("Commander 决策已提交", `${decision} 已写入 capability governance。`, "success");
    const goal = getGoalById(goalId);
    if (goal) {
      void loadGoalCapabilityData?.(goal);
      void loadGoalTrackingData(goal);
      void loadGoalReviewGovernanceData(goal);
    }
    return res.payload || null;
  }

  async function submitGoalCreateForm() {
    if (!isConnected()) {
      showNotice(
        t("goals.createUnavailableTitle", {}, "Unable to create long task"),
        t("goals.notConnected", {}, "Not connected to the server."),
        "error",
      );
      return;
    }
    const normalizedTitle = goalCreateTitleEl?.value.trim() || "";
    if (!normalizedTitle) {
      showNotice(
        t("goals.createUnavailableTitle", {}, "Unable to create long task"),
        t("goals.titleRequired", {}, "Title cannot be empty."),
        "error",
      );
      goalCreateTitleEl?.focus();
      return;
    }
    const objective = goalCreateObjectiveEl?.value.trim() || "";
    const goalRoot = goalCreateRootEl?.value.trim() || "";
    const autoResume = goalCreateAutoResumeEl?.checked !== false;
    if (goalCreateSubmitBtn) {
      goalCreateSubmitBtn.disabled = true;
      goalCreateSubmitBtn.textContent = t("goals.creating", {}, "Creating...");
    }
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "goal.create",
      params: {
        title: normalizedTitle,
        objective: objective.trim() || undefined,
        goalRoot: goalRoot.trim() || undefined,
      },
    });
    if (goalCreateSubmitBtn) {
      goalCreateSubmitBtn.disabled = false;
      goalCreateSubmitBtn.textContent = t("goals.createButton", {}, "Create");
    }
    if (!res || !res.ok || !res.payload?.goal?.id) {
      showNotice(
        t("goals.createFailedTitle", {}, "Failed to create long task"),
        res?.error?.message || t("goals.unknownError", {}, "Unknown error."),
        "error",
      );
      return;
    }
    const goal = res.payload.goal;
    toggleGoalCreateModal(false);
    showNotice(
      t("goals.createdTitle", {}, "Long task created"),
      t("goals.createdMessage", { goalName: goal.title || goal.id }, `${goal.title || goal.id} was created and is ready to enter its execution channel.`),
      "success",
      2200,
    );
    await loadGoals(true, goal.id);
    if (autoResume) {
      await resumeGoal(goal.id, { silent: true });
    }
  }

  async function resumeGoal(goalId, options = {}) {
    if (!isConnected()) {
      showNotice(
        t("goals.resumeUnavailableTitle", {}, "Unable to resume long task"),
        t("goals.notConnected", {}, "Not connected to the server."),
        "error",
      );
      return;
    }
    const nodeId = typeof options.nodeId === "string" && options.nodeId.trim() ? options.nodeId.trim() : undefined;
    const checkpointId = typeof options.checkpointId === "string" && options.checkpointId.trim()
      ? options.checkpointId.trim()
      : undefined;
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "goal.resume",
      params: { goalId, nodeId, checkpointId },
    });
    if (!res || !res.ok) {
      showNotice(
        t("goals.resumeFailedTitle", {}, "Failed to resume long task"),
        res?.error?.message || t("goals.unknownError", {}, "Unknown error."),
        "error",
      );
      return;
    }
    const goal = res.payload?.goal || getGoalById(goalId);
    const conversationId = res.payload?.conversationId || goal?.activeConversationId || goalBaseConversationId(goalId);
    await loadGoals(true, goalId);
    openConversationSession(conversationId, nodeId
      ? t("goals.resumedNodeChannelHint", { goalName: goal?.title || goalId, nodeId }, `Entered long task node channel: ${goal?.title || goalId} / ${nodeId}`)
      : t("goals.resumedChannelHint", { goalName: goal?.title || goalId }, `Entered long task channel: ${goal?.title || goalId}`));
    if (!options.silent) {
      showNotice(
        t("goals.resumedTitle", {}, "Long task resumed"),
        checkpointId && nodeId
          ? t(
            "goals.replayedCheckpointMessage",
            { goalName: goal?.title || goalId, checkpointId, nodeId },
            `${goal?.title || goalId} replayed checkpoint ${checkpointId} and resumed node ${nodeId}.`,
          )
          : nodeId
            ? t("goals.resumedNodeMessage", { goalName: goal?.title || goalId, nodeId }, `${goal?.title || goalId} resumed from the last node ${nodeId}.`)
            : t("goals.resumedMessage", { goalName: goal?.title || goalId }, `${goal?.title || goalId} switched to its dedicated goal channel.`),
        "success",
        2200,
      );
    }
  }

  async function pauseGoal(goalId) {
    if (!isConnected()) {
      showNotice(
        t("goals.pauseUnavailableTitle", {}, "Unable to pause long task"),
        t("goals.notConnected", {}, "Not connected to the server."),
        "error",
      );
      return;
    }
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "goal.pause",
      params: { goalId },
    });
    if (!res || !res.ok) {
      showNotice(
        t("goals.pauseFailedTitle", {}, "Failed to pause long task"),
        res?.error?.message || t("goals.unknownError", {}, "Unknown error."),
        "error",
      );
      return;
    }
    if (isConversationForGoal(getActiveConversationId(), goalId)) {
      setActiveConversationId(null);
      renderCanvasGoalContext?.();
      getChatEventsFeature?.()?.resetStreamingState();
    }
    const goal = res.payload?.goal || getGoalById(goalId);
    await loadGoals(true, goalId);
    showNotice(
      t("goals.pausedTitle", {}, "Long task paused"),
      t("goals.pausedMessage", { goalName: goal?.title || goalId }, `${goal?.title || goalId} has been paused. The normal chat channel is unaffected.`),
      "info",
      2400,
    );
  }

  async function generateGoalHandoff(goalId) {
    if (!isConnected()) {
      showNotice(
        t("goals.handoffUnavailableTitle", {}, "Unable to generate handoff"),
        t("goals.notConnected", {}, "Not connected to the server."),
        "error",
      );
      return;
    }
    const goal = getGoalById(goalId);
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "goal.handoff.generate",
      params: { goalId },
    });
    if (!res || !res.ok) {
      showNotice(
        t("goals.handoffFailedTitle", {}, "Failed to generate handoff"),
        res?.error?.message || t("goals.unknownError", {}, "Unknown error."),
        "error",
      );
      return;
    }
    if (goal) {
      void loadGoalHandoffData(goal);
    }
    showNotice(
      t("goals.handoffGeneratedTitle", {}, "Handoff generated"),
      t("goals.handoffGeneratedMessage", { goalName: goal?.title || goalId }, `The recovery handoff summary for ${goal?.title || goalId} has been updated.`),
      "success",
      2200,
    );
  }

  function bindUi() {
    if (goalCreateTitleEl) {
      goalCreateTitleEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          void submitGoalCreateForm();
        }
      });
    }
    if (goalCreateObjectiveEl) {
      goalCreateObjectiveEl.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          void submitGoalCreateForm();
        }
      });
    }
    if (goalCreateModal) {
      goalCreateModal.addEventListener("click", (event) => {
        if (event.target === goalCreateModal) {
          toggleGoalCreateModal(false);
        }
      });
    }
    if (goalCheckpointActionSubmitBtn) {
      goalCheckpointActionSubmitBtn.addEventListener("click", () => {
        void submitGoalCheckpointActionForm();
      });
    }
    if (goalCheckpointActionModal) {
      goalCheckpointActionModal.addEventListener("click", (event) => {
        if (event.target === goalCheckpointActionModal) {
          if (goalCheckpointActionSubmitBtn?.disabled) return;
          toggleGoalCheckpointActionModal(false);
        }
      });
    }
    if (goalCheckpointActionSummaryEl) {
      goalCheckpointActionSummaryEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void submitGoalCheckpointActionForm();
        }
      });
    }
    if (goalCheckpointActionNoteEl) {
      goalCheckpointActionNoteEl.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          void submitGoalCheckpointActionForm();
        }
      });
    }
  }

  return {
    toggleGoalCreateModal,
    toggleGoalCheckpointActionModal,
    submitGoalCheckpointActionForm,
    runGoalApprovalScan,
    runGoalSuggestionReviewDecision,
    runGoalSuggestionReviewEscalation,
    runGoalCheckpointEscalation,
    saveGoalCapabilityGovernance,
    runGoalCommanderDecision,
    submitGoalCreateForm,
    resumeGoal,
    pauseGoal,
    generateGoalHandoff,
    bindUi,
  };
}
