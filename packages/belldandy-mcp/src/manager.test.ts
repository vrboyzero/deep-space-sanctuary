import { describe, expect, it, vi, afterEach } from "vitest";

import { MCPManager } from "./manager.js";
import { MCPClient } from "./client.js";
import * as configModule from "./config.js";
import * as loggerAdapter from "./logger-adapter.js";
import * as toolBridgeModule from "./tool-bridge.js";

describe("MCPManager", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes the global timeout and caller signal to a server without an override", async () => {
    const manager = new MCPManager();
    (manager as unknown as { config: unknown }).config = {
      version: "1.0.0",
      settings: {
        defaultTimeout: 12345,
      },
      servers: [
        {
          id: "server_timeout_default",
          name: "Server Timeout Default",
          enabled: true,
          transport: {
            type: "stdio",
            command: "node",
          },
        },
      ],
    };
    const abortController = new AbortController();
    const connectSpy = vi.spyOn(MCPClient.prototype, "connect").mockImplementation(
      async function mockConnect(this: MCPClient) {
        (this as unknown as { status: string; tools: unknown[]; resources: unknown[] }).status = "connected";
        (this as unknown as { tools: unknown[] }).tools = [];
        (this as unknown as { resources: unknown[] }).resources = [];
      },
    );

    await manager.connect("server_timeout_default", { signal: abortController.signal });

    expect(connectSpy).toHaveBeenCalledWith(expect.objectContaining({
      failureLogLevel: "none",
      signal: abortController.signal,
    }));
    const managedClient = (manager as unknown as { clients: Map<string, MCPClient> })
      .clients
      .get("server_timeout_default");
    expect(managedClient as unknown as { defaultTimeoutMs: number }).toEqual(
      expect.objectContaining({ defaultTimeoutMs: 12345 }),
    );
  });

  it("does not create a transport when the caller cancels before its connect lock runs", async () => {
    const manager = new MCPManager();
    (manager as unknown as { config: unknown }).config = {
      version: "1.0.0",
      servers: [
        {
          id: "server_cancel_connect",
          name: "Server Cancel Connect",
          enabled: true,
          transport: {
            type: "stdio",
            command: "node",
          },
        },
      ],
    };
    const abortController = new AbortController();
    abortController.abort();
    const connectSpy = vi.spyOn(MCPClient.prototype, "connect");

    await expect(manager.connect("server_cancel_connect", { signal: abortController.signal }))
      .rejects
      .toThrow("connect cancelled by caller");

    expect(connectSpy).not.toHaveBeenCalled();
  });

  it("does not auto-reconnect a client cancelled by its caller", () => {
    const manager = new MCPManager();
    const internals = manager as unknown as {
      handleClientEvent: (event: {
        type: "server:error";
        serverId: string;
        timestamp: Date;
        data: unknown;
      }) => void;
      scheduleAutoReconnect: (serverId: string, reason: "server:error") => Promise<void>;
    };
    const scheduleSpy = vi.spyOn(internals, "scheduleAutoReconnect").mockResolvedValue(undefined);

    internals.handleClientEvent({
      type: "server:error",
      serverId: "server_cancelled",
      timestamp: new Date(),
      data: {
        diagnostics: {
          lastErrorKind: "cancelled",
          lastErrorSource: "call_tool",
        },
      },
    });

    expect(scheduleSpy).not.toHaveBeenCalled();
  });

  it("serializes concurrent connect calls for the same server", async () => {
    const manager = new MCPManager();
    (manager as unknown as { config: unknown }).config = {
      version: 1,
      servers: [
        {
          id: "server_a",
          name: "Server A",
          enabled: true,
          transport: {
            type: "sse",
            url: "http://127.0.0.1:8080/sse",
          },
        },
      ],
    };

    let connectCalls = 0;
    vi.spyOn(MCPClient.prototype, "connect").mockImplementation(async function mockConnect(this: MCPClient) {
      connectCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      (this as unknown as {
        status: string;
        tools: unknown[];
        resources: unknown[];
        diagnostics: { connectionAttempts: number; reconnectAttempts: number; lastErrorKind?: string };
      }).status = "connected";
      (this as unknown as { tools: unknown[] }).tools = [];
      (this as unknown as { resources: unknown[] }).resources = [];
      (this as unknown as {
        diagnostics: { connectionAttempts: number; reconnectAttempts: number; lastErrorKind?: string };
      }).diagnostics = {
        connectionAttempts: 1,
        reconnectAttempts: 0,
        lastErrorKind: "transport",
      };
    });

    await Promise.all([
      manager.connect("server_a"),
      manager.connect("server_a"),
    ]);

    expect(connectCalls).toBe(1);
    expect(manager.getServerState("server_a")?.status).toBe("connected");
    expect(manager.getDiagnostics().servers[0]?.diagnostics).toEqual(expect.objectContaining({
      connectionAttempts: 1,
      lastErrorKind: "transport",
    }));
  });

  it("removes failed clients from the manager after connect failure", async () => {
    vi.spyOn(loggerAdapter, "mcpError").mockImplementation(() => {});
    const manager = new MCPManager();
    (manager as unknown as { config: unknown }).config = {
      version: 1,
      servers: [
        {
          id: "server_fail",
          name: "Server Fail",
          enabled: true,
          transport: {
            type: "sse",
            url: "http://127.0.0.1:8081/sse",
          },
        },
      ],
    };

    const removeListenerSpy = vi.spyOn(MCPClient.prototype, "removeEventListener");
    vi.spyOn(MCPClient.prototype, "connect").mockRejectedValue(new Error("connect failed"));

    await expect(manager.connect("server_fail")).rejects.toThrow("connect failed");

    expect(manager.getServerState("server_fail")).toBeUndefined();
    expect(removeListenerSpy).toHaveBeenCalledTimes(1);
  });

  it("logs auto-connect failures as warnings during initialize", async () => {
    const manager = new MCPManager();
    const starweaverCentralConfig = {
      id: "starweaver-central",
      name: "starweaver-central",
      enabled: true,
      autoConnect: true,
      transport: {
        type: "sse" as const,
        url: "http://127.0.0.1:28767/sse",
      },
    };

    vi.spyOn(configModule, "createDefaultConfig").mockResolvedValue(undefined);
    vi.spyOn(configModule, "loadConfig").mockResolvedValue({
      version: "1.0.0",
      servers: [starweaverCentralConfig],
    });
    vi.spyOn(configModule, "getAutoConnectServers").mockResolvedValue([starweaverCentralConfig]);
    vi.spyOn(
      MCPClient.prototype as unknown as { createTransport: () => Promise<unknown> },
      "createTransport",
    ).mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:28767"));

    const warnSpy = vi.spyOn(loggerAdapter, "mcpWarn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(loggerAdapter, "mcpError").mockImplementation(() => {});

    await manager.initialize();

    expect(warnSpy).toHaveBeenCalledWith(
      "MCPManager",
      "连接服务器 starweaver-central 失败",
      expect.any(Error),
    );
    expect(errorSpy).not.toHaveBeenCalled();
    expect(manager.getDiagnostics().initialized).toBe(true);
    expect(manager.getServerState("starweaver-central")).toBeUndefined();
  });

  it("logs explicit connect failures only once at manager level", async () => {
    const manager = new MCPManager();
    (manager as unknown as { config: unknown }).config = {
      version: "1.0.0",
      servers: [
        {
          id: "server_manual_connect",
          name: "Server Manual Connect",
          enabled: true,
          transport: {
            type: "sse",
            url: "http://127.0.0.1:8089/sse",
          },
        },
      ],
    };

    vi.spyOn(
      MCPClient.prototype as unknown as { createTransport: () => Promise<unknown> },
      "createTransport",
    ).mockRejectedValue(new Error("connect failed"));
    const warnSpy = vi.spyOn(loggerAdapter, "mcpWarn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(loggerAdapter, "mcpError").mockImplementation(() => {});

    await expect(manager.connect("server_manual_connect")).rejects.toThrow("connect failed");

    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "MCPManager",
      "连接服务器 server_manual_connect 失败",
      expect.any(Error),
    );
  });

  it("removes manager event listeners from clients on disconnect", async () => {
    const manager = new MCPManager();
    (manager as unknown as { config: unknown }).config = {
      version: 1,
      servers: [
        {
          id: "server_disconnect",
          name: "Server Disconnect",
          enabled: true,
          transport: {
            type: "sse",
            url: "http://127.0.0.1:8082/sse",
          },
        },
      ],
    };

    vi.spyOn(MCPClient.prototype, "connect").mockImplementation(async function mockConnect(this: MCPClient) {
      (this as unknown as { status: string; tools: unknown[]; resources: unknown[] }).status = "connected";
      (this as unknown as { tools: unknown[] }).tools = [];
      (this as unknown as { resources: unknown[] }).resources = [];
    });
    vi.spyOn(MCPClient.prototype, "disconnect").mockImplementation(async function mockDisconnect(this: MCPClient) {
      (this as unknown as { status: string }).status = "disconnected";
    });
    const removeListenerSpy = vi.spyOn(MCPClient.prototype, "removeEventListener");

    await manager.connect("server_disconnect");
    await manager.disconnect("server_disconnect");

    expect(removeListenerSpy).toHaveBeenCalledTimes(1);
    expect(manager.getServerState("server_disconnect")).toBeUndefined();
  });

  it("summarizes recovery and persisted-result diagnostics across servers", async () => {
    const manager = new MCPManager();
    (manager as unknown as { config: unknown }).config = {
      version: 1,
      servers: [
        {
          id: "server_summary",
          name: "Server Summary",
          enabled: true,
          transport: {
            type: "sse",
            url: "http://127.0.0.1:8083/sse",
          },
        },
      ],
    };

    vi.spyOn(MCPClient.prototype, "connect").mockImplementation(async function mockConnect(this: MCPClient) {
      (this as unknown as { status: string; tools: unknown[]; resources: unknown[] }).status = "connected";
      (this as unknown as { tools: unknown[] }).tools = [];
      (this as unknown as { resources: unknown[] }).resources = [];
      (this as unknown as {
        diagnostics: {
          connectionAttempts: number;
          reconnectAttempts: number;
          lastErrorAt?: Date;
          lastRecoveryAt?: Date;
          lastRecoverySucceeded?: boolean;
          lastResult?: {
            at: Date;
            source: "call_tool";
            strategy: "persisted";
            estimatedChars: number;
            truncatedItems: number;
            persistedItems?: number;
            persistedWebPath?: string;
          };
        };
      }).diagnostics = {
        connectionAttempts: 1,
        reconnectAttempts: 1,
        lastErrorAt: new Date("2026-04-02T10:00:00.000Z"),
        lastRecoveryAt: new Date("2026-04-02T10:01:00.000Z"),
        lastRecoverySucceeded: true,
        lastResult: {
          at: new Date("2026-04-02T10:02:00.000Z"),
          source: "call_tool",
          strategy: "persisted",
          estimatedChars: 4096,
          truncatedItems: 1,
          persistedItems: 1,
          persistedWebPath: "/generated/mcp-summary.txt",
        },
      };
    });

    await manager.connect("server_summary");

    expect(manager.getDiagnostics().summary).toEqual({
      recentErrorServers: 1,
      recoveryAttemptedServers: 1,
      recoverySucceededServers: 1,
      persistedResultServers: 1,
      truncatedResultServers: 1,
    });
  });

  it("routes resource reads through the cached resource index", async () => {
    const manager = new MCPManager();
    (manager as unknown as { config: unknown }).config = {
      version: 1,
      servers: [
        {
          id: "server_a",
          name: "Server A",
          enabled: true,
          transport: {
            type: "sse",
            url: "http://127.0.0.1:8084/sse",
          },
        },
        {
          id: "server_b",
          name: "Server B",
          enabled: true,
          transport: {
            type: "sse",
            url: "http://127.0.0.1:8085/sse",
          },
        },
      ],
    };

    const getStateSpy = vi.spyOn(MCPClient.prototype, "getState");
    const readResourceSpy = vi.spyOn(MCPClient.prototype, "readResource").mockImplementation(async function mockReadResource(this: MCPClient, uri: string) {
      return {
        contents: [{
          uri,
          mimeType: "text/plain",
          text: `from:${this.serverId}`,
        }],
      };
    });
    vi.spyOn(MCPClient.prototype, "connect").mockImplementation(async function mockConnect(this: MCPClient) {
      (this as unknown as { status: string; tools: unknown[]; resources: unknown[] }).status = "connected";
      (this as unknown as { tools: unknown[] }).tools = [];
      (this as unknown as { resources: unknown[] }).resources = [{
        uri: `resource://${this.serverId}/demo`,
        name: `resource-${this.serverId}`,
        serverId: this.serverId,
      }];
    });

    await manager.connect("server_a");
    await manager.connect("server_b");
    getStateSpy.mockClear();
    readResourceSpy.mockClear();

    const result = await manager.readResource({ uri: "resource://server_b/demo" });

    expect(result.contents[0]).toEqual(expect.objectContaining({
      uri: "resource://server_b/demo",
      text: "from:server_b",
    }));
    expect(readResourceSpy).toHaveBeenCalledTimes(1);
    expect(getStateSpy).not.toHaveBeenCalled();
  });

  it("caches tool inventory transforms until the tool generation changes", async () => {
    const manager = new MCPManager();
    (manager as unknown as { config: unknown }).config = {
      version: 1,
      servers: [
        {
          id: "server_tools",
          name: "Server Tools",
          enabled: true,
          transport: {
            type: "sse",
            url: "http://127.0.0.1:8086/sse",
          },
        },
      ],
    };

    vi.spyOn(MCPClient.prototype, "connect").mockImplementation(async function mockConnect(this: MCPClient) {
      (this as unknown as { status: string; tools: unknown[]; resources: unknown[] }).status = "connected";
      (this as unknown as { tools: unknown[] }).tools = [{
        name: "demo_tool",
        bridgedName: "mcp_server_tools_demo_tool",
        description: "demo tool",
        inputSchema: {
          type: "object",
          properties: {},
        },
        serverId: this.serverId,
      }];
      (this as unknown as { resources: unknown[] }).resources = [];
    });

    const openAISpy = vi.spyOn(toolBridgeModule, "toOpenAIFunctions");
    const anthropicSpy = vi.spyOn(toolBridgeModule, "toAnthropicTools");

    await manager.connect("server_tools");

    expect(manager.getOpenAIFunctions()).toHaveLength(1);
    expect(manager.getOpenAIFunctions()).toHaveLength(1);
    expect(manager.getAnthropicTools()).toHaveLength(1);
    expect(manager.getAnthropicTools()).toHaveLength(1);
    expect(openAISpy).toHaveBeenCalledTimes(1);
    expect(anthropicSpy).toHaveBeenCalledTimes(1);

    const client = (manager as unknown as { clients: Map<string, MCPClient> }).clients.get("server_tools");
    expect(client).toBeDefined();
    (client as unknown as { tools: unknown[] }).tools = [
      {
        name: "demo_tool",
        bridgedName: "mcp_server_tools_demo_tool",
        description: "demo tool",
        inputSchema: {
          type: "object",
          properties: {},
        },
        serverId: "server_tools",
      },
      {
        name: "demo_tool_2",
        bridgedName: "mcp_server_tools_demo_tool_2",
        description: "demo tool 2",
        inputSchema: {
          type: "object",
          properties: {},
        },
        serverId: "server_tools",
      },
    ];

    (manager as unknown as { handleClientEvent: (event: unknown) => void }).handleClientEvent({
      type: "tools:updated",
      serverId: "server_tools",
      timestamp: new Date(),
      data: undefined,
    });

    expect(manager.getOpenAIFunctions()).toHaveLength(2);
    expect(manager.getAnthropicTools()).toHaveLength(2);
    expect(openAISpy).toHaveBeenCalledTimes(2);
    expect(anthropicSpy).toHaveBeenCalledTimes(2);
  });

  it("auto-reconnects servers after unexpected disconnect events", async () => {
    vi.spyOn(loggerAdapter, "mcpWarn").mockImplementation(() => {});
    const manager = new MCPManager();
    (manager as unknown as { config: unknown }).config = {
      version: 1,
      servers: [
        {
          id: "server_auto_reconnect",
          name: "Server Auto Reconnect",
          enabled: true,
          transport: {
            type: "sse",
            url: "http://127.0.0.1:8087/sse",
          },
        },
      ],
    };

    vi.spyOn(MCPClient.prototype, "connect").mockImplementation(async function mockConnect(this: MCPClient) {
      (this as unknown as { status: string; tools: unknown[]; resources: unknown[] }).status = "connected";
      (this as unknown as { tools: unknown[] }).tools = [];
      (this as unknown as { resources: unknown[] }).resources = [];
    });
    vi.spyOn(MCPClient.prototype, "disconnect").mockImplementation(async function mockDisconnect(this: MCPClient) {
      (this as unknown as { status: string }).status = "disconnected";
    });

    await manager.connect("server_auto_reconnect");
    const reconnectSpy = vi.spyOn(manager, "reconnect").mockResolvedValue(undefined);

    (manager as unknown as { handleClientEvent: (event: unknown) => void }).handleClientEvent({
      type: "server:disconnected",
      serverId: "server_auto_reconnect",
      timestamp: new Date(),
      data: {
        diagnostics: {},
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(reconnectSpy).toHaveBeenCalledWith("server_auto_reconnect");
  });

  it("does not auto-reconnect servers marked as manually disconnecting", async () => {
    const manager = new MCPManager();
    (manager as unknown as { config: unknown }).config = {
      version: 1,
      servers: [
        {
          id: "server_manual_disconnect",
          name: "Server Manual Disconnect",
          enabled: true,
          transport: {
            type: "sse",
            url: "http://127.0.0.1:8088/sse",
          },
        },
      ],
    };

    vi.spyOn(MCPClient.prototype, "connect").mockImplementation(async function mockConnect(this: MCPClient) {
      (this as unknown as { status: string; tools: unknown[]; resources: unknown[] }).status = "connected";
      (this as unknown as { tools: unknown[] }).tools = [];
      (this as unknown as { resources: unknown[] }).resources = [];
    });
    vi.spyOn(MCPClient.prototype, "disconnect").mockImplementation(async function mockDisconnect(this: MCPClient) {
      (this as unknown as { status: string }).status = "disconnected";
    });

    await manager.connect("server_manual_disconnect");
    const reconnectSpy = vi.spyOn(manager, "reconnect").mockResolvedValue(undefined);
    (
      manager as unknown as { manualDisconnectServers: Set<string> }
    ).manualDisconnectServers.add("server_manual_disconnect");

    (manager as unknown as { handleClientEvent: (event: unknown) => void }).handleClientEvent({
      type: "server:disconnected",
      serverId: "server_manual_disconnect",
      timestamp: new Date(),
      data: {
        diagnostics: {},
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(reconnectSpy).not.toHaveBeenCalled();
  });
});
