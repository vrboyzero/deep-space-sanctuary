import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeGoalSlug } from "./paths.js";
import { parseGoalProgressEntries } from "./progress.js";
import { buildGoalDerivedMethodDraft } from "./experience-draft-template.js";
import type {
  GoalCapabilityPlan,
  GoalMethodCandidate,
  GoalMethodCandidateGenerateResult,
  GoalMethodCandidateState,
  GoalRetrospectiveSnapshot,
  GoalTaskGraph,
  GoalTaskNode,
  LongTermGoal,
} from "./types.js";

type GoalMethodCandidateInput = {
  stateDir: string;
  goal: LongTermGoal;
  graph: GoalTaskGraph;
  plans: GoalCapabilityPlan[];
  progressContent: string;
  retrospective: GoalRetrospectiveSnapshot;
};

function getMarkdownPath(goal: Pick<LongTermGoal, "docRoot">): string {
  return path.join(goal.docRoot, "07-method-candidates.md");
}

function getJsonPath(goal: Pick<LongTermGoal, "runtimeRoot">): string {
  return path.join(goal.runtimeRoot, "method-candidates.json");
}

function slugify(input: string): string {
  return normalizeGoalSlug(input).replace(/^-+|-+$/g, "") || "method-candidate";
}

function summarizeNode(node: GoalTaskNode): string {
  return node.summary?.trim()
    || node.description?.trim()
    || node.blockReason?.trim()
    || `${node.title} 的执行与验收闭环已形成一版可复盘过程。`;
}

function scoreCandidate(node: GoalTaskNode, plan?: GoalCapabilityPlan, progressEvents: string[] = []): number {
  let score = 20;
  if (node.status === "done") score += 30;
  if (node.checkpointStatus === "approved") score += 10;
  if (node.summary || node.description) score += 10;
  if (node.acceptance.length > 0) score += 10;
  if (node.artifacts.length > 0) score += 10;
  if (progressEvents.length >= 3) score += 10;
  if (plan?.actualUsage.methods.length) score += 5;
  if (plan?.actualUsage.skills.length) score += 5;
  if (plan?.actualUsage.mcpServers.length) score += 5;
  if (plan?.analysis.status === "aligned" || plan?.analysis.status === "partial") score += 5;
  return Math.min(100, score);
}

function buildRationale(node: GoalTaskNode, plan: GoalCapabilityPlan | undefined, progressEvents: string[]): string[] {
  const reasons: string[] = [];
  if (node.status === "done") reasons.push("节点已完成，具备较高的流程稳定性。");
  if (node.checkpointStatus === "approved") reasons.push("节点经过 checkpoint 审批，流程可信度更高。");
  if (node.acceptance.length > 0) reasons.push("节点已沉淀明确验收口径，可直接作为方法输出的完成标准。");
  if (node.artifacts.length > 0) reasons.push("节点已有产物路径，可作为方法执行结果的参考证据。");
  if (progressEvents.length >= 3) reasons.push("节点在 progress 时间线上已有较完整的执行步骤记录。");
  if (plan?.actualUsage.methods.length || plan?.actualUsage.skills.length || plan?.actualUsage.mcpServers.length) {
    reasons.push("节点已记录实际能力使用，可辅助补齐方法中的工具与能力清单。");
  }
  return reasons.length > 0 ? reasons : ["当前节点已形成一版可追踪执行过程，值得作为 method 候选进入人工审阅。"];
}

async function atomicWriteJson(targetPath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), "utf-8");
  await fs.rename(tempPath, targetPath);
}

async function atomicWriteText(targetPath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tempPath, content, "utf-8");
  await fs.rename(tempPath, targetPath);
}

function buildMarkdown(goal: LongTermGoal, candidates: GoalMethodCandidate[], retrospective: GoalRetrospectiveSnapshot, markdownPath: string, jsonPath: string): string {
  const lines = [
    "# 07-method-candidates",
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
      lines.push(`  - Evidence: methods=${candidate.evidence.methodsUsed.join(", ") || "(none)"} | skills=${candidate.evidence.skillsUsed.join(", ") || "(none)"} | mcp=${candidate.evidence.mcpServersUsed.join(", ") || "(none)"}`);
      lines.push(`  - References: ${candidate.evidence.references.join(" | ") || "(none)"}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

export async function generateGoalMethodCandidates(input: GoalMethodCandidateInput): Promise<GoalMethodCandidateGenerateResult> {
  const { stateDir, goal, graph, plans, progressContent, retrospective } = input;
  const progressEntries = parseGoalProgressEntries(progressContent);
  const hydrated = await Promise.all(graph.nodes
    .filter((node) => node.status === "done" || node.checkpointStatus === "approved")
    .map(async (node) => {
      const plan = plans
        .filter((item) => item.nodeId === node.id)
        .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0];
      const nodeProgress = progressEntries
        .filter((entry) => entry.nodeId === node.id)
        .map((entry) => entry.event || entry.title)
        .filter(Boolean);
      const summary = summarizeNode(node);
      const qualityScore = scoreCandidate(node, plan, nodeProgress);
      const slug = slugify(`${goal.slug}-${node.id}-${node.title}`);
      const references = [
        goal.northstarPath,
        goal.tasksPath,
        goal.progressPath,
        retrospective.markdownPath,
        ...node.artifacts,
      ];
      const draftContent = await buildGoalDerivedMethodDraft({
        stateDir,
        goal,
        node,
        plan,
        progressEvents: nodeProgress,
        summary,
      });
      return {
        id: `method_candidate_${node.id}`,
        goalId: goal.id,
        nodeId: node.id,
        runId: node.lastRunId,
        title: `${node.title} 方法候选`,
        slug,
        status: "suggested" as const,
        summary,
        rationale: buildRationale(node, plan, nodeProgress),
        qualityScore,
        evidence: {
          nodeId: node.id,
          runId: node.lastRunId,
          nodeStatus: node.status,
          checkpointStatus: node.checkpointStatus,
          summary: node.summary ?? node.description,
          blockReason: node.blockReason,
          artifacts: [...node.artifacts],
          acceptance: [...node.acceptance],
          methodsUsed: [...(plan?.actualUsage.methods ?? [])],
          skillsUsed: [...(plan?.actualUsage.skills ?? [])],
          mcpServersUsed: [...(plan?.actualUsage.mcpServers ?? [])],
          progressEvents: nodeProgress,
          references,
        },
        draftContent,
        createdAt: new Date().toISOString(),
      };
    }));

  const candidates: GoalMethodCandidate[] = hydrated
    .filter((candidate) => candidate.qualityScore >= 50)
    .sort((left, right) => right.qualityScore - left.qualityScore || left.nodeId.localeCompare(right.nodeId));

  const state: GoalMethodCandidateState = {
    version: 1,
    items: candidates,
  };
  const jsonPath = getJsonPath(goal);
  const markdownPath = getMarkdownPath(goal);
  const content = buildMarkdown(goal, candidates, retrospective, markdownPath, jsonPath);
  await atomicWriteJson(jsonPath, state);
  await atomicWriteText(markdownPath, content);
  return {
    goal,
    candidates,
    markdownPath,
    jsonPath,
    content,
  };
}
