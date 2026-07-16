import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const discordMock = vi.hoisted(() => {
  type LoginController = {
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: Error) => void;
  };

  const loginControllers: LoginController[] = [];
  const clientInstances: any[] = [];

  class FakeDiscordClient {
    public destroyed = false;
    public ready = false;
    public user = { id: "bot-user", tag: "bot#0001" };
    public channels = {
      fetch: vi.fn(),
    };
    private readonly handlers = new Map<string, Set<(...args: any[]) => void>>();
    private readonly onceHandlers = new Map<string, Set<(...args: any[]) => void>>();

    constructor() {
      clientInstances.push(this);
    }

    on(event: string, handler: (...args: any[]) => void): this {
      const handlers = this.handlers.get(event) ?? new Set();
      handlers.add(handler);
      this.handlers.set(event, handlers);
      return this;
    }

    once(event: string, handler: (...args: any[]) => void): this {
      const handlers = this.onceHandlers.get(event) ?? new Set();
      handlers.add(handler);
      this.onceHandlers.set(event, handlers);
      return this;
    }

    emit(event: string, ...args: any[]): boolean {
      for (const handler of this.handlers.get(event) ?? []) {
        handler(...args);
      }
      const onceHandlers = this.onceHandlers.get(event);
      if (onceHandlers) {
        this.onceHandlers.delete(event);
        for (const handler of onceHandlers) {
          handler(...args);
        }
      }
      return true;
    }

    isReady(): boolean {
      return this.ready && !this.destroyed;
    }

    async login(): Promise<void> {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      loginControllers.push({ promise, resolve, reject });
      return promise;
    }

    destroy(): void {
      this.destroyed = true;
      this.ready = false;
    }

    emitReady(): void {
      if (this.destroyed) return;
      this.ready = true;
      this.emit("clientReady");
    }
  }

  return {
    FakeDiscordClient,
    clientInstances,
    loginControllers,
  };
});

vi.mock("discord.js", () => ({
  Client: discordMock.FakeDiscordClient,
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 2,
    DirectMessages: 4,
    MessageContent: 8,
  },
  TextChannel: class {},
}));

import { DiscordChannel } from "./discord.js";

describe("DiscordChannel", () => {
  beforeEach(() => {
    discordMock.loginControllers.length = 0;
    discordMock.clientInstances.length = 0;
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createChannel() {
    return new DiscordChannel({
      botToken: "discord-token",
      agent: {
        run: vi.fn(),
      } as any,
    });
  }

  it("deduplicates concurrent start calls before ready", async () => {
    const channel = createChannel();

    const firstStart = channel.start();
    const secondStart = channel.start();

    expect(discordMock.clientInstances).toHaveLength(1);
    expect(discordMock.loginControllers).toHaveLength(1);

    discordMock.clientInstances[0]?.emitReady();
    discordMock.loginControllers[0]?.resolve();
    await Promise.all([firstStart, secondStart]);

    expect(channel.isRunning).toBe(true);
    await channel.stop();
  });

  it("ignores late ready from a stopped startup client", async () => {
    const channel = createChannel();
    const listener = vi.fn();
    channel.addEventListener(listener);

    const startPromise = channel.start();
    expect(discordMock.clientInstances).toHaveLength(1);

    await channel.stop();
    expect(channel.isRunning).toBe(false);
    expect(discordMock.clientInstances[0]?.destroyed).toBe(true);

    discordMock.clientInstances[0]?.emitReady();
    discordMock.loginControllers[0]?.resolve();
    await startPromise;

    expect(channel.isRunning).toBe(false);
    expect(listener).toHaveBeenCalledWith({ type: "stopped", channel: "discord" });
    expect(listener).not.toHaveBeenCalledWith({ type: "started", channel: "discord" });
  });

  it("serializes ingress by the shared channel history owner", async () => {
    const channel = createChannel();
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const handled: string[] = [];
    vi.spyOn(channel as any, "handleMessage").mockImplementation(async (message: any) => {
      handled.push(message.id);
      if (message.id === "discord-ingress-first") {
        markFirstStarted();
        await firstGate;
      }
    });
    const message = (id: string, userId: string) => ({
      id,
      content: id,
      channelId: "shared-discord-channel",
      guildId: "guild-a",
      author: { id: userId, bot: false },
    });

    (channel as any).enqueueMessage(message("discord-ingress-first", "user-a"));
    await firstStarted;
    (channel as any).enqueueMessage(message("discord-ingress-second", "user-b"));
    await Promise.resolve();

    expect(handled).toEqual(["discord-ingress-first"]);
    expect((channel as any).ingressScheduler.getRuntimeSnapshots()[0]).toMatchObject({
      activeCount: 1,
      queuedCount: 1,
    });

    releaseFirst();
    await vi.waitFor(() => expect(handled).toEqual([
      "discord-ingress-first",
      "discord-ingress-second",
    ]));
  });

  it("does not fall back to historical discord state when binding is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const channel = new DiscordChannel({
      botToken: "discord-token",
      agent: {
        run: vi.fn(),
      } as any,
    });
    const fetchMock = vi.fn();
    (channel as any).client = {
      isReady: () => true,
      channels: {
        fetch: fetchMock,
      },
    };
    (channel as any)._running = true;

    const sent = await channel.sendProactiveMessage("manual");

    expect(sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects explicit sessionKey when binding belongs to another channel", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const channel = new DiscordChannel({
      botToken: "discord-token",
      agent: {
        run: vi.fn(),
      } as any,
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
            target: { channelId: "channel-a" },
          };
        },
        async getLatestByChannel() {
          return undefined;
        },
      },
    });
    const fetchMock = vi.fn();
    (channel as any).client = {
      isReady: () => true,
      channels: {
        fetch: fetchMock,
      },
    };
    (channel as any)._running = true;

    const sent = await channel.sendProactiveMessage("manual", {
      sessionKey: "channel=qq:scope=per-channel-peer:chat=channel-a:peer=user-a",
    });

    expect(sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("replies with a fallback message when audio-only input cannot be transcribed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sendTyping = vi.fn(async () => {});
    const send = vi.fn(async () => {});
    const eventListener = vi.fn();
    const upsert = vi.fn(async () => {});
    const run = vi.fn();
    const reply = vi.fn(async () => {});

    const channel = new DiscordChannel({
      botToken: "discord-token",
      agent: { run } as any,
      currentConversationBindingStore: {
        upsert,
        async get() {
          return undefined;
        },
        async getLatestByChannel() {
          return undefined;
        },
      },
    });
    channel.addEventListener(eventListener);

    const message = {
      id: "discord-audio-1",
      author: {
        id: "user-a",
        username: "Alice",
        bot: false,
      },
      content: "",
      channelId: "dm-a",
      guildId: null,
      attachments: new Map([
        ["att-1", {
          name: "voice.ogg",
          url: "https://cdn.example.com/voice.ogg",
          contentType: "audio/ogg",
        }],
      ]),
      mentions: {
        users: [],
        has: () => false,
      },
      channel: {
        isTextBased: () => true,
        sendTyping,
        send,
      },
      reply,
    };

    await (channel as any).handleMessage(message);

    expect(run).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(sendTyping).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith("收到音频附件，但当前未能完成转写，请检查 STT 配置或改传 wav/mp3。附件：voice.ogg");
    expect(eventListener).toHaveBeenCalledWith(expect.objectContaining({
      type: "media_received",
      channel: "discord",
      messageId: "discord-audio-1",
      chatId: "dm-a",
      mediaType: "audio",
    }));
    expect(eventListener).toHaveBeenCalledWith(expect.objectContaining({
      type: "message_sent",
      channel: "discord",
      chatId: "dm-a",
    }));
  });

  it("keeps text content when audio transcription returns empty", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sendTyping = vi.fn(async () => {});
    const send = vi.fn(async () => {});
    const run = vi.fn(async function* (input: any) {
      yield {
        type: "final" as const,
        text: `收到文本：${input.text}`,
      };
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => Buffer.from("discord-audio").buffer.slice(
        Buffer.from("discord-audio").byteOffset,
        Buffer.from("discord-audio").byteOffset + Buffer.from("discord-audio").byteLength,
      ),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const sttTranscribe = vi.fn(async () => null);

    const channel = new DiscordChannel({
      botToken: "discord-token",
      agent: { run } as any,
      sttTranscribe,
      currentConversationBindingStore: {
        async upsert() {},
        async get() {
          return undefined;
        },
        async getLatestByChannel() {
          return undefined;
        },
      },
    });

    const message = {
      id: "discord-audio-1b",
      author: {
        id: "user-a",
        username: "Alice",
        bot: false,
      },
      content: "这段音频讲了什么？",
      channelId: "dm-a",
      guildId: null,
      attachments: new Map([
        ["att-1", {
          name: "voice.ogg",
          url: "https://cdn.example.com/voice.ogg",
          contentType: "audio/ogg",
        }],
      ]),
      mentions: {
        users: [],
        has: () => false,
      },
      channel: {
        isTextBased: () => true,
        sendTyping,
        send,
      },
      reply: vi.fn(async () => {}),
    };

    await (channel as any).handleMessage(message);

    expect(sttTranscribe).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      text: "这段音频讲了什么？",
      content: [
        {
          type: "text",
          text: "这段音频讲了什么？",
        },
      ],
    }));
    expect(send).toHaveBeenCalledWith("收到文本：这段音频讲了什么？");
  });

  it("transcribes audio attachments when sttTranscribe is configured", async () => {
    const sendTyping = vi.fn(async () => {});
    const send = vi.fn(async () => {});
    const run = vi.fn(async function* (input: any) {
      yield {
        type: "final" as const,
        text: `收到：${input.content[0]?.text ?? ""}`,
      };
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => Buffer.from("discord-audio").buffer.slice(
        Buffer.from("discord-audio").byteOffset,
        Buffer.from("discord-audio").byteOffset + Buffer.from("discord-audio").byteLength,
      ),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const sttTranscribe = vi.fn(async () => ({
      text: "这是语音转写",
    }));

    const channel = new DiscordChannel({
      botToken: "discord-token",
      agent: { run } as any,
      sttTranscribe,
      currentConversationBindingStore: {
        async upsert() {},
        async get() {
          return undefined;
        },
        async getLatestByChannel() {
          return undefined;
        },
      },
    });

    const message = {
      id: "discord-audio-2",
      author: {
        id: "user-b",
        username: "Bob",
        bot: false,
      },
      content: "",
      channelId: "dm-b",
      guildId: null,
      attachments: new Map([
        ["att-1", {
          name: "voice.ogg",
          url: "https://cdn.example.com/voice.ogg",
          contentType: "audio/ogg",
        }],
      ]),
      mentions: {
        users: [],
        has: () => false,
      },
      channel: {
        isTextBased: () => true,
        sendTyping,
        send,
      },
      reply: vi.fn(async () => {}),
    };

    await (channel as any).handleMessage(message);

    expect(fetchMock).toHaveBeenCalledWith("https://cdn.example.com/voice.ogg");
    expect(sttTranscribe).toHaveBeenCalledWith({
      buffer: expect.any(Buffer),
      fileName: "voice.ogg",
      mime: "audio/ogg",
    });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      content: [
        {
          type: "text",
          text: "[音频转写]\n这是语音转写",
        },
      ],
    }));
    expect(send).toHaveBeenCalledWith("收到：[音频转写]\n这是语音转写");
  });

  it("runs ingress admission before fetching an audio attachment", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const router = {
      admitIngress: vi.fn(() => ({ allow: false, reason: "channel_security:policy_missing" })),
      decide: vi.fn(),
    };
    const channel = new DiscordChannel({
      botToken: "discord-token",
      agent: { async *run() {} } as any,
      router: router as any,
      sttTranscribe: vi.fn(),
    });
    const message = {
      id: "discord-blocked-audio",
      author: { id: "user-blocked", username: "Blocked", bot: false },
      content: "",
      channelId: "dm-blocked",
      guildId: null,
      attachments: new Map([["att-1", {
        name: "voice.ogg",
        url: "https://cdn.example.com/voice.ogg",
        contentType: "audio/ogg",
      }]]),
      mentions: { users: [], has: () => false },
      channel: { isTextBased: () => true, sendTyping: vi.fn(), send: vi.fn() },
      reply: vi.fn(),
    };

    await (channel as any).handleMessage(message);

    expect(router.admitIngress).toHaveBeenCalledWith(expect.objectContaining({
      channel: "discord",
      text: "",
    }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(router.decide).not.toHaveBeenCalled();
  });
});
