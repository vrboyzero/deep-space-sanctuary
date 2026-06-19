import { afterEach, describe, expect, it, vi } from "vitest";

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
  it("uses hook-provided systemPrompt for the current run", async () => {
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
      model: "gpt-test",
      systemPrompt: "base-system-prompt",
      toolExecutor: createToolExecutor(),
      hookRunner: {
        runBeforeAgentStart: async () => ({
          systemPrompt: "hook-system-prompt",
        }),
        runAgentEnd: async () => {},
        runBeforeToolCall: async () => undefined,
        runAfterToolCall: async () => {},
        runToolResultPersist: () => undefined,
      } as any,
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-hook-system-prompt",
      text: "hello",
    }));

    expect(items).toContainEqual({ type: "final", text: "done" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const requestInit = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    const payload = JSON.parse(String(requestInit?.body ?? "{}"));
    expect(payload.messages[0]).toEqual({
      role: "system",
      content: "hook-system-prompt",
    });
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
        sourceDeltaIds: ["runtime-identity-context", "runtime-identity-authority"],
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

  it("defaults the tool-loop iteration budget to unlimited when unset", () => {
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolExecutor: createToolExecutor(),
    });

    expect((agent as any).opts.toolLoopIterationBudget).toBe(0);
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
    expect(finalItem?.text).toContain("工具调用迭代预算超限（最大 1 轮）");
    expect(items[items.length - 1]).toEqual({ type: "status", status: "error" });
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

  it("runs starweaver active notify preflight when enabled and starweaver tools are available", async () => {
    const previousEnabled = process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_ENABLED;
    const previousInterval = process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS;
    process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_ENABLED = "true";
    process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS = "1000";

    try {
      const fetchSpy = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(createJsonResponse({
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
        text: "继续",
      }));

      expect(fetchSpy).toHaveBeenCalledTimes(1);
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
      undefined,
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
      conversationId: "conv-tool-call-dedupe",
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
    });
    expect(execute).toHaveBeenCalledWith(
      expect.anything(),
      "conv-launch-spec",
      "tool-agent",
      undefined,
      undefined,
      undefined,
      {
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
      },
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
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(items).toContainEqual(expect.objectContaining({
      type: "usage",
      inputTokens: 100,
      outputTokens: 25,
      cacheHitTokens: 80,
      cacheMissTokens: 20,
      cacheSupport: "supported",
      systemPromptFingerprint: "fp-deepseek-1",
      cacheSavingsUsd: 0.00012,
    }));
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
});

function createToolExecutor(overrides: Record<string, unknown> = {}): any {
  return {
    getDefinitions: () => [],
    consumeLoadedDeferredToolsForNextTurn: vi.fn(async () => []),
    setTokenCounter: vi.fn(),
    clearTokenCounter: vi.fn(),
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
