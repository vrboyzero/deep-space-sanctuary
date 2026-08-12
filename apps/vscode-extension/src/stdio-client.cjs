const { randomUUID } = require("node:crypto");
const { spawn: spawnChildProcess } = require("node:child_process");
const path = require("node:path");

const PROTOCOL_VERSION = "v1";
const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_ERROR_MESSAGE_CHARS = 512;
const MAX_CONVERSATION_TEXT_CHARS = 64_000;
const MAX_CONVERSATION_IDENTIFIER_CHARS = 256;

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
      throw new Error(`Could not start the Belldandy coding-run bridge: ${safeMessage(error)}`);
    }
    if (!child?.stdin || !child.stdout || !child.stderr) {
      this.transition("error");
      throw new Error("Belldandy coding-run bridge did not expose stdio streams.");
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
    this.rejectPending("Belldandy coding-run bridge was stopped.");
  }

  async cancelConversation(input) {
    const conversationId = requireNonEmptyString(input.conversationId, "conversationId");
    const agentRunId = requireNonEmptyString(input.agentRunId, "agentRunId");
    const reason = normalizeOptionalString(input.reason);
    return this.sendControl({
      version: PROTOCOL_VERSION,
      operation: "cancel",
      binding: { conversationId, agentRunId },
      ...(reason ? { reason } : {}),
    });
  }

  async cancelWorkflow(input) {
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
    });
  }

  async respondPermission(input) {
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
    });
  }

  async subscribeConversation(input) {
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
    }, "Belldandy coding-run subscription timed out.");
  }

  async requestConversation(input) {
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
    }, "Belldandy coding-run Conversation request timed out.");
  }

  async listTaskProjections(input = {}) {
    const projection = normalizeProjectionRequest(input);
    return this.sendRequest("projection", {
      version: PROTOCOL_VERSION,
      type: "projection.request",
      projection,
    }, "Belldandy task projection request timed out.");
  }

  async sendControl(control) {
    return this.sendRequest("control", {
      version: PROTOCOL_VERSION,
      type: "control.request",
      control,
    }, "Belldandy coding-run control timed out.");
  }

  async sendRequest(kind, frame, timeoutMessage) {
    await this.start();
    const child = this.child;
    if (!child) throw new Error("Belldandy coding-run bridge is not running.");
    const id = this.createUniqueRequestId();
    const response = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(timeoutMessage));
      }, this.requestTimeoutMs);
      this.pending.set(id, { kind, resolve, reject, timeout });
    });
    try {
      await writeLine(child.stdin, JSON.stringify({
        ...frame,
        id,
      }));
    } catch (error) {
      this.rejectRequest(id, `Could not write coding-run request: ${safeMessage(error)}`);
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
          : undefined;
    if (!responseKind || typeof frame.id !== "string" || typeof frame.ok !== "boolean"
      || (responseKind === "projection" && frame.ok === true && frame.result !== undefined && !isProjectionPage(frame.result))) {
      this.notifyProtocolError("invalid_frame", "Invalid coding run NDJSON frame.");
      return;
    }
    const pending = this.pending.get(frame.id);
    if (!pending || pending.kind !== responseKind) return;
    this.pending.delete(frame.id);
    clearTimeout(pending.timeout);
    if (frame.ok) {
      pending.resolve({ ok: true, ...(Object.prototype.hasOwnProperty.call(frame, "result") ? { result: frame.result } : {}) });
      return;
    }
    if (!frame.error || typeof frame.error !== "object" || typeof frame.error.code !== "string" || typeof frame.error.message !== "string") {
      pending.resolve({ ok: false, error: { code: "internal", message: "Invalid coding-run error response." } });
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
    this.rejectPending(`Belldandy coding-run bridge failed: ${safeMessage(error)}`);
  }

  handleExit(signal) {
    const hadChild = this.child;
    this.child = undefined;
    if (hadChild) {
      this.transition("stopped");
      this.rejectPending(signal ? "Belldandy coding-run bridge was interrupted." : "Belldandy coding-run bridge exited.");
    }
  }

  createUniqueRequestId() {
    for (;;) {
      const id = String(this.createRequestId()).trim();
      if (id && !this.pending.has(id)) return id;
    }
  }

  rejectRequest(id, message) {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timeout);
    pending.reject(new Error(message));
  }

  rejectPending(message) {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
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
    throw new Error("Task projection request must be an object.");
  }
  const keys = Object.keys(input);
  if (keys.some((key) => key !== "limit" && key !== "cursor")) {
    throw new Error("Task projection request contains unsupported fields.");
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
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !["epoch", "revision", "totalCount", "items", "nextCursor"].includes(key))
    || typeof value.epoch !== "string" || !normalizeOptionalString(value.epoch)
    || !Number.isSafeInteger(value.revision) || value.revision < 0
    || !Number.isSafeInteger(value.totalCount) || value.totalCount < 0
    || !Array.isArray(value.items) || value.items.length > 100) return false;
  if (value.nextCursor !== undefined) {
    if (!isProjectionCursor(value.nextCursor)
      || value.nextCursor.epoch.trim() !== value.epoch.trim()
      || value.nextCursor.revision !== value.revision
      || value.nextCursor.offset <= 0
      || value.nextCursor.offset >= value.totalCount) return false;
  }
  return true;
}

function isAgentRunEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value;
  return event.version === PROTOCOL_VERSION
    && Number.isSafeInteger(event.seq)
    && event.seq >= 1
    && typeof event.type === "string"
    && event.binding
    && typeof event.binding === "object"
    && typeof event.binding.conversationId === "string"
    && typeof event.binding.agentRunId === "string";
}

function isSubscriptionErrorFrame(value) {
  return value
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof value.code === "string"
    && typeof value.message === "string"
    && value.binding
    && typeof value.binding === "object"
    && typeof value.binding.conversationId === "string"
    && typeof value.binding.agentRunId === "string";
}

function safeMessage(value) {
  const text = value instanceof Error ? value.message : String(value ?? "");
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_ERROR_MESSAGE_CHARS) || "Unknown error.";
}

module.exports = { CodingRunStdioClient };
