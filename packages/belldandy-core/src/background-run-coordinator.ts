export type BackgroundRunKind = "cron" | "heartbeat";

export type BackgroundRunClaimInput = {
  kind: BackgroundRunKind;
  key: string;
};

export type BackgroundRunClaim = {
  release: () => void;
};

export type BackgroundRunClaimResult = BackgroundRunClaim | {
  reason: string;
};

export type BackgroundRunClaimCoordinator = {
  tryClaim(input: BackgroundRunClaimInput): BackgroundRunClaimResult;
};

export type BackgroundRunRuntimeSnapshot = {
  activeCount: number;
  queuedCount: number;
  capacity: number;
  availableSlots: number;
  foregroundActiveCount: number;
  activeByKind: Record<BackgroundRunKind, number>;
};

export type BackgroundRunCoordinatorOptions = {
  maxConcurrentRuns?: number;
  maxConcurrentByKind?: Partial<Record<BackgroundRunKind, number>>;
  getForegroundActiveCount?: () => number;
};

const DEFAULT_MAX_CONCURRENT_RUNS = 4;
const DEFAULT_MAX_CONCURRENT_BY_KIND: Record<BackgroundRunKind, number> = {
  cron: 3,
  heartbeat: 1,
};
const MAX_CLAIM_KEY_LENGTH = 160;

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0
    ? Math.floor(Number(value))
    : fallback;
}

function normalizeClaimKey(value: string): string | undefined {
  const key = String(value ?? "").trim();
  return key && key.length <= MAX_CLAIM_KEY_LENGTH ? key : undefined;
}

/**
 * 单进程后台运行预算 owner。仅维护受控的 kind/count，不保留 job、prompt 或会话内容。
 */
export class BackgroundRunCoordinator implements BackgroundRunClaimCoordinator {
  private readonly maxConcurrentRuns: number;
  private readonly maxConcurrentByKind: Record<BackgroundRunKind, number>;
  private readonly getForegroundActiveCount: () => number;
  private readonly activeKeys = new Set<string>();
  private readonly activeByKind: Record<BackgroundRunKind, number> = {
    cron: 0,
    heartbeat: 0,
  };

  constructor(options: BackgroundRunCoordinatorOptions = {}) {
    this.maxConcurrentRuns = normalizePositiveInteger(
      options.maxConcurrentRuns,
      DEFAULT_MAX_CONCURRENT_RUNS,
    );
    this.maxConcurrentByKind = {
      cron: normalizePositiveInteger(options.maxConcurrentByKind?.cron, DEFAULT_MAX_CONCURRENT_BY_KIND.cron),
      heartbeat: normalizePositiveInteger(options.maxConcurrentByKind?.heartbeat, DEFAULT_MAX_CONCURRENT_BY_KIND.heartbeat),
    };
    this.getForegroundActiveCount = options.getForegroundActiveCount ?? (() => 0);
  }

  tryClaim(input: BackgroundRunClaimInput): BackgroundRunClaimResult {
    const key = normalizeClaimKey(input.key);
    if (!key) {
      return { reason: "Background run key is required." };
    }
    const identity = `${input.kind}:${key}`;
    if (this.activeKeys.has(identity)) {
      return { reason: `Background ${input.kind} run ${key} is already running.` };
    }
    if (this.activeByKind[input.kind] >= this.maxConcurrentByKind[input.kind]) {
      return { reason: `Background ${input.kind} run capacity has been reached.` };
    }
    if (this.getActiveCount() >= this.maxConcurrentRuns) {
      return { reason: "Background run coordinator has reached its concurrent run limit." };
    }

    this.activeKeys.add(identity);
    this.activeByKind[input.kind]++;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.activeKeys.delete(identity);
        this.activeByKind[input.kind] = Math.max(0, this.activeByKind[input.kind] - 1);
      },
    };
  }

  isForegroundBusy(): boolean {
    return this.readForegroundActiveCount() > 0;
  }

  getRuntimeSnapshot(): BackgroundRunRuntimeSnapshot {
    const activeCount = this.getActiveCount();
    return {
      activeCount,
      queuedCount: 0,
      capacity: this.maxConcurrentRuns,
      availableSlots: Math.max(0, this.maxConcurrentRuns - activeCount),
      foregroundActiveCount: this.readForegroundActiveCount(),
      activeByKind: { ...this.activeByKind },
    };
  }

  private getActiveCount(): number {
    return this.activeByKind.cron + this.activeByKind.heartbeat;
  }

  private readForegroundActiveCount(): number {
    try {
      const count = this.getForegroundActiveCount();
      return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    } catch {
      return 0;
    }
  }
}
