import crypto from "node:crypto";

export const SUBTASK_COMMAND_KINDS = ["steering", "resume", "takeover", "stop"] as const;

export type SubTaskCommandKind = typeof SUBTASK_COMMAND_KINDS[number];

export type SubTaskCommandClaim = {
  kind: SubTaskCommandKind;
  commandId: string;
  generation: number;
  idempotencyKey: string;
  ownerInstanceId: string;
  requestedAt: number;
  requestedSessionId?: string;
};

type SubTaskCommandClaimTarget = {
  status: string;
  archivedAt?: number;
  sessionId?: string;
  commandGeneration?: number;
  activeCommandClaim?: SubTaskCommandClaim;
};

export type SubTaskCommandClaimRejectionCode =
  | "invalid_claim"
  | "command_pending"
  | "invalid_state"
  | "revision_conflict";

type ClaimAttempt =
  | { status: "claimed"; claim: SubTaskCommandClaim }
  | { status: "replayed"; claim: SubTaskCommandClaim }
  | { status: "rejected"; code: SubTaskCommandClaimRejectionCode; reason: string };

export class SubTaskCommandClaimError extends Error {
  constructor(
    message: string,
    readonly code: SubTaskCommandClaimRejectionCode = "invalid_state",
  ) {
    super(message);
    this.name = "SubTaskCommandClaimError";
  }
}

function isTerminalStatus(status: string): boolean {
  return status === "done" || status === "error" || status === "timeout" || status === "stopped";
}

function normalizeOptionalString(value: unknown, maxLength = 160): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

/**
 * command claim 只保存稳定哈希，不把可重复请求的全文额外复制进运行态 registry。
 */
export function createSubTaskCommandIdempotencyKey(input: {
  taskId: string;
  kind: SubTaskCommandKind;
  message: string;
  sessionId?: string;
  agentId?: string;
  mode?: string;
}): string {
  const payload = JSON.stringify([
    input.taskId,
    input.kind,
    input.sessionId ?? "",
    input.agentId ?? "",
    input.mode ?? "",
    input.message,
  ]);
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

export function normalizeSubTaskCommandClaim(value: unknown): SubTaskCommandClaim | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const kind = SUBTASK_COMMAND_KINDS.find((candidate) => candidate === source.kind);
  const commandId = normalizeOptionalString(source.commandId);
  const idempotencyKey = normalizeOptionalString(source.idempotencyKey);
  const ownerInstanceId = normalizeOptionalString(source.ownerInstanceId);
  const generation = Number(source.generation);
  if (!kind || !commandId || !idempotencyKey || !ownerInstanceId || !Number.isInteger(generation) || generation < 1) {
    return undefined;
  }
  return {
    kind,
    commandId,
    generation,
    idempotencyKey,
    ownerInstanceId,
    requestedAt: Number.isFinite(Number(source.requestedAt)) ? Number(source.requestedAt) : Date.now(),
    requestedSessionId: normalizeOptionalString(source.requestedSessionId),
  };
}

/**
 * 在 Store 的既有串行 mutation 内验证状态并预留唯一 command owner。
 * 相同 idempotency key 复用原 claim；不同命令必须等待当前交接完成。
 */
export function claimSubTaskCommand(
  target: SubTaskCommandClaimTarget,
  input: {
    kind: SubTaskCommandKind;
    commandId: string;
    idempotencyKey: string;
    ownerInstanceId: string;
    requestedAt: number;
    expectedSessionId?: string;
    expectedRevision?: number;
    takeoverMode?: "safe_point" | "resume_relaunch";
  },
): ClaimAttempt {
  const commandId = normalizeOptionalString(input.commandId);
  const idempotencyKey = normalizeOptionalString(input.idempotencyKey);
  const ownerInstanceId = normalizeOptionalString(input.ownerInstanceId);
  if (!commandId || !idempotencyKey || !ownerInstanceId) {
    return {
      status: "rejected",
      code: "invalid_claim",
      reason: "Subtask command claim requires a valid idempotency key.",
    };
  }

  const active = target.activeCommandClaim;
  if (active) {
    if (active.kind === input.kind && active.idempotencyKey === idempotencyKey) {
      return { status: "replayed", claim: active };
    }
    return {
      status: "rejected",
      code: "command_pending",
      reason: `Subtask command ${active.kind} is already pending.`,
    };
  }

  const currentRevision = Math.max(0, Math.floor(Number(target.commandGeneration) || 0));
  if (input.expectedRevision !== undefined) {
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
      return {
        status: "rejected",
        code: "invalid_claim",
        reason: "Subtask command expectedRevision must be a non-negative integer.",
      };
    }
    if (input.expectedRevision !== currentRevision) {
      return {
        status: "rejected",
        code: "revision_conflict",
        reason: `Subtask command revision conflict. Expected ${input.expectedRevision}, current ${currentRevision}.`,
      };
    }
  }
  if (target.archivedAt) {
    return {
      status: "rejected",
      code: "invalid_state",
      reason: "Archived subtasks cannot accept commands.",
    };
  }

  const expectedSessionId = normalizeOptionalString(input.expectedSessionId);
  if (input.kind === "steering") {
    if (target.status !== "running" || !target.sessionId || target.sessionId !== expectedSessionId) {
      return {
        status: "rejected",
        code: "invalid_state",
        reason: `Subtask steering only supports the current running session. Current status: ${target.status}`,
      };
    }
  } else if (input.kind === "resume") {
    if (!isTerminalStatus(target.status)) {
      return {
        status: "rejected",
        code: "invalid_state",
        reason: `Subtask resume only supports finished tasks. Current status: ${target.status}`,
      };
    }
    if (expectedSessionId && target.sessionId !== expectedSessionId) {
      return {
        status: "rejected",
        code: "invalid_state",
        reason: "Subtask resume target session changed before claim.",
      };
    }
  } else if (input.kind === "stop") {
    if (isTerminalStatus(target.status)) {
      return {
        status: "rejected",
        code: "invalid_state",
        reason: `Subtask stop only supports active tasks. Current status: ${target.status}`,
      };
    }
    if (expectedSessionId && target.sessionId !== expectedSessionId) {
      return {
        status: "rejected",
        code: "invalid_state",
        reason: "Subtask stop target session changed before claim.",
      };
    }
  } else if (input.takeoverMode === "safe_point") {
    if (target.status !== "running" || !target.sessionId || target.sessionId !== expectedSessionId) {
      return {
        status: "rejected",
        code: "invalid_state",
        reason: `Safe-point takeover only supports the current running session. Current status: ${target.status}`,
      };
    }
  } else if (!isTerminalStatus(target.status)) {
    return {
      status: "rejected",
      code: "invalid_state",
      reason: `Subtask takeover only supports running or finished tasks. Current status: ${target.status}`,
    };
  }

  const generation = currentRevision + 1;
  const claim: SubTaskCommandClaim = {
    kind: input.kind,
    commandId,
    generation,
    idempotencyKey,
    ownerInstanceId,
    requestedAt: input.requestedAt,
    requestedSessionId: expectedSessionId,
  };
  target.commandGeneration = generation;
  target.activeCommandClaim = claim;
  return { status: "claimed", claim };
}

export function isSubTaskCommandClaimOwner(
  target: SubTaskCommandClaimTarget,
  claim: SubTaskCommandClaim | undefined,
): boolean {
  if (!claim || !target.activeCommandClaim) return false;
  const active = target.activeCommandClaim;
  return active.kind === claim.kind
    && active.commandId === claim.commandId
    && active.generation === claim.generation;
}

/**
 * onSessionCreated 与 delivered 标记是两个独立异步回调。只要还处于同一 generation，
 * 即使 delivered 已先释放 active claim，owner 的迟到 attach/queue 回调仍可完成交接。
 */
export function isSubTaskCommandGenerationCurrent(
  target: SubTaskCommandClaimTarget,
  claim: SubTaskCommandClaim | undefined,
): boolean {
  if (!claim || target.commandGeneration !== claim.generation) return false;
  return !target.activeCommandClaim || isSubTaskCommandClaimOwner(target, claim);
}

export function releaseSubTaskCommandClaim(
  target: SubTaskCommandClaimTarget,
  kind: SubTaskCommandKind,
  commandId: string,
): boolean {
  const active = target.activeCommandClaim;
  if (!active || active.kind !== kind || active.commandId !== commandId) {
    return false;
  }
  target.activeCommandClaim = undefined;
  return true;
}
