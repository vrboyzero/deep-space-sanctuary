import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, expect, test } from "vitest";
import WebSocket from "ws";

import { type BelldandyAgent } from "@belldandy/agent";

import { startGatewayServer } from "./server.js";
import {
  cleanupGlobalMemoryManagersForTest,
  pairWebSocketClient,
  resolveWebRoot,
  toBase64,
  waitFor,
  withEnv,
} from "./server-testkit.js";

// MemoryManager 内部会初始化 OpenAIEmbeddingProvider，需要 OPENAI_API_KEY
// 测试环境中设置一个占位值，避免构造函数抛错（不会实际调用 API）
beforeAll(() => {
  if (!process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = "test-placeholder-key";
  }
});

afterEach(async () => {
  await cleanupGlobalMemoryManagersForTest();
});

test("message.send rejects attachment larger than configured per-file limit", async () => {
  await withEnv({
    BELLDANDY_ATTACHMENT_MAX_FILE_BYTES: "8",
    BELLDANDY_ATTACHMENT_MAX_TOTAL_BYTES: "64",
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
    });

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
    const frames: any[] = [];
    const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
    ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

    try {
      await pairWebSocketClient(ws, frames, stateDir);

      const reqId = "att-file-limit";
      ws.send(JSON.stringify({
        type: "req",
        id: reqId,
        method: "message.send",
        params: {
          text: "",
          attachments: [
            { name: "big.txt", type: "text/plain", base64: toBase64("123456789") },
          ],
        },
      }));

      await waitFor(() => frames.some((f) => f.type === "res" && f.id === reqId));
      const res = frames.find((f) => f.type === "res" && f.id === reqId);
      expect(res.ok).toBe(false);
      expect(res.error?.code).toBe("invalid_params");
      expect(String(res.error?.message ?? "")).toContain("max file size");
    } finally {
      ws.close();
      await closeP;
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("message.send rejects attachments exceeding configured total limit", async () => {
  await withEnv({
    BELLDANDY_ATTACHMENT_MAX_FILE_BYTES: "16",
    BELLDANDY_ATTACHMENT_MAX_TOTAL_BYTES: "12",
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
    });

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
    const frames: any[] = [];
    const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
    ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

    try {
      await pairWebSocketClient(ws, frames, stateDir);

      const reqId = "att-total-limit";
      ws.send(JSON.stringify({
        type: "req",
        id: reqId,
        method: "message.send",
        params: {
          text: "limit test",
          attachments: [
            { name: "a.txt", type: "text/plain", base64: toBase64("12345678") },
            { name: "b.txt", type: "text/plain", base64: toBase64("ABCDEFGH") },
          ],
        },
      }));

      await waitFor(() => frames.some((f) => f.type === "res" && f.id === reqId));
      const res = frames.find((f) => f.type === "res" && f.id === reqId);
      expect(res.ok).toBe(false);
      expect(res.error?.code).toBe("invalid_params");
      expect(String(res.error?.message ?? "")).toContain("total size");
    } finally {
      ws.close();
      await closeP;
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("message.send accepts multiple attachments within configured limits", async () => {
  await withEnv({
    BELLDANDY_ATTACHMENT_MAX_FILE_BYTES: "32",
    BELLDANDY_ATTACHMENT_MAX_TOTAL_BYTES: "64",
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
    });

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
    const frames: any[] = [];
    const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
    ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

    try {
      await pairWebSocketClient(ws, frames, stateDir);

      const reqId = "att-ok";
      ws.send(JSON.stringify({
        type: "req",
        id: reqId,
        method: "message.send",
        params: {
          text: "with attachments",
          attachments: [
            { name: "a.txt", type: "text/plain", base64: toBase64("hello-a") },
            { name: "b.txt", type: "text/plain", base64: toBase64("hello-b") },
          ],
        },
      }));

      await waitFor(() => frames.some((f) => f.type === "res" && f.id === reqId && f.ok === true));
      await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final"));
      const res = frames.find((f) => f.type === "res" && f.id === reqId);
      const conversationId = String(res?.payload?.conversationId ?? "");
      expect(conversationId.length).toBeGreaterThan(0);

      const attachmentDir = path.join(
        stateDir,
        "storage",
        "attachments",
      );
      const fileA = await fs.promises.readFile(path.join(attachmentDir, "a.txt"), "utf-8");
      const fileB = await fs.promises.readFile(path.join(attachmentDir, "b.txt"), "utf-8");
      expect(fileA).toBe("hello-a");
      expect(fileB).toBe("hello-b");
      await expect(fs.promises.access(path.join(attachmentDir, encodeURIComponent(conversationId).replace(/\./g, "%2E"))))
        .rejects.toBeDefined();
    } finally {
      ws.close();
      await closeP;
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("message.send caps total injected text attachment chars across files", async () => {
  await withEnv({
    BELLDANDY_ATTACHMENT_TEXT_CHAR_LIMIT: "50",
    BELLDANDY_ATTACHMENT_TEXT_TOTAL_CHAR_LIMIT: "70",
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
    const seenInputs: any[] = [];
    const agent: BelldandyAgent = {
      async *run(input) {
        seenInputs.push(input);
        yield { type: "final" as const, text: "ok" };
        yield { type: "status", status: "done" as const };
      },
    };
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
    });

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
    const frames: any[] = [];
    const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
    ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

    try {
      await pairWebSocketClient(ws, frames, stateDir);

      ws.send(JSON.stringify({
        type: "req",
        id: "att-char-budget",
        method: "message.send",
        params: {
          text: "attachments budget",
          attachments: [
            { name: "a.txt", type: "text/plain", base64: toBase64("A".repeat(60)) },
            { name: "b.txt", type: "text/plain", base64: toBase64("B".repeat(60)) },
          ],
        },
      }));

      await waitFor(() => frames.some((f) => f.type === "res" && f.id === "att-char-budget" && f.ok === true));
      await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final"));

      expect(seenInputs).toHaveLength(1);
      expect(seenInputs[0].meta?.attachmentStats).toMatchObject({
        textAttachmentCount: 2,
        textAttachmentChars: 70,
        promptAugmentationChars: 70,
        textAttachmentTruncatedCharLimit: 50,
        textAttachmentTotalCharLimit: 70,
      });
      expect(seenInputs[0].meta?.promptDeltas).toEqual(expect.arrayContaining([
        expect.objectContaining({
          deltaType: "attachment",
          role: "attachment",
        }),
      ]));
      expect(String(seenInputs[0].text)).toContain("A".repeat(35));
      expect(String(seenInputs[0].text)).toContain("B".repeat(5));
      expect(String(seenInputs[0].text)).not.toContain("B".repeat(6));
    } finally {
      ws.close();
      await closeP;
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("message.send picks up updated attachment limit env without restarting server", async () => {
  await withEnv({
    BELLDANDY_ATTACHMENT_MAX_FILE_BYTES: "8",
    BELLDANDY_ATTACHMENT_MAX_TOTAL_BYTES: "64",
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
    });

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
    const frames: any[] = [];
    const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
    ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

    try {
      await pairWebSocketClient(ws, frames, stateDir);

      ws.send(JSON.stringify({
        type: "req",
        id: "att-hot-before",
        method: "message.send",
        params: {
          text: "",
          attachments: [
            { name: "big.txt", type: "text/plain", base64: toBase64("123456789") },
          ],
        },
      }));

      await waitFor(() => frames.some((f) => f.type === "res" && f.id === "att-hot-before"));
      const beforeRes = frames.find((f) => f.type === "res" && f.id === "att-hot-before");
      expect(beforeRes.ok).toBe(false);

      process.env.BELLDANDY_ATTACHMENT_MAX_FILE_BYTES = "16";
      ws.send(JSON.stringify({
        type: "req",
        id: "att-hot-after",
        method: "message.send",
        params: {
          text: "ok",
          attachments: [
            { name: "big.txt", type: "text/plain", base64: toBase64("123456789") },
          ],
        },
      }));

      await waitFor(() => frames.some((f) => f.type === "res" && f.id === "att-hot-after" && f.ok === true));
      const afterRes = frames.find((f) => f.type === "res" && f.id === "att-hot-after");
      expect(afterRes.ok).toBe(true);
    } finally {
      ws.close();
      await closeP;
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("message.send caps appended audio transcript chars when user text already exists", async () => {
  await withEnv({
    BELLDANDY_ATTACHMENT_TEXT_TOTAL_CHAR_LIMIT: "30",
    BELLDANDY_AUDIO_TRANSCRIPT_APPEND_CHAR_LIMIT: "20",
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
    const seenInputs: any[] = [];
    const agent: BelldandyAgent = {
      async *run(input) {
        seenInputs.push(input);
        yield { type: "final" as const, text: "ok" };
        yield { type: "status", status: "done" as const };
      },
    };
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
      sttTranscribe: async () => ({
        text: "ABCDEFGHIJABCDEFGHIJABCDEFGHIJ",
        provider: "test",
        model: "mock-stt",
      }),
    });

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
    const frames: any[] = [];
    const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
    ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

    try {
      await pairWebSocketClient(ws, frames, stateDir);

      ws.send(JSON.stringify({
        type: "req",
        id: "audio-transcript-budget",
        method: "message.send",
        params: {
          text: "summarize this audio",
          attachments: [
            { name: "voice.webm", type: "audio/webm", base64: toBase64("fake-audio") },
          ],
        },
      }));

      await waitFor(() => frames.some((f) => f.type === "res" && f.id === "audio-transcript-budget" && f.ok === true));
      await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final"));

      expect(seenInputs).toHaveLength(1);
      expect(seenInputs[0].meta?.attachmentStats).toMatchObject({
        textAttachmentCount: 0,
        textAttachmentChars: 0,
        audioTranscriptChars: 20,
        promptAugmentationChars: 20,
        textAttachmentTotalCharLimit: 30,
        audioTranscriptAppendCharLimit: 20,
      });
      expect(seenInputs[0].meta?.promptDeltas).toEqual(expect.arrayContaining([
        expect.objectContaining({
          deltaType: "audio-transcript",
          role: "attachment",
        }),
      ]));
      expect(String(seenInputs[0].text)).toContain("[音频转写]");
      expect(String(seenInputs[0].text)).toContain("ABCDEFGHIJABCDEFGHIJ");
      expect(String(seenInputs[0].text)).not.toContain("ABCDEFGHIJABCDEFGHIJABCDEFGHIJ");
    } finally {
      ws.close();
      await closeP;
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("message.send sends compressed text attachment content in the real prompt text", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const seenInputs: any[] = [];
  const agent: BelldandyAgent = {
    async *run(input) {
      seenInputs.push(input);
      yield { type: "final" as const, text: "ok" };
      yield { type: "status", status: "done" as const };
    },
  };
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentFactory: () => agent,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    const attachmentText = [
      "# 审批背景",
      ...Array.from({ length: 140 }, (_, index) => `普通内容行 ${index}`),
      "结论：必须经过人工审批",
      "warning: 不允许直接发布",
    ].join("\n");

    ws.send(JSON.stringify({
      type: "req",
      id: "att-compressed-prompt",
      method: "message.send",
      params: {
        text: "请处理附件",
        attachments: [
          { name: "long.txt", type: "text/plain", base64: toBase64(attachmentText) },
        ],
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "att-compressed-prompt" && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final"));

    expect(seenInputs).toHaveLength(1);
    expect(String(seenInputs[0].text)).toContain("# 审批背景");
    expect(String(seenInputs[0].text)).toContain("结论：必须经过人工审批");
    expect(String(seenInputs[0].text)).toContain("warning: 不允许直接发布");
    expect(String(seenInputs[0].text)).toContain("lines omitted");
    expect(String(seenInputs[0].text)).not.toContain("普通内容行 60");
    expect(seenInputs[0].meta?.promptDeltas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        deltaType: "attachment",
        metadata: expect.objectContaining({
          compressed: true,
        }),
      }),
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("message.send keeps compressed text prompt aligned with multimodal content text part", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const seenInputs: any[] = [];
  const agent: BelldandyAgent = {
    async *run(input) {
      seenInputs.push(input);
      yield { type: "final" as const, text: "ok" };
      yield { type: "status", status: "done" as const };
    },
  };
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentFactory: () => agent,
    primaryModelConfig: {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-placeholder-key",
      model: "gpt-4.1-mini",
      wireApi: "responses",
    },
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    const attachmentText = [
      "# 审批背景",
      ...Array.from({ length: 140 }, (_, index) => `普通内容行 ${index}`),
      "结论：必须经过人工审批",
      "warning: 不允许直接发布",
    ].join("\n");

    ws.send(JSON.stringify({
      type: "req",
      id: "att-compressed-multimodal-content",
      method: "message.send",
      params: {
        text: "请结合附件处理",
        attachments: [
          { name: "long.txt", type: "text/plain", base64: toBase64(attachmentText) },
          { name: "photo.png", type: "image/png", base64: toBase64("fake-image") },
        ],
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "att-compressed-multimodal-content" && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final"));

    expect(seenInputs).toHaveLength(1);
    expect(String(seenInputs[0].text)).toContain("# 审批背景");
    expect(String(seenInputs[0].text)).toContain("结论：必须经过人工审批");
    expect(String(seenInputs[0].text)).toContain("warning: 不允许直接发布");
    expect(String(seenInputs[0].text)).toContain("lines omitted");
    expect(String(seenInputs[0].text)).not.toContain("普通内容行 60");
    expect(Array.isArray(seenInputs[0].content)).toBe(true);
    expect(seenInputs[0].content[0]).toEqual({
      type: "text",
      text: seenInputs[0].text,
    });
    expect(seenInputs[0].content).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "image_url",
        image_url: expect.objectContaining({
          url: expect.stringContaining("data:image/png;base64,"),
        }),
      }),
    ]));
    expect(seenInputs[0].meta?.promptDeltas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        deltaType: "attachment",
        metadata: expect.objectContaining({
          compressed: true,
        }),
      }),
      expect.objectContaining({
        deltaType: "attachment",
        metadata: expect.objectContaining({
          kind: "image",
        }),
      }),
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("message.send assembles image_input and video_input attachments together with aligned multimodal content", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const seenInputs: any[] = [];
  const agent: BelldandyAgent = {
    async *run(input) {
      seenInputs.push(input);
      yield { type: "final" as const, text: "ok" };
      yield { type: "status", status: "done" as const };
    },
  };
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentFactory: () => agent,
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
      id: "att-multimodal-image-video",
      method: "message.send",
      params: {
        text: "请结合图片和视频附件处理",
        attachments: [
          { name: "photo.png", type: "image/png", base64: toBase64("fake-image") },
          { name: "clip.mp4", type: "video/mp4", base64: toBase64("fake-video") },
        ],
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "att-multimodal-image-video" && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final"));

    expect(seenInputs).toHaveLength(1);
    expect(String(seenInputs[0].text)).toContain("[用户上传了图片: photo.png]");
    expect(String(seenInputs[0].text)).toContain("[用户上传了视频: clip.mp4]");
    expect(String(seenInputs[0].text)).toContain("Video content has been injected via multimodal channel");
    expect(Array.isArray(seenInputs[0].content)).toBe(true);
    expect(seenInputs[0].content[0]).toEqual({
      type: "text",
      text: seenInputs[0].text,
    });
    expect(seenInputs[0].content).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "image_url",
        image_url: expect.objectContaining({
          url: expect.stringContaining("data:image/png;base64,"),
        }),
      }),
      expect.objectContaining({
        type: "video_url",
        video_url: expect.objectContaining({
          url: expect.stringContaining("file:///"),
        }),
      }),
    ]));
    expect(seenInputs[0].meta?.promptDeltas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        deltaType: "attachment",
        metadata: expect.objectContaining({
          kind: "image",
        }),
      }),
      expect.objectContaining({
        deltaType: "attachment",
        metadata: expect.objectContaining({
          kind: "video",
        }),
      }),
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("message.send keeps image and video attachments usable when automatic understanding fails open", async () => {
  await withEnv({
    BELLDANDY_IMAGE_UNDERSTAND_ENABLED: "true",
    BELLDANDY_IMAGE_UNDERSTAND_OPENAI_API_KEY: "",
    BELLDANDY_VIDEO_UNDERSTAND_ENABLED: "true",
    BELLDANDY_VIDEO_UNDERSTAND_OPENAI_API_KEY: "",
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
    const seenInputs: any[] = [];
    const agent: BelldandyAgent = {
      async *run(input) {
        seenInputs.push(input);
        yield { type: "final" as const, text: "ok" };
        yield { type: "status", status: "done" as const };
      },
    };
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
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
        id: "att-understanding-fail-open",
        method: "message.send",
        params: {
          text: "请处理失败兜底附件",
          attachments: [
            { name: "photo.png", type: "image/png", base64: toBase64("fake-image") },
            { name: "clip.mp4", type: "video/mp4", base64: toBase64("fake-video") },
          ],
        },
      }));

      await waitFor(() => frames.some((f) => f.type === "res" && f.id === "att-understanding-fail-open" && f.ok === true));
      await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final"));

      expect(seenInputs).toHaveLength(1);
      expect(String(seenInputs[0].text)).toContain("[用户上传了图片: photo.png]");
      expect(String(seenInputs[0].text)).toContain("[用户上传了视频: clip.mp4]");
      expect(String(seenInputs[0].text)).not.toContain("[图片识别摘要:");
      expect(String(seenInputs[0].text)).not.toContain("[视频识别摘要:");
      expect(Array.isArray(seenInputs[0].content)).toBe(true);
      expect(seenInputs[0].content[0]).toEqual({
        type: "text",
        text: seenInputs[0].text,
      });
      expect(seenInputs[0].content).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "image_url",
        }),
        expect.objectContaining({
          type: "video_url",
        }),
      ]));
      expect(seenInputs[0].meta?.promptDeltas).toEqual(expect.arrayContaining([
        expect.objectContaining({
          deltaType: "attachment",
          metadata: expect.objectContaining({
            kind: "image",
          }),
        }),
        expect.objectContaining({
          deltaType: "attachment",
          metadata: expect.objectContaining({
            kind: "video",
          }),
        }),
      ]));
      expect(seenInputs[0].meta?.promptDeltas).not.toEqual(expect.arrayContaining([
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
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("message.send token.usage exposes attachment compression observability", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const agent: BelldandyAgent = {
    async *run() {
      yield {
        type: "usage" as const,
        systemPromptTokens: 3,
        contextTokens: 4,
        inputTokens: 12,
        outputTokens: 5,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cacheHitTokens: 0,
        cacheMissTokens: 12,
        modelCalls: 1,
        cacheSupport: "supported" as const,
      };
      yield { type: "final" as const, text: "ok" };
      yield { type: "status", status: "done" as const };
    },
  };
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentFactory: () => agent,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    const attachmentText = [
      "# 审批背景",
      ...Array.from({ length: 140 }, (_, index) => `普通内容行 ${index}`),
      "结论：必须经过人工审批",
      "warning: 不允许直接发布",
    ].join("\n");

    ws.send(JSON.stringify({
      type: "req",
      id: "att-compression-usage",
      method: "message.send",
      params: {
        text: "请处理附件",
        attachments: [
          { name: "long.txt", type: "text/plain", base64: toBase64(attachmentText) },
        ],
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "att-compression-usage" && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "token.usage"));

    const usageEvent = frames.find((f) => f.type === "event" && f.event === "token.usage");
    expect(usageEvent?.payload?.attachmentCompression).toMatchObject({
      appliedCount: 1,
      totalSavedChars: expect.any(Number),
      totalSavedCharsPositive: true,
    });
    const bySource = usageEvent?.payload?.attachmentCompression?.bySource;
    expect(bySource && typeof bySource === "object").toBe(true);
    const sourceEntries = Object.values(bySource ?? {});
    expect(sourceEntries).toHaveLength(1);
    expect(sourceEntries[0]).toMatchObject({
      applied: 1,
      savedChars: expect.any(Number),
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("forensic: long attachment prompt input does not automatically become high retained context", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const agent: BelldandyAgent = {
    async *run(input) {
      yield {
        type: "usage" as const,
        systemPromptTokens: 12,
        contextTokens: 90000,
        inputTokens: 120000,
        outputTokens: 32,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        modelCalls: 1,
        localPromptEstimate: {
          systemPromptTokens: 12,
          contextTokens: 90000,
          totalPromptTokens: 90012,
        },
      };
      yield { type: "final" as const, text: `已处理附件：${String(input.text).slice(0, 8)}` };
      yield { type: "status", status: "done" as const };
    },
  };
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentFactory: () => agent,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    frames.length = 0;

    const conversationId = "conv-attachment-retained-forensic";
    const attachmentText = Array.from({ length: 12000 }, (_, index) => `附件正文行 ${index}`).join("\n");
    ws.send(JSON.stringify({
      type: "req",
      id: "att-retained-forensic-send",
      method: "message.send",
      params: {
        conversationId,
        text: "请分析这个长附件",
        attachments: [
          { name: "long.txt", type: "text/plain", base64: toBase64(attachmentText) },
        ],
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "token.usage" && f.payload?.conversationId === conversationId));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final" && f.payload?.conversationId === conversationId));

    const usageEvent = frames.find((f) => f.type === "event" && f.event === "token.usage" && f.payload?.conversationId === conversationId);
    expect(usageEvent?.payload).toMatchObject({
      inputTokens: 120000,
      outputTokens: 32,
    });

    ws.send(JSON.stringify({
      type: "req",
      id: "att-retained-forensic-meta",
      method: "conversation.meta",
      params: { conversationId },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "att-retained-forensic-meta" && f.ok === true));
    const metaRes = frames.find((f) => f.type === "res" && f.id === "att-retained-forensic-meta");
    const retainedEstimate = metaRes?.payload?.retainedContextEstimate;
    const retainedTokens = Number(retainedEstimate?.tokens || 0);

    expect(retainedEstimate).toMatchObject({
      compacted: false,
      messageCount: 2,
    });
    expect(retainedTokens).toBeGreaterThan(0);
    expect(retainedTokens).toBeLessThan(20000);
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("message.send reuses cached audio transcription for repeated attachments", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const seenInputs: any[] = [];
  let sttCalls = 0;
  const agent: BelldandyAgent = {
    async *run(input) {
      seenInputs.push(input);
      yield { type: "final" as const, text: "ok" };
      yield { type: "status", status: "done" as const };
    },
  };
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentFactory: () => agent,
    sttTranscribe: async () => {
      sttCalls += 1;
      return {
        text: "cached-audio-transcript",
        provider: "test",
        model: "mock-stt",
      };
    },
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    const sharedAudio = toBase64("repeat-audio");
    ws.send(JSON.stringify({
      type: "req",
      id: "audio-cache-1",
      method: "message.send",
      params: {
        text: "first audio",
        conversationId: "audio-cache-conv-1",
        attachments: [
          { name: "voice.webm", type: "audio/webm", base64: sharedAudio },
        ],
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "audio-cache-1" && f.ok === true));
    await waitFor(() => frames.filter((f) => f.type === "event" && f.event === "chat.final").length >= 1);

    ws.send(JSON.stringify({
      type: "req",
      id: "audio-cache-2",
      method: "message.send",
      params: {
        text: "second audio",
        conversationId: "audio-cache-conv-2",
        attachments: [
          { name: "voice.webm", type: "audio/webm", base64: sharedAudio },
        ],
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "audio-cache-2" && f.ok === true));
    await waitFor(() => frames.filter((f) => f.type === "event" && f.event === "chat.final").length >= 2);

    expect(sttCalls).toBe(1);
    expect(seenInputs).toHaveLength(2);
    expect(seenInputs[0].meta?.attachmentStats).toMatchObject({
      audioTranscriptChars: expect.any(Number),
      audioTranscriptCacheHits: 0,
    });
    expect(seenInputs[1].meta?.attachmentStats).toMatchObject({
      audioTranscriptChars: expect.any(Number),
      audioTranscriptCacheHits: 1,
    });
    expect(String(seenInputs[1].text)).toContain("cached-audio-transcript");
    expect(seenInputs[1].meta?.promptDeltas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        deltaType: "audio-transcript",
        metadata: expect.objectContaining({
          cacheHit: true,
        }),
      }),
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});
