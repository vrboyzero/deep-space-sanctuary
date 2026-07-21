import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { withCronStoreFileLock } from "./store-file-lock.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("CronStore file lock", () => {
  it("recovers a stale lock whose owner process is no longer alive", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T00:00:00.000Z"));
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-cron-lock-"));
    tempDirs.push(stateDir);
    const storePath = path.join(stateDir, "cron-jobs.json");
    const lockPath = `${storePath}.lock`;
    await fs.writeFile(lockPath, JSON.stringify({
      token: "stale-owner",
      pid: 2_147_483_647,
      createdAtMs: Date.now() - 60_000,
    }), "utf-8");

    const run = withCronStoreFileLock(storePath, async () => "acquired");
    const expectation = expect(run).resolves.toBe("acquired");
    await vi.advanceTimersByTimeAsync(5_100);
    await expectation;

    await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recovers an old incomplete lock left before owner metadata was published", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T00:00:00.000Z"));
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-cron-lock-"));
    tempDirs.push(stateDir);
    const storePath = path.join(stateDir, "cron-jobs.json");
    const lockPath = `${storePath}.lock`;
    await fs.writeFile(lockPath, "", "utf-8");
    const oldTime = new Date(Date.now() - 60_000);
    await fs.utimes(lockPath, oldTime, oldTime);

    const run = withCronStoreFileLock(storePath, async () => "acquired");
    const expectation = expect(run).resolves.toBe("acquired");
    await vi.advanceTimersByTimeAsync(5_100);
    await expectation;

    expect(await fs.readdir(stateDir)).toEqual([]);
  });

  it("retries transient stale quarantine cleanup failures", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-cron-lock-"));
    tempDirs.push(stateDir);
    const storePath = path.join(stateDir, "cron-jobs.json");
    const lockPath = `${storePath}.lock`;
    await fs.writeFile(lockPath, JSON.stringify({
      token: "stale-owner",
      pid: 2_147_483_647,
      createdAtMs: Date.now() - 60_000,
    }), "utf-8");
    vi.spyOn(fs, "unlink").mockRejectedValueOnce(new Error("transient stale cleanup failure"));

    await expect(withCronStoreFileLock(storePath, async () => "acquired"))
      .resolves.toBe("acquired");

    expect(await fs.readdir(stateDir)).toEqual([]);
  });

  it("returns a stable timeout without removing a live owner lock", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-cron-lock-"));
    tempDirs.push(stateDir);
    const storePath = path.join(stateDir, "cron-jobs.json");
    const lockPath = `${storePath}.lock`;
    await fs.writeFile(lockPath, JSON.stringify({
      token: "active-owner",
      pid: process.pid,
      createdAtMs: Date.now(),
    }), "utf-8");

    const run = withCronStoreFileLock(
      storePath,
      async () => "unexpected",
      { timeoutMs: 50, retryDelayMs: 10, staleAfterMs: 60_000 },
    );

    await expect(run).rejects.toMatchObject({
      name: "CronStoreLockTimeoutError",
      code: "cron_store_lock_timeout",
      message: "Timed out waiting for the CronStore mutation lock.",
    });
    await expect(fs.readFile(lockPath, "utf-8")).resolves.toContain("active-owner");
  });

  it("retries a transient release failure so the next mutation can acquire", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-cron-lock-"));
    tempDirs.push(stateDir);
    const storePath = path.join(stateDir, "cron-jobs.json");
    vi.spyOn(fs, "unlink").mockRejectedValueOnce(new Error("transient release failure"));

    await expect(withCronStoreFileLock(storePath, async () => "first")).resolves.toBe("first");
    await expect(withCronStoreFileLock(
      storePath,
      async () => "second",
      { timeoutMs: 50, retryDelayMs: 10 },
    )).resolves.toBe("second");

    await expect(fs.stat(`${storePath}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("marks a persistently unreleased lock so a later mutation can recover", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-cron-lock-"));
    tempDirs.push(stateDir);
    const storePath = path.join(stateDir, "cron-jobs.json");
    const unlinkSpy = vi.spyOn(fs, "unlink").mockRejectedValue(new Error("persistent release failure"));

    await expect(withCronStoreFileLock(storePath, async () => "first")).rejects.toMatchObject({
      name: "CronStoreLockReleaseError",
      code: "cron_store_lock_release_failed",
      message: "Failed to release the CronStore mutation lock.",
    });
    unlinkSpy.mockRestore();

    await expect(withCronStoreFileLock(
      storePath,
      async () => "second",
      { timeoutMs: 100, retryDelayMs: 10 },
    )).resolves.toBe("second");
    await expect(fs.stat(`${storePath}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
