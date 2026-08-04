import type {
  DelegationAcceptance,
  DelegationAggregationMode,
  DelegationDeliverableContract,
  DelegationDeliverableFormat,
  DelegationIntentKind,
  DelegationOwnership,
  DelegationProtocol,
  DelegationSource,
  DelegationTeamMember,
  DelegationTeamMode,
} from "@belldandy/skills";

export type SubTaskDelegationSummary = {
  source: DelegationSource;
  intentKind: DelegationIntentKind;
  intentSummary: string;
  role?: DelegationProtocol["intent"]["role"];
  expectedDeliverableFormat: DelegationDeliverableFormat;
  expectedDeliverableSummary: string;
  aggregationMode: DelegationAggregationMode;
  contextKeys: string[];
  sourceAgentIds?: string[];
  goalId?: string;
  nodeId?: string;
  planId?: string;
  ownership?: {
    scopeSummary: string;
    outOfScope?: string[];
    writeScope?: string[];
  };
  acceptance?: {
    doneDefinition: string;
    verificationHints?: string[];
  };
  deliverableContract?: {
    format: DelegationDeliverableFormat;
    summary?: string;
    requiredSections?: string[];
  };
  launchDefaults?: {
    permissionMode?: string;
    allowedToolFamilies?: string[];
    maxToolRiskLevel?: "low" | "medium" | "high" | "critical";
  };
  team?: {
    id: string;
    mode: DelegationTeamMode;
    sharedGoal?: string;
    managerAgentId?: string;
    managerIdentityLabel?: string;
    currentLaneId?: string;
    memberRoster: Array<{
      laneId: string;
      agentId?: string;
      role?: DelegationTeamMember["role"];
      identityLabel?: string;
      authorityRelationToManager?: DelegationTeamMember["authorityRelationToManager"];
      reportsTo?: string[];
      mayDirect?: string[];
      scopeSummary?: string;
      dependsOn?: string[];
      handoffTo?: string[];
    }>;
  };
};

export type SubTaskResultEnvelope = {
  taskId: string;
  sessionId?: string;
  agentId: string;
  status: "pending" | "running" | "done" | "error" | "timeout" | "stopped" | "interrupted";
  summary: string;
  outputPath?: string;
  outputPreview?: string;
  error?: string;
  finishedAt?: number;
};

export type DelegationObservabilitySnapshot = {
  summary: {
    totalCount: number;
    protocolBackedCount: number;
    completedCount: number;
    activeCount: number;
    sourceCounts: Record<string, number>;
    aggregationModeCounts: Record<string, number>;
    headline: string;
  };
  items: Array<{
    taskId: string;
    agentId: string;
    status: string;
    source?: DelegationSource;
    aggregationMode?: DelegationAggregationMode;
    expectedDeliverableFormat?: DelegationDeliverableFormat;
    expectedDeliverableSummary?: string;
    intentSummary?: string;
  }>;
};

export function summarizeDelegationProtocol(protocol: DelegationProtocol | undefined): SubTaskDelegationSummary | undefined {
  if (!protocol) return undefined;
  return {
    source: protocol.source,
    intentKind: protocol.intent.kind,
    intentSummary: protocol.intent.summary,
    role: protocol.intent.role,
    expectedDeliverableFormat: protocol.expectedDeliverable.format,
    expectedDeliverableSummary: protocol.expectedDeliverable.summary,
    aggregationMode: protocol.aggregationPolicy.mode,
    contextKeys: [...protocol.contextPolicy.contextKeys],
    sourceAgentIds: protocol.aggregationPolicy.sourceAgentIds
      ? [...protocol.aggregationPolicy.sourceAgentIds]
      : undefined,
    goalId: protocol.intent.goalId,
    nodeId: protocol.intent.nodeId,
    planId: protocol.intent.planId,
    ownership: cloneDelegationOwnership(protocol.ownership),
    acceptance: cloneDelegationAcceptance(protocol.acceptance),
    deliverableContract: cloneDelegationDeliverableContract(protocol.deliverableContract),
    launchDefaults: {
      permissionMode: protocol.launchDefaults.permissionMode,
      allowedToolFamilies: protocol.launchDefaults.allowedToolFamilies
        ? [...protocol.launchDefaults.allowedToolFamilies]
        : undefined,
      maxToolRiskLevel: protocol.launchDefaults.maxToolRiskLevel,
    },
    team: cloneDelegationTeam(protocol.team),
  };
}

function cloneDelegationOwnership(value: DelegationOwnership | undefined): SubTaskDelegationSummary["ownership"] {
  if (!value) return undefined;
  return {
    scopeSummary: value.scopeSummary,
    ...(value.outOfScope && value.outOfScope.length > 0 ? { outOfScope: [...value.outOfScope] } : {}),
    ...(value.writeScope && value.writeScope.length > 0 ? { writeScope: [...value.writeScope] } : {}),
  };
}

function cloneDelegationAcceptance(value: DelegationAcceptance | undefined): SubTaskDelegationSummary["acceptance"] {
  if (!value) return undefined;
  return {
    doneDefinition: value.doneDefinition,
    ...(value.verificationHints && value.verificationHints.length > 0
      ? { verificationHints: [...value.verificationHints] }
      : {}),
  };
}

function cloneDelegationDeliverableContract(
  value: DelegationDeliverableContract | undefined,
): SubTaskDelegationSummary["deliverableContract"] {
  if (!value) return undefined;
  return {
    format: value.format,
    ...(value.summary ? { summary: value.summary } : {}),
    ...(value.requiredSections && value.requiredSections.length > 0
      ? { requiredSections: [...value.requiredSections] }
      : {}),
  };
}

function cloneDelegationTeam(
  value: DelegationProtocol["team"] | undefined,
): SubTaskDelegationSummary["team"] {
  if (!value) return undefined;
  return {
    id: value.id,
    mode: value.mode,
    ...(value.sharedGoal ? { sharedGoal: value.sharedGoal } : {}),
    ...(value.managerAgentId ? { managerAgentId: value.managerAgentId } : {}),
    ...(value.managerIdentityLabel ? { managerIdentityLabel: value.managerIdentityLabel } : {}),
    ...(value.currentLaneId ? { currentLaneId: value.currentLaneId } : {}),
    memberRoster: value.memberRoster.map((member) => ({
      laneId: member.laneId,
      ...(member.agentId ? { agentId: member.agentId } : {}),
      ...(member.role ? { role: member.role } : {}),
      ...(member.identityLabel ? { identityLabel: member.identityLabel } : {}),
      ...(member.authorityRelationToManager ? { authorityRelationToManager: member.authorityRelationToManager } : {}),
      ...(member.reportsTo && member.reportsTo.length > 0 ? { reportsTo: [...member.reportsTo] } : {}),
      ...(member.mayDirect && member.mayDirect.length > 0 ? { mayDirect: [...member.mayDirect] } : {}),
      ...(member.scopeSummary ? { scopeSummary: member.scopeSummary } : {}),
      ...(member.dependsOn && member.dependsOn.length > 0 ? { dependsOn: [...member.dependsOn] } : {}),
      ...(member.handoffTo && member.handoffTo.length > 0 ? { handoffTo: [...member.handoffTo] } : {}),
    })),
  };
}

export function buildSubTaskResultEnvelope(record: {
  id: string;
  sessionId?: string;
  agentId: string;
  status: "pending" | "running" | "done" | "error" | "timeout" | "stopped" | "interrupted";
  summary: string;
  outputPath?: string;
  outputPreview?: string;
  error?: string;
  finishedAt?: number;
}): SubTaskResultEnvelope {
  return {
    taskId: record.id,
    sessionId: record.sessionId,
    agentId: record.agentId,
    status: record.status,
    summary: record.summary || record.outputPreview || record.error || "-",
    outputPath: record.outputPath,
    outputPreview: record.outputPreview,
    error: record.error,
    finishedAt: record.finishedAt,
  };
}

export function buildDelegationObservabilitySnapshot(items: Array<{
  id: string;
  agentId: string;
  status: "pending" | "running" | "done" | "error" | "timeout" | "stopped" | "interrupted";
  launchSpec?: {
    delegation?: SubTaskDelegationSummary;
  };
}>): DelegationObservabilitySnapshot {
  const sourceCounts: Record<string, number> = {};
  const aggregationModeCounts: Record<string, number> = {};
  let protocolBackedCount = 0;
  let completedCount = 0;
  let activeCount = 0;

  for (const item of items) {
    if (item.status === "done" || item.status === "error" || item.status === "timeout" || item.status === "stopped" || item.status === "interrupted") {
      completedCount += 1;
    } else {
      activeCount += 1;
    }
    const delegation = item.launchSpec?.delegation;
    if (!delegation) continue;
    protocolBackedCount += 1;
    sourceCounts[delegation.source] = (sourceCounts[delegation.source] ?? 0) + 1;
    aggregationModeCounts[delegation.aggregationMode] = (aggregationModeCounts[delegation.aggregationMode] ?? 0) + 1;
  }

  const sourceSummary = Object.entries(sourceCounts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([key, count]) => `${key}:${count}`)
    .join(", ");

  return {
    summary: {
      totalCount: items.length,
      protocolBackedCount,
      completedCount,
      activeCount,
      sourceCounts,
      aggregationModeCounts,
      headline: protocolBackedCount > 0
        ? `delegation protocol=${protocolBackedCount}/${items.length || 0}; active=${activeCount}; completed=${completedCount}${sourceSummary ? `; sources=${sourceSummary}` : ""}`
        : `no protocol-backed subtasks observed; active=${activeCount}; completed=${completedCount}`,
    },
    items: items
      .slice()
      .sort((left, right) => {
        const leftDone = left.status === "done" || left.status === "error" || left.status === "timeout" || left.status === "stopped" || left.status === "interrupted";
        const rightDone = right.status === "done" || right.status === "error" || right.status === "timeout" || right.status === "stopped" || right.status === "interrupted";
        if (leftDone !== rightDone) return leftDone ? 1 : -1;
        return left.id.localeCompare(right.id);
      })
      .slice(0, 8)
      .map((item) => ({
        taskId: item.id,
        agentId: item.agentId,
        status: item.status,
        source: item.launchSpec?.delegation?.source,
        aggregationMode: item.launchSpec?.delegation?.aggregationMode,
        expectedDeliverableFormat: item.launchSpec?.delegation?.expectedDeliverableFormat,
        expectedDeliverableSummary: item.launchSpec?.delegation?.expectedDeliverableSummary,
        intentSummary: item.launchSpec?.delegation?.intentSummary,
      })),
  };
}
