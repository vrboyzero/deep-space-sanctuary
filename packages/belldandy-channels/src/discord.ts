import { Client, GatewayIntentBits, Message, TextChannel } from "discord.js";
import type { BelldandyAgent } from "@belldandy/agent";
import type { CurrentConversationBindingStore } from "./current-conversation-binding-store.js";
import type { Channel, ChannelConfig, ChannelEventListener, ChannelProactiveTarget } from "./types.js";
import type { ChannelRouter } from "./router/types.js";
import { chunkMarkdownForOutbound } from "./reply-chunking.js";
import { ChannelIngressScheduler } from "./channel-ingress-scheduler.js";
import { buildChannelSessionDescriptor } from "./session-key.js";
import {
    ChannelSafeLogger,
    createChannelApprovalPreview,
    createChannelPublicFailureMessage,
} from "./channel-safe-logger.js";

export interface DiscordChannelConfig extends ChannelConfig {
    botToken: string;
    intents?: number;
    sttTranscribe?: (opts: { buffer: Buffer; fileName: string; mime?: string }) => Promise<{ text: string } | null>;
}

type AudioAttachmentResolution = {
    fileName: string;
    mime?: string;
    transcript?: string;
    status: "transcribed" | "empty_result" | "failed" | "stt_unconfigured";
};

function formatAudioTranscript(text: string): string {
    return `[音频转写]\n${text}`;
}

const channelSafeLogger = new ChannelSafeLogger();

export class DiscordChannel implements Channel {
    readonly name = "discord";
    private client: Client | null = null;
    private startPromise: Promise<void> | null = null;
    private clientSession = 0;
    private agent: BelldandyAgent;
    private config: DiscordChannelConfig;
    private listeners: ChannelEventListener[] = [];
    private processedMessages = new Set<string>();
    private _running = false;
    private readonly router?: ChannelRouter;
    private readonly replyChunkingConfig?: DiscordChannelConfig["replyChunkingConfig"];
    private readonly currentConversationBindingStore?: CurrentConversationBindingStore;
    private readonly sttTranscribe?: DiscordChannelConfig["sttTranscribe"];
    private readonly onChannelSecurityApprovalRequired?: DiscordChannelConfig["onChannelSecurityApprovalRequired"];
    private readonly ingressScheduler: ChannelIngressScheduler;

    constructor(config: DiscordChannelConfig) {
        this.agent = config.agent;
        this.config = config;
        this.router = config.router;
        this.replyChunkingConfig = config.replyChunkingConfig;
        this.currentConversationBindingStore = config.currentConversationBindingStore;
        this.sttTranscribe = config.sttTranscribe;
        this.onChannelSecurityApprovalRequired = config.onChannelSecurityApprovalRequired;
        this.ingressScheduler = config.ingressScheduler ?? new ChannelIngressScheduler();
    }

    private resolveAgent(agentId?: string): BelldandyAgent {
        if (this.config.agentResolver) {
            try {
                return this.config.agentResolver(agentId);
            } catch (error) {
                channelSafeLogger.warn({
                    channel: "discord",
                    event: "agent_resolution_failed",
                    failureKind: "configuration_error",
                });
            }
        }
        return this.agent;
    }

    get isRunning(): boolean {
        return this._running && this.client !== null && this.client.isReady();
    }

    async start(): Promise<void> {
        if (this._running) {
            console.warn("[Discord] Already running");
            return;
        }
        if (this.startPromise) {
            await this.startPromise;
            return;
        }

        const intents = this.config.intents ?? (
            GatewayIntentBits.Guilds |
            GatewayIntentBits.GuildMessages |
            GatewayIntentBits.DirectMessages |
            GatewayIntentBits.MessageContent
        );

        const client = new Client({ intents });
        const session = ++this.clientSession;
        this.client = client;

        client.once("clientReady", () => {
            if (this.client !== client || this.clientSession !== session) {
                return;
            }
            console.log(`[Discord] Logged in as ${client.user!.tag}`);
            this._running = true;
            this.emit({ type: "started", channel: this.name });
        });

        client.on("messageCreate", (msg) => {
            if (this.client !== client || this.clientSession !== session) {
                return;
            }
            void this.enqueueMessage(msg);
        });

        client.on("error", (error) => {
            if (this.client !== client || this.clientSession !== session) {
                return;
            }
            channelSafeLogger.error({
                channel: "discord",
                event: "client_error",
                failureKind: "transport_error",
            });
            this.emit({ type: "error", channel: this.name, error });
        });

        const startPromise = (async () => {
            try {
                await client.login(this.config.botToken);
                if (this.client !== client || this.clientSession !== session) {
                    client.destroy();
                }
            } catch (error) {
                if (this.client === client && this.clientSession === session) {
                    this.client = null;
                    this._running = false;
                }
                throw error;
            }
        })();
        this.startPromise = startPromise;
        try {
            await startPromise;
        } finally {
            if (this.startPromise === startPromise) {
                this.startPromise = null;
            }
        }
    }

    async stop(): Promise<void> {
        const client = this.client;
        const session = this.clientSession;
        if (!client && !this.startPromise) return;
        this.client = null;
        this.clientSession = session + 1;
        this._running = false;
        this.ingressScheduler.cancelChannel(this.name);
        this.processedMessages.clear();
        if (client) {
            client.destroy();
        }
        console.log("[Discord] Stopped");
        this.emit({ type: "stopped", channel: this.name });
    }

    private async buildAudioAttachmentText(attachment: { name?: string | null; url: string; contentType?: string | null }): Promise<AudioAttachmentResolution> {
        const fileName = attachment.name?.trim() || "discord-audio";
        const mime = attachment.contentType ?? undefined;
        console.info(`[Discord] Processing audio attachment ${fileName} (${mime ?? "unknown"})`);
        if (!this.sttTranscribe) {
            console.warn(`[Discord] Audio attachment ${fileName} skipped: sttTranscribe is not configured`);
            return {
                fileName,
                mime,
                status: "stt_unconfigured",
            };
        }

        try {
            const response = await fetch(attachment.url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const buffer = Buffer.from(await response.arrayBuffer());
            const transcript = await this.sttTranscribe({
                buffer,
                fileName,
                mime,
            });
            const text = transcript?.text?.trim();
            if (!text) {
                console.warn(`[Discord] Audio attachment ${fileName} STT returned empty result`);
                return {
                    fileName,
                    mime,
                    status: "empty_result",
                };
            }
            console.info(`[Discord] Audio attachment ${fileName} transcribed successfully`);
            return {
                fileName,
                mime,
                transcript: formatAudioTranscript(text),
                status: "transcribed",
            };
        } catch {
            channelSafeLogger.warn({
                channel: "discord",
                event: "audio_transcription_failed",
                failureKind: "media_error",
            });
            return {
                fileName,
                mime,
                status: "failed",
            };
        }
    }

    /** 仅提交已有 handler；history 仍按 legacy conversation owner 串行。 */
    private enqueueMessage(message: Message): void {
        const chatId = message.channelId;
        const chatKind = message.guildId ? "channel" : "dm";
        const session = buildChannelSessionDescriptor({
            channel: "discord",
            chatKind,
            chatId,
            senderId: message.author.id,
        });
        const scheduled = this.ingressScheduler.enqueue({
            channel: this.name,
            // Group channel history is keyed by channelId, not by the canonical per-sender session key.
            sessionKey: session.legacyConversationId,
            dedupeKey: message.id,
            payloadBytes: Buffer.byteLength(message.content || "", "utf8"),
            run: () => this.handleMessage(message),
        });
        if (!scheduled.accepted) {
            channelSafeLogger.warn({
                channel: this.name,
                event: "ingress_rejected",
                messageId: message.id,
                failureKind: "resource_exhausted",
                context: { reason: scheduled.reason },
            });
            return;
        }
        void scheduled.completion.then((completion) => {
            if (completion.status !== "completed") {
                channelSafeLogger.warn({
                    channel: this.name,
                    event: "ingress_not_completed",
                    messageId: message.id,
                    failureKind: completion.status,
                    context: { outcome: completion.status },
                });
            }
        }).catch(() => {
            channelSafeLogger.error({
                channel: this.name,
                event: "queued_message_failed",
                messageId: message.id,
                failureKind: "internal_error",
            });
        });
    }

    private async handleMessage(message: Message): Promise<void> {
        // 忽略 Bot 自身消息
        if (message.author.bot) return;

        // 消息去重
        if (this.processedMessages.has(message.id)) return;
        this.processedMessages.add(message.id);

        // 限制去重集合大小
        if (this.processedMessages.size > 1000) {
            const toDelete = Array.from(this.processedMessages).slice(0, 500);
            toDelete.forEach((id) => this.processedMessages.delete(id));
        }

        const chatId = message.channelId;
        const userId = message.author.id;
        const username = message.author.username;
        const chatKind = message.guildId ? "channel" : "dm";
        const mentions = message.mentions.users.map((u) => u.id);
        const mentioned = message.guildId ? message.mentions.has(this.client!.user!.id) : true;
        const session = buildChannelSessionDescriptor({
            channel: "discord",
            chatKind,
            chatId,
            senderId: userId,
        });
        const ingressDecision = this.router?.admitIngress?.({
            channel: "discord",
            chatKind,
            chatId,
            sessionScope: session.sessionScope,
            sessionKey: session.sessionKey,
            text: "",
            senderId: userId,
            senderName: username,
            mentions,
            mentioned,
            eventType: "messageCreate",
        });
        if (ingressDecision && !ingressDecision.allow) {
            if (ingressDecision.reason === "channel_security:dm_allowlist_blocked" && chatKind === "dm" && userId) {
                void this.onChannelSecurityApprovalRequired?.({
                    channel: "discord",
                    senderId: userId,
                    senderName: username,
                    chatId,
                    chatKind: "dm",
                    messagePreview: createChannelApprovalPreview(message.content || ""),
                });
            }
            console.log(`[Discord] Ingress blocked before media handling for ${message.id} (${ingressDecision.reason})`);
            return;
        }

        channelSafeLogger.info({
            channel: "discord",
            event: "message_received",
            messageId: message.id,
            body: message.content || "",
            context: { attachmentCount: message.attachments.size },
        });
        this.emit({ type: "message_received", channel: this.name, messageId: message.id, chatId });

        // 构建多模态内容
        const contentParts: any[] = [];
        const failedAudioAttachments: AudioAttachmentResolution[] = [];

        if (message.content) {
            contentParts.push({ type: "text", text: message.content });
        }

        for (const attachment of message.attachments.values()) {
            if (attachment.contentType?.startsWith("image/")) {
                contentParts.push({
                    type: "image_url",
                    image_url: { url: attachment.url }
                });
                this.emit({
                    type: "media_received",
                    channel: this.name,
                    messageId: message.id,
                    chatId,
                    mediaType: "image"
                });
            } else if (attachment.contentType?.startsWith("video/")) {
                contentParts.push({
                    type: "video_url",
                    video_url: { url: attachment.url }
                });
                this.emit({
                    type: "media_received",
                    channel: this.name,
                    messageId: message.id,
                    chatId,
                    mediaType: "video"
                });
            } else if (attachment.contentType?.startsWith("audio/")) {
                const audioResult = await this.buildAudioAttachmentText(attachment);
                if (audioResult.transcript) {
                    contentParts.push({
                        type: "text",
                        text: audioResult.transcript
                    });
                } else {
                    failedAudioAttachments.push(audioResult);
                }
                this.emit({
                    type: "media_received",
                    channel: this.name,
                    messageId: message.id,
                    chatId,
                    mediaType: "audio"
                });
            }
        }

        if (contentParts.length === 0) {
            if (failedAudioAttachments.length > 0) {
                const audioNames = failedAudioAttachments.map((item) => item.fileName).join("、");
                const fallbackMessage = `收到音频附件，但当前未能完成转写，请检查 STT 配置或改传 wav/mp3。附件：${audioNames}`;
                console.warn(`[Discord] No transcribed content available for message ${message.id}; replying with fallback`);
                await message.reply(fallbackMessage);
                this.emit({ type: "message_sent", channel: this.name, chatId });
                return;
            }
            console.warn("[Discord] Empty message, skipping");
            return;
        }

        const decision = this.router
            ? this.router.decide({
                channel: "discord",
                chatKind,
                chatId,
                sessionScope: session.sessionScope,
                sessionKey: session.sessionKey,
                text: message.content || "",
                senderId: userId,
                senderName: username,
                mentions,
                mentioned,
                eventType: "messageCreate",
            })
            : {
                allow: true,
                reason: "router_unavailable",
                agentId: this.config.defaultAgentId,
            };

        if (!decision.allow) {
            if (decision.reason === "channel_security:dm_allowlist_blocked" && chatKind === "dm" && userId) {
                void this.onChannelSecurityApprovalRequired?.({
                    channel: "discord",
                    senderId: userId,
                    senderName: username,
                    chatId,
                    chatKind: "dm",
                    messagePreview: createChannelApprovalPreview(message.content || ""),
                });
            }
            console.log(`[Discord] Route blocked message ${message.id} (${decision.reason})`);
            return;
        }

        const selectedAgentId = decision.agentId ?? this.config.defaultAgentId;
        const runAgent = this.resolveAgent(selectedAgentId);
        console.log(`[Discord] Route decision for ${message.id}: allow=${decision.allow}, rule=${decision.matchedRuleId ?? "default"}, agent=${selectedAgentId ?? "default"}`);
        await this.currentConversationBindingStore?.upsert({
            channel: "discord",
            sessionKey: session.sessionKey,
            sessionScope: session.sessionScope,
            legacyConversationId: session.legacyConversationId,
            chatKind,
            chatId,
            ...(session.peerId ? { peerId: session.peerId } : {}),
            updatedAt: Date.now(),
            target: {
                channelId: chatId,
                ...(message.guildId ? { guildId: message.guildId } : {}),
            },
        });

        // 显示 "正在输入..." 状态
        if (message.channel.isTextBased() && 'sendTyping' in message.channel) {
            await message.channel.sendTyping();
        }

        try {
            // 调用 Agent 处理
            const stream = runAgent.run({
                text: message.content || "",
                content: contentParts,
                conversationId: session.legacyConversationId,
                meta: {
                    channel: "discord",
                    userId,
                    username,
                    guildId: message.guildId ?? undefined,
                    channelId: chatId,
                    agentId: selectedAgentId,
                    sessionScope: session.sessionScope,
                    sessionKey: session.sessionKey,
                    legacyConversationId: session.legacyConversationId,
                }
            });

            let fullResponse = "";
            let lastTypingTime = Date.now();

            for await (const item of stream) {
                if (item.type === "delta") {
                    fullResponse += item.delta;
                    // 每 2 秒续发一次 typing 状态
                    const now = Date.now();
                    if (now - lastTypingTime > 2000) {
                        if (message.channel.isTextBased() && 'sendTyping' in message.channel) {
                            await message.channel.sendTyping();
                        }
                        lastTypingTime = now;
                    }
                } else if (item.type === "final") {
                    fullResponse = item.text;
                }
            }

            // 发送最终回复
            if (fullResponse) {
                await this.sendLongMessage(message.channel as TextChannel, fullResponse);
                this.emit({ type: "message_sent", channel: this.name, chatId });
            }
        } catch (error) {
            channelSafeLogger.error({
                channel: "discord",
                event: "agent_failed",
                messageId: message.id,
                failureKind: "internal_error",
            });
            await message.reply(createChannelPublicFailureMessage());
            this.emit({ type: "error", channel: this.name, error: new Error("channel_agent_failed") });
        }
    }

    /**
     * 处理 Discord 2000 字符单条消息限制，自动分段发送
     */
    private async sendLongMessage(channel: TextChannel, content: string): Promise<void> {
        const chunks = chunkMarkdownForOutbound(content, "discord", {
            config: this.replyChunkingConfig,
        });
        for (const chunk of chunks) {
            await channel.send(chunk);
            if (chunks.length > 1) {
                await new Promise((resolve) => setTimeout(resolve, 500)); // 防止速率限制
            }
        }
    }

    /**
     * 主动发送消息
     */
    async sendProactiveMessage(content: string, target?: ChannelProactiveTarget): Promise<boolean> {
        if (!this.isRunning) {
            console.error("[Discord] Cannot send message: client not running");
            return false;
        }

        const explicitChannelId = typeof target === "string"
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
        if (explicitSessionKey && directBinding && directBinding.channel !== "discord") {
            console.error("[Discord] Invalid proactive sessionKey channel:", directBinding.channel);
            return false;
        }
        const fallbackBinding = !explicitChannelId && !directBinding
            ? await this.currentConversationBindingStore?.getLatestByChannel({ channel: "discord" })
            : undefined;
        const targetChannelId = directBinding?.target.channelId
            || directBinding?.chatId
            || explicitChannelId
            || fallbackBinding?.target.channelId
            || fallbackBinding?.chatId;

        if (!targetChannelId) {
            console.error("[Discord] No binding-backed target channel specified");
            return false;
        }

        try {
            const channel = await this.client!.channels.fetch(targetChannelId);

            if (!channel || !channel.isTextBased()) {
                console.error("[Discord] Invalid channel:", targetChannelId);
                return false;
            }

            await this.sendLongMessage(channel as TextChannel, content);
            this.emit({ type: "message_sent", channel: this.name, chatId: targetChannelId });
            return true;
        } catch (error) {
            channelSafeLogger.error({
                channel: "discord",
                event: "proactive_send_failed",
                failureKind: "transport_error",
            });
            this.emit({ type: "error", channel: this.name, error: error as Error });
            return false;
        }
    }

    /**
     * 事件监听器管理
     */
    addEventListener(listener: ChannelEventListener): void {
        this.listeners.push(listener);
    }

    removeEventListener(listener: ChannelEventListener): void {
        const index = this.listeners.indexOf(listener);
        if (index !== -1) {
            this.listeners.splice(index, 1);
        }
    }

    private emit(event: any): void {
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch {
                channelSafeLogger.error({
                    channel: "discord",
                    event: "event_listener_failed",
                    failureKind: "internal_error",
                });
            }
        }
    }
}
