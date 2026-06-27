import crypto from "node:crypto";
import type { Tool, ToolCallResult } from "../../types.js";
import { withToolContract } from "../../tool-contract.js";
import { getBridgeTarget } from "./registry.js";
import {
  closeBridgeSession,
  getBridgeSessionStatus,
  listBridgeSessions,
  readBridgeSession,
  startBridgeSession,
  writeBridgeSession,
} from "./runtime-pty.js";

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function missingFieldResult(name: string, field: string, start: number): ToolCallResult {
  return {
    id: crypto.randomUUID(),
    name,
    success: false,
    output: "",
    error: `${name}.${field} 是必填项。`,
    durationMs: Date.now() - start,
  };
}

function normalizeSessionStartArgs(rawArgs: unknown, prompt: unknown): Record<string, unknown> | undefined {
  const normalizedPrompt = normalizeOptionalString(prompt);
  if (rawArgs == null && !normalizedPrompt) {
    return undefined;
  }
  if (rawArgs != null && (!rawArgs || typeof rawArgs !== "object" || Array.isArray(rawArgs))) {
    throw new Error("bridge_session_start.args 必须是对象。");
  }
  const args = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
    ? { ...(rawArgs as Record<string, unknown>) }
    : {};
  const existingPrompt = normalizeOptionalString(args.prompt);
  if (normalizedPrompt && existingPrompt && normalizedPrompt !== existingPrompt) {
    throw new Error("bridge_session_start.prompt 与 args.prompt 冲突，请只保留一处。");
  }
  if (normalizedPrompt && !existingPrompt) {
    args.prompt = normalizedPrompt;
  }
  return Object.keys(args).length > 0 ? args : undefined;
}

export const bridgeSessionStartTool: Tool = withToolContract({
  definition: {
    name: "bridge_session_start",
    description: "启动一个受控 bridge PTY 会话，用于持续驱动外部 CLI / IDE 的交互式流程。",
    parameters: {
      type: "object",
      properties: {
        targetId: {
          type: "string",
          description: "Bridge target ID，必须是 transport=pty 的目标。",
        },
        action: {
          type: "string",
          description: "目标 action 名称，例如 interactive。",
        },
        cwd: {
          type: "string",
          description: "可选工作目录。必须位于当前允许工作区内。",
        },
        args: {
          type: "object",
          description: "结构化参数对象，只允许传入 target.action 声明过的参数键。",
        },
        prompt: {
          type: "string",
          description: "首回合任务指令的便捷入口。适合 firstTurnStrategy=start-args-prompt 的 target；内部会自动映射到 args.prompt。",
        },
        cols: {
          type: "number",
          description: "可选终端列数，默认 80。",
        },
        rows: {
          type: "number",
          description: "可选终端行数，默认 24。",
        },
      },
      required: ["targetId", "action"],
    },
  },
  async execute(args, context): Promise<ToolCallResult> {
    const start = Date.now();
    const targetId = normalizeOptionalString(args.targetId);
    const action = normalizeOptionalString(args.action);
    if (!targetId) return missingFieldResult("bridge_session_start", "targetId", start);
    if (!action) return missingFieldResult("bridge_session_start", "action", start);

    const target = await getBridgeTarget(context, targetId);
    if (!target) {
      return {
        id: crypto.randomUUID(),
        name: "bridge_session_start",
        success: false,
        output: "",
        error: `Bridge target 不存在: ${targetId}`,
        durationMs: Date.now() - start,
      };
    }

    let normalizedArgs: Record<string, unknown> | undefined;
    try {
      normalizedArgs = normalizeSessionStartArgs(args.args, args.prompt);
    } catch (error) {
      return {
        id: crypto.randomUUID(),
        name: "bridge_session_start",
        success: false,
        output: "",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      };
    }

    return startBridgeSession(
      target,
      action,
      normalizedArgs,
      args.cwd,
      args.cols,
      args.rows,
      context,
    );
  },
}, {
  family: "command-exec",
  isReadOnly: false,
  isConcurrencySafe: false,
  needsPermission: true,
  riskLevel: "high",
  channels: ["gateway", "web"],
  safeScopes: ["privileged"],
  activityDescription: "Start a configured bridge PTY session for an interactive external tool",
  resultSchema: {
    kind: "text",
    description: "JSON payload describing the started bridge PTY session, target metadata, cwd, and backend.",
  },
  outputPersistencePolicy: "conversation",
});

export const bridgeSessionWriteTool: Tool = withToolContract({
  definition: {
    name: "bridge_session_write",
    description: "向 bridge PTY 会话写入输入，并返回短暂等待后的新增输出。",
    parameters: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Bridge session ID。",
        },
        data: {
          type: "string",
          description: "写入会话的数据，支持换行符。",
        },
        submitLine: {
          type: "boolean",
          description: "是否在本次写入后额外发送一次换行，用于提交当前输入行。",
        },
        waitMs: {
          type: "number",
          description: "写入后等待输出的毫秒数，默认 100，最大 10000。",
        },
      },
      required: ["sessionId"],
    },
  },
  async execute(args, context): Promise<ToolCallResult> {
    const start = Date.now();
    const sessionId = normalizeOptionalString(args.sessionId);
    if (!sessionId) return missingFieldResult("bridge_session_write", "sessionId", start);
    return writeBridgeSession(sessionId, args.data, args.submitLine, args.waitMs, context);
  },
}, {
  family: "command-exec",
  isReadOnly: false,
  isConcurrencySafe: false,
  needsPermission: true,
  riskLevel: "high",
  channels: ["gateway", "web"],
  safeScopes: ["privileged"],
  activityDescription: "Write input to a configured bridge PTY session",
  resultSchema: {
    kind: "text",
    description: "JSON payload containing session metadata and the newly captured terminal output.",
  },
  outputPersistencePolicy: "conversation",
});

export const bridgeSessionReadTool: Tool = withToolContract({
  definition: {
    name: "bridge_session_read",
    description: "读取 bridge PTY 会话当前缓冲中的新增输出。",
    parameters: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Bridge session ID。",
        },
        waitMs: {
          type: "number",
          description: "读取前等待输出的毫秒数，默认 100，最大 10000。",
        },
      },
      required: ["sessionId"],
    },
  },
  async execute(args, context): Promise<ToolCallResult> {
    const start = Date.now();
    const sessionId = normalizeOptionalString(args.sessionId);
    if (!sessionId) return missingFieldResult("bridge_session_read", "sessionId", start);
    return readBridgeSession(sessionId, args.waitMs, context);
  },
}, {
  family: "command-exec",
  isReadOnly: true,
  isConcurrencySafe: false,
  needsPermission: true,
  riskLevel: "medium",
  channels: ["gateway", "web"],
  safeScopes: ["privileged"],
  activityDescription: "Read buffered output from a bridge PTY session",
  resultSchema: {
    kind: "text",
    description: "JSON payload containing session metadata and buffered terminal output.",
  },
  outputPersistencePolicy: "conversation",
});

export const bridgeSessionStatusTool: Tool = withToolContract({
  definition: {
    name: "bridge_session_status",
    description: "查看单个 bridge 会话的状态与元数据，不消费输出缓冲。",
    parameters: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Bridge session ID。",
        },
      },
      required: ["sessionId"],
    },
  },
  async execute(args, context): Promise<ToolCallResult> {
    const start = Date.now();
    const sessionId = normalizeOptionalString(args.sessionId);
    if (!sessionId) return missingFieldResult("bridge_session_status", "sessionId", start);
    return getBridgeSessionStatus(sessionId, context);
  },
}, {
  family: "command-exec",
  isReadOnly: true,
  isConcurrencySafe: true,
  needsPermission: false,
  riskLevel: "low",
  channels: ["gateway", "web"],
  safeScopes: ["local-safe", "web-safe"],
  activityDescription: "Inspect metadata of a bridge PTY session",
  resultSchema: {
    kind: "text",
    description: "JSON payload containing bridge session status metadata.",
  },
  outputPersistencePolicy: "conversation",
});

export const bridgeSessionCloseTool: Tool = withToolContract({
  definition: {
    name: "bridge_session_close",
    description: "关闭 bridge PTY 会话并标记为 closed。",
    parameters: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Bridge session ID。",
        },
      },
      required: ["sessionId"],
    },
  },
  async execute(args, context): Promise<ToolCallResult> {
    const start = Date.now();
    const sessionId = normalizeOptionalString(args.sessionId);
    if (!sessionId) return missingFieldResult("bridge_session_close", "sessionId", start);
    return await closeBridgeSession(sessionId, context);
  },
}, {
  family: "command-exec",
  isReadOnly: false,
  isConcurrencySafe: false,
  needsPermission: true,
  riskLevel: "high",
  channels: ["gateway", "web"],
  safeScopes: ["privileged"],
  activityDescription: "Close a bridge PTY session",
  resultSchema: {
    kind: "text",
    description: "JSON payload containing the closed bridge session metadata.",
  },
  outputPersistencePolicy: "conversation",
});

export const bridgeSessionListTool: Tool = withToolContract({
  definition: {
    name: "bridge_session_list",
    description: "列出当前 bridge PTY 会话及其状态元数据。",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  async execute(_args, context): Promise<ToolCallResult> {
    return listBridgeSessions(context);
  },
}, {
  family: "command-exec",
  isReadOnly: true,
  isConcurrencySafe: true,
  needsPermission: false,
  riskLevel: "low",
  channels: ["gateway", "web"],
  safeScopes: ["local-safe", "web-safe"],
  activityDescription: "List bridge PTY sessions",
  resultSchema: {
    kind: "text",
    description: "JSON payload containing all bridge PTY sessions and their current status metadata.",
  },
  outputPersistencePolicy: "conversation",
});
