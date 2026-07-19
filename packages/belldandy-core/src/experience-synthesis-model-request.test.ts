import { OutboundRequestPolicy, type OutboundRequestAdapterInput } from "@belldandy/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EXPERIENCE_SYNTHESIS_MODEL_MAX_RESPONSE_BYTES,
  requestExperienceSynthesisModel,
} from "./experience-synthesis-model-request.js";

describe("experience synthesis model request", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects private DNS before the configured endpoint transport", async () => {
    const transport = vi.fn(async () => Response.json({ choices: [] }));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["model.example.test"],
      dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
      requestAdapter: transport,
    });

    await expect(requestExperienceSynthesisModel({
      baseUrl: "https://model.example.test/v1",
      apiKey: "sk-primary",
      model: "primary-model",
      system: "Synthesize approved experience.",
      user: "Source candidates",
      timeoutMs: 8_000,
      outboundRequestPolicy,
    })).rejects.toMatchObject({ code: "private_network_not_allowed" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("preserves the active synthesis request and returns its JSON payload", async () => {
    const responsePayload = {
      choices: [{
        message: { content: "synthesized content" },
        finish_reason: "stop",
      }],
    };
    const transport = vi.fn(async (_input: OutboundRequestAdapterInput) => Response.json(responsePayload));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["model.example.test"],
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      requestAdapter: transport,
    });

    await expect(requestExperienceSynthesisModel({
      baseUrl: "https://model.example.test",
      apiKey: "sk-primary",
      model: "reasoning-model",
      system: "Synthesize approved experience.",
      user: "Source candidates",
      thinking: { type: "enabled", budget_tokens: 4096 },
      reasoningEffort: "high",
      timeoutMs: 8_000,
      outboundRequestPolicy,
    })).resolves.toEqual(responsePayload);

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
      model: "reasoning-model",
      messages: [
        { role: "system", content: "Synthesize approved experience." },
        { role: "user", content: "Source candidates" },
      ],
      temperature: 0.2,
      max_tokens: 8_000,
      thinking: { type: "enabled", budget_tokens: 4096 },
      reasoning_effort: "high",
    });
  });

  it("rejects an insecure configured endpoint without calling legacy fetch", async () => {
    const legacyFetch = vi.fn(async () => Response.json({ choices: [] }));
    vi.stubGlobal("fetch", legacyFetch);

    await expect(requestExperienceSynthesisModel({
      baseUrl: "http://model.example.test/v1",
      apiKey: "sk-primary",
      model: "primary-model",
      system: "Synthesize approved experience.",
      user: "Source candidates",
      timeoutMs: 8_000,
    })).rejects.toMatchObject({ code: "insecure_scheme" });
    expect(legacyFetch).not.toHaveBeenCalled();
  });

  it("does not replay credentials or prompts after a 307 response", async () => {
    const transport = vi.fn(async (_input: OutboundRequestAdapterInput) => new Response(null, {
      status: 307,
      headers: { location: "https://redirect.example.test/credential-sink" },
    }));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["model.example.test"],
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      requestAdapter: transport,
    });

    await expect(requestExperienceSynthesisModel({
      baseUrl: "https://model.example.test/v1",
      apiKey: "sk-primary",
      model: "primary-model",
      system: "Sensitive system prompt",
      user: "Sensitive source candidates",
      timeoutMs: 8_000,
      outboundRequestPolicy,
    })).rejects.toMatchObject({ code: "redirect_limit" });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[0]?.init.headers?.Authorization).toBe("Bearer sk-primary");
  });

  it("preserves a bounded non-success diagnostic", async () => {
    const response = new Response("provider overloaded", { status: 429 });
    const request = vi.fn(async () => ({
      response,
      url: new URL("https://model.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestExperienceSynthesisModel({
      baseUrl: "https://model.example.test/v1",
      apiKey: "sk-primary",
      model: "primary-model",
      system: "Synthesize approved experience.",
      user: "Source candidates",
      timeoutMs: 8_000,
      outboundRequestPolicy: { request },
    })).rejects.toThrow("Experience synthesis model call failed: 429 provider overloaded");
  });

  it("cancels a success response whose declared length exceeds the limit", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"choices":[]}'));
      },
      cancel: cancelBody,
    }), {
      status: 200,
      headers: { "content-length": String(EXPERIENCE_SYNTHESIS_MODEL_MAX_RESPONSE_BYTES + 1) },
    });
    const request = vi.fn(async () => ({
      response,
      url: new URL("https://model.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestExperienceSynthesisModel({
      baseUrl: "https://model.example.test/v1",
      apiKey: "sk-primary",
      model: "primary-model",
      system: "Synthesize approved experience.",
      user: "Source candidates",
      timeoutMs: 8_000,
      outboundRequestPolicy: { request },
    })).rejects.toThrow("Experience synthesis model response exceeds 1048576 byte limit.");
    expect(cancelBody).toHaveBeenCalledTimes(1);
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
      headers: { "content-length": String(EXPERIENCE_SYNTHESIS_MODEL_MAX_RESPONSE_BYTES + 1) },
    });
    const request = vi.fn(async () => ({
      response,
      url: new URL("https://model.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestExperienceSynthesisModel({
      baseUrl: "https://model.example.test/v1",
      apiKey: "sk-primary",
      model: "primary-model",
      system: "Synthesize approved experience.",
      user: "Source candidates",
      timeoutMs: 8_000,
      outboundRequestPolicy: { request },
    })).rejects.toThrow("Experience synthesis model response exceeds 1048576 byte limit.");
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("cancels a success response that crosses the cumulative byte limit", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(700 * 1024));
        controller.enqueue(new Uint8Array(400 * 1024));
      },
      cancel: cancelBody,
    }), { status: 200 });
    const request = vi.fn(async () => ({
      response,
      url: new URL("https://model.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestExperienceSynthesisModel({
      baseUrl: "https://model.example.test/v1",
      apiKey: "sk-primary",
      model: "primary-model",
      system: "Synthesize approved experience.",
      user: "Source candidates",
      timeoutMs: 8_000,
      outboundRequestPolicy: { request },
    })).rejects.toThrow("Experience synthesis model response exceeds 1048576 byte limit.");
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("cancels a failure response that crosses the cumulative byte limit", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(700 * 1024));
        controller.enqueue(new Uint8Array(400 * 1024));
      },
      cancel: cancelBody,
    }), { status: 500 });
    const request = vi.fn(async () => ({
      response,
      url: new URL("https://model.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestExperienceSynthesisModel({
      baseUrl: "https://model.example.test/v1",
      apiKey: "sk-primary",
      model: "primary-model",
      system: "Synthesize approved experience.",
      user: "Source candidates",
      timeoutMs: 8_000,
      outboundRequestPolicy: { request },
    })).rejects.toThrow("Experience synthesis model response exceeds 1048576 byte limit.");
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("keeps the total timeout active while reading a pending success body", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => {});
      },
      cancel: cancelBody,
    }), { status: 200 });
    const request = vi.fn(async () => ({
      response,
      url: new URL("https://model.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestExperienceSynthesisModel({
      baseUrl: "https://model.example.test/v1",
      apiKey: "sk-primary",
      model: "primary-model",
      system: "Synthesize approved experience.",
      user: "Source candidates",
      timeoutMs: 5,
      outboundRequestPolicy: { request },
    })).rejects.toThrow("Experience synthesis model call timed out after 5ms.");
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });
});
