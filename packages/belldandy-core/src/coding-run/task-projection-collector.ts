import type { WorkflowRuntimeCapabilities } from "@belldandy/skills";

import type { ConversationRunListItem } from "../conversation-run-registry.js";
import type { GoalStatus } from "../goals/types.js";
import type { SubTaskKind, SubTaskStatus } from "../task-runtime.js";
import type { UserWorktreeLifecycleEvidence, UserWorktreeOwner, UserWorktreeStatus } from "../user-worktree-runtime.js";
import type { PendingToolPermissionSnapshot } from "./pending-tool-permission-runtime.js";
import type { TaskCapabilityClosureResolver } from "./task-capability-closure.js";
import { createUnknownTaskCapabilityClosure } from "./task-capability-closure.js";
import type { CodingRunReconciliation, CodingRunReconciliationJournalOwner } from "./reconciliation-journal.js";
import {
  createConversationCodingRunView,
  createGoalCodingRunView,
  createSubtaskCodingRunView,
  createWorkflowActiveCodingRunView,
} from "./source-adapters.js";
import {
  type TaskCapabilityClosure,
  type TaskProjectionInput,
  type TaskProjectionSupportingEvidence,
} from "./task-projection.js";

type GoalListItem = {
  id: string;
  status: GoalStatus;
  activeConversationId?: string;
  lastRunId?: string;
  updatedAt: string;
};

type SubtaskListItem = {
  id: string;
  sessionId?: string;
  parentConversationId: string;
  kind: SubTaskKind;
  status: SubTaskStatus;
  progress: { phase: SubTaskStatus };
  updatedAt: number;
  archivedAt?: number;
  outputPath?: string;
  scratchPath?: string;
  reviewPath?: string;
  bridgeSessionRuntime?: { state: "active" | "closed" | "runtime-lost" | "orphaned" };
  recovery?: {
    state: "runtime_lost";
    previousStatus: "pending" | "running";
    detectedAt: number;
    mutationReplay: "forbidden";
  };
  launchSpec: {
    role?: "default" | "commander" | "coder" | "researcher" | "verifier";
    worktreePath?: string;
  };
};

export type TaskProjectionCollectorContext = {
  conversationRunRegistry?: { listActiveRuns: () => ConversationRunListItem[] };
  goalManager?: { listGoals: (options?: { includeArchived?: boolean }) => Promise<GoalListItem[]> };
  subTaskRuntimeStore?: { listTasks: (parentConversationId?: string, options?: { includeArchived?: boolean }) => Promise<SubtaskListItem[]> };
  workflowRuntime?: Pick<WorkflowRuntimeCapabilities, "listActiveRuns" | "getStatusByRunId">;
  userWorktreeRuntime?: {
    listStatus: () => Promise<UserWorktreeStatus[]>;
    readLifecycleEvidence?: (owner: UserWorktreeOwner) => Promise<UserWorktreeLifecycleEvidence | undefined>;
  };
  reconciliationJournal?: Pick<CodingRunReconciliationJournalOwner, "reconcile">;
  pendingToolPermissionRuntime?: { list: () => PendingToolPermissionSnapshot[] };
  taskCapabilityClosureResolver?: TaskCapabilityClosureResolver;
  resolveCapabilityClosure?: (input: {
    taskId: string;
    source: "conversation" | "goal" | "workflow" | "subtask";
    agentRunId: string;
  }) => TaskCapabilityClosure | undefined;
  now?: () => number;
};

/** 从既有 owner 拉取无正文状态；单个可选 owner 失败时不伪造其任务。 */
export async function collectTaskProjectionSources(
  ctx: TaskProjectionCollectorContext,
): Promise<TaskProjectionInput[]> {
  const now = ctx.now ?? Date.now;
  const [goals, subtasks, worktrees] = await Promise.all([
    ctx.goalManager?.listGoals({ includeArchived: true }).catch(() => []) ?? [],
    ctx.subTaskRuntimeStore?.listTasks(undefined, { includeArchived: true }).catch(() => []) ?? [],
    ctx.userWorktreeRuntime?.listStatus().catch(() => []) ?? [],
  ]);
  const worktreesByRun = indexWorktrees(worktrees);
  const pendingApprovalBindings = readPendingApprovalBindings(ctx.pendingToolPermissionRuntime);
  const sources: TaskProjectionInput[] = [];
  const conversations = ctx.conversationRunRegistry?.listActiveRuns() ?? [];
  const worktreeLifecycleByRun = await readWorktreeLifecycleEvidence(ctx.userWorktreeRuntime, conversations, now);

  for (const handle of conversations) {
    const taskId = `conversation:${handle.conversationId}:${handle.runId}`;
    const view = createConversationCodingRunView({ handle });
    if (pendingApprovalBindings.has(`${handle.conversationId}\0${handle.runId}`)) {
      view.status = "awaiting_review";
    }
    const supportingEvidence = {
      ...toWorktreeEvidence(
        worktreesByRun.get(`${handle.conversationId}\0${handle.runId}`),
        worktreeLifecycleByRun.get(`${handle.conversationId}\0${handle.runId}`),
      ),
      ...await readJournalEvidence(ctx.reconciliationJournal, {
        conversationId: handle.conversationId,
        agentRunId: handle.runId,
      }, now()),
    };
    sources.push({
      taskId,
      view,
      observedAtMs: Math.max(handle.startedAt, handle.stopRequestedAt ?? 0),
      capabilityClosure: resolveClosure(ctx, taskId, "conversation", handle.runId, now()),
      ...(Object.keys(supportingEvidence).length > 0 ? { supportingEvidence } : {}),
    });
  }

  for (const goal of goals) {
    if (!goal.lastRunId?.trim()) continue;
    const taskId = `goal:${goal.id}`;
    sources.push({
      taskId,
      view: createGoalCodingRunView({ goal, runId: goal.lastRunId }),
      observedAtMs: toTimestamp(goal.updatedAt),
      capabilityClosure: resolveClosure(ctx, taskId, "goal", goal.lastRunId, now()),
    });
  }

  for (const run of ctx.workflowRuntime?.listActiveRuns?.() ?? []) {
    if (run.status !== "running" && run.status !== "stopping") continue;
    const taskId = `workflow:${run.workflowRunId}`;
    sources.push({
      taskId,
      view: createWorkflowActiveCodingRunView({
        workflowRunId: run.workflowRunId,
        journalId: run.journalId,
        status: run.status,
        startedAtMs: run.startedAt,
      }),
      observedAtMs: Math.max(0, Math.trunc(run.startedAt)),
      capabilityClosure: resolveClosure(ctx, taskId, "workflow", run.workflowRunId, now()),
    });
  }

  for (const record of subtasks) {
    if (!record.id.trim()) continue;
    const view = createSubtaskCodingRunView({ record });
    const taskId = `subtask:${record.id}`;
    sources.push({
      taskId,
      view,
      observedAtMs: Math.max(0, Math.trunc(record.updatedAt)),
      capabilityClosure: resolveClosure(ctx, taskId, "subtask", view.binding.agentRunId, now()),
    });
  }

  return sources;
}

function resolveClosure(
  ctx: TaskProjectionCollectorContext,
  taskId: string,
  source: "conversation" | "goal" | "workflow" | "subtask",
  agentRunId: string,
  evaluatedAtMs: number,
): TaskCapabilityClosure {
  return ctx.resolveCapabilityClosure?.({ taskId, source, agentRunId })
    ?? ctx.taskCapabilityClosureResolver?.resolve({ taskId, source, agentRunId })
    ?? createUnknownTaskCapabilityClosure(evaluatedAtMs);
}

function readPendingApprovalBindings(
  runtime: { list: () => PendingToolPermissionSnapshot[] } | undefined,
): Set<string> {
  if (!runtime) return new Set();
  try {
    return new Set(runtime.list().map((item) => `${item.conversationId}\0${item.agentRunId}`));
  } catch {
    return new Set();
  }
}

export { createUnknownTaskCapabilityClosure } from "./task-capability-closure.js";

function indexWorktrees(items: UserWorktreeStatus[]): Map<string, UserWorktreeStatus> {
  const result = new Map<string, UserWorktreeStatus>();
  for (const item of items) {
    const key = `${item.owner.conversationId}\0${item.owner.runId}`;
    if (result.has(key)) {
      result.set(key, { ...item, status: "blocked", blockers: ["multiple_exact_owner_worktrees"] });
    } else {
      result.set(key, item);
    }
  }
  return result;
}

function toWorktreeEvidence(
  worktree: UserWorktreeStatus | undefined,
  lifecycle: UserWorktreeLifecycleEvidence | undefined,
): TaskProjectionSupportingEvidence {
  if (lifecycle?.lifecycle === "discarded") {
    return { worktree: { status: "missing", lifecycle: "discarded", observedAtMs: lifecycle.observedAtMs } };
  }
  if (lifecycle?.lifecycle === "discard_pending" || lifecycle?.lifecycle === "uncertain") {
    return {
      worktree: {
        status: "uncertain",
        observedAtMs: lifecycle.observedAtMs,
        ...(lifecycle.lifecycle === "discard_pending" ? { lifecycle: "discard_pending" as const } : {}),
      },
    };
  }
  if (!worktree) return {};
  const status = worktree.status === "unavailable"
    ? "missing" as const
    : (worktree.conflictChanges ?? 0) > 0
      ? "conflicted" as const
      : worktree.dirty
        ? "dirty" as const
        : worktree.status === "blocked" ? "conflicted" as const : "ready" as const;
  return {
    worktree: {
      status,
      observedAtMs: lifecycle?.observedAtMs ?? 0,
      ...(lifecycle?.lifecycle === "kept" ? { lifecycle: "kept" as const } : {}),
    },
  };
}

async function readWorktreeLifecycleEvidence(
  runtime: TaskProjectionCollectorContext["userWorktreeRuntime"],
  conversations: ConversationRunListItem[],
  now: () => number,
): Promise<Map<string, UserWorktreeLifecycleEvidence>> {
  if (!runtime?.readLifecycleEvidence) return new Map();
  const entries = await Promise.all(conversations.map(async (handle) => {
    const key = `${handle.conversationId}\0${handle.runId}`;
    try {
      return [key, await runtime.readLifecycleEvidence!({
        conversationId: handle.conversationId,
        runId: handle.runId,
      })] as const;
    } catch {
      return [key, { lifecycle: "uncertain" as const, observedAtMs: now() }] as const;
    }
  }));
  return new Map(entries.filter((entry): entry is readonly [string, UserWorktreeLifecycleEvidence] => Boolean(entry[1])));
}

async function readJournalEvidence(
  journal: Pick<CodingRunReconciliationJournalOwner, "reconcile"> | undefined,
  binding: { conversationId: string; agentRunId: string },
  observedAtMs: number,
): Promise<TaskProjectionSupportingEvidence> {
  if (!journal) return {};
  let reconciliation: CodingRunReconciliation;
  try {
    reconciliation = await journal.reconcile(binding);
  } catch {
    return { journal: { status: "uncertain", observedAtMs } };
  }
  const status = reconciliation.journalState === "missing"
    ? "skipped" as const
    : reconciliation.journalState !== "available" || reconciliation.state === "uncertain"
      ? "uncertain" as const
      : "pending" as const;
  return { journal: { status, observedAtMs } };
}

function toTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, Math.trunc(timestamp)) : 0;
}
