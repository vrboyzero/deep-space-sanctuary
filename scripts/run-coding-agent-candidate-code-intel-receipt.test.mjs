import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { runCodingAgentCandidateCodeIntelReceipt } from "./run-coding-agent-candidate-code-intel-receipt.mjs";
import { addCandidateCodeIntelEvidence } from "./coding-agent-candidate-code-intel-evidence-fixtures.mjs";
import {
  readEvidenceReference,
  withSafetyEvidenceFixture,
  writeEvidenceReference,
} from "./coding-agent-candidate-dimension-evidence-fixtures.mjs";
import { loadCodingAgentCandidateDimensionEvidence } from "./coding-agent-candidate-score.mjs";
import { buildCodeIntelGoOciPromotionGateReport } from "./run-code-intel-go-oci-promotion-gate.mjs";

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

  it.each(["none", "missing", "changed", "duplicate"])("validates the real OCI runtime inventory with %s shared-file drift", async (drift) => {
    await withOpenCodeIntelFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      const ociPath = path.join(aggregateRoot, "candidate-evidence/code-intel/go-canary/wsl2-oci-report.json");
      const oci = JSON.parse(await fs.readFile(ociPath, "utf8"));
      const produced = await buildCodeIntelGoOciPromotionGateReport({
        platform: process.platform === "win32" ? "windows-native" : "wsl2-linux",
        runtimeFactory: async () => ({ ...oci, providerAdmissionStatus: oci.promotion.providerAdmissionStatus }),
      });
      expect(produced.sourceIdentity.files.length).toBeGreaterThan(9);
      const digest = (value) => createHash("sha256").update(value).digest("hex");
      // 使用真实生产器声明的路径集合；测试 digest 仍遵循相邻 fixture 的路径摘要规则。
      const files = produced.sourceIdentity.files.map(({ path: filePath }) => ({ path: filePath, sha256: digest(filePath) }));
      const sharedPath = oci.sourceIdentity.files[0].path;
      const sharedIndex = files.findIndex((file) => file.path === sharedPath);
      expect(sharedIndex).toBeGreaterThanOrEqual(0);
      if (drift === "missing") files.splice(sharedIndex, 1);
      if (drift === "changed") files[sharedIndex].sha256 = "f".repeat(64);
      if (drift === "duplicate") files.push({ ...files[sharedIndex] });
      oci.sourceIdentity = { files, aggregateSha256: digest(JSON.stringify(files)) };
      const ociText = `${JSON.stringify(oci, null, 2)}\n`;
      await fs.writeFile(ociPath, ociText);
      const comparatorPath = path.join(aggregateRoot, "candidate-evidence/code-intel/go-canary/comparator-report.json");
      const comparator = JSON.parse(await fs.readFile(comparatorPath, "utf8"));
      comparator.inputs.wsl2Oci.reportSha256 = digest(ociText);
      await fs.writeFile(comparatorPath, `${JSON.stringify(comparator, null, 2)}\n`);

      const run = runCodingAgentCandidateCodeIntelReceipt({ aggregateRoot });
      if (drift !== "none") {
        await expect(run).rejects.toThrow(/source identity collision|shared runtime identity|duplicate/i);
        return;
      }
      await run;
      const result = await loadCodingAgentCandidateDimensionEvidence({ aggregateRoot,
        verifiedAggregate: { report, baselineIndex } });
      expect(result.dimensions.find(({ id }) => id === "context_retrieval")).toMatchObject({
        status: "complete", missingEvidenceContracts: [],
      });
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
