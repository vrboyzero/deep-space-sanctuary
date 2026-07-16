import fs from "node:fs";
import path from "node:path";

const WINDOWS_RESERVED_BASENAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export type FilesystemCapabilityOptions = {
  /** 已存在的能力根目录；构造时会 canonicalize，不能是不存在的未来目录。 */
  rootPath: string;
  /** 用于错误诊断，不参与授权决策。 */
  label?: string;
  /** 调用方可复用的单项字节上限；省略表示不在能力层限制大小。 */
  maxBytes?: number;
};

export type FilesystemCapabilityPathOptions = {
  /** 删除根目录本身必须由调用方显式选择，默认拒绝。 */
  allowRoot?: boolean;
};

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function realpathSync(targetPath: string): string {
  return typeof fs.realpathSync.native === "function"
    ? fs.realpathSync.native(targetPath)
    : fs.realpathSync(targetPath);
}

function normalizePathForComparison(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const normalizedTarget = normalizePathForComparison(targetPath);
  const normalizedRoot = normalizePathForComparison(rootPath);
  const relativePath = path.relative(normalizedRoot, normalizedTarget);
  return relativePath === ""
    || (relativePath !== ".."
      && !relativePath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativePath));
}

function isSamePath(left: string, right: string): boolean {
  return normalizePathForComparison(left) === normalizePathForComparison(right);
}

/**
 * 仅接受跨平台可移植的相对路径。调用方如需接受原生绝对路径，必须改用 capability 的绝对路径 API，
 * 由其完成 root containment 与真实路径检查。
 */
export function assertSafeFilesystemRelativePath(relativePath: string, label = "path"): string {
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    throw new Error(`Unsafe relative path for ${label}: path is empty.`);
  }
  if (relativePath.includes("\0")
    || path.posix.isAbsolute(relativePath)
    || path.win32.isAbsolute(relativePath)
    || relativePath.includes("\\")) {
    throw new Error(`Unsafe relative path for ${label}: ${relativePath}`);
  }

  const segments = relativePath.split("/");
  if (segments.some((segment) => (
    !segment
    || segment === "."
    || segment === ".."
    || segment.endsWith(".")
    || segment.endsWith(" ")
    || WINDOWS_RESERVED_BASENAME.test(segment)
  ))) {
    throw new Error(`Unsafe relative path for ${label}: ${relativePath}`);
  }

  return segments.join("/");
}

/** 外部文件名只能作为单个 basename 使用，不能携带目录语义。 */
export function assertSafeFilesystemBasename(fileName: string, label = "file name"): string {
  let safeRelativePath: string;
  try {
    safeRelativePath = assertSafeFilesystemRelativePath(fileName, label);
  } catch {
    throw new Error(`Unsafe basename for ${label}: ${fileName}`);
  }
  if (safeRelativePath.includes("/")) {
    throw new Error(`Unsafe basename for ${label}: ${fileName}`);
  }
  return safeRelativePath;
}

/**
 * 一个能力实例只代表一个已经 canonicalize 的 root。领域模块负责决定哪些 root 能被创建，
 * 本模块只确保给定 root 内的读、写、删除不会因为链接或词法路径逃逸。
 */
export class FilesystemCapability {
  readonly configuredRootPath: string;
  readonly rootPath: string;
  readonly label: string;
  readonly maxBytes?: number;

  constructor(options: FilesystemCapabilityOptions) {
    if (!options.rootPath?.trim()) {
      throw new Error("Filesystem capability root path is required.");
    }
    if (options.maxBytes !== undefined && (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0)) {
      throw new Error(`Filesystem capability maxBytes must be a non-negative safe integer: ${options.maxBytes}`);
    }

    this.configuredRootPath = path.resolve(options.rootPath);
    const rootStat = fs.statSync(this.configuredRootPath);
    if (!rootStat.isDirectory()) {
      throw new Error(`Filesystem capability root is not a directory: ${this.configuredRootPath}`);
    }
    this.rootPath = realpathSync(this.configuredRootPath);
    this.label = options.label?.trim() || "filesystem capability";
    this.maxBytes = options.maxBytes;
  }

  resolveExistingRelative(relativePath: string, label = this.label): string {
    return this.resolveExistingPath(this.resolveRelativePath(relativePath, label), label);
  }

  resolveForWriteRelative(relativePath: string, label = this.label): string {
    return this.resolveForWritePath(this.resolveRelativePath(relativePath, label), label);
  }

  resolveForRemovalRelative(
    relativePath: string,
    label = this.label,
    options?: FilesystemCapabilityPathOptions,
  ): string {
    return this.resolveForRemovalPath(this.resolveRelativePath(relativePath, label), label, options);
  }

  resolveExistingPath(targetPath: string, label = this.label): string {
    const resolvedPath = this.assertLexicallyContained(targetPath, label);
    const canonicalPath = realpathSync(resolvedPath);
    this.assertCanonicalContainment(canonicalPath, label);
    return canonicalPath;
  }

  resolveForWritePath(targetPath: string, label = this.label): string {
    const resolvedPath = this.assertLexicallyContained(targetPath, label);
    try {
      fs.lstatSync(resolvedPath);
      return this.resolveExistingPath(resolvedPath, label);
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }

    const { canonicalParentPath, pendingSegments } = this.resolveNearestExistingParent(resolvedPath, label);
    const canonicalTargetPath = path.join(canonicalParentPath, ...pendingSegments);
    this.assertCanonicalContainment(canonicalTargetPath, label);
    return canonicalTargetPath;
  }

  resolveForRemovalPath(
    targetPath: string,
    label = this.label,
    options: FilesystemCapabilityPathOptions = {},
  ): string {
    const resolvedPath = this.assertLexicallyContained(targetPath, label);
    try {
      const stat = fs.lstatSync(resolvedPath);
      if (stat.isSymbolicLink()) {
        // 删除链接本身不会跟随目标；仍要求有效链接的真实目标在 root 内，损坏链接是唯一例外。
        try {
          this.assertCanonicalContainment(realpathSync(resolvedPath), label);
        } catch (error) {
          if (!isNotFound(error)) {
            throw error;
          }
        }
        const { canonicalParentPath } = this.resolveNearestExistingParent(path.dirname(resolvedPath), label);
        const linkPath = path.join(canonicalParentPath, path.basename(resolvedPath));
        this.assertCanonicalContainment(linkPath, label);
        this.assertRootRemovalAllowed(linkPath, options, label);
        return linkPath;
      }

      const canonicalPath = realpathSync(resolvedPath);
      this.assertCanonicalContainment(canonicalPath, label);
      this.assertRootRemovalAllowed(canonicalPath, options, label);
      return canonicalPath;
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }

    const canonicalTargetPath = this.resolveForWritePath(resolvedPath, label);
    this.assertRootRemovalAllowed(canonicalTargetPath, options, label);
    return canonicalTargetPath;
  }

  assertByteLength(byteLength: number, label = this.label): void {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
      throw new Error(`Invalid byte length for ${label}: ${byteLength}`);
    }
    if (this.maxBytes !== undefined && byteLength > this.maxBytes) {
      throw new Error(`${label} exceeds the ${this.maxBytes} byte limit: ${byteLength}`);
    }
  }

  private resolveRelativePath(relativePath: string, label: string): string {
    const safeRelativePath = assertSafeFilesystemRelativePath(relativePath, label);
    const resolvedPath = path.resolve(this.configuredRootPath, ...safeRelativePath.split("/"));
    return this.assertLexicallyContained(resolvedPath, label);
  }

  private assertLexicallyContained(targetPath: string, label: string): string {
    if (typeof targetPath !== "string" || !targetPath.trim() || !path.isAbsolute(targetPath)) {
      throw new Error(`Filesystem capability requires an absolute path for ${label}.`);
    }
    const resolvedPath = path.resolve(targetPath);
    if (!isPathInsideRoot(resolvedPath, this.configuredRootPath) && !isPathInsideRoot(resolvedPath, this.rootPath)) {
      throw new Error(`Path for ${label} is outside capability root: ${resolvedPath}`);
    }
    return resolvedPath;
  }

  private assertCanonicalContainment(canonicalPath: string, label: string): void {
    if (!isPathInsideRoot(canonicalPath, this.rootPath)) {
      throw new Error(`Path for ${label} resolves outside capability root: ${canonicalPath}`);
    }
  }

  private assertRootRemovalAllowed(
    targetPath: string,
    options: FilesystemCapabilityPathOptions,
    label: string,
  ): void {
    if (options.allowRoot || (!isSamePath(targetPath, this.rootPath) && !isSamePath(targetPath, this.configuredRootPath))) {
      return;
    }
    throw new Error(`Refusing to remove capability root for ${label}: ${targetPath}`);
  }

  private resolveNearestExistingParent(targetPath: string, label: string): {
    canonicalParentPath: string;
    pendingSegments: string[];
  } {
    let currentPath = targetPath;
    const pendingSegments: string[] = [];

    // 每次写入/删除前重新走到最近存在父目录，避免旧的 lexical 结果跨过后续被替换的链接目录。
    while (true) {
      try {
        fs.lstatSync(currentPath);
        const canonicalParentPath = realpathSync(currentPath);
        this.assertCanonicalContainment(canonicalParentPath, label);
        return { canonicalParentPath, pendingSegments };
      } catch (error) {
        if (!isNotFound(error)) {
          throw error;
        }
      }

      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        throw new Error(`Unable to find an existing parent inside capability root for ${label}: ${targetPath}`);
      }
      pendingSegments.unshift(path.basename(currentPath));
      currentPath = parentPath;
    }
  }
}
