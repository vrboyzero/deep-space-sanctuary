import { afterEach, describe, expect, it, vi } from "vitest";

import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { ConversationStore } from "@belldandy/agent";

import { QqChannel } from "./qq.js";
import { createFileCurrentConversationBindingStore } from "./current-conversation-binding-store.js";
import { normalizeReplyChunkingConfig } from "./reply-chunking-config.js";
import { buildChannelSessionDescriptor } from "./session-key.js";

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("QqChannel", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("keeps reply context isolated for concurrent messages", async () => {
        const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => ({
            ok: true,
            text: async () => "",
        }));
        vi.stubGlobal("fetch", fetchMock);

        const agent = {
            run: vi.fn(async function* (input: { text: string }) {
                if (input.text === "first") {
                    await sleep(20);
                }
                yield {
                    type: "final" as const,
                    text: `reply:${input.text}`,
                };
            }),
        };

        const channel = new QqChannel({
            appId: "app-id",
            appSecret: "app-secret",
            sandbox: true,
            agent: agent as any,
            conversationStore: new ConversationStore(),
        });

        (channel as any).accessToken = "qq-token";

        const firstMessage = {
            id: "msg-1",
            content: "first",
            channel_id: "channel-a",
            guild_id: "guild-a",
            author: {
                id: "user-a",
                username: "Alice",
            },
        };
        const secondMessage = {
            id: "msg-2",
            content: "second",
            channel_id: "channel-b",
            guild_id: "guild-b",
            author: {
                id: "user-b",
                username: "Bob",
            },
        };

        await Promise.all([
            (channel as any).handleMessage(firstMessage, "MESSAGE_CREATE"),
            (channel as any).handleMessage(secondMessage, "MESSAGE_CREATE"),
        ]);

        expect(agent.run).toHaveBeenCalledWith(expect.objectContaining({
            conversationId: "qq_channel-a",
            meta: expect.objectContaining({
                channel: "qq",
                sessionScope: "per-channel-peer",
                sessionKey: expect.stringContaining("channel=qq"),
                legacyConversationId: "qq_channel-a",
            }),
        }));
        expect(agent.run).toHaveBeenCalledWith(expect.objectContaining({
            conversationId: "qq_channel-b",
            meta: expect.objectContaining({
                channel: "qq",
                sessionScope: "per-channel-peer",
                sessionKey: expect.stringContaining("chat=channel-b"),
                legacyConversationId: "qq_channel-b",
            }),
        }));
        expect(fetchMock).toHaveBeenCalledTimes(2);

        const sent = fetchMock.mock.calls.map(([url, init]) => ({
            url: String(url),
            body: JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}")) as { content?: string; msg_id?: string },
        }));

        expect(sent).toEqual(expect.arrayContaining([
            expect.objectContaining({
                url: "https://sandbox.api.sgroup.qq.com/channels/channel-a/messages",
                body: expect.objectContaining({
                    content: "reply:first",
                    msg_id: "msg-1",
                }),
            }),
            expect.objectContaining({
                url: "https://sandbox.api.sgroup.qq.com/channels/channel-b/messages",
                body: expect.objectContaining({
                    content: "reply:second",
                    msg_id: "msg-2",
                }),
            }),
        ]));
    });

    it("uses the requested chat context for proactive messages", async () => {
        const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => ({
            ok: true,
            text: async () => "",
        }));
        vi.stubGlobal("fetch", fetchMock);

        const channel = new QqChannel({
            appId: "app-id",
            appSecret: "app-secret",
            sandbox: true,
            agent: { async *run() {} } as any,
            conversationStore: new ConversationStore(),
        });

        (channel as any).accessToken = "qq-token";

        await (channel as any).handleMessage({
            id: "msg-1",
            content: "first",
            channel_id: "channel-a",
            guild_id: "guild-a",
            author: {
                id: "user-a",
                username: "Alice",
            },
        }, "MESSAGE_CREATE");

        await (channel as any).handleMessage({
            id: "msg-2",
            content: "second",
            channel_id: "channel-b",
            guild_id: "guild-b",
            author: {
                id: "user-b",
                username: "Bob",
            },
        }, "MESSAGE_CREATE");

        fetchMock.mockClear();

        const sent = await channel.sendProactiveMessage("manual", "channel-a");

        expect(sent).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://sandbox.api.sgroup.qq.com/channels/channel-a/messages");
        expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body ?? "{}"))).toEqual(
            expect.objectContaining({
                content: "manual",
                msg_id: "msg-1",
            }),
        );
    });

    it("chunks long proactive markdown replies through the shared outbound chunker", async () => {
        const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => ({
            ok: true,
            text: async () => "",
        }));
        vi.stubGlobal("fetch", fetchMock);

        const channel = new QqChannel({
            appId: "app-id",
            appSecret: "app-secret",
            sandbox: true,
            agent: { async *run() {} } as any,
            conversationStore: new ConversationStore(),
            replyChunkingConfig: normalizeReplyChunkingConfig({
                channels: {
                    qq: {
                        textLimit: 120,
                        chunkMode: "length",
                    },
                },
            }),
        });

        (channel as any).accessToken = "qq-token";

        await (channel as any).handleMessage({
            id: "msg-1",
            content: "seed",
            channel_id: "channel-a",
            guild_id: "guild-a",
            author: {
                id: "user-a",
                username: "Alice",
            },
        }, "MESSAGE_CREATE");

        fetchMock.mockClear();

        const longCode = Array.from({ length: 180 }, (_, index) => `console.log("line-${index}-xxxxxxxx");`).join("\n");
        const sent = await channel.sendProactiveMessage(`Intro\n\n\`\`\`ts\n${longCode}\n\`\`\`\n\nTail`, "channel-a");

        expect(sent).toBe(true);
        expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
        for (const [, init] of fetchMock.mock.calls) {
            const body = JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}")) as { content?: string };
            expect((body.content ?? "").length).toBeLessThanOrEqual(120);
            expect((((body.content ?? "").match(/```/g) ?? []).length) % 2).toBe(0);
        }
    });

    it("falls back to persisted current conversation binding when proactive target is omitted", async () => {
        const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => ({
            ok: true,
            text: async () => "",
        }));
        vi.stubGlobal("fetch", fetchMock);

        const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qq-binding-"));
        const channel = new QqChannel({
            appId: "app-id",
            appSecret: "app-secret",
            sandbox: true,
            agent: { async *run() {} } as any,
            conversationStore: new ConversationStore(),
            currentConversationBindingStore: createFileCurrentConversationBindingStore(path.join(stateDir, "bindings.json")),
        });

        try {
            (channel as any).accessToken = "qq-token";

            await (channel as any).handleMessage({
                id: "msg-1",
                content: "seed",
                channel_id: "channel-a",
                guild_id: "guild-a",
                author: {
                    id: "user-a",
                    username: "Alice",
                },
            }, "MESSAGE_CREATE");

            fetchMock.mockClear();
            (channel as any).replyContextByChatId.clear();

            const sent = await channel.sendProactiveMessage("manual");

            expect(sent).toBe(true);
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://sandbox.api.sgroup.qq.com/channels/channel-a/messages");
        } finally {
            await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
        }
    });

    it("accepts canonical sessionKey as proactive target", async () => {
        const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => ({
            ok: true,
            text: async () => "",
        }));
        vi.stubGlobal("fetch", fetchMock);

        const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qq-binding-session-key-"));
        const channel = new QqChannel({
            appId: "app-id",
            appSecret: "app-secret",
            sandbox: true,
            agent: { async *run() {} } as any,
            conversationStore: new ConversationStore(),
            currentConversationBindingStore: createFileCurrentConversationBindingStore(path.join(stateDir, "bindings.json")),
        });

        try {
            (channel as any).accessToken = "qq-token";

            await (channel as any).handleMessage({
                id: "msg-1",
                content: "seed",
                channel_id: "channel-a",
                guild_id: "guild-a",
                author: {
                    id: "user-a",
                    username: "Alice",
                },
            }, "MESSAGE_CREATE");

            fetchMock.mockClear();
            (channel as any).replyContextByChatId.clear();

            const session = buildChannelSessionDescriptor({
                channel: "qq",
                chatKind: "channel",
                chatId: "channel-a",
                senderId: "user-a",
            });
            const sent = await channel.sendProactiveMessage("manual", { sessionKey: session.sessionKey });

            expect(sent).toBe(true);
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://sandbox.api.sgroup.qq.com/channels/channel-a/messages");
        } finally {
            await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
        }
    });

    it("does not backfill binding-only proactive target from in-memory reply context", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => ({
            ok: true,
            text: async () => "",
        }));
        vi.stubGlobal("fetch", fetchMock);

        const channel = new QqChannel({
            appId: "app-id",
            appSecret: "app-secret",
            sandbox: true,
            agent: { async *run() {} } as any,
            conversationStore: new ConversationStore(),
            currentConversationBindingStore: {
                async upsert() {},
                async get() {
                    return undefined;
                },
                async getLatestByChannel() {
                    return {
                        channel: "qq",
                        sessionKey: "channel=qq:scope=per-channel-peer:chat=channel-bind:peer=user-bind",
                        sessionScope: "per-channel-peer",
                        legacyConversationId: "qq_channel-bind",
                        chatKind: "channel",
                        chatId: "channel-bind",
                        updatedAt: Date.now(),
                        target: {},
                    };
                },
            },
        });

        (channel as any).accessToken = "qq-token";
        (channel as any).replyContextByChatId.set("channel-bind", {
            channelId: "channel-bind",
            guildId: "guild-bind",
            messageId: "msg-bind",
            eventType: "MESSAGE_CREATE",
        });

        const sent = await channel.sendProactiveMessage("manual");

        expect(sent).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does not fall back to in-memory reply context when binding is missing", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => ({
            ok: true,
            text: async () => "",
        }));
        vi.stubGlobal("fetch", fetchMock);

        const channel = new QqChannel({
            appId: "app-id",
            appSecret: "app-secret",
            sandbox: true,
            agent: { async *run() {} } as any,
            conversationStore: new ConversationStore(),
        });

        (channel as any).accessToken = "qq-token";
        (channel as any).replyContextByChatId.set("channel-legacy", {
            channelId: "channel-legacy",
            guildId: "guild-legacy",
            messageId: "msg-legacy",
            eventType: "MESSAGE_CREATE",
        });

        const sent = await channel.sendProactiveMessage("manual");

        expect(sent).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects explicit sessionKey when binding belongs to another channel", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => ({
            ok: true,
            text: async () => "",
        }));
        vi.stubGlobal("fetch", fetchMock);

        const channel = new QqChannel({
            appId: "app-id",
            appSecret: "app-secret",
            sandbox: true,
            agent: { async *run() {} } as any,
            conversationStore: new ConversationStore(),
            currentConversationBindingStore: {
                async upsert() {},
                async get() {
                    return {
                        channel: "feishu",
                        sessionKey: "channel=feishu:scope=per-peer:chat=chat-a:peer=user-a",
                        sessionScope: "per-peer",
                        legacyConversationId: "chat-a",
                        chatKind: "dm",
                        chatId: "chat-a",
                        updatedAt: Date.now(),
                        target: { chatId: "chat-a" },
                    };
                },
                async getLatestByChannel() {
                    return undefined;
                },
            },
        });

        (channel as any).accessToken = "qq-token";

        const sent = await channel.sendProactiveMessage("manual", {
            sessionKey: "channel=feishu:scope=per-peer:chat=chat-a:peer=user-a",
        });

        expect(sent).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("cancels a pending reconnect timer on stop", async () => {
        vi.useFakeTimers();

        const channel = new QqChannel({
            appId: "app-id",
            appSecret: "app-secret",
            sandbox: true,
            agent: { async *run() {} } as any,
            conversationStore: new ConversationStore(),
        });

        const connectSpy = vi.spyOn(channel as any, "connectWebSocket").mockResolvedValue(undefined);
        (channel as any)._running = true;
        (channel as any).scheduleReconnect(1000);

        await channel.stop();
        await vi.advanceTimersByTimeAsync(1000);

        expect(connectSpy).not.toHaveBeenCalled();
    });

    it("rejects an oversized qq voice attachment before reading its response body", async () => {
        const readBody = vi.fn(async () => new ArrayBuffer(0));
        vi.stubGlobal("fetch", vi.fn(async () => ({
            ok: true,
            status: 200,
            headers: new Headers({ "content-length": String(16 * 1024 * 1024 + 1) }),
            body: null,
            arrayBuffer: readBody,
        })) as any);
        const channel = new QqChannel({
            appId: "app-id",
            appSecret: "app-secret",
            sandbox: true,
            agent: { async *run() {} } as any,
            conversationStore: new ConversationStore(),
        });

        await expect((channel as any).downloadVoiceAttachmentBuffer(
            "https://multimedia.nt.qq.com.cn/download?id=oversized",
            "oversized voice",
        )).rejects.toThrow(/byte limit/i);
        expect(readBody).not.toHaveBeenCalled();
    });

    it("rejects traversal file names before writing a qq ffmpeg temporary input", async () => {
        const channel = new QqChannel({
            appId: "app-id",
            appSecret: "app-secret",
            sandbox: true,
            agent: { async *run() {} } as any,
            conversationStore: new ConversationStore(),
        });
        const writeFile = vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
        const runCommand = vi.spyOn(channel as any, "runCommand").mockResolvedValue({
            exitCode: 1,
            stdout: "",
            stderr: "blocked for path test",
        });

        await expect((channel as any).transcodeAudioBufferToWav(
            Buffer.from("voice"),
            "../outside.amr",
            "normalized.wav",
        )).rejects.toThrow(/unsafe basename/i);
        expect(writeFile).not.toHaveBeenCalled();
        expect(runCommand).not.toHaveBeenCalled();
    });

    it("downloads and transcribes qq voice attachments from C2C events", async () => {
        const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.startsWith("https://multimedia.nt.qq.com.cn/download")) {
                return {
                    ok: true,
                    arrayBuffer: async () => Uint8Array.from(Buffer.from("qq-voice-audio")).buffer,
                };
            }
            return {
                ok: true,
                text: async () => "",
            };
        });
        vi.stubGlobal("fetch", fetchMock as any);

        const sttTranscribe = vi.fn(async () => ({ text: "这是 QQ 语音的转写内容" }));
        const agent = {
            run: vi.fn(async function* (input: { text: string }) {
                yield {
                    type: "final" as const,
                    text: `reply:${input.text}`,
                };
            }),
        };

        const channel = new QqChannel({
            appId: "app-id",
            appSecret: "app-secret",
            sandbox: true,
            agent: agent as any,
            conversationStore: new ConversationStore(),
            sttTranscribe,
        });

        (channel as any).accessToken = "qq-token";

        await (channel as any).handleWsMessage({
            op: 0,
            s: 2,
            t: "C2C_MESSAGE_CREATE",
            id: "C2C_MESSAGE_CREATE:msg-audio-1",
            d: {
                content: "",
                attachments: [
                    {
                        content_type: "voice",
                        filename: "voice.amr",
                        size: 1729,
                        url: "https://multimedia.nt.qq.com.cn/download?appid=1402&fileid=test",
                    },
                ],
                author: {
                    id: "user-a",
                    username: "Alice",
                },
            },
        });

        expect(sttTranscribe).toHaveBeenCalledTimes(1);
        expect(sttTranscribe).toHaveBeenCalledWith(expect.objectContaining({
            fileName: "voice.amr",
            mime: "audio/amr",
        }));
        expect(agent.run).toHaveBeenCalledWith(expect.objectContaining({
            conversationId: "qq_user-a",
            text: "[音频转写]\n这是 QQ 语音的转写内容",
            meta: expect.objectContaining({
                channel: "qq",
                eventType: "C2C_MESSAGE_CREATE",
                sessionScope: "per-peer",
                sessionKey: "channel=qq:scope=per-peer:chatKind=dm:chat=user-a:peer=user-a",
                legacyConversationId: "qq_user-a",
            }),
        }));

        const outboundCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("https://sandbox.api.sgroup.qq.com/v2/users/"));
        expect(outboundCalls).toHaveLength(1);
        expect(JSON.parse(String((outboundCalls[0]?.[1] as RequestInit | undefined)?.body ?? "{}"))).toEqual(
            expect.objectContaining({
                content: "reply:[音频转写]\n这是 QQ 语音的转写内容",
                msg_id: "C2C_MESSAGE_CREATE:msg-audio-1",
                msg_type: 0,
            }),
        );
    });

    it("prefers qq voice_wav_url when the platform provides a wav attachment", async () => {
        const fetchMock = vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.startsWith("https://qqbot.ugcimg.cn/uservoice/")) {
                return {
                    ok: true,
                    arrayBuffer: async () => Uint8Array.from(Buffer.from("qq-wav-audio")).buffer,
                };
            }
            if (url.startsWith("https://multimedia.nt.qq.com.cn/download")) {
                throw new Error("should not download amr when wav url is present");
            }
            return {
                ok: true,
                text: async () => "",
            };
        });
        vi.stubGlobal("fetch", fetchMock as any);

        const sttTranscribe = vi.fn().mockResolvedValue({ text: "这是来自 wav 直链的转写" });
        const agent = {
            run: vi.fn(async function* (input: { text: string }) {
                yield {
                    type: "final" as const,
                    text: `reply:${input.text}`,
                };
            }),
        };

        const channel = new QqChannel({
            appId: "app-id",
            appSecret: "app-secret",
            sandbox: true,
            agent: agent as any,
            conversationStore: new ConversationStore(),
            sttTranscribe,
        });
        const transcodeSpy = vi.spyOn(channel as any, "transcodeAmrBufferToWav");

        (channel as any).accessToken = "qq-token";

        await (channel as any).handleWsMessage({
            op: 0,
            s: 2,
            t: "C2C_MESSAGE_CREATE",
            id: "C2C_MESSAGE_CREATE:msg-audio-wav-url",
            d: {
                content: "",
                attachments: [
                    {
                        content_type: "voice",
                        filename: "voice.amr",
                        size: 1729,
                        url: "https://multimedia.nt.qq.com.cn/download?appid=1402&fileid=test-amr",
                        voice_wav_url: "https://qqbot.ugcimg.cn/uservoice/test.wav",
                    },
                ],
                author: {
                    id: "user-a",
                    username: "Alice",
                },
            },
        });

        expect(fetchMock).toHaveBeenCalledWith("https://qqbot.ugcimg.cn/uservoice/test.wav", expect.anything());
        expect(sttTranscribe).toHaveBeenCalledTimes(1);
        expect(sttTranscribe.mock.calls[0]?.[0]).toMatchObject({
            fileName: "voice.wav",
            mime: "audio/wav",
        });
        expect(transcodeSpy).not.toHaveBeenCalled();
        expect(agent.run).toHaveBeenCalledWith(expect.objectContaining({
            text: "[音频转写]\n这是来自 wav 直链的转写",
        }));
    });

    it("retries qq voice_wav_url with fallback providers after normalized wav still returns empty", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const fetchMock = vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.startsWith("https://qqbot.ugcimg.cn/uservoice/")) {
                return {
                    ok: true,
                    arrayBuffer: async () => Uint8Array.from(Buffer.from("qq-wav-audio")).buffer,
                };
            }
            return {
                ok: true,
                text: async () => "",
            };
        });
        vi.stubGlobal("fetch", fetchMock as any);
        vi.stubEnv("BELLDANDY_STT_PROVIDER", "dashscope");
        vi.stubEnv("BELLDANDY_STT_GROQ_API_KEY", "gsk-mock");

        const sttTranscribe = vi.fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockImplementation(async (opts: { provider?: string }) => {
                if (opts.provider === "groq") {
                    return { text: "这是 fallback provider 的转写" };
                }
                return null;
            });
        const agent = {
            run: vi.fn(async function* (input: { text: string }) {
                yield {
                    type: "final" as const,
                    text: `reply:${input.text}`,
                };
            }),
        };

        const channel = new QqChannel({
            appId: "app-id",
            appSecret: "app-secret",
            sandbox: true,
            agent: agent as any,
            conversationStore: new ConversationStore(),
            sttTranscribe,
        });
        const normalizeSpy = vi.spyOn(channel as any, "normalizeVoiceBufferToWav")
            .mockResolvedValue(Buffer.from("qq-normalized-wav-audio"));

        (channel as any).accessToken = "qq-token";

        try {
            await (channel as any).handleWsMessage({
                op: 0,
                s: 2,
                t: "C2C_MESSAGE_CREATE",
                id: "C2C_MESSAGE_CREATE:msg-audio-wav-fallback-provider",
                d: {
                    content: "",
                    attachments: [
                        {
                            content_type: "voice",
                            filename: "voice.amr",
                            size: 1729,
                            url: "https://multimedia.nt.qq.com.cn/download?appid=1402&fileid=test-amr",
                            voice_wav_url: "https://qqbot.ugcimg.cn/uservoice/test.wav",
                        },
                    ],
                    author: {
                        id: "user-a",
                        username: "Alice",
                    },
                },
            });
        } finally {
            vi.unstubAllEnvs();
        }

        expect(normalizeSpy).toHaveBeenCalledTimes(1);
        expect(sttTranscribe).toHaveBeenCalledTimes(3);
        expect(sttTranscribe.mock.calls[0]?.[0]).toMatchObject({
            fileName: "voice.wav",
            mime: "audio/wav",
        });
        expect(sttTranscribe.mock.calls[1]?.[0]).toMatchObject({
            fileName: "voice.wav",
            mime: "audio/wav",
        });
        expect(sttTranscribe.mock.calls[2]?.[0]).toMatchObject({
            fileName: "voice.wav",
            mime: "audio/wav",
            provider: "groq",
        });
        expect(agent.run).toHaveBeenCalledWith(expect.objectContaining({
            text: "[音频转写]\n这是 fallback provider 的转写",
        }));
    });

    it("does not fall back to raw qq attachment after wav and normalized wav both return empty", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const fetchMock = vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.startsWith("https://qqbot.ugcimg.cn/uservoice/")) {
                return {
                    ok: true,
                    arrayBuffer: async () => Uint8Array.from(Buffer.from("qq-wav-audio")).buffer,
                };
            }
            if (url.startsWith("https://multimedia.nt.qq.com.cn/download")) {
                throw new Error("should not fall back to original attachment when wav fallback is disabled");
            }
            return {
                ok: true,
                text: async () => "",
            };
        });
        vi.stubGlobal("fetch", fetchMock as any);

        const sttTranscribe = vi.fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null);
        const agent = {
            run: vi.fn(async function* (input: { text: string }) {
                yield {
                    type: "final" as const,
                    text: `reply:${input.text}`,
                };
            }),
        };

        const channel = new QqChannel({
            appId: "app-id",
            appSecret: "app-secret",
            sandbox: true,
            agent: agent as any,
            conversationStore: new ConversationStore(),
            sttTranscribe,
        });
        const transcodeSpy = vi.spyOn(channel as any, "transcodeAmrBufferToWav").mockResolvedValue(Buffer.from("qq-normalized-wav-audio"));
        const normalizeSpy = vi.spyOn(channel as any, "normalizeVoiceBufferToWav")
            .mockResolvedValue(Buffer.from("qq-normalized-wav-audio"));

        (channel as any).accessToken = "qq-token";

        await (channel as any).handleWsMessage({
            op: 0,
            s: 2,
            t: "C2C_MESSAGE_CREATE",
            id: "C2C_MESSAGE_CREATE:msg-audio-wav-normalize",
            d: {
                content: "",
                attachments: [
                    {
                        content_type: "voice",
                        filename: "voice.amr",
                        size: 1729,
                        url: "https://multimedia.nt.qq.com.cn/download?appid=1402&fileid=test-amr",
                        voice_wav_url: "https://qqbot.ugcimg.cn/uservoice/test.wav",
                    },
                ],
                author: {
                    id: "user-a",
                    username: "Alice",
                },
            },
        });

        expect(transcodeSpy).not.toHaveBeenCalled();
        expect(normalizeSpy).toHaveBeenCalledTimes(1);
        expect(sttTranscribe).toHaveBeenCalledTimes(2);
        expect(sttTranscribe.mock.calls[0]?.[0]).toMatchObject({
            fileName: "voice.wav",
            mime: "audio/wav",
        });
        expect(sttTranscribe.mock.calls[1]?.[0]).toMatchObject({
            fileName: "voice.wav",
            mime: "audio/wav",
        });
        expect(agent.run).toHaveBeenCalledWith(expect.objectContaining({
            text: "[用户发送了 QQ 语音消息: voice.amr]",
        }));
    });

    it("strips the leading silk marker byte before silk wav transcode", () => {
        const channel = new QqChannel({
            appId: "app-id",
            appSecret: "app-secret",
            sandbox: true,
            agent: { async *run() {} } as any,
            conversationStore: new ConversationStore(),
        });

        const prefixedSilk = Buffer.from([0x02, ...Buffer.from("#!SILK_V3mock-data")]);
        const normalized = (channel as any).normalizeSilkBufferForTranscode(prefixedSilk);

        expect(normalized.subarray(0, 9).toString("ascii")).toBe("#!SILK_V3");
        expect(normalized.length).toBe(prefixedSilk.length - 1);
    });

    it("retries qq amr voice transcription after transcoding to wav on decode error", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const fetchMock = vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.startsWith("https://multimedia.nt.qq.com.cn/download")) {
                return {
                    ok: true,
                    arrayBuffer: async () => Uint8Array.from(Buffer.from("qq-amr-audio")).buffer,
                };
            }
            return {
                ok: true,
                text: async () => "",
            };
        });
        vi.stubGlobal("fetch", fetchMock as any);

        const sttTranscribe = vi.fn()
            .mockRejectedValueOnce(new Error("DashScope 转录任务失败: DECODE_ERROR"))
            .mockResolvedValueOnce({ text: "这是转码后重试成功的转写" });
        const agent = {
            run: vi.fn(async function* (input: { text: string }) {
                yield {
                    type: "final" as const,
                    text: `reply:${input.text}`,
                };
            }),
        };

        const channel = new QqChannel({
            appId: "app-id",
            appSecret: "app-secret",
            sandbox: true,
            agent: agent as any,
            conversationStore: new ConversationStore(),
            sttTranscribe,
        });
        vi.spyOn(channel as any, "transcodeAmrBufferToWav").mockResolvedValue(Buffer.from("qq-wav-audio"));

        (channel as any).accessToken = "qq-token";

        await (channel as any).handleWsMessage({
            op: 0,
            s: 2,
            t: "C2C_MESSAGE_CREATE",
            id: "C2C_MESSAGE_CREATE:msg-audio-retry",
            d: {
                content: "",
                attachments: [
                    {
                        content_type: "voice",
                        filename: "voice.amr",
                        size: 2048,
                        url: "https://multimedia.nt.qq.com.cn/download?appid=1402&fileid=retry",
                    },
                ],
                author: {
                    id: "user-a",
                    username: "Alice",
                },
            },
        });

        expect(sttTranscribe).toHaveBeenCalledTimes(2);
        expect(sttTranscribe.mock.calls[0]?.[0]).toMatchObject({
            fileName: "voice.amr",
            mime: "audio/amr",
        });
        expect(sttTranscribe.mock.calls[1]?.[0]).toMatchObject({
            fileName: "voice.wav",
            mime: "audio/wav",
        });
        expect((channel as any).transcodeAmrBufferToWav).toHaveBeenCalledTimes(1);
        expect(agent.run).toHaveBeenCalledWith(expect.objectContaining({
            text: "[音频转写]\n这是转码后重试成功的转写",
        }));
    });

    it("retries qq amr voice transcription after transcoding to wav when first stt pass returns null", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const fetchMock = vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.startsWith("https://multimedia.nt.qq.com.cn/download")) {
                return {
                    ok: true,
                    arrayBuffer: async () => Uint8Array.from(Buffer.from("qq-amr-audio")).buffer,
                };
            }
            return {
                ok: true,
                text: async () => "",
            };
        });
        vi.stubGlobal("fetch", fetchMock as any);

        const sttTranscribe = vi.fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ text: "这是空结果回退后的转写" });
        const agent = {
            run: vi.fn(async function* (input: { text: string }) {
                yield {
                    type: "final" as const,
                    text: `reply:${input.text}`,
                };
            }),
        };

        const channel = new QqChannel({
            appId: "app-id",
            appSecret: "app-secret",
            sandbox: true,
            agent: agent as any,
            conversationStore: new ConversationStore(),
            sttTranscribe,
        });
        vi.spyOn(channel as any, "transcodeAmrBufferToWav").mockResolvedValue(Buffer.from("qq-wav-audio"));

        (channel as any).accessToken = "qq-token";

        await (channel as any).handleWsMessage({
            op: 0,
            s: 2,
            t: "C2C_MESSAGE_CREATE",
            id: "C2C_MESSAGE_CREATE:msg-audio-null-retry",
            d: {
                content: "",
                attachments: [
                    {
                        content_type: "voice",
                        filename: "voice.amr",
                        size: 2048,
                        url: "https://multimedia.nt.qq.com.cn/download?appid=1402&fileid=retry-null",
                    },
                ],
                author: {
                    id: "user-a",
                    username: "Alice",
                },
            },
        });

        expect(sttTranscribe).toHaveBeenCalledTimes(2);
        expect(sttTranscribe.mock.calls[0]?.[0]).toMatchObject({
            fileName: "voice.amr",
            mime: "audio/amr",
        });
        expect(sttTranscribe.mock.calls[1]?.[0]).toMatchObject({
            fileName: "voice.wav",
            mime: "audio/wav",
        });
        expect((channel as any).transcodeAmrBufferToWav).toHaveBeenCalledTimes(1);
        expect(agent.run).toHaveBeenCalledWith(expect.objectContaining({
            text: "[音频转写]\n这是空结果回退后的转写",
        }));
    });

    it("skips raw qq silk fallback when silk decoder support is disabled", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const fetchMock = vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.startsWith("https://multimedia.nt.qq.com.cn/download")) {
                return {
                    ok: true,
                    arrayBuffer: async () => Uint8Array.from(Buffer.from([0x02, ...Buffer.from("#!SILK_V3mock-data")])).buffer,
                };
            }
            return {
                ok: true,
                text: async () => "",
            };
        });
        vi.stubGlobal("fetch", fetchMock as any);

        const sttTranscribe = vi.fn().mockResolvedValue(null);
        const agent = {
            run: vi.fn(async function* (input: { text: string }) {
                yield {
                    type: "final" as const,
                    text: `reply:${input.text}`,
                };
            }),
        };

        const channel = new QqChannel({
            appId: "app-id",
            appSecret: "app-secret",
            sandbox: true,
            agent: agent as any,
            conversationStore: new ConversationStore(),
            sttTranscribe,
        });
        const transcodeSpy = vi.spyOn(channel as any, "transcodeAmrBufferToWav");

        (channel as any).accessToken = "qq-token";

        await (channel as any).handleWsMessage({
            op: 0,
            s: 2,
            t: "C2C_MESSAGE_CREATE",
            id: "C2C_MESSAGE_CREATE:msg-audio-silk",
            d: {
                content: "",
                attachments: [
                    {
                        content_type: "voice",
                        filename: "voice.amr",
                        size: 2048,
                        url: "https://multimedia.nt.qq.com.cn/download?appid=1402&fileid=silk",
                    },
                ],
                author: {
                    id: "user-a",
                    username: "Alice",
                },
            },
        });

        expect(transcodeSpy).not.toHaveBeenCalled();
        expect(sttTranscribe).not.toHaveBeenCalled();
        expect(agent.run).toHaveBeenCalledWith(expect.objectContaining({
            text: "[用户发送了 QQ 语音消息: voice.amr]",
        }));
    });

    it("does not auto-infer openai qq stt fallback from ambient openai env", () => {
        vi.stubEnv("BELLDANDY_STT_PROVIDER", "dashscope");
        vi.stubEnv("OPENAI_API_KEY", "ambient-openai-key");
        vi.stubEnv("BELLDANDY_STT_OPENAI_API_KEY", "");

        const channel = new QqChannel({
            appId: "app-id",
            appSecret: "app-secret",
            sandbox: true,
            agent: { async *run() {} } as any,
            conversationStore: new ConversationStore(),
        });

        try {
            expect((channel as any).getQqVoiceFallbackProviders()).not.toContain("openai");
        } finally {
            vi.unstubAllEnvs();
        }
    });

    it("captures bounded qq event summaries without retaining raw message payloads", async () => {
        const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qq-event-samples-"));
        const sampleDir = path.join(stateDir, "tmp", "qq-event-samples");
        const channel = new QqChannel({
            appId: "app-id",
            appSecret: "app-secret",
            sandbox: true,
            agent: { async *run() {} } as any,
            conversationStore: new ConversationStore(),
            eventSampleCapture: {
                enabled: true,
                dir: sampleDir,
            },
        });

        try {
            await (channel as any).handleWsMessage({
                op: 0,
                s: 42,
                t: "C2C_MESSAGE_CREATE",
                id: "C2C_MESSAGE_CREATE:msg-audio-1",
                d: {
                    content: "",
                    author: {
                        id: "user-a",
                        username: "Alice",
                    },
                },
            });

            for (let i = 0; i < 20; i += 1) {
                const entries = await fs.readdir(sampleDir).catch(() => []);
                if (entries.length > 0) {
                    const content = await fs.readFile(path.join(sampleDir, entries[0]!), "utf8");
                    const parsed = JSON.parse(content);
                    expect(parsed).toMatchObject({
                        channel: "qq",
                        eventType: "C2C_MESSAGE_CREATE",
                        sequence: 42,
                        messageIdHash: expect.any(String),
                        chatIdHash: expect.any(String),
                    });
                    expect(parsed.payload).toMatchObject({
                        op: 0,
                        id: "C2C_MESSAGE_CREATE:msg-audio-1",
                        dataKeys: expect.arrayContaining(["author", "content"]),
                    });
                    expect(JSON.stringify(parsed)).not.toContain("Alice");
                    expect(JSON.stringify(parsed)).not.toContain("user-a");
                    return;
                }
                await sleep(20);
            }

            throw new Error("Expected captured QQ event sample file to be written");
        } finally {
            await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
        }
    });

    it("runs ingress admission before building QQ media text", async () => {
        const router = {
            admitIngress: vi.fn(() => ({ allow: false, reason: "channel_security:policy_missing" })),
            decide: vi.fn(),
        };
        const channel = new QqChannel({
            appId: "app-id",
            appSecret: "app-secret",
            sandbox: true,
            agent: { async *run() {} } as any,
            conversationStore: new ConversationStore(),
            router: router as any,
        });
        const buildInboundText = vi.spyOn(channel as any, "buildInboundText").mockResolvedValue("unexpected");

        await (channel as any).handleMessage({
            id: "qq-blocked-media",
            content: "",
            channel_id: "channel-blocked",
            guild_id: "guild-blocked",
            author: { id: "user-blocked", username: "Blocked" },
        }, "MESSAGE_CREATE");

        expect(router.admitIngress).toHaveBeenCalledWith(expect.objectContaining({
            channel: "qq",
            text: "",
        }));
        expect(buildInboundText).not.toHaveBeenCalled();
        expect(router.decide).not.toHaveBeenCalled();
    });
});
