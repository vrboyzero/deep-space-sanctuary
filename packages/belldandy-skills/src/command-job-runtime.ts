import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

import type { CommandJobProcess, CommandJobProcessExit } from "./command-job.js";
import { ProcessLease, shouldDetachProcessTree } from "./builtin/system/process-lease.js";
import { createPtyHostCommandJobProcess } from "./command-job-pty-host-runtime.js";

export type CommandJobRuntimeInvocation = {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdinMode: "closed" | "pipe" | "pty";
  startupTimeoutMs?: number;
};

function emitListeners<T>(listeners: Set<(event: T) => void>, event: T): void {
  for (const listener of listeners) {
    notifyListener(listener, event);
  }
}

function notifyListener<T>(listener: (event: T) => void, event: T): void {
  try {
    listener(event);
  } catch {
    // Job lifecycle notifications cannot reverse process cleanup.
  }
}

function replayPendingData(listener: (data: string) => void, pendingData: string[]): void {
  for (const data of pendingData.splice(0)) {
    notifyListener(listener, data);
  }
}

function emitOrBufferData(
  listeners: Set<(data: string) => void>,
  pendingData: string[],
  data: string,
): void {
  if (!data) return;
  if (listeners.size === 0) {
    pendingData.push(data);
    return;
  }
  emitListeners(listeners, data);
}

function createUtf8Emitter(input: {
  listeners: Set<(data: string) => void>;
  pendingData: string[];
}): {
  write: (data: Buffer | string) => void;
  flush: () => void;
} {
  const decoder = new StringDecoder("utf8");
  let flushed = false;
  const emit = (data: string) => emitOrBufferData(input.listeners, input.pendingData, data);
  return {
    write: (data) => emit(decoder.write(Buffer.isBuffer(data) ? data : Buffer.from(data))),
    flush: () => {
      if (flushed) return;
      flushed = true;
      emit(decoder.end());
    },
  };
}

function createPipeCommandJobProcess(input: CommandJobRuntimeInvocation): CommandJobProcess {
  let child: ChildProcess;
  try {
    child = spawn(input.executable, input.args, {
      cwd: input.cwd,
      shell: false,
      detached: shouldDetachProcessTree(),
      env: input.env,
      stdio: [input.stdinMode === "pipe" ? "pipe" : "ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Unable to start sandbox command runtime.");
  }

  const dataListeners = new Set<(data: string) => void>();
  const pendingData: string[] = [];
  const exitListeners = new Set<(event: CommandJobProcessExit) => void>();
  let exitEvent: CommandJobProcessExit | undefined;
  const stdout = createUtf8Emitter({ listeners: dataListeners, pendingData });
  const stderr = createUtf8Emitter({ listeners: dataListeners, pendingData });
  const notifyExit = (event: CommandJobProcessExit) => {
    if (exitEvent) return;
    stdout.flush();
    stderr.flush();
    exitEvent = event;
    emitListeners(exitListeners, event);
  };
  child.stdout?.on("data", (data: Buffer | string) => stdout.write(data));
  child.stderr?.on("data", (data: Buffer | string) => stderr.write(data));
  child.once("close", (exitCode, signal) => {
    notifyExit({
      ...(exitCode !== null ? { exitCode } : {}),
      ...(signal ? { signal } : {}),
    });
  });
  child.once("error", (error) => {
    notifyExit({ error: `Sandbox runtime spawn error: ${error.message}` });
  });
  const processLease = new ProcessLease(child);

  return {
    pid: child.pid ?? 0,
    supportsResize: false,
    write(data: string) {
      if (!child.stdin || !child.stdin.writable) {
        throw new Error("Command job stdin is not writable.");
      }
      child.stdin.write(data);
    },
    resize() {
      throw new Error("Command job does not have a PTY and cannot be resized.");
    },
    onData(listener) {
      dataListeners.add(listener);
      replayPendingData(listener, pendingData);
    },
    onExit(listener) {
      if (exitEvent) {
        notifyListener(listener, exitEvent);
        return;
      }
      exitListeners.add(listener);
    },
    terminate() {
      return processLease.terminate();
    },
  };
}

/**
 * Starts only the local OCI runtime wrapper. The caller still owns the OCI lease and
 * container cleanup, keeping all sandbox resource cleanup under the command-job owner.
 */
export async function createCommandJobProcess(input: CommandJobRuntimeInvocation): Promise<CommandJobProcess> {
  return input.stdinMode === "pty"
    ? await createPtyHostCommandJobProcess(input)
    : createPipeCommandJobProcess(input);
}
