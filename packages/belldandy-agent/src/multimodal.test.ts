import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { OutboundRequestPolicy, type OutboundRequestAdapterInput } from "@belldandy/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { preprocessMultimodalContent, uploadFileToMoonshot } from "./multimodal.js";

describe("Moonshot file upload", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("rejects an insecure configured endpoint without calling legacy fetch", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-multimodal-"));
    const filePath = path.join(tempDir, "sample.mp4");
    await fs.writeFile(filePath, "video");
    const legacyFetch = vi.fn(async () => new Response(JSON.stringify({ id: "unsafe-file" }), { status: 200 }));
    vi.stubGlobal("fetch", legacyFetch);

    await expect(uploadFileToMoonshot(
      filePath,
      "moonshot-secret",
      "http://upload.example.test/v1",
      "video",
    )).rejects.toMatchObject({ code: "insecure_scheme" });
    expect(legacyFetch).not.toHaveBeenCalled();
  });

  it("forwards an injected upload policy through the public Moonshot interface", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-multimodal-"));
    const filePath = path.join(tempDir, "sample.mp4");
    await fs.writeFile(filePath, "video");
    const transport = vi.fn(async () => new Response(JSON.stringify({ id: "pinned-file" }), { status: 200 }));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["127.0.0.1"],
      allowInsecureHttp: true,
      allowPrivateNetwork: true,
      requestAdapter: transport,
      maxRedirects: 0,
    });

    await expect(uploadFileToMoonshot(
      filePath,
      "moonshot-secret",
      "http://127.0.0.1/v1",
      "video",
      { outboundRequestPolicy },
    )).resolves.toBe("pinned-file");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("streams the active multipart payload with the caller signal", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-multimodal-"));
    const filePath = path.join(tempDir, "sample.mp4");
    await fs.writeFile(filePath, "video-content");
    let request: OutboundRequestAdapterInput | undefined;
    let multipartBody = "";
    const transport = vi.fn(async (input: OutboundRequestAdapterInput) => {
      request = input;
      const body = input.init.body;
      if (body && typeof body !== "string" && !(body instanceof Uint8Array)) {
        const chunks: Buffer[] = [];
        for await (const chunk of body) chunks.push(Buffer.from(chunk));
        multipartBody = Buffer.concat(chunks).toString("utf8");
      }
      return new Response(JSON.stringify({ id: "moonshot-file" }), { status: 200 });
    });
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["upload.example.test"],
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      requestAdapter: transport,
      maxRedirects: 0,
    });
    const controller = new AbortController();

    await expect(uploadFileToMoonshot(
      filePath,
      "moonshot-secret",
      "https://upload.example.test/v1",
      "video",
      { abortSignal: controller.signal, outboundRequestPolicy },
    )).resolves.toBe("moonshot-file");

    expect(request?.init).toMatchObject({
      method: "POST",
      maxRedirects: 0,
      idleTimeoutMs: 15_000,
      headers: {
        Authorization: "Bearer moonshot-secret",
        "Content-Type": expect.stringMatching(/^multipart\/form-data; boundary=/u),
        "Content-Length": expect.any(String),
      },
    });
    expect(request?.init.signal).toBe(controller.signal);
    expect(multipartBody).toContain('name="file"; filename="sample.mp4"');
    expect(multipartBody).toContain("video-content");
    expect(multipartBody).toContain('name="purpose"');
    expect(multipartBody).toContain("video");
  });

  it("replaces a local video with the uploaded Moonshot file id through the caller policy", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-multimodal-"));
    const filePath = path.join(tempDir, "sample.mp4");
    await fs.writeFile(filePath, "video-content");
    let requestSignal: AbortSignal | undefined;
    const transport = vi.fn(async (input: OutboundRequestAdapterInput) => {
      requestSignal = input.init.signal;
      const body = input.init.body;
      if (body && typeof body !== "string" && !(body instanceof Uint8Array)) {
        for await (const _chunk of body) {
          // 消费流以模拟真实 transport，上传 owner 才能安全释放文件句柄。
        }
      }
      return new Response(JSON.stringify({ id: "moonshot-video" }), { status: 200 });
    });
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["127.0.0.1"],
      allowInsecureHttp: true,
      allowPrivateNetwork: true,
      requestAdapter: transport,
      maxRedirects: 0,
    });
    const controller = new AbortController();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await preprocessMultimodalContent([
      { type: "video_url", video_url: { url: `file://${filePath}` } },
    ], {
      id: "primary",
      baseUrl: "http://127.0.0.1/v1",
      apiKey: "moonshot-secret",
      model: "moonshot-v1",
    }, undefined, {
      abortSignal: controller.signal,
      outboundRequestPolicy,
    });

    expect(result).toEqual({
      content: [{ type: "video_url", video_url: { url: "ms://moonshot-video" } }],
      hadVideoUpload: true,
    });
    expect(requestSignal).toBe(controller.signal);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
