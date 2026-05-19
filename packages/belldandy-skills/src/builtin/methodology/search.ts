import type { Tool, JsonObject, ToolContext } from "../../types.js";
import { promises as fs } from "fs";
import * as path from "path";
import { getMethodsDir } from "./list.js";
import { parseMethodContent, type ParsedMethod } from "./meta.js";

type SearchMatch = {
    file: string;
    title?: string;
    score: number;
    preferred: boolean;
    matchedIn: string[];
    snippet: string;
    status?: string;
    tags: string[];
    readWhen: string[];
};

const PREFERRED_METHOD_SCORE_BONUS = 90;

function countOccurrences(text: string, term: string): number {
    if (!text || !term) return 0;
    let count = 0;
    let fromIndex = 0;
    while (fromIndex < text.length) {
        const foundIndex = text.indexOf(term, fromIndex);
        if (foundIndex === -1) break;
        count += 1;
        fromIndex = foundIndex + term.length;
    }
    return count;
}

function buildSearchTerms(keyword: string): string[] {
    const normalized = keyword.trim().toLowerCase();
    const terms = new Set<string>();
    if (normalized) {
        terms.add(normalized);
    }

    for (const part of normalized.split(/\s+/)) {
        if (part) {
            terms.add(part);
        }
    }

    return Array.from(terms);
}

function extractSnippet(source: string, terms: string[]): string {
    const compact = source.replace(/\s+/g, " ").trim();
    if (!compact) {
        return "无摘要";
    }

    let matchIndex = -1;
    let matchedTerm = "";
    const normalized = compact.toLowerCase();

    for (const term of terms) {
        const termIndex = normalized.indexOf(term);
        if (termIndex !== -1 && (matchIndex === -1 || termIndex < matchIndex)) {
            matchIndex = termIndex;
            matchedTerm = term;
        }
    }

    if (matchIndex === -1) {
        return compact.slice(0, 80);
    }

    const start = Math.max(0, matchIndex - 24);
    const end = Math.min(compact.length, matchIndex + matchedTerm.length + 40);
    const prefix = start > 0 ? "..." : "";
    const suffix = end < compact.length ? "..." : "";
    return `${prefix}${compact.slice(start, end)}${suffix}`;
}

function scoreMethod(file: string, parsed: ParsedMethod, terms: string[]): SearchMatch | null {
    const lowerFile = file.toLowerCase();
    const title = parsed.title ?? "";
    const lowerTitle = title.toLowerCase();
    const summary = parsed.metadata.summary ?? "";
    const lowerSummary = summary.toLowerCase();
    const sectionsText = parsed.sections.join(" ");
    const lowerSections = sectionsText.toLowerCase();
    const lowerBody = parsed.body.toLowerCase();
    const lowerTags = parsed.metadata.tags.join(" ").toLowerCase();
    const lowerReadWhen = parsed.metadata.readWhen.join(" ").toLowerCase();

    let score = 0;
    const matchedIn = new Set<string>();

    for (const term of terms) {
        const fileHits = countOccurrences(lowerFile, term);
        const titleHits = countOccurrences(lowerTitle, term);
        const summaryHits = countOccurrences(lowerSummary, term);
        const sectionHits = countOccurrences(lowerSections, term);
        const tagHits = countOccurrences(lowerTags, term);
        const readWhenHits = countOccurrences(lowerReadWhen, term);
        const bodyHits = countOccurrences(lowerBody, term);

        if (fileHits > 0) {
            score += 100 + fileHits * 10;
            matchedIn.add("filename");
        }
        if (titleHits > 0) {
            score += 80 + titleHits * 8;
            matchedIn.add("title");
        }
        if (summaryHits > 0) {
            score += 60 + summaryHits * 6;
            matchedIn.add("summary");
        }
        if (sectionHits > 0) {
            score += 45 + sectionHits * 5;
            matchedIn.add("section");
        }
        if (tagHits > 0) {
            score += 55 + tagHits * 6;
            matchedIn.add("tags");
        }
        if (readWhenHits > 0) {
            score += 35 + readWhenHits * 4;
            matchedIn.add("read_when");
        }
        if (bodyHits > 0) {
            score += Math.min(30, bodyHits * 4);
            matchedIn.add("content");
        }
    }

    if (score === 0) {
        return null;
    }

    const snippetSource = parsed.metadata.summary || title || parsed.body;

    return {
        file,
        title: parsed.title,
        score,
        preferred: false,
        matchedIn: Array.from(matchedIn),
        snippet: extractSnippet(snippetSource, terms),
        status: parsed.metadata.status,
        tags: parsed.metadata.tags,
        readWhen: parsed.metadata.readWhen,
    };
}

function normalizePreferredMethodSet(methods: readonly string[] | undefined): Set<string> {
    return new Set(
        (methods ?? [])
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean),
    );
}

function applyPreferredMethodBoost(match: SearchMatch, preferredMethods: ReadonlySet<string>): SearchMatch {
    const preferred = preferredMethods.has(match.file.trim().toLowerCase());
    if (!preferred) {
        return match;
    }
    const matchedIn = match.matchedIn.includes("preferred")
        ? match.matchedIn
        : [...match.matchedIn, "preferred"];
    return {
        ...match,
        preferred: true,
        score: match.score + PREFERRED_METHOD_SCORE_BONUS,
        matchedIn,
    };
}

function formatSearchResult(match: SearchMatch, index: number): string {
    const titlePart = match.title ? ` | 标题：${match.title}` : "";
    const statusPart = match.status ? ` | 状态：${match.status}` : "";
    const tagsPart = match.tags.length > 0 ? ` | 标签：${match.tags.join(", ")}` : "";
    const preferredPart = match.preferred ? " | 推荐：preferred" : "";
    return [
        `${index + 1}. [${match.file}]${titlePart}${statusPart}${tagsPart}${preferredPart}`,
        `   命中：${match.matchedIn.join(", ")} | 评分：${match.score}`,
        `   使用时机：${match.readWhen.length > 0 ? match.readWhen.join(" / ") : "未标注"}`,
        `   摘要：${match.snippet}`,
    ].join("\n");
}

export const methodSearchTool: Tool = {
    definition: {
        name: "method_search",
        description: "通过关键词搜索方法论文档。当不确定具体文件名时使用。",
        parameters: {
            type: "object",
            properties: {
                keyword: {
                    type: "string",
                    description: "搜索关键词"
                }
            },
            required: ["keyword"]
        }
    },
    execute: async (args: JsonObject, context: ToolContext) => {
        const keyword = (args.keyword as string)?.toLowerCase();
        if (!keyword) return { id: "error", name: "method_search", success: false, output: "Empty keyword", durationMs: 0 };

        const methodsDir = getMethodsDir(context);
        try {
            await fs.mkdir(methodsDir, { recursive: true });
            const files = await fs.readdir(methodsDir);
            const mdFiles = files.filter(f => f.endsWith('.md'));

            const terms = buildSearchTerms(keyword);
            const preferredMethods = normalizePreferredMethodSet(context.agentCatalogPreferences?.methods);
            const results: SearchMatch[] = [];

            for (const file of mdFiles) {
                const content = await fs.readFile(path.join(methodsDir, file), "utf-8");
                const parsed = parseMethodContent(content);
                const scored = scoreMethod(file, parsed, terms);
                if (scored) {
                    results.push(applyPreferredMethodBoost(scored, preferredMethods));
                }
            }

            results.sort((left, right) => {
                if (right.score !== left.score) {
                    return right.score - left.score;
                }
                if (left.preferred !== right.preferred) {
                    return left.preferred ? -1 : 1;
                }
                return left.file.localeCompare(right.file, "zh-CN");
            });

            if (results.length === 0) {
                return {
                    id: "method_search",
                    name: "method_search",
                    success: true,
                    output: `未找到包含 "${keyword}" 的方法文档。`,
                    durationMs: 0
                };
            }

            return {
                id: "method_search",
                name: "method_search",
                success: true,
                output: `找到 ${results.length} 个相关方法:\n${results.map((result, index) => formatSearchResult(result, index)).join('\n')}`,
                durationMs: 0
            };

        } catch (error) {
            return {
                id: "error",
                name: "method_search",
                success: false,
                output: `搜索失败: ${(error as Error).message}`,
                durationMs: 0
            };
        }
    }
};

