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

describe("ToolEnabledAgent closing-delimiter correction", () => {
  it("rebuilds a deletion-only required-path patch when the formal correction has no valid section", async () => {
    const requiredPath = "src/diff/props.js";
    const lineEnding = "\r\n";
    const initialPatch = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      "-\t\tif (typeof value == 'function') {",
      "-\t\t\t// never serialize functions as attribute values",
      "-\t\t} else if (value != NULL && value !== false) {",
      "-\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      "-\t\t} else {",
      "-\t\t\tdom.removeAttribute(name);",
      "+\t\tif (typeof value == 'function') {",
      "+\t\t\t// never serialize functions as attribute values",
      "+\t\t} else if (value != NULL && value !== false) {",
      "+\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      "+\t\t} else if (value != NULL && (name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-' || name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-')) {",
      "+\t\t\tdom.setAttribute(name, String(value));",
      "+\t\t} else {",
      "+\t\t\tdom.removeAttribute(name);",
      "+\t\t}",
      "*** End Patch",
    ].join("\n");
    const sourcePrefix = Array.from(
      { length: 150 },
      (_, index) => `const unrelatedSourceValue${index} = ${index};`,
    );
    const postInitialSource = [
      ...sourcePrefix,
      "export function setProperty(dom, name, value) {",
      "\tif (name == 'style') {",
      "\t\tdom.style.cssText = value;",
      "\t} else {",
      "\t\t// aria- and data- attributes have no boolean representation.",
      "\t\t// A `false` value is different from the attribute not being present.",
      "\t\tif (typeof value == 'function') {",
      "\t\t\t// never serialize functions as attribute values",
      "\t\t} else if (value != NULL && value !== false) {",
      "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      "\t\t} else if (value != NULL && (name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-' || name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-')) {",
      "\t\t\tdom.setAttribute(name, String(value));",
      "\t\t} else {",
      "\t\t\tdom.removeAttribute(name);",
      "\t\t}",
      "\t\t}",
      "\t}",
      "}",
    ].join(lineEnding);
    const postCorrectionSource = postInitialSource.replace(
      ["\t\t}", "\t\t}", "\t}", "}"].join(lineEnding),
      ["\t\t}", "\t}", "}"].join(lineEnding),
    );
    const expectedCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      " \t\t} else {",
      " \t\t\tdom.removeAttribute(name);",
      " \t\t}",
      "-\t\t}",
      " \t}",
      " }",
      "*** End Patch",
    ].join(lineEnding);
    const successfulSummary = "{\"summary\":\"removed the extra closing delimiter and verified the attribute behavior\"}";
    const task = "Fix the frozen browser-facing regression in the real web project. Preserve false values for aria-* and data-* attributes by serializing them, remove ordinary attributes with false values, and remove every attribute with null or undefined values. Make the smallest change in src/diff/props.js and pass the supplied deterministic checks.";
    const requests: Array<Record<string, any>> = [];
    const executedPatches: string[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      const instruction = String(body.messages?.[0]?.content ?? "");
      if (instruction.includes("Post-mutation verification phase")) {
        return jsonResponse(modelToolCall(`read-${requests.length}`, "file_read", {
          path: requiredPath,
          limit: 1_048_576,
        }));
      }
      if (instruction.includes("Post-mutation objective correction input retry phase")) {
        return jsonResponse(modelToolCall("formal-invalid-correction", "apply_patch", {
          input: "*** Begin Patch\n*** End Patch",
        }));
      }
      if (instruction.includes("Post-mutation final objective review phase")
        || instruction.includes("Post-mutation objective review phase")) {
        return jsonResponse({
          choices: [{
            finish_reason: "stop",
            message: {
              content: executedPatches.length > 1
                ? successfulSummary
                : "The source looks corrected, but this is not the required JSON.",
            },
          }],
          usage: { prompt_tokens: 300, completion_tokens: 30 },
        });
      }
      return jsonResponse(modelToolCall("formal-initial-patch", "apply_patch", {
        input: initialPatch,
      }));
    });

    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "file_read") {
        const content = executedPatches.length > 1 ? postCorrectionSource : postInitialSource;
        return {
          id: request.id,
          name: request.name,
          success: true,
          output: JSON.stringify({
            path: requiredPath,
            size: content.length,
            truncated: false,
            content,
          }),
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
      conversationId: "conv-formal-invalid-closing-delimiter-correction",
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

    expect(postInitialSource.length).toBeGreaterThan(5_000);
    expect(requests[3]?.messages[0]?.content).toContain(
      "Remove only the extra delimiter with a deletion-only hunk",
    );
    expect(executedPatches).toEqual([initialPatch, expectedCorrection]);
    expect(items).toContainEqual({ type: "final", text: successfulSummary });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("rebuilds the frozen whole-branch correction when its envelope has no valid section", async () => {
    const requiredPath = "src/diff/props.js";
    const initialPatch = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      "-\t\tif (typeof value == 'function') {",
      "-\t\t\t// never serialize functions as attribute values",
      "-\t\t} else if (value != NULL && value !== false) {",
      "-\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      "-\t\t} else {",
      "-\t\t\tdom.removeAttribute(name);",
      "+\t\tif (typeof value == 'function') {",
      "+\t\t\t// never serialize functions as attribute values",
      "+\t\t} else if (value == NULL) {",
      "+\t\t\tdom.removeAttribute(name);",
      "+\t\t} else if (value === false) {",
      "+\t\t\tif (name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-') {",
      "+\t\t\t\tdom.setAttribute(name, 'false');",
      "+\t\t\t} else if (name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-') {",
      "+\t\t\t\tdom.setAttribute(name, 'false');",
      "+\t\t\t} else {",
      "+\t\t\t\tdom.removeAttribute(name);",
      "+\t\t\t}",
      "+\t\t} else {",
      "+\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      "+\t\t}",
      "*** End Patch",
      "",
    ].join("\n");
    const sourcePrefix = Array.from(
      { length: 150 },
      (_, index) => `const unrelatedSourceValue${index} = ${index};`,
    );
    const postInitialSource = [
      ...sourcePrefix,
      "export function setProperty(dom, name, value) {",
      "\to: if (name == 'style') {",
      "\t\tdom.style.cssText = value;",
      "\t} else {",
      "\t\t// aria- and data- attributes have no boolean representation.",
      "\t\t// A `false` value is different from the attribute not being",
      "\t\t// present, so we can't remove it. For non-boolean aria",
      "\t\t// attributes we could treat false as a removal, but the",
      "\t\t// amount of exceptions would cost too many bytes. On top of",
      "\t\t// that other frameworks generally stringify `false`.",
      "\t\tif (typeof value == 'function') {",
      "\t\t\t// never serialize functions as attribute values",
      "\t\t} else if (value == NULL) {",
      "\t\t\tdom.removeAttribute(name);",
      "\t\t} else if (value === false) {",
      "\t\t\tif (name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-') {",
      "\t\t\t\tdom.setAttribute(name, 'false');",
      "\t\t\t} else if (name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-') {",
      "\t\t\t\tdom.setAttribute(name, 'false');",
      "\t\t\t} else {",
      "\t\t\t\tdom.removeAttribute(name);",
      "\t\t\t}",
      "\t\t} else {",
      "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      "\t\t}",
      "\t\t}",
      "\t}",
      "}",
    ].join("\n");
    const postCorrectionSource = postInitialSource.replace(
      ["\t\t}", "\t\t}", "\t}", "}"].join("\n"),
      ["\t\t}", "\t}", "}"].join("\n"),
    );
    const expectedCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      " \t\t} else {",
      " \t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      " \t\t}",
      "-\t\t}",
      " \t}",
      " }",
      "*** End Patch",
    ].join("\n");
    const successfulSummary = "{\"summary\":\"removed the frozen whole-branch extra delimiter\"}";
    const task = "Fix the frozen browser-facing regression in the real web project. Preserve false values for aria-* and data-* attributes by serializing them, remove ordinary attributes with false values, and remove every attribute with null or undefined values. Make the smallest change in src/diff/props.js and pass the supplied deterministic checks.";
    const requests: Array<Record<string, any>> = [];
    const executedPatches: string[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      const instruction = String(body.messages?.[0]?.content ?? "");
      if (instruction.includes("Post-mutation verification phase")) {
        return jsonResponse(modelToolCall(`read-${requests.length}`, "file_read", {
          path: requiredPath,
          limit: 1_048_576,
        }));
      }
      if (instruction.includes("Post-mutation objective correction input retry phase")) {
        return jsonResponse(modelToolCall("frozen-invalid-correction", "apply_patch", {
          input: "*** Begin Patch\n*** End Patch",
        }));
      }
      if (instruction.includes("Post-mutation final objective review phase")) {
        return jsonResponse({
          choices: [{
            finish_reason: "stop",
            message: { content: successfulSummary },
          }],
          usage: { prompt_tokens: 300, completion_tokens: 30 },
        });
      }
      if (instruction.includes("Post-mutation objective review phase")) {
        return jsonResponse({
          choices: [{
            finish_reason: "stop",
            message: { content: "The source looks corrected, but this is not the required JSON." },
          }],
          usage: { prompt_tokens: 300, completion_tokens: 30 },
        });
      }
      return jsonResponse(modelToolCall("frozen-whole-branch-patch", "apply_patch", {
        input: initialPatch,
      }));
    });

    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "file_read") {
        const content = executedPatches.length > 1 ? postCorrectionSource : postInitialSource;
        return {
          id: request.id,
          name: request.name,
          success: true,
          output: JSON.stringify({
            path: requiredPath,
            size: content.length,
            truncated: false,
            content,
          }),
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
      conversationId: "conv-frozen-whole-branch-invalid-correction",
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

    expect(initialPatch).toHaveLength(937);
    expect(postInitialSource.length).toBeGreaterThan(5_000);
    expect(requests[3]?.messages[0]?.content).toContain(
      "Remove only the extra delimiter with a deletion-only hunk",
    );
    expect(executedPatches).toEqual([initialPatch, expectedCorrection]);
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
