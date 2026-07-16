export const RESTART_EXIT_CODE = 100;
export const RESTART_DELAY_MS = 500;

export type GatewaySupervisorSignal = "SIGINT" | "SIGTERM";

export type GatewaySupervisorChild = {
  pid?: number;
  killed?: boolean;
  kill: (signal?: NodeJS.Signals | number) => boolean;
  once: {
    (event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
    (event: "error", listener: (error: Error) => void): unknown;
  };
};

export type GatewaySupervisorSignalTarget = {
  on: (signal: GatewaySupervisorSignal, listener: () => void) => unknown;
  off: (signal: GatewaySupervisorSignal, listener: () => void) => unknown;
};

export type GatewaySupervisorLifecycleOptions = {
  label: string;
  launch: () => Promise<GatewaySupervisorChild>;
  removeForegroundPid: () => void;
  onExit: (code: number) => void;
  signalTarget: GatewaySupervisorSignalTarget;
  logger?: Pick<Console, "log" | "error">;
  restartExitCode?: number;
  restartDelayMs?: number;
};

export type GatewaySupervisorLifecycle = {
  start: () => Promise<void>;
};

type ChildTerminal =
  | { kind: "error"; error: Error }
  | { kind: "exit"; code: number | null; signal: NodeJS.Signals | null };

/**
 * 管理前台 Gateway child 的唯一终态、父进程信号和单一重启 timer。
 * 启动/预检细节保留在调用方，避免生命周期状态和 Distribution I/O 相互耦合。
 */
export function createGatewaySupervisorLifecycle(
  options: GatewaySupervisorLifecycleOptions,
): GatewaySupervisorLifecycle {
  const logger = options.logger ?? console;
  const restartExitCode = options.restartExitCode ?? RESTART_EXIT_CODE;
  const restartDelayMs = options.restartDelayMs ?? RESTART_DELAY_MS;
  let activeChild: GatewaySupervisorChild | undefined;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let started = false;
  let stopped = false;
  let shutdownRequested = false;
  let signalListenersInstalled = false;

  const signalHandlers: Record<GatewaySupervisorSignal, () => void> = {
    SIGINT: () => forwardSignal("SIGINT"),
    SIGTERM: () => forwardSignal("SIGTERM"),
  };

  async function start(): Promise<void> {
    if (started) {
      throw new Error("Gateway supervisor lifecycle has already started.");
    }
    started = true;
    try {
      await launchChild();
    } catch (error) {
      // 初次 launch 仍向入口传播错误，但不能留下已经注册的父进程监听器。
      detachSignalListeners();
      stopped = true;
      throw error;
    }
  }

  async function launchChild(): Promise<void> {
    if (stopped || shutdownRequested) {
      return;
    }
    const child = await options.launch();
    if (stopped || shutdownRequested) {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
      options.removeForegroundPid();
      return;
    }

    activeChild = child;
    installSignalListeners();
    watchChild(child);
  }

  function watchChild(child: GatewaySupervisorChild): void {
    let settled = false;
    const settle = (terminal: ChildTerminal) => {
      if (settled || activeChild !== child) {
        return;
      }
      settled = true;
      activeChild = undefined;
      options.removeForegroundPid();

      if (stopped) {
        return;
      }
      if (terminal.kind === "exit" && terminal.code === restartExitCode && !shutdownRequested) {
        scheduleRestart();
        return;
      }
      if (terminal.kind === "error") {
        logger.error(`[${options.label}] Failed to start gateway: ${formatError(terminal.error)}`);
        finish(1, true);
        return;
      }

      const reason = terminal.signal ? `signal ${terminal.signal}` : `exit code ${terminal.code ?? 1}`;
      logger.log(`[${options.label}] Gateway exited (${reason}).`);
      finish(terminal.code ?? 1, true);
    };

    child.once("error", (error) => settle({ kind: "error", error }));
    child.once("exit", (code, signal) => settle({ kind: "exit", code, signal }));
  }

  function scheduleRestart(): void {
    if (restartTimer || stopped || shutdownRequested) {
      return;
    }
    logger.log(`[${options.label}] Gateway requested restart, restarting in ${restartDelayMs}ms...`);
    restartTimer = setTimeout(() => {
      restartTimer = undefined;
      if (stopped || shutdownRequested) {
        return;
      }
      void launchChild().catch((error) => {
        if (stopped || shutdownRequested) {
          return;
        }
        logger.error(`[${options.label}] Failed to restart gateway: ${formatError(error)}`);
        finish(1);
      });
    }, restartDelayMs);
  }

  function forwardSignal(signal: GatewaySupervisorSignal): void {
    if (stopped || shutdownRequested) {
      return;
    }
    shutdownRequested = true;
    clearRestartTimer();
    detachSignalListeners();

    const child = activeChild;
    if (!child) {
      finish(0);
      return;
    }
    if (!child.killed) {
      child.kill(signal);
    }
  }

  function finish(exitCode: number, foregroundPidAlreadyRemoved = false): void {
    if (stopped) {
      return;
    }
    stopped = true;
    activeChild = undefined;
    clearRestartTimer();
    detachSignalListeners();
    if (!foregroundPidAlreadyRemoved) {
      options.removeForegroundPid();
    }
    options.onExit(exitCode);
  }

  function installSignalListeners(): void {
    if (signalListenersInstalled) {
      return;
    }
    options.signalTarget.on("SIGINT", signalHandlers.SIGINT);
    options.signalTarget.on("SIGTERM", signalHandlers.SIGTERM);
    signalListenersInstalled = true;
  }

  function detachSignalListeners(): void {
    if (!signalListenersInstalled) {
      return;
    }
    options.signalTarget.off("SIGINT", signalHandlers.SIGINT);
    options.signalTarget.off("SIGTERM", signalHandlers.SIGTERM);
    signalListenersInstalled = false;
  }

  function clearRestartTimer(): void {
    if (!restartTimer) {
      return;
    }
    clearTimeout(restartTimer);
    restartTimer = undefined;
  }

  return { start };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
