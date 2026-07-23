import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationStore } from "./conversation.js";
import { conversationMetaAsyncFs } from "./conversation-tool-artifact-persistence.js";
import { sessionTranscriptReadStreamFs } from "./session-transcript.js";

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("ConversationStore export persistence gate", () => {
    it("waits for pending tool artifact meta before reading transcript state", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-export-persistence-"));
        const dataDir = path.join(tempDir, "sessions");
        const conversationId = "conv-export-persistence";
        const pendingWrite = createDeferred();
        const writeFile = conversationMetaAsyncFs.writeFile.bind(conversationMetaAsyncFs);
        vi.spyOn(conversationMetaAsyncFs, "writeFile").mockImplementation(async (filePath, data, encoding) => {
            await pendingWrite.promise;
            await writeFile(filePath, data, encoding);
        });

        const store = new ConversationStore({ dataDir });
        store.recordToolArtifacts(conversationId, {
            toolDigest: {
                toolName: "file_read",
                success: true,
                summary: "file_read succeeded",
                toolCallId: "call-export-1",
            },
            recentToolResult: {
                toolCallId: "call-export-1",
                toolName: "file_read",
                success: true,
                summary: "file_read succeeded",
                content: "persist before export",
            },
        });
        const transcriptRead = vi.spyOn(sessionTranscriptReadStreamFs, "createReadStream");

        try {
            await vi.waitFor(() => expect(conversationMetaAsyncFs.writeFile).toHaveBeenCalled());
            const exported = store.buildConversationTranscriptExport(conversationId);
            await Promise.resolve();
            expect(transcriptRead).not.toHaveBeenCalled();

            pendingWrite.resolve();
            await exported;
            expect(transcriptRead).toHaveBeenCalled();
        } finally {
            pendingWrite.resolve();
            await store.waitForPendingPersistence(conversationId);
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("rejects a late tool artifact mutation while release is waiting for the active lane", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-release-persistence-"));
        const dataDir = path.join(tempDir, "sessions");
        const conversationId = "conv-release-persistence";
        const pendingWrite = createDeferred();
        const writeFile = conversationMetaAsyncFs.writeFile.bind(conversationMetaAsyncFs);
        vi.spyOn(conversationMetaAsyncFs, "writeFile").mockImplementation(async (filePath, data, encoding) => {
            await pendingWrite.promise;
            await writeFile(filePath, data, encoding);
        });

        const store = new ConversationStore({ dataDir });
        store.recordToolArtifacts(conversationId, {
            toolDigest: {
                toolName: "file_read",
                success: true,
                summary: "accepted before release",
                toolCallId: "call-release-accepted",
            },
            recentToolResult: {
                toolCallId: "call-release-accepted",
                toolName: "file_read",
                success: true,
                summary: "accepted before release",
                content: "accepted",
            },
        });

        try {
            await vi.waitFor(() => expect(conversationMetaAsyncFs.writeFile).toHaveBeenCalled());
            const release = store.releaseConversation(conversationId);
            store.recordToolArtifacts(conversationId, {
                toolDigest: {
                    toolName: "file_read",
                    success: true,
                    summary: "late during release",
                    toolCallId: "call-release-late",
                },
                recentToolResult: {
                    toolCallId: "call-release-late",
                    toolName: "file_read",
                    success: true,
                    summary: "late during release",
                    content: "late",
                },
            });

            pendingWrite.resolve();
            await release;

            const reloaded = new ConversationStore({ dataDir });
            expect(reloaded.getToolDigests(conversationId)).toMatchObject([
                expect.objectContaining({ toolCallId: "call-release-accepted" }),
            ]);
            expect(reloaded.getToolDigests(conversationId)).not.toEqual(expect.arrayContaining([
                expect.objectContaining({ toolCallId: "call-release-late" }),
            ]));
        } finally {
            pendingWrite.resolve();
            await store.waitForPendingPersistence(conversationId);
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
