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

function signalUnixProcessGroup(child: ChildProcess, signal: NodeJS.Signals): boolean {
  if (typeof child.pid !== "number") {
    return false;
  }
  try {
    process.kill(-child.pid, signal);
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

/**
 * 持有 shell 进程及其子孙的终止责任；终止结果始终有界，调用方可据此再提交唯一终态。
 */
export class ProcessLease {
  private readonly child: ChildProcess;
  private readonly closePromise: Promise<void>;
  private closeObserved = false;
  private terminationPromise: Promise<ProcessTerminationResult> | null = null;

  constructor(child: ChildProcess) {
    this.child = child;
    this.closePromise = new Promise<void>((resolve) => {
      const markClosed = () => {
        if (this.closeObserved) return;
        this.closeObserved = true;
        resolve();
      };
      child.once("close", markClosed);
      child.once("error", () => {
        if (typeof child.pid !== "number") {
          markClosed();
        }
      });
    });
  }

  terminate(): Promise<ProcessTerminationResult> {
    if (!this.terminationPromise) {
      this.terminationPromise = this.terminateInternal();
    }
    return this.terminationPromise;
  }

  private async terminateInternal(): Promise<ProcessTerminationResult> {
    if (this.closeObserved) {
      return {
        method: "already_closed",
        hardKillUsed: false,
        closeObserved: true,
      };
    }

    if (process.platform === "win32" && typeof this.child.pid === "number") {
      await Promise.all([
        runWindowsTaskkill(this.child.pid),
        waitBounded(this.closePromise, TASKKILL_WAIT_MS),
      ]);
      if (!this.closeObserved) {
        killDirectChild(this.child);
        await waitBounded(this.closePromise, HARD_EXIT_WAIT_MS);
      }
      return {
        method: "taskkill",
        hardKillUsed: true,
        closeObserved: this.closeObserved,
      };
    }

    const groupSignaled = signalUnixProcessGroup(this.child, "SIGTERM");
    if (!groupSignaled) {
      try {
        this.child.kill("SIGTERM");
      } catch {
        // 进程可能已退出。
      }
    }
    if (await waitBounded(this.closePromise, GRACEFUL_EXIT_WAIT_MS)) {
      return {
        method: groupSignaled ? "process_group" : "direct_child",
        hardKillUsed: false,
        closeObserved: true,
      };
    }

    if (!signalUnixProcessGroup(this.child, "SIGKILL")) {
      killDirectChild(this.child);
    }
    await waitBounded(this.closePromise, HARD_EXIT_WAIT_MS);
    return {
      method: groupSignaled ? "process_group" : "direct_child",
      hardKillUsed: true,
      closeObserved: this.closeObserved,
    };
  }
}
