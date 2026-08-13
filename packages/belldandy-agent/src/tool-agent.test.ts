import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./model-request-transport.js", () => ({
  requestModelTransport: (options: { url: string | URL; init: RequestInit }) => (
    fetch(options.url, options.init)
  ),
}));

import {
  ToolEnabledAgent,
  applyPrependContextToInput,
  buildToolTranscriptMessageForHistory,
  compactReasoningContentForHistory,
  estimateToolDefinitionTokens,
  sanitizeAssistantToolCallHistoryContent,
  sanitizeResponsesToolDefinitions,
} from "./tool-agent.js";
import type { AgentPromptSnapshot } from "./prompt-snapshot.js";
import { estimateTokens } from "./tokenizer.js";
import { CompactionRuntimeTracker } from "./compaction-runtime.js";
import { ConversationStore } from "./conversation.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const MULTI_PROVIDER_RUNTIME_CASES = [
  {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    responseBody: {
      choices: [{
        message: {
          content: "done",
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    },
    extractSystemPrompt: (payload: any) => String(payload.messages?.[0]?.content ?? ""),
  },
  {
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    responseBody: {
      content: [{ type: "text", text: "done" }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: "end_turn",
    },
    extractSystemPrompt: (payload: any) => Array.isArray(payload.system)
      ? payload.system.map((block: any) => String(block?.text ?? "")).join("\n\n")
      : "",
  },
] as const;

describe("sanitizeResponsesToolDefinitions", () => {
  it("should remove unsupported schema keywords for responses tools", () => {
    const tools = [
      {
        type: "function" as const,
        function: {
          name: "timer",
          description: "Timer tool",
          parameters: {
            type: "object",
            properties: {
              action: { type: "string" },
              payload: {
                type: "object",
                oneOf: [{ required: ["a"] }],
                properties: {
                  a: { type: "string" },
                },
              },
            },
            required: ["action"],
            oneOf: [{ required: ["action", "payload"] }],
            $schema: "https://json-schema.org/draft/2020-12/schema",
            definitions: {
              internal: {
                type: "object",
              },
            },
          },
        },
      },
    ];

    const sanitized = sanitizeResponsesToolDefinitions(tools);

    expect(sanitized[0].function.parameters).toEqual({
      type: "object",
      properties: {
        action: { type: "string" },
        payload: {
          type: "object",
          properties: {
            a: { type: "string" },
          },
        },
      },
      required: ["action"],
    });
  });

  it("should not mutate original tool definitions", () => {
    const tools = [
      {
        type: "function" as const,
        function: {
          name: "timer",
          description: "Timer tool",
          parameters: {
            type: "object",
            oneOf: [{ required: ["action"] }],
            properties: {
              action: { type: "string" },
            },
          },
        },
      },
    ];

    const original = JSON.parse(JSON.stringify(tools));
    const sanitized = sanitizeResponsesToolDefinitions(tools);

    expect(tools).toEqual(original);
    expect(sanitized).not.toBe(tools);
    expect((sanitized[0].function.parameters as any).oneOf).toBeUndefined();
    expect((tools[0].function.parameters as any).oneOf).toBeDefined();
  });
});

describe("estimateToolDefinitionTokens", () => {
  it("reuses cached token estimates when the same parameters object is reused", () => {
    const tool = {
      type: "function" as const,
      function: {
        name: "file_read",
        description: "read file",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
          },
        },
      },
    };
    const stringifySpy = vi.spyOn(JSON, "stringify");

    const first = estimateToolDefinitionTokens(tool);
    const second = estimateToolDefinitionTokens(tool);

    expect(first).toBe(second);
    expect(stringifySpy).toHaveBeenCalledTimes(1);
  });
});

describe("applyPrependContextToInput", () => {
  it("prepends context into the first multimodal text part without duplicating a second text part", () => {
    const input = {
      conversationId: "conv-1",
      text: "user prompt",
      content: [
        { type: "text" as const, text: "user prompt" },
        { type: "image_url" as const, image_url: { url: "data:image/png;base64,abc" } },
      ],
    };

    const result = applyPrependContextToInput(input, "<recent-memory>ctx</recent-memory>");

    expect(result.text).toBe("<recent-memory>ctx</recent-memory>\n\nuser prompt");
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content).toHaveLength(2);
    expect(result.content?.[0]).toEqual({
      type: "text",
      text: "<recent-memory>ctx</recent-memory>\n\nuser prompt",
    });
    expect(result.content?.[1]).toEqual(input.content[1]);
  });

  it("inserts a text part when multimodal content has no existing text part", () => {
    const input = {
      conversationId: "conv-2",
      text: "",
      content: [
        { type: "image_url" as const, image_url: { url: "data:image/png;base64,abc" } },
      ],
    };

    const result = applyPrependContextToInput(input, "<auto-recall>ctx</auto-recall>");

    expect(result.text).toBe("<auto-recall>ctx</auto-recall>");
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content?.[0]).toEqual({
      type: "text",
      text: "<auto-recall>ctx</auto-recall>",
    });
    expect(result.content?.[1]).toEqual(input.content[0]);
  });
});

describe("before_agent_start system prompt overrides", () => {
  it("isolates bare automation runs from configured hooks without mutating later runs", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(createJsonResponse({
      choices: [{ message: { content: "done" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const runBeforeAgentStart = vi.fn(async () => ({
      prependContext: "implicit-memory",
      deltas: [{
        id: "implicit-hook-delta",
        deltaType: "memory-prelude",
        role: "system",
        text: "implicit-hook-memory",
      }],
    }));
    const runAgentEnd = vi.fn(async () => {});
    const runBeforeToolCall = vi.fn(async () => undefined);
    const runAfterToolCall = vi.fn(async () => {});
    const runToolResultPersist = vi.fn(() => undefined);
    const snapshots: AgentPromptSnapshot[] = [];
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      systemPrompt: "base-system-prompt",
      toolExecutor: createToolExecutor(),
      onPromptSnapshot: (snapshot) => snapshots.push(snapshot),
      hookRunner: {
        runBeforeAgentStart,
        runAgentEnd,
        runBeforeToolCall,
        runAfterToolCall,
        runToolResultPersist,
      } as any,
    });

    await collectItems(agent.run({
      conversationId: "conv-bare-hooks",
      text: "bare prompt",
      automationProfile: "bare",
      meta: {
        promptDeltas: [
          {
            id: "implicit-project-rule",
            deltaType: "project-rules",
            role: "system",
            text: "implicit-project-rule",
          },
          {
            id: "explicit-attachment",
            deltaType: "attachment",
            role: "attachment",
            text: "explicit-attachment",
          },
        ],
      },
    }));

    expect(runBeforeAgentStart).not.toHaveBeenCalled();
    expect(runAgentEnd).not.toHaveBeenCalled();
    expect(runBeforeToolCall).not.toHaveBeenCalled();
    expect(runAfterToolCall).not.toHaveBeenCalled();
    expect(runToolResultPersist).not.toHaveBeenCalled();
    const barePayload = JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.body ?? "{}"));
    expect(JSON.stringify(barePayload.messages)).not.toContain("implicit-project-rule");
    expect(JSON.stringify(barePayload.messages)).not.toContain("implicit-memory");
    expect(snapshots[0]?.deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "explicit-attachment", deltaType: "attachment" }),
    ]));
    expect(snapshots[0]?.deltas).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "implicit-project-rule" }),
    ]));

    await collectItems(agent.run({
      conversationId: "conv-normal-hooks",
      text: "normal prompt",
    }));

    expect(runBeforeAgentStart).toHaveBeenCalledOnce();
    expect(runAgentEnd).toHaveBeenCalledOnce();
  });

  it("uses hook-provided systemPrompt for the current run", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(createJsonResponse({
      choices: [{
        message: {
          content: "done",
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));

    let hookAbortSignal: AbortSignal | undefined;
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      systemPrompt: "base-system-prompt",
      toolExecutor: createToolExecutor(),
      hookRunner: {
        runBeforeAgentStart: async (_event: unknown, ctx: { abortSignal?: AbortSignal }) => {
          hookAbortSignal = ctx.abortSignal;
          return { systemPrompt: "hook-system-prompt" };
        },
        runAgentEnd: async () => {},
        runBeforeToolCall: async () => undefined,
        runAfterToolCall: async () => {},
        runToolResultPersist: () => undefined,
      } as any,
    });

    const controller = new AbortController();
    const items = await collectItems(agent.run({
      conversationId: "conv-hook-system-prompt",
      text: "hello",
      abortSignal: controller.signal,
    }));

    expect(items).toContainEqual({ type: "final", text: "done" });
    expect(hookAbortSignal).toBe(controller.signal);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const requestInit = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    const payload = JSON.parse(String(requestInit?.body ?? "{}"));
    expect(payload.messages[0]).toEqual({
      role: "system",
      content: "hook-system-prompt",
    });
  });

  it("uses a trusted per-run prompt override for requests, snapshots, and usage", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(createJsonResponse({
      choices: [{
        message: {
          content: "done",
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const snapshots: AgentPromptSnapshot[] = [];
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      systemPrompt: "resident-system-prompt",
      systemPromptSections: [{
        id: "workspace-soul",
        label: "SOUL.md",
        source: "workspace",
        priority: 20,
        text: "resident-soul",
      }],
      systemPromptMetadata: {
        systemPromptFingerprint: "resident-prompt",
      },
      toolExecutor: createToolExecutor(),
      onPromptSnapshot: (snapshot) => {
        snapshots.push(snapshot);
      },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-run-prompt-override",
      text: "inspect files",
      promptOverride: {
        text: "coding-run-system-prompt",
        sections: [{
          id: "coding-run-base",
          label: "coding-run-base",
          source: "core",
          priority: 0,
          text: "coding-run-system-prompt",
        }],
        metadata: {
          codingRunPromptMode: "bounded-coding-run-v1",
          systemPromptFingerprint: "coding-run-prompt",
        },
      },
    }));

    expect(items).toContainEqual({ type: "final", text: "done" });
    const requestInit = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    const payload = JSON.parse(String(requestInit?.body ?? "{}"));
    expect(payload.messages[0]).toEqual({
      role: "system",
      content: "coding-run-system-prompt",
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      systemPrompt: "coding-run-system-prompt",
      providerNativeSystemBlocks: [
        expect.objectContaining({
          blockType: "static-capability",
          sourceSectionIds: ["coding-run-base"],
        }),
      ],
      inputMeta: {
        codingRunPromptMode: "bounded-coding-run-v1",
        systemPromptFingerprint: "coding-run-prompt",
      },
    });
    expect(items).toContainEqual(expect.objectContaining({
      type: "usage",
      systemPromptFingerprint: "coding-run-prompt",
    }));
  });

  it("adapts stable prefix split injection for single_system_only models", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(createJsonResponse({
      choices: [{
        message: {
          content: "done",
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));

    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "qwythos-local",
      systemPrompt: "base-system-prompt",
      messageLayout: "single_system_only",
      stablePrefixSplit: { enabled: true },
      toolExecutor: createToolExecutor(),
      hookRunner: {
        runBeforeAgentStart: async () => ({
          deltas: [
            {
              id: "transient-1",
              deltaType: "tool-failure-recovery",
              role: "system",
              text: "Transient guidance",
            },
            {
              id: "authority-1",
              deltaType: "runtime-identity-authority",
              role: "system",
              text: "Authority mode: owner",
            },
          ],
        }),
        runAgentEnd: async () => {},
        runBeforeToolCall: async () => undefined,
        runAfterToolCall: async () => {},
        runToolResultPersist: () => undefined,
      } as any,
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-single-system-layout",
      text: "hello",
    }));

    expect(items).toContainEqual({ type: "final", text: "done" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const requestInit = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    const payload = JSON.parse(String(requestInit?.body ?? "{}"));
    expect(payload.messages.filter((message: any) => message.role === "system")).toHaveLength(1);
    expect(payload.messages[0]).toEqual({
      role: "system",
      content: expect.stringContaining("base-system-prompt"),
    });
    expect(payload.messages[0].content).toContain("<identity-authority");
    expect(payload.messages[0].content).toContain("Authority mode: owner");
    expect(payload.messages[1].role).toBe("user");
    expect(payload.messages[1].content).toContain("<transient-context");
    expect(payload.messages[1].content).toContain("Transient guidance");
    expect(payload.messages[1].content).toContain("hello");
  });

  it("captures a per-run prompt snapshot with hook systemPrompt and prependContext", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(createJsonResponse({
      choices: [{
        message: {
          content: "done",
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));

    const snapshots: any[] = [];
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      systemPrompt: "base-system-prompt",
      toolExecutor: createToolExecutor(),
      onPromptSnapshot: (snapshot) => {
        snapshots.push(snapshot);
      },
      hookRunner: {
        runBeforeAgentStart: async () => ({
          systemPrompt: "hook-system-prompt",
          prependContext: "<recent-memory>ctx</recent-memory>",
        }),
        runAgentEnd: async () => {},
        runBeforeToolCall: async () => undefined,
        runAfterToolCall: async () => {},
        runToolResultPersist: () => undefined,
      } as any,
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-hook-prompt-snapshot",
      text: "hello",
      meta: {
        runId: "run-snapshot-1",
      },
    }));

    expect(items).toContainEqual({ type: "final", text: "done" });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      agentId: "tool-agent",
      conversationId: "conv-hook-prompt-snapshot",
      runId: "run-snapshot-1",
      systemPrompt: "hook-system-prompt",
      hookSystemPromptUsed: true,
      prependContext: "<recent-memory>ctx</recent-memory>",
      deltas: [
        {
          id: "prepend-context",
          deltaType: "user-prelude",
          role: "user-prelude",
          text: "<recent-memory>ctx</recent-memory>",
        },
      ],
      messages: [
        {
          role: "system",
          content: "hook-system-prompt",
        },
        {
          role: "user",
          content: "<recent-memory>ctx</recent-memory>\n\nhello",
        },
      ],
    });
  });

  it("captures runtime identity and prompt meta deltas in prompt snapshots", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(createJsonResponse({
      choices: [{
        message: {
          content: "done",
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));

    const snapshots: any[] = [];
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      systemPrompt: "base-system-prompt",
      identityAuthorityProfile: {
        currentLabel: "首席执行官 (CEO)",
        superiorLabels: ["董事会成员"],
        subordinateLabels: ["CTO"],
        ownerUuids: ["user-123"],
        authorityMode: "verifiable_only",
        responsePolicy: {
          ownerOrSuperior: "execute",
          subordinate: "guide",
          other: "refuse_or_inform",
        },
        source: "identity_md",
      },
      toolExecutor: createToolExecutor(),
      onPromptSnapshot: (snapshot) => {
        snapshots.push(snapshot);
      },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-runtime-deltas",
      text: "hello",
      userUuid: "user-123",
      meta: {
        runId: "run-runtime-deltas",
        promptDeltas: [
          {
            id: "project-rules-test",
            deltaType: "project-rules",
            role: "system",
            text: "# Project Rules\nroot-project-rule",
            source: "project-rules",
          },
          {
            id: "attachment-1",
            deltaType: "attachment",
            role: "attachment",
            text: "[Attachment: notes.md]",
          },
        ],
      },
    }));

    expect(items).toContainEqual({ type: "final", text: "done" });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].systemPrompt).toContain("## Identity Context (Runtime)");
    expect(snapshots[0].systemPrompt).toContain("## Runtime Identity Authority");
    expect(snapshots[0].systemPrompt).toContain("root-project-rule");
    expect(snapshots[0].deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "runtime-identity-context",
        deltaType: "runtime-identity",
        role: "system",
      }),
      expect.objectContaining({
        id: "runtime-identity-authority",
        deltaType: "runtime-identity-authority",
        role: "system",
        metadata: expect.objectContaining({
          actorRelation: "owner",
          recommendedAction: "execute",
        }),
      }),
      expect.objectContaining({
        id: "project-rules-test",
        deltaType: "project-rules",
        role: "system",
        source: "project-rules",
      }),
      expect.objectContaining({
        id: "attachment-1",
        deltaType: "attachment",
        role: "attachment",
        text: "[Attachment: notes.md]",
      }),
    ]));
    expect(snapshots[0].inputMeta).toMatchObject({
      runId: "run-runtime-deltas",
    });
    expect((snapshots[0].inputMeta as any)?.promptDeltas).toBeUndefined();
    expect(snapshots[0].providerNativeSystemBlocks).toEqual([
      expect.objectContaining({
        blockType: "static-capability",
        sourceSectionIds: [],
        sourceDeltaIds: [],
        cacheControlEligible: true,
      }),
      expect.objectContaining({
        blockType: "dynamic-runtime",
        sourceDeltaIds: ["runtime-identity-context", "runtime-identity-authority", "project-rules-test"],
        cacheControlEligible: false,
      }),
    ]);
  });

  it("emits prefix drift and budget competition in usage and prompt snapshot meta", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(createJsonResponse({
      choices: [{
        message: {
          content: "done",
        },
      }],
      usage: { prompt_tokens: 12, completion_tokens: 2 },
    }));

    const snapshots: AgentPromptSnapshot[] = [];
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "deepseek-v4-pro",
      systemPrompt: "base-system-prompt",
      maxInputTokens: 16,
      systemPromptMetadata: {
        prefixShape: {
          fingerprint: "prev-prefix",
          shapeHashes: {
            systemPrompt: "prev-system",
            toolSchema: "prev-tools",
            runtimeDelta: "prev-delta",
            providerNativeBlocks: "prev-blocks",
            messagePrefix: "prev-msg",
          },
        },
      },
      toolExecutor: createToolExecutor({
        toolDefinitions: [{
          type: "function",
          function: {
            name: "tool_search",
            description: "search tools",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string" },
              },
            },
          },
        }],
      }),
      onPromptSnapshot: (snapshot) => {
        snapshots.push(snapshot);
      },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-observability",
      text: "please continue with the task and keep all context alive",
      history: [
        { role: "assistant", content: "old context one" },
        { role: "assistant", content: "old context two" },
        { role: "assistant", content: "old context three" },
      ],
    }));

    const usage = items.find((item) => item.type === "usage");
    expect(usage?.prefixShape?.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(usage?.prefixDrift?.status).toBe("drifted");
    expect(usage?.budgetCompetition?.pressure?.estimatedTotalTokens).toBeGreaterThan(0);
    expect(usage?.budgetCompetition?.sacrifice?.trimmedMessageCount).toBeGreaterThanOrEqual(0);
    expect((snapshots[0]?.inputMeta?.prefixShape as any)?.fingerprint).toBe(usage?.prefixShape?.fingerprint);
    expect(((snapshots[0]?.inputMeta?.budgetCompetition as any)?.pressure)?.estimatedTotalTokens).toBe(
      usage?.budgetCompetition?.pressure?.estimatedTotalTokens,
    );
  });

  it("warns when approaching the tool-loop iteration budget and injects a prompt delta", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: {
                name: "echo",
                arguments: "{}",
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "done",
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
    const loggerWarn = vi.fn();
    const snapshots: any[] = [];
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolLoopIterationBudget: 2,
      toolLoopWarningFraction: 0.67,
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function" as const,
          function: {
            name: "echo",
            description: "echo",
            parameters: { type: "object", properties: {} },
          },
        }],
        execute: vi.fn(async () => ({
          id: "call-1",
          name: "echo",
          success: true,
          output: "tool-output",
          durationMs: 0,
        })),
      }),
      onPromptSnapshot: (snapshot) => {
        snapshots.push(snapshot);
      },
      logger: {
        warn: loggerWarn,
        error: vi.fn(),
      },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-iteration-budget-warning",
      text: "use tool",
    }));

    expect(items).toContainEqual({ type: "final", text: "done" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(loggerWarn).toHaveBeenCalledWith(
      "agent",
      "[tool-loop-budget] approaching iteration budget",
      expect.objectContaining({
        modelCallIndex: 2,
        iterationBudget: 2,
        warningThreshold: 2,
        conversationId: "conv-iteration-budget-warning",
        agentId: "tool-agent",
      }),
    );
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1].systemPrompt).toContain("## Iteration Budget Warning");
    expect(snapshots[1].deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "iteration-budget-warning",
        deltaType: "iteration-budget-warning",
        role: "system",
        metadata: expect.objectContaining({
          currentIteration: 2,
          budget: 2,
        }),
      }),
    ]));
  });

  it("uses bounded tool-loop defaults while preserving the explicit unlimited iteration override", () => {
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolExecutor: createToolExecutor(),
    });
    const unlimitedIterationAgent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolLoopIterationBudget: 0,
      toolExecutor: createToolExecutor(),
    });

    expect((agent as any).opts.toolLoopIterationBudget).toBe(8);
    expect((agent as any).opts.maxToolCalls).toBe(32);
    expect((unlimitedIterationAgent as any).opts.toolLoopIterationBudget).toBe(0);
  });

  it("stops before exceeding the tool-loop iteration budget and force-compacts context", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(createJsonResponse({
      choices: [{
        message: {
          content: "",
          tool_calls: [{
            id: "call-1",
            type: "function",
            function: {
              name: "echo",
              arguments: "{}",
            },
          }],
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const summarizer = vi.fn(async () => "loop-summary");
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolLoopIterationBudget: 1,
      compaction: {
        enabled: true,
        keepRecentCount: 1,
      },
      summarizer,
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function" as const,
          function: {
            name: "echo",
            description: "echo",
            parameters: { type: "object", properties: {} },
          },
        }],
        execute: vi.fn(async () => ({
          id: "call-1",
          name: "echo",
          success: true,
          output: "tool-output",
          durationMs: 0,
        })),
      }),
      logger: {
        error: vi.fn(),
      },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-iteration-budget-stop",
      text: "use tool",
    }));

    const finalItem = items.find((item) => item.type === "final");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(summarizer).toHaveBeenCalledTimes(1);
    expect(items).toContainEqual({
      type: "budget_exhausted",
      budget: "tool_loop_iterations",
      limit: 1,
      observed: 2,
    });
    expect(finalItem?.text).toContain("工具调用迭代预算超限（最大 1 轮）");
    expect(items[items.length - 1]).toEqual({ type: "status", status: "error" });
  });

  it("emits a structured terminal event before rejecting a tool-call batch over budget", async () => {
    const execute = vi.fn(async () => ({
      id: "unexpected",
      name: "echo",
      success: true,
      output: "unexpected",
      durationMs: 0,
    }));
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(createJsonResponse({
      choices: [{
        message: {
          content: "",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "echo", arguments: "{}" },
            },
            {
              id: "call-2",
              type: "function",
              function: { name: "echo", arguments: "{}" },
            },
          ],
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolLoopIterationBudget: 0,
      maxToolCalls: 1,
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function" as const,
          function: {
            name: "echo",
            description: "echo",
            parameters: { type: "object", properties: {} },
          },
        }],
        execute,
      }),
      logger: { error: vi.fn() },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-tool-call-budget-stop",
      text: "use tools",
    }));

    expect(execute).not.toHaveBeenCalled();
    expect(items).toContainEqual({
      type: "budget_exhausted",
      budget: "tool_calls",
      limit: 1,
      observed: 2,
    });
    expect(items.find((item) => item.type === "final")?.text).toContain("工具调用次数超限（最大 1 次）");
    expect(items[items.length - 1]).toEqual({ type: "status", status: "error" });
  });

  it("stops a cost-containment run before dispatching its fifth model call", async () => {
    let responseIndex = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      responseIndex += 1;
      return createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: `call-${responseIndex}`,
              type: "function",
              function: {
                name: "echo",
                arguments: JSON.stringify({ value: responseIndex }),
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    });
    const execute = vi.fn(async (request: { id: string; name: string }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: "ok",
      durationMs: 0,
    }));
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolLoopIterationBudget: 0,
      maxTotalTokens: 24_000,
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function" as const,
          function: {
            name: "echo",
            description: "echo",
            parameters: { type: "object", properties: { value: { type: "number" } } },
          },
        }],
        execute,
      }),
      logger: { error: vi.fn() },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-model-loop-cost-containment",
      text: "keep using tools",
      meta: {
        _agentLaunchSpec: {
          modelLoopBudgetPolicy: "cost-containment-v1",
        },
      },
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(execute).toHaveBeenCalledTimes(4);
    expect(items).toContainEqual({
      type: "budget_exhausted",
      budget: "model_calls",
      limit: 4,
      observed: 5,
      policyId: "cost-containment-v1",
      stage: "before_model_call",
      reasonCode: "model_call_limit",
    });
    expect(items[items.length - 1]).toEqual({ type: "status", status: "error" });
  });

  it("does not consume queued steer input when cost containment blocks the next model call", async () => {
    let responseIndex = 0;
    let steerPending = false;
    let steerDelivered = false;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      responseIndex += 1;
      return createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: `steer-budget-call-${responseIndex}`,
              type: "function",
              function: { name: "echo", arguments: "{}" },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    });
    const execute = vi.fn(async (request: { id: string; name: string }) => {
      if (execute.mock.calls.length === 4) steerPending = true;
      return { id: request.id, name: request.name, success: true, output: "ok", durationMs: 0 };
    });
    const steering = {
      peekPending: vi.fn(() => steerPending
        ? [{ commandId: "steer-after-four", prompt: "apply final correction" }]
        : []),
      consumePending: vi.fn(async () => {
        if (!steerPending) return [];
        steerPending = false;
        steerDelivered = true;
        return [{ commandId: "steer-after-four", prompt: "apply final correction" }];
      }),
      sealIfIdle: vi.fn(() => true),
    };
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolLoopIterationBudget: 0,
      maxTotalTokens: 24_000,
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function" as const,
          function: {
            name: "echo",
            description: "echo",
            parameters: { type: "object", properties: {} },
          },
        }],
        execute,
      }),
      logger: { error: vi.fn() },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-steer-model-loop-cost-containment",
      text: "keep using tools",
      steering,
      meta: { _agentLaunchSpec: { modelLoopBudgetPolicy: "cost-containment-v1" } },
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(execute).toHaveBeenCalledTimes(4);
    expect(steering.consumePending).toHaveBeenCalledTimes(4);
    expect(steerDelivered).toBe(false);
    expect(steerPending).toBe(true);
    expect(items).toContainEqual(expect.objectContaining({
      type: "budget_exhausted",
      budget: "model_calls",
      observed: 5,
    }));
  });

  it("blocks the third file_read before execution only when cost containment is enabled", async () => {
    const buildToolBatch = () => createJsonResponse({
      choices: [{
        message: {
          content: "",
          tool_calls: [1, 2, 3].map((index) => ({
            id: `read-${index}`,
            type: "function",
            function: {
              name: "file_read",
              arguments: JSON.stringify({ path: `src/file-${index}.ts` }),
            },
          })),
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const buildFinal = () => createJsonResponse({
      choices: [{ message: { content: "done" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const definition = {
      type: "function" as const,
      function: {
        name: "file_read",
        description: "read file",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
    };

    const constrainedExecute = vi.fn(async (request: { id: string; name: string }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: "content",
      durationMs: 0,
    }));
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(buildToolBatch());
    const constrained = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolLoopIterationBudget: 0,
      maxTotalTokens: 24_000,
      toolExecutor: createToolExecutor({ getDefinitions: () => [definition], execute: constrainedExecute }),
      logger: { error: vi.fn() },
    });
    const constrainedItems = await collectItems(constrained.run({
      conversationId: "conv-file-read-cost-containment",
      text: "read files",
      meta: { _agentLaunchSpec: { modelLoopBudgetPolicy: "cost-containment-v1" } },
    }));

    expect(constrainedExecute).toHaveBeenCalledTimes(2);
    expect(constrainedItems).toContainEqual({
      type: "budget_exhausted",
      budget: "file_read_calls",
      limit: 2,
      observed: 3,
      policyId: "cost-containment-v1",
      stage: "before_tool_call",
      reasonCode: "file_read_call_limit",
    });

    vi.restoreAllMocks();
    const ordinaryExecute = vi.fn(async (request: { id: string; name: string }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: "content",
      durationMs: 0,
    }));
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(buildToolBatch())
      .mockResolvedValueOnce(buildFinal());
    const ordinary = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolLoopIterationBudget: 0,
      maxTotalTokens: 24_000,
      toolExecutor: createToolExecutor({ getDefinitions: () => [definition], execute: ordinaryExecute }),
      logger: { error: vi.fn() },
    });
    const ordinaryItems = await collectItems(ordinary.run({
      conversationId: "conv-file-read-ordinary",
      text: "read files",
    }));

    expect(ordinaryExecute).toHaveBeenCalledTimes(3);
    expect(ordinaryItems.some((item) => item.type === "budget_exhausted")).toBe(false);
    expect(ordinaryItems.find((item) => item.type === "final")?.text).toBe("done");
  });

  it("allows a high-risk tool when its run budget is configured as unlimited", async () => {
    const execute = vi.fn(async () => ({
      id: "unexpected",
      name: "workspace_write",
      success: true,
      output: "unexpected",
      durationMs: 0,
    }));
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-high-risk",
              type: "function",
              function: { name: "workspace_write", arguments: "{}" },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{ message: { content: "tool completed" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolLoopIterationBudget: 0,
      maxHighRiskToolCalls: 0,
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function" as const,
          function: {
            name: "workspace_write",
            description: "write workspace",
            parameters: { type: "object", properties: {} },
          },
        }],
        getRegisteredToolContract: () => ({
          name: "workspace_write",
          riskLevel: "high",
        }),
        execute,
      }),
      logger: { error: vi.fn() },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-high-risk-budget-stop",
      text: "write workspace",
    }));

    expect(execute).toHaveBeenCalledTimes(1);
    expect(items).not.toContainEqual(expect.objectContaining({
      type: "budget_exhausted",
      budget: "high_risk_tool_calls",
    }));
    expect(items.find((item) => item.type === "final")?.text).toBe("tool completed");
    expect(items[items.length - 1]).toEqual({ type: "status", status: "done" });
  });

  it("only lets a launch spec tighten the configured high-risk tool budget", async () => {
    const execute = vi.fn(async (request: { id: string; name: string }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: "written",
      durationMs: 0,
    }));
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(createJsonResponse({
      choices: [{
        message: {
          content: "",
          tool_calls: [1, 2].map((index) => ({
            id: `call-high-risk-${index}`,
            type: "function",
            function: { name: "workspace_write", arguments: "{}" },
          })),
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolLoopIterationBudget: 0,
      maxHighRiskToolCalls: 4,
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function" as const,
          function: {
            name: "workspace_write",
            description: "write workspace",
            parameters: { type: "object", properties: {} },
          },
        }],
        getRegisteredToolContract: () => ({
          name: "workspace_write",
          riskLevel: "high",
        }),
        execute,
      }),
      logger: { error: vi.fn() },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-launch-high-risk-budget",
      text: "write twice",
      meta: {
        _agentLaunchSpec: {
          maxHighRiskToolCalls: 1,
        },
      },
    }));

    expect(execute).toHaveBeenCalledTimes(1);
    expect(items).toContainEqual({
      type: "budget_exhausted",
      budget: "high_risk_tool_calls",
      limit: 1,
      observed: 2,
    });
  });

  it("emits usage before the structured terminal event when provider token usage exceeds the run budget", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(createJsonResponse({
      choices: [{
        message: { content: "done" },
      }],
      usage: { prompt_tokens: 8, completion_tokens: 3 },
    }));
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      maxTotalTokens: 10,
      toolExecutor: createToolExecutor(),
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-total-token-budget-stop",
      text: "answer briefly",
    }));

    const budgetIndex = items.findIndex((item) => item.type === "budget_exhausted");
    expect(items).toContainEqual({
      type: "budget_exhausted",
      budget: "total_tokens",
      limit: 10,
      observed: 11,
    });
    expect(items[budgetIndex - 1]?.type).toBe("usage");
    expect(items[budgetIndex + 1]).toEqual(expect.objectContaining({ type: "final" }));
    expect(items[budgetIndex + 2]).toEqual({ type: "status", status: "error" });
  });

  it("only lets a launch spec tighten the configured token budget", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(createJsonResponse({
      choices: [{
        message: { content: "done" },
      }],
      usage: { prompt_tokens: 8, completion_tokens: 3 },
    }));
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      maxTotalTokens: 100,
      toolExecutor: createToolExecutor(),
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-launch-token-budget",
      text: "answer briefly",
      meta: {
        _agentLaunchSpec: {
          maxTotalTokens: 10,
        },
      },
    }));

    expect(items).toContainEqual({
      type: "budget_exhausted",
      budget: "total_tokens",
      limit: 10,
      observed: 11,
    });
  });

  it("stops a priced run after its per-run USD budget is exceeded", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(createJsonResponse({
      choices: [{
        message: { content: "done" },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    }));
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      usagePricing: {
        inputUsdPer1M: 1,
        outputUsdPer1M: 1,
      },
      toolExecutor: createToolExecutor(),
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-cost-budget",
      text: "answer briefly",
      meta: {
        _agentLaunchSpec: {
          maxCostUsd: 0.00001,
        },
      },
    }));

    expect(items).toContainEqual(expect.objectContaining({
      type: "budget_exhausted",
      budget: "cost_usd",
      limit: 0.00001,
      observed: 0.00002,
    }));
    expect(items.find((item) => item.type === "final")?.text).toContain("费用预算超限");
  });

  it("fails clearly when a cost-limited run has no pricing information", async () => {
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolExecutor: createToolExecutor(),
    });

    await expect(collectItems(agent.run({
      conversationId: "conv-cost-budget-no-pricing",
      text: "answer briefly",
      meta: {
        _agentLaunchSpec: {
          maxCostUsd: 0.25,
        },
      },
    }))).rejects.toThrow("no valid usage pricing");
  });

  it("aborts a pending model request when the wall-time budget expires", async () => {
    vi.useFakeTimers();
    try {
      let requestSignal: AbortSignal | undefined;
      vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => new Promise((_resolve, reject) => {
        requestSignal = (init as RequestInit).signal ?? undefined;
        const rejectAbort = () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        };
        if (requestSignal?.aborted) {
          rejectAbort();
          return;
        }
        requestSignal?.addEventListener("abort", rejectAbort, { once: true });
      }));
      const agent = new ToolEnabledAgent({
        baseUrl: "https://api.openai.com/v1",
        apiKey: "test-key",
        model: "gpt-test",
        maxRunWallTimeMs: 50,
        toolExecutor: createToolExecutor(),
      });
      const iterator = agent.run({
        conversationId: "conv-wall-time-budget-stop",
        text: "wait for the provider",
      })[Symbol.asyncIterator]();

      expect((await iterator.next()).value).toEqual({ type: "status", status: "running" });
      const firstTerminalItem = iterator.next();
      await vi.advanceTimersByTimeAsync(0);
      expect(requestSignal).toBeDefined();

      await vi.advanceTimersByTimeAsync(50);
      expect(requestSignal?.aborted).toBe(true);
      expect((await firstTerminalItem).value).toEqual(expect.objectContaining({ type: "usage" }));
      expect((await iterator.next()).value).toEqual({
        type: "budget_exhausted",
        budget: "wall_time_ms",
        limit: 50,
        observed: 50,
      });
      expect((await iterator.next()).value).toEqual(expect.objectContaining({ type: "final" }));
      expect((await iterator.next()).value).toEqual({ type: "status", status: "error" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("injects launch-spec role and tool-selection deltas into the effective system prompt", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(createJsonResponse({
      choices: [{
        message: {
          content: "done",
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));

    const snapshots: any[] = [];
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      systemPrompt: "base-system-prompt",
      toolExecutor: createToolExecutor(),
      onPromptSnapshot: (snapshot) => {
        snapshots.push(snapshot);
      },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-launch-spec-deltas",
      text: "hello",
      meta: {
        _agentLaunchSpec: {
          profileId: "coder",
          role: "verifier",
          permissionMode: "confirm",
          allowedToolFamilies: ["workspace-read", "command-exec"],
          maxToolRiskLevel: "high",
          policySummary: "Verification-first run.",
        },
      },
    }));

    expect(items).toContainEqual({ type: "final", text: "done" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const requestInit = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    const payload = JSON.parse(String(requestInit?.body ?? "{}"));
    expect(payload.messages[0]?.content).toContain("## Run Role Override");
    expect(payload.messages[0]?.content).toContain("operate as `verifier`");
    expect(payload.messages[0]?.content).toContain("## Run Tool Selection Constraints");
    expect(payload.messages[0]?.content).toContain("Allowed tool families: workspace-read, command-exec");

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].agentId).toBe("coder");
    expect(snapshots[0].deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        deltaType: "role-execution-policy",
        role: "system",
      }),
      expect.objectContaining({
        deltaType: "tool-selection-policy",
        role: "system",
      }),
    ]));
  });

  it("injects launch-spec team topology into the effective system prompt", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(createJsonResponse({
      choices: [{
        message: {
          content: "done",
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));

    const snapshots: any[] = [];
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      systemPrompt: "base-system-prompt",
      toolExecutor: createToolExecutor(),
      onPromptSnapshot: (snapshot) => {
        snapshots.push(snapshot);
      },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-launch-spec-team-topology",
      text: "hello",
      meta: {
        _agentLaunchSpec: {
          profileId: "coder",
          delegationProtocol: {
            source: "delegate_parallel",
            intent: {
              kind: "parallel_subtasks",
              summary: "Split the patch work across two lanes.",
            },
            contextPolicy: {
              includeParentConversation: true,
              includeStructuredContext: false,
              contextKeys: [],
            },
            expectedDeliverable: {
              format: "patch",
              summary: "Patch lane handoff.",
            },
            aggregationPolicy: {
              mode: "parallel_collect",
              summarizeFailures: true,
            },
            launchDefaults: {},
            team: {
              id: "team-99",
              mode: "parallel_patch",
              sharedGoal: "Split the patch work across two lanes.",
              managerAgentId: "default",
              managerIdentityLabel: "首席执行官 (CEO)",
              currentLaneId: "lane_a",
              memberRoster: [
                {
                  laneId: "lane_a",
                  agentId: "coder",
                  role: "coder",
                  identityLabel: "CTO",
                  authorityRelationToManager: "subordinate",
                  reportsTo: ["首席执行官 (CEO)"],
                  scopeSummary: "Patch lane A only.",
                  handoffTo: ["lane_verify"],
                },
                {
                  laneId: "lane_verify",
                  agentId: "verifier",
                  role: "verifier",
                  identityLabel: "审计",
                  authorityRelationToManager: "peer",
                  scopeSummary: "Review accepted patch lanes.",
                  dependsOn: ["lane_a"],
                },
              ],
            },
          },
        },
      },
    }));

    expect(items).toContainEqual({ type: "final", text: "done" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const requestInit = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    const payload = JSON.parse(String(requestInit?.body ?? "{}"));
    expect(payload.messages[0]?.content).toContain("## Team Topology and Ownership");
    expect(payload.messages[0]?.content).toContain("Team mode: parallel_patch");
    expect(payload.messages[0]?.content).toContain("Manager identity: 首席执行官 (CEO)");
    expect(payload.messages[0]?.content).toContain("Current lane: lane_a");
    expect(payload.messages[0]?.content).toContain("Current lane identity: CTO");
    expect(payload.messages[0]?.content).toContain("Authority relation to manager: subordinate");

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        deltaType: "team-topology-and-ownership",
        role: "system",
      }),
    ]));
    expect(snapshots[0].providerNativeSystemBlocks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        blockType: "dynamic-runtime",
        sourceDeltaIds: expect.arrayContaining([
          "launch-team-topology-lane_a",
        ]),
      }),
    ]));
  });

  it.each(MULTI_PROVIDER_RUNTIME_CASES)(
    "keeps run-level prompt deltas consistent in $label requests and prompt snapshots",
    async ({ baseUrl, responseBody, extractSystemPrompt }) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(createJsonResponse(responseBody));

      const snapshots: any[] = [];
      const agent = new ToolEnabledAgent({
        baseUrl,
        apiKey: "test-key",
        model: "gpt-test",
        systemPrompt: "base-system-prompt",
        toolExecutor: createToolExecutor(),
        onPromptSnapshot: (snapshot) => {
          snapshots.push(snapshot);
        },
      });

      const items = await collectItems(agent.run({
        conversationId: "conv-multi-provider-launch-spec-deltas",
        text: "hello",
        meta: {
          _agentLaunchSpec: {
            profileId: "coder",
            role: "verifier",
            permissionMode: "confirm",
            allowedToolFamilies: ["workspace-read", "command-exec"],
            maxToolRiskLevel: "high",
            policySummary: "Verification-first run.",
          },
        },
      }));

      expect(items).toContainEqual({ type: "final", text: "done" });
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const requestInit = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
      const payload = JSON.parse(String(requestInit?.body ?? "{}"));
      const promptText = extractSystemPrompt(payload);
      expect(promptText).toContain("## Run Role Override");
      expect(promptText).toContain("operate as `verifier`");
      expect(promptText).toContain("## Run Tool Selection Constraints");
      expect(promptText).toContain("Allowed tool families: workspace-read, command-exec");

      if (baseUrl.includes("anthropic.com")) {
        expect(Array.isArray(payload.system)).toBe(true);
        expect(payload.messages.some((message: any) => message.role === "system")).toBe(false);
      }

      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].agentId).toBe("coder");
      expect(snapshots[0].deltas).toEqual(expect.arrayContaining([
        expect.objectContaining({
          deltaType: "role-execution-policy",
          role: "system",
        }),
        expect.objectContaining({
          deltaType: "tool-selection-policy",
          role: "system",
        }),
      ]));
      expect(snapshots[0].providerNativeSystemBlocks).toEqual(expect.arrayContaining([
        expect.objectContaining({
          blockType: "dynamic-runtime",
          sourceDeltaIds: expect.arrayContaining([
            "launch-role-verifier",
            "launch-tool-selection-policy",
          ]),
          cacheControlEligible: false,
        }),
      ]));
    },
  );
});

describe("tool transcript compaction", () => {
  it("removes tool call protocol blocks from assistant history content", () => {
    const input = [
      "Before",
      "<|tool_calls_section_begin|>{\"name\":\"file_write\"}<|tool_calls_section_end|>",
      "After",
    ].join("\n");

    expect(sanitizeAssistantToolCallHistoryContent(input)).toBe("Before\n\n（正在执行操作）\n\nAfter");
  });

  it("compacts oversized reasoning content for history", () => {
    const content = "A".repeat(80) + "B".repeat(80);
    const compacted = compactReasoningContentForHistory(content, 80);

    expect(compacted).toBeDefined();
    expect(compacted).not.toBe(content);
    expect(compacted).toContain("[reasoning truncated");
    expect(compacted!.length).toBeLessThanOrEqual(120);
  });

  it("drops reasoning content when it mostly duplicates visible assistant text", () => {
    const visible = "先读取配置文件，再整理最近三条任务摘要，最后根据结果生成回复。".repeat(8);
    const reasoning = `${visible}\n\n补充说明：内部思考与可见答复基本一致。`;

    expect(compactReasoningContentForHistory(reasoning, 4000, visible)).toBeUndefined();
  });

  it("runs tool_result_persist hook before writing tool transcript history", () => {
    const result = buildToolTranscriptMessageForHistory({
      toolCallId: "call-1",
      toolName: "file_read",
      output: "X".repeat(50),
      success: true,
      hookRunner: {
        runToolResultPersist: () => ({
          message: {
            role: "tool",
            tool_call_id: "call-1",
            content: "trimmed-output",
          },
        }),
      },
    });

    expect(result).toEqual({
      role: "tool",
      tool_call_id: "call-1",
      content: "trimmed-output",
    });
  });
});

describe("compaction observability hooks", () => {
  it("emits loop compaction hook events with enriched observability fields", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(createJsonResponse({
      choices: [{
        message: {
          content: "done",
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const runBeforeCompaction = vi.fn(async () => {});
    const runAfterCompaction = vi.fn(async () => {});
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      maxInputTokens: 120,
      toolExecutor: createToolExecutor(),
      compaction: {
        enabled: true,
        keepRecentCount: 1,
        tokenThreshold: 100,
        triggerFraction: 0.5,
      },
      summarizer: async () => "loop-summary",
      summarizerModelName: "compact-model",
      hookRunner: {
        runBeforeAgentStart: async () => undefined,
        runAgentEnd: async () => {},
        runBeforeToolCall: async () => undefined,
        runAfterToolCall: async () => {},
        runToolResultPersist: () => undefined,
        runBeforeCompaction,
        runAfterCompaction,
      } as any,
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-loop-compaction-hooks",
      text: "继续",
      history: [
        { role: "user", content: "A".repeat(240) },
        { role: "assistant", content: "B".repeat(240) },
        { role: "user", content: "C".repeat(240) },
        { role: "assistant", content: "D".repeat(240) },
      ],
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(items).toContainEqual({ type: "final", text: "done" });
    expect(runBeforeCompaction).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "loop",
        compactionMode: "loop",
        summarizerModel: "compact-model",
      }),
      expect.objectContaining({
        sessionKey: "conv-loop-compaction-hooks",
      }),
    );
    expect(runAfterCompaction).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "loop",
        compactionMode: "loop",
        fallbackUsed: false,
        summarizerModel: "compact-model",
        savedTokenCount: expect.any(Number),
      }),
      expect.objectContaining({
        sessionKey: "conv-loop-compaction-hooks",
      }),
    );
  });

  it("emits microcompact hook events with reclaimed output metrics", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: {
                name: "file_read",
                arguments: "{\"path\":\"src/app.ts\"}",
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "done",
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
    const runBeforeCompaction = vi.fn(async () => {});
    const runAfterCompaction = vi.fn(async () => {});
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function" as const,
          function: {
            name: "file_read",
            description: "read file",
            parameters: { type: "object", properties: { path: { type: "string" } } },
          },
        }],
        execute: vi.fn(async () => ({
          id: "call-1",
          name: "file_read",
          success: true,
          output: "X".repeat(1200),
          durationMs: 0,
        })),
      }),
      microcompact: {
        keepRecentToolMessages: 0,
      },
      hookRunner: {
        runBeforeAgentStart: async () => undefined,
        runAgentEnd: async () => {},
        runBeforeToolCall: async () => undefined,
        runAfterToolCall: async () => {},
        runToolResultPersist: () => undefined,
        runBeforeCompaction,
        runAfterCompaction,
      } as any,
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-microcompact-hooks",
      text: "读取并继续",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(items).toContainEqual({ type: "final", text: "done" });
    expect(runBeforeCompaction).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "microcompact",
        compactionMode: "microcompact",
      }),
      expect.objectContaining({
        sessionKey: "conv-microcompact-hooks",
      }),
    );
    expect(runAfterCompaction).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "microcompact",
        compactionMode: "microcompact",
        fallbackUsed: false,
        reclaimedChars: expect.any(Number),
        savedTokenCount: expect.any(Number),
      }),
      expect.objectContaining({
        sessionKey: "conv-microcompact-hooks",
      }),
    );
  });

  it("keeps prior tool outputs intact when prefix stability protection disables destructive microcompact", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: {
                name: "file_read",
                arguments: "{\"path\":\"src/app.ts\"}",
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "done",
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function" as const,
          function: {
            name: "file_read",
            description: "read file",
            parameters: { type: "object", properties: { path: { type: "string" } } },
          },
        }],
        execute: vi.fn(async () => ({
          id: "call-1",
          name: "file_read",
          success: true,
          output: "X".repeat(1200),
          durationMs: 0,
        })),
      }),
      microcompact: {
        keepRecentToolMessages: 0,
        preservePrefixStability: true,
      },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-prefix-stability",
      text: "读取并继续",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(items).toContainEqual({ type: "final", text: "done" });
    const secondPayload = JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body ?? "{}"));
    const toolMessage = Array.isArray(secondPayload.messages)
      ? secondPayload.messages.find((message: any) => message?.role === "tool")
      : undefined;
    expect(toolMessage?.content).toBe("X".repeat(1200));
    expect(String(toolMessage?.content ?? "")).not.toContain("[old tool output cleared]");
  });

  it("records recent tool results so compacted outputs remain recoverable from conversation store", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: {
                name: "file_read",
                arguments: "{\"path\":\"src/app.ts\"}",
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "done",
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
    const conversationStore = new ConversationStore();
    const recordToolArtifacts = vi.spyOn(conversationStore, "recordToolArtifacts");
    const recordToolDigest = vi.spyOn(conversationStore, "recordToolDigest");
    const recordRecentToolResult = vi.spyOn(conversationStore, "recordRecentToolResult");
    const upsertCarryoverContext = vi.spyOn(conversationStore, "upsertCarryoverContext");
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      conversationStore,
      microcompact: {
        keepRecentToolMessages: 0,
      },
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function" as const,
          function: {
            name: "file_read",
            description: "read file",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string" },
              },
            },
          },
        }],
        execute: vi.fn(async () => ({
          id: "call-1",
          name: "file_read",
          success: true,
          output: "export const answer = 42;\n".repeat(80),
          durationMs: 0,
        })),
      }),
    });

    await collectItems(agent.run({
      conversationId: "conv-recover-tool-result",
      text: "read file",
    }));

    const recent = conversationStore.getRecentToolResults("conv-recover-tool-result", {
      toolCallId: "call-1",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(recordToolArtifacts).toHaveBeenCalledTimes(1);
    expect(recordToolDigest).not.toHaveBeenCalled();
    expect(recordRecentToolResult).not.toHaveBeenCalled();
    expect(upsertCarryoverContext).not.toHaveBeenCalled();
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({
      toolCallId: "call-1",
      toolName: "file_read",
      success: true,
      target: "src/app.ts",
      summary: expect.stringContaining("file_read succeeded"),
    });
    expect(recent[0]?.content).toContain("export const answer = 42");
  });

  it("merges carryover context updates for the same file target instead of stacking duplicate entries", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-file-1",
              type: "function",
              function: {
                name: "file_read",
                arguments: "{\"path\":\"src/app.ts\"}",
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-file-2",
              type: "function",
              function: {
                name: "file_read",
                arguments: "{\"path\":\"src/app.ts\"}",
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "done",
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
    const conversationStore = new ConversationStore();
    const execute = vi.fn()
      .mockResolvedValueOnce({
        id: "call-file-1",
        name: "file_read",
        success: true,
        output: "export const answer = 42;",
        durationMs: 0,
      })
      .mockResolvedValueOnce({
        id: "call-file-2",
        name: "file_read",
        success: true,
        output: "export const answer = 43; // updated",
        durationMs: 0,
      });
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      conversationStore,
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function" as const,
          function: {
            name: "file_read",
            description: "read file",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string" },
              },
            },
          },
        }],
        execute,
      }),
    });

    await collectItems(agent.run({
      conversationId: "conv-carryover-stable-source",
      text: "read file twice",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const carryover = conversationStore.getCarryoverContext("conv-carryover-stable-source");
    expect(carryover).toHaveLength(1);
    expect(carryover[0]).toMatchObject({
      sourceType: "file_read",
      sourceKey: "file_read:src/app.ts",
      title: "file_read: src/app.ts",
    });
    expect(carryover[0]?.summary).toContain("43");
    expect(carryover[0]?.keyFacts).toEqual(expect.arrayContaining([
      expect.stringContaining("target: src/app.ts"),
      expect.stringContaining("result:"),
    ]));
  });

  it("preserves file_read content facts when structured metadata precedes the content", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-file-structured",
              type: "function",
              function: {
                name: "file_read",
                arguments: "{\"path\":\"src/runtime/carryover.ts\"}",
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{ message: { content: "done" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
    const conversationStore = new ConversationStore();
    const fileContent = [
      "export const carryoverLimit = 6;",
      "export const normalizeOldFacts = false;",
      "export const carryoverSourceMode = \"stable\";",
      "",
    ].join("\n");
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      conversationStore,
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function" as const,
          function: {
            name: "file_read",
            description: "read file",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
            },
          },
        }],
        execute: vi.fn(async () => ({
          id: "call-file-structured",
          name: "file_read",
          success: true,
          output: JSON.stringify({
            path: "src/runtime/carryover.ts",
            totalSize: Buffer.byteLength(fileContent),
            bytesRead: Buffer.byteLength(fileContent),
            truncated: false,
            range: { offset: 0, endOffset: Buffer.byteLength(fileContent) },
            encoding: "utf-8",
            revision: "a".repeat(64),
            content: fileContent,
          }),
          durationMs: 0,
        })),
      }),
    });

    await collectItems(agent.run({
      conversationId: "conv-carryover-structured-file-read",
      text: "read structured file",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const carryover = conversationStore.getCarryoverContext("conv-carryover-structured-file-read");
    expect(carryover).toHaveLength(1);
    expect(carryover[0]?.summary).toContain("normalizeOldFacts = false");
    expect(carryover[0]?.keyFacts).toEqual(expect.arrayContaining([
      expect.stringContaining("normalizeOldFacts = false"),
    ]));
  });

  it("uses stable conversation_read source keys based on conversation id and view", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-conversation-read-1",
              type: "function",
              function: {
                name: "conversation_read",
                arguments: JSON.stringify({
                  conversation_id: "conv-123",
                  view: "restore",
                  limit: 10,
                }),
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "done",
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));

    const conversationStore = new ConversationStore();
    const execute = vi.fn(async () => ({
      id: "call-conversation-read-1",
      name: "conversation_read",
      success: true,
      output: "Conversation Restore\nconversation=conv-123\nrestore_source=transcript",
      durationMs: 0,
    }));
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      conversationStore,
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function" as const,
          function: {
            name: "conversation_read",
            description: "read conversation",
            parameters: {
              type: "object",
              properties: {
                conversation_id: { type: "string" },
                view: { type: "string" },
              },
            },
          },
        }],
        execute,
      }),
    });

    await collectItems(agent.run({
      conversationId: "conv-carryover-conversation-read",
      text: "read conversation",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const carryover = conversationStore.getCarryoverContext("conv-carryover-conversation-read");
    expect(carryover).toHaveLength(1);
    expect(carryover[0]).toMatchObject({
      sourceType: "conversation_read",
      sourceKey: "conversation_read:conv-123#restore",
      title: "conversation_read: conv-123#restore",
    });
  });

  it("uses browser pageUrl metadata as the stable carryover source key for browser_get_content", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-browser-read-1",
              type: "function",
              function: {
                name: "browser_get_content",
                arguments: JSON.stringify({
                  format: "markdown",
                }),
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "done",
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));

    const conversationStore = new ConversationStore();
    const execute = vi.fn(async () => ({
      id: "call-browser-read-1",
      name: "browser_get_content",
      success: true,
      output: "# Carryover Article\n\n*Source: https://example.com/article-a*\n\nFACT_BROWSER_DECISION",
      durationMs: 0,
      metadata: {
        pageUrl: "https://example.com/article-a",
        format: "markdown",
      },
    }));
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      conversationStore,
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function" as const,
          function: {
            name: "browser_get_content",
            description: "read page content",
            parameters: {
              type: "object",
              properties: {
                format: { type: "string" },
              },
            },
          },
        }],
        execute,
      }),
    });

    await collectItems(agent.run({
      conversationId: "conv-browser-carryover-source-key",
      text: "read browser article",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const carryover = conversationStore.getCarryoverContext("conv-browser-carryover-source-key");
    expect(carryover).toHaveLength(1);
    expect(carryover[0]).toMatchObject({
      sourceType: "web_result",
      sourceKey: "browser_get_content:https://example.com/article-a",
      title: "browser_get_content: https://example.com/article-a",
    });
  });

  it("uses stable log_search source keys based on query and date range", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-log-search-1",
              type: "function",
              function: {
                name: "log_search",
                arguments: JSON.stringify({
                  query: "spawn EPERM",
                  startDate: "2026-06-25",
                  endDate: "2026-06-26",
                }),
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "done",
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));

    const conversationStore = new ConversationStore();
    const execute = vi.fn(async () => ({
      id: "call-log-search-1",
      name: "log_search",
      success: true,
      output: "[ERROR] spawn EPERM while launching pnpm test",
      durationMs: 0,
    }));
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      conversationStore,
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function" as const,
          function: {
            name: "log_search",
            description: "search logs",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string" },
                startDate: { type: "string" },
                endDate: { type: "string" },
              },
            },
          },
        }],
        execute,
      }),
    });

    await collectItems(agent.run({
      conversationId: "conv-carryover-log-search",
      text: "search logs",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const carryover = conversationStore.getCarryoverContext("conv-carryover-log-search");
    expect(carryover).toHaveLength(1);
    expect(carryover[0]).toMatchObject({
      sourceType: "log_read",
      sourceKey: "log_search:spawn EPERM @ 2026-06-25..2026-06-26",
      title: "log_search: spawn EPERM @ 2026-06-25..2026-06-26",
    });
  });

  it("stores token-aware projected tool args in recent tool results without changing execution args", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-args-1",
              type: "function",
              function: {
                name: "run_command",
                arguments: JSON.stringify({
                  command: "pnpm test --filter extremely-long-package-name --reporter verbose ".repeat(8),
                  cwd: "E:/project/star-sanctuary",
                  files: Array.from({ length: 10 }, (_, index) => `packages/module-${index}/src/file-${index}.ts`),
                  options: {
                    mode: "full",
                    note: "N".repeat(300),
                    nested: {
                      one: {
                        two: {
                          three: "deep-value",
                        },
                      },
                    },
                  },
                }),
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "done",
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));

    const execute = vi.fn(async () => ({
      id: "call-args-1",
      name: "run_command",
      success: true,
      output: "ok",
      durationMs: 0,
    }));
    const conversationStore = new ConversationStore();
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      conversationStore,
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function" as const,
          function: {
            name: "run_command",
            description: "run command",
            parameters: {
              type: "object",
              properties: {
                command: { type: "string" },
                cwd: { type: "string" },
              },
            },
          },
        }],
        execute,
      }),
    });

    await collectItems(agent.run({
      conversationId: "conv-recent-tool-args-projection",
      text: "run command",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(1);
    const executeCalls = execute.mock.calls as Array<Array<{ arguments?: Record<string, unknown> }>>;
    expect(executeCalls[0]?.[0]?.arguments).toMatchObject({
      cwd: "E:/project/star-sanctuary",
      options: {
        mode: "full",
      },
    });

    const recent = conversationStore.getRecentToolResults("conv-recent-tool-args-projection", {
      toolCallId: "call-args-1",
    });
    expect(recent).toHaveLength(1);
    expect(recent[0]?.args).toMatchObject({
      cwd: "E:/project/star-sanctuary",
    });
    expect(String((recent[0]?.args as any)?.command ?? "")).toContain("...");
    expect((recent[0]?.args as any)?.files).toEqual(expect.arrayContaining([
      "packages/module-0/src/file-0.ts",
      "packages/module-5/src/file-5.ts",
      "[+1 more items]",
    ]));
    expect((recent[0]?.args as any)?.options?.note).toContain("...");
    expect((recent[0]?.args as any)?.options?.nested?.one).toBe("[object keys=1]");
  });

  it("does not persist failed empty-string argument templates into recent tool results", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-invalid-1",
              type: "function",
              function: {
                name: "wake_signals_peek",
                arguments: JSON.stringify({
                  queueId: "",
                  actorId: "",
                  sessionId: "",
                  gameId: "",
                }),
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "done",
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));

    const conversationStore = new ConversationStore();
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      conversationStore,
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function" as const,
          function: {
            name: "wake_signals_peek",
            description: "peek",
            parameters: {
              type: "object",
              properties: {
                queueId: { type: "string" },
              },
            },
          },
        }],
        execute: vi.fn(async () => ({
          id: "call-invalid-1",
          name: "wake_signals_peek",
          success: false,
          output: "",
          error: "invalid args",
          failureKind: "input_error",
          durationMs: 0,
        })),
      }),
    });

    await collectItems(agent.run({
      conversationId: "conv-invalid-args",
      text: "peek",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const recent = conversationStore.getRecentToolResults("conv-invalid-args", {
      toolCallId: "call-invalid-1",
    });
    expect(recent).toHaveLength(1);
    expect(recent[0]?.args).toBeUndefined();
  });

  it("skips starweaver active notify preflight for bare automation without changing later normal runs", async () => {
    const previousEnabled = process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_ENABLED;
    const previousInterval = process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS;
    process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_ENABLED = "true";
    process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS = "1000";

    try {
      const fetchSpy = vi.spyOn(globalThis, "fetch")
        .mockResolvedValue(createJsonResponse({
          choices: [{
            message: {
              content: "done",
            },
          }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }));

      const execute = vi.fn(async (request) => {
        if (request.name === "mcp_starweaver_central_agent_wake_notifications") {
          return {
            id: request.id,
            name: request.name,
            success: true,
            output: JSON.stringify({
              items: [{
                recommendedPeek: "command_peek",
                signalKind: "command_available",
                actorId: "actor.player",
                sessionId: "session-actor.player",
                gameId: "star-sanctuary-web-verify",
              }],
            }),
            durationMs: 0,
          };
        }
        if (request.name === "mcp_starweaver_central_starweaver_command_peek") {
          return {
            id: request.id,
            name: request.name,
            success: true,
            output: "{\"messages\":[{\"text\":\"请靠近植物。\"}]}",
            durationMs: 0,
          };
        }
        return {
          id: request.id,
          name: request.name,
          success: true,
          output: "",
          durationMs: 0,
        };
      });

      const conversationStore = new ConversationStore();
      const agent = new ToolEnabledAgent({
        baseUrl: "https://api.openai.com/v1",
        apiKey: "test-key",
        model: "gpt-test",
        toolExecutor: createToolExecutor({
          getDefinitions: () => [
            {
              type: "function" as const,
              function: {
                name: "mcp_starweaver_central_agent_wake_notifications",
                description: "starweaver notifications",
                parameters: { type: "object", properties: {} },
              },
            },
            {
              type: "function" as const,
              function: {
                name: "mcp_starweaver_central_starweaver_command_peek",
                description: "starweaver command peek",
                parameters: { type: "object", properties: {} },
              },
            },
          ],
          execute,
        }),
        conversationStore,
      });

      await collectItems(agent.run({
        conversationId: "conv-starweaver-active-notify",
        text: "bare run",
        automationProfile: "bare",
      }));

      expect(execute).not.toHaveBeenCalled();

      await collectItems(agent.run({
        conversationId: "conv-starweaver-active-notify",
        text: "继续",
      }));

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(execute).toHaveBeenCalledTimes(2);
      expect(execute.mock.calls[0][0].name).toBe("mcp_starweaver_central_agent_wake_notifications");
      expect(execute.mock.calls[1][0].name).toBe("mcp_starweaver_central_starweaver_command_peek");
      const history = conversationStore.getHistory("conv-starweaver-active-notify");
      expect(history.some((item) => item.role === "assistant" && item.content.includes("StarWeaver 有新的主动提示"))).toBe(true);
    } finally {
      if (typeof previousEnabled === "string") {
        process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_ENABLED = previousEnabled;
      } else {
        delete process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_ENABLED;
      }
      if (typeof previousInterval === "string") {
        process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS = previousInterval;
      } else {
        delete process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS;
      }
    }
  });

  it("skips loop compaction when the shared circuit breaker is open", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => createJsonResponse({
      choices: [{
        message: {
          content: "done",
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const tracker = new CompactionRuntimeTracker({
      maxConsecutiveCompactionFailures: 1,
    });
    const summarizer = vi.fn(async () => {
      throw new Error("loop compaction failed");
    });
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      maxInputTokens: 120,
      toolExecutor: createToolExecutor(),
      compaction: {
        enabled: true,
        keepRecentCount: 1,
        tokenThreshold: 100,
        triggerFraction: 0.5,
      },
      summarizer,
      compactionRuntimeTracker: tracker,
    });
    const runInput = {
      conversationId: "conv-loop-compaction-circuit",
      text: "继续",
      history: [
        { role: "user" as const, content: "A".repeat(240) },
        { role: "assistant" as const, content: "B".repeat(240) },
        { role: "user" as const, content: "C".repeat(240) },
        { role: "assistant" as const, content: "D".repeat(240) },
      ],
    };

    const firstItems = await collectItems(agent.run(runInput));
    const secondItems = await collectItems(agent.run({
      ...runInput,
      conversationId: "conv-loop-compaction-circuit-2",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(firstItems).toContainEqual({ type: "final", text: "done" });
    expect(secondItems).toContainEqual({ type: "final", text: "done" });
    expect(summarizer).toHaveBeenCalledTimes(1);
    expect(tracker.getReport()).toMatchObject({
      totals: {
        failures: 1,
        skippedByCircuitBreaker: 1,
      },
    });
  });
});

describe("ToolEnabledAgent hook timeouts", () => {
  it("times out before_agent_start instead of hanging the run", async () => {
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      timeoutMs: 20,
      toolExecutor: createToolExecutor(),
      hookRunner: {
        runBeforeAgentStart: () => new Promise(() => {}),
        runAgentEnd: async () => {},
        runBeforeToolCall: async () => undefined,
        runAfterToolCall: async () => {},
        runToolResultPersist: () => undefined,
      } as any,
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-before-agent-start-timeout",
      text: "hello",
    }));

    expect(items).toEqual([
      { type: "status", status: "error" },
      expect.objectContaining({
        type: "final",
        text: expect.stringContaining("before_agent_start timed out"),
      }),
    ]);
  });

  it("times out after_tool_call hook and still completes the run", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(createJsonResponse({
      choices: [{
        message: {
          content: "",
          tool_calls: [{
            id: "call-1",
            type: "function",
            function: {
              name: "echo",
              arguments: "{}",
            },
          }],
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })).mockResolvedValueOnce(createJsonResponse({
      choices: [{
        message: {
          content: "done",
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const loggerError = vi.fn();
    const toolExecutor = createToolExecutor({
      getDefinitions: () => [{
        type: "function" as const,
        function: {
          name: "echo",
          description: "echo",
          parameters: { type: "object", properties: {} },
        },
      }],
      execute: vi.fn(async () => ({
        id: "call-1",
        name: "echo",
        success: true,
        output: "tool-output",
        durationMs: 0,
      })),
    });
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      timeoutMs: 20,
      toolExecutor,
      logger: { error: loggerError },
      hookRunner: {
        runBeforeAgentStart: async () => undefined,
        runAgentEnd: async () => {},
        runBeforeToolCall: async () => undefined,
        runAfterToolCall: () => new Promise(() => {}),
        runToolResultPersist: () => undefined,
      } as any,
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-after-tool-call-timeout",
      text: "use tool",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(items.some((item) => item.type === "tool_call")).toBe(true);
    expect(items.some((item) => item.type === "tool_result")).toBe(true);
    expect(items[items.length - 1]).toEqual({ type: "status", status: "done" });
    expect(loggerError).toHaveBeenCalledWith(
      "agent",
      expect.stringContaining("after_tool_call"),
      undefined,
    );
  });

  it("converts before_tool_call timeout into tool_result failure instead of emitting a stray final", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(createJsonResponse({
      choices: [{
        message: {
          content: "",
          tool_calls: [{
            id: "call-1",
            type: "function",
            function: {
              name: "echo",
              arguments: "{}",
            },
          }],
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })).mockResolvedValueOnce(createJsonResponse({
      choices: [{
        message: {
          content: "model recovered",
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      timeoutMs: 20,
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function" as const,
          function: {
            name: "echo",
            description: "echo",
            parameters: { type: "object", properties: {} },
          },
        }],
      }),
      hookRunner: {
        runBeforeAgentStart: async () => undefined,
        runAgentEnd: async () => {},
        runBeforeToolCall: () => new Promise(() => {}),
        runAfterToolCall: async () => {},
        runToolResultPersist: () => undefined,
      } as any,
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-before-tool-timeout",
      text: "use tool",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(items.filter((item) => item.type === "final")).toEqual([
      { type: "final", text: "model recovered" },
    ]);
    expect(items).toContainEqual({
      type: "tool_result",
      id: "call-1",
      name: "echo",
      success: false,
      output: "",
      error: expect.stringContaining("before_tool_call timed out"),
    });
    expect(items[items.length - 1]).toEqual({ type: "status", status: "done" });
  });

  it("times out agent_end hook and still clears token counters", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(createJsonResponse({
      choices: [{
        message: {
          content: "all done",
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const clearTokenCounter = vi.fn();
    const loggerError = vi.fn();
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      timeoutMs: 20,
      toolExecutor: createToolExecutor({ clearTokenCounter }),
      logger: { error: loggerError },
      hookRunner: {
        runBeforeAgentStart: async () => undefined,
        runAgentEnd: () => new Promise(() => {}),
        runBeforeToolCall: async () => undefined,
        runAfterToolCall: async () => {},
        runToolResultPersist: () => undefined,
      } as any,
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-agent-end-timeout",
      text: "finish",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(items[items.length - 1]).toEqual({ type: "status", status: "done" });
    expect(clearTokenCounter).toHaveBeenCalledWith("conv-agent-end-timeout");
    expect(loggerError).toHaveBeenCalledWith(
      "agent",
      expect.stringContaining("agent_end"),
      undefined,
    );
  });

  it("repairs truncated tool-call JSON before execution when full repair is enabled", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: {
                name: "file_write",
                arguments: "{\"path\":\"notes.txt\",\"content\":\"hello\"",
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "done",
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
    const execute = vi.fn(async () => ({
      id: "call-1",
      name: "file_write",
      success: true,
      output: "wrote notes.txt",
      durationMs: 0,
    }));
    const loggerWarn = vi.fn();
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolCallRepairLevel: "full",
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function" as const,
          function: {
            name: "file_write",
            description: "write file",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string" },
                content: { type: "string" },
              },
            },
          },
        }],
        execute,
      }),
      logger: {
        warn: loggerWarn,
        error: vi.fn(),
      },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-tool-call-repair",
      text: "write file",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(items).toContainEqual({ type: "final", text: "done" });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "call-1",
        name: "file_write",
        arguments: {
          path: "notes.txt",
          content: "hello",
        },
      }),
      "conv-tool-call-repair",
      "tool-agent",
      undefined,
      undefined,
      undefined,
      expect.objectContaining({
        abortSignal: expect.any(AbortSignal),
      }),
    );
    expect(loggerWarn).toHaveBeenCalledWith(
      "agent",
      "[tool-call-repair] repaired truncated tool arguments",
      expect.objectContaining({
        toolName: "file_write",
        toolCallId: "call-1",
        conversationId: "conv-tool-call-repair",
        agentId: "tool-agent",
      }),
    );
  });

  it("suppresses consecutive duplicate tool calls when there is no previous successful result to reuse", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: {
                name: "echo",
                arguments: "{\"value\":\"same\"}",
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-2",
              type: "function",
              function: {
                name: "echo",
                arguments: "{\"value\":\"same\"}",
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "recovered",
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
    const execute = vi.fn(async () => ({
      id: "call-1",
      name: "echo",
      success: false,
      output: "",
      error: "tool failed",
      failureKind: "business_logic_error" as const,
      durationMs: 0,
    }));
    const loggerWarn = vi.fn();
    const conversationStore = new ConversationStore();
    const recordToolArtifacts = vi.spyOn(conversationStore, "recordToolArtifacts");
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolCallRepairLevel: "dedupe",
      conversationStore,
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function" as const,
          function: {
            name: "echo",
            description: "echo",
            parameters: {
              type: "object",
              properties: {
                value: { type: "string" },
              },
            },
          },
        }],
        execute,
      }),
      logger: {
        warn: loggerWarn,
        error: vi.fn(),
      },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-tool-call-dedupe",
      text: "use tool",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(recordToolArtifacts).toHaveBeenCalledTimes(2);
    expect(recordToolArtifacts).toHaveBeenLastCalledWith(
      "conv-tool-call-dedupe",
      expect.objectContaining({
        recentToolResult: expect.objectContaining({
          toolCallId: "call-2",
          isSynthetic: true,
        }),
      }),
    );
    expect(items).toContainEqual({
      type: "tool_result",
      id: "call-2",
      name: "echo",
      success: false,
      output: "",
      error: expect.stringContaining("连续重复的相同调用"),
      failureKind: "business_logic_error",
      metadata: expect.objectContaining({
        repairAction: "duplicate_tool_call_suppressed",
        duplicateCount: 1,
      }),
    });
    expect(items).toContainEqual({ type: "final", text: "recovered" });
    expect(loggerWarn).toHaveBeenCalledWith(
      "agent",
      "[tool-call-repair] suppressed duplicate tool call",
      expect.objectContaining({
        toolName: "echo",
        toolCallId: "call-2",
        duplicateCount: 1,
        conversationId: "conv-tool-call-dedupe",
        agentId: "tool-agent",
      }),
    );
  });

  it("reuses the previous successful tool result for consecutive duplicate tool calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: {
                name: "echo",
                arguments: "{\"value\":\"same\"}",
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-2",
              type: "function",
              function: {
                name: "echo",
                arguments: "{\"value\":\"same\"}",
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "recovered",
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
    const execute = vi.fn(async () => ({
      id: "call-1",
      name: "echo",
      success: true,
      output: "tool-output",
      durationMs: 0,
    }));
    const loggerWarn = vi.fn();
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolCallRepairLevel: "dedupe",
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function" as const,
          function: {
            name: "echo",
            description: "echo",
            parameters: {
              type: "object",
              properties: {
                value: { type: "string" },
              },
            },
          },
        }],
        execute,
      }),
      logger: {
        warn: loggerWarn,
        error: vi.fn(),
      },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-tool-call-reuse",
      text: "use tool",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(items).toContainEqual({
      type: "tool_result",
      id: "call-2",
      name: "echo",
      success: true,
      output: "tool-output",
      metadata: expect.objectContaining({
        repairAction: "duplicate_tool_call_reused_recent_result",
        previousToolCallId: "call-1",
      }),
    });
    expect(items).toContainEqual({ type: "final", text: "recovered" });
    expect(loggerWarn).toHaveBeenCalledWith(
      "agent",
      "[tool-call-repair] reused recent successful duplicate tool result",
      expect.objectContaining({
        toolName: "echo",
        toolCallId: "call-2",
        previousToolCallId: "call-1",
        duplicateCount: 1,
        conversationId: "conv-tool-call-reuse",
        agentId: "tool-agent",
      }),
    );
  });

  it("suppresses near-duplicate tool calls when full repair is enabled", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: {
                name: "echo",
                arguments: "{\"value\":\"hello world\"}",
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-2",
              type: "function",
              function: {
                name: "echo",
                arguments: "{\"value\":\"hello   world\"}",
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "recovered",
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
    const execute = vi.fn(async () => ({
      id: "call-1",
      name: "echo",
      success: false,
      output: "",
      error: "first failed",
      failureKind: "business_logic_error" as const,
      durationMs: 0,
    }));
    const loggerWarn = vi.fn();
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolCallRepairLevel: "full",
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function" as const,
          function: {
            name: "echo",
            description: "echo",
            parameters: {
              type: "object",
              properties: {
                value: { type: "string" },
              },
            },
          },
        }],
        execute,
      }),
      logger: {
        warn: loggerWarn,
        error: vi.fn(),
      },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-tool-call-near-duplicate",
      text: "use tool",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(items).toContainEqual({
      type: "tool_result",
      id: "call-2",
      name: "echo",
      success: false,
      output: "",
      error: expect.stringContaining("近重复调用"),
      failureKind: "business_logic_error",
      metadata: expect.objectContaining({
        repairAction: "near_duplicate_tool_call_suppressed",
      }),
    });
    expect(loggerWarn).toHaveBeenCalledWith(
      "agent",
      "[tool-call-repair] suppressed near-duplicate tool call",
      expect.objectContaining({
        toolName: "echo",
        toolCallId: "call-2",
        conversationId: "conv-tool-call-near-duplicate",
        agentId: "tool-agent",
      }),
    );
  });

  it("suppresses cross-tool thrashing when the model bounces back to the previous tool with the same sub-problem", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: {
                name: "tool_search",
                arguments: "{\"query\":\"goal checkpoint\"}",
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-2",
              type: "function",
              function: {
                name: "goal_checkpoint_request",
                arguments: "{\"query\":\"goal checkpoint\"}",
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-3",
              type: "function",
              function: {
                name: "tool_search",
                arguments: "{\"query\":\"goal checkpoint\"}",
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "recovered",
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
    const execute = vi.fn(async (request: any) => ({
      id: request.id ?? "",
      name: request.name,
      success: false,
      output: "",
      error: "not enough progress",
      failureKind: "business_logic_error" as const,
      durationMs: 0,
    }));
    const loggerWarn = vi.fn();
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolCallRepairLevel: "full",
      toolExecutor: createToolExecutor({
        getDefinitions: () => [
          {
            type: "function" as const,
            function: {
              name: "tool_search",
              description: "search",
              parameters: {
                type: "object",
                properties: {
                  query: { type: "string" },
                },
              },
            },
          },
          {
            type: "function" as const,
            function: {
              name: "goal_checkpoint_request",
              description: "goal checkpoint",
              parameters: {
                type: "object",
                properties: {
                  query: { type: "string" },
                },
              },
            },
          },
        ],
        execute,
      }),
      logger: {
        warn: loggerWarn,
        error: vi.fn(),
      },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-cross-tool-thrash",
      text: "use tool",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(items).toContainEqual({
      type: "tool_result",
      id: "call-3",
      name: "tool_search",
      success: false,
      output: "",
      error: expect.stringContaining("跨工具抖动"),
      failureKind: "business_logic_error",
      metadata: expect.objectContaining({
        repairAction: "cross_tool_thrash_suppressed",
        partnerToolName: "goal_checkpoint_request",
      }),
    });
    expect(loggerWarn).toHaveBeenCalledWith(
      "agent",
      "[tool-call-repair] suppressed cross-tool thrashing",
      expect.objectContaining({
        toolName: "tool_search",
        toolCallId: "call-3",
        partnerToolName: "goal_checkpoint_request",
        conversationId: "conv-cross-tool-thrash",
        agentId: "tool-agent",
      }),
    );
  });

  it("passes launchSpec runtime context into tool definitions and execution", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(createJsonResponse({
      choices: [{
        message: {
          content: "",
          tool_calls: [{
            id: "call-1",
            type: "function",
            function: {
              name: "echo",
              arguments: "{}",
            },
          }],
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })).mockResolvedValueOnce(createJsonResponse({
      choices: [{
        message: {
          content: "done",
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const getDefinitions = vi.fn(() => [{
      type: "function" as const,
      function: {
        name: "echo",
        description: "echo",
        parameters: { type: "object", properties: {} },
      },
    }]);
    const execute = vi.fn(async () => ({
      id: "call-1",
      name: "echo",
      success: true,
      output: "tool-output",
      durationMs: 0,
    }));
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      timeoutMs: 20,
      toolExecutor: createToolExecutor({
        getDefinitions,
        execute,
      }),
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-launch-spec",
      text: "use tool",
      meta: {
        _agentLaunchSpec: {
          cwd: "/tmp/worktree",
          toolSet: ["echo"],
          permissionMode: "confirm",
          bridgeSubtask: {
            kind: "patch",
            targetId: "codex_exec",
            action: "patch",
            goalId: "goal-launch-spec",
            goalNodeId: "node-patch",
          },
        },
        _toolRequestChannel: "web",
        runId: "gateway-message-run-1",
      },
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(items).toContainEqual({ type: "final", text: "done" });
    expect(getDefinitions).toHaveBeenCalledWith("tool-agent", "conv-launch-spec", {
      launchSpec: {
        cwd: "/tmp/worktree",
        toolSet: ["echo"],
        permissionMode: "confirm",
        bridgeSubtask: {
          kind: "patch",
          targetId: "codex_exec",
          action: "patch",
          goalId: "goal-launch-spec",
          goalNodeId: "node-patch",
        },
      },
      channel: "web",
      agentRunId: "gateway-message-run-1",
      workspaceRevisionId: "gateway-message-run-1",
    });
    expect(execute).toHaveBeenCalledWith(
      expect.anything(),
      "conv-launch-spec",
      "tool-agent",
      undefined,
      undefined,
      undefined,
      expect.objectContaining({
        launchSpec: {
          cwd: "/tmp/worktree",
          toolSet: ["echo"],
          permissionMode: "confirm",
          bridgeSubtask: {
            kind: "patch",
            targetId: "codex_exec",
            action: "patch",
            goalId: "goal-launch-spec",
            goalNodeId: "node-patch",
          },
        },
        channel: "web",
        agentRunId: "gateway-message-run-1",
        workspaceRevisionId: "gateway-message-run-1",
        abortSignal: expect.any(AbortSignal),
      }),
    );
  });

  it("injects tool failure recovery guidance into the next model call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: {
                name: "echo",
                arguments: "{}",
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "recovered",
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
    const toolExecutor = createToolExecutor({
      getDefinitions: () => [{
        type: "function" as const,
        function: {
          name: "echo",
          description: "echo",
          parameters: { type: "object", properties: {} },
        },
      }],
      execute: vi.fn(async () => ({
        id: "call-1",
        name: "echo",
        success: false,
        output: "",
        error: "Permission denied by launch policy",
        durationMs: 0,
      })),
    });
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolExecutor,
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-tool-failure-recovery",
      text: "use tool",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(items).toContainEqual({ type: "final", text: "recovered" });

    const firstPayload = JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.body ?? "{}"));
    const secondPayload = JSON.parse(String((fetchSpy.mock.calls[1]?.[1] as RequestInit | undefined)?.body ?? "{}"));

    expect(firstPayload.messages[0]?.content).not.toContain("## Tool Failure Recovery");
    expect(secondPayload.messages[0]?.content).toContain("## Tool Failure Recovery");
    expect(secondPayload.messages[0]?.content).toContain("Failed tool: `echo`");
    expect(secondPayload.messages[0]?.content).toContain("Failure class: permission_or_policy");
  });

  it("injects post-action verification guidance after successful write tools", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: {
                name: "file_write",
                arguments: "{\"path\":\"notes.txt\",\"content\":\"hello\"}",
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "write complete",
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
    const toolExecutor = createToolExecutor({
      getDefinitions: () => [{
        type: "function" as const,
        function: {
          name: "file_write",
          description: "write file",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string" },
            },
          },
        },
      }],
      execute: vi.fn(async () => ({
        id: "call-1",
        name: "file_write",
        success: true,
        output: "wrote notes.txt",
        durationMs: 0,
      })),
    });
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolExecutor,
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-tool-post-verification",
      text: "write the file",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(items).toContainEqual({ type: "final", text: "write complete" });

    const secondPayload = JSON.parse(String((fetchSpy.mock.calls[1]?.[1] as RequestInit | undefined)?.body ?? "{}"));
    expect(secondPayload.messages[0]?.content).toContain("## Tool Post-Action Verification");
    expect(secondPayload.messages[0]?.content).toContain("Tool: `file_write`");
    expect(secondPayload.messages[0]?.content).toContain("Verify the effect before claiming success");
  });

  it("injects delegation result review guidance after delegated work returns", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: {
                name: "delegate_task",
                arguments: JSON.stringify({
                  agent_id: "verifier",
                  instruction: "Review the runtime prompt changes.",
                  ownership: {
                    scope_summary: "Review the runtime prompt changes only.",
                    out_of_scope: ["Implement fixes"],
                  },
                  acceptance: {
                    done_definition: "Returned result states whether the prompt changes are acceptable.",
                    verification_hints: ["Check findings", "Check missing tests"],
                  },
                  deliverable_contract: {
                    format: "verification_report",
                    required_sections: ["Findings", "Recommendation"],
                  },
                }),
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "delegation reviewed",
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
    const toolExecutor = createToolExecutor({
      getDefinitions: () => [{
        type: "function" as const,
        function: {
          name: "delegate_task",
          description: "delegate",
          parameters: { type: "object", properties: {} },
        },
      }],
      execute: vi.fn(async () => ({
        id: "call-1",
        name: "delegate_task",
        success: true,
        output: "worker finished",
        durationMs: 0,
      })),
    });
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolExecutor,
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-delegation-review",
      text: "delegate and review",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(items).toContainEqual({ type: "final", text: "delegation reviewed" });

    const secondPayload = JSON.parse(String((fetchSpy.mock.calls[1]?.[1] as RequestInit | undefined)?.body ?? "{}"));
    expect(secondPayload.messages[0]?.content).toContain("## Delegation Result Review");
    expect(secondPayload.messages[0]?.content).toContain("Owned scope: Review the runtime prompt changes only.");
    expect(secondPayload.messages[0]?.content).toContain("Done definition: Returned result states whether the prompt changes are acceptable.");
    expect(secondPayload.messages[0]?.content).toContain("Deliverable contract: verification_report | sections: Findings | Recommendation");
  });

  it("captures the latest prompt snapshot with structured delegation gate metadata after a gate rejection", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: {
                name: "delegate_task",
                arguments: JSON.stringify({
                  agent_id: "verifier",
                  instruction: "Review the runtime prompt changes.",
                  deliverable_contract: {
                    format: "verification_report",
                  },
                }),
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "delegation follow-up ready",
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
    const snapshots: any[] = [];
    const toolExecutor = createToolExecutor({
      getDefinitions: () => [{
        type: "function" as const,
        function: {
          name: "delegate_task",
          description: "delegate",
          parameters: { type: "object", properties: {} },
        },
      }],
      execute: vi.fn(async () => ({
        id: "call-1",
        name: "delegate_task",
        success: false,
        output: "worker finished",
        error: "Delegation acceptance gate rejected the sub-agent result. Verification report is missing a recommendation or verdict section.",
        durationMs: 0,
        metadata: {
          delegationResults: [{
            label: "Agent verifier",
            workerSuccess: true,
            accepted: false,
            acceptanceGate: {
              enforced: true,
              accepted: false,
              summary: "Delegated result failed the structured acceptance gate: Verification report is missing a recommendation or verdict section.",
              reasons: ["Verification report is missing a recommendation or verdict section."],
              deliverableFormat: "verification_report",
              acceptanceCheckStatus: "not_requested",
              rejectionConfidence: "high",
              managerActionHint: "reject this handoff and re-delegate with explicit section requirements or a clearer deliverable contract.",
              contractSpecificChecks: [
                {
                  id: "verification_report_findings",
                  label: "Verification report is missing a findings section.",
                  status: "passed",
                  enforced: true,
                  evidence: "Findings",
                },
                {
                  id: "verification_report_recommendation",
                  label: "Verification report is missing a recommendation or verdict section.",
                  status: "failed",
                  enforced: true,
                },
              ],
            },
          }],
          acceptedCount: 0,
          gateRejectedCount: 1,
          workerSuccessCount: 1,
          followUpStrategy: {
            mode: "single",
            summary: "Suggested next step: retry with follow-up delegation: Agent verifier.",
            recommendedRuntimeAction: "retry_delegation",
            retryLabels: ["Agent verifier"],
            highPriorityLabels: ["Agent verifier"],
            verifierHandoffLabels: ["Agent verifier"],
            items: [
              {
                label: "Agent verifier",
                action: "retry",
                reason: "reject this handoff and re-delegate with explicit section requirements or a clearer deliverable contract.",
                recommendedRuntimeAction: "retry_delegation",
                priority: "high",
                template: {
                  toolName: "delegate_task",
                  agentId: "verifier",
                  instruction: "Review the runtime prompt changes.\n\nFollow-up requirement: Delegated result failed the structured acceptance gate: Verification report is missing a recommendation or verdict section.",
                  acceptance: {
                    verificationHints: ["Check findings", "Check missing tests"],
                  },
                  deliverableContract: {
                    format: "verification_report",
                    requiredSections: ["Findings", "Recommendation"],
                  },
                },
                verifierTemplate: {
                  toolName: "delegate_task",
                  agentId: "verifier",
                  instruction: "Verify whether the delegated runtime prompt review is safe to accept.",
                  acceptance: {
                    verificationHints: ["Check findings", "Check missing tests"],
                  },
                  deliverableContract: {
                    format: "verification_report",
                    requiredSections: ["Findings", "Recommendation"],
                  },
                },
                verificationHints: ["Check findings", "Check missing tests"],
              },
            ],
          },
        },
      })),
    });
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolExecutor,
      onPromptSnapshot: (snapshot) => {
        snapshots.push(snapshot);
      },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-gate-metadata-snapshot",
      text: "delegate and check",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(items).toContainEqual({ type: "final", text: "delegation follow-up ready" });
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1].systemPrompt).toContain("## Delegation Result Review");
    expect(snapshots[1].systemPrompt).toContain("## Suggested Follow-Up Strategy");
    expect(snapshots[1].systemPrompt).toContain("Recommended runtime action: retry_delegation");
    expect(snapshots[1].systemPrompt).toContain("High-priority follow-up: Agent verifier");
    expect(snapshots[1].systemPrompt).toContain("Optional verifier handoff: delegate_task; agent_id=verifier");
    expect(snapshots[1].deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        deltaType: "tool-failure-recovery",
        metadata: expect.objectContaining({
          delegationResult: expect.objectContaining({
            resultCount: 1,
            primaryResult: expect.objectContaining({
              acceptanceGate: expect.objectContaining({
                accepted: false,
                deliverableFormat: "verification_report",
                rejectionConfidence: "high",
              }),
            }),
          }),
        }),
      }),
      expect.objectContaining({
        deltaType: "tool-post-verification",
        metadata: expect.objectContaining({
          reviewMode: "delegation-result",
          delegationResult: expect.objectContaining({
            resultCount: 1,
            primaryResult: expect.objectContaining({
              acceptanceGate: expect.objectContaining({
                managerActionHint: "reject this handoff and re-delegate with explicit section requirements or a clearer deliverable contract.",
              }),
            }),
            followUpStrategy: expect.objectContaining({
              mode: "single",
              recommendedRuntimeAction: "retry_delegation",
              itemCount: 1,
              retryLabels: ["Agent verifier"],
              highPriorityLabels: ["Agent verifier"],
              verifierHandoffLabels: ["Agent verifier"],
            }),
          }),
        }),
      }),
    ]));
  });

  it("injects team handoff and fan-in guidance into the next model call after parallel delegation", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: {
                name: "delegate_parallel",
                arguments: JSON.stringify({
                  tasks: [
                    { instruction: "Implement lane A", agent_id: "coder" },
                    { instruction: "Verify lane A", agent_id: "verifier" },
                  ],
                }),
              },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "team fan-in reviewed",
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
    const snapshots: any[] = [];
    const toolExecutor = createToolExecutor({
      getDefinitions: () => [{
        type: "function" as const,
        function: {
          name: "delegate_parallel",
          description: "delegate in parallel",
          parameters: { type: "object", properties: {} },
        },
      }],
      execute: vi.fn(async () => ({
        id: "call-1",
        name: "delegate_parallel",
        success: true,
        output: "parallel done",
        durationMs: 0,
        metadata: {
          delegationResults: [
            {
              label: "Task 1 / coder",
              laneId: "lane_1",
              scopeSummary: "Own lane A implementation only.",
              handoffTo: ["lane_2"],
              workerSuccess: true,
              accepted: true,
              acceptanceGate: {
                enforced: false,
                accepted: true,
                summary: "Delegated result passed the structured acceptance gate.",
                reasons: [],
                acceptanceCheckStatus: "not_requested",
              },
            },
            {
              label: "Task 2 / verifier",
              laneId: "lane_2",
              dependsOn: ["lane_1"],
              workerSuccess: true,
              accepted: false,
              acceptanceGate: {
                enforced: true,
                accepted: false,
                summary: "Delegated result failed the structured acceptance gate: Missing required sections: Recommendation",
                reasons: ["Missing required sections: Recommendation"],
                acceptanceCheckStatus: "missing",
                rejectionConfidence: "high",
                managerActionHint: "reject this handoff and re-delegate with explicit section requirements or a clearer deliverable contract.",
              },
            },
          ],
          followUpStrategy: {
            mode: "parallel",
            summary: "Parallel fan-in strategy: accept now: Task 1 / coder; retry with follow-up delegation: Task 2 / verifier.",
            recommendedRuntimeAction: "retry_delegation",
            acceptedLabels: ["Task 1 / coder"],
            retryLabels: ["Task 2 / verifier"],
            verifierHandoffLabels: ["Task 2 / verifier"],
            items: [
              {
                label: "Task 1 / coder",
                action: "accept",
                reason: "Delegated result passed the acceptance gate.",
                recommendedRuntimeAction: "accept_result",
                priority: "normal",
              },
              {
                label: "Task 2 / verifier",
                action: "retry",
                reason: "reject this handoff and re-delegate with explicit section requirements or a clearer deliverable contract.",
                recommendedRuntimeAction: "retry_delegation",
                priority: "high",
              },
            ],
          },
          team: {
            id: "team-22",
            mode: "parallel_subtasks",
            sharedGoal: "Implement lane A and verify it before manager fan-in.",
            managerAgentId: "default",
            memberRoster: [
              {
                laneId: "lane_1",
                agentId: "coder",
                role: "coder",
                scopeSummary: "Own lane A implementation only.",
                handoffTo: ["lane_2"],
              },
              {
                laneId: "lane_2",
                agentId: "verifier",
                role: "verifier",
                dependsOn: ["lane_1"],
              },
            ],
          },
        },
      })),
    });
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolExecutor,
      onPromptSnapshot: (snapshot) => {
        snapshots.push(snapshot);
      },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-team-fan-in-follow-up",
      text: "delegate parallel work",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(items).toContainEqual({ type: "final", text: "team fan-in reviewed" });
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1].systemPrompt).toContain("## Team Handoff Review");
    expect(snapshots[1].systemPrompt).toContain("Active handoff lanes: Task 1 / coder -> lane_2");
    expect(snapshots[1].systemPrompt).toContain("## Team Fan-In Triage");
    expect(snapshots[1].systemPrompt).toContain("Safe to integrate now: Task 1 / coder");
    expect(snapshots[1].systemPrompt).toContain("Needs retry or re-delegation: Task 2 / verifier");
    expect(snapshots[1].systemPrompt).toContain("## Team Completion Gate");
    expect(snapshots[1].systemPrompt).toContain("Final fan-in verdict: hold_fan_in");
    expect(snapshots[1].deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        deltaType: "team-handoff-review",
        metadata: expect.objectContaining({
          teamId: "team-22",
          teamMode: "parallel_subtasks",
        }),
      }),
      expect.objectContaining({
        deltaType: "team-fan-in-triage",
        metadata: expect.objectContaining({
          teamId: "team-22",
          recommendedRuntimeAction: "retry_delegation",
        }),
      }),
      expect.objectContaining({
        deltaType: "team-completion-gate",
        metadata: expect.objectContaining({
          teamId: "team-22",
          completionGate: expect.objectContaining({
            status: "pending",
            finalFanInVerdict: "hold_fan_in",
          }),
        }),
      }),
    ]));
  });

  it("injects tool failure recovery guidance into the next Anthropic model call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        content: [{
          type: "tool_use",
          id: "call-1",
          name: "echo",
          input: {},
        }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "tool_use",
      }))
      .mockResolvedValueOnce(createJsonResponse({
        content: [{
          type: "text",
          text: "recovered",
        }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "end_turn",
      }));
    const toolExecutor = createToolExecutor({
      getDefinitions: () => [{
        type: "function" as const,
        function: {
          name: "echo",
          description: "echo",
          parameters: { type: "object", properties: {} },
        },
      }],
      execute: vi.fn(async () => ({
        id: "call-1",
        name: "echo",
        success: false,
        output: "",
        error: "Permission denied by launch policy",
        durationMs: 0,
      })),
    });
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.anthropic.com",
      apiKey: "test-key",
      model: "claude-test",
      toolExecutor,
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-anthropic-tool-failure-recovery",
      text: "use tool",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(items).toContainEqual({ type: "final", text: "recovered" });

    const firstPayload = JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.body ?? "{}"));
    const secondPayload = JSON.parse(String((fetchSpy.mock.calls[1]?.[1] as RequestInit | undefined)?.body ?? "{}"));
    const firstSystemText = Array.isArray(firstPayload.system)
      ? firstPayload.system.map((block: any) => String(block?.text ?? "")).join("\n\n")
      : "";
    const secondSystemText = Array.isArray(secondPayload.system)
      ? secondPayload.system.map((block: any) => String(block?.text ?? "")).join("\n\n")
      : "";

    expect(firstSystemText).not.toContain("## Tool Failure Recovery");
    expect(secondSystemText).toContain("## Tool Failure Recovery");
    expect(secondSystemText).toContain("Failed tool: `echo`");
    expect(secondSystemText).toContain("Failure class: permission_or_policy");
    expect(secondPayload.messages.some((message: any) => message.role === "system")).toBe(false);
  });

  it("injects post-action verification guidance into the next Anthropic model call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        content: [{
          type: "tool_use",
          id: "call-1",
          name: "file_write",
          input: { path: "notes.txt", content: "hello" },
        }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "tool_use",
      }))
      .mockResolvedValueOnce(createJsonResponse({
        content: [{
          type: "text",
          text: "write complete",
        }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "end_turn",
      }));
    const toolExecutor = createToolExecutor({
      getDefinitions: () => [{
        type: "function" as const,
        function: {
          name: "file_write",
          description: "write file",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string" },
            },
          },
        },
      }],
      execute: vi.fn(async () => ({
        id: "call-1",
        name: "file_write",
        success: true,
        output: "wrote notes.txt",
        durationMs: 0,
      })),
    });
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.anthropic.com",
      apiKey: "test-key",
      model: "claude-test",
      toolExecutor,
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-anthropic-tool-post-verification",
      text: "write the file",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(items).toContainEqual({ type: "final", text: "write complete" });

    const secondPayload = JSON.parse(String((fetchSpy.mock.calls[1]?.[1] as RequestInit | undefined)?.body ?? "{}"));
    const secondSystemText = Array.isArray(secondPayload.system)
      ? secondPayload.system.map((block: any) => String(block?.text ?? "")).join("\n\n")
      : "";

    expect(secondSystemText).toContain("## Tool Post-Action Verification");
    expect(secondSystemText).toContain("Tool: `file_write`");
    expect(secondSystemText).toContain("Verify the effect before claiming success");
  });

  it("injects delegation result review guidance into the next Anthropic model call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        content: [{
          type: "tool_use",
          id: "call-1",
          name: "delegate_task",
          input: {
            agent_id: "verifier",
            instruction: "Review the runtime prompt changes.",
            ownership: {
              scope_summary: "Review the runtime prompt changes only.",
              out_of_scope: ["Implement fixes"],
            },
            acceptance: {
              done_definition: "Returned result states whether the prompt changes are acceptable.",
              verification_hints: ["Check findings", "Check missing tests"],
            },
            deliverable_contract: {
              format: "verification_report",
              required_sections: ["Findings", "Recommendation"],
            },
          },
        }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "tool_use",
      }))
      .mockResolvedValueOnce(createJsonResponse({
        content: [{
          type: "text",
          text: "delegation reviewed",
        }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "end_turn",
      }));
    const toolExecutor = createToolExecutor({
      getDefinitions: () => [{
        type: "function" as const,
        function: {
          name: "delegate_task",
          description: "delegate",
          parameters: { type: "object", properties: {} },
        },
      }],
      execute: vi.fn(async () => ({
        id: "call-1",
        name: "delegate_task",
        success: true,
        output: "worker finished",
        durationMs: 0,
      })),
    });
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.anthropic.com",
      apiKey: "test-key",
      model: "claude-test",
      toolExecutor,
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-anthropic-delegation-review",
      text: "delegate and review",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(items).toContainEqual({ type: "final", text: "delegation reviewed" });

    const secondPayload = JSON.parse(String((fetchSpy.mock.calls[1]?.[1] as RequestInit | undefined)?.body ?? "{}"));
    const secondSystemText = Array.isArray(secondPayload.system)
      ? secondPayload.system.map((block: any) => String(block?.text ?? "")).join("\n\n")
      : "";

    expect(secondSystemText).toContain("## Delegation Result Review");
    expect(secondSystemText).toContain("Owned scope: Review the runtime prompt changes only.");
    expect(secondSystemText).toContain("Done definition: Returned result states whether the prompt changes are acceptable.");
    expect(secondSystemText).toContain("Deliverable contract: verification_report | sections: Findings | Recommendation");
  });

  it("serializes concurrent runs for the same conversation", async () => {
    let releaseFirstFetch!: () => void;
    const firstFetchPending = new Promise<void>((resolve) => {
      releaseFirstFetch = resolve;
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => {
        await firstFetchPending;
        return createJsonResponse({
          choices: [{ message: { content: "first done" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        });
      })
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{ message: { content: "second done" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));

    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      timeoutMs: 50,
      toolExecutor: createToolExecutor(),
    });

    const run1 = collectItems(agent.run({
      conversationId: "conv-serialized",
      text: "first",
    }));
    await Promise.resolve();
    const run2 = collectItems(agent.run({
      conversationId: "conv-serialized",
      text: "second",
    }));

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    releaseFirstFetch();
    const [items1, items2] = await Promise.all([run1, run2]);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(items1).toContainEqual({ type: "final", text: "first done" });
    expect(items2).toContainEqual({ type: "final", text: "second done" });
  });

  it("stops after tool execution at the next safe point without making another model call", async () => {
    const controller = new AbortController();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(createJsonResponse({
      choices: [{
        message: {
          content: "",
          tool_calls: [{
            id: "call-1",
            type: "function",
            function: {
              name: "echo",
              arguments: "{}",
            },
          }],
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));

    const execute = vi.fn(async () => {
      controller.abort("Stopped by user.");
      return {
        id: "call-1",
        name: "echo",
        success: true,
        output: "tool-output",
        durationMs: 0,
      };
    });

    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function" as const,
          function: {
            name: "echo",
            description: "echo",
            parameters: { type: "object", properties: {} },
          },
        }],
        execute,
      }),
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-stop-after-tool",
      text: "use tool",
      abortSignal: controller.signal,
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(items).toContainEqual({
      type: "tool_call",
      id: "call-1",
      name: "echo",
      arguments: {},
    });
    expect(items).toContainEqual({
      type: "tool_result",
      id: "call-1",
      name: "echo",
      success: true,
      output: "tool-output",
      error: undefined,
    });
    expect(items).toContainEqual({
      type: "status",
      status: "stopped",
    });
    expect(items.some((item) => item.type === "final")).toBe(false);
    expect(items[items.length - 1]).toEqual({
      type: "status",
      status: "stopped",
    });
  });

  it("surfaces prompt cache observability for openai-compatible usage", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "cache observed",
          },
        }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 25,
          prompt_cache_hit_tokens: 80,
          prompt_cache_miss_tokens: 20,
        },
      }));

    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      toolExecutor: createToolExecutor(),
      cacheSupport: "supported",
      usagePricing: {
        inputUsdPer1M: 2,
        outputUsdPer1M: 8,
        cacheReadUsdPer1M: 0.5,
      },
      systemPromptMetadata: {
        systemPromptFingerprint: "fp-deepseek-1",
      },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-cache-observability",
      text: "hello",
      meta: {
        _agentLaunchSpec: {
          maxCostUsd: 0.0003,
        },
      },
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(items.some((item) => item.type === "budget_exhausted")).toBe(false);
    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: "cache observed",
    }));
    expect(items).toContainEqual(expect.objectContaining({
      type: "usage",
      inputTokens: 100,
      outputTokens: 25,
      cacheHitTokens: 80,
      cacheMissTokens: 20,
      cacheSupport: "supported",
      systemPromptFingerprint: "fp-deepseek-1",
      cacheSavingsUsd: 0.00012,
      totalCostUsd: 0.00028,
    }));
  });

  it("uses structured plain-text compression for budget protect instead of head-tail truncation", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
      requestBodies.push(body);
      return createJsonResponse({
        choices: [{
          message: {
            content: "budget protected",
          },
        }],
        usage: { prompt_tokens: 50, completion_tokens: 8 },
      });
    });

    const middleNoise = Array.from({ length: 260 }, (_, index) => `普通背景行 ${index}`).join("\n");
    const longHistoryText = [
      "# 历史任务背景",
      "这里是启动说明",
      middleNoise,
      "结论：必须保留最终审批约束",
      "warning: 不能直接发布",
    ].join("\n");

    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      maxInputTokens: 220,
      toolExecutor: createToolExecutor(),
      budgetProtect: {
        mode: "protect_memory_capability",
        keepRecentRounds: 1,
        compressBeforeDelete: true,
        compressThresholdChars: 200,
      },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-budget-protect-plain-text",
      text: "继续处理",
      history: [
        { role: "user", content: longHistoryText },
        { role: "assistant", content: "收到，我会继续处理并保留审批约束。" },
      ],
    }));

    expect(items).toContainEqual(expect.objectContaining({
      type: "usage",
      budgetProtect: expect.objectContaining({
        protectionActivated: true,
        compressedHistoryCount: expect.any(Number),
      }),
    }));

    const sentMessages = requestBodies[0]?.messages as Array<{ role: string; content?: string }> | undefined;
    const serializedMessages = JSON.stringify(sentMessages);
    expect(serializedMessages).not.toContain("chars omitted by budget-protect");
  });

  it("uses structured json compression for budget protect history when the message is json-shaped", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
      requestBodies.push(body);
      return createJsonResponse({
        choices: [{
          message: {
            content: "json preserved",
          },
        }],
        usage: { prompt_tokens: 50, completion_tokens: 8 },
      });
    });

    const jsonHistoryText = JSON.stringify({
      task: "deploy-check",
      constraints: {
        approvals: Array.from({ length: 100 }, (_, index) => ({ stage: `s${index}`, owner: "ops", note: "must approve before release" })),
        report: "X".repeat(4000),
      },
      summary: "保留结构骨架",
    }, null, 2);

    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      maxInputTokens: 700,
      toolExecutor: createToolExecutor(),
      budgetProtect: {
        mode: "protect_memory_capability",
        keepRecentRounds: 1,
        compressBeforeDelete: true,
        compressThresholdChars: 200,
      },
    });

    await collectItems(agent.run({
      conversationId: "conv-budget-protect-json",
      text: "继续处理",
      history: [
        { role: "user", content: jsonHistoryText },
        { role: "assistant", content: "收到，我会继续处理 JSON 里的约束。" },
      ],
    }));

    const sentMessages = requestBodies[0]?.messages as Array<{ role: string; content?: string }> | undefined;
    const compressedUser = sentMessages?.find((msg) => msg.role === "user" && typeof msg.content === "string" && msg.content.includes("\"constraints\""));
    expect(compressedUser?.content).toContain("\"task\": \"deploy-check\"");
    expect(compressedUser?.content).toContain("\"constraints\"");
    expect(compressedUser?.content).toContain("[...");
    expect(compressedUser?.content).toContain("[truncated:");
    expect(compressedUser?.content).not.toContain("chars omitted by budget-protect");
  });

  it("does not delete history when compressBeforeDelete compression alone gets under budget", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
      requestBodies.push(body);
      return createJsonResponse({
        choices: [{
          message: {
            content: "compression-only",
          },
        }],
        usage: { prompt_tokens: 50, completion_tokens: 8 },
      });
    });

    const compressionPipeline = {
      compress: vi.fn(async (request: { content: string }) => {
        if (!request.content.includes("COMPRESS_ONLY_TARGET")) {
          return {
            applied: false,
            compressedContent: request.content,
          };
        }
        return {
          applied: true,
          compressedContent: [
            "# 历史压缩摘要",
            "关键结论：保留审批链与最终约束。",
            "...[48 lines omitted]...",
            "后续动作：继续处理当前请求。",
          ].join("\n"),
        };
      }),
    } as any;

    const longHistoryText = [
      "# 历史任务背景",
      ...Array.from({ length: 140 }, (_, index) => `COMPRESS_ONLY_TARGET 段落 ${index}：这里是冗长背景说明与上下文噪音。`),
      "结论：必须保留审批链与最终约束。",
    ].join("\n");

    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      maxInputTokens: 240,
      toolExecutor: createToolExecutor(),
      compressionPipeline,
      budgetProtect: {
        mode: "protect_memory_capability",
        keepRecentRounds: 1,
        compressBeforeDelete: true,
        compressThresholdChars: 200,
      },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-budget-protect-compression-only",
      text: "CURRENT_KEEP",
      history: [
        { role: "user", content: longHistoryText },
        { role: "assistant", content: "OLD_ASSIST_KEEP" },
      ],
    }));

    expect(items).toContainEqual(expect.objectContaining({
      type: "usage",
      budgetProtect: expect.objectContaining({
        protectionActivated: true,
        compressedHistoryCount: 1,
        deletedHistoryCount: 0,
      }),
    }));
    expect(compressionPipeline.compress).toHaveBeenCalledTimes(1);

    const sentMessages = requestBodies[0]?.messages as Array<{ role: string; content?: string }> | undefined;
    const serializedMessages = JSON.stringify(sentMessages);
    expect(serializedMessages).toContain("关键结论：保留审批链与最终约束。");
    expect(serializedMessages).toContain("OLD_ASSIST_KEEP");
    expect(serializedMessages).toContain("CURRENT_KEEP");
    expect(serializedMessages).not.toContain("COMPRESS_ONLY_TARGET 段落 139");
  });

  it("compresses later history before deleting the earliest non-compressible message", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
      requestBodies.push(body);
      return createJsonResponse({
        choices: [{
          message: {
            content: "compressed then deleted",
          },
        }],
        usage: { prompt_tokens: 50, completion_tokens: 8 },
      });
    });

    const compressionPipeline = {
      compress: vi.fn(async (request: { content: string }) => {
        if (!request.content.includes("COMPRESS_BEFORE_DELETE_TARGET")) {
          return {
            applied: false,
            compressedContent: request.content,
          };
        }
        return {
          applied: true,
          compressedContent: Array.from(
            { length: 30 },
            (_, index) => `LATER_COMPRESSED_SUMMARY line ${index} keeps only the essential fan-in evidence for manager review.`,
          ).join("\n"),
        };
      }),
    } as any;

    const earliestDeletableHistory = Array.from(
      { length: 16 },
      (_, index) => `EARLY_DELETE record ${index} still adds budget pressure before fan-in handoff.`,
    ).join("\n");
    const laterCompressibleHistory = Array.from(
      { length: 70 },
      (_, index) => `COMPRESS_BEFORE_DELETE_TARGET line ${index} contains long fan-in review context that can be reduced before trimming.`,
    ).join("\n");

    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      maxInputTokens: 900,
      toolExecutor: createToolExecutor(),
      compressionPipeline,
      budgetProtect: {
        mode: "protect_memory_capability",
        keepRecentRounds: 1,
        compressBeforeDelete: true,
        compressThresholdChars: 2000,
      },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-budget-protect-compress-then-delete",
      text: "CURRENT_KEEP",
      history: [
        { role: "user", content: earliestDeletableHistory },
        { role: "assistant", content: "EARLY_ASSIST_KEEP" },
        { role: "user", content: laterCompressibleHistory },
        { role: "assistant", content: "LATER_ASSIST_KEEP" },
      ],
    }));

    expect(items).toContainEqual(expect.objectContaining({
      type: "usage",
      budgetProtect: expect.objectContaining({
        protectionActivated: true,
        compressedHistoryCount: 1,
        deletedHistoryCount: 1,
      }),
    }));
    expect(compressionPipeline.compress).toHaveBeenCalledTimes(1);

    const sentMessages = requestBodies[0]?.messages as Array<{ role: string; content?: string }> | undefined;
    const serializedMessages = JSON.stringify(sentMessages);
    expect(serializedMessages).not.toContain("EARLY_DELETE record 0");
    expect(serializedMessages).toContain("LATER_COMPRESSED_SUMMARY line 0 keeps only the essential fan-in evidence");
    expect(serializedMessages).toContain("EARLY_ASSIST_KEEP");
    expect(serializedMessages).toContain("LATER_ASSIST_KEEP");
    expect(serializedMessages).toContain("CURRENT_KEEP");
  });

  it("recomputes protected rounds after repeated deletions and keeps system/tool schema intact", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
      requestBodies.push(body);
      return createJsonResponse({
        choices: [{
          message: {
            content: "trimmed safely",
          },
        }],
        usage: { prompt_tokens: 50, completion_tokens: 8 },
      });
    });

    const toolDefinitions = [{
      type: "function" as const,
      function: {
        name: "release_guard",
        description: "guard release workflow",
        parameters: {
          type: "object",
          properties: {
            ticket: { type: "string" },
          },
          required: ["ticket"],
        },
      },
    }];

    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      systemPrompt: `SYSTEM_GUARD ${"S".repeat(2200)}`,
      maxInputTokens: 420,
      toolExecutor: createToolExecutor({
        getDefinitions: () => toolDefinitions,
      }),
      budgetProtect: {
        mode: "protect_memory_capability",
        keepRecentRounds: 2,
        compressBeforeDelete: false,
        compressThresholdChars: 200,
      },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-budget-protect-recompute",
      text: `CURRENT_USER_KEEP ${"E".repeat(2200)}`,
      history: [
        { role: "user", content: `OLD1_USER ${"A".repeat(2400)}` },
        { role: "assistant", content: `OLD1_ASSIST ${"B".repeat(2400)}` },
        { role: "user", content: `OLD2_USER ${"C".repeat(2400)}` },
        { role: "assistant", content: `OLD2_ASSIST ${"D".repeat(2400)}` },
        { role: "user", content: "RECENT_USER_KEEP" },
        { role: "assistant", content: "RECENT_ASSIST_KEEP" },
      ],
    }));

    expect(items).toContainEqual(expect.objectContaining({
      type: "usage",
      budgetProtect: expect.objectContaining({
        protectionActivated: true,
        compressedHistoryCount: 0,
        deletedHistoryCount: 4,
      }),
    }));

    const payload = requestBodies[0] ?? {};
    const sentMessages = payload.messages as Array<{ role: string; content?: string }> | undefined;
    const serializedMessages = JSON.stringify(sentMessages);

    expect(sentMessages?.[0]).toEqual(expect.objectContaining({
      role: "system",
    }));
    expect(payload.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        function: expect.objectContaining({
          name: "release_guard",
        }),
      }),
    ]));
    expect(serializedMessages).not.toContain("OLD1_USER");
    expect(serializedMessages).not.toContain("OLD1_ASSIST");
    expect(serializedMessages).not.toContain("OLD2_USER");
    expect(serializedMessages).not.toContain("OLD2_ASSIST");
    expect(serializedMessages).toContain("RECENT_USER_KEEP");
    expect(serializedMessages).toContain("RECENT_ASSIST_KEEP");
    expect(serializedMessages).toContain("CURRENT_USER_KEEP");
  });

  it("estimates usage tokens with the active model profile instead of the generic fallback", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{
          message: {
            content: "profile aligned",
          },
        }],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 12,
        },
      }));
    const systemPrompt = Array.from({ length: 20 }, (_, index) => `## Section ${index}\n- item ${index}\n`).join("");
    const expectedDeepseek = estimateTokens(systemPrompt, { model: "deepseek-v4-pro" });
    const expectedOpenAi = estimateTokens(systemPrompt, { model: "gpt-5.4" });
    expect(expectedDeepseek).toBeGreaterThan(expectedOpenAi);

    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "test-key",
      model: "deepseek-v4-pro",
      systemPrompt,
      toolExecutor: createToolExecutor(),
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-model-aware-estimate",
      text: "hello",
    }));
    const usageItem = items.find((item) => item.type === "usage");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(usageItem).toMatchObject({
      type: "usage",
      systemPromptTokens: expectedDeepseek,
    });
    expect(usageItem?.systemPromptTokens).not.toBe(expectedOpenAi);
  });
});

describe("OpenAI-compatible reasoning config", () => {
  it("passes thinking and reasoning_effort from fallback profiles to chat completions", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
      requestBodies.push(body);
      if (String(url).includes("primary.example.com")) {
        return new Response(JSON.stringify({ error: "primary unavailable" }), { status: 500 });
      }
      return createJsonResponse({
        choices: [{
          message: {
            content: "done",
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    });

    const agent = new ToolEnabledAgent({
      baseUrl: "https://primary.example.com/v1",
      apiKey: "primary-key",
      model: "primary-model",
      toolExecutor: createToolExecutor(),
      fallbacks: [{
        id: "deepseek-fallback",
        baseUrl: "https://api.deepseek.com",
        apiKey: "fallback-key",
        model: "deepseek-v4-pro",
        thinking: {
          type: "enabled",
          budget_tokens: 2048,
        },
        reasoningEffort: "max",
      options: {
        num_ctx: 32768,
      },
      requestBodyExtras: {
        chat_template_kwargs: {
          enable_thinking: true,
        },
      },
    }],
  });

    const items = await collectItems(agent.run({
      conversationId: "conv-tool-thinking",
      text: "hello",
    }));

    expect(items).toContainEqual({ type: "final", text: "done" });
    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0]).not.toHaveProperty("thinking");
    expect(requestBodies[1]).toMatchObject({
      model: "deepseek-v4-pro",
      thinking: {
        type: "enabled",
        budget_tokens: 2048,
      },
      reasoning_effort: "max",
      options: {
        num_ctx: 32768,
      },
      chat_template_kwargs: {
        enable_thinking: true,
      },
    });
  });

  it("fails explicitly when a thinking model returns reasoning_content without visible content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(createJsonResponse({
      choices: [{
        finish_reason: "stop",
        message: {
          content: null,
          reasoning_content: "Let me think through the user's preference carefully before replying.",
        },
      }],
      usage: { prompt_tokens: 12, completion_tokens: 8 },
    }));

    const agent = new ToolEnabledAgent({
      baseUrl: "https://apihub.agnes-ai.com/v1",
      apiKey: "test-key",
      model: "agnes-2.0-flash",
      requestBodyExtras: {
        chat_template_kwargs: {
          enable_thinking: true,
        },
      },
      toolExecutor: createToolExecutor(),
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-tool-thinking-empty-visible-content",
      text: "真漂亮，我最爱的就是银河星空了",
    }));

    expect(items).toContainEqual(expect.objectContaining({
      type: "final",
      text: expect.stringMatching(/^模型返回空内容。finish_reason=stop，reasoning_content=present\(\d+\)。$/),
    }));
    expect(items).toContainEqual({
      type: "status",
      status: "error",
    });
  });

  it("passes thinking and reasoning_effort to responses payloads", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
      requestBodies.push(body);
      return createJsonResponse({
        output: [{
          type: "message",
          content: [{ type: "output_text", text: "done" }],
        }],
      });
    });

    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.deepseek.com",
      apiKey: "test-key",
      model: "deepseek-v4-pro",
      wireApi: "responses",
      thinking: {
        type: "enabled",
      },
      reasoningEffort: "high",
      options: {
        num_ctx: 16384,
      },
      requestBodyExtras: {
        chat_template_kwargs: {
          enable_thinking: true,
        },
      },
      toolExecutor: createToolExecutor(),
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-tool-responses-thinking",
      text: "hello",
    }));

    expect(items).toContainEqual({ type: "final", text: "done" });
    expect(requestBodies[0]).toMatchObject({
      model: "deepseek-v4-pro",
      thinking: {
        type: "enabled",
      },
      reasoning_effort: "high",
      options: {
        num_ctx: 16384,
      },
      chat_template_kwargs: {
        enable_thinking: true,
      },
    });
  });

  describe("conversation release", () => {
    it("clears idle notify state and delegates ToolExecutor cleanup", () => {
      const releaseConversation = vi.fn();
      const agent = new ToolEnabledAgent({
        baseUrl: "https://api.example.com/v1",
        apiKey: "test-key",
        model: "test-model",
        toolExecutor: createToolExecutor({ releaseConversation }),
      });
      (agent as any).starweaverActiveNotifyLastRunAt.set("conv-release", 1);
      (agent as any).starweaverVisibleNotifyFingerprint.set("conv-release", "fingerprint");

      agent.releaseConversation("conv-release");
      agent.releaseConversation("conv-release");

      expect((agent as any).starweaverActiveNotifyLastRunAt.has("conv-release")).toBe(false);
      expect((agent as any).starweaverVisibleNotifyFingerprint.has("conv-release")).toBe(false);
      expect(releaseConversation).toHaveBeenCalledTimes(2);
      expect(releaseConversation).toHaveBeenLastCalledWith("conv-release");
    });

    it("defers cleanup for an active chain and does not clear a newer run", async () => {
      const releaseConversation = vi.fn();
      const agent = new ToolEnabledAgent({
        baseUrl: "https://api.example.com/v1",
        apiKey: "test-key",
        model: "test-model",
        toolExecutor: createToolExecutor({ releaseConversation }),
      });
      let releaseOld: (() => void) | undefined;
      const oldChain = new Promise<void>((resolve) => {
        releaseOld = resolve;
      });
      const newChain = new Promise<void>(() => {});
      (agent as any).conversationRunChains.set("conv-active", oldChain);
      (agent as any).starweaverActiveNotifyLastRunAt.set("conv-active", 1);

      const pendingRelease = agent.releaseConversation("conv-active");
      expect(releaseConversation).not.toHaveBeenCalled();

      (agent as any).conversationRunChains.set("conv-active", newChain);
      releaseOld?.();
      await oldChain;
      await pendingRelease;

      expect((agent as any).starweaverActiveNotifyLastRunAt.has("conv-active")).toBe(true);
      expect(releaseConversation).not.toHaveBeenCalled();

      (agent as any).conversationRunChains.delete("conv-active");
      await agent.releaseConversation("conv-active");
      expect((agent as any).starweaverActiveNotifyLastRunAt.has("conv-active")).toBe(false);
      expect(releaseConversation).toHaveBeenCalledOnce();
    });

    it("releases supported compression references and exposes content-free totals", async () => {
      const releaseReferences = vi.fn(() => ({ prunedCount: 2, retainedCount: 1 }));
      const referenceStore = {
        releaseConversation: releaseReferences,
        size: vi.fn(() => 1),
      };
      const agent = new ToolEnabledAgent({
        baseUrl: "https://api.example.com/v1",
        apiKey: "test-key",
        model: "test-model",
        toolExecutor: createToolExecutor(),
        compressionPipeline: {
          getReferenceStore: () => referenceStore,
        } as any,
      });

      await agent.releaseConversation("conv-reference-release");

      expect(releaseReferences).toHaveBeenCalledWith("conv-reference-release");
      expect(agent.getConversationReleaseRuntimeSnapshot()).toEqual({
        pendingConversationReleaseCount: 0,
        compressionReferences: {
          releaseCount: 1,
          prunedCount: 2,
          currentRetainedCount: 1,
          unsupportedReleaseCount: 0,
          failureCount: 0,
        },
      });
    });

    it("keeps legacy reference stores compatible without falling back to prune", async () => {
      const prune = vi.fn();
      const referenceStore = {
        prune,
        size: vi.fn(() => 2),
      };
      const agent = new ToolEnabledAgent({
        baseUrl: "https://api.example.com/v1",
        apiKey: "test-key",
        model: "test-model",
        toolExecutor: createToolExecutor(),
        compressionPipeline: {
          getReferenceStore: () => referenceStore,
        } as any,
      });

      await agent.releaseConversation("conv-legacy-reference-store");

      expect(prune).not.toHaveBeenCalled();
      expect(agent.getConversationReleaseRuntimeSnapshot().compressionReferences).toEqual({
        releaseCount: 0,
        prunedCount: 0,
        currentRetainedCount: 2,
        unsupportedReleaseCount: 1,
        failureCount: 0,
      });
    });

    it("isolates compression reference release failures from other cleanup", async () => {
      const releaseConversation = vi.fn(() => {
        throw new Error("reference release failed");
      });
      const toolReleaseConversation = vi.fn();
      const agent = new ToolEnabledAgent({
        baseUrl: "https://api.example.com/v1",
        apiKey: "test-key",
        model: "test-model",
        toolExecutor: createToolExecutor({ releaseConversation: toolReleaseConversation }),
        compressionPipeline: {
          getReferenceStore: () => ({
            releaseConversation,
            size: () => 3,
          }),
        } as any,
      });

      await expect(agent.releaseConversation("conv-reference-failure")).resolves.toBeUndefined();

      expect(toolReleaseConversation).toHaveBeenCalledWith("conv-reference-failure");
      expect(agent.getConversationReleaseRuntimeSnapshot().compressionReferences).toEqual({
        releaseCount: 0,
        prunedCount: 0,
        currentRetainedCount: 3,
        unsupportedReleaseCount: 0,
        failureCount: 1,
      });
    });
  });
});

function createToolExecutor(overrides: Record<string, unknown> = {}): any {
  return {
    getDefinitions: () => [],
    getRegisteredToolContract: () => undefined,
    consumeLoadedDeferredToolsForNextTurn: vi.fn(async () => []),
    setTokenCounter: vi.fn(),
    clearTokenCounter: vi.fn(),
    releaseConversation: vi.fn(),
    execute: vi.fn(),
    ...overrides,
  };
}

async function collectItems(stream: AsyncIterable<any>): Promise<any[]> {
  const items: any[] = [];
  for await (const item of stream) {
    items.push(item);
  }
  return items;
}

function createJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
