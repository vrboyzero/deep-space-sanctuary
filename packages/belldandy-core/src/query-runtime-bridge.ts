import type { GatewayResFrame } from "@belldandy/protocol";
import {
  listBridgeSessionRuntimeViews,
  peekBridgeSessionRuntimeView,
  type BridgeSessionRuntimeView,
} from "@belldandy/skills";

import { QueryRuntime, type QueryRuntimeObserver } from "./query-runtime.js";

type BridgeQueryRuntimeMethod =
  | "bridge.session.list"
  | "bridge.session.peek";

export type QueryRuntimeBridgeContext = {
  requestId: string;
  stateDir: string;
  runtimeObserver?: QueryRuntimeObserver<BridgeQueryRuntimeMethod>;
};

function filterBridgeSessionViews(
  sessions: BridgeSessionRuntimeView[],
  params: {
    status?: "active" | "closed";
    targetId?: string;
    taskId?: string;
  },
): BridgeSessionRuntimeView[] {
  return sessions.filter((item) => {
    if (params.status && item.status !== params.status) {
      return false;
    }
    if (params.targetId && item.targetId !== params.targetId) {
      return false;
    }
    if (params.taskId && item.taskId !== params.taskId) {
      return false;
    }
    return true;
  });
}

export async function handleBridgeSessionListWithQueryRuntime(
  ctx: QueryRuntimeBridgeContext,
  params: {
    status?: "active" | "closed";
    targetId?: string;
    taskId?: string;
  },
): Promise<GatewayResFrame> {
  const runtime = new QueryRuntime({
    method: "bridge.session.list" as const,
    traceId: ctx.requestId,
    observer: ctx.runtimeObserver,
  });

  return runtime.run(async (queryRuntime) => {
    queryRuntime.mark("request_validated", {
      detail: {
        ...(params.status ? { status: params.status } : {}),
        ...(params.targetId ? { targetId: params.targetId } : {}),
        ...(params.taskId ? { taskId: params.taskId } : {}),
      },
    });

    const summary = await listBridgeSessionRuntimeViews(ctx.stateDir);
    const items = filterBridgeSessionViews(summary.sessions, params);

    queryRuntime.mark("completed", {
      detail: {
        totalCount: summary.sessions.length,
        filteredCount: items.length,
        activeCount: summary.activeCount,
        closedCount: summary.closedCount,
      },
    });

    return {
      type: "res",
      id: ctx.requestId,
      ok: true,
      payload: {
        items,
        totalCount: summary.sessions.length,
        activeCount: summary.activeCount,
        closedCount: summary.closedCount,
        filters: {
          status: params.status ?? null,
          targetId: params.targetId ?? null,
          taskId: params.taskId ?? null,
        },
      },
    };
  });
}

export async function handleBridgeSessionPeekWithQueryRuntime(
  ctx: QueryRuntimeBridgeContext,
  params: {
    sessionId: string;
    transcriptLimit?: number;
  },
): Promise<GatewayResFrame> {
  const runtime = new QueryRuntime({
    method: "bridge.session.peek" as const,
    traceId: ctx.requestId,
    observer: ctx.runtimeObserver,
  });

  return runtime.run(async (queryRuntime) => {
    queryRuntime.mark("request_validated", {
      detail: {
        sessionId: params.sessionId,
        ...(typeof params.transcriptLimit === "number" ? { transcriptLimit: params.transcriptLimit } : {}),
      },
    });

    const payload = await peekBridgeSessionRuntimeView(ctx.stateDir, params.sessionId, {
      transcriptLimit: params.transcriptLimit,
    });
    if (!payload) {
      queryRuntime.mark("completed", {
        detail: {
          sessionId: params.sessionId,
          code: "not_found",
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: "not_found", message: `Bridge session not found: ${params.sessionId}` },
      };
    }

    queryRuntime.mark("completed", {
      detail: {
        sessionId: params.sessionId,
        transcriptEventCount: payload.transcriptEventCount,
        bufferedOutputChars: payload.session.bufferedOutputChars,
        status: payload.session.status,
      },
    });

    return {
      type: "res",
      id: ctx.requestId,
      ok: true,
      payload,
    };
  });
}
