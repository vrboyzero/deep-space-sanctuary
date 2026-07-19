import crypto from "node:crypto";
import fs, { type FileHandle } from "node:fs/promises";
import path from "node:path";

import { raceWithAbort, throwIfAborted } from "../abort-utils.js";

const RESPONSE_PREFIX_BYTES = 16;

export class BoundedResponseLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoundedResponseLimitError";
  }
}

export type BoundedResponseFileSummary = {
  byteLength: number;
  sha256: string;
  prefix: Buffer;
  contentType: string | null;
  declaredContentLength: number | null;
};

export type BoundedResponseFileResult = BoundedResponseFileSummary & {
  filePath: string;
};

export function parsePositiveByteLimit(value: string | undefined, fallback: number): number {
  const parsed = Number(value?.trim());
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export async function persistBoundedResponseToFile(input: {
  response: Pick<Response, "body" | "headers">;
  targetPath: string;
  maxBytes: number;
  label: string;
  abortSignal?: AbortSignal;
  overwrite?: boolean;
  validate?: (summary: BoundedResponseFileSummary) => void | Promise<void>;
  resolveTargetPath?: (summary: BoundedResponseFileSummary) => string;
}): Promise<BoundedResponseFileResult> {
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes <= 0) {
    throw new Error(`${input.label} byte limit must be a positive safe integer.`);
  }
  throwIfAborted(input.abortSignal);

  const body = input.response.body;
  if (!body) {
    throw new Error(`${input.label} response has no readable body.`);
  }

  let declaredContentLength: number | null;
  try {
    declaredContentLength = parseContentLength(input.response.headers.get("content-length"), input.label);
    if (declaredContentLength !== null && declaredContentLength > input.maxBytes) {
      throw new BoundedResponseLimitError(
        `${input.label} exceeds the ${input.maxBytes} byte limit (Content-Length: ${declaredContentLength}).`,
      );
    }
  } catch (error) {
    await cancelBody(body, error);
    throw error;
  }

  const provisionalPath = path.resolve(input.targetPath);
  const targetDir = path.dirname(provisionalPath);
  const stagingPath = path.join(
    targetDir,
    `.${path.basename(provisionalPath)}.part-${crypto.randomUUID()}`,
  );
  const reader = body.getReader();
  let fileHandle: FileHandle | undefined;
  let stagingOwned = true;
  let readerCompleted = false;

  try {
    await fs.mkdir(targetDir, { recursive: true });
    throwIfAborted(input.abortSignal);
    fileHandle = await fs.open(stagingPath, "wx", 0o600);
    const hash = crypto.createHash("sha256");
    let byteLength = 0;
    let prefix = Buffer.alloc(0);

    while (true) {
      throwIfAborted(input.abortSignal);
      const next = await raceWithAbort(reader.read(), input.abortSignal);
      if (next.done) {
        readerCompleted = true;
        break;
      }

      const chunk = Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength);
      byteLength += chunk.length;
      if (byteLength > input.maxBytes) {
        throw new BoundedResponseLimitError(
          `${input.label} exceeds the ${input.maxBytes} byte limit while streaming (${byteLength} bytes observed).`,
        );
      }

      if (prefix.length < RESPONSE_PREFIX_BYTES) {
        const remaining = RESPONSE_PREFIX_BYTES - prefix.length;
        prefix = Buffer.concat([prefix, chunk.subarray(0, remaining)]);
      }
      hash.update(chunk);
      await writeAll(fileHandle, chunk);
    }

    const summary: BoundedResponseFileSummary = {
      byteLength,
      sha256: hash.digest("hex"),
      prefix,
      contentType: input.response.headers.get("content-type"),
      declaredContentLength,
    };
    await input.validate?.(summary);
    throwIfAborted(input.abortSignal);
    await fileHandle.sync();
    await fileHandle.close();
    fileHandle = undefined;
    throwIfAborted(input.abortSignal);

    const finalPath = resolveFinalPath({
      provisionalPath,
      targetDir,
      resolvedPath: input.resolveTargetPath?.(summary),
    });
    await commitStagingFile(stagingPath, finalPath, input.overwrite === true);
    stagingOwned = false;

    return {
      ...summary,
      filePath: finalPath,
    };
  } catch (error) {
    if (!readerCompleted) {
      try {
        await reader.cancel(error);
      } catch {
      }
    }
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
    }
    if (fileHandle) {
      try {
        await fileHandle.close();
      } catch {
      }
    }
    if (stagingOwned) {
      await fs.rm(stagingPath, { force: true });
    }
  }
}

function parseContentLength(rawValue: string | null, label: string): number | null {
  if (rawValue === null) {
    return null;
  }
  const normalized = rawValue.trim();
  if (!/^\d+$/u.test(normalized)) {
    throw new Error(`${label} response has an invalid Content-Length header.`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} response Content-Length is outside the safe integer range.`);
  }
  return parsed;
}

async function cancelBody(body: ReadableStream<Uint8Array>, reason: unknown): Promise<void> {
  try {
    await body.cancel(reason);
  } catch {
  }
}

async function writeAll(fileHandle: FileHandle, chunk: Buffer): Promise<void> {
  let offset = 0;
  while (offset < chunk.length) {
    const { bytesWritten } = await fileHandle.write(chunk, offset, chunk.length - offset, null);
    if (bytesWritten <= 0) {
      throw new Error("Unable to make progress while writing the response staging file.");
    }
    offset += bytesWritten;
  }
}

function resolveFinalPath(input: {
  provisionalPath: string;
  targetDir: string;
  resolvedPath?: string;
}): string {
  const finalPath = path.resolve(input.resolvedPath ?? input.provisionalPath);
  if (path.dirname(finalPath) !== input.targetDir) {
    throw new Error("Resolved response target must stay in the staging directory.");
  }
  return finalPath;
}

async function commitStagingFile(stagingPath: string, targetPath: string, overwrite: boolean): Promise<void> {
  if (overwrite) {
    await fs.rename(stagingPath, targetPath);
    return;
  }

  try {
    // 同目录 hard link 让“不覆盖”提交只有完整文件或无文件两种可观察状态。
    await fs.link(stagingPath, targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Target file already exists: ${targetPath}`);
    }
    throw error;
  }
  await fs.unlink(stagingPath);
}
