import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./model-request-transport.js", () => ({
  requestModelTransport: (options: { url: string | URL; init: RequestInit }) => (
    fetch(options.url, options.init)
  ),
}));

import { ToolEnabledAgent } from "./tool-agent.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ToolEnabledAgent empty reasoning finalization", () => {
  it("uses one bounded tool-free finalization after a length stop with no visible content", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const execute = vi.fn();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requests.push(body);
      if (requests.length === 1) {
        return response({
          choices: [{
            finish_reason: "length",
            message: { content: null, reasoning_content: "R".repeat(1_200) },
          }],
          usage: { prompt_tokens: 100, completion_tokens: 300 },
        });
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "bounded answer" } }],
        usage: { prompt_tokens: 200, completion_tokens: 40 },
      });
    });
    const agent = createAgent({ execute, maxTotalTokens: 2_000, maxOutputTokens: 512 });

    const items = await collect(agent.run({
      conversationId: "conv-empty-length-recovery",
      text: "finish the repository task",
    }));

    expect(requests).toHaveLength(2);
    expect(requests[1]).not.toHaveProperty("tools");
    expect(requests[1]).toMatchObject({ max_tokens: 512 });
    expect(requests[1]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("Finalization-only phase"),
      }),
    ]));
    expect(execute).not.toHaveBeenCalled();
    expect(items).toContainEqual(expect.objectContaining({
      type: "usage",
      inputTokens: 300,
      outputTokens: 340,
      modelCalls: 2,
      providerReportedModelCalls: 2,
    }));
    expect(items).toContainEqual({ type: "final", text: "bounded answer" });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("stops after one recovery when the bounded call also has no visible content", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => response({
      choices: [{
        finish_reason: "length",
        message: { content: null, reasoning_content: "still reasoning" },
      }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    }));
    const agent = createAgent({ maxTotalTokens: 2_000, maxOutputTokens: 256 });

    const items = await collect(agent.run({
      conversationId: "conv-empty-length-recovery-failed",
      text: "finish once",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringMatching(/^模型返回空内容。finish_reason=length/),
    }));
    expect(items).toContainEqual(expect.objectContaining({
      type: "usage",
      modelCalls: 2,
      providerReportedModelCalls: 2,
    }));
    expect(items.at(-1)).toEqual({ type: "status", status: "error" });
  });

  it("rejects a tool call from the recovery without executing it or retrying again", async () => {
    let callCount = 0;
    const execute = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return response({
          choices: [{
            finish_reason: "length",
            message: { content: null, reasoning_content: "R".repeat(600) },
          }],
          usage: { prompt_tokens: 100, completion_tokens: 150 },
        });
      }
      return response({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{
              id: "forbidden-recovery-tool",
              type: "function",
              function: { name: "workspace_write", arguments: "{}" },
            }],
          },
        }],
        usage: { prompt_tokens: 200, completion_tokens: 30 },
      });
    });
    const agent = createAgent({ execute, maxTotalTokens: 2_000, maxOutputTokens: 256 });

    const items = await collect(agent.run({
      conversationId: "conv-empty-length-recovery-tool",
      text: "finish without tools",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
    expect(items).toContainEqual({
      type: "final",
      text: "有界最终总结返回了工具调用；该阶段禁止继续执行工具或发起额外模型调用。",
    });
    expect(items.at(-1)).toEqual({ type: "status", status: "error" });
  });

  it("does not start recovery after the first response exhausts the total token budget", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({
      choices: [{
        finish_reason: "length",
        message: { content: null, reasoning_content: "R".repeat(600) },
      }],
      usage: { prompt_tokens: 1_500, completion_tokens: 600 },
    }));
    const agent = createAgent({ maxTotalTokens: 2_000, maxOutputTokens: 256 });

    const items = await collect(agent.run({
      conversationId: "conv-empty-length-budget-exhausted",
      text: "do not exceed the budget",
    }));

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(items).toContainEqual({
      type: "budget_exhausted",
      budget: "total_tokens",
      limit: 2_000,
      observed: 2_100,
    });
    expect(items.at(-1)).toEqual({ type: "status", status: "error" });
  });
});

function createAgent(input: {
  execute?: ReturnType<typeof vi.fn>;
  maxTotalTokens: number;
  maxOutputTokens: number;
}) {
  return new ToolEnabledAgent({
    baseUrl: "https://api.openai.com/v1",
    apiKey: "test-key",
    model: "deepseek-v4-flash",
    maxTotalTokens: input.maxTotalTokens,
    maxOutputTokens: input.maxOutputTokens,
    streamingEnabled: false,
    toolExecutor: {
      getDefinitions: () => [{
        type: "function" as const,
        function: {
          name: "workspace_write",
          description: "write workspace",
          parameters: { type: "object", properties: {} },
        },
      }],
      getRegisteredToolContract: () => ({ name: "workspace_write", riskLevel: "high" as const }),
      consumeLoadedDeferredToolsForNextTurn: vi.fn(async () => []),
      setTokenCounter: vi.fn(),
      clearTokenCounter: vi.fn(),
      releaseConversation: vi.fn(),
      execute: input.execute ?? vi.fn(),
    } as any,
  });
}

async function collect(stream: AsyncIterable<unknown>): Promise<any[]> {
  const items: any[] = [];
  for await (const item of stream) items.push(item);
  return items;
}

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
