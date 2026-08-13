import path from "node:path";
import { atomicWriteGoalText } from "./atomic-write.js";
import type {
  GoalCapabilityPlan,
  GoalCheckpointItem,
  GoalCheckpointState,
  GoalHandoffBlocker,
  GoalHandoffBridgeItem,
  GoalHandoffBridgeSummary,
  GoalHandoffCapabilityFocus,
  GoalHandoffCheckpointSummary,
  GoalCheckpointReplayDescriptor,
  GoalHandoffGenerateResult,
  GoalHandoffReadResult,
  GoalHandoffResumeMode,
  GoalHandoffSnapshot,
  GoalHandoffTimelineEntry,
  GoalTaskGraph,
  GoalTaskNode,
  GoalTaskNodeStatus,
  GoalRuntimeState,
  LongTermGoal,
} from "./types.js";
import { buildGoalContinuationState } from "../continuation-state.js";
import { parseGoalProgressEntries } from "./progress.js";

export type GoalHandoffInput = {
  goal: LongTermGoal;
  runtime: GoalRuntimeState;
  graph: GoalTaskGraph;
  checkpoints: GoalCheckpointState;
  plans: GoalCapabilityPlan[];
  progressContent: string;
  bridgeGovernanceSummary?: GoalHandoffBridgeSummary;
};

function escapeMarkdown(value: string): string {
  return value.replace(/[<>]/g, "").trim();
}

function pickFocusPlan(goal: LongTermGoal, plans: GoalCapabilityPlan[]): GoalCapabilityPlan | null {
  const preferredNodeIds = [goal.activeNodeId, goal.lastNodeId]
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item));
  for (const nodeId of preferredNodeIds) {
    const matched = plans.find((plan) => plan.nodeId === nodeId);
    if (matched) return matched;
  }
  return plans
    .slice()
    .sort((left, right) => new Date(right.updatedAt || right.generatedAt).getTime() - new Date(left.updatedAt || left.generatedAt).getTime())[0] ?? null;
}

function compactStrings(values: Array<string | undefined>, max = 4): string[] {
  return values
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, max);
}

function buildBridgeNodeMap(bridgeGovernanceSummary: GoalHandoffBridgeSummary | undefined): Map<string, GoalHandoffBridgeItem> {
  const map = new Map<string, GoalHandoffBridgeItem>();
  for (const item of bridgeGovernanceSummary?.items ?? []) {
    const nodeId = item?.nodeId?.trim();
    if (!nodeId || map.has(nodeId)) continue;
    map.set(nodeId, item);
  }
  return map;
}

function bridgeNeedsAttention(item: GoalHandoffBridgeItem | undefined): boolean {
  return item?.runtimeState === "runtime-lost"
    || item?.runtimeState === "orphaned"
    || Boolean(item?.blockReason?.trim());
}

function describeBridgeRuntime(item: GoalHandoffBridgeItem | undefined): string {
  if (!item) return "";
  if (item.runtimeState === "runtime-lost") {
    return "bridge 运行态丢失，需恢复或重拉起";
  }
  if (item.runtimeState === "orphaned") {
    return "bridge 会话已按孤儿清理，需重新建立";
  }
  if (item.runtimeState === "active") {
    return "bridge 会话仍在运行";
  }
  if (item.runtimeState === "closed") {
    if (item.closeReason === "manual") return "bridge 会话已手动关闭";
    if (item.closeReason === "idle-timeout") return "bridge 会话已超时关闭";
    if (item.closeReason === "runtime-lost") return "bridge 会话已按运行态丢失关闭";
    if (item.closeReason === "orphan") return "bridge 会话已按孤儿清理关闭";
    return "bridge 会话已关闭";
  }
  if (item.blockReason?.trim()) {
    return "bridge 存在阻塞归因";
  }
  return "bridge 已记录";
}

function buildBridgeReferenceText(item: GoalHandoffBridgeItem | undefined): string {
  if (!item) return "";
  const details = compactStrings([
    describeBridgeRuntime(item),
    item.blockReason,
    item.artifactPath ? "可查看 bridge 产物" : undefined,
    item.transcriptPath ? "可查看 bridge transcript" : undefined,
  ], 4);
  return details.join("；");
}

function buildBridgeCheckpointSummary(item: GoalHandoffBridgeItem | undefined): string {
  const reference = buildBridgeReferenceText(item);
  return reference ? `Bridge：${reference}` : "";
}

function buildBridgeBlockerReason(item: GoalHandoffBridgeItem): string {
  const details = compactStrings([
    describeBridgeRuntime(item),
    item.blockReason,
    item.summaryLines?.[0],
    item.artifactPath ? `产物=${item.artifactPath}` : undefined,
    item.transcriptPath ? `transcript=${item.transcriptPath}` : undefined,
  ], 5);
  return details.join(" | ");
}

function pickBridgeFocusItem(
  bridgeGovernanceSummary: GoalHandoffBridgeSummary | undefined,
  preferredNodeIds: Array<string | undefined>,
): GoalHandoffBridgeItem | undefined {
  const items = Array.isArray(bridgeGovernanceSummary?.items) ? bridgeGovernanceSummary.items : [];
  if (items.length === 0) return undefined;
  const preferred = preferredNodeIds
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item));
  for (const nodeId of preferred) {
    const matched = items.find((item) => item.nodeId === nodeId && bridgeNeedsAttention(item));
    if (matched) return matched;
  }
  for (const nodeId of preferred) {
    const matched = items.find((item) => item.nodeId === nodeId);
    if (matched) return matched;
  }
  return items.find((item) => bridgeNeedsAttention(item)) ?? items[0];
}

function summarizeCheckpoint(
  checkpoint: GoalCheckpointItem,
  bridgeItem: GoalHandoffBridgeItem | undefined,
): GoalHandoffCheckpointSummary {
  const bridgeSummary = buildBridgeCheckpointSummary(bridgeItem);
  return {
    id: checkpoint.id,
    status: checkpoint.status,
    title: checkpoint.title,
    nodeId: checkpoint.nodeId,
    summary: compactStrings([checkpoint.summary, bridgeSummary], 2).join(" | ") || undefined,
    reviewer: checkpoint.reviewer,
    reviewerRole: checkpoint.reviewerRole,
    updatedAt: checkpoint.updatedAt,
  };
}

function buildTracking(graph: GoalTaskGraph, checkpoints: GoalCheckpointState) {
  const countNodeStatus = (status: GoalTaskNodeStatus) => graph.nodes.filter((node) => node.status === status).length;
  return {
    totalNodes: graph.nodes.length,
    completedNodes: countNodeStatus("done"),
    inProgressNodes: countNodeStatus("in_progress"),
    blockedNodes: countNodeStatus("blocked"),
    pendingReviewNodes: countNodeStatus("pending_review"),
    validatingNodes: countNodeStatus("validating"),
    failedNodes: countNodeStatus("failed"),
    skippedNodes: countNodeStatus("skipped"),
    openCheckpointCount: checkpoints.items.filter((item) => item.status === "required" || item.status === "waiting_user").length,
  };
}

function resolveResumeMode(goal: LongTermGoal, openCheckpoints: GoalCheckpointItem[], blockedNodes: GoalTaskNode[]): {
  resumeMode: GoalHandoffResumeMode;
  recommendedNodeId?: string;
} {
  if (openCheckpoints.length > 0) {
    return {
      resumeMode: "checkpoint",
      recommendedNodeId: openCheckpoints[0]?.nodeId,
    };
  }
  if (goal.status === "executing" && goal.activeNodeId) {
    return {
      resumeMode: "current_node",
      recommendedNodeId: goal.activeNodeId,
    };
  }
  if ((goal.status === "blocked" || blockedNodes.length > 0) && (goal.activeNodeId || goal.lastNodeId || blockedNodes[0]?.id)) {
    return {
      resumeMode: "blocked",
      recommendedNodeId: goal.activeNodeId || goal.lastNodeId || blockedNodes[0]?.id,
    };
  }
  if (goal.lastNodeId) {
    return {
      resumeMode: "last_node",
      recommendedNodeId: goal.lastNodeId,
    };
  }
  return { resumeMode: "goal_channel" };
}

function buildBlockers(
  blockedNodes: GoalTaskNode[],
  openCheckpoints: GoalCheckpointItem[],
  bridgeGovernanceSummary: GoalHandoffBridgeSummary | undefined,
): GoalHandoffBlocker[] {
  const nodeBlockers = blockedNodes.map((node) => ({
    kind: "node" as const,
    id: node.id,
    title: node.title,
    status: node.status,
    nodeId: node.id,
    reason: node.blockReason || node.summary || node.description,
  }));
  const checkpointBlockers = openCheckpoints.map((checkpoint) => ({
    kind: "checkpoint" as const,
    id: checkpoint.id,
    title: checkpoint.title,
    status: checkpoint.status,
    nodeId: checkpoint.nodeId,
    reason: checkpoint.summary || checkpoint.note,
  }));
  const bridgeBlockers = (bridgeGovernanceSummary?.items ?? [])
    .filter((item) => bridgeNeedsAttention(item))
    .map((item) => ({
      kind: "bridge" as const,
      id: item.taskId || `bridge:${item.nodeId}`,
      title: item.title,
      status: item.runtimeState || item.closeReason || "bridge",
      nodeId: item.nodeId,
      reason: buildBridgeBlockerReason(item),
    }));
  return [...nodeBlockers, ...checkpointBlockers, ...bridgeBlockers].slice(0, 8);
}

function buildBridgeSummaryNote(item: GoalHandoffBridgeItem | undefined): string {
  if (!item) return "";
  if (item.runtimeState === "runtime-lost") {
    return "此外，关联 bridge 运行态已丢失，恢复前应先查看 bridge 产物 / transcript，并决定恢复或重拉起。";
  }
  if (item.runtimeState === "orphaned") {
    return "此外，关联 bridge 会话已被按孤儿清理，恢复前应先重新建立会话并重新绑定产物。";
  }
  if (item.blockReason?.trim()) {
    return `此外，关联 bridge 存在阻塞归因：${item.blockReason.trim()}。`;
  }
  if (item.runtimeState === "active") {
    return "此外，关联 bridge 会话仍在运行，可优先复用现有外部执行上下文。";
  }
  if (item.runtimeState === "closed" && (item.artifactPath || item.transcriptPath)) {
    return "此外，关联 bridge 会话已结束，但仍可参考既有产物 / transcript 快速恢复上下文。";
  }
  return "";
}

function buildSummary(
  goal: LongTermGoal,
  openCheckpoints: GoalCheckpointItem[],
  blockedNodes: GoalTaskNode[],
  focusNode: GoalTaskNode | undefined,
  bridgeFocusItem: GoalHandoffBridgeItem | undefined,
) {
  if (openCheckpoints.length > 0) {
    const checkpoint = openCheckpoints[0];
    return `当前 goal 存在待处理 checkpoint（${checkpoint.id}），应先完成审批/流转，再继续执行 ${checkpoint.nodeId || "对应节点"}。${buildBridgeSummaryNote(bridgeFocusItem)}`;
  }
  if (blockedNodes.length > 0) {
    const blocked = blockedNodes[0];
    return `当前 goal 处于阻塞态，优先解除节点 ${blocked.id} 的阻塞原因：${blocked.blockReason || blocked.summary || "未填写原因"}。${buildBridgeSummaryNote(bridgeFocusItem)}`;
  }
  if (goal.status === "executing" && focusNode) {
    return `当前 goal 正在执行节点 ${focusNode.id}，可按现有执行上下文继续推进。${buildBridgeSummaryNote(bridgeFocusItem)}`;
  }
  if (goal.lastNodeId) {
    return `当前 goal 可按最近节点 ${goal.lastNodeId} 恢复，继续补齐执行与验收闭环。${buildBridgeSummaryNote(bridgeFocusItem)}`;
  }
  return `当前 goal 还没有明确的恢复节点，建议先回到基础 goal channel 校准目标、计划与任务图。${buildBridgeSummaryNote(bridgeFocusItem)}`;
}

function buildNextAction(snapshot: {
  resumeMode: GoalHandoffResumeMode;
  recommendedNodeId?: string;
  openCheckpoints: GoalCheckpointItem[];
  blockedNodes: GoalTaskNode[];
  nextReadyNode?: GoalTaskNode;
  bridgeFocusItem?: GoalHandoffBridgeItem;
}): string {
  const buildBridgeAction = () => {
    const item = snapshot.bridgeFocusItem;
    if (!item) return "";
    if (item.runtimeState === "runtime-lost") {
      return "恢复前先查看关联 bridge 产物 / transcript，并通过 resume 或重拉起把 bridge 运行态补齐。";
    }
    if (item.runtimeState === "orphaned") {
      return "恢复前先重新建立关联 bridge 会话，并确认新的 task / artifact 绑定。";
    }
    if (item.blockReason?.trim()) {
      return `恢复前先处理关联 bridge 阻塞归因：${item.blockReason.trim()}。`;
    }
    if (item.runtimeState === "active") {
      return "恢复时先检查关联 bridge 会话的最新输出，再决定是否直接续写。";
    }
    if (item.runtimeState === "closed" && (item.artifactPath || item.transcriptPath)) {
      return "如需快速找回上下文，可先打开最近 bridge 产物 / transcript。";
    }
    return "";
  };
  if (snapshot.openCheckpoints.length > 0) {
    const checkpoint = snapshot.openCheckpoints[0];
    return `优先处理 checkpoint ${checkpoint.id}${checkpoint.nodeId ? `（node ${checkpoint.nodeId}）` : ""}，完成审批后再恢复执行。${buildBridgeAction()}`;
  }
  if (snapshot.blockedNodes.length > 0) {
    const blocked = snapshot.blockedNodes[0];
    return `先解除节点 ${blocked.id} 的阻塞，再决定是否重新 claim / validating / complete。${buildBridgeAction()}`;
  }
  if (snapshot.resumeMode === "current_node" || snapshot.resumeMode === "last_node") {
    const base = snapshot.recommendedNodeId
      ? `恢复节点 ${snapshot.recommendedNodeId}，检查 capability plan、artifact 与验收条件后继续推进。`
      : "回到 goal channel，确认最近执行上下文后继续。";
    return `${base}${buildBridgeAction()}`;
  }
  if (snapshot.nextReadyNode) {
    return `当前没有待审批项，建议下一步进入 ready 节点 ${snapshot.nextReadyNode.id}。${buildBridgeAction()}`;
  }
  return `先进入基础 goal channel，补齐目标分解、任务图或恢复策略。${buildBridgeAction()}`;
}

function buildCheckpointReplay(
  openCheckpoints: GoalCheckpointItem[],
  bridgeNodeMap: Map<string, GoalHandoffBridgeItem>,
): GoalCheckpointReplayDescriptor | undefined {
  const checkpoint = openCheckpoints[0];
  const checkpointId = checkpoint?.id?.trim();
  const nodeId = checkpoint?.nodeId?.trim();
  if (!checkpointId || !nodeId) return undefined;
  const bridgeSummary = buildBridgeCheckpointSummary(bridgeNodeMap.get(nodeId));
  return {
    checkpointId,
    nodeId,
    runId: checkpoint.runId,
    title: checkpoint.title,
    summary: compactStrings([checkpoint.summary, bridgeSummary], 2).join(" | ") || undefined,
    reason: compactStrings([
      checkpoint.summary,
      checkpoint.note,
      bridgeSummary,
      "Checkpoint is still open and needs replay-aware follow-up.",
    ], 4).join(" | "),
  };
}

function buildCapabilityFocus(plan: GoalCapabilityPlan | null): GoalHandoffCapabilityFocus | undefined {
  if (!plan) return undefined;
  return {
    planId: plan.id,
    nodeId: plan.nodeId,
    status: plan.status,
    executionMode: plan.executionMode,
    riskLevel: plan.riskLevel,
    alignment: plan.analysis.status,
    summary: plan.summary || plan.analysis.summary || "",
  };
}

function renderList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${escapeMarkdown(item)}`).join("\n") : "- (none)";
}

function buildMarkdown(goal: LongTermGoal, handoff: GoalHandoffSnapshot): string {
  const focusCapabilityLine = handoff.focusCapability
    ? `${handoff.focusCapability.planId} | node=${handoff.focusCapability.nodeId} | ${handoff.focusCapability.executionMode} | risk=${handoff.focusCapability.riskLevel} | alignment=${handoff.focusCapability.alignment}`
    : "(none)";
  const checkpointLines = handoff.openCheckpoints.map((item) =>
    `[${item.status}] ${item.id}${item.nodeId ? ` | node=${item.nodeId}` : ""} | ${item.title}${item.summary ? ` | ${item.summary}` : ""}`,
  );
  const blockerLines = handoff.blockers.map((item) =>
    `[${item.kind}:${item.status}] ${item.id}${item.nodeId ? ` | node=${item.nodeId}` : ""} | ${item.title}${item.reason ? ` | ${item.reason}` : ""}`,
  );
  const replayLines = handoff.checkpointReplay
    ? [
      `checkpoint=${handoff.checkpointReplay.checkpointId}`,
      `node=${handoff.checkpointReplay.nodeId}`,
      handoff.checkpointReplay.runId ? `run=${handoff.checkpointReplay.runId}` : "",
      handoff.checkpointReplay.title,
      handoff.checkpointReplay.reason,
    ].filter(Boolean).join(" | ")
    : "(none)";
  const progressLines = handoff.recentProgress.map((entry) =>
    `${entry.at} | ${entry.event || "-"}${entry.nodeId ? ` | node=${entry.nodeId}` : ""}${entry.checkpointId ? ` | checkpoint=${entry.checkpointId}` : ""}${entry.summary ? ` | ${entry.summary}` : ""}`,
  );
  const bridgeLines = handoff.bridgeGovernance?.items?.map((item) => [
    item.runtimeState ? `[${item.runtimeState}]` : "[bridge]",
    `node=${item.nodeId}`,
    item.taskId ? `task=${item.taskId}` : "",
    item.title,
    ...compactStrings(item.summaryLines, 2),
    item.blockReason,
    item.artifactPath ? `artifact=${item.artifactPath}` : "",
    item.transcriptPath ? `transcript=${item.transcriptPath}` : "",
  ].filter(Boolean).join(" | ")) ?? [];
  const bridgeMetaLine = handoff.bridgeGovernance
    ? `nodes=${handoff.bridgeGovernance.bridgeNodeCount} | active=${handoff.bridgeGovernance.activeCount} | runtime-lost=${handoff.bridgeGovernance.runtimeLostCount} | orphaned=${handoff.bridgeGovernance.orphanedCount} | blocked=${handoff.bridgeGovernance.blockedCount}`
    : "(none)";

  return [
    "# handoff",
    "",
    "## Meta",
    `- Generated At: ${handoff.generatedAt}`,
    `- Goal ID: ${goal.id}`,
    `- Goal Title: ${goal.title}`,
    `- Goal Status: ${handoff.goalStatus}`,
    `- Current Phase: ${goal.currentPhase ?? "(none)"}`,
    `- Resume Mode: ${handoff.resumeMode}`,
    `- Resume Node: ${handoff.recommendedNodeId ?? "(none)"}`,
    `- Active Node: ${handoff.activeNodeId ?? "(none)"}`,
    `- Last Node: ${handoff.lastNodeId ?? "(none)"}`,
    `- Last Run: ${handoff.lastRunId ?? "(none)"}`,
    "",
    "## Summary",
    handoff.summary,
    "",
    "## Next Action",
    handoff.nextAction,
    "",
    "## Tracking",
    `- Total Nodes: ${handoff.tracking.totalNodes}`,
    `- Completed Nodes: ${handoff.tracking.completedNodes}`,
    `- In Progress Nodes: ${handoff.tracking.inProgressNodes}`,
    `- Blocked Nodes: ${handoff.tracking.blockedNodes}`,
    `- Pending Review Nodes: ${handoff.tracking.pendingReviewNodes}`,
    `- Validating Nodes: ${handoff.tracking.validatingNodes}`,
    `- Failed Nodes: ${handoff.tracking.failedNodes}`,
    `- Skipped Nodes: ${handoff.tracking.skippedNodes}`,
    `- Open Checkpoints: ${handoff.tracking.openCheckpointCount}`,
    "",
    "## Focus Capability",
    `- Plan: ${focusCapabilityLine}`,
    `- Summary: ${handoff.focusCapability?.summary || "(none)"}`,
    "",
    "## Open Checkpoints",
    renderList(checkpointLines),
    "",
    "## Checkpoint Replay",
    `- ${escapeMarkdown(replayLines)}`,
    "",
    "## Blockers",
    renderList(blockerLines),
    "",
    "## Bridge Governance",
    `- ${escapeMarkdown(bridgeMetaLine)}`,
    renderList(bridgeLines),
    "",
    "## Recent Timeline",
    renderList(progressLines),
    "",
  ].join("\n");
}

export function buildGoalHandoffResult(input: GoalHandoffInput): GoalHandoffReadResult {
  const { goal, runtime, graph, checkpoints, plans, progressContent, bridgeGovernanceSummary } = input;
  const openCheckpoints = checkpoints.items
    .filter((item) => item.status === "required" || item.status === "waiting_user")
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  const blockedNodes = graph.nodes.filter((node) => node.status === "blocked" || node.status === "failed");
  const focusNode = graph.nodes.find((node) => node.id === (goal.activeNodeId || goal.lastNodeId || ""));
  const focusPlan = pickFocusPlan(goal, plans);
  const recentProgress: GoalHandoffTimelineEntry[] = parseGoalProgressEntries(progressContent).slice(0, 6);
  const tracking = buildTracking(graph, checkpoints);
  const resume = resolveResumeMode(goal, openCheckpoints, blockedNodes);
  const bridgeNodeMap = buildBridgeNodeMap(bridgeGovernanceSummary);
  const bridgeFocusItem = pickBridgeFocusItem(bridgeGovernanceSummary, [
    openCheckpoints[0]?.nodeId,
    blockedNodes[0]?.id,
    resume.recommendedNodeId,
    focusNode?.id,
    goal.activeNodeId,
    goal.lastNodeId,
  ]);
  const checkpointReplay = buildCheckpointReplay(openCheckpoints, bridgeNodeMap);
  const nextReadyNode = graph.nodes.find((node) => node.status === "ready");
  const handoff: GoalHandoffSnapshot = {
    version: 1,
    goalId: goal.id,
    generatedAt: new Date().toISOString(),
    goalStatus: goal.status,
    currentPhase: goal.currentPhase,
    activeConversationId: goal.activeConversationId || runtime.activeConversationId,
    activeNodeId: goal.activeNodeId || runtime.activeNodeId,
    lastNodeId: goal.lastNodeId || runtime.lastNodeId,
    lastRunId: goal.lastRunId || runtime.lastRunId,
    resumeMode: resume.resumeMode,
    recommendedNodeId: resume.recommendedNodeId,
    summary: buildSummary(goal, openCheckpoints, blockedNodes, focusNode, bridgeFocusItem),
    nextAction: buildNextAction({
      resumeMode: resume.resumeMode,
      recommendedNodeId: resume.recommendedNodeId,
      openCheckpoints,
      blockedNodes,
      nextReadyNode,
      bridgeFocusItem,
    }),
    tracking,
    openCheckpoints: openCheckpoints.slice(0, 6).map((item) => summarizeCheckpoint(item, item.nodeId ? bridgeNodeMap.get(item.nodeId) : undefined)),
    checkpointReplay,
    blockers: buildBlockers(blockedNodes, openCheckpoints, bridgeGovernanceSummary),
    ...(bridgeGovernanceSummary ? { bridgeGovernance: bridgeGovernanceSummary } : {}),
    focusCapability: buildCapabilityFocus(focusPlan),
    recentProgress,
  };
  const content = buildMarkdown(goal, handoff);
  return {
    goal,
    handoff,
    continuationState: buildGoalContinuationState(handoff),
    content,
  };
}

export async function generateGoalHandoff(input: GoalHandoffInput): Promise<GoalHandoffGenerateResult> {
  const result = buildGoalHandoffResult(input);
  await atomicWriteGoalText(input.goal.handoffPath, result.content);
  return result;
}
