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

describe("ToolEnabledAgent TypeScript API migration correction", () => {
  it("does not execute the frozen correction that removes required TraceValue import", async () => {
    const requiredPaths = [
      "jsonrpc/src/common/api.ts",
      "jsonrpc/src/common/connection.ts",
      "protocol/src/common/protocol.ts",
    ];
    const apiLeadingLine = "\tRequestHandler9, StarNotificationHandler, GenericNotificationHandler, NotificationHandler0, NotificationHandler, NotificationHandler1, NotificationHandler2, NotificationHandler3,";
    const apiImport = "\tNotificationHandler4, NotificationHandler5, NotificationHandler6, NotificationHandler7, NotificationHandler8, NotificationHandler9, Trace, TraceValue, TraceFormat,";
    const regressedApiImport = "\tNotificationHandler4, NotificationHandler5, NotificationHandler6, NotificationHandler7, NotificationHandler8, NotificationHandler9, Trace, TraceFormat,";
    const apiExport = "\tNotificationHandler4, NotificationHandler5, NotificationHandler6, NotificationHandler7, NotificationHandler8, NotificationHandler9, Trace, TraceValue, TraceFormat,";
    const initialPatch = [
      "*** Begin Patch",
      "*** Update File: jsonrpc/src/common/connection.ts",
      "@@",
      " export type TraceValue = 'off' | 'messages' | 'compact' | 'verbose';",
      "-",
      "-/**",
      "- * @deprecated Use TraceValue instead",
      "- */",
      "-export const TraceValues = TraceValue;",
      "-export type TraceValues = TraceValue;",
      " ",
      " export namespace Trace {",
      "*** Update File: jsonrpc/src/common/api.ts",
      "@@",
      " \tTraceOptions, SetTraceParams, SetTraceNotification, LogTraceParams, LogTraceNotification, Tracer, ConnectionErrors, ConnectionError, CancellationId,",
      "-\tCancellationReceiverStrategy, IdCancellationReceiverStrategy, RequestCancellationReceiverStrategy, CancellationSenderStrategy, CancellationStrategy, MessageStrategy, TraceValues",
      "+\tCancellationReceiverStrategy, IdCancellationReceiverStrategy, RequestCancellationReceiverStrategy, CancellationSenderStrategy, CancellationStrategy, MessageStrategy",
      " } from './connection';",
      "@@",
      ` ${apiLeadingLine}`,
      "-\tNotificationHandler4, NotificationHandler5, NotificationHandler6, NotificationHandler7, NotificationHandler8, NotificationHandler9, Trace, TraceValue, TraceValues, TraceFormat,",
      `+${apiImport}`,
      "*** Update File: protocol/src/common/protocol.ts",
      "@@",
      "-import { ProgressToken, RequestHandler, TraceValues } from 'vscode-jsonrpc';",
      "+import { ProgressToken, RequestHandler, TraceValue } from 'vscode-jsonrpc';",
      "@@",
      "-\ttrace?: TraceValues;",
      "+\ttrace?: TraceValue;",
      "*** End Patch",
    ].join("\n");
    const regressiveCorrection = [
      "*** Begin Patch",
      "*** Update File: jsonrpc/src/common/api.ts",
      "@@",
      `-${apiLeadingLine}`,
      `-${apiImport}`,
      `+${apiLeadingLine}`,
      `+${regressedApiImport}`,
      "*** End Patch",
    ].join("\n");
    const baselineSources: Record<string, string> = {
      [requiredPaths[0]!]: [
        "import {",
        "\tCancellationStrategy, MessageStrategy, TraceValues",
        "\tNotificationHandler9, Trace, TraceValue, TraceValues, TraceFormat,",
        "} from './connection';",
        "export {",
        apiExport,
        "};",
      ].join("\n"),
      [requiredPaths[1]!]: [
        "export namespace TraceValue {",
        "\texport const Off: 'off' = 'off';",
        "}",
        "export type TraceValue = 'off' | 'messages' | 'compact' | 'verbose';",
        "export const TraceValues = TraceValue;",
        "export type TraceValues = TraceValue;",
      ].join("\n"),
      [requiredPaths[2]!]: [
        "import { ProgressToken, RequestHandler, TraceValues } from 'vscode-jsonrpc';",
        "export interface _InitializeParams {",
        "\ttrace?: TraceValues;",
        "}",
      ].join("\n"),
    };
    const correctedSources: Record<string, string> = {
      [requiredPaths[0]!]: [
        "import {",
        "\tCancellationStrategy, MessageStrategy",
        apiImport,
        "} from './connection';",
        "export {",
        apiExport,
        "};",
      ].join("\n"),
      [requiredPaths[1]!]: [
        "export namespace TraceValue {",
        "\texport const Off: 'off' = 'off';",
        "}",
        "export type TraceValue = 'off' | 'messages' | 'compact' | 'verbose';",
      ].join("\n"),
      [requiredPaths[2]!]: [
        "import { ProgressToken, RequestHandler, TraceValue } from 'vscode-jsonrpc';",
        "export interface _InitializeParams {",
        "\ttrace?: TraceValue;",
        "}",
      ].join("\n"),
    };
    const regressedSources = {
      ...correctedSources,
      [requiredPaths[0]!]: correctedSources[requiredPaths[0]!]!.replace(
        apiImport,
        regressedApiImport,
      ),
    };
    const task = "Apply the frozen public API migration in the TypeScript monorepo, update all affected packages, and preserve the supplied tests. The frozen migration check is test/benchmark-v3/real-ts-api-migration.mjs. Remove the deprecated public TraceValues value/type aliases from jsonrpc, remove both barrel exports, and migrate protocol back to TraceValue. Change exactly jsonrpc/src/common/connection.ts, jsonrpc/src/common/api.ts, and protocol/src/common/protocol.ts. Do not modify tests or dependency metadata, and return exactly one JSON object with a non-empty summary.";
    const successJson = '{"summary":"Removed TraceValues while preserving TraceValue."}';
    const requests: Array<Record<string, any>> = [];
    const executedPatches: string[] = [];
    let currentSources = baselineSources;

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
      if (instruction.includes("Post-mutation objective review phase")) {
        return jsonResponse(modelToolCall("regressive-correction", "apply_patch", {
          input: regressiveCorrection,
        }));
      }
      if (instruction.includes("Post-mutation verification phase")) {
        return jsonResponse(modelVerificationReads(requiredPaths));
      }
      return jsonResponse(modelToolCall("initial-migration", "apply_patch", {
        input: initialPatch,
      }));
    });

    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "file_read") {
        const path = String(request.arguments?.path ?? "");
        const content = currentSources[path];
        return {
          id: request.id,
          name: request.name,
          success: content !== undefined,
          output: JSON.stringify({
            path,
            size: content?.length ?? 0,
            bytesRead: content?.length ?? 0,
            truncated: false,
            content: content ?? "",
          }),
          durationMs: 1,
        };
      }
      const patchInput = String(request.arguments?.input ?? "");
      executedPatches.push(patchInput);
      if (patchInput === initialPatch) {
        currentSources = correctedSources;
      } else if (patchInput === regressiveCorrection) {
        currentSources = regressedSources;
      }
      return {
        id: request.id,
        name: request.name,
        success: true,
        output: "Patch applied successfully",
        metadata: {
          workspaceMutation: {
            schemaVersion: 1,
            changedPaths: patchInput === initialPatch ? requiredPaths : [requiredPaths[0]],
          },
        },
        durationMs: 1,
      };
    });
    const agent = createAgent(execute);

    const items = await collect(agent.run({
      conversationId: "conv-frozen-ts-api-migration-regression",
      text: task,
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths: requiredPaths,
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

    expect(executedPatches).toEqual([initialPatch]);
    expect(currentSources).toBe(correctedSources);
    expect(requests.some((request) => String(request.messages?.[0]?.content ?? "")
      .includes("Post-mutation final objective review phase"))).toBe(true);
    expect(items.at(-2)).toEqual({ type: "final", text: successJson });
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

function modelVerificationReads(paths: readonly string[]) {
  return {
    choices: [{
      finish_reason: "tool_calls",
      message: {
        content: null,
        tool_calls: paths.map((path, index) => ({
          id: `verify-${index}`,
          type: "function",
          function: {
            name: "file_read",
            arguments: JSON.stringify({ path, limit: 1_048_576 }),
          },
        })),
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
