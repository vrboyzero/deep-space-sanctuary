import type { AgentUsage } from "@belldandy/agent";

import type {
  QueryRuntimeAgentBudgetExhausted,
  QueryRuntimeAgentInterrupted,
  QueryRuntimeAgentToolCall,
  QueryRuntimeAgentToolResult,
} from "../query-runtime-agent-run.js";
import {
  createAgentRunEventSequencer,
  toSafeCodingRunErrorMessage,
  type AgentRunEvent,
  type CodingContextBinding,
} from "./contracts.js";

type ConversationLifecycleHandlers = {
  onStatus: (item: { status: string }) => void;
  onDelta: (item: { delta: string }) => void;
  onToolCall: (item: QueryRuntimeAgentToolCall) => void;
  onToolResult: (item: QueryRuntimeAgentToolResult) => void;
  onBudgetExhausted: (item: QueryRuntimeAgentBudgetExhausted) => void;
  onInterrupted: (item: QueryRuntimeAgentInterrupted) => void;
  onUsage: (item: AgentUsage) => void;
  onFinal: (item: { text: string }) => void;
  onFailed: (item: {
    error: string;
    durationMs: number;
    statusCount: number;
    deltaCount: number;
    toolCallCount: number;
    toolResultCount: number;
    toolEventCount: number;
  }) => void;
};

/**
 * 将现有 Conversation 生命周期投影为公共事件，不拥有、启动或完成 Conversation 本身。
 */
export function createConversationLifecycleEventAdapter(input: {
  binding: CodingContextBinding;
  onEvent: (event: AgentRunEvent) => void;
  now?: () => number;
}): {
  start: () => AgentRunEvent | undefined;
  cancel: (reason?: string) => AgentRunEvent | undefined;
  handlers: ConversationLifecycleHandlers;
} {
  const sequencer = createAgentRunEventSequencer({
    source: "conversation",
    binding: input.binding,
    onEvent: input.onEvent,
    now: input.now,
  });

  return {
    start: () => sequencer.emit("run.started", { status: "running" }),
    cancel: (reason) => sequencer.emit("run.cancelled", {
      reason: typeof reason === "string" && reason.trim() ? reason.trim() : "cancelled",
    }),
    handlers: {
      onStatus: (item) => {
        sequencer.emit("run.status", { status: item.status });
      },
      onDelta: (item) => {
        sequencer.emit("message.delta", { delta: item.delta });
      },
      onToolCall: (item) => {
        sequencer.emit("tool.started", {
          tool: {
            id: item.id,
            name: item.name,
            ...(item.arguments === undefined ? {} : { arguments: item.arguments }),
          },
        });
      },
      onToolResult: (item) => {
        sequencer.emit("tool.completed", {
          tool: {
            id: item.id,
            name: item.name,
            success: item.success,
            ...(item.output === undefined ? {} : { output: item.output }),
            ...(item.error ? { error: toSafeCodingRunErrorMessage(item.error) } : {}),
            ...(item.failureKind ? { failureKind: item.failureKind } : {}),
            ...(item.metadata === undefined ? {} : { metadata: item.metadata }),
          },
        });
      },
      onBudgetExhausted: (item) => {
        sequencer.emit("run.budget_exhausted", {
          budget: {
            budget: item.budget,
            limit: item.limit,
            observed: item.observed,
          },
        });
      },
      onInterrupted: (item) => {
        sequencer.emit("run.interrupted", {
          error: {
            message: toSafeCodingRunErrorMessage(item.error),
          },
          interrupted: {
            reason: item.reason,
            committed: item.committed,
            ...(item.code ? { code: item.code } : {}),
            partialText: item.partialText,
          },
        });
      },
      onUsage: (item) => {
        sequencer.emit("run.usage", { usage: item as unknown as Record<string, unknown> });
      },
      onFinal: (item) => {
        sequencer.emit("run.completed", { output: { text: item.text } });
      },
      onFailed: (item) => {
        sequencer.emit("run.failed", {
          error: { message: toSafeCodingRunErrorMessage(item.error) },
          summary: {
            durationMs: item.durationMs,
            statusCount: item.statusCount,
            deltaCount: item.deltaCount,
            toolCallCount: item.toolCallCount,
            toolResultCount: item.toolResultCount,
            toolEventCount: item.toolEventCount,
          },
        });
      },
    },
  };
}
