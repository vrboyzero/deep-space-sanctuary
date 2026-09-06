import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import { loadCodingRunClientCiEvidence } from "./coding-run-client-ci-evidence-loader.mjs";
import {
  hashCodingAgentBenchmarkManifestText,
  loadCodingAgentBenchmarkManifest,
} from "./coding-agent-benchmark-contract.mjs";
import { loadCodingAgentBenchmarkScorecardV3 } from "./coding-agent-benchmark-v3-contract.mjs";
import { validateCodingAgentBenchmarkV3SystemEvidence } from "./coding-agent-benchmark-v3-fixtures.mjs";
import {
  buildVerificationImpactTruthSetReport,
} from "./run-verification-impact-truth-set.mjs";
import { compareP2ASubTaskSupervisorSoakReports } from "./run-subtask-supervisor-soak.mjs";
import { loadVerificationBrowserArtifacts } from "./verification-browser-artifact-loader.mjs";
import { projectStructuredTestReport } from "./verification-test-report-adapter.mjs";
import {
  resolveCandidateCodeIntelReceiptOwner,
} from "./coding-agent-candidate-code-intel-receipt.mjs";
import {
  CODING_AGENT_CANDIDATE_CLI_TUI_CLAIMS,
  CODING_AGENT_CANDIDATE_CLI_TUI_RECEIPT_VERSION,
  resolveCandidateCliTuiReceiptOwner,
} from "./coding-agent-candidate-cli-tui-receipt.mjs";
import {
  CODING_AGENT_CANDIDATE_GIT_DELIVERY_CLAIMS,
  CODING_AGENT_CANDIDATE_GIT_DELIVERY_RECEIPT_VERSION,
  resolveCandidateGitDeliveryReceiptOwner,
} from "./coding-agent-candidate-git-delivery-receipt.mjs";

export const CODING_AGENT_CANDIDATE_DIMENSION_MAPPING_VERSION =
  "coding-agent-benchmark-candidate-dimension-mapping/v1";
export const CODING_AGENT_CANDIDATE_DIMENSION_EVIDENCE_REFERENCE_VERSION =
  "coding-agent-benchmark-candidate-dimension-evidence-reference/v1";
export const CODING_AGENT_CANDIDATE_DIMENSION_EVIDENCE_RESOLUTION_VERSION =
  "coding-agent-benchmark-candidate-dimension-evidence-resolution/v1";
export const CODING_AGENT_CANDIDATE_SUPERVISOR_EVIDENCE_RECEIPT_VERSION =
  "coding-agent-benchmark-candidate-supervisor-evidence-receipt/v1";
export const CODING_AGENT_CANDIDATE_VERIFICATION_EVIDENCE_RECEIPT_VERSION =
  "coding-agent-benchmark-candidate-verification-evidence-receipt/v1";
export const CODING_AGENT_CANDIDATE_CODING_RUN_CLIENT_EVIDENCE_RECEIPT_VERSION =
  "coding-agent-benchmark-candidate-coding-run-client-evidence-receipt/v1";
export const CODING_AGENT_CANDIDATE_CODING_RUN_CLIENT_CI_EVIDENCE_RECEIPT_VERSION =
  "coding-agent-benchmark-candidate-coding-run-client-ci-evidence-receipt/v1";
export const CODING_AGENT_CANDIDATE_CODE_INTEL_EVIDENCE_RECEIPT_VERSION =
  "coding-agent-benchmark-candidate-code-intel-evidence-receipt/v1";
export const CODING_AGENT_CANDIDATE_CLI_TUI_EVIDENCE_RECEIPT_VERSION =
  CODING_AGENT_CANDIDATE_CLI_TUI_RECEIPT_VERSION;
export const CODING_AGENT_CANDIDATE_GIT_DELIVERY_EVIDENCE_RECEIPT_VERSION =
  CODING_AGENT_CANDIDATE_GIT_DELIVERY_RECEIPT_VERSION;

const mappingPath = path.resolve(
  import.meta.dirname,
  "..",
  "benchmarks",
  "coding-agent",
  "v3",
  "candidate-dimension-mapping.json",
);

export function resolveCodingAgentCandidateDimensionMappingPath() {
  return mappingPath;
}
const mappingSchemaPath = path.resolve(
  import.meta.dirname,
  "..",
  "benchmarks",
  "coding-agent",
  "v3",
  "candidate-dimension-mapping.schema.json",
);
const evidenceReferenceSchemaPath = path.resolve(
  import.meta.dirname,
  "..",
  "benchmarks",
  "coding-agent",
  "v3",
  "candidate-dimension-evidence-reference.schema.json",
);
const systemEvidenceSchemaPath = path.resolve(
  import.meta.dirname,
  "..",
  "benchmarks",
  "coding-agent",
  "v3",
  "system-evidence.schema.json",
);
const candidateGlobalReceiptSchemaPath = path.resolve(
  import.meta.dirname,
  "..",
  "benchmarks",
  "coding-agent",
  "v3",
  "candidate-global-receipt.schema.json",
);
const candidateSupervisorReceiptSchemaPath = path.resolve(
  import.meta.dirname,
  "..",
  "benchmarks",
  "coding-agent",
  "v3",
  "candidate-supervisor-evidence-receipt.schema.json",
);
const candidateVerificationReceiptSchemaPath = path.resolve(
  import.meta.dirname,
  "..",
  "benchmarks",
  "coding-agent",
  "v3",
  "candidate-verification-evidence-receipt.schema.json",
);
const candidateCodingRunClientReceiptSchemaPath = path.resolve(
  import.meta.dirname,
  "..",
  "benchmarks",
  "coding-agent",
  "v3",
  "candidate-coding-run-client-evidence-receipt.schema.json",
);
const candidateCodingRunClientCiReceiptSchemaPath = path.resolve(
  import.meta.dirname,
  "..",
  "benchmarks",
  "coding-agent",
  "v3",
  "candidate-coding-run-client-ci-evidence-receipt.schema.json",
);
const candidateCliTuiReceiptSchemaPath = path.resolve(
  import.meta.dirname,
  "..",
  "benchmarks",
  "coding-agent",
  "v3",
  "candidate-cli-tui-evidence-receipt.schema.json",
);
const verificationImpactTruthSetReportSchemaPath = path.resolve(
  import.meta.dirname,
  "..",
  "benchmarks",
  "verification",
  "v1",
  "impact-truth-set-report.schema.json",
);
const supervisorSoakReportSchemaPath = path.resolve(
  import.meta.dirname,
  "..",
  "benchmarks",
  "supervisor",
  "v1",
  "p2a-subtask-supervisor-soak-report.schema.json",
);
const verificationDagSchemaPath = path.resolve(
  import.meta.dirname,
  "..",
  "benchmarks",
  "verification",
  "v1",
  "verification-dag.schema.json",
);
const EVIDENCE_REFERENCE_NAME = "candidate-dimension-evidence-reference.json";
const EXPECTED_SAFETY_CLAIMS = Object.freeze([
  Object.freeze({
    dimensionId: "safety_recovery",
    contractId: "system_evidence_critical_rate",
    owner: "systemEvidence",
    completion: "all_layer_c_runs_valid",
  }),
  Object.freeze({
    dimensionId: "safety_recovery",
    contractId: "candidate_sensitive_scan",
    owner: "candidateGlobalReceipt",
    completion: "completed_zero_findings",
  }),
  Object.freeze({
    dimensionId: "safety_recovery",
    contractId: "candidate_resource_sweeps",
    owner: "candidateGlobalReceipt",
    completion: "required_platforms_completed_zero_orphans",
  }),
  Object.freeze({
    dimensionId: "safety_recovery",
    contractId: "fault_matrix_audit_reconciliation",
    owner: "candidateSupervisorReceipt",
    completion: "current_harness_dual_platform_soak_and_fault_audit_passed",
  }),
]);
const EXPECTED_EDITING_TESTING_CLAIMS = Object.freeze([
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
const EXPECTED_SESSION_LONG_RUNNING_CLAIMS = Object.freeze([
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
const EXPECTED_HEADLESS_ECOSYSTEM_CLAIMS = Object.freeze([
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
const EXPECTED_HEADLESS_ECOSYSTEM_CI_CLAIM = Object.freeze({
  dimensionId: "headless_ecosystem",
  contractId: "real_ci_consumer_binding",
  owner: "candidateCodingRunClientCiReceipt",
  completion: "current_harness_dual_platform_github_actions_coding_run_client_passed",
});
const EXPECTED_CONTEXT_RETRIEVAL_CLAIMS = Object.freeze([
  Object.freeze({
    dimensionId: "context_retrieval",
    contractId: "code_intel_truth_freshness",
    owner: "candidateCodeIntelReceipt",
    completion: "current_source_dual_platform_truth_and_freshness_passed",
  }),
  Object.freeze({
    dimensionId: "context_retrieval",
    contractId: "context_inspector",
    owner: "candidateCodeIntelReceipt",
    completion: "current_harness_read_only_projection_audit_passed",
  }),
  Object.freeze({
    dimensionId: "context_retrieval",
    contractId: "code_intel_resource_soak",
    owner: "candidateCodeIntelReceipt",
    completion: "current_source_dual_platform_resource_soak_passed",
  }),
  Object.freeze({
    dimensionId: "context_retrieval",
    contractId: "semantic_adoption_context_waste",
    owner: "candidateCodeIntelReceipt",
    completion: "current_harness_semantic_adoption_and_context_waste_gate_passed",
  }),
  Object.freeze({
    dimensionId: "context_retrieval",
    contractId: "code_intel_no_binary_fallback",
    owner: "candidateCodeIntelReceipt",
    completion: "current_harness_binary_outcome_no_regression_passed",
  }),
  Object.freeze({
    dimensionId: "context_retrieval",
    contractId: "go_canary_eligibility",
    owner: "candidateCodeIntelReceipt",
    completion: "current_source_go_canary_eligibility_proven",
  }),
]);
const EXPECTED_GIT_DELIVERY_CLAIMS = CODING_AGENT_CANDIDATE_GIT_DELIVERY_CLAIMS;
const EXPECTED_CODING_RUN_CLIENT_AUDIT_COMMAND =
  "corepack pnpm verify:coding-run-client";
const EXPECTED_CODING_RUN_CLIENT_AUDIT_TEST_FILES = Object.freeze([
  "packages/belldandy-core/src/coding-run/stdio.test.ts",
  "packages/belldandy-core/src/coding-run/client.test.ts",
  "apps/vscode-extension/src/stdio-client.test.js",
  "scripts/coding-run-client-conformance.test.mjs",
  "scripts/coding-run-client-failure-conformance.test.mjs",
  "scripts/run-coding-run-client-external-consumer.test.mjs",
  "scripts/run-coding-run-client-typescript-consumer.test.mjs",
]);
const EXPECTED_CODING_RUN_CLIENT_COMMON_TEST_FILES = Object.freeze(
  EXPECTED_CODING_RUN_CLIENT_AUDIT_TEST_FILES.slice(0, 3),
);
const EXPECTED_CODING_RUN_CLIENT_CONSUMER_TEST_FILES = Object.freeze([
  ...EXPECTED_CODING_RUN_CLIENT_COMMON_TEST_FILES,
  "scripts/run-coding-run-client-external-consumer.test.mjs",
  "scripts/run-coding-run-client-typescript-consumer.test.mjs",
]);
const EXPECTED_CODING_RUN_CLIENT_PROTOCOL_TEST_FILES = Object.freeze([
  ...EXPECTED_CODING_RUN_CLIENT_COMMON_TEST_FILES,
  "scripts/coding-run-client-conformance.test.mjs",
]);
const EXPECTED_CODING_RUN_CLIENT_ERROR_TEST_FILES = Object.freeze([
  ...EXPECTED_CODING_RUN_CLIENT_COMMON_TEST_FILES,
  "scripts/coding-run-client-failure-conformance.test.mjs",
]);
const EXPECTED_VERIFICATION_AUDIT_COMMAND =
  "corepack pnpm verify:p1b-verification-audit";
const EXPECTED_VERIFICATION_FAILURE_REPLAY_COMMAND =
  "deterministic:verification-dag-reproducible-failure-v1";
const EXPECTED_VERIFICATION_FAILURE_REPLAY_FIXTURE_ID =
  "verification-dag-reproducible-failure-v1";
const EXPECTED_VERIFICATION_FAILURE_REPLAY_NODE_ID = "verification.failure-replay";
const EXPECTED_VERIFICATION_FAILURE_REPLAY_MESSAGE =
  "candidate-verification-replay:deterministic_test_failure";
const EXPECTED_VERIFICATION_AUDIT_TEST_FILES = Object.freeze([
  "scripts/run-verification-impact-truth-set.test.mjs",
  "scripts/verification-test-report-adapter.test.mjs",
  "scripts/run-verification-dag.test.mjs",
  "scripts/verification-browser-report-adapter.test.mjs",
]);
const EXPECTED_VERIFICATION_BROWSER_RUNS = Object.freeze([
  Object.freeze({ runId: "mobile", width: 375, height: 667, deviceScaleFactor: 1 }),
  Object.freeze({ runId: "tablet", width: 768, height: 1024, deviceScaleFactor: 1 }),
  Object.freeze({ runId: "desktop", width: 1440, height: 900, deviceScaleFactor: 1 }),
]);
const EXPECTED_SUPERVISOR_FAULT_AUDIT_COMMAND =
  "corepack pnpm verify:p2a-supervisor-fault-audit";
const EXPECTED_SUPERVISOR_FAULT_AUDIT_TEST_FILES = Object.freeze([
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
const EXPECTED_SUPERVISOR_CONTROL_AUDIT_TEST_FILES = Object.freeze([
  "packages/belldandy-core/src/subtask-supervisor-runtime.test.ts",
  "packages/belldandy-core/src/subtask-supervisor-control-runtime.test.ts",
  "packages/belldandy-core/src/task-runtime.test.ts",
  "packages/belldandy-core/src/bridge-subtask-runtime.test.ts",
  "packages/belldandy-core/src/coding-run/pending-tool-permission-runtime.test.ts",
  "packages/belldandy-core/src/coding-run/reconciliation-journal.test.ts",
  "packages/belldandy-skills/src/tool-behavior-contract.test.ts",
  "packages/belldandy-skills/src/tool-contract-v2.test.ts",
]);
const EXPECTED_SUPERVISOR_FAN_IN_AUDIT_TEST_FILES = Object.freeze([
  "packages/belldandy-core/src/subtask-supervisor-fan-in-runtime.test.ts",
  "packages/belldandy-core/src/subtask-supervisor-fan-in-resolution-runtime.test.ts",
  "packages/belldandy-core/src/subtask-supervisor-fan-in-process-recovery.test.ts",
  "packages/belldandy-core/src/subtask-supervisor-approval-crash-recovery.test.ts",
  "packages/belldandy-core/src/managed-worktree.test.ts",
  "packages/belldandy-core/src/worktree-runtime.test.ts",
  "packages/belldandy-skills/src/builtin/session/session-tools.test.ts",
]);
const EXPECTED_SUPERVISOR_RESOURCE_AUDIT_TEST_FILES = Object.freeze([
  "packages/belldandy-core/src/subtask-supervisor-worktree-disposal-runtime.test.ts",
  "packages/belldandy-core/src/subtask-supervisor-worktree-disposal-process-recovery.test.ts",
  "scripts/run-subtask-supervisor-soak.test.mjs",
]);
const EXPECTED_SUPERVISOR_SOAK_SOURCE_FILES = Object.freeze([
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
const EXPECTED_CONTEXT_TASK_IDS = Object.freeze({
  deterministic_context: Object.freeze([
    "rules.nested-precedence",
    "navigation.large-repository",
  ]),
  // real-go.public-api-migration 为用户授权的独立受控 canary lane：
  // 在矩阵中照常执行并保留原始结果，但不进入本组的任务完成率分母。
  real_repository_context: Object.freeze([
    "real-ts.api-migration",
    "real-ts.cross-package-refactor",
    "real-js.bug-fix",
    "real-js.failed-test-fix",
    "real-go.bug-fix",
    "real-web.ui-regression",
    "real-web.dependency-diagnosis",
  ]),
  parallel_context: Object.freeze([
    "system.parallel-read-isolation",
  ]),
});
const EXPECTED_EDITING_TASK_IDS = Object.freeze({
  deterministic_editing: Object.freeze([
    "feature.cross-file",
    "bug.reproducible-fix",
    "tests.failed-diagnosis",
  ]),
  real_repository_editing: EXPECTED_CONTEXT_TASK_IDS.real_repository_context,
});
const EXPECTED_CLI_TASK_IDS = Object.freeze({
  interactive_cli: Object.freeze(["command.interactive-control"]),
});
const EXPECTED_SAFETY_TASK_IDS = Object.freeze({
  safety_boundary: Object.freeze(["safety.boundary-enforcement"]),
  disconnect_recovery: Object.freeze(["gateway.disconnect-recovery"]),
});
const EXPECTED_SESSION_TASK_IDS = Object.freeze({
  session_control: Object.freeze([
    "gateway.disconnect-recovery",
    "gateway.client-cancel",
    "gateway.process-restart",
  ]),
  parallel_long_running: Object.freeze([
    "system.parallel-read-isolation",
    "system.parallel-write-fan-in",
    "system.restart-delivery-reconciliation",
  ]),
});
const EXPECTED_HEADLESS_TASK_IDS = Object.freeze({
  headless_browser_workflow: Object.freeze(["system.browser-behavior"]),
});
const EXPECTED_GIT_TASK_IDS = Object.freeze({
  local_git_boundaries: Object.freeze([
    "git.dirty-worktree",
    "git.delivery-guard",
  ]),
  delivery_reconciliation: Object.freeze([
    "system.parallel-write-fan-in",
    "system.restart-delivery-reconciliation",
  ]),
});

export async function loadCodingAgentCandidateDimensionMapping(input) {
  const manifest = requireObject(input?.manifest, "manifest");
  const scorecard = requireObject(input?.scorecard, "scorecard");
  const resolvedMappingPath = input?.mappingPath === undefined
    ? mappingPath
    : path.resolve(requireString(input.mappingPath, "mappingPath"));
  const [mapping, schema] = await Promise.all([
    readJson(resolvedMappingPath, "mapping"),
    readJson(mappingSchemaPath, "mapping schema"),
  ]);
  if (mapping?.schemaVersion !== CODING_AGENT_CANDIDATE_DIMENSION_MAPPING_VERSION) {
    throw new Error("Coding benchmark candidate dimension mapping version drifted.");
  }
  const compiled = compileOutputSchema(schema);
  if (!compiled.ok) {
    throw new Error("Coding benchmark candidate dimension mapping schema is invalid.");
  }
  if (!compiled.validator.validateOutput(JSON.stringify(mapping)).ok) {
    throw new Error("Coding benchmark candidate dimension mapping does not match its schema.");
  }
  validateMappingBindings(mapping, manifest, scorecard);
  return mapping;
}

export async function loadCodingAgentCandidateDimensionEvidence(input) {
  const aggregateRoot = path.resolve(requireString(input?.aggregateRoot, "aggregateRoot"));
  const verifiedAggregate = requireObject(input?.verifiedAggregate, "verifiedAggregate");
  const suppliedReport = requireObject(verifiedAggregate.report, "verifiedAggregate.report");
  const suppliedBaselineIndex = requireObject(
    verifiedAggregate.baselineIndex,
    "verifiedAggregate.baselineIndex",
  );
  const manifestPath = path.join(aggregateRoot, "task-manifest.json");
  const reportPath = path.join(aggregateRoot, "benchmark-report.json");
  const indexPath = path.join(aggregateRoot, "baseline-index.json");
  const referencePath = path.join(aggregateRoot, EVIDENCE_REFERENCE_NAME);
  const [
    manifestText,
    manifest,
    reportText,
    indexText,
    referenceText,
    scorecard,
  ] = await Promise.all([
    readBoundedRegularFile(manifestPath, 4 * 1024 * 1024, "task manifest"),
    loadCodingAgentBenchmarkManifest(manifestPath),
    readBoundedRegularFile(reportPath, 64 * 1024 * 1024, "benchmark report"),
    readBoundedRegularFile(indexPath, 16 * 1024 * 1024, "baseline index"),
    readOptionalBoundedRegularFile(referencePath, 4 * 1024 * 1024, "evidence reference"),
    loadCodingAgentBenchmarkScorecardV3(),
  ]);
  const report = parseJson(reportText, "benchmark report");
  const baselineIndex = parseJson(indexText, "baseline index");
  if (JSON.stringify(report) !== JSON.stringify(suppliedReport)
    || JSON.stringify(baselineIndex) !== JSON.stringify(suppliedBaselineIndex)) {
    throw new Error("Coding benchmark candidate dimension evidence verified aggregate drifted.");
  }
  const mapping = await loadCodingAgentCandidateDimensionMapping({ manifest, scorecard });
  const expectedAggregateBinding = {
    manifestSha256: hashCodingAgentBenchmarkManifestText(manifestText),
    reportSha256: sha256(reportText),
    indexSha256: sha256(indexText),
    source: report.source,
    harness: report.harness,
  };
  if (baselineIndex.manifestSha256 !== expectedAggregateBinding.manifestSha256
    || baselineIndex.report?.sha256 !== expectedAggregateBinding.reportSha256
    || report.suite?.manifestSha256 !== expectedAggregateBinding.manifestSha256) {
    throw new Error("Coding benchmark candidate dimension evidence aggregate binding drifted.");
  }
  if (referenceText === null) {
    return createDimensionEvidenceResolution(mapping, [], new Map());
  }
  const reference = parseJson(referenceText, "evidence reference");
  if (reference?.schemaVersion !== CODING_AGENT_CANDIDATE_DIMENSION_EVIDENCE_REFERENCE_VERSION) {
    throw new Error("Coding benchmark candidate dimension evidence reference version drifted.");
  }
  await validateJsonAgainstSchema({
    valueText: referenceText,
    schemaPath: evidenceReferenceSchemaPath,
    label: "evidence reference",
  });
  requireExactDimensionClaims(reference);
  if (JSON.stringify(reference.aggregate) !== JSON.stringify(expectedAggregateBinding)) {
    throw new Error("Coding benchmark candidate dimension evidence aggregate binding drifted.");
  }

  const completedContracts = new Map();
  completedContracts.set(
    "system_evidence_critical_rate",
    await resolveSystemEvidenceOwner({
      aggregateRoot,
      manifest,
      report,
      owner: reference.owners.systemEvidence,
    }),
  );
  const candidateGlobalReceipt = await resolveCandidateGlobalReceiptOwner({
    aggregateRoot,
    expectedAggregateBinding,
    owner: reference.owners.candidateGlobalReceipt,
  });
  completedContracts.set(
    "candidate_sensitive_scan",
    candidateGlobalReceipt.sensitiveScan.status === "completed"
      && candidateGlobalReceipt.sensitiveScan.unreadableFileCount === 0
      && candidateGlobalReceipt.sensitiveScan.findingCount === 0,
  );
  completedContracts.set(
    "candidate_resource_sweeps",
    candidateGlobalReceipt.resourceSweeps.length === 2
      && candidateGlobalReceipt.resourceSweeps.every((sweep) => {
        return sweep.status === "completed"
          && sweep.orphanResourceCount === 0
          && sweep.remainingListenerCount === 0
          && sweep.remainingOwnedProcessCount === 0
          && sweep.remainingRuntimeMarkerCount === 0
          && sweep.remainingRuntimeEnvFileCount === 0;
      }),
  );
  if (reference.owners.candidateSupervisorReceipt !== undefined) {
    const supervisorCompletion = await resolveCandidateSupervisorReceiptOwner({
      aggregateRoot,
      expectedAggregateBinding,
      owner: reference.owners.candidateSupervisorReceipt,
    });
    for (const [contractId, complete] of Object.entries(supervisorCompletion)) {
      completedContracts.set(contractId, complete);
    }
  }
  if (reference.owners.candidateVerificationReceipt !== undefined) {
    const verificationCompletion = await resolveCandidateVerificationReceiptOwner({
      aggregateRoot,
      expectedAggregateBinding,
      owner: reference.owners.candidateVerificationReceipt,
    });
    for (const [contractId, complete] of Object.entries(verificationCompletion)) {
      completedContracts.set(contractId, complete);
    }
  }
  if (reference.owners.candidateCodingRunClientReceipt !== undefined) {
    const codingRunClientCompletion = await resolveCandidateCodingRunClientReceiptOwner({
      aggregateRoot,
      expectedAggregateBinding,
      owner: reference.owners.candidateCodingRunClientReceipt,
    });
    for (const [contractId, complete] of Object.entries(codingRunClientCompletion)) {
      completedContracts.set(contractId, complete);
    }
  }
  if (reference.owners.candidateCodingRunClientCiReceipt !== undefined) {
    const codingRunClientCiCompletion = await validateCandidateCodingRunClientCiReceiptOwner({
      aggregateRoot,
      expectedAggregateBinding,
      owner: reference.owners.candidateCodingRunClientCiReceipt,
    });
    completedContracts.set(
      "real_ci_consumer_binding",
      codingRunClientCiCompletion.complete,
    );
  }
  if (reference.owners.candidateCodeIntelReceipt !== undefined) {
    const codeIntelCompletion = await resolveCandidateCodeIntelReceiptOwner({
      aggregateRoot,
      expectedAggregateBinding,
      owner: reference.owners.candidateCodeIntelReceipt,
    });
    for (const [contractId, complete] of Object.entries(codeIntelCompletion)) {
      completedContracts.set(contractId, complete);
    }
  }
  if (reference.owners.candidateCliTuiReceipt !== undefined) {
    const cliTuiCompletion = await resolveCandidateCliTuiReceiptOwner({
      aggregateRoot,
      expectedAggregateBinding,
      owner: reference.owners.candidateCliTuiReceipt,
    });
    for (const [contractId, complete] of Object.entries(cliTuiCompletion)) {
      completedContracts.set(contractId, complete);
    }
  }
  if (reference.owners.candidateGitDeliveryReceipt !== undefined) {
    const gitDeliveryCompletion = await resolveCandidateGitDeliveryReceiptOwner({
      aggregateRoot,
      expectedAggregateBinding,
      owner: reference.owners.candidateGitDeliveryReceipt,
    });
    for (const [contractId, complete] of Object.entries(gitDeliveryCompletion)) {
      completedContracts.set(contractId, complete);
    }
  }

  return createDimensionEvidenceResolution(mapping, reference.claims, completedContracts);
}

function createDimensionEvidenceResolution(mapping, claims, completedContracts) {
  const dimensions = mapping.dimensions.map((dimension) => {
    const dimensionClaims = claims.filter(
      ({ dimensionId }) => dimensionId === dimension.id,
    );
    const resolvedEvidenceContracts = dimensionClaims
      .filter(({ contractId }) => completedContracts.get(contractId) === true)
      .map((claim) => ({
        id: claim.contractId,
        owner: claim.owner,
        completion: claim.completion,
        status: "complete",
      }));
    const failedEvidenceContracts = dimensionClaims
      .filter(({ contractId }) => completedContracts.get(contractId) === false)
      .map((claim) => ({
        id: claim.contractId,
        owner: claim.owner,
        completion: claim.completion,
        status: "failed",
      }));
    const completedIds = new Set(resolvedEvidenceContracts.map(({ id }) => id));
    const failedIds = new Set(failedEvidenceContracts.map(({ id }) => id));
    const missingEvidenceContracts = dimension.missingEvidenceContracts.filter(
      (contractId) => !completedIds.has(contractId) && !failedIds.has(contractId),
    );
    return {
      id: dimension.id,
      status: failedEvidenceContracts.length > 0
        ? "failed"
        : missingEvidenceContracts.length === 0 ? "complete" : "partial",
      resolvedEvidenceContracts,
      ...(failedEvidenceContracts.length > 0 ? { failedEvidenceContracts } : {}),
      missingEvidenceContracts,
    };
  });
  return {
    schemaVersion: CODING_AGENT_CANDIDATE_DIMENSION_EVIDENCE_RESOLUTION_VERSION,
    status: dimensions.some(({ status }) => status === "failed")
      ? "failed"
      : dimensions.every(({ status }) => status === "complete") ? "complete" : "partial",
    dimensions,
  };
}

async function resolveSystemEvidenceOwner(input) {
  const tasks = new Map(input.manifest.tasks.map((task) => [task.id, task]));
  const expectedRuns = input.report.runs
    .filter((run) => tasks.get(run.taskId)?.layer === "C")
    .sort((left, right) => left.runId.localeCompare(right.runId));
  const references = input.owner.artifacts;
  if (references.length !== expectedRuns.length) {
    throw new Error("Coding benchmark candidate dimension system evidence coverage drifted.");
  }
  const systemEvidenceSchema = await loadCompiledSchemaValidator(
    systemEvidenceSchemaPath,
    "system evidence",
  );
  for (let index = 0; index < expectedRuns.length; index += 1) {
    const run = expectedRuns[index];
    const reference = references[index];
    if (reference.runId !== run.runId
      || reference.taskId !== run.taskId
      || reference.platform !== run.platform
      || reference.path !== run.artifacts?.systemEvidence) {
      throw new Error("Coding benchmark candidate dimension system evidence reference drifted.");
    }
    const evidenceText = await readBoundedRegularFile(
      resolveInside(input.aggregateRoot, reference.path),
      4 * 1024 * 1024,
      `system evidence ${run.runId}`,
    );
    if (sha256(evidenceText) !== reference.sha256
      || !systemEvidenceSchema.validateOutput(evidenceText).ok) {
      throw new Error("Coding benchmark candidate dimension system evidence digest or schema drifted.");
    }
    const evidence = parseJson(evidenceText, `system evidence ${run.runId}`);
    requireSystemEvidenceBinding({
      evidence,
      task: tasks.get(run.taskId),
      run,
    });
    const failures = validateCodingAgentBenchmarkV3SystemEvidence({
      evidence,
      task: tasks.get(run.taskId),
      runId: run.runId,
      platform: run.platform,
    });
    if (failures.length > 0) return false;
  }
  return expectedRuns.length > 0;
}

function requireSystemEvidenceBinding(input) {
  if (input.evidence.taskId !== input.run.taskId
    || input.evidence.generatorId !== input.task.fixture.generatorId
    || input.evidence.fixtureVersion !== input.task.fixture.version
    || input.evidence.runId !== input.run.runId
    || input.evidence.platform !== input.run.platform) {
    throw new Error("Coding benchmark candidate dimension system evidence binding drifted.");
  }
}

async function resolveCandidateGlobalReceiptOwner(input) {
  const reference = input.owner.artifact;
  const receiptText = await readBoundedRegularFile(
    resolveInside(input.aggregateRoot, reference.path),
    1024 * 1024,
    "candidate-global receipt",
  );
  if (sha256(receiptText) !== reference.sha256) {
    throw new Error("Coding benchmark candidate dimension candidate-global receipt digest drifted.");
  }
  await validateJsonAgainstSchema({
    valueText: receiptText,
    schemaPath: candidateGlobalReceiptSchemaPath,
    label: "candidate-global receipt",
  });
  const receipt = parseJson(receiptText, "candidate-global receipt");
  if (JSON.stringify(receipt.aggregate) !== JSON.stringify(input.expectedAggregateBinding)) {
    throw new Error("Coding benchmark candidate dimension candidate-global receipt binding drifted.");
  }
  return receipt;
}

async function resolveCandidateCodingRunClientReceiptOwner(input) {
  const reference = input.owner.artifact;
  const receiptText = await readBoundedRegularFile(
    resolveInside(input.aggregateRoot, reference.path),
    4 * 1024 * 1024,
    "candidate coding-run client receipt",
  );
  if (sha256(receiptText) !== reference.sha256) {
    throw new Error(
      "Coding benchmark candidate dimension candidate coding-run client receipt digest drifted.",
    );
  }
  await validateJsonAgainstSchema({
    valueText: receiptText,
    schemaPath: candidateCodingRunClientReceiptSchemaPath,
    label: "candidate coding-run client receipt",
  });
  const receipt = parseJson(receiptText, "candidate coding-run client receipt");
  if (JSON.stringify(receipt.aggregate) !== JSON.stringify(input.expectedAggregateBinding)) {
    throw new Error(
      "Coding benchmark candidate dimension candidate coding-run client receipt binding drifted.",
    );
  }

  const audit = await resolveCandidateCodingRunClientAudit({
    aggregateRoot: input.aggregateRoot,
    harness: input.expectedAggregateBinding.harness,
    audit: receipt.audit,
  });
  return {
    external_consumer_pair_lifecycle: areCandidateCodingRunClientAuditFilesComplete(
      audit.report,
      EXPECTED_CODING_RUN_CLIENT_CONSUMER_TEST_FILES,
    ),
    protocol_version_conformance: areCandidateCodingRunClientAuditFilesComplete(
      audit.report,
      EXPECTED_CODING_RUN_CLIENT_PROTOCOL_TEST_FILES,
    ),
    error_taxonomy_cancellation_conformance: areCandidateCodingRunClientAuditFilesComplete(
      audit.report,
      EXPECTED_CODING_RUN_CLIENT_ERROR_TEST_FILES,
    ),
  };
}

async function validateCandidateCodingRunClientCiReceiptOwner(input) {
  const reference = input.owner.artifact;
  const receiptText = await readBoundedRegularFile(
    resolveInside(input.aggregateRoot, reference.path),
    4 * 1024 * 1024,
    "candidate coding-run client CI receipt",
  );
  if (sha256(receiptText) !== reference.sha256) {
    throw new Error(
      "Coding benchmark candidate dimension candidate coding-run client CI receipt digest drifted.",
    );
  }
  await validateJsonAgainstSchema({
    valueText: receiptText,
    schemaPath: candidateCodingRunClientCiReceiptSchemaPath,
    label: "candidate coding-run client CI receipt",
  });
  const receipt = parseJson(receiptText, "candidate coding-run client CI receipt");
  if (JSON.stringify(receipt.aggregate) !== JSON.stringify(input.expectedAggregateBinding)) {
    throw new Error(
      "Coding benchmark candidate dimension candidate coding-run client CI receipt binding drifted.",
    );
  }
  return await loadCodingRunClientCiEvidence({
    aggregateRoot: input.aggregateRoot,
    receipt,
    expectedHarness: input.expectedAggregateBinding.harness,
  });
}

async function resolveCandidateCodingRunClientAudit(input) {
  const dagReference = input.audit.verificationDag;
  const reportReference = input.audit.nativeTestReport;
  const [dagText, reportText] = await Promise.all([
    readBoundedRegularFile(
      resolveInside(input.aggregateRoot, dagReference.path),
      4 * 1024 * 1024,
      "candidate coding-run client audit Verification DAG",
    ),
    readBoundedRegularFile(
      resolveInside(input.aggregateRoot, reportReference.path),
      4 * 1024 * 1024,
      "candidate coding-run client audit native test report",
    ),
  ]);
  if (sha256(dagText) !== dagReference.sha256
    || sha256(reportText) !== reportReference.sha256) {
    throw new Error(
      "Coding benchmark candidate dimension candidate coding-run client audit digest drifted.",
    );
  }
  await validateJsonAgainstSchema({
    valueText: dagText,
    schemaPath: verificationDagSchemaPath,
    label: "candidate coding-run client audit Verification DAG",
  });
  const dag = parseJson(dagText, "candidate coding-run client audit Verification DAG");
  const projectedReport = projectStructuredTestReport({
    framework: reportReference.framework,
    format: reportReference.format,
    runnerVersion: reportReference.runnerVersion,
    artifact: { path: reportReference.path, sha256: reportReference.sha256 },
    content: reportText,
  });
  const report = parseJson(reportText, "candidate coding-run client audit native test report");
  requireCandidateCodingRunClientAuditBinding({
    dag,
    harness: input.harness,
    projectedReport,
    report,
    expectedTestFiles: input.audit.testFiles,
  });
  requireCandidateCodingRunClientAuditTerminalBinding({ dag, projectedReport });
  return { dag, projectedReport, report };
}

function requireCandidateCodingRunClientAuditBinding(input) {
  const [node] = input.dag.nodes;
  const [attempt] = node?.attempts ?? [];
  if (input.dag.revision?.commit !== input.harness.commit
    || input.dag.revision?.workspaceHash !== input.harness.worktreeContentSha256
    || input.dag.runId !== "candidate-coding-run-client-audit"
    || input.dag.taskId !== "p2c-coding-run-client-audit"
    || input.dag.nodes.length !== 1
    || node.id !== "coding-run-client.audit"
    || node.kind !== "acceptance"
    || node.scope !== "full"
    || node.required !== true
    || node.command !== EXPECTED_CODING_RUN_CLIENT_AUDIT_COMMAND
    || node.dependsOn.length !== 0
    || node.attempts.length !== 1
    || JSON.stringify(attempt?.testReport) !== JSON.stringify(input.projectedReport.evidence)
    || JSON.stringify(input.expectedTestFiles)
      !== JSON.stringify(EXPECTED_CODING_RUN_CLIENT_AUDIT_TEST_FILES)
    || input.dag.execution?.commandsExecuted !== false
    || input.dag.execution?.providerCalls !== 0
    || input.dag.execution?.mutationCount !== 0
    || input.dag.execution?.replay?.authority !== "command-job"
    || input.dag.execution?.replay?.source !== "terminal-snapshot"
    || input.dag.execution?.replay?.snapshotCount !== 1
    || input.dag.execution?.replay?.terminalOnly !== true
    || input.dag.execution?.replay?.testReportCount !== 1) {
    throw new Error(
      "Coding benchmark candidate dimension candidate coding-run client audit binding drifted.",
    );
  }
  const selectedTestFiles = input.report.testResults.map((result) => {
    const normalized = typeof result?.name === "string"
      ? result.name.replaceAll("\\", "/")
      : "";
    return EXPECTED_CODING_RUN_CLIENT_AUDIT_TEST_FILES.find(
      (testFile) => normalized === testFile || normalized.endsWith(`/${testFile}`),
    ) ?? null;
  });
  if (selectedTestFiles.some((testFile) => testFile === null)
    || new Set(selectedTestFiles).size !== EXPECTED_CODING_RUN_CLIENT_AUDIT_TEST_FILES.length
    || JSON.stringify([...selectedTestFiles].sort())
      !== JSON.stringify([...EXPECTED_CODING_RUN_CLIENT_AUDIT_TEST_FILES].sort())) {
    throw new Error(
      "Coding benchmark candidate dimension candidate coding-run client audit test selection drifted.",
    );
  }
}

function areCandidateCodingRunClientAuditFilesComplete(report, expectedTestFiles) {
  const resultsByFile = new Map(report.testResults.map((result) => {
    const normalized = typeof result?.name === "string"
      ? result.name.replaceAll("\\", "/")
      : "";
    const relativePath = EXPECTED_CODING_RUN_CLIENT_AUDIT_TEST_FILES.find(
      (testFile) => normalized === testFile || normalized.endsWith(`/${testFile}`),
    );
    return [relativePath, result];
  }));
  return expectedTestFiles.every((testFile) => {
    const result = resultsByFile.get(testFile);
    return result?.status === "passed"
      && result.assertionResults.length > 0
      && result.assertionResults.every(({ status }) => status === "passed");
  });
}

function requireCandidateCodingRunClientAuditTerminalBinding(input) {
  const [node] = input.dag.nodes;
  const [attempt] = node.attempts;
  const commandJob = attempt.commandJob;
  const outcome = input.dag.outcome;
  const passed = input.projectedReport.status === "passed"
    && node.status === "passed"
    && attempt.status === "passed"
    && commandJob?.status === "completed"
    && commandJob?.exit?.taxonomy === "zero_exit"
    && commandJob?.exit?.exitCode === 0
    && commandJob?.exit?.signal === null
    && commandJob?.recoveryLifecycle === "settled"
    && outcome?.taskStatus === "completed"
    && outcome?.verificationStatus === "passed"
    && outcome?.reason === "all_required_passed"
    && outcome?.firstFailureNodeId === null;
  const failed = input.projectedReport.status === "failed"
    && node.status === "failed"
    && attempt.status === "failed"
    && commandJob?.status === "failed"
    && commandJob?.exit?.taxonomy === "non_zero_exit"
    && Number.isSafeInteger(commandJob?.exit?.exitCode)
    && commandJob.exit.exitCode > 0
    && commandJob?.exit?.signal === null
    && commandJob?.recoveryLifecycle === "settled"
    && outcome?.taskStatus === "verification_failed"
    && outcome?.verificationStatus === "failed"
    && outcome?.reason === "required_failure"
    && outcome?.firstFailureNodeId === node.id;
  if (!passed && !failed) {
    throw new Error(
      "Coding benchmark candidate dimension candidate coding-run client audit terminal binding drifted.",
    );
  }
}

async function resolveCandidateVerificationReceiptOwner(input) {
  const reference = input.owner.artifact;
  const receiptText = await readBoundedRegularFile(
    resolveInside(input.aggregateRoot, reference.path),
    4 * 1024 * 1024,
    "candidate Verification receipt",
  );
  if (sha256(receiptText) !== reference.sha256) {
    throw new Error("Coding benchmark candidate dimension candidate Verification receipt digest drifted.");
  }
  await validateJsonAgainstSchema({
    valueText: receiptText,
    schemaPath: candidateVerificationReceiptSchemaPath,
    label: "candidate Verification receipt",
  });
  const receipt = parseJson(receiptText, "candidate Verification receipt");
  if (JSON.stringify(receipt.aggregate) !== JSON.stringify(input.expectedAggregateBinding)) {
    throw new Error("Coding benchmark candidate dimension candidate Verification receipt binding drifted.");
  }

  const [impactTruthSet, structuredTestReports, failureReplay, browserRelay] = await Promise.all([
    resolveCandidateVerificationImpactTruthSet({
      aggregateRoot: input.aggregateRoot,
      reference: receipt.impactTruthSet,
    }),
    resolveCandidateVerificationStructuredTestAudit({
      aggregateRoot: input.aggregateRoot,
      harness: input.expectedAggregateBinding.harness,
      audit: receipt.structuredTestAudit,
    }),
    resolveCandidateVerificationFailureReplay({
      aggregateRoot: input.aggregateRoot,
      harness: input.expectedAggregateBinding.harness,
      failureReplay: receipt.failureReplay,
    }),
    resolveCandidateVerificationBrowserRelay({
      aggregateRoot: input.aggregateRoot,
      harness: input.expectedAggregateBinding.harness,
      browserRelay: receipt.browserRelay,
    }),
  ]);
  return {
    verification_impact_truth_set: impactTruthSet,
    verification_structured_test_reports: structuredTestReports,
    verification_failure_replay: failureReplay,
    browser_relay_behavior_evidence: browserRelay,
  };
}

async function resolveCandidateVerificationImpactTruthSet(input) {
  const reportText = await readBoundedRegularFile(
    resolveInside(input.aggregateRoot, input.reference.path),
    4 * 1024 * 1024,
    "candidate Verification impact truth-set report",
  );
  if (sha256(reportText) !== input.reference.sha256) {
    throw new Error(
      "Coding benchmark candidate dimension candidate Verification impact truth-set digest drifted.",
    );
  }
  await validateJsonAgainstSchema({
    valueText: reportText,
    schemaPath: verificationImpactTruthSetReportSchemaPath,
    label: "candidate Verification impact truth-set report",
  });
  const report = parseJson(reportText, "candidate Verification impact truth-set report");
  const expected = await buildVerificationImpactTruthSetReport({ generatedAt: report.generatedAt });
  if (JSON.stringify(report) !== JSON.stringify(expected)) {
    throw new Error(
      "Coding benchmark candidate dimension candidate Verification impact truth-set binding drifted.",
    );
  }
  return report.gate.passed === true
    && report.gate.failures.length === 0
    && report.metrics.passed === true
    && report.metrics.expected === 24
    && report.metrics.truePositive === 24
    && report.metrics.falsePositive === 0
    && report.metrics.falseNegative === 0
    && report.metrics.precision === 1
    && report.metrics.recall === 1
    && report.metrics.exactCaseRate === 1
    && report.cases.length === 8
    && report.cases.every((testCase) => testCase.status === "passed");
}

async function resolveCandidateVerificationStructuredTestAudit(input) {
  const dagReference = input.audit.verificationDag;
  const reportReference = input.audit.nativeTestReport;
  const [dagText, reportText] = await Promise.all([
    readBoundedRegularFile(
      resolveInside(input.aggregateRoot, dagReference.path),
      4 * 1024 * 1024,
      "candidate Verification structured-test DAG",
    ),
    readBoundedRegularFile(
      resolveInside(input.aggregateRoot, reportReference.path),
      4 * 1024 * 1024,
      "candidate Verification native test report",
    ),
  ]);
  if (sha256(dagText) !== dagReference.sha256
    || sha256(reportText) !== reportReference.sha256) {
    throw new Error(
      "Coding benchmark candidate dimension candidate Verification structured-test digest drifted.",
    );
  }
  await validateJsonAgainstSchema({
    valueText: dagText,
    schemaPath: verificationDagSchemaPath,
    label: "candidate Verification structured-test DAG",
  });
  const dag = parseJson(dagText, "candidate Verification structured-test DAG");
  const projectedReport = projectStructuredTestReport({
    framework: reportReference.framework,
    format: reportReference.format,
    runnerVersion: reportReference.runnerVersion,
    artifact: { path: reportReference.path, sha256: reportReference.sha256 },
    content: reportText,
  });
  requireCandidateVerificationStructuredTestBinding({
    dag,
    harness: input.harness,
    projectedReport,
    reportText,
    expectedTestFiles: input.audit.testFiles,
  });
  return isCandidateVerificationStructuredTestComplete(dag, projectedReport);
}

function requireCandidateVerificationStructuredTestBinding(input) {
  const [node] = input.dag.nodes;
  const [attempt] = node?.attempts ?? [];
  if (input.dag.revision?.commit !== input.harness.commit
    || input.dag.revision?.workspaceHash !== input.harness.worktreeContentSha256
    || input.dag.nodes.length !== 1
    || node.id !== "verification.structured-test-audit"
    || node.kind !== "acceptance"
    || node.scope !== "full"
    || node.required !== true
    || node.command !== EXPECTED_VERIFICATION_AUDIT_COMMAND
    || node.dependsOn.length !== 0
    || node.attempts.length !== 1
    || JSON.stringify(attempt?.testReport) !== JSON.stringify(input.projectedReport.evidence)
    || JSON.stringify(input.expectedTestFiles)
      !== JSON.stringify(EXPECTED_VERIFICATION_AUDIT_TEST_FILES)
    || input.dag.execution?.commandsExecuted !== false
    || input.dag.execution?.providerCalls !== 0
    || input.dag.execution?.mutationCount !== 0
    || input.dag.execution?.replay?.authority !== "command-job"
    || input.dag.execution?.replay?.source !== "terminal-snapshot"
    || input.dag.execution?.replay?.snapshotCount !== 1
    || input.dag.execution?.replay?.terminalOnly !== true
    || input.dag.execution?.replay?.testReportCount !== 1) {
    throw new Error(
      "Coding benchmark candidate dimension candidate Verification structured-test binding drifted.",
    );
  }
  const report = parseJson(input.reportText, "candidate Verification native test report");
  const selectedTestFiles = report.testResults.map((result) => {
    const normalized = typeof result?.name === "string"
      ? result.name.replaceAll("\\", "/")
      : "";
    return EXPECTED_VERIFICATION_AUDIT_TEST_FILES.find(
      (testFile) => normalized === testFile || normalized.endsWith(`/${testFile}`),
    ) ?? null;
  });
  if (selectedTestFiles.some((testFile) => testFile === null)
    || new Set(selectedTestFiles).size !== EXPECTED_VERIFICATION_AUDIT_TEST_FILES.length
    || JSON.stringify([...selectedTestFiles].sort())
      !== JSON.stringify([...EXPECTED_VERIFICATION_AUDIT_TEST_FILES].sort())) {
    throw new Error(
      "Coding benchmark candidate dimension candidate Verification structured-test selection drifted.",
    );
  }
}

function isCandidateVerificationStructuredTestComplete(dag, projectedReport) {
  const [node] = dag.nodes;
  const [attempt] = node.attempts;
  return projectedReport.status === "passed"
    && projectedReport.evidence.groups.total === EXPECTED_VERIFICATION_AUDIT_TEST_FILES.length
    && projectedReport.evidence.groups.passed === EXPECTED_VERIFICATION_AUDIT_TEST_FILES.length
    && projectedReport.evidence.groups.failed === 0
    && projectedReport.evidence.groups.skipped === 0
    && projectedReport.evidence.tests.total > 0
    && projectedReport.evidence.tests.passed === projectedReport.evidence.tests.total
    && projectedReport.evidence.tests.failed === 0
    && projectedReport.evidence.tests.skipped === 0
    && projectedReport.evidence.tests.todo === 0
    && node.status === "passed"
    && attempt.status === "passed"
    && attempt.commandJob?.status === "completed"
    && attempt.commandJob?.exit?.taxonomy === "zero_exit"
    && attempt.commandJob?.exit?.exitCode === 0
    && attempt.commandJob?.exit?.signal === null
    && attempt.commandJob?.recoveryLifecycle === "settled"
    && dag.outcome?.taskStatus === "completed"
    && dag.outcome?.verificationStatus === "passed"
    && dag.outcome?.reason === "all_required_passed"
    && dag.outcome?.firstFailureNodeId === null;
}

async function resolveCandidateVerificationFailureReplay(input) {
  const reference = input.failureReplay.verificationDag;
  const dagText = await readBoundedRegularFile(
    resolveInside(input.aggregateRoot, reference.path),
    4 * 1024 * 1024,
    "candidate Verification failure-replay DAG",
  );
  if (sha256(dagText) !== reference.sha256) {
    throw new Error(
      "Coding benchmark candidate dimension candidate Verification failure-replay digest drifted.",
    );
  }
  await validateJsonAgainstSchema({
    valueText: dagText,
    schemaPath: verificationDagSchemaPath,
    label: "candidate Verification failure-replay DAG",
  });
  const dag = parseJson(dagText, "candidate Verification failure-replay DAG");
  const [node] = dag.nodes;
  const expectedReplayIdentity = createCandidateVerificationReplayIdentity(input.harness);
  if (dag.revision?.commit !== input.harness.commit
    || dag.revision?.workspaceHash !== input.harness.worktreeContentSha256
    || dag.runId !== "candidate-verification-failure-replay"
    || dag.taskId !== "p2c-verification-failure-replay"
    || dag.nodes.length !== 1
    || input.failureReplay.fixtureId !== EXPECTED_VERIFICATION_FAILURE_REPLAY_FIXTURE_ID
    || node.id !== input.failureReplay.nodeId
    || node.id !== EXPECTED_VERIFICATION_FAILURE_REPLAY_NODE_ID
    || node.kind !== "acceptance"
    || node.scope !== "full"
    || node.required !== true
    || node.command !== EXPECTED_VERIFICATION_FAILURE_REPLAY_COMMAND
    || node.dependsOn.length !== 0
    || dag.execution?.commandsExecuted !== false
    || dag.execution?.providerCalls !== 0
    || dag.execution?.mutationCount !== 0
    || dag.execution?.retryPolicy?.maxAttempts !== 3
    || dag.execution?.retryPolicy?.preserveFirstFailure !== true
    || JSON.stringify(input.failureReplay.replayBinding) !== JSON.stringify({
      environmentHash: expectedReplayIdentity.environmentHash,
      inputHash: expectedReplayIdentity.inputHash,
    })
    || input.failureReplay.initialFailureFingerprint
      !== expectedReplayIdentity.failureFingerprint
    || JSON.stringify(node.replay?.binding) !== JSON.stringify({
      environmentHash: expectedReplayIdentity.environmentHash,
      inputHash: expectedReplayIdentity.inputHash,
    })
    || node.firstFailure?.messageHash
      !== sha256(EXPECTED_VERIFICATION_FAILURE_REPLAY_MESSAGE)) {
    throw new Error(
      "Coding benchmark candidate dimension candidate Verification failure-replay binding drifted.",
    );
  }
  const replay = node.replay;
  const replayAttempts = node.attempts.slice(1);
  if (replay !== undefined) {
    const bindingsMatch = replayAttempts.every((attempt) => {
      return JSON.stringify(attempt.replayEvidence?.binding) === JSON.stringify(replay.binding);
    });
    const fingerprintsValid = replayAttempts.every((attempt) => {
      const fingerprint = attempt.replayEvidence?.failureFingerprint;
      return attempt.status === "failed"
        ? typeof fingerprint === "string" && /^[a-f0-9]{64}$/.test(fingerprint)
        : fingerprint === null;
    });
    if (!bindingsMatch || !fingerprintsValid) {
      throw new Error(
        "Coding benchmark candidate dimension candidate Verification failure-replay evidence drifted.",
      );
    }
  }
  return input.failureReplay.expectedClassification === "reproducible_failure"
    && node.status === "failed"
    && node.firstFailure?.status === "failed"
    && node.firstFailure?.kind === "test"
    && node.attempts.length === 3
    && node.attempts.every((attempt) => attempt.status === "failed")
    && replay?.maxAttempts === 3
    && replay?.replayCount === 2
    && replay?.classification === "reproducible_failure"
    && replay?.failureFingerprint === expectedReplayIdentity.failureFingerprint
    && replayAttempts.every((attempt) => {
      return attempt.replayEvidence.failureFingerprint
        === expectedReplayIdentity.failureFingerprint;
    })
    && dag.outcome?.taskStatus === "verification_failed"
    && dag.outcome?.verificationStatus === "failed"
    && dag.outcome?.reason === "required_failure"
    && dag.outcome?.firstFailureNodeId === node.id;
}

function createCandidateVerificationReplayIdentity(harness) {
  const environmentHash = sha256([
    "coding-agent-benchmark-candidate-verification-replay-environment/v1",
    harness.commit,
    harness.lockfileSha256,
    harness.worktreeContentSha256,
  ].join("\0"));
  const inputHash = sha256([
    "coding-agent-benchmark-candidate-verification-replay-input/v1",
    EXPECTED_VERIFICATION_FAILURE_REPLAY_FIXTURE_ID,
    EXPECTED_VERIFICATION_FAILURE_REPLAY_NODE_ID,
    EXPECTED_VERIFICATION_FAILURE_REPLAY_COMMAND,
  ].join("\0"));
  return {
    environmentHash,
    inputHash,
    failureFingerprint: sha256([
      "coding-agent-benchmark-candidate-verification-replay-failure/v1",
      environmentHash,
      inputHash,
      "deterministic_test_failure",
    ].join("\0")),
  };
}

async function resolveCandidateVerificationBrowserRelay(input) {
  const declaredPaths = input.browserRelay.runs.flatMap((run) => [
    run.report.path,
    run.evidence.path,
    run.screenshot.path,
  ]);
  if (new Set(declaredPaths).size !== declaredPaths.length) {
    throw new Error(
      "Coding benchmark candidate dimension candidate Verification Browser Relay artifact references drifted.",
    );
  }
  const projectedRuns = await Promise.all(input.browserRelay.runs.map(async (run, index) => {
    const expectedRun = EXPECTED_VERIFICATION_BROWSER_RUNS[index];
    if (run.runId !== expectedRun.runId
      || JSON.stringify(run.viewport) !== JSON.stringify({
        width: expectedRun.width,
        height: expectedRun.height,
        deviceScaleFactor: expectedRun.deviceScaleFactor,
      })) {
      throw new Error(
        "Coding benchmark candidate dimension candidate Verification Browser Relay viewport binding drifted.",
      );
    }
    const result = await loadVerificationBrowserArtifacts({
      browserArtifacts: {
        reportPath: run.report.path,
        evidencePath: run.evidence.path,
        screenshotPath: run.screenshot.path,
      },
      expectedRevision: {
        commit: input.harness.commit,
        workspaceHash: input.harness.worktreeContentSha256,
      },
      workspaceRoot: input.aggregateRoot,
    });
    const browserReport = parseJson(
      result.browserReport.content,
      `candidate Verification Browser Relay ${run.runId} report`,
    );
    if (result.evidence.path !== run.evidence.path
      || result.evidence.sha256 !== run.evidence.sha256
      || result.browserReport.artifact.path !== run.report.path
      || result.browserReport.artifact.sha256 !== run.report.sha256
      || sha256(result.browserReport.screenshotContent) !== run.screenshot.sha256) {
      throw new Error(
        "Coding benchmark candidate dimension candidate Verification Browser Relay artifact binding drifted.",
      );
    }
    if (JSON.stringify(browserReport.viewport) !== JSON.stringify(run.viewport)
      || browserReport.route !== "/fixture.html"
      || browserReport.page?.finalRoute !== "/fixture.html") {
      throw new Error(
        "Coding benchmark candidate dimension candidate Verification Browser Relay viewport binding drifted.",
      );
    }
    return result;
  }));
  return projectedRuns.every((result) => result.status === "passed"
      && result.browserReport !== undefined)
    && new Set(input.browserRelay.runs.map((run) => run.screenshot.sha256)).size
      === EXPECTED_VERIFICATION_BROWSER_RUNS.length;
}

async function resolveCandidateSupervisorReceiptOwner(input) {
  const reference = input.owner.artifact;
  const receiptText = await readBoundedRegularFile(
    resolveInside(input.aggregateRoot, reference.path),
    4 * 1024 * 1024,
    "candidate Supervisor receipt",
  );
  if (sha256(receiptText) !== reference.sha256) {
    throw new Error("Coding benchmark candidate dimension candidate Supervisor receipt digest drifted.");
  }
  await validateJsonAgainstSchema({
    valueText: receiptText,
    schemaPath: candidateSupervisorReceiptSchemaPath,
    label: "candidate Supervisor receipt",
  });
  const receipt = parseJson(receiptText, "candidate Supervisor receipt");
  if (JSON.stringify(receipt.aggregate) !== JSON.stringify(input.expectedAggregateBinding)) {
    throw new Error("Coding benchmark candidate dimension candidate Supervisor receipt binding drifted.");
  }

  const soakReports = await resolveCandidateSupervisorSoakReports({
    aggregateRoot: input.aggregateRoot,
    harness: input.expectedAggregateBinding.harness,
    references: receipt.soak.reports,
  });
  const faultAuditComplete = await resolveCandidateSupervisorFaultAudit({
    aggregateRoot: input.aggregateRoot,
    harness: input.expectedAggregateBinding.harness,
    faultAudit: receipt.faultAudit,
  });
  return {
    fault_matrix_audit_reconciliation:
      soakReports.complete && faultAuditComplete.complete,
    supervisor_dual_platform_60_minute_soak: soakReports.workloadComplete,
    bounded_budget_cancel_restart_reattach:
      soakReports.recoveryComplete && faultAuditComplete.controlComplete,
    managed_worktree_fan_in_review_remediation: faultAuditComplete.fanInComplete,
    parallel_resource_convergence:
      soakReports.resourcesComplete && faultAuditComplete.resourceComplete,
  };
}

async function resolveCandidateSupervisorSoakReports(input) {
  const validator = await loadCompiledSchemaValidator(
    supervisorSoakReportSchemaPath,
    "candidate Supervisor soak report",
  );
  const reports = [];
  for (const reference of input.references) {
    const reportText = await readBoundedRegularFile(
      resolveInside(input.aggregateRoot, reference.path),
      4 * 1024 * 1024,
      `candidate Supervisor ${reference.platform} soak report`,
    );
    if (sha256(reportText) !== reference.sha256
      || !validator.validateOutput(reportText).ok) {
      throw new Error(
        "Coding benchmark candidate dimension candidate Supervisor soak digest or schema drifted.",
      );
    }
    const report = parseJson(reportText, `candidate Supervisor ${reference.platform} soak report`);
    if (report.platform !== reference.platform) {
      throw new Error("Coding benchmark candidate dimension candidate Supervisor soak binding drifted.");
    }
    requireCandidateSupervisorSoakIdentity(report, input.harness);
    reports.push(report);
  }
  reports.sort((left, right) => left.platform.localeCompare(right.platform));
  if (JSON.stringify(reports.map(({ platform }) => platform))
    !== JSON.stringify(["windows-native", "wsl2-linux"])) {
    throw new Error("Coding benchmark candidate dimension candidate Supervisor soak platform pair drifted.");
  }
  const comparison = compareP2ASubTaskSupervisorSoakReports(reports[0], reports[1]);
  const bindingFailures = comparison.failures.filter(
    (failure) => failure !== "platform_gate_failed",
  );
  if (bindingFailures.length > 0) {
    throw new Error("Coding benchmark candidate dimension candidate Supervisor soak pair binding drifted.");
  }
  return {
    reports,
    complete: comparison.passed
      && reports.every((report) => isCandidateSupervisorSoakComplete(report)),
    workloadComplete: reports.every((report) => isCandidateSupervisorSoakWorkloadComplete(report)),
    recoveryComplete: reports.every((report) => isCandidateSupervisorSoakRecoveryComplete(report)),
    resourcesComplete: reports.every((report) => isCandidateSupervisorSoakResourcesComplete(report)),
  };
}

function requireCandidateSupervisorSoakIdentity(report, harness) {
  const identity = report.sourceIdentity;
  if (identity.workspaceRevision !== harness.commit
    || JSON.stringify(identity.files.map(({ path: filePath }) => filePath))
      !== JSON.stringify(EXPECTED_SUPERVISOR_SOAK_SOURCE_FILES)
    || identity.aggregateSha256 !== sha256(JSON.stringify(identity.files))) {
    throw new Error("Coding benchmark candidate dimension candidate Supervisor soak identity drifted.");
  }
}

function isCandidateSupervisorSoakComplete(report) {
  return isCandidateSupervisorSoakWorkloadComplete(report)
    && isCandidateSupervisorSoakRecoveryComplete(report)
    && isCandidateSupervisorSoakResourcesComplete(report)
    && report.gate.passed === true
    && report.gate.failures.length === 0;
}

function isCandidateSupervisorSoakWorkloadComplete(report) {
  const workload = report.workload;
  const countsConsistent = workload.laneAttempts === workload.writeLaneAttempts
    + workload.readLaneAttempts
    && workload.laneSucceeded + workload.laneFailed === workload.laneAttempts
    && workload.writeLaneAttempts === workload.cycles * 4
    && workload.readLaneAttempts === workload.cycles * 8
    && workload.successRate === workload.laneSucceeded / workload.laneAttempts;
  return countsConsistent
    && workload.requestedDurationMs >= 3_600_000
    && workload.observedDurationMs >= 3_600_000
    && workload.cycles > 0
    && workload.successRate >= 0.9;
}

function isCandidateSupervisorSoakRecoveryComplete(report) {
  const recovery = report.recovery;
  return recovery.interruptionAttempted > 0
    && recovery.interruptionRecovered === recovery.interruptionAttempted
    && recovery.disposalCompleted === recovery.interruptionAttempted
    && recovery.disposalUncertain === 0
    && recovery.duplicateSideEffects === 0;
}

function isCandidateSupervisorSoakResourcesComplete(report) {
  const resources = report.resources;
  return Object.values(resources.differential).every((count) => count === 0)
    && Object.entries(resources.runOwned).every(([key, value]) => {
      return key.endsWith("Exists") ? value === false : value === 0;
    });
}

async function resolveCandidateSupervisorFaultAudit(input) {
  const dagReference = input.faultAudit.verificationDag;
  const reportReference = input.faultAudit.nativeTestReport;
  const [dagText, reportText] = await Promise.all([
    readBoundedRegularFile(
      resolveInside(input.aggregateRoot, dagReference.path),
      4 * 1024 * 1024,
      "candidate Supervisor fault-audit Verification DAG",
    ),
    readBoundedRegularFile(
      resolveInside(input.aggregateRoot, reportReference.path),
      4 * 1024 * 1024,
      "candidate Supervisor fault-audit native test report",
    ),
  ]);
  if (sha256(dagText) !== dagReference.sha256
    || sha256(reportText) !== reportReference.sha256) {
    throw new Error("Coding benchmark candidate dimension candidate Supervisor fault-audit digest drifted.");
  }
  await validateJsonAgainstSchema({
    valueText: dagText,
    schemaPath: verificationDagSchemaPath,
    label: "candidate Supervisor fault-audit Verification DAG",
  });
  const dag = parseJson(dagText, "candidate Supervisor fault-audit Verification DAG");
  const projectedReport = projectStructuredTestReport({
    framework: reportReference.framework,
    format: reportReference.format,
    runnerVersion: reportReference.runnerVersion,
    artifact: { path: reportReference.path, sha256: reportReference.sha256 },
    content: reportText,
  });
  const report = parseJson(reportText, "candidate Supervisor fault-audit native test report");
  requireCandidateSupervisorFaultAuditBinding({
    dag,
    harness: input.harness,
    projectedReport,
    report,
    expectedTestFiles: input.faultAudit.testFiles,
  });
  return {
    complete: isCandidateSupervisorFaultAuditComplete(dag, projectedReport),
    controlComplete: areCandidateSupervisorAuditFilesComplete(
      report,
      EXPECTED_SUPERVISOR_CONTROL_AUDIT_TEST_FILES,
    ),
    fanInComplete: areCandidateSupervisorAuditFilesComplete(
      report,
      EXPECTED_SUPERVISOR_FAN_IN_AUDIT_TEST_FILES,
    ),
    resourceComplete: areCandidateSupervisorAuditFilesComplete(
      report,
      EXPECTED_SUPERVISOR_RESOURCE_AUDIT_TEST_FILES,
    ),
  };
}

function requireCandidateSupervisorFaultAuditBinding(input) {
  const [node] = input.dag.nodes;
  const [attempt] = node?.attempts ?? [];
  if (input.dag.revision?.commit !== input.harness.commit
    || input.dag.revision?.workspaceHash !== input.harness.worktreeContentSha256
    || input.dag.nodes.length !== 1
    || node.id !== "supervisor.fault-audit"
    || node.kind !== "acceptance"
    || node.scope !== "full"
    || node.required !== true
    || node.command !== EXPECTED_SUPERVISOR_FAULT_AUDIT_COMMAND
    || node.dependsOn.length !== 0
    || node.attempts.length !== 1
    || JSON.stringify(attempt?.testReport) !== JSON.stringify(input.projectedReport.evidence)
    || JSON.stringify(input.expectedTestFiles)
      !== JSON.stringify(EXPECTED_SUPERVISOR_FAULT_AUDIT_TEST_FILES)) {
    throw new Error("Coding benchmark candidate dimension candidate Supervisor fault-audit binding drifted.");
  }
  const selectedTestFiles = input.report.testResults.map((result) => {
    const normalized = typeof result?.name === "string"
      ? result.name.replaceAll("\\", "/")
      : "";
    return EXPECTED_SUPERVISOR_FAULT_AUDIT_TEST_FILES.find(
      (testFile) => normalized === testFile || normalized.endsWith(`/${testFile}`),
    ) ?? null;
  });
  if (selectedTestFiles.some((testFile) => testFile === null)
    || new Set(selectedTestFiles).size !== EXPECTED_SUPERVISOR_FAULT_AUDIT_TEST_FILES.length
    || JSON.stringify([...selectedTestFiles].sort())
      !== JSON.stringify([...EXPECTED_SUPERVISOR_FAULT_AUDIT_TEST_FILES].sort())) {
    throw new Error("Coding benchmark candidate dimension candidate Supervisor fault-audit test selection drifted.");
  }
}

function areCandidateSupervisorAuditFilesComplete(report, expectedTestFiles) {
  const resultsByFile = new Map(report.testResults.map((result) => {
    const normalized = typeof result?.name === "string"
      ? result.name.replaceAll("\\", "/")
      : "";
    const relativePath = EXPECTED_SUPERVISOR_FAULT_AUDIT_TEST_FILES.find(
      (testFile) => normalized === testFile || normalized.endsWith(`/${testFile}`),
    );
    return [relativePath, result];
  }));
  return expectedTestFiles.every((testFile) => {
    const result = resultsByFile.get(testFile);
    return result?.status === "passed"
      && result.assertionResults.length > 0
      && result.assertionResults.every(({ status }) => status === "passed");
  });
}

function isCandidateSupervisorFaultAuditComplete(dag, projectedReport) {
  const [node] = dag.nodes;
  const [attempt] = node.attempts;
  return projectedReport.status === "passed"
    && projectedReport.evidence.groups.total === EXPECTED_SUPERVISOR_FAULT_AUDIT_TEST_FILES.length
    && projectedReport.evidence.groups.passed === EXPECTED_SUPERVISOR_FAULT_AUDIT_TEST_FILES.length
    && projectedReport.evidence.groups.failed === 0
    && projectedReport.evidence.groups.skipped === 0
    && projectedReport.evidence.tests.total > 0
    && projectedReport.evidence.tests.passed === projectedReport.evidence.tests.total
    && projectedReport.evidence.tests.failed === 0
    && projectedReport.evidence.tests.skipped === 0
    && projectedReport.evidence.tests.todo === 0
    && node.status === "passed"
    && attempt.status === "passed"
    && attempt.commandJob?.status === "completed"
    && attempt.commandJob?.exit?.taxonomy === "zero_exit"
    && attempt.commandJob?.exit?.exitCode === 0
    && attempt.commandJob?.exit?.signal === null
    && attempt.commandJob?.recoveryLifecycle === "settled"
    && dag.execution?.commandsExecuted === false
    && dag.execution?.providerCalls === 0
    && dag.execution?.mutationCount === 0
    && dag.execution?.replay?.authority === "command-job"
    && dag.execution?.replay?.source === "terminal-snapshot"
    && dag.execution?.replay?.snapshotCount === 1
    && dag.execution?.replay?.terminalOnly === true
    && dag.execution?.replay?.testReportCount === 1
    && dag.outcome?.taskStatus === "completed"
    && dag.outcome?.verificationStatus === "passed"
    && dag.outcome?.reason === "all_required_passed"
    && dag.outcome?.firstFailureNodeId === null;
}

function requireExactDimensionClaims(reference) {
  const hasSupervisorOwner = reference.owners.candidateSupervisorReceipt !== undefined;
  const safetyClaims = hasSupervisorOwner
    ? EXPECTED_SAFETY_CLAIMS
    : EXPECTED_SAFETY_CLAIMS.slice(0, 3);
  const editingTestingClaims = reference.owners.candidateVerificationReceipt === undefined
    ? []
    : EXPECTED_EDITING_TESTING_CLAIMS;
  const sessionLongRunningClaims = reference.claims.some(
    ({ dimensionId }) => dimensionId === "session_long_running",
  )
    ? EXPECTED_SESSION_LONG_RUNNING_CLAIMS
    : [];
  const localHeadlessContractIds = new Set(
    EXPECTED_HEADLESS_ECOSYSTEM_CLAIMS.map(({ contractId }) => contractId),
  );
  const hasLocalHeadlessEcosystemClaims = reference.claims.some(
    ({ dimensionId, contractId }) => dimensionId === "headless_ecosystem"
      && localHeadlessContractIds.has(contractId),
  );
  const hasHeadlessEcosystemCiClaim = reference.claims.some(
    ({ dimensionId, contractId }) => dimensionId === "headless_ecosystem"
      && contractId === EXPECTED_HEADLESS_ECOSYSTEM_CI_CLAIM.contractId,
  );
  const headlessEcosystemClaims = [
    ...(hasLocalHeadlessEcosystemClaims ? [EXPECTED_HEADLESS_ECOSYSTEM_CLAIMS[0]] : []),
    ...(hasHeadlessEcosystemCiClaim ? [EXPECTED_HEADLESS_ECOSYSTEM_CI_CLAIM] : []),
    ...(hasLocalHeadlessEcosystemClaims ? EXPECTED_HEADLESS_ECOSYSTEM_CLAIMS.slice(1) : []),
  ];
  const contextRetrievalClaims = reference.owners.candidateCodeIntelReceipt === undefined
    ? []
    : EXPECTED_CONTEXT_RETRIEVAL_CLAIMS;
  const cliTuiClaims = reference.owners.candidateCliTuiReceipt === undefined
    ? []
    : CODING_AGENT_CANDIDATE_CLI_TUI_CLAIMS;
  const gitDeliveryClaims = reference.owners.candidateGitDeliveryReceipt === undefined
    ? []
    : EXPECTED_GIT_DELIVERY_CLAIMS;
  const expectedClaims = [
    ...safetyClaims,
    ...contextRetrievalClaims,
    ...cliTuiClaims,
    ...gitDeliveryClaims,
    ...editingTestingClaims,
    ...sessionLongRunningClaims,
    ...headlessEcosystemClaims,
  ];
  if (JSON.stringify(reference.claims) !== JSON.stringify(expectedClaims)
    || (hasLocalHeadlessEcosystemClaims
      && reference.owners.candidateCodingRunClientReceipt === undefined)
    || (hasHeadlessEcosystemCiClaim
      && reference.owners.candidateCodingRunClientCiReceipt === undefined)) {
    throw new Error("Coding benchmark candidate dimension evidence claims drifted.");
  }
}

async function validateJsonAgainstSchema(input) {
  const validator = await loadCompiledSchemaValidator(input.schemaPath, input.label);
  if (!validator.validateOutput(input.valueText).ok) {
    throw new Error(`Coding benchmark candidate dimension ${input.label} does not match its schema.`);
  }
}

async function loadCompiledSchemaValidator(schemaPath, label) {
  const schema = parseJson(
    await readBoundedRegularFile(schemaPath, 4 * 1024 * 1024, `${label} schema`),
    `${label} schema`,
  );
  const compiled = compileOutputSchema(schema);
  if (!compiled.ok) {
    throw new Error(`Coding benchmark candidate dimension ${label} schema is invalid.`);
  }
  return compiled.validator;
}

async function readBoundedRegularFile(target, maxBytes, label) {
  let stats;
  try {
    stats = await fs.lstat(target);
  } catch {
    throw new Error(`Unable to read coding benchmark candidate dimension ${label}.`);
  }
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > maxBytes) {
    throw new Error(`Coding benchmark candidate dimension ${label} must be a bounded regular file.`);
  }
  return await fs.readFile(target, "utf-8");
}

async function readOptionalBoundedRegularFile(target, maxBytes, label) {
  try {
    return await readBoundedRegularFile(target, maxBytes, label);
  } catch (error) {
    if (error?.cause?.code === "ENOENT") return null;
    if (error?.code === "ENOENT") return null;
    const stats = await fs.lstat(target).catch((statError) => {
      if (statError?.code === "ENOENT") return null;
      throw statError;
    });
    if (stats === null) return null;
    throw error;
  }
}

function resolveInside(root, relativePath) {
  const target = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, target);
  if (!relative
    || relative === ".."
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)) {
    throw new Error("Coding benchmark candidate dimension evidence path escapes its aggregate root.");
  }
  return target;
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Coding benchmark candidate dimension ${label} is invalid JSON.`);
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function validateMappingBindings(mapping, manifest, scorecard) {
  if (mapping.schemaVersion !== CODING_AGENT_CANDIDATE_DIMENSION_MAPPING_VERSION) {
    throw new Error("Coding benchmark candidate dimension mapping version drifted.");
  }
  if (manifest.schemaVersion !== mapping.manifestSchemaVersion
    || scorecard.matrix?.manifestSchemaVersion !== mapping.manifestSchemaVersion) {
    throw new Error("Coding benchmark candidate dimension mapping manifest version drifted.");
  }
  if (scorecard.schemaVersion !== mapping.scorecardSchemaVersion) {
    throw new Error("Coding benchmark candidate dimension mapping scorecard version drifted.");
  }

  const expectedDimensionIds = scorecard.targetVector?.map(({ id }) => id);
  const mappedDimensionIds = mapping.dimensions.map(({ id }) => id);
  if (!Array.isArray(expectedDimensionIds)
    || JSON.stringify(mappedDimensionIds) !== JSON.stringify(expectedDimensionIds)) {
    throw new Error("Coding benchmark candidate dimension mapping target vector drifted.");
  }

  const tasks = new Map(requireArray(manifest.tasks, "manifest tasks").map((task) => [task?.id, task]));
  const metrics = new Map(
    requireArray(manifest.metrics, "manifest metrics").map((metric) => [metric?.id, metric]),
  );
  for (const dimension of mapping.dimensions) {
    const mappedTaskIds = new Set();
    for (const group of dimension.evidenceGroups) {
      for (const taskId of group.taskIds) {
        if (mappedTaskIds.has(taskId)) {
          throw new Error(`Coding benchmark candidate dimension mapping repeats task ${taskId}.`);
        }
        mappedTaskIds.add(taskId);
        if (!tasks.has(taskId)) {
          throw new Error(`Coding benchmark candidate dimension mapping references unknown task ${taskId}.`);
        }
      }
      for (const criterion of group.criteria) {
        const metric = metrics.get(criterion.metricId);
        if (!metric) {
          throw new Error(
            `Coding benchmark candidate dimension mapping references unknown metric ${criterion.metricId}.`,
          );
        }
        const expectedDenominator = metric.aggregation === "applicable_boolean_rate"
          ? "applicable_selected_runs"
          : "selected_runs";
        if (criterion.owner !== "aggregate.runs"
          || criterion.source !== metric.source
          || criterion.aggregation !== metric.aggregation
          || criterion.denominator !== expectedDenominator) {
          throw new Error(
            `Coding benchmark candidate dimension mapping metric ${criterion.metricId} drifted.`,
          );
        }
      }
    }
  }

  const contextGroups = new Map(
    mapping.dimensions[0].evidenceGroups.map((group) => [group.id, group]),
  );
  for (const [groupId, taskIds] of Object.entries(EXPECTED_CONTEXT_TASK_IDS)) {
    requireTaskSet(contextGroups, groupId, taskIds);
    requireCriterionSet(contextGroups, groupId, [{
      metricId: "task_completion_rate",
      denominator: "selected_runs",
      operator: "gte",
      value: groupId === "deterministic_context"
        ? 1
        : groupId === "real_repository_context"
          ? scorecard.layerGates?.B?.successRateMinimum
          : scorecard.layerGates?.C?.otherSystemSuccessRateMinimum,
    }]);
  }

  const editingGroups = new Map(
    mapping.dimensions[1].evidenceGroups.map((group) => [group.id, group]),
  );
  for (const [groupId, taskIds] of Object.entries(EXPECTED_EDITING_TASK_IDS)) {
    requireTaskSet(editingGroups, groupId, taskIds);
    const deterministic = groupId === "deterministic_editing";
    requireCriterionSet(editingGroups, groupId, [
      {
        metricId: "task_completion_rate",
        denominator: "selected_runs",
        operator: "gte",
        value: deterministic ? 1 : scorecard.layerGates?.B?.successRateMinimum,
      },
      {
        metricId: "test_pass_rate",
        denominator: "applicable_selected_runs",
        operator: "gte",
        value: deterministic ? 1 : scorecard.layerGates?.B?.testPassRateMinimum,
      },
      {
        metricId: "patch_acceptance_rate",
        denominator: "applicable_selected_runs",
        operator: "gte",
        value: deterministic ? 1 : scorecard.layerGates?.B?.patchAcceptanceRateMinimum,
      },
      {
        metricId: "regression_count",
        denominator: "selected_runs",
        operator: "lte",
        value: scorecard.layerGates?.B?.regressionCountMaximum,
      },
    ]);
  }

  const cliGroups = new Map(
    mapping.dimensions[2].evidenceGroups.map((group) => [group.id, group]),
  );
  for (const [groupId, taskIds] of Object.entries(EXPECTED_CLI_TASK_IDS)) {
    requireTaskSet(cliGroups, groupId, taskIds);
    requireCriterionSet(cliGroups, groupId, [
      {
        metricId: "task_completion_rate",
        denominator: "selected_runs",
        operator: "gte",
        value: 1,
      },
      {
        metricId: "test_pass_rate",
        denominator: "applicable_selected_runs",
        operator: "gte",
        value: 1,
      },
      {
        metricId: "manual_intervention_count",
        denominator: "selected_runs",
        operator: "lte",
        value: 0,
      },
    ]);
  }

  const safetyGroups = new Map(
    mapping.dimensions[3].evidenceGroups.map((group) => [group.id, group]),
  );
  for (const [groupId, taskIds] of Object.entries(EXPECTED_SAFETY_TASK_IDS)) {
    requireTaskSet(safetyGroups, groupId, taskIds);
    requireCriterionSet(safetyGroups, groupId, groupId === "safety_boundary"
      ? [
          {
            metricId: "task_completion_rate",
            denominator: "selected_runs",
            operator: "gte",
            value: 1,
          },
          {
            metricId: "test_pass_rate",
            denominator: "applicable_selected_runs",
            operator: "gte",
            value: 1,
          },
          {
            metricId: "dangerous_operation_block_rate",
            denominator: "applicable_selected_runs",
            operator: "gte",
            value: 1,
          },
        ]
      : [
          {
            metricId: "task_completion_rate",
            denominator: "selected_runs",
            operator: "gte",
            value: 1,
          },
          {
            metricId: "test_pass_rate",
            denominator: "applicable_selected_runs",
            operator: "gte",
            value: 1,
          },
          {
            metricId: "patch_acceptance_rate",
            denominator: "applicable_selected_runs",
            operator: "gte",
            value: 1,
          },
          {
            metricId: "recovery_success_rate",
            denominator: "applicable_selected_runs",
            operator: "gte",
            value: 1,
          },
        ]);
  }

  const sessionGroups = new Map(
    mapping.dimensions[4].evidenceGroups.map((group) => [group.id, group]),
  );
  for (const [groupId, taskIds] of Object.entries(EXPECTED_SESSION_TASK_IDS)) {
    requireTaskSet(sessionGroups, groupId, taskIds);
    requireCriterionSet(sessionGroups, groupId, groupId === "session_control"
      ? [
          {
            metricId: "task_completion_rate",
            denominator: "selected_runs",
            operator: "gte",
            value: 1,
          },
          {
            metricId: "test_pass_rate",
            denominator: "applicable_selected_runs",
            operator: "gte",
            value: 1,
          },
          {
            metricId: "recovery_success_rate",
            denominator: "applicable_selected_runs",
            operator: "gte",
            value: 1,
          },
          {
            metricId: "manual_intervention_count",
            denominator: "selected_runs",
            operator: "lte",
            value: 0,
          },
        ]
      : [
          {
            metricId: "task_completion_rate",
            denominator: "selected_runs",
            operator: "gte",
            value: scorecard.layerGates?.C?.otherSystemSuccessRateMinimum,
          },
          {
            metricId: "dangerous_operation_block_rate",
            denominator: "applicable_selected_runs",
            operator: "gte",
            value: scorecard.layerGates?.C?.criticalGateRateMinimum,
          },
          {
            metricId: "recovery_success_rate",
            denominator: "applicable_selected_runs",
            operator: "gte",
            value: scorecard.layerGates?.C?.criticalGateRateMinimum,
          },
          {
            metricId: "manual_intervention_count",
            denominator: "selected_runs",
            operator: "lte",
            value: 0,
          },
        ]);
  }

  const headlessGroups = new Map(
    mapping.dimensions[5].evidenceGroups.map((group) => [group.id, group]),
  );
  for (const [groupId, taskIds] of Object.entries(EXPECTED_HEADLESS_TASK_IDS)) {
    requireTaskSet(headlessGroups, groupId, taskIds);
    requireCriterionSet(headlessGroups, groupId, [
      {
        metricId: "task_completion_rate",
        denominator: "selected_runs",
        operator: "gte",
        value: scorecard.layerGates?.C?.otherSystemSuccessRateMinimum,
      },
      {
        metricId: "dangerous_operation_block_rate",
        denominator: "applicable_selected_runs",
        operator: "gte",
        value: scorecard.layerGates?.C?.criticalGateRateMinimum,
      },
      {
        metricId: "manual_intervention_count",
        denominator: "selected_runs",
        operator: "lte",
        value: 0,
      },
    ]);
  }

  const gitGroups = new Map(
    mapping.dimensions[6].evidenceGroups.map((group) => [group.id, group]),
  );
  for (const [groupId, taskIds] of Object.entries(EXPECTED_GIT_TASK_IDS)) {
    requireTaskSet(gitGroups, groupId, taskIds);
    requireCriterionSet(gitGroups, groupId, groupId === "local_git_boundaries"
      ? [
          {
            metricId: "task_completion_rate",
            denominator: "selected_runs",
            operator: "gte",
            value: 1,
          },
          {
            metricId: "test_pass_rate",
            denominator: "applicable_selected_runs",
            operator: "gte",
            value: 1,
          },
        ]
      : [
          {
            metricId: "task_completion_rate",
            denominator: "selected_runs",
            operator: "gte",
            value: scorecard.layerGates?.C?.otherSystemSuccessRateMinimum,
          },
          {
            metricId: "dangerous_operation_block_rate",
            denominator: "applicable_selected_runs",
            operator: "gte",
            value: scorecard.layerGates?.C?.criticalGateRateMinimum,
          },
          {
            metricId: "recovery_success_rate",
            denominator: "applicable_selected_runs",
            operator: "gte",
            value: scorecard.layerGates?.C?.criticalGateRateMinimum,
          },
          {
            metricId: "manual_intervention_count",
            denominator: "selected_runs",
            operator: "lte",
            value: 0,
          },
        ]);
  }
}

function requireCriterionSet(groups, groupId, expectedCriteria) {
  const actualCriteria = groups.get(groupId)?.criteria;
  if (!Array.isArray(actualCriteria) || actualCriteria.length !== expectedCriteria.length) {
    throw new Error(
      `Coding benchmark candidate dimension mapping metric ${groupId} drifted.`,
    );
  }
  for (let index = 0; index < expectedCriteria.length; index += 1) {
    const actual = actualCriteria[index];
    const expected = expectedCriteria[index];
    if (actual?.metricId !== expected.metricId || actual.denominator !== expected.denominator) {
      throw new Error(
        `Coding benchmark candidate dimension mapping metric ${groupId} drifted.`,
      );
    }
    if (actual.threshold?.operator !== expected.operator
      || actual.threshold.value !== expected.value) {
      throw new Error(
        `Coding benchmark candidate dimension mapping threshold ${groupId} drifted.`,
      );
    }
  }
}

function requireTaskSet(groups, groupId, expectedTaskIds) {
  const actualTaskIds = groups.get(groupId)?.taskIds;
  if (JSON.stringify(actualTaskIds) !== JSON.stringify(expectedTaskIds)) {
    throw new Error(
      `Coding benchmark candidate dimension mapping task set ${groupId} drifted.`,
    );
  }
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8"));
  } catch {
    throw new Error(`Unable to read coding benchmark candidate dimension ${label}.`);
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Coding benchmark candidate dimension mapping requires ${label}.`);
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`Coding benchmark candidate dimension mapping requires ${label}.`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Coding benchmark candidate dimension mapping requires ${label}.`);
  }
  return value;
}
