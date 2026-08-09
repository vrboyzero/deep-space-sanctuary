import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadCodingAgentBenchmarkV3RepositoryInputs,
  runStage0BSuite,
} from "./run-coding-agent-benchmark.mjs";
import {
  buildNavigationCandidateProfile,
  CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_ID,
} from "./run-coding-agent-benchmark-navigation-efficiency.mjs";

export const CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_REAL_VERSION =
  "coding-agent-benchmark-navigation-shadow-real/v1";

const TASK_ID = "real-js.bug-fix";
const EXCHANGE_RATE_CNY_PER_USD = 8;
const PRICING_CNY_PER_1M = Object.freeze({
  cacheReadInput: 0.02,
  uncachedInput: 1,
  output: 2,
});
const SUPPORTED_PLATFORMS = new Set(["windows-native", "wsl2-linux"]);
const scriptPath = fileURLToPath(import.meta.url);
const defaultSourceRoot = path.resolve(path.dirname(scriptPath), "..");

export function buildNavigationShadowRealArtifact(input) {
  const readiness = requireObject(input?.readiness, "readiness artifact");
  const navigationEvidence = requireObject(input?.navigationEvidence, "navigation evidence");
  const report = requireObject(input?.report, "execution report");
  const run = requireSingleRun(report);
  const codingCiManifest = requireObject(input?.codingCiManifest, "Coding CI manifest");
  const events = requireArray(input?.events, "run events");
  const platform = requirePlatform(input?.platform);
  const generatedAt = requireIsoTimestamp(input?.generatedAt);
  const priorObservedCostCny = requireCost(input?.priorObservedCostCny, "priorObservedCostCny");
  const artifactRefs = requireObject(input?.artifactRefs, "artifact references");

  validateReadiness(readiness, platform);
  if (navigationEvidence.status !== "eligible_for_canary"
    || navigationEvidence.profile?.id !== CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_ID
    || navigationEvidence.profile?.manifestModified !== false) {
    throw new Error("Navigation shadow real run requires eligible, manifest-safe navigation evidence.");
  }
  if (readiness.frozen?.baselineCommit !== navigationEvidence.source?.baselineCommit
    || readiness.source?.baselineCommit !== navigationEvidence.source?.baselineCommit
    || readiness.source?.baselineRunId !== navigationEvidence.source?.baselineRunId
    || readiness.source?.baselineTaskId !== navigationEvidence.source?.baselineTaskId
    || readiness.source?.baselineTaskId !== TASK_ID) {
    throw new Error("Navigation shadow real readiness baseline identity drifted.");
  }
  const baselineManifestText = requireText(input.baselineManifestText, "baseline manifest text");
  const baselineEventsText = requireText(input.baselineEventsText, "baseline events text");
  const baselineRepositorySnapshotReceiptText = requireText(
    input.baselineRepositorySnapshotReceiptText,
    "baseline repository snapshot receipt text",
  );
  const repositorySnapshotReceiptText = requireText(
    input.repositorySnapshotReceiptText,
    "repository snapshot receipt text",
  );
  if (sha256(baselineManifestText) !== navigationEvidence.source?.baselineManifestSha256
    || sha256(baselineEventsText) !== navigationEvidence.source?.baselineEventsSha256) {
    throw new Error("Navigation shadow real historical baseline hashes do not match evidence.");
  }
  const baselineManifest = JSON.parse(baselineManifestText);
  if (baselineManifest.runId !== navigationEvidence.source?.baselineRunId
    || baselineManifest.taskId !== navigationEvidence.source?.baselineTaskId
    || baselineManifest.fixture?.baselineCommit !== navigationEvidence.source?.baselineCommit) {
    throw new Error("Navigation shadow real historical baseline manifest drifted.");
  }
  const baselineSnapshotIdentity = buildRepositorySnapshotIdentity(
    baselineRepositorySnapshotReceiptText,
    "historical repository snapshot receipt",
  );
  const candidateSnapshotIdentity = buildRepositorySnapshotIdentity(
    repositorySnapshotReceiptText,
    "repository snapshot receipt",
  );
  if (JSON.stringify(baselineSnapshotIdentity) !== JSON.stringify(candidateSnapshotIdentity)) {
    throw new Error("Navigation shadow real repository snapshot identity drifted.");
  }
  if (sha256(input.navigationEvidenceText) !== readiness.source?.navigationEvidenceSha256) {
    throw new Error("Navigation evidence hash does not match the readiness artifact.");
  }
  if (report.suite?.manifestSha256 !== readiness.frozen?.manifestSha256) {
    throw new Error("Shadow execution manifest hash drifted from readiness.");
  }
  if (run.taskId !== TASK_ID || run.platform !== platform || run.attempt !== 1) {
    throw new Error("Navigation shadow real run must contain one attempt-1 real-js.bug-fix result.");
  }
  const candidateFixtureBaselineCommit = requireSha1(
    run.fixture?.baselineCommit,
    "candidate fixture baseline commit",
  );
  if (run.environment?.model?.id !== readiness.authorization?.modelId
    || run.environment?.model?.provider !== readiness.authorization?.provider
    || run.environment?.model?.credentialsConfigured !== true) {
    throw new Error("Navigation shadow real run model authorization drifted.");
  }
  if (codingCiManifest.mode !== "workspace-write"
    || codingCiManifest.profileCandidateId !== CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_ID) {
    throw new Error("Coding CI did not execute the authorized navigation candidate.");
  }
  if (run.usage?.observation?.status !== "provider_reported"
    || !Number.isFinite(run.usage.observation.costUsd)
    || run.usage.observation.costUsd < 0) {
    throw new Error("Navigation shadow real run requires provider-reported usage and cost.");
  }

  const maxTotalCostCny = requireCost(readiness.authorization?.maxCostCny, "maxCostCny");
  const runCostCny = round(run.usage.observation.costUsd * EXCHANGE_RATE_CNY_PER_USD);
  if (priorObservedCostCny + runCostCny > maxTotalCostCny + 1e-8) {
    throw new Error("Navigation shadow real run exceeded the authorized total CNY cost.");
  }

  const startedTools = events
    .filter((event) => event?.type === "tool.started")
    .map((event) => event?.payload?.tool?.name)
    .filter((name) => typeof name === "string" && name);
  if (startedTools.includes("run_command")) {
    throw new Error("Navigation shadow candidate invoked the denied run_command tool.");
  }
  const completedTools = events.filter((event) => event?.type === "tool.completed");
  const usageEvent = events.filter((event) => event?.type === "run.usage").at(-1);
  const modelCalls = normalizeNonNegativeInteger(usageEvent?.payload?.usage?.modelCalls, 0);
  const changedPaths = requireArray(codingCiManifest.changedPaths, "Coding CI changed paths");
  const totalTokens = nullableSum(run.usage?.inputTokens, run.usage?.outputTokens);
  const baseline = requireObject(navigationEvidence.baseline, "navigation baseline");
  const candidateProfile = buildNavigationCandidateProfile({
    suite: {
      executionProfiles: {
        "workspace-write": {
          permissionMode: navigationEvidence.profile.permissionMode,
          toolAllow: navigationEvidence.profile.toolAllow.filter(
            (name) => name !== "text_search" && name !== "file_glob",
          ),
          toolDeny: navigationEvidence.profile.toolDeny,
        },
        "navigation-read": { toolAllow: ["text_search", "file_glob"] },
      },
    },
  });
  if (JSON.stringify(candidateProfile) !== JSON.stringify(navigationEvidence.profile)) {
    throw new Error("Navigation candidate profile drifted from the eligible evidence.");
  }

  return {
    schemaVersion: CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_REAL_VERSION,
    generatedAt,
    status: "completed",
    taskId: TASK_ID,
    platform,
    candidate: structuredClone(candidateProfile),
    authorization: {
      status: "confirmed",
      provider: readiness.authorization.provider,
      modelId: readiness.authorization.modelId,
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
      hostCommandToolCalls: startedTools.filter((name) => name === "run_command").length,
      toolNames: [...new Set(startedTools)].sort(),
      enteredEditPhase: startedTools.some((name) => [
        "file_edit",
        "apply_patch",
        "file_write",
        "file_delete",
      ].includes(name)),
      budgetExhausted: events.some((event) => event?.type === "run.budget_exhausted"),
      terminalType: requireTerminalType(events),
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
      readinessSha256: requireSha256(input.readinessSha256, "readinessSha256"),
      navigationEvidenceSha256: readiness.source.navigationEvidenceSha256,
      manifestSha256: readiness.frozen.manifestSha256,
      baselineCommit: readiness.frozen.baselineCommit,
      candidateFixtureBaselineCommit,
      baselineRunId: readiness.source.baselineRunId,
      repositorySnapshotIdentitySha256: sha256(JSON.stringify(candidateSnapshotIdentity)),
      executionReportSha256: requireSha256(input.executionReportSha256, "executionReportSha256"),
    },
    artifacts: cloneArtifactRefs(artifactRefs),
    diagnostics: [],
  };
}

export async function runNavigationShadowReal(input, dependencies = {}) {
  const platform = requirePlatform(input?.platform);
  const sourceRoot = path.resolve(requireString(input?.sourceRoot, "sourceRoot"));
  const readinessRoot = path.resolve(requireString(input?.readinessRoot, "readinessRoot"));
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
    await assertPathAbsent(path.join(outputRoot, "navigation-shadow-real.json"), "real shadow artifact");
  } else {
    await assertPathAbsent(outputRoot, "output root");
  }
  for (const [target, label] of [
    [sourceRoot, "sourceRoot"],
    [readinessRoot, "readinessRoot"],
    [navigationEvidenceRoot, "navigationEvidenceRoot"],
    [baselineRunRoot, "baselineRunRoot"],
    [fixtureRoot, "fixtureRoot parent"],
    [stateRoot, "stateRoot"],
  ]) {
    await assertDirectory(target, label);
  }

  const readinessPath = path.join(readinessRoot, "navigation-shadow-canary.json");
  const navigationPath = path.join(navigationEvidenceRoot, "navigation-efficiency.json");
  const baselineManifestPath = path.join(baselineRunRoot, "manifest.json");
  const baselineEventsPath = path.join(baselineRunRoot, "events.jsonl");
  const baselineReceiptPath = path.join(baselineRunRoot, "repository-snapshot-receipt.json");
  const [readinessText, navigationEvidenceText, baselineManifestText, baselineEventsText,
    baselineRepositorySnapshotReceiptText] = await Promise.all([
    fs.readFile(readinessPath, "utf-8"),
    fs.readFile(navigationPath, "utf-8"),
    fs.readFile(baselineManifestPath, "utf-8"),
    fs.readFile(baselineEventsPath, "utf-8"),
    fs.readFile(baselineReceiptPath, "utf-8"),
  ]);
  const readiness = JSON.parse(readinessText);
  const navigationEvidence = JSON.parse(navigationEvidenceText);
  validateReadiness(readiness, platform);
  if (readiness.authorization.provider !== provider
    || readiness.authorization.modelId !== modelId
    || readiness.authorization.maxCostCny !== maxTotalCostCny) {
    throw new Error("Real shadow CLI authorization does not match readiness.");
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
      shadowCandidateId: CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_ID,
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
  const artifact = buildNavigationShadowRealArtifact({
    platform,
    generatedAt: finalizeExistingExecution
      ? requireIsoTimestamp(report.generatedAt)
      : generatedAt,
    priorObservedCostCny,
    readiness,
    readinessSha256: sha256(readinessText),
    navigationEvidence,
    navigationEvidenceText,
    baselineManifestText,
    baselineEventsText,
    baselineRepositorySnapshotReceiptText,
    repositorySnapshotReceiptText: contents.repositorySnapshotReceipt,
    report,
    executionReportSha256: sha256(contents.executionReport),
    codingCiManifest: JSON.parse(contents.codingCiManifest),
    events: parseJsonLines(contents.events),
    artifactRefs,
  });
  await fs.writeFile(
    path.join(outputRoot, "navigation-shadow-real.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
    { encoding: "utf-8", flag: "wx" },
  );
  return artifact;
}

export function parseNavigationShadowRealCliArguments(argv) {
  const values = parseNamedArguments(argv);
  return {
    platform: requirePlatform(values.get("platform")),
    sourceRoot: values.get("source-root") ?? defaultSourceRoot,
    readinessRoot: requireString(values.get("readiness-root"), "--readiness-root"),
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

function validateReadiness(readiness, platform) {
  if (readiness.schemaVersion !== "coding-agent-benchmark-navigation-shadow-canary/v1"
    || readiness.status !== "ready_for_authorization"
    || readiness.platform !== platform
    || readiness.candidateId !== CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_ID
    || readiness.frozen?.manifestModified !== false
    || readiness.authorization?.status !== "pending_confirmation"
    || readiness.authorization?.credentialsRead !== false
    || readiness.authorization?.requiresExplicitUserConfirmation !== true
    || readiness.execution?.mode !== "dry-run"
    || readiness.execution?.modelCalls !== 0
    || readiness.execution?.providerCostUsd !== 0) {
    throw new Error("Navigation shadow readiness artifact is not authorization-safe.");
  }
}

function requireSingleRun(report) {
  if (!Array.isArray(report?.runs) || report.runs.length !== 1) {
    throw new Error("Navigation shadow execution report must contain exactly one run.");
  }
  return report.runs[0];
}

function requireTerminalType(events) {
  const type = events.at(-1)?.type;
  if (!["run.completed", "run.failed", "run.cancelled", "run.interrupted"].includes(type)) {
    throw new Error("Navigation shadow events require one terminal event.");
  }
  return type;
}

function cloneArtifactRefs(refs) {
  const required = [
    "executionReport",
    "taskManifest",
    "events",
    "patch",
    "result",
    "codingCiManifest",
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
    throw new Error("Navigation shadow artifact references contain unknown entries.");
  }
  return result;
}

function parseNamedArguments(argv) {
  const supported = new Set([
    "platform",
    "source-root",
    "readiness-root",
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
      throw new Error(`Invalid navigation shadow real argument near ${String(flag ?? "<end>")}.`);
    }
    const key = flag.slice(2);
    if (!supported.has(key)) throw new Error(`Unknown navigation shadow real argument: ${flag}.`);
    if (values.has(key)) throw new Error(`${flag} may only be provided once.`);
    values.set(key, value);
  }
  return values;
}

function parseJsonLines(text) {
  return text.split(/\r?\n/u).filter((line) => line.trim()).map((line) => JSON.parse(line));
}

async function assertDirectory(target, label) {
  const stats = await fs.stat(target).catch(() => null);
  if (!stats?.isDirectory()) throw new Error(`Navigation shadow real ${label} must be a directory.`);
}

async function assertPathAbsent(target, label) {
  const stats = await fs.lstat(target).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (stats) throw new Error(`Navigation shadow real ${label} already exists.`);
}

function requirePlatform(value) {
  const platform = requireString(value, "platform");
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error("Navigation shadow real platform must be windows-native or wsl2-linux.");
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
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error("generatedAt must be an ISO timestamp.");
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
  if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error(`${label} must be a SHA-256.`);
  return hash;
}

function requireSha1(value, label) {
  const hash = requireString(value, label);
  if (!/^[a-f0-9]{40}$/u.test(hash)) throw new Error(`${label} must be a SHA-1.`);
  return hash;
}

export function buildRepositorySnapshotIdentity(text, label = "repository snapshot receipt") {
  let receipt;
  try {
    receipt = JSON.parse(requireString(text, `${label} text`));
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${safeMessage(error)}`);
  }
  const source = requireObject(receipt.source, `${label}.source`);
  const policy = requireObject(receipt.policy, `${label}.policy`);
  if (receipt.schemaVersion !== "coding-agent-benchmark-snapshot-receipt/v1"
    || policy.executionNetwork !== "disabled"
    || source.workspaceDirty !== false) {
    throw new Error(`${label} is not an execution-safe snapshot receipt.`);
  }
  return {
    schemaVersion: receipt.schemaVersion,
    repositoryId: requireString(receipt.repositoryId, `${label}.repositoryId`),
    source: {
      url: requireString(source.url, `${label}.source.url`),
      commit: requireSha1(source.commit, `${label}.source.commit`),
      workspaceDirty: false,
      worktreeContentSha256: requireSha256(
        source.worktreeContentSha256,
        `${label}.source.worktreeContentSha256`,
      ),
      dependencyInputsSha256: requireSha256(
        source.dependencyInputsSha256,
        `${label}.source.dependencyInputsSha256`,
      ),
    },
    policy: { executionNetwork: "disabled" },
  };
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Navigation shadow real requires ${label}.`);
  return value.trim();
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Navigation shadow real requires ${label}.`);
  return value;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Navigation shadow real requires ${label}.`);
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`Navigation shadow real requires ${label}.`);
  return value;
}

function nullableSum(left, right) {
  return Number.isInteger(left) && Number.isInteger(right) ? left + right : null;
}

function normalizeNonNegativeInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
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
  const artifact = await runNavigationShadowReal(
    parseNavigationShadowRealCliArguments(process.argv.slice(2)),
  );
  console.log(
    `[coding-agent-navigation-shadow-real] ${artifact.platform} ${artifact.outcome.status}; costCny=${artifact.authorization.runCostCny}`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(scriptPath)) {
  main().catch((error) => {
    console.error(`[coding-agent-navigation-shadow-real] failed: ${safeMessage(error)}`);
    process.exitCode = 1;
  });
}
