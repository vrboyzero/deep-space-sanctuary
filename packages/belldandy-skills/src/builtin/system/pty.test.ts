import { afterEach, describe, expect, it, vi } from "vitest";

import { PtyManager, type IPty } from "./pty.js";

class FakePty implements IPty {
    readonly pid: number;
    readonly process: string;
    killed = false;
    writes: string[] = [];
    private dataListener?: (data: string) => void;
    private exitListener?: (event: { exitCode: number; signal?: number }) => void;

    constructor(pid: number, processName: string) {
        this.pid = pid;
        this.process = processName;
    }

    write(data: string): void {
        this.writes.push(data);
    }

    resize(): void {}

    kill(): void {
        this.killed = true;
    }

    onData(listener: (data: string) => void): void {
        this.dataListener = listener;
    }

    onExit(listener: (event: { exitCode: number; signal?: number }) => void): void {
        this.exitListener = listener;
    }

    emitData(data: string): void {
        this.dataListener?.(data);
    }

    emitExit(exitCode = 0, signal?: number): void {
        this.exitListener?.({ exitCode, signal });
    }
}

function createManager(options: {
    maxSessions?: number;
    sessionIdleTimeoutMs?: number;
    terminalHistorySize?: number;
    maxOutputBytes?: number;
} = {}) {
    const ptys: FakePty[] = [];
    const manager = new PtyManager({
        ...options,
        createPty: (command) => {
            const pty = new FakePty(1000 + ptys.length, command);
            ptys.push(pty);
            return pty;
        },
    });
    return { manager, ptys };
}

afterEach(() => {
    vi.useRealTimers();
});

describe("PtyManager lifecycle limits", () => {
    it("removes an exited session and retains one bounded terminal snapshot", async () => {
        const { manager, ptys } = createManager({
            terminalHistorySize: 2,
            maxOutputBytes: 32,
        });
        const sessionId = await manager.createSession("test-command");
        const terminalEvents: Array<{ reason: string; output: string }> = [];
        manager.onTerminal(sessionId, (snapshot) => terminalEvents.push(snapshot));

        ptys[0].emitData("x".repeat(64));
        ptys[0].emitExit(0);
        await Promise.resolve();

        expect(manager.list()).toEqual([]);
        expect(manager.listTerminal()).toHaveLength(1);
        expect(manager.listTerminal()[0]).toMatchObject({
            id: sessionId,
            reason: "process-exit",
            exitCode: 0,
        });
        expect(Buffer.byteLength(manager.listTerminal()[0].output, "utf-8")).toBeLessThanOrEqual(32);
        expect(terminalEvents).toHaveLength(1);
    });

    it("rejects capacity overflow before spawning another PTY", async () => {
        const { manager, ptys } = createManager({ maxSessions: 1 });
        await manager.createSession("first-command");

        await expect(manager.createSession("second-command")).rejects.toThrow("PTY session limit reached");
        expect(ptys).toHaveLength(1);
    });

    it("resets idle TTL on activity and releases the session after inactivity", async () => {
        vi.useFakeTimers();
        const { manager, ptys } = createManager({ sessionIdleTimeoutMs: 100 });
        const sessionId = await manager.createSession("idle-command");

        await vi.advanceTimersByTimeAsync(80);
        manager.write(sessionId, "keep-alive");
        await vi.advanceTimersByTimeAsync(80);
        expect(manager.list()).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(21);
        expect(manager.list()).toEqual([]);
        expect(ptys[0].killed).toBe(true);
        expect(manager.listTerminal()[0]).toMatchObject({ reason: "idle-timeout" });
    });

    it("keeps terminal history bounded across 10000 completed sessions", async () => {
        const { manager, ptys } = createManager({
            maxSessions: 1,
            terminalHistorySize: 8,
        });

        for (let index = 0; index < 10_000; index += 1) {
            await manager.createSession(`command-${index}`);
            ptys[index].emitExit(0);
        }

        expect(manager.list()).toEqual([]);
        expect(manager.listTerminal()).toHaveLength(8);
        expect(ptys).toHaveLength(10_000);
    }, 15_000);

    it("kills and detaches every active session during shutdown", async () => {
        const { manager, ptys } = createManager({ maxSessions: 3 });
        await manager.createSession("first-command");
        await manager.createSession("second-command");

        expect(manager.shutdownAll()).toBe(2);
        expect(manager.list()).toEqual([]);
        expect(ptys.every((pty) => pty.killed)).toBe(true);
        expect(manager.listTerminal().map((snapshot) => snapshot.reason)).toEqual([
            "shutdown",
            "shutdown",
        ]);
    });
});
