import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_V2_ANALYSIS_VERSION =
  "coding-agent-benchmark-navigation-shadow-v2-analysis/v1";

const TASK_ID = "real-js.bug-fix";
const CANDIDATE_ID = "workspace-write-navigation-candidate-v2";
const PLATFORMS = ["windows-native", "wsl2-linux"];
const EDIT_TOOLS = new Set(["file_edit", "apply_patch", "file_write", "file_delete"]);
const scriptPath = fileURLToPath(import.meta.url);

export function buildNavigationShadowV2Analysis(input) {
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  const v1Analysis = requireObject(input?.v1Analysis, "v1Analysis");
  const v1AnalysisText = requireText(input?.v1AnalysisText, "v1AnalysisText");
  validateV1Analysis(v1Analysis);
  const v1AnalysisSha256 = sha256(v1AnalysisText);
  const baseline = normalizeBaseline(v1Analysis.baseline);
  const v1Platforms = new Map(v1Analysis.platforms.map((item) => [item.platform, item]));

  const platformInputs = requireArray(input?.platformInputs, "platformInputs");
  if (platformInputs.length !== PLATFORMS.length) {
    throw new Error("Navigation shadow v2 analysis requires exactly two platform inputs.");
  }
  const platforms = platformInputs.map((item) => analyzePlatformInput({
    ...item,
    baseline,
    v1Platform: v1Platforms.get(item?.platform),
    v1AnalysisSha256,
  })).sort((left, right) => PLATFORMS.indexOf(left.platform) - PLATFORMS.indexOf(right.platform));
  if (platforms.map((item) => item.platform).join(",") !== PLATFORMS.join(",")) {
    throw new Error("Navigation shadow v2 analysis requires Windows native and WSL2 evidence.");
  }

  const [windows, wsl] = platforms;
  assertSame(windows.provider, wsl.provider, "Provider identity");
  assertSame(windows.modelId, wsl.modelId, "model identity");
  assertSame(windows.source.manifestSha256, wsl.source.manifestSha256, "manifest identity");
  assertSame(windows.source.baselineCommit, wsl.source.baselineCommit, "baseline identity");
  assertSame(
    windows.source.repositorySnapshotIdentitySha256,
    wsl.source.repositorySnapshotIdentitySha256,
    "repository snapshot identity",
  );
  if (JSON.stringify(windows.offlineCandidate) !== JSON.stringify(wsl.offlineCandidate)) {
    throw new Error("Navigation shadow v2 analysis offline candidate metrics drifted across platforms.");
  }

  const sharedFailureSignature = platforms.every((item) =>
    item.outcome.status === "failed"
    && item.outcome.failureCategory === "product_workflow"
    && item.budget.kind === "total_tokens"
    && item.budget.observed > item.budget.limit
    && item.execution.enteredEditPhase === false
    && item.execution.changedFileCount === 0
    && item.evaluator.taskCompleted === false
    && item.evaluator.patchAccepted === false);
  if (!sharedFailureSignature) {
    throw new Error("Navigation shadow v2 analysis evidence does not support the shared failure decision.");
  }
  const promptContractStable = platforms.every((item) =>
    item.promptContract.compliant === platforms[0].promptContract.compliant);
  if (promptContractStable) {
    throw new Error("Navigation shadow v2 analysis expected cross-platform prompt-contract instability.");
  }
  const tokenDirections = new Set(platforms.map((item) => Math.sign(
    item.comparison.vsBaselineTotalTokenDelta,
  )));
  const tokenOutcomeStable = tokenDirections.size === 1;
  if (tokenOutcomeStable) {
    throw new Error("Navigation shadow v2 analysis expected cross-platform token-outcome instability.");
  }
  const runtimeContractAttributionSupported =
    windows.tools.invalidGlobArgumentFailureCount > 0
    && wsl.tools.broadGlobReturnedCount > 0
    && platforms.every((item) =>
      item.promptContract.enforcement === "prompt_contract"
      && item.promptContract.runtimeToolGuard === false
      && item.comparison.actualVsOfflineResponseBytesDelta > 0);
  if (!runtimeContractAttributionSupported) {
    throw new Error(
      "Navigation shadow v2 analysis evidence does not support the runtime-contract attribution.",
    );
  }

  return {
    schemaVersion: CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_V2_ANALYSIS_VERSION,
    generatedAt,
    status: "completed",
    taskId: TASK_ID,
    candidateId: CANDIDATE_ID,
    model: { provider: windows.provider, id: windows.modelId },
    decision: {
      status: "do_not_promote",
      reasonCodes: [
        "cross_platform_product_failure",
        "prompt_contract_not_cross_platform_stable",
        "runtime_tool_argument_contract_drift",
        "token_outcome_not_cross_platform_stable",
        "edit_phase_not_reached",
        "machine_evaluator_failed",
      ],
      technicalDebtDecision: "split_task",
      nextCandidate: "navigation-candidate-v3-runtime-contract-required",
      requiresNewProviderAuthorization: true,
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
    offlineCandidate: structuredClone(windows.offlineCandidate),
    platforms: platforms.map(stripInternalPlatformFields),
    crossPlatform: {
      sameManifestSha256: true,
      sameBaselineCommit: true,
      sameRepositorySnapshotIdentity: true,
      providerModelMatched: true,
      sharedFailureSignature,
      providerUsageComplete: true,
      preflightsPassed: true,
      promptContractStable,
      tokenOutcomeStable,
      totalObservedCostCny: round(sum(platforms.map((item) => item.usage.costCny))),
    },
    attribution: {
      primary: "prompt_only_navigation_contract_not_runtime_stable",
      contributors: [
        "coding_ci_file_glob_argument_contract_rejects_offline_array_shape",
        "empty_file_glob_arguments_allow_broad_workspace_listing",
        "prompt_adherence_varies_across_platform_runs",
        "cumulative_context_replay_still_exceeds_budget",
      ],
      excluded: [
        "gateway_infrastructure",
        "workspace_identity_drift",
        "provider_usage_incomplete",
        "evaluator_infrastructure",
        "host_command_execution",
      ],
    },
    diagnostics: [],
  };
}

function validateV1Analysis(analysis) {
  if (analysis.schemaVersion !== "coding-agent-benchmark-navigation-shadow-analysis/v1"
    || analysis.status !== "completed"
    || analysis.taskId !== TASK_ID
    || analysis.candidateId !== "workspace-write-navigation-candidate-v1") {
    throw new Error("Navigation shadow v2 analysis requires the completed candidate v1 decision.");
  }
  if (analysis.decision !== undefined
    && (analysis.decision?.status !== "do_not_promote"
      || analysis.decision?.nextCandidate !== "navigation-candidate-v2-required")) {
    throw new Error("Navigation shadow v2 analysis candidate v1 decision drifted.");
  }
  const platforms = requireArray(analysis.platforms, "v1Analysis.platforms");
  if (platforms.length !== PLATFORMS.length
    || platforms.some((item) => !PLATFORMS.includes(item?.platform))) {
    throw new Error("Navigation shadow v2 analysis requires both candidate v1 platforms.");
  }
}

function analyzePlatformInput(input) {
  const platform = requirePlatform(input?.platform);
  const artifact = requireObject(input?.shadowArtifact, `${platform} shadowArtifact`);
  const artifactText = requireText(input?.shadowArtifactText, `${platform} shadowArtifactText`);
  const candidate = requireObject(input?.candidateEvidence, `${platform} candidateEvidence`);
  const candidateText = requireText(input?.candidateEvidenceText, `${platform} candidateEvidenceText`);
  const events = requireArray(input?.events, `${platform} events`);
  const eventsText = requireText(input?.eventsText, `${platform} eventsText`);
  const preflight = requireObject(input?.preflight, `${platform} preflight`);
  const repositoryPreflight = requireObject(
    input?.repositoryPreflight,
    `${platform} repositoryPreflight`,
  );
  const baseline = normalizeBaseline(input?.baseline);
  const v1Platform = requireObject(input?.v1Platform, `${platform} candidate v1 metrics`);

  if (candidate.schemaVersion !== "coding-agent-benchmark-navigation-candidate-v2/v1"
    || candidate.status !== "eligible_for_shadow_readiness"
    || candidate.platform !== platform
    || candidate.taskId !== TASK_ID
    || candidate.candidate?.id !== CANDIDATE_ID
    || candidate.comparison?.tokenImpact?.status !== "not_measured"
    || candidate.comparison?.tokenImpact?.reason !== "no_model_call") {
    throw new Error(`${platform} candidate evidence is not analysis-safe.`);
  }
  const candidateSha256 = sha256(candidateText);
  if (candidate.source?.analysisSha256 !== input.v1AnalysisSha256) {
    throw new Error(`${platform} candidate evidence analysis hash drifted.`);
  }
  if (artifact.schemaVersion !== "coding-agent-benchmark-navigation-shadow-real-v2/v1"
    || artifact.status !== "completed"
    || artifact.taskId !== TASK_ID
    || artifact.platform !== platform
    || artifact.candidate?.id !== CANDIDATE_ID
    || artifact.candidate?.manifestModified !== false
    || artifact.execution?.v3AggregateEligible !== false
    || artifact.execution?.hostCommandToolCalls !== 0) {
    throw new Error(`${platform} shadow v2 artifact is not analysis-safe.`);
  }
  if (artifact.source?.candidateEvidenceSha256 !== candidateSha256
    || artifact.source?.analysisSha256 !== input.v1AnalysisSha256) {
    throw new Error(`${platform} shadow v2 source evidence hash drifted.`);
  }
  const eventsSha256 = sha256(eventsText);
  if ((artifact.source?.eventsSha256 !== undefined
    && eventsSha256 !== artifact.source.eventsSha256)
    || eventsSha256 !== artifact.artifacts?.events?.sha256) {
    throw new Error(`${platform} shadow v2 events hash drifted.`);
  }
  if (events.some((event) => event?.type === "tool.started"
    && event?.payload?.tool?.name === "run_command")) {
    throw new Error(`${platform} shadow v2 evidence contains a denied run_command call.`);
  }

  const runId = requireString(artifact.outcome?.runId, `${platform} runId`);
  validatePreflights(platform, runId, preflight, repositoryPreflight);
  const rawCalls = summarizeRawCalls(events);
  const usageEvent = events.filter((event) => event?.type === "run.usage").at(-1);
  const usage = requireObject(usageEvent?.payload?.usage, `${platform} provider usage`);
  const budgetEvent = events.filter((event) => event?.type === "run.budget_exhausted").at(-1);
  const budget = requireObject(budgetEvent?.payload?.budget, `${platform} exhausted budget`);
  const inputTokens = requireNonNegativeInteger(usage.input, `${platform} input tokens`);
  const outputTokens = requireNonNegativeInteger(usage.output, `${platform} output tokens`);
  const totalTokens = inputTokens + outputTokens;
  const modelCalls = requireNonNegativeInteger(usage.modelCalls, `${platform} model calls`);
  const providerUsageComplete = usage.source === "provider_reported"
    && usage.completeness?.status === "complete"
    && usage.providerReportedModelCalls === modelCalls
    && Number.isFinite(usage.costUsd);
  if (!providerUsageComplete) {
    throw new Error(`${platform} provider usage is incomplete.`);
  }
  if (artifact.outcome?.inputTokens !== inputTokens
    || artifact.outcome?.outputTokens !== outputTokens
    || artifact.outcome?.totalTokens !== totalTokens
    || artifact.outcome?.costUsd !== usage.costUsd
    || artifact.execution?.modelCalls !== modelCalls
    || artifact.execution?.toolCallCount !== rawCalls.length
    || (artifact.execution?.toolCompletedCount !== undefined
      && artifact.execution.toolCompletedCount !== rawCalls.length)) {
    throw new Error(`${platform} shadow v2 metrics drifted from the outer artifact.`);
  }
  if (artifact.comparison?.baseline?.runId !== baseline.runId
    || artifact.comparison?.baseline?.totalTokens !== baseline.totalTokens) {
    throw new Error(`${platform} historical baseline drifted from the shadow v2 artifact.`);
  }

  const candidateV1 = {
    totalTokens: requireNonNegativeInteger(
      v1Platform.usage?.totalTokens,
      `${platform} candidate v1 totalTokens`,
    ),
    modelCalls: requireNonNegativeInteger(
      v1Platform.usage?.modelCalls,
      `${platform} candidate v1 modelCalls`,
    ),
    toolCallCount: requireNonNegativeInteger(
      v1Platform.tools?.callCount,
      `${platform} candidate v1 toolCallCount`,
    ),
    modelVisibleResponseBytes: requireNonNegativeInteger(
      v1Platform.tools?.modelVisibleResponseBytes,
      `${platform} candidate v1 modelVisibleResponseBytes`,
    ),
  };
  const offlineCandidate = {
    toolCallCount: requireNonNegativeInteger(
      candidate.replay?.toolCallCount,
      `${platform} offline toolCallCount`,
    ),
    modelVisibleResponseBytes: requireNonNegativeInteger(
      candidate.replay?.modelVisibleResponseBytes,
      `${platform} offline response bytes`,
    ),
    tokenImpactStatus: "not_measured",
  };
  const evaluator = requireObject(artifact.outcome?.evaluation, `${platform} evaluator`);
  const prompt = requireObject(artifact.promptContract, `${platform} promptContract`);
  const modelVisibleResponseBytes = sum(rawCalls
    .filter((call) => call.success)
    .map((call) => Buffer.byteLength(call.output, "utf-8")));
  const invalidGlobArgumentFailureCount = rawCalls.filter((call) =>
    call.name === "file_glob"
    && call.success === false
    && Array.isArray(call.arguments?.include)
    && /include.*(?:must be string|必须是 string)/iu.test(call.error ?? "")).length;
  const broadGlobReturnedCount = sum(rawCalls.filter((call) =>
    call.name === "file_glob"
    && call.success
    && Object.keys(call.arguments).length === 0)
    .map((call) => normalizeNonNegativeInteger(call.metadata?.returnedCount, 0)));

  return {
    platform,
    provider: requireString(artifact.authorization?.provider, `${platform} provider`),
    modelId: requireString(artifact.authorization?.modelId, `${platform} modelId`),
    offlineCandidate,
    runId,
    outcome: {
      status: artifact.outcome.status,
      failureCategory: artifact.outcome.failureCategory ?? null,
    },
    usage: {
      source: usage.source,
      complete: providerUsageComplete,
      inputTokens,
      outputTokens,
      totalTokens,
      modelCalls,
      costUsd: usage.costUsd,
      costCny: requireNonNegativeNumber(artifact.authorization?.runCostCny, `${platform} costCny`),
    },
    budget: {
      kind: requireString(budget.budget, `${platform} budget kind`),
      limit: requireNonNegativeInteger(budget.limit, `${platform} budget limit`),
      observed: requireNonNegativeInteger(budget.observed, `${platform} budget observed`),
    },
    promptContract: {
      strategyId: requireString(prompt.strategyId ?? "bounded-localize-before-read/v1", "strategyId"),
      enforcement: requireString(prompt.enforcement ?? "prompt_contract", "enforcement"),
      runtimeToolGuard: prompt.runtimeToolGuard === true,
      compliant: prompt.compliant === true,
      fileGlobBeforeSourceRead: prompt.fileGlobBeforeSourceRead === true,
      regressionTestReadBeforeSourceInspection:
        prompt.regressionTestReadBeforeSourceInspection === true,
      boundedTextSearchObserved: prompt.boundedTextSearchObserved === true,
      fullTargetReadBeforeLocalization: prompt.fullTargetReadBeforeLocalization === true,
      repeatedCompleteFileReadCount: requireNonNegativeInteger(
        prompt.repeatedCompleteFileReadCount,
        `${platform} repeatedCompleteFileReadCount`,
      ),
    },
    tools: {
      callCount: rawCalls.length,
      successfulCount: rawCalls.filter((call) => call.success).length,
      failedCount: rawCalls.filter((call) => !call.success).length,
      invalidGlobArgumentFailureCount,
      broadGlobReturnedCount,
      sequence: rawCalls.map((call) => call.name),
      modelVisibleResponseBytes,
      editCallCount: rawCalls.filter((call) => EDIT_TOOLS.has(call.name)).length,
    },
    execution: {
      enteredEditPhase: artifact.execution.enteredEditPhase,
      budgetExhausted: artifact.execution.budgetExhausted,
      changedFileCount: Array.isArray(artifact.outcome.changedPaths)
        ? artifact.outcome.changedPaths.length
        : 0,
      preflightsPassed: true,
    },
    evaluator: {
      source: evaluator.source,
      taskCompleted: evaluator.taskCompleted,
      testsPassed: evaluator.testsPassed,
      patchAccepted: evaluator.patchAccepted,
      regressionCount: evaluator.regressionCount,
      manualInterventionCount: evaluator.manualInterventionCount,
    },
    comparison: {
      vsBaselineTotalTokenDelta: totalTokens - baseline.totalTokens,
      vsCandidateV1TotalTokenDelta: totalTokens - candidateV1.totalTokens,
      vsCandidateV1ModelCallDelta: modelCalls - candidateV1.modelCalls,
      vsCandidateV1ToolCallDelta: rawCalls.length - candidateV1.toolCallCount,
      actualVsOfflineResponseBytesDelta:
        modelVisibleResponseBytes - offlineCandidate.modelVisibleResponseBytes,
      budgetOverflowTokens: Math.max(0, totalTokens - requireNonNegativeInteger(
        budget.limit,
        `${platform} budget limit`,
      )),
    },
    source: {
      shadowArtifactSha256: sha256(artifactText),
      candidateEvidenceSha256: candidateSha256,
      v1AnalysisSha256: input.v1AnalysisSha256,
      eventsSha256,
      executionReportSha256: requireSha256(
        artifact.source?.executionReportSha256,
        `${platform} executionReportSha256`,
      ),
      manifestSha256: requireSha256(artifact.source?.manifestSha256, `${platform} manifestSha256`),
      baselineCommit: requireSha1(artifact.source?.baselineCommit, `${platform} baselineCommit`),
      repositorySnapshotIdentitySha256: requireSha256(
        artifact.source?.repositorySnapshotIdentitySha256,
        `${platform} repositorySnapshotIdentitySha256`,
      ),
    },
  };
}

function validatePreflights(platform, runId, preflight, repositoryPreflight) {
  if (preflight.schemaVersion !== "coding-agent-benchmark-preflight/v1"
    || preflight.manifestRevision !== "v3"
    || preflight.taskId !== TASK_ID
    || preflight.runId !== runId
    || preflight.status !== "passed"
    || preflight.checks?.contractSource?.status !== "passed"
    || preflight.checks?.executionBudget?.status !== "passed"
    || preflight.checks?.executionBudget?.maxTokens !== 24_000
    || repositoryPreflight.schemaVersion !== "coding-agent-benchmark-snapshot-preflight/v1"
    || repositoryPreflight.taskId !== TASK_ID
    || repositoryPreflight.repositoryId !== "express"
    || repositoryPreflight.status !== "passed"
    || repositoryPreflight.checks?.manifestBinding?.status !== "passed"
    || repositoryPreflight.checks?.sourceIdentity?.status !== "passed"
    || repositoryPreflight.checks?.license?.status !== "passed"
    || repositoryPreflight.checks?.dependencyCache?.status !== "passed"
    || repositoryPreflight.checks?.executionNetwork?.status !== "passed") {
    throw new Error(`${platform} shadow v2 preflight did not pass.`);
  }
}

function normalizeBaseline(value) {
  const baseline = requireObject(value, "baseline");
  return {
    runId: requireString(baseline.runId, "baseline.runId"),
    inputTokens: requireNonNegativeInteger(baseline.inputTokens, "baseline.inputTokens"),
    outputTokens: requireNonNegativeInteger(baseline.outputTokens, "baseline.outputTokens"),
    totalTokens: requireNonNegativeInteger(baseline.totalTokens, "baseline.totalTokens"),
    modelCalls: requireNonNegativeInteger(baseline.modelCalls, "baseline.modelCalls"),
    toolCallCount: requireNonNegativeInteger(baseline.toolCallCount, "baseline.toolCallCount"),
    changedFileCount: requireNonNegativeInteger(
      baseline.changedFileCount,
      "baseline.changedFileCount",
    ),
    budgetExhausted: baseline.budgetExhausted === true,
    modelVisibleResponseBytes: requireNonNegativeInteger(
      baseline.modelVisibleResponseBytes,
      "baseline.modelVisibleResponseBytes",
    ),
  };
}

function summarizeRawCalls(events) {
  const started = new Map();
  const calls = [];
  for (const event of events) {
    const tool = event?.payload?.tool;
    if (event?.type === "tool.started" && typeof tool?.id === "string") {
      started.set(tool.id, tool);
    } else if (event?.type === "tool.completed" && typeof tool?.id === "string") {
      const source = started.get(tool.id);
      if (!source) throw new Error(`Tool completion ${tool.id} has no matching start.`);
      calls.push({
        name: requireString(tool.name ?? source.name, "tool name"),
        arguments: requireObject(source.arguments ?? {}, "tool arguments"),
        success: tool.success === true,
        output: typeof tool.output === "string" ? tool.output : "",
        error: typeof tool.error === "string" ? tool.error : null,
        metadata: tool.metadata,
      });
    }
  }
  return calls;
}

function stripInternalPlatformFields(item) {
  const { provider: _provider, modelId: _modelId, offlineCandidate: _offline, ...publicItem } = item;
  return publicItem;
}

export async function runNavigationShadowV2Analysis(input) {
  const roots = {
    v1AnalysisRoot: path.resolve(requireString(input?.v1AnalysisRoot, "v1AnalysisRoot")),
    windowsShadowRoot: path.resolve(requireString(input?.windowsShadowRoot, "windowsShadowRoot")),
    windowsCandidateRoot: path.resolve(
      requireString(input?.windowsCandidateRoot, "windowsCandidateRoot"),
    ),
    wslShadowRoot: path.resolve(requireString(input?.wslShadowRoot, "wslShadowRoot")),
    wslCandidateRoot: path.resolve(requireString(input?.wslCandidateRoot, "wslCandidateRoot")),
    outputRoot: path.resolve(requireString(input?.outputRoot, "outputRoot")),
  };
  for (const [name, target] of Object.entries(roots)) {
    if (name === "outputRoot") continue;
    await assertDirectory(target, name);
    assertDisjointRoots(roots.outputRoot, target, "outputRoot", name);
  }
  await assertPathAbsent(roots.outputRoot, "output root");
  const v1AnalysisPath = path.join(roots.v1AnalysisRoot, "navigation-shadow-analysis.json");
  const v1AnalysisText = await fs.readFile(v1AnalysisPath, "utf-8");
  const v1Analysis = JSON.parse(v1AnalysisText);
  const platformInputs = await Promise.all([
    loadPlatformInput({
      platform: "windows-native",
      shadowRoot: roots.windowsShadowRoot,
      candidateRoot: roots.windowsCandidateRoot,
    }),
    loadPlatformInput({
      platform: "wsl2-linux",
      shadowRoot: roots.wslShadowRoot,
      candidateRoot: roots.wslCandidateRoot,
    }),
  ]);
  const artifact = buildNavigationShadowV2Analysis({
    generatedAt: input?.generatedAt,
    v1Analysis,
    v1AnalysisText,
    platformInputs,
  });
  await writeNavigationShadowV2AnalysisArtifact(roots.outputRoot, artifact);
  return artifact;
}

async function loadPlatformInput(input) {
  const shadowPath = path.join(input.shadowRoot, "navigation-shadow-real-v2.json");
  const candidatePath = path.join(input.candidateRoot, "navigation-candidate-v2.json");
  const [shadowArtifactText, candidateEvidenceText] = await Promise.all([
    fs.readFile(shadowPath, "utf-8"),
    fs.readFile(candidatePath, "utf-8"),
  ]);
  const shadowArtifact = JSON.parse(shadowArtifactText);
  const candidateEvidence = JSON.parse(candidateEvidenceText);
  const [eventsText, preflightText, repositoryPreflightText] = await Promise.all([
    readArtifactRef(input.shadowRoot, shadowArtifact.artifacts?.events, "events"),
    readArtifactRef(input.shadowRoot, shadowArtifact.artifacts?.preflight, "preflight"),
    readArtifactRef(
      input.shadowRoot,
      shadowArtifact.artifacts?.repositorySnapshotPreflight,
      "repositorySnapshotPreflight",
    ),
  ]);
  return {
    platform: input.platform,
    shadowArtifact,
    shadowArtifactText,
    candidateEvidence,
    candidateEvidenceText,
    events: parseJsonLines(eventsText),
    eventsText,
    preflight: JSON.parse(preflightText),
    repositoryPreflight: JSON.parse(repositoryPreflightText),
  };
}

async function readArtifactRef(root, ref, label) {
  const item = requireObject(ref, `${label} artifact ref`);
  const relative = requireRelativePath(item.path, `${label}.path`);
  const expectedSha256 = requireSha256(item.sha256, `${label}.sha256`);
  const target = path.resolve(root, ...relative.split("/"));
  const rootRelative = path.relative(root, target);
  if (rootRelative.startsWith("..") || path.isAbsolute(rootRelative)) {
    throw new Error(`${label} artifact ref escaped its shadow root.`);
  }
  const text = await fs.readFile(target, "utf-8");
  if (sha256(text) !== expectedSha256) throw new Error(`${label} artifact ref hash drifted.`);
  return text;
}

export async function writeNavigationShadowV2AnalysisArtifact(outputRoot, artifact) {
  const resolved = path.resolve(requireString(outputRoot, "outputRoot"));
  await assertPathAbsent(resolved, "output root");
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.mkdir(resolved);
  await fs.writeFile(
    path.join(resolved, "navigation-shadow-v2-analysis.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
    { encoding: "utf-8", flag: "wx" },
  );
}

export function parseNavigationShadowV2AnalysisCliArguments(argv) {
  const supported = new Set([
    "v1-analysis-root",
    "windows-shadow-root",
    "windows-candidate-root",
    "wsl-shadow-root",
    "wsl-candidate-root",
    "output-root",
    "generated-at",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(
        `Invalid navigation shadow v2 analysis argument near ${String(flag ?? "<end>")}.`,
      );
    }
    const name = flag.slice(2);
    if (!supported.has(name)) {
      throw new Error(`Unknown navigation shadow v2 analysis argument: ${flag}.`);
    }
    if (values.has(name)) throw new Error(`${flag} may only be provided once.`);
    values.set(name, value);
  }
  return {
    v1AnalysisRoot: requireString(values.get("v1-analysis-root"), "--v1-analysis-root"),
    windowsShadowRoot: requireString(values.get("windows-shadow-root"), "--windows-shadow-root"),
    windowsCandidateRoot: requireString(
      values.get("windows-candidate-root"),
      "--windows-candidate-root",
    ),
    wslShadowRoot: requireString(values.get("wsl-shadow-root"), "--wsl-shadow-root"),
    wslCandidateRoot: requireString(
      values.get("wsl-candidate-root"),
      "--wsl-candidate-root",
    ),
    outputRoot: requireString(values.get("output-root"), "--output-root"),
    ...(values.has("generated-at")
      ? { generatedAt: requireIsoTimestamp(values.get("generated-at")) }
      : {}),
  };
}

function parseJsonLines(text) {
  return text.split(/\r?\n/u).filter((line) => line.trim()).map((line) => JSON.parse(line));
}

function assertSame(left, right, label) {
  if (left !== right) {
    throw new Error(`Navigation shadow v2 analysis ${label} drifted across platforms.`);
  }
}

function assertDisjointRoots(left, right, leftLabel, rightLabel) {
  const relative = path.relative(left, right);
  const reverse = path.relative(right, left);
  if (!relative || !reverse || (!relative.startsWith("..") && !path.isAbsolute(relative))
    || (!reverse.startsWith("..") && !path.isAbsolute(reverse))) {
    throw new Error(`Navigation shadow v2 analysis ${leftLabel} must be disjoint from ${rightLabel}.`);
  }
}

async function assertDirectory(target, label) {
  const stats = await fs.stat(target).catch(() => null);
  if (!stats?.isDirectory()) {
    throw new Error(`Navigation shadow v2 analysis ${label} must be a directory.`);
  }
}

async function assertPathAbsent(target, label) {
  const stats = await fs.lstat(target).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (stats) throw new Error(`Navigation shadow v2 analysis ${label} already exists.`);
}

function requirePlatform(value) {
  const platform = requireString(value, "platform");
  if (!PLATFORMS.includes(platform)) throw new Error(`Unsupported analysis platform: ${platform}.`);
  return platform;
}

function requireRelativePath(value, label) {
  const relative = requireString(value, label);
  if (relative.includes("\\") || relative.startsWith("/") || /^[A-Za-z]:\//u.test(relative)
    || relative.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${label} must be a contained relative path.`);
  }
  return relative;
}

function requireIsoTimestamp(value) {
  const timestamp = requireString(value, "generatedAt");
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error("generatedAt must be an ISO timestamp.");
  return timestamp;
}

function requireSha1(value, label) {
  const hash = requireString(value, label);
  if (!/^[a-f0-9]{40}$/u.test(hash)) throw new Error(`${label} must be a SHA-1.`);
  return hash;
}

function requireSha256(value, label) {
  const hash = requireString(value, label);
  if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error(`${label} must be a SHA-256.`);
  return hash;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function requireNonNegativeNumber(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Navigation shadow v2 analysis requires ${label}.`);
  }
  return value.trim();
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Navigation shadow v2 analysis requires ${label}.`);
  }
  return value;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Navigation shadow v2 analysis requires ${label}.`);
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`Navigation shadow v2 analysis requires ${label}.`);
  return value;
}

function normalizeNonNegativeInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
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

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

async function main() {
  const artifact = await runNavigationShadowV2Analysis(
    parseNavigationShadowV2AnalysisCliArguments(process.argv.slice(2)),
  );
  console.log(
    `[coding-agent-navigation-shadow-v2-analysis] ${artifact.decision.status}; `
    + `costCny=${artifact.crossPlatform.totalObservedCostCny}`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(scriptPath)) {
  main().catch((error) => {
    console.error(`[coding-agent-navigation-shadow-v2-analysis] failed: ${safeMessage(error)}`);
    process.exitCode = 1;
  });
}
