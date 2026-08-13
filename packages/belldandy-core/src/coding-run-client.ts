import {
  CodingRunClient as InternalCodingRunClient,
  CodingRunClientRequestError as InternalCodingRunClientRequestError,
} from "./coding-run/stdio.js";

export const CODING_RUN_PROTOCOL_VERSION = "v1" as const;

export type CodingRunClientRequestErrorCode =
  | "invalid_request"
  | "not_found"
  | "run_mismatch"
  | "not_active"
  | "permission_required"
  | "permission_denied"
  | "policy_denied"
  | "budget_exhausted"
  | "cancelled"
  | "interrupted"
  | "output_schema_invalid"
  | "gateway_unavailable"
  | "invalid_limit"
  | "cursor_stale"
  | "cursor_future"
  | "cursor_out_of_range"
  | "internal"
  | "cursor_expired"
  | "request_timeout"
  | "request_aborted"
  | "client_closed"
  | "backpressure"
  | "transport_error";

export class CodingRunClientRequestError extends Error {
  constructor(
    readonly code: CodingRunClientRequestErrorCode,
    message: string,
  ) {
    super(toSafeClientErrorMessage(message));
    this.name = "CodingRunClientRequestError";
  }
}

function toSafeClientErrorMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value ?? "Unknown coding run error.");
  return message
    .replace(
      /\b((?:api[_-]?key|access[_-]?token|token|secret|password|authorization|cookie|session)[\w-]*)\s*([:=])\s*(?:Bearer\s+)?[^\s,;]+/gi,
      "$1$2[REDACTED]",
    )
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 512) || "Unknown coding run error.";
}

export type CodingRunClientEvent = {
  version: typeof CODING_RUN_PROTOCOL_VERSION;
  seq: number;
  timestampMs: number;
  source: "conversation" | "goal" | "workflow" | "subtask";
  binding: {
    agentRunId: string;
    conversationId?: string;
    goal?: { goalId: string; nodeId?: string };
    workflow?: { journalId: string; workflowRunId?: string };
    subtask?: { taskId: string };
    worktreeId?: string;
    workspaceCheckpoint?: {
      workspaceCheckpointId: string;
      recoveryGuarantee: "exact" | "managed_worktree" | "detect_only";
    };
  };
  type:
    | "run.started"
    | "run.status"
    | "message.delta"
    | "tool.started"
    | "tool.completed"
    | "permission.requested"
    | "run.usage"
    | "run.budget_exhausted"
    | "run.cancelled"
    | "run.interrupted"
    | "run.completed"
    | "run.failed";
  payload: Record<string, unknown>;
};

export type CodingRunSubscriptionErrorFrame = {
  code: CodingRunClientRequestErrorCode;
  message: string;
  binding: CodingRunClientBinding;
};

export type CodingRunClientOptions = {
  write: (line: string) => void | Promise<void>;
  onEvent?: (event: CodingRunClientEvent) => void;
  onSubscriptionError?: (error: CodingRunSubscriptionErrorFrame) => void;
  onProtocolError?: (error: { code: "invalid_frame" | "frame_too_large"; message: string }) => void;
  createRequestId?: () => string;
  maxFrameBytes?: number;
  maxPendingRequests?: number;
  requestTimeoutMs?: number;
};

export type CodingRunClientRequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type CodingRunClientStartInput = {
  prompt: string;
  cwd: string;
  conversationId?: string;
};

export type CodingRunClientBinding = {
  conversationId: string;
  agentRunId: string;
};

export type CodingRunClientSubscribeInput = CodingRunClientBinding & {
  cursor?: number;
};

export type CodingRunClientPermissionInput = {
  agentRunId: string;
  worktreeId?: string;
  toolCallId: string;
  decision: "allow" | "deny";
};

export type CodingRunClientSteerInput = CodingRunClientBinding & {
  prompt: string;
  idempotencyKey: string;
};

export type CodingRunClientCancelInput = CodingRunClientBinding & {
  reason?: string;
};

export type CodingRunClientArtifactInput = {
  agentRunId: string;
  workspaceId?: string;
};

export type CodingRunClientProjectionCursor = {
  epoch: string;
  revision: number;
  offset: number;
};

export type CodingRunClientProjectionInput = {
  limit?: number;
  cursor?: CodingRunClientProjectionCursor;
};

export type CodingRunClientProjectionPage = {
  revision: number;
  epoch: string;
  totalCount: number;
  items: unknown[];
  nextCursor?: CodingRunClientProjectionCursor;
};

/**
 * Narrow consumer wrapper. Transport and protocol parsing remain owned by the internal NDJSON client,
 * while this module keeps the package declaration boundary independent from Core domain types.
 */
export class CodingRunClient {
  readonly #client: InternalCodingRunClient;

  constructor(options: CodingRunClientOptions) {
    this.#client = new InternalCodingRunClient({
      ...options,
      ...(options.onSubscriptionError
        ? { onSubscriptionError: (error) => options.onSubscriptionError?.({
          code: error.code,
          message: toSafeClientErrorMessage(error.message),
          binding: error.binding,
        }) }
        : {}),
      ...(options.onProtocolError
        ? { onProtocolError: (error) => options.onProtocolError?.({
          code: error.code,
          message: toSafeClientErrorMessage(error.message),
        }) }
        : {}),
    });
  }

  start(input: CodingRunClientStartInput, options?: CodingRunClientRequestOptions): Promise<unknown> {
    return this.execute(() => this.#client.start(input, options));
  }

  subscribeRun(input: CodingRunClientSubscribeInput, options?: CodingRunClientRequestOptions): Promise<unknown> {
    return this.execute(() => this.#client.subscribeRun(input, options));
  }

  respondPermission(input: CodingRunClientPermissionInput, options?: CodingRunClientRequestOptions): Promise<unknown> {
    return this.execute(() => this.#client.respondPermission(input, options));
  }

  steer(input: CodingRunClientSteerInput, options?: CodingRunClientRequestOptions): Promise<unknown> {
    return this.execute(() => this.#client.steer(input, options));
  }

  cancel(input: CodingRunClientCancelInput, options?: CodingRunClientRequestOptions): Promise<unknown> {
    return this.execute(() => this.#client.cancel(input, options));
  }

  readArtifact(input: CodingRunClientArtifactInput, options?: CodingRunClientRequestOptions): Promise<unknown> {
    return this.execute(() => this.#client.readArtifact(input, options));
  }

  listTaskProjections(
    input: CodingRunClientProjectionInput = {},
    options?: CodingRunClientRequestOptions,
  ): Promise<CodingRunClientProjectionPage | undefined> {
    if (!isProjectionInput(input)) {
      return Promise.reject(new CodingRunClientRequestError(
        "invalid_request",
        "Task projection request contains unsupported fields.",
      ));
    }
    return this.execute(() => this.#client.listTaskProjections(input, options));
  }

  consume(chunk: string): void {
    this.#client.consume(chunk);
  }

  close(reason?: string): void {
    this.#client.close(reason);
  }

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof InternalCodingRunClientRequestError) {
        throw new CodingRunClientRequestError(error.code, error.message);
      }
      throw new CodingRunClientRequestError("transport_error", "Coding run client operation failed.");
    }
  }
}

function isProjectionInput(value: unknown): value is CodingRunClientProjectionInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).every((key) => key === "limit" || key === "cursor");
}

/** Initial-version compatibility state; N-1 becomes mandatory when a successor protocol exists. */
export const CODING_RUN_CLIENT_COMPATIBILITY = {
  currentProtocolVersion: "v1",
  previousProtocolVersion: null,
  previousVersionGate: "not_applicable_initial_version",
} as const;
