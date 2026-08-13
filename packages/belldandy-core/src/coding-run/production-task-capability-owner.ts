import {
  TASK_CAPABILITY_CLOSURE_SCHEMA_VERSION,
  type TaskCapability,
  type TaskCapabilityClosure,
  type TaskCapabilityName,
} from "./task-projection.js";
import {
  createTaskCapabilityClosureResolver,
  type TaskCapabilityClosureResolver,
  type TaskCapabilityClosureStartEvaluationInput,
} from "./task-capability-closure.js";

const CAPABILITY_NAMES: readonly TaskCapabilityName[] = [
  "tools", "languageToolchain", "sandbox", "approvalChannel", "worktree", "journal",
  "trace", "verifier", "mcp", "plugin", "skill",
];

type CapabilityReaderResult = {
  available: boolean;
  reasonCode?: string;
};

type ToolReaderResult = CapabilityReaderResult & {
  family?: string;
  needsPermission?: boolean;
};

export type ProductionTaskCapabilityClosureOwnerOptions = {
  now?: () => number;
  readTool?: (input: TaskCapabilityClosureStartEvaluationInput["context"] & {
    name: string;
    agentRunId: string;
  }) => ToolReaderResult | undefined;
  probeCommandSandbox?: () => Promise<CapabilityReaderResult>;
  hasApprovalChannel?: () => boolean;
  readLanguageToolchain?: () => CapabilityReaderResult;
  readWorktree?: (input: { conversationId: string; agentRunId: string }) => CapabilityReaderResult | Promise<CapabilityReaderResult>;
  readJournal?: () => CapabilityReaderResult;
  readTrace?: () => CapabilityReaderResult;
  readVerifier?: () => CapabilityReaderResult;
  readMcpDiagnostics?: () => {
    initialized: boolean;
    servers: Array<{ id: string; name: string; status: string }>;
  } | null;
  listPluginIds?: () => string[];
  readSkill?: (name: string) => { exists: boolean; eligible?: boolean };
};

/**
 * 只消费运行时真源并保存 active-run exact-binding 快照；评估不创建容器、worktree 或领域状态。
 */
export function createProductionTaskCapabilityClosureOwner(
  options: ProductionTaskCapabilityClosureOwnerOptions,
): TaskCapabilityClosureResolver {
  const now = options.now ?? Date.now;
  const snapshots = new Map<string, TaskCapabilityClosure>();

  return createTaskCapabilityClosureResolver({
    now,
    resolve: (binding) => snapshots.get(bindingKey(binding)),
    evaluateForStart: async (input) => {
      const closure = await evaluateClosure(options, input, now());
      snapshots.set(bindingKey(input.binding), cloneClosure(closure));
      return closure;
    },
    release: (binding) => {
      snapshots.delete(bindingKey(binding));
    },
  });
}

async function evaluateClosure(
  options: ProductionTaskCapabilityClosureOwnerOptions,
  input: TaskCapabilityClosureStartEvaluationInput,
  evaluatedAtMs: number,
): Promise<TaskCapabilityClosure> {
  const required = collectRequiredCapabilities(input);
  const capabilities = Object.fromEntries(CAPABILITY_NAMES.map((name) => [
    name,
    required.has(name)
      ? { required: true, state: "unknown", reasonCode: "not_evaluated" }
      : { required: false, state: "degraded", reasonCode: "not_requested" },
  ])) as TaskCapabilityClosure["capabilities"];

  let requestedTools: ToolReaderResult[] = [];
  if (required.has("tools")) {
    requestedTools = (input.requirements.tools ?? []).map((name) => safeReadTool(options, input, name));
    capabilities.tools = aggregateResults(requestedTools, "tool_not_found");
  }

  const commandSandboxRequired = required.has("sandbox")
    || requestedTools.some((tool) => tool.available && tool.family === "command-exec");
  if (commandSandboxRequired) {
    required.add("sandbox");
    capabilities.sandbox = await readAsyncCapability(options.probeCommandSandbox, "reader_unavailable");
  }

  const approvalRequired = required.has("approvalChannel") || (
    input.context.permissionMode === "confirm"
    && requestedTools.some((tool) => tool.available && tool.needsPermission === true)
  );
  if (approvalRequired) {
    required.add("approvalChannel");
    capabilities.approvalChannel = readBooleanCapability(options.hasApprovalChannel, "approval_channel_unavailable");
  }

  if (required.has("languageToolchain")) {
    capabilities.languageToolchain = readCapability(options.readLanguageToolchain);
  }
  if (required.has("worktree")) {
    capabilities.worktree = await readAsyncCapability(
      options.readWorktree
        ? () => options.readWorktree!({
          conversationId: input.context.conversationId,
          agentRunId: input.binding.agentRunId,
        })
        : undefined,
      "reader_unavailable",
    );
  }
  if (required.has("journal")) capabilities.journal = readCapability(options.readJournal);
  if (required.has("trace")) capabilities.trace = readCapability(options.readTrace);
  if (required.has("verifier")) capabilities.verifier = readCapability(options.readVerifier);
  if (required.has("mcp")) capabilities.mcp = readMcpCapability(options, input.requirements.mcpServers ?? []);
  if (required.has("plugin")) capabilities.plugin = readPluginCapability(options, input.requirements.plugins ?? []);
  if (required.has("skill")) capabilities.skill = readSkillCapability(options, input.requirements.skills ?? []);

  for (const name of required) capabilities[name].required = true;
  const blocked = [...required].some((name) => capabilities[name].state !== "available");
  return {
    schemaVersion: TASK_CAPABILITY_CLOSURE_SCHEMA_VERSION,
    evaluatedAtMs: Number.isSafeInteger(evaluatedAtMs) && evaluatedAtMs >= 0 ? evaluatedAtMs : 0,
    status: blocked ? "blocked" : "satisfied",
    capabilities,
  };
}

function collectRequiredCapabilities(input: TaskCapabilityClosureStartEvaluationInput): Set<TaskCapabilityName> {
  const required = new Set<TaskCapabilityName>(input.requirements.capabilities ?? []);
  if (input.requirements.tools?.length) required.add("tools");
  if (input.requirements.mcpServers?.length) required.add("mcp");
  if (input.requirements.plugins?.length) required.add("plugin");
  if (input.requirements.skills?.length) required.add("skill");
  return required;
}

function safeReadTool(
  options: ProductionTaskCapabilityClosureOwnerOptions,
  input: TaskCapabilityClosureStartEvaluationInput,
  name: string,
): ToolReaderResult {
  if (!options.readTool) return { available: false, reasonCode: "reader_unavailable" };
  try {
    return options.readTool({
      ...input.context,
      name,
      agentRunId: input.binding.agentRunId,
    }) ?? { available: false, reasonCode: "tool_not_found" };
  } catch {
    return { available: false, reasonCode: "reader_error" };
  }
}

function aggregateResults(results: ToolReaderResult[], emptyReason: string): TaskCapability {
  if (results.length === 0) return unavailable(emptyReason);
  const failed = results.find((result) => !result.available);
  return failed ? unavailable(failed.reasonCode ?? "unavailable") : available();
}

function readCapability(reader: (() => CapabilityReaderResult) | undefined): TaskCapability {
  if (!reader) return unavailable("reader_unavailable");
  try {
    return toCapability(reader());
  } catch {
    return unknown("reader_error");
  }
}

async function readAsyncCapability(
  reader: (() => CapabilityReaderResult | Promise<CapabilityReaderResult>) | undefined,
  missingReason: string,
): Promise<TaskCapability> {
  if (!reader) return unavailable(missingReason);
  try {
    return toCapability(await reader());
  } catch {
    return unknown("reader_error");
  }
}

function readBooleanCapability(reader: (() => boolean) | undefined, falseReason: string): TaskCapability {
  if (!reader) return unavailable("reader_unavailable");
  try {
    return reader() ? available() : unavailable(falseReason);
  } catch {
    return unknown("reader_error");
  }
}

function readMcpCapability(
  options: ProductionTaskCapabilityClosureOwnerOptions,
  ids: string[],
): TaskCapability {
  if (!options.readMcpDiagnostics) return unavailable("reader_unavailable");
  try {
    const diagnostics = options.readMcpDiagnostics();
    if (!diagnostics?.initialized) return unavailable("mcp_not_initialized");
    const connected = diagnostics.servers.filter((server) => server.status === "connected");
    return ids.every((id) => connected.some((server) => server.id === id))
      ? available()
      : unavailable("mcp_server_unavailable");
  } catch {
    return unknown("reader_error");
  }
}

function readPluginCapability(
  options: ProductionTaskCapabilityClosureOwnerOptions,
  ids: string[],
): TaskCapability {
  if (!options.listPluginIds) return unavailable("reader_unavailable");
  try {
    const loaded = new Set(options.listPluginIds());
    return ids.every((id) => loaded.has(id)) ? available() : unavailable("plugin_not_loaded");
  } catch {
    return unknown("reader_error");
  }
}

function readSkillCapability(
  options: ProductionTaskCapabilityClosureOwnerOptions,
  names: string[],
): TaskCapability {
  if (!options.readSkill) return unavailable("reader_unavailable");
  try {
    for (const name of names) {
      const skill = options.readSkill(name);
      if (!skill.exists) return unavailable("skill_not_found");
      if (skill.eligible === undefined) return unavailable("skill_eligibility_unknown");
      if (skill.eligible === false) return unavailable("skill_ineligible");
    }
    return available();
  } catch {
    return unknown("reader_error");
  }
}

function toCapability(result: CapabilityReaderResult): TaskCapability {
  return result.available ? available(result.reasonCode) : unavailable(result.reasonCode ?? "unavailable");
}

function available(reasonCode?: string): TaskCapability {
  return { required: true, state: "available", ...(reasonCode ? { reasonCode } : {}) };
}

function unavailable(reasonCode: string): TaskCapability {
  return { required: true, state: "unavailable", reasonCode };
}

function unknown(reasonCode: string): TaskCapability {
  return { required: true, state: "unknown", reasonCode };
}

function bindingKey(binding: { taskId: string; source: string; agentRunId: string }): string {
  return `${binding.source}\u0000${binding.taskId}\u0000${binding.agentRunId}`;
}

function cloneClosure(closure: TaskCapabilityClosure): TaskCapabilityClosure {
  return {
    ...closure,
    capabilities: Object.fromEntries(CAPABILITY_NAMES.map((name) => [
      name,
      { ...closure.capabilities[name] },
    ])) as TaskCapabilityClosure["capabilities"],
  };
}
