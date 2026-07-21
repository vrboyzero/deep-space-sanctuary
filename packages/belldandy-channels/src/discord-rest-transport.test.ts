import { OutboundRequestPolicy } from "@belldandy/protocol";
import { describe, expect, it, vi } from "vitest";

import {
  DISCORD_REST_MAX_RESPONSE_BYTES,
  DISCORD_REST_TIMEOUT_MS,
  createDiscordRestMakeRequest,
} from "./discord-rest-transport.js";

function createPolicy(responseFactory: () => Response) {
  const request = vi.fn(async (input: { url: string | URL }) => ({
    response: responseFactory(),
    url: new URL(input.url.toString()),
    addresses: [{ address: "93.184.216.34", family: 4 as const }],
    redirectCount: 0,
  }));
  return { request };
}

describe("Discord REST transport", () => {
  it("forwards SDK JSON requests through the official-host zero-redirect policy", async () => {
    const policy = createPolicy(() => new Response(JSON.stringify({ id: "message-a" }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-ratelimit-remaining": "49",
      },
    }));
    const makeRequest = createDiscordRestMakeRequest({
      outboundRequestPolicy: policy,
      maxResponseBytes: 2_048,
      timeoutMs: 1_234,
    });

    const response = await makeRequest("https://discord.com/api/v10/channels/123/messages", {
      method: "POST",
      headers: {
        authorization: "Bot discord-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ content: "hello" }),
    } as any);

    await expect(response.json()).resolves.toEqual({ id: "message-a" });
    expect(response.headers.get("x-ratelimit-remaining")).toBe("49");
    expect(policy.request).toHaveBeenCalledWith(expect.objectContaining({
      url: new URL("https://discord.com/api/v10/channels/123/messages"),
      method: "POST",
      maxRedirects: 0,
      idleTimeoutMs: 1_234,
      headers: expect.objectContaining({
        authorization: "Bot discord-token",
        "content-type": "application/json",
      }),
      body: JSON.stringify({ content: "hello" }),
    }));
  });

  it("rejects private DNS before sending the bot token or payload", async () => {
    const requestAdapter = vi.fn(async () => new Response(JSON.stringify({ id: "unsafe" })));
    const makeRequest = createDiscordRestMakeRequest({
      outboundRequestPolicy: new OutboundRequestPolicy({
        allowedHosts: ["discord.com"],
        maxRedirects: 0,
        dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
        requestAdapter,
      }),
    });

    await expect(makeRequest("https://discord.com/api/v10/channels/123/messages", {
      method: "POST",
      headers: { authorization: "Bot private-token" },
      body: JSON.stringify({ content: "private body" }),
    } as any)).rejects.toMatchObject({ code: "private_network_not_allowed" });
    expect(requestAdapter).not.toHaveBeenCalled();
  });

  it("rejects redirects without replaying the credentialed request", async () => {
    const requestAdapter = vi.fn(async () => new Response(null, {
      status: 307,
      headers: { location: "https://example.test/redirected" },
    }));
    const makeRequest = createDiscordRestMakeRequest({
      outboundRequestPolicy: new OutboundRequestPolicy({
        allowedHosts: ["discord.com"],
        maxRedirects: 0,
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestAdapter,
      }),
    });

    await expect(makeRequest("https://discord.com/api/v10/gateway/bot", {
      headers: { authorization: "Bot discord-token" },
    } as any)).rejects.toMatchObject({ code: "redirect_limit" });
    expect(requestAdapter).toHaveBeenCalledTimes(1);
  });

  it("rejects declared and streamed oversized responses and cancels their bodies", async () => {
    const declaredCancel = vi.fn(async () => undefined);
    const declaredPolicy = createPolicy(() => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-length": "9" }),
      body: { cancel: declaredCancel },
    } as unknown as Response));
    const declaredRequest = createDiscordRestMakeRequest({
      outboundRequestPolicy: declaredPolicy,
      maxResponseBytes: 8,
    });

    await expect(declaredRequest("https://discord.com/api/v10/gateway", {} as any))
      .rejects.toThrow("Discord REST response exceeds 8 byte limit");
    expect(declaredCancel).toHaveBeenCalledOnce();

    const streamedCancel = vi.fn();
    const streamedPolicy = createPolicy(() => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(Uint8Array.of(1));
      },
      cancel: streamedCancel,
    }), { status: 200 }));
    const streamedRequest = createDiscordRestMakeRequest({
      outboundRequestPolicy: streamedPolicy,
      maxResponseBytes: 8,
    });

    await expect(streamedRequest("https://discord.com/api/v10/gateway", {} as any))
      .rejects.toThrow("Discord REST response exceeds 8 byte limit");
    expect(streamedCancel).toHaveBeenCalledOnce();
  });

  it("forwards caller abort and cancels a pending response body", async () => {
    const cancel = vi.fn();
    let markResponseReady!: () => void;
    const responseReady = new Promise<void>((resolve) => {
      markResponseReady = resolve;
    });
    const policy = createPolicy(() => new Response(new ReadableStream<Uint8Array>({
      pull() {
        markResponseReady();
        return new Promise<void>(() => {});
      },
      cancel,
    }), { status: 200 }));
    const makeRequest = createDiscordRestMakeRequest({ outboundRequestPolicy: policy });
    const controller = new AbortController();

    const pending = makeRequest("https://discord.com/api/v10/gateway", {
      signal: controller.signal,
    } as any);
    await responseReady;
    controller.abort(new Error("caller stopped"));

    await expect(pending).rejects.toThrow("caller stopped");
    expect(policy.request).toHaveBeenCalledWith(expect.objectContaining({
      signal: controller.signal,
      maxRedirects: 0,
    }));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("falls back to safe defaults when configured limits are invalid", async () => {
    const cancel = vi.fn(async () => undefined);
    const policy = createPolicy(() => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-length": String(DISCORD_REST_MAX_RESPONSE_BYTES + 1) }),
      body: { cancel },
    } as unknown as Response));
    const makeRequest = createDiscordRestMakeRequest({
      outboundRequestPolicy: policy,
      maxResponseBytes: -1,
      timeoutMs: 0,
    });

    await expect(makeRequest("https://discord.com/api/v10/gateway", {} as any)).rejects.toThrow(
      `Discord REST response exceeds ${DISCORD_REST_MAX_RESPONSE_BYTES} byte limit`,
    );
    expect(policy.request).toHaveBeenCalledWith(expect.objectContaining({
      idleTimeoutMs: DISCORD_REST_TIMEOUT_MS,
    }));
    expect(cancel).toHaveBeenCalledOnce();
  });
});
