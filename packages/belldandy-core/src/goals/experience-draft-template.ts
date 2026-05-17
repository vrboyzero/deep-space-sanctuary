import {
  buildExperienceSkillMachineName,
  EXPERIENCE_METHOD_REQUIRED_HEADINGS,
  EXPERIENCE_SKILL_REQUIRED_HEADINGS,
} from "@belldandy/memory";

import { extractExperienceTemplateMarkdownSkeleton, resolveExperienceSynthesisTemplate } from "../experience-synthesis-template.js";
import type { GoalCapabilityPlan, GoalTaskNode, LongTermGoal } from "./types.js";

type BuildGoalDerivedMethodDraftInput = {
  stateDir: string;
  goal: LongTermGoal;
  node: GoalTaskNode;
  plan?: GoalCapabilityPlan;
  progressEvents: string[];
  summary: string;
};

type BuildGoalDerivedSkillDraftInput = {
  stateDir: string;
  goal: LongTermGoal;
  plan: GoalCapabilityPlan;
  summary: string;
};

function escapeFrontmatterString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function formatList(items: string[], fallback: string): string {
  const filtered = items.map((item) => item.trim()).filter(Boolean);
  return filtered.length > 0 ? filtered.join(" / ") : fallback;
}

function buildMethodFallback(input: BuildGoalDerivedMethodDraftInput): string {
  const { goal, node, plan, progressEvents, summary } = input;
  const methodLines = plan?.actualUsage.methods.length
    ? `- Methods: ${plan.actualUsage.methods.join(", ")}`
    : "- Methods: (none)";
  const skillLines = plan?.actualUsage.skills.length
    ? `- Skills: ${plan.actualUsage.skills.join(", ")}`
    : "- Skills: (none)";
  const mcpLines = plan?.actualUsage.mcpServers.length
    ? `- MCP: ${plan.actualUsage.mcpServers.join(", ")}`
    : "- MCP: (none)";
  const progressLines = progressEvents.length > 0
    ? progressEvents.map((item, index) => `${index + 1}. ${item}`)
    : ["1. 明确节点目标、依赖和验收标准。", "2. 按最小闭环执行并记录关键产物。", "3. 回归验收并补充复盘。"];
  const acceptanceLines = node.acceptance.length > 0
    ? node.acceptance.map((item) => `- ${item}`)
    : ["- (none)"];
  const artifactLines = node.artifacts.length > 0
    ? node.artifacts.map((item) => `- ${item}`)
    : ["- (none)"];
  const now = new Date().toISOString();

  return [
    "---",
    `summary: "${escapeFrontmatterString(summary)}"`,
    'status: "draft"',
    'version: "0.1.0-draft"',
    `createdAt: "${now}"`,
    `updatedAt: "${now}"`,
    "readWhen:",
    '  - "遇到相同 goal 内的相似节点时"',
    "tags:",
    '  - "goal-derived"',
    `  - "${goal.id}"`,
    `  - "${node.id}"`,
    "---",
    "",
    `# ${node.title} 方法候选`,
    "",
    "## 来源",
    `- Goal ID: ${goal.id}`,
    `- Goal Title: ${goal.title}`,
    `- Node ID: ${node.id}`,
    `- Phase: ${node.phase ?? "(none)"}`,
    `- Node Status: ${node.status}`,
    `- Checkpoint Status: ${node.checkpointStatus}`,
    node.lastRunId ? `- Run ID: ${node.lastRunId}` : "",
    "",
    "## 目标与背景",
    summary,
    "",
    "## 建议步骤",
    ...progressLines,
    "",
    "## 验收口径",
    ...acceptanceLines,
    "",
    "## 工具与能力",
    methodLines,
    skillLines,
    mcpLines,
    "",
    "## 相关产物",
    ...artifactLines,
    "",
    "## 复盘提示",
    plan?.analysis.summary || "执行类似流程时，优先检查依赖、产物和验收闭环是否齐备。",
    "",
  ].filter(Boolean).join("\n");
}

function buildSkillFallback(input: BuildGoalDerivedSkillDraftInput): string {
  const { goal, plan, summary } = input;
  const toolNames = plan.actualUsage.toolNames.length > 0
    ? plan.actualUsage.toolNames
    : [];
  const title = `${plan.nodeId} skill 候选`;
  const escapedName = `${plan.nodeId} skill draft`.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const escapedDescription = summary.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const objective = plan.objective?.trim() || goal.objective?.trim() || title;
  const constraintSummary = plan.analysis.summary.trim() || plan.summary.trim() || "待补充";
  const expectedOutput = plan.summary.trim() || "至少形成一个可检查的执行结果。";
  return [
    "---",
    `name: "${escapedName}"`,
    `description: "${escapedDescription}"`,
    'version: "0.1.0-draft"',
    `tags: ["goal-derived", "${goal.id}", "${plan.nodeId}"]`,
    `priority: ${plan.riskLevel === "high" ? "high" : "normal"}`,
    ...(toolNames.length > 0 ? [
      "eligibility:",
      "  tools:",
      ...toolNames.map((toolName) => `    - "${toolName.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`),
    ] : []),
    "---",
    "",
    `# ${title}`,
    "",
    `> ${summary}`,
    "",
    "## 快速开始",
    "1. 先确认当前节点目标、约束和验收标准。",
    plan.actualUsage.toolNames.length > 0
      ? `2. 优先按这些工具顺序执行：${plan.actualUsage.toolNames.join(", ")}。`
      : "2. 优先按当前 goal 已验证的最小闭环执行。",
    "3. 如果当前输入或目标产物偏离来源节点，先停在 candidate 层人工审阅。",
    "",
    "## 决策路由",
    `- 任务仍属于“${objective}”这一类问题时，优先复用本 skill candidate，而不是重新从零组织流程。`,
    toolNames.length > 0
      ? `- 当主路径仍依赖 ${plan.actualUsage.toolNames.join(" / ")} 这组工具时，优先沿用已验证顺序。`
      : "- 当任务仍能沿用当前 goal 的最小闭环时，优先复用本 candidate。",
    "- 如果输入约束、目标产物或边界条件明显变化，先人工审阅 candidate，不要直接发布。",
    "- 如果现有 method / skill 已经覆盖问题，优先复用现有资产，避免重复沉淀。",
    "",
    "## 输入",
    `- 任务目标：${objective}`,
    `- 关键约束：${constraintSummary}`,
    toolNames.length > 0
      ? `- 可用工具：${plan.actualUsage.toolNames.join(" / ")}`
      : "- 可用工具：沿用当前 goal 已验证的最小执行路径",
    "",
    "## 输出",
    `- 预期产物：${expectedOutput}`,
    "- 执行结果应包含：关键步骤、验证点、异常分支处理。",
    "- 如果结果不足以复用，应停留在 candidate 层，不要冒进发布。",
    "",
    "## 参考指引",
    `- Goal ID: ${goal.id}`,
    `- Node ID: ${plan.nodeId}`,
    `- Plan ID: ${plan.id}`,
    `- Plan Status: ${plan.status}`,
    plan.runId ? `- Run ID: ${plan.runId}` : "",
    `- 偏差摘要：${constraintSummary}`,
    plan.actualUsage.mcpServers.length > 0
      ? `- MCP 依赖：${plan.actualUsage.mcpServers.join(" / ")}`
      : "- MCP 依赖：无",
    "",
    "## NEVER",
    "- 不要把一次性的临时 workaround 直接写成通用规则。",
    "- 不要绕过人工审阅直接覆盖正式 skill 资产。",
    "- 不要忽略现有 method / skill，重复制造同类资产。",
    "- 如果出现新约束或新工具组合，不要假装本 candidate 仍然适用。",
    "",
    "## 适用场景",
    objective,
    "",
    "## 风险与约束",
    `- Execution Mode: ${plan.executionMode}`,
    `- Risk Level: ${plan.riskLevel}`,
    `- Checkpoint Mode: ${plan.checkpoint.approvalMode}`,
    `- Gaps: ${plan.gaps.join(" | ") || "(none)"}`,
    "",
    "## 偏差与建议",
    plan.analysis.summary,
    "",
  ].filter(Boolean).join("\n");
}

function isTemplateUsable(skeleton: string | null, requiredHeadings: readonly string[]): boolean {
  if (!skeleton) return false;
  return requiredHeadings.every((heading) => skeleton.includes(heading));
}

function buildMethodTemplateContent(
  input: BuildGoalDerivedMethodDraftInput,
  templatePath?: string | null,
): string {
  const { goal, node, plan, progressEvents, summary } = input;
  const today = new Date().toISOString().slice(0, 10);
  const title = `${node.title} 方法候选`;
  const objective = node.description?.trim() || goal.objective?.trim() || node.title;
  const stepLines = progressEvents.length > 0
    ? progressEvents.slice(0, 6).map((item, index) => `${index + 1}. ${item}`)
    : ["1. 明确节点目标、依赖和验收标准。", "2. 按最小闭环执行并记录关键产物。", "3. 回归验收并补充复盘。"];
  const methodsUsed = formatList(plan?.actualUsage.methods ?? [], "无");
  const skillsUsed = formatList(plan?.actualUsage.skills ?? [], "无");
  const mcpUsed = formatList(plan?.actualUsage.mcpServers ?? [], "无");
  const acceptance = formatList(node.acceptance, "暂无显式验收条目，先补可观察完成标准。");
  const artifacts = formatList(node.artifacts, "暂无显式产物路径，需补最小证据。");
  const references = [
    goal.northstarPath,
    goal.tasksPath,
    goal.progressPath,
    ...(templatePath ? [templatePath] : []),
    ...node.artifacts,
  ].filter(Boolean);

  return [
    `# ${title}`,
    "",
    `> ${summary}`,
    "",
    "## 0. 元信息",
    "- 方法定位：从 goal 节点执行复盘中提炼的可复用方法草稿，强调目标、验收与产物闭环。",
    "- 适用对象：需要在同类 Goal Node 中复用该执行路径的主 Agent、子 Agent 或 reviewer。",
    "- 维护建议：后续若出现返工、新约束或新工具组合，应优先更新失败经验、工具选择与成功案例。",
    "",
    "## 1. 触发条件",
    `- 需要重复完成“${node.title}”这一类任务，且希望沉淀为稳定方法。`,
    `- 当前已具备至少一版目标/执行/验收记录：${objective}`,
    "- 需要把一次做成的流程转成后续可审阅、可复用的正式草稿。",
    "",
    "## 2. 适用场景",
    `- Goal：${goal.title}`,
    `- Node：${node.id} / ${node.title}`,
    `- 场景摘要：${summary}`,
    "",
    "## 3. 执行步骤",
    ...stepLines,
    "",
    "## 4. 工具选择",
    `- 首选工具：methods=${methodsUsed} | skills=${skillsUsed} | mcp=${mcpUsed}`,
    "- 替代工具：若现有能力不可用，退回“目标澄清 -> 最小执行 -> 验收回归 -> 复盘记录”的手动闭环。",
    "- 选择依据：优先复用已在该节点真实使用并形成产物/验收证据的能力组合。",
    "",
    "## 5. 失败经验",
    "- 常见误区：只记录结果不记录路径，或跳过验收直接把一次性做法沉淀成通用方法。",
    `- 失败信号：验收口径缺失、产物不可追踪、实际工具链与方法描述脱节。当前验收=${acceptance}`,
    "- 规避方式：把关键步骤、验收口径、相关产物和失败分支一起写入草稿，再交给人工审阅。",
    "",
    "## 6. 成功案例",
    `- 案例背景：Goal=${goal.title}；Node=${node.title}${node.lastRunId ? `；Run=${node.lastRunId}` : ""}`,
    `- 做法摘要：${summary}`,
    `- 结果与启示：当前节点已形成 artifacts=${artifacts}，说明该方法至少具备一版可验证落地路径。`,
    "",
    "## 7. 相关资源",
    `- 相关技能：${skillsUsed}`,
    `- 相关方法：${methodsUsed}`,
    `- 相关文档 / 路径：${formatList(references, "无")}`,
    "",
    "## 8. 更新记录",
    `- ${today}：基于 goal 节点复盘生成初版草稿。`,
    "",
  ].join("\n");
}

function buildSkillTemplateContent(
  input: BuildGoalDerivedSkillDraftInput,
  templatePath?: string | null,
): string {
  const { goal, plan, summary } = input;
  const title = `${plan.nodeId} skill 候选`;
  const machineName = buildExperienceSkillMachineName({
    title,
    slug: plan.nodeId,
    fallback: plan.nodeId,
  });
  const description = escapeFrontmatterString(summary);
  const objective = plan.objective?.trim() || goal.objective?.trim() || plan.nodeId;
  const tools = formatList(plan.actualUsage.toolNames, "沿用当前 goal 已验证的最小执行路径");
  const mcpUsed = formatList(plan.actualUsage.mcpServers, "无");
  const methodsUsed = formatList(plan.actualUsage.methods, "无");
  const references = [
    goal.northstarPath,
    goal.tasksPath,
    goal.progressPath,
    ...(templatePath ? [templatePath] : []),
  ].filter(Boolean);

  return [
    "---",
    `name: "${escapeFrontmatterString(machineName)}"`,
    `description: "${description}"`,
    "---",
    "",
    `# ${title}`,
    "",
    "## 快速开始",
    `- 这个技能适合：处理仍属于“${objective}”这一类的多步骤执行任务。`,
    `- 使用前提：已明确关键约束、验收预期，并至少能复用 tools=${tools}。`,
    "- 典型收益：减少重复组织流程的成本，把稳定的能力边界前置到执行前。",
    "",
    "## 决策路由",
    `- 应该使用：当前问题与节点 ${plan.nodeId} 的目标、输入边界和工具组合高度相似时。`,
    "- 不该使用：任务目标、风险边界、交付产物或核心工具链已经明显变化时。",
    "- 遇到冲突时优先：先复用已有正式 method / skill；若现有资产不覆盖，再回到 candidate 人工审阅。",
    "",
    "## 输入",
    `- 必要输入：任务目标=${objective}；关键约束=${plan.analysis.summary.trim() || plan.summary.trim() || "待补充"}`,
    `- 可选输入：methods=${methodsUsed}；mcp=${mcpUsed}`,
    "- 输入质量要求：必须能说明目标产物、主要限制和最小可验证结果，避免只有模糊意图。",
    "",
    "## 输出",
    `- 直接产物：${plan.summary.trim() || "至少形成一个可检查的执行结果。"}`,
    "- 副产物：关键步骤摘要、验证点、异常分支处理与后续复用建议。",
    "- 质量门槛：结果必须可检查、可回顾，且不能绕过人工审阅直接视为正式资产。",
    "",
    "## 参考指引",
    `- 推荐流程：先复用当前节点已验证路径，再按 gaps=${formatList(plan.gaps, "(none)") || "(none)"} 补能力缺口。`,
    `- 常见变体：executionMode=${plan.executionMode}；risk=${plan.riskLevel}；checkpoint=${plan.checkpoint.approvalMode}`,
    `- 关联文件 / 模板 / 文档：${formatList(references, "无")}`,
    "",
    "## NEVER",
    "- 不要把一次性的临时 workaround 直接沉淀成通用技能规则。",
    "- 禁止绕过人工审阅直接覆盖正式 skill 资产或忽略现有 method / skill。",
    "- 高风险边界：当工具组合、输入约束或目标产物已经变化时，不要假装本 candidate 仍然适用。",
    "",
  ].join("\n");
}

export async function buildGoalDerivedMethodDraft(input: BuildGoalDerivedMethodDraftInput): Promise<string> {
  const template = await resolveExperienceSynthesisTemplate(input.stateDir, "method").catch(() => null);
  const skeleton = extractExperienceTemplateMarkdownSkeleton(template?.content ?? "");
  if (!isTemplateUsable(skeleton, EXPERIENCE_METHOD_REQUIRED_HEADINGS)) {
    return buildMethodFallback(input);
  }
  return buildMethodTemplateContent(input, template?.path);
}

export async function buildGoalDerivedSkillDraft(input: BuildGoalDerivedSkillDraftInput): Promise<string> {
  const template = await resolveExperienceSynthesisTemplate(input.stateDir, "skill").catch(() => null);
  const skeleton = extractExperienceTemplateMarkdownSkeleton(template?.content ?? "");
  if (!isTemplateUsable(skeleton, EXPERIENCE_SKILL_REQUIRED_HEADINGS)) {
    return buildSkillFallback(input);
  }
  return buildSkillTemplateContent(input, template?.path);
}
