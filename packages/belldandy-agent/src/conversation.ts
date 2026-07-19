import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { FilesystemCapability } from "@belldandy/protocol";
import {
    buildCompactedMessages,
    needsCompaction,
    compactIncremental,
    estimateMessagesTokens,
    estimateTokens,
    createEmptyCompactionState,
    normalizeCompactionState,
    type CompactionOptions,
    type CompactionState,
    type SummarizerFn,
} from "./compaction.js";
import type { CompactionRuntimeReport, CompactionRuntimeTracker } from "./compaction-runtime.js";
import type { AfterCompactionEvent, BeforeCompactionEvent, HookAgentContext } from "./hooks.js";
import {
    appendSessionTranscriptEvent,
    createSessionTranscriptCompactBoundaryEvent,
    createSessionTranscriptMessageEvent,
    createSessionTranscriptPartialCompactionViewEvent,
    readSessionTranscriptFile,
    type SessionTranscriptEvent,
} from "./session-transcript.js";
import {
    buildTranscriptRelinkedHistory,
    deriveTranscriptRelinkArtifacts,
    type TranscriptRelinkPartialCompactionView,
} from "./session-transcript-relink.js";
import {
    buildConversationRestoreView as buildSessionRestoreView,
    type SessionRestoreHistoryMessage,
    type SessionRestoreView,
} from "./session-restore.js";
import {
    buildSessionTranscriptExportBundle,
    type SessionTranscriptExportBundle,
    type SessionTranscriptExportRedactionMode,
} from "./session-transcript-export.js";
import {
    buildSessionTimelineProjection,
    type SessionTimelineProjection,
} from "./session-timeline.js";
import { readBoundedTailLines } from "./conversation-tail-reader.js";
import type {
    ConversationPlanState,
    ConversationPlanUpdateInput,
    ConversationPlanUpdateResult,
    ConversationPlanUpdatedBy,
    RecentToolResultRecord,
} from "@belldandy/skills";
import {
    normalizeConversationPlanState,
    updateConversationPlanState,
} from "./conversation-plan-state.js";
import {
    ConversationLifecycleCoordinator,
    type ConversationLifecycleGeneration,
    type ConversationLifecycleSnapshot,
} from "./conversation-lifecycle.js";

/**
 * 对话消息
 */
export type ConversationMessage = {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: number;
    /** 产生此消息的 Agent Profile ID（多 Agent 预留） */
    agentId?: string;
    /** 客户端发送上下文（用于诊断和时间回填） */
    clientContext?: {
        sentAtMs?: number;
        timezoneOffsetMinutes?: number;
        locale?: string;
    };
};

/**
 * 跨 run 持久化的 token 计数器快照
 */
export type ActiveCounterSnapshot = {
  name: string;
  startTime: number;
  baseInputTokens: number;
  baseOutputTokens: number;
  baseInputCostUsd?: number;
  baseOutputCostUsd?: number;
  /** 快照保存时的全局累计值（用于跨 run 恢复） */
  savedGlobalInputTokens: number;
  savedGlobalOutputTokens: number;
  savedGlobalInputCostUsd?: number;
  savedGlobalOutputCostUsd?: number;
};

export type TaskTokenRecord = {
    name: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    durationMs: number;
    inputCostUsd?: number;
    outputCostUsd?: number;
    totalCostUsd?: number;
    createdAt: number;
    auto?: boolean;
};

export type ToolDigestRecord = {
    toolName: string;
    success: boolean;
    summary: string;
    target?: string;
    keyResult?: string;
    errorSummary?: string;
    toolCallId?: string;
    createdAt: number;
};

export type StoredRecentToolResultRecord = RecentToolResultRecord;

export type CarryoverContextSourceType =
    | "file_read"
    | "conversation_read"
    | "tool_result"
    | "log_read"
    | "web_result"
    | "attachment"
    | "other";

export type CarryoverContextRecord = {
    sourceType: CarryoverContextSourceType;
    sourceKey: string;
    title: string;
    summary: string;
    keyFacts: string[];
    tokenEstimate: number;
    lastUsedAt: number;
    priority: number;
};

/** 同一次 Tool Result 派生的三个持久化投影，必须作为一个最终 meta snapshot 提交。 */
export type ToolArtifactsRecord = {
    toolDigest: Omit<ToolDigestRecord, "createdAt"> & { createdAt?: number };
    recentToolResult: Omit<StoredRecentToolResultRecord, "createdAt"> & { createdAt?: number };
    carryoverContext?: Partial<CarryoverContextRecord>;
    toolDigestLimit?: number;
    recentToolResultLimit?: number;
    carryoverContextLimit?: number;
};

type CarryoverContextQueryOptions = {
    limit?: number;
    query?: string;
    now?: number;
};

export type CompactBoundaryRecord = {
    id: string;
    trigger: "request" | "manual" | "partial_up_to" | "partial_from";
    createdAt: number;
    summaryStateVersion: number;
    preCompactTokenCount: number;
    postCompactTokenCount: number;
    compactedMessageCount: number;
    tier?: "rolling" | "archival";
    fallbackUsed: boolean;
    rebuildTriggered: boolean;
    preservedSegment: {
        headMessageId?: string;
        anchorId?: string;
        tailMessageId?: string;
        preservedMessageCount: number;
    };
};

export type PartialCompactDirection = "from" | "up_to";

export type PartialCompactionViewRecord = {
    id: string;
    direction: PartialCompactDirection;
    pivotMessageId: string;
    pivotMessageCount: number;
    compactedMessageCount: number;
    summaryMessages: Array<{ role: "user" | "assistant"; content: string }>;
    createdAt: number;
    originalTokens: number;
    compactedTokens: number;
    fallbackUsed: boolean;
    tier?: "rolling" | "archival";
};

export type ForcePartialCompactOptions = {
    direction: PartialCompactDirection;
    pivotMessageId?: string;
    pivotIndex?: number;
};

/**
 * 会话对象
 */
export type Conversation = {
    id: string;
    /** 绑定的 Agent Profile ID（多 Agent 预留） */
    agentId?: string;
    /** 来源渠道（"webchat" | "feishu" | "heartbeat" | ...） */
    channel?: string;
    messages: ConversationMessage[];
    createdAt: number;
    updatedAt: number;
    /** 房间成员列表缓存（用于多人聊天场景） */
    roomMembersCache?: {
        members: Array<{
            type: "user" | "agent";
            id: string;
            name?: string;
            identity?: string;
        }>;
        cachedAt: number; // 缓存时间戳
        ttl: number; // 缓存有效期（毫秒）
    };
    /** 跨 run 持久化的活跃 token 计数器快照 */
    activeCounters?: ActiveCounterSnapshot[];
    /** 最近任务级 token 统计结果 */
    taskTokenRecords?: TaskTokenRecord[];
    /** 最近工具摘要 */
    toolDigests?: ToolDigestRecord[];
    /** 最近可恢复的工具结果 */
    recentToolResults?: StoredRecentToolResultRecord[];
    /** 下一轮可继承的结构化工作集 */
    carryoverContext?: CarryoverContextRecord[];
    /** 当前会话为下一轮模型调用临时排队的 deferred tools */
    loadedToolNames?: string[];
    /** 最近压缩边界元数据 */
    compactBoundaries?: CompactBoundaryRecord[];
    /** 手动 partial compact 视图（当前仅 from 方向需要） */
    partialCompactionView?: PartialCompactionViewRecord;
    /** 当前会话级统一计划状态 */
    planState?: ConversationPlanState;
};

/**
 * 会话存储选项
 */
export type ConversationStoreOptions = {
    /** 最大历史消息数（默认 20） */
    maxHistory?: number;
    /** 内存会话过期时间（秒，默认 3600）；已持久化会话仍可从磁盘恢复 */
    ttlSeconds?: number;
    /** 持久化存储目录 (可选) */
    dataDir?: string;
    /** 对话压缩配置（可选，设置后启用自动压缩） */
    compaction?: CompactionOptions;
    /** 模型摘要函数（可选，注入后启用模型摘要） */
    summarizer?: SummarizerFn;
    /** 摘要模型名称（用于观测与 hook 事件） */
    summarizerModelName?: string;
    /** 压缩预算治理 / 熔断共享状态 */
    compactionRuntimeTracker?: CompactionRuntimeTracker;
    /** 压缩前回调（用于接入 hook 系统） */
    onBeforeCompaction?: (event: BeforeCompactionEvent, ctx: HookAgentContext) => Promise<void> | void;
    /** 压缩后回调（用于接入 hook 系统） */
    onAfterCompaction?: (event: AfterCompactionEvent, ctx: HookAgentContext) => Promise<void> | void;
};

type ConversationHistoryView = Array<{ role: "user" | "assistant"; content: string }>;
type SessionDigestHistoryView = Array<{ id: string; role: "user" | "assistant"; content: string }>;

export type SessionDigestStatus = "idle" | "ready" | "updated";

export type SessionDigestRecord = {
    conversationId: string;
    status: SessionDigestStatus;
    messageCount: number;
    digestedMessageCount: number;
    pendingMessageCount: number;
    threshold: number;
    rollingSummary: string;
    archivalSummary: string;
    lastDigestAt: number;
    digestGeneration: number;
};

export type SessionDigestRefreshOptions = {
    force?: boolean;
    threshold?: number;
};

export type SessionMemoryRecord = {
    conversationId: string;
    summary: string;
    currentGoal: string;
    decisions: string[];
    keyResults: string[];
    filesTouched: string[];
    errorsAndFixes: string[];
    pendingTasks: string[];
    currentWork: string;
    nextStep: string;
    lastSummarizedMessageCount: number;
    lastSummarizedMessageId?: string;
    lastSummarizedToolCursor: number;
    updatedAt: number;
};

export type ConversationRuntimeSnapshot = ConversationLifecycleSnapshot & {
    retainedConversation: boolean;
    retainedCompactionState: boolean;
    retainedSessionDigestState: boolean;
    retainedSessionMemory: boolean;
};

export type PersistedConversationSummary = {
    conversationId: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
    hasTranscript: boolean;
    hasMeta: boolean;
    hasMessages: boolean;
    agentId?: string;
    channel?: string;
};

type ConversationMetaSnapshot = Partial<Pick<
    Conversation,
    "agentId" | "channel" | "activeCounters" | "taskTokenRecords" | "toolDigests" | "recentToolResults" | "carryoverContext" | "loadedToolNames" | "compactBoundaries" | "partialCompactionView" | "planState" | "createdAt" | "updatedAt"
>> & {
    conversationId?: string;
};

type SessionDigestState = {
    threshold: number;
    lastDigestAt: number;
    lastSessionMemoryAt: number;
    lastSessionMemoryMessageCount: number;
    lastSessionMemoryToolCursor: number;
    digestGeneration: number;
};

type StoredSessionMemory = Omit<SessionMemoryRecord, "conversationId">;

export const conversationAsyncFs = {
    readFile(filePath: string, encoding: BufferEncoding): Promise<string> {
        return fsp.readFile(filePath, encoding);
    },
    appendFile(filePath: string, data: string, encoding: BufferEncoding): Promise<void> {
        return fsp.appendFile(filePath, data, encoding);
    },
    writeFile(filePath: string, data: string, encoding: BufferEncoding): Promise<void> {
        return fsp.writeFile(filePath, data, encoding);
    },
    rename(sourcePath: string, destinationPath: string): Promise<void> {
        return fsp.rename(sourcePath, destinationPath);
    },
    unlink(filePath: string): Promise<void> {
        return fsp.unlink(filePath);
    },
};

const INVALID_CONVERSATION_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001F%]/g;
const TRAILING_CONVERSATION_FILENAME_CHARS = /[. ]+$/;
const RESERVED_WINDOWS_BASENAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const DEFAULT_SESSION_DIGEST_THRESHOLD = 6;
const SESSION_MEMORY_SUMMARY_CHAR_LIMIT = 4000;
const COMPACT_BOUNDARY_STATE_VERSION = 1;
const DEFAULT_COMPACT_BOUNDARY_LIMIT = 20;
const DEFAULT_RECENT_TOOL_RESULT_LIMIT = 24;
const RECENT_TOOL_RESULT_CONTENT_CHAR_LIMIT = 2_400;
const RECENT_TOOL_RESULT_SUMMARY_CHAR_LIMIT = 280;
const RECENT_TOOL_RESULT_ERROR_CHAR_LIMIT = 800;
const RECENT_TOOL_RESULT_TARGET_CHAR_LIMIT = 240;
let conversationMessageIdCounter = 0;
let compactBoundaryIdCounter = 0;
let partialCompactionViewIdCounter = 0;

function createConversationMessageId(timestampMs: number): string {
    conversationMessageIdCounter += 1;
    return `msg_${timestampMs}_${conversationMessageIdCounter.toString(36)}`;
}

function ensureConversationMessageId(message: Pick<ConversationMessage, "id" | "timestamp">, index: number): string {
    if (typeof message.id === "string" && message.id.trim()) {
        return message.id;
    }
    return `legacy_msg_${Math.max(0, Math.floor(message.timestamp || 0))}_${index}`;
}

function createCompactBoundaryId(createdAt: number): string {
    compactBoundaryIdCounter += 1;
    return `cmp_${createdAt}_${compactBoundaryIdCounter.toString(36)}`;
}

function createPartialCompactionViewId(createdAt: number): string {
    partialCompactionViewIdCounter += 1;
    return `pcv_${createdAt}_${partialCompactionViewIdCounter.toString(36)}`;
}

function createEmptySessionMemory(): StoredSessionMemory {
    return {
        summary: "",
        currentGoal: "",
        decisions: [],
        keyResults: [],
        filesTouched: [],
        errorsAndFixes: [],
        pendingTasks: [],
        currentWork: "",
        nextStep: "",
        lastSummarizedMessageCount: 0,
        lastSummarizedMessageId: "",
        lastSummarizedToolCursor: 0,
        updatedAt: 0,
    };
}

function compactRecentToolResultText(value: unknown, limit: number): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.trim();
    if (!normalized) return undefined;
    if (normalized.length <= limit) return normalized;
    return `${normalized.slice(0, Math.max(0, limit - 3))}...`;
}

function buildRecentToolResultTextProjection(value: unknown, limit: number): {
    full?: string;
    preview?: string;
    chars?: number;
    truncated?: boolean;
} {
    if (typeof value !== "string") {
        return {};
    }
    const normalized = value.trim();
    if (!normalized) {
        return {};
    }
    const chars = normalized.length;
    const preview = compactRecentToolResultText(normalized, limit);
    const truncated = chars > limit;
    return {
        ...(preview ? { full: preview } : {}),
        ...(preview ? { preview } : {}),
        ...(chars > 0 ? { chars } : {}),
        ...(truncated ? { truncated: true } : {}),
    };
}

const RECENT_TOOL_RESULT_ARG_STRING_LIMIT = 160;
const RECENT_TOOL_RESULT_ARG_ARRAY_PREVIEW_LIMIT = 6;
const RECENT_TOOL_RESULT_ARG_OBJECT_PREVIEW_LIMIT = 12;
const RECENT_TOOL_RESULT_ARG_DEPTH_LIMIT = 3;

function projectRecentToolResultArgString(value: string, limit: number = RECENT_TOOL_RESULT_ARG_STRING_LIMIT): string {
    const normalized = value
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!normalized) return normalized;
    if (normalized.length <= limit) return normalized;
    return `${normalized.slice(0, Math.max(0, limit - 3))}...`;
}

function projectRecentToolResultArgsValue(value: unknown, depth: number): unknown {
    if (typeof value === "string") {
        return projectRecentToolResultArgString(value);
    }
    if (
        typeof value === "number"
        || typeof value === "boolean"
        || value === null
        || typeof value === "undefined"
    ) {
        return value;
    }
    if (Array.isArray(value)) {
        const projectedItems = value
            .slice(0, RECENT_TOOL_RESULT_ARG_ARRAY_PREVIEW_LIMIT)
            .map((item) => projectRecentToolResultArgsValue(item, depth + 1));
        if (value.length > RECENT_TOOL_RESULT_ARG_ARRAY_PREVIEW_LIMIT) {
            projectedItems.push(`[+${value.length - RECENT_TOOL_RESULT_ARG_ARRAY_PREVIEW_LIMIT} more items]`);
        }
        return projectedItems;
    }
    if (!value || typeof value !== "object") {
        return projectRecentToolResultArgString(String(value));
    }
    if (depth >= RECENT_TOOL_RESULT_ARG_DEPTH_LIMIT) {
        const keys = Object.keys(value as Record<string, unknown>);
        return `[object keys=${keys.length}]`;
    }

    const entries = Object.entries(value as Record<string, unknown>);
    const projected: Record<string, unknown> = {};
    for (const [key, entryValue] of entries.slice(0, RECENT_TOOL_RESULT_ARG_OBJECT_PREVIEW_LIMIT)) {
        projected[key] = projectRecentToolResultArgsValue(entryValue, depth + 1);
    }
    if (entries.length > RECENT_TOOL_RESULT_ARG_OBJECT_PREVIEW_LIMIT) {
        projected.__truncatedKeys = entries.length - RECENT_TOOL_RESULT_ARG_OBJECT_PREVIEW_LIMIT;
    }
    return projected;
}

function normalizeRecentToolResultArgs(value: unknown): RecentToolResultRecord["args"] {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    return projectRecentToolResultArgsValue(value, 0) as RecentToolResultRecord["args"];
}

function normalizeRecentToolResultRecord(
    record: Omit<StoredRecentToolResultRecord, "createdAt"> & { createdAt?: number },
    createdAt: number,
): StoredRecentToolResultRecord {
    const contentProjection = buildRecentToolResultTextProjection(record.content, RECENT_TOOL_RESULT_CONTENT_CHAR_LIMIT);
    const errorProjection = buildRecentToolResultTextProjection(record.error, RECENT_TOOL_RESULT_ERROR_CHAR_LIMIT);
    return {
        toolCallId: String(record.toolCallId ?? "").trim(),
        toolName: String(record.toolName ?? "").trim(),
        success: Boolean(record.success),
        summary: compactRecentToolResultText(record.summary, RECENT_TOOL_RESULT_SUMMARY_CHAR_LIMIT) ?? "",
        ...(contentProjection.full ? { content: contentProjection.full } : {}),
        ...(contentProjection.preview ? { contentPreview: contentProjection.preview } : {}),
        ...(typeof contentProjection.chars === "number" ? { contentChars: contentProjection.chars } : {}),
        ...(contentProjection.truncated ? { contentTruncated: true } : {}),
        ...(errorProjection.full ? { error: errorProjection.full } : {}),
        ...(errorProjection.preview ? { errorPreview: errorProjection.preview } : {}),
        ...(typeof errorProjection.chars === "number" ? { errorChars: errorProjection.chars } : {}),
        ...(errorProjection.truncated ? { errorTruncated: true } : {}),
        failureKind: record.failureKind,
        target: compactRecentToolResultText(record.target, RECENT_TOOL_RESULT_TARGET_CHAR_LIMIT),
        args: normalizeRecentToolResultArgs(record.args),
        createdAt,
        isSynthetic: record.isSynthetic === true ? true : undefined,
    };
}

function normalizeRecentToolResultRecords(records: unknown): StoredRecentToolResultRecord[] | undefined {
    if (!Array.isArray(records)) return undefined;
    const normalized = records
        .map((item) => {
            if (!item || typeof item !== "object") return undefined;
            const record = item as Partial<StoredRecentToolResultRecord>;
            if (typeof record.toolCallId !== "string" || !record.toolCallId.trim()) return undefined;
            if (typeof record.toolName !== "string" || !record.toolName.trim()) return undefined;
            if (typeof record.summary !== "string") return undefined;
            const createdAt = typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
                ? Math.max(0, Math.floor(record.createdAt))
                : Date.now();
            return normalizeRecentToolResultRecord({
                toolCallId: record.toolCallId,
                toolName: record.toolName,
                success: Boolean(record.success),
                summary: record.summary,
                content: record.content,
                contentPreview: record.contentPreview,
                contentChars: record.contentChars,
                contentTruncated: record.contentTruncated,
                error: record.error,
                errorPreview: record.errorPreview,
                errorChars: record.errorChars,
                errorTruncated: record.errorTruncated,
                failureKind: record.failureKind,
                target: record.target,
                args: record.args,
                isSynthetic: record.isSynthetic,
            }, createdAt);
        })
        .filter((item): item is StoredRecentToolResultRecord => Boolean(item));
    return normalized.length > 0 ? normalized : undefined;
}

function normalizeCarryoverFact(value: unknown): string | undefined {
    const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    if (!text) return undefined;
    return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

function normalizeCarryoverTitle(value: unknown): string {
    const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    if (!text) return "";
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function normalizeCarryoverSummary(value: unknown): string {
    const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    if (!text) return "";
    return text.length > 800 ? `${text.slice(0, 797)}...` : text;
}

function normalizeCarryoverSourceType(value: unknown): CarryoverContextSourceType {
    switch (value) {
        case "file_read":
        case "conversation_read":
        case "tool_result":
        case "log_read":
        case "web_result":
        case "attachment":
            return value;
        default:
            return "other";
    }
}

function normalizeCarryoverContextRecord(record: Partial<CarryoverContextRecord> | undefined): CarryoverContextRecord | undefined {
    if (!record) return undefined;
    const sourceKey = typeof record.sourceKey === "string" ? record.sourceKey.trim() : "";
    const title = normalizeCarryoverTitle(record.title);
    const summary = normalizeCarryoverSummary(record.summary);
    if (!sourceKey || !title || !summary) {
        return undefined;
    }

    const keyFacts = Array.isArray(record.keyFacts)
        ? record.keyFacts
            .map((item) => normalizeCarryoverFact(item))
            .filter((item): item is string => Boolean(item))
            .slice(0, 8)
        : [];
    const tokenEstimateRaw = typeof record.tokenEstimate === "number" && Number.isFinite(record.tokenEstimate)
        ? Math.max(0, Math.floor(record.tokenEstimate))
        : estimateTokens([summary, ...keyFacts].join("\n"));
    const lastUsedAt = typeof record.lastUsedAt === "number" && Number.isFinite(record.lastUsedAt)
        ? Math.max(0, Math.floor(record.lastUsedAt))
        : Date.now();
    const priority = typeof record.priority === "number" && Number.isFinite(record.priority)
        ? Math.max(0, Math.floor(record.priority))
        : 0;

    return {
        sourceType: normalizeCarryoverSourceType(record.sourceType),
        sourceKey,
        title,
        summary,
        keyFacts,
        tokenEstimate: tokenEstimateRaw,
        lastUsedAt,
        priority,
    };
}

function normalizeCarryoverContextRecords(records: unknown): CarryoverContextRecord[] | undefined {
    if (!Array.isArray(records)) return undefined;
    const normalized = records
        .map((item) => {
            if (!item || typeof item !== "object") return undefined;
            return normalizeCarryoverContextRecord(item as Partial<CarryoverContextRecord>);
        })
        .filter((item): item is CarryoverContextRecord => Boolean(item));
    return normalized.length > 0 ? normalized : undefined;
}

function mergeCarryoverContextRecord(
    existing: CarryoverContextRecord,
    incoming: CarryoverContextRecord,
): CarryoverContextRecord {
    const incomingFacts = incoming.keyFacts;
    const mergedFacts = [
        ...incomingFacts,
        ...(incomingFacts.length > 0 ? [] : existing.keyFacts),
    ].filter((item, index, array) => array.indexOf(item) === index).slice(0, 8);
    return {
        ...existing,
        ...incoming,
        keyFacts: mergedFacts,
        priority: Math.max(existing.priority, incoming.priority),
        lastUsedAt: Math.max(existing.lastUsedAt, incoming.lastUsedAt),
        tokenEstimate: estimateTokens([incoming.summary, ...mergedFacts].join("\n")),
    };
}

function tokenizeCarryoverQuery(value: string): string[] {
    return Array.from(new Set(
        value
            .toLowerCase()
            .split(/[^a-z0-9_./:-]+/i)
            .map((item) => item.trim())
            .filter((item) => item.length >= 2),
    ));
}

function computeCarryoverRelevanceScore(record: CarryoverContextRecord, queryTokens: string[]): number {
    if (queryTokens.length === 0) {
        return 0;
    }
    const haystack = [
        record.sourceKey,
        record.title,
        record.summary,
        ...record.keyFacts,
    ].join("\n").toLowerCase();
    let score = 0;
    for (const token of queryTokens) {
        if (!haystack.includes(token)) {
            continue;
        }
        score += 1;
        if (record.sourceKey.toLowerCase().includes(token)) score += 3;
        if (record.title.toLowerCase().includes(token)) score += 2;
        if (record.summary.toLowerCase().includes(token)) score += 1;
    }
    return score;
}

function computeCarryoverRecencyPenalty(record: CarryoverContextRecord, now: number): number {
    const ageMs = Math.max(0, now - record.lastUsedAt);
    const ageHours = ageMs / (60 * 60 * 1000);
    if (ageHours < 6) return 0;
    if (ageHours < 24) return 1;
    if (ageHours < 72) return 2;
    return 3;
}

function computeCarryoverSourceTypeBoost(sourceType: CarryoverContextSourceType): number {
    switch (sourceType) {
        case "file_read":
            return 2;
        case "conversation_read":
        case "log_read":
            return 1;
        case "web_result":
            return 0;
        case "tool_result":
            return -1;
        default:
            return 0;
    }
}

function normalizeString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => typeof item === "string" ? item.trim() : "")
        .filter(Boolean);
}

function truncateSummaryText(value: string, limit: number = SESSION_MEMORY_SUMMARY_CHAR_LIMIT): string {
    if (value.length <= limit) return value;
    return `${value.slice(0, Math.max(0, limit - 24))}\n...[session memory truncated]`;
}

function renderSessionMemorySummary(memory: Omit<StoredSessionMemory, "lastSummarizedMessageCount" | "lastSummarizedMessageId" | "lastSummarizedToolCursor" | "updatedAt">): string {
    const lines: string[] = [];
    if (memory.currentGoal) lines.push(`Current Goal: ${memory.currentGoal}`);
    if (memory.currentWork) lines.push(`Current Work: ${memory.currentWork}`);
    if (memory.nextStep) lines.push(`Next Step: ${memory.nextStep}`);
    if (memory.keyResults.length > 0) {
        lines.push("Key Results:");
        for (const item of memory.keyResults) lines.push(`- ${item}`);
    }
    if (memory.decisions.length > 0) {
        lines.push("Decisions:");
        for (const item of memory.decisions) lines.push(`- ${item}`);
    }
    if (memory.pendingTasks.length > 0) {
        lines.push("Pending Tasks:");
        for (const item of memory.pendingTasks) lines.push(`- ${item}`);
    }
    if (memory.filesTouched.length > 0) {
        lines.push("Files Touched:");
        for (const item of memory.filesTouched) lines.push(`- ${item}`);
    }
    if (memory.errorsAndFixes.length > 0) {
        lines.push("Errors & Fixes:");
        for (const item of memory.errorsAndFixes) lines.push(`- ${item}`);
    }
    return truncateSummaryText(lines.join("\n").trim());
}

function coerceConversationText(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }
    if (Array.isArray(value)) {
        return value
            .map((item) => coerceConversationText(item))
            .filter((item) => item.length > 0)
            .join("");
    }
    if (!value || typeof value !== "object") {
        return "";
    }
    const record = value as Record<string, unknown>;
    for (const key of ["text", "content", "summary", "output_text", "reasoning_content", "value"]) {
        const extracted = coerceConversationText(record[key]);
        if (extracted) {
            return extracted;
        }
    }
    for (const key of ["parts", "items", "segments"]) {
        const extracted = coerceConversationText(record[key]);
        if (extracted) {
            return extracted;
        }
    }
    return "";
}

function coerceStoredSessionMemory(value: Partial<StoredSessionMemory> | undefined): StoredSessionMemory {
    const base = createEmptySessionMemory();
    if (!value) return base;

    const normalized: StoredSessionMemory = {
        summary: normalizeString(value.summary),
        currentGoal: normalizeString(value.currentGoal),
        decisions: normalizeStringArray(value.decisions),
        keyResults: normalizeStringArray(value.keyResults),
        filesTouched: normalizeStringArray(value.filesTouched),
        errorsAndFixes: normalizeStringArray(value.errorsAndFixes),
        pendingTasks: normalizeStringArray(value.pendingTasks),
        currentWork: normalizeString(value.currentWork),
        nextStep: normalizeString(value.nextStep),
        lastSummarizedMessageCount: typeof value.lastSummarizedMessageCount === "number" && Number.isFinite(value.lastSummarizedMessageCount)
            ? Math.max(0, Math.floor(value.lastSummarizedMessageCount))
            : 0,
        lastSummarizedMessageId: normalizeString(value.lastSummarizedMessageId),
        lastSummarizedToolCursor: typeof value.lastSummarizedToolCursor === "number" && Number.isFinite(value.lastSummarizedToolCursor)
            ? Math.max(0, Math.floor(value.lastSummarizedToolCursor))
            : 0,
        updatedAt: typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
            ? Math.max(0, Math.floor(value.updatedAt))
            : 0,
    };

    normalized.summary = truncateSummaryText(
        normalized.summary || renderSessionMemorySummary(normalized),
    );

    return normalized;
}

function buildSessionMemoryPrompt(
    existing: SessionMemoryRecord | undefined,
    newMessages: ConversationHistoryView,
    newToolDigests: ToolDigestRecord[],
): string {
    const conversationText = newMessages
        .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
        .join("\n\n");
    const toolDigestText = newToolDigests
        .map((item) => {
            const parts = [
                `tool=${item.toolName}`,
                `success=${item.success ? "yes" : "no"}`,
            ];
            if (item.target) parts.push(`target=${item.target}`);
            if (item.keyResult) parts.push(`result=${item.keyResult}`);
            if (item.errorSummary) parts.push(`error=${item.errorSummary}`);
            return `- ${parts.join(" | ")}`;
        })
        .join("\n");

    return [
        "You maintain a persistent session memory for a coding assistant conversation.",
        "Update the session memory using the new conversation messages.",
        "Focus on concrete outcomes instead of broad topic descriptions.",
        "",
        existing
            ? "## Existing Session Memory\n" + JSON.stringify({
                summary: existing.summary,
                currentGoal: existing.currentGoal,
                decisions: existing.decisions,
                keyResults: existing.keyResults,
                filesTouched: existing.filesTouched,
                errorsAndFixes: existing.errorsAndFixes,
                pendingTasks: existing.pendingTasks,
                currentWork: existing.currentWork,
                nextStep: existing.nextStep,
            }, null, 2)
            : "## Existing Session Memory\n{}",
        "",
        "## New Conversation Messages",
        conversationText || "(no new messages)",
        "",
        "## New Tool Digests",
        toolDigestText || "(no new tool digests)",
        "",
        "## Output Format",
        "Return ONLY valid JSON with the following shape:",
        JSON.stringify({
            summary: "brief but concrete session summary",
            currentGoal: "current main goal",
            decisions: ["decision and why it matters"],
            keyResults: ["completed result or conclusion"],
            filesTouched: ["important file or module"],
            errorsAndFixes: ["error and fix"],
            pendingTasks: ["remaining task"],
            currentWork: "what the assistant is currently doing",
            nextStep: "most likely next action",
        }, null, 2),
        "",
        "Rules:",
        "- Prefer conclusions, decisions, fixes, and current state.",
        "- If a field has no useful content, return an empty string or empty array.",
        "- Do not mention that this is a summary.",
        "- Keep summary concise and implementation-focused.",
    ].join("\n");
}

function extractJsonObject(text: string): string | undefined {
    const trimmed = text.trim();
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const candidate = fencedMatch?.[1]?.trim() || trimmed;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) return undefined;
    return candidate.slice(start, end + 1);
}

function parseSessionMemoryResponse(raw: string): Partial<StoredSessionMemory> | undefined {
    const jsonText = extractJsonObject(raw);
    if (!jsonText) return undefined;
    try {
        return JSON.parse(jsonText) as Partial<StoredSessionMemory>;
    } catch {
        return undefined;
    }
}

function buildFallbackSessionMemory(
    existing: StoredSessionMemory,
    newMessages: ConversationHistoryView,
    newToolDigests: ToolDigestRecord[],
    totalMessageCount: number,
    totalToolDigestCount: number,
    lastSummarizedMessageId?: string,
): StoredSessionMemory {
    const updated = { ...existing };
    const snippets = newMessages.map((message) => {
        const prefix = message.role === "user" ? "User" : "Assistant";
        const content = message.content.length > 220
            ? `${message.content.slice(0, 220)}...`
            : message.content;
        return `${prefix}: ${content}`;
    });
    const toolLines = newToolDigests.map((digest) => {
        const parts = [`Tool ${digest.toolName}`, digest.success ? "success" : "failed"];
        if (digest.target) parts.push(`target=${digest.target}`);
        if (digest.keyResult) parts.push(`result=${digest.keyResult}`);
        if (digest.errorSummary) parts.push(`error=${digest.errorSummary}`);
        return parts.join(" | ");
    });
    const recentSummary = [...snippets, ...toolLines].filter(Boolean).join("\n");
    updated.summary = truncateSummaryText(
        existing.summary
            ? `${existing.summary}\n\nRecent Updates:\n${recentSummary}`
            : recentSummary,
    );

    const latestUser = [...newMessages].reverse().find((message) => message.role === "user");
    const latestAssistant = [...newMessages].reverse().find((message) => message.role === "assistant");
    if (!updated.currentGoal && latestUser) {
        updated.currentGoal = latestUser.content.slice(0, 200);
    }
    if (latestAssistant) {
        updated.currentWork = latestAssistant.content.slice(0, 200);
    } else if (latestUser) {
        updated.currentWork = latestUser.content.slice(0, 200);
    }
    updated.lastSummarizedMessageCount = totalMessageCount;
    updated.lastSummarizedMessageId = normalizeString(lastSummarizedMessageId);
    updated.lastSummarizedToolCursor = totalToolDigestCount;
    updated.updatedAt = Date.now();
    return coerceStoredSessionMemory(updated);
}

/**
 * 会话存储
 * 用于管理对话上下文历史，支持文件持久化 (JSONL)
 */
export class ConversationStore {
    private conversations = new Map<string, Conversation>();
    private compactionStates = new Map<string, CompactionState>();
    private sessionDigestStates = new Map<string, SessionDigestState>();
    private sessionMemories = new Map<string, StoredSessionMemory>();
    private readonly lifecycle = new ConversationLifecycleCoordinator();
    private readonly maxHistory: number;
    private readonly ttlSeconds: number;
    private readonly dataDir?: string;
    private readonly dataDirCapability?: FilesystemCapability;
    private readonly compactionOpts?: CompactionOptions;
    private readonly summarizer?: SummarizerFn;
    private readonly summarizerModelName?: string;
    private readonly compactionRuntimeTracker?: CompactionRuntimeTracker;
    private readonly onBeforeCompaction?: ConversationStoreOptions["onBeforeCompaction"];
    private readonly onAfterCompaction?: ConversationStoreOptions["onAfterCompaction"];

    constructor(options: ConversationStoreOptions = {}) {
        this.maxHistory = options.maxHistory ?? 20;
        this.ttlSeconds = options.ttlSeconds ?? 3600;
        this.dataDir = options.dataDir;
        this.compactionOpts = options.compaction;
        this.summarizer = options.summarizer;
        this.summarizerModelName = options.summarizerModelName;
        this.compactionRuntimeTracker = options.compactionRuntimeTracker;
        this.onBeforeCompaction = options.onBeforeCompaction;
        this.onAfterCompaction = options.onAfterCompaction;

        if (this.dataDir) {
            fs.mkdirSync(this.dataDir, { recursive: true });
            this.dataDirCapability = new FilesystemCapability({
                rootPath: this.dataDir,
                label: "conversation data directory",
            });
        }
    }

    private buildCompactionHookContext(id: string, conversation?: Conversation): HookAgentContext {
        return {
            agentId: conversation?.agentId,
            sessionKey: id,
        };
    }

    private async emitBeforeCompaction(id: string, event: BeforeCompactionEvent, conversation?: Conversation): Promise<void> {
        await this.onBeforeCompaction?.(event, this.buildCompactionHookContext(id, conversation));
    }

    private async emitAfterCompaction(id: string, event: AfterCompactionEvent, conversation?: Conversation): Promise<void> {
        await this.onAfterCompaction?.(event, this.buildCompactionHookContext(id, conversation));
    }

    /**
     * 获取会话
     * 优先从内存获取，若无则尝试从文件加载
     */
    get(id: string): Conversation | undefined {
        const cached = this.conversations.get(id);
        if (cached) {
            const validatedCached = this.cacheAndValidateConversation(id, cached);
            if (validatedCached) {
                return validatedCached;
            }
        }

        if (this.dataDir && this.isDataDirAvailable()) {
            const restored = this.loadFromFile(id);
            return this.cacheAndValidateConversation(id, restored, { allowExpiredPersistedConversation: true });
        }

        return undefined;
    }

    /**
     * 从文件加载会话
     */
    private loadFromFile(id: string): Conversation | undefined {
        if (!this.dataDir) return undefined;
        const filePath = this.getExistingConversationFilePath(id, ".jsonl");
        const meta = this.loadMetaFromFile(id);
        if (!filePath || !fs.existsSync(filePath)) {
            if (!meta) return undefined;
            return {
                id,
                agentId: meta.agentId,
                channel: meta.channel,
                messages: [],
                createdAt: meta.createdAt ?? Date.now(),
                updatedAt: meta.updatedAt ?? Date.now(),
                activeCounters: meta.activeCounters,
                taskTokenRecords: meta.taskTokenRecords,
                toolDigests: meta.toolDigests,
                recentToolResults: meta.recentToolResults,
                carryoverContext: meta.carryoverContext,
                loadedToolNames: meta.loadedToolNames,
                compactBoundaries: meta.compactBoundaries,
                partialCompactionView: meta.partialCompactionView,
                planState: meta.planState,
            };
        }

        try {
            const content = fs.readFileSync(filePath, "utf-8");
            const lines = content.split("\n").filter(line => line.trim());
            const messages: ConversationMessage[] = [];
            let createdAt = Date.now();
            let updatedAt = 0;
            let recoveredAgentId = meta?.agentId;

            for (const line of lines) {
                try {
                    const msg = JSON.parse(line) as ConversationMessage;
                    if (msg.role && msg.content) {
                        msg.id = ensureConversationMessageId(msg, messages.length);
                        // agentId 为可选字段，旧 JSONL 中不存在时保持 undefined
                        messages.push(msg);
                        if (!recoveredAgentId && msg.agentId) recoveredAgentId = msg.agentId;
                        if (msg.timestamp > updatedAt) updatedAt = msg.timestamp;
                        if (msg.timestamp < createdAt) createdAt = msg.timestamp;
                    }
                } catch {
                    // ignore invalid lines
                }
            }

            if (messages.length === 0) {
                if (!meta?.activeCounters && !meta?.taskTokenRecords && !meta?.recentToolResults?.length && !meta?.carryoverContext?.length && !meta?.loadedToolNames?.length && !meta?.planState) {
                    return undefined;
                }
                return {
                    id,
                    agentId: meta?.agentId,
                    channel: meta?.channel,
                    messages: [],
                    createdAt: meta?.createdAt ?? createdAt,
                    updatedAt: meta?.updatedAt ?? Date.now(),
                    activeCounters: meta?.activeCounters,
                    taskTokenRecords: meta?.taskTokenRecords,
                    toolDigests: meta?.toolDigests,
                    recentToolResults: meta?.recentToolResults,
                    carryoverContext: meta?.carryoverContext,
                    loadedToolNames: meta?.loadedToolNames,
                    compactBoundaries: meta?.compactBoundaries,
                    partialCompactionView: meta?.partialCompactionView,
                    planState: meta?.planState,
                };
            }

            // 应用 maxHistory 限制 (加载时也裁剪)
            const finalMessages = messages.length > this.maxHistory
                ? messages.slice(messages.length - this.maxHistory)
                : messages;

            return {
                id,
                agentId: recoveredAgentId,
                channel: meta?.channel,
                messages: finalMessages,
                createdAt: meta?.createdAt ?? createdAt,
                updatedAt: Math.max(meta?.updatedAt ?? 0, updatedAt || Date.now()),
                activeCounters: meta?.activeCounters,
                taskTokenRecords: meta?.taskTokenRecords,
                toolDigests: meta?.toolDigests,
                recentToolResults: meta?.recentToolResults,
                carryoverContext: meta?.carryoverContext,
                loadedToolNames: meta?.loadedToolNames,
                compactBoundaries: meta?.compactBoundaries,
                partialCompactionView: meta?.partialCompactionView,
                planState: meta?.planState,
            };
        } catch (err) {
            console.error(`Failed to load conversation ${id}:`, err);
            return undefined;
        }
    }

    private async getAsync(
        id: string,
        generation: ConversationLifecycleGeneration = this.lifecycle.captureGeneration(id),
    ): Promise<Conversation | undefined> {
        const cached = this.conversations.get(id);
        if (cached) {
            const validatedCached = this.cacheAndValidateConversation(id, cached);
            if (validatedCached) {
                return validatedCached;
            }
        }
        if (this.dataDir && this.isDataDirAvailable()) {
            const restored = await this.loadFromFileAsync(id);
            if (!this.lifecycle.isGenerationCurrent(id, generation)) {
                return restored;
            }
            return this.cacheAndValidateConversation(id, restored, { allowExpiredPersistedConversation: true });
        }
        return undefined;
    }

    private cacheAndValidateConversation(
        id: string,
        conv: Conversation | undefined,
        options: {
            allowExpiredPersistedConversation?: boolean;
        } = {},
    ): Conversation | undefined {
        if (!conv) return undefined;

        const now = Date.now();
        if (now - conv.updatedAt > this.ttlSeconds * 1000) {
            this.conversations.delete(id);
            if (options.allowExpiredPersistedConversation === true) {
                return conv;
            }
            return undefined;
        }

        if (!this.conversations.has(id)) {
            this.conversations.set(id, conv);
        }

        return conv;
    }

    private async loadFromFileAsync(id: string): Promise<Conversation | undefined> {
        if (!this.dataDir) return undefined;
        const meta = await this.loadMetaFromFileAsync(id);
        let lines: string[] | undefined;
        for (const filePath of this.getConversationFilePathCandidates(id, ".jsonl")) {
            try {
                if (meta) {
                    lines = (await readBoundedTailLines(filePath, { maxLines: this.maxHistory })).lines;
                } else {
                    const content = await conversationAsyncFs.readFile(filePath, "utf-8");
                    lines = content.split("\n").filter((line) => line.trim());
                }
                break;
            } catch (err) {
                const fsErr = err as NodeJS.ErrnoException;
                if (fsErr.code === "ENOENT") {
                    continue;
                }
                console.error(`Failed to load conversation ${id}:`, err);
                return undefined;
            }
        }

        if (typeof lines === "undefined") {
            if (!meta) return undefined;
            return {
                id,
                agentId: meta.agentId,
                channel: meta.channel,
                messages: [],
                createdAt: meta.createdAt ?? Date.now(),
                updatedAt: meta.updatedAt ?? Date.now(),
                activeCounters: meta.activeCounters,
                taskTokenRecords: meta.taskTokenRecords,
                toolDigests: meta.toolDigests,
                recentToolResults: meta.recentToolResults,
                carryoverContext: meta.carryoverContext,
                loadedToolNames: meta.loadedToolNames,
                compactBoundaries: meta.compactBoundaries,
                partialCompactionView: meta.partialCompactionView,
                planState: meta.planState,
            };
        }

        try {
            const messages: ConversationMessage[] = [];
            let createdAt = Date.now();
            let updatedAt = 0;
            let recoveredAgentId = meta?.agentId;

            for (const line of lines) {
                try {
                    const msg = JSON.parse(line) as ConversationMessage;
                    if (msg.role && msg.content) {
                        msg.id = ensureConversationMessageId(msg, messages.length);
                        messages.push(msg);
                        if (!recoveredAgentId && msg.agentId) recoveredAgentId = msg.agentId;
                        if (msg.timestamp > updatedAt) updatedAt = msg.timestamp;
                        if (msg.timestamp < createdAt) createdAt = msg.timestamp;
                    }
                } catch {
                    // ignore invalid lines
                }
            }

            if (messages.length === 0) {
                if (!meta?.activeCounters && !meta?.taskTokenRecords && !meta?.recentToolResults?.length && !meta?.carryoverContext?.length && !meta?.loadedToolNames?.length && !meta?.planState) {
                    return undefined;
                }
                return {
                    id,
                    agentId: meta?.agentId,
                    channel: meta?.channel,
                    messages: [],
                    createdAt: meta?.createdAt ?? createdAt,
                    updatedAt: meta?.updatedAt ?? Date.now(),
                    activeCounters: meta?.activeCounters,
                    taskTokenRecords: meta?.taskTokenRecords,
                    toolDigests: meta?.toolDigests,
                    recentToolResults: meta?.recentToolResults,
                    carryoverContext: meta?.carryoverContext,
                    loadedToolNames: meta?.loadedToolNames,
                    compactBoundaries: meta?.compactBoundaries,
                    partialCompactionView: meta?.partialCompactionView,
                    planState: meta?.planState,
                };
            }

            const finalMessages = messages.length > this.maxHistory
                ? messages.slice(messages.length - this.maxHistory)
                : messages;

            return {
                id,
                agentId: recoveredAgentId,
                channel: meta?.channel,
                messages: finalMessages,
                createdAt: meta?.createdAt ?? createdAt,
                updatedAt: Math.max(meta?.updatedAt ?? 0, updatedAt || Date.now()),
                activeCounters: meta?.activeCounters,
                taskTokenRecords: meta?.taskTokenRecords,
                toolDigests: meta?.toolDigests,
                recentToolResults: meta?.recentToolResults,
                carryoverContext: meta?.carryoverContext,
                loadedToolNames: meta?.loadedToolNames,
                compactBoundaries: meta?.compactBoundaries,
                partialCompactionView: meta?.partialCompactionView,
                planState: meta?.planState,
            };
        } catch (err) {
            console.error(`Failed to load conversation ${id}:`, err);
            return undefined;
        }
    }

    private getMetaFilePath(id: string): string | undefined {
        return this.getConversationFilePath(id, ".meta.json");
    }

    private getSessionTranscriptFilePath(id: string): string | undefined {
        return this.getConversationFilePath(id, ".transcript.jsonl");
    }

    private getConversationFilePath(id: string, suffix: string): string | undefined {
        if (!this.dataDirCapability || !this.isDataDirAvailable()) return undefined;
        const safeId = this.toSafeConversationFileId(id);
        try {
            return this.dataDirCapability.resolveForWriteRelative(
                `${safeId}${suffix}`,
                "conversation artifact",
            );
        } catch (error) {
            // teardown 或外部清理可发生在可用性检查之后；目录已消失时跳过持久化，不向父目录降级。
            if (!this.isDataDirAvailable()) return undefined;
            throw error;
        }
    }

    private getExistingConversationFilePath(id: string, suffix: string): string | undefined {
        const candidates = this.getConversationFilePathCandidates(id, suffix);
        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
        return candidates[0];
    }

    private getConversationFilePathCandidates(id: string, suffix: string): string[] {
        if (!this.dataDirCapability || !this.isDataDirAvailable()) return [];
        const primary = this.getConversationFilePath(id, suffix);
        if (!primary) return [];

        try {
            // legacy 名称仅在它本身是一个安全的单文件名时才参与 fallback，绝不由外部 id 构造裸路径。
            const legacy = this.dataDirCapability.resolveForWriteRelative(
                `${id}${suffix}`,
                "legacy conversation artifact",
            );
            return primary === legacy ? [primary] : [primary, legacy];
        } catch {
            return [primary];
        }
    }

    private isDataDirAvailable(): boolean {
        return Boolean(this.dataDir && fs.existsSync(this.dataDir));
    }

    private toSafeConversationFileId(id: string): string {
        const encodeChar = (char: string): string => {
            const codePoint = char.codePointAt(0);
            if (typeof codePoint !== "number") return "_";
            return `%${codePoint.toString(16).toUpperCase().padStart(2, "0")}`;
        };

        let safeId = id.replace(INVALID_CONVERSATION_FILENAME_CHARS, encodeChar);
        safeId = safeId.replace(TRAILING_CONVERSATION_FILENAME_CHARS, (match) => Array.from(match).map(encodeChar).join(""));

        if (!safeId) {
            safeId = "_";
        }

        const windowsBasename = safeId.split(".")[0] ?? safeId;
        if (RESERVED_WINDOWS_BASENAME.test(windowsBasename)) {
            safeId = `_${safeId}`;
        }

        return safeId;
    }

    private loadMetaFromFile(id: string): ConversationMetaSnapshot | undefined {
        for (const filePath of this.getConversationFilePathCandidates(id, ".meta.json")) {
            if (!fs.existsSync(filePath)) continue;

            try {
                const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
                    conversationId?: string;
                    agentId?: string;
                    channel?: string;
                    activeCounters?: ActiveCounterSnapshot[];
                    taskTokenRecords?: TaskTokenRecord[];
                    toolDigests?: ToolDigestRecord[];
                    recentToolResults?: StoredRecentToolResultRecord[];
                    carryoverContext?: CarryoverContextRecord[];
                    loadedToolNames?: string[];
                    compactBoundaries?: CompactBoundaryRecord[];
                    partialCompactionView?: PartialCompactionViewRecord;
                    planState?: ConversationPlanState;
                    createdAt?: number;
                    updatedAt?: number;
                };
                const hasMeta =
                    typeof parsed.agentId === "string"
                    || typeof parsed.channel === "string"
                    || Array.isArray(parsed.activeCounters)
                    || Array.isArray(parsed.taskTokenRecords)
                    || Array.isArray(parsed.toolDigests)
                    || Array.isArray(parsed.recentToolResults)
                    || Array.isArray(parsed.carryoverContext)
                    || Array.isArray(parsed.loadedToolNames)
                    || Array.isArray(parsed.compactBoundaries)
                    || typeof parsed.partialCompactionView === "object"
                    || typeof parsed.planState === "object"
                    || typeof parsed.createdAt === "number"
                    || typeof parsed.updatedAt === "number";
                if (!hasMeta) return undefined;
                return {
                    conversationId: typeof parsed.conversationId === "string" ? parsed.conversationId : undefined,
                    agentId: typeof parsed.agentId === "string" ? parsed.agentId : undefined,
                    channel: typeof parsed.channel === "string" ? parsed.channel : undefined,
                    activeCounters: Array.isArray(parsed.activeCounters) ? parsed.activeCounters : undefined,
                    taskTokenRecords: Array.isArray(parsed.taskTokenRecords) ? parsed.taskTokenRecords : undefined,
                    toolDigests: Array.isArray(parsed.toolDigests) ? parsed.toolDigests : undefined,
                    recentToolResults: normalizeRecentToolResultRecords(parsed.recentToolResults),
                    carryoverContext: normalizeCarryoverContextRecords(parsed.carryoverContext),
                    loadedToolNames: Array.isArray(parsed.loadedToolNames)
                        ? parsed.loadedToolNames.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
                        : undefined,
                    compactBoundaries: Array.isArray(parsed.compactBoundaries) ? parsed.compactBoundaries : undefined,
                    partialCompactionView: typeof parsed.partialCompactionView === "object" ? parsed.partialCompactionView : undefined,
                    planState: normalizeConversationPlanState(parsed.planState),
                    createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : undefined,
                    updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : undefined,
                };
            } catch {
                continue;
            }
        }

        return undefined;
    }

    private async loadMetaFromFileAsync(id: string): Promise<ConversationMetaSnapshot | undefined> {
        for (const filePath of this.getConversationFilePathCandidates(id, ".meta.json")) {
            try {
                const raw = await conversationAsyncFs.readFile(filePath, "utf-8");
                const parsed = JSON.parse(raw) as {
                    conversationId?: string;
                    agentId?: string;
                    channel?: string;
                    activeCounters?: ActiveCounterSnapshot[];
                    taskTokenRecords?: TaskTokenRecord[];
                    toolDigests?: ToolDigestRecord[];
                    recentToolResults?: StoredRecentToolResultRecord[];
                    carryoverContext?: CarryoverContextRecord[];
                    loadedToolNames?: string[];
                    compactBoundaries?: CompactBoundaryRecord[];
                    partialCompactionView?: PartialCompactionViewRecord;
                    planState?: ConversationPlanState;
                    createdAt?: number;
                    updatedAt?: number;
                };
                const hasMeta =
                    typeof parsed.agentId === "string"
                    || typeof parsed.channel === "string"
                    || Array.isArray(parsed.activeCounters)
                    || Array.isArray(parsed.taskTokenRecords)
                    || Array.isArray(parsed.toolDigests)
                    || Array.isArray(parsed.recentToolResults)
                    || Array.isArray(parsed.carryoverContext)
                    || Array.isArray(parsed.loadedToolNames)
                    || Array.isArray(parsed.compactBoundaries)
                    || typeof parsed.partialCompactionView === "object"
                    || typeof parsed.planState === "object"
                    || typeof parsed.createdAt === "number"
                    || typeof parsed.updatedAt === "number";
                if (!hasMeta) return undefined;
                return {
                    conversationId: typeof parsed.conversationId === "string" ? parsed.conversationId : undefined,
                    agentId: typeof parsed.agentId === "string" ? parsed.agentId : undefined,
                    channel: typeof parsed.channel === "string" ? parsed.channel : undefined,
                    activeCounters: Array.isArray(parsed.activeCounters) ? parsed.activeCounters : undefined,
                    taskTokenRecords: Array.isArray(parsed.taskTokenRecords) ? parsed.taskTokenRecords : undefined,
                    toolDigests: Array.isArray(parsed.toolDigests) ? parsed.toolDigests : undefined,
                    recentToolResults: normalizeRecentToolResultRecords(parsed.recentToolResults),
                    carryoverContext: normalizeCarryoverContextRecords(parsed.carryoverContext),
                    loadedToolNames: Array.isArray(parsed.loadedToolNames)
                        ? parsed.loadedToolNames.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
                        : undefined,
                    compactBoundaries: Array.isArray(parsed.compactBoundaries) ? parsed.compactBoundaries : undefined,
                    partialCompactionView: typeof parsed.partialCompactionView === "object" ? parsed.partialCompactionView : undefined,
                    planState: normalizeConversationPlanState(parsed.planState),
                    createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : undefined,
                    updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : undefined,
                };
            } catch (err) {
                const fsErr = err as NodeJS.ErrnoException;
                if (fsErr.code === "ENOENT") {
                    continue;
                }
            }
        }

        return undefined;
    }

    private persistConversationMeta(id: string, conv: Conversation): void {
        const filePath = this.getMetaFilePath(id);
        if (!filePath) return;

        const payload = {
            conversationId: id,
            agentId: conv.agentId,
            channel: conv.channel,
            activeCounters: conv.activeCounters,
            taskTokenRecords: conv.taskTokenRecords,
            toolDigests: conv.toolDigests,
            recentToolResults: conv.recentToolResults,
            carryoverContext: conv.carryoverContext,
            loadedToolNames: conv.loadedToolNames,
            compactBoundaries: conv.compactBoundaries,
            partialCompactionView: conv.partialCompactionView,
            planState: conv.planState,
            createdAt: conv.createdAt,
            updatedAt: conv.updatedAt,
        };
        if (
            !payload.agentId
            && !payload.channel
            && !payload.activeCounters
            && !payload.taskTokenRecords
            && !payload.toolDigests
            && !payload.recentToolResults?.length
            && !payload.carryoverContext?.length
            && !payload.loadedToolNames?.length
            && !payload.compactBoundaries
            && !payload.partialCompactionView
            && !payload.planState
        ) {
            if (fs.existsSync(filePath)) {
                try {
                    fs.unlinkSync(filePath);
                } catch (err) {
                    const fsErr = err as NodeJS.ErrnoException;
                    if (fsErr.code !== "ENOENT") {
                        console.error(`Failed to delete conversation meta for ${id}:`, err);
                    }
                }
            }
            return;
        }

        const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        try {
            fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf-8");
            fs.renameSync(tempPath, filePath);
        } catch (err) {
            try {
                if (fs.existsSync(tempPath)) {
                    fs.unlinkSync(tempPath);
                }
            } catch {
                // ignore temp cleanup failure
            }
            console.error(`Failed to save conversation meta for ${id}:`, err);
        }
    }

    /**
     * 添加消息到会话
     * 如果会话不存在会自动创建
     */
    addMessage(
        id: string,
        role: "user" | "assistant",
        content: string,
        opts?: { agentId?: string; channel?: string; timestampMs?: number; clientContext?: ConversationMessage["clientContext"] },
    ): ConversationMessage {
        let conv = this.get(id); // get() now handles loadFromFile
        const now = typeof opts?.timestampMs === "number" && Number.isFinite(opts.timestampMs)
            ? Math.max(0, Math.floor(opts.timestampMs))
            : Date.now();
        let headerChanged = false;

        if (!conv) {
            conv = {
                id,
                agentId: opts?.agentId,
                channel: opts?.channel,
                messages: [],
                createdAt: now,
                updatedAt: now,
            };
            this.conversations.set(id, conv);
            headerChanged = Boolean(conv.agentId || conv.channel);
        } else {
            // 更新会话级元数据（如果首次设置）
            if (opts?.agentId && !conv.agentId) {
                conv.agentId = opts.agentId;
                headerChanged = true;
            }
            if (opts?.channel && !conv.channel) {
                conv.channel = opts.channel;
                headerChanged = true;
            }
        }

        const newMessage: ConversationMessage = {
            id: createConversationMessageId(now),
            role,
            content,
            timestamp: now,
        };
        if (opts?.agentId) newMessage.agentId = opts.agentId;
        if (opts?.clientContext) newMessage.clientContext = opts.clientContext;
        conv.messages.push(newMessage);
        conv.updatedAt = now;

        // 限制内存中的历史长度
        if (conv.messages.length > this.maxHistory) {
            const start = conv.messages.length - this.maxHistory;
            conv.messages = conv.messages.slice(start);
        }

        // 持久化追加
        if (this.dataDir && this.isDataDirAvailable()) {
            if (headerChanged) {
                this.persistConversationMeta(id, conv);
            }
            this.appendToFile(id, newMessage, conv);
        }

        return newMessage;
    }

    /**
     * 追加消息到文件
     */
    private appendToFile(id: string, message: ConversationMessage, conversation?: Conversation): void {
        if (!this.dataDir) return;
        const filePath = this.getExistingConversationFilePath(id, ".jsonl");
        if (!filePath) return;
        const transcriptFilePath = this.getSessionTranscriptFilePath(id);
        const line = JSON.stringify(message) + "\n";
        const transcriptEvent = createSessionTranscriptMessageEvent({
            conversationId: id,
            message: {
                id: message.id,
                role: message.role,
                content: message.content,
                timestamp: message.timestamp,
                agentId: message.agentId,
                clientContext: message.clientContext,
            },
            conversation: {
                agentId: conversation?.agentId,
                channel: conversation?.channel,
            },
            createdAt: message.timestamp,
        });

        // 同一会话串行落盘，避免快速连续 append 在磁盘上的顺序漂移。
        void this.enqueueAppendWrite(id, async () => {
            try {
                await conversationAsyncFs.appendFile(filePath, line, "utf-8");
            } catch (err) {
                if (this.shouldIgnoreAppendError(filePath, err as NodeJS.ErrnoException)) {
                    return;
                }
                console.error(`Failed to append to conversation ${id}:`, err);
            }

            if (!transcriptFilePath) return;
            try {
                await appendSessionTranscriptEvent(transcriptFilePath, transcriptEvent);
            } catch (err) {
                if (this.shouldIgnoreAppendError(transcriptFilePath, err as NodeJS.ErrnoException)) {
                    return;
                }
                console.error(`Failed to append session transcript for ${id}:`, err);
            }
        });
    }

    private shouldIgnoreAppendError(filePath: string, err: NodeJS.ErrnoException): boolean {
        void filePath;
        // appendFile 对不存在的目标文件本来会自动创建；
        // 因此这里出现 ENOENT，本质上就是父目录在异步回调落地前已被清理。
        // 这类情况不会影响当前请求响应和内存态上下文，直接静默，避免测试期 stderr 噪音。
        return err.code === "ENOENT";
    }

    private enqueueAppendWrite(id: string, task: () => Promise<void>): Promise<void> {
        return this.lifecycle.enqueue("append", id, task);
    }

    private async appendTranscriptEvent(id: string, event: SessionTranscriptEvent): Promise<void> {
        const transcriptFilePath = this.getSessionTranscriptFilePath(id);
        if (!transcriptFilePath) return;

        await this.enqueueAppendWrite(id, async () => {
            try {
                await appendSessionTranscriptEvent(transcriptFilePath, event);
            } catch (err) {
                if (this.shouldIgnoreAppendError(transcriptFilePath, err as NodeJS.ErrnoException)) {
                    return;
                }
                console.error(`Failed to append session transcript for ${id}:`, err);
            }
        });
    }

    /**
     * 清除会话
     */
    clear(id: string): void {
        this.conversations.delete(id);
        this.compactionStates.delete(id);
        this.sessionDigestStates.delete(id);
        // 可选：是否删除文件？通常保留作为历史记录
        // if (this.dataDir) {
        //     const filePath = path.join(this.dataDir, `${id}.jsonl`);
        //     if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        // }
    }

    /**
     * 等待会话的四类持久化链完成后释放纯内存状态；canonical 文件保持不变。
     * release 开始时旧 generation 立即失效，避免长异步摘要在清理后重新写回 Map。
     */
    async releaseConversation(id: string): Promise<void> {
        if (!id) return;
        await this.lifecycle.release(id, () => {
            // 无 durable dataDir 时，conversation Map 是唯一 canonical 副本，不能为回收派生状态而丢失。
            if (this.dataDir && this.isDataDirAvailable()) {
                this.conversations.delete(id);
            }
            this.compactionStates.delete(id);
            this.sessionDigestStates.delete(id);
            this.sessionMemories.delete(id);
        });
    }

    /** 仅返回资源水位，不暴露消息、摘要或其它会话正文。 */
    getConversationRuntimeSnapshot(id: string): ConversationRuntimeSnapshot {
        return {
            retainedConversation: this.conversations.has(id),
            retainedCompactionState: this.compactionStates.has(id),
            retainedSessionDigestState: this.sessionDigestStates.has(id),
            retainedSessionMemory: this.sessionMemories.has(id),
            ...this.lifecycle.getSnapshot(id),
        };
    }

    private sanitizeHistoryContent(content: string): string {
        const normalized = coerceConversationText(content);
        return normalized
          .replace(/<audio[^>]*>.*?<\/audio>/gi, "")
          .replace(/\[Audio was generated and played\]/gi, "")
          .replace(/\[Download\]\([^)]*\/generated\/[^)]*\)/gi, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim() || normalized;
    }

    private buildHistoryView(conv?: Conversation): ConversationHistoryView {
        if (!conv) return [];
        return conv.messages.map((m) => ({
            role: m.role,
            content: this.sanitizeHistoryContent(m.content),
        }));
    }

    private buildSessionDigestHistoryView(conv?: Conversation): SessionDigestHistoryView {
        if (!conv) return [];
        return conv.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: this.sanitizeHistoryContent(m.content),
        }));
    }

    private buildCompactBoundaryRecord(
        conversation: Conversation | undefined,
        result: {
            compacted: boolean;
            originalTokens: number;
            compactedTokens: number;
            state: CompactionState;
            tier?: "rolling" | "archival";
            fallbackUsed: boolean;
            rebuildTriggered: boolean;
        },
        trigger: CompactBoundaryRecord["trigger"],
    ): CompactBoundaryRecord | undefined {
        if (!conversation || !result.compacted || conversation.messages.length === 0) {
            return undefined;
        }

        const compactedMessageCount = Math.max(
            0,
            Math.min(conversation.messages.length, result.state.compactedMessageCount),
        );
        const anchorMessage = compactedMessageCount > 0
            ? conversation.messages[compactedMessageCount - 1]
            : undefined;
        const preservedMessages = conversation.messages.slice(compactedMessageCount);
        const createdAt = Date.now();

        return {
            id: createCompactBoundaryId(createdAt),
            trigger,
            createdAt,
            summaryStateVersion: COMPACT_BOUNDARY_STATE_VERSION,
            preCompactTokenCount: result.originalTokens,
            postCompactTokenCount: result.compactedTokens,
            compactedMessageCount,
            tier: result.tier,
            fallbackUsed: result.fallbackUsed,
            rebuildTriggered: result.rebuildTriggered,
            preservedSegment: {
                headMessageId: preservedMessages[0]?.id,
                anchorId: anchorMessage?.id,
                tailMessageId: preservedMessages[preservedMessages.length - 1]?.id,
                preservedMessageCount: preservedMessages.length,
            },
        };
    }

    private buildPartialFromBoundaryRecord(
        conversation: Conversation | undefined,
        pivotIndex: number,
        compactedMessageCount: number,
        result: {
            originalTokens: number;
            compactedTokens: number;
            tier?: "rolling" | "archival";
            fallbackUsed: boolean;
            rebuildTriggered: boolean;
        },
    ): CompactBoundaryRecord | undefined {
        if (!conversation || conversation.messages.length === 0) {
            return undefined;
        }
        const preservedMessages = conversation.messages.slice(0, Math.max(0, pivotIndex + 1));
        const pivotMessage = preservedMessages[preservedMessages.length - 1];
        const createdAt = Date.now();

        return {
            id: createCompactBoundaryId(createdAt),
            trigger: "partial_from",
            createdAt,
            summaryStateVersion: COMPACT_BOUNDARY_STATE_VERSION,
            preCompactTokenCount: result.originalTokens,
            postCompactTokenCount: result.compactedTokens,
            compactedMessageCount: Math.max(0, compactedMessageCount),
            tier: result.tier,
            fallbackUsed: result.fallbackUsed,
            rebuildTriggered: result.rebuildTriggered,
            preservedSegment: {
                headMessageId: preservedMessages[0]?.id,
                anchorId: pivotMessage?.id,
                tailMessageId: pivotMessage?.id,
                preservedMessageCount: preservedMessages.length,
            },
        };
    }

    private async recordCompactBoundary(
        conversationId: string,
        conversation: Conversation | undefined,
        boundary: CompactBoundaryRecord | undefined,
        options: { partialCompactionViewId?: string } = {},
        limit: number = DEFAULT_COMPACT_BOUNDARY_LIMIT,
    ): Promise<CompactBoundaryRecord | undefined> {
        if (!conversation || !boundary) return undefined;
        const existing = conversation.compactBoundaries ?? [];
        conversation.compactBoundaries = [boundary, ...existing].slice(0, Math.max(1, limit));
        conversation.updatedAt = Math.max(conversation.updatedAt, boundary.createdAt);
        if (this.dataDir) {
            this.persistConversationMeta(conversationId, conversation);
        }
        await this.appendTranscriptEvent(conversationId, createSessionTranscriptCompactBoundaryEvent({
            conversationId,
            boundary,
            summaryRef: boundary.trigger === "partial_from"
                ? {
                    kind: "partial_compaction_view",
                    partialCompactionViewId: options.partialCompactionViewId,
                }
                : {
                    kind: "compaction_state",
                },
            createdAt: boundary.createdAt,
        }));
        return boundary;
    }

    private resolvePivotIndex(
        conversation: Conversation | undefined,
        options: { pivotMessageId?: string; pivotIndex?: number },
    ): number {
        const messages = conversation?.messages ?? [];
        if (messages.length === 0) return -1;
        if (typeof options.pivotMessageId === "string" && options.pivotMessageId.trim()) {
            return messages.findIndex((message) => message.id === options.pivotMessageId);
        }
        if (typeof options.pivotIndex === "number" && Number.isFinite(options.pivotIndex)) {
            const pivotIndex = Math.floor(options.pivotIndex);
            if (pivotIndex >= 0 && pivotIndex < messages.length) {
                return pivotIndex;
            }
        }
        return messages.length - 2;
    }

    private clearPartialCompactionView(conversationId: string, conversation: Conversation | undefined): void {
        if (!conversation?.partialCompactionView) return;
        conversation.partialCompactionView = undefined;
        if (this.dataDir) {
            this.persistConversationMeta(conversationId, conversation);
        }
    }

    private buildPartialCompactedHistoryFromView(
        conversation: Conversation | undefined,
        view: PartialCompactionViewRecord | undefined,
    ): ConversationHistoryView | undefined {
        if (!conversation || !view || view.direction !== "from") return undefined;
        const fullHistory = this.buildHistoryView(conversation);
        const pivotCount = Math.max(0, Math.min(fullHistory.length, view.pivotMessageCount));
        const compactedMessageCount = Math.max(pivotCount, Math.min(fullHistory.length, view.compactedMessageCount));
        return [
            ...fullHistory.slice(0, pivotCount),
            ...view.summaryMessages,
            ...fullHistory.slice(compactedMessageCount),
        ];
    }

    private buildPartialUpToCompactedHistory(
        conversation: Conversation | undefined,
        state: CompactionState | undefined,
        boundary: CompactBoundaryRecord | undefined,
    ): ConversationHistoryView | undefined {
        if (!conversation || !state || boundary?.trigger !== "partial_up_to") return undefined;
        const fullHistory = this.buildHistoryView(conversation);
        const compactedMessageCount = Math.max(0, Math.min(fullHistory.length, state.compactedMessageCount));
        if (compactedMessageCount <= 0) return undefined;
        return buildCompactedMessages(state, fullHistory.slice(compactedMessageCount));
    }

    getPartialCompactionView(id: string): PartialCompactionViewRecord | undefined {
        return this.get(id)?.partialCompactionView;
    }

    /**
     * 获取最近的历史消息（用于传给 LLM）
     * 不包含当前的最新消息，仅返回之前的历史
     */
    getHistory(id: string): Array<{ role: "user" | "assistant"; content: string }> {
        return this.buildHistoryView(this.get(id));
    }

    getCompactBoundaries(id: string, limit: number = DEFAULT_COMPACT_BOUNDARY_LIMIT): CompactBoundaryRecord[] {
        const conversation = this.get(id);
        return (conversation?.compactBoundaries ?? []).slice(0, Math.max(1, limit));
    }

    getLatestCompactBoundary(id: string): CompactBoundaryRecord | undefined {
        return this.getCompactBoundaries(id, 1)[0];
    }

    getCompactionRuntimeReport(): CompactionRuntimeReport | undefined {
        return this.compactionRuntimeTracker?.getReport();
    }

    private preferLatestCompactBoundary(
        current: CompactBoundaryRecord | undefined,
        candidate: CompactBoundaryRecord | undefined,
    ): CompactBoundaryRecord | undefined {
        if (!candidate) return current;
        if (!current || candidate.createdAt >= current.createdAt) {
            return candidate;
        }
        return current;
    }

    private preferLatestPartialCompactionView(
        current: PartialCompactionViewRecord | undefined,
        candidate: PartialCompactionViewRecord | undefined,
    ): PartialCompactionViewRecord | undefined {
        if (!candidate) return current;
        if (!current || candidate.createdAt >= current.createdAt) {
            return candidate;
        }
        return current;
    }

    async buildConversationRestoreView(id: string): Promise<SessionRestoreView> {
        const generation = this.lifecycle.captureGeneration(id);
        const conversation = await this.getAsync(id, generation);
        const compactionState = await this.getCompactionStateAsync(id, generation);
        const transcriptEvents = await this.getSessionTranscriptEvents(id);
        const transcriptArtifacts = deriveTranscriptRelinkArtifacts(transcriptEvents);
        const boundary = this.preferLatestCompactBoundary(
            conversation?.compactBoundaries?.[0],
            transcriptArtifacts.boundary as CompactBoundaryRecord | undefined,
        );
        const partialView = this.preferLatestPartialCompactionView(
            conversation?.partialCompactionView,
            transcriptArtifacts.partialView as PartialCompactionViewRecord | undefined,
        );

        return buildSessionRestoreView({
            conversationId: id,
            transcriptEvents,
            conversationMessages: (conversation?.messages ?? []).map((message) => ({ ...message })),
            compactionState,
            currentBoundary: boundary,
            currentPartialView: partialView,
        });
    }

    async getCanonicalExtractionView(id: string): Promise<SessionRestoreHistoryMessage[]> {
        return (await this.buildConversationRestoreView(id)).canonicalExtractionView;
    }

    async buildConversationTranscriptExport(
        id: string,
        options?: { mode?: SessionTranscriptExportRedactionMode },
    ): Promise<SessionTranscriptExportBundle> {
        const transcriptEvents = await this.getSessionTranscriptEvents(id);
        const restore = await this.buildConversationRestoreView(id);
        return buildSessionTranscriptExportBundle({
            conversationId: id,
            transcriptEvents,
            restore,
            mode: options?.mode,
        });
    }

    async buildConversationTimeline(
        id: string,
        options?: { previewChars?: number },
    ): Promise<SessionTimelineProjection> {
        const transcriptEvents = await this.getSessionTranscriptEvents(id);
        const restore = await this.buildConversationRestoreView(id);
        return buildSessionTimelineProjection({
            conversationId: id,
            transcriptEvents,
            restore,
            previewChars: options?.previewChars,
        });
    }

    /**
     * 获取会话快照与压缩后的历史，避免调用方在同一热路径内重复读取会话对象。
     */
    async getConversationHistoryCompacted(
        id: string,
        overrideOpts?: CompactionOptions,
    ): Promise<{ conversation?: Conversation; history: ConversationHistoryView; compacted: boolean; boundary?: CompactBoundaryRecord }> {
        const generation = this.lifecycle.captureGeneration(id);
        const wasCached = this.conversations.has(id);
        const conversation = await this.getAsync(id, generation);
        const state = await this.getCompactionStateAsync(id, generation);
        let latestBoundary = conversation?.compactBoundaries?.[0];
        let partialView = conversation?.partialCompactionView;

        const shouldHydrateFromTranscript = this.dataDir && (
            !wasCached
            || !latestBoundary
            || (latestBoundary?.trigger === "partial_from" && !partialView)
        );
        if (shouldHydrateFromTranscript) {
            const transcriptArtifacts = deriveTranscriptRelinkArtifacts(await this.getSessionTranscriptEvents(id));
            latestBoundary = this.preferLatestCompactBoundary(latestBoundary, transcriptArtifacts.boundary as CompactBoundaryRecord | undefined);
            partialView = this.preferLatestPartialCompactionView(partialView, transcriptArtifacts.partialView as PartialCompactionViewRecord | undefined);
            if (conversation) {
                if (latestBoundary) {
                    const existing = conversation.compactBoundaries?.filter((boundary) => boundary.id !== latestBoundary?.id) ?? [];
                    conversation.compactBoundaries = [latestBoundary, ...existing].slice(0, DEFAULT_COMPACT_BOUNDARY_LIMIT);
                }
                if (partialView) {
                    conversation.partialCompactionView = partialView;
                }
            }
        }

        if (this.dataDir) {
            const relinkPartialView: TranscriptRelinkPartialCompactionView | undefined = partialView?.direction === "from"
                ? {
                    ...partialView,
                    direction: "from",
                    summaryMessages: partialView.summaryMessages.map((message) => ({ ...message })),
                }
                : undefined;
            const relinkedHistory = buildTranscriptRelinkedHistory({
                messages: conversation?.messages ?? [],
                compactionState: state,
                boundary: latestBoundary,
                partialView: relinkPartialView,
            });
            if (relinkedHistory) {
                return {
                    conversation,
                    history: relinkedHistory.history,
                    compacted: true,
                    boundary: relinkedHistory.boundary as CompactBoundaryRecord,
                };
            }
        }
        const history = this.buildHistoryView(conversation);
        const opts = overrideOpts ?? this.compactionOpts;

        if (!opts || opts.enabled === false || !needsCompaction(history, opts)) {
            return { conversation, history, compacted: false, boundary: latestBoundary };
        }

        const skipDecision = this.compactionRuntimeTracker?.shouldSkip("request");
        if (skipDecision?.skipped) {
            return { conversation, history, compacted: false, boundary: latestBoundary };
        }

        // 加载或创建压缩状态
        // 触发 before_compaction 回调
        await this.emitBeforeCompaction(id, {
            messageCount: history.length,
            tokenCount: estimateMessagesTokens(history),
            source: "request",
            compactionMode: "request",
            deltaMessageCount: Math.max(0, history.length - (opts.keepRecentCount ?? 10)),
            summarizerModel: this.summarizerModelName,
        }, conversation);

        const result = await compactIncremental(history, state, {
            ...opts,
            summarizer: this.summarizer,
        });
        this.compactionRuntimeTracker?.recordResult(result, {
            source: "request",
            participatesInCircuitBreaker: true,
        });

        let boundary: CompactBoundaryRecord | undefined;
        let appliedCompaction = false;
        if (result.compacted && this.lifecycle.isGenerationCurrent(id, generation)) {
            // 持久化更新后的压缩状态
            this.clearPartialCompactionView(id, conversation);
            await this.persistCompactionState(id, result.state, generation);
            if (this.lifecycle.isGenerationCurrent(id, generation)) {
                boundary = await this.recordCompactBoundary(id, conversation, this.buildCompactBoundaryRecord(conversation, result, "request"));
                appliedCompaction = this.lifecycle.isGenerationCurrent(id, generation);
            }

            // 触发 after_compaction 回调
            if (appliedCompaction) await this.emitAfterCompaction(id, {
                messageCount: result.messages.length,
                tokenCount: result.compactedTokens,
                compactedCount: history.length - result.messages.length,
                tier: result.tier,
                source: "request",
                compactionMode: "request",
                originalTokenCount: result.originalTokens,
                deltaMessageCount: result.deltaMessageCount,
                fallbackUsed: result.fallbackUsed,
                summarizerModel: this.summarizerModelName,
                savedTokenCount: Math.max(0, result.originalTokens - result.compactedTokens),
                rebuildTriggered: result.rebuildTriggered,
            }, conversation);
        }

        return {
            conversation,
            history: result.messages,
            compacted: appliedCompaction,
            boundary: boundary ?? latestBoundary,
        };
    }

    /**
     * 获取历史消息，自动应用增量压缩（如果配置了 compaction）。
     * 使用三层渐进式压缩：Archival Summary → Rolling Summary → Working Memory
     */
    async getHistoryCompacted(
        id: string,
        overrideOpts?: CompactionOptions,
    ): Promise<{ history: Array<{ role: "user" | "assistant"; content: string }>; compacted: boolean; boundary?: CompactBoundaryRecord }> {
        const { history, compacted, boundary } = await this.getConversationHistoryCompacted(id, overrideOpts);
        return { history, compacted, boundary };
    }

    /**
     * 强制执行上下文压缩（跳过 needsCompaction 检查）。
     * 用于用户手动触发 /compact 命令。
     * 如果历史消息过少（≤2）或未配置 compaction，返回 compacted: false。
     */
    async forceCompact(
        id: string,
        overrideOpts?: Pick<CompactionOptions, "keepRecentCount">,
    ): Promise<{ history: Array<{ role: "user" | "assistant"; content: string }>; compacted: boolean; originalTokens?: number; compactedTokens?: number; tier?: string; boundary?: CompactBoundaryRecord }> {
        const generation = this.lifecycle.captureGeneration(id);
        await this.waitForPendingPersistence(id);
        const conversation = await this.getAsync(id, generation);
        const history = this.buildHistoryView(conversation);
        const opts = this.compactionOpts
            ? {
                ...this.compactionOpts,
                ...overrideOpts,
            }
            : undefined;

        // 无压缩配置或历史太短，无法压缩
        if (!opts || history.length <= 2) {
            return { history, compacted: false, boundary: conversation?.compactBoundaries?.[0] };
        }

        const state = await this.getCompactionStateAsync(id, generation);
        const originalTokens = estimateMessagesTokens(history);

        await this.emitBeforeCompaction(id, {
            messageCount: history.length,
            tokenCount: originalTokens,
            source: "manual",
            compactionMode: "manual",
            deltaMessageCount: Math.max(0, history.length - (opts.keepRecentCount ?? 10)),
            summarizerModel: this.summarizerModelName,
        }, conversation);

        const result = await compactIncremental(history, state, {
            ...opts,
            summarizer: this.summarizer,
            force: true,
        });
        this.compactionRuntimeTracker?.recordResult(result, {
            source: "manual",
            participatesInCircuitBreaker: false,
        });

        let boundary: CompactBoundaryRecord | undefined;
        let appliedCompaction = false;
        if (result.compacted && this.lifecycle.isGenerationCurrent(id, generation)) {
            this.clearPartialCompactionView(id, conversation);
            await this.persistCompactionState(id, result.state, generation);
            if (this.lifecycle.isGenerationCurrent(id, generation)) {
                boundary = await this.recordCompactBoundary(id, conversation, this.buildCompactBoundaryRecord(conversation, result, "manual"));
                appliedCompaction = this.lifecycle.isGenerationCurrent(id, generation);
            }

            if (appliedCompaction) await this.emitAfterCompaction(id, {
                messageCount: result.messages.length,
                tokenCount: result.compactedTokens,
                compactedCount: history.length - result.messages.length,
                tier: result.tier,
                source: "manual",
                compactionMode: "manual",
                originalTokenCount: result.originalTokens,
                deltaMessageCount: result.deltaMessageCount,
                fallbackUsed: result.fallbackUsed,
                summarizerModel: this.summarizerModelName,
                savedTokenCount: Math.max(0, result.originalTokens - result.compactedTokens),
                rebuildTriggered: result.rebuildTriggered,
            }, conversation);
        }

        return {
            history: result.messages,
            compacted: appliedCompaction,
            originalTokens: result.originalTokens,
            compactedTokens: result.compactedTokens,
            tier: result.tier,
            boundary: boundary ?? conversation?.compactBoundaries?.[0],
        };
    }

    async forcePartialCompact(
        id: string,
        options: ForcePartialCompactOptions,
    ): Promise<{
        history: Array<{ role: "user" | "assistant"; content: string }>;
        compacted: boolean;
        direction: PartialCompactDirection;
        originalTokens?: number;
        compactedTokens?: number;
        tier?: string;
        boundary?: CompactBoundaryRecord;
    }> {
        const generation = this.lifecycle.captureGeneration(id);
        await this.waitForPendingPersistence(id);
        const conversation = await this.getAsync(id, generation);
        const history = this.buildHistoryView(conversation);
        const opts = this.compactionOpts;
        const direction = options.direction;
        const originalHistoryTokens = estimateMessagesTokens(history);

        if (!opts || history.length <= 1) {
            return {
                history,
                compacted: false,
                direction,
                originalTokens: originalHistoryTokens,
                compactedTokens: originalHistoryTokens,
                boundary: conversation?.compactBoundaries?.[0],
            };
        }

        const pivotIndex = this.resolvePivotIndex(conversation, options);
        if (pivotIndex < 0 || pivotIndex >= history.length) {
            return {
                history,
                compacted: false,
                direction,
                originalTokens: originalHistoryTokens,
                compactedTokens: originalHistoryTokens,
                boundary: conversation?.compactBoundaries?.[0],
            };
        }

        const partialMode = direction === "up_to" ? "partial_up_to" : "partial_from";
        const segmentMessages = direction === "up_to"
            ? history.slice(0, pivotIndex + 1)
            : history.slice(pivotIndex + 1);

        if (segmentMessages.length === 0) {
            return {
                history,
                compacted: false,
                direction,
                originalTokens: originalHistoryTokens,
                compactedTokens: originalHistoryTokens,
                boundary: conversation?.compactBoundaries?.[0],
            };
        }

        await this.emitBeforeCompaction(id, {
            messageCount: history.length,
            tokenCount: originalHistoryTokens,
            source: partialMode,
            compactionMode: partialMode,
            deltaMessageCount: segmentMessages.length,
            summarizerModel: this.summarizerModelName,
        }, conversation);

        const result = await compactIncremental(segmentMessages, createEmptyCompactionState(), {
            ...opts,
            keepRecentCount: 0,
            summarizer: this.summarizer,
            force: true,
        });
        this.compactionRuntimeTracker?.recordResult(result, {
            source: "manual",
            participatesInCircuitBreaker: false,
        });

        let projectedHistory = history;
        let boundary: CompactBoundaryRecord | undefined;
        let projectedHistoryTokens = originalHistoryTokens;
        let appliedCompaction = false;

        if (result.compacted && this.lifecycle.isGenerationCurrent(id, generation)) {
            if (direction === "up_to") {
                const tailMessages = history.slice(pivotIndex + 1);
                this.clearPartialCompactionView(id, conversation);
                await this.persistCompactionState(id, result.state, generation);
                if (this.lifecycle.isGenerationCurrent(id, generation)) {
                    boundary = await this.recordCompactBoundary(id, conversation, this.buildCompactBoundaryRecord(conversation, result, "partial_up_to"));
                    appliedCompaction = this.lifecycle.isGenerationCurrent(id, generation);
                    projectedHistory = buildCompactedMessages(result.state, tailMessages);
                }
            } else {
                const pivotMessage = conversation?.messages[pivotIndex];
                const createdAt = Date.now();
                const view: PartialCompactionViewRecord & { direction: "from" } = {
                    id: createPartialCompactionViewId(createdAt),
                    direction: "from",
                    pivotMessageId: pivotMessage?.id ?? "",
                    pivotMessageCount: pivotIndex + 1,
                    compactedMessageCount: history.length,
                    summaryMessages: result.messages,
                    createdAt,
                    originalTokens: result.originalTokens,
                    compactedTokens: result.compactedTokens,
                    fallbackUsed: result.fallbackUsed,
                    tier: result.tier,
                };
                if (conversation) {
                    conversation.partialCompactionView = view;
                    conversation.updatedAt = Math.max(conversation.updatedAt, createdAt);
                }
                const partialFromBoundary = this.buildPartialFromBoundaryRecord(
                    conversation,
                    pivotIndex,
                    segmentMessages.length,
                    result,
                );
                await this.appendTranscriptEvent(id, createSessionTranscriptPartialCompactionViewEvent({
                    conversationId: id,
                    boundaryId: partialFromBoundary?.id,
                    view,
                    createdAt: view.createdAt,
                }));
                if (this.lifecycle.isGenerationCurrent(id, generation)) {
                    boundary = await this.recordCompactBoundary(
                        id,
                        conversation,
                        partialFromBoundary,
                        { partialCompactionViewId: view.id },
                    );
                    appliedCompaction = this.lifecycle.isGenerationCurrent(id, generation);
                    if (appliedCompaction && conversation && this.dataDir) {
                        this.persistConversationMeta(id, conversation);
                    }
                    projectedHistory = this.buildPartialCompactedHistoryFromView(conversation, view) ?? history;
                }
            }
            projectedHistoryTokens = estimateMessagesTokens(projectedHistory);

            if (appliedCompaction) await this.emitAfterCompaction(id, {
                messageCount: projectedHistory.length,
                tokenCount: projectedHistoryTokens,
                compactedCount: Math.max(0, history.length - projectedHistory.length),
                tier: result.tier,
                source: partialMode,
                compactionMode: partialMode,
                originalTokenCount: originalHistoryTokens,
                deltaMessageCount: result.deltaMessageCount,
                fallbackUsed: result.fallbackUsed,
                summarizerModel: this.summarizerModelName,
                savedTokenCount: Math.max(0, originalHistoryTokens - projectedHistoryTokens),
                rebuildTriggered: result.rebuildTriggered,
            }, conversation);
        }

        return {
            history: projectedHistory,
            compacted: appliedCompaction,
            direction,
            originalTokens: originalHistoryTokens,
            compactedTokens: projectedHistoryTokens,
            tier: result.tier,
            boundary: boundary ?? conversation?.compactBoundaries?.[0],
        };
    }

    async getSessionDigest(
        id: string,
        options: Pick<SessionDigestRefreshOptions, "threshold"> = {},
    ): Promise<SessionDigestRecord> {
        return this.getSessionDigestForGeneration(
            id,
            options,
            this.lifecycle.captureGeneration(id),
        );
    }

    private async getSessionDigestForGeneration(
        id: string,
        options: Pick<SessionDigestRefreshOptions, "threshold">,
        generation: ConversationLifecycleGeneration,
    ): Promise<SessionDigestRecord> {
        const conversation = await this.getAsync(id, generation);
        const history = this.buildSessionDigestHistoryView(conversation);
        const compactionState = await this.getCompactionStateAsync(id, generation);
        const digestState = await this.getSessionDigestStateAsync(id, options.threshold, generation);
        const sessionMemory = await this.getSessionMemoryAsync(id, generation);
        return this.buildSessionDigestRecord(id, history, compactionState, digestState, sessionMemory);
    }

    async refreshSessionDigest(
        id: string,
        options: SessionDigestRefreshOptions = {},
    ): Promise<{
        digest: SessionDigestRecord;
        updated: boolean;
        compacted: boolean;
        originalTokens?: number;
        compactedTokens?: number;
        tier?: string;
    }> {
        const generation = this.lifecycle.captureGeneration(id);
        // Session memory 会引用消息 ID，先等待历史落盘，避免崩溃恢复时出现孤立摘要。
        await this.waitForPendingPersistence(id);
        const previousState = await this.getSessionDigestStateAsync(id, undefined, generation);
        const threshold = typeof options.threshold === "number" && Number.isFinite(options.threshold)
            ? this.resolveSessionDigestThreshold(options.threshold)
            : this.resolveSessionDigestThreshold(previousState.threshold);
        const current = await this.getSessionDigestForGeneration(id, { threshold }, generation);
        const shouldRefresh = options.force === true || this.shouldRefreshSessionDigest(current);

        let sessionMemoryUpdated = false;

        if (shouldRefresh) {
            const result = await this.refreshSessionMemoryForGeneration(
                id,
                {
                    force: options.force === true,
                    threshold,
                },
                generation,
            );
            sessionMemoryUpdated = result.updated;
        }

        const sessionMemory = await this.getSessionMemoryAsync(id, generation);
        const digestContentChanged =
            previousState.lastDigestAt !== sessionMemory.updatedAt
            || previousState.lastSessionMemoryAt !== sessionMemory.updatedAt
            || previousState.lastSessionMemoryMessageCount !== sessionMemory.lastSummarizedMessageCount
            || previousState.lastSessionMemoryToolCursor !== sessionMemory.lastSummarizedToolCursor;
        const nextDigestState: SessionDigestState = {
            threshold,
            lastDigestAt: sessionMemory.updatedAt,
            lastSessionMemoryAt: sessionMemory.updatedAt,
            lastSessionMemoryMessageCount: sessionMemory.lastSummarizedMessageCount,
            lastSessionMemoryToolCursor: sessionMemory.lastSummarizedToolCursor,
            digestGeneration: digestContentChanged
                ? Math.max(0, previousState.digestGeneration) + 1
                : Math.max(0, previousState.digestGeneration),
        };
        const stateChanged =
            previousState.threshold !== nextDigestState.threshold
            || previousState.lastDigestAt !== nextDigestState.lastDigestAt
            || previousState.lastSessionMemoryAt !== nextDigestState.lastSessionMemoryAt
            || previousState.lastSessionMemoryMessageCount !== nextDigestState.lastSessionMemoryMessageCount
            || previousState.lastSessionMemoryToolCursor !== nextDigestState.lastSessionMemoryToolCursor
            || previousState.digestGeneration !== nextDigestState.digestGeneration;

        if (stateChanged) {
            await this.persistSessionDigestState(id, nextDigestState, generation);
        }

        const generationCurrent = this.lifecycle.isGenerationCurrent(id, generation);
        return {
            digest: await this.getSessionDigestForGeneration(id, { threshold }, generation),
            updated: generationCurrent && shouldRefresh && (sessionMemoryUpdated || stateChanged),
            compacted: false,
        };
    }

    async getSessionMemory(id: string): Promise<SessionMemoryRecord> {
        const generation = this.lifecycle.captureGeneration(id);
        return this.toSessionMemoryRecord(id, await this.getSessionMemoryAsync(id, generation));
    }

    async refreshSessionMemory(
        id: string,
        options: SessionDigestRefreshOptions = {},
    ): Promise<{ memory: SessionMemoryRecord; updated: boolean }> {
        return this.refreshSessionMemoryForGeneration(
            id,
            options,
            this.lifecycle.captureGeneration(id),
        );
    }

    private async refreshSessionMemoryForGeneration(
        id: string,
        options: SessionDigestRefreshOptions,
        generation: ConversationLifecycleGeneration,
    ): Promise<{ memory: SessionMemoryRecord; updated: boolean }> {
        const conversation = await this.getAsync(id, generation);
        const history = this.buildSessionDigestHistoryView(conversation);
        const digestState = await this.getSessionDigestStateAsync(id, options.threshold, generation);
        const threshold = this.resolveSessionDigestThreshold(options.threshold ?? digestState.threshold);
        const existing = await this.getSessionMemoryAsync(id, generation);
        const toolDigests = this.getToolDigests(id);
        const messageProgress = this.resolveSessionDigestMessageProgress(history, existing);
        const effectiveCursor = messageProgress.effectiveCursor;
        const effectiveToolCursor = Math.max(
            0,
            Math.min(toolDigests.length, existing.lastSummarizedToolCursor),
        );
        const pendingMessageCount = messageProgress.pendingMessageCount;
        const pendingToolDigestCount = Math.max(0, toolDigests.length - effectiveToolCursor);
        const shouldRefresh = options.force === true
            || pendingMessageCount >= threshold
            || pendingToolDigestCount >= threshold
            || (existing.updatedAt <= 0 && history.length >= threshold);

        if (!shouldRefresh) {
            return {
                memory: this.toSessionMemoryRecord(id, existing),
                updated: false,
            };
        }

        const sessionMemorySkipDecision = this.compactionRuntimeTracker?.shouldSkip("session_memory", {
            allowBypass: options.force === true,
        });
        if (sessionMemorySkipDecision?.skipped) {
            return {
                memory: this.toSessionMemoryRecord(id, existing),
                updated: false,
            };
        }

        await this.emitBeforeCompaction(id, {
            messageCount: history.length,
            tokenCount: history.length > 0 ? estimateMessagesTokens(history) : 0,
            source: "session_memory",
            compactionMode: "session_memory",
            deltaMessageCount: pendingMessageCount,
            summarizerModel: this.summarizerModelName,
        }, conversation);

        if (history.length === 0) {
            const empty = createEmptySessionMemory();
            await this.persistSessionMemory(id, empty, generation);
            if (!this.lifecycle.isGenerationCurrent(id, generation)) {
                return {
                    memory: this.toSessionMemoryRecord(id, existing),
                    updated: false,
                };
            }
            await this.emitAfterCompaction(id, {
                messageCount: 0,
                tokenCount: 0,
                compactedCount: 0,
                source: "session_memory",
                compactionMode: "session_memory",
                originalTokenCount: 0,
                deltaMessageCount: 0,
                fallbackUsed: false,
                summarizerModel: this.summarizerModelName,
                savedTokenCount: 0,
            }, conversation);
            return {
                memory: this.toSessionMemoryRecord(id, empty),
                updated: existing.updatedAt > 0,
            };
        }

        const newMessages = history.slice(effectiveCursor);
        const newToolDigests = toolDigests.slice(effectiveToolCursor);
        const lastHistoryMessageId = history.at(-1)?.id;
        let nextMemory = buildFallbackSessionMemory(
            existing,
            newMessages,
            newToolDigests,
            history.length,
            toolDigests.length,
            lastHistoryMessageId,
        );
        let fallbackUsed = !this.summarizer;
        let failureReason: string | undefined;

        if (this.summarizer) {
            const existingRecord = existing.updatedAt > 0 ? this.toSessionMemoryRecord(id, existing) : undefined;
            const prompt = buildSessionMemoryPrompt(
                existingRecord,
                newMessages.length > 0 ? newMessages : history,
                newToolDigests,
            );
            try {
                const response = await this.summarizer(prompt);
                const responseText = typeof response === "string"
                    ? response
                    : typeof response?.summary === "string"
                        ? response.summary
                        : "";
                const parsed = parseSessionMemoryResponse(responseText);
                if (parsed) {
                    const hasField = (key: keyof StoredSessionMemory): boolean =>
                        Object.prototype.hasOwnProperty.call(parsed, key);
                    const merged = coerceStoredSessionMemory({
                        ...existing,
                        summary: hasField("summary") ? normalizeString(parsed.summary) : existing.summary,
                        currentGoal: hasField("currentGoal") ? normalizeString(parsed.currentGoal) : existing.currentGoal,
                        decisions: hasField("decisions") ? normalizeStringArray(parsed.decisions) : existing.decisions,
                        keyResults: hasField("keyResults") ? normalizeStringArray(parsed.keyResults) : existing.keyResults,
                        filesTouched: hasField("filesTouched") ? normalizeStringArray(parsed.filesTouched) : existing.filesTouched,
                        errorsAndFixes: hasField("errorsAndFixes") ? normalizeStringArray(parsed.errorsAndFixes) : existing.errorsAndFixes,
                        pendingTasks: hasField("pendingTasks") ? normalizeStringArray(parsed.pendingTasks) : existing.pendingTasks,
                        currentWork: hasField("currentWork") ? normalizeString(parsed.currentWork) : existing.currentWork,
                        nextStep: hasField("nextStep") ? normalizeString(parsed.nextStep) : existing.nextStep,
                        lastSummarizedMessageCount: history.length,
                        lastSummarizedMessageId: lastHistoryMessageId,
                        lastSummarizedToolCursor: toolDigests.length,
                        updatedAt: Date.now(),
                    });
                    nextMemory = {
                        ...merged,
                        summary: truncateSummaryText(merged.summary || renderSessionMemorySummary(merged)),
                    };
                } else if (responseText.trim()) {
                    nextMemory = coerceStoredSessionMemory({
                        ...nextMemory,
                        summary: responseText.trim(),
                        lastSummarizedMessageCount: history.length,
                        lastSummarizedMessageId: lastHistoryMessageId,
                        lastSummarizedToolCursor: toolDigests.length,
                        updatedAt: Date.now(),
                    });
                }
            } catch (error) {
                // 会话摘要失败时退回本地 fallback，避免刷新链路不可用
                fallbackUsed = true;
                failureReason = error instanceof Error ? error.message : String(error);
            }
        }

        nextMemory = coerceStoredSessionMemory({
            ...nextMemory,
            lastSummarizedMessageCount: history.length,
            lastSummarizedMessageId: lastHistoryMessageId,
            lastSummarizedToolCursor: toolDigests.length,
            updatedAt: Date.now(),
        });
        if (!this.lifecycle.isGenerationCurrent(id, generation)) {
            return {
                memory: this.toSessionMemoryRecord(id, existing),
                updated: false,
            };
        }
        const updated = !isDeepStrictEqual(existing, nextMemory);
        if (updated) {
            await this.persistSessionMemory(id, nextMemory, generation);
        }
        const nextSummaryTokenCount = nextMemory.summary ? estimateTokens(nextMemory.summary) : 0;
        const newMessageTokens = newMessages.length > 0 ? estimateMessagesTokens(newMessages) : 0;
        this.compactionRuntimeTracker?.recordResult({
            messages: newMessages.length > 0 ? newMessages : history,
            compacted: updated,
            originalTokens: newMessageTokens,
            compactedTokens: nextSummaryTokenCount,
            state: createEmptyCompactionState(),
            deltaMessageCount: newMessages.length,
            fallbackUsed,
            rebuildTriggered: false,
            promptTooLongRetries: 0,
            warningTriggered: false,
            blockingTriggered: false,
            failureReason,
        }, {
            source: "session_memory",
            participatesInCircuitBreaker: options.force !== true,
        });
        await this.emitAfterCompaction(id, {
            messageCount: history.length,
            tokenCount: nextSummaryTokenCount,
            compactedCount: newMessages.length,
            source: "session_memory",
            compactionMode: "session_memory",
            originalTokenCount: newMessageTokens,
            deltaMessageCount: newMessages.length,
            fallbackUsed,
            summarizerModel: this.summarizerModelName,
            savedTokenCount: Math.max(0, newMessageTokens - nextSummaryTokenCount),
        }, conversation);
        return {
            memory: this.toSessionMemoryRecord(id, updated ? nextMemory : existing),
            updated,
        };
    }

    // ─── CompactionState 持久化 ──────────────────────────────────────────

    /**
     * 获取会话的压缩状态
     */
    private getCompactionStateFilePath(id: string): string | undefined {
        return this.getConversationFilePath(id, ".compaction.json");
    }

    private async getCompactionStateAsync(
        id: string,
        generation: ConversationLifecycleGeneration = this.lifecycle.captureGeneration(id),
    ): Promise<CompactionState> {
        // 内存优先
        const cached = this.compactionStates.get(id);
        if (cached) {
            const normalized = normalizeCompactionState(cached);
            this.compactionStates.set(id, normalized);
            return normalized;
        }

        // 尝试从磁盘加载
        for (const filePath of this.getConversationFilePathCandidates(id, ".compaction.json")) {
            try {
                const raw = await conversationAsyncFs.readFile(filePath, "utf-8");
                const data = normalizeCompactionState(JSON.parse(raw) as Partial<CompactionState>);
                if (this.lifecycle.isGenerationCurrent(id, generation)) {
                    this.compactionStates.set(id, data);
                }
                return data;
            } catch (err) {
                const fsErr = err as NodeJS.ErrnoException;
                if (fsErr.code !== "ENOENT") {
                    // 文件损坏或读取失败时，退回空状态，保持旧行为
                }
            }
        }

        const empty = createEmptyCompactionState();
        if (this.lifecycle.isGenerationCurrent(id, generation)) {
            this.compactionStates.set(id, empty);
        }
        return empty;
    }

    /**
     * 更新并持久化压缩状态
     */
    private async persistCompactionState(
        id: string,
        state: CompactionState,
        generation: ConversationLifecycleGeneration = this.lifecycle.captureGeneration(id),
    ): Promise<void> {
        if (!this.lifecycle.isGenerationCurrent(id, generation)) return;
        const normalized = normalizeCompactionState(state);
        this.compactionStates.set(id, normalized);

        const filePath = this.getCompactionStateFilePath(id);
        if (!filePath) return;

        const data = JSON.stringify(normalized, null, 2);
        const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

        await this.enqueueCompactionStateWrite(id, async () => {
            try {
                await conversationAsyncFs.writeFile(tempPath, data, "utf-8");
                await conversationAsyncFs.rename(tempPath, filePath);
            } catch (err) {
                try {
                    await conversationAsyncFs.unlink(tempPath);
                } catch (cleanupErr) {
                    const fsErr = cleanupErr as NodeJS.ErrnoException;
                    if (fsErr.code !== "ENOENT") {
                        // ignore temp cleanup failure
                    }
                }
                console.error(`Failed to save compaction state for ${id}:`, err);
            }
        });
    }

    private enqueueCompactionStateWrite(id: string, task: () => Promise<void>): Promise<void> {
        return this.lifecycle.enqueue("compaction_state", id, task);
    }

    private getSessionDigestStateFilePath(id: string): string | undefined {
        return this.getConversationFilePath(id, ".digest.json");
    }

    private getSessionMemoryFilePath(id: string): string | undefined {
        return this.getConversationFilePath(id, ".session-memory.json");
    }

    private resolveSessionDigestThreshold(threshold?: number): number {
        if (typeof threshold === "number" && Number.isFinite(threshold)) {
            return Math.max(1, Math.floor(threshold));
        }
        return DEFAULT_SESSION_DIGEST_THRESHOLD;
    }

    private async getSessionDigestStateAsync(
        id: string,
        threshold?: number,
        generation: ConversationLifecycleGeneration = this.lifecycle.captureGeneration(id),
    ): Promise<SessionDigestState> {
        const cached = this.sessionDigestStates.get(id);
        if (cached) {
            if (typeof threshold === "number") {
                return {
                    ...cached,
                    threshold: this.resolveSessionDigestThreshold(threshold),
                };
            }
            return cached;
        }

        for (const filePath of this.getConversationFilePathCandidates(id, ".digest.json")) {
            try {
                const raw = await conversationAsyncFs.readFile(filePath, "utf-8");
                const parsed = JSON.parse(raw) as Partial<SessionDigestState>;
                const state: SessionDigestState = {
                    threshold: this.resolveSessionDigestThreshold(parsed.threshold),
                    lastDigestAt: typeof parsed.lastDigestAt === "number" ? parsed.lastDigestAt : 0,
                    lastSessionMemoryAt: typeof parsed.lastSessionMemoryAt === "number" ? parsed.lastSessionMemoryAt : 0,
                    lastSessionMemoryMessageCount: typeof parsed.lastSessionMemoryMessageCount === "number" ? parsed.lastSessionMemoryMessageCount : 0,
                    lastSessionMemoryToolCursor: typeof parsed.lastSessionMemoryToolCursor === "number" ? parsed.lastSessionMemoryToolCursor : 0,
                    digestGeneration: typeof parsed.digestGeneration === "number" ? Math.max(0, Math.floor(parsed.digestGeneration)) : 0,
                };
                if (this.lifecycle.isGenerationCurrent(id, generation)) {
                    this.sessionDigestStates.set(id, state);
                }
                if (typeof threshold === "number") {
                    return {
                        ...state,
                        threshold: this.resolveSessionDigestThreshold(threshold),
                    };
                }
                return state;
            } catch (err) {
                const fsErr = err as NodeJS.ErrnoException;
                if (fsErr.code !== "ENOENT") {
                    // 文件损坏或读取失败时，退回默认状态
                }
            }
        }

        const empty: SessionDigestState = {
            threshold: this.resolveSessionDigestThreshold(threshold),
            lastDigestAt: 0,
            lastSessionMemoryAt: 0,
            lastSessionMemoryMessageCount: 0,
            lastSessionMemoryToolCursor: 0,
            digestGeneration: 0,
        };
        if (this.lifecycle.isGenerationCurrent(id, generation)) {
            this.sessionDigestStates.set(id, empty);
        }
        return empty;
    }

    private async persistSessionDigestState(
        id: string,
        state: SessionDigestState,
        generation: ConversationLifecycleGeneration = this.lifecycle.captureGeneration(id),
    ): Promise<void> {
        if (!this.lifecycle.isGenerationCurrent(id, generation)) return;
        this.sessionDigestStates.set(id, state);

        const filePath = this.getSessionDigestStateFilePath(id);
        if (!filePath) return;

        const data = JSON.stringify(state, null, 2);
        const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

        await this.enqueueSessionDigestStateWrite(id, async () => {
            try {
                await conversationAsyncFs.writeFile(tempPath, data, "utf-8");
                await conversationAsyncFs.rename(tempPath, filePath);
            } catch (err) {
                try {
                    await conversationAsyncFs.unlink(tempPath);
                } catch (cleanupErr) {
                    const fsErr = cleanupErr as NodeJS.ErrnoException;
                    if (fsErr.code !== "ENOENT") {
                        // ignore temp cleanup failure
                    }
                }
                console.error(`Failed to save session digest state for ${id}:`, err);
            }
        });
    }

    async waitForPendingPersistence(id: string): Promise<void> {
        await this.lifecycle.waitForPendingPersistence(id);
    }

    async getSessionTranscriptEvents(id: string): Promise<SessionTranscriptEvent[]> {
        return readSessionTranscriptFile(this.getSessionTranscriptFilePath(id));
    }

    private async readPersistedConversationIdFromTranscript(filePath: string): Promise<string | undefined> {
        try {
            const raw = await conversationAsyncFs.readFile(filePath, "utf-8");
            const firstLine = raw.split(/\r?\n/).find((line) => line.trim());
            if (!firstLine) {
                return undefined;
            }
            const parsed = JSON.parse(firstLine) as { conversationId?: unknown };
            return typeof parsed.conversationId === "string" && parsed.conversationId.trim()
                ? parsed.conversationId.trim()
                : undefined;
        } catch {
            return undefined;
        }
    }

    async listPersistedConversations(options?: {
        conversationIdPrefix?: string;
        limit?: number;
    }): Promise<PersistedConversationSummary[]> {
        const limit = typeof options?.limit === "number" && Number.isFinite(options.limit)
            ? Math.max(1, Math.floor(options.limit))
            : undefined;
        const prefix = typeof options?.conversationIdPrefix === "string"
            ? options.conversationIdPrefix.trim()
            : "";

        if (!this.dataDir) {
            const inMemory = [...this.conversations.values()]
                .filter((conversation) => !prefix || conversation.id.startsWith(prefix))
                .sort((left, right) => right.updatedAt - left.updatedAt)
                .map((conversation) => ({
                    conversationId: conversation.id,
                    createdAt: conversation.createdAt,
                    updatedAt: conversation.updatedAt,
                    messageCount: conversation.messages.length,
                    hasTranscript: false,
                    hasMeta: false,
                    hasMessages: conversation.messages.length > 0,
                    agentId: conversation.agentId,
                    channel: conversation.channel,
                }));
            return typeof limit === "number" ? inMemory.slice(0, limit) : inMemory;
        }

        const persisted = new Map<string, {
            transcriptPath?: string;
            metaPath?: string;
            messagesPath?: string;
        }>();
        const memoryConversationIds = new Map<string, string>();
        for (const conversationId of this.conversations.keys()) {
            memoryConversationIds.set(this.toSafeConversationFileId(conversationId), conversationId);
        }

        const entries = await fsp.readdir(this.dataDir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            if (!entry.isFile()) continue;
            const fileName = entry.name;
            let fullPath: string;
            try {
                fullPath = this.dataDirCapability?.resolveExistingRelative(
                    fileName,
                    "persisted conversation entry",
                ) ?? "";
            } catch {
                continue;
            }
            if (!fullPath) continue;

            if (fileName.endsWith(".transcript.jsonl")) {
                const key = fileName.slice(0, -".transcript.jsonl".length);
                const current = persisted.get(key) ?? {};
                current.transcriptPath = fullPath;
                persisted.set(key, current);
                continue;
            }

            if (fileName.endsWith(".meta.json")) {
                const key = fileName.slice(0, -".meta.json".length);
                const current = persisted.get(key) ?? {};
                current.metaPath = fullPath;
                persisted.set(key, current);
                continue;
            }

            if (fileName.endsWith(".jsonl")) {
                const key = fileName.slice(0, -".jsonl".length);
                const current = persisted.get(key) ?? {};
                current.messagesPath = fullPath;
                persisted.set(key, current);
            }
        }

        const summaries: PersistedConversationSummary[] = [];
        for (const [safeFileId, record] of persisted) {
            let conversationId = memoryConversationIds.get(safeFileId);
            if (!conversationId && record.metaPath) {
                try {
                    const rawMeta = await conversationAsyncFs.readFile(record.metaPath, "utf-8");
                    const parsedMeta = JSON.parse(rawMeta) as { conversationId?: unknown };
                    if (typeof parsedMeta.conversationId === "string" && parsedMeta.conversationId.trim()) {
                        conversationId = parsedMeta.conversationId.trim();
                    }
                } catch {
                    // ignore invalid meta
                }
            }
            if (!conversationId && record.transcriptPath) {
                conversationId = await this.readPersistedConversationIdFromTranscript(record.transcriptPath);
            }
            if (!conversationId && !safeFileId.includes("%")) {
                conversationId = safeFileId;
            }
            if (!conversationId) {
                continue;
            }
            if (prefix && !conversationId.startsWith(prefix)) {
                continue;
            }

            const conversation = await this.getAsync(conversationId);
            const meta = conversation ? undefined : await this.loadMetaFromFileAsync(conversationId);
            const createdAt = conversation?.createdAt ?? meta?.createdAt ?? 0;
            const updatedAt = conversation?.updatedAt ?? meta?.updatedAt ?? createdAt;
            summaries.push({
                conversationId,
                createdAt,
                updatedAt,
                messageCount: conversation?.messages.length ?? 0,
                hasTranscript: Boolean(record.transcriptPath),
                hasMeta: Boolean(record.metaPath),
                hasMessages: Boolean(record.messagesPath),
                agentId: conversation?.agentId ?? meta?.agentId,
                channel: conversation?.channel ?? meta?.channel,
            });
        }

        summaries.sort((left, right) => right.updatedAt - left.updatedAt);
        return typeof limit === "number" ? summaries.slice(0, limit) : summaries;
    }

    private enqueueSessionDigestStateWrite(id: string, task: () => Promise<void>): Promise<void> {
        return this.lifecycle.enqueue("session_digest_state", id, task);
    }

    private async getSessionMemoryAsync(
        id: string,
        generation: ConversationLifecycleGeneration = this.lifecycle.captureGeneration(id),
    ): Promise<StoredSessionMemory> {
        const cached = this.sessionMemories.get(id);
        if (cached) return cached;

        for (const filePath of this.getConversationFilePathCandidates(id, ".session-memory.json")) {
            try {
                const raw = await conversationAsyncFs.readFile(filePath, "utf-8");
                const parsed = JSON.parse(raw) as Partial<StoredSessionMemory>;
                const memory = coerceStoredSessionMemory(parsed);
                if (this.lifecycle.isGenerationCurrent(id, generation)) {
                    this.sessionMemories.set(id, memory);
                }
                return memory;
            } catch (err) {
                const fsErr = err as NodeJS.ErrnoException;
                if (fsErr.code !== "ENOENT") {
                    // 文件损坏或读取失败时，退回空状态
                }
            }
        }

        const empty = createEmptySessionMemory();
        if (this.lifecycle.isGenerationCurrent(id, generation)) {
            this.sessionMemories.set(id, empty);
        }
        return empty;
    }

    private async persistSessionMemory(
        id: string,
        memory: StoredSessionMemory,
        generation: ConversationLifecycleGeneration = this.lifecycle.captureGeneration(id),
    ): Promise<void> {
        if (!this.lifecycle.isGenerationCurrent(id, generation)) return;
        const normalized = coerceStoredSessionMemory(memory);
        this.sessionMemories.set(id, normalized);

        const filePath = this.getSessionMemoryFilePath(id);
        if (!filePath) return;

        const data = JSON.stringify(normalized, null, 2);
        const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

        await this.enqueueSessionMemoryWrite(id, async () => {
            try {
                await conversationAsyncFs.writeFile(tempPath, data, "utf-8");
                await conversationAsyncFs.rename(tempPath, filePath);
            } catch (err) {
                try {
                    await conversationAsyncFs.unlink(tempPath);
                } catch (cleanupErr) {
                    const fsErr = cleanupErr as NodeJS.ErrnoException;
                    if (fsErr.code !== "ENOENT") {
                        // ignore temp cleanup failure
                    }
                }
                console.error(`Failed to save session memory for ${id}:`, err);
            }
        });
    }

    private enqueueSessionMemoryWrite(id: string, task: () => Promise<void>): Promise<void> {
        return this.lifecycle.enqueue("session_memory", id, task);
    }

    private resolveSessionDigestMessageProgress(
        history: SessionDigestHistoryView,
        sessionMemory: StoredSessionMemory,
        fallbackDigestedMessageCount: number = 0,
    ): { effectiveCursor: number; digestedMessageCount: number; pendingMessageCount: number } {
        const messageCount = history.length;
        if (messageCount <= 0) {
            return {
                effectiveCursor: 0,
                digestedMessageCount: 0,
                pendingMessageCount: 0,
            };
        }

        const lastSummarizedMessageId = normalizeString(sessionMemory.lastSummarizedMessageId);
        if (lastSummarizedMessageId) {
            const boundaryIndex = history.findIndex((message) => message.id === lastSummarizedMessageId);
            if (boundaryIndex >= 0) {
                const digestedMessageCount = boundaryIndex + 1;
                return {
                    effectiveCursor: digestedMessageCount,
                    digestedMessageCount,
                    pendingMessageCount: Math.max(0, messageCount - digestedMessageCount),
                };
            }

            return {
                effectiveCursor: 0,
                digestedMessageCount: 0,
                pendingMessageCount: messageCount,
            };
        }

        const countBasedDigestedMessageCount = Math.max(
            0,
            Math.min(
                messageCount,
                sessionMemory.lastSummarizedMessageCount > 0
                    ? sessionMemory.lastSummarizedMessageCount
                    : fallbackDigestedMessageCount,
            ),
        );
        const shouldResummarizeFullWindowForLegacyRecord =
            sessionMemory.updatedAt > 0
            && sessionMemory.lastSummarizedMessageCount > 0
            && messageCount >= this.maxHistory
            && countBasedDigestedMessageCount >= messageCount;
        if (shouldResummarizeFullWindowForLegacyRecord) {
            return {
                effectiveCursor: 0,
                digestedMessageCount: 0,
                pendingMessageCount: messageCount,
            };
        }

        return {
            effectiveCursor: countBasedDigestedMessageCount,
            digestedMessageCount: countBasedDigestedMessageCount,
            pendingMessageCount: Math.max(0, messageCount - countBasedDigestedMessageCount),
        };
    }

    private buildSessionDigestRecord(
        id: string,
        history: SessionDigestHistoryView,
        compactionState: CompactionState,
        digestState: SessionDigestState,
        sessionMemory: StoredSessionMemory,
    ): SessionDigestRecord {
        const messageCount = history.length;
        const progress = this.resolveSessionDigestMessageProgress(
            history,
            sessionMemory,
            compactionState.compactedMessageCount,
        );
        const digestedMessageCount = progress.digestedMessageCount;
        const pendingMessageCount = progress.pendingMessageCount;
        const threshold = this.resolveSessionDigestThreshold(digestState.threshold);
        const rollingSummary = sessionMemory.summary || compactionState.rollingSummary;
        const hasDigestContent =
            sessionMemory.updatedAt > 0
            || Boolean(sessionMemory.summary)
            || compactionState.lastCompactedAt > 0
            || Boolean(compactionState.archivalSummary);
        const refreshRecommended = pendingMessageCount >= threshold || (!hasDigestContent && messageCount >= threshold);

        return {
            conversationId: id,
            status: refreshRecommended ? "updated" : hasDigestContent ? "ready" : "idle",
            messageCount,
            digestedMessageCount,
            pendingMessageCount,
            threshold,
            rollingSummary,
            archivalSummary: compactionState.archivalSummary,
            lastDigestAt: Math.max(sessionMemory.updatedAt, compactionState.lastCompactedAt, digestState.lastDigestAt),
            digestGeneration: Math.max(0, digestState.digestGeneration),
        };
    }

    private toSessionMemoryRecord(id: string, memory: StoredSessionMemory): SessionMemoryRecord {
        return {
            conversationId: id,
            ...memory,
        };
    }

    private shouldRefreshSessionDigest(digest: SessionDigestRecord): boolean {
        return digest.pendingMessageCount >= digest.threshold
            || (digest.lastDigestAt <= 0 && digest.messageCount >= digest.threshold);
    }

    /**
     * 保存活跃 token 计数器快照（跨 run 持久化）
     */
    setActiveCounters(conversationId: string, snapshots: ActiveCounterSnapshot[]): void {
        const conv = this.get(conversationId);
        if (!conv) return;
        conv.activeCounters = snapshots.length > 0 ? snapshots : undefined;
        conv.updatedAt = Date.now();
        this.persistConversationMeta(conversationId, conv);
    }

    /**
     * 获取活跃 token 计数器快照
     */
    getActiveCounters(conversationId: string): ActiveCounterSnapshot[] {
        const conv = this.get(conversationId);
        return conv?.activeCounters ?? [];
    }

    recordToolDigest(
        conversationId: string,
        record: Omit<ToolDigestRecord, "createdAt"> & { createdAt?: number },
        limit: number = 100,
    ): void {
        let conv = this.get(conversationId);
        const now = Date.now();
        if (!conv) {
            conv = {
                id: conversationId,
                messages: [],
                createdAt: now,
                updatedAt: now,
            };
            this.conversations.set(conversationId, conv);
        }

        const next: ToolDigestRecord = {
            ...record,
            createdAt: typeof record.createdAt === "number" ? record.createdAt : now,
        };
        const existing = conv.toolDigests ?? [];
        conv.toolDigests = [...existing, next].slice(-Math.max(1, limit));
        conv.updatedAt = now;
        this.persistConversationMeta(conversationId, conv);
    }

    getToolDigests(conversationId: string, limit: number = 100): ToolDigestRecord[] {
        const conv = this.get(conversationId);
        const items = conv?.toolDigests ?? [];
        return items.slice(-Math.max(1, limit));
    }

    recordRecentToolResult(
        conversationId: string,
        record: Omit<StoredRecentToolResultRecord, "createdAt"> & { createdAt?: number },
        limit: number = DEFAULT_RECENT_TOOL_RESULT_LIMIT,
    ): void {
        let conv = this.get(conversationId);
        const now = Date.now();
        if (!conv) {
            conv = {
                id: conversationId,
                messages: [],
                createdAt: now,
                updatedAt: now,
            };
            this.conversations.set(conversationId, conv);
        }

        const createdAt = typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
            ? Math.max(0, Math.floor(record.createdAt))
            : now;
        const next = normalizeRecentToolResultRecord(record, createdAt);
        const existing = conv.recentToolResults ?? [];
        const deduped = existing.filter((item) => item.toolCallId !== next.toolCallId);
        conv.recentToolResults = [next, ...deduped].slice(0, Math.max(1, limit));
        conv.updatedAt = now;
        this.persistConversationMeta(conversationId, conv);
    }

    /**
     * 将同一次 Tool Result 的 digest、可恢复结果和 carryover 合并为单一最终快照。
     * 单项公开方法保留原有行为；Tool Agent 应使用本入口避免重复同步 meta 写入。
     */
    recordToolArtifacts(conversationId: string, artifacts: ToolArtifactsRecord): void {
        let conv = this.get(conversationId);
        const now = Date.now();
        if (!conv) {
            conv = {
                id: conversationId,
                messages: [],
                createdAt: now,
                updatedAt: now,
            };
            this.conversations.set(conversationId, conv);
        }

        const toolDigestLimit = Math.max(1, artifacts.toolDigestLimit ?? 100);
        const toolDigest: ToolDigestRecord = {
            ...artifacts.toolDigest,
            createdAt: typeof artifacts.toolDigest.createdAt === "number"
                ? artifacts.toolDigest.createdAt
                : now,
        };
        conv.toolDigests = [...(conv.toolDigests ?? []), toolDigest].slice(-toolDigestLimit);

        const recentToolResultLimit = Math.max(1, artifacts.recentToolResultLimit ?? DEFAULT_RECENT_TOOL_RESULT_LIMIT);
        const recentCreatedAt = typeof artifacts.recentToolResult.createdAt === "number"
            && Number.isFinite(artifacts.recentToolResult.createdAt)
            ? Math.max(0, Math.floor(artifacts.recentToolResult.createdAt))
            : now;
        const recentToolResult = normalizeRecentToolResultRecord(artifacts.recentToolResult, recentCreatedAt);
        const dedupedRecentResults = (conv.recentToolResults ?? [])
            .filter((item) => item.toolCallId !== recentToolResult.toolCallId);
        conv.recentToolResults = [recentToolResult, ...dedupedRecentResults].slice(0, recentToolResultLimit);

        const carryover = normalizeCarryoverContextRecord(artifacts.carryoverContext);
        if (carryover) {
            const existingCarryover = conv.carryoverContext ?? [];
            const matchedCarryover = existingCarryover.find((item) => item.sourceKey === carryover.sourceKey);
            const mergedCarryover = matchedCarryover
                ? mergeCarryoverContextRecord(matchedCarryover, carryover)
                : carryover;
            const carryoverContextLimit = Math.max(1, artifacts.carryoverContextLimit ?? 12);
            const normalizedCarryover = [
                mergedCarryover,
                ...existingCarryover.filter((item) => item.sourceKey !== carryover.sourceKey),
            ]
                .map((item) => normalizeCarryoverContextRecord(item))
                .filter((item): item is CarryoverContextRecord => Boolean(item))
                .sort((left, right) => {
                    if (left.priority !== right.priority) {
                        return right.priority - left.priority;
                    }
                    if (left.lastUsedAt !== right.lastUsedAt) {
                        return right.lastUsedAt - left.lastUsedAt;
                    }
                    return left.sourceKey.localeCompare(right.sourceKey, "en-US");
                })
                .slice(0, carryoverContextLimit);
            conv.carryoverContext = normalizedCarryover.length > 0 ? normalizedCarryover : undefined;
        }

        conv.updatedAt = now;
        this.persistConversationMeta(conversationId, conv);
    }

    getRecentToolResults(
        conversationId: string,
        options: {
            limit?: number;
            toolCallId?: string;
            toolName?: string;
            success?: boolean;
            query?: string;
        } = {},
    ): StoredRecentToolResultRecord[] {
        const conv = this.get(conversationId);
        const items = conv?.recentToolResults ?? [];
        const toolCallId = typeof options.toolCallId === "string" ? options.toolCallId.trim() : "";
        const toolName = typeof options.toolName === "string" ? options.toolName.trim().toLowerCase() : "";
        const query = typeof options.query === "string" ? options.query.trim().toLowerCase() : "";
        const successFilter = typeof options.success === "boolean" ? options.success : undefined;
        const filtered = items.filter((item) => {
            if (toolCallId && item.toolCallId !== toolCallId) return false;
            if (toolName && item.toolName.toLowerCase() !== toolName) return false;
            if (typeof successFilter === "boolean" && item.success !== successFilter) return false;
            if (query) {
                const haystack = [
                    item.toolCallId,
                    item.toolName,
                    item.summary,
                    item.target,
                    item.content,
                    item.error,
                ]
                    .filter((value): value is string => typeof value === "string" && value.length > 0)
                    .join("\n")
                    .toLowerCase();
                if (!haystack.includes(query)) return false;
            }
            return true;
        });
        const limit = typeof options.limit === "number" && Number.isFinite(options.limit)
            ? Math.max(1, Math.floor(options.limit))
            : DEFAULT_RECENT_TOOL_RESULT_LIMIT;
        return filtered.slice(0, limit);
    }

    getCarryoverContext(
        conversationId: string,
        options: CarryoverContextQueryOptions = {},
    ): CarryoverContextRecord[] {
        const conv = this.get(conversationId);
        const items = conv?.carryoverContext ?? [];
        const queryTokens = typeof options.query === "string" ? tokenizeCarryoverQuery(options.query) : [];
        const now = typeof options.now === "number" && Number.isFinite(options.now)
            ? Math.max(0, Math.floor(options.now))
            : Date.now();
        const sorted = [...items].sort((left, right) => {
            const leftRelevance = computeCarryoverRelevanceScore(left, queryTokens);
            const rightRelevance = computeCarryoverRelevanceScore(right, queryTokens);
            if (leftRelevance !== rightRelevance) {
                return rightRelevance - leftRelevance;
            }
            const leftRecencyPenalty = computeCarryoverRecencyPenalty(left, now);
            const rightRecencyPenalty = computeCarryoverRecencyPenalty(right, now);
            if (leftRecencyPenalty !== rightRecencyPenalty) {
                return leftRecencyPenalty - rightRecencyPenalty;
            }
            const leftSourceTypeBoost = computeCarryoverSourceTypeBoost(left.sourceType);
            const rightSourceTypeBoost = computeCarryoverSourceTypeBoost(right.sourceType);
            if (leftSourceTypeBoost !== rightSourceTypeBoost) {
                return rightSourceTypeBoost - leftSourceTypeBoost;
            }
            if (left.priority !== right.priority) {
                return right.priority - left.priority;
            }
            if (left.lastUsedAt !== right.lastUsedAt) {
                return right.lastUsedAt - left.lastUsedAt;
            }
            return left.sourceKey.localeCompare(right.sourceKey, "en-US");
        });
        const limit = typeof options.limit === "number" && Number.isFinite(options.limit)
            ? Math.max(1, Math.floor(options.limit))
            : sorted.length;
        return sorted.slice(0, limit);
    }

    setCarryoverContext(
        conversationId: string,
        records: Array<Partial<CarryoverContextRecord>>,
        limit: number = 12,
    ): void {
        const normalized = records
            .map((item) => normalizeCarryoverContextRecord(item))
            .filter((item): item is CarryoverContextRecord => Boolean(item))
            .sort((left, right) => {
                if (left.priority !== right.priority) {
                    return right.priority - left.priority;
                }
                if (left.lastUsedAt !== right.lastUsedAt) {
                    return right.lastUsedAt - left.lastUsedAt;
                }
                return left.sourceKey.localeCompare(right.sourceKey, "en-US");
            })
            .slice(0, Math.max(1, limit));

        let conv = this.get(conversationId);
        const now = Date.now();
        if (!conv) {
            if (normalized.length === 0) {
                return;
            }
            conv = {
                id: conversationId,
                messages: [],
                createdAt: now,
                updatedAt: now,
            };
            this.conversations.set(conversationId, conv);
        }

        conv.carryoverContext = normalized.length > 0 ? normalized : undefined;
        conv.updatedAt = now;
        this.persistConversationMeta(conversationId, conv);
    }

    upsertCarryoverContext(
        conversationId: string,
        record: Partial<CarryoverContextRecord>,
        limit: number = 12,
    ): void {
        const normalized = normalizeCarryoverContextRecord(record);
        if (!normalized) return;
        const existing = this.getCarryoverContext(conversationId);
        const matched = existing.find((item) => item.sourceKey === normalized.sourceKey);
        const merged = matched ? mergeCarryoverContextRecord(matched, normalized) : normalized;
        const deduped = existing.filter((item) => item.sourceKey !== normalized.sourceKey);
        this.setCarryoverContext(conversationId, [merged, ...deduped], limit);
    }

    recordTaskTokenResult(
        conversationId: string,
        record: Omit<TaskTokenRecord, "createdAt"> & { createdAt?: number },
        limit: number = 20,
    ): void {
        let conv = this.get(conversationId);
        const now = Date.now();
        if (!conv) {
            conv = {
                id: conversationId,
                messages: [],
                createdAt: now,
                updatedAt: now,
            };
            this.conversations.set(conversationId, conv);
        }

        const nextRecord: TaskTokenRecord = {
            ...record,
            createdAt: typeof record.createdAt === "number" ? record.createdAt : now,
        };
        const existing = conv.taskTokenRecords ?? [];
        conv.taskTokenRecords = [nextRecord, ...existing].slice(0, Math.max(1, limit));
        conv.updatedAt = now;
        this.persistConversationMeta(conversationId, conv);
    }

    getTaskTokenResults(conversationId: string, limit: number = 10): TaskTokenRecord[] {
        const conv = this.get(conversationId);
        if (!conv?.taskTokenRecords?.length) return [];
        return conv.taskTokenRecords.slice(0, Math.max(1, limit));
    }

    getLoadedToolNames(conversationId: string): string[] {
        const conv = this.get(conversationId);
        return conv?.loadedToolNames ? [...conv.loadedToolNames] : [];
    }

    getPlanState(conversationId: string): ConversationPlanState | null {
        const conv = this.get(conversationId);
        return conv?.planState ? {
            ...conv.planState,
            steps: conv.planState.steps.map((step) => ({
                ...step,
                ...(step.refs ? { refs: step.refs.map((ref) => ({ ...ref })) } : {}),
            })),
        } : null;
    }

    updatePlanState(
        conversationId: string,
        input: ConversationPlanUpdateInput,
    ): ConversationPlanUpdateResult {
        const now = Date.now();
        let conv = this.get(conversationId);
        if (!conv) {
            conv = {
                id: conversationId,
                messages: [],
                createdAt: now,
                updatedAt: now,
            };
            this.conversations.set(conversationId, conv);
        }

        const result = updateConversationPlanState(conv.planState ?? null, input, now);
        if (!result.applied) {
            return result;
        }

        conv.planState = result.planState ?? undefined;
        conv.updatedAt = now;
        this.persistConversationMeta(conversationId, conv);
        return {
            ...result,
            planState: this.getPlanState(conversationId),
        };
    }

    clearPlanState(
        conversationId: string,
        updatedBy: ConversationPlanUpdatedBy = "system",
    ): ConversationPlanState | null {
        const result = this.updatePlanState(conversationId, {
            updatedBy,
            ifAbsent: "create",
            seed: { title: "Cleared Plan", status: "draft", mode: "agent" },
            operations: [{ type: "clear" }],
        });
        return result.planState ?? null;
    }

    setLoadedToolNames(conversationId: string, toolNames: string[]): void {
        const normalized = [...new Set(
            toolNames
                .map((item) => typeof item === "string" ? item.trim() : "")
                .filter(Boolean),
        )].sort((left, right) => left.localeCompare(right));

        let conv = this.get(conversationId);
        const now = Date.now();
        if (!conv) {
            if (normalized.length === 0) {
                return;
            }
            conv = {
                id: conversationId,
                messages: [],
                createdAt: now,
                updatedAt: now,
            };
            this.conversations.set(conversationId, conv);
        }

        conv.loadedToolNames = normalized.length > 0 ? normalized : undefined;
        conv.updatedAt = now;
        this.persistConversationMeta(conversationId, conv);
    }

    /**
     * 设置房间成员列表缓存
     * @param conversationId 会话ID
     * @param members 成员列表
     * @param ttl 缓存有效期（毫秒），默认5分钟
     */
    setRoomMembersCache(
        conversationId: string,
        members: Array<{ type: "user" | "agent"; id: string; name?: string; identity?: string }>,
        ttl: number = 5 * 60 * 1000, // 默认5分钟
    ): void {
        const conv = this.get(conversationId);
        if (!conv) return;

        conv.roomMembersCache = {
            members,
            cachedAt: Date.now(),
            ttl,
        };
        conv.updatedAt = Date.now();
    }

    /**
     * 获取房间成员列表缓存
     * @param conversationId 会话ID
     * @returns 成员列表，如果缓存过期或不存在则返回undefined
     */
    getRoomMembersCache(
        conversationId: string,
    ): Array<{ type: "user" | "agent"; id: string; name?: string; identity?: string }> | undefined {
        const conv = this.get(conversationId);
        if (!conv || !conv.roomMembersCache) return undefined;

        const now = Date.now();
        const cache = conv.roomMembersCache;

        // 检查缓存是否过期
        if (now - cache.cachedAt > cache.ttl) {
            // 缓存过期，清除
            delete conv.roomMembersCache;
            return undefined;
        }

        return cache.members;
    }

    /**
     * 清除房间成员列表缓存
     * @param conversationId 会话ID
     */
    clearRoomMembersCache(conversationId: string): void {
        const conv = this.get(conversationId);
        if (!conv) return;

        delete conv.roomMembersCache;
        conv.updatedAt = Date.now();
    }
}
