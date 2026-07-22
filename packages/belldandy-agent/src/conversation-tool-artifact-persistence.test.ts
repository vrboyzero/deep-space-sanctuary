import { describe, expect, it, vi } from "vitest";

import { ConversationLifecycleCoordinator } from "./conversation-lifecycle.js";
import {
    ConversationToolArtifactMetaPersistence,
    type ConversationMetaAsyncFs,
} from "./conversation-tool-artifact-persistence.js";

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function createAsyncFs(overrides: Partial<ConversationMetaAsyncFs> = {}): ConversationMetaAsyncFs {
    return {
        writeFile: vi.fn(async () => undefined),
        rename: vi.fn(async () => undefined),
        unlink: vi.fn(async () => undefined),
        ...overrides,
    };
}

function createPersistence(asyncFs: ConversationMetaAsyncFs, onError = vi.fn()) {
    const lifecycle = new ConversationLifecycleCoordinator();
    const persistence = new ConversationToolArtifactMetaPersistence({
        asyncFs,
        enqueue: (conversationId, task) => lifecycle.enqueue("tool_artifact_meta", conversationId, task),
        onError,
    });
    return { lifecycle, persistence, onError };
}

describe("ConversationToolArtifactMetaPersistence", () => {
    it("coalesces same-tick snapshots into one latest atomic write", async () => {
        const asyncFs = createAsyncFs();
        const { lifecycle, persistence } = createPersistence(asyncFs);

        persistence.schedule({ conversationId: "conv-a", filePath: "conv-a.meta.json", data: "first" });
        persistence.schedule({ conversationId: "conv-a", filePath: "conv-a.meta.json", data: "latest" });
        await lifecycle.waitForPendingPersistence("conv-a");

        expect(asyncFs.writeFile).toHaveBeenCalledTimes(1);
        expect(asyncFs.writeFile).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/), "latest", "utf-8");
        expect(asyncFs.rename).toHaveBeenCalledTimes(1);
        expect(asyncFs.rename).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/), "conv-a.meta.json");
        expect(persistence.hasPending("conv-a")).toBe(false);
    });

    it("keeps only the latest snapshot that arrives during an active write", async () => {
        const firstWrite = createDeferred();
        const written: string[] = [];
        const asyncFs = createAsyncFs({
            writeFile: vi.fn(async (_filePath, data) => {
                written.push(data);
                if (written.length === 1) {
                    await firstWrite.promise;
                }
            }),
        });
        const { lifecycle, persistence } = createPersistence(asyncFs);

        persistence.schedule({ conversationId: "conv-a", filePath: "conv-a.meta.json", data: "first" });
        await vi.waitFor(() => expect(asyncFs.writeFile).toHaveBeenCalledTimes(1));
        persistence.schedule({ conversationId: "conv-a", filePath: "conv-a.meta.json", data: "second" });
        persistence.schedule({ conversationId: "conv-a", filePath: "conv-a.meta.json", data: "latest" });
        firstWrite.resolve();
        await lifecycle.waitForPendingPersistence("conv-a");

        expect(written).toEqual(["first", "latest"]);
        expect(asyncFs.rename).toHaveBeenCalledTimes(2);
    });

    it("does not let one conversation block another conversation lane", async () => {
        const firstConversation = createDeferred();
        const asyncFs = createAsyncFs({
            writeFile: vi.fn(async (filePath) => {
                if (filePath.startsWith("conv-a.meta.json")) {
                    await firstConversation.promise;
                }
            }),
        });
        const { lifecycle, persistence } = createPersistence(asyncFs);

        persistence.schedule({ conversationId: "conv-a", filePath: "conv-a.meta.json", data: "a" });
        persistence.schedule({ conversationId: "conv-b", filePath: "conv-b.meta.json", data: "b" });

        await lifecycle.waitForPendingPersistence("conv-b");
        expect(asyncFs.rename).toHaveBeenCalledWith(expect.stringMatching(/^conv-b\.meta\.json.*\.tmp$/), "conv-b.meta.json");
        expect(persistence.hasPending("conv-a")).toBe(true);

        firstConversation.resolve();
        await lifecycle.waitForPendingPersistence("conv-a");
    });

    it("cleans the temp file and reports a bounded error when persistence fails", async () => {
        const failure = Object.assign(new Error("denied"), { code: "EACCES" });
        const asyncFs = createAsyncFs({
            writeFile: vi.fn(async () => {
                throw failure;
            }),
        });
        const { lifecycle, persistence, onError } = createPersistence(asyncFs);

        persistence.schedule({ conversationId: "conv-failure", filePath: "conv-failure.meta.json", data: "secret payload" });
        await lifecycle.waitForPendingPersistence("conv-failure");

        expect(asyncFs.unlink).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/));
        expect(onError).toHaveBeenCalledWith("conv-failure", failure);
        expect(JSON.stringify(onError.mock.calls)).not.toContain("secret payload");
        expect(persistence.hasPending("conv-failure")).toBe(false);
    });
});
