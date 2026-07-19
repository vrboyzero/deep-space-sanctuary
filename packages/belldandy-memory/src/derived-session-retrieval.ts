import fs from "node:fs/promises";
import path from "node:path";

import { resolveMemorySourceIdentity } from "./memory-source-registry.js";
import type { DreamSessionDigest, DreamSessionMemory } from "./dream-types.js";
import type { MemorySearchFilter, MemorySearchResult, MemoryType } from "./types.js";

const SESSION_DIGEST_SUFFIX = ".digest.json";
const SESSION_MEMORY_SUFFIX = ".session-memory.json";
const SESSION_META_SUFFIX = ".meta.json";
const SESSION_TRANSCRIPT_SUFFIX = ".transcript.jsonl";
const SESSION_MESSAGES_SUFFIX = ".jsonl";
const DEFAULT_SESSION_SCAN_LIMIT = 24;

type SessionArtifactCandidate = {
  safeConversationId: string;
  newestFileMs: number;
  hasDigest: boolean;
  hasSessionMemory: boolean;
  digestPath?: string;
  sessionMemoryPath?: string;
  metaPath?: string;
  transcriptPath?: string;
  messagesPath?: string;
};

type SessionDerivedSurfaceKind =
  | "session_memory_resume"
  | "session_memory_summary"
  | "session_digest_summary";

type SessionDerivedSurface = {
  conversationId: string;
  safeConversationId: string;
  kind: SessionDerivedSurfaceKind;
  sourceKind: "session_memory" | "session_digest";
  sourcePath: string;
  summary: string;
  snippet: string;
  content: string;
  updatedAt?: string;
  matchReasons: string[];
  score: number;
};

export async function collectDerivedSessionSearchResults(input: {
  stateDir: string;
  query: string;
  limit?: number;
  filter?: MemorySearchFilter;
  includeContent?: boolean;
  signal?: AbortSignal;
}): Promise<MemorySearchResult[]> {
  input.signal?.throwIfAborted();
  const normalizedQuery = normalizeQuery(input.query);
  if (!normalizedQuery) {
    return [];
  }
  if (input.filter?.scope === "shared") {
    return [];
  }
  if (!allowsSessionMemoryType(input.filter?.memoryType)) {
    return [];
  }

  const sessionsDir = path.join(input.stateDir, "sessions");
  const candidates = await listSessionArtifactCandidates(sessionsDir, input.signal);
  if (candidates.length <= 0) {
    return [];
  }

  const includeContent = input.includeContent !== false;
  const limit = Math.max(1, Math.min(4, Math.floor(input.limit ?? 3)));
  const surfaces = (await Promise.all(
    candidates
      .slice(0, Math.max(limit * 6, 8))
      .map((candidate) => buildBestSessionSurface({
        candidate,
        query: normalizedQuery,
        filter: input.filter,
        signal: input.signal,
      })),
  ))
    .filter((item): item is SessionDerivedSurface => Boolean(item))
    .sort(compareSessionDerivedSurface)
    .slice(0, limit);

  return surfaces.map((surface) => {
    const identity = resolveMemorySourceIdentity({
      id: `derived-session:${surface.safeConversationId}:${surface.kind}`,
      sourceKind: surface.sourceKind,
      sourceClass: "derived",
      scope: "private",
      sourcePath: surface.sourcePath,
      updatedAt: surface.updatedAt,
    });
    return {
      id: `derived-session:${surface.safeConversationId}:${surface.kind}`,
      sourcePath: surface.sourcePath,
      sourceType: "session_derived",
      memoryType: "session",
      ...(includeContent ? { content: surface.content } : {}),
      snippet: surface.snippet,
      summary: surface.summary,
      score: surface.score,
      updatedAt: surface.updatedAt,
      metadata: {
        derivedRetrieval: {
          conversationId: surface.conversationId,
          kind: surface.kind,
          sourceKind: surface.sourceKind,
          sourcePath: surface.sourcePath,
          matchReasons: surface.matchReasons,
        },
        memoryTree: {
          sourceClass: "derived",
          sourceKind: surface.sourceKind,
          canonicalSourceKey: identity.canonicalSourceKey,
          sourceFamilyKey: identity.sourceFamilyKey,
          ...(identity.revisionHint ? { revisionHint: identity.revisionHint } : {}),
        },
      },
    } satisfies MemorySearchResult;
  });
}

async function listSessionArtifactCandidates(
  sessionsDir: string,
  signal?: AbortSignal,
): Promise<SessionArtifactCandidate[]> {
  try {
    signal?.throwIfAborted();
    const entries = await fs.readdir(sessionsDir, { withFileTypes: true });
    signal?.throwIfAborted();
    const groups = new Map<string, SessionArtifactCandidate>();

    await Promise.all(entries.map(async (entry) => {
      signal?.throwIfAborted();
      if (!entry.isFile()) return;
      const fileName = entry.name;
      const suffix = resolveArtifactSuffix(fileName);
      if (!suffix) return;

      const safeConversationId = fileName.slice(0, -suffix.length);
      if (!safeConversationId) return;

      const filePath = path.join(sessionsDir, fileName);
      let newestFileMs = 0;
      try {
        const stat = await fs.stat(filePath);
        signal?.throwIfAborted();
        newestFileMs = Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0;
      } catch {
        signal?.throwIfAborted();
        newestFileMs = 0;
      }

      const existing = groups.get(safeConversationId);
      const candidate = existing ?? {
        safeConversationId,
        newestFileMs: 0,
        hasDigest: false,
        hasSessionMemory: false,
      };
      candidate.newestFileMs = Math.max(candidate.newestFileMs, newestFileMs);
      if (suffix === SESSION_DIGEST_SUFFIX) {
        candidate.hasDigest = true;
        candidate.digestPath = filePath;
      }
      if (suffix === SESSION_MEMORY_SUFFIX) {
        candidate.hasSessionMemory = true;
        candidate.sessionMemoryPath = filePath;
      }
      if (suffix === SESSION_META_SUFFIX) {
        candidate.metaPath = filePath;
      }
      if (suffix === SESSION_TRANSCRIPT_SUFFIX) {
        candidate.transcriptPath = filePath;
      }
      if (suffix === SESSION_MESSAGES_SUFFIX && !fileName.endsWith(SESSION_TRANSCRIPT_SUFFIX)) {
        candidate.messagesPath = filePath;
      }
      groups.set(safeConversationId, candidate);
    }));
    signal?.throwIfAborted();

    return [...groups.values()]
      .filter((item) => item.hasDigest || item.hasSessionMemory)
      .sort((left, right) => right.newestFileMs - left.newestFileMs)
      .slice(0, DEFAULT_SESSION_SCAN_LIMIT);
  } catch (error) {
    signal?.throwIfAborted();
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function resolveArtifactSuffix(fileName: string): string | undefined {
  if (fileName.endsWith(SESSION_MEMORY_SUFFIX)) {
    return SESSION_MEMORY_SUFFIX;
  }
  if (fileName.endsWith(SESSION_DIGEST_SUFFIX)) {
    return SESSION_DIGEST_SUFFIX;
  }
  if (fileName.endsWith(SESSION_META_SUFFIX)) {
    return SESSION_META_SUFFIX;
  }
  if (fileName.endsWith(SESSION_TRANSCRIPT_SUFFIX)) {
    return SESSION_TRANSCRIPT_SUFFIX;
  }
  if (fileName.endsWith(SESSION_MESSAGES_SUFFIX)) {
    return SESSION_MESSAGES_SUFFIX;
  }
  return undefined;
}

async function buildBestSessionSurface(input: {
  candidate: SessionArtifactCandidate;
  query: string;
  filter?: MemorySearchFilter;
  signal?: AbortSignal;
}): Promise<SessionDerivedSurface | null> {
  input.signal?.throwIfAborted();
  const [sessionDigest, sessionMemory] = await Promise.all([
    input.candidate.digestPath
      ? readJsonFile<DreamSessionDigest>(input.candidate.digestPath, input.signal)
      : Promise.resolve(undefined),
    input.candidate.sessionMemoryPath
      ? readJsonFile<DreamSessionMemory>(input.candidate.sessionMemoryPath, input.signal)
      : Promise.resolve(undefined),
  ]);
  input.signal?.throwIfAborted();
  const conversationId = await resolveConversationId(input.candidate, sessionDigest, input.signal);

  const surfaces = buildSessionSurfaces({
    candidate: input.candidate,
    conversationId,
    sessionDigest,
    sessionMemory,
  });
  const ranked = surfaces
    .map((surface) => scoreSessionSurface(surface, input.query))
    .filter((surface): surface is SessionDerivedSurface => Boolean(surface))
    .filter((surface) => isWithinDateRange(surface.updatedAt, input.filter));

  return ranked.length > 0
    ? ranked.sort(compareSessionDerivedSurface)[0]
    : null;
}

function buildSessionSurfaces(input: {
  candidate: SessionArtifactCandidate;
  conversationId: string;
  sessionDigest?: DreamSessionDigest;
  sessionMemory?: DreamSessionMemory;
}): Array<SessionDerivedSurface & { scoreFields: Array<{ label: string; values: string[] }>; baseScore: number }> {
  const surfaces: Array<SessionDerivedSurface & { scoreFields: Array<{ label: string; values: string[] }>; baseScore: number }> = [];
  const conversationLabel = truncateText(input.conversationId || input.candidate.safeConversationId, 120);

  if (input.sessionMemory) {
    const updatedAt = toIsoTimestamp(input.sessionMemory.updatedAt) ?? toIsoTimestamp(input.candidate.newestFileMs);
    const sourcePath = input.candidate.sessionMemoryPath ?? path.join("", input.candidate.safeConversationId + SESSION_MEMORY_SUFFIX);
    const summary = compactText(
      `会话续做：${input.sessionMemory.nextStep || input.sessionMemory.currentWork || input.sessionMemory.currentGoal || input.sessionMemory.summary || ""}`,
      220,
    );
    const resumeLines = [
      `Conversation: ${conversationLabel}`,
      input.sessionMemory.summary ? `Summary: ${input.sessionMemory.summary}` : undefined,
      input.sessionMemory.currentGoal ? `Current Goal: ${input.sessionMemory.currentGoal}` : undefined,
      input.sessionMemory.currentWork ? `Current Work: ${input.sessionMemory.currentWork}` : undefined,
      input.sessionMemory.nextStep ? `Next Step: ${input.sessionMemory.nextStep}` : undefined,
      (input.sessionMemory.pendingTasks?.length ?? 0) > 0
        ? `Pending Tasks: ${input.sessionMemory.pendingTasks!.slice(0, 4).join(" | ")}`
        : undefined,
    ].filter((line): line is string => Boolean(line));
    if (resumeLines.length >= 3 && summary) {
      surfaces.push({
        conversationId: input.conversationId,
        safeConversationId: input.candidate.safeConversationId,
        kind: "session_memory_resume",
        sourceKind: "session_memory",
        sourcePath,
        summary,
        snippet: truncateText(input.sessionMemory.nextStep || input.sessionMemory.currentWork || input.sessionMemory.summary || summary, 180),
        content: resumeLines.join("\n"),
        updatedAt,
        matchReasons: [],
        score: 0,
        baseScore: 0.78,
        scoreFields: [
          { label: "续做摘要", values: [input.sessionMemory.summary ?? "", input.sessionMemory.currentGoal ?? ""] },
          { label: "当前工作/下一步", values: [input.sessionMemory.currentWork ?? "", input.sessionMemory.nextStep ?? ""] },
          { label: "待办事项", values: input.sessionMemory.pendingTasks ?? [] },
        ],
      });
    }

    const summaryLines = [
      `Conversation: ${conversationLabel}`,
      input.sessionMemory.summary ? `Summary: ${input.sessionMemory.summary}` : undefined,
      input.sessionMemory.currentGoal ? `Current Goal: ${input.sessionMemory.currentGoal}` : undefined,
      (input.sessionMemory.keyResults?.length ?? 0) > 0
        ? `Key Results: ${input.sessionMemory.keyResults!.slice(0, 4).join(" | ")}`
        : undefined,
      (input.sessionMemory.decisions?.length ?? 0) > 0
        ? `Decisions: ${input.sessionMemory.decisions!.slice(0, 4).join(" | ")}`
        : undefined,
      (input.sessionMemory.errorsAndFixes?.length ?? 0) > 0
        ? `Errors & Fixes: ${input.sessionMemory.errorsAndFixes!.slice(0, 4).join(" | ")}`
        : undefined,
      (input.sessionMemory.filesTouched?.length ?? 0) > 0
        ? `Files Touched: ${input.sessionMemory.filesTouched!.slice(0, 5).join(" | ")}`
        : undefined,
    ].filter((line): line is string => Boolean(line));
    const summaryHeadline = compactText(
      `会话结论：${input.sessionMemory.summary || input.sessionMemory.currentGoal || input.sessionMemory.keyResults?.[0] || ""}`,
      220,
    );
    if (summaryLines.length >= 3 && summaryHeadline) {
      surfaces.push({
        conversationId: input.conversationId,
        safeConversationId: input.candidate.safeConversationId,
        kind: "session_memory_summary",
        sourceKind: "session_memory",
        sourcePath,
        summary: summaryHeadline,
        snippet: truncateText(input.sessionMemory.summary || input.sessionMemory.keyResults?.[0] || summaryHeadline, 180),
        content: summaryLines.join("\n"),
        updatedAt,
        matchReasons: [],
        score: 0,
        baseScore: 0.72,
        scoreFields: [
          { label: "会话总结/目标", values: [input.sessionMemory.summary ?? "", input.sessionMemory.currentGoal ?? ""] },
          { label: "关键结果/决策", values: [...(input.sessionMemory.keyResults ?? []), ...(input.sessionMemory.decisions ?? [])] },
          { label: "问题修复/改动文件", values: [...(input.sessionMemory.errorsAndFixes ?? []), ...(input.sessionMemory.filesTouched ?? [])] },
        ],
      });
    }
  }

  if (input.sessionDigest) {
    const updatedAt = toIsoTimestamp(input.sessionDigest.lastDigestAt) ?? toIsoTimestamp(input.candidate.newestFileMs);
    const sourcePath = input.candidate.digestPath ?? path.join("", input.candidate.safeConversationId + SESSION_DIGEST_SUFFIX);
    const digestSummary = compactText(
      `会话 digest：${input.sessionDigest.rollingSummary || input.sessionDigest.archivalSummary || ""}`,
      220,
    );
    const digestLines = [
      `Conversation: ${conversationLabel}`,
      input.sessionDigest.rollingSummary ? `Rolling Summary: ${input.sessionDigest.rollingSummary}` : undefined,
      input.sessionDigest.archivalSummary ? `Archival Summary: ${input.sessionDigest.archivalSummary}` : undefined,
      typeof input.sessionDigest.pendingMessageCount === "number"
        ? `Pending Message Count: ${input.sessionDigest.pendingMessageCount}`
        : undefined,
    ].filter((line): line is string => Boolean(line));
    if (digestLines.length >= 2 && digestSummary) {
      surfaces.push({
        conversationId: input.conversationId,
        safeConversationId: input.candidate.safeConversationId,
        kind: "session_digest_summary",
        sourceKind: "session_digest",
        sourcePath,
        summary: digestSummary,
        snippet: truncateText(input.sessionDigest.rollingSummary || input.sessionDigest.archivalSummary || digestSummary, 180),
        content: digestLines.join("\n"),
        updatedAt,
        matchReasons: [],
        score: 0,
        baseScore: 0.66,
        scoreFields: [
          { label: "rolling summary", values: [input.sessionDigest.rollingSummary ?? ""] },
          { label: "archival summary", values: [input.sessionDigest.archivalSummary ?? ""] },
        ],
      });
    }
  }

  return surfaces;
}

function scoreSessionSurface(
  surface: SessionDerivedSurface & { scoreFields: Array<{ label: string; values: string[] }>; baseScore: number },
  normalizedQuery: string,
): SessionDerivedSurface | null {
  const queryTokens = tokenizeQuery(normalizedQuery);
  let rawMatchScore = 0;
  const reasons = new Set<string>();

  for (const field of surface.scoreFields) {
    const score = scoreFieldValues(field.values, normalizedQuery, queryTokens);
    if (score <= 0) {
      continue;
    }
    rawMatchScore += score;
    reasons.add(field.label);
  }

  if (rawMatchScore <= 0) {
    return null;
  }

  const normalizedMatchScore = Math.min(rawMatchScore / 40, 0.16);
  const recencyBonus = computeRecencyBonus(surface.updatedAt);
  return {
    ...surface,
    matchReasons: [...reasons],
    score: clampScore(surface.baseScore + normalizedMatchScore + recencyBonus),
  };
}

function scoreFieldValues(values: string[], normalizedQuery: string, queryTokens: string[]): number {
  let best = 0;
  for (const rawValue of values) {
    const normalizedValue = normalizeQuery(rawValue);
    if (!normalizedValue) {
      continue;
    }

    let score = 0;
    if (normalizedValue.includes(normalizedQuery)) {
      score += 10;
    }

    const tokenMatches = queryTokens.filter((token) => normalizedValue.includes(token)).length;
    const minTokenMatches = queryTokens.length >= 3 ? 2 : 1;
    if (tokenMatches >= minTokenMatches) {
      score += tokenMatches * 3;
    }

    if (score > best) {
      best = score;
    }
  }
  return best;
}

function compareSessionDerivedSurface(left: SessionDerivedSurface, right: SessionDerivedSurface): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }
  return parseIsoTimestamp(right.updatedAt) - parseIsoTimestamp(left.updatedAt);
}

function normalizeQuery(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.replace(/\s+/g, " ").trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

function tokenizeQuery(value: string): string[] {
  return [...new Set(
    value
      .split(/[\s,.;:!?/\\()[\]{}<>|"'`~\-_=+]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2),
  )];
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength
    ? `${value.slice(0, Math.max(0, maxLength - 3))}...`
    : value;
}

function compactText(value: string, maxLength: number): string | undefined {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  return truncateText(normalized, maxLength);
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  if (value < 0.05) return 0.05;
  if (value > 0.99) return 0.99;
  return value;
}

function toIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return new Date(value).toISOString();
}

function computeRecencyBonus(updatedAt?: string): number {
  const timestamp = parseIsoTimestamp(updatedAt);
  if (!Number.isFinite(timestamp)) {
    return 0;
  }
  const ageHours = (Date.now() - timestamp) / (1000 * 60 * 60);
  if (ageHours <= 24) return 0.06;
  if (ageHours <= 24 * 7) return 0.04;
  if (ageHours <= 24 * 30) return 0.02;
  return 0;
}

function parseIsoTimestamp(value?: string): number {
  const timestamp = Date.parse(String(value ?? ""));
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function allowsSessionMemoryType(memoryType: MemoryType | MemoryType[] | undefined): boolean {
  if (!memoryType) {
    return true;
  }
  const values = Array.isArray(memoryType) ? memoryType : [memoryType];
  return values.includes("session");
}

function isWithinDateRange(updatedAt: string | undefined, filter?: MemorySearchFilter): boolean {
  if (!updatedAt) {
    return true;
  }
  const timestamp = Date.parse(updatedAt);
  if (!Number.isFinite(timestamp)) {
    return true;
  }
  if (filter?.dateFrom) {
    const from = Date.parse(`${filter.dateFrom}T00:00:00.000Z`);
    if (Number.isFinite(from) && timestamp < from) {
      return false;
    }
  }
  if (filter?.dateTo) {
    const to = Date.parse(`${filter.dateTo}T23:59:59.999Z`);
    if (Number.isFinite(to) && timestamp > to) {
      return false;
    }
  }
  return true;
}

async function readJsonFile<T>(filePath: string, signal?: AbortSignal): Promise<T | undefined> {
  try {
    signal?.throwIfAborted();
    const raw = await fs.readFile(filePath, { encoding: "utf-8", signal });
    signal?.throwIfAborted();
    return JSON.parse(raw) as T;
  } catch {
    signal?.throwIfAborted();
    return undefined;
  }
}

async function resolveConversationId(
  candidate: SessionArtifactCandidate,
  sessionDigest?: DreamSessionDigest,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const fromDigest = normalizeText(sessionDigest?.conversationId);
  if (fromDigest) {
    return fromDigest;
  }

  if (candidate.metaPath) {
    const parsedMeta = await readJsonFile<{ conversationId?: unknown }>(candidate.metaPath, signal);
    const fromMeta = normalizeText(parsedMeta?.conversationId);
    if (fromMeta) {
      return fromMeta;
    }
  }

  for (const transcriptPath of [candidate.transcriptPath, candidate.messagesPath]) {
    if (!transcriptPath) {
      continue;
    }
    try {
      signal?.throwIfAborted();
      const raw = await fs.readFile(transcriptPath, { encoding: "utf-8", signal });
      signal?.throwIfAborted();
      const firstLine = raw.split(/\r?\n/).find((line) => line.trim());
      if (!firstLine) {
        continue;
      }
      const parsed = JSON.parse(firstLine) as { conversationId?: unknown };
      const fromTranscript = normalizeText(parsed.conversationId);
      if (fromTranscript) {
        return fromTranscript;
      }
    } catch {
      signal?.throwIfAborted();
      continue;
    }
  }

  return !candidate.safeConversationId.includes("%")
    ? candidate.safeConversationId
    : candidate.safeConversationId;
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
