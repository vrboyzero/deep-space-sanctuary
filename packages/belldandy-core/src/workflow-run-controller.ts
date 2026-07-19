import type { WorkflowBudget } from "./workflow-budget-guard.js";

export type WorkflowRunControllerOptions = {
  parentSignal?: AbortSignal;
  deadlineMs?: number;
  onDeadline?: () => unknown;
};

export type WorkflowRunController = {
  signal: AbortSignal;
  abort: (reason?: unknown) => boolean;
  race: <T>(operation: Promise<T>) => Promise<T>;
  dispose: () => void;
};

/**
 * 合并启动期硬上限与本次调用的软请求。调用方只能收紧，不能放宽环境约束。
 */
export function resolveWorkflowRunBudget(
  hardBudget: WorkflowBudget,
  requestedBudget?: WorkflowBudget,
): WorkflowBudget {
  return {
    maxTokens: resolveBudgetLimit(hardBudget.maxTokens, requestedBudget?.maxTokens),
    maxAgentCalls: resolveBudgetLimit(hardBudget.maxAgentCalls, requestedBudget?.maxAgentCalls),
    maxRetries: resolveBudgetLimit(hardBudget.maxRetries, requestedBudget?.maxRetries),
    maxWallClockMs: resolveBudgetLimit(hardBudget.maxWallClockMs, requestedBudget?.maxWallClockMs),
    maxConcurrent: resolveBudgetLimit(hardBudget.maxConcurrent, requestedBudget?.maxConcurrent),
    // 环境若要求 abort，请求不能将其降级为仅告警。
    onExceeded: hardBudget.onExceeded === "abort" || requestedBudget?.onExceeded === "abort"
      ? "abort"
      : requestedBudget?.onExceeded ?? hardBudget.onExceeded ?? "abort",
  };
}

/**
 * 统一管理单个 Workflow run 的父级取消、主动 deadline 与 race 清理。
 * 它只中止协作式等待；已完成的外部副作用仍由各 Adapter 自身负责收敛。
 */
export function createWorkflowRunController(
  options: WorkflowRunControllerOptions = {},
): WorkflowRunController {
  const controller = new AbortController();
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let parentAbortListener: (() => void) | undefined;

  const abort = (reason?: unknown): boolean => {
    if (controller.signal.aborted) {
      return false;
    }
    controller.abort(reason ?? new Error("Workflow stopped by user."));
    return true;
  };

  if (options.parentSignal) {
    const forwardParentAbort = () => abort(options.parentSignal?.reason);
    parentAbortListener = forwardParentAbort;
    if (options.parentSignal.aborted) {
      forwardParentAbort();
    } else {
      options.parentSignal.addEventListener("abort", forwardParentAbort, { once: true });
    }
  }

  if (!controller.signal.aborted && isUsableDeadline(options.deadlineMs)) {
    deadlineTimer = setTimeout(() => {
      let reason: unknown;
      try {
        reason = options.onDeadline?.();
      } catch (error) {
        reason = error;
      }
      abort(reason ?? new Error("Workflow wall-clock budget exceeded."));
    }, options.deadlineMs);
    deadlineTimer.unref?.();
  }

  return {
    signal: controller.signal,
    abort,
    race<T>(operation: Promise<T>): Promise<T> {
      if (controller.signal.aborted) {
        return Promise.reject(toAbortError(controller.signal.reason));
      }

      return new Promise<T>((resolve, reject) => {
        let settled = false;
        const cleanup = () => controller.signal.removeEventListener("abort", onAbort);
        const settleResolve = (value: T) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        };
        const settleReject = (error: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        };
        const onAbort = () => settleReject(toAbortError(controller.signal.reason));

        controller.signal.addEventListener("abort", onAbort, { once: true });
        operation.then(
          (value) => settleResolve(value),
          (error) => settleReject(toAbortError(error)),
        );
      });
    },
    dispose(): void {
      if (deadlineTimer) {
        clearTimeout(deadlineTimer);
        deadlineTimer = undefined;
      }
      if (options.parentSignal && parentAbortListener) {
        options.parentSignal.removeEventListener("abort", parentAbortListener);
        parentAbortListener = undefined;
      }
    },
  };
}

function resolveBudgetLimit(hardLimit: number | undefined, requestedLimit: number | undefined): number | undefined {
  if (hardLimit === undefined) return requestedLimit;
  if (requestedLimit === undefined) return hardLimit;
  return Math.min(hardLimit, requestedLimit);
}

function isUsableDeadline(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

function toAbortError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  if (typeof reason === "string" && reason.trim()) {
    return new Error(reason.trim());
  }
  return new Error("Workflow stopped by user.");
}
