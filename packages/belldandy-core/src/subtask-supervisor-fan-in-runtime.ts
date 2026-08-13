import type { SubTaskSupervisorExactBinding } from "./subtask-supervisor-runtime.js";
import type { WorktreeRuntimeStatus } from "./worktree-runtime.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/;
const MAX_FAN_IN_LANES = 4;

export const SUBTASK_SUPERVISOR_FAN_IN_SCHEMA_VERSION = "subtask-supervisor-fan-in/v1" as const;

export type SubTaskSupervisorFanInErrorCode =
  | "fan_in_binding_conflict"
  | "fan_in_evidence_invalid"
  | "fan_in_not_ready";

export class SubTaskSupervisorFanInError extends Error {
  constructor(
    readonly code: SubTaskSupervisorFanInErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SubTaskSupervisorFanInError";
  }
}

export type SubTaskSupervisorArtifactReference = {
  id: string;
  sha256: string;
};

export type SubTaskSupervisorTestEvidence = {
  schemaVersion: "subtask-supervisor-test-evidence/v1";
  taskId: string;
  sessionId: string;
  revision: number;
  status: "passed" | "failed";
  artifact: SubTaskSupervisorArtifactReference;
};

export type SubTaskSupervisorReviewEvidence = {
  schemaVersion: "subtask-supervisor-review-evidence/v1";
  mode: "read_only";
  verdict: "approved" | "rejected";
  artifact: SubTaskSupervisorArtifactReference;
};

export type SubTaskSupervisorFanInArtifact = {
  schemaVersion: "subtask-worktree-fan-in-artifact/v1";
  taskId: string;
  status: "complete" | "no_changes" | "incomplete";
  baseRef: string;
  patch?: { path: string; sha256: string; byteLength: number };
  manifest: { path: string; sha256: string };
  changedPaths: string[];
};

export type SubTaskSupervisorFanInPreviewInput = {
  managerConversationId: string;
  managerAgentRunId: string;
  teamId: string;
  lanes: Array<{
    binding: Required<SubTaskSupervisorExactBinding>;
    expectedRevision: number;
    testEvidence: SubTaskSupervisorTestEvidence;
  }>;
  reviewerEvidence: SubTaskSupervisorReviewEvidence;
};

export type SubTaskSupervisorFanInConfirmInput = SubTaskSupervisorFanInPreviewInput & {
  receiptId: string;
  confirm: true;
};

export type SubTaskSupervisorFanInResolutionPreview = {
  status: "ready" | "conflict";
  receipt: { id: string; expiresAtMs: number };
  laneCount: number;
  conflictPaths: string[];
};

export type SubTaskSupervisorFanInPreview = {
  schemaVersion: typeof SUBTASK_SUPERVISOR_FAN_IN_SCHEMA_VERSION;
  contentMode: "none";
  status: SubTaskSupervisorFanInResolutionPreview["status"];
  receipt: SubTaskSupervisorFanInResolutionPreview["receipt"];
  conflictPaths: string[];
  lanes: Array<{
    binding: Required<SubTaskSupervisorExactBinding>;
    revision: number;
    changedPaths: string[];
    patch?: { sha256: string; byteLength: number };
    manifestSha256: string;
    testArtifactSha256: string;
  }>;
  reviewer: {
    mode: "read_only";
    verdict: "approved";
    artifactSha256: string;
  };
};

export type SubTaskSupervisorFanInResult = {
  schemaVersion: typeof SUBTASK_SUPERVISOR_FAN_IN_SCHEMA_VERSION;
  contentMode: "none";
  status: "completed" | "failed" | "uncertain" | "conflict";
  applied: boolean;
  duplicateSideEffect: false;
  blockers: string[];
  auditArtifactId?: string;
};

type FanInTaskRecord = {
  id: string;
  status: string;
  sessionId?: string;
  commandGeneration?: number;
  supervisorBinding?: {
    managerConversationId: string;
    managerAgentRunId: string;
    teamId: string;
    laneId: string;
    mode: "read" | "write";
  };
  launchSpec: {
    isolationMode?: string;
    worktreePath?: string;
    worktreeRepoRoot?: string;
    worktreeBranch?: string;
    worktreeBaseRef?: string;
    worktreeStatus?: WorktreeRuntimeStatus;
  };
};

type ResolutionLane = {
  binding: Required<SubTaskSupervisorExactBinding>;
  revision: number;
  sourceRepoRoot: string;
  artifact: SubTaskSupervisorFanInArtifact;
  testEvidence: SubTaskSupervisorTestEvidence;
};

export class SubTaskSupervisorFanInRuntime {
  private readonly now: () => number;

  constructor(private readonly input: {
    runtimeStore: { getTask(taskId: string): Promise<FanInTaskRecord | undefined> };
    worktreeRuntime: { collectFanInArtifact(record: FanInTaskRecord): Promise<SubTaskSupervisorFanInArtifact> };
    resolutionRuntime: {
      preview(input: {
        managerConversationId: string;
        managerAgentRunId: string;
        teamId: string;
        lanes: ResolutionLane[];
        reviewerEvidence: SubTaskSupervisorReviewEvidence;
      }): Promise<SubTaskSupervisorFanInResolutionPreview>;
      confirm(input: unknown): Promise<unknown>;
    };
    now?: () => number;
  }) {
    this.now = input.now ?? Date.now;
  }

  async preview(input: SubTaskSupervisorFanInPreviewInput): Promise<SubTaskSupervisorFanInPreview> {
    const lanes = await this.collectValidatedLanes(input);

    const resolution = await this.input.resolutionRuntime.preview({
      managerConversationId: input.managerConversationId,
      managerAgentRunId: input.managerAgentRunId,
      teamId: input.teamId,
      lanes,
      reviewerEvidence: input.reviewerEvidence,
    });
    validateResolutionPreview(resolution, lanes.length, this.now());
    return {
      schemaVersion: SUBTASK_SUPERVISOR_FAN_IN_SCHEMA_VERSION,
      contentMode: "none",
      status: resolution.status,
      receipt: { ...resolution.receipt },
      conflictPaths: [...resolution.conflictPaths],
      lanes: lanes.map((lane) => ({
        binding: { ...lane.binding },
        revision: lane.revision,
        changedPaths: [...lane.artifact.changedPaths],
        ...(lane.artifact.patch ? {
          patch: { sha256: lane.artifact.patch.sha256, byteLength: lane.artifact.patch.byteLength },
        } : {}),
        manifestSha256: lane.artifact.manifest.sha256,
        testArtifactSha256: lane.testEvidence.artifact.sha256,
      })),
      reviewer: {
        mode: "read_only",
        verdict: "approved",
        artifactSha256: input.reviewerEvidence.artifact.sha256,
      },
    };
  }

  async confirm(input: SubTaskSupervisorFanInConfirmInput): Promise<SubTaskSupervisorFanInResult> {
    if (input.confirm !== true || !isSafeId(input.receiptId)) {
      evidenceError("Fan-in confirmation requires a valid receipt.");
    }
    const lanes = await this.collectValidatedLanes(input);
    const result = await this.input.resolutionRuntime.confirm({
      managerConversationId: input.managerConversationId,
      managerAgentRunId: input.managerAgentRunId,
      teamId: input.teamId,
      lanes,
      reviewerEvidence: input.reviewerEvidence,
      receiptId: input.receiptId,
      confirm: true,
    }) as Omit<SubTaskSupervisorFanInResult, "schemaVersion" | "contentMode">;
    validateResolutionResult(result);
    return {
      schemaVersion: SUBTASK_SUPERVISOR_FAN_IN_SCHEMA_VERSION,
      contentMode: "none",
      status: result.status,
      applied: result.applied,
      duplicateSideEffect: false,
      blockers: [...result.blockers],
      ...(result.auditArtifactId ? { auditArtifactId: result.auditArtifactId } : {}),
    };
  }

  private async collectValidatedLanes(input: SubTaskSupervisorFanInPreviewInput): Promise<ResolutionLane[]> {
    validateManagerBinding(input);
    validateReviewerEvidence(input.reviewerEvidence);
    if (!Array.isArray(input.lanes) || input.lanes.length === 0 || input.lanes.length > MAX_FAN_IN_LANES) {
      evidenceError(`Fan-in requires between 1 and ${MAX_FAN_IN_LANES} lanes.`);
    }

    const seenLaneIds = new Set<string>();
    const seenTaskIds = new Set<string>();
    const lanes: ResolutionLane[] = [];
    for (const lane of input.lanes) {
      validateLaneInput(input, lane, seenLaneIds, seenTaskIds);
      const record = await this.input.runtimeStore.getTask(lane.binding.taskId);
      validateRecord(record, lane);
      const artifact = await this.input.worktreeRuntime.collectFanInArtifact(record!);
      validateFanInArtifact(artifact, record!);
      lanes.push({
        binding: { ...lane.binding },
        revision: lane.expectedRevision,
        sourceRepoRoot: record!.launchSpec.worktreeRepoRoot!,
        artifact,
        testEvidence: lane.testEvidence,
      });
    }
    return lanes;
  }
}

function validateManagerBinding(input: SubTaskSupervisorFanInPreviewInput): void {
  for (const value of [input.managerConversationId, input.managerAgentRunId, input.teamId]) {
    if (!isSafeId(value)) evidenceError("Fan-in requires a valid manager Conversation/run and team binding.");
  }
}

function validateReviewerEvidence(evidence: SubTaskSupervisorReviewEvidence): void {
  if (evidence?.schemaVersion !== "subtask-supervisor-review-evidence/v1"
    || evidence.mode !== "read_only"
    || evidence.verdict !== "approved"
    || !validArtifactReference(evidence.artifact)) {
    evidenceError("Fan-in requires approved read-only reviewer evidence.");
  }
}

function validateLaneInput(
  input: SubTaskSupervisorFanInPreviewInput,
  lane: SubTaskSupervisorFanInPreviewInput["lanes"][number],
  seenLaneIds: Set<string>,
  seenTaskIds: Set<string>,
): void {
  const binding = lane?.binding;
  if (!binding
    || binding.managerConversationId !== input.managerConversationId
    || binding.managerAgentRunId !== input.managerAgentRunId
    || binding.teamId !== input.teamId
    || !isSafeId(binding.laneId)
    || !isSafeId(binding.taskId)
    || !isSafeId(binding.sessionId)
    || seenLaneIds.has(binding.laneId)
    || seenTaskIds.has(binding.taskId)
    || !Number.isSafeInteger(lane.expectedRevision)
    || lane.expectedRevision < 0) {
    evidenceError("Fan-in lane binding or revision is invalid.");
  }
  seenLaneIds.add(binding.laneId);
  seenTaskIds.add(binding.taskId);
  const evidence = lane.testEvidence;
  if (evidence?.schemaVersion !== "subtask-supervisor-test-evidence/v1"
    || evidence.taskId !== binding.taskId
    || evidence.sessionId !== binding.sessionId
    || evidence.revision !== lane.expectedRevision
    || evidence.status !== "passed"
    || !validArtifactReference(evidence.artifact)) {
    evidenceError("Fan-in requires passed test evidence bound to the current lane revision.");
  }
}

function validateRecord(
  record: FanInTaskRecord | undefined,
  lane: SubTaskSupervisorFanInPreviewInput["lanes"][number],
): void {
  const binding = lane.binding;
  if (!record
    || record.id !== binding.taskId
    || record.status !== "done"
    || record.sessionId !== binding.sessionId
    || (record.commandGeneration ?? 0) !== lane.expectedRevision
    || record.supervisorBinding?.managerConversationId !== binding.managerConversationId
    || record.supervisorBinding.managerAgentRunId !== binding.managerAgentRunId
    || record.supervisorBinding.teamId !== binding.teamId
    || record.supervisorBinding.laneId !== binding.laneId
    || record.supervisorBinding.mode !== "write"
    || record.launchSpec.isolationMode !== "worktree"
    || record.launchSpec.worktreeStatus !== "created"
    || !record.launchSpec.worktreePath
    || !record.launchSpec.worktreeRepoRoot
    || !record.launchSpec.worktreeBranch
    || !record.launchSpec.worktreeBaseRef) {
    evidenceError("Fan-in lane is not the current terminal isolated write owner.");
  }
}

function validateFanInArtifact(artifact: SubTaskSupervisorFanInArtifact, record: FanInTaskRecord): void {
  const complete = artifact?.status === "complete" || artifact?.status === "no_changes";
  if (artifact?.schemaVersion !== "subtask-worktree-fan-in-artifact/v1"
    || !complete
    || artifact.taskId !== record.id
    || artifact.baseRef !== record.launchSpec.worktreeBaseRef
    || !validPathReference(artifact.manifest)
    || (artifact.status === "complete" && !validPatchReference(artifact.patch))
    || !Array.isArray(artifact.changedPaths)
    || artifact.changedPaths.some((item) => typeof item !== "string" || !item.trim())) {
    evidenceError("Fan-in worktree diff artifact is incomplete or stale.");
  }
}

function validateResolutionPreview(
  resolution: SubTaskSupervisorFanInResolutionPreview,
  laneCount: number,
  now: number,
): void {
  if (!resolution
    || (resolution.status !== "ready" && resolution.status !== "conflict")
    || resolution.laneCount !== laneCount
    || !isSafeId(resolution.receipt?.id)
    || !Number.isSafeInteger(resolution.receipt.expiresAtMs)
    || resolution.receipt.expiresAtMs <= now
    || !Array.isArray(resolution.conflictPaths)) {
    throw new SubTaskSupervisorFanInError("fan_in_not_ready", "Fan-in resolution preview is unavailable.");
  }
}

function validateResolutionResult(
  result: Omit<SubTaskSupervisorFanInResult, "schemaVersion" | "contentMode">,
): void {
  if (!result
    || !["completed", "failed", "uncertain", "conflict"].includes(result.status)
    || typeof result.applied !== "boolean"
    || result.duplicateSideEffect !== false
    || !Array.isArray(result.blockers)
    || result.blockers.some((item) => typeof item !== "string" || !item.trim())
    || (result.auditArtifactId !== undefined && !isSafeId(result.auditArtifactId))) {
    throw new SubTaskSupervisorFanInError("fan_in_not_ready", "Fan-in resolution result is unavailable.");
  }
}

function validArtifactReference(value: SubTaskSupervisorArtifactReference | undefined): boolean {
  return Boolean(value && isSafeId(value.id) && SHA256_PATTERN.test(value.sha256));
}

function validPathReference(value: { path: string; sha256: string } | undefined): boolean {
  return Boolean(value && typeof value.path === "string" && value.path.trim() && SHA256_PATTERN.test(value.sha256));
}

function validPatchReference(value: { path: string; sha256: string; byteLength: number } | undefined): boolean {
  return Boolean(validPathReference(value)
    && Number.isSafeInteger(value?.byteLength)
    && Number(value?.byteLength) > 0);
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID_PATTERN.test(value);
}

function evidenceError(message: string): never {
  throw new SubTaskSupervisorFanInError("fan_in_evidence_invalid", message);
}
