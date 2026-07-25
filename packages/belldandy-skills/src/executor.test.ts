import crypto from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import type { Tool, ToolCallRequest, ToolContext, ToolCallResult } from "./types.js";
import { ToolExecutor, DEFAULT_POLICY } from "./executor.js";
import { withToolContract } from "./tool-contract.js";
import { createToolSearchTool } from "./builtin/tool-search.js";
import { fetchTool } from "./builtin/fetch.js";
import { webSearchTool } from "./builtin/web-search/index.js";
import { resolveSafeScopesForChannel } from "./security-matrix.js";

// Mock 工具：echo
const echoTool: Tool = {
  definition: {
    name: "echo",
    description: "返回输入的消息",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "要返回的消息" },
      },
      required: ["message"],
    },
  },
  async execute(args, context): Promise<ToolCallResult> {
    return {
      id: "",
      name: "echo",
      success: true,
      output: `Echo: ${args.message}`,
      durationMs: 0,
    };
  },
};

const echoToolWithContract: Tool = withToolContract({
  definition: {
    name: "echo_contract",
    description: "带 contract 的 echo 工具",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "要返回的消息" },
      },
      required: ["message"],
    },
  },
  async execute(args): Promise<ToolCallResult> {
    return {
      id: "",
      name: "echo_contract",
      success: true,
      output: `Echo: ${args.message}`,
      durationMs: 0,
    };
  },
}, {
  family: "other",
  isReadOnly: true,
  isConcurrencySafe: true,
  needsPermission: false,
  riskLevel: "low",
  channels: ["gateway"],
  safeScopes: ["local-safe"],
  activityDescription: "Echo the provided message",
  resultSchema: {
    kind: "text",
    description: "Echo output text.",
  },
  outputPersistencePolicy: "conversation",
});

// Mock 工具：总是失败
const failTool: Tool = {
  definition: {
    name: "fail",
    description: "总是失败的工具",
    parameters: { type: "object", properties: {} },
  },
  async execute(args, context): Promise<ToolCallResult> {
    throw new Error("故意失败");
  },
};

const runtimeAwareTool: Tool = withToolContract({
  definition: {
    name: "runtime_aware",
    description: "回显运行时 launch context",
    parameters: { type: "object", properties: {} },
  },
  async execute(_args, context): Promise<ToolCallResult> {
    return {
      id: "",
      name: "runtime_aware",
      success: true,
      output: JSON.stringify({
        defaultCwd: context.defaultCwd,
        toolSet: context.launchSpec?.toolSet ?? [],
        permissionMode: context.launchSpec?.permissionMode,
        workspaceRevisionId: context.workspaceRevisionId,
        methods: context.agentCatalogPreferences?.methods ?? [],
        skills: context.agentCatalogPreferences?.skills ?? [],
      }),
      durationMs: 0,
    };
  },
}, {
  family: "other",
  isReadOnly: true,
  isConcurrencySafe: true,
  needsPermission: false,
  riskLevel: "low",
  channels: ["gateway"],
  safeScopes: ["local-safe"],
  activityDescription: "Echo runtime launch context",
  resultSchema: { kind: "text", description: "runtime launch context json" },
  outputPersistencePolicy: "conversation",
});

const writeToolWithContract: Tool = withToolContract({
  definition: {
    name: "write_contract",
    description: "带 workspace-write contract 的工具",
    parameters: { type: "object", properties: {} },
  },
  async execute(): Promise<ToolCallResult> {
    return {
      id: "",
      name: "write_contract",
      success: true,
      output: "written",
      durationMs: 0,
    };
  },
}, {
  family: "workspace-write",
  isReadOnly: false,
  isConcurrencySafe: false,
  needsPermission: true,
  riskLevel: "medium",
  channels: ["gateway"],
  safeScopes: ["local-safe"],
  activityDescription: "Write to workspace",
  resultSchema: { kind: "text", description: "write result" },
  outputPersistencePolicy: "artifact",
});

const execToolWithContract: Tool = withToolContract({
  definition: {
    name: "exec_contract",
    description: "带 command-exec contract 的工具",
    parameters: { type: "object", properties: {} },
  },
  async execute(): Promise<ToolCallResult> {
    return {
      id: "",
      name: "exec_contract",
      success: true,
      output: "executed",
      durationMs: 0,
    };
  },
}, {
  family: "command-exec",
  isReadOnly: false,
  isConcurrencySafe: false,
  needsPermission: true,
  riskLevel: "high",
  channels: ["gateway"],
  safeScopes: ["local-safe"],
  activityDescription: "Execute command",
  resultSchema: { kind: "text", description: "exec result" },
  outputPersistencePolicy: "conversation",
});

describe("ToolExecutor", () => {
  it("prefers same-turn select when tool_search already returned exact deferred matches", () => {
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
          output: String(args.goalId ?? ""),
          durationMs: 0,
        };
      },
    };
    const executor = new ToolExecutor({
      tools: [echoTool, deferredGoalTool],
      workspaceRoot: "/tmp/test",
      deferredToolNames: ["goal_checkpoint_request"],
    });

    const summary = executor.buildDeferredToolDiscoveryPromptSummary("default", "conv-1");

    expect(summary).toBeDefined();
    expect(summary).toContain("If the query already returns the exact deferred tool names you need, load them in the same turn");
    expect(summary).toContain("Only use `tool_search {\"expandFamilies\":[\"family_id\"]}` when you need to open a gated family");
  });

  it("should register and execute tools", async () => {
    const executor = new ToolExecutor({
      tools: [echoTool],
      workspaceRoot: "/tmp/test",
    });

    const request: ToolCallRequest = {
      id: "req-1",
      name: "echo",
      arguments: { message: "Hello" },
    };

    const result = await executor.execute(request, "conv-1");

    expect(result.success).toBe(true);
    expect(result.output).toBe("Echo: Hello");
    expect(result.id).toBe("req-1");
    expect(result.name).toBe("echo");
  });

  it("should pass abortSignal into tool context", async () => {
    const seenSignals: AbortSignal[] = [];
    const signalAwareTool: Tool = {
      definition: {
        name: "signal_aware",
        description: "记录传入的 abortSignal",
        parameters: { type: "object", properties: {} },
      },
      async execute(_args, context): Promise<ToolCallResult> {
        if (context.abortSignal) {
          seenSignals.push(context.abortSignal);
        }
        return {
          id: "",
          name: "signal_aware",
          success: true,
          output: "ok",
          durationMs: 0,
        };
      },
    };
    const executor = new ToolExecutor({
      tools: [signalAwareTool],
      workspaceRoot: "/tmp/test",
    });
    const controller = new AbortController();

    const result = await executor.execute({
      id: "req-signal-1",
      name: "signal_aware",
      arguments: {},
    }, "conv-1", undefined, undefined, undefined, undefined, {
      abortSignal: controller.signal,
    });

    expect(result.success).toBe(true);
    expect(seenSignals).toHaveLength(1);
    expect(seenSignals[0]).toBe(controller.signal);
  });

  it("should stop before running the tool when abortSignal is already aborted", async () => {
    const execute = vi.fn(async (): Promise<ToolCallResult> => ({
      id: "",
      name: "never_runs",
      success: true,
      output: "ok",
      durationMs: 0,
    }));
    const executor = new ToolExecutor({
      tools: [{
        definition: {
          name: "never_runs",
          description: "不应被执行",
          parameters: { type: "object", properties: {} },
        },
        execute,
      }],
      workspaceRoot: "/tmp/test",
    });
    const controller = new AbortController();
    controller.abort("Stopped by user.");

    const result = await executor.execute({
      id: "req-signal-2",
      name: "never_runs",
      arguments: {},
    }, "conv-1", undefined, undefined, undefined, undefined, {
      abortSignal: controller.signal,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toBe("Stopped by user.");
    expect(result.failureKind).toBe("environment_error");
  });

  it("should return error for unknown tool", async () => {
    const executor = new ToolExecutor({
      tools: [echoTool],
      workspaceRoot: "/tmp/test",
    });

    const request: ToolCallRequest = {
      id: "req-2",
      name: "unknown",
      arguments: {},
    };

    const result = await executor.execute(request, "conv-1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("未知工具");
    expect(result.failureKind).toBe("input_error");
  });

  it("should catch and report tool execution errors", async () => {
    const executor = new ToolExecutor({
      tools: [failTool],
      workspaceRoot: "/tmp/test",
    });

    const request: ToolCallRequest = {
      id: "req-3",
      name: "fail",
      arguments: {},
    };

    const result = await executor.execute(request, "conv-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("故意失败");
    expect(result.failureKind).toBe("unknown");
  });

  it("should return tool definitions for model", () => {
    const executor = new ToolExecutor({
      tools: [echoTool, failTool],
      workspaceRoot: "/tmp/test",
    });

    const definitions = executor.getDefinitions();

    expect(definitions).toHaveLength(2);
    expect(definitions[0].type).toBe("function");
    expect(definitions[0].function.name).toBe("echo");
  });

  it("should expose registered tool contracts", () => {
    const executor = new ToolExecutor({
      tools: [echoToolWithContract, echoTool],
      workspaceRoot: "/tmp/test",
    });

    const contracts = executor.getRegisteredToolContracts();

    expect(contracts).toHaveLength(1);
    expect(contracts[0]?.name).toBe("echo_contract");
    expect(contracts[0]?.riskLevel).toBe("low");
  });

  it("should filter visible tool contracts with the same availability rules", () => {
    const executor = new ToolExecutor({
      tools: [echoToolWithContract, failTool],
      workspaceRoot: "/tmp/test",
      isToolAllowedForAgent: (toolName, agentId) => {
        if (agentId === "restricted") {
          return toolName === "echo_contract";
        }
        return true;
      },
    });

    const contracts = executor.getContracts("restricted");

    expect(contracts).toHaveLength(1);
    expect(contracts[0]?.name).toBe("echo_contract");
  });

  it("passes the normalized launch role to the per-agent availability policy", async () => {
    const isToolAllowedForAgent = vi.fn((_toolName: string, _agentId?: string, role?: string) => role !== "commander");
    const executor = new ToolExecutor({
      tools: [echoToolWithContract],
      workspaceRoot: "/tmp/test",
      isToolAllowedForAgent,
    });
    const runtimeContext = { launchSpec: { role: "commander" as const } };

    expect(executor.getDefinitions("ops-coordinator", "conv-1", runtimeContext)).toEqual([]);
    expect(isToolAllowedForAgent).toHaveBeenCalledWith("echo_contract", "ops-coordinator", "commander");

    const result = await executor.execute(
      { id: "commander-role-blocked", name: "echo_contract", arguments: { message: "blocked" } },
      "conv-1",
      "ops-coordinator",
      undefined,
      undefined,
      undefined,
      runtimeContext,
    );
    expect(result.success).toBe(false);
  });

  it("should filter tool definitions by agent whitelist", () => {
    const executor = new ToolExecutor({
      tools: [echoTool, failTool],
      workspaceRoot: "/tmp/test",
      isToolAllowedForAgent: (toolName, agentId) => {
        if (agentId === "researcher") {
          return toolName === "echo";
        }
        return true;
      },
    });

    const definitions = executor.getDefinitions("researcher");

    expect(definitions).toHaveLength(1);
    expect(definitions[0].function.name).toBe("echo");
  });

  it("should enforce launchSpec toolSet and inject runtime launch context", async () => {
    const executor = new ToolExecutor({
      tools: [echoTool, failTool, runtimeAwareTool],
      workspaceRoot: "/tmp/test",
    });
    const runtimeContext = {
      workspaceRevisionId: "gateway-message-run-1",
      launchSpec: {
        cwd: "/tmp/test/subdir",
        toolSet: ["runtime_aware"],
        permissionMode: "confirm",
      },
    };

    const definitions = executor.getDefinitions("default", "conv-1", runtimeContext);
    expect(definitions.map((item) => item.function.name)).toEqual(["runtime_aware"]);
    expect(executor.getToolAvailability("fail", "default", "conv-1", runtimeContext)?.reasonCode).toBe("excluded-by-launch-toolset");

    const blocked = await executor.execute(
      { id: "req-toolset-blocked", name: "echo", arguments: { message: "blocked" } },
      "conv-1",
      "default",
      undefined,
      undefined,
      undefined,
      runtimeContext,
    );
    expect(blocked.success).toBe(false);
    expect(blocked.error).toContain("toolSet");

    const result = await executor.execute(
      { id: "req-toolset-allowed", name: "runtime_aware", arguments: {} },
      "conv-1",
      "default",
      undefined,
      undefined,
      undefined,
      runtimeContext,
    );

    expect(result.success).toBe(true);
    expect(JSON.parse(result.output)).toEqual({
      defaultCwd: "/tmp/test/subdir",
      toolSet: ["runtime_aware"],
      permissionMode: "confirm",
      workspaceRevisionId: "gateway-message-run-1",
      methods: [],
      skills: [],
    });
  });

  it("gives launchSpec toolDeny precedence over its toolSet", async () => {
    const executor = new ToolExecutor({
      tools: [runtimeAwareTool],
      workspaceRoot: "/tmp/test",
    });
    const runtimeContext = {
      launchSpec: {
        toolSet: ["runtime_aware"],
        toolDeny: ["runtime_aware"],
      },
    };

    expect(executor.getDefinitions("default", "conv-1", runtimeContext)).toEqual([]);
    expect(executor.getToolAvailability("runtime_aware", "default", "conv-1", runtimeContext)).toMatchObject({
      available: false,
      reasonCode: "denied-by-launch-tool-deny",
    });

    const result = await executor.execute(
      { id: "req-tool-deny", name: "runtime_aware", arguments: {} },
      "conv-1",
      "default",
      undefined,
      undefined,
      undefined,
      runtimeContext,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("toolDeny");
  });

  it("should inject lightweight agent catalog preferences into tool context", async () => {
    const executor = new ToolExecutor({
      tools: [runtimeAwareTool],
      workspaceRoot: "/tmp/test",
      getAgentCatalogPreferences: (agentId) => agentId === "coder"
        ? { methods: ["Review-Checklist.md"], skills: ["repo-map"] }
        : undefined,
    });

    const result = await executor.execute(
      { id: "req-tool-pref", name: "runtime_aware", arguments: {} },
      "conv-1",
      "coder",
    );

    expect(result.success).toBe(true);
    expect(JSON.parse(result.output)).toEqual({
      defaultCwd: undefined,
      toolSet: [],
      permissionMode: undefined,
      methods: ["Review-Checklist.md"],
      skills: ["repo-map"],
    });
  });

  it("should enforce launchSpec permissionMode=plan as read-only only", () => {
    const executor = new ToolExecutor({
      tools: [echoToolWithContract, writeToolWithContract],
      workspaceRoot: "/tmp/test",
    });

    const definitions = executor.getDefinitions("default", "conv-1", {
      launchSpec: {
        permissionMode: "plan",
      },
    });

    expect(definitions.map((item) => item.function.name)).toEqual(["echo_contract"]);
    expect(executor.getToolAvailability("write_contract", "default", "conv-1", {
      launchSpec: { permissionMode: "plan" },
    })?.reasonCode).toBe("blocked-by-launch-permission-mode");
  });

  it("should allow workspace writes but still block exec in permissionMode=acceptEdits", () => {
    const executor = new ToolExecutor({
      tools: [writeToolWithContract, execToolWithContract],
      workspaceRoot: "/tmp/test",
    });

    const definitions = executor.getDefinitions("default", "conv-1", {
      launchSpec: {
        permissionMode: "acceptEdits",
      },
    });

    expect(definitions.map((item) => item.function.name)).toEqual(["write_contract"]);
    expect(executor.getToolAvailability("exec_contract", "default", "conv-1", {
      launchSpec: { permissionMode: "acceptEdits" },
    })?.reasonCode).toBe("blocked-by-launch-permission-mode");
  });

  it("only exposes confirm-mode tools when an exact pending permission controller can deny or allow them", async () => {
    const execute = vi.fn(async () => ({
      id: "",
      name: "confirm_write",
      success: true,
      output: "written",
      durationMs: 1,
    }));
    const confirmTool = withToolContract({
      definition: {
        name: "confirm_write",
        description: "requires a per-run confirmation",
        parameters: { type: "object", properties: {} },
      },
      execute,
    }, {
      family: "workspace-write",
      isReadOnly: false,
      isConcurrencySafe: false,
      needsPermission: true,
      riskLevel: "high",
      channels: ["gateway"],
      safeScopes: ["local-safe"],
      activityDescription: "Write after explicit confirmation",
      resultSchema: { kind: "text", description: "write result" },
      outputPersistencePolicy: "artifact",
    });
    const runtimeContext = {
      agentRunId: "run-confirm-1",
      launchSpec: { permissionMode: "confirm" as const },
    };
    const unavailable = new ToolExecutor({ tools: [confirmTool], workspaceRoot: "/tmp/test" });
    expect(unavailable.getDefinitions("default", "conv-1", runtimeContext)).toEqual([]);

    const request = vi.fn(async () => "allow" as const);
    const allowed = new ToolExecutor({
      tools: [confirmTool],
      workspaceRoot: "/tmp/test",
      permissionController: { request },
    });
    expect(allowed.getDefinitions("default", "conv-1", runtimeContext).map((item) => item.function.name))
      .toEqual(["confirm_write"]);
    await expect(allowed.execute(
      { id: "tool-confirm-1", name: "confirm_write", arguments: {} },
      "conv-1",
      "default",
      undefined,
      undefined,
      undefined,
      runtimeContext,
    )).resolves.toMatchObject({ success: true });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "conv-1",
      agentRunId: "run-confirm-1",
      toolCallId: "tool-confirm-1",
      toolName: "confirm_write",
    }));
    expect(execute).toHaveBeenCalledTimes(1);

    const denied = new ToolExecutor({
      tools: [confirmTool],
      workspaceRoot: "/tmp/test",
      permissionController: { request: async () => "deny" },
    });
    await expect(denied.execute(
      { id: "tool-confirm-2", name: "confirm_write", arguments: {} },
      "conv-1",
      "default",
      undefined,
      undefined,
      undefined,
      runtimeContext,
    )).resolves.toMatchObject({ success: false, failureKind: "permission_or_policy" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("should enforce launchSpec role policy by tool family and risk level", () => {
    const executor = new ToolExecutor({
      tools: [echoToolWithContract, writeToolWithContract, execToolWithContract],
      workspaceRoot: "/tmp/test",
    });

    const runtimeContext = {
      launchSpec: {
        role: "researcher" as const,
        allowedToolFamilies: ["other"],
        maxToolRiskLevel: "medium" as const,
        permissionMode: "confirm" as const,
        policySummary: "researcher role: read/search only",
      },
    };

    const definitions = executor.getDefinitions("researcher", "conv-1", runtimeContext);
    expect(definitions.map((item) => item.function.name)).toEqual(["echo_contract"]);
    expect(executor.getToolAvailability("write_contract", "researcher", "conv-1", runtimeContext)?.reasonCode).toBe("blocked-by-launch-role-policy");
    expect(executor.getToolAvailability("exec_contract", "researcher", "conv-1", {
      launchSpec: {
        role: "verifier",
        allowedToolFamilies: ["command-exec"],
        maxToolRiskLevel: "medium",
        permissionMode: "confirm",
      },
    })?.reasonCode).toBe("blocked-by-launch-role-policy");
  });

  it("should call audit logger", async () => {
    const auditLogs: any[] = [];
    const executor = new ToolExecutor({
      tools: [echoTool],
      workspaceRoot: "/tmp/test",
      auditLogger: (log) => auditLogs.push(log),
    });

    await executor.execute(
      { id: "req-4", name: "echo", arguments: { message: "test" } },
      "conv-audit"
    );

    await vi.waitFor(() => expect(auditLogs).toHaveLength(1));
    expect(auditLogs[0].toolName).toBe("echo");
    expect(auditLogs[0].conversationId).toBe("conv-audit");
    expect(auditLogs[0].success).toBe(true);
  });

  it("should fingerprint redacted sensitive arguments without retaining the raw object", async () => {
    const auditLogs: any[] = [];
    const executor = new ToolExecutor({
      tools: [echoTool],
      workspaceRoot: "/tmp/test",
      auditLogger: (log) => auditLogs.push(log),
    });

    await executor.execute(
      { id: "req-5", name: "echo", arguments: { message: "hi", api_key: "secret123" } },
      "conv-1"
    );

    await vi.waitFor(() => expect(auditLogs).toHaveLength(1));
    const redactedArguments = JSON.stringify({ message: "hi", api_key: "[REDACTED]" });
    expect(auditLogs[0]).not.toHaveProperty("arguments");
    expect(auditLogs[0].argumentsSummary).toEqual({
      bytes: Buffer.byteLength(redactedArguments, "utf-8"),
      sha256: crypto.createHash("sha256").update(redactedArguments, "utf-8").digest("hex"),
    });
    expect(JSON.stringify(auditLogs[0])).not.toContain("secret123");
  });

  it("deeply redacts audit data and keeps a completed tool result when the audit consumer throws", async () => {
    const auditLogs: any[] = [];
    const sensitiveTool: Tool = {
      definition: {
        name: "sensitive_result",
        description: "returns a sensitive-looking diagnostic result",
        parameters: { type: "object", properties: {} },
      },
      async execute(): Promise<ToolCallResult> {
        return {
          id: "",
          name: "sensitive_result",
          success: true,
          output: "Authorization: Bearer tool-output-secret",
          durationMs: 0,
        };
      },
    };
    const executor = new ToolExecutor({
      tools: [sensitiveTool],
      workspaceRoot: "/tmp/test",
      auditLogger: (log) => {
        auditLogs.push(log);
        throw new Error("audit sink unavailable");
      },
    });

    const result = await executor.execute({
      id: "req-audit-isolation",
      name: "sensitive_result",
      arguments: {
        nested: { headers: { authorization: "Bearer nested-secret" } },
      },
    }, "conv-audit");

    expect(result.success).toBe(true);
    expect(result.output).toContain("tool-output-secret");
    await vi.waitFor(() => expect(auditLogs).toHaveLength(1));
    expect(auditLogs).toHaveLength(1);
    expect(JSON.stringify(auditLogs[0])).not.toContain("nested-secret");
    expect(JSON.stringify(auditLogs[0])).not.toContain("tool-output-secret");
  });

  it("redacts non-Bearer headers and URL userinfo from audit text without changing the Tool result", async () => {
    const auditLogs: any[] = [];
    const credentialOutput = [
      "Authorization: Basic dXNlcjpwYXNz",
      "request failed at https://owner:url-password@example.test/private",
    ].join("\n");
    const credentialError = 'Proxy-Authorization: Digest username="owner", response="digest-secret"';
    const credentialTool: Tool = {
      definition: {
        name: "credential_diagnostic",
        description: "returns a credential-shaped diagnostic result",
        parameters: { type: "object", properties: {} },
      },
      async execute(): Promise<ToolCallResult> {
        return {
          id: "",
          name: "credential_diagnostic",
          success: false,
          output: credentialOutput,
          error: credentialError,
          failureKind: "environment_error",
          durationMs: 0,
        };
      },
    };
    const executor = new ToolExecutor({
      tools: [credentialTool],
      workspaceRoot: "/tmp/test",
      auditLogger: (log) => auditLogs.push(log),
    });

    const result = await executor.execute({
      id: "req-audit-credential-schemes",
      name: "credential_diagnostic",
      arguments: {},
    }, "conv-audit");

    expect(result.output).toBe(credentialOutput);
    expect(result.error).toBe(credentialError);
    await vi.waitFor(() => expect(auditLogs).toHaveLength(1));
    const serializedAudit = JSON.stringify(auditLogs[0]);
    expect(serializedAudit).not.toContain("dXNlcjpwYXNz");
    expect(serializedAudit).not.toContain("digest-secret");
    expect(serializedAudit).not.toContain("url-password");
  });

  it("fingerprints audit output and errors without retaining unknown business secrets", async () => {
    const auditLogs: any[] = [];
    const output = "tenantOpaqueValue=customer-private-output";
    const error = "internalMarker=customer-private-error";
    const diagnosticTool: Tool = {
      definition: {
        name: "opaque_diagnostic",
        description: "returns opaque business diagnostics",
        parameters: { type: "object", properties: {} },
      },
      async execute(): Promise<ToolCallResult> {
        return {
          id: "",
          name: "opaque_diagnostic",
          success: false,
          output,
          error,
          failureKind: "business_logic_error",
          durationMs: 0,
        };
      },
    };
    const executor = new ToolExecutor({
      tools: [diagnosticTool],
      workspaceRoot: "/tmp/test",
      auditLogger: (log) => auditLogs.push(log),
    });

    const result = await executor.execute({
      id: "req-audit-opaque-content",
      name: "opaque_diagnostic",
      arguments: {},
    }, "conv-audit");

    expect(result.output).toBe(output);
    expect(result.error).toBe(error);
    await vi.waitFor(() => expect(auditLogs).toHaveLength(1));
    expect(auditLogs[0]).not.toHaveProperty("output");
    expect(auditLogs[0]).not.toHaveProperty("error");
    expect(auditLogs[0]).toMatchObject({
      outputSummary: {
        bytes: Buffer.byteLength(output, "utf-8"),
        sha256: crypto.createHash("sha256").update(output, "utf-8").digest("hex"),
      },
      errorSummary: {
        bytes: Buffer.byteLength(error, "utf-8"),
        sha256: crypto.createHash("sha256").update(error, "utf-8").digest("hex"),
      },
      failureKind: "business_logic_error",
    });
    expect(JSON.stringify(auditLogs[0])).not.toContain("customer-private");
  });

  it("fingerprints audit arguments and retains only the ackMatched routing flag", async () => {
    const auditLogs: any[] = [];
    const argumentsValue = {
      ackMatched: true,
      tenantOpaqueValue: "customer-private-argument",
    };
    const serializedArguments = JSON.stringify(argumentsValue);
    const argumentTool: Tool = {
      definition: {
        name: "argument_diagnostic",
        description: "accepts opaque business diagnostics",
        parameters: { type: "object", properties: {} },
      },
      async execute(): Promise<ToolCallResult> {
        return {
          id: "",
          name: "argument_diagnostic",
          success: true,
          output: "ok",
          durationMs: 0,
        };
      },
    };
    const executor = new ToolExecutor({
      tools: [argumentTool],
      workspaceRoot: "/tmp/test",
      auditLogger: (log) => auditLogs.push(log),
    });

    const result = await executor.execute({
      id: "req-audit-opaque-arguments",
      name: "argument_diagnostic",
      arguments: argumentsValue,
    }, "conv-audit");

    expect(result.success).toBe(true);
    await vi.waitFor(() => expect(auditLogs).toHaveLength(1));
    expect(auditLogs[0]).not.toHaveProperty("arguments");
    expect(auditLogs[0]).toMatchObject({
      safeArguments: { ackMatched: true },
      argumentsSummary: {
        bytes: Buffer.byteLength(serializedArguments, "utf-8"),
        sha256: crypto.createHash("sha256").update(serializedArguments, "utf-8").digest("hex"),
      },
    });
    expect(JSON.stringify(auditLogs[0])).not.toContain("customer-private-argument");
  });

  it("returns a Tool result before the audit sink executes", async () => {
    let resultReturned = false;
    let auditRanBeforeResult = false;
    const auditLogger = vi.fn(() => {
      auditRanBeforeResult = !resultReturned;
    });
    const executor = new ToolExecutor({
      tools: [echoTool],
      workspaceRoot: "/tmp/test",
      auditLogger,
    });

    const result = await executor.execute(
      { id: "req-async-audit", name: "echo", arguments: { message: "test" } },
      "conv-audit",
    );
    resultReturned = true;

    expect(result.success).toBe(true);
    await vi.waitFor(() => expect(auditLogger).toHaveBeenCalledTimes(1));
    expect(auditRanBeforeResult).toBe(false);
    expect(executor.getAuditRuntimeSnapshot()).toMatchObject({
      queuedCount: 0,
      dispatchedCount: 1,
      failedCount: 0,
    });
  });

  it("keeps the audit queue bounded without changing Tool results", async () => {
    let releaseFirstAudit: (() => void) | undefined;
    let markFirstAuditStarted: (() => void) | undefined;
    const firstAuditStarted = new Promise<void>((resolve) => {
      markFirstAuditStarted = resolve;
    });
    let auditCallCount = 0;
    const executor = new ToolExecutor({
      tools: [echoTool],
      workspaceRoot: "/tmp/test",
      maxAuditQueueSize: 1,
      auditLogger: async () => {
        auditCallCount += 1;
        if (auditCallCount !== 1) return;
        markFirstAuditStarted?.();
        await new Promise<void>((resolve) => {
          releaseFirstAudit = resolve;
        });
      },
    });

    await executor.execute({ id: "req-audit-1", name: "echo", arguments: { message: "one" } }, "conv-audit");
    await firstAuditStarted;
    const second = await executor.execute({ id: "req-audit-2", name: "echo", arguments: { message: "two" } }, "conv-audit");
    const third = await executor.execute({ id: "req-audit-3", name: "echo", arguments: { message: "three" } }, "conv-audit");

    expect(second.success).toBe(true);
    expect(third.success).toBe(true);
    expect(executor.getAuditRuntimeSnapshot()).toMatchObject({
      active: true,
      queuedCount: 1,
      maxQueueSize: 1,
      droppedCount: 1,
    });

    releaseFirstAudit?.();
    await vi.waitFor(() => expect(executor.getAuditRuntimeSnapshot()).toMatchObject({
      queuedCount: 0,
      dispatchedCount: 2,
    }));
  });

  it("should execute multiple tools in parallel", async () => {
    const executor = new ToolExecutor({
      tools: [echoTool],
      workspaceRoot: "/tmp/test",
    });

    const requests: ToolCallRequest[] = [
      { id: "req-a", name: "echo", arguments: { message: "A" } },
      { id: "req-b", name: "echo", arguments: { message: "B" } },
    ];

    const results = await executor.executeAll(requests, "conv-batch");

    expect(results).toHaveLength(2);
    expect(results[0].output).toBe("Echo: A");
    expect(results[1].output).toBe("Echo: B");
  });

  it("should reject an oversized batch before executing any tool", async () => {
    const execute = vi.fn(async (): Promise<ToolCallResult> => ({
      id: "",
      name: "counted",
      success: true,
      output: "unexpected",
      durationMs: 0,
    }));
    const executor = new ToolExecutor({
      tools: [{
        definition: {
          name: "counted",
          description: "count executions",
          parameters: { type: "object", properties: {} },
        },
        execute,
      }],
      workspaceRoot: "/tmp/test",
      maxBatchToolCalls: 2,
    });
    const requests: ToolCallRequest[] = Array.from({ length: 3 }, (_, index) => ({
      id: `req-batch-${index}`,
      name: "counted",
      arguments: {},
    }));

    const results = await executor.executeAll(requests, "conv-batch-limit");

    expect(execute).not.toHaveBeenCalled();
    expect(results).toHaveLength(3);
    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        success: false,
        failureKind: "permission_or_policy",
        error: expect.stringContaining("batch size 3 exceeds limit 2"),
      }),
    ]));
  });

  it("should bound executeAll concurrency while preserving result order", async () => {
    let active = 0;
    let maxActive = 0;
    const executor = new ToolExecutor({
      tools: [{
        definition: {
          name: "limited",
          description: "track concurrent executions",
          parameters: {
            type: "object",
            properties: { index: { type: "number" } },
            required: ["index"],
          },
        },
        async execute(args): Promise<ToolCallResult> {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 10));
          active -= 1;
          return {
            id: "",
            name: "limited",
            success: true,
            output: String(args.index),
            durationMs: 0,
          };
        },
      }],
      workspaceRoot: "/tmp/test",
      maxBatchToolCalls: 8,
      maxConcurrentToolCalls: 2,
    });
    const requests: ToolCallRequest[] = Array.from({ length: 5 }, (_, index) => ({
      id: `req-concurrency-${index}`,
      name: "limited",
      arguments: { index },
    }));

    const results = await executor.executeAll(requests, "conv-concurrency-limit");

    expect(maxActive).toBe(2);
    expect(results.map((result) => result.output)).toEqual(["0", "1", "2", "3", "4"]);
  });

  it("should preflight-correct simple argument types before execution", async () => {
    const executor = new ToolExecutor({
      tools: [echoTool],
      workspaceRoot: "/tmp/test",
    });

    const result = await executor.execute(
      { id: "req-preflight-correct", name: "echo", arguments: { message: 123 as any } },
      "conv-1",
    );

    expect(result.success).toBe(true);
    expect(result.output).toBe("Echo: 123");
    expect(result.metadata).toMatchObject({
      repairAction: "tool_arguments_corrected",
      argumentValidation: {
        corrected: true,
        blocked: false,
        corrections: expect.arrayContaining([
          expect.stringContaining("message"),
        ]),
      },
    });
  });

  it("should block execution when required arguments are still missing after preflight", async () => {
    const executeSpy = vi.fn(async (args): Promise<ToolCallResult> => ({
      id: "",
      name: "echo_required",
      success: true,
      output: `Echo: ${String(args.message ?? "")}`,
      durationMs: 0,
    }));
    const requiredTool: Tool = {
      definition: {
        name: "echo_required",
        description: "返回必填消息",
        parameters: {
          type: "object",
          properties: {
            message: { type: "string", description: "要返回的消息" },
          },
          required: ["message"],
        },
      },
      execute: executeSpy,
    };
    const executor = new ToolExecutor({
      tools: [requiredTool],
      workspaceRoot: "/tmp/test",
    });

    const result = await executor.execute(
      { id: "req-preflight-block", name: "echo_required", arguments: { message: "   " } },
      "conv-1",
    );

    expect(executeSpy).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.failureKind).toBe("input_error");
    expect(result.error).toContain("缺少必填参数 `message`");
    expect(result.metadata).toMatchObject({
      repairAction: "tool_arguments_invalid",
      argumentValidation: {
        blocked: true,
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: "message",
            code: "missing_required",
          }),
        ]),
        correctionHints: expect.arrayContaining([
          expect.stringContaining("message"),
        ]),
      },
    });
  });

  it("should reject tool execution outside agent whitelist", async () => {
    const executor = new ToolExecutor({
      tools: [echoTool, failTool],
      workspaceRoot: "/tmp/test",
      isToolAllowedForAgent: (toolName, agentId) => {
        if (agentId === "researcher") {
          return toolName === "echo";
        }
        return true;
      },
    });

    const result = await executor.execute(
      { id: "req-6", name: "fail", arguments: {} },
      "conv-1",
      "researcher",
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("当前 Agent 白名单");
    expect(result.failureKind).toBe("permission_or_policy");
  });

  it("should allow governed bridge internal runtime to bypass agent whitelist for bridge control tools", async () => {
    const bridgeSessionStartTool: Tool = {
      definition: {
        name: "bridge_session_start",
        description: "start governed bridge session",
        parameters: { type: "object", properties: {} },
      },
      async execute(): Promise<ToolCallResult> {
        return {
          id: "",
          name: "bridge_session_start",
          success: true,
          output: "started",
          durationMs: 0,
        };
      },
    };

    const executor = new ToolExecutor({
      tools: [bridgeSessionStartTool],
      workspaceRoot: "/tmp/test",
      isToolAllowedForAgent: () => false,
    });

    const result = await executor.execute(
      { id: "req-6b", name: "bridge_session_start", arguments: {} },
      "conv-1",
      "coder",
      undefined,
      undefined,
      undefined,
      {
        bridgeGovernanceTaskId: "task_bridge_1",
        agentWhitelistMode: "governed_bridge_internal",
        launchSpec: {
          bridgeSubtask: { kind: "review" },
        },
      },
    );

    expect(result.success).toBe(true);
    expect(result.output).toBe("started");
  });

  it("should keep non-bridge tools blocked under governed bridge internal whitelist bypass", async () => {
    const executor = new ToolExecutor({
      tools: [echoTool],
      workspaceRoot: "/tmp/test",
      isToolAllowedForAgent: () => false,
    });

    const result = await executor.execute(
      { id: "req-6c", name: "echo", arguments: { message: "denied" } },
      "conv-1",
      "coder",
      undefined,
      undefined,
      undefined,
      {
        bridgeGovernanceTaskId: "task_bridge_1",
        agentWhitelistMode: "governed_bridge_internal",
        launchSpec: {
          bridgeSubtask: { kind: "review" },
        },
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("当前 Agent 白名单");
  });

  it("should keep default behavior when no whitelist is configured", () => {
    const executor = new ToolExecutor({
      tools: [echoTool, failTool],
      workspaceRoot: "/tmp/test",
      isToolAllowedForAgent: () => true,
    });

    const definitions = executor.getDefinitions("default");

    expect(definitions).toHaveLength(2);
  });

  it("should keep always enabled tools available even when disabled by runtime config", async () => {
    const executor = new ToolExecutor({
      tools: [echoTool, failTool],
      workspaceRoot: "/tmp/test",
      alwaysEnabledTools: ["echo"],
      isToolDisabled: (toolName) => toolName === "echo" || toolName === "fail",
    });

    const definitions = executor.getDefinitions();
    expect(definitions).toHaveLength(1);
    expect(definitions[0].function.name).toBe("echo");

    const result = await executor.execute(
      { id: "req-7", name: "echo", arguments: { message: "still works" } },
      "conv-1",
    );
    expect(result.success).toBe(true);
    expect(result.output).toBe("Echo: still works");
  });

  it("should still enforce agent whitelist for always enabled tools", async () => {
    const executor = new ToolExecutor({
      tools: [echoTool],
      workspaceRoot: "/tmp/test",
      alwaysEnabledTools: ["echo"],
      isToolDisabled: (toolName) => toolName === "echo",
      isToolAllowedForAgent: (_toolName, agentId) => agentId !== "blocked-agent",
    });

    const result = await executor.execute(
      { id: "req-8", name: "echo", arguments: { message: "denied" } },
      "conv-1",
      "blocked-agent",
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("当前 Agent 白名单");
  });

  it("should hide and block conversation-scoped tools outside allowed conversations", async () => {
    const goalTool: Tool = {
      definition: {
        name: "goal_init",
        description: "goal bootstrap tool",
        parameters: { type: "object", properties: {} },
      },
      async execute(): Promise<ToolCallResult> {
        return {
          id: "",
          name: "goal_init",
          success: true,
          output: "ok",
          durationMs: 0,
        };
      },
    };

    const executor = new ToolExecutor({
      tools: [echoTool, goalTool],
      workspaceRoot: "/tmp/test",
      isToolAllowedInConversation: (toolName, conversationId) => {
        if (toolName !== "goal_init") return true;
        return conversationId.startsWith("goal:");
      },
    });

    const normalDefinitions = executor.getDefinitions("default", "conv-1");
    expect(normalDefinitions.map((item) => item.function.name)).toEqual(["echo"]);

    const goalDefinitions = executor.getDefinitions("default", "goal:goal_alpha");
    expect(goalDefinitions.map((item) => item.function.name)).toContain("goal_init");

    const blocked = await executor.execute(
      { id: "req-goal-1", name: "goal_init", arguments: {} },
      "conv-1",
    );
    expect(blocked.success).toBe(false);
    expect(blocked.error).toContain("当前会话");
  });

  it("should enforce contract access policy for definitions and execution", async () => {
    const executor = new ToolExecutor({
      tools: [echoToolWithContract],
      workspaceRoot: "/tmp/test",
      contractAccessPolicy: {
        channel: "gateway",
        allowedSafeScopes: ["local-safe"],
        blockedToolNames: ["echo_contract"],
      },
    });

    expect(executor.getDefinitions()).toHaveLength(0);
    expect(executor.getToolAvailability("echo_contract")).toMatchObject({
      available: false,
      reasonCode: "blocked-by-security-matrix",
    });

    const result = await executor.execute(
      { id: "req-9", name: "echo_contract", arguments: { message: "denied" } },
      "conv-1",
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("安全矩阵");
  });

  it("should override contract channel evaluation with runtime request channel", async () => {
    const executor = new ToolExecutor({
      tools: [echoToolWithContract],
      workspaceRoot: "/tmp/test",
      contractAccessPolicy: {
        channel: "gateway",
        allowedSafeScopes: resolveSafeScopesForChannel("gateway"),
      },
    });

    expect(executor.getDefinitions(undefined, undefined, { channel: "gateway" })).toHaveLength(1);
    expect(executor.getDefinitions(undefined, undefined, { channel: "web" })).toHaveLength(0);
    expect(executor.getToolAvailability("echo_contract", undefined, undefined, { channel: "web" })).toMatchObject({
      available: false,
      reasonCode: "unsupported-channel",
      contractReason: "channel",
    });

    const result = await executor.execute(
      { id: "req-runtime-web", name: "echo_contract", arguments: { message: "denied" } },
      "conv-1",
      undefined,
      undefined,
      undefined,
      undefined,
      { channel: "web" },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("不允许在当前端使用");
  });

  it("should expose availability reasons for registered tools", () => {
    const goalTool = withToolContract({
      definition: {
        name: "goal_init",
        description: "goal bootstrap tool",
        parameters: { type: "object", properties: {} },
      },
      async execute(): Promise<ToolCallResult> {
        return {
          id: "",
          name: "goal_init",
          success: true,
          output: "ok",
          durationMs: 0,
        };
      },
    }, {
      family: "other",
      isReadOnly: true,
      isConcurrencySafe: true,
      needsPermission: false,
      riskLevel: "low",
      channels: ["gateway"],
      safeScopes: ["local-safe"],
      activityDescription: "Goal tool",
      resultSchema: { kind: "text", description: "plain text" },
      outputPersistencePolicy: "conversation",
    });

    const executor = new ToolExecutor({
      tools: [echoToolWithContract, goalTool],
      workspaceRoot: "/tmp/test",
      isToolAllowedForAgent: (toolName, agentId) => agentId !== "restricted" || toolName === "goal_init",
      isToolAllowedInConversation: (toolName, conversationId) => toolName !== "goal_init" || conversationId.startsWith("goal:"),
    });

    expect(executor.getToolAvailability("echo_contract", "restricted")?.reasonCode).toBe("not-in-agent-whitelist");
    expect(executor.getToolAvailability("goal_init", "restricted", "conv-1")?.reasonCode).toBe("conversation-restricted");

    const availabilities = executor.getRegisteredToolAvailabilities("restricted", "conv-1");
    expect(availabilities).toHaveLength(2);
    expect(availabilities.some((item) => item.reasonCode === "not-in-agent-whitelist")).toBe(true);
    expect(availabilities.some((item) => item.reasonCode === "conversation-restricted")).toBe(true);
  });

  it("should support silent replacement for dynamic tools", () => {
    const warns: string[] = [];
    const replacementTool: Tool = {
      ...echoTool,
      async execute(args): Promise<ToolCallResult> {
        return {
          id: "",
          name: "echo",
          success: true,
          output: `Replacement: ${args.message}`,
          durationMs: 0,
        };
      },
    };
    const executor = new ToolExecutor({
      tools: [echoTool],
      workspaceRoot: "/tmp/test",
      logger: {
        info() {},
        warn(message) { warns.push(message); },
        error() {},
      },
    });

    executor.registerTool(replacementTool, { silentReplace: true });

    expect(warns).toHaveLength(0);
    expect(executor.hasTool("echo")).toBe(true);
  });

  it("rejects duplicate registrations unless the caller uses the explicit replacement boundary", () => {
    const executor = new ToolExecutor({
      tools: [echoTool],
      workspaceRoot: "/tmp/test",
    });

    expect(() => executor.registerTool({ ...echoTool })).toThrow(/Duplicate tool registration: echo/);
    expect(executor.getRegistryInventory()).toMatchObject({
      totalToolCount: 1,
      replacementCount: 0,
      originCounts: { builtin: 1 },
    });
  });

  it("fails closed for ungoverned tools in a strict runtime and keeps a diagnosable inventory", () => {
    expect(() => new ToolExecutor({
      tools: [echoTool],
      workspaceRoot: "/tmp/test",
      requireToolContracts: true,
    })).toThrow(/missing a ToolContract/);

    const executor = new ToolExecutor({
      tools: [echoToolWithContract],
      workspaceRoot: "/tmp/test",
      requireToolContracts: true,
    });
    executor.registerTool(withToolContract({
      ...echoTool,
      definition: { ...echoTool.definition, name: "mcp_echo" },
    }, {
      family: "other",
      isReadOnly: true,
      isConcurrencySafe: true,
      needsPermission: true,
      riskLevel: "high",
      channels: ["gateway"],
      safeScopes: ["remote-safe"],
      activityDescription: "External MCP echo",
      resultSchema: { kind: "text", description: "echo text" },
      outputPersistencePolicy: "conversation",
    }), { origin: "mcp" });

    expect(executor.getRegistryInventory()).toMatchObject({
      totalToolCount: 2,
      governedToolCount: 2,
      catalogGeneration: 2,
      originCounts: { builtin: 1, mcp: 1 },
      missingContractNames: [],
      contractNameMismatchNames: [],
    });
  });

  it("should notify when a conversation token counter is attached", () => {
    const onTokenCounterSet = vi.fn();
    const counter = {
      start() {},
      stop() {
        return { name: "test", inputTokens: 0, outputTokens: 0, totalTokens: 0, durationMs: 0 };
      },
      list() {
        return [];
      },
      notifyUsage() {},
      cleanup() {
        return [];
      },
    };
    const executor = new ToolExecutor({
      tools: [echoTool],
      workspaceRoot: "/tmp/test",
      onTokenCounterSet,
    });

    executor.setTokenCounter("conv-1", counter);

    expect(onTokenCounterSet).toHaveBeenCalledTimes(1);
    expect(onTokenCounterSet).toHaveBeenCalledWith("conv-1", counter);
    expect(executor.getTokenCounter("conv-1")).toBe(counter);
  });

  it("releases per-conversation token counters and loaded-tool cache idempotently", () => {
    const executor = new ToolExecutor({
      tools: [echoTool],
      workspaceRoot: "/tmp/test",
    });
    const counter = {
      start() {},
      stop() {
        return { name: "test", inputTokens: 0, outputTokens: 0, totalTokens: 0, durationMs: 0 };
      },
      list() {
        return [];
      },
      notifyUsage() {},
      cleanup() {
        return [];
      },
    };
    executor.setTokenCounter("conv-release", counter);
    (executor as any).loadedDeferredToolNames.set("conv-release", new Set(["fixture"]));

    executor.releaseConversation("conv-release");
    executor.releaseConversation("conv-release");

    expect(executor.getTokenCounter("conv-release")).toBeUndefined();
    expect((executor as any).loadedDeferredToolNames.has("conv-release")).toBe(false);
  });

  it("isolates tool conversation cleanup failures and continues releasing state", () => {
    const logger = { warn: vi.fn() };
    const successfulRelease = vi.fn();
    const failingTool = {
      ...echoTool,
      definition: { ...echoTool.definition, name: "failing_release" },
      releaseConversation() {
        throw new Error("fixture release failure");
      },
    } as Tool & { releaseConversation(conversationId: string): void };
    const successfulTool = {
      ...echoTool,
      definition: { ...echoTool.definition, name: "successful_release" },
      releaseConversation: successfulRelease,
    } as Tool & { releaseConversation(conversationId: string): void };
    const executor = new ToolExecutor({
      tools: [failingTool, successfulTool],
      workspaceRoot: "/tmp/test",
      logger,
    });
    const counter = {
      start() {},
      stop() {
        return { name: "test", inputTokens: 0, outputTokens: 0, totalTokens: 0, durationMs: 0 };
      },
      list() {
        return [];
      },
      notifyUsage() {},
      cleanup() {
        return [];
      },
    };
    executor.setTokenCounter("conv-tool-release", counter);

    expect(() => executor.releaseConversation("conv-tool-release")).not.toThrow();

    expect(executor.getTokenCounter("conv-tool-release")).toBeUndefined();
    expect(successfulRelease).toHaveBeenCalledWith("conv-tool-release");
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("failing_release: Error"));
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining("fixture release failure"));
  });

  it("should preserve multiline string arguments and trim enum values only", async () => {
    let seenArgs: { content?: string; mode?: string } = {};
    const multilineTool: Tool = {
      definition: {
        name: "multiline_write",
        description: "preserve multiline content",
        parameters: {
          type: "object",
          properties: {
            content: { type: "string", description: "content" },
            mode: { type: "string", description: "mode", enum: ["overwrite", "append"] },
          },
          required: ["content"],
        },
      },
      async execute(args): Promise<ToolCallResult> {
        seenArgs = {
          content: typeof args.content === "string" ? args.content : undefined,
          mode: typeof args.mode === "string" ? args.mode : undefined,
        };
        return {
          id: "",
          name: "multiline_write",
          success: true,
          output: typeof args.content === "string" ? args.content : "",
          durationMs: 0,
        };
      },
    };
    const executor = new ToolExecutor({
      tools: [multilineTool],
      workspaceRoot: "/tmp/test",
    });
    const multilineContent = "line1\nline2\nline3\n\nline5 after blank";

    const result = await executor.execute({
      id: "req-multiline",
      name: "multiline_write",
      arguments: {
        content: multilineContent,
        mode: " overwrite ",
      },
    }, "conv-1");

    expect(result.success).toBe(true);
    expect(seenArgs.content).toBe(multilineContent);
    expect(seenArgs.mode).toBe("overwrite");
    expect(result.output).toBe(multilineContent);
  });

  it("should hide deferred tools from schema injection until they are loaded", async () => {
    const deferredTool: Tool = {
      definition: {
        name: "write_notes",
        description: "Write notes into a scratch file",
        parameters: {
          type: "object",
          properties: {
            content: { type: "string", description: "content" },
          },
          required: ["content"],
        },
      },
      async execute(args): Promise<ToolCallResult> {
        return {
          id: "",
          name: "write_notes",
          success: true,
          output: String(args.content ?? ""),
          durationMs: 0,
        };
      },
    };

    const loadedState = new Map<string, string[]>();
    const executor = new ToolExecutor({
      tools: [echoTool, deferredTool],
      workspaceRoot: "/tmp/test",
      deferredToolNames: ["write_notes"],
      conversationStore: {
        getHistory: () => [],
        getLoadedToolNames: (conversationId) => loadedState.get(conversationId) ?? [],
        setLoadedToolNames: (conversationId, toolNames) => {
          loadedState.set(conversationId, toolNames);
        },
        setRoomMembersCache: () => {},
        getRoomMembersCache: () => undefined,
        clearRoomMembersCache: () => {},
        recordTaskTokenResult: () => {},
        getTaskTokenResults: () => [],
      },
    });

    expect(executor.getDefinitions("default", "conv-1").map((item) => item.function.name)).toEqual(["echo"]);
    expect(executor.getCatalogEntries("default", "conv-1").find((item) => item.name === "write_notes")).toMatchObject({
      loadingMode: "deferred",
      loaded: false,
    });

    await executor.loadDeferredTools("conv-1", ["write_notes"]);

    expect(executor.getDefinitions("default", "conv-1").map((item) => item.function.name)).toEqual(["echo", "write_notes"]);
  });

  it("does not retain empty loaded deferred selections in memory", async () => {
    const deferredTool: Tool = {
      definition: {
        name: "deferred_cleanup",
        description: "Deferred cleanup fixture",
        loadingMode: "deferred",
        parameters: { type: "object", properties: {}, required: [] },
      },
      async execute(): Promise<ToolCallResult> {
        return { id: "", name: "deferred_cleanup", success: true, output: "ok", durationMs: 0 };
      },
    };
    const persistedSelections: string[][] = [];
    const executor = new ToolExecutor({
      tools: [echoTool, deferredTool],
      workspaceRoot: "/tmp/test",
      conversationStore: {
        getHistory: () => [],
        getLoadedToolNames: () => [],
        setLoadedToolNames: (_conversationId, toolNames) => {
          persistedSelections.push([...toolNames]);
        },
      } as any,
    });

    expect(executor.getLoadedDeferredToolList("conv-empty-selection")).toEqual([]);
    expect((executor as any).loadedDeferredToolNames.has("conv-empty-selection")).toBe(false);

    await executor.loadDeferredTools("conv-empty-selection", ["deferred_cleanup"]);
    expect((executor as any).loadedDeferredToolNames.has("conv-empty-selection")).toBe(true);

    await executor.clearLoadedDeferredTools("conv-empty-selection");
    expect((executor as any).loadedDeferredToolNames.has("conv-empty-selection")).toBe(false);
    expect(persistedSelections.at(-1)).toEqual([]);
  });

  it("tool_search should search deferred tools and load selected schemas into the conversation", async () => {
    const deferredTool: Tool = {
      definition: {
        name: "web_search_deep",
        description: "Search deep web knowledge",
        shortDescription: "Search the web deeply",
        keywords: ["search", "web", "research"],
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "query" },
          },
          required: ["query"],
        },
      },
      async execute(args): Promise<ToolCallResult> {
        return {
          id: "",
          name: "web_search_deep",
          success: true,
          output: String(args.query ?? ""),
          durationMs: 0,
        };
      },
    };

    const executor = new ToolExecutor({
      tools: [echoTool, deferredTool],
      workspaceRoot: "/tmp/test",
      deferredToolNames: ["web_search_deep"],
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

    const searchResult = await executor.execute(
      {
        id: "req-search",
        name: "tool_search",
        arguments: {
          query: "research web",
          select: ["web_search_deep"],
        },
      },
      "conv-1",
    );

    expect(searchResult.success).toBe(true);
    expect(searchResult.output).toContain("Loaded deferred tools for this conversation");
    expect(searchResult.output).toContain("web_search_deep");
    expect(executor.getDefinitions("default", "conv-1").map((item) => item.function.name)).toContain("web_search_deep");
    await executor.consumeLoadedDeferredToolsForNextTurn("conv-1");
    expect(executor.getDefinitions("default", "conv-1").map((item) => item.function.name)).not.toContain("web_search_deep");
  });

  it("keeps StarWeaver deferred tools loaded across turns in the same conversation", async () => {
    const runtimeDescribeTool: Tool = {
      definition: {
        name: "mcp_starweaver_central_starweaver_runtime_describe",
        description: "StarWeaver runtime describe",
        shortDescription: "runtime describe",
        parameters: {
          type: "object",
          properties: {
            view: { type: "string", description: "view" },
          },
          required: [],
        },
      },
      async execute(): Promise<ToolCallResult> {
        return {
          id: "",
          name: "mcp_starweaver_central_starweaver_runtime_describe",
          success: true,
          output: "{}",
          durationMs: 0,
        };
      },
    };

    const executor = new ToolExecutor({
      tools: [echoTool, runtimeDescribeTool],
      workspaceRoot: "/tmp/test",
      deferredToolNames: ["mcp_starweaver_central_starweaver_runtime_describe"],
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

    await executor.execute(
      {
        id: "req-load-starweaver",
        name: "tool_search",
        arguments: {
          select: ["mcp_starweaver_central_starweaver_runtime_describe"],
        },
      },
      "conv-starweaver",
    );

    expect(executor.getDefinitions("default", "conv-starweaver").map((item) => item.function.name))
      .toContain("mcp_starweaver_central_starweaver_runtime_describe");

    await executor.consumeLoadedDeferredToolsForNextTurn("conv-starweaver");

    expect(executor.getDefinitions("default", "conv-starweaver").map((item) => item.function.name))
      .toContain("mcp_starweaver_central_starweaver_runtime_describe");
  });

  it("should hide heavy discovery family members until the family is expanded", () => {
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
          output: String(args.goalId ?? ""),
          durationMs: 0,
        };
      },
    };

    const executor = new ToolExecutor({
      tools: [echoTool, deferredGoalTool],
      workspaceRoot: "/tmp/test",
      deferredToolNames: ["goal_checkpoint_request"],
    });

    const defaultEntries = executor.getDiscoveryEntries("default", "conv-1");
    expect(defaultEntries.find((entry) => entry.kind === "family" && entry.id === "goals")).toMatchObject({
      kind: "family",
      toolCount: 1,
      gateMode: "hidden-until-expanded",
    });
    expect(defaultEntries.some((entry) => entry.kind === "tool" && entry.name === "goal_checkpoint_request")).toBe(false);

    const expandedEntries = executor.getDiscoveryEntries("default", "conv-1", undefined, {
      expandedFamilyIds: ["goals"],
    });
    expect(expandedEntries.some((entry) => entry.kind === "tool" && entry.name === "goal_checkpoint_request")).toBe(true);
    expect(executor.buildDeferredToolDiscoveryPromptSummary("default", "conv-1")).toContain("goals");
    expect(executor.buildDeferredToolDiscoveryPromptSummary("default", "conv-1"))
      .toContain("do not treat `dream` / 梦境 / memory-runtime work as `canvas` by default");
  });

  it("tool_search should expand a heavy family before selecting an exact deferred tool", async () => {
    const goalFamily = {
      id: "goals",
      title: "Goals",
      summary: "Goal governance and checkpoint operations.",
      gateMode: "hidden-until-expanded" as const,
      keywords: ["goal", "checkpoint", "governance"],
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
          output: String(args.goalId ?? ""),
          durationMs: 0,
        };
      },
    };

    const executor = new ToolExecutor({
      tools: [echoTool, deferredGoalTool],
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

    const collapsedSearch = await executor.execute(
      {
        id: "req-family-search",
        name: "tool_search",
        arguments: {
          query: "checkpoint",
        },
      },
      "conv-1",
    );
    expect(collapsedSearch.success).toBe(true);
    expect(collapsedSearch.output).toContain("family:goals");
    expect(collapsedSearch.output).not.toContain("goal_checkpoint_request [");

    const expandedSearch = await executor.execute(
      {
        id: "req-family-expand",
        name: "tool_search",
        arguments: {
          query: "checkpoint",
          expandFamilies: ["goals"],
          select: ["goal_checkpoint_request"],
        },
      },
      "conv-1",
    );
    expect(expandedSearch.success).toBe(true);
    expect(expandedSearch.output).toContain("Expanded families for this search");
    expect(expandedSearch.output).toContain("goal_checkpoint_request");
    expect(executor.getDefinitions("default", "conv-1").map((item) => item.function.name)).toContain("goal_checkpoint_request");
  });

  it("tool_search should strongly instruct same-turn select when exact deferred matches are already visible", async () => {
    const deferredAlpha: Tool = {
      definition: {
        name: "alpha_deferred",
        description: "Alpha deferred tool",
        shortDescription: "Alpha deferred",
        keywords: ["alpha", "deferred"],
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      async execute(): Promise<ToolCallResult> {
        return { id: "", name: "alpha_deferred", success: true, output: "alpha", durationMs: 0 };
      },
    };

    const executor = new ToolExecutor({
      tools: [echoTool, deferredAlpha],
      workspaceRoot: "/tmp/test",
      deferredToolNames: ["alpha_deferred"],
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

    const searchResult = await executor.execute({
      id: "req-exact-deferred",
      name: "tool_search",
      arguments: { query: "alpha" },
    }, "conv-exact-deferred");

    expect(searchResult.success).toBe(true);
    expect(searchResult.output).toContain("The exact deferred tool matches are already identified in Matches. Select one now in the same turn before any other tool call");
    expect(searchResult.output).toContain('tool_search {"select":["alpha_deferred"]}');
  });

  it("tool_search should support unload, shrink, and reset of loaded deferred tools", async () => {
    const deferredAlpha: Tool = {
      definition: {
        name: "alpha_deferred",
        description: "Alpha deferred tool",
        shortDescription: "Alpha deferred",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      async execute(): Promise<ToolCallResult> {
        return { id: "", name: "alpha_deferred", success: true, output: "alpha", durationMs: 0 };
      },
    };
    const deferredBeta: Tool = {
      definition: {
        name: "beta_deferred",
        description: "Beta deferred tool",
        shortDescription: "Beta deferred",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      async execute(): Promise<ToolCallResult> {
        return { id: "", name: "beta_deferred", success: true, output: "beta", durationMs: 0 };
      },
    };

    const executor = new ToolExecutor({
      tools: [echoTool, deferredAlpha, deferredBeta],
      workspaceRoot: "/tmp/test",
      deferredToolNames: ["alpha_deferred", "beta_deferred"],
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

    await executor.execute({
      id: "req-load-both",
      name: "tool_search",
      arguments: { select: ["alpha_deferred", "beta_deferred"] },
    }, "conv-ops");
    expect(executor.getLoadedDeferredToolList("conv-ops")).toEqual(["alpha_deferred", "beta_deferred"]);

    const unloadResult = await executor.execute({
      id: "req-unload",
      name: "tool_search",
      arguments: { unload: ["alpha_deferred"] },
    }, "conv-ops");
    expect(unloadResult.output).toContain("Unloaded deferred tools");
    expect(executor.getLoadedDeferredToolList("conv-ops")).toEqual(["beta_deferred"]);

    await executor.execute({
      id: "req-reload",
      name: "tool_search",
      arguments: { select: ["alpha_deferred"] },
    }, "conv-ops");
    expect(executor.getLoadedDeferredToolList("conv-ops")).toEqual(["alpha_deferred", "beta_deferred"]);

    const shrinkResult = await executor.execute({
      id: "req-shrink",
      name: "tool_search",
      arguments: { shrinkTo: ["alpha_deferred"] },
    }, "conv-ops");
    expect(shrinkResult.output).toContain("Shrunk loaded tools to");
    expect(executor.getLoadedDeferredToolList("conv-ops")).toEqual(["alpha_deferred"]);

    const resetResult = await executor.execute({
      id: "req-reset",
      name: "tool_search",
      arguments: { resetLoaded: true },
    }, "conv-ops");
    expect(resetResult.output).toContain("Reset loaded deferred tools");
    expect(executor.getLoadedDeferredToolList("conv-ops")).toEqual([]);
  });

  it("tool_search should preflight-correct alias and scalar arguments into canonical forms", async () => {
    const deferredTool: Tool = {
      definition: {
        name: "goal_checkpoint_request",
        description: "Request a goal checkpoint",
        shortDescription: "Request a checkpoint",
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
          output: String(args.goalId ?? ""),
          durationMs: 0,
        };
      },
    };

    const executor = new ToolExecutor({
      tools: [echoTool, deferredTool],
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

    const result = await executor.execute({
      id: "req-tool-search-correct",
      name: "tool_search",
      arguments: {
        family: "goals",
        load: "goal_checkpoint_request",
        resetLoaded: "true" as any,
        maxResults: "5" as any,
      },
    }, "conv-ops");

    expect(result.success).toBe(true);
    expect(result.output).toContain("Expanded families for this search");
    expect(result.output).toContain("Loaded deferred tools for this conversation");
    expect(result.metadata).toMatchObject({
      repairAction: "tool_arguments_corrected",
      argumentValidation: {
        corrected: true,
        blocked: false,
        corrections: expect.arrayContaining([
          expect.stringContaining("family"),
          expect.stringContaining("load"),
          expect.stringContaining("resetLoaded"),
          expect.stringContaining("maxResults"),
        ]),
      },
    });
  });

  it("tool_search should auto-fill select for the fixed StarWeaver smoke exact-query path", async () => {
    const deferredTools: Tool[] = [
      {
        definition: {
          name: "mcp_starweaver_central_starweaver_runtime_describe",
          description: "runtime describe",
          shortDescription: "runtime describe",
          parameters: { type: "object", properties: {}, required: [] },
        },
        async execute(): Promise<ToolCallResult> {
          return { id: "", name: "mcp_starweaver_central_starweaver_runtime_describe", success: true, output: "ok", durationMs: 0 };
        },
      },
      {
        definition: {
          name: "mcp_starweaver_central_starweaver_wake_signals_peek",
          description: "wake signals peek",
          shortDescription: "wake signals peek",
          parameters: { type: "object", properties: {}, required: [] },
        },
        async execute(): Promise<ToolCallResult> {
          return { id: "", name: "mcp_starweaver_central_starweaver_wake_signals_peek", success: true, output: "ok", durationMs: 0 };
        },
      },
      {
        definition: {
          name: "mcp_starweaver_central_starweaver_command_peek",
          description: "command peek",
          shortDescription: "command peek",
          parameters: { type: "object", properties: {}, required: [] },
        },
        async execute(): Promise<ToolCallResult> {
          return { id: "", name: "mcp_starweaver_central_starweaver_command_peek", success: true, output: "ok", durationMs: 0 };
        },
      },
      {
        definition: {
          name: "mcp_starweaver_central_starweaver_agent_delivery_peek",
          description: "agent delivery peek",
          shortDescription: "agent delivery peek",
          parameters: { type: "object", properties: {}, required: [] },
        },
        async execute(): Promise<ToolCallResult> {
          return { id: "", name: "mcp_starweaver_central_starweaver_agent_delivery_peek", success: true, output: "ok", durationMs: 0 };
        },
      },
    ];

    const executor = new ToolExecutor({
      tools: [echoTool, ...deferredTools],
      workspaceRoot: "/tmp/test",
      deferredToolNames: deferredTools.map((tool) => tool.definition.name),
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

    const result = await executor.execute({
      id: "req-starweaver-smoke-select",
      name: "tool_search",
      arguments: {
        query: "starweaver_runtime_describe starweaver_wake_signals_peek starweaver_command_peek starweaver_agent_delivery_peek",
      },
    }, "conv-starweaver-smoke");

    expect(result.success).toBe(true);
    expect(result.output).toContain("Loaded deferred tools for this conversation");
    expect(result.metadata).toMatchObject({
      repairAction: "tool_arguments_corrected",
      argumentValidation: {
        corrected: true,
        blocked: false,
        corrections: expect.arrayContaining([
          "Auto-filled `select` for the fixed StarWeaver smoke exact-query path.",
        ]),
      },
    });
    expect(executor.getLoadedDeferredToolList("conv-starweaver-smoke")).toEqual([
      "mcp_starweaver_central_starweaver_agent_delivery_peek",
      "mcp_starweaver_central_starweaver_command_peek",
      "mcp_starweaver_central_starweaver_runtime_describe",
      "mcp_starweaver_central_starweaver_wake_signals_peek",
    ]);
  });

  it("should auto-prune oversized legacy deferred selections using recent tool digests first", () => {
    const deferredTools = Array.from({ length: 20 }, (_, index) => {
      const name = `deferred_${String(index + 1).padStart(2, "0")}`;
      return {
        definition: {
          name,
          description: `${name} description`,
          shortDescription: `${name} short`,
          parameters: { type: "object", properties: {}, required: [] },
        },
        async execute(): Promise<ToolCallResult> {
          return { id: "", name, success: true, output: name, durationMs: 0 };
        },
      } satisfies Tool;
    });

    const loadedState = new Map<string, string[]>();
    loadedState.set("conv-legacy", deferredTools.map((tool) => tool.definition.name));
    const persistedSelections: string[][] = [];
    const executor = new ToolExecutor({
      tools: [echoTool, ...deferredTools],
      workspaceRoot: "/tmp/test",
      deferredToolNames: deferredTools.map((tool) => tool.definition.name),
      conversationStore: {
        getHistory: () => [],
        getLoadedToolNames: (conversationId) => loadedState.get(conversationId) ?? [],
        setLoadedToolNames: (conversationId, toolNames) => {
          loadedState.set(conversationId, toolNames);
          persistedSelections.push([...toolNames]);
        },
        getToolDigests: () => [
          { toolName: "deferred_19" },
          { toolName: "deferred_20" },
          { toolName: "echo" },
        ],
        setRoomMembersCache: () => {},
        getRoomMembersCache: () => undefined,
        clearRoomMembersCache: () => {},
        recordTaskTokenResult: () => {},
        getTaskTokenResults: () => [],
      } as any,
    });

    const exposedNames = executor.getDefinitions("default", "conv-legacy").map((item) => item.function.name);
    expect(exposedNames).toContain("deferred_19");
    expect(exposedNames).toContain("deferred_20");
    expect(exposedNames).toHaveLength(17);
    expect(persistedSelections.at(-1)).toHaveLength(16);
    expect(persistedSelections.at(-1)?.slice(0, 2)).toEqual(["deferred_20", "deferred_19"]);
  });

  it("drops a late non-cooperative network-read result after the policy deadline", async () => {
    let receivedAbort = false;
    let lateToolSettled = false;
    const auditLogger = vi.fn();
    const lateTool = withToolContract({
      definition: {
        name: "late_network_read",
        description: "ignores abort until its delayed result is ready",
        parameters: { type: "object", properties: {} },
      },
      async execute(_args, context): Promise<ToolCallResult> {
        context.abortSignal?.addEventListener("abort", () => {
          receivedAbort = true;
        }, { once: true });
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        lateToolSettled = true;
        return {
          id: "",
          name: "late_network_read",
          success: true,
          output: "late result",
          durationMs: 0,
        };
      },
    }, {
      family: "network-read",
      isReadOnly: true,
      isConcurrencySafe: true,
      needsPermission: false,
      riskLevel: "low",
      channels: ["gateway"],
      safeScopes: ["remote-safe"],
      activityDescription: "Read a remote resource",
      resultSchema: { kind: "text", description: "plain text" },
      outputPersistencePolicy: "conversation",
      executionAdmission: { deadline: "policy", output: "utf8-text-policy" },
    });
    const executor = new ToolExecutor({
      tools: [lateTool],
      workspaceRoot: "/tmp/test",
      policy: { maxTimeoutMs: 10, maxResponseBytes: 16 },
      auditLogger,
    });

    const result = await executor.execute({
      id: "late-network-read",
      name: "late_network_read",
      arguments: {},
    }, "conv-deadline");

    expect(result).toMatchObject({
      success: false,
      error: "工具执行超时（10ms）",
      failureKind: "environment_error",
      metadata: {
        deadlineExceeded: true,
        deadlineMs: 10,
        lateResultDiscarded: true,
      },
    });
    expect(receivedAbort).toBe(true);
    expect(lateToolSettled).toBe(false);

    await new Promise<void>((resolve) => setTimeout(resolve, 60));
    expect(lateToolSettled).toBe(true);
    await vi.waitFor(() => expect(auditLogger).toHaveBeenCalledTimes(1));
  });

  it("reports the admitted family and origin while applying the text output budget", async () => {
    const textTool = withToolContract({
      definition: {
        name: "network_read_output",
        description: "returns a bounded network-read fixture",
        parameters: { type: "object", properties: {} },
      },
      async execute(): Promise<ToolCallResult> {
        return {
          id: "",
          name: "network_read_output",
          success: true,
          output: "猫咪abc",
          durationMs: 0,
        };
      },
    }, {
      family: "network-read",
      isReadOnly: true,
      isConcurrencySafe: true,
      needsPermission: false,
      riskLevel: "low",
      channels: ["gateway"],
      safeScopes: ["remote-safe"],
      activityDescription: "Read a remote resource",
      resultSchema: { kind: "text", description: "plain text" },
      outputPersistencePolicy: "conversation",
      executionAdmission: { deadline: "policy", output: "utf8-text-policy" },
    });
    const executor = new ToolExecutor({
      tools: [textTool],
      workspaceRoot: "/tmp/test",
      policy: { maxTimeoutMs: 1_000, maxResponseBytes: 4 },
      initialToolOrigin: "builtin",
    });

    const result = await executor.execute({
      id: "network-read-output",
      name: "network_read_output",
      arguments: {},
    }, "conv-output");

    expect(result).toMatchObject({
      success: true,
      output: "猫",
      metadata: {
        outputTruncated: true,
        outputBytes: 3,
        outputOriginalBytes: 9,
        outputLimitBytes: 4,
      },
    });
    expect(executor.getRegistryInventory().entries).toEqual([expect.objectContaining({
      name: "network_read_output",
      origin: "builtin",
      family: "network-read",
      executionAdmission: { deadline: "policy", output: "utf8-text-policy" },
    })]);
  });

  it("keeps the selected network-read family inventory explicit", () => {
    const executor = new ToolExecutor({
      tools: [fetchTool, webSearchTool],
      workspaceRoot: "/tmp/test",
      initialToolOrigin: "builtin",
    });

    expect(executor.getRegistryInventory().entries).toEqual([
      expect.objectContaining({
        name: "web_fetch",
        origin: "builtin",
        family: "network-read",
      }),
      expect.objectContaining({
        name: "web_search",
        origin: "builtin",
        family: "network-read",
        executionAdmission: { deadline: "policy", output: "utf8-text-policy" },
      }),
    ]);
  });
});

describe("DEFAULT_POLICY", () => {
  it("should have sensible defaults", () => {
    expect(DEFAULT_POLICY.deniedPaths).toContain(".env");
    expect(DEFAULT_POLICY.deniedPaths).toContain(".git");
    expect(DEFAULT_POLICY.maxTimeoutMs).toBeGreaterThan(0);
    expect(DEFAULT_POLICY.maxResponseBytes).toBeGreaterThan(0);
  });
});
