import {
  TASK_CAPABILITY_CLOSURE_SCHEMA_VERSION,
  isTaskCapabilityClosure,
  type TaskCapabilityClosure,
  type TaskCapabilityName,
} from "./task-projection.js";
import type { CodingRunSource } from "./contracts.js";
import type { CodingRunCapabilityRequirements } from "@belldandy/protocol";

export type TaskCapabilityClosureResolverInput = {
  taskId: string;
  source: CodingRunSource;
  agentRunId: string;
};

export type TaskCapabilityClosureResolver = {
  resolve: (input: TaskCapabilityClosureResolverInput) => TaskCapabilityClosure | undefined;
  evaluateForStart?: (input: TaskCapabilityClosureStartEvaluationInput) => Promise<TaskCapabilityClosure>;
  release?: (input: TaskCapabilityClosureResolverInput) => void;
};

export type TaskCapabilityClosureStartEvaluationInput = {
  binding: TaskCapabilityClosureResolverInput;
  requirements: CodingRunCapabilityRequirements;
  context: {
    conversationId: string;
    agentId: string;
    automationProfile?: "bare";
    requestChannel?: "cli" | "web" | "browser-extension" | "gateway";
    permissionMode?: "plan" | "acceptEdits" | "confirm";
    toolAllow?: string[];
    toolDeny?: string[];
  };
};

export type TaskCapabilityClosureStartDecision =
  | { ok: true }
  | {
    ok: false;
    reasonCode: "capability_closure_unknown" | "required_capability_unavailable";
    unavailable: TaskCapabilityName[];
  };

/**
 * 将任务启动能力的 authoritative reader 收敛为只读、exact-binding seam。
 * 缺失、绑定漂移、非法结果或 owner 异常均回退为 unknown，不猜测其他任务能力。
 */
export function createTaskCapabilityClosureResolver(input: {
  now?: () => number;
  resolve: (binding: TaskCapabilityClosureResolverInput) => TaskCapabilityClosure | undefined;
  evaluateForStart?: (input: TaskCapabilityClosureStartEvaluationInput) => Promise<TaskCapabilityClosure>;
  release?: (binding: TaskCapabilityClosureResolverInput) => void;
}): TaskCapabilityClosureResolver {
  const now = input.now ?? Date.now;
  const resolver: TaskCapabilityClosureResolver = {
    resolve: (binding) => {
      if (!isBinding(binding)) return createUnknownTaskCapabilityClosure(now(), "invalid_binding");
      try {
        const closure = input.resolve(binding);
        if (!closure) return createUnknownTaskCapabilityClosure(now(), "not_evaluated");
        if (!isTaskCapabilityClosure(closure)) return createUnknownTaskCapabilityClosure(now(), "invalid_owner_result");
        return cloneTaskCapabilityClosure(closure);
      } catch {
        return createUnknownTaskCapabilityClosure(now(), "resolver_error");
      }
    },
  };
  if (input.evaluateForStart) {
    resolver.evaluateForStart = async (evaluation) => {
      if (!isBinding(evaluation.binding)) return createUnknownTaskCapabilityClosure(now(), "invalid_binding");
      try {
        const closure = await input.evaluateForStart!(evaluation);
        return isTaskCapabilityClosure(closure)
          ? cloneTaskCapabilityClosure(closure)
          : createUnknownTaskCapabilityClosure(now(), "invalid_owner_result");
      } catch {
        return createUnknownTaskCapabilityClosure(now(), "resolver_error");
      }
    };
  }
  if (input.release) {
    resolver.release = (binding) => {
      if (!isBinding(binding)) return;
      try {
        input.release!(binding);
      } catch {
        // Release is best-effort and must not replace the run outcome.
      }
    };
  }
  return resolver;
}

export function createConversationTaskCapabilityClosureBinding(input: {
  conversationId: string;
  agentRunId: string;
}): TaskCapabilityClosureResolverInput {
  return {
    taskId: `conversation:${input.conversationId}:${input.agentRunId}`,
    source: "conversation",
    agentRunId: input.agentRunId,
  };
}

/** 任务启动只接受已评估且所有 required capability 可用的闭包。 */
export function evaluateTaskCapabilityClosureForStart(
  closure: TaskCapabilityClosure | undefined,
): TaskCapabilityClosureStartDecision {
  if (!isTaskCapabilityClosure(closure) || closure.status === "unknown") {
    return { ok: false, reasonCode: "capability_closure_unknown", unavailable: [] };
  }
  const unavailable = Object.entries(closure.capabilities)
    .filter(([, capability]) => capability.required && capability.state !== "available")
    .map(([name]) => name as TaskCapabilityName)
    .sort();
  return closure.status === "blocked" || unavailable.length > 0
    ? { ok: false, reasonCode: "required_capability_unavailable", unavailable }
    : { ok: true };
}

export function createUnknownTaskCapabilityClosure(
  evaluatedAtMs: number,
  reasonCode = "not_evaluated",
): TaskCapabilityClosure {
  const capability = { required: false, state: "unknown" as const, reasonCode };
  return {
    schemaVersion: TASK_CAPABILITY_CLOSURE_SCHEMA_VERSION,
    evaluatedAtMs: normalizeTimestamp(evaluatedAtMs),
    status: "unknown",
    capabilities: {
      tools: { ...capability },
      languageToolchain: { ...capability },
      sandbox: { ...capability },
      approvalChannel: { ...capability },
      worktree: { ...capability },
      journal: { ...capability },
      trace: { ...capability },
      verifier: { ...capability },
      mcp: { ...capability },
      plugin: { ...capability },
      skill: { ...capability },
    },
  };
}

function cloneTaskCapabilityClosure(value: TaskCapabilityClosure): TaskCapabilityClosure {
  return {
    ...value,
    capabilities: Object.fromEntries(
      Object.entries(value.capabilities).map(([name, capability]) => [name, { ...capability }]),
    ) as TaskCapabilityClosure["capabilities"],
  };
}

function isBinding(value: unknown): value is TaskCapabilityClosureResolverInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).every((key) => ["taskId", "source", "agentRunId"].includes(key))
    && isNonEmptyString(record.taskId)
    && isNonEmptyString(record.agentRunId)
    && (record.source === "conversation"
      || record.source === "goal"
      || record.source === "workflow"
      || record.source === "subtask");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeTimestamp(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
