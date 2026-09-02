import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  addCandidateGitDeliveryEvidence,
  readEvidenceReference,
  withSafetyEvidenceFixture,
} from "./coding-agent-candidate-dimension-evidence-fixtures.mjs";
import { runCodingAgentCandidateGitDeliveryReceipt } from "./coding-agent-candidate-git-delivery-receipt.mjs";
import { loadCodingAgentCandidateDimensionEvidence } from "./coding-agent-candidate-score.mjs";

describe("candidate Git delivery evidence receipt", () => {
  it("binds all four Git delivery contracts through the public loader", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateGitDeliveryEvidence(aggregateRoot, { writeReceipt: false });
      const receipt = await runCodingAgentCandidateGitDeliveryReceipt({ aggregateRoot, generatedAt: "2026-09-02T16:10:00.000Z" });
      expect(receipt.summary).toEqual({
        multiRepositoryWorktreeSoak: true,
        reviewRemediationLoop: true,
        remoteDeliveryAuthoritySeparation: true,
        deliveryRecoveryAuditMatrix: true,
      });
      const result = await loadCodingAgentCandidateDimensionEvidence({ aggregateRoot, verifiedAggregate: { report, baselineIndex } });
      expect(result.dimensions.find(({ id }) => id === "git_delivery")).toMatchObject({ id: "git_delivery", status: "complete", missingEvidenceContracts: [] });
    });
  });

  it("projects a trustworthy platform failure as failed", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateGitDeliveryEvidence(aggregateRoot, { failedPlatform: "wsl2-linux" });
      const result = await loadCodingAgentCandidateDimensionEvidence({ aggregateRoot, verifiedAggregate: { report, baselineIndex } });
      expect(result.dimensions.find(({ id }) => id === "git_delivery")).toMatchObject({
        status: "failed",
        failedEvidenceContracts: [
          { id: "multi_repository_worktree_soak", status: "failed" },
          { id: "review_remediation_loop", status: "failed" },
          { id: "delivery_recovery_audit_matrix", status: "failed" },
        ],
        resolvedEvidenceContracts: [{ id: "remote_delivery_authority_separation", status: "complete" }],
      });
    });
  });

  it("rolls back receipt and reference when a required artifact is missing", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot }) => {
      await addCandidateGitDeliveryEvidence(aggregateRoot, { writeReceipt: false });
      await fs.rm(path.join(aggregateRoot, "candidate-evidence/git-delivery/review-remediation-loop.json"));
      await expect(runCodingAgentCandidateGitDeliveryReceipt({ aggregateRoot })).rejects.toThrow(/missing or unreadable/i);
      await expect(fs.lstat(path.join(aggregateRoot, "candidate-git-delivery-evidence-receipt.json"))).rejects.toThrow();
      const reference = await readEvidenceReference(aggregateRoot);
      expect(reference.owners.candidateGitDeliveryReceipt).toBeUndefined();
    });
  });
});
