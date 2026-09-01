import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  addCandidateCodingRunClientCiEvidence,
  readEvidenceReference,
  serializeJson,
  sha256,
  withSafetyEvidenceFixture,
  writeEvidenceReference,
  writeRelativeFile,
} from "./coding-agent-candidate-dimension-evidence-fixtures.mjs";
import { loadCodingAgentCandidateDimensionEvidence } from "./coding-agent-candidate-score.mjs";

describe("coding agent candidate coding-run client CI evidence", () => {
  it("rejects a GitHub job that ambiguously claims both required runner platforms", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodingRunClientCiEvidence(aggregateRoot);
      const { receipt, reference, receiptPath } = await readCiReceipt(
        aggregateRoot,
      );
      const jobsPath = receipt.github.apiEvidence.jobs.path;
      const jobs = JSON.parse(await fs.readFile(
        path.join(aggregateRoot, ...jobsPath.split("/")),
        "utf-8",
      ));
      jobs.jobs[0].labels = ["ubuntu-latest", "windows-latest"];
      const jobsText = serializeJson(jobs);
      await writeRelativeFile(aggregateRoot, jobsPath, jobsText);
      receipt.github.apiEvidence.jobs.sha256 = sha256(jobsText);
      await resealCiReceipt({ aggregateRoot, receipt, reference, receiptPath });

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/ubuntu-latest GitHub job binding drifted/i);
    });
  });

  it("rejects a self-consistent GitHub job whose verification timeline is reversed", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodingRunClientCiEvidence(aggregateRoot);
      const { receipt, reference, receiptPath } = await readCiReceipt(aggregateRoot);
      const jobsPath = receipt.github.apiEvidence.jobs.path;
      const jobs = JSON.parse(await fs.readFile(
        path.join(aggregateRoot, ...jobsPath.split("/")),
        "utf-8",
      ));
      const lane = receipt.lanes[0];
      const job = jobs.jobs.find(({ id }) => id === lane.job.id);
      const verificationStep = job.steps.find(
        ({ number }) => number === lane.verificationStep.number,
      );
      const reversedStart = "2026-09-01T13:04:30.000Z";
      const reversedEnd = "2026-09-01T13:03:30.000Z";
      verificationStep.started_at = reversedStart;
      verificationStep.completed_at = reversedEnd;
      lane.verificationStep.startedAt = reversedStart;
      lane.verificationStep.completedAt = reversedEnd;
      const jobsText = serializeJson(jobs);
      await writeRelativeFile(aggregateRoot, jobsPath, jobsText);
      receipt.github.apiEvidence.jobs.sha256 = sha256(jobsText);
      await resealCiReceipt({ aggregateRoot, receipt, reference, receiptPath });

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/ubuntu-latest CI timeline drifted/i);
    });
  });

  it("rejects a self-consistent artifact whose expiry predates its creation", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodingRunClientCiEvidence(aggregateRoot);
      const { receipt, reference, receiptPath } = await readCiReceipt(aggregateRoot);
      const artifactsPath = receipt.github.apiEvidence.artifacts.path;
      const artifacts = JSON.parse(await fs.readFile(
        path.join(aggregateRoot, ...artifactsPath.split("/")),
        "utf-8",
      ));
      const lane = receipt.lanes[0];
      const artifact = artifacts.artifacts.find(({ id }) => id === lane.artifact.id);
      const impossibleExpiry = "2026-08-31T13:04:10.000Z";
      artifact.expires_at = impossibleExpiry;
      lane.artifact.expiresAt = impossibleExpiry;
      const artifactsText = serializeJson(artifacts);
      await writeRelativeFile(aggregateRoot, artifactsPath, artifactsText);
      receipt.github.apiEvidence.artifacts.sha256 = sha256(artifactsText);
      await resealCiReceipt({ aggregateRoot, receipt, reference, receiptPath });

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/ubuntu-latest GitHub artifact lifecycle drifted/i);
    });
  });

  it("rejects a GitHub artifact whose update predates its creation", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodingRunClientCiEvidence(aggregateRoot);
      const { receipt, reference, receiptPath } = await readCiReceipt(aggregateRoot);
      const artifactsPath = receipt.github.apiEvidence.artifacts.path;
      const artifacts = JSON.parse(await fs.readFile(
        path.join(aggregateRoot, ...artifactsPath.split("/")),
        "utf-8",
      ));
      artifacts.artifacts[0].updated_at = "2026-09-01T13:04:00.000Z";
      const artifactsText = serializeJson(artifacts);
      await writeRelativeFile(aggregateRoot, artifactsPath, artifactsText);
      receipt.github.apiEvidence.artifacts.sha256 = sha256(artifactsText);
      await resealCiReceipt({ aggregateRoot, receipt, reference, receiptPath });

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/ubuntu-latest GitHub artifact lifecycle drifted/i);
    });
  });

  it("rejects duplicate GitHub artifact names even when their ids are unique", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodingRunClientCiEvidence(aggregateRoot);
      const { receipt, reference, receiptPath } = await readCiReceipt(aggregateRoot);
      const artifactsPath = receipt.github.apiEvidence.artifacts.path;
      const artifacts = JSON.parse(await fs.readFile(
        path.join(aggregateRoot, ...artifactsPath.split("/")),
        "utf-8",
      ));
      artifacts.artifacts.push({
        ...artifacts.artifacts[0],
        id: 9_768_000_099,
      });
      artifacts.total_count = artifacts.artifacts.length;
      const artifactsText = serializeJson(artifacts);
      await writeRelativeFile(aggregateRoot, artifactsPath, artifactsText);
      receipt.github.apiEvidence.artifacts.sha256 = sha256(artifactsText);
      await resealCiReceipt({ aggregateRoot, receipt, reference, receiptPath });

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/GitHub artifact name is missing or duplicated/i);
    });
  });

  it("rejects duplicate verification step names that let a receipt select one outcome", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodingRunClientCiEvidence(aggregateRoot);
      const { receipt, reference, receiptPath } = await readCiReceipt(aggregateRoot);
      const jobsPath = receipt.github.apiEvidence.jobs.path;
      const jobs = JSON.parse(await fs.readFile(
        path.join(aggregateRoot, ...jobsPath.split("/")),
        "utf-8",
      ));
      const job = jobs.jobs.find(({ id }) => id === receipt.lanes[0].job.id);
      job.steps.push({
        ...job.steps[0],
        number: 7,
        conclusion: "failure",
      });
      const jobsText = serializeJson(jobs);
      await writeRelativeFile(aggregateRoot, jobsPath, jobsText);
      receipt.github.apiEvidence.jobs.sha256 = sha256(jobsText);
      await resealCiReceipt({ aggregateRoot, receipt, reference, receiptPath });

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/GitHub verification step name is missing or duplicated/i);
    });
  });

  it("rejects duplicate matrix job names that let a receipt select one outcome", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodingRunClientCiEvidence(aggregateRoot);
      const { receipt, reference, receiptPath } = await readCiReceipt(aggregateRoot);
      const jobsPath = receipt.github.apiEvidence.jobs.path;
      const jobs = JSON.parse(await fs.readFile(
        path.join(aggregateRoot, ...jobsPath.split("/")),
        "utf-8",
      ));
      jobs.jobs.push({
        ...jobs.jobs[0],
        id: 99_566_546_999,
        conclusion: "failure",
      });
      jobs.total_count = jobs.jobs.length;
      const jobsText = serializeJson(jobs);
      await writeRelativeFile(aggregateRoot, jobsPath, jobsText);
      receipt.github.apiEvidence.jobs.sha256 = sha256(jobsText);
      await resealCiReceipt({ aggregateRoot, receipt, reference, receiptPath });

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/GitHub job name is missing or duplicated/i);
    });
  });

  it("rejects a self-consistent lane receipt generated before its verification completed", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodingRunClientCiEvidence(aggregateRoot, {
        laneGeneratedAtByPlatform: {
          "ubuntu-latest": "2026-09-01T13:02:00.000Z",
        },
      });

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/ubuntu-latest lane receipt timeline drifted/i);
    });
  });

  it("projects one trustworthy failed CI lane as failed without rejecting other contracts", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodingRunClientCiEvidence(aggregateRoot, {
        laneStatusByPlatform: {
          "windows-latest": "failed",
        },
      });

      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });

      expect(result.status).toBe("failed");
      expect(result.dimensions.find(({ id }) => id === "headless_ecosystem")).toEqual({
        id: "headless_ecosystem",
        status: "failed",
        resolvedEvidenceContracts: [],
        failedEvidenceContracts: [{
          id: "real_ci_consumer_binding",
          owner: "candidateCodingRunClientCiReceipt",
          completion: "current_harness_dual_platform_github_actions_coding_run_client_passed",
          status: "failed",
        }],
        missingEvidenceContracts: [
          "external_consumer_pair_lifecycle",
          "protocol_version_conformance",
          "error_taxonomy_cancellation_conformance",
        ],
      });
      expect(result.dimensions.filter(({ status }) => status === "failed")).toHaveLength(1);
      expect(result.dimensions.every((dimension) => !("score" in dimension))).toBe(true);
    });
  });
});

async function readCiReceipt(aggregateRoot) {
  const reference = await readEvidenceReference(aggregateRoot);
  const receiptPath = reference.owners.candidateCodingRunClientCiReceipt.artifact.path;
  const receipt = JSON.parse(await fs.readFile(
    path.join(aggregateRoot, ...receiptPath.split("/")),
    "utf-8",
  ));
  return { receipt, reference, receiptPath };
}

async function resealCiReceipt({ aggregateRoot, receipt, reference, receiptPath }) {
  const receiptText = serializeJson(receipt);
  await writeRelativeFile(aggregateRoot, receiptPath, receiptText);
  reference.owners.candidateCodingRunClientCiReceipt.artifact.sha256 = sha256(receiptText);
  await writeEvidenceReference(aggregateRoot, reference);
}
