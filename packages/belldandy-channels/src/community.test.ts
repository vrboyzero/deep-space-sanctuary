import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationStore } from "@belldandy/agent";
import { OutboundRequestPolicy } from "@belldandy/protocol";

const { uploadTokenUsageMock, webSocketConstructMock } = vi.hoisted(() => ({
  uploadTokenUsageMock: vi.fn(),
  webSocketConstructMock: vi.fn(),
}));

vi.mock("ws", () => {
  class MockWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readonly send = vi.fn();
    readyState = MockWebSocket.CONNECTING;
    private readonly listeners = new Map<string, Array<{ listener: (...args: any[]) => void; once: boolean }>>();

    constructor(url: string, options?: unknown) {
      webSocketConstructMock(url, options, this);
      queueMicrotask(() => {
        if (this.readyState !== MockWebSocket.CONNECTING) return;
        this.readyState = MockWebSocket.OPEN;
        this.emit("open");
      });
    }

    on(event: string, listener: (...args: any[]) => void): this {
      this.addListener(event, listener, false);
      return this;
    }

    once(event: string, listener: (...args: any[]) => void): this {
      this.addListener(event, listener, true);
      return this;
    }

    removeAllListeners(): this {
      this.listeners.clear();
      return this;
    }

    terminate(): void {
      this.readyState = MockWebSocket.CLOSED;
    }

    close(code = 1000, reason = ""): void {
      this.readyState = MockWebSocket.CLOSED;
      this.emit("close", code, Buffer.from(reason));
    }

    private addListener(event: string, listener: (...args: any[]) => void, once: boolean): void {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push({ listener, once });
      this.listeners.set(event, listeners);
    }

    private emit(event: string, ...args: any[]): void {
      const listeners = [...(this.listeners.get(event) ?? [])];
      for (const entry of listeners) {
        if (entry.once) {
          const current = this.listeners.get(event) ?? [];
          this.listeners.set(event, current.filter((candidate) => candidate !== entry));
        }
        entry.listener(...args);
      }
    }
  }

  return { default: MockWebSocket };
});

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

function createCommunityHttpRequestPolicy(
  fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<unknown>,
): OutboundRequestPolicy {
  return new OutboundRequestPolicy({
    allowedHosts: ["office.goddess.ai"],
    maxRedirects: 0,
    dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
    requestAdapter: async ({ url, init }) => await fetchImpl(url.toString(), {
      method: init.method,
      headers: init.headers,
      body: init.body as BodyInit | undefined,
      signal: init.signal,
    }) as Response,
  });
}

describe("community token usage upload", () => {
  beforeEach(() => {
    uploadTokenUsageMock.mockReset();
    webSocketConstructMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not revive a stopped channel when an agent connection completes late", async () => {
    const channel = new CommunityChannel({
      endpoint: "https://office.goddess.ai",
      agents: [{
        name: "agent-a",
        apiKey: "test-key",
        room: { name: "room-a" },
      }],
      agent: { run: vi.fn() } as any,
      conversationStore: new ConversationStore(),
    });
    let releaseConnect!: () => void;
    const pendingConnect = new Promise<void>((resolve) => {
      releaseConnect = resolve;
    });
    const connectSpy = vi.spyOn(channel as any, "connectAgent").mockImplementation(() => pendingConnect);

    const starting = channel.start();
    await vi.waitFor(() => expect(connectSpy).toHaveBeenCalledTimes(1));
    await channel.stop();
    releaseConnect();

    await expect(starting).rejects.toThrow("Community channel stopped.");
    expect(channel.lifecycleState).toBe("stopped");
    expect(channel.isRunning).toBe(false);
  });

  it("coalesces concurrent proactive sends with the same explicit idempotency key", async () => {
    const send = vi.fn();
    const channel = new CommunityChannel({
      endpoint: "https://office.goddess.ai",
      agents: [],
      agent: { run: vi.fn() } as any,
      conversationStore: new ConversationStore(),
    });
    (channel as any).connections.set("agent-a", {
      ws: {
        readyState: 1,
        send,
      },
      agentConfig: { name: "agent-a", apiKey: "test-key" },
      roomId: "room-a",
      reconnectAttempts: 0,
      members: [],
    });

    const first = (channel as any).sendProactiveMessage(
      "manual",
      { chatId: "room-a" },
      { idempotencyKey: "community-dedupe" },
    );
    const second = (channel as any).sendProactiveMessage(
      "manual",
      { chatId: "room-a" },
      { idempotencyKey: "community-dedupe" },
    );

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(send).toHaveBeenCalledTimes(1);
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

  it("routes community room lookup and join HTTP calls through the pinned policy", async () => {
    const legacyFetch = vi.fn(async () => {
      throw new Error("legacy fetch must not run");
    });
    vi.stubGlobal("fetch", legacyFetch);
    const request = vi.fn(async (input: {
      url: string | URL;
      method?: string;
      headers?: Record<string, string>;
      body?: string | Uint8Array;
      signal?: AbortSignal;
      maxRedirects?: number;
    }) => {
      const url = new URL(input.url.toString());
      return {
        response: url.pathname.includes("/by-name/")
          ? Response.json({ room: { id: "room-policy-id" } })
          : new Response(null, { status: 204 }),
        url,
        addresses: [{ address: "93.184.216.34", family: 4 as const }],
        redirectCount: 0,
      };
    });
    const channel = new CommunityChannel({
      endpoint: "https://office.goddess.ai",
      agents: [],
      agent: { run: vi.fn() } as any,
      conversationStore: new ConversationStore(),
      httpOutboundRequestPolicy: { request },
    });
    const createWebSocketConnection = vi.spyOn(channel as any, "createWebSocketConnection").mockResolvedValue(undefined);

    await expect((channel as any).connectAgent({
      name: "贝露丹蒂",
      apiKey: "gro_test_key",
      room: { name: "vrboyzero", password: "room-password" },
    })).resolves.toBeUndefined();

    expect(legacyFetch).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map(([input]) => new URL(input.url.toString()).pathname)).toEqual([
      "/api/rooms/by-name/vrboyzero",
      "/api/rooms/room-policy-id/join",
    ]);
    for (const [input] of request.mock.calls) {
      expect(input).toEqual(expect.objectContaining({
        signal: expect.any(AbortSignal),
        maxRedirects: 0,
      }));
      expect(input.headers).toEqual(expect.objectContaining({ "X-API-Key": "gro_test_key" }));
    }
    expect(createWebSocketConnection).toHaveBeenCalledWith(
      expect.objectContaining({ name: "贝露丹蒂" }),
      "room-policy-id",
      undefined,
    );
  });

  it("rejects private DNS for community HTTP before transport", async () => {
    const legacyFetch = vi.fn(async () => {
      throw new Error("legacy fetch must not run");
    });
    vi.stubGlobal("fetch", legacyFetch);
    const transport = vi.fn(async () => Response.json({ room: { id: "unsafe-room" } }));
    const channel = new CommunityChannel({
      endpoint: "https://office.goddess.ai",
      agents: [],
      agent: { run: vi.fn() } as any,
      conversationStore: new ConversationStore(),
      httpOutboundRequestPolicy: new OutboundRequestPolicy({
        allowedHosts: ["office.goddess.ai"],
        dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
        requestAdapter: transport,
      }),
    });
    const scheduleConnectivityDiagnostic = vi.spyOn(channel as any, "scheduleConnectivityDiagnostic").mockImplementation(() => {});

    await expect((channel as any).connectAgent({
      name: "贝露丹蒂",
      apiKey: "gro_test_key",
      room: { name: "vrboyzero" },
    })).rejects.toMatchObject({ code: "private_network_not_allowed" });
    expect(legacyFetch).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
    expect(scheduleConnectivityDiagnostic).not.toHaveBeenCalled();
  });

  it("does not replay community API keys across HTTP redirects", async () => {
    const legacyFetch = vi.fn(async () => {
      throw new Error("legacy fetch must not run");
    });
    vi.stubGlobal("fetch", legacyFetch);
    const transport = vi.fn(async (_input: unknown) => new Response(null, {
      status: 307,
      headers: { location: "https://office.goddess.ai/credential-sink" },
    }));
    const channel = new CommunityChannel({
      endpoint: "https://office.goddess.ai",
      agents: [],
      agent: { run: vi.fn() } as any,
      conversationStore: new ConversationStore(),
      httpOutboundRequestPolicy: new OutboundRequestPolicy({
        allowedHosts: ["office.goddess.ai"],
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestAdapter: transport,
      }),
    });
    const scheduleConnectivityDiagnostic = vi.spyOn(channel as any, "scheduleConnectivityDiagnostic").mockImplementation(() => {});

    await expect((channel as any).connectAgent({
      name: "贝露丹蒂",
      apiKey: "gro_test_key",
      room: { name: "vrboyzero" },
    })).rejects.toMatchObject({ code: "redirect_limit" });
    expect(legacyFetch).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(scheduleConnectivityDiagnostic).not.toHaveBeenCalled();
    expect(transport.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      url: new URL("https://office.goddess.ai/api/rooms/by-name/vrboyzero"),
      init: expect.objectContaining({
        headers: expect.objectContaining({ "X-API-Key": "gro_test_key" }),
      }),
    }));
  });

  it("pins community WebSocket upgrades to a policy-approved public address", async () => {
    const resolveAllowedAddresses = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]);
    const channel = new CommunityChannel({
      endpoint: "https://office.goddess.ai",
      agents: [],
      agent: { run: vi.fn() } as any,
      conversationStore: new ConversationStore(),
      webSocketOutboundRequestPolicy: { resolveAllowedAddresses },
    } as any);

    await expect((channel as any).createWebSocketConnection({
      name: "贝露丹蒂",
      apiKey: "gro_test_key",
    }, "room-pinned")).resolves.toBeUndefined();

    expect(resolveAllowedAddresses).toHaveBeenCalledWith(new URL("https://office.goddess.ai"));
    expect(webSocketConstructMock).toHaveBeenCalledTimes(1);
    const [rawUrl, options, socket] = webSocketConstructMock.mock.calls[0] as [string, any, any];
    const wsUrl = new URL(rawUrl);
    expect(wsUrl.protocol).toBe("wss:");
    expect(wsUrl.hostname).toBe("office.goddess.ai");
    expect(wsUrl.pathname).toBe("/ws/room");
    expect(wsUrl.searchParams.get("roomId")).toBe("room-pinned");
    expect(wsUrl.searchParams.get("apiKey")).toBe("gro_test_key");
    expect(options).toEqual(expect.objectContaining({
      followRedirects: false,
      handshakeTimeout: 10_000,
      lookup: expect.any(Function),
    }));

    const lookupCallback = vi.fn();
    options.lookup("office.goddess.ai", {}, lookupCallback);
    expect(lookupCallback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    await expect(channel.sendProactiveMessage("hello", { chatId: "room-pinned" })).resolves.toBe(true);
    expect(socket.send).toHaveBeenCalledTimes(1);
  });

  it("rejects mixed private WebSocket DNS before constructing a socket", async () => {
    const channel = new CommunityChannel({
      endpoint: "https://office.goddess.ai",
      agents: [],
      agent: { run: vi.fn() } as any,
      conversationStore: new ConversationStore(),
      webSocketOutboundRequestPolicy: new OutboundRequestPolicy({
        allowedHosts: ["office.goddess.ai"],
        dnsLookup: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
      }),
    } as any);

    await expect((channel as any).createWebSocketConnection({
      name: "贝露丹蒂",
      apiKey: "gro_test_key",
    }, "room-private")).rejects.toMatchObject({ code: "private_network_not_allowed" });
    expect(webSocketConstructMock).not.toHaveBeenCalled();
  });

  it("rejects insecure community WebSocket endpoints before DNS or socket construction", async () => {
    const resolveAllowedAddresses = vi.fn();
    const channel = new CommunityChannel({
      endpoint: "http://office.goddess.ai",
      agents: [],
      agent: { run: vi.fn() } as any,
      conversationStore: new ConversationStore(),
      webSocketOutboundRequestPolicy: { resolveAllowedAddresses },
    } as any);

    await expect((channel as any).createWebSocketConnection({
      name: "贝露丹蒂",
      apiKey: "gro_test_key",
    }, "room-insecure")).rejects.toMatchObject({ code: "insecure_scheme" });
    expect(resolveAllowedAddresses).not.toHaveBeenCalled();
    expect(webSocketConstructMock).not.toHaveBeenCalled();
  });

  it("rejects a community WebSocket host outside its pinned profile", async () => {
    const channel = new CommunityChannel({
      endpoint: "https://office.goddess.ai",
      agents: [],
      agent: { run: vi.fn() } as any,
      conversationStore: new ConversationStore(),
      webSocketOutboundRequestPolicy: new OutboundRequestPolicy({
        allowedHosts: ["community.example.com"],
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      }),
    } as any);

    await expect((channel as any).createWebSocketConnection({
      name: "贝露丹蒂",
      apiKey: "gro_test_key",
    }, "room-denied-host")).rejects.toMatchObject({ code: "host_not_allowed" });
    expect(webSocketConstructMock).not.toHaveBeenCalled();
  });

  it("does not construct a community WebSocket after lifecycle abort during DNS admission", async () => {
    let releaseDns!: () => void;
    const pendingDns = new Promise<void>((resolve) => {
      releaseDns = resolve;
    });
    const resolveAllowedAddresses = vi.fn(async () => {
      await pendingDns;
      return [{ address: "93.184.216.34", family: 4 as const }];
    });
    const channel = new CommunityChannel({
      endpoint: "https://office.goddess.ai",
      agents: [],
      agent: { run: vi.fn() } as any,
      conversationStore: new ConversationStore(),
      webSocketOutboundRequestPolicy: { resolveAllowedAddresses },
    } as any);
    const controller = new AbortController();

    const pending = (channel as any).createWebSocketConnection({
      name: "贝露丹蒂",
      apiKey: "gro_test_key",
    }, "room-aborted", controller.signal);
    await vi.waitFor(() => expect(resolveAllowedAddresses).toHaveBeenCalledTimes(1));
    controller.abort(new Error("community stopped during DNS admission"));
    releaseDns();

    await expect(pending).rejects.toThrow("community stopped during DNS admission");
    expect(webSocketConstructMock).not.toHaveBeenCalled();
  });

  it("records bounded connectivity state when room lookup fails at network layer", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    const channel = new CommunityChannel({
      endpoint: "https://office.goddess.ai",
      agents: [],
      agent: { run: vi.fn() } as any,
      conversationStore: new ConversationStore(),
      httpOutboundRequestPolicy: createCommunityHttpRequestPolicy(fetchMock),
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
      httpOutboundRequestPolicy: createCommunityHttpRequestPolicy(fetchMock),
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
      httpOutboundRequestPolicy: createCommunityHttpRequestPolicy(fetchMock),
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
