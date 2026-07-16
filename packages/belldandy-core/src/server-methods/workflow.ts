/**
 * workflow.* RPC 方法集
 *
 * - workflow.run：客户端直接触发工作流
 * - workflow.status：查询运行状态与 Journal 统计
 * - workflow.stop：中止运行中的工作流
 * - workflow.list：列出可用脚本（file + builtin）
 */

import fs from "node:fs";
import path from "node:path";

import type { GatewayReqFrame, GatewayResFrame } from "@belldandy/protocol";
import type { WorkflowRuntimeCapabilities } from "@belldandy/skills";

import { listBuiltinWorkflows } from "../workflow-builtin-registry.js";

// ─── Types ────────────────────────────────────────────────────────────────

export type WorkflowMethodContext = {
  workflowRuntime?: WorkflowRuntimeCapabilities;
  stateDir: string;
};

// ─── 辅助函数 ─────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readRequiredString(params: Record<string, unknown>, key: string): string {
  return typeof params[key] === "string" ? params[key].trim() : "";
}

function readOptionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = readRequiredString(params, key);
  return value || undefined;
}

function isSafeWorkflowName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value)
    && !value.includes("..")
    && !value.includes("/")
    && !value.includes("\\");
}

function invalid(id: string, message: string): GatewayResFrame {
  return { type: "res", id, ok: false, error: { code: "invalid_params", message } };
}

function notAvailable(id: string): GatewayResFrame {
  return { type: "res", id, ok: false, error: { code: "not_available", message: "Workflow runtime is not available." } };
}

function okPayload(id: string, payload: unknown): GatewayResFrame {
  return { type: "res", id, ok: true, payload: payload as Record<string, unknown> };
}

function failure(id: string, code: string, error: unknown): GatewayResFrame {
  return {
    type: "res",
    id,
    ok: false,
    error: { code, message: error instanceof Error ? error.message : String(error) },
  };
}

// ─── 方法分发 ─────────────────────────────────────────────────────────────

export async function handleWorkflowMethod(
  req: GatewayReqFrame,
  ctx: WorkflowMethodContext,
): Promise<GatewayResFrame | null> {
  if (!req.method.startsWith("workflow.")) {
    return null;
  }

  if (!ctx.workflowRuntime) {
    return notAvailable(req.id);
  }

  const params = asRecord(req.params);

  switch (req.method) {
    case "workflow.run": {
      const workflowName = readRequiredString(params, "workflowName");
      if (!workflowName) return invalid(req.id, "workflowName is required");

      const sourceKind = typeof params.sourceKind === "string" ? params.sourceKind : "file";
      const stateDir = ctx.stateDir;
      if (sourceKind !== "file" && sourceKind !== "builtin") {
        return failure(req.id, "workflow_source_forbidden", new Error("Only approved file and builtin workflow sources are available."));
      }
      if (!isSafeWorkflowName(workflowName)) {
        return invalid(req.id, "workflowName must be a simple workflow identifier.");
      }

      // 构建 source
      let source;
      if (sourceKind === "builtin") {
        source = { kind: "builtin" as const, name: workflowName };
      } else {
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
          return invalid(req.id, `Workflow file not found: ${workflowName} (searched in ${workflowsDir})`);
        }
        source = { kind: "file" as const, path: foundPath };
      }

      const budget = typeof params.budget === "object" && params.budget !== null ? params.budget as Record<string, unknown> : undefined;
      const budgetOpts = budget ? {
        maxTokens: typeof budget.maxTokens === "number" ? budget.maxTokens : undefined,
        maxAgentCalls: typeof budget.maxAgentCalls === "number" ? budget.maxAgentCalls : undefined,
        maxRetries: typeof budget.maxRetries === "number" ? budget.maxRetries : undefined,
        maxWallClockMs: typeof budget.maxWallClockMs === "number" ? budget.maxWallClockMs : undefined,
        maxConcurrent: typeof budget.maxConcurrent === "number" ? budget.maxConcurrent : undefined,
      } : undefined;

      try {
        const result = await ctx.workflowRuntime.run({
          source,
          args: typeof params.args === "object" && params.args !== null ? params.args as Record<string, unknown> : undefined,
          budget: budgetOpts,
          parentConversationId: readRequiredString(params, "parentConversationId") || "rpc",
          channel: typeof params.channel === "string" ? params.channel : "gateway",
          resumeJournalId: readOptionalString(params, "resumeJournalId"),
          stateDir,
        });
        return okPayload(req.id, { result });
      } catch (err) {
        return failure(req.id, "workflow_run_failed", err);
      }
    }

    case "workflow.status": {
      const journalId = readRequiredString(params, "journalId");
      if (!journalId) return invalid(req.id, "journalId is required");
      try {
        const status = ctx.workflowRuntime.getStatus?.(journalId);
        if (!status) {
          return { type: "res", id: req.id, ok: false, error: { code: "not_found", message: `No active run for journalId: ${journalId}` } };
        }
        return okPayload(req.id, { status });
      } catch (err) {
        return failure(req.id, "workflow_status_failed", err);
      }
    }

    case "workflow.stop": {
      const journalId = readRequiredString(params, "journalId");
      if (!journalId) return invalid(req.id, "journalId is required");
      try {
        const stopped = await ctx.workflowRuntime.stop(journalId, readOptionalString(params, "reason") ?? "Stopped by user");
        return okPayload(req.id, { stopped, journalId });
      } catch (err) {
        return failure(req.id, "workflow_stop_failed", err);
      }
    }

    case "workflow.list": {
      const stateDir = ctx.stateDir;
      const workflowsDir = path.join(stateDir, "workflows");
      const fileWorkflows: Array<{ name: string; ext: string }> = [];
      try {
        if (fs.existsSync(workflowsDir)) {
          const entries = fs.readdirSync(workflowsDir);
          for (const entry of entries) {
            const ext = path.extname(entry).toLowerCase();
            if (ext === ".ts" || ext === ".mjs" || ext === ".js") {
              fileWorkflows.push({ name: path.basename(entry, ext), ext });
            }
          }
        }
      } catch {
        // workflows 目录不存在或读取失败，返回空列表
      }

      const builtinWorkflows = listBuiltinWorkflows().map((entry) => ({
        name: entry.name,
        description: entry.description ?? "",
        workflowVersion: entry.workflowVersion ?? "1.0.0",
      }));

      return okPayload(req.id, {
        fileWorkflows,
        builtinWorkflows,
        workflowsDir,
      });
    }

    default:
      return null;
  }
}
