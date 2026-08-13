import crypto from "node:crypto";

import { buildFailureToolCallResult } from "../../failure-kind.js";
import { withToolContract } from "../../tool-contract.js";
import type {
  SubTaskSupervisorControlInput,
  Tool,
  ToolCallResult,
} from "../../types.js";

export const SUBTASK_SUPERVISOR_CONTROL_SCHEMA_VERSION = "subtask-supervisor-control/v1" as const;

export const subtaskSupervisorTool: Tool = withToolContract({
  definition: {
    name: "subtask_supervisor",
    description: "Observe, cancel, or steer one exact delegate_parallel lane owned by the current manager run.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "Control action.", enum: ["observe", "cancel", "steer"] },
        team_id: { type: "string", description: "Exact delegate_parallel team ID." },
        lane_id: { type: "string", description: "Exact delegate_parallel lane ID." },
        task_id: { type: "string", description: "Authoritative SubTask ID." },
        session_id: { type: "string", description: "Current child session ID when known." },
        reason: { type: "string", description: "Bounded cancellation reason." },
        message: { type: "string", description: "Required steering guidance for steer." },
        expected_revision: { type: "number", description: "Expected SubTask command generation." },
        idempotency_key: { type: "string", description: "Stable key for retrying the same mutation." },
      },
      required: ["action", "team_id", "lane_id", "task_id"],
    },
  },
  async execute(args, context): Promise<ToolCallResult> {
    const start = Date.now();
    const id = crypto.randomUUID();
    const name = "subtask_supervisor";
    const capability = context.agentCapabilities?.controlSubTask;
    if (!capability) {
      return buildFailureToolCallResult({
        id,
        name,
        start,
        error: "Subtask Supervisor control capability is unavailable.",
        failureKind: "environment_error",
      });
    }
    const managerConversationId = readRequiredString(context.conversationId);
    const managerAgentRunId = readRequiredString(context.agentRunId);
    if (!managerConversationId || !managerAgentRunId) {
      return buildFailureToolCallResult({
        id,
        name,
        start,
        error: "Subtask Supervisor control requires the current manager Conversation/run identity.",
        failureKind: "permission_or_policy",
      });
    }

    try {
      const action = readAction(args.action);
      const input: SubTaskSupervisorControlInput = {
        action,
        managerConversationId,
        managerAgentRunId,
        teamId: requireArgument(args.team_id, "team_id"),
        laneId: requireArgument(args.lane_id, "lane_id"),
        taskId: requireArgument(args.task_id, "task_id"),
        ...(readRequiredString(args.session_id) ? { sessionId: readRequiredString(args.session_id) } : {}),
        ...(readRequiredString(args.reason) ? { reason: readRequiredString(args.reason) } : {}),
        ...(readRequiredString(args.message) ? { message: readRequiredString(args.message) } : {}),
        ...(readExpectedRevision(args.expected_revision) === undefined
          ? {}
          : { expectedRevision: readExpectedRevision(args.expected_revision) }),
        ...(readRequiredString(args.idempotency_key)
          ? { idempotencyKey: readRequiredString(args.idempotency_key) }
          : {}),
      };
      if (action === "steer" && !input.message) {
        throw new Error("message is required for steer.");
      }
      const item = await capability(input);
      if (!item) {
        throw new Error("Exact parallel lane was not found.");
      }
      return {
        id,
        name,
        success: true,
        output: JSON.stringify({
          schemaVersion: SUBTASK_SUPERVISOR_CONTROL_SCHEMA_VERSION,
          contentMode: "none",
          item,
        }),
        durationMs: Date.now() - start,
      };
    } catch (error) {
      return buildFailureToolCallResult({
        id,
        name,
        start,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
}, {
  family: "session-orchestration",
  isReadOnly: false,
  isConcurrencySafe: false,
  needsPermission: false,
  riskLevel: "medium",
  channels: ["gateway", "web"],
  safeScopes: ["local-safe", "web-safe"],
  activityDescription: "Observe or control one exact supervised parallel lane",
  resultSchema: {
    kind: "json",
    description: "No-content Supervisor lane observation.",
  },
  outputPersistencePolicy: "conversation",
});

function readAction(value: unknown): SubTaskSupervisorControlInput["action"] {
  if (value === "observe" || value === "cancel" || value === "steer") return value;
  throw new Error("action must be observe, cancel, or steer.");
}

function readRequiredString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= 512 && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : undefined;
}

function requireArgument(value: unknown, name: string): string {
  const normalized = readRequiredString(value);
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function readExpectedRevision(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("expected_revision must be a non-negative integer.");
  }
  return value;
}
