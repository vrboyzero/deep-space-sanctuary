import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

vi.mock("openai", () => ({
  default: openAIMock,
}));

import type { ToolContext } from "../../types.js";
import {
  MAX_IMAGE_INLINE_INPUT_BYTES,
  imageUnderstandTool,
  readImageUnderstandConfig,
  understandImageFile,
} from "./image-understand.js";

function createContext(workspaceRoot: string): ToolContext {
  return {
    conversationId: "conv-image-understand-test",
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

describe("image_understand", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-image-understand-"));
    chatCreateMock.mockReset();
    openAIMock.mockClear();
    delete process.env.BELLDANDY_IMAGE_UNDERSTAND_ENABLED;
    delete process.env.BELLDANDY_IMAGE_UNDERSTAND_PROVIDER;
    delete process.env.BELLDANDY_IMAGE_UNDERSTAND_OPENAI_API_KEY;
    delete process.env.BELLDANDY_IMAGE_UNDERSTAND_OPENAI_BASE_URL;
    delete process.env.BELLDANDY_IMAGE_UNDERSTAND_MODEL;
    delete process.env.BELLDANDY_IMAGE_UNDERSTAND_TIMEOUT_MS;
    delete process.env.BELLDANDY_IMAGE_UNDERSTAND_PROMPT;
    delete process.env.BELLDANDY_IMAGE_UNDERSTAND_MAX_INPUT_MB;
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fails when image understanding is disabled", async () => {
    const imagePath = path.join(tempDir, "photo.png");
    await fs.writeFile(imagePath, Buffer.from("fake-image"));

    await expect(understandImageFile({ filePath: imagePath, mimeType: "image/png" }))
      .rejects.toThrow("BELLDANDY_IMAGE_UNDERSTAND_ENABLED is false.");
  });

  it("requires a dedicated image understanding api key", async () => {
    process.env.BELLDANDY_IMAGE_UNDERSTAND_ENABLED = "true";
    const imagePath = path.join(tempDir, "photo.png");
    await fs.writeFile(imagePath, Buffer.from("fake-image"));

    await expect(understandImageFile({ filePath: imagePath, mimeType: "image/png" }))
      .rejects.toThrow("BELLDANDY_IMAGE_UNDERSTAND_OPENAI_API_KEY");
    expect(chatCreateMock).not.toHaveBeenCalled();
  });

  it("caps base64-only image input and stops before reading an already aborted request", async () => {
    process.env.BELLDANDY_IMAGE_UNDERSTAND_ENABLED = "true";
    process.env.BELLDANDY_IMAGE_UNDERSTAND_OPENAI_API_KEY = "sk-vision";
    process.env.BELLDANDY_IMAGE_UNDERSTAND_MAX_INPUT_MB = "64";
    const imagePath = path.join(tempDir, "photo.png");
    await fs.writeFile(imagePath, Buffer.from("fake-image"));
    const controller = new AbortController();
    controller.abort("Stopped image understanding.");

    expect(readImageUnderstandConfig().maxInputBytes).toBe(MAX_IMAGE_INLINE_INPUT_BYTES);
    await expect(understandImageFile({
      filePath: imagePath,
      mimeType: "image/png",
      abortSignal: controller.signal,
    })).rejects.toThrow("Stopped image understanding.");
    expect(chatCreateMock).not.toHaveBeenCalled();
  });

  it("returns normalized json output from the configured model", async () => {
    process.env.BELLDANDY_IMAGE_UNDERSTAND_ENABLED = "true";
    process.env.BELLDANDY_IMAGE_UNDERSTAND_OPENAI_API_KEY = "sk-vision";
    process.env.BELLDANDY_IMAGE_UNDERSTAND_OPENAI_BASE_URL = "https://vision.example.com/v1";
    process.env.BELLDANDY_IMAGE_UNDERSTAND_MODEL = "gpt-4.1-mini";
    const imagePath = path.join(tempDir, "photo.png");
    const imageBuffer = Buffer.alloc(64 * 1024 + 2, 0x5a);
    await fs.writeFile(imagePath, imageBuffer);
    const readFileSpy = vi.spyOn(fs, "readFile");
    chatCreateMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: "一只白猫坐在窗边。",
              tags: ["cat", "window"],
              ocrText: "HELLO",
              content: "画面里有一只白猫坐在窗边，外面有光。",
              keyRegions: [
                { label: "主体", summary: "一只白猫坐在窗边。", ocrText: "" },
                { label: "文字区域", summary: "右侧可见 HELLO 字样。", ocrText: "HELLO" },
              ],
              targetDetail: null,
            }),
          },
        },
      ],
    });

    const result = await imageUnderstandTool.execute({
      file_path: "photo.png",
    }, createContext(tempDir));

    expect(result.success).toBe(true);
    expect(JSON.parse(String(result.output))).toMatchObject({
      summary: "一只白猫坐在窗边。",
      tags: ["cat", "window"],
      ocrText: "HELLO",
      keyRegions: [
        { label: "主体", summary: "一只白猫坐在窗边。" },
        { label: "文字区域", summary: "右侧可见 HELLO 字样。", ocrText: "HELLO" },
      ],
      model: "gpt-4.1-mini",
      provider: "openai",
      mimeType: "image/png",
      focusMode: "overview",
    });
    expect(chatCreateMock).toHaveBeenCalledTimes(1);
    expect(readFileSpy).not.toHaveBeenCalled();
    const imageUrl = chatCreateMock.mock.calls[0]?.[0]?.messages?.[1]?.content?.[1]?.image_url?.url;
    expect(imageUrl).toBe(`data:image/png;base64,${imageBuffer.toString("base64")}`);
    expect(openAIMock).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: "sk-vision",
      baseURL: "https://vision.example.com/v1",
      timeout: 60000,
    }));
  });

  it("rejects paths outside the workspace or state dir", async () => {
    process.env.BELLDANDY_IMAGE_UNDERSTAND_ENABLED = "true";
    process.env.BELLDANDY_IMAGE_UNDERSTAND_OPENAI_API_KEY = "sk-vision";
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-image-understand-outside-"));
    const outsidePath = path.join(outsideDir, "outside.png");
    try {
      await fs.writeFile(outsidePath, Buffer.from("fake-image"));

      const result = await imageUnderstandTool.execute({
        file_path: outsidePath,
      }, createContext(tempDir));

      expect(result.success).toBe(false);
      expect(result.error).toContain("路径越界");
      expect(chatCreateMock).not.toHaveBeenCalled();
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("supports detail-focused queries and forwards structured prompt controls", async () => {
    process.env.BELLDANDY_IMAGE_UNDERSTAND_ENABLED = "true";
    process.env.BELLDANDY_IMAGE_UNDERSTAND_OPENAI_API_KEY = "sk-vision";
    process.env.BELLDANDY_IMAGE_UNDERSTAND_OPENAI_BASE_URL = "https://vision.example.com/v1";
    process.env.BELLDANDY_IMAGE_UNDERSTAND_MODEL = "gpt-4.1-mini";
    const imagePath = path.join(tempDir, "photo.png");
    await fs.writeFile(imagePath, Buffer.from("fake-image"));
    chatCreateMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: "这是一个应用截图。",
              tags: ["ui", "dashboard"],
              content: "整体是一个应用控制台界面。",
              keyRegions: [],
              targetDetail: {
                target: "右上角状态标签",
                summary: "右上角显示在线状态。",
                ocrText: "ONLINE",
                note: "标签区域较清晰。",
              },
            }),
          },
        },
      ],
    });

    const result = await imageUnderstandTool.execute({
      file_path: "photo.png",
      focus_mode: "detail_query",
      focus_target: "右上角状态标签",
      include_key_regions: false,
      max_key_regions: 2,
    }, createContext(tempDir));

    expect(result.success).toBe(true);
    expect(JSON.parse(String(result.output))).toMatchObject({
      focusMode: "detail_query",
      focusTarget: "右上角状态标签",
      targetDetail: {
        target: "右上角状态标签",
        summary: "右上角显示在线状态。",
        ocrText: "ONLINE",
      },
      keyRegions: [],
    });
    const userMessageParts = chatCreateMock.mock.calls[0]?.[0]?.messages?.[1]?.content;
    expect(userMessageParts?.[0]?.text).toContain("重点关注：右上角状态标签");
    expect(userMessageParts?.[0]?.text).toContain("keyRegions 返回空数组");
  });
});
