import path from "node:path";
import { atomicWriteGoalJson, atomicWriteGoalText } from "./atomic-write.js";
import { parseGoalProgressEntries } from "./progress.js";
import type {
  GoalCapabilityPlan,
  GoalCheckpointState,
  GoalHandoffSnapshot,
  GoalRetrospectiveCapabilitySummary,
  GoalRetrospectiveCheckpointSummary,
  GoalRetrospectiveGenerateResult,
  GoalRetrospectiveNodeSummary,
  GoalRetrospectiveOutcome,
  GoalRetrospectiveSnapshot,
  GoalTaskGraph,
  GoalTaskNode,
  GoalTaskNodeStatus,
  LongTermGoal,
} from "./types.js";

type GoalRetrospectiveInput = {
  goal: LongTermGoal;
  graph: GoalTaskGraph;
  checkpoints: GoalCheckpointState;
  plans: GoalCapabilityPlan[];
  progressContent: string;
  handoff: GoalHandoffSnapshot;
};

function getOutcome(goal: LongTermGoal): GoalRetrospectiveOutcome {
  switch (goal.status) {
    case "completed":
      return "completed";
    case "blocked":
      return "blocked";
    case "paused":
      return "paused";
    case "archived":
      return "archived";
    default:
      return "in_progress";
  }
}

function buildCheckpointSummary(checkpoints: GoalCheckpointState): GoalRetrospectiveCheckpointSummary {
  const items = checkpoints.items;
  return {
    total: items.length,
    waitingUserCount: items.filter((item) => item.status === "required" || item.status === "waiting_user").length,
    approvedCount: items.filter((item) => item.status === "approved").length,
    rejectedCount: items.filter((item) => item.status === "rejected").length,
    expiredCount: items.filter((item) => item.status === "expired").length,
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function buildCapabilitySummary(plans: GoalCapabilityPlan[]): GoalRetrospectiveCapabilitySummary {
  const gapCounts = new Map<string, number>();
  for (const plan of plans) {
    for (const gap of plan.gaps) {
      const key = gap.trim();
      if (!key) continue;
      gapCounts.set(key, (gapCounts.get(key) ?? 0) + 1);
    }
  }
  const topGaps = [...gapCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([gap, count]) => `${gap} (${count})`);

  return {
    totalPlans: plans.length,
    orchestratedPlans: plans.filter((item) => item.status === "orchestrated").length,
    highRiskPlans: plans.filter((item) => item.riskLevel === "high").length,
    divergedPlans: plans.filter((item) => item.analysis.status === "diverged").length,
    uniqueMethods: uniqueSorted(plans.flatMap((item) => item.actualUsage.methods)),
    uniqueSkills: uniqueSorted(plans.flatMap((item) => item.actualUsage.skills)),
    uniqueMcpServers: uniqueSorted(plans.flatMap((item) => item.actualUsage.mcpServers)),
    topGaps,
  };
}

function getNodePriority(status: GoalTaskNodeStatus): number {
  switch (status) {
    case "blocked":
    case "failed":
      return 6;
    case "pending_review":
      return 5;
    case "validating":
      return 4;
    case "in_progress":
      return 3;
    case "done":
      return 2;
    case "ready":
      return 1;
    default:
      return 0;
  }
}

function summarizeNode(node: GoalTaskNode): GoalRetrospectiveNodeSummary {
  return {
    id: node.id,
    title: node.title,
    status: node.status,
    phase: node.phase,
    owner: node.owner,
    summary: node.summary ?? node.description,
    blockReason: node.blockReason,
    checkpointStatus: node.checkpointStatus,
    lastRunId: node.lastRunId,
    artifacts: [...node.artifacts],
    updatedAt: node.updatedAt,
  };
}

function pickHighlightedNodes(graph: GoalTaskGraph): GoalRetrospectiveNodeSummary[] {
  return graph.nodes
    .slice()
    .sort((left, right) => {
      const priorityDiff = getNodePriority(right.status) - getNodePriority(left.status);
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    })
    .slice(0, 6)
    .map(summarizeNode);
}

function buildSummary(input: {
  goal: LongTermGoal;
  outcome: GoalRetrospectiveOutcome;
  taskSummary: GoalRetrospectiveSnapshot["taskSummary"];
  checkpointSummary: GoalRetrospectiveCheckpointSummary;
  capabilitySummary: GoalRetrospectiveCapabilitySummary;
}): string {
  const { goal, outcome, taskSummary, checkpointSummary, capabilitySummary } = input;
  const base = `Goal 当前状态为 ${goal.status}，共 ${taskSummary.totalNodes} 个节点，已完成 ${taskSummary.completedNodes} 个。`;
  if (outcome === "completed") {
    return `${base} 当前已形成结项态 retrospective，可转入经验沉淀与资产抽取。`;
  }
  if (outcome === "blocked") {
    return `${base} 当前存在阻塞，blocked/failed 节点 ${taskSummary.blockedNodes + taskSummary.failedNodes} 个，待先解除阻塞再继续推进。`;
  }
  if (checkpointSummary.waitingUserCount > 0) {
    return `${base} 当前仍有 ${checkpointSummary.waitingUserCount} 个待处理 checkpoint，应先完成审批闭环。`;
  }
  if (capabilitySummary.divergedPlans > 0) {
    return `${base} 已出现 ${capabilitySummary.divergedPlans} 个 capability 偏差节点，建议优先纳入复盘。`;
  }
  return `${base} 当前已具备生成阶段复盘的最小信息，可继续补齐经验候选建议。`;
}

function buildAchievements(input: {
  taskSummary: GoalRetrospectiveSnapshot["taskSummary"];
  checkpointSummary: GoalRetrospectiveCheckpointSummary;
  capabilitySummary: GoalRetrospectiveCapabilitySummary;
}): string[] {
  const items: string[] = [];
  if (input.taskSummary.completedNodes > 0) {
    items.push(`已完成 ${input.taskSummary.completedNodes} 个任务节点。`);
  }
  if (input.checkpointSummary.approvedCount > 0) {
    items.push(`已完成 ${input.checkpointSummary.approvedCount} 次 checkpoint 审批。`);
  }
  if (input.capabilitySummary.orchestratedPlans > 0) {
    items.push(`已有 ${input.capabilitySummary.orchestratedPlans} 个节点形成 orchestrated capability plan。`);
  }
  if (input.capabilitySummary.uniqueMethods.length > 0) {
    items.push(`实际复用了 ${input.capabilitySummary.uniqueMethods.length} 个 method。`);
  }
  if (input.capabilitySummary.uniqueSkills.length > 0 || input.capabilitySummary.uniqueMcpServers.length > 0) {
    items.push(`已记录实际能力使用：skill ${input.capabilitySummary.uniqueSkills.length} 个，MCP ${input.capabilitySummary.uniqueMcpServers.length} 个。`);
  }
  return items.length > 0 ? items : ["当前 goal 尚未形成足够多的可确认成果，retrospective 以过程状态为主。"];
}

function buildRecommendations(input: {
  handoff: GoalHandoffSnapshot;
  checkpointSummary: GoalRetrospectiveCheckpointSummary;
  capabilitySummary: GoalRetrospectiveCapabilitySummary;
  taskSummary: GoalRetrospectiveSnapshot["taskSummary"];
}): string[] {
  const items = [input.handoff.nextAction];
  if (input.checkpointSummary.waitingUserCount > 0) {
    items.push(`优先清理 ${input.checkpointSummary.waitingUserCount} 个待审批 checkpoint，避免流程长期停滞。`);
  }
  if (input.capabilitySummary.divergedPlans > 0) {
    items.push(`优先复盘 ${input.capabilitySummary.divergedPlans} 个 capability 偏差节点，为后续 method/skill 候选提炼证据。`);
  }
  if (input.capabilitySummary.topGaps.length > 0) {
    items.push(`关注高频能力缺口：${input.capabilitySummary.topGaps.join("；")}。`);
  }
  if (input.taskSummary.failedNodes > 0) {
    items.push(`失败节点 ${input.taskSummary.failedNodes} 个，建议先归并失败原因与补救策略。`);
  }
  return uniqueSorted(items);
}

function buildMarkdown(retrospective: GoalRetrospectiveSnapshot): string {
  const highlightedNodeLines = retrospective.highlightedNodes.length > 0
    ? retrospective.highlightedNodes.map((node) =>
      `- [${node.status}] ${node.id} | ${node.title}${node.phase ? ` | phase=${node.phase}` : ""}${node.summary ? ` | ${node.summary}` : ""}`,
    )
    : ["- (none)"];
  const recentProgressLines = retrospective.recentProgress.length > 0
    ? retrospective.recentProgress.map((entry) =>
      `- ${entry.at} | ${entry.event}${entry.nodeId ? ` | node=${entry.nodeId}` : ""}${entry.summary ? ` | ${entry.summary}` : ""}`,
    )
    : ["- (none)"];
  return [
    "# 06-retrospective",
    "",
    "## Meta",
    `- Generated At: ${retrospective.generatedAt}`,
    `- Goal ID: ${retrospective.goalId}`,
    `- Goal Status: ${retrospective.goalStatus}`,
    `- Outcome: ${retrospective.outcome}`,
    `- Current Phase: ${retrospective.currentPhase ?? "(none)"}`,
    `- Objective: ${retrospective.objective ?? "(none)"}`,
    "",
    "## Summary",
    retrospective.summary,
    "",
    "## Next Focus",
    retrospective.nextFocus,
    "",
    "## Handoff Summary",
    retrospective.handoffSummary,
    "",
    "## Task Summary",
    `- Total Nodes: ${retrospective.taskSummary.totalNodes}`,
    `- Completed Nodes: ${retrospective.taskSummary.completedNodes}`,
    `- In Progress Nodes: ${retrospective.taskSummary.inProgressNodes}`,
    `- Blocked Nodes: ${retrospective.taskSummary.blockedNodes}`,
    `- Pending Review Nodes: ${retrospective.taskSummary.pendingReviewNodes}`,
    `- Validating Nodes: ${retrospective.taskSummary.validatingNodes}`,
    `- Failed Nodes: ${retrospective.taskSummary.failedNodes}`,
    `- Skipped Nodes: ${retrospective.taskSummary.skippedNodes}`,
    `- Open Checkpoints: ${retrospective.taskSummary.openCheckpointCount}`,
    "",
    "## Checkpoints",
    `- Total: ${retrospective.checkpointSummary.total}`,
    `- Waiting User: ${retrospective.checkpointSummary.waitingUserCount}`,
    `- Approved: ${retrospective.checkpointSummary.approvedCount}`,
    `- Rejected: ${retrospective.checkpointSummary.rejectedCount}`,
    `- Expired: ${retrospective.checkpointSummary.expiredCount}`,
    "",
    "## Capability",
    `- Total Plans: ${retrospective.capabilitySummary.totalPlans}`,
    `- Orchestrated Plans: ${retrospective.capabilitySummary.orchestratedPlans}`,
    `- High Risk Plans: ${retrospective.capabilitySummary.highRiskPlans}`,
    `- Diverged Plans: ${retrospective.capabilitySummary.divergedPlans}`,
    `- Methods: ${retrospective.capabilitySummary.uniqueMethods.join(", ") || "(none)"}`,
    `- Skills: ${retrospective.capabilitySummary.uniqueSkills.join(", ") || "(none)"}`,
    `- MCP Servers: ${retrospective.capabilitySummary.uniqueMcpServers.join(", ") || "(none)"}`,
    `- Top Gaps: ${retrospective.capabilitySummary.topGaps.join(" | ") || "(none)"}`,
    "",
    "## Achievements",
    ...retrospective.achievements.map((item) => `- ${item}`),
    "",
    "## Blockers",
    ...(retrospective.blockers.length > 0 ? retrospective.blockers.map((item) => `- ${item}`) : ["- (none)"]),
    "",
    "## Recommendations",
    ...retrospective.recommendations.map((item) => `- ${item}`),
    "",
    "## Highlighted Nodes",
    ...highlightedNodeLines,
    "",
    "## Recent Progress",
    ...recentProgressLines,
    "",
    "## Output Paths",
    `- Markdown: ${retrospective.markdownPath}`,
    `- JSON: ${retrospective.jsonPath}`,
    "",
  ].join("\n");
}

export function getGoalRetrospectiveJsonPath(goal: Pick<LongTermGoal, "runtimeRoot">): string {
  return path.join(goal.runtimeRoot, "retrospective.json");
}

export function getGoalRetrospectiveMarkdownPath(goal: Pick<LongTermGoal, "docRoot">): string {
  return path.join(goal.docRoot, "06-retrospective.md");
}

export async function generateGoalRetrospective(input: GoalRetrospectiveInput): Promise<GoalRetrospectiveGenerateResult> {
  const { goal, graph, checkpoints, plans, progressContent, handoff } = input;
  const taskSummary = handoff.tracking;
  const checkpointSummary = buildCheckpointSummary(checkpoints);
  const capabilitySummary = buildCapabilitySummary(plans);
  const outcome = getOutcome(goal);
  const retrospective: GoalRetrospectiveSnapshot = {
    version: 1,
    goalId: goal.id,
    generatedAt: new Date().toISOString(),
    goalStatus: goal.status,
    currentPhase: goal.currentPhase,
    objective: goal.objective,
    outcome,
    summary: buildSummary({ goal, outcome, taskSummary, checkpointSummary, capabilitySummary }),
    nextFocus: handoff.nextAction,
    handoffSummary: handoff.summary,
    taskSummary,
    checkpointSummary,
    capabilitySummary,
    achievements: buildAchievements({ taskSummary, checkpointSummary, capabilitySummary }),
    blockers: handoff.blockers.map((item) =>
      `${item.kind}:${item.status} | ${item.id}${item.nodeId ? ` | node=${item.nodeId}` : ""}${item.reason ? ` | ${item.reason}` : ""}`,
    ),
    recommendations: buildRecommendations({ handoff, checkpointSummary, capabilitySummary, taskSummary }),
    highlightedNodes: pickHighlightedNodes(graph),
    recentProgress: parseGoalProgressEntries(progressContent).slice(0, 10),
    markdownPath: getGoalRetrospectiveMarkdownPath(goal),
    jsonPath: getGoalRetrospectiveJsonPath(goal),
  };
  const content = buildMarkdown(retrospective);
  await atomicWriteGoalJson(retrospective.jsonPath, retrospective);
  await atomicWriteGoalText(retrospective.markdownPath, content);
  return { goal, retrospective, content };
}
