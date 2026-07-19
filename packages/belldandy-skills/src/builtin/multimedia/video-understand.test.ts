import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  OutboundRequestPolicy,
  type OutboundRequestAdapterInput,
} from "@belldandy/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { chatCreateMock, openAIMock } = vi.hoisted(() => ({
  chatCreateMock: vi.fn(),
  openAIMock: vi.fn(() => ({
    chat: {
      completions: {
        create: chatCreateMock,
      },
    },
  })),
}));

const { understandVideoFileByFrameSamplingMock } = vi.hoisted(() => ({
  understandVideoFileByFrameSamplingMock: vi.fn(),
}));

vi.mock("openai", () => ({
  default: openAIMock,
}));

vi.mock("./video-frame-fallback.js", () => ({
  understandVideoFileByFrameSampling: understandVideoFileByFrameSamplingMock,
}));

import type { ToolContext } from "../../types.js";
import {
  createVideoUnderstandTool,
  videoUnderstandTool,
  understandVideoFile,
} from "./video-understand.js";

function createUploadPolicy(
  requestAdapter: (input: OutboundRequestAdapterInput) => Promise<Response>,
): OutboundRequestPolicy {
  return new OutboundRequestPolicy({
    allowedHosts: ["video.example.com"],
    maxRedirects: 0,
    dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
    requestAdapter,
  });
}

function createContext(workspaceRoot: string): ToolContext {
  return {
    conversationId: "conv-video-understand-test",
    workspaceRoot,
    stateDir: workspaceRoot,
    policy: {
      allowedPaths: [],
      deniedPaths: [],
      allowedDomains: [],
      deniedDomains: [],
      maxTimeoutMs: 60000,
      maxResponseBytes: 1024 * 1024,
    },
  };
}

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  };
}

describe("video_understand", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-video-understand-"));
    chatCreateMock.mockReset();
    openAIMock.mockClear();
    understandVideoFileByFrameSamplingMock.mockReset();
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.BELLDANDY_VIDEO_UNDERSTAND_ENABLED;
    delete process.env.BELLDANDY_VIDEO_UNDERSTAND_PROVIDER;
    delete process.env.BELLDANDY_VIDEO_UNDERSTAND_OPENAI_API_KEY;
    delete process.env.BELLDANDY_VIDEO_UNDERSTAND_OPENAI_BASE_URL;
    delete process.env.BELLDANDY_VIDEO_UNDERSTAND_MODEL;
    delete process.env.BELLDANDY_VIDEO_UNDERSTAND_TIMEOUT_MS;
    delete process.env.BELLDANDY_VIDEO_UNDERSTAND_PROMPT;
    delete process.env.BELLDANDY_VIDEO_UNDERSTAND_MAX_INPUT_MB;
    delete process.env.BELLDANDY_VIDEO_UNDERSTAND_TRANSPORT;
    delete process.env.BELLDANDY_VIDEO_UNDERSTAND_FPS;
    delete process.env.BELLDANDY_VIDEO_FILE_API_URL;
    delete process.env.BELLDANDY_VIDEO_FILE_API_KEY;
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fails when video understanding is disabled", async () => {
    const videoPath = path.join(tempDir, "clip.mp4");
    await fs.writeFile(videoPath, Buffer.from("fake-video"));

    await expect(understandVideoFile({ filePath: videoPath, mimeType: "video/mp4" }))
      .rejects.toThrow("BELLDANDY_VIDEO_UNDERSTAND_ENABLED is false.");
  });

  it("requires a dedicated video understanding api key", async () => {
    process.env.BELLDANDY_VIDEO_UNDERSTAND_ENABLED = "true";
    const videoPath = path.join(tempDir, "clip.mp4");
    await fs.writeFile(videoPath, Buffer.from("fake-video"));

    await expect(understandVideoFile({ filePath: videoPath, mimeType: "video/mp4" }))
      .rejects.toThrow("BELLDANDY_VIDEO_UNDERSTAND_OPENAI_API_KEY");
    expect(chatCreateMock).not.toHaveBeenCalled();
  });

  it("uploads the video and returns normalized json output", async () => {
    process.env.BELLDANDY_VIDEO_UNDERSTAND_ENABLED = "true";
    process.env.BELLDANDY_VIDEO_UNDERSTAND_OPENAI_API_KEY = "sk-video";
    process.env.BELLDANDY_VIDEO_UNDERSTAND_OPENAI_BASE_URL = "https://video.example.com/v1";
    process.env.BELLDANDY_VIDEO_UNDERSTAND_MODEL = "kimi-k2.5";
    const videoPath = path.join(tempDir, "clip.mp4");
    const videoBuffer = Buffer.concat([
      Buffer.from("fake-video"),
      Buffer.alloc(128 * 1024 + 5, 0x51),
    ]);
    await fs.writeFile(videoPath, videoBuffer);
    const fetchMock = vi.mocked(fetch);
    let uploadBody = Buffer.alloc(0);
    let uploadChunkSizes: number[] = [];
    const uploadAdapter = vi.fn(async (request: OutboundRequestAdapterInput) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request.init.body as NodeJS.ReadableStream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      uploadChunkSizes = chunks.map((chunk) => chunk.length);
      uploadBody = Buffer.concat(chunks);
      return new Response(JSON.stringify({ id: "file-video-123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    chatCreateMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: "视频展示了产品演示流程。",
              tags: ["demo", "product"],
              ocrText: "START",
              content: "视频展示了产品演示流程，并出现 START 字样。",
              durationText: "约 18 秒",
              timeline: [
                { timestamp: "00:02", summary: "镜头展示产品外观。", ocrText: "" },
                { timestamp: "00:09", summary: "开始功能演示。", ocrText: "START" },
              ],
              targetMoment: null,
            }),
          },
        },
      ],
    });

    const context = createContext(tempDir);
    context.logger = createLogger();
    const testTool = createVideoUnderstandTool({
      uploadOutboundRequestPolicy: createUploadPolicy(uploadAdapter),
    });
    const result = await testTool.execute({
      file_path: "clip.mp4",
    }, context);

    expect(result.success).toBe(true);
    expect(JSON.parse(String(result.output))).toMatchObject({
      summary: "视频展示了产品演示流程。",
      tags: ["demo", "product"],
      ocrText: "START",
      durationText: "约 18 秒",
      timeline: [
        { timestamp: "00:02", summary: "镜头展示产品外观。" },
        { timestamp: "00:09", summary: "开始功能演示。", ocrText: "START" },
      ],
      model: "kimi-k2.5",
      provider: "openai",
      mimeType: "video/mp4",
      focusMode: "overview",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadAdapter).toHaveBeenCalledTimes(1);
    const uploadHeaders = uploadAdapter.mock.calls[0]?.[0].init.headers as Record<string, string>;
    expect(uploadHeaders["Content-Type"]).toMatch(/^multipart\/form-data; boundary=/);
    expect(Number(uploadHeaders["Content-Length"])).toBe(uploadBody.length);
    expect(uploadBody.toString("utf-8")).toContain("fake-video");
    expect(uploadBody.toString("utf-8")).toContain('name="purpose"');
    expect(uploadChunkSizes.length).toBeGreaterThanOrEqual(5);
    expect(Math.max(...uploadChunkSizes)).toBeLessThanOrEqual(64 * 1024);
    expect(chatCreateMock).toHaveBeenCalledTimes(1);
    expect(context.logger?.info).toHaveBeenCalledWith(
      "video_understand completed via native_video (model=kimi-k2.5, timelineItems=2)",
    );
    expect(chatCreateMock.mock.calls[0]?.[0]).toMatchObject({
      model: "kimi-k2.5",
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: expect.arrayContaining([
            expect.objectContaining({
              type: "video_url",
              video_url: { url: "ms://file-video-123" },
            }),
          ]),
        }),
      ]),
    });
  });

  it("uses inline data url transport automatically for DashScope compatible-mode", async () => {
    process.env.BELLDANDY_VIDEO_UNDERSTAND_ENABLED = "true";
    process.env.BELLDANDY_VIDEO_UNDERSTAND_OPENAI_API_KEY = "sk-video";
    process.env.BELLDANDY_VIDEO_UNDERSTAND_OPENAI_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
    process.env.BELLDANDY_VIDEO_UNDERSTAND_MODEL = "qwen3.6-flash";
    process.env.BELLDANDY_VIDEO_UNDERSTAND_FPS = "3";
    const videoPath = path.join(tempDir, "clip.mp4");
    await fs.writeFile(videoPath, Buffer.from("fake-video-inline"));
    const fetchMock = vi.mocked(fetch);
    chatCreateMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: "视频展示了界面演示。",
              tags: ["demo"],
              content: "视频展示了界面演示。",
              timeline: [],
              targetMoment: null,
            }),
          },
        },
      ],
    });

    const result = await videoUnderstandTool.execute({
      file_path: "clip.mp4",
    }, createContext(tempDir));

    expect(result.success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(chatCreateMock).toHaveBeenCalledTimes(1);
    const videoPart = chatCreateMock.mock.calls[0]?.[0]?.messages?.[1]?.content?.[1];
    expect(videoPart?.type).toBe("video_url");
    expect(videoPart?.video_url?.url).toMatch(/^data:video\/mp4;base64,/);
    expect(videoPart?.video_url?.fps).toBe(3);
    expect(JSON.parse(String(result.output))).toMatchObject({
      model: "qwen3.6-flash",
      provider: "openai",
      analysisMode: "native_video",
    });
  });

  it("rejects oversized inline video before provider or frame fallback side effects", async () => {
    process.env.BELLDANDY_VIDEO_UNDERSTAND_ENABLED = "true";
    process.env.BELLDANDY_VIDEO_UNDERSTAND_OPENAI_API_KEY = "sk-video";
    process.env.BELLDANDY_VIDEO_UNDERSTAND_OPENAI_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
    process.env.BELLDANDY_VIDEO_UNDERSTAND_MAX_INPUT_MB = "64";
    const videoPath = path.join(tempDir, "large-inline.mp4");
    const handle = await fs.open(videoPath, "w");
    try {
      await handle.truncate(20 * 1024 * 1024 + 1);
    } finally {
      await handle.close();
    }

    const result = await videoUnderstandTool.execute({
      file_path: "large-inline.mp4",
    }, createContext(tempDir));

    expect(result.success).toBe(false);
    expect(result.error).toContain("inline video payload too large");
    expect(fetch).not.toHaveBeenCalled();
    expect(chatCreateMock).not.toHaveBeenCalled();
    expect(understandVideoFileByFrameSamplingMock).not.toHaveBeenCalled();
  });

  it("does not turn a cancelled native video request into frame sampling fallback", async () => {
    process.env.BELLDANDY_VIDEO_UNDERSTAND_ENABLED = "true";
    process.env.BELLDANDY_VIDEO_UNDERSTAND_OPENAI_API_KEY = "sk-video";
    const videoPath = path.join(tempDir, "cancelled.mp4");
    await fs.writeFile(videoPath, Buffer.from("fake-video"));
    const controller = new AbortController();
    controller.abort("Stopped video understanding.");

    await expect(understandVideoFile({
      filePath: videoPath,
      mimeType: "video/mp4",
      abortSignal: controller.signal,
    })).rejects.toThrow("Stopped video understanding.");
    expect(fetch).not.toHaveBeenCalled();
    expect(chatCreateMock).not.toHaveBeenCalled();
    expect(understandVideoFileByFrameSamplingMock).not.toHaveBeenCalled();
  });

  it("treats max_timeline_items=0 as no explicit limit", async () => {
    process.env.BELLDANDY_VIDEO_UNDERSTAND_ENABLED = "true";
    process.env.BELLDANDY_VIDEO_UNDERSTAND_OPENAI_API_KEY = "sk-video";
    process.env.BELLDANDY_VIDEO_UNDERSTAND_OPENAI_BASE_URL = "https://video.example.com/v1";
    process.env.BELLDANDY_VIDEO_UNDERSTAND_MODEL = "kimi-k2.5";
    const videoPath = path.join(tempDir, "clip.mp4");
    await fs.writeFile(videoPath, Buffer.from("fake-video"));
    const fetchMock = vi.mocked(fetch);
    const uploadAdapter = vi.fn(async () => new Response(JSON.stringify({ id: "file-video-123" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    chatCreateMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: "视频展示了完整流程。",
              tags: ["demo"],
              content: "视频展示了完整流程。",
              timeline: [],
              targetMoment: null,
            }),
          },
        },
      ],
    });

    const result = await createVideoUnderstandTool({
      uploadOutboundRequestPolicy: createUploadPolicy(uploadAdapter),
    }).execute({
      file_path: "clip.mp4",
      max_timeline_items: 0,
    }, createContext(tempDir));

    expect(result.success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadAdapter).toHaveBeenCalledTimes(1);
    const promptText = chatCreateMock.mock.calls[0]?.[0]?.messages?.[1]?.content?.[0]?.text;
    expect(promptText).toContain("不要因为固定上限而省略重要片段");
    expect(promptText).toContain("不要只给 5 条示例");
    expect(promptText).not.toContain("最多返回");
  });

  it("rejects paths outside the workspace or state dir", async () => {
    process.env.BELLDANDY_VIDEO_UNDERSTAND_ENABLED = "true";
    process.env.BELLDANDY_VIDEO_UNDERSTAND_OPENAI_API_KEY = "sk-video";
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-video-understand-outside-"));
    const outsidePath = path.join(outsideDir, "outside.mp4");
    try {
      await fs.writeFile(outsidePath, Buffer.from("fake-video"));

      const result = await videoUnderstandTool.execute({
        file_path: outsidePath,
      }, createContext(tempDir));

      expect(result.success).toBe(false);
      expect(result.error).toContain("路径越界");
      expect(chatCreateMock).not.toHaveBeenCalled();
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("supports timestamp-focused queries and forwards structured prompt controls", async () => {
    process.env.BELLDANDY_VIDEO_UNDERSTAND_ENABLED = "true";
    process.env.BELLDANDY_VIDEO_UNDERSTAND_OPENAI_API_KEY = "sk-video";
    process.env.BELLDANDY_VIDEO_UNDERSTAND_OPENAI_BASE_URL = "https://video.example.com/v1";
    process.env.BELLDANDY_VIDEO_UNDERSTAND_MODEL = "kimi-k2.5";
    const videoPath = path.join(tempDir, "clip.mp4");
    await fs.writeFile(videoPath, Buffer.from("fake-video"));
    const fetchMock = vi.mocked(fetch);
    const uploadAdapter = vi.fn(async () => new Response(JSON.stringify({ id: "file-video-456" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    chatCreateMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: "视频整体是在演示功能。",
              tags: ["demo"],
              content: "整体演示，重点时间点已有定位。",
              durationText: "约 18 秒",
              timeline: [],
              targetMoment: {
                requestedTimestamp: "00:09",
                matchedTimestamp: "00:09",
                summary: "此时开始点击按钮并进入主要演示步骤。",
                ocrText: "START",
                note: "时间点定位较准确。",
              },
            }),
          },
        },
      ],
    });

    const result = await createVideoUnderstandTool({
      uploadOutboundRequestPolicy: createUploadPolicy(uploadAdapter),
    }).execute({
      file_path: "clip.mp4",
      focus_mode: "timestamp_query",
      target_timestamp: "00:09",
      include_timeline: false,
      max_timeline_items: 2,
    }, createContext(tempDir));

    expect(result.success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadAdapter).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(result.output))).toMatchObject({
      focusMode: "timestamp_query",
      targetTimestamp: "00:09",
      targetMoment: {
        requestedTimestamp: "00:09",
        matchedTimestamp: "00:09",
        summary: "此时开始点击按钮并进入主要演示步骤。",
        ocrText: "START",
      },
      timeline: [],
    });
    const userMessageParts = chatCreateMock.mock.calls[0]?.[0]?.messages?.[1]?.content;
    expect(userMessageParts?.[0]?.text).toContain("重点回答时间点：00:09");
    expect(userMessageParts?.[0]?.text).toContain("timeline 返回空数组");
  });

  it("falls back to frame sampling when native video upload fails", async () => {
    process.env.BELLDANDY_VIDEO_UNDERSTAND_ENABLED = "true";
    process.env.BELLDANDY_VIDEO_UNDERSTAND_OPENAI_API_KEY = "sk-video";
    process.env.BELLDANDY_VIDEO_UNDERSTAND_OPENAI_BASE_URL = "https://video.example.com/v1";
    process.env.BELLDANDY_VIDEO_UNDERSTAND_MODEL = "kimi-k2.5";
    const videoPath = path.join(tempDir, "clip.mp4");
    await fs.writeFile(videoPath, Buffer.from("fake-video"));
    const fetchMock = vi.mocked(fetch);
    const uploadAdapter = vi.fn(async () => new Response("unsupported media", { status: 415 }));
    understandVideoFileByFrameSamplingMock.mockResolvedValue({
      summary: "基于抽帧识别，视频大致展示了产品演示过程。",
      tags: ["demo", "fallback"],
      ocrText: "START",
      content: "已切换到视频抽帧兜底识别。",
      durationText: "约 18 秒",
      timeline: [
        { timestamp: "00:02", summary: "镜头展示产品外观。", ocrText: "" },
      ],
      targetMoment: undefined,
      provider: "frame_fallback",
      model: "gpt-4.1-mini",
      nativeErrorMessage: "Upload failed: 415 unsupported media",
    });

    const context = createContext(tempDir);
    context.logger = createLogger();
    const result = await createVideoUnderstandTool({
      uploadOutboundRequestPolicy: createUploadPolicy(uploadAdapter),
    }).execute({
      file_path: "clip.mp4",
      max_timeline_items: 0,
    }, context);

    expect(result.success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadAdapter).toHaveBeenCalledTimes(1);
    expect(understandVideoFileByFrameSamplingMock).toHaveBeenCalledTimes(1);
    expect(understandVideoFileByFrameSamplingMock).toHaveBeenCalledWith(expect.objectContaining({
      maxTimelineItems: undefined,
      nativeErrorMessage: "Upload failed: 415 unsupported media",
    }));
    expect(context.logger?.warn).toHaveBeenCalledWith(
      "video_understand native path failed; falling back to frame sampling: Upload failed: 415 unsupported media",
    );
    expect(context.logger?.info).toHaveBeenCalledWith(
      "video_understand completed via frame_sampling_fallback (model=gpt-4.1-mini, timelineItems=1)",
    );
    expect(JSON.parse(String(result.output))).toMatchObject({
      summary: "基于抽帧识别，视频大致展示了产品演示过程。",
      provider: "frame_fallback",
      model: "gpt-4.1-mini",
      analysisMode: "frame_sampling_fallback",
      nativeErrorMessage: "Upload failed: 415 unsupported media",
      timeline: [
        { timestamp: "00:02", summary: "镜头展示产品外观。" },
      ],
    });
    expect(chatCreateMock).not.toHaveBeenCalled();
  });
});
