import { OutboundRequestPolicy, type OutboundRequestAdapterInput } from "@belldandy/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { requestMemoryChunkSummaryModel } from "./memory-chunk-summary-model-request.js";
import { MemoryModelPrivacyRuntime } from "./memory-model-privacy.js";

const MAX_RESPONSE_BYTES = 1024 * 1024;

describe("memory chunk summary model request", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends the active summary payload through the configured pinned endpoint", async () => {
    const legacyFetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", legacyFetch);
    const transport = vi.fn(async (_input: OutboundRequestAdapterInput) => new Response(JSON.stringify({
      choices: [{ message: { content: "bounded chunk summary" } }],
    }), { status: 200 }));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["summary.example.test"],
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      requestAdapter: transport,
      maxRedirects: 0,
    });
    const payload = {
      model: "summary-model",
      messages: [
        { role: "system", content: "summary system" },
        { role: "user", content: "summary source" },
      ],
      max_tokens: 150,
      temperature: 0.3,
    };

    await expect(requestMemoryChunkSummaryModel({
      baseUrl: "https://summary.example.test/openai",
      apiKey: "summary-secret",
      payload,
      timeoutMs: 120_000,
      outboundRequestPolicy,
    })).resolves.toEqual({
      choices: [{ message: { content: "bounded chunk summary" } }],
    });

    const request = transport.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      url: new URL("https://summary.example.test/openai/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 }],
      init: {
        method: "POST",
        maxRedirects: 0,
        idleTimeoutMs: 120_000,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer summary-secret",
        },
      },
    });
    expect(JSON.parse(String(request?.init.body))).toEqual(payload);
    expect(legacyFetch).not.toHaveBeenCalled();
  });

  it("sends a redacted summary copy without modifying the original payload", async () => {
    const request = vi.fn(async (_input: { body?: string }) => ({
      response: new Response(JSON.stringify({
        choices: [{ message: { content: "summary-result" } }],
      }), { status: 200 }),
      url: new URL("https://summary.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const privacyRuntime = new MemoryModelPrivacyRuntime({
      redactor: (text) => text.replace("summary-private-body", "[REDACTED]"),
    });
    const payload = {
      model: "summary-model",
      messages: [{ role: "user", content: "summary-private-body" }],
    };

    await requestMemoryChunkSummaryModel({
      baseUrl: "https://summary.example.test/v1",
      apiKey: "summary-secret",
      payload,
      timeoutMs: 120_000,
      privacyRuntime,
      outboundRequestPolicy: { request } as any,
    });

    expect(payload.messages[0]?.content).toBe("summary-private-body");
    expect(JSON.parse(String(request.mock.calls[0]?.[0].body))).toEqual({
      model: "summary-model",
      messages: [{ role: "user", content: "[REDACTED]" }],
    });
    expect(privacyRuntime.getDoctorReport().items[0]).toMatchObject({
      jobFamily: "idle_summary",
      dataClass: "private_summary",
      trustProfile: "untrusted_remote",
      status: "succeeded",
    });
  });

  it("rejects private DNS before sending the summary content or credential", async () => {
    const transport = vi.fn(async () => new Response(null, { status: 204 }));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["summary.example.test"],
      dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
      requestAdapter: transport,
    });

    await expect(requestMemoryChunkSummaryModel({
      baseUrl: "https://summary.example.test/v1",
      apiKey: "summary-secret",
      payload: { model: "summary-model", content: "sensitive chunk content" },
      timeoutMs: 120_000,
      outboundRequestPolicy,
    })).rejects.toMatchObject({ code: "private_network_not_allowed" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("propagates the idle summary owner cancellation to the model request", async () => {
    let requestSignal: AbortSignal | undefined;
    const request = vi.fn(async (input: { signal?: AbortSignal }) => {
      requestSignal = input.signal;
      return await new Promise<never>((_resolve, reject) => {
        input.signal?.addEventListener("abort", () => reject(input.signal?.reason), { once: true });
      });
    });
    const controller = new AbortController();
    const result = requestMemoryChunkSummaryModel({
      baseUrl: "https://summary.example.test/v1",
      apiKey: "summary-secret",
      payload: { model: "summary-model" },
      timeoutMs: 120_000,
      signal: controller.signal,
      outboundRequestPolicy: { request } as any,
    });

    controller.abort(new Error("idle summary owner stopped"));

    await expect(result).rejects.toThrow("idle summary owner stopped");
    expect(requestSignal?.aborted).toBe(true);
  });

  it("rejects an insecure configured endpoint without calling legacy fetch", async () => {
    const legacyFetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", legacyFetch);

    await expect(requestMemoryChunkSummaryModel({
      baseUrl: "http://summary.example.test/v1",
      apiKey: "summary-secret",
      payload: { model: "summary-model" },
      timeoutMs: 120_000,
    })).rejects.toMatchObject({ code: "insecure_scheme" });
    expect(legacyFetch).not.toHaveBeenCalled();
  });

  it("does not replay the summary credential or content after a 307 response", async () => {
    const cancelBody = vi.fn();
    const transport = vi.fn(async (_input: OutboundRequestAdapterInput) => new Response(
      new ReadableStream<Uint8Array>({ cancel: cancelBody }),
      {
        status: 307,
        headers: { location: "https://redirect.example.test/credential-sink" },
      },
    ));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["summary.example.test"],
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      requestAdapter: transport,
      maxRedirects: 0,
    });

    await expect(requestMemoryChunkSummaryModel({
      baseUrl: "https://summary.example.test/v1",
      apiKey: "summary-secret",
      payload: { model: "summary-model", content: "sensitive chunk content" },
      timeoutMs: 120_000,
      outboundRequestPolicy,
    })).rejects.toMatchObject({ code: "redirect_limit" });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("does not include provider response content in summary errors", async () => {
    const responseBody = `  overloaded:${"x".repeat(240)}  `;
    const request = vi.fn(async () => ({
      response: new Response(responseBody, { status: 503 }),
      url: new URL("https://summary.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestMemoryChunkSummaryModel({
      baseUrl: "https://summary.example.test/v1",
      apiKey: "summary-secret",
      payload: { model: "summary-model" },
      timeoutMs: 120_000,
      outboundRequestPolicy: { request },
    })).rejects.toThrow("Summary LLM call failed: 503.");
  });

  it("cancels a successful response whose declared body exceeds the byte limit", async () => {
    const cancelBody = vi.fn();
    const request = vi.fn(async () => ({
      response: new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("{}"));
          controller.close();
        },
        cancel: cancelBody,
      }), {
        status: 200,
        headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) },
      }),
      url: new URL("https://summary.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestMemoryChunkSummaryModel({
      baseUrl: "https://summary.example.test/v1",
      apiKey: "summary-secret",
      payload: { model: "summary-model" },
      timeoutMs: 120_000,
      outboundRequestPolicy: { request },
    })).rejects.toThrow(`Summary LLM response exceeds ${MAX_RESPONSE_BYTES} byte limit.`);
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("rejects and cancels a response with an invalid Content-Length", async () => {
    const cancelBody = vi.fn();
    const request = vi.fn(async () => ({
      response: new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), {
        status: 200,
        headers: { "content-length": "not-a-number" },
      }),
      url: new URL("https://summary.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestMemoryChunkSummaryModel({
      baseUrl: "https://summary.example.test/v1",
      apiKey: "summary-secret",
      payload: { model: "summary-model" },
      timeoutMs: 120_000,
      outboundRequestPolicy: { request },
    })).rejects.toThrow("Summary LLM response has invalid Content-Length.");
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("cancels an error response whose streamed body exceeds the byte limit", async () => {
    const cancelBody = vi.fn();
    const request = vi.fn(async () => ({
      response: new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES + 1));
        },
        cancel: cancelBody,
      }), { status: 503 }),
      url: new URL("https://summary.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestMemoryChunkSummaryModel({
      baseUrl: "https://summary.example.test/v1",
      apiKey: "summary-secret",
      payload: { model: "summary-model" },
      timeoutMs: 120_000,
      outboundRequestPolicy: { request },
    })).rejects.toThrow(`Summary LLM response exceeds ${MAX_RESPONSE_BYTES} byte limit.`);
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("applies the total deadline after headers while a successful body remains pending", async () => {
    vi.useFakeTimers();
    const cancelBody = vi.fn();
    const request = vi.fn(async () => ({
      response: new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), { status: 200 }),
      url: new URL("https://summary.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const outcome = Promise.race([
      requestMemoryChunkSummaryModel({
        baseUrl: "https://summary.example.test/v1",
        apiKey: "summary-secret",
        payload: { model: "summary-model" },
        timeoutMs: 25,
        outboundRequestPolicy: { request },
      }).then(
        () => "unexpected-success",
        (error: unknown) => error,
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve("deadline-missed"), 50)),
    ]);

    await vi.advanceTimersByTimeAsync(50);

    await expect(outcome).resolves.toMatchObject({
      message: "Summary LLM call timed out after 25ms",
    });
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });
});
