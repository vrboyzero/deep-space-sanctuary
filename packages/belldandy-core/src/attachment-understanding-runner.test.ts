import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  readImageUnderstandConfigMock,
  understandImageFileMock,
  readVideoUnderstandConfigMock,
  understandVideoFileMock,
  transcribeSpeechWithCacheMock,
  createMediaFingerprintMock,
  readCachedImageUnderstandingMock,
  writeCachedImageUnderstandingMock,
  readCachedVideoUnderstandingMock,
  writeCachedVideoUnderstandingMock,
  audioCacheStore,
  imageCacheStore,
  videoCacheStore,
} = vi.hoisted(() => ({
  readImageUnderstandConfigMock: vi.fn(),
  understandImageFileMock: vi.fn(),
  readVideoUnderstandConfigMock: vi.fn(),
  understandVideoFileMock: vi.fn(),
  audioCacheStore: new Map<string, unknown>(),
  imageCacheStore: new Map<string, unknown>(),
  videoCacheStore: new Map<string, unknown>(),
  createMediaFingerprintMock: vi.fn((input: { buffer: Buffer; mime?: string }) => {
    const safeMime = (input.mime ?? "").replace(/[^a-z0-9]+/gi, "_");
    return `${safeMime}_${input.buffer.toString("hex")}`;
  }),
  transcribeSpeechWithCacheMock: vi.fn(async (input: {
    stateDir: string;
    buffer: Buffer;
    fileName: string;
    mime?: string;
    transcribe?: (opts: { buffer: Buffer; fileName: string; mime?: string }) => Promise<unknown>;
  }) => {
    const fingerprint = createMediaFingerprintMock({
      buffer: input.buffer,
      mime: input.mime,
    });
    const cacheKey = `${input.stateDir}:${fingerprint}`;
    const cached = audioCacheStore.get(cacheKey) as { result?: unknown } | undefined;
    if (cached?.result) {
      return {
        result: cached.result,
        cacheHit: true,
        fingerprint,
      };
    }
    const result = input.transcribe ? await input.transcribe({
      buffer: input.buffer,
      fileName: input.fileName,
      mime: input.mime,
    }) : null;
    if (result) {
      audioCacheStore.set(cacheKey, {
        version: 1,
        fingerprint,
        mime: input.mime,
        createdAt: new Date().toISOString(),
        result,
      });
    }
    return {
      result,
      cacheHit: false,
      fingerprint,
    };
  }),
  readCachedImageUnderstandingMock: vi.fn(async (input: { stateDir: string; fingerprint: string }) => {
    return imageCacheStore.get(`${input.stateDir}:${input.fingerprint}`) as any;
  }),
  writeCachedImageUnderstandingMock: vi.fn(async (input: { stateDir: string; fingerprint: string; mime?: string; result: unknown }) => {
    imageCacheStore.set(`${input.stateDir}:${input.fingerprint}`, {
      version: 1,
      fingerprint: input.fingerprint,
      mime: input.mime,
      createdAt: new Date().toISOString(),
      result: input.result,
    });
  }),
  readCachedVideoUnderstandingMock: vi.fn(async (input: { stateDir: string; fingerprint: string }) => {
    return videoCacheStore.get(`${input.stateDir}:${input.fingerprint}`) as any;
  }),
  writeCachedVideoUnderstandingMock: vi.fn(async (input: { stateDir: string; fingerprint: string; mime?: string; result: unknown }) => {
    videoCacheStore.set(`${input.stateDir}:${input.fingerprint}`, {
      version: 1,
      fingerprint: input.fingerprint,
      mime: input.mime,
      createdAt: new Date().toISOString(),
      result: input.result,
    });
  }),
}));

vi.mock("@belldandy/skills", () => ({
  readImageUnderstandConfig: readImageUnderstandConfigMock,
  understandImageFile: understandImageFileMock,
  readVideoUnderstandConfig: readVideoUnderstandConfigMock,
  understandVideoFile: understandVideoFileMock,
  transcribeSpeechWithCache: transcribeSpeechWithCacheMock,
  createMediaFingerprint: createMediaFingerprintMock,
  readCachedImageUnderstanding: readCachedImageUnderstandingMock,
  writeCachedImageUnderstanding: writeCachedImageUnderstandingMock,
  readCachedVideoUnderstanding: readCachedVideoUnderstandingMock,
  writeCachedVideoUnderstanding: writeCachedVideoUnderstandingMock,
}));

import { preparePromptWithAttachments, type AttachmentPromptLimits } from "./attachment-understanding-runner.js";
import { readPreflightCompressionSidecar } from "./preflight-compression-sidecar.js";

const TEST_LIMITS: AttachmentPromptLimits = {
  textCharLimit: 200,
  totalTextCharLimit: 500,
  audioTranscriptAppendCharLimit: 120,
};

const noopLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function createSpyLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

async function loadAttachmentRunnerWithBrokenCompressionPipeline() {
  vi.resetModules();
  vi.doMock("@belldandy/agent", async () => {
    const actual = await vi.importActual<typeof import("@belldandy/agent")>("@belldandy/agent");
    return {
      ...actual,
      createCompressionPipeline: vi.fn(() => ({
        compress: vi.fn(async () => {
          throw new Error("compression unavailable");
        }),
      })),
    };
  });
  return import("./attachment-understanding-runner.js");
}

describe("attachment understanding runner", () => {
  beforeEach(() => {
    delete process.env.BELLDANDY_VIDEO_UNDERSTAND_AUTO_ATTACHMENT_MAX_TIMELINE_ITEMS;
    delete process.env.BELLDANDY_VIDEO_UNDERSTAND_AUTO_ATTACHMENT_SUMMARY_CHAR_LIMIT;
    readImageUnderstandConfigMock.mockReset();
    understandImageFileMock.mockReset();
    readVideoUnderstandConfigMock.mockReset();
    understandVideoFileMock.mockReset();
    transcribeSpeechWithCacheMock.mockClear();
    createMediaFingerprintMock.mockClear();
    readCachedImageUnderstandingMock.mockClear();
    writeCachedImageUnderstandingMock.mockClear();
    readCachedVideoUnderstandingMock.mockClear();
    writeCachedVideoUnderstandingMock.mockClear();
    audioCacheStore.clear();
    imageCacheStore.clear();
    videoCacheStore.clear();
    readImageUnderstandConfigMock.mockReturnValue({
      enabled: false,
      autoOnAttachment: true,
    });
    readVideoUnderstandConfigMock.mockReturnValue({
      enabled: false,
      autoOnAttachment: true,
    });
  });

  it("reuses cached audio transcription for the same attachment fingerprint", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-att-runner-"));
    let sttCalls = 0;
    try {
      const runOnce = async () => preparePromptWithAttachments({
        conversationId: "conv-cache",
        promptText: "summarize",
        attachments: [
          { name: "voice.webm", type: "audio/webm", base64: Buffer.from("same-audio").toString("base64") },
        ],
        stateDir,
        sttTranscribe: async () => {
          sttCalls += 1;
          return {
            text: "cached transcript",
            provider: "mock",
            model: "mock-stt",
          };
        },
        log: noopLogger,
        getAttachmentPromptLimits: () => TEST_LIMITS,
        truncateTextForPrompt: (text, limit, suffix) => ({
          text: text.length > limit ? `${text.slice(0, limit)}${suffix}` : text,
          truncated: text.length > limit,
        }),
        acceptedContentCapabilities: ["text_inline"],
      });

      const first = await runOnce();
      const second = await runOnce();

      expect(sttCalls).toBe(1);
      expect(first.promptText).toContain("cached transcript");
      expect(second.promptText).toContain("cached transcript");
      expect(second.audioTranscriptCacheHits).toBe(1);
      expect(second.promptDeltas).toEqual(expect.arrayContaining([
        expect.objectContaining({
          deltaType: "audio-transcript",
          metadata: expect.objectContaining({
            cacheHit: true,
          }),
        }),
      ]));
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("degrades image attachments when current model capabilities do not include image_input", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-att-runner-"));
    try {
      const result = await preparePromptWithAttachments({
        conversationId: "conv-image-degrade",
        promptText: "describe",
        attachments: [
          { name: "photo.png", type: "image/png", base64: Buffer.from("fake-image").toString("base64") },
        ],
        stateDir,
        log: noopLogger,
        getAttachmentPromptLimits: () => TEST_LIMITS,
        truncateTextForPrompt: (text, limit, suffix) => ({
          text: text.length > limit ? `${text.slice(0, limit)}${suffix}` : text,
          truncated: text.length > limit,
        }),
        acceptedContentCapabilities: ["text_inline"],
      });

      expect(result.contentParts).toEqual([]);
      expect(result.promptText).toContain("当前模型未声明 image_input");
      expect(result.promptDeltas).toEqual(expect.arrayContaining([
        expect.objectContaining({
          deltaType: "attachment",
          metadata: expect.objectContaining({
            kind: "image",
            status: "capability-missing",
          }),
        }),
      ]));
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("automatically appends image understanding and reuses cached results", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-att-runner-image-"));
    const logger = createSpyLogger();
    readImageUnderstandConfigMock.mockReturnValue({
      enabled: true,
      autoOnAttachment: true,
    });
    understandImageFileMock.mockResolvedValue({
      summary: "一张展示终端界面的截图。",
      tags: ["screenshot", "terminal"],
      ocrText: "hello world",
      content: "一张展示终端界面的截图，包含 hello world 文本。",
      keyRegions: [
        { label: "终端窗口", summary: "主体是终端内容区域。", ocrText: "" },
        { label: "输出行", summary: "中部有 hello world 文本。", ocrText: "hello world" },
      ],
      targetDetail: undefined,
      focusMode: "overview",
      focusTarget: undefined,
      provider: "openai",
      model: "gpt-4.1-mini",
      mimeType: "image/png",
      sourcePath: path.join(stateDir, "storage", "attachments", "photo.png"),
    });

    try {
      const runOnce = async () => preparePromptWithAttachments({
        conversationId: "conv-image-auto",
        promptText: "describe",
        attachments: [
          { name: "photo.png", type: "image/png", base64: Buffer.from("same-image").toString("base64") },
        ],
        stateDir,
        log: logger,
        getAttachmentPromptLimits: () => TEST_LIMITS,
        truncateTextForPrompt: (text, limit, suffix) => ({
          text: text.length > limit ? `${text.slice(0, limit)}${suffix}` : text,
          truncated: text.length > limit,
        }),
        acceptedContentCapabilities: ["text_inline"],
      });

      const first = await runOnce();
      const second = await runOnce();

      expect(understandImageFileMock).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith(
        "message",
        "Image attachment auto understanding completed",
        expect.objectContaining({
          name: "photo.png",
          mime: "image/png",
          cacheHit: false,
          model: "gpt-4.1-mini",
        }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        "message",
        "Image attachment auto understanding completed",
        expect.objectContaining({
          name: "photo.png",
          mime: "image/png",
          cacheHit: true,
          model: "gpt-4.1-mini",
        }),
      );
      expect(first.promptText).toContain("[图片识别摘要: 一张展示终端界面的截图。]");
      expect(first.promptText).toContain("[图片标签: screenshot，terminal]");
      expect(first.promptText).toContain("[图片重点区域: 终端窗口 主体是终端内容区域。；输出行 中部有 hello world 文本。]");
      expect(first.promptText).toContain("[图片可见文字: hello world]");
      expect(second.promptDeltas).toEqual(expect.arrayContaining([
        expect.objectContaining({
          deltaType: "attachment",
          metadata: expect.objectContaining({
            kind: "image_understanding",
            cacheHit: true,
            model: "gpt-4.1-mini",
          }),
        }),
      ]));
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("automatically appends video understanding and reuses cached results", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-att-runner-video-"));
    const logger = createSpyLogger();
    readVideoUnderstandConfigMock.mockReturnValue({
      enabled: true,
      autoOnAttachment: true,
    });
    understandVideoFileMock.mockResolvedValue({
      summary: "一段展示产品旋转效果的短视频。",
      tags: ["product", "rotation"],
      ocrText: "DEMO",
      content: "视频里展示了产品旋转效果，并出现 DEMO 文本。",
      durationText: "约 12 秒",
      timeline: [
        { timestamp: "00:02", summary: "镜头展示产品正面。", ocrText: "" },
        { timestamp: "00:07", summary: "产品开始旋转。", ocrText: "DEMO" },
      ],
      targetMoment: undefined,
      focusMode: "overview",
      targetTimestamp: undefined,
      provider: "openai",
      model: "kimi-k2.5",
      mimeType: "video/mp4",
      sourcePath: path.join(stateDir, "storage", "attachments", "clip.mp4"),
    });

    try {
      const runOnce = async () => preparePromptWithAttachments({
        conversationId: "conv-video-auto",
        promptText: "describe",
        attachments: [
          { name: "clip.mp4", type: "video/mp4", base64: Buffer.from("same-video").toString("base64") },
        ],
        stateDir,
        log: logger,
        getAttachmentPromptLimits: () => TEST_LIMITS,
        truncateTextForPrompt: (text, limit, suffix) => ({
          text: text.length > limit ? `${text.slice(0, limit)}${suffix}` : text,
          truncated: text.length > limit,
        }),
        acceptedContentCapabilities: ["text_inline"],
      });

      const first = await runOnce();
      const second = await runOnce();

      expect(understandVideoFileMock).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith(
        "message",
        "Video attachment auto understanding completed",
        expect.objectContaining({
          name: "clip.mp4",
          mime: "video/mp4",
          cacheHit: false,
          model: "kimi-k2.5",
          analysisMode: "native_video",
          timelineItems: 2,
        }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        "message",
        "Video attachment auto understanding completed",
        expect.objectContaining({
          name: "clip.mp4",
          mime: "video/mp4",
          cacheHit: true,
          model: "kimi-k2.5",
          analysisMode: "native_video",
          timelineItems: 2,
        }),
      );
      expect(first.promptText).toContain("[视频识别摘要: 一段展示产品旋转效果的短视频。]");
      expect(first.promptText).toContain("[视频标签: product，rotation]");
      expect(first.promptText).toContain("[视频关键片段: 00:02 镜头展示产品正面。；00:07 产品开始旋转。]");
      expect(first.promptText).toContain("[视频可见文字: DEMO]");
      expect(second.promptDeltas).toEqual(expect.arrayContaining([
        expect.objectContaining({
          deltaType: "attachment",
          metadata: expect.objectContaining({
            kind: "video_understanding",
            cacheHit: true,
            model: "kimi-k2.5",
          }),
        }),
      ]));
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("refreshes cached frame fallback video understanding when native video is now configured", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-att-runner-video-refresh-"));
    const logger = createSpyLogger();
    readVideoUnderstandConfigMock.mockReturnValue({
      enabled: true,
      autoOnAttachment: true,
      provider: "openai",
      apiKey: "test-key",
    });
    understandVideoFileMock.mockResolvedValue({
      summary: "一段通过原生视频识别得到的短视频摘要。",
      tags: ["native", "video"],
      ocrText: "NATIVE",
      content: "一段通过原生视频识别得到的短视频摘要。",
      durationText: "约 10 秒",
      timeline: [
        { timestamp: "00:03", summary: "开始展示主画面。", ocrText: "" },
      ],
      targetMoment: undefined,
      focusMode: "overview",
      targetTimestamp: undefined,
      analysisMode: "native_video",
      provider: "openai",
      model: "qwen3.6-flash",
      mimeType: "video/mp4",
      sourcePath: path.join(stateDir, "storage", "attachments", "clip.mp4"),
    });

    try {
      const attachment = { name: "clip.mp4", type: "video/mp4", base64: Buffer.from("refresh-video").toString("base64") };
      const fingerprint = createMediaFingerprintMock({
        buffer: Buffer.from("refresh-video"),
        mime: "video/mp4",
      });
      videoCacheStore.set(`${stateDir}:${fingerprint}`, {
        version: 1,
        fingerprint,
        mime: "video/mp4",
        createdAt: new Date().toISOString(),
        result: {
          summary: "旧的抽帧缓存结果。",
          tags: ["fallback"],
          ocrText: "OLD",
          content: "旧的抽帧缓存结果。",
          durationText: "约 10 秒",
          timeline: [
            { timestamp: "00:01", summary: "旧抽帧。", ocrText: "" },
          ],
          targetMoment: undefined,
          focusMode: "overview",
          targetTimestamp: undefined,
          analysisMode: "frame_sampling_fallback",
          provider: "frame_fallback",
          model: "qwen3.6-flash",
          mimeType: "video/mp4",
          sourcePath: path.join(stateDir, "storage", "attachments", "clip.mp4"),
        },
      });

      const result = await preparePromptWithAttachments({
        conversationId: "conv-video-refresh",
        promptText: "describe",
        attachments: [attachment],
        stateDir,
        log: logger,
        getAttachmentPromptLimits: () => TEST_LIMITS,
        truncateTextForPrompt: (text, limit, suffix) => ({
          text: text.length > limit ? `${text.slice(0, limit)}${suffix}` : text,
          truncated: text.length > limit,
        }),
        acceptedContentCapabilities: ["text_inline"],
      });

      expect(understandVideoFileMock).toHaveBeenCalledTimes(1);
      expect(result.promptText).toContain("[视频识别摘要: 一段通过原生视频识别得到的短视频摘要。]");
      expect(logger.info).toHaveBeenCalledWith(
        "message",
        "Refreshing legacy frame fallback video cache because native video is now available",
        expect.objectContaining({
          name: "clip.mp4",
          analysisMode: "frame_sampling_fallback",
        }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        "message",
        "Video attachment auto understanding completed",
        expect.objectContaining({
          name: "clip.mp4",
          cacheHit: false,
          analysisMode: "native_video",
          model: "qwen3.6-flash",
        }),
      );
      expect(videoCacheStore.get(`${stateDir}:${fingerprint}`)).toEqual(expect.objectContaining({
        result: expect.objectContaining({
          analysisMode: "native_video",
          provider: "openai",
        }),
      }));
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("supports unlimited automatic video attachment summary and timeline injection when env is 0", async () => {
    process.env.BELLDANDY_VIDEO_UNDERSTAND_AUTO_ATTACHMENT_MAX_TIMELINE_ITEMS = "0";
    process.env.BELLDANDY_VIDEO_UNDERSTAND_AUTO_ATTACHMENT_SUMMARY_CHAR_LIMIT = "0";
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-att-runner-video-unlimited-"));
    readVideoUnderstandConfigMock.mockReturnValue({
      enabled: true,
      autoOnAttachment: true,
    });
    const longSummary = "这是一段很长的视频摘要。".repeat(30);
    understandVideoFileMock.mockResolvedValue({
      summary: longSummary,
      tags: ["native", "video"],
      ocrText: "FULL OCR",
      content: longSummary,
      durationText: "约 30 秒",
      timeline: [
        { timestamp: "00:01", summary: "片段 1", ocrText: "" },
        { timestamp: "00:02", summary: "片段 2", ocrText: "" },
        { timestamp: "00:03", summary: "片段 3", ocrText: "" },
        { timestamp: "00:04", summary: "片段 4", ocrText: "" },
        { timestamp: "00:05", summary: "片段 5", ocrText: "" },
        { timestamp: "00:06", summary: "片段 6", ocrText: "" },
      ],
      targetMoment: undefined,
      focusMode: "overview",
      targetTimestamp: undefined,
      analysisMode: "native_video",
      provider: "openai",
      model: "qwen3.6-flash",
      mimeType: "video/mp4",
      sourcePath: path.join(stateDir, "storage", "attachments", "clip.mp4"),
    });

    try {
      const result = await preparePromptWithAttachments({
        conversationId: "conv-video-unlimited",
        promptText: "describe",
        attachments: [
          { name: "clip.mp4", type: "video/mp4", base64: Buffer.from("unlimited-video").toString("base64") },
        ],
        stateDir,
        log: noopLogger,
        getAttachmentPromptLimits: () => TEST_LIMITS,
        truncateTextForPrompt: (text, limit, suffix) => ({
          text: text.length > limit ? `${text.slice(0, limit)}${suffix}` : text,
          truncated: text.length > limit,
        }),
        acceptedContentCapabilities: ["text_inline"],
      });

      expect(understandVideoFileMock).toHaveBeenCalledWith(expect.objectContaining({
        focusMode: "timeline",
        maxTimelineItems: 0,
      }));
      expect(result.promptText).toContain(longSummary);
      expect(result.promptText).toContain("00:06 片段 6");
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("compresses oversized text attachment content into the returned promptText, not only promptDeltas", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-att-runner-text-compress-"));
    try {
      const longAttachment = [
        "# 任务背景",
        ...Array.from({ length: 220 }, (_, index) => `普通说明行 ${index}`),
        "结论：最终必须保留审批约束",
        "warning: 不允许直接上线",
      ].join("\n");

      const result = await preparePromptWithAttachments({
        conversationId: "conv-text-compress",
        promptText: "请处理附件",
        attachments: [
          { name: "long.txt", type: "text/plain", base64: Buffer.from(longAttachment).toString("base64") },
        ],
        stateDir,
        log: noopLogger,
        getAttachmentPromptLimits: () => ({
          textCharLimit: 5_000,
          totalTextCharLimit: 8_000,
          audioTranscriptAppendCharLimit: 120,
        }),
        truncateTextForPrompt: (text, limit, suffix) => ({
          text: text.length > limit ? `${text.slice(0, limit)}${suffix}` : text,
          truncated: text.length > limit,
        }),
        acceptedContentCapabilities: ["text_inline"],
      });

      expect(result.promptText).toContain("# 任务背景");
      expect(result.promptText).toContain("结论：最终必须保留审批约束");
      expect(result.promptText).toContain("warning: 不允许直接上线");
      expect(result.promptText).toContain("lines omitted");
      expect(result.promptText).not.toContain("普通说明行 100");
      expect(result.promptDeltas).toEqual(expect.arrayContaining([
        expect.objectContaining({
          deltaType: "attachment",
          metadata: expect.objectContaining({
            compressed: true,
          }),
        }),
      ]));
      expect(result.attachmentCompressionResults?.some((item) => item.applied)).toBe(true);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("writes sidecar for compressed text attachment when sidecar reference mode is enabled", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-att-runner-text-sidecar-"));
    try {
      const longAttachment = [
        "# 任务背景",
        ...Array.from({ length: 220 }, (_, index) => `sidecar 说明行 ${index}`),
        "结论：sidecar 必须能回取原文",
      ].join("\n");

      const result = await preparePromptWithAttachments({
        conversationId: "conv-text-sidecar",
        runId: "run-sidecar",
        promptText: "请总结附件",
        attachments: [
          { name: "long.txt", type: "text/plain", base64: Buffer.from(longAttachment).toString("base64") },
        ],
        stateDir,
        log: noopLogger,
        getAttachmentPromptLimits: () => ({
          textCharLimit: 5_000,
          totalTextCharLimit: 8_000,
          audioTranscriptAppendCharLimit: 120,
        }),
        truncateTextForPrompt: (text, limit, suffix) => ({
          text: text.length > limit ? `${text.slice(0, limit)}${suffix}` : text,
          truncated: text.length > limit,
        }),
        acceptedContentCapabilities: ["text_inline"],
        preflightCompressionPolicy: {
          attachmentReference: "sidecar",
        },
      });

      const compressedDelta = result.promptDeltas.find((delta) => delta.metadata?.compressed === true);
      const sourceRef = compressedDelta?.metadata?.sourceRef;
      expect(typeof sourceRef).toBe("string");
      expect(compressedDelta?.metadata).toEqual(expect.objectContaining({
        compressionReferenceMode: "sidecar",
        preflightTaskIntent: "summary",
        preflightPrecisionRequired: false,
      }));

      const sidecar = await readPreflightCompressionSidecar({
        stateDir,
        conversationId: "conv-text-sidecar",
        runId: "run-sidecar",
        sourceRef: String(sourceRef),
      });
      expect(sidecar.originalText).toContain("sidecar 说明行 100");
      expect(sidecar.originalText).toContain("结论：sidecar 必须能回取原文");
      expect(sidecar.sidecar.compressedText).toBe(compressedDelta?.text);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("skips compression for precision task when no sidecar reference is enabled", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-att-runner-text-precision-"));
    try {
      const longAttachment = [
        "# 原始附件",
        ...Array.from({ length: 220 }, (_, index) => `精确说明行 ${index}`),
        "结论：精确任务不能无回取压缩",
      ].join("\n");

      const result = await preparePromptWithAttachments({
        conversationId: "conv-text-precision",
        promptText: "请逐字核对附件中的字段和数字",
        attachments: [
          { name: "long.txt", type: "text/plain", base64: Buffer.from(longAttachment).toString("base64") },
        ],
        stateDir,
        log: noopLogger,
        getAttachmentPromptLimits: () => ({
          textCharLimit: 5_000,
          totalTextCharLimit: 8_000,
          audioTranscriptAppendCharLimit: 120,
        }),
        truncateTextForPrompt: (text, limit, suffix) => ({
          text: text.length > limit ? `${text.slice(0, limit)}${suffix}` : text,
          truncated: text.length > limit,
        }),
        acceptedContentCapabilities: ["text_inline"],
        preflightCompressionPolicy: {
          attachmentReference: "none",
        },
      });

      expect(result.promptText).toContain("精确说明行 100");
      expect(result.promptText).not.toContain("lines omitted");
      expect(result.attachmentCompressionResults).toEqual([]);
      expect(result.promptDeltas).toEqual(expect.arrayContaining([
        expect.objectContaining({
          metadata: expect.objectContaining({
            compressionSkipped: true,
            compressionSkipReason: "precision_without_sidecar",
            preflightTaskIntent: "precision",
            preflightPrecisionRequired: true,
          }),
        }),
      ]));
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("skips attachment compression when preflight compression is disabled", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-att-runner-text-compress-disabled-"));
    try {
      const longAttachment = [
        "# 原始附件",
        ...Array.from({ length: 220 }, (_, index) => `原始说明行 ${index}`),
        "结论：关闭预压缩时保留原文",
      ].join("\n");

      const result = await preparePromptWithAttachments({
        conversationId: "conv-text-compress-disabled",
        promptText: "请处理附件",
        attachments: [
          { name: "long.txt", type: "text/plain", base64: Buffer.from(longAttachment).toString("base64") },
        ],
        stateDir,
        log: noopLogger,
        getAttachmentPromptLimits: () => ({
          textCharLimit: 5_000,
          totalTextCharLimit: 8_000,
          audioTranscriptAppendCharLimit: 120,
        }),
        truncateTextForPrompt: (text, limit, suffix) => ({
          text: text.length > limit ? `${text.slice(0, limit)}${suffix}` : text,
          truncated: text.length > limit,
        }),
        acceptedContentCapabilities: ["text_inline"],
        preflightCompressionPolicy: {
          enabled: false,
        },
      });

      expect(result.promptText).toContain("原始说明行 100");
      expect(result.promptText).not.toContain("lines omitted");
      expect(result.attachmentCompressionResults).toEqual([]);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("respects configured attachment compression threshold", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-att-runner-text-compress-threshold-"));
    try {
      const longAttachment = [
        "# 原始附件",
        ...Array.from({ length: 220 }, (_, index) => `阈值说明行 ${index}`),
        "结论：阈值过高时保留原文",
      ].join("\n");

      const result = await preparePromptWithAttachments({
        conversationId: "conv-text-compress-threshold",
        promptText: "请处理附件",
        attachments: [
          { name: "long.txt", type: "text/plain", base64: Buffer.from(longAttachment).toString("base64") },
        ],
        stateDir,
        log: noopLogger,
        getAttachmentPromptLimits: () => ({
          textCharLimit: 5_000,
          totalTextCharLimit: 8_000,
          audioTranscriptAppendCharLimit: 120,
        }),
        truncateTextForPrompt: (text, limit, suffix) => ({
          text: text.length > limit ? `${text.slice(0, limit)}${suffix}` : text,
          truncated: text.length > limit,
        }),
        acceptedContentCapabilities: ["text_inline"],
        preflightCompressionPolicy: {
          attachmentThresholdChars: 20_000,
        },
      });

      expect(result.promptText).toContain("阈值说明行 100");
      expect(result.promptText).not.toContain("lines omitted");
      expect(result.attachmentCompressionResults).toEqual([]);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("keeps original text attachment prompt when attachment compression fails open", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-att-runner-text-fail-open-"));

    try {
      const { preparePromptWithAttachments: preparePromptWithAttachmentsFailOpen } =
        await loadAttachmentRunnerWithBrokenCompressionPipeline();
      const longAttachment = [
        "# 原始附件",
        ...Array.from({ length: 220 }, (_, index) => `原始说明行 ${index}`),
        "结论：失败时必须保留原文",
      ].join("\n");

      const result = await preparePromptWithAttachmentsFailOpen({
        conversationId: "conv-text-compress-fail-open",
        promptText: "请处理附件",
        attachments: [
          { name: "long.txt", type: "text/plain", base64: Buffer.from(longAttachment).toString("base64") },
        ],
        stateDir,
        log: noopLogger,
        getAttachmentPromptLimits: () => ({
          textCharLimit: 5_000,
          totalTextCharLimit: 8_000,
          audioTranscriptAppendCharLimit: 120,
        }),
        truncateTextForPrompt: (text, limit, suffix) => ({
          text: text.length > limit ? `${text.slice(0, limit)}${suffix}` : text,
          truncated: text.length > limit,
        }),
        acceptedContentCapabilities: ["text_inline"],
      });

      expect(result.promptText).toContain("原始说明行 100");
      expect(result.promptText).toContain("结论：失败时必须保留原文");
      expect(result.promptText).not.toContain("lines omitted");
      expect(result.promptDeltas).toEqual(expect.arrayContaining([
        expect.objectContaining({
          deltaType: "attachment",
          metadata: expect.not.objectContaining({
            compressed: true,
          }),
        }),
      ]));
      expect(result.attachmentCompressionResults).toEqual([]);
    } finally {
      vi.resetModules();
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("includes native fallback reason in automatic video attachment logs", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-att-runner-video-fallback-log-"));
    const logger = createSpyLogger();
    readVideoUnderstandConfigMock.mockReturnValue({
      enabled: true,
      autoOnAttachment: true,
    });
    understandVideoFileMock.mockResolvedValue({
      summary: "抽帧兜底结果。",
      tags: ["fallback"],
      ocrText: "OCR",
      content: "已切换到视频抽帧兜底识别。",
      durationText: "约 20 秒",
      timeline: [
        { timestamp: "00:02", summary: "片段 1", ocrText: "" },
      ],
      targetMoment: undefined,
      focusMode: "timeline",
      targetTimestamp: undefined,
      analysisMode: "frame_sampling_fallback",
      provider: "frame_fallback",
      model: "qwen3.6-flash",
      mimeType: "video/mp4",
      sourcePath: path.join(stateDir, "storage", "attachments", "clip.mp4"),
      nativeErrorMessage: "Upload failed: 415 unsupported media",
    });

    try {
      await preparePromptWithAttachments({
        conversationId: "conv-video-fallback-log",
        promptText: "describe",
        attachments: [
          { name: "clip.mp4", type: "video/mp4", base64: Buffer.from("video-fallback-log").toString("base64") },
        ],
        stateDir,
        log: logger,
        getAttachmentPromptLimits: () => TEST_LIMITS,
        truncateTextForPrompt: (text, limit, suffix) => ({
          text: text.length > limit ? `${text.slice(0, limit)}${suffix}` : text,
          truncated: text.length > limit,
        }),
        acceptedContentCapabilities: ["text_inline"],
      });

      expect(logger.warn).toHaveBeenCalledWith(
        "message",
        "Video attachment native understanding fell back to frame sampling",
        expect.objectContaining({
          name: "clip.mp4",
          mime: "video/mp4",
          error: "Upload failed: 415 unsupported media",
        }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        "message",
        "Video attachment auto understanding completed",
        expect.objectContaining({
          analysisMode: "frame_sampling_fallback",
          nativeErrorMessage: "Upload failed: 415 unsupported media",
        }),
      );
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
