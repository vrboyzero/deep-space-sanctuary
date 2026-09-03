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

describe("ToolEnabledAgent ordinary model-loop token headroom", () => {
  it("counts retained tool schemas before choosing a bounded finalization call", async () => {
    let modelCallIndex = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const payload = JSON.parse(String(init?.body ?? "{}"));
      modelCallIndex++;
      if (modelCallIndex === 1) {
        return jsonResponse({
          choices: [{
            message: {
              content: "",
              tool_calls: [{
                id: "call-read-scenario",
                type: "function",
                function: {
                  name: "file_read",
                  arguments: JSON.stringify({ path: "fixture/system-scenario.json" }),
                },
              }],
            },
          }],
          usage: { prompt_tokens: 1_000, completion_tokens: 50 },
        });
      }

      const hasTools = Array.isArray(payload.tools) && payload.tools.length > 0;
      return hasTools
        ? jsonResponse({
            choices: [{ message: { content: "ordinary call crossed the run budget" } }],
            usage: { prompt_tokens: 2_000, completion_tokens: 100 },
          })
        : jsonResponse({
            choices: [{ message: { content: '{"summary":"parallel read evidence inspected"}' } }],
            usage: { prompt_tokens: 400, completion_tokens: 50 },
          });
    });
    const execute = vi.fn(async (request: { id: string; name: string }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: JSON.stringify({
        path: "fixture/system-scenario.json",
        content: {
          taskId: "system.parallel-read-isolation",
          requiredCapability: "parallelReadIsolation",
        },
      }),
      durationMs: 0,
    }));
    const retainedToolSchema = Array.from(
      { length: 900 },
      (_, index) => `bounded navigation field ${index}`,
    ).join(" ");
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      maxTotalTokens: 3_000,
      maxOutputTokens: 512,
      streamingEnabled: false,
      systemPrompt: "Keep this bounded coding run read-only and return the requested JSON contract.",
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function" as const,
          function: {
            name: "file_read",
            description: retainedToolSchema,
            parameters: {
              type: "object",
              additionalProperties: false,
              required: ["path"],
              properties: { path: { type: "string" } },
            },
          },
        }],
        execute,
      }),
    });

    const items = await collectItems(agent.run({
      conversationId: "retained-tool-schema-budget-finalization",
      text: "Return exactly one JSON object with a non-empty summary.",
      structuredOutput: {
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["summary"],
          properties: { summary: { type: "string", minLength: 1 } },
        },
        validateOutput: validateSummaryOutput,
      },
    } as any));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(1);
    const secondPayload = JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body ?? "{}"));
    expect(secondPayload.tools).toBeUndefined();
    expect(secondPayload.max_tokens).toBe(512);
    expect(secondPayload.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("Finalization-only phase"),
      }),
    ]));
    expect(items.some((item) => item.type === "budget_exhausted")).toBe(false);
    expect(items).toContainEqual({
      type: "final",
      text: '{"summary":"parallel read evidence inspected"}',
    });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });
});

function validateSummaryOutput(text: string):
  | { ok: true; outputText: string }
  | { ok: false; message: string } {
  try {
    const output = JSON.parse(text) as { summary?: unknown };
    return typeof output.summary === "string" && output.summary.length > 0
      ? { ok: true, outputText: text.trim() }
      : { ok: false, message: "Final output does not contain a non-empty summary." };
  } catch {
    return { ok: false, message: "Final output is not valid JSON." };
  }
}

function createToolExecutor(overrides: Record<string, unknown> = {}): any {
  return {
    getDefinitions: () => [],
    getRegisteredToolContract: () => ({ name: "file_read", riskLevel: "low", isReadOnly: true }),
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

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
