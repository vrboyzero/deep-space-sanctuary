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

    it("queues a heartbeat until shared background capacity is available", async () => {
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

        const run = runner.runOnce();
        try {
            await vi.waitFor(() => {
                expect(coordinator.getRuntimeSnapshot().queuedCount).toBe(1);
            });
            expect(sendMessage).not.toHaveBeenCalled();

            heldCronClaim.release();
            await expect(run).resolves.toMatchObject({ status: "ran" });
            expect(sendMessage).toHaveBeenCalledTimes(1);
        } finally {
            runner.stop();
            heldCronClaim.release();
            await Promise.allSettled([run]);
        }
    });

    it("cancels a queued coordinator admission when Heartbeat stops and drains", async () => {
        await fs.writeFile(path.join(tmpDir, "HEARTBEAT.md"), "cancel queued heartbeat");
        const coordinator = new BackgroundRunCoordinator({ maxConcurrentRuns: 1 });
        const held = coordinator.tryClaim({ kind: "cron", key: "daily" });
        if ("reason" in held) throw new Error(held.reason);
        const sendMessage = vi.fn(async () => HEARTBEAT_OK_TOKEN);
        const runner = startHeartbeatRunner({
            workspaceDir: tmpDir,
            sendMessage,
            runCoordinator: coordinator,
        });
        const run = runner.runOnce();
        let drain: Promise<void> | undefined;

        try {
            await vi.waitFor(() => expect(coordinator.getRuntimeSnapshot().queuedCount).toBe(1));
            drain = runner.stopAndDrain();
            await vi.waitFor(() => expect(coordinator.getRuntimeSnapshot().queuedCount).toBe(0));
            await expect(run).resolves.toEqual({ status: "skipped", reason: "runner-stopped" });
            await expect(drain).resolves.toBeUndefined();
            expect(sendMessage).not.toHaveBeenCalled();
        } finally {
            runner.stop();
            held.release();
            await Promise.allSettled([run, drain ?? Promise.resolve()]);
        }
    });

    it("propagates the coordinator claim context into an active heartbeat", async () => {
        await fs.writeFile(path.join(tmpDir, "HEARTBEAT.md"), "observe heartbeat signal");
        const coordinator = new BackgroundRunCoordinator({ maxConcurrentRuns: 1 });
        let observedSignal: AbortSignal | undefined;
        let observedGeneration: number | undefined;
        let markStarted!: () => void;
        const started = new Promise<void>((resolve) => {
            markStarted = resolve;
        });
        let finishRun!: () => void;
        const runGate = new Promise<void>((resolve) => {
            finishRun = resolve;
        });
        const runner = startHeartbeatRunner({
            workspaceDir: tmpDir,
            sendMessage: vi.fn(async (input) => {
                const context = input as typeof input & {
                    signal?: AbortSignal;
                    generation?: number;
                };
                observedSignal = context.signal;
                observedGeneration = context.generation;
                markStarted();
                await runGate;
                return HEARTBEAT_OK_TOKEN;
            }),
            runCoordinator: coordinator,
        });
        const run = runner.runOnce();
        await started;
        const drain = coordinator.stopAndDrain();

        try {
            expect(observedSignal).toBeInstanceOf(AbortSignal);
            expect(observedSignal?.aborted).toBe(true);
            expect(observedGeneration).toBe(1);
        } finally {
            finishRun();
            await Promise.allSettled([run, drain]);
            runner.stop();
        }
    });

    it("drops terminal effects when an active heartbeat generation is cancelled", async () => {
        await fs.writeFile(path.join(tmpDir, "HEARTBEAT.md"), "late heartbeat completion");
        const coordinator = new BackgroundRunCoordinator({ maxConcurrentRuns: 1 });
        const deliverToUser = vi.fn(async () => {});
        const runEvents: Array<{ phase: string }> = [];
        let markStarted!: () => void;
        const started = new Promise<void>((resolve) => {
            markStarted = resolve;
        });
        let finishRun!: () => void;
        const runGate = new Promise<void>((resolve) => {
            finishRun = resolve;
        });
        const runner = startHeartbeatRunner({
            workspaceDir: tmpDir,
            sendMessage: vi.fn(async () => {
                markStarted();
                await runGate;
                return "late proactive message";
            }),
            deliverToUser,
            runCoordinator: coordinator,
            onRunEvent: (event) => {
                runEvents.push(event);
            },
        });
        const run = runner.runOnce();
        await started;
        const drain = coordinator.stopAndDrain();

        try {
            finishRun();
            await expect(run).resolves.toEqual({
                status: "skipped",
                reason: "heartbeat-claim-not-active",
            });
            await expect(drain).resolves.toBeUndefined();
            expect(deliverToUser).not.toHaveBeenCalled();
            expect(runEvents.filter((event) => event.phase === "finished")).toHaveLength(0);
            await expect(fs.readFile(path.join(tmpDir, "heartbeat-state.json"), "utf-8")).rejects.toThrow();
        } finally {
            finishRun();
            await Promise.allSettled([run, drain]);
            runner.stop();
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

    it("queues an interval heartbeat through the shared coordinator", async () => {
        vi.useFakeTimers();
        await fs.writeFile(path.join(tmpDir, "HEARTBEAT.md"), "queue interval heartbeat");
        const coordinator = new BackgroundRunCoordinator({ maxConcurrentRuns: 1 });
        const held = coordinator.tryClaim({ kind: "cron", key: "daily" });
        if ("reason" in held) throw new Error(held.reason);
        const sendMessage = vi.fn(async () => HEARTBEAT_OK_TOKEN);
        const runner = startHeartbeatRunner({
            workspaceDir: tmpDir,
            sendMessage,
            runCoordinator: coordinator,
            intervalMs: 1_000,
            activeHours: { start: "00:00", end: "24:00" },
        });

        try {
            await vi.advanceTimersByTimeAsync(1_000);
            expect(coordinator.getRuntimeSnapshot().queuedCount).toBe(1);
            expect(sendMessage).not.toHaveBeenCalled();

            held.release();
            await vi.advanceTimersByTimeAsync(0);
            await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
        } finally {
            runner.stop();
            held.release();
            await runner.stopAndDrain();
        }
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
