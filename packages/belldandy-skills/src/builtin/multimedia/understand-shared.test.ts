import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { OutboundRequestPolicy } from "@belldandy/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createOpenAIClient,
  uploadFileToOpenAICompatible,
} from "./understand-shared.js";

type OutboundRequestInput = Parameters<OutboundRequestPolicy["request"]>[0];

describe("OpenAI-compatible understanding chat client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns a chat completion through the configured pinned endpoint policy", async () => {
    const legacyFetch = vi.fn(async () => {
      throw new Error("legacy fetch must not run");
    });
    vi.stubGlobal("fetch", legacyFetch);
    const request = vi.fn(async (_input: OutboundRequestInput) => ({
      response: Response.json({
        id: "chatcmpl-understand-1",
        object: "chat.completion",
        created: 0,
        model: "vision-model",
        choices: [{
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content: "bounded understanding" },
        }],
      }),
      url: new URL("https://vision.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const clientInput: Parameters<typeof createOpenAIClient>[0] & {
      outboundRequestPolicy: Pick<OutboundRequestPolicy, "request">;
    } = {
      apiKey: "understanding-secret",
      baseURL: "https://vision.example.test/v1",
      timeoutMs: 60_000,
      outboundRequestPolicy: { request },
    };
    const client = createOpenAIClient(clientInput);

    const response = await client.chat.completions.create({
      model: "vision-model",
      messages: [{ role: "user", content: "describe image" }],
    });

    expect(response.choices[0]?.message.content).toBe("bounded understanding");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      url: new URL("https://vision.example.test/v1/chat/completions"),
      method: "POST",
      maxRedirects: 0,
    });
    expect(JSON.parse(String(request.mock.calls[0]?.[0].body))).toMatchObject({
      model: "vision-model",
      messages: [{ role: "user", content: "describe image" }],
    });
    expect(legacyFetch).not.toHaveBeenCalled();
  });
});

describe("OpenAI-compatible media upload", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("rejects an insecure private upload endpoint before legacy fetch", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-media-upload-policy-"));
    const filePath = path.join(tempDir, "clip.mp4");
    await fs.writeFile(filePath, "fixture-video");
    const legacyFetch = vi.fn(async () => new Response(JSON.stringify({ id: "unsafe-file" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", legacyFetch);

    await expect(uploadFileToOpenAICompatible({
      filePath,
      apiKey: "sk-private",
      baseURL: "http://127.0.0.1:8080/v1",
      purpose: "video",
      maxBytes: 1024,
    })).rejects.toThrow();
    expect(legacyFetch).not.toHaveBeenCalled();
  });

  it("streams multipart content through a pinned upload policy and returns the file id", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-media-upload-active-"));
    const filePath = path.join(tempDir, "clip.mp4");
    await fs.writeFile(filePath, Buffer.concat([
      Buffer.from("fixture-video"),
      Buffer.alloc(128 * 1024 + 5, 0x51),
    ]));
    const legacyFetch = vi.fn();
    vi.stubGlobal("fetch", legacyFetch);
    let uploadBody = Buffer.alloc(0);
    let chunkSizes: number[] = [];
    const requestAdapter = vi.fn(async (request) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request.init.body as Readable) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      uploadBody = Buffer.concat(chunks);
      chunkSizes = chunks.map((chunk) => chunk.length);
      return new Response(JSON.stringify({ id: "file-video-123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["video.example.com"],
      maxRedirects: 0,
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      requestAdapter,
    });

    await expect(uploadFileToOpenAICompatible({
      filePath,
      apiKey: "sk-video",
      baseURL: "https://video.example.com/v1",
      purpose: "video",
      maxBytes: 1024 * 1024,
      outboundRequestPolicy,
    })).resolves.toBe("file-video-123");

    expect(legacyFetch).not.toHaveBeenCalled();
    expect(requestAdapter).toHaveBeenCalledTimes(1);
    const request = requestAdapter.mock.calls[0]?.[0];
    expect(request?.url.toString()).toBe("https://video.example.com/v1/files");
    expect(request?.init).toMatchObject({
      method: "POST",
      maxRedirects: 0,
      idleTimeoutMs: 15_000,
      headers: expect.objectContaining({
        Authorization: "Bearer sk-video",
      }),
    });
    expect(request?.init.headers?.["Content-Type"]).toMatch(/^multipart\/form-data; boundary=/);
    expect(Number(request?.init.headers?.["Content-Length"])).toBe(uploadBody.length);
    expect(uploadBody.toString("utf8")).toContain("fixture-video");
    expect(uploadBody.toString("utf8")).toContain('name="purpose"');
    expect(chunkSizes.length).toBeGreaterThanOrEqual(5);
    expect(Math.max(...chunkSizes)).toBeLessThanOrEqual(64 * 1024);
  });

  it("rejects private DNS before the upload transport", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-media-upload-private-"));
    const filePath = path.join(tempDir, "clip.mp4");
    await fs.writeFile(filePath, "fixture-video");
    const legacyFetch = vi.fn();
    const requestAdapter = vi.fn(async () => new Response(JSON.stringify({ id: "unsafe-file" })));
    vi.stubGlobal("fetch", legacyFetch);
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["upload.example.test"],
      dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
      requestAdapter,
    });

    await expect(uploadFileToOpenAICompatible({
      filePath,
      apiKey: "sk-private",
      baseURL: "https://upload.example.test/v1",
      purpose: "video",
      maxBytes: 1024,
      outboundRequestPolicy,
    })).rejects.toMatchObject({ code: "private_network_not_allowed" });
    expect(requestAdapter).not.toHaveBeenCalled();
    expect(legacyFetch).not.toHaveBeenCalled();
  });

  it("does not replay upload credentials or body after a 307 response", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-media-upload-redirect-"));
    const filePath = path.join(tempDir, "clip.mp4");
    await fs.writeFile(filePath, "fixture-video");
    const requestAdapter = vi.fn(async (request) => {
      for await (const _chunk of request.init.body as Readable) {
        // 首跳消费 multipart 流；零 redirect profile 不得尝试重放。
      }
      return new Response(null, {
        status: 307,
        headers: { location: "https://redirect.example.test/files" },
      });
    });
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["upload.example.test"],
      maxRedirects: 0,
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      requestAdapter,
    });

    await expect(uploadFileToOpenAICompatible({
      filePath,
      apiKey: "sk-secret",
      baseURL: "https://upload.example.test/v1",
      purpose: "video",
      maxBytes: 1024,
      outboundRequestPolicy,
    })).rejects.toMatchObject({ code: "redirect_limit" });
    expect(requestAdapter).toHaveBeenCalledTimes(1);
    expect(requestAdapter.mock.calls[0]?.[0].init.headers?.Authorization).toBe("Bearer sk-secret");
  });

  it("cancels an upload response whose declared length exceeds 1 MiB", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-media-upload-bounded-"));
    const filePath = path.join(tempDir, "clip.mp4");
    await fs.writeFile(filePath, "fixture-video");
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"id":"oversized"}'));
      },
      cancel: cancelBody,
    }), {
      status: 200,
      headers: { "content-length": String(1024 * 1024 + 1) },
    });
    const outboundRequestPolicy = {
      request: vi.fn(async () => ({
        response,
        url: new URL("https://upload.example.test/v1/files"),
        addresses: [{ address: "93.184.216.34", family: 4 as const }],
        redirectCount: 0,
      })),
    };

    await expect(uploadFileToOpenAICompatible({
      filePath,
      apiKey: "sk-video",
      baseURL: "https://upload.example.test/v1",
      purpose: "video",
      maxBytes: 1024,
      outboundRequestPolicy,
    })).rejects.toThrow("Upload response exceeds 1048576 byte limit");
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("cancels an upload response that crosses the cumulative 1 MiB limit", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-media-upload-cumulative-"));
    const filePath = path.join(tempDir, "clip.mp4");
    await fs.writeFile(filePath, "fixture-video");
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(700 * 1024));
        controller.enqueue(new Uint8Array(400 * 1024));
      },
      cancel: cancelBody,
    }), { status: 200 });
    const outboundRequestPolicy = {
      request: vi.fn(async () => ({
        response,
        url: new URL("https://upload.example.test/v1/files"),
        addresses: [{ address: "93.184.216.34", family: 4 as const }],
        redirectCount: 0,
      })),
    };

    await expect(uploadFileToOpenAICompatible({
      filePath,
      apiKey: "sk-video",
      baseURL: "https://upload.example.test/v1",
      purpose: "video",
      maxBytes: 1024,
      outboundRequestPolicy,
    })).rejects.toThrow("Upload response exceeds 1048576 byte limit");
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("destroys the multipart file stream when an in-flight upload is aborted", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-media-upload-abort-"));
    const filePath = path.join(tempDir, "clip.mp4");
    await fs.writeFile(filePath, Buffer.alloc(128 * 1024, 0x51));
    const controller = new AbortController();
    let capturedBody: Readable | undefined;
    let markRequestStarted = () => {};
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve;
    });
    const outboundRequestPolicy = {
      request: vi.fn(async (request: { body?: string | Uint8Array | Readable; signal?: AbortSignal }) => {
        capturedBody = request.body as Readable;
        markRequestStarted();
        return await new Promise<never>((_resolve, reject) => {
          request.signal?.addEventListener("abort", () => reject(request.signal?.reason), { once: true });
        });
      }),
    };

    const uploading = uploadFileToOpenAICompatible({
      filePath,
      apiKey: "sk-video",
      baseURL: "https://upload.example.test/v1",
      purpose: "video",
      maxBytes: 1024 * 1024,
      abortSignal: controller.signal,
      outboundRequestPolicy,
    });
    await requestStarted;
    controller.abort(new Error("Stop fixture upload."));

    await expect(uploading).rejects.toThrow("Stop fixture upload.");
    expect(capturedBody?.destroyed).toBe(true);
  });
});
