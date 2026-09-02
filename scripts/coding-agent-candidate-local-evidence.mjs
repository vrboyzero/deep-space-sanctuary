import crypto, { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import { parseTaskProjectionCollectionPage as parseCoreTaskProjectionCollectionPage } from "../packages/belldandy-core/src/coding-run/task-projection-consumer.ts";
import {
  projectCodingRunTraceEvents,
  validateCodingRunTraceEvents,
} from "../packages/belldandy-core/src/coding-run/trace.ts";
import { parseTaskProjectionCollectionPage as parseWebChatTaskProjectionCollectionPage } from "../apps/web/public/app/features/task-projection-webchat.js";
import { resolveBenchmarkRepositoryIdentity } from "./coding-agent-benchmark-preflight.mjs";
import {
  loadCodingAgentCandidateCliTuiAggregateBinding,
  runCodingAgentCandidateCliTuiReceipt,
} from "./coding-agent-candidate-cli-tui-receipt.mjs";
import {
  CODING_AGENT_CANDIDATE_GIT_DELIVERY_ARTIFACT_PATHS,
  CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_COMMAND,
  CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_PATHS,
  CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_TEST_FILES,
  CODING_AGENT_CANDIDATE_GIT_DELIVERY_SOURCE_FILES,
  createCandidateGitDeliveryRemoteTargets,
  projectCandidateGitDeliveryPlatformResults,
  projectCandidateGitDeliveryRecoveryObservations,
  runCodingAgentCandidateGitDeliveryReceipt,
} from "./coding-agent-candidate-git-delivery-receipt.mjs";
import { loadCodingAgentCandidateDimensionEvidence } from "./coding-agent-candidate-score.mjs";
import { runCodingAgentCandidateTuiAccessibility } from "./run-coding-agent-candidate-tui-accessibility.mjs";
import {
  createVerificationDagPlan,
  finalizeVerificationDag,
  replayCommandJobSnapshots,
} from "./run-verification-dag.mjs";
import { buildVerificationImpactTruthSetReport } from "./run-verification-impact-truth-set.mjs";
import {
  runVerificationBrowserRelayFixture,
  writeVerificationBrowserRelayArtifacts,
} from "./run-verification-browser-relay.mjs";
import {
  readP2ASubTaskSupervisorSourceIdentity,
  runP2ASubTaskSupervisorSoak,
} from "./run-subtask-supervisor-soak.mjs";

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const { isTaskProjectionCollectionPage: isVsCodeTaskProjectionCollectionPage } = require(
  "../apps/vscode-extension/src/task-projection-validator.cjs",
);
const REFERENCE_NAME = "candidate-dimension-evidence-reference.json";
const GLOBAL_RECEIPT_NAME = "candidate-global-receipt.json";
const REFERENCE_VERSION =
  "coding-agent-benchmark-candidate-dimension-evidence-reference/v1";
const REFERENCE_SCHEMA_PATH = path.join(
  WORKSPACE_ROOT,
  "benchmarks/coding-agent/v3/candidate-dimension-evidence-reference.schema.json",
);
const GLOBAL_RECEIPT_SCHEMA_PATH = path.join(
  WORKSPACE_ROOT,
  "benchmarks/coding-agent/v3/candidate-global-receipt.schema.json",
);
const SYSTEM_EVIDENCE_SCHEMA_PATH = path.join(
  WORKSPACE_ROOT,
  "benchmarks/coding-agent/v3/system-evidence.schema.json",
);
const SYSTEM_TASK_IDS = Object.freeze([
  "system.browser-behavior",
  "system.parallel-read-isolation",
  "system.parallel-write-fan-in",
  "system.restart-delivery-reconciliation",
]);
const PLATFORMS = Object.freeze(["windows-native", "wsl2-linux"]);
const VITEST_ENTRY = path.join(WORKSPACE_ROOT, "node_modules/vitest/vitest.mjs");
const VITEST_FORMAT = "vitest-json/v3.2.7";
const VITEST_VERSION = "3.2.7";
const DEFAULT_AUDIT_TIMEOUT_MS = 15 * 60_000;
const WSL_REPOSITORY_IDENTITY_PROBE = [
  'import { pathToFileURL } from "node:url";',
  'const rootUrl=pathToFileURL(`${process.cwd()}/`);',
  'const moduleUrl=new URL("./scripts/coding-agent-benchmark-preflight.mjs",rootUrl);',
  'const {resolveBenchmarkRepositoryIdentity}=await import(moduleUrl);',
  'const identity=await resolveBenchmarkRepositoryIdentity(process.cwd());',
  'process.stdout.write(JSON.stringify(identity));',
].join("");
const CODING_RUN_CLIENT_RECEIPT_VERSION =
  "coding-agent-benchmark-candidate-coding-run-client-evidence-receipt/v1";
const CODING_RUN_CLIENT_RECEIPT_SCHEMA_PATH = path.join(
  WORKSPACE_ROOT,
  "benchmarks/coding-agent/v3/candidate-coding-run-client-evidence-receipt.schema.json",
);
const CODING_RUN_CLIENT_AUDIT_COMMAND = "corepack pnpm verify:coding-run-client";
const CODING_RUN_CLIENT_TEST_FILES = Object.freeze([
  "packages/belldandy-core/src/coding-run/stdio.test.ts",
  "packages/belldandy-core/src/coding-run/client.test.ts",
  "apps/vscode-extension/src/stdio-client.test.js",
  "scripts/coding-run-client-conformance.test.mjs",
  "scripts/coding-run-client-failure-conformance.test.mjs",
  "scripts/run-coding-run-client-external-consumer.test.mjs",
  "scripts/run-coding-run-client-typescript-consumer.test.mjs",
]);
const CODING_RUN_CLIENT_PATHS = Object.freeze({
  report: "candidate-evidence/coding-run-client/audit-vitest-report.json",
  dag: "candidate-evidence/coding-run-client/audit-verification-dag.json",
  receipt: "candidate-coding-run-client-evidence-receipt.json",
});
const CODING_RUN_CLIENT_CLAIMS = Object.freeze([
  Object.freeze({
    dimensionId: "headless_ecosystem",
    contractId: "external_consumer_pair_lifecycle",
    owner: "candidateCodingRunClientReceipt",
    completion: "current_harness_packed_esm_and_typescript_consumers_passed",
  }),
  Object.freeze({
    dimensionId: "headless_ecosystem",
    contractId: "protocol_version_conformance",
    owner: "candidateCodingRunClientReceipt",
    completion: "current_harness_protocol_version_conformance_passed",
  }),
  Object.freeze({
    dimensionId: "headless_ecosystem",
    contractId: "error_taxonomy_cancellation_conformance",
    owner: "candidateCodingRunClientReceipt",
    completion: "current_harness_error_taxonomy_and_cancellation_conformance_passed",
  }),
]);
const VERIFICATION_RECEIPT_VERSION =
  "coding-agent-benchmark-candidate-verification-evidence-receipt/v1";
const VERIFICATION_RECEIPT_SCHEMA_PATH = path.join(
  WORKSPACE_ROOT,
  "benchmarks/coding-agent/v3/candidate-verification-evidence-receipt.schema.json",
);
const VERIFICATION_AUDIT_COMMAND = "corepack pnpm verify:p1b-verification-audit";
const VERIFICATION_AUDIT_TEST_FILES = Object.freeze([
  "scripts/run-verification-impact-truth-set.test.mjs",
  "scripts/verification-test-report-adapter.test.mjs",
  "scripts/run-verification-dag.test.mjs",
  "scripts/verification-browser-report-adapter.test.mjs",
]);
const VERIFICATION_REPLAY_COMMAND =
  "deterministic:verification-dag-reproducible-failure-v1";
const VERIFICATION_REPLAY_FIXTURE_ID = "verification-dag-reproducible-failure-v1";
const VERIFICATION_REPLAY_NODE_ID = "verification.failure-replay";
const VERIFICATION_REPLAY_MESSAGE =
  "candidate-verification-replay:deterministic_test_failure";
const VERIFICATION_VIEWPORTS = Object.freeze([
  Object.freeze({ runId: "mobile", width: 375, height: 667, deviceScaleFactor: 1 }),
  Object.freeze({ runId: "tablet", width: 768, height: 1024, deviceScaleFactor: 1 }),
  Object.freeze({ runId: "desktop", width: 1440, height: 900, deviceScaleFactor: 1 }),
]);
const VERIFICATION_PATHS = Object.freeze({
  impact: "candidate-evidence/verification/impact-truth-set-report.json",
  report: "candidate-evidence/verification/structured-test-vitest-report.json",
  dag: "candidate-evidence/verification/structured-test-verification-dag.json",
  replay: "candidate-evidence/verification/failure-replay-verification-dag.json",
  receipt: "candidate-verification-evidence-receipt.json",
});
const VERIFICATION_CLAIMS = Object.freeze([
  Object.freeze({
    dimensionId: "editing_testing",
    contractId: "verification_impact_truth_set",
    owner: "candidateVerificationReceipt",
    completion: "current_selector_truth_set_gate_passed",
  }),
  Object.freeze({
    dimensionId: "editing_testing",
    contractId: "verification_structured_test_reports",
    owner: "candidateVerificationReceipt",
    completion: "current_harness_structured_test_audit_passed",
  }),
  Object.freeze({
    dimensionId: "editing_testing",
    contractId: "verification_failure_replay",
    owner: "candidateVerificationReceipt",
    completion: "current_harness_reproducible_failure_replay_preserved",
  }),
  Object.freeze({
    dimensionId: "editing_testing",
    contractId: "browser_relay_behavior_evidence",
    owner: "candidateVerificationReceipt",
    completion: "current_harness_three_viewport_browser_relay_passed_zero_residue",
  }),
]);
const SUPERVISOR_RECEIPT_VERSION =
  "coding-agent-benchmark-candidate-supervisor-evidence-receipt/v1";
const SUPERVISOR_RECEIPT_SCHEMA_PATH = path.join(
  WORKSPACE_ROOT,
  "benchmarks/coding-agent/v3/candidate-supervisor-evidence-receipt.schema.json",
);
const SUPERVISOR_FAULT_AUDIT_COMMAND =
  "corepack pnpm verify:p2a-supervisor-fault-audit";
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
const SUPERVISOR_PATHS = Object.freeze({
  windowsSoak: "candidate-evidence/supervisor/soak-windows-native.json",
  wslSoak: "candidate-evidence/supervisor/soak-wsl2-linux.json",
  report: "candidate-evidence/supervisor/fault-audit-vitest-report.json",
  dag: "candidate-evidence/supervisor/fault-audit-verification-dag.json",
  receipt: "candidate-supervisor-evidence-receipt.json",
});
const SUPERVISOR_CLAIMS = Object.freeze([
  Object.freeze({
    dimensionId: "safety_recovery",
    contractId: "fault_matrix_audit_reconciliation",
    owner: "candidateSupervisorReceipt",
    completion: "current_harness_dual_platform_soak_and_fault_audit_passed",
  }),
  Object.freeze({
    dimensionId: "session_long_running",
    contractId: "supervisor_dual_platform_60_minute_soak",
    owner: "candidateSupervisorReceipt",
    completion: "current_harness_dual_platform_60_minute_soak_passed",
  }),
  Object.freeze({
    dimensionId: "session_long_running",
    contractId: "bounded_budget_cancel_restart_reattach",
    owner: "candidateSupervisorReceipt",
    completion: "current_harness_bounded_budget_cancel_restart_reattach_audit_passed",
  }),
  Object.freeze({
    dimensionId: "session_long_running",
    contractId: "managed_worktree_fan_in_review_remediation",
    owner: "candidateSupervisorReceipt",
    completion: "current_harness_managed_worktree_fan_in_review_remediation_audit_passed",
  }),
  Object.freeze({
    dimensionId: "session_long_running",
    contractId: "parallel_resource_convergence",
    owner: "candidateSupervisorReceipt",
    completion: "current_harness_parallel_resources_converged_zero_residue",
  }),
]);
const CLI_TUI_PATHS = Object.freeze({
  taskProjection: "candidate-evidence/cli-tui/task-projection-conformance.json",
  efficiency: "candidate-evidence/cli-tui/task-efficiency-evidence.json",
  windowsAccessibility: "candidate-evidence/cli-tui/accessibility/windows-native.json",
  wslAccessibility: "candidate-evidence/cli-tui/accessibility/wsl2-linux.json",
  receipt: "candidate-cli-tui-evidence-receipt.json",
});
const GIT_DELIVERY_ARTIFACT_SCHEMA_PATH = path.join(
  WORKSPACE_ROOT,
  "benchmarks/coding-agent/v3/git-delivery-evidence.schema.json",
);
const GIT_DELIVERY_RECEIPT_PATH = "candidate-git-delivery-evidence-receipt.json";
const GIT_DELIVERY_ARTIFACT_KINDS = Object.freeze({
  worktreeSoak: "multi_repository_worktree_soak",
  reviewRemediation: "review_remediation_loop",
  remoteAuthority: "remote_delivery_authority_separation",
  recoveryAudit: "delivery_recovery_audit_matrix",
});
const TASK_PROJECTION_FIXTURE_PATH =
  "benchmarks/task-projection/v1/consumer-conformance.json";
const TASK_PROJECTION_SOURCE_PATHS = Object.freeze([
  "apps/vscode-extension/src/task-projection-validator.cjs",
  "apps/web/public/app/features/task-projection-webchat.js",
  TASK_PROJECTION_FIXTURE_PATH,
  "packages/belldandy-core/src/cli/commands/agent/task-projections.ts",
  "packages/belldandy-core/src/coding-run/task-projection-consumer.ts",
  "packages/belldandy-core/src/coding-run/task-projection.ts",
  "packages/belldandy-core/src/tui/runtime.ts",
  "scripts/coding-agent-candidate-local-evidence.mjs",
]);
const TASK_EFFICIENCY_SOURCE_PATHS = Object.freeze([
  "packages/belldandy-core/src/coding-run/contracts.ts",
  "packages/belldandy-core/src/coding-run/task-efficiency-metrics.ts",
  "packages/belldandy-core/src/coding-run/task-projection.ts",
  "packages/belldandy-core/src/coding-run/trace.ts",
  "scripts/coding-agent-candidate-local-evidence.mjs",
]);

export async function bootstrapCodingAgentCandidateEvidence(input, dependencies = {}) {
  const aggregateRoot = path.resolve(requireString(input?.aggregateRoot, "aggregateRoot"));
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  const referencePath = resolveInside(aggregateRoot, REFERENCE_NAME);
  if (await exists(referencePath)) {
    throw reject("dimension evidence reference already exists");
  }

  const aggregate = await loadCodingAgentCandidateCliTuiAggregateBinding(aggregateRoot);
  const resolveRepositoryIdentity = dependencies.resolveRepositoryIdentity
    ?? (() => resolveBenchmarkRepositoryIdentity(WORKSPACE_ROOT));
  const repositoryIdentity = await resolveRepositoryIdentity();
  requireExactRepositoryIdentity(repositoryIdentity, aggregate.harness);

  const [reportText, indexText, globalReceiptText] = await Promise.all([
    readBoundedRegularFile(
      resolveInside(aggregateRoot, "benchmark-report.json"),
      "benchmark report",
    ),
    readBoundedRegularFile(
      resolveInside(aggregateRoot, "baseline-index.json"),
      "baseline index",
    ),
    readBoundedRegularFile(
      resolveInside(aggregateRoot, GLOBAL_RECEIPT_NAME),
      "candidate-global receipt",
    ),
  ]);
  const report = parseJson(reportText, "benchmark report");
  const index = parseJson(indexText, "baseline index");
  requireCompleteMatrix(report, index);

  await validateSchemaText(
    globalReceiptText,
    GLOBAL_RECEIPT_SCHEMA_PATH,
    "candidate-global receipt",
  );
  const globalReceipt = parseJson(globalReceiptText, "candidate-global receipt");
  if (!jsonEqual(globalReceipt.aggregate, aggregate)) {
    throw reject("candidate-global receipt aggregate binding drifted");
  }

  const systemArtifacts = await collectSystemEvidence({ aggregateRoot, report });
  const reference = {
    schemaVersion: REFERENCE_VERSION,
    generatedAt,
    aggregate,
    failureSemantics: {
      missingReference: "incomplete",
      missingArtifact: "reject",
      digestMismatch: "reject",
      schemaOrBindingMismatch: "reject",
      unmetCompletion: "failed",
    },
    owners: {
      systemEvidence: {
        kind: "retained_run_artifacts",
        artifactKey: "systemEvidence",
        scope: "layer_c_runs",
        artifactSchemaVersion: "coding-agent-benchmark-system-evidence/v1",
        artifacts: systemArtifacts,
      },
      candidateGlobalReceipt: {
        kind: "candidate_artifact",
        scope: "candidate",
        artifactSchemaVersion: "coding-agent-benchmark-candidate-global-receipt/v1",
        artifact: {
          path: GLOBAL_RECEIPT_NAME,
          sha256: sha256(globalReceiptText),
        },
      },
    },
    claims: [
      {
        dimensionId: "safety_recovery",
        contractId: "system_evidence_critical_rate",
        owner: "systemEvidence",
        completion: "all_layer_c_runs_valid",
      },
      {
        dimensionId: "safety_recovery",
        contractId: "candidate_sensitive_scan",
        owner: "candidateGlobalReceipt",
        completion: "completed_zero_findings",
      },
      {
        dimensionId: "safety_recovery",
        contractId: "candidate_resource_sweeps",
        owner: "candidateGlobalReceipt",
        completion: "required_platforms_completed_zero_orphans",
      },
    ],
  };
  await validateSchemaValue(reference, REFERENCE_SCHEMA_PATH, "dimension evidence reference");

  let written = false;
  try {
    await fs.writeFile(referencePath, serializeJson(reference), {
      encoding: "utf8",
      flag: "wx",
    });
    written = true;
    await loadCodingAgentCandidateDimensionEvidence({
      aggregateRoot,
      verifiedAggregate: { report, baselineIndex: index },
    });
    return reference;
  } catch (error) {
    if (written) await fs.rm(referencePath, { force: true }).catch(() => {});
    throw error;
  }
}

export function normalizeCandidateWslWorkspaceRoot(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value || /[\0\r\n:]/.test(value)
    || value.includes("\\") || !path.posix.isAbsolute(value)
    || value.split("/").some((part) => part === "..")) {
    throw reject("wslWorkspaceRoot must be one absolute WSL path");
  }
  const normalized = path.posix.normalize(value);
  if (normalized === "/" || normalized.split("/").some((part) => part === "..")) {
    throw reject("wslWorkspaceRoot must be one absolute WSL path");
  }
  return normalized.replace(/\/$/, "");
}

export function createCandidateWslNodeInvocation(input) {
  const distribution = requireString(input?.distribution, "WSL distribution");
  const workspaceRootWsl = normalizeCandidateWslWorkspaceRoot(
    requireString(input?.workspaceRootWsl, "WSL workspace root"),
  );
  if (!Array.isArray(input?.nodeArgs)
    || input.nodeArgs.some((argument) => typeof argument !== "string" || argument.includes("\0"))) {
    throw reject("WSL node arguments are invalid");
  }
  return {
    command: "wsl.exe",
    args: [
      "--distribution", distribution,
      "--cd", workspaceRootWsl,
      "--exec", "node",
      ...input.nodeArgs,
    ],
  };
}

export function createCandidateWslRepositoryIdentityInvocation(input) {
  return createCandidateWslNodeInvocation({
    ...input,
    nodeArgs: [
      "--input-type=module",
      "--eval",
      WSL_REPOSITORY_IDENTITY_PROBE,
    ],
  });
}

export function assertCandidateWslWorkspaceIdentity(actual, expected) {
  if (!repositoryIdentityMatches(actual, expected)) {
    throw reject("WSL workspace identity does not match aggregate harness");
  }
}

export async function collectCandidateCodingRunClientEvidence(input, dependencies = {}) {
  const aggregateRoot = path.resolve(requireString(input?.aggregateRoot, "aggregateRoot"));
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  const state = await loadLocalEvidenceState({ aggregateRoot, dependencies });
  if (state.reference.owners.candidateCodingRunClientReceipt !== undefined
    || state.reference.claims.some(({ owner }) => owner === "candidateCodingRunClientReceipt")) {
    throw reject("coding-run client evidence owner already exists");
  }

  const targets = Object.fromEntries(Object.entries(CODING_RUN_CLIENT_PATHS).map(
    ([key, relativePath]) => [key, resolveInside(aggregateRoot, relativePath)],
  ));
  await requireTargetsAbsent(Object.values(targets));
  await fs.mkdir(path.dirname(targets.report), { recursive: true });
  const plannedTargets = Object.values(targets);
  let referenceUpdated = false;
  try {
    const runVitestAudit = dependencies.runVitestAudit ?? runNativeVitestAudit;
    const auditResult = normalizeAuditResult(await runVitestAudit({
      outputPath: targets.report,
      testFiles: [...CODING_RUN_CLIENT_TEST_FILES],
      timeoutMs: DEFAULT_AUDIT_TIMEOUT_MS,
    }));
    const reportText = await readBoundedRegularFile(
      targets.report,
      "coding-run client native Vitest report",
    );
    const reportReference = {
      framework: "vitest",
      format: VITEST_FORMAT,
      runnerVersion: VITEST_VERSION,
      path: CODING_RUN_CLIENT_PATHS.report,
      sha256: sha256(reportText),
    };
    const dag = replayCommandJobSnapshots(createVerificationDagPlan({
      runId: "candidate-coding-run-client-audit",
      taskId: "p2c-coding-run-client-audit",
      generatedAt,
      commit: state.aggregate.harness.commit,
      workspaceHash: state.aggregate.harness.worktreeContentSha256,
      verificationCommands: [{
        id: "coding-run-client.audit",
        kind: "acceptance",
        scope: "full",
        command: CODING_RUN_CLIENT_AUDIT_COMMAND,
      }],
    }), [{
      id: "coding-run-client.audit",
      snapshot: toCommandJobSnapshot(auditResult),
      testReport: {
        framework: reportReference.framework,
        format: reportReference.format,
        runnerVersion: reportReference.runnerVersion,
        artifact: {
          path: reportReference.path,
          sha256: reportReference.sha256,
        },
        content: reportText,
      },
    }]);
    const dagText = serializeJson(dag);
    await fs.writeFile(targets.dag, dagText, { encoding: "utf8", flag: "wx" });

    await requireRepositoryIdentityStillMatches(state, dependencies);
    const receipt = {
      schemaVersion: CODING_RUN_CLIENT_RECEIPT_VERSION,
      generatedAt,
      aggregate: state.aggregate,
      audit: {
        verificationDag: {
          artifactSchemaVersion: "verification-dag/v1",
          path: CODING_RUN_CLIENT_PATHS.dag,
          sha256: sha256(dagText),
        },
        nativeTestReport: reportReference,
        testFiles: [...CODING_RUN_CLIENT_TEST_FILES],
      },
    };
    await validateSchemaValue(
      receipt,
      CODING_RUN_CLIENT_RECEIPT_SCHEMA_PATH,
      "coding-run client evidence receipt",
    );
    const receiptText = serializeJson(receipt);
    await fs.writeFile(targets.receipt, receiptText, { encoding: "utf8", flag: "wx" });

    const updatedReference = structuredClone(state.reference);
    updatedReference.owners.candidateCodingRunClientReceipt = {
      kind: "candidate_artifact",
      scope: "candidate_harness",
      artifactSchemaVersion: CODING_RUN_CLIENT_RECEIPT_VERSION,
      artifact: {
        path: CODING_RUN_CLIENT_PATHS.receipt,
        sha256: sha256(receiptText),
      },
    };
    updatedReference.claims.push(...CODING_RUN_CLIENT_CLAIMS.map((claim) => ({ ...claim })));
    await validateSchemaValue(
      updatedReference,
      REFERENCE_SCHEMA_PATH,
      "dimension evidence reference",
    );
    await requireReferenceUnchanged(state.referencePath, state.referenceText);
    await fs.writeFile(state.referencePath, serializeJson(updatedReference), "utf8");
    referenceUpdated = true;
    await loadCodingAgentCandidateDimensionEvidence({
      aggregateRoot,
      verifiedAggregate: state.verifiedAggregate,
    });
    return receipt;
  } catch (error) {
    if (referenceUpdated) {
      await fs.writeFile(state.referencePath, state.referenceText, "utf8").catch(() => {});
    }
    for (const target of plannedTargets.reverse()) {
      await fs.rm(target, { force: true }).catch(() => {});
    }
    throw error;
  }
}

export async function collectCandidateGitDeliveryEvidence(input, dependencies = {}) {
  const aggregateRoot = path.resolve(requireString(input?.aggregateRoot, "aggregateRoot"));
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  const wslWorkspaceRoot = normalizeCandidateWslWorkspaceRoot(input?.wslWorkspaceRoot);
  const state = await loadLocalEvidenceState({ aggregateRoot, dependencies });
  if (state.reference.owners.candidateGitDeliveryReceipt !== undefined
    || state.reference.claims.some(({ owner }) => owner === "candidateGitDeliveryReceipt")) {
    throw reject("Git delivery evidence owner already exists");
  }

  const relativeTargets = [
    ...PLATFORMS.flatMap((platform) => Object.values(
      CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_PATHS[platform],
    )),
    ...Object.values(CODING_AGENT_CANDIDATE_GIT_DELIVERY_ARTIFACT_PATHS),
    GIT_DELIVERY_RECEIPT_PATH,
  ];
  const plannedTargets = relativeTargets.map((relativePath) => (
    resolveInside(aggregateRoot, relativePath)
  ));
  await requireTargetsAbsent(plannedTargets);

  let committedReferenceText = null;
  try {
    const runGitDeliveryAudit = dependencies.runGitDeliveryAudit
      ?? runNativeGitDeliveryAudit;
    const auditRuns = [];
    const resultsByGroup = Object.fromEntries(
      Object.keys(GIT_DELIVERY_ARTIFACT_KINDS).map((key) => [key, []]),
    );
    for (const platform of PLATFORMS) {
      const paths = CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_PATHS[platform];
      const outputPath = resolveInside(aggregateRoot, paths.report);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      const auditResult = normalizeAuditResult(await runGitDeliveryAudit({
        platform,
        outputPath,
        testFiles: [...CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_TEST_FILES],
        timeoutMs: DEFAULT_AUDIT_TIMEOUT_MS,
        wslDistribution: input?.wslDistribution ?? "Ubuntu-22.04",
        wslWorkspaceRoot,
        candidateHarness: state.aggregate.harness,
      }));
      const reportText = await readBoundedRegularFile(
        outputPath,
        `Git delivery ${platform} native Vitest report`,
      );
      const report = parseJson(reportText, `Git delivery ${platform} native Vitest report`);
      const groupResults = projectCandidateGitDeliveryPlatformResults(report);
      for (const [key, passed] of Object.entries(groupResults)) {
        resultsByGroup[key].push({ platform, passed });
      }

      const nativeTestReport = {
        framework: "vitest",
        format: VITEST_FORMAT,
        runnerVersion: VITEST_VERSION,
        path: paths.report,
        sha256: sha256(reportText),
      };
      const dag = replayCommandJobSnapshots(createVerificationDagPlan({
        runId: `candidate-git-delivery-${platform}-audit`,
        taskId: "p2c-git-delivery-audit",
        generatedAt,
        commit: state.aggregate.harness.commit,
        workspaceHash: state.aggregate.harness.worktreeContentSha256,
        verificationCommands: [{
          id: "git-delivery.audit",
          kind: "acceptance",
          scope: "full",
          command: CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_COMMAND,
        }],
      }), [{
        id: "git-delivery.audit",
        snapshot: toCommandJobSnapshot(auditResult),
        testReport: {
          framework: nativeTestReport.framework,
          format: nativeTestReport.format,
          runnerVersion: nativeTestReport.runnerVersion,
          artifact: {
            path: nativeTestReport.path,
            sha256: nativeTestReport.sha256,
          },
          content: reportText,
        },
      }]);
      const dagText = serializeJson(dag);
      await writeExclusive(resolveInside(aggregateRoot, paths.dag), dagText);
      auditRuns.push({
        platform,
        verificationDag: {
          artifactSchemaVersion: "verification-dag/v1",
          path: paths.dag,
          sha256: sha256(dagText),
        },
        nativeTestReport,
      });
    }

    const audit = {
      command: CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_COMMAND,
      testFiles: [...CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_TEST_FILES],
      runs: auditRuns,
    };
    const sourceIdentity = await createCurrentSourceIdentity(
      state.aggregate.harness,
      CODING_AGENT_CANDIDATE_GIT_DELIVERY_SOURCE_FILES,
    );
    const systemEvidence = selectGitDeliverySystemEvidence(state.reference);
    const recoveryObservations = await projectCandidateGitDeliveryRecoveryObservations({
      aggregateRoot,
      aggregate: state.aggregate,
      systemEvidence,
    });
    const artifacts = createGitDeliveryArtifacts({
      aggregate: state.aggregate,
      generatedAt,
      sourceIdentity,
      audit,
      resultsByGroup,
      recoveryObservations,
      systemEvidence,
    });
    for (const [key, artifact] of Object.entries(artifacts)) {
      await validateSchemaValue(
        artifact,
        GIT_DELIVERY_ARTIFACT_SCHEMA_PATH,
        `Git delivery ${key} evidence`,
      );
      await writeExclusive(
        resolveInside(aggregateRoot, CODING_AGENT_CANDIDATE_GIT_DELIVERY_ARTIFACT_PATHS[key]),
        serializeJson(artifact),
      );
    }

    await requireRepositoryIdentityStillMatches(state, dependencies);
    await requireReferenceUnchanged(state.referencePath, state.referenceText);
    const receipt = await runCodingAgentCandidateGitDeliveryReceipt({
      aggregateRoot,
      generatedAt,
    });
    committedReferenceText = await readBoundedRegularFile(
      state.referencePath,
      "dimension evidence reference",
    );
    await loadCodingAgentCandidateDimensionEvidence({
      aggregateRoot,
      verifiedAggregate: state.verifiedAggregate,
    });
    return receipt;
  } catch (error) {
    if (committedReferenceText !== null) {
      const currentText = await fs.readFile(state.referencePath, "utf8").catch(() => null);
      if (currentText === committedReferenceText) {
        await fs.writeFile(state.referencePath, state.referenceText, "utf8").catch(() => {});
      }
    }
    for (const target of plannedTargets.reverse()) {
      await fs.rm(target, { force: true }).catch(() => {});
    }
    throw error;
  }
}

function selectGitDeliverySystemEvidence(reference) {
  const retained = reference.owners.systemEvidence?.artifacts ?? [];
  const selected = [
    "system.parallel-write-fan-in",
    "system.restart-delivery-reconciliation",
  ].flatMap((taskId) => PLATFORMS.map((platform) => {
    const matches = retained.filter((item) => (
      item?.taskId === taskId && item?.platform === platform
    ));
    if (matches.length === 0) {
      throw reject(`Git delivery system evidence is incomplete: ${taskId}:${platform}`);
    }
    const selected = [...matches].sort((left, right) => left.runId.localeCompare(right.runId))[0];
    return { path: selected.path, sha256: selected.sha256 };
  }));
  return selected;
}

function createGitDeliveryArtifacts(input) {
  const result = (key) => {
    const platforms = input.resultsByGroup[key];
    const artifactKind = GIT_DELIVERY_ARTIFACT_KINDS[key];
    const failures = platforms
      .filter(({ passed }) => !passed)
      .map(({ platform }) => `${platform}:${artifactKind}:native_audit_failed`);
    return {
      schemaVersion: "coding-agent-benchmark-git-delivery-evidence/v1",
      artifactKind,
      generatedAt: input.generatedAt,
      aggregate: input.aggregate,
      sourceIdentity: input.sourceIdentity,
      audit: input.audit,
      status: failures.length === 0 ? "complete" : "failed",
      gate: { passed: failures.length === 0, failures },
      platforms,
    };
  };
  return {
    worktreeSoak: {
      ...result("worktreeSoak"),
      repositories: ["star-sanctuary", "reference-repository"],
      observations: PLATFORMS.map((platform) => ({
        platform,
        dirty: false,
        residualWorktreeCount: 0,
        mutationCount: 0,
      })),
    },
    reviewRemediation: {
      ...result("reviewRemediation"),
      observations: PLATFORMS.map((platform) => ({
        platform,
        reviewVerdict: "needs_changes",
        remediationApplied: true,
        recheckVerdict: "approved",
        diffHashStable: true,
      })),
    },
    remoteAuthority: {
      ...result("remoteAuthority"),
      repositories: ["star-sanctuary", "reference-repository"],
      authority: {
        delegable: false,
        rememberable: false,
        userApprovalRequired: true,
        remoteWritePerformed: false,
        credentialsRead: false,
      },
      targets: createCandidateGitDeliveryRemoteTargets(input.aggregate.harness),
    },
    recoveryAudit: {
      ...result("recoveryAudit"),
      observations: input.recoveryObservations,
      systemEvidence: input.systemEvidence,
    },
  };
}

export async function collectCandidateVerificationEvidence(input, dependencies = {}) {
  const aggregateRoot = path.resolve(requireString(input?.aggregateRoot, "aggregateRoot"));
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  const state = await loadLocalEvidenceState({ aggregateRoot, dependencies });
  if (state.reference.owners.candidateVerificationReceipt !== undefined
    || state.reference.claims.some(({ owner }) => owner === "candidateVerificationReceipt")) {
    throw reject("Verification evidence owner already exists");
  }

  const relativeBrowserPaths = VERIFICATION_VIEWPORTS.map(({ runId }) => ({
    report: `candidate-evidence/verification/browser/${runId}/browser-report.json`,
    evidence: `candidate-evidence/verification/browser/${runId}/browser-evidence.json`,
    screenshot: `candidate-evidence/verification/browser/${runId}/browser-screenshot.png`,
  }));
  const fixedTargets = Object.fromEntries(Object.entries(VERIFICATION_PATHS).map(
    ([key, relativePath]) => [key, resolveInside(aggregateRoot, relativePath)],
  ));
  const browserTargets = relativeBrowserPaths.flatMap((paths) => (
    Object.values(paths).map((relativePath) => resolveInside(aggregateRoot, relativePath))
  ));
  const plannedTargets = [...Object.values(fixedTargets), ...browserTargets];
  await requireTargetsAbsent(plannedTargets);
  const revision = {
    commit: state.aggregate.harness.commit,
    workspaceHash: state.aggregate.harness.worktreeContentSha256,
  };
  let referenceUpdated = false;
  try {
    const impactReport = await buildVerificationImpactTruthSetReport({ generatedAt });
    const impactText = serializeJson(impactReport);
    await writeExclusive(fixedTargets.impact, impactText);

    await fs.mkdir(path.dirname(fixedTargets.report), { recursive: true });
    const runVitestAudit = dependencies.runVitestAudit ?? runNativeVitestAudit;
    const auditResult = normalizeAuditResult(await runVitestAudit({
      outputPath: fixedTargets.report,
      testFiles: [...VERIFICATION_AUDIT_TEST_FILES],
      timeoutMs: DEFAULT_AUDIT_TIMEOUT_MS,
    }));
    const nativeReportText = await readBoundedRegularFile(
      fixedTargets.report,
      "Verification native Vitest report",
    );
    const nativeReportReference = {
      framework: "vitest",
      format: VITEST_FORMAT,
      runnerVersion: VITEST_VERSION,
      path: VERIFICATION_PATHS.report,
      sha256: sha256(nativeReportText),
    };
    const structuredDag = replayCommandJobSnapshots(createVerificationDagPlan({
      runId: "candidate-verification-structured-test-audit",
      taskId: "p2c-verification-structured-test-audit",
      generatedAt,
      commit: revision.commit,
      workspaceHash: revision.workspaceHash,
      verificationCommands: [{
        id: "verification.structured-test-audit",
        kind: "acceptance",
        scope: "full",
        command: VERIFICATION_AUDIT_COMMAND,
      }],
    }), [{
      id: "verification.structured-test-audit",
      snapshot: toCommandJobSnapshot(auditResult),
      testReport: {
        framework: nativeReportReference.framework,
        format: nativeReportReference.format,
        runnerVersion: nativeReportReference.runnerVersion,
        artifact: {
          path: nativeReportReference.path,
          sha256: nativeReportReference.sha256,
        },
        content: nativeReportText,
      },
    }]);
    const structuredDagText = serializeJson(structuredDag);
    await writeExclusive(fixedTargets.dag, structuredDagText);

    const replayIdentity = createVerificationReplayIdentity(state.aggregate.harness);
    const replayDag = finalizeVerificationDag(createVerificationDagPlan({
      runId: "candidate-verification-failure-replay",
      taskId: "p2c-verification-failure-replay",
      generatedAt,
      commit: revision.commit,
      workspaceHash: revision.workspaceHash,
      verificationCommands: [{
        id: VERIFICATION_REPLAY_NODE_ID,
        kind: "acceptance",
        scope: "full",
        command: VERIFICATION_REPLAY_COMMAND,
      }],
    }), [{
      id: VERIFICATION_REPLAY_NODE_ID,
      status: "failed",
      kind: "test",
      message: VERIFICATION_REPLAY_MESSAGE,
      replayBinding: replayIdentity.binding,
      failureFingerprint: replayIdentity.failureFingerprint,
      replays: [
        {
          status: "failed",
          kind: "test",
          replayBinding: replayIdentity.binding,
          failureFingerprint: replayIdentity.failureFingerprint,
        },
        {
          status: "failed",
          kind: "test",
          replayBinding: replayIdentity.binding,
          failureFingerprint: replayIdentity.failureFingerprint,
        },
      ],
    }]);
    const replayDagText = serializeJson(replayDag);
    await writeExclusive(fixedTargets.replay, replayDagText);

    const collectBrowserRun = dependencies.collectBrowserRun ?? runNativeBrowserEvidence;
    const browserRuns = [];
    for (let index = 0; index < VERIFICATION_VIEWPORTS.length; index += 1) {
      const viewport = VERIFICATION_VIEWPORTS[index];
      const relativePaths = relativeBrowserPaths[index];
      const outputDir = path.dirname(resolveInside(aggregateRoot, relativePaths.report));
      await collectBrowserRun({
        outputDir,
        relativePaths,
        revision,
        viewport,
        chromePath: input?.chromePath,
        extensionPath: input?.extensionPath ?? "apps/browser-extension",
      });
      browserRuns.push({
        runId: viewport.runId,
        viewport: {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: viewport.deviceScaleFactor,
        },
        report: await artifactReference(
          aggregateRoot,
          relativePaths.report,
        ),
        evidence: await artifactReference(
          aggregateRoot,
          relativePaths.evidence,
        ),
        screenshot: await artifactReference(
          aggregateRoot,
          relativePaths.screenshot,
        ),
      });
    }

    await requireRepositoryIdentityStillMatches(state, dependencies);
    const receipt = {
      schemaVersion: VERIFICATION_RECEIPT_VERSION,
      generatedAt,
      aggregate: state.aggregate,
      impactTruthSet: {
        artifactSchemaVersion: "verification-impact-truth-set-report/v1",
        path: VERIFICATION_PATHS.impact,
        sha256: sha256(impactText),
      },
      structuredTestAudit: {
        verificationDag: {
          artifactSchemaVersion: "verification-dag/v1",
          path: VERIFICATION_PATHS.dag,
          sha256: sha256(structuredDagText),
        },
        nativeTestReport: nativeReportReference,
        testFiles: [...VERIFICATION_AUDIT_TEST_FILES],
      },
      failureReplay: {
        fixtureId: VERIFICATION_REPLAY_FIXTURE_ID,
        nodeId: VERIFICATION_REPLAY_NODE_ID,
        expectedClassification: "reproducible_failure",
        replayBinding: replayIdentity.binding,
        initialFailureFingerprint: replayIdentity.failureFingerprint,
        verificationDag: {
          artifactSchemaVersion: "verification-dag/v1",
          path: VERIFICATION_PATHS.replay,
          sha256: sha256(replayDagText),
        },
      },
      browserRelay: {
        artifactSchemaVersion: "verification-browser-evidence/v1",
        runs: browserRuns,
      },
    };
    await validateSchemaValue(
      receipt,
      VERIFICATION_RECEIPT_SCHEMA_PATH,
      "Verification evidence receipt",
    );
    const receiptText = serializeJson(receipt);
    await writeExclusive(fixedTargets.receipt, receiptText);

    const updatedReference = structuredClone(state.reference);
    updatedReference.owners.candidateVerificationReceipt = {
      kind: "candidate_artifact",
      scope: "candidate_harness",
      artifactSchemaVersion: VERIFICATION_RECEIPT_VERSION,
      artifact: {
        path: VERIFICATION_PATHS.receipt,
        sha256: sha256(receiptText),
      },
    };
    const insertAt = updatedReference.claims.findIndex(({ dimensionId }) => (
      dimensionId === "session_long_running" || dimensionId === "headless_ecosystem"
    ));
    updatedReference.claims.splice(
      insertAt < 0 ? updatedReference.claims.length : insertAt,
      0,
      ...VERIFICATION_CLAIMS.map((claim) => ({ ...claim })),
    );
    await validateSchemaValue(
      updatedReference,
      REFERENCE_SCHEMA_PATH,
      "dimension evidence reference",
    );
    await requireReferenceUnchanged(state.referencePath, state.referenceText);
    await fs.writeFile(state.referencePath, serializeJson(updatedReference), "utf8");
    referenceUpdated = true;
    await loadCodingAgentCandidateDimensionEvidence({
      aggregateRoot,
      verifiedAggregate: state.verifiedAggregate,
    });
    return receipt;
  } catch (error) {
    if (referenceUpdated) {
      await fs.writeFile(state.referencePath, state.referenceText, "utf8").catch(() => {});
    }
    for (const target of plannedTargets.reverse()) {
      await fs.rm(target, { force: true }).catch(() => {});
    }
    throw error;
  }
}

export async function collectCandidateSupervisorEvidence(input, dependencies = {}) {
  const aggregateRoot = path.resolve(requireString(input?.aggregateRoot, "aggregateRoot"));
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  const wslWorkspaceRoot = normalizeCandidateWslWorkspaceRoot(input?.wslWorkspaceRoot);
  const state = await loadLocalEvidenceState({ aggregateRoot, dependencies });
  if (state.reference.owners.candidateSupervisorReceipt !== undefined
    || state.reference.claims.some(({ owner }) => owner === "candidateSupervisorReceipt")) {
    throw reject("Supervisor evidence owner already exists");
  }

  const targets = Object.fromEntries(Object.entries(SUPERVISOR_PATHS).map(
    ([key, relativePath]) => [key, resolveInside(aggregateRoot, relativePath)],
  ));
  const plannedTargets = Object.values(targets);
  await requireTargetsAbsent(plannedTargets);
  let referenceUpdated = false;
  try {
    const currentSourceIdentity = await readP2ASubTaskSupervisorSourceIdentity();
    const sourceIdentity = {
      ...currentSourceIdentity,
      workspaceRevision: state.aggregate.harness.commit,
    };
    const reports = [
      {
        platform: "windows-native",
        relativePath: SUPERVISOR_PATHS.windowsSoak,
        outputPath: targets.windowsSoak,
      },
      {
        platform: "wsl2-linux",
        relativePath: SUPERVISOR_PATHS.wslSoak,
        outputPath: targets.wslSoak,
      },
    ];
    const collectSupervisorSoakPair = dependencies.collectSupervisorSoakPair
      ?? runNativeSupervisorSoakPair;
    await collectSupervisorSoakPair({
      reports,
      sourceIdentity,
      durationMinutes: 60,
      wslDistribution: input?.wslDistribution ?? "Ubuntu-22.04",
      wslWorkspaceRoot,
      candidateHarness: state.aggregate.harness,
    });
    const soakReferences = [];
    for (const report of reports) {
      const reportText = await readBoundedRegularFile(
        report.outputPath,
        `Supervisor ${report.platform} soak report`,
      );
      soakReferences.push({
        platform: report.platform,
        path: report.relativePath,
        sha256: sha256(reportText),
      });
    }

    await fs.mkdir(path.dirname(targets.report), { recursive: true });
    const runVitestAudit = dependencies.runVitestAudit ?? runNativeVitestAudit;
    const auditResult = normalizeAuditResult(await runVitestAudit({
      outputPath: targets.report,
      testFiles: [...SUPERVISOR_FAULT_AUDIT_TEST_FILES],
      timeoutMs: DEFAULT_AUDIT_TIMEOUT_MS,
    }));
    const reportText = await readBoundedRegularFile(
      targets.report,
      "Supervisor fault-audit native Vitest report",
    );
    const reportReference = {
      framework: "vitest",
      format: VITEST_FORMAT,
      runnerVersion: VITEST_VERSION,
      path: SUPERVISOR_PATHS.report,
      sha256: sha256(reportText),
    };
    const dag = replayCommandJobSnapshots(createVerificationDagPlan({
      runId: "candidate-supervisor-fault-audit",
      taskId: "p2c-supervisor-fault-audit",
      generatedAt,
      commit: state.aggregate.harness.commit,
      workspaceHash: state.aggregate.harness.worktreeContentSha256,
      verificationCommands: [{
        id: "supervisor.fault-audit",
        kind: "acceptance",
        scope: "full",
        command: SUPERVISOR_FAULT_AUDIT_COMMAND,
      }],
    }), [{
      id: "supervisor.fault-audit",
      snapshot: toCommandJobSnapshot(auditResult),
      testReport: {
        framework: reportReference.framework,
        format: reportReference.format,
        runnerVersion: reportReference.runnerVersion,
        artifact: {
          path: reportReference.path,
          sha256: reportReference.sha256,
        },
        content: reportText,
      },
    }]);
    const dagText = serializeJson(dag);
    await writeExclusive(targets.dag, dagText);

    await requireRepositoryIdentityStillMatches(state, dependencies);
    const receipt = {
      schemaVersion: SUPERVISOR_RECEIPT_VERSION,
      generatedAt,
      aggregate: state.aggregate,
      soak: {
        artifactSchemaVersion: "p2a-subtask-supervisor-soak-report/v1",
        reports: soakReferences,
      },
      faultAudit: {
        verificationDag: {
          artifactSchemaVersion: "verification-dag/v1",
          path: SUPERVISOR_PATHS.dag,
          sha256: sha256(dagText),
        },
        nativeTestReport: reportReference,
        testFiles: [...SUPERVISOR_FAULT_AUDIT_TEST_FILES],
      },
    };
    await validateSchemaValue(
      receipt,
      SUPERVISOR_RECEIPT_SCHEMA_PATH,
      "Supervisor evidence receipt",
    );
    const receiptText = serializeJson(receipt);
    await writeExclusive(targets.receipt, receiptText);

    const updatedReference = structuredClone(state.reference);
    updatedReference.owners.candidateSupervisorReceipt = {
      kind: "candidate_artifact",
      scope: "candidate_harness",
      artifactSchemaVersion: SUPERVISOR_RECEIPT_VERSION,
      artifact: {
        path: SUPERVISOR_PATHS.receipt,
        sha256: sha256(receiptText),
      },
    };
    const safetyInsertAt = updatedReference.claims.findIndex(
      ({ dimensionId }) => dimensionId !== "safety_recovery",
    );
    updatedReference.claims.splice(
      safetyInsertAt < 0 ? updatedReference.claims.length : safetyInsertAt,
      0,
      { ...SUPERVISOR_CLAIMS[0] },
    );
    const sessionInsertAt = updatedReference.claims.findIndex(
      ({ dimensionId }) => dimensionId === "headless_ecosystem",
    );
    updatedReference.claims.splice(
      sessionInsertAt < 0 ? updatedReference.claims.length : sessionInsertAt,
      0,
      ...SUPERVISOR_CLAIMS.slice(1).map((claim) => ({ ...claim })),
    );
    await validateSchemaValue(
      updatedReference,
      REFERENCE_SCHEMA_PATH,
      "dimension evidence reference",
    );
    await requireReferenceUnchanged(state.referencePath, state.referenceText);
    await fs.writeFile(state.referencePath, serializeJson(updatedReference), "utf8");
    referenceUpdated = true;
    await loadCodingAgentCandidateDimensionEvidence({
      aggregateRoot,
      verifiedAggregate: state.verifiedAggregate,
    });
    return receipt;
  } catch (error) {
    if (referenceUpdated) {
      await fs.writeFile(state.referencePath, state.referenceText, "utf8").catch(() => {});
    }
    for (const target of plannedTargets.reverse()) {
      await fs.rm(target, { force: true }).catch(() => {});
    }
    throw error;
  }
}

export async function collectCandidateCliTuiEvidence(input, dependencies = {}) {
  const aggregateRoot = path.resolve(requireString(input?.aggregateRoot, "aggregateRoot"));
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  const state = await loadLocalEvidenceState({ aggregateRoot, dependencies });
  if (state.reference.owners.candidateCliTuiReceipt !== undefined
    || state.reference.claims.some(({ owner }) => owner === "candidateCliTuiReceipt")) {
    throw reject("CLI/TUI evidence owner already exists");
  }

  const targets = Object.fromEntries(Object.entries(CLI_TUI_PATHS).map(
    ([key, relativePath]) => [key, resolveInside(aggregateRoot, relativePath)],
  ));
  const plannedTargets = Object.values(targets);
  await requireTargetsAbsent(plannedTargets);
  let referenceUpdated = false;
  try {
    const [taskProjection, efficiency] = await Promise.all([
      buildTaskProjectionConformanceEvidence(state.aggregate),
      buildTaskEfficiencyEvidence(state.aggregate),
    ]);
    await Promise.all([
      writeExclusive(targets.taskProjection, serializeJson(taskProjection)),
      writeExclusive(targets.efficiency, serializeJson(efficiency)),
    ]);

    const collectObservation = dependencies.collectTuiAccessibilityObservation;
    for (const platform of PLATFORMS) {
      await runCodingAgentCandidateTuiAccessibility({
        aggregateRoot,
        platform,
        generatedAt,
        startupTimeoutSeconds: input?.startupTimeoutSeconds ?? 30,
      }, {
        resolveRepositoryIdentity: dependencies.resolveRepositoryIdentity,
        ...(collectObservation ? { collectObservation } : {}),
      });
    }

    await requireRepositoryIdentityStillMatches(state, dependencies);
    await requireReferenceUnchanged(state.referencePath, state.referenceText);
    const receipt = await runCodingAgentCandidateCliTuiReceipt({
      aggregateRoot,
      generatedAt,
    });
    referenceUpdated = true;
    await loadCodingAgentCandidateDimensionEvidence({
      aggregateRoot,
      verifiedAggregate: state.verifiedAggregate,
    });
    return receipt;
  } catch (error) {
    if (referenceUpdated) {
      await fs.writeFile(state.referencePath, state.referenceText, "utf8").catch(() => {});
    }
    for (const target of plannedTargets.reverse()) {
      await fs.rm(target, { force: true }).catch(() => {});
    }
    throw error;
  }
}

async function buildTaskProjectionConformanceEvidence(aggregate) {
  const fixtureText = await readBoundedRegularFile(
    path.join(WORKSPACE_ROOT, ...TASK_PROJECTION_FIXTURE_PATH.split("/")),
    "TaskProjection conformance fixture",
  );
  const fixture = parseJson(fixtureText, "TaskProjection conformance fixture");
  if (fixture.schemaVersion !== "task-projection-consumer-conformance/v1"
    || !Array.isArray(fixture.sequence) || fixture.sequence.length < 2) {
    throw reject("TaskProjection conformance fixture drifted");
  }
  const consumers = [
    { client: "cli", parse: parseCoreTaskProjectionCollectionPage },
    { client: "tui", parse: parseCoreTaskProjectionCollectionPage },
    { client: "webchat", parse: parseWebChatTaskProjectionCollectionPage },
    {
      client: "vscode",
      parse(page) {
        if (!isVsCodeTaskProjectionCollectionPage(page)) {
          throw reject("VS Code TaskProjection consumer rejected the fixed fixture");
        }
        return page;
      },
    },
  ];
  const entries = consumers.map(({ client, parse }) => {
    const sequence = fixture.sequence.map((step) => {
      const page = parse(structuredClone(step.page));
      const projection = page?.items?.[0];
      if (!projection
        || projection.status !== step.expected?.status
        || projection.evidence?.reasonCategory !== step.expected?.reasonCategory
        || projection.evidence?.reasonCode !== step.expected?.reasonCode
        || !jsonEqual(projection.allowedActions, step.expected?.allowedActions)) {
        throw reject(`${client} TaskProjection conformance result drifted`);
      }
      return {
        status: projection.status,
        allowedActions: [...projection.allowedActions],
        observedAtMs: projection.evidence.observedAtMs,
      };
    });
    if (!rejectsTaskProjectionContent(parse, fixture.contentBearingPage)) {
      throw reject(`${client} TaskProjection consumer accepted content-bearing evidence`);
    }
    return { client, sequence };
  });
  return {
    schemaVersion: "task-projection-cross-entry-conformance/v1",
    aggregate,
    sourceIdentity: await createCurrentSourceIdentity(
      aggregate.harness,
      TASK_PROJECTION_SOURCE_PATHS,
    ),
    entries,
  };
}

function rejectsTaskProjectionContent(parse, page) {
  try {
    parse(structuredClone(page));
    return false;
  } catch {
    return true;
  }
}

async function buildTaskEfficiencyEvidence(aggregate) {
  const binding = {
    agentRunId: "candidate-local-efficiency",
    conversationId: "candidate-local-efficiency",
  };
  const sourceEvents = [
    {
      version: "v1",
      seq: 1,
      timestampMs: 1_000,
      source: "conversation",
      binding,
      type: "run.started",
      payload: { status: "running" },
    },
    {
      version: "v1",
      seq: 2,
      timestampMs: 3_000,
      source: "conversation",
      binding,
      type: "run.completed",
      payload: {
        usage: {
          status: "complete",
          reason: "provider_reported_all_model_calls",
          modelCalls: 1,
          providerReportedModelCalls: 1,
        },
      },
    },
  ];
  const projectionTimeline = {
    source: "gateway_event_broker",
    coverage: "complete",
    binding,
    statusCoverage: ["blocked", "needs_input", "verifying"],
    items: [
      { status: "running", observedAtMs: 1_000 },
      { status: "needs_input", observedAtMs: 1_200 },
      { status: "running", observedAtMs: 1_400 },
      { status: "blocked", observedAtMs: 1_600 },
      { status: "running", observedAtMs: 1_800 },
      { status: "verifying", observedAtMs: 2_200 },
      { status: "completed", observedAtMs: 3_000 },
    ],
  };
  const humanInterventionEvidence = {
    source: "human_response",
    coverage: "complete",
    binding,
    count: 1,
  };
  const validation = validateCodingRunTraceEvents(
    projectCodingRunTraceEvents(sourceEvents),
    { projectionTimeline, humanInterventionEvidence },
  );
  if (validation.efficiency.status !== "complete"
    || validation.efficiency.missingMetrics.length !== 0) {
    throw reject("native task efficiency conformance is incomplete");
  }
  return {
    schemaVersion: "task-efficiency-evidence/v1",
    aggregate,
    sourceIdentity: await createCurrentSourceIdentity(
      aggregate.harness,
      TASK_EFFICIENCY_SOURCE_PATHS,
    ),
    provenance: {
      evidenceKind: "deterministic_conformance_fixture",
      candidateRunEvidence: false,
      providerCalls: 0,
    },
    status: "complete",
    evidence: {
      status: "complete",
      projectionTimeline,
      humanInterventionEvidence,
    },
    metrics: validation.efficiency,
  };
}

async function loadLocalEvidenceState({ aggregateRoot, dependencies }) {
  const referencePath = resolveInside(aggregateRoot, REFERENCE_NAME);
  const referenceText = await readBoundedRegularFile(
    referencePath,
    "dimension evidence reference",
  );
  await validateSchemaText(
    referenceText,
    REFERENCE_SCHEMA_PATH,
    "dimension evidence reference",
  );
  const reference = parseJson(referenceText, "dimension evidence reference");
  const aggregate = await loadCodingAgentCandidateCliTuiAggregateBinding(aggregateRoot);
  if (!jsonEqual(reference.aggregate, aggregate)) {
    throw reject("dimension evidence aggregate binding drifted");
  }
  const [reportText, indexText] = await Promise.all([
    readBoundedRegularFile(
      resolveInside(aggregateRoot, "benchmark-report.json"),
      "benchmark report",
    ),
    readBoundedRegularFile(
      resolveInside(aggregateRoot, "baseline-index.json"),
      "baseline index",
    ),
  ]);
  const report = parseJson(reportText, "benchmark report");
  const baselineIndex = parseJson(indexText, "baseline index");
  requireCompleteMatrix(report, baselineIndex);
  const resolveRepositoryIdentity = dependencies.resolveRepositoryIdentity
    ?? (() => resolveBenchmarkRepositoryIdentity(WORKSPACE_ROOT));
  requireExactRepositoryIdentity(await resolveRepositoryIdentity(), aggregate.harness);
  return {
    aggregateRoot,
    aggregate,
    referencePath,
    referenceText,
    reference,
    verifiedAggregate: { report, baselineIndex },
  };
}

async function requireRepositoryIdentityStillMatches(state, dependencies) {
  const resolveRepositoryIdentity = dependencies.resolveRepositoryIdentity
    ?? (() => resolveBenchmarkRepositoryIdentity(WORKSPACE_ROOT));
  requireExactRepositoryIdentity(await resolveRepositoryIdentity(), state.aggregate.harness);
}

async function requireReferenceUnchanged(referencePath, expectedText) {
  const currentText = await readBoundedRegularFile(
    referencePath,
    "dimension evidence reference",
  );
  if (currentText !== expectedText) throw reject("dimension evidence reference changed during collection");
}

async function requireTargetsAbsent(targets) {
  for (const target of targets) {
    if (await exists(target)) throw reject(`artifact already exists: ${path.basename(target)}`);
  }
}

function normalizeAuditResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || typeof value.jobId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.jobId)
    || (!Number.isSafeInteger(value.exitCode) && value.exitCode !== null)
    || (value.signal !== null && typeof value.signal !== "string")
    || typeof value.timedOut !== "boolean"
    || !Number.isSafeInteger(value.startedAtMs) || value.startedAtMs <= 0
    || !Number.isSafeInteger(value.endedAtMs) || value.endedAtMs < value.startedAtMs
    || !Number.isSafeInteger(value.timeoutMs) || value.timeoutMs <= 0) {
    throw reject("native Vitest audit result is invalid");
  }
  if (value.exitCode === 0 && (value.signal !== null || value.timedOut)) {
    throw reject("native Vitest audit terminal result is inconsistent");
  }
  return value;
}

function toCommandJobSnapshot(result) {
  return {
    jobId: result.jobId,
    status: result.exitCode === 0 ? "completed" : "failed",
    terminationReason: result.timedOut ? "timed_out" : null,
    exitCode: result.exitCode,
    signal: result.signal,
    timeoutMs: result.timeoutMs,
    deadlineAt: result.startedAtMs + result.timeoutMs,
    endedAt: result.endedAtMs,
    recovery: { lifecycle: "settled" },
  };
}

async function runNativeVitestAudit(input) {
  await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
  const startedAtMs = Date.now();
  const jobId = randomUUID();
  const child = spawn(process.execPath, [
    VITEST_ENTRY,
    "run",
    ...input.testFiles,
    "--reporter=json",
    `--outputFile=${input.outputPath}`,
  ], {
    cwd: WORKSPACE_ROOT,
    env: process.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  let timedOut = false;
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    if (stderr.length < 64 * 1024) stderr += String(chunk);
  });
  child.stdout.resume();
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, input.timeoutMs);
  const terminal = await new Promise((resolve, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  }).finally(() => clearTimeout(timeout));
  if (!(await exists(input.outputPath))) {
    const summary = stderr.trim().replaceAll(/\s+/g, " ").slice(0, 1000);
    throw reject(`native Vitest audit did not produce JSON${summary ? `: ${summary}` : ""}`);
  }
  return {
    jobId,
    exitCode: terminal.exitCode,
    signal: terminal.signal,
    timedOut,
    startedAtMs,
    endedAtMs: Date.now(),
    timeoutMs: input.timeoutMs,
  };
}

async function runNativeGitDeliveryAudit(input) {
  if (input.platform === "windows-native") return runNativeVitestAudit(input);
  if (input.platform !== "wsl2-linux" || process.platform !== "win32") {
    throw reject("dual-platform Git delivery collection must start on Windows");
  }
  await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
  const workspaceRootWsl = normalizeCandidateWslWorkspaceRoot(
    requireString(input.wslWorkspaceRoot, "WSL workspace root"),
  );
  const outputPathWsl = await resolveWslPath(input.outputPath, input.wslDistribution);
  const invocationInput = {
    distribution: input.wslDistribution,
    workspaceRootWsl,
  };
  await requireCandidateWslWorkspaceIdentity({
    ...invocationInput,
    expected: input.candidateHarness,
  });
  const startedAtMs = Date.now();
  const jobId = randomUUID();
  const invocation = createCandidateWslNodeInvocation({
    ...invocationInput,
    nodeArgs: [
      "node_modules/vitest/vitest.mjs",
      "run",
      ...input.testFiles,
      "--reporter=json",
      `--outputFile=${outputPathWsl}`,
    ],
  });
  const child = spawn(invocation.command, invocation.args, {
    cwd: WORKSPACE_ROOT,
    env: process.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  let timedOut = false;
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    if (stderr.length < 64 * 1024) stderr += String(chunk);
  });
  child.stdout.resume();
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, input.timeoutMs);
  const terminal = await new Promise((resolve, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  }).finally(() => clearTimeout(timeout));
  if (!(await exists(input.outputPath))) {
    const summary = stderr.trim().replaceAll(/\s+/g, " ").slice(0, 1000);
    throw reject(`WSL2 Git delivery audit did not produce JSON${summary ? `: ${summary}` : ""}`);
  }
  return {
    jobId,
    exitCode: terminal.exitCode,
    signal: terminal.signal,
    timedOut,
    startedAtMs,
    endedAtMs: Date.now(),
    timeoutMs: input.timeoutMs,
  };
}

async function runNativeBrowserEvidence(input) {
  const result = await runVerificationBrowserRelayFixture({
    revision: input.revision,
    chromeExecutablePath: input.chromePath,
    extensionPath: input.extensionPath,
    artifactPaths: input.relativePaths,
    viewport: {
      width: input.viewport.width,
      height: input.viewport.height,
      deviceScaleFactor: input.viewport.deviceScaleFactor,
    },
  });
  await writeVerificationBrowserRelayArtifacts(input.outputDir, result);
}

async function runNativeSupervisorSoakPair(input) {
  if (process.platform !== "win32") {
    throw reject("dual-platform Supervisor collection must start on Windows");
  }
  const [windowsReport, wslReport] = input.reports;
  const workspaceRootWsl = normalizeCandidateWslWorkspaceRoot(
    requireString(input.wslWorkspaceRoot, "WSL workspace root"),
  );
  await requireCandidateWslWorkspaceIdentity({
    distribution: input.wslDistribution,
    workspaceRootWsl,
    expected: input.candidateHarness,
  });
  await runP2ASubTaskSupervisorSoak({
    platform: windowsReport.platform,
    durationMs: input.durationMinutes * 60_000,
    cycleIntervalMs: 120_000,
    outputPath: windowsReport.outputPath,
  });
  await requireCandidateWslWorkspaceIdentity({
    distribution: input.wslDistribution,
    workspaceRootWsl,
    expected: input.candidateHarness,
  });
  const outputPathWsl = await resolveWslPath(wslReport.outputPath, input.wslDistribution);
  await runChildProcess({
    command: "wsl.exe",
    args: [
      "--distribution", input.wslDistribution,
      "--cd", workspaceRootWsl,
      "--exec", "node", "scripts/run-subtask-supervisor-soak.mjs",
      "--platform", wslReport.platform,
      "--duration-minutes", String(input.durationMinutes),
      "--cycle-interval-seconds", "120",
      "--output", outputPathWsl,
    ],
    cwd: WORKSPACE_ROOT,
    timeoutMs: (input.durationMinutes + 30) * 60_000,
    label: "WSL2 Supervisor soak",
  });
}

async function requireCandidateWslWorkspaceIdentity(input) {
  const invocation = createCandidateWslRepositoryIdentityInvocation({
    distribution: input.distribution,
    workspaceRootWsl: input.workspaceRootWsl,
  });
  const result = await runChildProcess({
    ...invocation,
    cwd: WORKSPACE_ROOT,
    timeoutMs: 60_000,
    label: "WSL2 candidate workspace identity preflight",
    captureStdout: true,
  });
  let actual;
  try {
    actual = JSON.parse(result.stdout);
  } catch {
    throw reject("WSL workspace identity probe returned invalid JSON");
  }
  assertCandidateWslWorkspaceIdentity(actual, input.expected);
}

async function resolveWslPath(value, distribution) {
  const result = await runChildProcess({
    command: "wsl.exe",
    args: ["--distribution", distribution, "--exec", "wslpath", "-a", path.resolve(value)],
    cwd: WORKSPACE_ROOT,
    timeoutMs: 60_000,
    label: "wslpath",
    captureStdout: true,
  });
  const resolved = result.stdout.trim();
  if (!resolved.startsWith("/")) throw reject("wslpath returned an invalid path");
  return resolved.replace(/\/$/, "");
}

async function runChildProcess(input) {
  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    env: process.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    if (stdout.length < 64 * 1024) stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    if (stderr.length < 64 * 1024) stderr += String(chunk);
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, input.timeoutMs);
  const terminal = await new Promise((resolve, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  }).finally(() => clearTimeout(timeout));
  if (terminal.exitCode !== 0 || terminal.signal !== null || timedOut) {
    const summary = stderr.trim().replaceAll(/\s+/g, " ").slice(0, 1000);
    throw reject(`${input.label} failed${summary ? `: ${summary}` : ""}`);
  }
  return { stdout: input.captureStdout ? stdout : "" };
}

function createVerificationReplayIdentity(harness) {
  const environmentHash = sha256([
    "coding-agent-benchmark-candidate-verification-replay-environment/v1",
    harness.commit,
    harness.lockfileSha256,
    harness.worktreeContentSha256,
  ].join("\0"));
  const inputHash = sha256([
    "coding-agent-benchmark-candidate-verification-replay-input/v1",
    VERIFICATION_REPLAY_FIXTURE_ID,
    VERIFICATION_REPLAY_NODE_ID,
    VERIFICATION_REPLAY_COMMAND,
  ].join("\0"));
  return {
    binding: { environmentHash, inputHash },
    failureFingerprint: sha256([
      "coding-agent-benchmark-candidate-verification-replay-failure/v1",
      environmentHash,
      inputHash,
      "deterministic_test_failure",
    ].join("\0")),
  };
}

async function artifactReference(aggregateRoot, relativePath) {
  const content = await fs.readFile(resolveInside(aggregateRoot, relativePath));
  return { path: relativePath, sha256: sha256(content) };
}

async function createCurrentSourceIdentity(harness, relativePaths) {
  const files = [];
  for (const relativePath of relativePaths) {
    const target = path.join(WORKSPACE_ROOT, ...relativePath.split("/"));
    const stat = await fs.lstat(target).catch(() => null);
    if (!stat || !stat.isFile() || stat.isSymbolicLink()
      || stat.size < 1 || stat.size > 16 * 1024 * 1024) {
      throw reject(`source identity file is missing or unreadable: ${relativePath}`);
    }
    files.push({ path: relativePath, sha256: sha256(await fs.readFile(target)) });
  }
  return {
    harness,
    files,
    aggregateSha256: sha256(JSON.stringify(files)),
  };
}

async function writeExclusive(target, content) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, { flag: "wx" });
}

async function collectSystemEvidence(input) {
  const artifacts = [];
  const runIds = new Set();
  const coverage = new Map();
  for (const run of input.report.runs) {
    if (!SYSTEM_TASK_IDS.includes(run?.taskId)) continue;
    const runId = requireString(run.runId, "system runId");
    if (runIds.has(runId)) throw reject("system evidence run identity is duplicated");
    runIds.add(runId);
    const coverageKey = `${run.taskId}\0${run.platform}`;
    coverage.set(coverageKey, (coverage.get(coverageKey) ?? 0) + 1);
    const relativePath = run.artifacts?.systemEvidence;
    if (!isSafeRelativePath(relativePath)) {
      throw reject("system evidence path is missing or invalid");
    }
    const evidenceText = await readBoundedRegularFile(
      resolveInside(input.aggregateRoot, relativePath),
      `system evidence ${run.runId}`,
    );
    await validateSchemaText(
      evidenceText,
      SYSTEM_EVIDENCE_SCHEMA_PATH,
      `system evidence ${run.runId}`,
    );
    artifacts.push({
      runId,
      taskId: run.taskId,
      platform: run.platform,
      path: relativePath,
      sha256: sha256(evidenceText),
    });
  }
  const expectedCoverage = SYSTEM_TASK_IDS.flatMap((taskId) => (
    PLATFORMS.map((platform) => `${taskId}\0${platform}`)
  ));
  if (artifacts.length !== 24
    || expectedCoverage.some((key) => coverage.get(key) !== 3)
    || [...coverage.keys()].some((key) => !expectedCoverage.includes(key))) {
    throw reject("system evidence coverage must contain 24 current-candidate runs");
  }
  return artifacts.sort((left, right) => left.runId.localeCompare(right.runId));
}

function requireCompleteMatrix(report, index) {
  if (report.status !== "completed"
    || !Array.isArray(report.runs)
    || report.runs.length !== 144
    || (index.status !== undefined && index.status !== "completed")
    || index.coverage?.expectedRunCount !== 144
    || index.coverage?.collectedRunCount !== 144
    || !Array.isArray(index.coverage?.missingRunKeys)
    || index.coverage.missingRunKeys.length !== 0) {
    throw reject("aggregate must retain a completed 144/144 v3 matrix");
  }
}

function requireExactRepositoryIdentity(actual, expected) {
  if (!repositoryIdentityMatches(actual, expected)) {
    throw reject("current repository identity does not match aggregate harness");
  }
}

function repositoryIdentityMatches(actual, expected) {
  const keys = ["commit", "workspaceDirty", "lockfileSha256", "worktreeContentSha256"];
  return Boolean(actual && expected
    && actual.workspaceDirty === false
    && keys.every((key) => actual[key] === expected[key]));
}

async function validateSchemaText(valueText, schemaPath, label) {
  const schema = JSON.parse(await fs.readFile(schemaPath, "utf8"));
  const compiled = compileOutputSchema(schema);
  if (!compiled.ok || !compiled.validator.validateOutput(valueText).ok) {
    throw reject(`${label} schema validation failed`);
  }
}

async function validateSchemaValue(value, schemaPath, label) {
  await validateSchemaText(JSON.stringify(value), schemaPath, label);
}

async function readBoundedRegularFile(target, label) {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()
    || stat.size < 1 || stat.size > 16 * 1024 * 1024) {
    throw reject(`${label} is missing or unreadable`);
  }
  return fs.readFile(target, "utf8");
}

function resolveInside(root, relativePath) {
  if (!isSafeRelativePath(relativePath)) throw reject("evidence path is invalid");
  const target = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)) {
    throw reject("evidence path escapes aggregate root");
  }
  return target;
}

function isSafeRelativePath(value) {
  return typeof value === "string" && value.length > 0
    && !value.includes("\\") && !value.startsWith("/") && !/^[A-Za-z]:\//.test(value)
    && !value.split("/").some((part) => !part || part === "..");
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw reject(`${label} is required`);
  return value;
}

function requireIsoTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw reject("generatedAt must be an ISO UTC timestamp");
  }
  return value;
}

function parseJson(value, label) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw reject(`${label} is invalid JSON`);
  }
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function exists(target) {
  return fs.lstat(target).then(() => true, () => false);
}

function reject(message) {
  return new Error(`Coding benchmark candidate local evidence ${message}.`);
}
