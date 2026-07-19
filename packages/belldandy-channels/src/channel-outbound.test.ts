import { describe, expect, it, vi } from "vitest";

import {
    ChannelOutboundDeadlineError,
    ChannelOutboundDeduplicator,
    readBoundedChannelErrorBody,
    runChannelOutbound,
} from "./channel-outbound.js";

describe("channel outbound", () => {
    it("aborts a pending outbound operation at its deadline", async () => {
        const operation = vi.fn((signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }));

        await expect(runChannelOutbound(operation, { timeoutMs: 5 })).rejects.toBeInstanceOf(ChannelOutboundDeadlineError);
        expect(operation).toHaveBeenCalledTimes(1);
    });

    it("propagates caller cancellation without classifying it as a timeout", async () => {
        const controller = new AbortController();
        const operation = vi.fn((signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }));
        const pending = runChannelOutbound(operation, { signal: controller.signal, timeoutMs: 10_000 });

        controller.abort(new Error("channel stopped"));

        await expect(pending).rejects.toThrow("channel stopped");
    });

    it("bounds a failed response body without reading trailing bytes", async () => {
        const response = new Response("abcdefghij", { status: 500 });

        await expect(readBoundedChannelErrorBody(response, 4)).resolves.toEqual({
            text: "abcd",
            truncated: true,
        });
    });

    it("coalesces and retains successful explicit idempotency keys", async () => {
        const deduplicator = new ChannelOutboundDeduplicator({ maxEntries: 2, retentionMs: 60_000 });
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const send = vi.fn(async () => {
            await gate;
            return true;
        });

        const first = deduplicator.run("message-1", send);
        const second = deduplicator.run("message-1", send);
        release();

        await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
        await expect(deduplicator.run("message-1", send)).resolves.toBe(true);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it("does not evict an in-flight idempotency key when the cache is full", async () => {
        const deduplicator = new ChannelOutboundDeduplicator({ maxEntries: 1, retentionMs: 60_000 });
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        const firstSend = vi.fn(async () => {
            await firstGate;
            return true;
        });

        const first = deduplicator.run("message-1", firstSend);
        await Promise.resolve();
        await deduplicator.run("message-2", async () => true);
        const duplicate = deduplicator.run("message-1", firstSend);
        releaseFirst();

        await expect(Promise.all([first, duplicate])).resolves.toEqual([true, true]);
        expect(firstSend).toHaveBeenCalledTimes(1);
    });
});
