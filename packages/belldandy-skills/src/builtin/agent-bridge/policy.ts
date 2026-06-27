import path from "node:path";
import type { ToolContext } from "../../types.js";
import { resolveRuntimeFilesystemScope } from "../../runtime-policy.js";
import type { BridgeActionConfig, BridgeTargetConfig } from "./types.js";

const POSITIONAL_STRUCTURED_ARGS = new Set(["path", "prompt", "script", "text", "uri", "url"]);
const RESERVED_PATH_SUFFIX_KEYS = new Set(["line", "column"]);

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function isAbsoluteLike(input: string): boolean {
  return path.isAbsolute(input) || /^[A-Za-z]:/.test(input) || input.startsWith("\\\\");
}

function isUnderRoot(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath));
  return !(relative.startsWith("..") || path.isAbsolute(relative));
}

function isUnderAllowedRoots(targetPath: string, workspaceRoot: string, extraWorkspaceRoots?: string[]): boolean {
  if (isUnderRoot(targetPath, workspaceRoot)) return true;
  return (extraWorkspaceRoots ?? []).some((root) => isUnderRoot(targetPath, root));
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

function normalizeBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeNumberish(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return normalizeOptionalString(value);
}

function replaceTemplatePlaceholders(
  template: string[],
  allowedArgs: string[],
  args: Record<string, unknown>,
): { tokens: string[]; consumedKeys: Set<string> } {
  const consumedKeys = new Set<string>();
  const tokens = template.map((token) => {
    if (typeof token !== "string") {
      return token;
    }
    return token.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key: string) => {
      if (!allowedArgs.includes(key)) {
        throw new Error(`Bridge template 使用了未声明的结构化参数占位符: ${key}`);
      }
      const value = args[key];
      const normalized = normalizeOptionalString(value);
      if (!normalized) {
        throw new Error(`Bridge 参数 ${key} 必须是非空字符串。`);
      }
      consumedKeys.add(key);
      return normalized;
    });
  });
  return { tokens, consumedKeys };
}

function quoteCommandToken(token: string): string {
  if (token.length === 0) return "\"\"";
  if (!/[\s"'&|;<>]/.test(token)) return token;
  return `"${token.replace(/(["\\])/g, "\\$1")}"`;
}

export function serializeCommandTokens(tokens: string[]): string {
  return tokens.map(quoteCommandToken).join(" ").trim();
}

export function resolveBridgeWorkingDirectory(
  target: BridgeTargetConfig,
  requestedCwd: unknown,
  context: Pick<ToolContext, "workspaceRoot" | "extraWorkspaceRoots" | "defaultCwd" | "launchSpec">,
): string | undefined {
  const scope = resolveRuntimeFilesystemScope(context);
  const requested = normalizeOptionalString(requestedCwd);
  const fallback = target.cwdPolicy === "target-default"
    ? normalizeOptionalString(target.defaultCwd) ?? normalizeOptionalString(context.defaultCwd)
    : normalizeOptionalString(requested) ?? normalizeOptionalString(context.defaultCwd);
  const cwdInput = requested ?? fallback;
  if (!cwdInput) {
    return undefined;
  }

  const resolved = isAbsoluteLike(cwdInput)
    ? path.resolve(cwdInput)
    : path.resolve(scope.workspaceRoot, cwdInput);

  if (!isUnderAllowedRoots(resolved, scope.workspaceRoot, scope.extraWorkspaceRoots)) {
    throw new Error(`Bridge cwd 越界: ${cwdInput}`);
  }

  return resolved;
}

function resolvePathWithLocation(args: Record<string, unknown>): string | undefined {
  const rawPath = normalizeOptionalString(args.path);
  if (!rawPath && (args.line !== undefined || args.column !== undefined)) {
    throw new Error("Bridge 参数 line/column 需要同时提供 path。");
  }
  if (!rawPath) return undefined;
  const rawLine = normalizeNumberish(args.line);
  const rawColumn = normalizeNumberish(args.column);
  if (!rawLine) return rawPath;
  if (!rawColumn) return `${rawPath}:${rawLine}`;
  return `${rawPath}:${rawLine}:${rawColumn}`;
}

export function validateBridgeStructuredArgs(
  action: BridgeActionConfig,
  rawArgs: unknown,
): Record<string, unknown> {
  if (rawArgs == null) return {};
  if (!rawArgs || typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
    throw new Error("bridge_run.args 必须是对象。");
  }

  const args = rawArgs as Record<string, unknown>;
  const allowed = new Set(action.allowStructuredArgs ?? []);
  const keys = Object.keys(args);
  for (const key of keys) {
    if (!allowed.has(key)) {
      throw new Error(`Bridge action 不允许结构化参数: ${key}`);
    }
  }

  if ((args.line !== undefined || args.column !== undefined) && !allowed.has("path")) {
    throw new Error("Bridge action 未声明 path，但收到了 line/column。");
  }

  return args;
}

export function buildBridgeCommandTokens(
  target: BridgeTargetConfig,
  actionName: string,
  rawArgs: unknown,
): {
  action: BridgeActionConfig;
  tokens: string[];
  commandPreview: string;
} {
  if (!target.enabled) {
    throw new Error(`Bridge target "${target.id}" 未启用。`);
  }
  if (target.transport !== "exec") {
    throw new Error(`Bridge target "${target.id}" 不是 exec transport，当前为 ${target.transport}。`);
  }
  if (!target.entry.binary) {
    throw new Error(`Bridge target "${target.id}" 缺少 entry.binary。`);
  }

  const action = target.actions[actionName];
  if (!action) {
    throw new Error(`Bridge target "${target.id}" 不存在 action "${actionName}"。`);
  }

  const args = validateBridgeStructuredArgs(action, rawArgs);
  const allowed = action.allowStructuredArgs ?? [];
  const renderedTemplate = replaceTemplatePlaceholders(action.template, allowed, args);
  const tokens = [target.entry.binary, ...renderedTemplate.tokens];

  const pathWithLocation = allowed.includes("path") ? resolvePathWithLocation(args) : undefined;
  for (const key of allowed) {
    if (renderedTemplate.consumedKeys.has(key)) {
      continue;
    }
    if (key === "line" || key === "column") continue;
    if (key === "path" && pathWithLocation) {
      tokens.push(pathWithLocation);
      continue;
    }
    const value = args[key];
    if (value == null) continue;

    if (POSITIONAL_STRUCTURED_ARGS.has(key)) {
      const normalized = normalizeOptionalString(value);
      if (!normalized) {
        throw new Error(`Bridge 参数 ${key} 必须是非空字符串。`);
      }
      tokens.push(normalized);
      continue;
    }

    if (RESERVED_PATH_SUFFIX_KEYS.has(key)) {
      continue;
    }

    const boolValue = normalizeBoolean(value);
    if (boolValue === true) {
      tokens.push(`--${toKebabCase(key)}`);
      continue;
    }
    if (boolValue === false) {
      continue;
    }

    const normalized = normalizeNumberish(value);
    if (!normalized) {
      throw new Error(`Bridge 参数 ${key} 必须是字符串、数字或布尔值。`);
    }
    tokens.push(`--${toKebabCase(key)}`, normalized);
  }

  return {
    action,
    tokens,
    commandPreview: serializeCommandTokens(tokens),
  };
}

export function resolveBridgeTimeoutMs(
  target: BridgeTargetConfig,
  requestedTimeoutMs: unknown,
  context: Pick<ToolContext, "policy">,
): number | undefined {
  const requested = typeof requestedTimeoutMs === "number" && Number.isFinite(requestedTimeoutMs)
    ? Math.trunc(requestedTimeoutMs)
    : undefined;
  const fallback = target.defaultTimeoutMs;
  const raw = requested && requested > 0 ? requested : fallback;
  if (!raw || raw <= 0) return undefined;
  return Math.min(raw, context.policy.maxTimeoutMs);
}

function truncateTextByBytes(input: string, maxBytes: number): { value: string; truncated: boolean; bytes: number } {
  const buffer = Buffer.from(input, "utf-8");
  if (buffer.length <= maxBytes) {
    return {
      value: input,
      truncated: false,
      bytes: buffer.length,
    };
  }

  return {
    value: buffer.subarray(0, maxBytes).toString("utf-8"),
    truncated: true,
    bytes: buffer.length,
  };
}

export function clampBridgeOutput(
  target: BridgeTargetConfig,
  stdout: string,
  stderr: string,
  context: Pick<ToolContext, "policy">,
): {
  stdout: { value: string; truncated: boolean; bytes: number };
  stderr: { value: string; truncated: boolean; bytes: number };
} {
  const maxBytes = target.maxOutputBytes ?? context.policy.maxResponseBytes;
  return {
    stdout: truncateTextByBytes(stdout, maxBytes),
    stderr: truncateTextByBytes(stderr, maxBytes),
  };
}
