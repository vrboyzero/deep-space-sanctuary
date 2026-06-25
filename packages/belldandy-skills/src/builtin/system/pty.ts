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
    createdAt: number;
    lastActivity: number;
}

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
    private static instance: PtyManager;
    private nodePtyModule: any = null;
    private loadAttempted = false;
    private nodePtyResolvedFrom?: string;
    private nodePtyLoadError?: string;

    private constructor() { }

    public static getInstance(): PtyManager {
        if (!PtyManager.instance) {
            PtyManager.instance = new PtyManager();
        }
        return PtyManager.instance;
    }

    private async loadNodePty() {
        if (this.loadAttempted) return;
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
        opt: { cwd?: string; env?: Record<string, string>; cols?: number; rows?: number } = {}
    ): Promise<string> {
        await this.loadNodePty();

        const id = Math.random().toString(36).substring(7);
        // 跨平台 shell 选择。Windows 默认用 cmd.exe 避免安全软件对「PowerShell 命令执行」的误报；需 PowerShell 时可传 cmd="powershell.exe"
        const shell = cmd || (os.platform() === "win32"
            ? "cmd.exe"
            : (process.env.SHELL || "/bin/bash"));
        const env = Object.assign({}, process.env, opt.env);
        const cwd = opt.cwd || process.cwd();

        let ptyProcess: IPty;

        if (this.nodePtyModule) {
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

        const session: Session = {
            id,
            process: ptyProcess,
            buffer: [],
            createdAt: Date.now(),
            lastActivity: Date.now(),
        };

        ptyProcess.onData((data) => {
            session.buffer.push(data);
            session.lastActivity = Date.now();
            if (session.buffer.length > 2000) session.buffer.shift();
        });

        ptyProcess.onExit((e) => {
            session.buffer.push(`\n[Process exited with code ${e.exitCode}]\n`);
        });

        this.sessions.set(id, session);
        return id;
    }

    // ... rest of methods are synchronous but session map lookup handles it

    resize(id: string, cols: number, rows: number) {
        const session = this.sessions.get(id);
        if (!session) throw new Error(`Session ${id} not found`);
        session.process.resize(cols, rows);
        session.lastActivity = Date.now();
    }

    write(id: string, data: string) {
        const session = this.sessions.get(id);
        if (!session) throw new Error(`Session ${id} not found`);
        session.process.write(data);
        session.lastActivity = Date.now();
    }

    read(id: string): string {
        const session = this.sessions.get(id);
        if (!session) throw new Error(`Session ${id} not found`);
        const output = session.buffer.join("");
        session.buffer = [];
        session.lastActivity = Date.now();
        return output;
    }

    peek(id: string): string {
        const session = this.sessions.get(id);
        if (!session) {
            return "";
        }
        return session.buffer.join("");
    }

    kill(id: string) {
        const session = this.sessions.get(id);
        if (session) {
            session.process.kill();
            this.sessions.delete(id);
        }
    }

    list(): { id: string; pid: number; cmd: string }[] {
        return Array.from(this.sessions.values()).map(s => ({
            id: s.id,
            pid: s.process.pid,
            cmd: s.process.process
        }));
    }
}
