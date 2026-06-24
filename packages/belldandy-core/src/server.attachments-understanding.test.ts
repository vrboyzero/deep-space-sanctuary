import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import WebSocket from "ws";

import { type BelldandyAgent } from "@belldandy/agent";

const attachmentUnderstandingMocks = vi.hoisted(() => ({
  readImageUnderstandConfigMock: vi.fn(),
  understandImageFileMock: vi.fn(),
  readVideoUnderstandConfigMock: vi.fn(),
  understandVideoFileMock: vi.fn(),
}));

vi.mock("@belldandy/skills", async () => {
  const actual = await vi.importActual<typeof import("@belldandy/skills")>("@belldandy/skills");
  return {
    ...actual,
    readImageUnderstandConfig: attachmentUnderstandingMocks.readImageUnderstandConfigMock,
    understandImageFile: attachmentUnderstandingMocks.understandImageFileMock,
    readVideoUnderstandConfig: attachmentUnderstandingMocks.readVideoUnderstandConfigMock,
    understandVideoFile: attachmentUnderstandingMocks.understandVideoFileMock,
  };
});

import {
  createMediaFingerprint,
  readCachedVideoUnderstanding,
  writeCachedVideoUnderstanding,
  type ImageUnderstandResult,
  type VideoUnderstandResult,
} from "@belldandy/skills";

import { startGatewayServer } from "./server.js";
import {
  cleanupGlobalMemoryManagersForTest,
  pairWebSocketClient,
  resolveWebRoot,
  toBase64,
  waitFor,
} from "./server-testkit.js";

const tempDirs: string[] = [];

beforeAll(() => {
  if (!process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = "test-placeholder-key";
  }
});

beforeEach(() => {
  attachmentUnderstandingMocks.readImageUnderstandConfigMock.mockReset();
  attachmentUnderstandingMocks.understandImageFileMock.mockReset();
  attachmentUnderstandingMocks.readVideoUnderstandConfigMock.mockReset();
  attachmentUnderstandingMocks.understandVideoFileMock.mockReset();
  attachmentUnderstandingMocks.readImageUnderstandConfigMock.mockReturnValue({
    enabled: false,
    autoOnAttachment: true,
    provider: "openai",
    apiKey: "",
    baseURL: "https://vision.example.com/v1",
    model: "gpt-4.1-mini",
    timeoutMs: 3000,
    prompt: "describe image",
    maxInputBytes: 10 * 1024 * 1024,
  });
  attachmentUnderstandingMocks.readVideoUnderstandConfigMock.mockReturnValue({
    enabled: false,
    autoOnAttachment: true,
    provider: "openai",
    apiKey: "",
    baseURL: "https://video.example.com/v1",
    model: "kimi-k2.5",
    timeoutMs: 3000,
    prompt: "describe video",
    maxInputBytes: 100 * 1024 * 1024,
    transport: "openai_files",
    fps: undefined,
    uploadApiKey: "",
    uploadBaseURL: "https://video.example.com/v1",
  });
});

afterEach(async () => {
  vi.clearAllMocks();
  await cleanupGlobalMemoryManagersForTest();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

function createImageUnderstandResult(overrides?: Partial<ImageUnderstandResult>): ImageUnderstandResult {
  return {
    summary: "一张展示终端结果的图片。",
    tags: ["terminal", "screenshot"],
    ocrText: "hello world",
    content: "一张展示终端结果的图片，含 hello world。",
    keyRegions: [
      { label: "终端窗口", summary: "主区域是终端输出。", ocrText: "hello world" },
    ],
    targetDetail: undefined,
    focusMode: "overview",
    focusTarget: undefined,
    provider: "openai",
    model: "gpt-4.1-mini",
    mimeType: "image/png",
    sourcePath: "photo.png",
    ...overrides,
  };
}

function createVideoUnderstandResult(overrides?: Partial<VideoUnderstandResult>): VideoUnderstandResult {
  return {
    summary: "一段展示产品演示流程的视频。",
    tags: ["product", "demo"],
    ocrText: "DEMO",
    content: "视频里展示了产品演示流程，并出现 DEMO 文本。",
    durationText: "约 12 秒",
    timeline: [
      { timestamp: "00:02", summary: "开场展示产品。", ocrText: "" },
      { timestamp: "00:07", summary: "进入主要演示阶段。", ocrText: "DEMO" },
    ],
    targetMoment: undefined,
    focusMode: "overview",
    targetTimestamp: undefined,
    analysisMode: "native_video",
    provider: "openai",
    model: "kimi-k2.5",
    mimeType: "video/mp4",
    sourcePath: "clip.mp4",
    nativeErrorMessage: undefined,
    ...overrides,
  };
}

function createCaptureAgent(seenInputs: any[]): BelldandyAgent {
  return {
    async *run(input) {
      seenInputs.push(input);
      yield { type: "final" as const, text: "ok" };
      yield { type: "status", status: "done" as const };
    },
  };
}

test("message.send appends image and video understanding summaries and reuses cache across repeated attachments", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  tempDirs.push(stateDir);
  const seenInputs: any[] = [];
  attachmentUnderstandingMocks.readImageUnderstandConfigMock.mockReturnValue({
    enabled: true,
    autoOnAttachment: true,
    provider: "openai",
    apiKey: "image-key",
    baseURL: "https://vision.example.com/v1",
    model: "gpt-4.1-mini",
    timeoutMs: 3000,
    prompt: "describe image",
    maxInputBytes: 10 * 1024 * 1024,
  });
  attachmentUnderstandingMocks.readVideoUnderstandConfigMock.mockReturnValue({
    enabled: true,
    autoOnAttachment: true,
    provider: "openai",
    apiKey: "video-key",
    baseURL: "https://video.example.com/v1",
    model: "kimi-k2.5",
    timeoutMs: 3000,
    prompt: "describe video",
    maxInputBytes: 100 * 1024 * 1024,
    transport: "openai_files",
    fps: undefined,
    uploadApiKey: "video-key",
    uploadBaseURL: "https://video.example.com/v1",
  });
  attachmentUnderstandingMocks.understandImageFileMock.mockResolvedValue(
    createImageUnderstandResult(),
  );
  attachmentUnderstandingMocks.understandVideoFileMock.mockResolvedValue(
    createVideoUnderstandResult(),
  );

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentFactory: () => createCaptureAgent(seenInputs),
    primaryModelConfig: {
      baseUrl: "https://moonshot.example.com/v1",
      apiKey: "test-placeholder-key",
      model: "kimi-k2.5",
      wireApi: "responses",
    },
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    const sharedAttachments = [
      { name: "photo.png", type: "image/png", base64: toBase64("same-image") },
      { name: "clip.mp4", type: "video/mp4", base64: toBase64("same-video") },
    ];

    ws.send(JSON.stringify({
      type: "req",
      id: "att-understanding-cache-1",
      method: "message.send",
      params: {
        text: "第一次处理多模态附件",
        conversationId: "att-understanding-cache-conv-1",
        attachments: sharedAttachments,
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "att-understanding-cache-1" && f.ok === true));
    await waitFor(() => frames.filter((f) => f.type === "event" && f.event === "chat.final").length >= 1);

    ws.send(JSON.stringify({
      type: "req",
      id: "att-understanding-cache-2",
      method: "message.send",
      params: {
        text: "第二次处理多模态附件",
        conversationId: "att-understanding-cache-conv-2",
        attachments: sharedAttachments,
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "att-understanding-cache-2" && f.ok === true));
    await waitFor(() => frames.filter((f) => f.type === "event" && f.event === "chat.final").length >= 2);

    expect(attachmentUnderstandingMocks.understandImageFileMock).toHaveBeenCalledTimes(1);
    expect(attachmentUnderstandingMocks.understandVideoFileMock).toHaveBeenCalledTimes(1);
    expect(seenInputs).toHaveLength(2);
    expect(String(seenInputs[0].text)).toContain("[图片识别摘要: 一张展示终端结果的图片。]");
    expect(String(seenInputs[0].text)).toContain("[视频识别摘要: 一段展示产品演示流程的视频。]");
    expect(String(seenInputs[1].text)).toContain("[图片识别摘要: 一张展示终端结果的图片。]");
    expect(String(seenInputs[1].text)).toContain("[视频识别摘要: 一段展示产品演示流程的视频。]");
    expect(seenInputs[1].meta?.promptDeltas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        deltaType: "attachment",
        metadata: expect.objectContaining({
          kind: "image_understanding",
          cacheHit: true,
        }),
      }),
      expect.objectContaining({
        deltaType: "attachment",
        metadata: expect.objectContaining({
          kind: "video_understanding",
          cacheHit: true,
        }),
      }),
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
  }
});

test("message.send refreshes cached frame-fallback video understanding when native video is now available", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  tempDirs.push(stateDir);
  const seenInputs: any[] = [];
  attachmentUnderstandingMocks.readVideoUnderstandConfigMock.mockReturnValue({
    enabled: true,
    autoOnAttachment: true,
    provider: "openai",
    apiKey: "video-key",
    baseURL: "https://video.example.com/v1",
    model: "kimi-k2.5",
    timeoutMs: 3000,
    prompt: "describe video",
    maxInputBytes: 100 * 1024 * 1024,
    transport: "openai_files",
    fps: undefined,
    uploadApiKey: "video-key",
    uploadBaseURL: "https://video.example.com/v1",
  });
  attachmentUnderstandingMocks.understandVideoFileMock.mockResolvedValue(
    createVideoUnderstandResult({
      summary: "一段通过原生视频识别刷新的演示视频。",
      content: "刷新后的原生视频识别结果。",
      analysisMode: "native_video",
      provider: "openai",
      model: "kimi-k2.5",
    }),
  );

  const videoBuffer = Buffer.from("refresh-video");
  const fingerprint = createMediaFingerprint({
    buffer: videoBuffer,
    mime: "video/mp4",
  });
  await writeCachedVideoUnderstanding({
    stateDir,
    fingerprint,
    mime: "video/mp4",
    result: createVideoUnderstandResult({
      summary: "旧的抽帧兜底摘要。",
      content: "旧的抽帧兜底结果。",
      analysisMode: "frame_sampling_fallback",
      provider: "frame_fallback",
      model: "qwen3.6-flash",
      nativeErrorMessage: "Upload failed: 415 unsupported media",
    }),
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentFactory: () => createCaptureAgent(seenInputs),
    primaryModelConfig: {
      baseUrl: "https://moonshot.example.com/v1",
      apiKey: "test-placeholder-key",
      model: "kimi-k2.5",
      wireApi: "responses",
    },
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "att-video-cache-refresh",
      method: "message.send",
      params: {
        text: "请处理刷新后的视频理解结果",
        attachments: [
          { name: "clip.mp4", type: "video/mp4", base64: videoBuffer.toString("base64") },
        ],
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "att-video-cache-refresh" && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final"));

    expect(attachmentUnderstandingMocks.understandVideoFileMock).toHaveBeenCalledTimes(1);
    expect(seenInputs).toHaveLength(1);
    expect(String(seenInputs[0].text)).toContain("[视频识别摘要: 一段通过原生视频识别刷新的演示视频。]");
    expect(String(seenInputs[0].text)).not.toContain("旧的抽帧兜底摘要。");
    expect(seenInputs[0].meta?.promptDeltas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        deltaType: "attachment",
        metadata: expect.objectContaining({
          kind: "video_understanding",
          cacheHit: false,
          model: "kimi-k2.5",
        }),
      }),
    ]));

    const refreshed = await readCachedVideoUnderstanding({
      stateDir,
      fingerprint,
    });
    expect(refreshed?.result).toEqual(expect.objectContaining({
      analysisMode: "native_video",
      provider: "openai",
      model: "kimi-k2.5",
      summary: "一段通过原生视频识别刷新的演示视频。",
    }));
  } finally {
    ws.close();
    await closeP;
    await server.close();
  }
});

test("message.send degrades image and video attachments when the current model has no media capability but still appends understanding summaries", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  tempDirs.push(stateDir);
  const seenInputs: any[] = [];
  attachmentUnderstandingMocks.readImageUnderstandConfigMock.mockReturnValue({
    enabled: true,
    autoOnAttachment: true,
    provider: "openai",
    apiKey: "image-key",
    baseURL: "https://vision.example.com/v1",
    model: "gpt-4.1-mini",
    timeoutMs: 3000,
    prompt: "describe image",
    maxInputBytes: 10 * 1024 * 1024,
  });
  attachmentUnderstandingMocks.readVideoUnderstandConfigMock.mockReturnValue({
    enabled: true,
    autoOnAttachment: true,
    provider: "openai",
    apiKey: "video-key",
    baseURL: "https://video.example.com/v1",
    model: "kimi-k2.5",
    timeoutMs: 3000,
    prompt: "describe video",
    maxInputBytes: 100 * 1024 * 1024,
    transport: "openai_files",
    fps: undefined,
    uploadApiKey: "video-key",
    uploadBaseURL: "https://video.example.com/v1",
  });
  attachmentUnderstandingMocks.understandImageFileMock.mockResolvedValue(
    createImageUnderstandResult({
      summary: "降级场景下的图片理解摘要。",
    }),
  );
  attachmentUnderstandingMocks.understandVideoFileMock.mockResolvedValue(
    createVideoUnderstandResult({
      summary: "降级场景下的视频理解摘要。",
    }),
  );

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentFactory: () => createCaptureAgent(seenInputs),
    primaryModelConfig: {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-placeholder-key",
      model: "gpt-3.5-turbo",
    },
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "att-capability-degraded-understanding",
      method: "message.send",
      params: {
        text: "请处理降级态附件",
        attachments: [
          { name: "photo.png", type: "image/png", base64: toBase64("degrade-image") },
          { name: "clip.mp4", type: "video/mp4", base64: toBase64("degrade-video") },
        ],
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "att-capability-degraded-understanding" && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final"));

    expect(seenInputs).toHaveLength(1);
    expect(seenInputs[0].content).toBeUndefined();
    expect(String(seenInputs[0].text)).toContain("当前模型未声明 image_input");
    expect(String(seenInputs[0].text)).toContain("当前模型未声明 video_input");
    expect(String(seenInputs[0].text)).toContain("[图片识别摘要: 降级场景下的图片理解摘要。]");
    expect(String(seenInputs[0].text)).toContain("[视频识别摘要: 降级场景下的视频理解摘要。]");
    expect(seenInputs[0].meta?.promptDeltas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        deltaType: "attachment",
        metadata: expect.objectContaining({
          kind: "image",
          status: "capability-missing",
        }),
      }),
      expect.objectContaining({
        deltaType: "attachment",
        metadata: expect.objectContaining({
          kind: "video",
          status: "capability-missing",
        }),
      }),
      expect.objectContaining({
        deltaType: "attachment",
        metadata: expect.objectContaining({
          kind: "image_understanding",
        }),
      }),
      expect.objectContaining({
        deltaType: "attachment",
        metadata: expect.objectContaining({
          kind: "video_understanding",
        }),
      }),
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
  }
});
