import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const helperMocks = vi.hoisted(() => ({
  readNativeDesktopHelperConfigFromEnv: vi.fn(),
  listCaptureTargets: vi.fn(),
  captureScreen: vi.fn(),
  close: vi.fn(),
}));

const imageUnderstandMocks = vi.hoisted(() => ({
  understandCapturedImageArtifact: vi.fn(),
}));

vi.mock("./camera-native-desktop-stdio-client.js", () => ({
  readNativeDesktopHelperConfigFromEnv: helperMocks.readNativeDesktopHelperConfigFromEnv,
  // Vitest 4 起，被 `new` 调用的 mock 实现必须是 function/class（不能用箭头函数）。
  NativeDesktopStdioHelperClient: vi.fn(function nativeDesktopHelperClientMock() {
    return {
      listCaptureTargets: helperMocks.listCaptureTargets,
      captureScreen: helperMocks.captureScreen,
      close: helperMocks.close,
    };
  }),
}));

vi.mock("./captured-image-understand.js", () => ({
  understandCapturedImageArtifact: imageUnderstandMocks.understandCapturedImageArtifact,
}));

import { screenCaptureTool, screenListTargetsTool } from "./screen.js";

describe("screen tools", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-30T10:40:00.000Z"));
    helperMocks.readNativeDesktopHelperConfigFromEnv.mockReset();
    helperMocks.listCaptureTargets.mockReset();
    helperMocks.captureScreen.mockReset();
    helperMocks.close.mockReset();
    imageUnderstandMocks.understandCapturedImageArtifact.mockReset();
    helperMocks.readNativeDesktopHelperConfigFromEnv.mockReturnValue({
      protocol: "camera-native-desktop/v1",
      transport: "stdio",
      command: "node",
    });
    helperMocks.close.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists screen capture targets through the native helper", async () => {
    helperMocks.listCaptureTargets.mockResolvedValue({
      observedAt: "2026-04-30T10:40:00.000Z",
      helperStatus: "ready",
      permissionState: "not_applicable",
      displays: [
        {
          id: "\\\\.\\DISPLAY1",
          displayRef: "native_desktop:display:%5C%5C.%5CDISPLAY1",
          name: "\\\\.\\DISPLAY1",
          isPrimary: true,
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        },
      ],
      windows: [],
    });

    const result = await screenListTargetsTool.execute({
      includeWindows: false,
    }, {
      conversationId: "conv-screen",
      workspaceRoot: "/tmp/test",
      policy: {
        allowedPaths: [],
        deniedPaths: [],
        allowedDomains: [],
        deniedDomains: [],
        maxTimeoutMs: 5_000,
        maxResponseBytes: 1024 * 1024,
      },
    });

    expect(result.success).toBe(true);
    expect(helperMocks.listCaptureTargets).toHaveBeenCalledWith({
      includeDisplays: true,
      includeWindows: false,
      includeMinimizedWindows: false,
    }, expect.anything());
    const payload = JSON.parse(result.output);
    expect(payload.displays).toHaveLength(1);
  });

  it("captures a screen target and appends image understanding", async () => {
    helperMocks.captureScreen.mockResolvedValue({
      observedAt: "2026-04-30T10:40:01.000Z",
      helperStatus: "ready",
      permissionState: "not_applicable",
      target: {
        kind: "window",
        windowId: "0x00010203",
        windowRef: "native_desktop:window:0x00010203",
        windowTitle: "Target Window",
      },
      artifact: {
        path: "/tmp/test/screenshots/target-window_2026-04-30T10-40-00-000Z.png",
        format: "png",
        width: 1280,
        height: 720,
        sizeBytes: 12345,
        capturedAt: "2026-04-30T10:40:01.000Z",
      },
      window: {
        id: "0x00010203",
        windowRef: "native_desktop:window:0x00010203",
        title: "Target Window",
        isVisible: true,
        isMinimized: false,
        bounds: { x: 100, y: 120, width: 1280, height: 720 },
      },
    });
    imageUnderstandMocks.understandCapturedImageArtifact.mockResolvedValue({
      status: "completed",
      preview: "图片识别摘要: 这是一个应用窗口。",
      result: {
        summary: "这是一个应用窗口。",
        tags: ["window"],
        content: "这是一个应用窗口。",
        keyRegions: [],
        focusMode: "overview",
        provider: "openai",
        model: "gpt-4.1-mini",
        mimeType: "image/png",
        sourcePath: "/tmp/test/screenshots/target-window_2026-04-30T10-40-00-000Z.png",
      },
    });

    const result = await screenCaptureTool.execute({
      target: "window",
      windowTitle: "Target Window",
      name: "Target Window",
    }, {
      conversationId: "conv-screen",
      workspaceRoot: "/tmp/test",
      stateDir: "/tmp/state",
      policy: {
        allowedPaths: [],
        deniedPaths: [],
        allowedDomains: [],
        deniedDomains: [],
        maxTimeoutMs: 5_000,
        maxResponseBytes: 1024 * 1024,
      },
    });

    expect(result.success).toBe(true);
    expect(helperMocks.captureScreen).toHaveBeenCalledWith(expect.objectContaining({
      target: {
        kind: "window",
        windowTitle: "Target Window",
      },
      output: {
        filePath: expect.stringContaining("target-window_2026-04-30T10-40-00-000Z.png"),
        format: "png",
      },
    }), expect.anything());
    expect(imageUnderstandMocks.understandCapturedImageArtifact).toHaveBeenCalledWith(expect.objectContaining({
      filePath: "/tmp/test/screenshots/target-window_2026-04-30T10-40-00-000Z.png",
      stateDir: "/tmp/state",
      autoUnderstandEnvName: "BELLDANDY_SCREEN_CAPTURE_AUTO_UNDERSTAND",
    }));
    const payload = JSON.parse(result.output);
    expect(payload.imageUnderstandingStatus).toBe("completed");
    expect(payload.imageUnderstandingPreview).toContain("图片识别摘要");
    expect(payload.window.title).toBe("Target Window");
  });

  it("keeps screen capture successful when image understanding fails", async () => {
    helperMocks.captureScreen.mockResolvedValue({
      observedAt: "2026-04-30T10:40:01.000Z",
      helperStatus: "ready",
      permissionState: "not_applicable",
      target: {
        kind: "desktop",
      },
      artifact: {
        path: "/tmp/test/screenshots/screen-capture_2026-04-30T10-40-00-000Z.png",
        format: "png",
        width: 1920,
        height: 1080,
        sizeBytes: 12345,
        capturedAt: "2026-04-30T10:40:01.000Z",
      },
    });
    imageUnderstandMocks.understandCapturedImageArtifact.mockResolvedValue({
      status: "failed",
      error: "vision timeout",
    });

    const result = await screenCaptureTool.execute({}, {
      conversationId: "conv-screen",
      workspaceRoot: "/tmp/test",
      policy: {
        allowedPaths: [],
        deniedPaths: [],
        allowedDomains: [],
        deniedDomains: [],
        maxTimeoutMs: 5_000,
        maxResponseBytes: 1024 * 1024,
      },
    });

    expect(result.success).toBe(true);
    const payload = JSON.parse(result.output);
    expect(payload.imageUnderstandingStatus).toBe("failed");
    expect(payload.imageUnderstandingError).toBe("vision timeout");
  });
});
