export const GATEWAY_SHUTDOWN_PHASES = [
  "stop_intake",
  "broadcast_shutdown",
  "abort_active",
  "drain",
  "flush_state",
  "close_external",
  "close_transport",
] as const;

export type GatewayShutdownPhase = (typeof GATEWAY_SHUTDOWN_PHASES)[number];

export type GatewayShutdownRequestKind =
  | "signal"
  | "config_restart"
  | "system_restart"
  | "manual";

export type GatewayShutdownRequest = {
  kind: GatewayShutdownRequestKind;
  exitCode: number;
};

export type GatewayShutdownStepContext = {
  generation: number;
  request: GatewayShutdownRequest;
  signal: AbortSignal;
  deadlineAtMs: number;
};

export type GatewayShutdownStep = {
  id: string;
  phase: GatewayShutdownPhase;
  timeoutMs?: number;
  run: (context: GatewayShutdownStepContext) => void | Promise<void>;
};

export type GatewayShutdownFailure = {
  stepId: string;
  phase: GatewayShutdownPhase;
  kind: "step_error" | "step_timeout" | "global_timeout";
};

export type GatewayShutdownResult = {
  generation: number;
  request: GatewayShutdownRequest;
  outcome: "completed" | "completed_with_failures" | "global_timeout";
  startedAtMs: number;
  finishedAtMs: number;
  durationMs: number;
  completedStepCount: number;
  skippedStepCount: number;
  failures: GatewayShutdownFailure[];
};

export type GatewayShutdownRuntimeSnapshot = {
  state: "idle" | "running" | "completed";
  generation: number;
  registeredStepCount: number;
  completedStepCount: number;
  skippedStepCount: number;
  failureCount: number;
  currentPhase: GatewayShutdownPhase | null;
  currentStepId: string | null;
  requestKind: GatewayShutdownRequestKind | null;
};

type GatewayShutdownCoordinatorOptions = {
  defaultStepTimeoutMs?: number;
  globalTimeoutMs?: number;
  now?: () => number;
  scheduleTimeout?: typeof setTimeout;
  cancelTimeout?: typeof clearTimeout;
};

type GatewayShutdownStepResult = {
  status: "completed" | "failed" | "timed_out";
  failureKind?: GatewayShutdownFailure["kind"];
};

const PHASE_ORDER = new Map<GatewayShutdownPhase, number>(
  GATEWAY_SHUTDOWN_PHASES.map((phase, index) => [phase, index]),
);

function readPositiveDuration(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0
    ? Math.floor(Number(value))
    : fallback;
}

function normalizeExitCode(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : 1;
}

/**
 * Gateway 关闭采用显式阶段和资源注册，避免入口文件理解领域内部状态。协调器只负责
 * 顺序、预算与失败隔离；每个 Adapter 仍必须在 AbortSignal 后真实释放自己的资源。
 */
export class GatewayShutdownCoordinator {
  private readonly defaultStepTimeoutMs: number;
  private readonly globalTimeoutMs: number;
  private readonly now: () => number;
  private readonly scheduleTimeout: typeof setTimeout;
  private readonly cancelTimeout: typeof clearTimeout;
  private readonly steps: GatewayShutdownStep[] = [];
  private readonly stepIds = new Set<string>();
  private state: GatewayShutdownRuntimeSnapshot["state"] = "idle";
  private generation = 0;
  private completedStepCount = 0;
  private skippedStepCount = 0;
  private failures: GatewayShutdownFailure[] = [];
  private currentPhase: GatewayShutdownPhase | null = null;
  private currentStepId: string | null = null;
  private requestKind: GatewayShutdownRequestKind | null = null;
  private shutdownPromise: Promise<GatewayShutdownResult> | null = null;

  constructor(options: GatewayShutdownCoordinatorOptions = {}) {
    this.defaultStepTimeoutMs = readPositiveDuration(options.defaultStepTimeoutMs, 5_000);
    this.globalTimeoutMs = readPositiveDuration(options.globalTimeoutMs, 30_000);
    this.now = options.now ?? Date.now;
    this.scheduleTimeout = options.scheduleTimeout ?? setTimeout;
    this.cancelTimeout = options.cancelTimeout ?? clearTimeout;
  }

  register(step: GatewayShutdownStep): void {
    if (this.state !== "idle") {
      throw new Error("Gateway shutdown resources cannot be registered after shutdown starts.");
    }
    const id = typeof step.id === "string" ? step.id.trim() : "";
    if (!id) {
      throw new Error("Gateway shutdown resource id is required.");
    }
    if (this.stepIds.has(id)) {
      throw new Error(`Gateway shutdown resource "${id}" is already registered.`);
    }
    if (!PHASE_ORDER.has(step.phase)) {
      throw new Error(`Gateway shutdown resource "${id}" has an invalid phase.`);
    }
    if (typeof step.run !== "function") {
      throw new Error(`Gateway shutdown resource "${id}" must provide a run function.`);
    }
    this.stepIds.add(id);
    this.steps.push({ ...step, id });
  }

  requestShutdown(request: GatewayShutdownRequest): Promise<GatewayShutdownResult> {
    if (this.shutdownPromise) return this.shutdownPromise;

    const normalizedRequest: GatewayShutdownRequest = {
      kind: request.kind,
      exitCode: normalizeExitCode(request.exitCode),
    };
    this.generation += 1;
    this.state = "running";
    this.requestKind = normalizedRequest.kind;
    this.shutdownPromise = this.executeShutdown(normalizedRequest, this.generation);
    return this.shutdownPromise;
  }

  getRuntimeSnapshot(): GatewayShutdownRuntimeSnapshot {
    return {
      state: this.state,
      generation: this.generation,
      registeredStepCount: this.steps.length,
      completedStepCount: this.completedStepCount,
      skippedStepCount: this.skippedStepCount,
      failureCount: this.failures.length,
      currentPhase: this.currentPhase,
      currentStepId: this.currentStepId,
      requestKind: this.requestKind,
    };
  }

  private async executeShutdown(
    request: GatewayShutdownRequest,
    generation: number,
  ): Promise<GatewayShutdownResult> {
    const startedAtMs = this.now();
    const globalDeadlineAtMs = startedAtMs + this.globalTimeoutMs;
    const orderedSteps = this.steps
      .map((step, registrationOrder) => ({ step, registrationOrder }))
      .sort((left, right) => {
        const phaseDifference = PHASE_ORDER.get(left.step.phase)! - PHASE_ORDER.get(right.step.phase)!;
        return phaseDifference || left.registrationOrder - right.registrationOrder;
      })
      .map(({ step }) => step);
    let globalTimeoutReached = false;

    for (let index = 0; index < orderedSteps.length; index += 1) {
      const step = orderedSteps[index];
      if (this.now() >= globalDeadlineAtMs) {
        this.failures.push({
          stepId: step.id,
          phase: step.phase,
          kind: "global_timeout",
        });
        this.skippedStepCount += orderedSteps.length - index;
        globalTimeoutReached = true;
        break;
      }

      this.currentPhase = step.phase;
      this.currentStepId = step.id;
      const stepResult = await this.runStep(step, request, generation, globalDeadlineAtMs);
      if (stepResult.status === "completed") {
        this.completedStepCount += 1;
        continue;
      }
      this.failures.push({
        stepId: step.id,
        phase: step.phase,
        kind: stepResult.failureKind!,
      });
      if (stepResult.failureKind === "global_timeout") {
        this.skippedStepCount += orderedSteps.length - index - 1;
        globalTimeoutReached = true;
        break;
      }
    }

    this.currentPhase = null;
    this.currentStepId = null;
    this.state = "completed";
    const finishedAtMs = this.now();
    return {
      generation,
      request,
      outcome: globalTimeoutReached
        ? "global_timeout"
        : this.failures.length > 0
          ? "completed_with_failures"
          : "completed",
      startedAtMs,
      finishedAtMs,
      durationMs: Math.max(0, finishedAtMs - startedAtMs),
      completedStepCount: this.completedStepCount,
      skippedStepCount: this.skippedStepCount,
      failures: this.failures.map((failure) => ({ ...failure })),
    };
  }

  private async runStep(
    step: GatewayShutdownStep,
    request: GatewayShutdownRequest,
    generation: number,
    globalDeadlineAtMs: number,
  ): Promise<GatewayShutdownStepResult> {
    const remainingGlobalMs = Math.max(0, globalDeadlineAtMs - this.now());
    const configuredStepTimeoutMs = readPositiveDuration(step.timeoutMs, this.defaultStepTimeoutMs);
    const effectiveTimeoutMs = Math.min(configuredStepTimeoutMs, remainingGlobalMs);
    const failureKind: GatewayShutdownFailure["kind"] = remainingGlobalMs <= configuredStepTimeoutMs
      ? "global_timeout"
      : "step_timeout";
    const controller = new AbortController();
    const deadlineAtMs = this.now() + effectiveTimeoutMs;

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutResult = new Promise<GatewayShutdownStepResult>((resolve) => {
      timeoutHandle = this.scheduleTimeout(() => {
        controller.abort(new Error("Gateway shutdown step deadline exceeded."));
        resolve({ status: "timed_out", failureKind });
      }, effectiveTimeoutMs);
      timeoutHandle.unref?.();
    });
    const executionResult = Promise.resolve()
      .then(() => step.run({ generation, request, signal: controller.signal, deadlineAtMs }))
      .then<GatewayShutdownStepResult, GatewayShutdownStepResult>(
        () => ({ status: "completed" }),
        () => ({ status: "failed", failureKind: "step_error" }),
      );

    const result = await Promise.race([executionResult, timeoutResult]);
    if (timeoutHandle !== undefined) {
      this.cancelTimeout(timeoutHandle);
    }
    return result;
  }
}
