import { randomUUID } from "node:crypto";

import type { AgentRunSteerCommand, AgentRunSteeringMailbox } from "@belldandy/agent";
import type { ConversationRunBinding } from "./conversation-follow-up-queue.js";

export type ConversationSteerStatus = "queued" | "claimed" | "delivered" | "failed";

export type ConversationSteerView = {
  commandId: string;
  intent: "steer";
  status: ConversationSteerStatus;
  sourceBinding: ConversationRunBinding;
  promptChars: number;
  requestedAtMs: number;
  claimedAtMs?: number;
  deliveredAtMs?: number;
  deliveredModelCallIndex?: number;
  failedAtMs?: number;
  hasError: boolean;
};

export type ConversationSteerEnqueueResult =
  | { ok: true; replayed: boolean; item: ConversationSteerView }
  | {
    ok: false;
    code: "invalid_request" | "idempotency_conflict" | "queue_full" | "not_active";
    message: string;
  };

type SteerCommand = ConversationSteerView & {
  prompt: string;
  idempotencyKey: string;
  error?: string;
};

type ConversationSteerMailboxOptions = {
  binding: ConversationRunBinding;
  maxQueued?: number;
  maxPromptChars?: number;
  maxIdempotencyKeyChars?: number;
  createId?: () => string;
  now?: () => number;
  onDeliver?: (input: {
    commandId: string;
    prompt: string;
    requestedAtMs: number;
  }) => void | Promise<void>;
};

const DEFAULT_MAX_QUEUED = 8;
const DEFAULT_MAX_PROMPT_CHARS = 32_768;
const DEFAULT_MAX_IDEMPOTENCY_KEY_CHARS = 128;

/** Exact-run mailbox. It never mutates an in-flight Provider request. */
export class ConversationSteerMailbox implements AgentRunSteeringMailbox {
  readonly binding: ConversationRunBinding;
  private readonly commands: SteerCommand[] = [];
  private readonly maxQueued: number;
  private readonly maxPromptChars: number;
  private readonly maxIdempotencyKeyChars: number;
  private readonly createId: () => string;
  private readonly now: () => number;
  private readonly onDeliver?: ConversationSteerMailboxOptions["onDeliver"];
  private accepting = true;
  private closedAtMs?: number;

  constructor(options: ConversationSteerMailboxOptions) {
    const binding = normalizeBinding(options.binding);
    if (!binding) throw new Error("Conversation steer mailbox requires an exact run binding.");
    this.binding = binding;
    this.maxQueued = positiveInteger(options.maxQueued, DEFAULT_MAX_QUEUED);
    this.maxPromptChars = positiveInteger(options.maxPromptChars, DEFAULT_MAX_PROMPT_CHARS);
    this.maxIdempotencyKeyChars = positiveInteger(
      options.maxIdempotencyKeyChars,
      DEFAULT_MAX_IDEMPOTENCY_KEY_CHARS,
    );
    this.createId = options.createId ?? (() => `conversation_steer_${randomUUID()}`);
    this.now = options.now ?? Date.now;
    this.onDeliver = options.onDeliver;
  }

  enqueue(input: { prompt: string; idempotencyKey: string }): ConversationSteerEnqueueResult {
    const prompt = normalizeText(input.prompt);
    const idempotencyKey = normalizeText(input.idempotencyKey);
    if (!prompt || prompt.length > this.maxPromptChars) {
      return failure("invalid_request", `prompt must contain 1-${this.maxPromptChars} characters.`);
    }
    if (!idempotencyKey || idempotencyKey.length > this.maxIdempotencyKeyChars) {
      return failure(
        "invalid_request",
        `idempotencyKey must contain 1-${this.maxIdempotencyKeyChars} characters.`,
      );
    }

    const existing = this.commands.find((command) => command.idempotencyKey === idempotencyKey);
    if (existing) {
      if (existing.prompt !== prompt) {
        return failure("idempotency_conflict", "idempotencyKey is already bound to different steer content.");
      }
      return { ok: true, replayed: true, item: toView(existing) };
    }
    if (!this.accepting) {
      return failure("not_active", "Conversation run no longer accepts steer input.");
    }
    const pendingCount = this.commands.filter((command) =>
      command.status === "queued" || command.status === "claimed"
    ).length;
    if (pendingCount >= this.maxQueued) {
      return failure("queue_full", "Conversation steer mailbox is full for this run.");
    }

    const command: SteerCommand = {
      commandId: normalizeText(this.createId()) ?? `conversation_steer_${randomUUID()}`,
      intent: "steer",
      status: "queued",
      sourceBinding: { ...this.binding },
      prompt,
      promptChars: prompt.length,
      idempotencyKey,
      requestedAtMs: timestamp(this.now()),
      hasError: false,
    };
    this.commands.push(command);
    return { ok: true, replayed: false, item: toView(command) };
  }

  getStatus(commandId: string): ConversationSteerView | undefined {
    const normalizedCommandId = normalizeText(commandId);
    if (!normalizedCommandId) return undefined;
    const command = this.commands.find((item) => item.commandId === normalizedCommandId);
    return command ? toView(command) : undefined;
  }

  hasPending(): boolean {
    return this.commands.some((command) => command.status === "queued" || command.status === "claimed");
  }

  async consumePending(input: { modelCallIndex: number }): Promise<AgentRunSteerCommand[]> {
    const modelCallIndex = positiveInteger(input.modelCallIndex, 1);
    const pending = this.commands.filter((command) => command.status === "queued");
    for (const command of pending) {
      command.status = "claimed";
      command.claimedAtMs = timestamp(this.now());
    }

    const delivered: AgentRunSteerCommand[] = [];
    for (const command of pending) {
      try {
        await this.onDeliver?.({
          commandId: command.commandId,
          prompt: command.prompt,
          requestedAtMs: command.requestedAtMs,
        });
        command.status = "delivered";
        command.deliveredAtMs = timestamp(this.now());
        command.deliveredModelCallIndex = modelCallIndex;
        command.hasError = false;
        command.error = undefined;
        delivered.push({ commandId: command.commandId, prompt: command.prompt });
      } catch (error) {
        this.markFailed(command, error instanceof Error ? error.message : String(error));
      }
    }
    return delivered;
  }

  sealIfIdle(): boolean {
    if (this.hasPending()) return false;
    this.accepting = false;
    this.closedAtMs = this.closedAtMs ?? timestamp(this.now());
    return true;
  }

  close(error: string): number {
    this.accepting = false;
    this.closedAtMs = this.closedAtMs ?? timestamp(this.now());
    let failed = 0;
    for (const command of this.commands) {
      if (command.status !== "queued" && command.status !== "claimed") continue;
      this.markFailed(command, error);
      failed++;
    }
    return failed;
  }

  isClosed(): boolean {
    return !this.accepting;
  }

  getClosedAtMs(): number | undefined {
    return this.closedAtMs;
  }

  private markFailed(command: SteerCommand, error: string): void {
    command.status = "failed";
    command.failedAtMs = timestamp(this.now());
    command.hasError = true;
    command.error = normalizeText(error) ?? "Conversation steer delivery failed.";
  }
}

function toView(command: SteerCommand): ConversationSteerView {
  return {
    commandId: command.commandId,
    intent: "steer",
    status: command.status,
    sourceBinding: { ...command.sourceBinding },
    promptChars: command.promptChars,
    requestedAtMs: command.requestedAtMs,
    ...(command.claimedAtMs === undefined ? {} : { claimedAtMs: command.claimedAtMs }),
    ...(command.deliveredAtMs === undefined ? {} : { deliveredAtMs: command.deliveredAtMs }),
    ...(command.deliveredModelCallIndex === undefined
      ? {}
      : { deliveredModelCallIndex: command.deliveredModelCallIndex }),
    ...(command.failedAtMs === undefined ? {} : { failedAtMs: command.failedAtMs }),
    hasError: command.hasError,
  };
}

function normalizeBinding(value: ConversationRunBinding): ConversationRunBinding | undefined {
  const conversationId = normalizeText(value?.conversationId);
  const agentRunId = normalizeText(value?.agentRunId);
  return conversationId && agentRunId ? { conversationId, agentRunId } : undefined;
}

function failure(
  code: Extract<ConversationSteerEnqueueResult, { ok: false }>["code"],
  message: string,
): ConversationSteerEnqueueResult {
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
