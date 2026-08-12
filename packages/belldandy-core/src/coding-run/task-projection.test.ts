import { describe, expect, it } from "vitest";

import {
  createTaskProjectionActionEnvelope,
  createTaskProjection,
  createTaskProjectionSet,
  isTaskProjectionV1,
  isTaskProjectionActionEnvelopeV1,
  type TaskCapabilityClosure,
  type TaskProjectionSupportingEvidence,
} from "./task-projection.js";
import { createGoalCodingRunView } from "./source-adapters.js";

const satisfiedCapabilities: TaskCapabilityClosure = {
  schemaVersion: "task-capability-closure/v1",
  evaluatedAtMs: 1_700_000_000_500,
  status: "satisfied",
  capabilities: {
    tools: { required: true, state: "available" },
    languageToolchain: { required: false, state: "degraded", reasonCode: "not_requested" },
    sandbox: { required: true, state: "available" },
    approvalChannel: { required: true, state: "available" },
    worktree: { required: true, state: "available" },
    journal: { required: true, state: "available" },
    trace: { required: true, state: "available" },
    verifier: { required: true, state: "available" },
    mcp: { required: false, state: "degraded", reasonCode: "not_requested" },
    plugin: { required: false, state: "degraded", reasonCode: "not_requested" },
    skill: { required: false, state: "degraded", reasonCode: "not_requested" },
  },
};

function createGoalSource() {
  return createGoalCodingRunView({
    goal: {
      id: "goal-1",
      status: "reviewing",
      activeConversationId: "conversation-1",
      lastRunId: "run-1",
    },
    node: {
      id: "node-1",
      status: "pending_review",
      artifacts: [],
      checkpointRequired: true,
      checkpointStatus: "waiting_user",
      lastRunId: "run-1",
    },
  });
}

describe("task projection v1", () => {
  it("normalizes owner status and keeps exact binding without source evidence or callbacks", () => {
    const projection = createTaskProjection({
      taskId: "task-1",
      view: createGoalSource(),
      observedAtMs: 1_700_000_000_000,
      capabilityClosure: satisfiedCapabilities,
    });

    expect(projection).toEqual({
      schemaVersion: "task-projection/v1",
      taskId: "task-1",
      status: "needs_input",
      owner: {
        source: "goal",
        binding: {
          agentRunId: "run-1",
          conversationId: "conversation-1",
          goal: { goalId: "goal-1", nodeId: "node-1" },
        },
      },
      evidence: {
        observedAtMs: 1_700_000_000_000,
        reasonCategory: "awaiting_input",
        reasonCode: "awaiting_user_review",
      },
      allowedActions: ["observe", "respond"],
      capabilityClosure: satisfiedCapabilities,
    });
    expect(JSON.stringify(projection)).not.toMatch(/prompt|toolArgs|secret|stopCallback|worktreePath/i);
    expect(isTaskProjectionV1(projection)).toBe(true);
  });

  it("fails closed when a required capability is unavailable", () => {
    const closure: TaskCapabilityClosure = {
      ...satisfiedCapabilities,
      status: "blocked",
      capabilities: {
        ...satisfiedCapabilities.capabilities,
        sandbox: { required: true, state: "unavailable", reasonCode: "oci_unavailable" },
      },
    };
    const projection = createTaskProjection({
      taskId: "task-blocked-by-capability",
      view: createGoalSource(),
      observedAtMs: 1_700_000_000_000,
      capabilityClosure: closure,
    });

    expect(projection.status).toBe("blocked");
    expect(projection.evidence).toEqual({
      observedAtMs: 1_700_000_000_000,
      reasonCategory: "blocked_by_capability",
      reasonCode: "required_capability_unavailable",
    });
    expect(projection.allowedActions).toEqual(["observe"]);
  });

  it("projects conflicting authoritative sources as uncertain and never revives a terminal task", () => {
    const first = {
      taskId: "task-conflict",
      view: createGoalSource(),
      observedAtMs: 100,
      capabilityClosure: satisfiedCapabilities,
    };
    const second = {
      ...first,
      view: { ...createGoalSource(), status: "completed" as const },
      observedAtMs: 200,
    };

    const [projection] = createTaskProjectionSet({ sources: [first, second] });
    expect(projection).toMatchObject({
      taskId: "task-conflict",
      status: "uncertain",
      evidence: { observedAtMs: 200, reasonCategory: "evidence_conflict", reasonCode: "conflicting_owner_evidence" },
      allowedActions: ["observe"],
    });
    expect(isTaskProjectionV1({ ...projection, status: "completed", allowedActions: ["observe"] })).toBe(true);
  });

  it("rejects malformed or content-bearing projections", () => {
    const projection = createTaskProjection({
      taskId: "task-1",
      view: createGoalSource(),
      observedAtMs: 1_700_000_000_000,
      capabilityClosure: satisfiedCapabilities,
    });

    expect(isTaskProjectionV1({ ...projection, prompt: "secret" })).toBe(false);
    expect(isTaskProjectionV1({ ...projection, owner: { ...projection.owner, binding: { agentRunId: "" } } })).toBe(false);
    expect(isTaskProjectionV1({ ...projection, evidence: { ...projection.evidence, observedAtMs: -1 } })).toBe(false);
    expect(isTaskProjectionV1({ ...projection, allowedActions: ["observe", "resume"] })).toBe(false);
    expect(isTaskProjectionV1({
      ...projection,
      owner: {
        ...projection.owner,
        binding: {
          ...projection.owner.binding,
          workspaceCheckpoint: {
            workspaceCheckpointId: "checkpoint-1",
            recoveryGuarantee: "exact",
            secret: "leak",
          },
        },
      },
    })).toBe(false);
  });

  it("creates an exact-binding action envelope without invoking an owner", () => {
    const projection = createTaskProjection({
      taskId: "task-resume",
      view: { ...createGoalSource(), status: "interrupted" },
      observedAtMs: 1_700_000_000_000,
      capabilityClosure: satisfiedCapabilities,
    });

    const envelope = createTaskProjectionActionEnvelope({
      projection,
      action: "resume",
      requestId: "request-1",
    });

    expect(envelope).toEqual({
      schemaVersion: "task-projection-actions/v1",
      requestId: "request-1",
      taskId: "task-resume",
      action: "resume",
      binding: projection.owner.binding,
    });
    expect(isTaskProjectionActionEnvelopeV1(envelope)).toBe(true);
    expect(JSON.stringify(envelope)).not.toMatch(/prompt|toolArgs|path|secret/i);
  });

  it("rejects action requests when the allowed action or exact binding has drifted", () => {
    const projection = createTaskProjection({
      taskId: "task-done",
      view: { ...createGoalSource(), status: "completed" },
      observedAtMs: 1_700_000_000_000,
      capabilityClosure: satisfiedCapabilities,
    });

    expect(() => createTaskProjectionActionEnvelope({
      projection,
      action: "resume",
      requestId: "request-denied",
    })).toThrow("Action is not allowed");
    expect(() => createTaskProjectionActionEnvelope({
      projection: { ...projection, status: "interrupted", allowedActions: ["observe", "resume"] },
      action: "resume",
      requestId: "request-stale",
      binding: { ...projection.owner.binding, agentRunId: "stale-run" },
    })).toThrow("binding does not match");
  });

  it("keeps implementation completion separate from unfinished validation", () => {
    const supportingEvidence: TaskProjectionSupportingEvidence = {
      validation: { status: "running", observedAtMs: 1_700_000_000_100, required: true },
    };
    const projection = createTaskProjection({
      taskId: "task-verifying",
      view: { ...createGoalSource(), status: "completed" },
      observedAtMs: 1_700_000_000_000,
      capabilityClosure: satisfiedCapabilities,
      supportingEvidence,
    });

    expect(projection.status).toBe("verifying");
    expect(projection.evidence).toMatchObject({ reasonCategory: "verification", reasonCode: "validation_in_progress" });
    expect(projection.supportingEvidence).toEqual(supportingEvidence);
  });

  it("surfaces uncertain journal and lost command evidence without exposing content", () => {
    const supportingEvidence: TaskProjectionSupportingEvidence = {
      commandJob: { status: "lost", observedAtMs: 1_700_000_000_200 },
      journal: { status: "uncertain", observedAtMs: 1_700_000_000_300 },
    };
    const projection = createTaskProjection({
      taskId: "task-uncertain-evidence",
      view: createGoalSource(),
      observedAtMs: 1_700_000_000_000,
      capabilityClosure: satisfiedCapabilities,
      supportingEvidence,
    });

    expect(projection.status).toBe("uncertain");
    expect(projection.evidence.reasonCode).toBe("journal_evidence_uncertain");
    expect(JSON.stringify(projection)).not.toMatch(/output|error|path|secret/i);
  });

  it("treats owner binding drift as uncertain during collection", () => {
    const base = {
      taskId: "task-binding-drift",
      view: createGoalSource(),
      observedAtMs: 100,
      capabilityClosure: satisfiedCapabilities,
    };
    const drifted = {
      ...base,
      view: { ...createGoalSource(), binding: { ...createGoalSource().binding, agentRunId: "run-2" } },
      observedAtMs: 200,
    };

    const [projection] = createTaskProjectionSet({ sources: [base, drifted] });
    expect(projection.status).toBe("uncertain");
    expect(projection.evidence.reasonCode).toBe("owner_binding_drift");
  });
});
