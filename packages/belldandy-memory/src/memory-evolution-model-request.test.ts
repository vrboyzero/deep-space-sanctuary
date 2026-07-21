import { OutboundRequestPolicy, type OutboundRequestAdapterInput } from "@belldandy/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { requestMemoryEvolutionModel } from "./memory-evolution-model-request.js";
import { MemoryModelPrivacyRuntime } from "./memory-model-privacy.js";

const MAX_RESPONSE_BYTES = 1024 * 1024;

describe("memory evolution model request", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the active evolution payload through the configured pinned endpoint", async () => {
    const legacyFetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", legacyFetch);
    const transport = vi.fn(async (_input: OutboundRequestAdapterInput) => new Response(JSON.stringify({
      choices: [{ message: { content: "[]" } }],
    }), { status: 200 }));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["evolution.example.test"],
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      requestAdapter: transport,
      maxRedirects: 0,
    });
    const controller = new AbortController();
    const payload = {
      model: "MiniMax-M2.5",
      messages: [
        { role: "system", content: "evolution system" },
        { role: "user", content: "private conversation" },
      ],
      max_tokens: 500,
      temperature: 0.3,
      reasoning_split: true,
    };

    await expect(requestMemoryEvolutionModel({
      baseUrl: "https://evolution.example.test/openai",
      apiKey: "evolution-secret",
      payload,
      signal: controller.signal,
      idleTimeoutMs: 120_000,
      outboundRequestPolicy,
    })).resolves.toEqual({
      choices: [{ message: { content: "[]" } }],
    });

    const request = transport.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      url: new URL("https://evolution.example.test/openai/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 }],
      init: {
        method: "POST",
        signal: controller.signal,
        maxRedirects: 0,
        idleTimeoutMs: 120_000,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer evolution-secret",
        },
      },
    });
    expect(JSON.parse(String(request?.init.body))).toEqual(payload);
    expect(legacyFetch).not.toHaveBeenCalled();
  });

  it("sends a redacted evolution copy without modifying the original payload", async () => {
    const request = vi.fn(async (_input: { body?: string }) => ({
      response: new Response(JSON.stringify({
        choices: [{ message: { content: "[]" } }],
      }), { status: 200 }),
      url: new URL("https://evolution.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const privacyRuntime = new MemoryModelPrivacyRuntime({
      redactor: (text) => text.replace("evolution-private-body", "[REDACTED]"),
    });
    const payload = {
      model: "evolution-model",
      messages: [{ role: "user", content: "evolution-private-body" }],
    };

    await requestMemoryEvolutionModel({
      baseUrl: "https://evolution.example.test/v1",
      apiKey: "evolution-secret",
      payload,
      idleTimeoutMs: 120_000,
      privacyRuntime,
      outboundRequestPolicy: { request } as any,
    });

    expect(payload.messages[0]?.content).toBe("evolution-private-body");
    expect(JSON.parse(String(request.mock.calls[0]?.[0].body))).toEqual({
      model: "evolution-model",
      messages: [{ role: "user", content: "[REDACTED]" }],
    });
    expect(privacyRuntime.getDoctorReport().items[0]).toMatchObject({
      jobFamily: "durable_extraction",
      dataClass: "private_summary",
      trustProfile: "untrusted_remote",
      status: "succeeded",
    });
  });

  it("rejects private DNS before sending the conversation or credential", async () => {
    const transport = vi.fn(async () => new Response(null, { status: 204 }));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["evolution.example.test"],
      dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
      requestAdapter: transport,
    });

    await expect(requestMemoryEvolutionModel({
      baseUrl: "https://evolution.example.test/v1",
      apiKey: "evolution-secret",
      payload: { model: "evolution-model", conversation: "private conversation" },
      idleTimeoutMs: 120_000,
      outboundRequestPolicy,
    })).rejects.toMatchObject({ code: "private_network_not_allowed" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects an insecure configured endpoint without calling legacy fetch", async () => {
    const legacyFetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", legacyFetch);

    await expect(requestMemoryEvolutionModel({
      baseUrl: "http://evolution.example.test/v1",
      apiKey: "evolution-secret",
      payload: { model: "evolution-model" },
      idleTimeoutMs: 120_000,
    })).rejects.toMatchObject({ code: "insecure_scheme" });
    expect(legacyFetch).not.toHaveBeenCalled();
  });

  it("does not replay the evolution credential or conversation after a 307 response", async () => {
    const cancelBody = vi.fn();
    const transport = vi.fn(async (_input: OutboundRequestAdapterInput) => new Response(
      new ReadableStream<Uint8Array>({ cancel: cancelBody }),
      {
        status: 307,
        headers: { location: "https://redirect.example.test/credential-sink" },
      },
    ));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["evolution.example.test"],
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      requestAdapter: transport,
      maxRedirects: 0,
    });

    await expect(requestMemoryEvolutionModel({
      baseUrl: "https://evolution.example.test/v1",
      apiKey: "evolution-secret",
      payload: { model: "evolution-model", conversation: "private conversation" },
      idleTimeoutMs: 120_000,
      outboundRequestPolicy,
    })).rejects.toMatchObject({ code: "redirect_limit" });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("does not include provider response content in evolution errors", async () => {
    const responseBody = `  overloaded:${"x".repeat(240)}  `;
    const request = vi.fn(async () => ({
      response: new Response(responseBody, { status: 503 }),
      url: new URL("https://evolution.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestMemoryEvolutionModel({
      baseUrl: "https://evolution.example.test/v1",
      apiKey: "evolution-secret",
      payload: { model: "evolution-model" },
      idleTimeoutMs: 120_000,
      outboundRequestPolicy: { request },
    })).rejects.toThrow("Evolution LLM call failed: 503.");
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
      url: new URL("https://evolution.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestMemoryEvolutionModel({
      baseUrl: "https://evolution.example.test/v1",
      apiKey: "evolution-secret",
      payload: { model: "evolution-model" },
      idleTimeoutMs: 120_000,
      outboundRequestPolicy: { request },
    })).rejects.toThrow(`Evolution LLM response exceeds ${MAX_RESPONSE_BYTES} byte limit.`);
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
      url: new URL("https://evolution.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestMemoryEvolutionModel({
      baseUrl: "https://evolution.example.test/v1",
      apiKey: "evolution-secret",
      payload: { model: "evolution-model" },
      idleTimeoutMs: 120_000,
      outboundRequestPolicy: { request },
    })).rejects.toThrow(`Evolution LLM response exceeds ${MAX_RESPONSE_BYTES} byte limit.`);
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending response body when the caller aborts after headers", async () => {
    const cancelBody = vi.fn();
    const request = vi.fn(async () => ({
      response: new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), { status: 200 }),
      url: new URL("https://evolution.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const controller = new AbortController();
    const modelRequest = requestMemoryEvolutionModel({
      baseUrl: "https://evolution.example.test/v1",
      apiKey: "evolution-secret",
      payload: { model: "evolution-model" },
      signal: controller.signal,
      idleTimeoutMs: 120_000,
      outboundRequestPolicy: { request },
    });
    const outcome = Promise.race([
      modelRequest.then(
        () => "unexpected-success",
        (error: unknown) => error,
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve("abort-missed"), 25)),
    ]);

    controller.abort(new Error("Memory manager is closing."));

    await expect(outcome).resolves.toMatchObject({ message: "Memory manager is closing." });
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });
});
