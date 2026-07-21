import { describe, expect, it, vi } from "vitest";

import {
  runWorkflowBatch,
  resolveWorkflowBatchLimits,
  type WorkflowBatchLimits,
} from "./workflow-batch-runner.js";

const generousLimits: WorkflowBatchLimits = {
  maxItems: 100,
  maxQueuedBytes: 1_000_000,
  maxOutputBytes: 1_000_000,
};

describe("runWorkflowBatch", () => {
  it("在 item 上限超出时不启动 worker", async () => {
    const execute = vi.fn(async (item: number) => item);

    await expect(runWorkflowBatch({
      items: [1, 2, 3],
      maxConcurrent: 2,
      limits: { ...generousLimits, maxItems: 2 },
      taskIdPrefix: "item-limit",
      execute,
    })).rejects.toMatchObject({ kind: "items" });

    expect(execute).not.toHaveBeenCalled();
  });

  it("在 queued UTF-8 bytes 超出时不执行并且错误不回显输入", async () => {
    const execute = vi.fn(async (item: string) => item);
    let error: unknown;

    try {
      await runWorkflowBatch({
        items: ["private-payload"],
        maxConcurrent: 1,
        limits: { ...generousLimits, maxQueuedBytes: 4 },
        taskIdPrefix: "queued-bytes",
        execute,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ kind: "queued_bytes" });
    expect(String(error)).not.toContain("private-payload");
    expect(execute).not.toHaveBeenCalled();
  });

  it("只创建固定数量 worker 并惰性领取后续 item", async () => {
    let releaseWorkers: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseWorkers = resolve;
    });
    const started: number[] = [];

    const pending = runWorkflowBatch({
      items: Array.from({ length: 10 }, (_, index) => index),
      maxConcurrent: 2,
      limits: generousLimits,
      taskIdPrefix: "lazy",
      execute: async (item) => {
        started.push(item);
        await gate;
        return item * 2;
      },
    });

    await vi.waitFor(() => expect(started).toHaveLength(2));
    expect(started).toEqual([0, 1]);
    releaseWorkers?.();

    const results = await pending;
    expect(results).toHaveLength(10);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.map((result) => result.ok ? result.value : undefined))
      .toEqual(Array.from({ length: 10 }, (_, index) => index * 2));
  });

  it("aggregate output 超限后丢弃在途结果且不领取新 item", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const started: number[] = [];

    const pending = runWorkflowBatch({
      items: [0, 1, 2, 3, 4],
      maxConcurrent: 2,
      limits: { ...generousLimits, maxOutputBytes: 4 },
      taskIdPrefix: "output-limit",
      execute: async (item) => {
        started.push(item);
        if (item === 0) await firstGate;
        return "oversized";
      },
    });

    await vi.waitFor(() => expect(started).toEqual([0, 1]));
    releaseFirst?.();
    const results = await pending;

    expect(started).toEqual([0, 1]);
    expect(results).toHaveLength(5);
    expect(results.every((result) => !result.ok && result.error.includes("output byte limit exceeded")))
      .toBe(true);
    expect(JSON.stringify(results)).not.toContain("oversized");
  });

  it("worker 同步启动期间取消时也会结算在途 rejection", async () => {
    const controller = new AbortController();
    let rejectWorker: ((error: Error) => void) | undefined;
    const workerResult = new Promise<number>((_resolve, reject) => {
      rejectWorker = reject;
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    try {
      const pending = runWorkflowBatch({
        items: [0],
        maxConcurrent: 1,
        limits: generousLimits,
        taskIdPrefix: "abort-during-startup",
        abortSignal: controller.signal,
        execute: async () => {
          controller.abort("cancelled during worker startup");
          return workerResult;
        },
      });

      await expect(pending).rejects.toThrow("cancelled during worker startup");
      rejectWorker?.(new Error("late worker failure"));
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("resolveWorkflowBatchLimits", () => {
  it("严格解析正整数并对非法值回退默认", () => {
    const values: Record<string, string> = {
      BELLDANDY_WORKFLOW_MAX_BATCH_ITEMS: "12",
      BELLDANDY_WORKFLOW_MAX_BATCH_QUEUED_BYTES: "2048",
      BELLDANDY_WORKFLOW_MAX_BATCH_OUTPUT_BYTES: "4junk",
    };

    expect(resolveWorkflowBatchLimits((name) => values[name])).toMatchObject({
      maxItems: 12,
      maxQueuedBytes: 2048,
      maxOutputBytes: expect.any(Number),
    });
    expect(resolveWorkflowBatchLimits((name) => values[name]).maxOutputBytes).not.toBe(4);
  });
});
