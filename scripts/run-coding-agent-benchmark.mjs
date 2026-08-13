import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  CODING_AGENT_BENCHMARK_RUN_VERSION,
  createCodingAgentBenchmarkReport,
  hashCodingAgentBenchmarkManifestText,
  loadCodingAgentBenchmarkManifest,
  resolveCodingAgentBenchmarkTaskBudgets,
  resolveCodingAgentBenchmarkContract,
  resolveCodingAgentBenchmarkManifestPath,
} from "./coding-agent-benchmark-contract.mjs";
import {
  createBenchmarkPreflightArtifact,
  resolveBenchmarkRepositoryIdentity,
} from "./coding-agent-benchmark-preflight.mjs";
import {
  createBenchmarkApprovalContract,
  createNotRunApprovalEvidence,
  serializeBenchmarkApprovalContract,
} from "./coding-agent-benchmark-approval.mjs";
import {
  STAGE_0B_TASK_IDS,
  STAGE_0D_CORE_TASK_IDS,
  STAGE_0C_CANCELLATION_TASK_ID,
  STAGE_0C_GIT_TASK_IDS,
  STAGE_0C_INTERACTIVE_TASK_ID,
  STAGE_0C_PROCESS_RESTART_TASK_ID,
  STAGE_0C_RECOVERY_TASK_ID,
  STAGE_0C_SAFETY_TASK_ID,
  evaluateStage0CInteractiveFixture,
  evaluateStage0CCancellationFixture,
  evaluateStage0CGitFixture,
  evaluateStage0CProcessRestartFixture,
  evaluateStage0CRecoveryFixture,
  evaluateStage0CSafetyFixture,
  evaluateStage0BFixture,
  evaluateStage0DCoreFixture,
  generateStage0CInteractiveFixture,
  generateStage0CCancellationFixture,
  generateStage0CGitFixture,
  generateStage0CProcessRestartFixture,
  generateStage0CRecoveryFixture,
  generateStage0CSafetyFixture,
  generateStage0BFixture,
  generateStage0DCoreFixture,
} from "./coding-agent-benchmark-fixtures.mjs";
import {
  listCodingAgentBenchmarkV3FixtureProviders,
  resolveCodingAgentBenchmarkV3FixtureProvider,
  validateCodingAgentBenchmarkV3SnapshotReceipt,
} from "./coding-agent-benchmark-v3-fixtures.mjs";
import {
  CODING_AGENT_BENCHMARK_BROWSER_SCREENSHOT_ARTIFACT,
  createCodingAgentBenchmarkV3SystemHarness,
} from "./coding-agent-benchmark-system-harness.mjs";
import {
  buildRecoveredCodingCiArtifacts,
  runCodingRunCursorContinuation,
  startGatewayDisconnectProxy,
} from "./coding-agent-recovery-harness.mjs";
import { executeGatewayProcessRestartCodingCi } from "./coding-agent-process-restart-harness.mjs";
import { collectWorkspaceArtifact, sanitizeDiagnostic } from "./run-coding-agent-ci.mjs";
import {
  CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_ID,
} from "./run-coding-agent-benchmark-navigation-efficiency.mjs";
import {
  CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V2_ID,
  buildNavigationCandidateV2Prompt,
} from "./run-coding-agent-benchmark-navigation-candidate-v2.mjs";
import {
  CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_ID,
  buildNavigationCandidateV3Prompt,
} from "./run-coding-agent-benchmark-navigation-candidate-v3.mjs";
import {
  CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID,
  CODE_INTEL_AGENT_UPLIFT_TASK_IDS,
} from "./run-code-intel-agent-uplift-readiness.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(scriptPath), "..");
const codingCiRunnerPath = path.join(workspaceRoot, "scripts", "run-coding-agent-ci.mjs");
export const CODING_AGENT_BENCHMARK_REPOSITORY_INPUTS_VERSION =
  "coding-agent-benchmark-repository-inputs/v1";

// Keep a 20% reserve against the user-approved 30 CNY ceiling at an 8 CNY/USD guard rate.
export const STAGE_0D_BENCHMARK_USAGE_BUDGET_USD = 3;
const MAX_BROWSER_SCREENSHOT_ARTIFACT_BYTES = 5 * 1024 * 1024;

export function resolveBenchmarkRuntimePlatform(input = {}, runtime = {}) {
  const requestedPlatform = input.platform ?? "windows-native";
  const actualPlatform = runtime.platform ?? process.platform;
  const osRelease = runtime.osRelease ?? os.release();
  const env = runtime.env ?? process.env;

  if (requestedPlatform === "windows-native") {
    if (actualPlatform !== "win32") {
      throw new Error("Windows native benchmark runs must execute on win32.");
    }
    return { id: requestedPlatform, wsl: null };
  }

  if (requestedPlatform === "wsl2-linux") {
    const distribution = env.WSL_DISTRO_NAME?.trim();
    if (actualPlatform !== "linux" || !distribution || !/wsl2/i.test(osRelease)) {
      throw new Error("WSL2 benchmark runs require Linux, WSL_DISTRO_NAME, and a WSL2 kernel release.");
    }
    return {
      id: requestedPlatform,
      wsl: { distribution, version: 2 },
    };
  }

  throw new Error(`Unsupported benchmark platform: ${String(requestedPlatform)}.`);
}

export function extractBenchmarkTokenUsage(events) {
  const usageEvents = events.filter((event) => event?.type === "run.usage");
  const usage = usageEvents.at(-1)?.payload?.usage;
  const terminalUsage = events.at(-1)?.payload?.usage;
  const status = usageEvents.length === 0
    ? "not_reached"
    : usage?.source === "provider_reported" && terminalUsage?.status === "complete"
      ? "provider_reported"
      : "unavailable";
  return {
    inputTokens: readTokenCount(usage, ["input", "inputTokens", "input_tokens", "promptTokens", "prompt_tokens"]),
    outputTokens: readTokenCount(usage, ["output", "outputTokens", "output_tokens", "completionTokens", "completion_tokens"]),
    observation: {
      status,
      costUsd: status === "provider_reported" ? readNonNegativeNumber(usage?.costUsd) : null,
    },
  };
}

export function resolvePriorObservedCostUsd(value = 0) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Stage 0D prior observed cost must be a non-negative finite number.");
  }
  const priorObservedCostUsd = roundCostUsd(value);
  if (priorObservedCostUsd >= STAGE_0D_BENCHMARK_USAGE_BUDGET_USD) {
    throw new Error("Stage 0D prior observed cost must remain below the $3.00 usage budget.");
  }
  return priorObservedCostUsd;
}

export function resolveBenchmarkMaximumCostUsd(value = STAGE_0D_BENCHMARK_USAGE_BUDGET_USD) {
  if (!Number.isFinite(value) || value <= 0 || value > STAGE_0D_BENCHMARK_USAGE_BUDGET_USD) {
    throw new Error("Benchmark maximum cost must be within $0.00-$3.00 USD.");
  }
  return roundCostUsd(value);
}

export function createBenchmarkUsageBudget(model, options = {}) {
  const maxCostUsd = resolveBenchmarkMaximumCostUsd(options.maxCostUsd);
  const priorObservedCostUsd = resolvePriorObservedCostUsd(options.priorObservedCostUsd);
  if (priorObservedCostUsd >= maxCostUsd) {
    throw new Error("Benchmark prior observed cost must remain below the selected maximum cost.");
  }
  if (model?.credentialsConfigured !== true) {
    if (priorObservedCostUsd > 0) {
      throw new Error("Stage 0D prior observed cost requires credentialsConfigured=true.");
    }
    return undefined;
  }
  return {
    maxCostUsd,
    remainingCostUsd: roundCostUsd(maxCostUsd - priorObservedCostUsd),
    observedCostUsd: priorObservedCostUsd,
  };
}

export function consumeBenchmarkUsageBudget(budget, observation) {
  if (!budget) return { continueRunning: true, reason: null };
  if (observation?.status !== "provider_reported"
    || !Number.isFinite(observation.costUsd)
    || observation.costUsd < 0) {
    return { continueRunning: false, reason: "usage_unavailable" };
  }
  budget.observedCostUsd = roundCostUsd(budget.observedCostUsd + observation.costUsd);
  budget.remainingCostUsd = roundCostUsd(Math.max(0, budget.maxCostUsd - budget.observedCostUsd));
  return budget.remainingCostUsd > 0
    ? { continueRunning: true, reason: null }
    : { continueRunning: false, reason: "cost_cap_reached" };
}

export function resolveGatewayWorkspacePath(input) {
  const localJoin = path.posix.isAbsolute(input.fixtureRoot) ? path.posix.join : path.join;
  const localWorkspace = localJoin(input.fixtureRoot, input.runId, "workspace");
  if (input.gatewayFixtureRoot === undefined) return localWorkspace;

  const gatewayFixtureRoot = String(input.gatewayFixtureRoot).trim();
  if (!gatewayFixtureRoot || !path.win32.isAbsolute(gatewayFixtureRoot)) {
    throw new Error("gatewayFixtureRoot must be an absolute Windows path.");
  }
  const resolvedRoot = path.win32.resolve(gatewayFixtureRoot);
  const gatewayWorkspace = path.win32.resolve(resolvedRoot, input.runId, "workspace");
  const relative = path.win32.relative(resolvedRoot, gatewayWorkspace);
  if (relative.startsWith("..") || path.win32.isAbsolute(relative)) {
    throw new Error("Gateway workspace must remain inside gatewayFixtureRoot.");
  }
  return gatewayWorkspace;
}

export async function runStage0BSuite(input, dependencies = {}) {
  const runtimePlatform = resolveBenchmarkRuntimePlatform(input, dependencies.runtime);
  assertModelFingerprint(input?.model);
  const manifestRevision = input.manifestRevision ?? "v1";
  const contract = resolveCodingAgentBenchmarkContract(manifestRevision);
  const selectedManifestPath = resolveCodingAgentBenchmarkManifestPath(manifestRevision);
  const manifestText = await fs.readFile(selectedManifestPath, "utf-8");
  const manifest = await loadCodingAgentBenchmarkManifest(selectedManifestPath);
  const taskIds = resolveTaskIds(input.taskIds, manifestRevision, manifest);
  const shadowCandidateId = resolveBenchmarkShadowCandidate({
    candidateId: input.shadowCandidateId,
    manifestRevision,
    taskIds,
  });
  const v3ProviderContexts = manifestRevision === "v3"
    ? await prepareCodingAgentBenchmarkV3ProviderContexts({
        manifest,
        taskIds,
        runtimePlatform,
        repositoryInputs: input.v3RepositoryInputs,
      }, dependencies)
    : new Map();
  const sourceRoot = path.resolve(input.sourceRoot ?? workspaceRoot);
  const fixtureRoot = path.resolve(input.fixtureRoot);
  const gatewayFixtureRoot = resolveGatewayFixtureRoot(input.gatewayFixtureRoot, runtimePlatform);
  const artifactRoot = path.resolve(input.artifactRoot);
  const stateRoot = path.resolve(input.stateRoot);
  assertSeparateRoots(fixtureRoot, artifactRoot, "artifactRoot");
  assertSeparateRoots(fixtureRoot, stateRoot, "stateRoot");
  assertSeparateRoots(artifactRoot, stateRoot, "stateRoot");
  await ensureEmptyDirectory(artifactRoot);
  await fs.mkdir(fixtureRoot, { recursive: true });
  await fs.mkdir(stateRoot, { recursive: true });

  await fs.writeFile(path.join(artifactRoot, "task-manifest.json"), manifestText, "utf-8");
  const resolveIdentity = dependencies.resolveRepositoryIdentity ?? resolveBenchmarkRepositoryIdentity;
  const source = manifestRevision === "v1"
    ? await resolveSourceIdentity(workspaceRoot)
    : await resolveIdentity(sourceRoot);
  const harness = manifestRevision === "v1" ? undefined : await resolveIdentity(workspaceRoot);
  const attempt = Number.isInteger(input.attempt) ? input.attempt : 1;
  if (attempt < 1 || attempt > manifest.suite.sampleRuns) {
    throw new Error(`Stage 0B attempt must be within 1-${manifest.suite.sampleRuns}.`);
  }
  const usageBudget = createBenchmarkUsageBudget(input.model, {
    priorObservedCostUsd: input.priorObservedCostUsd,
    maxCostUsd: input.maxTotalCostUsd,
  });

  const runs = [];
  for (const taskId of taskIds) {
    const runId = input.runIds?.[taskId] ?? createRunId(taskId, runtimePlatform.id, attempt);
    runs.push(await runStage0BTask({
      taskId,
      runId,
      attempt,
      manifest,
      manifestRevision,
      contract,
      manifestSha256: hashCodingAgentBenchmarkManifestText(manifestText),
      sourceRoot,
      fixtureRoot,
      gatewayFixtureRoot,
      artifactRoot,
      stateRoot,
      model: input.model,
      runtimePlatform,
      childEnv: input.childEnv,
      maxCostUsd: usageBudget?.remainingCostUsd,
      ...(shadowCandidateId ? { shadowCandidateId } : {}),
      v3ProviderContext: v3ProviderContexts.get(taskId),
    }, dependencies));
    const budgetDecision = consumeBenchmarkUsageBudget(usageBudget, runs.at(-1)?.usage?.observation);
    if (!budgetDecision.continueRunning) break;
  }

  const report = createCodingAgentBenchmarkReport({
    status: "partial",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    manifest,
    manifestSha256: hashCodingAgentBenchmarkManifestText(manifestText),
    ...(harness ? { harness } : {}),
    source,
    runs,
  });
  await fs.writeFile(
    path.join(artifactRoot, "benchmark-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf-8",
  );
  return report;
}

export async function runStage0BTask(input, dependencies = {}) {
  if (typeof input.runId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.runId)) {
    throw new Error("Stage 0B runId must be path-safe.");
  }
  const task = input.manifest.tasks.find((candidate) => candidate.id === input.taskId);
  const contract = input.contract ?? resolveCodingAgentBenchmarkContract(input.manifestRevision ?? "v1");
  const executionBudgets = resolveCodingAgentBenchmarkTaskBudgets(input.manifest, task?.id);
  const isV3Task = input.manifestRevision === "v3";
  const isInteractiveTask = task?.id === STAGE_0C_INTERACTIVE_TASK_ID;
  const isSafetyTask = task?.id === STAGE_0C_SAFETY_TASK_ID;
  const isRecoveryTask = task?.id === STAGE_0C_RECOVERY_TASK_ID;
  const isCancellationTask = task?.id === STAGE_0C_CANCELLATION_TASK_ID;
  const isProcessRestartTask = task?.id === STAGE_0C_PROCESS_RESTART_TASK_ID;
  const isGitLocalTask = STAGE_0C_GIT_TASK_IDS.includes(task?.id);
  const isStage0DCoreTask = STAGE_0D_CORE_TASK_IDS.includes(task?.id);
  if (!task || (!isV3Task && !STAGE_0B_TASK_IDS.includes(task.id) && !isInteractiveTask && !isSafetyTask && !isRecoveryTask && !isCancellationTask && !isProcessRestartTask && !isGitLocalTask && !isStage0DCoreTask)) {
    throw new Error(`Benchmark task ${String(input.taskId)} is not implemented by this runner.`);
  }
  const expectedProfile = isInteractiveTask
    ? "command-control"
    : isSafetyTask ? "safety-probe"
      : isRecoveryTask ? "recovery-control"
        : isGitLocalTask ? "git-local"
          : isCancellationTask || isProcessRestartTask ? "plan"
            : isStage0DCoreTask ? task.executionProfile : null;
  if (!isV3Task && (expectedProfile
    ? task.executionProfile !== expectedProfile
    : task.executionProfile !== "plan" && task.executionProfile !== "workspace-write")) {
    throw new Error(`Benchmark task ${task.id} uses an unexpected execution profile.`);
  }
  if (isV3Task && input.v3ProviderContext?.provider?.taskId !== task.id) {
    throw new Error(`Benchmark v3 task ${task.id} is missing its bound fixture provider context.`);
  }
  if (input.shadowCandidateId !== undefined) {
    if (input.shadowCandidateId === CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID) {
      if (input.manifestRevision !== "v3"
        || !CODE_INTEL_AGENT_UPLIFT_TASK_IDS.includes(task.id)
        || (task.executionProfile !== "workspace-write" && task.executionProfile !== "command-control")) {
        throw new Error("CodeIntel shadow candidate only supports the frozen v3 uplift cohort.");
      }
    } else if (input.manifestRevision !== "v3"
      || task.id !== "real-js.bug-fix"
      || task.executionProfile !== "workspace-write"
      || ![CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_ID,
        CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V2_ID,
        CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_ID].includes(input.shadowCandidateId)) {
      throw new Error("Navigation shadow candidate only supports v3 real-js.bug-fix workspace-write runs.");
    }
  }

  const workspace = path.join(input.fixtureRoot, input.runId, "workspace");
  const gatewayWorkspace = input.gatewayFixtureRoot === undefined
    ? undefined
    : resolveGatewayWorkspacePath(input);
  const artifactDir = path.join(input.artifactRoot, input.runId);
  const stateDir = input.stateRoot;
  await ensureEmptyDirectory(artifactDir);
  const generateFixture = isV3Task
    ? input.v3ProviderContext.provider.generate
    : isInteractiveTask
    ? generateStage0CInteractiveFixture
    : isSafetyTask ? generateStage0CSafetyFixture
        : isRecoveryTask ? generateStage0CRecoveryFixture
          : isCancellationTask ? generateStage0CCancellationFixture
          : isProcessRestartTask ? generateStage0CProcessRestartFixture
        : isGitLocalTask ? generateStage0CGitFixture
          : isStage0DCoreTask ? generateStage0DCoreFixture : generateStage0BFixture;
  const evaluateFixture = isV3Task
    ? input.v3ProviderContext.provider.evaluate
    : isInteractiveTask
    ? evaluateStage0CInteractiveFixture
    : isSafetyTask ? evaluateStage0CSafetyFixture
        : isRecoveryTask ? evaluateStage0CRecoveryFixture
          : isCancellationTask ? evaluateStage0CCancellationFixture
          : isProcessRestartTask ? evaluateStage0CProcessRestartFixture
        : isGitLocalTask ? evaluateStage0CGitFixture
          : isStage0DCoreTask ? evaluateStage0DCoreFixture : evaluateStage0BFixture;
  const fixture = await generateFixture({
    taskId: task.id,
    workspace,
    manifest: input.manifest,
    platform: input.runtimePlatform.id,
    ...(isV3Task ? input.v3ProviderContext.providerInput : {}),
  });
  if (isV3Task) {
    await writeCodingAgentBenchmarkV3FixtureArtifacts({
      artifactDir,
      provider: input.v3ProviderContext.provider,
      fixture,
    });
  }
  const promptPath = path.join(artifactDir, "prompt.md");
  const outputSchemaPath = path.join(artifactDir, "output.schema.json");
  const prompt = buildNavigationShadowPrompt(fixture.prompt, input.shadowCandidateId);
  await fs.writeFile(promptPath, `${prompt}\n`, "utf-8");
  await fs.writeFile(outputSchemaPath, `${JSON.stringify(fixture.outputSchema, null, 2)}\n`, "utf-8");

  let approval;
  if (contract.revision !== "v1" && (isInteractiveTask || isSafetyTask)) {
    const fixturePath = isInteractiveTask
      ? "fixture/interactive-command.mjs"
      : "fixture/boundary-cases.json";
    const contract = createBenchmarkApprovalContract({
      manifestRevision: input.manifestRevision,
      taskId: task.id,
      runId: input.runId,
      conversationId: `coding-benchmark-${input.runId}`,
      fixture: {
        generatorId: task.fixture.generatorId,
        version: task.fixture.version,
        baselineCommit: fixture.baselineCommit,
        path: fixturePath,
        sha256: sha256(await fs.readFile(path.join(workspace, fixturePath))),
      },
      policy: fixture.approvalPolicy,
    });
    const text = serializeBenchmarkApprovalContract(contract);
    const contractPath = path.join(artifactDir, "approval-contract.json");
    await fs.writeFile(contractPath, text, "utf-8");
    approval = {
      contract,
      contractPath,
      contractSha256: sha256(text),
    };
  }

  const bddEntry = path.join(input.sourceRoot ?? workspaceRoot, "packages", "belldandy-core", "dist", "bin", "bdd.js");
  let preflight;
  if (contract.revision !== "v1") {
    const readEnv = (name) => Object.hasOwn(input.childEnv ?? {}, name)
      ? input.childEnv[name]
      : process.env[name];
    const createPreflight = dependencies.createBenchmarkPreflightArtifact
      ?? createBenchmarkPreflightArtifact;
    preflight = await createPreflight({
      manifestRevision: input.manifestRevision,
      manifest: input.manifest,
      manifestSha256: input.manifestSha256,
      task,
      runId: input.runId,
      sourceRoot: input.sourceRoot,
      stateDir,
      pricingRequired: input.model.credentialsConfigured && !isProcessRestartTask,
      readEnv,
    }, {
      ...(dependencies.probeOciImage ? { probeImage: dependencies.probeOciImage } : {}),
    });
    await writeJson(path.join(artifactDir, "preflight.json"), preflight);
  }

  const executeCodingCi = isRecoveryTask
    ? dependencies.executeRecoveryCodingCi ?? dependencies.executeCodingCi ?? executeRecoveryCodingCiProcess
    : isProcessRestartTask
      ? dependencies.executeProcessRestartCodingCi ?? executeProcessRestartCodingCiProcess
      : dependencies.executeCodingCi ?? executeCodingCiProcess;
  const startedAt = Date.now();
  const runner = preflight?.status === "failed"
    ? {
        exitCode: 4,
        stdout: "",
        stderr: `Benchmark preflight failed: ${summarizeFailedPreflight(preflight)}.`,
      }
    : await executeCodingCi({
        workspace,
        ...(gatewayWorkspace && !isProcessRestartTask ? { gatewayWorkspace } : {}),
        artifactDir,
        stateDir,
        conversationId: `coding-benchmark-${input.runId}`,
        modelId: input.model.id,
        promptPath,
        outputSchemaPath,
        mode: task.executionProfile,
        ...(input.shadowCandidateId ? { shadowCandidateId: input.shadowCandidateId } : {}),
        taskId: task.id,
        manifestRevision: input.manifestRevision ?? "v1",
        sourceRoot: input.sourceRoot ?? workspaceRoot,
        bddEntry,
        cancelOnRunStart: isCancellationTask,
        ...(approval ? { approvalContractPath: approval.contractPath } : {}),
        childEnv: {
          ...input.childEnv,
          ...fixture.executionEnvironment,
        },
        maxCostUsd: contract.revision !== "v1" && isProcessRestartTask ? undefined : input.maxCostUsd,
      });
  const durationMs = Math.max(0, Date.now() - startedAt);
  await preserveCodingCiManifest(artifactDir, runner.exitCode);
  await ensureCodingCiArtifacts(artifactDir, runner, {
    cancellation: isCancellationTask,
    processRestart: isProcessRestartTask,
    manifestRevision: input.manifestRevision ?? "v1",
    ...(approval ? { approval } : {}),
  });
  if (preflight && (isRecoveryTask || isProcessRestartTask)) {
    preflight = await finalizeRuntimeFaultPreflight({
      preflight,
      artifactDir,
      isRecoveryTask,
      isProcessRestartTask,
    });
    await writeJson(path.join(artifactDir, "preflight.json"), preflight);
  }

  let systemEvidence;
  let hasSystemBrowserScreenshot = false;
  if (isV3Task && input.v3ProviderContext.provider.kind === "system") {
    systemEvidence = preflight?.status === "failed"
      ? createNotRunSystemEvidence(task, input.runId, input.runtimePlatform.id)
      : await executeCodingAgentBenchmarkV3SystemHarness({
          harness: input.v3ProviderContext.systemHarness,
          scenario: fixture.systemScenario,
          task,
          runId: input.runId,
          platform: input.runtimePlatform.id,
          workspace,
          artifactDir,
          stateDir,
          sourceRoot: input.sourceRoot ?? workspaceRoot,
          baselineCommit: fixture.baselineCommit,
          executionBudgets,
        });
    const systemEvidenceText = serializeBoundedJsonArtifact(
      systemEvidence,
      "Benchmark v3 system evidence",
    );
    if (task.id === "system.browser-behavior"
      && systemEvidence.schemaVersion === "coding-agent-benchmark-system-evidence/v1") {
      await assertBrowserScreenshotArtifact({ artifactDir, evidence: systemEvidence });
      hasSystemBrowserScreenshot = true;
    }
    await fs.writeFile(path.join(artifactDir, "system-evidence.json"), systemEvidenceText, "utf-8");
  }

  let verdict;
  if (preflight?.status === "failed") {
    verdict = createInfrastructurePreflightVerdict(preflight);
  } else try {
    const result = isV3Task
      ? await readJson(path.join(artifactDir, "result.json")).catch(() => null)
      : undefined;
    verdict = await evaluateFixture({
      task: fixture.task,
      workspace,
      artifactDir,
      runnerExitCode: runner.exitCode,
      manifestRevision: input.manifestRevision ?? "v1",
      ...(isV3Task ? {
        runId: input.runId,
        platform: input.runtimePlatform.id,
        result,
        ...(systemEvidence === undefined ? {} : { systemEvidence }),
      } : {}),
      ...(isGitLocalTask ? { boundary: fixture.boundary } : {}),
      ...(isStage0DCoreTask ? { readonlySnapshot: fixture.readonlySnapshot } : {}),
    });
  } catch (error) {
    verdict = {
      status: "failed",
      failureCategory: "evaluator",
      evaluation: {
        source: "machine",
        taskCompleted: false,
        testsPassed: task.id === "bug.reproducible-fix" || task.id === "feature.cross-file" || isInteractiveTask || isSafetyTask || isRecoveryTask || isCancellationTask || isProcessRestartTask || isGitLocalTask ? false : null,
        patchAccepted: task.id === "bug.reproducible-fix" || task.id === "feature.cross-file" || isRecoveryTask ? false : null,
        regressionCount: task.id === "bug.reproducible-fix" || task.id === "feature.cross-file" || isInteractiveTask || isSafetyTask || isRecoveryTask || isCancellationTask || isProcessRestartTask || isGitLocalTask ? 1 : 0,
        manualInterventionCount: 0,
        dangerousOperationBlocked: isSafetyTask ? false : null,
        recoverySucceeded: isRecoveryTask ? false : null,
      },
      diagnostics: [`Evaluator failed: ${safeMessage(error)}`],
    };
  }

  const events = await readJsonl(path.join(artifactDir, "events.jsonl"));
  const tokenUsage = extractBenchmarkTokenUsage(events);
  const run = {
    schemaVersion: contract.runVersion ?? CODING_AGENT_BENCHMARK_RUN_VERSION,
    runId: input.runId,
    taskId: task.id,
    attempt: input.attempt,
    platform: input.runtimePlatform.id,
    fixture: {
      generatorId: task.fixture.generatorId,
      version: task.fixture.version,
      resetStrategy: task.fixture.resetStrategy,
      baselineCommit: fixture.baselineCommit,
    },
    status: verdict.status,
    failureCategory: verdict.failureCategory,
    execution: {
      profile: task.executionProfile,
      budgets: executionBudgets,
      infrastructureRetries: 0,
      ...(input.maxCostUsd === undefined || (contract.revision !== "v1" && isProcessRestartTask)
        ? {}
        : { maxCostUsd: input.maxCostUsd }),
    },
    environment: {
      osRelease: os.release(),
      arch: process.arch,
      nodeVersion: process.version,
      packageManager: await readPackageManager(input.sourceRoot ?? workspaceRoot),
      wsl: input.runtimePlatform.wsl,
      model: { ...input.model },
    },
    evaluation: verdict.evaluation,
    usage: {
      durationMs,
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
      observation: tokenUsage.observation,
    },
    artifacts: {
      manifest: `${input.runId}/manifest.json`,
      events: `${input.runId}/events.jsonl`,
      result: `${input.runId}/result.json`,
      patch: `${input.runId}/changes.patch`,
      diagnostics: `${input.runId}/diagnostics.log`,
      status: `${input.runId}/status.txt`,
      ...(contract.revision !== "v1" ? { preflight: `${input.runId}/preflight.json` } : {}),
      ...(approval ? {
        approvalContract: `${input.runId}/approval-contract.json`,
        approvalEvidence: `${input.runId}/approval-evidence.json`,
      } : {}),
      ...(isV3Task && input.v3ProviderContext.provider.kind === "repository-snapshot" ? {
        repositorySnapshotPreflight: `${input.runId}/repository-snapshot-preflight.json`,
        repositorySnapshotReceipt: `${input.runId}/repository-snapshot-receipt.json`,
      } : {}),
      ...(isV3Task && input.v3ProviderContext.provider.kind === "system" ? {
        systemScenario: `${input.runId}/system-scenario.json`,
        systemEvidence: `${input.runId}/system-evidence.json`,
        ...(hasSystemBrowserScreenshot ? {
          systemBrowserScreenshot: `${input.runId}/${CODING_AGENT_BENCHMARK_BROWSER_SCREENSHOT_ARTIFACT}`,
        } : {}),
      } : {}),
      ...(isRecoveryTask ? { faultInjection: `${input.runId}/fault-injection.json` } : {}),
      ...(isCancellationTask ? { cancelInjection: `${input.runId}/cancel-injection.json` } : {}),
      ...(isProcessRestartTask ? { restartInjection: `${input.runId}/restart-injection.json` } : {}),
    },
  };
  await appendDiagnostics(artifactDir, runner.stderr, verdict.diagnostics);
  await fs.writeFile(path.join(artifactDir, "manifest.json"), `${JSON.stringify(run, null, 2)}\n`, "utf-8");
  await fs.appendFile(
    path.join(artifactDir, "status.txt"),
    [
      `benchmark_task_id=${task.id}`,
      `benchmark_run_id=${input.runId}`,
      `benchmark_status=${run.status}`,
      `benchmark_failure_category=${run.failureCategory ?? "none"}`,
      "",
    ].join("\n"),
    "utf-8",
  );
  return run;
}

async function prepareCodingAgentBenchmarkV3ProviderContexts(input, dependencies) {
  const defaultProviders = new Map(
    listCodingAgentBenchmarkV3FixtureProviders(input.manifest)
      .map((provider) => [provider.taskId, provider]),
  );
  const contexts = new Map();
  for (const taskId of input.taskIds) {
    const override = dependencies.resolveV3FixtureProvider?.(input.manifest, taskId);
    const provider = override ?? defaultProviders.get(taskId)
      ?? resolveCodingAgentBenchmarkV3FixtureProvider(input.manifest, taskId);
    if (provider.readiness !== "ready") {
      throw new Error(`Coding benchmark v3 fixture provider ${taskId} is not ready: ${provider.readiness}.`);
    }

    let providerInput = {};
    let systemHarness;
    if (provider.kind === "repository-snapshot") {
      const repositoryInput = readV3RepositoryInput(input.repositoryInputs, provider.repositoryId);
      if (!repositoryInput) {
        throw new Error(
          `Coding benchmark v3 repository input for ${provider.repositoryId} is required by task ${taskId}.`,
        );
      }
      providerInput = {
        ...repositoryInput,
        executionNetwork: "disabled",
      };
    } else if (provider.kind === "system") {
      systemHarness = dependencies.v3SystemHarness;
      providerInput = {
        systemCapabilities: systemHarness?.capabilities ?? {},
      };
      if (typeof systemHarness?.execute !== "function") {
        throw new Error(`Coding benchmark v3 system harness is unavailable for task ${taskId}.`);
      }
    }

    const providerPreflight = await provider.preflight({
      ...providerInput,
      manifest: input.manifest,
      taskId,
      platform: input.runtimePlatform.id,
    });
    if (providerPreflight?.status !== "passed") {
      throw new Error(
        `Coding benchmark v3 fixture provider preflight failed for ${taskId}: ${providerPreflight?.reason ?? "unknown"}.`,
      );
    }
    contexts.set(taskId, { provider, providerInput, providerPreflight, systemHarness });
  }
  return contexts;
}

function readV3RepositoryInput(inputs, repositoryId) {
  const value = inputs instanceof Map ? inputs.get(repositoryId) : inputs?.[repositoryId];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof value.repositoryRoot !== "string" || !value.repositoryRoot.trim()
    || typeof value.dependencyCacheRoot !== "string" || !value.dependencyCacheRoot.trim()
    || !value.receipt || typeof value.receipt !== "object" || Array.isArray(value.receipt)) {
    throw new Error(`Coding benchmark v3 repository input for ${repositoryId} is invalid.`);
  }
  return {
    repositoryRoot: path.resolve(value.repositoryRoot),
    dependencyCacheRoot: path.resolve(value.dependencyCacheRoot),
    receipt: structuredClone(value.receipt),
  };
}

export async function loadCodingAgentBenchmarkV3RepositoryInputs(configPath) {
  const resolvedConfigPath = path.resolve(requireConfigString(configPath, "configPath"));
  const configDirectory = path.dirname(resolvedConfigPath);
  let config;
  try {
    config = JSON.parse(await fs.readFile(resolvedConfigPath, "utf-8"));
  } catch (error) {
    throw new Error(`Coding benchmark v3 repository config is unavailable or invalid JSON: ${safeMessage(error)}.`);
  }
  assertExactConfigKeys(
    config,
    ["schemaVersion", "repositories"],
    "Coding benchmark v3 repository config",
  );
  if (config.schemaVersion !== CODING_AGENT_BENCHMARK_REPOSITORY_INPUTS_VERSION) {
    throw new Error("Coding benchmark v3 repository config version is unsupported.");
  }
  if (!Array.isArray(config.repositories) || config.repositories.length === 0) {
    throw new Error("Coding benchmark v3 repository config must contain at least one repository.");
  }

  const manifest = await loadCodingAgentBenchmarkManifest(resolveCodingAgentBenchmarkManifestPath("v3"));
  const manifestRepositoryIds = new Set(manifest.repositories.map((repository) => repository.id));
  const inputs = new Map();
  for (const [index, entry] of config.repositories.entries()) {
    const label = `Coding benchmark v3 repository config entry ${index}`;
    assertExactConfigKeys(entry, [
      "repositoryId",
      "repositoryRoot",
      "dependencyCacheRoot",
      "receiptPath",
    ], label);
    const repositoryId = requireConfigString(entry.repositoryId, `${label}.repositoryId`);
    if (!manifestRepositoryIds.has(repositoryId)) {
      throw new Error(`Coding benchmark v3 repository config references unknown repository ${repositoryId}.`);
    }
    if (inputs.has(repositoryId)) {
      throw new Error(`Coding benchmark v3 repository config contains duplicate repository ${repositoryId}.`);
    }

    const receiptPath = path.resolve(
      configDirectory,
      requireConfigString(entry.receiptPath, `${label}.receiptPath`),
    );
    let receipt;
    try {
      receipt = JSON.parse(await fs.readFile(receiptPath, "utf-8"));
    } catch (error) {
      throw new Error(
        `Coding benchmark v3 snapshot receipt for ${repositoryId} is unavailable or invalid JSON: ${safeMessage(error)}.`,
      );
    }
    if (receipt?.repositoryId !== repositoryId) {
      throw new Error(`Coding benchmark v3 snapshot receipt for ${repositoryId} has a repository binding mismatch.`);
    }
    try {
      validateCodingAgentBenchmarkV3SnapshotReceipt(manifest, receipt);
    } catch (error) {
      throw new Error(`Coding benchmark v3 snapshot receipt for ${repositoryId} is invalid: ${safeMessage(error)}.`);
    }
    inputs.set(repositoryId, {
      repositoryRoot: path.resolve(
        configDirectory,
        requireConfigString(entry.repositoryRoot, `${label}.repositoryRoot`),
      ),
      dependencyCacheRoot: path.resolve(
        configDirectory,
        requireConfigString(entry.dependencyCacheRoot, `${label}.dependencyCacheRoot`),
      ),
      receipt,
    });
  }
  return inputs;
}

function assertExactConfigKeys(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const expected = new Set(expectedKeys);
  const unknown = Object.keys(value).filter((key) => !expected.has(key));
  if (unknown.length > 0) {
    throw new Error(`${label} contains unexpected field ${unknown[0]}.`);
  }
  const missing = expectedKeys.filter((key) => !Object.hasOwn(value, key));
  if (missing.length > 0) {
    throw new Error(`${label} is missing required field ${missing[0]}.`);
  }
}

function requireConfigString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

async function writeCodingAgentBenchmarkV3FixtureArtifacts(input) {
  if (input.provider.kind === "repository-snapshot") {
    await Promise.all([
      writeBoundedJsonArtifact(
        path.join(input.artifactDir, "repository-snapshot-preflight.json"),
        input.fixture.snapshotPreflight,
        "Benchmark v3 repository snapshot preflight",
      ),
      writeBoundedJsonArtifact(
        path.join(input.artifactDir, "repository-snapshot-receipt.json"),
        input.fixture.snapshotReceipt,
        "Benchmark v3 repository snapshot receipt",
      ),
    ]);
  } else if (input.provider.kind === "system") {
    await writeBoundedJsonArtifact(
      path.join(input.artifactDir, "system-scenario.json"),
      input.fixture.systemScenario,
      "Benchmark v3 system scenario",
    );
  }
}

async function executeCodingAgentBenchmarkV3SystemHarness(input) {
  const evidence = await input.harness.execute({
    scenario: structuredClone(input.scenario),
    task: structuredClone(input.task),
    runId: input.runId,
    platform: input.platform,
    workspace: input.workspace,
    artifactDir: input.artifactDir,
    stateDir: input.stateDir,
    sourceRoot: input.sourceRoot,
    baselineCommit: input.baselineCommit,
    budgets: structuredClone(input.executionBudgets),
  });
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error(`Coding benchmark v3 system harness returned invalid evidence for ${input.task.id}.`);
  }
  return evidence;
}

function createNotRunSystemEvidence(task, runId, platform) {
  return {
    schemaVersion: "coding-agent-benchmark-system-evidence-not-run/v1",
    taskId: task.id,
    generatorId: task.fixture.generatorId,
    fixtureVersion: task.fixture.version,
    runId,
    platform,
    status: "not_run",
    reason: "runtime_preflight_failed",
  };
}

async function writeBoundedJsonArtifact(target, value, label) {
  await fs.writeFile(target, serializeBoundedJsonArtifact(value, label), "utf-8");
}

function serializeBoundedJsonArtifact(value, label) {
  assertNoCredentialFields(value, label);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(text, "utf-8") > 1024 * 1024) {
    throw new Error(`${label} exceeds the 1 MiB artifact limit.`);
  }
  return text;
}

async function assertBrowserScreenshotArtifact(input) {
  const target = path.join(input.artifactDir, CODING_AGENT_BENCHMARK_BROWSER_SCREENSHOT_ARTIFACT);
  const stats = await fs.lstat(target).catch(() => null);
  if (!stats?.isFile() || stats.size <= 0 || stats.size > MAX_BROWSER_SCREENSHOT_ARTIFACT_BYTES) {
    throw new Error("Coding benchmark browser screenshot artifact is missing or invalid.");
  }
  const contentSha256 = sha256(await fs.readFile(target));
  if (input.evidence?.observations?.screenshotSha256 !== contentSha256) {
    throw new Error("Coding benchmark browser screenshot artifact hash drifted from system evidence.");
  }
}

function assertNoCredentialFields(value, location) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:apiKey|accessToken|refreshToken|token|secret|clientSecret|password|authorization|cookie|sessionToken|credential|credentials)$/i.test(key)) {
      throw new Error(`${location} contains forbidden credential field ${key}.`);
    }
    assertNoCredentialFields(child, `${location}.${key}`);
  }
}

function resolveTaskIds(value, manifestRevision = "v1", manifest) {
  const taskIds = value === undefined
    ? manifestRevision === "v3" ? manifest.tasks.map((task) => task.id) : [...STAGE_0B_TASK_IDS]
    : value;
  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    throw new Error("Benchmark taskIds must be a non-empty array.");
  }
  const implemented = manifestRevision === "v3"
    ? new Set(manifest.tasks.map((task) => task.id))
    : new Set([
        ...STAGE_0B_TASK_IDS,
        STAGE_0C_INTERACTIVE_TASK_ID,
        STAGE_0C_SAFETY_TASK_ID,
        STAGE_0C_RECOVERY_TASK_ID,
        STAGE_0C_CANCELLATION_TASK_ID,
        STAGE_0C_PROCESS_RESTART_TASK_ID,
        ...STAGE_0C_GIT_TASK_IDS,
        ...STAGE_0D_CORE_TASK_IDS,
      ]);
  const unique = new Set();
  for (const taskId of taskIds) {
    if (typeof taskId !== "string" || !implemented.has(taskId)) {
      throw new Error(`Benchmark task ${String(taskId)} is not implemented by this runner.`);
    }
    if (unique.has(taskId)) throw new Error(`Duplicate benchmark task id: ${taskId}.`);
    unique.add(taskId);
  }
  return [...unique];
}

export function resolveBenchmarkShadowCandidate(input) {
  if (input.candidateId === undefined) return undefined;
  const candidateId = String(input.candidateId).trim();
  if (candidateId === CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID) {
    if (input.manifestRevision !== "v3"
      || !Array.isArray(input.taskIds)
      || input.taskIds.length === 0
      || input.taskIds.some((taskId) => !CODE_INTEL_AGENT_UPLIFT_TASK_IDS.includes(taskId))) {
      throw new Error("CodeIntel shadow candidate requires only the frozen v3 uplift cohort.");
    }
    return candidateId;
  }
  if (input.manifestRevision !== "v3"
    || ![CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_ID,
      CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V2_ID,
      CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_ID].includes(candidateId)
    || JSON.stringify(input.taskIds) !== JSON.stringify(["real-js.bug-fix"])) {
    throw new Error("Navigation shadow candidate requires only v3 real-js.bug-fix.");
  }
  return candidateId;
}

export function buildNavigationShadowPrompt(basePrompt, candidateId) {
  if (candidateId === CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_ID) {
    return buildNavigationCandidateV3Prompt(basePrompt);
  }
  if (candidateId === CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V2_ID) {
    return buildNavigationCandidateV2Prompt(basePrompt);
  }
  return basePrompt;
}

async function executeCodingCiProcess(input) {
  return await new Promise((resolve, reject) => {
    const args = [
      codingCiRunnerPath,
      "--workspace", input.workspace,
      ...(input.gatewayWorkspace ? ["--gateway-workspace", input.gatewayWorkspace] : []),
      "--state-dir", input.stateDir,
      "--conversation-id", input.conversationId,
      "--model-id", input.modelId,
      "--artifact-dir", input.artifactDir,
      "--prompt-file", input.promptPath,
      "--output-schema", input.outputSchemaPath,
      "--mode", input.mode,
      ...(input.shadowCandidateId
        ? ["--shadow-candidate-id", input.shadowCandidateId]
        : []),
      "--manifest-revision", input.manifestRevision,
      ...(input.manifestRevision === "v1" ? [] : ["--task-id", input.taskId]),
      "--source-root", input.sourceRoot,
      "--bdd-entry", input.bddEntry,
      ...(input.approvalContractPath ? ["--approval-contract", input.approvalContractPath] : []),
      ...(input.maxCostUsd === undefined ? [] : ["--max-cost-usd", String(input.maxCostUsd)]),
      ...(input.cancelOnRunStart ? ["--cancel-on-run-start", "true"] : []),
    ];
    const child = spawn(process.execPath, args, {
      cwd: input.workspace,
      env: { ...process.env, ...input.childEnv },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode: exitCode ?? 1, stdout, stderr }));
  });
}

async function executeRecoveryCodingCiProcess(input) {
  const traceContract = await import(pathToFileURL(path.join(
    input.sourceRoot,
    "packages",
    "belldandy-core",
    "dist",
    "coding-run",
    "trace.js",
  )).href);
  const target = resolveGatewayTarget(input.childEnv);
  const proxy = await startGatewayDisconnectProxy({
    upstreamHost: target.host,
    upstreamPort: target.port,
    upstreamOrigin: `http://${target.host}:${target.port}`,
    targetPath: "src/recovery-target.txt",
    workspace: input.workspace,
    requireCompletedMutation: input.manifestRevision !== "v1",
  });
  let runner;
  let fault;
  try {
    runner = await executeCodingCiProcess({
      ...input,
      childEnv: {
        ...input.childEnv,
        BELLDANDY_HOST: proxy.host,
        BELLDANDY_PORT: String(proxy.port),
      },
    });
    fault = proxy.getFault();
    if (!fault) {
      await proxy.close();
      fault = proxy.getFault();
    }
    if (!fault || fault.status !== "injected") {
      await writeJson(path.join(input.artifactDir, "fault-injection.json"), fault ?? {
        schemaVersion: "coding-agent-fault-injection/v1",
        taskId: STAGE_0C_RECOVERY_TASK_ID,
        fault: "gateway_disconnect",
        status: "not_injected",
        disconnectedAfterSeq: null,
        resumedFromSeq: null,
        disconnectCount: 0,
        reconnectCount: 0,
        binding: null,
      });
      return {
        ...runner,
        exitCode: runner.exitCode === 0 ? 4 : runner.exitCode,
        stderr: [
          runner.stderr,
          `Recovery fault was not injected before the Headless run ended; proxy frames=${JSON.stringify(proxy.getTrace())}.`,
        ].filter(Boolean).join("\n"),
      };
    }

    const initialEvents = await readJsonl(path.join(input.artifactDir, "events.jsonl"));
    const initialManifest = await readJson(path.join(input.artifactDir, "manifest.json"));
    const continuation = await runCodingRunCursorContinuation({
      bddEntry: input.bddEntry,
      stateDir: input.stateDir,
      cwd: input.workspace,
      binding: fault.binding,
      cursor: fault.disconnectedAfterSeq,
      timeoutMs: 300_000,
      env: {
        ...input.childEnv,
        BELLDANDY_HOST: target.host,
        BELLDANDY_PORT: String(target.port),
      },
    });
    const workspaceArtifact = collectWorkspaceArtifact({
      workspace: input.workspace,
      mode: "recovery-control",
    });
    const recovered = buildRecoveredCodingCiArtifacts({
      projectCodingRunTraceEvents: traceContract.projectCodingRunTraceEvents,
      validateCodingRunTraceEvents: traceContract.validateCodingRunTraceEvents,
      initialEvents,
      resumedEvents: continuation.events,
      initialManifest,
      workspaceArtifact,
      fault,
    });
    await Promise.all([
      fs.writeFile(
        path.join(input.artifactDir, "events.jsonl"),
        `${recovered.events.map((event) => JSON.stringify(event)).join("\n")}\n`,
        "utf-8",
      ),
      fs.writeFile(
        path.join(input.artifactDir, "trace.jsonl"),
        `${recovered.trace.map((event) => JSON.stringify(event)).join("\n")}\n`,
        "utf-8",
      ),
      writeJson(path.join(input.artifactDir, "result.json"), recovered.result),
      fs.writeFile(path.join(input.artifactDir, "changes.patch"), recovered.patch, "utf-8"),
      writeJson(path.join(input.artifactDir, "manifest.json"), recovered.manifest),
      writeJson(path.join(input.artifactDir, "fault-injection.json"), recovered.fault),
      fs.writeFile(
        path.join(input.artifactDir, "status.txt"),
        [
          `mode=${recovered.manifest.mode}`,
          "cli_exit_code=0",
          "terminal_type=run.completed",
          `changed_paths=${recovered.manifest.changedPaths.length}`,
          "event_contract=true",
          `capability_handshake=${recovered.manifest.checks.capabilityHandshake}`,
          `usage_complete=${recovered.manifest.checks.usageComplete}`,
          `trace_contract=${recovered.manifest.checks.traceContract}`,
          "artifact_policy=true",
          "automatic_push=false",
          "gateway_disconnect_recovered=true",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);
    return {
      exitCode: 0,
      stdout: runner.stdout,
      stderr: [runner.stderr, continuation.stderr].filter(Boolean).join("\n"),
    };
  } catch (error) {
    const failedFault = {
      ...(fault ?? proxy.getFault() ?? {
        schemaVersion: "coding-agent-fault-injection/v1",
        taskId: STAGE_0C_RECOVERY_TASK_ID,
        fault: "gateway_disconnect",
        disconnectedAfterSeq: null,
        disconnectCount: 0,
        binding: null,
      }),
      status: "failed",
      resumedFromSeq: null,
      reconnectCount: 0,
    };
    await writeJson(path.join(input.artifactDir, "fault-injection.json"), failedFault).catch(() => {});
    return {
      exitCode: runner?.exitCode === 0 ? 4 : runner?.exitCode ?? 4,
      stdout: runner?.stdout ?? "",
      stderr: [runner?.stderr, `Recovery harness failed: ${safeMessage(error)}`].filter(Boolean).join("\n"),
    };
  } finally {
    await proxy.close();
  }
}

async function executeProcessRestartCodingCiProcess(input) {
  return await executeGatewayProcessRestartCodingCi({
    ...input,
    bddEntry: input.bddEntry,
    sourceRoot: input.sourceRoot,
    artifactPath: path.join(input.artifactDir, "restart-injection.json"),
    executeCodingCi: executeCodingCiProcess,
  });
}

async function preserveCodingCiManifest(artifactDir, exitCode) {
  const source = path.join(artifactDir, "manifest.json");
  const target = path.join(artifactDir, "coding-ci-manifest.json");
  try {
    await fs.rename(source, target);
  } catch {
    await fs.writeFile(target, `${JSON.stringify({
      cliExitCode: exitCode,
      terminalType: null,
      changedPaths: [],
      checks: { eventContract: false, artifactPolicy: false },
    }, null, 2)}\n`, "utf-8");
  }
}

async function ensureCodingCiArtifacts(artifactDir, runner, options = {}) {
  const defaults = {
    "events.jsonl": "",
    "result.json": "null\n",
    "changes.patch": "",
    "diagnostics.log": sanitizeDiagnostic(runner.stderr),
    "status.txt": `coding_ci_runner_exit_code=${runner.exitCode}\n`,
    ...(options.approval ? {
      "approval-evidence.json": `${JSON.stringify(createNotRunApprovalEvidence({
        manifestRevision: options.manifestRevision,
        taskId: options.approval.contract.taskId,
        runId: options.approval.contract.runId,
        contractSha256: options.approval.contractSha256,
        fixture: options.approval.contract.fixture,
        policyMode: options.approval.contract.policy.mode,
        expectedRequestCount: options.approval.contract.policy.steps.length,
      }), null, 2)}\n`,
    } : {}),
    ...(options.cancellation ? {
      "cancel-injection.json": `${JSON.stringify({
        schemaVersion: "coding-agent-cancel-injection/v1",
        trigger: options.manifestRevision === "v1" ? "run.started" : "message.send.accepted",
        status: "not_observed",
        observedStartedSeq: null,
        cancellationRequestCount: 0,
        cancelExitCode: null,
        binding: null,
        terminalType: null,
        terminalSeq: null,
      }, null, 2)}\n`,
    } : {}),
    ...(options.processRestart ? {
      "restart-injection.json": `${JSON.stringify({
        schemaVersion: "coding-agent-restart-injection/v1",
        taskId: STAGE_0C_PROCESS_RESTART_TASK_ID,
        trigger: "run.started",
        status: "not_injected",
        observedStartedSeq: null,
        messageSendRequestCount: 0,
        binding: null,
        originalGateway: null,
        replacementGateway: null,
        subscription: { exitCode: null, errorCode: null, eventCount: 0, diagnostic: null },
        cancellation: { exitCode: null, accepted: null, state: null },
        projection: {
          beforeRestart: { exitCode: null, ok: false, epoch: null, revision: null, totalCount: null, cursor: null, errorCode: null },
          afterRestart: { exitCode: null, ok: false, errorCode: null },
        },
        cleanup: { managedGatewayProcessCount: 0, originalGateway: null, replacementGateway: null },
      }, null, 2)}\n`,
    } : {}),
  };
  for (const [name, content] of Object.entries(defaults)) {
    const target = path.join(artifactDir, name);
    try {
      await fs.access(target);
    } catch {
      await fs.writeFile(target, content, "utf-8");
    }
  }
}

async function appendDiagnostics(artifactDir, runnerStderr, verdictDiagnostics) {
  const additions = [
    sanitizeDiagnostic(runnerStderr).trim(),
    ...verdictDiagnostics.map((item) => sanitizeDiagnostic(item).trim()),
  ].filter(Boolean);
  if (additions.length === 0) return;
  await fs.appendFile(path.join(artifactDir, "diagnostics.log"), `${additions.join("\n")}\n`, "utf-8");
}

function summarizeFailedPreflight(preflight) {
  return Object.entries(preflight?.checks ?? {})
    .filter(([, check]) => check?.status === "failed")
    .map(([name, check]) => `${name}:${check.reason ?? "unknown"}`)
    .join(", ") || "unknown";
}

function createInfrastructurePreflightVerdict(preflight) {
  return {
    status: "infrastructure_error",
    failureCategory: "infrastructure",
    evaluation: {
      source: "machine",
      taskCompleted: false,
      testsPassed: null,
      patchAccepted: null,
      regressionCount: 0,
      manualInterventionCount: 0,
      dangerousOperationBlocked: null,
      recoverySucceeded: null,
    },
    diagnostics: [`Benchmark preflight failed: ${summarizeFailedPreflight(preflight)}.`],
  };
}

async function finalizeRuntimeFaultPreflight(input) {
  let passed = false;
  let reason = "fault_precondition_not_reached";
  if (input.isRecoveryTask) {
    const fault = await readJson(path.join(input.artifactDir, "fault-injection.json"));
    const mutation = fault?.mutation;
    passed = fault?.status === "recovered"
      && fault.disconnectCount === 1
      && fault.reconnectCount === 1
      && typeof fault.binding?.conversationId === "string"
      && typeof fault.binding?.agentRunId === "string"
      && mutation?.trigger === "successful_tool_result_after_content_change"
      && mutation.resultSuccess === true
      && /^[0-9a-f]{64}$/i.test(String(mutation.beforeSha256 ?? ""))
      && /^[0-9a-f]{64}$/i.test(String(mutation.afterSha256 ?? ""))
      && mutation.beforeSha256 !== mutation.afterSha256;
    if (!passed && fault?.status === "failed") reason = "fault_harness_failed";
  } else if (input.isProcessRestartTask) {
    const restart = await readJson(path.join(input.artifactDir, "restart-injection.json"));
    passed = restart?.status === "confirmed"
      && restart.messageSendRequestCount === 1
      && typeof restart.binding?.conversationId === "string"
      && typeof restart.binding?.agentRunId === "string"
      && Number.isSafeInteger(restart.originalGateway?.pid)
      && Number.isSafeInteger(restart.replacementGateway?.pid)
      && restart.originalGateway.pid !== restart.replacementGateway.pid
      && restart.cleanup?.managedGatewayProcessCount === 0;
    if (!passed && restart?.status === "failed") reason = "fault_harness_failed";
  }
  return {
    ...input.preflight,
    status: passed ? input.preflight.status : "failed",
    checks: {
      ...input.preflight.checks,
      fault: passed
        ? { status: "passed", reason: null }
        : { status: "failed", reason },
    },
  };
}

async function resolveSourceIdentity(repositoryRoot) {
  const commit = runGit(repositoryRoot, ["rev-parse", "HEAD"]).stdout.trim();
  const dirty = runGit(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"]).stdout.trim();
  const lockfile = await fs.readFile(path.join(repositoryRoot, "pnpm-lock.yaml"));
  return {
    commit,
    workspaceDirty: Boolean(dirty),
    lockfileSha256: crypto.createHash("sha256").update(lockfile).digest("hex"),
  };
}

async function readPackageManager(repositoryRoot) {
  const packageJson = JSON.parse(await fs.readFile(path.join(repositoryRoot, "package.json"), "utf-8"));
  return String(packageJson.packageManager);
}

async function readJsonl(target) {
  const content = await fs.readFile(target, "utf-8").catch(() => "");
  const events = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // The Coding CI manifest records invalid JSONL as a product workflow failure.
    }
  }
  return events;
}

async function readJson(target) {
  try {
    return JSON.parse(await fs.readFile(target, "utf-8"));
  } catch {
    return undefined;
  }
}

async function writeJson(target, value) {
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function readTokenCount(usage, keys) {
  for (const key of keys) {
    const value = usage?.[key];
    if (Number.isInteger(value) && value >= 0) return value;
  }
  return null;
}

function readNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function roundCostUsd(value) {
  return Number(value.toFixed(8));
}

function resolveGatewayTarget(childEnv) {
  const host = String(childEnv?.BELLDANDY_HOST ?? process.env.BELLDANDY_HOST ?? "127.0.0.1").trim();
  const port = Number(childEnv?.BELLDANDY_PORT ?? process.env.BELLDANDY_PORT ?? 28889);
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("Recovery benchmark Gateway must use a loopback host.");
  }
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Recovery benchmark Gateway port is invalid.");
  }
  return { host, port };
}

function createRunId(taskId, platform, attempt) {
  const slug = taskId.replace(/[^A-Za-z0-9._-]/g, "-").replace(/\./g, "-");
  const platformSlug = platform === "windows-native" ? "windows" : "wsl2-linux";
  return `${slug}-${platformSlug}-a${attempt}-${Date.now()}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function assertModelFingerprint(model) {
  if (!model || typeof model !== "object" || Array.isArray(model)
    || typeof model.provider !== "string" || !model.provider.trim()
    || typeof model.id !== "string" || !model.id.trim()
    || typeof model.credentialsConfigured !== "boolean") {
    throw new Error("Stage 0B requires provider/model identifiers and credentialsConfigured boolean.");
  }
}

function assertSeparateRoots(fixtureRoot, otherRoot, label) {
  const relative = path.relative(fixtureRoot, otherRoot);
  const reverse = path.relative(otherRoot, fixtureRoot);
  const overlaps = (!relative.startsWith("..") && !path.isAbsolute(relative))
    || (!reverse.startsWith("..") && !path.isAbsolute(reverse));
  if (overlaps) throw new Error(`Stage 0B ${label} must not overlap fixtureRoot.`);
}

async function ensureEmptyDirectory(target) {
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(target);
  if (entries.length > 0) throw new Error(`Stage 0B target directory must be empty: ${target}.`);
}

function runGit(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `git ${args[0]} failed.`);
  return { stdout: result.stdout ?? "" };
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

function parseNamedArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Invalid argument near ${flag ?? "<end>"}.`);
    }
    values.set(flag.slice(2), value);
  }
  return values;
}

function requireValue(values, key) {
  const value = values.get(key);
  if (typeof value !== "string" || !value.trim()) throw new Error(`--${key} is required.`);
  return value.trim();
}

function resolveGatewayFixtureRoot(value, runtimePlatform) {
  if (value === undefined) return undefined;
  if (runtimePlatform.id !== "wsl2-linux") {
    throw new Error("gatewayFixtureRoot is only valid for WSL2 benchmark runs.");
  }
  const gatewayFixtureRoot = String(value).trim();
  if (!gatewayFixtureRoot || !path.win32.isAbsolute(gatewayFixtureRoot)) {
    throw new Error("gatewayFixtureRoot must be an absolute Windows path.");
  }
  return path.win32.resolve(gatewayFixtureRoot);
}

export function resolveBenchmarkCliSourceRoot(values, manifestRevision) {
  return manifestRevision === "v2"
    ? path.resolve(requireValue(values, "source-root"))
    : path.resolve(values.get("source-root") ?? workspaceRoot);
}

async function main() {
  const values = parseNamedArgs(process.argv.slice(2));
  const manifestRevision = values.get("manifest-revision") ?? "v1";
  if (values.has("v3-repository-config") && manifestRevision !== "v3") {
    throw new Error("--v3-repository-config requires --manifest-revision v3.");
  }
  const credentialsValue = requireValue(values, "credentials-configured");
  if (credentialsValue !== "true" && credentialsValue !== "false") {
    throw new Error("--credentials-configured must be true or false.");
  }
  const sourceRoot = resolveBenchmarkCliSourceRoot(values, manifestRevision);
  const v3SystemHarness = manifestRevision === "v3"
    ? await createCodingAgentBenchmarkV3SystemHarness({ sourceRoot })
    : undefined;
  const report = await runStage0BSuite({
    platform: requireValue(values, "platform"),
    manifestRevision,
    sourceRoot,
    fixtureRoot: requireValue(values, "fixture-root"),
    ...(values.has("gateway-fixture-root") ? {
      gatewayFixtureRoot: requireValue(values, "gateway-fixture-root"),
    } : {}),
    artifactRoot: requireValue(values, "artifact-root"),
    stateRoot: requireValue(values, "state-root"),
    attempt: Number(values.get("attempt") ?? 1),
    ...(values.has("task-id") ? {
      taskIds: requireValue(values, "task-id").split(",").map((taskId) => taskId.trim()),
    } : {}),
    ...(values.has("v3-repository-config") ? {
      v3RepositoryInputs: await loadCodingAgentBenchmarkV3RepositoryInputs(
        requireValue(values, "v3-repository-config"),
      ),
    } : {}),
    model: {
      provider: requireValue(values, "provider"),
      id: requireValue(values, "model-id"),
      credentialsConfigured: credentialsValue === "true",
    },
    ...(values.has("prior-observed-cost-usd") ? {
      priorObservedCostUsd: Number(requireValue(values, "prior-observed-cost-usd")),
    } : {}),
    ...(values.has("max-total-cost-usd") ? {
      maxTotalCostUsd: Number(requireValue(values, "max-total-cost-usd")),
    } : {}),
    ...(values.has("shadow-candidate-id") ? {
      shadowCandidateId: requireValue(values, "shadow-candidate-id"),
    } : {}),
  }, v3SystemHarness ? { v3SystemHarness } : {});
  const platform = report.runs[0]?.platform ?? "unknown";
  console.log(
    `[coding-agent-benchmark] wrote ${report.runs.length} ${platform} run(s); passed=${report.summary.passedRunCount}`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(scriptPath)) {
  main().catch((error) => {
    console.error(`[coding-agent-benchmark] ${sanitizeDiagnostic(safeMessage(error))}`);
    process.exitCode = 1;
  });
}
