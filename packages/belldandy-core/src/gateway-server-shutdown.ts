import type { Server } from "node:http";
import type { Socket } from "node:net";

import type { GatewayResFrame } from "@belldandy/protocol";

import type {
  GatewayShutdownCoordinator,
  GatewayShutdownResult,
} from "./gateway-shutdown-coordinator.js";

const GATEWAY_SHUTTING_DOWN_ERROR = {
  code: "gateway_shutting_down",
  message: "Gateway is shutting down.",
} as const;

export type GatewayServerIntakeGate = {
  stop: () => void;
  isAccepting: () => boolean;
  getHttpRejection: () => {
    statusCode: 503;
    body: {
      ok: false;
      error: typeof GATEWAY_SHUTTING_DOWN_ERROR;
    };
  } | null;
  getGatewayRejection: (requestId: string) => GatewayResFrame | null;
};

export type GatewayServerShutdownResources = {
  stopIntake: () => void;
  abortActiveRuns?: () => void | Promise<void>;
  drainActiveRuns?: (signal: AbortSignal) => void | Promise<void>;
  disposeTopLevelConversations?: () => void | Promise<void>;
  closeDurableExtraction?: () => void | Promise<void>;
  flushConversationState?: () => void | Promise<void>;
  flushSubTaskState?: () => void | Promise<void>;
  flushMemoryUsage?: () => void | Promise<void>;
  drainTokenUsage?: (signal: AbortSignal) => void | Promise<void>;
  detachRuntimeHooks?: () => void | Promise<void>;
  closeTransport: () => void | Promise<void>;
};

type GatewayTransportCloserOptions = {
  server: Pick<Server, "close"> & Partial<Pick<Server, "closeIdleConnections" | "closeAllConnections">>;
  trackedSockets: Set<Socket>;
  closeWebSockets?: () => Promise<void>;
  forceCloseAfterMs?: number;
};

export class GatewayServerCloseError extends Error {
  readonly result: GatewayShutdownResult;

  constructor(result: GatewayShutdownResult) {
    const suffix = result.failures.length === 1 ? "failure" : "failures";
    super(`Gateway shutdown failed (${result.failures.length} step ${suffix}).`);
    this.name = "GatewayServerCloseError";
    this.result = result;
  }
}

export function createGatewayServerIntakeGate(): GatewayServerIntakeGate {
  let accepting = true;
  return {
    stop: () => {
      accepting = false;
    },
    isAccepting: () => accepting,
    getHttpRejection: () => accepting
      ? null
      : {
          statusCode: 503,
          body: {
            ok: false,
            error: GATEWAY_SHUTTING_DOWN_ERROR,
          },
        },
    getGatewayRejection: (requestId) => accepting
      ? null
      : {
          type: "res",
          id: requestId,
          ok: false,
          error: GATEWAY_SHUTTING_DOWN_ERROR,
        },
  };
}

/**
 * Gateway Core 只在这里声明阶段归属；资源内部的 abort、drain 与 flush 语义仍由各自 owner 实现。
 */
export function registerGatewayServerShutdownResources(
  coordinator: Pick<GatewayShutdownCoordinator, "register">,
  resources: GatewayServerShutdownResources,
): void {
  coordinator.register({
    id: "gateway-intake",
    phase: "stop_intake",
    run: resources.stopIntake,
  });
  if (resources.abortActiveRuns) {
    coordinator.register({
      id: "conversation-runs-abort",
      phase: "abort_active",
      run: resources.abortActiveRuns,
    });
  }
  if (resources.drainActiveRuns) {
    coordinator.register({
      id: "conversation-runs-drain",
      phase: "drain",
      run: ({ signal }) => resources.drainActiveRuns!(signal),
    });
  }
  if (resources.disposeTopLevelConversations) {
    coordinator.register({
      id: "top-level-conversations",
      phase: "drain",
      run: resources.disposeTopLevelConversations,
    });
  }
  if (resources.closeDurableExtraction) {
    coordinator.register({
      id: "durable-extraction",
      phase: "drain",
      run: resources.closeDurableExtraction,
    });
  }
  if (resources.flushConversationState) {
    coordinator.register({
      id: "conversation-state",
      phase: "flush_state",
      run: resources.flushConversationState,
    });
  }
  if (resources.flushSubTaskState) {
    coordinator.register({
      id: "subtask-state",
      phase: "flush_state",
      run: resources.flushSubTaskState,
    });
  }
  if (resources.flushMemoryUsage) {
    coordinator.register({
      id: "memory-usage",
      phase: "flush_state",
      run: resources.flushMemoryUsage,
    });
  }
  if (resources.drainTokenUsage) {
    coordinator.register({
      id: "token-usage-upload",
      phase: "close_transport",
      run: ({ signal }) => resources.drainTokenUsage!(signal),
    });
  }
  if (resources.detachRuntimeHooks) {
    coordinator.register({
      id: "gateway-runtime-hooks",
      phase: "close_transport",
      run: resources.detachRuntimeHooks,
    });
  }
  coordinator.register({
    id: "gateway-transport",
    phase: "close_transport",
    run: resources.closeTransport,
  });
}

/**
 * HTTP close 与 WebSocket close 同时启动；短预算后强制销毁残留 socket，避免活跃 WS 永久卡住 server.close()。
 */
export function createGatewayTransportCloser(options: GatewayTransportCloserOptions): () => Promise<void> {
  let closePromise: Promise<void> | undefined;
  return () => {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      const forceCloseAfterMs = Number.isFinite(options.forceCloseAfterMs) && Number(options.forceCloseAfterMs) >= 0
        ? Math.floor(Number(options.forceCloseAfterMs))
        : 200;
      const closeHttpServer = new Promise<void>((resolve, reject) => {
        const forceCloseTimer = setTimeout(() => {
          options.server.closeIdleConnections?.();
          options.server.closeAllConnections?.();
          for (const socket of options.trackedSockets) {
            if (!socket.destroyed) socket.destroy();
          }
        }, forceCloseAfterMs);
        forceCloseTimer.unref?.();

        try {
          options.server.close((error) => {
            clearTimeout(forceCloseTimer);
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
          options.server.closeIdleConnections?.();
        } catch (error) {
          clearTimeout(forceCloseTimer);
          reject(error);
        }
      });
      const results = await Promise.allSettled([
        options.closeWebSockets?.() ?? Promise.resolve(),
        closeHttpServer,
      ]);
      const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failure) throw failure.reason;
    })();
    return closePromise;
  };
}

export function throwOnGatewayServerShutdownFailure(result: GatewayShutdownResult): void {
  if (result.outcome !== "completed") {
    throw new GatewayServerCloseError(result);
  }
}
