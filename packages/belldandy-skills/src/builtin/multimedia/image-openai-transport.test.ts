import { OutboundRequestPolicy } from "@belldandy/protocol";
import { describe, expect, it, vi } from "vitest";

import {
  calculateImageOpenAIMaxResponseBytes,
  createImageOpenAIFetch,
  IMAGE_OPENAI_RESPONSE_ENVELOPE_BYTES,
} from "./image-openai-transport.js";

describe("OpenAI image transport", () => {
  it("derives the JSON cap from decoded image bytes plus a fixed envelope", () => {
    expect(calculateImageOpenAIMaxResponseBytes(8))
      .toBe(12 + IMAGE_OPENAI_RESPONSE_ENVELOPE_BYTES);
  });

  it("rejects private DNS before sending prompts or credentials", async () => {
    const transport = vi.fn(async () => Response.json({ data: [] }));
    const fetch = createImageOpenAIFetch({
      baseURL: "https://images.example.test/v1",
      maxResponseBytes: 1024,
      outboundRequestPolicy: new OutboundRequestPolicy({
        allowedHosts: ["images.example.test"],
        dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
        requestAdapter: transport,
        maxRedirects: 0,
      }),
    });

    await expect(fetch("https://images.example.test/v1/images/generations", {
      method: "POST",
      headers: { Authorization: "Bearer image-secret" },
      body: JSON.stringify({ prompt: "private image prompt" }),
    })).rejects.toMatchObject({ code: "private_network_not_allowed" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("does not replay prompts or credentials after a redirect", async () => {
    const cancelBody = vi.fn();
    const transport = vi.fn(async () => new Response(
      new ReadableStream<Uint8Array>({ cancel: cancelBody }),
      {
        status: 307,
        headers: { location: "https://redirect.example.test/credential-sink" },
      },
    ));
    const fetch = createImageOpenAIFetch({
      baseURL: "https://images.example.test/v1",
      maxResponseBytes: 1024,
      outboundRequestPolicy: new OutboundRequestPolicy({
        allowedHosts: ["images.example.test"],
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestAdapter: transport,
        maxRedirects: 0,
      }),
    });

    await expect(fetch("https://images.example.test/v1/images/generations", {
      method: "POST",
      headers: { Authorization: "Bearer image-secret" },
      body: JSON.stringify({ prompt: "private image prompt" }),
    })).rejects.toMatchObject({ code: "redirect_limit" });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("cancels a declared oversized response before SDK parsing", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), {
      status: 200,
      headers: { "content-length": "9", "content-type": "application/json" },
    });
    const fetch = createImageOpenAIFetch({
      baseURL: "https://images.example.test/v1",
      maxResponseBytes: 8,
      outboundRequestPolicy: { request: vi.fn(async () => ({
        response,
        url: new URL("https://images.example.test/v1/images/generations"),
        addresses: [{ address: "93.184.216.34", family: 4 as const }],
        redirectCount: 0,
      })) },
    });

    await expect(fetch("https://images.example.test/v1/images/generations", {
      method: "POST",
      body: "{}",
    })).rejects.toThrow("OpenAI image response exceeds 8 byte limit.");
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("cancels a streamed response when cumulative bytes cross the limit", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(5));
        controller.enqueue(new Uint8Array(4));
      },
      cancel: cancelBody,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const fetch = createImageOpenAIFetch({
      baseURL: "https://images.example.test/v1",
      maxResponseBytes: 8,
      outboundRequestPolicy: { request: vi.fn(async () => ({
        response,
        url: new URL("https://images.example.test/v1/images/generations"),
        addresses: [{ address: "93.184.216.34", family: 4 as const }],
        redirectCount: 0,
      })) },
    });

    await expect(fetch("https://images.example.test/v1/images/generations", {
      method: "POST",
      body: "{}",
    })).rejects.toThrow("OpenAI image response exceeds 8 byte limit.");
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending response when the generation request is aborted", async () => {
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
    const fetch = createImageOpenAIFetch({
      baseURL: "https://images.example.test/v1",
      maxResponseBytes: 8,
      outboundRequestPolicy: { request: vi.fn(async () => ({
        response,
        url: new URL("https://images.example.test/v1/images/generations"),
        addresses: [{ address: "93.184.216.34", family: 4 as const }],
        redirectCount: 0,
      })) },
    });
    const controller = new AbortController();

    const responsePromise = fetch("https://images.example.test/v1/images/generations", {
      method: "POST",
      body: "{}",
      signal: controller.signal,
    });
    controller.abort(new Error("image generation cancelled"));

    await expect(responsePromise).rejects.toThrow("image generation cancelled");
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });
});
