import type { SpawnResult } from "@belldandy/agent";

import type { WorkflowBudgetGuard } from "./workflow-budget-guard.js";

export type WorkflowAgentCallRunResult = {
  result: SpawnResult;
  tokenCount?: number;
};

export type RunWorkflowAgentCallOptions = {
  requestedMaxRetries?: number;
  budgetGuard: WorkflowBudgetGuard;
  abortSignal?: AbortSignal;
  beforeFirstAttempt: () => void;
  spawn: (attemptIndex: number) => Promise<SpawnResult>;
  estimateTokens: (output: string) => number;
};

/**
 * Workflow Agent 调用的唯一 retry owner。每次 attempt 都在外部 spawn 前取得独立预算许可。
 */
export async function runWorkflowAgentCall(
  options: RunWorkflowAgentCallOptions,
): Promise<WorkflowAgentCallRunResult> {
  const maxRetries = resolveRequestedMaxRetries(options.requestedMaxRetries);
  let attemptIndex = 0;

  while (true) {
    throwIfWorkflowAgentCallAborted(options.abortSignal);
    const reservation = options.budgetGuard.reserveAgentCall();
    let spawnStarted = false;

    try {
      if (attemptIndex > 0) {
        // reservation 先于 retry 预算，任一 admission 失败都能在 spawn 前完整回滚。
        options.budgetGuard.consumeRetry();
      } else {
        options.beforeFirstAttempt();
      }

      throwIfWorkflowAgentCallAborted(options.abortSignal);
      spawnStarted = true;
      const result = await options.spawn(attemptIndex);
      throwIfWorkflowAgentCallAborted(options.abortSignal);

      if (result.success) {
        const tokenCount = options.estimateTokens(result.output);
        reservation.settle(tokenCount);
        return { result, tokenCount };
      }

      reservation.release();
      if (attemptIndex >= maxRetries) {
        return { result };
      }
    } catch (error) {
      if (spawnStarted) {
        reservation.release();
      } else {
        reservation.cancel();
      }
      throw error;
    }

    attemptIndex++;
  }
}

function resolveRequestedMaxRetries(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Workflow agent maxRetries must be a non-negative safe integer.");
  }
  return value;
}

function throwIfWorkflowAgentCallAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  if (typeof signal.reason === "string" && signal.reason.trim()) {
    throw new Error(signal.reason.trim());
  }
  throw new Error("Workflow stopped by user.");
}
