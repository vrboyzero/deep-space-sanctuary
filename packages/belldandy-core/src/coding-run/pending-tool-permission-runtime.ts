import {
  sanitizeCommandPermissionPreview,
  type PendingToolPermissionRequest,
  type ToolPermissionController,
} from "@belldandy/skills";

const DEFAULT_PERMISSION_TIMEOUT_MS = 60_000;
const MAX_PENDING_PERMISSION_SNAPSHOTS = 100;

type PendingPermissionRecord = {
  conversationId: string;
  agentRunId: string;
  worktreeId?: string;
  toolCallId: string;
  toolName: string;
  commandPreview?: PendingToolPermissionRequest["commandPreview"];
  resolve: (decision: "allow" | "deny") => void;
  timeout: NodeJS.Timeout;
  abortSignal?: AbortSignal;
  abortHandler?: () => void;
};

type ResolvedPermissionRecord = Pick<
  PendingPermissionRecord,
  "agentRunId" | "worktreeId" | "toolCallId"
> & {
  decision: "allow" | "deny";
};

export type PendingToolPermissionResponderKind = "human" | "automatic" | "unknown";

export type PendingToolPermissionSettlement = Pick<
  PendingPermissionRecord,
  "conversationId" | "agentRunId" | "worktreeId" | "toolCallId"
> & {
  decision: "allow" | "deny";
  responderKind: PendingToolPermissionResponderKind;
  reason: "response" | "timeout" | "abort" | "cancel";
};

export type PendingToolPermissionResponse = {
  agentRunId: string;
  worktreeId?: string;
  toolCallId: string;
  decision: "allow" | "deny";
  responderKind?: PendingToolPermissionResponderKind;
};

export type PendingToolPermissionSnapshot = Pick<
  PendingPermissionRecord,
  "conversationId" | "agentRunId" | "worktreeId" | "toolCallId" | "toolName"
> & {
  commandPreview?: Omit<NonNullable<PendingToolPermissionRequest["commandPreview"]>, "kind">;
};

export type PendingToolPermissionResponseResult =
  | { ok: true; accepted: true; alreadyResolved?: true }
  | { ok: false; code: "not_found" | "run_mismatch" | "permission_denied" };

/**
 * 仅保存活动 worker 的一次性工具审批，不拥有 Conversation 或 ToolExecutor 状态。
 * 超时、取消和所有不匹配响应统一 deny，避免 pending 请求扩大为跨运行授权。
 */
export class PendingToolPermissionRuntime implements ToolPermissionController {
  private readonly timeoutMs: number;
  private readonly pending = new Map<string, PendingPermissionRecord>();
  private readonly byToolCallId = new Map<string, PendingPermissionRecord>();
  private readonly resolved = new Map<string, ResolvedPermissionRecord>();
  private readonly seen = new Set<string>();

  constructor(private readonly options: {
    timeoutMs?: number;
    onRequested?: (request: Omit<PendingToolPermissionRequest, "abortSignal">) => void;
    onSettled?: (settlement: PendingToolPermissionSettlement) => void;
  } = {}) {
    this.timeoutMs = normalizeTimeout(options.timeoutMs);
  }

  request(input: PendingToolPermissionRequest): Promise<"allow" | "deny"> {
    const request = normalizeRequest(input);
    if (!request) return Promise.resolve("deny");
    const key = toKey(request.agentRunId, request.toolCallId);
    if (this.seen.has(key)) return Promise.resolve("deny");
    if (request.abortSignal?.aborted) return Promise.resolve("deny");

    this.seen.add(key);
    return new Promise<"allow" | "deny">((resolve) => {
      const record: PendingPermissionRecord = {
        ...request,
        resolve,
        timeout: setTimeout(() => this.settle(record, "deny", "automatic", "timeout"), this.timeoutMs),
      };
      if (request.abortSignal) {
        record.abortSignal = request.abortSignal;
        record.abortHandler = () => this.settle(record, "deny", "automatic", "abort");
        request.abortSignal.addEventListener("abort", record.abortHandler, { once: true });
      }
      this.pending.set(key, record);
      this.byToolCallId.set(record.toolCallId, record);
      try {
        this.options.onRequested?.({
          conversationId: record.conversationId,
          agentRunId: record.agentRunId,
          ...(record.worktreeId ? { worktreeId: record.worktreeId } : {}),
          toolCallId: record.toolCallId,
          toolName: record.toolName,
          ...(record.commandPreview ? { commandPreview: record.commandPreview } : {}),
        });
      } catch {
        // 事件转发故障会由固定超时关闭，不可绕过审批。
      }
    });
  }

  list(): PendingToolPermissionSnapshot[] {
    return [...this.pending.values()]
      .slice(0, MAX_PENDING_PERMISSION_SNAPSHOTS)
      .map((record) => {
        const safePreview = sanitizeCommandPermissionPreview(record.commandPreview);
        const commandPreview = safePreview
          ? (({ kind: _kind, ...preview }) => preview)(safePreview)
          : undefined;
        return {
          conversationId: record.conversationId,
          agentRunId: record.agentRunId,
          ...(record.worktreeId ? { worktreeId: record.worktreeId } : {}),
          toolCallId: record.toolCallId,
          toolName: record.toolName,
          ...(commandPreview ? { commandPreview } : {}),
        };
      });
  }

  respond(input: PendingToolPermissionResponse): PendingToolPermissionResponseResult {
    const response = normalizeResponse(input);
    if (!response) return { ok: false, code: "not_found" };
    const key = toKey(response.agentRunId, response.toolCallId);
    const pending = this.pending.get(key);
    if (pending) {
      if (!matchesResponse(pending, response)) return { ok: false, code: "run_mismatch" };
      this.settle(pending, response.decision, response.responderKind ?? "unknown", "response");
      return { ok: true, accepted: true };
    }

    const sameToolCall = this.byToolCallId.get(response.toolCallId);
    if (sameToolCall && !matchesResponse(sameToolCall, response)) {
      return { ok: false, code: "run_mismatch" };
    }
    const resolved = this.resolved.get(key);
    if (!resolved) return { ok: false, code: "not_found" };
    if (!matchesResponse(resolved, response)) return { ok: false, code: "run_mismatch" };
    if (resolved.decision !== response.decision) return { ok: false, code: "permission_denied" };
    return { ok: true, accepted: true, alreadyResolved: true };
  }

  cancelRun(agentRunId: string): void {
    const normalizedRunId = normalizeString(agentRunId);
    if (!normalizedRunId) return;
    for (const record of [...this.pending.values()]) {
      if (record.agentRunId === normalizedRunId) this.settle(record, "deny", "automatic", "cancel");
    }
    for (const [key, record] of this.resolved) {
      if (record.agentRunId === normalizedRunId) this.resolved.delete(key);
    }
    for (const key of [...this.seen]) {
      if (key.startsWith(`${normalizedRunId}\u0000`)) this.seen.delete(key);
    }
  }

  private settle(
    record: PendingPermissionRecord,
    decision: "allow" | "deny",
    responderKind: PendingToolPermissionResponderKind,
    reason: PendingToolPermissionSettlement["reason"],
  ): void {
    const key = toKey(record.agentRunId, record.toolCallId);
    if (this.pending.get(key) !== record) return;
    this.pending.delete(key);
    if (this.byToolCallId.get(record.toolCallId) === record) this.byToolCallId.delete(record.toolCallId);
    clearTimeout(record.timeout);
    if (record.abortSignal && record.abortHandler) {
      record.abortSignal.removeEventListener("abort", record.abortHandler);
    }
    this.resolved.set(key, {
      agentRunId: record.agentRunId,
      ...(record.worktreeId ? { worktreeId: record.worktreeId } : {}),
      toolCallId: record.toolCallId,
      decision,
    });
    try {
      this.options.onSettled?.({
        conversationId: record.conversationId,
        agentRunId: record.agentRunId,
        ...(record.worktreeId ? { worktreeId: record.worktreeId } : {}),
        toolCallId: record.toolCallId,
        decision,
        responderKind,
        reason,
      });
    } catch {
      // 观测回调不能改变审批决定或阻塞 worker 收敛。
    }
    record.resolve(decision);
  }
}

function normalizeRequest(input: PendingToolPermissionRequest): Omit<PendingPermissionRecord, "resolve" | "timeout" | "abortHandler"> | undefined {
  const conversationId = normalizeString(input.conversationId);
  const agentRunId = normalizeString(input.agentRunId);
  const toolCallId = normalizeString(input.toolCallId);
  const toolName = normalizeString(input.toolName);
  if (!conversationId || !agentRunId || !toolCallId || !toolName) return undefined;
  const worktreeId = normalizeString(input.worktreeId);
  const commandPreview = isCommandToolName(toolName)
    ? sanitizeCommandPermissionPreview(input.commandPreview)
    : undefined;
  return {
    conversationId,
    agentRunId,
    ...(worktreeId ? { worktreeId } : {}),
    toolCallId,
    toolName,
    ...(commandPreview ? { commandPreview } : {}),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  };
}

function normalizeResponse(input: PendingToolPermissionResponse): PendingToolPermissionResponse | undefined {
  const agentRunId = normalizeString(input.agentRunId);
  const toolCallId = normalizeString(input.toolCallId);
  if (!agentRunId || !toolCallId || (input.decision !== "allow" && input.decision !== "deny")) return undefined;
  const worktreeId = normalizeString(input.worktreeId);
  return {
    agentRunId,
    ...(worktreeId ? { worktreeId } : {}),
    toolCallId,
    decision: input.decision,
    responderKind: input.responderKind === "human"
      || input.responderKind === "automatic"
      || input.responderKind === "unknown"
      ? input.responderKind
      : "unknown",
  };
}

function matchesResponse(
  record: Pick<PendingPermissionRecord, "agentRunId" | "worktreeId" | "toolCallId">,
  response: Pick<PendingToolPermissionResponse, "agentRunId" | "worktreeId" | "toolCallId">,
): boolean {
  return record.agentRunId === response.agentRunId
    && record.toolCallId === response.toolCallId
    && record.worktreeId === response.worktreeId;
}

function normalizeTimeout(value: number | undefined): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : DEFAULT_PERMISSION_TIMEOUT_MS;
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toKey(agentRunId: string, toolCallId: string): string {
  return `${agentRunId}\u0000${toolCallId}`;
}

function isCommandToolName(toolName: string): boolean {
  return toolName === "run_command" || toolName === "command_job";
}
