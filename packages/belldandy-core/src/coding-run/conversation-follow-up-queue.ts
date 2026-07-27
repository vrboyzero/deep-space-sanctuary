import { randomUUID } from "node:crypto";

export type ConversationRunBinding = {
  conversationId: string;
  agentRunId: string;
};

export type ConversationFollowUpStatus = "queued" | "claimed" | "delivered" | "failed";
export type ConversationCommandIntent = "follow_up" | "replace";

export type ConversationFollowUpView = {
  commandId: string;
  intent: ConversationCommandIntent;
  status: ConversationFollowUpStatus;
  sourceBinding: ConversationRunBinding;
  promptChars: number;
  requestedAtMs: number;
  claimedAtMs?: number;
  deliveredAtMs?: number;
  failedAtMs?: number;
  nextBinding?: ConversationRunBinding;
  hasError: boolean;
};

export type ConversationFollowUpEnqueueResult =
  | { ok: true; replayed: boolean; item: ConversationFollowUpView }
  | {
    ok: false;
    code: "invalid_request" | "idempotency_conflict" | "queue_full";
    message: string;
  };

export type ConversationFollowUpClaim = {
  commandId: string;
  queueBinding: ConversationRunBinding;
  prompt: string;
};

type FollowUpCommand = ConversationFollowUpView & {
  prompt: string;
  idempotencyKey: string;
  error?: string;
};

type RunQueue = {
  binding: ConversationRunBinding;
  commands: FollowUpCommand[];
  terminalAtMs?: number;
};

type QueueOptions = {
  maxQueuedPerRun?: number;
  maxTerminalRuns?: number;
  maxPromptChars?: number;
  maxIdempotencyKeyChars?: number;
  createId?: () => string;
  now?: () => number;
};

type FollowUpEnqueueInput = {
  binding: ConversationRunBinding;
  intent?: ConversationCommandIntent;
  prompt: string;
  idempotencyKey: string;
};

type NormalizedFollowUpEnqueueInput = {
  binding: ConversationRunBinding;
  intent: ConversationCommandIntent;
  prompt: string;
  idempotencyKey: string;
};

const DEFAULT_MAX_QUEUED_PER_RUN = 8;
const DEFAULT_MAX_TERMINAL_RUNS = 64;
const DEFAULT_MAX_PROMPT_CHARS = 32_768;
const DEFAULT_MAX_IDEMPOTENCY_KEY_CHARS = 128;

/** In-memory single-owner queue. Prompt content never enters public status views. */
export class ConversationFollowUpQueue {
  private readonly queues = new Map<string, RunQueue>();
  private readonly reservations = new Map<string, { queueRunId: string; commandId: string }>();
  private readonly maxQueuedPerRun: number;
  private readonly maxTerminalRuns: number;
  private readonly maxPromptChars: number;
  private readonly maxIdempotencyKeyChars: number;
  private readonly createId: () => string;
  private readonly now: () => number;

  constructor(options: QueueOptions = {}) {
    this.maxQueuedPerRun = positiveInteger(options.maxQueuedPerRun, DEFAULT_MAX_QUEUED_PER_RUN);
    this.maxTerminalRuns = positiveInteger(options.maxTerminalRuns, DEFAULT_MAX_TERMINAL_RUNS);
    this.maxPromptChars = positiveInteger(options.maxPromptChars, DEFAULT_MAX_PROMPT_CHARS);
    this.maxIdempotencyKeyChars = positiveInteger(
      options.maxIdempotencyKeyChars,
      DEFAULT_MAX_IDEMPOTENCY_KEY_CHARS,
    );
    this.createId = options.createId ?? (() => `conversation_follow_up_${randomUUID()}`);
    this.now = options.now ?? Date.now;
  }

  enqueue(input: FollowUpEnqueueInput): ConversationFollowUpEnqueueResult {
    const normalized = this.normalizeEnqueueInput(input);
    if (!normalized.ok) return normalized.result;
    const { binding, intent, prompt, idempotencyKey } = normalized.value;

    const queue = this.queues.get(binding.agentRunId) ?? { binding, commands: [] };
    if (!matchesBinding(queue.binding, binding)) {
      return failure("invalid_request", "agentRunId is already bound to another Conversation.");
    }
    const existing = queue.commands.find((command) => command.idempotencyKey === idempotencyKey);
    if (existing) {
      if (existing.prompt !== prompt || existing.intent !== intent) {
        return failure(
          "idempotency_conflict",
          "idempotencyKey is already bound to different follow-up content.",
        );
      }
      return { ok: true, replayed: true, item: toView(existing) };
    }
    const pendingCount = queue.commands.filter((command) =>
      command.status === "queued" || command.status === "claimed"
    ).length;
    if (pendingCount >= this.maxQueuedPerRun) {
      return failure("queue_full", "Conversation follow-up queue is full for this run.");
    }

    const requestedAtMs = timestamp(this.now());
    const command: FollowUpCommand = {
      commandId: normalizeText(this.createId()) ?? `conversation_follow_up_${randomUUID()}`,
      intent,
      status: "queued",
      sourceBinding: binding,
      prompt,
      promptChars: prompt.length,
      idempotencyKey,
      requestedAtMs,
      hasError: false,
    };
    queue.commands.push(command);
    queue.terminalAtMs = undefined;
    this.queues.set(binding.agentRunId, queue);
    return { ok: true, replayed: false, item: toView(command) };
  }

  replay(input: FollowUpEnqueueInput): ConversationFollowUpEnqueueResult | undefined {
    const normalized = this.normalizeEnqueueInput(input);
    if (!normalized.ok) return normalized.result;
    const { binding, intent, prompt, idempotencyKey } = normalized.value;
    const queue = this.queues.get(binding.agentRunId);
    if (!queue || !matchesBinding(queue.binding, binding)) return undefined;
    const existing = queue.commands.find((command) => command.idempotencyKey === idempotencyKey);
    if (!existing) return undefined;
    if (existing.prompt !== prompt || existing.intent !== intent) {
      return failure(
        "idempotency_conflict",
        "idempotencyKey is already bound to different follow-up content.",
      );
    }
    return { ok: true, replayed: true, item: toView(existing) };
  }

  hasPending(binding: ConversationRunBinding): boolean {
    const normalizedBinding = normalizeBinding(binding);
    if (!normalizedBinding) return false;
    const queue = this.queues.get(normalizedBinding.agentRunId);
    return Boolean(queue
      && matchesBinding(queue.binding, normalizedBinding)
      && queue.commands.some((command) => command.status === "queued" || command.status === "claimed"));
  }

  getStatus(binding: ConversationRunBinding, commandId: string): ConversationFollowUpView | undefined {
    const normalizedBinding = normalizeBinding(binding);
    const normalizedCommandId = normalizeText(commandId);
    if (!normalizedBinding || !normalizedCommandId) return undefined;
    const queue = this.queues.get(normalizedBinding.agentRunId);
    if (!queue || !matchesBinding(queue.binding, normalizedBinding)) return undefined;
    const command = queue.commands.find((item) => item.commandId === normalizedCommandId);
    return command ? toView(command) : undefined;
  }

  claimNext(input: {
    binding: ConversationRunBinding;
    conversationAvailable: boolean;
  }): ConversationFollowUpClaim | undefined {
    const binding = normalizeBinding(input.binding);
    if (!binding) return undefined;
    const queue = this.queues.get(binding.agentRunId);
    if (!queue || !matchesBinding(queue.binding, binding)) return undefined;
    if (!input.conversationAvailable) {
      this.failRemaining(binding, "Conversation is no longer available for a serial follow-up handoff.");
      return undefined;
    }
    if (this.reservations.has(binding.conversationId)) return undefined;
    const command = queue.commands.find((item) => item.status === "queued");
    if (!command) return undefined;

    command.status = "claimed";
    command.claimedAtMs = timestamp(this.now());
    this.reservations.set(binding.conversationId, {
      queueRunId: binding.agentRunId,
      commandId: command.commandId,
    });
    return {
      commandId: command.commandId,
      queueBinding: { ...binding },
      prompt: command.prompt,
    };
  }

  isRegistrationAllowed(conversationId: string, followUpCommandId?: string): boolean {
    const reservation = this.reservations.get(conversationId);
    if (!reservation) return true;
    return Boolean(followUpCommandId) && reservation.commandId === followUpCommandId;
  }

  markDelivered(input: {
    queueBinding: ConversationRunBinding;
    commandId: string;
    nextBinding: ConversationRunBinding;
  }): boolean {
    const command = this.getCommand(input.queueBinding, input.commandId);
    const nextBinding = normalizeBinding(input.nextBinding);
    if (!command || command.status !== "claimed" || !nextBinding) return false;
    const reservation = this.reservations.get(input.queueBinding.conversationId);
    if (!reservation || reservation.queueRunId !== input.queueBinding.agentRunId
      || reservation.commandId !== input.commandId) return false;
    if (nextBinding.conversationId !== input.queueBinding.conversationId) return false;

    command.status = "delivered";
    command.deliveredAtMs = timestamp(this.now());
    command.nextBinding = { ...nextBinding };
    command.hasError = false;
    command.error = undefined;
    this.reservations.delete(input.queueBinding.conversationId);
    this.markQueueTerminalIfComplete(input.queueBinding.agentRunId);
    return true;
  }

  markFailed(input: {
    queueBinding: ConversationRunBinding;
    commandId: string;
    error: string;
  }): boolean {
    const command = this.getCommand(input.queueBinding, input.commandId);
    if (!command || (command.status !== "claimed" && command.status !== "queued")) return false;
    command.status = "failed";
    command.failedAtMs = timestamp(this.now());
    command.hasError = true;
    command.error = normalizeText(input.error) ?? "Conversation follow-up delivery failed.";
    const reservation = this.reservations.get(input.queueBinding.conversationId);
    if (reservation?.queueRunId === input.queueBinding.agentRunId
      && reservation.commandId === input.commandId) {
      this.reservations.delete(input.queueBinding.conversationId);
    }
    this.markQueueTerminalIfComplete(input.queueBinding.agentRunId);
    return true;
  }

  failRemaining(binding: ConversationRunBinding, error: string): number {
    const queue = this.queues.get(binding.agentRunId);
    if (!queue || !matchesBinding(queue.binding, binding)) return 0;
    let failed = 0;
    for (const command of queue.commands) {
      if (command.status !== "queued" && command.status !== "claimed") continue;
      if (this.markFailed({ queueBinding: binding, commandId: command.commandId, error })) failed++;
    }
    return failed;
  }

  private getCommand(binding: ConversationRunBinding, commandId: string): FollowUpCommand | undefined {
    const normalizedBinding = normalizeBinding(binding);
    const normalizedCommandId = normalizeText(commandId);
    if (!normalizedBinding || !normalizedCommandId) return undefined;
    const queue = this.queues.get(normalizedBinding.agentRunId);
    if (!queue || !matchesBinding(queue.binding, normalizedBinding)) return undefined;
    return queue.commands.find((item) => item.commandId === normalizedCommandId);
  }

  private normalizeEnqueueInput(input: FollowUpEnqueueInput):
    | { ok: true; value: NormalizedFollowUpEnqueueInput }
    | { ok: false; result: ConversationFollowUpEnqueueResult } {
    const binding = normalizeBinding(input.binding);
    const prompt = normalizeText(input.prompt);
    const idempotencyKey = normalizeText(input.idempotencyKey);
    const intent = input.intent ?? "follow_up";
    if (!binding || !prompt || prompt.length > this.maxPromptChars) {
      return {
        ok: false,
        result: failure("invalid_request", `prompt must contain 1-${this.maxPromptChars} characters.`),
      };
    }
    if (!idempotencyKey || idempotencyKey.length > this.maxIdempotencyKeyChars) {
      return {
        ok: false,
        result: failure(
          "invalid_request",
          `idempotencyKey must contain 1-${this.maxIdempotencyKeyChars} characters.`,
        ),
      };
    }
    if (intent !== "follow_up" && intent !== "replace") {
      return { ok: false, result: failure("invalid_request", "follow-up intent is invalid.") };
    }
    return { ok: true, value: { binding, intent, prompt, idempotencyKey } };
  }

  private markQueueTerminalIfComplete(agentRunId: string): void {
    const queue = this.queues.get(agentRunId);
    if (!queue || queue.commands.some((item) => item.status === "queued" || item.status === "claimed")) return;
    queue.terminalAtMs = timestamp(this.now());
    const terminal = [...this.queues.values()]
      .filter((item) => item.terminalAtMs !== undefined)
      .sort((left, right) => (left.terminalAtMs ?? 0) - (right.terminalAtMs ?? 0));
    while (terminal.length > this.maxTerminalRuns) {
      const expired = terminal.shift();
      if (expired) this.queues.delete(expired.binding.agentRunId);
    }
  }
}

function toView(command: FollowUpCommand): ConversationFollowUpView {
  return {
    commandId: command.commandId,
    intent: command.intent,
    status: command.status,
    sourceBinding: { ...command.sourceBinding },
    promptChars: command.promptChars,
    requestedAtMs: command.requestedAtMs,
    ...(command.claimedAtMs === undefined ? {} : { claimedAtMs: command.claimedAtMs }),
    ...(command.deliveredAtMs === undefined ? {} : { deliveredAtMs: command.deliveredAtMs }),
    ...(command.failedAtMs === undefined ? {} : { failedAtMs: command.failedAtMs }),
    ...(command.nextBinding ? { nextBinding: { ...command.nextBinding } } : {}),
    hasError: command.hasError,
  };
}

function normalizeBinding(value: ConversationRunBinding): ConversationRunBinding | undefined {
  const conversationId = normalizeText(value?.conversationId);
  const agentRunId = normalizeText(value?.agentRunId);
  return conversationId && agentRunId ? { conversationId, agentRunId } : undefined;
}

function matchesBinding(left: ConversationRunBinding, right: ConversationRunBinding): boolean {
  return left.conversationId === right.conversationId && left.agentRunId === right.agentRunId;
}

function failure(
  code: Extract<ConversationFollowUpEnqueueResult, { ok: false }>["code"],
  message: string,
): ConversationFollowUpEnqueueResult {
  return { ok: false, code, message };
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function timestamp(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
