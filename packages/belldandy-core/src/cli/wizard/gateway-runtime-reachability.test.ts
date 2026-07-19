import { OutboundRequestPolicy, type OutboundRequestAdapterInput } from "@belldandy/protocol";
import { describe, expect, it, vi } from "vitest";

import { checkGatewayRuntimeReachability } from "./gateway-runtime-reachability.js";

describe("Gateway runtime reachability", () => {
  it("probes the normalized loopback health URL through a pinned trusted-private GET", async () => {
    const cancelBody = vi.fn();
    const transport = vi.fn(async (_input: OutboundRequestAdapterInput) => new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("healthy"));
        },
        cancel: cancelBody,
      }),
      { status: 200 },
    ));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowInsecureHttp: true,
      allowPrivateNetwork: true,
      allowedHosts: ["127.0.0.1"],
      maxRedirects: 0,
      requestAdapter: transport,
    });

    await expect(checkGatewayRuntimeReachability(new Map([
      ["BELLDANDY_HOST", "0.0.0.0"],
    ]), { outboundRequestPolicy })).resolves.toEqual({
      reachable: true,
      healthUrl: "http://127.0.0.1:28889/health",
    });

    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[0]).toMatchObject({
      url: new URL("http://127.0.0.1:28889/health"),
      addresses: [{ address: "127.0.0.1", family: 4 }],
      init: {
        method: "GET",
        maxRedirects: 0,
        idleTimeoutMs: 800,
      },
    });
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("maps a redirect to unreachable without sending a second health request", async () => {
    const cancelBody = vi.fn();
    const transport = vi.fn(async (_input: OutboundRequestAdapterInput) => new Response(
      new ReadableStream<Uint8Array>({ cancel: cancelBody }),
      {
        status: 307,
        headers: { location: "http://127.0.0.1:28889/redirected-health" },
      },
    ));
    const outboundRequestPolicy = new OutboundRequestPolicy({
      allowInsecureHttp: true,
      allowPrivateNetwork: true,
      allowedHosts: ["127.0.0.1"],
      maxRedirects: 0,
      requestAdapter: transport,
    });

    await expect(checkGatewayRuntimeReachability(new Map(), {
      outboundRequestPolicy,
    })).resolves.toEqual({
      reachable: false,
      healthUrl: "http://127.0.0.1:28889/health",
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("maps a non-success health response to unreachable and cancels its body", async () => {
    const cancelBody = vi.fn();
    const request = vi.fn(async () => ({
      response: new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), { status: 503 }),
      url: new URL("http://127.0.0.1:28889/health"),
      addresses: [{ address: "127.0.0.1", family: 4 as const }],
      redirectCount: 0,
    }));

    await expect(checkGatewayRuntimeReachability(new Map(), {
      outboundRequestPolicy: { request },
    })).resolves.toEqual({
      reachable: false,
      healthUrl: "http://127.0.0.1:28889/health",
    });
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("aborts a pending health request at the total timeout and reports unreachable", async () => {
    let observedAbort = false;
    const request = vi.fn(async (input: Parameters<OutboundRequestPolicy["request"]>[0]) => (
      await new Promise<never>((_resolve, reject) => {
        input.signal?.addEventListener("abort", () => {
          observedAbort = true;
          reject(input.signal?.reason);
        }, { once: true });
      })
    ));

    await expect(checkGatewayRuntimeReachability(new Map(), {
      timeoutMs: 5,
      outboundRequestPolicy: { request },
    })).resolves.toEqual({
      reachable: false,
      healthUrl: "http://127.0.0.1:28889/health",
    });
    expect(observedAbort).toBe(true);
  });
});
