import fs from "node:fs";
import path from "node:path";

import {
  buildDefaultProfile,
  resolveAgentProfileMetadata,
  type AgentRegistry,
} from "@belldandy/agent";
import type { SkillRegistry } from "@belldandy/skills";

import { searchEnabledSkills } from "../extension-runtime.js";
import { buildGoalCapabilityPlan } from "../goals/capability-planner.js";
import type { GoalManager } from "../goals/manager.js";
import type { GoalCapabilityExecutionMode, GoalCapabilityGovernanceMode } from "../goals/types.js";
import type { ToolsConfigManager } from "../tools-config.js";

type GoalLike = {
  title: string;
  objective?: string;
};

type GoalNodeLike = {
  id: string;
  title: string;
  description?: string;
  phase?: string;
  owner?: string;
  lastRunId?: string;
};

type CapabilityPlanInput = {
  runId?: string;
  objective?: string;
  queryHints?: string[];
  forceMode?: GoalCapabilityExecutionMode;
  forceGovernanceMode?: GoalCapabilityGovernanceMode;
  preferredAgents?: string[];
  commanderAgentId?: string;
};

type GatewayMcpDiagnostics = {
  servers: Array<{
    id: string;
    name: string;
    status: string;
    toolCount: number;
  }>;
} | null;

type CreateCapabilityPlanGeneratorInput = {
  goalManager: GoalManager;
  methodsDir: string;
  skillRegistry: SkillRegistry;
  toolsConfigManager: ToolsConfigManager;
  agentRegistry?: AgentRegistry;
  getMcpDiagnostics: () => GatewayMcpDiagnostics;
  getDefaultCapabilityPlanInput?: () => CapabilityPlanInput;
};

function normalizeCapabilityHint(value: string): string {
  return value.trim().toLowerCase();
}

function buildCapabilityQueryHints(goal: GoalLike, node: GoalNodeLike, extraHints?: string[]): string[] {
  const values = [
    node.title,
    node.phase,
    goal.title,
    goal.objective,
    node.description,
    ...(extraHints ?? []),
  ];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed) continue;
    const key = normalizeCapabilityHint(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result.slice(0, 8);
}

function countCapabilityHits(source: string, hints: string[]): number {
  const lower = source.toLowerCase();
  return hints.reduce((score, hint) => {
    const normalized = normalizeCapabilityHint(hint);
    if (!normalized) return score;
    if (lower.includes(normalized)) return score + 10;
    const parts = normalized.split(/\s+/).filter(Boolean);
    const matchedParts = parts.filter((part) => lower.includes(part)).length;
    return score + matchedParts * 3;
  }, 0);
}

function searchCapabilityMethods(methodsDir: string, hints: string[]) {
  if (!fs.existsSync(methodsDir)) return [];
  const mdFiles = fs.readdirSync(methodsDir).filter((file) => file.endsWith(".md"));
  const matches: Array<{ file: string; title?: string; score: number; reason: string }> = [];
  for (const file of mdFiles) {
    const fullPath = path.join(methodsDir, file);
    const content = fs.readFileSync(fullPath, "utf-8");
    const score = countCapabilityHits(`${file}\n${content}`, hints);
    if (score <= 0) continue;
    const titleMatch = /^#\s+(.+)$/m.exec(content);
    matches.push({
      file,
      title: titleMatch?.[1]?.trim(),
      score,
      reason: `匹配 query hints: ${hints.slice(0, 3).join(" / ")}`,
    });
  }
  return matches.sort((left, right) => right.score - left.score).slice(0, 4);
}

function searchCapabilitySkills(
  input: Pick<CreateCapabilityPlanGeneratorInput, "skillRegistry" | "toolsConfigManager">,
  hints: string[],
) {
  const scoreByName = new Map<string, number>();
  const skillByName = new Map<string, NonNullable<ReturnType<SkillRegistry["getSkill"]>>>();
  for (const hint of hints) {
    for (const skill of searchEnabledSkills({
      skillRegistry: input.skillRegistry,
      toolsConfigManager: input.toolsConfigManager,
    }, hint)) {
      scoreByName.set(skill.name, (scoreByName.get(skill.name) ?? 0) + 10);
      if (!skillByName.has(skill.name)) {
        const resolved = input.skillRegistry.getSkill(skill.name);
        if (resolved) {
          skillByName.set(skill.name, resolved);
        }
      }
    }
  }

  const matches: Array<{ name: string; description?: string; priority?: string; source?: string; score: number; reason: string }> = [];
  for (const [name, score] of scoreByName.entries()) {
    const skill = skillByName.get(name);
    if (!skill) continue;
    matches.push({
      name,
      description: skill.description,
      priority: skill.priority,
      source: skill.source.type,
      score,
      reason: `匹配 query hints: ${hints.slice(0, 3).join(" / ")}`,
    });
  }
  return matches.sort((left, right) => right.score - left.score).slice(0, 5);
}

function searchCapabilityMcpServers(
  input: Pick<CreateCapabilityPlanGeneratorInput, "getMcpDiagnostics" | "toolsConfigManager">,
  hints: string[],
) {
  const diagnostics = input.getMcpDiagnostics();
  if (!diagnostics) return [];
  const joinedHints = hints.join(" ").toLowerCase();
  const prefersExternal = /(网页|browser|api|文档|research|调研|外部|抓取|搜索|file|filesystem|database)/i.test(joinedHints);
  return diagnostics.servers
    .filter((server) => server.status === "connected")
    .filter((server) => !input.toolsConfigManager.getConfig().disabled.mcp_servers.includes(server.id))
    .map((server) => {
      const score = prefersExternal
        ? countCapabilityHits(`${server.id} ${server.name}`, hints) + 5
        : countCapabilityHits(`${server.id} ${server.name}`, hints);
      return {
        serverId: server.id,
        status: server.status === "connected" ? "connected" as const : "unknown" as const,
        toolCount: server.toolCount,
        reason: prefersExternal
          ? "节点含外部上下文/远程能力信号，建议优先检查 MCP 入口。"
          : "当前可用的 MCP 能力候选。",
        score,
      };
    })
    .filter((item) => prefersExternal || item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map(({ score, ...item }) => item);
}

export function createCapabilityPlanGenerator(input: CreateCapabilityPlanGeneratorInput) {
  return async function generateCapabilityPlanForNode(
    goalId: string,
    nodeId: string,
    capabilityInput: CapabilityPlanInput = {},
  ) {
    const goal = await input.goalManager.getGoal(goalId);
    if (!goal) {
      throw new Error(`Goal not found: ${goalId}`);
    }

    const graph = await input.goalManager.readTaskGraph(goalId);
    const node = graph.nodes.find((item) => item.id === nodeId);
    if (!node) {
      throw new Error(`Task node not found: ${nodeId}`);
    }

    const queryHints = buildCapabilityQueryHints(goal, node, capabilityInput.queryHints);
    const methods = searchCapabilityMethods(input.methodsDir, queryHints);
    const skills = searchCapabilitySkills(input, queryHints);
    const mcpServers = searchCapabilityMcpServers(input, queryHints);
    const availableAgentProfiles = input.agentRegistry?.list() ?? [buildDefaultProfile()];
    const availableAgentIds = availableAgentProfiles.map((profile) => profile.id);
    const defaultCapabilityInput = input.getDefaultCapabilityPlanInput?.() ?? {};
    const planInput = buildGoalCapabilityPlan({
      goalTitle: goal.title,
      goalObjective: capabilityInput.objective?.trim() || goal.objective,
      nodeId: node.id,
      nodeTitle: node.title,
      nodeDescription: node.description,
      nodePhase: node.phase,
      nodeOwner: node.owner,
      queryHints,
      methods,
      skills,
      mcpServers,
      availableAgentIds,
      availableAgents: availableAgentProfiles.map((profile) => ({
        id: profile.id,
        kind: resolveAgentProfileMetadata(profile).kind,
        catalog: resolveAgentProfileMetadata(profile).catalog,
      })),
      forceMode: capabilityInput.forceMode ?? defaultCapabilityInput.forceMode,
      forceGovernanceMode: capabilityInput.forceGovernanceMode ?? defaultCapabilityInput.forceGovernanceMode,
      preferredAgents: capabilityInput.preferredAgents ?? defaultCapabilityInput.preferredAgents,
      commanderAgentId: capabilityInput.commanderAgentId ?? defaultCapabilityInput.commanderAgentId,
      runId: capabilityInput.runId ?? node.lastRunId,
    });
    const plan = await input.goalManager.saveCapabilityPlan(goalId, nodeId, planInput);
    return { goal, node, plan };
  };
}
