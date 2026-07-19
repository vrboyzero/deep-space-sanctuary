export type QqReplyContextCacheOptions = {
    ttlMs?: number;
    maxEntries?: number;
    now?: () => number;
};

export type QqReplyContextCacheSnapshot = {
    entryCount: number;
};

type QqReplyContextCacheEntry<T> = {
    value: T;
    lastAccessedAt: number;
};

const DEFAULT_QQ_REPLY_CONTEXT_TTL_MS = 30 * 60_000;
const DEFAULT_QQ_REPLY_CONTEXT_MAX_ENTRIES = 1_000;

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
    return Math.max(1, Math.floor(value));
}

export class QqReplyContextCache<T> {
    private readonly entries = new Map<string, QqReplyContextCacheEntry<T>>();
    private readonly ttlMs: number;
    private readonly maxEntries: number;
    private readonly getNow: () => number;

    constructor(options: QqReplyContextCacheOptions = {}) {
        this.ttlMs = normalizePositiveInteger(options.ttlMs, DEFAULT_QQ_REPLY_CONTEXT_TTL_MS);
        this.maxEntries = normalizePositiveInteger(options.maxEntries, DEFAULT_QQ_REPLY_CONTEXT_MAX_ENTRIES);
        this.getNow = options.now ?? Date.now;
    }

    set(chatId: string, value: T): void {
        const now = this.getNow();
        this.pruneExpired(now);

        // Map 的插入顺序就是 LRU 顺序；替换前删除可把该 key 移到最近使用端。
        this.entries.delete(chatId);
        this.entries.set(chatId, { value, lastAccessedAt: now });
        this.evictOverflow();
    }

    get(chatId: string): T | undefined {
        const now = this.getNow();
        this.pruneExpired(now);
        const entry = this.entries.get(chatId);
        if (!entry) return undefined;

        this.entries.delete(chatId);
        this.entries.set(chatId, { value: entry.value, lastAccessedAt: now });
        return entry.value;
    }

    clear(): void {
        this.entries.clear();
    }

    getSnapshot(): QqReplyContextCacheSnapshot {
        this.pruneExpired(this.getNow());
        return { entryCount: this.entries.size };
    }

    private pruneExpired(now: number): void {
        const expiresAtOrBefore = now - this.ttlMs;
        for (const [chatId, entry] of this.entries) {
            if (entry.lastAccessedAt <= expiresAtOrBefore) {
                this.entries.delete(chatId);
            }
        }
    }

    private evictOverflow(): void {
        while (this.entries.size > this.maxEntries) {
            const oldest = this.entries.keys().next();
            if (oldest.done) return;
            this.entries.delete(oldest.value);
        }
    }
}
