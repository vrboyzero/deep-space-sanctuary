import fs from "node:fs/promises";
import path from "node:path";

import { parseGoalSessionKey } from "./goals/session.js";

const TERMINAL_STATUSES = new Set(["done", "error", "timeout", "stopped"]);
const SAFE_TASK_ID_PATTERN = /^task_[A-Za-z0-9_-]{1,128}$/;

export const DEFAULT_SUBTASK_RETENTION_POLICY: SubTaskRetentionPolicy = {
  autoCompact: false,
  maxTerminalRecords: 500,
  minTerminalAgeMs: 30 * 24 * 60 * 60 * 1_000,
};

export type SubTaskRetentionPolicy = {
  autoCompact: boolean;
  maxTerminalRecords: number;
  minTerminalAgeMs: number;
};

export type SubTaskRetentionPolicyInput = Partial<SubTaskRetentionPolicy>;

export type SubTaskRetentionRecord = {
  id: string;
  status: string;
  createdAt: number;
  updatedAt?: number;
  finishedAt?: number;
  stopRequestedAt?: number;
  activeCommandClaim?: unknown;
  steering?: Array<{ status?: string }>;
  resume?: Array<{ status?: string }>;
  takeover?: Array<{ status?: string }>;
  parentConversationId?: string;
  launchSpec?: {
    delegation?: { goalId?: string };
    bridgeSubtask?: { goalId?: string };
  };
};

export type SubTaskRetentionSelection = {
  eligibleTaskIds: string[];
  protectedCount: number;
};

export type SubTaskRetentionSelectionContext = {
  goalBoundTaskIds?: ReadonlySet<string>;
};

export type SubTaskRetentionCompactionReport = {
  policy: SubTaskRetentionPolicy;
  eligibleCount: number;
  protectedCount: number;
  removedCount: number;
  errorCount: number;
  lastCompactedAt?: number;
};

type SubTaskRetentionCompactionLogger = {
  warn?: (message: string, data?: unknown) => void;
};

export function normalizeSubTaskRetentionPolicy(
  input: SubTaskRetentionPolicyInput = {},
): SubTaskRetentionPolicy {
  const policy = {
    ...DEFAULT_SUBTASK_RETENTION_POLICY,
    ...input,
    autoCompact: input.autoCompact === true,
  };
  assertNonNegativeInteger(policy.maxTerminalRecords, "maxTerminalRecords");
  assertNonNegativeInteger(policy.minTerminalAgeMs, "minTerminalAgeMs");
  return policy;
}

/**
 * Retention 只在普通终态记录中按新旧顺序淘汰；运行态、命令交接和 Goal 绑定始终受保护。
 */
export function selectSubTaskRetentionCandidates(
  records: readonly SubTaskRetentionRecord[],
  policyInput: SubTaskRetentionPolicyInput = {},
  nowMs = Date.now(),
  context: SubTaskRetentionSelectionContext = {},
): SubTaskRetentionSelection {
  const policy = normalizeSubTaskRetentionPolicy(policyInput);
  const now = Number.isFinite(nowMs) ? Math.max(0, Math.floor(nowMs)) : Date.now();
  const ordinaryTerminal = records
    .filter((record) => !isProtectedSubTaskRetentionRecord(record, context))
    .sort(compareRetentionRecordsNewestFirst);
  const eligibleTaskIds = ordinaryTerminal
    .slice(policy.maxTerminalRecords)
    .filter((record) => now - resolveRetentionTimestamp(record) >= policy.minTerminalAgeMs)
    .map((record) => record.id);
  return {
    eligibleTaskIds,
    protectedCount: records.length - eligibleTaskIds.length,
  };
}

export function resolveOwnedSubTaskOutputDirectory(outputsDir: string, taskId: string): string {
  if (!SAFE_TASK_ID_PATTERN.test(taskId)) {
    throw new Error("task id is not safe for output cleanup");
  }
  const resolvedRoot = path.resolve(outputsDir);
  const resolvedTarget = path.resolve(resolvedRoot, taskId);
  if (path.dirname(resolvedTarget) !== resolvedRoot) {
    throw new Error("task output cleanup target escaped the owned outputs directory");
  }
  return resolvedTarget;
}

export async function compactSubTaskRetention<T extends SubTaskRetentionRecord>(input: {
  records: Map<string, T>;
  policy: SubTaskRetentionPolicy;
  outputsDir: string;
  goalBoundTaskIds?: ReadonlySet<string>;
  publishRegistry: () => Promise<void>;
  onRecordRemoved?: (record: T) => void;
  onRecordRestored?: (record: T) => void;
  logger?: SubTaskRetentionCompactionLogger;
  nowMs?: number;
}): Promise<SubTaskRetentionCompactionReport> {
  const now = input.nowMs ?? Date.now();
  const selection = selectSubTaskRetentionCandidates(
    [...input.records.values()],
    input.policy,
    now,
    { goalBoundTaskIds: input.goalBoundTaskIds },
  );
  const removedRecords = selection.eligibleTaskIds
    .map((taskId) => input.records.get(taskId))
    .filter((record): record is T => Boolean(record));
  for (const record of removedRecords) {
    input.records.delete(record.id);
    input.onRecordRemoved?.(record);
  }

  try {
    if (removedRecords.length > 0) {
      await input.publishRegistry();
    }
  } catch (error) {
    for (const record of removedRecords) {
      input.records.set(record.id, record);
      input.onRecordRestored?.(record);
    }
    throw error;
  }

  let errorCount = 0;
  for (const record of removedRecords) {
    try {
      const outputDirectory = resolveOwnedSubTaskOutputDirectory(input.outputsDir, record.id);
      await fs.rm(outputDirectory, {
        recursive: true,
        force: true,
        maxRetries: 2,
        retryDelay: 25,
      });
    } catch (error) {
      errorCount += 1;
      input.logger?.warn?.("Failed to clean one compacted subtask output directory.", {
        code: (error as NodeJS.ErrnoException | undefined)?.code ?? "unknown",
      });
    }
  }

  return {
    policy: { ...input.policy },
    eligibleCount: selection.eligibleTaskIds.length,
    protectedCount: selection.protectedCount,
    removedCount: removedRecords.length,
    errorCount,
    lastCompactedAt: now,
  };
}

function isProtectedSubTaskRetentionRecord(
  record: SubTaskRetentionRecord,
  context: SubTaskRetentionSelectionContext,
): boolean {
  if (!TERMINAL_STATUSES.has(record.status)) return true;
  if (record.activeCommandClaim || record.stopRequestedAt !== undefined) return true;
  if (hasAcceptedHandoff(record.steering) || hasAcceptedHandoff(record.resume) || hasAcceptedHandoff(record.takeover)) {
    return true;
  }
  if (record.launchSpec?.delegation?.goalId?.trim() || record.launchSpec?.bridgeSubtask?.goalId?.trim()) {
    return true;
  }
  if (context.goalBoundTaskIds?.has(record.id)) return true;
  return Boolean(record.parentConversationId && parseGoalSessionKey(record.parentConversationId));
}

function hasAcceptedHandoff(items: Array<{ status?: string }> | undefined): boolean {
  return Boolean(items?.some((item) => item.status === "accepted"));
}

function compareRetentionRecordsNewestFirst(
  left: SubTaskRetentionRecord,
  right: SubTaskRetentionRecord,
): number {
  const timestampDifference = resolveRetentionTimestamp(right) - resolveRetentionTimestamp(left);
  return timestampDifference || right.id.localeCompare(left.id);
}

function resolveRetentionTimestamp(record: SubTaskRetentionRecord): number {
  for (const value of [record.finishedAt, record.updatedAt, record.createdAt]) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return Math.floor(value);
    }
  }
  return 0;
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
}
