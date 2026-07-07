import {
  readPersistentCompressionReference,
  type PersistentCompressionReferenceReadResult,
} from "@belldandy/agent";
import type { GatewayResFrame } from "@belldandy/protocol";

import { QueryRuntime, type QueryRuntimeObserver } from "./query-runtime.js";

export type QueryRuntimeToolReferenceRetrieveContext = {
  requestId: string;
  stateDir: string;
  runtimeObserver?: QueryRuntimeObserver<"conversation.tool_result_reference.retrieve">;
};

export async function handleConversationToolResultReferenceRetrieveWithQueryRuntime(
  ctx: QueryRuntimeToolReferenceRetrieveContext,
  params: {
    conversationId: string;
    runId?: string;
    refId: string;
  },
): Promise<GatewayResFrame> {
  const runtime = new QueryRuntime({
    method: "conversation.tool_result_reference.retrieve" as const,
    traceId: ctx.requestId,
    observer: ctx.runtimeObserver,
  });

  return runtime.run(async (queryRuntime) => {
    queryRuntime.mark("request_validated", {
      conversationId: params.conversationId,
      detail: {
        refId: params.refId,
        ...(params.runId ? { runId: params.runId } : {}),
      },
    });

    try {
      const result = readPersistentCompressionReference({
        stateDir: ctx.stateDir,
        conversationId: params.conversationId,
        runId: params.runId,
        refId: params.refId,
      });
      queryRuntime.mark("tool_reference_loaded", {
        conversationId: params.conversationId,
        detail: buildToolReferenceTraceDetail(result, params.refId, params.runId),
      });
      queryRuntime.mark("completed", { conversationId: params.conversationId });
      return {
        type: "res",
        id: ctx.requestId,
        ok: true,
        payload: {
          refId: params.refId,
          status: result.record.status,
          metadata: result.record.metadata,
          content: result.content,
          chars: result.content.length,
        },
      };
    } catch (error) {
      const code = normalizeToolReferenceErrorCode(error);
      queryRuntime.mark("completed", {
        conversationId: params.conversationId,
        detail: {
          code,
          refId: params.refId,
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: {
          code,
          message: buildToolReferenceErrorMessage(code),
        },
      };
    }
  });
}

function buildToolReferenceTraceDetail(
  result: PersistentCompressionReferenceReadResult,
  refId: string,
  runId?: string,
): Record<string, unknown> {
  return {
    refId,
    status: result.record.status,
    chars: result.content.length,
    sourceName: result.record.metadata.sourceName,
    ...(runId ? { runId } : {}),
  };
}

function normalizeToolReferenceErrorCode(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === "invalid_ref_id") return "invalid_ref_id";
    if (error.message === "reference_conversation_mismatch") return "reference_conversation_mismatch";
    if (error.message === "reference_run_mismatch") return "reference_run_mismatch";
    if (error.message === "reference_metadata_mismatch") return "reference_metadata_mismatch";
  }
  if (typeof error === "object" && error && "code" in error && (error as { code?: unknown }).code === "ENOENT") {
    return "not_found";
  }
  return "tool_reference_read_failed";
}

function buildToolReferenceErrorMessage(code: string): string {
  if (code === "invalid_ref_id") return "refId is invalid.";
  if (code === "not_found") return "Tool result reference was not found.";
  if (code === "reference_conversation_mismatch") return "Tool result reference conversationId does not match the request.";
  if (code === "reference_run_mismatch") return "Tool result reference runId does not match the request.";
  if (code === "reference_metadata_mismatch") return "Tool result reference metadata is invalid.";
  return "Failed to read tool result reference.";
}
