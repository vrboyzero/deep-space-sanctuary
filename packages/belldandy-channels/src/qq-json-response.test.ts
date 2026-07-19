import { describe, expect, it, vi } from "vitest";

import {
    DEFAULT_QQ_REST_JSON_MAX_BYTES,
    readBoundedQqRestJson,
} from "./qq-json-response.js";

describe("QQ REST JSON response reader", () => {
    it("decodes a bounded JSON response", async () => {
        const response = Response.json({ access_token: "active-token", expires_in: 7200 });

        await expect(readBoundedQqRestJson({ response })).resolves.toEqual({
            access_token: "active-token",
            expires_in: 7200,
        });
    });

    it("cancels a response whose declared length exceeds the limit", async () => {
        const cancelBody = vi.fn();
        const response = new Response(new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('{"url":"wss://gateway.example/ws"}'));
            },
            cancel: cancelBody,
        }), {
            headers: { "content-length": String(DEFAULT_QQ_REST_JSON_MAX_BYTES + 1) },
        });

        await expect(readBoundedQqRestJson({ response }))
            .rejects.toThrow("QQ REST JSON response exceeds 262144 byte limit");
        expect(cancelBody).toHaveBeenCalledTimes(1);
    });

    it("rejects and cancels an invalid declared response length", async () => {
        const cancelBody = vi.fn();
        const response = new Response(new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('{"url":"wss://gateway.example/ws"}'));
            },
            cancel: cancelBody,
        }), {
            headers: { "content-length": "not-a-number" },
        });

        await expect(readBoundedQqRestJson({ response }))
            .rejects.toThrow("QQ REST JSON response has invalid Content-Length");
        expect(cancelBody).toHaveBeenCalledTimes(1);
    });

    it("cancels a response that crosses the cumulative byte limit", async () => {
        const cancelBody = vi.fn();
        const response = new Response(new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array(180 * 1024));
                controller.enqueue(new Uint8Array(80 * 1024));
            },
            cancel: cancelBody,
        }));

        await expect(readBoundedQqRestJson({ response }))
            .rejects.toThrow("QQ REST JSON response exceeds 262144 byte limit");
        expect(cancelBody).toHaveBeenCalledTimes(1);
    });

    it("preserves the caller abort reason and cancels a pending reader", async () => {
        const cancelBody = vi.fn();
        const response = new Response(new ReadableStream<Uint8Array>({
            pull() {
                return new Promise<void>(() => {});
            },
            cancel: cancelBody,
        }));
        const controller = new AbortController();
        const reading = readBoundedQqRestJson({
            response,
            abortSignal: controller.signal,
        });
        controller.abort(new Error("Stop QQ JSON read."));

        await expect(reading).rejects.toThrow("Stop QQ JSON read.");
        expect(cancelBody).toHaveBeenCalledTimes(1);
    });
});
