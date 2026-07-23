import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ConversationStore } from "./conversation.js";
import { sessionTranscriptReadStreamFs } from "./session-transcript.js";

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
            const transcriptRead = vi.spyOn(sessionTranscriptReadStreamFs, "createReadStream");

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
            const transcriptRead = vi.spyOn(sessionTranscriptReadStreamFs, "createReadStream");

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

    it("builds a cursor-bound timeline page without constructing the full restore projection", async () => {
        const { store, conversationId, tempDir } = createTranscriptStore("timeline-page");
        try {
            await store.waitForPendingPersistence(conversationId);
            const transcriptRead = vi.spyOn(sessionTranscriptReadStreamFs, "createReadStream");

            const firstPage = await store.buildConversationTimelinePage(conversationId, { pageSize: 1 });

            expect(transcriptRead).toHaveBeenCalledTimes(1);
            expect(firstPage).toMatchObject({
                manifest: {
                    conversationId,
                    source: "conversation.timeline.page",
                },
                summary: {
                    eventCount: 1,
                    itemCount: 1,
                    messageCount: 1,
                },
                page: {
                    cursorStatus: "initial",
                    nextCursor: expect.any(String),
                },
            });
            expect(firstPage.items).toHaveLength(1);

            const secondPage = await store.buildConversationTimelinePage(conversationId, {
                cursor: firstPage.page.nextCursor,
                pageSize: 1,
            });
            expect(transcriptRead).toHaveBeenCalledTimes(2);
            expect(secondPage).toMatchObject({
                summary: { eventCount: 1, messageCount: 1 },
                page: { cursorStatus: "valid" },
            });
            expect(secondPage.page.nextCursor).toBeUndefined();
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
