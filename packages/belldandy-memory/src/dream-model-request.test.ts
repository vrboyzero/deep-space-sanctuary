import { OutboundRequestPolicy, type OutboundRequestAdapterInput } from "@belldandy/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DREAM_MODEL_MAX_RESPONSE_BYTES,
  requestDreamModel,
} from "./dream-model-request.js";
import { MemoryModelPrivacyRuntime } from "./memory-model-privacy.js";

describe("dream model request", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends the active reasoning payload through the configured pinned endpoint", async () => {
    const legacyFetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", legacyFetch);
    const transport = vi.fn(async (_input: OutboundRequestAdapterInput) => new Response(JSON.stringify({
      choices: [{
        finish_reason: "stop",
        message: { content: "dream-json", reasoning_content: "reasoning" },
      }],
    }), { status: 200 }));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["dream.example.test"],
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      requestAdapter: transport,
      maxRedirects: 0,
    });
    const payload = {
      model: "dream-model",
      messages: [
        { role: "system", content: "dream system" },
        { role: "user", content: "dream input" },
      ],
      max_tokens: 1_000,
      temperature: 0.3,
      thinking: { type: "enabled" },
      reasoning_effort: "high",
    };

    await expect(requestDreamModel({
      baseUrl: "https://dream.example.test/openai",
      apiKey: "dream-secret",
      payload,
      timeoutMs: 120_000,
      outboundRequestPolicy,
    })).resolves.toEqual({
      choices: [{
        finish_reason: "stop",
        message: { content: "dream-json", reasoning_content: "reasoning" },
      }],
    });

    const request = transport.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      url: new URL("https://dream.example.test/openai/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 }],
      init: {
        method: "POST",
        maxRedirects: 0,
        idleTimeoutMs: 120_000,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer dream-secret",
        },
      },
    });
    expect(JSON.parse(String(request?.init.body))).toEqual(payload);
    expect(legacyFetch).not.toHaveBeenCalled();
  });

  it("sends a redacted dream copy without modifying the original payload", async () => {
    const request = vi.fn(async (_input: { body?: string }) => ({
      response: new Response(JSON.stringify({
        choices: [{ message: { content: "dream-result" } }],
      }), { status: 200 }),
      url: new URL("https://dream.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const privacyRuntime = new MemoryModelPrivacyRuntime({
      trustedRemoteHosts: ["dream.example.test"],
      redactor: (text) => text.replace("dream-private-body", "[REDACTED]"),
    });
    const payload = {
      model: "dream-model",
      messages: [{ role: "user", content: "dream-private-body" }],
    };

    await requestDreamModel({
      baseUrl: "https://dream.example.test/v1",
      apiKey: "dream-secret",
      payload,
      timeoutMs: 120_000,
      privacyRuntime,
      outboundRequestPolicy: { request } as any,
    });

    expect(payload.messages[0]?.content).toBe("dream-private-body");
    expect(JSON.parse(String(request.mock.calls[0]?.[0].body))).toEqual({
      model: "dream-model",
      messages: [{ role: "user", content: "[REDACTED]" }],
    });
    expect(privacyRuntime.getDoctorReport().items[0]).toMatchObject({
      jobFamily: "dream",
      dataClass: "private_summary",
      trustProfile: "trusted_remote",
      redactorStatus: "enabled",
      status: "succeeded",
      httpStatus: 200,
      responseBytes: expect.any(Number),
    });
  });

  it("rejects private DNS before sending the dream prompt or credential", async () => {
    const transport = vi.fn(async () => new Response(null, { status: 204 }));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["dream.example.test"],
      dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
      requestAdapter: transport,
    });

    await expect(requestDreamModel({
      baseUrl: "https://dream.example.test/v1",
      apiKey: "dream-secret",
      payload: { model: "dream-model", prompt: "sensitive dream input" },
      timeoutMs: 120_000,
      outboundRequestPolicy,
    })).rejects.toMatchObject({ code: "private_network_not_allowed" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("propagates the owning background job cancellation to the model request", async () => {
    let requestSignal: AbortSignal | undefined;
    const request = vi.fn(async (input: { signal?: AbortSignal }) => {
      requestSignal = input.signal;
      return await new Promise<never>((_resolve, reject) => {
        input.signal?.addEventListener("abort", () => reject(input.signal?.reason), { once: true });
      });
    });
    const controller = new AbortController();
    const result = requestDreamModel({
      baseUrl: "https://dream.example.test/v1",
      apiKey: "dream-secret",
      payload: { model: "dream-model" },
      timeoutMs: 120_000,
      signal: controller.signal,
      outboundRequestPolicy: { request } as any,
    });

    controller.abort(new Error("Dream background job stopped."));

    await expect(result).rejects.toThrow("Dream background job stopped.");
    expect(requestSignal?.aborted).toBe(true);
  });

  it("rejects an insecure configured endpoint without calling legacy fetch", async () => {
    const legacyFetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", legacyFetch);

    await expect(requestDreamModel({
      baseUrl: "http://dream.example.test/v1",
      apiKey: "dream-secret",
      payload: { model: "dream-model" },
      timeoutMs: 120_000,
    })).rejects.toMatchObject({ code: "insecure_scheme" });
    expect(legacyFetch).not.toHaveBeenCalled();
  });

  it("does not replay the dream credential or prompt after a 307 response", async () => {
    const cancelBody = vi.fn();
    const transport = vi.fn(async (_input: OutboundRequestAdapterInput) => new Response(
      new ReadableStream<Uint8Array>({ cancel: cancelBody }),
      {
        status: 307,
        headers: { location: "https://redirect.example.test/credential-sink" },
      },
    ));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["dream.example.test"],
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      requestAdapter: transport,
      maxRedirects: 0,
    });

    await expect(requestDreamModel({
      baseUrl: "https://dream.example.test/v1",
      apiKey: "dream-secret",
      payload: { model: "dream-model", prompt: "sensitive dream input" },
      timeoutMs: 120_000,
      outboundRequestPolicy,
    })).rejects.toMatchObject({ code: "redirect_limit" });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("does not include provider response content in dream errors", async () => {
    const responseBody = `  overloaded:${"x".repeat(240)}  `;
    const request = vi.fn(async () => ({
      response: new Response(responseBody, { status: 503 }),
      url: new URL("https://dream.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    await expect(requestDreamModel({
      baseUrl: "https://dream.example.test/v1",
      apiKey: "dream-secret",
      payload: { model: "dream-model" },
      timeoutMs: 120_000,
      outboundRequestPolicy: { request },
    })).rejects.toThrow("Dream LLM call failed: 503.");
  });

  it("cancels a successful response whose declared body exceeds the byte limit", async () => {
    const cancelBody = vi.fn();
    const request = vi.fn(async () => ({
      response: new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), {
        status: 200,
        headers: {
          "content-length": String(DREAM_MODEL_MAX_RESPONSE_BYTES + 1),
        },
      }),
      url: new URL("https://dream.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestDreamModel({
      baseUrl: "https://dream.example.test/v1",
      apiKey: "dream-secret",
      payload: { model: "dream-model" },
      timeoutMs: 120_000,
      outboundRequestPolicy: { request },
    })).rejects.toThrow(`Dream LLM response exceeds ${DREAM_MODEL_MAX_RESPONSE_BYTES} byte limit.`);
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("cancels an error response whose streamed body exceeds the byte limit", async () => {
    const cancelBody = vi.fn();
    const request = vi.fn(async () => ({
      response: new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(DREAM_MODEL_MAX_RESPONSE_BYTES + 1));
        },
        cancel: cancelBody,
      }), { status: 503 }),
      url: new URL("https://dream.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestDreamModel({
      baseUrl: "https://dream.example.test/v1",
      apiKey: "dream-secret",
      payload: { model: "dream-model" },
      timeoutMs: 120_000,
      outboundRequestPolicy: { request },
    })).rejects.toThrow(`Dream LLM response exceeds ${DREAM_MODEL_MAX_RESPONSE_BYTES} byte limit.`);
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("applies the total deadline after headers while a successful body remains pending", async () => {
    vi.useFakeTimers();
    const cancelBody = vi.fn();
    const request = vi.fn(async () => ({
      response: new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), { status: 200 }),
      url: new URL("https://dream.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const result = expect(requestDreamModel({
      baseUrl: "https://dream.example.test/v1",
      apiKey: "dream-secret",
      payload: { model: "dream-model" },
      timeoutMs: 25,
      outboundRequestPolicy: { request },
    })).rejects.toThrow("Dream LLM call timed out after 25ms");

    await vi.advanceTimersByTimeAsync(25);

    await result;
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });
});
