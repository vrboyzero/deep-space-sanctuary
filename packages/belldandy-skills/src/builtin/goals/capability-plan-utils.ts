import { getGlobalMemoryManager } from "@belldandy/memory";
import type {
  GoalCapabilityPlanActualUsageRecord,
  GoalCapabilityPlanOrchestrationRecord,
  GoalCapabilityPlanRecord,
  GoalCapabilityPlanStatus,
  ToolContext,
} from "../../types.js";

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function parseMcpServerId(toolName: string | undefined): string | undefined {
  const normalized = typeof toolName === "string" ? toolName.trim() : "";
  if (!normalized.startsWith("mcp_")) return undefined;
  const rest = normalized.slice(4);
  const idx = rest.indexOf("_");
  if (idx <= 0) return undefined;
  return rest.slice(0, idx);
}

export function collectCapabilityPlanActualUsage(context: ToolContext): GoalCapabilityPlanActualUsageRecord | undefined {
  try {
    const manager = getGlobalMemoryManager({
      agentId: context.agentId,
      conversationId: context.conversationId,
      workspaceRoot: context.workspaceRoot,
    });
    const task = manager?.getTaskByConversation(context.conversationId);
    if (!manager || !task) return undefined;
    const usages = manager.listExperienceUsages(200, { taskId: task.id });
    const toolNames = uniqueStrings(Array.isArray(task.toolCalls) ? task.toolCalls.map((item) => item.toolName) : []);
    return {
      methods: uniqueStrings(usages.filter((item) => item.assetType === "method").map((item) => item.assetKey)),
      skills: uniqueStrings(usages.filter((item) => item.assetType === "skill").map((item) => item.assetKey)),
      mcpServers: uniqueStrings(toolNames.map((toolName) => parseMcpServerId(toolName))),
      toolNames,
      updatedAt: task.updatedAt,
    };
  } catch {
    return undefined;
  }
}

export function buildCapabilityPlanSaveInput(
  plan: GoalCapabilityPlanRecord,
  patch: {
    status?: GoalCapabilityPlanStatus;
    runId?: string;
    orchestratedAt?: string;
    orchestration?: GoalCapabilityPlanOrchestrationRecord;
    actualUsage?: GoalCapabilityPlanActualUsageRecord;
  } = {},
) {
  return {
    id: plan.id,
    runId: patch.runId ?? plan.runId,
    status: patch.status ?? plan.status,
    executionMode: plan.executionMode,
    governanceMode: plan.governanceMode,
    commanderAgentId: plan.commanderAgentId,
    preferredAgents: plan.preferredAgents,
    riskLevel: plan.riskLevel,
    objective: plan.objective,
    summary: plan.summary,
    queryHints: plan.queryHints,
    reasoning: plan.reasoning,
    methods: plan.methods,
    skills: plan.skills,
    mcpServers: plan.mcpServers,
    subAgents: plan.subAgents,
    gaps: plan.gaps,
    checkpoint: plan.checkpoint,
    actualUsage: patch.actualUsage ?? plan.actualUsage,
    orchestratedAt: patch.orchestratedAt ?? plan.orchestratedAt,
    orchestration: patch.orchestration ?? plan.orchestration,
  };
}
