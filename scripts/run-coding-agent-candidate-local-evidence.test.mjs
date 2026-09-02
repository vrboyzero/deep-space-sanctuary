import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadCodingAgentCandidateDimensionEvidence } from "./coding-agent-candidate-score.mjs";
import { withSafetyEvidenceFixture } from "./coding-agent-candidate-dimension-evidence-fixtures.mjs";
import {
  assertCandidateWslWorkspaceIdentity,
  bootstrapCodingAgentCandidateEvidence,
  createCandidateWslNodeInvocation,
  createCandidateWslRepositoryIdentityInvocation,
  collectCandidateCliTuiEvidence,
  collectCandidateCodingRunClientEvidence,
  collectCandidateGitDeliveryEvidence,
  collectCandidateSupervisorEvidence,
  collectCandidateVerificationEvidence,
} from "./coding-agent-candidate-local-evidence.mjs";
import { projectVerificationBrowserReport } from "./verification-browser-report-adapter.mjs";

const CODING_RUN_CLIENT_TEST_FILES = [
  "packages/belldandy-core/src/coding-run/stdio.test.ts",
  "packages/belldandy-core/src/coding-run/client.test.ts",
  "apps/vscode-extension/src/stdio-client.test.js",
  "scripts/coding-run-client-conformance.test.mjs",
  "scripts/coding-run-client-failure-conformance.test.mjs",
  "scripts/run-coding-run-client-external-consumer.test.mjs",
  "scripts/run-coding-run-client-typescript-consumer.test.mjs",
];
const SUPERVISOR_SOURCE_FILES = [
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
];
const GIT_DELIVERY_TEST_FILES = [
  "packages/belldandy-core/src/managed-worktree.test.ts",
  "packages/belldandy-core/src/user-worktree-runtime.test.ts",
  "packages/belldandy-core/src/workspace-change-review.test.ts",
  "packages/belldandy-core/src/subtask-supervisor-fan-in-runtime.test.ts",
  "packages/belldandy-core/src/subtask-supervisor-fan-in-resolution-runtime.test.ts",
  "packages/belldandy-core/src/server-methods/remote-delivery.test.ts",
  "packages/belldandy-core/src/remote-delivery-runtime.test.ts",
  "packages/belldandy-core/src/remote-delivery-process-recovery.test.ts",
  "packages/belldandy-core/src/user-worktree-process-recovery.test.ts",
];
const GIT_DELIVERY_PATHS = [
  "candidate-evidence/git-delivery/audit-windows-native-vitest-report.json",
  "candidate-evidence/git-delivery/audit-windows-native-verification-dag.json",
  "candidate-evidence/git-delivery/audit-wsl2-linux-vitest-report.json",
  "candidate-evidence/git-delivery/audit-wsl2-linux-verification-dag.json",
  "candidate-evidence/git-delivery/multi-repository-worktree-soak.json",
  "candidate-evidence/git-delivery/review-remediation-loop.json",
  "candidate-evidence/git-delivery/remote-delivery-authority-separation.json",
  "candidate-evidence/git-delivery/delivery-recovery-audit-matrix.json",
  "candidate-git-delivery-evidence-receipt.json",
];

describe("coding agent candidate local evidence", () => {
  it("creates WSL node invocations inside one explicit candidate workspace", () => {
    expect(createCandidateWslNodeInvocation({
      distribution: "Ubuntu-22.04",
      workspaceRootWsl: "/var/tmp/star-sanctuary-linux",
      nodeArgs: ["node_modules/vitest/vitest.mjs", "run"],
    })).toEqual({
      command: "wsl.exe",
      args: [
        "--distribution", "Ubuntu-22.04",
        "--cd", "/var/tmp/star-sanctuary-linux",
        "--exec", "node", "node_modules/vitest/vitest.mjs", "run",
      ],
    });
    const preflight = createCandidateWslRepositoryIdentityInvocation({
      distribution: "Ubuntu-22.04",
      workspaceRootWsl: "/var/tmp/star-sanctuary-linux",
    });
    expect(preflight.args.slice(0, 8)).toEqual([
      "--distribution", "Ubuntu-22.04",
      "--cd", "/var/tmp/star-sanctuary-linux",
      "--exec", "node", "--input-type=module", "--eval",
    ]);
    expect(preflight.args[8]).toContain("resolveBenchmarkRepositoryIdentity(process.cwd())");
    expect(preflight.args.join(" ")).not.toContain("NODE_PATH");
  });

  it("rejects a WSL candidate workspace when any repository identity field drifts", () => {
    const expected = {
      commit: "a".repeat(40),
      workspaceDirty: false,
      lockfileSha256: "b".repeat(64),
      worktreeContentSha256: "c".repeat(64),
    };
    expect(() => assertCandidateWslWorkspaceIdentity(expected, expected)).not.toThrow();
    for (const field of [
      "commit",
      "workspaceDirty",
      "lockfileSha256",
      "worktreeContentSha256",
    ]) {
      const actual = { ...expected, [field]: field === "workspaceDirty" ? true : "drifted" };
      expect(() => assertCandidateWslWorkspaceIdentity(actual, expected))
        .toThrow(/WSL workspace identity does not match aggregate harness/i);
    }
  });

  it("bootstraps the immutable current-candidate reference from aggregate-owned evidence", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report }) => {
      const referencePath = path.join(
        aggregateRoot,
        "candidate-dimension-evidence-reference.json",
      );
      await fs.rm(referencePath);

      const reference = await bootstrapCodingAgentCandidateEvidence(
        {
          aggregateRoot,
          generatedAt: "2026-09-02T09:00:00.000Z",
        },
        {
          resolveRepositoryIdentity: async () => report.harness,
        },
      );

      expect(reference).toMatchObject({
        schemaVersion: "coding-agent-benchmark-candidate-dimension-evidence-reference/v1",
        generatedAt: "2026-09-02T09:00:00.000Z",
        aggregate: {
          harness: report.harness,
        },
        owners: {
          systemEvidence: {
            kind: "retained_run_artifacts",
            artifacts: expect.arrayContaining([
              expect.objectContaining({
                taskId: "system.parallel-write-fan-in",
                platform: "windows-native",
              }),
            ]),
          },
          candidateGlobalReceipt: {
            artifact: { path: "candidate-global-receipt.json" },
          },
        },
      });
      expect(reference.owners.systemEvidence.artifacts).toHaveLength(24);
      expect(reference.claims).toHaveLength(3);

      const resolution = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: {
          report,
          baselineIndex: JSON.parse(await fs.readFile(
            path.join(aggregateRoot, "baseline-index.json"),
            "utf8",
          )),
        },
      });
      const safety = resolution.dimensions.find(({ id }) => id === "safety_recovery");
      expect(safety?.status).toBe("partial");
      expect(safety?.resolvedEvidenceContracts).toHaveLength(3);
      expect(safety?.missingEvidenceContracts).toContain("fault_matrix_audit_reconciliation");

      await expect(bootstrapCodingAgentCandidateEvidence(
        { aggregateRoot },
        { resolveRepositoryIdentity: async () => report.harness },
      )).rejects.toThrow(/already exists/i);
    });
  });

  it("collects the local coding-run client owner from one native seven-file audit", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await fs.rm(path.join(aggregateRoot, "candidate-dimension-evidence-reference.json"));
      const dependencies = {
        resolveRepositoryIdentity: async () => report.harness,
        runVitestAudit: async ({ outputPath, testFiles }) => {
          expect(testFiles).toEqual(CODING_RUN_CLIENT_TEST_FILES);
          await fs.writeFile(outputPath, `${JSON.stringify(passingVitestReport(testFiles))}\n`);
          return {
            jobId: "12345678-1234-4234-8234-123456789abc",
            exitCode: 0,
            signal: null,
            timedOut: false,
            startedAtMs: 1_788_235_200_000,
            endedAtMs: 1_788_235_201_000,
            timeoutMs: 900_000,
          };
        },
      };
      await bootstrapCodingAgentCandidateEvidence(
        { aggregateRoot, generatedAt: "2026-09-02T09:00:00.000Z" },
        dependencies,
      );

      const receipt = await collectCandidateCodingRunClientEvidence(
        { aggregateRoot, generatedAt: "2026-09-02T09:10:00.000Z" },
        dependencies,
      );

      expect(receipt).toMatchObject({
        schemaVersion:
          "coding-agent-benchmark-candidate-coding-run-client-evidence-receipt/v1",
        aggregate: { harness: report.harness },
        audit: {
          nativeTestReport: {
            path: "candidate-evidence/coding-run-client/audit-vitest-report.json",
          },
          testFiles: CODING_RUN_CLIENT_TEST_FILES,
        },
      });
      const reference = JSON.parse(await fs.readFile(
        path.join(aggregateRoot, "candidate-dimension-evidence-reference.json"),
        "utf8",
      ));
      expect(reference.owners.candidateCodingRunClientReceipt.artifact.path)
        .toBe("candidate-coding-run-client-evidence-receipt.json");

      const resolution = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });
      const headless = resolution.dimensions.find(({ id }) => id === "headless_ecosystem");
      expect(headless?.status).toBe("partial");
      expect(headless?.resolvedEvidenceContracts.map(({ id }) => id)).toEqual([
        "external_consumer_pair_lifecycle",
        "protocol_version_conformance",
        "error_taxonomy_cancellation_conformance",
      ]);
      expect(headless?.missingEvidenceContracts).toEqual(["real_ci_consumer_binding"]);
    });
  });

  it("collects Verification evidence from native tests, deterministic replay, and three browser runs", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await fs.rm(path.join(aggregateRoot, "candidate-dimension-evidence-reference.json"));
      const dependencies = {
        resolveRepositoryIdentity: async () => report.harness,
        runVitestAudit: async ({ outputPath, testFiles }) => {
          expect(testFiles).toEqual([
            "scripts/run-verification-impact-truth-set.test.mjs",
            "scripts/verification-test-report-adapter.test.mjs",
            "scripts/run-verification-dag.test.mjs",
            "scripts/verification-browser-report-adapter.test.mjs",
          ]);
          await fs.writeFile(outputPath, `${JSON.stringify(passingVitestReport(testFiles))}\n`);
          return passingAuditResult("22345678-1234-4234-8234-123456789abc");
        },
        collectBrowserRun: writePassingBrowserRun,
      };
      await bootstrapCodingAgentCandidateEvidence(
        { aggregateRoot, generatedAt: "2026-09-02T09:00:00.000Z" },
        dependencies,
      );

      const receipt = await collectCandidateVerificationEvidence(
        { aggregateRoot, generatedAt: "2026-09-02T09:20:00.000Z" },
        dependencies,
      );

      expect(receipt.browserRelay.runs.map(({ runId }) => runId))
        .toEqual(["mobile", "tablet", "desktop"]);
      expect(receipt.failureReplay).toMatchObject({
        expectedClassification: "reproducible_failure",
        verificationDag: {
          path: "candidate-evidence/verification/failure-replay-verification-dag.json",
        },
      });
      const resolution = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });
      const editing = resolution.dimensions.find(({ id }) => id === "editing_testing");
      expect(editing?.status).toBe("complete");
      expect(editing?.resolvedEvidenceContracts).toHaveLength(4);
    });
  });

  it("collects the dual-platform Supervisor soak pair and fixed fault audit", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await fs.rm(path.join(aggregateRoot, "candidate-dimension-evidence-reference.json"));
      const wslWorkspaceRoot = "/var/tmp/star-sanctuary-linux";
      const dependencies = {
        resolveRepositoryIdentity: async () => report.harness,
        runVitestAudit: async ({ outputPath, testFiles }) => {
          expect(testFiles).toHaveLength(18);
          await fs.writeFile(outputPath, `${JSON.stringify(passingVitestReport(testFiles))}\n`);
          return passingAuditResult("32345678-1234-4234-8234-123456789abc");
        },
        collectSupervisorSoakPair: async (input) => {
          const {
            reports,
            sourceIdentity,
            durationMinutes,
            candidateHarness,
          } = input;
          expect(durationMinutes).toBe(60);
          expect(input.wslWorkspaceRoot).toBe(wslWorkspaceRoot);
          expect(candidateHarness).toEqual(report.harness);
          expect(sourceIdentity.files.map(({ path: filePath }) => filePath))
            .toEqual(SUPERVISOR_SOURCE_FILES);
          for (const item of reports) {
            await fs.mkdir(path.dirname(item.outputPath), { recursive: true });
            await fs.writeFile(
              item.outputPath,
              `${JSON.stringify(passingSupervisorSoak(item.platform, sourceIdentity), null, 2)}\n`,
              { flag: "wx" },
            );
          }
        },
      };
      await bootstrapCodingAgentCandidateEvidence(
        { aggregateRoot, generatedAt: "2026-09-02T09:00:00.000Z" },
        dependencies,
      );

      const receipt = await collectCandidateSupervisorEvidence(
        {
          aggregateRoot,
          generatedAt: "2026-09-02T09:30:00.000Z",
          wslWorkspaceRoot,
        },
        dependencies,
      );

      expect(receipt.soak.reports.map(({ platform }) => platform))
        .toEqual(["windows-native", "wsl2-linux"]);
      const resolution = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });
      expect(resolution.dimensions.find(({ id }) => id === "safety_recovery")?.status)
        .toBe("complete");
      expect(resolution.dimensions.find(({ id }) => id === "session_long_running")?.status)
        .toBe("complete");
    });
  });

  it("collects native TaskProjection, efficiency, and dual-platform TUI evidence", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await fs.rm(path.join(aggregateRoot, "candidate-dimension-evidence-reference.json"));
      const observedPlatforms = [];
      const dependencies = {
        resolveRepositoryIdentity: async () => report.harness,
        collectTuiAccessibilityObservation: async (platform) => {
          observedPlatforms.push(platform);
          return completeTuiAccessibilityObservation(platform);
        },
      };
      await bootstrapCodingAgentCandidateEvidence(
        { aggregateRoot, generatedAt: "2026-09-02T09:00:00.000Z" },
        dependencies,
      );

      const receipt = await collectCandidateCliTuiEvidence(
        { aggregateRoot, generatedAt: "2026-09-02T09:40:00.000Z" },
        dependencies,
      );

      expect(observedPlatforms).toEqual(["windows-native", "wsl2-linux"]);
      expect(receipt.summary).toEqual({
        taskProjectionCrossEntryConformance: true,
        taskProjectionTerminalActionConsistency: true,
        taskEfficiencyTimeline: true,
        tuiAccessibilityCrossPlatform: true,
      });
      const projection = JSON.parse(await fs.readFile(path.join(
        aggregateRoot,
        "candidate-evidence/cli-tui/task-projection-conformance.json",
      ), "utf8"));
      expect(projection.entries.map(({ client, sequence }) => ({
        client,
        statuses: sequence.map(({ status }) => status),
      }))).toEqual(["cli", "tui", "webchat", "vscode"].map((client) => ({
        client,
        statuses: ["running", "needs_input", "failed"],
      })));
      const efficiency = JSON.parse(await fs.readFile(path.join(
        aggregateRoot,
        "candidate-evidence/cli-tui/task-efficiency-evidence.json",
      ), "utf8"));
      expect(efficiency.provenance).toEqual({
        evidenceKind: "deterministic_conformance_fixture",
        candidateRunEvidence: false,
        providerCalls: 0,
      });
      expect(efficiency.metrics).toMatchObject({
        schemaVersion: "task-efficiency-metrics/v1",
        status: "complete",
        missingMetrics: [],
        usageCompleteness: { status: "complete", modelCalls: 1 },
      });
      const resolution = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });
      expect(resolution.dimensions.find(({ id }) => id === "cli_tui")?.status)
        .toBe("complete");
    });
  });

  it("collects four Git delivery contracts from one fixed dual-platform native audit", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await fs.rm(path.join(aggregateRoot, "candidate-dimension-evidence-reference.json"));
      const observedPlatforms = [];
      const wslWorkspaceRoot = "/var/tmp/star-sanctuary-linux";
      const dependencies = {
        resolveRepositoryIdentity: async () => report.harness,
        runGitDeliveryAudit: async (input) => {
          observedPlatforms.push(input.platform);
          expect(input.testFiles).toEqual(GIT_DELIVERY_TEST_FILES);
          expect(input.wslWorkspaceRoot).toBe(wslWorkspaceRoot);
          expect(input.candidateHarness).toEqual(report.harness);
          return writeGitDeliveryAudit(input);
        },
      };
      await bootstrapCodingAgentCandidateEvidence(
        { aggregateRoot, generatedAt: "2026-09-02T09:00:00.000Z" },
        dependencies,
      );

      const receipt = await collectCandidateGitDeliveryEvidence(
        { aggregateRoot, generatedAt: "2026-09-02T09:50:00.000Z", wslWorkspaceRoot },
        dependencies,
      );

      expect(observedPlatforms).toEqual(["windows-native", "wsl2-linux"]);
      expect(receipt.summary).toEqual({
        multiRepositoryWorktreeSoak: true,
        reviewRemediationLoop: true,
        remoteDeliveryAuthoritySeparation: true,
        deliveryRecoveryAuditMatrix: true,
      });
      const recovery = JSON.parse(await fs.readFile(path.join(
        aggregateRoot,
        "candidate-evidence/git-delivery/delivery-recovery-audit-matrix.json",
      ), "utf8"));
      expect(recovery.audit.runs.map(({ platform }) => platform))
        .toEqual(["windows-native", "wsl2-linux"]);
      expect(recovery.systemEvidence).toHaveLength(4);

      const resolution = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });
      expect(resolution.dimensions.find(({ id }) => id === "git_delivery"))
        .toMatchObject({ status: "complete", missingEvidenceContracts: [] });
    });
  });

  it("projects a native Git recovery audit failure without failing unrelated contracts", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report, baselineIndex }) => {
      await fs.rm(path.join(aggregateRoot, "candidate-dimension-evidence-reference.json"));
      const dependencies = {
        resolveRepositoryIdentity: async () => report.harness,
        runGitDeliveryAudit: (input) => writeGitDeliveryAudit({
          ...input,
          failFile: input.platform === "wsl2-linux"
            ? "packages/belldandy-core/src/remote-delivery-process-recovery.test.ts"
            : undefined,
        }),
      };
      await bootstrapCodingAgentCandidateEvidence(
        { aggregateRoot, generatedAt: "2026-09-02T09:00:00.000Z" },
        dependencies,
      );

      await collectCandidateGitDeliveryEvidence(
        { aggregateRoot, generatedAt: "2026-09-02T09:51:00.000Z" },
        dependencies,
      );
      const resolution = await loadCodingAgentCandidateDimensionEvidence({
        aggregateRoot,
        verifiedAggregate: { report, baselineIndex },
      });
      expect(resolution.dimensions.find(({ id }) => id === "git_delivery"))
        .toMatchObject({
          status: "failed",
          failedEvidenceContracts: [
            { id: "delivery_recovery_audit_matrix", status: "failed" },
          ],
          resolvedEvidenceContracts: [
            { id: "multi_repository_worktree_soak", status: "complete" },
            { id: "review_remediation_loop", status: "complete" },
            { id: "remote_delivery_authority_separation", status: "complete" },
          ],
        });
    });
  });

  it("rejects Git audit selection drift and removes every planned artifact", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report }) => {
      await fs.rm(path.join(aggregateRoot, "candidate-dimension-evidence-reference.json"));
      const dependencies = {
        resolveRepositoryIdentity: async () => report.harness,
        runGitDeliveryAudit: async (input) => {
          const reportFiles = input.platform === "wsl2-linux"
            ? [...input.testFiles.slice(0, -1), "packages/belldandy-core/src/unrelated.test.ts"]
            : input.testFiles;
          await fs.writeFile(input.outputPath, `${JSON.stringify(passingVitestReport(reportFiles))}\n`);
          return passingAuditResult(input.platform === "windows-native"
            ? "42345678-1234-4234-8234-123456789abc"
            : "52345678-1234-4234-8234-123456789abc");
        },
      };
      await bootstrapCodingAgentCandidateEvidence(
        { aggregateRoot, generatedAt: "2026-09-02T09:00:00.000Z" },
        dependencies,
      );

      await expect(collectCandidateGitDeliveryEvidence(
        { aggregateRoot, generatedAt: "2026-09-02T09:52:00.000Z" },
        dependencies,
      )).rejects.toThrow(/selection drifted/i);
      await expectPathsMissing(aggregateRoot, GIT_DELIVERY_PATHS);
      const reference = JSON.parse(await fs.readFile(
        path.join(aggregateRoot, "candidate-dimension-evidence-reference.json"),
        "utf8",
      ));
      expect(reference.owners.candidateGitDeliveryReceipt).toBeUndefined();
    });
  });

  it("preserves a concurrent reference update and rolls back Git evidence", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report }) => {
      await fs.rm(path.join(aggregateRoot, "candidate-dimension-evidence-reference.json"));
      let identityReads = 0;
      let concurrentText;
      const dependencies = {
        resolveRepositoryIdentity: async () => {
          identityReads += 1;
          if (identityReads === 3) {
            const referencePath = path.join(
              aggregateRoot,
              "candidate-dimension-evidence-reference.json",
            );
            const reference = JSON.parse(await fs.readFile(referencePath, "utf8"));
            reference.generatedAt = "2026-09-02T09:49:59.000Z";
            concurrentText = `${JSON.stringify(reference, null, 2)}\n`;
            await fs.writeFile(referencePath, concurrentText);
          }
          return report.harness;
        },
        runGitDeliveryAudit: writeGitDeliveryAudit,
      };
      await bootstrapCodingAgentCandidateEvidence(
        { aggregateRoot, generatedAt: "2026-09-02T09:00:00.000Z" },
        dependencies,
      );

      await expect(collectCandidateGitDeliveryEvidence(
        { aggregateRoot, generatedAt: "2026-09-02T09:53:00.000Z" },
        dependencies,
      )).rejects.toThrow(/reference changed/i);
      expect(await fs.readFile(
        path.join(aggregateRoot, "candidate-dimension-evidence-reference.json"),
        "utf8",
      )).toBe(concurrentText);
      await expectPathsMissing(aggregateRoot, GIT_DELIVERY_PATHS);
    });
  });

  it("does not overwrite a pre-existing Git delivery artifact", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report }) => {
      await fs.rm(path.join(aggregateRoot, "candidate-dimension-evidence-reference.json"));
      const dependencies = { resolveRepositoryIdentity: async () => report.harness };
      await bootstrapCodingAgentCandidateEvidence(
        { aggregateRoot, generatedAt: "2026-09-02T09:00:00.000Z" },
        dependencies,
      );
      const target = path.join(
        aggregateRoot,
        "candidate-evidence/git-delivery/multi-repository-worktree-soak.json",
      );
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, "user-owned\n");

      await expect(collectCandidateGitDeliveryEvidence(
        { aggregateRoot, generatedAt: "2026-09-02T09:54:00.000Z" },
        dependencies,
      )).rejects.toThrow(/already exists/i);
      expect(await fs.readFile(target, "utf8")).toBe("user-owned\n");
    });
  });

  it("removes a native report when audit metadata is invalid", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot, report }) => {
      await fs.rm(path.join(aggregateRoot, "candidate-dimension-evidence-reference.json"));
      const dependencies = {
        resolveRepositoryIdentity: async () => report.harness,
        runVitestAudit: async ({ outputPath, testFiles }) => {
          await fs.writeFile(outputPath, `${JSON.stringify(passingVitestReport(testFiles))}\n`);
          return { ...passingAuditResult("62345678-1234-4234-8234-123456789abc"), jobId: "invalid" };
        },
      };
      await bootstrapCodingAgentCandidateEvidence(
        { aggregateRoot, generatedAt: "2026-09-02T09:00:00.000Z" },
        dependencies,
      );

      await expect(collectCandidateCodingRunClientEvidence(
        { aggregateRoot, generatedAt: "2026-09-02T09:55:00.000Z" },
        dependencies,
      )).rejects.toThrow(/audit result is invalid/i);
      await expectPathsMissing(aggregateRoot, [
        "candidate-evidence/coding-run-client/audit-vitest-report.json",
        "candidate-evidence/coding-run-client/audit-verification-dag.json",
        "candidate-coding-run-client-evidence-receipt.json",
      ]);
    });
  });
});

function passingAuditResult(jobId) {
  return {
    jobId,
    exitCode: 0,
    signal: null,
    timedOut: false,
    startedAtMs: 1_788_235_200_000,
    endedAtMs: 1_788_235_201_000,
    timeoutMs: 900_000,
  };
}

async function writePassingBrowserRun({ outputDir, relativePaths, revision, viewport }) {
  await fs.mkdir(outputDir, { recursive: true });
  const screenshotContent = Buffer.concat([
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
    Buffer.from(viewport.runId),
  ]);
  const report = {
    schemaVersion: "browser-relay-verification/v1",
    runnerVersion: "browser-relay/v1",
    revision,
    observedAt: "2026-09-02T09:20:00.000Z",
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
      artifact: { path: relativePaths.screenshot, sha256: sha256(screenshotContent) },
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
  const reportText = `${JSON.stringify(report, null, 2)}\n`;
  const evidence = projectVerificationBrowserReport({
    artifact: { path: relativePaths.report, sha256: sha256(reportText) },
    content: reportText,
    screenshotContent,
    expectedRevision: revision,
  });
  await Promise.all([
    fs.writeFile(path.join(outputDir, "browser-report.json"), reportText, { flag: "wx" }),
    fs.writeFile(path.join(outputDir, "browser-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" }),
    fs.writeFile(path.join(outputDir, "browser-screenshot.png"), screenshotContent, { flag: "wx" }),
  ]);
}

function passingVitestReport(testFiles) {
  const testResults = testFiles.map((testFile) => ({
    name: `E:/project/star-sanctuary/${testFile}`,
    status: "passed",
    message: "",
    assertionResults: [{
      ancestorTitles: [],
      fullName: `native audit ${testFile}`,
      status: "passed",
      title: `native audit ${testFile}`,
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

async function writeGitDeliveryAudit(input) {
  const report = passingVitestReport(input.testFiles);
  if (input.failFile) {
    const failed = report.testResults.find(({ name }) => name.endsWith(input.failFile));
    failed.status = "failed";
    failed.assertionResults[0].status = "failed";
    failed.assertionResults[0].failureMessages = ["candidate Git delivery fixture failure"];
    report.numPassedTestSuites -= 1;
    report.numFailedTestSuites = 1;
    report.numPassedTests -= 1;
    report.numFailedTests = 1;
    report.success = false;
  }
  await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
  await fs.writeFile(input.outputPath, `${JSON.stringify(report)}\n`);
  return {
    ...passingAuditResult(input.platform === "windows-native"
      ? "42345678-1234-4234-8234-123456789abc"
      : "52345678-1234-4234-8234-123456789abc"),
    exitCode: input.failFile ? 1 : 0,
  };
}

async function expectPathsMissing(root, relativePaths) {
  for (const relativePath of relativePaths) {
    await expect(fs.lstat(path.join(root, ...relativePath.split("/"))))
      .rejects.toThrow();
  }
}

function passingSupervisorSoak(platform, sourceIdentity) {
  const cycles = 30;
  const writeLaneAttempts = cycles * 4;
  const readLaneAttempts = cycles * 8;
  const laneAttempts = writeLaneAttempts + readLaneAttempts;
  return {
    schemaVersion: "p2a-subtask-supervisor-soak-report/v1",
    generatedAt: "2026-09-02T09:30:00.000Z",
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

function completeTuiAccessibilityObservation(platform) {
  return {
    environment: platform === "windows-native"
      ? {
        platform: "win32",
        arch: "x64",
        release: "fixture",
        nodeVersion: "v22.0.0",
        terminalBackend: "conpty",
        wsl: false,
      }
      : {
        platform: "linux",
        arch: "x64",
        release: "fixture",
        nodeVersion: "v22.0.0",
        terminalBackend: "unix-pty",
        wsl: true,
        distribution: "Ubuntu-22.04",
      },
    sample: {
      capturedBytes: 1024,
      accessibility: {
        keyboardNavigation: true,
        focusVisible: true,
        labelsPresent: true,
      },
      lifecycle: {
        firstFrame: true,
        narrowFallback: true,
        wideLayoutRestored: true,
        mouseTabNavigation: true,
        inputReplayRendered: true,
        ctrlCSent: true,
        inputModesRestoredBeforeScreen: true,
        stateDirRemoved: true,
        exitCode: 0,
        timedOut: false,
        residualProcessCount: 0,
      },
    },
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
