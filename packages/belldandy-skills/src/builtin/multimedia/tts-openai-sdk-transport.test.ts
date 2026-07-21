import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { OutboundRequestPolicy } from "@belldandy/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { synthesizeSpeech } from "./tts-synthesize.js";

type OutboundRequestInput = Parameters<OutboundRequestPolicy["request"]>[0];

describe("OpenAI TTS SDK transport", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-tts-openai-sdk-"));
    process.env.BELLDANDY_TTS_OPENAI_API_KEY = "tts-secret";
    process.env.BELLDANDY_TTS_OPENAI_BASE_URL = "https://tts.example.test/v1";
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.BELLDANDY_TTS_OPENAI_API_KEY;
    delete process.env.BELLDANDY_TTS_OPENAI_BASE_URL;
    delete process.env.BELLDANDY_TTS_MAX_OUTPUT_BYTES;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("streams speech through the configured pinned endpoint policy", async () => {
    const policyAudio = Uint8Array.from([1, 2, 3, 4]);
    const legacyFetch = vi.fn(async () => new Response(Uint8Array.from([9, 9, 9])));
    vi.stubGlobal("fetch", legacyFetch);
    const request = vi.fn(async (_input: OutboundRequestInput) => ({
      response: new Response(policyAudio, {
        status: 200,
        headers: {
          "content-length": String(policyAudio.byteLength),
          "content-type": "audio/mpeg",
        },
      }),
      url: new URL("https://tts.example.test/v1/audio/speech"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const input: Parameters<typeof synthesizeSpeech>[0] & {
      openAIOutboundRequestPolicy: Pick<OutboundRequestPolicy, "request">;
    } = {
      text: "bounded speech",
      stateDir: tempDir,
      provider: "openai",
      openAIOutboundRequestPolicy: { request },
    };

    const result = await synthesizeSpeech(input);

    expect(result).not.toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      url: new URL("https://tts.example.test/v1/audio/speech"),
      method: "POST",
      maxRedirects: 0,
    });
    expect(JSON.parse(String(request.mock.calls[0]?.[0].body))).toMatchObject({
      model: "tts-1",
      voice: "alloy",
      input: "bounded speech",
    });
    const generated = await fs.readdir(path.join(tempDir, "generated"));
    expect(generated).toHaveLength(1);
    await expect(fs.readFile(path.join(tempDir, "generated", generated[0]!)))
      .resolves.toEqual(Buffer.from(policyAudio));
    expect(legacyFetch).not.toHaveBeenCalled();
  });

  it("cancels oversized speech before committing an output file", async () => {
    process.env.BELLDANDY_TTS_MAX_OUTPUT_BYTES = "8";
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), {
      status: 200,
      headers: {
        "content-length": "9",
        "content-type": "audio/mpeg",
      },
    });
    const request = vi.fn(async (_input: OutboundRequestInput) => ({
      response,
      url: new URL("https://tts.example.test/v1/audio/speech"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await synthesizeSpeech({
      text: "oversized speech",
      stateDir: tempDir,
      provider: "openai",
      openAIOutboundRequestPolicy: { request },
    });

    expect(result).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    expect(cancelBody).toHaveBeenCalledTimes(1);
    await expect(fs.readdir(path.join(tempDir, "generated"))).resolves.toEqual([]);
  });

  it("cancels a pending speech body when the caller aborts", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => {});
      },
      cancel: cancelBody,
    }), {
      status: 200,
      headers: { "content-type": "audio/mpeg" },
    });
    const request = vi.fn(async (_input: OutboundRequestInput) => ({
      response,
      url: new URL("https://tts.example.test/v1/audio/speech"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const controller = new AbortController();

    const resultPromise = synthesizeSpeech({
      text: "cancelled speech",
      stateDir: tempDir,
      provider: "openai",
      abortSignal: controller.signal,
      openAIOutboundRequestPolicy: { request },
    });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    controller.abort(new Error("speech cancelled"));

    await expect(resultPromise).rejects.toThrow("speech cancelled");
    expect(cancelBody).toHaveBeenCalledTimes(1);
    await expect(fs.readdir(path.join(tempDir, "generated"))).resolves.toEqual([]);
  });
});
