export const DEFAULT_TOP_LEVEL_CONVERSATION_IDLE_TTL_MS = 10 * 60 * 1_000;
export const DEFAULT_TOP_LEVEL_CONVERSATION_MAX_IDLE = 256;
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

export type TopLevelConversationReleaseOwner = {
  key: object;
  priority?: number;
  release: () => void | Promise<void>;
};

export type TopLevelConversationLease = {
  addOwner(owner: TopLevelConversationReleaseOwner): void;
  release(): Promise<void>;
};

export type TopLevelConversationLifecycleSnapshot = {
  activeConversationCount: number;
  activeLeaseCount: number;
  idleConversationCount: number;
  retainedConversationCount: number;
  pendingReleaseCount: number;
  evictedCount: number;
  releaseFailureCount: number;
  oldestIdleAgeMs: number;
  idleTtlMs: number;
  maxIdleConversations: number;
};

type ReleaseOwnerRecord = {
  priority: number;
  release: () => void | Promise<void>;
};

type ConversationLifecycleEntry = {
  activeLeaseCount: number;
  lastActiveAt: number;
  owners: Map<object, ReleaseOwnerRecord>;
  pendingRelease?: Promise<void>;
};

export class TopLevelConversationLifecycle {
  private readonly entries = new Map<string, ConversationLifecycleEntry>();
  private readonly pendingReleases = new Set<Promise<void>>();
  private readonly idleTtlMs: number;
  private readonly maxIdleConversations: number;
  private readonly now: () => number;
  private readonly sweepTimer: ReturnType<typeof setInterval> | undefined;
  private disposed = false;
  private evictedCount = 0;
  private releaseFailureCount = 0;

  constructor(opts: {
    idleTtlMs?: number;
    maxIdleConversations?: number;
    sweepIntervalMs?: number;
    now?: () => number;
    startTimer?: boolean;
  } = {}) {
    this.idleTtlMs = normalizeNonNegativeInteger(
      opts.idleTtlMs,
      DEFAULT_TOP_LEVEL_CONVERSATION_IDLE_TTL_MS,
    );
    this.maxIdleConversations = normalizeNonNegativeInteger(
      opts.maxIdleConversations,
      DEFAULT_TOP_LEVEL_CONVERSATION_MAX_IDLE,
    );
    this.now = opts.now ?? Date.now;

    const sweepIntervalMs = normalizePositiveInteger(
      opts.sweepIntervalMs,
      Math.min(DEFAULT_SWEEP_INTERVAL_MS, Math.max(1_000, Math.floor(this.idleTtlMs / 2))),
    );
    if (opts.startTimer !== false && this.idleTtlMs > 0) {
      this.sweepTimer = setInterval(() => {
        void this.sweep();
      }, sweepIntervalMs);
      this.sweepTimer.unref?.();
    }
  }

  async acquire(input: {
    conversationId: string;
    owners?: TopLevelConversationReleaseOwner[];
  }): Promise<TopLevelConversationLease> {
    const conversationId = normalizeConversationId(input.conversationId);

    while (true) {
      if (this.disposed) {
        throw new Error("top_level_conversation_lifecycle_disposed");
      }
      const existing = this.entries.get(conversationId);
      if (existing?.pendingRelease) {
        // 旧 owner 清理已开始时，新请求必须等待清理完成后以新 entry 接管。
        await existing.pendingRelease;
        continue;
      }

      const entry = existing ?? {
        activeLeaseCount: 0,
        lastActiveAt: this.now(),
        owners: new Map<object, ReleaseOwnerRecord>(),
      };
      entry.activeLeaseCount += 1;
      entry.lastActiveAt = this.now();
      this.entries.set(conversationId, entry);
      for (const owner of input.owners ?? []) {
        this.setOwner(entry, owner);
      }

      let released = false;
      return {
        addOwner: (owner) => {
          if (released || this.entries.get(conversationId) !== entry) return;
          this.setOwner(entry, owner);
        },
        release: async () => {
          if (released) return;
          released = true;
          if (this.entries.get(conversationId) !== entry) return;
          entry.activeLeaseCount = Math.max(0, entry.activeLeaseCount - 1);
          entry.lastActiveAt = this.now();
          if (this.disposed && entry.activeLeaseCount === 0) {
            await this.evictEntry(conversationId, entry);
            return;
          }
          await this.sweep();
        },
      };
    }
  }

  async sweep(): Promise<void> {
    const now = this.now();
    const idleEntries = [...this.entries.entries()]
      .filter(([, entry]) => entry.activeLeaseCount === 0 && !entry.pendingRelease)
      .sort((left, right) => left[1].lastActiveAt - right[1].lastActiveAt);
    const selected = new Set<string>();

    if (this.idleTtlMs > 0) {
      for (const [conversationId, entry] of idleEntries) {
        if (now - entry.lastActiveAt >= this.idleTtlMs) {
          selected.add(conversationId);
        }
      }
    }

    const retainedAfterTtl = idleEntries.length - selected.size;
    const overCapacity = Math.max(0, retainedAfterTtl - this.maxIdleConversations);
    if (overCapacity > 0) {
      let remaining = overCapacity;
      for (const [conversationId] of idleEntries) {
        if (selected.has(conversationId)) continue;
        selected.add(conversationId);
        remaining -= 1;
        if (remaining <= 0) break;
      }
    }

    await Promise.all([...selected].map(async (conversationId) => {
      const entry = this.entries.get(conversationId);
      if (entry) {
        await this.evictEntry(conversationId, entry);
      }
    }));
  }

  getRuntimeSnapshot(): TopLevelConversationLifecycleSnapshot {
    const now = this.now();
    let activeConversationCount = 0;
    let activeLeaseCount = 0;
    let idleConversationCount = 0;
    let oldestIdleAgeMs = 0;

    for (const entry of this.entries.values()) {
      if (entry.activeLeaseCount > 0) {
        activeConversationCount += 1;
        activeLeaseCount += entry.activeLeaseCount;
        continue;
      }
      idleConversationCount += 1;
      oldestIdleAgeMs = Math.max(oldestIdleAgeMs, Math.max(0, now - entry.lastActiveAt));
    }

    return {
      activeConversationCount,
      activeLeaseCount,
      idleConversationCount,
      retainedConversationCount: this.entries.size,
      pendingReleaseCount: this.pendingReleases.size,
      evictedCount: this.evictedCount,
      releaseFailureCount: this.releaseFailureCount,
      oldestIdleAgeMs,
      idleTtlMs: this.idleTtlMs,
      maxIdleConversations: this.maxIdleConversations,
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      await Promise.all([...this.pendingReleases]);
      return;
    }
    this.disposed = true;
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
    }

    const idleEntries = [...this.entries.entries()]
      .filter(([, entry]) => entry.activeLeaseCount === 0);
    await Promise.all(idleEntries.map(([conversationId, entry]) => (
      this.evictEntry(conversationId, entry)
    )));
    await Promise.all([...this.pendingReleases]);
  }

  private setOwner(entry: ConversationLifecycleEntry, owner: TopLevelConversationReleaseOwner): void {
    entry.owners.set(owner.key, {
      priority: normalizePriority(owner.priority),
      release: owner.release,
    });
  }

  private evictEntry(
    conversationId: string,
    entry: ConversationLifecycleEntry,
  ): Promise<void> {
    if (entry.activeLeaseCount > 0) return Promise.resolve();
    if (entry.pendingRelease) return entry.pendingRelease;

    const releaseOwners = [...entry.owners.values()]
      .sort((left, right) => left.priority - right.priority);
    const pendingRelease = (async () => {
      for (const owner of releaseOwners) {
        try {
          await owner.release();
        } catch {
          // 单个 owner 失败不能阻断其它 owner 或导致 retention Map 无界保留。
          this.releaseFailureCount += 1;
        }
      }
    })().finally(() => {
      if (this.entries.get(conversationId) === entry && entry.activeLeaseCount === 0) {
        this.entries.delete(conversationId);
        this.evictedCount += 1;
      }
      this.pendingReleases.delete(pendingRelease);
    });

    entry.pendingRelease = pendingRelease;
    this.pendingReleases.add(pendingRelease);
    return pendingRelease;
  }
}

function normalizeConversationId(value: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error("conversationId is required");
  }
  return normalized;
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.floor(value));
}

function normalizePriority(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.floor(value);
}
