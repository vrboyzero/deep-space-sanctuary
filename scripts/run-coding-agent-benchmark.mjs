import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CODING_AGENT_BENCHMARK_RUN_VERSION,
  createCodingAgentBenchmarkReport,
  loadCodingAgentBenchmarkManifest,
} from "./coding-agent-benchmark-contract.mjs";
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
  buildRecoveredCodingCiArtifacts,
  runCodingRunCursorContinuation,
  startGatewayDisconnectProxy,
} from "./coding-agent-recovery-harness.mjs";
import { executeGatewayProcessRestartCodingCi } from "./coding-agent-process-restart-harness.mjs";
import { collectWorkspaceArtifact, sanitizeDiagnostic } from "./run-coding-agent-ci.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(scriptPath), "..");
const manifestPath = path.join(workspaceRoot, "benchmarks", "coding-agent", "v1", "task-manifest.json");
const codingCiRunnerPath = path.join(workspaceRoot, "scripts", "run-coding-agent-ci.mjs");
const bddEntryPath = path.join(workspaceRoot, "packages", "belldandy-core", "dist", "bin", "bdd.js");

// Keep a 20% reserve against the user-approved 30 CNY ceiling at an 8 CNY/USD guard rate.
export const STAGE_0D_BENCHMARK_USAGE_BUDGET_USD = 3;

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
  const status = usageEvents.length === 0
    ? "not_reached"
    : usage?.source === "provider_reported" ? "provider_reported" : "unavailable";
  return {
    inputTokens: readTokenCount(usage, ["input", "inputTokens", "input_tokens", "promptTokens", "prompt_tokens"]),
    outputTokens: readTokenCount(usage, ["output", "outputTokens", "output_tokens", "completionTokens", "completion_tokens"]),
    observation: {
      status,
      costUsd: status === "provider_reported" ? readNonNegativeNumber(usage?.costUsd) : null,
    },
  };
}

export function createBenchmarkUsageBudget(model) {
  if (model?.credentialsConfigured !== true) return undefined;
  return {
    maxCostUsd: STAGE_0D_BENCHMARK_USAGE_BUDGET_USD,
    remainingCostUsd: STAGE_0D_BENCHMARK_USAGE_BUDGET_USD,
    observedCostUsd: 0,
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

export async function runStage0BSuite(input, dependencies = {}) {
  const runtimePlatform = resolveBenchmarkRuntimePlatform(input, dependencies.runtime);
  assertModelFingerprint(input?.model);
  const fixtureRoot = path.resolve(input.fixtureRoot);
  const artifactRoot = path.resolve(input.artifactRoot);
  const stateRoot = path.resolve(input.stateRoot);
  assertSeparateRoots(fixtureRoot, artifactRoot, "artifactRoot");
  assertSeparateRoots(fixtureRoot, stateRoot, "stateRoot");
  assertSeparateRoots(artifactRoot, stateRoot, "stateRoot");
  await ensureEmptyDirectory(artifactRoot);
  await fs.mkdir(fixtureRoot, { recursive: true });
  await fs.mkdir(stateRoot, { recursive: true });

  const manifestText = await fs.readFile(manifestPath, "utf-8");
  const manifest = await loadCodingAgentBenchmarkManifest(manifestPath);
  await fs.writeFile(path.join(artifactRoot, "task-manifest.json"), manifestText, "utf-8");
  const source = await resolveSourceIdentity();
  const attempt = Number.isInteger(input.attempt) ? input.attempt : 1;
  if (attempt < 1 || attempt > manifest.suite.sampleRuns) {
    throw new Error(`Stage 0B attempt must be within 1-${manifest.suite.sampleRuns}.`);
  }
  const taskIds = resolveTaskIds(input.taskIds);
  const usageBudget = createBenchmarkUsageBudget(input.model);

  const runs = [];
  for (const taskId of taskIds) {
    const runId = input.runIds?.[taskId] ?? createRunId(taskId, runtimePlatform.id, attempt);
    runs.push(await runStage0BTask({
      taskId,
      runId,
      attempt,
      manifest,
      fixtureRoot,
      artifactRoot,
      stateRoot,
      model: input.model,
      runtimePlatform,
      childEnv: input.childEnv,
      maxCostUsd: usageBudget?.remainingCostUsd,
    }, dependencies));
    const budgetDecision = consumeBenchmarkUsageBudget(usageBudget, runs.at(-1)?.usage?.observation);
    if (!budgetDecision.continueRunning) break;
  }

  const report = createCodingAgentBenchmarkReport({
    status: "partial",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    manifest,
    manifestSha256: sha256(manifestText),
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
  const isInteractiveTask = task?.id === STAGE_0C_INTERACTIVE_TASK_ID;
  const isSafetyTask = task?.id === STAGE_0C_SAFETY_TASK_ID;
  const isRecoveryTask = task?.id === STAGE_0C_RECOVERY_TASK_ID;
  const isCancellationTask = task?.id === STAGE_0C_CANCELLATION_TASK_ID;
  const isProcessRestartTask = task?.id === STAGE_0C_PROCESS_RESTART_TASK_ID;
  const isGitLocalTask = STAGE_0C_GIT_TASK_IDS.includes(task?.id);
  const isStage0DCoreTask = STAGE_0D_CORE_TASK_IDS.includes(task?.id);
  if (!task || (!STAGE_0B_TASK_IDS.includes(task.id) && !isInteractiveTask && !isSafetyTask && !isRecoveryTask && !isCancellationTask && !isProcessRestartTask && !isGitLocalTask && !isStage0DCoreTask)) {
    throw new Error(`Benchmark task ${String(input.taskId)} is not implemented by this runner.`);
  }
  const expectedProfile = isInteractiveTask
    ? "command-control"
    : isSafetyTask ? "safety-probe"
      : isRecoveryTask ? "recovery-control"
        : isGitLocalTask ? "git-local"
          : isCancellationTask || isProcessRestartTask ? "plan"
            : isStage0DCoreTask ? task.executionProfile : null;
  if (expectedProfile
    ? task.executionProfile !== expectedProfile
    : task.executionProfile !== "plan" && task.executionProfile !== "workspace-write") {
    throw new Error(`Benchmark task ${task.id} uses an unexpected execution profile.`);
  }

  const workspace = path.join(input.fixtureRoot, input.runId, "workspace");
  const artifactDir = path.join(input.artifactRoot, input.runId);
  const stateDir = input.stateRoot;
  await ensureEmptyDirectory(artifactDir);
  const generateFixture = isInteractiveTask
    ? generateStage0CInteractiveFixture
    : isSafetyTask ? generateStage0CSafetyFixture
        : isRecoveryTask ? generateStage0CRecoveryFixture
          : isCancellationTask ? generateStage0CCancellationFixture
          : isProcessRestartTask ? generateStage0CProcessRestartFixture
        : isGitLocalTask ? generateStage0CGitFixture
          : isStage0DCoreTask ? generateStage0DCoreFixture : generateStage0BFixture;
  const evaluateFixture = isInteractiveTask
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
  });
  const promptPath = path.join(artifactDir, "prompt.md");
  const outputSchemaPath = path.join(artifactDir, "output.schema.json");
  await fs.writeFile(promptPath, `${fixture.prompt}\n`, "utf-8");
  await fs.writeFile(outputSchemaPath, `${JSON.stringify(fixture.outputSchema, null, 2)}\n`, "utf-8");

  const executeCodingCi = isRecoveryTask
    ? dependencies.executeRecoveryCodingCi ?? dependencies.executeCodingCi ?? executeRecoveryCodingCiProcess
    : isProcessRestartTask
      ? dependencies.executeProcessRestartCodingCi ?? executeProcessRestartCodingCiProcess
      : dependencies.executeCodingCi ?? executeCodingCiProcess;
  const startedAt = Date.now();
  const runner = await executeCodingCi({
    workspace,
    artifactDir,
    stateDir,
    conversationId: `coding-benchmark-${input.runId}`,
    modelId: input.model.id,
    promptPath,
    outputSchemaPath,
    mode: task.executionProfile,
    cancelOnRunStart: isCancellationTask,
    childEnv: input.childEnv,
    maxCostUsd: input.maxCostUsd,
  });
  const durationMs = Math.max(0, Date.now() - startedAt);
  await preserveCodingCiManifest(artifactDir, runner.exitCode);
  await ensureCodingCiArtifacts(artifactDir, runner, {
    cancellation: isCancellationTask,
    processRestart: isProcessRestartTask,
  });

  let verdict;
  try {
    verdict = await evaluateFixture({
      task: fixture.task,
      workspace,
      artifactDir,
      runnerExitCode: runner.exitCode,
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
    schemaVersion: CODING_AGENT_BENCHMARK_RUN_VERSION,
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
      budgets: { ...input.manifest.suite.budgets },
      infrastructureRetries: 0,
      ...(input.maxCostUsd === undefined ? {} : { maxCostUsd: input.maxCostUsd }),
    },
    environment: {
      osRelease: os.release(),
      arch: process.arch,
      nodeVersion: process.version,
      packageManager: await readPackageManager(),
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

function resolveTaskIds(value) {
  const taskIds = value === undefined ? [...STAGE_0B_TASK_IDS] : value;
  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    throw new Error("Benchmark taskIds must be a non-empty array.");
  }
  const implemented = new Set([
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

async function executeCodingCiProcess(input) {
  return await new Promise((resolve, reject) => {
    const args = [
      codingCiRunnerPath,
      "--workspace", input.workspace,
      "--state-dir", input.stateDir,
      "--conversation-id", input.conversationId,
      "--model-id", input.modelId,
      "--artifact-dir", input.artifactDir,
      "--prompt-file", input.promptPath,
      "--output-schema", input.outputSchemaPath,
      "--mode", input.mode,
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
  const target = resolveGatewayTarget(input.childEnv);
  const proxy = await startGatewayDisconnectProxy({
    upstreamHost: target.host,
    upstreamPort: target.port,
    upstreamOrigin: `http://${target.host}:${target.port}`,
    targetPath: "src/recovery-target.txt",
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
      bddEntry: bddEntryPath,
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
    bddEntry: bddEntryPath,
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
    ...(options.cancellation ? {
      "cancel-injection.json": `${JSON.stringify({
        schemaVersion: "coding-agent-cancel-injection/v1",
        trigger: "run.started",
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

async function resolveSourceIdentity() {
  const commit = runGit(workspaceRoot, ["rev-parse", "HEAD"]).stdout.trim();
  const dirty = runGit(workspaceRoot, ["status", "--porcelain=v1", "--untracked-files=all"]).stdout.trim();
  const lockfile = await fs.readFile(path.join(workspaceRoot, "pnpm-lock.yaml"));
  return {
    commit,
    workspaceDirty: Boolean(dirty),
    lockfileSha256: crypto.createHash("sha256").update(lockfile).digest("hex"),
  };
}

async function readPackageManager() {
  const packageJson = JSON.parse(await fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8"));
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

async function main() {
  const values = parseNamedArgs(process.argv.slice(2));
  const credentialsValue = requireValue(values, "credentials-configured");
  if (credentialsValue !== "true" && credentialsValue !== "false") {
    throw new Error("--credentials-configured must be true or false.");
  }
  const report = await runStage0BSuite({
    platform: requireValue(values, "platform"),
    fixtureRoot: requireValue(values, "fixture-root"),
    artifactRoot: requireValue(values, "artifact-root"),
    stateRoot: requireValue(values, "state-root"),
    attempt: Number(values.get("attempt") ?? 1),
    ...(values.has("task-id") ? {
      taskIds: requireValue(values, "task-id").split(",").map((taskId) => taskId.trim()),
    } : {}),
    model: {
      provider: requireValue(values, "provider"),
      id: requireValue(values, "model-id"),
      credentialsConfigured: credentialsValue === "true",
    },
  });
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
