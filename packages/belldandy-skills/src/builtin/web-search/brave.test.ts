import { afterEach, describe, expect, it, vi } from "vitest";
import { OutboundRequestPolicy } from "@belldandy/protocol";

import { BraveSearchProvider } from "./brave.js";

describe("BraveSearchProvider outbound policy", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("rejects a private Brave API resolution before any transport", async () => {
        const legacyFetch = vi.fn(async () => {
            throw new Error("legacy fetch must not run");
        });
        vi.stubGlobal("fetch", legacyFetch);
        const transport = vi.fn(async () => Response.json({ web: { results: [] } }));
        const provider = new BraveSearchProvider({
            outboundRequestPolicy: new OutboundRequestPolicy({
                allowedHosts: ["api.search.brave.com"],
                dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
                requestAdapter: transport,
            }),
        });

        await expect(provider.search({
            query: "belldandy tools",
            apiKey: "brave-test-key",
        })).rejects.toMatchObject({ code: "private_network_not_allowed" });
        expect(legacyFetch).not.toHaveBeenCalled();
        expect(transport).not.toHaveBeenCalled();
    });

    it("does not replay the Brave API key across a 307 redirect", async () => {
        const legacyFetch = vi.fn(async () => {
            throw new Error("legacy fetch must not run");
        });
        vi.stubGlobal("fetch", legacyFetch);
        const transport = vi.fn(async () => new Response(null, {
            status: 307,
            headers: { location: "https://api.search.brave.com/credential-sink" },
        }));
        const provider = new BraveSearchProvider({
            outboundRequestPolicy: new OutboundRequestPolicy({
                allowedHosts: ["api.search.brave.com"],
                dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
                requestAdapter: transport,
            }),
        });

        await expect(provider.search({
            query: "belldandy tools",
            apiKey: "brave-test-key",
        })).rejects.toMatchObject({ code: "redirect_limit" });
        expect(legacyFetch).not.toHaveBeenCalled();
        expect(transport).toHaveBeenCalledTimes(1);
        expect(transport.mock.calls[0]?.[0]).toMatchObject({
            url: new URL("https://api.search.brave.com/res/v1/web/search?q=belldandy+tools&count=5"),
            init: {
                maxRedirects: 0,
                headers: {
                    "X-Subscription-Token": "brave-test-key",
                },
            },
        });
    });

    it("rejects an oversized declared JSON body before reading it", async () => {
        const cancelBody = vi.fn();
        const response = new Response(new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('{"web":{"results":[]}}'));
                controller.close();
            },
            cancel: cancelBody,
        }), {
            headers: { "Content-Length": String(1024 * 1024 + 1) },
        });
        const request = vi.fn(async () => ({
            response,
            url: new URL("https://api.search.brave.com/res/v1/web/search"),
            addresses: [{ address: "93.184.216.34", family: 4 as const }],
            redirectCount: 0,
        }));
        const provider = new BraveSearchProvider({ outboundRequestPolicy: { request } });

        await expect(provider.search({
            query: "belldandy tools",
            apiKey: "brave-test-key",
        })).rejects.toThrow("Brave Search response exceeds 1048576 byte limit");
        expect(cancelBody).toHaveBeenCalledTimes(1);
    });

    it("cancels a JSON body that exceeds the cumulative byte limit", async () => {
        const cancelBody = vi.fn();
        const response = new Response(new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array(1024 * 1024 + 1));
            },
            cancel: cancelBody,
        }));
        const request = vi.fn(async () => ({
            response,
            url: new URL("https://api.search.brave.com/res/v1/web/search"),
            addresses: [{ address: "93.184.216.34", family: 4 as const }],
            redirectCount: 0,
        }));
        const provider = new BraveSearchProvider({ outboundRequestPolicy: { request } });

        await expect(provider.search({
            query: "belldandy tools",
            apiKey: "brave-test-key",
        })).rejects.toThrow("Brave Search response exceeds 1048576 byte limit");
        expect(cancelBody).toHaveBeenCalledTimes(1);
    });

    it("preserves active Brave result mapping and bounded request parameters", async () => {
        const legacyFetch = vi.fn(async () => {
            throw new Error("legacy fetch must not run");
        });
        vi.stubGlobal("fetch", legacyFetch);
        const request = vi.fn(async (input: { url: string | URL }) => ({
            response: Response.json({
                web: {
                    results: [{
                        title: "Belldandy Tools",
                        url: "https://docs.example.test/tools",
                        description: "Tool documentation",
                        age: "2 hours ago",
                        profile: { name: "Example Docs" },
                    }],
                },
            }),
            url: new URL(input.url.toString()),
            addresses: [{ address: "93.184.216.34", family: 4 as const }],
            redirectCount: 0,
        }));
        const provider = new BraveSearchProvider({ outboundRequestPolicy: { request } });

        await expect(provider.search({
            query: "belldandy tools",
            count: 99,
            country: "us",
            apiKey: "brave-test-key",
        })).resolves.toEqual([{
            title: "Belldandy Tools",
            url: "https://docs.example.test/tools",
            snippet: "Tool documentation",
            published: "2 hours ago",
            source: "Example Docs",
        }]);
        expect(legacyFetch).not.toHaveBeenCalled();
        expect(request).toHaveBeenCalledTimes(1);
        const requestInput = request.mock.calls[0]?.[0] as {
            url: URL;
            headers: Record<string, string>;
            signal: AbortSignal;
            maxRedirects: number;
            idleTimeoutMs: number;
        };
        expect(requestInput.url.toString()).toBe(
            "https://api.search.brave.com/res/v1/web/search?q=belldandy+tools&count=20&country=us",
        );
        expect(requestInput).toMatchObject({
            headers: {
                "Accept": "application/json",
                "Accept-Encoding": "identity",
                "X-Subscription-Token": "brave-test-key",
            },
            signal: expect.any(AbortSignal),
            maxRedirects: 0,
            idleTimeoutMs: 10_000,
        });
    });

    it("propagates an external abort through an in-flight policy request", async () => {
        const request = vi.fn(async (input: { signal?: AbortSignal }) => await new Promise<never>((_resolve, reject) => {
            const rejectAbort = () => {
                const error = new Error("Stopped by user.");
                error.name = "AbortError";
                reject(error);
            };
            if (input.signal?.aborted) {
                rejectAbort();
                return;
            }
            input.signal?.addEventListener("abort", rejectAbort, { once: true });
        }));
        const provider = new BraveSearchProvider({ outboundRequestPolicy: { request } });
        const controller = new AbortController();

        const result = provider.search({
            query: "belldandy tools",
            apiKey: "brave-test-key",
            abortSignal: controller.signal,
        });
        await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
        controller.abort("Stopped by user.");

        await expect(result).rejects.toThrow("Stopped by user.");
    });
});
