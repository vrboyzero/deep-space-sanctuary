import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  OutboundRequestPolicy,
  type OutboundRequestAdapter,
} from "@belldandy/protocol";

import { createImageGenerateTool, imageGenerateTool } from "./image.js";
import type { ToolContext } from "../../types.js";

const { imageGenerateMock, openAIMock } = vi.hoisted(() => ({
  imageGenerateMock: vi.fn(),
  openAIMock: vi.fn(() => ({
    images: {
      generate: imageGenerateMock,
    },
  })),
}));

vi.mock("openai", () => ({
  default: openAIMock,
}));

function createContext(workspaceRoot: string): ToolContext {
  return {
    conversationId: "conv-image-test",
    workspaceRoot,
    stateDir: workspaceRoot,
    policy: {
      allowedPaths: [],
      deniedPaths: [],
      allowedDomains: [],
      deniedDomains: [],
      maxTimeoutMs: 60000,
      maxResponseBytes: 1024 * 1024,
    },
  };
}

function binaryResponse(content: Buffer, headers?: HeadersInit): Response {
  return new Response(content, {
    status: 200,
    headers,
  });
}

function createImageToolWithAssetTransport(requestAdapter: OutboundRequestAdapter) {
  return createImageGenerateTool({
    createAssetOutboundRequestPolicy: (options) => new OutboundRequestPolicy({
      ...options,
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      requestAdapter,
    }),
  });
}

describe("image_generate", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-image-test-"));
    imageGenerateMock.mockReset();
    openAIMock.mockClear();
    delete process.env.BELLDANDY_IMAGE_ENABLED;
    delete process.env.BELLDANDY_IMAGE_PROVIDER;
    delete process.env.BELLDANDY_IMAGE_OPENAI_API_KEY;
    delete process.env.BELLDANDY_IMAGE_OPENAI_BASE_URL;
    delete process.env.BELLDANDY_IMAGE_MODEL;
    delete process.env.BELLDANDY_IMAGE_OUTPUT_FORMAT;
    delete process.env.BELLDANDY_IMAGE_TIMEOUT_MS;
    delete process.env.BELLDANDY_IMAGE_MAX_OUTPUT_BYTES;
    delete process.env.BELLDANDY_IMAGE_ASSET_ALLOWED_HOSTS;
    delete process.env.BELLDANDY_OPENAI_API_KEY;
    delete process.env.BELLDANDY_OPENAI_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("requires BELLDANDY_IMAGE_OPENAI_API_KEY and does not fall back to global OpenAI env", async () => {
    process.env.BELLDANDY_OPENAI_API_KEY = "sk-main";
    process.env.OPENAI_API_KEY = "sk-legacy";

    const result = await imageGenerateTool.execute({
      prompt: "a lantern under stars",
    }, createContext(tempDir));

    expect(result.success).toBe(false);
    expect(result.error).toContain("BELLDANDY_IMAGE_OPENAI_API_KEY");
    expect(imageGenerateMock).not.toHaveBeenCalled();
  });

  it("writes a generated image into generated/images and returns preview markup", async () => {
    process.env.BELLDANDY_IMAGE_OPENAI_API_KEY = "sk-image";
    process.env.BELLDANDY_IMAGE_OPENAI_BASE_URL = "https://images.example.invalid/v1";
    process.env.BELLDANDY_IMAGE_MODEL = "gpt-image-2";
    process.env.BELLDANDY_IMAGE_OUTPUT_FORMAT = "png";
    imageGenerateMock.mockResolvedValue({
      data: [
        {
          b64_json: Buffer.from("fake-image-bytes").toString("base64"),
        },
      ],
    });

    const result = await imageGenerateTool.execute({
      prompt: "a sanctuary garden at night",
      size: "1024x1024",
    }, createContext(tempDir));

    expect(result.success).toBe(true);
    expect(result.output).toContain("<div class=\"generated-image-result\">");
    expect(result.output).toContain("保存位置：");
    expect(result.output).toContain("#generated-image-reveal:/generated/images/");
    expect(result.metadata).toMatchObject({
      model: "gpt-image-2",
      webPath: expect.stringMatching(/^\/generated\/images\/image-/),
      relativePath: expect.stringMatching(/^generated\/images\/image-/),
      outputFormat: "png",
    });

    const relativePath = String(result.metadata?.relativePath);
    const writtenFile = path.join(tempDir, relativePath);
    await expect(fs.readFile(writtenFile)).resolves.toEqual(Buffer.from("fake-image-bytes"));
    expect(openAIMock).toHaveBeenCalledWith(expect.objectContaining({
      timeout: 60000,
    }));
  });

  it("downloads a provider-host URL through the asset policy and reuses the generation signal", async () => {
    const legacyFetch = vi.fn();
    vi.stubGlobal("fetch", legacyFetch);
    const requestAdapter = vi.fn(async () => binaryResponse(Buffer.from("downloaded-image-bytes")));
    const createAssetOutboundRequestPolicy = vi.fn((options) => new OutboundRequestPolicy({
      ...options,
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      requestAdapter,
    }));
    const testTool = createImageGenerateTool({ createAssetOutboundRequestPolicy });
    process.env.BELLDANDY_IMAGE_OPENAI_API_KEY = "sk-image";
    process.env.BELLDANDY_IMAGE_OPENAI_BASE_URL = "https://images.example.invalid/v1";
    process.env.BELLDANDY_IMAGE_TIMEOUT_MS = "0";
    imageGenerateMock.mockImplementation(async (_input: unknown, options?: { signal?: AbortSignal }) => ({
      data: [
        {
          url: "https://images.example.invalid/generated.png",
        },
      ],
      _signal: options?.signal,
    }));

    const result = await testTool.execute({
      prompt: "a sanctuary garden at dawn",
      output_format: "png",
    }, createContext(tempDir));

    expect(result.success).toBe(true);
    expect(openAIMock).toHaveBeenCalledWith(expect.objectContaining({
      timeout: 2147483647,
    }));
    expect(imageGenerateMock).toHaveBeenCalledTimes(1);
    expect(createAssetOutboundRequestPolicy).toHaveBeenCalledWith(expect.objectContaining({
      allowedHosts: ["images.example.invalid"],
      maxRedirects: 3,
    }));
    expect(requestAdapter).toHaveBeenCalledTimes(1);
    expect(legacyFetch).not.toHaveBeenCalled();
    const generateSignal = imageGenerateMock.mock.calls[0]?.[1]?.signal;
    const assetRequest = requestAdapter.mock.calls[0]?.[0];
    expect(generateSignal).toBeInstanceOf(AbortSignal);
    expect(assetRequest?.init.signal).toBe(generateSignal);
    expect(assetRequest?.init.maxRedirects).toBe(3);
    expect(assetRequest?.init.idleTimeoutMs).toBe(15_000);
  });

  it("rejects a provider-host URL resolving to a private address before transport or file commit", async () => {
    const legacyFetch = vi.fn();
    vi.stubGlobal("fetch", legacyFetch);
    const requestAdapter = vi.fn(async () => binaryResponse(Buffer.from("private-image")));
    const testTool = createImageGenerateTool({
      createAssetOutboundRequestPolicy: (options) => new OutboundRequestPolicy({
        ...options,
        dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
        requestAdapter,
      }),
    });
    process.env.BELLDANDY_IMAGE_OPENAI_API_KEY = "sk-image";
    process.env.BELLDANDY_IMAGE_OPENAI_BASE_URL = "https://images.example.invalid/v1";
    imageGenerateMock.mockResolvedValue({
      data: [{ url: "https://images.example.invalid/private.png" }],
    });

    const result = await testTool.execute({
      prompt: "a private target fixture",
      response_transport: "url",
    }, createContext(tempDir));

    expect(result.success).toBe(false);
    expect(result.error).toContain("private or reserved");
    expect(requestAdapter).not.toHaveBeenCalled();
    expect(legacyFetch).not.toHaveBeenCalled();
    await expect(fs.readdir(path.join(tempDir, "generated", "images"))).resolves.toEqual([]);
  });

  it("rejects a public-looking asset host outside the provider and configured allowlist", async () => {
    const legacyFetch = vi.fn();
    vi.stubGlobal("fetch", legacyFetch);
    const dnsLookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]);
    const requestAdapter = vi.fn(async () => binaryResponse(Buffer.from("untrusted-image")));
    const testTool = createImageGenerateTool({
      createAssetOutboundRequestPolicy: (options) => new OutboundRequestPolicy({
        ...options,
        dnsLookup,
        requestAdapter,
      }),
    });
    process.env.BELLDANDY_IMAGE_OPENAI_API_KEY = "sk-image";
    process.env.BELLDANDY_IMAGE_OPENAI_BASE_URL = "https://images.example.invalid/v1";
    imageGenerateMock.mockResolvedValue({
      data: [{ url: "https://attacker.example/generated.png" }],
    });

    const result = await testTool.execute({
      prompt: "an untrusted host fixture",
      response_transport: "url",
    }, createContext(tempDir));

    expect(result.success).toBe(false);
    expect(result.error).toContain("not in the allowlist");
    expect(dnsLookup).not.toHaveBeenCalled();
    expect(requestAdapter).not.toHaveBeenCalled();
    expect(legacyFetch).not.toHaveBeenCalled();
    await expect(fs.readdir(path.join(tempDir, "generated", "images"))).resolves.toEqual([]);
  });

  it("revalidates a redirect before a private second-hop asset transport", async () => {
    const legacyFetch = vi.fn();
    vi.stubGlobal("fetch", legacyFetch);
    const requestAdapter = vi.fn(async ({ url }) => {
      if (url.hostname === "images.example.invalid") {
        return new Response(null, {
          status: 307,
          headers: { location: "https://127.0.0.1/private.png" },
        });
      }
      return binaryResponse(Buffer.from("private-second-hop"));
    });
    const testTool = createImageGenerateTool({
      createAssetOutboundRequestPolicy: (options) => new OutboundRequestPolicy({
        ...options,
        dnsLookup: async (hostname) => [{
          address: hostname === "127.0.0.1" ? "127.0.0.1" : "93.184.216.34",
          family: 4,
        }],
        requestAdapter,
      }),
    });
    process.env.BELLDANDY_IMAGE_OPENAI_API_KEY = "sk-image";
    process.env.BELLDANDY_IMAGE_OPENAI_BASE_URL = "https://images.example.invalid/v1";
    process.env.BELLDANDY_IMAGE_ASSET_ALLOWED_HOSTS = "127.0.0.1";
    imageGenerateMock.mockResolvedValue({
      data: [{ url: "https://images.example.invalid/redirect.png" }],
    });

    const result = await testTool.execute({
      prompt: "a redirect fixture",
      response_transport: "url",
    }, createContext(tempDir));

    expect(result.success).toBe(false);
    expect(result.error).toContain("private or reserved");
    expect(requestAdapter).toHaveBeenCalledTimes(1);
    expect(requestAdapter.mock.calls[0]?.[0].url.toString()).toBe(
      "https://images.example.invalid/redirect.png",
    );
    expect(legacyFetch).not.toHaveBeenCalled();
    await expect(fs.readdir(path.join(tempDir, "generated", "images"))).resolves.toEqual([]);
  });

  it("sends Agnes text-to-image URL output requests with extra_body.response_format", async () => {
    process.env.BELLDANDY_IMAGE_OPENAI_API_KEY = "sk-image";
    process.env.BELLDANDY_IMAGE_OPENAI_BASE_URL = "https://apihub.agnes-ai.com/v1";
    process.env.BELLDANDY_IMAGE_MODEL = "agnes-image-2.1-flash";
    process.env.BELLDANDY_IMAGE_ASSET_ALLOWED_HOSTS = "images.example.invalid";
    imageGenerateMock.mockResolvedValue({
      data: [
        {
          url: "https://images.example.invalid/agnes-url.png",
        },
      ],
    });

    const testTool = createImageToolWithAssetTransport(
      vi.fn(async () => binaryResponse(Buffer.from("agnes-url-image-bytes"))),
    );

    const result = await testTool.execute({
      prompt: "a floating sanctuary above clouds",
      size: "1024x768",
      response_transport: "url",
    }, createContext(tempDir));

    expect(result.success).toBe(true);
    expect(imageGenerateMock).toHaveBeenCalledWith(expect.objectContaining({
      model: "agnes-image-2.1-flash",
      prompt: "a floating sanctuary above clouds",
      size: "1024x768",
      extra_body: {
        response_format: "url",
      },
    }), expect.anything());
  });

  it("sends Agnes text-to-image Base64 output requests with return_base64", async () => {
    process.env.BELLDANDY_IMAGE_OPENAI_API_KEY = "sk-image";
    process.env.BELLDANDY_IMAGE_OPENAI_BASE_URL = "https://apihub.agnes-ai.com/v1";
    process.env.BELLDANDY_IMAGE_MODEL = "agnes-image-2.1-flash";
    imageGenerateMock.mockResolvedValue({
      data: [
        {
          b64_json: Buffer.from("agnes-b64-image-bytes").toString("base64"),
        },
      ],
    });

    const result = await imageGenerateTool.execute({
      prompt: "a glass citadel on a snowy cliff",
      size: "1024x768",
      response_transport: "base64",
    }, createContext(tempDir));

    expect(result.success).toBe(true);
    expect(imageGenerateMock).toHaveBeenCalledWith(expect.objectContaining({
      model: "agnes-image-2.1-flash",
      prompt: "a glass citadel on a snowy cliff",
      size: "1024x768",
      return_base64: true,
    }), expect.anything());
  });

  it("sends Agnes image-to-image URL output requests with input images inside extra_body", async () => {
    process.env.BELLDANDY_IMAGE_OPENAI_API_KEY = "sk-image";
    process.env.BELLDANDY_IMAGE_OPENAI_BASE_URL = "https://apihub.agnes-ai.com/v1";
    process.env.BELLDANDY_IMAGE_MODEL = "agnes-image-2.1-flash";
    process.env.BELLDANDY_IMAGE_ASSET_ALLOWED_HOSTS = "images.example.invalid";
    imageGenerateMock.mockResolvedValue({
      data: [
        {
          url: "https://images.example.invalid/agnes-img2img-url.png",
        },
      ],
    });

    const testTool = createImageToolWithAssetTransport(
      vi.fn(async () => binaryResponse(Buffer.from("agnes-img2img-url-bytes"))),
    );

    const result = await testTool.execute({
      prompt: "turn this into a neon cyberpunk night while preserving composition",
      size: "1024x768",
      input_images: ["https://example.com/input.png"],
      response_transport: "url",
    }, createContext(tempDir));

    expect(result.success).toBe(true);
    expect(imageGenerateMock).toHaveBeenCalledWith(expect.objectContaining({
      model: "agnes-image-2.1-flash",
      prompt: "turn this into a neon cyberpunk night while preserving composition",
      size: "1024x768",
      extra_body: {
        image: ["https://example.com/input.png"],
        response_format: "url",
      },
    }), expect.anything());
  });

  it("sends Agnes image-to-image Base64 output requests with input images inside extra_body", async () => {
    process.env.BELLDANDY_IMAGE_OPENAI_API_KEY = "sk-image";
    process.env.BELLDANDY_IMAGE_OPENAI_BASE_URL = "https://apihub.agnes-ai.com/v1";
    process.env.BELLDANDY_IMAGE_MODEL = "agnes-image-2.1-flash";
    imageGenerateMock.mockResolvedValue({
      data: [
        {
          b64_json: Buffer.from("agnes-img2img-b64-bytes").toString("base64"),
        },
      ],
    });

    const result = await imageGenerateTool.execute({
      prompt: "make the object matte black while preserving composition",
      size: "1024x768",
      input_images: ["data:image/png;base64,ZmFrZQ=="],
      response_transport: "base64",
    }, createContext(tempDir));

    expect(result.success).toBe(true);
    expect(imageGenerateMock).toHaveBeenCalledWith(expect.objectContaining({
      model: "agnes-image-2.1-flash",
      prompt: "make the object matte black while preserving composition",
      size: "1024x768",
      extra_body: {
        image: ["data:image/png;base64,ZmFrZQ=="],
        response_format: "b64_json",
      },
    }), expect.anything());
  });

  it("persists Agnes URL responses using the detected file format instead of the local default", async () => {
    process.env.BELLDANDY_IMAGE_OPENAI_API_KEY = "sk-image";
    process.env.BELLDANDY_IMAGE_OPENAI_BASE_URL = "https://apihub.agnes-ai.com/v1";
    process.env.BELLDANDY_IMAGE_MODEL = "agnes-image-2.1-flash";
    process.env.BELLDANDY_IMAGE_OUTPUT_FORMAT = "png";
    process.env.BELLDANDY_IMAGE_ASSET_ALLOWED_HOSTS = "images.example.invalid";
    imageGenerateMock.mockResolvedValue({
      data: [
        {
          url: "https://images.example.invalid/agnes-jpeg.jpg",
        },
      ],
    });

    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const testTool = createImageToolWithAssetTransport(
      vi.fn(async () => binaryResponse(jpegBytes)),
    );

    const result = await testTool.execute({
      prompt: "a brass observatory in warm sunset light",
      response_transport: "url",
    }, createContext(tempDir));

    expect(result.success).toBe(true);
    expect(result.metadata).toMatchObject({
      outputFormat: "jpeg",
      relativePath: expect.stringMatching(/\.jpeg$/),
      webPath: expect.stringMatching(/\.jpeg$/),
    });
  });

  it("persists Agnes Base64 responses using the detected WebP format", async () => {
    process.env.BELLDANDY_IMAGE_OPENAI_API_KEY = "sk-image";
    process.env.BELLDANDY_IMAGE_OPENAI_BASE_URL = "https://apihub.agnes-ai.com/v1";
    process.env.BELLDANDY_IMAGE_MODEL = "agnes-image-2.1-flash";
    process.env.BELLDANDY_IMAGE_OUTPUT_FORMAT = "png";
    const webpBytes = Buffer.from([
      0x52, 0x49, 0x46, 0x46,
      0x24, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
      0x56, 0x50, 0x38, 0x20,
    ]);
    imageGenerateMock.mockResolvedValue({
      data: [
        {
          b64_json: webpBytes.toString("base64"),
        },
      ],
    });

    const result = await imageGenerateTool.execute({
      prompt: "a translucent shrine suspended over the sea",
      response_transport: "base64",
    }, createContext(tempDir));

    expect(result.success).toBe(true);
    expect(result.metadata).toMatchObject({
      outputFormat: "webp",
      relativePath: expect.stringMatching(/\.webp$/),
      webPath: expect.stringMatching(/\.webp$/),
    });
  });

  it("rejects an oversized declared URL response without creating an image file", async () => {
    process.env.BELLDANDY_IMAGE_OPENAI_API_KEY = "sk-image";
    process.env.BELLDANDY_IMAGE_MAX_OUTPUT_BYTES = "8";
    process.env.BELLDANDY_IMAGE_ASSET_ALLOWED_HOSTS = "images.example.invalid";
    imageGenerateMock.mockResolvedValue({
      data: [{ url: "https://images.example.invalid/declared-oversized.png" }],
    });
    const testTool = createImageToolWithAssetTransport(
      vi.fn(async () => binaryResponse(Buffer.from("tiny"), { "Content-Length": "9" })),
    );

    const result = await testTool.execute({
      prompt: "a declared oversized fixture",
      response_transport: "url",
    }, createContext(tempDir));

    expect(result.success).toBe(false);
    expect(result.error).toContain("Content-Length: 9");
    await expect(fs.readdir(path.join(tempDir, "generated", "images"))).resolves.toEqual([]);
  });

  it("rejects an oversized URL response without leaving a partial image", async () => {
    process.env.BELLDANDY_IMAGE_OPENAI_API_KEY = "sk-image";
    process.env.BELLDANDY_IMAGE_MAX_OUTPUT_BYTES = "8";
    process.env.BELLDANDY_IMAGE_ASSET_ALLOWED_HOSTS = "images.example.invalid";
    imageGenerateMock.mockResolvedValue({
      data: [{ url: "https://images.example.invalid/oversized.png" }],
    });
    const testTool = createImageToolWithAssetTransport(
      vi.fn(async () => binaryResponse(Buffer.from("123456789"))),
    );

    const result = await testTool.execute({
      prompt: "an image that exceeds the fixture limit",
      response_transport: "url",
    }, createContext(tempDir));

    expect(result.success).toBe(false);
    expect(result.error).toContain("8 byte limit");
    const generatedDir = path.join(tempDir, "generated", "images");
    await expect(fs.readdir(generatedDir)).resolves.toEqual([]);
  });
});
