import { describe, expect, it } from "vitest";
import type { Tool, ToolCallResult } from "./types.js";
import { ToolPoolAssembler } from "./tool-pool-assembler.js";
import { withToolContract } from "./tool-contract.js";

function createTool(name: string): Tool {
  return {
    definition: {
      name,
      description: `${name} tool`,
      parameters: {
        type: "object",
        properties: {},
      },
    },
    async execute(): Promise<ToolCallResult> {
      return {
        id: "",
        name,
        success: true,
        output: "",
        durationMs: 0,
      };
    },
  };
}

describe("ToolPoolAssembler", () => {
  it("filters entries by group and runtime flags", async () => {
    const baseTool = createTool("base");
    const dangerousTool = createTool("dangerous");
    const browserTool = createTool("browser_open");

    const assembler = new ToolPoolAssembler([
      { tool: baseTool },
      { tool: dangerousTool, when: (context) => Boolean(context.flags?.dangerous) },
      { tool: browserTool, group: "browser" },
    ]);

    const tools = await assembler.assemble({
      enabledGroups: ["system"],
      flags: { dangerous: false },
    });

    expect(tools.map((tool) => tool.definition.name)).toEqual(["base"]);
  });

  it("uses contract channel and safe-scope filters when present", async () => {
    const gatewayTool = withToolContract(createTool("gateway_only"), {
      family: "other",
      isReadOnly: true,
      isConcurrencySafe: true,
      needsPermission: false,
      riskLevel: "low",
      channels: ["gateway"],
      safeScopes: ["local-safe"],
      activityDescription: "Gateway only tool",
      resultSchema: { kind: "text", description: "plain text" },
      outputPersistencePolicy: "conversation",
    });
    const webTool = withToolContract(createTool("web_only"), {
      family: "other",
      isReadOnly: true,
      isConcurrencySafe: true,
      needsPermission: false,
      riskLevel: "low",
      channels: ["web"],
      safeScopes: ["web-safe"],
      activityDescription: "Web only tool",
      resultSchema: { kind: "text", description: "plain text" },
      outputPersistencePolicy: "conversation",
    });

    const assembler = new ToolPoolAssembler([
      { tool: gatewayTool },
      { tool: webTool },
    ]);

    const tools = await assembler.assemble({
      channel: "gateway",
      allowedSafeScopes: ["local-safe"],
    });

    expect(tools.map((tool) => tool.definition.name)).toEqual(["gateway_only"]);
  });

  it("supports blocked tool names in the shared security policy", async () => {
    const runCommand = withToolContract(createTool("run_command"), {
      family: "command-exec",
      isReadOnly: false,
      isConcurrencySafe: false,
      needsPermission: true,
      riskLevel: "critical",
      channels: ["gateway"],
      safeScopes: ["privileged"],
      activityDescription: "Run commands",
      resultSchema: { kind: "text", description: "plain text" },
      outputPersistencePolicy: "conversation",
    });

    const assembler = new ToolPoolAssembler([
      { tool: runCommand },
    ]);

    const tools = await assembler.assemble({
      channel: "gateway",
      allowedSafeScopes: ["privileged"],
      blockedToolNames: ["run_command"],
    });

    expect(tools).toHaveLength(0);
  });

  it("fails strict startup assembly when a tool has no governance contract", async () => {
    const assembler = new ToolPoolAssembler([{ tool: createTool("unguarded") }]);

    await expect(assembler.assemble({ requireToolContracts: true }))
      .rejects.toThrow(/Tool pool contains an ungoverned tool: unguarded/);
  });

  it("rejects duplicate names instead of silently choosing a factory entry", async () => {
    const repeated = createTool("shared");
    const assembler = new ToolPoolAssembler([
      { tool: repeated },
      {
        factory: async () => [
          createTool("extra"),
          createTool("shared"),
        ],
      },
    ]);

    await expect(assembler.assemble()).rejects.toThrow(/Duplicate tool in pool: shared/);
  });
});
