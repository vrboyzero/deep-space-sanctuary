import type { WorkflowRuntimeCapabilities } from "@belldandy/skills";

import type { ConversationRunListItem } from "../conversation-run-registry.js";
import type { GoalStatus } from "../goals/types.js";
import type { SubTaskKind, SubTaskStatus } from "../task-runtime.js";
import type { UserWorktreeStatus } from "../user-worktree-runtime.js";
import {
  createConversationCodingRunView,
  createGoalCodingRunView,
  createSubtaskCodingRunView,
  createWorkflowActiveCodingRunView,
} from "./source-adapters.js";
import {
  TASK_CAPABILITY_CLOSURE_SCHEMA_VERSION,
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
  userWorktreeRuntime?: { listStatus: () => Promise<UserWorktreeStatus[]> };
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
  const sources: TaskProjectionInput[] = [];

  for (const handle of ctx.conversationRunRegistry?.listActiveRuns() ?? []) {
    const taskId = `conversation:${handle.conversationId}:${handle.runId}`;
    sources.push({
      taskId,
      view: createConversationCodingRunView({ handle }),
      observedAtMs: Math.max(handle.startedAt, handle.stopRequestedAt ?? 0),
      capabilityClosure: resolveClosure(ctx, taskId, "conversation", handle.runId, now()),
      ...toWorktreeEvidence(worktreesByRun.get(`${handle.conversationId}\0${handle.runId}`)),
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
    ?? createUnknownTaskCapabilityClosure(evaluatedAtMs);
}

export function createUnknownTaskCapabilityClosure(evaluatedAtMs: number): TaskCapabilityClosure {
  const capability = { required: false, state: "unknown" as const, reasonCode: "not_evaluated" };
  return {
    schemaVersion: TASK_CAPABILITY_CLOSURE_SCHEMA_VERSION,
    evaluatedAtMs: Math.max(0, Math.trunc(evaluatedAtMs)),
    status: "unknown",
    capabilities: {
      tools: { ...capability },
      languageToolchain: { ...capability },
      sandbox: { ...capability },
      approvalChannel: { ...capability },
      worktree: { ...capability },
      journal: { ...capability },
      trace: { ...capability },
      verifier: { ...capability },
      mcp: { ...capability },
      plugin: { ...capability },
      skill: { ...capability },
    },
  };
}

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

function toWorktreeEvidence(worktree: UserWorktreeStatus | undefined): {
  supportingEvidence?: TaskProjectionSupportingEvidence;
} {
  if (!worktree) return {};
  const status = worktree.status === "unavailable"
    ? "missing" as const
    : worktree.status === "blocked" || (worktree.conflictChanges ?? 0) > 0
      ? "conflicted" as const
      : worktree.dirty ? "dirty" as const : "ready" as const;
  return { supportingEvidence: { worktree: { status, observedAtMs: 0 } } };
}

function toTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, Math.trunc(timestamp)) : 0;
}
