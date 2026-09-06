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

describe("residual-driven bounded correction cycles", () => {
  it("keeps scheduling corrections until the residual scan reports zero, then finalizes", async () => {
    const requiredChangedPaths = ["bash_completions.go"];
    const requiredResidualIdentifiers = ["WriteStringAndCheck"];
    const successfulSummary = '{"summary":"all call sites migrated"}';
    let residualOccurrences = 4;

    const buildContent = () => [
      "package cobra",
      "func writeFlags(buf io.StringWriter) {",
      ...Array.from({ length: residualOccurrences }, () => "\tWriteStringAndCheck(buf, \"\\n\")"),
      "}",
    ].join("\n");

    const removePatch = (count: number) => [
      "*** Begin Patch",
      "*** Update File: bash_completions.go",
      "@@",
      ...Array.from({ length: count }, () => "-\tWriteStringAndCheck(buf, \"\\n\")"),
      ...Array.from({ length: count }, () => "+\tWriteString(buf, \"\\n\")"),
      "*** End Patch",
    ].join("\n");

    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      // 1: 初次写入，只清 1 处（残留 3）
      if (requests.length === 1) {
        return response(modelToolCall("patch-1", "apply_patch", { input: removePatch(1) }));
      }
      // 2: 读后验证（残留 3）
      if (requests.length === 2) {
        return response(modelVerificationReads(requiredChangedPaths));
      }
      // 3: 客观复核返回有效输出 → 触发第 1 轮纠正
      if (requests.length === 3) {
        return response(textResponse(successfulSummary));
      }
      // 4: 第 1 轮纠正，清 2 处（残留 1）
      if (requests.length === 4) {
        return response(modelToolCall("patch-2", "apply_patch", { input: removePatch(2) }));
      }
      // 5: 读后验证（残留 1）
      if (requests.length === 5) {
        return response(modelVerificationReads(requiredChangedPaths));
      }
      // 6: 复核 → 触发第 2 轮纠正
      if (requests.length === 6) {
        return response(textResponse(successfulSummary));
      }
      // 7: 第 2 轮纠正，清最后 1 处（残留 0）
      if (requests.length === 7) {
        return response(modelToolCall("patch-3", "apply_patch", { input: removePatch(1) }));
      }
      // 8: 读后验证（残留 0）
      if (requests.length === 8) {
        return response(modelVerificationReads(requiredChangedPaths));
      }
      // 9: 最终复核（无工具）→ 有效输出 → 终局
      return response(textResponse(successfulSummary));
    });

    const executedPatches: string[] = [];
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "apply_patch") {
        const input = String(request.arguments?.input ?? "");
        const removed = (input.match(/^-.*WriteStringAndCheck.*$/gm) ?? []).length;
        residualOccurrences = Math.max(0, residualOccurrences - removed);
        executedPatches.push(input);
      }
      return {
        id: request.id,
        name: request.name,
        success: true,
        output: request.name === "file_read"
          ? JSON.stringify({
            path: request.arguments?.path,
            truncated: false,
            content: buildContent(),
          })
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
      conversationId: "residual-correction-cycles",
      text: "Migrate the Go public API: remove every WriteStringAndCheck and migrate the frozen public callers to WriteString.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
          requiredResidualIdentifiers,
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

    expect(executedPatches).toHaveLength(3);
    expect(requests.some((request) => String(
      request.messages?.[0]?.content ?? "",
    ).includes("residual scan"))).toBe(true);
    expect(requests.some((request) => String(
      request.messages?.[0]?.content ?? "",
    ).includes("forbidden identifiers still present"))).toBe(true);
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

function textResponse(content: string) {
  return {
    choices: [{ finish_reason: "stop", message: { content } }],
    usage: { prompt_tokens: 300, completion_tokens: 30 },
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
