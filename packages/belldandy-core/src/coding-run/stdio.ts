import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  CODING_RUN_PROTOCOL_VERSION,
  isAgentRunEventV1,
  isCodingRunSubscriptionV1,
  isRunControlV1,
  sanitizeCodingRunData,
  toSafeCodingRunErrorMessage,
  type AgentRunEvent,
  type CodingRunErrorCode,
  type CodingRunSubscription,
  type CodingRunSubscriptionErrorCode,
  type RunControl,
} from "./contracts.js";

const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_CONVERSATION_TEXT_CHARS = 64_000;
const MAX_CONVERSATION_IDENTIFIER_CHARS = 256;

/** 受限的编辑器提问输入；权限、工具与预算始终由 Gateway 的既有 message.send 契约裁决。 */
export type CodingRunConversationRequest = {
  version: typeof CODING_RUN_PROTOCOL_VERSION;
  text: string;
  cwd: string;
  conversationId?: string;
};

export type CodingRunConversationResponse =
  | { ok: true; result?: unknown }
  | { ok: false; error: { code: CodingRunErrorCode; message: string } };

/** 只读 Workspace Revision 查询；revisionId 对应 coding run 的 agentRunId。 */
export type CodingRunArtifactRequest = {
  revisionId: string;
  workspaceId?: string;
};

export type CodingRunArtifactResponse =
  | { ok: true; result?: unknown }
  | { ok: false; error: { code: CodingRunErrorCode; message: string } };

export type CodingRunControlResponse =
  | { ok: true; result?: unknown }
  | { ok: false; error: { code: CodingRunErrorCode; message: string } };

export type CodingRunSubscriptionResponse =
  | { ok: true; result?: unknown }
  | { ok: false; error: { code: CodingRunSubscriptionErrorCode; message: string } };

export type CodingRunSubscriptionErrorFrame = {
  code: CodingRunSubscriptionErrorCode;
  message: string;
  binding: CodingRunSubscription["binding"];
};

/** 允许进程 adapter 保留已知的、安全协议错误码，而不把 Gateway 错误降级为 internal。 */
export class CodingRunControlError extends Error {
  constructor(
    readonly code: CodingRunErrorCode,
    message: string,
  ) {
    super(toSafeCodingRunErrorMessage(message));
    this.name = "CodingRunControlError";
  }
}

/** 订阅中断不是运行终态；保留其独立错误码供客户端显示并决定重连。 */
export class CodingRunSubscriptionError extends Error {
  constructor(
    readonly code: CodingRunSubscriptionErrorCode,
    message: string,
  ) {
    super(toSafeCodingRunErrorMessage(message));
    this.name = "CodingRunSubscriptionError";
  }
}

export type CodingRunClientRequestErrorCode =
  | CodingRunErrorCode
  | CodingRunSubscriptionErrorCode
  | "request_timeout"
  | "request_aborted"
  | "client_closed"
  | "transport_error";

/** SDK 只暴露有界错误正文与稳定 code，不透传 transport/Gateway 私密细节。 */
export class CodingRunClientRequestError extends Error {
  constructor(
    readonly code: CodingRunClientRequestErrorCode,
    message: string,
  ) {
    super(toSafeCodingRunErrorMessage(message));
    this.name = "CodingRunClientRequestError";
  }
}

type PendingRequestLifecycle = {
  timeout?: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abortListener?: () => void;
};

type PendingControlRequest = PendingRequestLifecycle & {
  kind: "control";
  resolve: (result: CodingRunControlResponse) => void;
  reject: (error: Error) => void;
};

type PendingSubscriptionRequest = PendingRequestLifecycle & {
  kind: "subscription";
  resolve: (result: CodingRunSubscriptionResponse) => void;
  reject: (error: Error) => void;
};

type PendingConversationRequest = PendingRequestLifecycle & {
  kind: "conversation";
  resolve: (result: CodingRunConversationResponse) => void;
  reject: (error: Error) => void;
};

type PendingArtifactRequest = PendingRequestLifecycle & {
  kind: "artifact";
  resolve: (result: CodingRunArtifactResponse) => void;
  reject: (error: Error) => void;
};

type PendingRequest =
  | PendingControlRequest
  | PendingSubscriptionRequest
  | PendingConversationRequest
  | PendingArtifactRequest;

export type CodingRunNdjsonClientOptions = {
  write: (line: string) => void | Promise<void>;
  onEvent?: (event: AgentRunEvent) => void;
  onSubscriptionError?: (error: CodingRunSubscriptionErrorFrame) => void;
  onProtocolError?: (error: { code: "invalid_frame" | "frame_too_large"; message: string }) => void;
  createRequestId?: () => string;
  maxFrameBytes?: number;
};

export type CodingRunClientRequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type CodingRunClientOptions = CodingRunNdjsonClientOptions & {
  requestTimeoutMs?: number;
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

/**
 * 传输与业务运行时解耦的双向 NDJSON server。调用方注入来源控制器，避免 stdio 反向拥有 Goal/Workflow/Subtask。
 */
export function createCodingRunNdjsonServer(input: {
  write: (line: string) => void | Promise<void>;
  handleControl: (control: RunControl) => unknown | Promise<unknown>;
  handleConversation?: (conversation: CodingRunConversationRequest) => unknown | Promise<unknown>;
  handleSubscription?: (subscription: CodingRunSubscription) => unknown | Promise<unknown>;
  handleArtifact?: (artifact: CodingRunArtifactRequest) => unknown | Promise<unknown>;
  maxFrameBytes?: number;
}): {
  consume: (chunk: string) => Promise<void>;
  flush: () => Promise<void>;
  emitEvent: (event: AgentRunEvent) => Promise<boolean>;
  emitSubscriptionError: (error: CodingRunSubscriptionErrorFrame) => Promise<boolean>;
} {
  const decoder = createNdjsonDecoder(input.maxFrameBytes);
  const write = async (frame: unknown) => input.write(encodeFrame(frame));

  const protocolError = async (code: "invalid_frame" | "frame_too_large", message: string) => {
    await write({ version: CODING_RUN_PROTOCOL_VERSION, type: "protocol.error", code, message });
  };

  const consumeItems = async (items: Array<{ kind: "line"; line: string } | { kind: "too_large" }>) => {
    for (const item of items) {
        if (item.kind === "too_large") {
          await protocolError("frame_too_large", "NDJSON frame exceeds the configured byte limit.");
          continue;
        }
        const parsed = parseJsonRecord(item.line);
        const requestId = readRequestId(parsed);
        if (isControlRequest(parsed)) {
          try {
            const result = await input.handleControl(parsed.control);
            await write({
              version: CODING_RUN_PROTOCOL_VERSION,
              type: "control.response",
              id: parsed.id,
              ok: true,
              ...(result === undefined ? {} : { result: sanitizeCodingRunData(result) }),
            });
          } catch (error) {
            const code = error instanceof CodingRunControlError ? error.code : "internal";
            await write(controlFailure(parsed.id, code, toSafeCodingRunErrorMessage(error)));
          }
          continue;
        }
        if (isSubscriptionRequest(parsed)) {
          try {
            if (!input.handleSubscription) {
              throw new CodingRunSubscriptionError("not_found", "Coding run subscriptions are unavailable.");
            }
            const result = await input.handleSubscription(parsed.subscription);
            await write({
              version: CODING_RUN_PROTOCOL_VERSION,
              type: "subscription.response",
              id: parsed.id,
              ok: true,
              ...(result === undefined ? {} : { result: sanitizeCodingRunData(result) }),
            });
          } catch (error) {
            const code = error instanceof CodingRunSubscriptionError ? error.code : "internal";
            await write(subscriptionFailure(parsed.id, code, toSafeCodingRunErrorMessage(error)));
          }
          continue;
        }
        if (isConversationRequest(parsed)) {
          try {
            if (!input.handleConversation) {
              throw new CodingRunControlError("not_found", "Coding run conversations are unavailable.");
            }
            const result = await input.handleConversation(parsed.conversation);
            await write({
              version: CODING_RUN_PROTOCOL_VERSION,
              type: "conversation.response",
              id: parsed.id,
              ok: true,
              ...(result === undefined ? {} : { result: sanitizeCodingRunData(result) }),
            });
          } catch (error) {
            const code = error instanceof CodingRunControlError ? error.code : "internal";
            await write(conversationFailure(parsed.id, code, toSafeCodingRunErrorMessage(error)));
          }
          continue;
        }
        if (isArtifactRequest(parsed)) {
          try {
            if (!input.handleArtifact) {
              throw new CodingRunControlError("not_found", "Coding run artifacts are unavailable.");
            }
            const result = await input.handleArtifact(parsed.artifact);
            await write({
              version: CODING_RUN_PROTOCOL_VERSION,
              type: "artifact.response",
              id: parsed.id,
              ok: true,
              ...(result === undefined ? {} : { result: sanitizeCodingRunData(result) }),
            });
          } catch (error) {
            const code = error instanceof CodingRunControlError ? error.code : "internal";
            await write(artifactFailure(parsed.id, code, toSafeCodingRunErrorMessage(error)));
          }
          continue;
        }
        {
          if (requestId) {
            if (parsed?.type === "conversation.request") {
              await write(conversationFailure(requestId, "invalid_request", "Invalid coding run conversation request."));
            } else if (parsed?.type === "subscription.request") {
              await write(subscriptionFailure(requestId, "invalid_request", "Invalid coding run subscription request."));
            } else if (parsed?.type === "artifact.request") {
              await write(artifactFailure(requestId, "invalid_request", "Invalid coding run artifact request."));
            } else {
              await write(controlFailure(requestId, "invalid_request", "Invalid coding run control request."));
            }
          } else {
            await protocolError("invalid_frame", "Invalid coding run NDJSON frame.");
          }
        }
    }
  };

  return {
    consume: async (chunk) => {
      await consumeItems(decoder.consume(chunk));
    },
    flush: async () => {
      await consumeItems(decoder.flush());
    },
    emitEvent: async (event) => {
      if (!isAgentRunEventV1(event)) return false;
      await write({ version: CODING_RUN_PROTOCOL_VERSION, type: "event", event });
      return true;
    },
    emitSubscriptionError: async (error) => {
      if (!isCodingRunSubscriptionError(error)) return false;
      await write({ version: CODING_RUN_PROTOCOL_VERSION, type: "subscription.error", ...error });
      return true;
    },
  };
}

/**
 * 最小 TypeScript SDK：负责 request/response 关联和事件接收；进程、socket 与编辑器生命周期由外层 adapter 管理。
 */
export class CodingRunNdjsonClient {
  private readonly decoder: NdjsonDecoder;
  private readonly pending = new Map<string, PendingRequest>();
  private closed = false;

  constructor(private readonly options: CodingRunNdjsonClientOptions) {
    this.decoder = createNdjsonDecoder(options.maxFrameBytes);
  }

  control(control: RunControl, options?: CodingRunClientRequestOptions): Promise<CodingRunControlResponse> {
    if (this.closed) return Promise.reject(clientClosedError());
    if (options?.signal?.aborted) return Promise.reject(requestAbortedError());
    if (!isRunControlV1(control)) {
      return Promise.resolve({
        ok: false,
        error: { code: "invalid_request", message: "Invalid coding run control request." },
      });
    }
    const id = this.createUniqueRequestId();
    const response = new Promise<CodingRunControlResponse>((resolve, reject) => {
      this.pending.set(id, { kind: "control", resolve, reject });
    });
    this.configurePending(id, options);
    if (this.pending.has(id)) {
      this.writeRequest(id, {
        version: CODING_RUN_PROTOCOL_VERSION,
        type: "control.request",
        id,
        control,
      });
    }
    return response;
  }

  subscribe(
    subscription: CodingRunSubscription,
    options?: CodingRunClientRequestOptions,
  ): Promise<CodingRunSubscriptionResponse> {
    if (this.closed) return Promise.reject(clientClosedError());
    if (options?.signal?.aborted) return Promise.reject(requestAbortedError());
    if (!isCodingRunSubscriptionV1(subscription)) {
      return Promise.resolve({
        ok: false,
        error: { code: "invalid_request", message: "Invalid coding run subscription request." },
      });
    }
    const id = this.createUniqueRequestId();
    const response = new Promise<CodingRunSubscriptionResponse>((resolve, reject) => {
      this.pending.set(id, { kind: "subscription", resolve, reject });
    });
    this.configurePending(id, options);
    if (this.pending.has(id)) {
      this.writeRequest(id, {
        version: CODING_RUN_PROTOCOL_VERSION,
        type: "subscription.request",
        id,
        subscription,
      });
    }
    return response;
  }

  conversation(
    conversation: CodingRunConversationRequest,
    options?: CodingRunClientRequestOptions,
  ): Promise<CodingRunConversationResponse> {
    if (this.closed) return Promise.reject(clientClosedError());
    if (options?.signal?.aborted) return Promise.reject(requestAbortedError());
    if (!isCodingRunConversationRequest(conversation)) {
      return Promise.resolve({
        ok: false,
        error: { code: "invalid_request", message: "Invalid coding run conversation request." },
      });
    }
    const id = this.createUniqueRequestId();
    const response = new Promise<CodingRunConversationResponse>((resolve, reject) => {
      this.pending.set(id, { kind: "conversation", resolve, reject });
    });
    this.configurePending(id, options);
    if (this.pending.has(id)) {
      this.writeRequest(id, {
        version: CODING_RUN_PROTOCOL_VERSION,
        type: "conversation.request",
        id,
        conversation,
      });
    }
    return response;
  }

  artifact(
    artifact: CodingRunArtifactRequest,
    options?: CodingRunClientRequestOptions,
  ): Promise<CodingRunArtifactResponse> {
    if (this.closed) return Promise.reject(clientClosedError());
    if (options?.signal?.aborted) return Promise.reject(requestAbortedError());
    if (!isCodingRunArtifactRequest(artifact)) {
      return Promise.resolve({
        ok: false,
        error: { code: "invalid_request", message: "Invalid coding run artifact request." },
      });
    }
    const id = this.createUniqueRequestId();
    const response = new Promise<CodingRunArtifactResponse>((resolve, reject) => {
      this.pending.set(id, { kind: "artifact", resolve, reject });
    });
    this.configurePending(id, options);
    if (this.pending.has(id)) {
      this.writeRequest(id, {
        version: CODING_RUN_PROTOCOL_VERSION,
        type: "artifact.request",
        id,
        artifact,
      });
    }
    return response;
  }

  consume(chunk: string): void {
    if (this.closed) return;
    for (const item of this.decoder.consume(chunk)) {
      if (item.kind === "too_large") {
        this.options.onProtocolError?.({ code: "frame_too_large", message: "NDJSON frame exceeds the configured byte limit." });
        continue;
      }
      const frame = parseJsonRecord(item.line);
      if (isEventFrame(frame)) {
        try {
          this.options.onEvent?.(frame.event);
        } catch {
          // 客户端展示回调失败不得破坏协议读取或遗留 pending control。
        }
        continue;
      }
      if (isControlResponseFrame(frame)) {
        const pending = this.pending.get(frame.id);
        if (!pending || pending.kind !== "control") continue;
        this.takePending(frame.id);
        pending.resolve(frame.ok
          ? { ok: true, ...(hasOwn(frame, "result") ? { result: frame.result } : {}) }
          : { ok: false, error: { code: frame.error.code, message: toSafeCodingRunErrorMessage(frame.error.message) } });
        continue;
      }
      if (isSubscriptionResponseFrame(frame)) {
        const pending = this.pending.get(frame.id);
        if (!pending || pending.kind !== "subscription") continue;
        this.takePending(frame.id);
        pending.resolve(frame.ok
          ? { ok: true, ...(hasOwn(frame, "result") ? { result: frame.result } : {}) }
          : { ok: false, error: { code: frame.error.code, message: toSafeCodingRunErrorMessage(frame.error.message) } });
        continue;
      }
      if (isConversationResponseFrame(frame)) {
        const pending = this.pending.get(frame.id);
        if (!pending || pending.kind !== "conversation") continue;
        this.takePending(frame.id);
        pending.resolve(frame.ok
          ? { ok: true, ...(hasOwn(frame, "result") ? { result: frame.result } : {}) }
          : { ok: false, error: { code: frame.error.code, message: toSafeCodingRunErrorMessage(frame.error.message) } });
        continue;
      }
      if (isArtifactResponseFrame(frame)) {
        const pending = this.pending.get(frame.id);
        if (!pending || pending.kind !== "artifact") continue;
        this.takePending(frame.id);
        pending.resolve(frame.ok
          ? { ok: true, ...(hasOwn(frame, "result") ? { result: frame.result } : {}) }
          : { ok: false, error: { code: frame.error.code, message: toSafeCodingRunErrorMessage(frame.error.message) } });
        continue;
      }
      if (isCodingRunSubscriptionErrorFrame(frame)) {
        this.options.onSubscriptionError?.({
          code: frame.code,
          message: frame.message,
          binding: frame.binding,
        });
        continue;
      }
      if (isProtocolErrorFrame(frame)) {
        this.options.onProtocolError?.({ code: frame.code, message: frame.message });
        continue;
      }
      this.options.onProtocolError?.({ code: "invalid_frame", message: "Invalid coding run NDJSON frame." });
    }
  }

  close(reason = "Coding run NDJSON client is closed."): void {
    if (this.closed) return;
    this.closed = true;
    for (const id of Array.from(this.pending.keys())) {
      const pending = this.takePending(id);
      pending?.reject(new CodingRunClientRequestError("client_closed", reason));
    }
  }

  private createUniqueRequestId(): string {
    for (;;) {
      const id = (this.options.createRequestId?.() ?? randomUUID()).trim();
      if (id && !this.pending.has(id)) return id;
    }
  }

  private rejectPending(id: string, error: unknown): void {
    const pending = this.takePending(id);
    if (!pending) return;
    pending.reject(error instanceof CodingRunClientRequestError
      ? error
      : new CodingRunClientRequestError("transport_error", toSafeCodingRunErrorMessage(error)));
  }

  private writeRequest(id: string, frame: unknown): void {
    try {
      void Promise.resolve(this.options.write(encodeFrame(frame)))
        .catch((error) => this.rejectPending(id, error));
    } catch (error) {
      this.rejectPending(id, error);
    }
  }

  private configurePending(id: string, options: CodingRunClientRequestOptions | undefined): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    if (options?.signal) {
      const abortListener = () => this.rejectPending(id, requestAbortedError());
      pending.signal = options.signal;
      pending.abortListener = abortListener;
      options.signal.addEventListener("abort", abortListener, { once: true });
      if (options.signal.aborted) abortListener();
    }
    if (!this.pending.has(id) || options?.timeoutMs === undefined) return;
    const timeoutMs = normalizeRequestTimeout(options.timeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
    pending.timeout = setTimeout(() => {
      this.rejectPending(id, new CodingRunClientRequestError("request_timeout", "Coding run request timed out."));
    }, timeoutMs);
    (pending.timeout as { unref?: () => void }).unref?.();
  }

  private takePending(id: string): PendingRequest | undefined {
    const pending = this.pending.get(id);
    if (!pending) return undefined;
    this.pending.delete(id);
    if (pending.timeout) clearTimeout(pending.timeout);
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener("abort", pending.abortListener);
    }
    return pending;
  }
}

/** 面向编辑器、CI 与第三方 consumer 的受限 coding-run 生命周期接口。 */
export class CodingRunClient {
  private readonly transport: CodingRunNdjsonClient;
  private readonly requestTimeoutMs: number;

  constructor(options: CodingRunClientOptions) {
    this.transport = new CodingRunNdjsonClient(options);
    this.requestTimeoutMs = normalizeRequestTimeout(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
  }

  start(input: CodingRunClientStartInput, options?: CodingRunClientRequestOptions): Promise<unknown> {
    return this.unwrap(this.transport.conversation({
      version: CODING_RUN_PROTOCOL_VERSION,
      text: input.prompt,
      cwd: input.cwd,
      ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
    }, this.resolveRequestOptions(options)));
  }

  subscribeRun(input: CodingRunClientSubscribeInput, options?: CodingRunClientRequestOptions): Promise<unknown> {
    return this.unwrap(this.transport.subscribe({
      version: CODING_RUN_PROTOCOL_VERSION,
      binding: { conversationId: input.conversationId, agentRunId: input.agentRunId },
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    }, this.resolveRequestOptions(options)));
  }

  respondPermission(input: CodingRunClientPermissionInput, options?: CodingRunClientRequestOptions): Promise<unknown> {
    return this.unwrap(this.transport.control({
      version: CODING_RUN_PROTOCOL_VERSION,
      operation: "permission.respond",
      binding: {
        agentRunId: input.agentRunId,
        ...(input.worktreeId === undefined ? {} : { worktreeId: input.worktreeId }),
      },
      toolCallId: input.toolCallId,
      decision: input.decision,
    }, this.resolveRequestOptions(options)));
  }

  steer(input: CodingRunClientSteerInput, options?: CodingRunClientRequestOptions): Promise<unknown> {
    return this.unwrap(this.transport.control({
      version: CODING_RUN_PROTOCOL_VERSION,
      operation: "conversation.steer",
      binding: { conversationId: input.conversationId, agentRunId: input.agentRunId },
      prompt: input.prompt,
      idempotencyKey: input.idempotencyKey,
    }, this.resolveRequestOptions(options)));
  }

  cancel(input: CodingRunClientCancelInput, options?: CodingRunClientRequestOptions): Promise<unknown> {
    return this.unwrap(this.transport.control({
      version: CODING_RUN_PROTOCOL_VERSION,
      operation: "cancel",
      binding: { conversationId: input.conversationId, agentRunId: input.agentRunId },
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    }, this.resolveRequestOptions(options)));
  }

  readArtifact(input: CodingRunClientArtifactInput, options?: CodingRunClientRequestOptions): Promise<unknown> {
    return this.unwrap(this.transport.artifact({
      revisionId: input.agentRunId,
      ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
    }, this.resolveRequestOptions(options)));
  }

  consume(chunk: string): void {
    this.transport.consume(chunk);
  }

  close(reason?: string): void {
    this.transport.close(reason);
  }

  private async unwrap(
    response: Promise<
      CodingRunConversationResponse
      | CodingRunControlResponse
      | CodingRunSubscriptionResponse
      | CodingRunArtifactResponse
    >,
  ): Promise<unknown> {
    const result = await response;
    if (result.ok) return result.result;
    throw new CodingRunClientRequestError(result.error.code, result.error.message);
  }

  private resolveRequestOptions(options: CodingRunClientRequestOptions | undefined): CodingRunClientRequestOptions {
    return {
      ...(options?.signal ? { signal: options.signal } : {}),
      timeoutMs: normalizeRequestTimeout(options?.timeoutMs, this.requestTimeoutMs),
    };
  }
}

type NdjsonDecoder = {
  consume: (chunk: string) => Array<{ kind: "line"; line: string } | { kind: "too_large" }>;
  flush: () => Array<{ kind: "line"; line: string } | { kind: "too_large" }>;
};

function createNdjsonDecoder(maxFrameBytes = DEFAULT_MAX_FRAME_BYTES): NdjsonDecoder {
  const maxBytes = Number.isFinite(maxFrameBytes) ? Math.max(1, Math.trunc(maxFrameBytes)) : DEFAULT_MAX_FRAME_BYTES;
  let pending = "";
  const toFrame = (raw: string): { kind: "line"; line: string } | { kind: "too_large" } => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    return Buffer.byteLength(line, "utf-8") > maxBytes ? { kind: "too_large" } : { kind: "line", line };
  };
  return {
    consume: (chunk) => {
      pending += typeof chunk === "string" ? chunk : String(chunk ?? "");
      const frames: Array<{ kind: "line"; line: string } | { kind: "too_large" }> = [];
      let newlineIndex = pending.indexOf("\n");
      while (newlineIndex >= 0) {
        const raw = pending.slice(0, newlineIndex);
        pending = pending.slice(newlineIndex + 1);
        frames.push(toFrame(raw));
        newlineIndex = pending.indexOf("\n");
      }
      if (Buffer.byteLength(pending, "utf-8") > maxBytes) {
        pending = "";
        frames.push({ kind: "too_large" });
      }
      return frames;
    },
    flush: () => {
      if (!pending) return [];
      const frame = toFrame(pending);
      pending = "";
      return [frame];
    },
  };
}

function encodeFrame(frame: unknown): string {
  return `${JSON.stringify(sanitizeCodingRunData(frame))}\n`;
}

function controlFailure(id: string, code: CodingRunErrorCode, message: string): Record<string, unknown> {
  return {
    version: CODING_RUN_PROTOCOL_VERSION,
    type: "control.response",
    id,
    ok: false,
    error: { code, message: toSafeCodingRunErrorMessage(message) },
  };
}

function subscriptionFailure(
  id: string,
  code: CodingRunSubscriptionErrorCode,
  message: string,
): Record<string, unknown> {
  return {
    version: CODING_RUN_PROTOCOL_VERSION,
    type: "subscription.response",
    id,
    ok: false,
    error: { code, message: toSafeCodingRunErrorMessage(message) },
  };
}

function conversationFailure(id: string, code: CodingRunErrorCode, message: string): Record<string, unknown> {
  return {
    version: CODING_RUN_PROTOCOL_VERSION,
    type: "conversation.response",
    id,
    ok: false,
    error: { code, message: toSafeCodingRunErrorMessage(message) },
  };
}

function artifactFailure(id: string, code: CodingRunErrorCode, message: string): Record<string, unknown> {
  return {
    version: CODING_RUN_PROTOCOL_VERSION,
    type: "artifact.response",
    id,
    ok: false,
    error: { code, message: toSafeCodingRunErrorMessage(message) },
  };
}

function isControlRequest(value: Record<string, unknown> | undefined): value is {
  version: typeof CODING_RUN_PROTOCOL_VERSION;
  type: "control.request";
  id: string;
  control: RunControl;
} {
  if (!value) return false;
  return hasOnlyKeys(value, ["version", "type", "id", "control"])
    && value.version === CODING_RUN_PROTOCOL_VERSION
    && value.type === "control.request"
    && isNonEmptyString(value.id)
    && isRunControlV1(value.control);
}

function isSubscriptionRequest(value: Record<string, unknown> | undefined): value is {
  version: typeof CODING_RUN_PROTOCOL_VERSION;
  type: "subscription.request";
  id: string;
  subscription: CodingRunSubscription;
} {
  if (!value) return false;
  return hasOnlyKeys(value, ["version", "type", "id", "subscription"])
    && value.version === CODING_RUN_PROTOCOL_VERSION
    && value.type === "subscription.request"
    && isNonEmptyString(value.id)
    && isCodingRunSubscriptionV1(value.subscription);
}

function isConversationRequest(value: Record<string, unknown> | undefined): value is {
  version: typeof CODING_RUN_PROTOCOL_VERSION;
  type: "conversation.request";
  id: string;
  conversation: CodingRunConversationRequest;
} {
  if (!value) return false;
  return hasOnlyKeys(value, ["version", "type", "id", "conversation"])
    && value.version === CODING_RUN_PROTOCOL_VERSION
    && value.type === "conversation.request"
    && isNonEmptyString(value.id)
    && isCodingRunConversationRequest(value.conversation);
}

function isArtifactRequest(value: Record<string, unknown> | undefined): value is {
  version: typeof CODING_RUN_PROTOCOL_VERSION;
  type: "artifact.request";
  id: string;
  artifact: CodingRunArtifactRequest;
} {
  if (!value) return false;
  return hasOnlyKeys(value, ["version", "type", "id", "artifact"])
    && value.version === CODING_RUN_PROTOCOL_VERSION
    && value.type === "artifact.request"
    && isNonEmptyString(value.id)
    && isCodingRunArtifactRequest(value.artifact);
}

function isControlResponseFrame(value: Record<string, unknown> | undefined): value is ControlResponseFrame {
  if (!value || value.version !== CODING_RUN_PROTOCOL_VERSION || value.type !== "control.response" || !isNonEmptyString(value.id)) {
    return false;
  }
  if (value.ok === true) return hasOnlyKeys(value, ["version", "type", "id", "ok", "result"]);
  return value.ok === false
    && hasOnlyKeys(value, ["version", "type", "id", "ok", "error"])
    && isControlError(value.error);
}

type ControlResponseFrame =
  | {
      version: typeof CODING_RUN_PROTOCOL_VERSION;
      type: "control.response";
      id: string;
      ok: true;
      result?: unknown;
    }
  | {
      version: typeof CODING_RUN_PROTOCOL_VERSION;
      type: "control.response";
      id: string;
      ok: false;
      error: { code: CodingRunErrorCode; message: string };
    };

type SubscriptionResponseFrame =
  | {
      version: typeof CODING_RUN_PROTOCOL_VERSION;
      type: "subscription.response";
      id: string;
      ok: true;
      result?: unknown;
    }
  | {
      version: typeof CODING_RUN_PROTOCOL_VERSION;
      type: "subscription.response";
      id: string;
      ok: false;
      error: { code: CodingRunSubscriptionErrorCode; message: string };
    };

type ConversationResponseFrame =
  | {
      version: typeof CODING_RUN_PROTOCOL_VERSION;
      type: "conversation.response";
      id: string;
      ok: true;
      result?: unknown;
    }
  | {
      version: typeof CODING_RUN_PROTOCOL_VERSION;
      type: "conversation.response";
      id: string;
      ok: false;
      error: { code: CodingRunErrorCode; message: string };
    };

type ArtifactResponseFrame =
  | {
      version: typeof CODING_RUN_PROTOCOL_VERSION;
      type: "artifact.response";
      id: string;
      ok: true;
      result?: unknown;
    }
  | {
      version: typeof CODING_RUN_PROTOCOL_VERSION;
      type: "artifact.response";
      id: string;
      ok: false;
      error: { code: CodingRunErrorCode; message: string };
    };

function isSubscriptionResponseFrame(value: Record<string, unknown> | undefined): value is SubscriptionResponseFrame {
  if (!value || value.version !== CODING_RUN_PROTOCOL_VERSION || value.type !== "subscription.response" || !isNonEmptyString(value.id)) {
    return false;
  }
  if (value.ok === true) return hasOnlyKeys(value, ["version", "type", "id", "ok", "result"]);
  return value.ok === false
    && hasOnlyKeys(value, ["version", "type", "id", "ok", "error"])
    && isSubscriptionError(value.error);
}

function isConversationResponseFrame(value: Record<string, unknown> | undefined): value is ConversationResponseFrame {
  if (!value || value.version !== CODING_RUN_PROTOCOL_VERSION || value.type !== "conversation.response" || !isNonEmptyString(value.id)) {
    return false;
  }
  if (value.ok === true) return hasOnlyKeys(value, ["version", "type", "id", "ok", "result"]);
  return value.ok === false
    && hasOnlyKeys(value, ["version", "type", "id", "ok", "error"])
    && isControlError(value.error);
}

function isArtifactResponseFrame(value: Record<string, unknown> | undefined): value is ArtifactResponseFrame {
  if (!value || value.version !== CODING_RUN_PROTOCOL_VERSION || value.type !== "artifact.response" || !isNonEmptyString(value.id)) {
    return false;
  }
  if (value.ok === true) return hasOnlyKeys(value, ["version", "type", "id", "ok", "result"]);
  return value.ok === false
    && hasOnlyKeys(value, ["version", "type", "id", "ok", "error"])
    && isControlError(value.error);
}

function isEventFrame(value: Record<string, unknown> | undefined): value is {
  version: typeof CODING_RUN_PROTOCOL_VERSION;
  type: "event";
  event: AgentRunEvent;
} {
  if (!value) return false;
  return hasOnlyKeys(value, ["version", "type", "event"])
    && value.version === CODING_RUN_PROTOCOL_VERSION
    && value.type === "event"
    && isAgentRunEventV1(value.event);
}

function isProtocolErrorFrame(value: Record<string, unknown> | undefined): value is {
  version: typeof CODING_RUN_PROTOCOL_VERSION;
  type: "protocol.error";
  code: "invalid_frame" | "frame_too_large";
  message: string;
} {
  if (!value) return false;
  return hasOnlyKeys(value, ["version", "type", "code", "message"])
    && value.version === CODING_RUN_PROTOCOL_VERSION
    && value.type === "protocol.error"
    && (value.code === "invalid_frame" || value.code === "frame_too_large")
    && typeof value.message === "string";
}

function isCodingRunSubscriptionErrorFrame(value: unknown): value is CodingRunSubscriptionErrorFrame {
  if (!isRecord(value) || !hasOnlyKeys(value, ["version", "type", "code", "message", "binding"])) return false;
  return value.version === CODING_RUN_PROTOCOL_VERSION
    && value.type === "subscription.error"
    && isCodingRunSubscriptionError({
      code: value.code,
      message: value.message,
      binding: value.binding,
    });
}

function isCodingRunSubscriptionError(value: unknown): value is CodingRunSubscriptionErrorFrame {
  if (!isRecord(value) || !hasOnlyKeys(value, ["code", "message", "binding"])) return false;
  return isCodingRunSubscriptionErrorCode(value.code)
    && typeof value.message === "string"
    && isCodingRunSubscriptionV1({ version: CODING_RUN_PROTOCOL_VERSION, binding: value.binding });
}

function isControlError(value: unknown): value is { code: CodingRunErrorCode; message: string } {
  return isRecord(value)
    && hasOnlyKeys(value, ["code", "message"])
    && isCodingRunErrorCode(value.code)
    && typeof value.message === "string";
}

function isSubscriptionError(value: unknown): value is { code: CodingRunSubscriptionErrorCode; message: string } {
  return isRecord(value)
    && hasOnlyKeys(value, ["code", "message"])
    && isCodingRunSubscriptionErrorCode(value.code)
    && typeof value.message === "string";
}

function isCodingRunSubscriptionErrorCode(value: unknown): value is CodingRunSubscriptionErrorCode {
  return value === "cursor_expired" || isCodingRunErrorCode(value);
}

function isCodingRunErrorCode(value: unknown): value is CodingRunErrorCode {
  return value === "invalid_request"
    || value === "not_found"
    || value === "run_mismatch"
    || value === "not_active"
    || value === "permission_required"
    || value === "permission_denied"
    || value === "policy_denied"
    || value === "budget_exhausted"
    || value === "cancelled"
    || value === "interrupted"
    || value === "output_schema_invalid"
    || value === "gateway_unavailable"
    || value === "internal";
}

function isCodingRunConversationRequest(value: unknown): value is CodingRunConversationRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, ["version", "text", "cwd", "conversationId"])) return false;
  if (value.version !== CODING_RUN_PROTOCOL_VERSION || !isSafeConversationText(value.text)) return false;
  if (typeof value.cwd !== "string" || !value.cwd.trim() || !path.isAbsolute(value.cwd.trim())) return false;
  return value.conversationId === undefined || isConversationIdentifier(value.conversationId);
}

function isCodingRunArtifactRequest(value: unknown): value is CodingRunArtifactRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, ["revisionId", "workspaceId"])) return false;
  if (!isConversationIdentifier(value.revisionId)) return false;
  return value.workspaceId === undefined || isConversationIdentifier(value.workspaceId);
}

function isSafeConversationText(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= MAX_CONVERSATION_TEXT_CHARS
    && !value.includes("\u0000");
}

function isConversationIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.trim().length <= MAX_CONVERSATION_IDENTIFIER_CHARS
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function normalizeRequestTimeout(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value!)) : fallback;
}

function clientClosedError(): CodingRunClientRequestError {
  return new CodingRunClientRequestError("client_closed", "Coding run NDJSON client is closed.");
}

function requestAbortedError(): CodingRunClientRequestError {
  return new CodingRunClientRequestError("request_aborted", "Coding run request was aborted.");
}

function parseJsonRecord(line: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readRequestId(value: Record<string, unknown> | undefined): string | undefined {
  return value && isNonEmptyString(value.id) ? value.id.trim() : undefined;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
