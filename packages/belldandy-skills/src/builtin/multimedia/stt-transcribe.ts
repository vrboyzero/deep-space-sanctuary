/**
 * STT（语音转文字）转录模块
 *
 * 与 tts-synthesize.ts 对称设计，支持多 Provider：
 * - OpenAI Whisper (whisper-1)
 * - Groq Whisper  (whisper-large-v3-turbo，OpenAI 兼容接口)
 * - DashScope Paraformer (paraformer-v2，阿里云原生异步 API)
 *
 * 环境变量：
 *   BELLDANDY_STT_PROVIDER         - openai | groq | dashscope (默认 openai)
 *   BELLDANDY_STT_MODEL            - STT 模型名（按 provider 生效，可选）
 *   BELLDANDY_STT_LANGUAGE         - 语言提示 (默认 zh)
 *   BELLDANDY_STT_OPENAI_API_KEY   - OpenAI STT 专用 Key（可选，优先于 OPENAI_API_KEY）
 *   BELLDANDY_STT_OPENAI_BASE_URL  - OpenAI STT 专用 Base URL（可选，优先于 OPENAI_BASE_URL）
 *   BELLDANDY_STT_GROQ_API_KEY     - Groq 专用 Key
 *   BELLDANDY_STT_GROQ_BASE_URL    - Groq Base URL (默认 https://api.groq.com/openai/v1)
 *   DASHSCOPE_API_KEY              - 复用 TTS 的 DashScope Key
 */

import OpenAI, { toFile } from "openai";
import {
    isAbortError,
    raceWithAbort,
    sleepWithAbort,
    throwIfAborted,
    toAbortError,
} from "../../abort-utils.js";
import {
    createMediaFingerprint,
    readCachedAudioTranscription,
    runMediaUnderstandingCacheSingleFlight,
    writeCachedAudioTranscription,
} from "./understanding-cache.js";

// ─── 类型定义 ───────────────────────────────────────────────

export type TranscribeOptions = {
    /** 音频二进制数据 */
    buffer: Buffer;
    /** 文件名（用于推断格式，例如 "recording.webm"） */
    fileName: string;
    /** MIME 类型 (例如 "audio/webm") */
    mime?: string;
    /** Provider 覆盖 (默认读 BELLDANDY_STT_PROVIDER) */
    provider?: string;
    /** 模型覆盖（默认按 provider 读 BELLDANDY_STT_MODEL 或内置默认值） */
    model?: string;
    /** 语言提示，ISO 639-1 (例如 "zh", "en") */
    language?: string;
    /** 上下文提示词，帮助提高识别准确率 */
    prompt?: string;
    /** 协作式中断信号 */
    abortSignal?: AbortSignal;
};

export type TranscribeResult = {
    /** 转写后的文本 */
    text: string;
    /** 实际使用的 Provider */
    provider: string;
    /** 实际使用的模型 */
    model: string;
    /** 音频时长（秒），部分 Provider 可能不返回 */
    durationSec?: number;
};

export type TranscribeWithCacheResult = {
    result: TranscribeResult | null;
    cacheHit: boolean;
    fingerprint: string;
};

type TranscriptionResponse = {
    text: string;
    durationSec?: number;
};

// ─── 主入口 ─────────────────────────────────────────────────

/**
 * 语音转文字转录入口函数
 * 根据 Provider 配置选择对应的转录引擎
 *
 * @returns 转录结果，失败时返回 null
 */
export async function transcribeSpeech(
    opts: TranscribeOptions,
): Promise<TranscribeResult | null> {
    if (!opts.buffer || opts.buffer.length === 0) {
        console.warn("[STT] 空音频 buffer，跳过转录");
        return null;
    }
    throwIfAborted(opts.abortSignal);

    const envProvider = process.env.BELLDANDY_STT_PROVIDER?.trim().toLowerCase();
    const provider = opts.provider?.trim().toLowerCase() || envProvider || "openai";
    const language =
        opts.language?.trim() ||
        process.env.BELLDANDY_STT_LANGUAGE?.trim() ||
        "zh";
    const model = resolveSttModel(provider, opts.model);

    try {
        switch (provider) {
            case "groq":
                return await transcribeGroq(opts.buffer, opts.fileName, language, model, opts.prompt, opts.abortSignal);
            case "dashscope":
                return await transcribeDashScope(opts.buffer, opts.fileName, language, model, opts.prompt, opts.abortSignal);
            case "openai":
            default:
                return await transcribeOpenAI(opts.buffer, opts.fileName, language, model, opts.prompt, opts.abortSignal);
        }
    } catch (err) {
        if (isAbortError(err) || opts.abortSignal?.aborted) {
            throw toAbortError(opts.abortSignal?.reason);
        }
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[STT] Provider "${provider}" 转录失败:`, msg);
        return null;
    }
}

export async function transcribeSpeechWithCache(
    input: TranscribeOptions & {
        stateDir: string;
        transcribe?: (opts: TranscribeOptions) => Promise<TranscribeResult | null>;
    },
): Promise<TranscribeWithCacheResult> {
    const fingerprint = createMediaFingerprint({
        buffer: input.buffer,
        mime: input.mime,
    });
    const cached = await readCachedAudioTranscription({
        stateDir: input.stateDir,
        fingerprint,
    });
    if (cached?.result) {
        return {
            result: cached.result,
            cacheHit: true,
            fingerprint,
        };
    }

    const flight = await runMediaUnderstandingCacheSingleFlight({
        stateDir: input.stateDir,
        kind: "audio-transcription",
        fingerprint,
        waitSignal: input.abortSignal,
        operation: async () => {
            const cachedAfterJoin = await readCachedAudioTranscription({
                stateDir: input.stateDir,
                fingerprint,
            });
            if (cachedAfterJoin?.result) {
                return { result: cachedAfterJoin.result, cacheHit: true };
            }

            const result = await (input.transcribe ?? transcribeSpeech)({
                buffer: input.buffer,
                fileName: input.fileName,
                mime: input.mime,
                provider: input.provider,
                model: input.model,
                language: input.language,
                prompt: input.prompt,
                abortSignal: input.abortSignal,
            });
            if (result?.text) {
                await writeCachedAudioTranscription({
                    stateDir: input.stateDir,
                    fingerprint,
                    mime: input.mime,
                    result,
                });
            }
            return { result, cacheHit: false };
        },
    });
    return {
        result: flight.value.result,
        cacheHit: flight.joined || flight.value.cacheHit,
        fingerprint,
    };
}

// ─── OpenAI Whisper ─────────────────────────────────────────

async function transcribeOpenAI(
    buffer: Buffer,
    fileName: string,
    language: string,
    model: string,
    prompt?: string,
    abortSignal?: AbortSignal,
): Promise<TranscribeResult> {
    const apiKey =
        process.env.BELLDANDY_STT_OPENAI_API_KEY?.trim()
        || process.env.OPENAI_API_KEY?.trim();
    const baseURL =
        process.env.BELLDANDY_STT_OPENAI_BASE_URL?.trim()
        || process.env.OPENAI_BASE_URL?.trim();
    if (!apiKey) {
        throw new Error("BELLDANDY_STT_OPENAI_API_KEY 或 OPENAI_API_KEY 未设置，无法使用 OpenAI STT");
    }

    throwIfAborted(abortSignal);
    console.info(`[STT] OpenAI request target: baseURL=${baseURL || "default"}, model=${model}, fileName=${fileName}`);
    const openai = new OpenAI({ apiKey, baseURL });

    // OpenAI SDK 接受 File 对象用于 multipart/form-data 上传
    const file = await bufferToUploadable(buffer, fileName);

    const response = await raceWithAbort(
        (openai.audio.transcriptions.create as any)({
            model,
            file,
            language,
            prompt: prompt || undefined,
            response_format: "verbose_json",
        }, {
            signal: abortSignal,
        }),
        abortSignal,
    );
    const parsed = parseTranscriptionResponse(response);

    return {
        text: parsed.text,
        provider: "openai",
        model,
        durationSec: parsed.durationSec,
    };
}

// ─── Groq Whisper (OpenAI 兼容) ────────────────────────────

async function transcribeGroq(
    buffer: Buffer,
    fileName: string,
    language: string,
    model: string,
    prompt?: string,
    abortSignal?: AbortSignal,
): Promise<TranscribeResult> {
    // Groq 使用 OpenAI 兼容接口，只需换 apiKey 和 baseURL
    const apiKey =
        process.env.BELLDANDY_STT_GROQ_API_KEY?.trim() ||
        process.env.GROQ_API_KEY?.trim();
    const baseURL =
        process.env.BELLDANDY_STT_GROQ_BASE_URL?.trim() ||
        "https://api.groq.com/openai/v1";

    if (!apiKey) throw new Error("BELLDANDY_STT_GROQ_API_KEY 或 GROQ_API_KEY 未设置");

    throwIfAborted(abortSignal);
    const openai = new OpenAI({ apiKey, baseURL });

    const file = await bufferToUploadable(buffer, fileName);

    const response = await raceWithAbort(
        (openai.audio.transcriptions.create as any)({
            model,
            file,
            language,
            prompt: prompt || undefined,
            response_format: "verbose_json",
        }, {
            signal: abortSignal,
        }),
        abortSignal,
    );
    const parsed = parseTranscriptionResponse(response);

    return {
        text: parsed.text,
        provider: "groq",
        model,
        durationSec: parsed.durationSec,
    };
}

// ─── DashScope Paraformer (原生异步 API + data URI) ─────────

async function transcribeDashScope(
    buffer: Buffer,
    fileName: string,
    language: string,
    model: string,
    prompt?: string,
    abortSignal?: AbortSignal,
): Promise<TranscribeResult> {
    const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
    if (!apiKey) throw new Error("DASHSCOPE_API_KEY 未设置，无法使用 DashScope STT");

    throwIfAborted(abortSignal);
    const submitUrl =
        "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription";

    const mime = guessMime(fileName);
    const dataUri = `data:${mime};base64,${buffer.toString("base64")}`;

    const submitRes = await fetch(submitUrl, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
        },
        body: JSON.stringify({
            model,
            input: {
                file_urls: [dataUri],
            },
            parameters: {
                language_hints: [language === "zh" ? "zh" : language],
            },
        }),
        signal: abortSignal,
    });

    if (!submitRes.ok) {
        const errText = await submitRes.text();
        throw new Error(`DashScope 提交失败 (${submitRes.status}): ${errText}`);
    }

    const submitData: any = await submitRes.json();
    const taskId = submitData?.output?.task_id || submitData?.task_id;

    if (!taskId) {
        throw new Error(
            `DashScope 返回中无 task_id: ${JSON.stringify(submitData).slice(0, 200)}`,
        );
    }

    const text = await pollDashScopeResult(apiKey, taskId, abortSignal);

    return {
        text: text.trim(),
        provider: "dashscope",
        model,
    };
}

/**
 * 轮询 DashScope 异步任务结果
 * 最多等待 60 秒
 */
async function pollDashScopeResult(
    apiKey: string,
    taskId: string,
    abortSignal?: AbortSignal,
): Promise<string> {
    const pollUrl = `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`;
    const maxWaitMs = 60_000;
    const pollIntervalMs = 2000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
        await sleepWithAbort(pollIntervalMs, abortSignal);

        const res = await fetch(pollUrl, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: abortSignal,
        });

        if (!res.ok) {
            throw new Error(`DashScope 轮询失败 (${res.status}): ${await res.text()}`);
        }

        const data: any = await res.json();
        const status = data?.output?.task_status || data?.status;

        if (status === "SUCCEEDED") {
            const results = data?.output?.results;
            if (Array.isArray(results) && results.length > 0) {
                const transcriptionUrl = results[0]?.transcription_url;
                if (transcriptionUrl) {
                    const trRes = await fetch(transcriptionUrl, { signal: abortSignal });
                    if (trRes.ok) {
                        const trData: any = await trRes.json();
                        const transcripts = trData?.transcripts || trData?.result?.transcripts;
                        if (Array.isArray(transcripts) && transcripts.length > 0) {
                            return transcripts.map((t: any) => t.text || "").join(" ");
                        }
                    }
                }
                const directText = results[0]?.text;
                if (directText) return directText;
            }

            if (data?.output?.text) return data.output.text;

            throw new Error(
                `DashScope 任务完成但未找到转录文本: ${JSON.stringify(data?.output || {}).slice(0, 300)}`,
            );
        }

        if (status === "FAILED") {
            const errMsg = data?.output?.message || data?.message || "未知错误";
            throw new Error(`DashScope 转录任务失败: ${errMsg}`);
        }
    }

    throw new Error(`DashScope 转录超时 (${maxWaitMs / 1000}s)`);
}

// ─── 工具函数 ───────────────────────────────────────────────

/**
 * 将 Buffer 包装为 OpenAI SDK 可用的 Uploadable 对象
 * 使用 OpenAI SDK 内置的 toFile 工具函数
 */
async function bufferToUploadable(buffer: Buffer, fileName: string): Promise<any> {
    const mime = guessMime(fileName);
    return toFile(buffer, fileName, { type: mime });
}

/**
 * 根据文件名推断 MIME 类型
 */
function guessMime(fileName: string): string {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    const map: Record<string, string> = {
        webm: "audio/webm",
        ogg: "audio/ogg",
        mp3: "audio/mpeg",
        wav: "audio/wav",
        m4a: "audio/mp4",
        aac: "audio/aac",
        flac: "audio/flac",
        mp4: "audio/mp4",
    };
    return map[ext] || "audio/webm";
}

function parseTranscriptionResponse(response: unknown): TranscriptionResponse {
    if (!response || typeof response !== "object") {
        return { text: "" };
    }
    const candidate = response as { text?: unknown; duration?: unknown };
    return {
        text: typeof candidate.text === "string" ? candidate.text.trim() : "",
        durationSec: typeof candidate.duration === "number" ? candidate.duration : undefined,
    };
}

function resolveSttModel(provider: string, explicitModel?: string): string {
    const configuredModel = explicitModel?.trim() || process.env.BELLDANDY_STT_MODEL?.trim();
    if (configuredModel) {
        return configuredModel;
    }
    switch (provider) {
        case "groq":
            return "whisper-large-v3-turbo";
        case "dashscope":
            return "paraformer-v2";
        case "openai":
        default:
            return "whisper-1";
    }
}
