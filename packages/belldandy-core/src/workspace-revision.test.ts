import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { WorkspaceRevisionRuntime } from "./workspace-revision.js";

async function createFixture(prefix: string) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const workspaceRoot = path.join(rootDir, "workspace");
  const stateDir = path.join(rootDir, "state");
  await fs.mkdir(workspaceRoot, { recursive: true });
  return { rootDir, workspaceRoot, stateDir };
}

function target(workspaceRoot: string, relativePath: string) {
  return { absolutePath: path.join(workspaceRoot, relativePath), relativePath };
}

describe("WorkspaceRevisionRuntime", () => {
  it("records first preimages for added, updated and deleted files, then previews and restores them", async () => {
    const fixture = await createFixture("belldandy-workspace-revision-");
    try {
      await fs.writeFile(path.join(fixture.workspaceRoot, "update.txt"), "before update", "utf-8");
      await fs.writeFile(path.join(fixture.workspaceRoot, "delete.txt"), "before delete", "utf-8");
      const runtime = new WorkspaceRevisionRuntime({ stateDir: fixture.stateDir });
      const revisionId = "run-workspace-revision-1";
      const targets = [
        target(fixture.workspaceRoot, "add.txt"),
        target(fixture.workspaceRoot, "update.txt"),
        target(fixture.workspaceRoot, "delete.txt"),
      ];

      await runtime.prepareMutations({ revisionId, workspaceRoot: fixture.workspaceRoot, toolName: "apply_patch", targets });
      await fs.writeFile(path.join(fixture.workspaceRoot, "add.txt"), "added", "utf-8");
      await fs.writeFile(path.join(fixture.workspaceRoot, "update.txt"), "after update", "utf-8");
      await fs.unlink(path.join(fixture.workspaceRoot, "delete.txt"));
      await runtime.commitMutations({ revisionId, workspaceRoot: fixture.workspaceRoot, toolName: "apply_patch", targets });

      await runtime.prepareMutations({
        revisionId,
        workspaceRoot: fixture.workspaceRoot,
        toolName: "file_write",
        targets: [target(fixture.workspaceRoot, "update.txt")],
      });
      await fs.writeFile(path.join(fixture.workspaceRoot, "update.txt"), "after second update", "utf-8");
      await runtime.commitMutations({
        revisionId,
        workspaceRoot: fixture.workspaceRoot,
        toolName: "file_write",
        targets: [target(fixture.workspaceRoot, "update.txt")],
      });

      await expect(runtime.list()).resolves.toEqual([
        expect.objectContaining({ revisionId, changedFileCount: 3, recoveryGuarantee: "exact" }),
      ]);
      const preview = await runtime.previewRestore({ revisionId });
      expect(preview.canRestore).toBe(true);
      expect(preview.changes).toEqual(expect.arrayContaining([
        expect.objectContaining({ relativePath: "add.txt", action: "delete" }),
        expect.objectContaining({ relativePath: "update.txt", action: "restore" }),
        expect.objectContaining({ relativePath: "delete.txt", action: "restore" }),
      ]));

      const dryRun = await runtime.restore({ revisionId });
      expect(dryRun.applied).toBe(false);
      expect(dryRun.receipt).toBeUndefined();
      expect(await fs.readFile(path.join(fixture.workspaceRoot, "update.txt"), "utf-8")).toBe("after second update");

      const restored = await runtime.restore({ revisionId, apply: true });
      expect(restored.applied).toBe(true);
      expect(restored.receipt).toMatchObject({
        version: 1,
        receiptId: expect.stringMatching(/^restore-/),
        revisionId,
        restoredAtMs: expect.any(Number),
      });
      await expect(runtime.readRestoreReceipt({
        receiptId: String(restored.receipt?.receiptId),
        revisionId,
        workspaceRoot: fixture.workspaceRoot,
      })).resolves.toEqual(restored.receipt);
      const otherWorkspaceRoot = path.join(fixture.rootDir, "other-workspace");
      const otherFile = path.join(otherWorkspaceRoot, "note.txt");
      await fs.mkdir(otherWorkspaceRoot, { recursive: true });
      await fs.writeFile(otherFile, "before", "utf-8");
      await runtime.prepareMutations({
        revisionId,
        workspaceRoot: otherWorkspaceRoot,
        toolName: "file_write",
        targets: [{ absolutePath: otherFile, relativePath: "note.txt" }],
      });
      await expect(runtime.readRestoreReceipt({
        receiptId: String(restored.receipt?.receiptId),
        revisionId,
        workspaceRoot: otherWorkspaceRoot,
      })).rejects.toThrow(/receipt was not found/i);
      const receiptPath = path.join(
        fixture.stateDir,
        "workspace-revisions",
        String(restored.receipt?.workspaceId),
        revisionId,
        "restore-receipts",
        `${String(restored.receipt?.receiptId)}.json`,
      );
      await fs.writeFile(receiptPath, "{not-json", "utf-8");
      await expect(runtime.readRestoreReceipt({
        receiptId: String(restored.receipt?.receiptId),
        revisionId,
        workspaceRoot: fixture.workspaceRoot,
      })).rejects.toThrow(/receipt is invalid/i);
      await expect(fs.access(path.join(fixture.workspaceRoot, "add.txt"))).rejects.toThrow();
      await expect(fs.readFile(path.join(fixture.workspaceRoot, "update.txt"), "utf-8")).resolves.toBe("before update");
      await expect(fs.readFile(path.join(fixture.workspaceRoot, "delete.txt"), "utf-8")).resolves.toBe("before delete");
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it("persists operation-level evidence and commits only after every prepared target", async () => {
    const fixture = await createFixture("belldandy-workspace-revision-operation-");
    try {
      const runtime = new WorkspaceRevisionRuntime({ stateDir: fixture.stateDir });
      const revisionId = "run-workspace-operation-1";
      const operation = {
        conversationId: "conversation-workspace-operation-1",
        agentRunId: revisionId,
        toolCallId: "tool-call-sensitive-operation-1",
      };
      const operationId = createOperationId(operation);
      const targets = [
        target(fixture.workspaceRoot, "first.txt"),
        target(fixture.workspaceRoot, "second.txt"),
      ];

      await runtime.prepareMutations({
        revisionId,
        workspaceRoot: fixture.workspaceRoot,
        toolName: "apply_patch",
        targets,
        operation,
      });
      await expect(runtime.getOperationEvidence({ revisionId, operationId })).resolves.toMatchObject({
        operationId,
        state: "prepared",
        workspaceCount: 1,
        targetCount: 2,
        committedTargetCount: 0,
      });

      await fs.writeFile(path.join(fixture.workspaceRoot, "first.txt"), "first", "utf-8");
      await runtime.commitMutations({
        revisionId,
        workspaceRoot: fixture.workspaceRoot,
        toolName: "apply_patch",
        targets: [targets[0]!],
        operation,
      });
      await expect(runtime.getOperationEvidence({ revisionId, operationId })).resolves.toMatchObject({
        state: "prepared",
        targetCount: 2,
        committedTargetCount: 1,
      });

      await fs.writeFile(path.join(fixture.workspaceRoot, "second.txt"), "second", "utf-8");
      await runtime.commitMutations({
        revisionId,
        workspaceRoot: fixture.workspaceRoot,
        toolName: "apply_patch",
        targets: [targets[1]!],
        operation,
      });
      const restarted = new WorkspaceRevisionRuntime({ stateDir: fixture.stateDir });
      await expect(restarted.getOperationEvidence({ revisionId, operationId })).resolves.toMatchObject({
        operationId,
        state: "committed",
        workspaceCount: 1,
        targetCount: 2,
        committedTargetCount: 2,
      });
      await expect(restarted.prepareMutations({
        revisionId,
        workspaceRoot: fixture.workspaceRoot,
        toolName: "apply_patch",
        targets,
        operation,
      })).rejects.toThrow("already prepared");

      const [summary] = await restarted.list();
      const manifest = await fs.readFile(path.join(
        fixture.stateDir,
        "workspace-revisions",
        String(summary?.workspaceId),
        revisionId,
        "manifest.json",
      ), "utf-8");
      expect(manifest).toContain(operationId);
      expect(manifest).not.toContain(operation.toolCallId);
      expect(manifest).not.toContain(operation.conversationId);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it("refuses restore when a file changed after its recorded tool mutation", async () => {
    const fixture = await createFixture("belldandy-workspace-revision-conflict-");
    try {
      const file = path.join(fixture.workspaceRoot, "note.txt");
      await fs.writeFile(file, "before", "utf-8");
      const runtime = new WorkspaceRevisionRuntime({ stateDir: fixture.stateDir });
      const revisionId = "run-workspace-revision-conflict";
      const targets = [target(fixture.workspaceRoot, "note.txt")];

      await runtime.prepareMutations({ revisionId, workspaceRoot: fixture.workspaceRoot, toolName: "file_write", targets });
      await fs.writeFile(file, "agent change", "utf-8");
      await runtime.commitMutations({ revisionId, workspaceRoot: fixture.workspaceRoot, toolName: "file_write", targets });
      await fs.writeFile(file, "user change", "utf-8");

      const preview = await runtime.previewRestore({ revisionId });
      expect(preview.canRestore).toBe(false);
      expect(preview.changes).toEqual([
        expect.objectContaining({
          relativePath: "note.txt",
          action: "conflict",
          recordedAfterHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          currentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]);
      expect(preview.conflictArtifact).toMatchObject({
        artifactPath: expect.any(String),
        conflictCount: 1,
      });
      const artifact = await fs.readFile(String(preview.conflictArtifact?.artifactPath), "utf-8");
      expect(artifact).toContain('"relativePath": "note.txt"');
      expect(artifact).toContain('"recordedAfterHash"');
      expect(artifact).toContain('"currentHash"');
      expect(artifact).not.toContain("agent change");
      expect(artifact).not.toContain("user change");
      expect(artifact).not.toContain(fixture.workspaceRoot);
      const failedRestore = await runtime.restore({ revisionId, apply: true });
      expect(failedRestore).toMatchObject({
        applied: false,
        canRestore: false,
        conflictArtifact: { conflictCount: 1 },
      });
      expect(failedRestore).not.toHaveProperty("receipt");
      await expect(fs.readFile(file, "utf-8")).resolves.toBe("user change");
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it("stops an apply before every workspace write when any checkpoint target conflicts", async () => {
    const fixture = await createFixture("belldandy-workspace-revision-atomic-conflict-");
    try {
      const first = path.join(fixture.workspaceRoot, "first.txt");
      const second = path.join(fixture.workspaceRoot, "second.txt");
      await fs.writeFile(first, "before first", "utf-8");
      await fs.writeFile(second, "before second", "utf-8");
      const runtime = new WorkspaceRevisionRuntime({ stateDir: fixture.stateDir });
      const revisionId = "run-workspace-revision-atomic-conflict";
      const targets = [target(fixture.workspaceRoot, "first.txt"), target(fixture.workspaceRoot, "second.txt")];
      await runtime.prepareMutations({ revisionId, workspaceRoot: fixture.workspaceRoot, toolName: "apply_patch", targets });
      await fs.writeFile(first, "agent first", "utf-8");
      await fs.writeFile(second, "agent second", "utf-8");
      await runtime.commitMutations({ revisionId, workspaceRoot: fixture.workspaceRoot, toolName: "apply_patch", targets });
      await fs.writeFile(second, "user second", "utf-8");

      await expect(runtime.restore({ revisionId, apply: true })).resolves.toMatchObject({
        applied: false,
        canRestore: false,
        changes: expect.arrayContaining([
          expect.objectContaining({ relativePath: "second.txt", action: "conflict" }),
        ]),
      });
      await expect(fs.readFile(first, "utf-8")).resolves.toBe("agent first");
      await expect(fs.readFile(second, "utf-8")).resolves.toBe("user second");
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it("rechecks every target after dry-run and before the first restore write", async () => {
    const fixture = await createFixture("belldandy-workspace-revision-race-gate-");
    try {
      const first = path.join(fixture.workspaceRoot, "first.txt");
      const second = path.join(fixture.workspaceRoot, "second.txt");
      await fs.writeFile(first, "before first", "utf-8");
      await fs.writeFile(second, "before second", "utf-8");
      const runtime = new WorkspaceRevisionRuntime({ stateDir: fixture.stateDir });
      const revisionId = "run-workspace-revision-race-gate";
      const targets = [target(fixture.workspaceRoot, "first.txt"), target(fixture.workspaceRoot, "second.txt")];
      await runtime.prepareMutations({ revisionId, workspaceRoot: fixture.workspaceRoot, toolName: "apply_patch", targets });
      await fs.writeFile(first, "agent first", "utf-8");
      await fs.writeFile(second, "agent second", "utf-8");
      await runtime.commitMutations({ revisionId, workspaceRoot: fixture.workspaceRoot, toolName: "apply_patch", targets });

      const originalPreview = runtime.previewRestore.bind(runtime);
      let previewCalls = 0;
      vi.spyOn(runtime, "previewRestore").mockImplementation(async (input) => {
        previewCalls += 1;
        if (previewCalls === 2) await fs.writeFile(second, "user second", "utf-8");
        return originalPreview(input);
      });

      await expect(runtime.restore({ revisionId, apply: true })).resolves.toMatchObject({
        applied: false,
        changes: expect.arrayContaining([expect.objectContaining({ relativePath: "second.txt", action: "conflict" })]),
      });
      await expect(fs.readFile(first, "utf-8")).resolves.toBe("agent first");
      await expect(fs.readFile(second, "utf-8")).resolves.toBe("user second");
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it("stops before overwriting a target changed after the final restore gate", async () => {
    const fixture = await createFixture("belldandy-workspace-revision-post-gate-race-");
    try {
      const first = path.join(fixture.workspaceRoot, "first.txt");
      const second = path.join(fixture.workspaceRoot, "second.txt");
      await fs.writeFile(first, "before first", "utf-8");
      await fs.writeFile(second, "before second", "utf-8");
      const runtime = new WorkspaceRevisionRuntime({ stateDir: fixture.stateDir });
      const revisionId = "run-workspace-revision-post-gate-race";
      const targets = [target(fixture.workspaceRoot, "first.txt"), target(fixture.workspaceRoot, "second.txt")];
      await runtime.prepareMutations({ revisionId, workspaceRoot: fixture.workspaceRoot, toolName: "apply_patch", targets });
      await fs.writeFile(first, "agent first", "utf-8");
      await fs.writeFile(second, "agent second", "utf-8");
      await runtime.commitMutations({ revisionId, workspaceRoot: fixture.workspaceRoot, toolName: "apply_patch", targets });

      const originalPreview = runtime.previewRestore.bind(runtime);
      let previewCalls = 0;
      vi.spyOn(runtime, "previewRestore").mockImplementation(async (input) => {
        const preview = await originalPreview(input);
        previewCalls += 1;
        if (previewCalls === 2) await fs.writeFile(second, "user second", "utf-8");
        return preview;
      });

      const result = await runtime.restore({ revisionId, apply: true });

      expect(result).toMatchObject({
        applied: false,
        canRestore: false,
        changes: expect.arrayContaining([expect.objectContaining({ relativePath: "second.txt", action: "conflict" })]),
        conflictArtifact: { conflictCount: 1 },
      });
      expect(result).not.toHaveProperty("receipt");
      await expect(fs.readFile(first, "utf-8")).resolves.toBe("before first");
      await expect(fs.readFile(second, "utf-8")).resolves.toBe("user second");
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it("rejects symbolic links, oversized preimages and the checkpoint storage directory", async () => {
    const fixture = await createFixture("belldandy-workspace-revision-safety-");
    try {
      const runtime = new WorkspaceRevisionRuntime({ stateDir: fixture.workspaceRoot, maxFileBytes: 4 });
      const revisionId = "run-workspace-revision-safety";
      await fs.writeFile(path.join(fixture.workspaceRoot, "large.txt"), "large", "utf-8");
      await expect(runtime.prepareMutations({
        revisionId,
        workspaceRoot: fixture.workspaceRoot,
        toolName: "file_write",
        targets: [target(fixture.workspaceRoot, "large.txt")],
      })).rejects.toThrow(/too large/i);
      await expect(runtime.prepareMutations({
        revisionId,
        workspaceRoot: fixture.workspaceRoot,
        toolName: "file_write",
        targets: [target(fixture.workspaceRoot, "workspace-revisions/forbidden.txt")],
      })).rejects.toThrow(/checkpoint storage/i);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});

function createOperationId(input: { conversationId: string; agentRunId: string; toolCallId: string }): string {
  return `op_${crypto.createHash("sha256")
    .update(`conversation\0${input.conversationId}\0${input.agentRunId}\0${input.toolCallId}`)
    .digest("hex")}`;
}
