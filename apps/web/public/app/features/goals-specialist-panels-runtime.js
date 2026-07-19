import { decodeContinuationAction } from "./continuation-targets.js";
import { createGoalsSpecialistCapabilityCacheReadLifecycle } from "./goals-specialist-capability-cache-read-lifecycle.js";
import { createGoalsSpecialistCapabilityPanelReadLifecycle } from "./goals-specialist-capability-panel-read-lifecycle.js";
import { createGoalsSpecialistCanvasReadLifecycle } from "./goals-specialist-canvas-read-lifecycle.js";
import { createGoalsSpecialistGovernanceReadLifecycle } from "./goals-specialist-governance-read-lifecycle.js";
import { createGoalsSpecialistHandoffReadLifecycle } from "./goals-specialist-handoff-read-lifecycle.js";
import { createGoalsSpecialistPanelControlsFeature } from "./goals-specialist-panel-controls.js";
import { createGoalsSpecialistProgressReadLifecycle } from "./goals-specialist-progress-read-lifecycle.js";
import { createGoalsSpecialistTrackingReadLifecycle } from "./goals-specialist-tracking-read-lifecycle.js";

function parseStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter(Boolean);
}

function parseLearningReviewInput(rawInput) {
  if (!rawInput || typeof rawInput !== "object") return null;
  const summary = rawInput.summary && typeof rawInput.summary === "object" ? rawInput.summary : {};
  return {
    summary: {
      available: summary.available === true,
      headline: summary.headline ? String(summary.headline) : "",
      memorySignalCount: Number(summary.memorySignalCount || 0),
      candidateSignalCount: Number(summary.candidateSignalCount || 0),
      reviewSignalCount: Number(summary.reviewSignalCount || 0),
      nudgeCount: Number(summary.nudgeCount || 0),
    },
    summaryLines: parseStringList(rawInput.summaryLines),
    nudges: parseStringList(rawInput.nudges),
  };
}

function parseMemoryFreshness(rawFreshness) {
  if (!rawFreshness || typeof rawFreshness !== "object") return null;
  const summary = rawFreshness.summary && typeof rawFreshness.summary === "object" ? rawFreshness.summary : {};
  const items = Array.isArray(rawFreshness.items) ? rawFreshness.items : [];
  return {
    summary: {
      available: summary.available === true,
      headline: summary.headline ? String(summary.headline) : "",
      reviewRequiredCount: Number(summary.reviewRequiredCount || 0),
      freshCount: Number(summary.freshCount || 0),
      activeCount: Number(summary.activeCount || 0),
      staleCount: Number(summary.staleCount || 0),
      supersededCount: Number(summary.supersededCount || 0),
    },
    items: items
      .map((item) => item && typeof item === "object" ? item : null)
      .filter(Boolean),
  };
}

function parseGoalProgressEntries(rawContent) {
  if (typeof rawContent !== "string" || !rawContent.trim()) return [];
  const entries = [];
  const sections = rawContent.split(/^##\s+/m).filter(Boolean);
  for (const section of sections) {
    const newlineIndex = section.indexOf("\n");
    const at = newlineIndex >= 0 ? section.slice(0, newlineIndex).trim() : section.trim();
    const body = newlineIndex >= 0 ? section.slice(newlineIndex + 1) : "";
    const lines = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const data = {};
    for (const line of lines) {
      const itemMatch = /^-\s+([^:]+):\s*(.*)$/.exec(line);
      if (!itemMatch) continue;
      data[itemMatch[1].trim().toLowerCase()] = itemMatch[2].trim();
    }
    entries.push({
      at,
      event: data.event || "",
      title: data.title || "",
      nodeId: data.node || "",
      status: data.status || "",
      runId: data.run || "",
      checkpointId: data.checkpoint || "",
      summary: data.summary || "",
      note: data.note || "",
    });
  }
  return entries;
}

function normalizeGoalBoardId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function parseGoalBoardRef(rawBoardRef) {
  const item = rawBoardRef && typeof rawBoardRef === "object" ? rawBoardRef : {};
  return {
    boardId: normalizeGoalBoardId(item.boardId || item.id),
    linkedAt: typeof item.linkedAt === "string" && item.linkedAt.trim() ? item.linkedAt.trim() : "",
    updatedAt: typeof item.updatedAt === "string" && item.updatedAt.trim() ? item.updatedAt.trim() : "",
  };
}

function parseGoalReviewGovernanceSummary(rawSummary, parseGoalCheckpoints) {
  if (!rawSummary || typeof rawSummary !== "object") return null;
  const summary = rawSummary;
  const governanceConfig = summary.governanceConfig && typeof summary.governanceConfig === "object" ? summary.governanceConfig : {};
  const publishRecordsState = summary.publishRecords && typeof summary.publishRecords === "object" ? summary.publishRecords : {};
  const notificationsState = summary.notifications && typeof summary.notifications === "object" ? summary.notifications : {};
  const dispatchesState = summary.notificationDispatches && typeof summary.notificationDispatches === "object" ? summary.notificationDispatches : {};
  const actionableReviews = Array.isArray(summary.actionableReviews) ? summary.actionableReviews : [];
  const overdueReviews = Array.isArray(summary.overdueReviews) ? summary.overdueReviews : [];
  const publishRecordItems = Array.isArray(publishRecordsState.items) ? publishRecordsState.items : [];
  const templates = Array.isArray(governanceConfig.templates) ? governanceConfig.templates : [];
  const reviewers = Array.isArray(governanceConfig.reviewers) ? governanceConfig.reviewers : [];
  const notifications = Array.isArray(notificationsState.items) ? notificationsState.items : [];
  const dispatches = Array.isArray(dispatchesState.items) ? dispatchesState.items : [];
  const publishRecords = publishRecordItems.map((item, index) => {
    const data = item && typeof item === "object" ? item : {};
    return {
      id: data.id ? String(data.id) : `publish-record-${index + 1}`,
      reviewId: data.reviewId ? String(data.reviewId) : "",
      suggestionType: data.suggestionType ? String(data.suggestionType) : "",
      suggestionId: data.suggestionId ? String(data.suggestionId) : "",
      experienceCandidateId: data.experienceCandidateId ? String(data.experienceCandidateId) : "",
      publishedPath: data.publishedPath ? String(data.publishedPath) : "",
      title: data.title ? String(data.title) : "",
    };
  });
  const experienceCandidateMap = new Map(
    publishRecords
      .filter((item) => item.suggestionType && item.suggestionId && item.experienceCandidateId)
      .map((item) => [`${item.suggestionType}:${item.suggestionId}`, item.experienceCandidateId]),
  );
  const normalizeExperienceType = (value) => {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (normalized === "skill_candidate") return "skill";
    if (normalized === "method_candidate") return "method";
    return "";
  };
  return {
    generatedAt: summary.generatedAt ? String(summary.generatedAt) : "",
    summary: summary.summary ? String(summary.summary) : "",
    governanceConfigPath: summary.governanceConfigPath ? String(summary.governanceConfigPath) : "",
    notificationsPath: summary.notificationsPath ? String(summary.notificationsPath) : "",
    notificationDispatchesPath: summary.notificationDispatchesPath ? String(summary.notificationDispatchesPath) : "",
    notificationDispatchCounts: summary.notificationDispatchCounts && typeof summary.notificationDispatchCounts === "object"
      ? summary.notificationDispatchCounts
      : { total: dispatches.length, byChannel: {}, byStatus: {} },
    reviewStatusCounts: summary.reviewStatusCounts && typeof summary.reviewStatusCounts === "object" ? summary.reviewStatusCounts : {},
    reviewTypeCounts: summary.reviewTypeCounts && typeof summary.reviewTypeCounts === "object" ? summary.reviewTypeCounts : {},
    workflowPendingCount: Number(summary.workflowPendingCount || 0),
    workflowOverdueCount: Number(summary.workflowOverdueCount || 0),
    checkpointWorkflowPendingCount: Number(summary.checkpointWorkflowPendingCount || 0),
    checkpointWorkflowOverdueCount: Number(summary.checkpointWorkflowOverdueCount || 0),
    commanderFocus: summary.commanderFocus && typeof summary.commanderFocus === "object"
      ? {
        goalId: summary.commanderFocus.goalId ? String(summary.commanderFocus.goalId) : "",
        nodeId: summary.commanderFocus.nodeId ? String(summary.commanderFocus.nodeId) : "",
        runId: summary.commanderFocus.runId ? String(summary.commanderFocus.runId) : "",
        planId: summary.commanderFocus.planId ? String(summary.commanderFocus.planId) : "",
        nodeTitle: summary.commanderFocus.nodeTitle ? String(summary.commanderFocus.nodeTitle) : "",
        governanceMode: summary.commanderFocus.governanceMode ? String(summary.commanderFocus.governanceMode) : "direct",
        executionMode: summary.commanderFocus.executionMode ? String(summary.commanderFocus.executionMode) : "single_agent",
        commanderAgentId: summary.commanderFocus.commanderAgentId ? String(summary.commanderFocus.commanderAgentId) : "",
        reviewStatus: summary.commanderFocus.reviewStatus ? String(summary.commanderFocus.reviewStatus) : "pending",
        finalApprovalMode: summary.commanderFocus.finalApprovalMode ? String(summary.commanderFocus.finalApprovalMode) : "",
        reworkRevisionCount: Number.isFinite(summary.commanderFocus.reworkRevisionCount) ? Number(summary.commanderFocus.reworkRevisionCount) : 0,
        lastReworkReason: summary.commanderFocus.lastReworkReason ? String(summary.commanderFocus.lastReworkReason) : "",
        lastReworkAt: summary.commanderFocus.lastReworkAt ? String(summary.commanderFocus.lastReworkAt) : "",
        reworkTargetAgentIds: parseStringList(summary.commanderFocus.reworkTargetAgentIds),
        reworkContext: summary.commanderFocus.reworkContext && typeof summary.commanderFocus.reworkContext === "object"
          ? {
            quickSummary: summary.commanderFocus.reworkContext.quickSummary ? String(summary.commanderFocus.reworkContext.quickSummary) : "",
            historySummary: summary.commanderFocus.reworkContext.historySummary ? String(summary.commanderFocus.reworkContext.historySummary) : "",
            persistedReason: summary.commanderFocus.reworkContext.persistedReason ? String(summary.commanderFocus.reworkContext.persistedReason) : "",
          }
          : null,
        fanInSummary: summary.commanderFocus.fanInSummary ? String(summary.commanderFocus.fanInSummary) : "",
        managerActionHint: summary.commanderFocus.managerActionHint ? String(summary.commanderFocus.managerActionHint) : "",
        reasons: parseStringList(summary.commanderFocus.reasons),
        checkLines: parseStringList(summary.commanderFocus.checkLines),
        nextAction: summary.commanderFocus.nextAction ? String(summary.commanderFocus.nextAction) : "",
        reviewPath: summary.commanderFocus.reviewPath ? String(summary.commanderFocus.reviewPath) : "",
        commanderPlanPath: summary.commanderFocus.commanderPlanPath ? String(summary.commanderFocus.commanderPlanPath) : "",
        workOrderPaths: parseStringList(summary.commanderFocus.workOrderPaths),
        delegationResults: Array.isArray(summary.commanderFocus.delegationResults)
          ? summary.commanderFocus.delegationResults.map((item) => {
            const data = item && typeof item === "object" ? item : {};
            return {
              agentId: data.agentId ? String(data.agentId) : "",
              role: data.role ? String(data.role) : "",
              status: data.status ? String(data.status) : "",
              summary: data.summary ? String(data.summary) : "",
              taskId: data.taskId ? String(data.taskId) : "",
              outputPath: data.outputPath ? String(data.outputPath) : "",
            };
          }).filter((item) => item.agentId)
          : [],
      }
      : null,
    publishRecords,
    templates: templates.map((item, index) => {
      const data = item && typeof item === "object" ? item : {};
      return {
        id: data.id ? String(data.id) : `template-${index + 1}`,
        title: data.title ? String(data.title) : data.id ? String(data.id) : `template-${index + 1}`,
        target: data.target ? String(data.target) : "all",
        mode: data.mode ? String(data.mode) : "single",
      };
    }),
    reviewers: reviewers.map((item, index) => {
      const data = item && typeof item === "object" ? item : {};
      return {
        id: data.id ? String(data.id) : `reviewer-${index + 1}`,
        name: data.name ? String(data.name) : data.id ? String(data.id) : `reviewer-${index + 1}`,
        reviewerRole: data.reviewerRole ? String(data.reviewerRole) : "",
      };
    }),
    notifications: notifications.map((item, index) => {
      const data = item && typeof item === "object" ? item : {};
      return {
        id: data.id ? String(data.id) : `notification-${index + 1}`,
        kind: data.kind ? String(data.kind) : "sla_reminder",
        targetType: data.targetType ? String(data.targetType) : "suggestion_review",
        targetId: data.targetId ? String(data.targetId) : "",
        recipient: data.recipient ? String(data.recipient) : "",
        message: data.message ? String(data.message) : "",
        createdAt: data.createdAt ? String(data.createdAt) : "",
      };
    }),
    notificationDispatches: dispatches.map((item, index) => {
      const data = item && typeof item === "object" ? item : {};
      return {
        id: data.id ? String(data.id) : `dispatch-${index + 1}`,
        notificationId: data.notificationId ? String(data.notificationId) : "",
        channel: data.channel ? String(data.channel) : "goal_detail",
        status: data.status ? String(data.status) : "pending",
        targetType: data.targetType ? String(data.targetType) : "suggestion_review",
        targetId: data.targetId ? String(data.targetId) : "",
        recipient: data.recipient ? String(data.recipient) : "",
        routeKey: data.routeKey ? String(data.routeKey) : "",
        message: data.message ? String(data.message) : "",
        createdAt: data.createdAt ? String(data.createdAt) : "",
        updatedAt: data.updatedAt ? String(data.updatedAt) : "",
      };
    }),
    learningReviewInput: parseLearningReviewInput(summary.learningReviewInput),
    recommendations: parseStringList(summary.recommendations),
    actionableReviews: actionableReviews.map((item, index) => {
      const data = item && typeof item === "object" ? item : {};
      const suggestionType = data.suggestionType ? String(data.suggestionType) : "method_candidate";
      const suggestionId = data.suggestionId ? String(data.suggestionId) : "";
      return {
        id: data.id ? String(data.id) : `review-${index + 1}`,
        title: data.title ? String(data.title) : data.id ? String(data.id) : `review-${index + 1}`,
        suggestionType,
        status: data.status ? String(data.status) : "pending_review",
        reviewer: data.reviewer ? String(data.reviewer) : "",
        nodeId: data.nodeId ? String(data.nodeId) : "",
        suggestionId,
        updatedAt: data.updatedAt ? String(data.updatedAt) : "",
        experienceType: normalizeExperienceType(suggestionType),
        experienceCandidateId: experienceCandidateMap.get(`${suggestionType}:${suggestionId}`) || "",
      };
    }),
    overdueReviews: overdueReviews.map((item, index) => {
      const data = item && typeof item === "object" ? item : {};
      return {
        id: data.id ? String(data.id) : `overdue-review-${index + 1}`,
        title: data.title ? String(data.title) : data.id ? String(data.id) : `overdue-review-${index + 1}`,
        suggestionType: data.suggestionType ? String(data.suggestionType) : "method_candidate",
        status: data.status ? String(data.status) : "pending_review",
      };
    }),
    actionableCheckpoints: parseGoalCheckpoints({
      items: Array.isArray(summary.actionableCheckpoints) ? summary.actionableCheckpoints : [],
    }),
  };
}

function normalizeGoalNodeStatus(status) {
  const normalized = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (!normalized) return "pending";
  if (["done", "completed", "complete", "success", "succeeded", "approved"].includes(normalized)) return "completed";
  if (["running", "executing", "in_progress", "processing"].includes(normalized)) return "running";
  if (["blocked", "failed", "error"].includes(normalized)) return "blocked";
  return normalized;
}

function normalizeCheckpointStatus(status) {
  const normalized = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (!normalized) return "required";
  return normalized;
}

function parseGoalGraphNodes(rawGraph) {
  if (!rawGraph || typeof rawGraph !== "object") return [];
  const rawNodes = Array.isArray(rawGraph.nodes)
    ? rawGraph.nodes
    : rawGraph.nodes && typeof rawGraph.nodes === "object"
      ? Object.values(rawGraph.nodes)
      : [];
  return rawNodes.map((node, index) => {
    const item = node && typeof node === "object" ? node : {};
    const data = item.data && typeof item.data === "object" ? item.data : {};
    const id = item.id || data.id || `node-${index + 1}`;
    const title = item.title || data.title || item.name || data.name || id;
    const status = normalizeGoalNodeStatus(item.status || data.status);
    const phase = item.phase || data.phase || item.stage || data.stage || "";
    const owner = item.owner || data.owner || "";
    const lastRunId = item.lastRunId || data.lastRunId || "";
    const summary = item.summary || data.summary || "";
    const artifacts = Array.isArray(item.artifacts)
      ? item.artifacts
      : Array.isArray(data.artifacts)
        ? data.artifacts
        : [];
    return {
      id: String(id),
      title: String(title),
      status,
      phase: phase ? String(phase) : "",
      owner: owner ? String(owner) : "",
      lastRunId: lastRunId ? String(lastRunId) : "",
      summary: summary ? String(summary) : "",
      artifacts: artifacts
        .map((artifact) => typeof artifact === "string" ? artifact.trim() : "")
        .filter(Boolean),
    };
  });
}

function normalizeGoalTrackingTaskId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function collectGoalTrackingRuntimeTaskIds(nodes, focusNodeId = "", limit = 6) {
  const allNodes = Array.isArray(nodes) ? nodes : [];
  const normalizedFocusNodeId = typeof focusNodeId === "string" && focusNodeId.trim() ? focusNodeId.trim() : "";
  const recentNodes = allNodes.slice(0, Math.max(limit, 0));

  if (normalizedFocusNodeId && !recentNodes.some((node) => normalizeGoalBoardId(node?.id) === normalizedFocusNodeId)) {
    const focusNode = allNodes.find((node) => normalizeGoalBoardId(node?.id) === normalizedFocusNodeId);
    if (focusNode) {
      recentNodes.push(focusNode);
    }
  }

  return [...new Set(
    recentNodes
      .map((node) => normalizeGoalTrackingTaskId(node?.lastRunId))
      .filter(Boolean),
  )];
}

export function mergeGoalTrackingRuntimeIndex(nodes, runtimeIndex) {
  const runtimeMap = runtimeIndex && typeof runtimeIndex === "object" ? runtimeIndex : {};
  return (Array.isArray(nodes) ? nodes : []).map((node) => {
    const taskId = normalizeGoalTrackingTaskId(node?.lastRunId);
    const runtime = taskId ? runtimeMap[taskId] : null;
    if (!runtime || typeof runtime !== "object") return node;
    const bridgeSubtaskView = runtime.bridgeSubtaskView && typeof runtime.bridgeSubtaskView === "object"
      ? runtime.bridgeSubtaskView
      : null;
    const bridgeSessionView = runtime.bridgeSessionView && typeof runtime.bridgeSessionView === "object"
      ? runtime.bridgeSessionView
      : null;
    if (!bridgeSubtaskView && !bridgeSessionView) return node;
    return {
      ...node,
      ...(bridgeSubtaskView ? { bridgeSubtaskView } : {}),
      ...(bridgeSessionView ? { bridgeSessionView } : {}),
    };
  });
}

function buildGoalBridgeGovernanceItemLines(node) {
  const bridgeSubtaskView = node?.bridgeSubtaskView && typeof node.bridgeSubtaskView === "object"
    ? node.bridgeSubtaskView
    : null;
  const bridgeSessionView = node?.bridgeSessionView && typeof node.bridgeSessionView === "object"
    ? node.bridgeSessionView
    : null;
  const lines = [];
  if (bridgeSubtaskView?.summaryLine) {
    lines.push(bridgeSubtaskView.summaryLine);
  }
  if (bridgeSessionView?.summaryLine && bridgeSessionView.summaryLine !== bridgeSubtaskView?.summaryLine) {
    lines.push(bridgeSessionView.summaryLine);
  }
  return lines;
}

function getGoalBridgeGovernanceSeverity(runtimeState, blockReason) {
  if (runtimeState === "runtime-lost") return 0;
  if (runtimeState === "orphaned") return 1;
  if (blockReason) return 2;
  if (runtimeState === "active") return 3;
  if (runtimeState === "closed") return 4;
  return 5;
}

export function buildGoalBridgeGovernanceSummary(nodes, itemLimit = 4) {
  const mergedNodes = Array.isArray(nodes) ? nodes : [];
  const bridgeNodes = mergedNodes
    .map((node, index) => {
      const bridgeSubtaskView = node?.bridgeSubtaskView && typeof node.bridgeSubtaskView === "object"
        ? node.bridgeSubtaskView
        : null;
      const bridgeSessionView = node?.bridgeSessionView && typeof node.bridgeSessionView === "object"
        ? node.bridgeSessionView
        : null;
      if (!bridgeSubtaskView && !bridgeSessionView) return null;
      const runtimeState = typeof bridgeSessionView?.runtimeState === "string" ? bridgeSessionView.runtimeState.trim() : "";
      const blockReason = typeof bridgeSessionView?.blockReason === "string" ? bridgeSessionView.blockReason.trim() : "";
      const artifactPath = typeof bridgeSessionView?.artifactPath === "string" ? bridgeSessionView.artifactPath.trim() : "";
      const transcriptPath = typeof bridgeSessionView?.transcriptPath === "string" ? bridgeSessionView.transcriptPath.trim() : "";
      return {
        order: index,
        nodeId: normalizeGoalBoardId(node?.id) || `node-${index + 1}`,
        title: typeof node?.title === "string" && node.title.trim() ? node.title.trim() : normalizeGoalBoardId(node?.id) || `node-${index + 1}`,
        taskId: normalizeGoalTrackingTaskId(node?.lastRunId),
        runtimeState,
        closeReason: typeof bridgeSessionView?.closeReason === "string" ? bridgeSessionView.closeReason.trim() : "",
        blockReason,
        artifactPath,
        transcriptPath,
        summaryLines: buildGoalBridgeGovernanceItemLines(node),
      };
    })
    .filter(Boolean);

  if (!bridgeNodes.length) return null;

  const items = bridgeNodes
    .slice()
    .sort((left, right) => {
      const severity = getGoalBridgeGovernanceSeverity(left.runtimeState, left.blockReason)
        - getGoalBridgeGovernanceSeverity(right.runtimeState, right.blockReason);
      if (severity !== 0) return severity;
      return left.order - right.order;
    })
    .slice(0, Math.max(itemLimit, 0))
    .map(({ order, ...item }) => item);

  return {
    bridgeNodeCount: bridgeNodes.length,
    activeCount: bridgeNodes.filter((item) => item.runtimeState === "active").length,
    runtimeLostCount: bridgeNodes.filter((item) => item.runtimeState === "runtime-lost").length,
    orphanedCount: bridgeNodes.filter((item) => item.runtimeState === "orphaned").length,
    closedCount: bridgeNodes.filter((item) => item.runtimeState === "closed").length,
    blockedCount: bridgeNodes.filter((item) => Boolean(item.blockReason)).length,
    artifactCount: bridgeNodes.filter((item) => Boolean(item.artifactPath)).length,
    transcriptCount: bridgeNodes.filter((item) => Boolean(item.transcriptPath)).length,
    items,
  };
}

function parseGoalCheckpoints(rawCheckpoints) {
  if (!rawCheckpoints || typeof rawCheckpoints !== "object") return [];
  const items = Array.isArray(rawCheckpoints.items) ? rawCheckpoints.items : [];
  return items.map((item, index) => {
    const data = item && typeof item === "object" ? item : {};
    const id = data.id || `checkpoint-${index + 1}`;
    const title = data.title || data.summary || id;
    const history = Array.isArray(data.history)
      ? data.history.map((entry, historyIndex) => {
        const historyItem = entry && typeof entry === "object" ? entry : {};
        return {
          action: historyItem.action ? String(historyItem.action) : `history-${historyIndex + 1}`,
          status: normalizeCheckpointStatus(historyItem.status),
          at: historyItem.at ? String(historyItem.at) : "",
          summary: historyItem.summary ? String(historyItem.summary) : "",
          note: historyItem.note ? String(historyItem.note) : "",
          actor: historyItem.actor ? String(historyItem.actor) : "",
          reviewer: historyItem.reviewer ? String(historyItem.reviewer) : "",
          reviewerRole: historyItem.reviewerRole ? String(historyItem.reviewerRole) : "",
          requestedBy: historyItem.requestedBy ? String(historyItem.requestedBy) : "",
          decidedBy: historyItem.decidedBy ? String(historyItem.decidedBy) : "",
          slaAt: historyItem.slaAt ? String(historyItem.slaAt) : "",
          runId: historyItem.runId ? String(historyItem.runId) : "",
        };
      })
      : [];
    return {
      id: String(id),
      title: String(title),
      status: normalizeCheckpointStatus(data.status),
      updatedAt: data.updatedAt ? String(data.updatedAt) : "",
      requestedAt: data.requestedAt ? String(data.requestedAt) : "",
      decidedAt: data.decidedAt ? String(data.decidedAt) : "",
      summary: data.summary ? String(data.summary) : "",
      note: data.note ? String(data.note) : "",
      reviewer: data.reviewer ? String(data.reviewer) : "",
      reviewerRole: data.reviewerRole ? String(data.reviewerRole) : "",
      requestedBy: data.requestedBy ? String(data.requestedBy) : "",
      decidedBy: data.decidedBy ? String(data.decidedBy) : "",
      slaAt: data.slaAt ? String(data.slaAt) : "",
      nodeId: data.nodeId ? String(data.nodeId) : "",
      runId: data.runId ? String(data.runId) : "",
      workflow: data.workflow && typeof data.workflow === "object" ? data.workflow : null,
      history,
    };
  });
}

function normalizeGoalCapabilityPlanStatus(status) {
  const normalized = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (normalized === "orchestrated") return "orchestrated";
  return "planned";
}

function normalizeGoalCapabilityExecutionMode(mode) {
  const normalized = typeof mode === "string" ? mode.trim().toLowerCase() : "";
  return normalized === "multi_agent" ? "multi_agent" : "single_agent";
}

function normalizeGoalCapabilityRiskLevel(level) {
  const normalized = typeof level === "string" ? level.trim().toLowerCase() : "";
  if (normalized === "high") return "high";
  if (normalized === "medium") return "medium";
  return "low";
}

function parseGoalCapabilityPlans(rawPlans) {
  if (!rawPlans || typeof rawPlans !== "object") return [];
  const items = Array.isArray(rawPlans.items) ? rawPlans.items : [];
  return items
    .map((item, index) => {
      const data = item && typeof item === "object" ? item : {};
      const checkpoint = data.checkpoint && typeof data.checkpoint === "object" ? data.checkpoint : {};
      const actualUsage = data.actualUsage && typeof data.actualUsage === "object" ? data.actualUsage : {};
      const analysis = data.analysis && typeof data.analysis === "object" ? data.analysis : {};
      const orchestration = data.orchestration && typeof data.orchestration === "object" ? data.orchestration : {};
      const coordinationPlan = orchestration.coordinationPlan && typeof orchestration.coordinationPlan === "object"
        ? orchestration.coordinationPlan
        : {};
      const rolePolicy = coordinationPlan.rolePolicy && typeof coordinationPlan.rolePolicy === "object"
        ? coordinationPlan.rolePolicy
        : {};
      const verifierHandoff = orchestration.verifierHandoff && typeof orchestration.verifierHandoff === "object"
        ? orchestration.verifierHandoff
        : {};
      const verifierResult = orchestration.verifierResult && typeof orchestration.verifierResult === "object"
        ? orchestration.verifierResult
        : {};
      const methods = Array.isArray(data.methods) ? data.methods : [];
      const skills = Array.isArray(data.skills) ? data.skills : [];
      const mcpServers = Array.isArray(data.mcpServers) ? data.mcpServers : [];
      const subAgents = Array.isArray(data.subAgents) ? data.subAgents : [];
      const deviations = Array.isArray(analysis.deviations) ? analysis.deviations : [];
      const delegationResults = Array.isArray(orchestration.delegationResults) ? orchestration.delegationResults : [];
      const verifierFindings = Array.isArray(verifierResult.findings) ? verifierResult.findings : [];
      return {
        id: data.id ? String(data.id) : `plan-${index + 1}`,
        goalId: data.goalId ? String(data.goalId) : "",
        nodeId: data.nodeId ? String(data.nodeId) : "",
        runId: data.runId ? String(data.runId) : "",
        status: normalizeGoalCapabilityPlanStatus(data.status),
        executionMode: normalizeGoalCapabilityExecutionMode(data.executionMode),
        governanceMode: data.governanceMode ? String(data.governanceMode) : "direct",
        commanderAgentId: data.commanderAgentId ? String(data.commanderAgentId) : "",
        preferredAgents: parseStringList(data.preferredAgents),
        riskLevel: normalizeGoalCapabilityRiskLevel(data.riskLevel),
        objective: data.objective ? String(data.objective) : "",
        summary: data.summary ? String(data.summary) : "",
        queryHints: parseStringList(data.queryHints),
        reasoning: parseStringList(data.reasoning),
        methods: methods
          .map((entry) => entry && typeof entry === "object" ? {
            file: entry.file ? String(entry.file) : "",
            title: entry.title ? String(entry.title) : "",
            score: Number.isFinite(entry.score) ? Number(entry.score) : null,
            reason: entry.reason ? String(entry.reason) : "",
          } : null)
          .filter((entry) => entry && entry.file),
        skills: skills
          .map((entry) => entry && typeof entry === "object" ? {
            name: entry.name ? String(entry.name) : "",
            description: entry.description ? String(entry.description) : "",
            score: Number.isFinite(entry.score) ? Number(entry.score) : null,
            priority: entry.priority ? String(entry.priority) : "",
            source: entry.source ? String(entry.source) : "",
            reason: entry.reason ? String(entry.reason) : "",
          } : null)
          .filter((entry) => entry && entry.name),
        mcpServers: mcpServers
          .map((entry) => entry && typeof entry === "object" ? {
            serverId: entry.serverId ? String(entry.serverId) : "",
            status: entry.status ? String(entry.status) : "unknown",
            toolCount: Number.isFinite(entry.toolCount) ? Number(entry.toolCount) : null,
            resourceCount: Number.isFinite(entry.resourceCount) ? Number(entry.resourceCount) : null,
            reason: entry.reason ? String(entry.reason) : "",
          } : null)
          .filter((entry) => entry && entry.serverId),
        subAgents: subAgents
          .map((entry) => entry && typeof entry === "object" ? {
            agentId: entry.agentId ? String(entry.agentId) : "",
            role: entry.role ? String(entry.role) : "",
            objective: entry.objective ? String(entry.objective) : "",
            reason: entry.reason ? String(entry.reason) : "",
            deliverable: entry.deliverable ? String(entry.deliverable) : "",
            handoffToVerifier: entry.handoffToVerifier === true,
          } : null)
          .filter((entry) => entry && entry.agentId && entry.objective),
        gaps: parseStringList(data.gaps),
        checkpoint: {
          required: checkpoint.required === true,
          reasons: parseStringList(checkpoint.reasons),
          approvalMode: checkpoint.approvalMode ? String(checkpoint.approvalMode) : "none",
          requiredRequestFields: parseStringList(checkpoint.requiredRequestFields),
          requiredDecisionFields: parseStringList(checkpoint.requiredDecisionFields),
          suggestedTitle: checkpoint.suggestedTitle ? String(checkpoint.suggestedTitle) : "",
          suggestedNote: checkpoint.suggestedNote ? String(checkpoint.suggestedNote) : "",
          suggestedReviewer: checkpoint.suggestedReviewer ? String(checkpoint.suggestedReviewer) : "",
          suggestedReviewerRole: checkpoint.suggestedReviewerRole ? String(checkpoint.suggestedReviewerRole) : "",
          suggestedSlaHours: Number.isFinite(checkpoint.suggestedSlaHours) ? Number(checkpoint.suggestedSlaHours) : null,
          escalationMode: checkpoint.escalationMode ? String(checkpoint.escalationMode) : "none",
        },
        actualUsage: {
          methods: parseStringList(actualUsage.methods),
          skills: parseStringList(actualUsage.skills),
          mcpServers: parseStringList(actualUsage.mcpServers),
          toolNames: parseStringList(actualUsage.toolNames),
          updatedAt: actualUsage.updatedAt ? String(actualUsage.updatedAt) : "",
        },
        analysis: {
          status: typeof analysis.status === "string" && analysis.status.trim() ? String(analysis.status).trim() : "pending",
          summary: analysis.summary ? String(analysis.summary) : "",
          deviations: deviations
            .map((entry) => entry && typeof entry === "object" ? {
              kind: entry.kind ? String(entry.kind) : "",
              area: entry.area ? String(entry.area) : "",
              severity: entry.severity ? String(entry.severity) : "",
              summary: entry.summary ? String(entry.summary) : "",
              planned: parseStringList(entry.planned),
              actual: parseStringList(entry.actual),
            } : null)
            .filter(Boolean),
          recommendations: parseStringList(analysis.recommendations),
          updatedAt: analysis.updatedAt ? String(analysis.updatedAt) : "",
        },
        generatedAt: data.generatedAt ? String(data.generatedAt) : "",
        updatedAt: data.updatedAt ? String(data.updatedAt) : "",
        orchestratedAt: data.orchestratedAt ? String(data.orchestratedAt) : "",
        orchestration: {
          claimed: orchestration.claimed === true,
          delegated: orchestration.delegated === true,
          delegationCount: Number.isFinite(orchestration.delegationCount) ? Number(orchestration.delegationCount) : 0,
          finalApprovalMode: orchestration.finalApprovalMode ? String(orchestration.finalApprovalMode) : "",
          reworkRevisionCount: Number.isFinite(orchestration.reworkRevisionCount) ? Number(orchestration.reworkRevisionCount) : 0,
          lastReworkReason: orchestration.lastReworkReason ? String(orchestration.lastReworkReason) : "",
          lastReworkAt: orchestration.lastReworkAt ? String(orchestration.lastReworkAt) : "",
          reworkTargetAgentIds: parseStringList(orchestration.reworkTargetAgentIds),
          coordinationPlan: coordinationPlan.summary ? {
            summary: String(coordinationPlan.summary),
            managerAgentId: coordinationPlan.managerAgentId ? String(coordinationPlan.managerAgentId) : "",
            plannedDelegationCount: Number.isFinite(coordinationPlan.plannedDelegationCount)
              ? Number(coordinationPlan.plannedDelegationCount)
              : 0,
            rolePolicy: {
              selectedRoles: parseStringList(rolePolicy.selectedRoles),
              selectionReasons: parseStringList(rolePolicy.selectionReasons),
              verifierRole: rolePolicy.verifierRole ? String(rolePolicy.verifierRole) : "",
              fanInStrategy: rolePolicy.fanInStrategy ? String(rolePolicy.fanInStrategy) : "",
            },
          } : null,
          delegationResults: delegationResults
            .map((entry) => entry && typeof entry === "object" ? {
              agentId: entry.agentId ? String(entry.agentId) : "",
              role: entry.role ? String(entry.role) : "",
              status: entry.status ? String(entry.status) : "success",
              summary: entry.summary ? String(entry.summary) : "",
              error: entry.error ? String(entry.error) : "",
              sessionId: entry.sessionId ? String(entry.sessionId) : "",
              taskId: entry.taskId ? String(entry.taskId) : "",
              outputPath: entry.outputPath ? String(entry.outputPath) : "",
            } : null)
            .filter((entry) => entry && entry.agentId && entry.summary),
          verifierHandoff: verifierHandoff.summary ? {
            status: verifierHandoff.status ? String(verifierHandoff.status) : "not_required",
            verifierRole: verifierHandoff.verifierRole ? String(verifierHandoff.verifierRole) : "",
            verifierAgentId: verifierHandoff.verifierAgentId ? String(verifierHandoff.verifierAgentId) : "",
            verifierTaskId: verifierHandoff.verifierTaskId ? String(verifierHandoff.verifierTaskId) : "",
            verifierSessionId: verifierHandoff.verifierSessionId ? String(verifierHandoff.verifierSessionId) : "",
            summary: String(verifierHandoff.summary),
            sourceAgentIds: parseStringList(verifierHandoff.sourceAgentIds),
            sourceTaskIds: parseStringList(verifierHandoff.sourceTaskIds),
            outputPath: verifierHandoff.outputPath ? String(verifierHandoff.outputPath) : "",
            notes: parseStringList(verifierHandoff.notes),
            error: verifierHandoff.error ? String(verifierHandoff.error) : "",
          } : null,
          verifierResult: verifierResult.summary ? {
            status: verifierResult.status ? String(verifierResult.status) : "pending",
            summary: String(verifierResult.summary),
            recommendation: verifierResult.recommendation ? String(verifierResult.recommendation) : "unknown",
            findings: verifierFindings
              .map((entry) => entry && typeof entry === "object" ? {
                severity: entry.severity ? String(entry.severity) : "low",
                summary: entry.summary ? String(entry.summary) : "",
              } : null)
              .filter((entry) => entry && entry.summary),
            evidenceTaskIds: parseStringList(verifierResult.evidenceTaskIds),
            outputPath: verifierResult.outputPath ? String(verifierResult.outputPath) : "",
            generatedAt: verifierResult.generatedAt ? String(verifierResult.generatedAt) : "",
          } : null,
          acceptanceGate: orchestration.acceptanceGate && typeof orchestration.acceptanceGate === "object"
            ? {
              status: orchestration.acceptanceGate.status ? String(orchestration.acceptanceGate.status) : "pending",
              summary: orchestration.acceptanceGate.summary ? String(orchestration.acceptanceGate.summary) : "",
              reasons: parseStringList(orchestration.acceptanceGate.reasons),
              managerActionHint: orchestration.acceptanceGate.managerActionHint ? String(orchestration.acceptanceGate.managerActionHint) : "",
              doneDefinitionCheck: orchestration.acceptanceGate.doneDefinitionCheck ? String(orchestration.acceptanceGate.doneDefinitionCheck) : "",
              rejectionConfidence: orchestration.acceptanceGate.rejectionConfidence ? String(orchestration.acceptanceGate.rejectionConfidence) : "",
              missingRequiredSections: parseStringList(orchestration.acceptanceGate.missingRequiredSections),
              requiredSections: parseStringList(orchestration.acceptanceGate.requiredSections),
            }
            : null,
          notes: parseStringList(orchestration.notes),
        },
      };
    })
    .sort((a, b) => {
      const left = new Date(b.updatedAt || b.generatedAt || 0).getTime();
      const right = new Date(a.updatedAt || a.generatedAt || 0).getTime();
      return left - right;
    });
}

export function createGoalsSpecialistPanelsRuntimeFeature({
  refs,
  getGoalsState,
  getGoalsCapabilityPanelFeature,
  getGoalsReadonlyPanelsFeature,
  getGoalsTrackingPanelFeature,
  getGoalsGovernancePanelFeature,
  readSourceFile,
  goalRuntimeFilePath,
  safeJsonParse,
  sendReq,
  makeId,
  getCanvasContextFeature,
  openSourcePath,
  openContinuationAction,
  generateGoalHandoff,
  runGoalApprovalScan,
  runGoalSuggestionReviewDecision,
  runGoalSuggestionReviewEscalation,
  runGoalCheckpointEscalation,
  openExperienceWorkbench,
  applyGoalContinuationFocus,
}) {
  const { goalsDetailEl } = refs;
  const capabilityCacheReadLifecycle = createGoalsSpecialistCapabilityCacheReadLifecycle();
  const capabilityPanelReadLifecycle = createGoalsSpecialistCapabilityPanelReadLifecycle();
  const canvasReadLifecycle = createGoalsSpecialistCanvasReadLifecycle();
  const governanceReadLifecycle = createGoalsSpecialistGovernanceReadLifecycle();
  const handoffReadLifecycle = createGoalsSpecialistHandoffReadLifecycle();
  const panelControls = createGoalsSpecialistPanelControlsFeature();
  const progressReadLifecycle = createGoalsSpecialistProgressReadLifecycle();
  const trackingReadLifecycle = createGoalsSpecialistTrackingReadLifecycle();

  function renderGoalCapabilityPanelLoading() {
    return getGoalsCapabilityPanelFeature?.()?.renderGoalCapabilityPanelLoading();
  }

  function renderGoalCapabilityPanelError(message) {
    return getGoalsCapabilityPanelFeature?.()?.renderGoalCapabilityPanelError(message);
  }

  function renderGoalCapabilityPanel(goal, payload) {
    return getGoalsCapabilityPanelFeature?.()?.renderGoalCapabilityPanel(goal, payload);
  }

  function getCachedGoalCapabilityEntry(goalId) {
    const goalsState = getGoalsState();
    if (!goalId || !goalsState?.capabilityCache || typeof goalsState.capabilityCache !== "object") return null;
    return goalsState.capabilityCache[goalId] || null;
  }

  async function ensureGoalCapabilityCache(goal, options = {}) {
    if (!goal?.id) return null;
    if (capabilityCacheReadLifecycle.isDisposed()) return undefined;
    const goalsState = getGoalsState();
    const goalId = goal.id;
    const forceReload = options.forceReload === true;
    const cached = getCachedGoalCapabilityEntry(goalId);
    if (cached && !forceReload) return cached;
    return capabilityCacheReadLifecycle.run({
      goalId,
      forceReload,
      pendingState: goalsState.capabilityPending,
      read: async () => {
        const [tasksFile, capabilityPlansFile] = await Promise.all([
          readSourceFile(goal.tasksPath),
          readSourceFile(goalRuntimeFilePath(goal, "capability-plans.json")),
        ]);
        const rawGraph = tasksFile?.content ? safeJsonParse(tasksFile.content) : null;
        const rawPlans = capabilityPlansFile?.content ? safeJsonParse(capabilityPlansFile.content) : null;
        const nodes = parseGoalGraphNodes(rawGraph);
        return {
          plans: parseGoalCapabilityPlans(rawPlans),
          nodeMap: Object.fromEntries(nodes.map((node) => [node.id, node.title])),
          capabilityPath: goalRuntimeFilePath(goal, "capability-plans.json"),
          loadedAt: new Date().toISOString(),
          readError: !tasksFile && !capabilityPlansFile,
        };
      },
      commit: (entry) => {
        goalsState.capabilityCache[goalId] = entry;
      },
    });
  }

  async function loadGoalCapabilityData(goal) {
    if (!goal || !goalsDetailEl) return;
    return capabilityPanelReadLifecycle.run(async ({ isCurrent }) => {
      const goalsState = getGoalsState();
      const trackingGoalId = goal.id;
      const seq = goalsState.capabilitySeq + 1;
      goalsState.capabilitySeq = seq;
      renderGoalCapabilityPanelLoading();

      const governanceCached = goalsState.governanceCache?.[goal.id] || null;
      const capabilityPromise = ensureGoalCapabilityCache(goal, { forceReload: true });
      const governancePromise = governanceCached
        ? Promise.resolve(governanceCached)
        : typeof sendReq === "function" && typeof makeId === "function"
          ? sendReq({
            type: "req",
            id: makeId(),
            method: "goal.review_governance.summary",
            params: { goalId: goal.id },
          }).then((res) => {
            if (!res?.ok || !res.payload?.summary) return null;
            const parsed = parseGoalReviewGovernanceSummary(res.payload.summary, parseGoalCheckpoints);
            return {
              ...parsed,
              memoryFreshness: parseMemoryFreshness(res.payload.memoryFreshness),
            };
          }).catch(() => null)
          : Promise.resolve(null);
      const [entry, governanceEntry] = await Promise.all([capabilityPromise, governancePromise]);
      if (!isCurrent() || goalsState.capabilitySeq !== seq || goalsState.selectedId !== trackingGoalId) return;

      if (!entry || entry.readError) {
        renderGoalCapabilityPanelError("无法读取 tasks.json / capability-plans.json。若使用了自定义路径，请确认该路径已加入可操作区。");
        return;
      }

      if (governanceEntry && goalsState.governanceCache && !governanceCached) {
        goalsState.governanceCache[goal.id] = governanceEntry;
      }

      renderGoalCapabilityPanel(goal, {
        plans: entry.plans,
        nodeMap: entry.nodeMap,
        memoryFreshness: governanceEntry?.memoryFreshness ?? governanceCached?.memoryFreshness ?? null,
      });
      applyGoalContinuationFocus?.(goal.id);
    });
  }

  function renderGoalCanvasPanelLoading() {
    return getGoalsReadonlyPanelsFeature?.()?.renderGoalCanvasPanelLoading();
  }

  function renderGoalCanvasPanel(goal, payload) {
    return getGoalsReadonlyPanelsFeature?.()?.renderGoalCanvasPanel(goal, payload);
  }

  async function loadGoalCanvasData(goal) {
    if (!goal || !goalsDetailEl) return;
    return canvasReadLifecycle.run(async ({ isCurrent }) => {
      const goalsState = getGoalsState();
      const trackingGoalId = goal.id;
      const seq = goalsState.canvasSeq + 1;
      goalsState.canvasSeq = seq;
      renderGoalCanvasPanelLoading();

      const boardRefFile = await readSourceFile(goalRuntimeFilePath(goal, "board-ref.json"));
      if (!isCurrent() || goalsState.canvasSeq !== seq || goalsState.selectedId !== trackingGoalId) return;

      const rawBoardRef = boardRefFile?.content ? safeJsonParse(boardRefFile.content) : null;
      const parsed = parseGoalBoardRef(rawBoardRef);

      renderGoalCanvasPanel(goal, {
        runtimeBoardId: parsed.boardId,
        linkedAt: parsed.linkedAt,
        updatedAt: parsed.updatedAt,
        readError: !boardRefFile,
      });
    });
  }

  async function openGoalCanvasList(goalId) {
    return getCanvasContextFeature?.()?.openGoalCanvasList(goalId);
  }

  async function openGoalCanvasBoard(boardId, goalId) {
    return getCanvasContextFeature?.()?.openGoalCanvasBoard(boardId, goalId);
  }

  function renderGoalTrackingPanelLoading() {
    return getGoalsTrackingPanelFeature?.()?.renderGoalTrackingPanelLoading();
  }

  function renderGoalTrackingPanel(goal, payload) {
    return getGoalsTrackingPanelFeature?.()?.renderGoalTrackingPanel(goal, payload);
  }

  function renderGoalTrackingPanelError(message) {
    return getGoalsTrackingPanelFeature?.()?.renderGoalTrackingPanelError(message);
  }

  async function loadGoalTrackingRuntimeIndex(taskIds) {
    const normalizedTaskIds = [...new Set(
      (Array.isArray(taskIds) ? taskIds : [])
        .map((taskId) => normalizeGoalTrackingTaskId(taskId))
        .filter(Boolean),
    )];
    if (!normalizedTaskIds.length || typeof sendReq !== "function" || typeof makeId !== "function") {
      return {};
    }

    const entries = await Promise.all(normalizedTaskIds.map(async (taskId) => {
      try {
        const res = await sendReq({
          type: "req",
          id: makeId(),
          method: "subtask.get",
          params: { taskId },
        });
        if (!res?.ok || !res.payload?.item) {
          return null;
        }

        const bridgeSubtaskView = res.payload?.bridgeSubtaskView && typeof res.payload.bridgeSubtaskView === "object"
          ? res.payload.bridgeSubtaskView
          : res.payload?.item?.bridgeSubtaskView && typeof res.payload.item.bridgeSubtaskView === "object"
            ? res.payload.item.bridgeSubtaskView
            : null;
        const bridgeSessionView = res.payload?.bridgeSessionView && typeof res.payload.bridgeSessionView === "object"
          ? res.payload.bridgeSessionView
          : res.payload?.item?.bridgeSessionView && typeof res.payload.item.bridgeSessionView === "object"
            ? res.payload.item.bridgeSessionView
            : null;
        if (!bridgeSubtaskView && !bridgeSessionView) {
          return null;
        }

        return [
          taskId,
          {
            ...(bridgeSubtaskView ? { bridgeSubtaskView } : {}),
            ...(bridgeSessionView ? { bridgeSessionView } : {}),
          },
        ];
      } catch {
        return null;
      }
    }));

    return Object.fromEntries(entries.filter(Boolean));
  }

  async function loadGoalTrackingData(goal) {
    if (!goal || !goalsDetailEl) return;
    return trackingReadLifecycle.run(async ({ isCurrent }) => {
      const goalsState = getGoalsState();
      const trackingGoalId = goal.id;
      const seq = goalsState.trackingSeq + 1;
      goalsState.trackingSeq = seq;
      renderGoalTrackingPanelLoading();

      const [taskGraphRes, tasksFile, checkpointsFile, capabilityEntry] = await Promise.all([
        typeof sendReq === "function" && typeof makeId === "function"
          ? sendReq({
            type: "req",
            id: makeId(),
            method: "goal.task_graph.read",
            params: { goalId: goal.id },
          }).catch(() => null)
          : Promise.resolve(null),
        readSourceFile(goal.tasksPath),
        readSourceFile(goalRuntimeFilePath(goal, "checkpoints.json")),
        ensureGoalCapabilityCache(goal),
      ]);

      if (!isCurrent() || goalsState.trackingSeq !== seq || goalsState.selectedId !== trackingGoalId) return;

      const taskGraphPayload = taskGraphRes?.ok && taskGraphRes.payload && typeof taskGraphRes.payload === "object"
        ? taskGraphRes.payload
        : null;
      const rawGraph = taskGraphPayload?.graph ?? (tasksFile?.content ? safeJsonParse(tasksFile.content) : null);
      const rawCheckpoints = taskGraphPayload?.checkpoints ?? (checkpointsFile?.content ? safeJsonParse(checkpointsFile.content) : null);
      const memoryFreshness = parseMemoryFreshness(taskGraphPayload?.memoryFreshness);

      if (!taskGraphPayload && !tasksFile && !checkpointsFile) {
        goalsState.trackingCheckpoints = [];
        renderGoalTrackingPanelError("无法读取 tasks.json / checkpoints.json。若使用了自定义路径，请确认该路径已加入可操作区。");
        return;
      }

      const focusNodeId = goalsState.continuationFocusNode?.goalId === trackingGoalId
        ? goalsState.continuationFocusNode?.nodeId || ""
        : "";
      const parsedNodes = parseGoalGraphNodes(rawGraph);
      const trackingRuntimeIndex = await loadGoalTrackingRuntimeIndex(
        collectGoalTrackingRuntimeTaskIds(parsedNodes, focusNodeId),
      );
      if (!isCurrent() || goalsState.trackingSeq !== seq || goalsState.selectedId !== trackingGoalId) return;

      const parsedCheckpoints = parseGoalCheckpoints(rawCheckpoints).map((item) => ({
        ...item,
        goalId: item.goalId || trackingGoalId,
      }));
      goalsState.trackingCheckpoints = parsedCheckpoints;
      renderGoalTrackingPanel(goal, {
        nodes: mergeGoalTrackingRuntimeIndex(parsedNodes, trackingRuntimeIndex),
        checkpoints: parsedCheckpoints,
        capabilityPlans: capabilityEntry?.plans || [],
        focusNodeId,
        memoryFreshness,
      });
      applyGoalContinuationFocus?.(goal.id);
    });
  }

  function renderGoalProgressPanelLoading() {
    return getGoalsReadonlyPanelsFeature?.()?.renderGoalProgressPanelLoading();
  }

  function renderGoalProgressPanel(entries) {
    return getGoalsReadonlyPanelsFeature?.()?.renderGoalProgressPanel(entries);
  }

  async function loadGoalProgressData(goal) {
    if (!goal || !goalsDetailEl) return;
    return progressReadLifecycle.run(async ({ isCurrent }) => {
      const goalsState = getGoalsState();
      const trackingGoalId = goal.id;
      const seq = (goalsState.progressSeq || 0) + 1;
      goalsState.progressSeq = seq;
      renderGoalProgressPanelLoading();

      const progressFile = await readSourceFile(goal.progressPath);
      if (!isCurrent() || goalsState.progressSeq !== seq || goalsState.selectedId !== trackingGoalId) return;

      renderGoalProgressPanel(parseGoalProgressEntries(progressFile?.content || ""));
    });
  }

  function renderGoalHandoffPanelLoading() {
    return getGoalsReadonlyPanelsFeature?.()?.renderGoalHandoffPanelLoading();
  }

  function bindGoalHandoffPanelActions(goal) {
    const panel = goalsDetailEl?.querySelector("#goalHandoffPanel");
    return panelControls.replaceGroup("handoff", panel, goal ? [
      {
        selector: "[data-continuation-action]",
        onClick: (node) => {
          const action = decodeContinuationAction(node.getAttribute("data-continuation-action") || "");
          if (!action) return;
          void openContinuationAction(action);
        },
      },
      {
        selector: "[data-goal-generate-handoff]",
        onClick: (node) => {
          const goalId = node.getAttribute("data-goal-generate-handoff") || goal.id;
          if (!goalId) return;
          void generateGoalHandoff(goalId);
        },
      },
      {
        selector: "[data-open-source]",
        onClick: (node) => {
          const sourcePath = node.getAttribute("data-open-source");
          if (!sourcePath) return;
          void openSourcePath(sourcePath);
        },
      },
    ] : []);
  }

  function renderGoalHandoffPanelError(goal, message) {
    return getGoalsReadonlyPanelsFeature?.()?.renderGoalHandoffPanelError(goal, message);
  }

  function renderGoalHandoffPanel(goal, handoff, continuationState = null) {
    return getGoalsReadonlyPanelsFeature?.()?.renderGoalHandoffPanel(goal, handoff, continuationState);
  }

  async function loadGoalHandoffData(goal) {
    if (!goal || !goalsDetailEl) return;
    return handoffReadLifecycle.run(async ({ isCurrent }) => {
      const goalsState = getGoalsState();
      const trackingGoalId = goal.id;
      const seq = (goalsState.handoffSeq || 0) + 1;
      goalsState.handoffSeq = seq;
      renderGoalHandoffPanelLoading();
      const res = await sendReq({
        type: "req",
        id: makeId(),
        method: "goal.handoff.get",
        params: { goalId: goal.id },
      });
      if (!isCurrent() || goalsState.handoffSeq !== seq || goalsState.selectedId !== trackingGoalId) return;
      if (!res?.ok || !res.payload?.handoff) {
        renderGoalHandoffPanelError(goal, res?.error?.message || "无法读取 goal handoff snapshot。");
        return;
      }
      renderGoalHandoffPanel(goal, res.payload.handoff, res.payload.continuationState || null);
    });
  }

  function renderGoalReviewGovernancePanelLoading() {
    return getGoalsGovernancePanelFeature?.()?.renderGoalReviewGovernancePanelLoading();
  }

  function renderGoalReviewGovernancePanelError(message) {
    return getGoalsGovernancePanelFeature?.()?.renderGoalReviewGovernancePanelError(message);
  }

  function renderGoalReviewGovernancePanel(goal, data) {
    return getGoalsGovernancePanelFeature?.()?.renderGoalReviewGovernancePanel(goal, data);
  }

  function bindGoalReviewGovernanceActions(goal) {
    const panel = goalsDetailEl?.querySelector("#goalGovernancePanel");
    return panelControls.replaceGroup("governance", panel, goal ? [
      {
        selector: "[data-goal-approval-scan]",
        onClick: (node) => {
          const goalId = node.getAttribute("data-goal-approval-scan") || goal.id;
          if (!goalId) return;
          void runGoalApprovalScan(goalId, { autoEscalate: node.getAttribute("data-goal-auto-escalate") !== "false" });
        },
      },
      {
        selector: "[data-goal-suggestion-decision]",
        onClick: (node) => {
          const goalId = node.getAttribute("data-goal-suggestion-goal-id") || goal.id;
          const reviewId = node.getAttribute("data-goal-suggestion-review-id");
          const decision = node.getAttribute("data-goal-suggestion-decision");
          const suggestionType = node.getAttribute("data-goal-suggestion-type");
          const suggestionId = node.getAttribute("data-goal-suggestion-id");
          if (!goalId || !reviewId || !decision) return;
          void runGoalSuggestionReviewDecision(goalId, {
            reviewId,
            decision,
            suggestionType,
            suggestionId,
          });
        },
      },
      {
        selector: "[data-goal-suggestion-escalate]",
        onClick: (node) => {
          const goalId = node.getAttribute("data-goal-suggestion-goal-id") || goal.id;
          const reviewId = node.getAttribute("data-goal-suggestion-review-id");
          const suggestionType = node.getAttribute("data-goal-suggestion-type");
          const suggestionId = node.getAttribute("data-goal-suggestion-id");
          if (!goalId || !reviewId) return;
          void runGoalSuggestionReviewEscalation(goalId, {
            reviewId,
            suggestionType,
            suggestionId,
          });
        },
      },
      {
        selector: "[data-goal-open-experience]",
        onClick: (node) => {
          const candidateId = node.getAttribute("data-goal-open-experience-candidate-id");
          const type = node.getAttribute("data-goal-open-experience-type");
          const query = node.getAttribute("data-goal-open-experience-query");
          void openExperienceWorkbench?.({
            candidateId,
            filters: {
              type,
              query,
            },
            preferFirst: true,
          });
        },
      },
      {
        selector: "[data-goal-checkpoint-escalate]",
        onClick: (node) => {
          const goalId = node.getAttribute("data-goal-checkpoint-goal-id") || goal.id;
          const nodeId = node.getAttribute("data-goal-checkpoint-node-id");
          const checkpointId = node.getAttribute("data-goal-checkpoint-id");
          if (!goalId || !nodeId || !checkpointId) return;
          void runGoalCheckpointEscalation(goalId, nodeId, checkpointId);
        },
      },
    ] : []);
  }

  async function loadGoalReviewGovernanceData(goal) {
    if (!goal || !goalsDetailEl) return;
    return governanceReadLifecycle.run(async ({ isCurrent }) => {
      const goalsState = getGoalsState();
      const trackingGoalId = goal.id;
      const seq = (goalsState.governanceSeq || 0) + 1;
      goalsState.governanceSeq = seq;
      renderGoalReviewGovernancePanelLoading();
      const [res, tasksFile] = await Promise.all([
        sendReq({
          type: "req",
          id: makeId(),
          method: "goal.review_governance.summary",
          params: { goalId: goal.id },
        }),
        readSourceFile(goal.tasksPath),
      ]);
      if (!isCurrent() || goalsState.governanceSeq !== seq || goalsState.selectedId !== trackingGoalId) return;
      if (!res?.ok || !res.payload?.summary) {
        renderGoalReviewGovernancePanelError(res?.error?.message || "无法读取 review governance summary。");
        return;
      }
      const parsed = parseGoalReviewGovernanceSummary(res.payload.summary, parseGoalCheckpoints);
      const rawGraph = tasksFile?.content ? safeJsonParse(tasksFile.content) : null;
      const focusNodeId = goalsState.continuationFocusNode?.goalId === trackingGoalId
        ? goalsState.continuationFocusNode?.nodeId || ""
        : "";
      const parsedNodes = parseGoalGraphNodes(rawGraph);
      const trackingRuntimeIndex = await loadGoalTrackingRuntimeIndex(
        collectGoalTrackingRuntimeTaskIds(parsedNodes, focusNodeId),
      );
      if (!isCurrent() || goalsState.governanceSeq !== seq || goalsState.selectedId !== trackingGoalId) return;
      const bridgeGovernanceSummary = buildGoalBridgeGovernanceSummary(
        mergeGoalTrackingRuntimeIndex(parsedNodes, trackingRuntimeIndex),
      );
      const merged = {
        ...parsed,
        memoryFreshness: parseMemoryFreshness(res.payload.memoryFreshness),
        ...(bridgeGovernanceSummary ? { bridgeGovernanceSummary } : {}),
      };
      goalsState.governanceCache[goal.id] = merged;
      renderGoalReviewGovernancePanel(goal, merged);
      bindGoalReviewGovernanceActions(goal);
    });
  }

  return {
    dispose: () => {
      getGoalsCapabilityPanelFeature?.()?.dispose?.();
      panelControls.dispose();
      capabilityCacheReadLifecycle.dispose();
      capabilityPanelReadLifecycle.dispose();
      canvasReadLifecycle.dispose();
      governanceReadLifecycle.dispose();
      handoffReadLifecycle.dispose();
      progressReadLifecycle.dispose();
      trackingReadLifecycle.dispose();
    },
    getRuntimeSnapshot: () => ({
      ...panelControls.getRuntimeSnapshot(),
      ...capabilityCacheReadLifecycle.getRuntimeSnapshot(),
      ...capabilityPanelReadLifecycle.getRuntimeSnapshot(),
      ...canvasReadLifecycle.getRuntimeSnapshot(),
      ...governanceReadLifecycle.getRuntimeSnapshot(),
      ...handoffReadLifecycle.getRuntimeSnapshot(),
      ...progressReadLifecycle.getRuntimeSnapshot(),
      ...trackingReadLifecycle.getRuntimeSnapshot(),
    }),
    renderGoalCapabilityPanelLoading,
    renderGoalCapabilityPanelError,
    renderGoalCapabilityPanel,
    getCachedGoalCapabilityEntry,
    ensureGoalCapabilityCache,
    loadGoalCapabilityData,
    parseGoalProgressEntries,
    normalizeGoalBoardId,
    parseGoalBoardRef,
    renderGoalCanvasPanelLoading,
    renderGoalCanvasPanel,
    loadGoalCanvasData,
    openGoalCanvasList,
    openGoalCanvasBoard,
    renderGoalTrackingPanelLoading,
    renderGoalTrackingPanel,
    renderGoalTrackingPanelError,
    loadGoalTrackingData,
    renderGoalProgressPanelLoading,
    renderGoalProgressPanel,
    loadGoalProgressData,
    renderGoalHandoffPanelLoading,
    bindGoalHandoffPanelActions,
    renderGoalHandoffPanelError,
    renderGoalHandoffPanel,
    loadGoalHandoffData,
    parseGoalReviewGovernanceSummary,
    parseMemoryFreshness,
    renderGoalReviewGovernancePanelLoading,
    renderGoalReviewGovernancePanelError,
    renderGoalReviewGovernancePanel,
    bindGoalReviewGovernanceActions,
    loadGoalReviewGovernanceData,
  };
}
