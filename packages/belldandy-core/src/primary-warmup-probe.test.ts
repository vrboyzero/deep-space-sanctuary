import { OutboundRequestPolicy, type OutboundRequestAdapterInput } from "@belldandy/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PRIMARY_WARMUP_MAX_ERROR_BODY_BYTES,
  requestPrimaryModelWarmup,
} from "./primary-warmup-probe.js";

describe("primary model warmup probe", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects private DNS before the configured endpoint transport", async () => {
    const transport = vi.fn(async (_input: OutboundRequestAdapterInput) => new Response(null, { status: 204 }));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["model.example.test"],
      dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
      requestAdapter: transport,
    });

    await expect(requestPrimaryModelWarmup({
      baseUrl: "https://model.example.test/v1",
      apiKey: "sk-primary",
      model: "primary-model",
      wireApi: "chat_completions",
      timeoutMs: 8_000,
      outboundRequestPolicy,
    })).rejects.toMatchObject({ code: "private_network_not_allowed" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("preserves the active chat-completions warmup request contract", async () => {
    const transport = vi.fn(async (_input: OutboundRequestAdapterInput) => new Response(null, { status: 204 }));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["model.example.test"],
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      requestAdapter: transport,
    });

    await expect(requestPrimaryModelWarmup({
      baseUrl: "https://model.example.test",
      apiKey: "sk-primary",
      model: "primary-model",
      wireApi: "chat_completions",
      thinking: "enabled",
      reasoningEffort: "high",
      timeoutMs: 8_000,
      outboundRequestPolicy,
    })).resolves.toEqual({ ok: true });

    expect(transport).toHaveBeenCalledTimes(1);
    const request = transport.mock.calls[0]?.[0];
    expect(request?.url.toString()).toBe("https://model.example.test/v1/chat/completions");
    expect(request?.init).toMatchObject({
      method: "POST",
      maxRedirects: 0,
      idleTimeoutMs: 8_000,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-primary",
      },
    });
    expect(JSON.parse(String(request?.init.body))).toEqual({
      model: "primary-model",
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 8,
      thinking: "enabled",
      reasoning_effort: "high",
    });
  });

  it("returns a bounded non-success body for failover classification", async () => {
    const response = new Response("provider overloaded", { status: 429 });
    const request = vi.fn(async () => ({
      response,
      url: new URL("https://model.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestPrimaryModelWarmup({
      baseUrl: "https://model.example.test/v1",
      apiKey: "sk-primary",
      model: "primary-model",
      wireApi: "chat_completions",
      timeoutMs: 8_000,
      outboundRequestPolicy: { request },
    })).resolves.toEqual({
      ok: false,
      status: 429,
      responseBody: "provider overloaded",
    });
  });

  it("cancels an unused success response body", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"ignored":true}'));
      },
      cancel: cancelBody,
    }), { status: 200 });
    const request = vi.fn(async () => ({
      response,
      url: new URL("https://model.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestPrimaryModelWarmup({
      baseUrl: "https://model.example.test/v1",
      apiKey: "sk-primary",
      model: "primary-model",
      wireApi: "chat_completions",
      timeoutMs: 8_000,
      outboundRequestPolicy: { request },
    })).resolves.toEqual({ ok: true });
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("preserves the active responses warmup request contract", async () => {
    const request = vi.fn(async (input: { url: string | URL; body?: string | Uint8Array }) => ({
      response: new Response(null, { status: 204 }),
      url: new URL(input.url),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestPrimaryModelWarmup({
      baseUrl: "https://model.example.test/v1/",
      apiKey: "sk-primary",
      model: "responses-model",
      wireApi: "responses",
      timeoutMs: 8_000,
      outboundRequestPolicy: { request },
    })).resolves.toEqual({ ok: true });

    expect(request.mock.calls[0]?.[0].url.toString()).toBe("https://model.example.test/v1/responses");
    expect(JSON.parse(String(request.mock.calls[0]?.[0].body))).toEqual({
      model: "responses-model",
      input: "ping",
      max_output_tokens: 8,
    });
  });

  it("rejects an insecure configured endpoint before transport", async () => {
    const legacyFetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", legacyFetch);

    await expect(requestPrimaryModelWarmup({
      baseUrl: "http://model.example.test/v1",
      apiKey: "sk-primary",
      model: "primary-model",
      wireApi: "chat_completions",
      timeoutMs: 8_000,
    })).rejects.toMatchObject({ code: "insecure_scheme" });
    expect(legacyFetch).not.toHaveBeenCalled();
  });

  it("does not replay warmup credentials or body after a 307 response", async () => {
    const transport = vi.fn(async (_input: OutboundRequestAdapterInput) => new Response(null, {
      status: 307,
      headers: { location: "https://redirect.example.test/credential-sink" },
    }));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["model.example.test"],
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      requestAdapter: transport,
    });

    await expect(requestPrimaryModelWarmup({
      baseUrl: "https://model.example.test/v1",
      apiKey: "sk-primary",
      model: "primary-model",
      wireApi: "chat_completions",
      timeoutMs: 8_000,
      outboundRequestPolicy,
    })).rejects.toMatchObject({ code: "redirect_limit" });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[0]?.init.headers?.Authorization).toBe("Bearer sk-primary");
  });

  it("cancels a failure response whose declared length exceeds the limit", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("oversized error"));
      },
      cancel: cancelBody,
    }), {
      status: 500,
      headers: { "content-length": String(PRIMARY_WARMUP_MAX_ERROR_BODY_BYTES + 1) },
    });
    const request = vi.fn(async () => ({
      response,
      url: new URL("https://model.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestPrimaryModelWarmup({
      baseUrl: "https://model.example.test/v1",
      apiKey: "sk-primary",
      model: "primary-model",
      wireApi: "chat_completions",
      timeoutMs: 8_000,
      outboundRequestPolicy: { request },
    })).rejects.toThrow("Primary model warmup response exceeds 65536 byte limit.");
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

    await expect(requestPrimaryModelWarmup({
      baseUrl: "https://model.example.test/v1",
      apiKey: "sk-primary",
      model: "primary-model",
      wireApi: "chat_completions",
      timeoutMs: 8_000,
      outboundRequestPolicy: { request },
    })).rejects.toThrow("Primary model warmup response exceeds 65536 byte limit.");
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

    await expect(requestPrimaryModelWarmup({
      baseUrl: "https://model.example.test/v1",
      apiKey: "sk-primary",
      model: "primary-model",
      wireApi: "chat_completions",
      timeoutMs: 5,
      outboundRequestPolicy: { request },
    })).rejects.toThrow("Primary model warmup timed out after 5ms.");
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });
});
