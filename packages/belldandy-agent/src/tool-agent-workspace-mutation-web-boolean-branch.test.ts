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

describe("ToolEnabledAgent serialized-false boolean branch correction", () => {
  it("rebuilds the frozen truncated correction as the minimal SVG-inclusive predicate change", async () => {
    const requiredPath = "src/diff/props.js";
    const baselineBranch = [
      "\t\tif (typeof value == 'function') {",
      "\t\t\t// never serialize functions as attribute values",
      "\t\t} else if (value != NULL && value !== false) {",
      "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      "\t\t} else {",
      "\t\t\tdom.removeAttribute(name);",
      "\t\t}",
    ].join("\n");
    const booleanCondition = "\t\t} else if (typeof value == 'boolean' && !value && !isSvg) {";
    const correctedCondition = "\t\t} else if (typeof value == 'boolean' && !value) {";
    const postWriteBranch = [
      "\t\tif (typeof value == 'function') {",
      "\t\t\t// never serialize functions as attribute values",
      booleanCondition,
      "\t\t\t// False for boolean attributes (aria-/, data-/) means false.",
      "\t\t\tif (/^(aria|data)-/.test(name)) {",
      "\t\t\t\tdom.setAttribute(name, 'false');",
      "\t\t\t} else {",
      "\t\t\t\tdom.removeAttribute(name);",
      "\t\t\t}",
      "\t\t} else if (value != NULL && value !== false) {",
      "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      "\t\t} else {",
      "\t\t\tdom.removeAttribute(name);",
      "\t\t}",
    ].join("\n");
    const sourcePrefix = Array.from(
      { length: 145 },
      (_, index) => `const unrelatedBefore${index} = ${index};`,
    ).join("\n");
    const sourceSuffix = Array.from(
      { length: 70 },
      (_, index) => `const unrelatedAfter${index} = ${index};`,
    ).join("\n");
    const baselineSource = `${sourcePrefix}\n${baselineBranch}\n${sourceSuffix}`;
    const postWriteSource = baselineSource.replace(baselineBranch, postWriteBranch);
    const correctedSource = postWriteSource.replace(booleanCondition, correctedCondition);
    const initialPatch = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      " \t\tif (typeof value == 'function') {",
      " \t\t\t// never serialize functions as attribute values",
      "-\t\t} else if (value != NULL && value !== false) {",
      "-\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      "+\t\t} else if (typeof value == 'boolean' && !value && !isSvg) {",
      "+\t\t\t// False for boolean attributes (aria-/, data-/) means false.",
      "+\t\t\tif (/^(aria|data)-/.test(name)) {",
      "+\t\t\t\tdom.setAttribute(name, 'false');",
      "+\t\t\t} else {",
      "+\t\t\t\tdom.removeAttribute(name);",
      "+\t\t\t}",
      "+\t\t} else if (value != NULL && value !== false) {",
      "+\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      " \t\t} else {",
      " \t\t\tdom.removeAttribute(name);",
      " \t\t}",
      "*** End Patch",
    ].join("\n");
    const truncatedCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      "-\t\tif (typeof value == 'function') {",
      "-\t\t\t// never serialize functions as attribute values",
      `-${booleanCondition}`,
      "-\t\t\t// False for boolean attributes (aria-/, data-/) m",
      "+\t\tif (value == NULL) {",
      "+\t\t\tdom.removeAttribute(name);",
      "+\t\t} else if (typeof value == 'function' || typeof value == 'boolean' && !value && !isSvg) {",
      "+\t\t\tif (typeof value == 'function') {",
      "+\t\t\t\t// never serialize functions as attribute values",
      "+\t\t\t}",
      "*** End Patch",
    ].join("\n");
    const expectedCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      `-${booleanCondition}`,
      `+${correctedCondition}`,
      "*** End Patch",
    ].join("\n");
    const task = "Fix the frozen browser-facing regression in the real web project. Preserve false values for aria-* and data-* attributes by serializing them, remove ordinary attributes with false values, and remove every attribute with null or undefined values. Make the smallest change in src/diff/props.js and pass the supplied deterministic checks. Use the frozen behavior truth set real-web-ui-regression-v1. False aria-* and data-* values are serialized as the string false. False values for ordinary attributes remove the attribute. Null and undefined values remove every attribute, including aria-* and data-* attributes.";
    const successJson = '{"summary":"Verified serialized false attributes across HTML and SVG."}';
    const requests: Array<Record<string, any>> = [];
    const executedPatches: string[] = [];
    let currentSource = baselineSource;
    let ordinaryCallCount = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      const instruction = String(body.messages?.[0]?.content ?? "");
      if (instruction.includes("Post-mutation final objective review phase")) {
        return jsonResponse({
          choices: [{ finish_reason: "stop", message: { content: successJson } }],
          usage: { prompt_tokens: 300, completion_tokens: 30 },
        });
      }
      if (instruction.includes("Post-mutation verification phase")) {
        return jsonResponse(modelToolCall("read-current-source", "file_read", {
          path: requiredPath,
          limit: 1_048_576,
        }));
      }
      if (instruction.includes("Post-mutation objective review phase")
        || instruction.includes("Post-mutation objective correction input retry phase")) {
        return jsonResponse(modelToolCall("repair-truncated-branch", "apply_patch", {
          input: truncatedCorrection,
        }));
      }
      ordinaryCallCount++;
      return jsonResponse(ordinaryCallCount === 1
        ? modelToolCall("read-baseline-source", "file_read", { path: requiredPath })
        : modelToolCall("add-boolean-branch", "apply_patch", { input: initialPatch }));
    });

    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "file_read") {
        return {
          id: request.id,
          name: request.name,
          success: true,
          output: JSON.stringify({
            path: requiredPath,
            size: currentSource.length,
            truncated: false,
            content: currentSource,
          }),
          durationMs: 1,
        };
      }
      const patchInput = String(request.arguments?.input ?? "");
      executedPatches.push(patchInput);
      if (patchInput === initialPatch) {
        currentSource = postWriteSource;
      } else if (patchInput === expectedCorrection) {
        currentSource = correctedSource;
      } else {
        return {
          id: request.id,
          name: request.name,
          success: false,
          output: "",
          error: "Failed to find expected lines: truncated branch context",
          failureKind: "input_error" as const,
          metadata: { repairAction: "apply_patch_input_invalid" },
          durationMs: 1,
        };
      }
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
      conversationId: "conv-frozen-web-boolean-branch",
      text: task,
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths: [requiredPath],
          toolLoopIterationBudget: 10,
        },
      },
      structuredOutput: {
        schema: { type: "object", required: ["summary"] },
        validateOutput: (text: string) => text === successJson
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(postWriteSource.length).toBeGreaterThan(4_096);
    expect(executedPatches).toEqual([
      initialPatch,
      truncatedCorrection,
      expectedCorrection,
    ]);
    expect(currentSource).toBe(correctedSource);
    expect(items.at(-2)).toEqual({ type: "final", text: successJson });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
    expect(requests.some((request) => String(request.messages?.[0]?.content ?? "")
      .includes("Post-mutation objective correction input retry phase"))).toBe(true);
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
    toolLoopIterationBudget: 10,
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
