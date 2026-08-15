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

describe("ToolEnabledAgent structured output", () => {
  it("returns an initially valid output with one model call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      choices: [{ message: { content: "{\"status\":\"ok\"}" } }],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    }));
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolExecutor: createToolExecutor(),
      streamingEnabled: true,
    });

    const items = await collectItems(agent.run({
      conversationId: "structured-initial-valid",
      text: "return status",
      structuredOutput: {
        schema: { type: "object" },
        validateOutput: validateStatusOutput,
      },
    } as any));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(items.filter((item) => item.type === "delta").map((item) => item.delta).join(""))
      .toBe("{\"status\":\"ok\"}");
    expect(items).toContainEqual(expect.objectContaining({
      type: "usage",
      inputTokens: 3,
      outputTokens: 2,
      modelCalls: 1,
    }));
    expect(items.at(-2)).toEqual({ type: "final", text: "{\"status\":\"ok\"}" });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("accepts non-streamed JSON after removing a provider control-frame suffix", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      choices: [{ message: {
        content: '{"status":"ok"}</｜｜DSML｜｜parameter>\n</｜｜DSML｜｜invoke>\n</｜｜DSML｜｜tool_calls>',
      } }],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    }));
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolExecutor: createToolExecutor(),
      streamingEnabled: false,
    });

    const items = await collectItems(agent.run({
      conversationId: "structured-provider-control-frame",
      text: "return status",
      structuredOutput: {
        schema: { type: "object" },
        validateOutput: validateStatusOutput,
      },
    } as any));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(items).toContainEqual({ type: "final", text: '{"status":"ok"}' });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("removes a Responses control-frame suffix after executing a standard tool call", async () => {
    const responses = [
      {
        output: [{
          type: "function_call",
          id: "item-inspect",
          call_id: "call-inspect",
          name: "inspect_workspace",
          arguments: "{}",
        }],
        usage: { input_tokens: 3, output_tokens: 2 },
      },
      {
        output: [{
          type: "message",
          content: [{
            type: "output_text",
            text: '{"status":"ok"}</｜｜DSML｜｜parameter>\n</｜｜DSML｜｜invoke>\n</｜｜DSML｜｜tool_calls>',
          }],
        }],
        usage: { input_tokens: 4, output_tokens: 3 },
      },
    ];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const response = responses.shift();
      if (!response) throw new Error("unexpected model call");
      return jsonResponse(response);
    });
    const execute = vi.fn(async (request: { id: string; name: string }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: "workspace inspected",
    }));
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      wireApi: "responses",
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function",
          function: {
            name: "inspect_workspace",
            description: "Inspects the workspace",
            parameters: { type: "object" },
          },
        }],
        execute,
      }),
      streamingEnabled: false,
    });

    const items = await collectItems(agent.run({
      conversationId: "structured-responses-control-frame",
      text: "inspect and return status",
      structuredOutput: {
        schema: { type: "object" },
        validateOutput: validateStatusOutput,
      },
    } as any));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(items).toContainEqual({ type: "final", text: '{"status":"ok"}' });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("repairs one invalid final response without exposing tools or the invalid text", async () => {
    const responses = [
      {
        choices: [{ message: { content: "not-json" } }],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      },
      {
        choices: [{ message: { content: "{\"status\":\"ok\"}" } }],
        usage: { prompt_tokens: 4, completion_tokens: 3 },
      },
    ];
    const requestBodies: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requestBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      const response = responses.shift();
      if (!response) throw new Error("unexpected model call");
      return jsonResponse(response);
    });
    const execute = vi.fn();
    const toolExecutor = createToolExecutor({
      getDefinitions: () => [{
        type: "function",
        function: {
          name: "mutate_workspace",
          description: "Mutates the workspace",
          parameters: { type: "object" },
        },
      }],
      execute,
    });
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolExecutor,
      streamingEnabled: true,
    });

    const items = await collectItems(agent.run({
      conversationId: "structured-repair-success",
      text: "return status",
      structuredOutput: {
        schema: {
          type: "object",
          properties: { status: { const: "ok" } },
          required: ["status"],
          additionalProperties: false,
        },
        validateOutput: validateStatusOutput,
      },
    } as any));

    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0]?.tools).toHaveLength(1);
    expect(requestBodies[1]?.tools).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
    expect(items.filter((item) => item.type === "delta").map((item) => item.delta).join(""))
      .toBe("{\"status\":\"ok\"}");
    expect(JSON.stringify(items)).not.toContain("not-json");
    expect(items).toContainEqual({ type: "final", text: "{\"status\":\"ok\"}" });
    expect(items).toContainEqual(expect.objectContaining({
      type: "usage",
      inputTokens: 7,
      outputTokens: 5,
      modelCalls: 2,
      providerReportedModelCalls: 2,
    }));
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("reports Provider usage coverage separately when one model call omits usage", async () => {
    const responses = [
      { choices: [{ message: { content: "not-json" } }] },
      {
        choices: [{ message: { content: "{\"status\":\"ok\"}" } }],
        usage: { prompt_tokens: 4, completion_tokens: 3 },
      },
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const response = responses.shift();
      if (!response) throw new Error("unexpected model call");
      return jsonResponse(response);
    });
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolExecutor: createToolExecutor(),
      streamingEnabled: true,
    });

    const items = await collectItems(agent.run({
      conversationId: "structured-partial-provider-usage",
      text: "return status",
      structuredOutput: {
        schema: { type: "object" },
        validateOutput: validateStatusOutput,
      },
    } as any));

    expect(items).toContainEqual(expect.objectContaining({
      type: "usage",
      inputTokens: 4,
      outputTokens: 3,
      modelCalls: 2,
      providerReportedModelCalls: 1,
    }));
  });

  it("counts a failed repair call as missing Provider usage", async () => {
    const responses = [
      jsonResponse({
        choices: [{ message: { content: "not-json" } }],
        usage: { prompt_tokens: 4, completion_tokens: 3 },
      }),
      new Response(JSON.stringify({ error: { message: "provider unavailable" } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    ];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const response = responses.shift();
      if (!response) throw new Error("unexpected model call");
      return response;
    });
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolExecutor: createToolExecutor(),
      streamingEnabled: false,
    });

    const items = await collectItems(agent.run({
      conversationId: "structured-failed-repair-usage",
      text: "return status",
      structuredOutput: {
        schema: { type: "object" },
        validateOutput: validateStatusOutput,
      },
    } as any));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(items).toContainEqual(expect.objectContaining({
      type: "usage",
      inputTokens: 4,
      outputTokens: 3,
      modelCalls: 2,
      providerReportedModelCalls: 1,
    }));
    expect(items.at(-1)).toEqual({ type: "status", status: "error" });
  });

  it("leaves natural-language permission text to the structured-output repair owner", async () => {
    const permissionExplanation = '{"status":"ok"}\n\nNote: execution tools were denied permission.';
    const responses = [
      {
        choices: [{ message: { content: permissionExplanation } }],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      },
      {
        choices: [{ message: { content: '{"status":"ok"}' } }],
        usage: { prompt_tokens: 4, completion_tokens: 3 },
      },
    ];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const response = responses.shift();
      if (!response) throw new Error("unexpected model call");
      return jsonResponse(response);
    });
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolExecutor: createToolExecutor(),
      streamingEnabled: false,
    });

    const items = await collectItems(agent.run({
      conversationId: "structured-permission-explanation",
      text: "return status",
      structuredOutput: {
        schema: { type: "object" },
        validateOutput: validateStatusOutput,
      },
    } as any));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(items)).not.toContain(permissionExplanation);
    expect(items).toContainEqual({ type: "final", text: '{"status":"ok"}' });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("rejects a repair tool call without executing it and preserves the original output", async () => {
    const responses = [
      {
        choices: [{ message: { content: "original-invalid-output" } }],
        usage: { prompt_tokens: 2, completion_tokens: 1 },
      },
      {
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call-mutate",
              type: "function",
              function: { name: "mutate_workspace", arguments: "{}" },
            }],
          },
        }],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      },
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const response = responses.shift();
      if (!response) throw new Error("unexpected model call");
      return jsonResponse(response);
    });
    const execute = vi.fn(async () => ({
      id: "call-mutate",
      name: "mutate_workspace",
      success: true,
      output: "mutated",
    }));
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function",
          function: {
            name: "mutate_workspace",
            description: "Mutates the workspace",
            parameters: { type: "object" },
          },
        }],
        execute,
      }),
      streamingEnabled: false,
    });

    const items = await collectItems(agent.run({
      conversationId: "structured-repair-tool-call",
      text: "return status",
      structuredOutput: {
        schema: { type: "object" },
        validateOutput: validateStatusOutput,
      },
    } as any));

    expect(execute).not.toHaveBeenCalled();
    expect(items.filter((item) => item.type === "tool_call")).toHaveLength(0);
    expect(items.filter((item) => item.type === "delta")).toHaveLength(0);
    expect(items).toContainEqual({ type: "final", text: "original-invalid-output" });
    expect(items).toContainEqual(expect.objectContaining({
      type: "usage",
      inputTokens: 5,
      outputTokens: 3,
      modelCalls: 2,
    }));
    expect(items.at(-1)).toEqual(expect.objectContaining({
      type: "status",
      status: "error",
      code: "output_schema_invalid",
    }));
  });

  it("preserves the first output when the single repair is also invalid", async () => {
    const responses = [
      {
        choices: [{ message: { content: "first-invalid" } }],
        usage: { prompt_tokens: 2, completion_tokens: 1 },
      },
      {
        choices: [{ message: { content: "second-invalid" } }],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      },
    ];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const response = responses.shift();
      if (!response) throw new Error("unexpected model call");
      return jsonResponse(response);
    });
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolExecutor: createToolExecutor(),
      streamingEnabled: true,
    });

    const items = await collectItems(agent.run({
      conversationId: "structured-repair-invalid",
      text: "return status",
      structuredOutput: {
        schema: { type: "object" },
        validateOutput: validateStatusOutput,
      },
    } as any));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(items.filter((item) => item.type === "delta")).toHaveLength(0);
    expect(items).toContainEqual({ type: "final", text: "first-invalid" });
    expect(JSON.stringify(items)).not.toContain("second-invalid");
    expect(items).toContainEqual(expect.objectContaining({
      type: "usage",
      inputTokens: 5,
      outputTokens: 3,
      modelCalls: 2,
    }));
    expect(items.at(-1)).toEqual(expect.objectContaining({
      type: "status",
      status: "error",
      code: "output_schema_invalid",
      error: "Final output is not valid JSON.",
    }));
  });

  it("does not start repair when the run has no remaining model turn", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      choices: [{ message: { content: "turn-budget-original" } }],
      usage: { prompt_tokens: 2, completion_tokens: 1 },
    }));
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolExecutor: createToolExecutor(),
      toolLoopIterationBudget: 8,
      streamingEnabled: false,
    });

    const items = await collectItems(agent.run({
      conversationId: "structured-repair-turn-budget",
      text: "return status",
      meta: {
        _agentLaunchSpec: {
          toolLoopIterationBudget: 1,
        },
      },
      structuredOutput: {
        schema: { type: "object" },
        validateOutput: validateStatusOutput,
      },
    } as any));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(items).toContainEqual({
      type: "budget_exhausted",
      budget: "tool_loop_iterations",
      limit: 1,
      observed: 2,
    });
    expect(items).toContainEqual({ type: "final", text: "turn-budget-original" });
    expect(items).toContainEqual(expect.objectContaining({
      type: "usage",
      inputTokens: 2,
      outputTokens: 1,
      modelCalls: 1,
    }));
    expect(items.at(-1)).toEqual(expect.objectContaining({
      type: "status",
      status: "error",
      code: "output_schema_invalid",
    }));
  });

  it("does not start repair when its minimum prompt exceeds the remaining token budget", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse({
      choices: [{ message: { content: "token-budget-original" } }],
      usage: { prompt_tokens: 2, completion_tokens: 1 },
    }));
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolExecutor: createToolExecutor(),
      streamingEnabled: false,
    });

    const items = await collectItems(agent.run({
      conversationId: "structured-repair-token-budget",
      text: "return status",
      meta: {
        _agentLaunchSpec: {
          maxTotalTokens: 64,
        },
      },
      structuredOutput: {
        schema: {
          type: "object",
          properties: { status: { const: "ok" } },
          required: ["status"],
        },
        validateOutput: validateStatusOutput,
      },
    } as any));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(items).toContainEqual(expect.objectContaining({
      type: "budget_exhausted",
      budget: "total_tokens",
      limit: 64,
    }));
    expect(items).toContainEqual({ type: "final", text: "token-budget-original" });
    expect(items.at(-1)).toEqual(expect.objectContaining({
      type: "status",
      status: "error",
      code: "output_schema_invalid",
    }));
  });

  it("keeps cost-containment metadata when repair preflight exhausts remaining tokens", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      choices: [{ message: { content: "policy-token-budget-original" } }],
      usage: { prompt_tokens: 22_000, completion_tokens: 1 },
    }));
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      systemPrompt: "Return the requested JSON.",
      toolExecutor: createToolExecutor(),
      streamingEnabled: false,
    });

    const items = await collectItems(agent.run({
      conversationId: "structured-repair-policy-token-budget",
      text: "return status",
      meta: {
        _agentLaunchSpec: {
          maxTotalTokens: 22_100,
          modelLoopBudgetPolicy: "cost-containment-v1",
        },
      },
      structuredOutput: {
        schema: { type: "object", properties: { status: { const: "ok" } } },
        validateOutput: validateStatusOutput,
      },
    } as any));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(items).toContainEqual(expect.objectContaining({
      type: "budget_exhausted",
      budget: "total_tokens",
      limit: 22_100,
      policyId: "cost-containment-v1",
      stage: "before_model_call",
      reasonCode: "insufficient_remaining_tokens",
    }));
    expect(items).toContainEqual({ type: "final", text: "policy-token-budget-original" });
    expect(items.at(-1)).toEqual(expect.objectContaining({
      type: "status",
      status: "error",
      code: "output_schema_invalid",
    }));
  });

  it("does not start repair after wall time expires and keeps the first response usage", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => (
      jsonResponse({
        choices: [{ message: { content: "wall-time-original" } }],
        usage: { prompt_tokens: 2, completion_tokens: 1 },
      })
    ));
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolExecutor: createToolExecutor(),
      maxRunWallTimeMs: 10,
      streamingEnabled: false,
    });

    const items = await collectItems(agent.run({
      conversationId: "structured-repair-wall-time",
      text: "return status",
      structuredOutput: {
        schema: { type: "object" },
        validateOutput: () => {
          const deadline = Date.now() + 30;
          while (Date.now() < deadline) {
            // Keep validation synchronous so the deadline expires between model accounting and repair dispatch.
          }
          return { ok: false, message: "Final output is not valid JSON." };
        },
      },
    } as any));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(items).toContainEqual(expect.objectContaining({
      type: "budget_exhausted",
      budget: "wall_time_ms",
      limit: 10,
    }));
    expect(items).toContainEqual({ type: "final", text: "wall-time-original" });
    expect(items).toContainEqual(expect.objectContaining({
      type: "usage",
      inputTokens: 2,
      outputTokens: 1,
      modelCalls: 1,
    }));
    expect(items.at(-1)).toEqual(expect.objectContaining({
      type: "status",
      status: "error",
      code: "output_schema_invalid",
    }));
  });

  it("does not start repair when its minimum prompt exceeds the remaining cost budget", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse({
      choices: [{ message: { content: "cost-budget-original" } }],
      usage: { prompt_tokens: 2, completion_tokens: 1 },
    }));
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolExecutor: createToolExecutor(),
      usagePricing: {
        inputUsdPer1M: 1_000_000,
        outputUsdPer1M: 1_000_000,
      },
      streamingEnabled: false,
    });

    const items = await collectItems(agent.run({
      conversationId: "structured-repair-cost-budget",
      text: "return status",
      meta: {
        _agentLaunchSpec: {
          maxCostUsd: 10,
        },
      },
      structuredOutput: {
        schema: {
          type: "object",
          properties: { status: { const: "ok" } },
          required: ["status"],
        },
        validateOutput: validateStatusOutput,
      },
    } as any));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(items).toContainEqual(expect.objectContaining({
      type: "budget_exhausted",
      budget: "cost_usd",
      limit: 10,
    }));
    expect(items).toContainEqual({ type: "final", text: "cost-budget-original" });
    expect(items).toContainEqual(expect.objectContaining({
      type: "usage",
      totalCostUsd: 3,
      modelCalls: 1,
    }));
  });

  it("preserves the first output when repair usage exhausts the token budget", async () => {
    const responses = [
      {
        choices: [{ message: { content: "post-budget-original" } }],
        usage: { prompt_tokens: 2, completion_tokens: 1 },
      },
      {
        choices: [{ message: { content: '{"status":"ok"}' } }],
        usage: { prompt_tokens: 100, completion_tokens: 500 },
      },
    ];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const response = responses.shift();
      if (!response) throw new Error("unexpected model call");
      return jsonResponse(response);
    });
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolExecutor: createToolExecutor(),
      streamingEnabled: false,
    });

    const items = await collectItems(agent.run({
      conversationId: "structured-repair-post-token-budget",
      text: "return status",
      meta: {
        _agentLaunchSpec: {
          maxTotalTokens: 500,
        },
      },
      structuredOutput: {
        schema: { type: "object" },
        validateOutput: validateStatusOutput,
      },
    } as any));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(items).toContainEqual(expect.objectContaining({
      type: "budget_exhausted",
      budget: "total_tokens",
      limit: 500,
      observed: 603,
    }));
    expect(items).toContainEqual({ type: "final", text: "post-budget-original" });
    expect(items).toContainEqual(expect.objectContaining({
      type: "usage",
      inputTokens: 102,
      outputTokens: 501,
      modelCalls: 2,
    }));
    expect(items.at(-1)).toEqual({ type: "status", status: "error" });
  });

  it("preserves the first output when repair usage exhausts the cost budget", async () => {
    const responses = [
      {
        choices: [{ message: { content: "post-cost-original" } }],
        usage: { prompt_tokens: 2, completion_tokens: 1 },
      },
      {
        choices: [{ message: { content: '{"status":"ok"}' } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      },
    ];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const response = responses.shift();
      if (!response) throw new Error("unexpected model call");
      return jsonResponse(response);
    });
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      toolExecutor: createToolExecutor(),
      usagePricing: {
        inputUsdPer1M: 0,
        outputUsdPer1M: 1_000_000,
      },
      streamingEnabled: false,
    });

    const items = await collectItems(agent.run({
      conversationId: "structured-repair-post-cost-budget",
      text: "return status",
      meta: {
        _agentLaunchSpec: {
          maxCostUsd: 10,
        },
      },
      structuredOutput: {
        schema: { type: "object" },
        validateOutput: validateStatusOutput,
      },
    } as any));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(items).toContainEqual({
      type: "budget_exhausted",
      budget: "cost_usd",
      limit: 10,
      observed: 21,
    });
    expect(items).toContainEqual({ type: "final", text: "post-cost-original" });
    expect(items).toContainEqual(expect.objectContaining({
      type: "usage",
      inputTokens: 102,
      outputTokens: 21,
      totalCostUsd: 21,
      modelCalls: 2,
    }));
    expect(items.at(-1)).toEqual({ type: "status", status: "error" });
  });

  it("does not start structured repair after a bounded finalization-only call", async () => {
    let callIndex = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) {
        return jsonResponse({
          choices: [{
            message: {
              content: "",
              tool_calls: [{
                id: "call-finalization-read",
                type: "function",
                function: { name: "file_read", arguments: "{\"path\":\"large.json\"}" },
              }],
            },
          }],
          usage: { prompt_tokens: 1_000, completion_tokens: 50 },
        });
      }
      if (callIndex === 2) {
        return jsonResponse({
          choices: [{ message: { content: "not-json" } }],
          usage: { prompt_tokens: 700, completion_tokens: 100 },
        });
      }
      return jsonResponse({
        choices: [{ message: { content: "{\"status\":\"ok\"}" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    });
    const execute = vi.fn(async () => ({
      id: "call-finalization-read",
      name: "file_read",
      success: true,
      output: "X".repeat(30_000),
      durationMs: 0,
    }));
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      maxTotalTokens: 3_000,
      maxOutputTokens: 4_096,
      toolExecutor: createToolExecutor({
        getDefinitions: () => [{
          type: "function",
          function: {
            name: "file_read",
            description: "read file",
            parameters: { type: "object" },
          },
        }],
        execute,
      }),
      streamingEnabled: false,
    });

    const items = await collectItems(agent.run({
      conversationId: "structured-finalization-no-repair",
      text: "return status",
      structuredOutput: {
        schema: { type: "object" },
        validateOutput: validateStatusOutput,
      },
    } as any));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(1);
    const secondPayload = JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body ?? "{}"));
    expect(secondPayload.tools).toBeUndefined();
    expect(secondPayload.max_tokens).toBe(1_024);
    expect(items.some((item) => item.type === "budget_exhausted")).toBe(false);
    expect(items).toContainEqual({ type: "final", text: "not-json" });
    expect(items.at(-1)).toEqual(expect.objectContaining({
      type: "status",
      status: "error",
      code: "output_schema_invalid",
    }));
  });
});

function validateStatusOutput(text: string):
  | { ok: true; outputText: string }
  | { ok: false; message: string } {
  try {
    const output = JSON.parse(text) as { status?: unknown };
    return output.status === "ok"
      ? { ok: true, outputText: text.trim() }
      : { ok: false, message: "Final output does not match the required schema." };
  } catch {
    return { ok: false, message: "Final output is not valid JSON." };
  }
}

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
  for await (const item of stream) items.push(item);
  return items;
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
