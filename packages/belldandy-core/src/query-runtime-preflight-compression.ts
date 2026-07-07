import type { GatewayResFrame } from "@belldandy/protocol";

import { readPreflightCompressionSidecar } from "./preflight-compression-sidecar.js";
import { QueryRuntime, type QueryRuntimeObserver } from "./query-runtime.js";

export type QueryRuntimePreflightCompressionRetrieveContext = {
  requestId: string;
  stateDir: string;
  runtimeObserver?: QueryRuntimeObserver<"conversation.preflight_compression.retrieve">;
};

export async function handleConversationPreflightCompressionRetrieveWithQueryRuntime(
  ctx: QueryRuntimePreflightCompressionRetrieveContext,
  params: {
    conversationId: string;
    runId?: string;
    sourceRef: string;
  },
): Promise<GatewayResFrame> {
  const runtime = new QueryRuntime({
    method: "conversation.preflight_compression.retrieve" as const,
    traceId: ctx.requestId,
    observer: ctx.runtimeObserver,
  });

  return runtime.run(async (queryRuntime) => {
    queryRuntime.mark("request_validated", {
      conversationId: params.conversationId,
      detail: {
        sourceRef: params.sourceRef,
        ...(params.runId ? { runId: params.runId } : {}),
      },
    });

    try {
      const result = await readPreflightCompressionSidecar({
        stateDir: ctx.stateDir,
        conversationId: params.conversationId,
        runId: params.runId,
        sourceRef: params.sourceRef,
      });

      queryRuntime.mark("preflight_sidecar_loaded", {
        conversationId: params.conversationId,
        detail: {
          sourceRef: params.sourceRef,
          originalChars: result.sidecar.originalChars,
          compressedChars: result.sidecar.compressedChars,
          ...(params.runId ? { runId: params.runId } : {}),
        },
      });
      queryRuntime.mark("completed", { conversationId: params.conversationId });

      return {
        type: "res",
        id: ctx.requestId,
        ok: true,
        payload: {
          sidecar: result.sidecar,
          originalText: result.originalText,
          originalChars: result.originalText.length,
        },
      };
    } catch (error) {
      queryRuntime.mark("completed", {
        conversationId: params.conversationId,
        detail: {
          code: normalizeRetrieveErrorCode(error),
          sourceRef: params.sourceRef,
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: {
          code: normalizeRetrieveErrorCode(error),
          message: buildRetrieveErrorMessage(error),
        },
      };
    }
  });
}

function normalizeRetrieveErrorCode(error: unknown): string {
  if (error instanceof Error && error.message === "invalid_source_ref") return "invalid_source_ref";
  if (error instanceof Error && error.message === "invalid_sidecar_metadata") return "invalid_sidecar_metadata";
  if (error instanceof Error && error.message === "sidecar_run_mismatch") return "sidecar_run_mismatch";
  if (typeof error === "object" && error && "code" in error && (error as { code?: unknown }).code === "ENOENT") {
    return "not_found";
  }
  return "preflight_sidecar_read_failed";
}

function buildRetrieveErrorMessage(error: unknown): string {
  const code = normalizeRetrieveErrorCode(error);
  if (code === "not_found") return "Preflight compression sidecar was not found.";
  if (code === "invalid_source_ref") return "sourceRef is invalid.";
  if (code === "sidecar_run_mismatch") return "Preflight compression sidecar runId does not match the request.";
  if (code === "invalid_sidecar_metadata") return "Preflight compression sidecar metadata is invalid.";
  return "Failed to read preflight compression sidecar.";
}
