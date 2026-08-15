import { describe, expect, it } from "vitest";

import {
  buildWorkspaceMutationRecoveryRequest,
  selectWorkspaceMutationToolDefinitions,
  WORKSPACE_MUTATION_RECOVERY_OUTPUT_TOKEN_RESERVE,
} from "./react-workspace-mutation.js";

describe("ReAct workspace mutation recovery", () => {
  it("builds one bounded mutation-only request from the task and recent read evidence", () => {
    const definitions = [
      toolDefinition("file_read"),
      toolDefinition("apply_patch"),
      toolDefinition("run_command"),
    ];
    const mutationTools = selectWorkspaceMutationToolDefinitions(definitions, (name) => {
      if (name === "apply_patch") return { family: "patch", isReadOnly: false };
      if (name === "file_read") return { family: "workspace-read", isReadOnly: true };
      return { family: "command-exec", isReadOnly: false };
    });

    const request = buildWorkspaceMutationRecoveryRequest({
      maxInputTokens: 700,
      tools: mutationTools,
      tokenEstimateContext: { model: "deepseek-v4-flash" },
      messages: [
        { role: "system", content: "Large ordinary coding system prompt must not be retained." },
        { role: "user", content: "Fix the exported Go API and its call sites." },
        {
          role: "assistant",
          tool_calls: [{ id: "read-1", function: { name: "file_read", arguments: "{}" } }],
        },
        {
          role: "tool",
          tool_call_id: "read-1",
          content: JSON.stringify({ path: "api.go", content: `package api\n${"X".repeat(20_000)}` }),
        },
      ],
    });

    expect(mutationTools.map((tool) => tool.function.name)).toEqual(["apply_patch"]);
    expect(request).toBeDefined();
    expect(request?.estimatedInputTokens).toBeLessThanOrEqual(700);
    expect(request?.messages).toEqual([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Mutation-only recovery phase"),
      }),
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("Fix the exported Go API"),
      }),
    ]);
    expect(request?.messages[1]?.content).toContain("[tool=file_read]");
    expect(request?.messages.some((message) => message.role === ("tool" as string))).toBe(false);
    expect(WORKSPACE_MUTATION_RECOVERY_OUTPUT_TOKEN_RESERVE).toBe(1_024);
  });

  it("fails closed when no allowed workspace mutation tool is available", () => {
    expect(buildWorkspaceMutationRecoveryRequest({
      maxInputTokens: 700,
      tools: [],
      messages: [{ role: "user", content: "Change the file." }],
    })).toBeUndefined();
  });
});

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
