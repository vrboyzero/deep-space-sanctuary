import type {
  ToolAvailabilityState,
  ToolExecutionRuntimeContext,
  ToolExecutor,
} from "@belldandy/skills";

import { isBridgeSessionSubTask } from "./bridge-subtask-runtime.js";
import type { SubTaskRecord } from "./task-runtime.js";

const BRIDGE_RECOVERY_CONTROL_TOOL_NAMES = [
  "bridge_session_start",
  "bridge_session_write",
  "bridge_session_close",
] as const;

type BridgeRecoveryControlToolName = typeof BRIDGE_RECOVERY_CONTROL_TOOL_NAMES[number];

type BridgeRecoveryVisibilityView = {
  available: boolean;
  reasonCode: string;
  reasonMessage: string;
  alwaysEnabled?: boolean;
  contractReason?: string;
};

export type BridgeRecoveryToolDiagnostic = {
  name: BridgeRecoveryControlToolName;
  defaultVisibility: BridgeRecoveryVisibilityView;
  governedVisibility: BridgeRecoveryVisibilityView;
  effectiveDecision:
    | "allowed-by-standard-policy"
    | "allowed-by-governed-bridge-whitelist-bypass"
    | "blocked";
};

export type BridgeRecoveryDiagnostics = {
  applicable: boolean;
  status: "allowed" | "blocked" | "not_applicable";
  headline: string;
  summary: string;
  taskId: string;
  taskKind: string;
  agentId: string | null;
  conversationId: string | null;
  allowedToolCount: number;
  blockedToolCount: number;
  blockedTools: BridgeRecoveryControlToolName[];
  whitelistBypassedTools: BridgeRecoveryControlToolName[];
  runtimeContext: {
    bridgeGovernanceTaskId: string;
    agentWhitelistMode: "governed_bridge_internal";
    hasBridgeSessionLaunch: boolean;
    hasBridgeSubtask: boolean;
  };
  tools: BridgeRecoveryToolDiagnostic[];
};

function toDiagnosticVisibility(
  toolName: BridgeRecoveryControlToolName,
  state: ToolAvailabilityState | undefined,
): BridgeRecoveryVisibilityView {
  if (!state) {
    return {
      available: false,
      reasonCode: "not-registered",
      reasonMessage: `工具 ${toolName} 未注册。`,
    };
  }
  return {
    available: state.available,
    reasonCode: state.reasonCode,
    reasonMessage: state.reasonMessage,
    ...(state.alwaysEnabled ? { alwaysEnabled: state.alwaysEnabled } : {}),
    ...(state.contractReason ? { contractReason: state.contractReason } : {}),
  };
}

function buildBridgeRecoveryRuntimeContext(
  task: Pick<SubTaskRecord, "id" | "launchSpec">,
  mode?: "governed_bridge_internal",
): ToolExecutionRuntimeContext {
  return {
    launchSpec: task.launchSpec,
    channel: "gateway",
    bridgeGovernanceTaskId: task.id,
    ...(mode ? { agentWhitelistMode: mode } : {}),
  };
}

export function buildBridgeRecoveryDiagnostics(input: {
  toolExecutor: Pick<ToolExecutor, "getToolAvailability">;
  task: Pick<SubTaskRecord, "id" | "kind" | "agentId" | "parentConversationId" | "launchSpec">;
  agentId?: string;
  conversationId?: string;
}): BridgeRecoveryDiagnostics {
  const task = input.task;
  const resolvedAgentId = typeof input.agentId === "string" && input.agentId.trim()
    ? input.agentId.trim()
    : typeof task.agentId === "string" && task.agentId.trim()
      ? task.agentId.trim()
      : null;
  const resolvedConversationId = typeof input.conversationId === "string" && input.conversationId.trim()
    ? input.conversationId.trim()
    : typeof task.parentConversationId === "string" && task.parentConversationId.trim()
      ? task.parentConversationId.trim()
      : null;

  if (!isBridgeSessionSubTask(task)) {
    return {
      applicable: false,
      status: "not_applicable",
      headline: `任务 ${task.id} 不是受治理的 bridge subtask。`,
      summary: "只有 kind=bridge_session 且存在 launchSpec.bridgeSession 的任务才会暴露 bridge 恢复诊断。",
      taskId: task.id,
      taskKind: task.kind,
      agentId: resolvedAgentId,
      conversationId: resolvedConversationId,
      allowedToolCount: 0,
      blockedToolCount: BRIDGE_RECOVERY_CONTROL_TOOL_NAMES.length,
      blockedTools: [...BRIDGE_RECOVERY_CONTROL_TOOL_NAMES],
      whitelistBypassedTools: [],
      runtimeContext: {
        bridgeGovernanceTaskId: task.id,
        agentWhitelistMode: "governed_bridge_internal",
        hasBridgeSessionLaunch: false,
        hasBridgeSubtask: Boolean(task.launchSpec?.bridgeSubtask),
      },
      tools: [],
    };
  }

  const baselineContext = buildBridgeRecoveryRuntimeContext(task);
  const governedContext = buildBridgeRecoveryRuntimeContext(task, "governed_bridge_internal");
  const diagnostics = BRIDGE_RECOVERY_CONTROL_TOOL_NAMES.map((toolName) => {
    const defaultVisibility = toDiagnosticVisibility(
      toolName,
      input.toolExecutor.getToolAvailability(toolName, resolvedAgentId ?? undefined, resolvedConversationId ?? undefined, baselineContext),
    );
    const governedVisibility = toDiagnosticVisibility(
      toolName,
      input.toolExecutor.getToolAvailability(toolName, resolvedAgentId ?? undefined, resolvedConversationId ?? undefined, governedContext),
    );
    const whitelistBypassed = !defaultVisibility.available
      && defaultVisibility.reasonCode === "not-in-agent-whitelist"
      && governedVisibility.available;
    return {
      name: toolName,
      defaultVisibility,
      governedVisibility,
      effectiveDecision: governedVisibility.available
        ? whitelistBypassed
          ? "allowed-by-governed-bridge-whitelist-bypass"
          : "allowed-by-standard-policy"
        : "blocked",
    } satisfies BridgeRecoveryToolDiagnostic;
  });

  const blockedTools = diagnostics
    .filter((item) => !item.governedVisibility.available)
    .map((item) => item.name);
  const whitelistBypassedTools = diagnostics
    .filter((item) => item.effectiveDecision === "allowed-by-governed-bridge-whitelist-bypass")
    .map((item) => item.name);
  const allowedToolCount = diagnostics.length - blockedTools.length;
  const missingBridgeSubtask = !task.launchSpec.bridgeSubtask;

  if (blockedTools.length === 0) {
    return {
      applicable: true,
      status: "allowed",
      headline: `Bridge 恢复已放行：${task.id} 当前 ${allowedToolCount}/${diagnostics.length} 个控制工具可用。`,
      summary: whitelistBypassedTools.length > 0
        ? `内部 bridge 白名单策略已为这些工具绕过 Agent 白名单：${whitelistBypassedTools.join(", ")}。`
        : "当前 bridge 恢复不需要额外白名单豁免，控制工具已按标准策略放行。",
      taskId: task.id,
      taskKind: task.kind,
      agentId: resolvedAgentId,
      conversationId: resolvedConversationId,
      allowedToolCount,
      blockedToolCount: 0,
      blockedTools,
      whitelistBypassedTools,
      runtimeContext: {
        bridgeGovernanceTaskId: task.id,
        agentWhitelistMode: "governed_bridge_internal",
        hasBridgeSessionLaunch: true,
        hasBridgeSubtask: Boolean(task.launchSpec.bridgeSubtask),
      },
      tools: diagnostics,
    };
  }

  const blockedSummary = diagnostics
    .filter((item) => !item.governedVisibility.available)
    .map((item) => `${item.name}:${item.governedVisibility.reasonCode}`)
    .join(", ");
  const missingBridgeSubtaskNote = missingBridgeSubtask
    ? "该 task 缺少 launchSpec.bridgeSubtask，无法启用内部 bridge 白名单策略。"
    : undefined;

  return {
    applicable: true,
    status: "blocked",
    headline: `Bridge 恢复被拦截：${task.id} 存在不可用控制工具 (${blockedSummary})。`,
    summary: missingBridgeSubtaskNote
      ?? diagnostics
        .filter((item) => !item.governedVisibility.available)
        .map((item) => `${item.name}: ${item.governedVisibility.reasonMessage}`)
        .join(" "),
    taskId: task.id,
    taskKind: task.kind,
    agentId: resolvedAgentId,
    conversationId: resolvedConversationId,
    allowedToolCount,
    blockedToolCount: blockedTools.length,
    blockedTools,
    whitelistBypassedTools,
    runtimeContext: {
      bridgeGovernanceTaskId: task.id,
      agentWhitelistMode: "governed_bridge_internal",
      hasBridgeSessionLaunch: true,
      hasBridgeSubtask: Boolean(task.launchSpec.bridgeSubtask),
    },
    tools: diagnostics,
  };
}
