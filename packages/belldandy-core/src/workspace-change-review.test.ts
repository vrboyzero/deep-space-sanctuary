import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { WorkspaceChangeReviewRuntime } from "./workspace-change-review.js";
import { WorkspaceChangeSnapshotRuntime } from "./workspace-change-snapshot.js";
import { WorkspaceRevisionRuntime } from "./workspace-revision.js";

const execFile = promisify(execFileCallback);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    fs.rm(directory, { recursive: true, force: true })
  )));
});

async function createFixture(prefix: string) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(rootDir);
  const workspaceRoot = path.join(rootDir, "workspace");
  const stateDir = path.join(rootDir, "state");
  await fs.mkdir(workspaceRoot, { recursive: true });
  return { workspaceRoot, stateDir };
}

describe("WorkspaceChangeReviewRuntime", () => {
  it("keeps a verdict valid only while a fresh snapshot has the reviewed diff hash", async () => {
    const fixture = await createFixture("belldandy-change-review-filesystem-");
    const file = path.join(fixture.workspaceRoot, "note.txt");
    await fs.writeFile(file, "before\n", "utf-8");
    const snapshots = new WorkspaceChangeSnapshotRuntime({ stateDir: fixture.stateDir });
    const baseline = await snapshots.captureBaseline({
      baselineId: "review-filesystem-baseline",
      workspaceRoot: fixture.workspaceRoot,
      source: "run_start",
    });
    await fs.writeFile(file, "agent change\n", "utf-8");
    const snapshot = await snapshots.createSnapshot({
      baselineId: baseline.baselineId,
      revisionId: "review-checkpoint-1",
      recovery: { checkpoint: { checkpointId: "review-checkpoint-1", changedPaths: ["note.txt"] } },
    });
    const reviews = new WorkspaceChangeReviewRuntime({ stateDir: fixture.stateDir });

    const review = await reviews.record({
      reviewId: "review-filesystem-1",
      snapshotId: snapshot.snapshotId,
      diffHash: snapshot.diffHash,
      verdict: "approved",
    });

    await expect(reviews.verify({ reviewId: review.reviewId })).resolves.toMatchObject({
      status: "valid",
      review: { diffHash: snapshot.diffHash, verdict: "approved", revisionId: "review-checkpoint-1" },
      currentSnapshot: {
        revisionId: "review-checkpoint-1",
        recovery: { recoveryGuarantee: "detect_only", reason: "checkpoint_missing" },
      },
    });

    await fs.writeFile(file, "user change after review\n", "utf-8");
    await expect(reviews.verify({ reviewId: review.reviewId })).resolves.toMatchObject({
      status: "invalidated",
      review: { diffHash: snapshot.diffHash },
      currentSnapshot: { baseline: { baselineId: baseline.baselineId } },
    });
  });

  it("revalidates a linked review only from a matching runtime restore receipt", async () => {
    const fixture = await createFixture("belldandy-change-review-restore-");
    const file = path.join(fixture.workspaceRoot, "note.txt");
    await fs.writeFile(file, "before\n", "utf-8");
    const snapshots = new WorkspaceChangeSnapshotRuntime({ stateDir: fixture.stateDir });
    const revisions = new WorkspaceRevisionRuntime({ stateDir: fixture.stateDir });
    const baseline = await snapshots.captureBaseline({
      baselineId: "review-restore-baseline",
      workspaceRoot: fixture.workspaceRoot,
      source: "run_start",
    });
    const targets = [{ absolutePath: file, relativePath: "note.txt" }];
    await revisions.prepareMutations({
      revisionId: "review-restore-run-1",
      workspaceRoot: fixture.workspaceRoot,
      toolName: "file_write",
      targets,
    });
    await fs.writeFile(file, "agent change\n", "utf-8");
    await revisions.commitMutations({
      revisionId: "review-restore-run-1",
      workspaceRoot: fixture.workspaceRoot,
      toolName: "file_write",
      targets,
    });
    const snapshot = await snapshots.createSnapshot({
      baselineId: baseline.baselineId,
      revisionId: "review-restore-run-1",
    });
    const reviews = new WorkspaceChangeReviewRuntime({
      stateDir: fixture.stateDir,
      workspaceRevisionRuntime: revisions,
    });
    const linked = await reviews.record({
      reviewId: "review-restore-linked",
      snapshotId: snapshot.snapshotId,
      diffHash: snapshot.diffHash,
      verdict: "approved",
    });

    const snapshotsDirectory = path.join(
      fixture.stateDir,
      "artifacts",
      "workspace-change-snapshots",
      baseline.baselineId,
      "snapshots",
    );
    await expect(reviews.verifyAfterRestoreReceipt({
      reviewId: linked.reviewId,
      receiptId: "missing-receipt",
    })).rejects.toThrow(/receipt/i);
    expect(await fs.readdir(snapshotsDirectory)).toHaveLength(1);

    const restored = await revisions.restore({ revisionId: "review-restore-run-1", apply: true });
    expect(restored.receipt).toBeDefined();
    await expect(reviews.verifyAfterRestoreReceipt({
      reviewId: linked.reviewId,
      receiptId: String(restored.receipt?.receiptId),
    })).resolves.toMatchObject({
      status: "invalidated",
      review: { revisionId: "review-restore-run-1" },
      currentSnapshot: {
        revisionId: "review-restore-run-1",
        files: [],
      },
    });

    const unlinkedSnapshot = await snapshots.createSnapshot({ baselineId: baseline.baselineId });
    const unlinked = await reviews.record({
      reviewId: "review-restore-unlinked",
      snapshotId: unlinkedSnapshot.snapshotId,
      diffHash: unlinkedSnapshot.diffHash,
      verdict: "needs_changes",
    });
    await expect(reviews.verifyAfterRestoreReceipt({
      reviewId: unlinked.reviewId,
      receiptId: String(restored.receipt?.receiptId),
    })).resolves.toMatchObject({ status: "not_applicable", reason: "review_unlinked" });
  });

  it("rejects a forged hash and keeps Git index state untouched while checking a review", async () => {
    const fixture = await createFixture("belldandy-change-review-git-");
    await execFile("git", ["init"], { cwd: fixture.workspaceRoot });
    await execFile("git", ["config", "user.email", "review@example.com"], { cwd: fixture.workspaceRoot });
    await execFile("git", ["config", "user.name", "Review Test"], { cwd: fixture.workspaceRoot });
    const file = path.join(fixture.workspaceRoot, "note.txt");
    await fs.writeFile(file, "before\n", "utf-8");
    await execFile("git", ["add", "note.txt"], { cwd: fixture.workspaceRoot });
    await execFile("git", ["commit", "-m", "initial"], { cwd: fixture.workspaceRoot });
    const snapshots = new WorkspaceChangeSnapshotRuntime({ stateDir: fixture.stateDir });
    const baseline = await snapshots.captureBaseline({
      baselineId: "review-git-baseline",
      workspaceRoot: fixture.workspaceRoot,
      source: "run_start",
    });
    await fs.writeFile(file, "agent change\n", "utf-8");
    const snapshot = await snapshots.createSnapshot({ baselineId: baseline.baselineId });
    const reviews = new WorkspaceChangeReviewRuntime({ stateDir: fixture.stateDir });

    await expect(reviews.record({
      reviewId: "review-git-forged",
      snapshotId: snapshot.snapshotId,
      diffHash: "sha256:forged",
      verdict: "needs_changes",
    })).rejects.toThrow("diff hash");

    const review = await reviews.record({
      reviewId: "review-git-1",
      snapshotId: snapshot.snapshotId,
      diffHash: snapshot.diffHash,
      verdict: "needs_changes",
    });
    expect(review).not.toHaveProperty("revisionId");
    await expect(reviews.verify({ reviewId: review.reviewId })).resolves.toMatchObject({ status: "valid" });
    await expect(execFile("git", ["diff", "--cached", "--quiet"], { cwd: fixture.workspaceRoot })).resolves.toBeDefined();
  });

  it("does not invalidate a review with its own artifact when state storage is inside the workspace", async () => {
    const fixture = await createFixture("belldandy-change-review-self-storage-");
    const file = path.join(fixture.workspaceRoot, "note.txt");
    await fs.writeFile(file, "before\n", "utf-8");
    const snapshots = new WorkspaceChangeSnapshotRuntime({ stateDir: fixture.workspaceRoot });
    const baseline = await snapshots.captureBaseline({
      baselineId: "review-self-storage-baseline",
      workspaceRoot: fixture.workspaceRoot,
      source: "run_start",
    });
    await fs.writeFile(file, "agent change\n", "utf-8");
    const snapshot = await snapshots.createSnapshot({ baselineId: baseline.baselineId });
    const reviews = new WorkspaceChangeReviewRuntime({ stateDir: fixture.workspaceRoot });
    const review = await reviews.record({
      reviewId: "review-self-storage-1",
      snapshotId: snapshot.snapshotId,
      diffHash: snapshot.diffHash,
      verdict: "approved",
    });

    await expect(reviews.verify({ reviewId: review.reviewId })).resolves.toMatchObject({
      status: "valid",
      currentSnapshot: { files: [{ path: "note.txt", status: "modified" }] },
    });
  });
});
