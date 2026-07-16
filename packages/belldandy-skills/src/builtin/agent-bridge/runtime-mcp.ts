import crypto from "node:crypto";
import type { ToolCallResult, ToolContext } from "../../types.js";
import { persistBridgeRunArtifacts } from "./artifacts.js";
import { resolveBridgeSubtaskSemantics } from "./governance.js";
import {
  clampBridgeOutput,
  resolveBridgeTimeoutMs,
  resolveBridgeWorkingDirectory,
  validateBridgeStructuredArgs,
} from "./policy.js";
import type { BridgeActionConfig, BridgeRunArtifactSummary, BridgeTargetConfig } from "./types.js";

function resolveMcpToolName(target: BridgeTargetConfig, action: BridgeActionConfig): string {
  return action.mcpToolName ?? target.entry.mcp?.toolName ?? "unknown";
}

function buildMcpPreview(target: BridgeTargetConfig, action: BridgeActionConfig): string {
  const serverId = target.entry.mcp?.serverId ?? "unknown";
  const toolName = resolveMcpToolName(target, action);
  return `mcp:${serverId}/${toolName}`;
}

function normalizeMcpArgs(
  target: BridgeTargetConfig,
  actionName: string,
  rawArgs: unknown,
  requestedCwd: unknown,
  context: ToolContext,
): {
  action: BridgeActionConfig;
  args: Record<string, unknown>;
  resolvedCwd?: string;
} {
  const action = target.actions[actionName];
  if (!action) {
    throw new Error(`Bridge target "${target.id}" 不存在 action "${actionName}"。`);
  }

  const args = validateBridgeStructuredArgs(action, rawArgs);
  const allowsCwd = (action.allowStructuredArgs ?? []).includes("cwd");
  const structuredCwd = typeof args.cwd === "string" ? args.cwd : undefined;

  if ((requestedCwd != null || structuredCwd) && !allowsCwd) {
    throw new Error(`Bridge target "${target.id}" 的 action "${actionName}" 未声明 cwd 参数。`);
  }

  if (
    typeof requestedCwd === "string"
    && structuredCwd
    && requestedCwd.trim()
    && requestedCwd.trim() !== structuredCwd.trim()
  ) {
    throw new Error("bridge_run.cwd 与 bridge_run.args.cwd 冲突，请只保留一处。");
  }

  if (!allowsCwd) {
    return { action, args };
  }

  const cwdInput = structuredCwd ?? requestedCwd;
  const resolvedCwd = resolveBridgeWorkingDirectory(target, cwdInput, context);
  if (resolvedCwd) {
    args.cwd = resolvedCwd;
  }

  return {
    action,
    args,
    resolvedCwd,
  };
}

function stringifyMcpResult(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  return JSON.stringify(result, null, 2);
}

export async function executeBridgeMcpRun(
  target: BridgeTargetConfig,
  actionName: string,
  rawArgs: unknown,
  cwd: unknown,
  timeoutMs: unknown,
  context: ToolContext,
): Promise<ToolCallResult> {
  const start = Date.now();
  const runId = crypto.randomUUID();
  const name = "bridge_run";

  try {
    if (!target.enabled) {
      throw new Error(`Bridge target "${target.id}" 未启用。`);
    }
    if (target.transport !== "mcp") {
      throw new Error(`Bridge target "${target.id}" 不是 mcp transport，当前为 ${target.transport}。`);
    }
    if (!context.mcp) {
      throw new Error("当前运行时未注入 MCP 能力，无法执行 mcp transport bridge target。");
    }
    if (!target.entry.mcp?.serverId || !target.entry.mcp?.toolName) {
      throw new Error(`Bridge target "${target.id}" 缺少 entry.mcp.serverId 或 entry.mcp.toolName。`);
    }

    const { action, args, resolvedCwd } = normalizeMcpArgs(target, actionName, rawArgs, cwd, context);
    const effectiveTimeoutMs = resolveBridgeTimeoutMs(target, timeoutMs, context);
    const toolName = resolveMcpToolName(target, action);
    const commandPreview = buildMcpPreview(target, action);
    const bridgeSubtask = resolveBridgeSubtaskSemantics(context, target.id, actionName);
    const result = await context.mcp.callTool({
      serverId: target.entry.mcp.serverId,
      toolName,
      arguments: args,
      ...(context.abortSignal ? { signal: context.abortSignal } : {}),
    });
    const stdout = stringifyMcpResult(result);
    const output = clampBridgeOutput(target, stdout, "", context);

    const artifactSummary: BridgeRunArtifactSummary = {
      version: 1,
      runId,
      targetId: target.id,
      action: actionName,
      ...(bridgeSubtask ? { bridgeSubtask } : {}),
      success: true,
      exitCode: 0,
      timedOut: false,
      cwd: resolvedCwd ?? context.defaultCwd ?? context.workspaceRoot,
      commandPreview: effectiveTimeoutMs
        ? `${commandPreview} --timeout ${effectiveTimeoutMs}`
        : commandPreview,
      durationMs: Date.now() - start,
      createdAt: new Date().toISOString(),
      stdout: {
        bytes: output.stdout.bytes,
        truncated: output.stdout.truncated,
      },
      stderr: {
        bytes: 0,
        truncated: false,
      },
    };
    const artifactPath = await persistBridgeRunArtifacts(
      context,
      artifactSummary,
      output.stdout.value,
      "",
    );

    return {
      id: runId,
      name,
      success: true,
      output: JSON.stringify({
        runId,
        targetId: target.id,
        action: actionName,
        ...(bridgeSubtask ? { bridgeSubtask } : {}),
        transport: "mcp",
        serverId: target.entry.mcp.serverId,
        toolName,
        commandPreview: artifactSummary.commandPreview,
        cwd: artifactSummary.cwd,
        exitCode: 0,
        stdout: output.stdout.value,
        stderr: "",
        timedOut: false,
        durationMs: Date.now() - start,
        artifactPath,
      }, null, 2),
      durationMs: Date.now() - start,
    };
  } catch (error) {
    return {
      id: runId,
      name,
      success: false,
      output: "",
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - start,
    };
  }
}
