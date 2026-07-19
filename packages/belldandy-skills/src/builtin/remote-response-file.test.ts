import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BoundedResponseLimitError,
  persistBoundedResponseToFile,
} from "./remote-response-file.js";

function createChunkedResponse(
  chunks: Buffer[],
  options: {
    contentLength?: string;
    onCancel?: (reason: unknown) => void;
    holdOpenAfterChunks?: boolean;
  } = {},
): Response {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk) {
        controller.enqueue(chunk);
        return;
      }
      if (!options.holdOpenAfterChunks) {
        controller.close();
      }
    },
    cancel(reason) {
      options.onCancel?.(reason);
    },
  });
  const headers = new Headers();
  if (options.contentLength !== undefined) {
    headers.set("content-length", options.contentLength);
  }
  return new Response(body, { headers });
}

async function listPartialFiles(directory: string): Promise<string[]> {
  return (await fs.readdir(directory)).filter((entry) => entry.includes(".part-"));
}

describe("persistBoundedResponseToFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-response-file-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it.each([
    { size: 7, succeeds: true },
    { size: 8, succeeds: true },
    { size: 9, succeeds: false },
  ])("enforces the exact byte boundary for a $size-byte body", async ({ size, succeeds }) => {
    const targetPath = path.join(tempDir, `boundary-${size}.bin`);
    const operation = persistBoundedResponseToFile({
      response: createChunkedResponse([Buffer.alloc(size, 0x61)]),
      targetPath,
      maxBytes: 8,
      label: "Fixture",
    });

    if (succeeds) {
      await expect(operation).resolves.toMatchObject({ byteLength: size, filePath: targetPath });
      await expect(fs.stat(targetPath)).resolves.toMatchObject({ size });
    } else {
      await expect(operation).rejects.toBeInstanceOf(BoundedResponseLimitError);
      await expect(fs.access(targetPath)).rejects.toThrow();
    }
    await expect(listPartialFiles(tempDir)).resolves.toEqual([]);
  });

  it("rejects an oversized declared Content-Length before consuming the body", async () => {
    const onCancel = vi.fn();
    const targetPath = path.join(tempDir, "declared-too-large.bin");

    await expect(persistBoundedResponseToFile({
      response: createChunkedResponse([Buffer.from("tiny")], {
        contentLength: "9",
        onCancel,
      }),
      targetPath,
      maxBytes: 8,
      label: "Fixture",
    })).rejects.toBeInstanceOf(BoundedResponseLimitError);

    expect(onCancel).toHaveBeenCalledTimes(1);
    await expect(fs.access(targetPath)).rejects.toThrow();
    await expect(listPartialFiles(tempDir)).resolves.toEqual([]);
  });

  it("rejects an invalid Content-Length and cancels the body", async () => {
    const onCancel = vi.fn();
    const targetPath = path.join(tempDir, "invalid-length.bin");

    await expect(persistBoundedResponseToFile({
      response: createChunkedResponse([Buffer.from("tiny")], {
        contentLength: "not-a-number",
        onCancel,
      }),
      targetPath,
      maxBytes: 8,
      label: "Fixture",
    })).rejects.toThrow("invalid Content-Length");

    expect(onCancel).toHaveBeenCalledTimes(1);
    await expect(fs.access(targetPath)).rejects.toThrow();
    await expect(listPartialFiles(tempDir)).resolves.toEqual([]);
  });

  it("cancels a chunked body when observed bytes exceed a forged smaller length", async () => {
    const onCancel = vi.fn();
    const targetPath = path.join(tempDir, "forged-length.bin");

    await expect(persistBoundedResponseToFile({
      response: createChunkedResponse([
        Buffer.from("1234"),
        Buffer.from("56789"),
      ], {
        contentLength: "4",
        onCancel,
        holdOpenAfterChunks: true,
      }),
      targetPath,
      maxBytes: 8,
      label: "Fixture",
    })).rejects.toBeInstanceOf(BoundedResponseLimitError);

    expect(onCancel).toHaveBeenCalledTimes(1);
    await expect(fs.access(targetPath)).rejects.toThrow();
    await expect(listPartialFiles(tempDir)).resolves.toEqual([]);
  });

  it("preserves the existing target and removes staging data after a network failure", async () => {
    const targetPath = path.join(tempDir, "stable.bin");
    await fs.writeFile(targetPath, "stable");
    let pullCount = 0;
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        if (pullCount === 1) {
          controller.enqueue(Buffer.from("partial"));
          return;
        }
        controller.error(new Error("fixture connection reset"));
      },
    }));

    await expect(persistBoundedResponseToFile({
      response,
      targetPath,
      maxBytes: 32,
      label: "Fixture",
      overwrite: true,
    })).rejects.toThrow("fixture connection reset");

    await expect(fs.readFile(targetPath, "utf-8")).resolves.toBe("stable");
    await expect(listPartialFiles(tempDir)).resolves.toEqual([]);
  });

  it("cancels a pending reader and removes staging data when the caller aborts", async () => {
    const targetPath = path.join(tempDir, "aborted.bin");
    const onCancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from("partial"));
      },
      cancel(reason) {
        onCancel(reason);
      },
    }));
    const abortController = new AbortController();
    const operation = persistBoundedResponseToFile({
      response,
      targetPath,
      maxBytes: 32,
      label: "Fixture",
      abortSignal: abortController.signal,
    });

    await Promise.resolve();
    abortController.abort("Stopped by test.");

    await expect(operation).rejects.toThrow("Stopped by test.");
    expect(onCancel).toHaveBeenCalledTimes(1);
    await expect(fs.access(targetPath)).rejects.toThrow();
    await expect(listPartialFiles(tempDir)).resolves.toEqual([]);
  });

  it("commits exact bytes and hash after resolving the final file name", async () => {
    const content = Buffer.from("bounded response fixture");
    const expectedHash = crypto.createHash("sha256").update(content).digest("hex");
    const provisionalPath = path.join(tempDir, "asset.bin");
    const finalPath = path.join(tempDir, "asset.dat");

    const result = await persistBoundedResponseToFile({
      response: createChunkedResponse([
        content.subarray(0, 7),
        content.subarray(7),
      ], {
        contentLength: String(content.length),
      }),
      targetPath: provisionalPath,
      maxBytes: content.length,
      label: "Fixture",
      resolveTargetPath: ({ prefix }) => {
        expect(prefix).toEqual(content.subarray(0, 16));
        return finalPath;
      },
    });

    expect(result).toMatchObject({
      byteLength: content.length,
      filePath: finalPath,
      sha256: expectedHash,
    });
    await expect(fs.readFile(finalPath)).resolves.toEqual(content);
    await expect(fs.access(provisionalPath)).rejects.toThrow();
    await expect(listPartialFiles(tempDir)).resolves.toEqual([]);
  });

  it("atomically replaces an existing target only after the complete body is ready", async () => {
    const targetPath = path.join(tempDir, "replace.bin");
    await fs.writeFile(targetPath, "old-content");

    const result = await persistBoundedResponseToFile({
      response: createChunkedResponse([
        Buffer.from("new-"),
        Buffer.from("content"),
      ]),
      targetPath,
      maxBytes: 32,
      label: "Fixture",
      overwrite: true,
    });

    expect(result.byteLength).toBe(11);
    await expect(fs.readFile(targetPath, "utf-8")).resolves.toBe("new-content");
    await expect(listPartialFiles(tempDir)).resolves.toEqual([]);
  });
});
