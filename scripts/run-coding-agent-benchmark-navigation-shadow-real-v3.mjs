import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadCodingAgentBenchmarkV3RepositoryInputs,
  runStage0BSuite,
} from "./run-coding-agent-benchmark.mjs";
import {
  buildNavigationCandidateV3Profile,
  CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_ID,
  CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_VERSION,
} from "./run-coding-agent-benchmark-navigation-candidate-v3.mjs";
import {
  buildRepositorySnapshotIdentity,
} from "./run-coding-agent-benchmark-navigation-shadow-real.mjs";

export const CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_REAL_V3_VERSION =
  "coding-agent-benchmark-navigation-shadow-real-v3/v1";

const TASK_ID = "real-js.bug-fix";
const ANALYSIS_VERSION = "coding-agent-benchmark-navigation-shadow-v2-analysis/v1";
const PREVIOUS_CANDIDATE_VERSION = "coding-agent-benchmark-navigation-candidate-v2/v1";
const PREVIOUS_SHADOW_VERSION = "coding-agent-benchmark-navigation-shadow-real-v2/v1";
const NAVIGATION_VERSION = "coding-agent-benchmark-navigation-efficiency/v1";
const MANIFEST_VERSION = "coding-agent-benchmark-manifest/v3";
const STRATEGY_ID = "bounded-navigation-runtime-contract/v1";
const REGRESSION_TEST_PATH = "test/benchmark-v3/real-js-bug-fix.js";
const TARGET_PATH = "lib/request.js";
const EXCHANGE_RATE_CNY_PER_USD = 8;
const PRICING_CNY_PER_1M = Object.freeze({
  cacheReadInput: 0.02,
  uncachedInput: 1,
  output: 2,
});
const SUPPORTED_PLATFORMS = new Set(["windows-native", "wsl2-linux"]);
const scriptPath = fileURLToPath(import.meta.url);
const defaultSourceRoot = path.resolve(path.dirname(scriptPath), "..");

export function buildNavigationShadowRealV3Artifact(input) {
  const platform = requirePlatform(input?.platform);
  const generatedAt = requireIsoTimestamp(input?.generatedAt);
  const provider = requireString(input?.provider, "provider");
  const modelId = requireString(input?.modelId, "modelId");
  const maxTotalCostCny = requireCost(input?.maxTotalCostCny, "maxTotalCostCny");
  const priorObservedCostCny = requireCost(input?.priorObservedCostCny, "priorObservedCostCny");
  const manifest = requireObject(input?.manifest, "v3 manifest");
  const manifestText = requireText(input?.manifestText, "v3 manifest text");
  const candidateEvidence = requireObject(input?.candidateEvidence, "candidate v3 evidence");
  const candidateEvidenceText = requireText(
    input?.candidateEvidenceText,
    "candidate v3 evidence text",
  );
  const analysisText = requireText(input?.analysisText, "P0.24 analysis text");
  const previousCandidateEvidenceText = requireText(
    input?.previousCandidateEvidenceText,
    "P0.22 candidate evidence text",
  );
  const previousShadowArtifactText = requireText(
    input?.previousShadowArtifactText,
    "P0.23 shadow artifact text",
  );
  const navigationEvidence = requireObject(input?.navigationEvidence, "navigation evidence");
  const navigationEvidenceText = requireText(
    input?.navigationEvidenceText,
    "navigation evidence text",
  );
  const report = requireObject(input?.report, "execution report");
  const run = requireSingleRun(report);
  const codingCiManifest = requireObject(input?.codingCiManifest, "Coding CI manifest");
  const events = requireArray(input?.events, "run events");
  const artifactRefs = requireObject(input?.artifactRefs, "artifact references");
  const promptText = requireText(input?.promptText, "rendered prompt text");

  assertParsedTextMatches(manifest, manifestText, "v3 manifest");
  assertParsedTextMatches(candidateEvidence, candidateEvidenceText, "candidate v3 evidence");
  const analysis = parseJsonText(analysisText, "P0.24 analysis");
  const previousCandidateEvidence = parseJsonText(
    previousCandidateEvidenceText,
    "P0.22 candidate evidence",
  );
  const previousShadowArtifact = parseJsonText(
    previousShadowArtifactText,
    "P0.23 shadow artifact",
  );
  validateCandidateEvidence({
    platform,
    manifest,
    manifestText,
    candidateEvidence,
    candidateEvidenceText,
    analysis,
    analysisText,
    previousCandidateEvidence,
    previousCandidateEvidenceText,
    previousShadowArtifact,
    previousShadowArtifactText,
    navigationEvidence,
    navigationEvidenceText,
    report,
  });

  const baselineManifestText = requireText(input?.baselineManifestText, "baseline manifest text");
  const baselineEventsText = requireText(input?.baselineEventsText, "baseline events text");
  const baselineRepositorySnapshotReceiptText = requireText(
    input?.baselineRepositorySnapshotReceiptText,
    "historical repository snapshot receipt text",
  );
  const repositorySnapshotReceiptText = requireText(
    input?.repositorySnapshotReceiptText,
    "repository snapshot receipt text",
  );
  validateBaselineEvidence({
    candidateEvidence,
    navigationEvidence,
    baselineManifestText,
    baselineEventsText,
  });
  const baselineSnapshotIdentity = buildRepositorySnapshotIdentity(
    baselineRepositorySnapshotReceiptText,
    "historical repository snapshot receipt",
  );
  const candidateSnapshotIdentity = buildRepositorySnapshotIdentity(
    repositorySnapshotReceiptText,
    "repository snapshot receipt",
  );
  const baselineSnapshotIdentitySha256 = sha256(JSON.stringify(baselineSnapshotIdentity));
  if (JSON.stringify(baselineSnapshotIdentity) !== JSON.stringify(candidateSnapshotIdentity)
    || baselineSnapshotIdentitySha256
      !== candidateEvidence.source?.repositorySnapshotIdentitySha256) {
    throw new Error("Navigation shadow real v3 repository snapshot identity drifted.");
  }

  if (run.taskId !== TASK_ID || run.platform !== platform || run.attempt !== 1) {
    throw new Error("Navigation shadow real v3 must contain one attempt-1 real-js.bug-fix result.");
  }
  if (run.environment?.model?.id !== modelId
    || run.environment?.model?.provider !== provider
    || run.environment?.model?.credentialsConfigured !== true) {
    throw new Error("Navigation shadow real v3 model authorization drifted.");
  }
  if (codingCiManifest.mode !== "workspace-write"
    || codingCiManifest.profileCandidateId
      !== CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_ID) {
    throw new Error("Coding CI did not execute the authorized navigation candidate v3.");
  }
  if (run.usage?.observation?.status !== "provider_reported"
    || !Number.isFinite(run.usage.observation.costUsd)
    || run.usage.observation.costUsd < 0) {
    throw new Error("Navigation shadow real v3 requires provider-reported usage and cost.");
  }

  const runCostCny = round(run.usage.observation.costUsd * EXCHANGE_RATE_CNY_PER_USD);
  if (priorObservedCostCny + runCostCny > maxTotalCostCny + 1e-8) {
    throw new Error("Navigation shadow real v3 exceeded the authorized total CNY cost.");
  }

  const startedTools = events
    .filter((event) => event?.type === "tool.started")
    .map((event) => ({
      id: event?.payload?.tool?.id,
      name: event?.payload?.tool?.name,
      arguments: event?.payload?.tool?.arguments ?? {},
    }))
    .filter((tool) => typeof tool.name === "string" && tool.name);
  if (startedTools.some((tool) => tool.name === "run_command")) {
    throw new Error("Navigation shadow candidate v3 invoked the denied run_command tool.");
  }
  const completedTools = events
    .filter((event) => event?.type === "tool.completed")
    .map((event) => event?.payload?.tool)
    .filter((tool) => tool && typeof tool.name === "string");
  const usageEvent = events.filter((event) => event?.type === "run.usage").at(-1);
  const modelCalls = normalizeNonNegativeInteger(usageEvent?.payload?.usage?.modelCalls, 0);
  const changedPaths = requireArray(codingCiManifest.changedPaths, "Coding CI changed paths");
  const totalTokens = nullableSum(run.usage?.inputTokens, run.usage?.outputTokens);
  const baseline = requireObject(navigationEvidence.baseline, "navigation baseline");
  const renderedPromptSha256 = sha256(promptText.trimEnd());
  if (renderedPromptSha256 !== candidateEvidence.prompt?.renderedPromptSha256) {
    throw new Error("Navigation shadow real v3 rendered prompt hash drifted.");
  }
  const runtimeContract = analyzeRuntimeContract(startedTools, completedTools);
  const candidateFixtureBaselineCommit = requireSha1(
    run.fixture?.baselineCommit,
    "candidate fixture baseline commit",
  );

  return {
    schemaVersion: CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_REAL_V3_VERSION,
    generatedAt,
    status: "completed",
    taskId: TASK_ID,
    platform,
    candidate: structuredClone(candidateEvidence.candidate),
    authorization: {
      status: "confirmed",
      provider,
      modelId,
      maxTotalCostCny,
      priorObservedCostCny,
      runCostCny,
      remainingCostCny: round(Math.max(0, maxTotalCostCny - priorObservedCostCny - runCostCny)),
      credentialsConfigured: true,
      exchangeRateCnyPerUsd: EXCHANGE_RATE_CNY_PER_USD,
      pricingCnyPer1M: { ...PRICING_CNY_PER_1M },
    },
    execution: {
      mode: "real-provider-shadow",
      baseProfile: "workspace-write",
      manifestModified: false,
      v3AggregateEligible: false,
      maxCostUsd: round((maxTotalCostCny - priorObservedCostCny) / EXCHANGE_RATE_CNY_PER_USD),
      modelCalls,
      toolCallCount: startedTools.length,
      toolCompletedCount: completedTools.length,
      hostCommandToolCalls: 0,
      toolNames: [...new Set(startedTools.map((tool) => tool.name))].sort(),
      enteredEditPhase: startedTools.some((tool) => [
        "file_edit", "apply_patch", "file_write", "file_delete",
      ].includes(tool.name)),
      budgetExhausted: events.some((event) => event?.type === "run.budget_exhausted"),
      terminalType: requireTerminalType(events),
    },
    runtimeContract: {
      strategyId: STRATEGY_ID,
      enforcement: "runtime_contract",
      runtimeToolGuard: true,
      promptHashMatched: true,
      ...runtimeContract,
    },
    outcome: {
      runId: run.runId,
      status: run.status,
      failureCategory: run.failureCategory ?? null,
      evaluation: structuredClone(run.evaluation),
      inputTokens: run.usage.inputTokens,
      outputTokens: run.usage.outputTokens,
      totalTokens,
      costUsd: run.usage.observation.costUsd,
      changedPaths: [...changedPaths],
    },
    comparison: {
      baseline: {
        runId: baseline.runId,
        status: "failed",
        inputTokens: baseline.inputTokens,
        outputTokens: baseline.outputTokens,
        totalTokens: baseline.totalTokens,
        modelCalls: baseline.modelCalls,
        toolCallCount: baseline.toolCallCount,
        changedFileCount: baseline.changedFileCount,
        budgetExhausted: baseline.budgetExhausted,
      },
      candidate: {
        status: run.status,
        inputTokens: run.usage.inputTokens,
        outputTokens: run.usage.outputTokens,
        totalTokens,
        modelCalls,
        toolCallCount: startedTools.length,
        changedFileCount: changedPaths.length,
        budgetExhausted: events.some((event) => event?.type === "run.budget_exhausted"),
      },
      totalTokenDelta: totalTokens === null ? null : totalTokens - baseline.totalTokens,
      taskOutcomeImproved: run.status === "passed" && baseline.changedFileCount === 0,
      tokenImpact: {
        status: totalTokens === null ? "unavailable" : "measured",
        source: "provider_reported",
      },
    },
    source: {
      candidateEvidenceSha256: sha256(candidateEvidenceText),
      analysisSha256: sha256(analysisText),
      previousCandidateEvidenceSha256: sha256(previousCandidateEvidenceText),
      previousShadowArtifactSha256: sha256(previousShadowArtifactText),
      navigationEvidenceSha256: sha256(navigationEvidenceText),
      manifestSha256: candidateEvidence.source.manifestSha256,
      baselineCommit: candidateEvidence.source.baselineCommit,
      candidateFixtureBaselineCommit,
      baselineRunId: navigationEvidence.source.baselineRunId,
      repositorySnapshotIdentitySha256: baselineSnapshotIdentitySha256,
      executionReportSha256: requireSha256(
        input?.executionReportSha256,
        "executionReportSha256",
      ),
      renderedPromptSha256,
    },
    artifacts: cloneArtifactRefs(artifactRefs),
    diagnostics: [],
  };
}
export async function runNavigationShadowRealV3(input, dependencies = {}) {
  const platform = requirePlatform(input?.platform);
  const sourceRoot = path.resolve(requireString(input?.sourceRoot, "sourceRoot"));
  const candidateEvidenceRoot = path.resolve(
    requireString(input?.candidateEvidenceRoot, "candidateEvidenceRoot"),
  );
  const analysisRoot = path.resolve(requireString(input?.analysisRoot, "analysisRoot"));
  const previousShadowRoot = path.resolve(
    requireString(input?.previousShadowRoot, "previousShadowRoot"),
  );
  const previousCandidateRoot = path.resolve(
    requireString(input?.previousCandidateRoot, "previousCandidateRoot"),
  );
  const navigationEvidenceRoot = path.resolve(
    requireString(input?.navigationEvidenceRoot, "navigationEvidenceRoot"),
  );
  const baselineRunRoot = path.resolve(requireString(input?.baselineRunRoot, "baselineRunRoot"));
  const repositoryConfig = path.resolve(requireString(input?.repositoryConfig, "repositoryConfig"));
  const fixtureRoot = path.resolve(requireString(input?.fixtureRoot, "fixtureRoot"));
  const stateRoot = path.resolve(requireString(input?.stateRoot, "stateRoot"));
  const outputRoot = path.resolve(requireString(input?.outputRoot, "outputRoot"));
  const provider = requireString(input?.provider, "provider");
  const modelId = requireString(input?.modelId, "modelId");
  const maxTotalCostCny = requireCost(input?.maxTotalCostCny, "maxTotalCostCny");
  const priorObservedCostCny = requireCost(
    input?.priorObservedCostCny ?? 0,
    "priorObservedCostCny",
  );
  const finalizeExistingExecution = input?.finalizeExistingExecution === true;
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  if (priorObservedCostCny >= maxTotalCostCny) {
    throw new Error("Prior observed cost must remain below the authorized total cost.");
  }
  if (finalizeExistingExecution) {
    await assertDirectory(outputRoot, "existing output root");
    await assertPathAbsent(
      path.join(outputRoot, "navigation-shadow-real-v3.json"),
      "real shadow v3 artifact",
    );
  } else {
    await assertPathAbsent(outputRoot, "output root");
  }
  for (const [target, label] of [
    [sourceRoot, "sourceRoot"],
    [candidateEvidenceRoot, "candidateEvidenceRoot"],
    [analysisRoot, "analysisRoot"],
    [previousCandidateRoot, "previousCandidateRoot"],
    [previousShadowRoot, "previousShadowRoot"],
    [navigationEvidenceRoot, "navigationEvidenceRoot"],
    [baselineRunRoot, "baselineRunRoot"],
    [fixtureRoot, "fixtureRoot parent"],
    [stateRoot, "stateRoot"],
  ]) {
    await assertDirectory(target, label);
  }
  await assertFile(repositoryConfig, "repositoryConfig");

  const paths = {
    manifest: path.join(sourceRoot, "benchmarks", "coding-agent", "v3", "task-manifest.json"),
    candidateEvidence: path.join(candidateEvidenceRoot, "navigation-candidate-v3.json"),
    analysis: path.join(analysisRoot, "navigation-shadow-v2-analysis.json"),
    previousCandidateEvidence: path.join(previousCandidateRoot, "navigation-candidate-v2.json"),
    previousShadowArtifact: path.join(previousShadowRoot, "navigation-shadow-real-v2.json"),
    navigationEvidence: path.join(navigationEvidenceRoot, "navigation-efficiency.json"),
    baselineManifest: path.join(baselineRunRoot, "manifest.json"),
    baselineEvents: path.join(baselineRunRoot, "events.jsonl"),
    baselineReceipt: path.join(baselineRunRoot, "repository-snapshot-receipt.json"),
  };
  const sourceTexts = Object.fromEntries(await Promise.all(Object.entries(paths).map(
    async ([name, target]) => [name, await fs.readFile(target, "utf-8")],
  )));
  const candidateEvidence = JSON.parse(sourceTexts.candidateEvidence);
  if (candidateEvidence.platform !== platform) {
    throw new Error("Navigation shadow real v3 candidate evidence platform drifted.");
  }

  const loadRepositoryInputs = dependencies.loadRepositoryInputs
    ?? loadCodingAgentBenchmarkV3RepositoryInputs;
  const runSuite = dependencies.runSuite ?? runStage0BSuite;
  const executionRoot = path.join(outputRoot, "execution");
  const report = finalizeExistingExecution
    ? JSON.parse(await fs.readFile(path.join(executionRoot, "benchmark-report.json"), "utf-8"))
    : await runSuite({
      platform,
      manifestRevision: "v3",
      sourceRoot,
      fixtureRoot,
      ...(input.gatewayFixtureRoot ? {
        gatewayFixtureRoot: requireString(input.gatewayFixtureRoot, "gatewayFixtureRoot"),
      } : {}),
      artifactRoot: executionRoot,
      stateRoot,
      attempt: 1,
      taskIds: [TASK_ID],
      v3RepositoryInputs: await loadRepositoryInputs(repositoryConfig),
      model: { provider, id: modelId, credentialsConfigured: true },
      priorObservedCostUsd: round(priorObservedCostCny / EXCHANGE_RATE_CNY_PER_USD),
      maxTotalCostUsd: round(maxTotalCostCny / EXCHANGE_RATE_CNY_PER_USD),
      shadowCandidateId: CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_ID,
      generatedAt,
    });

  const run = requireSingleRun(report);
  const runRoot = path.join(executionRoot, run.runId);
  const artifactPaths = {
    executionReport: path.join(executionRoot, "benchmark-report.json"),
    taskManifest: path.join(executionRoot, "task-manifest.json"),
    events: path.join(runRoot, "events.jsonl"),
    patch: path.join(runRoot, "changes.patch"),
    result: path.join(runRoot, "result.json"),
    codingCiManifest: path.join(runRoot, "coding-ci-manifest.json"),
    prompt: path.join(runRoot, "prompt.md"),
    preflight: path.join(runRoot, "preflight.json"),
    repositorySnapshotPreflight: path.join(runRoot, "repository-snapshot-preflight.json"),
    repositorySnapshotReceipt: path.join(runRoot, "repository-snapshot-receipt.json"),
  };
  const contents = Object.fromEntries(await Promise.all(Object.entries(artifactPaths).map(
    async ([name, target]) => [name, await fs.readFile(target, "utf-8")],
  )));
  const artifactRefs = Object.fromEntries(Object.entries(artifactPaths).map(([name, target]) => [
    name,
    {
      path: path.relative(outputRoot, target).replaceAll(path.sep, "/"),
      sha256: sha256(contents[name]),
    },
  ]));
  const artifact = buildNavigationShadowRealV3Artifact({
    platform,
    generatedAt: finalizeExistingExecution
      ? requireIsoTimestamp(report.generatedAt)
      : generatedAt,
    provider,
    modelId,
    maxTotalCostCny,
    priorObservedCostCny,
    manifest: JSON.parse(sourceTexts.manifest),
    manifestText: sourceTexts.manifest,
    candidateEvidence,
    candidateEvidenceText: sourceTexts.candidateEvidence,
    analysisText: sourceTexts.analysis,
    previousCandidateEvidenceText: sourceTexts.previousCandidateEvidence,
    previousShadowArtifactText: sourceTexts.previousShadowArtifact,
    navigationEvidence: JSON.parse(sourceTexts.navigationEvidence),
    navigationEvidenceText: sourceTexts.navigationEvidence,
    baselineManifestText: sourceTexts.baselineManifest,
    baselineEventsText: sourceTexts.baselineEvents,
    baselineRepositorySnapshotReceiptText: sourceTexts.baselineReceipt,
    repositorySnapshotReceiptText: contents.repositorySnapshotReceipt,
    promptText: contents.prompt,
    report,
    executionReportSha256: sha256(contents.executionReport),
    codingCiManifest: JSON.parse(contents.codingCiManifest),
    events: parseJsonLines(contents.events),
    artifactRefs,
  });
  await fs.writeFile(
    path.join(outputRoot, "navigation-shadow-real-v3.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
    { encoding: "utf-8", flag: "wx" },
  );
  return artifact;
}

export function parseNavigationShadowRealV3CliArguments(argv) {
  const values = parseNamedArguments(argv);
  return {
    platform: requirePlatform(values.get("platform")),
    sourceRoot: values.get("source-root") ?? defaultSourceRoot,
    candidateEvidenceRoot: requireString(
      values.get("candidate-evidence-root"),
      "--candidate-evidence-root",
    ),
    analysisRoot: requireString(values.get("analysis-root"), "--analysis-root"),
    previousCandidateRoot: requireString(
      values.get("previous-candidate-root"),
      "--previous-candidate-root",
    ),
    previousShadowRoot: requireString(
      values.get("previous-shadow-root"),
      "--previous-shadow-root",
    ),
    navigationEvidenceRoot: requireString(
      values.get("navigation-evidence-root"),
      "--navigation-evidence-root",
    ),
    baselineRunRoot: requireString(values.get("baseline-run-root"), "--baseline-run-root"),
    repositoryConfig: requireString(values.get("repository-config"), "--repository-config"),
    fixtureRoot: requireString(values.get("fixture-root"), "--fixture-root"),
    ...(values.has("gateway-fixture-root") ? {
      gatewayFixtureRoot: requireString(values.get("gateway-fixture-root"), "--gateway-fixture-root"),
    } : {}),
    stateRoot: requireString(values.get("state-root"), "--state-root"),
    outputRoot: requireString(values.get("output-root"), "--output-root"),
    provider: requireString(values.get("provider"), "--provider"),
    modelId: requireString(values.get("model-id"), "--model-id"),
    maxTotalCostCny: requireCost(values.get("max-total-cost-cny"), "--max-total-cost-cny"),
    priorObservedCostCny: requireCost(
      values.get("prior-observed-cost-cny") ?? 0,
      "--prior-observed-cost-cny",
    ),
    finalizeExistingExecution: values.has("finalize-existing-execution")
      ? requireBoolean(values.get("finalize-existing-execution"), "--finalize-existing-execution")
      : false,
    ...(values.has("generated-at") ? {
      generatedAt: requireIsoTimestamp(values.get("generated-at")),
    } : {}),
  };
}

function validateCandidateEvidence(input) {
  const {
    platform,
    manifest,
    manifestText,
    candidateEvidence,
    analysis,
    analysisText,
    previousCandidateEvidence,
    previousCandidateEvidenceText,
    previousShadowArtifact,
    previousShadowArtifactText,
    navigationEvidence,
    navigationEvidenceText,
    report,
  } = input;
  const expectedProfile = buildNavigationCandidateV3Profile(manifest);
  if (manifest.schemaVersion !== MANIFEST_VERSION
    || candidateEvidence.schemaVersion !== CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_VERSION
    || candidateEvidence.status !== "eligible_for_shadow_readiness"
    || candidateEvidence.platform !== platform
    || candidateEvidence.taskId !== TASK_ID
    || JSON.stringify(candidateEvidence.candidate) !== JSON.stringify(expectedProfile)
    || candidateEvidence.candidate?.id !== CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_ID
    || candidateEvidence.candidate?.manifestModified !== false
    || candidateEvidence.candidate?.toolArgumentPolicy !== "bounded-navigation-v1"
    || candidateEvidence.candidate?.strategy?.id !== STRATEGY_ID
    || candidateEvidence.candidate?.strategy?.enforcement !== "runtime_contract"
    || candidateEvidence.candidate?.strategy?.runtimeToolGuard !== true
    || candidateEvidence.execution?.mode !== "offline-runtime-replay"
    || candidateEvidence.execution?.modelCalls !== 0
    || candidateEvidence.execution?.providerCostUsd !== 0
    || candidateEvidence.execution?.networkCalls !== 0
    || candidateEvidence.execution?.hostCommandToolCalls !== 0
    || candidateEvidence.execution?.manifestModified !== false
    || candidateEvidence.execution?.v3AggregateModified !== false
    || candidateEvidence.decision?.status !== "eligible_for_shadow_readiness"
    || candidateEvidence.decision?.requiresNewProviderAuthorization !== true
    || candidateEvidence.decision?.tokenUpliftClaimed !== false) {
    throw new Error("Navigation shadow real v3 requires eligible candidate v3 evidence.");
  }
  if (analysis.schemaVersion !== ANALYSIS_VERSION
    || analysis.status !== "completed"
    || analysis.decision?.status !== "do_not_promote"
    || analysis.decision?.nextCandidate !== "navigation-candidate-v3-runtime-contract-required"
    || previousCandidateEvidence.schemaVersion !== PREVIOUS_CANDIDATE_VERSION
    || previousCandidateEvidence.platform !== platform
    || previousShadowArtifact.schemaVersion !== PREVIOUS_SHADOW_VERSION
    || previousShadowArtifact.platform !== platform
    || navigationEvidence.schemaVersion !== NAVIGATION_VERSION
    || navigationEvidence.status !== "eligible_for_canary"
    || navigationEvidence.platform !== platform) {
    throw new Error("Navigation shadow real v3 historical evidence versions drifted.");
  }
  if (candidateEvidence.source?.analysisSha256 !== sha256(analysisText)
    || candidateEvidence.source?.candidateV2EvidenceSha256
      !== sha256(previousCandidateEvidenceText)
    || candidateEvidence.source?.shadowV2ArtifactSha256 !== sha256(previousShadowArtifactText)) {
    throw new Error("Navigation shadow real v3 historical source hashes drifted.");
  }
  const manifestSha256 = sha256(manifestText);
  if (candidateEvidence.source?.manifestSha256 !== manifestSha256
    || report.suite?.manifestSha256 !== manifestSha256) {
    throw new Error("Navigation shadow real v3 frozen manifest binding drifted.");
  }
  if (candidateEvidence.prompt?.strategyId !== STRATEGY_ID
    || candidateEvidence.prompt?.enforcement !== "runtime_contract"
    || candidateEvidence.prompt?.runtimeToolGuard !== true
    || candidateEvidence.prompt?.toolArgumentPolicy !== "bounded-navigation-v1"
    || !isSha256(candidateEvidence.prompt?.contractSha256)
    || !isSha256(candidateEvidence.prompt?.renderedPromptSha256)) {
    throw new Error("Navigation shadow real v3 prompt evidence drifted.");
  }
}

function validateBaselineEvidence(input) {
  const {
    candidateEvidence,
    navigationEvidence,
    baselineManifestText,
    baselineEventsText,
  } = input;
  if (sha256(baselineManifestText) !== navigationEvidence.source?.baselineManifestSha256
    || sha256(baselineEventsText) !== navigationEvidence.source?.baselineEventsSha256) {
    throw new Error("Navigation shadow real v3 historical baseline hashes do not match evidence.");
  }
  const baselineManifest = parseJsonText(baselineManifestText, "historical baseline manifest");
  if (baselineManifest.runId !== navigationEvidence.source?.baselineRunId
    || baselineManifest.taskId !== navigationEvidence.source?.baselineTaskId
    || baselineManifest.taskId !== TASK_ID
    || baselineManifest.fixture?.baselineCommit !== navigationEvidence.source?.baselineCommit
    || candidateEvidence.source?.baselineCommit !== navigationEvidence.source?.baselineCommit) {
    throw new Error("Navigation shadow real v3 historical baseline identity drifted.");
  }
}

function analyzeRuntimeContract(tools, completedTools) {
  const normalized = tools.map((tool) => ({
    name: tool.name,
    arguments: requireObjectOrEmpty(tool.arguments),
  }));
  const globIndexes = new Map();
  normalized.forEach((tool, index) => {
    if (tool.name !== "file_glob") return;
    const includes = Array.isArray(tool.arguments.include)
      ? tool.arguments.include
      : [tool.arguments.include];
    for (const include of includes) {
      if ([REGRESSION_TEST_PATH, "lib/**/*.js"].includes(include)) {
        globIndexes.set(include, index);
      }
    }
  });
  const regressionReadIndex = normalized.findIndex((tool) =>
    tool.name === "file_read" && normalizeToolPath(tool.arguments.path) === REGRESSION_TEST_PATH);
  const boundedSearchIndex = normalized.findIndex((tool) =>
    tool.name === "text_search"
    && normalizeToolPath(tool.arguments.path) === "lib"
    && tool.arguments.glob === "**/*.js"
    && Number(tool.arguments.maxResults) === 4
    && Number(tool.arguments.contextLines) === 5);
  const implementationReadIndexes = normalized
    .map((tool, index) => ({ tool, index }))
    .filter(({ tool }) => tool.name === "file_read"
      && normalizeToolPath(tool.arguments.path).startsWith("lib/"))
    .map(({ index }) => index);
  const firstImplementationReadIndex = implementationReadIndexes[0] ?? -1;
  const latestRequiredGlobIndex = Math.max(
    globIndexes.get(REGRESSION_TEST_PATH) ?? -1,
    globIndexes.get("lib/**/*.js") ?? -1,
  );
  const fileGlobBeforeSourceRead = globIndexes.size === 2
    && latestRequiredGlobIndex < regressionReadIndex;
  const firstSourceInspectionIndex = [boundedSearchIndex, firstImplementationReadIndex]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0] ?? -1;
  const regressionTestReadBeforeSourceInspection = regressionReadIndex >= 0
    && firstSourceInspectionIndex >= 0
    && regressionReadIndex < firstSourceInspectionIndex;
  const fullTargetReadBeforeLocalization = normalized.some((tool, index) =>
    tool.name === "file_read"
    && normalizeToolPath(tool.arguments.path) === TARGET_PATH
    && (boundedSearchIndex < 0 || index < boundedSearchIndex));
  const fileReadCounts = new Map();
  for (const tool of normalized) {
    if (tool.name !== "file_read") continue;
    const readPath = normalizeToolPath(tool.arguments.path);
    if (readPath) fileReadCounts.set(readPath, (fileReadCounts.get(readPath) ?? 0) + 1);
  }
  const repeatedCompleteFileReadCount = [...fileReadCounts.values()]
    .reduce((total, count) => total + Math.max(0, count - 1), 0);
  const boundedTextSearchObserved = boundedSearchIndex >= 0;
  const completionsById = new Map(completedTools.map((tool) => [tool.id, tool]));
  const globCalls = tools.filter((tool) => tool.name === "file_glob");
  const globResults = globCalls.map((tool) => ({
    tool,
    completion: completionsById.get(tool.id),
  }));
  const invalidGlobResults = globResults.filter(({ tool }) => {
    const include = tool.arguments?.include;
    return typeof include !== "string" || !include.trim() || isRootWideGlob(include);
  });
  const policyMetadataObserved = globResults.length > 0 && globResults.every(({ completion }) =>
    completion?.metadata?.argumentValidation?.toolArgumentPolicy === "bounded-navigation-v1");
  const invalidGlobCallsBlocked = invalidGlobResults.every(({ completion }) =>
    completion?.success === false
    && completion?.failureKind === "input_error"
    && completion?.metadata?.argumentValidation?.blocked === true);
  const cappedGlobCallCount = globResults.filter(({ tool, completion }) => {
    const maxResults = Number(tool.arguments?.maxResults);
    const needsCap = tool.arguments?.maxResults === undefined
      || !Number.isInteger(maxResults)
      || maxResults > 20;
    return needsCap
      && completion?.success === true
      && completion?.metadata?.argumentValidation?.corrected === true;
  }).length;
  const invalidGlobSucceeded = invalidGlobResults.some(({ completion }) => completion?.success === true);
  const navigationSequenceCompliant = fileGlobBeforeSourceRead
    && regressionTestReadBeforeSourceInspection
    && boundedTextSearchObserved
    && !fullTargetReadBeforeLocalization
    && repeatedCompleteFileReadCount === 0;
  return {
    toolArgumentPolicy: "bounded-navigation-v1",
    compliant: policyMetadataObserved && invalidGlobCallsBlocked && !invalidGlobSucceeded,
    policyMetadataObserved,
    invalidGlobCallsBlocked,
    invalidGlobCallCount: invalidGlobResults.length,
    blockedGlobCallCount: invalidGlobResults.filter(({ completion }) => completion?.success === false).length,
    cappedGlobCallCount,
    navigationSequenceCompliant,
    fileGlobBeforeSourceRead,
    regressionTestReadBeforeSourceInspection,
    boundedTextSearchObserved,
    fullTargetReadBeforeLocalization,
    repeatedCompleteFileReadCount,
    toolSequence: normalized.map((tool) => tool.name),
  };
}

function isRootWideGlob(value) {
  return ["*", "**", "**/*"].includes(String(value).trim().replaceAll("\\", "/"));
}

function cloneArtifactRefs(refs) {
  const required = [
    "executionReport",
    "taskManifest",
    "events",
    "patch",
    "result",
    "codingCiManifest",
    "prompt",
    "preflight",
    "repositorySnapshotPreflight",
    "repositorySnapshotReceipt",
  ];
  const result = {};
  for (const name of required) {
    const ref = requireObject(refs[name], `artifact ${name}`);
    result[name] = {
      path: requireRelativePath(ref.path, `${name}.path`),
      sha256: requireSha256(ref.sha256, `${name}.sha256`),
    };
  }
  if (Object.keys(refs).length !== required.length) {
    throw new Error("Navigation shadow real v3 artifact references contain unknown entries.");
  }
  return result;
}

function parseNamedArguments(argv) {
  const supported = new Set([
    "platform",
    "source-root",
    "candidate-evidence-root",
    "analysis-root",
    "previous-candidate-root",
    "previous-shadow-root",
    "navigation-evidence-root",
    "baseline-run-root",
    "repository-config",
    "fixture-root",
    "gateway-fixture-root",
    "state-root",
    "output-root",
    "provider",
    "model-id",
    "max-total-cost-cny",
    "prior-observed-cost-cny",
    "finalize-existing-execution",
    "generated-at",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(
        `Invalid navigation shadow real v3 argument near ${String(flag ?? "<end>")}.`,
      );
    }
    const key = flag.slice(2);
    if (!supported.has(key)) {
      throw new Error(`Unknown navigation shadow real v3 argument: ${flag}.`);
    }
    if (values.has(key)) throw new Error(`${flag} may only be provided once.`);
    values.set(key, value);
  }
  return values;
}

function parseJsonText(text, label) {
  try {
    return JSON.parse(requireText(text, `${label} text`));
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${safeMessage(error)}`);
  }
}

function assertParsedTextMatches(value, text, label) {
  if (JSON.stringify(value) !== JSON.stringify(parseJsonText(text, label))) {
    throw new Error(`Navigation shadow real v3 ${label} object does not match its text.`);
  }
}

function parseJsonLines(text) {
  return text.split(/\r?\n/u).filter((line) => line.trim()).map((line) => JSON.parse(line));
}

async function assertDirectory(target, label) {
  const stats = await fs.stat(target).catch(() => null);
  if (!stats?.isDirectory()) {
    throw new Error(`Navigation shadow real v3 ${label} must be a directory.`);
  }
}

async function assertFile(target, label) {
  const stats = await fs.stat(target).catch(() => null);
  if (!stats?.isFile()) throw new Error(`Navigation shadow real v3 ${label} must be a file.`);
}

async function assertPathAbsent(target, label) {
  const stats = await fs.lstat(target).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (stats) throw new Error(`Navigation shadow real v3 ${label} already exists.`);
}

function requireSingleRun(report) {
  if (!Array.isArray(report?.runs) || report.runs.length !== 1) {
    throw new Error("Navigation shadow real v3 execution report must contain exactly one run.");
  }
  return report.runs[0];
}

function requireTerminalType(events) {
  const type = events.at(-1)?.type;
  if (!["run.completed", "run.failed", "run.cancelled", "run.interrupted"].includes(type)) {
    throw new Error("Navigation shadow real v3 events require one terminal event.");
  }
  return type;
}

function requirePlatform(value) {
  const platform = requireString(value, "platform");
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error("Navigation shadow real v3 platform must be windows-native or wsl2-linux.");
  }
  return platform;
}

function requireCost(value, label) {
  const cost = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(cost) || cost < 0 || cost > 30) {
    throw new Error(`${label} must be between 0 and 30 CNY.`);
  }
  return round(cost);
}

function requireBoolean(value, label) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${label} must be true or false.`);
}

function requireIsoTimestamp(value) {
  const timestamp = requireString(value, "generatedAt");
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error("generatedAt must be an ISO timestamp.");
  }
  return timestamp;
}

function requireRelativePath(value, label) {
  const relative = requireString(value, label);
  if (relative.includes("\\") || relative.startsWith("/") || /^[A-Za-z]:\//u.test(relative)
    || relative.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${label} must be a contained relative path.`);
  }
  return relative;
}

function requireSha256(value, label) {
  const hash = requireString(value, label);
  if (!isSha256(hash)) throw new Error(`${label} must be a SHA-256.`);
  return hash;
}

function requireSha1(value, label) {
  const hash = requireString(value, label);
  if (!/^[a-f0-9]{40}$/u.test(hash)) throw new Error(`${label} must be a SHA-1.`);
  return hash;
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Navigation shadow real v3 requires ${label}.`);
  }
  return value.trim();
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Navigation shadow real v3 requires ${label}.`);
  }
  return value;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Navigation shadow real v3 requires ${label}.`);
  }
  return value;
}

function requireObjectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`Navigation shadow real v3 requires ${label}.`);
  return value;
}

function normalizeToolPath(value) {
  return typeof value === "string"
    ? value.trim().replaceAll("\\", "/").replace(/^\.\//u, "")
    : "";
}

function nullableSum(left, right) {
  return Number.isInteger(left) && Number.isInteger(right) ? left + right : null;
}

function normalizeNonNegativeInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
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
  const artifact = await runNavigationShadowRealV3(
    parseNavigationShadowRealV3CliArguments(process.argv.slice(2)),
  );
  console.log(
    `[coding-agent-navigation-shadow-real-v3] ${artifact.platform} ${artifact.outcome.status}; `
    + `costCny=${artifact.authorization.runCostCny}; compliant=${artifact.runtimeContract.compliant}`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(scriptPath)) {
  main().catch((error) => {
    console.error(`[coding-agent-navigation-shadow-real-v3] failed: ${safeMessage(error)}`);
    process.exitCode = 1;
  });
}
