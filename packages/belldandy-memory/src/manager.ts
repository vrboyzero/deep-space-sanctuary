import { MemoryStore, type TaskSummaryRecord } from "./store.js";
import { MemoryIndexer, type IndexerOptions } from "./indexer.js";
import { ResultReranker, type RerankerOptions } from "./reranker.js";
import { shouldSkipRetrieval } from "./adaptive-retrieval.js";
import { OpenAIEmbeddingProvider } from "./embeddings/openai.js";
import { LocalEmbeddingProvider } from "./embeddings/local-provider.js";
import type { EmbeddingProvider } from "./embeddings/index.js";
import type {
    MemoryCategory,
    MemoryChunk,
    MemoryImportance,
    MemoryIndexStatus,
    MemorySearchFilter,
    MemorySearchOptions,
    MemorySearchResult,
} from "./types.js";
import { ExperiencePromoter } from "./experience-promoter.js";
import { buildExperienceSynthesisPreview } from "./experience-synthesis.js";
import { TaskProcessor } from "./task-processor.js";
import { TaskSummarizer } from "./task-summarizer.js";
import { shouldAutoPromoteTaskByPolicy } from "./task-auto-promotion-policy.js";
import {
    buildMemorySourceInventoryReport,
    type MemorySourceInventoryClass,
    type MemorySourceInventoryConfiguredSource,
    type MemorySourceInventoryItem,
    type MemorySourceInventoryReport,
} from "./memory-source-inventory.js";
import type {
    MemoryTreeScoreListFilter,
    MemoryTreeScoreRecord,
    MemoryTreeScoreRebuildResult,
    MemoryTreeEdgeListFilter,
    MemoryTreeEdgeRecord,
    MemoryTreeNodeListFilter,
    MemoryTreeNodeRebuildResult,
    MemoryTreeNodeRecord,
    MemoryTreeReportListFilter,
    MemoryTreeReportPersistResult,
    MemoryTreeReportRecord,
    MemoryTreeReportStatus,
    MemoryTreeReportType,
    MemoryTreeSourceListFilter,
    MemoryTreeSourceRecord,
    MemoryTreeSourceRebuildResult,
} from "./memory-tree-types.js";
import { buildOpenAIChatCompletionsUrl } from "./openai-url.js";
import type {
    TaskActivityRecord,
    TaskConversationStore,
    TaskMemoryRelation,
    TaskRecord,
    TaskSearchFilter,
    TaskSearchOptions,
    TaskSource,
    TaskToolCallSummary,
} from "./task-types.js";
import type {
    ExperienceAssetType,
    ExperienceCandidate,
    ExperienceCandidateMetadata,
    ExperienceCandidateStats,
    ExperienceCandidateType,
    ExperienceCandidateListFilter,
    ExperiencePromoteResult,
    ExperienceSynthesisPreviewResult,
    ExperienceUsage,
    ExperienceUsageListFilter,
    ExperienceUsageRecordResult,
    ExperienceUsageSummary,
    ExperienceUsageStats,
    ExperienceUsageVia,
    TaskExperienceDetail,
} from "./experience-types.js";
import {
    appendMethodFilenameRevision,
    buildExperienceMethodFilenameBase,
    validateMethodCandidateDraftForPublish,
} from "./experience-publish-rules.js";
import { appendToTodayMemory } from "./memory-files.js";
import type {
    MemoryDedupGroupSourceIndexSummary,
    MemoryDedupSourceIndexInfo,
    MemoryDedupSourceIndexScope,
    MemoryDedupSourceIndexSummary,
    MemoryExactDedupApplyOptions,
    MemoryExactDedupApplyResult,
    MemoryExactDedupPreviewReport,
} from "./memory-dedup.js";
import type { DurableExtractionSkipReasonCode } from "./durable-extraction-policy.js";
import { resolveStateDir, resolveWorkspaceStateDir } from "@belldandy/protocol";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";

const MEMORY_TREE_SCORE_VERSION = "v1_rule_only";

// ============================================================================
// Global Registry - Allows sharing MemoryManager across packages
// ============================================================================

let globalMemoryManager: MemoryManager | null = null;
const scopedGlobalMemoryManagersByAgent = new Map<string, MemoryManager>();
const scopedGlobalMemoryManagersByWorkspace = new Map<string, MemoryManager>();

export type GlobalMemoryManagerRegistrationOptions = {
    agentId?: string;
    workspaceRoot?: string;
    isDefault?: boolean;
};

export type GlobalMemoryManagerScope = {
    agentId?: string;
    conversationId?: string;
    workspaceRoot?: string;
};

function normalizeGlobalMemoryAgentId(agentId?: string): string | undefined {
    if (typeof agentId !== "string") return undefined;
    const trimmed = agentId.trim();
    return trimmed ? trimmed : undefined;
}

function normalizeGlobalMemoryWorkspaceRoot(workspaceRoot?: string): string | undefined {
    if (typeof workspaceRoot !== "string") return undefined;
    const trimmed = workspaceRoot.trim();
    return trimmed ? path.resolve(trimmed) : undefined;
}

function parseResidentAgentIdFromConversationId(conversationId?: string): string | undefined {
    if (typeof conversationId !== "string") return undefined;
    const trimmed = conversationId.trim();
    if (!trimmed) return undefined;
    const match = /^agent:([^:]+):/.exec(trimmed);
    return match?.[1];
}

/**
 * Register a MemoryManager instance as the global shared instance.
 * Called by Gateway during startup.
 */
export function registerGlobalMemoryManager(
    manager: MemoryManager,
    options: GlobalMemoryManagerRegistrationOptions = {},
): void {
    registerGlobalMemoryManagerInternal(manager, options);
}

/**
 * Get the globally registered MemoryManager instance.
 * Returns null if no instance has been registered.
 */
export function getGlobalMemoryManager(scope?: GlobalMemoryManagerScope): MemoryManager | null {
    const agentId = normalizeGlobalMemoryAgentId(scope?.agentId)
        ?? parseResidentAgentIdFromConversationId(scope?.conversationId);
    if (agentId) {
        const scoped = scopedGlobalMemoryManagersByAgent.get(agentId);
        if (scoped) return scoped;
    }

    const workspaceRoot = normalizeGlobalMemoryWorkspaceRoot(scope?.workspaceRoot);
    if (workspaceRoot) {
        const scoped = scopedGlobalMemoryManagersByWorkspace.get(workspaceRoot);
        if (scoped) return scoped;
    }

    return globalMemoryManager;
}

export function listGlobalMemoryManagers(): MemoryManager[] {
    const ordered = [
        globalMemoryManager,
        ...scopedGlobalMemoryManagersByAgent.values(),
        ...scopedGlobalMemoryManagersByWorkspace.values(),
    ].filter((item): item is MemoryManager => Boolean(item));
    return [...new Set(ordered)];
}

export function resetGlobalMemoryManagers(): void {
    globalMemoryManager = null;
    scopedGlobalMemoryManagersByAgent.clear();
    scopedGlobalMemoryManagersByWorkspace.clear();
}

function registerGlobalMemoryManagerInternal(
    manager: MemoryManager,
    options: GlobalMemoryManagerRegistrationOptions = {},
): void {
    const normalizedAgentId = normalizeGlobalMemoryAgentId(options.agentId);
    const normalizedWorkspaceRoot = normalizeGlobalMemoryWorkspaceRoot(options.workspaceRoot);
    const hasScopedRegistration = Boolean(normalizedAgentId || normalizedWorkspaceRoot);

    if (!hasScopedRegistration) {
        scopedGlobalMemoryManagersByAgent.clear();
        scopedGlobalMemoryManagersByWorkspace.clear();
    }

    if (options.isDefault === true || !hasScopedRegistration || !globalMemoryManager) {
        globalMemoryManager = manager;
    }
    if (normalizedAgentId) {
        scopedGlobalMemoryManagersByAgent.set(normalizedAgentId, manager);
    }
    if (normalizedWorkspaceRoot) {
        scopedGlobalMemoryManagersByWorkspace.set(normalizedWorkspaceRoot, manager);
    }

    const scopeLabels = [
        normalizedAgentId ? `agent=${normalizedAgentId}` : undefined,
        normalizedWorkspaceRoot ? `workspace=${normalizedWorkspaceRoot}` : undefined,
        options.isDefault === true ? "default=true" : undefined,
    ].filter(Boolean);
    console.log(`[MemoryManager] Registered as global instance${scopeLabels.length > 0 ? ` (${scopeLabels.join(", ")})` : ""}`);
}

export type ExtractConversationMemoriesOptions = {
    markKey?: string;
    sourceConversationId?: string;
    sourceLabel?: string;
};

export type ConversationMemoryExtractionSupportReasonCode =
    | "manager_unavailable"
    | "gate_disabled"
    | "model_missing"
    | "base_url_missing"
    | "api_key_missing";

export type ConversationMemoryExtractionSupportReason = {
    code: ConversationMemoryExtractionSupportReasonCode;
    message: string;
};

export type ConversationMemoryExtractionSupport = {
    enabled: boolean;
    available: boolean;
    minMessages: number;
    model?: string;
    hasBaseUrl: boolean;
    hasApiKey: boolean;
    reasons: ConversationMemoryExtractionSupportReason[];
};

export type DurableMemoryCandidateType =
    | "user"
    | "feedback"
    | "project"
    | "reference";

export type DurableMemoryRejectionReasonCode =
    | "code_pattern"
    | "file_path"
    | "git_history"
    | "debug_recipe"
    | "policy_rule";

export type DurableMemoryGuidance = {
    policyVersion: string;
    acceptedCandidateTypes: DurableMemoryCandidateType[];
    rejectedContentTypes: Array<{
        code: DurableMemoryRejectionReasonCode;
        message: string;
    }>;
    summary: string;
};

export type ExtractConversationMemoriesResult = {
    count: number;
    acceptedCandidateTypes: DurableMemoryCandidateType[];
    rejectedCount: number;
    rejectedReasons: DurableMemoryRejectionReasonCode[];
    summary: string;
    skipReason?: DurableExtractionSkipReasonCode | string;
};

type ExtractedConversationMemory = {
    type: string;
    content: string;
    category: string;
    candidateType?: DurableMemoryCandidateType;
    reason?: string;
};

const DURABLE_MEMORY_GUIDANCE: DurableMemoryGuidance = {
    policyVersion: "week9-v1",
    acceptedCandidateTypes: ["user", "feedback", "project", "reference"],
    rejectedContentTypes: [
        { code: "code_pattern", message: "Reject code patterns, architecture snippets, or implementation-shaped content." },
        { code: "file_path", message: "Reject file paths, function names, line references, and project structure details." },
        { code: "git_history", message: "Reject git history, recent diffs, commit references, and transient change logs." },
        { code: "debug_recipe", message: "Reject debugging recipes, shell command playbooks, and short-lived fix procedures." },
        { code: "policy_rule", message: "Reject stable rules already covered by AGENTS.md, CLAUDE.md, README, or other project policy docs." },
    ],
    summary: "Durable extraction should keep only long-lived user/context/project/reference facts and avoid code details, paths, git churn, debugging recipes, and policy docs.",
};

const DURABLE_MEMORY_CATEGORY_TO_CANDIDATE: Record<string, DurableMemoryCandidateType> = {
    preference: "user",
    experience: "feedback",
    fact: "project",
    decision: "project",
    entity: "reference",
};

function normalizeDurableMemoryCandidateType(value: unknown): DurableMemoryCandidateType | undefined {
    switch (value) {
        case "user":
        case "feedback":
        case "project":
        case "reference":
            return value;
        default:
            return undefined;
    }
}

function inferDurableMemoryCandidateType(item: { category?: string; content: string }): DurableMemoryCandidateType {
    const normalizedCategory = typeof item.category === "string" ? item.category.trim().toLowerCase() : "";
    const fromCategory = DURABLE_MEMORY_CATEGORY_TO_CANDIDATE[normalizedCategory];
    if (fromCategory) {
        return fromCategory;
    }
    const content = item.content.trim();
    if (/(反馈|建议|希望|不喜欢|prefer|feedback)/i.test(content)) {
        return "feedback";
    }
    if (/(用户|习惯|偏好|工作方式|长期)/i.test(content)) {
        return "user";
    }
    if (/(项目|约束|决策|阶段|里程碑|依赖|环境)/i.test(content)) {
        return "project";
    }
    return "reference";
}

function detectDurableMemoryRejection(content: string): { code: DurableMemoryRejectionReasonCode; message: string } | undefined {
    if (/[A-Za-z]:\\|(?:^|[\s(])(?:\.{0,2}[\\/])?[\w.-]+(?:[\\/][\w.-]+)+|\b[\w./\\-]+\.(?:ts|tsx|js|jsx|py|go|java|cs|json|md|yaml|yml|sh|ps1|sql)(?::\d+)?\b/.test(content)) {
        return { code: "file_path", message: "Looks like a file path, source location, or project structure detail." };
    }
    if (/\bgit\s+(?:commit|rebase|cherry-pick|merge|reset|checkout|stash|pull|push|log|diff|status)\b/i.test(content)
        || /\bcommit\b.{0,20}\b[0-9a-f]{7,40}\b/i.test(content)
        || /\bPR\s*#\d+\b/i.test(content)) {
        return { code: "git_history", message: "Looks like git history or recent change tracking." };
    }
    if (/\b(?:AGENTS\.md|CLAUDE\.md|README|项目规范|规范文件|coding standard|project policy)\b/i.test(content)) {
        return { code: "policy_rule", message: "Looks like a stable project rule already represented in policy docs." };
    }
    if ((/\b(?:debug|调试|排查|修复|fix|workaround|命令|command)\b/i.test(content))
        && (/[`]/.test(content) || /\b(?:pnpm|npm|yarn|node|python|git|cargo|go|curl|powershell)\b/i.test(content))) {
        return { code: "debug_recipe", message: "Looks like a debugging or command recipe rather than durable context." };
    }
    if (/[`]/.test(content)
        || /\b(?:const|let|var|function|class|interface|type|return|import|export)\b/.test(content)
        || /=>/.test(content)
        || /[{}[\]]/.test(content)) {
        return { code: "code_pattern", message: "Looks like code or implementation detail rather than durable memory." };
    }
    return undefined;
}

function sanitizeExtractionJsonText(raw: string): string {
    return raw
        .replace(/^(?:<think\b[^>]*>[\s\S]*?<\/think>\s*)+/i, "")
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
}

function shouldEnableMiniMaxReasoningSplit(baseUrl: string, model: string): boolean {
    const normalizedBaseUrl = String(baseUrl ?? "").trim().toLowerCase();
    const normalizedModel = String(model ?? "").trim().toLowerCase();
    return normalizedBaseUrl.includes("minimaxi.com") || normalizedModel.startsWith("minimax-");
}

function buildDurableExtractionSummary(input: {
    acceptedCount: number;
    acceptedCandidateTypes: DurableMemoryCandidateType[];
    rejected: Array<{ code: DurableMemoryRejectionReasonCode }>;
}): string {
    const acceptedTypes = [...new Set(input.acceptedCandidateTypes)];
    const rejectedReasons = [...new Set(input.rejected.map((item) => item.code))];
    const parts: string[] = [];
    parts.push(`accepted=${input.acceptedCount}`);
    if (acceptedTypes.length > 0) {
        parts.push(`candidateTypes=${acceptedTypes.join(",")}`);
    }
    if (input.rejected.length > 0) {
        parts.push(`rejected=${input.rejected.length}`);
    }
    if (rejectedReasons.length > 0) {
        parts.push(`rejectedReasons=${rejectedReasons.join(",")}`);
    }
    return parts.join("; ");
}


export interface MemoryManagerOptions {
    workspaceRoot: string;
    /** Additional directories to index alongside workspaceRoot */
    additionalRoots?: string[];
    /** Additional explicit files to index/watch alongside directories */
    additionalFiles?: string[];
    storePath?: string;
    openaiApiKey?: string;
    openaiBaseUrl?: string;
    openaiModel?: string;
    embeddingEnabled?: boolean;
    provider?: "openai" | "local";
    localModel?: string;
    modelsDir?: string;
    indexerOptions?: IndexerOptions;
    embeddingBatchSize?: number;
    rerankerOptions?: RerankerOptions;
    /** L0 摘要层配置 */
    summaryEnabled?: boolean;
    summaryModel?: string;       // 摘要生成用的模型（默认继承 openaiModel）
    summaryBaseUrl?: string;     // 摘要 API base URL（默认继承 openaiBaseUrl）
    summaryApiKey?: string;      // 摘要 API key（默认继承 openaiApiKey）
    summaryBatchSize?: number;   // 每批处理的 chunk 数（默认 5）
    summaryMinContentLength?: number; // 触发摘要的最小内容长度（默认 500）
    /** M-N3: 会话记忆自动提取配置 */
    evolutionEnabled?: boolean;
    evolutionModel?: string;       // 提取用的模型（默认继承 openaiModel）
    evolutionBaseUrl?: string;     // 提取 API base URL（默认继承 openaiBaseUrl）
    evolutionApiKey?: string;      // 提取 API key（默认继承 openaiApiKey）
    evolutionMinMessages?: number; // 触发提取的最少消息数（默认 4）
    /** stateDir 用于定位 memory/ 目录写入每日文件 */
    stateDir?: string;
    /** Task-aware Embedding 前缀（用于支持 task 参数的模型如 Jina/BGE） */
    embeddingQueryPrefix?: string;
    embeddingPassagePrefix?: string;
    /** M-N4: 源路径聚合检索 */
    deepRetrievalEnabled?: boolean;
    /** Task 层总结 */
    taskMemoryEnabled?: boolean;
    taskSummaryEnabled?: boolean;
    taskSummaryModel?: string;
    taskSummaryBaseUrl?: string;
    taskSummaryApiKey?: string;
    taskSummaryMinDurationMs?: number;
    taskSummaryMinToolCalls?: number;
    taskSummaryMinTokenTotal?: number;
    conversationStore?: TaskConversationStore;
    /** P5: Task 完成后自动生成经验候选（只落到 experience_candidates） */
    experienceAutoPromotionEnabled?: boolean;
    experienceAutoMethodEnabled?: boolean;
    experienceAutoSkillEnabled?: boolean;
}

export type ContextInjectionMemory = MemorySearchResult & {
    importance: MemoryImportance;
    importanceScore: number;
    rationale: string[];
};

export type RecentTaskSummary = {
    taskId: string;
    title?: string;
    objective?: string;
    summary?: string;
    status: TaskRecord["status"];
    source: TaskRecord["source"];
    finishedAt?: string;
    updatedAt?: string;
    agentId?: string;
    toolNames: string[];
    artifactPaths: string[];
    workRecap?: TaskRecord["workRecap"];
    resumeContext?: TaskRecord["resumeContext"];
};

export type TaskWorkShortcutItem = {
    taskId: string;
    conversationId: string;
    title?: string;
    objective?: string;
    summary?: string;
    status: TaskRecord["status"];
    source: TaskRecord["source"];
    startedAt: string;
    finishedAt?: string;
    updatedAt: string;
    agentId?: string;
    toolNames: string[];
    artifactPaths: string[];
    workRecap?: TaskRecord["workRecap"];
    resumeContext?: TaskRecord["resumeContext"];
    recentActivityTitles: string[];
    matchReasons?: string[];
};

function toRecentTaskSummary(task: TaskSummaryRecord): RecentTaskSummary {
    return {
        taskId: task.id,
        title: task.title,
        objective: task.objective,
        summary: task.summary,
        status: task.status,
        source: task.source,
        finishedAt: task.finishedAt,
        updatedAt: task.updatedAt,
        agentId: task.agentId,
        toolNames: task.toolNames,
        artifactPaths: task.artifactPaths,
        workRecap: task.workRecap,
        resumeContext: task.resumeContext,
    };
}

export class MemoryManager {
    private store: MemoryStore;
    private indexer: MemoryIndexer;
    private reranker: ResultReranker;
    private embeddingProvider: EmbeddingProvider;
    private workspaceRoot: string;
    private additionalRoots: string[];
    private additionalFiles: string[];
    private embeddingBatchSize: number;
    // 后台任务暂停控制（Agent 活跃时暂停，避免抢占 API 并发）
    private _paused = false;
    private _pauseResolve: (() => void) | null = null;
    private _summaryRunning = false;
    // L0 摘要层
    private summaryEnabled: boolean;
    private summaryModel: string;
    private summaryBaseUrl: string;
    private summaryApiKey: string;
    private summaryBatchSize: number;
    private summaryMinContentLength: number;
    // M-N3: 会话记忆自动提取
    private evolutionEnabled: boolean;
    private evolutionModel: string;
    private evolutionBaseUrl: string;
    private evolutionApiKey: string;
    private evolutionMinMessages: number;
    private stateDir: string;
    /** 用于 embedding 缓存 key / 签名版本化（task-aware embedding） */
    private embeddingQueryPrefix: string;
    private embeddingPassagePrefix: string;
    // M-N4: 源路径聚合检索
    private deepRetrievalEnabled: boolean;
    private taskProcessor: TaskProcessor;
    private experiencePromoter: ExperiencePromoter;
    private experienceAutoPromotionEnabled: boolean;
    private experienceAutoMethodEnabled: boolean;
    private experienceAutoSkillEnabled: boolean;
    private publishStateDir: string;

    private logEmbeddingSyncSummary(stats: {
        batchCount: number;
        totalChunks: number;
        cacheHits: number;
        cacheMisses: number;
        apiRequestCount: number;
        apiChunkCount: number;
    }): void {
        if (stats.batchCount <= 0 || stats.totalChunks <= 0) return;
        console.log(
            `[MemoryManager] Embedding sync processed ${stats.totalChunks} chunks in ${stats.batchCount} batch(es): `
            + `cacheHits=${stats.cacheHits}, cacheMisses=${stats.cacheMisses}, `
            + `apiRequests=${stats.apiRequestCount}, apiChunks=${stats.apiChunkCount}`,
        );
    }

    constructor(options: MemoryManagerOptions) {
        this.workspaceRoot = options.workspaceRoot;
        this.additionalRoots = options.additionalRoots ?? [];
        this.additionalFiles = options.additionalFiles ?? [];

        // Default store path: .star_sanctuary/memory.sqlite（带旧目录回退）
        const workspaceStateDir = resolveWorkspaceStateDir(options.workspaceRoot);
        const defaultStorePath = path.join(workspaceStateDir, "memory.sqlite");
        const storePath = options.storePath || defaultStorePath;

        // Ensure dir exists synchronously
        try {
            const dir = path.dirname(storePath);
            mkdirSync(dir, { recursive: true });
        } catch (err) {
            console.warn("Failed to create memory directory:", err);
        }

        this.store = new MemoryStore(storePath);

        // Initialize Embedding Provider
        if (options.embeddingEnabled === false) {
            this.embeddingProvider = {
                modelName: "none",
                embed: async () => [],
                embedBatch: async (texts) => texts.map(() => []),
            };
            console.log("[MemoryManager] Embedding disabled by config — using keyword search only.");
        } else if (options.provider === "local") {
            const modelName = options.localModel || "BAAI/bge-m3";
            const modelsDir = options.modelsDir || path.join(workspaceStateDir, "models");
            this.embeddingProvider = new LocalEmbeddingProvider(modelName, modelsDir);
            console.log(`[MemoryManager] Using Local Embedding Provider (${modelName})`);
        } else if (options.openaiApiKey) {
            // 仅在 API Key 存在时才初始化 OpenAI Provider，避免 SDK 构造时因缺少 Key 而抛出异常
            this.embeddingProvider = new OpenAIEmbeddingProvider({
                apiKey: options.openaiApiKey,
                baseURL: options.openaiBaseUrl,
                model: options.openaiModel,
                queryPrefix: options.embeddingQueryPrefix,
                passagePrefix: options.embeddingPassagePrefix,
            });
            console.log(`[MemoryManager] Using OpenAI Embedding Provider (${options.openaiModel || "text-embedding-3-small"})`);
        } else {
            // API Key 缺失时使用空 Provider，仅支持关键词检索，不影响正常启动
            this.embeddingProvider = {
                modelName: "none",
                embed: async () => [],
                embedBatch: async (texts) => texts.map(() => []),
            };
            console.warn("[MemoryManager] No API key for embedding — vector search disabled. Configure via WebChat settings.");
        }

        this.indexer = new MemoryIndexer(this.store, options.indexerOptions);
        this.reranker = new ResultReranker(options.rerankerOptions);
        this.embeddingBatchSize = options.embeddingBatchSize || 10;

        // L0 摘要层配置
        this.summaryEnabled = options.summaryEnabled ?? false;
        this.summaryModel = options.summaryModel || options.openaiModel || "";
        this.summaryBaseUrl = options.summaryBaseUrl || options.openaiBaseUrl || "";
        this.summaryApiKey = options.summaryApiKey || options.openaiApiKey || "";
        this.summaryBatchSize = options.summaryBatchSize ?? 5;
        this.summaryMinContentLength = options.summaryMinContentLength ?? 500;

        // M-N3: 会话记忆自动提取配置
        this.evolutionEnabled = options.evolutionEnabled ?? false;
        this.evolutionModel = options.evolutionModel || options.openaiModel || "";
        this.evolutionBaseUrl = options.evolutionBaseUrl || options.openaiBaseUrl || "";
        this.evolutionApiKey = options.evolutionApiKey || options.openaiApiKey || "";
        this.evolutionMinMessages = options.evolutionMinMessages ?? 4;
        this.stateDir = options.stateDir || resolveStateDir(process.env);
        this.publishStateDir = options.stateDir || workspaceStateDir;
        this.embeddingQueryPrefix = options.embeddingQueryPrefix ?? "";
        this.embeddingPassagePrefix = options.embeddingPassagePrefix ?? "";
        this.deepRetrievalEnabled = options.deepRetrievalEnabled ?? false;
        const taskSummarizer = new TaskSummarizer({
            enabled: options.taskSummaryEnabled ?? false,
            model: options.taskSummaryModel,
            baseUrl: options.taskSummaryBaseUrl,
            apiKey: options.taskSummaryApiKey,
        });
        this.taskProcessor = new TaskProcessor(this.store, {
            enabled: options.taskMemoryEnabled ?? false,
            conversationStore: options.conversationStore,
            summarizer: taskSummarizer,
            summaryMinDurationMs: options.taskSummaryMinDurationMs,
            summaryMinToolCalls: options.taskSummaryMinToolCalls,
            summaryMinTokenTotal: options.taskSummaryMinTokenTotal,
        });
        this.experiencePromoter = new ExperiencePromoter(this.store, this.publishStateDir);
        this.experienceAutoPromotionEnabled = options.experienceAutoPromotionEnabled ?? true;
        this.experienceAutoMethodEnabled = options.experienceAutoMethodEnabled ?? true;
        this.experienceAutoSkillEnabled = options.experienceAutoSkillEnabled ?? true;
    }

    /**
     * Index files in the workspace
     */
    async indexWorkspace(): Promise<void> {
        // Index primary workspace root
        await this.indexer.indexDirectory(this.workspaceRoot);

        // Index additional roots (e.g. workspace memory files)
        for (const root of this.additionalRoots) {
            try {
                await this.indexer.indexDirectory(root);
            } catch (err) {
                console.warn(`[MemoryManager] Failed to index additional root ${root}:`, err);
            }
        }

        // Index explicit files (e.g. stateDir/MEMORY.md)
        for (const filePath of this.additionalFiles) {
            try {
                const stats = await fs.stat(filePath);
                if (stats.isFile()) {
                    await this.indexer.indexFile(filePath);
                }
            } catch (err) {
                const code = (err as NodeJS.ErrnoException | undefined)?.code;
                if (code !== "ENOENT") {
                    console.warn(`[MemoryManager] Failed to index additional file ${filePath}:`, err);
                }
            }
        }

        await this.processPendingEmbeddings();

        // L0 摘要不再在启动时自动运行，改由 gateway 空闲定时器触发（runIdleSummaries）

        // Watch all directories for changes
        const allRoots = dedupePaths([this.workspaceRoot, ...this.additionalRoots, ...this.additionalFiles]);
        await this.indexer.startWatching(allRoots);
    }

    /**
     * Search memory (Hybrid)
     */
    async search(query: string, limitOrOptions?: number | MemorySearchOptions): Promise<MemorySearchResult[]> {
        // 兼容旧签名 search(query, limit) 和新签名 search(query, options)
        let limit = 5;
        let filter: MemorySearchFilter | undefined;
        let retrievalMode: MemorySearchOptions["retrievalMode"] = "explicit";
        let includeContent = true;

        if (typeof limitOrOptions === "number") {
            limit = limitOrOptions;
        } else if (limitOrOptions) {
            limit = limitOrOptions.limit ?? 5;
            filter = limitOrOptions.filter;
            retrievalMode = limitOrOptions.retrievalMode ?? "explicit";
            includeContent = limitOrOptions.includeContent !== false;
        }

        // 0. 自适应检索：仅对隐式召回生效，显式 memory_search / RPC 不应被跳过
        if (retrievalMode === "implicit" && shouldSkipRetrieval(query)) {
            return [];
        }

        // 1. Embed query（使用 embedQuery 以支持 task-aware embedding）
        let queryVec: number[] | null = null;
        try {
            queryVec = await (this.embeddingProvider.embedQuery
                ? this.embeddingProvider.embedQuery(query)
                : this.embeddingProvider.embed(query));
        } catch (err) {
            console.warn("Embedding failed, falling back to keyword search only", err);
        }

        // 2. Hybrid search with filter
        const rawResults = this.store.searchHybrid(query, queryVec, { limit: limit * 2, filter, includeContent });

        // 3. Rule-based rerank (with MMR diversity if vectors available)
        const getVector = (chunkId: string) => this.store.getChunkVector(chunkId);
        const reranked = this.reranker.rerank(rawResults, getVector);

        // 4. M-N4: 源路径聚合二次检索（仅当启用且有重复 source 时触发）
        if (this.deepRetrievalEnabled) {
            return this.applyDeepRetrieval(reranked, limit);
        }

        return reranked.slice(0, limit);
    }

    async embedRetrievalQuery(text: string): Promise<number[] | null> {
        const normalized = String(text ?? "").trim();
        if (!normalized) return null;
        try {
            const vector = await (this.embeddingProvider.embedQuery
                ? this.embeddingProvider.embedQuery(normalized)
                : this.embeddingProvider.embed(normalized));
            return Array.isArray(vector) && vector.length > 0 ? vector : null;
        } catch {
            return null;
        }
    }

    async embedRetrievalPassages(texts: string[]): Promise<Array<number[] | null>> {
        const normalizedTexts = Array.isArray(texts)
            ? texts.map((item) => String(item ?? "").trim())
            : [];
        if (normalizedTexts.length <= 0) {
            return [];
        }
        try {
            const vectors = await this.embeddingProvider.embedBatch(normalizedTexts);
            return normalizedTexts.map((_, index) => {
                const vector = vectors[index];
                return Array.isArray(vector) && vector.length > 0 ? vector : null;
            });
        } catch {
            return normalizedTexts.map(() => null);
        }
    }

    getEmbeddingRuntimeCacheKey(): string {
        return [
            this.embeddingProvider.modelName ?? "unknown",
            this.embeddingQueryPrefix ?? "",
            this.embeddingPassagePrefix ?? "",
        ].join("|");
    }

    /**
     * Get recent memory chunks (by updated_at, no embedding needed)
     */
    getRecent(limit = 5, filter?: MemorySearchFilter, includeContent = true): MemorySearchResult[] {
        return this.store.getRecentChunks(limit, filter, includeContent);
    }

    countChunks(filter?: MemorySearchFilter): number {
        return this.store.countChunks(filter);
    }

    async previewSourceInventory(options: {
        configuredSources?: MemorySourceInventoryConfiguredSource[];
    } = {}): Promise<MemorySourceInventoryReport> {
        return await buildMemorySourceInventoryReport({
            stateDir: this.stateDir,
            memoryStatus: this.getStatus(),
            taskStats: this.store.getTaskInventoryStats(),
            experienceStats: this.store.getExperienceInventoryStats(),
            configuredSources: options.configuredSources ?? [],
        });
    }

    async rebuildMemoryTreeSources(options: {
        configuredSources?: MemorySourceInventoryConfiguredSource[];
    } = {}): Promise<MemoryTreeSourceRebuildResult> {
        const report = await this.previewSourceInventory(options);
        const rebuiltAt = new Date().toISOString();
        const inventoryRecords = report.items.map((item) => buildInventoryMemorySourceRecord(item, rebuiltAt));
        const inventoryIds = new Set(inventoryRecords.map((item) => item.id));
        const dynamicRecords: MemoryTreeSourceRecord[] = [];

        for (const summary of this.store.listChunkSourceSummaries()) {
            const matchedInventoryId = this.resolvePreferredMemorySourceId(summary.sourcePath, summary.sourceType, summary.memoryTypes, inventoryRecords);
            if (matchedInventoryId && inventoryIds.has(matchedInventoryId)) {
                continue;
            }
            const classification = classifyMemoryTreeSource(summary.sourcePath, summary.sourceType, summary.memoryTypes);
            dynamicRecords.push({
                id: buildDynamicMemorySourceId(summary.sourcePath, summary.sourceType, summary.agentId),
                sourceKind: classification.sourceKind,
                sourceClass: classification.sourceClass,
                scope: summary.scope,
                agentId: summary.agentId,
                sourcePath: summary.sourcePath,
                sourceRef: summary.sourceType,
                contentHash: hashMemoryTreePayload({
                    sourcePath: summary.sourcePath,
                    sourceType: summary.sourceType,
                    agentId: summary.agentId ?? null,
                    itemCount: summary.itemCount,
                    timeTo: summary.timeTo ?? null,
                }),
                timeFrom: summary.timeFrom,
                timeTo: summary.timeTo,
                itemCount: summary.itemCount,
                metadata: {
                    recordType: "dynamic_chunk_source",
                    sourceType: summary.sourceType,
                    memoryTypes: summary.memoryTypes,
                },
                createdAt: rebuiltAt,
                updatedAt: rebuiltAt,
            });
        }

        const records = [...inventoryRecords, ...dynamicRecords];
        this.store.upsertMemorySources(records);
        this.store.setMeta("memory_tree_sources_last_rebuilt_at", rebuiltAt);
        return {
            rebuiltAt,
            totalSources: records.length,
            inventorySources: inventoryRecords.length,
            dynamicSources: dynamicRecords.length,
        };
    }

    listMemoryTreeSources(limit = 100, filter?: MemoryTreeSourceListFilter): MemoryTreeSourceRecord[] {
        return this.store.listMemorySources(limit, filter);
    }

    rebuildMemoryTreeScores(): MemoryTreeScoreRebuildResult {
        const rebuiltAt = new Date().toISOString();
        const sources = this.store.listMemorySources(10_000);
        const sourceMap = new Map(sources.map((item) => [item.id, item] as const));
        const records: MemoryTreeScoreRecord[] = this.store.listChunkScoreInputs().map((input) => {
            const fallbackClassification = classifyMemoryTreeSource(
                input.sourcePath,
                input.sourceType,
                input.memoryType ? [input.memoryType] : undefined,
            );
            const sourceId = this.resolvePreferredMemorySourceId(input.sourcePath, input.sourceType, input.memoryType ? [input.memoryType] : undefined, sources)
                ?? buildDynamicMemorySourceId(input.sourcePath, input.sourceType, input.agentId);
            const sourceRecord = sourceMap.get(sourceId) ?? {
                id: sourceId,
                sourceKind: fallbackClassification.sourceKind,
                sourceClass: fallbackClassification.sourceClass,
                scope: input.visibility === "shared" ? "shared" : "private",
            };
            const score = buildRuleOnlyChunkScore(input, sourceRecord);
            return {
                id: `score:${MEMORY_TREE_SCORE_VERSION}:chunk:${input.chunkId}`,
                targetType: "chunk",
                targetId: input.chunkId,
                sourceId,
                scoreTotal: score.scoreTotal,
                recencyScore: score.recencyScore,
                sourceWeightScore: score.sourceWeightScore,
                interactionScore: score.interactionScore,
                taskOutcomeScore: score.taskOutcomeScore,
                entityDensityScore: score.entityDensityScore,
                scoreVersion: MEMORY_TREE_SCORE_VERSION,
                rationale: score.rationale,
                createdAt: rebuiltAt,
                updatedAt: rebuiltAt,
            };
        });
        this.store.upsertMemoryScores(records);
        this.store.setMeta("memory_tree_scores_last_rebuilt_at", rebuiltAt);
        return {
            rebuiltAt,
            scoreVersion: MEMORY_TREE_SCORE_VERSION,
            totalScores: records.length,
        };
    }

    listMemoryTreeScores(limit = 100, filter?: MemoryTreeScoreListFilter): MemoryTreeScoreRecord[] {
        return this.store.listMemoryScores(limit, filter);
    }

    recordMemoryTreeReport(input: {
        reportType: MemoryTreeReportType;
        summary: Record<string, unknown>;
        details: Record<string, unknown>;
        scope?: MemoryTreeSourceRecord["scope"];
        agentId?: string;
        status?: MemoryTreeReportStatus;
        inputVersion?: string;
        createdBy?: string;
        exportMarkdownPath?: string;
        reportId?: string;
    }): MemoryTreeReportRecord {
        const persistedAt = new Date().toISOString();
        const reportId = input.reportId ?? buildMemoryTreeReportId({
            reportType: input.reportType,
            inputVersion: input.inputVersion,
            summary: input.summary,
            details: input.details,
            scope: input.scope ?? "private",
            agentId: input.agentId,
        });
        const record: MemoryTreeReportRecord = {
            id: reportId,
            reportType: input.reportType,
            scope: input.scope ?? "private",
            agentId: input.agentId,
            status: input.status ?? "ready",
            inputVersion: input.inputVersion,
            summary: input.summary,
            details: input.details,
            exportMarkdownPath: input.exportMarkdownPath,
            createdBy: input.createdBy,
            createdAt: persistedAt,
            updatedAt: persistedAt,
        };
        this.store.upsertMemoryCleanReports([record]);
        return this.store.getMemoryCleanReport(reportId) ?? record;
    }

    listMemoryTreeReports(limit = 50, filter?: MemoryTreeReportListFilter): MemoryTreeReportRecord[] {
        return this.store.listMemoryCleanReports(limit, filter);
    }

    getMemoryTreeReport(reportId: string): MemoryTreeReportRecord | null {
        return this.store.getMemoryCleanReport(reportId);
    }

    async exportMemoryTreeReportMarkdown(reportId: string, destinationPath?: string): Promise<{ report: MemoryTreeReportRecord; markdownPath: string }> {
        const report = this.store.getMemoryCleanReport(reportId);
        if (!report) {
            throw new Error(`Memory tree report not found: ${reportId}`);
        }
        const markdownPath = destinationPath ?? path.join(this.stateDir, "reports", "memory-tree", `${sanitizePathSegment(reportId)}.md`);
        await fs.mkdir(path.dirname(markdownPath), { recursive: true });
        const content = buildMemoryTreeReportMarkdown(report);
        await fs.writeFile(markdownPath, content, "utf-8");
        this.store.upsertMemoryCleanReports([{
            ...report,
            exportMarkdownPath: markdownPath,
            updatedAt: new Date().toISOString(),
        }]);
        const next = this.store.getMemoryCleanReport(reportId) ?? { ...report, exportMarkdownPath: markdownPath };
        return { report: next, markdownPath };
    }

    persistMemoryTreeInventoryReport(report: MemorySourceInventoryReport, options: { configuredSources?: MemorySourceInventoryConfiguredSource[]; createdBy?: string } = {}): MemoryTreeReportRecord {
        const summary = {
            reportVersion: report.version,
            sourceKinds: report.totals.sourceKinds,
            presentSourceKinds: report.totals.presentSourceKinds,
            declaredSourceKinds: report.totals.declaredSourceKinds,
            missingSourceKinds: report.totals.missingSourceKinds,
            fileCount: report.totals.fileCount,
            rowCount: report.totals.rowCount,
            totalBytes: report.totals.totalBytes,
            indexedFiles: report.totals.indexedFiles,
            indexedChunks: report.totals.indexedChunks,
            byClass: report.totals.byClass,
            byScope: report.totals.byScope,
        };
        const details = {
            generatedAt: report.generatedAt,
            stateDir: report.stateDir,
            items: report.items,
            configuredSources: options.configuredSources ?? [],
        };
        return this.recordMemoryTreeReport({
            reportType: "inventory",
            scope: "private",
            createdBy: options.createdBy ?? "rpc",
            inputVersion: hashMemoryTreePayload({
                reportVersion: report.version,
                totals: summary,
                configuredSources: options.configuredSources ?? [],
            }),
            summary,
            details,
        });
    }

    persistMemoryTreeDedupPreviewReport(report: MemoryExactDedupPreviewReport, options: { filter?: MemorySearchFilter; maxGroups?: number; createdBy?: string } = {}): MemoryTreeReportRecord {
        const summary = {
            mode: report.mode,
            strategy: report.strategy,
            scannedChunks: report.totals.scannedChunks,
            duplicateGroups: report.totals.duplicateGroups,
            removableChunks: report.totals.removableChunks,
            estimatedRetainedChunks: Math.max(0, report.totals.scannedChunks - report.totals.removableChunks),
        };
        const details = {
            observability: report.observability,
            sourceIndexingSummary: report.sourceIndexingSummary,
            groups: report.groups,
            filter: options.filter ?? null,
            maxGroups: options.maxGroups ?? null,
        };
        return this.recordMemoryTreeReport({
            reportType: "dedup_preview",
            scope: "private",
            createdBy: options.createdBy ?? "rpc",
            inputVersion: hashMemoryTreePayload({
                filter: options.filter ?? null,
                maxGroups: options.maxGroups ?? null,
                mode: report.mode,
                strategy: report.strategy,
                totals: summary,
            }),
            summary,
            details,
        });
    }

    rebuildMemoryTreeNodes(options: { limit?: number } = {}): MemoryTreeNodeRebuildResult {
        const rebuiltAt = new Date().toISOString();
        const limit = typeof options.limit === "number" && Number.isFinite(options.limit)
            ? Math.max(1, Math.floor(options.limit))
            : 100;
        const tasks = this.store.listTasks(limit, { status: ["success", "partial", "failed"] });
        const nodes: MemoryTreeNodeRecord[] = [];
        const edges: MemoryTreeEdgeRecord[] = [];

        for (const task of tasks) {
            const detail = this.getTaskDetail(task.id);
            if (!detail) {
                continue;
            }
            const linkedChunks = detail.memoryLinks ?? [];
            const sourceClassMix = buildMemoryTreeSourceClassMix(linkedChunks);
            nodes.push({
                id: `task:${task.id}`,
                level: 1,
                kind: "task",
                scope: task.agentId ? "private" : "private",
                agentId: task.agentId ?? undefined,
                topicKey: task.conversationId,
                title: task.title ?? task.objective ?? `Task ${task.id}`,
                summary: buildMemoryTreeTaskSummary(detail),
                summaryVersion: "p10-task-node-v1",
                timeFrom: task.startedAt,
                timeTo: task.finishedAt ?? task.updatedAt,
                sourceClassMix,
                metadata: {
                    taskId: task.id,
                    conversationId: task.conversationId,
                    status: task.status,
                    linkedChunkCount: linkedChunks.length,
                    activityCount: detail.activities?.length ?? 0,
                    usedMethodCount: detail.usedMethods?.length ?? 0,
                    usedSkillCount: detail.usedSkills?.length ?? 0,
                },
                createdAt: rebuiltAt,
                updatedAt: rebuiltAt,
            });
            linkedChunks.forEach((link, index) => {
                edges.push({
                    id: `edge:task:${task.id}:chunk:${link.chunkId}:${link.relation}`,
                    parentNodeId: `task:${task.id}`,
                    childType: "chunk",
                    childId: link.chunkId,
                    relation: "contains",
                    position: index,
                    weight: 1,
                    metadata: {
                        relation: link.relation,
                        sourcePath: link.sourcePath,
                        memoryType: link.memoryType,
                        visibility: link.visibility,
                    },
                    createdAt: rebuiltAt,
                });
            });
        }

        this.store.upsertMemoryTreeNodes(nodes);
        this.store.upsertMemoryTreeEdges(edges);
        this.recordMemoryTreeReport({
            reportType: "tree_build_preview",
            scope: "private",
            createdBy: "rpc",
            inputVersion: hashMemoryTreePayload({
                taskLimit: limit,
                taskCount: tasks.length,
            }),
            summary: {
                nodeKind: "task",
                nodeCount: nodes.length,
                edgeCount: edges.length,
                taskLimit: limit,
            },
            details: {
                rebuiltAt,
                nodes,
                edges,
            },
        });
        this.store.setMeta("memory_tree_nodes_last_rebuilt_at", rebuiltAt);
        return {
            rebuiltAt,
            totalNodes: nodes.length,
            totalEdges: edges.length,
            kind: "task",
        };
    }

    listMemoryTreeNodes(limit = 100, filter?: MemoryTreeNodeListFilter): MemoryTreeNodeRecord[] {
        return this.store.listMemoryTreeNodes(limit, filter);
    }

    getMemoryTreeNode(nodeId: string): MemoryTreeNodeRecord | null {
        return this.store.getMemoryTreeNode(nodeId);
    }

    listMemoryTreeEdges(filter?: MemoryTreeEdgeListFilter): MemoryTreeEdgeRecord[] {
        return this.store.listMemoryTreeEdges(filter);
    }

    previewExactDedup(filter?: MemorySearchFilter, options: { maxGroups?: number } = {}): MemoryExactDedupPreviewReport {
        const report = this.store.previewExactDedup(filter, options);
        const dbStats = this.store.getDatabasePageStats();
        return this.decorateExactDedupPreviewReport(report, dbStats);
    }

    applyExactDedup(filter: MemorySearchFilter | undefined, options: MemoryExactDedupApplyOptions): MemoryExactDedupApplyResult {
        const beforeDbStats = this.store.getDatabasePageStats();
        const result = this.store.applyExactDedup(filter, options);
        const afterDbStats = this.store.getDatabasePageStats();
        return {
            ...result,
            observability: {
                beforeChunkCount: result.totals.scannedChunks,
                afterChunkCount: Math.max(0, result.totals.scannedChunks - result.totals.removedChunks),
                beforePageCount: beforeDbStats.pageCount,
                afterPageCount: afterDbStats.pageCount,
                beforeFreelistCount: beforeDbStats.freelistCount,
                afterFreelistCount: afterDbStats.freelistCount,
            },
        };
    }

    private decorateExactDedupPreviewReport(
        report: MemoryExactDedupPreviewReport,
        dbStats: { pageCount: number; freelistCount: number },
    ): MemoryExactDedupPreviewReport {
        const sourceInfoCache = new Map<string, MemoryDedupSourceIndexInfo>();
        const uniqueSourcePaths = new Set<string>();
        let duplicateGroupsWithReindexableSources = 0;
        let duplicateGroupsWithOnlyNonReindexableSources = 0;

        const classifySourcePath = (sourcePath: string): MemoryDedupSourceIndexInfo => {
            const cacheKey = String(sourcePath ?? "").trim();
            const cached = sourceInfoCache.get(cacheKey);
            if (cached) {
                return cached;
            }
            const resolved = this.classifyDedupSourcePath(cacheKey);
            sourceInfoCache.set(cacheKey, resolved);
            return resolved;
        };

        const groups = report.groups.map((group) => {
            const keep = {
                ...group.keep,
                sourceIndexing: classifySourcePath(group.keep.sourcePath),
            };
            const remove = group.remove.map((item) => ({
                ...item,
                sourceIndexing: classifySourcePath(item.sourcePath),
            }));
            const groupSourceInfos = group.affectedSourcePaths.map((sourcePath) => {
                uniqueSourcePaths.add(sourcePath);
                return classifySourcePath(sourcePath);
            });
            const sourceIndexing = summarizeDedupGroupSourceIndexing(groupSourceInfos);
            if (sourceIndexing.anyAffectedSourcePathReindexable) {
                duplicateGroupsWithReindexableSources += 1;
            } else {
                duplicateGroupsWithOnlyNonReindexableSources += 1;
            }
            return {
                ...group,
                keep,
                remove,
                sourceIndexing,
            };
        });

        let reindexableSourcePathCount = 0;
        let nonReindexableSourcePathCount = 0;
        for (const sourcePath of uniqueSourcePaths) {
            const info = classifySourcePath(sourcePath);
            if (info.reindexable) {
                reindexableSourcePathCount += 1;
            } else {
                nonReindexableSourcePathCount += 1;
            }
        }

        const sourceIndexingSummary: MemoryDedupSourceIndexSummary = {
            reindexableSourcePathCount,
            nonReindexableSourcePathCount,
            duplicateGroupsWithReindexableSources,
            duplicateGroupsWithOnlyNonReindexableSources,
        };

        return {
            ...report,
            groups,
            observability: {
                beforeChunkCount: report.totals.scannedChunks,
                estimatedAfterChunkCount: Math.max(0, report.totals.scannedChunks - report.totals.removableChunks),
                pageCount: dbStats.pageCount,
                freelistCount: dbStats.freelistCount,
            },
            sourceIndexingSummary,
        };
    }

    private classifyDedupSourcePath(sourcePath: string): MemoryDedupSourceIndexInfo {
        const normalizedSourcePath = String(sourcePath ?? "").trim();
        if (!normalizedSourcePath) {
            return {
                reindexable: false,
                scope: "external",
                matchedPath: null,
            };
        }

        const stateMemoryFilePath = path.resolve(this.publishStateDir, "MEMORY.md");
        const stateMemoryRootPath = path.resolve(this.publishStateDir, "memory");
        const teamMemoryFilePath = path.resolve(this.publishStateDir, "team-memory", "MEMORY.md");
        const teamMemoryRootPath = path.resolve(this.publishStateDir, "team-memory", "memory");

        if (!path.isAbsolute(normalizedSourcePath)) {
            const normalizedRelative = normalizedSourcePath.replace(/\\/g, "/").toLowerCase();
            if (normalizedRelative === "memory.md") {
                return {
                    reindexable: true,
                    scope: "state_memory_file",
                    matchedPath: stateMemoryFilePath,
                };
            }
            if (normalizedRelative.startsWith("memory/")) {
                return {
                    reindexable: true,
                    scope: "state_memory_root",
                    matchedPath: stateMemoryRootPath,
                };
            }
            if (normalizedRelative === "team-memory/memory.md") {
                return {
                    reindexable: true,
                    scope: "team_memory_file",
                    matchedPath: teamMemoryFilePath,
                };
            }
            if (normalizedRelative.startsWith("team-memory/memory/")) {
                return {
                    reindexable: true,
                    scope: "team_memory_root",
                    matchedPath: teamMemoryRootPath,
                };
            }
        }

        const candidatePaths = path.isAbsolute(normalizedSourcePath)
            ? [path.resolve(normalizedSourcePath)]
            : dedupePaths([
                path.resolve(this.publishStateDir, normalizedSourcePath),
            ]).map((item) => path.resolve(item));
        const candidateComparablePaths = candidatePaths.map(toComparablePath);

        for (const filePath of this.additionalFiles.map((item) => path.resolve(item))) {
            const comparableFilePath = toComparablePath(filePath);
            if (candidateComparablePaths.includes(comparableFilePath)) {
                return {
                    reindexable: true,
                    scope: deriveIndexedFileScope(filePath, this.publishStateDir, stateMemoryFilePath),
                    matchedPath: filePath,
                };
            }
        }

        if (path.isAbsolute(normalizedSourcePath)) {
            const workspaceRootPath = path.resolve(this.workspaceRoot);
            for (const candidatePath of candidatePaths) {
                if (isPathWithinRoot(candidatePath, workspaceRootPath)) {
                    return {
                        reindexable: true,
                        scope: "workspace_sessions",
                        matchedPath: workspaceRootPath,
                    };
                }
            }
        }

        for (const rootPath of this.additionalRoots.map((item) => path.resolve(item))) {
            for (const candidatePath of candidatePaths) {
                if (isPathWithinRoot(candidatePath, rootPath)) {
                    return {
                        reindexable: true,
                        scope: deriveIndexedRootScope(rootPath, this.publishStateDir, stateMemoryRootPath),
                        matchedPath: rootPath,
                    };
                }
            }
        }

        return {
            reindexable: false,
            scope: "external",
            matchedPath: null,
        };
    }

    getContextInjectionMemories(options: {
        limit?: number;
        agentId?: string | null;
        includeSession?: boolean;
        allowedCategories?: MemoryCategory[];
    } = {}): ContextInjectionMemory[] {
        const limit = options.limit ?? 5;
        const includeSession = options.includeSession ?? false;
        const allowedCategories = options.allowedCategories?.length
            ? new Set(options.allowedCategories)
            : null;

        const recent = this.store.getRecentChunks(Math.max(limit * 6, 24), {
            agentId: options.agentId,
        }, false);

        return recent
            .filter((item) => includeSession || item.memoryType !== "session")
            .filter((item) => !allowedCategories || (!!item.category && allowedCategories.has(item.category)))
            .map((item) => {
                const scored = scoreForContextInjection(item);
                return {
                    ...item,
                    importance: classifyImportance(scored.score),
                    importanceScore: scored.score,
                    rationale: scored.rationale,
                };
            })
            .sort((a, b) => b.importanceScore - a.importanceScore)
            .slice(0, limit);
    }

    getRecentTaskSummaries(limit = 3, filter?: TaskSearchFilter): RecentTaskSummary[] {
        return this.store
            .listTaskSummaries(Math.max(limit * 3, 12), filter)
            .filter((task) => task.status === "success" || task.status === "partial")
            .slice(0, limit)
            .map((task) => toRecentTaskSummary(task));
    }

    getRecentWork(input: {
        query?: string;
        limit?: number;
        filter?: TaskSearchFilter;
    } = {}): TaskWorkShortcutItem[] {
        const limit = clampTaskLookupLimit(input.limit);
        const query = normalizeTaskLookupQuery(input.query);
        const recentCandidates = this.collectTaskShortcutCandidates(Math.max(limit * 6, 24), input.filter);

        if (!query) {
            return recentCandidates
                .sort(compareTaskShortcutRecency)
                .slice(0, limit)
                .map((task) => toTaskWorkShortcutItem(task));
        }

        const fallbackCandidates = this.searchTasks(query, {
            limit: Math.max(limit * 4, 12),
            filter: input.filter,
        })
            .map((task) => this.getTaskDetail(task.id))
            .filter((task): task is TaskExperienceDetail => Boolean(task));

        return rankTaskShortcutCandidates([
            ...recentCandidates,
            ...fallbackCandidates,
        ], query)
            .slice(0, limit)
            .map((item) => toTaskWorkShortcutItem(item.task, item.matchReasons));
    }

    getResumeContext(input: {
        taskId?: string;
        conversationId?: string;
        query?: string;
        filter?: TaskSearchFilter;
    } = {}): TaskWorkShortcutItem | null {
        const directTaskId = typeof input.taskId === "string" ? input.taskId.trim() : "";
        if (directTaskId) {
            const task = this.getTaskDetail(directTaskId);
            return task ? toTaskWorkShortcutItem(task) : null;
        }

        const directConversationId = typeof input.conversationId === "string" ? input.conversationId.trim() : "";
        if (directConversationId) {
            const task = this.getTaskByConversation(directConversationId);
            if (!task) return null;
            const detail = this.getTaskDetail(task.id);
            return detail ? toTaskWorkShortcutItem(detail) : null;
        }

        const limit = clampTaskLookupLimit(input.filter?.status ? 8 : 6);
        const query = normalizeTaskLookupQuery(input.query);
        const recentCandidates = this.collectTaskShortcutCandidates(Math.max(limit * 6, 24), input.filter);
        const fallbackCandidates = query
            ? this.searchTasks(query, {
                limit: Math.max(limit * 4, 12),
                filter: input.filter,
            })
                .map((task) => this.getTaskDetail(task.id))
                .filter((task): task is TaskExperienceDetail => Boolean(task))
            : [];

        const ranked = rankTaskShortcutCandidates([
            ...recentCandidates,
            ...fallbackCandidates,
        ], query, { resumeMode: true });

        return ranked.length > 0
            ? toTaskWorkShortcutItem(ranked[0].task, ranked[0].matchReasons)
            : null;
    }

    findSimilarPastWork(input: {
        query: string;
        limit?: number;
        filter?: TaskSearchFilter;
    }): TaskWorkShortcutItem[] {
        const query = normalizeTaskLookupQuery(input.query);
        if (!query) return [];

        const limit = clampTaskLookupLimit(input.limit);
        const searchCandidates = this.searchTasks(query, {
            limit: Math.max(limit * 5, 15),
            filter: input.filter,
        })
            .map((task) => this.getTaskDetail(task.id))
            .filter((task): task is TaskExperienceDetail => Boolean(task));
        const recentCandidates = this.collectTaskShortcutCandidates(Math.max(limit * 4, 16), input.filter);

        return rankTaskShortcutCandidates([
            ...searchCandidates,
            ...recentCandidates,
        ], query)
            .slice(0, limit)
            .map((item) => toTaskWorkShortcutItem(item.task, item.matchReasons));
    }

    getTaskActivities(taskId: string, limit = 200): TaskActivityRecord[] {
        return this.store.listTaskActivities(taskId, limit);
    }

    findRecentDuplicateToolAction(input: {
        toolName: string;
        actionKey?: string;
        agentId?: string;
        withinMinutes?: number;
    }): TaskRecord | null {
        const actionKey = String(input.actionKey ?? "").trim();
        if (!actionKey) return null;

        const threshold = Date.now() - ((input.withinMinutes ?? 20) * 60 * 1000);
        const candidates = this.store.listTasks(30, {
            agentId: input.agentId,
            status: "success",
        });

        for (const task of candidates) {
            const finishedAt = Date.parse(task.finishedAt ?? task.updatedAt);
            if (!Number.isFinite(finishedAt) || finishedAt < threshold) continue;

            const matched = (task.toolCalls ?? []).some((item) => {
                return item.success && item.toolName === input.toolName && item.actionKey === actionKey;
            });

            if (matched) {
                return task;
            }
        }

        return null;
    }

    startTaskCapture(input: {
        conversationId: string;
        sessionKey: string;
        agentId?: string;
        source: TaskSource;
        objective?: string;
        parentConversationId?: string;
        metadata?: Record<string, unknown>;
    }): string | null {
        return this.taskProcessor.startTask(input);
    }

    recordTaskToolCall(conversationId: string, item: TaskToolCallSummary): void {
        this.taskProcessor.recordToolCall(conversationId, item);
    }

    linkTaskMemories(conversationId: string, chunkIds: string[], relation: TaskMemoryRelation = "used"): void {
        this.taskProcessor.linkMemory(conversationId, chunkIds, relation);
    }

    completeTaskCapture(input: {
        conversationId: string;
        success: boolean;
        durationMs?: number;
        error?: string;
        messages?: unknown[];
    }): string | null {
        const taskId = this.taskProcessor.completeTask(input);
        if (!taskId || !this.experienceAutoPromotionEnabled) {
            return taskId;
        }

        const task = this.store.getTask(taskId);
        if (!task || !this.shouldAutoPromoteTask(task)) {
            return taskId;
        }

        try {
            if (this.experienceAutoMethodEnabled) {
                this.experiencePromoter.promoteTask(taskId, "method");
            }
            if (this.experienceAutoSkillEnabled) {
                this.experiencePromoter.promoteTask(taskId, "skill");
            }
        } catch (err) {
            console.warn("[MemoryManager] Failed to auto-promote experience candidates:", err);
        }

        return taskId;
    }

    getTask(taskId: string): TaskRecord | null {
        return this.store.getTask(taskId);
    }

    getMemory(chunkId: string): MemorySearchResult | null {
        return this.store.getChunk(chunkId);
    }

    getMemoriesBySource(sourcePath: string, limit = 100): MemorySearchResult[] {
        for (const candidatePath of this.resolveSourcePathCandidates(sourcePath)) {
            const chunks = this.store.getChunksBySource(candidatePath, limit);
            if (chunks.length > 0) {
                return chunks;
            }
        }
        return [];
    }

    upsertMemoryChunk(chunk: MemoryChunk): MemorySearchResult | null {
        this.store.upsertChunk(chunk);
        return this.store.getChunk(chunk.id);
    }

    promoteMemoryChunk(chunkId: string): MemorySearchResult | null {
        const updated = this.store.promoteChunkVisibility(chunkId, "shared");
        if (!updated) return null;
        return this.store.getChunk(chunkId);
    }

    promoteMemorySource(sourcePath: string): { count: number; chunks: MemorySearchResult[] } {
        for (const candidatePath of this.resolveSourcePathCandidates(sourcePath)) {
            const count = this.store.promoteSourceVisibility(candidatePath, "shared");
            if (count > 0) {
                return {
                    count,
                    chunks: this.store.getChunksBySource(candidatePath, 100),
                };
            }
        }

        return { count: 0, chunks: [] };
    }

    assignMemorySourceAgent(sourcePath: string, agentId: string): void {
        if (!agentId) return;
        this.store.setSourceAgentId(this.resolveSourcePath(sourcePath), agentId);
    }

    getTaskByConversation(conversationId: string): TaskRecord | null {
        return this.store.getTaskByConversation(conversationId);
    }

    getTaskDetail(taskId: string): TaskExperienceDetail | null {
        const task = this.store.getTask(taskId);
        if (!task) return null;
        const usages = this.store.listExperienceUsages(100, { taskId });
        const usedMethods = usages
            .filter((item) => item.assetType === "method")
            .map((item) => this.toExperienceUsageSummary(item));
        const usedSkills = usages
            .filter((item) => item.assetType === "skill")
            .map((item) => this.toExperienceUsageSummary(item));
        return {
            ...task,
            activities: this.store.listTaskActivities(taskId, 200),
            memoryLinks: this.store.listTaskMemoryLinks(taskId),
            usedMethods,
            usedSkills,
        };
    }

    getRecentTasks(limit = 10, filter?: TaskSearchFilter): TaskRecord[] {
        return this.store.listTasks(limit, filter);
    }

    getTaskChangeSeq(): number {
        return this.store.getTaskChangeSeq();
    }

    getMemoryChangeSeq(): number {
        return this.store.getMemoryChangeSeq();
    }

    searchTasks(query: string, options: TaskSearchOptions = {}): TaskRecord[] {
        const limit = options.limit ?? 10;
        return this.store.searchTasksKeyword(query, limit, options.filter);
    }

    promoteTaskToMethodCandidate(taskId: string): ExperiencePromoteResult | null {
        return this.experiencePromoter.promoteTask(taskId, "method");
    }

    promoteTaskToSkillCandidate(taskId: string): ExperiencePromoteResult | null {
        return this.experiencePromoter.promoteTask(taskId, "skill");
    }

    checkTaskMethodCandidateDuplicate(taskId: string) {
        return this.experiencePromoter.checkTaskDuplicate(taskId, "method");
    }

    checkTaskSkillCandidateDuplicate(taskId: string) {
        return this.experiencePromoter.checkTaskDuplicate(taskId, "skill");
    }

    getExperienceCandidate(candidateId: string): ExperienceCandidate | null {
        return this.store.getExperienceCandidate(candidateId);
    }

    findExperienceCandidateByTaskAndType(taskId: string, type: ExperienceCandidateType): ExperienceCandidate | null {
        return this.store.findExperienceCandidateByTaskAndType(taskId, type);
    }

    upsertExperienceCandidate(candidate: ExperienceCandidate): ExperienceCandidate {
        const existing = this.store.findExperienceCandidateByTaskAndType(candidate.taskId, candidate.type);
        if (existing) {
            return this.store.updateExperienceCandidate(existing.id, {
                status: candidate.status,
                title: candidate.title,
                slug: candidate.slug,
                content: candidate.content,
                summary: candidate.summary,
                qualityScore: candidate.qualityScore,
                sourceTaskSnapshot: candidate.sourceTaskSnapshot,
                publishedPath: candidate.publishedPath,
                reviewedAt: candidate.reviewedAt,
                acceptedAt: candidate.acceptedAt,
                rejectedAt: candidate.rejectedAt,
                metadata: candidate.metadata,
            }) ?? existing;
        }

        this.store.createExperienceCandidate(candidate);
        return this.store.getExperienceCandidate(candidate.id) ?? candidate;
    }

    createExperienceCandidate(candidate: ExperienceCandidate): ExperienceCandidate {
        this.store.createExperienceCandidate(candidate);
        return this.store.getExperienceCandidate(candidate.id) ?? candidate;
    }

    listExperienceCandidates(limit = 20, filter?: ExperienceCandidateListFilter, offset = 0): ExperienceCandidate[] {
        return this.store.listExperienceCandidates(limit, filter, offset);
    }

    getExperienceCandidateStats(filter?: ExperienceCandidateListFilter): ExperienceCandidateStats {
        return this.store.getExperienceCandidateStats(filter);
    }

    previewExperienceCandidateSynthesis(candidateId: string, options: { limit?: number } = {}): ExperienceSynthesisPreviewResult | null {
        const seedCandidate = this.store.getExperienceCandidate(candidateId);
        if (!seedCandidate) return null;
        const candidates = this.store.listExperienceCandidates(1000, {
            type: seedCandidate.type,
            status: "draft",
            synthesisConsumed: false,
        });
        return buildExperienceSynthesisPreview(seedCandidate, candidates, options);
    }

    createSynthesizedExperienceCandidate(input: {
        seedCandidate: ExperienceCandidate;
        sourceCandidates: ExperienceCandidate[];
        title: string;
        slug: string;
        summary?: string;
        content: string;
        metadata?: ExperienceCandidateMetadata;
    }): ExperienceCandidate {
        const now = new Date().toISOString();
        const sourceCount = Array.isArray(input.sourceCandidates) ? input.sourceCandidates.length : 0;
        const sourceScores = (Array.isArray(input.sourceCandidates) ? input.sourceCandidates : [])
            .map((item) => Number(item?.qualityScore))
            .filter((item) => Number.isFinite(item)) as number[];
        const qualityScore = sourceScores.length > 0
            ? Math.min(100, Math.round((sourceScores.reduce((sum, value) => sum + value, 0) / sourceScores.length) + Math.min(10, sourceCount)))
            : input.seedCandidate.qualityScore;
        const sourceTaskId = input.seedCandidate.sourceTaskSnapshot?.taskId || input.seedCandidate.taskId;
        const taskId = `${sourceTaskId}::synth::${randomUUID().slice(0, 8)}`;
        const candidate: ExperienceCandidate = {
            id: `exp_${randomUUID().slice(0, 8)}`,
            taskId,
            type: input.seedCandidate.type,
            status: "draft",
            title: input.title,
            slug: input.slug,
            content: input.content,
            summary: input.summary,
            qualityScore,
            sourceTaskSnapshot: input.seedCandidate.sourceTaskSnapshot,
            createdAt: now,
            metadata: input.metadata,
        };
        return this.createExperienceCandidate(candidate);
    }

    markExperienceCandidatesSynthesisConsumed(input: {
        candidateIds: string[];
        consumedByCandidateId: string;
        consumedRunId?: string;
        consumedAt?: string;
    }): ExperienceCandidate[] {
        const consumedByCandidateId = String(input.consumedByCandidateId ?? "").trim();
        if (!consumedByCandidateId) return [];
        const consumedAt = String(input.consumedAt ?? "").trim() || new Date().toISOString();
        const consumedRunId = String(input.consumedRunId ?? "").trim() || `synth_${randomUUID().slice(0, 8)}`;
        const updatedCandidates: ExperienceCandidate[] = [];
        const seen = new Set<string>();
        for (const rawCandidateId of Array.isArray(input.candidateIds) ? input.candidateIds : []) {
            const candidateId = String(rawCandidateId ?? "").trim();
            if (!candidateId || candidateId === consumedByCandidateId || seen.has(candidateId)) {
                continue;
            }
            seen.add(candidateId);
            const existing = this.store.getExperienceCandidate(candidateId);
            if (!existing) continue;
            const metadata: ExperienceCandidateMetadata = {
                ...(existing.metadata ?? {}),
                synthesisConsumed: {
                    consumed: true,
                    consumedByCandidateId,
                    consumedAt,
                    consumedRunId,
                },
            };
            const updated = this.store.updateExperienceCandidate(candidateId, { metadata });
            if (updated) {
                updatedCandidates.push(updated);
            }
        }
        return updatedCandidates;
    }

    recordExperienceUsage(input: {
        taskId: string;
        assetType: ExperienceAssetType;
        assetKey: string;
        sourceCandidateId?: string;
        usedVia?: ExperienceUsageVia;
    }): ExperienceUsageRecordResult | null {
        const taskId = String(input.taskId ?? "").trim();
        const assetKey = String(input.assetKey ?? "").trim();
        if (!taskId || !assetKey) return null;

        const task = this.store.getTask(taskId);
        if (!task) return null;

        const existing = this.store.findExperienceUsage(taskId, input.assetType, assetKey);
        if (existing) {
            return { usage: existing, reusedExisting: true };
        }

        const usage: ExperienceUsage = {
            id: randomUUID(),
            taskId,
            assetType: input.assetType,
            assetKey,
            sourceCandidateId: input.sourceCandidateId ?? this.inferExperienceSourceCandidateId(input.assetType, assetKey),
            usedVia: input.usedVia ?? "tool",
            createdAt: new Date().toISOString(),
        };
        this.store.createExperienceUsage(usage);
        return {
            usage: this.store.getExperienceUsage(usage.id) ?? usage,
            reusedExisting: false,
        };
    }

    recordMethodUsage(taskId: string, methodFile: string, options: { sourceCandidateId?: string; usedVia?: ExperienceUsageVia } = {}): ExperienceUsageRecordResult | null {
        return this.recordExperienceUsage({
            taskId,
            assetType: "method",
            assetKey: methodFile,
            sourceCandidateId: options.sourceCandidateId,
            usedVia: options.usedVia ?? "tool",
        });
    }

    recordSkillUsage(taskId: string, skillName: string, options: { sourceCandidateId?: string; usedVia?: ExperienceUsageVia } = {}): ExperienceUsageRecordResult | null {
        return this.recordExperienceUsage({
            taskId,
            assetType: "skill",
            assetKey: skillName,
            sourceCandidateId: options.sourceCandidateId,
            usedVia: options.usedVia ?? "tool",
        });
    }

    getExperienceUsage(usageId: string): ExperienceUsage | null {
        return this.store.getExperienceUsage(usageId);
    }

    revokeExperienceUsage(input: {
        usageId?: string;
        taskId?: string;
        assetType?: ExperienceAssetType;
        assetKey?: string;
    }): ExperienceUsage | null {
        const usageId = String(input.usageId ?? "").trim();
        if (usageId) {
            return this.store.deleteExperienceUsage(usageId);
        }

        const taskId = String(input.taskId ?? "").trim();
        const assetKey = String(input.assetKey ?? "").trim();
        if (!taskId || !assetKey || (input.assetType !== "method" && input.assetType !== "skill")) {
            return null;
        }

        return this.store.deleteExperienceUsageByTaskAsset(taskId, input.assetType, assetKey);
    }

    listExperienceUsages(limit = 20, filter?: ExperienceUsageListFilter): ExperienceUsage[] {
        return this.store.listExperienceUsages(limit, filter);
    }

    getExperienceUsageStats(assetType: ExperienceAssetType, assetKey: string): ExperienceUsageStats {
        return this.store.getExperienceUsageStats(assetType, assetKey);
    }

    listExperienceUsageStats(limit = 50, filter?: Pick<ExperienceUsageListFilter, "assetType" | "assetKey" | "sourceCandidateId">): ExperienceUsageStats[] {
        return this.store.listExperienceUsageStats(limit, filter);
    }

    private toExperienceUsageSummary(usage: ExperienceUsage): ExperienceUsageSummary {
        const stats = this.store.getExperienceUsageStats(usage.assetType, usage.assetKey);
        return {
            ...stats,
            usageId: usage.id,
            taskId: usage.taskId,
            assetType: usage.assetType,
            assetKey: usage.assetKey,
            sourceCandidateId: usage.sourceCandidateId ?? stats.sourceCandidateId,
            usedVia: usage.usedVia,
            createdAt: usage.createdAt,
        };
    }

    private inferExperienceSourceCandidateId(assetType: ExperienceAssetType, assetKey: string): string | undefined {
        const normalizedAssetKey = this.normalizeExperienceAssetLookupKey(assetType, assetKey);
        if (!normalizedAssetKey) return undefined;

        const candidates = this.store.listExperienceCandidates(500, {
            type: assetType,
            status: "accepted",
        });

        for (const candidate of candidates) {
            if (assetType === "method") {
                const publishedName = candidate.publishedPath ? path.basename(candidate.publishedPath) : "";
                const slugName = candidate.slug ? `${candidate.slug}.md` : "";
                const titleName = candidate.title ?? "";
                const matched = [
                    publishedName,
                    slugName,
                    titleName,
                ].some((value) => this.normalizeExperienceAssetLookupKey(assetType, value) === normalizedAssetKey);
                if (matched) {
                    return candidate.id;
                }
                continue;
            }

            const skillName = this.extractSkillNameFromCandidate(candidate);
            const publishedDir = candidate.publishedPath ? path.basename(path.dirname(candidate.publishedPath)) : "";
            const matched = [
                skillName,
                candidate.slug,
                candidate.title,
                publishedDir,
            ].some((value) => this.normalizeExperienceAssetLookupKey(assetType, value) === normalizedAssetKey);
            if (matched) {
                return candidate.id;
            }
        }

        return undefined;
    }

    private extractSkillNameFromCandidate(candidate: ExperienceCandidate): string {
        const match = candidate.content.match(/(?:^|\n)name:\s*["']?([^"\n']+)["']?/i);
        return match?.[1]?.trim() || candidate.title;
    }

    private normalizeExperienceAssetKey(value: string | undefined): string {
        return String(value ?? "").trim().toLowerCase();
    }

    private normalizeExperienceAssetLookupKey(assetType: ExperienceAssetType, value: string | undefined): string {
        const normalized = this.normalizeExperienceAssetKey(value)
            .replace(/\\/g, "/")
            .replace(/\/skill\.md$/i, "")
            .replace(/\.md$/i, "")
            .replace(/\s+/g, " ")
            .trim();
        if (assetType !== "skill") {
            return normalized;
        }
        return normalized
            .replace(/技能草稿|skill draft/gi, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    acceptExperienceCandidate(candidateId: string, options: { publishedPath?: string } = {}): ExperienceCandidate | null {
        const existing = this.store.getExperienceCandidate(candidateId);
        if (!existing) return null;
        if (existing.status !== "draft") return null;
        const now = new Date().toISOString();
        const publishedPath = existing.type === "method"
            ? this.publishMethodCandidate(existing, options.publishedPath)
            : options.publishedPath ?? existing.publishedPath;
        return this.store.updateExperienceCandidate(candidateId, {
            status: "accepted",
            reviewedAt: existing.reviewedAt ?? now,
            acceptedAt: now,
            rejectedAt: undefined,
            publishedPath,
        });
    }

    rejectExperienceCandidate(candidateId: string): ExperienceCandidate | null {
        const existing = this.store.getExperienceCandidate(candidateId);
        if (!existing) return null;
        if (existing.status !== "draft") return null;
        const now = new Date().toISOString();
        return this.store.updateExperienceCandidate(candidateId, {
            status: "rejected",
            reviewedAt: existing.reviewedAt ?? now,
            acceptedAt: undefined,
            rejectedAt: now,
        });
    }

    rejectExperienceCandidates(filter?: ExperienceCandidateListFilter): number {
        return this.store.rejectExperienceCandidates(filter);
    }

    deleteExperienceCandidates(filter?: ExperienceCandidateListFilter): number {
        return this.store.deleteExperienceCandidates(filter);
    }

    async linkTaskMemoriesFromSource(
        conversationId: string,
        sourcePath: string,
        relation: TaskMemoryRelation = "generated",
        options: { attempts?: number; delayMs?: number } = {},
    ): Promise<number> {
        const attempts = Math.max(1, options.attempts ?? 4);
        const delayMs = Math.max(50, options.delayMs ?? 300);
        const candidatePaths = this.resolveSourcePathCandidates(sourcePath);

        for (let attempt = 0; attempt < attempts; attempt++) {
            for (const candidatePath of candidatePaths) {
                const chunks = this.store.getChunksBySource(candidatePath, 100);
                if (chunks.length === 0) {
                    continue;
                }

                this.taskProcessor.linkMemory(conversationId, chunks.map((chunk) => chunk.id), relation);
                this.taskProcessor.addArtifactPath(conversationId, candidatePath);

                const task = this.store.getTaskByConversation(conversationId);
                if (task) {
                    for (const chunk of chunks) {
                        this.store.linkTaskMemory(task.id, chunk.id, relation);
                    }

                    const artifactPaths = [...new Set([...(task.artifactPaths ?? []), candidatePath])];
                    this.store.updateTask(task.id, { artifactPaths });
                }
                return chunks.length;
            }

            if (attempt < attempts - 1) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }

        const resolvedSourcePath = candidatePaths[0] ?? sourcePath;
        this.taskProcessor.addArtifactPath(conversationId, resolvedSourcePath);

        const task = this.store.getTaskByConversation(conversationId);
        if (task) {
            const artifactPaths = [...new Set([...(task.artifactPaths ?? []), resolvedSourcePath])];
            this.store.updateTask(task.id, { artifactPaths });
        }
        return 0;
    }

    private computeEmbeddingSignature(dims: number): string {
        const model = this.embeddingProvider.modelName ?? "unknown";
        // 签名中包含：模型名 + 真实维度 + task-aware 前缀。
        // 任何一项变更都必须触发向量/缓存重建，否则会出现语义空间不一致或维度不匹配。
        return [
            "v2", // 预留版本号，未来可演进
            `model=${model}`,
            `dims=${dims}`,
            `queryPrefix=${this.embeddingQueryPrefix ?? ""}`,
            `passagePrefix=${this.embeddingPassagePrefix ?? ""}`,
        ].join("|");
    }

    private ensureEmbeddingSignature(signature: string): void {
        const key = "embedding_signature";
        const prev = this.store.getMeta(key);
        const vecStatus = this.store.getVectorStatus();

        // 兼容老库：之前没有写 signature，但可能已经有向量/缓存。
        // 为了避免“复用旧向量/旧缓存导致检索失效”，这里会做一次自愈清理。
        if (!prev) {
            if (vecStatus.indexed > 0 || vecStatus.cached > 0) {
                console.warn(
                    `[MemoryManager] Legacy embedding signature not found (indexed=${vecStatus.indexed}, cached=${vecStatus.cached}); rebuilding vector index & cache...`
                );
                this.store.clearVectorIndex();
                this.store.clearEmbeddingCache();
            }
            this.store.setMeta(key, signature);
            return;
        }

        if (prev !== signature) {
            console.warn(`[MemoryManager] Embedding signature changed, rebuilding vector index & cache...`);
            console.warn(`  prev: ${prev}`);
            console.warn(`  next: ${signature}`);
            this.store.clearVectorIndex();
            this.store.clearEmbeddingCache();
            this.store.setMeta(key, signature);
        }
    }

    /**
     * Process chunks that lack embeddings (with cache support)
     */
    private async processPendingEmbeddings(): Promise<void> {
        // Probe the model to get actual dimensions
        let dims = 1536;
        try {
            const probe = await this.embeddingProvider.embed("ping");
            if (!probe || probe.length === 0) {
                console.log("[MemoryManager] Embedding provider returned empty vectors; skipping vector generation.");
                return;
            }
            dims = probe.length;
        } catch (e) {
            console.warn("Failed to probe embedding model, skipping vector generation", e);
            return;
        }

        // Initialize vector table (this ensures vecDims is set in store)
        this.store.prepareVectorStore(dims);

        // 版本化签名：用于 cache key & 自动重建判断
        const signature = this.computeEmbeddingSignature(dims);
        this.ensureEmbeddingSignature(signature);

        const providerName = this.embeddingProvider.modelName ?? "unknown";
        const embeddingStats = {
            batchCount: 0,
            totalChunks: 0,
            cacheHits: 0,
            cacheMisses: 0,
            apiRequestCount: 0,
            apiChunkCount: 0,
        };

        // Loop until no more pending chunks
        while (true) {
            const pending = this.store.getUnembeddedChunks(this.embeddingBatchSize);
            if (pending.length === 0) break;
            embeddingStats.batchCount += 1;
            embeddingStats.totalChunks += pending.length;

            // Normalize content for embedding and compute content hashes
            const normalized = pending.map(c => c.content.replace(/\n+/g, " ").slice(0, 8000));
            // IMPORTANT: hash 必须包含 embedding signature（模型/维度/prefix），否则升级后会错误复用旧缓存。
            const hashes = normalized.map(t => createHash("sha256").update(signature).update("\n").update(t).digest("hex"));

            // Separate cached vs uncached
            const needEmbed: { idx: number; text: string }[] = [];
            const cachedVectors: (number[] | null)[] = new Array(pending.length).fill(null);

            for (let i = 0; i < pending.length; i++) {
                const cached = this.store.getCachedEmbedding(hashes[i]);
                if (cached) {
                    cachedVectors[i] = cached;
                } else {
                    needEmbed.push({ idx: i, text: normalized[i] });
                }
            }

            const cacheHits = pending.length - needEmbed.length;
            embeddingStats.cacheHits += cacheHits;
            embeddingStats.cacheMisses += needEmbed.length;

            // Store cached vectors immediately
            for (let i = 0; i < pending.length; i++) {
                if (cachedVectors[i] && cachedVectors[i]!.length > 0) {
                    this.store.upsertChunkVector(pending[i].id, cachedVectors[i]!, providerName);
                }
            }

            // Embed uncached texts via API
            if (needEmbed.length > 0) {
                embeddingStats.apiRequestCount += 1;
                embeddingStats.apiChunkCount += needEmbed.length;
                try {
                    const texts = needEmbed.map(e => e.text);
                    const vectors = await this.embeddingProvider.embedBatch(texts);

                    for (let j = 0; j < needEmbed.length; j++) {
                        const { idx } = needEmbed[j];
                        const vec = vectors[j];
                        if (vec && vec.length > 0) {
                            this.store.upsertChunkVector(pending[idx].id, vec, providerName);
                            this.store.cacheEmbedding(hashes[idx], vec, providerName);
                        }
                    }
                } catch (err) {
                    console.error("Failed to batch embed:", err);
                    break;
                }
            }
        }

        this.logEmbeddingSyncSummary(embeddingStats);
    }

    /**
     * M-N4: 源路径聚合二次检索。
     * 当第一轮结果中某个 source 出现 ≥2 次时，拉取该 source 的全部 chunk 补充上下文。
     */
    private applyDeepRetrieval(firstRound: MemorySearchResult[], limit: number): MemorySearchResult[] {
        // 按 source_path 分组统计
        const sourceGroups = new Map<string, { count: number; totalScore: number }>();
        for (const r of firstRound) {
            const existing = sourceGroups.get(r.sourcePath);
            if (existing) {
                existing.count++;
                existing.totalScore += r.score;
            } else {
                sourceGroups.set(r.sourcePath, { count: 1, totalScore: r.score });
            }
        }

        // 找出出现 ≥2 次的 source（触发条件）
        const hotSources: Array<{ path: string; aggScore: number }> = [];
        for (const [sourcePath, { count, totalScore }] of sourceGroups) {
            if (count >= 2) {
                // 聚合分数：avg(score) * log(count + 1)
                const aggScore = (totalScore / count) * Math.log(count + 1);
                hotSources.push({ path: sourcePath, aggScore });
            }
        }

        // 无热点 source → 直接返回第一轮结果
        if (hotSources.length === 0) {
            return firstRound.slice(0, limit);
        }

        // 选出 Top-3 高分 source
        hotSources.sort((a, b) => b.aggScore - a.aggScore);
        const topSources = hotSources.slice(0, 3);

        // 第二轮：拉取 Top source 的全部 chunk
        const existingIds = new Set(firstRound.map(r => r.id));
        const supplementary: MemorySearchResult[] = [];

        for (const { path: sourcePath, aggScore } of topSources) {
            const chunks = this.store.getChunksBySource(sourcePath, 10);
            for (const chunk of chunks) {
                if (!existingIds.has(chunk.id)) {
                    // 赋予补充 chunk 一个基于聚合分数的衰减分数
                    supplementary.push({ ...chunk, score: aggScore * 0.5 });
                    existingIds.add(chunk.id);
                }
            }
        }

        // 合并第一轮 + 补充结果，按 score 降序排序
        const merged = [...firstRound, ...supplementary]
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        return merged;
    }

    private resolveSourcePath(sourcePath: string): string {
        if (!sourcePath) return sourcePath;
        if (path.isAbsolute(sourcePath)) {
            return sourcePath;
        }
        const resolutionRoots = this.getSourceResolutionRoots();
        return resolutionRoots.length > 0
            ? path.resolve(resolutionRoots[0], sourcePath)
            : path.resolve(this.workspaceRoot, sourcePath);
    }

    private resolveSourcePathCandidates(sourcePath: string): string[] {
        if (!sourcePath) return [];
        if (path.isAbsolute(sourcePath)) {
            return [sourcePath];
        }

        const candidates = [sourcePath];
        for (const root of this.getSourceResolutionRoots()) {
            candidates.push(path.resolve(root, sourcePath));
        }
        return dedupePaths(candidates);
    }

    private getSourceResolutionRoots(): string[] {
        const explicitFileRoots = this.additionalFiles.map((filePath) => path.dirname(filePath));
        return dedupePaths([
            this.publishStateDir,
            this.workspaceRoot,
            ...this.additionalRoots,
            ...explicitFileRoots,
        ]);
    }

    private resolvePreferredMemorySourceId(
        sourcePath: string,
        sourceType: string,
        memoryTypes: string[] | undefined,
        records: MemoryTreeSourceRecord[],
    ): string | undefined {
        const classification = classifyMemoryTreeSource(sourcePath, sourceType, memoryTypes);
        if (classification.builtinInventoryId && records.some((item) => item.id === classification.builtinInventoryId)) {
            return classification.builtinInventoryId;
        }

        const normalizedCandidates = new Set(
            this.resolveSourcePathCandidates(sourcePath)
                .concat(sourcePath)
                .map(normalizeSourcePathForMatch)
                .filter(Boolean),
        );
        for (const record of records) {
            if (!record.sourcePath) {
                continue;
            }
            const normalizedRecordPath = normalizeSourcePathForMatch(record.sourcePath);
            if (!normalizedRecordPath) {
                continue;
            }
            if (normalizedCandidates.has(normalizedRecordPath)) {
                return record.id;
            }
            if (record.id.startsWith("configured:")) {
                for (const candidate of normalizedCandidates) {
                    if (candidate === normalizedRecordPath || candidate.startsWith(`${normalizedRecordPath}/`)) {
                        return record.id;
                    }
                }
            }
        }
        return undefined;
    }

    getStatus(): MemoryIndexStatus {
        const basic = this.store.getStatus();
        const vec = this.store.getVectorStatus();
        const summary = this.store.getSummaryStatus();
        return {
            ...basic,
            vectorIndexed: vec.indexed,
            vectorCached: vec.cached,
            summarized: summary.summarized,
            summaryPending: summary.pending,
        };
    }

    /**
     * L0 摘要生成：扫描未摘要的长 chunk，批量调用 LLM 生成单句摘要。
     * 异步后台执行，不阻塞主流程。支持 pause/resume 协作式让步。
     */
    async generateSummaries(options: { maxBatches?: number } = {}): Promise<number> {
        if (!this.summaryEnabled || !this.summaryApiKey || !this.summaryModel) {
            return 0;
        }

        const summaryConcurrency = Math.max(1, Math.min(2, this.summaryBatchSize));
        const summaryThrottleMs = summaryConcurrency > 1 ? 200 : 0;
        const maxBatches = typeof options.maxBatches === "number" && Number.isFinite(options.maxBatches)
            ? Math.max(1, Math.floor(options.maxBatches))
            : Number.POSITIVE_INFINITY;
        let totalGenerated = 0;
        let processedBatches = 0;

        while (processedBatches < maxBatches) {
            // 协作式让步：Agent 活跃时暂停
            await this.waitIfPaused();

            const chunks = this.store.getChunksNeedingSummary(
                this.summaryMinContentLength,
                this.summaryBatchSize
            );
            if (chunks.length === 0) break;
            processedBatches += 1;

            console.log(`[MemoryManager] Generating summaries for ${chunks.length} chunks...`);

            const pendingChunks = chunks.slice();
            const workers = Array.from(
                { length: Math.min(summaryConcurrency, pendingChunks.length) },
                async () => {
                    while (pendingChunks.length > 0) {
                        // 每个 chunk 前再检查一次暂停状态
                        await this.waitIfPaused();

                        const chunk = pendingChunks.shift();
                        if (!chunk) break;

                        try {
                            const summary = await this.callLLMForSummary(chunk.content);
                            if (summary) {
                                // 粗略估算 token 数（中文约 1.5 字/token，英文约 0.75 词/token）
                                const estimatedTokens = Math.ceil(summary.length / 2);
                                this.store.updateChunkSummary(chunk.id, summary, estimatedTokens);
                                totalGenerated++;
                            }
                        } catch (err) {
                            console.error(`[MemoryManager] Failed to generate summary for chunk ${chunk.id}:`, err);
                            // 单个失败不中断整批
                        }

                        if (summaryThrottleMs > 0 && pendingChunks.length > 0) {
                            await new Promise((resolve) => setTimeout(resolve, summaryThrottleMs));
                        }
                    }
                },
            );
            await Promise.all(workers);
        }

        if (totalGenerated > 0) {
            console.log(`[MemoryManager] Generated ${totalGenerated} summaries`);
        }
        return totalGenerated;
    }

    /**
     * 调用 LLM 生成单条 chunk 的摘要
     */
    private async callLLMForSummary(content: string): Promise<string | null> {
        const truncated = content.length > 4000 ? content.slice(0, 4000) + "..." : content;

        const response = await fetch(buildOpenAIChatCompletionsUrl(this.summaryBaseUrl), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.summaryApiKey}`,
            },
            body: JSON.stringify({
                model: this.summaryModel,
                messages: [
                    {
                        role: "system",
                        content: "你是一个精确的文本摘要助手。请用一到两句话概括以下内容的核心要点。摘要应保留关键信息（人名、技术术语、数字、结论），便于快速判断是否需要阅读全文。只输出摘要，不要任何前缀或解释。"
                    },
                    {
                        role: "user",
                        content: truncated
                    }
                ],
                max_tokens: 150,
                temperature: 0.3,
            }),
        });

        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new Error(`Summary LLM call failed: ${response.status} ${text.slice(0, 200)}`);
        }

        const data = await response.json() as {
            choices?: Array<{ message?: { content?: string } }>;
        };
        const result = data.choices?.[0]?.message?.content?.trim();
        return result || null;
    }

    // ========== M-N3: 会话记忆自动提取 ==========

    /**
     * 从会话消息中提取长期记忆。
     * 由 agent_end hook 调用。
     * @returns 提取并写入的记忆条数
     */
    async extractMemoriesFromConversation(
        sessionKey: string,
        messages: Array<{ role: string; content: string }>,
        options: ExtractConversationMemoriesOptions = {},
    ): Promise<ExtractConversationMemoriesResult> {
        const dedupeKey = options.markKey?.trim() || sessionKey;
        const sourceConversationId = options.sourceConversationId?.trim() || sessionKey;
        const sourceLabel = options.sourceLabel?.trim() || dedupeKey;

        if (!this.evolutionEnabled) {
            return {
                count: 0,
                acceptedCandidateTypes: [],
                rejectedCount: 0,
                rejectedReasons: [],
                summary: "Durable extraction disabled by configuration.",
                skipReason: "extractor_disabled",
            };
        }
        if (messages.length < this.evolutionMinMessages) {
            return {
                count: 0,
                acceptedCandidateTypes: [],
                rejectedCount: 0,
                rejectedReasons: [],
                summary: `Skipped because messages (${messages.length}) are below minMessages (${this.evolutionMinMessages}).`,
                skipReason: "messages_below_min",
            };
        }

        // 防重复：检查是否已提取过
        if (this.store.isSessionMemoryExtracted(dedupeKey)) {
            return {
                count: 0,
                acceptedCandidateTypes: [],
                rejectedCount: 0,
                rejectedReasons: [],
                summary: "Skipped because the same durable extraction key was already processed.",
                skipReason: "dedupe_key_already_processed",
            };
        }

        // 构建对话文本
        const conversationText = messages
            .map(m => `${m.role === "user" ? "用户" : "助手"}: ${m.content}`)
            .join("\n\n");

        // 截断过长的对话（保留最近的部分）
        const maxLen = 8000;
        const truncated = conversationText.length > maxLen
            ? "...\n\n" + conversationText.slice(-maxLen)
            : conversationText;

        try {
            await this.waitIfPaused();

            // 调用 LLM 提取记忆
            const extracted = await this.callLLMForExtraction(truncated);
            if (!extracted || extracted.length === 0) {
                // 无值得记住的内容，仍标记为已处理
                this.store.markSessionMemoryExtracted(dedupeKey);
                return {
                    count: 0,
                    acceptedCandidateTypes: [],
                    rejectedCount: 0,
                    rejectedReasons: [],
                    summary: "No durable memory candidate was produced by the extractor.",
                    skipReason: "extractor_empty",
                };
            }

            const filtered = this.applyDurableMemoryPolicy(extracted);
            if (filtered.accepted.length === 0) {
                this.store.markSessionMemoryExtracted(dedupeKey);
                return {
                    count: 0,
                    acceptedCandidateTypes: [],
                    rejectedCount: filtered.rejected.length,
                    rejectedReasons: [...new Set(filtered.rejected.map((item) => item.code))],
                    summary: filtered.summary || "All durable memory candidates were rejected by policy.",
                    skipReason: "policy_filtered",
                };
            }

            // 去重：检查每条记忆是否已存在相似内容
            const newMemories: Array<ExtractedConversationMemory> = [];
            for (const item of filtered.accepted) {
                const similar = await this.search(item.content, { limit: 1 });
                if (similar.length > 0 && similar[0].score > 0.85) {
                    continue; // 已有相似记忆，跳过
                }
                newMemories.push(item);
            }

            if (newMemories.length === 0) {
                this.store.markSessionMemoryExtracted(dedupeKey);
                return {
                    count: 0,
                    acceptedCandidateTypes: [],
                    rejectedCount: filtered.rejected.length,
                    rejectedReasons: [...new Set(filtered.rejected.map((item) => item.code))],
                    summary: "All durable memory candidates were skipped because similar memories already exist.",
                    skipReason: "dedupe_skipped",
                };
            }

            // 写入每日记忆文件
            const lines = newMemories.map(m =>
                `- [${m.type}][${m.category}] ${m.content} (来源: ${sourceLabel})`
            );
            const content = lines.join("\n");
            const filePath = await appendToTodayMemory(this.stateDir, content);
            await this.linkTaskMemoriesFromSource(sourceConversationId, filePath, "generated");

            // 标记已提取
            this.store.markSessionMemoryExtracted(dedupeKey);

            console.log(`[MemoryManager] Extracted ${newMemories.length} memories from session ${sourceLabel}`);
            return {
                count: newMemories.length,
                acceptedCandidateTypes: [...new Set(newMemories.map((item) => item.candidateType).filter((item): item is DurableMemoryCandidateType => Boolean(item)))],
                rejectedCount: filtered.rejected.length,
                rejectedReasons: [...new Set(filtered.rejected.map((item) => item.code))],
                summary: buildDurableExtractionSummary({
                    acceptedCount: newMemories.length,
                    acceptedCandidateTypes: newMemories.map((item) => item.candidateType).filter((item): item is DurableMemoryCandidateType => Boolean(item)),
                    rejected: filtered.rejected,
                }),
            };
        } catch (err) {
            console.error(`[MemoryManager] Memory extraction failed for session ${sourceLabel}:`, err);
            return {
                count: 0,
                acceptedCandidateTypes: [],
                rejectedCount: 0,
                rejectedReasons: [],
                summary: `Durable extraction failed: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }

    /** 检查 session 是否已提取过记忆 */
    isSessionMemoryExtracted(sessionKey: string): boolean {
        return this.store.isSessionMemoryExtracted(sessionKey);
    }

    isConversationMemoryExtractionEnabled(): boolean {
        return this.evolutionEnabled;
    }

    getConversationMemoryExtractionSupport(): ConversationMemoryExtractionSupport {
        const model = this.evolutionModel.trim();
        const hasBaseUrl = this.evolutionBaseUrl.trim().length > 0;
        const hasApiKey = this.evolutionApiKey.trim().length > 0;
        const reasons: ConversationMemoryExtractionSupportReason[] = [];

        if (!this.evolutionEnabled) {
            reasons.push({
                code: "gate_disabled",
                message: "Durable extraction is disabled because BELLDANDY_MEMORY_EVOLUTION_ENABLED is not enabled.",
            });
        }
        if (this.evolutionEnabled && !model) {
            reasons.push({
                code: "model_missing",
                message: "Durable extraction model is not configured.",
            });
        }
        if (this.evolutionEnabled && !hasBaseUrl) {
            reasons.push({
                code: "base_url_missing",
                message: "Durable extraction base URL is not configured.",
            });
        }
        if (this.evolutionEnabled && !hasApiKey) {
            reasons.push({
                code: "api_key_missing",
                message: "Durable extraction API key is not configured.",
            });
        }

        return {
            enabled: this.evolutionEnabled,
            available: this.evolutionEnabled && reasons.length === 0,
            minMessages: this.evolutionMinMessages,
            model: model || undefined,
            hasBaseUrl,
            hasApiKey,
            reasons,
        };
    }

    getDurableMemoryGuidance(): DurableMemoryGuidance {
        return {
            policyVersion: DURABLE_MEMORY_GUIDANCE.policyVersion,
            acceptedCandidateTypes: [...DURABLE_MEMORY_GUIDANCE.acceptedCandidateTypes],
            rejectedContentTypes: DURABLE_MEMORY_GUIDANCE.rejectedContentTypes.map((item) => ({ ...item })),
            summary: DURABLE_MEMORY_GUIDANCE.summary,
        };
    }

    private applyDurableMemoryPolicy(items: ExtractedConversationMemory[]): {
        accepted: ExtractedConversationMemory[];
        rejected: Array<{ code: DurableMemoryRejectionReasonCode; content: string }>;
        summary: string;
    } {
        const accepted: ExtractedConversationMemory[] = [];
        const rejected: Array<{ code: DurableMemoryRejectionReasonCode; content: string }> = [];

        for (const item of items) {
            const normalizedContent = item.content.trim();
            if (!normalizedContent) {
                continue;
            }
            const rejection = detectDurableMemoryRejection(normalizedContent);
            if (rejection) {
                rejected.push({
                    code: rejection.code,
                    content: normalizedContent,
                });
                continue;
            }
            accepted.push({
                ...item,
                content: normalizedContent,
                candidateType: normalizeDurableMemoryCandidateType(item.candidateType)
                    ?? inferDurableMemoryCandidateType(item),
            });
        }

        return {
            accepted,
            rejected,
            summary: buildDurableExtractionSummary({
                acceptedCount: accepted.length,
                acceptedCandidateTypes: accepted.map((item) => item.candidateType).filter((item): item is DurableMemoryCandidateType => Boolean(item)),
                rejected,
            }),
        };
    }

    /**
     * 调用 LLM 从对话中提取记忆
     */
    private async callLLMForExtraction(
        conversationText: string,
    ): Promise<ExtractedConversationMemory[] | null> {
        const requestBody: Record<string, unknown> = {
            model: this.evolutionModel,
            messages: [
                {
                    role: "system",
                    content: `分析以下对话，提取值得长期记住的信息。优先归入以下 durable candidate type：
- user：用户偏好、习惯、长期工作方式、稳定背景信息
- feedback：用户对结果质量、交互方式、输出风格的持续反馈
- project：项目背景、阶段性决定、长期约束、外部依赖入口
- reference：值得长期记住的人名、组织名、系统入口、外部资源引用

同时给每条记忆保留一个已有 memory category，分为以下类别：
- 【偏好/preference】：用户表达的喜好、习惯、工作方式、技术栈偏好等
- 【经验/experience】：解决问题的有效方法、踩过的坑、有用的工具/命令等
- 【事实/fact】：用户提到的客观事实、背景信息、项目状态等
- 【决策/decision】：用户做出的技术决策、架构选择、方案确定等
- 【实体/entity】：用户提到的重要人名、项目名、组织名等

仅提取有长期价值的信息，忽略临时性的对话内容。
不要记下面这些内容：
- 代码模式、架构片段、函数实现、文件路径、项目目录结构
- git 历史、最近变更、commit/PR 记录
- debugging / fix recipe、命令执行步骤、一次性排障过程
- 已在 AGENTS.md / CLAUDE.md / README / 项目规范中稳定存在的规则

每条记忆用一句话概括。
返回 JSON 数组，格式：[{"type":"偏好","category":"preference","candidateType":"user","content":"...","reason":"..."}]
category 必须是以下之一：preference / experience / fact / decision / entity
candidateType 必须是以下之一：user / feedback / project / reference
如果没有值得记住的内容，返回空数组 []。
只输出 JSON，不要其他内容。`
                },
                {
                    role: "user",
                    content: conversationText
                }
            ],
            max_tokens: 500,
            temperature: 0.3,
        };
        if (shouldEnableMiniMaxReasoningSplit(this.evolutionBaseUrl, this.evolutionModel)) {
            requestBody.reasoning_split = true;
        }
        const response = await fetch(buildOpenAIChatCompletionsUrl(this.evolutionBaseUrl), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.evolutionApiKey}`,
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new Error(`Evolution LLM call failed: ${response.status} ${text.slice(0, 200)}`);
        }

        const data = await response.json() as {
            choices?: Array<{ message?: { content?: string } }>;
        };
        const raw = data.choices?.[0]?.message?.content?.trim();
        if (!raw) return null;

        try {
            // 提取 JSON（兼容前置 think 块与 markdown code block 包裹）
            const jsonStr = sanitizeExtractionJsonText(raw);
            const parsed = JSON.parse(jsonStr);
            if (!Array.isArray(parsed)) return null;
            return parsed.filter(
                (item: any) => item && typeof item.type === "string" && typeof item.content === "string"
            ).map((item: any) => ({
                type: item.type as string,
                content: item.content as string,
                category: (typeof item.category === "string" ? item.category : "other") as string,
                candidateType: normalizeDurableMemoryCandidateType(item.candidateType),
                reason: typeof item.reason === "string" ? item.reason : undefined,
            }));
        } catch {
            console.warn("[MemoryManager] Failed to parse extraction result:", raw.slice(0, 200));
            return null;
        }
    }

    // ========== 后台任务暂停/恢复 ==========

    /**
     * 暂停后台 LLM 任务（摘要生成等）。
     * 由 before_agent_start hook 调用，避免与 Agent 主请求争抢 API 并发。
     */
    pause(): void {
        this._paused = true;
    }

    /**
     * 恢复后台 LLM 任务。
     * 由 agent_end hook 调用。
     */
    resume(): void {
        this._paused = false;
        if (this._pauseResolve) {
            this._pauseResolve();
            this._pauseResolve = null;
        }
    }

    get isPaused(): boolean {
        return this._paused;
    }

    /**
     * 等待暂停结束。在后台循环中调用，实现协作式让步。
     */
    private waitIfPaused(): Promise<void> {
        if (!this._paused) return Promise.resolve();
        console.log("[MemoryManager] Background task paused (agent active)");
        return new Promise<void>(resolve => {
            this._pauseResolve = resolve;
        });
    }

    /**
     * 空闲时执行摘要生成。
     * 由 gateway 的空闲定时器调用，仅在无活跃 Agent 请求时运行。
     * 返回本次生成的摘要数。
     */
    async runIdleSummaries(): Promise<number> {
        if (!this.summaryEnabled || this._paused || this._summaryRunning) return 0;
        this._summaryRunning = true;
        try {
            return await this.generateSummaries({ maxBatches: 1 });
        } finally {
            this._summaryRunning = false;
        }
    }

    close(): void {
        this.indexer.stopWatching().catch(console.error);
        this.store.close();
    }

    private collectTaskShortcutCandidates(limit: number, filter?: TaskSearchFilter): TaskExperienceDetail[] {
        return dedupeTaskShortcutCandidates(
            this.store
                .listTaskSummaries(limit, filter)
                .filter((task) => task.status !== "running")
                .map((task) => this.getTaskDetail(task.id))
                .filter((task): task is TaskExperienceDetail => Boolean(task)),
        );
    }

    private shouldAutoPromoteTask(task: TaskRecord): boolean {
        return shouldAutoPromoteTaskByPolicy(task);
    }

    private publishMethodCandidate(candidate: ExperienceCandidate, explicitPublishedPath?: string): string {
        const issues = validateMethodCandidateDraftForPublish(candidate.content);
        if (issues.length > 0) {
            throw new Error(`Method candidate publish validation failed: ${issues.join("；")}`);
        }

        const methodsDir = path.join(this.publishStateDir, "methods");
        mkdirSync(methodsDir, { recursive: true });

        const filePath = explicitPublishedPath || this.resolveMethodPublishPath(methodsDir, candidate);
        mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(filePath, candidate.content, "utf-8");
        return filePath;
    }

    private resolveMethodPublishPath(methodsDir: string, candidate: ExperienceCandidate): string {
        if (candidate.publishedPath) {
            return candidate.publishedPath;
        }

        const title = candidate.content.match(/^#\s+(.+)$/m)?.[1]?.trim();
        const baseName = buildExperienceMethodFilenameBase({
            title,
            slug: candidate.slug,
            fallback: candidate.taskId,
            summary: candidate.summary,
        });
        const suffixTaskId = normalizeAsciiToken(candidate.taskId, "task");
        const suffixCandidateId = normalizeAsciiToken(candidate.id, "candidate");
        const candidates = [
            `${baseName}.md`,
            `${appendMethodFilenameRevision(baseName, suffixTaskId)}.md`,
            `${appendMethodFilenameRevision(baseName, suffixCandidateId)}.md`,
        ];

        for (const filename of candidates) {
            const filePath = path.join(methodsDir, filename);
            if (!existsSync(filePath)) {
                return filePath;
            }
        }

        return path.join(methodsDir, `${appendMethodFilenameRevision(baseName, `${suffixCandidateId}_${Date.now()}`)}.md`);
    }
}

function normalizeAsciiToken(value: string, fallback: string): string {
    const normalized = String(value ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");
    return normalized || fallback;
}

function dedupePaths(items: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of items) {
        const normalized = String(item ?? "").trim();
        if (!normalized) continue;
        const resolved = path.resolve(normalized);
        if (seen.has(resolved)) continue;
        seen.add(resolved);
        result.push(normalized);
    }
    return result;
}

function summarizeDedupGroupSourceIndexing(sourceInfos: MemoryDedupSourceIndexInfo[]): MemoryDedupGroupSourceIndexSummary {
    const reindexableSourcePathCount = sourceInfos.filter((item) => item.reindexable).length;
    const nonReindexableSourcePathCount = Math.max(0, sourceInfos.length - reindexableSourcePathCount);
    return {
        reindexableSourcePathCount,
        nonReindexableSourcePathCount,
        allAffectedSourcePathsReindexable: sourceInfos.length > 0 && nonReindexableSourcePathCount === 0,
        anyAffectedSourcePathReindexable: reindexableSourcePathCount > 0,
        scopes: [...new Set(sourceInfos.map((item) => item.scope))],
    };
}

function toComparablePath(value: string): string {
    const normalized = path.resolve(String(value ?? "").trim());
    return process.platform === "win32"
        ? normalized.toLowerCase()
        : normalized;
}

function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
    const relative = path.relative(rootPath, candidatePath);
    return relative === ""
        || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function deriveIndexedRootScope(
    rootPath: string,
    publishStateDir: string,
    stateMemoryRootPath: string,
): MemoryDedupSourceIndexScope {
    const comparableRootPath = toComparablePath(rootPath);
    const comparableStateMemoryRootPath = toComparablePath(stateMemoryRootPath);
    if (comparableRootPath === comparableStateMemoryRootPath) {
        return "state_memory_root";
    }
    const teamMemoryRootRelative = path.relative(publishStateDir, rootPath);
    if (!teamMemoryRootRelative.startsWith("..") && !path.isAbsolute(teamMemoryRootRelative)) {
        const normalizedRelative = teamMemoryRootRelative.replace(/\\/g, "/").toLowerCase();
        if (normalizedRelative === "team-memory/memory") {
            return "team_memory_root";
        }
    }
    return "additional_root";
}

function deriveIndexedFileScope(
    filePath: string,
    publishStateDir: string,
    stateMemoryFilePath: string,
): MemoryDedupSourceIndexScope {
    const comparableFilePath = toComparablePath(filePath);
    const comparableStateMemoryFilePath = toComparablePath(stateMemoryFilePath);
    if (comparableFilePath === comparableStateMemoryFilePath) {
        return "state_memory_file";
    }
    const teamMemoryFileRelative = path.relative(publishStateDir, filePath);
    if (!teamMemoryFileRelative.startsWith("..") && !path.isAbsolute(teamMemoryFileRelative)) {
        const normalizedRelative = teamMemoryFileRelative.replace(/\\/g, "/").toLowerCase();
        if (normalizedRelative === "team-memory/memory.md") {
            return "team_memory_file";
        }
    }
    return "additional_file";
}

function scoreForContextInjection(item: MemorySearchResult): { score: number; rationale: string[] } {
    let score = 0;
    const rationale: string[] = [];

    switch (item.memoryType) {
        case "core":
            score += 6;
            rationale.push("core-memory");
            break;
        case "daily":
            score += 4;
            rationale.push("daily-memory");
            break;
        case "other":
            score += 2;
            rationale.push("general-memory");
            break;
        case "session":
            score += 1;
            rationale.push("session-memory");
            break;
        default:
            break;
    }

    switch (item.category) {
        case "decision":
            score += 5;
            rationale.push("decision");
            break;
        case "preference":
        case "fact":
            score += 4;
            rationale.push(item.category);
            break;
        case "entity":
            score += 3;
            rationale.push("entity");
            break;
        case "experience":
            score += 2;
            rationale.push("experience");
            break;
        case "other":
            score += 1;
            rationale.push("other");
            break;
        default:
            break;
    }

    const updatedAt = Date.parse(item.updatedAt ?? "");
    if (Number.isFinite(updatedAt)) {
        const ageHours = (Date.now() - updatedAt) / (1000 * 60 * 60);
        if (ageHours <= 24) {
            score += 4;
            rationale.push("fresh-24h");
        } else if (ageHours <= 24 * 3) {
            score += 3;
            rationale.push("fresh-3d");
        } else if (ageHours <= 24 * 7) {
            score += 2;
            rationale.push("fresh-7d");
        } else if (ageHours <= 24 * 30) {
            score += 1;
            rationale.push("fresh-30d");
        }
    }

    const textLength = (item.summary ?? item.snippet ?? "").trim().length;
    if (textLength >= 24 && textLength <= 220) {
        score += 1;
        rationale.push("concise");
    }

    return { score, rationale };
}

function classifyImportance(score: number): MemoryImportance {
    if (score >= 11) return "high";
    if (score >= 7) return "medium";
    return "low";
}

type RankedTaskShortcutCandidate = {
    task: TaskExperienceDetail;
    score: number;
    resumePriority: number;
    matchReasons: string[];
};

function clampTaskLookupLimit(limit?: number): number {
    if (typeof limit !== "number" || !Number.isFinite(limit)) return 5;
    return Math.min(Math.max(Math.floor(limit), 1), 10);
}

function normalizeTaskLookupQuery(value?: string): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.replace(/\s+/g, " ").trim();
    return trimmed ? trimmed : undefined;
}

function toTaskWorkShortcutItem(task: TaskExperienceDetail, matchReasons?: string[]): TaskWorkShortcutItem {
    return {
        taskId: task.id,
        conversationId: task.conversationId,
        title: task.title,
        objective: task.objective,
        summary: task.summary,
        status: task.status,
        source: task.source,
        startedAt: task.startedAt,
        finishedAt: task.finishedAt,
        updatedAt: task.updatedAt,
        agentId: task.agentId,
        toolNames: (task.toolCalls ?? []).map((item) => item.toolName),
        artifactPaths: task.artifactPaths ?? [],
        workRecap: task.workRecap,
        resumeContext: task.resumeContext,
        recentActivityTitles: collectRecentActivityTitles(task),
        matchReasons: matchReasons?.length ? matchReasons : undefined,
    };
}

function dedupeTaskShortcutCandidates(items: TaskExperienceDetail[]): TaskExperienceDetail[] {
    const seen = new Set<string>();
    const result: TaskExperienceDetail[] = [];
    for (const item of items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        result.push(item);
    }
    return result;
}

function rankTaskShortcutCandidates(
    candidates: TaskExperienceDetail[],
    query?: string,
    options: {
        resumeMode?: boolean;
    } = {},
): RankedTaskShortcutCandidate[] {
    const deduped = dedupeTaskShortcutCandidates(candidates).filter((task) => task.status !== "running");
    const ranked = deduped.map((task) => {
        const match = scoreTaskShortcut(task, query);
        return {
            task,
            score: match.score,
            resumePriority: computeResumePriority(task),
            matchReasons: match.matchReasons,
        };
    });

    const filtered = query
        ? ranked.filter((item) => item.score > 0)
        : ranked;

    return filtered.sort((a, b) => {
        if (options.resumeMode) {
            if (query) {
                if (b.score !== a.score) return b.score - a.score;
                if (b.resumePriority !== a.resumePriority) return b.resumePriority - a.resumePriority;
                return compareTaskShortcutRecency(a.task, b.task);
            }
            if (b.resumePriority !== a.resumePriority) return b.resumePriority - a.resumePriority;
            if (b.score !== a.score) return b.score - a.score;
            return compareTaskShortcutRecency(a.task, b.task);
        }
        if (b.score !== a.score) return b.score - a.score;
        if (b.resumePriority !== a.resumePriority) return b.resumePriority - a.resumePriority;
        return compareTaskShortcutRecency(a.task, b.task);
    });
}

function compareTaskShortcutRecency(a: Pick<TaskRecord, "finishedAt" | "updatedAt" | "startedAt">, b: Pick<TaskRecord, "finishedAt" | "updatedAt" | "startedAt">): number {
    return resolveTaskShortcutTimestamp(b) - resolveTaskShortcutTimestamp(a);
}

function resolveTaskShortcutTimestamp(task: Pick<TaskRecord, "finishedAt" | "updatedAt" | "startedAt">): number {
    const timestamp = Date.parse(task.finishedAt ?? task.updatedAt ?? task.startedAt);
    return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function computeResumePriority(task: TaskExperienceDetail): number {
    let priority = 0;
    switch (task.status) {
        case "partial":
            priority += 6;
            break;
        case "failed":
            priority += 5;
            break;
        case "success":
            priority += 2;
            break;
        default:
            break;
    }
    if (task.resumeContext?.currentStopPoint) priority += 3;
    if (task.resumeContext?.nextStep) priority += 4;
    if ((task.resumeContext?.blockers?.length ?? 0) > 0) priority += 2;
    if ((task.workRecap?.pendingActions?.length ?? 0) > 0) priority += 1;
    return priority;
}

function collectRecentActivityTitles(task: TaskExperienceDetail, limit = 3): string[] {
    const collected: string[] = [];
    for (const activity of [...(task.activities ?? [])].reverse()) {
        if (activity.kind === "task_completed") continue;
        const text = sanitizeTaskShortcutText(activity.title || activity.summary);
        if (!text) continue;
        collected.push(text);
        if (collected.length >= limit) break;
    }
    return collected;
}

function scoreTaskShortcut(task: TaskExperienceDetail, query?: string): { score: number; matchReasons: string[] } {
    const normalizedQuery = normalizeTaskShortcutText(query);
    if (!normalizedQuery) {
        return { score: 0, matchReasons: [] };
    }

    const queryTokens = tokenizeTaskShortcutQuery(normalizedQuery);
    let matchScore = 0;
    const reasons = new Set<string>();

    const fields: Array<{ label: string; values: Array<string | undefined> }> = [
        { label: "标题/目标", values: [task.title, task.objective] },
        { label: "摘要/复盘", values: [task.summary, task.reflection, task.workRecap?.headline] },
        { label: "已确认事实", values: task.workRecap?.confirmedFacts ?? [] },
        { label: "当前停点", values: [task.resumeContext?.currentStopPoint, task.resumeContext?.nextStep, ...(task.resumeContext?.blockers ?? [])] },
        { label: "最近活动", values: collectRecentActivityTitles(task, 5) },
        { label: "工具/产物", values: [...(task.toolCalls?.map((item) => item.toolName) ?? []), ...(task.artifactPaths ?? [])] },
    ];

    for (const field of fields) {
        const fieldScore = scoreTaskShortcutField(field.values, normalizedQuery, queryTokens);
        if (fieldScore <= 0) continue;
        matchScore += fieldScore;
        reasons.add(field.label);
    }

    if (matchScore <= 0) {
        return { score: 0, matchReasons: [] };
    }

    return {
        score: matchScore + computeTaskShortcutRecencyBoost(task),
        matchReasons: [...reasons],
    };
}

function scoreTaskShortcutField(values: Array<string | undefined>, normalizedQuery: string, queryTokens: string[]): number {
    let best = 0;
    for (const value of values) {
        const normalizedValue = normalizeTaskShortcutText(value);
        if (!normalizedValue) continue;
        let score = 0;
        if (normalizedValue.includes(normalizedQuery)) {
            score += 8;
        }
        const tokenMatches = queryTokens.filter((token) => normalizedValue.includes(token)).length;
        const minTokenMatches = queryTokens.length >= 3 ? 2 : 1;
        if (tokenMatches >= minTokenMatches) {
            score += tokenMatches * 2;
        }
        if (score > best) {
            best = score;
        }
    }
    return best;
}

function tokenizeTaskShortcutQuery(value: string): string[] {
    return [...new Set(value
        .toLowerCase()
        .split(/[\s,.;:!?/\\()[\]{}<>|"'`~\-_=+]+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 2))];
}

function normalizeTaskShortcutText(value?: string): string | undefined {
    const sanitized = sanitizeTaskShortcutText(value);
    if (!sanitized) return undefined;
    return sanitized.toLowerCase();
}

function sanitizeTaskShortcutText(value?: string): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value
        .replace(/\s+/g, " ")
        .trim();
    return trimmed ? trimmed : undefined;
}

function computeTaskShortcutRecencyBoost(task: TaskExperienceDetail): number {
    const timestamp = resolveTaskShortcutTimestamp(task);
    if (!Number.isFinite(timestamp)) return 0;
    const ageHours = (Date.now() - timestamp) / (1000 * 60 * 60);
    if (ageHours <= 24) return 3;
    if (ageHours <= 24 * 7) return 2;
    if (ageHours <= 24 * 30) return 1;
    return 0;
}

function buildMemoryTreeReportId(input: {
    reportType: MemoryTreeReportType;
    inputVersion?: string;
    summary: Record<string, unknown>;
    details: Record<string, unknown>;
    scope: string;
    agentId?: string;
}): string {
    return `report:${input.reportType}:${hashMemoryTreePayload({
        reportType: input.reportType,
        inputVersion: input.inputVersion ?? "",
        summary: input.summary,
        details: input.details,
        scope: input.scope,
        agentId: input.agentId ?? null,
    })}`;
}

function sanitizePathSegment(value: string): string {
    return value
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .replace(/\s+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function buildMemoryTreeReportMarkdown(report: MemoryTreeReportRecord): string {
    return [
        `# Memory Tree Report`,
        "",
        `- id: ${report.id}`,
        `- type: ${report.reportType}`,
        `- scope: ${report.scope}`,
        `- status: ${report.status}`,
        `- inputVersion: ${report.inputVersion ?? ""}`,
        `- createdAt: ${report.createdAt ?? ""}`,
        `- updatedAt: ${report.updatedAt ?? ""}`,
        "",
        "## Summary",
        "```json",
        JSON.stringify(report.summary, null, 2),
        "```",
        "",
        "## Details",
        "```json",
        JSON.stringify(report.details, null, 2),
        "```",
        "",
    ].join("\n");
}

function buildMemoryTreeTaskSummary(task: TaskExperienceDetail): string {
    return [
        task.summary?.trim(),
        task.workRecap?.headline?.trim(),
        task.resumeContext?.currentStopPoint?.trim(),
    ].filter((item): item is string => Boolean(item)).slice(0, 2).join(" | ")
        || task.objective?.trim()
        || task.title?.trim()
        || `Task ${task.id}`;
}

function buildMemoryTreeSourceClassMix(links: Array<{ sourcePath?: string; memoryType?: string }>): Record<string, number> {
    const mix: Record<string, number> = {};
    for (const link of links) {
        const classification = classifyMemoryTreeSource(link.sourcePath ?? "", "file", link.memoryType ? [link.memoryType] : undefined);
        mix[classification.sourceClass] = (mix[classification.sourceClass] ?? 0) + 1;
    }
    return mix;
}

function buildInventoryMemorySourceRecord(item: MemorySourceInventoryItem, now: string): MemoryTreeSourceRecord {
    return {
        id: item.id,
        sourceKind: item.sourceKind,
        sourceClass: item.sourceClass,
        scope: item.scope,
        sourcePath: item.location.path,
        sourceRef: item.location.table ?? item.location.pattern,
        contentHash: hashMemoryTreePayload({
            id: item.id,
            sourceKind: item.sourceKind,
            stats: item.stats,
            location: item.location,
            status: item.status,
        }),
        timeFrom: undefined,
        timeTo: item.stats.lastUpdatedAt,
        itemCount: item.stats.itemCount,
        metadata: {
            recordType: "inventory_preview",
            storage: item.storage,
            status: item.status,
            duplicateRisk: item.duplicateRisk,
            stats: item.stats,
            location: item.location,
            notes: item.notes,
        },
        createdAt: now,
        updatedAt: now,
    };
}

function buildDynamicMemorySourceId(sourcePath: string, sourceType: string, agentId?: string): string {
    return `dynamic:${hashMemoryTreePayload({
        sourcePath,
        sourceType,
        agentId: agentId ?? null,
    })}`;
}

function hashMemoryTreePayload(payload: unknown): string {
    return createHash("sha1")
        .update(JSON.stringify(payload))
        .digest("hex");
}

function normalizeSourcePathForMatch(value?: string): string {
    if (typeof value !== "string") return "";
    return value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
}

function classifyMemoryTreeSource(
    sourcePath: string,
    sourceType: string,
    memoryTypes?: string[],
): {
    sourceKind: string;
    sourceClass: MemorySourceInventoryClass;
    builtinInventoryId?: string;
} {
    const normalizedPath = normalizeSourcePathForMatch(sourcePath);
    const basename = path.basename(sourcePath).toLowerCase();
    const hasMemoryType = (name: string) => Array.isArray(memoryTypes) && memoryTypes.includes(name);
    if (basename.endsWith(".transcript.jsonl")) {
        return { sourceKind: "session_transcripts", sourceClass: "derived", builtinInventoryId: "builtin:sessions:transcripts" };
    }
    if (basename.endsWith(".meta.json")) {
        return { sourceKind: "session_meta", sourceClass: "derived", builtinInventoryId: "builtin:sessions:meta" };
    }
    if (basename.endsWith(".digest.json")) {
        return { sourceKind: "session_digest", sourceClass: "derived", builtinInventoryId: "builtin:sessions:digest" };
    }
    if (basename.endsWith(".session-memory.json")) {
        return { sourceKind: "session_memory", sourceClass: "derived", builtinInventoryId: "builtin:sessions:session-memory" };
    }
    if (basename.endsWith(".jsonl") || sourceType === "session") {
        return { sourceKind: "session_messages", sourceClass: "raw", builtinInventoryId: "builtin:sessions:messages" };
    }
    if (basename === "memory.md" || hasMemoryType("core")) {
        return { sourceKind: "memory_core_note", sourceClass: "curated", builtinInventoryId: "builtin:memory:core-note" };
    }
    if ((/(^|\/)memory\/.+\.md$/).test(normalizedPath) || hasMemoryType("daily")) {
        return { sourceKind: "memory_notes", sourceClass: "raw", builtinInventoryId: "builtin:memory:daily-notes" };
    }
    if (basename === "dream-runtime.json") {
        return { sourceKind: "dream_runtime", sourceClass: "derived", builtinInventoryId: "builtin:dream:runtime" };
    }
    if (basename === "dream.md") {
        return { sourceKind: "dream_index", sourceClass: "derived", builtinInventoryId: "builtin:dream:index" };
    }
    if ((/(^|\/)dreams\/.+\.md$/).test(normalizedPath)) {
        return { sourceKind: "dream_notes", sourceClass: "curated", builtinInventoryId: "builtin:dream:notes" };
    }
    if (sourceType === "manual") {
        return { sourceKind: "manual_memory", sourceClass: "raw" };
    }
    if (sourceType === "file") {
        return { sourceKind: "workspace_file", sourceClass: "raw" };
    }
    return { sourceKind: "other_source", sourceClass: "derived" };
}

function buildRuleOnlyChunkScore(
    input: {
        chunkId: string;
        sourcePath: string;
        sourceType: string;
        memoryType?: string;
        visibility?: string;
        updatedAt?: string;
        content?: string;
        taskLinkCount: number;
        successTaskCount: number;
        partialTaskCount: number;
        failedTaskCount: number;
        runningTaskCount: number;
    },
    sourceRecord?: MemoryTreeSourceRecord,
): {
    scoreTotal: number;
    recencyScore: number;
    sourceWeightScore: number;
    interactionScore: number;
    taskOutcomeScore: number;
    entityDensityScore: number;
    rationale: Record<string, unknown>;
} {
    const recencyScore = computeRecencyScore(input.updatedAt);
    const sourceKindWeight = computeSourceKindWeight(sourceRecord?.sourceKind);
    const sourceClassWeight = computeSourceClassWeight(sourceRecord?.sourceClass);
    const sourceWeightScore = clampScore((sourceKindWeight + sourceClassWeight) / 2);
    const interactionScore = computeInteractionScore(input.taskLinkCount, input.visibility === "shared");
    const taskOutcomeScore = computeTaskOutcomeScore(input);
    const entityDensityScore = computeEntityDensityScore(input.content);
    const scoreTotal = clampScore(
        (recencyScore * 0.30)
        + (sourceWeightScore * 0.25)
        + (interactionScore * 0.25)
        + (taskOutcomeScore * 0.15)
        + (entityDensityScore * 0.05),
    );
    return {
        scoreTotal,
        recencyScore,
        sourceWeightScore,
        interactionScore,
        taskOutcomeScore,
        entityDensityScore,
        rationale: {
            chunkId: input.chunkId,
            sourcePath: input.sourcePath,
            sourceKind: sourceRecord?.sourceKind ?? "unmapped",
            sourceClass: sourceRecord?.sourceClass ?? "raw",
            sourceClassWeight,
            sourceKindWeight,
            taskLinkCount: input.taskLinkCount,
            successTaskCount: input.successTaskCount,
            partialTaskCount: input.partialTaskCount,
            failedTaskCount: input.failedTaskCount,
            runningTaskCount: input.runningTaskCount,
            visibility: input.visibility ?? "private",
            updatedAt: input.updatedAt,
            scoreWeights: {
                recency: 0.30,
                sourceWeight: 0.25,
                interaction: 0.25,
                taskOutcome: 0.15,
                entityDensity: 0.05,
            },
        },
    };
}

function computeRecencyScore(updatedAt?: string): number {
    if (!updatedAt) return 0.35;
    const timestamp = Date.parse(updatedAt);
    if (!Number.isFinite(timestamp)) return 0.35;
    const ageDays = (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
    if (ageDays <= 1) return 1;
    if (ageDays <= 7) return 0.9;
    if (ageDays <= 30) return 0.75;
    if (ageDays <= 90) return 0.55;
    if (ageDays <= 180) return 0.4;
    return 0.25;
}

function computeSourceKindWeight(sourceKind?: string): number {
    switch (sourceKind) {
        case "memory_core_note":
        case "dream_notes":
            return 0.9;
        case "session_messages":
        case "memory_notes":
            return 0.75;
        case "workspace_file":
        case "manual_memory":
            return 0.7;
        case "dream_index":
        case "dream_runtime":
        case "session_meta":
        case "session_digest":
        case "session_memory":
        case "session_transcripts":
            return 0.5;
        default:
            return 0.6;
    }
}

function computeSourceClassWeight(sourceClass?: MemorySourceInventoryClass): number {
    switch (sourceClass) {
        case "curated":
            return 0.9;
        case "raw":
            return 0.75;
        case "derived":
            return 0.5;
        default:
            return 0.65;
    }
}

function computeInteractionScore(taskLinkCount: number, isShared: boolean): number {
    let base = 0.25;
    if (taskLinkCount >= 3) {
        base = 1;
    } else if (taskLinkCount === 2) {
        base = 0.8;
    } else if (taskLinkCount === 1) {
        base = 0.6;
    }
    if (isShared) {
        base += 0.1;
    }
    return clampScore(base);
}

function computeTaskOutcomeScore(input: {
    successTaskCount: number;
    partialTaskCount: number;
    failedTaskCount: number;
    runningTaskCount: number;
}): number {
    if (input.successTaskCount > 0) return 1;
    if (input.partialTaskCount > 0) return 0.7;
    if (input.failedTaskCount > 0) return 0.35;
    if (input.runningTaskCount > 0) return 0.2;
    return 0.3;
}

function computeEntityDensityScore(content?: string): number {
    if (!content) return 0;
    const pathHits = (content.match(/[A-Za-z]:\\|\/[\w./-]+|\b[\w.-]+\.(?:ts|tsx|js|jsx|md|json|yml|yaml|sql|py)\b/g) ?? []).length;
    const codeHits = (content.match(/[`#]/g) ?? []).length;
    const taskHits = (content.match(/\b(task|agent|goal|memory|chunk|prompt|tool)\b/gi) ?? []).length;
    const rawScore = Math.min(8, pathHits + Math.ceil(codeHits / 4) + Math.ceil(taskHits / 2));
    return clampScore(rawScore / 8);
}

function clampScore(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}
