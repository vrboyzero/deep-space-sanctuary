import type { AgentRegistry } from "@belldandy/agent";
import type { ToolExecutionRuntimeContext } from "@belldandy/skills";
import { TOOL_SETTINGS_CONTROL_NAME } from "@belldandy/skills";
import type { ToolContractChannel, ToolExecutor, SkillRegistry } from "@belldandy/skills";
import {
  listToolContractsV2,
} from "@belldandy/skills";
import type { PluginRegistry } from "@belldandy/plugins";
import type { GatewayEventFrame, GatewayResFrame } from "@belldandy/protocol";
import fs from "node:fs/promises";
import path from "node:path";

import { QueryRuntime, type QueryRuntimeObserver } from "./query-runtime.js";
import { buildAgentLaunchExplainability } from "./agent-launch-explainability.js";
import { buildBridgeRecoveryDiagnostics } from "./bridge-recovery-diagnostics.js";
import { buildExtensionGovernanceReport } from "./extension-governance.js";
import { loadExtensionMarketplaceState } from "./extension-marketplace-state.js";
import { buildExtensionRuntimeReport } from "./extension-runtime.js";
import type { ExtensionHostState } from "./extension-host.js";
import {
  buildToolBehaviorObservability,
  readConfiguredPromptExperimentToolContracts,
} from "./tool-behavior-observability.js";
import type { ToolControlConfirmationStore } from "./tool-control-confirmation-store.js";
import { buildToolContractV2Observability } from "./tool-contract-v2-observability.js";
import { resolveResidentStateBindingViewForAgent } from "./resident-state-binding.js";
import type { SubTaskRuntimeStore } from "./task-runtime.js";
import type { ToolsConfigManager } from "./tools-config.js";

type ToolsQueryRuntimeMethod = "tools.list" | "tools.update" | "tool_settings.confirm";

type ToolVisibilityPayload = {
  available: boolean;
  reasonCode: string;
  reasonMessage: string;
  alwaysEnabled?: boolean;
  contractReason?: string;
};

type MethodInventoryItem = {
  filename: string;
  title?: string;
  summary?: string;
  status?: string;
  path?: string;
};

export type QueryRuntimeToolsContext = {
  requestId: string;
  clientId?: string;
  requestChannel?: ToolContractChannel;
  toolExecutor?: ToolExecutor;
  toolsConfigManager?: ToolsConfigManager;
  toolControlConfirmationStore?: ToolControlConfirmationStore;
  getAgentToolControlMode?: () => "disabled" | "confirm" | "auto";
  getAgentToolControlConfirmPassword?: () => string | undefined;
  agentRegistry?: Pick<AgentRegistry, "getProfile">;
  pluginRegistry?: PluginRegistry;
  stateDir?: string;
  extensionHost?: Pick<ExtensionHostState, "lifecycle">;
  skillRegistry?: SkillRegistry;
  subTaskRuntimeStore?: SubTaskRuntimeStore;
  resolvePendingToolControlRequest?: (input: {
    confirmationStore?: ToolControlConfirmationStore;
    getMode?: () => "disabled" | "confirm" | "auto";
    getConfirmPassword?: () => string | undefined;
    requestId: string;
    conversationId?: string;
  }) => {
    ok: true;
    pending: {
      requestId: string;
      conversationId: string;
      changes: unknown;
    };
    summary: string[];
  } | {
    ok: false;
    code: string;
    message: string;
  };
  applyToolControlChanges?: (disabled: {
    builtin: string[];
    mcp_servers: string[];
    plugins: string[];
    skills?: string[];
  }, changes: unknown) => {
    builtin: string[];
    mcp_servers: string[];
    plugins: string[];
    skills?: string[];
  };
  buildToolControlDisabledPayload?: (disabled: {
    builtin: string[];
    mcp_servers: string[];
    plugins: string[];
    skills?: string[];
  }) => {
    builtin: string[];
    mcp_servers: string[];
    plugins: string[];
    skills?: string[];
  };
  emitEvent?: (frame: GatewayEventFrame) => void;
  resolveToolControlPolicySnapshot: (input: {
    confirmationStore?: ToolControlConfirmationStore;
    getMode?: () => "disabled" | "confirm" | "auto";
    getConfirmPassword?: () => string | undefined;
    conversationId?: string;
  }) => unknown;
  summarizeGroupedVisibility: (entries: ToolVisibilityPayload[]) => ToolVisibilityPayload;
  runtimeObserver?: QueryRuntimeObserver<ToolsQueryRuntimeMethod>;
};

export async function handleToolsListWithQueryRuntime(
  ctx: QueryRuntimeToolsContext,
  params: {
    taskId?: string;
    agentId?: string;
    conversationId?: string;
  },
): Promise<GatewayResFrame> {
  const runtime = new QueryRuntime({
    method: "tools.list" as const,
    traceId: ctx.requestId,
    observer: ctx.runtimeObserver,
  });

  return runtime.run(async (queryRuntime) => {
    queryRuntime.mark("runtime_checked", {
      detail: {
        hasToolExecutor: Boolean(ctx.toolExecutor),
        hasToolsConfigManager: Boolean(ctx.toolsConfigManager),
      },
    });

    if (!ctx.toolExecutor || !ctx.toolsConfigManager) {
      const methods = await listMethodInventory(ctx.stateDir);
      const extensionRuntime = buildExtensionRuntimeReport({
        pluginRegistry: ctx.pluginRegistry,
        skillRegistry: ctx.skillRegistry,
        toolsConfigManager: ctx.toolsConfigManager,
      });
      const extensionGovernance = buildExtensionGovernanceReport({
        extensionRuntime,
        extensionHostLifecycle: ctx.extensionHost?.lifecycle,
      });
      queryRuntime.mark("completed", {
        detail: {
          returnedEmptyInventory: true,
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: true,
        payload: {
          builtin: [],
          mcp: {},
          plugins: [],
          methods,
          skills: [],
          contracts: {},
          visibility: {},
          visibilityContext: { agentId: "default", conversationId: null, loadedDeferredTools: [] },
          toolControl: {
            mode: "disabled",
            requiresConfirmation: false,
            hasConfirmPassword: false,
            pendingRequest: null,
          },
          disabled: { builtin: [], mcp_servers: [], plugins: [], skills: [] },
          extensions: extensionRuntime,
          extensionGovernance,
        },
      };
    }

    queryRuntime.mark("request_validated", {
      detail: {
        taskId: params.taskId,
        agentId: params.agentId,
        conversationId: params.conversationId,
      },
    });

    const visibilityTask = params.taskId && ctx.subTaskRuntimeStore
      ? await ctx.subTaskRuntimeStore.getTask(params.taskId)
      : undefined;
    if (params.taskId && !visibilityTask) {
      queryRuntime.mark("completed", {
        detail: {
          taskId: params.taskId,
          code: "not_found",
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: "not_found", message: `Subtask not found: ${params.taskId}` },
      };
    }

    const visibilityAgentId = params.agentId || visibilityTask?.agentId;
    const visibilityConversationId = params.conversationId || visibilityTask?.parentConversationId;
    const residentStateBinding = resolveResidentStateBindingViewForAgent(
      ctx.stateDir,
      ctx.agentRegistry,
      visibilityAgentId,
    );
    const launchExplainability = buildAgentLaunchExplainability({
      agentRegistry: ctx.agentRegistry,
      agentId: visibilityAgentId,
      profileId: visibilityTask?.launchSpec?.profileId,
      launchSpec: visibilityTask?.launchSpec,
    });
    const runtimeContext = buildToolRuntimeContext(ctx.requestChannel, visibilityTask?.launchSpec);
    const bridgeRecoveryDiagnostics = visibilityTask
      ? buildBridgeRecoveryDiagnostics({
          toolExecutor: ctx.toolExecutor,
          task: visibilityTask,
          agentId: visibilityAgentId,
          conversationId: visibilityConversationId,
        })
      : undefined;

    const allNames = ctx.toolExecutor.getRegisteredToolNames().filter((name) => name !== TOOL_SETTINGS_CONTROL_NAME);
    const contractEntries = ctx.toolExecutor.getRegisteredToolContracts()
      .filter((contract) => contract.name !== TOOL_SETTINGS_CONTROL_NAME)
      .map((contract) => [
        contract.name,
        {
          family: contract.family,
          riskLevel: contract.riskLevel,
          channels: contract.channels,
          safeScopes: contract.safeScopes,
          needsPermission: contract.needsPermission,
          isReadOnly: contract.isReadOnly,
          isConcurrencySafe: contract.isConcurrencySafe,
          activityDescription: contract.activityDescription,
          outputPersistencePolicy: contract.outputPersistencePolicy,
        },
      ] as const);
    const contracts = Object.fromEntries(contractEntries);
    const visibleContracts = ctx.toolExecutor.getContracts(
      visibilityAgentId,
      visibilityConversationId,
      runtimeContext,
    ).filter((contract) => contract.name !== TOOL_SETTINGS_CONTROL_NAME);
    const contractV2Entries = visibleContracts.length > 0 ? listToolContractsV2(visibleContracts) : [];
    const contractV2Observability = buildToolContractV2Observability({
      contracts: contractV2Entries,
      registeredToolNames: allNames,
    });
    const toolContractV2Observability = {
      counts: contractV2Observability.summary,
      contracts: contractV2Observability.contracts,
    };
    const disabledToolContractNamesConfigured = readConfiguredPromptExperimentToolContracts();
    const toolBehaviorObservability = buildToolBehaviorObservability({
      contracts: visibleContracts,
      disabledContractNamesConfigured: disabledToolContractNamesConfigured,
    });

    const visibilityEntries = ctx.toolExecutor.getRegisteredToolAvailabilities(
      visibilityAgentId,
      visibilityConversationId,
      runtimeContext,
    )
      .filter((item) => item.name !== TOOL_SETTINGS_CONTROL_NAME)
      .map((item) => [
        item.name,
        {
          available: item.available,
          reasonCode: item.reasonCode,
          reasonMessage: item.reasonMessage,
          alwaysEnabled: item.alwaysEnabled,
          contractReason: item.contractReason,
        },
      ] as const);
    const visibility = Object.fromEntries(visibilityEntries) as Record<string, ToolVisibilityPayload>;
    const loadedDeferredTools = visibilityConversationId
      ? ctx.toolExecutor.getLoadedDeferredToolList(visibilityConversationId)
      : [];

    queryRuntime.mark("tool_inventory_loaded", {
      conversationId: visibilityConversationId,
        detail: {
          toolCount: allNames.length,
          contractCount: contractEntries.length,
          contractV2Count: contractV2Entries.length,
          behaviorContractCount: toolBehaviorObservability.counts.includedContractCount,
          taskBound: Boolean(visibilityTask),
        },
      });

    const config = ctx.toolsConfigManager.getConfig();
    const visibleDisabled = {
      ...config.disabled,
      builtin: config.disabled.builtin.filter((name) => name !== TOOL_SETTINGS_CONTROL_NAME),
    };
    const extensionRuntime = buildExtensionRuntimeReport({
      pluginRegistry: ctx.pluginRegistry,
      skillRegistry: ctx.skillRegistry,
      toolsConfigManager: ctx.toolsConfigManager,
    });
    let extensionGovernanceLoadError: string | undefined;
    const extensionMarketplace = await (async () => {
      if (!ctx.stateDir) return undefined;
      try {
        return await loadExtensionMarketplaceState(ctx.stateDir);
      } catch (error) {
        extensionGovernanceLoadError = String(error);
        return undefined;
      }
    })();
    const extensionGovernance = buildExtensionGovernanceReport({
      extensionRuntime,
      extensionMarketplace,
      extensionHostLifecycle: ctx.extensionHost?.lifecycle,
      loadError: extensionGovernanceLoadError,
    });
    const toolControl = ctx.resolveToolControlPolicySnapshot({
      confirmationStore: ctx.toolControlConfirmationStore,
      getMode: ctx.getAgentToolControlMode,
      getConfirmPassword: ctx.getAgentToolControlConfirmPassword,
      conversationId: visibilityConversationId,
    });

    const builtin: string[] = [];
    const mcp: Record<string, { tools: string[] }> = {};
    for (const name of allNames) {
      if (name.startsWith("mcp_")) {
        const rest = name.slice(4);
        const idx = rest.indexOf("_");
        const serverId = idx > 0 ? rest.slice(0, idx) : rest;
        if (!mcp[serverId]) mcp[serverId] = { tools: [] };
        mcp[serverId].tools.push(name);
      } else {
        builtin.push(name);
      }
    }

    const mcpVisibility = Object.fromEntries(
      Object.keys(mcp)
        .sort((a, b) => a.localeCompare(b))
        .map((serverId) => {
          const disabled = visibleDisabled.mcp_servers.includes(serverId);
          const toolVisibilityEntries = (mcp[serverId]?.tools ?? [])
            .map((toolName) => visibility[toolName])
            .filter((item): item is ToolVisibilityPayload => Boolean(item));
          const runtimeSummary = ctx.summarizeGroupedVisibility(toolVisibilityEntries);
          return [serverId, {
            available: disabled ? false : runtimeSummary.available,
            reasonCode: disabled ? "disabled-by-settings" : runtimeSummary.reasonCode,
            reasonMessage: disabled ? "该 MCP 服务器已在全局工具设置中关闭。" : runtimeSummary.reasonMessage,
          }];
        }),
    );

    const pluginIds = extensionRuntime.plugins.map((plugin) => plugin.id);
    const pluginToolMap = ctx.pluginRegistry?.getPluginToolMap() ?? new Map<string, string[]>();
    const pluginVisibility = Object.fromEntries(
      [...pluginIds]
        .sort((a, b) => a.localeCompare(b))
        .map((pluginId) => {
          const disabled = visibleDisabled.plugins.includes(pluginId);
          const toolVisibilityEntries = (pluginToolMap.get(pluginId) ?? [])
            .map((toolName) => visibility[toolName])
            .filter((item): item is ToolVisibilityPayload => Boolean(item));
          const runtimeSummary = ctx.summarizeGroupedVisibility(toolVisibilityEntries);
          return [pluginId, {
            available: disabled ? false : runtimeSummary.available,
            reasonCode: disabled ? "disabled-by-settings" : runtimeSummary.reasonCode,
            reasonMessage: disabled ? "该插件已在全局工具设置中关闭。" : runtimeSummary.reasonMessage,
          }];
        }),
    );

    const skillVisibility = Object.fromEntries(extensionRuntime.skills.map((skill) => {
      const reasons = skill.eligibilityReasons;
      const eligible = skill.eligible;
      const disabled = skill.disabled;
      const reasonCode = disabled ? "disabled-by-settings" : eligible ? "available" : "not-eligible";
      const reasonMessage = disabled ? "该技能已在全局工具设置中关闭。" : eligible ? "" : reasons.join("；");
      return [skill.name, {
        available: !disabled && eligible,
        eligible,
        eligibilityReasons: reasons,
        reasonCode,
        reasonMessage,
      }];
    }));

    const skills = extensionRuntime.skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      source: skill.source,
      priority: skill.priority,
      tags: skill.tags,
      eligible: skill.eligible,
      eligibilityReasons: skill.eligibilityReasons,
    }));
    const methods = await listMethodInventory(ctx.stateDir);

    queryRuntime.mark("tool_visibility_built", {
      conversationId: visibilityConversationId,
      detail: {
        builtinCount: builtin.length,
        mcpServerCount: Object.keys(mcp).length,
        pluginCount: extensionRuntime.summary.pluginCount,
        methodCount: methods.length,
        skillCount: extensionRuntime.summary.skillCount,
      },
    });
    queryRuntime.mark("completed", {
      conversationId: visibilityConversationId,
      detail: {
        agentId: visibilityAgentId ?? "default",
      },
    });

    return {
      type: "res",
      id: ctx.requestId,
      ok: true,
      payload: {
        builtin,
        mcp,
        plugins: pluginIds,
        methods,
        skills,
        contracts,
        toolContractV2Observability,
        toolBehaviorObservability,
        visibility,
        mcpVisibility,
        pluginVisibility,
        skillVisibility,
        extensions: extensionRuntime,
        extensionGovernance,
        visibilityContext: {
          agentId: visibilityAgentId ?? "default",
          conversationId: visibilityConversationId ?? null,
          loadedDeferredTools,
          ...(bridgeRecoveryDiagnostics ? { bridgeRecoveryDiagnostics } : {}),
          ...(launchExplainability ? { launchExplainability } : {}),
          ...(residentStateBinding ? { residentStateBinding } : {}),
          ...(visibilityTask
            ? {
              taskId: visibilityTask.id,
              launchSpec: visibilityTask.launchSpec,
            }
            : {}),
        },
        toolControl,
        disabled: visibleDisabled,
      },
    };
  });
}

function buildToolRuntimeContext(
  requestChannel?: ToolContractChannel,
  launchSpec?: ToolExecutionRuntimeContext["launchSpec"],
): ToolExecutionRuntimeContext | undefined {
  if (!requestChannel && !launchSpec) {
    return undefined;
  }
  return {
    ...(launchSpec ? { launchSpec } : {}),
    ...(requestChannel ? { channel: requestChannel } : {}),
  };
}

async function listMethodInventory(stateDir?: string): Promise<MethodInventoryItem[]> {
  const resolvedStateDir = typeof stateDir === "string" && stateDir.trim() ? stateDir.trim() : "";
  if (!resolvedStateDir) {
    return [];
  }

  const methodsDir = path.join(resolvedStateDir, "methods");
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(methodsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "zh-CN"));

  const items = await Promise.all(files.map(async (filename) => {
    const relativePath = `methods/${filename}`;
    const absolutePath = path.join(methodsDir, filename);
    try {
      const content = await fs.readFile(absolutePath, "utf-8");
      const parsed = parseMethodInventoryContent(content);
      return {
        filename,
        title: parsed.title,
        summary: parsed.summary,
        status: parsed.status,
        path: relativePath,
      } satisfies MethodInventoryItem;
    } catch {
      return {
        filename,
        path: relativePath,
      } satisfies MethodInventoryItem;
    }
  }));

  return items;
}

function parseMethodInventoryContent(content: string): {
  title?: string;
  summary?: string;
  status?: string;
} {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const frontmatter = frontmatterMatch?.[1] || "";
  const body = frontmatterMatch ? content.slice(frontmatterMatch[0].length) : content;
  return {
    title: body.match(/^#\s+(.+)$/m)?.[1]?.trim(),
    summary: readMethodFrontmatterValue(frontmatter, "summary"),
    status: readMethodFrontmatterValue(frontmatter, "status"),
  };
}

function readMethodFrontmatterValue(frontmatter: string, key: string): string | undefined {
  if (!frontmatter) return undefined;
  const pattern = new RegExp(`^${escapeRegExp(key)}\\s*:\\s*(.+)$`, "im");
  const match = frontmatter.match(pattern);
  if (!match) {
    return undefined;
  }
  return match[1].trim().replace(/^['"]|['"]$/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function handleToolsUpdateWithQueryRuntime(
  ctx: QueryRuntimeToolsContext,
  params: {
    disabled: {
      builtin?: string[];
      mcp_servers?: string[];
      plugins?: string[];
      skills?: string[];
    };
  },
): Promise<GatewayResFrame> {
  const runtime = new QueryRuntime({
    method: "tools.update" as const,
    traceId: ctx.requestId,
    observer: ctx.runtimeObserver,
  });

  return runtime.run(async (queryRuntime) => {
    queryRuntime.mark("runtime_checked", {
      detail: {
        hasToolsConfigManager: Boolean(ctx.toolsConfigManager),
      },
    });

    if (!ctx.toolsConfigManager) {
      queryRuntime.mark("completed", {
        detail: {
          code: "not_available",
        },
      });
      return { type: "res", id: ctx.requestId, ok: false, error: { code: "not_available", message: "Tools config not available" } };
    }

    queryRuntime.mark("request_validated", {
      detail: {
        builtinCount: Array.isArray(params.disabled.builtin) ? params.disabled.builtin.length : 0,
        mcpServerCount: Array.isArray(params.disabled.mcp_servers) ? params.disabled.mcp_servers.length : 0,
        pluginCount: Array.isArray(params.disabled.plugins) ? params.disabled.plugins.length : 0,
        skillCount: Array.isArray(params.disabled.skills) ? params.disabled.skills.length : 0,
      },
    });

    try {
      const sanitizedDisabled = {
        ...params.disabled,
        builtin: Array.isArray(params.disabled.builtin)
          ? params.disabled.builtin.filter((name) => name !== TOOL_SETTINGS_CONTROL_NAME)
          : params.disabled.builtin,
      };
      await ctx.toolsConfigManager.updateConfig(sanitizedDisabled);
      queryRuntime.mark("tool_settings_updated", {
        detail: {
          builtinCount: Array.isArray(sanitizedDisabled.builtin) ? sanitizedDisabled.builtin.length : 0,
          mcpServerCount: Array.isArray(sanitizedDisabled.mcp_servers) ? sanitizedDisabled.mcp_servers.length : 0,
          pluginCount: Array.isArray(sanitizedDisabled.plugins) ? sanitizedDisabled.plugins.length : 0,
          skillCount: Array.isArray(sanitizedDisabled.skills) ? sanitizedDisabled.skills.length : 0,
        },
      });
      queryRuntime.mark("completed");
      return { type: "res", id: ctx.requestId, ok: true };
    } catch (error) {
      return { type: "res", id: ctx.requestId, ok: false, error: { code: "save_failed", message: String(error) } };
    }
  });
}

export async function handleToolSettingsConfirmWithQueryRuntime(
  ctx: QueryRuntimeToolsContext,
  params: {
    requestId: string;
    decision: "approve" | "reject";
    conversationId?: string;
  },
): Promise<GatewayResFrame> {
  const runtime = new QueryRuntime({
    method: "tool_settings.confirm" as const,
    traceId: ctx.requestId,
    observer: ctx.runtimeObserver,
  });

  return runtime.run(async (queryRuntime) => {
    queryRuntime.mark("runtime_checked", {
      detail: {
        hasToolsConfigManager: Boolean(ctx.toolsConfigManager),
        hasConfirmationStore: Boolean(ctx.toolControlConfirmationStore),
      },
    });

    if (!ctx.toolsConfigManager || !ctx.resolvePendingToolControlRequest || !ctx.emitEvent) {
      queryRuntime.mark("completed", {
        detail: {
          code: "unsupported",
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: "unsupported", message: "当前服务未启用工具开关确认处理。" },
      };
    }

    queryRuntime.mark("request_validated", {
      conversationId: params.conversationId,
      detail: {
        decision: params.decision,
        requestId: params.requestId,
      },
    });

    const lookup = ctx.resolvePendingToolControlRequest({
      confirmationStore: ctx.toolControlConfirmationStore,
      getMode: ctx.getAgentToolControlMode,
      getConfirmPassword: ctx.getAgentToolControlConfirmPassword,
      requestId: params.requestId,
      conversationId: params.conversationId,
    });
    if (!lookup.ok) {
      queryRuntime.mark("completed", {
        conversationId: params.conversationId,
        detail: {
          code: lookup.code,
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: lookup.code, message: lookup.message },
      };
    }

    const { pending, summary } = lookup;

    if (params.decision === "reject") {
      ctx.toolControlConfirmationStore?.delete(pending.requestId);
      ctx.emitEvent({
        type: "event",
        event: "tool_settings.confirm.resolved",
        payload: {
          source: "webchat_ui",
          conversationId: pending.conversationId,
          requestId: pending.requestId,
          decision: "rejected",
          summary,
          resolvedAt: Date.now(),
          targetClientId: ctx.clientId,
        },
      });
      queryRuntime.mark("tool_event_emitted", {
        conversationId: pending.conversationId,
        detail: {
          event: "tool_settings.confirm.resolved",
          decision: "rejected",
        },
      });
      queryRuntime.mark("completed", {
        conversationId: pending.conversationId,
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: true,
        payload: {
          conversationId: pending.conversationId,
          requestId: pending.requestId,
          decision: "rejected",
        },
      };
    }

    if (!ctx.applyToolControlChanges || !ctx.buildToolControlDisabledPayload) {
      queryRuntime.mark("completed", {
        conversationId: pending.conversationId,
        detail: {
          code: "unsupported",
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: "unsupported", message: "工具开关确认依赖未完整提供。" },
      };
    }

    const nextDisabled = ctx.applyToolControlChanges(ctx.toolsConfigManager.getConfig().disabled, pending.changes);
    await ctx.toolsConfigManager.updateConfig(nextDisabled);
    const latestDisabled = ctx.toolsConfigManager.getConfig().disabled;
    ctx.toolControlConfirmationStore?.delete(pending.requestId);

    queryRuntime.mark("tool_settings_updated", {
      conversationId: pending.conversationId,
      detail: {
        builtinCount: latestDisabled.builtin.length,
        mcpServerCount: latestDisabled.mcp_servers.length,
        pluginCount: latestDisabled.plugins.length,
        skillCount: Array.isArray(latestDisabled.skills) ? latestDisabled.skills.length : 0,
      },
    });

    ctx.emitEvent({
      type: "event",
      event: "tools.config.updated",
      payload: {
        source: "webchat_ui",
        mode: "confirm",
        disabled: ctx.buildToolControlDisabledPayload(latestDisabled),
      },
    });
    queryRuntime.mark("tool_event_emitted", {
      conversationId: pending.conversationId,
      detail: {
        event: "tools.config.updated",
        source: "webchat_ui",
        mode: "confirm",
      },
    });

    ctx.emitEvent({
      type: "event",
      event: "tool_settings.confirm.resolved",
      payload: {
        source: "webchat_ui",
        conversationId: pending.conversationId,
        requestId: pending.requestId,
        decision: "approved",
        summary,
        resolvedAt: Date.now(),
        targetClientId: ctx.clientId,
      },
    });
    queryRuntime.mark("tool_event_emitted", {
      conversationId: pending.conversationId,
      detail: {
        event: "tool_settings.confirm.resolved",
        decision: "approved",
      },
    });

    queryRuntime.mark("completed", {
      conversationId: pending.conversationId,
    });
    return {
      type: "res",
      id: ctx.requestId,
      ok: true,
      payload: {
        conversationId: pending.conversationId,
        requestId: pending.requestId,
        decision: "approved",
      },
    };
  });
}
