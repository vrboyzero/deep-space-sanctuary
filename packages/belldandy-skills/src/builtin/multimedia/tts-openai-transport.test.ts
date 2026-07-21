import { OutboundRequestPolicy } from "@belldandy/protocol";
import { describe, expect, it, vi } from "vitest";

import {
  createTtsOpenAIFetch,
  TTS_OPENAI_MAX_ERROR_RESPONSE_BYTES,
} from "./tts-openai-transport.js";

describe("OpenAI TTS transport", () => {
  it("rejects private DNS before sending speech text or credentials", async () => {
    const transport = vi.fn(async () => new Response(Uint8Array.from([1, 2, 3])));
    const fetch = createTtsOpenAIFetch({
      baseURL: "https://tts.example.test/v1",
      outboundRequestPolicy: new OutboundRequestPolicy({
        allowedHosts: ["tts.example.test"],
        dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
        requestAdapter: transport,
        maxRedirects: 0,
      }),
    });

    await expect(fetch("https://tts.example.test/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: "Bearer tts-secret" },
      body: JSON.stringify({ input: "private speech text" }),
    })).rejects.toMatchObject({ code: "private_network_not_allowed" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("does not replay speech text or credentials after a redirect", async () => {
    const cancelBody = vi.fn();
    const transport = vi.fn(async () => new Response(
      new ReadableStream<Uint8Array>({ cancel: cancelBody }),
      {
        status: 307,
        headers: { location: "https://redirect.example.test/credential-sink" },
      },
    ));
    const fetch = createTtsOpenAIFetch({
      baseURL: "https://tts.example.test/v1",
      outboundRequestPolicy: new OutboundRequestPolicy({
        allowedHosts: ["tts.example.test"],
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestAdapter: transport,
        maxRedirects: 0,
      }),
    });

    await expect(fetch("https://tts.example.test/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: "Bearer tts-secret" },
      body: JSON.stringify({ input: "private speech text" }),
    })).rejects.toMatchObject({ code: "redirect_limit" });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("cancels a declared oversized SDK error body", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), {
      status: 500,
      headers: {
        "content-length": String(TTS_OPENAI_MAX_ERROR_RESPONSE_BYTES + 1),
        "content-type": "application/json",
      },
    });
    const fetch = createTtsOpenAIFetch({
      baseURL: "https://tts.example.test/v1",
      outboundRequestPolicy: { request: vi.fn(async () => ({
        response,
        url: new URL("https://tts.example.test/v1/audio/speech"),
        addresses: [{ address: "93.184.216.34", family: 4 as const }],
        redirectCount: 0,
      })) },
    });

    await expect(fetch("https://tts.example.test/v1/audio/speech", {
      method: "POST",
      body: "{}",
    })).rejects.toThrow("OpenAI TTS error response exceeds 1048576 byte limit.");
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("cancels a streamed SDK error body when cumulative bytes cross the limit", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(700 * 1024));
        controller.enqueue(new Uint8Array(400 * 1024));
      },
      cancel: cancelBody,
    }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
    const fetch = createTtsOpenAIFetch({
      baseURL: "https://tts.example.test/v1",
      outboundRequestPolicy: { request: vi.fn(async () => ({
        response,
        url: new URL("https://tts.example.test/v1/audio/speech"),
        addresses: [{ address: "93.184.216.34", family: 4 as const }],
        redirectCount: 0,
      })) },
    });

    await expect(fetch("https://tts.example.test/v1/audio/speech", {
      method: "POST",
      body: "{}",
    })).rejects.toThrow("OpenAI TTS error response exceeds 1048576 byte limit.");
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending SDK error body when the request is aborted", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => {});
      },
      cancel: cancelBody,
    }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
    const fetch = createTtsOpenAIFetch({
      baseURL: "https://tts.example.test/v1",
      outboundRequestPolicy: { request: vi.fn(async () => ({
        response,
        url: new URL("https://tts.example.test/v1/audio/speech"),
        addresses: [{ address: "93.184.216.34", family: 4 as const }],
        redirectCount: 0,
      })) },
    });
    const controller = new AbortController();

    const responsePromise = fetch("https://tts.example.test/v1/audio/speech", {
      method: "POST",
      body: "{}",
      signal: controller.signal,
    });
    controller.abort(new Error("speech cancelled"));

    await expect(responsePromise).rejects.toThrow("speech cancelled");
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });
});
