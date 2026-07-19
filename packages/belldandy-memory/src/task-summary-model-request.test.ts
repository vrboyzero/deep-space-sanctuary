import { OutboundRequestPolicy, type OutboundRequestAdapterInput } from "@belldandy/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  requestTaskSummaryModel,
  TASK_SUMMARY_MODEL_MAX_RESPONSE_BYTES,
} from "./task-summary-model-request.js";

describe("task summary model request", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the active task summary payload through the configured pinned endpoint", async () => {
    const legacyFetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", legacyFetch);
    const transport = vi.fn(async (_input: OutboundRequestAdapterInput) => new Response(JSON.stringify({
      choices: [{ message: { content: '{"summary":"done"}' } }],
    }), { status: 200 }));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["summary.example.test"],
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      requestAdapter: transport,
      maxRedirects: 0,
    });

    await expect(requestTaskSummaryModel({
      baseUrl: "https://summary.example.test/openai",
      apiKey: "task-summary-secret",
      model: "summary-model",
      systemPrompt: "summarize system",
      userPrompt: "summarize task",
      timeoutMs: 120_000,
      outboundRequestPolicy,
    })).resolves.toEqual({
      choices: [{ message: { content: '{"summary":"done"}' } }],
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
          Authorization: "Bearer task-summary-secret",
        },
      },
    });
    expect(JSON.parse(String(request?.init.body))).toEqual({
      model: "summary-model",
      messages: [
        { role: "system", content: "summarize system" },
        { role: "user", content: "summarize task" },
      ],
      max_tokens: 400,
      temperature: 0.2,
    });
    expect(legacyFetch).not.toHaveBeenCalled();
  });

  it("rejects private DNS before sending the task prompt or credential", async () => {
    const transport = vi.fn(async () => new Response(null, { status: 204 }));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["summary.example.test"],
      dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
      requestAdapter: transport,
    });

    await expect(requestTaskSummaryModel({
      baseUrl: "https://summary.example.test/v1",
      apiKey: "task-summary-secret",
      model: "summary-model",
      systemPrompt: "summarize system",
      userPrompt: "sensitive task transcript",
      timeoutMs: 120_000,
      outboundRequestPolicy,
    })).rejects.toMatchObject({ code: "private_network_not_allowed" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects an insecure configured endpoint without calling legacy fetch", async () => {
    const legacyFetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", legacyFetch);

    await expect(requestTaskSummaryModel({
      baseUrl: "http://summary.example.test/v1",
      apiKey: "task-summary-secret",
      model: "summary-model",
      systemPrompt: "summarize system",
      userPrompt: "sensitive task transcript",
      timeoutMs: 120_000,
    })).rejects.toMatchObject({ code: "insecure_scheme" });
    expect(legacyFetch).not.toHaveBeenCalled();
  });

  it("does not replay the task summary credential or prompt after a 307 response", async () => {
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

    await expect(requestTaskSummaryModel({
      baseUrl: "https://summary.example.test/v1",
      apiKey: "task-summary-secret",
      model: "summary-model",
      systemPrompt: "summarize system",
      userPrompt: "sensitive task transcript",
      timeoutMs: 120_000,
      outboundRequestPolicy,
    })).rejects.toMatchObject({ code: "redirect_limit" });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("preserves the bounded provider error detail for task summary diagnostics", async () => {
    const responseBody = `rate-limited:${"x".repeat(240)}`;
    const request = vi.fn(async () => ({
      response: new Response(responseBody, { status: 429 }),
      url: new URL("https://summary.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestTaskSummaryModel({
      baseUrl: "https://summary.example.test/v1",
      apiKey: "task-summary-secret",
      model: "summary-model",
      systemPrompt: "summarize system",
      userPrompt: "summarize task",
      timeoutMs: 120_000,
      outboundRequestPolicy: { request },
    })).rejects.toThrow(`Task summary LLM call failed: 429 ${responseBody.slice(0, 200)}`);
  });

  it("cancels a successful JSON response whose declared length exceeds the limit", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), {
      status: 200,
      headers: { "content-length": String(TASK_SUMMARY_MODEL_MAX_RESPONSE_BYTES + 1) },
    });
    const request = vi.fn(async () => ({
      response,
      url: new URL("https://summary.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestTaskSummaryModel({
      baseUrl: "https://summary.example.test/v1",
      apiKey: "task-summary-secret",
      model: "summary-model",
      systemPrompt: "summarize system",
      userPrompt: "summarize task",
      timeoutMs: 120_000,
      outboundRequestPolicy: { request },
    })).rejects.toThrow("Task summary LLM response exceeds 1048576 byte limit.");
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("cancels an error response that crosses the cumulative byte limit", async () => {
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
      url: new URL("https://summary.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestTaskSummaryModel({
      baseUrl: "https://summary.example.test/v1",
      apiKey: "task-summary-secret",
      model: "summary-model",
      systemPrompt: "summarize system",
      userPrompt: "summarize task",
      timeoutMs: 120_000,
      outboundRequestPolicy: { request },
    })).rejects.toThrow("Task summary LLM response exceeds 1048576 byte limit.");
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
      url: new URL("https://summary.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(requestTaskSummaryModel({
      baseUrl: "https://summary.example.test/v1",
      apiKey: "task-summary-secret",
      model: "summary-model",
      systemPrompt: "summarize system",
      userPrompt: "summarize task",
      timeoutMs: 5,
      outboundRequestPolicy: { request },
    })).rejects.toThrow("Task summary LLM call timed out after 5ms.");
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });
});
