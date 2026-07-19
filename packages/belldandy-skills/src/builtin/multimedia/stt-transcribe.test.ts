import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, it, expect, vi, beforeEach } from "vitest";
import { transcribeSpeech, transcribeSpeechWithCache } from "./stt-transcribe.js";

// Mock OpenAI
const mockOpenAI = {
    audio: {
        transcriptions: {
            create: vi.fn(),
        },
    },
};

vi.mock("openai", () => {
    return {
        default: vi.fn(() => mockOpenAI),
        toFile: vi.fn(async (buf, name) => ({ name, type: "audio/mock" })),
    };
});

// Mock fetch for DashScope
global.fetch = vi.fn();

describe("stt-transcribe", () => {
    const mockBuffer = Buffer.from("mock-audio");

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.BELLDANDY_STT_PROVIDER = "";
        process.env.BELLDANDY_STT_MODEL = "";
        process.env.BELLDANDY_STT_OPENAI_API_KEY = "";
        process.env.BELLDANDY_STT_OPENAI_BASE_URL = "";
        process.env.OPENAI_API_KEY = "sk-mock";
        process.env.OPENAI_BASE_URL = "";
        process.env.DASHSCOPE_API_KEY = "sk-dashscope";
        process.env.BELLDANDY_STT_GROQ_API_KEY = "";
    });

    it("should use OpenAI by default", async () => {
        mockOpenAI.audio.transcriptions.create.mockResolvedValueOnce({
            text: "OpenAI Result",
            duration: 1.5,
        });

        const result = await transcribeSpeech({
            buffer: mockBuffer,
            fileName: "test.mp3",
        });

        expect(result).toEqual({
            text: "OpenAI Result",
            provider: "openai",
            model: "whisper-1",
            durationSec: 1.5,
        });
        expect(mockOpenAI.audio.transcriptions.create).toHaveBeenCalledWith(
            expect.objectContaining({ model: "whisper-1" }),
            expect.objectContaining({ signal: undefined }),
        );
    });

    it("should prefer dedicated OpenAI STT credentials when configured", async () => {
        process.env.BELLDANDY_STT_OPENAI_API_KEY = "sk-stt";
        process.env.BELLDANDY_STT_OPENAI_BASE_URL = "https://audio.example.test/v1";

        mockOpenAI.audio.transcriptions.create.mockResolvedValueOnce({
            text: "OpenAI STT Dedicated Result",
            duration: 2.1,
        });

        const result = await transcribeSpeech({
            buffer: mockBuffer,
            fileName: "test.mp3",
            provider: "openai",
        });

        expect(result).toEqual({
            text: "OpenAI STT Dedicated Result",
            provider: "openai",
            model: "whisper-1",
            durationSec: 2.1,
        });
    });

    it("should use Groq when configured", async () => {
        process.env.BELLDANDY_STT_PROVIDER = "groq";
        process.env.BELLDANDY_STT_GROQ_API_KEY = "gsk-mock";

        mockOpenAI.audio.transcriptions.create.mockResolvedValueOnce({
            text: "Groq Result",
            duration: 0.5,
        });

        const result = await transcribeSpeech({
            buffer: mockBuffer,
            fileName: "test.webm",
        });

        expect(result).toEqual({
            text: "Groq Result",
            provider: "groq",
            model: "whisper-large-v3-turbo",
            durationSec: 0.5,
        });
    });

    it("should use DashScope when configured", async () => {
        process.env.BELLDANDY_STT_PROVIDER = "dashscope";

        // 1. Submit task
        (fetch as any).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ output: { task_id: "task-123" } }),
        });

        // 2. Poll result (Success)
        (fetch as any).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                output: {
                    task_status: "SUCCEEDED",
                    results: [{ text: "DashScope Result" }]
                }
            }),
        });

        const result = await transcribeSpeech({
            buffer: mockBuffer,
            fileName: "test.wav",
        });

        expect(result).toEqual({
            text: "DashScope Result",
            provider: "dashscope",
            model: "paraformer-v2",
        });
    });

    it("should use BELLDANDY_STT_MODEL across providers", async () => {
        process.env.BELLDANDY_STT_MODEL = "shared-stt-model";

        mockOpenAI.audio.transcriptions.create.mockResolvedValueOnce({
            text: "Shared OpenAI Result",
            duration: 1.2,
        });

        const openAiResult = await transcribeSpeech({
            buffer: mockBuffer,
            fileName: "test.mp3",
        });

        expect(openAiResult).toEqual({
            text: "Shared OpenAI Result",
            provider: "openai",
            model: "shared-stt-model",
            durationSec: 1.2,
        });
        expect(mockOpenAI.audio.transcriptions.create).toHaveBeenLastCalledWith(
            expect.objectContaining({ model: "shared-stt-model" }),
            expect.objectContaining({ signal: undefined }),
        );

        process.env.BELLDANDY_STT_PROVIDER = "dashscope";
        (fetch as any).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ output: { task_id: "task-456" } }),
        });
        (fetch as any).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                output: {
                    task_status: "SUCCEEDED",
                    results: [{ text: "Shared DashScope Result" }],
                },
            }),
        });

        const dashscopeResult = await transcribeSpeech({
            buffer: mockBuffer,
            fileName: "test.wav",
        });

        expect(dashscopeResult).toEqual({
            text: "Shared DashScope Result",
            provider: "dashscope",
            model: "shared-stt-model",
        });
        const submitPayload = JSON.parse((fetch as any).mock.calls[0]?.[1]?.body as string);
        expect(submitPayload.model).toBe("shared-stt-model");
    });

    it("should handle empty buffer", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const result = await transcribeSpeech({
                buffer: Buffer.alloc(0),
                fileName: "empty.mp3",
            });
            expect(result).toBeNull();
        } finally {
            warnSpy.mockRestore();
        }
    });

    it("should abort DashScope polling when abortSignal is triggered", async () => {
        process.env.BELLDANDY_STT_PROVIDER = "dashscope";

        (fetch as any).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ output: { task_id: "task-abort" } }),
        });

        (fetch as any).mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
            return await new Promise<Response>((_resolve, reject) => {
                const signal = init?.signal as AbortSignal | undefined;
                if (signal?.aborted) {
                    const error = new Error("Stopped by user.");
                    error.name = "AbortError";
                    reject(error);
                    return;
                }
                signal?.addEventListener("abort", () => {
                    const error = new Error("Stopped by user.");
                    error.name = "AbortError";
                    reject(error);
                }, { once: true });
            });
        });

        const controller = new AbortController();
        const promise = transcribeSpeech({
            buffer: mockBuffer,
            fileName: "test.wav",
            abortSignal: controller.signal,
        });

        await new Promise((resolve) => setTimeout(resolve, 50));
        controller.abort("Stopped by user.");

        await expect(promise).rejects.toThrow("Stopped by user.");
    });

    it("should reuse shared cached transcription results", async () => {
        const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-stt-cache-"));
        const transcribe = vi.fn(async () => ({
            text: "Cached by shared layer",
            provider: "mock",
            model: "mock-stt",
            durationSec: 1.2,
        }));

        try {
            const first = await transcribeSpeechWithCache({
                stateDir,
                buffer: mockBuffer,
                fileName: "voice.webm",
                mime: "audio/webm",
                transcribe,
            });
            const second = await transcribeSpeechWithCache({
                stateDir,
                buffer: mockBuffer,
                fileName: "voice.webm",
                mime: "audio/webm",
                transcribe,
            });

            expect(transcribe).toHaveBeenCalledTimes(1);
            expect(first.cacheHit).toBe(false);
            expect(second.cacheHit).toBe(true);
            expect(second.result?.text).toBe("Cached by shared layer");
        } finally {
            await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
        }
    });

    it("should single-flight concurrent cache misses for the same audio fingerprint", async () => {
        const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-stt-single-flight-"));
        let release: ((value: { text: string; provider: string; model: string }) => void) | undefined;
        const transcribe = vi.fn(() => new Promise<{ text: string; provider: string; model: string }>((resolve) => {
            release = resolve;
        }));

        try {
            const createRequest = () => transcribeSpeechWithCache({
                stateDir,
                buffer: mockBuffer,
                fileName: "voice.webm",
                mime: "audio/webm",
                transcribe,
            });
            const first = createRequest();
            const second = createRequest();
            await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1));
            release?.({ text: "single-flight", provider: "mock", model: "mock-stt" });

            await expect(first).resolves.toMatchObject({ cacheHit: false });
            await expect(second).resolves.toMatchObject({ cacheHit: true });
            expect(transcribe).toHaveBeenCalledTimes(1);
        } finally {
            await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
        }
    });
});
