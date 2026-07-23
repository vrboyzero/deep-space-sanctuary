import { OutboundRequestPolicy } from "@belldandy/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { openAIClientOptions } = vi.hoisted(() => ({
  openAIClientOptions: [] as Array<{
    apiKey?: string;
    baseURL?: string;
    fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  }>,
}));

vi.mock("openai", () => ({
  default: class OpenAIClientMock {
    readonly embeddings;

    constructor(options: {
      apiKey?: string;
      baseURL?: string;
      fetch?: (input: string, init?: RequestInit) => Promise<Response>;
    }) {
      openAIClientOptions.push(options);
      this.embeddings = {
        create: async (payload: unknown, requestOptions?: { signal?: AbortSignal }) => {
          if (!options.fetch) throw new Error("OpenAI embedding transport was not configured.");
          const response = await options.fetch(`${options.baseURL}/embeddings`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${options.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
            signal: requestOptions?.signal,
          });
          return await response.json();
        },
      };
    }
  },
}));

import {
  OpenAIEmbeddingProvider,
  type OpenAIEmbeddingOptions,
} from "./openai.js";
import { OPENAI_EMBEDDING_MAX_RESPONSE_BYTES } from "./openai-embedding-transport.js";

type OutboundRequestInput = Parameters<OutboundRequestPolicy["request"]>[0];

describe("OpenAIEmbeddingProvider outbound transport", () => {
  beforeEach(() => {
    openAIClientOptions.length = 0;
  });

  it("only declares a default dimension for text-embedding-3 models", () => {
    const compatibleProvider = new OpenAIEmbeddingProvider({
      model: "text-embedding-v4",
    });
    const openAIProvider = new OpenAIEmbeddingProvider({
      model: "text-embedding-3-small",
    });

    expect(compatibleProvider.dimension).toBeUndefined();
    expect(openAIProvider.dimension).toBe(1536);
  });

  it("returns embeddings through the configured pinned endpoint policy", async () => {
    const request = vi.fn(async (_input: OutboundRequestInput) => ({
      response: Response.json({ data: [{ embedding: [0.25, -0.5] }] }),
      url: new URL("https://embedding.example.test/v1/embeddings"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const options: OpenAIEmbeddingOptions & {
      outboundRequestPolicy: Pick<OutboundRequestPolicy, "request">;
    } = {
      apiKey: "embedding-secret",
      baseURL: "https://embedding.example.test/v1",
      model: "embedding-model",
      queryPrefix: "query: ",
      outboundRequestPolicy: { request },
    };
    const provider = new OpenAIEmbeddingProvider(options);

    await expect(provider.embedQuery("hello")).resolves.toEqual([0.25, -0.5]);

    expect(openAIClientOptions).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      url: new URL("https://embedding.example.test/v1/embeddings"),
      method: "POST",
      maxRedirects: 0,
      headers: {
        authorization: "Bearer embedding-secret",
        "content-type": "application/json",
      },
    });
    expect(JSON.parse(String(request.mock.calls[0]?.[0].body))).toEqual({
      model: "embedding-model",
      input: "query: hello",
    });
  });

  it("rejects private DNS before sending the embedding input or credential", async () => {
    const transport = vi.fn(async () => Response.json({
      data: [{ embedding: [0.25, -0.5] }],
    }));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["embedding.example.test"],
      dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
      requestAdapter: transport,
      maxRedirects: 0,
    });
    const provider = new OpenAIEmbeddingProvider({
      apiKey: "embedding-secret",
      baseURL: "https://embedding.example.test/v1",
      outboundRequestPolicy,
    });

    await expect(provider.embed("private embedding input")).rejects.toMatchObject({
      code: "private_network_not_allowed",
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it("does not replay the embedding credential or input after a redirect", async () => {
    const cancelBody = vi.fn();
    const transport = vi.fn(async () => new Response(
      new ReadableStream<Uint8Array>({ cancel: cancelBody }),
      {
        status: 307,
        headers: { location: "https://redirect.example.test/credential-sink" },
      },
    ));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["embedding.example.test"],
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      requestAdapter: transport,
      maxRedirects: 0,
    });
    const provider = new OpenAIEmbeddingProvider({
      apiKey: "embedding-secret",
      baseURL: "https://embedding.example.test/v1",
      outboundRequestPolicy,
    });

    await expect(provider.embed("private embedding input")).rejects.toMatchObject({
      code: "redirect_limit",
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("cancels a declared oversized response before the SDK parses it", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), {
      status: 200,
      headers: {
        "content-length": String(OPENAI_EMBEDDING_MAX_RESPONSE_BYTES + 1),
        "content-type": "application/json",
      },
    });
    const request = vi.fn(async (_input: OutboundRequestInput) => ({
      response,
      url: new URL("https://embedding.example.test/v1/embeddings"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const provider = new OpenAIEmbeddingProvider({
      apiKey: "embedding-secret",
      baseURL: "https://embedding.example.test/v1",
      outboundRequestPolicy: { request },
    });

    await expect(provider.embed("hello")).rejects.toThrow(
      "OpenAI embedding response exceeds 1048576 byte limit.",
    );
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
    const request = vi.fn(async (_input: OutboundRequestInput) => ({
      response,
      url: new URL("https://embedding.example.test/v1/embeddings"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const provider = new OpenAIEmbeddingProvider({
      apiKey: "embedding-secret",
      baseURL: "https://embedding.example.test/v1",
      outboundRequestPolicy: { request },
    });

    await expect(provider.embed("hello")).rejects.toThrow(
      "OpenAI embedding response exceeds 1048576 byte limit.",
    );
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending response body when the embedding request is aborted", async () => {
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
    const request = vi.fn(async (_input: OutboundRequestInput) => ({
      response,
      url: new URL("https://embedding.example.test/v1/embeddings"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const provider = new OpenAIEmbeddingProvider({
      apiKey: "embedding-secret",
      baseURL: "https://embedding.example.test/v1",
      outboundRequestPolicy: { request },
    });
    const controller = new AbortController();

    const embedding = provider.embed("hello", { signal: controller.signal });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    controller.abort(new Error("embedding cancelled"));

    await expect(embedding).rejects.toThrow("embedding cancelled");
    expect(request.mock.calls[0]?.[0].signal).toBe(controller.signal);
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });
});
