import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  normalizeAgentLaunchSpec,
  normalizeAgentLaunchSpecWithCatalog,
  type AgentLaunchSpec,
  type AgentLaunchSpecInput,
  type AgentRegistry,
  type SpawnOptions as OrchestratorSpawnOptions,
  type SubAgentEvent,
  type SubAgentOrchestrator,
} from "@belldandy/agent";
import type {
  AgentCapabilities,
  BridgeSubtaskSemantics,
  SessionInfo,
  SpawnSubAgentOptions,
  SubAgentResult,
} from "@belldandy/skills";
import {
  summarizeDelegationProtocol,
  type SubTaskDelegationSummary,
} from "./subtask-result-envelope.js";
import {
  claimSubTaskCommand,
  createSubTaskCommandIdempotencyKey,
  isSubTaskCommandGenerationCurrent,
  normalizeSubTaskCommandClaim,
  releaseSubTaskCommandClaim,
  SubTaskCommandClaimError,
  type SubTaskCommandClaim,
} from "./subtask-command-claim.js";
import {
  createSubTaskRuntimeQuarantineStatus,
  parseSubTaskRuntimeRegistry,
  SubTaskRuntimeStateLoadError,
  SubTaskRuntimeStoreQuarantinedError,
  type SubTaskRuntimeQuarantineStatus,
} from "./subtask-runtime-state-quarantine.js";
import { SubTaskRuntimeStoreLifecycle } from "./subtask-runtime-store-lifecycle.js";
import { parseGoalSessionKey } from "./goals/session.js";
import { GoalRuntimeBindingStore, type GoalRuntimeBindingSource } from "./goal-runtime-binding-store.js";
import { getGoalRegistryEntry } from "./goals/registry.js";
import { enrichDelegationProtocolTeamWithIdentity } from "./team-identity-governance.js";
import type { SubTaskWorktreeRuntime, SubTaskWorktreeRuntimeSummary, WorktreeRuntimeStatus } from "./worktree-runtime.js";

export type SubTaskStatus = "pending" | "running" | "done" | "error" | "timeout" | "stopped";

export type SubTaskNotificationKind =
  | "queued"
  | "started"
  | "progress"
  | "steering_requested"
  | "steering_delivered"
  | "steering_failed"
  | "takeover_requested"
  | "takeover_delivered"
  | "takeover_failed"
  | "resume_requested"
  | "resume_delivered"
  | "resume_failed"
  | "stop_requested"
  | "stopped"
  | "archived"
  | "completed"
  | "failed"
  | "timeout";

export type SubTaskSteeringStatus = "accepted" | "delivered" | "failed";
export type SubTaskTakeoverStatus = "accepted" | "delivered" | "failed";
export type SubTaskResumeStatus = "accepted" | "delivered" | "failed";
export type SubTaskTakeoverMode = "safe_point" | "resume_relaunch";
export type SubTaskKind = "sub_agent" | "bridge_session";

export type SubTaskBridgeSessionLaunch = {
  targetId: string;
  action: string;
  transport: "pty";
  cwd: string;
  commandPreview: string;
  firstTurnStrategy?: "start-args-prompt" | "write";
  firstTurnHint?: string;
  recommendedReadWaitMs?: number;
  summary?: string;
};

export type SubTaskBridgeSessionRuntimeState = {
  state: "active" | "closed" | "runtime-lost" | "orphaned";
  closeReason?: "manual" | "idle-timeout" | "runtime-lost" | "orphan";
  artifactPath?: string;
  transcriptPath?: string;
  blockReason?: string;
};

export type SubTaskProgress = {
  phase: SubTaskStatus;
  message?: string;
  lastActivityAt: number;
};

export type SubTaskNotification = {
  id: string;
  kind: SubTaskNotificationKind;
  message: string;
  createdAt: number;
};

export type SubTaskSteeringRecord = {
  id: string;
  message: string;
  status: SubTaskSteeringStatus;
  requestedAt: number;
  requestedSessionId?: string;
  deliveredAt?: number;
  deliveredSessionId?: string;
  error?: string;
};

export type SubTaskResumeRecord = {
  id: string;
  message: string;
  status: SubTaskResumeStatus;
  requestedAt: number;
  requestedSessionId?: string;
  deliveredAt?: number;
  deliveredSessionId?: string;
  resumedFromSessionId?: string;
  error?: string;
};

export type SubTaskTakeoverRecord = {
  id: string;
  agentId: string;
  mode: SubTaskTakeoverMode;
  message: string;
  status: SubTaskTakeoverStatus;
  requestedAt: number;
  requestedSessionId?: string;
  deliveredAt?: number;
  deliveredSessionId?: string;
  resumedFromSessionId?: string;
  error?: string;
};

export type SubTaskLaunchSpec = {
  agentId: string;
  profileId: string;
  background: boolean;
  timeoutMs: number;
  channel: string;
  role?: "default" | "commander" | "coder" | "researcher" | "verifier";
  cwd?: string;
  resolvedCwd?: string;
  toolSet?: string[];
  allowedToolFamilies?: string[];
  maxToolRiskLevel?: "low" | "medium" | "high" | "critical";
  policySummary?: string;
  permissionMode?: string;
  isolationMode?: string;
  parentTaskId?: string;
  bridgeSubtask?: BridgeSubtaskSemantics;
  bridgeSession?: SubTaskBridgeSessionLaunch;
  contextKeys?: string[];
  delegation?: SubTaskDelegationSummary;
  worktreePath?: string;
  worktreeRepoRoot?: string;
  worktreeBranch?: string;
  worktreeStatus?: WorktreeRuntimeStatus;
  worktreeError?: string;
};

export type SubTaskRecord = {
  id: string;
  kind: SubTaskKind;
  parentConversationId: string;
  sessionId?: string;
  agentId: string;
  launchSpec: SubTaskLaunchSpec;
  background: boolean;
  status: SubTaskStatus;
  instruction: string;
  summary: string;
  progress: SubTaskProgress;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
  stopRequestedAt?: number;
  stopReason?: string;
  archivedAt?: number;
  archiveReason?: string;
  outputPath?: string;
  scratchPath?: string;
  reviewPath?: string;
  lessonPath?: string;
  outputPreview?: string;
  error?: string;
  bridgeSessionRuntime?: SubTaskBridgeSessionRuntimeState;
  commandGeneration?: number;
  activeCommandClaim?: SubTaskCommandClaim;
  steering: SubTaskSteeringRecord[];
  takeover: SubTaskTakeoverRecord[];
  resume: SubTaskResumeRecord[];
  notifications: SubTaskNotification[];
};

export type SubTaskChangeEvent = {
  kind: "created" | "updated" | "stop_requested" | "stopped" | "archived" | "completed";
  item: SubTaskRecord;
};

type SubTaskRuntimeState = {
  version: 1;
  items: SubTaskRecord[];
};

type CreateSubTaskInput = {
  launchSpec: AgentLaunchSpecInput;
};

type CreateBridgeSessionTaskInput = {
  parentConversationId: string;
  agentId: string;
  profileId: string;
  instruction: string;
  summary?: string;
  parentTaskId?: string;
  bridgeSubtask?: BridgeSubtaskSemantics;
  bridgeSession: SubTaskBridgeSessionLaunch;
};

type CompleteSubTaskInput = {
  status: Extract<SubTaskStatus, "done" | "error" | "timeout" | "stopped">;
  sessionId?: string;
  output?: string;
  error?: string;
  commandGeneration?: number;
  bridgeSessionRuntime?: Partial<SubTaskBridgeSessionRuntimeState>;
};

type RuntimeLogger = {
  info?: (message: string, data?: unknown) => void;
  warn?: (message: string, data?: unknown) => void;
  error?: (message: string, data?: unknown) => void;
  debug?: (message: string, data?: unknown) => void;
};

const STATE_VERSION = 1 as const;
const MAX_NOTIFICATIONS = 20;
const MAX_STEERING_RECORDS = 8;
const MAX_TAKEOVER_RECORDS = 8;
const MAX_RESUME_RECORDS = 8;
const OUTPUT_FILENAME = "result.md";
const THOUGHT_DELTA_PERSIST_DELAY_MS = 32;
const RENAME_RETRIES = 3;
const RENAME_RETRY_DELAY_MS = 50;
const SCRATCH_NOTIFICATION_WINDOW = 6;
const SCRATCH_PROGRESS_WINDOW = 6;
const SUBTASK_RUNTIME_INSTANCE_ID = crypto.randomUUID();

type RuntimeArtifact = {
  taskId: string;
  targetPath: string;
  oldTargetPath?: string;
  content: string;
};

function truncateText(value: string, maxLength = 240): string {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function sanitizeArtifactSegment(value: string | undefined, fallback: string): string {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || fallback;
}

function formatScratchList(items: string[], fallback = "- 暂无记录"): string {
  if (items.length === 0) {
    return `${fallback}\n`;
  }
  return `${items.map((item) => `- ${item}`).join("\n")}\n`;
}

function formatScratchCheckboxList(items: string[], fallback = "- [ ] 暂无待验证项"): string {
  if (items.length === 0) {
    return `${fallback}\n`;
  }
  return `${items.map((item) => `- [ ] ${item}`).join("\n")}\n`;
}

function formatScratchLogBlock(lines: string[], fallback = "_暂无关键日志片段_"): string {
  if (lines.length === 0) {
    return `${fallback}\n`;
  }
  return `${lines.join("\n")}\n`;
}

function inferNotificationKind(status: Extract<SubTaskStatus, "done" | "error" | "timeout" | "stopped">): SubTaskNotificationKind {
  if (status === "done") return "completed";
  if (status === "timeout") return "timeout";
  if (status === "stopped") return "stopped";
  return "failed";
}

function isTerminalStatus(status: SubTaskStatus): boolean {
  return status === "done" || status === "error" || status === "timeout" || status === "stopped";
}

function inferSummary(record: SubTaskRecord, fallback = ""): string {
  return truncateText(record.outputPreview || record.error || fallback || record.instruction, 200);
}

function normalizeBridgeSubtaskSemantics(value: unknown): BridgeSubtaskSemantics | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const kind = typeof record.kind === "string" ? record.kind.trim() : "";
  if (kind !== "analyze" && kind !== "review" && kind !== "patch") {
    return undefined;
  }
  return {
    kind,
    targetId: typeof record.targetId === "string" && record.targetId.trim() ? record.targetId.trim() : undefined,
    action: typeof record.action === "string" && record.action.trim() ? record.action.trim() : undefined,
    goalId: typeof record.goalId === "string" && record.goalId.trim() ? record.goalId.trim() : undefined,
    goalNodeId: typeof record.goalNodeId === "string" && record.goalNodeId.trim() ? record.goalNodeId.trim() : undefined,
    summary: typeof record.summary === "string" && record.summary.trim() ? record.summary.trim() : undefined,
  };
}

function normalizeBridgeSessionLaunch(value: unknown): SubTaskBridgeSessionLaunch | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const targetId = typeof record.targetId === "string" ? record.targetId.trim() : "";
  const action = typeof record.action === "string" ? record.action.trim() : "";
  const cwd = typeof record.cwd === "string" ? record.cwd.trim() : "";
  const commandPreview = typeof record.commandPreview === "string" ? record.commandPreview.trim() : "";
  if (!targetId || !action || !cwd || !commandPreview) {
    return undefined;
  }
  return {
    targetId,
    action,
    transport: "pty",
    cwd,
    commandPreview,
    firstTurnStrategy: record.firstTurnStrategy === "write"
      ? "write"
      : record.firstTurnStrategy === "start-args-prompt"
        ? "start-args-prompt"
        : undefined,
    firstTurnHint: typeof record.firstTurnHint === "string" && record.firstTurnHint.trim()
      ? record.firstTurnHint.trim()
      : undefined,
    recommendedReadWaitMs: typeof record.recommendedReadWaitMs === "number" && Number.isFinite(record.recommendedReadWaitMs)
      ? Math.max(0, Math.trunc(record.recommendedReadWaitMs))
      : undefined,
    summary: typeof record.summary === "string" && record.summary.trim() ? record.summary.trim() : undefined,
  };
}

function normalizeBridgeSessionRuntimeState(value: unknown): SubTaskBridgeSessionRuntimeState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const state = record.state === "active"
    ? "active"
    : record.state === "orphaned"
      ? "orphaned"
    : record.state === "runtime-lost"
      ? "runtime-lost"
      : record.state === "closed"
        ? "closed"
        : undefined;
  if (!state) {
    return undefined;
  }
  return {
    state,
    closeReason: record.closeReason === "manual"
      || record.closeReason === "idle-timeout"
      || record.closeReason === "runtime-lost"
      || record.closeReason === "orphan"
      ? record.closeReason
      : undefined,
    artifactPath: typeof record.artifactPath === "string" && record.artifactPath.trim()
      ? record.artifactPath.trim()
      : undefined,
    transcriptPath: typeof record.transcriptPath === "string" && record.transcriptPath.trim()
      ? record.transcriptPath.trim()
      : undefined,
    blockReason: typeof record.blockReason === "string" && record.blockReason.trim()
      ? record.blockReason.trim()
      : undefined,
  };
}

function createLaunchSpecSummary(
  spec: AgentLaunchSpec,
  runtimeSummary: Partial<SubTaskWorktreeRuntimeSummary> = {},
): SubTaskLaunchSpec {
  return {
    agentId: spec.agentId,
    profileId: spec.profileId,
    background: spec.background,
    timeoutMs: spec.timeoutMs,
    channel: spec.channel,
    role: spec.role,
    cwd: runtimeSummary.requestedCwd ?? spec.cwd,
    resolvedCwd: runtimeSummary.resolvedCwd ?? spec.cwd,
    toolSet: spec.toolSet ? [...spec.toolSet] : undefined,
    allowedToolFamilies: spec.allowedToolFamilies ? [...spec.allowedToolFamilies] : undefined,
    maxToolRiskLevel: spec.maxToolRiskLevel,
    policySummary: spec.policySummary,
    permissionMode: spec.permissionMode,
    isolationMode: spec.isolationMode,
    parentTaskId: spec.parentTaskId,
    bridgeSubtask: spec.bridgeSubtask ? { ...spec.bridgeSubtask } : undefined,
    bridgeSession: undefined,
    contextKeys: spec.context ? Object.keys(spec.context).sort() : undefined,
    delegation: summarizeDelegationProtocol(spec.delegationProtocol),
    worktreePath: runtimeSummary.worktreePath,
    worktreeRepoRoot: runtimeSummary.worktreeRepoRoot,
    worktreeBranch: runtimeSummary.worktreeBranch,
    worktreeStatus: runtimeSummary.worktreeStatus ?? (spec.isolationMode === "worktree" ? "pending" : "not_requested"),
    worktreeError: runtimeSummary.worktreeError,
  };
}

function cloneDelegationSummary(
  delegation: SubTaskDelegationSummary | undefined,
): SubTaskDelegationSummary | undefined {
  if (!delegation) {
    return undefined;
  }
  return {
    ...delegation,
    contextKeys: [...delegation.contextKeys],
    sourceAgentIds: delegation.sourceAgentIds
      ? [...delegation.sourceAgentIds]
      : undefined,
    ownership: delegation.ownership
      ? {
        ...delegation.ownership,
        outOfScope: delegation.ownership.outOfScope
          ? [...delegation.ownership.outOfScope]
          : undefined,
        writeScope: delegation.ownership.writeScope
          ? [...delegation.ownership.writeScope]
          : undefined,
      }
      : undefined,
    acceptance: delegation.acceptance
      ? {
        ...delegation.acceptance,
        verificationHints: delegation.acceptance.verificationHints
          ? [...delegation.acceptance.verificationHints]
          : undefined,
      }
      : undefined,
    deliverableContract: delegation.deliverableContract
      ? {
        ...delegation.deliverableContract,
        requiredSections: delegation.deliverableContract.requiredSections
          ? [...delegation.deliverableContract.requiredSections]
          : undefined,
      }
      : undefined,
    launchDefaults: delegation.launchDefaults
      ? {
        ...delegation.launchDefaults,
        allowedToolFamilies: delegation.launchDefaults.allowedToolFamilies
          ? [...delegation.launchDefaults.allowedToolFamilies]
          : undefined,
      }
      : undefined,
    team: delegation.team
      ? {
        ...delegation.team,
        managerIdentityLabel: delegation.team.managerIdentityLabel,
        memberRoster: delegation.team.memberRoster.map((member) => ({
          ...member,
          reportsTo: member.reportsTo ? [...member.reportsTo] : undefined,
          mayDirect: member.mayDirect ? [...member.mayDirect] : undefined,
          dependsOn: member.dependsOn ? [...member.dependsOn] : undefined,
          handoffTo: member.handoffTo ? [...member.handoffTo] : undefined,
        })),
      }
      : undefined,
  };
}

function normalizeOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
  return items.length > 0 ? items : undefined;
}

function normalizeDelegationSummary(value: unknown): SubTaskDelegationSummary | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const delegationSource = value as Record<string, unknown>;
  return {
    source: typeof delegationSource.source === "string" ? delegationSource.source as SubTaskDelegationSummary["source"] : "session_spawn",
    intentKind: typeof delegationSource.intentKind === "string" ? delegationSource.intentKind as SubTaskDelegationSummary["intentKind"] : "ad_hoc",
    intentSummary: typeof delegationSource.intentSummary === "string" ? delegationSource.intentSummary : "-",
    role: delegationSource.role === "default"
      || delegationSource.role === "coder"
      || delegationSource.role === "researcher"
      || delegationSource.role === "verifier"
      ? delegationSource.role
      : undefined,
    expectedDeliverableFormat: typeof delegationSource.expectedDeliverableFormat === "string"
      ? delegationSource.expectedDeliverableFormat as SubTaskDelegationSummary["expectedDeliverableFormat"]
      : "summary",
    expectedDeliverableSummary: typeof delegationSource.expectedDeliverableSummary === "string"
      ? delegationSource.expectedDeliverableSummary
      : "-",
    aggregationMode: typeof delegationSource.aggregationMode === "string"
      ? delegationSource.aggregationMode as SubTaskDelegationSummary["aggregationMode"]
      : "single",
    contextKeys: Array.isArray(delegationSource.contextKeys)
      ? delegationSource.contextKeys
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
      : [],
    sourceAgentIds: normalizeOptionalStringArray(delegationSource.sourceAgentIds),
    goalId: typeof delegationSource.goalId === "string" && delegationSource.goalId.trim()
      ? delegationSource.goalId.trim()
      : undefined,
    nodeId: typeof delegationSource.nodeId === "string" && delegationSource.nodeId.trim()
      ? delegationSource.nodeId.trim()
      : undefined,
    planId: typeof delegationSource.planId === "string" && delegationSource.planId.trim()
      ? delegationSource.planId.trim()
      : undefined,
    ownership: delegationSource.ownership && typeof delegationSource.ownership === "object" && !Array.isArray(delegationSource.ownership)
      ? {
        scopeSummary: typeof (delegationSource.ownership as Record<string, unknown>).scopeSummary === "string"
          ? String((delegationSource.ownership as Record<string, unknown>).scopeSummary).trim()
          : "-",
        outOfScope: normalizeOptionalStringArray((delegationSource.ownership as Record<string, unknown>).outOfScope),
        writeScope: normalizeOptionalStringArray((delegationSource.ownership as Record<string, unknown>).writeScope),
      }
      : undefined,
    acceptance: delegationSource.acceptance && typeof delegationSource.acceptance === "object" && !Array.isArray(delegationSource.acceptance)
      ? {
        doneDefinition: typeof (delegationSource.acceptance as Record<string, unknown>).doneDefinition === "string"
          ? String((delegationSource.acceptance as Record<string, unknown>).doneDefinition).trim()
          : "-",
        verificationHints: normalizeOptionalStringArray((delegationSource.acceptance as Record<string, unknown>).verificationHints),
      }
      : undefined,
    deliverableContract: delegationSource.deliverableContract && typeof delegationSource.deliverableContract === "object" && !Array.isArray(delegationSource.deliverableContract)
      ? {
        format: typeof (delegationSource.deliverableContract as Record<string, unknown>).format === "string"
          ? (delegationSource.deliverableContract as Record<string, unknown>).format as SubTaskDelegationSummary["expectedDeliverableFormat"]
          : "summary",
        summary: typeof (delegationSource.deliverableContract as Record<string, unknown>).summary === "string"
          && String((delegationSource.deliverableContract as Record<string, unknown>).summary).trim()
          ? String((delegationSource.deliverableContract as Record<string, unknown>).summary).trim()
          : undefined,
        requiredSections: normalizeOptionalStringArray((delegationSource.deliverableContract as Record<string, unknown>).requiredSections),
      }
      : undefined,
    launchDefaults: delegationSource.launchDefaults && typeof delegationSource.launchDefaults === "object" && !Array.isArray(delegationSource.launchDefaults)
      ? {
        permissionMode: typeof (delegationSource.launchDefaults as Record<string, unknown>).permissionMode === "string"
          && String((delegationSource.launchDefaults as Record<string, unknown>).permissionMode).trim()
          ? String((delegationSource.launchDefaults as Record<string, unknown>).permissionMode).trim()
          : undefined,
        allowedToolFamilies: Array.isArray((delegationSource.launchDefaults as Record<string, unknown>).allowedToolFamilies)
          ? ((delegationSource.launchDefaults as Record<string, unknown>).allowedToolFamilies as unknown[])
            .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
            .map((item) => item.trim())
          : undefined,
        maxToolRiskLevel: (delegationSource.launchDefaults as Record<string, unknown>).maxToolRiskLevel === "low"
          || (delegationSource.launchDefaults as Record<string, unknown>).maxToolRiskLevel === "medium"
          || (delegationSource.launchDefaults as Record<string, unknown>).maxToolRiskLevel === "high"
          || (delegationSource.launchDefaults as Record<string, unknown>).maxToolRiskLevel === "critical"
          ? (delegationSource.launchDefaults as Record<string, unknown>).maxToolRiskLevel as "low" | "medium" | "high" | "critical"
          : undefined,
      }
      : undefined,
    team: delegationSource.team && typeof delegationSource.team === "object" && !Array.isArray(delegationSource.team)
      ? normalizeDelegationTeamSummary(delegationSource.team)
      : undefined,
  };
}

function normalizeDelegationTeamSummary(
  value: unknown,
): SubTaskDelegationSummary["team"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const id = typeof source.id === "string" && source.id.trim() ? source.id.trim() : "";
  const mode = source.mode === "parallel_subtasks"
    || source.mode === "parallel_patch"
    || source.mode === "research_grid"
    || source.mode === "verify_swarm"
    || source.mode === "plan_execute_verify"
    ? source.mode
    : undefined;
  const memberRoster = Array.isArray(source.memberRoster)
    ? source.memberRoster
      .map((entry) => normalizeDelegationTeamMemberSummary(entry))
      .filter((entry): entry is NonNullable<SubTaskDelegationSummary["team"]>["memberRoster"][number] => Boolean(entry))
    : [];
  if (!id || !mode || memberRoster.length === 0) {
    return undefined;
  }
  const currentLaneId = typeof source.currentLaneId === "string" && source.currentLaneId.trim()
    ? source.currentLaneId.trim()
    : undefined;
  return {
    id,
    mode,
    ...(typeof source.sharedGoal === "string" && source.sharedGoal.trim() ? { sharedGoal: source.sharedGoal.trim() } : {}),
    ...(typeof source.managerAgentId === "string" && source.managerAgentId.trim() ? { managerAgentId: source.managerAgentId.trim() } : {}),
    ...(typeof source.managerIdentityLabel === "string" && source.managerIdentityLabel.trim()
      ? { managerIdentityLabel: source.managerIdentityLabel.trim() }
      : {}),
    ...(currentLaneId && memberRoster.some((member) => member.laneId === currentLaneId) ? { currentLaneId } : {}),
    memberRoster,
  };
}

function normalizeDelegationTeamMemberSummary(
  value: unknown,
): NonNullable<SubTaskDelegationSummary["team"]>["memberRoster"][number] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const laneId = typeof source.laneId === "string" && source.laneId.trim() ? source.laneId.trim() : "";
  if (!laneId) {
    return undefined;
  }
  const role = source.role === "default"
    || source.role === "coder"
    || source.role === "researcher"
    || source.role === "verifier"
    ? source.role
    : undefined;
  const authorityRelationToManager = source.authorityRelationToManager === "self"
    || source.authorityRelationToManager === "superior"
    || source.authorityRelationToManager === "peer"
    || source.authorityRelationToManager === "subordinate"
    || source.authorityRelationToManager === "unknown"
    ? source.authorityRelationToManager
    : undefined;
  return {
    laneId,
    ...(typeof source.agentId === "string" && source.agentId.trim() ? { agentId: source.agentId.trim() } : {}),
    ...(role ? { role } : {}),
    ...(typeof source.identityLabel === "string" && source.identityLabel.trim() ? { identityLabel: source.identityLabel.trim() } : {}),
    ...(authorityRelationToManager ? { authorityRelationToManager } : {}),
    ...(normalizeOptionalStringArray(source.reportsTo) ? { reportsTo: normalizeOptionalStringArray(source.reportsTo) } : {}),
    ...(normalizeOptionalStringArray(source.mayDirect) ? { mayDirect: normalizeOptionalStringArray(source.mayDirect) } : {}),
    ...(typeof source.scopeSummary === "string" && source.scopeSummary.trim() ? { scopeSummary: source.scopeSummary.trim() } : {}),
    ...(normalizeOptionalStringArray(source.dependsOn) ? { dependsOn: normalizeOptionalStringArray(source.dependsOn) } : {}),
    ...(normalizeOptionalStringArray(source.handoffTo) ? { handoffTo: normalizeOptionalStringArray(source.handoffTo) } : {}),
  };
}

async function atomicWriteText(targetPath: string, content: string): Promise<void> {
  const tmpPath = `${targetPath}.${crypto.randomUUID()}.tmp`;
  const targetDir = path.dirname(targetPath);
  for (let attempt = 0; attempt < RENAME_RETRIES; attempt += 1) {
    try {
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(tmpPath, content, "utf-8");
      break;
    } catch (error) {
      const fsError = error as NodeJS.ErrnoException;
      if (fsError.code !== "ENOENT" || attempt >= RENAME_RETRIES - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_DELAY_MS));
    }
  }
  let lastErr: NodeJS.ErrnoException | null = null;
  for (let attempt = 0; attempt < RENAME_RETRIES; attempt += 1) {
    try {
      await fs.rename(tmpPath, targetPath);
      return;
    } catch (error) {
      lastErr = error as NodeJS.ErrnoException;
      if (lastErr.code === "ENOENT") {
        await fs.mkdir(targetDir, { recursive: true }).catch(() => {});
      }
      if (attempt < RENAME_RETRIES - 1) {
        await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_DELAY_MS));
      }
    }
  }

  if (process.platform === "win32" && lastErr && (lastErr.code === "EPERM" || lastErr.code === "EBUSY")) {
    try {
      await fs.writeFile(targetPath, content, "utf-8");
      await fs.unlink(tmpPath).catch(() => {});
      return;
    } catch (fallbackError) {
      await fs.unlink(tmpPath).catch(() => {});
      throw fallbackError;
    }
  }

  await fs.unlink(tmpPath).catch(() => {});
  throw lastErr;
}

function cloneRecord(record: SubTaskRecord): SubTaskRecord {
  return {
    ...record,
    launchSpec: {
      ...record.launchSpec,
      toolSet: record.launchSpec.toolSet ? [...record.launchSpec.toolSet] : undefined,
      allowedToolFamilies: record.launchSpec.allowedToolFamilies ? [...record.launchSpec.allowedToolFamilies] : undefined,
      bridgeSubtask: record.launchSpec.bridgeSubtask ? { ...record.launchSpec.bridgeSubtask } : undefined,
      bridgeSession: record.launchSpec.bridgeSession ? { ...record.launchSpec.bridgeSession } : undefined,
      contextKeys: record.launchSpec.contextKeys ? [...record.launchSpec.contextKeys] : undefined,
      delegation: cloneDelegationSummary(record.launchSpec.delegation),
    },
    bridgeSessionRuntime: record.bridgeSessionRuntime ? { ...record.bridgeSessionRuntime } : undefined,
    activeCommandClaim: record.activeCommandClaim ? { ...record.activeCommandClaim } : undefined,
    progress: { ...record.progress },
    scratchPath: record.scratchPath,
    reviewPath: record.reviewPath,
    lessonPath: record.lessonPath,
    steering: record.steering.map((item) => ({ ...item })),
    takeover: record.takeover.map((item) => ({ ...item })),
    resume: record.resume.map((item) => ({ ...item })),
    notifications: record.notifications.map((item) => ({ ...item })),
  };
}

function mergeLaunchSpecWorktreeRuntime(
  current: SubTaskLaunchSpec,
  runtimeSummary: Partial<SubTaskWorktreeRuntimeSummary>,
): SubTaskLaunchSpec {
  const next: SubTaskLaunchSpec = {
    ...current,
  };

  if (Object.prototype.hasOwnProperty.call(runtimeSummary, "requestedCwd")) {
    next.cwd = runtimeSummary.requestedCwd;
  }
  if (Object.prototype.hasOwnProperty.call(runtimeSummary, "resolvedCwd")) {
    next.resolvedCwd = runtimeSummary.resolvedCwd;
  }
  if (Object.prototype.hasOwnProperty.call(runtimeSummary, "worktreePath")) {
    next.worktreePath = runtimeSummary.worktreePath;
  }
  if (Object.prototype.hasOwnProperty.call(runtimeSummary, "worktreeRepoRoot")) {
    next.worktreeRepoRoot = runtimeSummary.worktreeRepoRoot;
  }
  if (Object.prototype.hasOwnProperty.call(runtimeSummary, "worktreeBranch")) {
    next.worktreeBranch = runtimeSummary.worktreeBranch;
  }
  if (Object.prototype.hasOwnProperty.call(runtimeSummary, "worktreeStatus")) {
    next.worktreeStatus = runtimeSummary.worktreeStatus;
  }
  if (Object.prototype.hasOwnProperty.call(runtimeSummary, "worktreeError")) {
    next.worktreeError = runtimeSummary.worktreeError;
  }

  return next;
}

function resolveGoalBindingFromTaskRecord(record: SubTaskRecord): {
  source: GoalRuntimeBindingSource;
  goalId: string;
  nodeId?: string;
  runId?: string;
  taskId: string;
  agentId?: string;
  profileId?: string;
  role?: "default" | "commander" | "coder" | "researcher" | "verifier";
  conversationId?: string;
  parentConversationId?: string;
  sessionId?: string;
  planId?: string;
  status: string;
  finishedAt?: string;
} | undefined {
  const delegation = record.launchSpec.delegation;
  const bridgeSubtask = record.launchSpec.bridgeSubtask;
  const parsedSession = parseGoalSessionKey(record.parentConversationId);
  const goalId = delegation?.goalId?.trim()
    || bridgeSubtask?.goalId?.trim()
    || parsedSession?.goalId;
  if (!goalId) {
    return undefined;
  }
  const nodeId = delegation?.nodeId?.trim()
    || bridgeSubtask?.goalNodeId?.trim()
    || (parsedSession?.kind === "goal_node" ? parsedSession.nodeId : undefined);
  const runId = parsedSession?.kind === "goal_node"
    ? parsedSession.runId
    : undefined;
  const source: GoalRuntimeBindingSource = record.kind === "bridge_session"
    ? "bridge_session"
    : delegation?.source === "goal_verifier"
      ? "goal_verifier"
      : "goal_subtask";
  return {
    source,
    goalId,
    nodeId,
    runId,
    taskId: record.id,
    agentId: record.agentId,
    profileId: record.launchSpec.profileId,
    role: record.launchSpec.role,
    conversationId: record.parentConversationId,
    parentConversationId: record.parentConversationId,
    sessionId: record.sessionId,
    planId: delegation?.planId,
    status: record.status,
    finishedAt: record.finishedAt ? new Date(record.finishedAt).toISOString() : undefined,
  };
}

export class SubTaskRuntimeStore {
  private readonly stateDir: string;
  private readonly runtimeDir: string;
  private readonly statePath: string;
  private readonly outputsDir: string;
  private readonly logger?: RuntimeLogger;
  private readonly bindingStore?: GoalRuntimeBindingStore;
  private readonly records = new Map<string, SubTaskRecord>();
  private readonly sessionToTask = new Map<string, string>();
  private readonly listeners = new Set<(event: SubTaskChangeEvent) => void>();
  private readonly dirtyScratchTaskIds = new Set<string>();
  private readonly dirtyPostRunArtifactTaskIds = new Set<string>();
  private readonly lifecycle = new SubTaskRuntimeStoreLifecycle();
  private writeChain = Promise.resolve();
  private loadPromise: Promise<void> | null = null;
  private deferredPersistTimer: NodeJS.Timeout | null = null;
  private quarantineStatus: SubTaskRuntimeQuarantineStatus | undefined;

  constructor(stateDir: string, logger?: RuntimeLogger, bindingStore?: GoalRuntimeBindingStore) {
    this.stateDir = stateDir;
    this.runtimeDir = path.join(stateDir, "subtasks");
    this.statePath = path.join(this.runtimeDir, "registry.json");
    this.outputsDir = path.join(this.runtimeDir, "outputs");
    this.logger = logger;
    this.bindingStore = bindingStore;
  }

  async load(): Promise<void> {
    if (this.loadPromise) {
      return this.loadPromise;
    }
    this.loadPromise = (async () => {
      await fs.mkdir(this.runtimeDir, { recursive: true });
      this.records.clear();
      this.sessionToTask.clear();
      let recoveredInterruptedClaims = false;
      try {
        const raw = await fs.readFile(this.statePath, "utf-8");
        const parsed = parseSubTaskRuntimeRegistry(raw);
        for (const item of parsed.items) {
          const record = this.normalizeRecord(item);
          if (!record || this.records.has(record.id)) {
            throw new SubTaskRuntimeStateLoadError("invalid_item");
          }
          recoveredInterruptedClaims = this.recoverInterruptedCommandClaim(record) || recoveredInterruptedClaims;
          this.records.set(record.id, record);
          if (record.sessionId) {
            this.sessionToTask.set(record.sessionId, record.id);
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
          return;
        }
        this.records.clear();
        this.sessionToTask.clear();
        this.quarantineStatus = createSubTaskRuntimeQuarantineStatus(this.statePath, error);
        this.logger?.warn?.("Subtask runtime registry entered read-only quarantine.", {
          statePath: this.quarantineStatus.statePath,
          kind: this.quarantineStatus.kind,
        });
        return;
      }
      if (recoveredInterruptedClaims) {
        try {
          await this.persist();
        } catch (error) {
          this.logger?.warn?.("Failed to persist recovered subtask command claims.", error);
        }
      }
    })();
    return this.loadPromise;
  }

  getQuarantineStatus(): SubTaskRuntimeQuarantineStatus | undefined {
    return this.quarantineStatus ? { ...this.quarantineStatus } : undefined;
  }

  async flushAndClose(): Promise<void> {
    return this.lifecycle.close(async () => {
      await this.load();
      this.cancelDeferredPersist();
      await this.writeChain;
      if (this.quarantineStatus) {
        return;
      }
      const run = this.writeChain.then(() => this.persist());
      this.writeChain = run.catch(() => {});
      await run;
    });
  }

  subscribe(listener: (event: SubTaskChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async createTask(input: CreateSubTaskInput): Promise<SubTaskRecord> {
    await this.load();
    return this.mutate(async () => {
      const now = Date.now();
      const launchSpec = normalizeAgentLaunchSpec(input.launchSpec);
      const record: SubTaskRecord = {
        id: `task_${crypto.randomUUID().slice(0, 8)}`,
        kind: "sub_agent",
        parentConversationId: launchSpec.parentConversationId,
        agentId: launchSpec.agentId,
        launchSpec: createLaunchSpecSummary(launchSpec),
        background: launchSpec.background,
        status: "pending",
        instruction: launchSpec.instruction,
        summary: truncateText(launchSpec.instruction, 160),
        progress: {
          phase: "pending",
          message: "Task created and waiting to start.",
          lastActivityAt: now,
        },
        createdAt: now,
        updatedAt: now,
        commandGeneration: 0,
        steering: [],
        takeover: [],
        resume: [],
        notifications: [],
      };
      this.pushNotification(record, "queued", "Task created and waiting for orchestration.");
      this.records.set(record.id, record);
      this.markScratchDirty(record);
      await this.syncGoalRuntimeArtifactsForRecord(record);
      this.emitChange("created", record);
      return cloneRecord(record);
    });
  }

  async createBridgeSessionTask(input: CreateBridgeSessionTaskInput): Promise<SubTaskRecord> {
    await this.load();
    return this.mutate(async () => {
      const now = Date.now();
      const record: SubTaskRecord = {
        id: `task_${crypto.randomUUID().slice(0, 8)}`,
        kind: "bridge_session",
        parentConversationId: input.parentConversationId,
        agentId: input.agentId,
        launchSpec: {
          agentId: input.agentId,
          profileId: input.profileId,
          background: true,
          timeoutMs: 120_000,
          channel: "bridge_session",
          parentTaskId: input.parentTaskId,
          bridgeSubtask: input.bridgeSubtask ? { ...input.bridgeSubtask } : undefined,
          bridgeSession: { ...input.bridgeSession },
        },
        background: true,
        status: "pending",
        instruction: input.instruction,
        summary: truncateText(input.summary || input.bridgeSession.summary || input.instruction, 200),
        progress: {
          phase: "pending",
          message: "Bridge session task created and waiting to start.",
          lastActivityAt: now,
        },
        createdAt: now,
        updatedAt: now,
        commandGeneration: 0,
        steering: [],
        takeover: [],
        resume: [],
        notifications: [],
      };
      this.pushNotification(record, "queued", `Bridge session task created for ${input.bridgeSession.targetId}.${input.bridgeSession.action}.`);
      this.records.set(record.id, record);
      this.markScratchDirty(record);
      await this.syncGoalRuntimeArtifactsForRecord(record);
      this.emitChange("created", record);
      return cloneRecord(record);
    });
  }

  async updateBridgeSessionTask(
    taskId: string,
    input: {
      agentId?: string;
      profileId?: string;
      instruction?: string;
      summary?: string;
      bridgeSubtask?: BridgeSubtaskSemantics;
      bridgeSession: SubTaskBridgeSessionLaunch;
    },
  ): Promise<SubTaskRecord | undefined> {
    await this.load();
    return this.mutate(async () => {
      const record = this.records.get(taskId);
      if (!record) return undefined;
      const now = Date.now();
      record.kind = "bridge_session";
      if (input.agentId?.trim()) {
        record.agentId = input.agentId.trim();
        record.launchSpec.agentId = input.agentId.trim();
      }
      if (input.profileId?.trim()) {
        record.launchSpec.profileId = input.profileId.trim();
      }
      if (input.instruction?.trim()) {
        record.instruction = input.instruction.trim();
      }
      if (input.summary?.trim()) {
        record.summary = truncateText(input.summary.trim(), 200);
      } else if (!record.summary) {
        record.summary = truncateText(
          input.bridgeSession.summary || input.instruction || record.instruction,
          200,
        );
      }
      record.launchSpec.channel = "bridge_session";
      record.launchSpec.bridgeSession = { ...input.bridgeSession };
      record.launchSpec.bridgeSubtask = input.bridgeSubtask ? { ...input.bridgeSubtask } : undefined;
      record.updatedAt = now;
      this.markScratchDirty(record);
      await this.syncGoalRuntimeArtifactsForRecord(record);
      this.emitChange("updated", record);
      return cloneRecord(record);
    });
  }

  async updateTaskLaunchSpec(
    taskId: string,
    input: {
      launchSpec: AgentLaunchSpec;
      runtimeSummary?: Partial<SubTaskWorktreeRuntimeSummary>;
    },
  ): Promise<SubTaskRecord | undefined> {
    await this.load();
    return this.mutate(async () => {
      const record = this.records.get(taskId);
      if (!record) return undefined;
      const now = Date.now();
      record.agentId = input.launchSpec.agentId;
      record.background = input.launchSpec.background;
      record.updatedAt = now;
      record.launchSpec = createLaunchSpecSummary(input.launchSpec, input.runtimeSummary);
      this.markScratchDirty(record);
      await this.syncGoalRuntimeArtifactsForRecord(record);
      this.emitChange("updated", record);
      return cloneRecord(record);
    });
  }

  async updateTaskWorktreeRuntime(
    taskId: string,
    input: {
      runtimeSummary: Partial<SubTaskWorktreeRuntimeSummary>;
    },
  ): Promise<SubTaskRecord | undefined> {
    await this.load();
    return this.mutate(async () => {
      const record = this.records.get(taskId);
      if (!record) return undefined;
      record.updatedAt = Date.now();
      record.launchSpec = mergeLaunchSpecWorktreeRuntime(record.launchSpec, input.runtimeSummary);
      this.markScratchDirty(record);
      this.emitChange("updated", record);
      return cloneRecord(record);
    });
  }

  async markQueued(
    taskId: string,
    position: number,
    session?: {
      sessionId?: string;
      agentId?: string;
      profileId?: string;
      commandClaim?: SubTaskCommandClaim;
    },
  ): Promise<SubTaskRecord | undefined> {
    await this.load();
    return this.mutate(async () => {
      const record = this.records.get(taskId);
      if (!record) return undefined;
      if (session?.commandClaim && !isSubTaskCommandGenerationCurrent(record, session.commandClaim)) {
        return cloneRecord(record);
      }
      // 排队回调可能晚于停止请求；此时不能把 terminal/stop_requested 状态重置回 pending。
      if (isTerminalStatus(record.status) || record.stopRequestedAt) {
        return cloneRecord(record);
      }
      const now = Date.now();
      if (session?.sessionId) {
        if (record.sessionId && record.sessionId !== session.sessionId) {
          this.sessionToTask.delete(record.sessionId);
        }
        record.sessionId = session.sessionId;
        this.sessionToTask.set(session.sessionId, taskId);
      }
      if (session?.agentId?.trim()) {
        record.agentId = session.agentId.trim();
        record.launchSpec.agentId = session.agentId.trim();
      }
      if (session?.profileId?.trim()) {
        record.launchSpec.profileId = session.profileId.trim();
      }
      record.status = "pending";
      record.updatedAt = now;
      record.progress = {
        phase: "pending",
        message: `Queued at position ${position}.`,
        lastActivityAt: now,
      };
      record.summary = inferSummary(record, `Queued at position ${position}.`);
      this.pushNotification(record, "queued", `Queued at position ${position}.`);
      this.markScratchDirty(record);
      this.emitChange("updated", record);
      return cloneRecord(record);
    });
  }

  async requestStop(taskId: string, reason = "Task stop requested by user."): Promise<SubTaskRecord | undefined> {
    await this.load();
    return this.mutate(async () => {
      const record = this.records.get(taskId);
      if (!record) return undefined;
      if (isTerminalStatus(record.status)) return cloneRecord(record);
      const now = Date.now();
      record.stopRequestedAt = now;
      record.stopReason = reason;
      record.updatedAt = now;
      record.progress = {
        phase: record.status,
        message: record.sessionId ? "Task stop requested. Waiting for runtime shutdown." : "Task stop requested before execution.",
        lastActivityAt: now,
      };
      record.summary = inferSummary(record, record.progress.message);
      this.pushNotification(record, "stop_requested", reason);
      this.markScratchDirty(record);
      this.emitChange("stop_requested", record);
      return cloneRecord(record);
    });
  }

  async markStopped(
    taskId: string,
    input: {
      reason?: string;
      sessionId?: string;
    } = {},
  ): Promise<SubTaskRecord | undefined> {
    await this.load();
    return this.mutate(async () => {
      const record = this.records.get(taskId);
      if (!record) return undefined;
      if (record.sessionId && input.sessionId && input.sessionId !== record.sessionId) {
        this.sessionToTask.delete(input.sessionId);
        return cloneRecord(record);
      }
      const now = Date.now();
      const reason = input.reason?.trim() || record.stopReason || "Task stopped by user.";
      if (input.sessionId && input.sessionId !== record.sessionId) {
        record.sessionId = input.sessionId;
        this.sessionToTask.set(input.sessionId, taskId);
      }
      record.status = "stopped";
      record.updatedAt = now;
      record.finishedAt = now;
      record.stopRequestedAt = record.stopRequestedAt ?? now;
      record.stopReason = reason;
      record.error = reason;
      record.progress = {
        phase: "stopped",
        message: reason,
        lastActivityAt: now,
      };
      record.summary = inferSummary(record, reason);
      this.pushNotification(record, "stopped", reason);
      this.markScratchDirty(record);
      this.markPostRunArtifactsDirty(record);
      await this.ensurePostRunArtifactPathsForRecord(record);
      this.emitChange("stopped", record);
      return cloneRecord(record);
    });
  }

  async archiveTask(taskId: string, reason = "Archived by user."): Promise<SubTaskRecord | undefined> {
    await this.load();
    return this.mutate(async () => {
      const record = this.records.get(taskId);
      if (!record) return undefined;
      const now = Date.now();
      record.archivedAt = now;
      record.archiveReason = reason;
      record.updatedAt = now;
      this.pushNotification(record, "archived", reason);
      this.markScratchDirty(record);
      this.markPostRunArtifactsDirty(record);
      await this.ensurePostRunArtifactPathsForRecord(record);
      this.emitChange("archived", record);
      return cloneRecord(record);
    });
  }

  async attachSession(
    taskId: string,
    sessionId: string,
    agentId?: string,
    profileId?: string,
    commandClaim?: SubTaskCommandClaim,
  ): Promise<SubTaskRecord | undefined> {
    await this.load();
    return this.mutate(async () => {
      const record = this.records.get(taskId);
      if (!record) return undefined;
      if (commandClaim && !isSubTaskCommandGenerationCurrent(record, commandClaim)) {
        return cloneRecord(record);
      }
      const now = Date.now();
      if (record.sessionId && record.sessionId !== sessionId) {
        this.sessionToTask.delete(record.sessionId);
      }
      record.sessionId = sessionId;
      if (agentId?.trim()) {
        record.agentId = agentId.trim();
        record.launchSpec.agentId = agentId.trim();
      }
      if (profileId?.trim()) {
        record.launchSpec.profileId = profileId.trim();
      }
      record.status = "running";
      record.updatedAt = now;
      record.finishedAt = undefined;
      record.error = undefined;
      record.stopRequestedAt = undefined;
      record.stopReason = undefined;
      record.progress = {
        phase: "running",
        message: "Task is running.",
        lastActivityAt: now,
      };
      if (record.kind === "bridge_session") {
        record.bridgeSessionRuntime = {
          state: "active",
        };
      }
      record.summary = inferSummary(record, "Task is running.");
      this.sessionToTask.set(sessionId, taskId);
      this.pushNotification(record, "started", `Task started in session ${sessionId}.`);
      this.markScratchDirty(record);
      await this.syncGoalRuntimeArtifactsForRecord(record);
      this.emitChange("updated", record);
      return cloneRecord(record);
    });
  }

  async recordThoughtDeltaBySession(sessionId: string, delta: string): Promise<SubTaskRecord | undefined> {
    await this.load();
    return this.mutate(async () => {
      const taskId = this.sessionToTask.get(sessionId);
      if (!taskId) return undefined;
      const record = this.records.get(taskId);
      if (!record) return undefined;
      if (record.sessionId !== sessionId) {
        this.sessionToTask.delete(sessionId);
        return cloneRecord(record);
      }
      const snippet = truncateText(delta, 180);
      if (!snippet) return cloneRecord(record);
      const now = Date.now();
      record.updatedAt = now;
      record.progress = {
        phase: record.status === "pending" ? "running" : record.status,
        message: snippet,
        lastActivityAt: now,
      };
      if (record.status === "pending") {
        record.status = "running";
      }
      record.summary = inferSummary(record, snippet);
      this.pushNotification(record, "progress", snippet);
      this.markScratchDirty(record);
      this.emitChange("updated", record);
      return cloneRecord(record);
    }, { persist: "deferred" });
  }

  async completeTask(taskId: string, input: CompleteSubTaskInput): Promise<SubTaskRecord | undefined> {
    await this.load();
    return this.mutate(async () => {
      const record = this.records.get(taskId);
      if (!record) return undefined;
      if (input.commandGeneration !== undefined && input.commandGeneration !== record.commandGeneration) {
        return cloneRecord(record);
      }
      // command 交接期间，旧 session 的完成事件不能抢先写入终态。
      if (record.activeCommandClaim && input.commandGeneration === undefined) {
        return cloneRecord(record);
      }
      const activeCommandClaim = record.activeCommandClaim;
      if (activeCommandClaim && activeCommandClaim.generation === input.commandGeneration) {
        // 某些 orchestrator 可能在未回调 onSessionCreated 时直接返回终态；此时由同代 completion 释放 claim，避免永久阻塞后续命令。
        releaseSubTaskCommandClaim(
          record,
          activeCommandClaim.kind,
          activeCommandClaim.commandId,
        );
      }
      if (record.sessionId && input.sessionId && input.sessionId !== record.sessionId) {
        return cloneRecord(record);
      }
      const now = Date.now();
      if (input.sessionId && input.sessionId !== record.sessionId) {
        record.sessionId = input.sessionId;
        this.sessionToTask.set(input.sessionId, taskId);
      }
      record.status = input.status;
      record.updatedAt = now;
      record.finishedAt = now;
      record.error = input.error ?? (input.status === "stopped" ? (record.stopReason || "Task stopped by user.") : undefined);
      if (typeof input.output === "string" && input.output.trim()) {
        record.outputPreview = truncateText(input.output, 200);
        const outputPath = path.join(this.outputsDir, taskId, OUTPUT_FILENAME);
        await atomicWriteText(outputPath, input.output);
        record.outputPath = outputPath;
      }
      if (record.kind === "bridge_session" && (input.bridgeSessionRuntime || record.bridgeSessionRuntime)) {
        const runtimeState = input.bridgeSessionRuntime?.state
          ?? (record.bridgeSessionRuntime?.state === "runtime-lost" || record.bridgeSessionRuntime?.state === "orphaned"
            ? record.bridgeSessionRuntime.state
            : record.bridgeSessionRuntime
              ? "closed"
              : undefined);
        if (runtimeState) {
          record.bridgeSessionRuntime = {
            state: runtimeState,
            closeReason: input.bridgeSessionRuntime?.closeReason,
            artifactPath: input.bridgeSessionRuntime?.artifactPath,
            transcriptPath: input.bridgeSessionRuntime?.transcriptPath,
            blockReason: input.bridgeSessionRuntime?.blockReason,
          };
        }
      }
      record.progress = {
        phase: input.status,
        message: input.status === "done"
          ? "Task completed."
          : input.status === "stopped"
            ? (record.stopReason || "Task stopped by user.")
          : input.error
            ? truncateText(input.error, 180)
            : "Task finished with an error.",
        lastActivityAt: now,
      };
      record.summary = inferSummary(record, record.progress.message);
      this.pushNotification(
        record,
        inferNotificationKind(input.status),
        input.status === "done"
          ? "Task completed successfully."
          : input.error || "Task finished with an error.",
      );
      this.markScratchDirty(record);
      this.markPostRunArtifactsDirty(record);
      await this.ensurePostRunArtifactPathsForRecord(record);
      await this.syncGoalRuntimeArtifactsForRecord(record);
      this.emitChange(input.status === "stopped" ? "stopped" : "completed", record);
      return cloneRecord(record);
    });
  }

  async requestSteering(
    taskId: string,
    message: string,
    input: {
      sessionId?: string;
      idempotencyKey?: string;
    } = {},
  ): Promise<{
    item: SubTaskRecord;
    steering: SubTaskSteeringRecord;
    commandClaim: SubTaskCommandClaim;
    claimOwner: boolean;
  } | undefined> {
    await this.load();
    return this.mutate(async () => {
      const record = this.records.get(taskId);
      if (!record) return undefined;
      const normalizedMessage = String(message ?? "").trim();
      if (!normalizedMessage) return undefined;
      const now = Date.now();
      const steering: SubTaskSteeringRecord = {
        id: `task_steering_${crypto.randomUUID().slice(0, 8)}`,
        message: normalizedMessage,
        status: "accepted",
        requestedAt: now,
        requestedSessionId: input.sessionId?.trim() || record.sessionId,
      };
      const claimResult = claimSubTaskCommand(record, {
        kind: "steering",
        commandId: steering.id,
        idempotencyKey: input.idempotencyKey?.trim() || createSubTaskCommandIdempotencyKey({
          taskId,
          kind: "steering",
          message: normalizedMessage,
          sessionId: steering.requestedSessionId,
        }),
        requestedAt: now,
        expectedSessionId: steering.requestedSessionId,
        ownerInstanceId: SUBTASK_RUNTIME_INSTANCE_ID,
      });
      if (claimResult.status === "rejected") {
        throw new SubTaskCommandClaimError(claimResult.reason);
      }
      if (claimResult.status === "replayed") {
        const existing = record.steering.find((item) => item.id === claimResult.claim.commandId);
        if (!existing) {
          throw new SubTaskCommandClaimError("Subtask steering claim is missing its accepted record.");
        }
        return {
          item: cloneRecord(record),
          steering: { ...existing },
          commandClaim: { ...claimResult.claim },
          claimOwner: false,
        };
      }
      record.updatedAt = now;
      record.steering.push(steering);
      if (record.steering.length > MAX_STEERING_RECORDS) {
        record.steering = record.steering.slice(-MAX_STEERING_RECORDS);
      }
      this.pushNotification(record, "steering_requested", `Steering accepted: ${truncateText(normalizedMessage, 160)}`);
      this.markScratchDirty(record);
      this.emitChange("updated", record);
      return {
        item: cloneRecord(record),
        steering: { ...steering },
        commandClaim: { ...claimResult.claim },
        claimOwner: true,
      };
    });
  }

  async markSteeringDelivered(
    taskId: string,
    steeringId: string,
    input: {
      sessionId?: string;
    } = {},
  ): Promise<SubTaskRecord | undefined> {
    await this.load();
    return this.mutate(async () => {
      const record = this.records.get(taskId);
      if (!record) return undefined;
      const steering = record.steering.find((item) => item.id === steeringId);
      if (!steering) return cloneRecord(record);
      if (record.activeCommandClaim && !releaseSubTaskCommandClaim(record, "steering", steeringId)) {
        return cloneRecord(record);
      }
      steering.status = "delivered";
      steering.deliveredAt = Date.now();
      steering.deliveredSessionId = input.sessionId?.trim() || record.sessionId;
      steering.error = undefined;
      record.updatedAt = steering.deliveredAt;
      this.pushNotification(record, "steering_delivered", "Steering delivered to the relaunched subtask session.");
      this.markScratchDirty(record);
      this.emitChange("updated", record);
      return cloneRecord(record);
    });
  }

  async markSteeringFailed(taskId: string, steeringId: string, reason: string): Promise<SubTaskRecord | undefined> {
    await this.load();
    return this.mutate(async () => {
      const record = this.records.get(taskId);
      if (!record) return undefined;
      const steering = record.steering.find((item) => item.id === steeringId);
      if (!steering) return cloneRecord(record);
      if (record.activeCommandClaim && !releaseSubTaskCommandClaim(record, "steering", steeringId)) {
        return cloneRecord(record);
      }
      steering.status = "failed";
      steering.error = truncateText(reason, 300);
      record.updatedAt = Date.now();
      this.pushNotification(record, "steering_failed", `Steering failed: ${truncateText(reason, 160)}`);
      this.markScratchDirty(record);
      this.emitChange("updated", record);
      return cloneRecord(record);
    });
  }

  async requestResume(
    taskId: string,
    message: string,
    input: {
      sessionId?: string;
      idempotencyKey?: string;
    } = {},
  ): Promise<{
    item: SubTaskRecord;
    resume: SubTaskResumeRecord;
    commandClaim: SubTaskCommandClaim;
    claimOwner: boolean;
  } | undefined> {
    await this.load();
    return this.mutate(async () => {
      const record = this.records.get(taskId);
      if (!record) return undefined;
      const normalizedMessage = String(message ?? "").trim();
      const now = Date.now();
      const resume: SubTaskResumeRecord = {
        id: `task_resume_${crypto.randomUUID().slice(0, 8)}`,
        message: normalizedMessage,
        status: "accepted",
        requestedAt: now,
        requestedSessionId: input.sessionId?.trim() || record.sessionId,
      };
      const claimResult = claimSubTaskCommand(record, {
        kind: "resume",
        commandId: resume.id,
        idempotencyKey: input.idempotencyKey?.trim() || createSubTaskCommandIdempotencyKey({
          taskId,
          kind: "resume",
          message: normalizedMessage,
          sessionId: resume.requestedSessionId,
        }),
        requestedAt: now,
        expectedSessionId: resume.requestedSessionId,
        ownerInstanceId: SUBTASK_RUNTIME_INSTANCE_ID,
      });
      if (claimResult.status === "rejected") {
        throw new SubTaskCommandClaimError(claimResult.reason);
      }
      if (claimResult.status === "replayed") {
        const existing = record.resume.find((item) => item.id === claimResult.claim.commandId);
        if (!existing) {
          throw new SubTaskCommandClaimError("Subtask resume claim is missing its accepted record.");
        }
        return {
          item: cloneRecord(record),
          resume: { ...existing },
          commandClaim: { ...claimResult.claim },
          claimOwner: false,
        };
      }
      record.updatedAt = now;
      record.resume.push(resume);
      if (record.resume.length > MAX_RESUME_RECORDS) {
        record.resume = record.resume.slice(-MAX_RESUME_RECORDS);
      }
      this.pushNotification(record, "resume_requested", `Resume accepted: ${truncateText(normalizedMessage || "Continue from the last recorded state.", 160)}`);
      this.markScratchDirty(record);
      this.emitChange("updated", record);
      return {
        item: cloneRecord(record),
        resume: { ...resume },
        commandClaim: { ...claimResult.claim },
        claimOwner: true,
      };
    });
  }

  async requestTakeover(
    taskId: string,
    agentId: string,
    message: string,
    input: {
      sessionId?: string;
      mode?: SubTaskTakeoverMode;
      idempotencyKey?: string;
    } = {},
  ): Promise<{
    item: SubTaskRecord;
    takeover: SubTaskTakeoverRecord;
    commandClaim: SubTaskCommandClaim;
    claimOwner: boolean;
  } | undefined> {
    await this.load();
    return this.mutate(async () => {
      const record = this.records.get(taskId);
      if (!record) return undefined;
      const normalizedAgentId = String(agentId ?? "").trim();
      if (!normalizedAgentId) return undefined;
      const normalizedMessage = String(message ?? "").trim();
      const now = Date.now();
      const takeover: SubTaskTakeoverRecord = {
        id: `task_takeover_${crypto.randomUUID().slice(0, 8)}`,
        agentId: normalizedAgentId,
        mode: input.mode === "safe_point" ? "safe_point" : "resume_relaunch",
        message: normalizedMessage,
        status: "accepted",
        requestedAt: now,
        requestedSessionId: input.sessionId?.trim() || record.sessionId,
      };
      const claimResult = claimSubTaskCommand(record, {
        kind: "takeover",
        commandId: takeover.id,
        idempotencyKey: input.idempotencyKey?.trim() || createSubTaskCommandIdempotencyKey({
          taskId,
          kind: "takeover",
          message: normalizedMessage,
          sessionId: takeover.requestedSessionId,
          agentId: normalizedAgentId,
          mode: takeover.mode,
        }),
        requestedAt: now,
        expectedSessionId: takeover.requestedSessionId,
        takeoverMode: takeover.mode,
        ownerInstanceId: SUBTASK_RUNTIME_INSTANCE_ID,
      });
      if (claimResult.status === "rejected") {
        throw new SubTaskCommandClaimError(claimResult.reason);
      }
      if (claimResult.status === "replayed") {
        const existing = record.takeover.find((item) => item.id === claimResult.claim.commandId);
        if (!existing) {
          throw new SubTaskCommandClaimError("Subtask takeover claim is missing its accepted record.");
        }
        return {
          item: cloneRecord(record),
          takeover: { ...existing },
          commandClaim: { ...claimResult.claim },
          claimOwner: false,
        };
      }
      record.updatedAt = now;
      record.takeover.push(takeover);
      if (record.takeover.length > MAX_TAKEOVER_RECORDS) {
        record.takeover = record.takeover.slice(-MAX_TAKEOVER_RECORDS);
      }
      const modeLabel = takeover.mode === "safe_point" ? "Safe-point takeover" : "Takeover";
      this.pushNotification(
        record,
        "takeover_requested",
        `${modeLabel} accepted for agent ${normalizedAgentId}: ${truncateText(normalizedMessage || "Relaunch the same subtask under a new agent.", 160)}`,
      );
      this.markScratchDirty(record);
      this.emitChange("updated", record);
      return {
        item: cloneRecord(record),
        takeover: { ...takeover },
        commandClaim: { ...claimResult.claim },
        claimOwner: true,
      };
    });
  }

  async markTakeoverDelivered(
    taskId: string,
    takeoverId: string,
    input: {
      sessionId?: string;
      resumedFromSessionId?: string;
    } = {},
  ): Promise<SubTaskRecord | undefined> {
    await this.load();
    return this.mutate(async () => {
      const record = this.records.get(taskId);
      if (!record) return undefined;
      const takeover = record.takeover.find((item) => item.id === takeoverId);
      if (!takeover) return cloneRecord(record);
      if (record.activeCommandClaim && !releaseSubTaskCommandClaim(record, "takeover", takeoverId)) {
        return cloneRecord(record);
      }
      takeover.status = "delivered";
      takeover.deliveredAt = Date.now();
      takeover.deliveredSessionId = input.sessionId?.trim() || record.sessionId;
      takeover.resumedFromSessionId = input.resumedFromSessionId?.trim() || takeover.requestedSessionId;
      takeover.error = undefined;
      record.updatedAt = takeover.deliveredAt;
      this.pushNotification(
        record,
        "takeover_delivered",
        takeover.mode === "safe_point"
          ? `Safe-point takeover delivered to agent ${takeover.agentId}.`
          : `Takeover delivered to agent ${takeover.agentId}.`,
      );
      this.markScratchDirty(record);
      this.emitChange("updated", record);
      return cloneRecord(record);
    });
  }

  async markTakeoverFailed(taskId: string, takeoverId: string, reason: string): Promise<SubTaskRecord | undefined> {
    await this.load();
    return this.mutate(async () => {
      const record = this.records.get(taskId);
      if (!record) return undefined;
      const takeover = record.takeover.find((item) => item.id === takeoverId);
      if (!takeover) return cloneRecord(record);
      if (record.activeCommandClaim && !releaseSubTaskCommandClaim(record, "takeover", takeoverId)) {
        return cloneRecord(record);
      }
      takeover.status = "failed";
      takeover.error = truncateText(reason, 300);
      record.updatedAt = Date.now();
      this.pushNotification(
        record,
        "takeover_failed",
        `Takeover failed for agent ${takeover.agentId}: ${truncateText(reason, 160)}`,
      );
      this.markScratchDirty(record);
      this.emitChange("updated", record);
      return cloneRecord(record);
    });
  }

  async markResumeDelivered(
    taskId: string,
    resumeId: string,
    input: {
      sessionId?: string;
      resumedFromSessionId?: string;
    } = {},
  ): Promise<SubTaskRecord | undefined> {
    await this.load();
    return this.mutate(async () => {
      const record = this.records.get(taskId);
      if (!record) return undefined;
      const resume = record.resume.find((item) => item.id === resumeId);
      if (!resume) return cloneRecord(record);
      if (record.activeCommandClaim && !releaseSubTaskCommandClaim(record, "resume", resumeId)) {
        return cloneRecord(record);
      }
      resume.status = "delivered";
      resume.deliveredAt = Date.now();
      resume.deliveredSessionId = input.sessionId?.trim() || record.sessionId;
      resume.resumedFromSessionId = input.resumedFromSessionId?.trim() || resume.requestedSessionId;
      resume.error = undefined;
      record.updatedAt = resume.deliveredAt;
      this.pushNotification(record, "resume_delivered", "Resume delivered to the relaunched subtask session.");
      this.markScratchDirty(record);
      this.emitChange("updated", record);
      return cloneRecord(record);
    });
  }

  async markResumeFailed(taskId: string, resumeId: string, reason: string): Promise<SubTaskRecord | undefined> {
    await this.load();
    return this.mutate(async () => {
      const record = this.records.get(taskId);
      if (!record) return undefined;
      const resume = record.resume.find((item) => item.id === resumeId);
      if (!resume) return cloneRecord(record);
      if (record.activeCommandClaim && !releaseSubTaskCommandClaim(record, "resume", resumeId)) {
        return cloneRecord(record);
      }
      resume.status = "failed";
      resume.error = truncateText(reason, 300);
      record.updatedAt = Date.now();
      this.pushNotification(record, "resume_failed", `Resume failed: ${truncateText(reason, 160)}`);
      this.markScratchDirty(record);
      this.emitChange("updated", record);
      return cloneRecord(record);
    });
  }

  async getTask(taskId: string): Promise<SubTaskRecord | undefined> {
    await this.load();
    const record = this.records.get(taskId);
    return record ? cloneRecord(record) : undefined;
  }

  async getTaskBySession(sessionId: string): Promise<SubTaskRecord | undefined> {
    await this.load();
    const taskId = this.sessionToTask.get(sessionId);
    if (!taskId) return undefined;
    const record = this.records.get(taskId);
    return record ? cloneRecord(record) : undefined;
  }

  async listTasks(parentConversationId?: string, options: { includeArchived?: boolean } = {}): Promise<SubTaskRecord[]> {
    await this.load();
    return [...this.records.values()]
      .filter((record) => !parentConversationId || record.parentConversationId === parentConversationId)
      .filter((record) => options.includeArchived ? true : !record.archivedAt)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((record) => cloneRecord(record));
  }

  async listSessionInfos(parentConversationId?: string, options: { includeArchived?: boolean } = {}): Promise<SessionInfo[]> {
    const records = await this.listTasks(parentConversationId, options);
    return records.map((record) => ({
      id: record.sessionId ?? record.id,
      taskId: record.id,
      parentId: record.parentConversationId,
      agentId: record.agentId,
      status: record.status,
      createdAt: record.createdAt,
      finishedAt: record.finishedAt,
      summary: record.summary,
      progressText: record.progress.message,
      outputPath: record.outputPath,
      scratchPath: record.scratchPath,
      reviewPath: record.reviewPath,
      lessonPath: record.lessonPath,
      notificationCount: record.notifications.length,
    }));
  }

  private normalizeRecord(source: unknown): SubTaskRecord | null {
    if (!source || typeof source !== "object") return null;
    const value = source as Record<string, unknown>;
    const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : "";
    if (!id) return null;
    const status = this.normalizeStatus(value.status);
    const createdAt = Number(value.createdAt);
    const updatedAt = Number(value.updatedAt);
    const progressSource = value.progress && typeof value.progress === "object"
      ? value.progress as Record<string, unknown>
      : {};
    const launchSpecSource = value.launchSpec && typeof value.launchSpec === "object" && !Array.isArray(value.launchSpec)
      ? value.launchSpec as Record<string, unknown>
      : undefined;
    const delegationSource = launchSpecSource?.delegation && typeof launchSpecSource.delegation === "object" && !Array.isArray(launchSpecSource.delegation)
      ? launchSpecSource.delegation as Record<string, unknown>
      : undefined;
    const rawContextKeys = launchSpecSource
      ? launchSpecSource.contextKeys
      : undefined;
    const fallbackLaunchSpec = normalizeAgentLaunchSpec({
      instruction: typeof value.instruction === "string" ? value.instruction : "",
      parentConversationId: typeof value.parentConversationId === "string" ? value.parentConversationId : "system",
      agentId: typeof value.agentId === "string" && value.agentId.trim() ? value.agentId : "default",
      background: value.background !== false,
    });
    const notifications = Array.isArray(value.notifications)
      ? value.notifications
        .filter((item) => item && typeof item === "object")
        .map((item) => {
          const current = item as Record<string, unknown>;
          return {
            id: typeof current.id === "string" ? current.id : `task_notification_${crypto.randomUUID().slice(0, 8)}`,
            kind: this.normalizeNotificationKind(current.kind),
            message: typeof current.message === "string" ? current.message : "",
            createdAt: Number(current.createdAt) || Date.now(),
          };
        })
      : [];
    const steering = Array.isArray(value.steering)
      ? value.steering
        .filter((item) => item && typeof item === "object")
        .map((item) => {
          const current = item as Record<string, unknown>;
          return {
            id: typeof current.id === "string" ? current.id : `task_steering_${crypto.randomUUID().slice(0, 8)}`,
            message: typeof current.message === "string" ? current.message : "",
            status: current.status === "delivered" || current.status === "failed" ? current.status : "accepted",
            requestedAt: Number(current.requestedAt) || Date.now(),
            requestedSessionId: typeof current.requestedSessionId === "string" && current.requestedSessionId.trim()
              ? current.requestedSessionId.trim()
              : undefined,
            deliveredAt: Number.isFinite(Number(current.deliveredAt)) ? Number(current.deliveredAt) : undefined,
            deliveredSessionId: typeof current.deliveredSessionId === "string" && current.deliveredSessionId.trim()
              ? current.deliveredSessionId.trim()
              : undefined,
            error: typeof current.error === "string" && current.error.trim() ? current.error : undefined,
          } satisfies SubTaskSteeringRecord;
        })
        .slice(-MAX_STEERING_RECORDS)
      : [];
    const resume = Array.isArray(value.resume)
      ? value.resume
        .filter((item) => item && typeof item === "object")
        .map((item) => {
          const current = item as Record<string, unknown>;
          return {
            id: typeof current.id === "string" ? current.id : `task_resume_${crypto.randomUUID().slice(0, 8)}`,
            message: typeof current.message === "string" ? current.message : "",
            status: current.status === "delivered" || current.status === "failed" ? current.status : "accepted",
            requestedAt: Number(current.requestedAt) || Date.now(),
            requestedSessionId: typeof current.requestedSessionId === "string" && current.requestedSessionId.trim()
              ? current.requestedSessionId.trim()
              : undefined,
            deliveredAt: Number.isFinite(Number(current.deliveredAt)) ? Number(current.deliveredAt) : undefined,
            deliveredSessionId: typeof current.deliveredSessionId === "string" && current.deliveredSessionId.trim()
              ? current.deliveredSessionId.trim()
              : undefined,
            resumedFromSessionId: typeof current.resumedFromSessionId === "string" && current.resumedFromSessionId.trim()
              ? current.resumedFromSessionId.trim()
              : undefined,
            error: typeof current.error === "string" && current.error.trim() ? current.error : undefined,
          } satisfies SubTaskResumeRecord;
        })
        .slice(-MAX_RESUME_RECORDS)
      : [];
    const takeover = Array.isArray(value.takeover)
      ? value.takeover
        .filter((item) => item && typeof item === "object")
        .map((item) => {
          const current = item as Record<string, unknown>;
          return {
            id: typeof current.id === "string" ? current.id : `task_takeover_${crypto.randomUUID().slice(0, 8)}`,
            agentId: typeof current.agentId === "string" && current.agentId.trim() ? current.agentId.trim() : "default",
            mode: current.mode === "safe_point" ? "safe_point" : "resume_relaunch",
            message: typeof current.message === "string" ? current.message : "",
            status: current.status === "delivered" || current.status === "failed" ? current.status : "accepted",
            requestedAt: Number(current.requestedAt) || Date.now(),
            requestedSessionId: typeof current.requestedSessionId === "string" && current.requestedSessionId.trim()
              ? current.requestedSessionId.trim()
              : undefined,
            deliveredAt: Number.isFinite(Number(current.deliveredAt)) ? Number(current.deliveredAt) : undefined,
            deliveredSessionId: typeof current.deliveredSessionId === "string" && current.deliveredSessionId.trim()
              ? current.deliveredSessionId.trim()
              : undefined,
            resumedFromSessionId: typeof current.resumedFromSessionId === "string" && current.resumedFromSessionId.trim()
              ? current.resumedFromSessionId.trim()
              : undefined,
            error: typeof current.error === "string" && current.error.trim() ? current.error : undefined,
          } satisfies SubTaskTakeoverRecord;
        })
        .slice(-MAX_TAKEOVER_RECORDS)
      : [];
    const activeCommandClaim = normalizeSubTaskCommandClaim(value.activeCommandClaim);
    const commandGeneration = Math.max(
      0,
      Math.floor(Number(value.commandGeneration) || 0),
      activeCommandClaim?.generation ?? 0,
    );
    const kind = value.kind === "bridge_session" ? "bridge_session" : "sub_agent";
    return {
      id,
      kind,
      parentConversationId: typeof value.parentConversationId === "string" ? value.parentConversationId : "system",
      sessionId: typeof value.sessionId === "string" && value.sessionId.trim() ? value.sessionId : undefined,
      agentId: typeof value.agentId === "string" && value.agentId.trim() ? value.agentId : "default",
      launchSpec: {
        ...createLaunchSpecSummary(fallbackLaunchSpec),
        ...(launchSpecSource
          ? {
            agentId: typeof launchSpecSource.agentId === "string" && String(launchSpecSource.agentId).trim()
              ? String(launchSpecSource.agentId).trim()
              : fallbackLaunchSpec.agentId,
            profileId: typeof launchSpecSource.profileId === "string" && String(launchSpecSource.profileId).trim()
              ? String(launchSpecSource.profileId).trim()
              : fallbackLaunchSpec.profileId,
            background: launchSpecSource.background !== false,
            timeoutMs: Number.isFinite(Number(launchSpecSource.timeoutMs))
              ? Number(launchSpecSource.timeoutMs)
              : fallbackLaunchSpec.timeoutMs,
            channel: typeof launchSpecSource.channel === "string" && String(launchSpecSource.channel).trim()
              ? String(launchSpecSource.channel).trim()
              : fallbackLaunchSpec.channel,
            cwd: typeof launchSpecSource.cwd === "string" && String(launchSpecSource.cwd).trim()
              ? String(launchSpecSource.cwd).trim()
              : fallbackLaunchSpec.cwd,
            resolvedCwd: typeof launchSpecSource.resolvedCwd === "string" && String(launchSpecSource.resolvedCwd).trim()
              ? String(launchSpecSource.resolvedCwd).trim()
              : fallbackLaunchSpec.cwd,
            toolSet: Array.isArray(launchSpecSource.toolSet)
              ? launchSpecSource.toolSet
                .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
                .map((item) => item.trim())
              : fallbackLaunchSpec.toolSet,
            role: launchSpecSource.role === "coder" || launchSpecSource.role === "researcher" || launchSpecSource.role === "verifier" || launchSpecSource.role === "default"
              ? launchSpecSource.role
              : fallbackLaunchSpec.role,
            allowedToolFamilies: Array.isArray(launchSpecSource.allowedToolFamilies)
              ? launchSpecSource.allowedToolFamilies
                .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
                .map((item) => item.trim())
              : fallbackLaunchSpec.allowedToolFamilies,
            maxToolRiskLevel: launchSpecSource.maxToolRiskLevel === "low"
              || launchSpecSource.maxToolRiskLevel === "medium"
              || launchSpecSource.maxToolRiskLevel === "high"
              || launchSpecSource.maxToolRiskLevel === "critical"
              ? launchSpecSource.maxToolRiskLevel
              : fallbackLaunchSpec.maxToolRiskLevel,
            policySummary: typeof launchSpecSource.policySummary === "string" && String(launchSpecSource.policySummary).trim()
              ? String(launchSpecSource.policySummary).trim()
              : fallbackLaunchSpec.policySummary,
            permissionMode: typeof launchSpecSource.permissionMode === "string" && String(launchSpecSource.permissionMode).trim()
              ? String(launchSpecSource.permissionMode).trim()
              : fallbackLaunchSpec.permissionMode,
            isolationMode: typeof launchSpecSource.isolationMode === "string" && String(launchSpecSource.isolationMode).trim()
              ? String(launchSpecSource.isolationMode).trim()
              : fallbackLaunchSpec.isolationMode,
            parentTaskId: typeof launchSpecSource.parentTaskId === "string" && String(launchSpecSource.parentTaskId).trim()
              ? String(launchSpecSource.parentTaskId).trim()
              : fallbackLaunchSpec.parentTaskId,
            bridgeSubtask: normalizeBridgeSubtaskSemantics(launchSpecSource.bridgeSubtask)
              ?? createLaunchSpecSummary(fallbackLaunchSpec).bridgeSubtask,
            bridgeSession: normalizeBridgeSessionLaunch(launchSpecSource.bridgeSession),
            contextKeys: Array.isArray(rawContextKeys)
              ? rawContextKeys
                  .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
                  .map((item) => item.trim())
              : createLaunchSpecSummary(fallbackLaunchSpec).contextKeys,
            delegation: normalizeDelegationSummary(delegationSource),
            worktreePath: typeof launchSpecSource.worktreePath === "string" && String(launchSpecSource.worktreePath).trim()
              ? String(launchSpecSource.worktreePath).trim()
              : undefined,
            worktreeRepoRoot: typeof launchSpecSource.worktreeRepoRoot === "string" && String(launchSpecSource.worktreeRepoRoot).trim()
              ? String(launchSpecSource.worktreeRepoRoot).trim()
              : undefined,
            worktreeBranch: typeof launchSpecSource.worktreeBranch === "string" && String(launchSpecSource.worktreeBranch).trim()
              ? String(launchSpecSource.worktreeBranch).trim()
              : undefined,
            worktreeStatus: isWorktreeRuntimeStatus(launchSpecSource.worktreeStatus)
              ? launchSpecSource.worktreeStatus
              : createLaunchSpecSummary(fallbackLaunchSpec).worktreeStatus,
            worktreeError: typeof launchSpecSource.worktreeError === "string" && String(launchSpecSource.worktreeError).trim()
              ? String(launchSpecSource.worktreeError).trim()
              : undefined,
          }
          : {}),
      },
      background: value.background !== false,
      status,
      instruction: typeof value.instruction === "string" ? value.instruction : "",
      summary: typeof value.summary === "string" ? value.summary : "",
      progress: {
        phase: this.normalizeStatus(progressSource.phase ?? status),
        message: typeof progressSource.message === "string" ? progressSource.message : undefined,
        lastActivityAt: Number(progressSource.lastActivityAt) || updatedAt || createdAt || Date.now(),
      },
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Number.isFinite(createdAt) ? createdAt : Date.now(),
      finishedAt: Number.isFinite(Number(value.finishedAt)) ? Number(value.finishedAt) : undefined,
      stopRequestedAt: Number.isFinite(Number(value.stopRequestedAt)) ? Number(value.stopRequestedAt) : undefined,
      stopReason: typeof value.stopReason === "string" ? value.stopReason : undefined,
      archivedAt: Number.isFinite(Number(value.archivedAt)) ? Number(value.archivedAt) : undefined,
      archiveReason: typeof value.archiveReason === "string" ? value.archiveReason : undefined,
      outputPath: typeof value.outputPath === "string" && value.outputPath.trim() ? value.outputPath : undefined,
      scratchPath: typeof value.scratchPath === "string" && value.scratchPath.trim() ? value.scratchPath : undefined,
      reviewPath: typeof value.reviewPath === "string" && value.reviewPath.trim() ? value.reviewPath : undefined,
      lessonPath: typeof value.lessonPath === "string" && value.lessonPath.trim() ? value.lessonPath : undefined,
      outputPreview: typeof value.outputPreview === "string" ? value.outputPreview : undefined,
      error: typeof value.error === "string" ? value.error : undefined,
      bridgeSessionRuntime: normalizeBridgeSessionRuntimeState(value.bridgeSessionRuntime),
      commandGeneration,
      activeCommandClaim,
      steering,
      takeover,
      resume,
      notifications: notifications.slice(-MAX_NOTIFICATIONS),
    };
  }

  private normalizeStatus(value: unknown): SubTaskStatus {
    switch (value) {
      case "pending":
      case "running":
      case "done":
      case "error":
      case "timeout":
      case "stopped":
        return value;
      default:
        return "pending";
    }
  }

  private normalizeNotificationKind(value: unknown): SubTaskNotificationKind {
    switch (value) {
      case "queued":
      case "started":
      case "progress":
      case "steering_requested":
      case "steering_delivered":
      case "steering_failed":
      case "takeover_requested":
      case "takeover_delivered":
      case "takeover_failed":
      case "resume_requested":
      case "resume_delivered":
      case "resume_failed":
      case "stop_requested":
      case "stopped":
      case "archived":
      case "completed":
      case "failed":
      case "timeout":
        return value;
      default:
        return "progress";
    }
  }

  private pushNotification(record: SubTaskRecord, kind: SubTaskNotificationKind, message: string): void {
    record.notifications.push({
      id: `task_notification_${crypto.randomUUID().slice(0, 8)}`,
      kind,
      message,
      createdAt: Date.now(),
    });
    if (record.notifications.length > MAX_NOTIFICATIONS) {
      record.notifications = record.notifications.slice(-MAX_NOTIFICATIONS);
    }
  }

  private assertWritable(): void {
    if (this.quarantineStatus) {
      throw new SubTaskRuntimeStoreQuarantinedError(this.quarantineStatus);
    }
  }

  private async mutate<T>(
    mutator: () => Promise<T>,
    options: { persist?: "immediate" | "deferred" } = {},
  ): Promise<T> {
    this.lifecycle.assertMutationAllowed();
    this.assertWritable();
    let result!: T;
    const run = this.writeChain.then(async () => {
      result = await mutator();
      if (options.persist === "deferred") {
        this.scheduleDeferredPersist();
        return;
      }
      this.cancelDeferredPersist();
      await this.persist();
    });
    this.writeChain = run.catch(() => {});
    await run;
    return result;
  }

  private scheduleDeferredPersist(): void {
    if (!this.lifecycle.isOpen()) {
      return;
    }
    if (this.deferredPersistTimer) {
      return;
    }
    this.deferredPersistTimer = setTimeout(() => {
      this.deferredPersistTimer = null;
      const run = this.writeChain.then(() => this.persist());
      this.writeChain = run.catch(() => {});
      void run.catch((error) => {
        this.logger?.warn?.("Failed to persist deferred subtask runtime state.", error);
      });
    }, THOUGHT_DELTA_PERSIST_DELAY_MS);
  }

  private cancelDeferredPersist(): void {
    if (!this.deferredPersistTimer) {
      return;
    }
    clearTimeout(this.deferredPersistTimer);
    this.deferredPersistTimer = null;
  }

  private recoverInterruptedCommandClaim(record: SubTaskRecord): boolean {
    const claim = record.activeCommandClaim;
    if (!claim || claim.ownerInstanceId === SUBTASK_RUNTIME_INSTANCE_ID) {
      return false;
    }
    const command = claim.kind === "steering"
      ? record.steering.find((item) => item.id === claim.commandId)
      : claim.kind === "resume"
        ? record.resume.find((item) => item.id === claim.commandId)
        : record.takeover.find((item) => item.id === claim.commandId);
    if (command && command.status === "accepted") {
      command.status = "failed";
      command.error = "Command claim was interrupted by a previous runtime instance. Retry the command.";
    }
    record.activeCommandClaim = undefined;
    record.updatedAt = Math.max(record.updatedAt, Date.now());
    const notificationKind = claim.kind === "steering"
      ? "steering_failed"
      : claim.kind === "resume"
        ? "resume_failed"
        : "takeover_failed";
    this.pushNotification(record, notificationKind, "A pending command claim was interrupted by a previous runtime instance and can be retried.");
    return true;
  }

  private async persist(): Promise<void> {
    this.assertWritable();
    const scratchArtifacts = await this.prepareDirtyScratchArtifacts();
    const postRunArtifacts = await this.prepareDirtyPostRunArtifacts();
    const state: SubTaskRuntimeState = {
      version: STATE_VERSION,
      items: [...this.records.values()]
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((record) => ({
          ...record,
            launchSpec: {
              ...record.launchSpec,
              toolSet: record.launchSpec.toolSet ? [...record.launchSpec.toolSet] : undefined,
              allowedToolFamilies: record.launchSpec.allowedToolFamilies ? [...record.launchSpec.allowedToolFamilies] : undefined,
              contextKeys: record.launchSpec.contextKeys ? [...record.launchSpec.contextKeys] : undefined,
              delegation: cloneDelegationSummary(record.launchSpec.delegation),
            },
          progress: { ...record.progress },
          steering: record.steering.map((item) => ({ ...item })),
          resume: record.resume.map((item) => ({ ...item })),
          takeover: record.takeover.map((item) => ({ ...item })),
          notifications: record.notifications.map((item) => ({ ...item })),
        })),
    };
    await atomicWriteText(this.statePath, JSON.stringify(state, null, 2));
    for (const artifact of scratchArtifacts) {
      if (artifact.oldTargetPath && artifact.oldTargetPath !== artifact.targetPath) {
        await fs.unlink(artifact.oldTargetPath).catch(() => {});
      }
      await atomicWriteText(artifact.targetPath, artifact.content);
    }
    for (const artifact of postRunArtifacts) {
      if (artifact.oldTargetPath && artifact.oldTargetPath !== artifact.targetPath) {
        await fs.unlink(artifact.oldTargetPath).catch(() => {});
      }
      await atomicWriteText(artifact.targetPath, artifact.content);
    }
  }

  private markScratchDirty(record: SubTaskRecord): void {
    this.dirtyScratchTaskIds.add(record.id);
  }

  private markPostRunArtifactsDirty(record: SubTaskRecord): void {
    this.dirtyPostRunArtifactTaskIds.add(record.id);
  }

  private async ensurePostRunArtifactPathsForRecord(record: SubTaskRecord): Promise<void> {
    record.reviewPath = await this.resolveReviewPathForRecord(record);
    record.lessonPath = await this.resolveLessonPathForRecord(record);
  }

  private async syncGoalRuntimeArtifactsForRecord(record: SubTaskRecord): Promise<void> {
    await this.syncGoalBindingForRecord(record);
  }

  private async syncGoalBindingForRecord(record: SubTaskRecord): Promise<void> {
    if (!this.bindingStore) {
      return;
    }
    const binding = resolveGoalBindingFromTaskRecord(record);
    if (!binding) {
      return;
    }
    await this.bindingStore.upsertSubTaskBinding(binding);
  }

  private async prepareDirtyScratchArtifacts(): Promise<RuntimeArtifact[]> {
    if (this.dirtyScratchTaskIds.size === 0) {
      return [];
    }
    const taskIds = [...this.dirtyScratchTaskIds];
    this.dirtyScratchTaskIds.clear();
    const artifacts: RuntimeArtifact[] = [];
    for (const taskId of taskIds) {
      const record = this.records.get(taskId);
      if (!record) {
        continue;
      }
      const scratchPath = await this.resolveScratchPathForRecord(record);
      artifacts.push({
        taskId,
        targetPath: scratchPath,
        oldTargetPath: record.scratchPath && record.scratchPath !== scratchPath ? record.scratchPath : undefined,
        content: this.buildScratchMarkdown(record, scratchPath),
      });
      record.scratchPath = scratchPath;
    }
    return artifacts;
  }

  private async prepareDirtyPostRunArtifacts(): Promise<RuntimeArtifact[]> {
    if (this.dirtyPostRunArtifactTaskIds.size === 0) {
      return [];
    }
    const taskIds = [...this.dirtyPostRunArtifactTaskIds];
    this.dirtyPostRunArtifactTaskIds.clear();
    const artifacts: RuntimeArtifact[] = [];
    for (const taskId of taskIds) {
      const record = this.records.get(taskId);
      if (!record) {
        continue;
      }
      const reviewPath = await this.resolveReviewPathForRecord(record);
      const lessonPath = await this.resolveLessonPathForRecord(record);
      artifacts.push({
        taskId,
        targetPath: reviewPath,
        oldTargetPath: record.reviewPath && record.reviewPath !== reviewPath ? record.reviewPath : undefined,
        content: this.buildReviewMarkdown(record, reviewPath),
      });
      artifacts.push({
        taskId,
        targetPath: lessonPath,
        oldTargetPath: record.lessonPath && record.lessonPath !== lessonPath ? record.lessonPath : undefined,
        content: this.buildLessonMarkdown(record, lessonPath),
      });
      record.reviewPath = reviewPath;
      record.lessonPath = lessonPath;
    }
    return artifacts;
  }

  private async resolveScratchPathForRecord(record: SubTaskRecord): Promise<string> {
    const binding = resolveGoalBindingFromTaskRecord(record);
    const agentSegment = sanitizeArtifactSegment(record.agentId, "agent");
    if (binding?.goalId && binding.runId) {
      const goal = await getGoalRegistryEntry(this.stateDir, binding.goalId);
      if (goal?.runtimeRoot?.trim()) {
        return path.join(goal.runtimeRoot, "runs", binding.runId, "scratch", `scratch-${agentSegment}.md`);
      }
    }
    return path.join(this.stateDir, "tasks", record.id, "scratch", `scratch-${agentSegment}.md`);
  }

  private async resolveReviewPathForRecord(record: SubTaskRecord): Promise<string> {
    const binding = resolveGoalBindingFromTaskRecord(record);
    const taskSegment = sanitizeArtifactSegment(record.id, "task");
    if (binding?.goalId && binding.runId) {
      const goal = await getGoalRegistryEntry(this.stateDir, binding.goalId);
      if (goal?.runtimeRoot?.trim()) {
        return path.join(goal.runtimeRoot, "runs", binding.runId, "review-results", `review-${taskSegment}.md`);
      }
    }
    return path.join(this.stateDir, "tasks", record.id, "review-results", `review-${taskSegment}.md`);
  }

  private async resolveLessonPathForRecord(record: SubTaskRecord): Promise<string> {
    const binding = resolveGoalBindingFromTaskRecord(record);
    const taskSegment = sanitizeArtifactSegment(record.id, "task");
    if (binding?.goalId) {
      const goal = await getGoalRegistryEntry(this.stateDir, binding.goalId);
      if (goal?.docRoot?.trim()) {
        return path.join(goal.docRoot, "lessons-learned", `lesson-${taskSegment}.md`);
      }
    }
    return path.join(this.stateDir, "tasks", record.id, "lessons-learned", `lesson-${taskSegment}.md`);
  }

  private buildScratchMarkdown(record: SubTaskRecord, scratchPath: string): string {
    const binding = resolveGoalBindingFromTaskRecord(record);
    const updatedAtIso = new Date(record.updatedAt || record.createdAt || Date.now()).toISOString();
    const progressMessage = truncateText(record.progress.message || "", 240);
    const currentHypotheses = [
      ...record.notifications
        .filter((item) => item.kind === "progress" && item.message.trim())
        .slice(-SCRATCH_PROGRESS_WINDOW)
        .map((item) => truncateText(item.message, 240)),
    ];
    if (
      progressMessage
      && progressMessage !== "Task is running."
      && progressMessage !== "Task completed."
      && progressMessage !== "Task created and waiting to start."
      && !currentHypotheses.includes(progressMessage)
    ) {
      currentHypotheses.push(progressMessage);
    }
    if (
      record.summary
      && record.summary !== progressMessage
      && !isTerminalStatus(record.status)
      && !currentHypotheses.includes(record.summary)
    ) {
      currentHypotheses.push(truncateText(record.summary, 240));
    }

    const verifiedFindings: string[] = [];
    if (record.status === "done" && record.outputPreview) {
      verifiedFindings.push(`执行结果：${record.outputPreview}`);
    }
    if (record.outputPath) {
      verifiedFindings.push(`结果文件：${record.outputPath}`);
    }
    if (record.launchSpec.worktreePath) {
      verifiedFindings.push(`运行工作树：${record.launchSpec.worktreePath}`);
    }

    const ruledOutPaths = [
      ...record.steering
        .filter((item) => item.status === "failed" && item.error)
        .map((item) => `Steering failed: ${truncateText(item.error ?? item.message, 200)}`),
      ...record.resume
        .filter((item) => item.status === "failed" && item.error)
        .map((item) => `Resume failed: ${truncateText(item.error ?? item.message, 200)}`),
      ...record.takeover
        .filter((item) => item.status === "failed" && item.error)
        .map((item) => `Takeover failed (${item.agentId}): ${truncateText(item.error ?? item.message, 200)}`),
    ];

    const pendingChecks: string[] = [];
    if (!isTerminalStatus(record.status)) {
      pendingChecks.push(`继续推进子任务并输出最终结果（当前状态：${record.status}）。`);
    }
    pendingChecks.push(
      ...record.steering
        .filter((item) => item.status === "accepted")
        .map((item) => `Steering 待交付：${truncateText(item.message, 200)}`),
    );
    pendingChecks.push(
      ...record.resume
        .filter((item) => item.status === "accepted")
        .map((item) => `Resume 待执行：${truncateText(item.message || "Continue from the last recorded state.", 200)}`),
    );
    pendingChecks.push(
      ...record.takeover
        .filter((item) => item.status === "accepted")
        .map((item) => `Takeover 待执行：agent=${item.agentId} ${truncateText(item.message || "Relaunch the same subtask under a new agent.", 200)}`),
    );

    const errorSummary: string[] = [];
    if (record.error) {
      errorSummary.push(record.error);
    }
    if (record.stopReason) {
      errorSummary.push(`Stop reason: ${record.stopReason}`);
    }

    const runtimeNotes = [
      `scratchPath=${scratchPath}`,
      `status=${record.status}`,
      `conversation=${record.parentConversationId}`,
      record.sessionId ? `session=${record.sessionId}` : undefined,
      binding?.goalId ? `goalId=${binding.goalId}` : undefined,
      binding?.nodeId ? `nodeId=${binding.nodeId}` : undefined,
      binding?.runId ? `runId=${binding.runId}` : undefined,
      record.launchSpec.profileId ? `profile=${record.launchSpec.profileId}` : undefined,
      record.launchSpec.permissionMode ? `permissionMode=${record.launchSpec.permissionMode}` : undefined,
      record.launchSpec.worktreeBranch ? `worktreeBranch=${record.launchSpec.worktreeBranch}` : undefined,
      record.launchSpec.worktreeStatus ? `worktreeStatus=${record.launchSpec.worktreeStatus}` : undefined,
      ...record.notifications
        .slice(-SCRATCH_NOTIFICATION_WINDOW)
        .map((item) => `[${new Date(item.createdAt).toISOString()}] ${item.kind}: ${item.message}`),
    ].filter((item): item is string => Boolean(item));

    return [
      `# Scratch Memory - ${record.agentId} @ ${record.id}`,
      "",
      "> 临时任务记忆；只落文件系统 markdown，不进入长期记忆数据库。",
      "",
      "## 任务上下文",
      `- Agent: ${record.agentId}`,
      `- Task ID: ${record.id}`,
      `- Status: ${record.status}`,
      `- Goal ID: ${binding?.goalId ?? "-"}`,
      `- Node ID: ${binding?.nodeId ?? "-"}`,
      `- Run ID: ${binding?.runId ?? "-"}`,
      `- Session ID: ${record.sessionId ?? "-"}`,
      `- Source Conversation: ${record.parentConversationId}`,
      "",
      "## 工作单",
      record.instruction.trim() || "_暂无工作单内容_",
      "",
      "## 当前假设",
      formatScratchList(currentHypotheses),
      "## 已验证结论",
      formatScratchList(verifiedFindings),
      "## 已排除路径",
      formatScratchList(ruledOutPaths),
      "## 待验证项",
      formatScratchCheckboxList(pendingChecks),
      "## 错误摘要",
      formatScratchList(errorSummary),
      "## 关键日志片段",
      formatScratchLogBlock(runtimeNotes),
      "## 更新时间",
      updatedAtIso,
      "",
    ].join("\n");
  }

  private buildReviewMarkdown(record: SubTaskRecord, reviewPath: string): string {
    const binding = resolveGoalBindingFromTaskRecord(record);
    const updatedAtIso = new Date(record.updatedAt || record.createdAt || Date.now()).toISOString();
    const finishedAtIso = record.finishedAt ? new Date(record.finishedAt).toISOString() : "-";
    const executionSummary = [
      `状态：${record.status}`,
      `摘要：${record.summary || "-"}`,
      record.outputPreview ? `输出预览：${record.outputPreview}` : undefined,
      record.error ? `错误：${record.error}` : undefined,
      record.archiveReason ? `归档原因：${record.archiveReason}` : undefined,
    ].filter((item): item is string => Boolean(item));
    const reviewFindings = [
      record.outputPath ? `已产出结果文件：${record.outputPath}` : undefined,
      record.scratchPath ? `已记录 scratch：${record.scratchPath}` : undefined,
      record.launchSpec.worktreePath ? `运行工作树：${record.launchSpec.worktreePath}` : undefined,
      ...record.steering
        .filter((item) => item.status === "failed")
        .map((item) => `Steering 失败：${truncateText(item.error ?? item.message, 220)}`),
      ...record.resume
        .filter((item) => item.status === "failed")
        .map((item) => `Resume 失败：${truncateText(item.error ?? item.message, 220)}`),
      ...record.takeover
        .filter((item) => item.status === "failed")
        .map((item) => `Takeover 失败（${item.agentId}）：${truncateText(item.error ?? item.message, 220)}`),
    ].filter((item): item is string => Boolean(item));
    const verificationGaps = [
      !record.outputPath ? "尚未生成独立输出文件，需要人工确认是否有可交付产物。" : undefined,
      ...record.steering
        .filter((item) => item.status === "accepted")
        .map((item) => `待交付 steering：${truncateText(item.message, 220)}`),
      ...record.resume
        .filter((item) => item.status === "accepted")
        .map((item) => `待执行 resume：${truncateText(item.message || "Continue from the last recorded state.", 220)}`),
      ...record.takeover
        .filter((item) => item.status === "accepted")
        .map((item) => `待执行 takeover：agent=${item.agentId} ${truncateText(item.message || "Relaunch the same subtask under a new agent.", 220)}`),
      ...((record.launchSpec.delegation?.acceptance?.verificationHints ?? []).map((item) => `建议验证：${item}`)),
    ].filter((item): item is string => Boolean(item));
    const nextActions = [
      record.status === "done"
        ? "Commander 可基于本 review 决定是否验收通过、继续 fan-in，或提炼经验。"
        : "Commander 应基于失败/停止原因决定是否返工、换人接管或调整工作单。",
      record.status !== "done" && record.scratchPath
        ? `返工前优先阅读 scratch：${record.scratchPath}`
        : undefined,
    ].filter((item): item is string => Boolean(item));

    return [
      `# Commander Review - ${record.agentId} @ ${record.id}`,
      "",
      "> 运行期审查记录；只落文件系统 markdown，不进入长期记忆数据库。",
      "",
      "## 任务上下文",
      `- Review Path: ${reviewPath}`,
      `- Goal ID: ${binding?.goalId ?? "-"}`,
      `- Node ID: ${binding?.nodeId ?? "-"}`,
      `- Run ID: ${binding?.runId ?? "-"}`,
      `- Agent: ${record.agentId}`,
      `- Task ID: ${record.id}`,
      `- Source Conversation: ${record.parentConversationId}`,
      `- Session ID: ${record.sessionId ?? "-"}`,
      `- Finished At: ${finishedAtIso}`,
      "",
      "## 工作单",
      record.instruction.trim() || "_暂无工作单内容_",
      "",
      "## 执行摘要",
      formatScratchList(executionSummary),
      "## 审查发现",
      formatScratchList(reviewFindings),
      "## 验证缺口",
      formatScratchCheckboxList(verificationGaps, "- [ ] 暂无额外验证缺口"),
      "## 下一步建议",
      formatScratchList(nextActions),
      "## 更新时间",
      `${updatedAtIso}\n`,
    ].join("\n");
  }

  private buildLessonMarkdown(record: SubTaskRecord, lessonPath: string): string {
    const binding = resolveGoalBindingFromTaskRecord(record);
    const updatedAtIso = new Date(record.updatedAt || record.createdAt || Date.now()).toISOString();
    const reusableSignals = [
      record.status === "done" && record.outputPreview
        ? `成功交付模式：${record.outputPreview}`
        : undefined,
      record.launchSpec.worktreePath
        ? `隔离执行环境可用：${record.launchSpec.worktreePath}`
        : undefined,
      record.reviewPath ? `对应 review：${record.reviewPath}` : undefined,
    ].filter((item): item is string => Boolean(item));
    const pitfalls = [
      record.error ? `失败/异常信号：${record.error}` : undefined,
      ...record.steering
        .filter((item) => item.status === "failed")
        .map((item) => `Steering 失败后需补充更明确指令：${truncateText(item.error ?? item.message, 220)}`),
      ...record.resume
        .filter((item) => item.status === "failed")
        .map((item) => `Resume 失败时需检查运行态绑定：${truncateText(item.error ?? item.message, 220)}`),
      ...record.takeover
        .filter((item) => item.status === "failed")
        .map((item) => `Takeover 失败时需检查接管 agent 与上下文：${truncateText(item.error ?? item.message, 220)}`),
    ].filter((item): item is string => Boolean(item));
    const followUps = [
      record.scratchPath ? `需要时先复查 scratch：${record.scratchPath}` : undefined,
      record.outputPath ? `产物归档入口：${record.outputPath}` : undefined,
      record.status !== "done" ? "本次未达到稳定交付，暂不进入长期记忆晋升链路。" : "若 Commander 认可，可从本记录中提炼可晋升经验摘要。",
    ].filter((item): item is string => Boolean(item));

    return [
      `# Lessons Learned - ${record.agentId} @ ${record.id}`,
      "",
      "> 任务期经验摘录；仅落文件系统 markdown，由 Commander 决定是否进一步晋升。",
      "",
      "## 任务上下文",
      `- Lesson Path: ${lessonPath}`,
      `- Goal ID: ${binding?.goalId ?? "-"}`,
      `- Node ID: ${binding?.nodeId ?? "-"}`,
      `- Run ID: ${binding?.runId ?? "-"}`,
      `- Agent: ${record.agentId}`,
      `- Task ID: ${record.id}`,
      `- Final Status: ${record.status}`,
      "",
      "## 可复用信号",
      formatScratchList(reusableSignals),
      "## 需要规避的问题",
      formatScratchList(pitfalls),
      "## 后续动作",
      formatScratchCheckboxList(followUps, "- [ ] 暂无额外后续动作"),
      "## 更新时间",
      `${updatedAtIso}\n`,
    ].join("\n");
  }

  private emitChange(kind: SubTaskChangeEvent["kind"], record: SubTaskRecord): void {
    const item = cloneRecord(record);
    for (const listener of this.listeners) {
      try {
        listener({ kind, item });
      } catch (error) {
        this.logger?.warn?.("Failed to emit subtask runtime listener event.", error);
      }
    }
  }
}

function isWorktreeRuntimeStatus(value: unknown): value is WorktreeRuntimeStatus {
  return value === "not_requested" || value === "pending" || value === "created" || value === "failed";
}

function inferTaskStatusFromResult(result: SubAgentResult): Extract<SubTaskStatus, "done" | "error" | "timeout" | "stopped"> {
  if (result.success) return "done";
  if (/stopped|cancelled before execution/i.test(String(result.error ?? ""))) return "stopped";
  return /timed out/i.test(String(result.error ?? "")) ? "timeout" : "error";
}

type SpawnWithCallbacks = OrchestratorSpawnOptions;

type SubAgentSpawner = Pick<SubAgentOrchestrator, "spawn" | "listSessions">;

export function createSubTaskRuntimeEventHandler(
  runtimeStore: SubTaskRuntimeStore,
  logger?: RuntimeLogger,
): (event: SubAgentEvent) => void {
  return (event) => {
    if (event.type !== "thought_delta") return;
    void runtimeStore.recordThoughtDeltaBySession(event.sessionId, event.delta).catch((error) => {
      logger?.warn?.("Failed to record subtask progress delta.", error);
    });
  };
}

export async function reconcileSubTaskWorktreeRuntimes(input: {
  runtimeStore: SubTaskRuntimeStore;
  worktreeRuntime: SubTaskWorktreeRuntime;
  logger?: RuntimeLogger;
}): Promise<{
  scanned: number;
  reconciled: number;
  cleaned: number;
  failed: number;
}> {
  const tasks = await input.runtimeStore.listTasks(undefined, { includeArchived: true });
  let scanned = 0;
  let reconciled = 0;
  let cleaned = 0;
  let failed = 0;

  for (const task of tasks) {
    if (task.launchSpec.isolationMode !== "worktree") {
      continue;
    }
    scanned += 1;

    const runtimeSummary = task.archivedAt
      ? await input.worktreeRuntime.cleanupTaskRuntime(task.id, task.launchSpec)
      : await input.worktreeRuntime.reconcileTaskRuntime(task.id, task.launchSpec);

    await input.runtimeStore.updateTaskWorktreeRuntime(task.id, {
      runtimeSummary,
    });

    if (task.archivedAt) {
      if (runtimeSummary.worktreeStatus === "removed") {
        cleaned += 1;
      } else if (runtimeSummary.worktreeStatus === "remove_failed") {
        failed += 1;
      }
    } else if (runtimeSummary.worktreeStatus === "created") {
      reconciled += 1;
    } else if (runtimeSummary.worktreeStatus === "failed" || runtimeSummary.worktreeStatus === "missing") {
      failed += 1;
    }
  }

  input.logger?.info?.("Reconciled persisted subtask worktree runtimes.", {
    scanned,
    reconciled,
    cleaned,
    failed,
  });

  return {
    scanned,
    reconciled,
    cleaned,
    failed,
  };
}

export function createSubTaskWorktreeLifecycleHandler(input: {
  runtimeStore: SubTaskRuntimeStore;
  worktreeRuntime: SubTaskWorktreeRuntime;
  logger?: RuntimeLogger;
}): (event: SubTaskChangeEvent) => void {
  return (event) => {
    if (event.kind !== "archived" || event.item.launchSpec.isolationMode !== "worktree") {
      return;
    }
    void (async () => {
      const current = await input.runtimeStore.getTask(event.item.id);
      if (!current?.archivedAt) {
        return;
      }
      const runtimeSummary = await input.worktreeRuntime.cleanupTaskRuntime(current.id, current.launchSpec);
      await input.runtimeStore.updateTaskWorktreeRuntime(current.id, {
        runtimeSummary,
      });
    })().catch((error) => {
      input.logger?.warn?.("Failed to cleanup archived subtask worktree runtime.", {
        taskId: event.item.id,
        error,
      });
    });
  };
}

export function createSubTaskAgentCapabilities(input: {
  orchestrator: SubAgentSpawner;
  runtimeStore: SubTaskRuntimeStore;
  agentRegistry?: Pick<AgentRegistry, "getProfile">;
  resolveIdentityAuthorityProfile?: (agentId: string) => import("@belldandy/protocol").IdentityAuthorityProfile | undefined;
  worktreeRuntime?: SubTaskWorktreeRuntime;
  logger?: RuntimeLogger;
}): AgentCapabilities {
  const spawnOne = async (opts: SpawnSubAgentOptions): Promise<SubAgentResult> => {
      const enrichedDelegationProtocol = enrichDelegationProtocolTeamWithIdentity({
        protocol: opts.delegationProtocol,
        currentAgentId: opts.profileId ?? opts.agentId,
        resolveAuthorityProfile: (agentId: string) => input.resolveIdentityAuthorityProfile?.(agentId),
      });
      const launchSpec = normalizeAgentLaunchSpecWithCatalog({
        instruction: opts.instruction,
        parentConversationId: opts.parentConversationId ?? "system",
        agentId: opts.agentId,
        profileId: opts.profileId,
      background: opts.background,
      timeoutMs: opts.timeoutMs,
      channel: opts.channel ?? "subtask",
      context: opts.context as Record<string, unknown> | undefined,
      cwd: opts.cwd,
      toolSet: opts.toolSet,
      permissionMode: opts.permissionMode,
      isolationMode: opts.isolationMode,
      parentTaskId: opts.parentTaskId,
        role: opts.role,
        allowedToolFamilies: opts.allowedToolFamilies,
        maxToolRiskLevel: opts.maxToolRiskLevel,
        policySummary: opts.policySummary,
        delegationProtocol: enrichedDelegationProtocol,
        bridgeSubtask: opts.bridgeSubtask,
      }, {
        agentRegistry: input.agentRegistry,
      });
    const task = await input.runtimeStore.createTask({
      launchSpec,
    });

    let attachedSessionId: string | undefined;
    let resolvedLaunchSpec = launchSpec;
    try {
      if (input.worktreeRuntime) {
        try {
          const prepared = await input.worktreeRuntime.prepareTaskLaunch(task.id, launchSpec);
          resolvedLaunchSpec = prepared.launchSpec;
          await input.runtimeStore.updateTaskLaunchSpec(task.id, {
            launchSpec: resolvedLaunchSpec,
            runtimeSummary: {
              requestedCwd: launchSpec.cwd,
              ...prepared.summary,
            },
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          await input.runtimeStore.updateTaskLaunchSpec(task.id, {
            launchSpec,
            runtimeSummary: {
              requestedCwd: launchSpec.cwd,
              resolvedCwd: launchSpec.cwd,
              worktreeStatus: "failed",
              worktreeError: errorMessage,
            },
          });
          const completed = await input.runtimeStore.completeTask(task.id, {
            status: "error",
            output: "",
            error: errorMessage,
          });
          return {
            success: false,
            output: "",
            error: errorMessage,
            taskId: task.id,
            outputPath: completed?.outputPath,
          };
        }
      }

      const spawnOptions: SpawnWithCallbacks = {
        launchSpec: resolvedLaunchSpec,
        abortSignal: opts.abortSignal,
        shouldAbortBeforeStart: async () => {
          const current = await input.runtimeStore.getTask(task.id);
          return Boolean(current && (current.status === "stopped" || current.stopRequestedAt));
        },
        onQueued: (position: number, sessionId?: string, resolvedAgentId?: string) => {
          void input.runtimeStore.markQueued(task.id, position, {
            sessionId,
            agentId: resolvedAgentId,
            profileId: resolvedLaunchSpec.profileId,
          }).catch((error) => {
            input.logger?.warn?.("Failed to mark queued subtask.", error);
          });
        },
        onSessionCreated: (sessionId: string, resolvedAgentId: string) => {
          attachedSessionId = sessionId;
          void input.runtimeStore.attachSession(
            task.id,
            sessionId,
            resolvedAgentId,
            resolvedLaunchSpec.profileId,
          ).catch((error) => {
            input.logger?.warn?.("Failed to attach subtask session.", {
              error,
              taskId: task.id,
              sessionId,
              agentId: resolvedAgentId,
            });
          });
        },
      };
      const result = await input.orchestrator.spawn(spawnOptions);
      const completed = await input.runtimeStore.completeTask(task.id, {
        status: inferTaskStatusFromResult(result),
        sessionId: result.sessionId ?? attachedSessionId,
        output: result.output,
        error: result.error,
      });
      return {
        ...result,
        sessionId: result.sessionId ?? attachedSessionId,
        taskId: task.id,
        outputPath: completed?.outputPath,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const completed = await input.runtimeStore.completeTask(task.id, {
        status: /timed out/i.test(errorMessage) ? "timeout" : "error",
        sessionId: attachedSessionId,
        output: "",
        error: errorMessage,
      });
      return {
        success: false,
        output: "",
        error: errorMessage,
        sessionId: attachedSessionId,
        taskId: task.id,
        outputPath: completed?.outputPath,
      };
    }
  };

  return {
    spawnSubAgent: (opts: SpawnSubAgentOptions) => spawnOne(opts),
    spawnParallel: (tasks: SpawnSubAgentOptions[]) => Promise.all(tasks.map((task: SpawnSubAgentOptions) => spawnOne(task))),
    listSessions: (parentConversationId?: string) => input.runtimeStore.listSessionInfos(parentConversationId),
  };
}

function extractConversationHistoryMessages(
  conversation: {
    messages?: Array<{ role?: unknown; content?: unknown }>;
  } | undefined,
): Array<{ role: "user" | "assistant"; content: string }> {
  if (!conversation || !Array.isArray(conversation.messages)) {
    return [];
  }
  return conversation.messages
    .filter((item): item is { role: "user" | "assistant"; content: string } =>
      item?.role === "user" || item?.role === "assistant")
    .map((item) => ({
      role: item.role,
      content: typeof item.content === "string" ? item.content : "",
    }))
    .filter((item) => item.content.trim().length > 0);
}

function buildResumeInstruction(record: SubTaskRecord, message: string): string {
  const normalizedMessage = String(message ?? "").trim();
  const latestSummary = truncateText(
    record.outputPreview || record.error || record.summary || record.progress.message || record.instruction,
    240,
  );
  if (normalizedMessage) {
    return [
      "Resume the same subtask from its last recorded state.",
      "",
      `Original instruction: ${record.instruction}`,
      `Latest recorded summary: ${latestSummary || "-"}`,
      "",
      `Resume guidance: ${normalizedMessage}`,
    ].join("\n").trim();
  }
  return [
    "Resume the same subtask from its last recorded state.",
    "",
    `Original instruction: ${record.instruction}`,
    `Latest recorded summary: ${latestSummary || "-"}`,
    "",
    "Continue from here and produce the next best result.",
  ].join("\n").trim();
}

function buildTakeoverMessage(agentId: string, message: string): string {
  return [
    `Take over this subtask as agent ${agentId}.`,
    String(message ?? "").trim(),
  ].filter(Boolean).join("\n\n");
}

function buildTakeoverInstruction(
  record: SubTaskRecord,
  agentId: string,
  message: string,
  mode: SubTaskTakeoverMode,
): string {
  const normalizedMessage = String(message ?? "").trim();
  const latestSummary = truncateText(
    record.outputPreview || record.error || record.summary || record.progress.message || record.instruction,
    240,
  );
  const opening = mode === "safe_point"
    ? `Take over this running subtask at the next safe point under agent ${agentId}.`
    : `Take over the same subtask under agent ${agentId}.`;
  const defaultGuidance = mode === "safe_point"
    ? "Stop the current run, keep the prior history, and continue from the latest safe point."
    : "Continue from the latest recorded state and produce the next best result.";
  return [
    opening,
    mode === "safe_point"
      ? "This is a safe-point relaunch, not a live injection into the current run."
      : "This is a takeover relaunch of the same task under a different agent.",
    "",
    `Original instruction: ${record.instruction}`,
    `Latest recorded summary: ${latestSummary || "-"}`,
    `Previous agent: ${record.agentId || record.launchSpec.agentId || "-"}`,
    "",
    `Takeover guidance: ${normalizedMessage || defaultGuidance}`,
  ].join("\n").trim();
}

function buildResumeLaunchSpec(
  record: SubTaskRecord,
  instruction: string,
  sessionLaunchSpec?: AgentLaunchSpec,
): AgentLaunchSpecInput {
  if (sessionLaunchSpec) {
    return {
      ...sessionLaunchSpec,
      instruction,
    };
  }
  return {
    parentConversationId: record.parentConversationId,
    agentId: record.agentId,
    profileId: record.launchSpec.profileId,
    instruction,
    background: record.background,
    timeoutMs: record.launchSpec.timeoutMs,
    channel: record.launchSpec.channel,
    role: record.launchSpec.role,
    cwd: record.launchSpec.resolvedCwd || record.launchSpec.cwd,
    toolSet: record.launchSpec.toolSet ? [...record.launchSpec.toolSet] : undefined,
    allowedToolFamilies: record.launchSpec.allowedToolFamilies ? [...record.launchSpec.allowedToolFamilies] : undefined,
    maxToolRiskLevel: record.launchSpec.maxToolRiskLevel,
    policySummary: record.launchSpec.policySummary,
    permissionMode: record.launchSpec.permissionMode,
    isolationMode: record.launchSpec.isolationMode,
    parentTaskId: record.launchSpec.parentTaskId,
    bridgeSubtask: record.launchSpec.bridgeSubtask ? { ...record.launchSpec.bridgeSubtask } : undefined,
  };
}

export function createSubTaskUpdateController(input: {
  runtimeStore: SubTaskRuntimeStore;
  orchestrator: Pick<SubAgentOrchestrator, "spawn" | "getSession" | "stopSession">;
  conversationStore: {
    get: (conversationId: string) => {
      messages?: Array<{ role?: unknown; content?: unknown }>;
    } | undefined;
  };
  logger?: RuntimeLogger;
}) {
  return async (taskId: string, message: string): Promise<SubTaskRecord | undefined> => {
    const normalizedMessage = String(message ?? "").trim();
    if (!normalizedMessage) {
      throw new Error("Steering message is required.");
    }

    const current = await input.runtimeStore.getTask(taskId);
    if (!current) {
      return undefined;
    }
    if (current.status !== "running" || !current.sessionId) {
      throw new Error(`Subtask steering only supports running tasks. Current status: ${current.status}`);
    }

    const session = input.orchestrator.getSession(current.sessionId);
    if (!session || session.status !== "running") {
      throw new Error(`Running subtask session is not available: ${current.sessionId}`);
    }

    const accepted = await input.runtimeStore.requestSteering(taskId, normalizedMessage, {
      sessionId: current.sessionId,
    });
    if (!accepted) {
      throw new Error(`Failed to record subtask steering: ${taskId}`);
    }
    if (!accepted.claimOwner) {
      return accepted.item;
    }

    const steeringId = accepted.steering.id;
    const commandClaim = accepted.commandClaim;
    const priorHistory = extractConversationHistoryMessages(input.conversationStore.get(current.sessionId));
    await input.orchestrator.stopSession(current.sessionId, "Steering update requested. Relaunching with updated guidance.");

    let attachedSessionId: string | undefined;
    void input.orchestrator.spawn({
      launchSpec: {
        ...session.launchSpec,
        instruction: normalizedMessage,
      },
      history: priorHistory,
      resumedFromSessionId: current.sessionId,
      onQueued: (position: number, sessionId?: string, resolvedAgentId?: string) => {
        void input.runtimeStore.markQueued(taskId, position, {
          sessionId,
          agentId: resolvedAgentId,
          profileId: session.launchSpec.profileId,
          commandClaim,
        }).catch((error) => {
          input.logger?.warn?.("Failed to mark queued steering continuation.", {
            taskId,
            position,
            error,
          });
        });
      },
      onSessionCreated: (sessionId: string, resolvedAgentId: string) => {
        attachedSessionId = sessionId;
        void input.runtimeStore.attachSession(
          taskId,
          sessionId,
          resolvedAgentId,
          session.launchSpec.profileId,
          commandClaim,
        ).catch((error) => {
          input.logger?.warn?.("Failed to attach steering continuation session.", {
            taskId,
            sessionId,
            agentId: resolvedAgentId,
            error,
          });
        });
        void input.runtimeStore.markSteeringDelivered(taskId, steeringId, {
          sessionId,
        }).catch((error) => {
          input.logger?.warn?.("Failed to mark steering as delivered.", {
            taskId,
            sessionId,
            steeringId,
            error,
          });
        });
      },
    }).then((result) => input.runtimeStore.completeTask(taskId, {
      status: inferTaskStatusFromResult(result),
      sessionId: result.sessionId ?? attachedSessionId,
      output: result.output,
      error: result.error,
      commandGeneration: commandClaim.generation,
    })).catch(async (error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await input.runtimeStore.markSteeringFailed(taskId, steeringId, errorMessage);
      if (!attachedSessionId) {
        await input.runtimeStore.completeTask(taskId, {
          status: /timed out/i.test(errorMessage) ? "timeout" : "error",
          output: "",
          error: errorMessage,
          commandGeneration: commandClaim.generation,
        });
      }
    });

    return accepted.item;
  };
}

export function createSubTaskResumeController(input: {
  runtimeStore: SubTaskRuntimeStore;
  orchestrator: Pick<SubAgentOrchestrator, "spawn" | "getSession">;
  agentRegistry?: Pick<AgentRegistry, "getProfile">;
  conversationStore: {
    get: (conversationId: string) => {
      messages?: Array<{ role?: unknown; content?: unknown }>;
    } | undefined;
  };
  logger?: RuntimeLogger;
}) {
  return async (
    taskId: string,
    message = "",
    options?: {
      takeoverAgentId?: string;
    },
  ): Promise<SubTaskRecord | undefined> => {
    const current = await input.runtimeStore.getTask(taskId);
    if (!current) {
      return undefined;
    }
    if (current.archivedAt) {
      throw new Error("Archived subtasks cannot be resumed.");
    }
    if (!isTerminalStatus(current.status)) {
      throw new Error(`Subtask resume only supports finished tasks. Current status: ${current.status}`);
    }

    const takeoverAgentId = typeof options?.takeoverAgentId === "string"
      ? options.takeoverAgentId.trim()
      : "";
    const resumeMessage = takeoverAgentId
      ? [
        `Take over this subtask as agent ${takeoverAgentId}.`,
        String(message ?? "").trim(),
      ].filter(Boolean).join("\n\n")
      : String(message ?? "").trim();
    const resumeInstruction = takeoverAgentId
      ? [
        `Take over the same subtask under agent ${takeoverAgentId}.`,
        "",
        `Original instruction: ${current.instruction}`,
        `Latest recorded summary: ${truncateText(current.outputPreview || current.error || current.summary || current.progress.message || current.instruction, 240) || "-"}`,
        `Previous agent: ${current.agentId || current.launchSpec.agentId || "-"}`,
        "",
        resumeMessage || "Continue from here and produce the next best result.",
      ].join("\n").trim()
      : buildResumeInstruction(current, message);
    const accepted = await input.runtimeStore.requestResume(taskId, resumeMessage, {
      sessionId: current.sessionId,
    });
    if (!accepted) {
      throw new Error(`Failed to record subtask resume: ${taskId}`);
    }
    if (!accepted.claimOwner) {
      return accepted.item;
    }

    const resumeId = accepted.resume.id;
    const commandClaim = accepted.commandClaim;
    const priorHistory = current.sessionId
      ? extractConversationHistoryMessages(input.conversationStore.get(current.sessionId))
      : [];
    const priorSession = current.sessionId
      ? input.orchestrator.getSession(current.sessionId)
      : undefined;
    let launchSpecInput = buildResumeLaunchSpec(current, resumeInstruction, priorSession?.launchSpec);
    if (takeoverAgentId) {
      launchSpecInput = {
        ...launchSpecInput,
        agentId: takeoverAgentId,
        profileId: takeoverAgentId,
      };
    }
    const launchSpec = takeoverAgentId
      ? normalizeAgentLaunchSpecWithCatalog(launchSpecInput, {
        agentRegistry: input.agentRegistry,
      })
      : launchSpecInput;

    let attachedSessionId: string | undefined;
    void input.orchestrator.spawn({
      launchSpec,
      history: priorHistory,
      resumedFromSessionId: current.sessionId,
      onQueued: (position: number, sessionId?: string, resolvedAgentId?: string) => {
        void input.runtimeStore.markQueued(taskId, position, {
          sessionId,
          agentId: resolvedAgentId,
          profileId: launchSpec.profileId,
          commandClaim,
        }).catch((error) => {
          input.logger?.warn?.("Failed to mark queued subtask resume.", {
            taskId,
            position,
            error,
          });
        });
      },
      onSessionCreated: (sessionId: string, resolvedAgentId: string) => {
        attachedSessionId = sessionId;
        void input.runtimeStore.attachSession(
          taskId,
          sessionId,
          resolvedAgentId,
          launchSpec.profileId,
          commandClaim,
        ).catch((error) => {
          input.logger?.warn?.("Failed to attach resumed subtask session.", {
            taskId,
            sessionId,
            agentId: resolvedAgentId,
            error,
          });
        });
        void input.runtimeStore.markResumeDelivered(taskId, resumeId, {
          sessionId,
          resumedFromSessionId: current.sessionId,
        }).catch((error) => {
          input.logger?.warn?.("Failed to mark subtask resume as delivered.", {
            taskId,
            sessionId,
            resumeId,
            error,
          });
        });
      },
    }).then((result) => input.runtimeStore.completeTask(taskId, {
      status: inferTaskStatusFromResult(result),
      sessionId: result.sessionId ?? attachedSessionId,
      output: result.output,
      error: result.error,
      commandGeneration: commandClaim.generation,
    })).catch(async (error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!attachedSessionId) {
        await input.runtimeStore.markResumeFailed(taskId, resumeId, errorMessage);
        return;
      }
      await input.runtimeStore.completeTask(taskId, {
        status: /timed out/i.test(errorMessage) ? "timeout" : "error",
        sessionId: attachedSessionId,
        output: "",
        error: errorMessage,
        commandGeneration: commandClaim.generation,
      });
    });

    return accepted.item;
  };
}

export function createSubTaskTakeoverController(input: {
  runtimeStore: SubTaskRuntimeStore;
  orchestrator: Pick<SubAgentOrchestrator, "spawn" | "getSession" | "stopSession">;
  agentRegistry?: Pick<AgentRegistry, "getProfile">;
  conversationStore: {
    get: (conversationId: string) => {
      messages?: Array<{ role?: unknown; content?: unknown }>;
    } | undefined;
  };
  logger?: RuntimeLogger;
}) {
  return async (
    taskId: string,
    agentId: string,
    message = "",
  ): Promise<SubTaskRecord | undefined> => {
    const normalizedAgentId = String(agentId ?? "").trim();
    if (!normalizedAgentId) {
      throw new Error("Takeover agentId is required.");
    }

    const current = await input.runtimeStore.getTask(taskId);
    if (!current) {
      return undefined;
    }
    if (current.archivedAt) {
      throw new Error("Archived subtasks cannot be taken over.");
    }

    const isRunningTakeover = current.status === "running" && Boolean(current.sessionId);
    if (!isRunningTakeover && !isTerminalStatus(current.status)) {
      throw new Error(`Subtask takeover only supports running or finished tasks. Current status: ${current.status}`);
    }

    const takeoverMessage = buildTakeoverMessage(normalizedAgentId, message);
    const takeoverInstruction = buildTakeoverInstruction(
      current,
      normalizedAgentId,
      message,
      isRunningTakeover ? "safe_point" : "resume_relaunch",
    );
    const accepted = await input.runtimeStore.requestTakeover(taskId, normalizedAgentId, takeoverMessage, {
      sessionId: current.sessionId,
      mode: isRunningTakeover ? "safe_point" : "resume_relaunch",
    });
    if (!accepted) {
      throw new Error(`Failed to record subtask takeover: ${taskId}`);
    }
    if (!accepted.claimOwner) {
      return accepted.item;
    }

    const takeoverId = accepted.takeover.id;
    const commandClaim = accepted.commandClaim;
    const priorHistory = current.sessionId
      ? extractConversationHistoryMessages(input.conversationStore.get(current.sessionId))
      : [];
    const priorSession = current.sessionId
      ? input.orchestrator.getSession(current.sessionId)
      : undefined;
    const launchSpec = normalizeAgentLaunchSpecWithCatalog({
      ...buildResumeLaunchSpec(current, takeoverInstruction, priorSession?.launchSpec),
      agentId: normalizedAgentId,
      profileId: normalizedAgentId,
    }, {
      agentRegistry: input.agentRegistry,
    });

    if (isRunningTakeover) {
      const currentSessionId = String(current.sessionId);
      const session = input.orchestrator.getSession(currentSessionId);
      if (!session || session.status !== "running") {
        await input.runtimeStore.markTakeoverFailed(taskId, takeoverId, `Running subtask session is not available: ${currentSessionId}`);
        throw new Error(`Running subtask session is not available: ${currentSessionId}`);
      }
      await input.orchestrator.stopSession(
        currentSessionId,
        `Safe-point takeover requested for agent ${normalizedAgentId}. Relaunching under the new agent.`,
      );
    }

    let attachedSessionId: string | undefined;
    void input.orchestrator.spawn({
      launchSpec,
      history: priorHistory,
      resumedFromSessionId: current.sessionId,
      onQueued: (position: number, sessionId?: string, resolvedAgentId?: string) => {
        void input.runtimeStore.markQueued(taskId, position, {
          sessionId,
          agentId: resolvedAgentId,
          profileId: launchSpec.profileId,
          commandClaim,
        }).catch((error) => {
          input.logger?.warn?.("Failed to mark queued subtask takeover.", {
            taskId,
            position,
            error,
          });
        });
      },
      onSessionCreated: (sessionId: string, resolvedAgentId: string) => {
        attachedSessionId = sessionId;
        void input.runtimeStore.attachSession(
          taskId,
          sessionId,
          resolvedAgentId,
          launchSpec.profileId,
          commandClaim,
        ).catch((error) => {
          input.logger?.warn?.("Failed to attach taken-over subtask session.", {
            taskId,
            sessionId,
            agentId: resolvedAgentId,
            error,
          });
        });
        void input.runtimeStore.markTakeoverDelivered(taskId, takeoverId, {
          sessionId,
          resumedFromSessionId: current.sessionId,
        }).catch((error) => {
          input.logger?.warn?.("Failed to mark subtask takeover as delivered.", {
            taskId,
            sessionId,
            takeoverId,
            error,
          });
        });
      },
    }).then((result) => input.runtimeStore.completeTask(taskId, {
      status: inferTaskStatusFromResult(result),
      sessionId: result.sessionId ?? attachedSessionId,
      output: result.output,
      error: result.error,
      commandGeneration: commandClaim.generation,
    })).catch(async (error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!attachedSessionId) {
        await input.runtimeStore.markTakeoverFailed(taskId, takeoverId, errorMessage);
        return;
      }
      await input.runtimeStore.completeTask(taskId, {
        status: /timed out/i.test(errorMessage) ? "timeout" : "error",
        sessionId: attachedSessionId,
        output: "",
        error: errorMessage,
        commandGeneration: commandClaim.generation,
      });
    });

    return accepted.item;
  };
}
