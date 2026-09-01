import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  addCandidateCodingRunClientCiEvidence,
  readEvidenceReference,
  serializeJson,
  sha256,
  versionedIdentity,
  withSafetyEvidenceFixture,
  writeEvidenceReference,
  writeRelativeFile,
} from "./coding-agent-candidate-dimension-evidence-fixtures.mjs";
import {
  CODING_AGENT_CANDIDATE_DIMENSION_EVIDENCE_RESOLUTION_VERSION,
  loadCodingAgentCandidateDimensionEvidence,
} from "./coding-agent-candidate-score.mjs";
import {
  createVerificationDagPlan,
  finalizeVerificationDag,
  replayCommandJobSnapshots,
} from "./run-verification-dag.mjs";
import { buildVerificationImpactTruthSetReport } from "./run-verification-impact-truth-set.mjs";
import { projectVerificationBrowserReport } from "./verification-browser-report-adapter.mjs";

const VERIFICATION_AUDIT_COMMAND = "corepack pnpm verify:p1b-verification-audit";
const VERIFICATION_FAILURE_REPLAY_COMMAND =
  "deterministic:verification-dag-reproducible-failure-v1";
const VERIFICATION_AUDIT_TEST_FILES = Object.freeze([
  "scripts/run-verification-impact-truth-set.test.mjs",
  "scripts/verification-test-report-adapter.test.mjs",
  "scripts/run-verification-dag.test.mjs",
  "scripts/verification-browser-report-adapter.test.mjs",
]);
const VERIFICATION_BROWSER_VIEWPORTS = Object.freeze([
  Object.freeze({ runId: "mobile", width: 375, height: 667, deviceScaleFactor: 1 }),
  Object.freeze({ runId: "tablet", width: 768, height: 1024, deviceScaleFactor: 1 }),
  Object.freeze({ runId: "desktop", width: 1440, height: 900, deviceScaleFactor: 1 }),
]);
const VERIFICATION_REPLAY_BINDING = Object.freeze({
  environmentHash: "a7ca53913bd697b587d83ae099f2eefe47efd2e060576513b60a2ec446293e73",
  inputHash: "a46bef26dd71cb250fe572491ab9e33e4aa0a3c7cb8ab3439e7bd5e1ad54475f",
});
const VERIFICATION_REPLAY_FAILURE_FINGERPRINT =
  "6555e3ee23e684b9986cf7fd3dad7fffff4e2ab40101435f5ab5bc50a7198934";
const VERIFICATION_REPLAY_FAILURE_MESSAGE =
  "candidate-verification-replay:deterministic_test_failure";
const BROWSER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const SUPERVISOR_FAULT_AUDIT_COMMAND = "corepack pnpm verify:p2a-supervisor-fault-audit";
const SUPERVISOR_FAULT_AUDIT_TEST_FILES = Object.freeze([
  "packages/belldandy-core/src/subtask-supervisor-runtime.test.ts",
  "packages/belldandy-core/src/subtask-supervisor-control-runtime.test.ts",
  "packages/belldandy-core/src/subtask-supervisor-fan-in-runtime.test.ts",
  "packages/belldandy-core/src/subtask-supervisor-fan-in-resolution-runtime.test.ts",
  "packages/belldandy-core/src/subtask-supervisor-fan-in-process-recovery.test.ts",
  "packages/belldandy-core/src/subtask-supervisor-approval-crash-recovery.test.ts",
  "packages/belldandy-core/src/subtask-supervisor-worktree-disposal-runtime.test.ts",
  "packages/belldandy-core/src/subtask-supervisor-worktree-disposal-process-recovery.test.ts",
  "packages/belldandy-core/src/managed-worktree.test.ts",
  "packages/belldandy-core/src/worktree-runtime.test.ts",
  "packages/belldandy-core/src/task-runtime.test.ts",
  "packages/belldandy-core/src/bridge-subtask-runtime.test.ts",
  "packages/belldandy-core/src/coding-run/pending-tool-permission-runtime.test.ts",
  "packages/belldandy-core/src/coding-run/reconciliation-journal.test.ts",
  "packages/belldandy-skills/src/builtin/session/session-tools.test.ts",
  "packages/belldandy-skills/src/tool-behavior-contract.test.ts",
  "packages/belldandy-skills/src/tool-contract-v2.test.ts",
  "scripts/run-subtask-supervisor-soak.test.mjs",
]);
const SUPERVISOR_SOAK_SOURCE_FILES = Object.freeze([
  "packages/belldandy-core/src/subtask-supervisor-runtime.ts",
  "packages/belldandy-core/src/subtask-supervisor-worktree-disposal-runtime.ts",
  "packages/belldandy-core/src/task-runtime.ts",
  "packages/belldandy-core/src/worktree-runtime.ts",
  "packages/belldandy-core/src/managed-worktree.ts",
  "packages/belldandy-core/dist/subtask-supervisor-runtime.js",
  "packages/belldandy-core/dist/subtask-supervisor-worktree-disposal-runtime.js",
  "packages/belldandy-core/dist/task-runtime.js",
  "packages/belldandy-core/dist/worktree-runtime.js",
  "packages/belldandy-core/dist/managed-worktree.js",
  "scripts/run-subtask-supervisor-soak.mjs",
  "scripts/subtask-supervisor-soak-cleanup-watchdog.mjs",
  "benchmarks/supervisor/v1/p2a-subtask-supervisor-soak-report.schema.json",
]);
const CODING_RUN_CLIENT_AUDIT_COMMAND = "corepack pnpm verify:coding-run-client";
const CODING_RUN_CLIENT_AUDIT_TEST_FILES = Object.freeze([
  "packages/belldandy-core/src/coding-run/stdio.test.ts",
  "packages/belldandy-core/src/coding-run/client.test.ts",
  "apps/vscode-extension/src/stdio-client.test.js",
  "scripts/coding-run-client-conformance.test.mjs",
  "scripts/coding-run-client-failure-conformance.test.mjs",
  "scripts/run-coding-run-client-external-consumer.test.mjs",
  "scripts/run-coding-run-client-typescript-consumer.test.mjs",
]);

describe("coding agent candidate dimension evidence", () => {
  it("keeps every candidate evidence contract incomplete when the reference is absent", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await fs.rm(path.join(aggregateRoot, "candidate-dimension-evidence-reference.json"));

      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });

      expect(result.status).toBe("partial");
      expect(result.dimensions.find(({ id }) => id === "safety_recovery")).toEqual({
        id: "safety_recovery",
        status: "partial",
        resolvedEvidenceContracts: [],
        missingEvidenceContracts: [
          "system_evidence_critical_rate",
          "candidate_sensitive_scan",
          "candidate_resource_sweeps",
          "fault_matrix_audit_reconciliation",
        ],
      });
      expect(result.dimensions.every(({ status }) => status === "partial")).toBe(true);
    });
  });

  it("rejects a declared evidence path that escapes the aggregate root", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      const referencePath = path.join(
        aggregateRoot,
        "candidate-dimension-evidence-reference.json",
      );
      const reference = JSON.parse(await fs.readFile(referencePath, "utf-8"));
      reference.owners.systemEvidence.artifacts[0].path = "../outside.json";
      await fs.writeFile(referencePath, serializeJson(reference), "utf-8");

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/evidence reference does not match its schema/i);
    });
  });

  it("rejects retained system evidence whose content digest drifted", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      const reference = await readEvidenceReference(aggregateRoot);
      const relativePath = reference.owners.systemEvidence.artifacts[0].path;
      await fs.appendFile(
        path.join(aggregateRoot, ...relativePath.split("/")),
        "\n",
        "utf-8",
      );

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/system evidence digest or schema drifted/i);
    });
  });

  it("rejects a candidate-global receipt whose content digest drifted", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await fs.appendFile(
        path.join(aggregateRoot, "candidate-global-receipt.json"),
        "\n",
        "utf-8",
      );

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/candidate-global receipt digest drifted/i);
    });
  });

  it("rejects reference source and harness identities from another aggregate", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      for (const [field, seed] of [["source", "c"], ["harness", "d"]]) {
        const reference = await readEvidenceReference(aggregateRoot);
        reference.aggregate[field] = versionedIdentity(seed);
        await writeEvidenceReference(aggregateRoot, reference);

        await expect(loadCodingAgentCandidateDimensionEvidence({
          aggregateRoot,
          verifiedAggregate: { report, baselineIndex },
        })).rejects.toThrow(/aggregate binding drifted/i);

        reference.aggregate[field] = report[field];
        await writeEvidenceReference(aggregateRoot, reference);
      }
    });
  });

  it("rejects a self-consistent receipt digest bound to another aggregate identity", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      const receiptPath = path.join(aggregateRoot, "candidate-global-receipt.json");
      const receipt = JSON.parse(await fs.readFile(receiptPath, "utf-8"));
      receipt.aggregate.source = versionedIdentity("c");
      const receiptText = serializeJson(receipt);
      await fs.writeFile(receiptPath, receiptText, "utf-8");
      const reference = await readEvidenceReference(aggregateRoot);
      reference.owners.candidateGlobalReceipt.artifact.sha256 = sha256(receiptText);
      await writeEvidenceReference(aggregateRoot, reference);

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/candidate-global receipt binding drifted/i);
    });
  });

  it("rejects self-consistent retained bytes with a mismatched run binding", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      const reference = await readEvidenceReference(aggregateRoot);
      const artifact = reference.owners.systemEvidence.artifacts[0];
      const artifactPath = path.join(aggregateRoot, ...artifact.path.split("/"));
      const evidence = JSON.parse(await fs.readFile(artifactPath, "utf-8"));
      evidence.runId = `${evidence.runId}-other`;
      const evidenceText = serializeJson(evidence);
      await fs.writeFile(artifactPath, evidenceText, "utf-8");
      artifact.sha256 = sha256(evidenceText);
      await writeEvidenceReference(aggregateRoot, reference);

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/system evidence binding drifted/i);
    });
  });

  it("projects a valid system observation that misses a critical invariant as failed", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      const reference = await readEvidenceReference(aggregateRoot);
      const artifact = reference.owners.systemEvidence.artifacts[0];
      const artifactPath = path.join(aggregateRoot, ...artifact.path.split("/"));
      const evidence = JSON.parse(await fs.readFile(artifactPath, "utf-8"));
      evidence.duplicateSideEffectCount = 1;
      const evidenceText = serializeJson(evidence);
      await fs.writeFile(artifactPath, evidenceText, "utf-8");
      artifact.sha256 = sha256(evidenceText);
      await writeEvidenceReference(aggregateRoot, reference);

      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });

      expectSafetyCompletionFailure(result, "system_evidence_critical_rate", [
        "candidate_sensitive_scan",
        "candidate_resource_sweeps",
      ]);
    });
  });

  it("projects a complete candidate scan with a sensitive finding as failed", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await mutateCandidateGlobalReceipt(aggregateRoot, (receipt) => {
        receipt.sensitiveScan.findingCount = 1;
      });

      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });

      expectSafetyCompletionFailure(result, "candidate_sensitive_scan", [
        "system_evidence_critical_rate",
        "candidate_resource_sweeps",
      ]);
    });
  });

  it("projects complete candidate sweeps with an orphan resource as failed", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await mutateCandidateGlobalReceipt(aggregateRoot, (receipt) => {
        receipt.resourceSweeps[0].remainingOwnedProcessCount = 1;
        receipt.resourceSweeps[0].orphanResourceCount = 1;
      });

      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });

      expectSafetyCompletionFailure(result, "candidate_resource_sweeps", [
        "system_evidence_critical_rate",
        "candidate_sensitive_scan",
      ]);
    });
  });

  it("resolves existing safety evidence without claiming the missing fault-matrix contract", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });

      expect(result.schemaVersion)
        .toBe(CODING_AGENT_CANDIDATE_DIMENSION_EVIDENCE_RESOLUTION_VERSION);
      expect(result.status).toBe("partial");
      expect(result.dimensions.find(({ id }) => id === "safety_recovery")).toEqual({
        id: "safety_recovery",
        status: "partial",
        resolvedEvidenceContracts: [
          {
            id: "system_evidence_critical_rate",
            owner: "systemEvidence",
            completion: "all_layer_c_runs_valid",
            status: "complete",
          },
          {
            id: "candidate_sensitive_scan",
            owner: "candidateGlobalReceipt",
            completion: "completed_zero_findings",
            status: "complete",
          },
          {
            id: "candidate_resource_sweeps",
            owner: "candidateGlobalReceipt",
            completion: "required_platforms_completed_zero_orphans",
            status: "complete",
          },
        ],
        missingEvidenceContracts: ["fault_matrix_audit_reconciliation"],
      });
      expect(result.dimensions.every((dimension) => !("score" in dimension))).toBe(true);
    });
  });

  it("completes safety recovery from current-harness dual-platform soak and deterministic fault audit without scoring", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateSupervisorEvidence(aggregateRoot);

      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });

      expect(result.status).toBe("partial");
      expect(result.dimensions.find(({ id }) => id === "safety_recovery")).toEqual({
        id: "safety_recovery",
        status: "complete",
        resolvedEvidenceContracts: [
          {
            id: "system_evidence_critical_rate",
            owner: "systemEvidence",
            completion: "all_layer_c_runs_valid",
            status: "complete",
          },
          {
            id: "candidate_sensitive_scan",
            owner: "candidateGlobalReceipt",
            completion: "completed_zero_findings",
            status: "complete",
          },
          {
            id: "candidate_resource_sweeps",
            owner: "candidateGlobalReceipt",
            completion: "required_platforms_completed_zero_orphans",
            status: "complete",
          },
          {
            id: "fault_matrix_audit_reconciliation",
            owner: "candidateSupervisorReceipt",
            completion: "current_harness_dual_platform_soak_and_fault_audit_passed",
            status: "complete",
          },
        ],
        missingEvidenceContracts: [],
      });
      expect(result.dimensions.every((dimension) => !("score" in dimension))).toBe(true);
    });
  });

  it("does not infer long-running session claims from a Supervisor owner alone", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateSupervisorEvidence(aggregateRoot);

      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });

      expect(result.dimensions.find(({ id }) => id === "session_long_running")).toEqual({
        id: "session_long_running",
        status: "partial",
        resolvedEvidenceContracts: [],
        missingEvidenceContracts: [
          "supervisor_dual_platform_60_minute_soak",
          "bounded_budget_cancel_restart_reattach",
          "managed_worktree_fan_in_review_remediation",
          "parallel_resource_convergence",
        ],
      });
      expect(result.dimensions.every((dimension) => !("score" in dimension))).toBe(true);
    });
  });

  it("rejects partial or reordered long-running session claims", async () => {
    for (const mutate of [
      (claims) => claims.pop(),
      (claims) => {
        [claims[claims.length - 2], claims[claims.length - 1]] =
          [claims[claims.length - 1], claims[claims.length - 2]];
      },
    ]) {
      await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
        await addCandidateSupervisorEvidence(aggregateRoot);
        await addCandidateSessionLongRunningClaims(aggregateRoot);
        const reference = await readEvidenceReference(aggregateRoot);
        mutate(reference.claims);
        await writeEvidenceReference(aggregateRoot, reference);

        await expect(loadCodingAgentCandidateDimensionEvidence({
          aggregateRoot,
          verifiedAggregate: { report, baselineIndex },
        })).rejects.toThrow(/evidence claims drifted/i);
      });
    }
  });

  it("completes long-running sessions from the same current-harness Supervisor receipt without scoring", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateSupervisorEvidence(aggregateRoot);
      await addCandidateSessionLongRunningClaims(aggregateRoot);

      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });

      expect(result.status).toBe("partial");
      expect(result.dimensions.find(({ id }) => id === "session_long_running")).toEqual({
        id: "session_long_running",
        status: "complete",
        resolvedEvidenceContracts: [
          {
            id: "supervisor_dual_platform_60_minute_soak",
            owner: "candidateSupervisorReceipt",
            completion: "current_harness_dual_platform_60_minute_soak_passed",
            status: "complete",
          },
          {
            id: "bounded_budget_cancel_restart_reattach",
            owner: "candidateSupervisorReceipt",
            completion: "current_harness_bounded_budget_cancel_restart_reattach_audit_passed",
            status: "complete",
          },
          {
            id: "managed_worktree_fan_in_review_remediation",
            owner: "candidateSupervisorReceipt",
            completion: "current_harness_managed_worktree_fan_in_review_remediation_audit_passed",
            status: "complete",
          },
          {
            id: "parallel_resource_convergence",
            owner: "candidateSupervisorReceipt",
            completion: "current_harness_parallel_resources_converged_zero_residue",
            status: "complete",
          },
        ],
        missingEvidenceContracts: [],
      });
      expect(result.dimensions.every((dimension) => !("score" in dimension))).toBe(true);
    });
  });

  it("fails only the long-running soak workload claim for a trustworthy workload Gate failure", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateSupervisorEvidence(aggregateRoot);
      await addCandidateSessionLongRunningClaims(aggregateRoot);
      await mutateCandidateSupervisorJsonArtifact(
        aggregateRoot,
        (receipt) => receipt.soak.reports[0],
        (artifact) => {
          artifact.workload.laneSucceeded = 320;
          artifact.workload.laneFailed = 40;
          artifact.workload.successRate = 320 / 360;
          artifact.workload.firstFailureCode = "lane_execution_failed";
          artifact.gate = { passed: false, failures: ["lane_success_rate_failed"] };
        },
      );

      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });

      expectSessionLongRunningCompletionFailure(
        result,
        "supervisor_dual_platform_60_minute_soak",
      );
    });
  });

  it("fails only the bounded long-running control claim for trustworthy recovery or control-audit failures", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateSupervisorEvidence(aggregateRoot);
      await addCandidateSessionLongRunningClaims(aggregateRoot);
      await mutateCandidateSupervisorJsonArtifact(
        aggregateRoot,
        (receipt) => receipt.soak.reports[0],
        (artifact) => {
          artifact.recovery.interruptionRecovered -= 1;
          artifact.gate = { passed: false, failures: ["interruption_recovery_failed"] };
        },
      );

      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });

      expectSessionLongRunningCompletionFailure(
        result,
        "bounded_budget_cancel_restart_reattach",
      );
    });

    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateSupervisorEvidence(aggregateRoot);
      await addCandidateSessionLongRunningClaims(aggregateRoot);
      await failCandidateSupervisorFaultAudit(
        aggregateRoot,
        "packages/belldandy-core/src/subtask-supervisor-control-runtime.test.ts",
      );

      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });

      expectSessionLongRunningCompletionFailure(
        result,
        "bounded_budget_cancel_restart_reattach",
      );
    });
  });

  it("fails only the long-running fan-in review claim for a trustworthy fan-in audit failure", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateSupervisorEvidence(aggregateRoot);
      await addCandidateSessionLongRunningClaims(aggregateRoot);
      await failCandidateSupervisorFaultAudit(
        aggregateRoot,
        "packages/belldandy-core/src/subtask-supervisor-fan-in-runtime.test.ts",
      );

      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });

      expectSessionLongRunningCompletionFailure(
        result,
        "managed_worktree_fan_in_review_remediation",
      );
    });
  });

  it("fails only the parallel resource claim for trustworthy residue or cleanup-audit failures", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateSupervisorEvidence(aggregateRoot);
      await addCandidateSessionLongRunningClaims(aggregateRoot);
      await mutateCandidateSupervisorJsonArtifact(
        aggregateRoot,
        (receipt) => receipt.soak.reports[0],
        (artifact) => {
          artifact.resources.differential.addedWorktreeCount = 1;
          artifact.gate = { passed: false, failures: ["workspace_resource_residue"] };
        },
      );

      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });

      expectSessionLongRunningCompletionFailure(
        result,
        "parallel_resource_convergence",
      );
    });

    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateSupervisorEvidence(aggregateRoot);
      await addCandidateSessionLongRunningClaims(aggregateRoot);
      await failCandidateSupervisorFaultAudit(
        aggregateRoot,
        "packages/belldandy-core/src/subtask-supervisor-worktree-disposal-runtime.test.ts",
      );

      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });

      expectSessionLongRunningCompletionFailure(
        result,
        "parallel_resource_convergence",
      );
    });
  });

  it("completes local headless ecosystem contracts from the current-harness coding-run client audit without scoring", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodingRunClientEvidence(aggregateRoot);

      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });

      expect(result.status).toBe("partial");
      expect(result.dimensions.find(({ id }) => id === "headless_ecosystem")).toEqual({
        id: "headless_ecosystem",
        status: "partial",
        resolvedEvidenceContracts: [
          {
            id: "external_consumer_pair_lifecycle",
            owner: "candidateCodingRunClientReceipt",
            completion: "current_harness_packed_esm_and_typescript_consumers_passed",
            status: "complete",
          },
          {
            id: "protocol_version_conformance",
            owner: "candidateCodingRunClientReceipt",
            completion: "current_harness_protocol_version_conformance_passed",
            status: "complete",
          },
          {
            id: "error_taxonomy_cancellation_conformance",
            owner: "candidateCodingRunClientReceipt",
            completion: "current_harness_error_taxonomy_and_cancellation_conformance_passed",
            status: "complete",
          },
        ],
        missingEvidenceContracts: ["real_ci_consumer_binding"],
      });
      expect(result.dimensions.every((dimension) => !("score" in dimension))).toBe(true);
    });
  });

  it("does not infer local headless ecosystem claims from a coding-run client owner alone", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodingRunClientEvidence(aggregateRoot);
      const reference = await readEvidenceReference(aggregateRoot);
      reference.claims.splice(-3, 3);
      await writeEvidenceReference(aggregateRoot, reference);

      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });

      expect(result.dimensions.find(({ id }) => id === "headless_ecosystem")).toEqual({
        id: "headless_ecosystem",
        status: "partial",
        resolvedEvidenceContracts: [],
        missingEvidenceContracts: [
          "external_consumer_pair_lifecycle",
          "real_ci_consumer_binding",
          "protocol_version_conformance",
          "error_taxonomy_cancellation_conformance",
        ],
      });
      expect(result.dimensions.every((dimension) => !("score" in dimension))).toBe(true);
    });
  });

  it("rejects a declared coding-run client CI owner when its receipt artifact is missing", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodingRunClientEvidence(aggregateRoot);
      const reference = await readEvidenceReference(aggregateRoot);
      reference.owners.candidateCodingRunClientCiReceipt = {
        kind: "candidate_artifact",
        scope: "candidate_harness",
        artifactSchemaVersion:
          "coding-agent-benchmark-candidate-coding-run-client-ci-evidence-receipt/v1",
        artifact: {
          path: "candidate-coding-run-client-ci-evidence-receipt.json",
          sha256: "a".repeat(64),
        },
      };
      const protocolClaimIndex = reference.claims.findIndex(
        ({ contractId }) => contractId === "protocol_version_conformance",
      );
      reference.claims.splice(protocolClaimIndex, 0, {
        dimensionId: "headless_ecosystem",
        contractId: "real_ci_consumer_binding",
        owner: "candidateCodingRunClientCiReceipt",
        completion: "current_harness_dual_platform_github_actions_coding_run_client_passed",
      });
      await writeEvidenceReference(aggregateRoot, reference);

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/unable to read .*candidate coding-run client CI receipt/i);
    });
  });

  it("completes all headless ecosystem contracts from self-consistent dual-platform CI artifacts", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodingRunClientEvidence(aggregateRoot);
      await addCandidateCodingRunClientCiEvidence(aggregateRoot);

      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });

      expect(result.status).toBe("partial");
      expect(result.dimensions.find(({ id }) => id === "headless_ecosystem")).toEqual({
        id: "headless_ecosystem",
        status: "complete",
        resolvedEvidenceContracts: [
          {
            id: "external_consumer_pair_lifecycle",
            owner: "candidateCodingRunClientReceipt",
            completion: "current_harness_packed_esm_and_typescript_consumers_passed",
            status: "complete",
          },
          {
            id: "real_ci_consumer_binding",
            owner: "candidateCodingRunClientCiReceipt",
            completion: "current_harness_dual_platform_github_actions_coding_run_client_passed",
            status: "complete",
          },
          {
            id: "protocol_version_conformance",
            owner: "candidateCodingRunClientReceipt",
            completion: "current_harness_protocol_version_conformance_passed",
            status: "complete",
          },
          {
            id: "error_taxonomy_cancellation_conformance",
            owner: "candidateCodingRunClientReceipt",
            completion: "current_harness_error_taxonomy_and_cancellation_conformance_passed",
            status: "complete",
          },
        ],
        missingEvidenceContracts: [],
      });
      expect(result.dimensions.every((dimension) => !("score" in dimension))).toBe(true);
    });
  });

  it("rejects a self-consistent GitHub run URL bound to another repository and run", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodingRunClientEvidence(aggregateRoot);
      await addCandidateCodingRunClientCiEvidence(aggregateRoot);

      const reference = await readEvidenceReference(aggregateRoot);
      const receiptPath = reference.owners.candidateCodingRunClientCiReceipt.artifact.path;
      const receipt = JSON.parse(await fs.readFile(
        path.join(aggregateRoot, ...receiptPath.split("/")),
        "utf-8",
      ));
      const runApiPath = receipt.github.apiEvidence.run.path;
      const runApi = JSON.parse(await fs.readFile(
        path.join(aggregateRoot, ...runApiPath.split("/")),
        "utf-8",
      ));
      const driftedUrl = "https://github.com/attacker/other/actions/runs/999999";
      receipt.github.run.htmlUrl = driftedUrl;
      runApi.html_url = driftedUrl;
      const runApiText = serializeJson(runApi);
      await writeRelativeFile(aggregateRoot, runApiPath, runApiText);
      receipt.github.apiEvidence.run.sha256 = sha256(runApiText);
      const receiptText = serializeJson(receipt);
      await writeRelativeFile(aggregateRoot, receiptPath, receiptText);
      reference.owners.candidateCodingRunClientCiReceipt.artifact.sha256 = sha256(receiptText);
      await writeEvidenceReference(aggregateRoot, reference);

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/GitHub run .* drifted/i);
    });
  });

  it("rejects partial or reordered local headless ecosystem claims", async () => {
    for (const mutate of [
      (claims) => claims.pop(),
      (claims) => {
        [claims[claims.length - 2], claims[claims.length - 1]] =
          [claims[claims.length - 1], claims[claims.length - 2]];
      },
    ]) {
      await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
        await addCandidateCodingRunClientEvidence(aggregateRoot);
        const reference = await readEvidenceReference(aggregateRoot);
        mutate(reference.claims);
        await writeEvidenceReference(aggregateRoot, reference);

        await expect(loadCodingAgentCandidateDimensionEvidence({
          aggregateRoot,
          verifiedAggregate: { report, baselineIndex },
        })).rejects.toThrow(/evidence claims drifted/i);
      });
    }
  });

  it("rejects byte drift in the coding-run client receipt, Verification DAG, or native test report", async () => {
    for (const artifactKind of ["receipt", "verificationDag", "nativeTestReport"]) {
      await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
        await addCandidateCodingRunClientEvidence(aggregateRoot);
        const receipt = JSON.parse(await fs.readFile(path.join(
          aggregateRoot,
          "candidate-coding-run-client-evidence-receipt.json",
        ), "utf-8"));
        const relativePath = {
          receipt: "candidate-coding-run-client-evidence-receipt.json",
          verificationDag: receipt.audit.verificationDag.path,
          nativeTestReport: receipt.audit.nativeTestReport.path,
        }[artifactKind];
        await fs.appendFile(path.join(aggregateRoot, ...relativePath.split("/")), "\n");

        await expect(loadCodingAgentCandidateDimensionEvidence({
          aggregateRoot,
          verifiedAggregate: { report, baselineIndex },
        }), artifactKind).rejects.toThrow(/coding-run client (?:receipt|audit) digest drifted/i);
      });
    }
  });

  it("rejects self-consistent coding-run client aggregate, harness, command, or test-selection drift", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodingRunClientEvidence(aggregateRoot);
      await mutateCandidateCodingRunClientReceipt(aggregateRoot, (receipt) => {
        receipt.aggregate.harness.commit = "7".repeat(40);
      });

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/coding-run client receipt binding drifted/i);
    });

    for (const drift of ["harness", "command"]) {
      await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
        await addCandidateCodingRunClientEvidence(aggregateRoot);
        await mutateCandidateCodingRunClientJsonArtifact(
          aggregateRoot,
          (receipt) => receipt.audit.verificationDag,
          (dag) => {
            if (drift === "harness") dag.revision.commit = "7".repeat(40);
            else dag.nodes[0].command = "corepack pnpm test";
          },
        );

        await expect(loadCodingAgentCandidateDimensionEvidence({
          aggregateRoot,
          verifiedAggregate: { report, baselineIndex },
        }), drift).rejects.toThrow(/coding-run client audit binding drifted/i);
      });
    }

    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodingRunClientEvidence(aggregateRoot);
      await mutateCandidateCodingRunClientAuditReport(aggregateRoot, (nativeReport) => {
        nativeReport.testResults[0].name =
          "E:/project/star-sanctuary/scripts/unrelated.test.mjs";
      });

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/coding-run client audit test selection drifted/i);
    });
  });

  it("rejects schema-valid coding-run client DAG terminal evidence that disagrees with its native report", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateCodingRunClientEvidence(aggregateRoot);
      await mutateCandidateCodingRunClientJsonArtifact(
        aggregateRoot,
        (receipt) => receipt.audit.verificationDag,
        (dag) => {
          const [node] = dag.nodes;
          const [attempt] = node.attempts;
          node.status = "failed";
          attempt.status = "failed";
          attempt.commandJob.status = "failed";
          attempt.commandJob.exit.taxonomy = "non_zero_exit";
          attempt.commandJob.exit.exitCode = 1;
          dag.outcome = {
            taskStatus: "verification_failed",
            verificationStatus: "failed",
            reason: "required_failure",
            firstFailureNodeId: node.id,
          };
        },
      );

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/coding-run client audit terminal binding drifted/i);
    });
  });

  it("fails only the matching local headless ecosystem contract for a trustworthy audit failure", async () => {
    for (const [failedTestFile, failedContractId] of [
      [
        "scripts/run-coding-run-client-external-consumer.test.mjs",
        "external_consumer_pair_lifecycle",
      ],
      [
        "scripts/coding-run-client-conformance.test.mjs",
        "protocol_version_conformance",
      ],
      [
        "scripts/coding-run-client-failure-conformance.test.mjs",
        "error_taxonomy_cancellation_conformance",
      ],
    ]) {
      await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
        await addCandidateCodingRunClientEvidence(aggregateRoot);
        await failCandidateCodingRunClientAudit(aggregateRoot, failedTestFile);

        const result = await loadCodingAgentCandidateDimensionEvidence({
          aggregateRoot,
          verifiedAggregate: { report, baselineIndex },
        });

        expectHeadlessEcosystemCompletionFailure(result, failedContractId);
      });
    }
  });

  it("completes editing and testing from current-candidate Verification evidence without scoring", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateVerificationEvidence(aggregateRoot);

      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });

      expect(result.status).toBe("partial");
      expect(result.dimensions.find(({ id }) => id === "editing_testing")).toEqual({
        id: "editing_testing",
        status: "complete",
        resolvedEvidenceContracts: [
          {
            id: "verification_impact_truth_set",
            owner: "candidateVerificationReceipt",
            completion: "current_selector_truth_set_gate_passed",
            status: "complete",
          },
          {
            id: "verification_structured_test_reports",
            owner: "candidateVerificationReceipt",
            completion: "current_harness_structured_test_audit_passed",
            status: "complete",
          },
          {
            id: "verification_failure_replay",
            owner: "candidateVerificationReceipt",
            completion: "current_harness_reproducible_failure_replay_preserved",
            status: "complete",
          },
          {
            id: "browser_relay_behavior_evidence",
            owner: "candidateVerificationReceipt",
            completion: "current_harness_three_viewport_browser_relay_passed_zero_residue",
            status: "complete",
          },
        ],
        missingEvidenceContracts: [],
      });
      expect(result.dimensions.every((dimension) => !("score" in dimension))).toBe(true);
    });
  });

  it("rejects a self-consistent Browser Relay report whose viewport drifted from its receipt", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateVerificationEvidence(aggregateRoot);
      await mutateCandidateVerificationBrowserRun(
        aggregateRoot,
        0,
        (browserReport) => {
          browserReport.viewport.width = 390;
          browserReport.screenshot.width = 390;
        },
      );

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/Verification Browser Relay viewport binding drifted/i);
    });
  });

  it("rejects byte drift in every candidate Verification artifact layer", async () => {
    for (const artifactKind of [
      "receipt",
      "impactTruthSet",
      "structuredTestDag",
      "nativeTestReport",
      "failureReplayDag",
      "browserReport",
      "browserEvidence",
      "browserScreenshot",
    ]) {
      await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
        await addCandidateVerificationEvidence(aggregateRoot);
        const receipt = JSON.parse(await fs.readFile(path.join(
          aggregateRoot,
          "candidate-verification-evidence-receipt.json",
        ), "utf-8"));
        const relativePath = {
          receipt: "candidate-verification-evidence-receipt.json",
          impactTruthSet: receipt.impactTruthSet.path,
          structuredTestDag: receipt.structuredTestAudit.verificationDag.path,
          nativeTestReport: receipt.structuredTestAudit.nativeTestReport.path,
          failureReplayDag: receipt.failureReplay.verificationDag.path,
          browserReport: receipt.browserRelay.runs[0].report.path,
          browserEvidence: receipt.browserRelay.runs[0].evidence.path,
          browserScreenshot: receipt.browserRelay.runs[0].screenshot.path,
        }[artifactKind];
        await fs.appendFile(
          path.join(aggregateRoot, ...relativePath.split("/")),
          artifactKind === "browserScreenshot" ? Buffer.from([0]) : "\n",
        );

        await expect(loadCodingAgentCandidateDimensionEvidence({
          aggregateRoot,
          verifiedAggregate: { report, baselineIndex },
        }), artifactKind).rejects.toThrow();
      });
    }
  });

  it("rejects a self-consistent failure replay binding from another candidate harness", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateVerificationEvidence(aggregateRoot);
      await mutateCandidateVerificationJsonArtifact(
        aggregateRoot,
        (receipt) => receipt.failureReplay.verificationDag,
        (dag, receipt) => {
          const replayBinding = {
            environmentHash: "7".repeat(64),
            inputHash: "8".repeat(64),
          };
          const failureFingerprint = "9".repeat(64);
          receipt.failureReplay.replayBinding = replayBinding;
          receipt.failureReplay.initialFailureFingerprint = failureFingerprint;
          dag.nodes[0].attempts.slice(1).forEach((attempt) => {
            attempt.replayEvidence.binding = replayBinding;
            attempt.replayEvidence.failureFingerprint = failureFingerprint;
          });
          dag.nodes[0].replay.binding = replayBinding;
          dag.nodes[0].replay.failureFingerprint = failureFingerprint;
        },
      );

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/Verification failure-replay binding drifted/i);
    });
  });

  it("rejects self-consistent Impact, structured-test, or Browser identity and selection drift", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateVerificationEvidence(aggregateRoot);
      await mutateCandidateVerificationJsonArtifact(
        aggregateRoot,
        (receipt) => receipt.impactTruthSet,
        (impactReport) => {
          impactReport.selector.sourceSha256 = "7".repeat(64);
        },
      );

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/Verification impact truth-set binding drifted/i);
    });

    for (const drift of ["revision", "command"]) {
      await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
        await addCandidateVerificationEvidence(aggregateRoot);
        await mutateCandidateVerificationJsonArtifact(
          aggregateRoot,
          (receipt) => receipt.structuredTestAudit.verificationDag,
          (dag) => {
            if (drift === "revision") dag.revision.commit = "7".repeat(40);
            else dag.nodes[0].command = "corepack pnpm test";
          },
        );

        await expect(loadCodingAgentCandidateDimensionEvidence({
          aggregateRoot,
          verifiedAggregate: { report, baselineIndex },
        }), drift).rejects.toThrow(/Verification structured-test binding drifted/i);
      });
    }

    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateVerificationEvidence(aggregateRoot);
      await mutateCandidateVerificationStructuredTestReport(
        aggregateRoot,
        (nativeReport) => {
          nativeReport.testResults[0].name =
            "E:/project/star-sanctuary/scripts/unrelated.test.mjs";
        },
      );

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/Verification structured-test selection drifted/i);
    });

    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateVerificationEvidence(aggregateRoot);
      await mutateCandidateVerificationBrowserRun(
        aggregateRoot,
        0,
        (browserReport) => {
          browserReport.revision.commit = "7".repeat(40);
        },
      );

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/Browser report revision does not match/i);
    });
  });

  it("projects trustworthy structured-test, replay, or Browser completion failures as failed without scoring", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateVerificationEvidence(aggregateRoot);
      await failCandidateVerificationStructuredTestAudit(aggregateRoot);

      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });
      expectEditingTestingCompletionFailure(
        result,
        "verification_structured_test_reports",
      );
    });

    for (const classification of ["flaky", "non_reproducible"]) {
      await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
        await addCandidateVerificationEvidence(aggregateRoot);
        await setCandidateVerificationFailureReplayOutcome(aggregateRoot, classification);

        const result = await loadCodingAgentCandidateDimensionEvidence({
          aggregateRoot,
          verifiedAggregate: { report, baselineIndex },
        });
        expectEditingTestingCompletionFailure(result, "verification_failure_replay");
      });
    }

    for (const failureKind of ["console", "lifecycle"]) {
      await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
        await addCandidateVerificationEvidence(aggregateRoot);
        await mutateCandidateVerificationBrowserRun(
          aggregateRoot,
          0,
          (browserReport) => {
            if (failureKind === "console") browserReport.console.errorCount = 1;
            else {
              browserReport.lifecycle.status = "incomplete";
              browserReport.lifecycle.pageClosed = false;
            }
          },
        );

        const result = await loadCodingAgentCandidateDimensionEvidence({
          aggregateRoot,
          verifiedAggregate: { report, baselineIndex },
        });
        expectEditingTestingCompletionFailure(
          result,
          "browser_relay_behavior_evidence",
        );
      });
    }
  });

  it("rejects self-consistent Supervisor soak or fault-audit evidence from an older harness revision", async () => {
    for (const artifactKind of ["soak", "verificationDag"]) {
      await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
        await addCandidateSupervisorEvidence(aggregateRoot);
        await mutateCandidateSupervisorJsonArtifact(
          aggregateRoot,
          (receipt) => artifactKind === "soak"
            ? receipt.soak.reports[0]
            : receipt.faultAudit.verificationDag,
          (artifact) => {
            if (artifactKind === "soak") {
              artifact.sourceIdentity.workspaceRevision = "c".repeat(40);
            } else {
              artifact.revision.commit = "c".repeat(40);
            }
          },
        );

        await expect(loadCodingAgentCandidateDimensionEvidence({
          aggregateRoot,
          verifiedAggregate: { report, baselineIndex },
        })).rejects.toThrow(/Supervisor (?:soak identity|fault-audit binding) drifted/i);
      });
    }
  });

  it("rejects missing or duplicated Supervisor soak platforms", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateSupervisorEvidence(aggregateRoot);
      await mutateCandidateSupervisorReceipt(aggregateRoot, (receipt) => {
        receipt.soak.reports.pop();
      });

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/candidate Supervisor receipt does not match its schema/i);
    });

    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateSupervisorEvidence(aggregateRoot);
      await mutateCandidateSupervisorJsonArtifact(
        aggregateRoot,
        (receipt) => receipt.soak.reports[1],
        (artifact) => {
          artifact.platform = "windows-native";
        },
      );
      await mutateCandidateSupervisorReceipt(aggregateRoot, (receipt) => {
        receipt.soak.reports[1].platform = "windows-native";
      });

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/Supervisor soak platform pair drifted/i);
    });
  });

  it("rejects Supervisor fault-audit test selection drift across receipt, DAG, or native report", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateSupervisorEvidence(aggregateRoot);
      await mutateCandidateSupervisorReceipt(aggregateRoot, (receipt) => {
        receipt.faultAudit.testFiles[0] = "packages/belldandy-core/src/unrelated.test.ts";
      });

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/candidate Supervisor receipt does not match its schema/i);
    });

    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateSupervisorEvidence(aggregateRoot);
      await mutateCandidateSupervisorJsonArtifact(
        aggregateRoot,
        (receipt) => receipt.faultAudit.verificationDag,
        (artifact) => {
          artifact.nodes[0].command = "corepack pnpm test";
        },
      );

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/Supervisor fault-audit binding drifted/i);
    });

    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateSupervisorEvidence(aggregateRoot);
      await mutateCandidateSupervisorFaultAuditReport(aggregateRoot, (artifact) => {
        artifact.testResults[0].name = "E:/project/star-sanctuary/packages/belldandy-core/src/unrelated.test.ts";
      });

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/Supervisor fault-audit test selection drifted/i);
    });
  });

  it("rejects byte drift in the Supervisor receipt, soak, Verification DAG, or native test report", async () => {
    for (const artifactKind of ["receipt", "soak", "verificationDag", "nativeTestReport"]) {
      await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
        await addCandidateSupervisorEvidence(aggregateRoot);
        const receiptPath = path.join(
          aggregateRoot,
          "candidate-supervisor-evidence-receipt.json",
        );
        const receipt = JSON.parse(await fs.readFile(receiptPath, "utf-8"));
        const relativePath = {
          receipt: "candidate-supervisor-evidence-receipt.json",
          soak: receipt.soak.reports[0].path,
          verificationDag: receipt.faultAudit.verificationDag.path,
          nativeTestReport: receipt.faultAudit.nativeTestReport.path,
        }[artifactKind];
        await fs.appendFile(
          path.join(aggregateRoot, ...relativePath.split("/")),
          "\n",
          "utf-8",
        );

        await expect(loadCodingAgentCandidateDimensionEvidence({
          aggregateRoot,
          verifiedAggregate: { report, baselineIndex },
        })).rejects.toThrow({
          receipt: /candidate Supervisor receipt digest drifted/i,
          soak: /candidate Supervisor soak digest or schema drifted/i,
          verificationDag: /candidate Supervisor fault-audit digest drifted/i,
          nativeTestReport: /candidate Supervisor fault-audit digest drifted/i,
        }[artifactKind]);
      });
    }
  });

  it("rejects self-consistent Supervisor aggregate, soak-pair, or DAG workspace identity drift", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateSupervisorEvidence(aggregateRoot);
      await mutateCandidateSupervisorReceipt(aggregateRoot, (receipt) => {
        receipt.aggregate.harness = versionedIdentity("c");
      });

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/candidate Supervisor receipt binding drifted/i);
    });

    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateSupervisorEvidence(aggregateRoot);
      await mutateCandidateSupervisorJsonArtifact(
        aggregateRoot,
        (receipt) => receipt.soak.reports[0],
        (artifact) => {
          artifact.sourceIdentity.files[0].sha256 = "c".repeat(64);
          artifact.sourceIdentity.aggregateSha256 = sha256(
            JSON.stringify(artifact.sourceIdentity.files),
          );
        },
      );

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/Supervisor soak pair binding drifted/i);
    });

    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateSupervisorEvidence(aggregateRoot);
      await mutateCandidateSupervisorJsonArtifact(
        aggregateRoot,
        (receipt) => receipt.faultAudit.verificationDag,
        (artifact) => {
          artifact.revision.workspaceHash = "c".repeat(64);
        },
      );

      await expect(loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      })).rejects.toThrow(/Supervisor fault-audit binding drifted/i);
    });
  });

  it("projects trustworthy Supervisor soak or fault-audit Gate failures as failed without scoring", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateSupervisorEvidence(aggregateRoot);
      await mutateCandidateSupervisorJsonArtifact(
        aggregateRoot,
        (receipt) => receipt.soak.reports[0],
        (artifact) => {
          artifact.workload.laneSucceeded = 320;
          artifact.workload.laneFailed = 40;
          artifact.workload.successRate = 320 / 360;
          artifact.workload.firstFailureCode = "lane_execution_failed";
          artifact.gate = { passed: false, failures: ["lane_success_rate_failed"] };
        },
      );

      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });

      expectSafetyCompletionFailure(result, "fault_matrix_audit_reconciliation", [
        "system_evidence_critical_rate",
        "candidate_sensitive_scan",
        "candidate_resource_sweeps",
      ]);
    });

    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await addCandidateSupervisorEvidence(aggregateRoot);
      await failCandidateSupervisorFaultAudit(aggregateRoot);

      const result = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });

      expectSafetyCompletionFailure(result, "fault_matrix_audit_reconciliation", [
        "system_evidence_critical_rate",
        "candidate_sensitive_scan",
        "candidate_resource_sweeps",
      ]);
    });
  });
});

async function mutateCandidateGlobalReceipt(aggregateRoot, mutate) {
  const receiptPath = path.join(aggregateRoot, "candidate-global-receipt.json");
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf-8"));
  mutate(receipt);
  const receiptText = serializeJson(receipt);
  await fs.writeFile(receiptPath, receiptText, "utf-8");
  const reference = await readEvidenceReference(aggregateRoot);
  reference.owners.candidateGlobalReceipt.artifact.sha256 = sha256(receiptText);
  await writeEvidenceReference(aggregateRoot, reference);
}

async function addCandidateSupervisorEvidence(aggregateRoot) {
  const reference = await readEvidenceReference(aggregateRoot);
  const sourceIdentityFiles = SUPERVISOR_SOAK_SOURCE_FILES.map((relativePath, index) => ({
    path: relativePath,
    sha256: String((index % 9) + 1).repeat(64),
  }));
  const sourceIdentity = {
    workspaceRevision: reference.aggregate.harness.commit,
    aggregateSha256: sha256(JSON.stringify(sourceIdentityFiles)),
    files: sourceIdentityFiles,
  };
  const soakArtifacts = [];
  for (const platform of ["windows-native", "wsl2-linux"]) {
    const relativePath = `candidate-evidence/supervisor/soak-${platform}.json`;
    const reportText = serializeJson(createSupervisorSoakReport(platform, sourceIdentity));
    await writeRelativeFile(aggregateRoot, relativePath, reportText);
    soakArtifacts.push({ platform, path: relativePath, sha256: sha256(reportText) });
  }

  const testReportPath = "candidate-evidence/supervisor/fault-audit-vitest-report.json";
  const testReportText = serializeJson(createSupervisorFaultAuditVitestReport());
  await writeRelativeFile(aggregateRoot, testReportPath, testReportText);
  const verificationDag = replayCommandJobSnapshots(createVerificationDagPlan({
    runId: "candidate-supervisor-fault-audit",
    taskId: "p2c-supervisor-fault-audit",
    generatedAt: "2026-09-01T01:30:00.000Z",
    commit: reference.aggregate.harness.commit,
    workspaceHash: reference.aggregate.harness.worktreeContentSha256,
    verificationCommands: [{
      id: "supervisor.fault-audit",
      kind: "acceptance",
      scope: "full",
      command: SUPERVISOR_FAULT_AUDIT_COMMAND,
    }],
  }), [{
    id: "supervisor.fault-audit",
    snapshot: {
      jobId: "12345678-1234-4234-8234-123456789abc",
      status: "completed",
      terminationReason: null,
      exitCode: 0,
      signal: null,
      timeoutMs: 900_000,
      deadlineAt: 1_788_228_900_000,
      endedAt: 1_788_228_100_000,
      recovery: { lifecycle: "settled" },
    },
    testReport: {
      framework: "vitest",
      format: "vitest-json/v3.2.7",
      runnerVersion: "3.2.7",
      artifact: { path: testReportPath, sha256: sha256(testReportText) },
      content: testReportText,
    },
  }]);
  const verificationDagPath = "candidate-evidence/supervisor/fault-audit-verification-dag.json";
  const verificationDagText = serializeJson(verificationDag);
  await writeRelativeFile(aggregateRoot, verificationDagPath, verificationDagText);

  const receipt = {
    schemaVersion: "coding-agent-benchmark-candidate-supervisor-evidence-receipt/v1",
    generatedAt: "2026-09-01T01:45:00.000Z",
    aggregate: reference.aggregate,
    soak: {
      artifactSchemaVersion: "p2a-subtask-supervisor-soak-report/v1",
      reports: soakArtifacts,
    },
    faultAudit: {
      verificationDag: {
        artifactSchemaVersion: "verification-dag/v1",
        path: verificationDagPath,
        sha256: sha256(verificationDagText),
      },
      nativeTestReport: {
        framework: "vitest",
        format: "vitest-json/v3.2.7",
        runnerVersion: "3.2.7",
        path: testReportPath,
        sha256: sha256(testReportText),
      },
      testFiles: [...SUPERVISOR_FAULT_AUDIT_TEST_FILES],
    },
  };
  const receiptText = serializeJson(receipt);
  const receiptPath = "candidate-supervisor-evidence-receipt.json";
  await writeRelativeFile(aggregateRoot, receiptPath, receiptText);
  reference.owners.candidateSupervisorReceipt = {
    kind: "candidate_artifact",
    scope: "candidate_harness",
    artifactSchemaVersion: receipt.schemaVersion,
    artifact: { path: receiptPath, sha256: sha256(receiptText) },
  };
  reference.claims.push({
    dimensionId: "safety_recovery",
    contractId: "fault_matrix_audit_reconciliation",
    owner: "candidateSupervisorReceipt",
    completion: "current_harness_dual_platform_soak_and_fault_audit_passed",
  });
  await writeEvidenceReference(aggregateRoot, reference);
}

async function addCandidateSessionLongRunningClaims(aggregateRoot) {
  const reference = await readEvidenceReference(aggregateRoot);
  reference.claims.push(
    {
      dimensionId: "session_long_running",
      contractId: "supervisor_dual_platform_60_minute_soak",
      owner: "candidateSupervisorReceipt",
      completion: "current_harness_dual_platform_60_minute_soak_passed",
    },
    {
      dimensionId: "session_long_running",
      contractId: "bounded_budget_cancel_restart_reattach",
      owner: "candidateSupervisorReceipt",
      completion: "current_harness_bounded_budget_cancel_restart_reattach_audit_passed",
    },
    {
      dimensionId: "session_long_running",
      contractId: "managed_worktree_fan_in_review_remediation",
      owner: "candidateSupervisorReceipt",
      completion: "current_harness_managed_worktree_fan_in_review_remediation_audit_passed",
    },
    {
      dimensionId: "session_long_running",
      contractId: "parallel_resource_convergence",
      owner: "candidateSupervisorReceipt",
      completion: "current_harness_parallel_resources_converged_zero_residue",
    },
  );
  await writeEvidenceReference(aggregateRoot, reference);
}

async function addCandidateCodingRunClientEvidence(aggregateRoot) {
  const reference = await readEvidenceReference(aggregateRoot);
  const nativeTestReport = createCodingRunClientAuditVitestReport();
  const nativeTestReportText = serializeJson(nativeTestReport);
  const nativeTestReportPath =
    "candidate-evidence/coding-run-client/audit-vitest-report.json";
  await writeRelativeFile(aggregateRoot, nativeTestReportPath, nativeTestReportText);

  const verificationDag = replayCommandJobSnapshots(createVerificationDagPlan({
    runId: "candidate-coding-run-client-audit",
    taskId: "p2c-coding-run-client-audit",
    generatedAt: "2026-09-01T02:50:00.000Z",
    commit: reference.aggregate.harness.commit,
    workspaceHash: reference.aggregate.harness.worktreeContentSha256,
    verificationCommands: [{
      id: "coding-run-client.audit",
      kind: "acceptance",
      scope: "full",
      command: CODING_RUN_CLIENT_AUDIT_COMMAND,
    }],
  }), [{
    id: "coding-run-client.audit",
    snapshot: {
      jobId: "32345678-1234-4234-8234-123456789abc",
      status: "completed",
      terminationReason: null,
      exitCode: 0,
      signal: null,
      timeoutMs: 900_000,
      deadlineAt: 1_788_231_600_000,
      endedAt: 1_788_230_800_000,
      recovery: { lifecycle: "settled" },
    },
    testReport: {
      framework: "vitest",
      format: "vitest-json/v3.2.7",
      runnerVersion: "3.2.7",
      artifact: {
        path: nativeTestReportPath,
        sha256: sha256(nativeTestReportText),
      },
      content: nativeTestReportText,
    },
  }]);
  const verificationDagPath =
    "candidate-evidence/coding-run-client/audit-verification-dag.json";
  const verificationDagText = serializeJson(verificationDag);
  await writeRelativeFile(aggregateRoot, verificationDagPath, verificationDagText);

  const receipt = {
    schemaVersion:
      "coding-agent-benchmark-candidate-coding-run-client-evidence-receipt/v1",
    generatedAt: "2026-09-01T03:00:00.000Z",
    aggregate: reference.aggregate,
    audit: {
      verificationDag: {
        artifactSchemaVersion: "verification-dag/v1",
        path: verificationDagPath,
        sha256: sha256(verificationDagText),
      },
      nativeTestReport: {
        framework: "vitest",
        format: "vitest-json/v3.2.7",
        runnerVersion: "3.2.7",
        path: nativeTestReportPath,
        sha256: sha256(nativeTestReportText),
      },
      testFiles: [...CODING_RUN_CLIENT_AUDIT_TEST_FILES],
    },
  };
  const receiptText = serializeJson(receipt);
  const receiptPath = "candidate-coding-run-client-evidence-receipt.json";
  await writeRelativeFile(aggregateRoot, receiptPath, receiptText);
  reference.owners.candidateCodingRunClientReceipt = {
    kind: "candidate_artifact",
    scope: "candidate_harness",
    artifactSchemaVersion: receipt.schemaVersion,
    artifact: { path: receiptPath, sha256: sha256(receiptText) },
  };
  reference.claims.push(
    {
      dimensionId: "headless_ecosystem",
      contractId: "external_consumer_pair_lifecycle",
      owner: "candidateCodingRunClientReceipt",
      completion: "current_harness_packed_esm_and_typescript_consumers_passed",
    },
    {
      dimensionId: "headless_ecosystem",
      contractId: "protocol_version_conformance",
      owner: "candidateCodingRunClientReceipt",
      completion: "current_harness_protocol_version_conformance_passed",
    },
    {
      dimensionId: "headless_ecosystem",
      contractId: "error_taxonomy_cancellation_conformance",
      owner: "candidateCodingRunClientReceipt",
      completion: "current_harness_error_taxonomy_and_cancellation_conformance_passed",
    },
  );
  await writeEvidenceReference(aggregateRoot, reference);
}

async function mutateCandidateCodingRunClientReceipt(aggregateRoot, mutate) {
  const receiptPath = path.join(
    aggregateRoot,
    "candidate-coding-run-client-evidence-receipt.json",
  );
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf-8"));
  mutate(receipt);
  const receiptText = serializeJson(receipt);
  await fs.writeFile(receiptPath, receiptText, "utf-8");
  const reference = await readEvidenceReference(aggregateRoot);
  reference.owners.candidateCodingRunClientReceipt.artifact.sha256 = sha256(receiptText);
  await writeEvidenceReference(aggregateRoot, reference);
}

async function mutateCandidateCodingRunClientJsonArtifact(
  aggregateRoot,
  selectReference,
  mutate,
) {
  const receiptPath = path.join(
    aggregateRoot,
    "candidate-coding-run-client-evidence-receipt.json",
  );
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf-8"));
  const artifactReference = selectReference(receipt);
  const artifactPath = path.join(aggregateRoot, ...artifactReference.path.split("/"));
  const artifact = JSON.parse(await fs.readFile(artifactPath, "utf-8"));
  mutate(artifact, receipt);
  const artifactText = serializeJson(artifact);
  await fs.writeFile(artifactPath, artifactText, "utf-8");
  artifactReference.sha256 = sha256(artifactText);
  const receiptText = serializeJson(receipt);
  await fs.writeFile(receiptPath, receiptText, "utf-8");
  const reference = await readEvidenceReference(aggregateRoot);
  reference.owners.candidateCodingRunClientReceipt.artifact.sha256 = sha256(receiptText);
  await writeEvidenceReference(aggregateRoot, reference);
}

async function mutateCandidateCodingRunClientAuditReport(aggregateRoot, mutate) {
  const receiptPath = path.join(
    aggregateRoot,
    "candidate-coding-run-client-evidence-receipt.json",
  );
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf-8"));
  const reportReference = receipt.audit.nativeTestReport;
  const reportPath = path.join(aggregateRoot, ...reportReference.path.split("/"));
  const nativeReport = JSON.parse(await fs.readFile(reportPath, "utf-8"));
  mutate(nativeReport);
  const reportText = serializeJson(nativeReport);
  await fs.writeFile(reportPath, reportText, "utf-8");
  reportReference.sha256 = sha256(reportText);

  const dagReference = receipt.audit.verificationDag;
  const dagPath = path.join(aggregateRoot, ...dagReference.path.split("/"));
  const dag = JSON.parse(await fs.readFile(dagPath, "utf-8"));
  dag.nodes[0].attempts[0].testReport.artifact.sha256 = reportReference.sha256;
  const dagText = serializeJson(dag);
  await fs.writeFile(dagPath, dagText, "utf-8");
  dagReference.sha256 = sha256(dagText);

  const receiptText = serializeJson(receipt);
  await fs.writeFile(receiptPath, receiptText, "utf-8");
  const reference = await readEvidenceReference(aggregateRoot);
  reference.owners.candidateCodingRunClientReceipt.artifact.sha256 = sha256(receiptText);
  await writeEvidenceReference(aggregateRoot, reference);
}

async function failCandidateCodingRunClientAudit(aggregateRoot, failedTestFile) {
  const receiptPath = path.join(
    aggregateRoot,
    "candidate-coding-run-client-evidence-receipt.json",
  );
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf-8"));
  const reportReference = receipt.audit.nativeTestReport;
  const reportPath = path.join(aggregateRoot, ...reportReference.path.split("/"));
  const report = JSON.parse(await fs.readFile(reportPath, "utf-8"));
  const failedResult = report.testResults.find((result) => {
    const normalized = result.name.replaceAll("\\", "/");
    return normalized === failedTestFile || normalized.endsWith(`/${failedTestFile}`);
  });
  if (failedResult === undefined) {
    throw new Error(`Unknown coding-run client audit test file: ${failedTestFile}`);
  }
  report.numPassedTestSuites = CODING_RUN_CLIENT_AUDIT_TEST_FILES.length - 1;
  report.numFailedTestSuites = 1;
  report.numPassedTests = CODING_RUN_CLIENT_AUDIT_TEST_FILES.length - 1;
  report.numFailedTests = 1;
  report.success = false;
  failedResult.status = "failed";
  failedResult.assertionResults[0].status = "failed";
  const reportText = serializeJson(report);
  await fs.writeFile(reportPath, reportText, "utf-8");
  reportReference.sha256 = sha256(reportText);

  const reference = await readEvidenceReference(aggregateRoot);
  const dag = replayCommandJobSnapshots(createVerificationDagPlan({
    runId: "candidate-coding-run-client-audit",
    taskId: "p2c-coding-run-client-audit",
    generatedAt: "2026-09-01T02:50:00.000Z",
    commit: reference.aggregate.harness.commit,
    workspaceHash: reference.aggregate.harness.worktreeContentSha256,
    verificationCommands: [{
      id: "coding-run-client.audit",
      kind: "acceptance",
      scope: "full",
      command: CODING_RUN_CLIENT_AUDIT_COMMAND,
    }],
  }), [{
    id: "coding-run-client.audit",
    snapshot: {
      jobId: "32345678-1234-4234-8234-123456789abc",
      status: "failed",
      terminationReason: null,
      exitCode: 1,
      signal: null,
      timeoutMs: 900_000,
      deadlineAt: 1_788_231_600_000,
      endedAt: 1_788_230_800_000,
      recovery: { lifecycle: "settled" },
    },
    testReport: {
      framework: "vitest",
      format: "vitest-json/v3.2.7",
      runnerVersion: "3.2.7",
      artifact: { path: reportReference.path, sha256: reportReference.sha256 },
      content: reportText,
    },
  }]);
  const dagReference = receipt.audit.verificationDag;
  const dagPath = path.join(aggregateRoot, ...dagReference.path.split("/"));
  const dagText = serializeJson(dag);
  await fs.writeFile(dagPath, dagText, "utf-8");
  dagReference.sha256 = sha256(dagText);

  const receiptText = serializeJson(receipt);
  await fs.writeFile(receiptPath, receiptText, "utf-8");
  reference.owners.candidateCodingRunClientReceipt.artifact.sha256 = sha256(receiptText);
  await writeEvidenceReference(aggregateRoot, reference);
}

async function addCandidateVerificationEvidence(aggregateRoot) {
  const reference = await readEvidenceReference(aggregateRoot);
  const verificationRoot = "candidate-evidence/verification";

  const impactReport = await buildVerificationImpactTruthSetReport({
    generatedAt: "2026-09-01T02:10:00.000Z",
  });
  const impactReportText = serializeJson(impactReport);
  const impactReportPath = `${verificationRoot}/impact-truth-set-report.json`;
  await writeRelativeFile(aggregateRoot, impactReportPath, impactReportText);

  const nativeTestReport = createVerificationAuditVitestReport();
  const nativeTestReportText = serializeJson(nativeTestReport);
  const nativeTestReportPath = `${verificationRoot}/structured-test-vitest-report.json`;
  await writeRelativeFile(aggregateRoot, nativeTestReportPath, nativeTestReportText);
  const structuredTestDag = replayCommandJobSnapshots(createVerificationDagPlan({
    runId: "candidate-verification-structured-test-audit",
    taskId: "p2c-verification-structured-test-audit",
    generatedAt: "2026-09-01T02:20:00.000Z",
    commit: reference.aggregate.harness.commit,
    workspaceHash: reference.aggregate.harness.worktreeContentSha256,
    verificationCommands: [{
      id: "verification.structured-test-audit",
      kind: "acceptance",
      scope: "full",
      command: VERIFICATION_AUDIT_COMMAND,
    }],
  }), [{
    id: "verification.structured-test-audit",
    snapshot: {
      jobId: "22345678-1234-4234-8234-123456789abc",
      status: "completed",
      terminationReason: null,
      exitCode: 0,
      signal: null,
      timeoutMs: 900_000,
      deadlineAt: 1_788_229_800_000,
      endedAt: 1_788_229_000_000,
      recovery: { lifecycle: "settled" },
    },
    testReport: {
      framework: "vitest",
      format: "vitest-json/v3.2.7",
      runnerVersion: "3.2.7",
      artifact: {
        path: nativeTestReportPath,
        sha256: sha256(nativeTestReportText),
      },
      content: nativeTestReportText,
    },
  }]);
  const structuredTestDagText = serializeJson(structuredTestDag);
  const structuredTestDagPath = `${verificationRoot}/structured-test-verification-dag.json`;
  await writeRelativeFile(aggregateRoot, structuredTestDagPath, structuredTestDagText);

  const replayBinding = VERIFICATION_REPLAY_BINDING;
  const failureFingerprint = VERIFICATION_REPLAY_FAILURE_FINGERPRINT;
  const failureReplayDag = finalizeVerificationDag(createVerificationDagPlan({
    runId: "candidate-verification-failure-replay",
    taskId: "p2c-verification-failure-replay",
    generatedAt: "2026-09-01T02:30:00.000Z",
    commit: reference.aggregate.harness.commit,
    workspaceHash: reference.aggregate.harness.worktreeContentSha256,
    verificationCommands: [{
      id: "verification.failure-replay",
      kind: "acceptance",
      scope: "full",
      command: VERIFICATION_FAILURE_REPLAY_COMMAND,
    }],
  }), [{
    id: "verification.failure-replay",
    status: "failed",
    kind: "test",
    message: VERIFICATION_REPLAY_FAILURE_MESSAGE,
    replayBinding,
    failureFingerprint,
    replays: [
      { status: "failed", kind: "test", replayBinding, failureFingerprint },
      { status: "failed", kind: "test", replayBinding, failureFingerprint },
    ],
  }]);
  const failureReplayDagText = serializeJson(failureReplayDag);
  const failureReplayDagPath = `${verificationRoot}/failure-replay-verification-dag.json`;
  await writeRelativeFile(aggregateRoot, failureReplayDagPath, failureReplayDagText);

  const browserRuns = [];
  for (const viewport of VERIFICATION_BROWSER_VIEWPORTS) {
    const browserRoot = `${verificationRoot}/browser/${viewport.runId}`;
    const reportPath = `${browserRoot}/browser-report.json`;
    const evidencePath = `${browserRoot}/browser-evidence.json`;
    const screenshotPath = `${browserRoot}/browser-screenshot.png`;
    const screenshotContent = Buffer.concat([BROWSER_PNG, Buffer.from(viewport.runId)]);
    const report = createVerificationBrowserReport({
      revision: {
        commit: reference.aggregate.harness.commit,
        workspaceHash: reference.aggregate.harness.worktreeContentSha256,
      },
      viewport,
      screenshotPath,
      screenshotContent,
    });
    const reportText = serializeJson(report);
    const evidence = projectVerificationBrowserReport({
      artifact: { path: reportPath, sha256: sha256(reportText) },
      content: reportText,
      screenshotContent,
      expectedRevision: report.revision,
    });
    const evidenceText = serializeJson(evidence);
    await Promise.all([
      writeRelativeFile(aggregateRoot, reportPath, reportText),
      writeRelativeFile(aggregateRoot, evidencePath, evidenceText),
      writeRelativeFile(aggregateRoot, screenshotPath, screenshotContent),
    ]);
    browserRuns.push({
      runId: viewport.runId,
      viewport: {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor,
      },
      report: { path: reportPath, sha256: sha256(reportText) },
      evidence: { path: evidencePath, sha256: sha256(evidenceText) },
      screenshot: { path: screenshotPath, sha256: sha256(screenshotContent) },
    });
  }

  const receipt = {
    schemaVersion: "coding-agent-benchmark-candidate-verification-evidence-receipt/v1",
    generatedAt: "2026-09-01T03:00:00.000Z",
    aggregate: reference.aggregate,
    impactTruthSet: {
      artifactSchemaVersion: "verification-impact-truth-set-report/v1",
      path: impactReportPath,
      sha256: sha256(impactReportText),
    },
    structuredTestAudit: {
      verificationDag: {
        artifactSchemaVersion: "verification-dag/v1",
        path: structuredTestDagPath,
        sha256: sha256(structuredTestDagText),
      },
      nativeTestReport: {
        framework: "vitest",
        format: "vitest-json/v3.2.7",
        runnerVersion: "3.2.7",
        path: nativeTestReportPath,
        sha256: sha256(nativeTestReportText),
      },
      testFiles: [...VERIFICATION_AUDIT_TEST_FILES],
    },
    failureReplay: {
      fixtureId: "verification-dag-reproducible-failure-v1",
      nodeId: "verification.failure-replay",
      expectedClassification: "reproducible_failure",
      replayBinding,
      initialFailureFingerprint: failureFingerprint,
      verificationDag: {
        artifactSchemaVersion: "verification-dag/v1",
        path: failureReplayDagPath,
        sha256: sha256(failureReplayDagText),
      },
    },
    browserRelay: {
      artifactSchemaVersion: "verification-browser-evidence/v1",
      runs: browserRuns,
    },
  };
  const receiptText = serializeJson(receipt);
  const receiptPath = "candidate-verification-evidence-receipt.json";
  await writeRelativeFile(aggregateRoot, receiptPath, receiptText);
  reference.owners.candidateVerificationReceipt = {
    kind: "candidate_artifact",
    scope: "candidate_harness",
    artifactSchemaVersion: receipt.schemaVersion,
    artifact: { path: receiptPath, sha256: sha256(receiptText) },
  };
  reference.claims.push(
    {
      dimensionId: "editing_testing",
      contractId: "verification_impact_truth_set",
      owner: "candidateVerificationReceipt",
      completion: "current_selector_truth_set_gate_passed",
    },
    {
      dimensionId: "editing_testing",
      contractId: "verification_structured_test_reports",
      owner: "candidateVerificationReceipt",
      completion: "current_harness_structured_test_audit_passed",
    },
    {
      dimensionId: "editing_testing",
      contractId: "verification_failure_replay",
      owner: "candidateVerificationReceipt",
      completion: "current_harness_reproducible_failure_replay_preserved",
    },
    {
      dimensionId: "editing_testing",
      contractId: "browser_relay_behavior_evidence",
      owner: "candidateVerificationReceipt",
      completion: "current_harness_three_viewport_browser_relay_passed_zero_residue",
    },
  );
  await writeEvidenceReference(aggregateRoot, reference);
}

function createVerificationAuditVitestReport() {
  const testResults = VERIFICATION_AUDIT_TEST_FILES.map((relativePath, index) => ({
    name: `E:/project/star-sanctuary/${relativePath}`,
    status: "passed",
    message: "",
    assertionResults: [{
      ancestorTitles: [],
      fullName: `P1-B verification audit ${index}`,
      status: "passed",
      title: `P1-B verification audit ${index}`,
      duration: 1,
      failureMessages: [],
    }],
  }));
  return {
    numTotalTestSuites: testResults.length,
    numPassedTestSuites: testResults.length,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numTotalTests: testResults.length,
    numPassedTests: testResults.length,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    startTime: 1,
    success: true,
    testResults,
  };
}

function createCodingRunClientAuditVitestReport() {
  const testResults = CODING_RUN_CLIENT_AUDIT_TEST_FILES.map((relativePath, index) => ({
    name: `E:/project/star-sanctuary/${relativePath}`,
    status: "passed",
    message: "",
    assertionResults: [{
      ancestorTitles: [],
      fullName: `coding-run client audit ${index}`,
      status: "passed",
      title: `coding-run client audit ${index}`,
      duration: 1,
      failureMessages: [],
    }],
  }));
  return {
    numTotalTestSuites: testResults.length,
    numPassedTestSuites: testResults.length,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numTotalTests: testResults.length,
    numPassedTests: testResults.length,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    startTime: 1,
    success: true,
    testResults,
  };
}

function createVerificationBrowserReport({
  revision,
  viewport,
  screenshotPath,
  screenshotContent,
}) {
  return {
    schemaVersion: "browser-relay-verification/v1",
    runnerVersion: "browser-relay/v1",
    revision,
    observedAt: "2026-09-01T02:40:00.000Z",
    route: "/fixture.html",
    viewport: {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor,
    },
    page: { loaded: true, finalRoute: "/fixture.html" },
    dom: {
      changed: true,
      beforeSha256: "1".repeat(64),
      afterSha256: "2".repeat(64),
      assertions: { total: 2, failed: 0 },
    },
    console: { errorCount: 0, warningCount: 0 },
    requests: {
      observedCount: 1,
      failedCount: 0,
      blockedExternalCount: 0,
      assertions: { total: 1, failed: 0 },
      outcomes: [{ method: "POST", route: "/probe", status: 200, count: 1 }],
    },
    screenshot: {
      artifact: { path: screenshotPath, sha256: sha256(screenshotContent) },
      bytes: screenshotContent.length,
      width: viewport.width,
      height: viewport.height,
    },
    lifecycle: {
      status: "settled",
      pageClosed: true,
      browserClosed: true,
      pendingRequestCount: 0,
      orphanResourceCount: 0,
    },
  };
}

async function mutateCandidateVerificationBrowserRun(
  aggregateRoot,
  runIndex,
  mutateReport,
) {
  const receiptPath = path.join(
    aggregateRoot,
    "candidate-verification-evidence-receipt.json",
  );
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf-8"));
  const run = receipt.browserRelay.runs[runIndex];
  const reportPath = path.join(aggregateRoot, ...run.report.path.split("/"));
  const evidencePath = path.join(aggregateRoot, ...run.evidence.path.split("/"));
  const screenshotPath = path.join(aggregateRoot, ...run.screenshot.path.split("/"));
  const [reportText, screenshotContent] = await Promise.all([
    fs.readFile(reportPath, "utf-8"),
    fs.readFile(screenshotPath),
  ]);
  const browserReport = JSON.parse(reportText);
  mutateReport(browserReport);
  const mutatedReportText = serializeJson(browserReport);
  const projectedEvidence = projectVerificationBrowserReport({
    artifact: { path: run.report.path, sha256: sha256(mutatedReportText) },
    content: mutatedReportText,
    screenshotContent,
    expectedRevision: browserReport.revision,
  });
  const evidenceText = serializeJson(projectedEvidence);
  await Promise.all([
    fs.writeFile(reportPath, mutatedReportText, "utf-8"),
    fs.writeFile(evidencePath, evidenceText, "utf-8"),
  ]);
  run.report.sha256 = sha256(mutatedReportText);
  run.evidence.sha256 = sha256(evidenceText);
  const receiptText = serializeJson(receipt);
  await fs.writeFile(receiptPath, receiptText, "utf-8");
  const reference = await readEvidenceReference(aggregateRoot);
  reference.owners.candidateVerificationReceipt.artifact.sha256 = sha256(receiptText);
  await writeEvidenceReference(aggregateRoot, reference);
}

async function mutateCandidateVerificationJsonArtifact(
  aggregateRoot,
  selectReference,
  mutate,
) {
  const receiptPath = path.join(
    aggregateRoot,
    "candidate-verification-evidence-receipt.json",
  );
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf-8"));
  const artifactReference = selectReference(receipt);
  const artifactPath = path.join(aggregateRoot, ...artifactReference.path.split("/"));
  const artifact = JSON.parse(await fs.readFile(artifactPath, "utf-8"));
  mutate(artifact, receipt);
  const artifactText = serializeJson(artifact);
  await fs.writeFile(artifactPath, artifactText, "utf-8");
  artifactReference.sha256 = sha256(artifactText);
  const receiptText = serializeJson(receipt);
  await fs.writeFile(receiptPath, receiptText, "utf-8");
  const reference = await readEvidenceReference(aggregateRoot);
  reference.owners.candidateVerificationReceipt.artifact.sha256 = sha256(receiptText);
  await writeEvidenceReference(aggregateRoot, reference);
}

async function mutateCandidateVerificationStructuredTestReport(
  aggregateRoot,
  mutate,
) {
  const receiptPath = path.join(
    aggregateRoot,
    "candidate-verification-evidence-receipt.json",
  );
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf-8"));
  const reportReference = receipt.structuredTestAudit.nativeTestReport;
  const reportPath = path.join(aggregateRoot, ...reportReference.path.split("/"));
  const nativeReport = JSON.parse(await fs.readFile(reportPath, "utf-8"));
  mutate(nativeReport);
  const reportText = serializeJson(nativeReport);
  await fs.writeFile(reportPath, reportText, "utf-8");
  reportReference.sha256 = sha256(reportText);

  const dagReference = receipt.structuredTestAudit.verificationDag;
  const dagPath = path.join(aggregateRoot, ...dagReference.path.split("/"));
  const dag = JSON.parse(await fs.readFile(dagPath, "utf-8"));
  dag.nodes[0].attempts[0].testReport.artifact.sha256 = reportReference.sha256;
  const dagText = serializeJson(dag);
  await fs.writeFile(dagPath, dagText, "utf-8");
  dagReference.sha256 = sha256(dagText);

  const receiptText = serializeJson(receipt);
  await fs.writeFile(receiptPath, receiptText, "utf-8");
  const reference = await readEvidenceReference(aggregateRoot);
  reference.owners.candidateVerificationReceipt.artifact.sha256 = sha256(receiptText);
  await writeEvidenceReference(aggregateRoot, reference);
}

async function failCandidateVerificationStructuredTestAudit(aggregateRoot) {
  const receiptPath = path.join(
    aggregateRoot,
    "candidate-verification-evidence-receipt.json",
  );
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf-8"));
  const reference = await readEvidenceReference(aggregateRoot);
  const reportReference = receipt.structuredTestAudit.nativeTestReport;
  const reportPath = path.join(aggregateRoot, ...reportReference.path.split("/"));
  const nativeReport = JSON.parse(await fs.readFile(reportPath, "utf-8"));
  nativeReport.numPassedTestSuites = VERIFICATION_AUDIT_TEST_FILES.length - 1;
  nativeReport.numFailedTestSuites = 1;
  nativeReport.numPassedTests = VERIFICATION_AUDIT_TEST_FILES.length - 1;
  nativeReport.numFailedTests = 1;
  nativeReport.success = false;
  nativeReport.testResults[0].status = "failed";
  nativeReport.testResults[0].assertionResults[0].status = "failed";
  const reportText = serializeJson(nativeReport);
  await fs.writeFile(reportPath, reportText, "utf-8");
  reportReference.sha256 = sha256(reportText);

  const dag = replayCommandJobSnapshots(createVerificationDagPlan({
    runId: "candidate-verification-structured-test-audit",
    taskId: "p2c-verification-structured-test-audit",
    generatedAt: "2026-09-01T02:20:00.000Z",
    commit: reference.aggregate.harness.commit,
    workspaceHash: reference.aggregate.harness.worktreeContentSha256,
    verificationCommands: [{
      id: "verification.structured-test-audit",
      kind: "acceptance",
      scope: "full",
      command: VERIFICATION_AUDIT_COMMAND,
    }],
  }), [{
    id: "verification.structured-test-audit",
    snapshot: {
      jobId: "22345678-1234-4234-8234-123456789abc",
      status: "failed",
      terminationReason: null,
      exitCode: 1,
      signal: null,
      timeoutMs: 900_000,
      deadlineAt: 1_788_229_800_000,
      endedAt: 1_788_229_000_000,
      recovery: { lifecycle: "settled" },
    },
    testReport: {
      framework: "vitest",
      format: "vitest-json/v3.2.7",
      runnerVersion: "3.2.7",
      artifact: {
        path: reportReference.path,
        sha256: reportReference.sha256,
      },
      content: reportText,
    },
  }]);
  const dagText = serializeJson(dag);
  const dagReference = receipt.structuredTestAudit.verificationDag;
  await fs.writeFile(
    path.join(aggregateRoot, ...dagReference.path.split("/")),
    dagText,
    "utf-8",
  );
  dagReference.sha256 = sha256(dagText);
  const receiptText = serializeJson(receipt);
  await fs.writeFile(receiptPath, receiptText, "utf-8");
  reference.owners.candidateVerificationReceipt.artifact.sha256 = sha256(receiptText);
  await writeEvidenceReference(aggregateRoot, reference);
}

async function setCandidateVerificationFailureReplayOutcome(
  aggregateRoot,
  classification,
) {
  const receiptPath = path.join(
    aggregateRoot,
    "candidate-verification-evidence-receipt.json",
  );
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf-8"));
  const reference = await readEvidenceReference(aggregateRoot);
  const replays = classification === "flaky"
    ? [{ status: "passed", replayBinding: VERIFICATION_REPLAY_BINDING }]
    : [
        {
          status: "failed",
          kind: "test",
          replayBinding: VERIFICATION_REPLAY_BINDING,
          failureFingerprint: "7".repeat(64),
        },
        {
          status: "failed",
          kind: "test",
          replayBinding: VERIFICATION_REPLAY_BINDING,
          failureFingerprint: "8".repeat(64),
        },
      ];
  const dag = finalizeVerificationDag(createVerificationDagPlan({
    runId: "candidate-verification-failure-replay",
    taskId: "p2c-verification-failure-replay",
    generatedAt: "2026-09-01T02:30:00.000Z",
    commit: reference.aggregate.harness.commit,
    workspaceHash: reference.aggregate.harness.worktreeContentSha256,
    verificationCommands: [{
      id: "verification.failure-replay",
      kind: "acceptance",
      scope: "full",
      command: VERIFICATION_FAILURE_REPLAY_COMMAND,
    }],
  }), [{
    id: "verification.failure-replay",
    status: "failed",
    kind: "test",
    message: VERIFICATION_REPLAY_FAILURE_MESSAGE,
    replayBinding: VERIFICATION_REPLAY_BINDING,
    failureFingerprint: VERIFICATION_REPLAY_FAILURE_FINGERPRINT,
    replays,
  }]);
  const dagText = serializeJson(dag);
  const dagReference = receipt.failureReplay.verificationDag;
  await fs.writeFile(
    path.join(aggregateRoot, ...dagReference.path.split("/")),
    dagText,
    "utf-8",
  );
  dagReference.sha256 = sha256(dagText);
  const receiptText = serializeJson(receipt);
  await fs.writeFile(receiptPath, receiptText, "utf-8");
  reference.owners.candidateVerificationReceipt.artifact.sha256 = sha256(receiptText);
  await writeEvidenceReference(aggregateRoot, reference);
}

async function mutateCandidateSupervisorJsonArtifact(
  aggregateRoot,
  selectReference,
  mutate,
) {
  const receiptPath = path.join(aggregateRoot, "candidate-supervisor-evidence-receipt.json");
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf-8"));
  const artifactReference = selectReference(receipt);
  const artifactPath = path.join(aggregateRoot, ...artifactReference.path.split("/"));
  const artifact = JSON.parse(await fs.readFile(artifactPath, "utf-8"));
  mutate(artifact);
  const artifactText = serializeJson(artifact);
  await fs.writeFile(artifactPath, artifactText, "utf-8");
  artifactReference.sha256 = sha256(artifactText);
  const receiptText = serializeJson(receipt);
  await fs.writeFile(receiptPath, receiptText, "utf-8");
  const reference = await readEvidenceReference(aggregateRoot);
  reference.owners.candidateSupervisorReceipt.artifact.sha256 = sha256(receiptText);
  await writeEvidenceReference(aggregateRoot, reference);
}

async function mutateCandidateSupervisorReceipt(aggregateRoot, mutate) {
  const receiptPath = path.join(aggregateRoot, "candidate-supervisor-evidence-receipt.json");
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf-8"));
  mutate(receipt);
  const receiptText = serializeJson(receipt);
  await fs.writeFile(receiptPath, receiptText, "utf-8");
  const reference = await readEvidenceReference(aggregateRoot);
  reference.owners.candidateSupervisorReceipt.artifact.sha256 = sha256(receiptText);
  await writeEvidenceReference(aggregateRoot, reference);
}

async function mutateCandidateSupervisorFaultAuditReport(aggregateRoot, mutate) {
  const receiptPath = path.join(aggregateRoot, "candidate-supervisor-evidence-receipt.json");
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf-8"));
  const reportReference = receipt.faultAudit.nativeTestReport;
  const reportPath = path.join(aggregateRoot, ...reportReference.path.split("/"));
  const report = JSON.parse(await fs.readFile(reportPath, "utf-8"));
  mutate(report);
  const reportText = serializeJson(report);
  await fs.writeFile(reportPath, reportText, "utf-8");
  reportReference.sha256 = sha256(reportText);

  const dagReference = receipt.faultAudit.verificationDag;
  const dagPath = path.join(aggregateRoot, ...dagReference.path.split("/"));
  const dag = JSON.parse(await fs.readFile(dagPath, "utf-8"));
  dag.nodes[0].attempts[0].testReport.artifact.sha256 = reportReference.sha256;
  const dagText = serializeJson(dag);
  await fs.writeFile(dagPath, dagText, "utf-8");
  dagReference.sha256 = sha256(dagText);

  const receiptText = serializeJson(receipt);
  await fs.writeFile(receiptPath, receiptText, "utf-8");
  const reference = await readEvidenceReference(aggregateRoot);
  reference.owners.candidateSupervisorReceipt.artifact.sha256 = sha256(receiptText);
  await writeEvidenceReference(aggregateRoot, reference);
}

async function failCandidateSupervisorFaultAudit(
  aggregateRoot,
  failedTestFile = SUPERVISOR_FAULT_AUDIT_TEST_FILES[0],
) {
  const receiptPath = path.join(aggregateRoot, "candidate-supervisor-evidence-receipt.json");
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf-8"));
  const reportReference = receipt.faultAudit.nativeTestReport;
  const reportPath = path.join(aggregateRoot, ...reportReference.path.split("/"));
  const report = JSON.parse(await fs.readFile(reportPath, "utf-8"));
  const failedResult = report.testResults.find((result) => {
    const normalized = result.name.replaceAll("\\", "/");
    return normalized === failedTestFile || normalized.endsWith(`/${failedTestFile}`);
  });
  if (failedResult === undefined) {
    throw new Error(`Unknown Supervisor fault-audit test file: ${failedTestFile}`);
  }
  report.numPassedTestSuites = 17;
  report.numFailedTestSuites = 1;
  report.numPassedTests = 137;
  report.numFailedTests = 1;
  report.success = false;
  failedResult.status = "failed";
  failedResult.assertionResults[0].status = "failed";
  const reportText = serializeJson(report);
  await fs.writeFile(reportPath, reportText, "utf-8");
  reportReference.sha256 = sha256(reportText);

  const reference = await readEvidenceReference(aggregateRoot);
  const dag = replayCommandJobSnapshots(createVerificationDagPlan({
    runId: "candidate-supervisor-fault-audit",
    taskId: "p2c-supervisor-fault-audit",
    generatedAt: "2026-09-01T01:30:00.000Z",
    commit: reference.aggregate.harness.commit,
    workspaceHash: reference.aggregate.harness.worktreeContentSha256,
    verificationCommands: [{
      id: "supervisor.fault-audit",
      kind: "acceptance",
      scope: "full",
      command: SUPERVISOR_FAULT_AUDIT_COMMAND,
    }],
  }), [{
    id: "supervisor.fault-audit",
    snapshot: {
      jobId: "12345678-1234-4234-8234-123456789abc",
      status: "failed",
      terminationReason: null,
      exitCode: 1,
      signal: null,
      timeoutMs: 900_000,
      deadlineAt: 1_788_228_900_000,
      endedAt: 1_788_228_100_000,
      recovery: { lifecycle: "settled" },
    },
    testReport: {
      framework: "vitest",
      format: "vitest-json/v3.2.7",
      runnerVersion: "3.2.7",
      artifact: { path: reportReference.path, sha256: reportReference.sha256 },
      content: reportText,
    },
  }]);
  const dagReference = receipt.faultAudit.verificationDag;
  const dagPath = path.join(aggregateRoot, ...dagReference.path.split("/"));
  const dagText = serializeJson(dag);
  await fs.writeFile(dagPath, dagText, "utf-8");
  dagReference.sha256 = sha256(dagText);

  const receiptText = serializeJson(receipt);
  await fs.writeFile(receiptPath, receiptText, "utf-8");
  reference.owners.candidateSupervisorReceipt.artifact.sha256 = sha256(receiptText);
  await writeEvidenceReference(aggregateRoot, reference);
}

function createSupervisorSoakReport(platform, sourceIdentity) {
  const cycles = 30;
  const writeLaneAttempts = cycles * 4;
  const readLaneAttempts = cycles * 8;
  const laneAttempts = writeLaneAttempts + readLaneAttempts;
  return {
    schemaVersion: "p2a-subtask-supervisor-soak-report/v1",
    generatedAt: "2026-09-01T01:00:00.000Z",
    platform,
    sourceIdentity,
    workload: {
      requestedDurationMs: 3_600_000,
      observedDurationMs: 3_600_500,
      cycleIntervalMs: 120_000,
      cycles,
      writeLanesPerCycle: 4,
      readLanesPerCycle: 8,
      laneAttempts,
      laneSucceeded: laneAttempts,
      laneFailed: 0,
      successRate: 1,
      firstFailureCode: null,
      writeLaneAttempts,
      readLaneAttempts,
    },
    recovery: {
      interruptionAttempted: writeLaneAttempts,
      interruptionRecovered: writeLaneAttempts,
      disposalCompleted: writeLaneAttempts,
      disposalUncertain: 0,
      duplicateSideEffects: 0,
    },
    resources: {
      preExisting: { worktreeCount: 1, managedBranchCount: 0, relevantProcessCount: 0 },
      differential: {
        addedWorktreeCount: 0,
        addedManagedBranchCount: 0,
        addedRelevantProcessCount: 0,
      },
      runOwned: {
        activeSupervisorChildren: 0,
        worktreeCount: 0,
        managedBranchCount: 0,
        processCount: 0,
        receiptCount: 0,
        lockCount: 0,
        temporaryFileCount: 0,
        stateRootExists: false,
        temporaryRootExists: false,
      },
    },
    execution: {
      gatewayCalls: 0,
      modelCalls: 0,
      paidProviderCalls: 0,
      externalNetworkCalls: 0,
      productionWorkspaceMutations: 0,
      temporaryRepositoryMutations: laneAttempts,
      credentialsRead: false,
    },
    gate: { passed: true, failures: [] },
  };
}

function createSupervisorFaultAuditVitestReport() {
  const testResults = SUPERVISOR_FAULT_AUDIT_TEST_FILES.map((relativePath, index) => ({
    name: `E:/project/star-sanctuary/${relativePath}`,
    status: "passed",
    message: "",
    assertionResults: Array.from({ length: index < 12 ? 8 : 7 }, (_, assertionIndex) => ({
      ancestorTitles: [],
      fullName: `fault audit ${index}-${assertionIndex}`,
      status: "passed",
      title: `fault audit ${index}-${assertionIndex}`,
      duration: 1,
      failureMessages: [],
    })),
  }));
  return {
    numTotalTestSuites: 18,
    numPassedTestSuites: 18,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numTotalTests: 138,
    numPassedTests: 138,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    startTime: 1,
    success: true,
    testResults,
  };
}

function expectEditingTestingCompletionFailure(result, failedContractId) {
  const claims = {
    verification_impact_truth_set: {
      owner: "candidateVerificationReceipt",
      completion: "current_selector_truth_set_gate_passed",
    },
    verification_structured_test_reports: {
      owner: "candidateVerificationReceipt",
      completion: "current_harness_structured_test_audit_passed",
    },
    verification_failure_replay: {
      owner: "candidateVerificationReceipt",
      completion: "current_harness_reproducible_failure_replay_preserved",
    },
    browser_relay_behavior_evidence: {
      owner: "candidateVerificationReceipt",
      completion: "current_harness_three_viewport_browser_relay_passed_zero_residue",
    },
  };
  const contractIds = Object.keys(claims);
  expect(result.status).toBe("failed");
  expect(result.dimensions.find(({ id }) => id === "editing_testing")).toEqual({
    id: "editing_testing",
    status: "failed",
    resolvedEvidenceContracts: contractIds
      .filter((contractId) => contractId !== failedContractId)
      .map((contractId) => ({
        id: contractId,
        ...claims[contractId],
        status: "complete",
      })),
    failedEvidenceContracts: [{
      id: failedContractId,
      ...claims[failedContractId],
      status: "failed",
    }],
    missingEvidenceContracts: [],
  });
  expect(result.dimensions.every((dimension) => !("score" in dimension))).toBe(true);
}

function expectHeadlessEcosystemCompletionFailure(result, failedContractId) {
  const claims = {
    external_consumer_pair_lifecycle: {
      owner: "candidateCodingRunClientReceipt",
      completion: "current_harness_packed_esm_and_typescript_consumers_passed",
    },
    protocol_version_conformance: {
      owner: "candidateCodingRunClientReceipt",
      completion: "current_harness_protocol_version_conformance_passed",
    },
    error_taxonomy_cancellation_conformance: {
      owner: "candidateCodingRunClientReceipt",
      completion: "current_harness_error_taxonomy_and_cancellation_conformance_passed",
    },
  };
  const contractIds = Object.keys(claims);
  expect(result.status).toBe("failed");
  expect(result.dimensions.find(({ id }) => id === "headless_ecosystem")).toEqual({
    id: "headless_ecosystem",
    status: "failed",
    resolvedEvidenceContracts: contractIds
      .filter((contractId) => contractId !== failedContractId)
      .map((contractId) => ({
        id: contractId,
        ...claims[contractId],
        status: "complete",
      })),
    failedEvidenceContracts: [{
      id: failedContractId,
      ...claims[failedContractId],
      status: "failed",
    }],
    missingEvidenceContracts: ["real_ci_consumer_binding"],
  });
  expect(result.dimensions.every((dimension) => !("score" in dimension))).toBe(true);
}

function expectSessionLongRunningCompletionFailure(result, failedContractId) {
  const claims = {
    supervisor_dual_platform_60_minute_soak: {
      owner: "candidateSupervisorReceipt",
      completion: "current_harness_dual_platform_60_minute_soak_passed",
    },
    bounded_budget_cancel_restart_reattach: {
      owner: "candidateSupervisorReceipt",
      completion: "current_harness_bounded_budget_cancel_restart_reattach_audit_passed",
    },
    managed_worktree_fan_in_review_remediation: {
      owner: "candidateSupervisorReceipt",
      completion: "current_harness_managed_worktree_fan_in_review_remediation_audit_passed",
    },
    parallel_resource_convergence: {
      owner: "candidateSupervisorReceipt",
      completion: "current_harness_parallel_resources_converged_zero_residue",
    },
  };
  const contractIds = Object.keys(claims);
  expect(result.status).toBe("failed");
  expect(result.dimensions.find(({ id }) => id === "session_long_running")).toEqual({
    id: "session_long_running",
    status: "failed",
    resolvedEvidenceContracts: contractIds
      .filter((contractId) => contractId !== failedContractId)
      .map((contractId) => ({
        id: contractId,
        ...claims[contractId],
        status: "complete",
      })),
    failedEvidenceContracts: [{
      id: failedContractId,
      ...claims[failedContractId],
      status: "failed",
    }],
    missingEvidenceContracts: [],
  });
  expect(result.dimensions.every((dimension) => !("score" in dimension))).toBe(true);
}

function expectSafetyCompletionFailure(result, failedContractId, resolvedContractIds) {
  expect(result.status).toBe("failed");
  expect(result.dimensions.find(({ id }) => id === "safety_recovery")).toEqual({
    id: "safety_recovery",
    status: "failed",
    resolvedEvidenceContracts: resolvedContractIds.map((id) => {
      const claim = {
        system_evidence_critical_rate: {
          owner: "systemEvidence",
          completion: "all_layer_c_runs_valid",
        },
        candidate_sensitive_scan: {
          owner: "candidateGlobalReceipt",
          completion: "completed_zero_findings",
        },
        candidate_resource_sweeps: {
          owner: "candidateGlobalReceipt",
          completion: "required_platforms_completed_zero_orphans",
        },
        fault_matrix_audit_reconciliation: {
          owner: "candidateSupervisorReceipt",
          completion: "current_harness_dual_platform_soak_and_fault_audit_passed",
        },
      }[id];
      return { id, ...claim, status: "complete" };
    }),
    failedEvidenceContracts: [{
      id: failedContractId,
      ...{
        system_evidence_critical_rate: {
          owner: "systemEvidence",
          completion: "all_layer_c_runs_valid",
        },
        candidate_sensitive_scan: {
          owner: "candidateGlobalReceipt",
          completion: "completed_zero_findings",
        },
        candidate_resource_sweeps: {
          owner: "candidateGlobalReceipt",
          completion: "required_platforms_completed_zero_orphans",
        },
        fault_matrix_audit_reconciliation: {
          owner: "candidateSupervisorReceipt",
          completion: "current_harness_dual_platform_soak_and_fault_audit_passed",
        },
      }[failedContractId],
      status: "failed",
    }],
    missingEvidenceContracts: failedContractId === "fault_matrix_audit_reconciliation"
      ? []
      : ["fault_matrix_audit_reconciliation"],
  });
  expect(result.dimensions.every((dimension) => !("score" in dimension))).toBe(true);
}
