import crypto from "node:crypto";

import type { JsonObject } from "@belldandy/protocol";

import { estimateTokens } from "./compaction.js";
import type { AgentPromptDelta } from "./prompt-snapshot.js";
import type { ProviderNativeSystemBlock } from "./system-prompt.js";

type TokenEstimateContext = {
  model?: string;
};

type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string | Array<any> }
  | { role: "assistant"; content?: string | null; tool_calls?: Array<unknown>; reasoning_content?: string }
  | { role: "tool"; tool_call_id: string; content: string };

type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: object;
  };
};

type PrefixComparableSnapshot = {
  fingerprint?: string;
  shapeHashes?: {
    systemPrompt?: string;
    toolSchema?: string;
    runtimeDelta?: string;
    providerNativeBlocks?: string;
    messagePrefix?: string;
  };
  routeTier?: string;
  routeModel?: string;
};

export type AgentPrefixShape = {
  fingerprint: string;
  cacheEligiblePrefixFingerprint: string;
  shapeHashes: {
    systemPrompt: string;
    toolSchema: string;
    runtimeDelta: string;
    providerNativeBlocks: string;
    messagePrefix: string;
  };
  counts: {
    systemMessageCount: number;
    messageCount: number;
    toolSchemaCount: number;
    runtimeDeltaCount: number;
    providerNativeBlockCount: number;
  };
  prefixTokens: {
    systemPromptTokens: number;
    providerNativeBlockTokens: number;
    runtimeDeltaTokens: number;
    toolSchemaTokens: number;
    messagePrefixTokens: number;
  };
};

export type AgentPrefixDrift = {
  status: "first_snapshot" | "stable" | "drifted";
  changed: boolean;
  reasons: string[];
  previousFingerprint?: string;
  currentFingerprint: string;
};

export type AgentBudgetCompetition = {
  tokenBreakdown: {
    systemPromptTokens: number;
    providerNativeBlockTokens: number;
    runtimeDeltaTokens: number;
    memoryPreludeTokens: number;
    toolGuidanceDeltaTokens: number;
    attachmentDeltaTokens: number;
    historyTokens: number;
    reasoningHistoryTokens: number;
    toolSchemaTokens: number;
    currentUserTokens: number;
    totalPromptTokens: number;
  };
  pressure: {
    maxInputTokens?: number;
    estimatedTotalTokens: number;
    overBudget: boolean;
    pressureRatio?: number;
  };
  competition: Array<{
    bucket:
      | "system_prompt"
      | "provider_native_blocks"
      | "memory_prelude"
      | "tool_guidance"
      | "attachment_delta"
      | "history"
      | "reasoning_history"
      | "tool_schema"
      | "current_user";
    estimatedTokens: number;
    share: number;
    dominant: boolean;
  }>;
  sacrifice: {
    historyTrimmed: boolean;
    trimmedMessageCount: number;
    trimmedHistoryTokens: number;
    keptToolSchemaCount: number;
    keptToolSchemaTokens: number;
    reasoningHistoryPresent: boolean;
  };
};

export function buildPrefixShape(input: {
  messages: Message[];
  tools: ToolDefinition[];
  runtimePromptDeltas: readonly AgentPromptDelta[];
  providerNativeSystemBlocks?: ProviderNativeSystemBlock[];
  model?: string;
}): AgentPrefixShape {
  const tokenEstimateContext = input.model ? { model: input.model } : undefined;
  const systemMessageCount = input.messages.filter((message) => message.role === "system").length;
  const systemPromptText = input.messages
    .filter((message) => message.role === "system")
    .map((message) => stringifyContent(message.content))
    .join("\n\n");
  const runtimeDeltaText = input.runtimePromptDeltas
    .map((delta) => `${delta.id}|${delta.deltaType}|${delta.role}|${delta.text}`)
    .join("\n\n");
  const providerNativeBlockText = (input.providerNativeSystemBlocks ?? [])
    .map((block) => `${block.id}|${block.blockType}|${block.cacheControlEligible ? "cache" : "nocache"}|${block.text}`)
    .join("\n\n");
  const toolSchemaText = input.tools
    .map((tool) => `${tool.function.name}|${tool.function.description}|${stableStringify(tool.function.parameters)}`)
    .join("\n\n");
  const messagePrefixText = input.messages
    .slice(0, Math.max(0, input.messages.length - 1))
    .map((message) => `${message.role}:${stringifyContent(message.content)}`)
    .join("\n\n");

  const shapeHashes = {
    systemPrompt: sha256(systemPromptText),
    toolSchema: sha256(toolSchemaText),
    runtimeDelta: sha256(runtimeDeltaText),
    providerNativeBlocks: sha256(providerNativeBlockText),
    messagePrefix: sha256(messagePrefixText),
  };
  const fingerprint = sha256([
    shapeHashes.systemPrompt,
    shapeHashes.toolSchema,
    shapeHashes.runtimeDelta,
    shapeHashes.providerNativeBlocks,
    shapeHashes.messagePrefix,
  ].join("|"));

  return {
    fingerprint,
    cacheEligiblePrefixFingerprint: fingerprint,
    shapeHashes,
    counts: {
      systemMessageCount,
      messageCount: input.messages.length,
      toolSchemaCount: input.tools.length,
      runtimeDeltaCount: input.runtimePromptDeltas.length,
      providerNativeBlockCount: input.providerNativeSystemBlocks?.length ?? 0,
    },
    prefixTokens: {
      systemPromptTokens: estimateTextTokens(systemPromptText, tokenEstimateContext),
      providerNativeBlockTokens: estimateTextTokens(providerNativeBlockText, tokenEstimateContext),
      runtimeDeltaTokens: estimateTextTokens(runtimeDeltaText, tokenEstimateContext),
      toolSchemaTokens: estimateTextTokens(toolSchemaText, tokenEstimateContext),
      messagePrefixTokens: estimateTextTokens(messagePrefixText, tokenEstimateContext),
    },
  };
}

export function classifyPrefixDrift(input: {
  previous?: PrefixComparableSnapshot;
  current: PrefixComparableSnapshot;
}): AgentPrefixDrift {
  if (!input.previous?.fingerprint) {
    return {
      status: "first_snapshot",
      changed: false,
      reasons: ["first_snapshot_for_run"],
      currentFingerprint: input.current.fingerprint ?? "",
    };
  }

  const reasons: string[] = [];
  if (input.previous.fingerprint !== input.current.fingerprint) {
    reasons.push("prefix_fingerprint_changed");
  }
  if ((input.previous.shapeHashes?.systemPrompt ?? "") !== (input.current.shapeHashes?.systemPrompt ?? "")) {
    reasons.push("system_prompt_shape_changed");
  }
  if ((input.previous.shapeHashes?.toolSchema ?? "") !== (input.current.shapeHashes?.toolSchema ?? "")) {
    reasons.push("tool_schema_shape_changed");
  }
  if ((input.previous.shapeHashes?.runtimeDelta ?? "") !== (input.current.shapeHashes?.runtimeDelta ?? "")) {
    reasons.push("runtime_delta_shape_changed");
  }
  if ((input.previous.shapeHashes?.providerNativeBlocks ?? "") !== (input.current.shapeHashes?.providerNativeBlocks ?? "")) {
    reasons.push("provider_native_blocks_shape_changed");
  }
  if ((input.previous.shapeHashes?.messagePrefix ?? "") !== (input.current.shapeHashes?.messagePrefix ?? "")) {
    reasons.push("message_prefix_shape_changed");
  }
  if ((input.previous.routeTier ?? "") !== (input.current.routeTier ?? "")) {
    reasons.push("deepseek_route_tier_changed");
  }
  if ((input.previous.routeModel ?? "") !== (input.current.routeModel ?? "")) {
    reasons.push("deepseek_route_model_changed");
  }

  return {
    status: reasons.length > 0 ? "drifted" : "stable",
    changed: reasons.length > 0,
    reasons: reasons.length > 0 ? reasons : ["prefix_stable"],
    previousFingerprint: input.previous.fingerprint,
    currentFingerprint: input.current.fingerprint ?? "",
  };
}

export function buildBudgetCompetition(input: {
  messages: Message[];
  tools: ToolDefinition[];
  runtimePromptDeltas: readonly AgentPromptDelta[];
  providerNativeSystemBlocks?: ProviderNativeSystemBlock[];
  prependContext?: string;
  maxInputTokens?: number;
  model?: string;
  trimDiagnostics?: {
    trimmedMessageCount: number;
    trimmedHistoryTokens: number;
  };
}): AgentBudgetCompetition {
  const tokenEstimateContext = input.model ? { model: input.model } : undefined;
  const latestMessage = input.messages[input.messages.length - 1];
  const historyMessages = latestMessage
    ? input.messages.slice(0, -1).filter((message) => message.role !== "system")
    : input.messages.filter((message) => message.role !== "system");
  const systemPromptTokens = sumMessageTokens(
    input.messages.filter((message) => message.role === "system"),
    tokenEstimateContext,
  );
  const providerNativeBlockTokens = sumTextTokens(input.providerNativeSystemBlocks?.map((block) => block.text) ?? [], tokenEstimateContext);
  const runtimeDeltaTokens = sumTextTokens(input.runtimePromptDeltas.map((delta) => delta.text), tokenEstimateContext);
  const memoryPreludeTokens = estimateMemoryPreludeTokens(input.prependContext, input.runtimePromptDeltas, tokenEstimateContext);
  const toolGuidanceDeltaTokens = estimateToolGuidanceDeltaTokens(input.runtimePromptDeltas, tokenEstimateContext);
  const attachmentDeltaTokens = estimateAttachmentDeltaTokens(input.runtimePromptDeltas, tokenEstimateContext);
  const historyTokens = sumMessageTokens(historyMessages, tokenEstimateContext);
  const reasoningHistoryTokens = historyMessages.reduce((sum, message) => {
    if (message.role !== "assistant") {
      return sum;
    }
    return sum + estimateTextTokens(message.reasoning_content ?? "", tokenEstimateContext);
  }, 0);
  const toolSchemaTokens = sumTextTokens(
    input.tools.map((tool) => `${tool.function.name}|${tool.function.description}|${stableStringify(tool.function.parameters)}`),
    tokenEstimateContext,
  );
  const currentUserTokens = latestMessage ? estimateMessageTokens(latestMessage, tokenEstimateContext) : 0;
  const estimatedTotalTokens =
    systemPromptTokens
    + providerNativeBlockTokens
    + runtimeDeltaTokens
    + historyTokens
    + toolSchemaTokens
    + currentUserTokens;
  const overBudget = typeof input.maxInputTokens === "number" && input.maxInputTokens > 0
    ? estimatedTotalTokens > input.maxInputTokens
    : false;
  const competitionSource = [
    { bucket: "system_prompt" as const, estimatedTokens: systemPromptTokens },
    { bucket: "provider_native_blocks" as const, estimatedTokens: providerNativeBlockTokens },
    { bucket: "memory_prelude" as const, estimatedTokens: memoryPreludeTokens },
    { bucket: "tool_guidance" as const, estimatedTokens: toolGuidanceDeltaTokens },
    { bucket: "attachment_delta" as const, estimatedTokens: attachmentDeltaTokens },
    { bucket: "history" as const, estimatedTokens: historyTokens },
    { bucket: "reasoning_history" as const, estimatedTokens: reasoningHistoryTokens },
    { bucket: "tool_schema" as const, estimatedTokens: toolSchemaTokens },
    { bucket: "current_user" as const, estimatedTokens: currentUserTokens },
  ];
  const dominantTokens = competitionSource.reduce((max, item) => Math.max(max, item.estimatedTokens), 0);

  return {
    tokenBreakdown: {
      systemPromptTokens,
      providerNativeBlockTokens,
      runtimeDeltaTokens,
      memoryPreludeTokens,
      toolGuidanceDeltaTokens,
      attachmentDeltaTokens,
      historyTokens,
      reasoningHistoryTokens,
      toolSchemaTokens,
      currentUserTokens,
      totalPromptTokens: estimatedTotalTokens,
    },
    pressure: {
      ...(typeof input.maxInputTokens === "number" && input.maxInputTokens > 0
        ? { maxInputTokens: input.maxInputTokens }
        : {}),
      estimatedTotalTokens,
      overBudget,
      ...(typeof input.maxInputTokens === "number" && input.maxInputTokens > 0
        ? { pressureRatio: estimatedTotalTokens / input.maxInputTokens }
        : {}),
    },
    competition: competitionSource
      .filter((item) => item.estimatedTokens > 0)
      .map((item) => ({
        bucket: item.bucket,
        estimatedTokens: item.estimatedTokens,
        share: estimatedTotalTokens > 0 ? item.estimatedTokens / estimatedTotalTokens : 0,
        dominant: item.estimatedTokens === dominantTokens && dominantTokens > 0,
      }))
      .sort((left, right) => right.estimatedTokens - left.estimatedTokens),
    sacrifice: {
      historyTrimmed: (input.trimDiagnostics?.trimmedMessageCount ?? 0) > 0,
      trimmedMessageCount: input.trimDiagnostics?.trimmedMessageCount ?? 0,
      trimmedHistoryTokens: input.trimDiagnostics?.trimmedHistoryTokens ?? 0,
      keptToolSchemaCount: input.tools.length,
      keptToolSchemaTokens: toolSchemaTokens,
      reasoningHistoryPresent: reasoningHistoryTokens > 0,
    },
  };
}

export function readPrefixComparableSnapshot(meta?: JsonObject): PrefixComparableSnapshot | undefined {
  if (!meta || typeof meta !== "object") {
    return undefined;
  }
  const prefixShape = isRecord(meta.prefixShape) ? meta.prefixShape : undefined;
  if (!prefixShape) {
    return undefined;
  }
  const shapeHashes = isRecord(prefixShape.shapeHashes) ? prefixShape.shapeHashes : undefined;
  const route = isRecord(meta.deepseekRoute) ? meta.deepseekRoute : undefined;
  return {
    fingerprint: typeof prefixShape.fingerprint === "string" ? prefixShape.fingerprint : undefined,
    shapeHashes: shapeHashes
      ? {
        ...(typeof shapeHashes.systemPrompt === "string" ? { systemPrompt: shapeHashes.systemPrompt } : {}),
        ...(typeof shapeHashes.toolSchema === "string" ? { toolSchema: shapeHashes.toolSchema } : {}),
        ...(typeof shapeHashes.runtimeDelta === "string" ? { runtimeDelta: shapeHashes.runtimeDelta } : {}),
        ...(typeof shapeHashes.providerNativeBlocks === "string" ? { providerNativeBlocks: shapeHashes.providerNativeBlocks } : {}),
        ...(typeof shapeHashes.messagePrefix === "string" ? { messagePrefix: shapeHashes.messagePrefix } : {}),
      }
      : undefined,
    routeTier: typeof route?.selectedTier === "string" ? route.selectedTier : undefined,
    routeModel: typeof route?.effectiveModelId === "string" ? route.effectiveModelId : undefined,
  };
}

function estimateMemoryPreludeTokens(
  prependContext: string | undefined,
  deltas: readonly AgentPromptDelta[],
  tokenEstimateContext?: TokenEstimateContext,
): number {
  const contextPreludeText = [
    prependContext ?? "",
    ...deltas
      .filter((delta) => delta.role === "user-prelude" || (delta.metadata && isRecord(delta.metadata) && typeof delta.metadata.blockTag === "string"))
      .map((delta) => delta.text),
  ].join("\n\n");
  return estimateTextTokens(contextPreludeText, tokenEstimateContext);
}

function estimateToolGuidanceDeltaTokens(
  deltas: readonly AgentPromptDelta[],
  tokenEstimateContext?: TokenEstimateContext,
): number {
  return sumTextTokens(
    deltas
      .filter((delta) => (
        delta.deltaType === "tool-selection-policy"
        || delta.deltaType === "tool-failure-recovery"
        || delta.deltaType === "tool-search-follow-up"
        || delta.deltaType === "tool-post-verification"
        || delta.deltaType === "role-execution-policy"
        || delta.deltaType === "team-topology-and-ownership"
        || delta.deltaType === "team-handoff-review"
        || delta.deltaType === "team-fan-in-triage"
        || delta.deltaType === "team-completion-gate"
      ))
      .map((delta) => delta.text),
    tokenEstimateContext,
  );
}

function estimateAttachmentDeltaTokens(
  deltas: readonly AgentPromptDelta[],
  tokenEstimateContext?: TokenEstimateContext,
): number {
  return sumTextTokens(
    deltas
      .filter((delta) => (
        delta.deltaType === "attachment"
        || delta.deltaType === "audio-transcript"
      ))
      .map((delta) => delta.text),
    tokenEstimateContext,
  );
}

function sumMessageTokens(messages: Message[], tokenEstimateContext?: TokenEstimateContext): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message, tokenEstimateContext), 0);
}

function estimateMessageTokens(message: Message, tokenEstimateContext?: TokenEstimateContext): number {
  let total = estimateTextTokens(stringifyContent(message.content), tokenEstimateContext) + 4;
  if (message.role === "assistant") {
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      total += estimateTextTokens(JSON.stringify(message.tool_calls), tokenEstimateContext);
    }
    if (typeof message.reasoning_content === "string" && message.reasoning_content.trim()) {
      total += estimateTextTokens(message.reasoning_content, tokenEstimateContext);
    }
  }
  return total;
}

function sumTextTokens(texts: string[], tokenEstimateContext?: TokenEstimateContext): number {
  return texts.reduce((sum, text) => sum + estimateTextTokens(text, tokenEstimateContext), 0);
}

function estimateTextTokens(text: string, tokenEstimateContext?: TokenEstimateContext): number {
  return estimateTokens(text, tokenEstimateContext);
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (typeof content === "undefined" || content === null) {
    return "";
  }
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right, "en-US"));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
