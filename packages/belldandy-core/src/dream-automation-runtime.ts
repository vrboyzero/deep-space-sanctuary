import type { DreamAutoRunResult, DreamRuntime } from "@belldandy/memory";

import type {
  BackgroundRunClaim,
  BackgroundRunClaimCoordinator,
  BackgroundRunClaimResult,
} from "./background-run-coordinator.js";
import type { BackgroundRunBusyContext } from "./background-run-busy-policy.js";
import type {
  MemoryBackgroundJobClaim,
  MemoryBackgroundJobScheduler,
} from "./memory-background-job-scheduler.js";

export interface DreamAutomationRuntimeLogger {
  debug?: (message: string, data?: unknown) => void;
  warn?: (message: string, data?: unknown) => void;
  error?: (message: string, data?: unknown) => void;
}

export interface DreamAutomationTriggerResult {
  source: "heartbeat" | "cron";
  attempted: boolean;
  executed: boolean;
  agentId?: string;
  runId?: string;
  reason?: string;
  skipCode?: string;
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function uniqueAgentIds(agentIds: string[]): string[] {
  return Array.from(new Set(
    agentIds
      .map((item) => normalizeText(item) ?? "")
      .filter(Boolean),
  ));
}

function isClaim(result: BackgroundRunClaimResult): result is BackgroundRunClaim {
  return !("reason" in result);
}

function buildStoppedResult(source: "heartbeat" | "cron"): DreamAutomationTriggerResult {
  return {
    source,
    attempted: false,
    executed: false,
    reason: "dream automation runtime stopped",
    skipCode: "runtime_stopped",
  };
}

async function sortAgentIdsByLastDreamAt(
  agentIds: string[],
  resolveDreamRuntime: (agentId?: string) => DreamRuntime | null,
): Promise<string[]> {
  const items = await Promise.all(agentIds.map(async (agentId, index) => {
    const runtime = resolveDreamRuntime(agentId);
    const state = runtime ? await runtime.getState().catch(() => null) : null;
    const lastDreamAt = typeof state?.lastDreamAt === "string" ? Date.parse(state.lastDreamAt) : Number.NaN;
    return {
      agentId,
      index,
      lastDreamAt: Number.isFinite(lastDreamAt) ? lastDreamAt : Number.NEGATIVE_INFINITY,
    };
  }));
  return items
    .sort((left, right) => {
      if (left.lastDreamAt !== right.lastDreamAt) {
        return left.lastDreamAt - right.lastDreamAt;
      }
      return left.index - right.index;
    })
    .map((item) => item.agentId);
}

export class DreamAutomationRuntime {
  private readonly heartbeatEnabled: boolean;
  private readonly cronEnabled: boolean;
  private readonly resolveDreamRuntime: (agentId?: string) => DreamRuntime | null;
  private readonly resolveDefaultConversationId: (agentId?: string) => string;
  private readonly agentIds: string[];
  private readonly runCoordinator?: BackgroundRunClaimCoordinator;
  private readonly jobScheduler?: Pick<MemoryBackgroundJobScheduler, "acquire">;
  private readonly isBusy?: (context?: BackgroundRunBusyContext) => boolean;
  private readonly logger?: DreamAutomationRuntimeLogger;
  private readonly activeOperations = new Set<Promise<DreamAutomationTriggerResult>>();
  private readonly operationControllers = new Set<AbortController>();
  private accepting = true;

  constructor(options: {
    heartbeatEnabled: boolean;
    cronEnabled: boolean;
    resolveDreamRuntime: (agentId?: string) => DreamRuntime | null;
    resolveDefaultConversationId: (agentId?: string) => string;
    agentIds: string[];
    runCoordinator?: BackgroundRunClaimCoordinator;
    jobScheduler?: Pick<MemoryBackgroundJobScheduler, "acquire">;
    isBusy?: (context?: BackgroundRunBusyContext) => boolean;
    logger?: DreamAutomationRuntimeLogger;
  }) {
    this.heartbeatEnabled = options.heartbeatEnabled;
    this.cronEnabled = options.cronEnabled;
    this.resolveDreamRuntime = options.resolveDreamRuntime;
    this.resolveDefaultConversationId = options.resolveDefaultConversationId;
    this.agentIds = uniqueAgentIds(options.agentIds);
    this.runCoordinator = options.runCoordinator;
    this.jobScheduler = options.jobScheduler;
    this.isBusy = options.isBusy;
    this.logger = options.logger;
  }

  async handleHeartbeatEvent(input: {
    status: "ran" | "skipped" | "failed";
    conversationId?: string;
    reason?: string;
  }): Promise<DreamAutomationTriggerResult> {
    return this.trigger({
      source: "heartbeat",
      driverEnabled: this.heartbeatEnabled,
      sourceStatus: input.status,
      sourceConversationId: input.conversationId,
      reason: normalizeText(input.reason) ?? "heartbeat auto trigger",
    });
  }

  async handleCronEvent(input: {
    status: "ok" | "skipped" | "error";
    sourceId?: string;
    label?: string;
    conversationId?: string;
    reason?: string;
  }): Promise<DreamAutomationTriggerResult> {
    const reasonParts = [
      "cron auto trigger",
      normalizeText(input.sourceId),
      normalizeText(input.label),
      normalizeText(input.reason),
    ].filter(Boolean);
    return this.trigger({
      source: "cron",
      driverEnabled: this.cronEnabled,
      sourceStatus: input.status === "ok" ? "ran" : input.status === "error" ? "failed" : "skipped",
      sourceConversationId: input.conversationId,
      reason: reasonParts.join(" | "),
    });
  }

  stop(): void {
    if (!this.accepting) return;
    this.accepting = false;
    for (const controller of this.operationControllers) {
      if (!controller.signal.aborted) {
        controller.abort(new Error("Dream automation runtime is stopping."));
      }
    }
  }

  async stopAndDrain(): Promise<void> {
    this.stop();
    await Promise.all([...this.activeOperations]);
  }

  private async trigger(input: {
    source: "heartbeat" | "cron";
    driverEnabled: boolean;
    sourceStatus: "ran" | "skipped" | "failed";
    sourceConversationId?: string;
    reason: string;
  }): Promise<DreamAutomationTriggerResult> {
    if (!this.accepting) {
      return buildStoppedResult(input.source);
    }
    const controller = new AbortController();
    this.operationControllers.add(controller);
    const task = this.triggerInternal(input, controller.signal).finally(() => {
      this.operationControllers.delete(controller);
    });
    this.activeOperations.add(task);
    void task.then(
      () => this.activeOperations.delete(task),
      () => this.activeOperations.delete(task),
    );
    return task;
  }

  private async triggerInternal(input: {
    source: "heartbeat" | "cron";
    driverEnabled: boolean;
    sourceStatus: "ran" | "skipped" | "failed";
    sourceConversationId?: string;
    reason: string;
  }, signal: AbortSignal): Promise<DreamAutomationTriggerResult> {
    if (!this.accepting || signal.aborted) {
      return buildStoppedResult(input.source);
    }
    if (!input.driverEnabled) {
      return {
        source: input.source,
        attempted: false,
        executed: false,
        reason: `${input.source} dream automation disabled`,
        skipCode: "driver_disabled",
      };
    }
    if (input.sourceStatus !== "ran") {
      return {
        source: input.source,
        attempted: false,
        executed: false,
        reason: `${input.source} source status=${input.sourceStatus}`,
        skipCode: "source_not_ran",
      };
    }
    const orderedAgentIds = await sortAgentIdsByLastDreamAt(this.agentIds, this.resolveDreamRuntime);
    for (const agentId of orderedAgentIds) {
      if (!this.accepting || signal.aborted) {
        return buildStoppedResult(input.source);
      }
      const runtime = this.resolveDreamRuntime(agentId);
      if (!runtime) continue;
      const conversationId = agentId === "default" && normalizeText(input.sourceConversationId)
        ? normalizeText(input.sourceConversationId)
        : this.resolveDefaultConversationId(agentId);
      let claim: BackgroundRunClaim | MemoryBackgroundJobClaim | undefined;
      let releaseFailedClaim: (() => Promise<void>) | undefined;
      if (this.jobScheduler || this.runCoordinator) {
        const claimInput = {
          kind: "dream" as const,
          key: agentId,
          priority: "low" as const,
          signal,
        };
        const admission = this.jobScheduler
          ? await this.jobScheduler.acquire({
            family: "dream",
            agentId,
            priority: "low",
            estimatedTokenUnits: typeof (runtime as DreamRuntime & {
              getBackgroundJobTokenEstimate?: () => number;
            }).getBackgroundJobTokenEstimate === "function"
              ? (runtime as DreamRuntime & { getBackgroundJobTokenEstimate: () => number }).getBackgroundJobTokenEstimate()
              : 5_000,
            signal,
          })
          : this.runCoordinator!.acquire
            ? await this.runCoordinator!.acquire(claimInput)
            : this.runCoordinator!.tryClaim(claimInput);
        if (!isClaim(admission)) {
          if (!this.accepting || signal.aborted) {
            return buildStoppedResult(input.source);
          }
          this.logger?.debug?.("dream automation admission skipped", {
            source: input.source,
            agentId,
            reason: admission.reason,
          });
          continue;
        }
        claim = admission;
        releaseFailedClaim = this.jobScheduler
          ? () => (admission as MemoryBackgroundJobClaim).release("failed")
          : async () => (admission as BackgroundRunClaim).release();
      }
      if (this.isBusy?.(claim ? {
        ownClaimKind: "dream",
        relatedClaimKind: input.source,
      } : undefined)) {
        await claim?.release();
        return {
          source: input.source,
          attempted: false,
          executed: false,
          reason: "gateway busy",
          skipCode: "busy",
        };
      }
      let result: DreamAutoRunResult;
      try {
        result = await runtime.maybeAutoRun({
          conversationId,
          triggerMode: input.source,
          reason: input.reason,
          signal: claim?.signal ?? signal,
        });
      } catch (error) {
        await releaseFailedClaim?.();
        if (!this.accepting || signal.aborted) {
          return buildStoppedResult(input.source);
        }
        this.logger?.error?.("dream automation trigger failed", {
          source: input.source,
          agentId,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      if (!result.executed) {
        if (claim) {
          const completion = await claim.complete(() => {
            this.logger?.debug?.("dream automation skipped", {
              source: input.source,
              agentId,
              skipCode: result.skipCode,
              reason: result.skipReason,
            });
          });
          if (!completion.applied) {
            return !this.accepting || signal.aborted
              ? buildStoppedResult(input.source)
              : {
                source: input.source,
                attempted: true,
                executed: false,
                reason: "dream automation claim expired",
                skipCode: "claim_expired",
              };
          }
        } else {
          this.logger?.debug?.("dream automation skipped", {
            source: input.source,
            agentId,
            skipCode: result.skipCode,
            reason: result.skipReason,
          });
        }
        continue;
      }
      const completedResult: DreamAutomationTriggerResult = {
        source: input.source,
        attempted: true,
        executed: true,
        agentId,
        runId: result.record?.id,
      };
      if (claim) {
        const completion = await claim.complete(() => {
          this.logger?.debug?.("dream automation executed", {
            source: input.source,
            agentId,
            runId: result.record?.id,
          });
          return completedResult;
        });
        if (!completion.applied) {
          return !this.accepting || signal.aborted
            ? buildStoppedResult(input.source)
            : {
              source: input.source,
              attempted: true,
              executed: false,
              reason: "dream automation claim expired",
              skipCode: "claim_expired",
            };
        }
        return completion.value;
      }
      this.logger?.debug?.("dream automation executed", {
        source: input.source,
        agentId,
        runId: result.record?.id,
      });
      return completedResult;
    }

    return {
      source: input.source,
      attempted: true,
      executed: false,
      reason: "no eligible agent for automatic dream",
      skipCode: "no_eligible_agent",
    };
  }
}
