import { OutboundRequestPolicy, type OutboundRequestAdapterInput } from "@belldandy/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MODEL_CONNECTIVITY_MAX_ERROR_BODY_BYTES,
  requestModelConnectivityCheck,
} from "./model-connectivity-check.js";

describe("model connectivity check request", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects private DNS before the configured endpoint transport", async () => {
    const transport = vi.fn(async () => new Response(null, { status: 204 }));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["model.example.test"],
      dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
      requestAdapter: transport,
    });

    await expect(requestModelConnectivityCheck({
      baseUrl: "https://model.example.test/v1",
      apiKey: "sk-primary",
      model: "primary-model",
      wireApi: "chat_completions",
      timeoutMs: 10_000,
      outboundRequestPolicy,
    })).rejects.toMatchObject({ code: "private_network_not_allowed" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("preserves the active chat-completions probe and cancels its success body", async () => {
    const cancelBody = vi.fn();
    const transport = vi.fn(async (_input: OutboundRequestAdapterInput) => new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"ignored":true}'));
        },
        cancel: cancelBody,
      }),
      { status: 200 },
    ));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["model.example.test"],
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      requestAdapter: transport,
    });

    await expect(requestModelConnectivityCheck({
      baseUrl: "https://model.example.test",
      apiKey: "sk-primary",
      model: "primary-model",
      wireApi: "chat_completions",
      timeoutMs: 10_000,
      outboundRequestPolicy,
    })).resolves.toEqual({ ok: true });

    const request = transport.mock.calls[0]?.[0];
    expect(request?.url.toString()).toBe("https://model.example.test/v1/chat/completions");
    expect(request?.init).toMatchObject({
      method: "POST",
      maxRedirects: 0,
      idleTimeoutMs: 10_000,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-primary",
      },
    });
    expect(JSON.parse(String(request?.init.body))).toEqual({
      model: "primary-model",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1,
    });
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("preserves the active responses probe contract", async () => {
    const request = vi.fn(async (input: { url: string | URL; body?: string | Uint8Array }) => ({
      response: new Response(null, { status: 204 }),
      url: new URL(input.url),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestModelConnectivityCheck({
      baseUrl: "https://model.example.test/v1/",
      apiKey: "sk-primary",
      model: "responses-model",
      wireApi: "responses",
      timeoutMs: 10_000,
      outboundRequestPolicy: { request },
    })).resolves.toEqual({ ok: true });

    expect(request.mock.calls[0]?.[0].url.toString()).toBe("https://model.example.test/v1/responses");
    expect(JSON.parse(String(request.mock.calls[0]?.[0].body))).toEqual({
      model: "responses-model",
      input: "hi",
      max_output_tokens: 1,
    });
  });

  it("returns a bounded failure body for Doctor diagnostics", async () => {
    const response = new Response("provider overloaded", { status: 429 });
    const request = vi.fn(async () => ({
      response,
      url: new URL("https://model.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestModelConnectivityCheck({
      baseUrl: "https://model.example.test/v1",
      apiKey: "sk-primary",
      model: "primary-model",
      wireApi: "chat_completions",
      timeoutMs: 10_000,
      outboundRequestPolicy: { request },
    })).resolves.toEqual({
      ok: false,
      status: 429,
      responseBody: "provider overloaded",
    });
  });

  it("rejects an insecure configured endpoint without calling legacy fetch", async () => {
    const legacyFetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", legacyFetch);

    await expect(requestModelConnectivityCheck({
      baseUrl: "http://model.example.test/v1",
      apiKey: "sk-primary",
      model: "primary-model",
      wireApi: "chat_completions",
      timeoutMs: 10_000,
    })).rejects.toMatchObject({ code: "insecure_scheme" });
    expect(legacyFetch).not.toHaveBeenCalled();
  });

  it("does not replay probe credentials or body after a 307 response", async () => {
    const transport = vi.fn(async (_input: OutboundRequestAdapterInput) => new Response(null, {
      status: 307,
      headers: { location: "https://redirect.example.test/credential-sink" },
    }));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["model.example.test"],
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      requestAdapter: transport,
    });

    await expect(requestModelConnectivityCheck({
      baseUrl: "https://model.example.test/v1",
      apiKey: "sk-primary",
      model: "primary-model",
      wireApi: "chat_completions",
      timeoutMs: 10_000,
      outboundRequestPolicy,
    })).rejects.toMatchObject({ code: "redirect_limit" });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[0]?.init.headers?.Authorization).toBe("Bearer sk-primary");
  });

  it("cancels a failure response whose declared length exceeds the limit", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("oversized provider error"));
      },
      cancel: cancelBody,
    }), {
      status: 500,
      headers: { "content-length": String(MODEL_CONNECTIVITY_MAX_ERROR_BODY_BYTES + 1) },
    });
    const request = vi.fn(async () => ({
      response,
      url: new URL("https://model.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestModelConnectivityCheck({
      baseUrl: "https://model.example.test/v1",
      apiKey: "sk-primary",
      model: "primary-model",
      wireApi: "chat_completions",
      timeoutMs: 10_000,
      outboundRequestPolicy: { request },
    })).rejects.toThrow("Model connectivity response exceeds 65536 byte limit.");
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("cancels a failure response that crosses the cumulative byte limit", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(48 * 1024));
        controller.enqueue(new Uint8Array(20 * 1024));
      },
      cancel: cancelBody,
    }), { status: 500 });
    const request = vi.fn(async () => ({
      response,
      url: new URL("https://model.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestModelConnectivityCheck({
      baseUrl: "https://model.example.test/v1",
      apiKey: "sk-primary",
      model: "primary-model",
      wireApi: "chat_completions",
      timeoutMs: 10_000,
      outboundRequestPolicy: { request },
    })).rejects.toThrow("Model connectivity response exceeds 65536 byte limit.");
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("keeps the total timeout active while reading a pending failure body", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => {});
      },
      cancel: cancelBody,
    }), { status: 500 });
    const request = vi.fn(async () => ({
      response,
      url: new URL("https://model.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestModelConnectivityCheck({
      baseUrl: "https://model.example.test/v1",
      apiKey: "sk-primary",
      model: "primary-model",
      wireApi: "chat_completions",
      timeoutMs: 5,
      outboundRequestPolicy: { request },
    })).rejects.toThrow("Model connectivity check timed out after 5ms.");
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });
});
