/**
 * builtin 工作流：parallel-research
 *
 * 2 阶段并行研究：
 * 1. 并行研究多个主题（parallelMap）
 * 2. 汇总综合研究报告
 *
 * args：
 * - topics（必填，字符串数组）：要研究的主题列表
 * - depth（默认 "standard"）：研究深度（"quick" | "standard" | "deep"）
 */

import { createHash } from "node:crypto";
import type { WorkflowContext } from "@belldandy/agent";
import { registerBuiltinWorkflow } from "./workflow-builtin-registry.js";

const WORKFLOW_NAME = "parallel-research";
const WORKFLOW_VERSION = "1.0.0";
const WORKFLOW_DESCRIPTION = "并行研究多个主题，汇总综合研究报告";

const SCRIPT_HASH = createHash("sha256")
  .update(`${WORKFLOW_NAME}\n${WORKFLOW_VERSION}\nparallelResearch:parallelMap:summarize`)
  .digest("hex");

type ParallelResearchArgs = {
  topics?: string[];
  depth?: "quick" | "standard" | "deep";
};

const DEPTH_PROMPT_MAP: Record<string, string> = {
  quick: "快速调研，聚焦核心事实和关键结论，不超过 300 字",
  standard: "标准调研，覆盖背景、现状、关键发现和初步建议，约 500-800 字",
  deep: "深度调研，包含背景、技术细节、对比分析、风险评估和详细建议，约 1000-1500 字",
};

async function parallelResearch(ctx: WorkflowContext): Promise<string> {
  const { topics = [], depth = "standard" } = ctx.args as ParallelResearchArgs;

  if (!Array.isArray(topics) || topics.length === 0) {
    throw new Error("parallel-research 工作流需要 args.topics（非空字符串数组）");
  }

  const depthHint = DEPTH_PROMPT_MAP[depth] ?? DEPTH_PROMPT_MAP.standard;

  // 阶段1：并行研究多个主题
  ctx.phase("阶段1：并行研究");
  ctx.log(`研究 ${topics.length} 个主题：${topics.join(", ")}（深度：${depth}）`);
  const researchResults = await ctx.parallelMap(
    topics,
    (topic, index) =>
      ctx.agent(
        `请针对以下主题进行调研：\n\n主题：${topic}\n\n要求：${depthHint}\n` +
        `输出结构化调研笔记，包含：\n1. 核心概念\n2. 关键发现\n3. 相关参考`,
        { callKey: `research/${index}/${topic.slice(0, 20)}` },
      ),
  );

  const validResults = researchResults
    .filter((r) => r.ok)
    .map((r) => (r as { ok: true; value: string }).value);
  const failedCount = researchResults.filter((r) => !r.ok).length;
  if (failedCount > 0) {
    ctx.log(`${failedCount} 个主题研究失败，继续汇总已完成的 ${validResults.length} 个`);
  }

  if (validResults.length === 0) {
    throw new Error("所有主题研究均失败，无法生成汇总报告");
  }

  // 阶段2：汇总综合报告
  ctx.phase("阶段2：汇总综合报告");
  const summary = await ctx.agent(
    `请根据以下 ${validResults.length} 个主题的调研笔记，生成综合研究报告：\n\n` +
    validResults.map((notes, i) => `## 主题 ${i + 1}\n${notes}`).join("\n\n---\n\n") +
    `\n\n综合报告应包含：\n1. 研究概览（覆盖主题列表）\n2. 各主题核心发现摘要\n3. 跨主题关联分析\n4. 综合建议`,
    { role: "researcher", callKey: "summary/final" },
  );

  return summary;
}

/**
 * 注册 parallel-research builtin 工作流到 BUILTIN_WORKFLOWS 注册表。
 * 应在 gateway 装配阶段调用。
 */
export function registerParallelResearchBuiltinWorkflow(): void {
  registerBuiltinWorkflow({
    name: WORKFLOW_NAME,
    description: WORKFLOW_DESCRIPTION,
    workflowVersion: WORKFLOW_VERSION,
    scriptHash: SCRIPT_HASH,
    default: parallelResearch,
  });
}
