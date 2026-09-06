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

describe("ToolEnabledAgent post-correction final output repair", () => {
  it("uses one tool-free JSON repair after an output repair performs the allowed correction", async () => {
    const scenario = await runScenario('{"summary":"quantity-aware invoice totals verified"}');

    expect(scenario.requests).toHaveLength(7);
    expect(scenario.requests[6]?.messages[0]?.content).toContain(
      "Post-mutation final objective output repair phase",
    );
    expect(scenario.requests[6]).not.toHaveProperty("tools");
    expect(scenario.requests[6]?.response_format).toEqual({ type: "json_object" });
    expect(scenario.executedPatches).toEqual([
      scenario.initialPatch,
      scenario.correctionPatch,
    ]);
    expect(scenario.items.at(-2)).toEqual({
      type: "final",
      text: '{"summary":"quantity-aware invoice totals verified"}',
    });
    expect(scenario.items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("fails closed when the bounded tool-free final JSON repairs remain invalid", async () => {
    const scenario = await runScenario("The source is fixed, but this is not JSON.");

    expect(scenario.requests).toHaveLength(9);
    expect(scenario.requests[6]?.messages[0]?.content).toContain(
      "Post-mutation final objective output repair phase",
    );
    expect(scenario.requests[6]).not.toHaveProperty("tools");
    expect(scenario.requests[6]?.messages[0]?.content).toContain("This is output repair attempt 1 of 3");
    expect(scenario.requests[7]?.messages[0]?.content).toContain("This is output repair attempt 2 of 3");
    expect(scenario.requests[8]?.messages[0]?.content).toContain("This is output repair attempt 3 of 3");
    expect(scenario.executedPatches).toEqual([
      scenario.initialPatch,
      scenario.correctionPatch,
    ]);
    expect(scenario.items.at(-2)).toEqual({
      type: "final",
      text: "required workspace mutation was not completed: the post-write final objective review returned invalid JSON after its 3 tool-free output repairs.",
    });
    expect(scenario.items.at(-1)).toEqual({ type: "status", status: "error" });
  });
});

async function runScenario(finalRepairText: string): Promise<{
  requests: Array<Record<string, any>>;
  executedPatches: string[];
  items: any[];
  initialPatch: string;
  correctionPatch: string;
}> {
  const requiredPath = "src/calculate.mjs";
  const quantitySource = [
    "export function calculateInvoiceTotal(items) {",
    "  return items.reduce(",
    "    (total, item) => total + item.price * (item.quantity ?? 1),",
    "    0,",
    "  );",
    "}",
  ].join("\n");
  const correctedSource = quantitySource.replace(
    "export function calculateInvoiceTotal(items) {",
    "export function calculateInvoiceTotal(items) {\n  if (items == null) return 0;",
  );
  const initialPatch = [
    "*** Begin Patch",
    `*** Update File: ${requiredPath}`,
    "@@",
    "-  return items.reduce((total, item) => total + item.price, 0);",
    "+  return items.reduce(",
    "+    (total, item) => total + item.price * (item.quantity ?? 1),",
    "+    0,",
    "+  );",
    "*** End Patch",
  ].join("\n");
  const correctionPatch = [
    "*** Begin Patch",
    `*** Update File: ${requiredPath}`,
    "@@",
    " export function calculateInvoiceTotal(items) {",
    "+  if (items == null) return 0;",
    "   return items.reduce(",
    "*** End Patch",
  ].join("\n");
  const requests: Array<Record<string, any>> = [];
  const executedPatches: string[] = [];
  let currentSource = quantitySource;

  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
    requests.push(body);
    const instruction = String(body.messages?.[0]?.content ?? "");
    if (instruction.includes("Post-mutation final objective output repair phase")) {
      return jsonResponse(modelFinal(finalRepairText));
    }
    if (instruction.includes("Post-mutation final objective review phase")) {
      return jsonResponse(modelFinal("The corrected source now satisfies the task."));
    }
    if (instruction.includes("Post-mutation verification phase")) {
      return jsonResponse(modelToolCall(`read-${requests.length}`, "file_read", {
        path: requiredPath,
        limit: 1_048_576,
      }));
    }
    if (instruction.includes("Post-mutation objective review output repair phase")) {
      return jsonResponse(modelToolCall("add-null-guard", "apply_patch", {
        input: correctionPatch,
      }));
    }
    if (instruction.includes("Post-mutation objective review phase")) {
      return jsonResponse(modelFinal("The quantity fix needs one final review."));
    }
    return jsonResponse(modelToolCall("fix-quantity", "apply_patch", {
      input: initialPatch,
    }));
  });

  const execute = vi.fn(async (request: {
    id: string;
    name: string;
    arguments?: Record<string, unknown>;
  }) => {
    if (request.name === "apply_patch") {
      const patchInput = String(request.arguments?.input ?? "");
      executedPatches.push(patchInput);
      currentSource = patchInput === correctionPatch ? correctedSource : quantitySource;
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
        content: currentSource,
      }),
      durationMs: 1,
    };
  });
  const agent = createAgent(execute);
  const items = await collect(agent.run({
    conversationId: "conv-post-correction-final-output-repair",
    text: "Fix invoice totals so every price is multiplied by quantity. Change only src/calculate.mjs and return one JSON object with a non-empty summary.",
    automationProfile: "bare",
    meta: {
      _agentLaunchSpec: {
        workspaceMutationRequirement: "required",
        requiredChangedPaths: [requiredPath],
        toolLoopIterationBudget: 12,
      },
    },
    structuredOutput: {
      schema: { type: "object", required: ["summary"] },
      validateOutput: (text: string) => text === '{"summary":"quantity-aware invoice totals verified"}'
        ? { ok: true as const, outputText: text }
        : { ok: false as const, message: "summary is required" },
    },
  } as any));

  return { requests, executedPatches, items, initialPatch, correctionPatch };
}

function createAgent(execute: ReturnType<typeof vi.fn>): ToolEnabledAgent {
  return new ToolEnabledAgent({
    baseUrl: "https://api.openai.com/v1",
    apiKey: "test-key",
    model: "deepseek-v4-flash",
    thinking: { type: "enabled" },
    maxTotalTokens: 24_000,
    maxOutputTokens: 4_096,
    toolLoopIterationBudget: 12,
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

function modelToolCall(id: string, name: string, args: Record<string, unknown>) {
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
    usage: { prompt_tokens: 300, completion_tokens: 60 },
  };
}

function modelFinal(content: string) {
  return {
    choices: [{ finish_reason: "stop", message: { content } }],
    usage: { prompt_tokens: 300, completion_tokens: 30 },
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
