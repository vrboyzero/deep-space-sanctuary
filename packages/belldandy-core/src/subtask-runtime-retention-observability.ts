import type { SubTaskRetentionCompactionReport } from "./subtask-runtime-retention.js";

export type SubTaskRuntimeRetentionObservationItem = {
  status: string;
  archivedAt?: number;
};

export type SubTaskRuntimeRetentionObservabilitySnapshot = {
  summary: {
    totalCount: number;
    activeCount: number;
    terminalCount: number;
    archivedCount: number;
    archivedTerminalCount: number;
    archivedActiveCount: number;
    unarchivedTerminalCount: number;
    statusCounts: {
      pending: number;
      running: number;
      done: number;
      error: number;
      timeout: number;
      stopped: number;
      interrupted: number;
    };
    oldestArchivedAt?: number;
    newestArchivedAt?: number;
    oldestArchivedAgeMs?: number;
    headline: string;
  };
  compaction?: SubTaskRetentionCompactionReport;
};

const TERMINAL_STATUSES = new Set(["done", "error", "timeout", "stopped", "interrupted"]);

const EMPTY_STATUS_COUNTS: SubTaskRuntimeRetentionObservabilitySnapshot["summary"]["statusCounts"] = {
  pending: 0,
  running: 0,
  done: 0,
  error: 0,
  timeout: 0,
  stopped: 0,
  interrupted: 0,
};

/**
 * Doctor 仅输出固定聚合值，不保留或暴露 SubTask 的正文、摘要、错误或标识。
 */
export function buildSubTaskRuntimeRetentionObservability(
  items: readonly SubTaskRuntimeRetentionObservationItem[],
  nowMs = Date.now(),
  compaction?: SubTaskRetentionCompactionReport,
): SubTaskRuntimeRetentionObservabilitySnapshot {
  const statusCounts = { ...EMPTY_STATUS_COUNTS };
  let activeCount = 0;
  let terminalCount = 0;
  let archivedCount = 0;
  let archivedTerminalCount = 0;
  let archivedActiveCount = 0;
  let oldestArchivedAt: number | undefined;
  let newestArchivedAt: number | undefined;

  for (const item of items) {
    if (isKnownStatus(item.status)) {
      statusCounts[item.status] += 1;
    }

    const terminal = TERMINAL_STATUSES.has(item.status);
    if (terminal) {
      terminalCount += 1;
    } else {
      activeCount += 1;
    }

    const archivedAt = normalizeArchivedAt(item.archivedAt);
    if (archivedAt === undefined) {
      continue;
    }
    archivedCount += 1;
    if (terminal) {
      archivedTerminalCount += 1;
    } else {
      archivedActiveCount += 1;
    }
    oldestArchivedAt = oldestArchivedAt === undefined ? archivedAt : Math.min(oldestArchivedAt, archivedAt);
    newestArchivedAt = newestArchivedAt === undefined ? archivedAt : Math.max(newestArchivedAt, archivedAt);
  }

  const unarchivedTerminalCount = terminalCount - archivedTerminalCount;
  const normalizedNowMs = normalizeNow(nowMs);
  const oldestArchivedAgeMs = oldestArchivedAt === undefined
    ? undefined
    : Math.max(0, normalizedNowMs - oldestArchivedAt);
  const headline = [
    `subtasks=${items.length}`,
    `active=${activeCount}`,
    `terminal=${terminalCount}`,
    `archived=${archivedCount} (terminal=${archivedTerminalCount}, active=${archivedActiveCount})`,
    `unarchivedTerminal=${unarchivedTerminalCount}`,
    ...(oldestArchivedAgeMs === undefined ? [] : [`oldestArchivedAgeMs=${oldestArchivedAgeMs}`]),
    ...(compaction ? [
      `retention eligible=${compaction.eligibleCount}, protected=${compaction.protectedCount}, removed=${compaction.removedCount}, errors=${compaction.errorCount}`,
    ] : []),
  ].join("; ");

  return {
    summary: {
      totalCount: items.length,
      activeCount,
      terminalCount,
      archivedCount,
      archivedTerminalCount,
      archivedActiveCount,
      unarchivedTerminalCount,
      statusCounts,
      ...(oldestArchivedAt === undefined ? {} : { oldestArchivedAt }),
      ...(newestArchivedAt === undefined ? {} : { newestArchivedAt }),
      ...(oldestArchivedAgeMs === undefined ? {} : { oldestArchivedAgeMs }),
      headline,
    },
    ...(compaction ? { compaction } : {}),
  };
}

function isKnownStatus(
  value: string,
): value is keyof SubTaskRuntimeRetentionObservabilitySnapshot["summary"]["statusCounts"] {
  return value === "pending"
    || value === "running"
    || value === "done"
    || value === "error"
    || value === "timeout"
    || value === "stopped"
    || value === "interrupted";
}

function normalizeArchivedAt(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function normalizeNow(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : Date.now();
}
