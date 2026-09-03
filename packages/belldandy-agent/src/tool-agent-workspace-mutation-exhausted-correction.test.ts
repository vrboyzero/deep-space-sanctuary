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

describe("verified mutation after exhausted objective correction", () => {
  it("retains the frozen Command.Name Index fix instead of executing a Cut rewrite", async () => {
    const requiredChangedPaths = ["command.go"];
    const successfulSummary = '{"summary":"verified"}';
    const initialPatch = [
      "*** Begin Patch",
      "*** Update File: command.go",
      "@@",
      " func (c *Command) Name() string {",
      " \tname := c.Use",
      "-\ti := strings.LastIndex(name, \" \")",
      "+\ti := strings.Index(name, \" \")",
      " \tif i >= 0 {",
      " \t\tname = name[:i]",
      " \t}",
      " \treturn name",
      " }",
      "*** End Patch",
    ].join("\n");
    const regressiveCorrection = [
      "*** Begin Patch",
      "*** Update File: command.go",
      "@@",
      " func (c *Command) Name() string {",
      "-\tname := c.Use",
      "-\ti := strings.Index(name, \" \")",
      "-\tif i >= 0 {",
      "-\t\tname = name[:i]",
      "-\t}",
      "+\tname, _, _ := strings.Cut(c.Use, \" \")",
      " \treturn name",
      " }",
      "*** End Patch",
    ].join("\n");
    const currentSource = [
      "func (c *Command) Name() string {",
      "\tname := c.Use",
      "\ti := strings.Index(name, \" \")",
      "\tif i >= 0 {",
      "\t\tname = name[:i]",
      "\t}",
      "\treturn name",
      "}",
    ].join("\n");
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return response(modelToolCall("index-fix", "apply_patch", { input: initialPatch }));
      }
      if (requests.length === 2) {
        return response(modelVerificationReads(requiredChangedPaths));
      }
      if (requests.length === 3) {
        return response(modelToolCall("cut-rewrite", "apply_patch", { input: regressiveCorrection }));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: successfulSummary } }],
        usage: { prompt_tokens: 300, completion_tokens: 30 },
      });
    });
    const executedPatches: string[] = [];
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "apply_patch") {
        executedPatches.push(String(request.arguments?.input ?? ""));
      }
      return {
        id: request.id,
        name: request.name,
        success: true,
        output: request.name === "file_read"
          ? JSON.stringify({ path: request.arguments?.path, truncated: false, content: currentSource })
          : "Patch applied successfully",
        ...(request.name === "apply_patch" ? {
          metadata: {
            workspaceMutation: { schemaVersion: 1, changedPaths: requiredChangedPaths },
          },
        } : {}),
        durationMs: 1,
      };
    });

    const items = await collect(createAgent(execute).run({
      conversationId: "verified-command-name-index-fix",
      text: "Reproduce the frozen Go regression, make the smallest correction, and keep the repository's deterministic tests passing with GOPROXY disabled.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
          toolLoopIterationBudget: 12,
        },
      },
      structuredOutput: {
        schema: { type: "object", required: ["summary"] },
        validateOutput: (text: string) => text === successfulSummary
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(requests).toHaveLength(4);
    expect(requests[3]).not.toHaveProperty("tools");
    expect(executedPatches).toEqual([initialPatch]);
    expect(items).toContainEqual({ type: "final", text: successfulSummary });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it.each([
    {
      name: "unlisted path",
      taskText: "Replace the frozen value in src/api.ts.",
      initialPatch: "initial patch",
      currentSource: "export const value = 'new';",
      correctionPatch: [
        "*** Begin Patch",
        "*** Update File: src/extra.ts",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
      ].join("\n"),
    },
    {
      name: "repeated current source",
      taskText: "Replace the frozen value in src/api.ts.",
      initialPatch: "initial patch",
      currentSource: "export const value = 'new';",
      correctionPatch: [
        "*** Begin Patch",
        "*** Update File: src/api.ts",
        "@@",
        "-export const value = 'new';",
        "+export const value = 'new';",
        "*** End Patch",
      ].join("\n"),
    },
    {
      name: "expanded smallest change",
      taskText: "Replace old with new using the smallest change in src/api.ts.",
      initialPatch: [
        "*** Begin Patch",
        "*** Update File: src/api.ts",
        "@@",
        "-export const value = 'old';",
        "+export const value = 'new';",
        "*** End Patch",
      ].join("\n"),
      currentSource: "export const value = 'new';",
      correctionPatch: [
        "*** Begin Patch",
        "*** Update File: src/api.ts",
        "@@",
        "-export const value = 'new';",
        "+const first = true;",
        "+const second = true;",
        "+const third = true;",
        "+const fourth = true;",
        "+const fifth = true;",
        "+const sixth = true;",
        "+const seventh = true;",
        "+export const value = 'new';",
        "*** End Patch",
      ].join("\n"),
    },
  ])("retains the verified mutation after a $name correction retry", async (fixture) => {
    const requiredChangedPaths = ["src/api.ts"];
    const successfulSummary = '{"summary":"verified"}';
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return response(modelToolCall("initial-patch", "apply_patch", { input: fixture.initialPatch }));
      }
      if (requests.length === 2) {
        return response(modelVerificationReads(requiredChangedPaths));
      }
      if (requests.length === 3 || requests.length === 4) {
        return response(modelToolCall(`rejected-correction-${requests.length}`, "apply_patch", {
          input: fixture.correctionPatch,
        }));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: successfulSummary } }],
        usage: { prompt_tokens: 300, completion_tokens: 30 },
      });
    });
    const executedPatches: string[] = [];
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "apply_patch") {
        executedPatches.push(String(request.arguments?.input ?? ""));
        return {
          id: request.id,
          name: request.name,
          success: true,
          output: "Patch applied successfully",
          metadata: {
            workspaceMutation: { schemaVersion: 1, changedPaths: requiredChangedPaths },
          },
          durationMs: 1,
        };
      }
      return {
        id: request.id,
        name: request.name,
        success: true,
        output: JSON.stringify({
          path: request.arguments?.path,
          truncated: false,
          content: fixture.currentSource,
        }),
        durationMs: 1,
      };
    });
    const agent = createAgent(execute);

    const items = await collect(agent.run({
      conversationId: `verified-mutation-${fixture.name.replaceAll(" ", "-")}`,
      text: fixture.taskText,
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
          toolLoopIterationBudget: 12,
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
    expect(requests[3]?.messages[0]?.content).toContain(
      "Post-mutation objective correction input retry phase",
    );
    expect(requests[4]).not.toHaveProperty("tools");
    expect(requests[4]?.messages[0]?.content).toContain(
      "Post-mutation final objective review phase",
    );
    expect(executedPatches).toEqual([fixture.initialPatch]);
    expect(items).toContainEqual({ type: "final", text: successfulSummary });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });
});

function createAgent(execute: ReturnType<typeof vi.fn>) {
  const definitions = [toolDefinition("file_read"), toolDefinition("apply_patch")];
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
      getDefinitions: () => definitions,
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
      description: `${name} description`,
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

function modelVerificationReads(requiredPaths: readonly string[]) {
  return {
    choices: [{
      finish_reason: "tool_calls",
      message: {
        content: null,
        tool_calls: requiredPaths.map((path, index) => (
          modelToolCall(`verify-${index}`, "file_read", { path }).choices[0].message.tool_calls[0]
        )),
      },
    }],
    usage: { prompt_tokens: 400, completion_tokens: 80 },
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
