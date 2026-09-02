import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCodingAgentCandidateCodeIntelReceipt } from "./run-coding-agent-candidate-code-intel-receipt.mjs";
import { addCandidateCodeIntelEvidence } from "./coding-agent-candidate-code-intel-evidence-fixtures.mjs";
import {
  readEvidenceReference,
  withSafetyEvidenceFixture,
  writeEvidenceReference,
} from "./coding-agent-candidate-dimension-evidence-fixtures.mjs";
import { loadCodingAgentCandidateDimensionEvidence } from "./coding-agent-candidate-score.mjs";

describe("coding agent candidate CodeIntel receipt producer", () => {
  it("binds existing current-candidate reports and completes context retrieval through the public loader", async () => {
    await withOpenCodeIntelFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      const receipt = await runCodingAgentCandidateCodeIntelReceipt({
        aggregateRoot,
        generatedAt: "2026-09-02T10:00:00.000Z",
      });

      expect(receipt.schemaVersion).toBe(
        "coding-agent-benchmark-candidate-code-intel-evidence-receipt/v1",
      );
      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });
      expect(result.dimensions.find(({ id }) => id === "context_retrieval")).toMatchObject({
        id: "context_retrieval",
        status: "complete",
        missingEvidenceContracts: [],
      });
      const updatedReference = await readEvidenceReference(aggregateRoot);
      expect(updatedReference.owners.candidateCodeIntelReceipt).toBeDefined();
    });
  });

  it("preserves a historical uplift attempt instead of rewriting it to one", async () => {
    await withOpenCodeIntelFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      const receipt = await runCodingAgentCandidateCodeIntelReceipt({
        aggregateRoot,
        generatedAt: "2026-09-02T10:01:00.000Z",
      });

      expect(receipt.selection.agentUplift.attempt).toBe(12);
      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });
      expect(result.dimensions.find(({ id }) => id === "context_retrieval")).toMatchObject({
        id: "context_retrieval",
        status: "complete",
        missingEvidenceContracts: [],
      });
    }, { upliftAttempt: 12 });
  });

  it("fails closed when an owner already exists", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot }) => {
      await addCandidateCodeIntelEvidence(aggregateRoot);
      const referencePath = path.join(aggregateRoot, "candidate-dimension-evidence-reference.json");
      const originalReferenceText = await fs.readFile(referencePath, "utf8");
      await fs.rm(path.join(aggregateRoot, "candidate-code-intel-evidence-receipt.json"));

      await expect(runCodingAgentCandidateCodeIntelReceipt({
        aggregateRoot,
        generatedAt: "2026-09-02T10:02:00.000Z",
      })).rejects.toThrow(/owner already exists/i);
      await expect(fs.access(path.join(aggregateRoot, "candidate-code-intel-evidence-receipt.json")))
        .rejects.toThrow();
      expect(await fs.readFile(referencePath, "utf8")).toBe(originalReferenceText);
    });
  });

  it("fails closed when a required CodeIntel artifact is missing", async () => {
    await withOpenCodeIntelFixture(async ({ aggregateRoot, originalReferenceText }) => {
      const referencePath = path.join(aggregateRoot, "candidate-dimension-evidence-reference.json");
      await fs.rm(path.join(
        aggregateRoot,
        "candidate-evidence/code-intel/truth-set/windows-native-report.json",
      ));

      await expect(runCodingAgentCandidateCodeIntelReceipt({
        aggregateRoot,
        generatedAt: "2026-09-02T10:03:00.000Z",
      })).rejects.toThrow(/missing or unreadable/i);
      await expect(fs.access(path.join(aggregateRoot, "candidate-code-intel-evidence-receipt.json")))
        .rejects.toThrow();
      expect(await fs.readFile(referencePath, "utf8")).toBe(originalReferenceText);
    });
  });

  it("removes a partially written receipt and restores the reference when resolver binding fails", async () => {
    await withOpenCodeIntelFixture(async ({ aggregateRoot, originalReferenceText }) => {
      const mutatedPath = path.join(
        aggregateRoot,
        "candidate-evidence/code-intel/agent-uplift/windows-native-report.json",
      );
      const report = JSON.parse(await fs.readFile(mutatedPath, "utf8"));
      report.pairs[0].taskId = "real-js.bug-fix";
      await fs.writeFile(mutatedPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

      const referencePath = path.join(aggregateRoot, "candidate-dimension-evidence-reference.json");
      await expect(runCodingAgentCandidateCodeIntelReceipt({
        aggregateRoot,
        generatedAt: "2026-09-02T10:04:00.000Z",
      })).rejects.toThrow(/uplift pair\/task\/platform identity drifted/i);
      await expect(fs.access(path.join(aggregateRoot, "candidate-code-intel-evidence-receipt.json")))
        .rejects.toThrow();
      expect(await fs.readFile(referencePath, "utf8")).toBe(originalReferenceText);
    });
  });
});

async function withOpenCodeIntelFixture(callback, options = {}) {
  await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
    await addCandidateCodeIntelEvidence(aggregateRoot, options);
    const reference = await readEvidenceReference(aggregateRoot);
    const receiptPath = path.join(aggregateRoot, "candidate-code-intel-evidence-receipt.json");
    await fs.rm(receiptPath);
    delete reference.owners.candidateCodeIntelReceipt;
    reference.claims = reference.claims.filter(
      ({ owner }) => owner !== "candidateCodeIntelReceipt",
    );
    await writeEvidenceReference(aggregateRoot, reference);
    const referencePath = path.join(aggregateRoot, "candidate-dimension-evidence-reference.json");
    const originalReferenceText = await fs.readFile(referencePath, "utf8");
    await callback({
      aggregateRoot,
      report,
      baselineIndex,
      originalReferenceText,
    });
  });
}
