import type {
  BackgroundRunClaimCoordinator,
  BackgroundRunClaimResult,
} from "./background-run-coordinator.js";
import type {
  MemoryBackgroundJobClaimResult,
  MemoryBackgroundJobScheduler,
} from "./memory-background-job-scheduler.js";

export type MemoryIdleSummaryManager = {
  isPaused: boolean;
  pause: () => void;
  resume: () => void;
  runIdleSummaries: (options?: { signal?: AbortSignal }) => Promise<number>;
};

export type MemoryIdleSummaryRuntimeHandle = {
  onAgentStart: () => void;
  onAgentEnd: () => void;
  runOnce: () => Promise<void>;
  stop: () => void;
  stopAndDrain: () => Promise<void>;
};

export type MemoryIdleSummaryRuntimeOptions = {
  summaryEnabled: boolean;
  intervalMs: number;
  resumeDelayMs?: number;
  listManagers: () => MemoryIdleSummaryManager[];
  runCoordinator?: BackgroundRunClaimCoordinator;
  jobScheduler?: Pick<MemoryBackgroundJobScheduler, "acquire">;
  resolveAgentId?: (manager: MemoryIdleSummaryManager, index: number) => string;
  estimatedTokenUnitsPerRun?: number;
  logger?: {
    info?: (message: string) => void;
    error?: (message: string) => void;
  };
};

let currentRuntime: MemoryIdleSummaryRuntimeHandle | undefined;

function isClaim(result: BackgroundRunClaimResult): result is Exclude<BackgroundRunClaimResult, { reason: string }> {
  return !("reason" in result);
}

function isMemoryJobClaim(
  result: MemoryBackgroundJobClaimResult,
): result is Exclude<MemoryBackgroundJobClaimResult, { reason: string }> {
  return !("reason" in result);
}

export function startMemoryIdleSummaryRuntime(
  options: MemoryIdleSummaryRuntimeOptions,
): MemoryIdleSummaryRuntimeHandle {
  currentRuntime?.stop();
  let accepting = true;
  let activeAgentCount = 0;
  let resumeTimer: ReturnType<typeof setTimeout> | undefined;
  const activeOperations = new Set<Promise<void>>();
  const operationControllers = new Set<AbortController>();

  const runManager = async (manager: MemoryIdleSummaryManager, index: number): Promise<void> => {
    const controller = new AbortController();
    operationControllers.add(controller);
    try {
      const input = {
        kind: "memory" as const,
        key: `idle-summary-${index}`,
        priority: "low" as const,
        signal: controller.signal,
      };
      let admission: Exclude<MemoryBackgroundJobClaimResult, { reason: string }> | Exclude<BackgroundRunClaimResult, { reason: string }>;
      let releaseFailed: () => Promise<void>;
      try {
        if (options.jobScheduler) {
          const memoryAdmission = await options.jobScheduler.acquire({
            family: "idle_summary",
            agentId: options.resolveAgentId?.(manager, index) ?? `manager-${index}`,
            priority: "low",
            estimatedTokenUnits: Math.max(1, Math.floor(options.estimatedTokenUnitsPerRun ?? 2_300)),
            signal: controller.signal,
          });
          if (!isMemoryJobClaim(memoryAdmission)) return;
          admission = memoryAdmission;
          releaseFailed = () => memoryAdmission.release("failed");
        } else if (options.runCoordinator) {
          const legacyAdmission = options.runCoordinator.acquire
            ? await options.runCoordinator.acquire(input)
            : options.runCoordinator.tryClaim(input);
          if (!isClaim(legacyAdmission)) return;
          admission = legacyAdmission;
          releaseFailed = async () => legacyAdmission.release();
        } else {
          options.logger?.error?.("Idle summary failed: background scheduler unavailable");
          return;
        }
      } catch (error) {
        options.logger?.error?.(
          `Idle summary failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
      if (!accepting) {
        await admission.release();
        return;
      }
      try {
        const count = await manager.runIdleSummaries({ signal: admission.signal });
        await admission.complete(() => {
          if (count > 0) {
            options.logger?.info?.(`Idle summary run: generated ${count} summaries`);
          }
        });
      } catch (error) {
        options.logger?.error?.(
          `Idle summary failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        await releaseFailed();
      }
    } finally {
      operationControllers.delete(controller);
    }
  };

  const runOnce = (): Promise<void> => {
    if (!accepting || !options.summaryEnabled || activeAgentCount > 0) {
      return Promise.resolve();
    }
    let managers: MemoryIdleSummaryManager[];
    try {
      managers = [...new Set(options.listManagers())];
    } catch (error) {
      options.logger?.error?.(
        `Idle summary failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return Promise.resolve();
    }
    const operation = Promise.all(
      managers.map((manager, index) => runManager(manager, index)),
    ).then(() => undefined);
    activeOperations.add(operation);
    const removeOperation = (): void => {
      activeOperations.delete(operation);
    };
    void operation.then(removeOperation, removeOperation);
    return operation;
  };

  const timer = options.summaryEnabled
    ? setInterval(() => {
      void runOnce();
    }, options.intervalMs)
    : undefined;
  timer?.unref?.();

  const onAgentStart = (): void => {
    if (!accepting) return;
    activeAgentCount++;
    if (resumeTimer) {
      clearTimeout(resumeTimer);
      resumeTimer = undefined;
    }
    for (const manager of new Set(options.listManagers())) {
      if (!manager.isPaused) {
        manager.pause();
      }
    }
  };

  const onAgentEnd = (): void => {
    if (!accepting) return;
    activeAgentCount = Math.max(0, activeAgentCount - 1);
    if (activeAgentCount > 0) return;
    resumeTimer = setTimeout(() => {
      resumeTimer = undefined;
      if (!accepting || activeAgentCount > 0) return;
      for (const manager of new Set(options.listManagers())) {
        manager.resume();
      }
    }, options.resumeDelayMs ?? 3_000);
    resumeTimer.unref?.();
  };

  let handle: MemoryIdleSummaryRuntimeHandle;
  const stop = (): void => {
    if (!accepting) return;
    accepting = false;
    if (timer) clearInterval(timer);
    if (resumeTimer) {
      clearTimeout(resumeTimer);
      resumeTimer = undefined;
    }
    for (const controller of operationControllers) {
      if (!controller.signal.aborted) {
        controller.abort(new Error("Memory idle summary runtime is stopping."));
      }
    }
    if (currentRuntime === handle) {
      currentRuntime = undefined;
    }
  };

  handle = {
    onAgentStart,
    onAgentEnd,
    runOnce,
    stop,
    stopAndDrain: async () => {
      stop();
      await Promise.all([...activeOperations]);
    },
  };
  currentRuntime = handle;
  return handle;
}
