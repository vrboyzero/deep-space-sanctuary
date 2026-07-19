import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { computeNextRun, CronStore } from "./store.js";
import type { CronJobCreate } from "./types.js";

const tempStateDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempStateDirs.splice(0).map((stateDir) => fs.rm(stateDir, { recursive: true, force: true })));
});

describe("CronStore concurrent mutations", () => {
  it("keeps concurrent adds from separate instances and gives each write a unique staging path", async () => {
    const stateDir = await createTempStateDir();
    const first = new CronStore(stateDir);
    const second = new CronStore(path.join(stateDir, "."));
    const writeSpy = vi.spyOn(fs, "writeFile");

    await Promise.all([
      first.add(createCronJobInput("alpha")),
      second.add(createCronJobInput("beta")),
    ]);

    const jobs = await first.list();
    const stagingPaths = writeSpy.mock.calls
      .map(([filePath]) => String(filePath))
      .filter((filePath) => filePath.includes("cron-jobs.json"));
    expect(jobs.map((job) => job.name).sort()).toEqual(["alpha", "beta"]);
    expect(stagingPaths).toHaveLength(2);
    expect(new Set(stagingPaths).size).toBe(2);
    expect(stagingPaths.every((filePath) => /cron-jobs\.json\.[^.]+\.tmp$/i.test(filePath))).toBe(true);
  });

  it("rebases scheduler runtime updates onto jobs added after the scheduler snapshot", async () => {
    const stateDir = await createTempStateDir();
    const schedulerStore = new CronStore(stateDir);
    const adminStore = new CronStore(path.join(stateDir, "."));
    const alpha = await schedulerStore.add(createCronJobInput("alpha"));
    const baseJobs = await schedulerStore.list();
    const runtimeJobs = baseJobs.map((job) => job.id === alpha.id
      ? {
        ...job,
        state: {
          ...job.state,
          lastRunAtMs: 1_000,
          lastStatus: "ok" as const,
          lastDurationMs: 12,
        },
      }
      : job);

    await adminStore.add(createCronJobInput("beta"));
    await (schedulerStore.saveJobs as (
      jobs: typeof runtimeJobs,
      baseSnapshot?: typeof baseJobs,
    ) => Promise<void>)(runtimeJobs, baseJobs);

    const jobs = await schedulerStore.list();
    expect(jobs.map((job) => job.name).sort()).toEqual(["alpha", "beta"]);
    expect(jobs.find((job) => job.id === alpha.id)?.state).toMatchObject({
      lastRunAtMs: 1_000,
      lastStatus: "ok",
      lastDurationMs: 12,
    });
  });

  it("keeps the published file and releases later mutations after a staged write fails", async () => {
    const stateDir = await createTempStateDir();
    const first = new CronStore(stateDir);
    const second = new CronStore(path.join(stateDir, "."));
    await first.add(createCronJobInput("alpha"));
    vi.spyOn(fs, "writeFile").mockRejectedValueOnce(new Error("expected staged write failure"));

    await expect(second.add(createCronJobInput("beta"))).rejects.toThrow("expected staged write failure");
    expect((await first.list()).map((job) => job.name)).toEqual(["alpha"]);

    await expect(second.add(createCronJobInput("gamma"))).resolves.toMatchObject({ name: "gamma" });
    expect((await first.list()).map((job) => job.name).sort()).toEqual(["alpha", "gamma"]);
  });
});

async function createTempStateDir(): Promise<string> {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-cron-store-"));
  tempStateDirs.push(stateDir);
  return stateDir;
}

function createCronJobInput(name: string): CronJobCreate {
  return {
    name,
    schedule: {
      kind: "every",
      everyMs: 60_000,
      anchorMs: 1_000,
    },
    payload: {
      kind: "systemEvent",
      text: `run ${name}`,
    },
  };
}

describe("computeNextRun", () => {
  it("computes dailyAt in Asia/Shanghai before the target time", () => {
    const nowMs = Date.parse("2026-03-30T00:30:00.000Z"); // 08:30 +08:00
    const nextRunAtMs = computeNextRun({
      kind: "dailyAt",
      time: "09:00",
      timezone: "Asia/Shanghai",
    }, nowMs);

    expect(nextRunAtMs).toBe(Date.parse("2026-03-30T01:00:00.000Z"));
  });

  it("pushes dailyAt to the next day when now is exactly at the target time", () => {
    const nowMs = Date.parse("2026-03-30T01:00:00.000Z"); // 09:00 +08:00
    const nextRunAtMs = computeNextRun({
      kind: "dailyAt",
      time: "09:00",
      timezone: "Asia/Shanghai",
    }, nowMs);

    expect(nextRunAtMs).toBe(Date.parse("2026-03-31T01:00:00.000Z"));
  });

  it("computes weeklyAt for the next valid weekday in UTC", () => {
    const nowMs = Date.parse("2026-03-31T08:00:00.000Z"); // Tuesday
    const nextRunAtMs = computeNextRun({
      kind: "weeklyAt",
      weekdays: [3, 5],
      time: "10:30",
      timezone: "UTC",
    }, nowMs);

    expect(nextRunAtMs).toBe(Date.parse("2026-04-01T10:30:00.000Z"));
  });

  it("pushes weeklyAt to the next matching weekday after the same-day time has passed", () => {
    const nowMs = Date.parse("2026-04-01T11:00:00.000Z"); // Wednesday
    const nextRunAtMs = computeNextRun({
      kind: "weeklyAt",
      weekdays: [3, 5],
      time: "10:30",
      timezone: "UTC",
    }, nowMs);

    expect(nextRunAtMs).toBe(Date.parse("2026-04-03T10:30:00.000Z"));
  });

  it("returns undefined for invalid timezone or weekdays", () => {
    expect(computeNextRun({
      kind: "dailyAt",
      time: "09:00",
      timezone: "Invalid/Zone",
    }, Date.now())).toBeUndefined();

    expect(computeNextRun({
      kind: "weeklyAt",
      weekdays: [1, 1],
      time: "10:30",
      timezone: "UTC",
    }, Date.now())).toBeUndefined();
  });

  it("keeps base schedule math stable even when staggerMs is present", () => {
    const nowMs = Date.parse("2026-04-01T00:00:00.000Z");
    const nextRunAtMs = computeNextRun({
      kind: "every",
      everyMs: 60_000,
      staggerMs: 30_000,
    }, nowMs);

    expect(nextRunAtMs).toBe(nowMs);
  });
});

describe("cron stagger offset", () => {
  it("derives a stable offset within the stagger window", () => {
    const staggerMs = 30_000;
    const digest = crypto.createHash("sha256").update("cron-stagger").digest();
    const offset = digest.readUInt32BE(0) % staggerMs;

    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThan(staggerMs);
  });
});
