/**
 * service_restart - 供 Agent 调用的服务重启工具
 *
 * 通过 process.exit(100) 触发 launcher 的自动重启机制。
 * 与 .env 文件变更触发的重启、WebSocket system.restart 命令使用同一套机制。
 *
 * 重启前会进行 3 秒倒计时，每秒广播一次 agent.status 事件，
 * 让 WebChat 等客户端可以展示倒计时提示。
 */

import type { Tool, ToolContext, ToolCallResult, JsonObject } from "../types.js";
import {
  checkAndConsumeRestartCooldown,
  formatRestartCooldownMessage,
  getRestartCommandCooldownSeconds,
} from "./restart-cooldown.js";
import { withToolContract } from "../tool-contract.js";
import { isAbortError, readAbortReason, sleepWithAbort, throwIfAborted } from "../abort-utils.js";

/** 广播函数接口，由 gateway 注入 */
export type BroadcastFn = (msg: unknown) => void;
export type RequestServiceRestartFn = (reason: string) => void;

const COUNTDOWN_SECONDS = 3;

export function createServiceRestartTool(
  broadcast?: BroadcastFn,
  requestRestart?: RequestServiceRestartFn,
): Tool {
  return withToolContract({
    definition: {
      name: "service_restart",
      description:
        "Restart the Star Sanctuary gateway service. Use this when configuration changes require a restart, or when the user explicitly requests a service restart. The service will gracefully shut down and automatically restart via the launcher supervisor. A 3-second countdown will be broadcast to all connected clients before the restart. A 180-second cooldown applies between restart commands.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Brief reason for the restart (for logging purposes)",
          },
        },
      },
    },

    async execute(
      args: JsonObject,
      context: ToolContext,
    ): Promise<ToolCallResult> {
      const startMs = Date.now();
      const reason = (args.reason as string) || "agent requested restart";
      const cooldownCheck = checkAndConsumeRestartCooldown({
        nowMs: startMs,
        stateDir: context.workspaceRoot,
      });
      if (!cooldownCheck.allowed) {
        const output = formatRestartCooldownMessage(cooldownCheck.remainingSeconds);
        context.logger?.warn(
          `Service restart blocked by cooldown: ${cooldownCheck.remainingSeconds}s remaining`,
        );
        return {
          id: "",
          name: "service_restart",
          success: false,
          output,
          error: output,
          durationMs: Date.now() - startMs,
        };
      }

      context.logger?.info(`Service restart requested: ${reason}`);

      try {
        throwIfAborted(context.abortSignal);

        // 倒计时广播：3, 2, 1
        for (let i = COUNTDOWN_SECONDS; i >= 1; i--) {
          broadcast?.({
            type: "event",
            event: "agent.status",
            payload: { status: "restarting", reason, countdown: i },
          });
          await sleepWithAbort(1000, context.abortSignal);
        }

        throwIfAborted(context.abortSignal);

        // 倒计时结束，发送最终重启通知
        broadcast?.({
          type: "event",
          event: "agent.status",
          payload: { status: "restarting", reason, countdown: 0 },
        });

        if (requestRestart) {
          requestRestart(reason);
        } else {
          // 独立使用时保留兼容 fallback；Gateway 装配必须注入统一 shutdown owner。
          setTimeout(() => process.exit(100), 300);
        }

        return {
          id: "",
          name: "service_restart",
          success: true,
          output: `Service restart initiated (after ${COUNTDOWN_SECONDS}s countdown, cooldown ${getRestartCommandCooldownSeconds()}s). Reason: ${reason}`,
          durationMs: Date.now() - startMs,
        };
      } catch (error) {
        if (isAbortError(error)) {
          const abortReason = readAbortReason(context.abortSignal);
          context.logger?.warn(`Service restart aborted before exit: ${abortReason}`);
          return {
            id: "",
            name: "service_restart",
            success: false,
            output: "",
            error: abortReason,
            durationMs: Date.now() - startMs,
          };
        }
        throw error;
      }
    },
  }, {
    family: "service-admin",
    isReadOnly: false,
    isConcurrencySafe: false,
    needsPermission: true,
    riskLevel: "critical",
    channels: ["gateway", "web"],
    safeScopes: ["privileged"],
    activityDescription: "Restart the gateway service through the launcher supervisor",
    resultSchema: {
      kind: "text",
      description: "Service restart initiation status text.",
    },
    outputPersistencePolicy: "external-state",
  });
}

