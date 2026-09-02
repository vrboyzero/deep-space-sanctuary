import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  addCandidateCliTuiEvidence,
  readEvidenceReference,
  serializeJson,
  sha256,
  withSafetyEvidenceFixture,
  writeEvidenceReference,
  writeRelativeFile,
} from "./coding-agent-candidate-dimension-evidence-fixtures.mjs";
import {
  runCodingAgentCandidateCliTuiReceipt,
} from "./coding-agent-candidate-cli-tui-receipt.mjs";
import { loadCodingAgentCandidateDimensionEvidence } from "./coding-agent-candidate-score.mjs";

describe("candidate CLI/TUI evidence receipt", () => {
  it("binds the four CLI/TUI contracts through the public dimension loader", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCliTuiEvidence(aggregateRoot, { writeReceipt: false });
      const receipt = await runCodingAgentCandidateCliTuiReceipt({
        aggregateRoot,
        generatedAt: "2026-09-02T15:00:00.000Z",
      });

      expect(receipt.summary).toEqual({
        taskProjectionCrossEntryConformance: true,
        taskProjectionTerminalActionConsistency: true,
        taskEfficiencyTimeline: true,
        tuiAccessibilityCrossPlatform: true,
      });
      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });
      expect(result.dimensions.find(({ id }) => id === "cli_tui")).toMatchObject({
        id: "cli_tui",
        status: "complete",
        missingEvidenceContracts: [],
      });
    });
  });

  it("projects an accessibility gate miss as failed while preserving a valid receipt", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCliTuiEvidence(aggregateRoot, {
        writeReceipt: false,
        accessibilityStatusByPlatform: { "windows-native": "failed" },
      });
      await runCodingAgentCandidateCliTuiReceipt({ aggregateRoot });
      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });
      expect(result.dimensions.find(({ id }) => id === "cli_tui")).toMatchObject({
        id: "cli_tui",
        status: "failed",
        failedEvidenceContracts: [{ id: "tui_accessibility_cross_platform", status: "failed" }],
      });
    });
  });

  it("projects a trustworthy terminal action mismatch as failed instead of rejecting it", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCliTuiEvidence(aggregateRoot);
      const projectionPath = "candidate-evidence/cli-tui/task-projection-conformance.json";
      const projection = JSON.parse(await fs.readFile(path.join(aggregateRoot, projectionPath), "utf-8"));
      projection.entries.at(-1).sequence.at(-1).allowedActions = ["observe"];
      const projectionText = serializeJson(projection);
      await writeRelativeFile(aggregateRoot, projectionPath, projectionText);

      const receiptPath = path.join(aggregateRoot, "candidate-cli-tui-evidence-receipt.json");
      const receipt = JSON.parse(await fs.readFile(receiptPath, "utf-8"));
      receipt.taskProjection.sha256 = sha256(projectionText);
      receipt.summary.taskProjectionTerminalActionConsistency = false;
      const receiptText = serializeJson(receipt);
      await fs.writeFile(receiptPath, receiptText, "utf-8");
      const reference = await readEvidenceReference(aggregateRoot);
      reference.owners.candidateCliTuiReceipt.artifact.sha256 = sha256(receiptText);
      await writeEvidenceReference(aggregateRoot, reference);

      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });
      expect(result.dimensions.find(({ id }) => id === "cli_tui")).toMatchObject({
        status: "failed",
        failedEvidenceContracts: [{
          id: "task_projection_terminal_action_consistency",
          status: "failed",
        }],
      });
    });
  });

  it("rejects self-consistent artifact bytes bound to a different source inventory", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCliTuiEvidence(aggregateRoot);
      const projectionPath = "candidate-evidence/cli-tui/task-projection-conformance.json";
      const projection = JSON.parse(await fs.readFile(path.join(aggregateRoot, projectionPath), "utf-8"));
      projection.sourceIdentity.files[0].sha256 = "9".repeat(64);
      projection.sourceIdentity.aggregateSha256 = sha256(JSON.stringify(projection.sourceIdentity.files));
      const projectionText = serializeJson(projection);
      await writeRelativeFile(aggregateRoot, projectionPath, projectionText);

      const receiptPath = path.join(aggregateRoot, "candidate-cli-tui-evidence-receipt.json");
      const receipt = JSON.parse(await fs.readFile(receiptPath, "utf-8"));
      receipt.taskProjection.sha256 = sha256(projectionText);
      const receiptText = serializeJson(receipt);
      await fs.writeFile(receiptPath, receiptText, "utf-8");
      const reference = await readEvidenceReference(aggregateRoot);
      reference.owners.candidateCliTuiReceipt.artifact.sha256 = sha256(receiptText);
      await writeEvidenceReference(aggregateRoot, reference);

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/artifact source identity drifted/i);
    });
  });

  it("fails closed and rolls back when a required artifact is missing", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot }) => {
      await addCandidateCliTuiEvidence(aggregateRoot, { writeReceipt: false });
      await fs.rm(path.join(
        aggregateRoot,
        "candidate-evidence/cli-tui/accessibility/wsl2-linux.json",
      ));
      await expect(runCodingAgentCandidateCliTuiReceipt({ aggregateRoot }))
        .rejects.toThrow(/missing or unreadable|is missing/i);
      await expect(fs.lstat(path.join(aggregateRoot, "candidate-cli-tui-evidence-receipt.json")))
        .rejects.toThrow();
      const reference = await readEvidenceReference(aggregateRoot);
      expect(reference.owners.candidateCliTuiReceipt).toBeUndefined();
      expect(reference.claims.some(({ owner }) => owner === "candidateCliTuiReceipt")).toBe(false);
    });
  });

  it("rejects an existing owner instead of overwriting candidate evidence", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot }) => {
      await addCandidateCliTuiEvidence(aggregateRoot);
      await expect(runCodingAgentCandidateCliTuiReceipt({ aggregateRoot }))
        .rejects.toThrow(/owner already exists/i);
    });
  });
});
