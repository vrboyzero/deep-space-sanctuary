import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Mock content.ts to avoid complex file parsing if needed, 
// but we can import real functions too.
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

        releaseSend?.();
        await vi.runOnlyPendingTimersAsync();
        runner.stop();
    });
});
