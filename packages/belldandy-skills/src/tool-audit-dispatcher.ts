import type { ToolAuditLog } from "./types.js";

export const DEFAULT_MAX_TOOL_AUDIT_QUEUE_SIZE = 128;

export type ToolAuditSink = (log: ToolAuditLog) => void | Promise<void>;

export type ToolAuditDispatcherOptions = {
  /** 等待 sink 的审计事件上限；正在执行的一项不计入该队列。 */
  maxQueueSize?: number;
};

export type ToolAuditDispatcherSnapshot = {
  active: boolean;
  queuedCount: number;
  maxQueueSize: number;
  dispatchedCount: number;
  failedCount: number;
  droppedCount: number;
  disposed: boolean;
};

function normalizeQueueSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_MAX_TOOL_AUDIT_QUEUE_SIZE;
  }
  return Math.max(1, Math.floor(value));
}

/**
 * Tool 审计的旁路 owner。它故意不向 execute() 返回 Promise，避免观测 sink
 * 的慢速、挂起或异常改变已完成 Tool 的业务终态。
 */
export class ToolAuditDispatcher {
  private readonly sink: ToolAuditSink;
  private readonly maxQueueSize: number;
  private readonly queue: ToolAuditLog[] = [];
  private active = false;
  private scheduled = false;
  private disposed = false;
  private dispatchedCount = 0;
  private failedCount = 0;
  private droppedCount = 0;
  private scheduledHandle: NodeJS.Immediate | undefined;

  constructor(sink: ToolAuditSink, options: ToolAuditDispatcherOptions = {}) {
    this.sink = sink;
    this.maxQueueSize = normalizeQueueSize(options.maxQueueSize);
  }

  enqueue(log: ToolAuditLog): boolean {
    if (this.disposed || this.queue.length >= this.maxQueueSize) {
      this.droppedCount += 1;
      return false;
    }

    this.queue.push(log);
    this.scheduleDrain();
    return true;
  }

  getSnapshot(): ToolAuditDispatcherSnapshot {
    return {
      active: this.active,
      queuedCount: this.queue.length,
      maxQueueSize: this.maxQueueSize,
      dispatchedCount: this.dispatchedCount,
      failedCount: this.failedCount,
      droppedCount: this.droppedCount,
      disposed: this.disposed,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.droppedCount += this.queue.length;
    this.queue.length = 0;
    if (this.scheduledHandle) {
      clearImmediate(this.scheduledHandle);
      this.scheduledHandle = undefined;
      this.scheduled = false;
    }
  }

  private scheduleDrain(): void {
    if (this.active || this.scheduled || this.disposed || this.queue.length === 0) return;

    this.scheduled = true;
    this.scheduledHandle = setImmediate(() => {
      this.scheduled = false;
      this.scheduledHandle = undefined;
      void this.drain();
    });
    // 审计是 best-effort；未完成的旁路日志不应阻止 Gateway 正常退出。
    this.scheduledHandle.unref?.();
  }

  private async drain(): Promise<void> {
    if (this.active || this.disposed) return;

    this.active = true;
    try {
      while (!this.disposed && this.queue.length > 0) {
        const log = this.queue.shift()!;
        try {
          await this.sink(log);
          this.dispatchedCount += 1;
        } catch {
          // sink 失败只作为诊断状态，不能影响后续审计或 Tool 业务结果。
          this.failedCount += 1;
        }
      }
    } finally {
      this.active = false;
      this.scheduleDrain();
    }
  }
}
