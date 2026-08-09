import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_V3_ANALYSIS_VERSION =
  "coding-agent-benchmark-navigation-shadow-v3-analysis/v1";

const TASK_ID = "real-js.bug-fix";
const PLATFORMS = ["windows-native", "wsl2-linux"];
const TARGET_PATH = "lib/request.js";
const REGRESSION_TEST_PATH = "test/benchmark-v3/real-js-bug-fix.js";
const TOOL_NAMES = new Set([
  "file_read", "list_files", "text_search", "file_glob", "file_edit", "apply_patch",
  "file_write", "file_delete",
]);
const EDIT_TOOLS = new Set(["file_edit", "apply_patch", "file_write", "file_delete"]);
const scriptPath = fileURLToPath(import.meta.url);

export function buildNavigationShadowV3Analysis(input) {
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  const v1Analysis = requireObject(input?.v1Analysis, "v1Analysis");
  const v1AnalysisText = requireText(input?.v1AnalysisText, "v1AnalysisText");
  const v2Analysis = requireObject(input?.v2Analysis, "v2Analysis");
  const v2AnalysisText = requireText(input?.v2AnalysisText, "v2AnalysisText");
  validateAnalysis(v1Analysis, "workspace-write-navigation-candidate-v1", "navigation-candidate-v2-required");
  validateAnalysis(v2Analysis, "workspace-write-navigation-candidate-v2", "navigation-candidate-v3-runtime-contract-required");
  const baseline = analyzeBaseline(input?.baselineEvents, input?.baselineEventsText, v1Analysis.baseline);
  const v1Platforms = indexPlatforms(v1Analysis.platforms, "v1Analysis.platforms");
  const v2Platforms = indexPlatforms(v2Analysis.platforms, "v2Analysis.platforms");
  if (JSON.stringify(v1Analysis.baseline) !== JSON.stringify(v2Analysis.baseline)) {
    throw new Error("Navigation shadow v3 baseline drifted between v1 and v2 analyses.");
  }
  const platformInputs = requireArray(input?.platformInputs, "platformInputs");
  if (platformInputs.length !== PLATFORMS.length) {
    throw new Error("Navigation shadow v3 analysis requires exactly two platform inputs.");
  }
  const platforms = platformInputs.map((item) => analyzePlatform({
    ...item,
    v1Platform: v1Platforms.get(item?.platform),
    v2Platform: v2Platforms.get(item?.platform),
    v1AnalysisSha256: sha256(v1AnalysisText),
    v2AnalysisSha256: sha256(v2AnalysisText),
    baseline,
  })).sort((left, right) => PLATFORMS.indexOf(left.platform) - PLATFORMS.indexOf(right.platform));
  if (platforms.map((item) => item.platform).join(",") !== PLATFORMS.join(",")) {
    throw new Error("Navigation shadow v3 analysis requires Windows native and WSL2 evidence.");
  }

  const [windows, wsl] = platforms;
  assertSame(windows.provider, wsl.provider, "Provider identity");
  assertSame(windows.modelId, wsl.modelId, "model identity");
  for (const field of ["manifestSha256", "baselineCommit", "repositorySnapshotIdentitySha256"]) {
    const label = field === "repositorySnapshotIdentitySha256"
      ? "repository snapshot identity"
      : `${field} identity`;
    assertSame(windows.source[field], wsl.source[field], label);
  }
  const sharedFailureSignature = platforms.every((platform) =>
    platform.candidates.every((candidate) => candidate.outcome.status === "failed"
      && candidate.outcome.failureCategory === "product_workflow"
      && candidate.execution.enteredEditPhase === false
      && candidate.execution.changedFileCount === 0
      && candidate.execution.budgetExhausted === true
      && candidate.evaluator.taskCompleted === false
      && candidate.evaluator.patchAccepted === false));
  if (!sharedFailureSignature) {
    throw new Error("Navigation shadow v3 analysis evidence does not support the shared failure decision.");
  }
  const runtimeContractsStable = platforms.every((platform) =>
    platform.v3RuntimeContract.compliant === true
    && platform.v3RuntimeContract.policyMetadataObserved === true);
  if (!runtimeContractsStable) {
    throw new Error("Navigation shadow v3 runtime contract is not stable across platforms.");
  }
  const allCandidatesFailedBeforeEdit = platforms.every((platform) =>
    platform.candidates.every((candidate) => candidate.execution.enteredEditPhase === false));
  const responseBytesReducedVsBaselineOnBothPlatforms = platforms.every((platform) =>
    platform.comparison.v3VsBaselineResponseBytesDelta < 0);
  const responseBytesReducedVsV2OnBothPlatforms = platforms.every((platform) =>
    platform.comparison.v3VsCandidateV2ResponseBytesDelta < 0);
  const v3TokenRegressionVsBaselineOnBothPlatforms = platforms.every((platform) =>
    platform.comparison.v3VsBaselineTotalTokenDelta > 0);
  const taskOutcomeImproved = platforms.some((platform) =>
    platform.v3.evaluator.taskCompleted || platform.v3.evaluator.patchAccepted);
  const responseBytesSpread = Math.abs(
    windows.v3.modelVisibleResponseBytes - wsl.v3.modelVisibleResponseBytes,
  );
  const totalObservedCostCny = round(
    sum([
      requireNonNegativeNumber(v1Analysis.crossPlatform?.totalObservedCostCny, "v1 total cost"),
      requireNonNegativeNumber(v2Analysis.crossPlatform?.totalObservedCostCny, "v2 total cost"),
      windows.v3.usage.costCny,
      wsl.v3.usage.costCny,
    ]),
  );

  return {
    schemaVersion: CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_V3_ANALYSIS_VERSION,
    generatedAt,
    status: "completed",
    taskId: TASK_ID,
    candidateId: "workspace-write-navigation-candidate-v3",
    model: { provider: windows.provider, id: windows.modelId },
    decision: {
      status: "do_not_promote",
      reasonCodes: [
        "runtime_contract_stable_without_task_uplift",
        "response_surface_reduced_without_token_uplift",
        "shared_budget_exhaustion_before_edit",
        "machine_evaluator_failed",
        "navigation_candidate_line_stopped",
      ],
      candidateLineStatus: "stopped",
      technicalDebtDecision: "split_task",
      nextAction: "separate-model-loop-budget-and-termination-contract",
      nextActionMode: "offline",
      providerExpansionAllowed: false,
      requiresNewProviderAuthorizationForAnyFutureCanary: true,
    },
    execution: {
      mode: "offline-analysis",
      modelCalls: 0,
      providerCostUsd: 0,
      networkCalls: 0,
      hostCommandToolCalls: 0,
      manifestModified: false,
      v3AggregateModified: false,
    },
    baseline,
    offlineCandidate: {
      toolCallCount: windows.offlineCandidate.toolCallCount,
      modelVisibleResponseBytes: windows.offlineCandidate.modelVisibleResponseBytes,
      tokenImpactStatus: "not_measured",
    },
    platforms: platforms.map(stripInternalFields),
    crossPlatform: {
      sameManifestSha256: true,
      sameBaselineCommit: true,
      sameRepositorySnapshotIdentity: true,
      providerModelMatched: true,
      sharedFailureSignature,
      allCandidatesFailedBeforeEdit,
      providerUsageComplete: platforms.every((platform) =>
        platform.candidates.every((candidate) => candidate.usage.complete)),
      preflightsPassed: platforms.every((platform) =>
        platform.candidates.every((candidate) => candidate.execution.preflightsPassed)),
      runtimeContractStable: runtimeContractsStable,
      v3TokenRegressionVsBaselineOnBothPlatforms,
      totalObservedCostCny,
    },
    runtimeGuardBenefit: {
      globArgumentContractStable: runtimeContractsStable,
      responseBytesReducedVsBaselineOnBothPlatforms,
      responseBytesReducedVsV2OnBothPlatforms,
      v3ResponseBytesSpread: responseBytesSpread,
      taskOutcomeImproved,
      tokenUpliftObserved: !v3TokenRegressionVsBaselineOnBothPlatforms,
      boundary: [
        "does_not_bound_cumulative_model_call_count",
        "does_not_bound_repeated_file_read_or_search_loop",
        "does_not_force_edit_or_termination_transition_before_budget_exhaustion",
      ],
    },
    attribution: {
      primary: "tool_argument_guard_reduces_response_surface_but_not_model_loop_budget",
      contributors: [
        "cumulative_context_replay_across_model_calls",
        "read_and_search_loop_continues_after_localization",
        "no_edit_or_termination_transition_before_total_token_limit",
        "windows_repeated_file_read_is_platform_specific_not_shared_root_cause",
      ],
      excluded: [
        "gateway_infrastructure",
        "workspace_identity_drift",
        "provider_usage_incomplete",
        "runtime_tool_argument_contract",
        "evaluator_infrastructure",
        "host_command_execution",
      ],
    },
    source: {
      v1AnalysisSha256: sha256(v1AnalysisText),
      v2AnalysisSha256: sha256(v2AnalysisText),
      baselineEventsSha256: input.baselineEventsText ? sha256(input.baselineEventsText) : null,
      platforms: platforms.map((platform) => ({
        platform: platform.platform,
        v1ShadowArtifactSha256: platform.source.v1ShadowArtifactSha256,
        v2ShadowArtifactSha256: platform.source.v2ShadowArtifactSha256,
        v3CandidateEvidenceSha256: platform.source.v3CandidateEvidenceSha256,
        v3ShadowArtifactSha256: platform.source.v3ShadowArtifactSha256,
        v3EventsSha256: platform.source.v3EventsSha256,
      })),
    },
    diagnostics: [],
  };
}

function analyzeBaseline(events, eventsText, expected) {
  const baseline = requireObject(expected, "baseline analysis");
  const calls = summarizeRawCalls(requireArray(events, "baseline events"));
  const usage = requireUsage(events, "baseline");
  const budget = requireBudget(events, "baseline");
  if (usage.input + usage.output !== expected.totalTokens
    || usage.input !== expected.inputTokens
    || usage.output !== expected.outputTokens
    || usage.modelCalls !== expected.modelCalls
    || budget.observed !== expected.totalTokens
    || calls.length !== expected.toolCallCount
    || sum(calls.filter((call) => call.success).map((call) => call.responseBytes))
      !== expected.modelVisibleResponseBytes
    || budget.limit !== 24_000
    || expected.changedFileCount !== 0
    || expected.budgetExhausted !== true) {
    throw new Error("Navigation shadow v3 baseline metrics drifted.");
  }
  assertNoHostCommands(calls, "baseline");
  if (usage.source !== "provider_reported" || usage.completeness?.status !== "complete") {
    throw new Error("Navigation shadow v3 baseline provider usage is incomplete.");
  }
  return {
    runId: requireString(expected.runId, "baseline.runId"),
    inputTokens: expected.inputTokens,
    outputTokens: expected.outputTokens,
    totalTokens: expected.totalTokens,
    modelCalls: expected.modelCalls,
    toolCallCount: expected.toolCallCount,
    changedFileCount: 0,
    budgetExhausted: true,
    modelVisibleResponseBytes: expected.modelVisibleResponseBytes,
    toolSequence: calls.map((call) => call.name),
    eventsSha256: sha256(requireText(eventsText, "baseline events text")),
  };
}

function analyzePlatform(input) {
  const platform = requirePlatform(input?.platform);
  const v1Platform = requireObject(input?.v1Platform, `${platform} v1 analysis`);
  const v2Platform = requireObject(input?.v2Platform, `${platform} v2 analysis`);
  const v1 = validateHistoricalCandidate({
    platform,
    version: 1,
    artifact: input.v1Shadow,
    artifactText: input.v1ShadowText,
    events: input.v1Events,
    eventsText: input.v1EventsText,
    analysisPlatform: v1Platform,
    analysisSha256: input.v1AnalysisSha256,
    preflight: input.v1Preflight,
    repositoryPreflight: input.v1RepositoryPreflight,
  });
  const v2 = validateHistoricalCandidate({
    platform,
    version: 2,
    artifact: input.v2Shadow,
    artifactText: input.v2ShadowText,
    events: input.v2Events,
    eventsText: input.v2EventsText,
    analysisPlatform: v2Platform,
    analysisSha256: input.v2AnalysisSha256,
    preflight: input.v2Preflight,
    repositoryPreflight: input.v2RepositoryPreflight,
  });
  const candidate = requireObject(input.v3Candidate, `${platform} v3 candidate evidence`);
  const candidateText = requireText(input.v3CandidateText, `${platform} v3 candidate evidence text`);
  const shadow = requireObject(input.v3Shadow, `${platform} v3 shadow artifact`);
  const shadowText = requireText(input.v3ShadowText, `${platform} v3 shadow artifact text`);
  const events = requireArray(input.v3Events, `${platform} v3 events`);
  const eventsText = requireText(input.v3EventsText, `${platform} v3 events text`);
  validateCandidateV3(platform, candidate, candidateText, input.v2AnalysisSha256, v2);
  validateShadowV3(platform, shadow, shadowText, candidateText, input.v2AnalysisSha256, v2, events, eventsText);
  validatePreflights(platform, shadow.outcome.runId, input.v3Preflight, input.v3RepositoryPreflight);
  const calls = summarizeRawCalls(events);
  assertNoHostCommands(calls, platform);
  const usage = requireUsage(events, platform);
  const budget = requireBudget(events, platform);
  const runtimeContract = analyzeRuntimeContract(calls);
  compareRuntimeContract(shadow.runtimeContract, runtimeContract, platform);
  const v3 = summarizeCandidate(shadow, calls, usage, budget, runtimeContract);
  const offlineCandidate = {
    toolCallCount: requireNonNegativeInteger(candidate.replay?.toolCallCount, `${platform} replay tool count`),
    modelVisibleResponseBytes: requireNonNegativeInteger(
      candidate.replay?.modelVisibleResponseBytes,
      `${platform} replay response bytes`,
    ),
  };
  return {
    platform,
    provider: requireString(shadow.authorization?.provider, `${platform} provider`),
    modelId: requireString(shadow.authorization?.modelId, `${platform} model`),
    v1,
    v2,
    v3,
    candidates: [v1, v2, v3],
    offlineCandidate,
    v3RuntimeContract: runtimeContract,
    comparison: {
      v3VsBaselineTotalTokenDelta: v3.usage.totalTokens - input.baseline.totalTokens,
      v3VsCandidateV1TotalTokenDelta: v3.usage.totalTokens - v1.usage.totalTokens,
      v3VsCandidateV2TotalTokenDelta: v3.usage.totalTokens - v2.usage.totalTokens,
      v3VsBaselineResponseBytesDelta: v3.modelVisibleResponseBytes - input.baseline.modelVisibleResponseBytes,
      v3VsCandidateV1ResponseBytesDelta: v3.modelVisibleResponseBytes - v1.modelVisibleResponseBytes,
      v3VsCandidateV2ResponseBytesDelta: v3.modelVisibleResponseBytes - v2.modelVisibleResponseBytes,
    },
    source: {
      manifestSha256: v3.source.manifestSha256,
      baselineCommit: v3.source.baselineCommit,
      repositorySnapshotIdentitySha256: v3.source.repositorySnapshotIdentitySha256,
      v1ShadowArtifactSha256: v1.source.shadowArtifactSha256,
      v2ShadowArtifactSha256: v2.source.shadowArtifactSha256,
      v3CandidateEvidenceSha256: sha256(candidateText),
      v3ShadowArtifactSha256: sha256(shadowText),
      v3EventsSha256: sha256(eventsText),
    },
  };
}

function validateAnalysis(analysis, candidateId, nextCandidate) {
  if (analysis.schemaVersion !== (candidateId.endsWith("v1")
    ? "coding-agent-benchmark-navigation-shadow-analysis/v1"
    : "coding-agent-benchmark-navigation-shadow-v2-analysis/v1")
    || analysis.status !== "completed"
    || analysis.taskId !== TASK_ID
    || analysis.candidateId !== candidateId
    || analysis.model?.provider !== "deepseek"
    || analysis.model?.id !== "deepseek-v4-flash"
    || analysis.decision?.status !== "do_not_promote"
    || analysis.decision?.nextCandidate !== nextCandidate) {
    throw new Error(`${candidateId} analysis is not complete or drifted.`);
  }
}

function validateCandidateV3(platform, candidate, candidateText, v2AnalysisSha256, v2) {
  if (candidate.schemaVersion !== "coding-agent-benchmark-navigation-candidate-v3/v1"
    || candidate.status !== "eligible_for_shadow_readiness"
    || candidate.platform !== platform
    || candidate.taskId !== TASK_ID
    || candidate.candidate?.id !== "workspace-write-navigation-candidate-v3"
    || candidate.candidate?.strategy?.id !== "bounded-navigation-runtime-contract/v1"
    || candidate.candidate?.strategy?.enforcement !== "runtime_contract"
    || candidate.candidate?.strategy?.runtimeToolGuard !== true
    || candidate.candidate?.toolArgumentPolicy !== "bounded-navigation-v1"
    || candidate.execution?.modelCalls !== 0
    || candidate.execution?.networkCalls !== 0
    || candidate.execution?.hostCommandToolCalls !== 0
    || candidate.source?.analysisSha256 !== v2AnalysisSha256
    || candidate.source?.shadowV2ArtifactSha256 !== v2.source.shadowArtifactSha256
    || candidate.comparison?.tokenImpact?.status !== "not_measured") {
    throw new Error(`${platform} candidate v3 evidence is not analysis-safe.`);
  }
  if (candidate.replay?.sequence?.join(",") !== "file_glob,file_glob,file_read,text_search") {
    throw new Error(`${platform} candidate v3 replay sequence drifted.`);
  }
  requireSha256(sha256(candidateText), `${platform} candidate v3 evidence hash`);
}

function validateShadowV3(platform, shadow, shadowText, candidateText, v2AnalysisSha256, v2, events, eventsText) {
  if (shadow.schemaVersion !== "coding-agent-benchmark-navigation-shadow-real-v3/v1"
    || shadow.status !== "completed"
    || shadow.taskId !== TASK_ID
    || shadow.platform !== platform
    || shadow.candidate?.id !== "workspace-write-navigation-candidate-v3"
    || shadow.candidate?.manifestModified !== false
    || shadow.execution?.v3AggregateEligible !== false
    || shadow.execution?.hostCommandToolCalls !== 0
    || shadow.execution?.budgetExhausted !== true
    || shadow.source?.candidateEvidenceSha256 !== sha256(candidateText)
    || shadow.source?.analysisSha256 !== v2AnalysisSha256
    || shadow.source?.previousShadowArtifactSha256 !== v2.source.shadowArtifactSha256
    || shadow.source?.previousCandidateEvidenceSha256 !== v2.source.candidateEvidenceSha256
    || shadow.artifacts?.events?.sha256 !== sha256(eventsText)) {
    throw new Error(`${platform} shadow v3 source or execution binding drifted.`);
  }
  if (sha256(shadowText).length !== 64) throw new Error(`${platform} shadow v3 artifact hash invalid.`);
  validatePreflights(platform, shadow.outcome?.runId, null, null);
  if (events.some((event) => event?.type === "tool.started"
    && event?.payload?.tool?.name === "run_command")) {
    throw new Error(`${platform} shadow v3 evidence contains run_command.`);
  }
}

function validateHistoricalCandidate(input) {
  const { platform, version, artifact, artifactText, events, eventsText, analysisPlatform } = input;
  const expectedSchema = version === 1
    ? "coding-agent-benchmark-navigation-shadow-real/v1"
    : "coding-agent-benchmark-navigation-shadow-real-v2/v1";
  const expectedId = `workspace-write-navigation-candidate-v${version}`;
  if (artifact.schemaVersion !== expectedSchema
    || artifact.status !== "completed"
    || artifact.taskId !== TASK_ID
    || artifact.platform !== platform
    || artifact.candidate?.id !== expectedId
    || artifact.execution?.v3AggregateEligible !== false
    || artifact.execution?.hostCommandToolCalls !== 0
    || artifact.execution?.enteredEditPhase !== false
    || artifact.execution?.budgetExhausted !== true
    || artifact.source?.manifestSha256 !== analysisPlatform.source.manifestSha256
    || artifact.source?.baselineCommit !== analysisPlatform.source.baselineCommit
    || artifact.source?.repositorySnapshotIdentitySha256
      !== analysisPlatform.source.repositorySnapshotIdentitySha256
    || artifact.artifacts?.events?.sha256 !== sha256(eventsText)
    || analysisPlatform.source.shadowArtifactSha256 !== sha256(artifactText)
    || analysisPlatform.source.eventsSha256 !== sha256(eventsText)) {
    throw new Error(`${platform} candidate v${version} source binding drifted.`);
  }
  validatePreflights(platform, artifact.outcome?.runId, input.preflight, input.repositoryPreflight);
  const calls = summarizeRawCalls(events);
  assertNoHostCommands(calls, `${platform} candidate v${version}`);
  const usage = requireUsage(events, `${platform} candidate v${version}`);
  const budget = requireBudget(events, `${platform} candidate v${version}`);
  const responseBytes = sum(calls.filter((call) => call.success).map((call) => call.responseBytes));
  if (artifact.outcome?.inputTokens !== usage.input
    || artifact.outcome?.outputTokens !== usage.output
    || artifact.outcome?.totalTokens !== usage.input + usage.output
    || artifact.execution?.modelCalls !== usage.modelCalls
    || artifact.execution?.toolCallCount !== calls.length
    || artifact.outcome?.costUsd !== usage.costUsd
    || budget.observed !== usage.input + usage.output
    || analysisPlatform.usage?.totalTokens !== usage.input + usage.output
    || analysisPlatform.usage?.modelCalls !== usage.modelCalls
    || analysisPlatform.tools?.callCount !== calls.length
    || analysisPlatform.tools?.modelVisibleResponseBytes !== responseBytes
    || JSON.stringify(analysisPlatform.tools?.sequence) !== JSON.stringify(calls.map((call) => call.name))) {
    throw new Error(`${platform} candidate v${version} metrics drifted from raw events.`);
  }
  const evaluator = normalizeEvaluator(artifact.outcome?.evaluation, `${platform} candidate v${version}`);
  return {
    candidateId: expectedId,
    runId: requireString(artifact.outcome?.runId, `${platform} candidate v${version} runId`),
    provider: requireString(artifact.authorization?.provider, `${platform} provider`),
    modelId: requireString(artifact.authorization?.modelId, `${platform} model`),
    enforcement: version === 1 ? "prompt_only" : "prompt_contract",
    runtimeToolGuard: false,
    usage: {
      source: usage.source,
      complete: usage.source === "provider_reported" && usage.completeness?.status === "complete",
      inputTokens: usage.input,
      outputTokens: usage.output,
      totalTokens: usage.input + usage.output,
      modelCalls: usage.modelCalls,
      costUsd: usage.costUsd,
      costCny: requireNonNegativeNumber(artifact.authorization?.runCostCny, `${platform} costCny`),
    },
    budget: { kind: budget.budget, limit: budget.limit, observed: budget.observed },
    tools: {
      callCount: calls.length,
      successfulCount: calls.filter((call) => call.success).length,
      failedCount: calls.filter((call) => !call.success).length,
      sequence: calls.map((call) => call.name),
      modelVisibleResponseBytes: responseBytes,
      editCallCount: calls.filter((call) => EDIT_TOOLS.has(call.name)).length,
    },
    modelVisibleResponseBytes: responseBytes,
    totalTokens: usage.input + usage.output,
    modelCalls: usage.modelCalls,
    outcome: {
      status: artifact.outcome.status,
      failureCategory: artifact.outcome.failureCategory,
    },
    execution: {
      enteredEditPhase: artifact.execution.enteredEditPhase,
      budgetExhausted: artifact.execution.budgetExhausted,
      changedFileCount: artifact.outcome.changedPaths?.length ?? 0,
      preflightsPassed: true,
    },
    evaluator,
    source: {
      shadowArtifactSha256: sha256(artifactText),
      candidateEvidenceSha256: analysisPlatform.source.candidateEvidenceSha256 ?? null,
      eventsSha256: sha256(eventsText),
      manifestSha256: artifact.source.manifestSha256,
      baselineCommit: artifact.source.baselineCommit,
      repositorySnapshotIdentitySha256: artifact.source.repositorySnapshotIdentitySha256,
    },
  };
}

function summarizeCandidate(shadow, calls, usage, budget, runtimeContract) {
  const evaluator = normalizeEvaluator(shadow.outcome?.evaluation, `${shadow.platform} v3 evaluator`);
  return {
    candidateId: "workspace-write-navigation-candidate-v3",
    runId: shadow.outcome.runId,
    provider: shadow.authorization.provider,
    modelId: shadow.authorization.modelId,
    enforcement: "runtime_contract",
    runtimeToolGuard: true,
    usage: {
      source: usage.source,
      complete: usage.source === "provider_reported" && usage.completeness?.status === "complete",
      inputTokens: usage.input,
      outputTokens: usage.output,
      totalTokens: usage.input + usage.output,
      modelCalls: usage.modelCalls,
      costUsd: usage.costUsd,
      costCny: shadow.authorization.runCostCny,
    },
    budget: { kind: budget.budget, limit: budget.limit, observed: budget.observed },
    tools: {
      callCount: calls.length,
      successfulCount: calls.filter((call) => call.success).length,
      failedCount: calls.filter((call) => !call.success).length,
      sequence: calls.map((call) => call.name),
      modelVisibleResponseBytes: sum(calls.filter((call) => call.success).map((call) => call.responseBytes)),
      editCallCount: calls.filter((call) => EDIT_TOOLS.has(call.name)).length,
    },
    modelVisibleResponseBytes: sum(calls.filter((call) => call.success).map((call) => call.responseBytes)),
    totalTokens: usage.input + usage.output,
    modelCalls: usage.modelCalls,
    outcome: { status: shadow.outcome.status, failureCategory: shadow.outcome.failureCategory },
    execution: {
      enteredEditPhase: shadow.execution.enteredEditPhase,
      budgetExhausted: shadow.execution.budgetExhausted,
      changedFileCount: shadow.outcome.changedPaths?.length ?? 0,
      preflightsPassed: true,
    },
    evaluator,
    source: {
      manifestSha256: shadow.source.manifestSha256,
      baselineCommit: shadow.source.baselineCommit,
      repositorySnapshotIdentitySha256: shadow.source.repositorySnapshotIdentitySha256,
      runtimeContract: runtimeContract,
    },
  };
}

function analyzeRuntimeContract(calls) {
  const normalized = calls.map((call) => ({ name: call.name, arguments: call.arguments ?? {}, id: call.id }));
  const globIndexes = new Map();
  normalized.forEach((call, index) => {
    if (call.name !== "file_glob") return;
    const includes = Array.isArray(call.arguments.include) ? call.arguments.include : [call.arguments.include];
    for (const include of includes) {
      if ([REGRESSION_TEST_PATH, "lib/**/*.js"].includes(include)) globIndexes.set(include, index);
    }
  });
  const regressionReadIndex = normalized.findIndex((call) => call.name === "file_read"
    && normalizePath(call.arguments.path) === REGRESSION_TEST_PATH);
  const boundedSearchIndex = normalized.findIndex((call) => call.name === "text_search"
    && normalizePath(call.arguments.path) === "lib"
    && call.arguments.glob === "**/*.js"
    && Number(call.arguments.maxResults) === 4
    && Number(call.arguments.contextLines) === 5);
  const implementationReadIndexes = normalized.map((call, index) => ({ call, index }))
    .filter(({ call }) => call.name === "file_read" && normalizePath(call.arguments.path).startsWith("lib/"))
    .map(({ index }) => index);
  const firstImplementationReadIndex = implementationReadIndexes[0] ?? -1;
  const latestRequiredGlobIndex = Math.max(globIndexes.get(REGRESSION_TEST_PATH) ?? -1, globIndexes.get("lib/**/*.js") ?? -1);
  const fileGlobBeforeSourceRead = globIndexes.size === 2 && latestRequiredGlobIndex < regressionReadIndex;
  const firstSourceInspectionIndex = [boundedSearchIndex, firstImplementationReadIndex]
    .filter((index) => index >= 0).sort((left, right) => left - right)[0] ?? -1;
  const regressionTestReadBeforeSourceInspection = regressionReadIndex >= 0
    && firstSourceInspectionIndex >= 0 && regressionReadIndex < firstSourceInspectionIndex;
  const fullTargetReadBeforeLocalization = normalized.some((call, index) => call.name === "file_read"
    && normalizePath(call.arguments.path) === TARGET_PATH && (boundedSearchIndex < 0 || index < boundedSearchIndex));
  const fileReadCounts = new Map();
  for (const call of normalized) {
    if (call.name !== "file_read") continue;
    const readPath = normalizePath(call.arguments.path);
    if (readPath) fileReadCounts.set(readPath, (fileReadCounts.get(readPath) ?? 0) + 1);
  }
  const repeatedCompleteFileReadCount = [...fileReadCounts.values()]
    .reduce((total, count) => total + Math.max(0, count - 1), 0);
  const globCalls = calls.filter((call) => call.name === "file_glob");
  const invalidGlobCalls = globCalls.filter((call) => {
    const include = call.arguments?.include;
    return typeof include !== "string" || !include.trim() || ["*", "**", "**/*"].includes(String(include).trim());
  });
  const policyMetadataObserved = globCalls.length > 0 && globCalls.every((call) =>
    call.metadata?.argumentValidation?.toolArgumentPolicy === "bounded-navigation-v1");
  const invalidGlobCallsBlocked = invalidGlobCalls.every((call) => call.success === false
    && call.metadata?.argumentValidation?.blocked === true);
  const cappedGlobCallCount = globCalls.filter((call) => {
    const maxResults = Number(call.arguments?.maxResults);
    const needsCap = call.arguments?.maxResults === undefined || !Number.isInteger(maxResults) || maxResults > 20;
    return needsCap && call.success === true && call.metadata?.argumentValidation?.corrected === true;
  }).length;
  const navigationSequenceCompliant = fileGlobBeforeSourceRead
    && regressionTestReadBeforeSourceInspection
    && boundedSearchIndex >= 0
    && !fullTargetReadBeforeLocalization
    && repeatedCompleteFileReadCount === 0;
  return {
    strategyId: "bounded-navigation-runtime-contract/v1",
    enforcement: "runtime_contract",
    runtimeToolGuard: true,
    promptHashMatched: true,
    toolArgumentPolicy: "bounded-navigation-v1",
    compliant: policyMetadataObserved && invalidGlobCallsBlocked
      && !invalidGlobCalls.some((call) => call.success === true),
    policyMetadataObserved,
    invalidGlobCallsBlocked,
    invalidGlobCallCount: invalidGlobCalls.length,
    blockedGlobCallCount: invalidGlobCalls.filter((call) => !call.success).length,
    cappedGlobCallCount,
    navigationSequenceCompliant,
    fileGlobBeforeSourceRead,
    regressionTestReadBeforeSourceInspection,
    boundedTextSearchObserved: boundedSearchIndex >= 0,
    fullTargetReadBeforeLocalization,
    repeatedCompleteFileReadCount,
    toolSequence: normalized.map((call) => call.name),
  };
}

function compareRuntimeContract(expected, actual, platform) {
  for (const field of [
    "strategyId", "enforcement", "runtimeToolGuard", "promptHashMatched", "toolArgumentPolicy",
    "compliant", "policyMetadataObserved", "invalidGlobCallsBlocked", "invalidGlobCallCount",
    "blockedGlobCallCount", "cappedGlobCallCount", "navigationSequenceCompliant",
    "fileGlobBeforeSourceRead", "regressionTestReadBeforeSourceInspection",
    "boundedTextSearchObserved", "fullTargetReadBeforeLocalization", "repeatedCompleteFileReadCount",
  ]) {
    if (expected?.[field] !== actual[field]) throw new Error(`${platform} runtime contract drifted.`);
  }
  if (JSON.stringify(expected?.toolSequence) !== JSON.stringify(actual.toolSequence)) {
    throw new Error(`${platform} runtime contract tool sequence drifted.`);
  }
}

function validatePreflights(platform, runId, preflight, repositoryPreflight) {
  if (preflight && (preflight.schemaVersion !== "coding-agent-benchmark-preflight/v1"
    || preflight.manifestRevision !== "v3"
    || preflight.taskId !== TASK_ID
    || preflight.runId !== runId
    || preflight.status !== "passed"
    || preflight.checks?.contractSource?.status !== "passed"
    || preflight.checks?.executionBudget?.status !== "passed"
    || preflight.checks?.executionBudget?.maxTokens !== 24_000)) {
    throw new Error(`${platform} runtime preflight did not pass.`);
  }
  if (repositoryPreflight && (repositoryPreflight.schemaVersion !== "coding-agent-benchmark-snapshot-preflight/v1"
    || repositoryPreflight.taskId !== TASK_ID
    || repositoryPreflight.repositoryId !== "express"
    || repositoryPreflight.status !== "passed"
    || ["manifestBinding", "sourceIdentity", "license", "dependencyCache", "executionNetwork"]
      .some((name) => repositoryPreflight.checks?.[name]?.status !== "passed"))) {
    throw new Error(`${platform} repository snapshot preflight did not pass.`);
  }
}

function summarizeRawCalls(events) {
  const starts = new Map();
  const calls = [];
  for (const event of requireArray(events, "events")) {
    if (event?.type === "tool.started") {
      const tool = requireObject(event.payload?.tool, "tool.started payload");
      if (starts.has(tool.id)) throw new Error("Duplicate tool.started id.");
      starts.set(requireString(tool.id, "tool id"), tool);
    } else if (event?.type === "tool.completed") {
      const tool = requireObject(event.payload?.tool, "tool.completed payload");
      const started = starts.get(tool.id);
      if (!started) throw new Error("tool.completed has no matching tool.started.");
      calls.push({
        id: tool.id,
        name: requireString(tool.name, "tool name"),
        arguments: started.arguments ?? {},
        success: tool.success === true,
        responseBytes: Buffer.byteLength(typeof tool.output === "string" ? tool.output : "", "utf8"),
        error: typeof tool.error === "string" ? tool.error : "",
        failureKind: typeof tool.failureKind === "string" ? tool.failureKind : null,
        metadata: tool.metadata ?? null,
      });
    }
  }
  if (calls.some((call) => !TOOL_NAMES.has(call.name))) {
    throw new Error("Navigation shadow v3 evidence contains an unknown tool.");
  }
  return calls;
}

function requireUsage(events, platform) {
  const usageEvent = requireArray(events, `${platform} events`).filter((event) => event?.type === "run.usage").at(-1);
  const usage = requireObject(usageEvent?.payload?.usage, `${platform} provider usage`);
  if (usage.source !== "provider_reported"
    || usage.completeness?.status !== "complete"
    || usage.providerReportedModelCalls !== usage.modelCalls
    || !Number.isFinite(usage.costUsd)) {
    throw new Error(`${platform} provider usage is incomplete.`);
  }
  return usage;
}

function requireBudget(events, platform) {
  const event = requireArray(events, `${platform} events`).filter((item) => item?.type === "run.budget_exhausted").at(-1);
  const budget = requireObject(event?.payload?.budget, `${platform} budget`);
  if (budget.budget !== "total_tokens" || budget.limit !== 24_000 || budget.observed <= budget.limit) {
    throw new Error(`${platform} budget evidence is not exhausted at the v3 limit.`);
  }
  return budget;
}

function assertNoHostCommands(calls, platform) {
  if (calls.some((call) => call.name === "run_command")) {
    throw new Error(`${platform} evidence contains run_command.`);
  }
}

function normalizeEvaluator(value, label) {
  const evaluator = requireObject(value, label);
  if (evaluator.source !== "machine" || evaluator.taskCompleted !== false
    || evaluator.testsPassed !== false || evaluator.patchAccepted !== false
    || !Number.isInteger(evaluator.regressionCount) || evaluator.regressionCount < 1
    || !Number.isInteger(evaluator.manualInterventionCount) || evaluator.manualInterventionCount !== 0) {
    throw new Error(`${label} does not support the shared evaluator failure.`);
  }
  return {
    source: evaluator.source,
    taskCompleted: evaluator.taskCompleted,
    testsPassed: evaluator.testsPassed,
    patchAccepted: evaluator.patchAccepted,
    regressionCount: evaluator.regressionCount,
    manualInterventionCount: evaluator.manualInterventionCount,
  };
}

function stripInternalFields(platform) {
  const { provider, modelId, v1, v2, v3, candidates, ...publicFields } = platform;
  return {
    ...publicFields,
    candidates: [v1, v2, v3].map(({ provider: ignoredProvider, modelId: ignoredModel, source, ...item }) => item),
  };
}

function indexPlatforms(value, label) {
  const platforms = requireArray(value, label);
  if (platforms.length !== 2) throw new Error(`${label} must contain both platforms.`);
  return new Map(platforms.map((item) => [requirePlatform(item?.platform), item]));
}

function requirePlatform(value) {
  if (!PLATFORMS.includes(value)) throw new Error("Navigation shadow v3 platform is invalid.");
  return value;
}

function normalizePath(value) {
  return typeof value === "string" ? value.replaceAll("\\", "/").replace(/^\.\//u, "") : "";
}

export async function runNavigationShadowV3Analysis(input) {
  const roots = Object.fromEntries([
    ["baselineRunRoot", input?.baselineRunRoot],
    ["v1AnalysisRoot", input?.v1AnalysisRoot],
    ["v1ShadowRoot", input?.v1ShadowRoot],
    ["v2AnalysisRoot", input?.v2AnalysisRoot],
    ["v2ShadowRoot", input?.v2ShadowRoot],
    ["v3CandidateRoot", input?.v3CandidateRoot],
    ["v3ShadowRoot", input?.v3ShadowRoot],
    ["outputRoot", input?.outputRoot],
  ].map(([name, value]) => [name, path.resolve(requireString(value, name))]));
  for (const [name, target] of Object.entries(roots)) {
    if (name === "outputRoot") continue;
    await assertDirectory(target, name);
    assertDisjointRoots(roots.outputRoot, target, "outputRoot", name);
  }
  await assertPathAbsent(roots.outputRoot, "output root");
  const [v1AnalysisText, v2AnalysisText, baselineEventsText] = await Promise.all([
    fs.readFile(path.join(roots.v1AnalysisRoot, "navigation-shadow-analysis.json"), "utf8"),
    fs.readFile(path.join(roots.v2AnalysisRoot, "navigation-shadow-v2-analysis.json"), "utf8"),
    fs.readFile(path.join(roots.baselineRunRoot, "events.jsonl"), "utf8"),
  ]);
  const platformInputs = await Promise.all(PLATFORMS.map((platform) => loadPlatformInput({
    platform,
    v1ShadowRoot: path.join(roots.v1ShadowRoot, platform),
    v2ShadowRoot: path.join(roots.v2ShadowRoot, platform),
    v3CandidateRoot: path.join(roots.v3CandidateRoot, platform),
    v3ShadowRoot: path.join(roots.v3ShadowRoot, platform),
  })));
  const artifact = buildNavigationShadowV3Analysis({
    generatedAt: input?.generatedAt,
    v1Analysis: JSON.parse(v1AnalysisText),
    v1AnalysisText,
    v2Analysis: JSON.parse(v2AnalysisText),
    v2AnalysisText,
    baselineEvents: parseJsonLines(baselineEventsText),
    baselineEventsText,
    platformInputs,
  });
  await writeNavigationShadowV3AnalysisArtifact(roots.outputRoot, artifact);
  return artifact;
}

async function loadPlatformInput(input) {
  const [v1ShadowText, v2ShadowText, v3CandidateText, v3ShadowText] = await Promise.all([
    fs.readFile(path.join(input.v1ShadowRoot, "navigation-shadow-real.json"), "utf8"),
    fs.readFile(path.join(input.v2ShadowRoot, "navigation-shadow-real-v2.json"), "utf8"),
    fs.readFile(path.join(input.v3CandidateRoot, "navigation-candidate-v3.json"), "utf8"),
    fs.readFile(path.join(input.v3ShadowRoot, "navigation-shadow-real-v3.json"), "utf8"),
  ]);
  const v1Shadow = JSON.parse(v1ShadowText);
  const v2Shadow = JSON.parse(v2ShadowText);
  const v3Shadow = JSON.parse(v3ShadowText);
  const [v1EventsText, v2EventsText, v3EventsText, v1PreflightText, v2PreflightText, v3PreflightText,
    v1RepositoryPreflightText, v2RepositoryPreflightText, v3RepositoryPreflightText] = await Promise.all([
    readArtifactRef(input.v1ShadowRoot, v1Shadow.artifacts?.events, "v1 events"),
    readArtifactRef(input.v2ShadowRoot, v2Shadow.artifacts?.events, "v2 events"),
    readArtifactRef(input.v3ShadowRoot, v3Shadow.artifacts?.events, "v3 events"),
    readArtifactRef(input.v1ShadowRoot, v1Shadow.artifacts?.preflight, "v1 preflight"),
    readArtifactRef(input.v2ShadowRoot, v2Shadow.artifacts?.preflight, "v2 preflight"),
    readArtifactRef(input.v3ShadowRoot, v3Shadow.artifacts?.preflight, "v3 preflight"),
    readArtifactRef(input.v1ShadowRoot, v1Shadow.artifacts?.repositorySnapshotPreflight, "v1 repository preflight"),
    readArtifactRef(input.v2ShadowRoot, v2Shadow.artifacts?.repositorySnapshotPreflight, "v2 repository preflight"),
    readArtifactRef(input.v3ShadowRoot, v3Shadow.artifacts?.repositorySnapshotPreflight, "v3 repository preflight"),
  ]);
  return {
    platform: input.platform,
    v1Shadow, v1ShadowText, v1Events: parseJsonLines(v1EventsText), v1EventsText,
    v1Preflight: JSON.parse(v1PreflightText),
    v1RepositoryPreflight: JSON.parse(v1RepositoryPreflightText),
    v2Shadow, v2ShadowText, v2Events: parseJsonLines(v2EventsText), v2EventsText,
    v2Preflight: JSON.parse(v2PreflightText),
    v2RepositoryPreflight: JSON.parse(v2RepositoryPreflightText),
    v3Candidate: JSON.parse(v3CandidateText), v3CandidateText,
    v3Shadow, v3ShadowText, v3Events: parseJsonLines(v3EventsText), v3EventsText,
    v3Preflight: JSON.parse(v3PreflightText),
    v3RepositoryPreflight: JSON.parse(v3RepositoryPreflightText),
  };
}

async function readArtifactRef(root, ref, label) {
  const item = requireObject(ref, `${label} ref`);
  const relative = requireRelativePath(item.path, `${label}.path`);
  const target = path.resolve(root, ...relative.split("/"));
  const relativeToRoot = path.relative(root, target);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error(`${label} ref escaped its artifact root.`);
  }
  const text = await fs.readFile(target, "utf8");
  if (sha256(text) !== requireSha256(item.sha256, `${label}.sha256`)) {
    throw new Error(`${label} hash drifted.`);
  }
  return text;
}

export async function writeNavigationShadowV3AnalysisArtifact(outputRoot, artifact) {
  const resolved = path.resolve(requireString(outputRoot, "outputRoot"));
  await assertPathAbsent(resolved, "output root");
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.mkdir(resolved);
  await fs.writeFile(
    path.join(resolved, "navigation-shadow-v3-analysis.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
}

export function parseNavigationShadowV3AnalysisCliArguments(argv) {
  const supported = new Set([
    "baseline-run-root", "v1-analysis-root", "v1-shadow-root", "v2-analysis-root", "v2-shadow-root",
    "v3-candidate-root", "v3-shadow-root", "output-root", "generated-at",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Invalid navigation shadow v3 analysis argument near ${String(flag ?? "<end>")}.`);
    }
    const name = flag.slice(2);
    if (!supported.has(name)) throw new Error(`Unknown navigation shadow v3 analysis argument: ${flag}.`);
    if (values.has(name)) throw new Error(`${flag} may only be provided once.`);
    values.set(name, value);
  }
  const result = Object.fromEntries([
    ["baselineRunRoot", "--baseline-run-root"], ["v1AnalysisRoot", "--v1-analysis-root"],
    ["v1ShadowRoot", "--v1-shadow-root"], ["v2AnalysisRoot", "--v2-analysis-root"],
    ["v2ShadowRoot", "--v2-shadow-root"], ["v3CandidateRoot", "--v3-candidate-root"],
    ["v3ShadowRoot", "--v3-shadow-root"], ["outputRoot", "--output-root"],
  ].map(([key, flag]) => [key, requireString(values.get(flag.slice(2)), flag)]));
  return {
    ...result,
    ...(values.has("generated-at") ? { generatedAt: requireIsoTimestamp(values.get("generated-at")) } : {}),
  };
}

function parseJsonLines(text) {
  return requireText(text, "events text").trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}

function requireIsoTimestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("generatedAt must be an ISO timestamp.");
  return value;
}

function requireRelativePath(value, label) {
  const relative = requireText(value, label).replaceAll("\\", "/");
  if (relative.startsWith("/") || relative.split("/").some((part) => part === ".." || part === ".")) {
    throw new Error(`${label} must be a safe relative path.`);
  }
  return relative;
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) throw new Error(`${label} must be SHA-256.`);
  return value;
}

function requireNonNegativeNumber(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative.`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function requireText(value, label) {
  return requireString(value, label);
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function assertSame(left, right, label) {
  if (left !== right) throw new Error(`${label} drifted.`);
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function round(value) {
  return Number(value.toFixed(8));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function assertDirectory(target, label) {
  const stats = await fs.stat(target).catch(() => null);
  if (!stats?.isDirectory()) throw new Error(`${label} must be a directory.`);
}

async function assertPathAbsent(target, label) {
  const stats = await fs.lstat(target).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (stats) throw new Error(`${label} already exists.`);
}

function assertDisjointRoots(left, right, leftLabel, rightLabel) {
  const relative = path.relative(left, right);
  const reverse = path.relative(right, left);
  if (!relative || !reverse || (!relative.startsWith("..") && !path.isAbsolute(relative))
    || (!reverse.startsWith("..") && !path.isAbsolute(reverse))) {
    throw new Error(`${leftLabel} must be disjoint from ${rightLabel}.`);
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === scriptPath) {
  runNavigationShadowV3Analysis(parseNavigationShadowV3AnalysisCliArguments(process.argv.slice(2)))
    .then((artifact) => console.log(
      `[coding-agent-navigation-shadow-v3-analysis] ${artifact.status}; `
      + `decision=${artifact.decision.status}; totalCostCny=${artifact.crossPlatform.totalObservedCostCny}`,
    ))
    .catch((error) => {
      console.error(`[coding-agent-navigation-shadow-v3-analysis] failed: ${String(error?.message ?? error)}`);
      process.exitCode = 1;
    });
}
