import { describe, expect, it } from "vitest";

import {
  buildWorkspaceMutationRecoveryPlan,
  buildWorkspaceMutationRecoveryRequest,
  selectWorkspaceMutationToolDefinitions,
  WORKSPACE_MUTATION_RECOVERY_MIN_OUTPUT_TOKEN_RESERVE,
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
    expect(WORKSPACE_MUTATION_RECOVERY_OUTPUT_TOKEN_RESERVE).toBe(4_096);
    expect(WORKSPACE_MUTATION_RECOVERY_MIN_OUTPUT_TOKEN_RESERVE).toBe(1_024);
  });

  it("retains a function from a focused anchor window with the canary evidence budget", () => {
    const anchor = "func (c *Command) Name() string";
    const functionBody = [
      anchor + " {",
      "\tname := c.Use",
      "\ti := strings.LastIndex(name, \" \")",
      "\tif i >= 0 {",
      "\t\tname = name[:i]",
      "\t}",
      "\treturn name",
      "}",
    ].join("\n");
    const focusedRead = JSON.stringify({
      path: "command.go",
      bytesRead: 4_096,
      anchor: { text: anchor, byteOffset: 46_089 },
      content: `${"before := value\n".repeat(120)}${functionBody}\n${"after := value\n".repeat(120)}`,
    });

    const request = buildWorkspaceMutationRecoveryRequest({
      maxInputTokens: 2_584,
      tools: [toolDefinition("apply_patch")],
      tokenEstimateContext: { model: "deepseek-v4-flash" },
      messages: [
        { role: "user", content: "Fix Command.Name so it returns the first token." },
        {
          role: "assistant",
          tool_calls: [{ id: "list-1", function: { name: "list_files", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: "list-1", content: JSON.stringify({ entries: ["command.go"] }) },
        {
          role: "assistant",
          tool_calls: [{ id: "read-1", function: { name: "file_read", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: "read-1", content: JSON.stringify({ path: "go.mod", content: "module cobra" }) },
        {
          role: "assistant",
          tool_calls: [{ id: "read-2", function: { name: "file_read", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: "read-2", content: JSON.stringify({ path: "benchmark_test.go", content: "want serve" }) },
        {
          role: "assistant",
          tool_calls: [{ id: "read-3", function: { name: "file_read", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: "read-3", content: "路径不是文件" },
        {
          role: "assistant",
          tool_calls: [{ id: "read-4", function: { name: "file_read", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: "read-4", content: focusedRead },
      ],
    });

    expect(request).toBeDefined();
    expect(request?.messages[1]?.content).toContain(anchor);
    expect(request?.messages[1]?.content).toContain("strings.LastIndex");
    const focusedEvidence = request?.messages[1]?.content.split("[tool=file_read]").at(-1);
    expect(focusedEvidence).toContain('"contentTruncatedForMutationRecovery":true');
    expect(focusedEvidence).toContain('"anchorContext":');
  });

  it("prefers reasoning headroom and shrinks output only when the run budget is tight", () => {
    const input = {
      messages: [{ role: "user", content: "Change api.go." }],
      tools: [toolDefinition("apply_patch")],
      maxOutputTokens: 4_096,
      finalizationOutputTokens: 1_024,
      inputSafetyFactor: 1.2,
      tokenEstimateContext: { model: "deepseek-v4-flash" },
    };

    const preferred = buildWorkspaceMutationRecoveryPlan({
      ...input,
      remainingTokenBudget: 10_000,
    });
    const tight = buildWorkspaceMutationRecoveryPlan({
      ...input,
      remainingTokenBudget: 4_600,
    });

    expect(preferred?.outputTokens).toBe(4_096);
    expect(tight?.outputTokens).toBeGreaterThanOrEqual(1_024);
    expect(tight?.outputTokens).toBeLessThan(4_096);
  });

  it("keeps an explicitly smaller max output token limit as a hard cap", () => {
    const plan = buildWorkspaceMutationRecoveryPlan({
      messages: [{ role: "user", content: "Change api.go." }],
      tools: [toolDefinition("apply_patch")],
      remainingTokenBudget: 10_000,
      maxOutputTokens: 512,
      finalizationOutputTokens: 512,
      inputSafetyFactor: 1.2,
      tokenEstimateContext: { model: "deepseek-v4-flash" },
    });

    expect(plan?.outputTokens).toBe(512);
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
