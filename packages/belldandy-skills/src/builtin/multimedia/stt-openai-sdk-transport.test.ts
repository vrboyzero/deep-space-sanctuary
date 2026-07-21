import { OutboundRequestPolicy } from "@belldandy/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { transcribeSpeech } from "./stt-transcribe.js";

type OutboundRequestInput = Parameters<OutboundRequestPolicy["request"]>[0];

describe("OpenAI-compatible STT SDK transport", () => {
  beforeEach(() => {
    process.env.BELLDANDY_STT_OPENAI_API_KEY = "stt-secret";
    process.env.BELLDANDY_STT_OPENAI_BASE_URL = "https://audio.example.test/v1";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.BELLDANDY_STT_OPENAI_API_KEY;
    delete process.env.BELLDANDY_STT_OPENAI_BASE_URL;
    delete process.env.BELLDANDY_STT_GROQ_API_KEY;
    delete process.env.BELLDANDY_STT_GROQ_BASE_URL;
  });

  it("uploads multipart audio through the configured pinned endpoint policy", async () => {
    const legacyFetch = vi.fn(async () => Response.json({
      text: "legacy transcript",
      duration: 1,
    }));
    vi.stubGlobal("fetch", legacyFetch);
    const request = vi.fn(async (_input: OutboundRequestInput) => ({
      response: Response.json({
        text: "policy transcript",
        duration: 2,
      }),
      url: new URL("https://audio.example.test/v1/audio/transcriptions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const input: Parameters<typeof transcribeSpeech>[0] & {
      openAIOutboundRequestPolicy: Pick<OutboundRequestPolicy, "request">;
    } = {
      buffer: Buffer.from("fixture-audio"),
      fileName: "fixture.webm",
      provider: "openai",
      language: "en",
      prompt: "fixture context",
      openAIOutboundRequestPolicy: { request },
    };

    const result = await transcribeSpeech(input);

    expect(result).toEqual({
      text: "policy transcript",
      provider: "openai",
      model: "whisper-1",
      durationSec: 2,
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      url: new URL("https://audio.example.test/v1/audio/transcriptions"),
      method: "POST",
      maxRedirects: 0,
    });
    const requestHeaders = request.mock.calls[0]?.[0].headers;
    expect(requestHeaders?.["content-type"]).toMatch(/^multipart\/form-data; boundary=/u);
    const requestBody = Buffer.from(request.mock.calls[0]?.[0].body as Uint8Array).toString("utf8");
    expect(requestBody).toContain("fixture-audio");
    expect(requestBody).toContain("fixture.webm");
    expect(requestBody).toContain("fixture context");
    expect(requestBody).toContain("whisper-1");
    expect(legacyFetch).not.toHaveBeenCalled();
  });

  it("keeps Groq on its own configured pinned endpoint policy", async () => {
    process.env.BELLDANDY_STT_GROQ_API_KEY = "groq-secret";
    process.env.BELLDANDY_STT_GROQ_BASE_URL = "https://groq.example.test/openai/v1";
    const request = vi.fn(async (_input: OutboundRequestInput) => ({
      response: Response.json({ text: "groq policy transcript", duration: 3 }),
      url: new URL("https://groq.example.test/openai/v1/audio/transcriptions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    const result = await transcribeSpeech({
      buffer: Buffer.from("groq-fixture-audio"),
      fileName: "fixture.mp3",
      provider: "groq",
      groqOutboundRequestPolicy: { request },
    });

    expect(result).toEqual({
      text: "groq policy transcript",
      provider: "groq",
      model: "whisper-large-v3-turbo",
      durationSec: 3,
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0].url)
      .toEqual(new URL("https://groq.example.test/openai/v1/audio/transcriptions"));
  });
});
