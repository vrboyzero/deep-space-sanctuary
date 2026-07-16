import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationStore } from "@belldandy/agent";

const { uploadTokenUsageMock } = vi.hoisted(() => ({
  uploadTokenUsageMock: vi.fn(),
}));

vi.mock("@belldandy/protocol", async () => {
  const actual = await vi.importActual<typeof import("@belldandy/protocol")>("@belldandy/protocol");
  return {
    ...actual,
    uploadTokenUsage: uploadTokenUsageMock,
  };
});

import { CommunityChannel } from "./community.js";
import { createFileCurrentConversationBindingStore } from "./current-conversation-binding-store.js";
import { createRuleBasedRouter } from "./router/engine.js";
import { normalizeChannelSecurityConfig } from "./router/security-config.js";
import { normalizeReplyChunkingConfig } from "./reply-chunking-config.js";
import { buildChannelSessionDescriptor } from "./session-key.js";

describe("community token usage upload", () => {
  beforeEach(() => {
    uploadTokenUsageMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uploads cumulative usage deltas to the agent owner", async () => {
    const wsSend = vi.fn();
    const agent = {
      run: vi.fn(async function* () {
        yield {
          type: "usage",
          systemPromptTokens: 0,
          contextTokens: 0,
          inputTokens: 10,
          outputTokens: 5,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          modelCalls: 1,
        };
        yield {
          type: "usage",
          systemPromptTokens: 0,
          contextTokens: 0,
          inputTokens: 14,
          outputTokens: 7,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          modelCalls: 2,
        };
        yield { type: "final", text: "收到" };
      }),
    };

    const channel = new CommunityChannel({
      endpoint: "https://office.goddess.ai",
      agents: [],
      agent: agent as any,
      conversationStore: new ConversationStore(),
      tokenUsageUpload: {
        enabled: true,
        url: "https://office.goddess.ai/api/internal/token-usage",
        token: "gro_test_key",
        timeoutMs: 3000,
      },
      ownerUserUuid: "a10001",
    });

    const state = {
      ws: { send: wsSend },
      agentConfig: { name: "贝露丹蒂", apiKey: "gro_test_key" },
      roomId: "room-1",
      reconnectAttempts: 0,
      members: [],
    };

    await (channel as any).handleChatMessage({
      id: "msg-1",
      content: "你好",
      sender: {
        type: "user",
        id: "u-1",
        uid: "u-1",
        name: "Alice",
      },
    }, state);

    expect(agent.run).toHaveBeenCalledTimes(1);
    expect(agent.run).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "community:room-1",
      text: "你好",
      senderInfo: expect.objectContaining({ id: "u-1", name: "Alice", type: "user" }),
      roomContext: expect.objectContaining({ roomId: "room-1", environment: "community" }),
      meta: expect.objectContaining({
        channel: "community",
        sessionScope: "per-account-channel-peer",
        sessionKey: expect.stringContaining("channel=community"),
        legacyConversationId: "community:room-1",
      }),
    }));

    expect(uploadTokenUsageMock).toHaveBeenCalledTimes(2);
    expect(uploadTokenUsageMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      userUuid: "a10001",
      conversationId: "community:room-1",
      source: "community",
      deltaTokens: 15,
      config: expect.objectContaining({ enabled: true }),
    }));
    expect(uploadTokenUsageMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      userUuid: "a10001",
      conversationId: "community:room-1",
      source: "community",
      deltaTokens: 6,
    }));

    expect(wsSend).toHaveBeenCalledTimes(1);
    expect(JSON.parse(wsSend.mock.calls[0][0])).toEqual({
      type: "message",
      data: { content: "收到" },
    });
  });

  it("does not upload usage when token upload is disabled", async () => {
    const agent = {
      run: vi.fn(async function* () {
        yield {
          type: "usage",
          systemPromptTokens: 0,
          contextTokens: 0,
          inputTokens: 8,
          outputTokens: 4,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          modelCalls: 1,
        };
        yield { type: "final", text: "ok" };
      }),
    };

    const channel = new CommunityChannel({
      endpoint: "https://office.goddess.ai",
      agents: [],
      agent: agent as any,
      conversationStore: new ConversationStore(),
      tokenUsageUpload: {
        enabled: false,
        url: "https://office.goddess.ai/api/internal/token-usage",
        token: "gro_test_key",
        timeoutMs: 3000,
      },
      ownerUserUuid: "a10001",
    });

    await (channel as any).handleChatMessage({
      id: "msg-2",
      content: "测试",
      sender: {
        type: "user",
        id: "u-2",
        uid: "u-2",
        name: "Bob",
      },
    }, {
      ws: { send: vi.fn() },
      agentConfig: { name: "贝露丹蒂", apiKey: "gro_test_key" },
      roomId: "room-2",
      reconnectAttempts: 0,
      members: [],
    });

    expect(uploadTokenUsageMock).not.toHaveBeenCalled();
  });

  it("uploads without userUuid when owner uuid is missing, which is the strict-uuid boundary", async () => {
    const agent = {
      run: vi.fn(async function* () {
        yield {
          type: "usage",
          systemPromptTokens: 0,
          contextTokens: 0,
          inputTokens: 6,
          outputTokens: 3,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          modelCalls: 1,
        };
        yield { type: "final", text: "ok" };
      }),
    };

    const channel = new CommunityChannel({
      endpoint: "https://office.goddess.ai",
      agents: [],
      agent: agent as any,
      conversationStore: new ConversationStore(),
      tokenUsageUpload: {
        enabled: true,
        url: "https://office.goddess.ai/api/internal/token-usage",
        token: "gro_test_key",
        timeoutMs: 3000,
      },
    });

    await (channel as any).handleChatMessage({
      id: "msg-3",
      content: "边界测试",
      sender: {
        type: "user",
        id: "u-3",
        uid: "u-3",
        name: "Carol",
      },
    }, {
      ws: { send: vi.fn() },
      agentConfig: { name: "贝露丹蒂", apiKey: "gro_test_key" },
      roomId: "room-3",
      reconnectAttempts: 0,
      members: [],
    });

    expect(uploadTokenUsageMock).toHaveBeenCalledTimes(1);
    expect(uploadTokenUsageMock).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "community:room-3",
      source: "community",
      deltaTokens: 9,
    }));
    expect(uploadTokenUsageMock.mock.calls[0][0].userUuid).toBeUndefined();
  });

  it("cleans bounded ingress queue after queued work finishes", async () => {
    let releaseRun: (() => void) | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const agent = {
      run: vi.fn(async function* () {
        markStarted();
        await new Promise<void>((resolve) => {
          releaseRun = resolve;
        });
        yield { type: "final", text: "done" };
      }),
    };

    const channel = new CommunityChannel({
      endpoint: "https://office.goddess.ai",
      agents: [],
      agent: agent as any,
      conversationStore: new ConversationStore(),
    });

    const state = {
      ws: { send: vi.fn() },
      agentConfig: { name: "贝露丹蒂", apiKey: "gro_test_key" },
      roomId: "room-queue",
      reconnectAttempts: 0,
      members: [],
    };

    const pending = (channel as any).enqueueMessage({
      id: "msg-queue-1",
      content: "排队测试",
      sender: {
        type: "user",
        id: "u-queue",
        uid: "u-queue",
        name: "Queue User",
      },
    }, state);

    expect((channel as any).ingressScheduler.getRuntimeSnapshots()[0]).toMatchObject({
      activeCount: 1,
      queuedCount: 0,
    });

    await started;
    releaseRun?.();
    await pending;

    expect((channel as any).ingressScheduler.getRuntimeSnapshots()[0]).toMatchObject({
      activeCount: 0,
      queuedCount: 0,
    });
  });

  it("records bounded connectivity state when room lookup fails at network layer", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    const channel = new CommunityChannel({
      endpoint: "https://office.goddess.ai",
      agents: [],
      agent: { run: vi.fn() } as any,
      conversationStore: new ConversationStore(),
    });

    let resolveDiagnostic!: (value: unknown) => void;
    const diagnoseSpy = vi.spyOn(channel as any, "diagnoseHttpConnectivity").mockImplementation(() => new Promise((resolve) => {
      resolveDiagnostic = resolve;
    }));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect((channel as any).connectAgent({
      name: "贝露丹蒂",
      apiKey: "gro_test_key",
      room: { name: "vrboyzero" },
    })).rejects.toThrow("fetch failed");

    expect(diagnoseSpy).toHaveBeenCalledWith(
      "https://office.goddess.ai/api/rooms/by-name/vrboyzero",
      expect.any(TypeError),
    );
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      '[community] Failed to resolve room name "vrboyzero" (network):',
      expect.anything(),
    );
    resolveDiagnostic({
      requestUrl: "https://office.goddess.ai/api/rooms/by-name/vrboyzero",
      host: "office.goddess.ai",
      port: 443,
      dns: { ok: true, addresses: ["1.1.1.1"] },
      tcp: { ok: true, address: "1.1.1.1:443" },
      failure: { name: "TypeError", message: "fetch failed" },
    });
    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[channel:community] connectivity_diagnostic_failed",
        expect.objectContaining({
          channel: "community",
          event: "connectivity_diagnostic_failed",
          failureKind: "transport_error",
          context: {
            dnsReachable: true,
            tcpReachable: true,
          },
        }),
      );
    });
    expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain("office.goddess.ai");
    expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain("fetch failed");
  });

  it("deduplicates in-flight connectivity diagnostics for repeated room lookup failures", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    const channel = new CommunityChannel({
      endpoint: "https://office.goddess.ai",
      agents: [],
      agent: { run: vi.fn() } as any,
      conversationStore: new ConversationStore(),
    });

    let resolveDiagnostic!: (value: unknown) => void;
    const diagnoseSpy = vi.spyOn(channel as any, "diagnoseHttpConnectivity").mockImplementation(() => new Promise((resolve) => {
      resolveDiagnostic = resolve;
    }));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect((channel as any).connectAgent({
      name: "贝露丹蒂",
      apiKey: "gro_test_key",
      room: { name: "vrboyzero" },
    })).rejects.toThrow("fetch failed");
    await expect((channel as any).connectAgent({
      name: "贝露丹蒂",
      apiKey: "gro_test_key",
      room: { name: "vrboyzero" },
    })).rejects.toThrow("fetch failed");

    expect(diagnoseSpy).toHaveBeenCalledTimes(1);

    resolveDiagnostic({
      requestUrl: "https://office.goddess.ai/api/rooms/by-name/vrboyzero",
      host: "office.goddess.ai",
      port: 443,
      dns: { ok: true, addresses: ["1.1.1.1"] },
      tcp: { ok: true, address: "1.1.1.1:443" },
      failure: { name: "TypeError", message: "fetch failed" },
    });
    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[channel:community] connectivity_diagnostic_failed",
        expect.objectContaining({
          context: {
            dnsReachable: true,
            tcpReachable: true,
          },
        }),
      );
    });
  });

  it("records HTTP status without logging a remote error body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("room not found", {
        status: 404,
        statusText: "Not Found",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const channel = new CommunityChannel({
      endpoint: "https://office.goddess.ai",
      agents: [],
      agent: { run: vi.fn() } as any,
      conversationStore: new ConversationStore(),
    });

    const diagnoseSpy = vi.spyOn(channel as any, "diagnoseHttpConnectivity");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect((channel as any).connectAgent({
      name: "贝露丹蒂",
      apiKey: "gro_test_key",
      room: { name: "vrboyzero" },
    })).rejects.toThrow('Failed to find room "vrboyzero": Not Found - room not found');

    expect(diagnoseSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[channel:community] room_lookup_failed",
      expect.objectContaining({
        channel: "community",
        event: "room_lookup_failed",
        failureKind: "transport_error",
        context: { status: 404 },
      }),
    );
    expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain("room not found");
    expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain("office.goddess.ai");
  });

  it("applies community channel security with per-account defaults", async () => {
    const agent = {
      run: vi.fn(async function* () {
        yield { type: "final", text: "ok" };
      }),
    };

    const router = createRuleBasedRouter(
      { version: 1, rules: [] },
      {
        defaultAgentId: "default",
        securityConfig: normalizeChannelSecurityConfig({
          channels: {
            community: {
              accounts: {
                "贝露丹蒂": {
                  mentionRequired: {
                    room: true,
                  },
                },
              },
            },
          },
        }),
      },
    );

    const channel = new CommunityChannel({
      endpoint: "https://office.goddess.ai",
      agents: [],
      agent: agent as any,
      conversationStore: new ConversationStore(),
      router,
    });

    const state = {
      ws: { send: vi.fn() },
      agentConfig: { name: "贝露丹蒂", apiKey: "gro_test_key" },
      roomId: "room-mention",
      reconnectAttempts: 0,
      members: [],
    };

    await (channel as any).handleChatMessage({
      id: "msg-room-blocked",
      content: "你好",
      sender: {
        type: "user",
        id: "u-mention",
        uid: "u-mention",
        name: "Alice",
      },
    }, state);

    expect(agent.run).not.toHaveBeenCalled();

    await (channel as any).handleChatMessage({
      id: "msg-room-allowed",
      content: "@贝露丹蒂 你好",
      sender: {
        type: "user",
        id: "u-mention",
        uid: "u-mention",
        name: "Alice",
      },
    }, state);

    expect(agent.run).toHaveBeenCalledTimes(1);
    expect(agent.run).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "community:room-mention",
      meta: expect.objectContaining({
        channel: "community",
        accountId: "贝露丹蒂",
        sessionScope: "per-account-channel-peer",
        sessionKey: expect.stringContaining(`account=${encodeURIComponent("贝露丹蒂")}`),
        legacyConversationId: "community:room-mention",
      }),
    }));
  });

  it("runs ingress admission before routing community content to an Agent", async () => {
    const agent = { run: vi.fn() };
    const router = {
      admitIngress: vi.fn(() => ({ allow: false, reason: "channel_security:policy_missing" })),
      decide: vi.fn(),
    };
    const channel = new CommunityChannel({
      endpoint: "https://office.goddess.ai",
      agents: [],
      agent: agent as any,
      conversationStore: new ConversationStore(),
      router: router as any,
    });

    await (channel as any).handleChatMessage({
      id: "community-blocked-before-route",
      content: "untrusted content",
      sender: { type: "user", id: "u-blocked", uid: "u-blocked", name: "Blocked" },
    }, {
      ws: { send: vi.fn() },
      agentConfig: { name: "贝露丹蒂", apiKey: "gro_test_key" },
      roomId: "room-blocked",
      reconnectAttempts: 0,
      members: [],
    });

    expect(router.admitIngress).toHaveBeenCalledWith(expect.objectContaining({
      channel: "community",
      text: "",
      chatKind: "room",
    }));
    expect(router.decide).not.toHaveBeenCalled();
    expect(agent.run).not.toHaveBeenCalled();
  });

  it("chunks long community room replies through the shared outbound chunker", async () => {
    const wsSend = vi.fn();
    const longCode = Array.from({ length: 360 }, (_, index) => `console.log("line-${index}-xxxxxxxx");`).join("\n");
    const agent = {
      run: vi.fn(async function* () {
        yield { type: "final", text: `Intro\n\n\`\`\`ts\n${longCode}\n\`\`\`\n\nTail` };
      }),
    };

    const channel = new CommunityChannel({
      endpoint: "https://office.goddess.ai",
      agents: [],
      agent: agent as any,
      conversationStore: new ConversationStore(),
      replyChunkingConfig: normalizeReplyChunkingConfig({
        channels: {
          community: {
            accounts: {
              "贝露丹蒂": {
                textLimit: 140,
                chunkMode: "length",
              },
            },
          },
        },
      }),
    });

    await (channel as any).handleChatMessage({
      id: "msg-room-chunked",
      content: "@贝露丹蒂 你好",
      sender: {
        type: "user",
        id: "u-chunk",
        uid: "u-chunk",
        name: "Alice",
      },
    }, {
      ws: { send: wsSend },
      agentConfig: { name: "贝露丹蒂", apiKey: "gro_test_key" },
      roomId: "room-chunk",
      reconnectAttempts: 0,
      members: [],
    });

    expect(wsSend.mock.calls.length).toBeGreaterThan(1);
    for (const [payload] of wsSend.mock.calls) {
      const parsed = JSON.parse(String(payload)) as { data?: { content?: string } };
      const content = parsed.data?.content ?? "";
      expect(content.length).toBeLessThanOrEqual(140);
      expect(((content.match(/```/g) ?? []).length) % 2).toBe(0);
    }
  });

  it("falls back to persisted current conversation binding when proactive roomId is omitted", async () => {
    const wsSend = vi.fn();
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "community-binding-"));
    const channel = new CommunityChannel({
      endpoint: "https://office.goddess.ai",
      agents: [],
      agent: { run: vi.fn(async function* () { yield { type: "final", text: "ok" }; }) } as any,
      conversationStore: new ConversationStore(),
      currentConversationBindingStore: createFileCurrentConversationBindingStore(
        path.join(stateDir, "bindings.json"),
      ),
    });

    const openSocket = {
      readyState: 1,
      send: wsSend,
    } as any;
    (channel as any).connections.set("贝露丹蒂", {
      ws: openSocket,
      agentConfig: { name: "贝露丹蒂", apiKey: "gro_test_key" },
      roomId: "room-bind",
      reconnectAttempts: 0,
      members: [],
    });

    try {
      await (channel as any).handleChatMessage({
        id: "msg-bind-1",
        content: "@贝露丹蒂 你好",
        sender: {
          type: "user",
          id: "u-bind",
          uid: "u-bind",
          name: "Alice",
        },
      }, {
        ws: openSocket,
        agentConfig: { name: "贝露丹蒂", apiKey: "gro_test_key" },
        roomId: "room-bind",
        reconnectAttempts: 0,
        members: [],
      });

      wsSend.mockClear();
      const sent = await channel.sendProactiveMessage("manual");

      expect(sent).toBe(true);
      expect(wsSend).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(wsSend.mock.calls[0][0]))).toEqual({
        type: "message",
        data: { content: "manual" },
      });
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("accepts canonical sessionKey as proactive target", async () => {
    const wsSend = vi.fn();
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "community-binding-session-key-"));
    const channel = new CommunityChannel({
      endpoint: "https://office.goddess.ai",
      agents: [],
      agent: { run: vi.fn(async function* () { yield { type: "final", text: "ok" }; }) } as any,
      conversationStore: new ConversationStore(),
      currentConversationBindingStore: createFileCurrentConversationBindingStore(
        path.join(stateDir, "bindings.json"),
      ),
    });

    const openSocket = {
      readyState: 1,
      send: wsSend,
    } as any;
    (channel as any).connections.set("贝露丹蒂", {
      ws: openSocket,
      agentConfig: { name: "贝露丹蒂", apiKey: "gro_test_key" },
      roomId: "room-bind",
      reconnectAttempts: 0,
      members: [],
    });

    try {
      await (channel as any).handleChatMessage({
        id: "msg-bind-1",
        content: "@贝露丹蒂 你好",
        sender: {
          type: "user",
          id: "u-bind",
          uid: "u-bind",
          name: "Alice",
        },
      }, {
        ws: openSocket,
        agentConfig: { name: "贝露丹蒂", apiKey: "gro_test_key" },
        roomId: "room-bind",
        reconnectAttempts: 0,
        members: [],
      });

      wsSend.mockClear();
      const session = buildChannelSessionDescriptor({
        channel: "community",
        accountId: "贝露丹蒂",
        chatKind: "room",
        chatId: "room-bind",
        senderId: "u-bind",
      });
      const sent = await channel.sendProactiveMessage("manual", { sessionKey: session.sessionKey });

      expect(sent).toBe(true);
      expect(wsSend).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(wsSend.mock.calls[0][0]))).toEqual({
        type: "message",
        data: { content: "manual" },
      });
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("rejects explicit sessionKey when binding belongs to another channel", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const wsSend = vi.fn();
    const channel = new CommunityChannel({
      endpoint: "https://office.goddess.ai",
      agents: [],
      agent: { run: vi.fn(async function* () { yield { type: "final", text: "ok" }; }) } as any,
      conversationStore: new ConversationStore(),
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
    expect(wsSend).not.toHaveBeenCalled();
  });
});
