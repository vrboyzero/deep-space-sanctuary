import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { CommandJobProcess, CommandJobProcessExit } from "./command-job.js";
import { ProcessLease, type ProcessTerminationResult } from "./builtin/system/process-lease.js";

const DEFAULT_PTY_HOST_STARTUP_TIMEOUT_MS = 5_000;

export type PtyHostInvocation = {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  startupTimeoutMs?: number;
};

export type PtyHostControl =
  | { type: "start"; invocation: Omit<PtyHostInvocation, "startupTimeoutMs"> }
  | { type: "write"; data: string }
  | { type: "resize"; cols: number; rows: number };

export type PtyHostEvent =
  | { type: "started" }
  | { type: "data"; data: string }
  | { type: "exit"; exitCode: number; signal?: number }
  | { type: "error"; error: string };

export type PtyHostAdapter = {
  readonly pid: number;
  send(message: PtyHostControl): void;
  onMessage(listener: (message: PtyHostEvent) => void): void;
  onClose(listener: (event: CommandJobProcessExit) => void): void;
  terminate(): Promise<ProcessTerminationResult>;
};

export type CreatePtyHostAdapter = (input: PtyHostInvocation) => PtyHostAdapter;

function normalizeStartupTimeout(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0
    ? value as number
    : DEFAULT_PTY_HOST_STARTUP_TIMEOUT_MS;
}

function notifyListener<T>(listener: (event: T) => void, event: T): void {
  try {
    listener(event);
  } catch {
    // PTY host lifecycle notifications cannot reverse process cleanup.
  }
}

function resolveHostModulePath(): string {
  const runtimePath = fileURLToPath(import.meta.url);
  const extension = runtimePath.endsWith(".ts") ? ".ts" : ".js";
  return fileURLToPath(new URL(`./command-job-pty-host${extension}`, import.meta.url));
}

function filterForkExecArgv(arguments_: string[]): string[] {
  return arguments_.filter((argument, index) => (
    argument !== "--input-type"
    && !argument.startsWith("--input-type=")
    && arguments_[index - 1] !== "--input-type"
  ));
}

function createNodePtyHostAdapter(input: PtyHostInvocation): PtyHostAdapter {
  const hostModulePath = resolveHostModulePath();
  const child: ChildProcess = fork(hostModulePath, [], {
    cwd: path.dirname(hostModulePath),
    env: input.env,
    execArgv: filterForkExecArgv(process.execArgv),
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const lease = new ProcessLease(child);

  return {
    pid: child.pid ?? 0,
    send(message) {
      if (!child.connected) {
        throw new Error("PTY host IPC channel is unavailable.");
      }
      child.send(message);
    },
    onMessage(listener) {
      child.on("message", (message) => listener(message as PtyHostEvent));
    },
    onClose(listener) {
      child.once("close", (exitCode, signal) => listener({
        ...(exitCode !== null ? { exitCode } : {}),
        ...(signal ? { signal } : {}),
      }));
      child.once("error", (error) => listener({ error: `PTY host process error: ${error.message}` }));
    },
    terminate() {
      return lease.terminate();
    },
  };
}

/**
 * Keeps the synchronous native PTY spawn outside the Gateway process. Callers retain
 * the existing CommandJobProcess interface while this module owns IPC and startup fencing.
 */
export async function createPtyHostCommandJobProcess(
  input: PtyHostInvocation,
  createHost: CreatePtyHostAdapter = createNodePtyHostAdapter,
): Promise<CommandJobProcess> {
  const host = createHost(input);
  const dataListeners = new Set<(data: string) => void>();
  const pendingData: string[] = [];
  const exitListeners = new Set<(event: CommandJobProcessExit) => void>();
  let exitEvent: CommandJobProcessExit | undefined;
  let started = false;

  const notifyExit = (event: CommandJobProcessExit) => {
    if (exitEvent) return;
    exitEvent = event;
    for (const listener of exitListeners) notifyListener(listener, event);
  };
  const appendData = (data: string) => {
    if (!data) return;
    if (dataListeners.size === 0) {
      pendingData.push(data);
      return;
    }
    for (const listener of dataListeners) notifyListener(listener, data);
  };

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const terminateAndReject = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void host.terminate().finally(() => reject(error));
    };
    const timer = setTimeout(() => {
      terminateAndReject(new Error(
        `PTY host startup timed out after ${normalizeStartupTimeout(input.startupTimeoutMs)}ms.`,
      ));
    }, normalizeStartupTimeout(input.startupTimeoutMs));

    host.onMessage((message) => {
      if (message.type === "started") {
        started = true;
        finish();
        return;
      }
      if (message.type === "data") {
        appendData(message.data);
        return;
      }
      if (message.type === "exit") {
        notifyExit({ exitCode: message.exitCode, ...(message.signal !== undefined ? { signal: message.signal } : {}) });
        return;
      }
      if (message.type === "error") {
        if (!started) terminateAndReject(new Error(message.error));
        else notifyExit({ error: message.error });
      }
    });
    host.onClose((event) => {
      if (!started) {
        finish(new Error(event.error ?? "PTY host exited before the sandbox runtime started."));
        return;
      }
      notifyExit(event.error ? event : { ...event, error: "PTY host exited before the sandbox runtime reported its terminal state." });
    });

    try {
      host.send({
        type: "start",
        invocation: {
          executable: input.executable,
          args: input.args,
          cwd: input.cwd,
          env: input.env,
        },
      });
    } catch (error) {
      terminateAndReject(new Error(error instanceof Error ? error.message : "Unable to start PTY host."));
    }
  });

  return {
    pid: host.pid,
    supportsResize: true,
    write(data: string) {
      host.send({ type: "write", data });
    },
    resize(cols: number, rows: number) {
      host.send({ type: "resize", cols, rows });
    },
    onData(listener) {
      dataListeners.add(listener);
      for (const data of pendingData.splice(0)) notifyListener(listener, data);
    },
    onExit(listener) {
      if (exitEvent) notifyListener(listener, exitEvent);
      else exitListeners.add(listener);
    },
    terminate() {
      return host.terminate();
    },
  };
}
