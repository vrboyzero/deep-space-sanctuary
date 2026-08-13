import { createHash } from "node:crypto";

import type { AgentLaunchSpec } from "@belldandy/agent";
import type { SubAgentResult } from "@belldandy/skills";

import {
  resolveSubTaskSupervisorBudgetLimits,
  tightenSubTaskLaunchBudgets,
  type SubTaskSupervisorBudgetLimits,
  type SubTaskSupervisorBudgetSnapshot,
  type SubTaskSupervisorRiskLevel,
} from "./subtask-supervisor-budget.js";

export const SUBTASK_SUPERVISOR_RUNTIME_SCHEMA_VERSION = "subtask-supervisor-runtime/v1" as const;

export type SubTaskSupervisorAdmissionErrorCode =
  | "manager_binding_required"
  | "parallel_binding_required"
  | "worktree_required"
  | "depth_exceeded"
  | "wall_time_exceeded"
  | "child_budget_exceeded"
  | "verifier_budget_exceeded"
  | "binding_conflict";

export class SubTaskSupervisorAdmissionError extends Error {
  constructor(
    readonly code: SubTaskSupervisorAdmissionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SubTaskSupervisorAdmissionError";
  }
}

export type SubTaskSupervisorLaunchObserver = {
  readonly binding?: SubTaskSupervisorBinding;
  bindTask(taskId: string): void;
  bindSession(sessionId: string): void;
};

export type SubTaskSupervisorBinding = {
  managerConversationId: string;
  managerAgentRunId: string;
  teamId: string;
  laneId: string;
  mode: "read" | "write";
};

export type SubTaskSupervisorExactBinding = Omit<SubTaskSupervisorBinding, "mode"> & {
  taskId: string;
  sessionId?: string;
};

export type SubTaskSupervisorReattachInput = {
  binding: SubTaskSupervisorBinding;
  role?: AgentLaunchSpec["role"];
  taskId: string;
  sessionId?: string;
  status: "done" | "error" | "timeout" | "stopped" | "interrupted";
  admittedAtMs: number;
  updatedAtMs: number;
  finishedAtMs?: number;
};

export type SubTaskSupervisorReconcileInput = {
  binding: SubTaskSupervisorBinding;
  role?: AgentLaunchSpec["role"];
  taskId: string;
  sessionId?: string;
  status: "pending" | "running" | "done" | "error" | "timeout" | "stopped" | "interrupted";
  commandGeneration?: number;
  admittedAtMs: number;
  updatedAtMs: number;
  finishedAtMs?: number;
};

export type SubTaskSupervisorRuntimeItem = {
  status: "admitted" | "running" | "done" | "failed" | "cancelled" | "interrupted";
  mode: "read" | "write";
  role?: AgentLaunchSpec["role"];
  revision: number;
  binding: {
    managerConversationId: string;
    managerAgentRunId: string;
    teamId: string;
    laneId: string;
    taskId?: string;
    sessionId?: string;
  };
  admittedAtMs: number;
  updatedAtMs: number;
  finishedAtMs?: number;
};

export type SubTaskSupervisorRuntimeSnapshot = {
  schemaVersion: typeof SUBTASK_SUPERVISOR_RUNTIME_SCHEMA_VERSION;
  contentMode: "none";
  activeCount: number;
  maxActiveChildren: number;
  retainedTerminalCount: number;
  maxRetainedTerminalCount: number;
  budget: SubTaskSupervisorBudgetSnapshot;
  items: SubTaskSupervisorRuntimeItem[];
};

type GovernedBinding = {
  managerConversationId: string;
  managerAgentRunId: string;
  teamId: string;
  laneId: string;
};

type RuntimeRecord = {
  key: string;
  requestHash?: string;
  status: SubTaskSupervisorRuntimeItem["status"];
  mode: SubTaskSupervisorRuntimeItem["mode"];
  role?: SubTaskSupervisorRuntimeItem["role"];
  binding: SubTaskSupervisorRuntimeItem["binding"];
  admittedAtMs: number;
  updatedAtMs: number;
  finishedAtMs?: number;
  commandGeneration: number;
  promise?: Promise<SubAgentResult>;
};

export class SubTaskSupervisorRuntime {
  private readonly maxActiveChildren: number;
  private readonly maxDepth: number;
  private readonly maxWallTimeMs: number;
  private readonly maxRetainedTerminalCount: number;
  private readonly budgetLimits: SubTaskSupervisorBudgetLimits;
  private readonly now: () => number;
  private readonly records = new Map<string, RuntimeRecord>();

  constructor(input: {
    maxActiveChildren: number;
    maxDepth: number;
    maxWallTimeMs: number;
    maxVerifierChildren?: number;
    toolLoopIterationBudget?: number;
    maxTotalTokens?: number;
    maxCostUsd?: number;
    maxHighRiskToolCalls?: number;
    maxToolRiskLevel?: SubTaskSupervisorRiskLevel;
    maxRetainedTerminalCount?: number;
    now?: () => number;
  }) {
    this.maxActiveChildren = positiveInt(input.maxActiveChildren, 1);
    this.maxDepth = positiveInt(input.maxDepth, 1);
    this.maxWallTimeMs = positiveInt(input.maxWallTimeMs, 120_000);
    this.budgetLimits = resolveSubTaskSupervisorBudgetLimits({
      maxActiveChildren: this.maxActiveChildren,
      maxVerifierChildren: input.maxVerifierChildren,
      maxRunWallTimeMs: this.maxWallTimeMs,
      toolLoopIterationBudget: input.toolLoopIterationBudget,
      maxTotalTokens: input.maxTotalTokens,
      maxCostUsd: input.maxCostUsd,
      maxHighRiskToolCalls: input.maxHighRiskToolCalls,
      maxToolRiskLevel: input.maxToolRiskLevel,
    });
    this.maxRetainedTerminalCount = positiveInt(input.maxRetainedTerminalCount, 64);
    this.now = input.now ?? Date.now;
  }

  async execute(input: {
    launchSpec: AgentLaunchSpec;
    parentOperation?: { agentRunId: string; toolCallId: string };
    worktreeIsolationAvailable: boolean;
    launch: (
      launchSpec: AgentLaunchSpec,
      observer: SubTaskSupervisorLaunchObserver,
    ) => Promise<SubAgentResult>;
  }): Promise<SubAgentResult> {
    const governed = readGovernedBinding(input.launchSpec, input.parentOperation);
    if (!governed) {
      return input.launch(input.launchSpec, NOOP_OBSERVER);
    }

    const { binding, mode, role } = governed;
    validateAdmission({
      launchSpec: input.launchSpec,
      binding,
      mode,
      maxDepth: this.maxDepth,
      maxWallTimeMs: this.maxWallTimeMs,
      worktreeIsolationAvailable: input.worktreeIsolationAvailable,
    });
    const budgetedLaunchSpec = tightenSubTaskLaunchBudgets(input.launchSpec, this.budgetLimits);
    const launchSpec = mode === "write"
      ? { ...budgetedLaunchSpec, isolationMode: "worktree" }
      : budgetedLaunchSpec;
    const key = bindingKey(binding);
    const requestHash = hashLaunchRequest(launchSpec);
    const existing = this.records.get(key);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new SubTaskSupervisorAdmissionError(
          "binding_conflict",
          "Parallel lane binding is already owned by a different launch request.",
        );
      }
      if ((existing.status === "admitted" || existing.status === "running") && existing.promise) {
        return existing.promise;
      }
      throw new SubTaskSupervisorAdmissionError(
        "binding_conflict",
        "Parallel lane binding has already reached a terminal state.",
      );
    }
    if (this.activeCount() >= this.maxActiveChildren) {
      throw new SubTaskSupervisorAdmissionError(
        "child_budget_exceeded",
        `Subtask Supervisor active child budget (${this.maxActiveChildren}) is exhausted.`,
      );
    }
    if (role === "verifier" && this.activeVerifierCount() >= this.budgetLimits.maxVerifierChildren) {
      throw new SubTaskSupervisorAdmissionError(
        "verifier_budget_exceeded",
        `Subtask Supervisor active verifier budget (${this.budgetLimits.maxVerifierChildren}) is exhausted.`,
      );
    }

    const admittedAtMs = this.now();
    const launchGeneration = 0;
    let record!: RuntimeRecord;
    const observer: SubTaskSupervisorLaunchObserver = {
      binding: { ...binding, mode },
      bindTask: (taskId) => this.bind(record, "taskId", taskId, launchGeneration),
      bindSession: (sessionId) => {
        this.bind(record, "sessionId", sessionId, launchGeneration);
        if (record.commandGeneration !== launchGeneration) return;
        if (record.status === "admitted") record.status = "running";
      },
    };
    const promise = Promise.resolve()
      .then(() => input.launch(launchSpec, observer))
      .then((result) => {
        if (result.taskId) observer.bindTask(result.taskId);
        if (result.sessionId) observer.bindSession(result.sessionId);
        this.settle(record, inferTerminalStatus(result), launchGeneration);
        return result;
      }, (error) => {
        this.settle(record, "failed", launchGeneration);
        throw error;
      });
    record = {
      key,
      requestHash,
      status: "admitted",
      mode,
      role,
      binding: { ...binding },
      admittedAtMs,
      updatedAtMs: admittedAtMs,
      commandGeneration: launchGeneration,
      promise,
    };
    this.records.set(key, record);
    return promise;
  }

  reattach(items: SubTaskSupervisorReattachInput[]): void {
    for (const item of items) {
      const binding = normalizePersistedBinding(item.binding);
      const taskId = normalizeBindingValue(item.taskId);
      const sessionId = normalizeBindingValue(item.sessionId);
      if (!binding || !taskId) {
        throw new SubTaskSupervisorAdmissionError(
          "parallel_binding_required",
          "Persisted parallel lane requires an exact Supervisor binding.",
        );
      }
      const key = bindingKey(binding);
      if (this.records.has(key) || this.findByTaskId(taskId)) {
        throw new SubTaskSupervisorAdmissionError(
          "binding_conflict",
          "Persisted parallel lane binding conflicts with an existing Supervisor record.",
        );
      }
      const admittedAtMs = nonNegativeTimestamp(item.admittedAtMs, this.now());
      const updatedAtMs = nonNegativeTimestamp(item.updatedAtMs, admittedAtMs);
      const finishedAtMs = nonNegativeTimestamp(item.finishedAtMs, updatedAtMs);
      this.records.set(key, {
        key,
        status: item.status === "done"
          ? "done"
          : item.status === "stopped"
            ? "cancelled"
            : item.status === "interrupted"
              ? "interrupted"
              : "failed",
        mode: binding.mode,
        role: normalizeRole(item.role),
        binding: {
          managerConversationId: binding.managerConversationId,
          managerAgentRunId: binding.managerAgentRunId,
          teamId: binding.teamId,
          laneId: binding.laneId,
          taskId,
          ...(sessionId ? { sessionId } : {}),
        },
        admittedAtMs,
        updatedAtMs,
        finishedAtMs,
        commandGeneration: 0,
      });
    }
    this.trimTerminalRecords();
  }

  reconcile(item: SubTaskSupervisorReconcileInput): SubTaskSupervisorRuntimeItem {
    const binding = normalizePersistedBinding(item.binding);
    const taskId = normalizeBindingValue(item.taskId);
    const sessionId = normalizeBindingValue(item.sessionId);
    if (!binding || !taskId) {
      throw new SubTaskSupervisorAdmissionError(
        "parallel_binding_required",
        "Authoritative parallel lane requires an exact Supervisor binding.",
      );
    }
    const key = bindingKey(binding);
    const existing = this.records.get(key);
    const taskOwner = this.findByTaskId(taskId);
    if ((taskOwner && taskOwner !== existing)
      || (existing?.binding.taskId && existing.binding.taskId !== taskId)) {
      throw new SubTaskSupervisorAdmissionError(
        "binding_conflict",
        "Authoritative parallel lane binding conflicts with an existing Supervisor record.",
      );
    }
    const admittedAtMs = nonNegativeTimestamp(item.admittedAtMs, this.now());
    const updatedAtMs = nonNegativeTimestamp(item.updatedAtMs, admittedAtMs);
    const finishedAtMs = item.finishedAtMs === undefined
      ? undefined
      : nonNegativeTimestamp(item.finishedAtMs, updatedAtMs);
    const status = projectAuthoritativeStatus(item.status);
    const commandGeneration = nonNegativeGeneration(item.commandGeneration);
    const record = existing ?? {
      key,
      status,
      mode: binding.mode,
      role: normalizeRole(item.role),
      binding: {
        managerConversationId: binding.managerConversationId,
        managerAgentRunId: binding.managerAgentRunId,
        teamId: binding.teamId,
        laneId: binding.laneId,
        taskId,
        ...(sessionId ? { sessionId } : {}),
      },
      admittedAtMs,
      updatedAtMs,
      commandGeneration,
    };
    if (existing && commandGeneration < existing.commandGeneration) {
      return toRuntimeItem(existing);
    }
    record.status = status;
    record.mode = binding.mode;
    record.role = normalizeRole(item.role) ?? record.role;
    record.binding.taskId = taskId;
    if (sessionId) record.binding.sessionId = sessionId;
    record.updatedAtMs = updatedAtMs;
    record.finishedAtMs = finishedAtMs;
    record.commandGeneration = commandGeneration;
    if (!existing) this.records.set(key, record);
    this.trimTerminalRecords();
    return toRuntimeItem(record);
  }

  observe(binding: SubTaskSupervisorExactBinding): SubTaskSupervisorRuntimeItem | undefined {
    const taskId = normalizeBindingValue(binding.taskId);
    const record = taskId ? this.findByTaskId(taskId) : undefined;
    if (!record) return undefined;
    const expected = {
      managerConversationId: normalizeBindingValue(binding.managerConversationId),
      managerAgentRunId: normalizeBindingValue(binding.managerAgentRunId),
      teamId: normalizeBindingValue(binding.teamId),
      laneId: normalizeBindingValue(binding.laneId),
      taskId,
      sessionId: normalizeBindingValue(binding.sessionId),
    };
    if (!expected.managerConversationId
      || !expected.managerAgentRunId
      || !expected.teamId
      || !expected.laneId
      || record.binding.managerConversationId !== expected.managerConversationId
      || record.binding.managerAgentRunId !== expected.managerAgentRunId
      || record.binding.teamId !== expected.teamId
      || record.binding.laneId !== expected.laneId
      || record.binding.taskId !== expected.taskId
      || (expected.sessionId !== undefined && record.binding.sessionId !== expected.sessionId)) {
      throw new SubTaskSupervisorAdmissionError(
        "binding_conflict",
        "Supervisor observation binding does not match the authoritative parallel lane.",
      );
    }
    return toRuntimeItem(record);
  }

  getSnapshot(): SubTaskSupervisorRuntimeSnapshot {
    const items = [...this.records.values()]
      .sort((left, right) => left.admittedAtMs - right.admittedAtMs || left.key.localeCompare(right.key))
      .map(toRuntimeItem);
    return {
      schemaVersion: SUBTASK_SUPERVISOR_RUNTIME_SCHEMA_VERSION,
      contentMode: "none",
      activeCount: items.filter((item) => item.status === "admitted" || item.status === "running").length,
      maxActiveChildren: this.maxActiveChildren,
      retainedTerminalCount: items.filter((item) => isTerminalStatus(item.status)).length,
      maxRetainedTerminalCount: this.maxRetainedTerminalCount,
      budget: {
        ...this.budgetLimits,
        activeChildren: this.activeCount(),
        activeVerifiers: this.activeVerifierCount(),
      },
      items,
    };
  }

  private bind(
    record: RuntimeRecord,
    field: "taskId" | "sessionId",
    value: string,
    commandGeneration: number,
  ): void {
    if (record.commandGeneration !== commandGeneration) return;
    const normalized = value.trim();
    if (!normalized || record.binding[field] === normalized) return;
    if (record.binding[field]) {
      this.settle(record, "failed", commandGeneration);
      throw new SubTaskSupervisorAdmissionError(
        "binding_conflict",
        `Parallel lane ${field} changed after it was bound.`,
      );
    }
    record.binding[field] = normalized;
    record.updatedAtMs = this.now();
  }

  private settle(
    record: RuntimeRecord,
    status: "done" | "failed" | "cancelled",
    commandGeneration: number,
  ): void {
    if (record.commandGeneration !== commandGeneration) return;
    if (isTerminalStatus(record.status)) return;
    const now = this.now();
    record.status = status;
    record.updatedAtMs = now;
    record.finishedAtMs = now;
    this.trimTerminalRecords();
  }

  private activeCount(): number {
    return [...this.records.values()]
      .filter((record) => record.status === "admitted" || record.status === "running")
      .length;
  }

  private activeVerifierCount(): number {
    return [...this.records.values()]
      .filter((record) => record.role === "verifier"
        && (record.status === "admitted" || record.status === "running"))
      .length;
  }

  private findByTaskId(taskId: string): RuntimeRecord | undefined {
    return [...this.records.values()].find((record) => record.binding.taskId === taskId);
  }

  private trimTerminalRecords(): void {
    const terminal = [...this.records.values()]
      .filter((record) => isTerminalStatus(record.status))
      .sort((left, right) => (left.finishedAtMs ?? 0) - (right.finishedAtMs ?? 0));
    while (terminal.length > this.maxRetainedTerminalCount) {
      const record = terminal.shift();
      if (record) this.records.delete(record.key);
    }
  }
}

const NOOP_OBSERVER: SubTaskSupervisorLaunchObserver = {
  bindTask: () => undefined,
  bindSession: () => undefined,
};

function toRuntimeItem(record: RuntimeRecord): SubTaskSupervisorRuntimeItem {
  return {
    status: record.status,
    mode: record.mode,
    ...(record.role ? { role: record.role } : {}),
    revision: record.commandGeneration,
    binding: { ...record.binding },
    admittedAtMs: record.admittedAtMs,
    updatedAtMs: record.updatedAtMs,
    ...(record.finishedAtMs === undefined ? {} : { finishedAtMs: record.finishedAtMs }),
  };
}

function isTerminalStatus(status: SubTaskSupervisorRuntimeItem["status"]): boolean {
  return status === "done" || status === "failed" || status === "cancelled" || status === "interrupted";
}

function inferTerminalStatus(result: SubAgentResult): "done" | "failed" | "cancelled" {
  if (result.success) return "done";
  return /stopped|cancelled/i.test(String(result.error ?? "")) ? "cancelled" : "failed";
}

function projectAuthoritativeStatus(
  status: SubTaskSupervisorReconcileInput["status"],
): SubTaskSupervisorRuntimeItem["status"] {
  if (status === "pending") return "admitted";
  if (status === "running") return "running";
  if (status === "done") return "done";
  if (status === "stopped") return "cancelled";
  if (status === "interrupted") return "interrupted";
  return "failed";
}

function normalizePersistedBinding(value: SubTaskSupervisorBinding): SubTaskSupervisorBinding | undefined {
  const managerConversationId = normalizeBindingValue(value?.managerConversationId);
  const managerAgentRunId = normalizeBindingValue(value?.managerAgentRunId);
  const teamId = normalizeBindingValue(value?.teamId);
  const laneId = normalizeBindingValue(value?.laneId);
  if (!managerConversationId || !managerAgentRunId || !teamId || !laneId
    || (value.mode !== "read" && value.mode !== "write")) {
    return undefined;
  }
  return { managerConversationId, managerAgentRunId, teamId, laneId, mode: value.mode };
}

function normalizeBindingValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= 512 && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : undefined;
}

function nonNegativeTimestamp(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function nonNegativeGeneration(value: number | undefined): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function readGovernedBinding(
  launchSpec: AgentLaunchSpec,
  parentOperation: { agentRunId: string; toolCallId: string } | undefined,
): { binding: GovernedBinding; mode: "read" | "write"; role?: AgentLaunchSpec["role"] } | undefined {
  const protocol = launchSpec.delegationProtocol;
  if (protocol?.source !== "delegate_parallel") return undefined;
  const managerConversationId = launchSpec.parentConversationId.trim();
  const managerAgentRunId = parentOperation?.agentRunId.trim() ?? "";
  if (!managerConversationId || !managerAgentRunId) {
    throw new SubTaskSupervisorAdmissionError(
      "manager_binding_required",
      "Parallel lane requires an exact manager Conversation/run binding.",
    );
  }
  const teamId = protocol.team?.id.trim() ?? "";
  const laneId = protocol.team?.currentLaneId?.trim() ?? "";
  const currentMember = protocol.team?.memberRoster.find((member) => member.laneId === laneId);
  if (!teamId || !laneId || !currentMember) {
    throw new SubTaskSupervisorAdmissionError(
      "parallel_binding_required",
      "Parallel lane requires an exact team/lane binding.",
    );
  }
  return {
    binding: { managerConversationId, managerAgentRunId, teamId, laneId },
    mode: protocol.ownership?.writeScope?.length ? "write" : "read",
    role: normalizeRole(currentMember.role),
  };
}

function validateAdmission(input: {
  launchSpec: AgentLaunchSpec;
  binding: GovernedBinding;
  mode: "read" | "write";
  maxDepth: number;
  maxWallTimeMs: number;
  worktreeIsolationAvailable: boolean;
}): void {
  if (input.mode === "write" && !input.worktreeIsolationAvailable) {
    throw new SubTaskSupervisorAdmissionError(
      "worktree_required",
      "Parallel write lane requires an available managed worktree owner.",
    );
  }
  const depth = Number(input.launchSpec.context?._orchestratorDepth ?? 0);
  if (!Number.isInteger(depth) || depth < 0 || depth >= input.maxDepth) {
    throw new SubTaskSupervisorAdmissionError(
      "depth_exceeded",
      `Subtask Supervisor nesting depth limit (${input.maxDepth}) was exceeded.`,
    );
  }
  if (!Number.isSafeInteger(input.launchSpec.timeoutMs)
    || input.launchSpec.timeoutMs <= 0
    || input.launchSpec.timeoutMs > input.maxWallTimeMs) {
    throw new SubTaskSupervisorAdmissionError(
      "wall_time_exceeded",
      `Subtask Supervisor wall-time budget (${input.maxWallTimeMs}ms) was exceeded.`,
    );
  }
}

function bindingKey(binding: GovernedBinding): string {
  return [
    binding.managerConversationId,
    binding.managerAgentRunId,
    binding.teamId,
    binding.laneId,
  ].join("\0");
}

function hashLaunchRequest(launchSpec: AgentLaunchSpec): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(launchSpec))).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalize(item)]));
}

function positiveInt(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function normalizeRole(value: unknown): AgentLaunchSpec["role"] | undefined {
  return value === "default"
    || value === "commander"
    || value === "coder"
    || value === "researcher"
    || value === "verifier"
    ? value
    : undefined;
}
