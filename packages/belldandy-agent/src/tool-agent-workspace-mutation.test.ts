import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./model-request-transport.js", () => ({
  requestModelTransport: (options: { url: string | URL; init: RequestInit }) => (
    fetch(options.url, options.init)
  ),
}));

import { ToolEnabledAgent } from "./tool-agent.js";
import { estimateTokens } from "./tokenizer.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ToolEnabledAgent required workspace mutation", () => {
  it("normalizes unreliable verification anchors to bounded full-file reads", async () => {
    const requiredChangedPaths = ["src/api.ts", "src/protocol.ts"];
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return response(modelToolCall("patch-all", "apply_patch", {
          input: "*** Begin Patch\n*** Update File: src/api.ts\n@@\n-old\n+new\n*** Update File: src/protocol.ts\n@@\n-old\n+new\n*** End Patch",
        }, 500, 100));
      }
      if (requests.length === 2) {
        return response({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                modelToolCall("verify-api", "file_read", {
                  path: requiredChangedPaths[0],
                  anchor: "new api",
                }, 0, 0).choices[0].message.tool_calls[0],
                modelToolCall("verify-protocol", "file_read", {
                  path: requiredChangedPaths[1],
                  anchor: "new protocol",
                }, 0, 0).choices[0].message.tool_calls[0],
              ],
            },
          }],
          usage: { prompt_tokens: 400, completion_tokens: 80 },
        });
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "verified" } }],
        usage: { prompt_tokens: 300, completion_tokens: 30 },
      });
    });
    const execute = vi.fn(async (request: { id: string; name: string; arguments?: Record<string, unknown> }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: request.name === "file_read"
        ? JSON.stringify({
            path: request.arguments?.path,
            truncated: false,
            content: `const value = ${JSON.stringify(request.arguments?.anchor)};`,
          })
        : "Patch applied successfully",
      ...(request.name === "apply_patch" ? {
        metadata: {
          workspaceMutation: { schemaVersion: 1, changedPaths: requiredChangedPaths },
        },
      } : {}),
      durationMs: 1,
    }));
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-read-after-write",
      text: "Migrate the public API in both required files.",
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
    expect(requests[1]?.tools?.map((tool: any) => tool.function.name)).toEqual(["file_read"]);
    expect(requests[1]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Post-mutation verification phase"),
      }),
    ]));
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "apply_patch",
      "file_read",
      "file_read",
    ]);
    expect(execute.mock.calls.slice(1).map(([request]) => request.arguments)).toEqual(
      requiredChangedPaths.map((path) => ({ path, limit: 1_048_576 })),
    );
    expect(items).toContainEqual({ type: "final", text: "verified" });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("continues to a valid final result after complete bounded unanchored reads", async () => {
    const requiredChangedPaths = ["src/api.ts", "src/connection.ts", "src/protocol.ts"];
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response(modelToolCall("patch-all", "apply_patch", { input: "patch all" }, 500, 100));
      }
      if (requests.length === 2) {
        return response(modelUnanchoredVerificationReads(requiredChangedPaths));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: '{"summary":"verified"}' } }],
        usage: { prompt_tokens: 300, completion_tokens: 30 },
      });
    });
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: request.name === "file_read"
        ? JSON.stringify({
            path: request.arguments?.path,
            truncated: false,
            content: "post-mutation content",
          })
        : "Patch applied successfully",
      ...(request.name === "apply_patch" ? {
        metadata: {
          workspaceMutation: { schemaVersion: 1, changedPaths: requiredChangedPaths },
        },
      } : {}),
      durationMs: 1,
    }));
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-unanchored-read-after-write",
      text: "Migrate the public API in all required files.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
          toolLoopIterationBudget: 3,
        },
      },
      structuredOutput: {
        schema: { type: "object", required: ["summary"] },
        validateOutput: (text: string) => text === '{"summary":"verified"}'
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(requests).toHaveLength(3);
    const readRequests = execute.mock.calls
      .map(([request]) => request)
      .filter((request) => request.name === "file_read");
    expect(readRequests.map((request) => request.arguments)).toEqual(requiredChangedPaths.map((path) => ({
      path,
      limit: 1_048_576,
    })));
    expect(items).toContainEqual({ type: "final", text: '{"summary":"verified"}' });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it.each([
    {
      name: "is truncated",
      resultPath: "src/api.ts",
      truncated: true,
    },
    {
      name: "returns a different path",
      resultPath: "src/other.ts",
      truncated: false,
    },
  ])("fails closed when an unanchored read-after-write result $name", async ({ resultPath, truncated }) => {
    const requiredChangedPaths = ["src/api.ts"];
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response(modelToolCall("patch-api", "apply_patch", { input: "patch api" }, 300, 60));
      }
      if (requests.length === 2) {
        return response(modelUnanchoredVerificationReads(requiredChangedPaths));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "must not be reached" } }],
        usage: { prompt_tokens: 200, completion_tokens: 30 },
      });
    });
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: request.name === "file_read"
        ? JSON.stringify({
            path: resultPath,
            truncated,
            content: "untrusted post-mutation content",
          })
        : "Patch applied successfully",
      ...(request.name === "apply_patch" ? {
        metadata: {
          workspaceMutation: { schemaVersion: 1, changedPaths: requiredChangedPaths },
        },
      } : {}),
      durationMs: 1,
    }));
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-truncated-unanchored-read-after-write",
      text: "Migrate src/api.ts.",
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
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringContaining("complete post-mutation file"),
    }));
    expect(items.at(-1)).toMatchObject({ type: "status", status: "error" });
  });

  it("extends the iteration budget once when verification follows the final ordinary turn", async () => {
    const requiredChangedPaths = ["src/api.ts"];
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response(modelToolCall("patch-api", "apply_patch", { input: "patch api" }, 300, 60));
      }
      if (requests.length === 2) {
        return response(modelVerificationReads(requiredChangedPaths));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "verified" } }],
        usage: { prompt_tokens: 200, completion_tokens: 30 },
      });
    });
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: request.name === "file_read"
        ? JSON.stringify({ path: request.arguments?.path, truncated: false, content: "verified" })
        : "Patch applied successfully",
      ...(request.name === "apply_patch" ? {
        metadata: {
          workspaceMutation: { schemaVersion: 1, changedPaths: requiredChangedPaths },
        },
      } : {}),
      durationMs: 1,
    }));
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 1 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-verification-budget-extension",
      text: "Migrate src/api.ts.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
          toolLoopIterationBudget: 1,
        },
      },
    }));

    expect(requests).toHaveLength(3);
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "apply_patch",
      "file_read",
    ]);
    expect(items).toContainEqual({ type: "final", text: "verified" });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("fails closed when a bounded read-after-write tool fails", async () => {
    const requiredChangedPaths = ["src/api.ts"];
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      return response(requests.length === 1
        ? modelToolCall("patch-api", "apply_patch", { input: "patch api" }, 300, 60)
        : modelVerificationReads(requiredChangedPaths));
    });
    const execute = vi.fn(async (request: { id: string; name: string }) => request.name === "file_read"
      ? {
          id: request.id,
          name: request.name,
          success: false,
          output: "",
          error: "anchor was not found",
          durationMs: 1,
        }
      : {
          id: request.id,
          name: request.name,
          success: true,
          output: "Patch applied successfully",
          metadata: {
            workspaceMutation: { schemaVersion: 1, changedPaths: requiredChangedPaths },
          },
          durationMs: 1,
        });
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 1 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-verification-read-failure",
      text: "Migrate src/api.ts.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
          toolLoopIterationBudget: 1,
        },
      },
    }));

    expect(requests).toHaveLength(2);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringContaining("anchor was not found"),
    }));
    expect(items.at(-1)).toMatchObject({ type: "status", status: "error" });
  });

  it("re-verifies one post-verification correction before tool-free finalization", async () => {
    const requiredChangedPaths = ["src/api.ts"];
    const requests: Array<Record<string, any>> = [];
    let mutationCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response(modelToolCall("patch-api", "apply_patch", { input: "initial patch" }, 300, 60));
      }
      if (requests.length === 2 || requests.length === 4) {
        return response(modelVerificationReads(requiredChangedPaths));
      }
      if (requests.length === 3) {
        return response(modelToolCall("correct-api", "apply_patch", {
          input: "*** Begin Patch\n*** Update File: src/api.ts\n@@\n-needs correction\n+corrected\n*** End Patch",
        }, 300, 60));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "corrected and verified" } }],
        usage: { prompt_tokens: 200, completion_tokens: 30 },
      });
    });
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "apply_patch") {
        mutationCount++;
      }
      return {
        id: request.id,
        name: request.name,
        success: true,
        output: request.name === "file_read"
          ? JSON.stringify({
              path: request.arguments?.path,
              truncated: false,
              content: mutationCount > 1 ? "corrected" : "needs correction",
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
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 1 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-verification-correction",
      text: "Migrate src/api.ts.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
          toolLoopIterationBudget: 1,
        },
      },
    }));

    expect(requests).toHaveLength(5);
    expect(requests[4]).not.toHaveProperty("tools");
    expect(requests.filter((request) => request.messages?.some((message: any) => (
      message.role === "system" && String(message.content).includes("Post-mutation verification phase")
    )))).toHaveLength(2);
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "apply_patch",
      "file_read",
      "apply_patch",
      "file_read",
    ]);
    expect(items).toContainEqual({ type: "final", text: "corrected and verified" });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("reviews post-write evidence and verifies one correction before completion", async () => {
    const requiredChangedPaths = ["src/api.ts"];
    const requests: Array<Record<string, any>> = [];
    let mutationCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return response(modelToolCall("patch-api", "apply_patch", { input: "initial patch" }, 300, 60));
      }
      if (requests.length === 2 || requests.length === 4) {
        return response(modelVerificationReads(requiredChangedPaths));
      }
      const postWriteReview = body.messages?.some((message: any) => (
        message.role === "system"
        && String(message.content).includes("Post-mutation objective review phase")
      ));
      if (requests.length === 3 && postWriteReview) {
        return response(modelToolCall("correct-api", "apply_patch", {
          input: "*** Begin Patch\n*** Update File: src/api.ts\n@@\n-export const DeprecatedName = true;\n+export const CurrentName = true;\n*** End Patch",
        }, 300, 60));
      }
      return response({
        choices: [{
          finish_reason: "stop",
          message: { content: mutationCount > 1 ? "corrected and verified" : "claimed complete" },
        }],
        usage: { prompt_tokens: 200, completion_tokens: 30 },
      });
    });
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "apply_patch") {
        mutationCount++;
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
          content: mutationCount > 1
            ? "export const CurrentName = true;"
            : "export const DeprecatedName = true;",
        }),
        durationMs: 1,
      };
    });
    const agent = createAgent({
      execute,
      maxTotalTokens: 24_000,
      toolLoopIterationBudget: 1,
      mutationToolNames: ["file_write", "apply_patch"],
    });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-post-write-objective-review",
      text: "Remove DeprecatedName from src/api.ts.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
          toolLoopIterationBudget: 1,
        },
      },
    }));

    expect(requests).toHaveLength(5);
    expect(requests[2]?.messages[0]?.content).toContain("Post-mutation objective review phase");
    expect(requests[2]?.messages[1]?.content).toContain("DeprecatedName");
    expect(requests[2]?.tools?.map((tool: any) => tool.function.name)).toEqual(["apply_patch"]);
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "apply_patch",
      "file_read",
      "apply_patch",
      "file_read",
    ]);
    expect(items).toContainEqual({ type: "final", text: "corrected and verified" });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("disables DeepSeek thinking so objective review can issue its bounded correction", async () => {
    const requiredChangedPaths = ["src/diff/props.js"];
    const requests: Array<Record<string, any>> = [];
    let mutationCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return response(modelToolCall("patch-props", "apply_patch", {
          input: "initial broad patch",
        }, 300, 60));
      }
      if (requests.length === 2 || requests.length === 4) {
        return response(modelVerificationReads(requiredChangedPaths));
      }
      const postWriteReview = body.messages?.some((message: any) => (
        message.role === "system"
        && String(message.content).includes("Post-mutation objective review phase")
      ));
      if (requests.length === 3 && postWriteReview) {
        if ((body.thinking as { type?: unknown } | undefined)?.type !== "disabled") {
          return response({
            choices: [{
              finish_reason: "length",
              message: { content: null, reasoning_content: "R".repeat(3_533) },
            }],
            usage: { prompt_tokens: 1_838, completion_tokens: Number(body.max_tokens) },
          });
        }
        return response(modelToolCall("correct-props", "apply_patch", {
          input: [
            "*** Begin Patch",
            "*** Update File: src/diff/props.js",
            "@@",
            "-value != NULL && value !== false",
            "+value != NULL && (value !== false || name[4] == '-')",
            "*** End Patch",
          ].join("\n"),
        }, 1_838, 120));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "corrected and verified" } }],
        usage: { prompt_tokens: 500, completion_tokens: 40 },
      });
    });
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "apply_patch") {
        mutationCount++;
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
          content: mutationCount > 1
            ? "value != NULL && (value !== false || name[4] == '-')"
            : "value != NULL && value !== false",
        }),
        durationMs: 1,
      };
    });
    const agent = createAgent({
      execute,
      maxTotalTokens: 24_000,
      toolLoopIterationBudget: 1,
      thinking: { type: "enabled" },
      mutationToolNames: ["apply_patch"],
      readToolNames: ["file_read"],
    });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-objective-review-thinking",
      text: "Restore false aria attribute serialization without changing null handling.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
          toolLoopIterationBudget: 1,
        },
      },
    }));

    expect(requests[2]?.messages[0]?.content).toContain("Post-mutation objective review phase");
    expect(requests[2]?.tools?.map((tool: any) => tool.function.name)).toEqual(["apply_patch"]);
    expect(requests[2]?.thinking).toEqual({ type: "disabled" });
    expect(requests).toHaveLength(5);
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "apply_patch",
      "file_read",
      "apply_patch",
      "file_read",
    ]);
    expect(items).toContainEqual({ type: "final", text: "corrected and verified" });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("retains the three-file canary residual in the bounded post-write review", async () => {
    const requiredChangedPaths = [
      "jsonrpc/src/common/api.ts",
      "jsonrpc/src/common/connection.ts",
      "protocol/src/common/protocol.ts",
    ];
    const apiResidual = "import { TraceValue, TraceValues, TraceFormat } from './connection';";
    const postWriteContent = new Map<string, string>([
      [
        requiredChangedPaths[0]!,
        [
          apiResidual,
          ...Array.from({ length: 220 }, (_, index) => `export const apiFiller${index} = true;`),
          "export { TraceValue, TraceFormat };",
        ].join("\n"),
      ],
      [
        requiredChangedPaths[1]!,
        [
          "export enum TraceValue {",
          "\tOff = 'off',",
          "\tMessages = 'messages',",
          "\tVerbose = 'verbose'",
          "}",
        ].join("\n"),
      ],
      [
        requiredChangedPaths[2]!,
        [
          "import { TraceValue } from 'vscode-jsonrpc';",
          ...Array.from({ length: 3_200 }, (_, index) => `export interface ProtocolFiller${index} { value: string; }`),
          "export interface InitializeParams {",
          "\ttrace?: TraceValue;",
          "}",
        ].join("\n"),
      ],
    ]);
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response(modelToolCall("patch-all", "apply_patch", { input: "initial patch" }, 500, 100));
      }
      if (requests.length === 2) {
        return response(modelVerificationReads(requiredChangedPaths));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "residual detected" } }],
        usage: { prompt_tokens: 700, completion_tokens: 30 },
      });
    });
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: request.name === "file_read"
        ? JSON.stringify({
            path: request.arguments?.path,
            truncated: false,
            content: postWriteContent.get(String(request.arguments?.path)) ?? "",
          })
        : "Patch applied successfully",
      ...(request.name === "apply_patch" ? {
        metadata: {
          workspaceMutation: { schemaVersion: 1, changedPaths: requiredChangedPaths },
        },
      } : {}),
      durationMs: 1,
    }));
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 1 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-three-file-objective-review",
      text: [
        "Remove TraceValues from both jsonrpc/src/common/api.ts imports and exports.",
        "Remove the TraceValues alias from jsonrpc/src/common/connection.ts without changing enum indentation.",
        "Migrate protocol/src/common/protocol.ts from TraceValues to TraceValue.",
      ].join(" "),
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
          toolLoopIterationBudget: 1,
        },
      },
    }));

    expect(requests).toHaveLength(3);
    const reviewRequest = requests[2]!;
    const reviewText = String(reviewRequest.messages?.[1]?.content ?? "");
    const estimatedInputTokens = (reviewRequest.tools ?? []).reduce(
      (total: number, tool: any) => total + estimateTokens(
        `${tool.function.name}${tool.function.description}${JSON.stringify(tool.function.parameters)}`,
        { model: "deepseek-v4-flash" },
      ),
      0,
    ) + (reviewRequest.messages ?? []).reduce(
      (total: number, message: any) => total + estimateTokens(
        String(message.content ?? ""),
        { model: "deepseek-v4-flash" },
      ) + 4,
      0,
    );
    expect(estimatedInputTokens).toBeLessThanOrEqual(2_048);
    expect(reviewText).toContain(apiResidual);
    for (const requiredPath of requiredChangedPaths) {
      expect(reviewText).toContain(requiredPath);
    }
    expect(reviewRequest.tools?.map((tool: any) => tool.function.name)).toEqual(["apply_patch"]);
    expect(items).toContainEqual({ type: "final", text: "residual detected" });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("rejects a post-write input correction outside required paths before execution", async () => {
    const requiredChangedPaths = ["src/api.ts"];
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response(modelToolCall("patch-api", "apply_patch", { input: "initial patch" }, 300, 60));
      }
      if (requests.length === 2) {
        return response(modelVerificationReads(requiredChangedPaths));
      }
      return response(modelToolCall("correct-extra", "apply_patch", {
        input: [
          "*** Begin Patch",
          "*** Update File: src/extra.ts",
          "@@",
          "-old",
          "+new",
          "*** End Patch",
        ].join("\n"),
      }, 300, 60));
    });
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: request.name === "file_read"
        ? JSON.stringify({
            path: request.arguments?.path,
            truncated: false,
            content: "export const DeprecatedName = true;",
          })
        : "Patch applied successfully",
      ...(request.name === "apply_patch" ? {
        metadata: {
          workspaceMutation: {
            schemaVersion: 1,
            changedPaths: request.id === "correct-extra" ? ["src/extra.ts"] : requiredChangedPaths,
          },
        },
      } : {}),
      durationMs: 1,
    }));
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 1 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-post-write-outside-path",
      text: "Remove DeprecatedName from src/api.ts.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
          toolLoopIterationBudget: 1,
        },
      },
    }));

    expect(requests).toHaveLength(4);
    expect(requests[3]?.messages[0]?.content).toContain(
      "Post-mutation objective correction input retry phase",
    );
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "apply_patch",
      "file_read",
    ]);
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringContaining("unlisted path"),
    }));
    expect(items.at(-1)).toMatchObject({ type: "status", status: "error" });
  });

  it("fails closed when the one post-write correction tool fails", async () => {
    const requiredChangedPaths = ["src/api.ts"];
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response(modelToolCall("patch-api", "apply_patch", { input: "initial patch" }, 300, 60));
      }
      if (requests.length === 2) {
        return response(modelVerificationReads(requiredChangedPaths));
      }
      return response(modelToolCall("correct-api", "apply_patch", {
        input: "*** Begin Patch\n*** Update File: src/api.ts\n@@\n-old\n+new\n*** End Patch",
      }, 300, 60));
    });
    let mutationCount = 0;
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
            path: request.arguments?.path,
            truncated: false,
            content: "old",
          }),
          durationMs: 1,
        };
      }
      mutationCount++;
      return mutationCount === 1
        ? {
            id: request.id,
            name: request.name,
            success: true,
            output: "Patch applied successfully",
            metadata: {
              workspaceMutation: { schemaVersion: 1, changedPaths: requiredChangedPaths },
            },
            durationMs: 1,
          }
        : {
            id: request.id,
            name: request.name,
            success: false,
            output: "",
            error: "permission denied",
            durationMs: 1,
          };
    });
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 1 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-post-write-correction-failure",
      text: "Replace old with new in src/api.ts.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
          toolLoopIterationBudget: 1,
        },
      },
    }));

    expect(requests).toHaveLength(3);
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "apply_patch",
      "file_read",
      "apply_patch",
    ]);
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringContaining("permission denied"),
    }));
    expect(items.at(-1)).toMatchObject({ type: "status", status: "error" });
  });

  it("retries one atomic post-write correction input error before re-verifying", async () => {
    const requiredChangedPaths = ["src/api.ts"];
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return response(modelToolCall("patch-api", "apply_patch", { input: "initial patch" }, 300, 60));
      }
      if (requests.length === 2 || requests.length === 5) {
        return response(modelVerificationReads(requiredChangedPaths));
      }
      if (requests.length === 3) {
        return response(modelToolCall("empty-correction", "apply_patch", {
          input: "*** Begin Patch\n*** Update File: src/api.ts\n*** End Patch",
        }, 300, 60));
      }
      if (requests.length === 4) {
        return response(modelToolCall("correct-api", "apply_patch", {
          input: "*** Begin Patch\n*** Update File: src/api.ts\n@@\n-old\n+new\n*** End Patch",
        }, 300, 60));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "corrected and verified" } }],
        usage: { prompt_tokens: 500, completion_tokens: 40 },
      });
    });
    let mutationCount = 0;
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
            path: request.arguments?.path,
            truncated: false,
            content: mutationCount >= 3 ? "new" : "old",
          }),
          durationMs: 1,
        };
      }
      mutationCount++;
      if (mutationCount === 2) {
        return {
          id: request.id,
          name: request.name,
          success: false,
          output: "",
          error: "Invalid patch hunk at line 2: Update file hunk is empty",
          failureKind: "input_error" as const,
          metadata: {
            repairAction: "apply_patch_input_invalid",
          },
          durationMs: 1,
        };
      }
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
    });
    const agent = createAgent({
      execute,
      maxTotalTokens: 24_000,
      toolLoopIterationBudget: 1,
      thinking: { type: "enabled" },
    });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-post-write-input-correction",
      text: "Replace old with new in src/api.ts.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
          toolLoopIterationBudget: 1,
        },
      },
    }));

    expect(requests).toHaveLength(6);
    expect(requests[3]?.messages[0]?.content).toContain(
      "Post-mutation objective correction input retry phase",
    );
    expect(requests[3]?.tools?.map((tool: any) => tool.function.name)).toEqual(["apply_patch"]);
    expect(requests[3]?.tool_choice).toBe("required");
    expect(requests[3]?.thinking).toEqual({ type: "disabled" });
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "apply_patch",
      "file_read",
      "apply_patch",
      "apply_patch",
      "file_read",
    ]);
    expect(items).toContainEqual({ type: "final", text: "corrected and verified" });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("uses only current required-path source in post-write correction prompts", async () => {
    const requiredChangedPaths = ["src/diff/props.js"];
    const task = "Fix the frozen browser-facing regression and restore false aria-* attribute serialization with the smallest change in src/diff/props.js.";
    const currentTarget = [
      "\t\tif (typeof value == 'function') {",
      "\t\t\t// never serialize functions as attribute values",
      "\t\t} else if (value != NULL && value !== false) {",
      "\t\t\tdom.setAttribute(name, value);",
      "\t\t} else {",
      "\t\t\tdom.removeAttribute(name);",
      "\t\t}",
    ].join("\n");
    const preWriteContent = [
      "const STALE_PREWRITE_CONTEXT = true;",
      "const before = true;\n".repeat(240),
      "export const legacy = false;",
    ].join("\n");
    const postWriteContent = [
      "const currentHeader = true;",
      "const before = true;\n".repeat(180),
      currentTarget,
      "const after = true;\n".repeat(180),
      "export const currentTail = true;",
    ].join("\n");
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response(modelToolCall("read-before", "file_read", {
          path: requiredChangedPaths[0],
        }, 300, 60));
      }
      if (requests.length === 2) {
        return response(modelToolCall("patch-initial", "apply_patch", {
          input: "initial patch",
        }, 300, 60));
      }
      if (requests.length === 3 || requests.length === 6) {
        return response(modelVerificationReads(requiredChangedPaths));
      }
      if (requests.length === 4) {
        return response(modelToolCall("stale-correction", "apply_patch", {
          input: "*** Begin Patch\n*** Update File: src/diff/props.js\n@@\n-STALE_FAILED_PATCH_CONTEXT\n+current\n*** End Patch",
        }, 300, 60));
      }
      if (requests.length === 5) {
        return response(modelToolCall("current-correction", "apply_patch", {
          input: "*** Begin Patch\n*** Update File: src/diff/props.js\n@@\n-\t\t} else if (value != NULL && value !== false) {\n+\t\t} else if (value != NULL && (value !== false || name[4] == '-')) {\n*** End Patch",
        }, 300, 60));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "corrected and verified" } }],
        usage: { prompt_tokens: 500, completion_tokens: 40 },
      });
    });
    let mutationAttempt = 0;
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
            path: request.arguments?.path,
            truncated: false,
            content: mutationAttempt === 0 ? preWriteContent : postWriteContent,
          }),
          durationMs: 1,
        };
      }
      mutationAttempt++;
      if (mutationAttempt === 2) {
        return {
          id: request.id,
          name: request.name,
          success: false,
          output: "",
          error: "Failed to find expected lines: STALE_FAILED_PATCH_CONTEXT",
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
          workspaceMutation: { schemaVersion: 1, changedPaths: requiredChangedPaths },
        },
        durationMs: 1,
      };
    });
    const agent = createAgent({
      execute,
      maxTotalTokens: 24_000,
      toolLoopIterationBudget: 12,
      thinking: { type: "enabled" },
    });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-current-objective-context",
      text: task,
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
          toolLoopIterationBudget: 12,
        },
      },
    }));

    expect(requests).toHaveLength(7);
    for (const requestIndex of [3, 4]) {
      const prompt = requests[requestIndex]?.messages?.[1]?.content ?? "";
      expect(prompt).toContain("value != NULL && value !== false");
      expect(prompt).not.toContain("STALE_PREWRITE_CONTEXT");
      expect(prompt).not.toContain("STALE_FAILED_PATCH_CONTEXT");
    }
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "file_read",
      "apply_patch",
      "file_read",
      "apply_patch",
      "apply_patch",
      "file_read",
    ]);
    expect(items).toContainEqual({ type: "final", text: "corrected and verified" });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("retries a post-write correction that only re-adds an existing line with comments", async () => {
    const requiredChangedPaths = ["src/diff/props.js"];
    const currentSource = [
      "\t\t// aria- and data- attributes have no boolean representation.",
      "\t\t// A `false` value is different from the attribute not being present.",
      "\t\tif (typeof value == 'function') {",
      "\t\t\t// never serialize functions as attribute values",
      "\t\t} else if (value != NULL) {",
      "\t\t\tdom.setAttribute(name, value);",
      "\t\t} else {",
      "\t\t\tdom.removeAttribute(name);",
      "\t\t}",
    ].join("\n");
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return response(modelToolCall("patch-broad", "apply_patch", {
          input: "initial broad patch",
        }, 300, 60));
      }
      if (requests.length === 2 || requests.length === 5) {
        return response(modelVerificationReads(requiredChangedPaths));
      }
      if (requests.length === 3) {
        return response(modelToolCall("comment-only-correction", "apply_patch", {
          input: [
            "*** Begin Patch",
            "*** Update File: src/diff/props.js",
            "@@",
            "+\t\t// aria- and data- attributes have no boolean representation.",
            "+\t\t// A `false` value is different from the attribute not being present.",
            "-\t\tif (typeof value == 'function') {",
            "+\t\tif (typeof value == 'function') {",
            "*** End Patch",
          ].join("\n"),
        }, 300, 60));
      }
      if (requests.length === 4) {
        return response(modelToolCall("semantic-correction", "apply_patch", {
          input: [
            "*** Begin Patch",
            "*** Update File: src/diff/props.js",
            "@@",
            "-\t\t} else if (value != NULL) {",
            "+\t\t} else if (value != NULL && (value !== false || name[4] == '-')) {",
            "*** End Patch",
          ].join("\n"),
        }, 300, 60));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "corrected and verified" } }],
        usage: { prompt_tokens: 500, completion_tokens: 40 },
      });
    });
    let mutationCount = 0;
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
            path: request.arguments?.path,
            truncated: false,
            content: currentSource,
          }),
          durationMs: 1,
        };
      }
      mutationCount++;
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
    });
    const agent = createAgent({
      execute,
      maxTotalTokens: 24_000,
      toolLoopIterationBudget: 12,
      thinking: { type: "enabled" },
    });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-semantic-correction-input-retry",
      text: "Restore false aria-* serialization without changing data-* or other false attribute behavior.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
          toolLoopIterationBudget: 12,
        },
      },
    }));

    expect(requests).toHaveLength(6);
    expect(requests[2]?.messages[0]?.content).toContain(
      "A correction must change task-relevant behavior",
    );
    expect(requests[2]?.messages[0]?.content).toContain(
      "Make the smallest patch relative to the current source",
    );
    expect(requests[2]?.messages[0]?.content).toContain(
      "Preserve every already-correct adjacent expression and branch byte-for-byte as patch context",
    );
    expect(requests[3]?.messages[0]?.content).toContain(
      "Post-mutation objective correction input retry phase",
    );
    expect(requests[3]?.messages[0]?.content).toContain(
      "Do not refactor, expand, normalize, modernize, or make an equivalent rewrite",
    );
    expect(requests[3]?.messages[0]?.content).toContain(
      "do not remove and re-add an unchanged source line",
    );
    expect(requests[3]?.messages[1]?.content).toContain("value != NULL");
    expect(requests[3]?.tool_choice).toBe("required");
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "apply_patch",
      "file_read",
      "apply_patch",
      "file_read",
    ]);
    expect(mutationCount).toBe(2);
    expect(items).toContainEqual({ type: "final", text: "corrected and verified" });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("fails closed when the objective input retry also only repeats current source", async () => {
    const requiredChangedPaths = ["src/diff/props.js"];
    const currentSource = [
      "\t\t// aria- and data- attributes have no boolean representation.",
      "\t\t// A `false` value is different from the attribute not being present.",
      "\t\tif (typeof value == 'function') {",
      "\t\t} else if (value != NULL) {",
    ].join("\n");
    const redundantCorrection = [
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "+\t\t// aria- and data- attributes have no boolean representation.",
      "+\t\t// A `false` value is different from the attribute not being present.",
      "-\t\tif (typeof value == 'function') {",
      "+\t\tif (typeof value == 'function') {",
      "*** End Patch",
    ].join("\n");
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return response(modelToolCall("patch-broad", "apply_patch", {
          input: "initial broad patch",
        }, 300, 60));
      }
      if (requests.length === 2) {
        return response(modelVerificationReads(requiredChangedPaths));
      }
      return response(modelToolCall(`redundant-${requests.length}`, "apply_patch", {
        input: redundantCorrection,
      }, 300, 60));
    });
    let mutationCount = 0;
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
            path: request.arguments?.path,
            truncated: false,
            content: currentSource,
          }),
          durationMs: 1,
        };
      }
      mutationCount++;
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
    });
    const agent = createAgent({
      execute,
      maxTotalTokens: 24_000,
      toolLoopIterationBudget: 12,
      thinking: { type: "enabled" },
    });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-redundant-input-correction-failed",
      text: "Restore false aria-* serialization without changing other false attribute behavior.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
          toolLoopIterationBudget: 12,
        },
      },
    }));

    expect(requests).toHaveLength(4);
    expect(requests[3]?.messages[0]?.content).toContain(
      "Post-mutation objective correction input retry phase",
    );
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "apply_patch",
      "file_read",
    ]);
    expect(mutationCount).toBe(1);
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringContaining("only repeated a current-source block"),
    }));
    expect(items.at(-1)).toMatchObject({ type: "status", status: "error" });
  });

  it("fails closed when the post-write objective input correction also fails", async () => {
    const requiredChangedPaths = ["src/api.ts"];
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return response(modelToolCall("patch-api", "apply_patch", { input: "initial patch" }, 300, 60));
      }
      if (requests.length === 2) {
        return response(modelVerificationReads(requiredChangedPaths));
      }
      if (requests.length === 3) {
        return response(modelToolCall("empty-correction", "apply_patch", {
          input: "*** Begin Patch\n*** Update File: src/api.ts\n*** End Patch",
        }, 300, 60));
      }
      return response(modelToolCall("invalid-input-correction", "apply_patch", {
        input: "*** Begin Patch\n*** Update File: src/api.ts\n@@\n-stale\n+new\n*** End Patch",
      }, 300, 60));
    });
    let mutationCount = 0;
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
            path: request.arguments?.path,
            truncated: false,
            content: "old",
          }),
          durationMs: 1,
        };
      }
      mutationCount++;
      if (mutationCount > 1) {
        return {
          id: request.id,
          name: request.name,
          success: false,
          output: "",
          error: mutationCount === 2
            ? "Invalid patch hunk at line 2: Update file hunk is empty"
            : "Corrected patch context still did not match",
          failureKind: "input_error" as const,
          metadata: {
            repairAction: "apply_patch_input_invalid",
          },
          durationMs: 1,
        };
      }
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
    });
    const agent = createAgent({
      execute,
      maxTotalTokens: 24_000,
      toolLoopIterationBudget: 1,
      thinking: { type: "enabled" },
    });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-post-write-input-correction-failed",
      text: "Replace old with new in src/api.ts.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
          toolLoopIterationBudget: 1,
        },
      },
    }));

    expect(requests).toHaveLength(4);
    expect(requests[3]?.messages[0]?.content).toContain(
      "Post-mutation objective correction input retry phase",
    );
    expect(requests[3]?.tool_choice).toBe("required");
    expect(requests[3]?.thinking).toEqual({ type: "disabled" });
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "apply_patch",
      "file_read",
      "apply_patch",
      "apply_patch",
    ]);
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringContaining("Corrected patch context still did not match"),
    }));
    expect(items.at(-1)).toMatchObject({ type: "status", status: "error" });
  });

  it("retries one post-write correction rejected by the local required-path guard", async () => {
    const requiredChangedPaths = ["src/api.ts"];
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return response(modelToolCall("patch-api", "apply_patch", { input: "initial patch" }, 300, 60));
      }
      if (requests.length === 2 || requests.length === 5) {
        return response(modelVerificationReads(requiredChangedPaths));
      }
      if (requests.length === 3) {
        return response(modelToolCall("wrong-path-correction", "apply_patch", {
          input: "*** Begin Patch\n*** Update File: src/other.ts\n@@\n-old\n+new\n*** End Patch",
        }, 300, 60));
      }
      if (requests.length === 4) {
        return response(modelToolCall("correct-api", "apply_patch", {
          input: "*** Begin Patch\n*** Update File: src/api.ts\n@@\n-old\n+new\n*** End Patch",
        }, 300, 60));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "corrected and verified" } }],
        usage: { prompt_tokens: 500, completion_tokens: 40 },
      });
    });
    let mutationCount = 0;
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "apply_patch") mutationCount++;
      return {
        id: request.id,
        name: request.name,
        success: true,
        output: request.name === "file_read"
          ? JSON.stringify({
              path: request.arguments?.path,
              truncated: false,
              content: mutationCount > 1 ? "new" : "old",
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
    const agent = createAgent({
      execute,
      maxTotalTokens: 24_000,
      toolLoopIterationBudget: 1,
      thinking: { type: "enabled" },
    });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-post-write-local-path-correction",
      text: "Replace old with new in src/api.ts.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
          toolLoopIterationBudget: 1,
        },
      },
    }));

    expect(requests).toHaveLength(6);
    expect(requests[3]?.messages[0]?.content).toContain(
      "Post-mutation objective correction input retry phase",
    );
    expect(requests[3]?.tool_choice).toBe("required");
    expect(requests[3]?.thinking).toEqual({ type: "disabled" });
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "apply_patch",
      "file_read",
      "apply_patch",
      "file_read",
    ]);
    expect(execute.mock.calls[2]?.[0].arguments).toEqual({
      input: "*** Begin Patch\n*** Update File: src/api.ts\n@@\n-old\n+new\n*** End Patch",
    });
    expect(items).toContainEqual({ type: "final", text: "corrected and verified" });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("fails closed when the objective input correction has no valid required-path section", async () => {
    const requiredChangedPaths = ["src/api.ts"];
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response(modelToolCall("patch-api", "apply_patch", { input: "initial patch" }, 300, 60));
      }
      if (requests.length === 2) {
        return response(modelVerificationReads(requiredChangedPaths));
      }
      return response(modelToolCall(`wrong-path-${requests.length}`, "apply_patch", {
        input: "*** Begin Patch\n*** End Patch",
      }, 300, 60));
    });
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: request.name === "file_read"
        ? JSON.stringify({ path: request.arguments?.path, truncated: false, content: "old" })
        : "Patch applied successfully",
      ...(request.name === "apply_patch" ? {
        metadata: {
          workspaceMutation: { schemaVersion: 1, changedPaths: requiredChangedPaths },
        },
      } : {}),
      durationMs: 1,
    }));
    const agent = createAgent({
      execute,
      maxTotalTokens: 24_000,
      toolLoopIterationBudget: 1,
      thinking: { type: "enabled" },
    });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-post-write-local-path-correction-failed",
      text: "Replace old with new in src/api.ts.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
          toolLoopIterationBudget: 1,
        },
      },
    }));

    expect(requests).toHaveLength(4);
    expect(requests[3]?.messages[0]?.content).toContain(
      "Post-mutation objective correction input retry phase",
    );
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "apply_patch",
      "file_read",
    ]);
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringContaining(
        "post-write objective correction patch targeted an unlisted path",
      ),
    }));
    expect(items.at(-1)).toMatchObject({ type: "status", status: "error" });
  });

  it("rejects another tool call after the post-write correction is exhausted", async () => {
    const requiredChangedPaths = ["src/api.ts"];
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return response(modelToolCall("patch-api", "apply_patch", { input: "initial patch" }, 300, 60));
      }
      if (requests.length === 2 || requests.length === 4) {
        return response(modelVerificationReads(requiredChangedPaths));
      }
      const correctionPatch = "*** Begin Patch\n*** Update File: src/api.ts\n@@\n-old\n+new\n*** End Patch";
      return response(modelToolCall(
        requests.length === 3 ? "correct-api" : "correct-api-again",
        "apply_patch",
        { input: correctionPatch },
        300,
        60,
      ));
    });
    let mutationCount = 0;
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "apply_patch") mutationCount++;
      return {
        id: request.id,
        name: request.name,
        success: true,
        output: request.name === "file_read"
          ? JSON.stringify({
              path: request.arguments?.path,
              truncated: false,
              content: mutationCount > 1 ? "new" : "old",
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
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 1 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-post-write-second-correction",
      text: "Replace old with new in src/api.ts.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
          toolLoopIterationBudget: 1,
        },
      },
    }));

    expect(requests).toHaveLength(5);
    expect(requests[4]).not.toHaveProperty("tools");
    expect(requests[4]?.messages[0]?.content).toContain("Post-mutation final objective review phase");
    expect(requests[4]?.messages[1]?.content).toContain(
      "Trusted required paths after post-write correction",
    );
    expect(requests[4]?.messages[1]?.content).not.toContain("eligible for one post-write correction");
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "apply_patch",
      "file_read",
      "apply_patch",
      "file_read",
    ]);
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringContaining("post-write objective review"),
    }));
    expect(items.at(-1)).toMatchObject({ type: "status", status: "error" });
  });

  it("normalizes a colonless mutation-only Update File header before tool execution", async () => {
    const colonlessPatch = "*** Begin Patch\n*** Update File api.go\n@@\n-old\n+new\n*** End Patch";
    const normalizedPatch = "*** Begin Patch\n*** Update File: api.go\n@@\n-old\n+new\n*** End Patch";
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return response(modelToolCall("read-1", "file_read", { path: "api.go" }, 19_000, 400));
      }
      if (requests.length === 2) {
        return response(modelToolCall("patch-1", "apply_patch", {
          input: colonlessPatch,
        }, 600, 120));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: '{"summary":"fixed"}' } }],
        usage: { prompt_tokens: 500, completion_tokens: 80 },
      });
    });
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => ({
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
        content: expect.stringMatching(
          /Mutation-only recovery phase.*Copy context\/removal lines exactly from one taskRelevantContexts item or exact evidence.*Never join items/,
        ),
      }),
    ]));
    expect(requests[1]?.max_tokens).toBeGreaterThanOrEqual(1_024);
    expect(requests[1]?.max_tokens).toBeLessThanOrEqual(4_096);
    expect(requests[2]).not.toHaveProperty("tools");
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual(["file_read", "apply_patch"]);
    expect(execute.mock.calls[1]?.[0].arguments).toEqual({ input: normalizedPatch });
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
      if (requests.length === 3) {
        return response(modelVerificationReads(requiredChangedPaths));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "fixed" } }],
        usage: { prompt_tokens: 300, completion_tokens: 30 },
      });
    });
    let mutationCall = 0;
    const execute = vi.fn(async (request: { id: string; name: string; arguments?: Record<string, unknown> }) => {
      if (request.name === "file_read") {
        return {
          id: request.id,
          name: request.name,
          success: true,
          output: JSON.stringify({ path: request.arguments?.path, truncated: false, content: "verified" }),
          durationMs: 1,
        };
      }
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

    expect(requests).toHaveLength(4);
    expect(requests[1]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Mutation-only recovery phase"),
      }),
    ]));
    const recoveryText = requests[1]?.messages?.find((message: any) => message.role === "user")?.content;
    expect(recoveryText).toContain("jsonrpc/src/common/connection.ts");
    expect(recoveryText).toContain("protocol/src/common/protocol.ts");
    expect(requests[2]?.tools?.map((tool: any) => tool.function.name)).toEqual(["file_read"]);
    expect(requests[3]?.tools?.map((tool: any) => tool.function.name)).toEqual(["apply_patch"]);
    expect(requests[3]?.messages[0]?.content).toContain("Post-mutation objective review phase");
    expect(execute).toHaveBeenCalledTimes(5);
    expect(items).toContainEqual({ type: "final", text: "fixed" });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("uses one bounded continuation when the mutation-only call covers only part of the required paths", async () => {
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
        return response(modelUnanchoredVerificationReads(requiredChangedPaths));
      }
      if (requests.length === 2) {
        return response(modelToolCall("patch-partial", "apply_patch", {
          input: "*** Begin Patch\n*** Update File: jsonrpc/src/common/api.ts\n@@\n-old\n+new\n*** Update File: jsonrpc/src/common/connection.ts\n@@\n-old\n+new\n*** End Patch",
        }, 600, 90));
      }
      if (requests.length === 3) {
        return response(modelToolCall("patch-missing", "apply_patch", {
          input: "*** Begin Patch\n*** Update File protocol/src/common/protocol.ts\n@@\n-old\n+new\n*** End Patch",
        }, 500, 80));
      }
      if (requests.length === 4) {
        return response(modelUnanchoredVerificationReads(requiredChangedPaths));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "fixed" } }],
        usage: { prompt_tokens: 300, completion_tokens: 30 },
      });
    });
    let mutationCall = 0;
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
            path: request.arguments?.path,
            truncated: false,
            content: `source context for ${String(request.arguments?.path)}`,
          }),
          durationMs: 1,
        };
      }
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
              ? requiredChangedPaths.slice(0, 2)
              : requiredChangedPaths.slice(2),
          },
        },
        durationMs: 1,
      };
    });
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-required-path-mutation-only-continuation",
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

    expect(requests).toHaveLength(5);
    expect(requests[1]?.messages[0]?.content).toContain("Mutation-only recovery phase");
    expect(requests[2]?.tools?.map((tool: any) => tool.function.name)).toEqual(["apply_patch"]);
    expect(requests[2]?.messages[0]?.content).toContain("Missing-path mutation continuation phase");
    const continuationText = requests[2]?.messages[1]?.content;
    expect(continuationText).toContain(
      `Trusted required changed paths still missing:\n[\"${requiredChangedPaths[2]}\"]`,
    );
    expect(requests[3]?.tools?.map((tool: any) => tool.function.name)).toEqual(["file_read"]);
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "file_read",
      "file_read",
      "file_read",
      "apply_patch",
      "apply_patch",
      "file_read",
      "file_read",
      "file_read",
    ]);
    expect(execute.mock.calls[4]?.[0].arguments).toEqual({
      input: "*** Begin Patch\n*** Update File: protocol/src/common/protocol.ts\n@@\n-old\n+new\n*** End Patch",
    });
    expect(items).toContainEqual({ type: "final", text: "fixed" });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("coalesces split apply_patch calls from the bounded missing-path continuation", async () => {
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
        return response(modelUnanchoredVerificationReads(requiredChangedPaths));
      }
      if (requests.length === 2) {
        return response(modelToolCall("patch-connection", "apply_patch", {
          input: "*** Begin Patch\n*** Update File: jsonrpc/src/common/connection.ts\n@@\n-old connection\n+new connection\n*** End Patch",
        }, 600, 90));
      }
      if (requests.length === 3) {
        const patchCalls = [
          modelToolCall("patch-api-import", "apply_patch", {
            input: "*** Begin Patch\n*** Update File: jsonrpc/src/common/api.ts\n@@\n-import old\n+import new\n*** End Patch",
          }, 0, 0).choices[0].message.tool_calls[0],
          modelToolCall("patch-api-export", "apply_patch", {
            input: "*** Begin Patch\n*** Update File: jsonrpc/src/common/api.ts\n@@\n-export old\n+export new\n*** End Patch",
          }, 0, 0).choices[0].message.tool_calls[0],
          modelToolCall("patch-protocol", "apply_patch", {
            input: "*** Begin Patch\n*** Update File: protocol/src/common/protocol.ts\n@@\n-old protocol\n+new protocol\n*** End Patch",
          }, 0, 0).choices[0].message.tool_calls[0],
        ];
        return response({
          choices: [{
            finish_reason: "tool_calls",
            message: { content: null, tool_calls: patchCalls },
          }],
          usage: { prompt_tokens: 500, completion_tokens: 80 },
        });
      }
      if (requests.length === 4) {
        return response(modelUnanchoredVerificationReads(requiredChangedPaths));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "fixed" } }],
        usage: { prompt_tokens: 300, completion_tokens: 30 },
      });
    });
    let mutationCall = 0;
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
            path: request.arguments?.path,
            truncated: false,
            content: `source context for ${String(request.arguments?.path)}`,
          }),
          durationMs: 1,
        };
      }
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
              ? [requiredChangedPaths[1]]
              : [requiredChangedPaths[0], requiredChangedPaths[2]],
          },
        },
        durationMs: 1,
      };
    });
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-required-path-split-continuation",
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

    expect(requests).toHaveLength(5);
    expect(requests[2]?.messages[0]?.content).toContain("Missing-path mutation continuation phase");
    expect(requests[2]?.tool_choice).toBe("required");
    expect(execute.mock.calls.filter(([request]) => request.name === "apply_patch")).toHaveLength(2);
    expect(execute.mock.calls[4]?.[0].arguments).toEqual({
      input: [
        "*** Begin Patch",
        "*** Update File: jsonrpc/src/common/api.ts",
        "@@",
        "-import old",
        "+import new",
        "@@",
        "-export old",
        "+export new",
        "*** Update File: protocol/src/common/protocol.ts",
        "@@",
        "-old protocol",
        "+new protocol",
        "*** End Patch",
      ].join("\n"),
    });
    expect(items).toContainEqual({ type: "final", text: "fixed" });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("rejects an empty split continuation section before another mutation", async () => {
    const requiredChangedPaths = ["src/api.ts", "src/protocol.ts"];
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return response(modelUnanchoredVerificationReads(requiredChangedPaths));
      }
      if (requests.length === 2) {
        return response(modelToolCall("patch-api", "apply_patch", {
          input: "*** Begin Patch\n*** Update File: src/api.ts\n@@\n-old api\n+new api\n*** End Patch",
        }, 400, 70));
      }
      if (requests.length === 3) {
        const patchCalls = [
          modelToolCall("empty-protocol", "apply_patch", {
            input: "*** Begin Patch\n*** Update File: src/protocol.ts\n*** End Patch",
          }, 0, 0).choices[0].message.tool_calls[0],
          modelToolCall("patch-protocol", "apply_patch", {
            input: "*** Begin Patch\n*** Update File: src/protocol.ts\n@@\n-old protocol\n+new protocol\n*** End Patch",
          }, 0, 0).choices[0].message.tool_calls[0],
        ];
        return response({
          choices: [{
            finish_reason: "tool_calls",
            message: { content: null, tool_calls: patchCalls },
          }],
          usage: { prompt_tokens: 400, completion_tokens: 70 },
        });
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "unexpected retry" } }],
        usage: { prompt_tokens: 200, completion_tokens: 30 },
      });
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
            path: request.arguments?.path,
            truncated: false,
            content: `source context for ${String(request.arguments?.path)}`,
          }),
          durationMs: 1,
        };
      }
      return {
        id: request.id,
        name: request.name,
        success: true,
        output: "Patch applied successfully",
        metadata: {
          workspaceMutation: {
            schemaVersion: 1,
            changedPaths: String(request.arguments?.input).includes("protocol")
              ? [requiredChangedPaths[1]]
              : [requiredChangedPaths[0]],
          },
        },
        durationMs: 1,
      };
    });
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-required-path-empty-split-continuation",
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
    expect(execute.mock.calls.filter(([request]) => request.name === "apply_patch")).toHaveLength(1);
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringContaining("exactly one allowed workspace mutation tool"),
    }));
    expect(items.at(-1)).toEqual({ type: "status", status: "error" });
  });

  it("uses one bounded correction after an atomic apply_patch input error", async () => {
    const requiredChangedPaths = [
      "jsonrpc/src/common/api.ts",
      "jsonrpc/src/common/connection.ts",
      "protocol/src/common/protocol.ts",
    ];
    const failedPatch = [
      "*** Begin Patch",
      "*** Update File: jsonrpc/src/common/api.ts",
      "@@",
      "-invalid context",
      "+new api",
      "*** Update File: jsonrpc/src/common/connection.ts",
      "@@",
      "-old connection",
      "+new connection",
      "*** End Patch",
    ].join("\n");
    const correctedPatch = [
      "*** Begin Patch",
      "*** Update File: jsonrpc/src/common/api.ts",
      "@@",
      "-old api",
      "+new api",
      "*** Update File: jsonrpc/src/common/connection.ts",
      "@@",
      "-old connection",
      "+new connection",
      "*** Update File: protocol/src/common/protocol.ts",
      "@@",
      "-old protocol",
      "+new protocol",
      "*** End Patch",
    ].join("\n");
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response(modelUnanchoredVerificationReads(requiredChangedPaths));
      }
      if (requests.length === 2) {
        return response(modelToolCall("patch-invalid", "apply_patch", { input: failedPatch }, 600, 90));
      }
      if (requests.length === 3) {
        return response(modelToolCall("patch-corrected", "apply_patch", { input: correctedPatch }, 700, 110));
      }
      if (requests.length === 4) {
        return response(modelUnanchoredVerificationReads(requiredChangedPaths));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "corrected and verified" } }],
        usage: { prompt_tokens: 300, completion_tokens: 30 },
      });
    });
    let mutationCall = 0;
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
            path: request.arguments?.path,
            truncated: false,
            content: `source context for ${String(request.arguments?.path)}`,
          }),
          durationMs: 1,
        };
      }
      mutationCall++;
      if (mutationCall === 1) {
        return {
          id: request.id,
          name: request.name,
          success: false,
          output: "",
          error: "Failed to find expected lines",
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
          workspaceMutation: {
            schemaVersion: 1,
            changedPaths: requiredChangedPaths,
          },
        },
        durationMs: 1,
      };
    });
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-atomic-input-correction",
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

    expect(requests).toHaveLength(5);
    expect(requests[2]?.tools?.map((tool: any) => tool.function.name)).toEqual(["apply_patch"]);
    expect(requests[2]?.messages[0]?.content).toContain("Atomic input correction phase");
    expect(requests[2]?.messages[1]?.content).toContain(
      `Trusted required changed paths still missing:\n${JSON.stringify(requiredChangedPaths)}`,
    );
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "file_read",
      "file_read",
      "file_read",
      "apply_patch",
      "apply_patch",
      "file_read",
      "file_read",
      "file_read",
    ]);
    expect(execute.mock.calls[4]?.[0].arguments).toEqual({ input: correctedPatch });
    expect(items).toContainEqual({ type: "final", text: "corrected and verified" });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("fails closed when the bounded atomic input correction also fails", async () => {
    const requiredChangedPaths = ["src/api.ts"];
    const patch = "*** Begin Patch\n*** Update File: src/api.ts\n@@\n-old\n+new\n*** End Patch";
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response(modelUnanchoredVerificationReads(requiredChangedPaths));
      }
      return response(modelToolCall(`patch-${requests.length}`, "apply_patch", { input: patch }, 500, 80));
    });
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => request.name === "file_read"
      ? {
          id: request.id,
          name: request.name,
          success: true,
          output: JSON.stringify({
            path: request.arguments?.path,
            truncated: false,
            content: "source context",
          }),
          durationMs: 1,
        }
      : {
          id: request.id,
          name: request.name,
          success: false,
          output: "",
          error: "Patch context still did not match",
          failureKind: "input_error" as const,
          metadata: { repairAction: "apply_patch_input_invalid" },
          durationMs: 1,
        });
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-atomic-input-correction-failed",
      text: "Update src/api.ts.",
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
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "file_read",
      "apply_patch",
      "apply_patch",
    ]);
    expect(requests[2]?.messages[0]?.content).toContain("Atomic input correction phase");
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringContaining("Patch context still did not match"),
    }));
    expect(items.at(-1)).toMatchObject({ type: "status", status: "error" });
  });

  it("fails closed without correction for an untrusted generic input error", async () => {
    const requiredChangedPaths = ["src/api.ts"];
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response(modelUnanchoredVerificationReads(requiredChangedPaths));
      }
      return response(modelToolCall(
        `patch-${requests.length}`,
        "apply_patch",
        { input: "*** Begin Patch\n*** Update File: src/api.ts\n@@\n-old\n+new\n*** End Patch" },
        500,
        80,
      ));
    });
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => request.name === "file_read"
      ? {
          id: request.id,
          name: request.name,
          success: true,
          output: JSON.stringify({ path: request.arguments?.path, truncated: false, content: "source context" }),
          durationMs: 1,
        }
      : {
          id: request.id,
          name: request.name,
          success: false,
          output: "",
          error: "Generic input failure without atomic evidence",
          failureKind: "input_error" as const,
          durationMs: 1,
        });
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-untrusted-input-error",
      text: "Update src/api.ts.",
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
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual(["file_read", "apply_patch"]);
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringContaining("Generic input failure without atomic evidence"),
    }));
    expect(items.at(-1)).toMatchObject({ type: "status", status: "error" });
  });

  it("leaves a colonless Update File header unchanged outside required mutation recovery", async () => {
    const colonlessPatch = "*** Begin Patch\n*** Update File src/api.ts\n@@\n-old\n+new\n*** End Patch";
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response(modelToolCall("patch-ordinary", "apply_patch", { input: colonlessPatch }, 400, 80));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "done" } }],
        usage: { prompt_tokens: 200, completion_tokens: 20 },
      });
    });
    const execute = vi.fn(async (request: { id: string; name: string; arguments?: Record<string, unknown> }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: "Patch applied successfully",
      durationMs: 1,
    }));
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-ordinary-colonless-patch",
      text: "Update src/api.ts.",
      automationProfile: "bare",
    }));

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0].arguments).toEqual({ input: colonlessPatch });
    expect(items).toContainEqual({ type: "final", text: "done" });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("fails closed when the bounded continuation reports an already-covered path", async () => {
    const requiredChangedPaths = ["src/api.ts", "src/protocol.ts"];
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response(modelUnanchoredVerificationReads(requiredChangedPaths));
      }
      return response(modelToolCall(
        `patch-${requests.length}`,
        "apply_patch",
        { input: `patch ${requests.length}` },
        500,
        80,
      ));
    });
    let mutationCall = 0;
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
          output: JSON.stringify({ path: request.arguments?.path, truncated: false, content: "source" }),
          durationMs: 1,
        };
      }
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
              : [requiredChangedPaths[1], requiredChangedPaths[0]],
          },
        },
        durationMs: 1,
      };
    });
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-required-path-continuation-extra-path",
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
    expect(execute).toHaveBeenCalledTimes(4);
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringContaining("already-covered or unlisted path"),
    }));
    expect(items.at(-1)).toMatchObject({ type: "status", status: "error" });
  });

  it("fails closed before continuation when the remaining token budget cannot fit it", async () => {
    const requiredChangedPaths = ["src/api.ts", "src/protocol.ts"];
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response({
          ...modelUnanchoredVerificationReads(requiredChangedPaths),
          usage: { prompt_tokens: 9_500, completion_tokens: 500 },
        });
      }
      return response(modelToolCall("patch-api", "apply_patch", { input: "patch api" }, 12_000, 700));
    });
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: request.name === "file_read"
        ? JSON.stringify({ path: request.arguments?.path, truncated: false, content: "source" })
        : "Patch applied successfully",
      ...(request.name === "apply_patch" ? {
        metadata: {
          workspaceMutation: { schemaVersion: 1, changedPaths: [requiredChangedPaths[0]] },
        },
      } : {}),
      durationMs: 1,
    }));
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-required-path-continuation-no-token-budget",
      text: "Apply the frozen public API migration.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
          toolLoopIterationBudget: 3,
          maxTotalTokens: 24_000,
        },
      },
    }));

    expect(requests).toHaveLength(2);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringContaining("no bounded missing-path mutation continuation"),
    }));
    expect(items.at(-1)).toMatchObject({ type: "status", status: "error" });
  });

  it("fails closed when the bounded continuation still leaves a required changed path uncovered", async () => {
    const requiredChangedPaths = [
      "jsonrpc/src/common/api.ts",
      "jsonrpc/src/common/connection.ts",
      "protocol/src/common/protocol.ts",
      "protocol/src/common/transport.ts",
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
      const continuationCall = body.messages?.some((message: any) => (
        message.role === "system" && String(message.content).includes("Missing-path mutation continuation phase")
      ));
      if (continuationCall) {
        return response(modelToolCall("patch-protocol", "apply_patch", { input: "patch protocol" }, 500, 80));
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

    expect(requests).toHaveLength(3);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringContaining("protocol/src/common/transport.ts"),
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
      if (requests.length === 3) {
        return response(modelVerificationReads(["src/api.ts"]));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "fixed" } }],
        usage: { prompt_tokens: 300, completion_tokens: 30 },
      });
    });
    let mutationCall = 0;
    const execute = vi.fn(async (request: { id: string; name: string; arguments?: Record<string, unknown> }) => {
      if (request.name === "file_read") {
        return {
          id: request.id,
          name: request.name,
          success: true,
          output: JSON.stringify({ path: request.arguments?.path, truncated: false, content: "verified" }),
          durationMs: 1,
        };
      }
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

    expect(requests).toHaveLength(4);
    expect(requests[1]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Mutation-only recovery phase"),
      }),
    ]));
    expect(requests[2]?.tools?.map((tool: any) => tool.function.name)).toEqual(["file_read"]);
    expect(execute).toHaveBeenCalledTimes(3);
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
      if (requests.length === 2) {
        return response(modelVerificationReads(["src/api.ts"]));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "fixed" } }],
        usage: { prompt_tokens: 300, completion_tokens: 30 },
      });
    });
    let mutationCall = 0;
    const execute = vi.fn(async (request: { id: string; name: string; arguments?: Record<string, unknown> }) => {
      if (request.name === "file_read") {
        return {
          id: request.id,
          name: request.name,
          success: true,
          output: JSON.stringify({ path: request.arguments?.path, truncated: false, content: "verified" }),
          durationMs: 1,
        };
      }
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

    expect(requests).toHaveLength(3);
    expect(execute).toHaveBeenCalledTimes(3);
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
      if (requests.length === 4) {
        return response(modelVerificationReads(requiredChangedPaths));
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
    expect(requests[1]?.messages[0]?.content).toContain("from the start without an anchor");
    if (completes) {
      expect(requests).toHaveLength(5);
      expect(requests[2]?.tools?.map((tool: any) => tool.function.name)).toEqual(["apply_patch"]);
      expect(requests[2]?.messages[0]?.content).toContain(
        "trusted required paths are one atomic checklist",
      );
      expect(requests[2]?.messages[0]?.content).toContain(
        "never repeat headers or rely on continuation",
      );
      expect(requests[3]?.tools?.map((tool: any) => tool.function.name)).toEqual(["file_read"]);
      expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
        "list_files",
        "file_read",
        "file_read",
        "file_read",
        "file_read",
        "apply_patch",
        "file_read",
        "file_read",
        "file_read",
      ]);
      if (omitProtocolAnchor) {
        const protocolRead = execute.mock.calls
          .map(([request]) => request)
          .find((request) => request.arguments?.path === requiredChangedPaths[2]);
        expect(protocolRead?.arguments?.limit).toBe(1_048_576);
        expect(requests[2]?.messages[1]?.content).toContain("trace?: TraceValues;");
      } else {
        const protocolRead = execute.mock.calls
          .map(([request]) => request)
          .find((request) => request.id === "read-protocol");
        expect(protocolRead?.arguments).toEqual({
          path: requiredChangedPaths[2],
          limit: 1_048_576,
        });
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

  it("disables DeepSeek thinking for objective review and finalization after verification", async () => {
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
              tool_calls: requiredChangedPaths.map((path, index) => modelToolCall(
                `read-required-${index}`,
                "file_read",
                { path },
                0,
                0,
              ).choices[0].message.tool_calls[0]),
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
      if (requests.length === 4) {
        return response(modelVerificationReads(requiredChangedPaths));
      }
      if (requests.length === 5) {
        return response({
          choices: [{
            finish_reason: "length",
            message: { content: null, reasoning_content: "R".repeat(Number(body.max_tokens)) },
          }],
          usage: { prompt_tokens: 500, completion_tokens: Number(body.max_tokens) },
        });
      }
      if ((body.thinking as { type?: unknown } | undefined)?.type !== "disabled") {
        return response({
          choices: [{
            finish_reason: "length",
            message: { content: null, reasoning_content: "R".repeat(Number(body.max_tokens)) },
          }],
          usage: { prompt_tokens: 500, completion_tokens: Number(body.max_tokens) },
        });
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
      return {
        id: request.id,
        name: request.name,
        success: true,
        output: JSON.stringify({
          path: requestPath,
          truncated: false,
          content: requestPath.startsWith("test/")
            ? requiredChangedPaths.join("\n")
            : `complete source for ${requestPath}\n${"x".repeat(
                requestPath === requiredChangedPaths[0]
                  ? 5_423
                  : requestPath === requiredChangedPaths[1]
                    ? 60_123
                    : 134_094,
              )}`,
        }),
        durationMs: 1,
      };
    });
    const agent = createAgent({
      execute,
      maxTotalTokens: 24_000,
      toolLoopIterationBudget: 12,
      thinking: { type: "enabled" },
      mutationToolNames: ["apply_patch"],
      readToolNames: ["file_read", "list_files"],
    });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-verified-finalization-thinking",
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

    expect(requests).toHaveLength(6);
    expect(requests[0]?.thinking).toEqual({ type: "enabled" });
    expect(requests.slice(1, 4).every((request) => request.thinking?.type === "disabled")).toBe(true);
    expect(requests[4]?.messages[0]?.content).toContain("Post-mutation objective review phase");
    expect(requests[4]?.tools?.map((tool: any) => tool.function.name)).toEqual(["apply_patch"]);
    expect(requests[4]?.thinking).toEqual({ type: "disabled" });
    expect(requests[5]).not.toHaveProperty("tools");
    expect(requests[5]?.max_tokens).toBe(1_024);
    expect(requests[5]?.thinking).toEqual({ type: "disabled" });
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "list_files",
      "file_read",
      "file_read",
      "file_read",
      "file_read",
      "apply_patch",
      "file_read",
      "file_read",
      "file_read",
    ]);
    expect(items).toContainEqual({ type: "final", text: '{"summary":"migrated"}' });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
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

  it("preserves context-only hunks for one atomic recovery patch execution", async () => {
    const requiredChangedPaths = [
      "jsonrpc/src/common/api.ts",
      "jsonrpc/src/common/connection.ts",
      "protocol/src/common/protocol.ts",
    ];
    const patch = [
      "*** Begin Patch",
      "*** Update File: jsonrpc/src/common/api.ts",
      "@@",
      " api context only",
      "@@",
      "-\tNotificationHandler9, Trace, TraceValue, TraceValues, TraceFormat,",
      "+\tNotificationHandler9, Trace, TraceValue, TraceFormat,",
      "*** Update File: jsonrpc/src/common/connection.ts",
      "@@",
      "-export const TraceValues = TraceValue;",
      "-export type TraceValues = TraceValue;",
      "*** Update File: protocol/src/common/protocol.ts",
      "@@",
      "-import { TraceValues } from 'vscode-jsonrpc';",
      "+import { TraceValue } from 'vscode-jsonrpc';",
      "*** End Patch",
    ].join("\n");
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response({
          choices: [{ finish_reason: "stop", message: { content: "I need to change the files." } }],
          usage: { prompt_tokens: 200, completion_tokens: 30 },
        });
      }
      if (requests.length === 2) {
        return response(modelToolCall("patch-1", "apply_patch", { input: patch }, 300, 60));
      }
      if (requests.length === 3) {
        return response(modelUnanchoredVerificationReads(requiredChangedPaths));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "corrected and verified" } }],
        usage: { prompt_tokens: 200, completion_tokens: 30 },
      });
    });
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: request.name === "file_read"
        ? JSON.stringify({
            path: request.arguments?.path,
            truncated: false,
            content: "updated source",
          })
        : "Patch applied successfully",
      ...(request.name === "apply_patch" ? {
        metadata: {
          workspaceMutation: {
            schemaVersion: 1,
            changedPaths: requiredChangedPaths,
          },
        },
      } : {}),
      durationMs: 1,
    }));
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 4 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-remove-context-only-hunk",
      text: "Remove every deprecated alias occurrence.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
        },
      },
    }));

    expect(requests).toHaveLength(4);
    expect(execute.mock.calls.filter(([request]) => request.name === "apply_patch")).toHaveLength(1);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      name: "apply_patch",
      arguments: { input: patch },
    });
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "apply_patch",
      "file_read",
      "file_read",
      "file_read",
    ]);
    expect(items).toContainEqual({ type: "final", text: "corrected and verified" });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("continues once after dropping repeated independent context-only sections", async () => {
    const requiredChangedPaths = [
      "jsonrpc/src/common/api.ts",
      "jsonrpc/src/common/connection.ts",
      "protocol/src/common/protocol.ts",
    ];
    const mixedPatch = [
      "*** Begin Patch",
      "*** Update File: jsonrpc/src/common/api.ts",
      "@@",
      " \tCancellationReceiverStrategy, IdCancellationReceiverStrategy, RequestCancellationReceiverStrategy, CancellationSenderStrategy, CancellationStrategy, MessageStrategy, TraceValues",
      " } from './connection';",
      "*** Update File: jsonrpc/src/common/connection.ts",
      "@@",
      "-export const TraceValues = TraceValue;",
      "-export type TraceValues = TraceValue;",
      "*** Update File: jsonrpc/src/common/api.ts",
      "@@",
      " } from './connection';",
      "*** Update File: protocol/src/common/protocol.ts",
      "@@",
      "-import { TraceValues } from 'vscode-jsonrpc';",
      "+import { TraceValue } from 'vscode-jsonrpc';",
      "*** End Patch",
    ].join("\n");
    const actionablePatch = [
      "*** Begin Patch",
      "*** Update File: jsonrpc/src/common/connection.ts",
      "@@",
      "-export const TraceValues = TraceValue;",
      "-export type TraceValues = TraceValue;",
      "*** Update File: protocol/src/common/protocol.ts",
      "@@",
      "-import { TraceValues } from 'vscode-jsonrpc';",
      "+import { TraceValue } from 'vscode-jsonrpc';",
      "*** End Patch",
    ].join("\n");
    const continuationPatch = [
      "*** Begin Patch",
      "*** Update File: jsonrpc/src/common/api.ts",
      "@@",
      "-export { TraceValues };",
      "+export { TraceValue };",
      "*** End Patch",
    ].join("\n");
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response({
          choices: [{ finish_reason: "stop", message: { content: "I need to change the files." } }],
          usage: { prompt_tokens: 200, completion_tokens: 30 },
        });
      }
      if (requests.length === 2) {
        return response(modelToolCall("patch-actionable", "apply_patch", { input: mixedPatch }, 300, 60));
      }
      if (requests.length === 3) {
        return response(modelToolCall("patch-missing", "apply_patch", { input: continuationPatch }, 300, 60));
      }
      if (requests.length === 4) {
        return response(modelUnanchoredVerificationReads(requiredChangedPaths));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "corrected and verified" } }],
        usage: { prompt_tokens: 200, completion_tokens: 30 },
      });
    });
    let mutationCall = 0;
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
            path: request.arguments?.path,
            truncated: false,
            content: "updated source",
          }),
          durationMs: 1,
        };
      }
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
              ? requiredChangedPaths.slice(1)
              : requiredChangedPaths.slice(0, 1),
          },
        },
        durationMs: 1,
      };
    });
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 4 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-context-only-hunk",
      text: "Remove every deprecated alias occurrence.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
        },
      },
    }));

    expect(requests).toHaveLength(5);
    expect(requests[2]?.messages[0]?.content).toContain("Missing-path mutation continuation phase");
    expect(requests[2]?.messages[1]?.content).toContain(
      `Trusted required changed paths still missing:\n["${requiredChangedPaths[0]}"]`,
    );
    expect(requests[3]?.tools?.map((tool: any) => tool.function.name)).toEqual(["file_read"]);
    const mutationCalls = execute.mock.calls
      .map(([request]) => request)
      .filter((request) => request.name === "apply_patch");
    expect(mutationCalls.map((request) => request.arguments)).toEqual([
      { input: actionablePatch },
      { input: continuationPatch },
    ]);
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "apply_patch",
      "apply_patch",
      "file_read",
      "file_read",
      "file_read",
    ]);
    expect(items).toContainEqual({ type: "final", text: "corrected and verified" });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("corrects one atomic input error after trusted missing-path continuation progress", async () => {
    const requiredChangedPaths = [
      "jsonrpc/src/common/api.ts",
      "jsonrpc/src/common/connection.ts",
      "protocol/src/common/protocol.ts",
    ];
    const initialPatch = [
      "*** Begin Patch",
      "*** Update File: jsonrpc/src/common/connection.ts",
      "@@",
      "-export const TraceValues = TraceValue;",
      "-export type TraceValues = TraceValue;",
      "*** Update File: protocol/src/common/protocol.ts",
      "@@",
      "-import { TraceValues } from 'vscode-jsonrpc';",
      "+import { TraceValue } from 'vscode-jsonrpc';",
      "*** End Patch",
    ].join("\n");
    const crossContextPatch = [
      "*** Begin Patch",
      "*** Update File: jsonrpc/src/common/api.ts",
      "@@",
      " \tNotificationType2, NotificationType3, NotificationType4, NotificationType5,",
      "-\tNotificationType9, RequestHandler9, Trace, TraceValue, TraceValues, TraceFormat,",
      "+\tNotificationType9, RequestHandler9, Trace, TraceValue, TraceFormat,",
      "*** End Patch",
    ].join("\n");
    const correctedPatch = [
      "*** Begin Patch",
      "*** Update File: jsonrpc/src/common/api.ts",
      "@@",
      "-\tMessageStrategy, TraceValues",
      "+\tMessageStrategy",
      "@@",
      "-\tTrace, TraceValue, TraceValues, TraceFormat,",
      "+\tTrace, TraceValue, TraceFormat,",
      "*** End Patch",
    ].join("\n");
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      const isPhase = (phase: string) => body.messages?.some((message: any) => (
        message.role === "system" && String(message.content).includes(phase)
      ));
      if (isPhase("Mutation-only recovery phase")) {
        return response(modelToolCall("patch-partial", "apply_patch", { input: initialPatch }, 600, 90));
      }
      if (isPhase("Missing-path mutation continuation phase")) {
        return response(modelToolCall("patch-cross-context", "apply_patch", { input: crossContextPatch }, 500, 80));
      }
      if (isPhase("Atomic input correction phase")) {
        return response(modelToolCall("patch-corrected", "apply_patch", { input: correctedPatch }, 500, 80));
      }
      if (isPhase("Post-mutation verification phase")) {
        return response(modelUnanchoredVerificationReads(requiredChangedPaths));
      }
      if (requests.length === 1) {
        return response({
          choices: [{ finish_reason: "stop", message: { content: "I need to change the files." } }],
          usage: { prompt_tokens: 200, completion_tokens: 30 },
        });
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "corrected and verified" } }],
        usage: { prompt_tokens: 300, completion_tokens: 30 },
      });
    });
    let mutationCall = 0;
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "file_read") {
        const path = String(request.arguments?.path);
        return {
          id: request.id,
          name: request.name,
          success: true,
          output: JSON.stringify({
            path,
            truncated: false,
            content: path.endsWith("api.ts")
              ? [
                  "\tMessageStrategy, TraceValues",
                  ...Array.from({ length: 80 }, (_, index) => `const filler${index} = true;`),
                  "\tTrace, TraceValue, TraceValues, TraceFormat,",
                ].join("\n")
              : `source context for ${path}`,
          }),
          durationMs: 1,
        };
      }
      mutationCall++;
      if (mutationCall === 2) {
        return {
          id: request.id,
          name: request.name,
          success: false,
          output: "",
          error: "Failed to find expected lines",
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
          workspaceMutation: {
            schemaVersion: 1,
            changedPaths: mutationCall === 1
              ? requiredChangedPaths.slice(1)
              : requiredChangedPaths.slice(0, 1),
          },
        },
        durationMs: 1,
      };
    });
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 4 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-continuation-input-correction",
      text: "Remove every deprecated TraceValues import and export.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
        },
      },
    }));

    expect(requests).toHaveLength(6);
    expect(requests[2]?.messages[0]?.content).toContain("Missing-path mutation continuation phase");
    expect(requests[3]?.messages[0]?.content).toContain("Atomic input correction phase");
    expect(requests[3]?.messages[1]?.content).toContain(
      `Trusted required changed paths still missing:\n["${requiredChangedPaths[0]}"]`,
    );
    expect(JSON.stringify(requests[3]?.messages)).not.toContain(
      "NotificationType9, RequestHandler9",
    );
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "apply_patch",
      "apply_patch",
      "apply_patch",
      "file_read",
      "file_read",
      "file_read",
    ]);
    expect(execute.mock.calls[2]?.[0].arguments).toEqual({ input: correctedPatch });
    expect(items).toContainEqual({ type: "final", text: "corrected and verified" });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("drops already-covered update sections from a complete missing-path continuation", async () => {
    const requiredChangedPaths = [
      "jsonrpc/src/common/api.ts",
      "jsonrpc/src/common/connection.ts",
      "protocol/src/common/protocol.ts",
    ];
    const initialPatch = [
      "*** Begin Patch",
      "*** Update File: jsonrpc/src/common/connection.ts",
      "@@",
      "-export const TraceValues = TraceValue;",
      "-export type TraceValues = TraceValue;",
      "*** End Patch",
    ].join("\n");
    const continuationPatch = [
      "*** Begin Patch",
      "*** Update File: jsonrpc/src/common/api.ts",
      "@@",
      "-\tMessageStrategy, TraceValues",
      "+\tMessageStrategy",
      "*** Update File: jsonrpc/src/common/connection.ts",
      "@@",
      "-export const TraceValues = TraceValue;",
      "-export type TraceValues = TraceValue;",
      "*** Update File: protocol/src/common/protocol.ts",
      "@@",
      "-import { ProgressToken, RequestHandler, TraceValues } from 'vscode-jsonrpc';",
      "+import { ProgressToken, RequestHandler, TraceValue } from 'vscode-jsonrpc';",
      "*** End Patch",
    ].join("\n");
    const filteredContinuationPatch = [
      "*** Begin Patch",
      "*** Update File: jsonrpc/src/common/api.ts",
      "@@",
      "-\tMessageStrategy, TraceValues",
      "+\tMessageStrategy",
      "*** Update File: protocol/src/common/protocol.ts",
      "@@",
      "-import { ProgressToken, RequestHandler, TraceValues } from 'vscode-jsonrpc';",
      "+import { ProgressToken, RequestHandler, TraceValue } from 'vscode-jsonrpc';",
      "*** End Patch",
    ].join("\n");
    const incompleteCorrectionPatch = [
      "*** Begin Patch",
      "*** Update File: jsonrpc/src/common/api.ts",
      "@@",
      "-\tMessageStrategy, TraceValues",
      "+\tMessageStrategy",
      "*** End Patch",
    ].join("\n");
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      const isPhase = (phase: string) => body.messages?.some((message: any) => (
        message.role === "system" && String(message.content).includes(phase)
      ));
      if (isPhase("Mutation-only recovery phase")) {
        return response(modelToolCall("patch-partial", "apply_patch", { input: initialPatch }, 600, 90));
      }
      if (isPhase("Missing-path mutation continuation phase")) {
        return response(modelToolCall("patch-redundant", "apply_patch", { input: continuationPatch }, 500, 80));
      }
      if (isPhase("Atomic input correction phase")) {
        return response(modelToolCall("patch-incomplete", "apply_patch", {
          input: incompleteCorrectionPatch,
        }, 500, 80));
      }
      if (isPhase("Post-mutation verification phase")) {
        return response(modelUnanchoredVerificationReads(requiredChangedPaths));
      }
      if (requests.length === 1) {
        return response({
          choices: [{ finish_reason: "stop", message: { content: "I need to change the files." } }],
          usage: { prompt_tokens: 200, completion_tokens: 30 },
        });
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "migrated and verified" } }],
        usage: { prompt_tokens: 300, completion_tokens: 30 },
      });
    });
    let mutationCall = 0;
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
            path: request.arguments?.path,
            truncated: false,
            content: `updated source for ${String(request.arguments?.path)}`,
          }),
          durationMs: 1,
        };
      }
      mutationCall++;
      const input = String(request.arguments?.input);
      if (mutationCall === 1) {
        return {
          id: request.id,
          name: request.name,
          success: true,
          output: "Patch applied successfully",
          metadata: {
            workspaceMutation: {
              schemaVersion: 1,
              changedPaths: [requiredChangedPaths[1]],
            },
          },
          durationMs: 1,
        };
      }
      if (input === filteredContinuationPatch) {
        return {
          id: request.id,
          name: request.name,
          success: true,
          output: "Patch applied successfully",
          metadata: {
            workspaceMutation: {
              schemaVersion: 1,
              changedPaths: [requiredChangedPaths[0], requiredChangedPaths[2]],
            },
          },
          durationMs: 1,
        };
      }
      if (input.includes("jsonrpc/src/common/connection.ts")) {
        return {
          id: request.id,
          name: request.name,
          success: false,
          output: "",
          error: "Failed to find expected lines",
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
          workspaceMutation: {
            schemaVersion: 1,
            changedPaths: [requiredChangedPaths[0]],
          },
        },
        durationMs: 1,
      };
    });
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 4 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-continuation-covered-section",
      text: "Remove every deprecated TraceValues import and export.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
        },
      },
    }));

    expect(requests.some((request) => request.messages?.some((message: any) => (
      message.role === "system" && String(message.content).includes("Atomic input correction phase")
    )))).toBe(false);
    const mutationCalls = execute.mock.calls
      .map(([request]) => request)
      .filter((request) => request.name === "apply_patch");
    expect(mutationCalls.map((request) => request.arguments)).toEqual([
      { input: initialPatch },
      { input: filteredContinuationPatch },
    ]);
    expect(items).toContainEqual({ type: "final", text: "migrated and verified" });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("fails closed before retaining actionable sections outside the required path list", async () => {
    const requiredChangedPaths = ["src/api.ts", "src/protocol.ts"];
    const patch = [
      "*** Begin Patch",
      "*** Update File: src/api.ts",
      "@@",
      " api context only",
      "*** Update File: src/protocol.ts",
      "@@",
      "-old protocol",
      "+new protocol",
      "*** Update File: src/outside.ts",
      "@@",
      "-old outside",
      "+new outside",
      "*** End Patch",
    ].join("\n");
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response({
          choices: [{ finish_reason: "stop", message: { content: "I need to change the files." } }],
          usage: { prompt_tokens: 200, completion_tokens: 30 },
        });
      }
      return response(modelToolCall("patch-mixed-paths", "apply_patch", { input: patch }, 300, 60));
    });
    const execute = vi.fn(async (request: { id: string; name: string }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: "Patch applied successfully",
      metadata: {
        workspaceMutation: {
          schemaVersion: 1,
          changedPaths: ["src/protocol.ts", "src/outside.ts"],
        },
      },
      durationMs: 1,
    }));
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-actionable-outside-path",
      text: "Update only the required files.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
        },
      },
    }));

    expect(requests).toHaveLength(2);
    expect(execute).not.toHaveBeenCalled();
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringContaining("context-only hunk"),
    }));
    expect(items.at(-1)).toMatchObject({ type: "status", status: "error" });
  });

  it("checks every retained actionable path before executing a large mixed patch", async () => {
    const actionableRequiredPaths = Array.from(
      { length: 32 },
      (_, index) => `src/required-${index}.ts`,
    );
    const requiredChangedPaths = ["src/missing.ts", ...actionableRequiredPaths];
    const patch = [
      "*** Begin Patch",
      "*** Update File: src/missing.ts",
      "@@",
      " missing context only",
      ...actionableRequiredPaths.flatMap((path) => [
        `*** Update File: ${path}`,
        "@@",
        "-old value",
        "+new value",
      ]),
      "*** Update File: src/outside.ts",
      "@@",
      "-old outside",
      "+new outside",
      "*** End Patch",
    ].join("\n");
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response({
          choices: [{ finish_reason: "stop", message: { content: "I need to change the files." } }],
          usage: { prompt_tokens: 200, completion_tokens: 30 },
        });
      }
      return response(modelToolCall("patch-large-mixed", "apply_patch", { input: patch }, 600, 120));
    });
    const execute = vi.fn(async (request: { id: string; name: string }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: "Patch applied successfully",
      metadata: {
        workspaceMutation: {
          schemaVersion: 1,
          changedPaths: [...actionableRequiredPaths, "src/outside.ts"],
        },
      },
      durationMs: 1,
    }));
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-large-actionable-outside-path",
      text: "Update only the required files.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
        },
      },
    }));

    expect(requests).toHaveLength(2);
    expect(execute).not.toHaveBeenCalled();
    expect(items.at(-1)).toMatchObject({ type: "status", status: "error" });
  });

  it("fails closed before executing a recovery patch with an unexpected End Patch marker", async () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: src/api.ts",
      "@@",
      "-old export",
      "+new export",
      "*** End Patch",
      "*** End Patch",
    ].join("\n");
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response({
          choices: [{ finish_reason: "stop", message: { content: "I need to change the file." } }],
          usage: { prompt_tokens: 200, completion_tokens: 30 },
        });
      }
      return response(modelToolCall("patch-1", "apply_patch", { input: patch }, 300, 60));
    });
    const execute = vi.fn(async (request: { id: string; name: string }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: "Patch applied successfully",
      metadata: {
        workspaceMutation: {
          schemaVersion: 1,
          changedPaths: ["src/api.ts"],
        },
      },
      durationMs: 1,
    }));
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 3 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-unexpected-end-marker",
      text: "Change src/api.ts.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths: ["src/api.ts"],
        },
      },
    }));

    expect(requests).toHaveLength(2);
    expect(execute).not.toHaveBeenCalled();
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringContaining("unexpected End Patch marker"),
    }));
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringContaining(
        'diagnostic=unexpected_end_marker endMarkerCount=2 unexpectedEndMarkerCount=1 paths=["src/api.ts"]',
      ),
    }));
    expect(items.at(-1)).toMatchObject({ type: "status", status: "error" });
  });

  it("coalesces complete patch envelopes from one mutation-only tool call", async () => {
    const requiredChangedPaths = [
      "jsonrpc/src/common/api.ts",
      "jsonrpc/src/common/connection.ts",
      "protocol/src/common/protocol.ts",
    ];
    const splitEnvelopePatch = [
      "*** Begin Patch",
      "*** Update File: jsonrpc/src/common/connection.ts",
      "@@",
      "-old connection",
      "+new connection",
      "*** End Patch",
      "*** Begin Patch",
      "*** Update File: jsonrpc/src/common/api.ts",
      "@@",
      "-old api",
      "+new api",
      "*** End Patch",
      "*** Begin Patch",
      "*** Update File: protocol/src/common/protocol.ts",
      "@@",
      "-old protocol",
      "+new protocol",
      "*** End Patch",
    ].join("\n");
    const coalescedPatch = [
      "*** Begin Patch",
      "*** Update File: jsonrpc/src/common/connection.ts",
      "@@",
      "-old connection",
      "+new connection",
      "*** Update File: jsonrpc/src/common/api.ts",
      "@@",
      "-old api",
      "+new api",
      "*** Update File: protocol/src/common/protocol.ts",
      "@@",
      "-old protocol",
      "+new protocol",
      "*** End Patch",
    ].join("\n");
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      if (requests.length === 1) {
        return response({
          choices: [{ finish_reason: "stop", message: { content: "I need to change the files." } }],
          usage: { prompt_tokens: 200, completion_tokens: 30 },
        });
      }
      if (requests.length === 2) {
        return response(modelToolCall("patch-1", "apply_patch", { input: splitEnvelopePatch }, 300, 60));
      }
      if (requests.length === 3) {
        return response(modelUnanchoredVerificationReads(requiredChangedPaths));
      }
      return response({
        choices: [{ finish_reason: "stop", message: { content: "updated and verified" } }],
        usage: { prompt_tokens: 200, completion_tokens: 30 },
      });
    });
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: request.name === "file_read"
        ? JSON.stringify({ path: request.arguments?.path, truncated: false, content: "updated source" })
        : "Patch applied successfully",
      ...(request.name === "apply_patch" ? {
        metadata: {
          workspaceMutation: {
            schemaVersion: 1,
            changedPaths: requiredChangedPaths,
          },
        },
      } : {}),
      durationMs: 1,
    }));
    const agent = createAgent({ execute, maxTotalTokens: 24_000, toolLoopIterationBudget: 4 });

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-coalesce-patch-envelopes",
      text: "Remove every deprecated alias occurrence.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths,
        },
      },
    }));

    expect(requests).toHaveLength(4);
    expect(execute.mock.calls.filter(([request]) => request.name === "apply_patch")).toHaveLength(1);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      name: "apply_patch",
      arguments: { input: coalescedPatch },
    });
    expect(items).toContainEqual({ type: "final", text: "updated and verified" });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
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

function modelVerificationReads(requiredPaths: readonly string[]) {
  return {
    choices: [{
      finish_reason: "tool_calls",
      message: {
        content: null,
        tool_calls: requiredPaths.map((path, index) => modelToolCall(
          `verify-${index}`,
          "file_read",
          { path, anchor: `post-mutation-anchor-${index}` },
          0,
          0,
        ).choices[0].message.tool_calls[0]),
      },
    }],
    usage: { prompt_tokens: 400, completion_tokens: 80 },
  };
}

function modelUnanchoredVerificationReads(requiredPaths: readonly string[]) {
  return {
    choices: [{
      finish_reason: "tool_calls",
      message: {
        content: null,
        tool_calls: requiredPaths.map((path, index) => modelToolCall(
          `verify-unanchored-${index}`,
          "file_read",
          { path, limit: 102_400 },
          0,
          0,
        ).choices[0].message.tool_calls[0]),
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
