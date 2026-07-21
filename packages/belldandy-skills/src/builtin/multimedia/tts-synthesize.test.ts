import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import OpenAI from "openai";
import { OutboundRequestPolicy, OutboundRequestPolicyError } from "@belldandy/protocol";
import { synthesizeSpeech } from "./tts-synthesize.js";

const { edgeTtsPromiseMock, openAISpeechCreateMock } = vi.hoisted(() => ({
  edgeTtsPromiseMock: vi.fn(),
  openAISpeechCreateMock: vi.fn(),
}));

vi.mock("openai", () => ({
  default: vi.fn(() => ({
    audio: {
      speech: {
        create: openAISpeechCreateMock,
      },
    },
  })),
}));

vi.mock("node-edge-tts", () => ({
  EdgeTTS: vi.fn().mockImplementation(() => ({
    ttsPromise: edgeTtsPromiseMock,
  })),
}));

function createDashScopeAssetPolicy(
  fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
  allowedHosts = ["example.invalid"],
): OutboundRequestPolicy {
  return new OutboundRequestPolicy({
    allowedHosts,
    maxRedirects: 3,
    dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
    requestAdapter: async ({ url, init }) => await fetchImpl(url, {
      method: init.method,
      headers: init.headers,
      body: init.body as BodyInit | undefined,
      signal: init.signal,
    }),
  });
}

function createDashScopeRestPolicy(
  fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): OutboundRequestPolicy {
  return new OutboundRequestPolicy({
    allowedHosts: ["dashscope.aliyuncs.com"],
    maxRedirects: 0,
    dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
    requestAdapter: async ({ url, init }) => await fetchImpl(url, {
      method: init.method,
      headers: init.headers,
      body: init.body as BodyInit | undefined,
      signal: init.signal,
    }),
  });
}

describe("tts-synthesize", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-tts-test-"));
    process.env.DASHSCOPE_API_KEY = "dashscope-test-key";
    edgeTtsPromiseMock.mockReset();
    openAISpeechCreateMock.mockReset();
    edgeTtsPromiseMock.mockImplementation(async (_text: string, filePath: string) => {
      await fs.writeFile(filePath, Buffer.from("edge-test-audio"));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.DASHSCOPE_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.BELLDANDY_TTS_OPENAI_API_KEY;
    delete process.env.BELLDANDY_TTS_OPENAI_BASE_URL;
    delete process.env.BELLDANDY_TTS_MODEL;
    delete process.env.BELLDANDY_OPENAI_API_KEY;
    delete process.env.BELLDANDY_OPENAI_BASE_URL;
    delete process.env.BELLDANDY_TTS_PROVIDER;
    delete process.env.BELLDANDY_TTS_VOICE;
    delete process.env.BELLDANDY_TTS_MAX_OUTPUT_BYTES;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("uses BELLDANDY_OPENAI_* config for OpenAI provider", async () => {
    process.env.BELLDANDY_OPENAI_API_KEY = "sk-bdd";
    process.env.BELLDANDY_OPENAI_BASE_URL = "https://example.invalid/v1";
    process.env.BELLDANDY_TTS_PROVIDER = "dashscope";
    process.env.BELLDANDY_TTS_VOICE = "Chelsie";
    openAISpeechCreateMock.mockResolvedValue(new Response(Uint8Array.from([1, 2, 3, 4])));

    const result = await synthesizeSpeech({
      text: "Hello world",
      stateDir: tempDir,
      provider: "OpenAI",
    });

    expect(result).not.toBeNull();
    expect(result?.webPath).toMatch(/\.mp3$/);
    expect(vi.mocked(OpenAI)).toHaveBeenCalledWith({
      apiKey: "sk-bdd",
      baseURL: "https://example.invalid/v1",
      fetch: expect.any(Function),
    });
    expect(openAISpeechCreateMock).toHaveBeenCalledTimes(1);
    const firstCall = openAISpeechCreateMock.mock.calls[0]?.[0];
    expect(firstCall?.voice).toBe("alloy");
  });

  it("prefers BELLDANDY_TTS_OPENAI_* over global OpenAI config", async () => {
    process.env.BELLDANDY_TTS_OPENAI_API_KEY = "sk-tts";
    process.env.BELLDANDY_TTS_OPENAI_BASE_URL = "https://tts.example.invalid/v1";
    process.env.BELLDANDY_OPENAI_API_KEY = "sk-main";
    process.env.BELLDANDY_OPENAI_BASE_URL = "https://main.example.invalid/v1";
    openAISpeechCreateMock.mockResolvedValue(new Response(Uint8Array.from([1, 2, 3, 4])));

    const result = await synthesizeSpeech({
      text: "Hello TTS",
      stateDir: tempDir,
      provider: "openai",
    });

    expect(result).not.toBeNull();
    expect(vi.mocked(OpenAI)).toHaveBeenCalledWith({
      apiKey: "sk-tts",
      baseURL: "https://tts.example.invalid/v1",
      fetch: expect.any(Function),
    });
  });

  it("uses BELLDANDY_TTS_MODEL for OpenAI and DashScope providers", async () => {
    process.env.BELLDANDY_TTS_MODEL = "shared-tts-model";
    process.env.BELLDANDY_OPENAI_API_KEY = "sk-bdd";
    openAISpeechCreateMock.mockResolvedValue(new Response(Uint8Array.from([1, 2, 3, 4])));

    const openAiResult = await synthesizeSpeech({
      text: "OpenAI TTS model",
      stateDir: tempDir,
      provider: "openai",
    });

    expect(openAiResult).not.toBeNull();
    expect(openAISpeechCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "shared-tts-model" }),
      expect.anything(),
    );

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output: {
          audio: {
            url: "https://example.invalid/audio.mp3",
          },
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(Uint8Array.from({ length: 256 }, (_, index) => index % 255), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const dashscopeResult = await synthesizeSpeech({
      text: "DashScope TTS model",
      stateDir: tempDir,
      provider: "dashscope",
      dashScopeRestOutboundRequestPolicy: createDashScopeRestPolicy(fetchMock),
      dashScopeAssetOutboundRequestPolicy: createDashScopeAssetPolicy(fetchMock),
    });

    expect(dashscopeResult).not.toBeNull();
    const firstRequestBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(typeof firstRequestBody).toBe("string");
    expect(JSON.parse(firstRequestBody as string).model).toBe("shared-tts-model");
  });

  it("uses DashScope default Cherry voice and mp3 extension", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output: {
          audio: {
            url: "https://example.invalid/audio.mp3",
          },
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(Uint8Array.from({ length: 256 }, (_, index) => index % 255), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await synthesizeSpeech({
      text: "你好，世界",
      stateDir: tempDir,
      provider: "DashScope",
      dashScopeRestOutboundRequestPolicy: createDashScopeRestPolicy(fetchMock),
      dashScopeAssetOutboundRequestPolicy: createDashScopeAssetPolicy(fetchMock),
    });

    expect(result).not.toBeNull();
    expect(result?.webPath).toMatch(/\.mp3$/);
    const firstRequestBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(typeof firstRequestBody).toBe("string");
    const parsedBody = JSON.parse(firstRequestBody as string);
    expect(parsedBody.input.voice).toBe("Cherry");
  });

  it("routes DashScope result audio through the independent pinned asset policy", async () => {
    const assetBytes = Uint8Array.from({ length: 256 }, (_, index) => index % 255);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        output: { audio: { url: "https://example.invalid/audio.mp3" } },
      }))
      .mockResolvedValueOnce(new Response(assetBytes, {
        headers: { "Content-Type": "audio/mpeg" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const assetPolicy = createDashScopeAssetPolicy(fetchMock);
    const request = vi.spyOn(assetPolicy, "request");

    const result = await synthesizeSpeech({
      text: "Pinned DashScope asset",
      stateDir: tempDir,
      provider: "dashscope",
      dashScopeRestOutboundRequestPolicy: createDashScopeRestPolicy(fetchMock),
      dashScopeAssetOutboundRequestPolicy: assetPolicy,
    });

    expect(result).not.toBeNull();
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://example.invalid/audio.mp3",
      maxRedirects: 3,
      idleTimeoutMs: 15_000,
      signal: undefined,
    }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(fs.readFile(path.join(tempDir, result!.webPath))).resolves.toEqual(Buffer.from(assetBytes));
  });

  it("rejects a private DashScope submit resolution before transport or asset handoff", async () => {
    const legacyFetch = vi.fn(async () => {
      throw new OutboundRequestPolicyError(
        "private_network_not_allowed",
        "legacy fetch must not run",
      );
    });
    vi.stubGlobal("fetch", legacyFetch);
    const submitTransport = vi.fn(async () => Response.json({
      output: { audio: { url: "https://example.invalid/audio.mp3" } },
    }));
    const submitPolicy = new OutboundRequestPolicy({
      allowedHosts: ["dashscope.aliyuncs.com"],
      dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
      requestAdapter: submitTransport,
    });
    const assetRequest = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await synthesizeSpeech({
      text: "Private DashScope submit",
      stateDir: tempDir,
      provider: "dashscope",
      dashScopeRestOutboundRequestPolicy: submitPolicy,
      dashScopeAssetOutboundRequestPolicy: { request: assetRequest },
    });

    expect(result).toBeNull();
    expect(legacyFetch).not.toHaveBeenCalled();
    expect(submitTransport).not.toHaveBeenCalled();
    expect(assetRequest).not.toHaveBeenCalled();
    await expect(fs.readdir(path.join(tempDir, "generated"))).resolves.toEqual([]);
  });

  it("does not replay the DashScope Bearer token across a submit redirect", async () => {
    const legacyFetch = vi.fn(async () => {
      throw new Error("legacy fetch must not run");
    });
    vi.stubGlobal("fetch", legacyFetch);
    const submitTransport = vi.fn(async () => new Response(null, {
      status: 307,
      headers: { location: "https://dashscope.aliyuncs.com/credential-sink" },
    }));
    const submitPolicy = new OutboundRequestPolicy({
      allowedHosts: ["dashscope.aliyuncs.com"],
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      requestAdapter: submitTransport,
    });
    const assetRequest = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await synthesizeSpeech({
      text: "Redirected DashScope submit",
      stateDir: tempDir,
      provider: "dashscope",
      dashScopeRestOutboundRequestPolicy: submitPolicy,
      dashScopeAssetOutboundRequestPolicy: { request: assetRequest },
    });

    expect(result).toBeNull();
    expect(legacyFetch).not.toHaveBeenCalled();
    expect(submitTransport).toHaveBeenCalledTimes(1);
    expect(submitTransport.mock.calls[0]?.[0]).toMatchObject({
      url: new URL("https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"),
      init: {
        headers: { Authorization: "Bearer dashscope-test-key" },
        maxRedirects: 0,
        idleTimeoutMs: 15_000,
      },
    });
    expect(assetRequest).not.toHaveBeenCalled();
    await expect(fs.readdir(path.join(tempDir, "generated"))).resolves.toEqual([]);
  });

  it("rejects an oversized declared DashScope submit body before asset handoff", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({
          output: { audio: { url: "https://example.invalid/audio.mp3" } },
        })));
        controller.close();
      },
      cancel: cancelBody,
    }), {
      headers: { "Content-Length": String(1024 * 1024 + 1) },
    });
    const submitRequest = vi.fn(async () => ({
      response,
      url: new URL("https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const assetRequest = vi.fn(async () => ({
      response: new Response(Uint8Array.from({ length: 256 }, (_, index) => index % 255)),
      url: new URL("https://example.invalid/audio.mp3"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await synthesizeSpeech({
      text: "Oversized DashScope submit",
      stateDir: tempDir,
      provider: "dashscope",
      dashScopeRestOutboundRequestPolicy: { request: submitRequest },
      dashScopeAssetOutboundRequestPolicy: { request: assetRequest },
    });

    expect(result).toBeNull();
    expect(cancelBody).toHaveBeenCalledTimes(1);
    expect(submitRequest).toHaveBeenCalledTimes(1);
    expect(assetRequest).not.toHaveBeenCalled();
    await expect(fs.readdir(path.join(tempDir, "generated"))).resolves.toEqual([]);
  });

  it("cancels an actually oversized DashScope submit body without retrying", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024 + 1));
      },
      cancel: cancelBody,
    }));
    const submitRequest = vi.fn(async () => ({
      response,
      url: new URL("https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const assetRequest = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await synthesizeSpeech({
      text: "Actually oversized DashScope submit",
      stateDir: tempDir,
      provider: "dashscope",
      dashScopeRestOutboundRequestPolicy: { request: submitRequest },
      dashScopeAssetOutboundRequestPolicy: { request: assetRequest },
    });

    expect(result).toBeNull();
    expect(cancelBody).toHaveBeenCalledTimes(1);
    expect(submitRequest).toHaveBeenCalledTimes(1);
    expect(assetRequest).not.toHaveBeenCalled();
    await expect(fs.readdir(path.join(tempDir, "generated"))).resolves.toEqual([]);
  });

  it("bounds a non-success DashScope submit error body without retrying", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"message":"too large"}'));
        controller.close();
      },
      cancel: cancelBody,
    }), {
      status: 400,
      headers: { "Content-Length": String(1024 * 1024 + 1) },
    });
    const submitRequest = vi.fn(async () => ({
      response,
      url: new URL("https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await synthesizeSpeech({
      text: "Oversized DashScope submit error",
      stateDir: tempDir,
      provider: "dashscope",
      dashScopeRestOutboundRequestPolicy: { request: submitRequest },
    });

    expect(result).toBeNull();
    expect(cancelBody).toHaveBeenCalledTimes(1);
    expect(submitRequest).toHaveBeenCalledTimes(1);
    await expect(fs.readdir(path.join(tempDir, "generated"))).resolves.toEqual([]);
  });

  it("rejects a private DashScope result URL before asset transport or file commit", async () => {
    const legacyAudio = Uint8Array.from({ length: 128 }, (_, index) => index % 255);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        output: { audio: { url: "https://127.0.0.1/private.mp3" } },
      }))
      .mockResolvedValueOnce(new Response(legacyAudio));
    vi.stubGlobal("fetch", fetchMock);
    const transport = vi.fn(async () => new Response(legacyAudio));
    const assetPolicy = new OutboundRequestPolicy({
      allowedHosts: ["aliyuncs.com"],
      dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
      requestAdapter: transport,
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await synthesizeSpeech({
      text: "Private DashScope asset",
      stateDir: tempDir,
      provider: "dashscope",
      dashScopeRestOutboundRequestPolicy: createDashScopeRestPolicy(fetchMock),
      dashScopeAssetOutboundRequestPolicy: assetPolicy,
    });

    expect(result).toBeNull();
    expect(transport).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(fs.readdir(path.join(tempDir, "generated"))).resolves.toEqual([]);
  });

  it("rejects a non-Aliyun public result URL with the default DashScope asset profile", async () => {
    const legacyAudio = Uint8Array.from({ length: 128 }, (_, index) => index % 255);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        output: { audio: { url: "https://attacker.example/audio.mp3" } },
      }))
      .mockResolvedValueOnce(new Response(legacyAudio));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await synthesizeSpeech({
      text: "Untrusted DashScope asset host",
      stateDir: tempDir,
      provider: "dashscope",
      dashScopeRestOutboundRequestPolicy: createDashScopeRestPolicy(fetchMock),
    });

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(fs.readdir(path.join(tempDir, "generated"))).resolves.toEqual([]);
  });

  it("revalidates DashScope asset redirects before a private second hop", async () => {
    const legacyAudio = Uint8Array.from({ length: 128 }, (_, index) => index % 255);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        output: {
          audio: {
            url: "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/audio.mp3",
          },
        },
      }))
      .mockResolvedValueOnce(new Response(legacyAudio));
    vi.stubGlobal("fetch", fetchMock);
    const transport = vi.fn(async () => new Response(null, {
      status: 307,
      headers: { location: "https://127.0.0.1/private.mp3" },
    }));
    const assetPolicy = createDashScopeAssetPolicy(transport, ["aliyuncs.com", "127.0.0.1"]);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await synthesizeSpeech({
      text: "Redirected DashScope asset",
      stateDir: tempDir,
      provider: "dashscope",
      dashScopeRestOutboundRequestPolicy: createDashScopeRestPolicy(fetchMock),
      dashScopeAssetOutboundRequestPolicy: assetPolicy,
    });

    expect(result).toBeNull();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(fs.readdir(path.join(tempDir, "generated"))).resolves.toEqual([]);
  });

  it("rejects an oversized declared DashScope asset before reading or committing it", async () => {
    process.env.BELLDANDY_TTS_MAX_OUTPUT_BYTES = "128";
    const legacyAudio = Uint8Array.from({ length: 128 }, (_, index) => index % 255);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        output: { audio: { url: "https://example.invalid/oversized.mp3" } },
      }))
      .mockResolvedValueOnce(new Response(legacyAudio));
    vi.stubGlobal("fetch", fetchMock);
    const assetPolicy = createDashScopeAssetPolicy(async () => new Response(Buffer.from("tiny"), {
      headers: { "Content-Length": "129" },
    }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await synthesizeSpeech({
      text: "Oversized DashScope asset",
      stateDir: tempDir,
      provider: "dashscope",
      dashScopeRestOutboundRequestPolicy: createDashScopeRestPolicy(fetchMock),
      dashScopeAssetOutboundRequestPolicy: assetPolicy,
    });

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(fs.readdir(path.join(tempDir, "generated"))).resolves.toEqual([]);
  });

  it("aborts DashScope synthesis when abortSignal is triggered", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input, init) => {
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        if (signal?.aborted) {
          const error = new Error("Stopped by user.");
          error.name = "AbortError";
          reject(error);
          return;
        }
        signal?.addEventListener("abort", () => {
          const error = new Error("Stopped by user.");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    }));
    const controller = new AbortController();

    const resultPromise = synthesizeSpeech({
      text: "Hello world",
      stateDir: tempDir,
      provider: "dashscope",
      dashScopeRestOutboundRequestPolicy: createDashScopeRestPolicy(fetch),
      abortSignal: controller.signal,
    });

    await new Promise((resolve) => setTimeout(resolve, 80));
    controller.abort("Stopped by user.");

    await expect(resultPromise).rejects.toThrow("Stopped by user.");
  });

  it("rejects oversized OpenAI audio without leaving a partial file", async () => {
    process.env.BELLDANDY_OPENAI_API_KEY = "sk-bdd";
    process.env.BELLDANDY_TTS_MAX_OUTPUT_BYTES = "8";
    openAISpeechCreateMock.mockResolvedValue(new Response(Buffer.from("123456789")));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await synthesizeSpeech({
      text: "Oversized fixture",
      stateDir: tempDir,
      provider: "openai",
    });

    expect(result).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      "[TTS-Auto] synthesizeSpeech failed:",
      expect.stringContaining("8 byte limit"),
    );
    await expect(fs.readdir(path.join(tempDir, "generated"))).resolves.toEqual([]);
  });
});
