export type ConversationRunStopState = "running" | "stop_requested" | "stopped";

export type ConversationRunHandle = {
  conversationId: string;
  runId: string;
  agentId?: string;
  startedAt: number;
  state: ConversationRunStopState;
  stopRequestedAt?: number;
  stoppedAt?: number;
  stopReason?: string;
  stop: (reason?: string) => boolean | Promise<boolean>;
};

export type ConversationRunStopRequest = {
  conversationId: string;
  runId?: string;
  reason?: string;
};

export type ConversationRunStopResult = {
  accepted: boolean;
  runId?: string;
  state: "stop_requested" | "not_found" | "run_mismatch";
};

export type ConversationRunRuntimeSnapshot = {
  activeCount: number;
  stopRequestedCount: number;
};

export class ConversationRunRegistry {
  private readonly handles = new Map<string, Map<string, ConversationRunHandle>>();
  private readonly idleWaiters = new Set<() => void>();
  private accepting = true;

  register(handle: ConversationRunHandle): void {
    if (!this.accepting) {
      throw new Error("Conversation run registry is not accepting new runs.");
    }
    const scoped = this.handles.get(handle.conversationId) ?? new Map<string, ConversationRunHandle>();
    scoped.set(handle.runId, { ...handle });
    this.handles.set(handle.conversationId, scoped);
  }

  get(conversationId: string): ConversationRunHandle | undefined {
    const scoped = this.handles.get(conversationId);
    const handle = this.selectLatestHandle(scoped);
    return handle ? { ...handle } : undefined;
  }

  async requestStop(input: ConversationRunStopRequest): Promise<ConversationRunStopResult> {
    const scoped = this.handles.get(input.conversationId);
    const latest = this.selectLatestHandle(scoped);
    if (!scoped || !latest) {
      return { accepted: false, state: "not_found" };
    }

    const current = input.runId
      ? scoped.get(input.runId)
      : this.selectLatestStoppableHandle(scoped);
    if (!current) {
      return {
        accepted: false,
        state: input.runId ? "run_mismatch" : "not_found",
        runId: latest.runId,
      };
    }

    if (current.state === "running") {
      const next: ConversationRunHandle = {
        ...current,
        state: "stop_requested",
        stopRequestedAt: Date.now(),
      };
      if (typeof input.reason === "string" && input.reason.trim()) {
        next.stopReason = input.reason.trim();
      }
      scoped.set(current.runId, next);
      this.handles.set(input.conversationId, scoped);
    }

    await Promise.resolve(current.stop(input.reason));
    return {
      accepted: true,
      runId: current.runId,
      state: "stop_requested",
    };
  }

  markStopped(conversationId: string, runId: string, reason?: string): void {
    const scoped = this.handles.get(conversationId);
    const current = scoped?.get(runId);
    if (!scoped || !current) {
      return;
    }
    const next: ConversationRunHandle = {
      ...current,
      state: "stopped",
      stoppedAt: Date.now(),
    };
    if (typeof reason === "string" && reason.trim()) {
      next.stopReason = reason.trim();
    }
    scoped.set(runId, next);
    this.handles.set(conversationId, scoped);
    this.resolveIdleWaiters();
  }

  clear(conversationId: string, runId?: string): void {
    const scoped = this.handles.get(conversationId);
    if (!scoped) {
      return;
    }
    if (!runId) {
      this.handles.delete(conversationId);
      this.resolveIdleWaiters();
      return;
    }
    scoped.delete(runId);
    if (scoped.size <= 0) {
      this.handles.delete(conversationId);
      this.resolveIdleWaiters();
      return;
    }
    this.handles.set(conversationId, scoped);
    this.resolveIdleWaiters();
  }

  stopAccepting(): void {
    this.accepting = false;
  }

  /** 先冻结全部活跃 handle 的状态，再并发发送 stop，避免单个失败阻断其他 run。 */
  async requestStopAll(reason?: string): Promise<void> {
    const activeHandles: ConversationRunHandle[] = [];
    for (const scoped of this.handles.values()) {
      for (const handle of scoped.values()) {
        if (handle.state === "running" || handle.state === "stop_requested") {
          activeHandles.push(handle);
        }
      }
    }

    for (const handle of activeHandles) {
      const scoped = this.handles.get(handle.conversationId);
      const current = scoped?.get(handle.runId);
      if (!scoped || !current) continue;
      scoped.set(handle.runId, {
        ...current,
        state: "stop_requested",
        stopRequestedAt: current.stopRequestedAt ?? Date.now(),
        ...(typeof reason === "string" && reason.trim() ? { stopReason: reason.trim() } : {}),
      });
    }

    const results = await Promise.allSettled(activeHandles.map((handle) => Promise.resolve().then(() => handle.stop(reason))));
    const failureCount = results.filter((result) => result.status === "rejected").length;
    if (failureCount > 0) {
      throw new Error(`Failed to stop ${failureCount} of ${activeHandles.length} active conversation runs.`);
    }
  }

  /** drain 只等待 registry 可观察的活跃 run；阶段 deadline 通过 AbortSignal 终止等待。 */
  waitForIdle(signal?: AbortSignal): Promise<void> {
    if (this.getRuntimeSnapshot().activeCount === 0) return Promise.resolve();
    if (signal?.aborted) return Promise.reject(toAbortError(signal.reason));

    return new Promise<void>((resolve, reject) => {
      const complete = (): void => {
        signal?.removeEventListener("abort", abort);
        resolve();
      };
      const abort = (): void => {
        this.idleWaiters.delete(complete);
        reject(toAbortError(signal?.reason));
      };
      this.idleWaiters.add(complete);
      signal?.addEventListener("abort", abort, { once: true });
      this.resolveIdleWaiters();
    });
  }

  /** 仅返回运行态总数，供后台调度避让前台 Agent 工作。 */
  getRuntimeSnapshot(): ConversationRunRuntimeSnapshot {
    let activeCount = 0;
    let stopRequestedCount = 0;
    for (const scoped of this.handles.values()) {
      for (const handle of scoped.values()) {
        if (handle.state !== "running" && handle.state !== "stop_requested") {
          continue;
        }
        activeCount++;
        if (handle.state === "stop_requested") {
          stopRequestedCount++;
        }
      }
    }
    return { activeCount, stopRequestedCount };
  }

  private selectLatestHandle(
    scoped?: Map<string, ConversationRunHandle>,
  ): ConversationRunHandle | undefined {
    if (!scoped || scoped.size <= 0) {
      return undefined;
    }
    return [...scoped.values()].sort((left, right) => right.startedAt - left.startedAt)[0];
  }

  private selectLatestStoppableHandle(
    scoped?: Map<string, ConversationRunHandle>,
  ): ConversationRunHandle | undefined {
    if (!scoped || scoped.size <= 0) {
      return undefined;
    }
    return [...scoped.values()]
      .filter((handle) => handle.state === "running" || handle.state === "stop_requested")
      .sort((left, right) => right.startedAt - left.startedAt)[0];
  }

  private resolveIdleWaiters(): void {
    if (this.getRuntimeSnapshot().activeCount > 0) return;
    const waiters = [...this.idleWaiters];
    this.idleWaiters.clear();
    for (const resolve of waiters) resolve();
  }
}

function toAbortError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error("Conversation run drain aborted.");
}
