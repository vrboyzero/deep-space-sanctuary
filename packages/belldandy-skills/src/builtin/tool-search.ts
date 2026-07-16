import crypto from "node:crypto";
import type { Tool, ToolCallResult, ToolDiscoveryEntry } from "../types.js";
import { withToolContract } from "../tool-contract.js";

export const TOOL_SEARCH_NAME = "tool_search";

type ToolSearchOptions = {
  getDiscoveryEntries: (conversationId?: string, agentId?: string, expandedFamilyIds?: string[]) => ToolDiscoveryEntry[];
  getLoadedDeferredToolList: (conversationId: string) => string[];
  loadDeferredTools: (conversationId: string, toolNames: string[]) => Promise<string[]>;
  unloadDeferredTools: (conversationId: string, toolNames: string[]) => Promise<string[]>;
  clearLoadedDeferredTools: (conversationId: string) => Promise<void>;
  shrinkLoadedDeferredTools: (conversationId: string, toolNames: string[]) => Promise<string[]>;
};

function scoreCatalogEntry(entry: ToolDiscoveryEntry, query: string): number {
  const lowerQuery = query.trim().toLowerCase();
  if (!lowerQuery) return 0;
  const haystacks = entry.kind === "family"
    ? [
      entry.id.toLowerCase(),
      entry.title.toLowerCase(),
      entry.summary.toLowerCase(),
      ...entry.keywords.map((item) => item.toLowerCase()),
    ]
    : [
      entry.name.toLowerCase(),
      entry.shortDescription.toLowerCase(),
      entry.description.toLowerCase(),
      ...entry.keywords.map((item) => item.toLowerCase()),
      ...entry.tags.map((item) => item.toLowerCase()),
    ];

  let score = 0;
  for (const haystack of haystacks) {
    if (haystack === lowerQuery) score += 12;
    else if (haystack.includes(lowerQuery)) score += 6;
  }

  const queryTerms = lowerQuery.split(/\s+/).filter(Boolean);
  for (const term of queryTerms) {
    if (entry.kind === "family") {
      if (entry.id.toLowerCase().includes(term)) score += 4;
      if (entry.title.toLowerCase().includes(term)) score += 4;
      if (entry.summary.toLowerCase().includes(term)) score += 2;
      if (entry.keywords.some((item) => item.toLowerCase().includes(term))) score += 3;
    } else {
      if (entry.name.toLowerCase().includes(term)) score += 4;
      if (entry.shortDescription.toLowerCase().includes(term)) score += 2;
      if (entry.keywords.some((item) => item.toLowerCase().includes(term))) score += 3;
      if (entry.tags.some((item) => item.toLowerCase().includes(term))) score += 2;
    }
  }

  return score;
}

function formatEntries(entries: ToolDiscoveryEntry[]): string {
  if (entries.length === 0) {
    return "No matching tools found.";
  }

  return entries.map((entry) => {
    if (entry.kind === "family") {
      return `- family:${entry.id} [${entry.loadingMode}, ${entry.toolCount} tools, ${entry.loadedToolCount} loaded]: ${entry.summary}`;
    }
    const suffix = entry.loaded ? "loaded" : entry.loadingMode;
    return `- ${entry.name} [${suffix}]: ${entry.shortDescription}`;
  }).join("\n");
}

function collectDiscoveryNextStepHints(input: {
  matches: ToolDiscoveryEntry[];
  expandedFamilies: string[];
  loaded: string[];
  select: string[];
  query: string;
}): string[] {
  const hints: string[] = [];
  const familyMatches = input.matches.filter((entry): entry is Extract<ToolDiscoveryEntry, { kind: "family" }> => entry.kind === "family");
  const toolMatches = input.matches.filter((entry): entry is Extract<ToolDiscoveryEntry, { kind: "tool" }> => entry.kind === "tool");

  if (input.select.length > 0 && input.loaded.length > 0) {
    hints.push("Exact deferred schemas are loaded for this conversation. Reuse them directly while they remain visible.");
  }

  if (familyMatches.length > 0) {
    const unexpandedFamilies = familyMatches
      .filter((entry) => entry.gateMode === "hidden-until-expanded" && !input.expandedFamilies.includes(entry.id))
      .slice(0, 3)
      .map((entry) => entry.id);
    if (unexpandedFamilies.length > 0) {
      hints.push(`If you need an exact tool, expand the matching family first: tool_search {"expandFamilies":["${unexpandedFamilies[0]}"]}.`);
    }
  }

  const deferredToolMatches = toolMatches.filter((entry) => entry.loadingMode === "deferred" && !entry.loaded);
  if (deferredToolMatches.length > 0) {
    if (familyMatches.length === 0) {
      hints.push(`The exact deferred tool matches are already identified in Matches. Select one now in the same turn before any other tool call: tool_search {"select":["${deferredToolMatches[0].name}"]}.`);
    }
    hints.push(`After choosing one deferred tool, load only that exact schema: tool_search {"select":["${deferredToolMatches[0].name}"]}.`);
  }

  const loadedToolMatches = toolMatches.filter((entry) => entry.loaded);
  if (loadedToolMatches.length > 0) {
    hints.push(`Already loaded and ready to call now: ${loadedToolMatches.slice(0, 3).map((entry) => entry.name).join(", ")}.`);
  }

  if (input.query && hints.length === 0 && toolMatches.length === 0 && familyMatches.length === 0) {
    hints.push("Try a broader query, or inspect heavy families first with `tool_search` and then expand the most relevant family.");
  }

  if (input.query && hints.length === 0) {
    hints.push("Pick one exact tool from Matches and avoid loading multiple deferred schemas unless the task truly needs them.");
  }

  return hints;
}

function getEntrySortKey(entry: ToolDiscoveryEntry): string {
  return entry.kind === "family" ? entry.id : entry.name;
}

export function createToolSearchTool(options: ToolSearchOptions): Tool {
  return withToolContract({
    definition: {
      name: TOOL_SEARCH_NAME,
      description: "搜索当前可用工具与重型工具簇；可先展开 family，再用 select 只加载需要的精确 deferred schema。",
      shortDescription: "搜索工具并展开重型工具簇",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "按工具名、描述或关键词搜索工具",
          },
          expandFamilies: {
            type: "array",
            description: "要展开的重型工具簇；展开后仅显示成员工具，不会自动加载 schema",
            items: { type: "string" },
          },
          select: {
            type: "array",
            description: "要立即加载的工具名列表；加载后在当前会话中可直接调用，直到被卸载、收缩或不再暴露",
            items: { type: "string" },
          },
          unload: {
            type: "array",
            description: "要从当前会话 loaded deferred tools 集合中移除的工具名列表",
            items: { type: "string" },
          },
          shrinkTo: {
            type: "array",
            description: "把当前会话 loaded deferred tools 收缩到这组工具名；不会加载新工具",
            items: { type: "string" },
          },
          resetLoaded: {
            type: "boolean",
            description: "为 true 时清空当前会话全部 loaded deferred tools",
          },
          maxResults: {
            type: "number",
            description: "返回结果上限，默认 8",
          },
        },
        required: [],
      },
      loadingMode: "core",
      keywords: ["tool", "search", "load", "schema", "deferred"],
      tags: ["runtime", "tooling"],
    },

    async execute(args, context): Promise<ToolCallResult> {
      const start = Date.now();
      const id = crypto.randomUUID();
      const conversationId = context.conversationId;
      const agentId = context.agentId;
      const query = typeof args.query === "string" ? args.query.trim() : "";
      const rawExpandedFamilies = Array.isArray(args.expandFamilies) ? args.expandFamilies : [];
      const expandedFamilies = rawExpandedFamilies
        .map((item) => typeof item === "string" ? item.trim() : "")
        .filter(Boolean);
      const allEntries = options.getDiscoveryEntries(conversationId, agentId, expandedFamilies);
      const rawSelect = Array.isArray(args.select) ? args.select : [];
      const select = rawSelect
        .map((item) => typeof item === "string" ? item.trim() : "")
        .filter(Boolean);
      const rawUnload = Array.isArray(args.unload) ? args.unload : [];
      const unload = rawUnload
        .map((item) => typeof item === "string" ? item.trim() : "")
        .filter(Boolean);
      const rawShrinkTo = Array.isArray(args.shrinkTo) ? args.shrinkTo : [];
      const shrinkTo = rawShrinkTo
        .map((item) => typeof item === "string" ? item.trim() : "")
        .filter(Boolean);
      const resetLoaded = args.resetLoaded === true;
      const maxResults = typeof args.maxResults === "number" && Number.isFinite(args.maxResults)
        ? Math.max(1, Math.min(20, Math.floor(args.maxResults)))
        : 8;

      if (resetLoaded) {
        await options.clearLoadedDeferredTools(conversationId);
      }

      const shrunk = shrinkTo.length > 0
        ? await options.shrinkLoadedDeferredTools(conversationId, shrinkTo)
        : [];
      const unloaded = unload.length > 0
        ? await options.unloadDeferredTools(conversationId, unload)
        : [];
      const loaded = select.length > 0
        ? await options.loadDeferredTools(conversationId, select)
        : [];
      const currentLoaded = options.getLoadedDeferredToolList(conversationId);

      const matches = query
        ? allEntries
          .map((entry) => ({ entry, score: scoreCatalogEntry(entry, query) }))
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score || getEntrySortKey(a.entry).localeCompare(getEntrySortKey(b.entry)))
          .slice(0, maxResults)
          .map((item) => item.entry)
        : allEntries
          .filter((entry) => entry.loadingMode === "deferred")
          .slice(0, maxResults);

      const sections: string[] = [];
      const nextStepHints = collectDiscoveryNextStepHints({
        matches,
        expandedFamilies,
        loaded: currentLoaded,
        select,
        query,
      });
      if (expandedFamilies.length > 0) {
        sections.push(`Expanded families for this search:\n${expandedFamilies.map((name) => `- ${name}`).join("\n")}`);
      }
      if (resetLoaded) {
        sections.push("Reset loaded deferred tools for this conversation.");
      }
      if (shrinkTo.length > 0) {
        sections.push(`Shrunk loaded tools to:\n${shrunk.length > 0 ? shrunk.map((name) => `- ${name}`).join("\n") : "- (none)"}`);
      }
      if (unloaded.length > 0) {
        sections.push(`Unloaded deferred tools:\n${unloaded.map((name) => `- ${name}`).join("\n")}`);
      }
      if (loaded.length > 0) {
        sections.push(`Loaded deferred tools for this conversation:\n${loaded.map((name) => `- ${name}`).join("\n")}`);
      }
      sections.push(`Currently loaded deferred tools in this conversation:\n${currentLoaded.length > 0 ? currentLoaded.map((name) => `- ${name}`).join("\n") : "- (none)"}`);
      if (nextStepHints.length > 0) {
        sections.push(`Recommended next step:\n${nextStepHints.map((item) => `- ${item}`).join("\n")}`);
      }
      sections.push(`Matches:\n${formatEntries(matches)}`);

      return {
        id,
        name: TOOL_SEARCH_NAME,
        success: true,
        output: sections.join("\n\n").trim(),
        durationMs: Date.now() - start,
      };
    },
  }, {
    family: "other",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    riskLevel: "low",
    channels: ["gateway", "web"],
    safeScopes: ["local-safe", "web-safe"],
    activityDescription: "Search the current Tool catalog and load deferred schemas",
    resultSchema: { kind: "text", description: "Tool discovery and deferred-loading summary." },
    outputPersistencePolicy: "conversation",
  });
}
