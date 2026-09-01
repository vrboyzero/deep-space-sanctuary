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
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodeIntelEvidence(aggregateRoot);
      const reference = await readEvidenceReference(aggregateRoot);
      const receiptPath = path.join(aggregateRoot, "candidate-code-intel-evidence-receipt.json");
      await fs.rm(receiptPath);
      delete reference.owners.candidateCodeIntelReceipt;
      reference.claims = reference.claims.filter(
        ({ owner }) => owner !== "candidateCodeIntelReceipt",
      );
      await writeEvidenceReference(aggregateRoot, reference);

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
});
