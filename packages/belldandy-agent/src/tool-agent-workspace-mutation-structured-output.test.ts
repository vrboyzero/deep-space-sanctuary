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
  it("requests JSON mode before failing closed on two full-length prose reviews", async () => {
    const requiredPath = "src/diff/props.js";
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return jsonResponse(modelToolCall("patch-broad", "apply_patch", {
          input: [
            "*** Begin Patch",
            `*** Update File: ${requiredPath}`,
            "@@",
            "-\t\t} else if (value != NULL && value !== false) {",
            "+\t\t} else if (value != NULL) {",
            "*** End Patch",
          ].join("\n"),
        }, 500, 100));
      }
      if (requests.length === 2) {
        return jsonResponse(modelToolCall("read-broad", "file_read", {
          path: requiredPath,
          limit: 1_048_576,
        }, 500, 100));
      }
      return jsonResponse({
        choices: [{
          finish_reason: "length",
          message: {
            content: "The post-write evidence requires further review. ".repeat(96),
          },
        }],
        usage: { prompt_tokens: 1_700, completion_tokens: 1_024 },
      });
    });

    const execute = vi.fn(async (request: {
      id: string;
      name: string;
    }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: request.name === "file_read"
        ? JSON.stringify({
            path: requiredPath,
            truncated: false,
            content: "\t\t} else if (value != NULL) {",
          })
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
      conversationId: "conv-post-mutation-objective-full-length-prose",
      text: "Restore false aria-* attribute serialization with the smallest change while preserving ordinary false attribute behavior.",
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
        validateOutput: (text: string) => text === '{"summary":"corrected and verified"}'
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(requests).toHaveLength(4);
    expect(requests[2]?.response_format).toEqual({ type: "json_object" });
    expect(requests[3]?.response_format).toEqual({ type: "json_object" });
    expect(requests[2]?.messages[0]?.content).toContain(
      "Return exactly one complete raw JSON value",
    );
    expect(requests[2]?.messages[0]?.content).toContain('"required":["summary"]');
    expect(requests[2]?.tools?.map((tool: any) => tool.function.name)).toEqual(["apply_patch"]);
    expect(requests[3]?.tools?.map((tool: any) => tool.function.name)).toEqual(["apply_patch"]);
    expect(requests[2]?.max_tokens).toBe(1_024);
    expect(requests[3]?.max_tokens).toBe(1_024);
    expect(requests[2]?.thinking).toEqual({ type: "disabled" });
    expect(requests[3]?.thinking).toEqual({ type: "disabled" });
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "apply_patch",
      "file_read",
    ]);
    expect(items.at(-2)).toEqual({
      type: "final",
      text: "required workspace mutation was not completed: the post-write objective review returned neither valid final JSON nor an allowed correction after its one phase-aware output repair.",
    });
    expect(items.at(-1)).toEqual({ type: "status", status: "error" });
  });

  it("keeps malformed successful objective review repair inside the objective-review phase", async () => {
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
    const validateOutput = vi.fn((text: string) => text === '{"summary":"migrated"}'
      ? { ok: true as const, outputText: text }
      : { ok: false as const, message: "summary is required" });

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
        validateOutput,
      },
    } as any));

    expect(requests).toHaveLength(4);
    expect(requests[2]?.messages[0]?.content).toContain("Post-mutation objective review phase");
    expect(requests[2]?.thinking).toEqual({ type: "disabled" });
    expect(requests[3]?.messages[0]?.content).toContain(
      "Post-mutation objective review output repair phase",
    );
    expect(requests[3]?.messages[1]?.content).toContain("currentBehavior0");
    expect(requests[3]?.tools?.map((tool: any) => tool.function.name)).toEqual(["apply_patch"]);
    expect(requests[3]?.thinking).toEqual({ type: "disabled" });
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "apply_patch",
      "file_read",
    ]);
    expect(validateOutput).toHaveBeenCalledTimes(2);
    expect(items).toContainEqual({ type: "final", text: '{"summary":"migrated"}' });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("fails closed when objective-review output repair remains invalid", async () => {
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
      return jsonResponse({
        choices: [{
          finish_reason: "stop",
          message: {
            content: requests.length === 3
              ? "The mutation still needs a final contract review."
              : "The repair remains incomplete and cannot establish success.",
          },
        }],
        usage: { prompt_tokens: 500, completion_tokens: 30 },
      });
    });

    const execute = vi.fn(async (request: {
      id: string;
      name: string;
    }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: request.name === "file_read"
        ? JSON.stringify({ path: requiredPath, truncated: false, content: "export const current = true;" })
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
      conversationId: "conv-post-mutation-objective-output-repair-fails-closed",
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
    expect(requests[3]?.messages[0]?.content).toContain(
      "Post-mutation objective review output repair phase",
    );
    expect(requests[3]?.messages[0]?.content).not.toContain(
      "Bounded structured-output repair phase",
    );
    expect(requests[3]?.tools?.map((tool: any) => tool.function.name)).toEqual(["apply_patch"]);
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "apply_patch",
      "file_read",
    ]);
    expect(items.at(-2)).toEqual({
      type: "final",
      text: "required workspace mutation was not completed: the post-write objective review returned neither valid final JSON nor an allowed correction after its one phase-aware output repair.",
    });
    expect(items.at(-1)).toEqual({ type: "status", status: "error" });
  });

  it("uses malformed objective review repair to correct an unpreserved outside behavior", async () => {
    const requiredPath = "src/diff/props.js";
    const broadCondition = "\t\t} else if (value != NULL) {";
    const correctedCondition = "\t\t} else if (value != NULL && (value !== false || name[4] == '-')) {";
    const broadSource = [
      "\t\t// aria- and data- attributes have no boolean representation.",
      "\t\tif (typeof value == 'function') {",
      broadCondition,
      "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      "\t\t} else {",
      "\t\t\tdom.removeAttribute(name);",
      "\t\t}",
    ].join("\n");
    const correctedSource = broadSource.replace(broadCondition, correctedCondition);
    const correctionPatch = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      `-${broadCondition}`,
      `+${correctedCondition}`,
      "*** End Patch",
    ].join("\n");
    const requests: Array<Record<string, any>> = [];
    let mutationCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return jsonResponse(modelToolCall("patch-broad", "apply_patch", {
          input: [
            "*** Begin Patch",
            `*** Update File: ${requiredPath}`,
            "@@",
            "-\t\t} else if (value != NULL && value !== false) {",
            `+${broadCondition}`,
            "*** End Patch",
          ].join("\n"),
        }, 500, 100));
      }
      if (requests.length === 2 || requests.length === 5) {
        return jsonResponse(modelToolCall(`read-${requests.length}`, "file_read", {
          path: requiredPath,
          limit: 1_048_576,
        }, 500, 100));
      }
      if (requests.length === 3) {
        return jsonResponse({
          choices: [{
            finish_reason: "stop",
            message: {
              content: "The positive aria witness passes, but the current predicate also serializes false for ordinary attributes, so outside behavior is not preserved.",
            },
          }],
          usage: { prompt_tokens: 1_700, completion_tokens: 100 },
        });
      }
      if (requests.length === 4) {
        return jsonResponse(modelToolCall("correct-outside-behavior", "apply_patch", {
          input: correctionPatch,
        }, 500, 100));
      }
      return jsonResponse({
        choices: [{
          finish_reason: "stop",
          message: { content: '{"summary":"corrected and verified"}' },
        }],
        usage: { prompt_tokens: 500, completion_tokens: 30 },
      });
    });

    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "apply_patch") {
        mutationCount++;
        return {
          id: request.id,
          name: request.name,
          success: true,
          output: "Patch applied successfully",
          metadata: {
            workspaceMutation: { schemaVersion: 1, changedPaths: [requiredPath] },
          },
          durationMs: 1,
        };
      }
      return {
        id: request.id,
        name: request.name,
        success: true,
        output: JSON.stringify({
          path: requiredPath,
          truncated: false,
          content: mutationCount > 1 ? correctedSource : broadSource,
        }),
        durationMs: 1,
      };
    });
    const agent = createAgent(execute);

    const items = await collect(agent.run({
      conversationId: "conv-post-mutation-objective-output-repair",
      text: "Restore false aria-* attribute serialization with the smallest change while preserving the public behavior of other attributes.",
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
        validateOutput: (text: string) => text === '{"summary":"corrected and verified"}'
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(requests).toHaveLength(6);
    expect(requests[3]?.messages[0]?.content).toContain(
      "Post-mutation objective review output repair phase",
    );
    expect(requests[3]?.messages[0]?.content).toContain(
      "Do not turn an incomplete or uncertain review into a success summary",
    );
    expect(requests[3]?.messages[1]?.content).toContain(broadCondition.trim());
    expect(requests[3]?.tools?.map((tool: any) => tool.function.name)).toEqual(["apply_patch"]);
    expect(requests[3]?.thinking).toEqual({ type: "disabled" });
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "apply_patch",
      "file_read",
      "apply_patch",
      "file_read",
    ]);
    expect(execute.mock.calls[2]?.[0]?.arguments).toEqual({ input: correctionPatch });
    expect(items).toContainEqual({ type: "final", text: '{"summary":"corrected and verified"}' });
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
