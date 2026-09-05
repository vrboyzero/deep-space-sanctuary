import type { GatewayEventFrame } from "@belldandy/protocol";

import type {
  GatewayShutdownRequest,
  GatewayShutdownRequestKind,
  GatewayShutdownResult,
} from "./gateway-shutdown-coordinator.js";

export type GatewayShutdownSignal = "SIGINT" | "SIGTERM";

export type GatewayShutdownSignalTarget = {
  on: (signal: GatewayShutdownSignal, listener: () => void) => unknown;
  off: (signal: GatewayShutdownSignal, listener: () => void) => unknown;
};

type GatewayShutdownParentTarget = {
  connected?: boolean;
  on: (event: "message", listener: (message: unknown) => void) => unknown;
  off: (event: "message", listener: (message: unknown) => void) => unknown;
};

export type GatewayShutdownRequestOwnerSnapshot = {
  state: "idle" | "countdown" | "shutting_down" | "completed";
  requestKind: GatewayShutdownRequestKind | null;
  exitCode: number | null;
  requestCount: number;
  ignoredRequestCount: number;
  signalHandlersInstalled: boolean;
};

type GatewayShutdownRequestOwnerOptions = {
  requestShutdown: (request: GatewayShutdownRequest) => Promise<GatewayShutdownResult>;
  broadcast?: (frame: GatewayEventFrame) => void;
  exit?: (exitCode: number) => void;
  scheduleTimeout?: typeof setTimeout;
  cancelTimeout?: typeof clearTimeout;
};

type RestartRequestOptions = {
  countdownSeconds?: number;
  graceMs?: number;
  broadcast?: boolean;
};

type OwnedShutdownRequest = {
  request: GatewayShutdownRequest;
  reason: string;
  countdownSeconds: number;
  graceMs: number;
  broadcastMode: "countdown" | "status" | "none";
};

export type GatewayShutdownRequestOwner = {
  requestSignal: (signal: GatewayShutdownSignal) => Promise<GatewayShutdownResult>;
  requestConfigRestart: (fileName: string) => Promise<GatewayShutdownResult>;
  requestSystemRestart: (reason: string, options?: RestartRequestOptions) => Promise<GatewayShutdownResult>;
  installSignalHandlers: (target?: GatewayShutdownSignalTarget) => void;
  installParentShutdownHandler: (target?: GatewayShutdownParentTarget) => void;
  close: () => void;
  getRuntimeSnapshot: () => GatewayShutdownRequestOwnerSnapshot;
};

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function normalizeReason(value: string, fallback: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || fallback;
}

/**
 * 运行态关闭入口只在这里竞争首个请求。倒计时结束后才调用 Core coordinator，确保 RPC/tool
 * 结果和最后一帧 restarting 事件有机会先完成发送。
 */
export function createGatewayShutdownRequestOwner(
  options: GatewayShutdownRequestOwnerOptions,
): GatewayShutdownRequestOwner {
  const scheduleTimeout = options.scheduleTimeout ?? setTimeout;
  const cancelTimeout = options.cancelTimeout ?? clearTimeout;
  const exit = options.exit ?? ((exitCode: number) => process.exit(exitCode));
  let state: GatewayShutdownRequestOwnerSnapshot["state"] = "idle";
  let requestKind: GatewayShutdownRequestKind | null = null;
  let exitCode: number | null = null;
  let requestCount = 0;
  let ignoredRequestCount = 0;
  let completion: Promise<GatewayShutdownResult> | undefined;
  let signalTarget: GatewayShutdownSignalTarget | undefined;
  let signalHandlersInstalled = false;
  let parentTarget: GatewayShutdownParentTarget | undefined;
  const parentShutdownHandler = (message: unknown): void => {
    if (!message || typeof message !== "object" || Array.isArray(message)
      || Object.keys(message).length !== 1 || !("type" in message)
      || message.type !== "gateway.shutdown/v1") return;
    void requestSignal("SIGTERM").catch(() => undefined);
  };
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  const signalHandlers: Record<GatewayShutdownSignal, () => void> = {
    SIGINT: () => {
      void requestSignal("SIGINT").catch(() => undefined);
    },
    SIGTERM: () => {
      void requestSignal("SIGTERM").catch(() => undefined);
    },
  };

  function requestSignal(signal: GatewayShutdownSignal): Promise<GatewayShutdownResult> {
    return begin({
      request: { kind: "signal", exitCode: 0 },
      reason: signal,
      countdownSeconds: 0,
      graceMs: 0,
      broadcastMode: "none",
    });
  }

  function requestConfigRestart(fileName: string): Promise<GatewayShutdownResult> {
    const normalizedFileName = normalizeReason(fileName, "configuration");
    return begin({
      request: { kind: "config_restart", exitCode: 100 },
      reason: `${normalizedFileName} changed`,
      countdownSeconds: 0,
      graceMs: 300,
      broadcastMode: "status",
    });
  }

  function requestSystemRestart(
    reason: string,
    requestOptions: RestartRequestOptions = {},
  ): Promise<GatewayShutdownResult> {
    const countdownSeconds = normalizeNonNegativeInteger(requestOptions.countdownSeconds, 3);
    return begin({
      request: { kind: "system_restart", exitCode: 100 },
      reason: normalizeReason(reason, "system restart requested"),
      countdownSeconds,
      graceMs: normalizeNonNegativeInteger(requestOptions.graceMs, 300),
      broadcastMode: requestOptions.broadcast === false
        ? "none"
        : countdownSeconds > 0
          ? "countdown"
          : "status",
    });
  }

  function begin(input: OwnedShutdownRequest): Promise<GatewayShutdownResult> {
    requestCount += 1;
    if (completion) {
      ignoredRequestCount += 1;
      return completion;
    }
    requestKind = input.request.kind;
    exitCode = input.request.exitCode;
    detachSignalHandlers();
    detachParentShutdownHandler();
    completion = execute(input);
    return completion;
  }

  async function execute(input: OwnedShutdownRequest): Promise<GatewayShutdownResult> {
    state = input.countdownSeconds > 0 || input.graceMs > 0 ? "countdown" : "shutting_down";
    if (input.broadcastMode === "countdown") {
      for (let countdown = input.countdownSeconds; countdown >= 1; countdown -= 1) {
        broadcastRestart(input.reason, countdown);
        await delay(1_000);
      }
      broadcastRestart(input.reason, 0);
    } else if (input.broadcastMode === "status") {
      options.broadcast?.({
        type: "event",
        event: "agent.status",
        payload: { status: "restarting", reason: input.reason },
      });
    }
    if (input.graceMs > 0) await delay(input.graceMs);

    state = "shutting_down";
    try {
      const result = await options.requestShutdown(input.request);
      state = "completed";
      exit(result.request.exitCode);
      return result;
    } catch (error) {
      state = "completed";
      exit(input.request.exitCode);
      throw error;
    }
  }

  function broadcastRestart(reason: string, countdown: number): void {
    options.broadcast?.({
      type: "event",
      event: "agent.status",
      payload: { status: "restarting", reason, countdown },
    });
  }

  function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = scheduleTimeout(() => {
        pendingTimers.delete(timer);
        resolve();
      }, milliseconds);
      timer.unref?.();
      pendingTimers.add(timer);
    });
  }

  function installSignalHandlers(target: GatewayShutdownSignalTarget = process): void {
    if (signalHandlersInstalled) return;
    signalTarget = target;
    target.on("SIGINT", signalHandlers.SIGINT);
    target.on("SIGTERM", signalHandlers.SIGTERM);
    signalHandlersInstalled = true;
  }

  function detachSignalHandlers(): void {
    if (!signalHandlersInstalled || !signalTarget) return;
    signalTarget.off("SIGINT", signalHandlers.SIGINT);
    signalTarget.off("SIGTERM", signalHandlers.SIGTERM);
    signalHandlersInstalled = false;
    signalTarget = undefined;
  }

  function installParentShutdownHandler(target: GatewayShutdownParentTarget = process): void {
    if (parentTarget || !target.connected || completion) return;
    // Windows 的进程信号不能保证运行 JS 清理；父进程 IPC 复用同一关闭协调器。
    parentTarget = target;
    target.on("message", parentShutdownHandler);
  }

  function detachParentShutdownHandler(): void {
    parentTarget?.off("message", parentShutdownHandler);
    parentTarget = undefined;
  }

  function close(): void {
    detachSignalHandlers();
    detachParentShutdownHandler();
    if (!completion) {
      for (const timer of pendingTimers) cancelTimeout(timer);
      pendingTimers.clear();
    }
  }

  return {
    requestSignal,
    requestConfigRestart,
    requestSystemRestart,
    installSignalHandlers,
    installParentShutdownHandler,
    close,
    getRuntimeSnapshot: () => ({
      state,
      requestKind,
      exitCode,
      requestCount,
      ignoredRequestCount,
      signalHandlersInstalled,
    }),
  };
}
