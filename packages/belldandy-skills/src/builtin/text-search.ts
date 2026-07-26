import crypto from "node:crypto";
import * as fs from "node:fs/promises";

import { isAbortError, readAbortReason, throwIfAborted } from "../abort-utils.js";
import { buildFailureToolCallResult } from "../failure-kind.js";
import { withToolContract } from "../tool-contract.js";
import type { Tool, ToolCallResult } from "../types.js";
import {
  collectWorkspaceFiles,
  compareWorkspacePaths,
  type WorkspaceNavigationFile,
  type WorkspaceNavigationSkipCounts,
} from "./workspace-navigation.js";

const DEFAULT_MAX_RESULTS = 50;
const MAX_RESULTS = 200;
const DEFAULT_CONTEXT_LINES = 0;
const MAX_CONTEXT_LINES = 8;
const DEFAULT_RESPONSE_BYTES = 512_000;
const MAX_QUERY_CHARS = 4_096;
const MAX_GLOB_CHARS = 1_024;
const MAX_CURSOR_CHARS = 2_048;
const MAX_SEARCH_FILE_BYTES = 4 * 1024 * 1024;
const BINARY_SAMPLE_BYTES = 8 * 1024;
const MAX_LINE_CHARS = 2_000;

type SearchMode = "fixed" | "regex";

type SearchInput = {
  query: string;
  mode: SearchMode;
  caseSensitive: boolean;
  path: string;
  glob: string[];
  maxResults: number;
  contextLines: number;
  includeIgnored: boolean;
  includeHidden: boolean;
  cursor?: string;
};

type SearchLine = {
  line: number;
  text: string;
  startColumn?: number;
  truncated?: true;
};

type SearchMatch = {
  path: string;
  line: number;
  column: number;
  matchLength: number;
  text: string;
  textStartColumn?: number;
  textTruncated?: true;
  before?: SearchLine[];
  after?: SearchLine[];
};

type SearchSkipCounts = WorkspaceNavigationSkipCounts & {
  binary: number;
  oversized: number;
};

type SearchCursor = {
  version: 1;
  fingerprint: string;
  after: {
    path: string;
    line: number;
  };
};

type BoundedOutput = {
  output: string;
  returnedCount: number;
};

/**
 * 在工作区内进行受限文本搜索。它不调用宿主 Shell，因而危险命令关闭时仍可用于代码定位。
 */
export const textSearchTool: Tool = withToolContract({
  definition: {
    name: "text_search",
    description: "在工作区内搜索文本。支持 fixed/regex、大小写、glob、上下文行和稳定分页 cursor；默认尊重 .gitignore，并跳过隐藏、敏感、二进制和策略禁止路径。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "要匹配的非空文本或正则表达式",
        },
        mode: {
          type: "string",
          enum: ["fixed", "regex"],
          description: "匹配模式，默认 fixed",
        },
        caseSensitive: {
          type: "boolean",
          description: "是否区分大小写，默认 false",
        },
        path: {
          type: "string",
          description: "搜索根目录；相对主工作区，默认 '.'",
        },
        glob: {
          type: "string",
          description: "相对搜索根目录的 glob，例如 src/**/*.ts；也可传字符串数组",
        },
        maxResults: {
          type: "number",
          description: `单页最大结果数，默认 ${DEFAULT_MAX_RESULTS}，最大 ${MAX_RESULTS}`,
        },
        contextLines: {
          type: "number",
          description: `每个匹配前后返回的上下文行数，默认 ${DEFAULT_CONTEXT_LINES}，最大 ${MAX_CONTEXT_LINES}`,
        },
        cursor: {
          type: "string",
          description: "上一页返回的稳定 cursor；继续分页时其余搜索参数必须保持不变",
        },
        includeIgnored: {
          type: "boolean",
          description: "显式覆盖 .gitignore；不会覆盖工作区、敏感路径或策略边界，默认 false",
        },
        includeHidden: {
          type: "boolean",
          description: "是否包含隐藏路径；不会包含敏感路径，默认 false",
        },
      },
      required: ["query"],
    },
  },

  async execute(args, context): Promise<ToolCallResult> {
    const start = Date.now();
    const id = crypto.randomUUID();
    const name = "text_search";
    const makeError = (error: string, failureKind?: ToolCallResult["failureKind"]): ToolCallResult => (
      buildFailureToolCallResult({
        id,
        name,
        start,
        error,
        ...(failureKind ? { failureKind } : {}),
      })
    );

    const input = normalizeSearchInput(args);
    if (!input.ok) {
      return makeError(input.error, "input_error");
    }

    let matcher: LineMatcher;
    try {
      matcher = createLineMatcher(input.value);
    } catch (error) {
      return makeError(`参数错误：无效的正则表达式：${safeErrorMessage(error)}`, "input_error");
    }

    try {
      throwIfAborted(context.abortSignal);
      const collected = await collectWorkspaceFiles({
        context,
        path: input.value.path,
        include: input.value.glob,
        includeHidden: input.value.includeHidden,
        includeIgnored: input.value.includeIgnored,
        signal: context.abortSignal,
      });
      if (!collected.ok) {
        return makeError(collected.error, collected.failureKind);
      }
      const collection = {
        files: collected.value.files,
        skipped: {
          ...collected.value.skipped,
          binary: 0,
          oversized: 0,
        } satisfies SearchSkipCounts,
        gitignoreFiles: collected.value.gitignoreFiles,
      };

      const fingerprint = buildSearchFingerprint({
        root: collected.value.root.realPath,
        input: input.value,
      });
      const cursor = decodeCursor(input.value.cursor, fingerprint);
      if (!cursor.ok) {
        return makeError(cursor.error, "input_error");
      }

      const candidateLimit = input.value.maxResults + 1;
      const candidates: SearchMatch[] = [];
      for (const file of collection.files) {
        throwIfAborted(context.abortSignal);
        if (cursor.value && compareWorkspacePaths(file.path, cursor.value.after.path) < 0) {
          continue;
        }

        const fileMatches = await findMatchesInFile({
          file,
          matcher,
          contextLines: input.value.contextLines,
          skipped: collection.skipped,
          signal: context.abortSignal,
        });
        for (const match of fileMatches) {
          if (cursor.value && compareMatchKey(match, cursor.value.after) <= 0) {
            continue;
          }
          candidates.push(match);
          if (candidates.length >= candidateLimit) {
            break;
          }
        }
        if (candidates.length >= candidateLimit) {
          break;
        }
      }

      const pageMatches = candidates.slice(0, input.value.maxResults);
      const hasMoreMatches = candidates.length > pageMatches.length;
      const maxResponseBytes = normalizeResponseByteLimit(context.policy.maxResponseBytes);
      const bounded = buildBoundedOutput({
        root: collected.value.root.relative || ".",
        query: input.value.query,
        mode: input.value.mode,
        caseSensitive: input.value.caseSensitive,
        glob: input.value.glob,
        contextLines: input.value.contextLines,
        includeIgnored: input.value.includeIgnored,
        gitignoreFiles: collection.gitignoreFiles,
        skipped: collection.skipped,
        maxResults: input.value.maxResults,
        maxResponseBytes,
        fingerprint,
        matches: pageMatches,
        hasMoreMatches,
      });
      if (!bounded) {
        return makeError(
          `响应预算过小：text_search 无法在当前 ${maxResponseBytes} bytes 限制内返回至少一个匹配结果`,
          "input_error",
        );
      }

      return {
        id,
        name,
        success: true,
        output: bounded.output,
        durationMs: Date.now() - start,
        metadata: {
          returnedCount: bounded.returnedCount,
          ignoreOverride: input.value.includeIgnored,
        },
      };
    } catch (error) {
      if (isAbortError(error)) {
        return makeError(readAbortReason(context.abortSignal));
      }
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return makeError("搜索根目录不存在", "input_error");
      }
      if (code === "EACCES") {
        return makeError("无权访问搜索根目录", "permission_or_policy");
      }
      return makeError(safeErrorMessage(error));
    }
  },
}, {
  family: "workspace-read",
  isReadOnly: true,
  isConcurrencySafe: true,
  needsPermission: false,
  riskLevel: "low",
  channels: ["gateway", "web", "cli"],
  safeScopes: ["local-safe", "web-safe"],
  activityDescription: "Search bounded text matches inside the workspace without invoking a shell",
  resultSchema: {
    kind: "json",
    description: "Bounded text-search matches, cursor, ignore mode, and skipped-path diagnostics encoded as JSON text.",
  },
  outputPersistencePolicy: "conversation",
});

type LineMatcher = (line: string) => { column: number; length: number } | undefined;

function normalizeSearchInput(args: Record<string, unknown>):
  | { ok: true; value: SearchInput }
  | { ok: false; error: string } {
  const query = typeof args.query === "string" ? args.query : "";
  if (!query.trim()) {
    return { ok: false, error: "参数错误：query 必须是非空字符串" };
  }
  if (query.length > MAX_QUERY_CHARS) {
    return { ok: false, error: `参数错误：query 不能超过 ${MAX_QUERY_CHARS} 个字符` };
  }

  const mode = args.mode === undefined ? "fixed" : args.mode;
  if (mode !== "fixed" && mode !== "regex") {
    return { ok: false, error: "参数错误：mode 必须是 fixed 或 regex" };
  }

  const pathArg = typeof args.path === "string" && args.path.trim() ? args.path.trim() : ".";
  const glob = normalizeGlobInput(args.glob);
  if (!glob.ok) return glob;
  const maxResults = normalizeBoundedPositiveInteger(args.maxResults, DEFAULT_MAX_RESULTS, MAX_RESULTS, "maxResults");
  if (!maxResults.ok) return maxResults;
  const contextLines = normalizeBoundedNonNegativeInteger(args.contextLines, DEFAULT_CONTEXT_LINES, MAX_CONTEXT_LINES, "contextLines");
  if (!contextLines.ok) return contextLines;

  const cursor = args.cursor === undefined ? undefined : args.cursor;
  if (cursor !== undefined && (typeof cursor !== "string" || !cursor.trim() || cursor.length > MAX_CURSOR_CHARS)) {
    return { ok: false, error: "参数错误：cursor 无效或过长" };
  }

  return {
    ok: true,
    value: {
      query,
      mode,
      caseSensitive: args.caseSensitive === true,
      path: pathArg,
      glob: glob.value,
      maxResults: maxResults.value,
      contextLines: contextLines.value,
      includeIgnored: args.includeIgnored === true,
      includeHidden: args.includeHidden === true,
      ...(typeof cursor === "string" ? { cursor: cursor.trim() } : {}),
    },
  };
}

function normalizeGlobInput(value: unknown): { ok: true; value: string[] } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: [] };
  const rawPatterns = typeof value === "string" ? [value] : Array.isArray(value) ? value : undefined;
  if (!rawPatterns) {
    return { ok: false, error: "参数错误：glob 必须是字符串或字符串数组" };
  }
  const patterns: string[] = [];
  for (const value of rawPatterns) {
    if (typeof value !== "string") {
      return { ok: false, error: "参数错误：glob 数组只能包含字符串" };
    }
    const pattern = normalizeGlobPattern(value);
    if (!pattern || pattern.length > MAX_GLOB_CHARS || pattern.includes("\0")) {
      return { ok: false, error: "参数错误：glob 为空、包含空字符或超过长度限制" };
    }
    patterns.push(pattern);
  }
  return { ok: true, value: [...new Set(patterns)] };
}

function normalizeBoundedPositiveInteger(
  value: unknown,
  fallback: number,
  maximum: number,
  name: string,
): { ok: true; value: number } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: fallback };
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > maximum) {
    return { ok: false, error: `参数错误：${name} 必须是 1 到 ${maximum} 的整数` };
  }
  return { ok: true, value };
}

function normalizeBoundedNonNegativeInteger(
  value: unknown,
  fallback: number,
  maximum: number,
  name: string,
): { ok: true; value: number } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: fallback };
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > maximum) {
    return { ok: false, error: `参数错误：${name} 必须是 0 到 ${maximum} 的整数` };
  }
  return { ok: true, value };
}

function createLineMatcher(input: SearchInput): LineMatcher {
  if (input.mode === "fixed") {
    const needle = input.caseSensitive ? input.query : input.query.toLowerCase();
    return (line) => {
      const haystack = input.caseSensitive ? line : line.toLowerCase();
      const index = haystack.indexOf(needle);
      return index >= 0 ? { column: index + 1, length: input.query.length } : undefined;
    };
  }

  const expression = new RegExp(input.query, input.caseSensitive ? "u" : "iu");
  return (line) => {
    const match = expression.exec(line);
    return match && match.index >= 0
      ? { column: match.index + 1, length: Math.max(match[0].length, 1) }
      : undefined;
  };
}

function normalizeGlobPattern(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

async function findMatchesInFile(input: {
  file: WorkspaceNavigationFile;
  matcher: LineMatcher;
  contextLines: number;
  skipped: SearchSkipCounts;
  signal?: AbortSignal;
}): Promise<SearchMatch[]> {
  throwIfAborted(input.signal);
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.lstat(input.file.absolute);
  } catch (error) {
    if (isAbortError(error)) throw error;
    input.skipped.unreadable += 1;
    return [];
  }
  if (stat.isSymbolicLink()) {
    input.skipped.symlink += 1;
    return [];
  }
  if (!stat.isFile()) return [];
  if (stat.size > MAX_SEARCH_FILE_BYTES) {
    input.skipped.oversized += 1;
    return [];
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(input.file.absolute);
  } catch (error) {
    if (isAbortError(error)) throw error;
    input.skipped.unreadable += 1;
    return [];
  }
  if (isLikelyBinary(buffer)) {
    input.skipped.binary += 1;
    return [];
  }

  const lines = buffer.toString("utf-8").split(/\r\n|\n|\r/);
  const matches: SearchMatch[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    throwIfAborted(input.signal);
    const line = lines[index]!;
    const match = input.matcher(line);
    if (!match) continue;
    const main = formatSearchLine(index + 1, line, match.column);
    const before = input.contextLines > 0
      ? lines.slice(Math.max(0, index - input.contextLines), index)
        .map((value, offset) => formatSearchLine(Math.max(0, index - input.contextLines) + offset + 1, value))
      : undefined;
    const after = input.contextLines > 0
      ? lines.slice(index + 1, index + 1 + input.contextLines)
        .map((value, offset) => formatSearchLine(index + offset + 2, value))
      : undefined;
    matches.push({
      path: input.file.path,
      line: index + 1,
      column: match.column,
      matchLength: match.length,
      text: main.text,
      ...(main.startColumn ? { textStartColumn: main.startColumn } : {}),
      ...(main.truncated ? { textTruncated: true } : {}),
      ...(before && before.length > 0 ? { before } : {}),
      ...(after && after.length > 0 ? { after } : {}),
    });
  }
  return matches;
}

function isLikelyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, BINARY_SAMPLE_BYTES);
  if (sample.includes(0)) return true;
  if (sample.length === 0) return false;
  let controlCharacters = 0;
  for (const value of sample) {
    if (value < 7 || (value > 14 && value < 32)) controlCharacters += 1;
  }
  return controlCharacters / sample.length > 0.3;
}

function formatSearchLine(line: number, content: string, anchorColumn?: number): SearchLine {
  if (content.length <= MAX_LINE_CHARS) {
    return { line, text: content };
  }
  const anchorIndex = Math.max(0, (anchorColumn ?? 1) - 1);
  const start = anchorColumn === undefined
    ? 0
    : Math.min(Math.max(0, anchorIndex - Math.floor(MAX_LINE_CHARS * 0.4)), content.length - MAX_LINE_CHARS);
  return {
    line,
    text: content.slice(start, start + MAX_LINE_CHARS),
    ...(start > 0 ? { startColumn: start + 1 } : {}),
    truncated: true,
  };
}

function buildSearchFingerprint(input: { root: string; input: SearchInput }): string {
  const material = JSON.stringify({
    version: 1,
    root: input.root,
    query: input.input.query,
    mode: input.input.mode,
    caseSensitive: input.input.caseSensitive,
    glob: input.input.glob,
    contextLines: input.input.contextLines,
    includeIgnored: input.input.includeIgnored,
    includeHidden: input.input.includeHidden,
  });
  return crypto.createHash("sha256").update(material).digest("hex").slice(0, 32);
}

function decodeCursor(value: string | undefined, fingerprint: string): { ok: true; value?: SearchCursor } | { ok: false; error: string } {
  if (!value) return { ok: true };
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf-8")) as Partial<SearchCursor>;
    if (
      parsed.version !== 1
      || parsed.fingerprint !== fingerprint
      || !parsed.after
      || typeof parsed.after.path !== "string"
      || !parsed.after.path
      || typeof parsed.after.line !== "number"
      || !Number.isInteger(parsed.after.line)
      || parsed.after.line < 1
    ) {
      return { ok: false, error: "参数错误：cursor 与当前搜索条件不匹配或格式无效" };
    }
    return {
      ok: true,
      value: {
        version: 1,
        fingerprint,
        after: {
          path: normalizeRelativePath(parsed.after.path),
          line: parsed.after.line,
        },
      },
    };
  } catch {
    return { ok: false, error: "参数错误：cursor 格式无效" };
  }
}

function encodeCursor(input: { fingerprint: string; after: SearchMatch }): string {
  const cursor: SearchCursor = {
    version: 1,
    fingerprint: input.fingerprint,
    after: {
      path: input.after.path,
      line: input.after.line,
    },
  };
  return Buffer.from(JSON.stringify(cursor), "utf-8").toString("base64url");
}

function compareMatchKey(match: SearchMatch, cursor: SearchCursor["after"]): number {
  const pathComparison = compareWorkspacePaths(match.path, cursor.path);
  return pathComparison === 0 ? match.line - cursor.line : pathComparison;
}

function buildBoundedOutput(input: {
  root: string;
  query: string;
  mode: SearchMode;
  caseSensitive: boolean;
  glob: string[];
  contextLines: number;
  includeIgnored: boolean;
  gitignoreFiles: number;
  skipped: SearchSkipCounts;
  maxResults: number;
  maxResponseBytes: number;
  fingerprint: string;
  matches: SearchMatch[];
  hasMoreMatches: boolean;
}): BoundedOutput | undefined {
  const build = (count: number): string => {
    const results = input.matches.slice(0, count);
    const truncated = count < input.matches.length || input.hasMoreMatches;
    const nextCursor = truncated && results.length > 0
      ? encodeCursor({ fingerprint: input.fingerprint, after: results[results.length - 1]! })
      : undefined;
    return JSON.stringify({
      root: input.root,
      query: input.query,
      mode: input.mode,
      caseSensitive: input.caseSensitive,
      ...(input.glob.length > 0 ? { glob: input.glob } : {}),
      contextLines: input.contextLines,
      ignore: {
        mode: input.includeIgnored ? "overridden" : "respected",
        gitignoreFiles: input.gitignoreFiles,
      },
      results,
      truncated,
      ...(nextCursor ? { nextCursor } : {}),
      skipped: input.skipped,
      limits: {
        maxResults: input.maxResults,
        maxResponseBytes: input.maxResponseBytes,
        maxLineChars: MAX_LINE_CHARS,
      },
    });
  };

  const complete = build(input.matches.length);
  if (Buffer.byteLength(complete, "utf-8") <= input.maxResponseBytes) {
    return { output: complete, returnedCount: input.matches.length };
  }
  if (input.matches.length === 0) return undefined;

  let low = 1;
  let high = input.matches.length;
  let best: BoundedOutput | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = build(middle);
    if (Buffer.byteLength(candidate, "utf-8") <= input.maxResponseBytes) {
      best = { output: candidate, returnedCount: middle };
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best;
}

function normalizeResponseByteLimit(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_RESPONSE_BYTES;
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  return normalized || ".";
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 320);
}
