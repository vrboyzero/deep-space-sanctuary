import crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Tool, ToolCallResult, ToolContext } from "../types.js";
import { getGlobalMemoryManager } from "@belldandy/memory";
import { parseSkillMd } from "../skill-loader.js";
import { withToolContract } from "../tool-contract.js";
import { resolveRuntimeFilesystemScope } from "../runtime-policy.js";
import { buildFailureToolCallResult } from "../failure-kind.js";
import { resolvePrivilegedWorkspaceWriteChannels } from "./privileged-workspace-write-contract.js";

/** 敏感文件模式（禁止读取） */
const SENSITIVE_PATTERNS = [
  ".env",
  ".env.local",
  ".env.production",
  "credentials",
  "secret",
  ".key",
  ".pem",
  ".p12",
  ".pfx",
  "id_rsa",
  "id_ed25519",
  ".ssh",
  "password",
  "token",
];

/** 检查路径是否包含敏感文件模式 */
function isSensitivePath(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  return SENSITIVE_PATTERNS.some(p => lower.includes(p));
}

/** 受保护文件（禁止修改/删除） */
const PROTECTED_FILES: string[] = [];

function isProtectedFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  return PROTECTED_FILES.some(p => normalized === p || normalized.endsWith(`/${p}`));
}

function normalizeExtensions(values: string[] | undefined): string[] {
  if (!values || values.length === 0) return [];
  return values.map(v => v.trim().toLowerCase()).filter(Boolean);
}

function isDotFile(relativePath: string): boolean {
  const base = path.posix.basename(relativePath.replace(/\\/g, "/"));
  return base.startsWith(".");
}

function isExtensionAllowed(relativePath: string, allowedExtensions: string[]): boolean {
  if (allowedExtensions.length === 0) return true;
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  const base = path.posix.basename(normalized);
  const ext = path.posix.extname(base);

  return allowedExtensions.some((entry) => {
    if (!entry) return false;
    const needle = entry.startsWith(".") ? entry : `.${entry}`;
    if (entry.startsWith(".")) {
      return entry === ext || entry === base;
    }
    return needle === ext || entry === base || needle === base;
  });
}

/** 检查路径是否在黑名单中 */
function isDeniedPath(relativePath: string, deniedPaths: string[]): string | null {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  for (const denied of deniedPaths) {
    const deniedNorm = denied.replace(/\\/g, "/").toLowerCase();
    if (normalized.includes(deniedNorm)) {
      return denied;
    }
  }
  return null;
}

function isAllowedPath(relativePath: string, allowedPaths: string[]): boolean {
  if (allowedPaths.length === 0) return true;
  const normalizedRelative = relativePath.replace(/\\/g, "/").toLowerCase();
  return allowedPaths.some((entry) => {
    const normalizedAllowed = entry.replace(/\\/g, "/").toLowerCase();
    if (normalizedAllowed === ".") return true;
    return normalizedRelative.startsWith(normalizedAllowed + "/") ||
      normalizedRelative === normalizedAllowed;
  });
}

function isMemoryLinkWhitelistPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  return normalized === "memory.md" || normalized.startsWith("memory/");
}

function pathHasSegment(value: string, segment: string): boolean {
  return value
    .replace(/\\/g, "/")
    .toLowerCase()
    .split("/")
    .filter(Boolean)
    .includes(segment.toLowerCase());
}

function detectMethodUsagePath(relativePath: string, absolutePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, "/");
  const fileName = path.posix.basename(normalized);
  if (!fileName || !fileName.toLowerCase().endsWith(".md")) return null;
  if (pathHasSegment(normalized, "methods") || pathHasSegment(absolutePath, "methods")) {
    return fileName;
  }
  return null;
}

function detectSkillUsageName(relativePath: string, absolutePath: string, content: string): string | null {
  const normalized = relativePath.replace(/\\/g, "/");
  const fileName = path.posix.basename(normalized).toLowerCase();
  if (fileName !== "skill.md" && path.basename(absolutePath).toLowerCase() !== "skill.md") return null;

  try {
    const parsed = parseSkillMd(content, { type: "user", path: normalized });
    return parsed.name?.trim() || null;
  } catch {
    return null;
  }
}

function tryRecordExperienceUsageFromFileRead(
  relativePath: string,
  absolutePath: string,
  content: string,
  context: Pick<ToolContext, "conversationId" | "workspaceRoot"> & { agentId?: string },
) {
  try {
    const manager = getGlobalMemoryManager({
      agentId: context.agentId,
      conversationId: context.conversationId,
      workspaceRoot: context.workspaceRoot,
    });
    const task = manager?.getTaskByConversation(context.conversationId);
    if (!manager || !task) return;

    const methodFile = detectMethodUsagePath(relativePath, absolutePath);
    if (methodFile) {
      manager.recordMethodUsage(task.id, methodFile, { usedVia: "tool" });
      return;
    }

    const skillName = detectSkillUsageName(relativePath, absolutePath, content);
    if (skillName) {
      manager.recordSkillUsage(task.id, skillName, { usedVia: "tool" });
    }
  } catch {
    // usage 回写失败不影响 file_read 正常返回
  }
}

/** 检查路径是否在指定根目录下（不越界） */
function isUnderRoot(absolute: string, root: string): { ok: true; relative: string } | { ok: false } {
  const resolvedRoot = path.resolve(root);
  const rel = path.relative(resolvedRoot, absolute);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return { ok: false };
  return { ok: true, relative: rel.replace(/\\/g, "/") };
}

/** 规范化并验证路径在工作区内（主工作区或 extraWorkspaceRoots 中的任一根目录下） */
function resolveAndValidatePath(
  relativePath: string,
  workspaceRoot: string,
  extraWorkspaceRoots?: string[]
): { ok: true; absolute: string; relative: string; effectiveRoot: string } | { ok: false; error: string } {
  const trimmed = (relativePath || "").trim();
  if (!trimmed) {
    return { ok: false, error: "路径不能为空" };
  }

  const normalized = trimmed.replace(/\\/g, "/");
  const mainRoot = path.resolve(workspaceRoot);

  let absolute: string;
  if (path.isAbsolute(normalized) || (trimmed.length >= 2 && /^[A-Za-z]:/.test(trimmed))) {
    absolute = path.resolve(normalized);
  } else {
    absolute = path.resolve(mainRoot, normalized);
  }

  const underMain = isUnderRoot(absolute, mainRoot);
  if (underMain.ok) {
    return { ok: true, absolute, relative: underMain.relative, effectiveRoot: mainRoot };
  }
  if (extraWorkspaceRoots?.length) {
    for (const extra of extraWorkspaceRoots) {
      const effectiveRoot = path.resolve(extra);
      const underExtra = isUnderRoot(absolute, effectiveRoot);
      if (underExtra.ok) {
        return { ok: true, absolute, relative: underExtra.relative, effectiveRoot };
      }
    }
  }

  return { ok: false, error: "路径越界：不允许访问工作区外的文件" };
}

function resolveMutationWorkspaceRoot(
  absolute: string,
  scope: ReturnType<typeof resolveRuntimeFilesystemScope>,
): string {
  const roots = [scope.workspaceRoot, ...(scope.extraWorkspaceRoots ?? [])];
  for (const root of roots) {
    if (isUnderRoot(absolute, root).ok) return path.resolve(root);
  }
  throw new Error("Workspace mutation target is outside its resolved workspace root.");
}

async function prepareWorkspaceMutation(
  context: ToolContext,
  workspaceRoot: string,
  toolName: string,
  target: { absolute: string; relative: string },
): Promise<void> {
  if (!context.workspaceMutationObserver || !context.workspaceRevisionId) return;
  await context.workspaceMutationObserver.prepareMutations({
    workspaceRevisionId: context.workspaceRevisionId,
    workspaceRoot,
    toolName,
    targets: [{ absolutePath: target.absolute, relativePath: target.relative }],
  });
}

async function commitWorkspaceMutation(
  context: ToolContext,
  workspaceRoot: string,
  toolName: string,
  target: { absolute: string; relative: string },
): Promise<void> {
  if (!context.workspaceMutationObserver || !context.workspaceRevisionId) return;
  await context.workspaceMutationObserver.commitMutations({
    workspaceRevisionId: context.workspaceRevisionId,
    workspaceRoot,
    toolName,
    targets: [{ absolutePath: target.absolute, relativePath: target.relative }],
  });
}

const MAX_REGEX_REPLACE_PATTERN_LENGTH = 256;
const MAX_REGEX_REPLACE_TARGET_BYTES = 256_000;
const ALLOWED_REGEX_REPLACE_FLAGS = new Set(["d", "g", "i", "m", "s", "u", "v", "y"]);

function isEscapedAt(value: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && value[i] === "\\"; i -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function collectRegexGroupRanges(pattern: string): Array<{ start: number; end: number }> {
  const stack: number[] = [];
  const groups: Array<{ start: number; end: number }> = [];
  let inCharClass = false;

  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (!char || isEscapedAt(pattern, i)) continue;
    if (char === "[" && !inCharClass) {
      inCharClass = true;
      continue;
    }
    if (char === "]" && inCharClass) {
      inCharClass = false;
      continue;
    }
    if (inCharClass) continue;
    if (char === "(") {
      stack.push(i);
      continue;
    }
    if (char === ")") {
      const start = stack.pop();
      if (start !== undefined) {
        groups.push({ start, end: i });
      }
    }
  }

  return groups;
}

function readRegexTrailingQuantifierKind(
  pattern: string,
  index: number,
): "none" | "optional" | "repeated" {
  const char = pattern[index];
  if (!char) return "none";
  if (char === "+" || char === "*") return "repeated";
  if (char === "?") return "optional";
  if (char !== "{") return "none";

  const end = pattern.indexOf("}", index);
  if (end <= index + 1) return "none";
  const raw = pattern.slice(index + 1, end).trim();
  if (!/^\d+(,\d*)?$/.test(raw)) return "none";
  const [minPart, maxPart] = raw.split(",");
  const min = Number(minPart);
  const max = maxPart === undefined || maxPart === "" ? Number.POSITIVE_INFINITY : Number(maxPart);
  if (!Number.isFinite(min) || Number.isNaN(min) || Number.isNaN(max)) return "none";
  if (max <= 1) return "optional";
  return "repeated";
}

function repeatedGroupBodyHasRiskySignals(body: string): boolean {
  let inCharClass = false;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (!char || isEscapedAt(body, i)) continue;
    if (char === "[" && !inCharClass) {
      inCharClass = true;
      continue;
    }
    if (char === "]" && inCharClass) {
      inCharClass = false;
      continue;
    }
    if (inCharClass) continue;
    if (char === "(" || char === "|" || char === "." || char === "+" || char === "*" || char === "{" || char === "?") {
      return true;
    }
  }
  return false;
}

function detectRegexReplaceRisk(pattern: string, flags: string): string | null {
  if (pattern.length > MAX_REGEX_REPLACE_PATTERN_LENGTH) {
    return `regex 模式长度不能超过 ${MAX_REGEX_REPLACE_PATTERN_LENGTH} 个字符`;
  }
  if (flags.length > ALLOWED_REGEX_REPLACE_FLAGS.size) {
    return "regexFlags 过长";
  }

  const seenFlags = new Set<string>();
  for (const flag of flags) {
    if (!ALLOWED_REGEX_REPLACE_FLAGS.has(flag)) {
      return `regexFlags 包含不支持的标记：${flag}`;
    }
    if (seenFlags.has(flag)) {
      return `regexFlags 包含重复标记：${flag}`;
    }
    seenFlags.add(flag);
  }

  if (pattern.includes("(?<=") || pattern.includes("(?<!")) {
    return "regex 模式不允许使用 lookbehind";
  }
  if (/\\(?:[1-9]\d*|k<[^>]+>)/u.test(pattern)) {
    return "regex 模式不允许使用反向引用";
  }

  for (const group of collectRegexGroupRanges(pattern)) {
    const quantifierKind = readRegexTrailingQuantifierKind(pattern, group.end + 1);
    if (quantifierKind !== "repeated") continue;
    const body = pattern.slice(group.start + 1, group.end);
    if (repeatedGroupBodyHasRiskySignals(body)) {
      return "regex 模式包含高回溯风险结构";
    }
  }

  return null;
}

// ============ file_read 工具 ============

const DEFAULT_FILE_READ_MAX_BYTES = 100 * 1024;
const MAX_FILE_READ_BYTES = 1024 * 1024;
const MAX_FILE_READ_CURSOR_CHARS = 2_048;

type FileReadInput = {
  path: string;
  encoding: "utf-8" | "base64";
  limit: number;
  offset?: number;
  cursor?: string;
};

type FileReadCursor = {
  version: 1;
  fingerprint: string;
  offset: number;
};

function normalizeFileReadInput(args: Record<string, unknown>):
  | { ok: true; value: FileReadInput }
  | { ok: false; error: string } {
  const path = typeof args.path === "string" ? args.path.trim() : "";
  if (!path) return { ok: false, error: "参数错误：path 必须是非空字符串" };

  const encoding = args.encoding === undefined ? "utf-8" : args.encoding;
  if (encoding !== "utf-8" && encoding !== "base64") {
    return { ok: false, error: "参数错误：encoding 必须是 utf-8 或 base64" };
  }

  if (args.limit !== undefined && args.maxBytes !== undefined) {
    return { ok: false, error: "参数错误：limit 与 maxBytes 不能同时指定" };
  }
  const limit = normalizeFileReadLimit(args.limit, args.maxBytes);
  if (!limit.ok) return limit;

  const offset = args.offset === undefined ? undefined : args.offset;
  if (offset !== undefined && (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0)) {
    return { ok: false, error: "参数错误：offset 必须是非负安全整数" };
  }

  const cursor = args.cursor === undefined ? undefined : args.cursor;
  if (cursor !== undefined && (typeof cursor !== "string" || !cursor.trim() || cursor.length > MAX_FILE_READ_CURSOR_CHARS)) {
    return { ok: false, error: "参数错误：cursor 无效或过长" };
  }
  if (cursor !== undefined && offset !== undefined) {
    return { ok: false, error: "参数错误：cursor 与 offset 不能同时指定" };
  }

  return {
    ok: true,
    value: {
      path,
      encoding,
      limit: limit.value,
      ...(offset === undefined ? {} : { offset }),
      ...(typeof cursor === "string" ? { cursor: cursor.trim() } : {}),
    },
  };
}

function normalizeFileReadLimit(
  limit: unknown,
  legacyMaxBytes: unknown,
): { ok: true; value: number } | { ok: false; error: string } {
  if (limit !== undefined) {
    if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_FILE_READ_BYTES) {
      return { ok: false, error: `参数错误：limit 必须是 1 到 ${MAX_FILE_READ_BYTES} 的安全整数` };
    }
    return { ok: true, value: limit };
  }

  if (typeof legacyMaxBytes === "number" && Number.isFinite(legacyMaxBytes) && legacyMaxBytes > 0) {
    return { ok: true, value: Math.min(Math.floor(legacyMaxBytes), MAX_FILE_READ_BYTES) };
  }
  return { ok: true, value: DEFAULT_FILE_READ_MAX_BYTES };
}

function buildFileReadFingerprint(input: {
  realPath: string;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  encoding: FileReadInput["encoding"];
}): string {
  return crypto.createHash("sha256").update(JSON.stringify({
    version: 1,
    path: input.realPath.replace(/\\/g, "/").toLowerCase(),
    size: input.size,
    mtimeMs: input.mtimeMs,
    ctimeMs: input.ctimeMs,
    encoding: input.encoding,
  })).digest("hex").slice(0, 32);
}

function decodeFileReadCursor(
  value: string | undefined,
  fingerprint: string,
): { ok: true; value?: FileReadCursor } | { ok: false; error: string } {
  if (!value) return { ok: true };
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf-8")) as Partial<FileReadCursor>;
    const offset = parsed.offset;
    if (
      parsed.version !== 1
      || parsed.fingerprint !== fingerprint
      || typeof offset !== "number"
      || !Number.isSafeInteger(offset)
      || offset < 0
    ) {
      return { ok: false, error: "参数错误：cursor 与当前文件或读取条件不匹配" };
    }
    return { ok: true, value: { version: 1, fingerprint, offset } };
  } catch {
    return { ok: false, error: "参数错误：cursor 格式无效" };
  }
}

function encodeFileReadCursor(input: { fingerprint: string; offset: number }): string {
  return Buffer.from(JSON.stringify({
    version: 1,
    fingerprint: input.fingerprint,
    offset: input.offset,
  } satisfies FileReadCursor), "utf-8").toString("base64url");
}

export const fileReadTool: Tool = withToolContract({
  definition: {
    name: "file_read",
    description: "读取工作区内文件内容。支持 offset/limit 分段读取与稳定 cursor；路径必须在工作区范围内，禁止读取敏感文件（如 .env、密钥等）。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "相对于工作区根目录的文件路径",
        },
        encoding: {
          type: "string",
          description: "编码方式（默认 utf-8）",
          enum: ["utf-8", "base64"],
        },
        maxBytes: {
          type: "number",
          description: "兼容字段：最大读取字节数（默认 102400，即 100KB）；不能与 limit 同时指定",
        },
        offset: {
          type: "number",
          description: "读取起始字节偏移，默认 0；不能与 cursor 同时指定",
        },
        limit: {
          type: "number",
          description: "单段最大读取字节数，默认 102400，最大 1048576；不能与 maxBytes 同时指定",
        },
        cursor: {
          type: "string",
          description: "上一段返回的 nextCursor；仅可用于同一未变文件和相同 encoding",
        },
      },
      required: ["path"],
    },
  },

  async execute(args, context): Promise<ToolCallResult> {
    const start = Date.now();
    const id = crypto.randomUUID();
    const name = "file_read";

    const makeError = (error: string, failureKind?: ToolCallResult["failureKind"]): ToolCallResult => (
      buildFailureToolCallResult({
        id,
        name,
        start,
        error,
        ...(failureKind ? { failureKind } : {}),
      })
    );

    const input = normalizeFileReadInput(args);
    if (!input.ok) return makeError(input.error, "input_error");

    // 路径验证（主工作区或 extraWorkspaceRoots）
    const scope = resolveRuntimeFilesystemScope(context);
    const pathResult = resolveAndValidatePath(input.value.path, scope.workspaceRoot, scope.extraWorkspaceRoots);
    if (!pathResult.ok) {
      return makeError(pathResult.error);
    }

    const { absolute, relative, effectiveRoot } = pathResult;

    // 黑名单检查
    const denied = isDeniedPath(relative, context.policy.deniedPaths);
    if (denied) {
      return makeError(`禁止访问路径：${denied}`, "permission_or_policy");
    }

    // 敏感文件检查
    if (isSensitivePath(relative)) {
      return makeError("禁止读取敏感文件（如 .env、密钥、凭证等）", "permission_or_policy");
    }

    try {
      const stat = await fs.lstat(absolute);

      if (stat.isSymbolicLink()) {
        return makeError("禁止读取符号链接文件", "permission_or_policy");
      }
      if (!stat.isFile()) {
        return makeError(`路径不是文件：${relative}`);
      }

      const [realEffectiveRoot, realFile] = await Promise.all([
        fs.realpath(effectiveRoot),
        fs.realpath(absolute),
      ]);
      const realBoundary = isUnderRoot(realFile, realEffectiveRoot);
      if (!realBoundary.ok) {
        return makeError("文件经解析后越出工作区边界", "permission_or_policy");
      }
      const realDenied = isDeniedPath(realBoundary.relative, context.policy.deniedPaths);
      if (realDenied) {
        return makeError(`禁止访问路径：${realDenied}`, "permission_or_policy");
      }
      if (isSensitivePath(realBoundary.relative)) {
        return makeError("禁止读取敏感文件（如 .env、密钥、凭证等）", "permission_or_policy");
      }

      const fingerprint = buildFileReadFingerprint({
        realPath: realFile,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs,
        encoding: input.value.encoding,
      });
      const cursor = decodeFileReadCursor(input.value.cursor, fingerprint);
      if (!cursor.ok) return makeError(cursor.error, "input_error");
      const offset = cursor.value?.offset ?? input.value.offset ?? 0;
      if (offset > stat.size) {
        return makeError("参数错误：offset 超出文件大小", "input_error");
      }

      // 读取文件（限制大小）
      const handle = await fs.open(absolute, "r");
      try {
        const buffer = Buffer.alloc(Math.min(stat.size - offset, input.value.limit));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);

        let content: string;
        if (input.value.encoding === "base64") {
          content = buffer.subarray(0, bytesRead).toString("base64");
        } else {
          content = buffer.subarray(0, bytesRead).toString("utf-8");
        }

        const endOffset = offset + bytesRead;
        const truncated = endOffset < stat.size;
        const nextCursor = truncated
          ? encodeFileReadCursor({ fingerprint, offset: endOffset })
          : undefined;

        const manager = getGlobalMemoryManager({
          agentId: context.agentId,
          conversationId: context.conversationId,
          workspaceRoot: context.workspaceRoot,
        });
        const underMainRoot = isUnderRoot(absolute, context.workspaceRoot);
        if (manager) {
          if (underMainRoot.ok && isMemoryLinkWhitelistPath(relative)) {
            await manager.linkTaskMemoriesFromSource(context.conversationId, relative, "used");
          }
          tryRecordExperienceUsageFromFileRead(relative, absolute, content, context);
        }

        return {
          id,
          name,
          success: true,
          output: JSON.stringify({
            path: relative,
            size: stat.size,
            bytesRead,
            truncated,
            range: {
              offset,
              endOffset,
            },
            ...(nextCursor ? { nextCursor } : {}),
            encoding: input.value.encoding,
            content,
          }),
          durationMs: Date.now() - start,
        };
      } finally {
        await handle.close();
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return makeError(`文件不存在：${relative}`, "input_error");
      }
      if (code === "EACCES") {
        return makeError(`无权访问文件：${relative}`, "permission_or_policy");
      }
      return makeError(err instanceof Error ? err.message : String(err));
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
  activityDescription: "Read a file from the workspace or an allowed extra workspace root",
  resultSchema: {
    kind: "json",
    description: "File metadata and content payload encoded as JSON text.",
  },
  outputPersistencePolicy: "conversation",
});

// ============ file_write 工具 ============

export const fileWriteTool: Tool = withToolContract({
  definition: {
    name: "file_write",
    description: "写入工作区内文件。路径必须是相对于工作区根目录的相对路径。如果配置了写入白名单，则只能写入白名单内的目录。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "相对于工作区根目录的文件路径",
        },
        content: {
          type: "string",
          description: "要写入的内容",
        },
        encoding: {
          type: "string",
          description: "内容编码（默认 utf-8；允许 base64 以写入二进制）",
          enum: ["utf-8", "base64"],
        },
        mode: {
          type: "string",
          description: "写入模式（默认 overwrite）",
          enum: ["overwrite", "append", "replace", "insert"],
        },
        createDirs: {
          type: "boolean",
          description: "是否自动创建父目录（默认 true）",
        },
        startLine: {
          type: "number",
          description: "替换起始行（1-based，仅 mode=replace 时生效）",
        },
        endLine: {
          type: "number",
          description: "替换结束行（1-based，仅 mode=replace 时生效）",
        },
        regex: {
          type: "string",
          description: "正则表达式（仅 mode=replace 时生效）",
        },
        regexFlags: {
          type: "string",
          description: "正则标记（如 g, i, m，仅 mode=replace 时生效）",
        },
        line: {
          type: "number",
          description: "插入行号（1-based，仅 mode=insert 时生效）",
        },
        position: {
          type: "string",
          description: "插入位置（默认 before，仅 mode=insert 时生效）",
          enum: ["before", "after"],
        },
      },
      required: ["path", "content"],
    },
  },

  async execute(args, context): Promise<ToolCallResult> {
    const start = Date.now();
    const id = crypto.randomUUID();
    const name = "file_write";

    const makeError = (error: string, failureKind?: ToolCallResult["failureKind"]): ToolCallResult => (
      buildFailureToolCallResult({
        id,
        name,
        start,
        error,
        ...(failureKind ? { failureKind } : {}),
      })
    );

    // 参数校验
    const pathArg = args.path;
    if (typeof pathArg !== "string" || !pathArg.trim()) {
      return makeError("参数错误：path 必须是非空字符串", "input_error");
    }

    const content = args.content;
    if (typeof content !== "string") {
      return makeError("参数错误：content 必须是字符串", "input_error");
    }

    // 路径验证（主工作区或 extraWorkspaceRoots）
    const scope = resolveRuntimeFilesystemScope(context);
    const pathResult = resolveAndValidatePath(pathArg, scope.workspaceRoot, scope.extraWorkspaceRoots);
    if (!pathResult.ok) {
      return makeError(pathResult.error);
    }

    const { absolute, relative } = pathResult;
    const mutationWorkspaceRoot = resolveMutationWorkspaceRoot(absolute, scope);

    // 受保护文件（优先拦截）
    if (isProtectedFile(relative)) {
      return makeError("禁止修改 SOUL.md", "permission_or_policy");
    }

    // 黑名单检查
    const denied = isDeniedPath(relative, context.policy.deniedPaths);
    if (denied) {
      return makeError(`禁止写入路径：${denied}`, "permission_or_policy");
    }

    // 敏感文件检查（禁止写入敏感文件）
    if (isSensitivePath(relative)) {
      return makeError("禁止写入敏感文件路径", "permission_or_policy");
    }

    // 白名单检查（如果配置了白名单，则只能写入白名单内的目录）
    const { allowedPaths } = context.policy;
    if (!isAllowedPath(relative, allowedPaths)) {
        return makeError(`路径不在写入白名单中。允许的路径：${allowedPaths.join(", ")}`, "permission_or_policy");
    }

    const fileWritePolicy = context.policy.fileWrite ?? {};
    const allowDotFiles = fileWritePolicy.allowDotFiles !== false;
    const allowedExtensions = normalizeExtensions(fileWritePolicy.allowedExtensions);

    if (!allowDotFiles && isDotFile(relative)) {
      return makeError("禁止写入点文件", "permission_or_policy");
    }

    if (!isExtensionAllowed(relative, allowedExtensions)) {
      return makeError(`文件扩展名不在允许列表中：${allowedExtensions.join(", ")}`, "permission_or_policy");
    }

    const encoding = (args.encoding as "utf-8" | "base64") || "utf-8";
    if (encoding === "base64" && fileWritePolicy.allowBinary !== true) {
      return makeError("禁止写入二进制内容（base64）", "permission_or_policy");
    }

    // 写入文件
    const mode = (args.mode as "overwrite" | "append" | "replace" | "insert") || "overwrite";
    const createDirs = args.createDirs !== false; // 默认 true

    const applyExecutableBit = async (): Promise<void> => {
      const ext = path.posix.extname(relative.replace(/\\/g, "/")).toLowerCase();
      if (process.platform !== "win32" && ext === ".sh") {
        await fs.chmod(absolute, 0o755);
      }
    };

    const readExistingText = async (): Promise<{ text: string; newline: string }> => {
      const raw = await fs.readFile(absolute, "utf-8");
      const newline = raw.includes("\r\n") ? "\r\n" : "\n";
      return { text: raw, newline };
    };

    try {
      // 创建父目录
      if (createDirs) {
        await fs.mkdir(path.dirname(absolute), { recursive: true });
      }

      if (mode === "replace" || mode === "insert") {
        if (encoding !== "utf-8") {
          return makeError("replace/insert 仅支持 utf-8 编码");
        }
        const existingStat = await fs.stat(absolute).catch(() => null);
        if (!existingStat || !existingStat.isFile()) {
          return makeError(`文件不存在：${relative}`);
        }
        const { text, newline } = await readExistingText();
        const lines = text.split(/\r?\n/);

        if (mode === "replace") {
          const regex = args.regex as string | undefined;
          if (regex && regex.trim()) {
            const textBytes = Buffer.byteLength(text, "utf-8");
            if (textBytes > MAX_REGEX_REPLACE_TARGET_BYTES) {
              return makeError(
                `regex replace 已拒绝：目标文本过大（>${MAX_REGEX_REPLACE_TARGET_BYTES} bytes）`,
                "permission_or_policy",
              );
            }
            const flags = (args.regexFlags as string | undefined) ?? "g";
            const regexRisk = detectRegexReplaceRisk(regex, flags);
            if (regexRisk) {
              return makeError(
                `regex replace 已拒绝：${regexRisk}。请改用更简单的正则、缩小匹配范围，或改用行号替换。`,
                "permission_or_policy",
              );
            }
            let re: RegExp;
            try {
              re = new RegExp(regex, flags);
            } catch (error) {
              return makeError(
                `regex 无效：${error instanceof Error ? error.message : String(error)}`,
                "input_error",
              );
            }
            if (!re.test(text)) {
              return makeError("未匹配到正则内容，未做替换");
            }
            const next = text.replace(re, content);
            await prepareWorkspaceMutation(context, mutationWorkspaceRoot, name, { absolute, relative });
            await fs.writeFile(absolute, next, "utf-8");
          } else {
            const startLine = Number(args.startLine);
            const endLine = Number(args.endLine ?? args.startLine);
            if (!Number.isInteger(startLine) || startLine <= 0) {
              return makeError("startLine 必须是正整数");
            }
            if (!Number.isInteger(endLine) || endLine < startLine) {
              return makeError("endLine 必须 >= startLine");
            }
            const startIdx = startLine - 1;
            const endIdx = endLine - 1;
            if (startIdx >= lines.length || endIdx >= lines.length) {
              return makeError("行号越界");
            }
            const insertLines = content.split(/\r?\n/);
            lines.splice(startIdx, endIdx - startIdx + 1, ...insertLines);
            const next = lines.join(newline);
            await prepareWorkspaceMutation(context, mutationWorkspaceRoot, name, { absolute, relative });
            await fs.writeFile(absolute, next, "utf-8");
          }
        } else {
          const line = Number(args.line);
          const position = (args.position as "before" | "after" | undefined) ?? "before";
          if (!Number.isInteger(line) || line <= 0) {
            return makeError("line 必须是正整数");
          }
          const index = position === "after" ? line : line - 1;
          if (index < 0 || index > lines.length) {
            return makeError("插入行号越界");
          }
          const insertLines = content.split(/\r?\n/);
          lines.splice(index, 0, ...insertLines);
          const next = lines.join(newline);
          await prepareWorkspaceMutation(context, mutationWorkspaceRoot, name, { absolute, relative });
          await fs.writeFile(absolute, next, "utf-8");
        }

        await applyExecutableBit();

        await commitWorkspaceMutation(context, mutationWorkspaceRoot, name, { absolute, relative });
        const updatedStat = await fs.stat(absolute);
        return {
          id,
          name,
          success: true,
          output: JSON.stringify({
            path: relative,
            bytesWritten: Buffer.byteLength(content, "utf-8"),
            mode,
            encoding,
            totalSize: updatedStat.size,
          }),
          durationMs: Date.now() - start,
        };
      }

      const writeBuffer = encoding === "base64" ? Buffer.from(content, "base64") : null;
      await prepareWorkspaceMutation(context, mutationWorkspaceRoot, name, { absolute, relative });

      if (mode === "append") {
        if (writeBuffer) {
          await fs.appendFile(absolute, writeBuffer);
        } else {
          await fs.appendFile(absolute, content, "utf-8");
        }
      } else {
        if (writeBuffer) {
          await fs.writeFile(absolute, writeBuffer);
        } else {
          await fs.writeFile(absolute, content, "utf-8");
        }
      }

      await applyExecutableBit();

      await commitWorkspaceMutation(context, mutationWorkspaceRoot, name, { absolute, relative });
      const finalStat = await fs.stat(absolute);
      const bytesWritten = writeBuffer ? writeBuffer.length : Buffer.byteLength(content, "utf-8");

      return {
        id,
        name,
        success: true,
        output: JSON.stringify({
          path: relative,
          bytesWritten,
          mode,
          encoding,
          totalSize: finalStat.size,
        }),
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EACCES") {
        return makeError(`无权写入文件：${relative}`, "permission_or_policy");
      }
      if (code === "ENOENT" && !createDirs) {
        return makeError(`父目录不存在：${path.dirname(relative)}`, "input_error");
      }
      return makeError(err instanceof Error ? err.message : String(err));
    }
  },
}, {
  family: "workspace-write",
  isReadOnly: false,
  isConcurrencySafe: false,
  needsPermission: true,
  riskLevel: "high",
  channels: resolvePrivilegedWorkspaceWriteChannels(),
  safeScopes: ["privileged"],
  activityDescription: "Write or edit a file inside the workspace",
  resultSchema: {
    kind: "json",
    description: "Write outcome metadata encoded as JSON text.",
  },
  outputPersistencePolicy: "artifact",
});

// ============ file_delete 工具 ============

export const fileDeleteTool: Tool = withToolContract({
  definition: {
    name: "file_delete",
    description: "删除工作区内的文件。path 可为相对路径（如 BOOTSTRAP.md）或工作区内的绝对路径；禁止删除敏感文件（如 .env）。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "文件路径：相对工作区根（如 BOOTSTRAP.md）或工作区内的绝对路径",
        },
      },
      required: ["path"],
    },
  },

  async execute(args, context): Promise<ToolCallResult> {
    const start = Date.now();
    const id = crypto.randomUUID();
    const name = "file_delete";

    const makeError = (error: string, failureKind?: ToolCallResult["failureKind"]): ToolCallResult => (
      buildFailureToolCallResult({
        id,
        name,
        start,
        error,
        ...(failureKind ? { failureKind } : {}),
      })
    );

    // 参数校验
    const pathArg = args.path;
    if (typeof pathArg !== "string" || !pathArg.trim()) {
      return makeError("参数错误：path 必须是非空字符串", "input_error");
    }

    // 路径验证（主工作区或 extraWorkspaceRoots）
    const scope = resolveRuntimeFilesystemScope(context);
    const pathResult = resolveAndValidatePath(pathArg, scope.workspaceRoot, scope.extraWorkspaceRoots);
    if (!pathResult.ok) {
      return makeError(pathResult.error);
    }

    const { absolute, relative } = pathResult;
    const mutationWorkspaceRoot = resolveMutationWorkspaceRoot(absolute, scope);

    // 受保护文件（优先拦截）
    if (isProtectedFile(relative)) {
      return makeError("禁止删除 SOUL.md", "permission_or_policy");
    }

    // 黑名单检查
    const denied = isDeniedPath(relative, context.policy.deniedPaths);
    if (denied) {
      return makeError(`禁止删除路径：${denied}`, "permission_or_policy");
    }

    // 敏感文件检查
    if (isSensitivePath(relative)) {
      return makeError("禁止删除敏感文件", "permission_or_policy");
    }

    const { allowedPaths } = context.policy;
    if (!isAllowedPath(relative, allowedPaths)) {
      return makeError(`路径不在写入白名单中。允许的路径：${allowedPaths.join(", ")}`, "permission_or_policy");
    }

    try {
      await prepareWorkspaceMutation(context, mutationWorkspaceRoot, name, { absolute, relative });
      await fs.unlink(absolute);
      await commitWorkspaceMutation(context, mutationWorkspaceRoot, name, { absolute, relative });

      return {
        id,
        name,
        success: true,
        output: JSON.stringify({
          path: relative,
          status: "deleted",
        }),
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return makeError(`文件不存在：${relative}`, "input_error");
      }
      if (code === "EACCES" || code === "EPERM") {
        return makeError(`无权删除文件：${relative}`, "permission_or_policy");
      }
      return makeError(err instanceof Error ? err.message : String(err));
    }
  },
}, {
  family: "workspace-write",
  isReadOnly: false,
  isConcurrencySafe: false,
  needsPermission: true,
  riskLevel: "high",
  channels: resolvePrivilegedWorkspaceWriteChannels(),
  safeScopes: ["privileged"],
  activityDescription: "Delete a file from the workspace",
  resultSchema: {
    kind: "json",
    description: "Delete outcome metadata encoded as JSON text.",
  },
  outputPersistencePolicy: "artifact",
});
