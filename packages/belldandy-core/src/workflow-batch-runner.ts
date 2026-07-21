import { randomUUID } from "node:crypto";

import type { WorkflowTaskResult } from "@belldandy/agent";

export type WorkflowBatchLimits = {
  maxItems: number;
  maxQueuedBytes: number;
  maxOutputBytes: number;
};

export type WorkflowBatchLimitKind = "items" | "queued_bytes" | "output_bytes";

export const DEFAULT_WORKFLOW_BATCH_LIMITS: Readonly<WorkflowBatchLimits> = Object.freeze({
  maxItems: 1_000,
  maxQueuedBytes: 4 * 1024 * 1024,
  maxOutputBytes: 4 * 1024 * 1024,
});

export const WORKFLOW_BATCH_ENTRY_METADATA_BYTES = 64;

export class WorkflowBatchLimitError extends Error {
  readonly kind: WorkflowBatchLimitKind;

  constructor(kind: WorkflowBatchLimitKind, message: string) {
    super(message);
    this.name = "WorkflowBatchLimitError";
    this.kind = kind;
  }
}

export type RunWorkflowBatchOptions<T, U> = {
  items: readonly T[];
  maxConcurrent: number;
  limits: WorkflowBatchLimits;
  taskIdPrefix: string;
  abortSignal?: AbortSignal;
  measureQueuedBytes?: (item: T) => number;
  execute: (item: T, index: number) => Promise<U>;
};

/**
 * 以固定 worker 数惰性领取任务，并在保留结果前执行输入与聚合输出硬限。
 */
export async function runWorkflowBatch<T, U>(
  options: RunWorkflowBatchOptions<T, U>,
): Promise<Array<WorkflowTaskResult<U>>> {
  const { items, limits, abortSignal } = options;
  throwIfWorkflowBatchAborted(abortSignal);
  assertPositiveSafeInteger(options.maxConcurrent, "maxConcurrent");
  assertBatchLimits(limits);

  if (items.length > limits.maxItems) {
    throw new WorkflowBatchLimitError(
      "items",
      `Workflow batch item limit exceeded (${items.length}/${limits.maxItems}).`,
    );
  }

  const measureQueuedBytes = options.measureQueuedBytes ?? measureWorkflowValueUtf8Bytes;
  let queuedBytes = 0;
  for (const item of items) {
    const itemBytes = normalizeMeasuredBytes(measureQueuedBytes(item));
    if (itemBytes > limits.maxQueuedBytes - queuedBytes) {
      throw new WorkflowBatchLimitError(
        "queued_bytes",
        `Workflow batch queued byte limit exceeded (${limits.maxQueuedBytes} bytes).`,
      );
    }
    queuedBytes += itemBytes;
  }

  if (items.length === 0) return [];

  const results = new Array<WorkflowTaskResult<U>>(items.length);
  const workerCount = Math.min(options.maxConcurrent, items.length);
  let nextIndex = 0;
  let outputBytes = 0;
  let stopError: WorkflowBatchLimitError | undefined;

  const claimNextIndex = (): number | undefined => {
    if (stopError) return undefined;
    throwIfWorkflowBatchAborted(abortSignal);
    if (nextIndex >= items.length) return undefined;
    const claimed = nextIndex;
    nextIndex++;
    return claimed;
  };

  const runWorker = async (): Promise<void> => {
    while (true) {
      const index = claimNextIndex();
      if (index === undefined) return;
      const startedAt = Date.now();

      try {
        const value = await options.execute(items[index], index);
        throwIfWorkflowBatchAborted(abortSignal);

        if (stopError) {
          results[index] = createLimitFailure(stopError, options.taskIdPrefix, index, startedAt);
          continue;
        }

        const valueBytes = measureWorkflowValueUtf8Bytes(value);
        if (valueBytes > limits.maxOutputBytes - outputBytes) {
          stopError = new WorkflowBatchLimitError(
            "output_bytes",
            `Workflow batch output byte limit exceeded (${limits.maxOutputBytes} bytes).`,
          );
          results[index] = createLimitFailure(stopError, options.taskIdPrefix, index, startedAt);
          continue;
        }

        outputBytes += valueBytes;
        results[index] = {
          ok: true,
          value,
          taskId: createTaskId(options.taskIdPrefix, index),
          cacheHit: false,
          durationMs: Date.now() - startedAt,
        };
      } catch (error) {
        if (abortSignal?.aborted) {
          throw createWorkflowBatchAbortError(abortSignal);
        }
        results[index] = {
          ok: false,
          error: toErrorMessage(error),
          taskId: createTaskId(options.taskIdPrefix, index),
          durationMs: Date.now() - startedAt,
        };
      }
    }
  };

  await raceWorkflowBatchWithAbort(
    Promise.all(Array.from({ length: workerCount }, () => runWorker())),
    abortSignal,
  );

  if (stopError) {
    for (let index = 0; index < results.length; index++) {
      if (!results[index]) {
        results[index] = createLimitFailure(stopError, options.taskIdPrefix, index);
      }
    }
  }

  return results;
}

export function resolveWorkflowBatchLimits(
  readEnv: (name: string) => string | undefined,
): WorkflowBatchLimits {
  return {
    maxItems: readPositiveSafeInteger(
      readEnv("BELLDANDY_WORKFLOW_MAX_BATCH_ITEMS"),
      DEFAULT_WORKFLOW_BATCH_LIMITS.maxItems,
    ),
    maxQueuedBytes: readPositiveSafeInteger(
      readEnv("BELLDANDY_WORKFLOW_MAX_BATCH_QUEUED_BYTES"),
      DEFAULT_WORKFLOW_BATCH_LIMITS.maxQueuedBytes,
    ),
    maxOutputBytes: readPositiveSafeInteger(
      readEnv("BELLDANDY_WORKFLOW_MAX_BATCH_OUTPUT_BYTES"),
      DEFAULT_WORKFLOW_BATCH_LIMITS.maxOutputBytes,
    ),
  };
}

export function measureWorkflowValueUtf8Bytes(value: unknown): number {
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? 0 : Buffer.byteLength(serialized, "utf8");
  } catch {
    // 无法可靠序列化的值按不可容纳处理，避免绕过 output/queue hard cap。
    return Number.MAX_SAFE_INTEGER;
  }
}

function createLimitFailure(
  error: WorkflowBatchLimitError,
  taskIdPrefix: string,
  index: number,
  startedAt?: number,
): WorkflowTaskResult<never> {
  return {
    ok: false,
    error: error.message,
    failureKind: error.kind,
    taskId: createTaskId(taskIdPrefix, index),
    durationMs: startedAt === undefined ? 0 : Date.now() - startedAt,
  };
}

function createTaskId(prefix: string, index: number): string {
  return `${prefix}_${index}_${randomUUID().slice(0, 8)}`;
}

function assertBatchLimits(limits: WorkflowBatchLimits): void {
  assertPositiveSafeInteger(limits.maxItems, "maxItems");
  assertPositiveSafeInteger(limits.maxQueuedBytes, "maxQueuedBytes");
  assertPositiveSafeInteger(limits.maxOutputBytes, "maxOutputBytes");
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`Workflow batch ${name} must be a positive safe integer.`);
  }
}

function normalizeMeasuredBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) return Number.MAX_SAFE_INTEGER;
  return value;
}

function readPositiveSafeInteger(raw: string | undefined, fallback: number): number {
  const normalized = raw?.trim() ?? "";
  if (!/^\d+$/.test(normalized)) return fallback;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function throwIfWorkflowBatchAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw createWorkflowBatchAbortError(signal);
}

function raceWorkflowBatchWithAbort<T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return operation;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = () => settleReject(createWorkflowBatchAbortError(signal));
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const settleResolve = (value: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const settleReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    // 即使 signal 已在首批 worker 同步启动期间取消，也必须接管 operation 的
    // 后续 rejection，避免调用方已结算后留下未处理 Promise。
    operation.then(settleResolve, settleReject);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function createWorkflowBatchAbortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  if (typeof signal.reason === "string" && signal.reason.trim()) {
    return new Error(signal.reason.trim());
  }
  return new Error("Workflow stopped by user.");
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
