import * as fs from "node:fs/promises";
import * as path from "node:path";

import { isAbortError, throwIfAborted } from "../abort-utils.js";
import { resolveRuntimeFilesystemScope } from "../runtime-policy.js";
import type { ToolCallResult, ToolContext } from "../types.js";

const MAX_GLOB_CHARS = 1_024;
const MAX_IGNORE_FILE_BYTES = 256 * 1024;

export type WorkspaceNavigationFile = {
  absolute: string;
  /** 相对于生效 workspace root 的标准化路径。 */
  path: string;
  /** 相对于调用方搜索根的标准化路径。 */
  relativeToRoot: string;
};

export type WorkspaceNavigationSkipCounts = {
  ignored: number;
  hidden: number;
  sensitive: number;
  policyDenied: number;
  excluded: number;
  notIncluded: number;
  symlink: number;
  unreadable: number;
};

export type WorkspaceNavigationRoot = {
  absolute: string;
  relative: string;
  effectiveRoot: string;
  realPath: string;
};

export type WorkspaceNavigationInventory = {
  root: WorkspaceNavigationRoot;
  files: WorkspaceNavigationFile[];
  skipped: WorkspaceNavigationSkipCounts;
  gitignoreFiles: number;
};

export type WorkspaceNavigationInput = {
  context: Pick<ToolContext, "workspaceRoot" | "extraWorkspaceRoots" | "defaultCwd" | "launchSpec" | "policy">;
  path?: string;
  include?: readonly string[];
  exclude?: readonly string[];
  includeHidden?: boolean;
  includeIgnored?: boolean;
  signal?: AbortSignal;
};

export type WorkspaceNavigationResult =
  | { ok: true; value: WorkspaceNavigationInventory }
  | { ok: false; error: string; failureKind: ToolCallResult["failureKind"] };

type ResolvedRoot = Omit<WorkspaceNavigationRoot, "realPath">;

type ValidatedWorkspaceRootResult =
  | { ok: true; value: WorkspaceNavigationRoot }
  | { ok: false; error: string; failureKind: ToolCallResult["failureKind"] };

type IgnoreRule = {
  basePath: string;
  negative: boolean;
  directoryOnly: boolean;
  pathPattern: RegExp;
  directPattern: RegExp;
};

/**
 * 受限工作区文件枚举的唯一 Interface。
 *
 * 调用方只提供 scope、筛选条件和可见性策略；路径解析、`.gitignore`、符号链接与策略处理
 * 都留在本模块的 Implementation 内，从而让搜索和 glob 共用同一套安全语义。
 */
export async function collectWorkspaceFiles(input: WorkspaceNavigationInput): Promise<WorkspaceNavigationResult> {
  const include = compileGlobPatterns(input.include ?? []);
  if (!include.ok) return include;
  const exclude = compileGlobPatterns(input.exclude ?? []);
  if (!exclude.ok) return exclude;

  const scope = resolveRuntimeFilesystemScope(input.context);
  const resolvedRoot = resolveWorkspaceRoot(input.path ?? ".", scope.workspaceRoot, scope.extraWorkspaceRoots);
  if (!resolvedRoot.ok) return resolvedRoot;

  try {
    throwIfAborted(input.signal);
    const validatedRoot = await validateWorkspaceRoot(resolvedRoot.value);
    if (!validatedRoot.ok) return validatedRoot;

    const skipped = createEmptySkipCounts();
    const ancestorRules = await readAncestorIgnoreRules({
      effectiveRoot: validatedRoot.value.effectiveRoot,
      searchRoot: validatedRoot.value.absolute,
      skipped,
      signal: input.signal,
    });
    const rootDecision = classifyPath({
      relativePath: validatedRoot.value.relative,
      isDirectory: true,
      policy: input.context.policy,
      includeHidden: input.includeHidden === true,
      includeIgnored: input.includeIgnored === true,
      ignoreRules: ancestorRules.rules,
    });
    if (rootDecision === "sensitive" || rootDecision === "policyDenied") {
      return { ok: false, error: "搜索根目录不允许访问", failureKind: "permission_or_policy" };
    }
    if (rootDecision) {
      skipped[rootDecision] += 1;
      return {
        ok: true,
        value: {
          root: validatedRoot.value,
          files: [],
          skipped,
          gitignoreFiles: ancestorRules.gitignoreFiles,
        },
      };
    }

    const files: WorkspaceNavigationFile[] = [];
    let gitignoreFiles = ancestorRules.gitignoreFiles;
    await visitDirectory({
      directory: validatedRoot.value.absolute,
      relativeToWorkspace: validatedRoot.value.relative,
      root: validatedRoot.value,
      policy: input.context.policy,
      include: include.value,
      exclude: exclude.value,
      includeHidden: input.includeHidden === true,
      includeIgnored: input.includeIgnored === true,
      inheritedIgnoreRules: ancestorRules.rules,
      files,
      skipped,
      onGitignoreLoaded: () => {
        gitignoreFiles += 1;
      },
      signal: input.signal,
    });

    files.sort((left, right) => compareWorkspacePaths(left.path, right.path));
    return {
      ok: true,
      value: {
        root: validatedRoot.value,
        files,
        skipped,
        gitignoreFiles,
      },
    };
  } catch (error) {
    if (isAbortError(error)) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { ok: false, error: "搜索根目录不存在", failureKind: "input_error" };
    }
    if (code === "EACCES") {
      return { ok: false, error: "无权访问搜索根目录", failureKind: "permission_or_policy" };
    }
    return { ok: false, error: safeErrorMessage(error), failureKind: "environment_error" };
  }
}

export function compareWorkspacePaths(left: string, right: string): number {
  const leftKey = `${left.toLowerCase()}\u0000${left}`;
  const rightKey = `${right.toLowerCase()}\u0000${right}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function resolveWorkspaceRoot(
  pathArg: string,
  workspaceRoot: string,
  extraWorkspaceRoots?: string[],
): { ok: true; value: ResolvedRoot } | { ok: false; error: string; failureKind: ToolCallResult["failureKind"] } {
  const normalizedArg = pathArg.replace(/\\/g, "/");
  const mainRoot = path.resolve(workspaceRoot);
  const absolute = path.isAbsolute(normalizedArg) || /^[A-Za-z]:/.test(pathArg)
    ? path.resolve(normalizedArg)
    : path.resolve(mainRoot, normalizedArg);

  const roots = [mainRoot, ...(extraWorkspaceRoots ?? []).map((root) => path.resolve(root))];
  for (const effectiveRoot of roots) {
    const relative = path.relative(effectiveRoot, absolute);
    if (!isRelativePathOutsideRoot(relative)) {
      return {
        ok: true,
        value: {
          absolute,
          relative: normalizeRelativePath(relative),
          effectiveRoot,
        },
      };
    }
  }
  return {
    ok: false,
    error: "路径越界：不允许搜索工作区外的目录",
    failureKind: "permission_or_policy",
  };
}

async function validateWorkspaceRoot(root: ResolvedRoot): Promise<ValidatedWorkspaceRootResult> {
  const rootStat = await fs.lstat(root.absolute);
  if (rootStat.isSymbolicLink()) {
    return { ok: false, error: "搜索根目录不能是符号链接", failureKind: "permission_or_policy" };
  }
  if (!rootStat.isDirectory()) {
    return { ok: false, error: "搜索路径不是目录", failureKind: "input_error" };
  }

  const [realEffectiveRoot, realSearchRoot] = await Promise.all([
    fs.realpath(root.effectiveRoot),
    fs.realpath(root.absolute),
  ]);
  if (isRelativePathOutsideRoot(path.relative(realEffectiveRoot, realSearchRoot))) {
    return { ok: false, error: "搜索路径经解析后越出工作区边界", failureKind: "permission_or_policy" };
  }
  return {
    ok: true,
    value: {
      ...root,
      realPath: normalizeFilesystemPath(realSearchRoot),
    },
  };
}

async function readAncestorIgnoreRules(input: {
  effectiveRoot: string;
  searchRoot: string;
  skipped: WorkspaceNavigationSkipCounts;
  signal?: AbortSignal;
}): Promise<{ rules: IgnoreRule[]; gitignoreFiles: number }> {
  const relative = normalizeRelativePath(path.relative(input.effectiveRoot, input.searchRoot));
  if (relative === ".") return { rules: [], gitignoreFiles: 0 };

  const parts = relative.split("/").filter(Boolean);
  let rules: IgnoreRule[] = [];
  let directory = input.effectiveRoot;
  let directoryRelative = ".";
  let gitignoreFiles = 0;
  for (const part of parts) {
    throwIfAborted(input.signal);
    const loaded = await readIgnoreRules(directory, directoryRelative, rules, input.skipped, input.signal);
    rules = loaded.rules;
    gitignoreFiles += loaded.loaded ? 1 : 0;
    directory = path.join(directory, part);
    directoryRelative = joinRelativePath(directoryRelative, part);
  }
  return { rules, gitignoreFiles };
}

async function visitDirectory(input: {
  directory: string;
  relativeToWorkspace: string;
  root: WorkspaceNavigationRoot;
  policy: ToolContext["policy"];
  include: RegExp[];
  exclude: RegExp[];
  includeHidden: boolean;
  includeIgnored: boolean;
  inheritedIgnoreRules: IgnoreRule[];
  files: WorkspaceNavigationFile[];
  skipped: WorkspaceNavigationSkipCounts;
  onGitignoreLoaded: () => void;
  signal?: AbortSignal;
}): Promise<void> {
  throwIfAborted(input.signal);
  try {
    const directoryStat = await fs.lstat(input.directory);
    if (directoryStat.isSymbolicLink()) {
      input.skipped.symlink += 1;
      return;
    }
    if (!directoryStat.isDirectory()) {
      input.skipped.unreadable += 1;
      return;
    }
  } catch (error) {
    if (isAbortError(error)) throw error;
    input.skipped.unreadable += 1;
    return;
  }

  const loaded = await readIgnoreRules(
    input.directory,
    input.relativeToWorkspace,
    input.inheritedIgnoreRules,
    input.skipped,
    input.signal,
  );
  if (loaded.loaded) input.onGitignoreLoaded();

  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean; isSymbolicLink: () => boolean }>;
  try {
    entries = await fs.readdir(input.directory, { withFileTypes: true });
  } catch (error) {
    if (isAbortError(error)) throw error;
    input.skipped.unreadable += 1;
    return;
  }
  entries.sort((left, right) => compareWorkspacePaths(left.name, right.name));

  for (const entry of entries) {
    throwIfAborted(input.signal);
    const relativePath = joinRelativePath(input.relativeToWorkspace, entry.name);
    if (entry.isSymbolicLink()) {
      input.skipped.symlink += 1;
      continue;
    }

    const isDirectory = entry.isDirectory();
    const decision = classifyPath({
      relativePath,
      isDirectory,
      policy: input.policy,
      includeHidden: input.includeHidden,
      includeIgnored: input.includeIgnored,
      ignoreRules: loaded.rules,
    });
    if (decision) {
      input.skipped[decision] += 1;
      continue;
    }

    const absolute = path.join(input.directory, entry.name);
    if (isDirectory) {
      await visitDirectory({
        ...input,
        directory: absolute,
        relativeToWorkspace: relativePath,
        inheritedIgnoreRules: loaded.rules,
      });
      continue;
    }
    if (!entry.isFile()) continue;

    const relativeToRoot = normalizeRelativePath(path.relative(input.root.absolute, absolute));
    if (input.include.length > 0 && !input.include.some((matcher) => matcher.test(relativeToRoot))) {
      input.skipped.notIncluded += 1;
      continue;
    }
    if (input.exclude.some((matcher) => matcher.test(relativeToRoot))) {
      input.skipped.excluded += 1;
      continue;
    }
    input.files.push({ absolute, path: relativePath, relativeToRoot });
  }
}

function compileGlobPatterns(patterns: readonly string[]):
  | { ok: true; value: RegExp[] }
  | { ok: false; error: string; failureKind: ToolCallResult["failureKind"] } {
  const compiled: RegExp[] = [];
  for (const rawPattern of patterns) {
    if (typeof rawPattern !== "string") {
      return { ok: false, error: "参数错误：glob 只能包含字符串", failureKind: "input_error" };
    }
    const pattern = normalizeGlobPattern(rawPattern);
    if (!pattern || pattern.length > MAX_GLOB_CHARS || pattern.includes("\0")) {
      return { ok: false, error: "参数错误：glob 为空、包含空字符或超过长度限制", failureKind: "input_error" };
    }
    try {
      compiled.push(new RegExp(`^${globToRegExpSource(pattern)}$`));
    } catch (error) {
      return { ok: false, error: `参数错误：无效的 glob：${safeErrorMessage(error)}`, failureKind: "input_error" };
    }
  }
  return { ok: true, value: compiled };
}

function createEmptySkipCounts(): WorkspaceNavigationSkipCounts {
  return {
    ignored: 0,
    hidden: 0,
    sensitive: 0,
    policyDenied: 0,
    excluded: 0,
    notIncluded: 0,
    symlink: 0,
    unreadable: 0,
  };
}

function classifyPath(input: {
  relativePath: string;
  isDirectory: boolean;
  policy: ToolContext["policy"];
  includeHidden: boolean;
  includeIgnored: boolean;
  ignoreRules: IgnoreRule[];
}): keyof WorkspaceNavigationSkipCounts | undefined {
  if (isPolicyDeniedPath(input.relativePath, input.policy.deniedPaths)) return "policyDenied";
  if (isSensitivePath(input.relativePath)) return "sensitive";
  if (!input.includeHidden && isHiddenPath(input.relativePath)) return "hidden";
  if (!input.includeIgnored && isIgnoredByRules(input.relativePath, input.isDirectory, input.ignoreRules)) return "ignored";
  return undefined;
}

function isPolicyDeniedPath(relativePath: string, deniedPaths: string[]): boolean {
  const normalizedPath = normalizeRelativePath(relativePath).toLowerCase();
  const pathSegments = normalizedPath.split("/").filter(Boolean);
  if (pathSegments.includes(".git")) return true;
  return deniedPaths.some((entry) => {
    const normalizedEntry = normalizeRelativePath(entry).replace(/\/+$/, "").toLowerCase();
    if (!normalizedEntry || normalizedEntry === ".") return false;
    if (normalizedEntry.includes("/")) {
      return normalizedPath === normalizedEntry || normalizedPath.startsWith(`${normalizedEntry}/`);
    }
    return pathSegments.includes(normalizedEntry);
  });
}

function isSensitivePath(relativePath: string): boolean {
  return normalizeRelativePath(relativePath)
    .toLowerCase()
    .split("/")
    .filter(Boolean)
    .some((segment) => (
      segment === ".env"
      || segment.startsWith(".env.")
      || segment === "credentials"
      || segment.startsWith("credentials.")
      || segment.includes("secret")
      || segment.endsWith(".key")
      || segment.endsWith(".pem")
      || segment.endsWith(".p12")
      || segment.endsWith(".pfx")
      || segment === "id_rsa"
      || segment === "id_ed25519"
      || segment === ".ssh"
      || segment === "password"
      || segment.startsWith("password.")
      || segment === "token"
      || segment.startsWith("token.")
    ));
}

function isHiddenPath(relativePath: string): boolean {
  return normalizeRelativePath(relativePath)
    .split("/")
    .filter(Boolean)
    .some((segment) => segment !== "." && segment !== ".." && segment.startsWith("."));
}

async function readIgnoreRules(
  directory: string,
  basePath: string,
  inheritedRules: IgnoreRule[],
  skipped: WorkspaceNavigationSkipCounts,
  signal?: AbortSignal,
): Promise<{ rules: IgnoreRule[]; loaded: boolean }> {
  throwIfAborted(signal);
  const ignorePath = path.join(directory, ".gitignore");
  try {
    const stat = await fs.lstat(ignorePath);
    if (stat.isSymbolicLink()) {
      skipped.symlink += 1;
      return { rules: inheritedRules, loaded: false };
    }
    if (!stat.isFile() || stat.size > MAX_IGNORE_FILE_BYTES) {
      if (stat.size > MAX_IGNORE_FILE_BYTES) skipped.unreadable += 1;
      return { rules: inheritedRules, loaded: false };
    }
    const content = await fs.readFile(ignorePath, "utf-8");
    return {
      rules: [...inheritedRules, ...parseIgnoreRules(content, basePath)],
      loaded: true,
    };
  } catch (error) {
    if (isAbortError(error)) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") skipped.unreadable += 1;
    return { rules: inheritedRules, loaded: false };
  }
}

function parseIgnoreRules(content: string, basePath: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const rawLine of content.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/)) {
    const parsed = parseIgnorePattern(rawLine);
    if (!parsed) continue;
    try {
      rules.push(createIgnoreRule(parsed, basePath));
    } catch {
      // 无效模式不应阻断工作区导航。
    }
  }
  return rules;
}

function parseIgnorePattern(rawLine: string): { pattern: string; negative: boolean; directoryOnly: boolean } | undefined {
  if (!rawLine || rawLine.startsWith("#")) return undefined;

  let line = rawLine;
  let escapedLeadingMarker = false;
  if (line.startsWith("\\#") || line.startsWith("\\!")) {
    line = line.slice(1);
    escapedLeadingMarker = true;
  }
  const negative = !escapedLeadingMarker && line.startsWith("!");
  if (negative) line = line.slice(1);
  if (!line) return undefined;

  while (line.endsWith(" ") && !line.endsWith("\\ ")) {
    line = line.slice(0, -1);
  }
  const directoryOnly = line.endsWith("/");
  const pattern = normalizeGlobPattern(directoryOnly ? line.slice(0, -1) : line).replace(/^\/+/, "");
  if (!pattern) return undefined;
  return { pattern, negative, directoryOnly };
}

function createIgnoreRule(
  input: { pattern: string; negative: boolean; directoryOnly: boolean },
  basePath: string,
): IgnoreRule {
  const source = globToRegExpSource(input.pattern);
  const hasSlash = input.pattern.includes("/");
  return {
    basePath: normalizeRelativePath(basePath),
    negative: input.negative,
    directoryOnly: input.directoryOnly,
    pathPattern: hasSlash
      ? new RegExp(`^${source}(?:/|$)`)
      : new RegExp(`(?:^|/)${source}(?:/|$)`),
    directPattern: hasSlash
      ? new RegExp(`^${source}$`)
      : new RegExp(`(?:^|/)${source}$`),
  };
}

function isIgnoredByRules(relativePath: string, isDirectory: boolean, rules: IgnoreRule[]): boolean {
  let ignored = false;
  for (const rule of rules) {
    const relativeToRule = getRelativeToIgnoreRule(relativePath, rule.basePath);
    if (relativeToRule === undefined || !rule.pathPattern.test(relativeToRule)) continue;
    if (rule.directoryOnly && rule.directPattern.test(relativeToRule) && !isDirectory) continue;
    ignored = !rule.negative;
  }
  return ignored;
}

function getRelativeToIgnoreRule(relativePath: string, basePath: string): string | undefined {
  const normalizedPath = normalizeRelativePath(relativePath);
  if (basePath === ".") return normalizedPath;
  if (normalizedPath === basePath) return "";
  const prefix = `${basePath}/`;
  return normalizedPath.startsWith(prefix) ? normalizedPath.slice(prefix.length) : undefined;
}

function globToRegExpSource(pattern: string): string {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        while (pattern[index + 1] === "*") index += 1;
        if (pattern[index + 1] === "/") {
          source += "(?:.*/)?";
          index += 1;
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (character === "?") {
      source += "[^/]";
      continue;
    }
    if (character === "[") {
      const end = pattern.indexOf("]", index + 1);
      if (end > index + 1) {
        const rawClass = pattern.slice(index + 1, end);
        const classBody = rawClass.startsWith("!") ? `^${rawClass.slice(1)}` : rawClass;
        source += `[${classBody}]`;
        index = end;
        continue;
      }
    }
    source += /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
  }
  return source;
}

function normalizeGlobPattern(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  return normalized || ".";
}

function normalizeFilesystemPath(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

function joinRelativePath(base: string, child: string): string {
  return base === "." ? child : `${base}/${child}`;
}

function isRelativePathOutsideRoot(relativePath: string): boolean {
  return relativePath === ".."
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath);
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 320);
}
