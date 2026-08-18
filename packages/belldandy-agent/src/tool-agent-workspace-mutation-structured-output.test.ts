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

describe("ToolEnabledAgent post-mutation structured output", () => {
  it("disables DeepSeek thinking for bounded repair after objective review returns non-JSON", async () => {
    const requiredPath = "src/dom.ts";
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return jsonResponse(modelToolCall("patch-1", "apply_patch", {
          input: "*** Begin Patch\n*** Update File: src/dom.ts\n@@\n-old\n+new\n*** End Patch",
        }, 500, 100));
      }
      if (requests.length === 2) {
        return jsonResponse(modelToolCall("read-1", "file_read", {
          path: requiredPath,
          limit: 1_048_576,
        }, 500, 100));
      }
      if (requests.length === 3) {
        return jsonResponse({
          choices: [{
            finish_reason: "stop",
            message: { content: "The mutation satisfies the requested behavior." },
          }],
          usage: { prompt_tokens: 17_000, completion_tokens: 100 },
        });
      }
      if ((body.thinking as { type?: unknown } | undefined)?.type !== "disabled") {
        return jsonResponse({
          choices: [{
            finish_reason: "length",
            message: { content: null, reasoning_content: "R".repeat(Number(body.max_tokens)) },
          }],
          usage: { prompt_tokens: 300, completion_tokens: Number(body.max_tokens) },
        });
      }
      return jsonResponse({
        choices: [{
          finish_reason: "stop",
          message: { content: '{"summary":"migrated"}' },
        }],
        usage: { prompt_tokens: 300, completion_tokens: 20 },
      });
    });

    const source = Array.from(
      { length: 900 },
      (_, index) => `const currentBehavior${index} = preserveCase(${index});`,
    ).join("\n");
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: request.name === "file_read"
        ? JSON.stringify({ path: requiredPath, truncated: false, content: source })
        : "Patch applied successfully",
      ...(request.name === "apply_patch" ? {
        metadata: {
          workspaceMutation: { schemaVersion: 1, changedPaths: [requiredPath] },
        },
      } : {}),
      durationMs: 1,
    }));
    const agent = createAgent(execute);

    const items = await collect(agent.run({
      conversationId: "conv-post-mutation-structured-repair-thinking",
      text: "Apply the smallest change while preserving behavior outside the requested subset.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths: [requiredPath],
          toolLoopIterationBudget: 6,
        },
      },
      structuredOutput: {
        schema: { type: "object", required: ["summary"] },
        validateOutput: (text: string) => text === '{"summary":"migrated"}'
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(requests).toHaveLength(4);
    expect(requests[2]?.messages[0]?.content).toContain("Post-mutation objective review phase");
    expect(requests[2]?.thinking).toEqual({ type: "disabled" });
    expect(requests[3]?.messages[0]?.content).toContain("Bounded structured-output repair phase");
    expect(requests[3]).not.toHaveProperty("tools");
    expect(requests[3]?.thinking).toEqual({ type: "disabled" });
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "apply_patch",
      "file_read",
    ]);
    expect(items).toContainEqual({ type: "final", text: '{"summary":"migrated"}' });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });
});

function createAgent(execute: ReturnType<typeof vi.fn>): ToolEnabledAgent {
  return new ToolEnabledAgent({
    baseUrl: "https://api.openai.com/v1",
    apiKey: "test-key",
    model: "deepseek-v4-flash",
    thinking: { type: "enabled" },
    maxTotalTokens: 24_000,
    maxOutputTokens: 4_096,
    toolLoopIterationBudget: 6,
    streamingEnabled: false,
    toolExecutor: {
      getDefinitions: () => [toolDefinition("file_read"), toolDefinition("apply_patch")],
      getRegisteredToolContract: (name: string) => name === "apply_patch"
        ? { name, family: "patch", isReadOnly: false, riskLevel: "high" as const }
        : { name, family: "workspace-read", isReadOnly: true, riskLevel: "low" as const },
      consumeLoadedDeferredToolsForNextTurn: vi.fn(async () => []),
      setTokenCounter: vi.fn(),
      clearTokenCounter: vi.fn(),
      releaseConversation: vi.fn(),
      execute,
    } as any,
  });
}

function toolDefinition(name: string) {
  return {
    type: "function" as const,
    function: {
      name,
      description: `${name} tool`,
      parameters: { type: "object", properties: {} },
    },
  };
}

function modelToolCall(
  id: string,
  name: string,
  args: Record<string, unknown>,
  promptTokens: number,
  completionTokens: number,
) {
  return {
    choices: [{
      finish_reason: "tool_calls",
      message: {
        content: null,
        tool_calls: [{
          id,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        }],
      },
    }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function collect(iterable: AsyncIterable<any>): Promise<any[]> {
  const items: any[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}
