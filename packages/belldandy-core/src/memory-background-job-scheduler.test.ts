import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BackgroundRunCoordinator } from "./background-run-coordinator.js";
import {
  MemoryBackgroundJobScheduler,
  type MemoryBackgroundJobClaim,
  type MemoryBackgroundJobClaimResult,
} from "./memory-background-job-scheduler.js";
import {
  MemoryRuntimeBudgetGuard,
  MemoryRuntimeUsageAccounting,
} from "./memory-runtime-budget.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function createScheduler(input: {
  maxRuns?: number;
  maxTokenUnits?: number;
  maxConcurrentRuns?: number;
} = {}) {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-scheduler-"));
  tempDirs.push(stateDir);
  const usageAccounting = new MemoryRuntimeUsageAccounting({ stateDir });
  await usageAccounting.load();
  const budgetGuard = new MemoryRuntimeBudgetGuard({
    accounting: usageAccounting,
    backgroundModelRunLimit: input.maxRuns
      ? { maxRuns: input.maxRuns, windowMs: 60_000 }
      : undefined,
    backgroundModelTokenLimit: input.maxTokenUnits
      ? { maxTokenUnits: input.maxTokenUnits, windowMs: 60_000 }
      : undefined,
  });
  const runCoordinator = new BackgroundRunCoordinator({
    maxConcurrentRuns: input.maxConcurrentRuns ?? 4,
    maxConcurrentByKind: {
      memory: input.maxConcurrentRuns ?? 4,
      dream: input.maxConcurrentRuns ?? 4,
    },
  });
  return {
    usageAccounting,
    runCoordinator,
    scheduler: new MemoryBackgroundJobScheduler({
      runCoordinator,
      budgetGuard,
      usageAccounting,
    }),
  };
}

function requireJobClaim(result: MemoryBackgroundJobClaimResult): MemoryBackgroundJobClaim {
  if ("reason" in result) {
    throw new Error(`Expected memory job claim: ${String(result.reason)}`);
  }
  return result;
}

describe("MemoryBackgroundJobScheduler", () => {
  it("enforces per-agent singleflight across summary, extraction, and dream families", async () => {
    const { scheduler } = await createScheduler();
    const summary = requireJobClaim(await scheduler.acquire({
      family: "idle_summary",
      agentId: "default",
      priority: "low",
      estimatedTokenUnits: 300,
    }));

    await expect(scheduler.acquire({
      family: "dream",
      agentId: "default",
      priority: "high",
      estimatedTokenUnits: 1_000,
    })).resolves.toMatchObject({
      reasonCode: "memory_agent_singleflight_active",
    });

    const otherAgent = requireJobClaim(await scheduler.acquire({
      family: "durable_extraction",
      agentId: "coder",
      priority: "normal",
      estimatedTokenUnits: 600,
    }));
    await summary.release("skipped");
    await otherAgent.release("skipped");
  });

  it("reserves run budget atomically before returning a model side-effect claim", async () => {
    const { scheduler, usageAccounting } = await createScheduler({ maxRuns: 1 });
    const first = requireJobClaim(await scheduler.acquire({
      family: "dream",
      agentId: "default",
      priority: "high",
      estimatedTokenUnits: 1_000,
    }));
    await first.complete(async () => "done");

    await expect(scheduler.acquire({
      family: "idle_summary",
      agentId: "coder",
      priority: "low",
      estimatedTokenUnits: 300,
    })).resolves.toMatchObject({
      reasonCode: "memory_background_run_budget_exceeded",
      observedRuns: 1,
      maxRuns: 1,
    });

    const events = await usageAccounting.listEvents({
      consumer: "background_model_run",
    });
    expect(events).toEqual([
      expect.objectContaining({
        consumer: "background_model_run",
        outcome: "started",
        quantity: 1_000,
        metadata: expect.objectContaining({
          family: "dream",
          agentId: "default",
        }),
      }),
      expect.objectContaining({
        consumer: "background_model_run",
        outcome: "completed",
        quantity: 1_000,
      }),
      expect.objectContaining({
        consumer: "background_model_run",
        outcome: "blocked",
        metadata: expect.objectContaining({
          reasonCode: "memory_background_run_budget_exceeded",
        }),
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("prompt");
    expect(JSON.stringify(events)).not.toContain("private body");
  });

  it("uses conservative token units as the cost hard cap", async () => {
    const { scheduler } = await createScheduler({ maxTokenUnits: 1_000 });
    const first = requireJobClaim(await scheduler.acquire({
      family: "durable_extraction",
      agentId: "default",
      priority: "normal",
      estimatedTokenUnits: 700,
    }));
    await first.release("failed");

    await expect(scheduler.acquire({
      family: "dream",
      agentId: "coder",
      priority: "high",
      estimatedTokenUnits: 301,
    })).resolves.toMatchObject({
      reasonCode: "memory_background_token_budget_exceeded",
      observedTokenUnits: 700,
      requestedTokenUnits: 301,
      maxTokenUnits: 1_000,
    });
  });

  it("propagates parent cancellation through the single claim signal", async () => {
    const { scheduler } = await createScheduler();
    const controller = new AbortController();
    const claim = requireJobClaim(await scheduler.acquire({
      family: "dream",
      agentId: "default",
      priority: "normal",
      estimatedTokenUnits: 1_000,
      signal: controller.signal,
    }));

    controller.abort(new Error("test stop"));

    expect(claim.signal.aborted).toBe(true);
    expect(claim.signal.reason).toEqual(new Error("test stop"));
    await expect(claim.complete(async () => "late")).resolves.toEqual({ applied: false });
  });
});
