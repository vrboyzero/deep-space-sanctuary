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

describe("ToolEnabledAgent serialized-false correction", () => {
  it("rebuilds a broad first-character objective correction as the baseline condition", async () => {
    const requiredPath = "src/diff/props.js";
    const initialPredicate = "\t\t\t(value !== false || (name[0] == 'a' && name[0] == 'a'))";
    const broadPredicate = "\t\t\t(value !== false || name[0] == 'a' || name[0] == 'd')";
    const baselineCondition = "\t\t} else if (value != NULL && (value !== false || name[4] == '-')) {";
    const initialPatch = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      "-\t\t} else if (value != NULL && value !== false) {",
      "+\t\t} else if (",
      "+\t\t\tvalue != NULL &&",
      `+${initialPredicate}`,
      "+\t\t) {",
      " \t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      "*** End Patch",
    ].join("\n");
    const broadCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      " \t\t} else if (",
      " \t\t\tvalue != NULL &&",
      `-${initialPredicate}`,
      `+${broadPredicate}`,
      " \t\t) {",
      "*** End Patch",
    ].join("\n");
    const expectedCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      "-\t\t} else if (",
      "-\t\t\tvalue != NULL &&",
      `-${initialPredicate}`,
      "-\t\t) {",
      `+${baselineCondition}`,
      "*** End Patch",
    ].join("\n");
    const sourceAroundCondition = [
      "\t\tif (typeof value == 'function') {",
      "\t\t\t// never serialize functions as attribute values",
      "__CONDITION__",
      "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      "\t\t} else {",
      "\t\t\tdom.removeAttribute(name);",
      "\t\t}",
    ].join("\n");
    const initialSource = sourceAroundCondition.replace("__CONDITION__", [
      "\t\t} else if (",
      "\t\t\tvalue != NULL &&",
      initialPredicate,
      "\t\t) {",
    ].join("\n"));
    const correctedSource = sourceAroundCondition.replace("__CONDITION__", baselineCondition);
    const successfulSummary = '{"summary":"preserved the frozen serialized-false contract"}';
    const task = "Fix the frozen browser-facing regression in the real web project. Preserve false values for aria-* and data-* attributes by serializing them, remove ordinary attributes with false values, and remove every attribute with null or undefined values. Make the smallest change in src/diff/props.js and pass the supplied deterministic checks.";
    const requests: Array<Record<string, any>> = [];
    const executedPatches: string[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      const instruction = String(body.messages?.[0]?.content ?? "");
      if (instruction.includes("Post-mutation verification phase")) {
        return response(modelToolCall(`read-${requests.length}`, "file_read", {
          path: requiredPath,
          limit: 1_048_576,
        }));
      }
      if (instruction.includes("Post-mutation final objective review phase")) {
        return response({
          choices: [{ finish_reason: "stop", message: { content: successfulSummary } }],
          usage: { prompt_tokens: 300, completion_tokens: 30 },
        });
      }
      if (instruction.includes("Post-mutation objective review phase")) {
        return response(modelToolCall("formal-broad-first-character-correction", "apply_patch", {
          input: broadCorrection,
        }));
      }
      return response(modelToolCall("formal-initial-multiline-patch", "apply_patch", {
        input: initialPatch,
      }));
    });

    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "file_read") {
        const content = executedPatches.length > 1 ? correctedSource : initialSource;
        return {
          id: request.id,
          name: request.name,
          success: true,
          output: JSON.stringify({ path: requiredPath, truncated: false, content }),
          durationMs: 1,
        };
      }
      executedPatches.push(String(request.arguments?.input ?? ""));
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
    });
    const agent = createAgent(execute);

    const items = await collect(agent.run({
      conversationId: "conv-formal-broad-first-character-correction",
      text: task,
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
        validateOutput: (text: string) => text === successfulSummary
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(requests).toHaveLength(5);
    expect(executedPatches).toEqual([initialPatch, expectedCorrection]);
    expect(executedPatches).not.toContain(broadCorrection);
    expect(items).toContainEqual({ type: "final", text: successfulSummary });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("rebuilds a direct sibling double-else correction as the baseline condition", async () => {
    const requiredPath = "src/diff/props.js";
    const reachableCondition = "\t\t} else if (value != NULL && (value !== false || name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' || name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-')) {";
    const initialPatch = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      "-\t\t} else if (value != NULL && value !== false) {",
      `+${reachableCondition}`,
      " \t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      "*** End Patch",
    ].join("\n");
    const baselineCondition = "\t\t} else if (value != NULL && (value !== false || name[4] == '-')) {";
    const expectedCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      `-${reachableCondition}`,
      `+${baselineCondition}`,
      "*** End Patch",
    ].join("\n");
    const invalidCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      "-\t\tif (typeof value == 'function') {",
      "-\t\t\t// never serialize functions as attribute values",
      `-${reachableCondition}`,
      "+\t\tif (typeof value == 'function' || value == NULL || value === false && !(name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' || name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-')) {",
      "+\t\t\t// functions, null, undefined are never serialized; false removes ordinary attributes",
      "+\t\t} else {",
      " \t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      "*** End Patch",
    ].join("\n");
    const validSource = [
      "\t\tif (typeof value == 'function') {",
      "\t\t\t// never serialize functions as attribute values",
      reachableCondition,
      "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      "\t\t} else {",
      "\t\t\tdom.removeAttribute(name);",
      "\t\t}",
    ].join("\n");
    const correctedSource = [
      "\t\tif (typeof value == 'function') {",
      "\t\t\t// never serialize functions as attribute values",
      baselineCondition,
      "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      "\t\t} else {",
      "\t\t\tdom.removeAttribute(name);",
      "\t\t}",
    ].join("\n");
    const successfulSummary = '{"summary":"preserved false attribute handling and verified the result"}';
    const task = "Fix the frozen browser-facing regression in the real web project. Preserve false values for aria-* and data-* attributes by serializing them, remove ordinary attributes with false values, and remove every attribute with null or undefined values. Make the smallest change in src/diff/props.js and pass the supplied deterministic checks.";
    const requests: Array<Record<string, any>> = [];
    const executedPatches: string[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      const instruction = String(body.messages?.[0]?.content ?? "");
      if (instruction.includes("Post-mutation verification phase")) {
        return response(modelToolCall(`read-${requests.length}`, "file_read", {
          path: requiredPath,
          limit: 1_048_576,
        }));
      }
      if (instruction.includes("Post-mutation final objective review phase")) {
        return response({
          choices: [{ finish_reason: "stop", message: { content: successfulSummary } }],
          usage: { prompt_tokens: 300, completion_tokens: 30 },
        });
      }
      if (instruction.includes("Post-mutation objective review phase")) {
        return response(modelToolCall("formal-invalid-double-else-correction", "apply_patch", {
          input: invalidCorrection,
        }));
      }
      return response(modelToolCall("formal-initial-reachable-patch", "apply_patch", {
        input: initialPatch,
      }));
    });

    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "file_read") {
        const content = executedPatches.length > 1 ? correctedSource : validSource;
        return {
          id: request.id,
          name: request.name,
          success: true,
          output: JSON.stringify({ path: requiredPath, truncated: false, content }),
          durationMs: 1,
        };
      }
      executedPatches.push(String(request.arguments?.input ?? ""));
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
    });
    const agent = createAgent(execute);

    const items = await collect(agent.run({
      conversationId: "conv-formal-double-else-serialized-false-correction",
      text: task,
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
        validateOutput: (text: string) => text === successfulSummary
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(requests).toHaveLength(5);
    expect(requests[4]?.messages[0]?.content).toContain(
      "Post-mutation final objective review phase",
    );
    expect(executedPatches).toEqual([initialPatch, expectedCorrection]);
    expect(executedPatches).not.toContain(invalidCorrection);
    expect(items).toContainEqual({ type: "final", text: successfulSummary });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("rebuilds the frozen formal's truncated input-correction hunk from current source", async () => {
    const requiredPath = "src/diff/props.js";
    const broadCondition = "\t\t} else if (value === false && (name[0] == 'a' || name[0] == 'd') && name.indexOf('-') > 0) {";
    const narrowCondition = "\t\t} else if (value === false && name[4] == '-') {";
    const initialPatch = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      "-\t\t} else {",
      `+${broadCondition}`,
      "+\t\t\tdom.setAttribute(name, 'false');",
      "+\t\t} else {",
      "*** End Patch",
    ].join("\n");
    const malformedCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      "-\t\t} else if (value === false && (name[0] == 'a' || name[0] == 'd') && ",
      `+${narrowCondition}`,
      "*** End Patch",
    ].join("\n");
    const expectedCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      `-${broadCondition}`,
      `+${narrowCondition}`,
      "*** End Patch",
    ].join("\n");
    const sourceAroundCondition = [
      "\t\tif (typeof value == 'function') {",
      "\t\t\t// never serialize functions as attribute values",
      "\t\t} else if (value != NULL && value !== false) {",
      "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      "__CONDITION__",
      "\t\t\t// aria- and data- attributes have no boolean representation;",
      "\t\t\tdom.setAttribute(name, 'false');",
      "\t\t} else {",
      "\t\t\tdom.removeAttribute(name);",
      "\t\t}",
    ].join("\n");
    const broadSource = sourceAroundCondition.replace("__CONDITION__", broadCondition);
    const narrowSource = sourceAroundCondition.replace("__CONDITION__", narrowCondition);
    const successfulSummary = '{"summary":"narrowed false attribute handling and verified the result"}';
    const task = "Fix the frozen browser-facing regression in the real web project. Preserve false values for aria-* and data-* attributes by serializing them, remove ordinary attributes with false values, and remove every attribute with null or undefined values. Make the smallest change in src/diff/props.js and pass the supplied deterministic checks.";
    const requests: Array<Record<string, any>> = [];
    const executedPatches: string[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      const instruction = String(body.messages?.[0]?.content ?? "");
      if (instruction.includes("Post-mutation verification phase")) {
        return response(modelToolCall(`read-${requests.length}`, "file_read", {
          path: requiredPath,
          limit: 1_048_576,
        }));
      }
      if (instruction.includes("Post-mutation objective correction input retry phase")) {
        return response(modelToolCall("formal-truncated-correction", "apply_patch", {
          input: malformedCorrection,
        }));
      }
      if (instruction.includes("Post-mutation final objective review phase")) {
        return response({
          choices: [{ finish_reason: "stop", message: { content: successfulSummary } }],
          usage: { prompt_tokens: 300, completion_tokens: 30 },
        });
      }
      if (instruction.includes("Post-mutation objective review phase")) {
        return response(modelToolCall("invalid-local-correction", "apply_patch", {
          input: "*** Begin Patch\n*** End Patch",
        }));
      }
      return response(modelToolCall("formal-initial-broad-patch", "apply_patch", {
        input: initialPatch,
      }));
    });

    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "file_read") {
        const content = executedPatches.length > 1 ? narrowSource : broadSource;
        return {
          id: request.id,
          name: request.name,
          success: true,
          output: JSON.stringify({ path: requiredPath, truncated: false, content }),
          durationMs: 1,
        };
      }
      executedPatches.push(String(request.arguments?.input ?? ""));
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
    });
    const agent = createAgent(execute);

    const items = await collect(agent.run({
      conversationId: "conv-formal-truncated-serialized-false-correction",
      text: task,
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
        validateOutput: (text: string) => text === successfulSummary
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(requests).toHaveLength(6);
    expect(requests[3]?.messages[0]?.content).toContain(
      "Post-mutation objective correction input retry phase",
    );
    expect(executedPatches).toEqual([initialPatch, expectedCorrection]);
    expect(executedPatches).not.toContain(malformedCorrection);
    expect(items).toContainEqual({ type: "final", text: successfulSummary });
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

function response(body: unknown): Response {
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
