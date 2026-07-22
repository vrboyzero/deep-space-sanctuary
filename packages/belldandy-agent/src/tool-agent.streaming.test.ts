import http from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ToolEnabledAgent } from "./tool-agent.js";

type ProviderReply = (response: http.ServerResponse) => void | Promise<void>;

const providers = new Set<Awaited<ReturnType<typeof createProvider>>>();

afterEach(async () => {
  await Promise.all([...providers].map((provider) => provider.close()));
  providers.clear();
});

describe("ToolEnabledAgent Provider streaming", () => {
  it("keeps the existing buffered request and item sequence when streaming is disabled", async () => {
    const provider = await createProvider([
      (response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          choices: [{ message: { content: "buffered response" } }],
          usage: { prompt_tokens: 2, completion_tokens: 3 },
        }));
      },
    ]);
    const agent = new ToolEnabledAgent({
      baseUrl: provider.baseUrl,
      apiKey: "local-test-key",
      model: "local-test-model",
      toolExecutor: createToolExecutor(),
      streamingEnabled: false,
    } as any);

    const items = await collectItems(agent.run({ conversationId: "stream-off", text: "hello" }));

    expect(provider.payloads).toHaveLength(1);
    expect(provider.payloads[0]?.stream).toBe(false);
    expect(items.map((item) => item.type)).toEqual([
      "status",
      "delta",
      "delta",
      "usage",
      "final",
      "status",
    ]);
    expect(items.filter((item) => item.type === "delta").map((item) => item.delta).join(""))
      .toBe("buffered response");
  });

  it("emits safe text before Provider completion without exposing reasoning", async () => {
    let providerCompletedAt = 0;
    const provider = await createProvider([
      async (response) => {
        response.writeHead(200, { "content-type": "text/event-stream" });
        writeSse(response, {
          choices: [{ delta: { reasoning_content: "private chain", content: "Hello" } }],
        });
        await delay(40);
        writeSse(response, {
          choices: [{ delta: { content: " world" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 2, completion_tokens: 3 },
        });
        response.end("data: [DONE]\n\n");
        providerCompletedAt = Date.now();
      },
    ]);
    const agent = new ToolEnabledAgent({
      baseUrl: provider.baseUrl,
      apiKey: "local-test-key",
      model: "local-test-model",
      toolExecutor: createToolExecutor(),
      streamingEnabled: true,
    } as any);
    let firstDeltaAt = 0;
    const items: any[] = [];

    for await (const item of agent.run({ conversationId: "stream-on", text: "hello" })) {
      items.push(item);
      if (item.type === "delta" && firstDeltaAt === 0) firstDeltaAt = Date.now();
    }

    expect(provider.payloads[0]?.stream).toBe(true);
    expect(firstDeltaAt).toBeGreaterThan(0);
    expect(firstDeltaAt).toBeLessThan(providerCompletedAt);
    expect(items.filter((item) => item.type === "delta").map((item) => item.delta).join(""))
      .toBe("Hello world");
    expect(items).toContainEqual({ type: "final", text: "Hello world" });
    expect(JSON.stringify(items)).not.toContain("private chain");
  });

  it("assembles fragmented tool arguments and executes the completed tool exactly once", async () => {
    const execute = vi.fn(async (request: { id: string; name: string; arguments: unknown }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: "tool-ok",
    }));
    const provider = await createProvider([
      (response) => {
        response.writeHead(200, { "content-type": "text/event-stream" });
        writeSse(response, {
          choices: [{ delta: { tool_calls: [{
            index: 0,
            id: "call_1",
            function: { name: "echo", arguments: "{\"value\":" },
          }] } }],
        });
        writeSse(response, {
          choices: [{ delta: { tool_calls: [{
            index: 0,
            function: { arguments: "\"hello\"}" },
          }] }, finish_reason: "tool_calls" }],
        });
        response.end("data: [DONE]\n\n");
      },
      (response) => {
        response.writeHead(200, { "content-type": "text/event-stream" });
        writeSse(response, { choices: [{ delta: { content: "completed" }, finish_reason: "stop" }] });
        response.end("data: [DONE]\n\n");
      },
    ]);
    const agent = new ToolEnabledAgent({
      baseUrl: provider.baseUrl,
      apiKey: "local-test-key",
      model: "local-test-model",
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function",
          function: {
            name: "echo",
            description: "Echo a value",
            parameters: {
              type: "object",
              properties: { value: { type: "string" } },
              required: ["value"],
            },
          },
        }],
        execute,
      }),
      streamingEnabled: true,
    } as any);

    const items = await collectItems(agent.run({ conversationId: "stream-tool", text: "use echo" }));

    expect(provider.payloads.map((payload) => payload.stream)).toEqual([true, true]);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      id: "call_1",
      name: "echo",
      arguments: { value: "hello" },
    });
    expect(items.filter((item) => item.type === "tool_call")).toHaveLength(1);
    expect(items.filter((item) => item.type === "tool_result")).toHaveLength(1);
    expect(items).toContainEqual({ type: "final", text: "completed" });
  });

  it("does not execute an incomplete tool after a committed stream failure", async () => {
    const execute = vi.fn();
    const provider = await createProvider([
      async (response) => {
        response.writeHead(200, { "content-type": "text/event-stream" });
        writeSse(response, {
          choices: [{ delta: { tool_calls: [{
            index: 0,
            id: "call_1",
            function: { name: "echo", arguments: "{\"value\":" },
          }] } }],
        });
        await delay(10);
        response.destroy(new Error("stream reset"));
      },
    ]);
    const agent = new ToolEnabledAgent({
      baseUrl: provider.baseUrl,
      apiKey: "local-test-key",
      model: "local-test-model",
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function",
          function: {
            name: "echo",
            description: "Echo a value",
            parameters: { type: "object" },
          },
        }],
        execute,
      }),
      streamingEnabled: true,
    } as any);

    const items = await collectItems(agent.run({ conversationId: "stream-tool-failure", text: "use echo" }));

    expect(provider.payloads).toHaveLength(1);
    expect(execute).not.toHaveBeenCalled();
    expect(items.filter((item) => item.type === "tool_call")).toHaveLength(0);
    expect(items.filter((item) => item.type === "final")).toHaveLength(0);
    expect(items).toContainEqual(expect.objectContaining({
      type: "interrupted",
      reason: "provider_stream_error",
      committed: true,
    }));
  });
});

async function createProvider(replies: ProviderReply[]) {
  const payloads: Array<Record<string, unknown>> = [];
  let requestIndex = 0;
  const server = http.createServer((request, response) => {
    void (async () => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        payloads.push(JSON.parse(Buffer.concat(chunks).toString("utf-8")) as Record<string, unknown>);
        const reply = replies[requestIndex++];
        if (!reply) throw new Error("Unexpected Provider request.");
        await reply(response);
      } catch (error) {
        if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain" });
        if (!response.destroyed) response.end(error instanceof Error ? error.message : String(error));
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Provider address unavailable.");
  const provider = {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    payloads,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
  providers.add(provider);
  return provider;
}

function createToolExecutor(overrides: Record<string, unknown> = {}): any {
  return {
    getDefinitions: () => [],
    getRegisteredToolContract: () => undefined,
    consumeLoadedDeferredToolsForNextTurn: vi.fn(async () => []),
    setTokenCounter: vi.fn(),
    clearTokenCounter: vi.fn(),
    releaseConversation: vi.fn(),
    execute: vi.fn(),
    ...overrides,
  };
}

async function collectItems(stream: AsyncIterable<any>): Promise<any[]> {
  const items: any[] = [];
  for await (const item of stream) items.push(item);
  return items;
}

function writeSse(response: http.ServerResponse, payload: unknown): void {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
