import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { createCodingAgentBenchmarkReport, hashCodingAgentBenchmarkManifestText, loadCodingAgentBenchmarkManifest, resolveCodingAgentBenchmarkTaskBudgets } from "./coding-agent-benchmark-contract.mjs";
import { extractBenchmarkTokenUsage } from "./run-coding-agent-benchmark.mjs";
import { resolveBenchmarkRepositoryIdentity } from "./coding-agent-benchmark-preflight.mjs";
import { loadCodingAgentBenchmarkScorecardV3 } from "./coding-agent-benchmark-v3-contract.mjs";
import { loadCodingAgentCandidateDimensionMapping } from "./coding-agent-candidate-score.mjs";
import { evaluateCandidateRunEventGates } from "./coding-agent-candidate-qualification.mjs";
import { validateCodingAgentBenchmarkV3SystemEvidence } from "./coding-agent-benchmark-v3-fixtures.mjs";
import { createCodingAgentBenchmarkCandidateExpectedReportPlan, loadCodingAgentBenchmarkCandidateExpectedReportPlanFile } from "./run-coding-agent-benchmark-expected-report-plan.mjs";
import { assertCandidateOrdinaryPath, assertCandidatePathWithin, candidateSha256, candidateSlotKey, loadCodingAgentCandidateConfig, readCandidateFile } from "./coding-agent-candidate-config.mjs";
import { verifyCandidateRepositoryInputs } from "./verify-coding-agent-candidate-inputs.mjs";
import { assertCandidateContractConsistency } from "./coding-agent-candidate-contract-preflight.mjs";
import { BENCHMARK_APPROVAL_ACCOUNTING_VERSION } from "./coding-agent-benchmark-approval.mjs";
import { verifyBenchmarkApprovalAccounting } from "./coding-agent-benchmark-approval-accounting.mjs";
import { getBenchmarkFixtureApprovalDefinition } from "./coding-agent-benchmark-fixtures.mjs";

const execFile = promisify(execFileCallback);

export async function loadCandidateMaterials(configPath) {
  const { config, configSha256 } = await loadCodingAgentCandidateConfig(configPath);
  if (path.resolve(import.meta.dirname, "..") !== config.windowsHarnessRoot) {
    throw new Error("Candidate operators must execute from the frozen Windows harness.");
  }
  const paths = {
    manifest: path.join(config.windowsHarnessRoot, "benchmarks/coding-agent/v3/task-manifest.json"),
    scorecard: path.join(config.windowsHarnessRoot, "benchmarks/coding-agent/v3/scorecard.json"),
    mapping: path.join(config.windowsHarnessRoot, "benchmarks/coding-agent/v3/candidate-dimension-mapping.json"),
    agents: path.join(config.windowsHarnessRoot, "benchmarks/coding-agent/v2/agents.json"),
  };
  for (const [label, filePath] of Object.entries(paths)) {
    const text = await readCandidateFile(filePath);
    const digest = label === "manifest" ? hashCodingAgentBenchmarkManifestText(text) : candidateSha256(text);
    if (digest !== config.contracts[label]) throw new Error(`Candidate ${label} contract hash drifted.`);
  }
  const manifest = await loadCodingAgentBenchmarkManifest(paths.manifest);
  const scorecard = await loadCodingAgentBenchmarkScorecardV3(paths.scorecard);
  const mapping = await loadCodingAgentCandidateDimensionMapping({ manifest, scorecard, mappingPath: paths.mapping });
  if (config.mode === "formal") assertCandidateContractConsistency({ manifest, scorecard, mapping,
    accountingVersion: BENCHMARK_APPROVAL_ACCOUNTING_VERSION });
  const selectedKeys = new Set(config.selection.map(candidateSlotKey));
  for (const slot of config.selection) {
    const task = manifest.tasks.find((item) => item.id === slot.taskId);
    if (!task || !task.platforms.includes(slot.platform) || slot.attempt > manifest.suite.sampleRuns) {
      throw new Error("Candidate selection is not declared by the frozen manifest.");
    }
    assertCandidateTaskBudget(manifest, slot, config.execution);
  }
  if (config.mode === "formal") {
    const planReference = config.contracts.expectedReportPlan;
    if (candidateSha256(await readCandidateFile(planReference.path)) !== planReference.sha256) throw new Error("Candidate plan hash drifted.");
    const plan = await loadCodingAgentBenchmarkCandidateExpectedReportPlanFile(planReference.path);
    const expected = createCodingAgentBenchmarkCandidateExpectedReportPlan({
      candidateId: config.id, manifest, manifestSha256: config.contracts.manifest,
      source: config.identity, harness: config.identity, reportRoot: config.roots.artifacts,
    });
    assert.deepEqual(plan, expected, "Candidate expected-report plan drifted.");
    if (plan.reports.some((slot) => !selectedKeys.has(candidateSlotKey(slot)))) throw new Error("Candidate formal selection is incomplete.");
  }
  const platforms = new Set(config.selection.map((slot) => slot.platform));
  await assertCandidateOrdinaryPath(config.windowsHarnessRoot);
  assert.deepEqual(await resolveBenchmarkRepositoryIdentity(config.windowsHarnessRoot), config.identity, "Candidate harness identity drifted.");
  if (platforms.has("wsl2-linux")) await assertCandidateOrdinaryPath(config.wsl.harnessRoot);
  for (const platform of platforms) {
    const reference = config.repositoryConfigs[platform];
    if (candidateSha256(await readCandidateFile(reference.path)) !== reference.sha256) throw new Error("Candidate repository inputs drifted.");
    const preparation = JSON.parse(await readCandidateFile(path.join(path.dirname(reference.path), "preparation.json")));
    assert.deepEqual(preparation.identity, config.identity, "Candidate prepared input identity drifted.");
    if (preparation.schemaVersion !== "coding-agent-candidate-input-preparation/v1" || preparation.status !== "ready"
      || preparation.configSha256 !== reference.sha256 || preparation.platform !== (platform === "windows-native" ? "win32" : "linux")) {
      throw new Error("Candidate inputs must be published for this identity and platform.");
    }
    if (platform === "windows-native") {
      await verifyCandidateRepositoryInputs({ manifest, configPath: reference.path });
    } else {
      const nativePath = async (value) => (await execFile("wsl.exe", ["-d", config.wsl.distribution, "--exec", "wslpath", "-a", value],
        { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 })).stdout.trim();
      const harness = await nativePath(config.wsl.harnessRoot);
      const inputPath = await nativePath(reference.path);
      const { stdout } = await execFile("wsl.exe", ["-d", config.wsl.distribution, "--cd", harness, "--exec", "node", "--import", "tsx",
        `${harness}/scripts/verify-coding-agent-candidate-inputs.mjs`, "--harness", harness, "--config", inputPath,
        "--identity-sha256", candidateSha256(JSON.stringify(config.identity))],
      { windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024 });
      const verified = JSON.parse(stdout);
      // Windows Git 经 UNC 会忽略 Linux executable bit；身份必须由目标平台原生 Git 验真。
      assert.deepEqual(verified.identity, config.identity, "Candidate native WSL harness identity drifted.");
      if (verified.configSha256 !== reference.sha256 || verified.repositories !== 4 || verified.receipts !== 4 || verified.preflights !== 8) {
        throw new Error("Candidate WSL repository verification is incomplete.");
      }
    }
  }
  for (const root of Object.values(config.roots)) await assertCandidateOrdinaryPath(root, true);
  const binding = await fs.lstat(path.join(config.roots.ledger, "session-binding.json")).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!binding) {
    for (const root of Object.values(config.roots)) {
      const existing = await fs.lstat(root).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
      if (existing) throw new Error("New candidate output roots must not already exist.");
    }
  }
  const baselineText = await readCandidateFile(config.costBaseline.path);
  if (candidateSha256(baselineText) !== config.costBaseline.sha256) throw new Error("Candidate cost baseline hash drifted.");
  const previous = JSON.parse(baselineText);
  if (!["p2c-candidate-global-cost-ledger/v2", "coding-agent-candidate-cost-ledger/v1"].includes(previous.schemaVersion)
    || !Number.isFinite(previous.providerReportedCostUsd) || previous.providerReportedCostUsd < 0
    || !Number.isFinite(previous.reservedUnknownCostUsd) || previous.reservedUnknownCostUsd < 0) {
    throw new Error("Candidate authoritative cost baseline is invalid.");
  }
  return {
    config, configSha256, manifest, scorecard, mapping, paths,
    journal: {
      workspaceRoot: config.workspaceRoot, costBaseline: config.costBaseline,
      ledgerRoot: config.roots.ledger, configSha256, slots: config.selection,
      baseline: { providerReportedCostUsd: previous.providerReportedCostUsd, reservedUnknownCostUsd: previous.reservedUnknownCostUsd },
    },
  };
}

export function candidateRunPaths(config, slot) {
  const platform = slot.platform === "windows-native" ? "w" : "l";
  const key = candidateSlotKey(slot);
  const taskIndex = [...new Set(config.selection.map((item) => item.taskId))].indexOf(slot.taskId);
  if (taskIndex < 0) throw new Error("Candidate task has no declared runtime path.");
  const taskKey = `t${String(taskIndex + 1).padStart(2, "0")}`;
  return {
    artifactRoot: path.join(config.roots.artifacts, slot.platform, `attempt-${slot.attempt}`, slot.taskId),
    fixtureRoot: path.join(config.roots.fixtures, platform, `a${slot.attempt}`, taskKey),
    stateRoot: path.join(config.roots.state, platform, `a${slot.attempt}`, taskKey),
    journalRoot: path.join(config.roots.ledger, "slots", key),
    bindingPath: path.join(config.roots.artifacts, slot.platform, `attempt-${slot.attempt}`, `${slot.taskId}.candidate.json`),
  };
}

export function assertCandidateTaskBudget(manifest, slot, execution) {
  const budgets = resolveCodingAgentBenchmarkTaskBudgets(manifest, slot.taskId);
  const maxTokens = execution.taskTokenCaps?.[slot.taskId] ?? execution.maxTokens;
  if (budgets.maxTurns > execution.maxTurns || budgets.maxTokens > maxTokens) {
    throw new Error(`Candidate task ${slot.taskId} exceeds the authorized turn/token cap.`);
  }
}

export async function readCandidateRunObservation(context, slot, expectedTerminal) {
  const paths = candidateRunPaths(context.config, slot);
  const reportPath = path.join(paths.artifactRoot, "benchmark-report.json");
  const reportText = await readCandidateFile(reportPath);
  const reportSha256 = candidateSha256(reportText);
  if (expectedTerminal && expectedTerminal.reportSha256 !== reportSha256) throw new Error("Candidate report hash drifted.");
  const report = JSON.parse(reportText);
  assert.deepEqual(report.source, context.config.identity, "Candidate report source identity drifted.");
  assert.deepEqual(report.harness, context.config.identity, "Candidate report harness identity drifted.");
  if (report.schemaVersion !== "coding-agent-benchmark-report/v3" || report.status !== "partial"
    || report.runs?.length !== 1 || report.suite?.manifestSha256 !== context.config.contracts.manifest) {
    throw new Error("Candidate report contract drifted.");
  }
  assert.deepEqual(createCodingAgentBenchmarkReport({ ...report, manifest: context.manifest, manifestSha256: report.suite.manifestSha256 }), report,
    "Candidate report does not rebuild from its run.");
  const [run] = report.runs;
  if (candidateSlotKey(run) !== candidateSlotKey(slot) || run.execution.infrastructureRetries !== 0) {
    throw new Error("Candidate report belongs to another slot or retry.");
  }
  const task = context.manifest.tasks.find((item) => item.id === run.taskId);
  if (task.modelExecution !== "local_fixture" && (run.environment.model.provider !== context.config.execution.provider
    || run.environment.model.id !== context.config.execution.modelId || run.environment.model.credentialsConfigured !== true)) {
    throw new Error("Candidate report model drifted.");
  }
  const artifactHashes = {};
  for (const [label, relativePath] of Object.entries(run.artifacts)) {
    const artifactPath = path.resolve(paths.artifactRoot, relativePath);
    assertCandidatePathWithin(paths.artifactRoot, artifactPath);
    await assertCandidateOrdinaryPath(artifactPath);
    const stats = await fs.lstat(artifactPath);
    if (!stats.isFile() || stats.size > 64 * 1024 * 1024) throw new Error("Candidate artifact is not a bounded ordinary file.");
    artifactHashes[label] = candidateSha256(await fs.readFile(artifactPath));
  }
  const bindingText = await readCandidateFile(paths.bindingPath);
  assert.deepEqual(JSON.parse(bindingText), {
    schemaVersion: "coding-agent-candidate-run-binding/v1", mode: context.config.mode,
    formal: context.config.mode === "formal", configSha256: context.configSha256, slot,
  }, "Candidate evidence use or slot binding drifted.");
  artifactHashes.candidateBinding = candidateSha256(bindingText);
  for (const [label, name] of [["resourceCheck", "resources.json"], ["envCleanup", "env-cleanup.json"]]) {
    const text = await readCandidateFile(path.join(paths.journalRoot, name));
    artifactHashes[label] = candidateSha256(text);
  }
  if (expectedTerminal) assert.deepEqual(artifactHashes, expectedTerminal.artifactHashes, "Candidate artifact hash drifted.");
  const resources = JSON.parse(await readCandidateFile(path.join(paths.journalRoot, "resources.json")));
  const cleanup = JSON.parse(await readCandidateFile(path.join(paths.journalRoot, "env-cleanup.json")));
  if (resources.status !== "passed" || resources.configSha256 !== context.configSha256
    || resources.counts?.some((count) => count !== 0) || !Array.isArray(resources.counts) || resources.counts.length < 3
    || cleanup.status !== "recycled" || cleanup.remaining !== 0 || path.resolve(cleanup.stateRoot) !== paths.stateRoot) {
    throw new Error("Candidate resource or environment cleanup is incomplete.");
  }
  if (resources.sensitiveScan?.status !== "completed"
    || resources.sensitiveScan.unreadableFileCount !== 0 || resources.sensitiveScan.symlinkOrReparsePointCount !== 0
    || !Number.isSafeInteger(resources.sensitiveScan.findingCount) || resources.sensitiveScan.findingCount < 0) {
    throw new Error("Candidate sensitive scan is incomplete.");
  }
  const events = (await readCandidateFile(path.resolve(paths.artifactRoot, run.artifacts.events), 64 * 1024 * 1024))
    .split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
  const approvalDefinition = getBenchmarkFixtureApprovalDefinition({ task, manifestRevision: "v3" });
  if (approvalDefinition) {
    const accounting = await verifyBenchmarkApprovalAccounting({ events,
      contractText: await readCandidateFile(path.resolve(paths.artifactRoot, run.artifacts.approvalContract)),
      evidence: JSON.parse(await readCandidateFile(path.resolve(paths.artifactRoot, run.artifacts.approvalEvidence))),
      expected: { ...approvalDefinition, taskId: task.id, manifestRevision: "v3", runId: run.runId,
        binding: events.find((event) => event.type === "run.started")?.binding,
        fixture: { ...approvalDefinition.fixture, baselineCommit: run.fixture.baselineCommit } },
    });
    if (accounting.manualInterventionCount !== run.evaluation.manualInterventionCount
      || (run.status === "passed" && accounting.status === "failed")) {
      throw new Error("Candidate approval accounting differs from retained permission evidence.");
    }
  }
  const usage = extractBenchmarkTokenUsage(events);
  assert.deepEqual({ inputTokens: run.usage.inputTokens, outputTokens: run.usage.outputTokens, observation: run.usage.observation },
    usage, "Candidate report usage differs from its events.");
  const eventGates = await evaluateCandidateRunEventGates({
    aggregateRoot: paths.artifactRoot, runs: [run], manifestTasksById: new Map([[task.id, task]]),
  });
  let systemCriticalPassed = null;
  if (task.layer === "C") {
    const evidence = JSON.parse(await readCandidateFile(path.resolve(paths.artifactRoot, run.artifacts.systemEvidence)));
    systemCriticalPassed = validateCodingAgentBenchmarkV3SystemEvidence({ evidence, task, runId: run.runId, platform: run.platform }).length === 0;
  }
  const usageComplete = eventGates.incompleteProviderUsageCount === 0
    && (task.modelExecution === "local_fixture" || run.usage.observation.status === "provider_reported");
  const reportedCost = run.usage.observation.status === "provider_reported" ? run.usage.observation.costUsd : 0;
  if (!Number.isFinite(reportedCost) || reportedCost < 0 || reportedCost > 0.1) throw new Error("Candidate observed run cost is invalid.");
  return {
    observation: { run, checks: {
      traceComplete: eventGates.incompleteTraceCount === 0, usageComplete,
      sensitiveFindingCount: resources.sensitiveScan.findingCount, orphanResourceCount: 0, systemCriticalPassed,
    } },
    terminal: {
      status: "reported", reportSha256, artifactHashes,
      providerReportedCostUsd: reportedCost,
      reservedUnknownCostUsd: usageComplete ? 0 : 0.1,
      runnerExit: expectedTerminal?.runnerExit ?? 0,
      resourcesClosed: true,
    },
  };
}
