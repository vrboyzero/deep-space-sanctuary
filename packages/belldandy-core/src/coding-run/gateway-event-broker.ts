import type { AgentRunEvent, CodingContextBinding } from "./contracts.js";
import { createGatewayConversationEventAdapter, type GatewayConversationEventAdapter } from "./gateway-conversation-event-adapter.js";
import type { CodingRunReconciliationJournal } from "./reconciliation-journal.js";
import type {
  TaskEfficiencyEvidence,
  TaskStatusObservation,
} from "./task-efficiency-metrics.js";

const DEFAULT_MAX_EVENTS_PER_RUN = 256;
const DEFAULT_MAX_TERMINAL_RUNS = 64;

type ConversationBinding = Pick<CodingContextBinding, "conversationId" | "agentRunId"> & {
  conversationId: string;
};

type Subscriber = {
  active: boolean;
  replaying: boolean;
  pending: AgentRunEvent[];
  onEvent: (event: AgentRunEvent) => void;
};

type StoredConversationRun = {
  binding: ConversationBinding;
  adapter: GatewayConversationEventAdapter;
  events: AgentRunEvent[];
  subscribers: Set<Subscriber>;
  reconciliationDurable: boolean;
  observations: TaskStatusObservation[];
  pendingPermissionIds: Set<string>;
  humanInterventionCount: number;
  humanInterventionCoverageComplete: boolean;
  observationCoverageComplete: boolean;
  terminalAt?: number;
};

export type PermissionResponderKind = "human" | "automatic" | "unknown";

export type CodingRunEfficiencyEvidence = TaskEfficiencyEvidence;

export type CodingRunGatewayEventSubscription = {
  activate: () => void;
  unsubscribe: () => void;
};

export type CodingRunGatewayEventSubscriptionResult =
  | {
    ok: true;
    earliestSeq: number;
    latestSeq: number;
    subscription: CodingRunGatewayEventSubscription;
  }
  | {
    ok: false;
    code: "not_found" | "run_mismatch" | "cursor_expired" | "invalid_cursor";
    message: string;
    earliestSeq?: number;
    latestSeq?: number;
  };

/**
 * 仅归档 Gateway 已发送的 Conversation 生命周期帧，提供有界、可按 cursor 续读的投影；
 * 不拥有 Conversation 状态机，也不重放任何控制或工具副作用。
 */
export class CodingRunGatewayEventBroker {
  private readonly runs = new Map<string, StoredConversationRun>();
  private readonly maxEventsPerRun: number;
  private readonly maxTerminalRuns: number;
  private readonly now: () => number;
  private readonly reconciliationJournal?: Pick<CodingRunReconciliationJournal, "record">
    & Partial<Pick<CodingRunReconciliationJournal, "remove">>;

  constructor(input: {
    maxEventsPerRun?: number;
    maxTerminalRuns?: number;
    now?: () => number;
    reconciliationJournal?: Pick<CodingRunReconciliationJournal, "record">
      & Partial<Pick<CodingRunReconciliationJournal, "remove">>;
  } = {}) {
    this.maxEventsPerRun = normalizePositiveInt(input.maxEventsPerRun, DEFAULT_MAX_EVENTS_PER_RUN);
    this.maxTerminalRuns = normalizePositiveInt(input.maxTerminalRuns, DEFAULT_MAX_TERMINAL_RUNS);
    this.now = input.now ?? Date.now;
    this.reconciliationJournal = input.reconciliationJournal;
  }

  registerConversationRun(binding: ConversationBinding): boolean {
    if (!isConversationBinding(binding)) return false;
    const existing = this.runs.get(binding.agentRunId);
    if (existing) return matchesBinding(existing.binding, binding);

    let run: StoredConversationRun;
    const adapter = createGatewayConversationEventAdapter({
      onEvent: (event) => this.appendEvent(run, event),
      now: this.now,
    });
    run = {
      binding: { agentRunId: binding.agentRunId, conversationId: binding.conversationId },
      adapter,
      events: [],
      subscribers: new Set(),
      reconciliationDurable: true,
      observations: [],
      pendingPermissionIds: new Set(),
      humanInterventionCount: 0,
      humanInterventionCoverageComplete: true,
      observationCoverageComplete: true,
    };
    this.runs.set(binding.agentRunId, run);
    try {
      adapter.start(run.binding);
    } catch (error) {
      if (this.runs.get(binding.agentRunId) === run) this.runs.delete(binding.agentRunId);
      throw error;
    }
    return true;
  }

  publishGatewayEvent(input: { event: string; payload: unknown }): boolean {
    const identity = readGatewayConversationIdentity(input.payload);
    if (!identity) return false;
    const run = this.runs.get(identity.agentRunId);
    if (!run || !matchesBinding(run.binding, identity) || run.adapter.hasTerminated()) return false;

    const previousLatestSeq = getLatestSeq(run);
    run.adapter.consume(input);
    if (run.adapter.hasTerminated() && run.terminalAt === undefined) {
      run.terminalAt = this.now();
      this.trimTerminalRuns();
    }
    return getLatestSeq(run) !== previousLatestSeq;
  }

  observePermissionSettled(
    binding: ConversationBinding,
    input: { toolCallId: string; responderKind: PermissionResponderKind },
  ): boolean {
    const run = this.runs.get(binding.agentRunId);
    const toolCallId = normalizeString(input.toolCallId);
    if (!run || !matchesBinding(run.binding, binding) || !toolCallId
      || !run.pendingPermissionIds.delete(toolCallId)) {
      return false;
    }
    if (input.responderKind === "human") run.humanInterventionCount += 1;
    if (input.responderKind === "unknown") run.humanInterventionCoverageComplete = false;
    if (run.pendingPermissionIds.size === 0 && !run.adapter.hasTerminated()) {
      this.appendObservation(run, { status: "running", observedAtMs: this.now() });
    }
    return true;
  }

  readEfficiencyEvidence(binding: ConversationBinding): CodingRunEfficiencyEvidence {
    const run = this.runs.get(binding.agentRunId);
    if (!run) return { status: "incomplete", reason: "not_found" };
    if (!matchesBinding(run.binding, binding)) return { status: "incomplete", reason: "run_mismatch" };
    if (run.terminalAt === undefined) return { status: "incomplete", reason: "run_not_terminal" };
    if (!run.observationCoverageComplete || run.pendingPermissionIds.size > 0
      || run.events[0]?.type !== "run.started" || !isTerminalEvent(run.events.at(-1))) {
      return { status: "incomplete", reason: "lifecycle_not_retained" };
    }
    const exactBinding = { ...run.binding };
    return {
      status: "complete",
      projectionTimeline: {
        source: "gateway_event_broker",
        coverage: "complete",
        binding: exactBinding,
        statusCoverage: ["needs_input"],
        items: run.observations.map((item) => ({ ...item })),
      },
      ...(run.humanInterventionCoverageComplete
        ? {
          humanInterventionEvidence: {
            source: "human_response" as const,
            coverage: "complete" as const,
            binding: exactBinding,
            count: run.humanInterventionCount,
          },
        }
        : {}),
    };
  }

  isReconciliationDurable(binding: ConversationBinding): boolean {
    if (!this.reconciliationJournal) return true;
    const run = this.runs.get(binding.agentRunId);
    return Boolean(run && matchesBinding(run.binding, binding) && run.reconciliationDurable);
  }

  async removeReconciliationEvidence(binding: ConversationBinding): Promise<boolean> {
    if (!isConversationBinding(binding) || !this.reconciliationJournal?.remove) return false;
    return this.reconciliationJournal.remove(binding);
  }

  subscribe(input: {
    binding: ConversationBinding;
    cursor?: number;
    onEvent: (event: AgentRunEvent) => void;
  }): CodingRunGatewayEventSubscriptionResult {
    const run = this.runs.get(input.binding.agentRunId);
    if (!run) {
      return failure("not_found", "Coding run event source was not found.");
    }
    if (!matchesBinding(run.binding, input.binding)) {
      return failure("run_mismatch", "Coding run binding no longer matches the event source.");
    }
    if (input.cursor !== undefined && (!Number.isSafeInteger(input.cursor) || input.cursor < 0)) {
      return failure("invalid_cursor", "cursor must be a non-negative safe integer.");
    }

    const earliestSeq = run.events[0]?.seq ?? 1;
    const latestSeq = getLatestSeq(run);
    const cursor = input.cursor ?? earliestSeq - 1;
    if (cursor > latestSeq) {
      return failure("invalid_cursor", "cursor is ahead of the current coding run event sequence.", earliestSeq, latestSeq);
    }
    if (input.cursor !== undefined && cursor < earliestSeq - 1) {
      return failure("cursor_expired", "Requested coding run cursor has expired; no partial replay was sent.", earliestSeq, latestSeq);
    }

    const replay = run.events.filter((event) => event.seq > cursor);
    const subscriber: Subscriber = {
      active: false,
      replaying: false,
      pending: [],
      onEvent: input.onEvent,
    };
    run.subscribers.add(subscriber);
    let unsubscribed = false;

    return {
      ok: true,
      earliestSeq,
      latestSeq,
      subscription: {
        activate: () => {
          if (unsubscribed || subscriber.active) return;
          subscriber.active = true;
          subscriber.replaying = true;
          for (const event of replay) {
            emitToSubscriber(subscriber, event);
          }
          subscriber.replaying = false;
          while (subscriber.pending.length > 0) {
            const event = subscriber.pending.shift();
            if (event) emitToSubscriber(subscriber, event);
          }
        },
        unsubscribe: () => {
          if (unsubscribed) return;
          unsubscribed = true;
          run.subscribers.delete(subscriber);
          subscriber.pending = [];
          this.trimTerminalRuns();
        },
      },
    };
  }

  private appendEvent(run: StoredConversationRun, event: AgentRunEvent): void {
    try {
      this.reconciliationJournal?.record(event);
    } catch (error) {
      run.reconciliationDurable = false;
      throw error;
    }
    run.events.push(event);
    this.observeAgentRunEvent(run, event);
    if (run.events.length > this.maxEventsPerRun) {
      run.events.splice(0, run.events.length - this.maxEventsPerRun);
      run.observationCoverageComplete = false;
    }
    for (const subscriber of run.subscribers) {
      if (!subscriber.active || subscriber.replaying) {
        if (subscriber.pending.length < this.maxEventsPerRun) subscriber.pending.push(event);
        continue;
      }
      emitToSubscriber(subscriber, event);
    }
  }

  private observeAgentRunEvent(run: StoredConversationRun, event: AgentRunEvent): void {
    if (event.type === "run.started") {
      this.appendObservation(run, { status: "running", observedAtMs: event.timestampMs });
      return;
    }
    if (event.type === "permission.requested") {
      const permission = event.payload.permission;
      if (!permission || typeof permission !== "object" || Array.isArray(permission)) return;
      const toolCallId = normalizeString((permission as Record<string, unknown>).toolCallId);
      if (!toolCallId || run.pendingPermissionIds.has(toolCallId)) return;
      run.pendingPermissionIds.add(toolCallId);
      if (run.pendingPermissionIds.size === 1) {
        this.appendObservation(run, { status: "needs_input", observedAtMs: event.timestampMs });
      }
      return;
    }
    const terminalStatus = toTerminalStatus(event.type);
    if (terminalStatus) {
      this.appendObservation(run, { status: terminalStatus, observedAtMs: event.timestampMs });
    }
  }

  private appendObservation(run: StoredConversationRun, observation: TaskStatusObservation): void {
    const previous = run.observations.at(-1);
    if (previous?.status === observation.status) return;
    if (previous && observation.observedAtMs < previous.observedAtMs) {
      run.observationCoverageComplete = false;
      return;
    }
    run.observations.push(observation);
    if (run.observations.length > this.maxEventsPerRun) {
      run.observations.splice(0, run.observations.length - this.maxEventsPerRun);
      run.observationCoverageComplete = false;
    }
  }

  private trimTerminalRuns(): void {
    const candidates = [...this.runs.values()]
      .filter((run) => run.terminalAt !== undefined && run.subscribers.size === 0)
      .sort((left, right) => (left.terminalAt ?? 0) - (right.terminalAt ?? 0));
    while (candidates.length > this.maxTerminalRuns) {
      const run = candidates.shift();
      if (run) this.runs.delete(run.binding.agentRunId);
    }
  }
}

export function createCodingRunGatewayEventBroker(
  input?: ConstructorParameters<typeof CodingRunGatewayEventBroker>[0],
): CodingRunGatewayEventBroker {
  return new CodingRunGatewayEventBroker(input);
}

function getLatestSeq(run: StoredConversationRun): number {
  return run.events.at(-1)?.seq ?? 0;
}

function emitToSubscriber(subscriber: Subscriber, event: AgentRunEvent): void {
  try {
    subscriber.onEvent(event);
  } catch {
    // 单个 transport/展示消费者失败不能影响 Gateway 事件真源或其它订阅者。
  }
}

function isConversationBinding(value: ConversationBinding): boolean {
  return isNonEmptyString(value.agentRunId) && isNonEmptyString(value.conversationId);
}

function matchesBinding(left: ConversationBinding, right: ConversationBinding): boolean {
  return left.agentRunId === right.agentRunId && left.conversationId === right.conversationId;
}

function readGatewayConversationIdentity(value: unknown): ConversationBinding | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const payload = value as Record<string, unknown>;
  const conversationId = typeof payload.conversationId === "string" ? payload.conversationId.trim() : "";
  const agentRunId = typeof payload.runId === "string" ? payload.runId.trim() : "";
  return isConversationBinding({ conversationId, agentRunId }) ? { conversationId, agentRunId } : undefined;
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function failure(
  code: Extract<CodingRunGatewayEventSubscriptionResult, { ok: false }> ["code"],
  message: string,
  earliestSeq?: number,
  latestSeq?: number,
): CodingRunGatewayEventSubscriptionResult {
  return {
    ok: false,
    code,
    message,
    ...(earliestSeq === undefined ? {} : { earliestSeq }),
    ...(latestSeq === undefined ? {} : { latestSeq }),
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toTerminalStatus(type: AgentRunEvent["type"]): TaskStatusObservation["status"] | undefined {
  switch (type) {
    case "run.completed": return "completed";
    case "run.failed": return "failed";
    case "run.cancelled": return "cancelled";
    case "run.interrupted": return "interrupted";
    default: return undefined;
  }
}

function isTerminalEvent(event: AgentRunEvent | undefined): boolean {
  return Boolean(event && toTerminalStatus(event.type));
}
