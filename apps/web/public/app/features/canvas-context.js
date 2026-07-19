export function createCanvasContextFeature({
  refs,
  getCanvasApp,
  getGoalsState,
  getActiveConversationId,
  getGoalById,
  normalizeGoalBoardId,
  getCachedGoalCapabilityEntry,
  goalRuntimeFilePath,
  escapeHtml,
  ensureGoalCapabilityCache,
  switchMode,
  loadGoals,
  openGoalTaskViewer,
  openConversationSession,
  openSourcePath,
  showNotice,
  getGoalDisplayName,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const { canvasContextBarEl } = refs;
  const pendingCapabilityRequests = new Set();
  let capabilityRequestGeneration = 0;
  let disposed = false;

  function goalBaseConversationId(goalId) {
    return `goal:${goalId}`;
  }

  function isGoalConversationId(conversationId) {
    return typeof conversationId === "string" && conversationId.startsWith("goal:");
  }

  function isConversationForGoal(conversationId, goalId) {
    return typeof conversationId === "string" && conversationId.startsWith(goalBaseConversationId(goalId));
  }

  function parseGoalConversationContext(conversationId) {
    if (!isGoalConversationId(conversationId)) return null;
    const normalizedConversationId = String(conversationId).trim();
    const match = /^goal:([^:]+)(?::node:([^:]+):run:([^:]+))?$/.exec(normalizedConversationId);
    if (!match) return null;
    return {
      goalId: match[1] || "",
      nodeId: match[2] || "",
      runId: match[3] || "",
      conversationId: normalizedConversationId,
    };
  }

  function findGoalByBoardId(boardId) {
    const goalsState = getGoalsState?.();
    return boardId && Array.isArray(goalsState?.items)
      ? goalsState.items.find((goal) => normalizeGoalBoardId(goal?.boardId) === boardId) || null
      : null;
  }

  function renderCanvasGoalContext() {
    if (disposed || !canvasContextBarEl) return;

    const canvasApp = getCanvasApp?.();
    const activeConversationId = getActiveConversationId?.() || "";
    const goalsState = getGoalsState?.() || {};
    const boardId = normalizeGoalBoardId(canvasApp?.currentBoardId);
    const conversation = parseGoalConversationContext(activeConversationId);
    const mappedGoal = findGoalByBoardId(boardId);
    const goalId = conversation?.goalId || mappedGoal?.id || "";
    const goal = goalId ? getGoalById(goalId) || mappedGoal : mappedGoal;
    const goalName = goal?.title || goalId || "";
    const activeNodeId = typeof goal?.activeNodeId === "string" ? goal.activeNodeId.trim() : "";
    const nodeId = conversation?.nodeId || activeNodeId;
    const runId = conversation?.runId || (typeof goal?.lastRunId === "string" ? goal.lastRunId.trim() : "");
    const capabilityEntry = goalId ? getCachedGoalCapabilityEntry(goalId) : null;
    const capabilityPlans = Array.isArray(capabilityEntry?.plans) ? capabilityEntry.plans : [];
    const capabilityPlan = capabilityPlans.find((plan) => plan.nodeId === nodeId)
      || capabilityPlans.find((plan) => plan.nodeId === activeNodeId)
      || capabilityPlans[0]
      || null;

    canvasApp?.setGoalContext?.({
      goalId: goalId || "",
      goalTitle: goalName || "",
      nodeId: nodeId || "",
      runId: runId || "",
      conversationId: conversation?.conversationId || "",
      boardId: boardId || "",
      capabilityPlanId: capabilityPlan?.id || "",
      capabilityMode: capabilityPlan?.executionMode || "",
      capabilityRisk: capabilityPlan?.riskLevel || "",
      capabilityStatus: capabilityPlan?.status || "",
      capabilityAlignment: capabilityPlan?.analysis?.status || "",
    });

    if (!boardId && !goalId && !conversation) {
      canvasContextBarEl.classList.add("hidden");
      canvasContextBarEl.innerHTML = "";
      return;
    }

    let note = t("canvasContext.defaultNote", {}, "You are currently in the canvas workspace.");
    if (conversation?.goalId && goalName) {
      note = nodeId
        ? t("canvasContext.jumpToNodeChannel", { goalName }, `This canvas can jump back to the node channel of ${goalName}.`)
        : t("canvasContext.jumpToGoalChannel", { goalName }, `This canvas can jump back to the goal channel of ${goalName}.`);
    } else if (goalName && boardId) {
      note = t("canvasContext.matchedGoalBoard", { goalName }, `This canvas is matched to the main board of long task ${goalName}.`);
    } else if (boardId) {
      note = t("canvasContext.unmatchedBoard", {}, "This canvas is not matched to a long task yet and can continue to be used independently.");
    }

    const actions = [];
    if (goalId) {
      actions.push(`<button class="canvas-tb-btn" data-canvas-open-goal-detail="${escapeHtml(goalId)}">${escapeHtml(t("canvasContext.openGoalDetail", {}, "打开长期任务详情"))}</button>`);
      actions.push(`<button class="canvas-tb-btn" data-canvas-open-goal-tasks="${escapeHtml(goalId)}">${escapeHtml(t("canvasContext.viewGoalTasks", {}, "查看长期任务任务记录"))}</button>`);
    }
    if (conversation?.conversationId) {
      actions.push(`
        <button
          class="canvas-tb-btn"
          data-canvas-open-conversation="${escapeHtml(conversation.conversationId)}"
          data-canvas-conversation-label="${escapeHtml(nodeId
            ? t("canvasContext.returnNodeChannelLabel", { goalName: goalName || goalId, nodeId }, `返回节点通道：${goalName || goalId} / ${nodeId}`)
            : t("canvasContext.returnGoalChannelLabel", { goalName: goalName || goalId }, `返回长期任务通道：${goalName || goalId}`))}"
        >
          ${escapeHtml(nodeId
            ? t("canvasContext.returnNodeChannelButton", {}, "返回当前节点通道")
            : t("canvasContext.returnGoalChannelButton", {}, "返回当前长期任务通道"))}
        </button>
      `);
    }
    if (goal?.runtimeRoot) {
      actions.push(`<button class="canvas-tb-btn" data-canvas-open-capability-source="${escapeHtml(goalRuntimeFilePath(goal, "capability-plans.json"))}">${escapeHtml(t("canvasContext.openCapabilityPlan", {}, "打开 capability-plans.json"))}</button>`);
    }

    const capabilityMeta = capabilityPlan ? `
      <span class="canvas-context-item canvas-context-item-capability">
        <span class="canvas-context-label">计划</span>
        <span class="canvas-context-value">${escapeHtml(capabilityPlan.nodeId || capabilityPlan.id)}</span>
      </span>
      <span class="canvas-context-item canvas-context-item-capability">
        <span class="canvas-context-label">模式</span>
        <span class="canvas-context-value">${escapeHtml(capabilityPlan.executionMode || "-")}</span>
      </span>
      <span class="canvas-context-item canvas-context-item-capability">
        <span class="canvas-context-label">风险</span>
        <span class="canvas-context-value">${escapeHtml(capabilityPlan.riskLevel || "-")}</span>
      </span>
      <span class="canvas-context-item canvas-context-item-capability">
        <span class="canvas-context-label">对齐</span>
        <span class="canvas-context-value">${escapeHtml(capabilityPlan.analysis?.status || "-")}</span>
      </span>
      <span class="canvas-context-note canvas-context-note-capability">${escapeHtml(capabilityPlan.summary || capabilityPlan.analysis?.summary || t("canvasContext.capabilityPlanHint", {}, "A capabilityPlan is available for the current node."))}</span>
    ` : goalId ? `
      <span class="canvas-context-note canvas-context-note-capability">${escapeHtml(capabilityEntry
        ? t("canvasContext.capabilityPlanMissing", {}, "The current goal has not matched a capabilityPlan for this node yet.")
        : t("canvasContext.capabilityPlanLoading", {}, "Loading capabilityPlan context..."))}</span>
    ` : "";

    canvasContextBarEl.classList.remove("hidden");
    canvasContextBarEl.innerHTML = `
      <div class="canvas-context-meta">
        <span class="canvas-context-item"><span class="canvas-context-label">${escapeHtml(t("canvasContext.boardLabel", {}, "Board"))}</span><span class="canvas-context-value">${escapeHtml(boardId || "-")}</span></span>
        <span class="canvas-context-item"><span class="canvas-context-label">${escapeHtml(t("canvasContext.goalLabel", {}, "Goal"))}</span><span class="canvas-context-value">${escapeHtml(goalName || "-")}</span></span>
        ${nodeId ? `<span class="canvas-context-item"><span class="canvas-context-label">${escapeHtml(t("canvasContext.nodeLabel", {}, "Node"))}</span><span class="canvas-context-value">${escapeHtml(nodeId)}</span></span>` : ""}
        ${runId ? `<span class="canvas-context-item"><span class="canvas-context-label">${escapeHtml(t("canvasContext.runLabel", {}, "Run"))}</span><span class="canvas-context-value">${escapeHtml(runId)}</span></span>` : ""}
        ${capabilityMeta}
        <span class="canvas-context-note">${escapeHtml(note)}</span>
      </div>
      <div class="canvas-context-actions">
        ${actions.join("")}
      </div>
    `;

    canvasContextBarEl.querySelectorAll("[data-canvas-open-goal-detail]").forEach((node) => {
      node.addEventListener("click", async () => {
        const nextGoalId = node.getAttribute("data-canvas-open-goal-detail");
        if (!nextGoalId) return;
        switchMode("goals");
        await loadGoals(true, nextGoalId);
      });
    });
    canvasContextBarEl.querySelectorAll("[data-canvas-open-goal-tasks]").forEach((node) => {
      node.addEventListener("click", async () => {
        const nextGoalId = node.getAttribute("data-canvas-open-goal-tasks");
        if (!nextGoalId) return;
        await openGoalTaskViewer(nextGoalId);
      });
    });
    canvasContextBarEl.querySelectorAll("[data-canvas-open-conversation]").forEach((node) => {
      node.addEventListener("click", () => {
        const conversationId = node.getAttribute("data-canvas-open-conversation");
        if (!conversationId) return;
        const hint = node.getAttribute("data-canvas-conversation-label") || undefined;
        openConversationSession(conversationId, hint);
      });
    });
    canvasContextBarEl.querySelectorAll("[data-canvas-open-capability-source]").forEach((node) => {
      node.addEventListener("click", () => {
        const sourcePath = node.getAttribute("data-canvas-open-capability-source");
        if (!sourcePath) return;
        void openSourcePath(sourcePath);
      });
    });

    if (goal && goalId && (!capabilityEntry || (nodeId && !capabilityPlan)) && !goalsState.capabilityPending?.[goalId]) {
      const requestToken = {};
      const requestGeneration = capabilityRequestGeneration;
      pendingCapabilityRequests.add(requestToken);
      let capabilityRequest;
      try {
        capabilityRequest = ensureGoalCapabilityCache(goal, { forceReload: Boolean(capabilityEntry) });
      } catch {
        pendingCapabilityRequests.delete(requestToken);
        return;
      }
      void Promise.resolve(capabilityRequest).then(() => {
        // 当前上下文与 owner 都有效时才允许异步能力结果触发二次渲染。
        if (disposed || requestGeneration !== capabilityRequestGeneration) return;
        const latestCanvasApp = getCanvasApp?.();
        const latestBoardId = normalizeGoalBoardId(latestCanvasApp?.currentBoardId);
        const latestConversation = parseGoalConversationContext(getActiveConversationId?.() || "");
        const latestGoalId = latestConversation?.goalId || findGoalByBoardId(latestBoardId)?.id || "";
        if (latestGoalId === goalId) {
          renderCanvasGoalContext();
        }
      }).catch(() => {}).finally(() => {
        pendingCapabilityRequests.delete(requestToken);
      });
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    capabilityRequestGeneration += 1;
    if (!canvasContextBarEl) return;
    canvasContextBarEl.classList.add("hidden");
    canvasContextBarEl.innerHTML = "";
  }

  function getRuntimeSnapshot() {
    return {
      capabilityRequestGeneration,
      disposed,
      pendingCapabilityRequestCount: pendingCapabilityRequests.size,
    };
  }

  async function openGoalCanvasList(goalId) {
    const canvasApp = getCanvasApp?.();
    if (!canvasApp) {
      showNotice(
        t("canvasContext.canvasUnavailableTitle", {}, "Canvas unavailable"),
        t("canvasContext.canvasUnavailableMessage", {}, "The frontend Canvas component is not initialized yet."),
        "error",
      );
      return;
    }

    switchMode("canvas");
    await canvasApp.showBoardList();
    if (goalId) {
      showNotice(
        t("canvasContext.switchedToBoardListTitle", {}, "Switched to canvas list"),
        t("canvasContext.switchedToBoardListMessage", { goalName: getGoalDisplayName(goalId) }, `You can continue with the main board of ${getGoalDisplayName(goalId)} from the canvas list.`),
        "info",
        2200,
      );
    }
  }

  async function openGoalCanvasBoard(boardId, goalId) {
    const canvasApp = getCanvasApp?.();
    if (!canvasApp) {
      showNotice(
        t("canvasContext.canvasUnavailableTitle", {}, "Canvas unavailable"),
        t("canvasContext.canvasUnavailableMessage", {}, "The frontend Canvas component is not initialized yet."),
        "error",
      );
      return;
    }

    const normalizedBoardId = normalizeGoalBoardId(boardId);
    if (!normalizedBoardId) {
      await openGoalCanvasList(goalId);
      return;
    }

    switchMode("canvas");
    await canvasApp.openBoard(normalizedBoardId);

    if (canvasApp.currentBoardId === normalizedBoardId && canvasApp.manager?.board) {
      canvasApp._showCanvasView?.();
      return;
    }

    await canvasApp.showBoardList();
    showNotice(
      t("canvasContext.linkedBoardMissingTitle", {}, "Linked canvas not found"),
      t("canvasContext.linkedBoardMissingMessage", { boardId: normalizedBoardId }, `Unable to open ${normalizedBoardId}. Switched to the canvas list.`),
      "error",
      3200,
    );
  }

  return {
    goalBaseConversationId,
    isGoalConversationId,
    isConversationForGoal,
    parseGoalConversationContext,
    renderCanvasGoalContext,
    dispose,
    getRuntimeSnapshot,
    refreshLocale() {
      renderCanvasGoalContext();
    },
    openGoalCanvasList,
    openGoalCanvasBoard,
  };
}
