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

describe("ToolEnabledAgent required workspace mutation", () => {
  it("uses one mutation-only call and one tool-free finalization inside the original budgets", async () => {
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return response(modelToolCall("read-1", "file_read", { path: "api.go" }, 19_000, 400));
      }
      if (requests.length === 2) {
        return response(modelToolCall("patch-1", "apply_patch", {
          input: "*** Begin Patch\n*** Update File: api.go\n@@\n-old\n+new\n*** End Patch",
        }, 600, 120));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: '{"summary":"fixed"}' } }],
        usage: { prompt_tokens: 500, completion_tokens: 80 },
      });
    });
    const execute = vi.fn(async (request: { id: string; name: string }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: request.name === "file_read" ? "package api\nold\n" : "Patch applied successfully",
      durationMs: 1,
    }));
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation",
      text: "Fix the exported Go API.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          maxTotalTokens: 24_000,
          toolLoopIterationBudget: 3,
        },
      },
      structuredOutput: {
        schema: { type: "object", required: ["summary"] },
        validateOutput: (text: string) => {
          try {
            const parsed = JSON.parse(text) as { summary?: unknown };
            if (typeof parsed.summary === "string") {
              return { ok: true as const, outputText: text };
            }
          } catch {
            // The validator reports one stable contract error below.
          }
          return { ok: false as const, message: "summary is required" };
        },
      },
    } as any));

    expect(requests).toHaveLength(3);
    expect(requests[1]?.tools?.map((tool: any) => tool.function.name)).toEqual(["apply_patch"]);
    expect(requests[1]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Mutation-only recovery phase"),
      }),
    ]));
    expect(requests[1]?.max_tokens).toBeGreaterThanOrEqual(1_024);
    expect(requests[1]?.max_tokens).toBeLessThanOrEqual(4_096);
    expect(requests[2]).not.toHaveProperty("tools");
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual(["file_read", "apply_patch"]);
    expect(items).toContainEqual(expect.objectContaining({
      type: "usage",
      modelCalls: 3,
      providerReportedModelCalls: 3,
    }));
    expect(items).toContainEqual({ type: "final", text: '{"summary":"fixed"}' });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("recovers until trusted mutation metadata covers every required changed path", async () => {
    const requiredChangedPaths = [
      "jsonrpc/src/common/api.ts",
      "jsonrpc/src/common/connection.ts",
      "protocol/src/common/protocol.ts",
    ];
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return response(modelToolCall("patch-api", "apply_patch", { input: "patch api" }, 500, 80));
      }
      if (requests.length === 2) {
        return response(modelToolCall("patch-rest", "apply_patch", { input: "patch remaining" }, 600, 90));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "fixed" } }],
        usage: { prompt_tokens: 300, completion_tokens: 30 },
      });
    });
    let mutationCall = 0;
    const execute = vi.fn(async (request: { id: string; name: string }) => {
      mutationCall++;
      return {
        id: request.id,
        name: request.name,
        success: true,
        output: "Patch applied successfully",
        metadata: {
          workspaceMutation: {
            schemaVersion: 1,
            changedPaths: mutationCall === 1
              ? [requiredChangedPaths[0]]
              : requiredChangedPaths.slice(1),
          },
        },
        durationMs: 1,
      };
    });
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-required-path-coverage",
      text: "Apply the frozen public API migration.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
          toolLoopIterationBudget: 3,
        },
      },
    }));

    expect(requests).toHaveLength(3);
    expect(requests[1]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Mutation-only recovery phase"),
      }),
    ]));
    const recoveryText = requests[1]?.messages?.find((message: any) => message.role === "user")?.content;
    expect(recoveryText).toContain("jsonrpc/src/common/connection.ts");
    expect(recoveryText).toContain("protocol/src/common/protocol.ts");
    expect(requests[2]).not.toHaveProperty("tools");
    expect(execute).toHaveBeenCalledTimes(2);
    expect(items).toContainEqual({ type: "final", text: "fixed" });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("fails closed when bounded recovery leaves one required changed path uncovered", async () => {
    const requiredChangedPaths = [
      "jsonrpc/src/common/api.ts",
      "jsonrpc/src/common/connection.ts",
      "protocol/src/common/protocol.ts",
    ];
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return response(modelToolCall("patch-api", "apply_patch", { input: "patch api" }, 500, 80));
      }
      const recoveryCall = body.messages?.some((message: any) => (
        message.role === "system" && String(message.content).includes("Mutation-only recovery phase")
      ));
      if (recoveryCall) {
        return response(modelToolCall("patch-connection", "apply_patch", { input: "patch connection" }, 600, 90));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "all files migrated" } }],
        usage: { prompt_tokens: 300, completion_tokens: 30 },
      });
    });
    let mutationCall = 0;
    const execute = vi.fn(async (request: { id: string; name: string }) => {
      mutationCall++;
      return {
        id: request.id,
        name: request.name,
        success: true,
        output: "Patch applied successfully",
        metadata: {
          workspaceMutation: {
            schemaVersion: 1,
            changedPaths: [requiredChangedPaths[mutationCall - 1]],
          },
        },
        durationMs: 1,
      };
    });
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-required-path-partial-recovery",
      text: "Apply the frozen public API migration.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
          toolLoopIterationBudget: 3,
        },
      },
    }));

    expect(requests).toHaveLength(2);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringContaining("protocol/src/common/protocol.ts"),
    }));
    expect(items.at(-1)).toMatchObject({ type: "status", status: "error" });
  });

  it.each([
    { name: "missing metadata", metadata: undefined },
    {
      name: "malformed metadata",
      metadata: {
        workspaceMutation: { schemaVersion: 2, changedPaths: ["src/api.ts"] },
      },
    },
  ])("does not trust $name for required changed-path coverage", async ({ metadata }) => {
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length <= 2) {
        return response(modelToolCall(`patch-${requests.length}`, "apply_patch", {
          input: `patch ${requests.length}`,
        }, 500, 80));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "fixed" } }],
        usage: { prompt_tokens: 300, completion_tokens: 30 },
      });
    });
    let mutationCall = 0;
    const execute = vi.fn(async (request: { id: string; name: string }) => {
      mutationCall++;
      return {
        id: request.id,
        name: request.name,
        success: true,
        output: "Patch applied successfully",
        metadata: mutationCall === 1
          ? metadata
          : { workspaceMutation: { schemaVersion: 1, changedPaths: ["src/api.ts"] } },
        durationMs: 1,
      };
    });
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: `conv-required-path-untrusted-${metadata ? "malformed" : "missing"}`,
      text: "Change src/api.ts.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths: ["src/api.ts"],
          toolLoopIterationBudget: 3,
        },
      },
    }));

    expect(requests).toHaveLength(3);
    expect(requests[1]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Mutation-only recovery phase"),
      }),
    ]));
    expect(execute).toHaveBeenCalledTimes(2);
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("keeps required changed-path coverage after a later mutation omits metadata", async () => {
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                modelToolCall("patch-required", "apply_patch", { input: "patch required" }, 0, 0).choices[0].message.tool_calls[0],
                modelToolCall("patch-extra", "apply_patch", { input: "patch extra" }, 0, 0).choices[0].message.tool_calls[0],
              ],
            },
          }],
          usage: { prompt_tokens: 500, completion_tokens: 100 },
        });
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "fixed" } }],
        usage: { prompt_tokens: 300, completion_tokens: 30 },
      });
    });
    let mutationCall = 0;
    const execute = vi.fn(async (request: { id: string; name: string }) => {
      mutationCall++;
      return {
        id: request.id,
        name: request.name,
        success: true,
        output: "Patch applied successfully",
        metadata: mutationCall === 1
          ? { workspaceMutation: { schemaVersion: 1, changedPaths: ["src/api.ts"] } }
          : undefined,
        durationMs: 1,
      };
    });
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-required-path-monotonic-coverage",
      text: "Change src/api.ts.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths: ["src/api.ts"],
          toolLoopIterationBudget: 3,
        },
      },
    }));

    expect(requests).toHaveLength(2);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(items).toContainEqual({ type: "final", text: "fixed" });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("keeps bounded source navigation available before patch-only headroom recovery", async () => {
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return response({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                modelToolCall("list-1", "list_files", { path: ".", depth: 2 }, 0, 0).choices[0].message.tool_calls[0],
                modelToolCall("list-2", "list_files", { path: ".", recursive: true, depth: 2 }, 0, 0).choices[0].message.tool_calls[0],
              ],
            },
          }],
          usage: { prompt_tokens: 1_700, completion_tokens: 140 },
        });
      }
      if (requests.length === 2) {
        return response({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                modelToolCall("read-test", "file_read", {
                  path: "benchmark_v3_bug_fix_test.go",
                }, 0, 0).choices[0].message.tool_calls[0],
                modelToolCall("read-command-start", "file_read", {
                  path: "command.go",
                  limit: 8_192,
                }, 0, 0).choices[0].message.tool_calls[0],
              ],
            },
          }],
          usage: { prompt_tokens: 3_000, completion_tokens: 120 },
        });
      }
      if (requests.length === 3) {
        return response(modelToolCall("read-anchor", "file_read", {
          path: "command.go",
          anchor: "func (c *Command) Name() string",
        }, 1_500, 80));
      }
      if (requests.length === 4) {
        return response(modelToolCall("patch-1", "apply_patch", { input: "bounded patch" }, 2_000, 100));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: '{"summary":"fixed"}' } }],
        usage: { prompt_tokens: 500, completion_tokens: 40 },
      });
    });
    const largeDirectoryEvidence = JSON.stringify({
      path: ".",
      entries: Array.from({ length: 120 }, (_, index) => ({
        name: `fixture-${index}.go`,
        path: `internal/benchmark/navigation/fixture-${index}.go`,
        type: "file",
        size: 63_218 + index,
      })),
    });
    const execute = vi.fn(async (request: { id: string; name: string; arguments?: Record<string, unknown> }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: request.name === "list_files"
        ? largeDirectoryEvidence
        : request.name === "file_read"
          ? request.arguments?.anchor
            ? JSON.stringify({
              path: "command.go",
              truncated: true,
              anchor: { text: "func (c *Command) Name() string", byteOffset: 46_089 },
              content: "func (c *Command) Name() string {\n\treturn strings.LastIndex(c.Use, \" \" )\n}",
            })
            : request.arguments?.path === "command.go"
              ? JSON.stringify({
                path: "command.go",
                truncated: true,
                range: { offset: 0, endOffset: 8_192 },
                content: "package cobra\n// Command.Name is outside this bounded window.",
              })
              : JSON.stringify({
                path: "benchmark_v3_bug_fix_test.go",
                truncated: false,
                content: "func TestBenchmarkV3CommandNameUsesFirstToken(t *testing.T) {}",
              })
          : "Patch applied successfully",
      durationMs: 1,
    }));
    const agent = createAgent({
      execute,
      maxTotalTokens: 24_000,
      toolLoopIterationBudget: 6,
      readToolNames: ["file_read", "list_files"],
    });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-navigation-before-recovery",
      text: "Fix Command.Name so it returns the first token.",
      automationProfile: "bare",
      meta: { _agentLaunchSpec: { workspaceMutationRequirement: "required" } },
      structuredOutput: {
        schema: { type: "object", required: ["summary"] },
        validateOutput: (text: string) => text === '{"summary":"fixed"}'
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(requests).toHaveLength(5);
    expect(requests[1]?.tools?.map((tool: any) => tool.function.name)).toEqual([
      "file_read",
      "list_files",
      "apply_patch",
    ]);
    expect(requests[2]?.tools?.map((tool: any) => tool.function.name)).toEqual([
      "file_read",
      "list_files",
      "apply_patch",
    ]);
    expect(requests[3]?.tools?.map((tool: any) => tool.function.name)).toEqual(["apply_patch"]);
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "list_files",
      "list_files",
      "file_read",
      "file_read",
      "file_read",
      "apply_patch",
    ]);
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("retains every required source context for a multi-file mutation recovery", async () => {
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return response(modelToolCall("list-1", "list_files", { path: "." }, 1_700, 100));
      }
      if (requests.length === 2) {
        return response({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                modelToolCall("read-test", "file_read", {
                  path: "test/benchmark-v3/real-ts-api-migration.mjs",
                }, 0, 0).choices[0].message.tool_calls[0],
                modelToolCall("read-connection", "file_read", {
                  path: "jsonrpc/src/common/connection.ts",
                }, 0, 0).choices[0].message.tool_calls[0],
                modelToolCall("read-api", "file_read", {
                  path: "jsonrpc/src/common/api.ts",
                }, 0, 0).choices[0].message.tool_calls[0],
                modelToolCall("read-protocol-start", "file_read", {
                  path: "protocol/src/common/protocol.ts",
                }, 0, 0).choices[0].message.tool_calls[0],
              ],
            },
          }],
          usage: { prompt_tokens: 4_000, completion_tokens: 200 },
        });
      }
      if (requests.length === 3) {
        return response({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                modelToolCall("read-protocol-anchor", "file_read", {
                  path: "protocol/src/common/protocol.ts",
                  anchor: "trace?: TraceValues;",
                }, 0, 0).choices[0].message.tool_calls[0],
                modelToolCall("read-connection-anchor", "file_read", {
                  path: "jsonrpc/src/common/connection.ts",
                  anchor: "export const TraceValues = TraceValue;",
                }, 0, 0).choices[0].message.tool_calls[0],
              ],
            },
          }],
          usage: { prompt_tokens: 4_000, completion_tokens: 100 },
        });
      }
      if (requests.length === 4) {
        return response(modelToolCall("patch-1", "apply_patch", { input: "multi-file patch" }, 2_000, 100));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: '{"summary":"migrated"}' } }],
        usage: { prompt_tokens: 500, completion_tokens: 40 },
      });
    });
    const sourceEvidence = {
      "jsonrpc/src/common/connection.ts": JSON.stringify({
        path: "jsonrpc/src/common/connection.ts",
        truncated: false,
        content: `${"import type { Message } from './messages';\n".repeat(12)}export const TraceValues = TraceValue;\n${"const connection = true;\n".repeat(700)}`,
      }),
      "jsonrpc/src/common/api.ts": JSON.stringify({
        path: "jsonrpc/src/common/api.ts",
        truncated: false,
        content: `${"export { Message };\n".repeat(12)}export { TraceValue, TraceValues, TraceFormat };\n${"export { Disposable };\n".repeat(180)}`,
      }),
      "protocol/src/common/protocol.ts": JSON.stringify({
        path: "protocol/src/common/protocol.ts",
        truncated: true,
        range: { offset: 0, endOffset: 102_400 },
        content: `import { ProgressToken, RequestHandler, TraceValues } from 'vscode-jsonrpc';\n${"export interface ProtocolShape {}\n".repeat(3_200)}`,
      }),
    } as const;
    const execute = vi.fn(async (request: { id: string; name: string; arguments?: Record<string, unknown> }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: request.name === "list_files"
        ? JSON.stringify({ path: ".", entries: ["jsonrpc", "protocol", "test"] })
        : request.name === "apply_patch"
          ? "Patch applied successfully"
          : request.arguments?.anchor
            ? request.arguments.path === "protocol/src/common/protocol.ts"
              ? JSON.stringify({
                path: "protocol/src/common/protocol.ts",
                truncated: true,
                anchor: { text: "trace?: TraceValues;", byteOffset: 82_000 },
                content: "export interface InitializeParams {\n\ttrace?: TraceValues;\n}",
              })
              : JSON.stringify({
                path: "jsonrpc/src/common/connection.ts",
                truncated: true,
                anchor: { text: "export const TraceValues = TraceValue;", byteOffset: 24_000 },
                content: "export const TraceValues = TraceValue;",
              })
            : request.arguments?.path === "test/benchmark-v3/real-ts-api-migration.mjs"
              ? JSON.stringify({
                path: "test/benchmark-v3/real-ts-api-migration.mjs",
                truncated: false,
                content: [
                  "jsonrpc/src/common/api.ts",
                  "jsonrpc/src/common/connection.ts",
                  "protocol/src/common/protocol.ts",
                  "Deprecated TraceValues API migration is incomplete.",
                ].join("\n"),
              })
              : sourceEvidence[request.arguments?.path as keyof typeof sourceEvidence],
      durationMs: 1,
    }));
    const agent = createAgent({
      execute,
      maxTotalTokens: 24_000,
      toolLoopIterationBudget: 6,
      mutationToolNames: ["file_edit", "apply_patch", "file_write", "file_delete"],
      readToolNames: ["file_read", "list_files"],
    });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-multi-file-recovery",
      text: "Apply the frozen public API migration and preserve the supplied tests.",
      automationProfile: "bare",
      meta: { _agentLaunchSpec: { workspaceMutationRequirement: "required" } },
      structuredOutput: {
        schema: { type: "object", required: ["summary"] },
        validateOutput: (text: string) => text === '{"summary":"migrated"}'
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(requests[2]?.tools?.map((tool: any) => tool.function.name)).toEqual(["file_read"]);
    expect(requests[2]?.messages).toEqual([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Bounded source-navigation phase"),
      }),
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("protocol/src/common/protocol.ts"),
      }),
    ]);
    expect(requests).toHaveLength(5);
    expect(requests[3]?.tools?.map((tool: any) => tool.function.name)).toEqual([
      "file_edit",
      "apply_patch",
      "file_write",
      "file_delete",
    ]);
    const recoveryEvidence = requests[3]?.messages?.find((message: any) => message.role === "user")?.content;
    expect(recoveryEvidence).toContain("jsonrpc/src/common/api.ts");
    expect(recoveryEvidence).toContain("jsonrpc/src/common/connection.ts");
    expect(recoveryEvidence).toContain("protocol/src/common/protocol.ts");
    expect(recoveryEvidence).toContain("export const TraceValues = TraceValue");
    expect(recoveryEvidence).toContain("export { TraceValue, TraceValues, TraceFormat }");
    expect(recoveryEvidence).toContain("trace?: TraceValues;");
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "list_files",
      "file_read",
      "file_read",
      "file_read",
      "file_read",
      "file_read",
      "file_read",
      "apply_patch",
    ]);
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it.each([
    { name: "reads three required paths", navigationReadCount: 3, completes: true },
    {
      name: "drops one extra non-required file read",
      navigationReadCount: 3,
      extraNavigationPath: "test/benchmark-v3/real-ts-api-migration.mjs",
      completes: true,
    },
    {
      name: "expands an unfocused required read and retains middle edit context",
      navigationReadCount: 3,
      omitProtocolAnchor: true,
      completes: true,
    },
    {
      name: "expands an explicit default limit for an unfocused required read",
      navigationReadCount: 3,
      omitProtocolAnchor: true,
      protocolReadLimit: 102_400,
      completes: true,
    },
    { name: "fails closed when one required path is omitted", navigationReadCount: 2, completes: false },
  ])("$name in one bounded navigation when only a non-target test was read", async ({
    navigationReadCount,
    extraNavigationPath,
    omitProtocolAnchor,
    protocolReadLimit,
    completes,
  }) => {
    const requiredChangedPaths = [
      "jsonrpc/src/common/api.ts",
      "jsonrpc/src/common/connection.ts",
      "protocol/src/common/protocol.ts",
    ];
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                modelToolCall("list-1", "list_files", { path: "." }, 0, 0).choices[0].message.tool_calls[0],
                modelToolCall("read-test", "file_read", {
                  path: "test/benchmark-v3/real-ts-api-migration.mjs",
                }, 0, 0).choices[0].message.tool_calls[0],
              ],
            },
          }],
          usage: { prompt_tokens: 1_000, completion_tokens: 180 },
        });
      }
      if (requests.length === 2) {
        return response({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                ...[
                  modelToolCall("read-api", "file_read", {
                    path: requiredChangedPaths[0],
                  }, 0, 0).choices[0].message.tool_calls[0],
                  modelToolCall("read-connection", "file_read", {
                    path: requiredChangedPaths[1],
                  }, 0, 0).choices[0].message.tool_calls[0],
                  modelToolCall("read-protocol", "file_read", {
                    path: requiredChangedPaths[2],
                    ...(!omitProtocolAnchor ? { anchor: "trace?: TraceValues;" } : {}),
                    ...(protocolReadLimit ? { limit: protocolReadLimit } : {}),
                  }, 0, 0).choices[0].message.tool_calls[0],
                ].slice(0, navigationReadCount),
                ...(extraNavigationPath
                  ? [modelToolCall("read-extra", "file_read", {
                      path: extraNavigationPath,
                    }, 0, 0).choices[0].message.tool_calls[0]]
                  : []),
              ],
            },
          }],
          usage: { prompt_tokens: 1_200, completion_tokens: 100 },
        });
      }
      if (requests.length === 3) {
        return response(modelToolCall("patch-1", "apply_patch", {
          input: "multi-file patch",
        }, 1_200, 100));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: '{"summary":"migrated"}' } }],
        usage: { prompt_tokens: 500, completion_tokens: 40 },
      });
    });
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      const requestPath = String(request.arguments?.path ?? "");
      if (request.name === "list_files") {
        return {
          id: request.id,
          name: request.name,
          success: true,
          output: JSON.stringify({ path: ".", entries: ["jsonrpc", "protocol", "test"] }),
          durationMs: 1,
        };
      }
      if (request.name === "apply_patch") {
        return {
          id: request.id,
          name: request.name,
          success: true,
          output: "Patch applied successfully",
          metadata: {
            workspaceMutation: {
              schemaVersion: 1,
              changedPaths: requiredChangedPaths,
            },
          },
          durationMs: 1,
        };
      }
      const isProtocolAnchor = requestPath === requiredChangedPaths[2]
        && request.arguments?.anchor === "trace?: TraceValues;";
      const isExpandedProtocolRead = requestPath === requiredChangedPaths[2]
        && request.arguments?.limit === 1_048_576;
      return {
        id: request.id,
        name: request.name,
        success: true,
        output: JSON.stringify({
          path: requestPath,
          truncated: requestPath === requiredChangedPaths[2] && !isExpandedProtocolRead,
          ...(isProtocolAnchor ? {
            anchor: { text: "trace?: TraceValues;", byteOffset: 82_000 },
          } : {}),
          content: requestPath.startsWith("test/")
            ? requiredChangedPaths.join("\n")
            : isProtocolAnchor
              ? "export interface InitializeParams {\n\ttrace?: TraceValues;\n}"
              : isExpandedProtocolRead
                ? `import { TraceValues } from "vscode-jsonrpc";\n${"x".repeat(40_000)}\nexport interface InitializeParams {\n\ttrace?: TraceValues;\n}`
              : requestPath === requiredChangedPaths[1]
                ? `source context for ${requestPath}\n${"x".repeat(60_000)}`
                : `source context for ${requestPath}`,
        }),
        durationMs: 1,
      };
    });
    const agent = createAgent({
      execute,
      maxTotalTokens: 24_000,
      toolLoopIterationBudget: 12,
      mutationToolNames: ["apply_patch"],
      readToolNames: ["file_read", "list_files"],
    });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-test-only-evidence",
      text: "Apply the frozen public API migration.",
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
        validateOutput: (text: string) => text === '{"summary":"migrated"}'
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(requests[1]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Bounded source-navigation phase"),
      }),
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining(requiredChangedPaths[0]),
      }),
    ]));
    expect(requests[1]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("at most 3 file_read calls"),
      }),
    ]));
    expect(requests[1]?.messages[0]?.content).toContain("do not omit or duplicate any listed path");
    if (completes) {
      expect(requests).toHaveLength(4);
      expect(requests[2]?.tools?.map((tool: any) => tool.function.name)).toEqual(["apply_patch"]);
      expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
        "list_files",
        "file_read",
        "file_read",
        "file_read",
        "file_read",
        "apply_patch",
      ]);
      if (omitProtocolAnchor) {
        const protocolRead = execute.mock.calls
          .map(([request]) => request)
          .find((request) => request.arguments?.path === requiredChangedPaths[2]);
        expect(protocolRead?.arguments?.limit).toBe(1_048_576);
        expect(requests[2]?.messages[1]?.content).toContain("trace?: TraceValues;");
      }
      expect(items.at(-1)).toEqual({ type: "status", status: "done" });
    } else {
      expect(requests).toHaveLength(2);
      expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
        "list_files",
        "file_read",
      ]);
      expect(items).toContainEqual(expect.objectContaining({
        type: "final",
        text: expect.stringContaining("did not request each missing required source path exactly once"),
      }));
      expect(items.at(-1)).toMatchObject({ type: "status", status: "error" });
    }
  });

  it.each([
    {
      name: "mixed source-read tools",
      toolNames: ["file_read", "text_search"],
    },
    {
      name: "three file reads",
      toolNames: ["file_read", "file_read", "file_read"],
    },
  ])("rejects $name in bounded source navigation", async ({ toolNames }) => {
    const replay = await runRejectedBoundedNavigationReplay(toolNames);

    expect(replay.requests).toHaveLength(3);
    expect(replay.requests[2]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Bounded source-navigation phase"),
      }),
    ]));
    expect(replay.execute).toHaveBeenCalledTimes(5);
    expect(replay.items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringContaining("at most two file_read calls"),
    }));
    expect(replay.items.at(-1)).toMatchObject({ type: "status", status: "error" });
  });

  it("requires a mutation tool and disables DeepSeek thinking before it can exhaust output", async () => {
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return response({
          choices: [{ finish_reason: "stop", message: { content: "I need to change the file." } }],
          usage: { prompt_tokens: 200, completion_tokens: 30 },
        });
      }
      if (requests.length === 2 && (
        body.tool_choice !== "required"
        || (body.thinking as { type?: unknown } | undefined)?.type !== "disabled"
      )) {
        return response({
          choices: [{
            finish_reason: "length",
            message: { content: null, reasoning_content: "R".repeat(4_112) },
          }],
          usage: { prompt_tokens: 300, completion_tokens: Number(body.max_tokens) },
        });
      }
      if (requests.length === 2) {
        return response(modelToolCall("patch-1", "apply_patch", { input: "bounded patch" }, 300, 1_100));
      }
      if ((body.thinking as { type?: unknown } | undefined)?.type !== "disabled") {
        return response({
          choices: [{
            finish_reason: "length",
            message: { content: null, reasoning_content: "R".repeat(Number(body.max_tokens)) },
          }],
          usage: { prompt_tokens: 200, completion_tokens: Number(body.max_tokens) },
        });
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "fixed" } }],
        usage: { prompt_tokens: 200, completion_tokens: 40 },
      });
    });
    const execute = vi.fn(async (request: { id: string; name: string }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: "Patch applied successfully",
      durationMs: 1,
    }));
    const agent = createAgent({
      execute,
      maxTotalTokens: 24_000,
      toolLoopIterationBudget: 3,
      thinking: { type: "enabled" },
      mutationToolNames: ["apply_patch", "file_write"],
    });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-reasoning",
      text: "Change api.go.",
      automationProfile: "bare",
      meta: { _agentLaunchSpec: { workspaceMutationRequirement: "required" } },
    }));

    expect(requests).toHaveLength(3);
    expect(requests[1]?.max_tokens).toBeGreaterThan(1_024);
    expect(requests[0]?.thinking).toEqual({ type: "enabled" });
    expect(requests[0]?.tool_choice).toBe("auto");
    expect(requests[1]?.thinking).toEqual({ type: "disabled" });
    expect(requests[1]?.tool_choice).toBe("required");
    expect(requests[1]?.tools?.map((tool: any) => tool.function.name)).toEqual([
      "apply_patch",
      "file_write",
    ]);
    expect(requests[2]?.thinking).toEqual({ type: "disabled" });
    expect(requests[2]).not.toHaveProperty("tools");
    expect(execute).toHaveBeenCalledOnce();
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("switches before another ordinary read consumes required-mutation recovery headroom", async () => {
    const requests: Array<Record<string, any>> = [];
    let ordinaryCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      const mutationOnly = body.messages?.some((message: any) =>
        message.role === "system" && String(message.content).includes("Mutation-only recovery phase"));
      if (mutationOnly) {
        return response(modelToolCall("patch-1", "apply_patch", { input: "bounded patch" }, 2_000, 1_100));
      }
      if (!body.tools) {
        return response({
          choices: [{ finish_reason: "stop", message: { content: "fixed" } }],
          usage: { prompt_tokens: 500, completion_tokens: 80 },
        });
      }
      ordinaryCalls++;
      if (ordinaryCalls === 1) {
        return response(modelToolCall("read-1", "file_read", { path: "api.go" }, 11_500, 500));
      }
      return response(modelToolCall("read-2", "file_read", { path: "api.go" }, 9_000, 641));
    });
    const execute = vi.fn(async (request: { id: string; name: string }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: request.name === "file_read" ? "X".repeat(16_000) : "Patch applied successfully",
      durationMs: 1,
    }));
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 12 });
    const consumePending = vi.fn(async () => []);
    let peekCount = 0;

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-headroom",
      text: "Change api.go.",
      automationProfile: "bare",
      meta: { _agentLaunchSpec: { workspaceMutationRequirement: "required" } },
      steering: {
        peekPending: () => (++peekCount === 1
          ? []
          : [{ commandId: "steer-pending", prompt: "STEER_MUST_REMAIN_PENDING" }]),
        consumePending,
        sealIfIdle: () => true,
      },
    }));

    expect(ordinaryCalls).toBe(1);
    expect(requests[1]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Mutation-only recovery phase"),
      }),
    ]));
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual(["file_read", "apply_patch"]);
    expect(JSON.stringify(requests[1]?.messages)).not.toContain("STEER_MUST_REMAIN_PENDING");
    expect(consumePending).toHaveBeenCalledTimes(1);
    expect(consumePending).toHaveBeenCalledWith({ modelCallIndex: 1 });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("fails closed when the one mutation-only call does not request a mutation", async () => {
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      return response({
        choices: [{ finish_reason: "stop", message: { content: "No change is necessary." } }],
        usage: { prompt_tokens: 300, completion_tokens: 40 },
      });
    });
    const execute = vi.fn();
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-missing",
      text: "Change api.go.",
      automationProfile: "bare",
      meta: { _agentLaunchSpec: { workspaceMutationRequirement: "required" } },
    }));

    expect(requests).toHaveLength(2);
    expect(requests[1]?.tools?.map((tool: any) => tool.function.name)).toEqual(["apply_patch"]);
    expect(execute).not.toHaveBeenCalled();
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringContaining("required workspace mutation"),
    }));
    expect(items.at(-1)).toMatchObject({ type: "status", status: "error" });
  });

  it("rejects multiple mutation calls without executing either one", async () => {
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response({
          choices: [{ finish_reason: "stop", message: { content: "I need to change the file." } }],
          usage: { prompt_tokens: 200, completion_tokens: 30 },
        });
      }
      return response({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [
              modelToolCall("patch-1", "apply_patch", { input: "patch one" }, 0, 0).choices[0].message.tool_calls[0],
              modelToolCall("patch-2", "apply_patch", { input: "patch two" }, 0, 0).choices[0].message.tool_calls[0],
            ],
          },
        }],
        usage: { prompt_tokens: 300, completion_tokens: 60 },
      });
    });
    const execute = vi.fn();
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-multiple",
      text: "Change api.go.",
      automationProfile: "bare",
      meta: { _agentLaunchSpec: { workspaceMutationRequirement: "required" } },
    }));

    expect(requests).toHaveLength(2);
    expect(execute).not.toHaveBeenCalled();
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringContaining("exactly one allowed workspace mutation tool"),
    }));
    expect(items.at(-1)).toMatchObject({ type: "status", status: "error" });
  });

  it("fails closed immediately when the mutation tool fails", async () => {
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response({
          choices: [{ finish_reason: "stop", message: { content: "I need to change the file." } }],
          usage: { prompt_tokens: 200, completion_tokens: 30 },
        });
      }
      return response(modelToolCall("patch-1", "apply_patch", { input: "invalid patch" }, 300, 60));
    });
    const execute = vi.fn(async (request: { id: string; name: string }) => ({
      id: request.id,
      name: request.name,
      success: false,
      output: "",
      error: "Patch context did not match",
      durationMs: 1,
    }));
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-failed-tool",
      text: "Change api.go.",
      automationProfile: "bare",
      meta: { _agentLaunchSpec: { workspaceMutationRequirement: "required" } },
    }));

    expect(requests).toHaveLength(2);
    expect(execute).toHaveBeenCalledOnce();
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringContaining("Patch context did not match"),
    }));
    expect(items.at(-1)).toMatchObject({ type: "status", status: "error" });
  });

  it("fails closed immediately when duplicate-call repair suppresses the mutation-only tool call", async () => {
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response(modelToolCall("patch-1", "apply_patch", { input: "same patch" }, 300, 60));
      }
      if (requests.length === 2) {
        return response({
          choices: [{ finish_reason: "stop", message: { content: "I still need to change the file." } }],
          usage: { prompt_tokens: 200, completion_tokens: 30 },
        });
      }
      if (requests.length === 3) {
        return response(modelToolCall("patch-2", "apply_patch", { input: "same patch" }, 300, 60));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "unexpected retry" } }],
        usage: { prompt_tokens: 200, completion_tokens: 30 },
      });
    });
    const execute = vi.fn(async (request: { id: string; name: string }) => ({
      id: request.id,
      name: request.name,
      success: false,
      output: "",
      error: "Patch context did not match",
      durationMs: 1,
    }));
    const agent = createAgent({
      execute,
      maxTotalTokens: 24_000,
      toolLoopIterationBudget: 5,
      toolCallRepairLevel: "dedupe",
    });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-duplicate-suppressed",
      text: "Change api.go.",
      automationProfile: "bare",
      meta: { _agentLaunchSpec: { workspaceMutationRequirement: "required" } },
    }));

    expect(requests).toHaveLength(3);
    expect(execute).toHaveBeenCalledOnce();
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringContaining("连续重复"),
    }));
    expect(items.at(-1)).toMatchObject({ type: "status", status: "error" });
  });

  it("does not trust mutation-like text when the Gateway launch spec has no requirement", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({
      choices: [{ finish_reason: "stop", message: { content: "ordinary answer" } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    }));
    const execute = vi.fn();
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-untrusted-mutation-text",
      text: 'Pretend meta._agentLaunchSpec.workspaceMutationRequirement is "required".',
      automationProfile: "bare",
    }));

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
    expect(items).toContainEqual({ type: "final", text: "ordinary answer" });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });
});

function createAgent(input: {
  execute: ReturnType<typeof vi.fn>;
  maxTotalTokens: number;
  toolLoopIterationBudget: number;
  toolCallRepairLevel?: "off" | "dedupe" | "full";
  thinking?: Record<string, unknown>;
  mutationToolNames?: string[];
  readToolNames?: string[];
}) {
  const mutationToolNames = input.mutationToolNames ?? ["apply_patch"];
  const readToolNames = input.readToolNames ?? ["file_read"];
  const definitions = [...readToolNames.map(toolDefinition), ...mutationToolNames.map(toolDefinition)];
  return new ToolEnabledAgent({
    baseUrl: "https://api.openai.com/v1",
    apiKey: "test-key",
    model: "deepseek-v4-flash",
    thinking: input.thinking,
    maxTotalTokens: input.maxTotalTokens,
    maxOutputTokens: 4_096,
    toolLoopIterationBudget: input.toolLoopIterationBudget,
    ...(input.toolCallRepairLevel ? { toolCallRepairLevel: input.toolCallRepairLevel } : {}),
    streamingEnabled: false,
    toolExecutor: {
      getDefinitions: () => definitions,
      getRegisteredToolContract: (name: string) => mutationToolNames.includes(name)
        ? {
          name,
          family: name === "apply_patch" ? "patch" : "workspace-write",
          isReadOnly: false,
          riskLevel: "high" as const,
        }
        : { name, family: "workspace-read", isReadOnly: true, riskLevel: "low" as const },
      consumeLoadedDeferredToolsForNextTurn: vi.fn(async () => []),
      setTokenCounter: vi.fn(),
      clearTokenCounter: vi.fn(),
      releaseConversation: vi.fn(),
      execute: input.execute,
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

async function collect(stream: AsyncIterable<unknown>): Promise<any[]> {
  const items: any[] = [];
  for await (const item of stream) items.push(item);
  return items;
}

async function runRejectedBoundedNavigationReplay(toolNames: string[]) {
  const requests: Array<Record<string, any>> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
    requests.push(body);
    if (requests.length === 1) {
      return response(modelToolCall("list-1", "list_files", { path: "." }, 1_700, 100));
    }
    if (requests.length === 2) {
      return response({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [
              modelToolCall("read-test", "file_read", { path: "test/benchmark.mjs" }, 0, 0).choices[0].message.tool_calls[0],
              modelToolCall("read-connection", "file_read", { path: "src/connection.ts" }, 0, 0).choices[0].message.tool_calls[0],
              modelToolCall("read-api", "file_read", { path: "src/api.ts" }, 0, 0).choices[0].message.tool_calls[0],
              modelToolCall("read-protocol", "file_read", { path: "src/protocol.ts" }, 0, 0).choices[0].message.tool_calls[0],
            ],
          },
        }],
        usage: { prompt_tokens: 4_000, completion_tokens: 200 },
      });
    }
    return response({
      choices: [{
        finish_reason: "tool_calls",
        message: {
          content: null,
          tool_calls: toolNames.map((toolName, index) => modelToolCall(
            `bounded-${index}`,
            toolName,
            toolName === "file_read"
              ? { path: `src/focused-${index}.ts`, anchor: "TraceValues" }
              : { path: "src", query: "TraceValues" },
            0,
            0,
          ).choices[0].message.tool_calls[0]),
        },
      }],
      usage: { prompt_tokens: 4_000, completion_tokens: 100 },
    });
  });
  const execute = vi.fn(async (request: { id: string; name: string; arguments?: Record<string, unknown> }) => ({
    id: request.id,
    name: request.name,
    success: true,
    output: request.name === "list_files"
      ? JSON.stringify({ path: ".", entries: ["src", "test"] })
      : JSON.stringify({
        path: request.arguments?.path,
        truncated: request.arguments?.path === "src/protocol.ts",
        content: request.arguments?.path === "src/protocol.ts"
          ? `import { TraceValues } from './api';\n${"export interface ProtocolShape {}\n".repeat(3_200)}`
          : `export const TraceValues = TraceValue;\n${"export const value = true;\n".repeat(400)}`,
      }),
    durationMs: 1,
  }));
  const agent = createAgent({
    execute,
    maxTotalTokens: 24_000,
    toolLoopIterationBudget: 6,
    readToolNames: ["file_read", "text_search", "list_files"],
  });
  const items = await collect(agent.run({
    conversationId: `conv-reject-bounded-navigation-${toolNames.join("-")}`,
    text: "Apply the frozen public API migration.",
    automationProfile: "bare",
    meta: { _agentLaunchSpec: { workspaceMutationRequirement: "required" } },
    structuredOutput: {
      schema: { type: "object", required: ["summary"] },
      validateOutput: () => ({ ok: false as const, message: "summary is required" }),
    },
  } as any));
  return { execute, items, requests };
}

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
