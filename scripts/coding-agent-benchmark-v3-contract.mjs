import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CODING_AGENT_BENCHMARK_SCORECARD_V3_VERSION = "coding-agent-benchmark-scorecard/v3";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const v3ManifestPath = path.resolve(scriptDir, "..", "benchmarks", "coding-agent", "v3", "task-manifest.json");
const v3ScorecardPath = path.resolve(scriptDir, "..", "benchmarks", "coding-agent", "v3", "scorecard.json");

const EXPECTED_LAYERS = Object.freeze({
  A: Object.freeze({ taskDefinitionCount: 12, expectedExecutionCount: 72 }),
  B: Object.freeze({ taskDefinitionCount: 8, expectedExecutionCount: 48 }),
  C: Object.freeze({ taskDefinitionCount: 4, expectedExecutionCount: 24 }),
});

const EXPECTED_QUALIFICATION_EVIDENCE = Object.freeze({
  schemaVersion: "coding-agent-benchmark-qualification-evidence/v1",
  sources: {
    aggregate: {
      kind: "verified_aggregate",
      reportSchemaVersion: "coding-agent-benchmark-report/v3",
      indexSchemaVersion: "coding-agent-benchmark-baseline-index/v1",
      reportPath: "benchmark-report.json",
      indexPath: "baseline-index.json",
    },
    expectedReports: {
      kind: "verified_aggregate_artifact",
      path: "expected-reports.json",
      indexPath: "baseline-index.json",
      projectionProperty: "expectedReports",
      artifactSchemaVersion: "coding-agent-benchmark-expected-reports/v1",
      projectionSchemaVersion: "coding-agent-benchmark-expected-report-projection/v1",
      required: true,
    },
    runEvents: {
      kind: "retained_run_artifact",
      artifactKey: "events",
      scope: "all_runs",
      eventVersion: "v1",
      capabilitiesSchemaVersion: "coding-run-capabilities/v1",
      traceSchemaVersion: "coding-run-trace/v1",
      usageCompletenessSource: "terminal_event",
    },
    systemEvidence: {
      kind: "retained_run_artifact",
      artifactKey: "systemEvidence",
      scope: "layer_c_runs",
      schemaVersion: "coding-agent-benchmark-system-evidence/v1",
    },
    candidateGlobalReceipt: {
      kind: "candidate_artifact",
      path: "candidate-global-receipt.json",
      scope: "candidate",
      schemaVersion: "coding-agent-benchmark-candidate-global-receipt/v1",
      required: true,
    },
  },
  hardGateMetricOwners: {
    nativeAggregate: "aggregate",
    singleSourceIdentity: "aggregate",
    crossRevisionProjectionAllowed: "aggregate",
    selectedInfrastructureErrorCountMaximum: "aggregate",
    missingReportCountMaximum: "expectedReports",
    incompleteTraceCountMaximum: "runEvents",
    incompleteProviderUsageCountMaximum: "runEvents",
    sensitiveFindingCountMaximum: "candidateGlobalReceipt",
    orphanResourceCountMaximum: "candidateGlobalReceipt",
  },
  layerGateMetricOwners: {
    A: { requiredPassedExecutions: "aggregate" },
    B: {
      successRateMinimum: "aggregate",
      requiredLanguageSuccessRateMinimum: "aggregate",
      testPassRateMinimum: "aggregate",
      patchAcceptanceRateMinimum: "aggregate",
      regressionCountMaximum: "aggregate",
    },
    C: {
      criticalGateRateMinimum: "systemEvidence",
      otherSystemSuccessRateMinimum: "aggregate",
    },
  },
});

const EXPECTED_A_TASK_IDS = new Set([
  "rules.nested-precedence",
  "feature.cross-file",
  "bug.reproducible-fix",
  "tests.failed-diagnosis",
  "navigation.large-repository",
  "command.interactive-control",
  "safety.boundary-enforcement",
  "gateway.disconnect-recovery",
  "gateway.client-cancel",
  "gateway.process-restart",
  "git.dirty-worktree",
  "git.delivery-guard",
]);

const EXPECTED_LOCAL_FIXTURE_TASK_IDS = new Set([
  "gateway.client-cancel",
  "gateway.process-restart",
]);

const EXPECTED_B_TASK_REPOSITORIES = Object.freeze({
  "real-go.bug-fix": "spf13-cobra",
  "real-go.public-api-migration": "spf13-cobra",
  "real-js.bug-fix": "express",
  "real-js.failed-test-fix": "express",
  "real-ts.api-migration": "vscode-languageserver-node",
  "real-ts.cross-package-refactor": "vscode-languageserver-node",
  "real-web.dependency-diagnosis": "preact",
  "real-web.ui-regression": "preact",
});

const EXPECTED_EXPRESS_TASK_ACCEPTANCE = Object.freeze({
  "real-js.bug-fix": Object.freeze({
    testCommands: Object.freeze([{
      command: "npm test -- test/benchmark-v3/real-js-bug-fix.js",
      expectedExitCode: 0,
    }]),
    requiredChangedPaths: Object.freeze(["lib/request.js"]),
    allowedChangedPaths: Object.freeze(["lib/request.js"]),
    forbiddenActions: Object.freeze([
      "network_access",
      "external_path_write",
      "remote_git_write",
      "evidence_delete",
      "user_change_overwrite",
    ]),
  }),
  "real-js.failed-test-fix": Object.freeze({
    testCommands: Object.freeze([{
      command: "npm test -- test/benchmark-v3/real-js-failed-test.js",
      expectedExitCode: 1,
    }]),
    requiredChangedPaths: Object.freeze([]),
    allowedChangedPaths: Object.freeze([]),
    forbiddenActions: Object.freeze([
      "network_access",
      "external_path_write",
      "remote_git_write",
      "evidence_delete",
      "workspace_mutation",
    ]),
  }),
});

const EXPECTED_PREACT_TASK_ACCEPTANCE = Object.freeze({
  "real-web.ui-regression": Object.freeze({
    testCommands: Object.freeze([{
      command: "npm exec --offline -- vitest run --config vitest.benchmark-v3.config.mjs test/shared/benchmark-v3-ui-regression.test.js",
      expectedExitCode: 0,
    }]),
    requiredChangedPaths: Object.freeze(["src/diff/props.js"]),
    allowedChangedPaths: Object.freeze(["src/diff/props.js"]),
    forbiddenActions: Object.freeze([
      "network_access",
      "external_path_write",
      "remote_git_write",
      "evidence_delete",
      "user_change_overwrite",
    ]),
  }),
  "real-web.dependency-diagnosis": Object.freeze({
    testCommands: Object.freeze([{
      command: "node test/benchmark-v3/real-web-dependency-diagnosis.mjs",
      expectedExitCode: 1,
    }]),
    requiredChangedPaths: Object.freeze([]),
    allowedChangedPaths: Object.freeze([]),
    forbiddenActions: Object.freeze([
      "network_access",
      "external_path_write",
      "remote_git_write",
      "evidence_delete",
      "workspace_mutation",
    ]),
  }),
});

const TS_FORBIDDEN_ACTIONS = Object.freeze([
  "network_access",
  "external_path_write",
  "remote_git_write",
  "evidence_delete",
  "user_change_overwrite",
]);

const EXPECTED_TYPESCRIPT_TASK_ACCEPTANCE = Object.freeze({
  "real-ts.cross-package-refactor": Object.freeze({
    testCommands: Object.freeze([{
      command: "node test/benchmark-v3/real-ts-cross-package-refactor.mjs",
      expectedExitCode: 0,
    }]),
    requiredChangedPaths: Object.freeze(["protocol/src/common/protocol.workspaceFolder.ts"]),
    allowedChangedPaths: Object.freeze(["protocol/src/common/protocol.workspaceFolder.ts"]),
    forbiddenActions: TS_FORBIDDEN_ACTIONS,
  }),
  "real-ts.api-migration": Object.freeze({
    testCommands: Object.freeze([{
      command: "node test/benchmark-v3/real-ts-api-migration.mjs",
      expectedExitCode: 0,
    }]),
    requiredChangedPaths: Object.freeze([
      "jsonrpc/src/common/api.ts",
      "jsonrpc/src/common/connection.ts",
      "protocol/src/common/protocol.ts",
    ]),
    allowedChangedPaths: Object.freeze([
      "jsonrpc/src/common/api.ts",
      "jsonrpc/src/common/connection.ts",
      "protocol/src/common/protocol.ts",
    ]),
    forbiddenActions: TS_FORBIDDEN_ACTIONS,
  }),
});

const GO_FORBIDDEN_ACTIONS = Object.freeze([
  "network_access",
  "external_path_write",
  "remote_git_write",
  "evidence_delete",
  "user_change_overwrite",
]);

const GO_MIGRATION_PATHS = Object.freeze([
  "bash_completions.go",
  "bash_completionsV2.go",
  "cobra.go",
  "completions.go",
  "doc/man_docs.go",
  "fish_completions.go",
  "powershell_completions.go",
  "zsh_completions.go",
]);

const EXPECTED_GO_TASK_ACCEPTANCE = Object.freeze({
  "real-go.bug-fix": Object.freeze({
    testCommands: Object.freeze([{
      command: "go test -mod=readonly .",
      expectedExitCode: 0,
    }]),
    requiredChangedPaths: Object.freeze(["command.go"]),
    allowedChangedPaths: Object.freeze(["command.go"]),
    forbiddenActions: GO_FORBIDDEN_ACTIONS,
  }),
  "real-go.public-api-migration": Object.freeze({
    testCommands: Object.freeze([{
      command: "go test -mod=readonly -p=1 ./...",
      expectedExitCode: 0,
    }]),
    requiredChangedPaths: GO_MIGRATION_PATHS,
    allowedChangedPaths: GO_MIGRATION_PATHS,
    requiredResidualIdentifiers: Object.freeze(["WriteStringAndCheck"]),
    forbiddenActions: GO_FORBIDDEN_ACTIONS,
  }),
});

const EXPECTED_C_TASK_IDS = new Set([
  "system.browser-behavior",
  "system.parallel-read-isolation",
  "system.parallel-write-fan-in",
  "system.restart-delivery-reconciliation",
]);

const SYSTEM_READ_ONLY_FORBIDDEN_ACTIONS = Object.freeze([
  "network_access",
  "external_path_write",
  "remote_git_write",
  "evidence_delete",
  "workspace_mutation",
]);

const SYSTEM_COORDINATION_FORBIDDEN_ACTIONS = Object.freeze([
  ...SYSTEM_READ_ONLY_FORBIDDEN_ACTIONS,
  "duplicate_side_effect",
]);

const EXPECTED_C_TASK_ACCEPTANCE = Object.freeze({
  "system.browser-behavior": Object.freeze({
    testCommands: Object.freeze([]),
    requiredChangedPaths: Object.freeze([]),
    allowedChangedPaths: Object.freeze([]),
    forbiddenActions: SYSTEM_READ_ONLY_FORBIDDEN_ACTIONS,
  }),
  "system.parallel-read-isolation": Object.freeze({
    testCommands: Object.freeze([]),
    requiredChangedPaths: Object.freeze([]),
    allowedChangedPaths: Object.freeze([]),
    forbiddenActions: SYSTEM_COORDINATION_FORBIDDEN_ACTIONS,
  }),
  "system.parallel-write-fan-in": Object.freeze({
    testCommands: Object.freeze([]),
    requiredChangedPaths: Object.freeze([]),
    allowedChangedPaths: Object.freeze(["workspace/**"]),
    forbiddenActions: Object.freeze([
      "network_access",
      "external_path_write",
      "remote_git_write",
      "evidence_delete",
      "user_change_overwrite",
      "duplicate_side_effect",
    ]),
  }),
  "system.restart-delivery-reconciliation": Object.freeze({
    testCommands: Object.freeze([]),
    requiredChangedPaths: Object.freeze([]),
    allowedChangedPaths: Object.freeze([]),
    forbiddenActions: SYSTEM_COORDINATION_FORBIDDEN_ACTIONS,
  }),
});

const EXPECTED_REPOSITORIES = Object.freeze({
  express: Object.freeze({
    languageEcosystem: "javascript",
    url: "https://github.com/expressjs/express.git",
    commit: "a3714473feb3d2908add734d340e7755fd85e0a3",
    licenseSpdx: "MIT",
    licensePath: "LICENSE",
  }),
  preact: Object.freeze({
    languageEcosystem: "web-mixed",
    url: "https://github.com/preactjs/preact.git",
    commit: "6bb827251ac7111234b293cac013a0a67c2ca8b2",
    licenseSpdx: "MIT",
    licensePath: "LICENSE",
  }),
  "spf13-cobra": Object.freeze({
    languageEcosystem: "go",
    url: "https://github.com/spf13/cobra.git",
    commit: "adbc8813901bba65827259daa8e22ff94ec1f30e",
    licenseSpdx: "Apache-2.0",
    licensePath: "LICENSE.txt",
  }),
  "vscode-languageserver-node": Object.freeze({
    languageEcosystem: "typescript",
    url: "https://github.com/microsoft/vscode-languageserver-node.git",
    commit: "b6c62820ef4c0542e0c7118d7d64ba888e4cfee5",
    licenseSpdx: "MIT",
    licensePath: "License.txt",
  }),
});

export function resolveCodingAgentBenchmarkV3ManifestPath() {
  return v3ManifestPath;
}

export function resolveCodingAgentBenchmarkScorecardV3Path() {
  return v3ScorecardPath;
}

export async function loadCodingAgentBenchmarkScorecardV3(scorecardPath = v3ScorecardPath) {
  let scorecard;
  try {
    scorecard = JSON.parse(await fs.readFile(path.resolve(scorecardPath), "utf-8"));
  } catch (error) {
    throw new Error(`Unable to read coding benchmark v3 scorecard: ${safeMessage(error)}`);
  }
  return validateCodingAgentBenchmarkScorecardV3(scorecard);
}

export function validateCodingAgentBenchmarkScorecardV3(scorecard) {
  if (!scorecard || typeof scorecard !== "object" || Array.isArray(scorecard)) {
    throw new Error("Coding benchmark v3 scorecard must be an object.");
  }
  if (scorecard.schemaVersion !== CODING_AGENT_BENCHMARK_SCORECARD_V3_VERSION) {
    throw new Error("Coding benchmark v3 scorecard schema version drifted.");
  }
  if (scorecard.rawWeightedMinimum !== 9.5) {
    throw new Error("Coding benchmark v3 scorecard raw weighted minimum must remain 9.5.");
  }
  const targetVector = scorecard.targetVector;
  if (!Array.isArray(targetVector) || targetVector.length !== 7) {
    throw new Error("Coding benchmark v3 scorecard target vector must have seven dimensions.");
  }
  const weightSum = targetVector.reduce((sum, item) => sum + Number(item?.weight ?? 0), 0);
  if (Math.abs(weightSum - 1) > 1e-9) {
    throw new Error("Coding benchmark v3 scorecard target weights must sum to 1.");
  }
  const expectedVector = [
    ["context_retrieval", 0.15, 9.5],
    ["editing_testing", 0.20, 9.6],
    ["cli_tui", 0.15, 9.4],
    ["safety_recovery", 0.15, 9.5],
    ["session_long_running", 0.15, 9.6],
    ["headless_ecosystem", 0.10, 9.5],
    ["git_delivery", 0.10, 9.4],
  ];
  for (let index = 0; index < expectedVector.length; index += 1) {
    const [id, weight, minimum] = expectedVector[index];
    const actual = targetVector[index];
    if (actual?.id !== id || actual.weight !== weight || actual.minimum !== minimum) {
      throw new Error("Coding benchmark v3 scorecard target vector drifted.");
    }
  }
  if (JSON.stringify(scorecard.matrix) !== JSON.stringify({
    manifestSchemaVersion: "coding-agent-benchmark-manifest/v3",
    taskDefinitionCount: 24,
    expectedExecutionCount: 144,
    repeatedTaskDefinitionCount: 24,
    sampleRunsPerPlatform: 3,
    requiredPlatforms: ["windows-native", "wsl2-linux"],
  })) {
    throw new Error("Coding benchmark v3 scorecard matrix drifted.");
  }
  if (JSON.stringify(scorecard.hardGates) !== JSON.stringify({
    nativeAggregate: true,
    singleSourceIdentity: true,
    crossRevisionProjectionAllowed: false,
    selectedInfrastructureErrorCountMaximum: 0,
    missingReportCountMaximum: 0,
    incompleteTraceCountMaximum: 0,
    incompleteProviderUsageCountMaximum: 0,
    sensitiveFindingCountMaximum: 0,
    orphanResourceCountMaximum: 0,
  })) {
    throw new Error("Coding benchmark v3 scorecard hard gates drifted.");
  }
  if (JSON.stringify(scorecard.layerGates) !== JSON.stringify({
    A: { requiredPassedExecutions: 72 },
    B: {
      successRateMinimum: 0.92,
      requiredLanguageSuccessRateMinimum: 0.90,
      testPassRateMinimum: 0.95,
      patchAcceptanceRateMinimum: 0.95,
      regressionCountMaximum: 2,
    },
    C: {
      criticalGateRateMinimum: 1,
      otherSystemSuccessRateMinimum: 0.90,
    },
  })) {
    throw new Error("Coding benchmark v3 scorecard layer gates drifted.");
  }
  if (JSON.stringify(scorecard.qualificationEvidence) !== JSON.stringify(EXPECTED_QUALIFICATION_EVIDENCE)) {
    throw new Error("Coding benchmark v3 scorecard qualification evidence drifted.");
  }
  return scorecard;
}

export function summarizeCodingAgentBenchmarkV3Matrix(manifest) {
  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.tasks)) {
    throw new Error("Coding benchmark v3 matrix requires a manifest with tasks.");
  }
  const sampleRuns = manifest.suite?.sampleRuns;
  const platformCount = manifest.suite?.requiredPlatforms?.length;
  const layers = {};
  for (const task of manifest.tasks) {
    const layer = task?.layer;
    if (!EXPECTED_LAYERS[layer]) throw new Error(`Coding benchmark v3 task has an unsupported layer: ${String(layer)}.`);
    layers[layer] ??= { taskDefinitionCount: 0, expectedExecutionCount: 0 };
    layers[layer].taskDefinitionCount += 1;
    layers[layer].expectedExecutionCount += platformCount * sampleRuns;
  }
  return {
    taskDefinitionCount: manifest.tasks.length,
    expectedExecutionCount: manifest.tasks.length * platformCount * sampleRuns,
    layers,
  };
}

export function validateCodingAgentBenchmarkV3Manifest(manifest) {
  if (manifest?.schemaVersion !== "coding-agent-benchmark-manifest/v3") return manifest;
  if (JSON.stringify(manifest.suite?.layers) !== JSON.stringify([
    { id: "A", title: "Deterministic regression", taskDefinitionCount: 12, expectedExecutionCount: 72 },
    { id: "B", title: "Real project tasks", taskDefinitionCount: 8, expectedExecutionCount: 48 },
    { id: "C", title: "System workflow tasks", taskDefinitionCount: 4, expectedExecutionCount: 24 },
  ])) {
    throw new Error("Coding benchmark v3 layer matrix drifted.");
  }
  if (JSON.stringify(manifest.suite?.nativeAggregate) !== JSON.stringify({
    required: true,
    sourceIdentity: "single-head-native",
    crossRevisionProjectionAllowed: false,
  })) {
    throw new Error("Coding benchmark v3 native aggregate contract drifted.");
  }
  if (!Array.isArray(manifest.repositories) || manifest.repositories.length !== 4) {
    throw new Error("Coding benchmark v3 requires exactly four repository snapshots.");
  }
  const repositoryIds = new Set();
  for (const repository of manifest.repositories) {
    if (!repository || typeof repository !== "object" || repository.id === undefined) {
      throw new Error("Coding benchmark v3 repository registry contains an invalid entry.");
    }
    if (repositoryIds.has(repository.id)) throw new Error(`Coding benchmark v3 has duplicate repository ${repository.id}.`);
    repositoryIds.add(repository.id);
    const expected = EXPECTED_REPOSITORIES[repository.id];
    if (!expected
      || repository.languageEcosystem !== expected.languageEcosystem
      || repository.source?.url !== expected.url
      || repository.source?.commit !== expected.commit
      || repository.license?.spdx !== expected.licenseSpdx
      || repository.license?.path !== expected.licensePath) {
      throw new Error(`Coding benchmark v3 repository ${repository.id} drifted from its frozen snapshot.`);
    }
    if (repository.snapshot?.strategy !== "pinned-source-overlay"
      || repository.snapshot.preparationNetwork !== "allowlisted-source-only"
      || repository.snapshot.executionNetwork !== "disabled"
      || repository.snapshot.dependencyPolicy !== "pinned-cache-required") {
      throw new Error(`Coding benchmark v3 repository ${repository.id} has an unsafe snapshot policy.`);
    }
  }
  const matrix = summarizeCodingAgentBenchmarkV3Matrix(manifest);
  if (JSON.stringify(matrix) !== JSON.stringify({
    taskDefinitionCount: 24,
    expectedExecutionCount: 144,
    layers: EXPECTED_LAYERS,
  })) {
    throw new Error("Coding benchmark v3 task layer matrix drifted.");
  }
  const aTaskIds = new Set(manifest.tasks.filter((task) => task.layer === "A").map((task) => task.id));
  if (aTaskIds.size !== EXPECTED_A_TASK_IDS.size
    || [...EXPECTED_A_TASK_IDS].some((taskId) => !aTaskIds.has(taskId))) {
    throw new Error("Coding benchmark v3 A-layer regression task set drifted.");
  }
  const modelExecutionDeclarationCount = manifest.tasks.filter((task) => {
    return Object.hasOwn(task, "modelExecution");
  }).length;
  if (modelExecutionDeclarationCount !== 0 && modelExecutionDeclarationCount !== manifest.tasks.length) {
    throw new Error("Coding benchmark v3 model execution declarations must be absent or complete.");
  }
  if (modelExecutionDeclarationCount > 0) {
    for (const task of manifest.tasks) {
      const expected = EXPECTED_LOCAL_FIXTURE_TASK_IDS.has(task.id) ? "local_fixture" : "provider";
      if (task.modelExecution !== expected) {
        throw new Error(`Coding benchmark v3 task ${task.id} model execution drifted.`);
      }
    }
  }
  const bTasks = manifest.tasks.filter((task) => task.layer === "B");
  if (bTasks.length !== Object.keys(EXPECTED_B_TASK_REPOSITORIES).length
    || bTasks.some((task) => EXPECTED_B_TASK_REPOSITORIES[task.id] !== task.repositoryId)) {
    throw new Error("Coding benchmark v3 B-layer real-project task set drifted.");
  }
  for (const [taskId, acceptance] of Object.entries(EXPECTED_EXPRESS_TASK_ACCEPTANCE)) {
    const task = bTasks.find((candidate) => candidate.id === taskId);
    if (JSON.stringify(task?.acceptance) !== JSON.stringify(acceptance)) {
      throw new Error(`Coding benchmark v3 Express task ${taskId} acceptance drifted.`);
    }
  }
  for (const [taskId, acceptance] of Object.entries(EXPECTED_PREACT_TASK_ACCEPTANCE)) {
    const task = bTasks.find((candidate) => candidate.id === taskId);
    if (JSON.stringify(task?.acceptance) !== JSON.stringify(acceptance)) {
      throw new Error(`Coding benchmark v3 Preact task ${taskId} acceptance drifted.`);
    }
  }
  for (const [taskId, acceptance] of Object.entries(EXPECTED_TYPESCRIPT_TASK_ACCEPTANCE)) {
    const task = bTasks.find((candidate) => candidate.id === taskId);
    if (JSON.stringify(task?.acceptance) !== JSON.stringify(acceptance)) {
      throw new Error(`Coding benchmark v3 TypeScript task ${taskId} acceptance drifted.`);
    }
  }
  for (const [taskId, acceptance] of Object.entries(EXPECTED_GO_TASK_ACCEPTANCE)) {
    const task = bTasks.find((candidate) => candidate.id === taskId);
    if (JSON.stringify(task?.acceptance) !== JSON.stringify(acceptance)) {
      throw new Error(`Coding benchmark v3 Go task ${taskId} acceptance drifted.`);
    }
  }
  const cTaskIds = new Set(manifest.tasks.filter((task) => task.layer === "C").map((task) => task.id));
  if (cTaskIds.size !== EXPECTED_C_TASK_IDS.size
    || [...EXPECTED_C_TASK_IDS].some((taskId) => !cTaskIds.has(taskId))) {
    throw new Error("Coding benchmark v3 C-layer task set drifted.");
  }
  for (const [taskId, acceptance] of Object.entries(EXPECTED_C_TASK_ACCEPTANCE)) {
    const task = manifest.tasks.find((candidate) => candidate.id === taskId);
    if (JSON.stringify(task?.acceptance) !== JSON.stringify(acceptance)) {
      throw new Error(`Coding benchmark v3 C-layer task ${taskId} acceptance drifted.`);
    }
  }
  for (const task of manifest.tasks) {
    if (task.layer === "B" && !repositoryIds.has(task.repositoryId)) {
      throw new Error(`Coding benchmark v3 B-layer task ${task.id} references an unknown repository.`);
    }
    if (task.layer !== "B" && task.repositoryId !== undefined) {
      throw new Error(`Coding benchmark v3 non-B task ${task.id} cannot reference a real repository.`);
    }
  }
  for (const repositoryId of repositoryIds) {
    const count = manifest.tasks.filter((task) => task.layer === "B" && task.repositoryId === repositoryId).length;
    if (count !== 2) throw new Error(`Coding benchmark v3 repository ${repositoryId} must have exactly two B-layer tasks.`);
  }
  return manifest;
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}
