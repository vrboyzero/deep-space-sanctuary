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

type PendingControlRequest = {
  kind: "control";
  resolve: (result: CodingRunControlResponse) => void;
  reject: (error: Error) => void;
};

type PendingSubscriptionRequest = {
  kind: "subscription";
  resolve: (result: CodingRunSubscriptionResponse) => void;
  reject: (error: Error) => void;
};

type PendingConversationRequest = {
  kind: "conversation";
  resolve: (result: CodingRunConversationResponse) => void;
  reject: (error: Error) => void;
};

type PendingRequest = PendingControlRequest | PendingSubscriptionRequest | PendingConversationRequest;

export type CodingRunNdjsonClientOptions = {
  write: (line: string) => void | Promise<void>;
  onEvent?: (event: AgentRunEvent) => void;
  onSubscriptionError?: (error: CodingRunSubscriptionErrorFrame) => void;
  onProtocolError?: (error: { code: "invalid_frame" | "frame_too_large"; message: string }) => void;
  createRequestId?: () => string;
  maxFrameBytes?: number;
};

/**
 * 传输与业务运行时解耦的双向 NDJSON server。调用方注入来源控制器，避免 stdio 反向拥有 Goal/Workflow/Subtask。
 */
export function createCodingRunNdjsonServer(input: {
  write: (line: string) => void | Promise<void>;
  handleControl: (control: RunControl) => unknown | Promise<unknown>;
  handleConversation?: (conversation: CodingRunConversationRequest) => unknown | Promise<unknown>;
  handleSubscription?: (subscription: CodingRunSubscription) => unknown | Promise<unknown>;
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
        {
          if (requestId) {
            if (parsed?.type === "conversation.request") {
              await write(conversationFailure(requestId, "invalid_request", "Invalid coding run conversation request."));
            } else if (parsed?.type === "subscription.request") {
              await write(subscriptionFailure(requestId, "invalid_request", "Invalid coding run subscription request."));
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

  control(control: RunControl): Promise<CodingRunControlResponse> {
    if (this.closed) return Promise.reject(new Error("Coding run NDJSON client is closed."));
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
    void Promise.resolve(this.options.write(encodeFrame({
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "control.request",
      id,
      control,
    }))).catch((error) => this.rejectPending(id, error));
    return response;
  }

  subscribe(subscription: CodingRunSubscription): Promise<CodingRunSubscriptionResponse> {
    if (this.closed) return Promise.reject(new Error("Coding run NDJSON client is closed."));
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
    void Promise.resolve(this.options.write(encodeFrame({
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "subscription.request",
      id,
      subscription,
    }))).catch((error) => this.rejectPending(id, error));
    return response;
  }

  conversation(conversation: CodingRunConversationRequest): Promise<CodingRunConversationResponse> {
    if (this.closed) return Promise.reject(new Error("Coding run NDJSON client is closed."));
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
    void Promise.resolve(this.options.write(encodeFrame({
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "conversation.request",
      id,
      conversation,
    }))).catch((error) => this.rejectPending(id, error));
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
        this.pending.delete(frame.id);
        pending.resolve(frame.ok
          ? { ok: true, ...(hasOwn(frame, "result") ? { result: frame.result } : {}) }
          : { ok: false, error: { code: frame.error.code, message: toSafeCodingRunErrorMessage(frame.error.message) } });
        continue;
      }
      if (isSubscriptionResponseFrame(frame)) {
        const pending = this.pending.get(frame.id);
        if (!pending || pending.kind !== "subscription") continue;
        this.pending.delete(frame.id);
        pending.resolve(frame.ok
          ? { ok: true, ...(hasOwn(frame, "result") ? { result: frame.result } : {}) }
          : { ok: false, error: { code: frame.error.code, message: toSafeCodingRunErrorMessage(frame.error.message) } });
        continue;
      }
      if (isConversationResponseFrame(frame)) {
        const pending = this.pending.get(frame.id);
        if (!pending || pending.kind !== "conversation") continue;
        this.pending.delete(frame.id);
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
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      pending.reject(new Error(reason));
    }
  }

  private createUniqueRequestId(): string {
    for (;;) {
      const id = (this.options.createRequestId?.() ?? randomUUID()).trim();
      if (id && !this.pending.has(id)) return id;
    }
  }

  private rejectPending(id: string, error: unknown): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    pending.reject(new Error(toSafeCodingRunErrorMessage(error)));
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
    && typeof value.code === "string"
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
