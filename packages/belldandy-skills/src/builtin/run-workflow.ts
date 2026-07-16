/**
 * run_workflow — 动态工作流触发工具
 *
 * 让主 Agent（ReAct 循环）可以主动触发一个预定义的工作流脚本，
 * 执行结果（WorkflowRunResult.output）作为工具调用结果返回给主 Agent 上下文。
 *
 * 工具契约：
 * - family: session-orchestration
 * - riskLevel: high（工作流可触发高权限内置编排，必须走 Tool permission）
 * - channels: gateway
 * - inline 不能由模型 Tool 参数启用；source trust 只由 Gateway 启动策略决定
 */

import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";

import type { JsonObject, Tool, ToolCallResult, ToolContext } from "../types.js";
import { withToolContract } from "../tool-contract.js";

export const RUN_WORKFLOW_TOOL_NAME = "run_workflow";

export const runWorkflowTool: Tool = withToolContract(
  {
    definition: {
      name: RUN_WORKFLOW_TOOL_NAME,
      description:
        "执行一个预定义的动态工作流脚本完成复杂多步骤任务。工作流脚本用 TypeScript/JavaScript 编写，" +
        "通过 ctx.agent() 调度子 Agent，支持并行、断点续传和预算控制。" +
        "脚本来源：file（~/.star_sanctuary/workflows/<name>.ts|.mjs）、builtin（内置工作流）。",
      parameters: {
        type: "object",
        properties: {
          workflowName: {
            type: "string",
            description:
              "工作流名称。file 模式下对应 workflows/<name>.ts|.mjs 文件名（不含扩展名）；" +
              "builtin 模式下对应内置工作流注册名。",
          },
          sourceKind: {
            type: "string",
            enum: ["file", "builtin"],
            description: "脚本来源类型，默认 file",
          },
          args: {
            type: "object",
            description: "传给工作流脚本的静态参数（可选，必须是确定性值）",
          },
          budget: {
            type: "object",
            description: "预算约束（可选）：maxTokens/maxAgentCalls/maxRetries/maxWallClockMs/maxConcurrent",
          },
          resumeJournalId: {
            type: "string",
            description: "断点续传：传入上次运行的 journalId，已完成节点命中缓存跳过",
          },
        },
        required: ["workflowName"],
      },
    },

    async execute(args: JsonObject, context: ToolContext): Promise<ToolCallResult> {
      const start = Date.now();
      const id = crypto.randomUUID();
      const toolName = RUN_WORKFLOW_TOOL_NAME;

      const workflowName = typeof args.workflowName === "string" ? args.workflowName.trim() : "";
      if (!workflowName) {
        return {
          id,
          name: toolName,
          success: false,
          output: "",
          error: "workflowName is required",
          failureKind: "input_error",
          durationMs: Date.now() - start,
        };
      }

      const runtime = context.workflowRuntime;
      if (!runtime) {
        return {
          id,
          name: toolName,
          success: false,
          output: "",
          error: "Workflow runtime is not available in this context.",
          failureKind: "environment_error",
          durationMs: Date.now() - start,
        };
      }

      const sourceKind = typeof args.sourceKind === "string" ? args.sourceKind : "file";
      const stateDir = context.stateDir ?? context.workspaceRoot;
      if (sourceKind !== "file" && sourceKind !== "builtin") {
        return {
          id,
          name: toolName,
          success: false,
          output: "",
          error: "Only approved file and builtin workflow sources are available to tool calls.",
          failureKind: "permission_or_policy",
          durationMs: Date.now() - start,
        };
      }

      // 构建 source
      let source;
      if (sourceKind === "builtin") {
        source = { kind: "builtin" as const, name: workflowName };
      } else {
        // file 模式：在 stateDir/workflows/ 下查找 .ts / .mjs / .js
        const workflowsDir = path.join(stateDir, "workflows");
        const candidates = [
          path.join(workflowsDir, `${workflowName}.ts`),
          path.join(workflowsDir, `${workflowName}.mjs`),
          path.join(workflowsDir, `${workflowName}.js`),
        ];
        const foundPath = candidates.find((p) => {
          try { return fs.existsSync(p); } catch { return false; }
        });
        if (!foundPath) {
          return {
            id,
            name: toolName,
            success: false,
            output: "",
            error: `Workflow file not found: ${workflowName} (searched in ${workflowsDir})`,
            failureKind: "input_error",
            durationMs: Date.now() - start,
          };
        }
        source = { kind: "file" as const, path: foundPath };
      }

      // 构建 budget（从 args 透传）
      const budget = typeof args.budget === "object" && args.budget !== null ? args.budget as Record<string, unknown> : undefined;
      const budgetOpts = budget ? {
        maxTokens: typeof budget.maxTokens === "number" ? budget.maxTokens : undefined,
        maxAgentCalls: typeof budget.maxAgentCalls === "number" ? budget.maxAgentCalls : undefined,
        maxRetries: typeof budget.maxRetries === "number" ? budget.maxRetries : undefined,
        maxWallClockMs: typeof budget.maxWallClockMs === "number" ? budget.maxWallClockMs : undefined,
        maxConcurrent: typeof budget.maxConcurrent === "number" ? budget.maxConcurrent : undefined,
      } : undefined;

      const resumeJournalId = typeof args.resumeJournalId === "string" ? args.resumeJournalId : undefined;
      const workflowArgs = typeof args.args === "object" && args.args !== null ? args.args as Record<string, unknown> : undefined;

      try {
        const result = await runtime.run({
          source,
          args: workflowArgs,
          budget: budgetOpts,
          parentConversationId: context.conversationId,
          channel: "gateway",
          resumeJournalId,
          stateDir,
        });

        // 构建可读摘要
        const lines = [
          `Workflow: ${result.workflowName} v${result.workflowVersion}`,
          `Success: ${result.success}`,
          `Journal ID: ${result.journalId}`,
          `Stats: agentCalls=${result.stats.agentCalls}, cacheHits=${result.stats.cacheHits}, tokens=${result.stats.totalTokens}, duration=${result.stats.durationMs}ms`,
        ];
        if (result.error) {
          lines.push(`Error: ${result.error}`);
        }
        if (result.output) {
          lines.push("", "Output:", result.output);
        }

        return {
          id,
          name: toolName,
          success: result.success,
          output: lines.join("\n"),
          error: result.success ? undefined : result.error,
          failureKind: result.success ? undefined : "business_logic_error",
          durationMs: Date.now() - start,
          metadata: {
            journalId: result.journalId,
            scriptHash: result.scriptHash,
            workflowName: result.workflowName,
            stats: result.stats,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          id,
          name: toolName,
          success: false,
          output: "",
          error: `Workflow execution failed: ${errorMsg}`,
          failureKind: "business_logic_error",
          durationMs: Date.now() - start,
        };
      }
    },
  },
  {
    family: "session-orchestration",
    isReadOnly: false,
    isConcurrencySafe: true,
    needsPermission: true,
    riskLevel: "high",
    channels: ["gateway"],
    safeScopes: ["local-safe"],
    activityDescription: "执行预定义的动态工作流脚本，调度子 Agent 完成复杂多步骤任务",
    resultSchema: {
      kind: "text",
      description: "工作流执行结果摘要，含 journalId、统计和输出",
    },
    outputPersistencePolicy: "conversation",
  },
);
