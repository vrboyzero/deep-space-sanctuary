const { randomUUID } = require("node:crypto");
const { spawn: spawnChildProcess } = require("node:child_process");
const path = require("node:path");
const { isTaskProjectionCollectionPage } = require("./task-projection-validator.cjs");

const PROTOCOL_VERSION = "v1";
const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_PENDING_REQUESTS = 64;
const MAX_ERROR_MESSAGE_CHARS = 512;
const MAX_CONVERSATION_TEXT_CHARS = 64_000;
const MAX_CONVERSATION_IDENTIFIER_CHARS = 256;

class CodingRunStdioClientError extends Error {
  constructor(code, message) {
    super(safeMessage(message));
    this.name = "CodingRunStdioClientError";
    this.code = code;
  }
}

class CodingRunStdioClient {
  constructor(options) {
    this.command = requireNonEmptyString(options.command, "command");
    this.stateDir = normalizeOptionalString(options.stateDir);
    this.spawn = options.spawn ?? spawnChildProcess;
    this.createRequestId = options.createRequestId ?? randomUUID;
    this.maxFrameBytes = Number.isFinite(options.maxFrameBytes)
      ? Math.max(1, Math.trunc(options.maxFrameBytes))
      : DEFAULT_MAX_FRAME_BYTES;
    this.requestTimeoutMs = Number.isFinite(options.requestTimeoutMs)
      ? Math.max(1, Math.trunc(options.requestTimeoutMs))
      : DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxPendingRequests = Number.isFinite(options.maxPendingRequests)
      ? Math.min(1024, Math.max(1, Math.trunc(options.maxPendingRequests)))
      : DEFAULT_MAX_PENDING_REQUESTS;
    this.onEvent = options.onEvent;
    this.onSubscriptionError = options.onSubscriptionError;
    this.onProtocolError = options.onProtocolError;
    this.onStateChange = options.onStateChange;
    this.child = undefined;
    this.stdoutBuffer = "";
    this.pending = new Map();
    this.currentState = "stopped";
  }

  get state() {
    return this.currentState;
  }

  async start() {
    if (this.child) return;

    const args = ["coding-run", "stdio"];
    if (this.stateDir) args.push("--state-dir", this.stateDir);
    let child;
    try {
      child = this.spawn(this.command, args, {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      this.transition("error");
      throw new CodingRunStdioClientError("transport_error", `Could not start the Belldandy coding-run bridge: ${safeMessage(error)}`);
    }
    if (!child?.stdin || !child.stdout || !child.stderr) {
      this.transition("error");
      throw new CodingRunStdioClientError("transport_error", "Belldandy coding-run bridge did not expose stdio streams.");
    }

    this.child = child;
    child.stdout.setEncoding?.("utf8");
    child.stderr.setEncoding?.("utf8");
    child.stdout.on("data", (chunk) => this.consumeStdout(String(chunk)));
    child.stderr.on("data", () => {
      // stderr 属于诊断边界；不复制可能含敏感信息的正文到 VS Code UI。
    });
    child.once("error", (error) => this.handleProcessFailure(error));
    child.once("exit", (_code, signal) => this.handleExit(signal));
    this.transition("running");
  }

  stop() {
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    try {
      child.stdin.end();
      child.kill();
    } catch {
      // exit/error listener 会清理等待中的请求；停止调用本身不泄露进程详情。
    }
    this.transition("stopped");
    this.rejectPending(new CodingRunStdioClientError("client_closed", "Belldandy coding-run bridge was stopped."));
  }

  async cancelConversation(input, options) {
    const conversationId = requireNonEmptyString(input.conversationId, "conversationId");
    const agentRunId = requireNonEmptyString(input.agentRunId, "agentRunId");
    const reason = normalizeOptionalString(input.reason);
    return this.sendControl({
      version: PROTOCOL_VERSION,
      operation: "cancel",
      binding: { conversationId, agentRunId },
      ...(reason ? { reason } : {}),
    }, options);
  }

  async cancelWorkflow(input, options) {
    const journalId = requireNonEmptyString(input.journalId, "journalId");
    const workflowRunId = requireNonEmptyString(input.workflowRunId, "workflowRunId");
    const reason = normalizeOptionalString(input.reason);
    return this.sendControl({
      version: PROTOCOL_VERSION,
      operation: "workflow.cancel",
      binding: {
        agentRunId: workflowRunId,
        workflow: { journalId, workflowRunId },
      },
      ...(reason ? { reason } : {}),
    }, options);
  }

  async respondPermission(input, options) {
    const agentRunId = requireNonEmptyString(input.agentRunId, "agentRunId");
    const toolCallId = requireNonEmptyString(input.toolCallId, "toolCallId");
    const worktreeId = normalizeOptionalString(input.worktreeId);
    if (input.worktreeId !== undefined && !worktreeId) {
      throw new Error("worktreeId must be a non-empty string when provided.");
    }
    if (input.decision !== "allow" && input.decision !== "deny") {
      throw new Error("decision must be allow or deny.");
    }
    return this.sendControl({
      version: PROTOCOL_VERSION,
      operation: "permission.respond",
      binding: {
        agentRunId,
        ...(worktreeId ? { worktreeId } : {}),
      },
      toolCallId,
      decision: input.decision,
    }, options);
  }

  async subscribeConversation(input, options) {
    const conversationId = requireNonEmptyString(input.conversationId, "conversationId");
    const agentRunId = requireNonEmptyString(input.agentRunId, "agentRunId");
    const cursor = normalizeCursor(input.cursor);
    if (input.cursor !== undefined && cursor === undefined) {
      throw new Error("cursor must be a non-negative safe integer.");
    }
    return this.sendRequest("subscription", {
      version: PROTOCOL_VERSION,
      type: "subscription.request",
      subscription: {
        version: PROTOCOL_VERSION,
        binding: { conversationId, agentRunId },
        ...(cursor === undefined ? {} : { cursor }),
      },
    }, "Belldandy coding-run subscription timed out.", options);
  }

  async requestConversation(input, options) {
    const text = requireConversationText(input.text);
    const cwd = requireAbsolutePath(input.cwd, "cwd");
    const conversationId = normalizeConversationIdentifier(input.conversationId);
    if (input.conversationId !== undefined && !conversationId) {
      throw new Error("conversationId must be a non-empty identifier when provided.");
    }
    return this.sendRequest("conversation", {
      version: PROTOCOL_VERSION,
      type: "conversation.request",
      conversation: {
        version: PROTOCOL_VERSION,
        text,
        cwd,
        ...(conversationId ? { conversationId } : {}),
      },
    }, "Belldandy coding-run Conversation request timed out.", options);
  }

  async listTaskProjections(input = {}, options) {
    const projection = normalizeProjectionRequest(input);
    return this.sendRequest("projection", {
      version: PROTOCOL_VERSION,
      type: "projection.request",
      projection,
    }, "Belldandy task projection request timed out.", options);
  }

  async readArtifact(input, options) {
    const agentRunId = requireNonEmptyString(input.agentRunId, "agentRunId");
    const workspaceId = normalizeOptionalString(input.workspaceId);
    if (input.workspaceId !== undefined && !workspaceId) {
      throw new Error("workspaceId must be a non-empty string when provided.");
    }
    return this.sendRequest("artifact", {
      version: PROTOCOL_VERSION,
      type: "artifact.request",
      artifact: {
        revisionId: agentRunId,
        ...(workspaceId ? { workspaceId } : {}),
      },
    }, "Belldandy coding-run artifact request timed out.", options);
  }

  async sendControl(control, options) {
    return this.sendRequest("control", {
      version: PROTOCOL_VERSION,
      type: "control.request",
      control,
    }, "Belldandy coding-run control timed out.", options);
  }

  async sendRequest(kind, frame, timeoutMessage, options = {}) {
    if (options.signal?.aborted) throw requestAbortedError();
    await this.start();
    if (options.signal?.aborted) throw requestAbortedError();
    const child = this.child;
    if (!child) throw new CodingRunStdioClientError("client_closed", "Belldandy coding-run bridge is not running.");
    if (this.pending.size >= this.maxPendingRequests) {
      throw new CodingRunStdioClientError("backpressure", "Belldandy coding-run client backpressure limit reached.");
    }
    const id = this.createUniqueRequestId();
    const response = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.rejectRequest(id, new CodingRunStdioClientError("request_timeout", timeoutMessage));
      }, normalizeRequestTimeout(options.timeoutMs, this.requestTimeoutMs));
      const abortListener = options.signal
        ? () => this.rejectRequest(id, requestAbortedError())
        : undefined;
      this.pending.set(id, { kind, resolve, reject, timeout, signal: options.signal, abortListener });
      options.signal?.addEventListener("abort", abortListener, { once: true });
      if (options.signal?.aborted) abortListener();
    });
    if (!this.pending.has(id)) return response;
    try {
      await writeLine(child.stdin, JSON.stringify({
        ...frame,
        id,
      }));
    } catch (error) {
      this.rejectRequest(id, new CodingRunStdioClientError(
        "transport_error",
        `Could not write coding-run request: ${safeMessage(error)}`,
      ));
    }
    return response;
  }

  consumeStdout(chunk) {
    this.stdoutBuffer += chunk;
    let newline = this.stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const raw = this.stdoutBuffer.slice(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      if (Buffer.byteLength(line, "utf8") > this.maxFrameBytes) {
        this.notifyProtocolError("frame_too_large", "NDJSON frame exceeds the configured byte limit.");
      } else {
        this.consumeFrame(line);
      }
      newline = this.stdoutBuffer.indexOf("\n");
    }
    if (Buffer.byteLength(this.stdoutBuffer, "utf8") > this.maxFrameBytes) {
      this.stdoutBuffer = "";
      this.notifyProtocolError("frame_too_large", "NDJSON frame exceeds the configured byte limit.");
    }
  }

  consumeFrame(line) {
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      this.notifyProtocolError("invalid_frame", "Invalid coding run NDJSON frame.");
      return;
    }
    if (!frame || typeof frame !== "object" || Array.isArray(frame) || frame.version !== PROTOCOL_VERSION) {
      this.notifyProtocolError("invalid_frame", "Invalid coding run NDJSON frame.");
      return;
    }
    if (frame.type === "event" && isAgentRunEvent(frame.event)) {
      try {
        this.onEvent?.(frame.event);
      } catch {
        // UI event consumer failure cannot corrupt control response processing.
      }
      return;
    }
    if (frame.type === "subscription.error" && isSubscriptionErrorFrame(frame)) {
      try {
        this.onSubscriptionError?.({
          code: frame.code,
          message: safeMessage(frame.message),
          binding: { ...frame.binding },
        });
      } catch {
        // UI notification failures cannot corrupt the ongoing stdio bridge.
      }
      return;
    }
    const responseKind = frame.type === "control.response"
      ? "control"
      : frame.type === "subscription.response"
        ? "subscription"
      : frame.type === "conversation.response"
          ? "conversation"
          : frame.type === "projection.response"
            ? "projection"
            : frame.type === "artifact.response"
              ? "artifact"
          : undefined;
    if (!responseKind || !isResponseFrame(frame, responseKind)) {
      this.notifyProtocolError("invalid_frame", "Invalid coding run NDJSON frame.");
      return;
    }
    const pending = this.pending.get(frame.id);
    if (!pending || pending.kind !== responseKind) return;
    this.takePending(frame.id);
    if (frame.ok) {
      pending.resolve({ ok: true, ...(Object.prototype.hasOwnProperty.call(frame, "result") ? { result: frame.result } : {}) });
      return;
    }
    pending.resolve({
      ok: false,
      error: { code: frame.error.code, message: safeMessage(frame.error.message) },
    });
  }

  handleProcessFailure(error) {
    this.child = undefined;
    this.transition("error");
    this.rejectPending(new CodingRunStdioClientError(
      "transport_error",
      `Belldandy coding-run bridge failed: ${safeMessage(error)}`,
    ));
  }

  handleExit(signal) {
    const hadChild = this.child;
    this.child = undefined;
    if (hadChild) {
      this.transition("stopped");
      this.rejectPending(new CodingRunStdioClientError(
        "client_closed",
        signal ? "Belldandy coding-run bridge was interrupted." : "Belldandy coding-run bridge exited.",
      ));
    }
  }

  createUniqueRequestId() {
    for (;;) {
      const id = String(this.createRequestId()).trim();
      if (id && !this.pending.has(id)) return id;
    }
  }

  rejectRequest(id, error) {
    const pending = this.takePending(id);
    if (!pending) return;
    pending.reject(error);
  }

  rejectPending(error) {
    for (const id of Array.from(this.pending.keys())) {
      const pending = this.takePending(id);
      pending?.reject(error);
    }
  }

  takePending(id) {
    const pending = this.pending.get(id);
    if (!pending) return undefined;
    this.pending.delete(id);
    clearTimeout(pending.timeout);
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener("abort", pending.abortListener);
    }
    return pending;
  }

  notifyProtocolError(code, message) {
    this.onProtocolError?.({ code, message });
  }

  transition(nextState) {
    if (this.currentState === nextState) return;
    this.currentState = nextState;
    this.onStateChange?.(nextState);
  }
}

function writeLine(stream, frame) {
  return new Promise((resolve, reject) => {
    const line = `${frame}\n`;
    try {
      if (stream.write(line)) {
        resolve();
        return;
      }
      stream.once("drain", resolve);
      stream.once("error", reject);
    } catch (error) {
      reject(error);
    }
  });
}

function requireNonEmptyString(value, field) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || /[\u0000-\u001f\u007f]/.test(normalized)) return undefined;
  return normalized;
}

function normalizeCursor(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function requireConversationText(value) {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_CONVERSATION_TEXT_CHARS || value.includes("\u0000")) {
    throw new Error("text must be a non-empty prompt within the supported size limit.");
  }
  return value;
}

function requireAbsolutePath(value, field) {
  const normalized = normalizeOptionalString(value);
  if (!normalized || !path.isAbsolute(normalized)) {
    throw new Error(`${field} must be an absolute path.`);
  }
  return path.resolve(normalized);
}

function normalizeConversationIdentifier(value) {
  const normalized = normalizeOptionalString(value);
  if (!normalized || normalized.length > MAX_CONVERSATION_IDENTIFIER_CHARS) return undefined;
  return normalized;
}

function normalizeProjectionRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CodingRunStdioClientError("invalid_request", "Task projection request must be an object.");
  }
  const keys = Object.keys(input);
  if (keys.some((key) => key !== "limit" && key !== "cursor")) {
    throw new CodingRunStdioClientError("invalid_request", "Task projection request contains unsupported fields.");
  }
  const projection = {};
  if (input.limit !== undefined) {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new Error("limit must be an integer between 1 and 100.");
    }
    projection.limit = input.limit;
  }
  if (input.cursor !== undefined) {
    if (!isProjectionCursor(input.cursor)) {
      throw new Error("cursor must contain epoch, revision, and offset.");
    }
    projection.cursor = { ...input.cursor, epoch: input.cursor.epoch.trim() };
  }
  return projection;
}

function isProjectionCursor(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every((key) => ["epoch", "revision", "offset"].includes(key))
    && typeof value.epoch === "string" && normalizeOptionalString(value.epoch)
    && Number.isSafeInteger(value.revision) && value.revision >= 0
    && Number.isSafeInteger(value.offset) && value.offset >= 0;
}

function isProjectionPage(value) {
  return isTaskProjectionCollectionPage(value);
}

function isAgentRunEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value;
  return hasOnlyKeys(event, ["version", "seq", "timestampMs", "source", "binding", "type", "payload"])
    && event.version === PROTOCOL_VERSION
    && Number.isSafeInteger(event.seq)
    && event.seq >= 1
    && Number.isSafeInteger(event.timestampMs)
    && event.timestampMs >= 0
    && ["conversation", "goal", "workflow", "subtask"].includes(event.source)
    && [
      "run.started", "run.status", "message.delta", "tool.started", "tool.completed",
      "permission.requested", "run.usage", "run.budget_exhausted", "run.cancelled",
      "run.interrupted", "run.completed", "run.failed",
    ].includes(event.type)
    && event.binding
    && typeof event.binding === "object"
    && !Array.isArray(event.binding)
    && typeof event.binding.conversationId === "string"
    && typeof event.binding.agentRunId === "string"
    && event.payload
    && typeof event.payload === "object"
    && !Array.isArray(event.payload);
}

function isSubscriptionErrorFrame(value) {
  return value
    && typeof value === "object"
    && !Array.isArray(value)
    && hasOnlyKeys(value, ["version", "type", "code", "message", "binding"])
    && value.version === PROTOCOL_VERSION
    && value.type === "subscription.error"
    && isDeclaredSubscriptionErrorCode(value.code)
    && typeof value.message === "string"
    && value.binding
    && typeof value.binding === "object"
    && typeof value.binding.conversationId === "string"
    && typeof value.binding.agentRunId === "string";
}

function safeMessage(value) {
  const text = value instanceof Error ? value.message : String(value ?? "");
  return text
    .replace(
      /\b((?:api[_-]?key|access[_-]?token|token|secret|password|authorization|cookie|session)[\w-]*)\s*([:=])\s*(?:Bearer\s+)?[^\s,;]+/gi,
      "$1$2[REDACTED]",
    )
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, MAX_ERROR_MESSAGE_CHARS) || "Unknown error.";
}

function normalizeRequestTimeout(value, fallback) {
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : fallback;
}

function requestAbortedError() {
  return new CodingRunStdioClientError("request_aborted", "Belldandy coding-run request was aborted.");
}

function hasOnlyKeys(value, keys) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isResponseFrame(frame, responseKind) {
  if (typeof frame.id !== "string" || !frame.id.trim() || typeof frame.ok !== "boolean") return false;
  if (frame.ok) {
    return hasOnlyKeys(frame, ["version", "type", "id", "ok", "result"])
      && (responseKind !== "projection" || frame.result === undefined || isProjectionPage(frame.result));
  }
  return hasOnlyKeys(frame, ["version", "type", "id", "ok", "error"])
    && frame.error
    && typeof frame.error === "object"
    && !Array.isArray(frame.error)
    && hasOnlyKeys(frame.error, ["code", "message"])
    && (responseKind === "subscription"
      ? isDeclaredSubscriptionErrorCode(frame.error.code)
      : isDeclaredErrorCode(frame.error.code))
    && typeof frame.error.message === "string";
}

function isDeclaredSubscriptionErrorCode(value) {
  return value === "cursor_expired" || isDeclaredErrorCode(value);
}

function isDeclaredErrorCode(value) {
  return [
    "invalid_request", "not_found", "run_mismatch", "not_active", "permission_required",
    "permission_denied", "policy_denied", "budget_exhausted", "cancelled", "interrupted",
    "output_schema_invalid", "gateway_unavailable", "invalid_limit", "cursor_stale",
    "cursor_future", "cursor_out_of_range", "internal",
  ].includes(value);
}

module.exports = { CodingRunStdioClient, CodingRunStdioClientError };
