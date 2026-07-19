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
  const listenerEntries = [];
  // generation 隔离已退出 owner 的迟到副作用，token 仅随 Promise 物理结算释放。
  const pendingRpcTokens = new Set();
  let uiBound = false;
  let focusTimer = null;
  let lifecycleGeneration = 0;
  let disposed = false;

  function addOwnedListener(target, type, handler) {
    if (!target) return;
    const guardedHandler = (event) => {
      if (disposed) return;
      handler(event);
    };
    target.addEventListener(type, guardedHandler);
    listenerEntries.push({ target, type, handler: guardedHandler });
  }

  function clearGoalCreateFocusTimer() {
    if (focusTimer === null) return;
    clearTimeout(focusTimer);
    focusTimer = null;
  }

  function setGoalCreateSubmitBusy(busy) {
    if (!goalCreateSubmitBtn) return;
    goalCreateSubmitBtn.disabled = busy;
    goalCreateSubmitBtn.textContent = busy
      ? t("goals.creating", {}, "Creating...")
      : t("goals.createButton", {}, "Create");
  }

  function resetGoalCreateForm() {
    if (goalCreateTitleEl) goalCreateTitleEl.value = "";
    if (goalCreateObjectiveEl) goalCreateObjectiveEl.value = "";
    if (goalCreateRootEl) goalCreateRootEl.value = "";
    if (goalCreateAutoResumeEl) goalCreateAutoResumeEl.checked = true;
  }

  function toggleGoalCreateModal(show) {
    if (disposed || !goalCreateModal) return;
    if (show) {
      resetGoalCreateForm();
      goalCreateModal.classList.remove("hidden");
      clearGoalCreateFocusTimer();
      focusTimer = setTimeout(() => {
        focusTimer = null;
        if (disposed || goalCreateModal.classList.contains("hidden")) return;
        goalCreateTitleEl?.focus();
      }, 0);
      return;
    }
    clearGoalCreateFocusTimer();
    goalCreateModal.classList.add("hidden");
  }

  function toggleGoalCheckpointActionModal(show, context = null) {
    if (disposed) return;
    return getGoalsRuntimeFeature?.()?.toggleGoalCheckpointActionModal(show, context);
  }

  async function submitGoalCheckpointActionForm() {
    if (disposed) return;
    return getGoalsRuntimeFeature?.()?.submitGoalCheckpointActionForm();
  }

  async function runGoalApprovalScan(goalId, options = {}) {
    if (disposed) return;
    if (!isConnected()) {
      showNotice("无法执行审批扫描", "未连接到服务器。", "error");
      return;
    }
    const goal = getGoalById(goalId);
    const generation = lifecycleGeneration;
    const pendingToken = Symbol("goal-approval-scan");
    pendingRpcTokens.add(pendingToken);
    try {
      const res = await sendReq({
        type: "req",
        id: makeId(),
        method: "goal.approval.scan",
        params: {
          goalId,
          autoEscalate: options.autoEscalate !== false,
        },
      });
      if (disposed || generation !== lifecycleGeneration) return;
      if (!res?.ok) {
        showNotice("审批扫描失败", res?.error?.message || "goal.approval.scan 调用失败。", "error");
        return;
      }
      showNotice("审批扫描完成", res.payload?.summary || "已刷新 approval workflow 状态。", "success");
      if (goal) {
        void loadGoalReviewGovernanceData(goal);
        void loadGoalTrackingData(goal);
      }
    } catch (error) {
      if (disposed || generation !== lifecycleGeneration) return;
      throw error;
    } finally {
      pendingRpcTokens.delete(pendingToken);
    }
  }

  async function runGoalSuggestionReviewDecision(goalId, input) {
    if (disposed) return;
    if (!isConnected()) {
      showNotice("无法执行 suggestion review", "未连接到服务器。", "error");
      return;
    }
    const generation = lifecycleGeneration;
    const actor = window.prompt("审批人 / Reviewer", getGoalActionActor()) || getGoalActionActor();
    const note = window.prompt("审批备注（可留空）", "") || "";
    if (disposed || generation !== lifecycleGeneration) return;
    const pendingToken = Symbol("goal-suggestion-review-decision");
    pendingRpcTokens.add(pendingToken);
    try {
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
      if (disposed || generation !== lifecycleGeneration) return;
      if (!res?.ok) {
        showNotice("suggestion review 失败", res?.error?.message || "goal.suggestion_review.decide 调用失败。", "error");
        return;
      }
      showNotice("suggestion review 已提交", `${input.decision} 已写入审批流。`, "success");
      const goal = getGoalById(goalId);
      if (goal) void loadGoalReviewGovernanceData(goal);
    } catch (error) {
      if (disposed || generation !== lifecycleGeneration) return;
      throw error;
    } finally {
      pendingRpcTokens.delete(pendingToken);
    }
  }

  async function runGoalSuggestionReviewEscalation(goalId, input) {
    if (disposed) return;
    if (!isConnected()) {
      showNotice("无法升级 suggestion review", "未连接到服务器。", "error");
      return;
    }
    const generation = lifecycleGeneration;
    const escalatedTo = window.prompt("升级到的 Reviewer", "") || "";
    const reason = window.prompt("升级原因", "Need escalation") || "";
    if (disposed || generation !== lifecycleGeneration) return;
    const pendingToken = Symbol("goal-suggestion-review-escalation");
    pendingRpcTokens.add(pendingToken);
    try {
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
      if (disposed || generation !== lifecycleGeneration) return;
      if (!res?.ok) {
        showNotice("suggestion review 升级失败", res?.error?.message || "goal.suggestion_review.escalate 调用失败。", "error");
        return;
      }
      showNotice("suggestion review 已升级", "当前审批 stage 已升级。", "success");
      const goal = getGoalById(goalId);
      if (goal) void loadGoalReviewGovernanceData(goal);
    } catch (error) {
      if (disposed || generation !== lifecycleGeneration) return;
      throw error;
    } finally {
      pendingRpcTokens.delete(pendingToken);
    }
  }

  async function runGoalCheckpointEscalation(goalId, nodeId, checkpointId) {
    if (disposed) return;
    if (!isConnected()) {
      showNotice("无法升级 checkpoint", "未连接到服务器。", "error");
      return;
    }
    const generation = lifecycleGeneration;
    const escalatedTo = window.prompt("升级到的 Reviewer", "") || "";
    const reason = window.prompt("升级原因", "Need escalation") || "";
    if (disposed || generation !== lifecycleGeneration) return;
    const pendingToken = Symbol("goal-checkpoint-escalation");
    pendingRpcTokens.add(pendingToken);
    try {
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
      if (disposed || generation !== lifecycleGeneration) return;
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
    } catch (error) {
      if (disposed || generation !== lifecycleGeneration) return;
      throw error;
    } finally {
      pendingRpcTokens.delete(pendingToken);
    }
  }

  async function saveGoalCapabilityGovernance(goalId, nodeId, input) {
    if (disposed) return null;
    if (!isConnected()) {
      showNotice("无法保存治理设置", "未连接到服务器。", "error");
      return null;
    }
    const generation = lifecycleGeneration;
    const pendingToken = Symbol("goal-capability-governance-save");
    pendingRpcTokens.add(pendingToken);
    try {
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
      if (disposed || generation !== lifecycleGeneration) return null;
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
    } catch (error) {
      if (disposed || generation !== lifecycleGeneration) return null;
      throw error;
    } finally {
      pendingRpcTokens.delete(pendingToken);
    }
  }

  async function runGoalCommanderDecision(goalId, nodeId, input) {
    if (disposed) return null;
    if (!isConnected()) {
      showNotice("无法执行 commander 决策", "未连接到服务器。", "error");
      return null;
    }
    const generation = lifecycleGeneration;
    const pendingToken = Symbol("goal-commander-decision");
    pendingRpcTokens.add(pendingToken);
    try {
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
      if (disposed || generation !== lifecycleGeneration) return null;
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
    } catch (error) {
      if (disposed || generation !== lifecycleGeneration) return null;
      throw error;
    } finally {
      pendingRpcTokens.delete(pendingToken);
    }
  }

  async function submitGoalCreateForm() {
    if (disposed) return;
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
    const generation = lifecycleGeneration;
    const pendingToken = Symbol("goal-create");
    setGoalCreateSubmitBusy(true);
    pendingRpcTokens.add(pendingToken);
    try {
      let res;
      try {
        res = await sendReq({
          type: "req",
          id: makeId(),
          method: "goal.create",
          params: {
            title: normalizedTitle,
            objective: objective.trim() || undefined,
            goalRoot: goalRoot.trim() || undefined,
          },
        });
      } finally {
        if (!disposed && generation === lifecycleGeneration) {
          setGoalCreateSubmitBusy(false);
        }
      }
      if (disposed || generation !== lifecycleGeneration) return;
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
      if (disposed || generation !== lifecycleGeneration) return;
      await loadGoals(true, goal.id);
      if (disposed || generation !== lifecycleGeneration) return;
      if (autoResume) {
        await resumeGoal(goal.id, { silent: true });
      }
    } catch (error) {
      if (disposed || generation !== lifecycleGeneration) return;
      throw error;
    } finally {
      pendingRpcTokens.delete(pendingToken);
    }
  }

  async function resumeGoal(goalId, options = {}) {
    if (disposed) return;
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
    const generation = lifecycleGeneration;
    const pendingToken = Symbol("goal-resume");
    pendingRpcTokens.add(pendingToken);
    try {
      const res = await sendReq({
        type: "req",
        id: makeId(),
        method: "goal.resume",
        params: { goalId, nodeId, checkpointId },
      });
      if (disposed || generation !== lifecycleGeneration) return;
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
      if (disposed || generation !== lifecycleGeneration) return;
      openConversationSession(conversationId, nodeId
        ? t("goals.resumedNodeChannelHint", { goalName: goal?.title || goalId, nodeId }, `Entered long task node channel: ${goal?.title || goalId} / ${nodeId}`)
        : t("goals.resumedChannelHint", { goalName: goal?.title || goalId }, `Entered long task channel: ${goal?.title || goalId}`));
      if (disposed || generation !== lifecycleGeneration) return;
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
    } catch (error) {
      if (disposed || generation !== lifecycleGeneration) return;
      throw error;
    } finally {
      pendingRpcTokens.delete(pendingToken);
    }
  }

  async function pauseGoal(goalId) {
    if (disposed) return;
    if (!isConnected()) {
      showNotice(
        t("goals.pauseUnavailableTitle", {}, "Unable to pause long task"),
        t("goals.notConnected", {}, "Not connected to the server."),
        "error",
      );
      return;
    }
    const generation = lifecycleGeneration;
    const pendingToken = Symbol("goal-pause");
    pendingRpcTokens.add(pendingToken);
    try {
      const res = await sendReq({
        type: "req",
        id: makeId(),
        method: "goal.pause",
        params: { goalId },
      });
      if (disposed || generation !== lifecycleGeneration) return;
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
      if (disposed || generation !== lifecycleGeneration) return;
      const goal = res.payload?.goal || getGoalById(goalId);
      await loadGoals(true, goalId);
      if (disposed || generation !== lifecycleGeneration) return;
      showNotice(
        t("goals.pausedTitle", {}, "Long task paused"),
        t("goals.pausedMessage", { goalName: goal?.title || goalId }, `${goal?.title || goalId} has been paused. The normal chat channel is unaffected.`),
        "info",
        2400,
      );
    } catch (error) {
      if (disposed || generation !== lifecycleGeneration) return;
      throw error;
    } finally {
      pendingRpcTokens.delete(pendingToken);
    }
  }

  async function archiveGoal(goalId) {
    if (disposed) return;
    if (!isConnected()) {
      showNotice(
        t("goals.archiveUnavailableTitle", {}, "Unable to archive long task"),
        t("goals.notConnected", {}, "Not connected to the server."),
        "error",
      );
      return;
    }
    const goal = getGoalById(goalId);
    const generation = lifecycleGeneration;
    const confirmed = window.confirm(
      t("goals.archiveConfirm", { goalName: goal?.title || goalId }, `Archive ${goal?.title || goalId}?`),
    );
    if (!confirmed || disposed || generation !== lifecycleGeneration) return;
    const reason = window.prompt(
      t("goals.archiveReasonPrompt", {}, "Optional archive reason"),
      "",
    ) || "";
    if (disposed || generation !== lifecycleGeneration) return;
    const pendingToken = Symbol("goal-archive");
    pendingRpcTokens.add(pendingToken);
    try {
      const res = await sendReq({
        type: "req",
        id: makeId(),
        method: "goal.archive",
        params: {
          goalId,
          reason: reason.trim() || undefined,
        },
      });
      if (disposed || generation !== lifecycleGeneration) return;
      if (!res || !res.ok) {
        showNotice(
          t("goals.archiveFailedTitle", {}, "Failed to archive long task"),
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
      if (disposed || generation !== lifecycleGeneration) return;
      const updatedGoal = res.payload?.goal || goal;
      await loadGoals(true);
      if (disposed || generation !== lifecycleGeneration) return;
      showNotice(
        t("goals.archivedTitle", {}, "Long task archived"),
        t("goals.archivedMessage", { goalName: updatedGoal?.title || goalId }, `${updatedGoal?.title || goalId} has been archived.`),
        "info",
        2400,
      );
    } catch (error) {
      if (disposed || generation !== lifecycleGeneration) return;
      throw error;
    } finally {
      pendingRpcTokens.delete(pendingToken);
    }
  }

  async function deleteGoal(goalId) {
    if (disposed) return;
    if (!isConnected()) {
      showNotice(
        t("goals.deleteUnavailableTitle", {}, "Unable to delete long task"),
        t("goals.notConnected", {}, "Not connected to the server."),
        "error",
      );
      return;
    }
    const goal = getGoalById(goalId);
    const generation = lifecycleGeneration;
    const previewToken = Symbol("goal-delete-preview");
    pendingRpcTokens.add(previewToken);
    let previewRes;
    try {
      previewRes = await sendReq({
        type: "req",
        id: makeId(),
        method: "goal.delete",
        params: {
          goalId,
          preview: true,
        },
      });
    } catch (error) {
      if (disposed || generation !== lifecycleGeneration) return;
      throw error;
    } finally {
      pendingRpcTokens.delete(previewToken);
    }
    if (disposed || generation !== lifecycleGeneration) return;
    if (!previewRes || !previewRes.ok) {
      showNotice(
        t("goals.deleteFailedTitle", {}, "Failed to delete long task"),
        previewRes?.error?.message || t("goals.unknownError", {}, "Unknown error."),
        "error",
      );
      return;
    }
    const previewWarnings = Array.isArray(previewRes.payload?.storagePreview?.warnings)
      ? previewRes.payload.storagePreview.warnings
      : [];
    const previewNote = previewWarnings.length
      ? `\n\n${t(
        "goals.deleteStoragePreview",
        { warnings: previewWarnings.join("\n") },
        `Storage cleanup notes:\n${previewWarnings.join("\n")}`,
      )}`
      : "";
    const confirmed = window.confirm(
      `${t(
        "goals.deleteConfirm",
        { goalName: goal?.title || goalId, goalId },
        `Delete archived long task ${goal?.title || goalId} permanently? This cannot be undone.`,
      )}${previewNote}`,
    );
    if (!confirmed || disposed || generation !== lifecycleGeneration) return;
    const confirmText = window.prompt(
      t(
        "goals.deletePrompt",
        { goalId },
        `Type ${goalId} to confirm permanent deletion.`,
      ),
      "",
    );
    if (disposed || generation !== lifecycleGeneration) return;
    if (confirmText === null) {
      return;
    }
    if (confirmText.trim() !== goalId) {
      showNotice(
        t("goals.deleteConfirmMismatchTitle", {}, "Deletion confirmation mismatch"),
        t("goals.deleteConfirmMismatchMessage", { goalId }, `Please type ${goalId} exactly to confirm deletion.`),
        "error",
      );
      return;
    }
    const commitToken = Symbol("goal-delete-commit");
    pendingRpcTokens.add(commitToken);
    try {
      const res = await sendReq({
        type: "req",
        id: makeId(),
        method: "goal.delete",
        params: {
          goalId,
          confirmText: confirmText.trim(),
        },
      });
      if (disposed || generation !== lifecycleGeneration) return;
      if (!res || !res.ok) {
        showNotice(
          t("goals.deleteFailedTitle", {}, "Failed to delete long task"),
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
      if (disposed || generation !== lifecycleGeneration) return;
      await loadGoals(true);
      if (disposed || generation !== lifecycleGeneration) return;
      const cleanupWarnings = Array.isArray(res.payload?.cleanupWarnings) ? res.payload.cleanupWarnings : [];
      showNotice(
        cleanupWarnings.length
          ? t("goals.deletedWithWarningsTitle", {}, "Long task deleted with cleanup warnings")
          : t("goals.deletedTitle", {}, "Long task deleted"),
        cleanupWarnings.length
          ? `${t("goals.deletedMessage", { goalName: goal?.title || goalId }, `${goal?.title || goalId} has been permanently deleted.`)} ${cleanupWarnings[0]}`
          : t("goals.deletedMessage", { goalName: goal?.title || goalId }, `${goal?.title || goalId} has been permanently deleted.`),
        cleanupWarnings.length ? "warning" : "info",
        cleanupWarnings.length ? 4800 : 2400,
      );
    } catch (error) {
      if (disposed || generation !== lifecycleGeneration) return;
      throw error;
    } finally {
      pendingRpcTokens.delete(commitToken);
    }
  }

  async function generateGoalHandoff(goalId) {
    if (disposed) return;
    if (!isConnected()) {
      showNotice(
        t("goals.handoffUnavailableTitle", {}, "Unable to generate handoff"),
        t("goals.notConnected", {}, "Not connected to the server."),
        "error",
      );
      return;
    }
    const goal = getGoalById(goalId);
    const generation = lifecycleGeneration;
    const pendingToken = Symbol("goal-handoff-generation");
    pendingRpcTokens.add(pendingToken);
    try {
      const res = await sendReq({
        type: "req",
        id: makeId(),
        method: "goal.handoff.generate",
        params: { goalId },
      });
      if (disposed || generation !== lifecycleGeneration) return;
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
    } catch (error) {
      if (disposed || generation !== lifecycleGeneration) return;
      throw error;
    } finally {
      pendingRpcTokens.delete(pendingToken);
    }
  }

  function bindUi() {
    if (disposed || uiBound) return;
    uiBound = true;
    addOwnedListener(goalCreateTitleEl, "keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void submitGoalCreateForm();
      }
    });
    addOwnedListener(goalCreateObjectiveEl, "keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void submitGoalCreateForm();
      }
    });
    addOwnedListener(goalCreateModal, "click", (event) => {
      if (event.target === goalCreateModal) {
        toggleGoalCreateModal(false);
      }
    });
    addOwnedListener(goalCheckpointActionSubmitBtn, "click", () => {
      void submitGoalCheckpointActionForm();
    });
    addOwnedListener(goalCheckpointActionModal, "click", (event) => {
      if (event.target === goalCheckpointActionModal) {
        if (goalCheckpointActionSubmitBtn?.disabled) return;
        toggleGoalCheckpointActionModal(false);
      }
    });
    addOwnedListener(goalCheckpointActionSummaryEl, "keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void submitGoalCheckpointActionForm();
      }
    });
    addOwnedListener(goalCheckpointActionNoteEl, "keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void submitGoalCheckpointActionForm();
      }
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    lifecycleGeneration += 1;
    clearGoalCreateFocusTimer();
    for (const { target, type, handler } of listenerEntries) {
      target.removeEventListener(type, handler);
    }
    listenerEntries.length = 0;
    uiBound = false;
    setGoalCreateSubmitBusy(false);
    resetGoalCreateForm();
    goalCreateModal?.classList.add("hidden");
  }

  function getRuntimeSnapshot() {
    return {
      listenerCount: listenerEntries.length,
      focusTimerPending: focusTimer !== null,
      pendingRpcCount: pendingRpcTokens.size,
      disposed,
    };
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
    archiveGoal,
    deleteGoal,
    generateGoalHandoff,
    bindUi,
    dispose,
    getRuntimeSnapshot,
  };
}
