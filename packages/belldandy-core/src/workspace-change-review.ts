import fs from "node:fs/promises";
import path from "node:path";

import {
  WorkspaceChangeSnapshotRuntime,
  type WorkspaceChangeSnapshot,
} from "./workspace-change-snapshot.js";
import { WorkspaceRevisionRuntime } from "./workspace-revision.js";

const REVIEW_VERSION = 1 as const;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DIFF_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

export type WorkspaceChangeReviewVerdict = "approved" | "needs_changes";

export type WorkspaceChangeReview = {
  version: typeof REVIEW_VERSION;
  reviewId: string;
  snapshotId: string;
  baselineId: string;
  revisionId?: string;
  diffHash: string;
  verdict: WorkspaceChangeReviewVerdict;
  createdAtMs: number;
};

export type WorkspaceChangeReviewVerification = {
  status: "valid" | "invalidated";
  review: WorkspaceChangeReview;
  currentSnapshot: WorkspaceChangeSnapshot;
};

export type WorkspaceChangeReviewRestoreVerification = WorkspaceChangeReviewVerification | {
  status: "not_applicable";
  reason: "restore_not_applied" | "review_unlinked" | "revision_mismatch";
  review: WorkspaceChangeReview;
};

export class WorkspaceChangeReviewRuntime {
  private readonly reviewsDirectory: string;
  private readonly snapshots: WorkspaceChangeSnapshotRuntime;
  private readonly revisions: WorkspaceRevisionRuntime;

  constructor(options: { stateDir: string; workspaceRevisionRuntime?: WorkspaceRevisionRuntime }) {
    const stateDir = path.resolve(options.stateDir);
    this.reviewsDirectory = path.join(stateDir, "artifacts", "workspace-change-snapshots", "reviews");
    this.snapshots = new WorkspaceChangeSnapshotRuntime({ stateDir });
    this.revisions = options.workspaceRevisionRuntime ?? new WorkspaceRevisionRuntime({ stateDir });
  }

  async record(input: {
    reviewId: string;
    snapshotId: string;
    diffHash: string;
    verdict: WorkspaceChangeReviewVerdict;
  }): Promise<WorkspaceChangeReview> {
    const reviewId = normalizeId(input.reviewId, "reviewId");
    const snapshotId = normalizeId(input.snapshotId, "snapshotId");
    const diffHash = normalizeDiffHash(input.diffHash);
    const verdict = normalizeVerdict(input.verdict);
    const snapshot = await this.snapshots.readSnapshot({ snapshotId });
    if (snapshot.diffHash !== diffHash) throw new Error("Workspace change review diff hash does not match its snapshot.");
    const review: WorkspaceChangeReview = {
      version: REVIEW_VERSION,
      reviewId,
      snapshotId,
      baselineId: snapshot.baseline.baselineId,
      ...(snapshot.revisionId ? { revisionId: snapshot.revisionId } : {}),
      diffHash,
      verdict,
      createdAtMs: Date.now(),
    };
    const reviewPath = path.join(this.reviewsDirectory, `${reviewId}.json`);
    await fs.mkdir(this.reviewsDirectory, { recursive: true, mode: 0o700 });
    try {
      await fs.writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`, { encoding: "utf-8", flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error("Workspace change review already exists.");
      }
      throw error;
    }
    return review;
  }

  async verify(input: { reviewId: string }): Promise<WorkspaceChangeReviewVerification> {
    const review = await this.loadReview(input.reviewId);
    return this.verifyLoadedReview(review);
  }

  async verifyAfterRestoreReceipt(input: {
    reviewId: string;
    receiptId: string;
  }): Promise<WorkspaceChangeReviewRestoreVerification> {
    const review = await this.loadReview(input.reviewId);
    if (!review.revisionId) {
      return { status: "not_applicable", reason: "review_unlinked", review };
    }
    const snapshot = await this.snapshots.readSnapshot({ snapshotId: review.snapshotId });
    if (
      snapshot.revisionId !== review.revisionId
      || snapshot.baseline.baselineId !== review.baselineId
      || snapshot.diffHash !== review.diffHash
    ) {
      throw new Error("Workspace change review linkage is invalid.");
    }
    await this.revisions.readRestoreReceipt({
      receiptId: normalizeId(input.receiptId, "receiptId"),
      revisionId: review.revisionId,
      workspaceRoot: snapshot.workspaceRoot,
    });
    return this.verifyLoadedReview(review);
  }

  private async verifyLoadedReview(review: WorkspaceChangeReview): Promise<WorkspaceChangeReviewVerification> {
    const currentSnapshot = await this.snapshots.createSnapshot({
      baselineId: review.baselineId,
      ...(review.revisionId ? { revisionId: review.revisionId } : {}),
    });
    return {
      status: currentSnapshot.diffHash === review.diffHash ? "valid" : "invalidated",
      review,
      currentSnapshot,
    };
  }

  private async loadReview(reviewIdInput: string): Promise<WorkspaceChangeReview> {
    const reviewId = normalizeId(reviewIdInput, "reviewId");
    const reviewPath = path.join(this.reviewsDirectory, `${reviewId}.json`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(reviewPath, "utf-8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Workspace change review was not found.");
      throw new Error("Workspace change review is invalid.");
    }
    if (!isRecord(parsed) || parsed.version !== REVIEW_VERSION) {
      throw new Error("Workspace change review is invalid.");
    }
    const parsedReviewId = normalizeIdValue(parsed.reviewId);
    const snapshotId = normalizeIdValue(parsed.snapshotId);
    const baselineId = normalizeIdValue(parsed.baselineId);
    const revisionId = parsed.revisionId === undefined ? undefined : normalizeIdValue(parsed.revisionId);
    const diffHash = isDiffHash(parsed.diffHash) ? parsed.diffHash : undefined;
    const verdict = isVerdict(parsed.verdict) ? parsed.verdict : undefined;
    const createdAtMs = typeof parsed.createdAtMs === "number" && Number.isSafeInteger(parsed.createdAtMs) && parsed.createdAtMs >= 0
      ? parsed.createdAtMs
      : undefined;
    if (parsedReviewId !== reviewId
      || !snapshotId
      || !baselineId
      || (parsed.revisionId !== undefined && !revisionId)
      || !diffHash
      || !verdict
      || createdAtMs === undefined) {
      throw new Error("Workspace change review is invalid.");
    }
    return {
      version: REVIEW_VERSION,
      reviewId: parsedReviewId,
      snapshotId,
      baselineId,
      ...(revisionId ? { revisionId } : {}),
      diffHash,
      verdict,
      createdAtMs,
    };
  }
}

function normalizeId(value: string, label: string): string {
  if (!ID_PATTERN.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function normalizeIdValue(value: unknown): string | undefined {
  return typeof value === "string" && ID_PATTERN.test(value) ? value : undefined;
}

function normalizeDiffHash(value: string): string {
  if (!isDiffHash(value)) throw new Error("Workspace change review diff hash is invalid.");
  return value;
}

function isDiffHash(value: unknown): value is string {
  return typeof value === "string" && DIFF_HASH_PATTERN.test(value);
}

function normalizeVerdict(value: WorkspaceChangeReviewVerdict): WorkspaceChangeReviewVerdict {
  if (!isVerdict(value)) throw new Error("Workspace change review verdict is invalid.");
  return value;
}

function isVerdict(value: unknown): value is WorkspaceChangeReviewVerdict {
  return value === "approved" || value === "needs_changes";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
