import { expect, test, vi } from "vitest";

import type { BelldandyAgent } from "@belldandy/agent";
import { DiscordChannel } from "./discord.js";

test("Discord messages hold shared conversation leases through typing and reply settlement", async () => {
    const started = new Set<string>();
    const gates = new Map<string, () => void>();
    const typingLeaseCounts: number[] = [];
    const sendLeaseCounts: number[] = [];
    let activeLeaseCount = 0;
    const waitForGate = (text: string) => new Promise<void>((resolve) => {
        gates.set(text, resolve);
    });
    const agent: BelldandyAgent = {
        async *run(input) {
            const runPending = waitForGate(input.text);
            started.add(input.text);
            yield { type: "status", status: "running" };
            await runPending;
            yield { type: "final", text: `echo:${input.text}` };
            yield { type: "status", status: "done" };
        },
    };
    const conversationLifecycle = {
        acquire: vi.fn(async () => {
            activeLeaseCount += 1;
            let released = false;
            return {
                async release() {
                    if (released) return;
                    released = true;
                    activeLeaseCount -= 1;
                },
            };
        }),
    };
    const channel = new DiscordChannel({
        botToken: "discord-token",
        agent,
        conversationLifecycle,
    });

    const firstPending = (channel as any).handleMessage(createMessage({
        id: "discord-lifecycle-1",
        content: "first-pending",
        onTyping: () => typingLeaseCounts.push(activeLeaseCount),
        onSend: () => sendLeaseCounts.push(activeLeaseCount),
    }));
    await waitFor(() => started.has("first-pending"));
    expect(activeLeaseCount).toBe(1);

    const secondPending = (channel as any).handleMessage(createMessage({
        id: "discord-lifecycle-2",
        content: "second-pending",
        onTyping: () => typingLeaseCounts.push(activeLeaseCount),
        onSend: () => sendLeaseCounts.push(activeLeaseCount),
    }));
    await waitFor(() => started.has("second-pending"));
    expect(activeLeaseCount).toBe(2);

    gates.get("first-pending")?.();
    await firstPending;
    expect(activeLeaseCount).toBe(1);

    gates.get("second-pending")?.();
    await secondPending;
    expect(activeLeaseCount).toBe(0);
    expect(typingLeaseCounts).toHaveLength(2);
    expect(sendLeaseCounts).toHaveLength(2);
    expect([...typingLeaseCounts, ...sendLeaseCounts].every((count) => count >= 1)).toBe(true);
    expect(conversationLifecycle.acquire).toHaveBeenCalledTimes(2);
    expect(conversationLifecycle.acquire).toHaveBeenNthCalledWith(1, {
        conversationId: "dm-lifecycle",
        agent,
    });
});

test("Discord releases the conversation lease after Agent failure reply settlement", async () => {
    let activeLeaseCount = 0;
    const release = vi.fn(async () => {
        activeLeaseCount -= 1;
    });
    const conversationLifecycle = {
        acquire: vi.fn(async () => {
            activeLeaseCount += 1;
            return { release };
        }),
    };
    const agent: BelldandyAgent = {
        async *run() {
            throw new Error("agent failure fixture");
        },
    };
    const errorReplyLeaseCounts: number[] = [];
    const channel = new DiscordChannel({
        botToken: "discord-token",
        agent,
        conversationLifecycle,
    });

    await (channel as any).handleMessage(createMessage({
        id: "discord-lifecycle-error",
        content: "fail-run",
        onReply: () => errorReplyLeaseCounts.push(activeLeaseCount),
    }));

    expect(errorReplyLeaseCounts).toEqual([1]);
    expect(release).toHaveBeenCalledTimes(1);
    expect(activeLeaseCount).toBe(0);
});

function createMessage(input: {
    id: string;
    content: string;
    onTyping?: () => void;
    onSend?: () => void;
    onReply?: () => void;
}) {
    return {
        id: input.id,
        author: {
            id: "user-lifecycle",
            username: "Lifecycle User",
            bot: false,
        },
        content: input.content,
        channelId: "dm-lifecycle",
        guildId: null,
        attachments: new Map(),
        mentions: {
            users: [],
            has: () => false,
        },
        channel: {
            isTextBased: () => true,
            async sendTyping() {
                input.onTyping?.();
            },
            async send() {
                input.onSend?.();
            },
        },
        async reply() {
            input.onReply?.();
        },
    };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("Timed out waiting for Discord lifecycle fixture");
}
