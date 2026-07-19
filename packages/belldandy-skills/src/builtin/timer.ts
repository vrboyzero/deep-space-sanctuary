/**
 * 计时器工具 - 供 Agent 进行时间测量和性能分析
 *
 * 支持多个命名计时器并发运行，精度 0.01 秒（10ms）
 */

import crypto from "node:crypto";
import type { Tool, ToolContext, ToolCallResult, JsonObject } from "../types.js";
import { withToolContract } from "../tool-contract.js";

/** 计时器状态 */
type TimerState = {
  name: string;
  startTime: number;
  laps: number[];
  elapsedMs?: number;
  running: boolean;
};

export const MAX_TIMERS_PER_NAMESPACE = 32;
export const MAX_LAPS_PER_TIMER = 128;

type AgentTimerNamespaces = Map<string, Map<string, TimerState>>;

/** Timer 只在 conversation + agent 命名空间内可见，避免跨会话读取或修改同名状态。 */
const timers = new Map<string, AgentTimerNamespaces>();

function getAgentNamespace(context: ToolContext): string {
  return context.agentId?.trim() || "default";
}

function getTimerNamespace(context: ToolContext, create: boolean): Map<string, TimerState> | undefined {
  let conversationTimers = timers.get(context.conversationId);
  if (!conversationTimers && create) {
    conversationTimers = new Map();
    timers.set(context.conversationId, conversationTimers);
  }

  const agentNamespace = getAgentNamespace(context);
  let namespace = conversationTimers?.get(agentNamespace);
  if (!namespace && create) {
    namespace = new Map();
    conversationTimers!.set(agentNamespace, namespace);
  }
  return namespace;
}

function deleteTimer(context: ToolContext, name: string): void {
  const conversationTimers = timers.get(context.conversationId);
  const agentNamespace = getAgentNamespace(context);
  const namespace = conversationTimers?.get(agentNamespace);
  if (!namespace) {
    return;
  }

  namespace.delete(name);
  if (namespace.size === 0) {
    conversationTimers!.delete(agentNamespace);
  }
  if (conversationTimers!.size === 0) {
    timers.delete(context.conversationId);
  }
}

/** 只暴露资源计数，供 lifecycle 验收确认会话释放后 registry 真正归零。 */
export function getTimerConversationResourceSnapshot(conversationId: string): {
  namespaces: number;
  timers: number;
  laps: number;
} {
  const conversationTimers = timers.get(conversationId);
  let timerCount = 0;
  let lapCount = 0;
  for (const namespace of conversationTimers?.values() ?? []) {
    timerCount += namespace.size;
    for (const timer of namespace.values()) {
      lapCount += timer.laps.length;
    }
  }
  return {
    namespaces: conversationTimers?.size ?? 0,
    timers: timerCount,
    laps: lapCount,
  };
}

/** 格式化时间（秒，保留 2 位小数） */
function formatTime(ms: number): string {
  return (ms / 1000).toFixed(2);
}

/** timer 工具 - 统一入口 */
export const timerTool: Tool = withToolContract({
  definition: {
    name: "timer",
    description: "计时器工具，支持开始、停止、中间计时、重置和列出所有计时器。最小精度 0.01 秒。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["start", "stop", "lap", "reset", "list"],
        },
        name: {
          type: "string",
          description: "计时器名称（action=list 时可选，其他操作必填）",
        },
      },
      required: ["action"],
      oneOf: [
        { required: ["action", "name"] }, // start/stop/lap/reset 需要 name
        { required: ["action"] },          // list 不需要 name
      ],
    },
  },

  releaseConversation(conversationId: string): void {
    timers.delete(conversationId);
  },

  async execute(args: JsonObject, context: ToolContext): Promise<ToolCallResult> {
    const startTime = performance.now();
    const id = crypto.randomUUID();
    const action = args.action as string;
    const name = args.name as string | undefined;

    try {
      // list 操作不需要 name
      if (action === "list") {
        const namespace = getTimerNamespace(context, false);
        if (!namespace || namespace.size === 0) {
          return {
            id,
            name: "timer",
            success: true,
            output: "当前没有活动的计时器",
            durationMs: performance.now() - startTime,
          };
        }

        const lines: string[] = ["当前计时器列表："];
        for (const [timerName, state] of namespace.entries()) {
          const elapsed = state.running
            ? performance.now() - state.startTime
            : state.elapsedMs ?? 0;
          const status = state.running ? "运行中" : "已停止";
          const lapsInfo = state.laps.length > 0 ? ` (${state.laps.length} 个中间计时)` : "";
          lines.push(`- ${timerName}: ${formatTime(elapsed)}s [${status}]${lapsInfo}`);
        }

        return {
          id,
          name: "timer",
          success: true,
          output: lines.join("\n"),
          durationMs: performance.now() - startTime,
        };
      }

      // 其他操作需要 name
      if (!name) {
        return {
          id,
          name: "timer",
          success: false,
          output: "",
          error: `操作 ${action} 需要提供 name 参数`,
          durationMs: performance.now() - startTime,
        };
      }

      switch (action) {
        case "start": {
          const currentNamespace = getTimerNamespace(context, false);
          const existing = currentNamespace?.get(name);
          if (existing?.running) {
            return {
              id,
              name: "timer",
              success: false,
              output: "",
              error: `计时器 "${name}" 已在运行中`,
              durationMs: performance.now() - startTime,
            };
          }
          if (!existing && (currentNamespace?.size ?? 0) >= MAX_TIMERS_PER_NAMESPACE) {
            return {
              id,
              name: "timer",
              success: false,
              output: "",
              error: `每个会话与 Agent 最多 ${MAX_TIMERS_PER_NAMESPACE} 个计时器，请先 reset 不再需要的计时器`,
              durationMs: performance.now() - startTime,
            };
          }

          getTimerNamespace(context, true)!.set(name, {
            name,
            startTime: performance.now(),
            laps: [],
            running: true,
          });

          return {
            id,
            name: "timer",
            success: true,
            output: `计时器 "${name}" 已启动`,
            durationMs: performance.now() - startTime,
          };
        }

        case "stop": {
          const timer = getTimerNamespace(context, false)?.get(name);
          if (!timer) {
            return {
              id,
              name: "timer",
              success: false,
              output: "",
              error: `计时器 "${name}" 不存在`,
              durationMs: performance.now() - startTime,
            };
          }

          if (!timer.running) {
            return {
              id,
              name: "timer",
              success: false,
              output: "",
              error: `计时器 "${name}" 未在运行`,
              durationMs: performance.now() - startTime,
            };
          }

          const elapsed = performance.now() - timer.startTime;
          timer.running = false;
          timer.elapsedMs = elapsed;

          const lapsInfo = timer.laps.length > 0
            ? `\n中间计时: ${timer.laps.map((t) => formatTime(t) + "s").join(", ")}`
            : "";

          return {
            id,
            name: "timer",
            success: true,
            output: `计时器 "${name}" 已停止\n总用时: ${formatTime(elapsed)}s${lapsInfo}`,
            durationMs: performance.now() - startTime,
          };
        }

        case "lap": {
          const timer = getTimerNamespace(context, false)?.get(name);
          if (!timer) {
            return {
              id,
              name: "timer",
              success: false,
              output: "",
              error: `计时器 "${name}" 不存在`,
              durationMs: performance.now() - startTime,
            };
          }

          if (!timer.running) {
            return {
              id,
              name: "timer",
              success: false,
              output: "",
              error: `计时器 "${name}" 未在运行`,
              durationMs: performance.now() - startTime,
            };
          }

          if (timer.laps.length >= MAX_LAPS_PER_TIMER) {
            return {
              id,
              name: "timer",
              success: false,
              output: "",
              error: `每个计时器最多 ${MAX_LAPS_PER_TIMER} 个中间计时，请 stop 或 reset 后重新开始`,
              durationMs: performance.now() - startTime,
            };
          }

          const elapsed = performance.now() - timer.startTime;
          timer.laps.push(elapsed);

          return {
            id,
            name: "timer",
            success: true,
            output: `计时器 "${name}" 中间计时 #${timer.laps.length}: ${formatTime(elapsed)}s`,
            durationMs: performance.now() - startTime,
          };
        }

        case "reset": {
          const timer = getTimerNamespace(context, false)?.get(name);
          if (!timer) {
            return {
              id,
              name: "timer",
              success: false,
              output: "",
              error: `计时器 "${name}" 不存在`,
              durationMs: performance.now() - startTime,
            };
          }

          deleteTimer(context, name);

          return {
            id,
            name: "timer",
            success: true,
            output: `计时器 "${name}" 已重置并删除`,
            durationMs: performance.now() - startTime,
          };
        }

        default:
          return {
            id,
            name: "timer",
            success: false,
            output: "",
            error: `未知操作: ${action}`,
            durationMs: performance.now() - startTime,
          };
      }
    } catch (err) {
      return {
        id,
        name: "timer",
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
        durationMs: performance.now() - startTime,
      };
    }
  },
}, {
  family: "other",
  isReadOnly: false,
  isConcurrencySafe: false,
  needsPermission: false,
  riskLevel: "low",
  channels: ["gateway", "web"],
  safeScopes: ["local-safe", "web-safe"],
  activityDescription: "Manage in-memory timers for task measurement",
  resultSchema: {
    kind: "text",
    description: "Timer status and measurement text.",
  },
  outputPersistencePolicy: "conversation",
});
