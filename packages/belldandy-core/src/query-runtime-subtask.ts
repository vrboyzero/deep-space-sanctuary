import fs from "node:fs/promises";

import type { AgentRegistry } from "@belldandy/agent";
import type { GatewayResFrame } from "@belldandy/protocol";

import { buildAgentLaunchExplainability } from "./agent-launch-explainability.js";
import { buildSubTaskContinuationState } from "./continuation-state.js";
import type { ConversationPromptSnapshotArtifact } from "./conversation-prompt-snapshot.js";
import type { SubTaskRecord, SubTaskRuntimeStore } from "./task-runtime.js";
import { QueryRuntime, type QueryRuntimeObserver } from "./query-runtime.js";
import { attachSubTaskBridgeProjection, getSubTaskBridgeProjection } from "./subtask-bridge-view.js";
import { buildSubTaskLaunchExplainability } from "./subtask-launch-explainability.js";
import { buildSubTaskResultEnvelope } from "./subtask-result-envelope.js";
import { resolveResidentStateBindingViewForAgent } from "./resident-state-binding.js";

type SubTaskQueryRuntimeMethod =
  | "subtask.list"
  | "subtask.get"
  | "subtask.resume"
  | "subtask.takeover"
  | "subtask.update"
  | "subtask.stop"
  | "subtask.archive";

export type QueryRuntimeSubTaskContext = {
  requestId: string;
  stateDir?: string;
  subTaskRuntimeStore?: SubTaskRuntimeStore;
  agentRegistry?: Pick<AgentRegistry, "getProfile">;
  loadPromptSnapshot?: (input: {
    conversationId: string;
    runId?: string;
  }) => Promise<ConversationPromptSnapshotArtifact | undefined>;
  resumeSubTask?: (taskId: string, message?: string) => Promise<SubTaskRecord | undefined>;
  takeoverSubTask?: (taskId: string, agentId: string, message?: string) => Promise<SubTaskRecord | undefined>;
  updateSubTask?: (taskId: string, message: string) => Promise<SubTaskRecord | undefined>;
  stopSubTask?: (taskId: string, reason?: string) => Promise<SubTaskRecord | undefined>;
  runtimeObserver?: QueryRuntimeObserver<SubTaskQueryRuntimeMethod>;
};

export async function handleSubTaskListWithQueryRuntime(
  ctx: QueryRuntimeSubTaskContext,
  params: {
    conversationId?: string;
    includeArchived: boolean;
  },
): Promise<GatewayResFrame> {
  const runtime = new QueryRuntime({
    method: "subtask.list" as const,
    traceId: ctx.requestId,
    observer: ctx.runtimeObserver,
  });

  return runtime.run(async (queryRuntime) => {
    queryRuntime.mark("runtime_checked", {
      conversationId: params.conversationId,
      detail: {
        available: Boolean(ctx.subTaskRuntimeStore),
      },
    });

    if (!ctx.subTaskRuntimeStore) {
      queryRuntime.mark("completed", {
        conversationId: params.conversationId,
        detail: {
          available: false,
          returnedEmptyList: true,
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: true,
        payload: {
          items: [],
        },
      };
    }

    queryRuntime.mark("request_validated", {
      conversationId: params.conversationId,
      detail: {
        includeArchived: params.includeArchived,
      },
    });

    const items = await ctx.subTaskRuntimeStore.listTasks(
      params.conversationId,
      { includeArchived: params.includeArchived },
    );
    const itemsWithBridgeProjection = items.map((item) => attachSubTaskBridgeProjection(item));

    queryRuntime.mark("task_listed", {
        conversationId: params.conversationId,
        detail: {
          count: itemsWithBridgeProjection.length,
          includeArchived: params.includeArchived,
        },
      });
    queryRuntime.mark("completed", {
      conversationId: params.conversationId,
        detail: {
          count: itemsWithBridgeProjection.length,
        },
      });

    return {
      type: "res",
      id: ctx.requestId,
      ok: true,
        payload: {
          conversationId: params.conversationId ?? null,
          includeArchived: params.includeArchived,
          items: itemsWithBridgeProjection,
        },
      };
  });
}

export async function handleSubTaskGetWithQueryRuntime(
  ctx: QueryRuntimeSubTaskContext,
  params: { taskId: string },
): Promise<GatewayResFrame> {
  const runtime = new QueryRuntime({
    method: "subtask.get" as const,
    traceId: ctx.requestId,
    observer: ctx.runtimeObserver,
  });

  return runtime.run(async (queryRuntime) => {
    queryRuntime.mark("runtime_checked", {
      detail: {
        available: Boolean(ctx.subTaskRuntimeStore),
      },
    });

    if (!ctx.subTaskRuntimeStore) {
      queryRuntime.mark("completed", {
        detail: {
          code: "not_available",
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: "not_available", message: "Subtask runtime not available" },
      };
    }

    queryRuntime.mark("request_validated", {
      detail: {
        taskId: params.taskId,
      },
    });

    const item = await ctx.subTaskRuntimeStore.getTask(params.taskId);
    if (!item) {
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

    queryRuntime.mark("task_loaded", {
      conversationId: item.parentConversationId,
      detail: {
        taskId: item.id,
        status: item.status,
        archived: Boolean(item.archivedAt),
      },
    });

    const outputContent = await loadSubTaskOutputContent(item);
    if (typeof outputContent === "string") {
      queryRuntime.mark("task_output_loaded", {
        conversationId: item.parentConversationId,
        detail: {
          taskId: item.id,
          outputChars: outputContent.length,
        },
      });
    }
    const scratchContent = await loadOptionalArtifactContent(item.scratchPath);
    const reviewContent = await loadOptionalArtifactContent(item.reviewPath);
    const lessonContent = await loadOptionalArtifactContent(item.lessonPath);

    const launchExplainability = buildSubTaskLaunchExplainability(item, ctx.agentRegistry);
    const promptSnapshotView = await loadSubTaskPromptSnapshotView(ctx, item, queryRuntime);
    const bridgeProjection = getSubTaskBridgeProjection(item);
    const acceptanceGate = buildSubTaskAcceptanceGateView(item, outputContent);
    const teamSharedState = await buildSubTaskTeamSharedStateView(ctx, item, outputContent, queryRuntime);

    queryRuntime.mark("completed", {
      conversationId: item.parentConversationId,
      detail: {
        taskId: item.id,
        hasLaunchExplainability: Boolean(launchExplainability),
        hasPromptSnapshot: Boolean(promptSnapshotView),
        hasAcceptanceGate: Boolean(acceptanceGate),
        hasTeamSharedState: Boolean(teamSharedState),
        teamCompletionGateStatus: teamSharedState?.completionGate?.status,
        hasBridgeSubtask: Boolean(bridgeProjection.bridgeSubtaskView),
        hasBridgeSession: Boolean(bridgeProjection.bridgeSessionView),
      },
    });

    return {
      type: "res",
      id: ctx.requestId,
      ok: true,
      payload: {
        item: attachSubTaskBridgeProjection(item),
        bridgeSubtaskView: bridgeProjection.bridgeSubtaskView,
        bridgeSubtaskIndex: bridgeProjection.bridgeSubtaskIndex,
        bridgeSessionView: bridgeProjection.bridgeSessionView,
        bridgeSessionIndex: bridgeProjection.bridgeSessionIndex,
        continuationState: buildSubTaskContinuationState(item),
        launchExplainability: launchExplainability ?? null,
        promptSnapshotView,
        acceptanceGate,
        teamSharedState,
        resultEnvelope: buildSubTaskResultEnvelope(item),
        outputContent,
        scratchContent,
        reviewContent,
        lessonContent,
      },
    };
  });
}

async function loadSubTaskPromptSnapshotView(
  ctx: QueryRuntimeSubTaskContext,
  item: SubTaskRecord,
  queryRuntime: QueryRuntime<"subtask.get">,
): Promise<{
  snapshot: ConversationPromptSnapshotArtifact;
  launchExplainability?: ReturnType<typeof buildAgentLaunchExplainability> | null;
  residentStateBinding?: ReturnType<typeof resolveResidentStateBindingViewForAgent> | null;
} | null> {
  if (!ctx.loadPromptSnapshot || !ctx.stateDir || !item.sessionId) {
    return null;
  }

  const snapshot = await ctx.loadPromptSnapshot({
    conversationId: item.sessionId,
  });
  if (!snapshot) {
    queryRuntime.mark("task_prompt_snapshot_missing", {
      conversationId: item.parentConversationId,
      detail: {
        taskId: item.id,
        sessionId: item.sessionId,
      },
    });
    return null;
  }

  const agentId = typeof snapshot.manifest.agentId === "string" && snapshot.manifest.agentId.trim()
    ? snapshot.manifest.agentId.trim()
    : item.agentId;
  const launchExplainability = buildAgentLaunchExplainability({
    agentRegistry: ctx.agentRegistry,
    agentId,
    profileId: item.launchSpec?.profileId,
    launchSpec: item.launchSpec,
  });
  const residentStateBinding = resolveResidentStateBindingViewForAgent(
    ctx.stateDir,
    ctx.agentRegistry,
    agentId,
  );

  queryRuntime.mark("task_prompt_snapshot_loaded", {
    conversationId: item.parentConversationId,
    detail: {
      taskId: item.id,
      snapshotConversationId: snapshot.manifest.conversationId,
      ...(snapshot.manifest.runId ? { runId: snapshot.manifest.runId } : {}),
      messageCount: snapshot.summary.messageCount,
    },
  });

  return {
    snapshot,
    launchExplainability: launchExplainability ?? null,
    residentStateBinding: residentStateBinding ?? null,
  };
}

type SubTaskAcceptanceGateView = {
  status: "pending" | "accepted" | "rejected" | "not_applicable";
  enforced: boolean;
  summary: string;
  reasons: string[];
  deliverableFormat?: string;
  requiredSections?: string[];
  missingRequiredSections?: string[];
  doneDefinition?: string;
  doneDefinitionCheck?: AcceptanceCheckStatus;
  acceptanceEvidence?: string;
  verificationHints?: string[];
  contractSpecificChecks?: Array<{
    id: string;
    label: string;
    status: "passed" | "failed";
  }>;
  rejectionConfidence?: "low" | "medium" | "high";
  managerActionHint?: string;
};

type SubTaskTeamLaneStateView = {
  laneId: string;
  taskId?: string;
  sessionId?: string;
  agentId?: string;
  role?: "default" | "coder" | "researcher" | "verifier";
  identityLabel?: string;
  authorityRelationToManager?: "self" | "superior" | "peer" | "subordinate" | "unknown";
  reportsTo?: string[];
  mayDirect?: string[];
  status: SubTaskRecord["status"] | "missing";
  laneState: "accepted" | "pending" | "retry" | "blocker" | "missing";
  scopeSummary?: string;
  dependsOn?: string[];
  handoffTo?: string[];
  writeScope?: string[];
  acceptanceGateStatus?: SubTaskAcceptanceGateView["status"];
  acceptanceGateSummary?: string;
  summary?: string;
};

type SubTaskTeamCompletionGateView = {
  status: "pending" | "accepted" | "rejected";
  summary: string;
  finalFanInVerdict: "safe_to_merge" | "hold_fan_in" | "reject_fan_in";
  acceptedLaneIds: string[];
  pendingLaneIds: string[];
  retryLaneIds: string[];
  blockerLaneIds: string[];
  missingLaneIds: string[];
  unresolvedDependencyLaneIds: string[];
  overlappingWriteScopes?: Array<{
    path: string;
    laneIds: string[];
  }>;
};

type SubTaskTeamSharedStateView = {
  teamId: string;
  mode: string;
  sharedGoal?: string;
  managerAgentId?: string;
  managerIdentityLabel?: string;
  currentLaneId?: string;
  fanInSummary: string;
  roster: SubTaskTeamLaneStateView[];
  completionGate: SubTaskTeamCompletionGateView;
};

type SubTaskDelegationTeamView = NonNullable<NonNullable<SubTaskRecord["launchSpec"]["delegation"]>["team"]>;
type SubTaskDelegationTeamMemberView = SubTaskDelegationTeamView["memberRoster"][number];

function buildSubTaskAcceptanceGateView(
  item: SubTaskRecord,
  outputContent?: string,
): SubTaskAcceptanceGateView | null {
  const contract = item.launchSpec?.delegation;
  const hasStructuredGate = Boolean(
    contract?.acceptance?.doneDefinition
    || (contract?.acceptance?.verificationHints && contract.acceptance.verificationHints.length > 0)
    || (contract?.deliverableContract?.requiredSections && contract.deliverableContract.requiredSections.length > 0)
    || contract?.deliverableContract?.format === "verification_report",
  );
  if (!hasStructuredGate) {
    return null;
  }

  const terminal = item.status === "done" || item.status === "error" || item.status === "timeout" || item.status === "stopped";
  if (!terminal) {
    return {
      status: "pending",
      enforced: true,
      summary: "Acceptance gate will be evaluated after the delegated task reaches a terminal state.",
      reasons: [],
      ...(contract?.deliverableContract?.format ? { deliverableFormat: contract.deliverableContract.format } : {}),
      ...(contract?.deliverableContract?.requiredSections?.length
        ? { requiredSections: [...contract.deliverableContract.requiredSections] }
        : {}),
      ...(contract?.acceptance?.doneDefinition ? { doneDefinition: contract.acceptance.doneDefinition } : {}),
      ...(contract?.acceptance?.verificationHints?.length
        ? { verificationHints: [...contract.acceptance.verificationHints] }
        : {}),
    };
  }

  const gate = evaluateSubTaskAcceptanceGate({
    output: outputContent ?? item.outputPreview ?? "",
    doneDefinition: contract?.acceptance?.doneDefinition,
    verificationHints: contract?.acceptance?.verificationHints,
    deliverableFormat: contract?.deliverableContract?.format,
    requiredSections: contract?.deliverableContract?.requiredSections,
  });
  return {
    status: gate.accepted ? "accepted" : "rejected",
    enforced: gate.enforced,
    summary: gate.summary,
    reasons: [...gate.reasons],
    ...(gate.deliverableFormat ? { deliverableFormat: gate.deliverableFormat } : {}),
    ...(gate.requiredSections?.length ? { requiredSections: [...gate.requiredSections] } : {}),
    ...(gate.missingRequiredSections?.length ? { missingRequiredSections: [...gate.missingRequiredSections] } : {}),
    ...(gate.doneDefinition ? { doneDefinition: gate.doneDefinition } : {}),
    doneDefinitionCheck: gate.acceptanceCheckStatus,
    ...(gate.acceptanceCheckEvidence ? { acceptanceEvidence: gate.acceptanceCheckEvidence } : {}),
    ...(gate.verificationHints?.length ? { verificationHints: [...gate.verificationHints] } : {}),
    ...(gate.contractSpecificChecks?.length ? { contractSpecificChecks: gate.contractSpecificChecks.map((check) => ({ ...check })) } : {}),
    ...(gate.rejectionConfidence ? { rejectionConfidence: gate.rejectionConfidence } : {}),
    ...(gate.managerActionHint ? { managerActionHint: gate.managerActionHint } : {}),
  };
}

async function buildSubTaskTeamSharedStateView(
  ctx: QueryRuntimeSubTaskContext,
  item: SubTaskRecord,
  outputContent: string | undefined,
  queryRuntime: QueryRuntime<"subtask.get">,
): Promise<SubTaskTeamSharedStateView | null> {
  const currentTeam = item.launchSpec?.delegation?.team;
  if (!currentTeam?.id || !Array.isArray(currentTeam.memberRoster) || currentTeam.memberRoster.length === 0 || !ctx.subTaskRuntimeStore) {
    return null;
  }

  const siblingItems = await ctx.subTaskRuntimeStore.listTasks(item.parentConversationId, { includeArchived: true });
  const teamItems = siblingItems.filter((record) => record.launchSpec?.delegation?.team?.id === currentTeam.id);
  if (teamItems.length === 0) {
    return null;
  }

  const mergedRoster = mergeTeamRoster([
    currentTeam,
    ...teamItems
      .map((record) => record.launchSpec?.delegation?.team)
      .filter((team): team is SubTaskDelegationTeamView => Boolean(team)),
  ]);
  if (mergedRoster.length === 0) {
    return null;
  }

  const outputByTaskId = new Map<string, string | undefined>();
  await Promise.all(teamItems.map(async (record) => {
    outputByTaskId.set(
      record.id,
      record.id === item.id ? outputContent : await loadSubTaskOutputContent(record),
    );
  }));

  const laneTaskMap = new Map<string, SubTaskRecord>();
  for (const record of teamItems) {
    const laneId = record.launchSpec?.delegation?.team?.currentLaneId;
    if (!laneId || laneTaskMap.has(laneId)) {
      continue;
    }
    laneTaskMap.set(laneId, record);
  }

  const roster: SubTaskTeamLaneStateView[] = mergedRoster.map((member: SubTaskDelegationTeamMemberView) => {
    const laneTask = laneTaskMap.get(member.laneId);
    const acceptanceGate = laneTask
      ? buildSubTaskAcceptanceGateView(laneTask, outputByTaskId.get(laneTask.id))
      : null;
    const laneState = classifyTeamLaneState(laneTask, acceptanceGate);
    return {
      laneId: member.laneId,
      ...(laneTask?.id ? { taskId: laneTask.id } : {}),
      ...(laneTask?.sessionId ? { sessionId: laneTask.sessionId } : {}),
      ...(laneTask?.agentId || member.agentId ? { agentId: laneTask?.agentId || member.agentId } : {}),
      ...(member.role ? { role: member.role } : {}),
      ...(member.identityLabel ? { identityLabel: member.identityLabel } : {}),
      ...(member.authorityRelationToManager ? { authorityRelationToManager: member.authorityRelationToManager } : {}),
      ...(member.reportsTo?.length ? { reportsTo: [...member.reportsTo] } : {}),
      ...(member.mayDirect?.length ? { mayDirect: [...member.mayDirect] } : {}),
      status: laneTask?.status ?? "missing",
      laneState,
      ...(member.scopeSummary ? { scopeSummary: member.scopeSummary } : {}),
      ...(member.dependsOn?.length ? { dependsOn: [...member.dependsOn] } : {}),
      ...(member.handoffTo?.length ? { handoffTo: [...member.handoffTo] } : {}),
      ...(laneTask?.launchSpec?.delegation?.ownership?.writeScope?.length
        ? { writeScope: [...laneTask.launchSpec.delegation.ownership.writeScope] }
        : {}),
      ...(acceptanceGate?.status ? { acceptanceGateStatus: acceptanceGate.status } : {}),
      ...(acceptanceGate?.summary ? { acceptanceGateSummary: acceptanceGate.summary } : {}),
      ...(laneTask?.summary ? { summary: laneTask.summary } : {}),
    } satisfies SubTaskTeamLaneStateView;
  });

  const acceptedLaneIds = roster
    .filter((lane) => lane.laneState === "accepted")
    .map((lane) => lane.laneId);
  const pendingLaneIds = roster
    .filter((lane) => lane.laneState === "pending")
    .map((lane) => lane.laneId);
  const retryLaneIds = roster
    .filter((lane) => lane.laneState === "retry")
    .map((lane) => lane.laneId);
  const blockerLaneIds = roster
    .filter((lane) => lane.laneState === "blocker")
    .map((lane) => lane.laneId);
  const missingLaneIds = roster
    .filter((lane) => lane.laneState === "missing")
    .map((lane) => lane.laneId);
  const unresolvedDependencyLaneIds = roster
    .filter((lane) => Array.isArray(lane.dependsOn) && lane.dependsOn.some((dependencyLaneId) => !acceptedLaneIds.includes(dependencyLaneId)))
    .map((lane) => lane.laneId);
  const overlappingWriteScopes = detectOverlappingLaneWriteScopes(roster);
  const completionGate = buildTeamCompletionGateView({
    acceptedLaneIds,
    pendingLaneIds,
    retryLaneIds,
    blockerLaneIds,
    missingLaneIds,
    unresolvedDependencyLaneIds,
    overlappingWriteScopes,
  });

  return {
    teamId: currentTeam.id,
    mode: currentTeam.mode,
    ...(currentTeam.sharedGoal ? { sharedGoal: currentTeam.sharedGoal } : {}),
    ...(currentTeam.managerAgentId ? { managerAgentId: currentTeam.managerAgentId } : {}),
    ...(currentTeam.managerIdentityLabel ? { managerIdentityLabel: currentTeam.managerIdentityLabel } : {}),
    ...(currentTeam.currentLaneId ? { currentLaneId: currentTeam.currentLaneId } : {}),
    fanInSummary: completionGate.summary,
    roster,
    completionGate,
  };
}

async function loadSubTaskOutputContent(record: SubTaskRecord): Promise<string | undefined> {
  if (!record.outputPath) {
    return record.outputPreview || undefined;
  }
  try {
    return await fs.readFile(record.outputPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return record.outputPreview || undefined;
    }
    throw error;
  }
}

async function loadOptionalArtifactContent(artifactPath: string | undefined): Promise<string | undefined> {
  if (!artifactPath) {
    return undefined;
  }
  try {
    return await fs.readFile(artifactPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function mergeTeamRoster(
  teams: Array<SubTaskDelegationTeamView | undefined>,
): SubTaskDelegationTeamMemberView[] {
  const merged = new Map<string, SubTaskDelegationTeamMemberView>();
  for (const team of teams) {
    if (!team?.memberRoster?.length) {
      continue;
    }
    for (const member of team.memberRoster) {
      const existing = merged.get(member.laneId);
      if (!existing) {
        merged.set(member.laneId, {
          ...member,
          ...(member.reportsTo?.length ? { reportsTo: [...member.reportsTo] } : {}),
          ...(member.mayDirect?.length ? { mayDirect: [...member.mayDirect] } : {}),
          ...(member.dependsOn?.length ? { dependsOn: [...member.dependsOn] } : {}),
          ...(member.handoffTo?.length ? { handoffTo: [...member.handoffTo] } : {}),
        });
        continue;
      }
      merged.set(member.laneId, {
        laneId: member.laneId,
        agentId: existing.agentId ?? member.agentId,
        role: existing.role ?? member.role,
        identityLabel: existing.identityLabel ?? member.identityLabel,
        authorityRelationToManager: existing.authorityRelationToManager ?? member.authorityRelationToManager,
        reportsTo: dedupeStrings([...(existing.reportsTo ?? []), ...(member.reportsTo ?? [])]),
        mayDirect: dedupeStrings([...(existing.mayDirect ?? []), ...(member.mayDirect ?? [])]),
        scopeSummary: existing.scopeSummary ?? member.scopeSummary,
        dependsOn: dedupeStrings([...(existing.dependsOn ?? []), ...(member.dependsOn ?? [])]),
        handoffTo: dedupeStrings([...(existing.handoffTo ?? []), ...(member.handoffTo ?? [])]),
      });
    }
  }
  return [...merged.values()];
}

function classifyTeamLaneState(
  laneTask: SubTaskRecord | undefined,
  acceptanceGate: SubTaskAcceptanceGateView | null,
): SubTaskTeamLaneStateView["laneState"] {
  if (!laneTask) {
    return "missing";
  }
  if (laneTask.status === "running" || laneTask.status === "pending") {
    return "pending";
  }
  if (laneTask.status === "error" || laneTask.status === "timeout" || laneTask.status === "stopped") {
    return "blocker";
  }
  if (acceptanceGate?.status === "rejected") {
    return "retry";
  }
  if (laneTask.status === "done") {
    return "accepted";
  }
  return "pending";
}

function detectOverlappingLaneWriteScopes(
  roster: SubTaskTeamLaneStateView[],
): Array<{ path: string; laneIds: string[] }> | undefined {
  const pathToLaneIds = new Map<string, Set<string>>();
  for (const lane of roster) {
    for (const writeScopePath of lane.writeScope ?? []) {
      const normalizedPath = writeScopePath.trim();
      if (!normalizedPath) {
        continue;
      }
      const laneIds = pathToLaneIds.get(normalizedPath) ?? new Set<string>();
      laneIds.add(lane.laneId);
      pathToLaneIds.set(normalizedPath, laneIds);
    }
  }
  const overlaps = [...pathToLaneIds.entries()]
    .filter(([, laneIds]) => laneIds.size > 1)
    .map(([scopePath, laneIds]) => ({
      path: scopePath,
      laneIds: [...laneIds].sort(),
    }));
  return overlaps.length > 0 ? overlaps : undefined;
}

function buildTeamCompletionGateView(input: {
  acceptedLaneIds: string[];
  pendingLaneIds: string[];
  retryLaneIds: string[];
  blockerLaneIds: string[];
  missingLaneIds: string[];
  unresolvedDependencyLaneIds: string[];
  overlappingWriteScopes?: Array<{ path: string; laneIds: string[] }>;
}): SubTaskTeamCompletionGateView {
  const overlapCount = input.overlappingWriteScopes?.length ?? 0;
  if (input.blockerLaneIds.length > 0 || overlapCount > 0) {
    const parts: string[] = [];
    if (input.blockerLaneIds.length > 0) {
      parts.push(`blocker lanes: ${input.blockerLaneIds.join(", ")}`);
    }
    if (overlapCount > 0) {
      parts.push(`overlapping write scope: ${input.overlappingWriteScopes!.map((entry) => `${entry.path} <= ${entry.laneIds.join("+")}`).join(" | ")}`);
    }
    return {
      status: "rejected",
      summary: `Team completion gate rejected: ${parts.join("; ")}.`,
      finalFanInVerdict: "reject_fan_in",
      acceptedLaneIds: [...input.acceptedLaneIds],
      pendingLaneIds: [...input.pendingLaneIds],
      retryLaneIds: [...input.retryLaneIds],
      blockerLaneIds: [...input.blockerLaneIds],
      missingLaneIds: [...input.missingLaneIds],
      unresolvedDependencyLaneIds: [...input.unresolvedDependencyLaneIds],
      ...(input.overlappingWriteScopes ? { overlappingWriteScopes: input.overlappingWriteScopes.map((entry) => ({ ...entry, laneIds: [...entry.laneIds] })) } : {}),
    };
  }
  if (
    input.pendingLaneIds.length > 0
    || input.retryLaneIds.length > 0
    || input.missingLaneIds.length > 0
    || input.unresolvedDependencyLaneIds.length > 0
  ) {
    const parts = [
      input.acceptedLaneIds.length > 0 ? `accepted=${input.acceptedLaneIds.join(", ")}` : "",
      input.pendingLaneIds.length > 0 ? `pending=${input.pendingLaneIds.join(", ")}` : "",
      input.retryLaneIds.length > 0 ? `retry=${input.retryLaneIds.join(", ")}` : "",
      input.missingLaneIds.length > 0 ? `missing=${input.missingLaneIds.join(", ")}` : "",
      input.unresolvedDependencyLaneIds.length > 0 ? `unresolved_deps=${input.unresolvedDependencyLaneIds.join(", ")}` : "",
    ].filter(Boolean);
    return {
      status: "pending",
      summary: `Team completion gate pending: ${parts.join("; ")}.`,
      finalFanInVerdict: "hold_fan_in",
      acceptedLaneIds: [...input.acceptedLaneIds],
      pendingLaneIds: [...input.pendingLaneIds],
      retryLaneIds: [...input.retryLaneIds],
      blockerLaneIds: [...input.blockerLaneIds],
      missingLaneIds: [...input.missingLaneIds],
      unresolvedDependencyLaneIds: [...input.unresolvedDependencyLaneIds],
    };
  }
  return {
    status: "accepted",
    summary: `Team completion gate accepted: all ${input.acceptedLaneIds.length} lane(s) are terminal and safe for manager fan-in.`,
    finalFanInVerdict: "safe_to_merge",
    acceptedLaneIds: [...input.acceptedLaneIds],
    pendingLaneIds: [],
    retryLaneIds: [],
    blockerLaneIds: [],
    missingLaneIds: [],
    unresolvedDependencyLaneIds: [],
  };
}

function dedupeStrings(values: string[]): string[] | undefined {
  const normalized = values
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
  return normalized.length > 0 ? [...new Set(normalized)] : undefined;
}

type AcceptanceCheckStatus = "not_requested" | "passed" | "missing" | "failed" | "unclear";

function evaluateSubTaskAcceptanceGate(input: {
  output: string;
  doneDefinition?: string;
  verificationHints?: string[];
  deliverableFormat?: string;
  requiredSections?: string[];
}): {
  enforced: boolean;
  accepted: boolean;
  summary: string;
  reasons: string[];
  deliverableFormat?: string;
  requiredSections?: string[];
  missingRequiredSections?: string[];
  doneDefinition?: string;
  acceptanceCheckStatus: AcceptanceCheckStatus;
  acceptanceCheckEvidence?: string;
  verificationHints?: string[];
  contractSpecificChecks?: Array<{
    id: string;
    label: string;
    status: "passed" | "failed";
  }>;
  rejectionConfidence?: "low" | "medium" | "high";
  managerActionHint?: string;
} {
  const requiredSections = normalizeStringArray(input.requiredSections);
  const doneDefinition = typeof input.doneDefinition === "string" && input.doneDefinition.trim()
    ? input.doneDefinition.trim()
    : undefined;
  const verificationHints = normalizeStringArray(input.verificationHints);
  const missingRequiredSections = findMissingRequiredSections(input.output, requiredSections);
  const contractSpecificChecks = evaluateFormatSpecificGateChecks(input.output, input.deliverableFormat);
  const acceptanceCheckEvidence = doneDefinition
    ? extractAcceptanceCheckEvidence(input.output)
    : undefined;
  const acceptanceCheckStatus = doneDefinition
    ? classifyAcceptanceCheck(acceptanceCheckEvidence)
    : "not_requested";
  const reasons: string[] = [];

  if (!input.output.trim()) {
    reasons.push("Delegated result is empty.");
  }
  if (missingRequiredSections.length > 0) {
    reasons.push(`Missing required sections: ${missingRequiredSections.join(", ")}`);
  }
  for (const check of contractSpecificChecks) {
    if (check.status === "failed") {
      reasons.push(check.label);
    }
  }
  if (doneDefinition) {
    if (acceptanceCheckStatus === "missing") {
      reasons.push("Missing explicit `Done Definition Check` section or verdict.");
    } else if (acceptanceCheckStatus === "failed") {
      reasons.push("The delegated result explicitly says the done definition is not satisfied.");
    } else if (acceptanceCheckStatus === "unclear") {
      reasons.push("The delegated result does not provide a clear pass/fail verdict for the done definition.");
    }
  }

  const enforced = Boolean(requiredSections.length > 0 || doneDefinition || verificationHints.length > 0 || contractSpecificChecks.length > 0);
  const accepted = enforced ? reasons.length === 0 : true;
  const summary = accepted
    ? "Delegated result passed the structured acceptance gate."
    : `Delegated result failed the structured acceptance gate: ${reasons.join(" | ")}`;
  const rejectionConfidence = accepted
    ? undefined
    : classifyAcceptanceGateRejectionConfidence({
        missingRequiredSections,
        acceptanceCheckStatus,
        contractSpecificChecks,
      });
  const managerActionHint = buildAcceptanceGateManagerActionHint({
    accepted,
    missingRequiredSections,
    acceptanceCheckStatus,
    contractSpecificChecks,
  });

  return {
    enforced,
    accepted,
    summary,
    reasons,
    ...(typeof input.deliverableFormat === "string" && input.deliverableFormat.trim()
      ? { deliverableFormat: input.deliverableFormat.trim() }
      : {}),
    ...(requiredSections.length > 0 ? { requiredSections } : {}),
    ...(missingRequiredSections.length > 0 ? { missingRequiredSections } : {}),
    ...(doneDefinition ? { doneDefinition } : {}),
    acceptanceCheckStatus,
    ...(acceptanceCheckEvidence ? { acceptanceCheckEvidence } : {}),
    ...(verificationHints.length > 0 ? { verificationHints } : {}),
    ...(contractSpecificChecks.length > 0 ? { contractSpecificChecks } : {}),
    ...(rejectionConfidence ? { rejectionConfidence } : {}),
    ...(managerActionHint ? { managerActionHint } : {}),
  };
}

const VERIFICATION_REPORT_FINDINGS_SECTION_LABELS = [
  "Findings",
  "Issues",
  "Risks",
  "Observations",
];

const VERIFICATION_REPORT_RECOMMENDATION_SECTION_LABELS = [
  "Recommendation",
  "Recommendations",
  "Decision",
  "Verdict",
  "Conclusion",
  "Merge recommendation",
];

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(
    value
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim()),
  )];
}

function findMissingRequiredSections(output: string, requiredSections: readonly string[]): string[] {
  if (requiredSections.length === 0) {
    return [];
  }
  return requiredSections.filter((section) => !hasSectionLabel(output, section));
}

function evaluateFormatSpecificGateChecks(
  output: string,
  deliverableFormat?: string,
): Array<{
  id: string;
  label: string;
  status: "passed" | "failed";
}> {
  if (deliverableFormat !== "verification_report") {
    return [];
  }
  const findingsSection = findFirstMatchingSectionLabel(output, VERIFICATION_REPORT_FINDINGS_SECTION_LABELS);
  const recommendationSection = findFirstMatchingSectionLabel(output, VERIFICATION_REPORT_RECOMMENDATION_SECTION_LABELS);
  return [
    {
      id: "verification_report_findings",
      label: "Verification report is missing a findings section.",
      status: findingsSection ? "passed" : "failed",
    },
    {
      id: "verification_report_recommendation",
      label: "Verification report is missing a recommendation or verdict section.",
      status: recommendationSection ? "passed" : "failed",
    },
  ];
}

function findFirstMatchingSectionLabel(output: string, labels: readonly string[]): string | undefined {
  for (const line of output.split(/\r?\n/u)) {
    const normalizedLine = normalizeSectionLabel(line);
    if (!normalizedLine) {
      continue;
    }
    for (const label of labels) {
      if (normalizedLine === normalizeSectionLabel(label)) {
        return line.trim();
      }
    }
  }
  return undefined;
}

function classifyAcceptanceGateRejectionConfidence(input: {
  missingRequiredSections: string[];
  acceptanceCheckStatus: AcceptanceCheckStatus;
  contractSpecificChecks: Array<{ status: "passed" | "failed" }>;
}): "low" | "medium" | "high" {
  if (input.missingRequiredSections.length > 0
    || input.acceptanceCheckStatus === "failed"
    || input.acceptanceCheckStatus === "missing"
    || input.contractSpecificChecks.some((check) => check.status === "failed")) {
    return "high";
  }
  if (input.acceptanceCheckStatus === "unclear") {
    return "medium";
  }
  return "low";
}

function buildAcceptanceGateManagerActionHint(input: {
  accepted: boolean;
  missingRequiredSections: string[];
  acceptanceCheckStatus: AcceptanceCheckStatus;
  contractSpecificChecks: Array<{ status: "passed" | "failed" }>;
}): string {
  if (input.accepted) {
    return "the delegated result is structured enough to integrate or verify further.";
  }
  if (input.missingRequiredSections.length > 0 || input.contractSpecificChecks.some((check) => check.status === "failed")) {
    return "reject this handoff and re-delegate with explicit section requirements or a clearer deliverable contract.";
  }
  if (input.acceptanceCheckStatus === "missing" || input.acceptanceCheckStatus === "unclear") {
    return "reject or follow up until the worker provides an explicit done-definition verdict with supporting evidence.";
  }
  if (input.acceptanceCheckStatus === "failed") {
    return "do not integrate this result as complete. Escalate, reject, or hand off to a verifier before proceeding.";
  }
  return "do not integrate this result as complete. Follow up, reject, or hand off to a verifier.";
}

function hasSectionLabel(output: string, sectionName: string): boolean {
  const normalizedSection = normalizeSectionLabel(sectionName);
  if (!normalizedSection) {
    return false;
  }
  return output
    .split(/\r?\n/u)
    .some((line) => normalizeSectionLabel(line) === normalizedSection);
}

function extractAcceptanceCheckEvidence(output: string): string | undefined {
  const lines = output.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const matched = matchAcceptanceCheckLabel(lines[index] ?? "");
    if (!matched.matched) {
      continue;
    }
    if (matched.inlineRemainder) {
      return matched.inlineRemainder;
    }

    const collected: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const nextLine = lines[cursor]?.trim() ?? "";
      if (!nextLine) {
        if (collected.length > 0) break;
        continue;
      }
      if (looksLikeSectionBoundary(nextLine)) {
        break;
      }
      collected.push(nextLine);
      if (collected.length >= 4) {
        break;
      }
    }

    const evidence = collected.join(" ").trim();
    return evidence || undefined;
  }
  return undefined;
}

function classifyAcceptanceCheck(value: string | undefined): AcceptanceCheckStatus {
  if (!value) {
    return "missing";
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return "missing";
  }
  if (/(not satisfied|does not satisfy|doesn't satisfy|not ready|blocked|fail(?:ed|s)?|missing|incomplete|cannot|can't|no\b)/u.test(normalized)) {
    return "failed";
  }
  if (/(satisfied|satisfies|meets?|met|ready|complete(?:d)?|done|pass(?:ed|es)?|acceptable|accepted|yes\b)/u.test(normalized)) {
    return "passed";
  }
  return "unclear";
}

function matchAcceptanceCheckLabel(line: string): {
  matched: boolean;
  inlineRemainder?: string;
} {
  const labels = [
    "Done Definition Check",
    "Acceptance Check",
    "Completion Check",
    "Completion Status",
    "Done Definition Status",
  ];
  const trimmed = line.trim();
  if (!trimmed) {
    return { matched: false };
  }
  const colonMatch = trimmed.match(/^(.+?)[:：]\s*(.+)$/u);
  if (colonMatch) {
    const label = normalizeSectionLabel(colonMatch[1] ?? "");
    const inlineRemainder = typeof colonMatch[2] === "string" && colonMatch[2].trim()
      ? colonMatch[2].trim()
      : undefined;
    if (label && labels.some((candidate) => normalizeSectionLabel(candidate) === label)) {
      return {
        matched: true,
        ...(inlineRemainder ? { inlineRemainder } : {}),
      };
    }
  }

  const normalizedLine = normalizeSectionLabel(trimmed);
  if (normalizedLine && labels.some((candidate) => normalizeSectionLabel(candidate) === normalizedLine)) {
    return { matched: true };
  }
  return { matched: false };
}

function looksLikeSectionBoundary(line: string): boolean {
  if (/^#{1,6}\s+/u.test(line)) {
    return true;
  }
  if (/^\*\*.+\*\*:?\s*$/u.test(line)) {
    return true;
  }
  if (/^[A-Za-z0-9][A-Za-z0-9 /&()_.-]{0,78}[:：]\s*$/u.test(line)) {
    return true;
  }
  return false;
}

function normalizeSectionLabel(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const normalized = trimmed
    .replace(/^#{1,6}\s+/u, "")
    .replace(/^\*\*(.+)\*\*:?\s*$/u, "$1")
    .replace(/^[-*]\s+/u, "")
    .replace(/[:：]\s*$/u, "")
    .replace(/^[0-9]+[.)]\s+/u, "")
    .replace(/[`*_]/gu, "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
  return normalized || undefined;
}

export async function handleSubTaskStopWithQueryRuntime(
  ctx: QueryRuntimeSubTaskContext,
  params: { taskId: string; reason?: string },
): Promise<GatewayResFrame> {
  const runtime = new QueryRuntime({
    method: "subtask.stop" as const,
    traceId: ctx.requestId,
    observer: ctx.runtimeObserver,
  });

  return runtime.run(async (queryRuntime) => {
    queryRuntime.mark("runtime_checked", {
      detail: {
        hasStore: Boolean(ctx.subTaskRuntimeStore),
        hasStopHandler: Boolean(ctx.stopSubTask),
      },
    });

    if (!ctx.subTaskRuntimeStore || !ctx.stopSubTask) {
      queryRuntime.mark("completed", {
        detail: {
          code: "not_available",
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: "not_available", message: "Subtask stop not available" },
      };
    }

    queryRuntime.mark("request_validated", {
      detail: {
        taskId: params.taskId,
        hasReason: Boolean(params.reason),
      },
    });

    const current = await ctx.subTaskRuntimeStore.getTask(params.taskId);
    if (!current) {
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

    queryRuntime.mark("task_loaded", {
      conversationId: current.parentConversationId,
      detail: {
        taskId: current.id,
        status: current.status,
      },
    });

    if (current.status === "done" || current.status === "error" || current.status === "timeout" || current.status === "stopped") {
      queryRuntime.mark("completed", {
        conversationId: current.parentConversationId,
        detail: {
          taskId: current.id,
          code: "invalid_state",
          status: current.status,
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: "invalid_state", message: `Subtask already finished: ${current.status}` },
      };
    }

    const item = await ctx.stopSubTask(params.taskId, params.reason);
    if (!item) {
      queryRuntime.mark("completed", {
        conversationId: current.parentConversationId,
        detail: {
          taskId: current.id,
          code: "stop_failed",
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: "stop_failed", message: `Failed to stop subtask: ${params.taskId}` },
      };
    }

    queryRuntime.mark("task_stopped", {
      conversationId: item.parentConversationId,
      detail: {
        taskId: item.id,
        status: item.status,
        stopReason: item.stopReason,
      },
    });
    queryRuntime.mark("completed", {
      conversationId: item.parentConversationId,
      detail: {
        taskId: item.id,
      },
    });

    return {
      type: "res",
      id: ctx.requestId,
      ok: true,
      payload: {
        item,
      },
    };
  });
}

export async function handleSubTaskResumeWithQueryRuntime(
  ctx: QueryRuntimeSubTaskContext,
  params: { taskId: string; message?: string },
): Promise<GatewayResFrame> {
  const runtime = new QueryRuntime({
    method: "subtask.resume" as const,
    traceId: ctx.requestId,
    observer: ctx.runtimeObserver,
  });

  return runtime.run(async (queryRuntime) => {
    queryRuntime.mark("runtime_checked", {
      detail: {
        hasStore: Boolean(ctx.subTaskRuntimeStore),
        hasResumeHandler: Boolean(ctx.resumeSubTask),
      },
    });

    if (!ctx.subTaskRuntimeStore || !ctx.resumeSubTask) {
      queryRuntime.mark("completed", {
        detail: {
          code: "not_available",
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: "not_available", message: "Subtask resume not available" },
      };
    }

    queryRuntime.mark("request_validated", {
      detail: {
        taskId: params.taskId,
        messageChars: typeof params.message === "string" ? params.message.length : 0,
      },
    });

    const current = await ctx.subTaskRuntimeStore.getTask(params.taskId);
    if (!current) {
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

    queryRuntime.mark("task_loaded", {
      conversationId: current.parentConversationId,
      detail: {
        taskId: current.id,
        status: current.status,
        sessionId: current.sessionId,
        archived: Boolean(current.archivedAt),
      },
    });

    let item: SubTaskRecord | undefined;
    try {
      item = await ctx.resumeSubTask(params.taskId, params.message);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      queryRuntime.mark("completed", {
        conversationId: current.parentConversationId,
        detail: {
          taskId: current.id,
          code: "resume_failed",
          error: errorMessage,
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: "resume_failed", message: errorMessage },
      };
    }

    if (!item) {
      queryRuntime.mark("completed", {
        conversationId: current.parentConversationId,
        detail: {
          taskId: current.id,
          code: "resume_failed",
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: "resume_failed", message: `Failed to resume subtask: ${params.taskId}` },
      };
    }

    queryRuntime.mark("task_resumed", {
      conversationId: item.parentConversationId,
      detail: {
        taskId: item.id,
        status: item.status,
        resumeCount: item.resume.length,
      },
    });
    queryRuntime.mark("completed", {
      conversationId: item.parentConversationId,
      detail: {
        taskId: item.id,
      },
    });

    return {
      type: "res",
      id: ctx.requestId,
      ok: true,
      payload: {
        item,
      },
    };
  });
}

export async function handleSubTaskTakeoverWithQueryRuntime(
  ctx: QueryRuntimeSubTaskContext,
  params: { taskId: string; agentId: string; message?: string },
): Promise<GatewayResFrame> {
  const runtime = new QueryRuntime({
    method: "subtask.takeover" as const,
    traceId: ctx.requestId,
    observer: ctx.runtimeObserver,
  });

  return runtime.run(async (queryRuntime) => {
    queryRuntime.mark("runtime_checked", {
      detail: {
        hasStore: Boolean(ctx.subTaskRuntimeStore),
        hasTakeoverHandler: Boolean(ctx.takeoverSubTask),
      },
    });

    if (!ctx.subTaskRuntimeStore || !ctx.takeoverSubTask) {
      queryRuntime.mark("completed", {
        detail: {
          code: "not_available",
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: "not_available", message: "Subtask takeover not available" },
      };
    }

    queryRuntime.mark("request_validated", {
      detail: {
        taskId: params.taskId,
        agentId: params.agentId,
        messageChars: typeof params.message === "string" ? params.message.length : 0,
      },
    });

    const current = await ctx.subTaskRuntimeStore.getTask(params.taskId);
    if (!current) {
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

    queryRuntime.mark("task_loaded", {
      conversationId: current.parentConversationId,
      detail: {
        taskId: current.id,
        status: current.status,
        sessionId: current.sessionId,
        archived: Boolean(current.archivedAt),
        fromAgentId: current.agentId,
        toAgentId: params.agentId,
        takeoverMode: current.status === "running" && current.sessionId ? "safe_point" : "resume_relaunch",
      },
    });

    let item: SubTaskRecord | undefined;
    try {
      item = await ctx.takeoverSubTask(params.taskId, params.agentId, params.message);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      queryRuntime.mark("completed", {
        conversationId: current.parentConversationId,
        detail: {
          taskId: current.id,
          code: "takeover_failed",
          error: errorMessage,
          toAgentId: params.agentId,
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: "takeover_failed", message: errorMessage },
      };
    }

    if (!item) {
      queryRuntime.mark("completed", {
        conversationId: current.parentConversationId,
        detail: {
          taskId: current.id,
          code: "takeover_failed",
          toAgentId: params.agentId,
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: "takeover_failed", message: `Failed to take over subtask: ${params.taskId}` },
      };
    }

    queryRuntime.mark("task_taken_over", {
      conversationId: item.parentConversationId,
      detail: {
        taskId: item.id,
        status: item.status,
        takeoverCount: Array.isArray(item.takeover) ? item.takeover.length : 0,
        resumeCount: item.resume.length,
        agentId: item.agentId,
      },
    });
    queryRuntime.mark("completed", {
      conversationId: item.parentConversationId,
      detail: {
        taskId: item.id,
        agentId: item.agentId,
      },
    });

    return {
      type: "res",
      id: ctx.requestId,
      ok: true,
      payload: {
        item,
      },
    };
  });
}

export async function handleSubTaskUpdateWithQueryRuntime(
  ctx: QueryRuntimeSubTaskContext,
  params: { taskId: string; message: string },
): Promise<GatewayResFrame> {
  const runtime = new QueryRuntime({
    method: "subtask.update" as const,
    traceId: ctx.requestId,
    observer: ctx.runtimeObserver,
  });

  return runtime.run(async (queryRuntime) => {
    queryRuntime.mark("runtime_checked", {
      detail: {
        hasStore: Boolean(ctx.subTaskRuntimeStore),
        hasUpdateHandler: Boolean(ctx.updateSubTask),
      },
    });

    if (!ctx.subTaskRuntimeStore || !ctx.updateSubTask) {
      queryRuntime.mark("completed", {
        detail: {
          code: "not_available",
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: "not_available", message: "Subtask steering not available" },
      };
    }

    queryRuntime.mark("request_validated", {
      detail: {
        taskId: params.taskId,
        messageChars: params.message.length,
      },
    });

    const current = await ctx.subTaskRuntimeStore.getTask(params.taskId);
    if (!current) {
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

    queryRuntime.mark("task_loaded", {
      conversationId: current.parentConversationId,
      detail: {
        taskId: current.id,
        status: current.status,
        sessionId: current.sessionId,
      },
    });

    let item: SubTaskRecord | undefined;
    try {
      item = await ctx.updateSubTask(params.taskId, params.message);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      queryRuntime.mark("completed", {
        conversationId: current.parentConversationId,
        detail: {
          taskId: current.id,
          code: "update_failed",
          error: errorMessage,
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: "update_failed", message: errorMessage },
      };
    }

    if (!item) {
      queryRuntime.mark("completed", {
        conversationId: current.parentConversationId,
        detail: {
          taskId: current.id,
          code: "update_failed",
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: "update_failed", message: `Failed to update subtask: ${params.taskId}` },
      };
    }

    queryRuntime.mark("task_updated", {
      conversationId: item.parentConversationId,
      detail: {
        taskId: item.id,
        status: item.status,
        steeringCount: item.steering.length,
      },
    });
    queryRuntime.mark("completed", {
      conversationId: item.parentConversationId,
      detail: {
        taskId: item.id,
      },
    });

    return {
      type: "res",
      id: ctx.requestId,
      ok: true,
      payload: {
        item,
      },
    };
  });
}

export async function handleSubTaskArchiveWithQueryRuntime(
  ctx: QueryRuntimeSubTaskContext,
  params: { taskId: string; reason?: string },
): Promise<GatewayResFrame> {
  const runtime = new QueryRuntime({
    method: "subtask.archive" as const,
    traceId: ctx.requestId,
    observer: ctx.runtimeObserver,
  });

  return runtime.run(async (queryRuntime) => {
    queryRuntime.mark("runtime_checked", {
      detail: {
        available: Boolean(ctx.subTaskRuntimeStore),
      },
    });

    if (!ctx.subTaskRuntimeStore) {
      queryRuntime.mark("completed", {
        detail: {
          code: "not_available",
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: "not_available", message: "Subtask archive not available" },
      };
    }

    queryRuntime.mark("request_validated", {
      detail: {
        taskId: params.taskId,
        hasReason: Boolean(params.reason),
      },
    });

    const current = await ctx.subTaskRuntimeStore.getTask(params.taskId);
    if (!current) {
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

    queryRuntime.mark("task_loaded", {
      conversationId: current.parentConversationId,
      detail: {
        taskId: current.id,
        status: current.status,
        archived: Boolean(current.archivedAt),
      },
    });

    if (current.status === "pending" || current.status === "running") {
      queryRuntime.mark("completed", {
        conversationId: current.parentConversationId,
        detail: {
          taskId: current.id,
          code: "invalid_state",
          status: current.status,
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: "invalid_state", message: `Cannot archive active subtask: ${current.status}` },
      };
    }

    const item = await ctx.subTaskRuntimeStore.archiveTask(params.taskId, params.reason);
    if (!item) {
      queryRuntime.mark("completed", {
        conversationId: current.parentConversationId,
        detail: {
          taskId: current.id,
          code: "archive_failed",
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: "archive_failed", message: `Failed to archive subtask: ${params.taskId}` },
      };
    }

    queryRuntime.mark("task_archived", {
      conversationId: item.parentConversationId,
      detail: {
        taskId: item.id,
        archivedAt: item.archivedAt,
      },
    });
    queryRuntime.mark("completed", {
      conversationId: item.parentConversationId,
      detail: {
        taskId: item.id,
      },
    });

    return {
      type: "res",
      id: ctx.requestId,
      ok: true,
      payload: {
        item,
      },
    };
  });
}
