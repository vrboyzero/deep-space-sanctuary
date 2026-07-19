import * as http from "node:http";

import { OutboundRequestPolicy, type OutboundRequestAdapterInput } from "@belldandy/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { requestModelTransport } from "./model-request-transport.js";

describe("model request transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects an insecure public model endpoint without calling legacy fetch", async () => {
    const legacyFetch = vi.fn(async () => new Response("unsafe", { status: 200 }));
    vi.stubGlobal("fetch", legacyFetch);

    await expect(requestModelTransport({
      url: "http://model.example.test/v1/chat/completions",
      init: {
        method: "POST",
        headers: { Authorization: "Bearer model-secret" },
        body: JSON.stringify({ prompt: "private prompt" }),
      },
      idleTimeoutMs: 30_000,
    })).rejects.toMatchObject({ code: "insecure_scheme" });
    expect(legacyFetch).not.toHaveBeenCalled();
  });

  it("rejects a private configured endpoint before sending model credentials or prompt", async () => {
    const legacyFetch = vi.fn(async () => new Response("unsafe", { status: 200 }));
    vi.stubGlobal("fetch", legacyFetch);

    await expect(requestModelTransport({
      url: "https://10.0.0.8/v1/chat/completions",
      init: {
        method: "POST",
        headers: { Authorization: "Bearer model-secret" },
        body: JSON.stringify({ prompt: "private prompt" }),
      },
      idleTimeoutMs: 30_000,
    })).rejects.toMatchObject({ code: "private_network_not_allowed" });
    expect(legacyFetch).not.toHaveBeenCalled();
  });

  it("pins the active public endpoint and preserves signal, idle timeout, and response stream", async () => {
    const legacyFetch = vi.fn(async () => new Response("unsafe", { status: 200 }));
    vi.stubGlobal("fetch", legacyFetch);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: active\n\n"));
        controller.close();
      },
    });
    const activeResponse = new Response(stream, { status: 200 });
    const transport = vi.fn(async (_input: OutboundRequestAdapterInput) => activeResponse);
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["model.example.test"],
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      requestAdapter: transport,
      maxRedirects: 0,
    });
    const controller = new AbortController();
    const body = JSON.stringify({ prompt: "active prompt" });

    const response = await requestModelTransport({
      url: "https://model.example.test/v1/chat/completions",
      init: {
        method: "POST",
        headers: { Authorization: "Bearer model-secret" },
        body,
        signal: controller.signal,
      },
      idleTimeoutMs: 45_000,
      outboundRequestPolicy,
    });

    expect(response).toBe(activeResponse);
    expect(response.bodyUsed).toBe(false);
    const request = transport.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      url: new URL("https://model.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 }],
      init: {
        method: "POST",
        body,
        signal: controller.signal,
        maxRedirects: 0,
        idleTimeoutMs: 45_000,
      },
    });
    expect(new Headers(request?.init.headers).get("authorization")).toBe("Bearer model-secret");
    expect(legacyFetch).not.toHaveBeenCalled();
  });

  it("does not replay model credentials or prompt after a 307 response", async () => {
    const cancelBody = vi.fn();
    const transport = vi.fn(async (_input: OutboundRequestAdapterInput) => new Response(
      new ReadableStream<Uint8Array>({ cancel: cancelBody }),
      {
        status: 307,
        headers: { location: "https://credential-sink.example.test/model" },
      },
    ));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowedHosts: ["model.example.test"],
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      requestAdapter: transport,
      maxRedirects: 0,
    });

    await expect(requestModelTransport({
      url: "https://model.example.test/v1/chat/completions",
      init: {
        method: "POST",
        headers: { Authorization: "Bearer model-secret" },
        body: JSON.stringify({ prompt: "private prompt" }),
      },
      idleTimeoutMs: 30_000,
      outboundRequestPolicy,
    })).rejects.toMatchObject({ code: "redirect_limit" });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("preserves explicitly configured loopback model endpoints as trusted local transport", async () => {
    const received: { authorization?: string; body?: string } = {};
    const server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        received.authorization = request.headers.authorization;
        received.body = Buffer.concat(chunks).toString("utf8");
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end("data: local\n\n");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Loopback fixture did not bind a TCP port.");
      const body = JSON.stringify({ prompt: "local prompt" });
      const response = await requestModelTransport({
        url: `http://127.0.0.1:${address.port}/v1/chat/completions`,
        init: {
          method: "POST",
          headers: { Authorization: "Bearer local-model" },
          body,
        },
        idleTimeoutMs: 30_000,
      });

      expect(await response.text()).toBe("data: local\n\n");
      expect(received).toEqual({
        authorization: "Bearer local-model",
        body,
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("enforces the forwarded idle timeout on an active pinned socket", async () => {
    const server = http.createServer(() => {
      // 保持连接无响应，验证 pinned transport 的 socket idle timeout。
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Idle-timeout fixture did not bind a TCP port.");
      await expect(requestModelTransport({
        url: `http://127.0.0.1:${address.port}/v1/chat/completions`,
        init: {
          method: "POST",
          body: JSON.stringify({ prompt: "idle prompt" }),
        },
        idleTimeoutMs: 25,
      })).rejects.toMatchObject({ code: "idle_timeout" });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("admits a proxied target once and blocks a 307 credential replay", async () => {
    const dispatcher = { kind: "proxy-dispatcher" };
    const cancelBody = vi.fn();
    const proxyFetch = vi.fn(async () => new Response(
      new ReadableStream<Uint8Array>({ cancel: cancelBody }),
      {
        status: 307,
        headers: { location: "https://credential-sink.example.test/model" },
      },
    ));
    const controller = new AbortController();
    const body = JSON.stringify({ prompt: "proxied prompt" });

    await expect(requestModelTransport({
      url: "https://model.example.test/v1/chat/completions",
      init: {
        method: "POST",
        headers: { Authorization: "Bearer proxied-model" },
        body,
        signal: controller.signal,
      },
      idleTimeoutMs: 30_000,
      proxyUrl: "http://proxy.example.test:8080",
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      proxyDispatcherFactory: async () => dispatcher,
      fetchImpl: proxyFetch,
    })).rejects.toMatchObject({ code: "redirect_limit" });

    expect(proxyFetch).toHaveBeenCalledTimes(1);
    expect(proxyFetch).toHaveBeenCalledWith(
      new URL("https://model.example.test/v1/chat/completions"),
      expect.objectContaining({
        method: "POST",
        body,
        signal: controller.signal,
        redirect: "manual",
        dispatcher,
      }),
    );
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("rejects a private proxied target before proxy fetch", async () => {
    const proxyFetch = vi.fn(async () => new Response("unsafe", { status: 200 }));
    const proxyDispatcherFactory = vi.fn(async () => ({ kind: "proxy-dispatcher" }));

    await expect(requestModelTransport({
      url: "https://10.0.0.8/v1/chat/completions",
      init: {
        method: "POST",
        headers: { Authorization: "Bearer proxied-model" },
        body: JSON.stringify({ prompt: "proxied prompt" }),
      },
      idleTimeoutMs: 30_000,
      proxyUrl: "http://proxy.example.test:8080",
      proxyDispatcherFactory,
      fetchImpl: proxyFetch,
    })).rejects.toMatchObject({ code: "private_network_not_allowed" });
    expect(proxyDispatcherFactory).not.toHaveBeenCalled();
    expect(proxyFetch).not.toHaveBeenCalled();
  });
});
