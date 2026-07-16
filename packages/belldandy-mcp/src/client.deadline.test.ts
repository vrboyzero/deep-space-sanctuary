import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MCPClient } from "./client.js";
import * as loggerAdapter from "./logger-adapter.js";

type Settlement =
  | { kind: "fulfilled"; value: unknown }
  | { kind: "rejected"; error: unknown }
  | { kind: "pending" };

function neverSettles<T>(): Promise<T> {
  return new Promise(() => {});
}

async function observeSettlement(promise: Promise<unknown>, waitMs: number): Promise<Settlement> {
  const observed = Promise.race<Settlement>([
    promise.then(
      (value) => ({ kind: "fulfilled", value }),
      (error) => ({ kind: "rejected", error }),
    ),
    new Promise<Settlement>((resolve) => {
      setTimeout(() => resolve({ kind: "pending" }), waitMs);
    }),
  ]);
  await vi.advanceTimersByTimeAsync(waitMs);
  return observed;
}

function createTransportFixture() {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    onclose: undefined,
    onerror: undefined,
    onmessage: undefined,
    send: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockImplementation(() => neverSettles<void>()),
  };
}

function createConnectedClient(timeout = 20) {
  const client = new MCPClient({
    id: "deadline-server",
    name: "Deadline Server",
    timeout,
    transport: {
      type: "stdio",
      command: "node",
    },
  });
  const transport = createTransportFixture();
  const sdkClient = {
    callTool: vi.fn().mockImplementation(() => neverSettles()),
    close: vi.fn().mockResolvedValue(undefined),
    listResources: vi.fn().mockResolvedValue({ resources: [] }),
    listTools: vi.fn().mockResolvedValue({ tools: [] }),
    readResource: vi.fn().mockImplementation(() => neverSettles()),
  };
  const childProcess = {
    kill: vi.fn(),
  };
  const internals = client as unknown as {
    childProcess: typeof childProcess | null;
    client: typeof sdkClient | null;
    discoverCapabilities: () => Promise<void>;
    status: string;
    transport: typeof transport | null;
  };
  internals.client = sdkClient;
  internals.transport = transport;
  internals.childProcess = childProcess;
  internals.status = "connected";

  return { childProcess, client, internals, sdkClient, transport };
}

describe("MCPClient deadlines", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(loggerAdapter, "mcpError").mockImplementation(() => {});
    vi.spyOn(loggerAdapter, "mcpWarn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("closes a never-settling connect transport at the configured deadline", async () => {
    const client = new MCPClient({
      id: "connect-deadline",
      name: "Connect Deadline",
      timeout: 20,
      transport: { type: "stdio", command: "node" },
    });
    const transport = createTransportFixture();
    const internals = client as unknown as {
      createTransport: () => Promise<unknown>;
    };
    vi.spyOn(internals, "createTransport").mockResolvedValue(transport);

    const result = await observeSettlement(client.connect({ failureLogLevel: "none" }), 25);

    expect(result).toMatchObject({
      kind: "rejected",
      error: expect.objectContaining({ message: expect.stringContaining("connect timed out") }),
    });
    expect(transport.close).toHaveBeenCalled();
    expect(client.getState().status).toBe("error");
  });

  it("closes the connection when capability discovery never settles", async () => {
    const { childProcess, client, internals, sdkClient, transport } = createConnectedClient();
    sdkClient.listTools.mockImplementation(() => neverSettles());

    const result = await observeSettlement(internals.discoverCapabilities(), 25);

    expect(result).toMatchObject({
      kind: "rejected",
      error: expect.objectContaining({ message: expect.stringContaining("list_tools timed out") }),
    });
    expect(sdkClient.close).toHaveBeenCalled();
    expect(transport.close).toHaveBeenCalled();
    expect(childProcess.kill).toHaveBeenCalled();
  });

  it("closes a never-settling tool call rather than leaving it in the Agent lane", async () => {
    const { childProcess, client, sdkClient, transport } = createConnectedClient();

    const result = await observeSettlement(client.callTool("slow_tool", {}), 25);

    expect(result).toMatchObject({
      kind: "fulfilled",
      value: expect.objectContaining({
        success: false,
        error: expect.stringContaining("call_tool timed out"),
      }),
    });
    expect(sdkClient.close).toHaveBeenCalled();
    expect(transport.close).toHaveBeenCalled();
    expect(childProcess.kill).toHaveBeenCalled();
    expect(client.getState().diagnostics).toEqual(expect.objectContaining({
      lastErrorKind: "transport",
      lastErrorSource: "call_tool",
    }));
  });

  it("returns after forcing transport close even when SDK close never settles", async () => {
    const { client, sdkClient, transport } = createConnectedClient();
    sdkClient.close.mockImplementation(() => neverSettles());

    const result = await observeSettlement(client.callTool("slow_close_tool", {}), 25);

    expect(result).toMatchObject({
      kind: "fulfilled",
      value: expect.objectContaining({ success: false }),
    });
    expect(transport.close).toHaveBeenCalled();
  });

  it("closes a never-settling resource read at the configured deadline", async () => {
    const { client, sdkClient, transport } = createConnectedClient();

    const result = await observeSettlement(client.readResource("resource://slow"), 25);

    expect(result).toMatchObject({
      kind: "rejected",
      error: expect.objectContaining({ message: expect.stringContaining("read_resource timed out") }),
    });
    expect(sdkClient.close).toHaveBeenCalled();
    expect(transport.close).toHaveBeenCalled();
  });

  it("lets an upper AbortSignal win and does not retain the connection", async () => {
    const { client, sdkClient, transport } = createConnectedClient(10_000);
    const abortController = new AbortController();
    const callTool = client as unknown as {
      callTool: (
        toolName: string,
        args: Record<string, unknown>,
        options?: { signal?: AbortSignal },
      ) => Promise<unknown>;
    };

    const operation = callTool.callTool("cancelled_tool", {}, { signal: abortController.signal });
    abortController.abort();
    const result = await observeSettlement(operation, 1);

    expect(result).toMatchObject({
      kind: "fulfilled",
      value: expect.objectContaining({
        success: false,
        error: expect.stringContaining("cancelled"),
      }),
    });
    expect(sdkClient.close).toHaveBeenCalled();
    expect(transport.close).toHaveBeenCalled();
    expect(client.getState().diagnostics).toEqual(expect.objectContaining({
      lastErrorKind: "cancelled",
      lastErrorRetryable: false,
    }));
  });

  it("uses an explicit longer timeout and passes it through to the SDK request", async () => {
    const { client, sdkClient, transport } = createConnectedClient(100);
    sdkClient.callTool.mockImplementation((_request: unknown, _schema: unknown, requestOptions: { timeout?: number }) =>
      new Promise((resolve) => {
        setTimeout(() => resolve({ isError: false, content: [{ type: "text", text: "ok" }] }), 25);
      }),
    );

    const operation = client.callTool("long_tool", {});
    await vi.advanceTimersByTimeAsync(25);

    await expect(operation).resolves.toEqual(expect.objectContaining({ success: true }));
    expect(sdkClient.callTool).toHaveBeenCalledWith(
      { name: "long_tool", arguments: {} },
      undefined,
      expect.objectContaining({
        timeout: 100,
        maxTotalTimeout: 100,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(transport.close).not.toHaveBeenCalled();
  });
});
