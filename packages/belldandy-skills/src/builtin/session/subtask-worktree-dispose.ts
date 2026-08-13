import crypto from "node:crypto";

import { buildFailureToolCallResult } from "../../failure-kind.js";
import { withToolContract } from "../../tool-contract.js";
import type {
  SubTaskSupervisorWorktreeDisposalCapabilityInput,
  Tool,
  ToolCallResult,
} from "../../types.js";

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/;

export const subtaskWorktreeDisposeTool: Tool = withToolContract({
  definition: {
    name: "subtask_worktree_dispose",
    description: "Preview or explicitly confirm disposal of one exact interrupted dirty delegate_parallel worktree.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "Preview or explicitly confirm disposal.", enum: ["preview", "confirm"] },
        team_id: { type: "string", description: "Exact delegate_parallel team ID." },
        lane_id: { type: "string", description: "Exact delegate_parallel lane ID." },
        task_id: { type: "string", description: "Authoritative SubTask ID." },
        session_id: { type: "string", description: "Exact interrupted child session ID." },
        expected_revision: { type: "number", description: "Expected SubTask command generation." },
        receipt_id: { type: "string", description: "Receipt returned by preview; required for confirm." },
        confirm: { type: "boolean", description: "Must be true for confirm." },
      },
      required: ["action", "team_id", "lane_id", "task_id", "session_id", "expected_revision"],
    },
  },
  async execute(args, context): Promise<ToolCallResult> {
    const start = Date.now();
    const id = crypto.randomUUID();
    const name = "subtask_worktree_dispose";
    const capability = context.agentCapabilities?.disposeSubTaskWorktree;
    if (!capability) {
      return buildFailureToolCallResult({ id, name, start, error: "Subtask worktree disposal capability is unavailable.", failureKind: "environment_error" });
    }
    const managerConversationId = readSafeId(context.conversationId);
    const managerAgentRunId = readSafeId(context.agentRunId);
    if (!managerConversationId || !managerAgentRunId) {
      return buildFailureToolCallResult({ id, name, start, error: "Subtask worktree disposal requires the current manager Conversation/run identity.", failureKind: "permission_or_policy" });
    }
    try {
      const action = readAction(args.action);
      const input: SubTaskSupervisorWorktreeDisposalCapabilityInput = {
        action,
        managerConversationId,
        managerAgentRunId,
        teamId: requireSafeId(args.team_id, "team_id"),
        laneId: requireSafeId(args.lane_id, "lane_id"),
        taskId: requireSafeId(args.task_id, "task_id"),
        sessionId: requireSafeId(args.session_id, "session_id"),
        expectedRevision: readRevision(args.expected_revision, "expected_revision"),
      };
      if (action === "confirm") {
        input.receiptId = requireSafeId(args.receipt_id, "receipt_id");
        if (args.confirm !== true) throw new Error("confirm must be true for confirm action.");
        input.confirm = true;
      }
      const result = await capability(input);
      return { id, name, success: true, output: JSON.stringify(result), durationMs: Date.now() - start };
    } catch (error) {
      return buildFailureToolCallResult({ id, name, start, error: error instanceof Error ? error.message : String(error) });
    }
  },
}, {
  family: "session-orchestration",
  isReadOnly: false,
  isConcurrencySafe: false,
  needsPermission: false,
  riskLevel: "high",
  channels: ["gateway", "web"],
  safeScopes: ["local-safe", "web-safe"],
  activityDescription: "Preview or explicitly confirm exact interrupted worktree disposal",
  resultSchema: { kind: "json", description: "No-content disposal preview or confirmation result." },
  outputPersistencePolicy: "conversation",
});

function readAction(value: unknown): "preview" | "confirm" {
  if (value === "preview" || value === "confirm") return value;
  throw new Error("action must be preview or confirm.");
}

function readSafeId(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_ID_PATTERN.test(value) ? value : undefined;
}

function requireSafeId(value: unknown, name: string): string {
  const id = readSafeId(value);
  if (!id) throw new Error(`${name} is required and must be a safe identifier.`);
  return id;
}

function readRevision(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return value;
}
