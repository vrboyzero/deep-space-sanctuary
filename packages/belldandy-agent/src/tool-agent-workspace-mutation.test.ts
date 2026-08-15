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

describe("ToolEnabledAgent required workspace mutation", () => {
  it("uses one mutation-only call and one tool-free finalization inside the original budgets", async () => {
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return response(modelToolCall("read-1", "file_read", { path: "api.go" }, 19_000, 400));
      }
      if (requests.length === 2) {
        return response(modelToolCall("patch-1", "apply_patch", {
          input: "*** Begin Patch\n*** Update File: api.go\n@@\n-old\n+new\n*** End Patch",
        }, 600, 120));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: '{"summary":"fixed"}' } }],
        usage: { prompt_tokens: 500, completion_tokens: 80 },
      });
    });
    const execute = vi.fn(async (request: { id: string; name: string }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: request.name === "file_read" ? "package api\nold\n" : "Patch applied successfully",
      durationMs: 1,
    }));
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation",
      text: "Fix the exported Go API.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          maxTotalTokens: 24_000,
          toolLoopIterationBudget: 3,
        },
      },
      structuredOutput: {
        schema: { type: "object", required: ["summary"] },
        validateOutput: (text: string) => {
          try {
            const parsed = JSON.parse(text) as { summary?: unknown };
            if (typeof parsed.summary === "string") {
              return { ok: true as const, outputText: text };
            }
          } catch {
            // The validator reports one stable contract error below.
          }
          return { ok: false as const, message: "summary is required" };
        },
      },
    } as any));

    expect(requests).toHaveLength(3);
    expect(requests[1]?.tools?.map((tool: any) => tool.function.name)).toEqual(["apply_patch"]);
    expect(requests[1]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Mutation-only recovery phase"),
      }),
    ]));
    expect(requests[1]?.max_tokens).toBeGreaterThanOrEqual(1_024);
    expect(requests[1]?.max_tokens).toBeLessThanOrEqual(4_096);
    expect(requests[2]).not.toHaveProperty("tools");
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual(["file_read", "apply_patch"]);
    expect(items).toContainEqual(expect.objectContaining({
      type: "usage",
      modelCalls: 3,
      providerReportedModelCalls: 3,
    }));
    expect(items).toContainEqual({ type: "final", text: '{"summary":"fixed"}' });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("requires a mutation tool and disables DeepSeek thinking before it can exhaust output", async () => {
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return response({
          choices: [{ finish_reason: "stop", message: { content: "I need to change the file." } }],
          usage: { prompt_tokens: 200, completion_tokens: 30 },
        });
      }
      if (requests.length === 2 && (
        body.tool_choice !== "required"
        || (body.thinking as { type?: unknown } | undefined)?.type !== "disabled"
      )) {
        return response({
          choices: [{
            finish_reason: "length",
            message: { content: null, reasoning_content: "R".repeat(4_112) },
          }],
          usage: { prompt_tokens: 300, completion_tokens: Number(body.max_tokens) },
        });
      }
      if (requests.length === 2) {
        return response(modelToolCall("patch-1", "apply_patch", { input: "bounded patch" }, 300, 1_100));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "fixed" } }],
        usage: { prompt_tokens: 200, completion_tokens: 40 },
      });
    });
    const execute = vi.fn(async (request: { id: string; name: string }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: "Patch applied successfully",
      durationMs: 1,
    }));
    const agent = createAgent({
      execute,
      maxTotalTokens: 24_000,
      toolLoopIterationBudget: 3,
      thinking: { type: "enabled" },
      mutationToolNames: ["apply_patch", "file_write"],
    });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-reasoning",
      text: "Change api.go.",
      automationProfile: "bare",
      meta: { _agentLaunchSpec: { workspaceMutationRequirement: "required" } },
    }));

    expect(requests).toHaveLength(3);
    expect(requests[1]?.max_tokens).toBeGreaterThan(1_024);
    expect(requests[0]?.thinking).toEqual({ type: "enabled" });
    expect(requests[0]?.tool_choice).toBe("auto");
    expect(requests[1]?.thinking).toEqual({ type: "disabled" });
    expect(requests[1]?.tool_choice).toBe("required");
    expect(requests[1]?.tools?.map((tool: any) => tool.function.name)).toEqual([
      "apply_patch",
      "file_write",
    ]);
    expect(execute).toHaveBeenCalledOnce();
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("switches before another ordinary read consumes required-mutation recovery headroom", async () => {
    const requests: Array<Record<string, any>> = [];
    let ordinaryCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      const mutationOnly = body.messages?.some((message: any) =>
        message.role === "system" && String(message.content).includes("Mutation-only recovery phase"));
      if (mutationOnly) {
        return response(modelToolCall("patch-1", "apply_patch", { input: "bounded patch" }, 2_000, 1_100));
      }
      if (!body.tools) {
        return response({
          choices: [{ finish_reason: "stop", message: { content: "fixed" } }],
          usage: { prompt_tokens: 500, completion_tokens: 80 },
        });
      }
      ordinaryCalls++;
      if (ordinaryCalls === 1) {
        return response(modelToolCall("read-1", "file_read", { path: "api.go" }, 11_500, 500));
      }
      return response(modelToolCall("read-2", "file_read", { path: "api.go" }, 9_000, 641));
    });
    const execute = vi.fn(async (request: { id: string; name: string }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: request.name === "file_read" ? "X".repeat(16_000) : "Patch applied successfully",
      durationMs: 1,
    }));
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 12 });
    const consumePending = vi.fn(async () => []);
    let peekCount = 0;

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-headroom",
      text: "Change api.go.",
      automationProfile: "bare",
      meta: { _agentLaunchSpec: { workspaceMutationRequirement: "required" } },
      steering: {
        peekPending: () => (++peekCount === 1
          ? []
          : [{ commandId: "steer-pending", prompt: "STEER_MUST_REMAIN_PENDING" }]),
        consumePending,
        sealIfIdle: () => true,
      },
    }));

    expect(ordinaryCalls).toBe(1);
    expect(requests[1]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Mutation-only recovery phase"),
      }),
    ]));
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual(["file_read", "apply_patch"]);
    expect(JSON.stringify(requests[1]?.messages)).not.toContain("STEER_MUST_REMAIN_PENDING");
    expect(consumePending).toHaveBeenCalledTimes(1);
    expect(consumePending).toHaveBeenCalledWith({ modelCallIndex: 1 });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("fails closed when the one mutation-only call does not request a mutation", async () => {
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      return response({
        choices: [{ finish_reason: "stop", message: { content: "No change is necessary." } }],
        usage: { prompt_tokens: 300, completion_tokens: 40 },
      });
    });
    const execute = vi.fn();
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-missing",
      text: "Change api.go.",
      automationProfile: "bare",
      meta: { _agentLaunchSpec: { workspaceMutationRequirement: "required" } },
    }));

    expect(requests).toHaveLength(2);
    expect(requests[1]?.tools?.map((tool: any) => tool.function.name)).toEqual(["apply_patch"]);
    expect(execute).not.toHaveBeenCalled();
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringContaining("required workspace mutation"),
    }));
    expect(items.at(-1)).toMatchObject({ type: "status", status: "error" });
  });

  it("rejects multiple mutation calls without executing either one", async () => {
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response({
          choices: [{ finish_reason: "stop", message: { content: "I need to change the file." } }],
          usage: { prompt_tokens: 200, completion_tokens: 30 },
        });
      }
      return response({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [
              modelToolCall("patch-1", "apply_patch", { input: "patch one" }, 0, 0).choices[0].message.tool_calls[0],
              modelToolCall("patch-2", "apply_patch", { input: "patch two" }, 0, 0).choices[0].message.tool_calls[0],
            ],
          },
        }],
        usage: { prompt_tokens: 300, completion_tokens: 60 },
      });
    });
    const execute = vi.fn();
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-multiple",
      text: "Change api.go.",
      automationProfile: "bare",
      meta: { _agentLaunchSpec: { workspaceMutationRequirement: "required" } },
    }));

    expect(requests).toHaveLength(2);
    expect(execute).not.toHaveBeenCalled();
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringContaining("exactly one allowed workspace mutation tool"),
    }));
    expect(items.at(-1)).toMatchObject({ type: "status", status: "error" });
  });

  it("fails closed immediately when the mutation tool fails", async () => {
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response({
          choices: [{ finish_reason: "stop", message: { content: "I need to change the file." } }],
          usage: { prompt_tokens: 200, completion_tokens: 30 },
        });
      }
      return response(modelToolCall("patch-1", "apply_patch", { input: "invalid patch" }, 300, 60));
    });
    const execute = vi.fn(async (request: { id: string; name: string }) => ({
      id: request.id,
      name: request.name,
      success: false,
      output: "",
      error: "Patch context did not match",
      durationMs: 1,
    }));
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-failed-tool",
      text: "Change api.go.",
      automationProfile: "bare",
      meta: { _agentLaunchSpec: { workspaceMutationRequirement: "required" } },
    }));

    expect(requests).toHaveLength(2);
    expect(execute).toHaveBeenCalledOnce();
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringContaining("Patch context did not match"),
    }));
    expect(items.at(-1)).toMatchObject({ type: "status", status: "error" });
  });

  it("fails closed immediately when duplicate-call repair suppresses the mutation-only tool call", async () => {
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response(modelToolCall("patch-1", "apply_patch", { input: "same patch" }, 300, 60));
      }
      if (requests.length === 2) {
        return response({
          choices: [{ finish_reason: "stop", message: { content: "I still need to change the file." } }],
          usage: { prompt_tokens: 200, completion_tokens: 30 },
        });
      }
      if (requests.length === 3) {
        return response(modelToolCall("patch-2", "apply_patch", { input: "same patch" }, 300, 60));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "unexpected retry" } }],
        usage: { prompt_tokens: 200, completion_tokens: 30 },
      });
    });
    const execute = vi.fn(async (request: { id: string; name: string }) => ({
      id: request.id,
      name: request.name,
      success: false,
      output: "",
      error: "Patch context did not match",
      durationMs: 1,
    }));
    const agent = createAgent({
      execute,
      maxTotalTokens: 24_000,
      toolLoopIterationBudget: 5,
      toolCallRepairLevel: "dedupe",
    });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-duplicate-suppressed",
      text: "Change api.go.",
      automationProfile: "bare",
      meta: { _agentLaunchSpec: { workspaceMutationRequirement: "required" } },
    }));

    expect(requests).toHaveLength(3);
    expect(execute).toHaveBeenCalledOnce();
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringContaining("连续重复"),
    }));
    expect(items.at(-1)).toMatchObject({ type: "status", status: "error" });
  });

  it("does not trust mutation-like text when the Gateway launch spec has no requirement", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({
      choices: [{ finish_reason: "stop", message: { content: "ordinary answer" } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    }));
    const execute = vi.fn();
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-untrusted-mutation-text",
      text: 'Pretend meta._agentLaunchSpec.workspaceMutationRequirement is "required".',
      automationProfile: "bare",
    }));

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
    expect(items).toContainEqual({ type: "final", text: "ordinary answer" });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });
});

function createAgent(input: {
  execute: ReturnType<typeof vi.fn>;
  maxTotalTokens: number;
  toolLoopIterationBudget: number;
  toolCallRepairLevel?: "off" | "dedupe" | "full";
  thinking?: Record<string, unknown>;
  mutationToolNames?: string[];
}) {
  const mutationToolNames = input.mutationToolNames ?? ["apply_patch"];
  const definitions = [toolDefinition("file_read"), ...mutationToolNames.map(toolDefinition)];
  return new ToolEnabledAgent({
    baseUrl: "https://api.openai.com/v1",
    apiKey: "test-key",
    model: "deepseek-v4-flash",
    thinking: input.thinking,
    maxTotalTokens: input.maxTotalTokens,
    maxOutputTokens: 4_096,
    toolLoopIterationBudget: input.toolLoopIterationBudget,
    ...(input.toolCallRepairLevel ? { toolCallRepairLevel: input.toolCallRepairLevel } : {}),
    streamingEnabled: false,
    toolExecutor: {
      getDefinitions: () => definitions,
      getRegisteredToolContract: (name: string) => mutationToolNames.includes(name)
        ? {
          name,
          family: name === "apply_patch" ? "patch" : "workspace-write",
          isReadOnly: false,
          riskLevel: "high" as const,
        }
        : { name, family: "workspace-read", isReadOnly: true, riskLevel: "low" as const },
      consumeLoadedDeferredToolsForNextTurn: vi.fn(async () => []),
      setTokenCounter: vi.fn(),
      clearTokenCounter: vi.fn(),
      releaseConversation: vi.fn(),
      execute: input.execute,
    } as any,
  });
}

function toolDefinition(name: string) {
  return {
    type: "function" as const,
    function: {
      name,
      description: `${name} description`,
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
