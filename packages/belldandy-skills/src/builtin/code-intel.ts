import crypto from "node:crypto";
import path from "node:path";

import { isAbortError, readAbortReason, throwIfAborted } from "../abort-utils.js";
import { CodeIntel } from "../code-intel/code-intel.js";
import { projectCodeIntelQueryResult } from "../code-intel/projection.js";
import { TypeScriptLanguageServiceProvider } from "../code-intel/typescript-provider.js";
import type {
  CodeIntelLocationQueryRequest,
  CodeIntelOperation,
  CodeIntelQueryRequest,
} from "../code-intel/types.js";
import { buildFailureToolCallResult } from "../failure-kind.js";
import { withToolContract } from "../tool-contract.js";
import type { Tool, ToolCallResult, ToolContext } from "../types.js";

export const CODE_INTEL_TOOL_NAME = "code_intel";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RESULT_LIMIT = 25;
const MAX_RESULT_LIMIT = 100;
const MAX_QUERY_CHARS = 4_096;
const MAX_PATH_CHARS = 4_096;
const MAX_CURSOR_CHARS = 8_192;
const OPERATIONS = new Set<CodeIntelOperation>([
  "symbols",
  "definition",
  "references",
  "implementation",
]);

type CodeIntelToolInput = {
  operation: CodeIntelOperation;
  query?: string;
  path?: string;
  line?: number;
  column?: number;
  limit: number;
  cursor?: string;
  timeoutMs: number;
};

export interface CreateCodeIntelToolOptions {
  codeIntel?: CodeIntel;
}

export function createCodeIntelTool(options: CreateCodeIntelToolOptions = {}): Tool {
  const codeIntel = options.codeIntel ?? new CodeIntel({
    providers: [new TypeScriptLanguageServiceProvider()],
  });

  return withToolContract({
    definition: {
      name: CODE_INTEL_TOOL_NAME,
      description: "PRIMARY TS/JS NAVIGATION TOOL. For a coding task that names or implies a symbol, API, function, class, method, behavior, or reference, call code_intel before list_files, broad glob/search, or whole-file reads. Start with symbols and one identifier from the task; do not inspect the tree first. Query live workspace symbols, definitions, references, or implementations. Paths and line/column are workspace-relative and 0-based; results are read-only semantic-live evidence and never access external roots. After success, inspect only the returned paths/ranges and perform the requested mutation or verification before any further broad exploration. After failure, change the arguments or fall back instead of repeating the same call.",
      parameters: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            enum: ["symbols", "definition", "references", "implementation"],
            description: "语义查询类型",
          },
          query: {
            type: "string",
            description: "For symbols, extract one identifier from the task and provide that single identifier or a short substring, not a natural-language phrase.",
          },
          path: {
            type: "string",
            description: "definition/references/implementation 操作必填的工作区相对文件路径",
          },
          line: {
            type: "number",
            description: "location 操作必填的 0-based 行号",
          },
          column: {
            type: "number",
            description: "location 操作必填的 0-based 列号",
          },
          limit: {
            type: "number",
            description: `单页最大结果数，默认 ${DEFAULT_RESULT_LIMIT}，最大 ${MAX_RESULT_LIMIT}`,
          },
          cursor: {
            type: "string",
            description: "上一页返回的 opaque cursor；继续分页时查询与 workspace revision 必须保持不变",
          },
          timeoutMs: {
            type: "number",
            description: `查询 deadline，默认 ${DEFAULT_TIMEOUT_MS}ms，并受工具策略上限约束`,
          },
        },
        required: ["operation"],
      },
    },

    async execute(args, context): Promise<ToolCallResult> {
      const start = Date.now();
      const id = crypto.randomUUID();
      const makeError = (
        error: string,
        failureKind?: ToolCallResult["failureKind"],
      ): ToolCallResult => buildFailureToolCallResult({
        id,
        name: CODE_INTEL_TOOL_NAME,
        start,
        error,
        ...(failureKind ? { failureKind } : {}),
      });

      const input = normalizeInput(args, context);
      if (!input.ok) {
        return makeError(input.error, input.failureKind);
      }

      try {
        throwIfAborted(context.abortSignal);
        const request = buildRequest(input.value, context);
        const outcome = await codeIntel.query(request);
        throwIfAborted(context.abortSignal);
        if (!outcome.ok) {
          return makeError(
            `${outcome.error.code}: ${outcome.error.message}`,
            failureKindForCodeIntelError(outcome.error.code),
          );
        }

        const payload = projectCodeIntelQueryResult(outcome.result);
        const targetPaths = [...new Set(
          payload.items.map((item) => item.location.path),
        )].slice(0, 3);
        const nextAction = targetPaths.length > 0
          ? {
              action: "inspect_returned_source_then_mutate_or_verify",
              targetPaths,
              instruction: "Inspect the returned paths/ranges, then perform the requested mutation or verification before any further broad exploration.",
            }
          : {
              action: "refine_identifier_or_fallback",
              targetPaths: [],
              instruction: "Retry once with one identifier from the task, then use bounded file search if no workspace evidence is returned.",
            };
        const output = JSON.stringify({ ...payload, nextAction });
        const maxResponseBytes = normalizeResponseByteLimit(context.policy.maxResponseBytes);
        if (Buffer.byteLength(output, "utf-8") > maxResponseBytes) {
          return makeError(
            `响应预算过小：code_intel 结果超过 ${maxResponseBytes} bytes，请降低 limit 或缩小查询`,
            "input_error",
          );
        }

        return {
          id,
          name: CODE_INTEL_TOOL_NAME,
          success: true,
          output,
          durationMs: Date.now() - start,
          metadata: {
            providerId: outcome.result.provenance.providerId,
            providerVersion: outcome.result.provenance.providerVersion,
            capability: outcome.result.provenance.capability,
            workspaceRevision: outcome.result.provenance.workspaceRevision,
            freshness: outcome.result.freshness.status,
            returnedCount: outcome.result.page.returned,
            truncated: outcome.result.page.truncated,
            diagnosticCount: outcome.result.diagnostics.length,
          },
        };
      } catch (error) {
        if (isAbortError(error)) {
          return makeError(readAbortReason(context.abortSignal), "environment_error");
        }
        return makeError("CodeIntel tool failed to execute the semantic query.", "environment_error");
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
    activityDescription: "Query bounded live semantic evidence inside the current coding workspace",
    resultSchema: {
      kind: "json",
      description: "Language-neutral CodeIntel evidence, freshness, provenance, diagnostics, and pagination encoded as JSON text.",
    },
    outputPersistencePolicy: "conversation",
  });
}

function normalizeInput(
  args: Record<string, unknown>,
  context: ToolContext,
):
  | { ok: true; value: CodeIntelToolInput }
  | { ok: false; error: string; failureKind: ToolCallResult["failureKind"] } {
  if (typeof context.defaultCwd !== "string"
    || !context.defaultCwd.trim()
    || !path.isAbsolute(context.defaultCwd)) {
    return {
      ok: false,
      error: "code_intel requires an absolute coding workspace cwd.",
      failureKind: "environment_error",
    };
  }
  if (typeof context.workspaceRevisionId !== "string" || !context.workspaceRevisionId.trim()) {
    return {
      ok: false,
      error: "code_intel requires a coding workspace revision.",
      failureKind: "environment_error",
    };
  }

  const operation = typeof args.operation === "string" ? args.operation.trim() : "";
  if (!OPERATIONS.has(operation as CodeIntelOperation)) {
    return {
      ok: false,
      error: "参数错误：operation 必须是 symbols、definition、references 或 implementation",
      failureKind: "input_error",
    };
  }
  const limit = normalizeBoundedInteger(args.limit, DEFAULT_RESULT_LIMIT, MAX_RESULT_LIMIT, "limit");
  if (!limit.ok) return { ...limit, failureKind: "input_error" };
  const timeoutMaximum = Math.max(1, Math.floor(context.policy.maxTimeoutMs));
  const timeoutMs = normalizeBoundedInteger(
    args.timeoutMs,
    Math.min(DEFAULT_TIMEOUT_MS, timeoutMaximum),
    timeoutMaximum,
    "timeoutMs",
  );
  if (!timeoutMs.ok) return { ...timeoutMs, failureKind: "input_error" };
  const cursor = normalizeOptionalBoundedString(args.cursor, MAX_CURSOR_CHARS, "cursor");
  if (!cursor.ok) return { ...cursor, failureKind: "input_error" };

  if (operation === "symbols") {
    const query = normalizeRequiredBoundedString(args.query, MAX_QUERY_CHARS, "query");
    if (!query.ok) return { ...query, failureKind: "input_error" };
    return {
      ok: true,
      value: {
        operation,
        query: query.value,
        limit: limit.value,
        timeoutMs: timeoutMs.value,
        ...(cursor.value === undefined ? {} : { cursor: cursor.value }),
      },
    };
  }

  const relativePath = normalizeRequiredBoundedString(args.path, MAX_PATH_CHARS, "path");
  if (!relativePath.ok) return { ...relativePath, failureKind: "input_error" };
  if (path.isAbsolute(relativePath.value)
    || path.normalize(relativePath.value) === ".."
    || path.normalize(relativePath.value).startsWith(`..${path.sep}`)) {
    return {
      ok: false,
      error: "参数错误：path 必须是 coding workspace 内的相对路径",
      failureKind: "input_error",
    };
  }
  const line = normalizeNonNegativeInteger(args.line, "line");
  if (!line.ok) return { ...line, failureKind: "input_error" };
  const column = normalizeNonNegativeInteger(args.column, "column");
  if (!column.ok) return { ...column, failureKind: "input_error" };
  return {
    ok: true,
    value: {
      operation: operation as Exclude<CodeIntelOperation, "symbols">,
      path: relativePath.value.replace(/\\/g, "/"),
      line: line.value,
      column: column.value,
      limit: limit.value,
      timeoutMs: timeoutMs.value,
      ...(cursor.value === undefined ? {} : { cursor: cursor.value }),
    },
  };
}

function buildRequest(input: CodeIntelToolInput, context: ToolContext): CodeIntelQueryRequest {
  const workspace = {
    rootPath: path.resolve(context.defaultCwd!),
    revision: context.workspaceRevisionId!.trim(),
  };
  const shared = {
    workspace,
    requiredCapability: "semantic-live" as const,
    deadlineAtMs: Date.now() + input.timeoutMs,
    limit: input.limit,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  };
  if (input.operation === "symbols") {
    return {
      ...shared,
      operation: "symbols",
      query: input.query!,
    };
  }
  return {
    ...shared,
    operation: input.operation,
    location: {
      path: input.path!,
      line: input.line!,
      column: input.column!,
    },
  } satisfies CodeIntelLocationQueryRequest;
}

function failureKindForCodeIntelError(
  code: "invalid_request" | "capability_unavailable" | "timeout" | "provider_failure" | "provider_contract_invalid",
): ToolCallResult["failureKind"] {
  if (code === "invalid_request") return "input_error";
  if (code === "provider_contract_invalid") return "business_logic_error";
  return "environment_error";
}

function normalizeBoundedInteger(
  value: unknown,
  fallback: number,
  maximum: number,
  name: string,
): { ok: true; value: number } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: fallback };
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > maximum) {
    return { ok: false, error: `参数错误：${name} 必须是 1 到 ${maximum} 的整数` };
  }
  return { ok: true, value };
}

function normalizeNonNegativeInteger(
  value: unknown,
  name: string,
): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return { ok: false, error: `参数错误：${name} 必须是非负整数` };
  }
  return { ok: true, value };
}

function normalizeRequiredBoundedString(
  value: unknown,
  maximum: number,
  name: string,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || value.length > maximum) {
    return { ok: false, error: `参数错误：${name} 必须是长度不超过 ${maximum} 的非空字符串` };
  }
  return { ok: true, value: value.trim() };
}

function normalizeOptionalBoundedString(
  value: unknown,
  maximum: number,
  name: string,
): { ok: true; value?: string } | { ok: false; error: string } {
  if (value === undefined) return { ok: true };
  return normalizeRequiredBoundedString(value, maximum, name);
}

function normalizeResponseByteLimit(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}
