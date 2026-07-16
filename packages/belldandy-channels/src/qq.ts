import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import type { BelldandyAgent, ConversationStore } from "@belldandy/agent";
import { FilesystemCapability, assertSafeFilesystemBasename } from "@belldandy/protocol";
import type { ChatKind, ChannelRouter } from "./router/types.js";
import type { Channel, ChannelConfig, ChannelProactiveTarget } from "./types.js";
import { chunkMarkdownForOutbound } from "./reply-chunking.js";
import { ChannelIngressScheduler } from "./channel-ingress-scheduler.js";
import type { CurrentConversationBindingStore } from "./current-conversation-binding-store.js";
import { buildChannelSessionDescriptor } from "./session-key.js";
import { readBoundedMediaBuffer } from "./media-reader.js";
import {
    ChannelSafeLogger,
    createChannelApprovalPreview,
    hashChannelIdentifier,
} from "./channel-safe-logger.js";

const channelSafeLogger = new ChannelSafeLogger();
const QQ_EVENT_SAMPLE_CAPTURE_MAX_FILES = 100;

export interface QqChannelConfig extends ChannelConfig {
    appId: string;
    appSecret: string;
    sandbox?: boolean;
    conversationStore: ConversationStore;
    agentId?: string;
    sttTranscribe?: (opts: { buffer: Buffer; fileName: string; mime?: string; provider?: string }) => Promise<{ text: string } | null>;
    eventSampleCapture?: {
        enabled: boolean;
        dir: string;
    };
}

interface WsPayload {
    op: number;
    d?: any;
    s?: number;
    t?: string;
    id?: string;
}

function summarizeQqEventPayload(payload: WsPayload): Record<string, unknown> {
    const data = payload.d && typeof payload.d === "object" ? payload.d as Record<string, unknown> : undefined;
    return {
        op: payload.op,
        ...(typeof payload.s === "number" ? { sequence: payload.s } : {}),
        ...(typeof payload.t === "string" ? { eventType: payload.t } : {}),
        ...(typeof payload.id === "string" ? { id: payload.id } : {}),
        ...(data ? { dataKeys: Object.keys(data).sort().slice(0, 32) } : {}),
    };
}

type QqReplyContext = {
    channelId?: string;
    guildId?: string;
    groupOpenId?: string;
    userOpenId?: string;
    messageId?: string;
    eventType: string;
};

function isQqReplyContextResolved(replyContext: QqReplyContext | undefined): replyContext is QqReplyContext {
    if (!replyContext) return false;
    if (replyContext.eventType === "DIRECT_MESSAGE_CREATE") return typeof replyContext.guildId === "string" && replyContext.guildId.length > 0;
    if (replyContext.eventType === "C2C_MESSAGE_CREATE") return typeof replyContext.userOpenId === "string" && replyContext.userOpenId.length > 0;
    if (replyContext.eventType === "GROUP_AT_MESSAGE_CREATE") return typeof replyContext.groupOpenId === "string" && replyContext.groupOpenId.length > 0;
    return typeof replyContext.channelId === "string" && replyContext.channelId.length > 0;
}

// WebSocket OpCodes
const OpCode = {
    DISPATCH: 0,        // 服务端推送事件
    HEARTBEAT: 1,       // 客户端心跳
    IDENTIFY: 2,        // 鉴权
    RESUME: 6,          // 恢复连接
    RECONNECT: 7,       // 服务端通知重连
    INVALID_SESSION: 9, // 无效会话
    HELLO: 10,          // 服务端欢迎
    HEARTBEAT_ACK: 11,  // 心跳ACK
} as const;

// Intents (订阅事件类型)
const Intents = {
    GUILDS: 1 << 0,
    GUILD_MEMBERS: 1 << 1,
    GUILD_MESSAGES: 1 << 9,          // 私域消息
    GUILD_MESSAGE_REACTIONS: 1 << 10,
    DIRECT_MESSAGE: 1 << 12,         // 私信
    GROUP_AND_C2C_EVENT: 1 << 25,    // 单聊与群聊
    PUBLIC_GUILD_MESSAGES: 1 << 30,  // 公域消息（需要@）
} as const;

const QQ_EVENT_SAMPLE_CAPTURE_TIMEOUT_MS = 5_000;
const QQ_VOICE_DOWNLOAD_TIMEOUT_MS = 15_000;
const QQ_VOICE_STT_TIMEOUT_MS = 30_000;
const QQ_VOICE_TRANSCODE_TIMEOUT_MS = 30_000;
const QQ_VOICE_MAX_BYTES = 16 * 1024 * 1024;
const QQ_FFMPEG_OUTPUT_MAX_BYTES = 64 * 1024;
const DEFAULT_FFMPEG_COMMAND = "ffmpeg";
const QQ_SILK_DECODER_SUPPORTED = false;

function formatAudioTranscript(text: string): string {
    return `[音频转写]\n${text}`;
}

export class QqChannel implements Channel {
    readonly name = "qq";

    private readonly agent: BelldandyAgent;
    private readonly conversationStore: ConversationStore;
    private readonly agentId?: string;
    private readonly defaultAgentId?: string;
    private readonly router?: ChannelRouter;
    private readonly replyChunkingConfig?: QqChannelConfig["replyChunkingConfig"];
    private readonly currentConversationBindingStore?: CurrentConversationBindingStore;
    private readonly onChannelSecurityApprovalRequired?: QqChannelConfig["onChannelSecurityApprovalRequired"];
    private readonly sttTranscribe?: QqChannelConfig["sttTranscribe"];
    private readonly eventSampleCapture?: QqChannelConfig["eventSampleCapture"];
    private readonly ingressScheduler: ChannelIngressScheduler;

    private _running = false;
    private readonly replyContextByChatId = new Map<string, QqReplyContext>();

    private readonly processedMessages = new Set<string>();
    private readonly MESSAGE_CACHE_SIZE = 1000;

    // AccessToken management
    private accessToken: string = "";
    private tokenExpiresAt: number = 0;
    private tokenRefreshTimer?: NodeJS.Timeout;
    private reconnectTimer?: NodeJS.Timeout;

    // WebSocket
    private ws?: WebSocket;
    private heartbeatInterval?: NodeJS.Timeout;
    private sessionId?: string;
    private sequence: number = 0;
    private gatewayUrl?: string;
    private suppressCloseReconnect = false;

    get isRunning(): boolean {
        return this._running;
    }

    constructor(private readonly config: QqChannelConfig) {
        this.agent = config.agent;
        this.conversationStore = config.conversationStore;
        this.agentId = config.agentId;
        this.defaultAgentId = config.defaultAgentId;
        this.router = config.router;
        this.replyChunkingConfig = config.replyChunkingConfig;
        this.currentConversationBindingStore = config.currentConversationBindingStore;
        this.onChannelSecurityApprovalRequired = config.onChannelSecurityApprovalRequired;
        this.sttTranscribe = config.sttTranscribe;
        this.eventSampleCapture = config.eventSampleCapture?.enabled ? config.eventSampleCapture : undefined;
        this.ingressScheduler = config.ingressScheduler ?? new ChannelIngressScheduler();
    }

    private resolveAgent(agentId?: string): BelldandyAgent {
        if (this.config.agentResolver) {
            try {
                return this.config.agentResolver(agentId);
            } catch (error) {
                channelSafeLogger.warn({
                    channel: "qq",
                    event: "agent_resolution_failed",
                    failureKind: "configuration_error",
                });
            }
        }
        return this.agent;
    }

    private inferChatKind(eventType: string): ChatKind {
        if (eventType === "DIRECT_MESSAGE_CREATE" || eventType === "C2C_MESSAGE_CREATE") return "dm";
        if (eventType === "GROUP_AT_MESSAGE_CREATE") return "group";
        return "channel";
    }

    private resolveChatId(message: any): string | undefined {
        const chatId = message.channel_id || message.guild_id || message.group_openid || message.author?.id;
        return typeof chatId === "string" && chatId.length > 0 ? chatId : undefined;
    }

    private isMessageDispatchEventType(eventType: string | undefined): boolean {
        return eventType === "AT_MESSAGE_CREATE"
            || eventType === "MESSAGE_CREATE"
            || eventType === "DIRECT_MESSAGE_CREATE"
            || eventType === "C2C_MESSAGE_CREATE"
            || eventType === "GROUP_AT_MESSAGE_CREATE";
    }

    private sanitizeSampleFileSegment(value: unknown, fallback: string): string {
        if (typeof value !== "string") return fallback;
        const trimmed = value.trim();
        if (!trimmed) return fallback;
        return trimmed.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80) || fallback;
    }

    private normalizeOptionalString(value: unknown): string | undefined {
        if (typeof value !== "string") return undefined;
        const trimmed = value.trim();
        return trimmed || undefined;
    }

    private normalizeDispatchMessage(payload: WsPayload): any {
        const message = (payload.d && typeof payload.d === "object")
            ? { ...payload.d }
            : {};
        if (typeof payload.id === "string" && !this.normalizeOptionalString(message.id)) {
            message.id = payload.id;
        }
        return message;
    }

    private async captureEventSample(payload: WsPayload, eventType: string, sequence?: number): Promise<void> {
        if (!this.eventSampleCapture?.enabled) return;

        try {
            const dir = this.eventSampleCapture.dir;
            await fs.mkdir(dir, { recursive: true });
            const existingFiles = await fs.readdir(dir, { withFileTypes: true });
            if (existingFiles.filter((entry) => entry.isFile()).length >= QQ_EVENT_SAMPLE_CAPTURE_MAX_FILES) {
                channelSafeLogger.warn({
                    channel: "qq",
                    event: "event_sample_skipped",
                    context: { reason: "file_limit" },
                });
                return;
            }
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const messageId = this.sanitizeSampleFileSegment(
                typeof payload.id === "string" ? payload.id : payload.d?.id,
                "no-message-id",
            );
            const eventSegment = this.sanitizeSampleFileSegment(eventType, "unknown-event");
            const sequenceSegment = Number.isFinite(sequence) ? String(sequence) : "na";
            const filePath = path.join(
                dir,
                `${timestamp}_${eventSegment}_s${sequenceSegment}_${messageId.slice(0, 24)}.json`,
            );
            const message = this.normalizeDispatchMessage(payload);
            const chatId = this.resolveChatId(message);
            const sampleRecord = {
                capturedAt: new Date().toISOString(),
                channel: "qq",
                eventType,
                sequence,
                messageIdHash: typeof message?.id === "string" ? hashChannelIdentifier(message.id) : undefined,
                chatIdHash: chatId ? hashChannelIdentifier(chatId) : undefined,
                // debug capture 只保存协议形状；正文、作者资料与原始 payload 不落盘。
                payload: summarizeQqEventPayload(payload),
            };
            await fs.writeFile(filePath, `${JSON.stringify(sampleRecord, null, 2)}\n`, "utf8");
            channelSafeLogger.info({
                channel: "qq",
                event: "event_sample_captured",
                messageId: typeof message?.id === "string" ? message.id : undefined,
                context: { eventType },
            });
        } catch {
            channelSafeLogger.warn({
                channel: "qq",
                event: "event_sample_failed",
                context: { eventType },
            });
        }
    }

    private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
        let timer: NodeJS.Timeout | undefined;
        try {
            return await Promise.race([
                promise,
                new Promise<T>((_, reject) => {
                    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
                }),
            ]);
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    }

    private readFfmpegCommand(): string {
        const configured = this.normalizeOptionalString(process.env.BELLDANDY_CAMERA_NATIVE_HELPER_FFMPEG_COMMAND);
        return configured ?? DEFAULT_FFMPEG_COMMAND;
    }

    private async runCommand(input: {
        command: string;
        args: string[];
        timeoutMs: number;
    }): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
        return await new Promise((resolve, reject) => {
            const child = spawn(input.command, input.args, {
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true,
                shell: false,
            });
            let stdout = "";
            let stderr = "";
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                child.kill();
                reject(new Error(`Command timed out after ${input.timeoutMs}ms: ${input.command}`));
            }, input.timeoutMs);

            child.stdout.setEncoding("utf8");
            child.stderr.setEncoding("utf8");
            child.stdout.on("data", (chunk) => {
                stdout = this.appendBoundedProcessOutput(stdout, chunk);
            });
            child.stderr.on("data", (chunk) => {
                stderr = this.appendBoundedProcessOutput(stderr, chunk);
            });
            child.on("error", (error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(error);
            });
            child.on("close", (exitCode) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve({
                    exitCode,
                    stdout,
                    stderr,
                });
            });
        });
    }

    private appendBoundedProcessOutput(current: string, chunk: unknown): string {
        const remainingBytes = QQ_FFMPEG_OUTPUT_MAX_BYTES - Buffer.byteLength(current, "utf8");
        if (remainingBytes <= 0) return current;
        return `${current}${Buffer.from(String(chunk)).subarray(0, remainingBytes).toString("utf8")}`;
    }

    private async transcodeAudioBufferToWav(
        buffer: Buffer,
        inputFileName: string,
        outputFileName: string,
    ): Promise<Buffer> {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-qq-amr-"));
        const tempCapability = new FilesystemCapability({
            rootPath: tempDir,
            label: "QQ voice transcode temporary directory",
            maxBytes: QQ_VOICE_MAX_BYTES,
        });
        try {
            const safeInputFileName = assertSafeFilesystemBasename(inputFileName || "voice.amr", "QQ voice input file name");
            const safeOutputFileName = assertSafeFilesystemBasename(outputFileName, "QQ voice output file name");
            if (safeInputFileName === safeOutputFileName) {
                throw new Error("QQ voice transcode input and output file names must differ.");
            }
            tempCapability.assertByteLength(buffer.length, "QQ voice input");
            const inputPath = tempCapability.resolveForWriteRelative(safeInputFileName, "QQ voice ffmpeg input");
            const outputPath = tempCapability.resolveForWriteRelative(safeOutputFileName, "QQ voice ffmpeg output");
            await fs.writeFile(inputPath, buffer);
            const result = await this.runCommand({
                command: this.readFfmpegCommand(),
                args: [
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    inputPath,
                    "-ar",
                    "16000",
                    "-ac",
                    "1",
                    outputPath,
                ],
                timeoutMs: QQ_VOICE_TRANSCODE_TIMEOUT_MS,
            });
            if (result.exitCode !== 0) {
                throw new Error(result.stderr || result.stdout || `ffmpeg exit=${result.exitCode ?? "null"}`);
            }
            const verifiedOutputPath = tempCapability.resolveExistingRelative(
                safeOutputFileName,
                "QQ voice ffmpeg output",
            );
            const outputStat = await fs.stat(verifiedOutputPath);
            if (!outputStat.isFile()) {
                throw new Error("QQ voice ffmpeg output is not a file.");
            }
            tempCapability.assertByteLength(outputStat.size, "QQ voice ffmpeg output");
            const outputBuffer = await fs.readFile(verifiedOutputPath);
            tempCapability.assertByteLength(outputBuffer.length, "QQ voice ffmpeg output");
            return outputBuffer;
        } finally {
            try {
                const removableTempDir = tempCapability.resolveForRemovalPath(
                    tempDir,
                    "QQ voice transcode temporary directory",
                    { allowRoot: true },
                );
                await fs.rm(removableTempDir, { recursive: true, force: true });
            } catch {
                // 临时目录已经丢失或被外部替换时不覆盖原始转码错误。
            }
        }
    }

    private async transcodeAmrBufferToWav(buffer: Buffer, fileName: string): Promise<Buffer> {
        const safeFileName = assertSafeFilesystemBasename(fileName || "voice.amr", "QQ voice input file name");
        const baseName = path.parse(safeFileName).name || "voice";
        return await this.transcodeAudioBufferToWav(buffer, safeFileName, `${baseName}.wav`);
    }

    private extractVoiceAttachment(message: any): {
        url: string;
        filename: string;
        mime?: string;
        wavUrl?: string;
    } | undefined {
        const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
        for (const attachment of attachments) {
            if (!attachment || typeof attachment !== "object") continue;
            const url = this.normalizeOptionalString((attachment as Record<string, unknown>).url);
            if (!url) continue;
            const contentType = this.normalizeOptionalString((attachment as Record<string, unknown>).content_type)
                ?? this.normalizeOptionalString((attachment as Record<string, unknown>).contentType);
            const filename = this.normalizeOptionalString((attachment as Record<string, unknown>).filename)
                ?? this.normalizeOptionalString((attachment as Record<string, unknown>).name)
                ?? "voice.amr";
            const wavUrl = this.normalizeOptionalString((attachment as Record<string, unknown>).voice_wav_url)
                ?? this.normalizeOptionalString((attachment as Record<string, unknown>).voiceWavUrl);
            const lowerName = filename.toLowerCase();
            if (contentType === "voice" || contentType?.startsWith("audio/") || lowerName.endsWith(".amr")) {
                const mime = contentType === "voice"
                    ? "audio/amr"
                    : contentType?.startsWith("audio/")
                        ? contentType
                        : lowerName.endsWith(".amr")
                            ? "audio/amr"
                            : undefined;
                return { url, filename, mime, wavUrl };
            }
        }
        return undefined;
    }

    private async downloadVoiceAttachmentBuffer(url: string, label: string): Promise<Buffer> {
        const buffer = await readBoundedMediaBuffer({
            url,
            label: `QQ voice attachment ${label}`,
            timeoutMs: QQ_VOICE_DOWNLOAD_TIMEOUT_MS,
            maxBytes: QQ_VOICE_MAX_BYTES,
        });
        console.log(`[${this.name}] Downloaded QQ voice attachment ${label}: ${buffer.length} bytes`);
        return buffer;
    }

    private detectVoiceBufferFormat(buffer: Buffer): "silk" | "wav" | undefined {
        if (buffer.length >= 9) {
            const headerAt0 = buffer.subarray(0, 9).toString("ascii");
            const headerAt1 = buffer.length >= 10 ? buffer.subarray(1, 10).toString("ascii") : "";
            if (headerAt0 === "#!SILK_V3" || headerAt1 === "#!SILK_V3") {
                return "silk";
            }
        }
        if (buffer.length >= 12
            && buffer.subarray(0, 4).toString("ascii") === "RIFF"
            && buffer.subarray(8, 12).toString("ascii") === "WAVE") {
            return "wav";
        }
        return undefined;
    }

    private normalizeSilkBufferForTranscode(buffer: Buffer): Buffer {
        if (buffer.length >= 10 && buffer.subarray(1, 10).toString("ascii") === "#!SILK_V3") {
            return buffer.subarray(1);
        }
        return buffer;
    }

    private getQqVoiceFallbackProviders(): string[] {
        const configured = (process.env.BELLDANDY_QQ_STT_FALLBACK_PROVIDERS ?? "")
            .split(",")
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean);
        if (configured.length > 0) {
            return Array.from(new Set(configured)).filter((provider) => this.hasConfiguredSttProvider(provider));
        }
        const primary = (process.env.BELLDANDY_STT_PROVIDER ?? "openai").trim().toLowerCase();
        return ["groq", "openai", "dashscope"].filter((provider) => provider !== primary && this.hasAutoFallbackSttProvider(provider));
    }

    private hasConfiguredSttProvider(provider: string): boolean {
        switch (provider) {
            case "groq":
                return Boolean(
                    process.env.BELLDANDY_STT_GROQ_API_KEY?.trim()
                    || process.env.GROQ_API_KEY?.trim(),
                );
            case "openai":
                return Boolean(
                    process.env.BELLDANDY_STT_OPENAI_API_KEY?.trim()
                    || process.env.OPENAI_API_KEY?.trim(),
                );
            case "dashscope":
                return Boolean(process.env.DASHSCOPE_API_KEY?.trim());
            default:
                return true;
        }
    }

    private hasAutoFallbackSttProvider(provider: string): boolean {
        switch (provider) {
            case "openai":
                return Boolean(process.env.BELLDANDY_STT_OPENAI_API_KEY?.trim());
            default:
                return this.hasConfiguredSttProvider(provider);
        }
    }

    private async tryTranscribeWithFallbackProviders(input: {
        buffer: Buffer;
        fileName: string;
        mime?: string;
        msgId: string;
        sourceLabel: string;
    }): Promise<string | undefined> {
        if (!this.sttTranscribe) {
            return undefined;
        }
        for (const provider of this.getQqVoiceFallbackProviders()) {
            try {
                console.warn(`[${this.name}] QQ voice ${input.sourceLabel} STT returned empty for ${input.msgId}, retrying with provider=${provider}...`);
                const result = await this.withTimeout(
                    this.sttTranscribe({
                        buffer: input.buffer,
                        fileName: input.fileName,
                        mime: input.mime,
                        provider,
                    }),
                    QQ_VOICE_STT_TIMEOUT_MS,
                    `QQ voice STT ${input.sourceLabel} fallback(${provider}) for ${input.msgId}`,
                );
                const text = this.normalizeOptionalString(result?.text);
                if (text) {
                    return text;
                }
            } catch {
                channelSafeLogger.warn({
                    channel: "qq",
                    event: "voice_fallback_transcription_failed",
                    messageId: input.msgId,
                    failureKind: "media_error",
                });
            }
        }
        return undefined;
    }

    private async transcribeVoiceBuffer(input: {
        buffer: Buffer;
        fileName: string;
        mime?: string;
        msgId: string;
        sourceLabel: string;
    }): Promise<string | undefined> {
        if (!this.sttTranscribe) {
            return undefined;
        }
        const result = await this.withTimeout(
            this.sttTranscribe({
                buffer: input.buffer,
                fileName: input.fileName,
                mime: input.mime,
            }),
            QQ_VOICE_STT_TIMEOUT_MS,
            `QQ voice STT ${input.sourceLabel} for ${input.msgId}`,
        );
        return this.normalizeOptionalString(result?.text);
    }

    private async normalizeVoiceBufferToWav(buffer: Buffer, fileName: string): Promise<Buffer> {
        const baseName = path.parse(fileName || "voice").name || "voice";
        return await this.transcodeAudioBufferToWav(
            buffer,
            fileName || "voice.wav",
            `${baseName}.normalized.wav`,
        );
    }

    private async transcribeVoiceAttachment(message: any, msgId: string): Promise<string | undefined> {
        const voiceAttachment = this.extractVoiceAttachment(message);
        if (!voiceAttachment || !this.sttTranscribe) {
            return undefined;
        }

        const originalFileName = assertSafeFilesystemBasename(
            voiceAttachment.filename || "voice.amr",
            "QQ voice attachment file name",
        );

        if (voiceAttachment.wavUrl) {
            console.log(`[${this.name}] Downloading QQ voice attachment WAV for ${msgId}: ${originalFileName}`);
            const wavBuffer = await this.downloadVoiceAttachmentBuffer(voiceAttachment.wavUrl, `${msgId} (wav)`);
            const wavFileName = `${path.parse(originalFileName).name}.wav`;
            const wavText = await this.transcribeVoiceBuffer({
                buffer: wavBuffer,
                fileName: wavFileName,
                mime: "audio/wav",
                msgId,
                sourceLabel: "WAV",
            });
            if (wavText) {
                return wavText;
            }
            try {
                console.warn(`[${this.name}] QQ voice WAV STT returned empty for ${msgId}, retrying after WAV normalization...`);
                const normalizedWavBuffer = await this.normalizeVoiceBufferToWav(wavBuffer, wavFileName);
                const normalizedText = await this.transcribeVoiceBuffer({
                    buffer: normalizedWavBuffer,
                    fileName: wavFileName,
                    mime: "audio/wav",
                    msgId,
                    sourceLabel: "normalized_wav",
                });
                if (normalizedText) {
                    return normalizedText;
                }
                const normalizedFallbackText = await this.tryTranscribeWithFallbackProviders({
                    buffer: normalizedWavBuffer,
                    fileName: wavFileName,
                    mime: "audio/wav",
                    msgId,
                    sourceLabel: "normalized_wav",
                });
                if (normalizedFallbackText) {
                    return normalizedFallbackText;
                }
            } catch {
                channelSafeLogger.warn({
                    channel: "qq",
                    event: "voice_normalization_failed",
                    messageId: msgId,
                    failureKind: "media_error",
                });
            }
            const wavFallbackText = await this.tryTranscribeWithFallbackProviders({
                buffer: wavBuffer,
                fileName: wavFileName,
                mime: "audio/wav",
                msgId,
                sourceLabel: "WAV",
            });
            if (wavFallbackText) {
                return wavFallbackText;
            }
            console.warn(`[${this.name}] QQ voice WAV STT returned empty for ${msgId}, skipping original attachment fallback because QQ raw voice is usually SILK_V3 and decoder support is unstable.`);
            return undefined;
        }

        console.log(`[${this.name}] Downloading QQ voice attachment for ${msgId}: ${originalFileName}`);
        const buffer = await this.downloadVoiceAttachmentBuffer(voiceAttachment.url, msgId);
        const detectedFormat = this.detectVoiceBufferFormat(buffer);
        if (detectedFormat === "silk" && !QQ_SILK_DECODER_SUPPORTED) {
            console.warn(`[${this.name}] QQ original voice attachment for ${msgId} is SILK_V3, but native silk decoding is disabled in the current runtime. Skipping raw attachment fallback.`);
            return undefined;
        }

        let firstPassText: string | undefined;
        try {
            firstPassText = await this.transcribeVoiceBuffer({
                buffer,
                fileName: originalFileName,
                mime: voiceAttachment.mime,
                msgId,
                sourceLabel: "original_attachment",
            });
            if (firstPassText) {
                return firstPassText;
            }
            if (voiceAttachment.mime !== "audio/amr" && detectedFormat !== "silk") {
                return undefined;
            }
            if (detectedFormat === "silk") {
                console.warn(`[${this.name}] QQ original voice attachment for ${msgId} is SILK_V3, retrying after SILK->WAV transcode...`);
            } else {
                console.warn(`[${this.name}] QQ voice STT returned empty for ${msgId}, retrying after AMR->WAV transcode...`);
            }
        } catch (error) {
            const messageText = error instanceof Error ? error.message : String(error);
            const shouldRetryAsWav = voiceAttachment.mime === "audio/amr" && /decode_error/i.test(messageText);
            if (!shouldRetryAsWav && detectedFormat !== "silk") {
                throw error;
            }
            if (detectedFormat === "silk") {
                console.warn(`[${this.name}] QQ original voice attachment decode failed for ${msgId}, retrying after SILK->WAV transcode...`);
            } else {
                console.warn(`[${this.name}] QQ voice STT decode failed for ${msgId}, retrying after AMR->WAV transcode...`);
            }
        }

        const transcodeSourceFileName = detectedFormat === "silk"
            ? `${path.parse(originalFileName).name}.silk`
            : originalFileName;
        const transcodeSourceBuffer = detectedFormat === "silk"
            ? this.normalizeSilkBufferForTranscode(buffer)
            : buffer;
        const wavBuffer = await this.transcodeAmrBufferToWav(transcodeSourceBuffer, transcodeSourceFileName);
        const wavFileName = `${path.parse(originalFileName).name}.wav`;
        return await this.transcribeVoiceBuffer({
            buffer: wavBuffer,
            fileName: wavFileName,
            mime: "audio/wav",
            msgId,
            sourceLabel: detectedFormat === "silk" ? "silk_transcode" : "amr_transcode",
        });
    }

    private async buildInboundText(message: any, msgId: string): Promise<string | undefined> {
        const content = this.normalizeOptionalString(message?.content);
        const voiceAttachment = this.extractVoiceAttachment(message);
        if (!voiceAttachment) {
            return content;
        }

        let transcript: string | undefined;
        try {
            transcript = await this.transcribeVoiceAttachment(message, msgId);
        } catch {
            channelSafeLogger.warn({
                channel: "qq",
                event: "voice_transcription_failed",
                messageId: msgId,
                failureKind: "media_error",
            });
        }

        if (content && transcript) {
            return `${content}\n\n${formatAudioTranscript(transcript)}`;
        }
        if (transcript) {
            return formatAudioTranscript(transcript);
        }
        if (content) {
            return content;
        }
        return `[用户发送了 QQ 语音消息: ${voiceAttachment.filename}]`;
    }

    private rememberReplyContext(chatId: string, replyContext: QqReplyContext): void {
        this.replyContextByChatId.set(chatId, replyContext);
    }

    private getReplyContext(chatId: string): QqReplyContext | undefined {
        return this.replyContextByChatId.get(chatId);
    }

    /**
     * 获取 AccessToken
     */
    private async fetchAccessToken(): Promise<void> {
        try {
            const response = await fetch("https://bots.qq.com/app/getAppAccessToken", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    appId: this.config.appId,
                    clientSecret: this.config.appSecret,
                }),
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Failed to fetch AccessToken: ${response.status} ${text}`);
            }

            const data = await response.json();
            if (!data.access_token) {
                throw new Error(`Invalid AccessToken response: ${JSON.stringify(data)}`);
            }

            this.accessToken = data.access_token;
            // 确保 expiresIn 至少为 60 秒，避免负数或过小值导致无限循环
            const rawExpiresIn = data.expires_in || 7200;
            const expiresIn = Math.max(60, rawExpiresIn - 300);
            this.tokenExpiresAt = Date.now() + expiresIn * 1000;

            console.log(`[${this.name}] AccessToken obtained, expires in ${expiresIn}s (raw: ${rawExpiresIn}s)`);
            this.scheduleTokenRefresh(expiresIn);
        } catch (error) {
            channelSafeLogger.error({
                channel: "qq",
                event: "access_token_fetch_failed",
                failureKind: "transport_error",
            });
            throw error;
        }
    }

    /**
     * 调度 Token 刷新
     */
    private scheduleTokenRefresh(expiresInSeconds: number): void {
        if (this.tokenRefreshTimer) {
            clearTimeout(this.tokenRefreshTimer);
        }

        // 确保至少等待 60 秒，避免无限循环
        const safeExpiresIn = Math.max(60, expiresInSeconds);

        this.tokenRefreshTimer = setTimeout(async () => {
            console.log(`[${this.name}] Refreshing AccessToken...`);
            try {
                await this.fetchAccessToken();
            } catch {
                channelSafeLogger.error({
                    channel: "qq",
                    event: "access_token_refresh_failed",
                    failureKind: "transport_error",
                });
                this.scheduleTokenRefresh(60);
            }
        }, safeExpiresIn * 1000);
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
    }

    private scheduleReconnect(delayMs: number): void {
        this.clearReconnectTimer();
        if (!this._running) {
            return;
        }
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            if (!this._running) {
                return;
            }
            void this.connectWebSocket().catch(() => {
                channelSafeLogger.error({
                    channel: "qq",
                    event: "websocket_reconnect_failed",
                    failureKind: "transport_error",
                });
                this.scheduleReconnect(delayMs);
            });
        }, delayMs);
    }

    /**
     * 获取 Gateway URL
     */
    private async fetchGatewayUrl(): Promise<string> {
        const baseUrl = this.config.sandbox
            ? "https://sandbox.api.sgroup.qq.com"
            : "https://api.sgroup.qq.com";

        const response = await fetch(`${baseUrl}/gateway/bot`, {
            headers: {
                Authorization: `QQBot ${this.accessToken}`,
                "Content-Type": "application/json",
            },
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Failed to fetch gateway URL: ${response.status} ${text}`);
        }

        const data = await response.json();
        if (!data.url) {
            throw new Error(`Invalid gateway response: ${JSON.stringify(data)}`);
        }

        return data.url;
    }

    /**
     * 建立 WebSocket 连接
     */
    private async connectWebSocket(): Promise<void> {
        if (!this.gatewayUrl) {
            this.gatewayUrl = await this.fetchGatewayUrl();
        }

        console.log(`[${this.name}] Connecting to ${this.gatewayUrl}`);

        this.ws = new WebSocket(this.gatewayUrl);

        this.ws.on("open", () => {
            this.clearReconnectTimer();
            this.suppressCloseReconnect = false;
            console.log(`[${this.name}] WebSocket connected`);
        });

        this.ws.on("message", (data: Buffer) => {
            try {
                const payload: WsPayload = JSON.parse(data.toString());
                // 记录所有收到的消息（除了心跳ACK）
                if (payload.op !== OpCode.HEARTBEAT_ACK) {
                    channelSafeLogger.info({
                        channel: "qq",
                        event: "ws_event_received",
                        messageId: typeof payload.id === "string" ? payload.id : undefined,
                        context: {
                            op: payload.op,
                            eventType: payload.t ?? "unknown",
                        },
                    });
                }
                void this.handleWsMessage(payload);
            } catch {
                channelSafeLogger.error({
                    channel: "qq",
                    event: "websocket_message_parse_failed",
                    failureKind: "invalid_input",
                });
            }
        });

        this.ws.on("close", (code, reason) => {
            console.log(`[${this.name}] WebSocket closed: ${code} ${reason.toString()}`);

            // 清理心跳定时器
            if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
                this.heartbeatInterval = undefined;
            }

            const shouldSuppressReconnect = this.suppressCloseReconnect;
            this.suppressCloseReconnect = false;
            if (!this._running) return;
            if (shouldSuppressReconnect) return;

            // 按 QQ 官方文档分类处理 close code:
            // https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/error-trace/websocket.html

            // 不可重连：配置/协议错误，需要开发者修复
            const FATAL_CODES = [4001, 4002, 4010, 4011, 4012, 4013, 4014, 4914, 4915];
            if (FATAL_CODES.includes(code)) {
                console.error(`[${this.name}] Fatal close code ${code}, will NOT reconnect. Fix config and restart.`);
                this._running = false;
                return;
            }

            // 4009: 连接过期，可 RESUME（保留 session）
            // 4008: 发送过快，可 RESUME（保留 session，稍等久一点）
            // 其他正常断开（1000/1001 等）：保留 session 尝试 RESUME

            // 4006/4007: session 或 seq 无效，不可 RESUME，需重新 IDENTIFY
            // 4900~4913: 内部错误，不可 RESUME，需重新 IDENTIFY
            if (code === 4006 || code === 4007 || (code >= 4900 && code <= 4913)) {
                console.log(`[${this.name}] Session invalidated (code: ${code}), will re-IDENTIFY on next connect`);
                this.sessionId = undefined;
                this.sequence = 0;
            }

            const delay = code === 4008 ? 10000 : 5000;
            console.log(`[${this.name}] Reconnecting in ${delay / 1000}s...`);
            this.scheduleReconnect(delay);
        });

        this.ws.on("error", () => {
            channelSafeLogger.error({
                channel: "qq",
                event: "websocket_error",
                failureKind: "transport_error",
            });
        });
    }

    /**
     * 处理 WebSocket 消息
     */
    private async handleWsMessage(payload: WsPayload): Promise<void> {
        const { op, d, s, t } = payload;

        // 更新序列号
        if (s !== undefined && s !== null) {
            this.sequence = s;
        }

        switch (op) {
            case OpCode.HELLO:
                // 收到 HELLO，判断是恢复会话还是新建会话
                if (this.sessionId && this.sequence > 0) {
                    this.sendResume();
                } else {
                    this.sendIdentify();
                }
                // 启动心跳
                if (d?.heartbeat_interval) {
                    this.startHeartbeat(d.heartbeat_interval);
                }
                break;

            case OpCode.DISPATCH:
                // 事件分发
                channelSafeLogger.info({
                    channel: "qq",
                    event: "dispatch_event",
                    context: { eventType: t ?? "unknown" },
                });
                if (t === "READY") {
                    this.sessionId = d.session_id;
                    console.log(`[${this.name}] Session ready: ${this.sessionId}`);
                } else if (t === "RESUMED") {
                    console.log(`[${this.name}] Session resumed successfully (seq: ${this.sequence})`);
                } else if (
                    t === "AT_MESSAGE_CREATE" ||
                    t === "MESSAGE_CREATE" ||
                    t === "DIRECT_MESSAGE_CREATE" ||
                    t === "C2C_MESSAGE_CREATE" ||
                    t === "GROUP_AT_MESSAGE_CREATE"
                ) {
                    if (this.isMessageDispatchEventType(t)) {
                        void this.withTimeout(
                            this.captureEventSample(payload, t, s),
                            QQ_EVENT_SAMPLE_CAPTURE_TIMEOUT_MS,
                            `QQ event sample capture (${t})`,
                        ).catch(() => {
                            channelSafeLogger.warn({
                                channel: "qq",
                                event: "event_sample_timeout",
                                context: { eventType: t },
                            });
                        });
                    }
                    await this.enqueueMessage(this.normalizeDispatchMessage(payload), t);
                } else {
                    console.log(`[${this.name}] Unhandled event type: ${t}`);
                }
                break;

            case OpCode.HEARTBEAT_ACK:
                // 心跳确认
                break;

            case OpCode.RECONNECT:
                // 服务端要求重连
                console.log(`[${this.name}] Server requested reconnect`);
                this.reconnect();
                break;

            case OpCode.INVALID_SESSION:
                // 无效会话，重新连接
                console.log(`[${this.name}] Invalid session, reconnecting...`);
                this.sessionId = undefined;
                this.sequence = 0;
                this.scheduleReconnect(5000);
                break;

            default:
                console.log(`[${this.name}] Unknown opcode: ${op}`);
        }
    }

    /**
     * 发送 IDENTIFY
     */
    private sendIdentify(): void {
        const intents =
            Intents.GUILDS |
            Intents.GUILD_MESSAGES |
            Intents.DIRECT_MESSAGE |
            Intents.GROUP_AND_C2C_EVENT |
            Intents.PUBLIC_GUILD_MESSAGES;

        const payload: WsPayload = {
            op: OpCode.IDENTIFY,
            d: {
                token: `QQBot ${this.accessToken}`,
                intents,
                shard: [0, 1],
                properties: {
                    $os: "linux",
                    $browser: "belldandy",
                    $device: "belldandy",
                },
            },
        };

        this.ws?.send(JSON.stringify(payload));
        console.log(`[${this.name}] Sent IDENTIFY`);
    }

    /**
     * 发送 RESUME（恢复会话）
     */
    private sendResume(): void {
        const payload: WsPayload = {
            op: OpCode.RESUME,
            d: {
                token: `QQBot ${this.accessToken}`,
                session_id: this.sessionId,
                seq: this.sequence,
            },
        };

        this.ws?.send(JSON.stringify(payload));
        console.log(`[${this.name}] Sent RESUME (session: ${this.sessionId}, seq: ${this.sequence})`);
    }

    /**
     * 启动心跳
     */
    private startHeartbeat(interval: number): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        this.heartbeatInterval = setInterval(() => {
            const payload: WsPayload = {
                op: OpCode.HEARTBEAT,
                d: this.sequence,
            };
            this.ws?.send(JSON.stringify(payload));
        }, interval);

        console.log(`[${this.name}] Heartbeat started (interval: ${interval}ms)`);
    }

    /**
     * 重连
     */
    private reconnect(): void {
        this.suppressCloseReconnect = true;
        this.clearReconnectTimer();
        if (this.ws) {
            this.ws.close();
        }
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = undefined;
        }
        this.scheduleReconnect(1000);
    }

    /**
     * 处理消息
     */
    /** Gateway dispatch keeps its existing handler, but bounded scheduling owns its execution slot. */
    private async enqueueMessage(message: any, eventType: string): Promise<void> {
        const messageId = typeof message?.id === "string" ? message.id : "";
        const chatId = this.resolveChatId(message);
        if (!messageId || !chatId) {
            await this.handleMessage(message, eventType);
            return;
        }
        const chatKind = this.inferChatKind(eventType);
        const senderId = typeof message.author?.id === "string" ? message.author.id : undefined;
        const session = buildChannelSessionDescriptor({
            channel: "qq",
            chatKind,
            chatId,
            senderId,
        });
        const scheduled = this.ingressScheduler.enqueue({
            channel: this.name,
            // QQ ConversationStore state remains chat-scoped, including group and channel conversations.
            sessionKey: session.legacyConversationId,
            dedupeKey: messageId,
            payloadBytes: Buffer.byteLength(typeof message.content === "string" ? message.content : "", "utf8"),
            run: () => this.handleMessage(message, eventType),
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

    private async handleMessage(message: any, eventType: string): Promise<void> {
        if (!message || !message.id) return;

        const msgId = message.id;

        // 去重
        if (this.processedMessages.has(msgId)) {
            return;
        }
        this.processedMessages.add(msgId);
        if (this.processedMessages.size > this.MESSAGE_CACHE_SIZE) {
            const first = this.processedMessages.values().next().value;
            if (first !== undefined) {
                this.processedMessages.delete(first);
            }
        }

        // 忽略机器人自己的消息
        if (message.author?.bot) {
            return;
        }

        const chatId = this.resolveChatId(message);
        if (!chatId) {
            console.warn(`[${this.name}] Unable to resolve chat ID for message ${msgId}`);
            return;
        }

        const chatKind = this.inferChatKind(eventType);
        const mentions = eventType.includes("_AT_") ? ["__mention__"] : [];
        const mentioned = chatKind === "dm" ? true : mentions.length > 0;
        const senderId = typeof message.author?.id === "string" ? message.author.id : undefined;
        const session = buildChannelSessionDescriptor({
            channel: "qq",
            chatKind,
            chatId,
            senderId,
        });
        const ingressDecision = this.router?.admitIngress?.({
            channel: "qq",
            chatKind,
            chatId,
            sessionScope: session.sessionScope,
            sessionKey: session.sessionKey,
            text: "",
            senderId,
            senderName: typeof message.author?.username === "string" ? message.author.username : undefined,
            mentions,
            mentioned,
            eventType,
        });
        if (ingressDecision && !ingressDecision.allow) {
            if (ingressDecision.reason === "channel_security:dm_allowlist_blocked" && chatKind === "dm" && senderId) {
                void this.onChannelSecurityApprovalRequired?.({
                    channel: "qq",
                    senderId,
                    senderName: typeof message.author?.username === "string" ? message.author.username : undefined,
                    chatId,
                    chatKind: "dm",
                    messagePreview: "",
                });
            }
            console.log(`[${this.name}] Ingress blocked before media handling for ${msgId} (${ingressDecision.reason})`);
            return;
        }

        const content = await this.buildInboundText(message, msgId);
        if (!content) return;

        channelSafeLogger.info({
            channel: "qq",
            event: "message_received",
            messageId: msgId,
            body: content,
        });

        const replyContext: QqReplyContext = {
            channelId: message.channel_id,
            guildId: message.guild_id,
            groupOpenId: message.group_openid,
            userOpenId: message.author?.id,
            messageId: message.id,
            eventType,
        };
        this.rememberReplyContext(chatId, replyContext);

        const decision = this.router
            ? this.router.decide({
                channel: "qq",
                chatKind,
                chatId,
                sessionScope: session.sessionScope,
                sessionKey: session.sessionKey,
                text: content,
                senderId,
                senderName: typeof message.author?.username === "string" ? message.author.username : undefined,
                mentions,
                mentioned,
                eventType,
            })
            : {
                allow: true,
                reason: "router_unavailable",
                agentId: this.agentId ?? this.defaultAgentId,
            };

        if (!decision.allow) {
            if (decision.reason === "channel_security:dm_allowlist_blocked" && chatKind === "dm") {
                const senderId = typeof message.author?.id === "string" ? message.author.id : "";
                if (senderId) {
                    void this.onChannelSecurityApprovalRequired?.({
                        channel: "qq",
                        senderId,
                        senderName: typeof message.author?.username === "string" ? message.author.username : undefined,
                        chatId,
                        chatKind: "dm",
                        messagePreview: createChannelApprovalPreview(content),
                    });
                }
            }
            console.log(`[${this.name}] Route blocked message ${msgId} (${decision.reason})`);
            return;
        }

        const selectedAgentId = decision.agentId ?? this.agentId ?? this.defaultAgentId;
        const runAgent = this.resolveAgent(selectedAgentId);
        console.log(`[${this.name}] Route decision for ${msgId}: allow=${decision.allow}, rule=${decision.matchedRuleId ?? "default"}, agent=${selectedAgentId ?? "default"}`);
        await this.currentConversationBindingStore?.upsert({
            channel: "qq",
            sessionKey: session.sessionKey,
            sessionScope: session.sessionScope,
            legacyConversationId: session.legacyConversationId,
            chatKind,
            chatId,
            ...(session.peerId ? { peerId: session.peerId } : {}),
            updatedAt: Date.now(),
            target: {
                chatId,
                ...(replyContext.channelId ? { channelId: replyContext.channelId } : {}),
                ...(replyContext.guildId ? { guildId: replyContext.guildId } : {}),
                ...(replyContext.groupOpenId ? { groupOpenId: replyContext.groupOpenId } : {}),
                ...(replyContext.userOpenId ? { userOpenId: replyContext.userOpenId } : {}),
                ...(replyContext.messageId ? { messageId: replyContext.messageId } : {}),
                eventType: replyContext.eventType,
            },
        });

        // 获取或创建会话
        const conversationId = session.legacyConversationId;

        // 添加用户消息到会话历史
        this.conversationStore.addMessage(conversationId, "user", content, {
            agentId: selectedAgentId,
            channel: this.name,
        });

        // 获取会话历史
        const history = this.conversationStore.getHistory(conversationId);

        // 调用 Agent 处理
        try {
            for await (const item of runAgent.run({
                conversationId,
                text: content,
                history,
                meta: {
                    eventType,
                    channel: this.name,
                    agentId: selectedAgentId,
                    sessionScope: session.sessionScope,
                    sessionKey: session.sessionKey,
                    legacyConversationId: session.legacyConversationId,
                },
            })) {
                if (item.type === "final") {
                    await this.sendReply(item.text, replyContext);
                    // 添加助手回复到会话历史
                    this.conversationStore.addMessage(conversationId, "assistant", item.text, {
                        agentId: selectedAgentId,
                        channel: this.name,
                    });
                }
            }
        } catch {
            channelSafeLogger.error({
                channel: "qq",
                event: "agent_failed",
                messageId: msgId,
                failureKind: "internal_error",
            });
            await this.sendReply("抱歉，处理消息时出错了。", replyContext);
        }
    }

    /**
     * 发送回复
     */
    private async sendReply(content: string, replyContext: QqReplyContext): Promise<void> {
        if (!replyContext) {
            console.warn(`[${this.name}] No reply context available`);
            return;
        }

        const { channelId, guildId, groupOpenId, userOpenId, messageId, eventType } = replyContext;

        try {
            const baseUrl = this.config.sandbox
                ? "https://sandbox.api.sgroup.qq.com"
                : "https://api.sgroup.qq.com";

            let url: string;
            let body: any;

            if (eventType === "DIRECT_MESSAGE_CREATE") {
                // 频道私信回复
                url = `${baseUrl}/dms/${guildId}/messages`;
                body = {
                    content,
                    msg_id: messageId,
                };
            } else if (eventType === "C2C_MESSAGE_CREATE") {
                // 单聊回复 (API v2)
                url = `${baseUrl}/v2/users/${userOpenId}/messages`;
                body = {
                    content,
                    msg_type: 0,
                    msg_id: messageId,
                };
            } else if (eventType === "GROUP_AT_MESSAGE_CREATE") {
                // 群聊回复 (API v2)
                url = `${baseUrl}/v2/groups/${groupOpenId}/messages`;
                body = {
                    content,
                    msg_type: 0,
                    msg_id: messageId,
                };
            } else {
                // 频道回复
                url = `${baseUrl}/channels/${channelId}/messages`;
                body = {
                    content,
                    msg_id: messageId,
                };
            }

            const chunks = chunkMarkdownForOutbound(content, "qq", {
                config: this.replyChunkingConfig,
            });
            for (const chunk of chunks) {
                const response = await fetch(url, {
                    method: "POST",
                    headers: {
                        Authorization: `QQBot ${this.accessToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        ...body,
                        content: chunk,
                    }),
                });

                if (!response.ok) {
                    const text = await response.text();
                    throw new Error(`Failed to send message: ${response.status} ${text}`);
                }
            }

            console.log(`[${this.name}] Message sent successfully`);
        } catch {
            channelSafeLogger.error({
                channel: "qq",
                event: "reply_failed",
                failureKind: "transport_error",
            });
        }
    }

    async start(): Promise<void> {
        if (this._running) return;

        // 获取 AccessToken
        await this.fetchAccessToken();

        // 连接 WebSocket
        await this.connectWebSocket();

        this._running = true;
        console.log(`[${this.name}] WebSocket Channel started. (Sandbox: ${this.config.sandbox ?? true})`);
    }

    async stop(): Promise<void> {
        if (!this._running) return;

        this._running = false;
        this.ingressScheduler.cancelChannel(this.name);
        this.suppressCloseReconnect = false;

        // 清理定时器
        if (this.tokenRefreshTimer) {
            clearTimeout(this.tokenRefreshTimer);
            this.tokenRefreshTimer = undefined;
        }
        this.clearReconnectTimer();
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = undefined;
        }

        // 关闭 WebSocket
        if (this.ws) {
            this.ws.close();
            this.ws = undefined;
        }

        this.processedMessages.clear();
        this.replyContextByChatId.clear();
        console.log(`[${this.name}] Channel stopped.`);
    }

    async sendProactiveMessage(content: string, target?: ChannelProactiveTarget): Promise<boolean> {
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
        if (explicitSessionKey && directBinding && directBinding.channel !== "qq") {
            console.warn(`[${this.name}] Cannot send proactive message - sessionKey channel mismatch: ${directBinding.channel}`);
            return false;
        }
        const fallbackBinding = !explicitChatId && !directBinding
            ? await this.currentConversationBindingStore?.getLatestByChannel({ channel: "qq" })
            : undefined;
        const targetChatId = directBinding?.chatId
            || explicitChatId
            || fallbackBinding?.chatId;
        const directTargetContext = directBinding?.target
            ? {
                channelId: directBinding.target.channelId,
                guildId: directBinding.target.guildId,
                groupOpenId: directBinding.target.groupOpenId,
                userOpenId: directBinding.target.userOpenId,
                messageId: directBinding.target.messageId,
                eventType: directBinding.target.eventType || "MESSAGE_CREATE",
            }
            : undefined;
        const fallbackTargetContext = fallbackBinding?.target
            ? {
                channelId: fallbackBinding.target.channelId,
                guildId: fallbackBinding.target.guildId,
                groupOpenId: fallbackBinding.target.groupOpenId,
                userOpenId: fallbackBinding.target.userOpenId,
                messageId: fallbackBinding.target.messageId,
                eventType: fallbackBinding.target.eventType || "MESSAGE_CREATE",
            }
            : undefined;
        const targetContext = directTargetContext
            ?? (explicitChatId ? this.getReplyContext(explicitChatId) : undefined)
            ?? fallbackTargetContext;
        if (!targetChatId || !isQqReplyContextResolved(targetContext)) {
            console.warn(`[${this.name}] Cannot send proactive message - no binding-backed target chat ID found.`);
            return false;
        }

        try {
            await this.sendReply(content, targetContext);
            console.log(`[${this.name}] Proactive message sent to ${targetChatId}`);
            return true;
        } catch {
            channelSafeLogger.error({
                channel: "qq",
                event: "proactive_send_failed",
                failureKind: "transport_error",
            });
            return false;
        }
    }
}
