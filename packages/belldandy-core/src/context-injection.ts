import type { AgentPromptDelta, BeforeAgentStartEvent, BeforeAgentStartResult, HookAgentContext } from "@belldandy/agent";
import { createTaskWorkSurface } from "@belldandy/memory";
import type { MemoryCategory, MemorySearchDiagnostics, TaskWorkShortcutItem } from "@belldandy/memory";

import { createContextInjectionDeduper } from "./context-injection-dedupe.js";

type ContextInjectionMemoryLike = {
  id?: string;
  sourcePath: string;
  summary?: string;
  snippet?: string;
  importance?: string;
  category?: string;
  memoryType?: string;
  updatedAt?: string;
};

type RecentTaskSummaryLike = {
  taskId?: string;
  conversationId?: string;
  title?: string;
  objective?: string;
  summary?: string;
  status?: string;
  toolNames?: string[];
  artifactPaths?: string[];
  startedAt?: string;
  finishedAt?: string;
  updatedAt?: string;
  workRecap?: {
    headline?: string;
    confirmedFacts?: string[];
    pendingActions?: string[];
    blockers?: string[];
  };
  resumeContext?: {
    currentStopPoint?: string;
    nextStep?: string;
    blockers?: string[];
    updatedAt?: string;
  };
  recentActivityTitles?: string[];
  matchReasons?: string[];
};

type AutoRecallMemoryLike = {
  id?: string;
  sourcePath: string;
  snippet: string;
  score: number;
  summary?: string;
  updatedAt?: string;
};

type AutoRecallSearchExecution = {
  items: AutoRecallMemoryLike[];
  diagnostics?: MemorySearchDiagnostics;
  timedOut?: boolean;
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatLocalTimeLabel(value?: string | number | Date): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutes);
  const hours = Math.floor(absOffset / 60);
  const minutes = absOffset % 60;
  const offsetText = minutes > 0
    ? `GMT${sign}${hours}:${pad2(minutes)}`
    : `GMT${sign}${hours}`;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())} ${offsetText}`;
}

function truncateTaskContextPart(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
}

function buildTaggedLine(input: {
  time?: string;
  latest?: boolean;
  source?: string;
  body: string;
}): string | null {
  const body = input.body.trim();
  if (!body) return null;
  const tags = [input.time, input.latest ? "latest" : undefined, input.source].filter((item): item is string => Boolean(item));
  return `- [${tags.join(" | ")}] ${body}`;
}

function extractCurrentMessageBlock(meta: unknown, userInput?: string): string | null {
  if (!meta || typeof meta !== "object") return null;
  const currentMessageTime = (meta as Record<string, unknown>).currentMessageTime;
  if (!currentMessageTime || typeof currentMessageTime !== "object") return null;
  const payload = currentMessageTime as Record<string, unknown>;
  const timestampMs = typeof payload.timestampMs === "number" && Number.isFinite(payload.timestampMs)
    ? payload.timestampMs
    : undefined;
  const displayTimeText = typeof payload.displayTimeText === "string" && payload.displayTimeText.trim()
    ? payload.displayTimeText.trim()
    : formatLocalTimeLabel(timestampMs);
  const role = typeof payload.role === "string" && payload.role.trim() ? payload.role.trim() : "user";
  const body = String(userInput ?? "").trim();
  if (!body) return null;
  const tagged = buildTaggedLine({
    time: displayTimeText,
    latest: payload.isLatest === true,
    source: role,
    body,
  });
  if (!tagged) return null;
  return `<current-turn hint="以下是当前这轮用户输入的时间锚点。若你需要判断时间先后、最近记忆与当前输入的关系，优先参考这一条。">\n${tagged}\n</current-turn>`;
}

function createContextPreludeDelta(input: {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
}): AgentPromptDelta {
  return {
    id: input.id,
    deltaType: "user-prelude",
    role: "user-prelude",
    source: "context-injection",
    text: input.text,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export type ContextInjectionMemoryProvider = {
  getContextInjectionMemories(input: {
    limit: number;
    agentId?: string | null;
    includeSession: boolean;
    allowedCategories: MemoryCategory[];
  }): ContextInjectionMemoryLike[];
  getRecentTaskSummaries(limit: number, filter?: { agentId?: string }): RecentTaskSummaryLike[];
  getRecentWork?(input: {
    query?: string;
    limit: number;
    filter?: { agentId?: string };
  }): TaskWorkShortcutItem[];
  getResumeContext?(input: {
    taskId?: string;
    conversationId?: string;
    query?: string;
    filter?: { agentId?: string };
  }): TaskWorkShortcutItem | null;
  findSimilarPastWork?(input: {
    query: string;
    limit: number;
    filter?: { agentId?: string };
  }): TaskWorkShortcutItem[];
  search(
    query: string,
    input: {
      limit: number;
      filter: { agentId?: string | null };
      retrievalMode: "implicit";
    },
  ): Promise<AutoRecallMemoryLike[]>;
  searchWithDiagnostics?(
    query: string,
    input: {
      limit: number;
      filter: { agentId?: string | null };
      retrievalMode: "implicit";
    },
  ): Promise<{
    items: AutoRecallMemoryLike[];
    diagnostics: MemorySearchDiagnostics;
  }>;
};

export type ContextInjectionConfig = {
  contextInjectionEnabled: boolean;
  contextInjectionLimit: number;
  contextInjectionIncludeSession: boolean;
  contextInjectionTaskLimit: number;
  contextInjectionAllowedCategories: MemoryCategory[];
  autoRecallEnabled: boolean;
  autoRecallLimit: number;
  autoRecallMinScore: number;
  autoRecallTimeoutMs?: number;
};

export async function buildContextInjectionPrelude(
  memoryManager: ContextInjectionMemoryProvider,
  event: BeforeAgentStartEvent,
  ctx: HookAgentContext,
  config: ContextInjectionConfig,
): Promise<BeforeAgentStartResult | undefined> {
  const queryText = event.userInput?.trim() || event.prompt?.trim();
  const resumeMode = isResumeModeQuery(queryText);
  const implicitFilter = { agentId: ctx.agentId ?? null };
  const deduper = createContextInjectionDeduper(event.messages);
  const blocks: string[] = [];
  const deltas: AgentPromptDelta[] = [];
  const currentTurnBlock = extractCurrentMessageBlock(event.meta, event.userInput);
  if (currentTurnBlock) {
    blocks.push(currentTurnBlock);
    deltas.push(createContextPreludeDelta({
      id: "current-turn",
      text: currentTurnBlock,
      metadata: { blockTag: "current-turn" },
    }));
  }

  if (config.contextInjectionEnabled) {
    const taskWorkSurface = createTaskWorkSurface(memoryManager);
    const recent = memoryManager.getContextInjectionMemories({
      limit: config.contextInjectionLimit,
      agentId: ctx.agentId ?? null,
      includeSession: config.contextInjectionIncludeSession,
      allowedCategories: config.contextInjectionAllowedCategories,
    });
    if (recent.length > 0) {
      const latestUpdatedAt = recent.reduce((latest, item) => {
        const updatedAt = item.updatedAt ? Date.parse(item.updatedAt) : Number.NaN;
        if (!Number.isFinite(updatedAt)) return latest;
        return updatedAt > latest ? updatedAt : latest;
      }, Number.NEGATIVE_INFINITY);
      const lines = recent.flatMap((item) => {
        if (!deduper.shouldIncludeMemory(item)) {
          return [];
        }
        const src = item.sourcePath.split(/[/\\]/).pop() ?? item.sourcePath;
        const label = [item.importance, item.category ?? item.memoryType ?? "memory", src].join("|");
        const body = String(item.summary ?? item.snippet ?? "").trim();
        const time = formatLocalTimeLabel(item.updatedAt);
        const latest = Number.isFinite(latestUpdatedAt) && item.updatedAt ? Date.parse(item.updatedAt) === latestUpdatedAt : false;
        const tagged = buildTaggedLine({
          time,
          latest,
          source: "memory",
          body: `[${label}] ${body}`,
        });
        return tagged ? [tagged] : [];
      });
        if (lines.length > 0) {
        const block = `<recent-memory hint="以下是按重要性筛选后的近期记忆。优先把它们当作背景约束或已知事实，不要把它们直接当作待重新执行的任务。">\n${lines.join("\n")}\n</recent-memory>`;
        blocks.push(block);
        deltas.push(createContextPreludeDelta({
          id: "recent-memory",
          text: block,
          metadata: { blockTag: "recent-memory", lineCount: lines.length },
        }));
      }
    }

    if (config.contextInjectionTaskLimit > 0) {
      const taskFilter = { agentId: ctx.agentId };
      let recentWork = taskWorkSurface.recentWork({
          query: queryText || undefined,
          limit: config.contextInjectionTaskLimit,
          filter: taskFilter,
        });
      if (recentWork.length === 0 && queryText) {
        recentWork = taskWorkSurface.recentWork({
          limit: config.contextInjectionTaskLimit,
          filter: taskFilter,
        });
      }
      let resumeContext = taskWorkSurface.resumeContext({
          query: queryText || undefined,
          filter: taskFilter,
        });
      if (!resumeContext && queryText) {
        resumeContext = taskWorkSurface.resumeContext({ filter: taskFilter });
      }

      if (recentWork.length > 0 || resumeContext) {
        const overviewLines = buildWorkOverviewLines(recentWork, resumeContext, deduper);
        if (overviewLines.length > 0) {
          const block = `<work-overview hint="以下是任务记忆的一级摘要。默认先用它判断最近做过什么、当前停点和下一步；只有在需要追溯细节时，再展开任务详情、活动轨迹或关联记忆。">\n${overviewLines.join("\n")}\n</work-overview>`;
          blocks.push(block);
          deltas.push(createContextPreludeDelta({
            id: "work-overview",
            text: block,
            metadata: { blockTag: "work-overview", lineCount: overviewLines.length },
          }));
        }

        if (resumeMode) {
          const similarItems = queryText
            ? taskWorkSurface.findSimilarWork({
              query: queryText,
              limit: Math.min(config.contextInjectionTaskLimit, 3),
              filter: taskFilter,
            })
            : [];
          const detailLines = buildResumeDetailLines(resumeContext, similarItems, deduper);
          if (detailLines.length > 0) {
            const block = `<resume-details hint="以下是续做模式下的二级展开，仅在当前输入明显是在继续/恢复历史工作时提供。">\n${detailLines.join("\n")}\n</resume-details>`;
            blocks.push(block);
            deltas.push(createContextPreludeDelta({
              id: "resume-details",
              text: block,
              metadata: { blockTag: "resume-details", lineCount: detailLines.length },
            }));
          }
        }
      } else {
        const recentTasks = memoryManager.getRecentTaskSummaries(config.contextInjectionTaskLimit, {
          agentId: ctx.agentId,
        });
        if (recentTasks.length > 0) {
          const fallbackLines = buildLegacyRecentTaskLines(recentTasks, deduper);
          if (fallbackLines.length > 0) {
            const block = `<recent-tasks hint="以下是最近已完成或部分完成的任务摘要。若当前目标与其相同，优先复用结果，不要重复执行已成功完成的工具动作，除非用户明确要求重试。">\n${fallbackLines.join("\n")}\n</recent-tasks>`;
            blocks.push(block);
            deltas.push(createContextPreludeDelta({
              id: "recent-tasks",
              text: block,
              metadata: { blockTag: "recent-tasks", lineCount: fallbackLines.length },
            }));
          }
        }
      }
    }
  }

  if (config.autoRecallEnabled) {
    if (queryText) {
      const searchExecution: AutoRecallSearchExecution = await Promise.race([
        memoryManager.searchWithDiagnostics
          ? memoryManager.searchWithDiagnostics(queryText, {
            limit: config.autoRecallLimit,
            filter: implicitFilter,
            retrievalMode: "implicit",
          })
          : memoryManager.search(queryText, {
            limit: config.autoRecallLimit,
            filter: implicitFilter,
            retrievalMode: "implicit",
          }).then((items) => ({ items, diagnostics: undefined })),
        new Promise<AutoRecallSearchExecution>((resolve) => setTimeout(
          () => resolve({ items: [], timedOut: true }),
          config.autoRecallTimeoutMs ?? 2000,
        )),
      ]);
      const results = Array.isArray(searchExecution?.items) ? searchExecution.items : [];
      const filtered = results.filter((item) => item.score >= config.autoRecallMinScore);
      if (filtered.length > 0) {
        const latestUpdatedAt = filtered.reduce((latest, item) => {
          const updatedAt = item.updatedAt ? Date.parse(item.updatedAt) : Number.NaN;
          if (!Number.isFinite(updatedAt)) return latest;
          return updatedAt > latest ? updatedAt : latest;
        }, Number.NEGATIVE_INFINITY);
        const lines = filtered.flatMap((item) => {
          if (!deduper.shouldIncludeMemory(item)) {
            return [];
          }
          const src = item.sourcePath.split(/[/\\]/).pop() ?? item.sourcePath;
          const snippet = item.snippet.length > 200
            ? `${item.snippet.slice(0, 200)}...`
            : item.snippet;
          const time = formatLocalTimeLabel(item.updatedAt);
          const latest = Number.isFinite(latestUpdatedAt) && item.updatedAt ? Date.parse(item.updatedAt) === latestUpdatedAt : false;
          const tagged = buildTaggedLine({
            time,
            latest,
            source: "memory",
            body: `[${src}, score=${item.score.toFixed(2)}] ${snippet}`,
          });
          return tagged ? [tagged] : [];
        });
        if (lines.length > 0) {
          const block = `<auto-recall hint="以下是与用户当前输入语义相关的历史记忆，仅供参考。无需再次调用 memory_search 除非需要更深入搜索。">\n${lines.join("\n")}\n</auto-recall>`;
          const searchDiagnostics = searchExecution?.diagnostics;
          const sourceClassMix = buildAutoRecallSourceClassMix(filtered);
          blocks.push(block);
          deltas.push(createContextPreludeDelta({
            id: "auto-recall",
            text: block,
            metadata: {
              blockTag: "auto-recall",
              lineCount: lines.length,
              observability: {
                timedOut: searchExecution?.timedOut === true,
                candidateCount: results.length,
                keptCount: filtered.length,
                filteredOutCount: Math.max(0, results.length - filtered.length),
                minScore: config.autoRecallMinScore,
                sourceClassMix,
                topHitIds: filtered.slice(0, 3).map((item) => item.id).filter(Boolean),
                ...(searchDiagnostics ? { searchDiagnostics } : {}),
              },
            },
          }));
        }
      }
    }
  }

  return blocks.length > 0
    ? { prependContext: blocks.join("\n\n"), deltas }
    : undefined;
}

function buildAutoRecallSourceClassMix(items: AutoRecallMemoryLike[]): Record<string, number> {
  const mix: Record<string, number> = {};
  for (const item of items) {
    const sourceClass = readAutoRecallSourceClass(item);
    mix[sourceClass] = (mix[sourceClass] ?? 0) + 1;
  }
  return mix;
}

function readAutoRecallSourceClass(item: AutoRecallMemoryLike): string {
  const metadata = item && typeof item === "object" && "metadata" in item
    ? item.metadata
    : undefined;
  if (!metadata || typeof metadata !== "object") {
    return "unknown";
  }
  const memoryTree = "memoryTree" in metadata && metadata.memoryTree && typeof metadata.memoryTree === "object"
    ? metadata.memoryTree as { sourceClass?: unknown }
    : undefined;
  const sourceClass = typeof memoryTree?.sourceClass === "string" ? memoryTree.sourceClass.trim() : "";
  return sourceClass || "unknown";
}

function buildWorkOverviewLines(
  recentWork: TaskWorkShortcutItem[],
  resumeContext: TaskWorkShortcutItem | null,
  deduper: ReturnType<typeof createContextInjectionDeduper>,
): string[] {
  const lines: string[] = [];
  const recentWorkItems = recentWork
    .filter((item) => deduper.shouldIncludeTask(item))
    .slice(0, 5);

  for (const item of recentWorkItems) {
    const title = item.title ?? item.objective ?? item.summary ?? item.taskId ?? "task";
    const recap = truncateTaskContextPart(item.workRecap?.headline, 100);
    const body = recap ? `${title} (recap=${recap})` : title;
    const timeSource = item.finishedAt ?? item.updatedAt ?? item.startedAt;
    const tagged = buildTaggedLine({
      time: formatLocalTimeLabel(timeSource),
      source: "recent-work",
      body,
    });
    if (tagged) {
      lines.push(tagged);
    }
  }

  if (resumeContext) {
    const title = resumeContext.title ?? resumeContext.objective ?? resumeContext.summary ?? resumeContext.taskId ?? "task";
    const stopPoint = truncateTaskContextPart(resumeContext.resumeContext?.currentStopPoint, 100);
    const nextStep = truncateTaskContextPart(resumeContext.resumeContext?.nextStep, 100);
    const bodyParts = [
      `task=${title}`,
      stopPoint ? `stop=${stopPoint}` : "",
      nextStep ? `next=${nextStep}` : "",
    ].filter(Boolean).join("; ");
    const tagged = buildTaggedLine({
      time: formatLocalTimeLabel(resumeContext.finishedAt ?? resumeContext.updatedAt ?? resumeContext.startedAt),
      latest: true,
      source: "resume",
      body: bodyParts,
    });
    if (tagged) {
      lines.push(tagged);
    }
  }

  return lines;
}

function buildResumeDetailLines(
  resumeContext: TaskWorkShortcutItem | null,
  similarItems: TaskWorkShortcutItem[],
  deduper: ReturnType<typeof createContextInjectionDeduper>,
): string[] {
  const lines: string[] = [];

  if (resumeContext) {
    for (const fact of (resumeContext.workRecap?.confirmedFacts ?? []).slice(0, 3)) {
      const tagged = buildTaggedLine({
        source: "resume-fact",
        body: truncateTaskContextPart(fact, 160) ?? fact,
      });
      if (tagged) lines.push(tagged);
    }
    for (const activity of (resumeContext.recentActivityTitles ?? []).slice(0, 3)) {
      const tagged = buildTaggedLine({
        source: "resume-activity",
        body: truncateTaskContextPart(activity, 160) ?? activity,
      });
      if (tagged) lines.push(tagged);
    }
  }

  for (const item of similarItems) {
    if (resumeContext?.taskId && item.taskId === resumeContext.taskId) continue;
    if (!deduper.shouldIncludeTask(item)) continue;
    const title = item.title ?? item.objective ?? item.summary ?? item.taskId ?? "task";
    const recap = truncateTaskContextPart(item.workRecap?.headline ?? item.summary, 100);
    const matchedBy = Array.isArray(item.matchReasons) && item.matchReasons.length
      ? `matched=${item.matchReasons.slice(0, 2).join(", ")}`
      : "";
    const body = [
      title,
      recap ? `recap=${recap}` : "",
      matchedBy,
    ].filter(Boolean).join("; ");
    const tagged = buildTaggedLine({
      time: formatLocalTimeLabel(item.finishedAt ?? item.updatedAt ?? item.startedAt),
      source: "similar-work",
      body,
    });
    if (tagged) lines.push(tagged);
  }

  return lines;
}

function buildLegacyRecentTaskLines(
  recentTasks: RecentTaskSummaryLike[],
  deduper: ReturnType<typeof createContextInjectionDeduper>,
): string[] {
  const latestFinishedAt = recentTasks.reduce((latest, task) => {
    const finishedAt = task.finishedAt ? Date.parse(task.finishedAt) : Number.NaN;
    const updatedAt = task.updatedAt ? Date.parse(task.updatedAt) : Number.NaN;
    const candidate = Number.isFinite(finishedAt) ? finishedAt : updatedAt;
    if (!Number.isFinite(candidate)) return latest;
    return candidate > latest ? candidate : latest;
  }, Number.NEGATIVE_INFINITY);

  return recentTasks.flatMap((task) => {
    if (!deduper.shouldIncludeTask(task)) {
      return [];
    }
    const title = task.title ?? task.objective ?? task.summary ?? task.taskId ?? "task";
    const tools = (task.toolNames ?? []).slice(0, 3).join(", ");
    const artifacts = (task.artifactPaths ?? []).slice(0, 2).join(", ");
    const recap = truncateTaskContextPart(task.workRecap?.headline, 120);
    const stopPoint = truncateTaskContextPart(task.resumeContext?.currentStopPoint, 100);
    const nextStep = truncateTaskContextPart(task.resumeContext?.nextStep, 100);
    const extras = [
      tools ? `tools=${tools}` : "",
      artifacts ? `artifacts=${artifacts}` : "",
      recap ? `recap=${recap}` : "",
      stopPoint ? `stop=${stopPoint}` : "",
      nextStep ? `next=${nextStep}` : "",
    ].filter(Boolean).join("; ");
    const body = extras
      ? `${title} (${extras})`
      : title;
    const timeSource = task.finishedAt ?? task.updatedAt;
    const time = formatLocalTimeLabel(timeSource);
    const latest = Number.isFinite(latestFinishedAt) && timeSource ? Date.parse(timeSource) === latestFinishedAt : false;
    const tagged = buildTaggedLine({
      time,
      latest,
      source: "task",
      body,
    });
    return tagged ? [tagged] : [];
  });
}

function isResumeModeQuery(value?: string): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return [
    "继续",
    "接着",
    "恢复",
    "resume",
    "上次",
    "做到哪",
    "从哪继续",
    "继续推进",
    "继续做",
    "继续处理",
  ].some((marker) => normalized.includes(marker.toLowerCase()));
}
