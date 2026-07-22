import {
  FailoverAttemptError,
  type FailoverAttempt,
  type FailoverClient,
  type FailoverExecutionSummary,
  type FailoverReason,
  type ModelProfile,
} from "./failover-client.js";
import {
  ModelResponseStreamError,
  readModelResponseStream,
  type ModelResponseProtocol,
  type ModelResponseStreamOptions,
  type ModelResponseStreamResult,
  type ModelResponseWireApi,
} from "./model-response-stream.js";
import type { AgentInterrupted } from "./index.js";

export type ModelResponseStreamCommitControl = {
  commit: () => void;
  isCommitted: () => boolean;
};

export type ConsumeModelResponseStreamWithFailoverOptions = {
  failoverClient: FailoverClient;
  buildRequest: (profile: ModelProfile) => { url: string; init: RequestInit };
  resolveProtocol: (profile: ModelProfile) => {
    protocol: ModelResponseProtocol;
    wireApi: ModelResponseWireApi;
  };
  onTextDelta: (
    delta: string,
    control: ModelResponseStreamCommitControl,
    profile: ModelProfile,
  ) => void | Promise<void>;
  onAttemptStart?: (profile: ModelProfile) => void | Promise<void>;
  signal?: AbortSignal;
  timeoutMs?: number;
  minimumTimeoutMs?: number;
  maxRetries?: number;
  retryBackoffMs?: number;
  onSummary?: (summary: FailoverExecutionSummary) => void;
  streamLimits?: Pick<
    ModelResponseStreamOptions,
    "maxEventBytes" | "maxResponseBytes" | "maxToolArgumentBytes" | "maxToolCalls"
  >;
};

export type ModelResponseStreamFailoverResult = {
  response: ModelResponseStreamResult;
  transportResponse: Response;
  profile: ModelProfile;
  attempts: FailoverAttempt[];
  summary: FailoverExecutionSummary;
};

export async function consumeModelResponseStreamWithFailover(
  options: ConsumeModelResponseStreamWithFailoverOptions,
): Promise<ModelResponseStreamFailoverResult> {
  const result = await options.failoverClient.executeWithFailover({
    buildRequest: options.buildRequest,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    minimumTimeoutMs: options.minimumTimeoutMs,
    maxRetries: options.maxRetries,
    retryBackoffMs: options.retryBackoffMs,
    onSummary: options.onSummary,
    consumeResponse: async ({ response, profile, signal }) => {
      const body = response.body;
      if (!body) {
        throw new FailoverAttemptError({
          message: "Model stream response body is empty.",
          reason: "unknown",
          committed: false,
        });
      }

      await options.onAttemptStart?.(profile);
      let committed = false;
      let completed: ModelResponseStreamResult | undefined;
      const control: ModelResponseStreamCommitControl = {
        commit: () => {
          committed = true;
        },
        isCommitted: () => committed,
      };
      const protocol = options.resolveProtocol(profile);

      try {
        for await (const item of readModelResponseStream(body, {
          ...protocol,
          ...options.streamLimits,
          signal,
        })) {
          if (item.type === "text_delta") {
            await options.onTextDelta(item.delta, control, profile);
            continue;
          }
          if (item.type === "tool_call_delta") {
            committed = true;
            continue;
          }
          if (item.type === "completed") completed = item.response;
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        if (error instanceof FailoverAttemptError) throw error;
        throw new FailoverAttemptError({
          message: error instanceof Error ? error.message : String(error),
          reason: classifyStreamFailure(error),
          committed,
          code: error instanceof ModelResponseStreamError ? error.code : undefined,
        });
      }

      if (!completed) {
        throw new FailoverAttemptError({
          message: "Model stream completed without an assembled response.",
          reason: "unknown",
          committed,
          code: "incomplete_stream",
        });
      }
      return completed;
    },
  });

  if (!result.value) {
    const lastAttempt = result.attempts.at(-1);
    const summaryReason = result.summary.finalReason === "aborted"
      ? undefined
      : result.summary.finalReason;
    const error = new FailoverAttemptError({
      message: lastAttempt?.error ?? `Model request failed with HTTP ${result.response.status}.`,
      reason: lastAttempt?.reason ?? summaryReason ?? "unknown",
      committed: false,
    });
    error.summary = result.summary;
    error.attempts = result.attempts.map((item) => ({ ...item }));
    throw error;
  }

  return {
    response: result.value,
    transportResponse: result.response,
    profile: result.profile,
    attempts: result.attempts,
    summary: result.summary,
  };
}

export function toAgentInterrupted(error: FailoverAttemptError): AgentInterrupted {
  return {
    type: "interrupted",
    reason: error.reason === "timeout"
      ? "provider_stream_timeout"
      : error.reason === "format"
        ? "provider_stream_protocol"
        : "provider_stream_error",
    error: error.message,
    committed: error.committed,
    ...(error.code ? { code: error.code } : {}),
  };
}

function classifyStreamFailure(error: unknown): FailoverReason {
  if (!(error instanceof ModelResponseStreamError)) return "unknown";
  switch (error.code) {
    case "invalid_utf8":
    case "event_too_large":
    case "invalid_event_json":
    case "response_too_large":
    case "too_many_tool_calls":
    case "tool_arguments_too_large":
    case "invalid_tool_call":
      return "format";
    case "provider_error":
    case "incomplete_stream":
      return "unknown";
    case "aborted":
      return "timeout";
  }
}
