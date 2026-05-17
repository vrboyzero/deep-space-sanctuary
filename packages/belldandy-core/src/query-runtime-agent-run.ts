import type { AgentUsage, BelldandyAgent } from "@belldandy/agent";
import { registerConversationToolEventObserver } from "./query-runtime-side-effects.js";

type AgentRunInput = Parameters<BelldandyAgent["run"]>[0];

export type QueryRuntimeAgentToolCall = {
  id: string;
  name: string;
  arguments?: unknown;
};

export type QueryRuntimeAgentToolResult = {
  id: string;
  name: string;
  success: boolean;
  output?: unknown;
  error?: string;
  failureKind?: string;
  metadata?: unknown;
};

export type QueryRuntimeAgentUsage = {
  inputTokens: number;
  outputTokens: number;
  inputCostUsd?: number;
  outputCostUsd?: number;
  totalCostUsd?: number;
};

export type QueryRuntimeAgentRunSummary = {
  receivedFinal: boolean;
  fullText: string;
  finalText: string;
  latestStatus?: string;
  latestUsage?: QueryRuntimeAgentUsage;
  durationMs: number;
  statusCount: number;
  deltaCount: number;
  toolCallCount: number;
  toolResultCount: number;
  toolEventCount: number;
};

export type QueryRuntimeAgentRunResult = Pick<
  QueryRuntimeAgentRunSummary,
  "finalText" | "latestUsage" | "durationMs" | "toolCallCount" | "toolResultCount" | "toolEventCount"
>;

export async function runAgentWithLifecycle(
  agent: BelldandyAgent,
  input: {
    conversationId: string;
    runInput: AgentRunInput;
    onStatus?: (item: { status: string }) => void;
    onDelta?: (item: { delta: string }) => void;
    onToolCall?: (item: QueryRuntimeAgentToolCall) => void;
    onToolResult?: (item: QueryRuntimeAgentToolResult) => void;
    onUsage?: (item: AgentUsage) => void;
    onFinal?: (item: { text: string }) => void;
    onToolEvent?: (detail: Record<string, unknown>) => void;
    onFailed?: (detail: {
      error: string;
      durationMs: number;
      statusCount: number;
      deltaCount: number;
      toolCallCount: number;
      toolResultCount: number;
      toolEventCount: number;
      latestUsage?: QueryRuntimeAgentUsage;
    }) => void;
  },
): Promise<QueryRuntimeAgentRunSummary> {
  const runStartedAt = Date.now();
  let fullText = "";
  let finalText = "";
  let receivedFinal = false;
  let latestStatus: string | undefined;
  let latestUsage: QueryRuntimeAgentUsage | undefined;
  let statusCount = 0;
  let deltaCount = 0;
  let toolCallCount = 0;
  let toolResultCount = 0;
  let toolEventCount = 0;

  const detachToolEventObserver = registerConversationToolEventObserver(
    input.conversationId,
    (detail) => {
      toolEventCount += 1;
      input.onToolEvent?.(detail);
    },
  );

  try {
    for await (const item of agent.run(input.runInput)) {
      if (item.type === "status") {
        statusCount += 1;
        latestStatus = item.status;
        input.onStatus?.({ status: item.status });
        continue;
      }

      if (item.type === "delta") {
        deltaCount += 1;
        fullText += item.delta;
        input.onDelta?.({ delta: item.delta });
        continue;
      }

      if (item.type === "tool_call") {
        toolCallCount += 1;
        input.onToolCall?.({
          id: item.id,
          name: item.name,
          arguments: item.arguments,
        });
        continue;
      }

      if (item.type === "tool_result") {
        toolResultCount += 1;
        input.onToolResult?.({
          id: item.id,
          name: item.name,
          success: item.success,
          output: item.output,
          error: item.error,
          failureKind: item.failureKind,
          metadata: item.metadata,
        });
        continue;
      }

      if (item.type === "usage") {
        latestUsage = {
          inputTokens: Number(item.inputTokens ?? 0),
          outputTokens: Number(item.outputTokens ?? 0),
          ...(typeof item.inputCostUsd === "number" ? { inputCostUsd: Number(item.inputCostUsd) } : {}),
          ...(typeof item.outputCostUsd === "number" ? { outputCostUsd: Number(item.outputCostUsd) } : {}),
          ...(typeof item.totalCostUsd === "number" ? { totalCostUsd: Number(item.totalCostUsd) } : {}),
        };
        input.onUsage?.(item);
        continue;
      }

      if (item.type === "final") {
        receivedFinal = true;
        finalText = item.text;
        fullText = item.text;
        input.onFinal?.({ text: item.text });
      }
    }

    return {
      receivedFinal,
      fullText,
      finalText,
      latestStatus,
      latestUsage,
      durationMs: Date.now() - runStartedAt,
      statusCount,
      deltaCount,
      toolCallCount,
      toolResultCount,
      toolEventCount,
    };
  } catch (error) {
    input.onFailed?.({
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - runStartedAt,
      statusCount,
      deltaCount,
      toolCallCount,
      toolResultCount,
      toolEventCount,
      latestUsage,
    });
    throw error;
  } finally {
    detachToolEventObserver();
  }
}

export async function runAgentToCompletionWithLifecycle(
  agent: BelldandyAgent,
  input: {
    conversationId: string;
    runInput: AgentRunInput;
    onToolCall?: (item: QueryRuntimeAgentToolCall) => void;
    onToolResult?: (item: QueryRuntimeAgentToolResult) => void;
    onToolEvent?: (detail: Record<string, unknown>) => void;
    onFailed?: (detail: {
      error: string;
      toolCallCount: number;
      toolResultCount: number;
      toolEventCount: number;
      latestUsage?: QueryRuntimeAgentUsage;
    }) => void;
  },
): Promise<QueryRuntimeAgentRunResult> {
  const result = await runAgentWithLifecycle(agent, {
    conversationId: input.conversationId,
    runInput: input.runInput,
    onToolCall: input.onToolCall,
    onToolResult: input.onToolResult,
    onToolEvent: input.onToolEvent,
    onFailed: (detail) => {
      input.onFailed?.({
        error: detail.error,
        toolCallCount: detail.toolCallCount,
        toolResultCount: detail.toolResultCount,
        toolEventCount: detail.toolEventCount,
        latestUsage: detail.latestUsage,
      });
    },
  });

  return {
    finalText: result.finalText,
    latestUsage: result.latestUsage,
    durationMs: result.durationMs,
    toolCallCount: result.toolCallCount,
    toolResultCount: result.toolResultCount,
    toolEventCount: result.toolEventCount,
  };
}
