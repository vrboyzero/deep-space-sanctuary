import type {
  AgentProfileCatalogMetadata,
  AgentMemoryMode,
  AgentWorkspaceBinding,
  SessionDigestRecord,
} from "@belldandy/agent";

import type { ResolvedResidentMemoryPolicy } from "./resident-memory-policy.js";
import type { ScopedMemoryManagerRecord } from "./resident-memory-managers.js";
import type { SubTaskRecord } from "./task-runtime.js";
import { buildAgentLaunchExplainability, type AgentLaunchExplainability } from "./agent-launch-explainability.js";
import { buildResidentContinuationState, type ContinuationStateSnapshot } from "./continuation-state.js";

type ResidentRecentTaskSummary = {
  taskId: string;
  title?: string;
  objective?: string;
  summary?: string;
  status: string;
  source: string;
  finishedAt?: string;
  toolNames: string[];
  artifactPaths: string[];
};

type ResidentRecentTaskDigest = {
  recentCount: number;
  latestTaskId: string;
  latestTitle: string;
  latestStatus: string;
  latestSource: string;
  latestFinishedAt?: string;
  headline: string;
};

type ResidentRecentSubtaskDigest = {
  recentCount: number;
  latestTaskId: string;
  latestSummary: string;
  latestStatus: string;
  latestUpdatedAt?: number;
  latestAgentId?: string;
  latestParentTaskId?: string;
  headline: string;
};

type ResidentExperienceUsageDigest = {
  usageCount: number;
  methodCount: number;
  skillCount: number;
  latestAssetType: "method" | "skill";
  latestAssetKey: string;
  latestTaskId?: string;
  latestUsedAt?: string;
  headline: string;
};

type SharedGovernanceCounts = {
  pendingCount: number;
  claimedCount?: number;
  approvedCount: number;
  rejectedCount: number;
  revokedCount: number;
  noneCount?: number;
};

type ConversationDigestReader = {
  getSessionDigest(
    conversationId: string,
    options?: { threshold?: number },
  ): Promise<SessionDigestRecord>;
};

type ResidentSubTaskReader = {
  listTasks(parentConversationId?: string, options?: { includeArchived?: boolean }): Promise<SubTaskRecord[]>;
};

export type ResidentAgentObservabilitySeed = {
  id: string;
  displayName: string;
  model: string;
  kind: "resident" | "worker";
  workspaceBinding: AgentWorkspaceBinding;
  sessionNamespace: string;
  memoryMode: AgentMemoryMode;
  status?: string;
  mainConversationId?: string;
  lastConversationId?: string;
  lastActiveAt?: number;
  catalog?: AgentProfileCatalogMetadata;
  memoryPolicy?: ResolvedResidentMemoryPolicy;
  sharedGovernance?: SharedGovernanceCounts;
};

export type ResidentAgentObservabilityItem = {
  id: string;
  displayName: string;
  model: string;
  kind: "resident";
  workspaceBinding: AgentWorkspaceBinding;
  sessionNamespace: string;
  memoryMode: AgentMemoryMode;
  status?: string;
  mainConversationId?: string;
  lastConversationId?: string;
  lastActiveAt?: number;
  catalog?: AgentProfileCatalogMetadata;
  memoryPolicy: ResolvedResidentMemoryPolicy;
  sharedGovernance?: SharedGovernanceCounts;
  conversationDigest?: {
    conversationId: string;
    status: SessionDigestRecord["status"];
    messageCount: number;
    pendingMessageCount: number;
    threshold: number;
    lastDigestAt: number;
  };
  recentTasks?: ResidentRecentTaskSummary[];
  recentTaskDigest?: ResidentRecentTaskDigest;
  recentSubtaskDigest?: ResidentRecentSubtaskDigest;
  experienceUsageDigest?: ResidentExperienceUsageDigest;
  continuationState?: ContinuationStateSnapshot;
  launchExplainability?: AgentLaunchExplainability;
  observabilityHeadline?: string;
  observabilityBadges?: string[];
  warnings?: string[];
};

export type ResidentAgentDoctorReport = {
  summary: {
    totalCount: number;
    activeCount: number;
    runningCount: number;
    idleCount: number;
    backgroundCount: number;
    errorCount: number;
    memoryModeCounts: Record<AgentMemoryMode, number>;
    workspaceBindingCounts: Record<AgentWorkspaceBinding, number>;
    writeTargetCounts: Record<"private" | "shared", number>;
    sharedReadEnabledCount: number;
    digestReadyCount: number;
    digestUpdatedCount: number;
    digestIdleCount: number;
    digestMissingCount: number;
    sharedGovernanceCounts: {
      pendingCount: number;
      claimedCount: number;
      approvedCount: number;
      rejectedCount: number;
      revokedCount: number;
    };
    recentTaskLinkedCount: number;
    recentSubtaskLinkedCount: number;
    experienceUsageLinkedCount: number;
    catalogAnnotatedCount: number;
    structuredHandoffCount: number;
    skillHintedCount: number;
    headline: string;
  };
  agents: ResidentAgentObservabilityItem[];
};

function buildSharedGovernanceCounts(record?: ScopedMemoryManagerRecord): SharedGovernanceCounts {
  if (!record || record.policy.writeTarget === "shared") {
    return createEmptySharedGovernanceCounts();
  }

  return {
    pendingCount: record.manager.countChunks({ sharedPromotionStatus: "pending" }),
    claimedCount: record.manager.countChunks({ sharedPromotionStatus: "pending", sharedPromotionClaimed: true }),
    approvedCount: record.manager.countChunks({ sharedPromotionStatus: "approved" }),
    rejectedCount: record.manager.countChunks({ sharedPromotionStatus: "rejected" }),
    revokedCount: record.manager.countChunks({ sharedPromotionStatus: "revoked" }),
    noneCount: record.manager.countChunks({ sharedPromotionStatus: "none" }),
  };
}

function createEmptySharedGovernanceCounts(): SharedGovernanceCounts {
  return {
    pendingCount: 0,
    claimedCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    revokedCount: 0,
    noneCount: 0,
  };
}

function readResidentManagerSnapshot<T>(
  warnings: string[],
  warningPrefix: string,
  read: () => T,
  fallback: T,
): T {
  try {
    return read();
  } catch (error) {
    warnings.push(`${warningPrefix}:${error instanceof Error ? error.message : String(error)}`);
    return fallback;
  }
}

function toConversationDigestView(digest: SessionDigestRecord | undefined) {
  if (!digest) return undefined;
  return {
    conversationId: digest.conversationId,
    status: digest.status,
    messageCount: digest.messageCount,
    pendingMessageCount: digest.pendingMessageCount,
    threshold: digest.threshold,
    lastDigestAt: digest.lastDigestAt,
  };
}

function summarizeRecentTaskLabel(task: ResidentRecentTaskSummary | undefined): string {
  const raw = task?.title || task?.objective || task?.summary || task?.taskId || "-";
  const normalized = raw.trim();
  return normalized.length > 56 ? `${normalized.slice(0, 53)}...` : normalized;
}

function collectUniqueNonEmptyStrings(values: Array<string | undefined>): string[] {
  return [...new Set(
    values
      .map((value) => typeof value === "string" ? value.trim() : "")
      .filter(Boolean),
  )];
}

function summarizeRecentSubtaskLabel(task: SubTaskRecord | undefined): string {
  const raw = task?.summary || task?.progress?.message || task?.instruction || task?.id || "-";
  const normalized = raw.trim();
  return normalized.length > 56 ? `${normalized.slice(0, 53)}...` : normalized;
}

function summarizeExperienceAssetLabel(rawValue: string | undefined): string {
  const normalized = String(rawValue ?? "").trim() || "-";
  return normalized.length > 48 ? `${normalized.slice(0, 45)}...` : normalized;
}

function toRecentTaskView(record: {
  taskId: string;
  title?: string;
  objective?: string;
  summary?: string;
  status: string;
  source: string;
  finishedAt?: string;
  toolNames: string[];
  artifactPaths: string[];
}): ResidentRecentTaskSummary {
  return {
    taskId: record.taskId,
    title: record.title,
    objective: record.objective,
    summary: record.summary,
    status: record.status,
    source: record.source,
    finishedAt: record.finishedAt,
    toolNames: Array.isArray(record.toolNames) ? record.toolNames : [],
    artifactPaths: Array.isArray(record.artifactPaths) ? record.artifactPaths : [],
  };
}

function buildRecentTaskDigest(recentTasks: ResidentRecentTaskSummary[]): ResidentRecentTaskDigest | undefined {
  if (recentTasks.length <= 0) return undefined;
  const latest = recentTasks[0];
  return {
    recentCount: recentTasks.length,
    latestTaskId: latest.taskId,
    latestTitle: summarizeRecentTaskLabel(latest),
    latestStatus: latest.status,
    latestSource: latest.source,
    latestFinishedAt: latest.finishedAt,
    headline: `${recentTasks.length} recent, latest=${summarizeRecentTaskLabel(latest)} (${latest.status})`,
  };
}

function buildRecentSubtaskDigest(recentSubtasks: SubTaskRecord[]): ResidentRecentSubtaskDigest | undefined {
  if (recentSubtasks.length <= 0) return undefined;
  const latest = recentSubtasks[0];
  return {
    recentCount: recentSubtasks.length,
    latestTaskId: latest.id,
    latestSummary: summarizeRecentSubtaskLabel(latest),
    latestStatus: latest.status,
    latestUpdatedAt: latest.updatedAt,
    latestAgentId: latest.agentId,
    latestParentTaskId: latest.launchSpec.parentTaskId,
    headline: `${recentSubtasks.length} recent, latest=${summarizeRecentSubtaskLabel(latest)} (${latest.status})`,
  };
}

function buildExperienceUsageDigest(
  recentUsages: Array<{
    taskId: string;
    assetType: "method" | "skill";
    assetKey: string;
    createdAt: string;
  }>,
): ResidentExperienceUsageDigest | undefined {
  if (recentUsages.length <= 0) return undefined;
  const latest = recentUsages[0];
  const methodKeys = new Set<string>();
  const skillKeys = new Set<string>();

  for (const item of recentUsages) {
    if (item.assetType === "method") {
      methodKeys.add(item.assetKey);
    } else if (item.assetType === "skill") {
      skillKeys.add(item.assetKey);
    }
  }

  return {
    usageCount: recentUsages.length,
    methodCount: methodKeys.size,
    skillCount: skillKeys.size,
    latestAssetType: latest.assetType,
    latestAssetKey: summarizeExperienceAssetLabel(latest.assetKey),
    latestTaskId: latest.taskId,
    latestUsedAt: latest.createdAt,
    headline: `${recentUsages.length} recent, method=${methodKeys.size}, skill=${skillKeys.size}, latest=${summarizeExperienceAssetLabel(latest.assetKey)}`,
  };
}

function buildAgentObservabilityBadges(
  agent: ResidentAgentObservabilitySeed,
  digest: SessionDigestRecord | undefined,
  sharedGovernance: SharedGovernanceCounts | undefined,
  recentTaskDigest: ResidentRecentTaskDigest | undefined,
  recentSubtaskDigest: ResidentRecentSubtaskDigest | undefined,
  experienceUsageDigest: ResidentExperienceUsageDigest | undefined,
): string[] {
  const badges = [
    `mode:${agent.memoryMode}`,
    `write:${agent.memoryPolicy?.writeTarget ?? "unknown"}`,
  ];
  if (agent.catalog?.handoffStyle) {
    badges.push(`handoff:${agent.catalog.handoffStyle}`);
  }
  if ((agent.catalog?.methods?.length ?? 0) > 0) {
    badges.push(`methods:${agent.catalog?.methods?.length ?? 0}`);
  }
  if ((agent.catalog?.skills?.length ?? 0) > 0) {
    badges.push(`skills:${agent.catalog?.skills?.length ?? 0}`);
  }

  if (agent.status && agent.status !== "idle") {
    badges.unshift(`status:${agent.status}`);
  }

  if (digest) {
    badges.push(`digest:${digest.status}`);
    if (digest.pendingMessageCount > 0) {
      badges.push(`pending:${digest.pendingMessageCount}`);
    }
  }

  if ((sharedGovernance?.pendingCount ?? 0) > 0) {
    badges.push(`review:${sharedGovernance?.pendingCount ?? 0}`);
  }
  if ((sharedGovernance?.claimedCount ?? 0) > 0) {
    badges.push(`claimed:${sharedGovernance?.claimedCount ?? 0}`);
  }
  if ((recentTaskDigest?.recentCount ?? 0) > 0) {
    badges.push(`task:${recentTaskDigest?.recentCount ?? 0}`);
  }
  if ((recentSubtaskDigest?.recentCount ?? 0) > 0) {
    badges.push(`subtask:${recentSubtaskDigest?.recentCount ?? 0}`);
  }
  if ((experienceUsageDigest?.usageCount ?? 0) > 0) {
    badges.push(`usage:${experienceUsageDigest?.usageCount ?? 0}`);
  }

  return badges;
}

function buildAgentObservabilityHeadline(
  agent: ResidentAgentObservabilitySeed,
  digest: SessionDigestRecord | undefined,
  sharedGovernance: SharedGovernanceCounts | undefined,
  recentTaskDigest: ResidentRecentTaskDigest | undefined,
  recentSubtaskDigest: ResidentRecentSubtaskDigest | undefined,
  experienceUsageDigest: ResidentExperienceUsageDigest | undefined,
): string {
  const pieces = [
    agent.memoryMode,
    `write=${agent.memoryPolicy?.writeTarget ?? "unknown"}`,
    `read=${Array.isArray(agent.memoryPolicy?.readTargets) ? agent.memoryPolicy.readTargets.join("+") : "-"}`,
    `session=${agent.sessionNamespace || "-"}`,
  ];
  if (agent.catalog?.defaultRole) {
    pieces.push(`role=${agent.catalog.defaultRole}`);
  }
  if (agent.catalog?.defaultPermissionMode) {
    pieces.push(`permission=${agent.catalog.defaultPermissionMode}`);
  }
  if (agent.catalog?.handoffStyle) {
    pieces.push(`handoff=${agent.catalog.handoffStyle}`);
  }
  if ((agent.catalog?.methods?.length ?? 0) > 0) {
    pieces.push(`methods=${agent.catalog?.methods?.length ?? 0}`);
  }
  if ((agent.catalog?.skills?.length ?? 0) > 0) {
    pieces.push(`skills=${agent.catalog?.skills?.length ?? 0}`);
  }

  if (agent.status) {
    pieces.push(`status=${agent.status}`);
  }
  if (digest) {
    pieces.push(`digest=${digest.status}`);
    pieces.push(`messages=${digest.messageCount}`);
    pieces.push(`pending=${digest.pendingMessageCount}`);
  }
  if ((sharedGovernance?.pendingCount ?? 0) > 0 || (sharedGovernance?.claimedCount ?? 0) > 0) {
    pieces.push(`review=p${sharedGovernance?.pendingCount ?? 0}/c${sharedGovernance?.claimedCount ?? 0}`);
  }
  if (recentTaskDigest) {
    pieces.push(`tasks=${recentTaskDigest.recentCount}`);
    pieces.push(`latest-task=${recentTaskDigest.latestTitle}`);
  }
  if (recentSubtaskDigest) {
    pieces.push(`subtasks=${recentSubtaskDigest.recentCount}`);
    pieces.push(`latest-subtask=${recentSubtaskDigest.latestSummary}`);
  }
  if (experienceUsageDigest) {
    pieces.push(`usage=m${experienceUsageDigest.methodCount}/s${experienceUsageDigest.skillCount}`);
    pieces.push(`latest-usage=${experienceUsageDigest.latestAssetKey}`);
  }

  return pieces.join(", ");
}

export async function buildResidentAgentObservabilitySnapshot(input: {
  agents: ResidentAgentObservabilitySeed[];
  residentMemoryManagers?: ScopedMemoryManagerRecord[];
  conversationStore?: ConversationDigestReader;
  subTaskRuntimeStore?: ResidentSubTaskReader;
}): Promise<ResidentAgentDoctorReport> {
  const managerByAgentId = new Map(
    (input.residentMemoryManagers ?? []).map((record) => [record.agentId, record] as const),
  );
  const conversationStoreAvailable = Boolean(input.conversationStore);

  const enriched = await Promise.all(input.agents.map(async (agent) => {
    if (agent.kind !== "resident") return undefined;
    const managerRecord = managerByAgentId.get(agent.id);
    const memoryPolicy = agent.memoryPolicy ?? managerRecord?.policy;
    if (!memoryPolicy) return undefined;

    let digest: SessionDigestRecord | undefined;
    const warnings: string[] = [];
    const digestConversationId = agent.mainConversationId || agent.lastConversationId;
    if (input.conversationStore && digestConversationId) {
      try {
        digest = await input.conversationStore.getSessionDigest(digestConversationId);
      } catch (error) {
        warnings.push(`digest-unavailable:${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (conversationStoreAvailable) {
      warnings.push("digest-unavailable:missing-conversation-id");
    }

    const sharedGovernance = agent.sharedGovernance ?? readResidentManagerSnapshot(
      warnings,
      "shared-governance-unavailable",
      () => buildSharedGovernanceCounts(managerRecord),
      createEmptySharedGovernanceCounts(),
    );
    const recentTasks = managerRecord
      ? readResidentManagerSnapshot(
        warnings,
        "recent-task-unavailable",
        () => managerRecord.manager.getRecentTasks(12)
          .filter((item) => (!item.agentId || item.agentId === agent.id) && (item.status === "success" || item.status === "partial"))
          .slice(0, 3)
          .map((item) => toRecentTaskView({
            taskId: item.id,
            title: item.title,
            objective: item.objective,
            summary: item.summary,
            status: item.status,
            source: item.source,
            finishedAt: item.finishedAt,
            toolNames: Array.isArray(item.toolCalls) ? item.toolCalls.map((call) => call.toolName).filter(Boolean) : [],
            artifactPaths: Array.isArray(item.artifactPaths) ? item.artifactPaths : [],
          })),
        [],
      )
      : [];
    const recentTaskDigest = buildRecentTaskDigest(recentTasks);
    let recentSubtaskDigest: ResidentRecentSubtaskDigest | undefined;
    if (input.subTaskRuntimeStore) {
      const parentConversationIds = collectUniqueNonEmptyStrings([
        agent.mainConversationId,
        agent.lastConversationId,
      ]);
      if (parentConversationIds.length > 0) {
        try {
          const recentSubtasks = [
            ...new Map(
              (await Promise.all(
                parentConversationIds.map((conversationId) => input.subTaskRuntimeStore!.listTasks(conversationId, {
                  includeArchived: false,
                })),
              ))
                .flat()
                .sort((left, right) => {
                  const leftSort = Number(left.updatedAt || left.createdAt || 0);
                  const rightSort = Number(right.updatedAt || right.createdAt || 0);
                  return rightSort - leftSort;
                })
                .map((item) => [item.id, item] as const),
            ).values(),
          ].slice(0, 3);
          recentSubtaskDigest = buildRecentSubtaskDigest(recentSubtasks);
        } catch (error) {
          warnings.push(`subtask-unavailable:${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        warnings.push("subtask-unavailable:missing-conversation-id");
      }
    }

    const experienceUsages = managerRecord
      ? readResidentManagerSnapshot(
        warnings,
        "experience-usage-unavailable",
        () => managerRecord.manager.listExperienceUsages(24)
          .filter((item) => {
            const task = managerRecord.manager.getTask(item.taskId);
            return !task?.agentId || task.agentId === agent.id;
          })
          .map((item) => ({
            taskId: item.taskId,
            assetType: item.assetType,
            assetKey: item.assetKey,
            createdAt: item.createdAt,
          })),
        [],
      )
      : [];
    const experienceUsageDigest = buildExperienceUsageDigest(experienceUsages);
    if ((sharedGovernance.pendingCount ?? 0) > 0) {
      warnings.push(`shared-review-pending:${sharedGovernance.pendingCount}`);
    }
    if (digest?.status === "updated") {
      warnings.push(`digest-refresh-recommended:${digest.pendingMessageCount}`);
    }
    if (recentTaskDigest) {
      warnings.push(`recent-task:${recentTaskDigest.latestStatus}`);
    }
    if (recentSubtaskDigest) {
      warnings.push(`recent-subtask:${recentSubtaskDigest.latestStatus}`);
    }
    if (experienceUsageDigest) {
      warnings.push(`experience-usage:${experienceUsageDigest.latestAssetType}`);
    }
    if (agent.status === "error") {
      warnings.push("runtime-error");
    }

    return {
      ...agent,
      kind: "resident" as const,
      ...(agent.catalog ? { catalog: agent.catalog } : {}),
      memoryPolicy,
      sharedGovernance,
      conversationDigest: toConversationDigestView(digest),
      ...(recentTasks.length > 0 ? { recentTasks } : {}),
      ...(recentTaskDigest ? { recentTaskDigest } : {}),
      ...(recentSubtaskDigest ? { recentSubtaskDigest } : {}),
      ...(experienceUsageDigest ? { experienceUsageDigest } : {}),
      continuationState: buildResidentContinuationState({
        agentId: agent.id,
        status: agent.status,
        mainConversationId: agent.mainConversationId,
        lastConversationId: agent.lastConversationId,
        lastActiveAt: agent.lastActiveAt,
        sharedGovernance,
        recentTaskDigest,
        recentSubtaskDigest,
        experienceUsageDigest,
      }),
      launchExplainability: buildAgentLaunchExplainability({
        agentId: agent.id,
        profileId: agent.id,
        catalog: agent.catalog,
      }),
      observabilityHeadline: buildAgentObservabilityHeadline(
        { ...agent, memoryPolicy },
        digest,
        sharedGovernance,
        recentTaskDigest,
        recentSubtaskDigest,
        experienceUsageDigest,
      ),
      observabilityBadges: buildAgentObservabilityBadges(
        { ...agent, memoryPolicy },
        digest,
        sharedGovernance,
        recentTaskDigest,
        recentSubtaskDigest,
        experienceUsageDigest,
      ),
      warnings,
    } satisfies ResidentAgentObservabilityItem;
  }));
  const agents = enriched.filter(Boolean) as ResidentAgentObservabilityItem[];

  return buildResidentAgentDoctorReport({
    agents,
    conversationStoreAvailable,
  });
}

export function buildResidentAgentDoctorReport(input: {
  agents: ResidentAgentObservabilityItem[];
  conversationStoreAvailable?: boolean;
}): ResidentAgentDoctorReport {
  const memoryModeCounts: Record<AgentMemoryMode, number> = {
    isolated: 0,
    shared: 0,
    hybrid: 0,
  };
  const workspaceBindingCounts: Record<AgentWorkspaceBinding, number> = {
    current: 0,
    custom: 0,
  };
  const writeTargetCounts: Record<"private" | "shared", number> = {
    private: 0,
    shared: 0,
  };

  let activeCount = 0;
  let runningCount = 0;
  let idleCount = 0;
  let backgroundCount = 0;
  let errorCount = 0;
  let sharedReadEnabledCount = 0;
  let digestReadyCount = 0;
  let digestUpdatedCount = 0;
  let digestIdleCount = 0;
  let digestMissingCount = 0;
  let recentTaskLinkedCount = 0;
  let recentSubtaskLinkedCount = 0;
  let experienceUsageLinkedCount = 0;
  let catalogAnnotatedCount = 0;
  let structuredHandoffCount = 0;
  let skillHintedCount = 0;
  const sharedGovernanceCounts = {
    pendingCount: 0,
    claimedCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    revokedCount: 0,
  };

  for (const agent of input.agents) {
    memoryModeCounts[agent.memoryMode] += 1;
    workspaceBindingCounts[agent.workspaceBinding] += 1;
    writeTargetCounts[agent.memoryPolicy.writeTarget] += 1;
    if (agent.status === "running") {
      activeCount += 1;
      runningCount += 1;
    } else if (agent.status === "background") {
      activeCount += 1;
      backgroundCount += 1;
    } else if (agent.status === "error") {
      errorCount += 1;
    } else {
      idleCount += 1;
    }
    if (agent.memoryPolicy.includeSharedMemoryReads) {
      sharedReadEnabledCount += 1;
    }
    if (agent.conversationDigest) {
      if (agent.conversationDigest.status === "ready") {
        digestReadyCount += 1;
      } else if (agent.conversationDigest.status === "updated") {
        digestUpdatedCount += 1;
      } else {
        digestIdleCount += 1;
      }
    } else if (input.conversationStoreAvailable) {
      digestMissingCount += 1;
    }
    if ((agent.recentTaskDigest?.recentCount ?? 0) > 0) {
      recentTaskLinkedCount += 1;
    }
    if ((agent.recentSubtaskDigest?.recentCount ?? 0) > 0) {
      recentSubtaskLinkedCount += 1;
    }
    if ((agent.experienceUsageDigest?.usageCount ?? 0) > 0) {
      experienceUsageLinkedCount += 1;
    }
    if ((agent.catalog?.whenToUse?.length ?? 0) > 0 || (agent.catalog?.skills?.length ?? 0) > 0) {
      catalogAnnotatedCount += 1;
    }
    if (agent.catalog?.handoffStyle === "structured") {
      structuredHandoffCount += 1;
    }
    if ((agent.catalog?.skills?.length ?? 0) > 0) {
      skillHintedCount += 1;
    }
    sharedGovernanceCounts.pendingCount += agent.sharedGovernance?.pendingCount ?? 0;
    sharedGovernanceCounts.claimedCount += agent.sharedGovernance?.claimedCount ?? 0;
    sharedGovernanceCounts.approvedCount += agent.sharedGovernance?.approvedCount ?? 0;
    sharedGovernanceCounts.rejectedCount += agent.sharedGovernance?.rejectedCount ?? 0;
    sharedGovernanceCounts.revokedCount += agent.sharedGovernance?.revokedCount ?? 0;
  }

  const totalCount = input.agents.length;
  const headline = [
    `${totalCount} resident agent(s)`,
    `active=${activeCount}`,
    `isolated=${memoryModeCounts.isolated}`,
    `shared=${memoryModeCounts.shared}`,
    `hybrid=${memoryModeCounts.hybrid}`,
    `running=${runningCount}`,
    `background=${backgroundCount}`,
    `idle=${idleCount}`,
    `digest-ready=${digestReadyCount}`,
    `digest-updated=${digestUpdatedCount}`,
    `catalog-annotated=${catalogAnnotatedCount}`,
    `structured-handoff=${structuredHandoffCount}`,
    `task-linked=${recentTaskLinkedCount}`,
    `subtask-linked=${recentSubtaskLinkedCount}`,
    `usage-linked=${experienceUsageLinkedCount}`,
  ].join(", ");

  return {
    summary: {
      totalCount,
      activeCount,
      runningCount,
      idleCount,
      backgroundCount,
      errorCount,
      memoryModeCounts,
      workspaceBindingCounts,
      writeTargetCounts,
      sharedReadEnabledCount,
      digestReadyCount,
      digestUpdatedCount,
      digestIdleCount,
      digestMissingCount,
      sharedGovernanceCounts,
      recentTaskLinkedCount,
      recentSubtaskLinkedCount,
      experienceUsageLinkedCount,
      catalogAnnotatedCount,
      structuredHandoffCount,
      skillHintedCount,
      headline,
    },
    agents: input.agents,
  };
}
