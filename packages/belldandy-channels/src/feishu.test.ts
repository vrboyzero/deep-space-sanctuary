import { describe, expect, it, vi } from "vitest";

const larkMock = vi.hoisted(() => {
  const createMessage = vi.fn(async () => ({}));
  const replyMessage = vi.fn(async () => ({}));
  const getMessageResource = vi.fn(async () => Buffer.from("mock-audio"));
  class Client {
    public im = {
      message: {
        create: createMessage,
        reply: replyMessage,
      },
      messageResource: {
        get: getMessageResource,
      },
    };

    constructor(_config: unknown) {}
  }

  class WSClient {
    constructor(_config: unknown) {}
    start() {}
    stop() {}
  }

  return {
    Client,
    WSClient,
    LoggerLevel: { info: "info" },
    createMessage,
    replyMessage,
    getMessageResource,
  };
});

vi.mock("@larksuiteoapi/node-sdk", () => larkMock);

import { ConversationStore } from "@belldandy/agent";

import { FeishuChannel } from "./feishu.js";

describe("FeishuChannel", () => {
  it("cascades audio events through download, STT, agent, and reply while reusing cached channel transcription", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const conversationStore = new ConversationStore();
    const seenInputs: any[] = [];
    const baseStt = vi.fn(async () => ({ text: "cached channel transcript" }));
    const audioTranscriptCache = new Map<string, string>();
    const sttTranscribe = vi.fn(async (opts: { buffer: Buffer; fileName: string; mime?: string }) => {
      const key = `${opts.mime ?? ""}:${opts.buffer.toString("base64")}`;
      const cached = audioTranscriptCache.get(key);
      if (cached) {
        return { text: cached };
      }
      const result = await baseStt();
      if (result?.text) {
        audioTranscriptCache.set(key, result.text);
      }
      return result;
    });
    const bindingStore = {
      upsert: vi.fn(async () => {}),
      get: vi.fn(async () => undefined),
      getLatestByChannel: vi.fn(async () => undefined),
    };
    const agent = {
      async *run(input: any) {
        seenInputs.push(input);
        yield {
          type: "final" as const,
          text: `音频已处理: ${input.text}`,
        };
      },
    };

    const channel = new FeishuChannel({
      appId: "app-id",
      appSecret: "app-secret",
      conversationStore,
      agent: agent as any,
      sttTranscribe,
      currentConversationBindingStore: bindingStore,
    });

    const audioEvent = (messageId: string) => ({
      message: {
        chat_id: "chat-a",
        message_id: messageId,
        message_type: "audio",
        chat_type: "p2p",
        content: JSON.stringify({
          file_key: "audio-file-key",
        }),
      },
      sender: {
        sender_id: {
          open_id: "user-open-a",
          user_id: "user-a",
        },
      },
    });

    await (channel as any).handleMessage(audioEvent("msg-a"));
    await (channel as any).handleMessage(audioEvent("msg-b"));

    expect(larkMock.getMessageResource).toHaveBeenCalledTimes(2);
    expect(larkMock.getMessageResource).toHaveBeenNthCalledWith(1, {
      path: { message_id: "msg-a", file_key: "audio-file-key" },
      params: { type: "file" },
    });
    expect(sttTranscribe).toHaveBeenCalledTimes(2);
    expect(baseStt).toHaveBeenCalledTimes(1);
    expect(seenInputs).toHaveLength(2);
    expect(seenInputs[0].text).toBe("[音频转写]\ncached channel transcript");
    expect(seenInputs[1].text).toBe("[音频转写]\ncached channel transcript");
    expect(seenInputs[0].meta).toMatchObject({
      channel: "feishu",
      messageId: "msg-a",
      sessionScope: "per-peer",
      sessionKey: "channel=feishu:scope=per-peer:chatKind=dm:chat=chat-a:peer=user-open-a",
      legacyConversationId: "chat-a",
    });
    expect(bindingStore.upsert).toHaveBeenCalledTimes(2);
    expect(larkMock.replyMessage).toHaveBeenCalledTimes(2);
    expect(larkMock.replyMessage).toHaveBeenNthCalledWith(1, {
      path: {
        message_id: "msg-a",
      },
      data: {
        content: JSON.stringify({ text: "音频已处理: [音频转写]\ncached channel transcript" }),
        msg_type: "text",
      },
    });
    expect(larkMock.replyMessage).toHaveBeenNthCalledWith(2, {
      path: {
        message_id: "msg-b",
      },
      data: {
        content: JSON.stringify({ text: "音频已处理: [音频转写]\ncached channel transcript" }),
        msg_type: "text",
      },
    });

    const history = conversationStore.getHistory("chat-a");
    expect(history).toHaveLength(4);
    expect(history.map((item) => item.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(history[0]?.content).toBe("[音频转写]\ncached channel transcript");
    expect(history[1]?.content).toBe("音频已处理: [音频转写]\ncached channel transcript");
  });

  it("reads audio payload from sdk response.data buffer shape", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    larkMock.getMessageResource.mockResolvedValueOnce({
      data: Buffer.from("mock-audio-from-data"),
    } as any);

    const seenInputs: any[] = [];
    const sttTranscribe = vi.fn(async () => ({ text: "buffer-shape transcript" }));
    const agent = {
      async *run(input: any) {
        seenInputs.push(input);
        yield {
          type: "final" as const,
          text: `音频已处理: ${input.text}`,
        };
      },
    };

    const channel = new FeishuChannel({
      appId: "app-id",
      appSecret: "app-secret",
      conversationStore: new ConversationStore(),
      agent: agent as any,
      sttTranscribe,
    });

    await (channel as any).handleMessage({
      message: {
        chat_id: "chat-b",
        message_id: "msg-buffer-shape",
        message_type: "audio",
        chat_type: "p2p",
        content: JSON.stringify({
          file_key: "audio-file-key-2",
        }),
      },
      sender: {
        sender_id: {
          open_id: "user-open-b",
          user_id: "user-b",
        },
      },
    });

    expect(sttTranscribe).toHaveBeenCalledWith(expect.objectContaining({
      buffer: Buffer.from("mock-audio-from-data"),
      fileName: "feishu_msg-buffer-shape.m4a",
      mime: "audio/mp4",
    }));
    expect(seenInputs).toHaveLength(1);
    expect(seenInputs[0].text).toBe("[音频转写]\nbuffer-shape transcript");
  });

  it("reads audio payload from sdk getReadableStream response shape", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    larkMock.getMessageResource.mockResolvedValueOnce({
      headers: {},
      writeFile: vi.fn(),
      getReadableStream: async function* () {
        yield Buffer.from("mock-audio-from-stream");
      },
    } as any);

    const seenInputs: any[] = [];
    const sttTranscribe = vi.fn(async () => ({ text: "stream-shape transcript" }));
    const agent = {
      async *run(input: any) {
        seenInputs.push(input);
        yield {
          type: "final" as const,
          text: `音频已处理: ${input.text}`,
        };
      },
    };

    const channel = new FeishuChannel({
      appId: "app-id",
      appSecret: "app-secret",
      conversationStore: new ConversationStore(),
      agent: agent as any,
      sttTranscribe,
    });

    await (channel as any).handleMessage({
      message: {
        chat_id: "chat-c",
        message_id: "msg-stream-shape",
        message_type: "audio",
        chat_type: "p2p",
        content: JSON.stringify({
          file_key: "audio-file-key-3",
        }),
      },
      sender: {
        sender_id: {
          open_id: "user-open-c",
          user_id: "user-c",
        },
      },
    });

    expect(sttTranscribe).toHaveBeenCalledWith(expect.objectContaining({
      buffer: Buffer.from("mock-audio-from-stream"),
      fileName: "feishu_msg-stream-shape.m4a",
      mime: "audio/mp4",
    }));
    expect(seenInputs).toHaveLength(1);
    expect(seenInputs[0].text).toBe("[音频转写]\nstream-shape transcript");
  });

  it("does not fall back to lastChatId when binding is missing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const channel = new FeishuChannel({
      appId: "app-id",
      appSecret: "app-secret",
      conversationStore: new ConversationStore(),
      agent: { async *run() {} } as any,
    });

    const sent = await channel.sendProactiveMessage("manual");

    expect(sent).toBe(false);
    expect(larkMock.createMessage).not.toHaveBeenCalled();
  });

  it("rejects explicit sessionKey when binding belongs to another channel", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const channel = new FeishuChannel({
      appId: "app-id",
      appSecret: "app-secret",
      conversationStore: new ConversationStore(),
      agent: { async *run() {} } as any,
      currentConversationBindingStore: {
        async upsert() {},
        async get() {
          return {
            channel: "qq",
            sessionKey: "channel=qq:scope=per-channel-peer:chat=channel-a:peer=user-a",
            sessionScope: "per-channel-peer",
            legacyConversationId: "qq_channel-a",
            chatKind: "channel",
            chatId: "channel-a",
            updatedAt: Date.now(),
            target: { chatId: "channel-a" },
          };
        },
        async getLatestByChannel() {
          return undefined;
        },
      },
    });

    const sent = await channel.sendProactiveMessage("manual", {
      sessionKey: "channel=qq:scope=per-channel-peer:chat=channel-a:peer=user-a",
    });

    expect(sent).toBe(false);
    expect(larkMock.createMessage).not.toHaveBeenCalled();
  });
});
