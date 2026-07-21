import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test, vi } from "vitest";

import { DurableExtractionRuntime } from "./durable-extraction.js";

async function waitFor(assertion: () => boolean | Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();
  while (!(await assertion())) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("durable extraction runtime coalesces repeated requests and performs trailing run", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-durable-extraction-"));
  const startedResolvers: Array<() => void> = [];
  const releaseResolvers: Array<() => void> = [];
  const calls: string[] = [];
  let paused = false;

  const runtime = new DurableExtractionRuntime({
    stateDir,
    extractor: {
      get isPaused() {
        return paused;
      },
      isConversationMemoryExtractionEnabled() {
        return true;
      },
      async extractMemoriesFromConversation(sessionKey) {
        calls.push(sessionKey);
        startedResolvers.shift()?.();
        await new Promise<void>((resolve) => {
          releaseResolvers.push(resolve);
        });
        return 1;
      },
    },
    getMessages: async () => [
      { role: "user", content: "请沉淀这轮对话里的长期信息" },
      { role: "assistant", content: "已经整理 durable extraction runtime 的第一批闭环" },
    ],
    retryDelayMs: 20,
  });

  await runtime.load();

  const firstStarted = new Promise<void>((resolve) => startedResolvers.push(resolve));
  const firstQueued = await runtime.requestExtraction({
    conversationId: "conv-durable",
    source: "message.send",
    digest: {
      lastDigestAt: 100,
      messageCount: 4,
      threshold: 2,
      status: "ready",
    },
  });
  expect(firstQueued.status).toBe("queued");

  await firstStarted;

  const secondQueued = await runtime.requestExtraction({
    conversationId: "conv-durable",
    source: "message.send",
    digest: {
      lastDigestAt: 200,
      messageCount: 6,
      threshold: 2,
      status: "updated",
    },
  });
  expect(secondQueued.pending).toBe(true);
  expect(runtime.getRuntimeSnapshot()).toMatchObject({
    activeCount: 1,
    queuedCount: 1,
  });

  releaseResolvers.shift()?.();
  await waitFor(() => calls.length === 2);
  releaseResolvers.shift()?.();
  await waitFor(async () => (await runtime.getRecord("conv-durable")).status === "completed");

  const record = await runtime.getRecord("conv-durable");
  expect(calls).toEqual([
    "conv-durable@digest:100:4",
    "conv-durable@digest:200:6",
  ]);
  expect(record).toMatchObject({
    conversationId: "conv-durable",
    status: "completed",
    pending: false,
    runCount: 2,
    lastExtractedDigestAt: 200,
    lastExtractedMessageCount: 6,
    lastExtractedMemoryCount: 1,
  });

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("durable extraction runtime waits for idle window and persists completed state", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-durable-extraction-persist-"));
  const calls: string[] = [];
  let paused = true;

  const extractor = {
    get isPaused() {
      return paused;
    },
    isConversationMemoryExtractionEnabled() {
      return true;
    },
    async extractMemoriesFromConversation(sessionKey: string) {
      calls.push(sessionKey);
      return 2;
    },
  };

  const runtime = new DurableExtractionRuntime({
    stateDir,
    extractor,
    getMessages: async () => [
      { role: "user", content: "沉淀一下本轮周报推进结果" },
      { role: "assistant", content: "Week 8 第一批 runtime 已接入 digest 自动调度" },
    ],
    retryDelayMs: 20,
  });

  await runtime.load();
  const queued = await runtime.requestExtraction({
    conversationId: "conv-persist",
    source: "manual",
    digest: {
      lastDigestAt: 300,
      messageCount: 5,
      threshold: 2,
      status: "ready",
    },
  });
  expect(queued.status).toBe("queued");

  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(calls).toHaveLength(0);

  paused = false;
  await waitFor(() => calls.length === 1);
  await waitFor(async () => (await runtime.getRecord("conv-persist")).status === "completed");
  await runtime.close();

  const reloaded = new DurableExtractionRuntime({
    stateDir,
    extractor,
    getMessages: async () => [],
  });
  await reloaded.load();
  const record = await reloaded.getRecord("conv-persist");

  expect(record).toMatchObject({
    conversationId: "conv-persist",
    status: "completed",
    runCount: 1,
    lastExtractedDigestAt: 300,
    lastExtractedMessageCount: 5,
    lastExtractedMemoryCount: 2,
  });

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("durable extraction runtime respects failure backoff and success cooldown", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-durable-extraction-backoff-"));
  const calls: string[] = [];
  let shouldFail = true;
  let resolveFirstFailure: (() => void) | null = null;
  const firstFailure = new Promise<void>((resolve) => {
    resolveFirstFailure = resolve;
  });
  let resolveSecondSuccess: (() => void) | null = null;
  const secondSuccess = new Promise<void>((resolve) => {
    resolveSecondSuccess = resolve;
  });

  const runtime = new DurableExtractionRuntime({
    stateDir,
    extractor: {
      get isPaused() {
        return false;
      },
      isConversationMemoryExtractionEnabled() {
        return true;
      },
      async extractMemoriesFromConversation(sessionKey) {
        calls.push(sessionKey);
        if (shouldFail) {
          throw new Error("temporary extraction failure");
        }
        return {
          count: 1,
          acceptedCandidateTypes: ["project"],
          rejectedCount: 0,
          rejectedReasons: [],
          summary: "accepted=1; candidateTypes=project",
        };
      },
    },
    getMessages: async () => [
      { role: "user", content: "继续推进 week 9 memory runtime 收口" },
      { role: "assistant", content: "需要补 backoff 与 cooldown" },
    ],
    onRunFinished: async (event) => {
      if (event.runCount === 1 && event.failure) {
        resolveFirstFailure?.();
      }
      if (event.runCount === 2 && !event.failure) {
        resolveSecondSuccess?.();
      }
    },
    retryDelayMs: 20,
    failureBackoffMs: 40,
    failureBackoffMaxMs: 40,
    successCooldownMs: 40,
  });

  try {
    await runtime.load();
    await runtime.requestExtraction({
      conversationId: "conv-backoff",
      source: "message.send",
      digest: { lastDigestAt: 100, messageCount: 4, pendingMessageCount: 2, threshold: 2, status: "ready" },
    });
    await firstFailure;

    const failed = await runtime.getRecord("conv-backoff");
    expect(failed.status).toBe("failed");
    expect(failed.consecutiveFailures).toBe(1);
    expect((failed.nextEligibleAt ?? 0) - (failed.finishedAt ?? 0)).toBeGreaterThanOrEqual(35);

    shouldFail = false;
    await runtime.requestExtraction({
      conversationId: "conv-backoff",
      source: "manual",
      digest: { lastDigestAt: 200, messageCount: 6, pendingMessageCount: 2, threshold: 2, status: "updated" },
    });
    await secondSuccess;

    const completed = await runtime.getRecord("conv-backoff");
    expect(calls).toHaveLength(2);
    expect(completed.status).toBe("completed");
    expect(completed.consecutiveFailures).toBe(0);
    expect(completed.lastExtractionSummary).toContain("accepted=1");
    expect(completed.lastAcceptedCandidateTypes).toEqual(["project"]);
    expect(completed.startedAt ?? 0).toBeGreaterThanOrEqual(failed.nextEligibleAt ?? 0);
    expect((completed.nextEligibleAt ?? 0) - (completed.finishedAt ?? 0)).toBeGreaterThanOrEqual(35);
  } finally {
    await runtime.close();
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("durable extraction runtime skips requests below pending threshold", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-durable-extraction-threshold-"));
  const calls: string[] = [];

  const runtime = new DurableExtractionRuntime({
    stateDir,
    extractor: {
      get isPaused() {
        return false;
      },
      isConversationMemoryExtractionEnabled() {
        return true;
      },
      async extractMemoriesFromConversation(sessionKey) {
        calls.push(sessionKey);
        return 1;
      },
    },
    getMessages: async () => [
      { role: "user", content: "继续整理 durable extraction 阈值策略" },
      { role: "assistant", content: "当前 pending 不足时不应该排队" },
    ],
    retryDelayMs: 20,
    minPendingMessages: 3,
  });

  await runtime.load();
  const record = await runtime.requestExtraction({
    conversationId: "conv-threshold",
    source: "message.send",
    digest: { lastDigestAt: 100, messageCount: 4, pendingMessageCount: 2, threshold: 2, status: "ready" },
  });

  expect(record.status).toBe("idle");
  expect(record.lastSkipReason).toBe("pending_below_threshold");
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(calls).toHaveLength(0);

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("durable extraction runtime preserves extractor skip reason when no memory is written", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-durable-extraction-skip-reason-"));

  const runtime = new DurableExtractionRuntime({
    stateDir,
    extractor: {
      get isPaused() {
        return false;
      },
      isConversationMemoryExtractionEnabled() {
        return true;
      },
      async extractMemoriesFromConversation() {
        return {
          count: 0,
          acceptedCandidateTypes: [],
          rejectedCount: 0,
          rejectedReasons: [],
          summary: "All durable memory candidates were skipped because similar memories already exist.",
          skipReason: "dedupe_skipped" as const,
        };
      },
    },
    getMessages: async () => [
      { role: "user", content: "重复沉淀同一条长期偏好。" },
      { role: "assistant", content: "如果已有相似记忆，这轮应该跳过写入。" },
    ],
    retryDelayMs: 20,
  });

  await runtime.load();
  await runtime.requestExtraction({
    conversationId: "conv-skip-reason",
    source: "manual",
    digest: { lastDigestAt: 100, messageCount: 4, pendingMessageCount: 2, threshold: 2, status: "ready" },
  });
  await waitFor(async () => (await runtime.getRecord("conv-skip-reason")).status === "completed");

  const record = await runtime.getRecord("conv-skip-reason");
  expect(record).toMatchObject({
    conversationId: "conv-skip-reason",
    status: "completed",
    lastExtractedMemoryCount: 0,
    lastSkipReason: "dedupe_skipped",
  });

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("durable extraction runtime close waits for in-flight finish hooks", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-durable-extraction-close-"));
  let releaseFinishHook: (() => void) | undefined;
  let finishHookStarted = false;
  let closeResolved = false;

  const runtime = new DurableExtractionRuntime({
    stateDir,
    extractor: {
      get isPaused() {
        return false;
      },
      isConversationMemoryExtractionEnabled() {
        return true;
      },
      async extractMemoriesFromConversation() {
        return 1;
      },
    },
    getMessages: async () => [
      { role: "user", content: "关闭前需要等 durable extraction hook 收尾。" },
      { role: "assistant", content: "否则测试会在删目录后看到异步写盘噪音。" },
    ],
    retryDelayMs: 20,
    onRunFinished: async () => {
      finishHookStarted = true;
      await new Promise<void>((resolve) => {
        releaseFinishHook = resolve;
      });
    },
  });

  await runtime.load();
  await runtime.requestExtraction({
    conversationId: "conv-close-waits",
    source: "manual",
    digest: { lastDigestAt: 100, messageCount: 4, pendingMessageCount: 2, threshold: 2, status: "ready" },
  });
  await waitFor(() => finishHookStarted);

  const closePromise = runtime.close().then(() => {
    closeResolved = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(closeResolved).toBe(false);

  releaseFinishHook?.();
  await closePromise;
  expect(closeResolved).toBe(true);

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("durable extraction runtime forwards its scheduler signal and fences a late result after close", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-durable-extraction-cancel-"));
  let finishExtraction!: (value: number) => void;
  const extractionResult = new Promise<number>((resolve) => {
    finishExtraction = resolve;
  });
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let observedSignal: AbortSignal | undefined;
  const complete = vi.fn();
  const release = vi.fn(async () => undefined);
  const runtime = new DurableExtractionRuntime({
    stateDir,
    extractor: {
      get isPaused() {
        return false;
      },
      isConversationMemoryExtractionEnabled() {
        return true;
      },
      async extractMemoriesFromConversation(_sessionKey, _messages, options) {
        observedSignal = options?.signal;
        markStarted();
        return extractionResult;
      },
    },
    getMessages: async () => [
      { role: "user", content: "private durable input" },
      { role: "assistant", content: "bounded durable response" },
    ],
    acquireJob: async (input) => ({
      generation: 1,
      signal: input.signal,
      complete: async <T>(commit: () => T | Promise<T>) => {
        complete();
        if (input.signal.aborted) return { applied: false as const };
        return { applied: true as const, value: await commit() };
      },
      release,
    }),
    closeDeadlineMs: 30,
  });

  try {
    await runtime.requestExtraction({
      conversationId: "conv-cancel",
      source: "manual",
      digest: { lastDigestAt: 100, messageCount: 2, status: "ready" },
    });
    await started;

    const closeStartedAt = Date.now();
    await runtime.close();
    expect(Date.now() - closeStartedAt).toBeLessThan(250);
    expect(observedSignal?.aborted).toBe(true);
    expect(release).toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();

    finishExtraction(3);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(runtime.getRecord("conv-cancel")).resolves.not.toMatchObject({
      status: "completed",
      lastExtractedMemoryCount: 3,
    });
  } finally {
    finishExtraction(3);
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("durable extraction runtime removes a queued scheduler admission during close", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-durable-extraction-queued-close-"));
  let markAdmissionStarted!: () => void;
  const admissionStarted = new Promise<void>((resolve) => {
    markAdmissionStarted = resolve;
  });
  const extractor = vi.fn(async () => 1);
  const runtime = new DurableExtractionRuntime({
    stateDir,
    extractor: {
      get isPaused() {
        return false;
      },
      isConversationMemoryExtractionEnabled() {
        return true;
      },
      extractMemoriesFromConversation: extractor,
    },
    getMessages: async () => [
      { role: "user", content: "queued durable input" },
    ],
    acquireJob: async ({ signal }) => {
      markAdmissionStarted();
      return await new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve({
          reason: "scheduler admission aborted",
          reasonCode: "memory_background_admission_rejected",
        }), { once: true });
      });
    },
    closeDeadlineMs: 30,
  });

  try {
    await runtime.requestExtraction({
      conversationId: "conv-queued-close",
      source: "manual",
      digest: { lastDigestAt: 100, messageCount: 1, status: "ready" },
    });
    await admissionStarted;

    await runtime.close();

    expect(extractor).not.toHaveBeenCalled();
    await expect(runtime.getRecord("conv-queued-close")).resolves.not.toMatchObject({
      status: "completed",
    });
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});
