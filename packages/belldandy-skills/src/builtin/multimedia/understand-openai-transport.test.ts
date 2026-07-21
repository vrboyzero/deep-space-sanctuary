import { OutboundRequestPolicy } from "@belldandy/protocol";
import { describe, expect, it, vi } from "vitest";

import {
  createUnderstandingOpenAIFetch,
  UNDERSTANDING_OPENAI_MAX_RESPONSE_BYTES,
} from "./understand-openai-transport.js";

describe("understanding OpenAI transport", () => {
  it("rejects private DNS before sending the understanding prompt or credential", async () => {
    const transport = vi.fn(async () => Response.json({ choices: [] }));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["vision.example.test"],
      dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
      requestAdapter: transport,
      maxRedirects: 0,
    });
    const fetch = createUnderstandingOpenAIFetch({
      baseURL: "https://vision.example.test/v1",
      outboundRequestPolicy,
    });

    await expect(fetch("https://vision.example.test/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer understanding-secret" },
      body: JSON.stringify({ prompt: "private understanding prompt" }),
    })).rejects.toMatchObject({ code: "private_network_not_allowed" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("does not replay the understanding prompt or credential after a redirect", async () => {
    const cancelBody = vi.fn();
    const transport = vi.fn(async () => new Response(
      new ReadableStream<Uint8Array>({ cancel: cancelBody }),
      {
        status: 307,
        headers: { location: "https://redirect.example.test/credential-sink" },
      },
    ));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["vision.example.test"],
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      requestAdapter: transport,
      maxRedirects: 0,
    });
    const fetch = createUnderstandingOpenAIFetch({
      baseURL: "https://vision.example.test/v1",
      outboundRequestPolicy,
    });

    await expect(fetch("https://vision.example.test/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer understanding-secret" },
      body: JSON.stringify({ prompt: "private understanding prompt" }),
    })).rejects.toMatchObject({ code: "redirect_limit" });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("cancels a declared oversized response before the SDK parses it", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), {
      status: 200,
      headers: {
        "content-length": String(UNDERSTANDING_OPENAI_MAX_RESPONSE_BYTES + 1),
        "content-type": "application/json",
      },
    });
    const request = vi.fn(async () => ({
      response,
      url: new URL("https://vision.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const fetch = createUnderstandingOpenAIFetch({
      baseURL: "https://vision.example.test/v1",
      outboundRequestPolicy: { request },
    });

    await expect(fetch("https://vision.example.test/v1/chat/completions", {
      method: "POST",
      body: "{}",
    })).rejects.toThrow("OpenAI understanding response exceeds 1048576 byte limit.");
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
    const request = vi.fn(async () => ({
      response,
      url: new URL("https://vision.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const fetch = createUnderstandingOpenAIFetch({
      baseURL: "https://vision.example.test/v1",
      outboundRequestPolicy: { request },
    });

    await expect(fetch("https://vision.example.test/v1/chat/completions", {
      method: "POST",
      body: "{}",
    })).rejects.toThrow("OpenAI understanding response exceeds 1048576 byte limit.");
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending response body when the understanding request is aborted", async () => {
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
      url: new URL("https://vision.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const fetch = createUnderstandingOpenAIFetch({
      baseURL: "https://vision.example.test/v1",
      outboundRequestPolicy: { request },
    });
    const controller = new AbortController();

    const responsePromise = fetch("https://vision.example.test/v1/chat/completions", {
      method: "POST",
      body: "{}",
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    controller.abort(new Error("understanding cancelled"));

    await expect(responsePromise).rejects.toThrow("understanding cancelled");
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });
});
