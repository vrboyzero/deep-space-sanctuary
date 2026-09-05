import { afterEach, expect, it, vi } from "vitest";

vi.mock("./model-request-transport.js", () => ({
  requestModelTransport: (options: { url: string | URL; init: RequestInit }) => fetch(options.url, options.init),
}));
import { ToolEnabledAgent } from "./tool-agent.js";

afterEach(() => vi.restoreAllMocks());

it.each([false, true])("requires the referenced test before the forced patch (truncated=%s)", async (truncated) => {
  const sourcePath = "src/pager.js";
  const testPath = "test/pager.test.js";
  const executed: string[] = [];
  const requests: Array<Record<string, any>> = [];
  let patched = false;
  const call = (name: string, args: Record<string, unknown>) => ({
    finish_reason: "tool_calls", message: { content: null,
      tool_calls: [{ id: `call-${requests.length}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] },
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    const instruction = String(body.messages[0].content);
    const choice = requests.length === 1 ? call("file_read", { path: sourcePath })
      : instruction.includes("Bounded source-navigation phase") ? call("file_read", { path: testPath })
      : instruction.includes("Post-mutation verification phase") ? call("file_read", { path: sourcePath })
      : instruction.includes("objective review") ? { finish_reason: "stop", message: { content: '{"summary":"fixed"}' } }
      : call("apply_patch", { input: `*** Begin Patch\n*** Update File: ${sourcePath}\n@@\n-return values.slice(offset + 1);\n+return values.slice(offset);\n*** End Patch` });
    return new Response(JSON.stringify({ choices: [choice],
      usage: { prompt_tokens: requests.length === 1 ? 10000 : 300, completion_tokens: 60 } }),
    { status: 200, headers: { "content-type": "application/json" } });
  });
  const agent = new ToolEnabledAgent({
    baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "deepseek-v4-flash",
    thinking: { type: "enabled" }, maxTotalTokens: 24000, maxOutputTokens: 4096,
    toolLoopIterationBudget: 12, streamingEnabled: false,
    toolExecutor: {
      getDefinitions: () => ["file_read", "apply_patch"].map((name) => ({ type: "function",
        function: { name, description: `${name} tool`, parameters: { type: "object", properties: {} } } })),
      getRegisteredToolContract: (name: string) => ({ name, family: name === "apply_patch" ? "patch" : "workspace-read",
        isReadOnly: name !== "apply_patch", riskLevel: name === "apply_patch" ? "high" : "low" }),
      consumeLoadedDeferredToolsForNextTurn: vi.fn(async () => []), setTokenCounter: vi.fn(),
      clearTokenCounter: vi.fn(), releaseConversation: vi.fn(),
      execute: vi.fn(async (request: { id: string; name: string; arguments: Record<string, unknown> }) => {
        executed.push(request.name === "file_read" ? String(request.arguments.path) : request.name);
        if (request.name === "apply_patch") patched = true;
        return { id: request.id, name: request.name, success: true, durationMs: 1,
          ...(request.name === "apply_patch"
            ? { output: "Patch applied successfully", metadata: { workspaceMutation: { schemaVersion: 1, changedPaths: [sourcePath] } } }
            : { output: JSON.stringify({ path: request.arguments.path, truncated: request.arguments.path === testPath && truncated,
              content: request.arguments.path === testPath ? "assert.deepEqual(remaining([1, 2, 3], 1), [2, 3]);"
                : `return values.slice(offset${patched ? "" : " + 1"});` }) }) };
      }),
    } as any,
  });
  const items = [];
  for await (const item of agent.run({ conversationId: "referenced-test-navigation",
    text: `Fix ${sourcePath}. The regression is in ${testPath}. Return JSON with a summary.`,
    automationProfile: "bare", meta: { _agentLaunchSpec: { workspaceMutationRequirement: "required",
      requiredChangedPaths: [sourcePath], toolLoopIterationBudget: 12 } },
    structuredOutput: { schema: { type: "object", required: ["summary"] },
      validateOutput: (text: string) => text === '{"summary":"fixed"}'
        ? { ok: true as const, outputText: text } : { ok: false as const, message: "summary required" } },
  } as any)) items.push(item);
  expect(requests[1]?.tools.map((tool: any) => tool.function.name)).toEqual(["file_read"]);
  if (truncated) {
    expect(executed).toEqual([sourcePath, testPath]);
    expect(requests).toHaveLength(2);
    expect(items.at(-1)).toEqual({ type: "status", status: "error" });
    return;
  }
  expect(executed).toEqual([sourcePath, testPath, "apply_patch", sourcePath]);
  expect(requests[2]?.tools.map((tool: any) => tool.function.name)).toEqual(["apply_patch"]);
  expect(requests[2]?.messages[1].content).toContain('["src/pager.js"]');
  expect(requests[2]?.messages[1].content).toContain("assert.deepEqual");
  expect(items.at(-1)).toEqual({ type: "status", status: "done" });
});
