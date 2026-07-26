import crypto from "node:crypto";

import { isAbortError, readAbortReason, throwIfAborted } from "../abort-utils.js";
import { buildFailureToolCallResult } from "../failure-kind.js";
import { withToolContract } from "../tool-contract.js";
import type { Tool, ToolCallResult } from "../types.js";
import { collectWorkspaceFiles, type WorkspaceNavigationSkipCounts } from "./workspace-navigation.js";

const DEFAULT_MAX_RESULTS = 500;
const MAX_RESULTS = 1_000;
const DEFAULT_RESPONSE_BYTES = 512_000;
const MAX_GLOB_CHARS = 1_024;
const MAX_GLOB_PATTERNS = 64;

type FileGlobInput = {
  path: string;
  include: string[];
  exclude: string[];
  maxResults: number;
  includeIgnored: boolean;
  includeHidden: boolean;
};

type BoundedOutput = {
  output: string;
  returnedCount: number;
};

/**
 * 在受限工作区内按 glob 发现文件。它只返回路径，不读取文件内容，也不调用宿主 Shell。
 */
export const fileGlobTool: Tool = withToolContract({
  definition: {
    name: "file_glob",
    description: "按 include/exclude glob 查找工作区文件。默认尊重 .gitignore，并跳过隐藏、敏感和策略禁止路径；结果按稳定路径排序。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "搜索根目录；相对主工作区，默认 '.'",
        },
        include: {
          type: "string",
          description: "相对搜索根目录的包含 glob，例如 src/**/*.ts；也可传字符串数组，默认所有文件",
        },
        exclude: {
          type: "string",
          description: "相对搜索根目录的排除 glob，例如 **/*.test.ts；也可传字符串数组",
        },
        maxResults: {
          type: "number",
          description: `最大返回文件数，默认 ${DEFAULT_MAX_RESULTS}，最大 ${MAX_RESULTS}`,
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
      required: [],
    },
  },

  async execute(args, context): Promise<ToolCallResult> {
    const start = Date.now();
    const id = crypto.randomUUID();
    const name = "file_glob";
    const makeError = (error: string, failureKind?: ToolCallResult["failureKind"]): ToolCallResult => (
      buildFailureToolCallResult({
        id,
        name,
        start,
        error,
        ...(failureKind ? { failureKind } : {}),
      })
    );

    const input = normalizeFileGlobInput(args);
    if (!input.ok) return makeError(input.error, "input_error");

    try {
      throwIfAborted(context.abortSignal);
      const collected = await collectWorkspaceFiles({
        context,
        path: input.value.path,
        include: input.value.include,
        exclude: input.value.exclude,
        includeHidden: input.value.includeHidden,
        includeIgnored: input.value.includeIgnored,
        signal: context.abortSignal,
      });
      if (!collected.ok) {
        return makeError(collected.error, collected.failureKind);
      }

      const maxResponseBytes = normalizeResponseByteLimit(context.policy.maxResponseBytes);
      const bounded = buildBoundedOutput({
        root: collected.value.root.relative || ".",
        include: input.value.include,
        exclude: input.value.exclude,
        includeIgnored: input.value.includeIgnored,
        gitignoreFiles: collected.value.gitignoreFiles,
        skipped: collected.value.skipped,
        maxResults: input.value.maxResults,
        maxResponseBytes,
        files: collected.value.files.map((file) => file.path),
      });
      if (!bounded) {
        return makeError(
          `响应预算过小：file_glob 无法在当前 ${maxResponseBytes} bytes 限制内返回至少一个匹配路径`,
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
  activityDescription: "Discover bounded file paths inside the workspace without invoking a shell",
  resultSchema: {
    kind: "json",
    description: "Stable workspace file paths, ignore mode, and skipped-path diagnostics encoded as JSON text.",
  },
  outputPersistencePolicy: "conversation",
});

function normalizeFileGlobInput(args: Record<string, unknown>):
  | { ok: true; value: FileGlobInput }
  | { ok: false; error: string } {
  const path = typeof args.path === "string" && args.path.trim() ? args.path.trim() : ".";
  const include = normalizeGlobInput(args.include, "include");
  if (!include.ok) return include;
  const exclude = normalizeGlobInput(args.exclude, "exclude");
  if (!exclude.ok) return exclude;
  const maxResults = normalizeBoundedPositiveInteger(args.maxResults, DEFAULT_MAX_RESULTS, MAX_RESULTS, "maxResults");
  if (!maxResults.ok) return maxResults;

  return {
    ok: true,
    value: {
      path,
      include: include.value,
      exclude: exclude.value,
      maxResults: maxResults.value,
      includeIgnored: args.includeIgnored === true,
      includeHidden: args.includeHidden === true,
    },
  };
}

function normalizeGlobInput(value: unknown, name: string): { ok: true; value: string[] } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: [] };
  const rawPatterns = typeof value === "string" ? [value] : Array.isArray(value) ? value : undefined;
  if (!rawPatterns) {
    return { ok: false, error: `参数错误：${name} 必须是字符串或字符串数组` };
  }
  if (rawPatterns.length > MAX_GLOB_PATTERNS) {
    return { ok: false, error: `参数错误：${name} 最多包含 ${MAX_GLOB_PATTERNS} 条 glob` };
  }

  const patterns: string[] = [];
  for (const rawPattern of rawPatterns) {
    if (typeof rawPattern !== "string") {
      return { ok: false, error: `参数错误：${name} 数组只能包含字符串` };
    }
    const pattern = rawPattern.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (!pattern || pattern.length > MAX_GLOB_CHARS || pattern.includes("\0")) {
      return { ok: false, error: `参数错误：${name} 的 glob 为空、包含空字符或超过长度限制` };
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

function buildBoundedOutput(input: {
  root: string;
  include: string[];
  exclude: string[];
  includeIgnored: boolean;
  gitignoreFiles: number;
  skipped: WorkspaceNavigationSkipCounts;
  maxResults: number;
  maxResponseBytes: number;
  files: string[];
}): BoundedOutput | undefined {
  const limitedFiles = input.files.slice(0, input.maxResults);
  const maxResultsTruncated = limitedFiles.length < input.files.length;
  const build = (count: number): string => {
    const results = limitedFiles.slice(0, count);
    return JSON.stringify({
      root: input.root,
      ...(input.include.length > 0 ? { include: input.include } : {}),
      ...(input.exclude.length > 0 ? { exclude: input.exclude } : {}),
      ignore: {
        mode: input.includeIgnored ? "overridden" : "respected",
        gitignoreFiles: input.gitignoreFiles,
      },
      results,
      truncated: results.length < limitedFiles.length || maxResultsTruncated,
      skipped: input.skipped,
      limits: {
        maxResults: input.maxResults,
        maxResponseBytes: input.maxResponseBytes,
      },
    });
  };

  const complete = build(limitedFiles.length);
  if (Buffer.byteLength(complete, "utf-8") <= input.maxResponseBytes) {
    return { output: complete, returnedCount: limitedFiles.length };
  }
  if (limitedFiles.length === 0) return undefined;

  let low = 1;
  let high = limitedFiles.length;
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

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 320);
}
