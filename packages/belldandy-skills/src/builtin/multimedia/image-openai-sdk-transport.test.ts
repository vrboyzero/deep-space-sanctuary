import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { OutboundRequestPolicy } from "@belldandy/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createImageGenerateTool } from "./image.js";
import type { ToolContext } from "../../types.js";

type OutboundRequestInput = Parameters<OutboundRequestPolicy["request"]>[0];

function createContext(workspaceRoot: string): ToolContext {
  return {
    conversationId: "conv-image-sdk-test",
    workspaceRoot,
    stateDir: workspaceRoot,
    policy: {
      allowedPaths: [],
      deniedPaths: [],
      allowedDomains: [],
      deniedDomains: [],
      maxTimeoutMs: 60_000,
      maxResponseBytes: 1024 * 1024,
    },
  };
}

describe("OpenAI image SDK transport", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-image-openai-sdk-"));
    process.env.BELLDANDY_IMAGE_OPENAI_API_KEY = "image-secret";
    process.env.BELLDANDY_IMAGE_OPENAI_BASE_URL = "https://images.example.test/v1";
    process.env.BELLDANDY_IMAGE_MODEL = "gpt-image-2";
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.BELLDANDY_IMAGE_OPENAI_API_KEY;
    delete process.env.BELLDANDY_IMAGE_OPENAI_BASE_URL;
    delete process.env.BELLDANDY_IMAGE_MODEL;
    delete process.env.BELLDANDY_IMAGE_MAX_OUTPUT_BYTES;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("generates through the configured pinned endpoint policy", async () => {
    const policyImage = Buffer.from("policy-image-bytes");
    const legacyImage = Buffer.from("legacy-image-bytes");
    const legacyFetch = vi.fn(async () => Response.json({
      created: 0,
      data: [{ b64_json: legacyImage.toString("base64") }],
    }));
    vi.stubGlobal("fetch", legacyFetch);
    const request = vi.fn(async (_input: OutboundRequestInput) => ({
      response: Response.json({
        created: 0,
        data: [{ b64_json: policyImage.toString("base64") }],
      }),
      url: new URL("https://images.example.test/v1/images/generations"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const dependencies: Parameters<typeof createImageGenerateTool>[0] & {
      generationOutboundRequestPolicy: Pick<OutboundRequestPolicy, "request">;
    } = {
      generationOutboundRequestPolicy: { request },
    };
    const tool = createImageGenerateTool(dependencies);

    const result = await tool.execute({
      prompt: "a bounded sanctuary",
      size: "1024x1024",
    }, createContext(tempDir));

    expect(result.success).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      url: new URL("https://images.example.test/v1/images/generations"),
      method: "POST",
      maxRedirects: 0,
    });
    expect(JSON.parse(String(request.mock.calls[0]?.[0].body))).toMatchObject({
      model: "gpt-image-2",
      prompt: "a bounded sanctuary",
      size: "1024x1024",
    });
    const relativePath = String(result.metadata?.relativePath);
    await expect(fs.readFile(path.join(tempDir, relativePath))).resolves.toEqual(policyImage);
    expect(legacyFetch).not.toHaveBeenCalled();
  });

  it("rejects decoded base64 bytes above the configured output limit", async () => {
    process.env.BELLDANDY_IMAGE_MAX_OUTPUT_BYTES = "8";
    const request = vi.fn(async (_input: OutboundRequestInput) => ({
      response: Response.json({
        created: 0,
        data: [{ b64_json: Buffer.from("123456789").toString("base64") }],
      }),
      url: new URL("https://images.example.test/v1/images/generations"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const tool = createImageGenerateTool({
      generationOutboundRequestPolicy: { request },
    });

    const result = await tool.execute({
      prompt: "oversized decoded image",
    }, createContext(tempDir));

    expect(result.success).toBe(false);
    expect(result.error).toContain("8 byte limit");
    expect(request).toHaveBeenCalledTimes(1);
    await expect(fs.readdir(path.join(tempDir, "generated", "images"))).resolves.toEqual([]);
  });
});
