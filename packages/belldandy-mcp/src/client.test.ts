import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  MCPClient,
  calculateMCPReconnectDelay,
  classifyStdioStderrLine,
  expandFilesystemServerArgs,
  parseExtraWorkspaceRoots,
  shouldPipeStdioStderr,
} from "./client.js";
import * as loggerAdapter from "./logger-adapter.js";

describe("parseExtraWorkspaceRoots", () => {
  it("splits BELLDANDY_EXTRA_WORKSPACE_ROOTS and removes duplicates", () => {
    const roots = parseExtraWorkspaceRoots({
      BELLDANDY_EXTRA_WORKSPACE_ROOTS: "E:/project/star-sanctuary, E:/project/star-sanctuary , E:/project/docs",
    });

    expect(roots).toHaveLength(2);
    expect(roots[0].toLowerCase()).toContain("e:");
    expect(roots[0].replace(/\\/g, "/")).toContain("/project/star-sanctuary");
    expect(roots[1].replace(/\\/g, "/")).toContain("/project/docs");
  });
});

describe("expandFilesystemServerArgs", () => {
  it("uses env roots when filesystem MCP has no explicit roots", () => {
    const args = expandFilesystemServerArgs(
      "cmd",
      ["/c", "npx", "@modelcontextprotocol/server-filesystem"],
      { BELLDANDY_EXTRA_WORKSPACE_ROOTS: "E:/project/star-sanctuary,E:/project/assets" },
    );

    expect(args).toEqual([
      "/c",
      "npx",
      "@modelcontextprotocol/server-filesystem",
      expect.stringMatching(/project[\\/]+star-sanctuary$/),
      expect.stringMatching(/project[\\/]+assets$/),
    ]);
  });

  it("appends BELLDANDY_EXTRA_WORKSPACE_ROOTS to filesystem MCP roots", () => {
    const args = expandFilesystemServerArgs(
      "cmd",
      ["/c", "npx", "@modelcontextprotocol/server-filesystem", "C:/Users/admin/.star_sanctuary"],
      { BELLDANDY_EXTRA_WORKSPACE_ROOTS: "E:/project/star-sanctuary,E:/project/assets" },
    );

    expect(args).toEqual([
      "/c",
      "npx",
      "@modelcontextprotocol/server-filesystem",
      "C:/Users/admin/.star_sanctuary",
      expect.stringMatching(/project[\\/]+star-sanctuary$/),
      expect.stringMatching(/project[\\/]+assets$/),
    ]);
  });

  it("does not change non-filesystem MCP commands", () => {
    const args = expandFilesystemServerArgs(
      "npx",
      ["-y", "chrome-devtools-mcp@latest"],
      { BELLDANDY_EXTRA_WORKSPACE_ROOTS: "E:/project/star-sanctuary" },
    );

    expect(args).toEqual(["-y", "chrome-devtools-mcp@latest"]);
  });

  it("does not append duplicated roots", () => {
    const args = expandFilesystemServerArgs(
      "npx",
      ["-y", "@modelcontextprotocol/server-filesystem", "E:/project/star-sanctuary"],
      { BELLDANDY_EXTRA_WORKSPACE_ROOTS: "E:/project/star-sanctuary" },
    );

    expect(args).toEqual(["-y", "@modelcontextprotocol/server-filesystem", "E:/project/star-sanctuary"]);
  });
});

describe("stdio stderr filtering", () => {
  it("pipes chrome-devtools stderr so noisy known lines can be filtered", () => {
    expect(shouldPipeStdioStderr("chrome-devtools")).toBe(true);
    expect(shouldPipeStdioStderr("filesystem")).toBe(false);
  });

  it("suppresses known chrome-devtools PerformanceIssue noise", () => {
    expect(classifyStdioStderrLine("chrome-devtools", "No handler registered for issue code PerformanceIssue")).toBe("ignore");
    expect(classifyStdioStderrLine("chrome-devtools", "Google collects usage statistics to improve Chrome DevTools MCP.")).toBe("forward");
    expect(classifyStdioStderrLine("filesystem", "No handler registered for issue code PerformanceIssue")).toBe("forward");
  });
});

describe("MCPClient reconnect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function createClient() {
    return new MCPClient({
      id: "test-server",
      name: "Test Server",
      transport: {
        type: "sse",
        url: "http://127.0.0.1:3000/sse",
      },
      retryCount: 3,
      retryDelay: 1000,
    });
  }

  it("uses capped exponential backoff with bounded jitter", () => {
    expect(calculateMCPReconnectDelay(1, 1_000, 30_000, () => 0)).toBe(500);
    expect(calculateMCPReconnectDelay(2, 1_000, 30_000, () => 0)).toBe(1_000);
    expect(calculateMCPReconnectDelay(3, 1_000, 30_000, () => 0.999_999)).toBe(4_000);
    expect(calculateMCPReconnectDelay(10, 10_000, 30_000, () => 0)).toBe(15_000);
    expect(calculateMCPReconnectDelay(10, 10_000, 30_000, () => 0.999_999)).toBe(30_000);
  });

  it("cancels pending reconnect delay when disconnected", async () => {
    const client = createClient();
    const clientInternals = client as unknown as { cleanup: () => Promise<void> };
    const cleanupSpy = vi.spyOn(clientInternals, "cleanup").mockResolvedValue(undefined);
    const connectSpy = vi.spyOn(client, "connect").mockResolvedValue(undefined);

    const reconnectPromise = client.reconnect();

    await vi.advanceTimersByTimeAsync(200);
    await client.disconnect();
    await vi.runAllTimersAsync();
    await reconnectPromise;

    expect(connectSpy).not.toHaveBeenCalled();
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
    expect(client.getState().status).toBe("disconnected");
  });

  it("reuses the same reconnect loop for concurrent callers", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999_999);
    const client = createClient();
    const clientInternals = client as unknown as { cleanup: () => Promise<void> };
    const cleanupSpy = vi.spyOn(clientInternals, "cleanup").mockResolvedValue(undefined);
    const connectSpy = vi.spyOn(client, "connect").mockResolvedValue(undefined);

    const reconnectA = client.reconnect();
    const reconnectB = client.reconnect();

    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all([reconnectA, reconnectB]);

    expect(cleanupSpy).toHaveBeenCalledTimes(1);
    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(client.getState().diagnostics).toEqual(expect.objectContaining({
      reconnectAttempts: 1,
      lastRetryDelayMs: 1000,
      lastRetryAttempt: 1,
      lastRetryMax: 3,
    }));
    expect(client.getState().diagnostics?.lastRetryAt).toBeInstanceOf(Date);
  });

  it("classifies session expiry failures in runtime diagnostics", () => {
    const client = createClient();
    const clientInternals = client as unknown as {
      recordFailure: (
        error: unknown,
        options?: { source?: string; retryable?: boolean; updateCurrentError?: boolean },
      ) => void;
    };

    clientInternals.recordFailure(new Error("Session not found"), {
      source: "call_tool",
      updateCurrentError: false,
    });

    expect(client.getState().diagnostics).toEqual(expect.objectContaining({
      lastErrorKind: "session_expired",
      lastErrorMessage: "Session not found",
      lastErrorSource: "call_tool",
      lastErrorRetryable: true,
    }));
    expect(client.getState().diagnostics?.lastErrorAt).toBeInstanceOf(Date);
    expect(client.getState().diagnostics?.lastSessionExpiredAt).toBeInstanceOf(Date);
  });

  it("can suppress connect failure logging while keeping error diagnostics", async () => {
    const client = createClient();
    vi.spyOn(
      client as unknown as { createTransport: () => Promise<unknown> },
      "createTransport",
    ).mockRejectedValue(new Error("connect failed"));
    const errorSpy = vi.spyOn(loggerAdapter, "mcpError").mockImplementation(() => {});

    await expect(client.connect({ failureLogLevel: "none" })).rejects.toThrow("connect failed");

    expect(errorSpy).not.toHaveBeenCalled();
    expect(client.getState().status).toBe("error");
    expect(client.getState().error).toBe("connect failed");
    expect(client.getState().diagnostics).toEqual(expect.objectContaining({
      lastErrorMessage: "connect failed",
      lastErrorSource: "connect",
      lastErrorRetryable: false,
    }));
  });
});

describe("MCPClient SSE outbound policy", () => {
  it("rejects private and insecure SSE targets by default", async () => {
    const privateClient = new MCPClient({
      id: "private-sse",
      name: "Private SSE",
      transport: { type: "sse", url: "http://127.0.0.1:3000/sse" },
    });
    const insecureClient = new MCPClient({
      id: "insecure-sse",
      name: "Insecure SSE",
      transport: { type: "sse", url: "http://8.8.8.8:3000/sse" },
    });

    await expect((privateClient as unknown as { createTransport: () => Promise<unknown> }).createTransport())
      .rejects.toThrow("private or reserved network");
    await expect((insecureClient as unknown as { createTransport: () => Promise<unknown> }).createTransport())
      .rejects.toThrow("HTTP requires explicit opt-in");
  });

  it("allows local SSE targets only with explicit compatibility switches", async () => {
    const client = new MCPClient({
      id: "local-sse",
      name: "Local SSE",
      transport: {
        type: "sse",
        url: "http://127.0.0.1:3000/sse",
        allowInsecureHttp: true,
        allowPrivateNetwork: true,
      },
    });

    await expect((client as unknown as { createTransport: () => Promise<unknown> }).createTransport())
      .resolves.toBeDefined();
  });
});

describe("MCPClient result normalization", () => {
  let originalStateDir: string | undefined;

  beforeEach(() => {
    originalStateDir = process.env.BELLDANDY_STATE_DIR;
  });

  afterEach(() => {
    if (originalStateDir === undefined) {
      delete process.env.BELLDANDY_STATE_DIR;
    } else {
      process.env.BELLDANDY_STATE_DIR = originalStateDir;
    }
    vi.restoreAllMocks();
  });

  function createConnectedClient() {
    const client = new MCPClient({
      id: "test-server",
      name: "Test Server",
      transport: {
        type: "sse",
        url: "http://127.0.0.1:3000/sse",
      },
    });
    const internals = client as unknown as {
      status: string;
      client: {
        callTool: (input: { name: string; arguments: Record<string, unknown> }) => Promise<unknown>;
        readResource: (input: { uri: string }) => Promise<unknown>;
      };
    };
    internals.status = "connected";
    return { client, internals };
  }

  it("truncates oversized tool text results and reports diagnostics", async () => {
    const { client, internals } = createConnectedClient();
    internals.client = {
      callTool: vi.fn().mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: "x".repeat(13_000) }],
      }),
      readResource: vi.fn(),
    };

    const result = await client.callTool("demo", {});

    expect(result.success).toBe(true);
    expect(result.diagnostics).toEqual(expect.objectContaining({
      strategy: "persisted",
      truncated: false,
      truncatedItems: 0,
      persistedItems: 1,
      persistedWebPath: expect.stringMatching(/^\/generated\/mcp-/),
    }));
    expect(result.content?.[0]).toEqual(expect.objectContaining({
      type: "text",
      truncated: false,
      originalLength: 13_000,
      note: expect.stringContaining("/generated/"),
    }));
    expect(result.content?.[0]?.text).toContain("/generated/");
  });

  it("preserves structuredContent returned by MCP server", async () => {
    const { client, internals } = createConnectedClient();
    internals.client = {
      callTool: vi.fn().mockResolvedValue({
        isError: false,
        structuredContent: {
          ok: true,
          value: 42
        },
        content: [{ type: "text", text: "{\"ok\":true,\"value\":42}" }],
      }),
      readResource: vi.fn(),
    };

    const result = await client.callTool("structured-demo", {});

    expect(result.success).toBe(true);
    expect(result.structuredContent).toEqual({
      ok: true,
      value: 42
    });
  });

  it("omits oversized resource blobs from inline payload and reports diagnostics", async () => {
    const { client, internals } = createConnectedClient();
    internals.client = {
      callTool: vi.fn(),
      readResource: vi.fn().mockResolvedValue({
        contents: [{ uri: "file:///tmp/demo.bin", mimeType: "application/octet-stream", blob: "a".repeat(5_000) }],
      }),
    };

    const result = await client.readResource("file:///tmp/demo.bin");

    expect(result.diagnostics).toEqual(expect.objectContaining({
      strategy: "persisted",
      truncated: false,
      truncatedItems: 0,
      persistedItems: 1,
      persistedWebPath: expect.stringMatching(/^\/generated\/mcp-/),
    }));
    expect(result.contents[0]).toEqual(expect.objectContaining({
      uri: "file:///tmp/demo.bin",
      truncated: false,
      originalLength: 5_000,
      note: expect.stringContaining("/generated/"),
    }));
    expect(result.contents[0]?.blob).toBeUndefined();
  });

  it("hard-limits oversized persisted resource blobs", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-mcp-resource-hard-limit-"));
    process.env.BELLDANDY_STATE_DIR = stateDir;
    const { client, internals } = createConnectedClient();
    internals.client = {
      callTool: vi.fn(),
      readResource: vi.fn().mockResolvedValue({
        contents: [
          {
            uri: "file:///tmp/huge-demo.bin",
            mimeType: "application/octet-stream",
            blob: Buffer.alloc(400_000, 1).toString("base64"),
          },
        ],
      }),
    };

    try {
      const result = await client.readResource("file:///tmp/huge-demo.bin");
      expect(result.diagnostics).toEqual(expect.objectContaining({
        strategy: "persisted",
        truncated: true,
        truncatedItems: 1,
        persistedItems: 1,
      }));
      expect(result.contents[0]).toEqual(expect.objectContaining({
        uri: "file:///tmp/huge-demo.bin",
        truncated: true,
        note: expect.stringContaining("hard limit"),
      }));
      expect(result.contents[0]?.blob).toBeUndefined();

      const generatedDir = path.join(stateDir, "generated");
      const files = await fs.readdir(generatedDir);
      expect(files).toHaveLength(1);
      const persistedStat = await fs.stat(path.join(generatedDir, files[0]!));
      expect(persistedStat.size).toBeLessThan(300_000);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("persists oversized tool text results to generated output and reports persisted diagnostics", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-mcp-persist-"));
    process.env.BELLDANDY_STATE_DIR = stateDir;
    const { client, internals } = createConnectedClient();
    internals.client = {
      callTool: vi.fn().mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: "y".repeat(13_500) }],
      }),
      readResource: vi.fn(),
    };

    try {
      const result = await client.callTool("persist-demo", {});
      expect(result.diagnostics).toEqual(expect.objectContaining({
        strategy: "persisted",
        persistedItems: 1,
        persistedWebPath: expect.stringMatching(/^\/generated\/mcp-/),
      }));
      expect(result.content?.[0]).toEqual(expect.objectContaining({
        type: "text",
        truncated: false,
        note: expect.stringContaining("/generated/"),
      }));
      const generatedDir = path.join(stateDir, "generated");
      const files = await fs.readdir(generatedDir);
      expect(files.some((file) => file.startsWith("mcp-test-server-tool-text-"))).toBe(true);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("hard-limits oversized persisted tool text results", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-mcp-hard-limit-"));
    process.env.BELLDANDY_STATE_DIR = stateDir;
    const { client, internals } = createConnectedClient();
    internals.client = {
      callTool: vi.fn().mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: "z".repeat(400_000) }],
      }),
      readResource: vi.fn(),
    };

    try {
      const result = await client.callTool("hard-limit-demo", {});
      expect(result.success).toBe(true);
      expect(result.diagnostics).toEqual(expect.objectContaining({
        strategy: "persisted",
        truncated: true,
        truncatedItems: 1,
        persistedItems: 1,
      }));
      expect(result.content?.[0]).toEqual(expect.objectContaining({
        type: "text",
        truncated: true,
        note: expect.stringContaining("hard limit"),
      }));

      const generatedDir = path.join(stateDir, "generated");
      const files = await fs.readdir(generatedDir);
      expect(files).toHaveLength(1);
      const persistedStat = await fs.stat(path.join(generatedDir, files[0]!));
      expect(persistedStat.size).toBeLessThan(300_000);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("reconnects once after session expiry during tool call", async () => {
    const { client, internals } = createConnectedClient();
    const expiredError = new Error("Session not found");
    const callTool = vi.fn()
      .mockRejectedValueOnce(expiredError)
      .mockResolvedValueOnce({ isError: false, content: [{ type: "text", text: "ok" }] });
    internals.client = {
      callTool,
      readResource: vi.fn(),
    };
    const reconnectSpy = vi.spyOn(client, "reconnect").mockImplementation(async () => {});

    const result = await client.callTool("recover-demo", {});

    expect(reconnectSpy).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect(client.getState().diagnostics).toEqual(expect.objectContaining({
      lastErrorKind: "session_expired",
      lastErrorSource: "call_tool",
      lastRecoverySucceeded: true,
    }));
    expect(client.getState().diagnostics?.lastRecoveryAt).toBeInstanceOf(Date);
  });
});

describe("MCPClient capability discovery", () => {
  function createDiscoveryClient() {
    const client = new MCPClient({
      id: "test-server",
      name: "Test Server",
      transport: {
        type: "sse",
        url: "http://127.0.0.1:3000/sse",
      },
    });
    const internals = client as unknown as {
      client: {
        listTools: () => Promise<{ tools?: Array<Record<string, unknown>> }>;
        listResources: () => Promise<{ resources?: Array<Record<string, unknown>> }>;
      };
    };
    return { client, internals };
  }

  it("ignores -32601 for resources/list during capability discovery", async () => {
    const { client, internals } = createDiscoveryClient();
    const methodNotFound = Object.assign(new Error("JSON-RPC error -32601: Method not found"), { code: -32601 });
    internals.client = {
      listTools: vi.fn().mockResolvedValue({
        tools: [{
          name: "demo_tool",
          description: "demo",
          inputSchema: { type: "object" },
        }],
      }),
      listResources: vi.fn().mockRejectedValue(methodNotFound),
    };

    await (client as unknown as { discoverCapabilities: () => Promise<void> }).discoverCapabilities();

    const state = client.getState();
    expect(state.tools).toHaveLength(1);
    expect(state.resources).toHaveLength(0);
    expect(state.diagnostics?.lastErrorMessage).toBeUndefined();
    expect(state.diagnostics?.lastErrorSource).toBeUndefined();
  });

  it("ignores -32601 for tools/list during capability discovery and still discovers resources", async () => {
    const { client, internals } = createDiscoveryClient();
    const methodNotFound = Object.assign(new Error("JSON-RPC error -32601: Method not found"), { code: -32601 });
    internals.client = {
      listTools: vi.fn().mockRejectedValue(methodNotFound),
      listResources: vi.fn().mockResolvedValue({
        resources: [{
          uri: "file:///tmp/demo.txt",
          name: "demo-resource",
          description: "demo resource",
          mimeType: "text/plain",
        }],
      }),
    };

    await (client as unknown as { discoverCapabilities: () => Promise<void> }).discoverCapabilities();

    const state = client.getState();
    expect(state.tools).toHaveLength(0);
    expect(state.resources).toHaveLength(1);
    expect(state.diagnostics?.lastErrorMessage).toBeUndefined();
    expect(state.diagnostics?.lastErrorSource).toBeUndefined();
  });
});
