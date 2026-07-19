import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, it, expect, vi, beforeEach } from "vitest";
import { OutboundRequestPolicy } from "@belldandy/protocol";
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

function createDashScopeRestPolicy() {
    return new OutboundRequestPolicy({
        allowedHosts: ["dashscope.aliyuncs.com"],
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestAdapter: async ({ url, init }) => await (fetch as any)(url.toString(), {
            method: init.method,
            headers: init.headers,
            body: init.body,
            signal: init.signal,
        }),
    });
}

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

    it("routes DashScope submit and poll through one fixed REST policy", async () => {
        process.env.BELLDANDY_STT_PROVIDER = "dashscope";
        const requestAdapter = vi.fn()
            .mockResolvedValueOnce(Response.json({ output: { task_id: "task-123" } }))
            .mockResolvedValueOnce(Response.json({
                output: {
                    task_status: "SUCCEEDED",
                    results: [{ text: "DashScope Result" }]
                }
            }));
        const restPolicy = new OutboundRequestPolicy({
            allowedHosts: ["dashscope.aliyuncs.com"],
            dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
            requestAdapter,
        });

        const result = await transcribeSpeech({
            buffer: mockBuffer,
            fileName: "test.wav",
            dashScopeRestOutboundRequestPolicy: restPolicy,
        });

        expect(result).toEqual({
            text: "DashScope Result",
            provider: "dashscope",
            model: "paraformer-v2",
        });
        expect(fetch).not.toHaveBeenCalled();
        expect(requestAdapter).toHaveBeenCalledTimes(2);
        expect(requestAdapter.mock.calls[0]?.[0]).toMatchObject({
            url: new URL("https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription"),
            init: {
                method: "POST",
                maxRedirects: 0,
                idleTimeoutMs: 15_000,
            },
        });
        expect(requestAdapter.mock.calls[1]?.[0]).toMatchObject({
            url: new URL("https://dashscope.aliyuncs.com/api/v1/tasks/task-123"),
            init: {
                method: "GET",
                maxRedirects: 0,
                idleTimeoutMs: 15_000,
            },
        });
    });

    it("rejects a private DashScope REST resolution before submit transport", async () => {
        process.env.BELLDANDY_STT_PROVIDER = "dashscope";
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const requestAdapter = vi.fn(async () => Response.json({
            output: { task_id: "private-task" },
        }));
        const restPolicy = new OutboundRequestPolicy({
            allowedHosts: ["dashscope.aliyuncs.com"],
            dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
            requestAdapter,
        });

        try {
            const result = await transcribeSpeech({
                buffer: mockBuffer,
                fileName: "test.wav",
                dashScopeRestOutboundRequestPolicy: restPolicy,
            });

            expect(result).toBeNull();
            expect(requestAdapter).not.toHaveBeenCalled();
            expect(fetch).not.toHaveBeenCalled();
            expect(consoleError).toHaveBeenCalledWith(
                expect.stringContaining("dashscope"),
                expect.stringContaining("private or reserved"),
            );
        } finally {
            consoleError.mockRestore();
        }
    });

    it("does not replay DashScope submit credentials or body to a redirected endpoint", async () => {
        process.env.BELLDANDY_STT_PROVIDER = "dashscope";
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const requestAdapter = vi.fn(async () => new Response(null, {
            status: 307,
            headers: { location: "https://attacker.example/collect" },
        }));
        const restPolicy = new OutboundRequestPolicy({
            allowedHosts: ["dashscope.aliyuncs.com"],
            dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
            requestAdapter,
        });

        try {
            const result = await transcribeSpeech({
                buffer: mockBuffer,
                fileName: "test.wav",
                dashScopeRestOutboundRequestPolicy: restPolicy,
            });

            expect(result).toBeNull();
            expect(requestAdapter).toHaveBeenCalledTimes(1);
            expect(fetch).not.toHaveBeenCalled();
            const firstRequest = requestAdapter.mock.calls[0]?.[0];
            expect(firstRequest?.url.toString()).toBe(
                "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription",
            );
            expect(firstRequest?.init.headers).toMatchObject({
                Authorization: "Bearer sk-dashscope",
            });
            expect(String(firstRequest?.init.body)).toContain("data:audio/wav;base64,");
            expect(consoleError).toHaveBeenCalledWith(
                expect.stringContaining("dashscope"),
                expect.stringContaining("redirect limit"),
            );
        } finally {
            consoleError.mockRestore();
        }
    });

    it("downloads a DashScope transcription URL through the asset policy with the caller signal", async () => {
        vi.useFakeTimers();
        try {
            process.env.BELLDANDY_STT_PROVIDER = "dashscope";
            (fetch as any)
                .mockResolvedValueOnce(Response.json({ output: { task_id: "task-asset" } }))
                .mockResolvedValueOnce(Response.json({
                    output: {
                        task_status: "SUCCEEDED",
                        results: [{
                            transcription_url: "https://dashscope-result.aliyuncs.com/transcript.json",
                        }],
                    },
                }));
            const requestAdapter = vi.fn(async () => Response.json({
                transcripts: [{ text: "Pinned transcription" }],
            }));
            const assetPolicy = new OutboundRequestPolicy({
                allowedHosts: ["aliyuncs.com"],
                dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
                requestAdapter,
            });
            const controller = new AbortController();

            const resultPromise = transcribeSpeech({
                buffer: mockBuffer,
                fileName: "test.wav",
                abortSignal: controller.signal,
                dashScopeRestOutboundRequestPolicy: createDashScopeRestPolicy(),
                dashScopeAssetOutboundRequestPolicy: assetPolicy,
            });
            await vi.advanceTimersByTimeAsync(2000);
            const result = await resultPromise;

            expect(result).toEqual({
                text: "Pinned transcription",
                provider: "dashscope",
                model: "paraformer-v2",
            });
            expect(fetch).toHaveBeenCalledTimes(2);
            expect(requestAdapter).toHaveBeenCalledTimes(1);
            expect(requestAdapter.mock.calls[0]?.[0]).toMatchObject({
                url: new URL("https://dashscope-result.aliyuncs.com/transcript.json"),
                init: {
                    signal: controller.signal,
                    maxRedirects: 3,
                    idleTimeoutMs: 15_000,
                },
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it("rejects a DashScope transcription host resolving to a private address before asset transport", async () => {
        vi.useFakeTimers();
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            process.env.BELLDANDY_STT_PROVIDER = "dashscope";
            (fetch as any)
                .mockResolvedValueOnce(Response.json({ output: { task_id: "task-private-asset" } }))
                .mockResolvedValueOnce(Response.json({
                    output: {
                        task_status: "SUCCEEDED",
                        results: [{
                            transcription_url: "https://dashscope-result.aliyuncs.com/private.json",
                        }],
                    },
                }));
            const requestAdapter = vi.fn(async () => Response.json({
                transcripts: [{ text: "Private transcription" }],
            }));
            const assetPolicy = new OutboundRequestPolicy({
                allowedHosts: ["aliyuncs.com"],
                dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
                requestAdapter,
            });

            const resultPromise = transcribeSpeech({
                buffer: mockBuffer,
                fileName: "test.wav",
                dashScopeRestOutboundRequestPolicy: createDashScopeRestPolicy(),
                dashScopeAssetOutboundRequestPolicy: assetPolicy,
            });
            await vi.advanceTimersByTimeAsync(2000);
            const result = await resultPromise;

            expect(result).toBeNull();
            expect(fetch).toHaveBeenCalledTimes(2);
            expect(requestAdapter).not.toHaveBeenCalled();
            expect(consoleError).toHaveBeenCalledWith(
                expect.stringContaining("dashscope"),
                expect.stringContaining("private or reserved"),
            );
        } finally {
            consoleError.mockRestore();
            vi.useRealTimers();
        }
    });

    it("rejects a non-Aliyun DashScope transcription URL with the default asset profile", async () => {
        vi.useFakeTimers();
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            process.env.BELLDANDY_STT_PROVIDER = "dashscope";
            (fetch as any)
                .mockResolvedValueOnce(Response.json({ output: { task_id: "task-untrusted-asset" } }))
                .mockResolvedValueOnce(Response.json({
                    output: {
                        task_status: "SUCCEEDED",
                        results: [{
                            transcription_url: "https://attacker.example/transcript.json",
                        }],
                    },
                }));

            const resultPromise = transcribeSpeech({
                buffer: mockBuffer,
                fileName: "test.wav",
                dashScopeRestOutboundRequestPolicy: createDashScopeRestPolicy(),
            });
            await vi.advanceTimersByTimeAsync(2000);
            const result = await resultPromise;

            expect(result).toBeNull();
            expect(fetch).toHaveBeenCalledTimes(2);
            expect(consoleError).toHaveBeenCalledWith(
                expect.stringContaining("dashscope"),
                expect.stringContaining("not in the allowlist"),
            );
        } finally {
            consoleError.mockRestore();
            vi.useRealTimers();
        }
    });

    it("revalidates a DashScope transcription redirect before a private second-hop transport", async () => {
        vi.useFakeTimers();
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            process.env.BELLDANDY_STT_PROVIDER = "dashscope";
            (fetch as any)
                .mockResolvedValueOnce(Response.json({ output: { task_id: "task-redirect-asset" } }))
                .mockResolvedValueOnce(Response.json({
                    output: {
                        task_status: "SUCCEEDED",
                        results: [{
                            transcription_url: "https://dashscope-result.aliyuncs.com/redirect.json",
                        }],
                    },
                }));
            const requestAdapter = vi.fn(async () => new Response(null, {
                status: 307,
                headers: { location: "https://127.0.0.1/private.json" },
            }));
            const assetPolicy = new OutboundRequestPolicy({
                allowedHosts: ["aliyuncs.com", "127.0.0.1"],
                dnsLookup: async (hostname) => [{
                    address: hostname === "127.0.0.1" ? "127.0.0.1" : "93.184.216.34",
                    family: 4,
                }],
                requestAdapter,
            });

            const resultPromise = transcribeSpeech({
                buffer: mockBuffer,
                fileName: "test.wav",
                dashScopeRestOutboundRequestPolicy: createDashScopeRestPolicy(),
                dashScopeAssetOutboundRequestPolicy: assetPolicy,
            });
            await vi.advanceTimersByTimeAsync(2000);
            const result = await resultPromise;

            expect(result).toBeNull();
            expect(fetch).toHaveBeenCalledTimes(2);
            expect(requestAdapter).toHaveBeenCalledTimes(1);
            expect(requestAdapter.mock.calls[0]?.[0].url.toString()).toBe(
                "https://dashscope-result.aliyuncs.com/redirect.json",
            );
            expect(consoleError).toHaveBeenCalledWith(
                expect.stringContaining("dashscope"),
                expect.stringContaining("private or reserved"),
            );
        } finally {
            consoleError.mockRestore();
            vi.useRealTimers();
        }
    });

    it("rejects an oversized declared DashScope transcription JSON before reading the body", async () => {
        vi.useFakeTimers();
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            process.env.BELLDANDY_STT_PROVIDER = "dashscope";
            (fetch as any)
                .mockResolvedValueOnce(Response.json({ output: { task_id: "task-oversized-asset" } }))
                .mockResolvedValueOnce(Response.json({
                    output: {
                        task_status: "SUCCEEDED",
                        results: [{
                            transcription_url: "https://dashscope-result.aliyuncs.com/oversized.json",
                        }],
                    },
                }));
            let bodyCancelled = false;
            const oversizedBody = new ReadableStream<Uint8Array>({
                cancel() {
                    bodyCancelled = true;
                },
            });
            const requestAdapter = vi.fn(async () => new Response(oversizedBody, {
                headers: { "Content-Length": String(1024 * 1024 + 1) },
            }));
            const assetPolicy = new OutboundRequestPolicy({
                allowedHosts: ["aliyuncs.com"],
                dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
                requestAdapter,
            });

            const resultPromise = transcribeSpeech({
                buffer: mockBuffer,
                fileName: "test.wav",
                dashScopeRestOutboundRequestPolicy: createDashScopeRestPolicy(),
                dashScopeAssetOutboundRequestPolicy: assetPolicy,
            });
            await vi.advanceTimersByTimeAsync(2000);
            const result = await resultPromise;

            expect(result).toBeNull();
            expect(fetch).toHaveBeenCalledTimes(2);
            expect(requestAdapter).toHaveBeenCalledTimes(1);
            expect(bodyCancelled).toBe(true);
            expect(consoleError).toHaveBeenCalledWith(
                expect.stringContaining("dashscope"),
                expect.stringContaining("1048576"),
            );
        } finally {
            consoleError.mockRestore();
            vi.useRealTimers();
        }
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
            dashScopeRestOutboundRequestPolicy: createDashScopeRestPolicy(),
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
            dashScopeRestOutboundRequestPolicy: createDashScopeRestPolicy(),
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
