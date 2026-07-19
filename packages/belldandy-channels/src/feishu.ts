import * as lark from "@larksuiteoapi/node-sdk";
import type { BelldandyAgent } from "@belldandy/agent";
import type { CurrentConversationBindingStore } from "./current-conversation-binding-store.js";
import type { ChatKind, ChannelRouter } from "./router/types.js";
import type {
    Channel,
    ChannelAgentResolver,
    ChannelConfig,
    ChannelLifecycleOptions,
    ChannelLifecycleState,
    ChannelOutboundOptions,
    ChannelProactiveTarget,
    ChannelConversationLease,
} from "./types.js";
import { chunkMarkdownForOutbound } from "./reply-chunking.js";
import { ChannelIngressScheduler } from "./channel-ingress-scheduler.js";
import { buildChannelSessionDescriptor } from "./session-key.js";
import {
    ChannelOutboundDeduplicator,
    classifyChannelOutboundFailure,
    combineChannelAbortSignals,
    runChannelOutbound,
    throwIfChannelAborted,
} from "./channel-outbound.js";
import {
    ChannelSafeLogger,
    createChannelApprovalPreview,
    createChannelPublicFailureMessage,
} from "./channel-safe-logger.js";

import { ConversationStore } from "@belldandy/agent";

function formatAudioTranscript(text: string): string {
    return `[音频转写]\n${text}`;
}

const channelSafeLogger = new ChannelSafeLogger();

export interface FeishuChannelConfig extends ChannelConfig {
    appId: string;
    appSecret: string;
    conversationStore: ConversationStore;
    agentId?: string;
    sttTranscribe?: (opts: { buffer: Buffer; fileName: string; mime?: string }) => Promise<{ text: string } | null>;
}

/**
 * 飞书渠道实现
 * 使用 WebSocket 长连接模式，无需公网 IP
 */
export class FeishuChannel implements Channel {
    /** 渠道名称 */
    readonly name = "feishu";

    private readonly client: lark.Client;
    private readonly wsClient: lark.WSClient;
    private readonly agent: BelldandyAgent;
    private readonly conversationStore: ConversationStore;
    private readonly agentId?: string;
    private readonly defaultAgentId?: string;
    private readonly router?: ChannelRouter;
    private readonly agentResolver?: ChannelAgentResolver;
    private readonly replyChunkingConfig?: FeishuChannelConfig["replyChunkingConfig"];
    private readonly currentConversationBindingStore?: CurrentConversationBindingStore;
    private readonly sttTranscribe?: (opts: { buffer: Buffer; fileName: string; mime?: string }) => Promise<{ text: string } | null>;
    private readonly onChannelSecurityApprovalRequired?: FeishuChannelConfig["onChannelSecurityApprovalRequired"];
    private readonly ingressScheduler: ChannelIngressScheduler;
    private readonly conversationLifecycle?: FeishuChannelConfig["conversationLifecycle"];
    private _running = false;
    private _lifecycleState: ChannelLifecycleState = "stopped";
    private startPromise?: Promise<void>;
    private stopPromise?: Promise<void>;
    private lifecycleAbortController = new AbortController();
    private readonly outboundDeduplicator = new ChannelOutboundDeduplicator();

    // Deduplication: track processed message IDs to avoid responding multiple times
    private readonly processedMessages = new Set<string>();
    private readonly MESSAGE_CACHE_SIZE = 1000;

    /** 渠道是否正在运行 */
    get isRunning(): boolean {
        return this._running;
    }

    get lifecycleState(): ChannelLifecycleState {
        return this._lifecycleState;
    }

    private isStopping(): boolean {
        return this._lifecycleState === "stopping";
    }

    private isStopped(): boolean {
        return this._lifecycleState === "stopped";
    }

    private renewLifecycleAbortController(): void {
        if (this.lifecycleAbortController.signal.aborted) {
            this.lifecycleAbortController = new AbortController();
        }
    }

    private abortLifecycleOutbound(): void {
        if (!this.lifecycleAbortController.signal.aborted) {
            this.lifecycleAbortController.abort(createLifecycleStopAbortError("Feishu channel stopped."));
        }
        this.outboundDeduplicator.clear();
    }

    private async runOutbound<T>(
        operation: (signal: AbortSignal) => Promise<T>,
        options: ChannelOutboundOptions = {},
    ): Promise<T> {
        const merged = combineChannelAbortSignals([
            options.signal,
            this.lifecycleAbortController.signal,
        ]);
        try {
            return await this.outboundDeduplicator.run(
                options.idempotencyKey,
                () => runChannelOutbound(operation, {
                    ...options,
                    signal: merged.signal,
                }),
            );
        } finally {
            merged.dispose();
        }
    }

    constructor(config: FeishuChannelConfig) {
        this.agent = config.agent;
        this.conversationStore = config.conversationStore;
        this.agentId = config.agentId;
        this.defaultAgentId = config.defaultAgentId;
        this.router = config.router;
        this.agentResolver = config.agentResolver;
        this.replyChunkingConfig = config.replyChunkingConfig;
        this.currentConversationBindingStore = config.currentConversationBindingStore;
        this.onChannelSecurityApprovalRequired = config.onChannelSecurityApprovalRequired;
        this.ingressScheduler = config.ingressScheduler ?? new ChannelIngressScheduler();
        this.conversationLifecycle = config.conversationLifecycle;

        // HTTP Client for sending messages
        this.client = new lark.Client({
            appId: config.appId,
            appSecret: config.appSecret,
        });

        // WebSocket Client for receiving events
        this.wsClient = new lark.WSClient({
            appId: config.appId,
            appSecret: config.appSecret,
            loggerLevel: lark.LoggerLevel.info,
        });

        this.sttTranscribe = config.sttTranscribe;
    }

    private inferChatKind(message: any): ChatKind {
        return message?.chat_type === "p2p" ? "dm" : "group";
    }

    private async readMessageResourceBuffer(response: unknown): Promise<Buffer> {
        if (!response) {
            throw new Error("Feishu message resource response is empty");
        }
        if (Buffer.isBuffer(response)) {
            return response;
        }

        const candidate = response as Record<string, unknown>;
        const data = candidate.data;
        if (Buffer.isBuffer(data)) {
            return data;
        }
        if (data instanceof ArrayBuffer) {
            return Buffer.from(data);
        }
        if (ArrayBuffer.isView(data)) {
            return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        }
        if (data && typeof (data as any).on === "function") {
            const chunks: Buffer[] = [];
            for await (const chunk of data as AsyncIterable<Uint8Array | Buffer | string>) {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            return Buffer.concat(chunks);
        }

        const rawBody = candidate.rawBody;
        if (Buffer.isBuffer(rawBody)) {
            return rawBody;
        }
        if (rawBody instanceof ArrayBuffer) {
            return Buffer.from(rawBody);
        }
        if (ArrayBuffer.isView(rawBody)) {
            return Buffer.from(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
        }
        if (typeof candidate.getReadableStream === "function") {
            const stream = await (candidate.getReadableStream as () => Promise<AsyncIterable<Uint8Array | Buffer | string>>)();
            const chunks: Buffer[] = [];
            for await (const chunk of stream) {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            return Buffer.concat(chunks);
        }

        throw new Error(`Unsupported Feishu message resource response shape: ${Object.keys(candidate).join(",") || typeof response}`);
    }

    private extractMentions(message: any): string[] {
        const mentions = new Set<string>();
        const addMention = (value: unknown) => {
            if (typeof value !== "string") return;
            const trimmed = value.trim();
            if (trimmed) mentions.add(trimmed);
        };

        if (Array.isArray(message?.mentions)) {
            for (const mention of message.mentions) {
                if (!mention || typeof mention !== "object") continue;
                const obj = mention as Record<string, unknown>;
                addMention(obj.id);
                addMention(obj.user_id);
                addMention(obj.open_id);
            }
        }

        if (typeof message?.content === "string") {
            try {
                const contentObj = JSON.parse(message.content) as Record<string, unknown>;
                if (typeof contentObj.text === "string") {
                    if (/<at\s+user_id=/.test(contentObj.text) || /@\S+/.test(contentObj.text)) {
                        mentions.add("__mention__");
                    }
                }
                if (Array.isArray(contentObj.mentions)) {
                    for (const mention of contentObj.mentions) {
                        if (!mention || typeof mention !== "object") continue;
                        const obj = mention as Record<string, unknown>;
                        addMention(obj.id);
                        addMention(obj.user_id);
                        addMention(obj.open_id);
                    }
                }
            } catch {
                // ignore non-json content
            }
        }

        return Array.from(mentions);
    }

    private resolveAgent(agentId?: string): BelldandyAgent {
        if (this.agentResolver) {
            try {
                return this.agentResolver(agentId);
            } catch (error) {
                channelSafeLogger.warn({
                    channel: "feishu",
                    event: "agent_resolution_failed",
                    failureKind: "configuration_error",
                });
            }
        }
        return this.agent;
    }



    async start(options: ChannelLifecycleOptions = {}): Promise<void> {
        if (this._running) return;
        if (this.startPromise) {
            await this.startPromise;
            return;
        }
        if (options.signal?.aborted) {
            throw toLifecycleAbortError(options.signal.reason);
        }

        const startPromise = (async () => {
            this._lifecycleState = "starting";
            this.renewLifecycleAbortController();
            const lifecycle = combineChannelAbortSignals([
                options.signal,
                this.lifecycleAbortController.signal,
            ]);
            const startSignal = lifecycle.signal;
            const closeOnAbort = () => this.wsClient.close({ force: true });
            startSignal?.addEventListener("abort", closeOnAbort, { once: true });
            try {
                // Each start owns one dispatcher. stop() force-closes the matching SDK client before a new start can publish.
                const eventDispatcher = new lark.EventDispatcher({}).register({
                    "im.message.receive_v1": async (data) => {
                        if (this._lifecycleState !== "running" && this._lifecycleState !== "starting") return;
                        await this.enqueueMessage(data);
                    },
                });

                await this.wsClient.start({
                    eventDispatcher,
                });
                if (startSignal?.aborted || this.isStopping()) {
                    this.wsClient.close({ force: true });
                    throw toLifecycleAbortError(startSignal?.reason);
                }

                this._running = true;
                this._lifecycleState = "running";
                console.log(`[${this.name}] WebSocket Channel started.`);
            } catch (error) {
                this._running = false;
                if (startSignal?.aborted || this.isStopping()) {
                    if (!this.isStopped()) {
                        await this.stop();
                    }
                } else {
                    this.abortLifecycleOutbound();
                    this.wsClient.close({ force: true });
                    this._lifecycleState = "failed";
                }
                throw error;
            } finally {
                startSignal?.removeEventListener("abort", closeOnAbort);
                lifecycle.dispose();
            }
        })();
        this.startPromise = startPromise;
        try {
            await startPromise;
        } finally {
            if (this.startPromise === startPromise) {
                this.startPromise = undefined;
            }
        }
    }

    async stop(_options: ChannelLifecycleOptions = {}): Promise<void> {
        if (this.stopPromise) {
            await this.stopPromise;
            return;
        }
        if (this._lifecycleState === "stopped" && !this.startPromise) return;

        const stopPromise = (async () => {
            this._lifecycleState = "stopping";
            this._running = false;
            try {
                this.abortLifecycleOutbound();
                // SDK v1.71.1 exposes close(); force-close also clears reconnect and liveness timers.
                this.wsClient.close({ force: true });
                this.ingressScheduler.cancelChannel(this.name);
                this.processedMessages.clear();
                this._lifecycleState = "stopped";
                console.log(`[${this.name}] Channel stopped.`);
            } catch (e) {
                this._lifecycleState = "failed";
                channelSafeLogger.error({
                    channel: "feishu",
                    event: "stop_failed",
                    failureKind: "internal_error",
                });
                throw e;
            }
        })();
        this.stopPromise = stopPromise;
        try {
            await stopPromise;
        } finally {
            if (this.stopPromise === stopPromise) {
                this.stopPromise = undefined;
            }
        }
    }

    /** SDK callback keeps awaiting completion, while queue ownership stays bounded and observable. */
    private async enqueueMessage(data: any): Promise<void> {
        const message = data?.message;
        const sender = data?.sender;
        const chatId = typeof message?.chat_id === "string" ? message.chat_id : "";
        const messageId = typeof message?.message_id === "string" ? message.message_id : "";
        if (!message || !chatId || !messageId) {
            await this.handleMessage(data);
            return;
        }
        const chatKind = this.inferChatKind(message);
        const senderId = sender?.sender_id?.open_id || sender?.sender_id?.user_id || sender?.sender_id?.union_id;
        const session = buildChannelSessionDescriptor({
            channel: "feishu",
            chatKind,
            chatId,
            senderId: typeof senderId === "string" ? senderId : undefined,
        });
        const scheduled = this.ingressScheduler.enqueue({
            channel: this.name,
            // ConversationStore persists group history by chatId, so retain that serialization owner.
            sessionKey: session.legacyConversationId,
            dedupeKey: messageId,
            payloadBytes: Buffer.byteLength(typeof message.content === "string" ? message.content : "", "utf8"),
            run: () => this.handleMessage(data),
        });
        if (!scheduled.accepted) {
            channelSafeLogger.warn({
                channel: this.name,
                event: "ingress_rejected",
                messageId,
                failureKind: "resource_exhausted",
                context: { reason: scheduled.reason },
            });
            return;
        }
        try {
            const completion = await scheduled.completion;
            if (completion.status !== "completed") {
                channelSafeLogger.warn({
                    channel: this.name,
                    event: "ingress_not_completed",
                    messageId,
                    failureKind: completion.status,
                    context: { outcome: completion.status },
                });
            }
        } catch {
            channelSafeLogger.error({
                channel: this.name,
                event: "queued_message_failed",
                messageId,
                failureKind: "internal_error",
            });
        }
    }

    private async handleMessage(data: any) {
        // SDK directly passes the event data, not nested under data.event
        // Based on official example: const { message: { chat_id, content} } = data;
        const message = data.message;
        const sender = data.sender;

        if (!message) {
            channelSafeLogger.error({
                channel: "feishu",
                event: "invalid_inbound_event",
                failureKind: "invalid_input",
            });
            return;
        }

        // Ignore updates, own messages, or system messages if needed
        // Usually we check message_type

        if (message.message_type !== "text" && message.message_type !== "audio") {
            // For now, only handle text and audio
            // TODO: Support images/files
            return;
        }

        const chatId = message.chat_id;
        const msgId = message.message_id;

        // === Deduplication: skip if we've already processed this message ===
        if (this.processedMessages.has(msgId)) {
            console.log(`Feishu: Skipping duplicate message ${msgId}`);
            return;
        }
        // Mark as processed immediately to prevent concurrent processing
        this.processedMessages.add(msgId);
        // Limit cache size to prevent memory leak
        if (this.processedMessages.size > this.MESSAGE_CACHE_SIZE) {
            const firstKey = this.processedMessages.values().next().value;
            if (firstKey) this.processedMessages.delete(firstKey);
        }

        const chatKind = this.inferChatKind(message);
        const mentions = this.extractMentions(message);
        const mentioned = chatKind === "dm" ? true : mentions.length > 0;
        const senderId = sender?.sender_id?.open_id || sender?.sender_id?.user_id || sender?.sender_id?.union_id;
        const session = buildChannelSessionDescriptor({
            channel: "feishu",
            chatKind,
            chatId,
            senderId: typeof senderId === "string" ? senderId : undefined,
        });
        const ingressDecision = this.router?.admitIngress?.({
            channel: "feishu",
            chatKind,
            chatId,
            sessionScope: session.sessionScope,
            sessionKey: session.sessionKey,
            text: "",
            senderId: typeof senderId === "string" ? senderId : undefined,
            senderName: typeof sender?.sender_id?.user_id === "string" ? sender.sender_id.user_id : undefined,
            mentions,
            mentioned,
            eventType: "im.message.receive_v1",
        });
        if (ingressDecision && !ingressDecision.allow) {
            if (ingressDecision.reason === "channel_security:dm_allowlist_blocked" && chatKind === "dm" && typeof senderId === "string") {
                void this.onChannelSecurityApprovalRequired?.({
                    channel: "feishu",
                    senderId,
                    senderName: typeof sender?.sender_id?.user_id === "string" ? sender.sender_id.user_id : undefined,
                    chatId,
                    chatKind: "dm",
                    messagePreview: "",
                });
            }
            console.log(`[${this.name}] Ingress blocked before media handling for ${msgId} (${ingressDecision.reason})`);
            return;
        }

        // Content is a JSON string: "{\"text\":\"hello\"}"
        let text = "";
        try {
            const contentObj = JSON.parse(message.content);
            if (message.message_type === "text") {
                text = contentObj.text;
            } else if (message.message_type === "audio") {
                if (!this.sttTranscribe) {
                    console.warn(`Feishu: Received audio message ${msgId} but STT is not configured.`);
                    return; // Or send a reply saying voice is not supported
                }
                const fileKey = contentObj.file_key;
                console.log(`Feishu: Downloading audio ${fileKey}...`);

                // Download audio file
                // SDK path: client.im.messageResource.get
                // Note: using 'as any' to bypass potential type mismatch in some SDK versions
                const response = await (this.client as any).im.messageResource.get({
                    path: { message_id: msgId, file_key: fileKey },
                    params: { type: "file" }, // type: 'image' | 'file'
                });

                // The SDK returns a stream or buffer depending on implementation?
                // Looking at SDK types, `writeFile` returns Promise<response>. 
                // But `get` returns `Promise<any>` with binary data in `data`?
                // Actually `get` returns a response object where `data` might be a stream.
                // Let's assume it returns a buffer or we can read it.
                // Official SDK often returns raw buffer if not streaming.
                // Let's try to treat response as containing buffer.
                // Note: The SDK's `im.message.resource.get` usually returns a stream in `data` property?
                // Let's double check standard implementation.
                // For safety, let's treat `response` (or `response.data`) as something convertible to Buffer.

                // Hack: If response is a crypto.webcrypto.BufferSource or ArrayBuffer...
                // The SDK behavior: `await client.im.message.resource.get(...)` returns `{ code: 0, msg: "success", data: ReadableStream }`?
                // Actually it returns binary data directly if not specified otherwise? 
                // Let's wrap in try-catch and inspect.

                // Assuming `response` is valid.
                // Wait, `get` returns `Promise<GetMessageResourceResponse>`.
                // We need to read the stream.

                // Let's fetch it manually if SDK is tricky, but we need auth token.
                // Better to use SDK.
                // If it fails, we catch error.

                // Let's assume `response` is the binary data (Buffer) because `node-sdk` might handle it?
                // No, looking at `node-sdk` code, it usually returns standard response wrapper.
                // If the content type is binary, `response` might be the buffer or stream.

                // Let's look at `node-sdk` typings if possible.
                // `get(request: GetMessageResourceRequest): Promise<GetMessageResourceResponse>;`
                // It usually returns a file stream.

                // To keep it simple, let's try `await response.writeFile(path)`? 
                // Or `response` itself is a stream.

                // Let's start with a simpler assumption: The `response` matches what `readFile` expects.
                // Actually, let's assume `response` is a Buffer for now (Node SDK behavior varies).
                // Or use `writeFile`.

                // CORRECT APPROACH for Lark Node SDK:
                // `const res = await client.im.message.resource.get(...)`
                // `const buffer = await res.readFile()`?? No.

                // It seems `client.im.message.resource.get` returns the binary file stream directly in some versions?
                // Let's try downloading via standard `Buffer.concat` on stream.

                const buffer = await this.readMessageResourceBuffer(response);

                if (buffer.length < 100) {
                    // Likely JSON error response
                    console.warn("Feishu: Audio download might be invalid (too small).");
                }

                // Transcribe
                // Feishu audio is usually 'opus' in 'audio/ogg' container or 'mp4' (m4a).
                // File extension in key is not guaranteed.
                // We'll guess MIME or use 'audio/mp4' (common for mobile).
                const mime = "audio/mp4";
                const sttRes = await this.sttTranscribe({
                    buffer,
                    fileName: `feishu_${msgId}.m4a`,
                    mime
                });

                if (sttRes?.text) {
                    text = formatAudioTranscript(sttRes.text);
                    channelSafeLogger.info({
                        channel: "feishu",
                        event: "audio_transcribed",
                        messageId: msgId,
                        body: text,
                    });
                } else {
                    console.warn(`Feishu: Audio transcription failed for ${msgId}.`);
                    return;
                }
            }

        } catch {
            channelSafeLogger.error({
                channel: "feishu",
                event: "inbound_media_processing_failed",
                messageId: msgId,
                failureKind: "media_error",
            });
            return;
        }

        // Ignore empty messages
        if (!text) return;

        const decision = this.router
            ? this.router.decide({
                channel: "feishu",
                chatKind,
                chatId,
                sessionScope: session.sessionScope,
                sessionKey: session.sessionKey,
                text,
                senderId: typeof senderId === "string" ? senderId : undefined,
                senderName: typeof sender?.sender_id?.user_id === "string" ? sender.sender_id.user_id : undefined,
                mentions,
                mentioned,
                eventType: "im.message.receive_v1",
            })
            : {
                allow: true,
                reason: "router_unavailable",
                agentId: this.agentId ?? this.defaultAgentId,
            };

        if (!decision.allow) {
            if (decision.reason === "channel_security:dm_allowlist_blocked" && chatKind === "dm" && typeof senderId === "string") {
                void this.onChannelSecurityApprovalRequired?.({
                    channel: "feishu",
                    senderId,
                    senderName: typeof sender?.sender_id?.user_id === "string" ? sender.sender_id.user_id : undefined,
                    chatId,
                    chatKind: "dm",
                    messagePreview: createChannelApprovalPreview(text),
                });
            }
            console.log(`[${this.name}] Route blocked message ${msgId} (${decision.reason})`);
            return;
        }

        const selectedAgentId = decision.agentId ?? this.agentId ?? this.defaultAgentId;
        const runAgent = this.resolveAgent(selectedAgentId);
        console.log(`[${this.name}] Route decision for ${msgId}: allow=${decision.allow}, rule=${decision.matchedRuleId ?? "default"}, agent=${selectedAgentId ?? "default"}`);
        await this.currentConversationBindingStore?.upsert({
            channel: "feishu",
            sessionKey: session.sessionKey,
            sessionScope: session.sessionScope,
            legacyConversationId: session.legacyConversationId,
            chatKind,
            chatId,
            ...(session.peerId ? { peerId: session.peerId } : {}),
            updatedAt: Date.now(),
            target: {
                chatId,
            },
        });

        channelSafeLogger.info({
            channel: "feishu",
            event: "message_received",
            messageId: msgId,
            body: text,
        });

        let lifecycleLease: ChannelConversationLease | undefined;
        try {
            lifecycleLease = await this.conversationLifecycle?.acquire({
                conversationId: session.legacyConversationId,
                agent: runAgent,
            });

            // Store history and the Agent stream share one lease through reply settlement.
            this.conversationStore.addMessage(session.legacyConversationId, "user", text, {
                agentId: selectedAgentId,
                channel: "feishu",
            });
            const history = this.conversationStore.getHistory(session.legacyConversationId);
            const runInput = {
                conversationId: session.legacyConversationId,
                text: text,
                history: history,
                meta: {
                    from: sender,
                    messageId: msgId,
                    channel: "feishu",
                    sessionScope: session.sessionScope,
                    sessionKey: session.sessionKey,
                    legacyConversationId: session.legacyConversationId,
                }
            };

            const stream = runAgent.run(runInput);
            let replyText = "";

            for await (const item of stream) {
                if (item.type === "delta") {
                    // Streaming is tricky with Feishu unless we use "card" updates.
                    // For simplicity in MVP, we accumulate and send send/reply at the end.
                    replyText += item.delta;
                } else if (item.type === "final") {
                    replyText = item.text; // Ensure we get the final full text if provided
                } else if (item.type === "tool_call") {
                    channelSafeLogger.info({
                        channel: "feishu",
                        event: "tool_call",
                        messageId: msgId,
                        body: JSON.stringify(item.arguments),
                        context: { toolName: item.name },
                    });
                } else if (item.type === "tool_result") {
                    channelSafeLogger.info({
                        channel: "feishu",
                        event: "tool_result",
                        messageId: msgId,
                        body: item.success ? item.output : item.error ?? "",
                        context: { toolName: item.name, success: item.success },
                    });
                }
            }

            if (replyText) {
                // [PERSISTENCE] Add Assistant Message to Store
                const sanitized = replyText
                    .replace(/<audio[^>]*>.*?<\/audio>/gi, "")
                    .replace(/\[Download\]\([^)]*\/generated\/[^)]*\)/gi, "")
                    .replace(/\n{3,}/g, "\n\n")
                    .trim();
                this.conversationStore.addMessage(session.legacyConversationId, "assistant", sanitized || replyText, {
                    agentId: selectedAgentId,
                    channel: "feishu",
                });

                await this.reply(msgId, replyText);
                console.log(`Feishu: Replied to message ${msgId}`);
            } else {
                console.warn(`Feishu: Agent returned empty response for message ${msgId}`);
            }

        } catch {
            channelSafeLogger.error({
                channel: "feishu",
                event: "agent_failed",
                messageId: msgId,
                failureKind: "internal_error",
            });
            await this.reply(msgId, createChannelPublicFailureMessage());
        } finally {
            await lifecycleLease?.release();
        }
    }

    private async reply(
        messageId: string,
        content: string,
        options: ChannelOutboundOptions = {},
    ): Promise<boolean> {
        try {
            await this.runOutbound(async (signal) => {
                const chunks = chunkMarkdownForOutbound(content, "feishu", {
                    config: this.replyChunkingConfig,
                });
                for (const chunk of chunks) {
                    throwIfChannelAborted(signal);
                    await this.client.im.message.reply({
                        path: {
                            message_id: messageId,
                        },
                        data: {
                            content: JSON.stringify({ text: chunk }),
                            msg_type: "text",
                        },
                    });
                    throwIfChannelAborted(signal);
                }
            }, {
                ...options,
                idempotencyKey: options.idempotencyKey ?? messageId,
            });
            return true;
        } catch (error) {
            channelSafeLogger.error({
                channel: "feishu",
                event: "reply_failed",
                messageId,
                failureKind: classifyChannelOutboundFailure({ error }),
            });
            return false;
        }
    }

    /**
     * 主动发送消息（非回复）
     * @param content - 消息内容
     * @param target - 可选，指定显式 chatId 或 canonical sessionKey；未指定时仅回退到持久化 binding
     * @returns 是否发送成功
     */
    async sendProactiveMessage(
        content: string,
        target?: ChannelProactiveTarget,
        options: ChannelOutboundOptions = {},
    ): Promise<boolean> {
        const explicitChatId = typeof target === "string"
            ? target
            : typeof target?.chatId === "string"
                ? target.chatId
                : "";
        const explicitSessionKey = typeof target === "object" && typeof target?.sessionKey === "string"
            ? target.sessionKey.trim()
            : "";
        const directBinding = explicitSessionKey
            ? await this.currentConversationBindingStore?.get(explicitSessionKey)
            : undefined;
        if (explicitSessionKey && directBinding && directBinding.channel !== "feishu") {
            console.warn(`[${this.name}] Cannot send proactive message - sessionKey channel mismatch: ${directBinding.channel}`);
            return false;
        }
        const fallbackBinding = !explicitChatId && !directBinding
            ? await this.currentConversationBindingStore?.getLatestByChannel({ channel: "feishu" })
            : undefined;
        const targetChatId = directBinding?.target.chatId
            || directBinding?.chatId
            || explicitChatId
            || fallbackBinding?.target.chatId
            || fallbackBinding?.chatId;

        if (!targetChatId) {
            console.warn(`[${this.name}] Cannot send proactive message - no binding-backed target chat ID found.`);
            return false;
        }

        try {
            await this.runOutbound(async (signal) => {
                const chunks = chunkMarkdownForOutbound(content, "feishu", {
                    config: this.replyChunkingConfig,
                });
                for (const chunk of chunks) {
                    throwIfChannelAborted(signal);
                    await this.client.im.message.create({
                        params: {
                            receive_id_type: "chat_id",
                        },
                        data: {
                            receive_id: targetChatId,
                            content: JSON.stringify({ text: chunk }),
                            msg_type: "text",
                        },
                    });
                    throwIfChannelAborted(signal);
                }
            }, options);
            console.log(`[${this.name}] Proactive message sent to ${targetChatId}`);
            return true;
        } catch (error) {
            channelSafeLogger.error({
                channel: "feishu",
                event: "proactive_send_failed",
                failureKind: classifyChannelOutboundFailure({ error }),
            });
            return false;
        }
    }
}

function toLifecycleAbortError(reason: unknown): Error {
    if (reason instanceof Error) return reason;
    const error = new Error("Channel lifecycle operation was aborted.");
    error.name = "AbortError";
    return error;
}

function createLifecycleStopAbortError(message: string): Error {
    const error = new Error(message);
    error.name = "AbortError";
    return error;
}
