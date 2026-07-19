import os from "node:os";
import { createRequire } from "node:module";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

// Generic interface compatible with node-pty
export interface IPty {
    pid: number;
    process: string;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(signal?: string): void;
    onData(listener: (data: string) => void): void;
    onExit(listener: (e: { exitCode: number; signal?: number }) => void): void;
}

interface Session {
    id: string;
    process: IPty;
    buffer: string[];
    bufferBytes: number;
    createdAt: number;
    lastActivity: number;
    idleTimeoutMs: number;
    idleTimer?: NodeJS.Timeout;
}

export type PtyTerminalReason = "process-exit" | "idle-timeout" | "manual" | "shutdown";

export type PtyTerminalSnapshot = {
    id: string;
    pid: number;
    cmd: string;
    output: string;
    createdAt: number;
    lastActivity: number;
    closedAt: number;
    reason: PtyTerminalReason;
    exitCode?: number;
    signal?: number;
};

type PtyCreateOptions = {
    cwd?: string;
    env?: Record<string, string>;
    cols?: number;
    rows?: number;
    idleTimeoutMs?: number;
};

type PtyFactory = (command: string, args: string[], options: PtyCreateOptions) => IPty;

export type PtyManagerOptions = {
    maxSessions?: number;
    sessionIdleTimeoutMs?: number;
    terminalHistorySize?: number;
    maxOutputBytes?: number;
    createPty?: PtyFactory;
};

export const DEFAULT_MAX_PTY_SESSIONS = 32;
export const DEFAULT_PTY_SESSION_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_PTY_TERMINAL_HISTORY_SIZE = 64;
export const DEFAULT_PTY_MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_BUFFER_CHUNKS = 2000;

type PtyBackend = "node-pty" | "child_process";
type PtyBackendStatus = {
    installed: boolean;
    backend: PtyBackend;
    resolvedFrom?: string;
    error?: string;
};

class MockPty implements IPty {
    public pid: number;
    public process: string;
    private child: ChildProcessWithoutNullStreams;

    constructor(file: string, args: string[], opt: any) {
        this.process = file;
        this.child = spawn(file, args, {
            cwd: opt.cwd,
            env: opt.env,
            shell: false // We are spawning the shell itself
        });
        this.pid = this.child.pid || 0;
    }

    write(data: string): void {
        if (this.child.stdin.writable) {
            this.child.stdin.write(data);
        }
    }

    resize(cols: number, rows: number): void {
        // No-op for standard pipes
    }

    kill(signal?: string): void {
        this.child.kill(signal as any);
    }

    onData(listener: (data: string) => void): void {
        this.child.stdout.on('data', (d) => listener(d.toString()));
        this.child.stderr.on('data', (d) => listener(d.toString()));
    }

    onExit(listener: (e: { exitCode: number; signal?: number }) => void): void {
        this.child.on('exit', (code, signal) => {
            listener({ exitCode: code || 0, signal: signal === null ? undefined : (signal as any) });
        });
    }
}

export class PtyManager {
    private sessions = new Map<string, Session>();
    private terminalSessions = new Map<string, PtyTerminalSnapshot>();
    private terminalListeners = new Map<string, Set<(snapshot: PtyTerminalSnapshot) => void>>();
    private static instance: PtyManager;
    private nodePtyModule: any = null;
    private loadAttempted = false;
    private loadPromise?: Promise<void>;
    private nodePtyResolvedFrom?: string;
    private nodePtyLoadError?: string;
    private readonly maxSessions: number;
    private readonly sessionIdleTimeoutMs: number;
    private readonly terminalHistorySize: number;
    private readonly maxOutputBytes: number;
    private readonly createPty?: PtyFactory;

    constructor(options: PtyManagerOptions = {}) {
        this.maxSessions = normalizePositiveInt(options.maxSessions, DEFAULT_MAX_PTY_SESSIONS);
        this.sessionIdleTimeoutMs = normalizePositiveInt(
            options.sessionIdleTimeoutMs,
            DEFAULT_PTY_SESSION_IDLE_TIMEOUT_MS,
        );
        this.terminalHistorySize = normalizePositiveInt(
            options.terminalHistorySize,
            DEFAULT_PTY_TERMINAL_HISTORY_SIZE,
        );
        this.maxOutputBytes = normalizePositiveInt(options.maxOutputBytes, DEFAULT_PTY_MAX_OUTPUT_BYTES);
        this.createPty = options.createPty;
    }

    public static getInstance(): PtyManager {
        if (!PtyManager.instance) {
            PtyManager.instance = new PtyManager();
        }
        return PtyManager.instance;
    }

    private async loadNodePty(): Promise<void> {
        if (this.createPty) return;
        if (this.loadPromise) {
            await this.loadPromise;
            return;
        }
        if (this.loadAttempted) return;
        if (!this.loadPromise) {
            this.loadPromise = (async () => {
                this.loadAttempted = true;
                try {
                    const require = createRequire(import.meta.url);
                    this.nodePtyResolvedFrom = require.resolve("node-pty");
                    // Try to dynamically import node-pty
                    const m = await import("node-pty");
                    this.nodePtyModule = m.default || m;
                    console.log("[PtyManager] node-pty loaded successfully.");
                } catch (e) {
                    this.nodePtyLoadError = e instanceof Error ? e.message : String(e);
                    console.warn("[PtyManager] Failed to load node-pty, falling back to MockPty (child_process).", e);
                }
            })().finally(() => {
                this.loadPromise = undefined;
            });
        }
        await this.loadPromise;
    }

    public async inspectBackend(): Promise<PtyBackendStatus> {
        await this.loadNodePty();
        return {
            installed: Boolean(this.nodePtyResolvedFrom),
            backend: this.nodePtyModule ? "node-pty" : "child_process",
            resolvedFrom: this.nodePtyResolvedFrom,
            error: this.nodePtyLoadError,
        };
    }

    async createSession(
        cmd: string,
        args: string[] = [],
        opt: PtyCreateOptions = {},
    ): Promise<string> {
        await this.loadNodePty();
        if (this.sessions.size >= this.maxSessions) {
            throw new Error(`PTY session limit reached (${this.maxSessions}). Close an active session before starting another.`);
        }

        let id: string;
        do {
            id = Math.random().toString(36).substring(7);
        } while (this.sessions.has(id) || this.terminalSessions.has(id));
        // 跨平台 shell 选择。Windows 默认用 cmd.exe 避免安全软件对「PowerShell 命令执行」的误报；需 PowerShell 时可传 cmd="powershell.exe"
        const shell = cmd || (os.platform() === "win32"
            ? "cmd.exe"
            : (process.env.SHELL || "/bin/bash"));
        const env = Object.assign({}, process.env, opt.env);
        const cwd = opt.cwd || process.cwd();

        let ptyProcess: IPty;

        if (this.createPty) {
            ptyProcess = this.createPty(shell, args, opt);
        } else if (this.nodePtyModule) {
            ptyProcess = this.nodePtyModule.spawn(shell, args, {
                name: "xterm-color",
                cols: opt.cols || 80,
                rows: opt.rows || 24,
                cwd,
                env,
                // On Windows, the bundled conpty.dll path avoids the noisy
                // AttachConsole race in node-pty's default console-list helper.
                ...(os.platform() === "win32" ? { useConptyDll: true } : {}),
            }) as IPty;
        } else {
            // Fallback
            ptyProcess = new MockPty(shell, args, { cwd, env });
        }

        const now = Date.now();
        const session: Session = {
            id,
            process: ptyProcess,
            buffer: [],
            bufferBytes: 0,
            createdAt: now,
            lastActivity: now,
            idleTimeoutMs: normalizePositiveInt(opt.idleTimeoutMs, this.sessionIdleTimeoutMs),
        };
        this.sessions.set(id, session);

        ptyProcess.onData((data) => {
            if (this.sessions.get(id) !== session) return;
            this.appendOutput(session, data);
            this.touchSession(session);
        });

        ptyProcess.onExit((e) => {
            if (this.sessions.get(id) !== session) return;
            this.finalizeSession(session, "process-exit", {
                exitCode: e.exitCode,
                signal: e.signal,
            });
        });

        this.scheduleIdleTimeout(session);
        return id;
    }

    // ... rest of methods are synchronous but session map lookup handles it

    resize(id: string, cols: number, rows: number) {
        const session = this.sessions.get(id);
        if (!session) throw new Error(`Session ${id} not found`);
        session.process.resize(cols, rows);
        this.touchSession(session);
    }

    write(id: string, data: string) {
        const session = this.sessions.get(id);
        if (!session) throw new Error(`Session ${id} not found`);
        session.process.write(data);
        this.touchSession(session);
    }

    read(id: string): string {
        const session = this.sessions.get(id);
        if (session) {
            const output = session.buffer.join("");
            session.buffer = [];
            session.bufferBytes = 0;
            this.touchSession(session);
            return output;
        }
        const terminal = this.terminalSessions.get(id);
        if (!terminal) throw new Error(`Session ${id} not found`);
        const output = terminal.output;
        terminal.output = "";
        return output;
    }

    peek(id: string): string {
        const session = this.sessions.get(id);
        return session?.buffer.join("") ?? this.terminalSessions.get(id)?.output ?? "";
    }

    kill(id: string, reason: Exclude<PtyTerminalReason, "process-exit"> = "manual") {
        const session = this.sessions.get(id);
        if (session) {
            this.finalizeSession(session, reason, { kill: true });
        }
    }

    shutdownAll(): number {
        const sessions = [...this.sessions.values()];
        for (const session of sessions) {
            this.finalizeSession(session, "shutdown", { kill: true });
        }
        return sessions.length;
    }

    onTerminal(id: string, listener: (snapshot: PtyTerminalSnapshot) => void): () => void {
        const terminal = this.terminalSessions.get(id);
        if (terminal) {
            queueMicrotask(() => listener({ ...terminal }));
            return () => {};
        }
        const listeners = this.terminalListeners.get(id) ?? new Set();
        listeners.add(listener);
        this.terminalListeners.set(id, listeners);
        return () => {
            const current = this.terminalListeners.get(id);
            current?.delete(listener);
            if (current?.size === 0) {
                this.terminalListeners.delete(id);
            }
        };
    }

    list(): { id: string; pid: number; cmd: string }[] {
        return Array.from(this.sessions.values()).map(s => ({
            id: s.id,
            pid: s.process.pid,
            cmd: s.process.process
        }));
    }

    listTerminal(): PtyTerminalSnapshot[] {
        return Array.from(this.terminalSessions.values(), (snapshot) => ({ ...snapshot }));
    }

    private touchSession(session: Session): void {
        if (this.sessions.get(session.id) !== session) return;
        session.lastActivity = Date.now();
        this.scheduleIdleTimeout(session);
    }

    private scheduleIdleTimeout(session: Session): void {
        if (session.idleTimer) {
            clearTimeout(session.idleTimer);
        }
        session.idleTimer = setTimeout(() => {
            if (this.sessions.get(session.id) !== session) return;
            this.finalizeSession(session, "idle-timeout", { kill: true });
        }, session.idleTimeoutMs);
        session.idleTimer.unref?.();
    }

    private appendOutput(session: Session, data: string): void {
        let bounded = data;
        let bytes = Buffer.byteLength(bounded, "utf-8");
        if (bytes > this.maxOutputBytes) {
            bounded = takeUtf8Tail(bounded, this.maxOutputBytes);
            bytes = Buffer.byteLength(bounded, "utf-8");
            session.buffer = [];
            session.bufferBytes = 0;
        }
        session.buffer.push(bounded);
        session.bufferBytes += bytes;
        while (
            session.buffer.length > 1
            && (session.bufferBytes > this.maxOutputBytes || session.buffer.length > MAX_BUFFER_CHUNKS)
        ) {
            const removed = session.buffer.shift() ?? "";
            session.bufferBytes -= Buffer.byteLength(removed, "utf-8");
        }
    }

    private finalizeSession(
        session: Session,
        reason: PtyTerminalReason,
        options: { exitCode?: number; signal?: number; kill?: boolean } = {},
    ): void {
        if (this.sessions.get(session.id) !== session) return;
        this.sessions.delete(session.id);
        if (session.idleTimer) {
            clearTimeout(session.idleTimer);
            session.idleTimer = undefined;
        }

        const message = reason === "process-exit"
            ? `\n[Process exited with code ${options.exitCode ?? 0}]\n`
            : `\n[Session closed: ${reason}]\n`;
        this.appendOutput(session, message);
        if (options.kill) {
            try {
                session.process.kill();
            } catch {
                // 进程可能已在终止竞态中退出。
            }
        }

        const snapshot: PtyTerminalSnapshot = {
            id: session.id,
            pid: session.process.pid,
            cmd: session.process.process,
            output: session.buffer.join(""),
            createdAt: session.createdAt,
            lastActivity: session.lastActivity,
            closedAt: Date.now(),
            reason,
            ...(options.exitCode !== undefined ? { exitCode: options.exitCode } : {}),
            ...(options.signal !== undefined ? { signal: options.signal } : {}),
        };
        this.terminalSessions.set(session.id, snapshot);
        while (this.terminalSessions.size > this.terminalHistorySize) {
            const oldestId = this.terminalSessions.keys().next().value as string | undefined;
            if (!oldestId) break;
            this.terminalSessions.delete(oldestId);
        }

        const listeners = this.terminalListeners.get(session.id);
        this.terminalListeners.delete(session.id);
        for (const listener of listeners ?? []) {
            queueMicrotask(() => {
                try {
                    listener({ ...snapshot });
                } catch {
                    // terminal 通知不能反向破坏 PTY 资源收敛。
                }
            });
        }
    }
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) && (value ?? 0) > 0
        ? Math.floor(value as number)
        : fallback;
}

function takeUtf8Tail(value: string, maxBytes: number): string {
    const buffer = Buffer.from(value, "utf-8");
    if (buffer.length <= maxBytes) return value;
    let start = buffer.length - maxBytes;
    while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) {
        start += 1;
    }
    return buffer.subarray(start).toString("utf-8");
}
