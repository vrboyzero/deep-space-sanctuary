import crypto from "node:crypto";
import type { Tool, ToolCallResult } from "../../types.js";
import { BraveSearchProvider } from "./brave.js";
import { SerpApiProvider } from "./serpapi.js";
import type { SearchProvider } from "./types.js";
import { withToolContract } from "../../tool-contract.js";
import { isAbortError, readAbortReason, throwIfAborted } from "../../abort-utils.js";
import { buildFailureToolCallResult } from "../../failure-kind.js";

// Factory to get configured provider
function getProvider(): SearchProvider | null {
    // Priority: Brave > SerpAPI
    if (process.env.BRAVE_API_KEY) {
        return new BraveSearchProvider();
    }
    if (process.env.SERPAPI_API_KEY) {
        return new SerpApiProvider();
    }
    return null;
}

export const webSearchTool: Tool = withToolContract({
    definition: {
        name: "web_search",
        description: "联网搜索工具。当需要查询实时信息、新闻、文档或任何当前知识库之外的问题时使用。",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "搜索关键词",
                },
                count: {
                    type: "number",
                    description: "结果数量（默认 5，最大 20）",
                },
                country: {
                    type: "string",
                    description: "国家代码（如 'us', 'cn'），用于获取特定地区的结果",
                },
            },
            required: ["query"],
        },
    },

    async execute(args, context): Promise<ToolCallResult> {
        const start = Date.now();
        const id = crypto.randomUUID();
        const name = "web_search";

        const makeError = (error: string, failureKind?: ToolCallResult["failureKind"]): ToolCallResult => (
            buildFailureToolCallResult({
                id,
                name,
                start,
                error,
                ...(failureKind ? { failureKind } : {}),
            })
        );

        const provider = getProvider();
        if (!provider) {
            return makeError(
                "Web search is not configured. Please set BRAVE_API_KEY or SERPAPI_API_KEY environment variable.",
                "environment_error",
            );
        }

        // 参数校验
        const query = args.query;
        if (typeof query !== "string" || !query.trim()) {
            return makeError("参数错误：query 必须是非空字符串", "input_error");
        }

        try {
            throwIfAborted(context.abortSignal);
            context.logger?.info(`[${name}] Searching via ${provider.name}: ${query}`);

            const results = await provider.search({
                query,
                count: typeof args.count === "number" ? args.count : 5,
                country: typeof args.country === "string" ? args.country : undefined,
                abortSignal: context.abortSignal,
            });

            // 格式化输出为 Markdown
            const output = results
                .map((r, i) => {
                    const source = r.source ? ` (${r.source})` : "";
                    const date = r.published ? ` - ${r.published}` : "";
                    return `### ${i + 1}. [${r.title}](${r.url})${source}${date}\n${r.snippet}`;
                })
                .join("\n\n");

            return {
                id,
                name,
                success: true,
                output: output || "No results found.",
                durationMs: Date.now() - start,
            };
        } catch (err) {
            if (isAbortError(err) || context.abortSignal?.aborted) {
                return makeError(readAbortReason(context.abortSignal), "environment_error");
            }
            const msg = err instanceof Error ? err.message : String(err);
            context.logger?.error(`[${name}] Failed: ${msg}`);
            return makeError(msg);
        }
    },
}, {
    family: "network-read",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    riskLevel: "low",
    channels: ["gateway", "web"],
    safeScopes: ["remote-safe"],
    activityDescription: "Search the web using a configured search provider",
    resultSchema: {
        kind: "text",
        description: "Formatted web search result text.",
    },
    outputPersistencePolicy: "conversation",
    executionAdmission: {
        deadline: "policy",
        output: "utf8-text-policy",
    },
});
