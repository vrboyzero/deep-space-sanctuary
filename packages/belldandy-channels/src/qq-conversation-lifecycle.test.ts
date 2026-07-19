import { expect, test, vi } from "vitest";

import type { BelldandyAgent } from "@belldandy/agent";
import { ConversationStore } from "@belldandy/agent";
import { QqChannel } from "./qq.js";

test("QQ messages hold shared conversation leases through persistence and reply settlement", async () => {
    const started = new Set<string>();
    const gates = new Map<string, () => void>();
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
    const conversationStore = new ConversationStore();
    const writeLeaseCounts: number[] = [];
    const addMessageOriginal = conversationStore.addMessage.bind(conversationStore);
    vi.spyOn(conversationStore, "addMessage").mockImplementation((...args) => {
        writeLeaseCounts.push(activeLeaseCount);
        return addMessageOriginal(...args);
    });
    const channel = new QqChannel({
        appId: "app-id",
        appSecret: "app-secret",
        sandbox: true,
        agent,
        conversationStore,
        conversationLifecycle,
    });
    vi.spyOn(channel as any, "sendReply").mockResolvedValue(true);

    const firstPending = (channel as any).handleMessage(
        createMessage("qq-lifecycle-1", "first-pending"),
        "MESSAGE_CREATE",
    );
    await waitFor(() => started.has("first-pending"));
    expect(activeLeaseCount).toBe(1);

    const secondPending = (channel as any).handleMessage(
        createMessage("qq-lifecycle-2", "second-pending"),
        "MESSAGE_CREATE",
    );
    await waitFor(() => started.has("second-pending"));
    expect(activeLeaseCount).toBe(2);

    gates.get("first-pending")?.();
    await firstPending;
    expect(activeLeaseCount).toBe(1);

    gates.get("second-pending")?.();
    await secondPending;
    expect(activeLeaseCount).toBe(0);
    expect(writeLeaseCounts).toHaveLength(4);
    expect(writeLeaseCounts.every((count) => count >= 1)).toBe(true);
    expect(conversationLifecycle.acquire).toHaveBeenCalledTimes(2);
    expect(conversationLifecycle.acquire).toHaveBeenNthCalledWith(1, {
        conversationId: "qq_channel-lifecycle",
        agent,
    });
});

test("QQ releases the conversation lease after Agent failure settlement", async () => {
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
    const channel = new QqChannel({
        appId: "app-id",
        appSecret: "app-secret",
        sandbox: true,
        agent,
        conversationStore: new ConversationStore(),
        conversationLifecycle,
    });
    const sendReply = vi.spyOn(channel as any, "sendReply").mockResolvedValue(true);

    await (channel as any).handleMessage(
        createMessage("qq-lifecycle-error", "fail-run"),
        "MESSAGE_CREATE",
    );

    expect(sendReply).toHaveBeenCalledWith("抱歉，处理消息时出错了。", expect.any(Object));
    expect(release).toHaveBeenCalledTimes(1);
    expect(activeLeaseCount).toBe(0);
});

function createMessage(messageId: string, content: string) {
    return {
        id: messageId,
        content,
        channel_id: "channel-lifecycle",
        guild_id: "guild-lifecycle",
        author: {
            id: "user-lifecycle",
            username: "Lifecycle User",
        },
    };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("Timed out waiting for QQ lifecycle fixture");
}
