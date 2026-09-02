import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CODING_AGENT_BENCHMARK_COMMAND_CONTROL_AGENT_PROFILE,
  hashCanonicalText,
} from "./coding-agent-benchmark-contract.mjs";
import {
  createBenchmarkPreflightArtifact,
} from "./coding-agent-benchmark-preflight.mjs";
import {
  STAGE_0D_BENCHMARK_USAGE_BUDGET_USD,
  loadCodingAgentBenchmarkV3RepositoryInputs,
  runStage0BSuite,
} from "./run-coding-agent-benchmark.mjs";
import {
  CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID,
  CODE_INTEL_AGENT_UPLIFT_GATE_SHA256,
  CODE_INTEL_AGENT_UPLIFT_TASK_IDS,
} from "./run-code-intel-agent-uplift-readiness.mjs";

export const CODE_INTEL_AGENT_UPLIFT_PLATFORM_VERSION =
  "code-intel-agent-uplift-platform/v1";
export const CODE_INTEL_AGENT_UPLIFT_REPORT_VERSION =
  "code-intel-agent-uplift-report/v1";
export const CODE_INTEL_AGENT_UPLIFT_COHORT_PREFLIGHT_VERSION =
  "code-intel-agent-uplift-cohort-preflight/v1";

const EXCHANGE_RATE_CNY_PER_USD = 8;
const NAVIGATION_TOOLS = new Set([
  "code_intel",
  "file_read",
  "list_files",
  "text_search",
  "file_glob",
]);
const MUTATION_TOOLS = new Set(["file_edit", "apply_patch", "file_write", "file_delete"]);
const SUPPORTED_PLATFORMS = new Set(["windows-native", "wsl2-linux"]);
const AUTHORIZED_PRICING_USD_PER_1M = new Map([
  ["BELLDANDY_MODEL_INPUT_USD_PER_1M", 0.125],
  ["BELLDANDY_MODEL_CACHE_READ_USD_PER_1M", 0.0025],
  ["BELLDANDY_MODEL_OUTPUT_USD_PER_1M", 0.25],
]);
const scriptPath = fileURLToPath(import.meta.url);
const defaultSourceRoot = path.resolve(path.dirname(scriptPath), "..");

export function analyzeCodeIntelAgentUpliftCell(input) {
  const variant = requireVariant(input?.variant);
  const attempt = requireAttempt(input?.attempt ?? 1);
  const benchmarkAttempt = requireAttempt(input?.benchmarkAttempt ?? attempt);
  const task = requireObject(input?.task, "task");
  const report = requireObject(input?.report, "benchmark report");
  const run = requireSingleRun(report);
  const codingCiManifest = requireObject(input?.codingCiManifest, "Coding CI manifest");
  const events = requireArray(input?.events, "run events");
  const expectedCandidateId = variant === "candidate" ? CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID : undefined;
  if (run.taskId !== task.id || run.attempt !== benchmarkAttempt) {
    throw new Error("CodeIntel uplift cell task or attempt drifted.");
  }
  const infrastructureNotRun = run.status === "infrastructure_error"
    && codingCiManifest.cliExitCode === 4
    && codingCiManifest.terminalType === null;
  if (run.execution?.profile !== task.executionProfile
    || (!infrastructureNotRun && codingCiManifest.mode !== task.executionProfile)) {
    throw new Error(`CodeIntel uplift execution profile drifted for ${task.id}.`);
  }
  if (!infrastructureNotRun && codingCiManifest.profileCandidateId !== expectedCandidateId) {
    throw new Error(`CodeIntel uplift ${variant} profile identity drifted for ${task.id}.`);
  }
  if (run.environment?.model?.credentialsConfigured !== true) {
    throw new Error("CodeIntel uplift real cell requires configured credentials.");
  }

  const startedById = new Map();
  let firstMutationIndex = events.length;
  let firstMutationTool = null;
  for (const [index, event] of events.entries()) {
    const tool = event?.payload?.tool;
    if (event?.type !== "tool.started" || typeof tool?.id !== "string") continue;
    startedById.set(tool.id, { ...tool, eventIndex: index });
    if (firstMutationTool === null && MUTATION_TOOLS.has(tool.name)) {
      firstMutationIndex = index;
      firstMutationTool = tool.name;
    }
  }

  let modelVisibleNavigationBytes = 0;
  let nonTargetWholeFileReadCalls = 0;
  let successfulSemanticCalls = 0;
  let failedSemanticCalls = 0;
  const capabilities = new Set();
  const requiredPaths = new Set(
    requireArray(task.acceptance?.requiredChangedPaths, "requiredChangedPaths")
      .map(normalizeToolPath),
  );
  for (const [index, event] of events.entries()) {
    if (index >= firstMutationIndex || event?.type !== "tool.completed") continue;
    const completed = event?.payload?.tool;
    const started = startedById.get(completed?.id);
    const name = completed?.name ?? started?.name;
    if (name === "code_intel") {
      if (completed?.success === true) {
        successfulSemanticCalls += 1;
        const capability = readCodeIntelCapability(completed);
        if (capability) capabilities.add(capability);
      } else {
        failedSemanticCalls += 1;
      }
    }
    if (completed?.success !== true || !NAVIGATION_TOOLS.has(name)) continue;
    modelVisibleNavigationBytes += Buffer.byteLength(String(completed.output ?? ""), "utf-8");
    if (name === "file_read"
      && isWholeFileRead(started?.arguments)
      && !requiredPaths.has(normalizeToolPath(started?.arguments?.path))) {
      nonTargetWholeFileReadCalls += 1;
    }
  }

  const terminal = events.findLast((event) => [
    "run.completed",
    "run.failed",
    "run.cancelled",
    "run.interrupted",
  ].includes(event?.type));
  const terminalErrorCode = typeof terminal?.payload?.error?.code === "string"
    ? terminal.payload.error.code
    : null;
  const providerFailure = terminalErrorCode !== null
    && /^(?:provider_|model_provider_|upstream_|auth$|rate_limit$|server_error$|timeout$)/u
      .test(terminalErrorCode);
  const usageStatus = run.usage?.observation?.status ?? "not_reached";
  const costUsd = usageStatus === "provider_reported"
    && Number.isFinite(run.usage?.observation?.costUsd)
    && run.usage.observation.costUsd >= 0
    ? round(run.usage.observation.costUsd)
    : null;

  return {
    cellId: `${task.id}:${run.platform}:a${attempt}:${variant}`,
    variant,
    taskId: task.id,
    runId: run.runId,
    status: run.status,
    failureCategory: run.failureCategory ?? null,
    identity: {
      promptSha256: requireSha256(input?.promptSha256 ?? sha256(task.prompt), "promptSha256"),
      fixtureBaselineCommit: requireSha1(run.fixture?.baselineCommit, "fixture baseline commit"),
      repositoryReceiptSha256: requireSha256(
        input?.repositoryReceiptSha256 ?? "0".repeat(64),
        "repository receipt SHA-256",
      ),
      source: cloneSourceIdentity(report.source, "benchmark source"),
      harness: cloneSourceIdentity(report.harness, "benchmark harness"),
      model: {
        provider: requireString(run.environment?.model?.provider, "model provider"),
        id: requireString(run.environment?.model?.id, "model id"),
      },
      executionProfile: task.executionProfile,
      maxTokens: requireNonNegativeInteger(run.execution?.budgets?.maxTokens, "maxTokens"),
    },
    outcomes: {
      taskSuccess: run.status === "passed",
      patchAcceptance: run.evaluation?.patchAccepted === true,
      testSuccess: run.evaluation?.testsPassed === true,
      regressionCount: requireNonNegativeInteger(run.evaluation?.regressionCount, "regressionCount"),
    },
    provider: {
      usageStatus,
      inputTokens: nullableTokenCount(run.usage?.inputTokens),
      outputTokens: nullableTokenCount(run.usage?.outputTokens),
      costUsd,
      failure: providerFailure,
      terminalErrorCode,
    },
    semantic: {
      successfulRun: capabilities.has("semantic-live"),
      successfulCallCount: successfulSemanticCalls,
      failedCallCount: failedSemanticCalls,
      capabilities: [...capabilities].sort(),
    },
    contextWaste: {
      modelVisibleNavigationBytes,
      nonTargetWholeFileReadCalls,
      firstMutationTool,
    },
    artifacts: cloneArtifactRefs(input?.artifactRefs ?? {}),
  };
}

export async function runCodeIntelAgentUpliftPlatform(input, dependencies = {}) {
  const platform = requirePlatform(input?.platform);
  const attempt = requireAttempt(input?.attempt ?? 1);
  const sourceRoot = path.resolve(requireString(input?.sourceRoot, "sourceRoot"));
  const outputRoot = path.resolve(requireString(input?.outputRoot, "outputRoot"));
  const fixtureRoot = path.resolve(requireString(input?.fixtureRoot, "fixtureRoot"));
  const stateRoot = path.resolve(requireString(input?.stateRoot, "stateRoot"));
  const repositoryConfigPath = path.resolve(
    requireString(input?.repositoryConfigPath, "repositoryConfigPath"),
  );
  const provider = requireString(input?.provider, "provider");
  const modelId = requireString(input?.modelId, "modelId");
  const maxTotalCostCny = requireAuthorizedCost(input?.maxTotalCostCny, "maxTotalCostCny");
  const priorObservedCostCny = requireAuthorizedCost(
    input?.priorObservedCostCny ?? 0,
    "priorObservedCostCny",
  );
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  const finalizeExistingExecution = input?.finalizeExistingExecution === true;
  if (priorObservedCostCny >= maxTotalCostCny) {
    throw new Error("Prior observed cost must remain below the authorized total cost.");
  }
  if (finalizeExistingExecution) {
    await assertDirectory(outputRoot, "existing output root");
    await assertPathAbsent(
      path.join(outputRoot, "agent-uplift-platform.json"),
      "platform report",
    );
  } else {
    await assertPathAbsent(outputRoot, "output root");
  }
  const readinessSource = await loadReadinessInput(input, platform);
  const verifyReadiness = dependencies.verifyReadiness ?? verifyPlatformReadiness;
  await verifyReadiness({
    platform,
    sourceRoot,
    readiness: readinessSource.report,
  });

  const [gate, manifest] = await Promise.all([
    readJson(path.join(sourceRoot, "benchmarks/code-intel/v1/agent-uplift-gate.json")),
    readJson(path.join(sourceRoot, "benchmarks/coding-agent/v3/task-manifest.json")),
  ]);
  const manifestTasks = new Map(manifest.tasks.map((task) => [task.id, task]));
  const tasks = gate.cohort.map((entry) => {
    const task = manifestTasks.get(entry.taskId);
    if (!task || task.repositoryId !== entry.repositoryId
      || task.executionProfile !== entry.executionProfile) {
      throw new Error(`CodeIntel uplift task binding drifted for ${entry.taskId}.`);
    }
    return task;
  });
  if (JSON.stringify(tasks.map((task) => task.id)) !== JSON.stringify(CODE_INTEL_AGENT_UPLIFT_TASK_IDS)) {
    throw new Error("CodeIntel uplift selected task order drifted.");
  }

  if (!finalizeExistingExecution) {
    const runCohortPreflight = dependencies.runCohortPreflight
      ?? runCodeIntelAgentUpliftCohortPreflight;
    const cohortPreflight = await runCohortPreflight({
      platform,
      sourceRoot,
      stateRoot,
      outputPath: path.resolve(
        input?.cohortPreflightOutputPath ?? `${outputRoot}.cohort-preflight.json`,
      ),
      provisionAgentProfile: input?.provisionCohortAgentProfile === true,
      generatedAt,
    }, dependencies);
    if (cohortPreflight?.status !== "passed" || cohortPreflight?.providerCalls !== 0) {
      const failures = Array.isArray(cohortPreflight?.blockingFailures)
        ? cohortPreflight.blockingFailures.join(",")
        : "invalid_cohort_preflight_report";
      throw new Error(`CodeIntel uplift cohort runtime preflight failed: ${failures}.`);
    }
  }

  if (!finalizeExistingExecution) {
    await fs.mkdir(path.dirname(outputRoot), { recursive: true });
    await fs.mkdir(outputRoot);
    await fs.mkdir(fixtureRoot, { recursive: true });
    await fs.mkdir(stateRoot, { recursive: true });
  }
  if (!dependencies.executeCell && !finalizeExistingExecution) {
    assertCodeIntelAgentUpliftPricingEnvironment();
  }
  const executeCell = dependencies.executeCell
    ?? (finalizeExistingExecution ? loadExistingUpliftCell : executeRealUpliftCell);
  const repositoryInputs = dependencies.executeCell || finalizeExistingExecution
    ? undefined
    : await (dependencies.loadRepositoryInputs ?? loadCodingAgentBenchmarkV3RepositoryInputs)(
        repositoryConfigPath,
      );
  const pairs = [];
  const blockingFailures = [];
  let runCostCny = 0;
  let executedCellCount = 0;
  let stop = false;

  for (const task of tasks) {
    const pair = {
      pairId: `${task.id}:${platform}:a${attempt}`,
      taskId: task.id,
      repositoryId: task.repositoryId,
      executionProfile: task.executionProfile,
    };
    for (const variant of ["baseline", "candidate"]) {
      const remainingCostCny = round(maxTotalCostCny - priorObservedCostCny - runCostCny);
      if (remainingCostCny <= 0) {
        blockingFailures.push("authorized_cost_exhausted");
        stop = true;
        break;
      }
      const maxCostUsd = round(Math.min(
        STAGE_0D_BENCHMARK_USAGE_BUDGET_USD,
        remainingCostCny / EXCHANGE_RATE_CNY_PER_USD,
      ));
      let cell;
      try {
        cell = await executeCell({
          platform,
          sourceRoot,
          outputRoot,
          fixtureRoot,
          stateRoot,
          ...(input.gatewayFixtureRoot ? {
            gatewayFixtureRoot: requireString(input.gatewayFixtureRoot, "gatewayFixtureRoot"),
          } : {}),
          repositoryInputs,
          task,
          variant,
          attempt,
          provider,
          modelId,
          maxCostUsd,
          generatedAt,
        }, dependencies);
      } catch (error) {
        blockingFailures.push(
          `cell_execution_error:${task.id}:${platform}:a${attempt}:${variant}:${
            normalizeFailureCode(error)
          }`,
        );
        stop = true;
        break;
      }
      pair[variant] = cell;
      executedCellCount += 1;
      let cellBlocked = false;
      if (cell.provider?.usageStatus !== "provider_reported"
        || !Number.isFinite(cell.provider?.costUsd)) {
        blockingFailures.push(`provider_usage_incomplete:${cell.cellId}`);
        cellBlocked = true;
      } else {
        runCostCny = round(runCostCny + cell.provider.costUsd * EXCHANGE_RATE_CNY_PER_USD);
        if (priorObservedCostCny + runCostCny > maxTotalCostCny + 1e-8) {
          throw new Error("CodeIntel uplift exceeded the authorized total cost.");
        }
      }
      if (cell.status === "infrastructure_error") {
        blockingFailures.push(`infrastructure_error:${cell.cellId}`);
        cellBlocked = true;
      }
      if (cell.provider.failure) {
        blockingFailures.push(`provider_failure:${cell.cellId}`);
        cellBlocked = true;
      }
      if (cellBlocked) {
        stop = true;
        break;
      }
    }
    pairs.push(pair);
    if (stop) break;
    try {
      assertPairIdentity(pair);
    } catch {
      blockingFailures.push(`paired_input_identity_mismatch:${pair.pairId}`);
      stop = true;
    }
    if (stop) break;
  }

  const report = {
    schemaVersion: CODE_INTEL_AGENT_UPLIFT_PLATFORM_VERSION,
    generatedAt,
    status: executedCellCount === tasks.length * 2 && blockingFailures.length === 0
      ? "completed"
      : "blocked",
    platform,
    attempt,
    candidateId: CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID,
    gate: {
      id: gate.id,
      sha256: CODE_INTEL_AGENT_UPLIFT_GATE_SHA256,
    },
    readiness: {
      reportSha256: readinessSource.sha256,
      sourceIdentity: structuredClone(readinessSource.report.sourceIdentity),
      runtimeIdentity: structuredClone(readinessSource.report.runtimeIdentity),
    },
    authorization: {
      provider,
      modelId,
      maxTotalCostCny,
      priorObservedCostCny,
      runCostCny,
      remainingCostCny: round(maxTotalCostCny - priorObservedCostCny - runCostCny),
      exchangeRateCnyPerUsd: EXCHANGE_RATE_CNY_PER_USD,
    },
    execution: {
      selectedPairCount: tasks.length,
      selectedCellCount: tasks.length * 2,
      executedCellCount,
      retryCount: 0,
    },
    pairs,
    blockingFailures,
  };
  await fs.writeFile(
    path.join(outputRoot, "agent-uplift-platform.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { encoding: "utf-8", flag: "wx" },
  );
  return report;
}

export function buildCodeIntelAgentUpliftAggregate(input) {
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  const windows = requirePlatformReport(input?.windows, "windows-native");
  const wsl = requirePlatformReport(input?.wsl, "wsl2-linux");
  const maxTotalCostCny = requireAuthorizedCost(input?.maxTotalCostCny, "maxTotalCostCny");
  const windowsAttempt = resolvePlatformReportAttempt(windows);
  const wslAttempt = resolvePlatformReportAttempt(wsl);
  const failures = [];
  if (windowsAttempt !== wslAttempt) failures.push("attempt_identity_mismatch");
  if (windows.status !== "completed" || wsl.status !== "completed"
    || windows.blockingFailures.length > 0 || wsl.blockingFailures.length > 0) {
    failures.push("platform_execution_incomplete");
  }
  if (JSON.stringify(windows.readiness?.sourceIdentity)
    !== JSON.stringify(wsl.readiness?.sourceIdentity)
    || JSON.stringify(windows.readiness?.runtimeIdentity)
      !== JSON.stringify(wsl.readiness?.runtimeIdentity)) {
    failures.push("readiness_identity_mismatch");
  }
  if (windows.authorization.provider !== wsl.authorization.provider
    || windows.authorization.modelId !== wsl.authorization.modelId) {
    failures.push("model_identity_mismatch");
  }
  const expectedWslPrior = round(
    windows.authorization.priorObservedCostCny + windows.authorization.runCostCny,
  );
  if (wsl.authorization.priorObservedCostCny !== expectedWslPrior) {
    failures.push("cost_chain_mismatch");
  }
  const totalRunCostCny = round(windows.authorization.runCostCny + wsl.authorization.runCostCny);
  const totalObservedCostCny = round(windows.authorization.priorObservedCostCny + totalRunCostCny);
  if (totalObservedCostCny > maxTotalCostCny + 1e-8) failures.push("authorized_cost_exceeded");

  const pairs = [...windows.pairs, ...wsl.pairs];
  if (pairs.length !== 8) failures.push("missing_pair");
  const expectedPairIds = ["windows-native", "wsl2-linux"].flatMap((platform) =>
    CODE_INTEL_AGENT_UPLIFT_TASK_IDS.map((taskId) => `${taskId}:${platform}:a${windowsAttempt}`));
  if (JSON.stringify(pairs.map((pair) => pair.pairId)) !== JSON.stringify(expectedPairIds)) {
    failures.push("pair_identity_mismatch");
  }

  let regressionCount = 0;
  let providerFailureCount = 0;
  let semanticSuccessfulRuns = 0;
  const semanticSuccessfulRunsByPlatform = { "windows-native": 0, "wsl2-linux": 0 };
  const contextTotals = {
    baseline: { modelVisibleNavigationBytes: 0, nonTargetWholeFileReadCalls: 0 },
    candidate: { modelVisibleNavigationBytes: 0, nonTargetWholeFileReadCalls: 0 },
  };
  for (const pair of pairs) {
    if (!pair.baseline || !pair.candidate) continue;
    try {
      assertPairIdentity(pair);
    } catch {
      failures.push("paired_input_identity_mismatch");
    }
    for (const metric of ["taskSuccess", "patchAcceptance", "testSuccess"]) {
      if (Number(pair.candidate.outcomes[metric]) < Number(pair.baseline.outcomes[metric])) {
        regressionCount += 1;
      }
    }
    providerFailureCount += Number(pair.baseline.provider.failure)
      + Number(pair.candidate.provider.failure);
    if (pair.baseline.provider.usageStatus !== "provider_reported"
      || pair.candidate.provider.usageStatus !== "provider_reported") {
      failures.push("provider_usage_incomplete");
    }
    if (pair.candidate.semantic.successfulRun) {
      semanticSuccessfulRuns += 1;
      const platform = pair.pairId.includes(":wsl2-linux:") ? "wsl2-linux" : "windows-native";
      semanticSuccessfulRunsByPlatform[platform] += 1;
    }
    for (const variant of ["baseline", "candidate"]) {
      contextTotals[variant].modelVisibleNavigationBytes +=
        pair[variant].contextWaste.modelVisibleNavigationBytes;
      contextTotals[variant].nonTargetWholeFileReadCalls +=
        pair[variant].contextWaste.nonTargetWholeFileReadCalls;
    }
  }
  if (regressionCount > 0) failures.push("binary_outcome_regression");
  if (providerFailureCount > 0) failures.push("provider_failure");
  if (semanticSuccessfulRuns < 6
    || semanticSuccessfulRunsByPlatform["windows-native"] < 3
    || semanticSuccessfulRunsByPlatform["wsl2-linux"] < 3) {
    failures.push("semantic_adoption_below_gate");
  }

  const bytesReduction = relativeReduction(
    contextTotals.baseline.modelVisibleNavigationBytes,
    contextTotals.candidate.modelVisibleNavigationBytes,
  );
  const readsReduction = relativeReduction(
    contextTotals.baseline.nonTargetWholeFileReadCalls,
    contextTotals.candidate.nonTargetWholeFileReadCalls,
  );
  const readsAbsoluteReduction = contextTotals.baseline.nonTargetWholeFileReadCalls
    - contextTotals.candidate.nonTargetWholeFileReadCalls;
  const noContextRegression = contextTotals.candidate.modelVisibleNavigationBytes
      <= contextTotals.baseline.modelVisibleNavigationBytes
    && contextTotals.candidate.nonTargetWholeFileReadCalls
      <= contextTotals.baseline.nonTargetWholeFileReadCalls;
  const improvementAlternativePassed = bytesReduction >= 0.15
    || (readsReduction >= 0.25 && readsAbsoluteReduction >= 2);
  if (!noContextRegression) failures.push("context_waste_regression");
  if (!improvementAlternativePassed) failures.push("context_waste_improvement_below_gate");

  const uniqueFailures = [...new Set(failures)];
  return {
    schemaVersion: CODE_INTEL_AGENT_UPLIFT_REPORT_VERSION,
    generatedAt,
    status: uniqueFailures.length === 0 ? "passed" : "blocked",
    attempt: windowsAttempt,
    candidateId: CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID,
    authorization: {
      provider: windows.authorization.provider,
      modelId: windows.authorization.modelId,
      maxTotalCostCny,
      priorObservedCostCny: windows.authorization.priorObservedCostCny,
      runCostCny: totalRunCostCny,
      totalObservedCostCny,
      remainingCostCny: round(maxTotalCostCny - totalObservedCostCny),
      exchangeRateCnyPerUsd: EXCHANGE_RATE_CNY_PER_USD,
    },
    platforms: {
      windowsNative: summarizePlatform(windows),
      wsl2Linux: summarizePlatform(wsl),
    },
    gate: {
      passed: uniqueFailures.length === 0,
      failures: uniqueFailures,
      pairCount: pairs.length,
      regressionCount,
      providerFailureCount,
      semanticSuccessfulRuns,
      semanticSuccessfulRunsByPlatform,
      contextWaste: {
        modelVisibleNavigationBytes: {
          baseline: contextTotals.baseline.modelVisibleNavigationBytes,
          candidate: contextTotals.candidate.modelVisibleNavigationBytes,
          relativeReduction: bytesReduction,
        },
        nonTargetWholeFileReadCalls: {
          baseline: contextTotals.baseline.nonTargetWholeFileReadCalls,
          candidate: contextTotals.candidate.nonTargetWholeFileReadCalls,
          relativeReduction: readsReduction,
          absoluteReduction: readsAbsoluteReduction,
        },
        noRegression: noContextRegression,
        improvementAlternativePassed,
      },
    },
    pairs: pairs.map((pair) => ({
      pairId: pair.pairId,
      taskId: pair.taskId,
      repositoryId: pair.repositoryId,
      executionProfile: pair.executionProfile,
      baseline: structuredClone(pair.baseline),
      candidate: structuredClone(pair.candidate),
    })),
  };
}

export async function writeCodeIntelAgentUpliftAggregate(input) {
  const outputRoot = path.resolve(requireString(input?.outputRoot, "outputRoot"));
  await assertPathAbsent(outputRoot, "aggregate output root");
  const [windows, wsl] = await Promise.all([
    readJson(path.join(path.resolve(requireString(input?.windowsRoot, "windowsRoot")), "agent-uplift-platform.json")),
    readJson(path.join(path.resolve(requireString(input?.wslRoot, "wslRoot")), "agent-uplift-platform.json")),
  ]);
  const report = buildCodeIntelAgentUpliftAggregate({
    generatedAt: input.generatedAt,
    windows,
    wsl,
    maxTotalCostCny: input.maxTotalCostCny,
  });
  await fs.mkdir(path.dirname(outputRoot), { recursive: true });
  await fs.mkdir(outputRoot);
  await fs.writeFile(
    path.join(outputRoot, "agent-uplift-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { encoding: "utf-8", flag: "wx" },
  );
  return report;
}

async function executeRealUpliftCell(input, dependencies) {
  const runSuite = dependencies.runSuite ?? runStage0BSuite;
  const benchmarkAttempt = 1;
  const cellRoot = path.join(
    input.outputRoot,
    "cells",
    input.task.id.replaceAll(".", "-"),
    input.variant,
  );
  const executionRoot = path.join(cellRoot, "execution");
  const runId = `${input.task.id.replaceAll(".", "-")}-${
    input.platform === "windows-native" ? "windows" : "wsl2-linux"
  }-a${input.attempt}-${input.variant}`;
  const report = await runSuite({
    platform: input.platform,
    manifestRevision: "v3",
    sourceRoot: input.sourceRoot,
    fixtureRoot: input.fixtureRoot,
    ...(input.gatewayFixtureRoot ? { gatewayFixtureRoot: input.gatewayFixtureRoot } : {}),
    artifactRoot: executionRoot,
    stateRoot: input.stateRoot,
    attempt: benchmarkAttempt,
    taskIds: [input.task.id],
    runIds: { [input.task.id]: runId },
    v3RepositoryInputs: input.repositoryInputs,
    model: { provider: input.provider, id: input.modelId, credentialsConfigured: true },
    maxTotalCostUsd: input.maxCostUsd,
    ...(input.variant === "candidate"
      ? { shadowCandidateId: CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID }
      : {}),
    generatedAt: input.generatedAt,
  });
  return loadExistingUpliftCell({ ...input, benchmarkAttempt });
}

async function loadExistingUpliftCell(input) {
  const cellRoot = path.join(
    input.outputRoot,
    "cells",
    input.task.id.replaceAll(".", "-"),
    input.variant,
  );
  const executionRoot = path.join(cellRoot, "execution");
  const report = await readJson(path.join(executionRoot, "benchmark-report.json"));
  const run = requireSingleRun(report);
  const runRoot = path.join(executionRoot, run.runId);
  const artifactPaths = {
    report: path.join(executionRoot, "benchmark-report.json"),
    events: path.join(runRoot, "events.jsonl"),
    codingCiManifest: path.join(runRoot, "coding-ci-manifest.json"),
    patch: path.join(runRoot, "changes.patch"),
    result: path.join(runRoot, "result.json"),
    repositorySnapshotReceipt: path.join(runRoot, "repository-snapshot-receipt.json"),
  };
  const contents = Object.fromEntries(await Promise.all(Object.entries(artifactPaths).map(
    async ([name, target]) => [name, await fs.readFile(target, "utf-8")],
  )));
  const promptText = await fs.readFile(path.join(runRoot, "prompt.md"), "utf-8");
  const artifactRefs = Object.fromEntries(Object.entries(artifactPaths).map(([name, target]) => [
    name,
    {
      path: path.relative(input.outputRoot, target).replaceAll(path.sep, "/"),
      sha256: sha256(contents[name]),
    },
  ]));
  return analyzeCodeIntelAgentUpliftCell({
    variant: input.variant,
    attempt: input.attempt,
    benchmarkAttempt: input.benchmarkAttempt ?? input.attempt,
    task: input.task,
    report,
    codingCiManifest: JSON.parse(contents.codingCiManifest),
    events: parseJsonLines(contents.events),
    promptSha256: sha256(promptText.trimEnd()),
    repositoryReceiptSha256: artifactRefs.repositorySnapshotReceipt.sha256,
    artifactRefs,
  });
}

export function assertCodeIntelAgentUpliftPricingEnvironment(
  readEnv = (name) => process.env[name],
) {
  const pricing = evaluateCodeIntelAgentUpliftPricingEnvironment(readEnv);
  if (pricing.status === "failed") {
    throw new Error(
      `CodeIntel uplift requires ${pricing.name}=${pricing.expected} before creating a selected cell.`,
    );
  }
}

export async function runCodeIntelAgentUpliftCohortPreflight(input, dependencies = {}) {
  const platform = requirePlatform(input?.platform);
  const sourceRoot = path.resolve(requireString(input?.sourceRoot, "sourceRoot"));
  const stateRoot = path.resolve(requireString(input?.stateRoot, "stateRoot"));
  const outputPath = path.resolve(requireString(input?.outputPath, "outputPath"));
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  const readEnv = input?.readEnv ?? ((name) => process.env[name]);
  const [gate, manifest] = await Promise.all([
    readJson(path.join(sourceRoot, "benchmarks/code-intel/v1/agent-uplift-gate.json")),
    readJson(path.join(sourceRoot, "benchmarks/coding-agent/v3/task-manifest.json")),
  ]);
  const manifestTasks = new Map(manifest.tasks.map((task) => [task.id, task]));
  const tasks = gate.cohort.map((entry) => {
    const task = manifestTasks.get(entry.taskId);
    if (!task || task.repositoryId !== entry.repositoryId
      || task.executionProfile !== entry.executionProfile) {
      throw new Error(`CodeIntel uplift task binding drifted for ${entry.taskId}.`);
    }
    return task;
  });
  if (JSON.stringify(tasks.map((task) => task.id)) !== JSON.stringify(CODE_INTEL_AGENT_UPLIFT_TASK_IDS)) {
    throw new Error("CodeIntel uplift selected task order drifted.");
  }

  await assertPathAbsent(outputPath, "cohort preflight report");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const profileConfig = await inspectCodeIntelAgentUpliftProfileConfig({
    stateRoot,
    provision: input?.provisionAgentProfile === true,
  });
  const pricing = evaluateCodeIntelAgentUpliftPricingEnvironment(readEnv);
  const createPreflight = dependencies.createPreflight ?? createBenchmarkPreflightArtifact;
  const taskReports = [];
  for (const task of tasks) {
    const runId = `cohort-preflight-${platform}-${task.id.replaceAll(".", "-")}`;
    let preflight;
    try {
      preflight = await createPreflight({
        manifestRevision: "v3",
        manifest,
        task,
        runId,
        sourceRoot,
        stateDir: stateRoot,
        pricingRequired: true,
        readEnv,
      }, {
        ...(dependencies.probeOciImage ? { probeImage: dependencies.probeOciImage } : {}),
      });
    } catch (error) {
      preflight = {
        schemaVersion: "coding-agent-benchmark-preflight/v1",
        manifestRevision: "v3",
        taskId: task.id,
        runId,
        status: "failed",
        checks: {
          runtimePreflight: {
            status: "failed",
            reason: `preflight_exception_${normalizeFailureCode(error)}`,
          },
        },
      };
    }
    taskReports.push({
      taskId: task.id,
      executionProfile: task.executionProfile,
      status: preflight.status,
      preflight,
    });
  }

  const blockingFailures = [];
  if (profileConfig.status === "failed") {
    blockingFailures.push(`profile_config:${profileConfig.reason}`);
  }
  if (pricing.status === "failed") {
    blockingFailures.push(`pricing:${pricing.name}:mismatch`);
  }
  for (const taskReport of taskReports) {
    const initialFailureCount = blockingFailures.length;
    for (const [checkName, check] of Object.entries(taskReport.preflight?.checks ?? {})) {
      if (check?.status === "failed") {
        blockingFailures.push(`${taskReport.taskId}:${checkName}:${check.reason ?? "failed"}`);
      }
    }
    if (taskReport.status !== "passed" && blockingFailures.length === initialFailureCount) {
      blockingFailures.push(`${taskReport.taskId}:preflight:failed`);
    }
  }
  const report = {
    schemaVersion: CODE_INTEL_AGENT_UPLIFT_COHORT_PREFLIGHT_VERSION,
    generatedAt,
    status: blockingFailures.length === 0 ? "passed" : "failed",
    platform,
    providerCalls: 0,
    selectedTaskCount: tasks.length,
    profileConfig,
    pricing,
    tasks: taskReports,
    blockingFailures,
  };
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf-8",
    flag: "wx",
  });
  return report;
}

export async function prepareCodeIntelAgentUpliftPreflightState(input) {
  const stateRoot = path.resolve(requireString(input?.stateRoot, "stateRoot"));
  const configPath = path.join(stateRoot, "agents.json");
  await fs.mkdir(stateRoot, { recursive: true });
  let raw;
  let created = false;
  try {
    raw = await fs.readFile(configPath, "utf-8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    raw = `${JSON.stringify({
      agents: [CODING_AGENT_BENCHMARK_COMMAND_CONTROL_AGENT_PROFILE],
    }, null, 2)}\n`;
    await fs.writeFile(configPath, raw, { encoding: "utf-8", flag: "wx" });
    created = true;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("CodeIntel uplift isolated agents.json is invalid JSON.");
  }
  const matches = Array.isArray(parsed?.agents)
    ? parsed.agents.filter(
        (profile) => profile?.id === CODING_AGENT_BENCHMARK_COMMAND_CONTROL_AGENT_PROFILE.id,
      )
    : [];
  if (matches.length !== 1
    || !sameFlatObject(matches[0], CODING_AGENT_BENCHMARK_COMMAND_CONTROL_AGENT_PROFILE)) {
    throw new Error("CodeIntel uplift isolated command-control agent profile drifted.");
  }
  return {
    status: "passed",
    reason: null,
    created,
    path: "agents.json",
    sha256: sha256(raw),
  };
}

function evaluateCodeIntelAgentUpliftPricingEnvironment(readEnv) {
  const rates = {};
  for (const [name, expected] of AUTHORIZED_PRICING_USD_PER_1M) {
    const value = Number(readEnv(name));
    if (!Number.isFinite(value) || value !== expected) {
      return {
        status: "failed",
        reason: "authorized_pricing_mismatch",
        name,
        expected,
        actual: Number.isFinite(value) ? value : null,
      };
    }
    rates[name] = value;
  }
  return { status: "passed", reason: null, rates };
}

async function inspectCodeIntelAgentUpliftProfileConfig({ stateRoot, provision }) {
  if (provision) {
    try {
      return await prepareCodeIntelAgentUpliftPreflightState({ stateRoot });
    } catch {
      return { status: "failed", reason: "agent_profile_config_invalid" };
    }
  }
  try {
    const raw = await fs.readFile(path.join(stateRoot, "agents.json"), "utf-8");
    const parsed = JSON.parse(raw);
    const matches = Array.isArray(parsed?.agents)
      ? parsed.agents.filter(
          (profile) => profile?.id === CODING_AGENT_BENCHMARK_COMMAND_CONTROL_AGENT_PROFILE.id,
        )
      : [];
    if (matches.length !== 1
      || !sameFlatObject(matches[0], CODING_AGENT_BENCHMARK_COMMAND_CONTROL_AGENT_PROFILE)) {
      return { status: "failed", reason: "agent_profile_config_invalid" };
    }
    return {
      status: "passed",
      reason: null,
      created: false,
      path: "agents.json",
      sha256: sha256(raw),
    };
  } catch {
    return { status: "failed", reason: "agent_profile_config_unavailable" };
  }
}

function sameFlatObject(left, right) {
  if (!left || typeof left !== "object" || Array.isArray(left)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return JSON.stringify(leftKeys) === JSON.stringify(rightKeys)
    && rightKeys.every((key) => left[key] === right[key]);
}

async function verifyPlatformReadiness(input) {
  const readiness = requireObject(input?.readiness, "readiness report");
  if (readiness.schemaVersion !== "code-intel-agent-uplift-readiness/v1"
    || readiness.status !== "ready_for_authorization"
    || readiness.platform !== input.platform
    || readiness.candidateId !== CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID
    || readiness.gate?.sha256 !== CODE_INTEL_AGENT_UPLIFT_GATE_SHA256
    || readiness.taskManifest?.sha256
      !== "e3cac7c8b2786408af45dc3bfed718ee1a898388aa0fae4fbd5b1d38ab68bd22"
    || readiness.truthSet?.sha256
      !== "f6d787ec2a20f446c69f90a467d3812c8ca9644517ee5c7acf328430f934500e") {
    throw new Error("CodeIntel uplift readiness contract drifted.");
  }
  const preparedTaskIds = readiness.preparedPairs?.map((pair) => pair.taskId);
  if (JSON.stringify(preparedTaskIds) !== JSON.stringify(CODE_INTEL_AGENT_UPLIFT_TASK_IDS)) {
    throw new Error("CodeIntel uplift readiness prepared pair drifted.");
  }
  const frozenInputs = [
    {
      label: "Gate",
      relativePath: "benchmarks/code-intel/v1/agent-uplift-gate.json",
      expectedSha256: readiness.gate.sha256,
    },
    {
      label: "task manifest",
      relativePath: "benchmarks/coding-agent/v3/task-manifest.json",
      expectedSha256: readiness.taskManifest.sha256,
    },
    {
      label: "truth set",
      relativePath: "benchmarks/code-intel/v1/truth-set.json",
      expectedSha256: readiness.truthSet.sha256,
    },
  ];
  for (const frozenInput of frozenInputs) {
    const target = resolveInside(input.sourceRoot, frozenInput.relativePath);
    const actualSha256 = hashCanonicalText(await fs.readFile(target, "utf-8"));
    if (actualSha256 !== frozenInput.expectedSha256) {
      throw new Error(`CodeIntel uplift ${frozenInput.label} identity drifted.`);
    }
  }
  for (const identity of [readiness.sourceIdentity, readiness.runtimeIdentity]) {
    const files = [];
    for (const entry of requireArray(identity?.files, "readiness identity files")) {
      const target = resolveInside(input.sourceRoot, requireString(entry.path, "identity path"));
      files.push({
        path: entry.path,
        sha256: hashCanonicalText(await fs.readFile(target, "utf-8")),
      });
    }
    if (JSON.stringify(files) !== JSON.stringify(identity.files)
      || sha256(JSON.stringify(files)) !== identity.aggregateSha256) {
      throw new Error("CodeIntel uplift readiness source/runtime identity drifted.");
    }
  }
}

function assertPairIdentity(pair) {
  const baseline = requireObject(pair?.baseline, "baseline cell");
  const candidate = requireObject(pair?.candidate, "candidate cell");
  if (baseline.variant !== "baseline" || candidate.variant !== "candidate"
    || baseline.taskId !== candidate.taskId
    || JSON.stringify(baseline.identity) !== JSON.stringify(candidate.identity)) {
    throw new Error(`CodeIntel uplift paired input identity drifted for ${pair?.pairId ?? "unknown"}.`);
  }
}

function requirePlatformReport(value, platform) {
  const report = requireObject(value, `${platform} platform report`);
  if (report.schemaVersion !== CODE_INTEL_AGENT_UPLIFT_PLATFORM_VERSION
    || report.platform !== platform
    || report.candidateId !== CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID
    || !Array.isArray(report.pairs)
    || !Array.isArray(report.blockingFailures)) {
    throw new Error(`CodeIntel uplift ${platform} platform report drifted.`);
  }
  return report;
}

function resolvePlatformReportAttempt(report) {
  return requireAttempt(report.attempt ?? 1);
}

function summarizePlatform(report) {
  return {
    status: report.status,
    reportSha256: sha256(`${JSON.stringify(report, null, 2)}\n`),
    pairCount: report.pairs.length,
    executedCellCount: report.execution.executedCellCount,
    runCostCny: report.authorization.runCostCny,
  };
}

async function loadReadinessInput(input, platform) {
  if (input.readiness) {
    const report = requireObject(input.readiness, "readiness");
    return { report, sha256: sha256(`${JSON.stringify(report, null, 2)}\n`) };
  }
  const root = path.resolve(requireString(input.readinessRoot, "readinessRoot"));
  const target = path.join(root, "agent-uplift-readiness.json");
  const text = await fs.readFile(target, "utf-8");
  const report = JSON.parse(text);
  if (report.platform !== platform) throw new Error("CodeIntel uplift readiness platform drifted.");
  return { report, sha256: sha256(text) };
}

function cloneArtifactRefs(refs) {
  const names = ["report", "events", "codingCiManifest", "patch", "result", "repositorySnapshotReceipt"];
  if (Object.keys(refs).length === 0) {
    return Object.fromEntries(names.map((name, index) => [name, {
      path: `${name}.fixture`,
      sha256: String(index + 1).repeat(64),
    }]));
  }
  if (JSON.stringify(Object.keys(refs).sort()) !== JSON.stringify([...names].sort())) {
    throw new Error("CodeIntel uplift cell artifact references drifted.");
  }
  return Object.fromEntries(names.map((name) => {
    const ref = requireObject(refs[name], `${name} artifact`);
    return [name, {
      path: requireRelativePath(ref.path, `${name}.path`),
      sha256: requireSha256(ref.sha256, `${name}.sha256`),
    }];
  }));
}

function cloneSourceIdentity(value, label) {
  const source = requireObject(value, label);
  return {
    commit: requireSha1(source.commit, `${label}.commit`),
    workspaceDirty: requireBoolean(source.workspaceDirty, `${label}.workspaceDirty`),
    lockfileSha256: requireSha256(source.lockfileSha256, `${label}.lockfileSha256`),
    worktreeContentSha256: requireSha256(
      source.worktreeContentSha256,
      `${label}.worktreeContentSha256`,
    ),
  };
}

function readCodeIntelCapability(completed) {
  const metadataCapability = typeof completed?.metadata?.capability === "string"
    ? completed.metadata.capability
    : undefined;
  try {
    const parsed = JSON.parse(String(completed?.output ?? ""));
    const payloadCapability = typeof parsed?.provenance?.capability === "string"
      ? parsed.provenance.capability
      : undefined;
    return payloadCapability === metadataCapability || metadataCapability === undefined
      ? payloadCapability ?? metadataCapability
      : undefined;
  } catch {
    return metadataCapability;
  }
}

function isWholeFileRead(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return true;
  return args.offset === undefined
    && args.limit === undefined
    && args.maxBytes === undefined
    && args.cursor === undefined;
}

function normalizeToolPath(value) {
  return String(value ?? "").trim().replaceAll("\\", "/").replace(/^\.\//u, "");
}

function relativeReduction(baseline, candidate) {
  if (baseline === 0) return candidate === 0 ? 0 : -1;
  return round((baseline - candidate) / baseline);
}

function parseJsonLines(text) {
  return text.split(/\r?\n/u).filter((line) => line.trim()).map((line) => JSON.parse(line));
}

function requireSingleRun(report) {
  if (!Array.isArray(report?.runs) || report.runs.length !== 1) {
    throw new Error("CodeIntel uplift cell report must contain exactly one run.");
  }
  return report.runs[0];
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`CodeIntel uplift requires ${label}.`);
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`CodeIntel uplift requires ${label}.`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`CodeIntel uplift requires ${label}.`);
  }
  return value.trim();
}

function requirePlatform(value) {
  const platform = requireString(value, "platform");
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error("CodeIntel uplift platform must be windows-native or wsl2-linux.");
  }
  return platform;
}

function requireVariant(value) {
  const variant = requireString(value, "variant");
  if (variant !== "baseline" && variant !== "candidate") {
    throw new Error("CodeIntel uplift variant must be baseline or candidate.");
  }
  return variant;
}

function requireAttempt(value) {
  const attempt = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(attempt) || attempt < 1) {
    throw new Error("CodeIntel uplift attempt must be a positive integer.");
  }
  return attempt;
}

function requireAuthorizedCost(value, label) {
  const cost = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(cost) || cost < 0 || cost > 40) {
    throw new Error(`${label} must be between 0 and 40 CNY.`);
  }
  return round(cost);
}

function requireIsoTimestamp(value) {
  const timestamp = requireString(value, "generatedAt");
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error("generatedAt must be an ISO timestamp.");
  return timestamp;
}

function requireSha1(value, label) {
  const hash = requireString(value, label);
  if (!/^[0-9a-f]{40}$/iu.test(hash)) throw new Error(`${label} must be a SHA-1.`);
  return hash;
}

function requireSha256(value, label) {
  const hash = requireString(value, label);
  if (!/^[0-9a-f]{64}$/iu.test(hash)) throw new Error(`${label} must be a SHA-256.`);
  return hash;
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`);
  return value;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function nullableTokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function requireRelativePath(value, label) {
  const relative = requireString(value, label);
  if (relative.includes("\\") || relative.startsWith("/") || /^[A-Za-z]:\//u.test(relative)
    || relative.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${label} must be a contained relative path.`);
  }
  return relative;
}

function resolveInside(root, relativePath) {
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("CodeIntel uplift identity path escapes sourceRoot.");
  }
  return resolved;
}

async function readJson(target) {
  return JSON.parse(await fs.readFile(target, "utf-8"));
}

async function assertPathAbsent(target, label) {
  const stats = await fs.lstat(target).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (stats) throw new Error(`CodeIntel uplift ${label} already exists.`);
}

async function assertDirectory(target, label) {
  const stats = await fs.stat(target).catch(() => null);
  if (!stats?.isDirectory()) throw new Error(`CodeIntel uplift ${label} must be a directory.`);
}

function round(value) {
  return Number(value.toFixed(8));
}

function normalizeFailureCode(error) {
  const message = error instanceof Error ? error.message : String(error ?? "unknown_error");
  return message.toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "_")
    .replaceAll(/^_+|_+$/gu, "")
    .slice(0, 120) || "unknown_error";
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseNamedArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Invalid CodeIntel uplift argument near ${String(flag ?? "<end>")}.`);
    }
    const key = flag.slice(2);
    if (values.has(key)) throw new Error(`${flag} may only be provided once.`);
    values.set(key, value);
  }
  return values;
}

function getRequired(values, key) {
  return requireString(values.get(key), `--${key}`);
}

async function main() {
  const values = parseNamedArguments(process.argv.slice(2));
  if (values.get("mode") === "cohort-preflight") {
    const report = await runCodeIntelAgentUpliftCohortPreflight({
      platform: getRequired(values, "platform"),
      sourceRoot: values.get("source-root") ?? defaultSourceRoot,
      stateRoot: getRequired(values, "state-root"),
      outputPath: getRequired(values, "output-path"),
      provisionAgentProfile: values.get("provision-agent-profile") === "true",
      ...(values.has("generated-at") ? { generatedAt: getRequired(values, "generated-at") } : {}),
    });
    console.log(
      `[code-intel-agent-uplift] ${report.platform} cohort preflight ${report.status}; `
      + `tasks=${report.selectedTaskCount}; providerCalls=${report.providerCalls}`,
    );
    return;
  }
  if (values.get("mode") === "aggregate") {
    const report = await writeCodeIntelAgentUpliftAggregate({
      windowsRoot: getRequired(values, "windows-root"),
      wslRoot: getRequired(values, "wsl-root"),
      outputRoot: getRequired(values, "output-root"),
      maxTotalCostCny: Number(getRequired(values, "max-total-cost-cny")),
      ...(values.has("generated-at") ? { generatedAt: getRequired(values, "generated-at") } : {}),
    });
    console.log(`[code-intel-agent-uplift] aggregate ${report.status}; costCny=${report.authorization.totalObservedCostCny}`);
    return;
  }
  const report = await runCodeIntelAgentUpliftPlatform({
    platform: getRequired(values, "platform"),
    sourceRoot: values.get("source-root") ?? defaultSourceRoot,
    readinessRoot: getRequired(values, "readiness-root"),
    repositoryConfigPath: getRequired(values, "repository-config"),
    fixtureRoot: getRequired(values, "fixture-root"),
    ...(values.has("gateway-fixture-root") ? {
      gatewayFixtureRoot: getRequired(values, "gateway-fixture-root"),
    } : {}),
    stateRoot: getRequired(values, "state-root"),
    outputRoot: getRequired(values, "output-root"),
    ...(values.has("cohort-preflight-output") ? {
      cohortPreflightOutputPath: getRequired(values, "cohort-preflight-output"),
    } : {}),
    provisionCohortAgentProfile: values.get("provision-cohort-agent-profile") === "true",
    provider: getRequired(values, "provider"),
    modelId: getRequired(values, "model-id"),
    attempt: Number(values.get("attempt") ?? 1),
    maxTotalCostCny: Number(getRequired(values, "max-total-cost-cny")),
    priorObservedCostCny: Number(values.get("prior-observed-cost-cny") ?? 0),
    finalizeExistingExecution: values.get("finalize-existing-execution") === "true",
    ...(values.has("generated-at") ? { generatedAt: getRequired(values, "generated-at") } : {}),
  });
  console.log(
    `[code-intel-agent-uplift] ${report.platform} ${report.status}; `
    + `cells=${report.execution.executedCellCount}; costCny=${report.authorization.runCostCny}`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(scriptPath)) {
  main().catch((error) => {
    console.error(`[code-intel-agent-uplift] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
