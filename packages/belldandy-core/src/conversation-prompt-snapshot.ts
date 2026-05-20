import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  AgentPromptDelta,
  AgentPromptSnapshot,
  AgentPromptSnapshotMessage,
  ProviderNativeSystemBlock,
} from "@belldandy/agent";
import type { JsonObject } from "@belldandy/protocol";
import {
  buildPromptTokenBreakdown,
  type PromptContextInjectionObservability,
  readPromptTokenBreakdownFromMetadata,
  readPromptTruncationReasonFromMetadata,
  renderPromptObservabilityText,
  type PromptTruncationReason,
  type PromptTokenBreakdown,
  withDeltaPromptMetrics,
  withProviderNativeSystemBlockPromptMetrics,
} from "./prompt-observability.js";
import { renderAgentLaunchExplainabilityLines, renderResidentStateBindingLines } from "./agent-explainability-text.js";
import { normalizeLegacyPromptSnapshot } from "./prompt-snapshot-legacy-normalize.js";
import { writePromptSnapshotIndex } from "./prompt-snapshot-index.js";

const CONVERSATION_DEBUG_DIRNAME = "diagnostics";
const PROMPT_SNAPSHOT_DIRNAME = "prompt-snapshots";
const PROMPT_SNAPSHOT_BLOBS_DIRNAME = "_blobs";
const PROMPT_SNAPSHOT_SYSTEM_PROMPT_BLOBS_DIRNAME = "system-prompts";
export const CONVERSATION_PROMPT_SNAPSHOT_SCHEMA_VERSION = 2 as const;
const DEFAULT_PROMPT_SNAPSHOT_MAX_PERSISTED_RUNS = 20;
const DEFAULT_PROMPT_SNAPSHOT_HEARTBEAT_MAX_RUNS = 5;
const DEFAULT_PROMPT_SNAPSHOT_EMAIL_THREAD_MAX_RUNS = 10;
const DEFAULT_PROMPT_SNAPSHOT_MAX_AGE_DAYS = 7;
const DEFAULT_PROMPT_SNAPSHOT_HEARTBEAT_PREFIX = "heartbeat-";
const DEFAULT_PROMPT_SNAPSHOT_EMAIL_THREAD_PREFIX = "channel=email:scope=per-account-thread:";
const RENAME_RETRIES = 3;
const RENAME_RETRY_DELAY_MS = 50;

export type ConversationPromptSnapshotRetentionPolicy = {
  defaultMaxRunsPerConversation?: number;
  heartbeatMaxRuns?: number;
  emailThreadMaxRuns?: number;
  maxAgeDays?: number;
  heartbeatConversationPrefix?: string;
  emailThreadConversationPrefix?: string;
  now?: number;
};

export type ConversationPromptSnapshotSystemPromptRef = {
  hash: string;
  chars: number;
};

type ConversationPromptSnapshotArtifactManifest = {
  conversationId: string;
  runId?: string;
  agentId?: string;
  createdAt: number;
  persistedAt: number;
  source: "runtime.prompt_snapshot";
};

type ConversationPromptSnapshotArtifactSummary = {
  messageCount: number;
  systemPromptChars: number;
  includesHookSystemPrompt: boolean;
  hasPrependContext: boolean;
  contextInjection?: PromptContextInjectionObservability;
  deltaCount: number;
  deltaChars: number;
  systemPromptEstimatedTokens: number;
  deltaEstimatedTokens: number;
  providerNativeSystemBlockCount: number;
  providerNativeSystemBlockChars: number;
  providerNativeSystemBlockEstimatedTokens: number;
  tokenBreakdown: PromptTokenBreakdown;
  truncationReason?: PromptTruncationReason;
};

type ConversationPromptSnapshotExpandedSnapshot = {
  systemPrompt: string;
  messages: AgentPromptSnapshotMessage[];
  deltas?: Array<AgentPromptDelta & { charLength: number; estimatedChars: number; estimatedTokens: number }>;
  providerNativeSystemBlocks?: Array<ProviderNativeSystemBlock & { charLength: number; estimatedChars: number; estimatedTokens: number }>;
  inputMeta?: JsonObject;
  hookSystemPromptUsed: boolean;
  prependContext?: string;
};

type ConversationPromptSnapshotPersistedSnapshotV1 = ConversationPromptSnapshotExpandedSnapshot;

type ConversationPromptSnapshotMessageContentRef = "systemPrompt";

type PersistedConversationPromptSnapshotMessage = Omit<AgentPromptSnapshotMessage, "content"> & (
  | {
    content: AgentPromptSnapshotMessage["content"];
    contentRef?: never;
  }
  | {
    contentRef: ConversationPromptSnapshotMessageContentRef;
    content?: undefined;
  }
);

type ConversationPromptSnapshotPersistedSnapshotV2 = Omit<ConversationPromptSnapshotExpandedSnapshot, "systemPrompt" | "messages"> & {
  systemPromptRef: ConversationPromptSnapshotSystemPromptRef;
  messages: PersistedConversationPromptSnapshotMessage[];
};

export type ConversationPromptSnapshotArtifact = {
  schemaVersion: 1 | typeof CONVERSATION_PROMPT_SNAPSHOT_SCHEMA_VERSION;
  manifest: ConversationPromptSnapshotArtifactManifest;
  summary: ConversationPromptSnapshotArtifactSummary;
  snapshot: ConversationPromptSnapshotExpandedSnapshot;
};

type PersistedConversationPromptSnapshotArtifactV1 = {
  schemaVersion: 1;
  manifest: ConversationPromptSnapshotArtifactManifest;
  summary: ConversationPromptSnapshotArtifactSummary;
  snapshot: ConversationPromptSnapshotPersistedSnapshotV1;
};

type PersistedConversationPromptSnapshotArtifactV2 = {
  schemaVersion: typeof CONVERSATION_PROMPT_SNAPSHOT_SCHEMA_VERSION;
  manifest: ConversationPromptSnapshotArtifactManifest;
  summary: ConversationPromptSnapshotArtifactSummary;
  snapshot: ConversationPromptSnapshotPersistedSnapshotV2;
};

type PersistedConversationPromptSnapshotArtifact =
  | PersistedConversationPromptSnapshotArtifactV1
  | PersistedConversationPromptSnapshotArtifactV2;

function summarizePromptSnapshotContextInjection(
  deltas: AgentPromptDelta[],
  prependContextChars: number,
): PromptContextInjectionObservability | undefined {
  const contextDeltas = deltas.filter((delta) => delta.source === "context-injection");
  if (contextDeltas.length === 0 && prependContextChars <= 0) {
    return undefined;
  }
  const blockTags: string[] = [];
  const blockLineCounts: Record<string, number> = {};
  let autoRecall: PromptContextInjectionObservability["autoRecall"] | undefined;

  for (const delta of contextDeltas) {
    const metadata = delta.metadata && typeof delta.metadata === "object"
      ? delta.metadata as Record<string, unknown>
      : undefined;
    const blockTag = typeof metadata?.blockTag === "string" && metadata.blockTag.trim()
      ? metadata.blockTag.trim()
      : "";
    if (blockTag) {
      blockTags.push(blockTag);
      const lineCount = typeof metadata?.lineCount === "number" && Number.isFinite(metadata.lineCount)
        ? Math.max(0, Math.trunc(metadata.lineCount))
        : 0;
      blockLineCounts[blockTag] = (blockLineCounts[blockTag] ?? 0) + lineCount;
    }
    if (blockTag === "auto-recall" && metadata?.observability && typeof metadata.observability === "object") {
      const observability = metadata.observability as Record<string, unknown>;
      autoRecall = {
        ...(typeof observability.timedOut === "boolean" ? { timedOut: observability.timedOut } : {}),
        ...(typeof observability.candidateCount === "number" && Number.isFinite(observability.candidateCount)
          ? { candidateCount: Math.max(0, Math.trunc(observability.candidateCount)) }
          : {}),
        ...(typeof observability.keptCount === "number" && Number.isFinite(observability.keptCount)
          ? { keptCount: Math.max(0, Math.trunc(observability.keptCount)) }
          : {}),
        ...(typeof observability.filteredOutCount === "number" && Number.isFinite(observability.filteredOutCount)
          ? { filteredOutCount: Math.max(0, Math.trunc(observability.filteredOutCount)) }
          : {}),
        ...(typeof observability.minScore === "number" && Number.isFinite(observability.minScore)
          ? { minScore: observability.minScore }
          : {}),
        ...(Array.isArray(observability.topHitIds)
          ? { topHitIds: observability.topHitIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0) }
          : {}),
        ...(observability.sourceClassMix && typeof observability.sourceClassMix === "object"
          ? {
            sourceClassMix: Object.fromEntries(
              Object.entries(observability.sourceClassMix as Record<string, unknown>)
                .filter(([, item]) => typeof item === "number" && Number.isFinite(item))
                .map(([key, item]) => [key, Math.max(0, Math.trunc(item as number))]),
            ),
          }
          : {}),
      };
    }
  }

  return {
    prependContextChars,
    totalBlockCount: contextDeltas.length,
    blockTags: [...new Set(blockTags)],
    blockLineCounts,
    ...(autoRecall ? { autoRecall } : {}),
  };
}

export function buildConversationPromptSnapshotArtifact(input: {
  snapshot: AgentPromptSnapshot;
  persistedAt?: number;
}): ConversationPromptSnapshotArtifact {
  const persistedAt = typeof input.persistedAt === "number" && Number.isFinite(input.persistedAt)
    ? Math.max(0, Math.floor(input.persistedAt))
    : Date.now();
  const promptTokenBreakdown = buildPromptTokenBreakdown({
    systemPromptText: input.snapshot.systemPrompt,
    deltas: input.snapshot.deltas,
    providerNativeSystemBlocks: input.snapshot.providerNativeSystemBlocks,
  });
  const truncationReason = readPromptTruncationReasonFromMetadata(
    input.snapshot.inputMeta as Record<string, unknown> | undefined,
  );
  const contextInjection = summarizePromptSnapshotContextInjection(
    input.snapshot.deltas ?? [],
    input.snapshot.prependContext?.length ?? 0,
  );

  return {
    schemaVersion: CONVERSATION_PROMPT_SNAPSHOT_SCHEMA_VERSION,
    manifest: {
      conversationId: input.snapshot.conversationId,
      ...(input.snapshot.runId ? { runId: input.snapshot.runId } : {}),
      ...(input.snapshot.agentId ? { agentId: input.snapshot.agentId } : {}),
      createdAt: input.snapshot.createdAt,
      persistedAt,
      source: "runtime.prompt_snapshot",
    },
    summary: {
      messageCount: input.snapshot.messages.length,
      systemPromptChars: input.snapshot.systemPrompt.length,
      includesHookSystemPrompt: input.snapshot.hookSystemPromptUsed === true,
      hasPrependContext: Boolean(input.snapshot.prependContext),
      ...(contextInjection ? { contextInjection } : {}),
      deltaCount: input.snapshot.deltas?.length ?? 0,
      deltaChars: input.snapshot.deltas?.reduce((sum, delta) => sum + delta.text.length, 0) ?? 0,
      systemPromptEstimatedTokens: promptTokenBreakdown.systemPromptEstimatedTokens,
      deltaEstimatedTokens: promptTokenBreakdown.deltaEstimatedTokens,
      providerNativeSystemBlockCount: input.snapshot.providerNativeSystemBlocks?.length ?? 0,
      providerNativeSystemBlockChars: input.snapshot.providerNativeSystemBlocks?.reduce((sum, block) => sum + block.text.length, 0) ?? 0,
      providerNativeSystemBlockEstimatedTokens: promptTokenBreakdown.providerNativeSystemBlockEstimatedTokens,
      tokenBreakdown: promptTokenBreakdown,
      ...(truncationReason ? { truncationReason } : {}),
    },
    snapshot: {
      systemPrompt: input.snapshot.systemPrompt,
      messages: input.snapshot.messages.map((message) => ({
        ...message,
        content: Array.isArray(message.content)
          ? message.content.map((part) => ({ ...part }))
          : message.content,
      })),
      ...(input.snapshot.deltas
        ? {
          deltas: input.snapshot.deltas.map((delta) => withDeltaPromptMetrics({
            ...delta,
            ...(delta.metadata ? { metadata: { ...delta.metadata } } : {}),
          })),
        }
        : {}),
      ...(input.snapshot.providerNativeSystemBlocks
        ? {
          providerNativeSystemBlocks: input.snapshot.providerNativeSystemBlocks.map((block) => withProviderNativeSystemBlockPromptMetrics({
            ...block,
            sourceSectionIds: [...block.sourceSectionIds],
            sourceDeltaIds: [...block.sourceDeltaIds],
          })),
        }
        : {}),
      ...(sanitizeConversationPromptSnapshotInputMeta(input.snapshot.inputMeta)
        ? { inputMeta: sanitizeConversationPromptSnapshotInputMeta(input.snapshot.inputMeta) }
        : {}),
      hookSystemPromptUsed: input.snapshot.hookSystemPromptUsed === true,
      ...(input.snapshot.prependContext ? { prependContext: input.snapshot.prependContext } : {}),
    },
  };
}

export function getConversationPromptSnapshotRoot(stateDir: string): string {
  return path.join(stateDir, CONVERSATION_DEBUG_DIRNAME, PROMPT_SNAPSHOT_DIRNAME);
}

export function getConversationPromptSnapshotBlobRoot(stateDir: string): string {
  return path.join(getConversationPromptSnapshotRoot(stateDir), PROMPT_SNAPSHOT_BLOBS_DIRNAME);
}

export function getConversationPromptSnapshotSystemPromptBlobRoot(stateDir: string): string {
  return path.join(getConversationPromptSnapshotBlobRoot(stateDir), PROMPT_SNAPSHOT_SYSTEM_PROMPT_BLOBS_DIRNAME);
}

export function getConversationPromptSnapshotDirectory(stateDir: string, conversationId: string): string {
  return path.join(getConversationPromptSnapshotRoot(stateDir), sanitizeFileSegment(conversationId));
}

export function getConversationPromptSnapshotSystemPromptBlobPath(input: {
  stateDir: string;
  hash: string;
}): string {
  return path.join(
    getConversationPromptSnapshotSystemPromptBlobRoot(input.stateDir),
    `${sanitizeSystemPromptBlobHash(input.hash)}.txt`,
  );
}

export function getConversationPromptSnapshotArtifactPath(input: {
  stateDir: string;
  conversationId: string;
  runId?: string;
  createdAt?: number;
}): string {
  const dir = getConversationPromptSnapshotDirectory(input.stateDir, input.conversationId);
  const runSegment = input.runId
    ? `run-${sanitizeFileSegment(input.runId)}`
    : `created-${Math.max(0, Math.floor(input.createdAt ?? Date.now()))}`;
  return path.join(dir, `${runSegment}.prompt-snapshot.json`);
}

export async function persistConversationPromptSnapshot(input: {
  stateDir: string;
  snapshot: AgentPromptSnapshot;
  retention?: ConversationPromptSnapshotRetentionPolicy;
}): Promise<{ artifact: ConversationPromptSnapshotArtifact; outputPath: string }> {
  const artifact = buildConversationPromptSnapshotArtifact({ snapshot: input.snapshot });
  const systemPromptRef = await persistConversationPromptSystemPromptBlob({
    stateDir: input.stateDir,
    systemPrompt: artifact.snapshot.systemPrompt,
  });
  const persistedArtifact = toPersistedConversationPromptSnapshotArtifact({
    artifact,
    systemPromptRef,
  });
  const outputPath = getConversationPromptSnapshotArtifactPath({
    stateDir: input.stateDir,
    conversationId: input.snapshot.conversationId,
    runId: input.snapshot.runId,
    createdAt: input.snapshot.createdAt,
  });
  await atomicWriteJson(outputPath, persistedArtifact);
  await prunePersistedConversationPromptSnapshots({
    stateDir: input.stateDir,
    conversationId: input.snapshot.conversationId,
    outputPath,
    retention: input.retention,
  });
  await writePromptSnapshotIndex({
    rootDirectory: getConversationPromptSnapshotRoot(input.stateDir),
  });
  return {
    artifact,
    outputPath,
  };
}

export async function loadConversationPromptSnapshotArtifact(input: {
  stateDir: string;
  conversationId: string;
  runId?: string;
}): Promise<ConversationPromptSnapshotArtifact | undefined> {
  if (input.runId) {
    const artifactPath = getConversationPromptSnapshotArtifactPath({
      stateDir: input.stateDir,
      conversationId: input.conversationId,
      runId: input.runId,
    });
    return readPromptSnapshotArtifactFile(artifactPath);
  }

  const directory = getConversationPromptSnapshotDirectory(input.stateDir, input.conversationId);
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
    const fsError = error as NodeJS.ErrnoException;
    if (fsError.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (!entries || entries.length === 0) {
    return undefined;
  }

  let latestArtifact: ConversationPromptSnapshotArtifact | undefined;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".prompt-snapshot.json")) {
      continue;
    }
    const artifact = await readPromptSnapshotArtifactFile(path.join(directory, entry.name));
    if (!artifact) {
      continue;
    }
    if (!latestArtifact || artifact.manifest.createdAt > latestArtifact.manifest.createdAt) {
      latestArtifact = artifact;
    }
  }

  return latestArtifact;
}

export function normalizeConversationPromptSnapshotArtifact(
  artifact: ConversationPromptSnapshotArtifact,
): ConversationPromptSnapshotArtifact {
  const normalizedSnapshot = normalizeLegacyPromptSnapshot({
    agentId: artifact.manifest.agentId,
    conversationId: artifact.manifest.conversationId,
    runId: artifact.manifest.runId,
    createdAt: artifact.manifest.createdAt,
    systemPrompt: artifact.snapshot.systemPrompt,
    messages: artifact.snapshot.messages,
    ...(artifact.snapshot.deltas ? { deltas: artifact.snapshot.deltas } : {}),
    ...(artifact.snapshot.providerNativeSystemBlocks
      ? { providerNativeSystemBlocks: artifact.snapshot.providerNativeSystemBlocks }
      : {}),
    ...(artifact.snapshot.inputMeta ? { inputMeta: artifact.snapshot.inputMeta } : {}),
    hookSystemPromptUsed: artifact.snapshot.hookSystemPromptUsed,
    prependContext: artifact.snapshot.prependContext,
  });
  const rebuiltArtifact = buildConversationPromptSnapshotArtifact({
    snapshot: normalizedSnapshot,
    persistedAt: artifact.manifest.persistedAt,
  });
  const summaryRecord = isRecord(artifact.summary)
    ? artifact.summary
    : undefined;
  const inputMeta = isRecord(normalizedSnapshot.inputMeta)
    ? normalizedSnapshot.inputMeta as Record<string, unknown>
    : undefined;
  const tokenBreakdown = readPromptTokenBreakdownFromMetadata(
    summaryRecord ? { tokenBreakdown: summaryRecord.tokenBreakdown } : undefined,
  ) ?? readPromptTokenBreakdownFromMetadata(
    inputMeta
      ? { tokenBreakdown: inputMeta.tokenBreakdown ?? inputMeta.promptTokenBreakdown }
      : undefined,
  ) ?? rebuiltArtifact.summary.tokenBreakdown;
  const truncationReason = readPromptTruncationReasonFromMetadata(
    summaryRecord ? { truncationReason: summaryRecord.truncationReason } : undefined,
  ) ?? readPromptTruncationReasonFromMetadata(inputMeta)
    ?? rebuiltArtifact.summary.truncationReason;
  const normalizedInputMeta = {
    ...(rebuiltArtifact.snapshot.inputMeta ?? {}),
    promptTokenBreakdown: tokenBreakdown,
    ...(truncationReason ? { truncationReason } : {}),
  };

  return {
    schemaVersion: artifact.schemaVersion,
    manifest: { ...artifact.manifest },
    summary: {
      ...rebuiltArtifact.summary,
      tokenBreakdown,
      systemPromptEstimatedTokens: tokenBreakdown.systemPromptEstimatedTokens,
      deltaEstimatedTokens: tokenBreakdown.deltaEstimatedTokens,
      providerNativeSystemBlockEstimatedTokens: tokenBreakdown.providerNativeSystemBlockEstimatedTokens,
      ...(truncationReason ? { truncationReason } : {}),
    },
    snapshot: {
      ...rebuiltArtifact.snapshot,
      inputMeta: normalizedInputMeta,
    },
  };
}

export function renderConversationPromptSnapshotText(
  artifact: ConversationPromptSnapshotArtifact,
  sidecar?: {
    launchExplainability?: Record<string, unknown> | null;
    residentStateBinding?: Record<string, unknown> | null;
  },
): string {
  const residentProfile = readPromptSnapshotResidentObject(artifact.snapshot.inputMeta, "residentProfile");
  const memoryPolicy = readPromptSnapshotResidentObject(artifact.snapshot.inputMeta, "memoryPolicy");
  const launchExplainabilityLines = renderAgentLaunchExplainabilityLines(sidecar?.launchExplainability);
  const residentStateBindingLines = renderResidentStateBindingLines(sidecar?.residentStateBinding);
  const promptObservabilityText = renderPromptObservabilityText({
    scope: "run",
    agentId: artifact.manifest.agentId ?? "unknown",
    conversationId: artifact.manifest.conversationId,
    ...(artifact.manifest.runId ? { runId: artifact.manifest.runId } : {}),
    createdAt: artifact.manifest.createdAt,
    counts: {
      deltaCount: artifact.summary.deltaCount,
      providerNativeSystemBlockCount: artifact.summary.providerNativeSystemBlockCount,
    },
    promptSizes: {
      totalChars: artifact.summary.systemPromptChars,
      finalChars: artifact.summary.systemPromptChars,
    },
    tokenBreakdown: artifact.summary.tokenBreakdown,
    ...(artifact.summary.contextInjection ? { contextInjection: artifact.summary.contextInjection } : {}),
    flags: {
      includesHookSystemPrompt: artifact.summary.includesHookSystemPrompt,
      hasPrependContext: artifact.summary.hasPrependContext,
    },
    ...(artifact.summary.truncationReason
      ? { truncationReason: artifact.summary.truncationReason }
      : {}),
  });
  const lines: string[] = [
    "Conversation Prompt Snapshot",
    `conversationId: ${artifact.manifest.conversationId}`,
    artifact.manifest.runId ? `runId: ${artifact.manifest.runId}` : "runId: (latest)",
    artifact.manifest.agentId ? `agentId: ${artifact.manifest.agentId}` : "agentId: unknown",
    `createdAt: ${new Date(artifact.manifest.createdAt).toISOString()}`,
    `persistedAt: ${new Date(artifact.manifest.persistedAt).toISOString()}`,
    "",
    `messages: ${artifact.summary.messageCount}`,
    promptObservabilityText,
    "",
  ];

  if (residentStateBindingLines.length > 0) {
    lines.push("Resident State Binding");
    lines.push(...residentStateBindingLines);
    lines.push("");
  }
  if (launchExplainabilityLines.length > 0) {
    lines.push("Launch Explainability");
    lines.push(...launchExplainabilityLines);
    lines.push("");
  }

  lines.push(
    "System Prompt",
    artifact.snapshot.systemPrompt || "(empty)",
    "",
    "Messages",
  );

  artifact.snapshot.messages.forEach((message, index) => {
    lines.push(``);
    lines.push(`[${index + 1}] role=${message.role}${message.toolCallId ? ` toolCallId=${message.toolCallId}` : ""}`);
    if (Array.isArray(message.content)) {
      message.content.forEach((part, partIndex) => {
        if (part.type === "text") {
          lines.push(`  part[${partIndex}] text: ${part.text}`);
          return;
        }
        lines.push(`  part[${partIndex}] ${part.type}: ${part.url}`);
      });
      return;
    }
    lines.push(String(message.content));
  });

  if (artifact.snapshot.deltas && artifact.snapshot.deltas.length > 0) {
    lines.push("");
    lines.push("Prompt Deltas");
    artifact.snapshot.deltas.forEach((delta, index) => {
      lines.push(`[${index + 1}] ${delta.deltaType} role=${delta.role} id=${delta.id} estimatedTokens=${delta.estimatedTokens}`);
      lines.push(delta.text);
    });
  }

  if (artifact.snapshot.providerNativeSystemBlocks && artifact.snapshot.providerNativeSystemBlocks.length > 0) {
    lines.push("");
    lines.push("Provider-Native System Blocks");
    artifact.snapshot.providerNativeSystemBlocks.forEach((block, index) => {
      lines.push(
        `[${index + 1}] ${block.blockType} id=${block.id} cacheControlEligible=${block.cacheControlEligible ? "yes" : "no"} estimatedTokens=${block.estimatedTokens}`,
      );
      lines.push(`  sourceSectionIds: ${block.sourceSectionIds.join(", ") || "(none)"}`);
      lines.push(`  sourceDeltaIds: ${block.sourceDeltaIds.join(", ") || "(none)"}`);
      lines.push(block.text);
    });
  }

  if (artifact.snapshot.inputMeta && Object.keys(artifact.snapshot.inputMeta).length > 0) {
    lines.push("");
    lines.push("Input Meta");
    lines.push(JSON.stringify(artifact.snapshot.inputMeta, null, 2));
  }

  if (residentProfile || memoryPolicy) {
    lines.push("");
    lines.push("Resident Metadata");
    if (residentProfile) {
      lines.push(`residentProfile: ${JSON.stringify(residentProfile, null, 2)}`);
    }
    if (memoryPolicy) {
      lines.push(`memoryPolicy: ${JSON.stringify(memoryPolicy, null, 2)}`);
    }
  }

  return lines.join("\n");
}

function readPromptSnapshotResidentObject(
  inputMeta: JsonObject | undefined,
  key: "residentProfile" | "memoryPolicy",
): Record<string, unknown> | undefined {
  const candidate = inputMeta?.[key];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return undefined;
  }
  return { ...(candidate as Record<string, unknown>) };
}

async function atomicWriteJson(targetPath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${crypto.randomUUID()}.tmp`;
  const content = JSON.stringify(value, null, 2);
  await fs.writeFile(tempPath, content, "utf-8");
  await renameWithWindowsFallback(tempPath, targetPath, content);
}

async function atomicWriteText(targetPath: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tempPath, value, "utf-8");
  await renameWithWindowsFallback(tempPath, targetPath, value);
}

async function renameWithWindowsFallback(tempPath: string, targetPath: string, content: string): Promise<void> {
  let lastErr: NodeJS.ErrnoException | null = null;
  for (let attempt = 0; attempt < RENAME_RETRIES; attempt += 1) {
    try {
      await fs.rename(tempPath, targetPath);
      return;
    } catch (error) {
      lastErr = error as NodeJS.ErrnoException;
      if (attempt < RENAME_RETRIES - 1) {
        await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_DELAY_MS));
      }
    }
  }

  if (process.platform === "win32" && lastErr && (lastErr.code === "EPERM" || lastErr.code === "EBUSY")) {
    try {
      await fs.writeFile(targetPath, content, "utf-8");
      await fs.unlink(tempPath).catch(() => {});
      return;
    } catch (fallbackError) {
      await fs.unlink(tempPath).catch(() => {});
      throw fallbackError;
    }
  }

  await fs.unlink(tempPath).catch(() => {});
  throw lastErr;
}

async function persistConversationPromptSystemPromptBlob(input: {
  stateDir: string;
  systemPrompt: string;
}): Promise<ConversationPromptSnapshotSystemPromptRef> {
  const hash = buildSystemPromptBlobHash(input.systemPrompt);
  const blobPath = getConversationPromptSnapshotSystemPromptBlobPath({
    stateDir: input.stateDir,
    hash,
  });
  const exists = await fs.access(blobPath).then(() => true).catch((error) => {
    const fsError = error as NodeJS.ErrnoException;
    if (fsError.code === "ENOENT") {
      return false;
    }
    throw error;
  });
  if (!exists) {
    await atomicWriteText(blobPath, input.systemPrompt);
  }
  return {
    hash,
    chars: input.systemPrompt.length,
  };
}

function toPersistedConversationPromptSnapshotMessage(input: {
  message: AgentPromptSnapshotMessage;
  systemPrompt: string;
  index: number;
}): PersistedConversationPromptSnapshotMessage {
  const { message, systemPrompt, index } = input;
  const { content: _content, ...messageWithoutContent } = message;
  const clonedContent = Array.isArray(message.content)
    ? message.content.map((part) => ({ ...part }))
    : message.content;
  if (
    index === 0
    && message.role === "system"
    && typeof clonedContent === "string"
    && clonedContent === systemPrompt
  ) {
    return {
      ...messageWithoutContent,
      contentRef: "systemPrompt",
    };
  }
  return {
    ...messageWithoutContent,
    content: clonedContent,
  };
}

function expandPersistedConversationPromptSnapshotMessage(input: {
  message: PersistedConversationPromptSnapshotMessage;
  systemPrompt: string;
}): AgentPromptSnapshotMessage {
  const { message, systemPrompt } = input;
  if ("contentRef" in message && message.contentRef === "systemPrompt") {
    const { contentRef: _contentRef, ...messageWithoutContentRef } = message;
    return {
      ...messageWithoutContentRef,
      content: systemPrompt,
    };
  }
  return {
    ...message,
    content: Array.isArray(message.content)
      ? message.content.map((part) => ({ ...part }))
      : message.content,
  };
}

function toPersistedConversationPromptSnapshotArtifact(input: {
  artifact: ConversationPromptSnapshotArtifact;
  systemPromptRef: ConversationPromptSnapshotSystemPromptRef;
}): PersistedConversationPromptSnapshotArtifactV2 {
  return {
    schemaVersion: CONVERSATION_PROMPT_SNAPSHOT_SCHEMA_VERSION,
    manifest: { ...input.artifact.manifest },
    summary: { ...input.artifact.summary },
    snapshot: {
      systemPromptRef: {
        hash: input.systemPromptRef.hash,
        chars: input.systemPromptRef.chars,
      },
      messages: input.artifact.snapshot.messages.map((message, index) => toPersistedConversationPromptSnapshotMessage({
        message,
        systemPrompt: input.artifact.snapshot.systemPrompt,
        index,
      })),
      ...(input.artifact.snapshot.deltas
        ? {
          deltas: input.artifact.snapshot.deltas.map((delta) => ({
            ...delta,
            ...(delta.metadata ? { metadata: { ...delta.metadata } } : {}),
          })),
        }
        : {}),
      ...(input.artifact.snapshot.providerNativeSystemBlocks
        ? {
          providerNativeSystemBlocks: input.artifact.snapshot.providerNativeSystemBlocks.map((block) => ({
            ...block,
            sourceSectionIds: [...block.sourceSectionIds],
            sourceDeltaIds: [...block.sourceDeltaIds],
          })),
        }
        : {}),
      ...(sanitizeConversationPromptSnapshotInputMeta(input.artifact.snapshot.inputMeta)
        ? { inputMeta: sanitizeConversationPromptSnapshotInputMeta(input.artifact.snapshot.inputMeta) }
        : {}),
      hookSystemPromptUsed: input.artifact.snapshot.hookSystemPromptUsed === true,
      ...(input.artifact.snapshot.prependContext ? { prependContext: input.artifact.snapshot.prependContext } : {}),
    },
  };
}

async function expandPersistedConversationPromptSnapshotArtifact(input: {
  artifact: PersistedConversationPromptSnapshotArtifact;
  artifactPath: string;
}): Promise<ConversationPromptSnapshotArtifact | undefined> {
  if (input.artifact.schemaVersion === 1) {
    return input.artifact;
  }
  const systemPrompt = await loadConversationPromptSystemPromptBlob({
    rootDirectory: getConversationPromptSnapshotRootFromArtifactPath(input.artifactPath),
    ref: input.artifact.snapshot.systemPromptRef,
  });
  if (typeof systemPrompt !== "string") {
    return undefined;
  }
  return {
    schemaVersion: input.artifact.schemaVersion,
    manifest: { ...input.artifact.manifest },
    summary: { ...input.artifact.summary },
    snapshot: {
      systemPrompt,
      messages: input.artifact.snapshot.messages.map((message) => expandPersistedConversationPromptSnapshotMessage({
        message,
        systemPrompt,
      })),
      ...(input.artifact.snapshot.deltas
        ? {
          deltas: input.artifact.snapshot.deltas.map((delta) => ({
            ...delta,
            ...(delta.metadata ? { metadata: { ...delta.metadata } } : {}),
          })),
        }
        : {}),
      ...(input.artifact.snapshot.providerNativeSystemBlocks
        ? {
          providerNativeSystemBlocks: input.artifact.snapshot.providerNativeSystemBlocks.map((block) => ({
            ...block,
            sourceSectionIds: [...block.sourceSectionIds],
            sourceDeltaIds: [...block.sourceDeltaIds],
          })),
        }
        : {}),
      ...(sanitizeConversationPromptSnapshotInputMeta(input.artifact.snapshot.inputMeta)
        ? { inputMeta: sanitizeConversationPromptSnapshotInputMeta(input.artifact.snapshot.inputMeta) }
        : {}),
      hookSystemPromptUsed: input.artifact.snapshot.hookSystemPromptUsed === true,
      ...(input.artifact.snapshot.prependContext ? { prependContext: input.artifact.snapshot.prependContext } : {}),
    },
  };
}

function sanitizeConversationPromptSnapshotInputMeta(inputMeta?: JsonObject): JsonObject | undefined {
  if (!isRecord(inputMeta)) {
    return undefined;
  }
  const sanitized: Record<string, unknown> = { ...inputMeta };
  delete sanitized.promptDeltas;
  delete sanitized.tokenBreakdown;
  delete sanitized.promptTokenBreakdown;
  delete sanitized.truncationReason;
  return Object.keys(sanitized).length > 0 ? sanitized as JsonObject : undefined;
}

async function loadConversationPromptSystemPromptBlob(input: {
  rootDirectory: string;
  ref: ConversationPromptSnapshotSystemPromptRef;
}): Promise<string | undefined> {
  const blobPath = getConversationPromptSnapshotSystemPromptBlobPathFromRoot(input.rootDirectory, input.ref.hash);
  try {
    return await fs.readFile(blobPath, "utf-8");
  } catch (error) {
    const fsError = error as NodeJS.ErrnoException;
    if (fsError.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function prunePersistedConversationPromptSnapshots(input: {
  stateDir: string;
  conversationId: string;
  outputPath: string;
  retention?: ConversationPromptSnapshotRetentionPolicy;
}): Promise<void> {
  const retention = resolveConversationPromptSnapshotRetentionPolicy(input.retention);
  const isHeartbeatConversation = isHeartbeatConversationId(input.conversationId, retention.heartbeatConversationPrefix);
  const isEmailThreadConversation = isEmailThreadConversationId(input.conversationId, retention.emailThreadConversationPrefix);
  if (!isHeartbeatConversation) {
    await prunePromptSnapshotDirectoryByLimit({
      directory: getConversationPromptSnapshotDirectory(input.stateDir, input.conversationId),
      maxSnapshots: isEmailThreadConversation
        ? retention.emailThreadMaxRuns
        : retention.defaultMaxRunsPerConversation,
      newestPath: input.outputPath,
    });
  }
  await pruneHeartbeatPromptSnapshotsByLimit({
    rootDirectory: getConversationPromptSnapshotRoot(input.stateDir),
    maxSnapshots: retention.heartbeatMaxRuns,
    heartbeatConversationPrefix: retention.heartbeatConversationPrefix,
    newestPath: isHeartbeatConversation ? input.outputPath : undefined,
  });
  if (typeof retention.maxAgeDays === "number" && retention.maxAgeDays > 0) {
    await prunePromptSnapshotRootByAge({
      rootDirectory: getConversationPromptSnapshotRoot(input.stateDir),
      maxAgeMs: retention.maxAgeDays * 24 * 60 * 60 * 1000,
      now: retention.now,
    });
  }
  await pruneUnreferencedPromptSnapshotSystemPromptBlobs({
    rootDirectory: getConversationPromptSnapshotRoot(input.stateDir),
  });
}

function resolveConversationPromptSnapshotRetentionPolicy(
  policy?: ConversationPromptSnapshotRetentionPolicy,
): Required<ConversationPromptSnapshotRetentionPolicy> {
  return {
    defaultMaxRunsPerConversation: clampPositiveInteger(
      policy?.defaultMaxRunsPerConversation,
      DEFAULT_PROMPT_SNAPSHOT_MAX_PERSISTED_RUNS,
    ),
    heartbeatMaxRuns: clampPositiveInteger(
      policy?.heartbeatMaxRuns,
      DEFAULT_PROMPT_SNAPSHOT_HEARTBEAT_MAX_RUNS,
    ),
    emailThreadMaxRuns: clampPositiveInteger(
      policy?.emailThreadMaxRuns,
      DEFAULT_PROMPT_SNAPSHOT_EMAIL_THREAD_MAX_RUNS,
    ),
    maxAgeDays: clampNonNegativeInteger(policy?.maxAgeDays, DEFAULT_PROMPT_SNAPSHOT_MAX_AGE_DAYS),
    heartbeatConversationPrefix: normalizeHeartbeatConversationPrefix(policy?.heartbeatConversationPrefix),
    emailThreadConversationPrefix: normalizeEmailThreadConversationPrefix(policy?.emailThreadConversationPrefix),
    now: typeof policy?.now === "number" && Number.isFinite(policy.now) ? policy.now : Date.now(),
  };
}

async function prunePromptSnapshotDirectoryByLimit(input: {
  directory: string;
  maxSnapshots: number;
  newestPath?: string;
}): Promise<void> {
  const files = await listPromptSnapshotFiles(input.directory);
  if (files.length <= input.maxSnapshots) {
    return;
  }
  const stats = await Promise.all(files.map(async (filePath) => {
    const stat = await fs.stat(filePath).catch(() => undefined);
    return stat
      ? { path: filePath, mtimeMs: stat.mtimeMs }
      : undefined;
  }));
  const existingFiles = stats.filter((entry): entry is { path: string; mtimeMs: number } => Boolean(entry));
  existingFiles.sort((left, right) => {
    if (input.newestPath && left.path === input.newestPath && right.path !== input.newestPath) {
      return -1;
    }
    if (input.newestPath && right.path === input.newestPath && left.path !== input.newestPath) {
      return 1;
    }
    if (right.mtimeMs !== left.mtimeMs) {
      return right.mtimeMs - left.mtimeMs;
    }
    return right.path.localeCompare(left.path);
  });
  const toRemove = existingFiles.slice(input.maxSnapshots);
  await Promise.all(toRemove.map(({ path: filePath }) => unlinkIfExists(filePath)));
}

async function pruneHeartbeatPromptSnapshotsByLimit(input: {
  rootDirectory: string;
  maxSnapshots: number;
  heartbeatConversationPrefix: string;
  newestPath?: string;
}): Promise<void> {
  const heartbeatFiles = await listPromptSnapshotFilesAcrossDirectories(input.rootDirectory, {
    directoryPrefix: input.heartbeatConversationPrefix,
  });
  if (heartbeatFiles.length <= input.maxSnapshots) {
    return;
  }
  const stats = await Promise.all(heartbeatFiles.map(async (filePath) => {
    const stat = await fs.stat(filePath).catch(() => undefined);
    return stat
      ? { path: filePath, mtimeMs: stat.mtimeMs }
      : undefined;
  }));
  const existingFiles = stats.filter((entry): entry is { path: string; mtimeMs: number } => Boolean(entry));
  existingFiles.sort((left, right) => {
    if (input.newestPath && left.path === input.newestPath && right.path !== input.newestPath) {
      return -1;
    }
    if (input.newestPath && right.path === input.newestPath && left.path !== input.newestPath) {
      return 1;
    }
    if (right.mtimeMs !== left.mtimeMs) {
      return right.mtimeMs - left.mtimeMs;
    }
    return right.path.localeCompare(left.path);
  });
  const toRemove = existingFiles.slice(input.maxSnapshots);
  await Promise.all(toRemove.map(async ({ path: filePath }) => {
    await unlinkIfExists(filePath);
    await removeDirectoryIfEmpty(path.dirname(filePath));
  }));
}

async function prunePromptSnapshotRootByAge(input: {
  rootDirectory: string;
  maxAgeMs: number;
  now?: number;
}): Promise<void> {
  const rootEntries = await fs.readdir(input.rootDirectory, { withFileTypes: true }).catch((error) => {
    const fsError = error as NodeJS.ErrnoException;
    if (fsError.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (!rootEntries || rootEntries.length === 0) {
    return;
  }
  const threshold = (typeof input.now === "number" && Number.isFinite(input.now) ? input.now : Date.now()) - input.maxAgeMs;
  await Promise.all(rootEntries.map(async (entry) => {
    if (!entry.isDirectory()) {
      return;
    }
    const directory = path.join(input.rootDirectory, entry.name);
    const files = await listPromptSnapshotFiles(directory);
    await Promise.all(files.map(async (filePath) => {
      const stat = await fs.stat(filePath).catch(() => undefined);
      if (stat && stat.mtimeMs < threshold) {
        await unlinkIfExists(filePath);
      }
    }));
    await removeDirectoryIfEmpty(directory);
  }));
}

async function listPromptSnapshotFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
    const fsError = error as NodeJS.ErrnoException;
    if (fsError.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (!entries || entries.length === 0) {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".prompt-snapshot.json"))
    .map((entry) => path.join(directory, entry.name));
}

async function listPromptSnapshotFilesAcrossDirectories(
  rootDirectory: string,
  options?: { directoryPrefix?: string },
): Promise<string[]> {
  const rootEntries = await fs.readdir(rootDirectory, { withFileTypes: true }).catch((error) => {
    const fsError = error as NodeJS.ErrnoException;
    if (fsError.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (!rootEntries || rootEntries.length === 0) {
    return [];
  }
  const files = await Promise.all(rootEntries.map(async (entry) => {
    if (!entry.isDirectory()) {
      return [];
    }
    if (options?.directoryPrefix && !entry.name.startsWith(options.directoryPrefix)) {
      return [];
    }
    return listPromptSnapshotFiles(path.join(rootDirectory, entry.name));
  }));
  return files.flat();
}

async function unlinkIfExists(targetPath: string): Promise<void> {
  await fs.unlink(targetPath).catch((error) => {
    const fsError = error as NodeJS.ErrnoException;
    if (fsError.code === "ENOENT") {
      return;
    }
    throw error;
  });
}

async function removeDirectoryIfEmpty(directory: string): Promise<void> {
  const entries = await fs.readdir(directory).catch((error) => {
    const fsError = error as NodeJS.ErrnoException;
    if (fsError.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (!entries || entries.length > 0) {
    return;
  }
  await fs.rmdir(directory).catch((error) => {
    const fsError = error as NodeJS.ErrnoException;
    if (fsError.code === "ENOENT" || fsError.code === "ENOTEMPTY") {
      return;
    }
    throw error;
  });
}

async function pruneUnreferencedPromptSnapshotSystemPromptBlobs(input: {
  rootDirectory: string;
}): Promise<void> {
  const referencedHashes = await collectReferencedPromptSnapshotSystemPromptHashes(input.rootDirectory);
  const blobDirectory = path.join(
    input.rootDirectory,
    PROMPT_SNAPSHOT_BLOBS_DIRNAME,
    PROMPT_SNAPSHOT_SYSTEM_PROMPT_BLOBS_DIRNAME,
  );
  const entries = await fs.readdir(blobDirectory, { withFileTypes: true }).catch((error) => {
    const fsError = error as NodeJS.ErrnoException;
    if (fsError.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (!entries || entries.length === 0) {
    return;
  }
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !entry.name.endsWith(".txt")) {
      return;
    }
    const hash = `sha256:${entry.name.slice(0, -4)}`;
    if (referencedHashes.has(hash)) {
      return;
    }
    await unlinkIfExists(path.join(blobDirectory, entry.name));
  }));
  await removeDirectoryIfEmpty(blobDirectory);
  await removeDirectoryIfEmpty(path.dirname(blobDirectory));
}

async function collectReferencedPromptSnapshotSystemPromptHashes(rootDirectory: string): Promise<Set<string>> {
  const files = await listPromptSnapshotFilesAcrossDirectories(rootDirectory);
  const hashes = new Set<string>();
  await Promise.all(files.map(async (filePath) => {
    const raw = await fs.readFile(filePath, "utf-8").catch((error) => {
      const fsError = error as NodeJS.ErrnoException;
      if (fsError.code === "ENOENT") {
        return undefined;
      }
      throw error;
    });
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw) as PersistedConversationPromptSnapshotArtifact;
    if (
      parsed
      && typeof parsed === "object"
      && parsed.schemaVersion === CONVERSATION_PROMPT_SNAPSHOT_SCHEMA_VERSION
      && isRecord(parsed.snapshot)
      && typeof parsed.snapshot.systemPromptRef?.hash === "string"
    ) {
      hashes.add(parsed.snapshot.systemPromptRef.hash);
    }
  }));
  return hashes;
}

function isHeartbeatConversationId(conversationId: string, heartbeatConversationPrefix: string): boolean {
  return conversationId.startsWith(heartbeatConversationPrefix);
}

function isEmailThreadConversationId(conversationId: string, emailThreadConversationPrefix: string): boolean {
  return conversationId.startsWith(emailThreadConversationPrefix);
}

function normalizeHeartbeatConversationPrefix(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized || DEFAULT_PROMPT_SNAPSHOT_HEARTBEAT_PREFIX;
}

function normalizeEmailThreadConversationPrefix(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized || DEFAULT_PROMPT_SNAPSHOT_EMAIL_THREAD_PREFIX;
}

function clampPositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

function clampNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function buildSystemPromptBlobHash(systemPrompt: string): string {
  return `sha256:${crypto.createHash("sha256").update(systemPrompt, "utf-8").digest("hex")}`;
}

function sanitizeSystemPromptBlobHash(hash: string): string {
  return hash.replace(/^sha256:/, "").trim();
}

function getConversationPromptSnapshotRootFromArtifactPath(artifactPath: string): string {
  return path.dirname(path.dirname(artifactPath));
}

function getConversationPromptSnapshotSystemPromptBlobPathFromRoot(rootDirectory: string, hash: string): string {
  return path.join(
    rootDirectory,
    PROMPT_SNAPSHOT_BLOBS_DIRNAME,
    PROMPT_SNAPSHOT_SYSTEM_PROMPT_BLOBS_DIRNAME,
    `${sanitizeSystemPromptBlobHash(hash)}.txt`,
  );
}

async function readPromptSnapshotArtifactFile(targetPath: string): Promise<ConversationPromptSnapshotArtifact | undefined> {
  try {
    const raw = await fs.readFile(targetPath, "utf-8");
    const parsed = JSON.parse(raw) as PersistedConversationPromptSnapshotArtifact;
    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }
    if (parsed.schemaVersion !== 1 && parsed.schemaVersion !== CONVERSATION_PROMPT_SNAPSHOT_SCHEMA_VERSION) {
      return undefined;
    }
    if (!parsed.manifest || typeof parsed.manifest.conversationId !== "string") {
      return undefined;
    }
    const expanded = await expandPersistedConversationPromptSnapshotArtifact({
      artifact: parsed,
      artifactPath: targetPath,
    });
    if (!expanded) {
      return undefined;
    }
    return normalizeConversationPromptSnapshotArtifact(expanded);
  } catch (error) {
    const fsError = error as NodeJS.ErrnoException;
    if (fsError.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function sanitizeFileSegment(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return sanitized.slice(0, 120) || "conversation";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
