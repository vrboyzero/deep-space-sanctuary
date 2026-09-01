import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  CODING_AGENT_BENCHMARK_COMMAND_CONTROL_AGENT_PROFILE,
  CODING_AGENT_BENCHMARK_MANIFEST_VERSION,
  CODING_AGENT_BENCHMARK_MANIFEST_V2_VERSION,
  CODING_AGENT_BENCHMARK_MANIFEST_V3_VERSION,
  CODING_AGENT_BENCHMARK_REPORT_VERSION,
  CODING_AGENT_BENCHMARK_REPORT_V2_VERSION,
  CODING_AGENT_BENCHMARK_REPORT_V3_VERSION,
  CODING_AGENT_BENCHMARK_RUN_VERSION,
  CODING_AGENT_BENCHMARK_RUN_V2_VERSION,
  CODING_AGENT_BENCHMARK_RUN_V3_VERSION,
  loadCodingAgentBenchmarkManifest,
} from "./coding-agent-benchmark-contract.mjs";
import {
  CODING_AGENT_BENCHMARK_SCORECARD_V3_VERSION,
  validateCodingAgentBenchmarkScorecardV3,
} from "./coding-agent-benchmark-v3-contract.mjs";
import {
  CODING_AGENT_EXPECTED_REPORT_EVIDENCE_VERSION,
  CODING_AGENT_EXPECTED_REPORT_PLAN_VERSION,
} from "./aggregate-coding-agent-benchmark.mjs";
import {
  CODING_AGENT_BENCHMARK_SNAPSHOT_RECEIPT_VERSION,
  validateCodingAgentBenchmarkV3SnapshotReceipt,
} from "./coding-agent-benchmark-v3-fixtures.mjs";
import {
  CODING_AGENT_BENCHMARK_WEB_UI_TRUTH_SET_VERSION,
  loadCodingAgentBenchmarkWebUiTruthSet,
} from "./coding-agent-benchmark-v3-web-ui-truth-set.mjs";
import {
  CODING_AGENT_BENCHMARK_LINUX_SNAPSHOT_PREPARATION_VERSION,
} from "./coding-agent-benchmark-linux-snapshot-preparation.mjs";
import {
  CODING_AGENT_BENCHMARK_NAVIGATION_EFFICIENCY_VERSION,
} from "./run-coding-agent-benchmark-navigation-efficiency.mjs";
import {
  CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_CANARY_VERSION,
} from "./run-coding-agent-benchmark-navigation-shadow-canary.mjs";
import {
  CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_REAL_VERSION,
} from "./run-coding-agent-benchmark-navigation-shadow-real.mjs";
import {
  CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_REAL_V2_VERSION,
} from "./run-coding-agent-benchmark-navigation-shadow-real-v2.mjs";
import {
  CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_REAL_V3_VERSION,
} from "./run-coding-agent-benchmark-navigation-shadow-real-v3.mjs";
import {
  CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_ANALYSIS_VERSION,
} from "./run-coding-agent-benchmark-navigation-shadow-analysis.mjs";
import {
  CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_V2_ANALYSIS_VERSION,
} from "./run-coding-agent-benchmark-navigation-shadow-v2-analysis.mjs";
import {
  CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_V3_ANALYSIS_VERSION,
} from "./run-coding-agent-benchmark-navigation-shadow-v3-analysis.mjs";
import {
  CODING_AGENT_BENCHMARK_MODEL_LOOP_BUDGET_TERMINATION_VERSION,
} from "./run-coding-agent-benchmark-model-loop-budget-termination.mjs";
import {
  CODING_AGENT_BENCHMARK_MODEL_LOOP_ROLLOUT_AUDIT_VERSION,
} from "./run-coding-agent-benchmark-model-loop-rollout-audit.mjs";
import {
  CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V2_VERSION,
} from "./run-coding-agent-benchmark-navigation-candidate-v2.mjs";
import {
  CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_VERSION,
} from "./run-coding-agent-benchmark-navigation-candidate-v3.mjs";
import {
  CODING_AGENT_BENCHMARK_FAILURE_ANALYSIS_VERSION,
} from "./run-coding-agent-benchmark-failure-analysis.mjs";
import {
  CODING_AGENT_CANDIDATE_GLOBAL_RUNNER_INPUT_VERSION,
} from "./run-coding-agent-candidate-global-receipt.mjs";
import {
  CODING_AGENT_CANDIDATE_QUALIFICATION_VERSION,
} from "./coding-agent-candidate-qualification.mjs";
import {
  CODING_AGENT_CANDIDATE_QUALIFICATION_REPORT_VERSION,
  CODING_AGENT_QUALIFICATION_EVIDENCE_DIGEST_VERSION,
} from "./run-coding-agent-candidate-qualification.mjs";
import {
  CODING_AGENT_CANDIDATE_CODING_RUN_CLIENT_EVIDENCE_RECEIPT_VERSION,
  CODING_AGENT_CANDIDATE_CODING_RUN_CLIENT_CI_EVIDENCE_RECEIPT_VERSION,
  CODING_AGENT_CANDIDATE_DIMENSION_EVIDENCE_REFERENCE_VERSION,
  CODING_AGENT_CANDIDATE_DIMENSION_MAPPING_VERSION,
  CODING_AGENT_CANDIDATE_SUPERVISOR_EVIDENCE_RECEIPT_VERSION,
  CODING_AGENT_CANDIDATE_VERIFICATION_EVIDENCE_RECEIPT_VERSION,
} from "./coding-agent-candidate-score.mjs";
import { CODING_RUN_CLIENT_CI_LANE_EVIDENCE_VERSION } from "./run-coding-run-client-ci-lane-receipt.mjs";
import { resolveCodingCiProfile } from "./run-coding-agent-ci.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const EXPECTED_CODING_RUN_CLIENT_AUDIT_SCRIPT = [
  "vitest run",
  "packages/belldandy-core/src/coding-run/stdio.test.ts",
  "packages/belldandy-core/src/coding-run/client.test.ts",
  "apps/vscode-extension/src/stdio-client.test.js",
  "scripts/coding-run-client-conformance.test.mjs",
  "scripts/coding-run-client-failure-conformance.test.mjs",
  "scripts/run-coding-run-client-external-consumer.test.mjs",
  "scripts/run-coding-run-client-typescript-consumer.test.mjs",
  "--reporter=json",
  "--outputFile=artifacts/coding-run-client-ci/vitest-report.json",
].join(" ");
const EXPECTED_P1B_VERIFICATION_AUDIT_SCRIPT = [
  "vitest run",
  "scripts/run-verification-impact-truth-set.test.mjs",
  "scripts/verification-test-report-adapter.test.mjs",
  "scripts/run-verification-dag.test.mjs",
  "scripts/verification-browser-report-adapter.test.mjs",
  "--reporter=json",
].join(" ");
const EXPECTED_P2A_SUPERVISOR_FAULT_AUDIT_SCRIPT = [
  "vitest run",
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
  "--reporter=json",
].join(" ");

export async function collectCodingAgentBenchmarkContractFailures(input = {}) {
  const workspaceRoot = input.workspaceRoot
    ? path.resolve(input.workspaceRoot)
    : path.resolve(path.dirname(scriptPath), "..");
  const failures = [];
  const readJson = async (relativePath) => {
    try {
      return JSON.parse(await fs.readFile(path.join(workspaceRoot, relativePath), "utf-8"));
    } catch (error) {
      failures.push(`${relativePath} is missing or invalid JSON: ${safeMessage(error)}`);
      return undefined;
    }
  };
  const readText = async (relativePath) => {
    try {
      return await fs.readFile(path.join(workspaceRoot, relativePath), "utf-8");
    } catch (error) {
      failures.push(`${relativePath} is missing: ${safeMessage(error)}`);
      return "";
    }
  };

  const packageJson = await readJson("package.json");
  const manifestPath = "benchmarks/coding-agent/v1/task-manifest.json";
  const manifest = await readJson(manifestPath);
  const manifestSchema = await readJson("benchmarks/coding-agent/v1/task-manifest.schema.json");
  const runSchema = await readJson("benchmarks/coding-agent/v1/benchmark-run.schema.json");
  const reportSchema = await readJson("benchmarks/coding-agent/v1/benchmark-report.schema.json");
  const faultSchema = await readJson("benchmarks/coding-agent/v1/fault-injection.schema.json");
  const cancelSchema = await readJson("benchmarks/coding-agent/v1/cancel-injection.schema.json");
  const restartSchema = await readJson("benchmarks/coding-agent/v1/restart-injection.schema.json");
  const manifestV2Path = "benchmarks/coding-agent/v2/task-manifest.json";
  const manifestV2 = await readJson(manifestV2Path);
  const benchmarkAgentsV2 = await readJson("benchmarks/coding-agent/v2/agents.json");
  const manifestV2Schema = await readJson("benchmarks/coding-agent/v2/task-manifest.schema.json");
  const runV2Schema = await readJson("benchmarks/coding-agent/v2/benchmark-run.schema.json");
  const reportV2Schema = await readJson("benchmarks/coding-agent/v2/benchmark-report.schema.json");
  const preflightSchema = await readJson("benchmarks/coding-agent/v2/preflight.schema.json");
  const approvalContractSchema = await readJson("benchmarks/coding-agent/v2/approval-contract.schema.json");
  const approvalEvidenceSchema = await readJson("benchmarks/coding-agent/v2/approval-evidence.schema.json");
  const faultV2Schema = await readJson("benchmarks/coding-agent/v2/fault-injection.schema.json");
  const cancelV2Schema = await readJson("benchmarks/coding-agent/v2/cancel-injection.schema.json");
  const restartV2Schema = await readJson("benchmarks/coding-agent/v2/restart-injection.schema.json");
  const manifestV3Path = "benchmarks/coding-agent/v3/task-manifest.json";
  const manifestV3 = await readJson(manifestV3Path);
  const scorecardV3 = await readJson("benchmarks/coding-agent/v3/scorecard.json");
  const manifestV3Schema = await readJson("benchmarks/coding-agent/v3/task-manifest.schema.json");
  const runV3Schema = await readJson("benchmarks/coding-agent/v3/benchmark-run.schema.json");
  const reportV3Schema = await readJson("benchmarks/coding-agent/v3/benchmark-report.schema.json");
  const scorecardV3Schema = await readJson("benchmarks/coding-agent/v3/scorecard.schema.json");
  const expectedReportPlanV3Schema = await readJson(
    "benchmarks/coding-agent/v3/expected-report-plan.schema.json",
  );
  const expectedReportsV3Schema = await readJson(
    "benchmarks/coding-agent/v3/expected-reports.schema.json",
  );
  const candidateDimensionMappingV3 = await readJson(
    "benchmarks/coding-agent/v3/candidate-dimension-mapping.json",
  );
  const candidateDimensionMappingV3Schema = await readJson(
    "benchmarks/coding-agent/v3/candidate-dimension-mapping.schema.json",
  );
  const candidateDimensionEvidenceReferenceV3Schema = await readJson(
    "benchmarks/coding-agent/v3/candidate-dimension-evidence-reference.schema.json",
  );
  const candidateSupervisorEvidenceReceiptV3Schema = await readJson(
    "benchmarks/coding-agent/v3/candidate-supervisor-evidence-receipt.schema.json",
  );
  const candidateVerificationEvidenceReceiptV3Schema = await readJson(
    "benchmarks/coding-agent/v3/candidate-verification-evidence-receipt.schema.json",
  );
  const candidateCodingRunClientEvidenceReceiptV3Schema = await readJson(
    "benchmarks/coding-agent/v3/candidate-coding-run-client-evidence-receipt.schema.json",
  );
  const candidateCodingRunClientCiEvidenceReceiptV3Schema = await readJson(
    "benchmarks/coding-agent/v3/candidate-coding-run-client-ci-evidence-receipt.schema.json",
  );
  const codingRunClientCiLaneEvidenceV3Schema = await readJson(
    "benchmarks/coding-agent/v3/coding-run-client-ci-lane-evidence.schema.json",
  );
  const candidateGlobalRunnerInputV3Schema = await readJson(
    "benchmarks/coding-agent/v3/candidate-global-runner-input.schema.json",
  );
  const candidateGlobalReceiptV3Schema = await readJson(
    "benchmarks/coding-agent/v3/candidate-global-receipt.schema.json",
  );
  const candidateQualificationReportV3Schema = await readJson(
    "benchmarks/coding-agent/v3/candidate-qualification-report.schema.json",
  );
  const repositoryInputsV3Schema = await readJson(
    "benchmarks/coding-agent/v3/repository-inputs.schema.json",
  );
  const linuxSnapshotPreparationV3Schema = await readJson(
    "benchmarks/coding-agent/v3/linux-snapshot-preparation.schema.json",
  );
  const runtimePreflightV3Schema = await readJson("benchmarks/coding-agent/v3/preflight.schema.json");
  const snapshotPreflightV3Schema = await readJson(
    "benchmarks/coding-agent/v3/repository-snapshot-preflight.schema.json",
  );
  const snapshotReceiptV3Schema = await readJson(
    "benchmarks/coding-agent/v3/repository-snapshot-receipt.schema.json",
  );
  const systemScenarioV3Schema = await readJson(
    "benchmarks/coding-agent/v3/system-scenario.schema.json",
  );
  const systemEvidenceV3Schema = await readJson(
    "benchmarks/coding-agent/v3/system-evidence.schema.json",
  );
  const navigationEfficiencyV3Schema = await readJson(
    "benchmarks/coding-agent/v3/navigation-efficiency.schema.json",
  );
  const navigationShadowCanaryV3Schema = await readJson(
    "benchmarks/coding-agent/v3/navigation-shadow-canary.schema.json",
  );
  const navigationShadowRealV3Schema = await readJson(
    "benchmarks/coding-agent/v3/navigation-shadow-real.schema.json",
  );
  const navigationShadowRealV2V3Schema = await readJson(
    "benchmarks/coding-agent/v3/navigation-shadow-real-v2.schema.json",
  );
  const navigationShadowRealCandidateV3Schema = await readJson(
    "benchmarks/coding-agent/v3/navigation-shadow-real-v3.schema.json",
  );
  const navigationShadowAnalysisV3Schema = await readJson(
    "benchmarks/coding-agent/v3/navigation-shadow-analysis.schema.json",
  );
  const navigationShadowV2AnalysisV3Schema = await readJson(
    "benchmarks/coding-agent/v3/navigation-shadow-v2-analysis.schema.json",
  );
  const navigationShadowV3AnalysisV3Schema = await readJson(
    "benchmarks/coding-agent/v3/navigation-shadow-v3-analysis.schema.json",
  );
  const modelLoopBudgetTerminationV3Schema = await readJson(
    "benchmarks/coding-agent/v3/model-loop-budget-termination.schema.json",
  );
  const modelLoopRolloutAuditV3Schema = await readJson(
    "benchmarks/coding-agent/v3/model-loop-rollout-audit.schema.json",
  );
  const failureAnalysisV3Schema = await readJson(
    "benchmarks/coding-agent/v3/failure-analysis.schema.json",
  );
  const navigationCandidateV2V3Schema = await readJson(
    "benchmarks/coding-agent/v3/navigation-candidate-v2.schema.json",
  );
  const navigationCandidateV3V3Schema = await readJson(
    "benchmarks/coding-agent/v3/navigation-candidate-v3.schema.json",
  );
  const webUiTruthSetV3 = await readJson(
    "benchmarks/coding-agent/v3/real-web-ui-regression-truth-set.json",
  );
  const webUiTruthSetV3Schema = await readJson(
    "benchmarks/coding-agent/v3/real-web-ui-regression-truth-set.schema.json",
  );
  const readme = await readText("benchmarks/coding-agent/README.md");
  await readText("scripts/coding-agent-benchmark-v3-contract.mjs");
  await readText("scripts/coding-agent-benchmark-v3-fixtures.mjs");
  await readText("scripts/coding-agent-benchmark-v3-web-ui-truth-set.mjs");
  await readText("scripts/coding-agent-benchmark-linux-snapshot-preparation.mjs");
  await readText("scripts/coding-agent-benchmark-parallel-read-harness.mjs");
  await readText("scripts/coding-agent-benchmark-fixtures.mjs");
  await readText("scripts/coding-agent-benchmark-approval.mjs");
  await readText("scripts/coding-agent-benchmark-preflight.mjs");
  await readText("scripts/coding-agent-recovery-harness.mjs");
  await readText("scripts/coding-agent-process-restart-harness.mjs");
  await readText("scripts/coding-agent-process-restart-gateway.mjs");
  await readText("scripts/aggregate-coding-agent-benchmark.mjs");
  await readText("scripts/run-coding-agent-benchmark.mjs");
  await readText("scripts/run-coding-agent-benchmark-wsl.mjs");
  await readText("scripts/run-coding-agent-benchmark-system-smoke.mjs");
  await readText("scripts/run-coding-agent-benchmark-navigation-efficiency.mjs");
  await readText("scripts/run-coding-agent-benchmark-navigation-shadow-canary.mjs");
  await readText("scripts/run-coding-agent-benchmark-navigation-shadow-real.mjs");
  await readText("scripts/run-coding-agent-benchmark-navigation-shadow-real-v2.mjs");
  await readText("scripts/run-coding-agent-benchmark-navigation-shadow-real-v3.mjs");
  await readText("scripts/run-coding-agent-benchmark-navigation-shadow-analysis.mjs");
  await readText("scripts/run-coding-agent-benchmark-navigation-shadow-v2-analysis.mjs");
  await readText("scripts/run-coding-agent-benchmark-navigation-shadow-v3-analysis.mjs");
  await readText("scripts/run-coding-agent-benchmark-model-loop-budget-termination.mjs");
  await readText("scripts/run-coding-agent-benchmark-model-loop-rollout-audit.mjs");
  await readText("scripts/run-coding-agent-benchmark-failure-analysis.mjs");
  await readText("scripts/run-coding-agent-benchmark-navigation-candidate-v2.mjs");
  await readText("scripts/run-coding-agent-benchmark-navigation-candidate-v3.mjs");
  await readText("scripts/coding-agent-candidate-evidence.mjs");
  await readText("scripts/coding-agent-candidate-score.mjs");
  await readText("scripts/coding-agent-candidate-qualification.mjs");
  await readText("scripts/run-coding-agent-candidate-global-receipt.mjs");
  await readText("scripts/run-coding-agent-candidate-qualification.mjs");
  await readText("scripts/run-coding-run-client-ci-lane-receipt.mjs");
  const projectMap = await readText("docs/project-map.md");
  const qualityGates = await readText(".github/workflows/quality-gates.yml");

  if (manifest) {
    try {
      await loadCodingAgentBenchmarkManifest(path.join(workspaceRoot, manifestPath));
    } catch (error) {
      failures.push(`coding benchmark manifest failed semantic validation: ${safeMessage(error)}`);
    }
  }
  if (manifestV2) {
    try {
      await loadCodingAgentBenchmarkManifest(path.join(workspaceRoot, manifestV2Path));
    } catch (error) {
      failures.push(`coding benchmark v2 manifest failed semantic validation: ${safeMessage(error)}`);
    }
  }
  if (manifestV3) {
    try {
      await loadCodingAgentBenchmarkManifest(path.join(workspaceRoot, manifestV3Path));
    } catch (error) {
      failures.push(`coding benchmark v3 manifest failed semantic validation: ${safeMessage(error)}`);
    }
    const webUiTask = manifestV3.tasks?.find((task) => task.id === "real-web.ui-regression");
    if (!webUiTask) {
      failures.push("coding benchmark v3 manifest is missing the real-web.ui-regression task.");
    } else {
      try {
        await loadCodingAgentBenchmarkWebUiTruthSet(webUiTask, { workspaceRoot });
      } catch (error) {
        failures.push(
          `coding benchmark v3 Web UI truth set failed semantic validation: ${safeMessage(error)}`,
        );
      }
    }
  }
  if (scorecardV3) {
    try {
      validateCodingAgentBenchmarkScorecardV3(scorecardV3);
    } catch (error) {
      failures.push(`coding benchmark v3 scorecard failed semantic validation: ${safeMessage(error)}`);
    }
  }
  let snapshotReceiptV3Sample;
  if (manifestV3?.repositories?.[0]) {
    const repository = manifestV3.repositories[0];
    snapshotReceiptV3Sample = {
      schemaVersion: CODING_AGENT_BENCHMARK_SNAPSHOT_RECEIPT_VERSION,
      repositoryId: repository.id,
      source: {
        url: repository.source.url,
        commit: repository.source.commit,
        workspaceDirty: false,
        worktreeContentSha256: "1".repeat(64),
        dependencyInputsSha256: "2".repeat(64),
      },
      license: {
        spdx: repository.license.spdx,
        path: repository.license.path,
        sha256: "3".repeat(64),
      },
      dependencyCache: {
        cacheKey: `${repository.id}-${repository.source.commit}`,
        contentSha256: "4".repeat(64),
      },
      policy: {
        preparationNetwork: repository.snapshot.preparationNetwork,
        executionNetwork: repository.snapshot.executionNetwork,
        dependencyPolicy: repository.snapshot.dependencyPolicy,
      },
      preparedAt: "2026-08-05T00:00:00.000Z",
    };
    try {
      validateCodingAgentBenchmarkV3SnapshotReceipt(manifestV3, snapshotReceiptV3Sample);
    } catch (error) {
      failures.push(`coding benchmark v3 snapshot receipt failed semantic validation: ${safeMessage(error)}`);
    }
  }
  validateSchema(failures, "task manifest", manifestSchema, manifest);
  validateSchema(failures, "benchmark run", runSchema);
  validateSchema(failures, "benchmark report", reportSchema);
  validateSchema(failures, "fault injection", faultSchema);
  validateSchema(failures, "cancel injection", cancelSchema);
  validateSchema(failures, "restart injection", restartSchema);
  validateSchema(failures, "v2 task manifest", manifestV2Schema, manifestV2);
  validateSchema(failures, "v2 benchmark run", runV2Schema);
  validateSchema(failures, "v2 benchmark report", reportV2Schema);
  validateSchema(failures, "v2 preflight", preflightSchema);
  validateSchema(failures, "v2 approval contract", approvalContractSchema);
  validateSchema(failures, "v2 approval evidence", approvalEvidenceSchema);
  validateSchema(failures, "v2 fault injection", faultV2Schema);
  validateSchema(failures, "v2 cancel injection", cancelV2Schema);
  validateSchema(failures, "v2 restart injection", restartV2Schema);
  validateSchema(failures, "v3 task manifest", manifestV3Schema, manifestV3);
  validateSchema(failures, "v3 benchmark run", runV3Schema);
  validateSchema(failures, "v3 benchmark report", reportV3Schema);
  validateSchema(failures, "v3 scorecard", scorecardV3Schema, scorecardV3);
  validateSchema(failures, "v3 expected report plan", expectedReportPlanV3Schema);
  validateSchema(failures, "v3 retained expected reports", expectedReportsV3Schema);
  validateSchema(failures, "v3 repository inputs", repositoryInputsV3Schema);
  validateSchema(failures, "v3 Linux snapshot preparation", linuxSnapshotPreparationV3Schema);
  validateSchema(failures, "v3 runtime preflight", runtimePreflightV3Schema);
  validateSchema(failures, "v3 repository snapshot preflight", snapshotPreflightV3Schema);
  validateSchema(failures, "v3 repository snapshot receipt", snapshotReceiptV3Schema, snapshotReceiptV3Sample);
  validateSchema(failures, "v3 system scenario", systemScenarioV3Schema);
  validateSchema(failures, "v3 system evidence", systemEvidenceV3Schema);
  validateSchema(failures, "v3 navigation efficiency", navigationEfficiencyV3Schema);
  validateSchema(failures, "v3 navigation shadow canary", navigationShadowCanaryV3Schema);
  validateSchema(failures, "v3 navigation shadow real", navigationShadowRealV3Schema);
  validateSchema(failures, "v3 navigation shadow real v2", navigationShadowRealV2V3Schema);
  validateSchema(failures, "v3 navigation shadow real candidate v3", navigationShadowRealCandidateV3Schema);
  validateSchema(failures, "v3 navigation shadow analysis", navigationShadowAnalysisV3Schema);
  validateSchema(
    failures,
    "v3 navigation shadow v2 analysis",
    navigationShadowV2AnalysisV3Schema,
  );
  validateSchema(
    failures,
    "v3 navigation shadow v3 analysis",
    navigationShadowV3AnalysisV3Schema,
  );
  validateSchema(
    failures,
    "v3 model-loop budget termination",
    modelLoopBudgetTerminationV3Schema,
  );
  validateSchema(failures, "v3 failure analysis", failureAnalysisV3Schema);
  validateSchema(failures, "v3 navigation candidate v2", navigationCandidateV2V3Schema);
  validateSchema(failures, "v3 navigation candidate v3", navigationCandidateV3V3Schema);
  validateSchema(failures, "v3 candidate-global runner input", candidateGlobalRunnerInputV3Schema);
  validateSchema(failures, "v3 candidate-global receipt", candidateGlobalReceiptV3Schema);
  validateSchema(failures, "v3 candidate qualification report", candidateQualificationReportV3Schema);
  validateSchema(
    failures,
    "v3 candidate dimension mapping",
    candidateDimensionMappingV3Schema,
    candidateDimensionMappingV3,
  );
  validateSchema(
    failures,
    "v3 candidate dimension evidence reference",
    candidateDimensionEvidenceReferenceV3Schema,
  );
  validateSchema(
    failures,
    "v3 candidate Supervisor evidence receipt",
    candidateSupervisorEvidenceReceiptV3Schema,
  );
  validateSchema(
    failures,
    "v3 candidate Verification evidence receipt",
    candidateVerificationEvidenceReceiptV3Schema,
  );
  validateSchema(
    failures,
    "v3 candidate coding-run client evidence receipt",
    candidateCodingRunClientEvidenceReceiptV3Schema,
  );
  validateSchema(
    failures,
    "v3 candidate coding-run client CI evidence receipt",
    candidateCodingRunClientCiEvidenceReceiptV3Schema,
  );
  validateSchema(
    failures,
    "v3 coding-run client CI lane evidence",
    codingRunClientCiLaneEvidenceV3Schema,
  );
  validateSchema(failures, "v3 Web UI truth set", webUiTruthSetV3Schema, webUiTruthSetV3);
  if (JSON.stringify(benchmarkAgentsV2) !== JSON.stringify({
    agents: [CODING_AGENT_BENCHMARK_COMMAND_CONTROL_AGENT_PROFILE],
  })) {
    failures.push("v2 benchmark Agent profile drifted from the isolated command-control contract.");
  }

  if (manifestSchema?.properties?.schemaVersion?.const !== CODING_AGENT_BENCHMARK_MANIFEST_VERSION) {
    failures.push("task manifest Schema version drifted from the public contract.");
  }
  if (runSchema?.properties?.schemaVersion?.const !== CODING_AGENT_BENCHMARK_RUN_VERSION) {
    failures.push("benchmark run Schema version drifted from the public contract.");
  }
  if (reportSchema?.properties?.schemaVersion?.const !== CODING_AGENT_BENCHMARK_REPORT_VERSION) {
    failures.push("benchmark report Schema version drifted from the public contract.");
  }
  if (manifestV2Schema?.properties?.schemaVersion?.const !== CODING_AGENT_BENCHMARK_MANIFEST_V2_VERSION) {
    failures.push("v2 task manifest Schema version drifted from the corrected contract.");
  }
  if (runV2Schema?.properties?.schemaVersion?.const !== CODING_AGENT_BENCHMARK_RUN_V2_VERSION) {
    failures.push("v2 benchmark run Schema version drifted from the corrected contract.");
  }
  if (reportV2Schema?.properties?.schemaVersion?.const !== CODING_AGENT_BENCHMARK_REPORT_V2_VERSION) {
    failures.push("v2 benchmark report Schema version drifted from the corrected contract.");
  }
  if (manifestV3Schema?.properties?.schemaVersion?.const !== CODING_AGENT_BENCHMARK_MANIFEST_V3_VERSION) {
    failures.push("v3 task manifest Schema version drifted from the external-validity contract.");
  }
  if (runV3Schema?.properties?.schemaVersion?.const !== CODING_AGENT_BENCHMARK_RUN_V3_VERSION) {
    failures.push("v3 benchmark run Schema version drifted from the external-validity contract.");
  }
  if (reportV3Schema?.properties?.schemaVersion?.const !== CODING_AGENT_BENCHMARK_REPORT_V3_VERSION) {
    failures.push("v3 benchmark report Schema version drifted from the external-validity contract.");
  }
  if (webUiTruthSetV3Schema?.properties?.schemaVersion?.const
    !== CODING_AGENT_BENCHMARK_WEB_UI_TRUTH_SET_VERSION) {
    failures.push("v3 Web UI truth set Schema version drifted from the frozen behavior contract.");
  }
  if (failureAnalysisV3Schema?.properties?.schemaVersion?.const
    !== CODING_AGENT_BENCHMARK_FAILURE_ANALYSIS_VERSION) {
    failures.push("v3 failure analysis Schema version drifted from its offline evidence contract.");
  }
  if (scorecardV3Schema?.properties?.schemaVersion?.const !== CODING_AGENT_BENCHMARK_SCORECARD_V3_VERSION) {
    failures.push("v3 scorecard Schema version drifted from the 9.5 target contract.");
  }
  if (expectedReportPlanV3Schema?.properties?.schemaVersion?.const
    !== CODING_AGENT_EXPECTED_REPORT_PLAN_VERSION) {
    failures.push("v3 expected report plan Schema version drifted from the aggregate CLI contract.");
  }
  if (expectedReportsV3Schema?.properties?.schemaVersion?.const
    !== CODING_AGENT_EXPECTED_REPORT_EVIDENCE_VERSION) {
    failures.push("v3 retained expected reports Schema version drifted from the aggregate evidence contract.");
  }
  if (candidateGlobalRunnerInputV3Schema?.properties?.schemaVersion?.const
    !== CODING_AGENT_CANDIDATE_GLOBAL_RUNNER_INPUT_VERSION) {
    failures.push("v3 candidate-global runner input Schema version drifted from the CLI contract.");
  }
  if (candidateGlobalReceiptV3Schema?.properties?.schemaVersion?.const
    !== "coding-agent-benchmark-candidate-global-receipt/v1") {
    failures.push("v3 candidate-global receipt Schema version drifted from the qualification contract.");
  }
  if (candidateQualificationReportV3Schema?.properties?.schemaVersion?.const
    !== CODING_AGENT_CANDIDATE_QUALIFICATION_REPORT_VERSION) {
    failures.push("v3 candidate qualification report Schema version drifted from the writer contract.");
  }
  if (candidateQualificationReportV3Schema?.$defs?.partialDecision?.properties?.schemaVersion?.const
    !== CODING_AGENT_CANDIDATE_QUALIFICATION_VERSION) {
    failures.push("v3 candidate qualification decision Schema version drifted from the evaluator contract.");
  }
  if (candidateQualificationReportV3Schema?.$defs?.source?.properties?.evidence?.properties
    ?.schemaVersion?.const !== CODING_AGENT_QUALIFICATION_EVIDENCE_DIGEST_VERSION) {
    failures.push("v3 qualification evidence digest Schema version drifted from the writer contract.");
  }
  if (candidateDimensionMappingV3?.schemaVersion
    !== CODING_AGENT_CANDIDATE_DIMENSION_MAPPING_VERSION
    || candidateDimensionMappingV3Schema?.properties?.schemaVersion?.const
      !== CODING_AGENT_CANDIDATE_DIMENSION_MAPPING_VERSION) {
    failures.push("v3 candidate dimension mapping version drifted from the score loader contract.");
  }
  if (candidateDimensionEvidenceReferenceV3Schema?.properties?.schemaVersion?.const
    !== CODING_AGENT_CANDIDATE_DIMENSION_EVIDENCE_REFERENCE_VERSION) {
    failures.push(
      "v3 candidate dimension evidence reference Schema version drifted from the score loader contract.",
    );
  }
  if (candidateSupervisorEvidenceReceiptV3Schema?.properties?.schemaVersion?.const
    !== CODING_AGENT_CANDIDATE_SUPERVISOR_EVIDENCE_RECEIPT_VERSION) {
    failures.push(
      "v3 candidate Supervisor evidence receipt Schema version drifted from the score loader contract.",
    );
  }
  if (candidateVerificationEvidenceReceiptV3Schema?.properties?.schemaVersion?.const
    !== CODING_AGENT_CANDIDATE_VERIFICATION_EVIDENCE_RECEIPT_VERSION) {
    failures.push(
      "v3 candidate Verification evidence receipt Schema version drifted from the score loader contract.",
    );
  }
  if (candidateCodingRunClientEvidenceReceiptV3Schema?.properties?.schemaVersion?.const
    !== CODING_AGENT_CANDIDATE_CODING_RUN_CLIENT_EVIDENCE_RECEIPT_VERSION) {
    failures.push(
      "v3 candidate coding-run client evidence receipt Schema version drifted from the score loader contract.",
    );
  }
  if (candidateCodingRunClientCiEvidenceReceiptV3Schema?.properties?.schemaVersion?.const
    !== CODING_AGENT_CANDIDATE_CODING_RUN_CLIENT_CI_EVIDENCE_RECEIPT_VERSION) {
    failures.push(
      "v3 candidate coding-run client CI evidence receipt Schema version drifted from the score loader contract.",
    );
  }
  if (codingRunClientCiLaneEvidenceV3Schema?.properties?.schemaVersion?.const
    !== CODING_RUN_CLIENT_CI_LANE_EVIDENCE_VERSION) {
    failures.push(
      "v3 coding-run client CI lane evidence Schema version drifted from the workflow producer contract.",
    );
  }
  if (snapshotReceiptV3Schema?.properties?.schemaVersion?.const
    !== CODING_AGENT_BENCHMARK_SNAPSHOT_RECEIPT_VERSION) {
    failures.push("v3 repository snapshot receipt Schema version drifted from the preparation contract.");
  }
  if (repositoryInputsV3Schema?.properties?.schemaVersion?.const
    !== "coding-agent-benchmark-repository-inputs/v1") {
    failures.push("v3 repository inputs Schema version drifted from the runner CLI contract.");
  }
  if (linuxSnapshotPreparationV3Schema?.properties?.schemaVersion?.const
    !== CODING_AGENT_BENCHMARK_LINUX_SNAPSHOT_PREPARATION_VERSION) {
    failures.push("v3 Linux snapshot preparation Schema version drifted from the preparation owner.");
  }
  if (runtimePreflightV3Schema?.properties?.manifestRevision?.const !== "v3") {
    failures.push("v3 runtime preflight Schema drifted from the v3 manifest binding.");
  }
  const runtimeEntrypoints = runtimePreflightV3Schema?.$defs?.contractSource?.properties?.entrypoints?.properties;
  for (const entrypoint of [
    "workflowBatchRunner",
    "managedWorktree",
    "userWorktreeRuntime",
    "reconciliationJournal",
    "workspaceRevision",
    "fileTool",
  ]) {
    if (runtimeEntrypoints?.[entrypoint]?.$ref !== "#/$defs/entrypoint") {
      failures.push(`v3 runtime preflight Schema must expose the ${entrypoint} identity.`);
    }
  }
  if (snapshotPreflightV3Schema?.properties?.schemaVersion?.const
    !== "coding-agent-benchmark-snapshot-preflight/v1") {
    failures.push("v3 repository snapshot preflight Schema version drifted from the Provider contract.");
  }
  if (systemScenarioV3Schema?.properties?.schemaVersion?.const
    !== "coding-agent-benchmark-system-scenario/v1") {
    failures.push("v3 system scenario Schema version drifted from the system Provider contract.");
  }
  if (systemEvidenceV3Schema?.$defs?.harnessEvidence?.properties?.schemaVersion?.const
    !== "coding-agent-benchmark-system-evidence/v1"
    || systemEvidenceV3Schema?.$defs?.notRunEvidence?.properties?.schemaVersion?.const
      !== "coding-agent-benchmark-system-evidence-not-run/v1") {
    failures.push("v3 system evidence Schema versions drifted from the harness contract.");
  }
  if (navigationEfficiencyV3Schema?.properties?.schemaVersion?.const
    !== CODING_AGENT_BENCHMARK_NAVIGATION_EFFICIENCY_VERSION) {
    failures.push("v3 navigation efficiency Schema version drifted from the offline probe contract.");
  }
  if (navigationShadowCanaryV3Schema?.properties?.schemaVersion?.const
    !== CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_CANARY_VERSION) {
    failures.push("v3 navigation shadow canary Schema version drifted from the authorization contract.");
  }
  if (navigationShadowRealV3Schema?.properties?.schemaVersion?.const
    !== CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_REAL_VERSION) {
    failures.push("v3 navigation shadow real Schema version drifted from the confirmed execution contract.");
  }
  if (navigationShadowRealV2V3Schema?.properties?.schemaVersion?.const
    !== CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_REAL_V2_VERSION) {
    failures.push("v3 navigation shadow real v2 Schema version drifted from the candidate v2 contract.");
  }
  if (navigationShadowRealCandidateV3Schema?.properties?.schemaVersion?.const
    !== CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_REAL_V3_VERSION) {
    failures.push("v3 navigation shadow real v3 Schema version drifted from the runtime-contract candidate.");
  }
  if (navigationShadowAnalysisV3Schema?.properties?.schemaVersion?.const
    !== CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_ANALYSIS_VERSION) {
    failures.push("v3 navigation shadow analysis Schema version drifted from the offline decision contract.");
  }
  if (navigationShadowV2AnalysisV3Schema?.properties?.schemaVersion?.const
    !== CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_V2_ANALYSIS_VERSION) {
    failures.push("v3 navigation shadow v2 analysis Schema version drifted from the runtime-contract decision.");
  }
  if (navigationShadowV3AnalysisV3Schema?.properties?.schemaVersion?.const
    !== CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_V3_ANALYSIS_VERSION) {
    failures.push("v3 navigation shadow v3 analysis Schema version drifted from the candidate-line decision.");
  }
  if (modelLoopBudgetTerminationV3Schema?.properties?.schemaVersion?.const
    !== CODING_AGENT_BENCHMARK_MODEL_LOOP_BUDGET_TERMINATION_VERSION) {
    failures.push("v3 model-loop budget termination Schema version drifted from the cost-containment contract.");
  }
  if (modelLoopRolloutAuditV3Schema?.properties?.schemaVersion?.const
    !== CODING_AGENT_BENCHMARK_MODEL_LOOP_ROLLOUT_AUDIT_VERSION) {
    failures.push("v3 model-loop rollout audit Schema version drifted from the rollout safety contract.");
  }
  if (navigationCandidateV2V3Schema?.properties?.schemaVersion?.const
    !== CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V2_VERSION) {
    failures.push("v3 navigation candidate v2 Schema version drifted from the offline preflight contract.");
  }
  if (navigationCandidateV3V3Schema?.properties?.schemaVersion?.const
    !== CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_VERSION) {
    failures.push("v3 navigation candidate v3 Schema version drifted from the runtime preflight contract.");
  }
  if (packageJson?.scripts?.["verify:coding-benchmark"]
    !== "node --import tsx scripts/verify-coding-agent-benchmark-contract.mjs") {
    failures.push("package.json must expose verify:coding-benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:v3:prepare-linux"]
    !== "node scripts/coding-agent-benchmark-linux-snapshot-preparation.mjs") {
    failures.push("package.json must expose benchmark:coding-agent:v3:prepare-linux.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:v3:navigation-efficiency"]
    !== "node scripts/run-coding-agent-benchmark-navigation-efficiency.mjs") {
    failures.push("package.json must expose benchmark:coding-agent:v3:navigation-efficiency.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:v3:navigation-shadow-dry-run"]
    !== "node scripts/run-coding-agent-benchmark-navigation-shadow-canary.mjs") {
    failures.push("package.json must expose benchmark:coding-agent:v3:navigation-shadow-dry-run.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:v3:navigation-shadow-real"]
    !== "node scripts/run-coding-agent-benchmark-navigation-shadow-real.mjs") {
    failures.push("package.json must expose benchmark:coding-agent:v3:navigation-shadow-real.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:v3:navigation-shadow-real-v2"]
    !== "node scripts/run-coding-agent-benchmark-navigation-shadow-real-v2.mjs") {
    failures.push("package.json must expose benchmark:coding-agent:v3:navigation-shadow-real-v2.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:v3:navigation-shadow-real-v3"]
    !== "node scripts/run-coding-agent-benchmark-navigation-shadow-real-v3.mjs") {
    failures.push("package.json must expose benchmark:coding-agent:v3:navigation-shadow-real-v3.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:v3:navigation-shadow-analysis"]
    !== "node scripts/run-coding-agent-benchmark-navigation-shadow-analysis.mjs") {
    failures.push("package.json must expose benchmark:coding-agent:v3:navigation-shadow-analysis.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:v3:navigation-shadow-v2-analysis"]
    !== "node scripts/run-coding-agent-benchmark-navigation-shadow-v2-analysis.mjs") {
    failures.push("package.json must expose benchmark:coding-agent:v3:navigation-shadow-v2-analysis.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:v3:navigation-shadow-v3-analysis"]
    !== "node scripts/run-coding-agent-benchmark-navigation-shadow-v3-analysis.mjs") {
    failures.push("package.json must expose benchmark:coding-agent:v3:navigation-shadow-v3-analysis.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:v3:model-loop-budget-termination"]
    !== "node scripts/run-coding-agent-benchmark-model-loop-budget-termination.mjs") {
    failures.push("package.json must expose benchmark:coding-agent:v3:model-loop-budget-termination.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:v3:model-loop-rollout-audit"]
    !== "node scripts/run-coding-agent-benchmark-model-loop-rollout-audit.mjs") {
    failures.push("package.json must expose benchmark:coding-agent:v3:model-loop-rollout-audit.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:v3:navigation-candidate-v2"]
    !== "node scripts/run-coding-agent-benchmark-navigation-candidate-v2.mjs") {
    failures.push("package.json must expose benchmark:coding-agent:v3:navigation-candidate-v2.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:v3:navigation-candidate-v3"]
    !== "node scripts/run-coding-agent-benchmark-navigation-candidate-v3.mjs") {
    failures.push("package.json must expose benchmark:coding-agent:v3:navigation-candidate-v3.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:v3:candidate-global-receipt"]
    !== "node --import tsx scripts/run-coding-agent-candidate-global-receipt.mjs") {
    failures.push("package.json must expose benchmark:coding-agent:v3:candidate-global-receipt.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:v3:candidate-qualification"]
    !== "node --import tsx scripts/run-coding-agent-candidate-qualification.mjs") {
    failures.push("package.json must expose benchmark:coding-agent:v3:candidate-qualification.");
  }
  if (packageJson?.scripts?.["verify:coding-run-client"]
    !== EXPECTED_CODING_RUN_CLIENT_AUDIT_SCRIPT) {
    failures.push("package.json must expose verify:coding-run-client.");
  }
  if (packageJson?.scripts?.["verify:p1b-verification-audit"]
    !== EXPECTED_P1B_VERIFICATION_AUDIT_SCRIPT) {
    failures.push("package.json must expose verify:p1b-verification-audit.");
  }
  if (packageJson?.scripts?.["verify:p2a-supervisor-fault-audit"]
    !== EXPECTED_P2A_SUPERVISOR_FAULT_AUDIT_SCRIPT) {
    failures.push("package.json must expose verify:p2a-supervisor-fault-audit.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0b"]
    !== "node scripts/run-coding-agent-benchmark.mjs --platform windows-native") {
    failures.push("package.json must expose benchmark:coding-agent:stage0b.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0c:wsl"]
    !== "node scripts/run-coding-agent-benchmark-wsl.mjs") {
    failures.push("package.json must expose benchmark:coding-agent:stage0c:wsl.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0c:interactive:windows"]
    !== "node scripts/run-coding-agent-benchmark.mjs --platform windows-native --task-id command.interactive-control") {
    failures.push("package.json must expose the Windows interactive-control benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0c:interactive:wsl"]
    !== "node scripts/run-coding-agent-benchmark-wsl.mjs --task-id command.interactive-control") {
    failures.push("package.json must expose the WSL2 interactive-control benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0c:safety:windows"]
    !== "node scripts/run-coding-agent-benchmark.mjs --platform windows-native --task-id safety.boundary-enforcement") {
    failures.push("package.json must expose the Windows safety-boundary benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0c:safety:wsl"]
    !== "node scripts/run-coding-agent-benchmark-wsl.mjs --task-id safety.boundary-enforcement") {
    failures.push("package.json must expose the WSL2 safety-boundary benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0c:recovery:windows"]
    !== "node scripts/run-coding-agent-benchmark.mjs --platform windows-native --task-id gateway.disconnect-recovery") {
    failures.push("package.json must expose the Windows gateway-recovery benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0c:recovery:wsl"]
    !== "node scripts/run-coding-agent-benchmark-wsl.mjs --task-id gateway.disconnect-recovery") {
    failures.push("package.json must expose the WSL2 gateway-recovery benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0c:cancel:windows"]
    !== "node scripts/run-coding-agent-benchmark.mjs --platform windows-native --task-id gateway.client-cancel") {
    failures.push("package.json must expose the Windows client-cancel benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0c:cancel:wsl"]
    !== "node scripts/run-coding-agent-benchmark-wsl.mjs --task-id gateway.client-cancel") {
    failures.push("package.json must expose the WSL2 client-cancel benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0c:restart:windows"]
    !== "node scripts/run-coding-agent-benchmark.mjs --platform windows-native --task-id gateway.process-restart") {
    failures.push("package.json must expose the Windows Gateway process-restart benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0c:restart:wsl"]
    !== "node scripts/run-coding-agent-benchmark-wsl.mjs --task-id gateway.process-restart") {
    failures.push("package.json must expose the WSL2 Gateway process-restart benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0c:git:windows"]
    !== "node scripts/run-coding-agent-benchmark.mjs --platform windows-native --task-id git.dirty-worktree,git.delivery-guard") {
    failures.push("package.json must expose the Windows Git local-delivery benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0c:git:wsl"]
    !== "node scripts/run-coding-agent-benchmark-wsl.mjs --task-id git.dirty-worktree,git.delivery-guard") {
    failures.push("package.json must expose the WSL2 Git local-delivery benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0d:core:windows"]
    !== "node scripts/run-coding-agent-benchmark.mjs --platform windows-native --task-id feature.cross-file,tests.failed-diagnosis,navigation.large-repository") {
    failures.push("package.json must expose the Windows Stage 0D core benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0d:core:wsl"]
    !== "node scripts/run-coding-agent-benchmark-wsl.mjs --task-id feature.cross-file,tests.failed-diagnosis,navigation.large-repository") {
    failures.push("package.json must expose the WSL2 Stage 0D core benchmark.");
  }
  if (packageJson?.scripts?.["aggregate:coding-agent:baseline"]
    !== "node scripts/aggregate-coding-agent-benchmark.mjs") {
    failures.push("package.json must expose the Stage 0D baseline aggregator.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:v3:failure-analysis"]
    !== "node scripts/run-coding-agent-benchmark-failure-analysis.mjs") {
    failures.push("package.json must expose the v3 offline failure analysis.");
  }
  if (manifest) validateRunnerProfiles(failures, manifest, "v1");
  if (manifestV2) validateRunnerProfiles(failures, manifestV2, "v2");
  for (const requiredText of [
    "coding-agent-benchmark-manifest/v1",
    "coding-agent-benchmark-run/v1",
    "coding-agent-benchmark-report/v1",
    "coding-agent-benchmark-manifest/v2",
    "coding-agent-benchmark-run/v2",
    "coding-agent-benchmark-report/v2",
    "coding-agent-benchmark-manifest/v3",
    "coding-agent-benchmark-run/v3",
    "coding-agent-benchmark-report/v3",
    "coding-agent-benchmark-scorecard/v3",
    "coding-agent-benchmark-expected-report-plan/v1",
    "coding-agent-benchmark-expected-reports/v1",
    "coding-agent-benchmark-snapshot-receipt/v1",
    "coding-agent-benchmark-linux-snapshot-preparation/v1",
    "coding-agent-benchmark-failure-analysis/v1",
    "coding-agent-benchmark-repository-inputs/v1",
    "linux-snapshot-preparation.schema.json",
    "repository-inputs.schema.json",
    "repository-snapshot-preflight.schema.json",
    "repository-snapshot-receipt.schema.json",
    "system-scenario.schema.json",
    "system-evidence.schema.json",
    "navigation-efficiency.schema.json",
    "navigation-shadow-canary.schema.json",
    "navigation-shadow-real.schema.json",
    "navigation-shadow-real-v2.schema.json",
    "navigation-shadow-real-v3.schema.json",
    "navigation-shadow-v2-analysis.schema.json",
    "navigation-shadow-v3-analysis.schema.json",
    "model-loop-budget-termination.schema.json",
    "model-loop-rollout-audit.schema.json",
    "failure-analysis.schema.json",
    "systemBrowserScreenshot",
    "browser-screenshot.png",
    "coding-agent-benchmark-parallel-read-harness.mjs",
    "coding-agent-benchmark-parallel-write-harness.mjs",
    "coding-agent-benchmark-restart-delivery-harness.mjs",
    "run-coding-agent-benchmark-system-smoke.mjs",
    "coding-agent-benchmark-linux-snapshot-preparation.mjs",
    "coding-agent-benchmark-system-smoke/v1",
    "coding-agent-benchmark-navigation-efficiency/v1",
    "benchmark:coding-agent:v3:navigation-shadow-dry-run",
    "coding-agent-benchmark-navigation-shadow-canary/v1",
    "benchmark:coding-agent:v3:navigation-shadow-real",
    "coding-agent-benchmark-navigation-shadow-real/v1",
    "benchmark:coding-agent:v3:navigation-shadow-real-v2",
    "coding-agent-benchmark-navigation-shadow-real-v2/v1",
    "benchmark:coding-agent:v3:navigation-shadow-real-v3",
    "coding-agent-benchmark-navigation-shadow-real-v3/v1",
    "benchmark:coding-agent:v3:navigation-shadow-analysis",
    "coding-agent-benchmark-navigation-shadow-analysis/v1",
    "benchmark:coding-agent:v3:navigation-shadow-v2-analysis",
    "coding-agent-benchmark-navigation-shadow-v2-analysis/v1",
    "benchmark:coding-agent:v3:navigation-shadow-v3-analysis",
    "coding-agent-benchmark-navigation-shadow-v3-analysis/v1",
    "benchmark:coding-agent:v3:model-loop-budget-termination",
    "coding-agent-benchmark-model-loop-budget-termination/v1",
    "benchmark:coding-agent:v3:model-loop-rollout-audit",
    "coding-agent-benchmark-model-loop-rollout-audit/v1",
    "hold_explicit_opt_in",
    "defaultEnablementAllowed",
    "realProviderCanaryAllowed",
    "cost-containment-v1",
    "taskUplift",
    "tool_argument_guard_reduces_response_surface_but_not_model_loop_budget",
    "separate-model-loop-budget-and-termination-contract",
    "prompt_only_navigation_contract_not_runtime_stable",
    "navigation-candidate-v3-runtime-contract-required",
    "benchmark:coding-agent:v3:navigation-candidate-v2",
    "coding-agent-benchmark-navigation-candidate-v2/v1",
    "bounded-localize-before-read/v1",
    "prompt_contract",
    "runtimeToolGuard",
    "maxResults=4",
    "contextLines=5",
    "navigation-candidate-v2.schema.json",
    "workspace-write-navigation-candidate-v2",
    "benchmark:coding-agent:v3:navigation-candidate-v3",
    "coding-agent-benchmark-navigation-candidate-v3/v1",
    "navigation-candidate-v3.schema.json",
    "workspace-write-navigation-candidate-v3",
    "bounded-navigation-runtime-contract/v1",
    "bounded-navigation-v1",
    "runtime_contract",
    "do_not_promote",
    "pending_confirmation",
    "benchmark:coding-agent:v3:navigation-efficiency",
    "tokenImpact",
    "no_model_call",
    "workflowBatchRunner",
    "managedWorktree",
    "userWorktreeRuntime",
    "reconciliationJournal",
    "workspaceRevision",
    "fileTool",
    "--v3-repository-config",
    "repository-snapshot-preflight.json",
    "system-evidence.json",
    "144",
    "--manifest-revision v2",
    "aggregate:coding-agent:baseline --manifest-revision v2",
    "aggregate:coding-agent:baseline --manifest-revision v3",
    "--expected-report-plan",
    "expected-reports.json",
    "--source-root",
    "preflight.json",
    "v2/agents.json",
    "taskBudgetOverrides",
    "maxTokens=36000",
    "maxTokens=32000",
    "maxHighRiskToolCalls=5",
    "approval-contract.json",
    "approval-evidence.json",
    "阶段 0A",
    "阶段 0B",
    "benchmark:coding-agent:stage0b",
    "benchmark:coding-agent:v3:prepare-linux",
    "benchmark:coding-agent:stage0c:wsl",
    "benchmark:coding-agent:stage0c:wsl --manifest-revision v3",
    "benchmark:coding-agent:stage0c:interactive:windows",
    "benchmark:coding-agent:stage0c:interactive:wsl",
    "benchmark:coding-agent:stage0c:safety:windows",
    "benchmark:coding-agent:stage0c:safety:wsl",
    "benchmark:coding-agent:stage0c:recovery:windows",
    "benchmark:coding-agent:stage0c:recovery:wsl",
    "benchmark:coding-agent:stage0c:cancel:windows",
    "benchmark:coding-agent:stage0c:cancel:wsl",
    "benchmark:coding-agent:stage0c:restart:windows",
    "benchmark:coding-agent:stage0c:restart:wsl",
    "benchmark:coding-agent:stage0c:git:windows",
    "benchmark:coding-agent:stage0c:git:wsl",
    "benchmark:coding-agent:stage0d:core:windows",
    "benchmark:coding-agent:stage0d:core:wsl",
    "aggregate:coding-agent:baseline",
    "benchmark:coding-agent:v3:failure-analysis",
    "benchmark:coding-agent:v3:candidate-global-receipt",
    "candidate-global-runner-input.schema.json",
    "sensitiveValueEnvironmentVariables",
    "benchmark:coding-agent:v3:candidate-qualification",
    "coding-agent-benchmark-candidate-qualification-report/v1",
    "candidate-qualification.json",
    "candidate-dimension-mapping.json",
    "candidate-dimension-evidence-reference.json",
    "coding-agent-benchmark-candidate-supervisor-evidence-receipt/v1",
    "session_long_running",
    "supervisor_dual_platform_60_minute_soak",
    "bounded_budget_cancel_restart_reattach",
    "managed_worktree_fan_in_review_remediation",
    "parallel_resource_convergence",
    "coding-agent-benchmark-candidate-verification-evidence-receipt/v1",
    "coding-agent-benchmark-candidate-coding-run-client-evidence-receipt/v1",
    "coding-agent-benchmark-candidate-coding-run-client-ci-evidence-receipt/v1",
    "coding-agent-benchmark-coding-run-client-ci-lane-evidence/v1",
    "headless_ecosystem",
    "external_consumer_pair_lifecycle",
    "protocol_version_conformance",
    "error_taxonomy_cancellation_conformance",
    "real_ci_consumer_binding",
    "verify:coding-run-client",
    "verify:p1b-verification-audit",
    "verify:p2a-supervisor-fault-audit",
    "baseline-index.json",
    "command.interactive-control",
    "safety.boundary-enforcement",
    "gateway.disconnect-recovery",
    "gateway.client-cancel",
    "gateway.process-restart",
    "git.dirty-worktree",
    "git.delivery-guard",
    "feature.cross-file",
    "tests.failed-diagnosis",
    "navigation.large-repository",
    "git-local",
    "fault-injection.json",
    "cancel-injection.json",
    "restart-injection.json",
    "CODING_BENCHMARK_EVENTS_PATH",
    "BELLDANDY_DANGEROUS_TOOLS_ENABLED=true",
    "--prior-observed-cost-usd",
    "WSLENV",
    "回退到 primary",
    "coding-agent-benchmark-fixtures.mjs",
    "coding-agent-benchmark-v3-fixtures.mjs",
    "coding-agent-benchmark-v3-web-ui-truth-set.mjs",
    "coding-agent-benchmark-web-ui-truth-set/v1",
    "real-web-ui-regression-truth-set.json",
    "real-web-ui-regression-truth-set.schema.json",
    "real-web-ui-regression-v2",
    "工作区外",
  ]) {
    if (!readme.includes(requiredText)) {
      failures.push(`coding benchmark README must document ${requiredText}.`);
    }
  }
  for (const requiredPath of [
    "benchmarks/coding-agent/v1/",
    "benchmarks/coding-agent/v2/",
    "benchmarks/coding-agent/v2/agents.json",
    "benchmarks/coding-agent/v3/",
    "scripts/coding-agent-benchmark-contract.mjs",
    "scripts/coding-agent-benchmark-v3-contract.mjs",
    "scripts/coding-agent-benchmark-v3-fixtures.mjs",
    "scripts/coding-agent-benchmark-v3-web-ui-truth-set.mjs",
    "benchmarks/coding-agent/v3/real-web-ui-regression-truth-set.json",
    "benchmarks/coding-agent/v3/real-web-ui-regression-truth-set.schema.json",
    "scripts/coding-agent-benchmark-linux-snapshot-preparation.mjs",
    "scripts/coding-agent-benchmark-parallel-read-harness.mjs",
    "scripts/coding-agent-benchmark-system-harness.mjs",
    "scripts/coding-agent-benchmark-fixtures.mjs",
    "scripts/coding-agent-benchmark-approval.mjs",
    "scripts/coding-agent-benchmark-preflight.mjs",
    "scripts/coding-agent-recovery-harness.mjs",
    "scripts/coding-agent-process-restart-harness.mjs",
    "scripts/coding-agent-process-restart-gateway.mjs",
    "scripts/aggregate-coding-agent-benchmark.mjs",
    "scripts/run-coding-agent-benchmark.mjs",
    "scripts/run-coding-agent-benchmark-wsl.mjs",
    "scripts/run-coding-agent-benchmark-system-smoke.mjs",
    "scripts/run-coding-agent-benchmark-navigation-efficiency.mjs",
    "benchmarks/coding-agent/v3/navigation-efficiency.schema.json",
    "scripts/run-coding-agent-benchmark-navigation-shadow-canary.mjs",
    "benchmarks/coding-agent/v3/navigation-shadow-canary.schema.json",
    "scripts/run-coding-agent-benchmark-navigation-shadow-real.mjs",
    "benchmarks/coding-agent/v3/navigation-shadow-real.schema.json",
    "scripts/run-coding-agent-benchmark-navigation-shadow-real-v2.mjs",
    "benchmarks/coding-agent/v3/navigation-shadow-real-v2.schema.json",
    "scripts/run-coding-agent-benchmark-navigation-shadow-real-v3.mjs",
    "benchmarks/coding-agent/v3/navigation-shadow-real-v3.schema.json",
    "scripts/run-coding-agent-benchmark-navigation-shadow-analysis.mjs",
    "benchmarks/coding-agent/v3/navigation-shadow-analysis.schema.json",
    "scripts/run-coding-agent-benchmark-navigation-shadow-v2-analysis.mjs",
    "benchmarks/coding-agent/v3/navigation-shadow-v2-analysis.schema.json",
    "scripts/run-coding-agent-benchmark-navigation-shadow-v3-analysis.mjs",
    "benchmarks/coding-agent/v3/navigation-shadow-v3-analysis.schema.json",
    "scripts/run-coding-agent-benchmark-model-loop-budget-termination.mjs",
    "benchmarks/coding-agent/v3/model-loop-budget-termination.schema.json",
    "scripts/run-coding-agent-benchmark-model-loop-rollout-audit.mjs",
    "benchmarks/coding-agent/v3/model-loop-rollout-audit.schema.json",
    "scripts/run-coding-agent-benchmark-failure-analysis.mjs",
    "benchmarks/coding-agent/v3/failure-analysis.schema.json",
    "scripts/run-coding-agent-benchmark-navigation-candidate-v2.mjs",
    "benchmarks/coding-agent/v3/navigation-candidate-v2.schema.json",
    "scripts/run-coding-agent-benchmark-navigation-candidate-v3.mjs",
    "benchmarks/coding-agent/v3/navigation-candidate-v3.schema.json",
    "scripts/coding-agent-candidate-evidence.mjs",
    "scripts/coding-agent-candidate-score.mjs",
    "scripts/coding-agent-candidate-qualification.mjs",
    "scripts/run-coding-agent-candidate-global-receipt.mjs",
    "scripts/run-coding-agent-candidate-qualification.mjs",
    "benchmarks/coding-agent/v3/expected-report-plan.schema.json",
    "benchmarks/coding-agent/v3/expected-reports.schema.json",
    "benchmarks/coding-agent/v3/candidate-global-runner-input.schema.json",
    "benchmarks/coding-agent/v3/candidate-global-receipt.schema.json",
    "benchmarks/coding-agent/v3/candidate-qualification-report.schema.json",
    "benchmarks/coding-agent/v3/candidate-dimension-mapping.json",
    "benchmarks/coding-agent/v3/candidate-dimension-mapping.schema.json",
    "benchmarks/coding-agent/v3/candidate-dimension-evidence-reference.schema.json",
    "benchmarks/coding-agent/v3/candidate-supervisor-evidence-receipt.schema.json",
    "benchmarks/coding-agent/v3/candidate-verification-evidence-receipt.schema.json",
    "benchmarks/coding-agent/v3/candidate-coding-run-client-evidence-receipt.schema.json",
    "benchmarks/coding-agent/v3/candidate-coding-run-client-ci-evidence-receipt.schema.json",
    "benchmarks/coding-agent/v3/coding-run-client-ci-lane-evidence.schema.json",
    "scripts/run-coding-run-client-ci-lane-receipt.mjs",
    "candidateCodingRunClientReceipt",
    "scripts/verify-coding-agent-benchmark-contract.mjs",
  ]) {
    if (!projectMap.includes(requiredPath)) {
      failures.push(`docs/project-map.md must describe ${requiredPath}.`);
    }
  }
  if (!qualityGates.includes("run: pnpm verify:coding-benchmark")) {
    failures.push("quality-gates.yml must run pnpm verify:coding-benchmark.");
  }
  if (!qualityGates.includes("name: Produce coding-run client CI lane receipt")
    || !qualityGates.includes("if: always() && github.event_name != 'pull_request'")
    || !qualityGates.includes("node --import tsx scripts/run-coding-run-client-ci-lane-receipt.mjs")
    || !qualityGates.includes("--test-outcome ${{ steps.coding-run-client-verification.outcome }}")) {
    failures.push("quality-gates.yml must produce coding-run client CI lane receipts after verification.");
  }
  if (!qualityGates.includes("name: Upload coding-run client CI evidence")
    || !qualityGates.includes("name: coding-run-client-ci-${{ matrix.os }}")
    || !qualityGates.includes("artifacts/coding-run-client-ci/lane-receipt.json")
    || !qualityGates.includes("artifacts/coding-run-client-ci/vitest-report.json")
    || !qualityGates.includes("if-no-files-found: error")) {
    failures.push("quality-gates.yml must always upload both coding-run client CI evidence files.");
  }
  if (!qualityGates.includes("matrix.os")
    || !qualityGates.includes("windows-latest")
    || !qualityGates.includes("ubuntu-latest")) {
    failures.push("coding benchmark contract must be gated on both Windows and Linux runners.");
  }

  return failures;
}

function validateRunnerProfiles(failures, manifest, revision) {
  for (const mode of ["plan", "navigation-read", "workspace-write", "command-control", "safety-probe", "recovery-control", "git-local"]) {
    const actual = resolveCodingCiProfile(mode, revision);
    const expected = manifest.suite?.executionProfiles?.[mode];
    const expectedToolDeny = mode === "command-control" || mode === "safety-probe"
      ? ["spawn_subagent"]
      : mode === "recovery-control"
        ? revision === "v2"
          ? ["run_command", "spawn_subagent", "file_delete", "apply_patch"]
          : ["run_command", "spawn_subagent", "file_delete"]
        : mode === "git-local"
          ? ["spawn_subagent", "apply_patch", "file_write", "file_delete"]
        : ["run_command", "spawn_subagent"];
    const actualToolDeny = actual.toolDeny ?? (actual.toolAllow.includes("run_command")
      ? ["spawn_subagent"]
      : ["run_command", "spawn_subagent"]);
    if (actual.permissionMode !== expected?.permissionMode
      || actual.agentId !== expected?.agentId
      || actual.maxHighRiskToolCalls !== expected?.maxHighRiskToolCalls
      || JSON.stringify(actual.toolAllow) !== JSON.stringify(expected?.toolAllow)
      || JSON.stringify(actualToolDeny) !== JSON.stringify(expectedToolDeny)
      || JSON.stringify(expected?.toolDeny) !== JSON.stringify(expectedToolDeny)) {
      failures.push(`Coding benchmark ${mode} profile drifted from run-coding-agent-ci.mjs.`);
    }
  }
}

function validateSchema(failures, label, schema, sample) {
  if (!schema) return;
  const compiled = compileOutputSchema(schema);
  if (!compiled.ok) {
    failures.push(`${label} Schema does not compile: ${compiled.message}`);
    return;
  }
  if (sample) {
    const result = compiled.validator.validateOutput(JSON.stringify(sample));
    if (!result.ok) failures.push(`${label} does not accept its checked-in sample: ${result.message}`);
  }
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

async function main() {
  const failures = await collectCodingAgentBenchmarkContractFailures();
  if (failures.length === 0) {
    console.log("[verify:coding-benchmark] v1/v2/v3 manifests, schemas, docs, and platform gates are aligned");
    return;
  }
  console.error("[verify:coding-benchmark] contract failures:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(scriptPath)) {
  main().catch((error) => {
    console.error(`[verify:coding-benchmark] failed: ${safeMessage(error)}`);
    process.exitCode = 1;
  });
}
