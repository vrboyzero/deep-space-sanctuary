import { sanitizeCommandPermissionPreview } from "@belldandy/skills";
import type { CodingRunModelRouteEvidence, CodingRunOptions } from "@belldandy/protocol";

import {
  CODING_RUN_CAPABILITIES,
  createAgentRunEventSequencer,
  toSafeCodingRunErrorMessage,
  type AgentRunEvent,
  type AgentRunEventSequencer,
  type CodingRunErrorCode,
  type CodingRunUsageCompleteness,
} from "./contracts.js";

type GatewayRunBinding = {
  agentRunId: string;
  conversationId: string;
};

export type GatewayConversationEventAdapter = {
  start: (binding: GatewayRunBinding, traceContext?: {
    promptId?: string;
    agentId?: string;
    modelRoute?: CodingRunModelRouteEvidence;
  }) => AgentRunEvent | undefined;
  consume: (input: { event: string; payload: unknown }) => AgentRunEvent | undefined;
  fail: (input: { code?: CodingRunErrorCode; message: string }) => AgentRunEvent | undefined;
  getTerminalEvent: () => AgentRunEvent | undefined;
  hasTerminated: () => boolean;
};

/**
 * 将 Gateway 既有 Conversation 事件投影为 v1，不修改 Gateway 或 Conversation 的运行态。
 */
export function createGatewayConversationEventAdapter(input: {
  automationProfile?: CodingRunOptions["automationProfile"];
  onEvent: (event: AgentRunEvent) => void;
  now?: () => number;
}): GatewayConversationEventAdapter {
  let binding: GatewayRunBinding | undefined;
  let sequencer: AgentRunEventSequencer | undefined;
  let terminalEvent: AgentRunEvent | undefined;
  let gatewayReportedFailure = false;
  let gatewayFailureCode: CodingRunErrorCode | undefined;
  let gatewayFailureMessage: string | undefined;
  let budgetExhausted = false;
  let latestUsageCompleteness: CodingRunUsageCompleteness = {
    status: "incomplete",
    reason: "usage_not_reported",
  };

  const emit = (type: AgentRunEvent["type"], payload: Record<string, unknown>): AgentRunEvent | undefined => {
    const event = sequencer?.emit(type, isTerminalEventType(type)
      ? { ...payload, usage: latestUsageCompleteness }
      : payload);
    if (event && isTerminalEventType(event.type)) {
      terminalEvent = event;
    }
    return event;
  };

  return {
    start: (nextBinding, traceContext) => {
      if (sequencer) return undefined;
      binding = { ...nextBinding };
      sequencer = createAgentRunEventSequencer({
        source: "conversation",
        binding,
        onEvent: input.onEvent,
        now: input.now,
      });
      const promptId = getNonEmptyString(traceContext?.promptId);
      return emit("run.started", {
        status: "running",
        ...(input.automationProfile ? { automationProfile: input.automationProfile } : {}),
        ...(traceContext?.modelRoute ? { modelRoute: { ...traceContext.modelRoute } } : {}),
        traceContext: {
          ...(promptId ? { promptId } : {}),
          agentId: getNonEmptyString(traceContext?.agentId) ?? "default",
        },
        capabilities: CODING_RUN_CAPABILITIES,
      });
    },
    consume: ({ event, payload }) => {
      if (!binding || !sequencer || sequencer.hasTerminated()) return undefined;
      const gatewayPayload = getMatchingGatewayPayload(payload, binding);
      if (!gatewayPayload) return undefined;

      if (event === "agent.status") {
        const status = typeof gatewayPayload.status === "string" && gatewayPayload.status.trim()
          ? gatewayPayload.status.trim()
          : "unknown";
        gatewayReportedFailure ||= status === "error";
        if (status === "error") {
          gatewayFailureCode = readCodingRunErrorCode(gatewayPayload.code) ?? gatewayFailureCode;
          gatewayFailureMessage = getNonEmptyString(gatewayPayload.error)
            ? toSafeCodingRunErrorMessage(String(gatewayPayload.error))
            : gatewayFailureMessage;
        }
        return emit("run.status", { status });
      }
      if (event === "chat.delta" && typeof gatewayPayload.delta === "string") {
        return emit("message.delta", { delta: gatewayPayload.delta });
      }
      if (event === "tool_call") {
        const id = getNonEmptyString(gatewayPayload.id);
        const name = getNonEmptyString(gatewayPayload.name);
        if (!id || !name) return undefined;
        return emit("tool.started", {
          tool: {
            id,
            name,
            ...(gatewayPayload.arguments === undefined ? {} : { arguments: gatewayPayload.arguments }),
          },
        });
      }
      if (event === "tool_result") {
        const id = getNonEmptyString(gatewayPayload.id);
        const name = getNonEmptyString(gatewayPayload.name);
        if (!id || !name || typeof gatewayPayload.success !== "boolean") return undefined;
        return emit("tool.completed", {
          tool: {
            id,
            name,
            success: gatewayPayload.success,
            ...(gatewayPayload.output === undefined ? {} : { output: gatewayPayload.output }),
            ...(typeof gatewayPayload.error === "string"
              ? { error: toSafeCodingRunErrorMessage(gatewayPayload.error) }
              : {}),
            ...(typeof gatewayPayload.failureKind === "string" ? { failureKind: gatewayPayload.failureKind } : {}),
            ...(gatewayPayload.metadata === undefined ? {} : { metadata: gatewayPayload.metadata }),
          },
        });
      }
      if (event === "tool_event" && gatewayPayload.kind === "coding_run_permission_requested") {
        const toolCallId = getNonEmptyString(gatewayPayload.toolCallId);
        const toolName = getNonEmptyString(gatewayPayload.toolName);
        if (!toolCallId || !toolName) return undefined;
        const commandPreview = toolName === "run_command" || toolName === "command_job"
          ? sanitizeCommandPermissionPreview(gatewayPayload.commandPreview)
          : undefined;
        return emit("permission.requested", {
          permission: {
            toolCallId,
            toolName,
            ...(getNonEmptyString(gatewayPayload.worktreeId) ? { worktreeId: gatewayPayload.worktreeId } : {}),
            ...(commandPreview ? { commandPreview } : {}),
          },
        });
      }
      if (event === "token.usage") {
        const usage = projectGatewayUsage(gatewayPayload);
        latestUsageCompleteness = usage.completeness;
        return emit("run.usage", { usage });
      }
      if (event === "agent.budget_exhausted") {
        budgetExhausted = true;
        const policyId = gatewayPayload.policyId === "cost-containment-v1"
          ? gatewayPayload.policyId
          : undefined;
        const stage = gatewayPayload.stage === "before_model_call" || gatewayPayload.stage === "before_tool_call"
          ? gatewayPayload.stage
          : undefined;
        const reasonCode = isModelLoopBudgetReasonCode(gatewayPayload.reasonCode)
          ? gatewayPayload.reasonCode
          : undefined;
        return emit("run.budget_exhausted", {
          budget: {
            budget: gatewayPayload.budget,
            limit: gatewayPayload.limit,
            observed: gatewayPayload.observed,
            ...(policyId ? { policyId } : {}),
            ...(stage ? { stage } : {}),
            ...(reasonCode ? { reasonCode } : {}),
          },
        });
      }
      if (event === "conversation.run.stopped") {
        return emit("run.cancelled", {
          reason: getNonEmptyString(gatewayPayload.reason) ?? "cancelled",
          hadPartialResponse: gatewayPayload.hadPartialResponse === true,
        });
      }
      if (event === "conversation.run.interrupted") {
        return emit("run.interrupted", {
          error: {
            message: toSafeCodingRunErrorMessage(
              getNonEmptyString(gatewayPayload.error) ?? "Gateway conversation run interrupted.",
            ),
          },
          interrupted: {
            reason: getNonEmptyString(gatewayPayload.reason) ?? "interrupted",
            ...(getNonEmptyString(gatewayPayload.code) ? { code: gatewayPayload.code } : {}),
            hadPartialResponse: gatewayPayload.hadPartialResponse === true,
          },
        });
      }
      if (event === "chat.final") {
        const text = typeof gatewayPayload.text === "string" ? gatewayPayload.text : "";
        if (gatewayReportedFailure) {
          return emit("run.failed", {
            error: {
              code: gatewayFailureCode ?? (budgetExhausted ? "budget_exhausted" : "internal"),
              message: gatewayFailureMessage
                ?? toSafeCodingRunErrorMessage(text || "Gateway reported an execution failure."),
            },
            output: { text },
          });
        }
        return emit("run.completed", { output: { text } });
      }
      return undefined;
    },
    fail: ({ code = "internal", message }) => {
      if (!sequencer || sequencer.hasTerminated()) return undefined;
      return emit("run.failed", {
        error: {
          code,
          message: toSafeCodingRunErrorMessage(message),
        },
      });
    },
    getTerminalEvent: () => terminalEvent,
    hasTerminated: () => sequencer?.hasTerminated() ?? false,
  };
}

function isModelLoopBudgetReasonCode(value: unknown): value is
  | "model_call_limit"
  | "file_read_call_limit"
  | "text_search_call_limit"
  | "insufficient_remaining_tokens"
  | "insufficient_remaining_cost" {
  return value === "model_call_limit"
    || value === "file_read_call_limit"
    || value === "text_search_call_limit"
    || value === "insufficient_remaining_tokens"
    || value === "insufficient_remaining_cost";
}

function getMatchingGatewayPayload(value: unknown, binding: GatewayRunBinding): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  return value.conversationId === binding.conversationId && value.runId === binding.agentRunId
    ? value
    : undefined;
}

function projectGatewayUsage(value: Record<string, unknown>): Record<string, unknown> & {
  completeness: CodingRunUsageCompleteness;
} {
  const providerReported = hasProviderUsage(value.providerRawUsage);
  const input = getNonNegativeNumber(value.inputTokens);
  const output = getNonNegativeNumber(value.outputTokens);
  const cacheCreation = getNonNegativeNumber(value.cacheCreationTokens);
  const cacheRead = getNonNegativeNumber(value.cacheReadTokens);
  const modelCalls = getNonNegativeInteger(value.modelCalls);
  const providerReportedModelCalls = getNonNegativeInteger(value.providerReportedModelCalls);
  const costUsd = getNonNegativeNumber(value.totalCostUsd);
  const completeness = projectUsageCompleteness({
    providerReported,
    modelCalls,
    providerReportedModelCalls,
  });
  return {
    source: providerReported ? "provider_reported" : "unavailable",
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(cacheCreation === undefined ? {} : { cacheCreation }),
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(modelCalls === undefined ? {} : { modelCalls }),
    ...(providerReportedModelCalls === undefined ? {} : { providerReportedModelCalls }),
    ...(costUsd === undefined ? {} : { costUsd }),
    completeness,
  };
}

function projectUsageCompleteness(input: {
  providerReported: boolean;
  modelCalls?: number;
  providerReportedModelCalls?: number;
}): CodingRunUsageCompleteness {
  const { modelCalls, providerReportedModelCalls } = input;
  if (!Number.isInteger(modelCalls) || modelCalls! < 1
    || !Number.isInteger(providerReportedModelCalls)
    || providerReportedModelCalls! < 0
    || providerReportedModelCalls! > modelCalls!) {
    return { status: "incomplete", reason: "reporting_count_unavailable" };
  }
  if (input.providerReported && providerReportedModelCalls === modelCalls) {
    return {
      status: "complete",
      reason: "provider_reported_all_model_calls",
      modelCalls,
      providerReportedModelCalls,
    };
  }
  return {
    status: "incomplete",
    reason: "provider_usage_missing",
    modelCalls,
    providerReportedModelCalls,
  };
}

function hasProviderUsage(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return [
    value.promptTokens,
    value.completionTokens,
    value.totalTokens,
    value.inputTokens,
    value.outputTokens,
    value.cacheCreationInputTokens,
    value.cacheReadInputTokens,
    value.promptCacheHitTokens,
    value.promptCacheMissTokens,
  ].some((item) => getNonNegativeNumber(item) !== undefined);
}

function getNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function getNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function isTerminalEventType(type: AgentRunEvent["type"]): boolean {
  return type === "run.cancelled"
    || type === "run.interrupted"
    || type === "run.completed"
    || type === "run.failed";
}

function getNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readCodingRunErrorCode(value: unknown): CodingRunErrorCode | undefined {
  if (value === "output_schema_invalid") return value;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
