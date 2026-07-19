export class SubTaskRuntimeStoreClosedError extends Error {
  constructor(state: "closing" | "closed") {
    super(state === "closing"
      ? "Subtask runtime store is closing and no longer accepts mutations."
      : "Subtask runtime store is closed and no longer accepts mutations.");
    this.name = "SubTaskRuntimeStoreClosedError";
  }
}

/**
 * 将 Store 的关闭状态与单飞 close promise 收敛在相邻模块，避免 lifecycle 状态散落到持久化逻辑中。
 */
export class SubTaskRuntimeStoreLifecycle {
  private state: "open" | "closing" | "closed" = "open";
  private closePromise: Promise<void> | undefined;

  isOpen(): boolean {
    return this.state === "open";
  }

  assertMutationAllowed(): void {
    if (this.state === "closing" || this.state === "closed") {
      throw new SubTaskRuntimeStoreClosedError(this.state);
    }
  }

  close(flush: () => Promise<void>): Promise<void> {
    if (this.closePromise) {
      return this.closePromise;
    }
    this.state = "closing";
    this.closePromise = (async () => {
      try {
        await flush();
      } finally {
        this.state = "closed";
      }
    })();
    return this.closePromise;
  }
}
