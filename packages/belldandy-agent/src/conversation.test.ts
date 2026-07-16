import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { FilesystemCapability } from "@belldandy/protocol";
import { ConversationStore, conversationAsyncFs } from "./conversation.js";
import { CompactionRuntimeTracker } from "./compaction-runtime.js";

describe("ConversationStore", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should add and retrieve messages", () => {
        const store = new ConversationStore();
        const id = "test-conv";

        store.addMessage(id, "user", "Hello");
        store.addMessage(id, "assistant", "Hi there");

        const history = store.getHistory(id);
        expect(history).toHaveLength(2);
        expect(history[0]).toEqual({ role: "user", content: "Hello" });
        expect(history[1]).toEqual({ role: "assistant", content: "Hi there" });
    });

    it("should respect maxHistory limit", () => {
        const store = new ConversationStore({ maxHistory: 2 });
        const id = "test-limit";

        store.addMessage(id, "user", "1");
        store.addMessage(id, "assistant", "2");
        store.addMessage(id, "user", "3");

        const history = store.getHistory(id);
        expect(history).toHaveLength(2);
        expect(history[0]).toEqual({ role: "assistant", content: "2" });
        expect(history[1]).toEqual({ role: "user", content: "3" });
    });

    it("should respect TTL", async () => {
        // TTL 0.01 seconds
        const store = new ConversationStore({ ttlSeconds: 0.01 });
        const id = "test-ttl";

        store.addMessage(id, "user", "Hi");

        // Wait for expiration
        await new Promise(r => setTimeout(r, 20));

        const history = store.getHistory(id);
        expect(history).toHaveLength(0);
    });

    it("should restore persisted conversations from disk even after in-memory TTL expiry", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const id = "persisted-email-thread";

        const writer = new ConversationStore({ dataDir, ttlSeconds: 0.01 });
        writer.addMessage(id, "user", "Inbound email content");
        await writer.waitForPendingPersistence(id);

        await new Promise((resolve) => setTimeout(resolve, 20));

        const reloaded = new ConversationStore({ dataDir, ttlSeconds: 0.01 });
        expect(reloaded.getHistory(id)).toEqual([
            { role: "user", content: "Inbound email content" },
        ]);

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should return conversation snapshot together with compacted history", async () => {
        const store = new ConversationStore();
        const id = "test-snapshot";

        store.addMessage(id, "user", "Hello");
        store.addMessage(id, "assistant", "<audio controls>demo</audio>\n\n答复正文\n\n[Download](/generated/demo.mp3)");

        const result = await store.getConversationHistoryCompacted(id);

        expect(result.compacted).toBe(false);
        expect(result.conversation?.id).toBe(id);
        expect(result.conversation?.messages).toHaveLength(2);
        expect(result.history).toEqual([
            { role: "user", content: "Hello" },
            { role: "assistant", content: "答复正文" },
        ]);
    });

    it("should skip persistence without surfacing noise when dataDir has been removed", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const store = new ConversationStore({ dataDir });
        fs.rmSync(dataDir, { recursive: true, force: true });

        const appendSpy = vi.spyOn(conversationAsyncFs, "appendFile").mockRejectedValue(Object.assign(new Error("missing dir"), { code: "ENOENT" }));
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        store.addMessage("conv-noise", "user", "hello");

        expect(appendSpy).not.toHaveBeenCalled();
        expect(errorSpy).not.toHaveBeenCalled();

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should still log non-ENOENT append errors", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const store = new ConversationStore({ dataDir });

        const appendSpy = vi.spyOn(conversationAsyncFs, "appendFile").mockRejectedValue(Object.assign(new Error("denied"), { code: "EACCES" }));
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        store.addMessage("conv-error", "user", "hello");
        await waitFor(() => appendSpy.mock.calls.length === 1);
        await waitFor(() => errorSpy.mock.calls.length === 1);

        expect(appendSpy).toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledTimes(1);

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should serialize append writes for the same conversation", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const store = new ConversationStore({ dataDir });
        const appendOrder: string[] = [];
        let releaseFirst!: () => void;
        const firstPending = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        let callCount = 0;

        const appendSpy = vi.spyOn(conversationAsyncFs, "appendFile").mockImplementation(async (_path, data) => {
            callCount += 1;
            appendOrder.push(String(data));
            if (callCount === 1) {
                await firstPending;
            }
        });

        store.addMessage("conv-serial", "user", "first");
        store.addMessage("conv-serial", "assistant", "second");

        await waitFor(() => appendSpy.mock.calls.length === 1);
        expect(appendSpy).toHaveBeenCalledTimes(1);

        releaseFirst();
        await waitFor(() => appendSpy.mock.calls.length === 2);

        expect(appendSpy).toHaveBeenCalledTimes(2);
        expect(appendOrder[0]).toContain('"content":"first"');
        expect(appendOrder[1]).toContain('"content":"second"');

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should persist session transcript events for accepted user and assistant messages", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const store = new ConversationStore({ dataDir });
        const id = "conv-transcript";

        const userMessage = store.addMessage(id, "user", "你好，今天继续上次的话题。", {
            agentId: "belldandy",
            channel: "webchat",
        });
        const assistantMessage = store.addMessage(id, "assistant", "我记得，我们上次聊到了阶段二的收口。", {
            agentId: "belldandy",
        });
        await store.waitForPendingPersistence(id);

        const events = await store.getSessionTranscriptEvents(id);

        expect(events).toHaveLength(2);
        expect(events[0]).toMatchObject({
            conversationId: id,
            type: "user_message_accepted",
            payload: {
                message: {
                    id: userMessage.id,
                    role: "user",
                    content: "你好，今天继续上次的话题。",
                },
                conversation: {
                    agentId: "belldandy",
                    channel: "webchat",
                },
            },
        });
        expect(events[1]).toMatchObject({
            conversationId: id,
            type: "assistant_message_finalized",
            payload: {
                message: {
                    id: assistantMessage.id,
                    role: "assistant",
                    content: "我记得，我们上次聊到了阶段二的收口。",
                },
            },
        });

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should persist a user transcript event even before any assistant reply exists", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const store = new ConversationStore({ dataDir });
        const id = "conv-transcript-user-only";

        const userMessage = store.addMessage(id, "user", "先记住这条消息。", {
            agentId: "belldandy",
            channel: "webchat",
        });
        await store.waitForPendingPersistence(id);

        const events = await store.getSessionTranscriptEvents(id);

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            conversationId: id,
            type: "user_message_accepted",
            payload: {
                message: {
                    id: userMessage.id,
                    role: "user",
                    content: "先记住这条消息。",
                },
            },
        });

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should persist task token records and active counters in meta file", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const store = new ConversationStore({ dataDir });

        store.addMessage("conv-meta", "user", "hello", { agentId: "agent-a", channel: "webchat" });
        store.recordTaskTokenResult("conv-meta", {
            name: "run",
            inputTokens: 12,
            outputTokens: 8,
            totalTokens: 20,
            durationMs: 450,
            auto: true,
            createdAt: 1234567890,
        });
        store.setActiveCounters("conv-meta", [{
            name: "counter-1",
            startTime: 1234,
            baseInputTokens: 10,
            baseOutputTokens: 5,
            savedGlobalInputTokens: 15,
            savedGlobalOutputTokens: 9,
        }]);
        await new Promise((resolve) => setTimeout(resolve, 10));

        const reloaded = new ConversationStore({ dataDir });
        expect(reloaded.get("conv-meta")?.agentId).toBe("agent-a");
        expect(reloaded.get("conv-meta")?.channel).toBe("webchat");
        expect(reloaded.getTaskTokenResults("conv-meta")).toEqual([{
            name: "run",
            inputTokens: 12,
            outputTokens: 8,
            totalTokens: 20,
            durationMs: 450,
            auto: true,
            createdAt: 1234567890,
        }]);
        expect(reloaded.getActiveCounters("conv-meta")).toEqual([{
            name: "counter-1",
            startTime: 1234,
            baseInputTokens: 10,
            baseOutputTokens: 5,
            savedGlobalInputTokens: 15,
            savedGlobalOutputTokens: 9,
        }]);

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should reload meta-only conversations without jsonl history", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const store = new ConversationStore({ dataDir });

        store.recordTaskTokenResult("conv-meta-only", {
            name: "run",
            inputTokens: 5,
            outputTokens: 7,
            totalTokens: 12,
            durationMs: 321,
            auto: true,
            createdAt: 111,
        });

        const reloaded = new ConversationStore({ dataDir });
        expect(reloaded.getTaskTokenResults("conv-meta-only")).toEqual([{
            name: "run",
            inputTokens: 5,
            outputTokens: 7,
            totalTokens: 12,
            durationMs: 321,
            auto: true,
            createdAt: 111,
        }]);

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should skip persistence when dataDir disappears during capability resolution", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const store = new ConversationStore({ dataDir });
        const resolveForWriteRelative = FilesystemCapability.prototype.resolveForWriteRelative;
        vi.spyOn(FilesystemCapability.prototype, "resolveForWriteRelative").mockImplementation(function (
            this: FilesystemCapability,
            relativePath,
            label,
        ) {
            fs.rmSync(dataDir, { recursive: true, force: true });
            return resolveForWriteRelative.call(this, relativePath, label);
        });

        const getConversationFilePath = (store as unknown as {
            getConversationFilePath: (id: string, suffix: string) => string | undefined;
        }).getConversationFilePath.bind(store);

        expect(getConversationFilePath("conv-race", ".jsonl")).toBeUndefined();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should persist and restore plan state for meta-only conversations", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const store = new ConversationStore({ dataDir });
        const id = "conv-plan-only";

        const updated = store.updatePlanState(id, {
            ifAbsent: "create",
            seed: {
                title: "统一计划",
                status: "active",
                mode: "agent",
            },
            operations: [{
                type: "upsert_step",
                step: {
                    id: "phase-a",
                    title: "梳理会话真源",
                    status: "in_progress",
                },
            }],
        });

        expect(updated.applied).toBe(true);
        expect(updated.planState).toMatchObject({
            title: "统一计划",
            status: "active",
            mode: "agent",
            revision: 1,
            steps: [{
                id: "phase-a",
                title: "梳理会话真源",
                status: "in_progress",
            }],
        });

        const reloaded = new ConversationStore({ dataDir });
        expect(reloaded.getPlanState(id)).toMatchObject({
            title: "统一计划",
            revision: 1,
            steps: [{
                id: "phase-a",
                title: "梳理会话真源",
                status: "in_progress",
            }],
        });

        const restored = await reloaded.getConversationHistoryCompacted(id);
        expect(restored.conversation?.id).toBe(id);
        expect(restored.conversation?.planState?.title).toBe("统一计划");
        expect(restored.history).toEqual([]);

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should reject stale revision updates for current plan state", () => {
        const store = new ConversationStore();
        const id = "conv-plan-conflict";

        const initial = store.updatePlanState(id, {
            ifAbsent: "create",
            seed: {
                title: "Phase A",
                status: "active",
                mode: "agent",
            },
            operations: [{
                type: "upsert_step",
                step: {
                    id: "step-1",
                    title: "建立真源",
                    status: "in_progress",
                },
            }],
        });
        expect(initial.applied).toBe(true);
        expect(initial.planState?.revision).toBe(1);

        const conflicted = store.updatePlanState(id, {
            baseRevision: 0,
            operations: [{
                type: "set_header",
                title: "过期修改",
            }],
        });

        expect(conflicted.applied).toBe(false);
        expect(conflicted.conflict).toBe(true);
        expect(conflicted.reasonCode).toBe("conflict");
        expect(conflicted.planState?.revision).toBe(1);
        expect(store.getPlanState(id)?.title).toBe("Phase A");
    });

    it("should clear persisted plan state and avoid restoring cleared meta-only conversations", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const store = new ConversationStore({ dataDir });
        const id = "conv-plan-cleared";

        const created = store.updatePlanState(id, {
            ifAbsent: "create",
            seed: {
                title: "待清理计划",
                status: "draft",
                mode: "agent",
            },
            operations: [{
                type: "set_focus",
                nextAction: "先删除计划态",
            }],
        });
        expect(created.applied).toBe(true);
        expect(store.getPlanState(id)?.title).toBe("待清理计划");

        const cleared = store.clearPlanState(id, "system");
        expect(cleared).toBeNull();
        expect(store.getPlanState(id)).toBeNull();

        const reloaded = new ConversationStore({ dataDir });
        expect(reloaded.getPlanState(id)).toBeNull();
        expect(reloaded.get(id)).toBeUndefined();

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should persist community conversation files with Windows-safe filenames", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const conversationId = "community:room-1";
        const store = new ConversationStore({ dataDir });

        store.addMessage(conversationId, "user", "hello", {
            agentId: "agent-a",
            channel: "community",
        });
        store.recordTaskTokenResult(conversationId, {
            name: "run",
            inputTokens: 4,
            outputTokens: 6,
            totalTokens: 10,
            durationMs: 120,
            auto: true,
            createdAt: 222,
        });

        await waitFor(() => fs.readdirSync(dataDir).some((entry) => entry.endsWith(".jsonl")));

        const persistedFiles = fs.readdirSync(dataDir);
        expect(persistedFiles.some((entry) => entry.includes(":"))).toBe(false);
        expect(persistedFiles.some((entry) => entry.includes("community%3Aroom-1.meta.json"))).toBe(true);
        expect(persistedFiles.some((entry) => entry.includes("community%3Aroom-1.jsonl"))).toBe(true);

        const reloaded = new ConversationStore({ dataDir });
        expect(reloaded.getHistory(conversationId)).toEqual([{ role: "user", content: "hello" }]);
        expect(reloaded.get(conversationId)?.channel).toBe("community");
        expect(reloaded.get(conversationId)?.agentId).toBe("agent-a");
        expect(reloaded.getTaskTokenResults(conversationId)).toEqual([{
            name: "run",
            inputTokens: 4,
            outputTokens: 6,
            totalTokens: 10,
            durationMs: 120,
            auto: true,
            createdAt: 222,
        }]);

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should reject unsafe legacy conversation file candidates while retaining safe legacy files", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const outsidePath = path.join(tempDir, "outside.jsonl");
        const legacyId = "legacy-room";
        const outsideContent = `${JSON.stringify({ role: "user", content: "outside", timestamp: 1 })}\n`;
        const legacyContent = `${JSON.stringify({ role: "user", content: "legacy", timestamp: 2 })}\n`;

        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(outsidePath, outsideContent, "utf8");
        fs.writeFileSync(path.join(dataDir, `${legacyId}.jsonl`), legacyContent, "utf8");
        const store = new ConversationStore({ dataDir });

        expect(store.getHistory("../outside")).toEqual([]);
        expect(fs.readFileSync(outsidePath, "utf8")).toBe(outsideContent);
        expect(store.getHistory(legacyId)).toEqual([{ role: "user", content: "legacy" }]);

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should avoid sync file reads on async cold-load path", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const store = new ConversationStore({ dataDir });

        store.addMessage("conv-async-load", "user", "hello", { agentId: "agent-a", channel: "webchat" });
        // 以实际 append 队列完成作为冷加载前置条件，避免全量并行测试下的任意时钟等待。
        await store.waitForPendingPersistence("conv-async-load");

        const reloaded = new ConversationStore({ dataDir });
        const readFileSyncSpy = vi.spyOn(fs, "readFileSync");

        const result = await reloaded.getConversationHistoryCompacted("conv-async-load");

        expect(result.conversation?.agentId).toBe("agent-a");
        expect(result.history).toEqual([{ role: "user", content: "hello" }]);
        expect(readFileSyncSpy).not.toHaveBeenCalled();

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should async cold-load only the recent tail when meta sidecar exists", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const store = new ConversationStore({ dataDir, maxHistory: 2 });
        const id = "conv-async-tail-load";

        store.addMessage(id, "user", "first", { agentId: "agent-a", channel: "webchat" });
        store.addMessage(id, "assistant", "second");
        store.addMessage(id, "user", "third");
        await store.waitForPendingPersistence(id);

        const reloaded = new ConversationStore({ dataDir, maxHistory: 2 });
        const readFileSpy = vi.spyOn(conversationAsyncFs, "readFile");

        const result = await reloaded.getConversationHistoryCompacted(id);

        expect(result.conversation?.agentId).toBe("agent-a");
        expect(result.history).toEqual([
            { role: "assistant", content: "second" },
            { role: "user", content: "third" },
        ]);
        expect(readFileSpy.mock.calls.some(([filePath]) => String(filePath).endsWith(".jsonl"))).toBe(false);

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should build and persist session digest from compaction state", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const store = new ConversationStore({
            dataDir,
            compaction: {
                enabled: true,
                tokenThreshold: 10,
                keepRecentCount: 1,
            },
            summarizer: async () => "rolling-summary-v1",
        });
        const id = "conv-session-digest";
        const originalAppendFile = conversationAsyncFs.appendFile;
        vi.spyOn(conversationAsyncFs, "appendFile").mockImplementation(async (filePath, data, encoding) => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return originalAppendFile(filePath, data, encoding);
        });

        store.addMessage(id, "user", "A".repeat(80));
        store.addMessage(id, "assistant", "B".repeat(80));
        store.addMessage(id, "user", "C".repeat(80));

        const refreshed = await store.refreshSessionDigest(id, { force: true, threshold: 2 });

        expect(refreshed.updated).toBe(true);
        expect(refreshed.compacted).toBe(false);
        expect(refreshed.digest).toMatchObject({
            conversationId: id,
            status: "ready",
            messageCount: 3,
            digestedMessageCount: 3,
            pendingMessageCount: 0,
            threshold: 2,
            rollingSummary: "rolling-summary-v1",
            archivalSummary: "",
        });
        expect(refreshed.digest.lastDigestAt).toBeGreaterThan(0);
        expect(refreshed.digest.digestGeneration).toBe(1);

        const memory = await store.getSessionMemory(id);
        expect(memory).toMatchObject({
            conversationId: id,
            summary: "rolling-summary-v1",
            lastSummarizedMessageCount: 3,
        });

        const reloaded = new ConversationStore({
            dataDir,
            compaction: {
                enabled: true,
                tokenThreshold: 10,
                keepRecentCount: 1,
            },
        });
        const digest = await reloaded.getSessionDigest(id);
        expect(digest.threshold).toBe(2);
        expect(digest.rollingSummary).toBe("rolling-summary-v1");
        expect(digest.digestedMessageCount).toBe(3);
        expect(digest.digestGeneration).toBe(1);

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should only advance digestGeneration when digest content changes", async () => {
        const store = new ConversationStore({
            summarizer: async () => "rolling-summary-v1",
        });
        const id = "conv-session-digest-generation";

        store.addMessage(id, "user", "第一轮消息 A");
        store.addMessage(id, "assistant", "第一轮消息 B");
        await store.refreshSessionDigest(id, { force: true, threshold: 2 });

        const afterFirstRefresh = await store.getSessionDigest(id, { threshold: 2 });
        expect(afterFirstRefresh.digestGeneration).toBe(1);

        await store.refreshSessionDigest(id, { threshold: 4 });
        const afterThresholdOnlyRefresh = await store.getSessionDigest(id, { threshold: 4 });
        expect(afterThresholdOnlyRefresh.digestGeneration).toBe(1);

        store.addMessage(id, "user", "第二轮消息 C");
        store.addMessage(id, "assistant", "第二轮消息 D");
        const afterContentRefresh = await store.refreshSessionDigest(id, { force: true, threshold: 2 });
        expect(afterContentRefresh.digest.digestGeneration).toBe(2);
    });

    it("should mark session digest as updated when pending messages cross threshold", async () => {
        const store = new ConversationStore({
            compaction: {
                enabled: true,
                tokenThreshold: 10,
                keepRecentCount: 1,
            },
            summarizer: async () => "rolling-summary-v1",
        });
        const id = "conv-session-digest-threshold";

        store.addMessage(id, "user", "A".repeat(80));
        store.addMessage(id, "assistant", "B".repeat(80));
        store.addMessage(id, "user", "C".repeat(80));
        await store.refreshSessionDigest(id, { force: true, threshold: 2 });

        store.addMessage(id, "assistant", "D".repeat(80));
        store.addMessage(id, "user", "E".repeat(80));

        const digest = await store.getSessionDigest(id, { threshold: 2 });
        expect(digest).toMatchObject({
            conversationId: id,
            status: "updated",
            messageCount: 5,
            digestedMessageCount: 3,
            pendingMessageCount: 2,
            threshold: 2,
        });
    });

    it("should keep pending session digest counts correct when maxHistory window rolls forward", async () => {
        const store = new ConversationStore({
            maxHistory: 3,
            summarizer: async () => "rolling-summary-v1",
        });
        const id = "conv-session-digest-rolling-window";

        store.addMessage(id, "user", "A");
        store.addMessage(id, "assistant", "B");
        store.addMessage(id, "user", "C");
        await store.refreshSessionDigest(id, { force: true, threshold: 2 });

        const afterFirstRefresh = await store.getSessionMemory(id);
        expect(afterFirstRefresh.lastSummarizedMessageCount).toBe(3);
        expect(afterFirstRefresh.lastSummarizedMessageId).toBeTruthy();

        store.addMessage(id, "assistant", "D");
        store.addMessage(id, "user", "E");

        const digestWhileBoundaryStillVisible = await store.getSessionDigest(id, { threshold: 2 });
        expect(digestWhileBoundaryStillVisible).toMatchObject({
            conversationId: id,
            status: "updated",
            messageCount: 3,
            digestedMessageCount: 1,
            pendingMessageCount: 2,
            threshold: 2,
        });

        store.addMessage(id, "assistant", "F");
        store.addMessage(id, "user", "G");

        const digestAfterBoundaryRolledOut = await store.getSessionDigest(id, { threshold: 2 });
        expect(digestAfterBoundaryRolledOut).toMatchObject({
            conversationId: id,
            status: "updated",
            messageCount: 3,
            digestedMessageCount: 0,
            pendingMessageCount: 3,
            threshold: 2,
        });

        const refreshed = await store.refreshSessionDigest(id, { force: true, threshold: 2 });
        expect(refreshed.updated).toBe(true);
        expect(refreshed.digest).toMatchObject({
            conversationId: id,
            status: "ready",
            messageCount: 3,
            digestedMessageCount: 3,
            pendingMessageCount: 0,
            threshold: 2,
        });

        const finalMemory = await store.getSessionMemory(id);
        expect(finalMemory.lastSummarizedMessageId).toBeTruthy();
        expect(finalMemory.lastSummarizedMessageId).not.toBe(afterFirstRefresh.lastSummarizedMessageId);
    });

    it("should re-open pending session digest for legacy records without message ids once history window saturates", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const id = "conv-session-digest-legacy-window";

        const store = new ConversationStore({
            dataDir,
            maxHistory: 3,
            summarizer: async () => "rolling-summary-v1",
        });

        store.addMessage(id, "user", "A");
        store.addMessage(id, "assistant", "B");
        store.addMessage(id, "user", "C");
        await store.refreshSessionDigest(id, { force: true, threshold: 2 });

        const sessionMemoryPath = path.join(dataDir, `${id}.session-memory.json`);
        const persistedMemory = JSON.parse(fs.readFileSync(sessionMemoryPath, "utf-8")) as Record<string, unknown>;
        delete persistedMemory.lastSummarizedMessageId;
        fs.writeFileSync(sessionMemoryPath, JSON.stringify(persistedMemory, null, 2), "utf-8");

        const reloaded = new ConversationStore({
            dataDir,
            maxHistory: 3,
            summarizer: async () => "rolling-summary-v1",
        });

        const digest = await reloaded.getSessionDigest(id, { threshold: 2 });
        expect(digest).toMatchObject({
            conversationId: id,
            status: "updated",
            messageCount: 3,
            digestedMessageCount: 0,
            pendingMessageCount: 3,
            threshold: 2,
        });

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should persist and reload carryover context records from meta", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const store = new ConversationStore({ dataDir });

        store.upsertCarryoverContext("conv-carryover", {
            sourceType: "file_read",
            sourceKey: "docs/project-map.md",
            title: "file_read: docs/project-map.md",
            summary: "读取了 project map，并确认 WebChat token 面板与 conversation.meta 链路。",
            keyFacts: [
                "面板值来自 conversation.meta",
                "RET 只统计 retained 主历史",
            ],
            tokenEstimate: 64,
            lastUsedAt: 1234567890,
            priority: 7,
        });

        const reloaded = new ConversationStore({ dataDir });
        expect(reloaded.getCarryoverContext("conv-carryover")).toEqual([{
            sourceType: "file_read",
            sourceKey: "docs/project-map.md",
            title: "file_read: docs/project-map.md",
            summary: "读取了 project map，并确认 WebChat token 面板与 conversation.meta 链路。",
            keyFacts: [
                "面板值来自 conversation.meta",
                "RET 只统计 retained 主历史",
            ],
            tokenEstimate: 64,
            lastUsedAt: 1234567890,
            priority: 7,
        }]);

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should merge carryover context by stable source key and prioritize the latest summary", () => {
        const store = new ConversationStore();
        const id = "conv-carryover-merge";

        store.upsertCarryoverContext(id, {
            sourceType: "file_read",
            sourceKey: "file_read:docs/project-map.md",
            title: "file_read: docs/project-map.md",
            summary: "第一次读取 project-map，确认了 WebChat 面板入口。",
            keyFacts: ["入口在 app.js", "前端刷新来自 conversation.meta"],
            tokenEstimate: 48,
            lastUsedAt: 100,
            priority: 6,
        });
        store.upsertCarryoverContext(id, {
            sourceType: "file_read",
            sourceKey: "file_read:docs/project-map.md",
            title: "file_read: docs/project-map.md",
            summary: "第二次读取 project-map，确认 NXT 不是单纯的 retained history。",
            keyFacts: ["NXT 包含 carryover", "RET 不含工具大输出"],
            tokenEstimate: 52,
            lastUsedAt: 200,
            priority: 8,
        });

        expect(store.getCarryoverContext(id)).toEqual([expect.objectContaining({
            sourceKey: "file_read:docs/project-map.md",
            summary: "第二次读取 project-map，确认 NXT 不是单纯的 retained history。",
            priority: 8,
            lastUsedAt: 200,
            keyFacts: [
                "NXT 包含 carryover",
                "RET 不含工具大输出",
            ],
        })]);
    });

    it("should replace stale carryover facts when the same source publishes a newer fact set", () => {
        const store = new ConversationStore();
        const id = "conv-carryover-stale-facts";

        store.upsertCarryoverContext(id, {
            sourceType: "file_read",
            sourceKey: "file_read:src/app.ts",
            title: "file_read: src/app.ts",
            summary: "第一次读取，确认 answer=42。",
            keyFacts: ["target: src/app.ts", "result: export const answer = 42;"],
            lastUsedAt: 100,
            priority: 6,
        });
        store.upsertCarryoverContext(id, {
            sourceType: "file_read",
            sourceKey: "file_read:src/app.ts",
            title: "file_read: src/app.ts",
            summary: "第二次读取，确认 answer=43。",
            keyFacts: ["target: src/app.ts", "result: export const answer = 43;"],
            lastUsedAt: 200,
            priority: 8,
        });

        expect(store.getCarryoverContext(id)).toEqual([expect.objectContaining({
            sourceKey: "file_read:src/app.ts",
            summary: "第二次读取，确认 answer=43。",
            keyFacts: [
                "target: src/app.ts",
                "result: export const answer = 43;",
            ],
        })]);
    });

    it("should rank carryover context by query relevance before plain priority", () => {
        const store = new ConversationStore();
        const id = "conv-carryover-query-rank";

        store.setCarryoverContext(id, [
            {
                sourceType: "log_read",
                sourceKey: "log_search:spawn EPERM @ 2026-06-26..2026-06-26",
                title: "log_search: spawn EPERM @ 2026-06-26..2026-06-26",
                summary: "日志里确认 pnpm test 因 spawn EPERM 失败。",
                keyFacts: ["error: spawn EPERM", "target: pnpm test"],
                lastUsedAt: 100,
                priority: 5,
            },
            {
                sourceType: "file_read",
                sourceKey: "file_read:src/app.ts",
                title: "file_read: src/app.ts",
                summary: "已确认 answer=43。",
                keyFacts: ["target: src/app.ts", "result: export const answer = 43;"],
                lastUsedAt: 200,
                priority: 8,
            },
        ]);

        const ranked = store.getCarryoverContext(id, {
            query: "继续排查 pnpm test 的 spawn EPERM",
        });
        expect(ranked[0]).toMatchObject({
            sourceKey: "log_search:spawn EPERM @ 2026-06-26..2026-06-26",
        });
    });

    it("should retain persisted digest threshold during automatic refresh", async () => {
        const store = new ConversationStore({
            compaction: {
                enabled: true,
                tokenThreshold: 10,
                keepRecentCount: 1,
            },
            summarizer: async () => "rolling-summary-v1",
        });
        const id = "conv-session-digest-auto-threshold";

        store.addMessage(id, "user", "A".repeat(80));
        store.addMessage(id, "assistant", "B".repeat(80));
        store.addMessage(id, "user", "C".repeat(80));
        await store.refreshSessionDigest(id, { force: true, threshold: 2 });

        store.addMessage(id, "assistant", "D".repeat(80));
        store.addMessage(id, "user", "E".repeat(80));

        const refreshed = await store.refreshSessionDigest(id);
        expect(refreshed.updated).toBe(true);
        expect(refreshed.digest.threshold).toBe(2);
    });

    it("should refresh session digest even when manual compaction is below token threshold", async () => {
        const store = new ConversationStore({
            compaction: {
                enabled: true,
                tokenThreshold: 10_000,
                keepRecentCount: 1,
            },
            summarizer: async () => "rolling-summary-for-refresh",
        });
        const id = "conv-session-digest-force-refresh";

        store.addMessage(id, "user", "第一轮简短消息");
        store.addMessage(id, "assistant", "第一轮回复");
        store.addMessage(id, "user", "第二轮简短消息");

        const before = await store.getSessionDigest(id, { threshold: 2 });
        expect(before).toMatchObject({
            conversationId: id,
            status: "updated",
            rollingSummary: "",
            digestedMessageCount: 0,
            pendingMessageCount: 3,
        });

        const refreshed = await store.refreshSessionDigest(id, { force: true, threshold: 2 });
        expect(refreshed.updated).toBe(true);
        expect(refreshed.compacted).toBe(false);
        expect(refreshed.digest).toMatchObject({
            conversationId: id,
            status: "ready",
            rollingSummary: "rolling-summary-for-refresh",
            digestedMessageCount: 3,
            pendingMessageCount: 0,
            threshold: 2,
        });
    });

    it("should feed tool digests into session memory refresh", async () => {
        let capturedPrompt = "";
        const store = new ConversationStore({
            summarizer: async (prompt) => {
                capturedPrompt = prompt;
                return JSON.stringify({
                    summary: "已读取配置并完成校验",
                    keyResults: ["读取 app.config.ts", "确认 retry window 为 20 分钟"],
                    currentWork: "整理当前实现",
                    nextStep: "输出优化建议",
                });
            },
        });
        const id = "conv-session-memory-tool-digest";

        store.addMessage(id, "user", "帮我检查配置实现");
        store.addMessage(id, "assistant", "我先读取配置并总结关键结果。");
        store.recordToolDigest(id, {
            toolName: "file_read",
            success: true,
            target: "src/app.config.ts",
            keyResult: "retry window = 20 minutes",
            summary: "file_read succeeded | target=src/app.config.ts | result=retry window = 20 minutes",
        });

        const refreshed = await store.refreshSessionDigest(id, { force: true, threshold: 2 });
        const memory = await store.getSessionMemory(id);

        expect(capturedPrompt).toContain("New Tool Digests");
        expect(capturedPrompt).toContain("tool=file_read");
        expect(capturedPrompt).toContain("target=src/app.config.ts");
        expect(memory.keyResults).toContain("确认 retry window 为 20 分钟");
        expect(refreshed.digest.rollingSummary).toBe("已读取配置并完成校验");
    });

    it("should refresh session memory incrementally without re-feeding old messages and old tool digests", async () => {
        const prompts: string[] = [];
        const store = new ConversationStore({
            summarizer: async (prompt) => {
                prompts.push(prompt);
                return JSON.stringify({
                    summary: `summary-${prompts.length}`,
                    currentGoal: prompts.length === 1 ? "修复启动流程" : "补完配置兜底与测试",
                    keyResults: [`result-${prompts.length}`],
                    currentWork: `current-${prompts.length}`,
                    nextStep: `next-${prompts.length}`,
                });
            },
        });
        const id = "conv-session-memory-incremental";

        store.addMessage(id, "user", "先检查 packages/app/src/bootstrap.ts 的启动逻辑");
        store.addMessage(id, "assistant", "我先读 bootstrap.ts 和配置加载路径。");
        store.recordToolDigest(id, {
            toolName: "file_read",
            success: true,
            target: "packages/app/src/bootstrap.ts",
            keyResult: "发现 loadConfig() 没有默认值回退",
            summary: "file_read bootstrap",
        });
        await store.refreshSessionMemory(id, { force: true, threshold: 1 });

        store.addMessage(id, "user", "继续补 config 默认值，并保留 CLI 参数兼容");
        store.addMessage(id, "assistant", "已准备修改 loadConfig() 并补测试。");
        store.recordToolDigest(id, {
            toolName: "file_read",
            success: true,
            target: "packages/app/src/config.ts",
            keyResult: "确认默认值应落在 resolveConfigDefaults()",
            summary: "file_read config",
        });

        const refreshed = await store.refreshSessionMemory(id, { force: true, threshold: 1 });

        expect(refreshed.updated).toBe(true);
        expect(prompts).toHaveLength(2);
        expect(prompts[1]).toContain("## Existing Session Memory");
        expect(prompts[1]).toContain("summary-1");
        expect(prompts[1]).toContain("继续补 config 默认值，并保留 CLI 参数兼容");
        expect(prompts[1]).toContain("packages/app/src/config.ts");
        expect(prompts[1]).not.toContain("先检查 packages/app/src/bootstrap.ts 的启动逻辑");
        expect(prompts[1]).not.toContain("packages/app/src/bootstrap.ts");

        const memory = await store.getSessionMemory(id);
        expect(memory).toMatchObject({
            conversationId: id,
            summary: "summary-2",
            currentGoal: "补完配置兜底与测试",
            lastSummarizedMessageCount: 4,
            lastSummarizedToolCursor: 2,
        });
    });

    it("should allow session memory refresh to clear stale fields when the summarizer returns explicit empties", async () => {
        let refreshCount = 0;
        const store = new ConversationStore({
            summarizer: async () => {
                refreshCount += 1;
                if (refreshCount === 1) {
                    return JSON.stringify({
                        summary: "第一轮摘要",
                        currentGoal: "修复启动流程",
                        pendingTasks: ["补测试", "验证 CLI 参数"],
                        currentWork: "读取 bootstrap.ts",
                        nextStep: "修改默认值",
                    });
                }
                return JSON.stringify({
                    summary: "第二轮摘要",
                    currentGoal: "",
                    pendingTasks: [],
                    currentWork: "",
                    nextStep: "",
                });
            },
        });
        const id = "conv-session-memory-clear-stale-fields";

        store.addMessage(id, "user", "先修启动流程");
        store.addMessage(id, "assistant", "收到，我先读代码。");
        await store.refreshSessionMemory(id, { force: true, threshold: 1 });

        store.addMessage(id, "user", "这部分完成了，先不要保留旧 next step");
        store.addMessage(id, "assistant", "改为重新评估当前状态。");
        await store.refreshSessionMemory(id, { force: true, threshold: 1 });

        const memory = await store.getSessionMemory(id);
        expect(memory).toMatchObject({
            conversationId: id,
            summary: "第二轮摘要",
            currentGoal: "",
            pendingTasks: [],
            currentWork: "",
            nextStep: "",
        });
    });

    it("should accept object-shaped summarizer responses when refreshing session memory", async () => {
        const store = new ConversationStore({
            summarizer: async () => ({
                summary: JSON.stringify({
                    summary: "object-summary",
                    currentGoal: "验证对象返回",
                    nextStep: "继续观测",
                }),
            }),
        });
        const id = "conv-session-memory-object-response";

        store.addMessage(id, "user", "第一条长消息，用来刷新 session memory");
        store.addMessage(id, "assistant", "收到，我来整理。");

        const refreshed = await store.refreshSessionMemory(id, { force: true, threshold: 1 });
        const memory = await store.getSessionMemory(id);

        expect(refreshed.updated).toBe(true);
        expect(memory).toMatchObject({
            conversationId: id,
            summary: "object-summary",
            currentGoal: "验证对象返回",
            nextStep: "继续观测",
            lastSummarizedMessageCount: 2,
        });
    });

    it("should persist and query recent tool results independently from transcript messages", async () => {
        const store = new ConversationStore();
        const id = "conv-recent-tool-results";

        store.recordRecentToolResult(id, {
            toolCallId: "call-1",
            toolName: "file_read",
            success: true,
            summary: "file_read succeeded | target=src/app.ts | result=answer=42",
            content: "export const answer = 42;\n".repeat(40),
            target: "src/app.ts",
            args: { path: "src/app.ts" },
        });
        store.recordRecentToolResult(id, {
            toolCallId: "call-2",
            toolName: "run_command",
            success: false,
            summary: "run_command failed | target=pnpm test | error=spawn EPERM",
            error: "spawn EPERM while launching pnpm test",
            failureKind: "environment_error",
            target: "pnpm test",
            args: { command: "pnpm test" },
            isSynthetic: true,
        });

        expect(store.getRecentToolResults(id, { limit: 5 })).toMatchObject([
            expect.objectContaining({
                toolCallId: "call-2",
                toolName: "run_command",
                success: false,
                isSynthetic: true,
            }),
            expect.objectContaining({
                toolCallId: "call-1",
                toolName: "file_read",
                success: true,
                target: "src/app.ts",
            }),
        ]);
        expect(store.getRecentToolResults(id, { toolCallId: "call-1" })).toHaveLength(1);
        expect(store.getRecentToolResults(id, { toolName: "run_command", success: false, query: "eperm" })).toHaveLength(1);
    });

    it("should normalize oversized recent tool args without dropping key diagnostic fields", async () => {
        const store = new ConversationStore();
        const id = "conv-recent-tool-result-args-projection";

        store.recordRecentToolResult(id, {
            toolCallId: "call-args-1",
            toolName: "delegate_task",
            success: true,
            summary: "delegate_task succeeded",
            content: "ok",
            target: "verifier",
            args: {
                agent_id: "verifier",
                instruction: "Review this patch carefully. ".repeat(40),
                files: Array.from({ length: 9 }, (_, index) => `src/module-${index}.ts`),
                acceptance: {
                    done_definition: "State whether the patch is ready.",
                    verification_hints: ["Check findings", "Check missing tests", "Check regressions"],
                    nested: {
                        layer1: {
                            layer2: {
                                layer3: "too deep",
                            },
                        },
                    },
                },
                extra_0: "a",
                extra_1: "b",
                extra_2: "c",
                extra_3: "d",
                extra_4: "e",
                extra_5: "f",
                extra_6: "g",
                extra_7: "h",
                extra_8: "i",
                extra_9: "j",
                extra_10: "k",
                extra_11: "l",
                extra_12: "m",
            },
        });

        const recent = store.getRecentToolResults(id, { toolCallId: "call-args-1" });
        expect(recent).toHaveLength(1);
        expect(recent[0]?.args).toMatchObject({
            agent_id: "verifier",
        });
        expect(String((recent[0]?.args as any)?.instruction ?? "")).not.toBe("Review this patch carefully. ".repeat(40).trim());
        expect(String((recent[0]?.args as any)?.instruction ?? "")).toHaveLength(160);
        expect((recent[0]?.args as any)?.files).toEqual(expect.arrayContaining([
            "src/module-0.ts",
            "[+3 more items]",
        ]));
        expect((recent[0]?.args as any)?.acceptance?.nested?.layer1).toBe("[object keys=1]");
        expect((recent[0]?.args as any)?.__truncatedKeys).toBe(5);
    });

    it("should keep only preview-sized recent tool content while preserving truncation metadata", async () => {
        const store = new ConversationStore();
        const id = "conv-recent-tool-result-content-projection";
        const longContent = "export const answer = 42;\n".repeat(800);
        const longError = "spawn EPERM while launching pnpm test\n".repeat(80);

        store.recordRecentToolResult(id, {
            toolCallId: "call-content-1",
            toolName: "file_read",
            success: true,
            summary: "file_read succeeded",
            content: longContent,
            target: "src/app.ts",
            args: { path: "src/app.ts" },
        });
        store.recordRecentToolResult(id, {
            toolCallId: "call-content-2",
            toolName: "run_command",
            success: false,
            summary: "run_command failed",
            error: longError,
            failureKind: "environment_error",
            target: "pnpm test",
            args: { command: "pnpm test" },
        });

        const successRecord = store.getRecentToolResults(id, { toolCallId: "call-content-1" })[0];
        expect(successRecord?.contentChars).toBe(longContent.trim().length);
        expect(successRecord?.contentTruncated).toBe(true);
        expect(successRecord?.contentPreview).toBe(successRecord?.content);
        expect(String(successRecord?.content ?? "").length).toBeLessThanOrEqual(2400);

        const errorRecord = store.getRecentToolResults(id, { toolCallId: "call-content-2" })[0];
        expect(errorRecord?.errorChars).toBe(longError.trim().length);
        expect(errorRecord?.errorTruncated).toBe(true);
        expect(errorRecord?.errorPreview).toBe(errorRecord?.error);
        expect(String(errorRecord?.error ?? "").length).toBeLessThanOrEqual(800);
    });

    it("should emit enriched request compaction hook events", async () => {
        const beforeCompaction = vi.fn(async () => {});
        const afterCompaction = vi.fn(async () => {});
        const store = new ConversationStore({
            compaction: {
                enabled: true,
                tokenThreshold: 10,
                keepRecentCount: 1,
            },
            summarizer: async () => "rolling-summary-v1",
            summarizerModelName: "compact-model",
            onBeforeCompaction: beforeCompaction,
            onAfterCompaction: afterCompaction,
        });
        const id = "conv-compaction-hook-request";

        store.addMessage(id, "user", "A".repeat(80));
        store.addMessage(id, "assistant", "B".repeat(80));
        store.addMessage(id, "user", "C".repeat(80));

        const result = await store.getConversationHistoryCompacted(id);

        expect(result.compacted).toBe(true);
        expect(beforeCompaction).toHaveBeenCalledWith(
            expect.objectContaining({
                messageCount: 3,
                source: "request",
                compactionMode: "request",
                deltaMessageCount: 2,
                summarizerModel: "compact-model",
            }),
            expect.objectContaining({
                sessionKey: id,
            }),
        );
        expect(afterCompaction).toHaveBeenCalledWith(
            expect.objectContaining({
                source: "request",
                compactionMode: "request",
                deltaMessageCount: 2,
                fallbackUsed: false,
                summarizerModel: "compact-model",
                rebuildTriggered: false,
            }),
            expect.objectContaining({
                sessionKey: id,
            }),
        );
    });

    it("should emit session_memory compaction events with fallback observability", async () => {
        const beforeCompaction = vi.fn(async () => {});
        const afterCompaction = vi.fn(async () => {});
        const store = new ConversationStore({
            summarizerModelName: "session-memory-model",
            onBeforeCompaction: beforeCompaction,
            onAfterCompaction: afterCompaction,
        });
        const id = "conv-session-memory-hooks";

        store.addMessage(id, "user", "需要整理当前进展与结论");
        store.addMessage(id, "assistant", "已完成 P2-1，并准备推进 P2-2。");

        const result = await store.refreshSessionMemory(id, { force: true, threshold: 1 });

        expect(result.updated).toBe(true);
        expect(beforeCompaction).toHaveBeenCalledWith(
            expect.objectContaining({
                source: "session_memory",
                compactionMode: "session_memory",
                deltaMessageCount: 2,
                summarizerModel: "session-memory-model",
            }),
            expect.objectContaining({
                sessionKey: id,
            }),
        );
        expect(afterCompaction).toHaveBeenCalledWith(
            expect.objectContaining({
                source: "session_memory",
                compactionMode: "session_memory",
                compactedCount: 2,
                deltaMessageCount: 2,
                fallbackUsed: true,
                summarizerModel: "session-memory-model",
            }),
            expect.objectContaining({
                sessionKey: id,
            }),
        );
    });

    it("should persist compaction state before forceCompact resolves", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const store = new ConversationStore({
            dataDir,
            compaction: {
                enabled: true,
                tokenThreshold: 10,
                keepRecentCount: 1,
            },
            summarizer: async () => "rolling-summary-v1",
        });
        const id = "conv-compaction-persist";

        store.addMessage(id, "user", "A".repeat(80));
        store.addMessage(id, "assistant", "B".repeat(80));
        store.addMessage(id, "user", "C".repeat(80));

        const result = await store.forceCompact(id);

        expect(result.compacted).toBe(true);

        const reloaded = new ConversationStore({ dataDir });
        const restoredState = await (reloaded as any).getCompactionStateAsync(id);
        expect(restoredState.rollingSummary).toBe("rolling-summary-v1");
        expect(restoredState.compactedMessageCount).toBe(2);
        expect(restoredState.lastCompactedAt).toBeGreaterThan(0);

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should coerce object-shaped compaction summaries before token estimation", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const store = new ConversationStore({
            dataDir,
            compaction: {
                enabled: true,
                tokenThreshold: 10,
                keepRecentCount: 1,
            },
            summarizer: async () => ({
                summary: {
                    content: [
                        { text: "rolling-summary-v-object" },
                    ],
                } as unknown as string,
            }),
        });
        const id = "conv-compaction-object-summary";

        store.addMessage(id, "user", "A".repeat(80));
        store.addMessage(id, "assistant", "B".repeat(80));
        store.addMessage(id, "user", "C".repeat(80));

        const result = await store.forceCompact(id);

        expect(result.compacted).toBe(true);
        const reloaded = new ConversationStore({ dataDir });
        const restoredState = await (reloaded as any).getCompactionStateAsync(id);
        expect(restoredState.rollingSummary).toBe("rolling-summary-v-object");

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should persist a compact boundary with preserved segment message ids", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const store = new ConversationStore({
            dataDir,
            compaction: {
                enabled: true,
                tokenThreshold: 10,
                keepRecentCount: 1,
            },
            summarizer: async () => "rolling-summary-v1",
        });
        const id = "conv-compaction-boundary";

        store.addMessage(id, "user", "A".repeat(80));
        store.addMessage(id, "assistant", "B".repeat(80));
        store.addMessage(id, "user", "C".repeat(80));
        store.addMessage(id, "assistant", "D".repeat(80));
        const messageIds = store.get(id)?.messages.map((message) => message.id) ?? [];

        const result = await store.forceCompact(id);

        expect(result.compacted).toBe(true);
        expect(result.boundary).toMatchObject({
            trigger: "manual",
            summaryStateVersion: 1,
            compactedMessageCount: 3,
            preservedSegment: {
                anchorId: messageIds[2],
                headMessageId: messageIds[3],
                tailMessageId: messageIds[3],
                preservedMessageCount: 1,
            },
        });

        const reloaded = new ConversationStore({ dataDir });
        expect(reloaded.getLatestCompactBoundary(id)).toMatchObject({
            trigger: "manual",
            compactedMessageCount: 3,
            preservedSegment: {
                anchorId: messageIds[2],
                headMessageId: messageIds[3],
                tailMessageId: messageIds[3],
            },
        });
        const transcriptEvents = await reloaded.getSessionTranscriptEvents(id);
        expect(transcriptEvents.some((event) => event.type === "compact_boundary_recorded" && event.payload.boundary?.id === result.boundary?.id)).toBe(true);

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should persist partial up_to compaction and replay the preserved tail projection", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const store = new ConversationStore({
            dataDir,
            compaction: {
                enabled: true,
                tokenThreshold: 10,
                keepRecentCount: 1,
            },
            summarizer: async () => "partial-up-to-summary",
        });
        const id = "conv-partial-up-to";

        store.addMessage(id, "user", "A".repeat(80));
        store.addMessage(id, "assistant", "B".repeat(80));
        store.addMessage(id, "user", "C".repeat(80));
        store.addMessage(id, "assistant", "D".repeat(80));
        const messageIds = store.get(id)?.messages.map((message) => message.id) ?? [];

        const result = await store.forcePartialCompact(id, {
            direction: "up_to",
            pivotMessageId: messageIds[1],
        });

        expect(result.compacted).toBe(true);
        expect(result.direction).toBe("up_to");
        expect(result.boundary).toMatchObject({
            trigger: "partial_up_to",
            compactedMessageCount: 2,
            preservedSegment: {
                anchorId: messageIds[1],
                headMessageId: messageIds[2],
                tailMessageId: messageIds[3],
                preservedMessageCount: 2,
            },
        });
        expect(result.history).toHaveLength(4);
        expect(result.history[0]?.content).toContain("partial-up-to-summary");
        expect(result.history.slice(2)).toEqual([
            { role: "user", content: "C".repeat(80) },
            { role: "assistant", content: "D".repeat(80) },
        ]);

        const reloaded = new ConversationStore({
            dataDir,
            compaction: {
                enabled: true,
                tokenThreshold: 10,
                keepRecentCount: 1,
            },
        });
        const replayed = await reloaded.getConversationHistoryCompacted(id);

        expect(replayed.compacted).toBe(true);
        expect(replayed.boundary).toMatchObject({
            trigger: "partial_up_to",
            compactedMessageCount: 2,
        });
        expect(replayed.history).toHaveLength(4);
        expect(replayed.history[0]?.content).toContain("partial-up-to-summary");
        expect(replayed.history.slice(2)).toEqual([
            { role: "user", content: "C".repeat(80) },
            { role: "assistant", content: "D".repeat(80) },
        ]);
        expect(reloaded.getPartialCompactionView(id)).toBeUndefined();

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should persist partial from compaction view and keep new tail messages raw", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const store = new ConversationStore({
            dataDir,
            compaction: {
                enabled: true,
                tokenThreshold: 10,
                keepRecentCount: 1,
            },
            summarizer: async () => "partial-from-summary",
        });
        const id = "conv-partial-from";

        store.addMessage(id, "user", "A".repeat(80));
        store.addMessage(id, "assistant", "B".repeat(80));
        store.addMessage(id, "user", "C".repeat(80));
        store.addMessage(id, "assistant", "D".repeat(80));
        store.addMessage(id, "user", "E".repeat(80));
        const messageIds = store.get(id)?.messages.map((message) => message.id) ?? [];

        const result = await store.forcePartialCompact(id, {
            direction: "from",
            pivotMessageId: messageIds[1],
        });

        expect(result.compacted).toBe(true);
        expect(result.direction).toBe("from");
        expect(result.boundary).toMatchObject({
            trigger: "partial_from",
            compactedMessageCount: 3,
            preservedSegment: {
                anchorId: messageIds[1],
                headMessageId: messageIds[0],
                tailMessageId: messageIds[1],
                preservedMessageCount: 2,
            },
        });
        expect(store.getPartialCompactionView(id)).toMatchObject({
            direction: "from",
            pivotMessageId: messageIds[1],
            pivotMessageCount: 2,
            compactedMessageCount: 5,
        });
        expect(result.history).toHaveLength(4);
        expect(result.history[0]).toEqual({ role: "user", content: "A".repeat(80) });
        expect(result.history[1]).toEqual({ role: "assistant", content: "B".repeat(80) });
        expect(result.history[2]?.content).toContain("partial-from-summary");

        store.addMessage(id, "assistant", "F".repeat(80));
        const replayed = await store.getConversationHistoryCompacted(id);

        expect(replayed.compacted).toBe(true);
        expect(replayed.boundary).toMatchObject({
            trigger: "partial_from",
        });
        expect(replayed.history).toHaveLength(5);
        expect(replayed.history[0]).toEqual({ role: "user", content: "A".repeat(80) });
        expect(replayed.history[1]).toEqual({ role: "assistant", content: "B".repeat(80) });
        expect(replayed.history[2]?.content).toContain("partial-from-summary");
        expect(replayed.history[4]).toEqual({ role: "assistant", content: "F".repeat(80) });

        await waitFor(() => {
            const probe = new ConversationStore({
                dataDir,
                compaction: {
                    enabled: true,
                    tokenThreshold: 10,
                    keepRecentCount: 1,
                },
            });
            return probe.get(id)?.messages.length === 6
                && probe.getPartialCompactionView(id)?.pivotMessageId === messageIds[1];
        });

        const reloaded = new ConversationStore({
            dataDir,
            compaction: {
                enabled: true,
                tokenThreshold: 10,
                keepRecentCount: 1,
            },
        });
        const restored = await reloaded.getConversationHistoryCompacted(id);

        expect(restored.compacted).toBe(true);
        expect(restored.boundary).toMatchObject({
            trigger: "partial_from",
        });
        expect(restored.history).toHaveLength(5);
        expect(restored.history[2]?.content).toContain("partial-from-summary");
        expect(restored.history[4]).toEqual({ role: "assistant", content: "F".repeat(80) });
        expect(reloaded.getPartialCompactionView(id)).toMatchObject({
            direction: "from",
            pivotMessageId: messageIds[1],
            compactedMessageCount: 5,
        });
        const transcriptEvents = await reloaded.getSessionTranscriptEvents(id);
        expect(transcriptEvents.some((event) => event.type === "partial_compaction_view_recorded" && event.payload.boundaryId === restored.boundary?.id)).toBe(true);
        expect(transcriptEvents.some((event) => event.type === "compact_boundary_recorded" && event.payload.boundary?.id === restored.boundary?.id)).toBe(true);

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should relink full compaction view from transcript when meta file is missing", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const id = "conv-transcript-relink-full";
        const store = new ConversationStore({
            dataDir,
            compaction: {
                enabled: true,
                tokenThreshold: 10,
                keepRecentCount: 1,
            },
            summarizer: async () => "rolling-summary-v1",
        });

        store.addMessage(id, "user", "A".repeat(80));
        store.addMessage(id, "assistant", "B".repeat(80));
        store.addMessage(id, "user", "C".repeat(80));
        store.addMessage(id, "assistant", "D".repeat(80));
        const result = await store.forceCompact(id);

        expect(result.compacted).toBe(true);
        fs.rmSync(path.join(dataDir, `${id}.meta.json`), { force: true });

        const reloaded = new ConversationStore({
            dataDir,
            compaction: {
                enabled: false,
            },
        });
        const relinked = await reloaded.getConversationHistoryCompacted(id);

        expect(relinked.compacted).toBe(true);
        expect(relinked.boundary).toMatchObject({
            id: result.boundary?.id,
            trigger: "manual",
        });
        expect(relinked.history[0]?.content).toContain("rolling-summary-v1");
        expect(relinked.history[relinked.history.length - 1]).toEqual({ role: "assistant", content: "D".repeat(80) });

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should relink partial up_to view from transcript when meta file is missing", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const id = "conv-transcript-relink-up-to";
        const store = new ConversationStore({
            dataDir,
            compaction: {
                enabled: true,
                tokenThreshold: 10,
                keepRecentCount: 1,
            },
            summarizer: async () => "partial-up-to-summary",
        });

        store.addMessage(id, "user", "A".repeat(80));
        store.addMessage(id, "assistant", "B".repeat(80));
        store.addMessage(id, "user", "C".repeat(80));
        store.addMessage(id, "assistant", "D".repeat(80));
        const messageIds = store.get(id)?.messages.map((message) => message.id) ?? [];
        const result = await store.forcePartialCompact(id, {
            direction: "up_to",
            pivotMessageId: messageIds[1],
        });

        expect(result.compacted).toBe(true);
        fs.rmSync(path.join(dataDir, `${id}.meta.json`), { force: true });

        const reloaded = new ConversationStore({
            dataDir,
            compaction: {
                enabled: false,
            },
        });
        const relinked = await reloaded.getConversationHistoryCompacted(id);

        expect(relinked.compacted).toBe(true);
        expect(relinked.boundary).toMatchObject({
            id: result.boundary?.id,
            trigger: "partial_up_to",
        });
        expect(relinked.history[0]?.content).toContain("partial-up-to-summary");
        expect(relinked.history.slice(-2)).toEqual([
            { role: "user", content: "C".repeat(80) },
            { role: "assistant", content: "D".repeat(80) },
        ]);

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should relink partial from view from transcript when meta file is missing", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const id = "conv-transcript-relink-from";
        const store = new ConversationStore({
            dataDir,
            compaction: {
                enabled: true,
                tokenThreshold: 10,
                keepRecentCount: 1,
            },
            summarizer: async () => "partial-from-summary",
        });

        store.addMessage(id, "user", "A".repeat(80));
        store.addMessage(id, "assistant", "B".repeat(80));
        store.addMessage(id, "user", "C".repeat(80));
        store.addMessage(id, "assistant", "D".repeat(80));
        store.addMessage(id, "user", "E".repeat(80));
        const messageIds = store.get(id)?.messages.map((message) => message.id) ?? [];
        const result = await store.forcePartialCompact(id, {
            direction: "from",
            pivotMessageId: messageIds[1],
        });

        expect(result.compacted).toBe(true);
        store.addMessage(id, "assistant", "F".repeat(80));
        await store.waitForPendingPersistence(id);
        fs.rmSync(path.join(dataDir, `${id}.meta.json`), { force: true });

        const reloaded = new ConversationStore({
            dataDir,
            compaction: {
                enabled: false,
            },
        });
        const relinked = await reloaded.getConversationHistoryCompacted(id);

        expect(relinked.compacted).toBe(true);
        expect(relinked.boundary).toMatchObject({
            id: result.boundary?.id,
            trigger: "partial_from",
        });
        expect(relinked.history[0]).toEqual({ role: "user", content: "A".repeat(80) });
        expect(relinked.history[1]).toEqual({ role: "assistant", content: "B".repeat(80) });
        expect(relinked.history[2]?.content).toContain("partial-from-summary");
        expect(relinked.history[relinked.history.length - 1]).toEqual({ role: "assistant", content: "F".repeat(80) });

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should safely fall back to raw history when preserved segment cannot be relinked", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const id = "conv-transcript-relink-fallback";
        const store = new ConversationStore({
            dataDir,
            compaction: {
                enabled: true,
                tokenThreshold: 10,
                keepRecentCount: 1,
            },
            summarizer: async () => "rolling-summary-v1",
        });

        store.addMessage(id, "user", "A".repeat(80));
        store.addMessage(id, "assistant", "B".repeat(80));
        store.addMessage(id, "user", "C".repeat(80));
        store.addMessage(id, "assistant", "D".repeat(80));
        const result = await store.forceCompact(id);

        expect(result.compacted).toBe(true);
        const jsonlPath = path.join(dataDir, `${id}.jsonl`);
        const lines = fs.readFileSync(jsonlPath, "utf-8").trim().split("\n");
        fs.writeFileSync(jsonlPath, `${lines.slice(0, -1).join("\n")}\n`, "utf-8");
        fs.rmSync(path.join(dataDir, `${id}.meta.json`), { force: true });

        const reloaded = new ConversationStore({
            dataDir,
            compaction: {
                enabled: false,
            },
        });
        const fallback = await reloaded.getConversationHistoryCompacted(id);

        expect(fallback.compacted).toBe(false);
        expect(fallback.boundary).toMatchObject({
            id: result.boundary?.id,
            trigger: "manual",
        });
        expect(fallback.history).toEqual([
            { role: "user", content: "A".repeat(80) },
            { role: "assistant", content: "B".repeat(80) },
            { role: "user", content: "C".repeat(80) },
        ]);

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should build transcript-based restore view with raw, compacted, and canonical variants", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const id = "conv-session-restore";
        const store = new ConversationStore({
            dataDir,
            compaction: {
                enabled: true,
                tokenThreshold: 10,
                keepRecentCount: 1,
            },
            summarizer: async () => "rolling-summary-v1",
        });

        store.addMessage(id, "user", "A".repeat(80));
        store.addMessage(id, "assistant", "B".repeat(80));
        store.addMessage(id, "user", "C".repeat(80));
        store.addMessage(id, "assistant", "D".repeat(80));
        await store.forceCompact(id);
        fs.rmSync(path.join(dataDir, `${id}.meta.json`), { force: true });

        const restore = await new ConversationStore({
            dataDir,
            compaction: {
                enabled: false,
            },
        }).buildConversationRestoreView(id);

        expect(restore.rawMessages).toHaveLength(4);
        expect(restore.rawMessages[0]).toMatchObject({
            role: "user",
            content: "A".repeat(80),
        });
        expect(restore.compactedView[0]?.content).toContain("rolling-summary-v1");
        expect(restore.canonicalExtractionView).toEqual([
            { role: "user", content: "A".repeat(80) },
            { role: "assistant", content: "B".repeat(80) },
            { role: "user", content: "C".repeat(80) },
            { role: "assistant", content: "D".repeat(80) },
        ]);
        expect(restore.diagnostics).toMatchObject({
            source: "transcript",
            transcriptUsed: true,
            relinkAttempted: true,
            relinkApplied: true,
            fallbackToRaw: false,
            boundarySource: "transcript",
        });

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should build restore view from transcript even when assistant reply does not exist yet", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const id = "conv-session-restore-user-only";
        const store = new ConversationStore({ dataDir });

        store.addMessage(id, "user", "先记住这件事。", {
            agentId: "belldandy",
            channel: "webchat",
        });
        await store.waitForPendingPersistence(id);

        const restore = await store.buildConversationRestoreView(id);

        expect(restore.rawMessages).toHaveLength(1);
        expect(restore.compactedView).toEqual([{ role: "user", content: "先记住这件事。" }]);
        expect(restore.canonicalExtractionView).toEqual([{ role: "user", content: "先记住这件事。" }]);
        expect(restore.diagnostics).toMatchObject({
            source: "transcript",
            transcriptUsed: true,
            relinkAttempted: false,
            fallbackReason: "no_boundary",
        });

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should build transcript export bundle in internal mode with full transcript details", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const id = "conv-transcript-export-internal";
        const store = new ConversationStore({ dataDir });

        store.addMessage(id, "user", "请记住我们已经确认第二期先做 transcript export。", {
            agentId: "belldandy",
            channel: "webchat",
            clientContext: {
                sentAtMs: 1712000000000,
                timezoneOffsetMinutes: -480,
                locale: "zh-CN",
            },
        });
        store.addMessage(id, "assistant", "已确认，第一步先把 transcript export 的后端闭环做完。", {
            agentId: "belldandy",
        });
        await store.waitForPendingPersistence(id);

        const exported = await store.buildConversationTranscriptExport(id);

        expect(exported.manifest).toMatchObject({
            conversationId: id,
            source: "conversation.transcript.export",
            redactionMode: "internal",
        });
        expect(exported.events).toHaveLength(2);
        expect(exported.events[0]).toMatchObject({
            type: "user_message_accepted",
            payload: {
                message: {
                    role: "user",
                    content: "请记住我们已经确认第二期先做 transcript export。",
                    clientContext: {
                        sentAtMs: 1712000000000,
                        timezoneOffsetMinutes: -480,
                        locale: "zh-CN",
                    },
                },
                conversation: {
                    agentId: "belldandy",
                    channel: "webchat",
                },
            },
        });
        expect(exported.restore.rawMessages).toEqual([
            {
                id: expect.any(String),
                role: "user",
                content: "请记住我们已经确认第二期先做 transcript export。",
                contentLength: "请记住我们已经确认第二期先做 transcript export。".length,
                timestamp: expect.any(Number),
                agentId: "belldandy",
                clientContext: {
                    sentAtMs: 1712000000000,
                    timezoneOffsetMinutes: -480,
                    locale: "zh-CN",
                },
            },
            {
                id: expect.any(String),
                role: "assistant",
                content: "已确认，第一步先把 transcript export 的后端闭环做完。",
                contentLength: "已确认，第一步先把 transcript export 的后端闭环做完。".length,
                timestamp: expect.any(Number),
                agentId: "belldandy",
            },
        ]);
        expect(exported.summary).toMatchObject({
            eventCount: 2,
            messageEventCount: 2,
            compactBoundaryCount: 0,
            partialCompactionViewCount: 0,
            restore: {
                source: "transcript",
                relinkApplied: false,
                fallbackToRaw: false,
            },
        });

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should build readable timeline projection from transcript-based restore after full compaction", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const id = "conv-session-timeline-full";
        const store = new ConversationStore({
            dataDir,
            compaction: {
                enabled: true,
                tokenThreshold: 10,
                keepRecentCount: 1,
            },
            summarizer: async () => "timeline-summary-full",
        });

        store.addMessage(id, "user", "A".repeat(80));
        store.addMessage(id, "assistant", "B".repeat(80));
        store.addMessage(id, "user", "C".repeat(80));
        store.addMessage(id, "assistant", "D".repeat(80));
        await store.forceCompact(id);
        fs.rmSync(path.join(dataDir, `${id}.meta.json`), { force: true });

        const timeline = await new ConversationStore({
            dataDir,
            compaction: {
                enabled: false,
            },
        }).buildConversationTimeline(id, { previewChars: 40 });

        expect(timeline.manifest).toMatchObject({
            conversationId: id,
            source: "conversation.timeline.get",
        });
        expect(timeline.summary).toMatchObject({
            eventCount: 5,
            itemCount: 6,
            messageCount: 4,
            compactBoundaryCount: 1,
            partialCompactionCount: 0,
            restore: {
                source: "transcript",
                relinkApplied: true,
                fallbackToRaw: false,
            },
        });
        expect(timeline.warnings).toEqual([]);
        expect(timeline.items[0]).toMatchObject({
            kind: "message",
            eventType: "user_message_accepted",
            contentLength: 80,
            truncated: true,
        });
        expect(timeline.items.some((item) => item.kind === "compact_boundary" && item.trigger === "manual")).toBe(true);
        expect(timeline.items[timeline.items.length - 1]).toMatchObject({
            kind: "restore_result",
            source: "transcript",
            relinkApplied: true,
            fallbackToRaw: false,
            canonicalExtractionCount: 4,
        });

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should expose no_boundary warning in timeline when transcript has no compaction boundary", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const id = "conv-session-timeline-user-only";
        const store = new ConversationStore({ dataDir });

        store.addMessage(id, "user", "先记住这件事。");
        await store.waitForPendingPersistence(id);

        const timeline = await store.buildConversationTimeline(id);

        expect(timeline.summary).toMatchObject({
            eventCount: 1,
            itemCount: 2,
            messageCount: 1,
            compactBoundaryCount: 0,
            partialCompactionCount: 0,
            restore: {
                source: "transcript",
                relinkApplied: false,
                fallbackToRaw: false,
                fallbackReason: "no_boundary",
            },
        });
        expect(timeline.warnings).toEqual(["no_compact_boundary"]);
        expect(timeline.items[timeline.items.length - 1]).toMatchObject({
            kind: "restore_result",
            fallbackReason: "no_boundary",
        });

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should redact transcript export bundle for shareable and metadata_only modes", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const id = "conv-transcript-export-redacted";
        const store = new ConversationStore({ dataDir });

        store.addMessage(id, "user", "这是一个很长的用户说明，需要确认 shareable 只保留 preview 而不是完整正文。", {
            agentId: "belldandy",
            channel: "webchat",
            clientContext: {
                sentAtMs: 1712000000001,
                locale: "zh-CN",
            },
        });
        store.addMessage(id, "assistant", "收到，我会在导出时去掉 clientContext 和 conversation helper metadata。", {
            agentId: "belldandy",
        });
        await store.waitForPendingPersistence(id);

        const shareable = await store.buildConversationTranscriptExport(id, { mode: "shareable" });
        const metadataOnly = await store.buildConversationTranscriptExport(id, { mode: "metadata_only" });

        expect(shareable.manifest.redactionMode).toBe("shareable");
        expect(shareable.redaction.contentRedacted).toBe(true);
        expect(shareable.events[0]).toMatchObject({
            type: "user_message_accepted",
            payload: {
                message: {
                    role: "user",
                    contentPreview: expect.stringContaining("这是一个很长的用户说明"),
                    contentLength: "这是一个很长的用户说明，需要确认 shareable 只保留 preview 而不是完整正文。".length,
                },
            },
        });
        expect((shareable.events[0] as { payload: { message: Record<string, unknown>; conversation?: unknown } }).payload.message.content).toBeUndefined();
        expect((shareable.events[0] as { payload: { message: Record<string, unknown> } }).payload.message.clientContext).toBeUndefined();
        expect((shareable.events[0] as { payload: { conversation?: unknown } }).payload.conversation).toBeUndefined();
        expect(shareable.restore.rawMessages[0]).toMatchObject({
            role: "user",
            contentPreview: expect.stringContaining("这是一个很长的用户说明"),
        });
        expect((shareable.restore.rawMessages[0] as Record<string, unknown>).content).toBeUndefined();

        expect(metadataOnly.manifest.redactionMode).toBe("metadata_only");
        expect(metadataOnly.redaction.contentRedacted).toBe(true);
        expect(metadataOnly.events[0]).toMatchObject({
            type: "user_message_accepted",
            payload: {
                message: {
                    role: "user",
                    contentLength: "这是一个很长的用户说明，需要确认 shareable 只保留 preview 而不是完整正文。".length,
                    contentRedacted: true,
                },
            },
        });
        expect((metadataOnly.events[0] as { payload: { message: Record<string, unknown> } }).payload.message.content).toBeUndefined();
        expect((metadataOnly.events[0] as { payload: { message: Record<string, unknown> } }).payload.message.contentPreview).toBeUndefined();
        expect(metadataOnly.restore.rawMessages[0]).toMatchObject({
            role: "user",
            contentLength: "这是一个很长的用户说明，需要确认 shareable 只保留 preview 而不是完整正文。".length,
            contentRedacted: true,
        });
        expect((metadataOnly.restore.rawMessages[0] as Record<string, unknown>).content).toBeUndefined();
        expect((metadataOnly.restore.rawMessages[0] as Record<string, unknown>).contentPreview).toBeUndefined();

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should fall back to conversation messages when no transcript exists", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const id = "conv-session-restore-legacy";
        const store = new ConversationStore({
            dataDir,
            compaction: {
                enabled: false,
            },
        });
        store.addMessage(id, "user", "legacy user");
        store.addMessage(id, "assistant", "legacy assistant");
        await store.waitForPendingPersistence(id);
        fs.rmSync(path.join(dataDir, `${id}.transcript.jsonl`), { force: true });

        const restore = await new ConversationStore({
            dataDir,
            compaction: {
                enabled: false,
            },
        }).buildConversationRestoreView(id);

        expect(restore.rawMessages).toHaveLength(2);
        expect(restore.compactedView).toEqual([
            { role: "user", content: "legacy user" },
            { role: "assistant", content: "legacy assistant" },
        ]);
        expect(restore.canonicalExtractionView).toEqual([
            { role: "user", content: "legacy user" },
            { role: "assistant", content: "legacy assistant" },
        ]);
        expect(restore.diagnostics).toMatchObject({
            source: "conversation_fallback",
            transcriptUsed: false,
        });

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should avoid sync file reads when cold-loading compaction state", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const id = "conv-compaction-async";

        const store = new ConversationStore({
            dataDir,
            compaction: {
                enabled: true,
                tokenThreshold: 10,
                keepRecentCount: 1,
            },
            summarizer: async () => "rolling-summary-v1",
        });

        store.addMessage(id, "user", "A".repeat(80));
        store.addMessage(id, "assistant", "B".repeat(80));
        store.addMessage(id, "user", "C".repeat(80));
        await store.forceCompact(id);

        const reloaded = new ConversationStore({
            dataDir,
            compaction: {
                enabled: true,
                tokenThreshold: 10,
                keepRecentCount: 1,
            },
            summarizer: async () => "rolling-summary-v2",
        });
        const readFileSyncSpy = vi.spyOn(fs, "readFileSync");
        const asyncReadSpy = vi.spyOn(conversationAsyncFs, "readFile");

        const result = await reloaded.forceCompact(id);

        expect(result.compacted).toBe(false);
        expect(asyncReadSpy.mock.calls.some(([filePath]) => String(filePath).endsWith(`${id}.compaction.json`))).toBe(true);
        expect(readFileSyncSpy).not.toHaveBeenCalled();

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should avoid sync file reads when cold-loading session digest state", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const id = "conv-session-digest-async";

        const store = new ConversationStore({
            dataDir,
            compaction: {
                enabled: true,
                tokenThreshold: 10,
                keepRecentCount: 1,
            },
            summarizer: async () => "rolling-summary-v1",
        });

        store.addMessage(id, "user", "A".repeat(80));
        store.addMessage(id, "assistant", "B".repeat(80));
        store.addMessage(id, "user", "C".repeat(80));
        await store.refreshSessionDigest(id, { force: true, threshold: 3 });

        const reloaded = new ConversationStore({
            dataDir,
            compaction: {
                enabled: true,
                tokenThreshold: 10,
                keepRecentCount: 1,
            },
        });
        const readFileSyncSpy = vi.spyOn(fs, "readFileSync");
        const asyncReadSpy = vi.spyOn(conversationAsyncFs, "readFile");

        const digest = await reloaded.getSessionDigest(id);

        expect(digest.threshold).toBe(3);
        expect(asyncReadSpy.mock.calls.some(([filePath]) => String(filePath).endsWith(`${id}.digest.json`))).toBe(true);
        expect(asyncReadSpy.mock.calls.some(([filePath]) => String(filePath).endsWith(`${id}.session-memory.json`))).toBe(true);
        expect(asyncReadSpy.mock.calls.some(([filePath]) => String(filePath).endsWith(`${id}.compaction.json`))).toBe(true);
        expect(readFileSyncSpy).not.toHaveBeenCalled();

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should skip automatic request compaction after circuit breaker opens", async () => {
        const tracker = new CompactionRuntimeTracker({
            maxConsecutiveCompactionFailures: 1,
        });
        const summarizer = vi.fn(async () => {
            throw new Error("summarizer unavailable");
        });
        const store = new ConversationStore({
            compaction: {
                enabled: true,
                tokenThreshold: 10,
                keepRecentCount: 1,
            },
            summarizer,
            compactionRuntimeTracker: tracker,
        });
        const id = "conv-compaction-circuit-request";

        store.addMessage(id, "user", "A".repeat(80));
        store.addMessage(id, "assistant", "B".repeat(80));
        store.addMessage(id, "user", "C".repeat(80));

        const first = await store.getConversationHistoryCompacted(id);
        expect(first.compacted).toBe(true);
        expect(summarizer).toHaveBeenCalledTimes(1);

        store.addMessage(id, "assistant", "D".repeat(80));
        const second = await store.getConversationHistoryCompacted(id);
        expect(second.compacted).toBe(false);
        expect(second.history).toHaveLength(4);
        expect(summarizer).toHaveBeenCalledTimes(1);
        expect(tracker.getReport()).toMatchObject({
            totals: {
                failures: 1,
                skippedByCircuitBreaker: 1,
            },
            circuitBreaker: {
                open: false,
                remainingSkips: 0,
            },
        });
    });

    it("should allow manual forceCompact to bypass an open circuit breaker", async () => {
        const tracker = new CompactionRuntimeTracker({
            maxConsecutiveCompactionFailures: 1,
        });
        let callCount = 0;
        const summarizer = vi.fn(async () => {
            callCount += 1;
            if (callCount === 1) {
                throw new Error("temporary compaction failure");
            }
            return "manual-summary";
        });
        const store = new ConversationStore({
            compaction: {
                enabled: true,
                tokenThreshold: 10,
                keepRecentCount: 1,
            },
            summarizer,
            compactionRuntimeTracker: tracker,
        });
        const id = "conv-compaction-circuit-manual";

        store.addMessage(id, "user", "A".repeat(80));
        store.addMessage(id, "assistant", "B".repeat(80));
        store.addMessage(id, "user", "C".repeat(80));
        await store.getConversationHistoryCompacted(id);

        store.addMessage(id, "assistant", "D".repeat(80));
        const result = await store.forceCompact(id);
        expect(result.compacted).toBe(true);
        expect(summarizer).toHaveBeenCalledTimes(2);
        expect(tracker.getReport()).toMatchObject({
            circuitBreaker: {
                open: false,
                consecutiveFailures: 0,
                remainingSkips: 0,
            },
        });
    });

    it("should list persisted conversations with transcript availability", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-"));
        const dataDir = path.join(tempDir, "sessions");
        const store = new ConversationStore({
            dataDir,
        });
        const conversationA = "conv-list-alpha";
        const conversationB = "conv-list-beta";

        store.addMessage(conversationA, "user", "hello alpha");
        store.addMessage(conversationA, "assistant", "hello alpha back");
        store.addMessage(conversationB, "user", "hello beta");
        await store.waitForPendingPersistence(conversationA);
        await store.waitForPendingPersistence(conversationB);

        const summaries = await store.listPersistedConversations({
            conversationIdPrefix: "conv-list-",
        });

        expect(summaries.map((summary) => summary.conversationId).sort()).toEqual([
            conversationA,
            conversationB,
        ]);
        expect(summaries).toEqual(expect.arrayContaining([
            expect.objectContaining({
                conversationId: conversationA,
                messageCount: 2,
                hasTranscript: true,
                hasMessages: true,
            }),
            expect.objectContaining({
                conversationId: conversationB,
                messageCount: 1,
                hasTranscript: true,
                hasMessages: true,
            }),
        ]));

        fs.rmSync(tempDir, { recursive: true, force: true });
    });
});

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("timeout");
}
