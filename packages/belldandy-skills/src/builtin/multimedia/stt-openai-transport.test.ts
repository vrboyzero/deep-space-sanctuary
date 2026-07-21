import { OutboundRequestPolicy } from "@belldandy/protocol";
import { describe, expect, it, vi } from "vitest";

import {
  createSttOpenAIFetch,
  STT_OPENAI_MAX_RESPONSE_BYTES,
} from "./stt-openai-transport.js";

function createMultipartBody(): FormData {
  const body = new FormData();
  body.append("model", "whisper-1");
  body.append("file", new File(["fixture-audio"], "fixture.webm"));
  return body;
}

describe("OpenAI-compatible STT transport", () => {
  it("rejects private DNS before sending multipart audio or credentials", async () => {
    const transport = vi.fn(async () => Response.json({ text: "unexpected" }));
    const fetch = createSttOpenAIFetch({
      baseURL: "https://audio.example.test/v1",
      outboundRequestPolicy: new OutboundRequestPolicy({
        allowedHosts: ["audio.example.test"],
        dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
        requestAdapter: transport,
        maxRedirects: 0,
      }),
    });

    await expect(fetch("https://audio.example.test/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: "Bearer stt-secret" },
      body: createMultipartBody(),
    })).rejects.toMatchObject({ code: "private_network_not_allowed" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("does not replay multipart audio or credentials after a redirect", async () => {
    const cancelBody = vi.fn();
    const transport = vi.fn(async () => new Response(
      new ReadableStream<Uint8Array>({ cancel: cancelBody }),
      {
        status: 307,
        headers: { location: "https://redirect.example.test/credential-sink" },
      },
    ));
    const fetch = createSttOpenAIFetch({
      baseURL: "https://audio.example.test/v1",
      outboundRequestPolicy: new OutboundRequestPolicy({
        allowedHosts: ["audio.example.test"],
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestAdapter: transport,
        maxRedirects: 0,
      }),
    });

    await expect(fetch("https://audio.example.test/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: "Bearer stt-secret" },
      body: createMultipartBody(),
    })).rejects.toMatchObject({ code: "redirect_limit" });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("cancels a declared oversized response before SDK parsing", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), {
      status: 200,
      headers: {
        "content-length": String(STT_OPENAI_MAX_RESPONSE_BYTES + 1),
        "content-type": "application/json",
      },
    });
    const request = vi.fn(async () => ({
      response,
      url: new URL("https://audio.example.test/v1/audio/transcriptions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const fetch = createSttOpenAIFetch({
      baseURL: "https://audio.example.test/v1",
      outboundRequestPolicy: { request },
    });

    await expect(fetch("https://audio.example.test/v1/audio/transcriptions", {
      method: "POST",
      body: createMultipartBody(),
    })).rejects.toThrow("OpenAI-compatible STT response exceeds 1048576 byte limit.");
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("cancels a streamed response when cumulative bytes cross the limit", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(700 * 1024));
        controller.enqueue(new Uint8Array(400 * 1024));
      },
      cancel: cancelBody,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const fetch = createSttOpenAIFetch({
      baseURL: "https://audio.example.test/v1",
      outboundRequestPolicy: { request: vi.fn(async () => ({
        response,
        url: new URL("https://audio.example.test/v1/audio/transcriptions"),
        addresses: [{ address: "93.184.216.34", family: 4 as const }],
        redirectCount: 0,
      })) },
    });

    await expect(fetch("https://audio.example.test/v1/audio/transcriptions", {
      method: "POST",
      body: createMultipartBody(),
    })).rejects.toThrow("OpenAI-compatible STT response exceeds 1048576 byte limit.");
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending response when transcription is aborted", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => {});
      },
      cancel: cancelBody,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const request = vi.fn(async () => ({
      response,
      url: new URL("https://audio.example.test/v1/audio/transcriptions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const fetch = createSttOpenAIFetch({
      baseURL: "https://audio.example.test/v1",
      outboundRequestPolicy: { request },
    });
    const controller = new AbortController();

    const responsePromise = fetch("https://audio.example.test/v1/audio/transcriptions", {
      method: "POST",
      body: createMultipartBody(),
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    controller.abort(new Error("transcription cancelled"));

    await expect(responsePromise).rejects.toThrow("transcription cancelled");
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });
});
