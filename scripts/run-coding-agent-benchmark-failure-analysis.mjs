import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

export const CODING_AGENT_BENCHMARK_FAILURE_ANALYSIS_V1_VERSION =
  "coding-agent-benchmark-failure-analysis/v1";
export const CODING_AGENT_BENCHMARK_FAILURE_ANALYSIS_VERSION =
  "coding-agent-benchmark-failure-analysis/v2";

const AGGREGATE_VERSION = "coding-agent-benchmark-report/v3";
const RUN_VERSION = "coding-agent-benchmark-run/v3";
const OUTPUT_NAME = "failure-analysis.json";
const MAX_AGGREGATE_BYTES = 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_EVENTS_BYTES = 8 * 1024 * 1024;
const MAX_PATCH_BYTES = 5 * 1024 * 1024;
const MAX_ANALYSIS_BYTES = 2 * 1024 * 1024;
const TERMINAL_TYPES = new Set([
  "run.cancelled",
  "run.interrupted",
  "run.completed",
  "run.failed",
]);
const EDIT_TOOLS = new Set(["apply_patch", "file_edit", "file_write", "file_delete"]);
const LEGACY_FAMILY_DEFINITIONS = [
  {
    id: "model_empty_content_at_length",
    priority: 1,
    observationCode: "provider_length_stop_with_reasoning_and_no_visible_content",
  },
  {
    id: "required_mutation_recovery_failed",
    priority: 6,
    observationCode: "required_workspace_mutation_recovery_failed_before_edit",
  },
  {
    id: "completed_without_required_mutation",
    priority: 2,
    observationCode: "terminal_completed_without_required_workspace_mutation",
  },
  {
    id: "patch_acceptance_failed",
    priority: 3,
    observationCode: "edit_attempt_failed_or_workspace_patch_machine_rejected",
  },
  {
    id: "token_budget_exhausted",
    priority: 4,
    observationCode: "total_token_budget_exhausted",
  },
  {
    id: "output_schema_invalid",
    priority: 5,
    observationCode: "terminal_output_schema_invalid",
  },
];
const V2_FAMILY_DEFINITIONS = [
  ...LEGACY_FAMILY_DEFINITIONS,
  {
    id: "required_source_navigation_incomplete",
    priority: 7,
    observationCode: "bounded_source_navigation_missing_required_paths",
  },
  {
    id: "mutation_patch_contract_invalid",
    priority: 8,
    observationCode: "mutation_only_patch_structure_invalid",
  },
  {
    id: "post_write_correction_failed",
    priority: 9,
    observationCode: "post_write_review_or_correction_failed",
  },
  {
    id: "accepted_patch_regression",
    priority: 10,
    observationCode: "accepted_patch_failed_tests_or_regressed",
  },
  {
    id: "model_empty_content_at_stop",
    priority: 11,
    observationCode: "provider_stop_with_reasoning_and_no_visible_content",
  },
  {
    id: "unknown",
    priority: 99,
    observationCode: "unrecognized_metadata_signature",
  },
];
const V1_FAMILY_DEFINITIONS = [
  ...LEGACY_FAMILY_DEFINITIONS,
  {
    id: "unknown",
    priority: 99,
    observationCode: "unrecognized_metadata_signature",
  },
];
const EMPTY_CONTENT_AT_LENGTH_PATTERN =
  /^模型返回空内容。finish_reason=length，reasoning_content=present\([0-9]+\)。$/u;
const EMPTY_CONTENT_AT_STOP_PATTERN =
  /^模型返回空内容。finish_reason=stop，reasoning_content=present\([0-9]+\)。$/u;
const REQUIRED_MUTATION_EMPTY_CONTENT_AT_LENGTH_PATTERN =
  /^required workspace mutation was not completed: the mutation-only model call failed: 模型返回空内容。finish_reason=length，reasoning_content=present\([0-9]+\)。$/u;
const REQUIRED_MUTATION_BUDGET_GATE_PATTERN =
  /^required workspace mutation was not completed: the ordinary model loop reached its budget gate before an allowed bounded mutation-only request could be built\.$/u;
const REQUIRED_SOURCE_NAVIGATION_PATTERN =
  /^required workspace mutation was not completed: the bounded source-navigation model call did not request each missing required source path exactly once\.$/u;
const MUTATION_PATCH_CONTRACT_PATTERN =
  /^required workspace mutation was not completed: the mutation-only apply_patch call contained a context-only hunk that could not be preserved safely;/u;
const POST_WRITE_CORRECTION_PATTERNS = [
  /^required workspace mutation was not completed: post-write correction tool apply_patch failed:/u,
  /^required workspace mutation was not completed: the post-write objective correction only repeated a current-source block around unchanged lines instead of changing task-relevant behavior\.$/u,
  /^required workspace mutation was not completed: the post-write objective correction did not narrowly refine the prior mutation despite the smallest-change requirement\.$/u,
  /^required workspace mutation was not completed: the post-write objective review returned neither valid final JSON nor an allowed correction after its one phase-aware output repair\.$/u,
];
const scriptPath = fileURLToPath(import.meta.url);

function resolveFailureAnalysisContract(schemaVersion = CODING_AGENT_BENCHMARK_FAILURE_ANALYSIS_VERSION) {
  if (schemaVersion === CODING_AGENT_BENCHMARK_FAILURE_ANALYSIS_V1_VERSION) {
    return { schemaVersion, familyDefinitions: V1_FAMILY_DEFINITIONS };
  }
  if (schemaVersion === CODING_AGENT_BENCHMARK_FAILURE_ANALYSIS_VERSION) {
    return { schemaVersion, familyDefinitions: V2_FAMILY_DEFINITIONS };
  }
  throw new Error(`Unsupported failure analysis schema version: ${String(schemaVersion)}.`);
}

export function buildCodingAgentFailureAnalysis(input) {
  const contract = resolveFailureAnalysisContract(input?.schemaVersion);
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  const aggregate = requireObject(input?.aggregate, "aggregate");
  const aggregateText = requireText(input?.aggregateText, "aggregateText");
  const parsedAggregate = parseJson(aggregateText, "aggregate text");
  if (!isDeepStrictEqual(parsedAggregate, aggregate)) {
    throw new Error("Aggregate text does not match the parsed aggregate input.");
  }
  validateAggregate(aggregate);

  const failedRuns = aggregate.runs.filter((run) =>
    run?.status === "failed" && run?.failureCategory === "product_workflow");
  const declaredFailureCount = aggregate.summary?.failuresByCategory?.product_workflow ?? 0;
  if (failedRuns.length !== declaredFailureCount) {
    throw new Error("Aggregate product workflow failure count drifted from its summary.");
  }

  const artifactInputs = requireArray(input?.artifactInputs, "artifactInputs");
  const artifactsByRunId = new Map();
  for (const item of artifactInputs) {
    const runId = requireString(item?.runId, "artifact runId");
    if (artifactsByRunId.has(runId)) {
      throw new Error(`Duplicate failure artifact input for ${runId}.`);
    }
    artifactsByRunId.set(runId, item);
  }
  if (artifactsByRunId.size !== failedRuns.length) {
    throw new Error("Failure artifact count does not cover the aggregate product failures.");
  }

  const runs = failedRuns.map((run) => {
    const artifactInput = artifactsByRunId.get(run.runId);
    if (!artifactInput) throw new Error(`Missing failure artifacts for ${run.runId}.`);
    return analyzeFailureRun(run, artifactInput, contract.schemaVersion);
  }).sort(compareRunEvidence);
  for (const runId of artifactsByRunId.keys()) {
    if (!failedRuns.some((run) => run.runId === runId)) {
      throw new Error(`Artifact input ${runId} is not a selected product failure.`);
    }
  }

  const families = contract.familyDefinitions.map((definition) => {
    const matching = runs.filter((run) => run.family === definition.id);
    return {
      id: definition.id,
      priority: definition.priority,
      observationCode: definition.observationCode,
      runCount: matching.length,
      taskCount: new Set(matching.map((run) => run.taskId)).size,
      taskIds: [...new Set(matching.map((run) => run.taskId))].sort(),
      platforms: sortPlatforms(new Set(matching.map((run) => run.platform))),
    };
  }).filter((family) => family.runCount > 0);
  const unknownCount = runs.filter((run) => run.family === "unknown").length;
  const targetFamily = unknownCount === 0
    ? [...families].filter((family) => family.id !== "unknown").sort(
      (left, right) => right.runCount - left.runCount || left.priority - right.priority,
    )[0]?.id ?? null
    : null;

  return {
    schemaVersion: contract.schemaVersion,
    generatedAt,
    status: unknownCount === 0 ? "completed" : "incomplete",
    source: {
      aggregateSha256: sha256(aggregateText),
      aggregateSchemaVersion: aggregate.schemaVersion,
      aggregateGeneratedAt: requireString(aggregate.generatedAt, "aggregate.generatedAt"),
      manifestSha256: requireSha256(aggregate.suite.manifestSha256, "suite.manifestSha256"),
      sourceCommit: requireSha1(aggregate.source.commit, "source.commit"),
      sourceContentSha256: requireSha256(
        aggregate.source.worktreeContentSha256,
        "source.worktreeContentSha256",
      ),
      harnessCommit: requireSha1(aggregate.harness.commit, "harness.commit"),
      harnessContentSha256: requireSha256(
        aggregate.harness.worktreeContentSha256,
        "harness.worktreeContentSha256",
      ),
    },
    scope: {
      sourceRunCount: aggregate.runs.length,
      analyzedFailureCount: runs.length,
      failureCategory: "product_workflow",
      platforms: sortPlatforms(new Set(runs.map((run) => run.platform))),
      modelMetadataPolicy: "excluded_untrusted_runner_declaration",
    },
    execution: {
      mode: "offline-analysis",
      modelCalls: 0,
      providerCalls: 0,
      networkCalls: 0,
      credentialsRead: false,
      aggregateModified: false,
      contentMode: "metadata_only",
    },
    families,
    runs,
    summary: {
      analyzedFailureCount: runs.length,
      unknownCount,
      failedEditCallCount: sum(runs.map((run) => run.signals.failedEditCallCount)),
      changedRunCount: runs.filter((run) => run.signals.workspaceMutationObserved).length,
      familyCounts: families.map((family) => ({ id: family.id, count: family.runCount })),
      taskBreakdown: summarizeTasks(runs, contract.familyDefinitions),
      nextAction: unknownCount > 0
        ? {
            status: "blocked_unknown_failure_evidence",
            targetFamily: null,
            reasonCode: "unknown_failure_family_present",
          }
        : {
            status: "ready_for_improvement",
            targetFamily,
            reasonCode: "largest_cross_task_failure_family",
          },
    },
    diagnostics: [],
  };
}

function validateAggregate(aggregate) {
  if (aggregate.schemaVersion !== AGGREGATE_VERSION
    || aggregate.status !== "completed"
    || aggregate.benchmark?.id !== "ss-project-coding-v3"
    || aggregate.summary?.eligibleForProductComparison !== true
    || aggregate.summary?.infrastructureErrorRunCount !== 0
    || !Array.isArray(aggregate.runs)
    || aggregate.runs.length === 0
    || aggregate.summary?.runCount !== aggregate.runs.length
    || aggregate.summary?.productRunCount !== aggregate.runs.length) {
    throw new Error("Aggregate is not a completed analysis-safe v3 product baseline.");
  }
  if (aggregate.source?.workspaceDirty !== false
    || aggregate.harness?.workspaceDirty !== false
    || aggregate.source?.commit !== aggregate.harness?.commit
    || aggregate.source?.worktreeContentSha256 !== aggregate.harness?.worktreeContentSha256) {
    throw new Error("Aggregate source and harness identity are not clean and aligned.");
  }
  const runIds = aggregate.runs.map((run) => requireString(run?.runId, "runId"));
  if (new Set(runIds).size !== runIds.length) {
    throw new Error("Aggregate contains duplicate run IDs.");
  }
}

function analyzeFailureRun(run, input, schemaVersion) {
  if (run.schemaVersion !== RUN_VERSION
    || run.status !== "failed"
    || run.failureCategory !== "product_workflow") {
    throw new Error(`${run.runId} is not an analysis-safe product failure.`);
  }
  const manifest = requireObject(input?.manifest, `${run.runId} manifest`);
  const manifestText = requireText(input?.manifestText, `${run.runId} manifestText`);
  if (!isDeepStrictEqual(parseJson(manifestText, `${run.runId} manifest text`), manifest)
    || !isDeepStrictEqual(manifest, run)) {
    throw new Error(`${run.runId} manifest drifted from the aggregate run.`);
  }
  const events = requireArray(input?.events, `${run.runId} events`);
  const eventsText = requireText(input?.eventsText, `${run.runId} eventsText`);
  if (!isDeepStrictEqual(parseJsonl(eventsText, run.runId), events)) {
    throw new Error(`${run.runId} event text drifted from parsed events.`);
  }
  const patch = Buffer.isBuffer(input?.patch)
    ? input.patch
    : input?.patch instanceof Uint8Array
      ? Buffer.from(input.patch)
      : undefined;
  if (!patch) throw new Error(`${run.runId} patch must be bytes.`);

  const eventEvidence = summarizeEvents(events, run.runId);
  const workspaceMutationObserved = patch.length > 0;
  if (eventEvidence.terminalChangedFileCount !== null
    && (eventEvidence.terminalChangedFileCount > 0) !== workspaceMutationObserved) {
    throw new Error(`${run.runId} patch bytes drifted from terminal change evidence.`);
  }
  const family = classifyFailure({
    terminalType: eventEvidence.terminalType,
    errorCode: eventEvidence.errorCode,
    errorMessage: eventEvidence.errorMessage,
    workspaceMutationObserved,
    editCallCount: eventEvidence.editCallCount,
    failedEditCallCount: eventEvidence.failedEditCallCount,
    patchAccepted: run.evaluation?.patchAccepted,
    testsPassed: run.evaluation?.testsPassed,
    regressionCount: run.evaluation?.regressionCount,
  }, schemaVersion);

  return {
    runId: run.runId,
    taskId: requireString(run.taskId, `${run.runId} taskId`),
    platform: requirePlatform(run.platform),
    attempt: requirePositiveInteger(run.attempt, `${run.runId} attempt`),
    family,
    signals: {
      terminalType: eventEvidence.terminalType,
      errorCode: eventEvidence.errorCode,
      toolCallCount: eventEvidence.toolCallCount,
      editCallCount: eventEvidence.editCallCount,
      failedEditCallCount: eventEvidence.failedEditCallCount,
      workspaceMutationObserved,
      terminalChangeStatus: eventEvidence.terminalChangeStatus,
      terminalChangedFileCount: eventEvidence.terminalChangedFileCount,
      patchBytes: patch.length,
      testsPassed: requireNullableBoolean(run.evaluation?.testsPassed, `${run.runId} testsPassed`),
      patchAccepted: requireNullableBoolean(
        run.evaluation?.patchAccepted,
        `${run.runId} patchAccepted`,
      ),
      regressionCount: requireNonNegativeInteger(
        run.evaluation?.regressionCount,
        `${run.runId} regressionCount`,
      ),
      usageStatus: requireUsageStatus(run.usage?.observation?.status),
    },
    source: {
      manifestSha256: sha256(manifestText),
      eventsSha256: sha256(eventsText),
      patchSha256: sha256(patch),
    },
  };
}

function summarizeEvents(events, runId) {
  if (events.length < 2 || events[0]?.type !== "run.started") {
    throw new Error(`${runId} must begin with run.started and include a terminal event.`);
  }
  const terminalIndexes = events.flatMap((event, index) =>
    TERMINAL_TYPES.has(event?.type) ? [index] : []);
  if (terminalIndexes.length !== 1 || terminalIndexes[0] !== events.length - 1) {
    throw new Error(`${runId} must contain exactly one final terminal event.`);
  }
  const startedTools = new Map();
  let toolCallCount = 0;
  let editCallCount = 0;
  let failedEditCallCount = 0;
  for (const event of events) {
    const tool = event?.payload?.tool;
    if (event?.type === "tool.started") {
      const id = requireString(tool?.id, `${runId} tool start id`);
      if (startedTools.has(id)) throw new Error(`${runId} has duplicate tool start ${id}.`);
      startedTools.set(id, requireString(tool?.name, `${runId} tool start name`));
    } else if (event?.type === "tool.completed") {
      const id = requireString(tool?.id, `${runId} tool completion id`);
      const name = requireString(tool?.name, `${runId} tool completion name`);
      if (startedTools.get(id) !== name) {
        throw new Error(`${runId} tool completion ${id} has no matching start.`);
      }
      startedTools.delete(id);
      toolCallCount += 1;
      if (EDIT_TOOLS.has(name)) {
        editCallCount += 1;
        if (tool?.success !== true) failedEditCallCount += 1;
      }
    }
  }
  if (startedTools.size > 0) throw new Error(`${runId} has incomplete tool lifecycle evidence.`);

  const terminal = events.at(-1);
  const terminalChanges = terminal?.payload?.changes;
  const terminalChangeStatus = terminalChanges === undefined
    ? "missing"
    : terminalChanges?.status === "available"
      ? "available"
      : terminalChanges?.status === "unavailable"
        ? "unavailable"
        : "missing";
  if (terminalChanges !== undefined
    && terminalChanges?.status !== undefined
    && terminalChangeStatus === "missing") {
    throw new Error(`${runId} terminal change status is invalid.`);
  }
  const terminalChangedFileCount = terminalChangeStatus === "available"
    ? requireNonNegativeInteger(terminalChanges?.changedFileCount, "changedFileCount")
    : null;
  if (terminalChangeStatus !== "available" && terminalChanges?.changedFileCount !== undefined) {
    throw new Error(`${runId} terminal change count is not available.`);
  }
  const errorCode = typeof terminal?.payload?.error?.code === "string"
    ? terminal.payload.error.code.trim() || null
    : null;
  const errorMessage = typeof terminal?.payload?.error?.message === "string"
    ? terminal.payload.error.message
    : "";
  return {
    terminalType: terminal.type,
    errorCode,
    errorMessage,
    toolCallCount,
    editCallCount,
    failedEditCallCount,
    terminalChangeStatus,
    terminalChangedFileCount,
  };
}

function classifyFailure(input, schemaVersion) {
  const legacyFamily = classifyLegacyFailure(input);
  if (legacyFamily !== "unknown"
    || schemaVersion === CODING_AGENT_BENCHMARK_FAILURE_ANALYSIS_V1_VERSION) {
    return legacyFamily;
  }
  if (input.terminalType === "run.failed"
    && input.errorCode === "internal"
    && REQUIRED_SOURCE_NAVIGATION_PATTERN.test(input.errorMessage)) {
    return "required_source_navigation_incomplete";
  }
  if (input.terminalType === "run.failed"
    && input.errorCode === "internal"
    && MUTATION_PATCH_CONTRACT_PATTERN.test(input.errorMessage)) {
    return "mutation_patch_contract_invalid";
  }
  if (input.terminalType === "run.failed"
    && input.errorCode === "internal"
    && POST_WRITE_CORRECTION_PATTERNS.some((pattern) => pattern.test(input.errorMessage))) {
    return "post_write_correction_failed";
  }
  if (input.terminalType === "run.completed"
    && input.workspaceMutationObserved
    && input.patchAccepted === true
    && (input.testsPassed === false || input.regressionCount > 0)) {
    return "accepted_patch_regression";
  }
  if (input.terminalType === "run.failed"
    && input.errorCode === "internal"
    && EMPTY_CONTENT_AT_STOP_PATTERN.test(input.errorMessage)) {
    return "model_empty_content_at_stop";
  }
  return "unknown";
}

function classifyLegacyFailure(input) {
  if (input.errorCode === "budget_exhausted") return "token_budget_exhausted";
  if (input.errorCode === "output_schema_invalid") return "output_schema_invalid";
  if (input.terminalType === "run.failed"
    && input.errorCode === "internal"
    && input.editCallCount === 0
    && !input.workspaceMutationObserved
    && (REQUIRED_MUTATION_EMPTY_CONTENT_AT_LENGTH_PATTERN.test(input.errorMessage)
      || REQUIRED_MUTATION_BUDGET_GATE_PATTERN.test(input.errorMessage))) {
    return "required_mutation_recovery_failed";
  }
  if (input.terminalType === "run.failed"
    && input.errorCode === "internal"
    && EMPTY_CONTENT_AT_LENGTH_PATTERN.test(input.errorMessage)) {
    return "model_empty_content_at_length";
  }
  if ((input.workspaceMutationObserved || input.failedEditCallCount > 0)
    && input.patchAccepted === false) {
    return "patch_acceptance_failed";
  }
  if (input.terminalType === "run.completed" && !input.workspaceMutationObserved) {
    return "completed_without_required_mutation";
  }
  return "unknown";
}

function summarizeTasks(runs, familyDefinitions) {
  const taskIds = [...new Set(runs.map((run) => run.taskId))].sort();
  return taskIds.map((taskId) => {
    const taskRuns = runs.filter((run) => run.taskId === taskId);
    return {
      taskId,
      runCount: taskRuns.length,
      familyCounts: familyDefinitions.map((family) => ({
        id: family.id,
        count: taskRuns.filter((run) => run.family === family.id).length,
      })).filter((item) => item.count > 0),
    };
  });
}

export async function runCodingAgentFailureAnalysis(input) {
  requireSeparateRoots(input?.aggregateRoot, input?.outputRoot);
  const loaded = await loadFailureAnalysisInputs(input?.aggregateRoot);
  const artifact = buildCodingAgentFailureAnalysis({
    generatedAt: input?.generatedAt,
    ...loaded,
  });
  await writeCodingAgentFailureAnalysisArtifact(input?.outputRoot, artifact);
  return artifact;
}

export async function verifyCodingAgentFailureAnalysis(input) {
  requireSeparateRoots(input?.aggregateRoot, input?.outputRoot);
  const outputRoot = path.resolve(requireString(input?.outputRoot, "outputRoot"));
  const reportText = await readBoundedRegularFile(
    outputRoot,
    path.join(outputRoot, OUTPUT_NAME),
    MAX_ANALYSIS_BYTES,
    "failure analysis",
  );
  const report = requireObject(parseJson(reportText, "failure analysis"), "failure analysis");
  const loaded = await loadFailureAnalysisInputs(input?.aggregateRoot);
  const rebuilt = buildCodingAgentFailureAnalysis({
    generatedAt: report.generatedAt,
    schemaVersion: report.schemaVersion,
    ...loaded,
  });
  if (!isDeepStrictEqual(report, rebuilt)) {
    throw new Error("Failure analysis report drifted from the aggregate evidence.");
  }
  return report;
}

async function loadFailureAnalysisInputs(aggregateRootInput) {
  const aggregateRoot = path.resolve(requireString(aggregateRootInput, "aggregateRoot"));
  const aggregatePath = path.join(aggregateRoot, "benchmark-report.json");
  const aggregateText = await readBoundedRegularFile(
    aggregateRoot,
    aggregatePath,
    MAX_AGGREGATE_BYTES,
    "aggregate",
  );
  const aggregate = parseJson(aggregateText, "aggregate");
  validateAggregate(aggregate);
  const failedRuns = aggregate.runs.filter((run) =>
    run?.status === "failed" && run?.failureCategory === "product_workflow");
  const artifactInputs = [];
  for (const run of failedRuns) {
    const manifestPath = resolveArtifactPath(aggregateRoot, run.artifacts?.manifest, run.runId);
    const eventsPath = resolveArtifactPath(aggregateRoot, run.artifacts?.events, run.runId);
    const patchPath = resolveArtifactPath(aggregateRoot, run.artifacts?.patch, run.runId);
    const manifestText = await readBoundedRegularFile(
      aggregateRoot,
      manifestPath,
      MAX_MANIFEST_BYTES,
      `${run.runId} manifest`,
    );
    const eventsText = await readBoundedRegularFile(
      aggregateRoot,
      eventsPath,
      MAX_EVENTS_BYTES,
      `${run.runId} events`,
    );
    const patch = await readBoundedRegularBytes(
      aggregateRoot,
      patchPath,
      MAX_PATCH_BYTES,
      `${run.runId} patch`,
    );
    artifactInputs.push({
      runId: run.runId,
      manifest: parseJson(manifestText, `${run.runId} manifest`),
      manifestText,
      events: parseJsonl(eventsText, run.runId),
      eventsText,
      patch,
    });
  }
  return {
    aggregate,
    aggregateText,
    artifactInputs,
  };
}

export async function writeCodingAgentFailureAnalysisArtifact(outputRoot, artifact) {
  const resolvedRoot = path.resolve(requireString(outputRoot, "outputRoot"));
  try {
    await fs.mkdir(resolvedRoot, { recursive: false });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`Failure analysis output root already exists: ${resolvedRoot}`);
    }
    throw error;
  }
  await fs.writeFile(path.join(resolvedRoot, OUTPUT_NAME), `${JSON.stringify(artifact, null, 2)}\n`, {
    flag: "wx",
  });
}

export function parseCodingAgentFailureAnalysisCliArguments(argv) {
  const values = new Map();
  let verify = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--verify") {
      if (verify) throw new Error("Duplicate failure analysis argument: --verify");
      verify = true;
      continue;
    }
    if (!["--aggregate-root", "--output-root", "--generated-at"].includes(flag)) {
      throw new Error(`Unknown failure analysis argument: ${flag}`);
    }
    const value = argv[++index];
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`${flag} requires a value.`);
    }
    if (values.has(flag)) throw new Error(`Duplicate failure analysis argument: ${flag}`);
    values.set(flag, value);
  }
  if (verify && values.has("--generated-at")) {
    throw new Error("--verify does not accept --generated-at.");
  }
  return {
    ...(verify ? { mode: "verify" } : {}),
    aggregateRoot: requireString(values.get("--aggregate-root"), "--aggregate-root"),
    outputRoot: requireString(values.get("--output-root"), "--output-root"),
    ...(values.has("--generated-at") ? { generatedAt: values.get("--generated-at") } : {}),
  };
}

function resolveArtifactPath(root, relativePath, runId) {
  const value = requireString(relativePath, `${runId} artifact path`);
  if (path.isAbsolute(value) || value.includes("\\")) {
    throw new Error(`${runId} artifact path must be a portable relative path.`);
  }
  const resolved = path.resolve(root, ...value.split("/"));
  if (!isInside(root, resolved)) throw new Error(`${runId} artifact path escapes the aggregate root.`);
  return resolved;
}

function requireSeparateRoots(aggregateRootInput, outputRootInput) {
  const aggregateRoot = path.resolve(requireString(aggregateRootInput, "aggregateRoot"));
  const outputRoot = path.resolve(requireString(outputRootInput, "outputRoot"));
  if (isInside(aggregateRoot, outputRoot) || isInside(outputRoot, aggregateRoot)) {
    throw new Error("Aggregate and failure analysis output roots must not overlap.");
  }
}

async function readBoundedRegularFile(root, filePath, maxBytes, label) {
  return (await readBoundedRegularBytes(root, filePath, maxBytes, label)).toString("utf-8");
}

async function readBoundedRegularBytes(root, filePath, maxBytes, label) {
  const [rootRealPath, stat] = await Promise.all([fs.realpath(root), fs.lstat(filePath)]);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) {
    throw new Error(`${label} must be a regular file no larger than ${maxBytes} bytes.`);
  }
  const fileRealPath = await fs.realpath(filePath);
  if (!isInside(rootRealPath, fileRealPath)) throw new Error(`${label} escapes the aggregate root.`);
  return await fs.readFile(fileRealPath);
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function parseJsonl(text, label) {
  const lines = text.split(/\r?\n/u).filter((line) => line.trim());
  if (lines.length === 0) throw new Error(`${label} events are empty.`);
  return lines.map((line, index) => parseJson(line, `${label} event ${index + 1}`));
}

function compareRunEvidence(left, right) {
  return left.taskId.localeCompare(right.taskId)
    || left.platform.localeCompare(right.platform)
    || left.attempt - right.attempt
    || left.runId.localeCompare(right.runId);
}

function sortPlatforms(values) {
  return [...values].sort((left, right) =>
    ["windows-native", "wsl2-linux"].indexOf(left)
      - ["windows-native", "wsl2-linux"].indexOf(right));
}

function requireUsageStatus(value) {
  if (value === "provider_reported" || value === "unavailable" || value === "not_reached") {
    return value;
  }
  throw new Error("Run usage observation status is invalid.");
}

function requirePlatform(value) {
  if (value === "windows-native" || value === "wsl2-linux") return value;
  throw new Error(`Unsupported failure analysis platform: ${String(value)}`);
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function requireText(value, label) {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be text.`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty.`);
  return value.trim();
}

function requireIsoTimestamp(value) {
  const text = requireString(value, "generatedAt");
  if (!Number.isFinite(Date.parse(text))) throw new Error("generatedAt must be an ISO timestamp.");
  return text;
}

function requireSha1(value, label) {
  const text = requireString(value, label).toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(text)) throw new Error(`${label} must be SHA-1.`);
  return text;
}

function requireSha256(value, label) {
  const text = requireString(value, label).toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(text)) throw new Error(`${label} must be SHA-256.`);
  return text;
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be positive.`);
  return value;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be non-negative.`);
  return value;
}

function requireNullableBoolean(value, label) {
  if (value === null || typeof value === "boolean") return value;
  throw new Error(`${label} must be boolean or null.`);
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function main() {
  const options = parseCodingAgentFailureAnalysisCliArguments(process.argv.slice(2));
  const artifact = options.mode === "verify"
    ? await verifyCodingAgentFailureAnalysis(options)
    : await runCodingAgentFailureAnalysis(options);
  const action = options.mode === "verify" ? "verified" : artifact.status;
  console.log(`[coding-agent-failure-analysis] ${action} ${artifact.summary.analyzedFailureCount} failure(s)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath)) {
  main().catch((error) => {
    console.error(`[coding-agent-failure-analysis] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
