import { describe, expect, it, vi } from "vitest";

import { ToolEnabledAgent } from "../../belldandy-agent/src/tool-agent.js";
import { ToolExecutor } from "../../belldandy-skills/src/executor.js";
import { createToolSearchTool } from "../../belldandy-skills/src/builtin/tool-search.js";
import type { Tool, ToolCallResult } from "../../belldandy-skills/src/types.js";

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

describe("tool reliability baseline", () => {
  it("routes through tool_search correction, loads a deferred schema, and then calls the loaded tool once it is visible", async () => {
    const goalFamily = {
      id: "goals",
      title: "Goals",
      summary: "Goal governance and checkpoint operations.",
      gateMode: "hidden-until-expanded" as const,
      keywords: ["goal", "checkpoint"],
    };

    const deferredGoalTool: Tool = {
      definition: {
        name: "goal_checkpoint_request",
        description: "Request a goal checkpoint",
        shortDescription: "Request a checkpoint",
        keywords: ["goal", "checkpoint"],
        discoveryFamily: goalFamily,
        parameters: {
          type: "object",
          properties: {
            goalId: { type: "string", description: "goal id" },
          },
          required: ["goalId"],
        },
      },
      async execute(args): Promise<ToolCallResult> {
        return {
          id: "",
          name: "goal_checkpoint_request",
          success: true,
          output: `checkpoint:${String(args.goalId ?? "")}`,
          durationMs: 0,
        };
      },
    };

    const executor = new ToolExecutor({
      tools: [deferredGoalTool],
      workspaceRoot: "/tmp/test",
      deferredToolNames: ["goal_checkpoint_request"],
    });
    executor.registerTool(createToolSearchTool({
      getDiscoveryEntries: (conversationId?: string, agentId?: string, expandedFamilyIds?: string[]) =>
        executor.getDiscoveryEntries(agentId, conversationId, undefined, { expandedFamilyIds }),
      getLoadedDeferredToolList: (conversationId: string) => executor.getLoadedDeferredToolList(conversationId),
      loadDeferredTools: (conversationId: string, toolNames: string[]) => executor.loadDeferredTools(conversationId, toolNames),
      unloadDeferredTools: (conversationId: string, toolNames: string[]) => executor.unloadDeferredTools(conversationId, toolNames),
      clearLoadedDeferredTools: (conversationId: string) => executor.clearLoadedDeferredTools(conversationId),
      shrinkLoadedDeferredTools: (conversationId: string, toolNames: string[]) => executor.shrinkLoadedDeferredTools(conversationId, toolNames),
    }));

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
                arguments: "{\"family\":\"goals\",\"load\":\"goal_checkpoint_request\",\"query\":\"goal checkpoint\"}",
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
                arguments: "{\"goalId\":\"goal-42\"}",
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
      toolCallRepairLevel: "full",
      toolExecutor: executor as any,
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-tool-reliability-baseline",
      text: "find and use the right goal checkpoint tool",
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(items).toContainEqual({
      type: "tool_result",
      id: "call-1",
      name: "tool_search",
      success: true,
      output: expect.stringContaining("Loaded deferred tools for this conversation"),
      metadata: expect.objectContaining({
        repairAction: "tool_arguments_corrected",
      }),
    });
    expect(items).toContainEqual({
      type: "tool_result",
      id: "call-2",
      name: "goal_checkpoint_request",
      success: true,
      output: "checkpoint:goal-42",
    });
    expect(items).toContainEqual({ type: "final", text: "done" });
  });
});
