import { describe, expect, it } from "vitest";

import { QqReplyContextCache } from "./qq-reply-context-cache.js";

describe("QqReplyContextCache", () => {
    it("enforces one bounded TTL/LRU lifecycle", () => {
        let now = 0;
        const cache = new QqReplyContextCache<string>({
            ttlMs: 100,
            maxEntries: 2,
            now: () => now,
        });

        cache.set("old", "old");
        now = 50;
        cache.set("recent", "recent");
        now = 75;
        expect(cache.get("old")).toBe("old");

        // old 的原始写入已过 TTL，但 75ms 的读取刷新使它仍可参与后续 LRU 淘汰。
        now = 120;
        cache.set("third", "third");
        expect(cache.get("recent")).toBeUndefined();
        expect(cache.get("old")).toBe("old");
        expect(cache.get("third")).toBe("third");
        expect(cache.getSnapshot()).toEqual({ entryCount: 2 });

        cache.set("old", "replacement");
        expect(cache.get("old")).toBe("replacement");
        expect(cache.getSnapshot()).toEqual({ entryCount: 2 });

        now = 221;
        expect(cache.get("old")).toBeUndefined();
        expect(cache.getSnapshot()).toEqual({ entryCount: 0 });

        cache.set("final", "final");
        cache.clear();
        expect(cache.getSnapshot()).toEqual({ entryCount: 0 });
    });
});
