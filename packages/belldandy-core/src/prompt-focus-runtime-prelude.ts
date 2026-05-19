import { createHash } from "node:crypto";

import {
  AGENTS_FILENAME,
  SOUL_FILENAME,
  getWorkspaceDocumentBody,
  loadAgentWorkspaceFiles,
  type AgentPromptDelta,
  type WorkspaceFile,
  type WorkspaceLoadResult,
} from "@belldandy/agent";

export type PromptFocusRuntimePreludeConfig = {
  enabled: boolean;
  maxSections: number;
  maxChars: number;
  minScore: number;
  maxExcerptChars: number;
  semanticEnabled?: boolean;
  semanticMinScore?: number;
};

export type PromptFocusChunk = {
  id: string;
  fileName: typeof AGENTS_FILENAME | typeof SOUL_FILENAME;
  filePath: string;
  headingPath: string[];
  summary?: string;
  excerpt: string;
  searchText: string;
};

type PromptFocusRuntimePreludeResult = {
  prependContext?: string;
  deltas?: AgentPromptDelta[];
};

type PromptFocusMatch = {
  chunk: PromptFocusChunk;
  score: number;
  lexicalScore: number;
  semanticScore?: number;
  matchedTerms: string[];
};

type PromptFocusIndex = {
  cacheKey: string;
  fingerprint: string;
  chunkCount: number;
  chunks: PromptFocusChunk[];
  files: Array<{
    name: string;
    path: string;
  }>;
  semanticCacheKey?: string;
  semanticVectors?: Array<number[] | null>;
};

type PromptFocusSemanticEmbedder = {
  cacheKey?: string;
  embedQuery: (text: string) => Promise<number[] | null>;
  embedPassages: (texts: string[]) => Promise<Array<number[] | null>>;
};

const PROMPT_FOCUS_INDEX_VERSION = "workspace-doc-semantic-v2";
const PROMPT_FOCUS_INDEX_CACHE = new Map<string, PromptFocusIndex>();
const MAX_SECTION_CHARS = 720;
const MAX_QUERY_TERMS = 18;
const DEFAULT_HEADING_LABEL = "Overview";
const DEFAULT_PROMPT_FOCUS_SEMANTIC_MIN_SCORE = 0.3;

const STOP_TERMS = new Set([
  "a",
  "an",
  "and",
  "are",
  "for",
  "from",
  "help",
  "into",
  "that",
  "the",
  "this",
  "with",
  "一下",
  "一个",
  "不要",
  "今天",
  "继续",
  "看看",
  "直接",
  "请你",
  "这个",
]);

function truncateText(value: string | undefined, maxLength: number): string {
  const normalized = normalizeInlineText(value);
  if (!normalized) return "";
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 3))}...` : normalized;
}

function normalizeInlineText(value: string | undefined): string {
  return String(value ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearchText(value: string | undefined): string {
  return normalizeInlineText(value)
    .toLowerCase()
    .replace(/[“”"'‘’`~!@#$%^&*()_+\-=[\]{};:\\|,.<>/?！，。、】【（）《》、：；？]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectHanTerms(sequence: string, limit: number): string[] {
  const normalized = sequence.trim();
  if (normalized.length < 2) return [];

  const result: string[] = [];
  const seen = new Set<string>();
  const add = (term: string) => {
    if (result.length >= limit) return;
    const trimmed = term.trim();
    if (trimmed.length < 2 || STOP_TERMS.has(trimmed) || seen.has(trimmed)) return;
    seen.add(trimmed);
    result.push(trimmed);
  };

  add(normalized);
  for (const size of [3, 2]) {
    for (let index = 0; index <= normalized.length - size; index += 1) {
      add(normalized.slice(index, index + size));
      if (result.length >= limit) {
        return result;
      }
    }
  }
  return result;
}

export function collectPromptFocusTerms(value: string | undefined, limit = MAX_QUERY_TERMS): string[] {
  const source = String(value ?? "").trim();
  if (!source) return [];

  const terms: string[] = [];
  const seen = new Set<string>();
  const add = (term: string) => {
    const normalized = term.trim().toLowerCase();
    if (!normalized || normalized.length < 2 || STOP_TERMS.has(normalized) || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    terms.push(normalized);
  };

  const asciiSource = normalizeSearchText(source);
  for (const word of asciiSource.split(/\s+/)) {
    add(word);
    if (terms.length >= limit) {
      return terms;
    }
  }

  const hanMatches = source.match(/[\p{Script=Han}]{2,}/gu) ?? [];
  for (const sequence of hanMatches) {
    for (const term of collectHanTerms(sequence, limit - terms.length)) {
      add(term);
      if (terms.length >= limit) {
        return terms;
      }
    }
  }

  return terms.slice(0, limit);
}

function splitSectionBody(body: string): string[] {
  const normalized = normalizeInlineText(body);
  if (!normalized) return [];
  if (normalized.length <= MAX_SECTION_CHARS) {
    return [normalized];
  }

  const paragraphs = body
    .split(/\n\s*\n/g)
    .map((item) => normalizeInlineText(item))
    .filter(Boolean);
  if (paragraphs.length <= 0) {
    return [truncateText(normalized, MAX_SECTION_CHARS)];
  }

  const result: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const candidate = current ? `${current} ${paragraph}` : paragraph;
    if (candidate.length <= MAX_SECTION_CHARS) {
      current = candidate;
      continue;
    }
    if (current) {
      result.push(current);
    }
    current = paragraph.length > MAX_SECTION_CHARS ? truncateText(paragraph, MAX_SECTION_CHARS) : paragraph;
  }
  if (current) {
    result.push(current);
  }
  return result;
}

function flushPromptFocusSection(input: {
  chunks: PromptFocusChunk[];
  file: WorkspaceFile;
  fileName: typeof AGENTS_FILENAME | typeof SOUL_FILENAME;
  headingPath: string[];
  summary?: string;
  bodyLines: string[];
  sectionIndex: number;
}): number {
  const body = input.bodyLines.join("\n");
  const sections = splitSectionBody(body);
  if (sections.length <= 0) {
    return input.sectionIndex;
  }

  let nextSectionIndex = input.sectionIndex;
  for (const excerpt of sections) {
    nextSectionIndex += 1;
    const headingLabel = input.headingPath.length > 0 ? input.headingPath.join(" / ") : DEFAULT_HEADING_LABEL;
    const searchText = [
      input.fileName,
      headingLabel,
      input.summary,
      excerpt,
    ].filter(Boolean).join("\n");
    input.chunks.push({
      id: `${input.fileName}:${nextSectionIndex}`,
      fileName: input.fileName,
      filePath: input.file.path,
      headingPath: input.headingPath.length > 0 ? [...input.headingPath] : [DEFAULT_HEADING_LABEL],
      summary: input.summary,
      excerpt,
      searchText,
    });
  }
  return nextSectionIndex;
}

export function buildPromptFocusChunks(file: WorkspaceFile): PromptFocusChunk[] {
  if (file.missing || (file.name !== AGENTS_FILENAME && file.name !== SOUL_FILENAME)) {
    return [];
  }

  const fileName = file.name as typeof AGENTS_FILENAME | typeof SOUL_FILENAME;
  const summary = file.document?.frontmatter?.summary?.trim() || undefined;
  const body = getWorkspaceDocumentBody(file);
  if (!body?.trim()) {
    return [];
  }

  const chunks: PromptFocusChunk[] = [];
  const lines = body.split(/\r?\n/);
  let headingPath: string[] = [];
  let sectionLines: string[] = [];
  let sectionIndex = 0;

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      sectionIndex = flushPromptFocusSection({
        chunks,
        file,
        fileName,
        headingPath,
        summary,
        bodyLines: sectionLines,
        sectionIndex,
      });
      const depth = headingMatch[1]?.length ?? 1;
      const title = normalizeInlineText(headingMatch[2]);
      headingPath = [...headingPath.slice(0, Math.max(0, depth - 1)), title || DEFAULT_HEADING_LABEL];
      sectionLines = [];
      continue;
    }
    sectionLines.push(line);
  }

  flushPromptFocusSection({
    chunks,
    file,
    fileName,
    headingPath,
    summary,
    bodyLines: sectionLines,
    sectionIndex,
  });

  return chunks;
}

function buildPromptFocusFingerprint(workspace: WorkspaceLoadResult): string {
  const hasher = createHash("sha1");
  for (const file of workspace.files) {
    if (file.missing || (file.name !== AGENTS_FILENAME && file.name !== SOUL_FILENAME)) {
      continue;
    }
    hasher.update(file.name);
    hasher.update("\n");
    hasher.update(file.path);
    hasher.update("\n");
    hasher.update(file.content ?? "");
    hasher.update("\n---\n");
  }
  return hasher.digest("hex");
}

export function buildPromptFocusIndex(input: {
  cacheKey: string;
  workspace: WorkspaceLoadResult;
}): PromptFocusIndex {
  const fingerprint = buildPromptFocusFingerprint(input.workspace);
  const cached = PROMPT_FOCUS_INDEX_CACHE.get(input.cacheKey);
  if (cached && cached.fingerprint === fingerprint) {
    return cached;
  }

  const chunks = input.workspace.files.flatMap((file) => buildPromptFocusChunks(file));
  const index: PromptFocusIndex = {
    cacheKey: input.cacheKey,
    fingerprint,
    chunkCount: chunks.length,
    chunks,
    files: input.workspace.files
      .filter((file) => !file.missing && (file.name === AGENTS_FILENAME || file.name === SOUL_FILENAME))
      .map((file) => ({
        name: file.name,
        path: file.path,
      })),
  };
  PROMPT_FOCUS_INDEX_CACHE.set(input.cacheKey, index);
  return index;
}

export function scorePromptFocusChunks(input: {
  currentTurnText?: string;
  chunks: PromptFocusChunk[];
  minScore: number;
  semanticQueryVector?: number[] | null;
  semanticChunkVectors?: Array<number[] | null>;
  semanticMinScore?: number;
}): PromptFocusMatch[] {
  const normalizedQuery = normalizeSearchText(input.currentTurnText);
  const queryTerms = collectPromptFocusTerms(input.currentTurnText, MAX_QUERY_TERMS);
  const semanticEnabled = hasUsableVector(input.semanticQueryVector)
    && Array.isArray(input.semanticChunkVectors)
    && input.semanticChunkVectors.length === input.chunks.length;
  if (!normalizedQuery || (queryTerms.length <= 0 && !semanticEnabled)) {
    return [];
  }

  const matches: PromptFocusMatch[] = [];
  for (const [index, chunk] of input.chunks.entries()) {
    const headingText = normalizeSearchText(chunk.headingPath.join(" / "));
    const summaryText = normalizeSearchText(chunk.summary);
    const searchText = normalizeSearchText(chunk.searchText);

    let lexicalScore = 0;
    const matchedTerms = new Set<string>();
    if (normalizedQuery.length >= 4 && searchText.includes(normalizedQuery)) {
      lexicalScore += 8;
    }

    for (const term of queryTerms) {
      if (headingText.includes(term)) {
        lexicalScore += 4;
        matchedTerms.add(term);
        continue;
      }
      if (summaryText && summaryText.includes(term)) {
        lexicalScore += 3;
        matchedTerms.add(term);
        continue;
      }
      if (searchText.includes(term)) {
        lexicalScore += 2;
        matchedTerms.add(term);
      }
    }

    const semanticScore = semanticEnabled
      ? computeCosineSimilarity(input.semanticQueryVector, input.semanticChunkVectors?.[index] ?? null)
      : undefined;
    const passesLexical = lexicalScore >= input.minScore && matchedTerms.size > 0;
    const passesSemantic = typeof semanticScore === "number"
      && semanticScore >= (input.semanticMinScore ?? DEFAULT_PROMPT_FOCUS_SEMANTIC_MIN_SCORE);
    if (!passesLexical && !passesSemantic) {
      continue;
    }

    const score = lexicalScore + (typeof semanticScore === "number" ? semanticScore * 10 : 0) + (passesLexical && passesSemantic ? 1 : 0);

    matches.push({
      chunk,
      score,
      lexicalScore,
      semanticScore,
      matchedTerms: [...matchedTerms],
    });
  }

  return matches.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (right.matchedTerms.length !== left.matchedTerms.length) {
      return right.matchedTerms.length - left.matchedTerms.length;
    }
    const leftHeading = left.chunk.headingPath.join(" / ");
    const rightHeading = right.chunk.headingPath.join(" / ");
    return `${left.chunk.fileName}:${leftHeading}:${left.chunk.id}`.localeCompare(`${right.chunk.fileName}:${rightHeading}:${right.chunk.id}`);
  });
}

function hasUsableVector(vector: number[] | null | undefined): vector is number[] {
  return Array.isArray(vector) && vector.length > 0;
}

function computeCosineSimilarity(left: number[] | null | undefined, right: number[] | null | undefined): number | undefined {
  if (!hasUsableVector(left) || !hasUsableVector(right)) {
    return undefined;
  }
  const size = Math.min(left.length, right.length);
  if (size <= 0) {
    return undefined;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < size; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm <= 0 || rightNorm <= 0) {
    return undefined;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

async function ensurePromptFocusSemanticVectors(input: {
  index: PromptFocusIndex;
  semanticEmbedder?: PromptFocusSemanticEmbedder;
}): Promise<Array<number[] | null> | undefined> {
  const semanticEmbedder = input.semanticEmbedder;
  if (!semanticEmbedder?.embedPassages || input.index.chunks.length <= 0) {
    return undefined;
  }
  const semanticCacheKey = semanticEmbedder.cacheKey?.trim() || "semantic";
  if (
    input.index.semanticCacheKey === semanticCacheKey
    && Array.isArray(input.index.semanticVectors)
    && input.index.semanticVectors.length === input.index.chunks.length
  ) {
    return input.index.semanticVectors;
  }

  const vectors = await semanticEmbedder.embedPassages(input.index.chunks.map((chunk) => chunk.searchText));
  const normalizedVectors = input.index.chunks.map((_, index) => {
    const vector = vectors[index];
    return hasUsableVector(vector) ? vector : null;
  });
  input.index.semanticCacheKey = semanticCacheKey;
  input.index.semanticVectors = normalizedVectors;
  return normalizedVectors;
}

function formatPromptFocusLine(match: PromptFocusMatch, maxExcerptChars: number): string {
  const headingLabel = truncateText(match.chunk.headingPath.join(" / "), 96);
  const excerpt = truncateText(match.chunk.excerpt, maxExcerptChars);
  return `- ${match.chunk.fileName} > ${headingLabel}：${excerpt}`;
}

function createPromptFocusDelta(input: {
  text: string;
  lineCount: number;
  metadata?: Record<string, unknown>;
}): AgentPromptDelta {
  return {
    id: "prompt-focus-runtime",
    deltaType: "user-prelude",
    role: "user-prelude",
    source: "prompt-focus-runtime",
    text: input.text,
    metadata: {
      blockTag: "prompt-focus-runtime",
      lineCount: input.lineCount,
      ...(input.metadata ?? {}),
    },
  };
}

export async function buildPromptFocusRuntimePrelude(input: {
  stateDir: string;
  agentId?: string;
  workspaceAgentId?: string;
  currentTurnText?: string;
  config: PromptFocusRuntimePreludeConfig;
  workspaceLoader?: (rootDir: string, workspaceAgentId: string) => Promise<WorkspaceLoadResult>;
  semanticEmbedder?: PromptFocusSemanticEmbedder;
}): Promise<PromptFocusRuntimePreludeResult | undefined> {
  if (!input.config.enabled) {
    return undefined;
  }

  const currentTurnText = input.currentTurnText?.trim();
  if (!currentTurnText) {
    return undefined;
  }

  const workspaceAgentId = input.workspaceAgentId?.trim() || input.agentId?.trim() || "default";
  const workspace = await (input.workspaceLoader ?? loadAgentWorkspaceFiles)(input.stateDir, workspaceAgentId);
  const cacheKey = `${workspace.dir}::${workspaceAgentId}`;
  const index = buildPromptFocusIndex({
    cacheKey,
    workspace,
  });
  if (index.chunkCount <= 0) {
    return undefined;
  }

  let semanticQueryVector: number[] | null | undefined;
  let semanticChunkVectors: Array<number[] | null> | undefined;
  if (input.config.semanticEnabled !== false && input.semanticEmbedder) {
    semanticQueryVector = await input.semanticEmbedder.embedQuery(currentTurnText);
    semanticChunkVectors = await ensurePromptFocusSemanticVectors({
      index,
      semanticEmbedder: input.semanticEmbedder,
    });
  }

  const rankedMatches = scorePromptFocusChunks({
    currentTurnText,
    chunks: index.chunks,
    minScore: input.config.minScore,
    semanticQueryVector,
    semanticChunkVectors,
    semanticMinScore: input.config.semanticMinScore,
  });
  if (rankedMatches.length <= 0) {
    return undefined;
  }

  const header = `<prompt-focus hint="以下内容是从 AGENTS.md / SOUL.md 中按当前任务动态聚焦的相关规则，只作为本轮执行的注意力锚点；若无关，不要机械复述。">`;
  const footer = "</prompt-focus>";
  const lines: string[] = [];
  const selectedMatches: PromptFocusMatch[] = [];
  let usedChars = header.length + footer.length + 2;

  for (const match of rankedMatches) {
    if (selectedMatches.length >= input.config.maxSections) {
      break;
    }
    let line = formatPromptFocusLine(match, input.config.maxExcerptChars);
    const remainingChars = input.config.maxChars - usedChars - (lines.length > 0 ? 1 : 0);
    if (remainingChars < 48) {
      break;
    }
    if (line.length > remainingChars) {
      line = truncateText(line, remainingChars);
    }
    lines.push(line);
    selectedMatches.push(match);
    usedChars += line.length + (lines.length > 1 ? 1 : 0);
  }

  if (lines.length <= 0) {
    return undefined;
  }

  const block = `${header}\n${lines.join("\n")}\n${footer}`;
  return {
    prependContext: block,
    deltas: [
      createPromptFocusDelta({
        text: block,
        lineCount: lines.length,
        metadata: {
          agentId: input.agentId?.trim() || "default",
          workspaceAgentId,
          workspaceDir: workspace.dir,
          indexVersion: PROMPT_FOCUS_INDEX_VERSION,
          indexedChunkCount: index.chunkCount,
          indexedFiles: index.files.map((item) => item.name),
          matchedChunkCount: rankedMatches.length,
          retrievalMode: hasUsableVector(semanticQueryVector) ? "semantic+lexical" : "lexical-only",
          selectedChunkIds: selectedMatches.map((item) => item.chunk.id),
          selectedHeadings: selectedMatches.map((item) => `${item.chunk.fileName} > ${item.chunk.headingPath.join(" / ")}`),
          selectedScores: selectedMatches.map((item) => item.score),
          selectedLexicalScores: selectedMatches.map((item) => item.lexicalScore),
          selectedSemanticScores: selectedMatches.map((item) => item.semanticScore ?? null),
          currentTurnPreview: truncateText(currentTurnText, 120) || undefined,
        },
      }),
    ],
  };
}
