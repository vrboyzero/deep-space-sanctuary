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

describe("ToolEnabledAgent whole-branch post-write correction", () => {
  it("keeps an invalid whole-branch delimiter correction deletion-only", async () => {
    const requiredPath = "src/diff/props.js";
    const removeAttributeLine = "\t\t\tdom.removeAttribute(name);";
    const setAttributeLine = "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);";
    const originalBranch = [
      "\t\tif (typeof value == 'function') {",
      "\t\t\t// never serialize functions as attribute values",
      "\t\t} else if (value != NULL && value !== false) {",
      setAttributeLine,
      "\t\t} else {",
      removeAttributeLine,
      "\t\t}",
    ].join("\n");
    const wholeBranchReplacement = [
      "\t\tif (typeof value == 'function') {",
      "\t\t\t// never serialize functions as attribute values",
      "\t\t} else if (value == NULL) {",
      removeAttributeLine,
      "\t\t} else if (name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-' || name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-') {",
      "\t\t\tdom.setAttribute(name, value === false ? 'false' : (name == 'popover' && value == true ? '' : value));",
      "\t\t} else if (value === false) {",
      removeAttributeLine,
      "\t\t} else {",
      setAttributeLine,
      "\t\t}",
      "\t\t}",
    ].join("\n");
    const originalSource = [
      "export function setProperty(dom, name, value) {",
      "\tif (name == 'style') {",
      "\t\tdom.style.cssText = value;",
      "\t} else {",
      "\t\t// aria- and data- attributes have no boolean representation.",
      "\t\t// A `false` value is different from the attribute not being present.",
      originalBranch,
      "\t}",
      "}",
    ].join("\n");
    const postWriteSource = originalSource.replace(originalBranch, wholeBranchReplacement);
    const initialPatch = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      " \t\tif (typeof value == 'function') {",
      " \t\t\t// never serialize functions as attribute values",
      "-\t\t} else if (value != NULL && value !== false) {",
      `-${setAttributeLine}`,
      "-\t\t} else {",
      `-${removeAttributeLine}`,
      "+\t\t} else if (value == NULL) {",
      `+${removeAttributeLine}`,
      "+\t\t} else if (name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-' || name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-') {",
      "+\t\t\tdom.setAttribute(name, value === false ? 'false' : (name == 'popover' && value == true ? '' : value));",
      "+\t\t} else if (value === false) {",
      `+${removeAttributeLine}`,
      "+\t\t} else {",
      `+${setAttributeLine}`,
      "+\t\t}",
      " \t\t}",
      "*** End Patch",
    ].join("\n");
    const broadCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      " \t\tif (typeof value == 'function') {",
      " \t\t\t// never serialize functions as attribute values",
      "-\t\t} else if (value == NULL) {",
      `-${removeAttributeLine}`,
      "-\t\t} else if (name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-' || name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-') {",
      "-\t\t\tdom.setAttribute(name, value === false ? 'false' : (name == 'popover' && value == true ? '' : value));",
      "-\t\t} else if (value === false) {",
      `-${removeAttributeLine}`,
      "-\t\t} else {",
      `-${setAttributeLine}`,
      "+\t\t} else if (value == NULL || (value === false && name[4] != '-')) {",
      `+${removeAttributeLine}`,
      "+\t\t} else {",
      "+\t\t\tdom.setAttribute(name, value === false ? 'false' : (name == 'popover' && value == true ? '' : value));",
      " \t\t}",
      "-\t\t}",
      "*** End Patch",
    ].join("\n");
    const task = "Fix the frozen browser-facing regression in the real web project. Preserve false values for aria-* and data-* attributes by serializing them, remove ordinary attributes with false values, and remove every attribute with null or undefined values. Make the smallest change in src/diff/props.js and pass the supplied deterministic checks.";
    const requests: Array<Record<string, any>> = [];
    const executedPatches: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      const instruction = String(body.messages?.[0]?.content ?? "");
      if (instruction.includes("Post-mutation verification phase")) {
        return jsonResponse(modelToolCall("read-whole-branch-source", "file_read", {
          path: requiredPath,
          limit: 1_048_576,
        }));
      }
      if (instruction.includes("Post-mutation objective correction input retry phase")) {
        return jsonResponse(modelToolCall("rewrite-whole-branch-again", "apply_patch", {
          input: broadCorrection,
        }));
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
      return jsonResponse(modelToolCall("rewrite-value-branch", "apply_patch", {
        input: initialPatch,
      }));
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
            size: postWriteSource.length,
            truncated: false,
            content: postWriteSource,
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
      conversationId: "conv-required-mutation-whole-branch-delimiter",
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
        validateOutput: (text: string) => text === '{"summary":"corrected and verified"}'
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(postWriteSource).toContain("\t\t} else if (value == NULL) {");
    expect(postWriteSource).toContain("value === false ? 'false'");
    expect(postWriteSource).toContain("\t\t} else if (value === false) {");
    expect(postWriteSource).toContain("\t\t}\n\t\t}\n\t}\n}");
    expect(requests).toHaveLength(4);
    expect(requests[3]?.messages[0]?.content).toContain(
      "Remove only the extra delimiter with a deletion-only hunk",
    );
    expect(requests[3]?.messages[0]?.content).toContain(
      "Preserve every non-delimiter line in the complete post-write source byte-for-byte",
    );
    expect(requests[3]?.messages[0]?.content).not.toContain(
      "The rebuilt correction must change task-relevant behavior",
    );
    expect(requests[3]?.messages[1]?.content).toContain(
      JSON.stringify(postWriteSource).slice(1, -1),
    );
    expect(executedPatches).toEqual([initialPatch]);
    expect(items.at(-2)).toEqual({
      type: "final",
      text: "required workspace mutation was not completed: the post-write objective correction did not narrowly refine the prior mutation despite the smallest-change requirement.",
    });
    expect(items.at(-1)).toEqual({ type: "status", status: "error" });
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
