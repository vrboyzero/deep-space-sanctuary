import { describe, expect, it } from "vitest";

import { addCandidateCodeIntelEvidence } from "./coding-agent-candidate-code-intel-evidence-fixtures.mjs";
import {
  readEvidenceReference,
  serializeJson,
  sha256,
  withSafetyEvidenceFixture,
  writeEvidenceReference,
  writeRelativeFile,
} from "./coding-agent-candidate-dimension-evidence-fixtures.mjs";
import { loadCodingAgentCandidateDimensionEvidence } from "./coding-agent-candidate-score.mjs";

const EXPECTED_CONTEXT_RETRIEVAL_CONTRACTS = [
  ["code_intel_truth_freshness", "current_source_dual_platform_truth_and_freshness_passed"],
  ["context_inspector", "current_harness_read_only_projection_audit_passed"],
  ["code_intel_resource_soak", "current_source_dual_platform_resource_soak_passed"],
  [
    "semantic_adoption_context_waste",
    "current_harness_semantic_adoption_and_context_waste_gate_passed",
  ],
  ["code_intel_no_binary_fallback", "current_harness_binary_outcome_no_regression_passed"],
  ["go_canary_eligibility", "current_source_go_canary_eligibility_proven"],
];

describe("coding agent candidate CodeIntel dimension evidence", () => {
  it("completes six current-candidate contracts without changing unrelated dimensions", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      const before = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });
      await addCandidateCodeIntelEvidence(aggregateRoot);

      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });
      const contextRetrieval = result.dimensions.find(({ id }) => id === "context_retrieval");

      expect(contextRetrieval).toEqual({
        id: "context_retrieval",
        status: "complete",
        resolvedEvidenceContracts: EXPECTED_CONTEXT_RETRIEVAL_CONTRACTS.map(([
          id,
          completion,
        ]) => ({
          id,
          owner: "candidateCodeIntelReceipt",
          completion,
          status: "complete",
        })),
        missingEvidenceContracts: [],
      });
      expect(result.dimensions.filter(({ id }) => id !== "context_retrieval")).toEqual(
        before.dimensions.filter(({ id }) => id !== "context_retrieval"),
      );
    });
  });

  it("rejects when the candidate CodeIntel receipt bytes drift after the reference is sealed", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodeIntelEvidence(aggregateRoot, {
        inspect: async ({ receipt }) => {
          const receiptPath = `${aggregateRoot}/candidate-code-intel-evidence-receipt.json`;
          const drifted = `${JSON.stringify({ ...receipt, generatedAt: "2026-09-02T09:00:01.000Z" }, null, 2)}\n`;
          await import("node:fs/promises").then(({ writeFile }) => writeFile(receiptPath, drifted, "utf8"));
        },
      });

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/candidate CodeIntel receipt digest drifted/);
    });
  });

  it("projects a Schema-valid Context Inspector gate failure as failed", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodeIntelEvidence(aggregateRoot, {
        inspect: async ({ receipt }) => {
          const reportPath = "candidate-evidence/code-intel/context-inspector-audit-report.json";
          const reportValue = JSON.parse(
            await (await import("node:fs/promises")).readFile(
              `${aggregateRoot}/${reportPath}`,
              "utf8",
            ),
          );
          reportValue.gate = {
            passed: false,
            failures: ["projection_shape_mismatch"],
          };
          const reportText = serializeJson(reportValue);
          await writeRelativeFile(aggregateRoot, reportPath, reportText);
          receipt.contextInspector.sha256 = sha256(reportText);
          receipt.summary.contextInspector.passed = false;
          const receiptText = serializeJson(receipt);
          await writeRelativeFile(
            aggregateRoot,
            "candidate-code-intel-evidence-receipt.json",
            receiptText,
          );
          const reference = await readEvidenceReference(aggregateRoot);
          reference.owners.candidateCodeIntelReceipt.artifact.sha256 = sha256(receiptText);
          await writeEvidenceReference(aggregateRoot, reference);
        },
      });

      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });
      const contextRetrieval = result.dimensions.find(({ id }) => id === "context_retrieval");

      expect(result.status).toBe("failed");
      expect(contextRetrieval).toMatchObject({
        id: "context_retrieval",
        status: "failed",
        failedEvidenceContracts: [{
          id: "context_inspector",
          owner: "candidateCodeIntelReceipt",
          completion: "current_harness_read_only_projection_audit_passed",
          status: "failed",
        }],
        missingEvidenceContracts: [],
      });
      expect(contextRetrieval.resolvedEvidenceContracts.map(({ id }) => id)).toEqual([
        "code_intel_truth_freshness",
        "code_intel_resource_soak",
        "semantic_adoption_context_waste",
        "code_intel_no_binary_fallback",
        "go_canary_eligibility",
      ]);
      expect(result.dimensions.every((dimension) => !("score" in dimension))).toBe(true);
    });
  });

  it("rejects a sealed receipt summary that disagrees with its artifacts", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodeIntelEvidence(aggregateRoot, {
        inspect: async ({ receipt }) => {
          receipt.summary.truthSet.caseCount = 6;
          const receiptText = serializeJson(receipt);
          await writeRelativeFile(
            aggregateRoot,
            "candidate-code-intel-evidence-receipt.json",
            receiptText,
          );
          const reference = await readEvidenceReference(aggregateRoot);
          reference.owners.candidateCodeIntelReceipt.artifact.sha256 = sha256(receiptText);
          await writeEvidenceReference(aggregateRoot, reference);
        },
      });

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/candidate CodeIntel receipt summary drifted/);
    });
  });

  it("rejects a receipt whose Go comparator input SHA is rebound to another artifact", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodeIntelEvidence(aggregateRoot, {
        inspect: async ({ receipt }) => {
          receipt.goCanary.comparator.sha256 = "0".repeat(64);
          const receiptText = serializeJson(receipt);
          await writeRelativeFile(
            aggregateRoot,
            "candidate-code-intel-evidence-receipt.json",
            receiptText,
          );
          const reference = await readEvidenceReference(aggregateRoot);
          reference.owners.candidateCodeIntelReceipt.artifact.sha256 = sha256(receiptText);
          await writeEvidenceReference(aggregateRoot, reference);
        },
      });

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/CodeIntel Go comparator report digest drifted/);
    });
  });

  it("rejects a receipt whose source inventory is rebound to a different digest", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodeIntelEvidence(aggregateRoot, {
        inspect: async ({ receipt }) => {
          receipt.sourceIdentity.files[0].sha256 = "0".repeat(64);
          receipt.sourceIdentity.aggregateSha256 = sha256(
            JSON.stringify(receipt.sourceIdentity.files),
          );
          const receiptText = serializeJson(receipt);
          await writeRelativeFile(
            aggregateRoot,
            "candidate-code-intel-evidence-receipt.json",
            receiptText,
          );
          const reference = await readEvidenceReference(aggregateRoot);
          reference.owners.candidateCodeIntelReceipt.artifact.sha256 = sha256(receiptText);
          await writeEvidenceReference(aggregateRoot, reference);
        },
      });

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/candidate CodeIntel receipt source inventory drifted/);
    });
  });

  it("rejects a Schema-valid truth-set artifact whose platform foreign key is rebound", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodeIntelEvidence(aggregateRoot, {
        inspect: async ({ receipt }) => {
          const artifactReference = receipt.truthSet[0];
          const artifactPath = artifactReference.path;
          const artifactValue = JSON.parse(
            await (await import("node:fs/promises")).readFile(
              `${aggregateRoot}/${artifactPath}`,
              "utf8",
            ),
          );
          artifactValue.platform = "wsl2-linux";
          const artifactText = serializeJson(artifactValue);
          await writeRelativeFile(aggregateRoot, artifactPath, artifactText);
          artifactReference.sha256 = sha256(artifactText);
          const receiptText = serializeJson(receipt);
          await writeRelativeFile(
            aggregateRoot,
            "candidate-code-intel-evidence-receipt.json",
            receiptText,
          );
          const reference = await readEvidenceReference(aggregateRoot);
          reference.owners.candidateCodeIntelReceipt.artifact.sha256 = sha256(receiptText);
          await writeEvidenceReference(aggregateRoot, reference);
        },
      });

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/CodeIntel truth-set report windows-native platform binding drifted/);
    });
  });

  it.each([
    [
      "truth-set artifact platform reference",
      (receipt) => {
        receipt.truthSet[0].platform = "wsl2-linux";
      },
    ],
    [
      "truth-set artifact path reference",
      (receipt) => {
        receipt.truthSet[0].path = receipt.truthSet[1].path;
      },
    ],
  ])("rejects a receipt whose %s is rebound", async (_label, mutate) => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodeIntelEvidence(aggregateRoot, {
        inspect: async ({ receipt }) => {
          mutate(receipt);
          const receiptText = serializeJson(receipt);
          await writeRelativeFile(
            aggregateRoot,
            "candidate-code-intel-evidence-receipt.json",
            receiptText,
          );
          const reference = await readEvidenceReference(aggregateRoot);
          reference.owners.candidateCodeIntelReceipt.artifact.sha256 = sha256(receiptText);
          await writeEvidenceReference(aggregateRoot, reference);
        },
      });

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/candidate CodeIntel receipt does not match its schema/i);
    });
  });

  it("rejects a receipt whose truth-set selection manifest is rebound", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodeIntelEvidence(aggregateRoot, {
        inspect: async ({ receipt }) => {
          receipt.selection.truthSet.manifestSha256 = "0".repeat(64);
          const receiptText = serializeJson(receipt);
          await writeRelativeFile(
            aggregateRoot,
            "candidate-code-intel-evidence-receipt.json",
            receiptText,
          );
          const reference = await readEvidenceReference(aggregateRoot);
          reference.owners.candidateCodeIntelReceipt.artifact.sha256 = sha256(receiptText);
          await writeEvidenceReference(aggregateRoot, reference);
        },
      });

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/candidate CodeIntel receipt truth-set manifest binding drifted/);
    });
  });

  it.each([
    [
      "resource-soak selection config",
      (receipt) => {
        receipt.selection.resourceSoak.configSha256 = "0".repeat(64);
      },
      /candidate CodeIntel receipt resource-soak config binding drifted/,
    ],
    [
      "Go selection manifest",
      (receipt) => {
        receipt.selection.goCanary.manifestSha256 = "0".repeat(64);
      },
      /candidate CodeIntel receipt Go manifest binding drifted/,
    ],
  ])("rejects a receipt whose %s is rebound", async (_label, mutate, expected) => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodeIntelEvidence(aggregateRoot, {
        inspect: async ({ receipt }) => {
          mutate(receipt);
          const receiptText = serializeJson(receipt);
          await writeRelativeFile(
            aggregateRoot,
            "candidate-code-intel-evidence-receipt.json",
            receiptText,
          );
          const reference = await readEvidenceReference(aggregateRoot);
          reference.owners.candidateCodeIntelReceipt.artifact.sha256 = sha256(receiptText);
          await writeEvidenceReference(aggregateRoot, reference);
        },
      });

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(expected);
    });
  });

  it("rejects a Schema-valid Go OCI report whose shared runtime identity is rebound", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodeIntelEvidence(aggregateRoot, {
        inspect: async ({ receipt }) => {
          const reportPath = receipt.goCanary.wsl2Oci.path;
          const reportValue = JSON.parse(
            await (await import("node:fs/promises")).readFile(
              `${aggregateRoot}/${reportPath}`,
              "utf8",
            ),
          );
          const reboundPath =
            "packages/belldandy-skills/src/code-intel/rebound-runtime.ts";
          reportValue.sourceIdentity.files[0].path = reboundPath;
          reportValue.sourceIdentity.aggregateSha256 = sha256(
            JSON.stringify(reportValue.sourceIdentity.files),
          );
          const reportText = serializeJson(reportValue);
          await writeRelativeFile(aggregateRoot, reportPath, reportText);
          receipt.goCanary.wsl2Oci.sha256 = sha256(reportText);
          receipt.sourceIdentity.files.push({
            path: reboundPath,
            sha256: reportValue.sourceIdentity.files[0].sha256,
          });
          receipt.sourceIdentity.files.sort((left, right) => left.path.localeCompare(right.path));
          receipt.sourceIdentity.aggregateSha256 = sha256(
            JSON.stringify(receipt.sourceIdentity.files),
          );
          const receiptText = serializeJson(receipt);
          await writeRelativeFile(
            aggregateRoot,
            "candidate-code-intel-evidence-receipt.json",
            receiptText,
          );
          const reference = await readEvidenceReference(aggregateRoot);
          reference.owners.candidateCodeIntelReceipt.artifact.sha256 = sha256(receiptText);
          await writeEvidenceReference(aggregateRoot, reference);
        },
      });

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/CodeIntel Go shared runtime identity drifted/);
    });
  });

  it("rejects a Schema-valid uplift report whose pair task foreign key is rebound", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodeIntelEvidence(aggregateRoot, {
        inspect: async ({ receipt }) => {
          const reportPath = receipt.agentUplift.platformReports[0].path;
          const reportValue = JSON.parse(
            await (await import("node:fs/promises")).readFile(
              `${aggregateRoot}/${reportPath}`,
              "utf8",
            ),
          );
          reportValue.pairs[0].taskId = "real-ts.cross-package-refactor";
          const reportText = serializeJson(reportValue);
          await writeRelativeFile(aggregateRoot, reportPath, reportText);
          receipt.agentUplift.platformReports[0].sha256 = sha256(reportText);
          const receiptText = serializeJson(receipt);
          await writeRelativeFile(
            aggregateRoot,
            "candidate-code-intel-evidence-receipt.json",
            receiptText,
          );
          const reference = await readEvidenceReference(aggregateRoot);
          reference.owners.candidateCodeIntelReceipt.artifact.sha256 = sha256(receiptText);
          await writeEvidenceReference(aggregateRoot, reference);
        },
      });

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/CodeIntel uplift pair\/task\/platform identity drifted/);
    });
  });
});
