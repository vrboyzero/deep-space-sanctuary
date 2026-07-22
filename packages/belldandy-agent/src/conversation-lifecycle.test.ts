import { describe, expect, it, vi } from "vitest";
import {
    CONVERSATION_PERSISTENCE_LANES,
    ConversationLifecycleCoordinator,
} from "./conversation-lifecycle.js";

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

describe("ConversationLifecycleCoordinator", () => {
    it("invalidates the generation and waits for every persistence lane before release", async () => {
        const coordinator = new ConversationLifecycleCoordinator();
        const conversationId = "conv-release-all-lanes";
        const generation = coordinator.captureGeneration(conversationId);
        const deferred = CONVERSATION_PERSISTENCE_LANES.map(() => createDeferred());
        const writes = CONVERSATION_PERSISTENCE_LANES.map((lane, index) =>
            coordinator.enqueue(lane, conversationId, () => deferred[index]!.promise));
        const clear = vi.fn();

        const release = coordinator.release(conversationId, clear);
        const generationCapturedDuringRelease = coordinator.captureGeneration(conversationId);

        expect(coordinator.isGenerationCurrent(conversationId, generation)).toBe(false);
        expect(coordinator.isGenerationCurrent(conversationId, generationCapturedDuringRelease)).toBe(false);
        expect(coordinator.getSnapshot(conversationId)).toMatchObject({
            pendingPersistenceLaneCount: CONVERSATION_PERSISTENCE_LANES.length,
            releasing: true,
        });
        expect(clear).not.toHaveBeenCalled();

        deferred.forEach((item) => item.resolve());
        await Promise.all(writes);
        await release;

        expect(clear).toHaveBeenCalledTimes(1);
        expect(coordinator.getSnapshot(conversationId)).toEqual({
            activeGeneration: false,
            pendingPersistenceLaneCount: 0,
            releasing: false,
        });
        const reopenedGeneration = coordinator.captureGeneration(conversationId);
        expect(coordinator.isGenerationCurrent(conversationId, reopenedGeneration)).toBe(true);
        expect(coordinator.isGenerationCurrent(conversationId, generation)).toBe(false);
    });

    it("deduplicates concurrent release calls", async () => {
        const coordinator = new ConversationLifecycleCoordinator();
        const conversationId = "conv-release-idempotent";
        const deferred = createDeferred();
        const write = coordinator.enqueue("append", conversationId, () => deferred.promise);
        const clear = vi.fn();

        const first = coordinator.release(conversationId, clear);
        const second = coordinator.release(conversationId, clear);
        deferred.resolve();

        await write;
        await Promise.all([first, second]);
        expect(clear).toHaveBeenCalledTimes(1);
    });

    it("waits for pending persistence across every conversation and lane", async () => {
        const coordinator = new ConversationLifecycleCoordinator();
        const first = createDeferred();
        const second = createDeferred();
        const writes = [
            coordinator.enqueue("append", "conversation-a", () => first.promise),
            coordinator.enqueue("session_digest_state", "conversation-b", () => second.promise),
        ];
        let settled = false;
        const flush = coordinator.waitForAllPendingPersistence().then(() => {
            settled = true;
        });

        first.resolve();
        await writes[0];
        await Promise.resolve();
        expect(settled).toBe(false);

        second.resolve();
        await Promise.all(writes);
        await flush;
        expect(settled).toBe(true);
    });
});
