import crypto from "node:crypto";

import type { ChannelOutboundOptions } from "./types.js";

export const DEFAULT_CHANNEL_OUTBOUND_TIMEOUT_MS = 15_000;
export const DEFAULT_CHANNEL_ERROR_BODY_BYTES = 2 * 1024;

export class ChannelOutboundDeadlineError extends Error {
    constructor(timeoutMs: number) {
        super(`Channel outbound request exceeded its ${timeoutMs}ms deadline.`);
        this.name = "ChannelOutboundDeadlineError";
    }
}

export type ChannelOutboundFailureKind = "cancelled" | "deadline" | "rate_limited" | "retryable" | "permanent";

export type CombinedChannelAbortSignal = {
    signal?: AbortSignal;
    dispose(): void;
};

type ChannelOutboundDeduplicatorOptions = {
    maxEntries?: number;
    retentionMs?: number;
};

type ChannelOutboundDeduplicatorEntry = {
    promise: Promise<unknown>;
    completed: boolean;
    expiresAt: number;
    touchedAt: number;
};

/**
 * 出站调用统一通过 AbortSignal 和 deadline 收口。即使底层 SDK 不支持取消，调用方
 * 也会在 deadline 后得到确定结果，且不会自动重试可能已经投递成功的请求。
 */
export async function runChannelOutbound<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    options: ChannelOutboundOptions = {},
): Promise<T> {
    const timeoutMs = normalizeTimeout(options.timeoutMs);
    const controller = new AbortController();
    let timeout: NodeJS.Timeout | undefined;

    const forwardAbort = () => {
        if (!controller.signal.aborted) {
            controller.abort(options.signal?.reason ?? createAbortError());
        }
    };
    if (options.signal?.aborted) {
        forwardAbort();
    } else {
        options.signal?.addEventListener("abort", forwardAbort, { once: true });
    }
    timeout = setTimeout(() => {
        if (!controller.signal.aborted) {
            controller.abort(new ChannelOutboundDeadlineError(timeoutMs));
        }
    }, timeoutMs);

    const abortPromise = new Promise<never>((_resolve, reject) => {
        const rejectOnAbort = () => {
            controller.signal.removeEventListener("abort", rejectOnAbort);
            reject(toAbortError(controller.signal.reason));
        };
        if (controller.signal.aborted) {
            rejectOnAbort();
            return;
        }
        controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
    });

    try {
        return await Promise.race([
            Promise.resolve().then(() => operation(controller.signal)),
            abortPromise,
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
        options.signal?.removeEventListener("abort", forwardAbort);
    }
}

/** Combine caller and lifecycle signals without relying on a Node-version-specific AbortSignal.any implementation. */
export function combineChannelAbortSignals(
    signals: Array<AbortSignal | undefined>,
): CombinedChannelAbortSignal {
    const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
    if (activeSignals.length === 0) {
        return { dispose() {} };
    }
    if (activeSignals.length === 1) {
        return { signal: activeSignals[0], dispose() {} };
    }

    const controller = new AbortController();
    const listeners = new Map<AbortSignal, () => void>();
    const forward = (source: AbortSignal) => {
        if (!controller.signal.aborted) {
            controller.abort(source.reason ?? createAbortError());
        }
    };
    for (const signal of activeSignals) {
        if (signal.aborted) {
            forward(signal);
            break;
        }
        const listener = () => forward(signal);
        listeners.set(signal, listener);
        signal.addEventListener("abort", listener, { once: true });
    }
    return {
        signal: controller.signal,
        dispose() {
            for (const [signal, listener] of listeners) {
                signal.removeEventListener("abort", listener);
            }
        },
    };
}

export function throwIfChannelAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw toAbortError(signal.reason);
    }
}

export async function sleepWithChannelAbort(ms: number, signal?: AbortSignal): Promise<void> {
    throwIfChannelAborted(signal);
    if (ms <= 0) return;
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            reject(toAbortError(signal?.reason));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

/**
 * 失败响应通常来自外部服务，不能整段读入内存或拼入错误日志。该 helper 只消费受限字节。
 */
export async function readBoundedChannelErrorBody(
    response: Response,
    maxBytes = DEFAULT_CHANNEL_ERROR_BODY_BYTES,
): Promise<{ text: string; truncated: boolean }> {
    const limit = Math.max(0, Math.floor(maxBytes));
    const reader = response.body?.getReader();
    if (!reader) {
        return { text: "", truncated: false };
    }
    if (limit === 0) {
        await reader.cancel().catch(() => undefined);
        return { text: "", truncated: true };
    }

    const chunks: Buffer[] = [];
    let used = 0;
    let truncated = false;
    try {
        while (used < limit) {
            const result = await reader.read();
            if (result.done) break;
            const chunk = Buffer.from(result.value);
            const remaining = limit - used;
            if (chunk.byteLength > remaining) {
                chunks.push(chunk.subarray(0, remaining));
                used += remaining;
                truncated = true;
                break;
            }
            chunks.push(chunk);
            used += chunk.byteLength;
        }
        if (!truncated && used === limit) {
            const next = await reader.read();
            if (!next.done) {
                truncated = true;
            }
        }
    } finally {
        if (truncated) {
            await reader.cancel().catch(() => undefined);
        }
        reader.releaseLock();
    }
    return {
        text: Buffer.concat(chunks).toString("utf8"),
        truncated,
    };
}

/**
 * 自动重试只应使用在语义明确的请求上。调用者据此保留平台 message-id/幂等键，
 * 对 deadline 或不确定的投递结果默认不重试。
 */
export function classifyChannelOutboundFailure(input: {
    error?: unknown;
    status?: number;
}): ChannelOutboundFailureKind {
    if (input.error instanceof ChannelOutboundDeadlineError) return "deadline";
    if (isAbortLike(input.error)) return "cancelled";
    if (input.status === 429) return "rate_limited";
    if (typeof input.status === "number") {
        return input.status >= 500 || input.status === 408 ? "retryable" : "permanent";
    }
    return "retryable";
}

/**
 * 仅对调用者显式提供的 idempotency key 进行单飞与短期成功缓存。内存中只存 key 的
 * hash，避免消息 ID、平台 token 或正文意外进入长期诊断数据。
 */
export class ChannelOutboundDeduplicator {
    private readonly entries = new Map<string, ChannelOutboundDeduplicatorEntry>();
    private readonly maxEntries: number;
    private readonly retentionMs: number;

    constructor(options: ChannelOutboundDeduplicatorOptions = {}) {
        this.maxEntries = Math.max(1, Math.floor(options.maxEntries ?? 256));
        this.retentionMs = Math.max(1, Math.floor(options.retentionMs ?? 5 * 60_000));
    }

    run<T>(
        idempotencyKey: string | undefined,
        operation: () => Promise<T>,
        shouldRetain: (value: T) => boolean = (value) => value !== false,
    ): Promise<T> {
        const key = normalizeIdempotencyKey(idempotencyKey);
        if (!key) return Promise.resolve().then(operation);

        const now = Date.now();
        this.prune(now);
        const existing = this.entries.get(key);
        if (existing) {
            existing.touchedAt = now;
            return existing.promise as Promise<T>;
        }

        if (!this.evictToCapacity()) {
            // 不能为了腾出空间驱逐仍在运行的单飞请求，否则同一幂等键会再次投递。
            // 新的无关请求在饱和期间照常执行，只是不进入短期成功缓存。
            return Promise.resolve().then(operation);
        }
        const entry: ChannelOutboundDeduplicatorEntry = {
            promise: Promise.resolve(),
            completed: false,
            expiresAt: now + this.retentionMs,
            touchedAt: now,
        };
        const promise = Promise.resolve()
            .then(operation)
            .then(
                (value) => {
                    if (!shouldRetain(value)) {
                        this.entries.delete(key);
                    } else {
                        entry.completed = true;
                        entry.expiresAt = Date.now() + this.retentionMs;
                        entry.touchedAt = Date.now();
                    }
                    return value;
                },
                (error) => {
                    this.entries.delete(key);
                    throw error;
                },
            );
        entry.promise = promise;
        this.entries.set(key, entry);
        return promise;
    }

    clear(): void {
        this.entries.clear();
    }

    private prune(now: number): void {
        for (const [key, entry] of this.entries) {
            if (entry.completed && entry.expiresAt <= now) {
                this.entries.delete(key);
            }
        }
    }

    private evictToCapacity(): boolean {
        while (this.entries.size >= this.maxEntries) {
            const oldest = Array.from(this.entries.entries())
                .filter(([, entry]) => entry.completed)
                .sort(([, left], [, right]) => left.touchedAt - right.touchedAt)[0];
            if (!oldest) return false;
            this.entries.delete(oldest[0]);
        }
        return true;
    }
}

function normalizeTimeout(value: number | undefined): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        return DEFAULT_CHANNEL_OUTBOUND_TIMEOUT_MS;
    }
    return Math.floor(value);
}

function normalizeIdempotencyKey(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    if (!trimmed) return undefined;
    return crypto.createHash("sha256").update(trimmed).digest("hex");
}

function createAbortError(): Error {
    const error = new Error("Channel outbound operation was aborted.");
    error.name = "AbortError";
    return error;
}

function toAbortError(reason: unknown): Error {
    if (reason instanceof Error) return reason;
    return createAbortError();
}

function isAbortLike(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
}
