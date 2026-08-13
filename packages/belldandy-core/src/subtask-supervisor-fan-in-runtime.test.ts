import { describe, expect, it, vi } from "vitest";

import { SubTaskSupervisorFanInRuntime } from "./subtask-supervisor-fan-in-runtime.js";

const managerBinding = {
  managerConversationId: "conversation-manager",
  managerAgentRunId: "run-manager",
  teamId: "team-parallel",
};

const laneBinding = {
  ...managerBinding,
  laneId: "lane_1",
  taskId: "task-lane-1",
  sessionId: "session-lane-1",
};

function terminalLaneRecord() {
  return {
    id: laneBinding.taskId,
    status: "done" as const,
    sessionId: laneBinding.sessionId,
    commandGeneration: 2,
    supervisorBinding: { ...managerBinding, laneId: laneBinding.laneId, mode: "write" as const },
    launchSpec: {
      isolationMode: "worktree",
      worktreePath: "C:\\state\\worktrees\\task-lane-1",
      worktreeRepoRoot: "C:\\repo",
      worktreeBranch: "belldandy-task-lane-1",
      worktreeBaseRef: "a".repeat(40),
      worktreeStatus: "created" as const,
    },
  };
}

function previewInput() {
  return {
    ...managerBinding,
    lanes: [{
      binding: laneBinding,
      expectedRevision: 2,
      testEvidence: {
        schemaVersion: "subtask-supervisor-test-evidence/v1" as const,
        taskId: laneBinding.taskId,
        sessionId: laneBinding.sessionId,
        revision: 2,
        status: "passed" as const,
        artifact: { id: "vitest-report-lane-1", sha256: "b".repeat(64) },
      },
    }],
    reviewerEvidence: {
      schemaVersion: "subtask-supervisor-review-evidence/v1" as const,
      mode: "read_only" as const,
      verdict: "approved" as const,
      artifact: { id: "review-lane-1", sha256: "c".repeat(64) },
    },
  };
}

describe("SubTaskSupervisorFanInRuntime", () => {
  it("previews only exact terminal write lanes with diff, test, and read-only review evidence", async () => {
    const record = terminalLaneRecord();
    const collectArtifact = vi.fn(async () => ({
      schemaVersion: "subtask-worktree-fan-in-artifact/v1" as const,
      taskId: record.id,
      status: "complete" as const,
      baseRef: record.launchSpec.worktreeBaseRef,
      patch: { path: "C:\\state\\artifacts\\task-lane-1\\changes.patch", sha256: "d".repeat(64), byteLength: 128 },
      manifest: { path: "C:\\state\\artifacts\\task-lane-1\\manifest.json", sha256: "e".repeat(64) },
      changedPaths: ["src/lane-1.ts"],
    }));
    const previewResolution = vi.fn(async () => ({
      status: "ready" as const,
      receipt: { id: "fan-in-receipt-1", expiresAtMs: 20_000 },
      laneCount: 1,
      conflictPaths: [],
    }));
    const confirmResolution = vi.fn(async () => ({
      status: "completed" as const,
      applied: true,
      duplicateSideEffect: false as const,
      blockers: [],
      auditArtifactId: "fan-in-audit-1",
    }));
    const runtime = new SubTaskSupervisorFanInRuntime({
      runtimeStore: { getTask: vi.fn(async () => record) },
      worktreeRuntime: { collectFanInArtifact: collectArtifact },
      resolutionRuntime: { preview: previewResolution, confirm: confirmResolution },
      now: () => 10_000,
    });

    await expect(runtime.preview(previewInput())).resolves.toMatchObject({
      status: "ready",
      contentMode: "none",
      receipt: { id: "fan-in-receipt-1" },
      lanes: [{ binding: laneBinding, revision: 2, changedPaths: ["src/lane-1.ts"] }],
      reviewer: { mode: "read_only", verdict: "approved" },
    });
    expect(collectArtifact).toHaveBeenCalledWith(record);
    expect(previewResolution).toHaveBeenCalledTimes(1);
    expect(previewResolution).toHaveBeenCalledWith(expect.objectContaining({
      lanes: [expect.objectContaining({ sourceRepoRoot: record.launchSpec.worktreeRepoRoot })],
    }));

    await expect(runtime.confirm({
      ...previewInput(),
      receiptId: "fan-in-receipt-1",
      confirm: true,
    })).resolves.toEqual({
      schemaVersion: "subtask-supervisor-fan-in/v1",
      contentMode: "none",
      status: "completed",
      applied: true,
      duplicateSideEffect: false,
      blockers: [],
      auditArtifactId: "fan-in-audit-1",
    });
    expect(confirmResolution).toHaveBeenCalledTimes(1);

    const invalidInputs: unknown[] = [
      { ...previewInput(), lanes: [{ ...previewInput().lanes[0], expectedRevision: 1 }] },
      { ...previewInput(), lanes: [{ ...previewInput().lanes[0], binding: { ...laneBinding, sessionId: "stale-session" } }] },
      { ...previewInput(), lanes: [{ ...previewInput().lanes[0], testEvidence: { ...previewInput().lanes[0].testEvidence, status: "failed" as const } }] },
      { ...previewInput(), reviewerEvidence: { ...previewInput().reviewerEvidence, mode: "workspace_write" as const } },
    ];
    for (const invalid of invalidInputs) {
      previewResolution.mockClear();
      collectArtifact.mockClear();
      await expect(runtime.preview(invalid as ReturnType<typeof previewInput>))
        .rejects.toMatchObject({ code: "fan_in_evidence_invalid" });
      expect(previewResolution).not.toHaveBeenCalled();
    }
  });
});
