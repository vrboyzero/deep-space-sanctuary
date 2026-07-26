import { spawn, type ChildProcess } from "node:child_process";

const GRACEFUL_EXIT_WAIT_MS = 150;
const HARD_EXIT_WAIT_MS = 750;
const TASKKILL_WAIT_MS = 750;

export type ProcessTerminationResult = {
  method: "already_closed" | "process_group" | "taskkill" | "direct_child";
  hardKillUsed: boolean;
  closeObserved: boolean;
};

function waitBounded(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    void promise.then(() => finish(true), () => finish(true));
  });
}

function killDirectChild(child: ChildProcess): void {
  try {
    child.kill("SIGKILL");
    return;
  } catch {
    // 继续尝试平台默认 signal。
  }
  try {
    child.kill();
  } catch {
    // 进程可能已退出。
  }
}

function signalUnixProcessGroup(pid: number | undefined, signal: NodeJS.Signals): boolean {
  if (typeof pid !== "number") {
    return false;
  }
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

async function runWindowsTaskkill(pid: number): Promise<void> {
  let helper: ChildProcess;
  try {
    helper = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    return;
  }

  const exited = new Promise<void>((resolve) => {
    helper.once("exit", () => resolve());
    helper.once("error", () => resolve());
  });
  if (!await waitBounded(exited, TASKKILL_WAIT_MS)) {
    killDirectChild(helper);
  }
}

export function shouldDetachProcessTree(): boolean {
  return process.platform !== "win32";
}

export type ProcessTreeLeaseTarget = {
  pid?: number;
  closePromise: Promise<void>;
  isCloseObserved: () => boolean;
  killDirect: (signal: NodeJS.Signals) => void;
};

/**
 * Holds the process-tree termination responsibility for either a ChildProcess or a
 * PTY-backed process. The result is bounded so the job owner can publish one terminal state.
 */
export class ProcessTreeLease {
  private terminationPromise: Promise<ProcessTerminationResult> | null = null;

  constructor(private readonly target: ProcessTreeLeaseTarget) {}

  terminate(): Promise<ProcessTerminationResult> {
    if (!this.terminationPromise) {
      this.terminationPromise = this.terminateInternal();
    }
    return this.terminationPromise;
  }

  private async terminateInternal(): Promise<ProcessTerminationResult> {
    if (this.target.isCloseObserved()) {
      return {
        method: "already_closed",
        hardKillUsed: false,
        closeObserved: true,
      };
    }

    if (process.platform === "win32" && typeof this.target.pid === "number") {
      await Promise.all([
        runWindowsTaskkill(this.target.pid),
        waitBounded(this.target.closePromise, TASKKILL_WAIT_MS),
      ]);
      if (!this.target.isCloseObserved()) {
        this.target.killDirect("SIGKILL");
        await waitBounded(this.target.closePromise, HARD_EXIT_WAIT_MS);
      }
      return {
        method: "taskkill",
        hardKillUsed: true,
        closeObserved: this.target.isCloseObserved(),
      };
    }

    const groupSignaled = signalUnixProcessGroup(this.target.pid, "SIGTERM");
    if (!groupSignaled) {
      this.target.killDirect("SIGTERM");
    }
    if (await waitBounded(this.target.closePromise, GRACEFUL_EXIT_WAIT_MS)) {
      return {
        method: groupSignaled ? "process_group" : "direct_child",
        hardKillUsed: false,
        closeObserved: true,
      };
    }

    if (!signalUnixProcessGroup(this.target.pid, "SIGKILL")) {
      this.target.killDirect("SIGKILL");
    }
    await waitBounded(this.target.closePromise, HARD_EXIT_WAIT_MS);
    return {
      method: groupSignaled ? "process_group" : "direct_child",
      hardKillUsed: true,
      closeObserved: this.target.isCloseObserved(),
    };
  }
}

/** Retains the legacy ChildProcess constructor while sharing the PTY-safe tree terminator. */
export class ProcessLease {
  private readonly lease: ProcessTreeLease;

  constructor(child: ChildProcess) {
    let closeObserved = false;
    const closePromise = new Promise<void>((resolve) => {
      const markClosed = () => {
        if (closeObserved) return;
        closeObserved = true;
        resolve();
      };
      child.once("close", markClosed);
      child.once("error", () => {
        if (typeof child.pid !== "number") {
          markClosed();
        }
      });
    });
    this.lease = new ProcessTreeLease({
      pid: child.pid,
      closePromise,
      isCloseObserved: () => closeObserved,
      killDirect: (signal) => {
        try {
          child.kill(signal);
        } catch {
          // The child may already be in an exit race.
        }
      },
    });
  }

  terminate(): Promise<ProcessTerminationResult> {
    return this.lease.terminate();
  }
}
