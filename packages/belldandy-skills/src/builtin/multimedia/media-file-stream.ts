import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { throwIfAborted, toAbortError } from "../../abort-utils.js";

const FILE_STREAM_HIGH_WATER_MARK = 64 * 1024;

export class MediaFileLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaFileLimitError";
  }
}

type BoundedFileInfo = {
  filePath: string;
  size: number;
};

async function inspectBoundedFile(input: {
  filePath: string;
  maxBytes?: number;
  label: string;
  abortSignal?: AbortSignal;
}): Promise<BoundedFileInfo> {
  throwIfAborted(input.abortSignal);
  const filePath = path.resolve(input.filePath);
  const stat = await fs.stat(filePath);
  throwIfAborted(input.abortSignal);
  if (!stat.isFile()) {
    throw new Error(`Path is not a file: ${filePath}`);
  }
  if (typeof input.maxBytes === "number" && stat.size > input.maxBytes) {
    throw new MediaFileLimitError(`${input.label} too large (${stat.size} bytes > ${input.maxBytes} bytes).`);
  }
  return { filePath, size: stat.size };
}

async function* readFileChunks(input: {
  filePath: string;
  expectedBytes: number;
  maxBytes?: number;
  abortSignal?: AbortSignal;
}): AsyncGenerator<Buffer> {
  throwIfAborted(input.abortSignal);
  const stream = createReadStream(input.filePath, {
    highWaterMark: FILE_STREAM_HIGH_WATER_MARK,
  });
  const onAbort = () => stream.destroy(toAbortError(input.abortSignal?.reason));
  input.abortSignal?.addEventListener("abort", onAbort, { once: true });
  let observedBytes = 0;

  try {
    for await (const rawChunk of stream) {
      throwIfAborted(input.abortSignal);
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      observedBytes += chunk.length;
      if (typeof input.maxBytes === "number" && observedBytes > input.maxBytes) {
        throw new MediaFileLimitError(`File grew beyond the allowed ${input.maxBytes} byte limit while reading.`);
      }
      yield chunk;
    }
    if (observedBytes !== input.expectedBytes) {
      throw new Error(`File size changed while reading (${input.expectedBytes} bytes -> ${observedBytes} bytes).`);
    }
  } finally {
    input.abortSignal?.removeEventListener("abort", onAbort);
    stream.destroy();
  }
}

export async function createMediaFileSha256(input: {
  filePath: string;
  prefix?: string;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const file = await inspectBoundedFile({
    filePath: input.filePath,
    label: "Media file",
    abortSignal: input.abortSignal,
  });
  const hash = crypto.createHash("sha256");
  if (input.prefix) hash.update(input.prefix);
  for await (const chunk of readFileChunks({
    filePath: file.filePath,
    expectedBytes: file.size,
    abortSignal: input.abortSignal,
  })) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export async function readMediaFileAsBase64(input: {
  filePath: string;
  maxBytes: number;
  label: string;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const file = await inspectBoundedFile(input);
  let encoded = "";
  let remainder = Buffer.alloc(0);

  for await (const chunk of readFileChunks({
    filePath: file.filePath,
    expectedBytes: file.size,
    maxBytes: input.maxBytes,
    abortSignal: input.abortSignal,
  })) {
    const combined = remainder.length > 0 ? Buffer.concat([remainder, chunk]) : chunk;
    const completeBytes = combined.length - (combined.length % 3);
    if (completeBytes > 0) {
      encoded += combined.subarray(0, completeBytes).toString("base64");
    }
    remainder = completeBytes < combined.length
      ? Buffer.from(combined.subarray(completeBytes))
      : Buffer.alloc(0);
  }
  if (remainder.length > 0) {
    encoded += remainder.toString("base64");
  }
  return encoded;
}

export async function createMultipartFileUpload(input: {
  filePath: string;
  purpose: string;
  maxBytes: number;
  abortSignal?: AbortSignal;
}): Promise<{
  body: Readable;
  contentType: string;
  contentLength: number;
}> {
  const file = await inspectBoundedFile({
    filePath: input.filePath,
    maxBytes: input.maxBytes,
    label: "File",
    abortSignal: input.abortSignal,
  });
  const boundary = `----belldandy-${crypto.randomBytes(12).toString("hex")}`;
  const fileName = path.basename(file.filePath).replace(/[\r\n"\\]/gu, "_") || "upload.bin";
  const header = Buffer.from([
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${fileName}"`,
    "Content-Type: application/octet-stream",
    "",
    "",
  ].join("\r\n"), "utf-8");
  const footer = Buffer.from([
    "",
    `--${boundary}`,
    'Content-Disposition: form-data; name="purpose"',
    "",
    input.purpose,
    `--${boundary}--`,
    "",
  ].join("\r\n"), "utf-8");

  const chunks = async function* (): AsyncGenerator<Buffer> {
    yield header;
    for await (const chunk of readFileChunks({
      filePath: file.filePath,
      expectedBytes: file.size,
      maxBytes: input.maxBytes,
      abortSignal: input.abortSignal,
    })) {
      yield chunk;
    }
    yield footer;
  };
  const body = Readable.from(chunks(), {
    signal: input.abortSignal,
  });
  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
    contentLength: header.length + file.size + footer.length,
  };
}
