import type { JsonObject } from "@belldandy/protocol";
import type { ProviderNativeSystemBlock } from "./system-prompt.js";

const DATA_URI_BASE64_PREFIX_RE = /^data:([^;]+);base64,/i;

export type AgentPromptSnapshotContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; url: string }
  | { type: "video_url"; url: string };

export type AgentPromptDeltaType =
  | "user-prelude"
  | "runtime-identity"
  | "runtime-identity-authority"
  | "iteration-budget-warning"
  | "attachment"
  | "audio-transcript"
  | "tool-selection-policy"
  | "team-topology-and-ownership"
  | "team-handoff-review"
  | "team-fan-in-triage"
  | "team-completion-gate"
  | "role-execution-policy"
  | "tool-failure-recovery"
  | "tool-search-follow-up"
  | "tool-post-verification";

export type AgentPromptDeltaRole = "system" | "user-prelude" | "attachment";

export type AgentPromptDelta = {
  id: string;
  deltaType: AgentPromptDeltaType;
  role: AgentPromptDeltaRole;
  text: string;
  source?: string;
  metadata?: JsonObject;
};

export type AgentPromptSnapshotMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | AgentPromptSnapshotContentPart[];
  toolCallId?: string;
};

export type AgentPromptSnapshot = {
  agentId?: string;
  conversationId: string;
  runId?: string;
  createdAt: number;
  systemPrompt: string;
  messages: AgentPromptSnapshotMessage[];
  deltas?: AgentPromptDelta[];
  providerNativeSystemBlocks?: ProviderNativeSystemBlock[];
  inputMeta?: JsonObject;
  hookSystemPromptUsed?: boolean;
  prependContext?: string;
};

type PromptSnapshotSourceMessage = {
  role: string;
  content?: unknown;
  tool_call_id?: string;
};

export function readPromptSnapshotRunId(meta?: JsonObject): string | undefined {
  if (!meta || typeof meta !== "object") {
    return undefined;
  }
  const runId = (meta as Record<string, unknown>).runId;
  if (typeof runId !== "string") {
    return undefined;
  }
  const normalized = runId.trim();
  return normalized || undefined;
}

export function buildPromptSnapshotMessages(
  messages: PromptSnapshotSourceMessage[],
): AgentPromptSnapshotMessage[] {
  return messages.map((message) => {
    const role = normalizePromptSnapshotRole(message.role);
    const content = sanitizePromptSnapshotContent(message.content);
    const result: AgentPromptSnapshotMessage = {
      role,
      content,
    };
    if (role === "tool" && typeof message.tool_call_id === "string" && message.tool_call_id.trim()) {
      result.toolCallId = message.tool_call_id.trim();
    }
    return result;
  });
}

export function normalizePromptSnapshotDeltas(
  deltas?: unknown,
): AgentPromptDelta[] | undefined {
  if (!Array.isArray(deltas)) {
    return undefined;
  }
  const normalized = deltas
    .map((delta, index) => sanitizePromptSnapshotDelta(delta, index))
    .filter(Boolean) as AgentPromptDelta[];
  return normalized.length > 0 ? normalized : undefined;
}

export function readPromptSnapshotDeltas(meta?: JsonObject): AgentPromptDelta[] | undefined {
  if (!meta || typeof meta !== "object") {
    return undefined;
  }
  return normalizePromptSnapshotDeltas((meta as Record<string, unknown>).promptDeltas);
}

export function normalizePromptSnapshotProviderNativeSystemBlocks(
  blocks?: unknown,
): ProviderNativeSystemBlock[] | undefined {
  if (!Array.isArray(blocks)) {
    return undefined;
  }
  const normalized = blocks
    .map((block, index) => sanitizePromptSnapshotProviderNativeSystemBlock(block, index))
    .filter(Boolean) as ProviderNativeSystemBlock[];
  return normalized.length > 0 ? normalized : undefined;
}

export function createAgentPromptSnapshot(input: {
  agentId?: string;
  conversationId: string;
  runId?: string;
  createdAt?: number;
  systemPrompt?: string;
  messages: PromptSnapshotSourceMessage[];
  deltas?: AgentPromptDelta[];
  providerNativeSystemBlocks?: ProviderNativeSystemBlock[];
  inputMeta?: JsonObject;
  hookSystemPromptUsed?: boolean;
  prependContext?: string;
}): AgentPromptSnapshot {
  const messages = buildPromptSnapshotMessages(input.messages);
  const derivedSystemPrompt = messages.find(
    (message) => message.role === "system" && typeof message.content === "string",
  );
  const deltas = normalizePromptSnapshotDeltas(input.deltas) ?? readPromptSnapshotDeltas(input.inputMeta);
  const providerNativeSystemBlocks = normalizePromptSnapshotProviderNativeSystemBlocks(input.providerNativeSystemBlocks);

  return {
    agentId: normalizeOptionalString(input.agentId),
    conversationId: input.conversationId,
    runId: normalizeOptionalString(input.runId),
    createdAt: input.createdAt ?? Date.now(),
    systemPrompt: typeof input.systemPrompt === "string"
      ? input.systemPrompt.trim()
      : (typeof derivedSystemPrompt?.content === "string" ? derivedSystemPrompt.content : ""),
    messages,
    ...(deltas ? { deltas } : {}),
    ...(providerNativeSystemBlocks ? { providerNativeSystemBlocks } : {}),
    inputMeta: input.inputMeta ? { ...input.inputMeta } : undefined,
    hookSystemPromptUsed: input.hookSystemPromptUsed === true,
    prependContext: normalizeOptionalString(input.prependContext),
  };
}

function normalizePromptSnapshotRole(value: string): AgentPromptSnapshotMessage["role"] {
  switch (value) {
    case "system":
    case "user":
    case "assistant":
    case "tool":
      return value;
    default:
      return "assistant";
  }
}

function sanitizePromptSnapshotContent(
  content: unknown,
): string | AgentPromptSnapshotContentPart[] {
  if (Array.isArray(content)) {
    const parts = content
      .map((part) => sanitizePromptSnapshotPart(part))
      .filter(Boolean) as AgentPromptSnapshotContentPart[];
    if (parts.length > 0) {
      return parts;
    }
  }

  if (typeof content === "string") {
    return sanitizePromptSnapshotString(content);
  }

  if (content === null || typeof content === "undefined") {
    return "";
  }

  try {
    return sanitizePromptSnapshotString(JSON.stringify(content));
  } catch {
    return sanitizePromptSnapshotString(String(content));
  }
}

function sanitizePromptSnapshotPart(part: unknown): AgentPromptSnapshotContentPart | undefined {
  if (!part || typeof part !== "object") {
    return undefined;
  }

  const value = part as Record<string, any>;
  if (value.type === "text" && typeof value.text === "string") {
    return { type: "text", text: sanitizePromptSnapshotString(value.text) };
  }

  if (value.type === "image_url" && typeof value.image_url?.url === "string") {
    return { type: "image_url", url: sanitizePromptSnapshotString(value.image_url.url) };
  }

  if (value.type === "video_url" && typeof value.video_url?.url === "string") {
    return { type: "video_url", url: sanitizePromptSnapshotString(value.video_url.url) };
  }

  try {
    return { type: "text", text: sanitizePromptSnapshotString(JSON.stringify(value)) };
  } catch {
    return { type: "text", text: sanitizePromptSnapshotString(String(value)) };
  }
}

function sanitizePromptSnapshotDelta(delta: unknown, index: number): AgentPromptDelta | undefined {
  if (!delta || typeof delta !== "object" || Array.isArray(delta)) {
    return undefined;
  }

  const value = delta as Record<string, unknown>;
  const text = typeof value.text === "string"
    ? sanitizePromptSnapshotString(value.text).trim()
    : "";
  const deltaType = normalizePromptSnapshotDeltaType(value.deltaType);
  const role = normalizePromptSnapshotDeltaRole(value.role);
  if (!text || !deltaType || !role) {
    return undefined;
  }

  const metadata = sanitizePromptSnapshotMetadata(value.metadata);
  return {
    id: normalizeOptionalString(typeof value.id === "string" ? value.id : undefined) ?? `delta-${index + 1}`,
    deltaType,
    role,
    text,
    ...(typeof value.source === "string" && value.source.trim() ? { source: value.source.trim() } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function sanitizePromptSnapshotProviderNativeSystemBlock(
  block: unknown,
  index: number,
): ProviderNativeSystemBlock | undefined {
  if (!block || typeof block !== "object" || Array.isArray(block)) {
    return undefined;
  }

  const value = block as Record<string, unknown>;
  const blockType = normalizePromptSnapshotProviderNativeSystemBlockType(value.blockType);
  const text = typeof value.text === "string"
    ? sanitizePromptSnapshotString(value.text).trim()
    : "";
  if (!blockType || !text) {
    return undefined;
  }

  return {
    id: normalizeOptionalString(typeof value.id === "string" ? value.id : undefined) ?? `provider-native-block-${index + 1}`,
    blockType,
    text,
    sourceSectionIds: normalizePromptSnapshotStringArray(value.sourceSectionIds),
    sourceDeltaIds: normalizePromptSnapshotStringArray(value.sourceDeltaIds),
    cacheControlEligible: value.cacheControlEligible === true,
  };
}

function normalizePromptSnapshotDeltaType(value: unknown): AgentPromptDeltaType | undefined {
  switch (value) {
    case "user-prelude":
    case "runtime-identity":
    case "runtime-identity-authority":
    case "iteration-budget-warning":
    case "attachment":
    case "audio-transcript":
    case "tool-selection-policy":
    case "team-topology-and-ownership":
    case "team-handoff-review":
    case "team-fan-in-triage":
    case "team-completion-gate":
    case "role-execution-policy":
    case "tool-failure-recovery":
    case "tool-search-follow-up":
    case "tool-post-verification":
      return value;
    default:
      return undefined;
  }
}

function normalizePromptSnapshotProviderNativeSystemBlockType(
  value: unknown,
): ProviderNativeSystemBlock["blockType"] | undefined {
  switch (value) {
    case "static-persona":
    case "static-capability":
    case "dynamic-runtime":
      return value;
    default:
      return undefined;
  }
}

function normalizePromptSnapshotDeltaRole(value: unknown): AgentPromptDeltaRole | undefined {
  switch (value) {
    case "system":
    case "user-prelude":
    case "attachment":
      return value;
    default:
      return undefined;
  }
}

function sanitizePromptSnapshotMetadata(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    result[key] = sanitizePromptSnapshotMetadataValue(entry);
  }
  return result as JsonObject;
}

function normalizePromptSnapshotStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => sanitizePromptSnapshotString(entry).trim())
    .filter(Boolean);
}

function sanitizePromptSnapshotMetadataValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizePromptSnapshotString(value);
  }
  if (
    value === null
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePromptSnapshotMetadataValue(item));
  }
  if (value && typeof value === "object") {
    const nested: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      nested[key] = sanitizePromptSnapshotMetadataValue(entry);
    }
    return nested;
  }
  return String(value);
}

function sanitizePromptSnapshotString(value: string): string {
  if (!value) {
    return value;
  }

  const match = value.match(DATA_URI_BASE64_PREFIX_RE);
  if (!match) {
    return value;
  }

  const commaIndex = value.indexOf(",");
  const encoded = commaIndex >= 0 ? value.slice(commaIndex + 1).replace(/\s+/g, "") : "";
  const mime = match[1] || "unknown";
  return `[data-uri:${mime};base64:${encoded.length} chars omitted]`;
}

function normalizeOptionalString(value?: string): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}
