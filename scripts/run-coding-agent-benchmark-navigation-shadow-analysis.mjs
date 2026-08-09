import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  analyzeNavigationEfficiencyBaseline,
  CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_ID,
} from "./run-coding-agent-benchmark-navigation-efficiency.mjs";
import {
  CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_REAL_VERSION,
} from "./run-coding-agent-benchmark-navigation-shadow-real.mjs";

export const CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_ANALYSIS_VERSION =
  "coding-agent-benchmark-navigation-shadow-analysis/v1";

const TASK_ID = "real-js.bug-fix";
const REGRESSION_TEST_PATH = "test/benchmark-v3/real-js-bug-fix.js";
const TARGET_PATH = "lib/request.js";
const PLATFORMS = ["windows-native", "wsl2-linux"];
const scriptPath = fileURLToPath(import.meta.url);
const defaultSourceRoot = path.resolve(path.dirname(scriptPath), "..");

export function buildNavigationShadowAnalysis(input) {
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  const platformInputs = requireArray(input?.platformInputs, "platformInputs");
  if (platformInputs.length !== PLATFORMS.length) {
    throw new Error("Navigation shadow analysis requires exactly two platform inputs.");
  }
  const platforms = platformInputs.map(analyzePlatformInput).sort(
    (left, right) => PLATFORMS.indexOf(left.platform) - PLATFORMS.indexOf(right.platform),
  );
  if (platforms.map((item) => item.platform).join(",") !== PLATFORMS.join(",")) {
    throw new Error("Navigation shadow analysis requires Windows native and WSL2 evidence.");
  }

  const [windows, wsl] = platforms;
  assertSame(windows.candidateId, wsl.candidateId, "candidate identity");
  assertSame(windows.provider, wsl.provider, "Provider identity");
  assertSame(windows.modelId, wsl.modelId, "model identity");
  assertSame(windows.source.manifestSha256, wsl.source.manifestSha256, "manifest identity");
  assertSame(windows.source.baselineCommit, wsl.source.baselineCommit, "baseline identity");
  assertSame(
    windows.source.repositorySnapshotIdentitySha256,
    wsl.source.repositorySnapshotIdentitySha256,
    "repository snapshot identity",
  );
  if (JSON.stringify(windows.baseline) !== JSON.stringify(wsl.baseline)) {
    throw new Error("Navigation shadow analysis baseline metrics drifted across platforms.");
  }
  if (JSON.stringify(windows.offlineCandidate) !== JSON.stringify(wsl.offlineCandidate)) {
    throw new Error("Navigation shadow analysis offline candidate metrics drifted across platforms.");
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
  const providerUsageComplete = platforms.every((item) => item.usage.complete);
  const preflightsPassed = platforms.every((item) => item.execution.preflightsPassed);
  const navigationToolsObserved = platforms.every((item) =>
    item.tools.sequence.includes("file_glob") && item.tools.sequence.includes("text_search"));
  if (!sharedFailureSignature || !providerUsageComplete || !preflightsPassed
    || !navigationToolsObserved) {
    throw new Error("Navigation shadow analysis evidence does not support the shared failure decision.");
  }
  if (platforms.some((item) => item.comparison.totalTokenDelta <= 0
    || item.comparison.modelVisibleResponseBytesDelta <= 0)) {
    throw new Error("Navigation shadow analysis expected the observed candidate regressions.");
  }
  const attributionSupported = platforms.every((item) =>
    item.comparison.modelCallDelta > 0
    && item.usage.inputTokens > item.baseline.inputTokens
    && item.tools.callCount > item.offlineCandidate.toolCallCount
    && item.comparison.actualVsOfflineResponseBytesDelta > 0
    && item.tools.ellipsizedResultCount > 0
    && item.tools.fullTargetReadBeforeTextSearch);
  if (!attributionSupported) {
    throw new Error("Navigation shadow analysis evidence does not support the strategy attribution.");
  }

  return {
    schemaVersion: CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_ANALYSIS_VERSION,
    generatedAt,
    status: "completed",
    taskId: TASK_ID,
    candidateId: CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_ID,
    model: { provider: windows.provider, id: windows.modelId },
    decision: {
      status: "do_not_promote",
      reasonCodes: [
        "cross_platform_product_failure",
        "total_token_regression",
        "navigation_response_regression",
        "edit_phase_not_reached",
        "machine_evaluator_failed",
      ],
      technicalDebtDecision: "split_task",
      nextCandidate: "navigation-candidate-v2-required",
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
    baseline: structuredClone(windows.baseline),
    offlineCandidate: structuredClone(windows.offlineCandidate),
    platforms: platforms.map(stripInternalPlatformFields),
    crossPlatform: {
      sameManifestSha256: true,
      sameBaselineCommit: true,
      sameRepositorySnapshotIdentity: true,
      providerModelMatched: true,
      sharedFailureSignature,
      providerUsageComplete,
      preflightsPassed,
      navigationToolsObserved,
      totalObservedCostCny: round(sum(platforms.map((item) => item.usage.costCny))),
    },
    attribution: {
      primary: "model_navigation_strategy_not_constrained",
      contributors: [
        "cumulative_context_replay",
        "broad_search_result_ellipsization",
        "full_target_read_before_text_search",
      ],
      excluded: [
        "gateway_infrastructure",
        "workspace_identity_drift",
        "provider_usage_incomplete",
        "evaluator_infrastructure",
      ],
    },
    diagnostics: [],
  };
}

function analyzePlatformInput(input) {
  const platform = requirePlatform(input?.platform);
  const artifact = requireObject(input?.shadowArtifact, `${platform} shadowArtifact`);
  const artifactText = requireText(input?.shadowArtifactText, `${platform} shadowArtifactText`);
  const navigation = requireObject(input?.navigationEvidence, `${platform} navigationEvidence`);
  const navigationText = requireText(
    input?.navigationEvidenceText,
    `${platform} navigationEvidenceText`,
  );
  const events = requireArray(input?.events, `${platform} events`);
  const eventsText = requireText(input?.eventsText, `${platform} eventsText`);
  const preflight = requireObject(input?.preflight, `${platform} preflight`);
  const repositoryPreflight = requireObject(
    input?.repositoryPreflight,
    `${platform} repositoryPreflight`,
  );

  if (artifact.schemaVersion !== CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_REAL_VERSION
    || artifact.status !== "completed"
    || artifact.taskId !== TASK_ID
    || artifact.platform !== platform
    || artifact.candidate?.id !== CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_ID
    || artifact.candidate?.manifestModified !== false
    || artifact.execution?.v3AggregateEligible !== false
    || artifact.execution?.hostCommandToolCalls !== 0) {
    throw new Error(`${platform} shadow artifact is not analysis-safe.`);
  }
  const runId = requireString(artifact.outcome?.runId, `${platform} runId`);
  if (navigation.schemaVersion !== "coding-agent-benchmark-navigation-efficiency/v1"
    || navigation.platform !== platform
    || navigation.status !== "eligible_for_canary"
    || navigation.profile?.id !== CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_ID
    || navigation.profile?.manifestModified !== false
    || navigation.comparison?.tokenImpact?.status !== "not_measured") {
    throw new Error(`${platform} navigation evidence is not the authorized offline candidate.`);
  }
  if (sha256(navigationText) !== artifact.source?.navigationEvidenceSha256) {
    throw new Error(`${platform} navigation evidence hash drifted.`);
  }
  if (sha256(eventsText) !== artifact.artifacts?.events?.sha256) {
    throw new Error(`${platform} shadow events hash drifted.`);
  }
  if (events.some((event) => event?.type === "tool.started"
    && event?.payload?.tool?.name === "run_command")) {
    throw new Error(`${platform} shadow evidence contains a denied run_command call.`);
  }
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
    throw new Error(`${platform} shadow preflight did not pass.`);
  }

  const metrics = analyzeNavigationEfficiencyBaseline({
    manifest: {
      runId: artifact.outcome?.runId,
      taskId: TASK_ID,
      fixture: { baselineCommit: artifact.source?.candidateFixtureBaselineCommit },
      execution: { budgets: { maxTokens: 24_000 } },
    },
    events,
  });
  const usageEvent = events.filter((event) => event?.type === "run.usage").at(-1);
  const usage = requireObject(usageEvent?.payload?.usage, `${platform} provider usage`);
  const budgetEvent = events.filter((event) => event?.type === "run.budget_exhausted").at(-1);
  const budget = requireObject(budgetEvent?.payload?.budget, `${platform} exhausted budget`);
  const rawCalls = summarizeRawCalls(events);
  if (rawCalls.length !== metrics.toolCallCount || rawCalls.some((call) => !call.success)) {
    throw new Error(`${platform} shadow tool evidence is incomplete or unsuccessful.`);
  }
  if (metrics.inputTokens !== artifact.outcome?.inputTokens
    || metrics.outputTokens !== artifact.outcome?.outputTokens
    || metrics.totalTokens !== artifact.outcome?.totalTokens
    || metrics.modelCalls !== artifact.execution?.modelCalls
    || metrics.toolCallCount !== artifact.execution?.toolCallCount) {
    throw new Error(`${platform} shadow metrics drifted from the outer artifact.`);
  }
  const completeUsage = usage.source === "provider_reported"
    && usage.modelCalls === usage.providerReportedModelCalls
    && usage.modelCalls === metrics.modelCalls
    && Number.isFinite(usage.costUsd);
  if (!completeUsage || artifact.outcome?.costUsd !== usage.costUsd) {
    throw new Error(`${platform} shadow usage is incomplete or cost-drifted.`);
  }

  const baseline = normalizeBaseline(navigation.baseline);
  const offlineCandidate = normalizeOfflineCandidate(navigation.candidate, navigation.comparison);
  if (artifact.comparison?.baseline?.runId !== baseline.runId
    || artifact.comparison?.baseline?.totalTokens !== baseline.totalTokens) {
    throw new Error(`${platform} historical baseline drifted from the shadow artifact.`);
  }
  const firstTextSearchIndex = rawCalls.findIndex((call) => call.name === "text_search");
  const fullTargetReadBeforeTextSearch = rawCalls.some((call, index) =>
    index < firstTextSearchIndex
    && call.name === "file_read"
    && call.arguments?.path === TARGET_PATH
    && call.arguments?.offset === undefined
    && call.arguments?.limit === undefined);
  const evaluator = requireObject(artifact.outcome?.evaluation, `${platform} evaluator`);

  return {
    platform,
    candidateId: artifact.candidate.id,
    provider: requireString(artifact.authorization?.provider, `${platform} provider`),
    modelId: requireString(artifact.authorization?.modelId, `${platform} modelId`),
    baseline,
    offlineCandidate,
    runId,
    outcome: {
      status: artifact.outcome.status,
      failureCategory: artifact.outcome.failureCategory ?? null,
    },
    usage: {
      source: usage.source,
      complete: completeUsage,
      inputTokens: metrics.inputTokens,
      outputTokens: metrics.outputTokens,
      totalTokens: metrics.totalTokens,
      modelCalls: metrics.modelCalls,
      costUsd: usage.costUsd,
      costCny: requireNonNegativeNumber(
        artifact.authorization?.runCostCny,
        `${platform} runCostCny`,
      ),
    },
    budget: {
      kind: requireString(budget.budget, `${platform} budget kind`),
      limit: requireNonNegativeInteger(budget.limit, `${platform} budget limit`),
      observed: requireNonNegativeInteger(budget.observed, `${platform} budget observed`),
    },
    tools: {
      callCount: metrics.toolCallCount,
      completedCount: rawCalls.length,
      allSucceeded: true,
      sequence: rawCalls.map((call) => call.name),
      modelVisibleResponseBytes: metrics.modelVisibleResponseBytes,
      ellipsizedResultCount: rawCalls.filter((call) => call.ellipsized).length,
      textSearchReturnedCount: sum(rawCalls
        .filter((call) => call.name === "text_search")
        .map((call) => normalizeNonNegativeInteger(call.metadata?.returnedCount, 0))),
      fullTargetReadBeforeTextSearch,
      supplementalFullFileReadCalls: metrics.calls.filter((call) =>
        call.fullFileRead && ![REGRESSION_TEST_PATH, TARGET_PATH].includes(call.relativePath)).length,
      editCallCount: rawCalls.filter((call) => [
        "file_edit",
        "apply_patch",
        "file_write",
        "file_delete",
      ].includes(call.name)).length,
    },
    execution: {
      enteredEditPhase: artifact.execution.enteredEditPhase,
      budgetExhausted: artifact.execution.budgetExhausted,
      changedFileCount: Array.isArray(artifact.outcome.changedPaths)
        ? artifact.outcome.changedPaths.length
        : metrics.changedFileCount,
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
      totalTokenDelta: metrics.totalTokens - baseline.totalTokens,
      totalTokenIncreaseRatio: increaseRatio(baseline.totalTokens, metrics.totalTokens),
      modelCallDelta: metrics.modelCalls - baseline.modelCalls,
      toolCallDelta: metrics.toolCallCount - baseline.toolCallCount,
      modelVisibleResponseBytesDelta:
        metrics.modelVisibleResponseBytes - baseline.modelVisibleResponseBytes,
      modelVisibleResponseIncreaseRatio: increaseRatio(
        baseline.modelVisibleResponseBytes,
        metrics.modelVisibleResponseBytes,
      ),
      actualVsOfflineResponseBytesDelta:
        metrics.modelVisibleResponseBytes - offlineCandidate.modelVisibleResponseBytes,
    },
    source: {
      shadowArtifactSha256: sha256(artifactText),
      navigationEvidenceSha256: sha256(navigationText),
      eventsSha256: sha256(eventsText),
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

function normalizeBaseline(value) {
  const baseline = requireObject(value, "navigation baseline");
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

function normalizeOfflineCandidate(value, comparison) {
  const candidate = requireObject(value, "offline navigation candidate");
  if (comparison?.tokenImpact?.status !== "not_measured"
    || comparison?.tokenImpact?.reason !== "no_model_call") {
    throw new Error("Offline navigation candidate must not claim token impact.");
  }
  return {
    toolCallCount: requireNonNegativeInteger(candidate.toolCallCount, "candidate.toolCallCount"),
    modelVisibleResponseBytes: requireNonNegativeInteger(
      candidate.modelVisibleResponseBytes,
      "candidate.modelVisibleResponseBytes",
    ),
    tokenImpactStatus: "not_measured",
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
        metadata: tool.metadata,
        ellipsized: typeof tool.output === "string" && tool.output.includes("\u2026"),
      });
    }
  }
  return calls;
}

function stripInternalPlatformFields(item) {
  return {
    platform: item.platform,
    runId: item.runId,
    outcome: item.outcome,
    usage: item.usage,
    budget: item.budget,
    tools: item.tools,
    execution: item.execution,
    evaluator: item.evaluator,
    comparison: item.comparison,
    source: item.source,
  };
}

export async function runNavigationShadowAnalysis(input) {
  const roots = {
    windowsShadowRoot: path.resolve(requireString(input?.windowsShadowRoot, "windowsShadowRoot")),
    windowsNavigationRoot: path.resolve(
      requireString(input?.windowsNavigationRoot, "windowsNavigationRoot"),
    ),
    wslShadowRoot: path.resolve(requireString(input?.wslShadowRoot, "wslShadowRoot")),
    wslNavigationRoot: path.resolve(
      requireString(input?.wslNavigationRoot, "wslNavigationRoot"),
    ),
    outputRoot: path.resolve(requireString(input?.outputRoot, "outputRoot")),
  };
  for (const [name, target] of Object.entries(roots)) {
    if (name === "outputRoot") continue;
    await assertDirectory(target, name);
    assertDisjointRoots(roots.outputRoot, target, "outputRoot", name);
  }
  await assertPathAbsent(roots.outputRoot, "output root");
  const platformInputs = await Promise.all([
    loadPlatformInput({
      platform: "windows-native",
      shadowRoot: roots.windowsShadowRoot,
      navigationRoot: roots.windowsNavigationRoot,
    }),
    loadPlatformInput({
      platform: "wsl2-linux",
      shadowRoot: roots.wslShadowRoot,
      navigationRoot: roots.wslNavigationRoot,
    }),
  ]);
  const artifact = buildNavigationShadowAnalysis({
    generatedAt: input?.generatedAt,
    platformInputs,
  });
  await writeNavigationShadowAnalysisArtifact(roots.outputRoot, artifact);
  return artifact;
}

async function loadPlatformInput(input) {
  const shadowPath = path.join(input.shadowRoot, "navigation-shadow-real.json");
  const navigationPath = path.join(input.navigationRoot, "navigation-efficiency.json");
  const [shadowArtifactText, navigationEvidenceText] = await Promise.all([
    fs.readFile(shadowPath, "utf-8"),
    fs.readFile(navigationPath, "utf-8"),
  ]);
  const shadowArtifact = JSON.parse(shadowArtifactText);
  const navigationEvidence = JSON.parse(navigationEvidenceText);
  const eventsText = await readArtifactRef(input.shadowRoot, shadowArtifact.artifacts?.events, "events");
  const preflightText = await readArtifactRef(
    input.shadowRoot,
    shadowArtifact.artifacts?.preflight,
    "preflight",
  );
  const repositoryPreflightText = await readArtifactRef(
    input.shadowRoot,
    shadowArtifact.artifacts?.repositorySnapshotPreflight,
    "repositorySnapshotPreflight",
  );
  return {
    platform: input.platform,
    shadowArtifact,
    shadowArtifactText,
    navigationEvidence,
    navigationEvidenceText,
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

export async function writeNavigationShadowAnalysisArtifact(outputRoot, artifact) {
  const resolved = path.resolve(requireString(outputRoot, "outputRoot"));
  await assertPathAbsent(resolved, "output root");
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.mkdir(resolved);
  await fs.writeFile(
    path.join(resolved, "navigation-shadow-analysis.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
    { encoding: "utf-8", flag: "wx" },
  );
}

export function parseNavigationShadowAnalysisCliArguments(argv) {
  const supported = new Set([
    "windows-shadow-root",
    "windows-navigation-root",
    "wsl-shadow-root",
    "wsl-navigation-root",
    "output-root",
    "generated-at",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Invalid navigation shadow analysis argument near ${String(flag ?? "<end>")}.`);
    }
    const name = flag.slice(2);
    if (!supported.has(name)) {
      throw new Error(`Unknown navigation shadow analysis argument: ${flag}.`);
    }
    if (values.has(name)) throw new Error(`${flag} may only be provided once.`);
    values.set(name, value);
  }
  return {
    windowsShadowRoot: requireString(values.get("windows-shadow-root"), "--windows-shadow-root"),
    windowsNavigationRoot: requireString(
      values.get("windows-navigation-root"),
      "--windows-navigation-root",
    ),
    wslShadowRoot: requireString(values.get("wsl-shadow-root"), "--wsl-shadow-root"),
    wslNavigationRoot: requireString(
      values.get("wsl-navigation-root"),
      "--wsl-navigation-root",
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
  if (left !== right) throw new Error(`Navigation shadow analysis ${label} drifted across platforms.`);
}

function assertDisjointRoots(left, right, leftLabel, rightLabel) {
  const relative = path.relative(left, right);
  const reverse = path.relative(right, left);
  if (!relative || !reverse || (!relative.startsWith("..") && !path.isAbsolute(relative))
    || (!reverse.startsWith("..") && !path.isAbsolute(reverse))) {
    throw new Error(`Navigation shadow analysis ${leftLabel} must be disjoint from ${rightLabel}.`);
  }
}

async function assertDirectory(target, label) {
  const stats = await fs.stat(target).catch(() => null);
  if (!stats?.isDirectory()) throw new Error(`Navigation shadow analysis ${label} must be a directory.`);
}

async function assertPathAbsent(target, label) {
  const stats = await fs.lstat(target).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (stats) throw new Error(`Navigation shadow analysis ${label} already exists.`);
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
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function requireNonNegativeNumber(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative number.`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Navigation shadow analysis requires ${label}.`);
  }
  return value.trim();
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Navigation shadow analysis requires ${label}.`);
  }
  return value;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Navigation shadow analysis requires ${label}.`);
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`Navigation shadow analysis requires ${label}.`);
  return value;
}

function increaseRatio(baseline, candidate) {
  return baseline <= 0 ? 0 : round((candidate - baseline) / baseline);
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
  const artifact = await runNavigationShadowAnalysis(
    parseNavigationShadowAnalysisCliArguments(process.argv.slice(2)),
  );
  console.log(
    `[coding-agent-navigation-shadow-analysis] ${artifact.decision.status}; `
    + `costCny=${artifact.crossPlatform.totalObservedCostCny}`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(scriptPath)) {
  main().catch((error) => {
    console.error(`[coding-agent-navigation-shadow-analysis] failed: ${safeMessage(error)}`);
    process.exitCode = 1;
  });
}
