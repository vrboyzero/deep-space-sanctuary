import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ConversationStore } from "./conversation.js";

function createTranscriptStore(label: string): {
    store: ConversationStore;
    conversationId: string;
    tempDir: string;
} {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `belldandy-transcript-single-read-${label}-`));
    const store = new ConversationStore({ dataDir: path.join(tempDir, "sessions") });
    const conversationId = `conv-transcript-single-read-${label}`;
    store.addMessage(conversationId, "user", "single read user message");
    store.addMessage(conversationId, "assistant", "single read assistant message");
    return { store, conversationId, tempDir };
}

describe("ConversationStore transcript single-read projections", () => {
    it("reuses one transcript snapshot for export and restore projection", async () => {
        const { store, conversationId, tempDir } = createTranscriptStore("export");
        try {
            await store.waitForPendingPersistence(conversationId);
            const transcriptRead = vi.spyOn(store, "getSessionTranscriptEvents");

            const exported = await store.buildConversationTranscriptExport(conversationId);

            expect(transcriptRead).toHaveBeenCalledTimes(1);
            expect(exported.events).toHaveLength(2);
            expect(exported.restore.rawMessages).toHaveLength(2);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("reuses one transcript snapshot for timeline and restore projection", async () => {
        const { store, conversationId, tempDir } = createTranscriptStore("timeline");
        try {
            await store.waitForPendingPersistence(conversationId);
            const transcriptRead = vi.spyOn(store, "getSessionTranscriptEvents");

            const timeline = await store.buildConversationTimeline(conversationId);

            expect(transcriptRead).toHaveBeenCalledTimes(1);
            expect(timeline.summary).toMatchObject({
                eventCount: 2,
                messageCount: 2,
            });
            expect(timeline.items.at(-1)).toMatchObject({
                kind: "restore_result",
                canonicalExtractionCount: 2,
            });
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
