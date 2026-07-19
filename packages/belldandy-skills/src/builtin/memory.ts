import type { Tool, ToolCallResult } from "../types.js";
import { createTaskWorkSurface, MemoryManager, getGlobalMemoryManager } from "@belldandy/memory";
import type {
    ExperienceCandidate,
    ExperienceCandidateListFilter,
    ExperienceUsage,
    ExperienceUsageListFilter,
    ExperienceUsageSummary,
    ExperienceUsageVia,
    MemorySearchFilter,
    TaskExperienceDetail,
    TaskRecord,
    TaskSearchFilter,
    TaskWorkShortcutItem,
} from "@belldandy/memory";
import { appendToTodayMemory, readMemoryFile, writeMemoryFile } from "@belldandy/memory";
import { getGlobalSkillRegistry } from "../skill-registry.js";
import { publishSkillCandidate } from "../skill-publisher.js";
import path from "node:path";
import { resolveStateDir } from "@belldandy/protocol";
import { withToolContract } from "../tool-contract.js";

// Singleton instance (lazy init, fallback only)
let memoryManager: MemoryManager | null = null;
const methodGenerationConfirmRequired = readEnvBoolean("BELLDANDY_METHOD_GENERATION_CONFIRM_REQUIRED");
const skillGenerationConfirmRequired = readEnvBoolean("BELLDANDY_SKILL_GENERATION_CONFIRM_REQUIRED");
const methodPublishConfirmRequired = readEnvBoolean("BELLDANDY_METHOD_PUBLISH_CONFIRM_REQUIRED");
const skillPublishConfirmRequired = readEnvBoolean("BELLDANDY_SKILL_PUBLISH_CONFIRM_REQUIRED");

function getMemoryManager(workspaceRoot: string): MemoryManager {
    // [FIX] 优先使用 Gateway 注册的全局实例，以便访问 sessions 向量索引
    const global = getGlobalMemoryManager({ workspaceRoot });
    if (global) {
        return global;
    }

    // Fallback: 创建本地实例（用于测试或独立运行场景）
    if (!memoryManager) {
        // [IMPROVED] Use shared models directory if available
        const stateDir = resolveStateDir(process.env);
        const modelsDir = path.join(stateDir, "models");

        memoryManager = new MemoryManager({
            workspaceRoot,
            modelsDir, // Use shared directory to avoid re-downloading per workspace
            // API key is pulled from env by MemoryManager default behavior
        });
        console.log("[memory_search] Created fallback MemoryManager (no global instance found)");
    }
    return memoryManager;
}

function getTaskWorkSurface(workspaceRoot: string) {
    return createTaskWorkSurface(getMemoryManager(workspaceRoot));
}

function readEnvBoolean(name: string): boolean {
    const normalized = String(process.env[name] ?? "").trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

function formatMemoryTypeTag(memoryType?: string): string {
    switch (memoryType) {
        case "core":
            return " [Core Memory]";
        case "daily":
            return " [Daily Note]";
        case "session":
            return " [Session]";
        case "dream_index":
            return " [Dream Index]";
        case "dream_note":
            return " [Dream Note]";
        case "other":
            return " [Other]";
        default:
            return "";
    }
}

function withMemoryReadContract(
    tool: Tool,
    activityDescription: string,
    description: string,
): Tool {
    return withToolContract(tool, {
        family: "memory",
        isReadOnly: true,
        isConcurrencySafe: true,
        needsPermission: false,
        riskLevel: "low",
        channels: ["gateway", "web"],
        safeScopes: ["local-safe", "web-safe"],
        activityDescription,
        resultSchema: {
            kind: "text",
            description,
        },
        outputPersistencePolicy: "conversation",
    });
}

function withMemoryWriteContract(
    tool: Tool,
    activityDescription: string,
    description: string,
    options: {
        riskLevel?: "medium" | "high";
        needsPermission?: boolean;
        outputPersistencePolicy?: "artifact" | "external-state";
    } = {},
): Tool {
    return withToolContract(tool, {
        family: "memory",
        isReadOnly: false,
        isConcurrencySafe: false,
        needsPermission: options.needsPermission ?? true,
        riskLevel: options.riskLevel ?? "medium",
        channels: ["gateway", "web"],
        safeScopes: ["local-safe", "web-safe", "privileged"],
        activityDescription,
        resultSchema: {
            kind: "text",
            description,
        },
        outputPersistencePolicy: options.outputPersistencePolicy ?? "external-state",
    });
}

export const memorySearchTool: Tool = withToolContract({
    definition: {
        name: "memory_search",
        description: "Search the runtime memory index using hybrid retrieval (semantic vector search + keyword search). The index covers BELLDANDY_STATE_DIR sessions, memory files, MEMORY.md, DREAM.md, and dreams/*.md. Supports optional metadata filtering by memory type, channel, topic, category, and date range. Use detail_level='summary' (default) for quick overview, or 'full' for complete content.",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "The search query (natural language or keywords).",
                },
                limit: {
                    type: "number",
                    description: "Max number of results to return (default: 5).",
                },
                detail_level: {
                    type: "string",
                    enum: ["summary", "full"],
                    description: "Level of detail: 'summary' returns short summaries (saves tokens), 'full' returns complete content. Default: 'summary'.",
                },
                memory_type: {
                    type: "string",
                    description: "Filter by memory type: 'core' (long-term facts), 'daily' (daily notes), 'session' (conversation history), 'dream_index' (dream overview), 'dream_note' (individual dream notes), or 'other'. Can be comma-separated for multiple types.",
                },
                channel: {
                    type: "string",
                    description: "Filter by source channel: 'webchat', 'feishu', 'heartbeat', etc.",
                },
                topic: {
                    type: "string",
                    description: "Filter by topic tag stored on the memory chunk.",
                },
                category: {
                    type: "string",
                    description: "Filter by semantic category: 'preference', 'experience', 'fact', 'decision', 'entity', or 'other'.",
                },
                date_from: {
                    type: "string",
                    description: "Filter results from this date (YYYY-MM-DD).",
                },
                date_to: {
                    type: "string",
                    description: "Filter results up to this date (YYYY-MM-DD).",
                },
            },
            required: ["query"],
        },
    },

    async execute(args, context): Promise<ToolCallResult> {
        const start = Date.now();
        try {
            const manager = getMemoryManager(context.workspaceRoot);
            const query = args.query as string;
            const limit = (args.limit as number) || 5;
            const detailLevel = (args.detail_level as string) || "summary";

            // Build filter from args
            const filter: MemorySearchFilter = {};
            if (args.memory_type) {
                const types = (args.memory_type as string).split(",").map(s => s.trim());
                filter.memoryType = types.length === 1 ? types[0] as any : types as any;
            }
            if (args.channel) filter.channel = args.channel as string;
            if (args.topic) filter.topic = args.topic as string;
            if (args.category) filter.category = args.category as MemorySearchFilter["category"];
            if (args.date_from) filter.dateFrom = args.date_from as string;
            if (args.date_to) filter.dateTo = args.date_to as string;
            if (args.scope) filter.scope = args.scope as MemorySearchFilter["scope"];

            // Scope 隔离：自动注入 agentId（子 Agent 只检索自己的记忆）
            if (context.agentId) {
                filter.agentId = context.agentId;
            }

            const hasFilter = Object.keys(filter).length > 0;
            const results = await manager.search(query, context.abortSignal
                ? {
                    limit,
                    ...(hasFilter ? { filter } : {}),
                    signal: context.abortSignal,
                }
                : hasFilter ? { limit, filter } : limit);
            manager.linkTaskMemories(context.conversationId, results.map((item) => item.id), "used");

            // Format results based on detail_level
            const output = results.map(r => {
                const memoryTypeTag = formatMemoryTypeTag(r.memoryType);
                const visibilityTag = r.visibility === "shared" ? " [shared]" : "";
                const categoryTag = r.category ? ` [${r.category}]` : "";
                const location = `[${r.sourcePath}:${r.startLine || 0}]${memoryTypeTag}${visibilityTag}${categoryTag} (Score: ${r.score.toFixed(3)})`;
                if (detailLevel === "full") {
                    return `${location}\n${r.content ?? r.snippet}`;
                }
                // summary mode: prefer summary, fallback to truncated content
                const text = r.summary || truncateForSummary(r.snippet, 200);
                return `${location}\n${text}`;
            }).join("\n\n---\n\n");

            return {
                id: "memory_search",
                name: "memory_search",
                success: true,
                output: output || "No relevant results found.",
                durationMs: Date.now() - start,
            };

        } catch (err) {
            return {
                id: "memory_search",
                name: "memory_search",
                success: false,
                output: "",
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - start,
            };
        }
    },
}, {
    family: "memory",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    riskLevel: "low",
    channels: ["gateway", "web"],
    safeScopes: ["local-safe", "web-safe"],
    activityDescription: "Search indexed runtime memory and conversation history",
    resultSchema: {
        kind: "text",
        description: "Formatted memory search results text.",
    },
    outputPersistencePolicy: "conversation",
});

export const memoryIndexTool: Tool = withMemoryWriteContract({
    definition: {
        name: "memory_index",
        description: "Trigger a re-index of the workspace files into the memory. Use this after significant file changes or manually.",
        parameters: {
            type: "object",
            properties: {},
        },
    },

    async execute(_args, context): Promise<ToolCallResult> {
        const start = Date.now();
        try {
            const manager = getMemoryManager(context.workspaceRoot);
            await manager.indexWorkspace();
            const status = manager.getStatus();

            return {
                id: "memory_index",
                name: "memory_index",
                success: true,
                output: `Indexing completed. Files: ${status.files}, Chunks: ${status.chunks}, Vectors: ${status.vectorIndexed || 0}, Cached: ${status.vectorCached || 0}, Summarized: ${status.summarized || 0}, Summary Pending: ${status.summaryPending || 0}`,
                durationMs: Date.now() - start,
            };

        } catch (err) {
            return {
                id: "memory_index",
                name: "memory_index",
                success: false,
                output: "",
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - start,
            };
        }
    },
}, "Re-index workspace content into the memory system", "Memory indexing status text.", {
    needsPermission: false,
});

export const memoryReadTool: Tool = withToolContract({
    definition: {
        name: "memory_read",
        description: "Read a memory file such as MEMORY.md or memory/YYYY-MM-DD.md.",
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: "Memory file path, such as MEMORY.md or memory/2026-03-15.md.",
                },
                from: {
                    type: "number",
                    description: "Optional 1-based start line.",
                },
                lines: {
                    type: "number",
                    description: "Optional number of lines to read.",
                },
            },
            required: ["path"],
        },
    },

    async execute(args, context): Promise<ToolCallResult> {
        const start = Date.now();
        try {
            const manager = getMemoryManager(context.workspaceRoot);
            const relPath = String(args.path ?? "").trim();
            const from = typeof args.from === "number" ? args.from : undefined;
            const lines = typeof args.lines === "number" ? args.lines : undefined;
            const result = await readMemoryFile({
                workspaceDir: context.workspaceRoot,
                relPath,
                from,
                lines,
            });
            await manager.linkTaskMemoriesFromSource(context.conversationId, result.path, "used");

            return {
                id: "memory_read",
                name: "memory_read",
                success: true,
                output: `Path: ${result.path}\nTotal Lines: ${result.totalLines}\n\n${result.text}`,
                durationMs: Date.now() - start,
            };
        } catch (err) {
            return {
                id: "memory_read",
                name: "memory_read",
                success: false,
                output: "",
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - start,
            };
        }
    },
}, {
    family: "memory",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    riskLevel: "low",
    channels: ["gateway", "web"],
    safeScopes: ["local-safe", "web-safe"],
    activityDescription: "Read a structured memory file from the workspace memory area",
    resultSchema: {
        kind: "text",
        description: "Memory file content text with line metadata.",
    },
    outputPersistencePolicy: "conversation",
});

export const memoryWriteTool: Tool = withToolContract({
    definition: {
        name: "memory_write",
        description: "Write to a memory file. By default this appends to today's daily memory file.",
        parameters: {
            type: "object",
            properties: {
                content: {
                    type: "string",
                    description: "Memory content to write.",
                },
                path: {
                    type: "string",
                    description: "Optional target memory file path. Defaults to today's daily memory file.",
                },
                mode: {
                    type: "string",
                    enum: ["append", "overwrite"],
                    description: "Write mode. Default is append.",
                },
            },
            required: ["content"],
        },
    },

    async execute(args, context): Promise<ToolCallResult> {
        const start = Date.now();
        try {
            const manager = getMemoryManager(context.workspaceRoot);
            const content = String(args.content ?? "").trim();
            const relPath = typeof args.path === "string" && args.path.trim()
                ? args.path.trim()
                : null;
            const mode = args.mode === "overwrite" ? "overwrite" : "append";

            const filePath = relPath
                ? await writeMemoryFile({
                    workspaceDir: context.workspaceRoot,
                    relPath,
                    content,
                    mode,
                })
                : await appendToTodayMemory(context.workspaceRoot, content);

            if (context.agentId) {
                manager.assignMemorySourceAgent(filePath, context.agentId);
            }
            await manager.linkTaskMemoriesFromSource(context.conversationId, filePath, "generated");

            return {
                id: "memory_write",
                name: "memory_write",
                success: true,
                output: `Memory written: ${filePath}`,
                durationMs: Date.now() - start,
            };
        } catch (err) {
            return {
                id: "memory_write",
                name: "memory_write",
                success: false,
                output: "",
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - start,
            };
        }
    },
}, {
    family: "memory",
    isReadOnly: false,
    isConcurrencySafe: false,
    needsPermission: true,
    riskLevel: "medium",
    channels: ["gateway", "web"],
    safeScopes: ["privileged"],
    activityDescription: "Write to a memory file or append to today's memory log",
    resultSchema: {
        kind: "text",
        description: "Memory write confirmation text.",
    },
    outputPersistencePolicy: "artifact",
});

export const memorySharePromoteTool: Tool = withToolContract({
    definition: {
        name: "memory_share_promote",
        description: "Explicitly promote a memory chunk or all chunks from a source path to shared visibility. Use this when a memory should be retrievable by other agents via scope=shared or scope=all.",
        parameters: {
            type: "object",
            properties: {
                chunk_id: {
                    type: "string",
                    description: "Exact chunk ID to promote to shared visibility.",
                },
                source_path: {
                    type: "string",
                    description: "Exact source path whose chunks should all be promoted to shared visibility.",
                },
            },
            oneOf: [
                { required: ["chunk_id"] },
                { required: ["source_path"] },
            ],
        },
    },

    async execute(args, context): Promise<ToolCallResult> {
        const start = Date.now();
        try {
            const manager = getMemoryManager(context.workspaceRoot);
            const chunkId = typeof args.chunk_id === "string" ? args.chunk_id.trim() : "";
            const sourcePath = typeof args.source_path === "string" ? args.source_path.trim() : "";

            if (!chunkId && !sourcePath) {
                return {
                    id: "memory_share_promote",
                    name: "memory_share_promote",
                    success: false,
                    output: "",
                    error: "chunk_id or source_path is required.",
                    durationMs: Date.now() - start,
                };
            }

            if (chunkId) {
                const chunk = manager.promoteMemoryChunk(chunkId);
                if (!chunk) {
                    return {
                        id: "memory_share_promote",
                        name: "memory_share_promote",
                        success: false,
                        output: "",
                        error: `Memory chunk not found: ${chunkId}`,
                        durationMs: Date.now() - start,
                    };
                }

                manager.linkTaskMemories(context.conversationId, [chunk.id], "referenced");
                return {
                    id: "memory_share_promote",
                    name: "memory_share_promote",
                    success: true,
                    output: `Promoted 1 chunk to shared.\nChunk: ${chunk.id}\nSource: ${chunk.sourcePath}\nVisibility: ${chunk.visibility ?? "shared"}`,
                    durationMs: Date.now() - start,
                };
            }

            const promoted = manager.promoteMemorySource(sourcePath);
            if (promoted.count <= 0) {
                return {
                    id: "memory_share_promote",
                    name: "memory_share_promote",
                    success: false,
                    output: "",
                    error: `No memory chunks found for source_path: ${sourcePath}`,
                    durationMs: Date.now() - start,
                };
            }

            await manager.linkTaskMemoriesFromSource(context.conversationId, sourcePath, "referenced");
            const chunkIds = promoted.chunks.map((item) => item.id).join(", ");
            return {
                id: "memory_share_promote",
                name: "memory_share_promote",
                success: true,
                output: `Promoted ${promoted.count} chunks to shared.\nSource: ${sourcePath}\nChunks: ${chunkIds}`,
                durationMs: Date.now() - start,
            };
        } catch (err) {
            return {
                id: "memory_share_promote",
                name: "memory_share_promote",
                success: false,
                output: "",
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - start,
            };
        }
    },
}, {
    family: "memory",
    isReadOnly: false,
    isConcurrencySafe: false,
    needsPermission: true,
    riskLevel: "medium",
    channels: ["gateway", "web"],
    safeScopes: ["privileged"],
    activityDescription: "Promote memory chunks to shared visibility",
    resultSchema: {
        kind: "text",
        description: "Shared memory promotion result text.",
    },
    outputPersistencePolicy: "external-state",
});

export const taskSearchTool: Tool = withToolContract({
    definition: {
        name: "task_search",
        description: "Search historical task summaries. Use this to find similar completed tasks, past failures, or reusable execution patterns.",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Keyword or natural language query for past tasks.",
                },
                limit: {
                    type: "number",
                    description: "Max number of results to return (default: 5).",
                },
                status: {
                    type: "string",
                    description: "Filter by task status: success, failed, partial, running. Can be comma-separated.",
                },
                source: {
                    type: "string",
                    description: "Filter by task source: chat, sub_agent, cron, heartbeat, manual. Can be comma-separated.",
                },
                date_from: {
                    type: "string",
                    description: "Filter results from this date (YYYY-MM-DD).",
                },
                date_to: {
                    type: "string",
                    description: "Filter results up to this date (YYYY-MM-DD).",
                },
            },
            required: ["query"],
        },
    },

    async execute(args, context): Promise<ToolCallResult> {
        const start = Date.now();
        try {
            const manager = getMemoryManager(context.workspaceRoot);
            const query = String(args.query ?? "").trim();
            const limit = (args.limit as number) || 5;
            if (typeof args.scope === "string" && args.scope.trim()) {
                return {
                    id: "task_search",
                    name: "task_search",
                    success: false,
                    output: "",
                    error: "task_search does not support scope. Task history is isolated by agentId only. Use status/source/date filters, or use memory_search for scoped memory retrieval.",
                    durationMs: Date.now() - start,
                };
            }
            const filter = buildTaskFilter(args, context.agentId);
            const results = manager.searchTasks(query, { limit, filter });

            return {
                id: "task_search",
                name: "task_search",
                success: true,
                output: formatTaskList(results) || "No matching tasks found.",
                durationMs: Date.now() - start,
            };
        } catch (err) {
            return {
                id: "task_search",
                name: "task_search",
                success: false,
                output: "",
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - start,
            };
        }
    },
}, {
    family: "memory",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    riskLevel: "low",
    channels: ["gateway", "web"],
    safeScopes: ["local-safe", "web-safe"],
    activityDescription: "Search historical task summaries and execution patterns",
    resultSchema: {
        kind: "text",
        description: "Formatted task search result text.",
    },
    outputPersistencePolicy: "conversation",
});

export const taskRecentTool: Tool = withToolContract({
    definition: {
        name: "task_recent",
        description: "List recent task summaries. Useful for checking what Belldandy has just completed.",
        parameters: {
            type: "object",
            properties: {
                limit: {
                    type: "number",
                    description: "Max number of results to return (default: 5).",
                },
                status: {
                    type: "string",
                    description: "Filter by task status: success, failed, partial, running. Can be comma-separated.",
                },
                source: {
                    type: "string",
                    description: "Filter by task source: chat, sub_agent, cron, heartbeat, manual. Can be comma-separated.",
                },
            },
        },
    },

    async execute(args, context): Promise<ToolCallResult> {
        const start = Date.now();
        try {
            const manager = getMemoryManager(context.workspaceRoot);
            const limit = (args.limit as number) || 5;
            const filter = buildTaskFilter(args, context.agentId);
            const results = manager.getRecentTasks(limit, filter);

            return {
                id: "task_recent",
                name: "task_recent",
                success: true,
                output: formatTaskList(results) || "No recent tasks found.",
                durationMs: Date.now() - start,
            };
        } catch (err) {
            return {
                id: "task_recent",
                name: "task_recent",
                success: false,
                output: "",
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - start,
            };
        }
    },
}, {
    family: "memory",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    riskLevel: "low",
    channels: ["gateway", "web"],
    safeScopes: ["local-safe", "web-safe"],
    activityDescription: "List recent task summaries",
    resultSchema: {
        kind: "text",
        description: "Formatted recent task list text.",
    },
    outputPersistencePolicy: "conversation",
});

export const recentWorkTool: Tool = withToolContract({
    definition: {
        name: "recent_work",
        description: "Return the most recent historical work Belldandy has already done. Prefer this over broad task_search when you want a fast answer to 'what did we just do?' or 'what was recently touched?'.",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Optional narrowing query, such as a module, bug, or file keyword.",
                },
                limit: {
                    type: "number",
                    description: "Max number of results to return (default: 5).",
                },
                status: {
                    type: "string",
                    description: "Optional task status filter: success, failed, partial, running. Can be comma-separated.",
                },
                source: {
                    type: "string",
                    description: "Optional task source filter: chat, sub_agent, cron, heartbeat, manual. Can be comma-separated.",
                },
                date_from: {
                    type: "string",
                    description: "Optional lower date bound (YYYY-MM-DD).",
                },
                date_to: {
                    type: "string",
                    description: "Optional upper date bound (YYYY-MM-DD).",
                },
                detail_level: {
                    type: "string",
                    enum: ["summary", "full"],
                    description: "Progressive disclosure level. Default 'summary' only returns一级摘要；'full' returns matched reasons and recent activity.",
                },
            },
        },
    },

    async execute(args, context): Promise<ToolCallResult> {
        const start = Date.now();
        try {
            const taskWorkSurface = getTaskWorkSurface(context.workspaceRoot);
            const query = typeof args.query === "string" ? args.query.trim() : undefined;
            const limit = (args.limit as number) || 5;
            const filter = buildTaskFilter(args, context.agentId);
            const detailLevel = parseTaskShortcutDetailLevel(args);
            const items = taskWorkSurface.recentWork({ query, limit, filter });

            return {
                id: "recent_work",
                name: "recent_work",
                success: true,
                output: formatTaskWorkShortcutList(items, detailLevel) || "No recent work found.",
                durationMs: Date.now() - start,
            };
        } catch (err) {
            return {
                id: "recent_work",
                name: "recent_work",
                success: false,
                output: "",
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - start,
            };
        }
    },
}, {
    family: "memory",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    riskLevel: "low",
    channels: ["gateway", "web"],
    safeScopes: ["local-safe", "web-safe"],
    activityDescription: "Read recent completed or in-progress historical work shortcuts",
    resultSchema: {
        kind: "text",
        description: "Formatted recent work summary text.",
    },
    outputPersistencePolicy: "conversation",
});

export const resumeContextTool: Tool = withToolContract({
    definition: {
        name: "resume_context",
        description: "Return where a historical task last stopped and what the next step should be. Use this for '上次做到哪了' or '从哪继续'.",
        parameters: {
            type: "object",
            properties: {
                task_id: {
                    type: "string",
                    description: "Optional exact task ID to resume from.",
                },
                conversation_id: {
                    type: "string",
                    description: "Optional conversation ID whose latest task should be used.",
                },
                query: {
                    type: "string",
                    description: "Optional narrowing query, such as a feature name, module, or bug description.",
                },
                status: {
                    type: "string",
                    description: "Optional task status filter: success, failed, partial, running. Can be comma-separated.",
                },
                source: {
                    type: "string",
                    description: "Optional task source filter: chat, sub_agent, cron, heartbeat, manual. Can be comma-separated.",
                },
                date_from: {
                    type: "string",
                    description: "Optional lower date bound (YYYY-MM-DD).",
                },
                date_to: {
                    type: "string",
                    description: "Optional upper date bound (YYYY-MM-DD).",
                },
                detail_level: {
                    type: "string",
                    enum: ["summary", "full"],
                    description: "Progressive disclosure level. Default 'summary' only returns stop/next摘要；'full' returns facts, blockers, and recent activity.",
                },
            },
        },
    },

    async execute(args, context): Promise<ToolCallResult> {
        const start = Date.now();
        try {
            const taskWorkSurface = getTaskWorkSurface(context.workspaceRoot);
            const filter = buildTaskFilter(args, context.agentId);
            const detailLevel = parseTaskShortcutDetailLevel(args);
            const item = taskWorkSurface.resumeContext({
                taskId: typeof args.task_id === "string" ? args.task_id.trim() : undefined,
                conversationId: typeof args.conversation_id === "string" ? args.conversation_id.trim() : undefined,
                query: typeof args.query === "string" ? args.query.trim() : undefined,
                filter,
            });

            return {
                id: "resume_context",
                name: "resume_context",
                success: true,
                output: item ? formatResumeContextShortcut(item, detailLevel) : "No resumable context found.",
                durationMs: Date.now() - start,
            };
        } catch (err) {
            return {
                id: "resume_context",
                name: "resume_context",
                success: false,
                output: "",
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - start,
            };
        }
    },
}, {
    family: "memory",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    riskLevel: "low",
    channels: ["gateway", "web"],
    safeScopes: ["local-safe", "web-safe"],
    activityDescription: "Read resumable stop point and next-step context from recent task history",
    resultSchema: {
        kind: "text",
        description: "Formatted resumable context text.",
    },
    outputPersistencePolicy: "conversation",
});

export const similarPastWorkTool: Tool = withToolContract({
    definition: {
        name: "similar_past_work",
        description: "Find similar historical implementation or fix work from task memory. Use this before broad memory_search when the question is 'have we done something like this before?'.",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Required query describing the similar past work to find.",
                },
                limit: {
                    type: "number",
                    description: "Max number of results to return (default: 5).",
                },
                status: {
                    type: "string",
                    description: "Optional task status filter: success, failed, partial, running. Can be comma-separated.",
                },
                source: {
                    type: "string",
                    description: "Optional task source filter: chat, sub_agent, cron, heartbeat, manual. Can be comma-separated.",
                },
                date_from: {
                    type: "string",
                    description: "Optional lower date bound (YYYY-MM-DD).",
                },
                date_to: {
                    type: "string",
                    description: "Optional upper date bound (YYYY-MM-DD).",
                },
                detail_level: {
                    type: "string",
                    enum: ["summary", "full"],
                    description: "Progressive disclosure level. Default 'summary' only returns一级摘要；'full' returns matched reasons and recent activity.",
                },
            },
            required: ["query"],
        },
    },

    async execute(args, context): Promise<ToolCallResult> {
        const start = Date.now();
        try {
            const taskWorkSurface = getTaskWorkSurface(context.workspaceRoot);
            const query = String(args.query ?? "").trim();
            const limit = (args.limit as number) || 5;
            const filter = buildTaskFilter(args, context.agentId);
            const detailLevel = parseTaskShortcutDetailLevel(args);
            const items = taskWorkSurface.findSimilarWork({ query, limit, filter });

            return {
                id: "similar_past_work",
                name: "similar_past_work",
                success: true,
                output: formatTaskWorkShortcutList(items, detailLevel) || "No similar past work found.",
                durationMs: Date.now() - start,
            };
        } catch (err) {
            return {
                id: "similar_past_work",
                name: "similar_past_work",
                success: false,
                output: "",
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - start,
            };
        }
    },
}, {
    family: "memory",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    riskLevel: "low",
    channels: ["gateway", "web"],
    safeScopes: ["local-safe", "web-safe"],
    activityDescription: "Find similar historical work shortcuts from task memory",
    resultSchema: {
        kind: "text",
        description: "Formatted similar past work summary text.",
    },
    outputPersistencePolicy: "conversation",
});

export const taskGetTool: Tool = withToolContract({
    definition: {
        name: "task_get",
        description: "Get the full detail of a task summary by task ID.",
        parameters: {
            type: "object",
            properties: {
                task_id: {
                    type: "string",
                    description: "The task ID returned by task_search or task_recent.",
                },
            },
            required: ["task_id"],
        },
    },

    async execute(args, context): Promise<ToolCallResult> {
        const start = Date.now();
        try {
            const manager = getMemoryManager(context.workspaceRoot);
            const taskId = String(args.task_id ?? "").trim();
            const task = manager.getTaskDetail(taskId);

            return {
                id: "task_get",
                name: "task_get",
                success: true,
                output: task ? formatTaskDetail(task) : "Task not found.",
                durationMs: Date.now() - start,
            };
        } catch (err) {
            return {
                id: "task_get",
                name: "task_get",
                success: false,
                output: "",
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - start,
            };
        }
    },
}, {
    family: "memory",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    riskLevel: "low",
    channels: ["gateway", "web"],
    safeScopes: ["local-safe", "web-safe"],
    activityDescription: "Get the full detail for a historical task record",
    resultSchema: {
        kind: "text",
        description: "Formatted task detail text.",
    },
    outputPersistencePolicy: "conversation",
});

export const taskPromoteMethodTool: Tool = withMemoryWriteContract({
    definition: {
        name: "task_promote_method",
        description: "Generate a method candidate draft from a historical task. This only writes to the experience candidate layer and does not publish to methods/ yet.",
        parameters: {
            type: "object",
            properties: {
                task_id: {
                    type: "string",
                    description: "The task ID returned by task_search, task_recent, or task_get.",
                },
            },
            required: ["task_id"],
        },
    },

    async execute(args, context): Promise<ToolCallResult> {
        const start = Date.now();
        try {
            const manager = getMemoryManager(context.workspaceRoot);
            const taskId = String(args.task_id ?? "").trim();
            const result = manager.promoteTaskToMethodCandidate(taskId);

            return {
                id: "task_promote_method",
                name: "task_promote_method",
                success: true,
                output: result
                    ? formatExperiencePromotionResult(result, "method")
                    : "Task not found.",
                durationMs: Date.now() - start,
            };
        } catch (err) {
            return {
                id: "task_promote_method",
                name: "task_promote_method",
                success: false,
                output: "",
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - start,
            };
        }
    },
}, "Promote a historical task into a method candidate", "Experience promotion result text.", {
    needsPermission: methodGenerationConfirmRequired,
});

export const taskPromoteSkillDraftTool: Tool = withMemoryWriteContract({
    definition: {
        name: "task_promote_skill_draft",
        description: "Generate a skill draft candidate from a historical task. This only writes to the experience candidate layer and does not publish to user skills yet.",
        parameters: {
            type: "object",
            properties: {
                task_id: {
                    type: "string",
                    description: "The task ID returned by task_search, task_recent, or task_get.",
                },
            },
            required: ["task_id"],
        },
    },

    async execute(args, context): Promise<ToolCallResult> {
        const start = Date.now();
        try {
            const manager = getMemoryManager(context.workspaceRoot);
            const taskId = String(args.task_id ?? "").trim();
            const result = manager.promoteTaskToSkillCandidate(taskId);

            return {
                id: "task_promote_skill_draft",
                name: "task_promote_skill_draft",
                success: true,
                output: result
                    ? formatExperiencePromotionResult(result, "skill")
                    : "Task not found.",
                durationMs: Date.now() - start,
            };
        } catch (err) {
            return {
                id: "task_promote_skill_draft",
                name: "task_promote_skill_draft",
                success: false,
                output: "",
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - start,
            };
        }
    },
}, "Promote a historical task into a skill draft candidate", "Experience promotion result text.", {
    needsPermission: skillGenerationConfirmRequired,
});

export const experienceCandidateGetTool: Tool = withMemoryReadContract({
    definition: {
        name: "experience_candidate_get",
        description: "Get the full audit detail of one experience candidate by candidate ID.",
        parameters: {
            type: "object",
            properties: {
                candidate_id: {
                    type: "string",
                    description: "Experience candidate ID returned by experience_candidate_list or task_get.",
                },
            },
            required: ["candidate_id"],
        },
    },

    async execute(args, context): Promise<ToolCallResult> {
        const start = Date.now();
        try {
            const manager = getMemoryManager(context.workspaceRoot);
            const candidateId = String(args.candidate_id ?? "").trim();
            const item = manager.getExperienceCandidate(candidateId);

            return {
                id: "experience_candidate_get",
                name: "experience_candidate_get",
                success: true,
                output: item ? formatExperienceCandidateDetail(item) : "Experience candidate not found.",
                durationMs: Date.now() - start,
            };
        } catch (err) {
            return {
                id: "experience_candidate_get",
                name: "experience_candidate_get",
                success: false,
                output: "",
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - start,
            };
        }
    },
}, "Read one experience candidate in detail", "Experience candidate detail text.");

export const experienceCandidateListTool: Tool = withMemoryReadContract({
    definition: {
        name: "experience_candidate_list",
        description: "List method/skill experience candidates waiting for review.",
        parameters: {
            type: "object",
            properties: {
                limit: {
                    type: "number",
                    description: "Max number of candidates to return (default: 10).",
                },
                type: {
                    type: "string",
                    description: "Filter by candidate type: method or skill. Can be comma-separated.",
                },
                status: {
                    type: "string",
                    description: "Filter by candidate status: draft, reviewed, accepted, rejected. Can be comma-separated.",
                },
                task_id: {
                    type: "string",
                    description: "Only list candidates from a specific task ID.",
                },
            },
        },
    },

    async execute(args, context): Promise<ToolCallResult> {
        const start = Date.now();
        try {
            const manager = getMemoryManager(context.workspaceRoot);
            const limit = (args.limit as number) || 10;
            const filter = buildExperienceCandidateFilter(args, context.agentId);
            const items = manager.listExperienceCandidates(limit, filter);

            return {
                id: "experience_candidate_list",
                name: "experience_candidate_list",
                success: true,
                output: formatExperienceCandidateList(items) || "No experience candidates found.",
                durationMs: Date.now() - start,
            };
        } catch (err) {
            return {
                id: "experience_candidate_list",
                name: "experience_candidate_list",
                success: false,
                output: "",
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - start,
            };
        }
    },
}, "List experience candidates awaiting review", "Experience candidate list text.");

export const experienceCandidateAcceptTool: Tool = withMemoryWriteContract({
    definition: {
        name: "experience_candidate_accept",
        description: "Mark an experience candidate as accepted. Method candidates will be published to methods/; skill candidates will be published to user skills/ and become discoverable via skills_search.",
        parameters: {
            type: "object",
            properties: {
                candidate_id: {
                    type: "string",
                    description: "Experience candidate ID returned by experience_candidate_list.",
                },
            },
            required: ["candidate_id"],
        },
    },

    async execute(args, context): Promise<ToolCallResult> {
        const start = Date.now();
        try {
            const manager = getMemoryManager(context.workspaceRoot);
            const candidateId = String(args.candidate_id ?? "").trim();
            const existing = manager.getExperienceCandidate(candidateId);
            if (!existing) {
                return {
                    id: "experience_candidate_accept",
                    name: "experience_candidate_accept",
                    success: true,
                    output: "Experience candidate not found.",
                    durationMs: Date.now() - start,
                };
            }
            if (existing.status !== "draft") {
                return {
                    id: "experience_candidate_accept",
                    name: "experience_candidate_accept",
                    success: true,
                    output: formatExperienceCandidateInvalidState(existing, "accept"),
                    durationMs: Date.now() - start,
                };
            }

            let publishedPath: string | undefined;
            if (existing.type === "skill") {
                publishedPath = await publishSkillCandidate(
                    existing,
                    context.workspaceRoot,
                    getGlobalSkillRegistry(),
                );
            }

            const candidate = manager.acceptExperienceCandidate(candidateId, publishedPath ? { publishedPath } : {});
            return {
                id: "experience_candidate_accept",
                name: "experience_candidate_accept",
                success: true,
                output: candidate ? formatExperienceCandidateDecision(candidate, "accepted") : "Experience candidate not found.",
                durationMs: Date.now() - start,
            };
        } catch (err) {
            return {
                id: "experience_candidate_accept",
                name: "experience_candidate_accept",
                success: false,
                output: "",
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - start,
            };
        }
    },
}, "Accept an experience candidate and optionally publish it", "Experience candidate acceptance result text.", {
    needsPermission: methodPublishConfirmRequired || skillPublishConfirmRequired,
    riskLevel: "high",
    outputPersistencePolicy: "artifact",
});

export const experienceCandidateRejectTool: Tool = withMemoryWriteContract({
    definition: {
        name: "experience_candidate_reject",
        description: "Mark an experience candidate as rejected.",
        parameters: {
            type: "object",
            properties: {
                candidate_id: {
                    type: "string",
                    description: "Experience candidate ID returned by experience_candidate_list.",
                },
            },
            required: ["candidate_id"],
        },
    },

    async execute(args, context): Promise<ToolCallResult> {
        const start = Date.now();
        try {
            const manager = getMemoryManager(context.workspaceRoot);
            const candidateId = String(args.candidate_id ?? "").trim();
            const existing = manager.getExperienceCandidate(candidateId);
            if (!existing) {
                return {
                    id: "experience_candidate_reject",
                    name: "experience_candidate_reject",
                    success: true,
                    output: "Experience candidate not found.",
                    durationMs: Date.now() - start,
                };
            }
            if (existing.status !== "draft") {
                return {
                    id: "experience_candidate_reject",
                    name: "experience_candidate_reject",
                    success: true,
                    output: formatExperienceCandidateInvalidState(existing, "reject"),
                    durationMs: Date.now() - start,
                };
            }
            const candidate = manager.rejectExperienceCandidate(candidateId);
            return {
                id: "experience_candidate_reject",
                name: "experience_candidate_reject",
                success: true,
                output: candidate ? formatExperienceCandidateDecision(candidate, "rejected") : "Experience candidate not found.",
                durationMs: Date.now() - start,
            };
        } catch (err) {
            return {
                id: "experience_candidate_reject",
                name: "experience_candidate_reject",
                success: false,
                output: "",
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - start,
            };
        }
    },
}, "Reject an experience candidate", "Experience candidate rejection result text.");

export const experienceUsageGetTool: Tool = withMemoryReadContract({
    definition: {
        name: "experience_usage_get",
        description: "Get one experience usage record by usage ID for audit tracing.",
        parameters: {
            type: "object",
            properties: {
                usage_id: {
                    type: "string",
                    description: "Usage ID returned by task_get, experience_usage_list, or experience_usage_record.",
                },
            },
            required: ["usage_id"],
        },
    },

    async execute(args, context): Promise<ToolCallResult> {
        const start = Date.now();
        try {
            const manager = getMemoryManager(context.workspaceRoot);
            const usageId = String(args.usage_id ?? "").trim();
            const usage = manager.getExperienceUsage(usageId);

            return {
                id: "experience_usage_get",
                name: "experience_usage_get",
                success: true,
                output: usage ? formatExperienceUsageDetail(usage, manager) : "Experience usage not found.",
                durationMs: Date.now() - start,
            };
        } catch (err) {
            return {
                id: "experience_usage_get",
                name: "experience_usage_get",
                success: false,
                output: "",
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - start,
            };
        }
    },
}, "Read one experience usage audit record", "Experience usage detail text.");

export const experienceUsageListTool: Tool = withMemoryReadContract({
    definition: {
        name: "experience_usage_list",
        description: "List experience usage records for audit tracing. You can filter by task, asset, or source candidate.",
        parameters: {
            type: "object",
            properties: {
                limit: {
                    type: "number",
                    description: "Max number of usage records to return (default: 10).",
                },
                task_id: {
                    type: "string",
                    description: "Only list usage records for a specific task ID.",
                },
                asset_type: {
                    type: "string",
                    description: "Filter by asset type.",
                    enum: ["method", "skill"],
                },
                asset_key: {
                    type: "string",
                    description: "Filter by exact asset key.",
                },
                source_candidate_id: {
                    type: "string",
                    description: "Filter by source experience candidate ID.",
                },
            },
        },
    },

    async execute(args, context): Promise<ToolCallResult> {
        const start = Date.now();
        try {
            const manager = getMemoryManager(context.workspaceRoot);
            const limit = (args.limit as number) || 10;
            const filter = buildExperienceUsageFilter(args);
            const items = manager.listExperienceUsages(limit, filter);

            return {
                id: "experience_usage_list",
                name: "experience_usage_list",
                success: true,
                output: formatExperienceUsageList(items, manager) || "No experience usages found.",
                durationMs: Date.now() - start,
            };
        } catch (err) {
            return {
                id: "experience_usage_list",
                name: "experience_usage_list",
                success: false,
                output: "",
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - start,
            };
        }
    },
}, "List experience usage audit records", "Experience usage list text.");

export const experienceUsageRecordTool: Tool = withMemoryWriteContract({
    definition: {
        name: "experience_usage_record",
        description: "Record that the current task actually adopted a method or skill. Use this only after you truly decided to apply the method/skill, not merely after searching.",
        parameters: {
            type: "object",
            properties: {
                asset_type: {
                    type: "string",
                    description: "Experience asset type.",
                    enum: ["method", "skill"],
                },
                asset_key: {
                    type: "string",
                    description: "Method filename or skill name that was actually adopted.",
                },
                source_candidate_id: {
                    type: "string",
                    description: "Optional source experience candidate ID if you know which candidate the asset came from.",
                },
                used_via: {
                    type: "string",
                    description: "How the asset was adopted.",
                    enum: ["manual", "search", "tool", "auto_suggest"],
                },
            },
            required: ["asset_type", "asset_key"],
        },
    },

    async execute(args, context): Promise<ToolCallResult> {
        const start = Date.now();
        try {
            const manager = getMemoryManager(context.workspaceRoot);
            const task = manager.getTaskByConversation(context.conversationId);
            if (!task) {
                return {
                    id: "experience_usage_record",
                    name: "experience_usage_record",
                    success: true,
                    output: "No task found for the current conversation. Usage was not recorded.",
                    durationMs: Date.now() - start,
                };
            }

            const assetType = String(args.asset_type ?? "").trim() as "method" | "skill";
            const assetKey = String(args.asset_key ?? "").trim();
            const sourceCandidateId = typeof args.source_candidate_id === "string" ? args.source_candidate_id.trim() : undefined;
            const usedVia = (typeof args.used_via === "string" ? args.used_via.trim() : "") as ExperienceUsageVia;

            if ((assetType !== "method" && assetType !== "skill") || !assetKey) {
                return {
                    id: "experience_usage_record",
                    name: "experience_usage_record",
                    success: false,
                    output: "",
                    error: "asset_type must be 'method' or 'skill', and asset_key is required.",
                    durationMs: Date.now() - start,
                };
            }

            const recorded = manager.recordExperienceUsage({
                taskId: task.id,
                assetType,
                assetKey,
                sourceCandidateId,
                usedVia: usedVia || "tool",
            });

            if (!recorded) {
                return {
                    id: "experience_usage_record",
                    name: "experience_usage_record",
                    success: true,
                    output: "Usage was not recorded.",
                    durationMs: Date.now() - start,
                };
            }

            return {
                id: "experience_usage_record",
                name: "experience_usage_record",
                success: true,
                output: formatExperienceUsageRecordResult(recorded, task.id),
                durationMs: Date.now() - start,
            };
        } catch (err) {
            return {
                id: "experience_usage_record",
                name: "experience_usage_record",
                success: false,
                output: "",
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - start,
            };
        }
    },
}, "Record that a task adopted a method or skill", "Experience usage record result text.", {
    needsPermission: false,
});

export const experienceUsageRevokeTool: Tool = withMemoryWriteContract({
    definition: {
        name: "experience_usage_revoke",
        description: "Revoke a mistakenly recorded method/skill usage. By default this only operates on the current task in the current conversation.",
        parameters: {
            type: "object",
            properties: {
                usage_id: {
                    type: "string",
                    description: "Specific usage record ID to revoke. If provided, it must belong to the current task.",
                },
                asset_type: {
                    type: "string",
                    description: "Experience asset type for current-task revoke.",
                    enum: ["method", "skill"],
                },
                asset_key: {
                    type: "string",
                    description: "Method filename or skill name to revoke on the current task.",
                },
            },
        },
    },

    async execute(args, context): Promise<ToolCallResult> {
        const start = Date.now();
        try {
            const manager = getMemoryManager(context.workspaceRoot);
            const task = manager.getTaskByConversation(context.conversationId);
            if (!task) {
                return {
                    id: "experience_usage_revoke",
                    name: "experience_usage_revoke",
                    success: true,
                    output: "No task found for the current conversation. Usage was not revoked.",
                    durationMs: Date.now() - start,
                };
            }

            const usageId = typeof args.usage_id === "string" ? args.usage_id.trim() : "";
            if (usageId) {
                const existing = manager.getExperienceUsage(usageId);
                if (!existing) {
                    return {
                        id: "experience_usage_revoke",
                        name: "experience_usage_revoke",
                        success: true,
                        output: "Experience usage not found. Nothing was revoked.",
                        durationMs: Date.now() - start,
                    };
                }
                if (existing.taskId !== task.id) {
                    return {
                        id: "experience_usage_revoke",
                        name: "experience_usage_revoke",
                        success: false,
                        output: "",
                        error: "usage_id does not belong to the current task.",
                        durationMs: Date.now() - start,
                    };
                }

                const revoked = manager.revokeExperienceUsage({ usageId });
                return {
                    id: "experience_usage_revoke",
                    name: "experience_usage_revoke",
                    success: true,
                    output: revoked
                        ? formatExperienceUsageRevokeResult(revoked)
                        : "Experience usage not found. Nothing was revoked.",
                    durationMs: Date.now() - start,
                };
            }

            const assetType = String(args.asset_type ?? "").trim() as "method" | "skill";
            const assetKey = String(args.asset_key ?? "").trim();
            if ((assetType !== "method" && assetType !== "skill") || !assetKey) {
                return {
                    id: "experience_usage_revoke",
                    name: "experience_usage_revoke",
                    success: false,
                    output: "",
                    error: "usage_id is required, or asset_type must be 'method' or 'skill' with asset_key.",
                    durationMs: Date.now() - start,
                };
            }

            const revoked = manager.revokeExperienceUsage({
                taskId: task.id,
                assetType,
                assetKey,
            });

            return {
                id: "experience_usage_revoke",
                name: "experience_usage_revoke",
                success: true,
                output: revoked
                    ? formatExperienceUsageRevokeResult(revoked)
                    : "Experience usage not found on the current task. Nothing was revoked.",
                durationMs: Date.now() - start,
            };
        } catch (err) {
            return {
                id: "experience_usage_revoke",
                name: "experience_usage_revoke",
                success: false,
                output: "",
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - start,
            };
        }
    },
}, "Revoke a previously recorded experience usage", "Experience usage revoke result text.", {
    needsPermission: false,
});

// ============================================================================
// Legacy / Compatibility Exports
// ============================================================================

export type MemorySearchToolConfig = {
    // Configuration properties if needed for backward compatibility
    storePath?: string;
};

export function createMemorySearchTool(config?: MemorySearchToolConfig): Tool {
    // In the new singleton architecture, config is handled by the environment/defaults
    // or we could pass config to the first getMemoryManager call if not initialized.
    // For now, return the singleton tool.
    return memorySearchTool;
}

export function createMemoryGetTool(): Tool {
    return withToolContract({
        definition: {
            name: "memory_get",
            description: "[Deprecated] Retrieve raw memory/file content. Please use 'file_read' or 'memory_search' instead.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Path to the file or memory item to retrieve."
                    }
                },
                required: ["path"]
            },
        },
        async execute(args, context): Promise<ToolCallResult> {
            return {
                id: "memory_get",
                name: "memory_get",
                success: false,
                output: "",
                error: "This tool is deprecated. Please use 'file_read' to read files or 'memory_search' to find content.",
                durationMs: 0
            };
        }
    }, {
        family: "memory",
        isReadOnly: true,
        isConcurrencySafe: true,
        needsPermission: false,
        riskLevel: "low",
        channels: ["gateway", "web"],
        safeScopes: ["local-safe", "web-safe"],
        activityDescription: "Return a deprecated memory retrieval notice",
        resultSchema: {
            kind: "text",
            description: "Deprecated tool guidance text.",
        },
        outputPersistencePolicy: "conversation",
    });
}

// ============================================================================
// Helpers
// ============================================================================

/** 截断文本用于 summary 模式降级（无 LLM 摘要时的 fallback） */
function truncateForSummary(text: string, maxLen: number): string {
    if (!text || text.length <= maxLen) return text;
    // 尝试在句号/换行处截断，避免截断在词中间
    const cut = text.slice(0, maxLen);
    const lastBreak = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("\n"), cut.lastIndexOf(". "));
    if (lastBreak > maxLen * 0.5) {
        return cut.slice(0, lastBreak + 1);
    }
    return cut + "...";
}

function buildTaskFilter(args: Record<string, unknown>, agentId?: string): TaskSearchFilter | undefined {
    const filter: TaskSearchFilter = {};

    if (args.status) {
        const values = String(args.status).split(",").map((value) => value.trim()).filter(Boolean);
        if (values.length === 1) {
            filter.status = values[0] as TaskSearchFilter["status"];
        } else if (values.length > 1) {
            filter.status = values as Exclude<TaskSearchFilter["status"], string>;
        }
    }

    if (args.source) {
        const values = String(args.source).split(",").map((value) => value.trim()).filter(Boolean);
        if (values.length === 1) {
            filter.source = values[0] as TaskSearchFilter["source"];
        } else if (values.length > 1) {
            filter.source = values as Exclude<TaskSearchFilter["source"], string>;
        }
    }

    if (args.date_from) filter.dateFrom = String(args.date_from);
    if (args.date_to) filter.dateTo = String(args.date_to);
    if (agentId) filter.agentId = agentId;

    return Object.keys(filter).length > 0 ? filter : undefined;
}

function parseTaskShortcutDetailLevel(args: Record<string, unknown>): "summary" | "full" {
    return args.detail_level === "full" ? "full" : "summary";
}

function buildExperienceCandidateFilter(args: Record<string, unknown>, agentId?: string): ExperienceCandidateListFilter | undefined {
    const filter: ExperienceCandidateListFilter = {};

    if (args.type) {
        const values = String(args.type).split(",").map((value) => value.trim()).filter(Boolean);
        if (values.length === 1) {
            filter.type = values[0] as ExperienceCandidateListFilter["type"];
        } else if (values.length > 1) {
            filter.type = values as Exclude<ExperienceCandidateListFilter["type"], string>;
        }
    }

    if (args.status) {
        const values = String(args.status).split(",").map((value) => value.trim()).filter(Boolean);
        if (values.length === 1) {
            filter.status = values[0] as ExperienceCandidateListFilter["status"];
        } else if (values.length > 1) {
            filter.status = values as Exclude<ExperienceCandidateListFilter["status"], string>;
        }
    }

    if (args.task_id) filter.taskId = String(args.task_id);
    if (agentId) filter.agentId = agentId;
    return Object.keys(filter).length > 0 ? filter : undefined;
}

function buildExperienceUsageFilter(args: Record<string, unknown>): ExperienceUsageListFilter | undefined {
    const filter: ExperienceUsageListFilter = {};
    if (args.task_id) filter.taskId = String(args.task_id);
    if (args.asset_key) filter.assetKey = String(args.asset_key);
    if (args.source_candidate_id) filter.sourceCandidateId = String(args.source_candidate_id);
    if (args.asset_type) {
        const value = String(args.asset_type).trim();
        if (value === "method" || value === "skill") {
            filter.assetType = value;
        }
    }
    return Object.keys(filter).length > 0 ? filter : undefined;
}

function formatTaskList(tasks: TaskRecord[]): string {
    return tasks.map((task) => {
        const title = task.title || task.objective || task.id;
        const meta = [
            task.id,
            task.status,
            task.source,
            task.finishedAt || task.startedAt,
        ].filter(Boolean).join(" | ");
        const summary = task.summary || task.reflection || "No summary.";
        return `[${meta}]\n${title}\n${truncateForSummary(summary, 220)}`;
    }).join("\n\n---\n\n");
}

function formatTaskWorkShortcutList(items: TaskWorkShortcutItem[], detailLevel: "summary" | "full" = "summary"): string {
    return items.map((item) => {
        const title = item.title || item.objective || item.taskId;
        const meta = [
            item.taskId,
            item.status,
            item.source,
            item.finishedAt || item.updatedAt,
        ].filter(Boolean).join(" | ");
        const lines = [`[${meta}]`, title];
        if (item.workRecap?.headline) {
            lines.push(`Recap: ${truncateForSummary(item.workRecap.headline, 220)}`);
        } else if (item.summary) {
            lines.push(truncateForSummary(item.summary, 220));
        }
        if (item.resumeContext?.currentStopPoint) {
            lines.push(`Stop: ${truncateForSummary(item.resumeContext.currentStopPoint, 180)}`);
        }
        if (item.resumeContext?.nextStep) {
            lines.push(`Next: ${truncateForSummary(item.resumeContext.nextStep, 180)}`);
        }
        if (detailLevel === "full" && item.recentActivityTitles.length > 0) {
            lines.push(`Recent Activity: ${item.recentActivityTitles.map((activity) => truncateForSummary(activity, 80)).join(" | ")}`);
        }
        if (detailLevel === "full" && item.matchReasons?.length) {
            lines.push(`Matched By: ${item.matchReasons.join(", ")}`);
        }
        return lines.join("\n");
    }).join("\n\n---\n\n");
}

function formatResumeContextShortcut(item: TaskWorkShortcutItem, detailLevel: "summary" | "full" = "summary"): string {
    const title = item.title || item.objective || item.taskId;
    const lines = [
        `Task: ${title}`,
        `ID: ${item.taskId}`,
        `Status: ${item.status}`,
        `Source: ${item.source}`,
        `Conversation: ${item.conversationId}`,
        `Updated: ${item.finishedAt || item.updatedAt}`,
    ];
    if (item.workRecap?.headline) {
        lines.push("", `Recap: ${item.workRecap.headline}`);
    }
    if (item.resumeContext?.currentStopPoint) {
        lines.push("", `Stop: ${item.resumeContext.currentStopPoint}`);
    }
    if (item.resumeContext?.nextStep) {
        lines.push(`Next: ${item.resumeContext.nextStep}`);
    }
    if (detailLevel === "full" && item.resumeContext?.blockers?.length) {
        lines.push("Blockers:");
        for (const blocker of item.resumeContext.blockers) {
            lines.push(`- ${truncateForSummary(blocker, 180)}`);
        }
    }
    if (detailLevel === "full" && item.workRecap?.confirmedFacts?.length) {
        lines.push("Confirmed Facts:");
        for (const fact of item.workRecap.confirmedFacts.slice(0, 5)) {
            lines.push(`- ${truncateForSummary(fact, 180)}`);
        }
    }
    if (detailLevel === "full" && item.recentActivityTitles.length > 0) {
        lines.push("Recent Activity:");
        for (const activity of item.recentActivityTitles) {
            lines.push(`- ${truncateForSummary(activity, 160)}`);
        }
    }
    if (detailLevel === "full" && item.matchReasons?.length) {
        lines.push(`Matched By: ${item.matchReasons.join(", ")}`);
    }
    return lines.join("\n");
}

function formatTaskDetail(task: TaskExperienceDetail): string {
    const lines: string[] = [];
    lines.push(`Task: ${task.title || task.objective || task.id}`);
    lines.push(`ID: ${task.id}`);
    lines.push(`Status: ${task.status}`);
    lines.push(`Source: ${task.source}`);
    lines.push(`Conversation: ${task.conversationId}`);
    if (task.parentConversationId) lines.push(`Parent Conversation: ${task.parentConversationId}`);
    if (task.agentId) lines.push(`Agent: ${task.agentId}`);
    lines.push(`Started: ${task.startedAt}`);
    if (task.finishedAt) lines.push(`Finished: ${task.finishedAt}`);
    if (typeof task.durationMs === "number") lines.push(`Duration: ${task.durationMs}ms`);
    if (typeof task.tokenTotal === "number") {
        lines.push(
            `Tokens: total=${task.tokenTotal}, input=${task.tokenInput ?? 0}, output=${task.tokenOutput ?? 0}`,
        );
    }

    if (task.objective) {
        lines.push("");
        lines.push("Objective:");
        lines.push(task.objective);
    }

    if (task.summary) {
        lines.push("");
        lines.push("Summary:");
        lines.push(task.summary);
    }

    if (task.workRecap) {
        lines.push("");
        lines.push("Work Recap:");
        lines.push(`Headline: ${task.workRecap.headline}`);
        if (task.workRecap.confirmedFacts?.length) {
            lines.push("Confirmed:");
            for (const item of task.workRecap.confirmedFacts) {
                lines.push(`- ${item}`);
            }
        }
        if (task.workRecap.pendingActions?.length) {
            lines.push("Pending:");
            for (const item of task.workRecap.pendingActions) {
                lines.push(`- ${item}`);
            }
        }
        if (task.workRecap.blockers?.length) {
            lines.push("Blockers:");
            for (const item of task.workRecap.blockers) {
                lines.push(`- ${truncateForSummary(item, 180)}`);
            }
        }
    }

    if (task.resumeContext) {
        lines.push("");
        lines.push("Resume Context:");
        if (task.resumeContext.currentStopPoint) {
            lines.push(`Stop: ${task.resumeContext.currentStopPoint}`);
        }
        if (task.resumeContext.nextStep) {
            lines.push(`Next: ${task.resumeContext.nextStep}`);
        }
        if (task.resumeContext.blockers?.length) {
            lines.push("Resume Blockers:");
            for (const item of task.resumeContext.blockers) {
                lines.push(`- ${truncateForSummary(item, 180)}`);
            }
        }
    }

    if (task.reflection) {
        lines.push("");
        lines.push("Reflection:");
        lines.push(task.reflection);
    }

    if (task.artifactPaths?.length) {
        lines.push("");
        lines.push("Artifacts:");
        for (const item of task.artifactPaths) {
            lines.push(`- ${item}`);
        }
    }

    if (task.toolCalls?.length) {
        lines.push("");
        lines.push("Tools:");
        for (const item of task.toolCalls) {
            const meta = [
                item.success ? "success" : "failed",
                typeof item.durationMs === "number" ? `${item.durationMs}ms` : "",
            ].filter(Boolean).join(" | ");
            lines.push(`- ${item.toolName}${meta ? ` (${meta})` : ""}`);
            if (item.note) {
                lines.push(`  note: ${truncateForSummary(item.note, 180)}`);
            }
            if (item.artifactPaths?.length) {
                lines.push(`  artifacts: ${item.artifactPaths.join(", ")}`);
            }
        }
    }

    if (Array.isArray(task.activities) && task.activities.length > 0) {
        lines.push("");
        lines.push("Activity / Worklog:");
        for (const item of task.activities) {
            const meta = [
                item.state,
                item.kind,
                item.happenedAt,
            ].filter(Boolean).join(" | ");
            lines.push(`- ${item.title}${meta ? ` (${meta})` : ""}`);
            if (item.summary) {
                lines.push(`  summary: ${truncateForSummary(item.summary, 220)}`);
            }
            if (item.files?.length) {
                lines.push(`  files: ${item.files.join(", ")}`);
            }
            if (item.artifactPaths?.length) {
                lines.push(`  artifacts: ${item.artifactPaths.join(", ")}`);
            }
            if (item.memoryChunkIds?.length) {
                lines.push(`  memories: ${item.memoryChunkIds.join(", ")}`);
            }
            if (item.error) {
                lines.push(`  error: ${truncateForSummary(item.error, 180)}`);
            }
        }
    }

    if (task.memoryLinks?.length) {
        lines.push("");
        lines.push("Memory Links:");
        for (const item of task.memoryLinks) {
            const meta = [item.relation, item.memoryType, item.sourcePath].filter(Boolean).join(" | ");
            lines.push(`- ${meta || item.relation}: ${item.chunkId}`);
            if (item.snippet) {
                lines.push(`  snippet: ${item.snippet}`);
            }
            if (item.sourcePath) {
                lines.push(`  source_path: ${item.sourcePath}`);
            }
        }
    }

    if (Array.isArray(task.usedMethods) && task.usedMethods.length > 0) {
        lines.push("");
        lines.push("Used Methods:");
        for (const item of task.usedMethods) {
            appendUsageSummaryLines(lines, item);
        }
    }

    if (Array.isArray(task.usedSkills) && task.usedSkills.length > 0) {
        lines.push("");
        lines.push("Used Skills:");
        for (const item of task.usedSkills) {
            appendUsageSummaryLines(lines, item);
        }
    }

    return lines.join("\n");
}

function formatExperiencePromotionResult(
    result: {
        candidate: ExperienceCandidate;
        reusedExisting: boolean;
        dedupDecision?: "new_candidate" | "duplicate_existing" | "similar_existing";
        exactMatch?: {
            source: "candidate" | "method_asset" | "skill_asset";
            key: string;
            title?: string;
            candidateId?: string;
            candidateStatus?: string;
            publishedPath?: string;
        };
        similarMatches?: Array<{
            source: "candidate" | "method_asset" | "skill_asset";
            key: string;
            title?: string;
            score?: number;
            candidateId?: string;
            candidateStatus?: string;
            publishedPath?: string;
        }>;
    },
    type: "method" | "skill",
): string {
    const lines = [
        result.reusedExisting
            ? `Reused existing ${type} candidate.`
            : `Created ${type} candidate draft.`,
        `Candidate ID: ${result.candidate.id}`,
        `Task ID: ${result.candidate.taskId}`,
        `Status: ${result.candidate.status}`,
        `Slug: ${result.candidate.slug}`,
    ];
    if (typeof result.candidate.qualityScore === "number") {
        lines.push(`Quality Score: ${result.candidate.qualityScore}`);
    }
    if (result.candidate.summary) {
        lines.push(`Summary: ${result.candidate.summary}`);
    }
    if (result.dedupDecision) {
        lines.push(`Dedup Decision: ${result.dedupDecision}`);
    }
    if (result.exactMatch) {
        lines.push(`Exact Match: ${result.exactMatch.source} | ${result.exactMatch.title || result.exactMatch.key}`);
        if (result.exactMatch.candidateId) {
            lines.push(`Exact Match Candidate: ${result.exactMatch.candidateId}`);
        }
        if (result.exactMatch.candidateStatus) {
            lines.push(`Exact Match Status: ${result.exactMatch.candidateStatus}`);
        }
        if (result.exactMatch.publishedPath) {
            lines.push(`Exact Match Path: ${result.exactMatch.publishedPath}`);
        }
    }
    if (result.similarMatches?.length) {
        lines.push("Similar Existing:");
        for (const match of result.similarMatches.slice(0, 3)) {
            const score = typeof match.score === "number" ? ` | score=${match.score.toFixed(2)}` : "";
            const candidateMeta = match.candidateId ? ` | candidate=${match.candidateId}` : "";
            lines.push(`- ${match.source} | ${match.title || match.key}${score}${candidateMeta}`);
        }
    }
    lines.push("", truncateForSummary(result.candidate.content, 400));
    return lines.join("\n");
}

function formatExperienceCandidateList(items: ExperienceCandidate[]): string {
    return items.map((item) => {
        const meta = [
            item.id,
            item.type,
            item.status,
            item.taskId,
            item.createdAt,
        ].filter(Boolean).join(" | ");
        const quality = typeof item.qualityScore === "number" ? `Quality: ${item.qualityScore}` : "Quality: n/a";
        const summary = item.summary || truncateForSummary(item.content, 180);
        return `[${meta}]\n${item.title}\n${quality}\n${summary}`;
    }).join("\n\n---\n\n");
}

function formatExperienceCandidateDetail(candidate: ExperienceCandidate): string {
    const lines = [
        `Candidate: ${candidate.title}`,
        `Candidate ID: ${candidate.id}`,
        `Task ID: ${candidate.taskId}`,
        `Type: ${candidate.type}`,
        `Status: ${candidate.status}`,
        `Slug: ${candidate.slug}`,
        `Created: ${candidate.createdAt}`,
    ];
    if (typeof candidate.qualityScore === "number") {
        lines.push(`Quality Score: ${candidate.qualityScore}`);
    }
    if (candidate.reviewedAt) lines.push(`Reviewed: ${candidate.reviewedAt}`);
    if (candidate.acceptedAt) lines.push(`Accepted: ${candidate.acceptedAt}`);
    if (candidate.rejectedAt) lines.push(`Rejected: ${candidate.rejectedAt}`);
    if (candidate.publishedPath) lines.push(`Published Path: ${candidate.publishedPath}`);
    if (candidate.summary) {
        lines.push("", "Summary:", candidate.summary);
    }
    lines.push(
        "",
        "Source Task Snapshot:",
        `- Task ID: ${candidate.sourceTaskSnapshot.taskId}`,
        `- Conversation: ${candidate.sourceTaskSnapshot.conversationId}`,
        `- Status: ${candidate.sourceTaskSnapshot.status}`,
        `- Source: ${candidate.sourceTaskSnapshot.source}`,
    );
    if (candidate.sourceTaskSnapshot.title) {
        lines.push(`- Title: ${candidate.sourceTaskSnapshot.title}`);
    }
    if (candidate.sourceTaskSnapshot.objective) {
        lines.push(`- Objective: ${candidate.sourceTaskSnapshot.objective}`);
    }
    if (candidate.sourceTaskSnapshot.memoryLinks?.length) {
        lines.push(`- Memory Links: ${candidate.sourceTaskSnapshot.memoryLinks.length}`);
    }
    if (candidate.sourceTaskSnapshot.artifactPaths?.length) {
        lines.push(`- Artifacts: ${candidate.sourceTaskSnapshot.artifactPaths.join(", ")}`);
    }
    lines.push("", truncateForSummary(candidate.content, 600));
    return lines.join("\n");
}

function formatExperienceCandidateDecision(candidate: ExperienceCandidate, action: "accepted" | "rejected"): string {
    const lines = [
        `Candidate ${action}.`,
        `Candidate ID: ${candidate.id}`,
        `Task ID: ${candidate.taskId}`,
        `Type: ${candidate.type}`,
        `Status: ${candidate.status}`,
    ];
    if (candidate.publishedPath) {
        lines.push(`Published Path: ${candidate.publishedPath}`);
    }
    return lines.join("\n");
}

function formatExperienceCandidateInvalidState(candidate: ExperienceCandidate, action: "accept" | "reject"): string {
    const verb = action === "accept" ? "accepted" : "rejected";
    return `Experience candidate can only be ${verb} from draft status. Current status: ${candidate.status}`;
}

function formatExperienceUsageList(items: ExperienceUsage[], manager: MemoryManager): string {
    return items.map((item) => formatExperienceUsageDetail(item, manager)).join("\n\n---\n\n");
}

function formatExperienceUsageDetail(usage: ExperienceUsage, manager: MemoryManager): string {
    const lines = [
        `Usage ID: ${usage.id}`,
        `Task ID: ${usage.taskId}`,
        `Type: ${usage.assetType}`,
        `Asset: ${usage.assetKey}`,
        `Used Via: ${usage.usedVia}`,
        `Created: ${usage.createdAt}`,
    ];

    if (usage.sourceCandidateId) {
        lines.push(`Source Candidate: ${usage.sourceCandidateId}`);
        const candidate = manager.getExperienceCandidate(usage.sourceCandidateId);
        if (candidate) {
            lines.push(`Candidate Title: ${candidate.title}`);
            lines.push(`Candidate Status: ${candidate.status}`);
            lines.push(`Candidate Task: ${candidate.taskId}`);
            if (candidate.publishedPath) {
                lines.push(`Published Path: ${candidate.publishedPath}`);
            }
        }
    }

    return lines.join("\n");
}

function formatExperienceUsageRecordResult(
    result: { reusedExisting: boolean; usage: { id: string; assetType: string; assetKey: string; usedVia: string; sourceCandidateId?: string } },
    taskId: string,
): string {
    const lines = [
        result.reusedExisting ? "Reused existing experience usage record." : "Recorded experience usage.",
        `Usage ID: ${result.usage.id}`,
        `Task ID: ${taskId}`,
        `Type: ${result.usage.assetType}`,
        `Asset: ${result.usage.assetKey}`,
        `Used Via: ${result.usage.usedVia}`,
    ];
    if (result.usage.sourceCandidateId) {
        lines.push(`Source Candidate: ${result.usage.sourceCandidateId}`);
    }
    return lines.join("\n");
}

function formatExperienceUsageRevokeResult(
    usage: { id: string; taskId: string; assetType: string; assetKey: string; usedVia: string; sourceCandidateId?: string },
): string {
    const lines = [
        "Revoked experience usage.",
        `Usage ID: ${usage.id}`,
        `Task ID: ${usage.taskId}`,
        `Type: ${usage.assetType}`,
        `Asset: ${usage.assetKey}`,
        `Used Via: ${usage.usedVia}`,
    ];
    if (usage.sourceCandidateId) {
        lines.push(`Source Candidate: ${usage.sourceCandidateId}`);
    }
    return lines.join("\n");
}

function appendUsageSummaryLines(lines: string[], item: ExperienceUsageSummary): void {
    const meta = [
        item.usageId ? `usage=${item.usageId}` : "",
        item.usedVia ? `via=${item.usedVia}` : "",
        typeof item.usageCount === "number" ? `count=${item.usageCount}` : "",
        item.lastUsedAt ? `last=${item.lastUsedAt}` : "",
    ].filter(Boolean).join(" | ");
    lines.push(`- ${item.assetKey}${meta ? ` (${meta})` : ""}`);
    lines.push(`  task_id: ${item.taskId}`);
    lines.push(`  created_at: ${item.createdAt}`);
    if (item.sourceCandidateId) {
        lines.push(`  source_candidate: ${item.sourceCandidateId}`);
    }
    if (item.sourceCandidateTitle) {
        lines.push(`  candidate_title: ${item.sourceCandidateTitle}`);
    }
    if (item.sourceCandidateStatus) {
        lines.push(`  candidate_status: ${item.sourceCandidateStatus}`);
    }
    if (item.sourceCandidateTaskId) {
        lines.push(`  candidate_task: ${item.sourceCandidateTaskId}`);
    }
    if (item.sourceCandidatePublishedPath) {
        lines.push(`  published_path: ${item.sourceCandidatePublishedPath}`);
    }
    if (item.lastUsedTaskId) {
        lines.push(`  last_used_task: ${item.lastUsedTaskId}`);
    }
}
