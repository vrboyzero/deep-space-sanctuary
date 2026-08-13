import crypto from "node:crypto";

import { buildFailureToolCallResult } from "../../failure-kind.js";
import { withToolContract } from "../../tool-contract.js";
import type {
  SubTaskSupervisorArtifactReference,
  SubTaskSupervisorFanInCapabilityInput,
  SubTaskSupervisorFanInLaneInput,
  Tool,
  ToolCallResult,
} from "../../types.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/;

export const subtaskFanInTool: Tool = withToolContract({
  definition: {
    name: "subtask_fan_in",
    description: "Preview or explicitly confirm fan-in for exact terminal delegate_parallel write lanes.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "Preview or explicitly confirm the receipt-bound fan-in.", enum: ["preview", "confirm"] },
        team_id: { type: "string", description: "Exact delegate_parallel team ID." },
        lanes: {
          type: "array",
          description: "One to four exact terminal write lane bindings with passed test evidence.",
          items: { type: "object" },
        },
        reviewer_evidence: { type: "object", description: "Approved read-only reviewer evidence." },
        receipt_id: { type: "string", description: "Receipt returned by preview; required for confirm." },
        confirm: { type: "boolean", description: "Must be true for confirm." },
      },
      required: ["action", "team_id", "lanes", "reviewer_evidence"],
    },
  },
  async execute(args, context): Promise<ToolCallResult> {
    const start = Date.now();
    const id = crypto.randomUUID();
    const name = "subtask_fan_in";
    const capability = context.agentCapabilities?.fanInSubTasks;
    if (!capability) {
      return buildFailureToolCallResult({ id, name, start, error: "Subtask fan-in capability is unavailable.", failureKind: "environment_error" });
    }
    const managerConversationId = readSafeId(context.conversationId);
    const managerAgentRunId = readSafeId(context.agentRunId);
    if (!managerConversationId || !managerAgentRunId) {
      return buildFailureToolCallResult({
        id,
        name,
        start,
        error: "Subtask fan-in requires the current manager Conversation/run identity.",
        failureKind: "permission_or_policy",
      });
    }

    try {
      const action = readAction(args.action);
      const teamId = requireSafeId(args.team_id, "team_id");
      const lanes = readLanes(args.lanes, { managerConversationId, managerAgentRunId, teamId });
      const reviewerEvidence = readReviewerEvidence(args.reviewer_evidence);
      const input: SubTaskSupervisorFanInCapabilityInput = {
        action,
        managerConversationId,
        managerAgentRunId,
        teamId,
        lanes,
        reviewerEvidence,
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
  activityDescription: "Preview or explicitly confirm exact supervised worktree fan-in",
  resultSchema: { kind: "json", description: "No-content fan-in preview or confirmation result." },
  outputPersistencePolicy: "conversation",
});

function readAction(value: unknown): "preview" | "confirm" {
  if (value === "preview" || value === "confirm") return value;
  throw new Error("action must be preview or confirm.");
}

function readLanes(
  value: unknown,
  manager: { managerConversationId: string; managerAgentRunId: string; teamId: string },
): SubTaskSupervisorFanInLaneInput[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 4) {
    throw new Error("lanes must contain between one and four items.");
  }
  return value.map((candidate) => {
    const lane = readObject(candidate, "lane");
    const laneId = requireSafeId(lane.lane_id, "lane_id");
    const taskId = requireSafeId(lane.task_id, "task_id");
    const sessionId = requireSafeId(lane.session_id, "session_id");
    const expectedRevision = readRevision(lane.expected_revision, "expected_revision");
    return {
      binding: { ...manager, laneId, taskId, sessionId },
      expectedRevision,
      testEvidence: readTestEvidence(lane.test_evidence, { taskId, sessionId, expectedRevision }),
    };
  });
}

function readTestEvidence(
  value: unknown,
  binding: { taskId: string; sessionId: string; expectedRevision: number },
): SubTaskSupervisorFanInLaneInput["testEvidence"] {
  const evidence = readObject(value, "test_evidence");
  const revision = readRevision(evidence.revision, "test_evidence.revision");
  if (evidence.schema_version !== "subtask-supervisor-test-evidence/v1"
    || evidence.status !== "passed"
    || evidence.task_id !== binding.taskId
    || evidence.session_id !== binding.sessionId
    || revision !== binding.expectedRevision) {
    throw new Error("test_evidence must be passed and bound to the exact lane revision.");
  }
  return {
    schemaVersion: "subtask-supervisor-test-evidence/v1",
    taskId: binding.taskId,
    sessionId: binding.sessionId,
    revision,
    status: "passed",
    artifact: readArtifact(evidence.artifact, "test_evidence.artifact"),
  };
}

function readReviewerEvidence(value: unknown): SubTaskSupervisorFanInCapabilityInput["reviewerEvidence"] {
  const evidence = readObject(value, "reviewer_evidence");
  if (evidence.schema_version !== "subtask-supervisor-review-evidence/v1"
    || evidence.mode !== "read_only"
    || evidence.verdict !== "approved") {
    throw new Error("reviewer_evidence must be approved and read_only.");
  }
  return {
    schemaVersion: "subtask-supervisor-review-evidence/v1",
    mode: "read_only",
    verdict: "approved",
    artifact: readArtifact(evidence.artifact, "reviewer_evidence.artifact"),
  };
}

function readArtifact(value: unknown, name: string): SubTaskSupervisorArtifactReference {
  const artifact = readObject(value, name);
  const id = requireSafeId(artifact.id, `${name}.id`);
  if (typeof artifact.sha256 !== "string" || !SHA256_PATTERN.test(artifact.sha256)) {
    throw new Error(`${name}.sha256 must be a lowercase SHA-256 digest.`);
  }
  return { id, sha256: artifact.sha256 };
}

function readObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value as Record<string, unknown>;
}

function readRevision(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return value;
}

function readSafeId(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_ID_PATTERN.test(value) ? value : undefined;
}

function requireSafeId(value: unknown, name: string): string {
  const id = readSafeId(value);
  if (!id) throw new Error(`${name} is required and must be a safe identifier.`);
  return id;
}
