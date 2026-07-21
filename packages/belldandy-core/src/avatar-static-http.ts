import { constants, type Stats } from "node:fs";
import fs, { type FileHandle } from "node:fs/promises";

import { FilesystemCapability } from "@belldandy/protocol";
import type { NextFunction, Request, RequestHandler, Response } from "express";

export type AvatarStaticHttpHandlerTestHooks = {
  beforeRevalidate?: () => void | Promise<void>;
};

export type AvatarStaticHttpHandlerOptions = {
  avatarDir: string;
  testHooks?: AvatarStaticHttpHandlerTestHooks;
};

type OpenedAvatar = {
  fileHandle: FileHandle;
  filePath: string;
  stat: Stats;
};

type ByteRange = {
  start: number;
  end: number;
};

function resolveAvatarRelativePath(requestPath: string): string | null {
  const encodedRelativePath = requestPath.startsWith("/") ? requestPath.slice(1) : requestPath;
  if (!encodedRelativePath) return null;

  try {
    const relativePath = decodeURIComponent(encodedRelativePath);
    // 与 express.static 的默认 dotfiles=ignore 保持一致，避免公开内部 marker 或临时文件。
    if (relativePath.split("/").some((segment) => segment.startsWith("."))) {
      return null;
    }
    return relativePath;
  } catch {
    return null;
  }
}

function isSameFileIdentity(openedStat: Stats, currentStat: Stats): boolean {
  if (openedStat.dev !== 0 || openedStat.ino !== 0 || currentStat.dev !== 0 || currentStat.ino !== 0) {
    return openedStat.dev === currentStat.dev && openedStat.ino === currentStat.ino;
  }

  // 某些 Windows 文件系统不提供稳定 ino；此时用不会触发正文读取的 metadata 组合缩小替换窗口。
  return openedStat.size === currentStat.size
    && openedStat.mtimeMs === currentStat.mtimeMs
    && openedStat.ctimeMs === currentStat.ctimeMs;
}

async function openAvatar(
  capability: FilesystemCapability,
  relativePath: string,
  testHooks: AvatarStaticHttpHandlerTestHooks | undefined,
): Promise<OpenedAvatar> {
  const canonicalTargetPath = capability.resolveExistingRelative(relativePath);
  const openFlags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
  const fileHandle = await fs.open(canonicalTargetPath, openFlags);

  try {
    const openedStat = await fileHandle.stat();
    if (!openedStat.isFile()) {
      throw new Error("Avatar target is not a regular file.");
    }

    // 测试 seam 只用于固定替换窗口；生产路径没有 hook，仍在同一已打开句柄上完成重验和发送。
    await testHooks?.beforeRevalidate?.();

    // 打开后再次验证当前路径及文件身份；后续正文只从该句柄读取，不再按路径重开。
    const revalidatedTargetPath = capability.resolveExistingPath(canonicalTargetPath);
    const currentStat = await fs.stat(revalidatedTargetPath);
    if (!currentStat.isFile() || !isSameFileIdentity(openedStat, currentStat)) {
      throw new Error("Avatar target changed during admission.");
    }

    return {
      fileHandle,
      filePath: revalidatedTargetPath,
      stat: openedStat,
    };
  } catch (error) {
    await fileHandle.close().catch(() => {});
    throw error;
  }
}

function createWeakEntityTag(stat: Stats): string {
  return `W/"${stat.size.toString(16)}-${stat.mtime.getTime().toString(16)}"`;
}

function parseEtagList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function etagMatches(candidate: string, etag: string): boolean {
  return candidate === etag || candidate === `W/${etag}` || `W/${candidate}` === etag;
}

function hasFailedPrecondition(req: Request, etag: string, lastModified: string): boolean {
  const ifMatch = req.get("if-match");
  if (ifMatch && ifMatch !== "*" && parseEtagList(ifMatch).every((candidate) => !etagMatches(candidate, etag))) {
    return true;
  }

  const ifUnmodifiedSince = Date.parse(req.get("if-unmodified-since") ?? "");
  return Number.isFinite(ifUnmodifiedSince) && Date.parse(lastModified) > ifUnmodifiedSince;
}

function isRangeFresh(req: Request, etag: string, lastModified: string): boolean {
  const ifRange = req.get("if-range");
  if (!ifRange) return true;
  if (ifRange.includes("\"")) return ifRange.includes(etag);

  const ifRangeTime = Date.parse(ifRange);
  return Number.isFinite(ifRangeTime) && Date.parse(lastModified) <= ifRangeTime;
}

function resolveByteRange(
  req: Request,
  size: number,
  etag: string,
  lastModified: string,
): ByteRange | "unsatisfiable" | null {
  const rangeHeader = req.get("range");
  if (!rangeHeader || !/^\s*bytes=/.test(rangeHeader) || !isRangeFresh(req, etag, lastModified)) {
    return null;
  }

  const ranges = req.range(size, { combine: true });
  if (ranges === -1) return "unsatisfiable";
  if (!ranges || ranges === -2 || ranges.length !== 1 || ranges.type !== "bytes") return null;
  return ranges[0] ?? null;
}

async function closeFileQuietly(fileHandle: FileHandle): Promise<void> {
  await fileHandle.close().catch(() => {});
}

async function sendOpenedAvatar(
  req: Request,
  res: Response,
  next: NextFunction,
  avatar: OpenedAvatar,
): Promise<void> {
  const { fileHandle, filePath, stat } = avatar;
  const etag = createWeakEntityTag(stat);
  const lastModified = stat.mtime.toUTCString();

  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "public, max-age=0");
  res.setHeader("Last-Modified", lastModified);
  res.setHeader("ETag", etag);
  res.type(filePath);

  if (hasFailedPrecondition(req, etag, lastModified)) {
    await closeFileQuietly(fileHandle);
    res.status(412).end();
    return;
  }

  if (req.fresh) {
    await closeFileQuietly(fileHandle);
    res.removeHeader("Content-Type");
    res.removeHeader("Content-Length");
    res.removeHeader("Content-Range");
    res.status(304).end();
    return;
  }

  const range = resolveByteRange(req, stat.size, etag, lastModified);
  if (range === "unsatisfiable") {
    await closeFileQuietly(fileHandle);
    res.setHeader("Content-Range", `bytes */${stat.size}`);
    res.status(416).end();
    return;
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? Math.max(0, stat.size - 1);
  const contentLength = range ? end - start + 1 : stat.size;
  if (range) {
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
  }
  res.setHeader("Content-Length", String(contentLength));

  if (req.method === "HEAD" || contentLength === 0) {
    await closeFileQuietly(fileHandle);
    res.end();
    return;
  }

  const stream = fileHandle.createReadStream({
    autoClose: true,
    start,
    end,
  });
  stream.once("error", (error) => {
    if (res.headersSent) {
      res.destroy(error);
    } else {
      next(error);
    }
  });
  res.once("close", () => stream.destroy());
  stream.pipe(res);
}

export function createAvatarStaticHttpHandler(options: AvatarStaticHttpHandlerOptions): RequestHandler {
  const capability = new FilesystemCapability({
    rootPath: options.avatarDir,
    label: "avatar",
  });

  return async (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }

    const relativePath = resolveAvatarRelativePath(req.path);
    if (!relativePath) {
      res.status(404).end();
      return;
    }

    let avatar: OpenedAvatar | null = null;
    try {
      avatar = await openAvatar(capability, relativePath, options.testHooks);
      await sendOpenedAvatar(req, res, next, avatar);
    } catch {
      if (avatar) {
        await closeFileQuietly(avatar.fileHandle);
      }
      // 路径畸形、目标缺失或 canonical 越界统一表现为不可见，且不 fall through 到其他静态目录。
      res.status(404).end();
    }
  };
}
