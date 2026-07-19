import { describe, expect, it, vi } from "vitest";

import { DefaultChannelManager } from "./manager.js";
import type { Channel } from "./types.js";

function createChannel(input: {
    name?: string;
    running?: boolean;
    start?: () => Promise<void>;
    stop?: () => Promise<void>;
} = {}): Channel {
    let running = input.running ?? false;
    return {
        name: input.name ?? "channel",
        lifecycleState: running ? "running" : "stopped",
        get isRunning() {
            return running;
        },
        async start() {
            await input.start?.();
            running = true;
        },
        async stop() {
            await input.stop?.();
            running = false;
        },
        async sendProactiveMessage() {
            return true;
        },
    };
}

describe("DefaultChannelManager", () => {
    it("stops a running owner before publishing its replacement", async () => {
        const manager = new DefaultChannelManager();
        const events: string[] = [];
        const previous = createChannel({
            running: true,
            stop: async () => {
                events.push("previous:stop");
            },
        });
        const replacement = createChannel({ name: "channel" });

        await manager.register(previous);
        await manager.register(replacement);

        expect(events).toEqual(["previous:stop"]);
        expect(manager.get("channel")).toBe(replacement);
        expect(previous.isRunning).toBe(false);
    });

    it("keeps the previous owner published until its asynchronous stop completes", async () => {
        const manager = new DefaultChannelManager();
        let releaseStop!: () => void;
        const stopGate = new Promise<void>((resolve) => {
            releaseStop = resolve;
        });
        const previous = createChannel({
            running: true,
            stop: async () => {
                await stopGate;
            },
        });
        const replacement = createChannel({ name: "channel" });

        await manager.register(previous);
        const replacing = manager.register(replacement);

        expect(manager.get("channel")).toBe(previous);
        releaseStop();
        await replacing;
        expect(manager.get("channel")).toBe(replacement);
    });

    it("does not discard a running owner when stop fails during replacement", async () => {
        const manager = new DefaultChannelManager();
        const previous = createChannel({
            running: true,
            stop: async () => {
                throw new Error("stop failed");
            },
        });
        const replacement = createChannel({ name: "channel" });

        await manager.register(previous);

        await expect(manager.register(replacement)).rejects.toThrow("stop failed");
        expect(manager.get("channel")).toBe(previous);
    });

    it("stops a running owner before unregistering it", async () => {
        const manager = new DefaultChannelManager();
        const stop = vi.fn(async () => {});
        const channel = createChannel({ running: true, stop });

        await manager.register(channel);
        await manager.unregister("channel");

        expect(stop).toHaveBeenCalledTimes(1);
        expect(manager.get("channel")).toBeUndefined();
    });
});
