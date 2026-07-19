import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Mock content.ts to avoid complex file parsing if needed, 
// but we can import real functions too.
import { BackgroundRunCoordinator } from "../background-run-coordinator.js";
import { startHeartbeatRunner, HEARTBEAT_OK_TOKEN } from "./runner.js";

describe("Heartbeat Runner", () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-heartbeat-test-"));
    });

    afterEach(async () => {
        vi.useRealTimers();
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it("should skip if system is busy", async () => {
        const sendMessage = vi.fn();
        const runOnce = startHeartbeatRunner({
            workspaceDir: tmpDir,
            sendMessage,
            isBusy: () => true, // Busy!
            intervalMs: 1000,
        }).runOnce;

        // Create HEARTBEAT.md
        await fs.writeFile(path.join(tmpDir, "HEARTBEAT.md"), "check something");

        const result = await runOnce();

        expect(result.status).toBe("skipped");
        expect(result.reason).toBe("requests-in-flight");
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it("should run if system is not busy", async () => {
        const sendMessage = vi.fn().mockResolvedValue(HEARTBEAT_OK_TOKEN);
        const runOnce = startHeartbeatRunner({
            workspaceDir: tmpDir,
            sendMessage,
            isBusy: () => false, // Not busy
            intervalMs: 1000,
            // `23:59` 是排他结束边界，全天夹具必须使用 runner 已支持的 `24:00`。
            activeHours: { start: "00:00", end: "24:00" },
        }).runOnce;

        await fs.writeFile(path.join(tmpDir, "HEARTBEAT.md"), "check something");

        const result = await runOnce();

        expect(result.status).toBe("ran");
        expect(sendMessage).toHaveBeenCalled();
    });

    it("should skip when the shared background coordinator has no capacity", async () => {
        await fs.writeFile(path.join(tmpDir, "HEARTBEAT.md"), "check shared budget");
        const coordinator = new BackgroundRunCoordinator({ maxConcurrentRuns: 1 });
        const heldCronClaim = coordinator.tryClaim({ kind: "cron", key: "daily" });
        if ("reason" in heldCronClaim) {
            throw new Error(heldCronClaim.reason);
        }
        const sendMessage = vi.fn(async () => HEARTBEAT_OK_TOKEN);
        const runner = startHeartbeatRunner({
            workspaceDir: tmpDir,
            sendMessage,
            runCoordinator: coordinator,
        });

        try {
            await expect(runner.runOnce()).resolves.toEqual({
                status: "skipped",
                reason: "Background run coordinator has reached its concurrent run limit.",
            });
            expect(sendMessage).not.toHaveBeenCalled();
        } finally {
            runner.stop();
            heldCronClaim.release();
        }
    });

    it("should deliver message to user if not OK", async () => {
        const sendMessage = vi.fn().mockResolvedValue("Some Proactive Message");
        const deliverToUser = vi.fn().mockResolvedValue(undefined);

        const runOnce = startHeartbeatRunner({
            workspaceDir: tmpDir,
            sendMessage,
            deliverToUser,
            isBusy: () => false,
        }).runOnce;

        await fs.writeFile(path.join(tmpDir, "HEARTBEAT.md"), "check something");

        const result = await runOnce();

        expect(result.status).toBe("ran");
        expect(result.message).toBe("Some Proactive Message");
        expect(deliverToUser).toHaveBeenCalledWith("Some Proactive Message");
    });

    it("should skip if HEARTBEAT.md is missing or empty", async () => {
        const sendMessage = vi.fn();
        const runOnce = startHeartbeatRunner({
            workspaceDir: tmpDir,
            sendMessage,
        }).runOnce;

        // Missing
        let result = await runOnce();
        expect(result.status).toBe("skipped");
        expect(result.reason).toBe("file-not-found");

        // Empty
        await fs.writeFile(path.join(tmpDir, "HEARTBEAT.md"), "   \n  <!-- comment --> ");
        result = await runOnce();
        expect(result.status).toBe("skipped");
        expect(result.reason).toBe("empty-heartbeat-file");

        expect(sendMessage).not.toHaveBeenCalled();
    });

    it("keeps a full-day active-hours fixture active through 23:59", async () => {
        await fs.writeFile(path.join(tmpDir, "HEARTBEAT.md"), "check boundary");
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-07-16T23:59:00.000Z"));
        const runner = startHeartbeatRunner({
            workspaceDir: tmpDir,
            sendMessage: vi.fn().mockResolvedValue(HEARTBEAT_OK_TOKEN),
            activeHours: { start: "00:00", end: "24:00" },
            timezone: "UTC",
        });

        try {
            const result = await runner.runOnce();
            expect(result.status).toBe("ran");
            expect(result.reason).toBe("ok");
        } finally {
            runner.stop();
        }
    });

    it("does not overlap interval runs while a previous heartbeat is still in flight", async () => {
        vi.useFakeTimers();
        await fs.writeFile(path.join(tmpDir, "HEARTBEAT.md"), "check overlap");

        let releaseSend: (() => void) | undefined;
        let markCalled!: () => void;
        const called = new Promise<void>((resolve) => {
            markCalled = resolve;
        });
        const sendMessage = vi.fn().mockImplementation(() => new Promise<string>((resolve) => {
            markCalled();
            releaseSend = () => resolve(HEARTBEAT_OK_TOKEN);
        }));

        const runner = startHeartbeatRunner({
            workspaceDir: tmpDir,
            sendMessage,
            intervalMs: 1000,
            activeHours: { start: "00:00", end: "24:00" },
        });

        await vi.advanceTimersByTimeAsync(1000);
        await called;
        expect(sendMessage).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1000);
        expect(sendMessage).toHaveBeenCalledTimes(1);

        runner.stop();
        releaseSend?.();
        await vi.advanceTimersByTimeAsync(0);
    });

    it("does not overlap a manual runOnce with an active interval heartbeat", async () => {
        vi.useFakeTimers();
        await fs.writeFile(path.join(tmpDir, "HEARTBEAT.md"), "check shared claim");

        const releaseSends: Array<() => void> = [];
        let markIntervalStarted!: () => void;
        let markManualStarted!: () => void;
        const intervalStarted = new Promise<void>((resolve) => {
            markIntervalStarted = resolve;
        });
        const manualStarted = new Promise<void>((resolve) => {
            markManualStarted = resolve;
        });
        const sendMessage = vi.fn().mockImplementation(() => new Promise<string>((resolve) => {
            releaseSends.push(() => resolve(HEARTBEAT_OK_TOKEN));
            if (releaseSends.length === 1) {
                markIntervalStarted();
            } else {
                markManualStarted();
            }
        }));
        const runner = startHeartbeatRunner({
            workspaceDir: tmpDir,
            sendMessage,
            intervalMs: 1000,
            activeHours: { start: "00:00", end: "24:00" },
        });

        let manualRun: Promise<unknown> | undefined;
        try {
            await vi.advanceTimersByTimeAsync(1000);
            await intervalStarted;

            manualRun = runner.runOnce();
            const outcome = await Promise.race([
                manualRun.then((result) => ({ kind: "result" as const, result })),
                manualStarted.then(() => ({ kind: "started" as const })),
            ]);

            expect(outcome).toEqual({
                kind: "result",
                result: {
                    status: "skipped",
                    reason: "already-running",
                },
            });
            expect(sendMessage).toHaveBeenCalledTimes(1);
        } finally {
            runner.stop();
            for (const releaseSend of releaseSends) {
                releaseSend();
            }
            await Promise.allSettled([manualRun ?? Promise.resolve()]);
            await vi.advanceTimersByTimeAsync(0);
        }
    });

    it("stopAndDrain closes new runs and waits for the accepted heartbeat", async () => {
        vi.useFakeTimers();
        await fs.writeFile(path.join(tmpDir, "HEARTBEAT.md"), "check local drain");

        let releaseSend: (() => void) | undefined;
        let markStarted!: () => void;
        const started = new Promise<void>((resolve) => {
            markStarted = resolve;
        });
        const runner = startHeartbeatRunner({
            workspaceDir: tmpDir,
            sendMessage: vi.fn().mockImplementation(() => new Promise<string>((resolve) => {
                markStarted();
                releaseSend = () => resolve(HEARTBEAT_OK_TOKEN);
            })),
            intervalMs: 1000,
            activeHours: { start: "00:00", end: "24:00" },
        }) as ReturnType<typeof startHeartbeatRunner> & {
            stopAndDrain: () => Promise<void>;
        };

        const activeRun = runner.runOnce();
        await started;
        try {
            expect(runner.stopAndDrain).toBeTypeOf("function");
            const firstDrain = runner.stopAndDrain();
            expect(runner.stopAndDrain()).toBe(firstDrain);
            await expect(runner.runOnce()).resolves.toEqual({
                status: "skipped",
                reason: "runner-stopped",
            });
            let drained = false;
            void firstDrain.then(() => {
                drained = true;
            });
            await Promise.resolve();
            expect(drained).toBe(false);

            releaseSend?.();
            await activeRun;
            await expect(firstDrain).resolves.toBeUndefined();
            expect(drained).toBe(true);
        } finally {
            runner.stop();
            releaseSend?.();
            await Promise.allSettled([activeRun]);
            await vi.advanceTimersByTimeAsync(0);
        }
    });
});
