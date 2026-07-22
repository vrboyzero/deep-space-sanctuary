import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./model-request-transport.js", () => ({
    requestModelTransport: (options: { url: string | URL; init: RequestInit }) => (
        fetch(options.url, options.init)
    ),
}));

import { ConversationStore } from "./conversation.js";
import { conversationMetaAsyncFs } from "./conversation-tool-artifact-persistence.js";
import { ToolEnabledAgent } from "./tool-agent.js";

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function createJsonResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
    });
}

function createToolExecutor(): any {
    return {
        getDefinitions: () => [{
            type: "function" as const,
            function: {
                name: "echo",
                description: "echo",
                parameters: { type: "object", properties: {} },
            },
        }],
        getRegisteredToolContract: () => undefined,
        consumeLoadedDeferredToolsForNextTurn: vi.fn(async () => []),
        setTokenCounter: vi.fn(),
        clearTokenCounter: vi.fn(),
        releaseConversation: vi.fn(),
        execute: vi.fn(async () => ({
            id: "call-persistence-1",
            name: "echo",
            success: true,
            output: "tool-output",
            durationMs: 0,
        })),
    };
}

async function collectItems(stream: AsyncIterable<unknown>): Promise<unknown[]> {
    const items: unknown[] = [];
    for await (const item of stream) {
        items.push(item);
    }
    return items;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("ToolEnabledAgent persistence terminal gate", () => {
    it.each([
        { label: "successful final", finalResponse: createJsonResponse({
            choices: [{ message: { content: "done" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
        }) },
        { label: "provider failure", finalResponse: createJsonResponse({ error: { message: "provider unavailable" } }, 503) },
    ])("waits for pending tool artifact meta before the $label terminal return", async ({ label, finalResponse }) => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-tool-agent-persistence-"));
        const dataDir = path.join(tempDir, "sessions");
        const conversationId = `conv-${label.replace(/\s+/g, "-")}`;
        const pendingWrite = createDeferred();
        const writeFile = conversationMetaAsyncFs.writeFile.bind(conversationMetaAsyncFs);
        vi.spyOn(conversationMetaAsyncFs, "writeFile").mockImplementation(async (filePath, data, encoding) => {
            await pendingWrite.promise;
            await writeFile(filePath, data, encoding);
        });
        vi.spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(createJsonResponse({
                choices: [{
                    message: {
                        content: "",
                        tool_calls: [{
                            id: "call-persistence-1",
                            type: "function",
                            function: { name: "echo", arguments: "{}" },
                        }],
                    },
                }],
                usage: { prompt_tokens: 1, completion_tokens: 1 },
            }))
            .mockResolvedValueOnce(finalResponse);

        const store = new ConversationStore({ dataDir });
        const agent = new ToolEnabledAgent({
            baseUrl: "https://api.openai.com/v1",
            apiKey: "test-key",
            model: "gpt-test",
            toolExecutor: createToolExecutor(),
            conversationStore: store,
        });
        let settled = false;
        const run = collectItems(agent.run({ conversationId, text: "use echo" })).then((items) => {
            settled = true;
            return items;
        });

        try {
            await vi.waitFor(() => expect(conversationMetaAsyncFs.writeFile).toHaveBeenCalled());
            await Promise.resolve();
            expect(settled).toBe(false);

            pendingWrite.resolve();
            await run;
            const reloaded = new ConversationStore({ dataDir });
            expect(reloaded.getToolDigests(conversationId)).toMatchObject([
                expect.objectContaining({ toolCallId: "call-persistence-1", toolName: "echo" }),
            ]);
        } finally {
            pendingWrite.resolve();
            await store.waitForPendingPersistence(conversationId);
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("waits for pending tool artifact meta before a cancelled terminal return", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-tool-agent-cancel-persistence-"));
        const dataDir = path.join(tempDir, "sessions");
        const conversationId = "conv-cancelled";
        const pendingWrite = createDeferred();
        const controller = new AbortController();
        const writeFile = conversationMetaAsyncFs.writeFile.bind(conversationMetaAsyncFs);
        vi.spyOn(conversationMetaAsyncFs, "writeFile").mockImplementation(async (filePath, data, encoding) => {
            await pendingWrite.promise;
            await writeFile(filePath, data, encoding);
        });
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(createJsonResponse({
            choices: [{
                message: {
                    content: "",
                    tool_calls: [{
                        id: "call-persistence-1",
                        type: "function",
                        function: { name: "echo", arguments: "{}" },
                    }],
                },
            }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
        }));
        const toolExecutor = createToolExecutor();
        toolExecutor.execute = vi.fn(async () => {
            controller.abort("Stopped by user.");
            return {
                id: "call-persistence-1",
                name: "echo",
                success: true,
                output: "tool-output",
                durationMs: 0,
            };
        });

        const store = new ConversationStore({ dataDir });
        const agent = new ToolEnabledAgent({
            baseUrl: "https://api.openai.com/v1",
            apiKey: "test-key",
            model: "gpt-test",
            toolExecutor,
            conversationStore: store,
        });
        let settled = false;
        const run = collectItems(agent.run({
            conversationId,
            text: "use echo",
            abortSignal: controller.signal,
        })).then((items) => {
            settled = true;
            return items;
        });

        try {
            await vi.waitFor(() => expect(conversationMetaAsyncFs.writeFile).toHaveBeenCalled());
            await Promise.resolve();
            expect(settled).toBe(false);

            pendingWrite.resolve();
            const items = await run;
            expect(items).toContainEqual({ type: "status", status: "stopped" });
            const reloaded = new ConversationStore({ dataDir });
            expect(reloaded.getToolDigests(conversationId)).toMatchObject([
                expect.objectContaining({ toolCallId: "call-persistence-1", toolName: "echo" }),
            ]);
        } finally {
            pendingWrite.resolve();
            await store.waitForPendingPersistence(conversationId);
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
