import { afterEach, describe, expect, it, vi } from "vitest";
import { OutboundRequestPolicy } from "@belldandy/protocol";

import type { BelldandyLogger } from "./logger/index.js";
import { checkForUpdates } from "./update-checker.js";

function createLogger(): BelldandyLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn() as BelldandyLogger["child"],
    close: vi.fn(),
  };
}

describe("update checker outbound policy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects a private configured endpoint before any transport", async () => {
    const legacyFetch = vi.fn(async () => {
      throw new Error("legacy fetch must not run");
    });
    vi.stubGlobal("fetch", legacyFetch);
    const transport = vi.fn(async () => Response.json({ tag_name: "v9.9.9" }));
    const logger = createLogger();

    await checkForUpdates({
      currentVersion: "0.5.4",
      logger,
      releasesApiUrl: "https://updates.example.test/releases/latest",
      outboundRequestPolicy: new OutboundRequestPolicy({
        allowedHosts: ["updates.example.test"],
        dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
        requestAdapter: transport,
      }),
    });

    expect(legacyFetch).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("rejects an insecure configured endpoint before transport", async () => {
    const transport = vi.fn(async () => Response.json({ tag_name: "v9.9.9" }));
    const logger = createLogger();

    await checkForUpdates({
      currentVersion: "0.5.4",
      logger,
      releasesApiUrl: "http://updates.example.test/releases/latest",
      outboundRequestPolicy: new OutboundRequestPolicy({
        allowedHosts: ["updates.example.test"],
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestAdapter: transport,
      }),
    });

    expect(transport).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("does not follow update endpoint redirects", async () => {
    const transport = vi.fn(async (_input: unknown) => new Response(null, {
      status: 307,
      headers: { location: "https://updates.example.test/second-hop" },
    }));
    const logger = createLogger();

    await checkForUpdates({
      currentVersion: "0.5.4",
      logger,
      releasesApiUrl: "https://updates.example.test/releases/latest",
      outboundRequestPolicy: new OutboundRequestPolicy({
        allowedHosts: ["updates.example.test"],
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestAdapter: transport,
      }),
    });

    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[0]).toMatchObject({
      url: new URL("https://updates.example.test/releases/latest"),
      init: {
        maxRedirects: 0,
        idleTimeoutMs: 3000,
      },
    });
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared release response before reading it", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"tag_name":"v9.9.9"}'));
        controller.close();
      },
      cancel: cancelBody,
    }), {
      headers: { "Content-Length": String(256 * 1024 + 1) },
    });
    const request = vi.fn(async () => ({
      response,
      url: new URL("https://updates.example.test/releases/latest"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const logger = createLogger();

    await checkForUpdates({
      currentVersion: "0.5.4",
      logger,
      releasesApiUrl: "https://updates.example.test/releases/latest",
      outboundRequestPolicy: { request },
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(cancelBody).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("cancels a release response that exceeds the cumulative byte limit", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(256 * 1024 + 1));
      },
      cancel: cancelBody,
    }));
    const request = vi.fn(async () => ({
      response,
      url: new URL("https://updates.example.test/releases/latest"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const logger = createLogger();

    await checkForUpdates({
      currentVersion: "0.5.4",
      logger,
      outboundRequestPolicy: { request },
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(cancelBody).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("preserves the total timeout warning for an in-flight policy request", async () => {
    const request = vi.fn(async (input: { signal?: AbortSignal }) => await new Promise<never>((_resolve, reject) => {
      const rejectAbort = () => reject(new Error("request aborted"));
      if (input.signal?.aborted) {
        rejectAbort();
        return;
      }
      input.signal?.addEventListener("abort", rejectAbort, { once: true });
    }));
    const logger = createLogger();

    await checkForUpdates({
      currentVersion: "0.5.4",
      logger,
      timeoutMs: 5,
      outboundRequestPolicy: { request },
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith("update", "Update check timeout after 5ms");
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("preserves active version comparison and release logging", async () => {
    const legacyFetch = vi.fn(async () => {
      throw new Error("legacy fetch must not run");
    });
    vi.stubGlobal("fetch", legacyFetch);
    const request = vi.fn(async (input: any) => ({
      response: Response.json({
        tag_name: "v0.6.0",
        html_url: "https://github.com/vrboyzero/star-sanctuary/releases/tag/v0.6.0",
      }),
      url: new URL(input.url.toString()),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const logger = createLogger();

    await checkForUpdates({
      currentVersion: "0.5.4",
      logger,
      timeoutMs: 3000,
      releasesApiUrl: "https://updates.example.test/releases/latest",
      outboundRequestPolicy: { request },
    });

    expect(legacyFetch).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      url: "https://updates.example.test/releases/latest",
      headers: {
        "Accept": "application/vnd.github+json",
        "Accept-Encoding": "identity",
        "User-Agent": "Belldandy-UpdateChecker",
      },
      signal: expect.any(AbortSignal),
      maxRedirects: 0,
      idleTimeoutMs: 3000,
    });
    expect(logger.info).toHaveBeenNthCalledWith(
      1,
      "update",
      "New version available: v0.6.0 (current: v0.5.4)",
    );
    expect(logger.info).toHaveBeenNthCalledWith(
      2,
      "update",
      "Upgrade: https://github.com/vrboyzero/star-sanctuary/releases/tag/v0.6.0",
    );
  });
});
