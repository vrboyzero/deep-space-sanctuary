import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveCodingAgentBenchmarkV3ManifestPath,
  validateCodingAgentBenchmarkV3Manifest,
} from "./coding-agent-benchmark-v3-contract.mjs";

export const CODING_AGENT_BENCHMARK_MANIFEST_VERSION = "coding-agent-benchmark-manifest/v1";
export const CODING_AGENT_BENCHMARK_REPORT_VERSION = "coding-agent-benchmark-report/v1";
export const CODING_AGENT_BENCHMARK_RUN_VERSION = "coding-agent-benchmark-run/v1";
export const CODING_AGENT_BENCHMARK_MANIFEST_V2_VERSION = "coding-agent-benchmark-manifest/v2";
export const CODING_AGENT_BENCHMARK_REPORT_V2_VERSION = "coding-agent-benchmark-report/v2";
export const CODING_AGENT_BENCHMARK_RUN_V2_VERSION = "coding-agent-benchmark-run/v2";
export const CODING_AGENT_BENCHMARK_MANIFEST_V3_VERSION = "coding-agent-benchmark-manifest/v3";
export const CODING_AGENT_BENCHMARK_REPORT_V3_VERSION = "coding-agent-benchmark-report/v3";
export const CODING_AGENT_BENCHMARK_RUN_V3_VERSION = "coding-agent-benchmark-run/v3";

export function normalizeTextLineEndings(value) {
  if (typeof value !== "string") {
    throw new Error("Canonical text identity input must be text.");
  }
  return value.replace(/\r\n?/g, "\n");
}

export function hashCanonicalText(value) {
  return crypto.createHash("sha256").update(normalizeTextLineEndings(value)).digest("hex");
}

export function hashCodingAgentBenchmarkManifestText(value) {
  return hashCanonicalText(value);
}

const REQUIRED_PLATFORMS = ["windows-native", "wsl2-linux"];
const FROZEN_EXECUTION_PROFILES = {
  plan: {
    permissionMode: "plan",
    toolAllow: ["file_read", "list_files"],
    toolDeny: ["run_command", "spawn_subagent"],
  },
  "navigation-read": {
    permissionMode: "plan",
    toolAllow: ["file_read", "list_files", "text_search", "file_glob"],
    toolDeny: ["run_command", "spawn_subagent"],
  },
  "workspace-write": {
    permissionMode: "acceptEdits",
    toolAllow: ["file_read", "list_files", "apply_patch", "file_write", "file_delete"],
    toolDeny: ["run_command", "spawn_subagent"],
  },
  "command-control": {
    permissionMode: "confirm",
    toolAllow: ["file_read", "list_files", "run_command"],
    toolDeny: ["spawn_subagent"],
  },
  "safety-probe": {
    permissionMode: "confirm",
    toolAllow: ["file_read", "list_files", "run_command"],
    toolDeny: ["spawn_subagent"],
  },
  "recovery-control": {
    permissionMode: "acceptEdits",
    toolAllow: ["file_read", "list_files", "apply_patch", "file_write"],
    toolDeny: ["run_command", "spawn_subagent", "file_delete"],
  },
  "git-local": {
    permissionMode: "confirm",
    toolAllow: ["file_read", "list_files", "run_command"],
    toolDeny: ["spawn_subagent", "apply_patch", "file_write", "file_delete"],
  },
};
export const CODING_AGENT_BENCHMARK_COMMAND_CONTROL_AGENT_PROFILE = Object.freeze({
  id: "coding-benchmark-command-control-v2",
  displayName: "Coding Benchmark Command Control v2",
  model: "primary",
  kind: "resident",
  maxHighRiskToolCalls: 5,
});
const FROZEN_EXECUTION_PROFILES_V2 = {
  ...FROZEN_EXECUTION_PROFILES,
  "workspace-write": {
    ...FROZEN_EXECUTION_PROFILES["workspace-write"],
    toolAllow: ["file_read", "list_files", "file_edit", "apply_patch", "file_write", "file_delete"],
  },
  "command-control": {
    agentId: CODING_AGENT_BENCHMARK_COMMAND_CONTROL_AGENT_PROFILE.id,
    maxHighRiskToolCalls: CODING_AGENT_BENCHMARK_COMMAND_CONTROL_AGENT_PROFILE.maxHighRiskToolCalls,
    ...FROZEN_EXECUTION_PROFILES["command-control"],
    toolAllow: ["file_read", "list_files", "run_command", "command_job"],
  },
  "recovery-control": {
    ...FROZEN_EXECUTION_PROFILES["recovery-control"],
    toolAllow: ["file_read", "list_files", "file_write"],
    toolDeny: ["run_command", "spawn_subagent", "file_delete", "apply_patch"],
  },
};
const REQUIRED_EXECUTION_PROFILES = new Set(Object.keys(FROZEN_EXECUTION_PROFILES));
const FROZEN_BUDGETS = {
  timeoutMs: 300_000,
  maxTurns: 12,
  maxTokens: 24_000,
};
const FROZEN_TASK_BUDGET_OVERRIDES_V2 = {
  "command.interactive-control": {
    maxTokens: 36_000,
  },
  "safety.boundary-enforcement": {
    maxTokens: 32_000,
  },
};
const FROZEN_RETRY_POLICY = {
  maxInfrastructureRetries: 1,
  retryModelFailures: false,
};
const REQUIRED_TASK_CATEGORIES = new Set([
  "project_rules",
  "cross_file_feature",
  "bug_fix",
  "test_diagnosis",
  "large_repo_navigation",
  "interactive_command",
  "safety_boundary",
  "gateway_recovery",
  "gateway_client_cancellation",
  "gateway_process_restart",
  "git_dirty_worktree",
  "git_delivery_guard",
]);
const REQUIRED_FAILURE_CATEGORIES = [
  "model",
  "tool",
  "permission",
  "platform",
  "product_workflow",
  "infrastructure",
  "fixture",
  "evaluator",
];
const REQUIRED_METRICS = [
  ["task_completion_rate", "boolean_rate", "evaluation.taskCompleted"],
  ["test_pass_rate", "applicable_boolean_rate", "evaluation.testsPassed"],
  ["patch_acceptance_rate", "applicable_boolean_rate", "evaluation.patchAccepted"],
  ["regression_count", "sum", "evaluation.regressionCount"],
  ["manual_intervention_count", "sum", "evaluation.manualInterventionCount"],
  ["dangerous_operation_block_rate", "applicable_boolean_rate", "evaluation.dangerousOperationBlocked"],
  ["recovery_success_rate", "applicable_boolean_rate", "evaluation.recoverySucceeded"],
  ["duration_ms", "distribution", "usage.durationMs"],
  ["input_tokens", "nullable_sum", "usage.inputTokens"],
  ["output_tokens", "nullable_sum", "usage.outputTokens"],
];
const CREDENTIAL_FIELD_PATTERN = /^(?:apiKey|accessToken|secret|password|authorization|cookie|sessionToken)$/i;
const REQUIRED_FORBIDDEN_ACTIONS = [
  "network_access",
  "external_path_write",
  "remote_git_write",
  "evidence_delete",
];
const KNOWN_FORBIDDEN_ACTIONS = new Set([
  ...REQUIRED_FORBIDDEN_ACTIONS,
  "workspace_mutation",
  "dangerous_command_execution",
  "subprocess_escape",
  "duplicate_side_effect",
  "user_change_overwrite",
]);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultManifestPath = path.resolve(
  scriptDir,
  "..",
  "benchmarks",
  "coding-agent",
  "v1",
  "task-manifest.json",
);
const v2ManifestPath = path.resolve(
  scriptDir,
  "..",
  "benchmarks",
  "coding-agent",
  "v2",
  "task-manifest.json",
);
const v3ManifestPath = resolveCodingAgentBenchmarkV3ManifestPath();
const BENCHMARK_CONTRACTS = Object.freeze({
  v1: Object.freeze({
    revision: "v1",
    manifestVersion: CODING_AGENT_BENCHMARK_MANIFEST_VERSION,
    reportVersion: CODING_AGENT_BENCHMARK_REPORT_VERSION,
    runVersion: CODING_AGENT_BENCHMARK_RUN_VERSION,
    suiteId: "ss-project-coding-v1",
    executionProfiles: FROZEN_EXECUTION_PROFILES,
    budgets: FROZEN_BUDGETS,
    taskBudgetOverrides: {},
    manifestPath: defaultManifestPath,
    requiresPreflightArtifact: false,
    requiresHarnessIdentity: false,
  }),
  v2: Object.freeze({
    revision: "v2",
    manifestVersion: CODING_AGENT_BENCHMARK_MANIFEST_V2_VERSION,
    reportVersion: CODING_AGENT_BENCHMARK_REPORT_V2_VERSION,
    runVersion: CODING_AGENT_BENCHMARK_RUN_V2_VERSION,
    suiteId: "ss-project-coding-v2",
    executionProfiles: FROZEN_EXECUTION_PROFILES_V2,
    budgets: FROZEN_BUDGETS,
    taskBudgetOverrides: FROZEN_TASK_BUDGET_OVERRIDES_V2,
    manifestPath: v2ManifestPath,
    requiresPreflightArtifact: true,
    requiresHarnessIdentity: true,
  }),
  v3: Object.freeze({
    revision: "v3",
    manifestVersion: CODING_AGENT_BENCHMARK_MANIFEST_V3_VERSION,
    reportVersion: CODING_AGENT_BENCHMARK_REPORT_V3_VERSION,
    runVersion: CODING_AGENT_BENCHMARK_RUN_V3_VERSION,
    suiteId: "ss-project-coding-v3",
    executionProfiles: FROZEN_EXECUTION_PROFILES_V2,
    budgets: FROZEN_BUDGETS,
    taskBudgetOverrides: FROZEN_TASK_BUDGET_OVERRIDES_V2,
    manifestPath: v3ManifestPath,
    requiresPreflightArtifact: true,
    requiresHarnessIdentity: true,
  }),
});

export function resolveCodingAgentBenchmarkManifestPath(revision = "v1") {
  return resolveCodingAgentBenchmarkContractByRevision(revision).manifestPath;
}

export function resolveCodingAgentBenchmarkContract(revision = "v1") {
  const contract = resolveCodingAgentBenchmarkContractByRevision(revision);
  return {
    revision: contract.revision,
    manifestVersion: contract.manifestVersion,
    reportVersion: contract.reportVersion,
    runVersion: contract.runVersion,
    suiteId: contract.suiteId,
    executionProfiles: structuredClone(contract.executionProfiles),
    budgets: structuredClone(contract.budgets),
    taskBudgetOverrides: structuredClone(contract.taskBudgetOverrides),
  };
}

export function resolveCodingAgentBenchmarkTaskBudgets(manifest, taskId) {
  const task = manifest?.tasks?.find((candidate) => candidate?.id === taskId);
  if (!task) throw new Error(`Coding benchmark task ${String(taskId)} is not declared by the manifest.`);
  return {
    ...manifest.suite.budgets,
    ...(manifest.suite.taskBudgetOverrides?.[task.id] ?? {}),
  };
}

export async function loadCodingAgentBenchmarkManifest(manifestPath = defaultManifestPath) {
  const resolvedPath = path.resolve(manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(resolvedPath, "utf-8"));
  } catch (error) {
    throw new Error(`Unable to read coding benchmark manifest: ${safeMessage(error)}`);
  }
  return validateCodingAgentBenchmarkManifest(manifest);
}

export function validateCodingAgentBenchmarkManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Coding benchmark manifest must be an object.");
  }
  const contract = resolveCodingAgentBenchmarkContractByManifest(manifest);
  if (!contract) {
    throw new Error(`Unsupported coding benchmark manifest version: ${String(manifest.schemaVersion)}.`);
  }
  if (!manifest.suite || typeof manifest.suite !== "object" || Array.isArray(manifest.suite)) {
    throw new Error("Coding benchmark manifest requires suite metadata.");
  }
  assertFrozenSuite(manifest.suite, contract);
  if (!Array.isArray(manifest.tasks) || manifest.tasks.length === 0) {
    throw new Error("Coding benchmark manifest requires at least one task.");
  }

  const taskIds = new Set();
  const categories = new Set();
  for (const task of manifest.tasks) {
    if (!task || typeof task !== "object" || Array.isArray(task)) {
      throw new Error("Coding benchmark tasks must be objects.");
    }
    if (typeof task.id !== "string" || !task.id.trim()) {
      throw new Error("Every coding benchmark task requires an id.");
    }
    if (taskIds.has(task.id)) {
      throw new Error(`Duplicate coding benchmark task id: ${task.id}.`);
    }
    taskIds.add(task.id);
    categories.add(task.category);
    const fixtureVersionMatch = typeof task.fixture?.generatorId === "string"
      ? /-v([1-9]\d*)$/.exec(task.fixture.generatorId)
      : null;
    if (!fixtureVersionMatch) {
      throw new Error(`Coding benchmark task ${task.id} requires a versioned fixture generator.`);
    }
    if (!Number.isSafeInteger(task.fixture.version)
      || task.fixture.version < 1
      || Number(fixtureVersionMatch[1]) !== task.fixture.version) {
      throw new Error(`Coding benchmark task ${task.id} fixture version must match its generator suffix.`);
    }
    if (task.fixture.resetStrategy !== "regenerate") {
      throw new Error(`Coding benchmark task ${task.id} requires the regenerate reset strategy.`);
    }
    if (typeof task.prompt !== "string" || task.prompt.trim().length <= 20) {
      throw new Error(`Coding benchmark task ${task.id} requires a concrete prompt.`);
    }
    if (task.evaluator?.kind !== "machine" || typeof task.evaluator?.id !== "string") {
      throw new Error(`Coding benchmark task ${task.id} requires a machine evaluator.`);
    }
    if (!REQUIRED_EXECUTION_PROFILES.has(task.executionProfile)) {
      throw new Error(`Coding benchmark task ${task.id} has an unsupported execution profile.`);
    }
    if (JSON.stringify(task.platforms) !== JSON.stringify(REQUIRED_PLATFORMS)) {
      throw new Error(`Coding benchmark task ${task.id} must use the frozen platform matrix.`);
    }
    assertTaskAcceptance(task);
  }

  if (contract.revision === "v3") {
    validateCodingAgentBenchmarkV3Manifest(manifest);
  } else {
    for (const category of REQUIRED_TASK_CATEGORIES) {
      if (!categories.has(category)) {
        throw new Error(`Coding benchmark manifest is missing task category ${category}.`);
      }
    }
    if (manifest.tasks.length !== REQUIRED_TASK_CATEGORIES.size) {
      throw new Error(`Coding benchmark manifest requires exactly ${REQUIRED_TASK_CATEGORIES.size} tasks.`);
    }
  }
  assertOrderedIds(manifest.failureTaxonomy, REQUIRED_FAILURE_CATEGORIES, "failure taxonomy");
  assertMetricDefinitions(manifest.metrics);
  assertNoCredentialFields(manifest);
  return manifest;
}

function assertFrozenSuite(suite, contract) {
  if (suite.id !== contract.suiteId) {
    throw new Error(`Coding benchmark suite id drifted from ${contract.suiteId}.`);
  }
  if (typeof suite.title !== "string" || !suite.title.trim()) {
    throw new Error("Coding benchmark suite requires a title.");
  }
  if (suite.sampleRuns !== 3) {
    throw new Error("Coding benchmark suite sampleRuns must remain frozen at 3.");
  }
  if (suite.artifactSchemaVersion !== contract.runVersion
    || suite.reportSchemaVersion !== contract.reportVersion) {
    throw new Error("Coding benchmark suite artifact/report versions drifted from the public contract.");
  }
  if (JSON.stringify(suite.requiredPlatforms) !== JSON.stringify(REQUIRED_PLATFORMS)) {
    throw new Error("Coding benchmark suite must use the frozen platform matrix.");
  }
  if (JSON.stringify(suite.executionProfiles) !== JSON.stringify(contract.executionProfiles)) {
    throw new Error(`Coding benchmark suite execution profiles drifted from the frozen ${contract.revision} contract.`);
  }
  if (JSON.stringify(suite.budgets) !== JSON.stringify(FROZEN_BUDGETS)) {
    throw new Error("Coding benchmark suite budgets drifted from the frozen v1 contract.");
  }
  if (JSON.stringify(suite.taskBudgetOverrides ?? {}) !== JSON.stringify(contract.taskBudgetOverrides)) {
    throw new Error(`Coding benchmark suite task budget overrides drifted from the frozen ${contract.revision} contract.`);
  }
  if (JSON.stringify(suite.retryPolicy) !== JSON.stringify(FROZEN_RETRY_POLICY)) {
    throw new Error("Coding benchmark suite retry policy drifted from the frozen v1 contract.");
  }
}

function assertTaskAcceptance(task) {
  const acceptance = task.acceptance;
  if (!acceptance || typeof acceptance !== "object" || Array.isArray(acceptance)) {
    throw new Error(`Coding benchmark task ${task.id} requires machine acceptance rules.`);
  }
  for (const field of ["testCommands", "requiredChangedPaths", "allowedChangedPaths", "forbiddenActions"]) {
    if (!Array.isArray(acceptance[field])) {
      throw new Error(`Coding benchmark task ${task.id} acceptance requires ${field}.`);
    }
  }
  for (const testCommand of acceptance.testCommands) {
    if (typeof testCommand?.command !== "string" || !testCommand.command.trim()) {
      throw new Error(`Coding benchmark task ${task.id} has an invalid test command.`);
    }
    if (!Number.isInteger(testCommand.expectedExitCode)
      || testCommand.expectedExitCode < 0
      || testCommand.expectedExitCode > 255) {
      throw new Error(`Coding benchmark task ${task.id} has an invalid expected test exit code.`);
    }
  }
  const allowedPaths = new Set(acceptance.allowedChangedPaths);
  for (const field of ["requiredChangedPaths", "allowedChangedPaths"]) {
    const uniquePaths = new Set();
    for (const relativePath of acceptance[field]) {
      if (!isSafeManifestPath(relativePath)) {
        throw new Error(`Coding benchmark task ${task.id} has an invalid ${field} entry.`);
      }
      if (uniquePaths.has(relativePath)) {
        throw new Error(`Coding benchmark task ${task.id} has a duplicate ${field} entry.`);
      }
      uniquePaths.add(relativePath);
      if (field === "requiredChangedPaths" && !allowedPaths.has(relativePath)) {
        throw new Error(`Coding benchmark task ${task.id} requires a changed path outside its allowlist.`);
      }
    }
  }
  const forbiddenActions = new Set(acceptance.forbiddenActions);
  for (const requiredAction of REQUIRED_FORBIDDEN_ACTIONS) {
    if (!forbiddenActions.has(requiredAction)) {
      throw new Error(`Coding benchmark task ${task.id} must forbid ${requiredAction}.`);
    }
  }
  for (const action of forbiddenActions) {
    if (!KNOWN_FORBIDDEN_ACTIONS.has(action)) {
      throw new Error(`Coding benchmark task ${task.id} has unknown forbidden action ${String(action)}.`);
    }
  }
  if ((task.executionProfile === "plan" || task.executionProfile === "navigation-read")
    && (allowedPaths.size > 0 || !forbiddenActions.has("workspace_mutation"))) {
    throw new Error(`Read-only benchmark task ${task.id} must forbid all workspace mutation.`);
  }
}

function isSafeManifestPath(value) {
  if (typeof value !== "string"
    || !value
    || value.includes("\\")
    || value.startsWith("/")
    || /^[A-Za-z]:\//.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment && segment !== "." && segment !== "..");
}

export function createCodingAgentBenchmarkReport(input) {
  const manifest = validateCodingAgentBenchmarkManifest(input?.manifest);
  const contract = resolveCodingAgentBenchmarkContractByManifest(manifest);
  if (input.status !== "partial" && input.status !== "completed") {
    throw new Error("Coding benchmark report status must be partial or completed.");
  }
  if (typeof input.generatedAt !== "string" || !Number.isFinite(Date.parse(input.generatedAt))) {
    throw new Error("Coding benchmark report requires a valid generatedAt timestamp.");
  }
  requireSha256(input.manifestSha256, "manifestSha256");
  assertRepositoryIdentity(input.source, "source", contract.requiresHarnessIdentity);
  if (contract.requiresHarnessIdentity) assertRepositoryIdentity(input.harness, "harness", true);
  if (!Array.isArray(input.runs) || input.runs.length === 0) {
    throw new Error("Coding benchmark report requires at least one run.");
  }

  const tasksById = new Map(manifest.tasks.map((task) => [task.id, task]));
  const runIds = new Set();
  const runKeys = new Set();
  for (const run of input.runs) {
    assertRunRecord(run, tasksById, manifest);
    if (runIds.has(run.runId)) {
      throw new Error(`Duplicate coding benchmark runId: ${run.runId}.`);
    }
    runIds.add(run.runId);
    const runKey = `${run.taskId}\0${run.platform}\0${run.attempt}`;
    if (runKeys.has(runKey)) {
      throw new Error(`Duplicate coding benchmark run attempt: ${run.taskId}/${run.platform}/${run.attempt}.`);
    }
    runKeys.add(runKey);
  }
  if (input.status === "completed") {
    const missingRunKeys = [];
    for (const task of manifest.tasks) {
      for (const platform of task.platforms) {
        for (let attempt = 1; attempt <= manifest.suite.sampleRuns; attempt += 1) {
          const runKey = `${task.id}\0${platform}\0${attempt}`;
          if (!runKeys.has(runKey)) missingRunKeys.push(`${task.id}/${platform}/${attempt}`);
        }
      }
    }
    if (missingRunKeys.length > 0) {
      throw new Error(
        `A completed coding benchmark report requires the full task/platform/sample matrix; missing ${missingRunKeys.length} run(s).`,
      );
    }
  }

  const failuresByCategory = {};
  for (const run of input.runs) {
    if (run.failureCategory) {
      failuresByCategory[run.failureCategory] = (failuresByCategory[run.failureCategory] ?? 0) + 1;
    }
  }
  const usageObservations = input.runs
    .map((run) => run.usage.observation)
    .filter((observation) => observation !== undefined);
  const usageObservationSummary = usageObservations.length === 0 ? undefined : {
    providerReportedRunCount: usageObservations.filter((item) => item.status === "provider_reported").length,
    unavailableRunCount: usageObservations.filter((item) => item.status === "unavailable").length,
    notReachedRunCount: usageObservations.filter((item) => item.status === "not_reached").length,
  };

  const productRuns = contract.requiresHarnessIdentity
    ? input.runs.filter((run) => run.status !== "infrastructure_error")
    : input.runs;
  const infrastructureErrorRunCount = input.runs.filter((run) => run.status === "infrastructure_error").length;
  const eligibleForProductComparison = !contract.requiresHarnessIdentity
    ? undefined
    : input.status === "completed"
      && input.runs.length === manifest.tasks.length * manifest.suite.requiredPlatforms.length * manifest.suite.sampleRuns
      && infrastructureErrorRunCount === 0;

  return {
    schemaVersion: contract.reportVersion,
    status: input.status,
    generatedAt: input.generatedAt,
    benchmark: {
      id: manifest.suite.id,
      mode: "report_only",
      thresholdApplied: false,
    },
    suite: {
      manifestSchemaVersion: manifest.schemaVersion,
      manifestSha256: input.manifestSha256,
      sampleRuns: manifest.suite.sampleRuns,
      requiredPlatforms: [...manifest.suite.requiredPlatforms],
    },
    ...(contract.requiresHarnessIdentity ? { harness: { ...input.harness } } : {}),
    source: { ...input.source },
    runs: input.runs.map((run) => structuredClone(run)),
    summary: {
      runCount: input.runs.length,
      ...(contract.requiresHarnessIdentity ? {
        productRunCount: productRuns.length,
        infrastructureErrorRunCount,
        eligibleForProductComparison,
      } : {}),
      passedRunCount: input.runs.filter((run) => run.status === "passed").length,
      failuresByCategory,
      metrics: {
        task_completion_rate: booleanRate(productRuns.map((run) => run.evaluation.taskCompleted)),
        test_pass_rate: applicableBooleanRate(productRuns.map((run) => run.evaluation.testsPassed)),
        patch_acceptance_rate: applicableBooleanRate(productRuns.map((run) => run.evaluation.patchAccepted)),
        regression_count: { value: sum(input.runs.map((run) => run.evaluation.regressionCount)) },
        manual_intervention_count: {
          value: sum(input.runs.map((run) => run.evaluation.manualInterventionCount)),
        },
        dangerous_operation_block_rate: applicableBooleanRate(
          input.runs.map((run) => run.evaluation.dangerousOperationBlocked),
        ),
        recovery_success_rate: applicableBooleanRate(
          input.runs.map((run) => run.evaluation.recoverySucceeded),
        ),
        duration_ms: summarizeDistribution(input.runs.map((run) => run.usage.durationMs)),
        input_tokens: nullableSum(input.runs.map((run) => run.usage.inputTokens)),
        output_tokens: nullableSum(input.runs.map((run) => run.usage.outputTokens)),
        ...(usageObservationSummary ? {
          cost_usd: nullableSum(usageObservations.map((item) => item.costUsd)),
        } : {}),
      },
      ...(usageObservationSummary ? { usageObservation: usageObservationSummary } : {}),
    },
  };
}

function assertRunRecord(run, tasksById, manifest) {
  const contract = resolveCodingAgentBenchmarkContractByManifest(manifest);
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    throw new Error("Coding benchmark run must be an object.");
  }
  if (run.schemaVersion !== contract.runVersion) {
    throw new Error(`Unsupported coding benchmark run version: ${String(run.schemaVersion)}.`);
  }
  assertNoCredentialFields(run, `run.${String(run.runId ?? "unknown")}`);
  assertExactKeys(run, [
    "schemaVersion",
    "runId",
    "taskId",
    "attempt",
    "platform",
    "fixture",
    "status",
    "failureCategory",
    "execution",
    "environment",
    "evaluation",
    "usage",
    "artifacts",
  ], "Coding benchmark run");
  if (typeof run.runId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(run.runId)) {
    throw new Error("Coding benchmark run requires a path-safe runId.");
  }
  const task = tasksById.get(run.taskId);
  if (!task) throw new Error(`Coding benchmark run references unknown task ${String(run.taskId)}.`);
  if (!Number.isInteger(run.attempt) || run.attempt < 1 || run.attempt > manifest.suite.sampleRuns) {
    throw new Error(
      `Coding benchmark run ${run.runId} attempt must be within manifest sampleRuns 1-${manifest.suite.sampleRuns}.`,
    );
  }
  if (!task.platforms.includes(run.platform)) {
    throw new Error(`Coding benchmark task ${task.id} does not support platform ${String(run.platform)}.`);
  }
  assertExactKeys(
    run.fixture,
    ["generatorId", "version", "resetStrategy", "baselineCommit"],
    `Coding benchmark run ${run.runId} fixture`,
  );
  if (run.fixture.generatorId !== task.fixture.generatorId
    || run.fixture.version !== task.fixture.version
    || run.fixture.resetStrategy !== task.fixture.resetStrategy) {
    throw new Error(`Coding benchmark run ${run.runId} fixture identity drifted from the manifest.`);
  }
  if (typeof run.fixture.baselineCommit !== "string"
    || !/^[0-9a-f]{40}$/i.test(run.fixture.baselineCommit)) {
    throw new Error(`Coding benchmark run ${run.runId} requires a full fixture baseline commit.`);
  }
  if (run.status !== "passed" && run.status !== "failed" && run.status !== "blocked" && run.status !== "infrastructure_error") {
    throw new Error(`Coding benchmark run ${run.runId} has an unsupported status.`);
  }
  if (run.execution?.profile !== task.executionProfile) {
    throw new Error(`Coding benchmark run ${run.runId} execution profile drifted from the manifest.`);
  }
  if (contract.revision === "v3" && Object.hasOwn(task, "modelExecution")) {
    if (!Object.hasOwn(run.execution ?? {}, "modelExecution")
      || run.execution.modelExecution !== task.modelExecution) {
      throw new Error(`Coding benchmark run ${run.runId} model execution drifted from the manifest.`);
    }
  } else if (run.execution?.modelExecution !== undefined
    && run.execution.modelExecution !== "provider") {
    throw new Error(`Coding benchmark run ${run.runId} has an invalid legacy model execution.`);
  }
  const effectiveModelExecution = run.execution?.modelExecution ?? "provider";
  if (effectiveModelExecution !== "provider" && effectiveModelExecution !== "local_fixture") {
    throw new Error(`Coding benchmark run ${run.runId} has an invalid model execution.`);
  }
  if (run.execution.maxCostUsd !== undefined
    && (!Number.isFinite(run.execution.maxCostUsd) || run.execution.maxCostUsd <= 0)) {
    throw new Error(`Coding benchmark run ${run.runId} has an invalid maxCostUsd.`);
  }
  if (JSON.stringify(run.execution?.budgets) !== JSON.stringify(resolveCodingAgentBenchmarkTaskBudgets(manifest, task.id))) {
    throw new Error(`Coding benchmark run ${run.runId} execution budgets drifted from the manifest.`);
  }
  if (!Number.isInteger(run.execution?.infrastructureRetries)
    || run.execution.infrastructureRetries < 0
    || run.execution.infrastructureRetries > manifest.suite.retryPolicy.maxInfrastructureRetries) {
    throw new Error(`Coding benchmark run ${run.runId} has an invalid infrastructure retry count.`);
  }
  if (run.evaluation?.source !== "machine") {
    throw new Error(`Coding benchmark run ${run.runId} must use a machine evaluator.`);
  }
  if (typeof run.evaluation.taskCompleted !== "boolean") {
    throw new Error(`Coding benchmark run ${run.runId} requires taskCompleted.`);
  }
  for (const field of ["testsPassed", "patchAccepted", "dangerousOperationBlocked", "recoverySucceeded"]) {
    const value = run.evaluation[field];
    if (value !== null && typeof value !== "boolean") {
      throw new Error(`Coding benchmark run ${run.runId} has an invalid ${field}.`);
    }
  }
  for (const field of ["regressionCount", "manualInterventionCount"]) {
    const value = run.evaluation[field];
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Coding benchmark run ${run.runId} has an invalid ${field}.`);
    }
  }
  if (run.status === "passed") {
    if (!run.evaluation.taskCompleted || run.failureCategory !== null) {
      throw new Error(`Passed coding benchmark run ${run.runId} must be complete without a failure category.`);
    }
  } else {
    const categories = new Set(manifest.failureTaxonomy.map((item) => item.id));
    if (!categories.has(run.failureCategory)) {
      throw new Error(`Failed coding benchmark run ${run.runId} requires a known failure category.`);
    }
  }
  if (contract.requiresHarnessIdentity
    && ((run.status === "infrastructure_error") !== (run.failureCategory === "infrastructure"))) {
    throw new Error(
      `Coding benchmark ${contract.revision} run ${run.runId} must pair infrastructure failures with status=infrastructure_error.`,
    );
  }
  if (!run.environment || typeof run.environment !== "object" || Array.isArray(run.environment)) {
    throw new Error(`Coding benchmark run ${run.runId} requires an environment fingerprint.`);
  }
  assertExactKeys(
    run.environment,
    ["osRelease", "arch", "nodeVersion", "packageManager", "wsl", "model"],
    `Coding benchmark run ${run.runId} environment`,
  );
  for (const field of ["osRelease", "arch", "nodeVersion", "packageManager"]) {
    if (typeof run.environment[field] !== "string" || !run.environment[field].trim()) {
      throw new Error(`Coding benchmark run ${run.runId} environment requires ${field}.`);
    }
  }
  if (!run.environment.model || typeof run.environment.model !== "object" || Array.isArray(run.environment.model)) {
    throw new Error(`Coding benchmark run ${run.runId} requires a model fingerprint.`);
  }
  assertExactKeys(
    run.environment.model,
    ["provider", "id", "credentialsConfigured"],
    `Coding benchmark run ${run.runId} model`,
  );
  for (const field of ["provider", "id"]) {
    if (typeof run.environment.model[field] !== "string" || !run.environment.model[field].trim()) {
      throw new Error(`Coding benchmark run ${run.runId} model requires ${field}.`);
    }
  }
  if (typeof run.environment.model?.credentialsConfigured !== "boolean") {
    throw new Error(`Coding benchmark run ${run.runId} records only credential presence as a boolean.`);
  }
  if (effectiveModelExecution === "local_fixture") {
    if (run.execution.maxCostUsd !== undefined
      || run.environment.model.provider !== "local_fixture"
      || run.environment.model.id !== task.fixture.generatorId
      || run.environment.model.credentialsConfigured !== false) {
      throw new Error(`Coding benchmark run ${run.runId} has an invalid local fixture model binding.`);
    }
  }
  if (run.platform === "wsl2-linux") {
    const wsl = run.environment.wsl;
    if (!wsl || typeof wsl !== "object" || Array.isArray(wsl)) {
      throw new Error(`Coding benchmark run ${run.runId} requires a WSL2 environment fingerprint.`);
    }
    assertExactKeys(wsl, ["distribution", "version"], `Coding benchmark run ${run.runId} WSL2 fingerprint`);
    if (typeof wsl.distribution !== "string" || !wsl.distribution.trim() || wsl.version !== 2) {
      throw new Error(`Coding benchmark run ${run.runId} has an invalid WSL2 environment fingerprint.`);
    }
  } else if (run.environment.wsl !== null) {
    throw new Error(`Coding benchmark run ${run.runId} must not record a WSL2 fingerprint on Windows native.`);
  }
  if (!Number.isFinite(run.usage?.durationMs) || run.usage.durationMs < 0) {
    throw new Error(`Coding benchmark run ${run.runId} requires a non-negative durationMs.`);
  }
  for (const field of ["inputTokens", "outputTokens"]) {
    const value = run.usage[field];
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      throw new Error(`Coding benchmark run ${run.runId} has invalid ${field}.`);
    }
  }
  if (run.usage.observation !== undefined) {
    const observation = run.usage.observation;
    if (!observation || typeof observation !== "object" || Array.isArray(observation)
      || (observation.status !== "provider_reported"
        && observation.status !== "unavailable"
        && observation.status !== "not_reached")
      || (observation.costUsd !== null
        && (!Number.isFinite(observation.costUsd) || observation.costUsd < 0))
      || (observation.status !== "provider_reported" && observation.costUsd !== null)) {
      throw new Error(`Coding benchmark run ${run.runId} has an invalid usage observation.`);
    }
  }
  if (effectiveModelExecution === "local_fixture"
    && (run.usage.inputTokens !== null
      || run.usage.outputTokens !== null
      || run.usage.observation?.status !== "not_reached"
      || run.usage.observation.costUsd !== null)) {
    throw new Error(`Coding benchmark run ${run.runId} has invalid local fixture usage evidence.`);
  }
  const artifactFields = [
    "manifest",
    "events",
    "result",
    "patch",
    "diagnostics",
    "status",
    ...(contract.requiresPreflightArtifact ? ["preflight"] : []),
    ...(contract.requiresPreflightArtifact
      && (task.id === "command.interactive-control" || task.id === "safety.boundary-enforcement")
      ? ["approvalContract", "approvalEvidence"]
      : []),
    ...(task.id === "gateway.disconnect-recovery" ? ["faultInjection"] : []),
    ...(task.id === "gateway.client-cancel" ? ["cancelInjection"] : []),
    ...(task.id === "gateway.process-restart" ? ["restartInjection"] : []),
    ...(contract.revision === "v3" && task.layer === "B"
      ? ["repositorySnapshotPreflight", "repositorySnapshotReceipt"]
      : []),
    ...(contract.revision === "v3" && task.layer === "C"
      ? ["systemScenario", "systemEvidence"]
      : []),
  ];
  const isV3BrowserRun = contract.revision === "v3" && task.id === "system.browser-behavior";
  if (isV3BrowserRun && run.status === "passed"
    && !Object.hasOwn(run.artifacts, "systemBrowserScreenshot")) {
    throw new Error(
      `Coding benchmark run ${run.runId} passed browser behavior without a screenshot artifact.`,
    );
  }
  if (isV3BrowserRun && (run.status === "passed" || run.status === "failed")
    && Object.hasOwn(run.artifacts, "systemBrowserScreenshot")) {
    artifactFields.push("systemBrowserScreenshot");
  }
  assertExactKeys(run.artifacts, artifactFields, `Coding benchmark run ${run.runId} artifacts`);
  for (const field of artifactFields) {
    const artifactPath = run.artifacts[field];
    if (!isSafeManifestPath(artifactPath) || !artifactPath.startsWith(`${run.runId}/`)) {
      throw new Error(
        `Coding benchmark run ${run.runId} artifact path ${field} must stay inside its run directory.`,
      );
    }
  }
}

function assertRepositoryIdentity(identity, label, requireWorktreeContentSha256) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
    throw new Error(`Coding benchmark report requires ${label} identity.`);
  }
  const keys = ["commit", "workspaceDirty", "lockfileSha256"];
  if (requireWorktreeContentSha256) keys.push("worktreeContentSha256");
  assertExactKeys(identity, keys, `Coding benchmark ${label}`);
  if (typeof identity.commit !== "string" || !/^[0-9a-f]{40}$/i.test(identity.commit)) {
    throw new Error(`Coding benchmark ${label} commit must be a full Git SHA-1.`);
  }
  if (typeof identity.workspaceDirty !== "boolean") {
    throw new Error(`Coding benchmark ${label} must record workspaceDirty.`);
  }
  requireSha256(identity.lockfileSha256, `${label}.lockfileSha256`);
  if (requireWorktreeContentSha256) {
    requireSha256(identity.worktreeContentSha256, `${label}.worktreeContentSha256`);
  }
}

function assertExactKeys(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const expected = new Set(expectedKeys);
  const missing = expectedKeys.filter((key) => !Object.hasOwn(value, key));
  if (missing.length > 0) {
    throw new Error(`${label} is missing required field(s): ${missing.join(", ")}.`);
  }
  const unexpected = Object.keys(value).filter((key) => !expected.has(key));
  if (unexpected.length > 0) {
    throw new Error(`${label} has unexpected field(s): ${unexpected.join(", ")}.`);
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error(`Coding benchmark ${label} must be a SHA-256 digest.`);
  }
}

function booleanRate(values) {
  return rate(values, values.length);
}

function applicableBooleanRate(values) {
  const applicable = values.filter((value) => value !== null);
  return rate(applicable, applicable.length);
}

function rate(values, denominator) {
  const numerator = values.filter(Boolean).length;
  return {
    numerator,
    denominator,
    value: denominator === 0 ? null : round(numerator / denominator, 6),
  };
}

function nullableSum(values) {
  const present = values.filter((value) => value !== null);
  return {
    sampleCount: present.length,
    value: present.length === 0 ? null : sum(present),
  };
}

function summarizeDistribution(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const total = sum(sorted);
  const percentile = (value) => sorted[Math.max(0, Math.ceil(value * sorted.length) - 1)];
  return {
    sampleCount: sorted.length,
    total: round(total),
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
    mean: round(total / sorted.length),
    median: round(percentile(0.5)),
    p95: round(percentile(0.95)),
  };
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function round(value, digits = 3) {
  return Number(value.toFixed(digits));
}

function assertOrderedIds(items, expectedIds, label) {
  if (!Array.isArray(items)) {
    throw new Error(`Coding benchmark ${label} must be an array.`);
  }
  const actualIds = items.map((item) => item?.id);
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    throw new Error(`Coding benchmark ${label} must contain ${expectedIds.join(", ")} in contract order.`);
  }
  for (const item of items) {
    if (typeof item.description !== "string" || !item.description.trim()) {
      throw new Error(`Coding benchmark ${label} item ${String(item.id)} requires a description.`);
    }
  }
}

function assertMetricDefinitions(metrics) {
  if (!Array.isArray(metrics)) {
    throw new Error("Coding benchmark metrics must be an array.");
  }
  const actual = metrics.map((metric) => [metric?.id, metric?.aggregation, metric?.source]);
  if (JSON.stringify(actual) !== JSON.stringify(REQUIRED_METRICS)) {
    throw new Error("Coding benchmark metrics drifted from the v1 aggregation contract.");
  }
  for (const metric of metrics) {
    if (typeof metric.description !== "string" || !metric.description.trim()) {
      throw new Error(`Coding benchmark metric ${String(metric.id)} requires a description.`);
    }
  }
}

function assertNoCredentialFields(value, location = "manifest") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (CREDENTIAL_FIELD_PATTERN.test(key)) {
      throw new Error(`Credential field ${location}.${key} is not allowed in the coding benchmark manifest.`);
    }
    assertNoCredentialFields(child, `${location}.${key}`);
  }
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

function resolveCodingAgentBenchmarkContractByRevision(revision) {
  const normalized = typeof revision === "string" && revision.trim() ? revision.trim() : "v1";
  const contract = BENCHMARK_CONTRACTS[normalized];
  if (!contract) throw new Error(`Unsupported coding benchmark manifest revision: ${normalized}.`);
  return contract;
}

function resolveCodingAgentBenchmarkContractByManifest(manifest) {
  return Object.values(BENCHMARK_CONTRACTS).find((contract) => contract.manifestVersion === manifest?.schemaVersion);
}
