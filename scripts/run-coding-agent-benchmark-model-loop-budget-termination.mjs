import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MODEL_LOOP_COST_CONTAINMENT_LIMITS,
  MODEL_LOOP_COST_CONTAINMENT_POLICY_ID,
  ReActRunBudgetTracker,
} from "../packages/belldandy-agent/src/react-run-budget.ts";

export const CODING_AGENT_BENCHMARK_MODEL_LOOP_BUDGET_TERMINATION_VERSION =
  "coding-agent-benchmark-model-loop-budget-termination/v1";

const P0_27_ANALYSIS_VERSION = "coding-agent-benchmark-navigation-shadow-v3-analysis/v1";
const P0_27_ANALYSIS_SHA256 = "cb3b746701c931a2d21b60f4dd0c74e4d2eb45cb120ed7b557815cf89df1d7cf";
const FROZEN_AGGREGATE_SHA256 = "f008259be7068ed53e27202b1f9b21c7649ebe7e410b4468cafc75db3f12a994";
const TASK_ID = "real-js.bug-fix";
const CANDIDATE_ID = "workspace-write-navigation-candidate-v3";
const PLATFORMS = ["windows-native", "wsl2-linux"];
const EXPECTED_TOOL_SEQUENCES = Object.freeze({
  "windows-native": ["file_glob", "file_glob", "file_read", "text_search", "file_read", "file_read"],
  "wsl2-linux": ["file_glob", "file_glob", "file_read", "text_search", "text_search", "file_read"],
});
const RUNTIME_SOURCE_CONTRACTS = Object.freeze([
  {
    sourcePath: "packages/belldandy-agent/src/react-run-budget.ts",
    anchors: [
      "MODEL_LOOP_COST_CONTAINMENT_POLICY_ID",
      "minimumOutputTokenReserve: 1_024",
      "reserveModelCall(",
      "reserveToolCall(",
    ],
  },
  {
    sourcePath: "packages/belldandy-agent/src/tool-agent.ts",
    anchors: ["runBudget.reserveModelCall(", "runBudget.reserveToolCall(", "reasonCode:"],
  },
  {
    sourcePath: "packages/belldandy-skills/src/executor.ts",
    anchors: ["modelLoopBudgetPolicy", "cost-containment-v1"],
  },
  {
    sourcePath: "packages/belldandy-core/src/cli/commands/agent/run.ts",
    anchors: ["--model-loop-budget-policy", "cost-containment-v1"],
  },
  {
    sourcePath: "packages/belldandy-protocol/src/index.ts",
    anchors: ["modelLoopBudgetPolicy?: \"cost-containment-v1\""],
  },
  {
    sourcePath: "packages/belldandy-core/src/coding-run/gateway-conversation-event-adapter.ts",
    anchors: ["cost-containment-v1", "before_model_call", "reasonCode"],
  },
]);
const scriptPath = fileURLToPath(import.meta.url);

export function buildModelLoopBudgetTerminationArtifact(input) {
  const platform = requirePlatform(input?.platform);
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  const analysis = validateAnalysis(input?.analysis, platform);
  const aggregate = validateFrozenAggregate(input?.aggregate);
  const analysisText = requireText(input?.analysisText, "analysisText");
  const aggregateText = requireText(input?.aggregateText, "aggregateText");
  const runtimeSources = validateRuntimeSourceEntries(input?.runtimeSources);
  const observedCandidate = findObservedCandidate(analysis, platform);
  const observedToolSequence = observedCandidate.tools.sequence;
  const toolCounterfactual = replayObservedTools(observedToolSequence);

  const modelCallLimit = replayModelCallLimit();
  const fileReadLimit = replayToolLimit("file_read");
  const textSearchLimit = replayToolLimit("text_search");
  const remainingTokenReserve = replayRemainingTokenReserve();
  const remainingCost = replayRemainingCost();
  const ordinaryProfileCompatibility = replayOrdinaryProfile(observedToolSequence);

  return {
    schemaVersion: CODING_AGENT_BENCHMARK_MODEL_LOOP_BUDGET_TERMINATION_VERSION,
    generatedAt,
    status: "completed",
    platform,
    taskId: TASK_ID,
    policy: {
      id: MODEL_LOOP_COST_CONTAINMENT_POLICY_ID,
      objective: "cost_containment",
      scope: "explicit_opt_in",
      limits: { ...MODEL_LOOP_COST_CONTAINMENT_LIMITS },
      taskUplift: { status: "not_measured" },
      promotionEligible: false,
      candidateCreated: false,
      providerExpansionAllowed: false,
    },
    decisionBoundary: {
      sourceDecision: "do_not_promote",
      candidateLineStatus: "stopped",
      nextAction: "separate-model-loop-budget-and-termination-contract",
      budgetLimitRaised: false,
      totalTokenBudget: 24_000,
      aggregateExpansionAllowed: false,
      totalMatrixTasks: 144,
    },
    replays: {
      modelCallLimit,
      fileReadLimit,
      textSearchLimit,
      remainingTokenReserve,
      remainingCost,
    },
    observedCandidate: {
      candidateId: CANDIDATE_ID,
      runId: requireString(observedCandidate.runId, "candidate.runId"),
      originalModelCalls: observedCandidate.modelCalls,
      originalTotalTokens: observedCandidate.usage.totalTokens,
      originalBudgetObserved: observedCandidate.budget.observed,
      originalToolSequence: [...observedToolSequence],
      toolCounts: countNavigationTools(observedToolSequence),
      enteredEditPhase: false,
      changedFileCount: 0,
      budgetExhausted: true,
      taskCompleted: false,
      policyCounterfactual: {
        modelTerminationBeforeCall: 5,
        admittedModelCalls: 4,
        firstToolTermination: toolCounterfactual.termination,
        admittedToolsBeforeTermination: toolCounterfactual.admitted,
        allObservedToolsWithinLimits: toolCounterfactual.termination === null,
        taskOutcomeNotInferred: true,
      },
    },
    ordinaryProfileCompatibility,
    execution: {
      mode: "offline-replay",
      modelCalls: 0,
      providerCalls: 0,
      providerCostCny: 0,
      networkCalls: 0,
      hostCommandToolCalls: 0,
      credentialsRead: false,
      manifestModified: false,
      v3AggregateModified: false,
    },
    source: {
      analysisSha256: sha256(analysisText),
      frozenAggregateSha256: sha256(aggregateText),
      frozenAggregateRunCount: aggregate.summary.runCount,
      frozenAggregatePassedRunCount: aggregate.summary.passedRunCount,
      cumulativeHistoricalProviderCostCny: analysis.crossPlatform.totalObservedCostCny,
      runtimeSources,
    },
    diagnostics: [],
  };
}

export async function runModelLoopBudgetTermination(input) {
  const platform = requirePlatform(input?.platform);
  const sourceRoot = path.resolve(requireString(input?.sourceRoot, "sourceRoot"));
  const analysisRoot = path.resolve(requireString(input?.analysisRoot, "analysisRoot"));
  const aggregateReport = path.resolve(requireString(input?.aggregateReport, "aggregateReport"));
  const outputRoot = path.resolve(requireString(input?.outputRoot, "outputRoot"));
  await assertDirectory(sourceRoot, "source root");
  await assertDirectory(analysisRoot, "analysis root");
  await assertFile(aggregateReport, "aggregate report");
  await assertPathAbsent(outputRoot, "output root");
  assertDisjointRoots(outputRoot, analysisRoot, "output root", "analysis root");

  const analysisPath = path.join(analysisRoot, "navigation-shadow-v3-analysis.json");
  const [analysisText, aggregateText, runtimeSources] = await Promise.all([
    fs.readFile(analysisPath, "utf8"),
    fs.readFile(aggregateReport, "utf8"),
    loadRuntimeSources(sourceRoot),
  ]);
  assertSame(sha256(analysisText), P0_27_ANALYSIS_SHA256, "P0.27 analysis SHA-256");
  assertSame(sha256(aggregateText), FROZEN_AGGREGATE_SHA256, "frozen aggregate SHA-256");
  const artifact = buildModelLoopBudgetTerminationArtifact({
    platform,
    generatedAt: input?.generatedAt,
    analysis: JSON.parse(analysisText),
    analysisText,
    aggregate: JSON.parse(aggregateText),
    aggregateText,
    runtimeSources,
  });
  await writeModelLoopBudgetTerminationArtifact(outputRoot, artifact);
  return artifact;
}

export async function writeModelLoopBudgetTerminationArtifact(outputRoot, artifact) {
  const target = path.resolve(requireString(outputRoot, "outputRoot"));
  await assertPathAbsent(target, "output root");
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(
    path.join(target, "model-loop-budget-termination.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
}

export function parseModelLoopBudgetTerminationCliArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid CLI argument near ${key ?? "<end>"}.`);
    }
    const name = key.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
    if (!["platform", "sourceRoot", "analysisRoot", "aggregateReport", "outputRoot", "generatedAt"].includes(name)) {
      throw new Error(`Unknown CLI argument: ${key}`);
    }
    options[name] = value;
  }
  return {
    ...options,
    sourceRoot: options.sourceRoot ?? process.cwd(),
  };
}

function validateAnalysis(value, platform) {
  const analysis = requireObject(value, "P0.27 analysis");
  assertSame(analysis.schemaVersion, P0_27_ANALYSIS_VERSION, "P0.27 analysis version");
  assertSame(analysis.taskId, TASK_ID, "P0.27 task");
  assertSame(analysis.candidateId, CANDIDATE_ID, "P0.27 candidate");
  if (analysis.decision?.status !== "do_not_promote") {
    throw new Error("P0.27 decision must remain do_not_promote.");
  }
  if (analysis.decision?.candidateLineStatus !== "stopped") {
    throw new Error("P0.27 candidate line must remain stopped.");
  }
  if (analysis.decision?.nextAction !== "separate-model-loop-budget-and-termination-contract"
    || analysis.decision?.nextActionMode !== "offline") {
    throw new Error("P0.27 next action must remain the offline model-loop budget contract.");
  }
  if (analysis.decision?.providerExpansionAllowed !== false) {
    throw new Error("P0.27 must not allow Provider expansion.");
  }
  const execution = requireObject(analysis.execution, "P0.27 execution");
  if (execution.mode !== "offline-analysis" || execution.modelCalls !== 0
    || execution.networkCalls !== 0 || execution.hostCommandToolCalls !== 0
    || execution.manifestModified !== false || execution.v3AggregateModified !== false) {
    throw new Error("P0.27 execution boundary drifted from offline analysis.");
  }
  if (analysis.crossPlatform?.totalObservedCostCny !== 0.08318752) {
    throw new Error("P0.27 cumulative Provider cost drifted.");
  }
  const platforms = requireArray(analysis.platforms, "P0.27 platforms");
  if (platforms.length !== 2
    || platforms.map((item) => item?.platform).join(",") !== PLATFORMS.join(",")) {
    throw new Error("P0.27 must retain ordered Windows and WSL2 evidence.");
  }
  findObservedCandidate(analysis, platform);
  return analysis;
}

function findObservedCandidate(analysis, platform) {
  const platformEvidence = requireArray(analysis.platforms, "P0.27 platforms")
    .find((item) => item?.platform === platform);
  if (!platformEvidence) throw new Error(`P0.27 ${platform} evidence is missing.`);
  const candidate = requireArray(platformEvidence.candidates, `${platform} candidates`)
    .find((item) => item?.candidateId === CANDIDATE_ID);
  if (!candidate) throw new Error(`P0.27 ${platform} candidate v3 evidence is missing.`);
  if (candidate.modelCalls !== 6 || candidate.usage?.modelCalls !== 6) {
    throw new Error(`P0.27 ${platform} candidate must retain six model calls.`);
  }
  const totalTokens = candidate.usage?.totalTokens;
  if (!Number.isInteger(totalTokens) || candidate.usage.inputTokens + candidate.usage.outputTokens !== totalTokens
    || candidate.budget?.kind !== "total_tokens" || candidate.budget.limit !== 24_000
    || candidate.budget.observed !== totalTokens || totalTokens <= 24_000) {
    throw new Error(`P0.27 ${platform} token budget evidence drifted.`);
  }
  const expectedSequence = EXPECTED_TOOL_SEQUENCES[platform];
  if (JSON.stringify(candidate.tools?.sequence) !== JSON.stringify(expectedSequence)) {
    throw new Error(`P0.27 ${platform} observed tool sequence drifted.`);
  }
  if (candidate.tools?.editCallCount !== 0 || candidate.execution?.enteredEditPhase !== false
    || candidate.execution?.changedFileCount !== 0 || candidate.execution?.budgetExhausted !== true
    || candidate.evaluator?.taskCompleted !== false || candidate.evaluator?.patchAccepted !== false) {
    throw new Error(`P0.27 ${platform} failure signature drifted.`);
  }
  return candidate;
}

function validateFrozenAggregate(value) {
  const aggregate = requireObject(value, "frozen aggregate");
  if (aggregate.schemaVersion !== "coding-agent-benchmark-report/v3" || aggregate.status !== "partial") {
    throw new Error("Frozen aggregate identity or status drifted.");
  }
  if (aggregate.summary?.runCount !== 6) {
    throw new Error("Frozen aggregate must retain 6 runs.");
  }
  if (aggregate.summary?.passedRunCount !== 2) {
    throw new Error("Frozen aggregate must retain 2 passed runs.");
  }
  return aggregate;
}

async function loadRuntimeSources(sourceRoot) {
  return Promise.all(RUNTIME_SOURCE_CONTRACTS.map(async (contract) => {
    const absolutePath = path.join(sourceRoot, ...contract.sourcePath.split("/"));
    const text = await fs.readFile(absolutePath, "utf8");
    for (const anchor of contract.anchors) {
      if (!text.includes(anchor)) {
        throw new Error(`${contract.sourcePath} is missing contract anchor: ${anchor}`);
      }
    }
    return { sourcePath: contract.sourcePath, sha256: sha256(text) };
  }));
}

function validateRuntimeSourceEntries(value) {
  const sources = requireArray(value, "runtimeSources");
  if (sources.length !== RUNTIME_SOURCE_CONTRACTS.length) {
    throw new Error("Runtime source evidence must contain all six contract files.");
  }
  return RUNTIME_SOURCE_CONTRACTS.map((contract, index) => {
    const source = requireObject(sources[index], `runtimeSources[${index}]`);
    assertSame(source.sourcePath, contract.sourcePath, `runtime source ${index} path`);
    if (!/^[a-f0-9]{64}$/u.test(source.sha256)) {
      throw new Error(`Runtime source ${contract.sourcePath} SHA-256 is invalid.`);
    }
    return { sourcePath: source.sourcePath, sha256: source.sha256 };
  });
}

function replayModelCallLimit() {
  const tracker = createPolicyTracker();
  let termination;
  let admitted = 0;
  for (let attempted = 1; attempted <= 5; attempted++) {
    termination = tracker.reserveModelCall({ minimumInputTokens: 1 });
    if (termination) break;
    admitted += 1;
  }
  return {
    attempted: 5,
    admitted,
    wouldBlockProviderDispatch: true,
    termination: requireTermination(termination, "model_calls", "model_call_limit"),
  };
}

function replayToolLimit(toolName) {
  const tracker = createPolicyTracker();
  let termination;
  let admitted = 0;
  for (let attempted = 1; attempted <= 3; attempted++) {
    termination = tracker.reserveToolCall(toolName);
    if (termination) break;
    admitted += 1;
  }
  const budget = toolName === "file_read" ? "file_read_calls" : "text_search_calls";
  const reasonCode = toolName === "file_read" ? "file_read_call_limit" : "text_search_call_limit";
  return {
    toolName,
    attempted: 3,
    admitted,
    wouldBlockToolExecutor: true,
    termination: requireTermination(termination, budget, reasonCode),
  };
}

function replayRemainingTokenReserve() {
  const tracker = createPolicyTracker();
  const consumedTokens = 22_000;
  tracker.recordModelUsage({
    providerUsageAvailable: true,
    inputTokens: 21_000,
    outputTokens: 1_000,
  });
  const minimumNextInputTokens = 1_500;
  const termination = tracker.reserveModelCall({ minimumInputTokens: minimumNextInputTokens });
  return {
    consumedTokens,
    minimumNextInputTokens,
    minimumOutputTokenReserve: MODEL_LOOP_COST_CONTAINMENT_LIMITS.minimumOutputTokenReserve,
    projectedTokens: 24_524,
    wouldBlockProviderDispatch: true,
    termination: requireTermination(termination, "total_tokens", "insufficient_remaining_tokens"),
  };
}

function replayRemainingCost() {
  const maxCostUsd = 0.001;
  const consumedCostUsd = 0.0008;
  const minimumNextCostUsd = 0.0003;
  const tracker = createPolicyTracker({ maxCostUsd });
  tracker.recordModelUsage({
    providerUsageAvailable: true,
    inputTokens: 1,
    outputTokens: 1,
    costUsd: consumedCostUsd,
  });
  const termination = tracker.reserveModelCall({
    minimumInputTokens: 1,
    minimumCostUsd: minimumNextCostUsd,
  });
  return {
    maxCostUsd,
    consumedCostUsd,
    minimumNextCostUsd,
    projectedCostUsd: 0.0011,
    wouldBlockProviderDispatch: true,
    termination: requireTermination(termination, "cost_usd", "insufficient_remaining_cost"),
  };
}

function replayObservedTools(toolSequence) {
  const tracker = createPolicyTracker();
  let admitted = 0;
  for (const toolName of toolSequence) {
    const termination = tracker.reserveToolCall(toolName);
    if (termination) return { admitted, termination };
    admitted += 1;
  }
  return { admitted, termination: null };
}

function replayOrdinaryProfile(toolSequence) {
  const tracker = new ReActRunBudgetTracker({ maxTotalTokens: 24_000, maxHighRiskToolCalls: 4 });
  let modelReservationsAdmitted = 0;
  for (let index = 0; index < 6; index++) {
    if (!tracker.reserveModelCall({ minimumInputTokens: 1_500 })) modelReservationsAdmitted += 1;
  }
  const allObservedToolsAdmitted = toolSequence.every((toolName) => !tracker.reserveToolCall(toolName));
  return {
    policyEnabled: false,
    modelReservationsAttempted: 6,
    modelReservationsAdmitted,
    observedToolCallsAttempted: toolSequence.length,
    allObservedToolsAdmitted,
    outputReserveApplied: false,
    budgetBehavior: "post_usage_budget_semantics_preserved",
  };
}

function createPolicyTracker(overrides = {}) {
  return new ReActRunBudgetTracker({
    maxTotalTokens: 24_000,
    maxHighRiskToolCalls: 4,
    modelLoopBudgetPolicy: MODEL_LOOP_COST_CONTAINMENT_POLICY_ID,
    ...overrides,
  });
}

function requireTermination(value, budget, reasonCode) {
  if (!value || value.budget !== budget || value.policyId !== MODEL_LOOP_COST_CONTAINMENT_POLICY_ID
    || value.reasonCode !== reasonCode) {
    throw new Error(`Budget replay did not emit ${budget}/${reasonCode}.`);
  }
  return { ...value };
}

function countNavigationTools(sequence) {
  return {
    fileReadCalls: sequence.filter((name) => name === "file_read").length,
    textSearchCalls: sequence.filter((name) => name === "text_search").length,
  };
}

function requirePlatform(value) {
  if (!PLATFORMS.includes(value)) throw new Error("Platform must be windows-native or wsl2-linux.");
  return value;
}

function requireIsoTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) {
    throw new Error("generatedAt must be an ISO-8601 UTC timestamp.");
  }
  return value;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function requireText(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be non-empty text.`);
  return value;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function assertSame(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} drifted: expected ${expected}, received ${actual}.`);
}

async function assertDirectory(target, label) {
  const stats = await fs.stat(target).catch(() => undefined);
  if (!stats?.isDirectory()) throw new Error(`${label} must be an existing directory.`);
}

async function assertFile(target, label) {
  const stats = await fs.stat(target).catch(() => undefined);
  if (!stats?.isFile()) throw new Error(`${label} must be an existing file.`);
}

async function assertPathAbsent(target, label) {
  const exists = await fs.stat(target).then(() => true, () => false);
  if (exists) throw new Error(`${label} already exists: ${target}`);
}

function assertDisjointRoots(left, right, leftLabel, rightLabel) {
  const relative = path.relative(right, left);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error(`${leftLabel} must not be inside ${rightLabel}.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  runModelLoopBudgetTermination(parseModelLoopBudgetTerminationCliArguments(process.argv.slice(2)))
    .then((artifact) => {
      console.log(`[model-loop-budget-termination] ${artifact.platform} completed`);
    })
    .catch((error) => {
      console.error(`[model-loop-budget-termination] ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
