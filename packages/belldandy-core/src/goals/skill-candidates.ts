import path from "node:path";
import { atomicWriteGoalJson, atomicWriteGoalText } from "./atomic-write.js";
import { normalizeGoalSlug } from "./paths.js";
import { buildGoalDerivedSkillDraft } from "./experience-draft-template.js";
import type {
  GoalCapabilityPlan,
  GoalRetrospectiveSnapshot,
  GoalSkillCandidate,
  GoalSkillCandidateGenerateResult,
  GoalSkillCandidateState,
  LongTermGoal,
} from "./types.js";

type GoalSkillCandidateInput = {
  stateDir: string;
  goal: LongTermGoal;
  plans: GoalCapabilityPlan[];
  retrospective: GoalRetrospectiveSnapshot;
};

function getMarkdownPath(goal: Pick<LongTermGoal, "docRoot">): string {
  return path.join(goal.docRoot, "08-skill-candidates.md");
}

function getJsonPath(goal: Pick<LongTermGoal, "runtimeRoot">): string {
  return path.join(goal.runtimeRoot, "skill-candidates.json");
}

function slugify(input: string): string {
  return normalizeGoalSlug(input).replace(/^-+|-+$/g, "") || "skill-candidate";
}

function scoreCandidate(plan: GoalCapabilityPlan): number {
  let score = 20;
  score += Math.min(20, plan.gaps.length * 10);
  score += Math.min(15, plan.actualUsage.toolNames.length * 3);
  score += Math.min(10, plan.actualUsage.mcpServers.length * 5);
  score += Math.min(10, plan.subAgents.length * 5);
  if (plan.executionMode === "multi_agent") score += 10;
  if (plan.riskLevel === "high") score += 10;
  if (plan.analysis.status === "diverged") score += 15;
  if (plan.analysis.status === "partial") score += 8;
  return Math.min(100, score);
}

function buildSummary(plan: GoalCapabilityPlan): string {
  if (plan.gaps.length > 0) {
    return `节点 ${plan.nodeId} 暴露出能力缺口：${plan.gaps.join("；")}，已具备沉淀 skill 候选的价值。`;
  }
  if (plan.analysis.deviations.length > 0) {
    return `节点 ${plan.nodeId} 出现计划/实际偏差，说明现有能力封装不足，适合收敛为 skill 候选。`;
  }
  return `节点 ${plan.nodeId} 已形成一组可复用的工具编排与执行约束，适合沉淀为 skill 草稿。`;
}

function buildRationale(plan: GoalCapabilityPlan): string[] {
  const reasons: string[] = [];
  if (plan.gaps.length > 0) reasons.push(`存在能力缺口：${plan.gaps.join(" | ")}。`);
  if (plan.executionMode === "multi_agent") reasons.push("节点需要 multi-agent 编排，说明已超出单步 method 的表达能力。");
  if (plan.actualUsage.toolNames.length >= 2) reasons.push("节点已形成多工具组合使用路径，适合作为 skill 封装。");
  if (plan.actualUsage.mcpServers.length > 0) reasons.push("节点依赖 MCP server 协同，适合沉淀为可复用 skill。");
  if (plan.analysis.deviations.length > 0) reasons.push("节点存在 capability 偏差，当前更需要能力封装而不是只补 method。");
  if (plan.riskLevel === "high") reasons.push("节点为高风险执行场景，skill 化有助于稳定执行约束。");
  return reasons.length > 0 ? reasons : ["当前节点已形成一组可复用执行模式，值得作为 skill 候选进入人工审阅。"];
}

function buildMarkdown(goal: LongTermGoal, candidates: GoalSkillCandidate[], retrospective: GoalRetrospectiveSnapshot, markdownPath: string, jsonPath: string): string {
  const lines = [
    "# 08-skill-candidates",
    "",
    "## Meta",
    `- Goal ID: ${goal.id}`,
    `- Goal Title: ${goal.title}`,
    `- Generated At: ${new Date().toISOString()}`,
    `- Retrospective: ${retrospective.markdownPath}`,
    `- JSON Path: ${jsonPath}`,
    `- Markdown Path: ${markdownPath}`,
    "",
    "## Summary",
    `- Candidate Count: ${candidates.length}`,
    `- Goal Status: ${goal.status}`,
    `- Current Phase: ${goal.currentPhase ?? "(none)"}`,
    "",
    "## Candidates",
  ];
  if (candidates.length === 0) {
    lines.push("- (none)");
  } else {
    for (const candidate of candidates) {
      lines.push(`- [score=${candidate.qualityScore}] ${candidate.id} | ${candidate.nodeId} | ${candidate.title}`);
      lines.push(`  - Summary: ${candidate.summary}`);
      lines.push(`  - Rationale: ${candidate.rationale.join(" | ")}`);
      lines.push(`  - Evidence: gaps=${candidate.evidence.gaps.join(", ") || "(none)"} | tools=${candidate.evidence.toolNamesUsed.join(", ") || "(none)"} | mcp=${candidate.evidence.mcpServersUsed.join(", ") || "(none)"}`);
      lines.push(`  - References: ${candidate.evidence.references.join(" | ") || "(none)"}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

export async function generateGoalSkillCandidates(input: GoalSkillCandidateInput): Promise<GoalSkillCandidateGenerateResult> {
  const { stateDir, goal, plans, retrospective } = input;
  const hydrated = await Promise.all(plans
    .filter((plan) =>
      plan.gaps.length > 0
      || plan.executionMode === "multi_agent"
      || plan.actualUsage.toolNames.length >= 2
      || plan.analysis.status === "diverged"
      || plan.analysis.status === "partial",
    )
    .map(async (plan) => {
      const summary = buildSummary(plan);
      const qualityScore = scoreCandidate(plan);
      const references = [
        goal.northstarPath,
        goal.tasksPath,
        goal.progressPath,
        retrospective.markdownPath,
      ];
      const draftContent = await buildGoalDerivedSkillDraft({
        stateDir,
        goal,
        plan,
        summary,
      });
      return {
        id: `skill_candidate_${plan.nodeId}`,
        goalId: goal.id,
        nodeId: plan.nodeId,
        runId: plan.runId,
        title: `${plan.nodeId} skill 候选`,
        slug: slugify(`${goal.slug}-${plan.nodeId}-skill`),
        status: "suggested" as const,
        summary,
        rationale: buildRationale(plan),
        qualityScore,
        evidence: {
          nodeId: plan.nodeId,
          runId: plan.runId,
          executionMode: plan.executionMode,
          riskLevel: plan.riskLevel,
          planStatus: plan.status,
          objective: plan.objective,
          summary: plan.summary,
          gaps: [...plan.gaps],
          methodsUsed: [...plan.actualUsage.methods],
          skillsUsed: [...plan.actualUsage.skills],
          mcpServersUsed: [...plan.actualUsage.mcpServers],
          toolNamesUsed: [...plan.actualUsage.toolNames],
          deviations: plan.analysis.deviations.map((item) => `[${item.area}] ${item.summary}`),
          references,
        },
        draftContent,
        createdAt: new Date().toISOString(),
      };
    }));

  const candidates: GoalSkillCandidate[] = hydrated
    .filter((candidate) => candidate.qualityScore >= 45)
    .sort((left, right) => right.qualityScore - left.qualityScore || left.nodeId.localeCompare(right.nodeId));

  const state: GoalSkillCandidateState = {
    version: 1,
    items: candidates,
  };
  const jsonPath = getJsonPath(goal);
  const markdownPath = getMarkdownPath(goal);
  const content = buildMarkdown(goal, candidates, retrospective, markdownPath, jsonPath);
  await atomicWriteGoalJson(jsonPath, state);
  await atomicWriteGoalText(markdownPath, content);
  return {
    goal,
    candidates,
    markdownPath,
    jsonPath,
    content,
  };
}
