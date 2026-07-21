import type {
  BackgroundRunClaim,
  BackgroundRunClaimCoordinator,
  BackgroundRunClaimResult,
  BackgroundRunPriority,
} from "./background-run-coordinator.js";
import type {
  MemoryBudgetDecision,
  MemoryRuntimeBudgetGuard,
  MemoryRuntimeUsageAccounting,
  MemoryUsageOutcome,
} from "./memory-runtime-budget.js";

export type MemoryBackgroundJobFamily = "idle_summary" | "durable_extraction" | "dream";

export type MemoryBackgroundJobClaim = {
  generation: number;
  signal: AbortSignal;
  complete: <T>(commit: () => T | Promise<T>) => Promise<
    | { applied: true; value: T }
    | { applied: false }
  >;
  release: (outcome?: Extract<MemoryUsageOutcome, "skipped" | "failed">) => Promise<void>;
};

export type MemoryBackgroundJobClaimResult = MemoryBackgroundJobClaim | {
  reason: string;
  reasonCode?: string;
  observedRuns?: number;
  maxRuns?: number;
  observedTokenUnits?: number;
  requestedTokenUnits?: number;
  maxTokenUnits?: number;
  retryAfterMs?: number;
};

export type MemoryBackgroundJobSchedulerOptions = {
  runCoordinator: BackgroundRunClaimCoordinator;
  budgetGuard: MemoryRuntimeBudgetGuard;
  usageAccounting: MemoryRuntimeUsageAccounting;
};

export type MemoryBackgroundJobAcquireInput = {
  family: MemoryBackgroundJobFamily;
  agentId: string;
  priority: BackgroundRunPriority;
  estimatedTokenUnits: number;
  signal?: AbortSignal;
};

function normalizeAgentId(value: string): string {
  const normalized = String(value ?? "").trim();
  return normalized || "default";
}

function normalizeTokenUnits(value: number): number {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function isRunClaim(result: BackgroundRunClaimResult): result is BackgroundRunClaim {
  return !("reason" in result);
}

function toCoordinatorKind(family: MemoryBackgroundJobFamily): "memory" | "dream" {
  return family === "dream" ? "dream" : "memory";
}

function toBudgetRejection(decision: MemoryBudgetDecision): MemoryBackgroundJobClaimResult {
  return {
    reason: decision.reasonMessage ?? decision.reasonCode ?? "Memory background model budget exceeded.",
    reasonCode: decision.reasonCode,
    observedRuns: decision.observedRuns,
    maxRuns: decision.maxRuns,
    observedTokenUnits: decision.observedTokenUnits,
    requestedTokenUnits: decision.requestedTokenUnits,
    maxTokenUnits: decision.maxTokenUnits,
    retryAfterMs: decision.retryAfterMs,
  };
}

/** Core owner for Memory model admission, per-agent singleflight, and run/token budgets. */
export class MemoryBackgroundJobScheduler {
  private readonly runCoordinator: BackgroundRunClaimCoordinator;
  private readonly budgetGuard: MemoryRuntimeBudgetGuard;
  private readonly usageAccounting: MemoryRuntimeUsageAccounting;
  private budgetAdmissionChain = Promise.resolve();

  constructor(options: MemoryBackgroundJobSchedulerOptions) {
    this.runCoordinator = options.runCoordinator;
    this.budgetGuard = options.budgetGuard;
    this.usageAccounting = options.usageAccounting;
  }

  async acquire(input: MemoryBackgroundJobAcquireInput): Promise<MemoryBackgroundJobClaimResult> {
    const agentId = normalizeAgentId(input.agentId);
    const tokenUnits = normalizeTokenUnits(input.estimatedTokenUnits);
    const coordinatorInput = {
      kind: toCoordinatorKind(input.family),
      key: `${input.family}:${agentId}`,
      singleflightKey: `memory-agent:${agentId}`,
      priority: input.priority,
      signal: input.signal,
    } as const;
    const admission = this.runCoordinator.acquire
      ? await this.runCoordinator.acquire(coordinatorInput)
      : this.runCoordinator.tryClaim(coordinatorInput);
    if (!isRunClaim(admission)) {
      return {
        reason: admission.reason,
        reasonCode: admission.reason.includes("singleflight")
          ? "memory_agent_singleflight_active"
          : "memory_background_admission_rejected",
      };
    }

    const budgetDecision = await this.reserveBudget({
      family: input.family,
      agentId,
      tokenUnits,
    });
    if (!budgetDecision.allowed) {
      admission.release();
      return toBudgetRejection(budgetDecision);
    }

    let settled = false;
    const recordOutcome = (outcome: MemoryUsageOutcome): Promise<void> => {
      return this.usageAccounting.recordEvent({
        consumer: "background_model_run",
        outcome,
        timestamp: Date.now(),
        quantity: tokenUnits,
        metadata: {
          family: input.family,
          agentId,
          generation: admission.generation,
        },
      }).catch(() => undefined);
    };
    return {
      generation: admission.generation,
      signal: admission.signal,
      complete: async <T>(commit: () => T | Promise<T>) => {
        const completion = await admission.complete(commit);
        if (!settled) {
          settled = true;
          await recordOutcome(completion.applied ? "completed" : "skipped");
        }
        return completion;
      },
      release: async (outcome = "skipped") => {
        if (settled) return;
        settled = true;
        admission.release();
        await recordOutcome(outcome);
      },
    };
  }

  private reserveBudget(input: {
    family: MemoryBackgroundJobFamily;
    agentId: string;
    tokenUnits: number;
  }): Promise<MemoryBudgetDecision> {
    let decision!: MemoryBudgetDecision;
    const run = this.budgetAdmissionChain.then(async () => {
      decision = await this.budgetGuard.evaluateBackgroundModelRun(input.tokenUnits);
      if (decision.allowed) {
        await this.usageAccounting.recordEvent({
          consumer: "background_model_run",
          outcome: "started",
          timestamp: Date.now(),
          quantity: input.tokenUnits,
          metadata: {
            family: input.family,
            agentId: input.agentId,
          },
        });
      } else {
        await this.usageAccounting.recordEvent({
          consumer: "background_model_run",
          outcome: "blocked",
          timestamp: Date.now(),
          metadata: {
            family: input.family,
            agentId: input.agentId,
            reasonCode: decision.reasonCode,
            observedRuns: decision.observedRuns,
            maxRuns: decision.maxRuns,
            observedTokenUnits: decision.observedTokenUnits,
            requestedTokenUnits: decision.requestedTokenUnits,
            maxTokenUnits: decision.maxTokenUnits,
            retryAfterMs: decision.retryAfterMs,
          },
        });
      }
    });
    this.budgetAdmissionChain = run.catch(() => undefined);
    return run.then(() => decision);
  }
}
