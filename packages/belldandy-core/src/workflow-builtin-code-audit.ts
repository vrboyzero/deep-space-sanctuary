/**
 * builtin 工作流：code-audit
 *
 * 3 阶段安全审计：
 * 1. 并行扫描各模块的安全隐患
 * 2. 交叉验证（质疑可能的误报）
 * 3. 汇总完整安全审计报告
 *
 * args：
 * - targetDir（默认 "src"）：扫描目标目录
 * - modules（默认 ["auth","api","storage","ui"]）：要扫描的模块列表
 */

import { createHash } from "node:crypto";
import type { WorkflowContext } from "@belldandy/agent";
import { registerBuiltinWorkflow } from "./workflow-builtin-registry.js";

const WORKFLOW_NAME = "code-audit";
const WORKFLOW_VERSION = "1.0.0";
const WORKFLOW_DESCRIPTION = "并行扫描多个模块的安全隐患，交叉验证后汇总完整审计报告";

// 稳定 scriptHash：基于工作流名称+版本+函数体关键内容
const SCRIPT_HASH = createHash("sha256")
  .update(`${WORKFLOW_NAME}\n${WORKFLOW_VERSION}\ncodeAudit:parallel-scan:cross-verify:summarize`)
  .digest("hex");

type CodeAuditArgs = {
  targetDir?: string;
  modules?: string[];
};

async function codeAudit(ctx: WorkflowContext): Promise<string> {
  const { targetDir = "src", modules = ["auth", "api", "storage", "ui"] } = ctx.args as CodeAuditArgs;

  // 阶段1：并行扫描各模块
  ctx.phase("阶段1：并行扫描各模块");
  ctx.log(`扫描 ${modules.length} 个模块：${modules.join(", ")}`);
  const scanResults = await ctx.parallel(
    modules.map((m, index) => () =>
      ctx.agent(
        `扫描 ${targetDir}/${m} 目录中的安全隐患，重点关注：\n` +
        `1. 输入验证缺失\n2. 权限检查遗漏\n3. 敏感信息泄露\n4. 注入风险\n` +
        `输出结构化的风险清单，每项含：风险等级、位置、描述、建议修复方式。`,
        { callKey: `scan/${index}/${m}` },
      ),
    ),
  );

  const validScans = scanResults.filter((r) => r.ok).map((r) => (r as { ok: true; value: string }).value);
  const failedScans = scanResults.filter((r) => !r.ok);
  if (failedScans.length > 0) {
    ctx.log(`${failedScans.length} 个模块扫描失败，继续验证已完成的 ${validScans.length} 个`);
  }
  if (validScans.length === 0) {
    throw new Error("所有模块扫描均失败，无法继续审计");
  }

  // 阶段2：交叉验证
  ctx.phase("阶段2：交叉验证");
  const verifyResults = await ctx.parallel(
    validScans.map((report, index) => () =>
      ctx.agent(
        `以下是安全扫描报告，请质疑其中可能的误报并给出判断：\n\n${report}\n\n` +
        `对每一条风险，评估：\n1. 是否为误报（及理由）\n2. 实际严重程度\n3. 是否需要优先修复`,
        { callKey: `verify/${index}` },
      ),
    ),
  );
  const verifiedReports = verifyResults
    .filter((r) => r.ok)
    .map((r) => (r as { ok: true; value: string }).value);
  if (verifiedReports.length === 0) {
    throw new Error("所有扫描结果均未通过验证，无法生成审计报告");
  }

  // 阶段3：汇总报告
  ctx.phase("阶段3：汇总报告");
  const finalReport = await ctx.agent(
    `请根据以下已验证的安全扫描结果，生成完整的安全审计报告：\n\n` +
    verifiedReports.join("\n\n---\n\n") +
    `\n\n报告应包含：\n1. 执行摘要（总体风险等级）\n2. 风险清单（按严重程度排序）\n3. 修复建议（按优先级）\n4. 附录：扫描覆盖范围`,
    { role: "researcher", callKey: "final/report" },
  );

  return finalReport;
}

/**
 * 注册 code-audit builtin 工作流到 BUILTIN_WORKFLOWS 注册表。
 * 应在 gateway 装配阶段调用。
 */
export function registerCodeAuditBuiltinWorkflow(): void {
  registerBuiltinWorkflow({
    name: WORKFLOW_NAME,
    description: WORKFLOW_DESCRIPTION,
    workflowVersion: WORKFLOW_VERSION,
    scriptHash: SCRIPT_HASH,
    default: codeAudit,
  });
}
