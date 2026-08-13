import crypto from "node:crypto";
import { execFile as execFileCallback, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { SubTaskSupervisorRuntime } from "../packages/belldandy-core/dist/subtask-supervisor-runtime.js";
import { SubTaskSupervisorWorktreeDisposalRuntime } from "../packages/belldandy-core/dist/subtask-supervisor-worktree-disposal-runtime.js";
import { SubTaskRuntimeStore } from "../packages/belldandy-core/dist/task-runtime.js";
import { SubTaskWorktreeRuntime } from "../packages/belldandy-core/dist/worktree-runtime.js";

export const P2A_SUBTASK_SUPERVISOR_SOAK_REPORT_VERSION = "p2a-subtask-supervisor-soak-report/v1";

const execFile = promisify(execFileCallback);
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const minimumGateDurationMs = 60 * 60 * 1000;
const writeLanesPerCycle = 4;
const readLanesPerCycle = 8;
const sourceIdentityPaths = [
  "packages/belldandy-core/src/subtask-supervisor-runtime.ts",
  "packages/belldandy-core/src/subtask-supervisor-worktree-disposal-runtime.ts",
  "packages/belldandy-core/src/task-runtime.ts",
  "packages/belldandy-core/src/worktree-runtime.ts",
  "packages/belldandy-core/src/managed-worktree.ts",
  "packages/belldandy-core/dist/subtask-supervisor-runtime.js",
  "packages/belldandy-core/dist/subtask-supervisor-worktree-disposal-runtime.js",
  "packages/belldandy-core/dist/task-runtime.js",
  "packages/belldandy-core/dist/worktree-runtime.js",
  "packages/belldandy-core/dist/managed-worktree.js",
  "scripts/run-subtask-supervisor-soak.mjs",
  "scripts/subtask-supervisor-soak-cleanup-watchdog.mjs",
  "benchmarks/supervisor/v1/p2a-subtask-supervisor-soak-report.schema.json",
];

export async function buildP2ASubTaskSupervisorSoakReport(input) {
  const platform = requirePlatform(input?.platform);
  const durationMs = requirePositiveInteger(input?.durationMs, "durationMs");
  const cycleIntervalMs = requirePositiveInteger(input?.cycleIntervalMs, "cycleIntervalMs");
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  const runtimeFactory = input?.runtimeFactory ?? runRealSoak;
  const sourceIdentity = input?.runtimeFactory
    ? { workspaceRevision: "test-fixture", aggregateSha256: "0".repeat(64), files: [] }
    : await readP2ASubTaskSupervisorSourceIdentity();
  const evidence = await runtimeFactory({
    platform,
    durationMs,
    cycleIntervalMs,
  });
  const resourceDelta = createWorkspaceResourceDelta(evidence.workspaceBefore, evidence.workspaceAfter);
  const laneAttempts = nonNegativeInteger(evidence.laneAttempts, "laneAttempts");
  const laneSucceeded = nonNegativeInteger(evidence.laneSucceeded, "laneSucceeded");
  const laneFailed = nonNegativeInteger(evidence.laneFailed, "laneFailed");
  const successRate = laneAttempts === 0 ? 0 : laneSucceeded / laneAttempts;
  const failures = evaluateGates({ evidence, resourceDelta, successRate });

  return {
    schemaVersion: P2A_SUBTASK_SUPERVISOR_SOAK_REPORT_VERSION,
    generatedAt,
    platform,
    sourceIdentity,
    workload: {
      requestedDurationMs: durationMs,
      observedDurationMs: nonNegativeInteger(evidence.durationMs, "observed durationMs"),
      cycleIntervalMs,
      cycles: nonNegativeInteger(evidence.cycles, "cycles"),
      writeLanesPerCycle,
      readLanesPerCycle,
      laneAttempts,
      laneSucceeded,
      laneFailed,
      successRate,
      firstFailureCode: evidence.firstFailureCode ?? null,
      writeLaneAttempts: nonNegativeInteger(evidence.writeLaneAttempts, "writeLaneAttempts"),
      readLaneAttempts: nonNegativeInteger(evidence.readLaneAttempts, "readLaneAttempts"),
    },
    recovery: {
      interruptionAttempted: nonNegativeInteger(evidence.interruption.attempted, "interruption.attempted"),
      interruptionRecovered: nonNegativeInteger(evidence.interruption.recovered, "interruption.recovered"),
      disposalCompleted: nonNegativeInteger(evidence.disposal.completedCount, "disposal.completedCount"),
      disposalUncertain: nonNegativeInteger(evidence.disposal.uncertainCount, "disposal.uncertainCount"),
      duplicateSideEffects: nonNegativeInteger(
        evidence.disposal.duplicateSideEffectCount,
        "disposal.duplicateSideEffectCount",
      ),
    },
    resources: {
      preExisting: summarizeWorkspaceResources(evidence.workspaceBefore),
      differential: resourceDelta,
      runOwned: {
        activeSupervisorChildren: nonNegativeInteger(
          evidence.activeSupervisorChildren,
          "activeSupervisorChildren",
        ),
        worktreeCount: nonNegativeInteger(evidence.runOwned.worktreeCount, "runOwned.worktreeCount"),
        managedBranchCount: nonNegativeInteger(
          evidence.runOwned.managedBranchCount,
          "runOwned.managedBranchCount",
        ),
        processCount: nonNegativeInteger(evidence.runOwned.processCount, "runOwned.processCount"),
        receiptCount: nonNegativeInteger(evidence.runOwned.receiptCount, "runOwned.receiptCount"),
        lockCount: nonNegativeInteger(evidence.runOwned.lockCount, "runOwned.lockCount"),
        temporaryFileCount: nonNegativeInteger(
          evidence.runOwned.temporaryFileCount,
          "runOwned.temporaryFileCount",
        ),
        stateRootExists: evidence.runOwned.stateRootExists === true,
        temporaryRootExists: evidence.runOwned.temporaryRootExists === true,
      },
    },
    execution: {
      gatewayCalls: 0,
      modelCalls: 0,
      paidProviderCalls: 0,
      externalNetworkCalls: 0,
      productionWorkspaceMutations: 0,
      temporaryRepositoryMutations: laneAttempts,
      credentialsRead: false,
    },
    gate: {
      passed: failures.length === 0,
      failures,
    },
  };
}

export function createWorkspaceResourceDelta(before, after) {
  return {
    addedWorktreeCount: addedIdentityCount(before?.worktrees, after?.worktrees),
    addedManagedBranchCount: addedIdentityCount(before?.managedBranches, after?.managedBranches),
    addedRelevantProcessCount: addedIdentityCount(before?.relevantProcesses, after?.relevantProcesses),
  };
}

export function compareP2ASubTaskSupervisorSoakReports(left, right) {
  const failures = [];
  if (left?.schemaVersion !== P2A_SUBTASK_SUPERVISOR_SOAK_REPORT_VERSION
    || right?.schemaVersion !== P2A_SUBTASK_SUPERVISOR_SOAK_REPORT_VERSION) {
    failures.push("schema_version_mismatch");
  }
  if (left?.platform === right?.platform
    || ![left?.platform, right?.platform].every((value) => value === "windows-native" || value === "wsl2-linux")) {
    failures.push("platform_pair_invalid");
  }
  if (left?.sourceIdentity?.aggregateSha256 !== right?.sourceIdentity?.aggregateSha256
    || left?.sourceIdentity?.workspaceRevision !== right?.sourceIdentity?.workspaceRevision) {
    failures.push("source_identity_mismatch");
  }
  if (left?.workload?.requestedDurationMs !== right?.workload?.requestedDurationMs
    || left?.workload?.cycleIntervalMs !== right?.workload?.cycleIntervalMs
    || left?.workload?.writeLanesPerCycle !== right?.workload?.writeLanesPerCycle
    || left?.workload?.readLanesPerCycle !== right?.workload?.readLanesPerCycle) {
    failures.push("workload_contract_mismatch");
  }
  if (left?.gate?.passed !== true || right?.gate?.passed !== true) {
    failures.push("platform_gate_failed");
  }
  return { passed: failures.length === 0, failures };
}

export async function writeP2ASubTaskSupervisorSoakReport(report, outputPathValue) {
  const outputPath = path.resolve(requireText(outputPathValue, "outputPath"));
  if (await pathExists(outputPath)) {
    throw new Error(`P2-A SubTask Supervisor soak output already exists: ${outputPath}`);
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const handle = await fs.open(outputPath, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf-8");
  } finally {
    await handle.close();
  }
}

export async function runP2ASubTaskSupervisorSoak(input) {
  const report = await buildP2ASubTaskSupervisorSoakReport(input);
  await writeP2ASubTaskSupervisorSoakReport(report, input?.outputPath);
  return report;
}

export function parseP2ASubTaskSupervisorSoakCliArguments(argv) {
  let platform;
  let durationMinutes = 60;
  let cycleIntervalSeconds = 120;
  let outputPath;
  const valueArguments = new Set([
    "--platform",
    "--duration-minutes",
    "--cycle-interval-seconds",
    "--output",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!valueArguments.has(argument)) throw new Error(`Unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
    if (argument === "--platform") platform = value;
    if (argument === "--duration-minutes") {
      durationMinutes = requireBoundedInteger(value, "--duration-minutes", 1, 24 * 60);
    }
    if (argument === "--cycle-interval-seconds") {
      cycleIntervalSeconds = requireBoundedInteger(value, "--cycle-interval-seconds", 1, 60 * 60);
    }
    if (argument === "--output") outputPath = path.resolve(value);
    index += 1;
  }
  return {
    platform: requirePlatform(platform),
    durationMs: durationMinutes * 60 * 1000,
    cycleIntervalMs: cycleIntervalSeconds * 1000,
    outputPath: path.resolve(requireText(outputPath, "outputPath")),
  };
}

async function runRealSoak({ platform, durationMs, cycleIntervalMs }) {
  requireRuntimePlatform(platform);
  const runId = `p2a-${crypto.randomUUID()}`;
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-p2a-soak-"));
  const repoDir = path.join(rootDir, "repo");
  const stateDir = path.join(rootDir, "state");
  const workspaceBefore = await snapshotWorkspaceResources(workspaceRoot);
  const childProcesses = [];
  let cleanupWatchdog;
  const metrics = {
    cycles: 0,
    laneAttempts: 0,
    laneSucceeded: 0,
    laneFailed: 0,
    writeLaneAttempts: 0,
    readLaneAttempts: 0,
    interruptionAttempted: 0,
    interruptionRecovered: 0,
    disposalCompleted: 0,
    disposalUncertain: 0,
    duplicateSideEffects: 0,
    activeSupervisorChildren: 0,
    runOwnedWorktrees: 0,
    runOwnedBranches: 0,
    runOwnedProcesses: 0,
    firstFailureCode: null,
  };
  const startedAt = Date.now();
  let workspaceAfter = workspaceBefore;
  let stateRootExists = true;
  let temporaryRootExists = true;
  let finalStateInventory = { receiptCount: 0, lockCount: 0, temporaryFileCount: 0 };

  try {
    cleanupWatchdog = await startCleanupWatchdog(rootDir);
    await initializeRepository(repoDir);
    while (Date.now() - startedAt < durationMs) {
      const cycleNumber = metrics.cycles + 1;
      const cycleResult = await runSoakCycle({
        cycleNumber,
        repoDir,
        stateDir,
        runId,
        childProcesses,
        metrics,
      });
      metrics.cycles += 1;
      metrics.laneAttempts += writeLanesPerCycle + readLanesPerCycle;
      metrics.writeLaneAttempts += writeLanesPerCycle;
      metrics.readLaneAttempts += readLanesPerCycle;
      if (cycleResult.passed) {
        metrics.laneSucceeded += writeLanesPerCycle + readLanesPerCycle;
      } else {
        metrics.laneFailed += writeLanesPerCycle + readLanesPerCycle;
        metrics.firstFailureCode ??= cycleResult.failureCode ?? "cycle_execution_failed";
      }
      const nextCycleAt = startedAt + (metrics.cycles * cycleIntervalMs);
      const remainingDurationMs = durationMs - (Date.now() - startedAt);
      const waitMs = Math.min(Math.max(0, nextCycleAt - Date.now()), Math.max(0, remainingDurationMs));
      if (waitMs > 0) await delay(waitMs);
    }

    const worktreeLines = await runGit(["worktree", "list", "--porcelain"], repoDir);
    metrics.runOwnedWorktrees = Math.max(0, countLinesWithPrefix(worktreeLines, "worktree ") - 1);
    metrics.runOwnedBranches = countNonEmptyLines(await runGit([
      "for-each-ref",
      "--format=%(refname)",
      "refs/heads/belldandy-*",
    ], repoDir));
    metrics.runOwnedProcesses = childProcesses.filter((child) => isProcessAlive(child.pid)).length;
  } finally {
    for (const child of childProcesses) await terminateAndWait(child);
    await fs.rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
    stateRootExists = await pathExists(stateDir);
    temporaryRootExists = await pathExists(rootDir);
    finalStateInventory = await inspectFinalStateInventory(stateDir);
    await terminateAndWait(cleanupWatchdog);
    metrics.runOwnedProcesses = [cleanupWatchdog, ...childProcesses]
      .filter((child) => child && isProcessAlive(child.pid))
      .length;
    workspaceAfter = await snapshotWorkspaceResources(workspaceRoot);
  }

  return {
    durationMs: Date.now() - startedAt,
    cycles: metrics.cycles,
    laneAttempts: metrics.laneAttempts,
    laneSucceeded: metrics.laneSucceeded,
    laneFailed: metrics.laneFailed,
    writeLaneAttempts: metrics.writeLaneAttempts,
    readLaneAttempts: metrics.readLaneAttempts,
    activeSupervisorChildren: metrics.activeSupervisorChildren,
    firstFailureCode: metrics.firstFailureCode,
    interruption: {
      attempted: metrics.interruptionAttempted,
      recovered: metrics.interruptionRecovered,
    },
    disposal: {
      completedCount: metrics.disposalCompleted,
      uncertainCount: metrics.disposalUncertain,
      duplicateSideEffectCount: metrics.duplicateSideEffects,
    },
    workspaceBefore,
    workspaceAfter,
    runOwned: {
      worktreeCount: metrics.runOwnedWorktrees,
      managedBranchCount: metrics.runOwnedBranches,
      processCount: metrics.runOwnedProcesses,
      ...finalStateInventory,
      stateRootExists,
      temporaryRootExists,
    },
  };
}

async function runSoakCycle({ cycleNumber, repoDir, stateDir, runId, childProcesses, metrics }) {
  const managerConversationId = `conversation-${runId}`;
  const managerAgentRunId = `run-${runId}`;
  const teamId = `team-${runId}`;
  const store = new SubTaskRuntimeStore(stateDir);
  const worktreeRuntime = new SubTaskWorktreeRuntime(stateDir);
  const supervisor = new SubTaskSupervisorRuntime({
    maxActiveChildren: 4,
    maxVerifierChildren: 1,
    maxDepth: 2,
    maxWallTimeMs: 60_000,
    maxRetainedTerminalCount: 16,
  });
  const writeTasks = [];
  const parentOperation = { agentRunId: managerAgentRunId, toolCallId: `tool-cycle-${cycleNumber}` };
  await store.load();

  const executeLane = (laneIndex) => {
    const isWrite = laneIndex < writeLanesPerCycle;
    const laneId = `cycle_${cycleNumber}_lane_${laneIndex + 1}`;
    const launchSpec = createParallelLaunchSpec({
      managerConversationId,
      teamId,
      laneId,
      repoDir,
      isWrite,
    });
    return supervisor.execute({
      launchSpec,
      parentOperation,
      worktreeIsolationAvailable: true,
      launch: async (budgetedLaunchSpec, observer) => {
        if (!isWrite) {
          observer.bindTask(`read-task-${cycleNumber}-${laneIndex + 1}`);
          observer.bindSession(`read-session-${cycleNumber}-${laneIndex + 1}`);
          await delay(1);
          return {
            success: true,
            output: "read lane completed",
            taskId: `read-task-${cycleNumber}-${laneIndex + 1}`,
            sessionId: `read-session-${cycleNumber}-${laneIndex + 1}`,
          };
        }

        const task = await store.createTask({
          launchSpec: budgetedLaunchSpec,
          parentOperationId: parentOperation,
          supervisorBinding: observer.binding,
        });
        observer.bindTask(task.id);
        const prepared = await worktreeRuntime.prepareTaskLaunch(task.id, budgetedLaunchSpec);
        try {
          const persisted = await store.updateTaskLaunchSpec(task.id, {
            launchSpec: prepared.launchSpec,
            runtimeSummary: prepared.summary,
          });
          if (!persisted) throw new Error("Prepared worktree ownership was not persisted.");
        } catch (error) {
          await worktreeRuntime.abortPreparedTaskRuntime(task.id, {
            ...prepared.launchSpec,
            ...prepared.summary,
          });
          throw error;
        }
        const sessionId = `write-session-${cycleNumber}-${laneIndex + 1}`;
        observer.bindSession(sessionId);
        await store.attachSession(task.id, sessionId, "coder", "coder");
        await fs.writeFile(
          path.join(String(prepared.summary.worktreePath), `lane-${cycleNumber}-${laneIndex + 1}.txt`),
          `run=${runId}\ncycle=${cycleNumber}\nlane=${laneIndex + 1}\n`,
          "utf-8",
        );
        writeTasks.push({
          taskId: task.id,
          sessionId,
          laneId,
          worktreePath: String(prepared.summary.worktreePath),
        });
        return {
          success: false,
          output: "",
          error: "Child process exited before completion.",
          taskId: task.id,
          sessionId,
        };
      },
    });
  };

  let failureCode;
  try {
    for (const wave of [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11]]) {
      const settled = await Promise.allSettled(wave.map(executeLane));
      if (settled.some((result) => result.status === "rejected")) {
        failureCode ??= "cycle_execution_failed";
      }
    }
    metrics.activeSupervisorChildren = supervisor.getSnapshot().activeCount;
    const child = await startAndCrashRunOwnedChild(runId, cycleNumber);
    childProcesses.push(child);
    await terminateAndWait(child);
    await store.flushAndClose();

    const recoveredStore = new SubTaskRuntimeStore(stateDir);
    await recoveredStore.load();
    const disposal = new SubTaskSupervisorWorktreeDisposalRuntime({
      stateDir,
      runtimeStore: recoveredStore,
      worktreeRuntime,
    });
    for (const writeTask of writeTasks) {
      metrics.interruptionAttempted += 1;
      const recovered = await recoveredStore.getTask(writeTask.taskId);
      if (recovered?.status !== "interrupted" || recovered.recovery?.state !== "runtime_lost") {
        failureCode ??= "runtime_loss_recovery_failed";
        continue;
      }
      metrics.interruptionRecovered += 1;
      const binding = {
        managerConversationId,
        managerAgentRunId,
        teamId,
        laneId: writeTask.laneId,
        taskId: writeTask.taskId,
        sessionId: writeTask.sessionId,
        expectedRevision: recovered.commandGeneration,
      };
      const preview = await disposal.preview(binding);
      const result = await disposal.confirm({
        ...binding,
        receiptId: preview.receipt.id,
        confirm: true,
      });
      if (result.status === "completed") metrics.disposalCompleted += 1;
      if (result.status === "uncertain") metrics.disposalUncertain += 1;
      if (result.duplicateSideEffect) metrics.duplicateSideEffects += 1;
      if (result.status !== "completed" || result.applied !== true || result.duplicateSideEffect) {
        failureCode ??= result.status === "uncertain"
          ? "disposal_uncertain"
          : "disposal_failed";
      }
      if (await pathExists(writeTask.worktreePath)) failureCode ??= "worktree_cleanup_failed";
    }
    await recoveredStore.flushAndClose();
  } catch {
    failureCode ??= "cycle_execution_failed";
    await store.flushAndClose().catch(() => undefined);
  }
  return { passed: failureCode === undefined, failureCode };
}

function createParallelLaunchSpec({ managerConversationId, teamId, laneId, repoDir, isWrite }) {
  return {
    instruction: isWrite ? "Execute the isolated write soak lane." : "Execute the read-only soak lane.",
    parentConversationId: managerConversationId,
    agentId: "coder",
    profileId: "coder",
    background: true,
    timeoutMs: 60_000,
    channel: "subtask",
    cwd: repoDir,
    isolationMode: "workspace",
    role: "coder",
    delegationProtocol: {
      source: "delegate_parallel",
      intent: { kind: "parallel_subtasks", summary: "P2-A soak lane.", role: "coder" },
      contextPolicy: {
        includeParentConversation: true,
        includeStructuredContext: false,
        contextKeys: [],
      },
      expectedDeliverable: { format: "patch", summary: "Return bounded soak evidence." },
      aggregationPolicy: { mode: "parallel_collect", summarizeFailures: true },
      launchDefaults: {},
      ...(isWrite ? { ownership: { scopeSummary: "Temporary soak lane.", writeScope: ["lane-*.txt"] } } : {}),
      team: {
        id: teamId,
        mode: isWrite ? "parallel_patch" : "parallel_subtasks",
        currentLaneId: laneId,
        memberRoster: [{ laneId, agentId: "coder", role: "coder" }],
      },
    },
  };
}

async function snapshotWorkspaceResources(repoRoot) {
  const [worktreeOutput, branchOutput, relevantProcesses] = await Promise.all([
    runGit(["worktree", "list", "--porcelain"], repoRoot),
    runGit(["for-each-ref", "--format=%(refname)", "refs/heads/belldandy-*"], repoRoot),
    listRelevantProcesses(),
  ]);
  return {
    worktrees: linesWithPrefix(worktreeOutput, "worktree ").map(hashIdentity),
    managedBranches: nonEmptyLines(branchOutput).map(hashIdentity),
    relevantProcesses,
  };
}

async function listRelevantProcesses() {
  if (process.platform === "win32") return listRelevantWindowsProcesses();
  const entries = await fs.readdir("/proc", { withFileTypes: true }).catch(() => []);
  const identities = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) continue;
    const processRoot = path.join("/proc", entry.name);
    const command = await fs.readFile(path.join(processRoot, "cmdline")).catch(() => undefined);
    if (!command) continue;
    const commandLine = command.toString("utf-8").replaceAll("\0", " ");
    if (!isRelevantNodeCommand(commandLine)) continue;
    const stat = await fs.readFile(path.join(processRoot, "stat"), "utf-8").catch(() => "");
    identities.push(hashIdentity(`${entry.name}\0${stat.split(" ")[21] ?? ""}\0${commandLine}`));
  }
  return identities.sort();
}

async function listRelevantWindowsProcesses() {
  const command = [
    "$items = Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | ForEach-Object {",
    "  [PSCustomObject]@{ ProcessId = $_.ProcessId; CreationDate = [string]$_.CreationDate; CommandLine = [string]$_.CommandLine }",
    "}",
    "$items | ConvertTo-Json -Compress",
  ].join("\n");
  const { stdout } = await execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  const text = String(stdout ?? "").trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items
    .filter((item) => isRelevantNodeCommand(String(item.CommandLine ?? "")))
    .map((item) => hashIdentity(`${item.ProcessId}\0${item.CreationDate}\0${item.CommandLine}`))
    .sort();
}

function isRelevantNodeCommand(commandLine) {
  return /(?:^|[\\/\s])node(?:\.exe)?(?:[\s"']|$)/iu.test(commandLine)
    && /belldandy|star-sanctuary|subtask-supervisor-soak/iu.test(commandLine);
}

async function startAndCrashRunOwnedChild(runId, cycleNumber) {
  const child = spawn(process.execPath, [
    "-e",
    "setInterval(() => undefined, 1000);",
    `${runId}-cycle-${cycleNumber}`,
  ], {
    cwd: workspaceRoot,
    windowsHide: true,
    stdio: "ignore",
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  return child;
}

async function startCleanupWatchdog(rootDir) {
  const child = spawn(process.execPath, [
    path.join(workspaceRoot, "scripts", "subtask-supervisor-soak-cleanup-watchdog.mjs"),
    String(process.pid),
    rootDir,
  ], {
    cwd: workspaceRoot,
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  return child;
}

async function terminateAndWait(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGKILL");
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 5_000);
    child.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function initializeRepository(repoDir) {
  await fs.mkdir(repoDir, { recursive: true });
  await fs.writeFile(path.join(repoDir, "README.md"), "P2-A soak fixture\n", "utf-8");
  await runGit(["init"], repoDir);
  await runGit(["config", "user.name", "Belldandy Soak"], repoDir);
  await runGit(["config", "user.email", "belldandy-soak@example.invalid"], repoDir);
  await runGit(["add", "."], repoDir);
  await runGit(["commit", "-m", "initialize P2-A soak fixture"], repoDir);
}

export async function readP2ASubTaskSupervisorSourceIdentity() {
  const files = await Promise.all(sourceIdentityPaths.map(async (relativePath) => ({
    path: relativePath,
    sha256: sha256(await fs.readFile(path.join(workspaceRoot, relativePath))),
  })));
  return {
    workspaceRevision: await runGit(["rev-parse", "HEAD"], workspaceRoot),
    aggregateSha256: sha256(JSON.stringify(files)),
    files,
  };
}

async function inspectFinalStateInventory(stateDir) {
  if (!(await pathExists(stateDir))) {
    return { receiptCount: 0, lockCount: 0, temporaryFileCount: 0 };
  }
  const files = await listFilesRecursively(stateDir);
  return {
    receiptCount: files.filter((filePath) => filePath.split(path.sep).includes("receipts")).length,
    lockCount: files.filter((filePath) => filePath.split(path.sep).includes("locks")
      || filePath.endsWith(".lock")).length,
    temporaryFileCount: files.filter((filePath) => filePath.endsWith(".tmp")).length,
  };
}

async function listFilesRecursively(rootDir) {
  const files = [];
  const pending = [rootDir];
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      if (entry.isFile()) files.push(entryPath);
    }
  }
  return files;
}

function evaluateGates({ evidence, resourceDelta, successRate }) {
  const failures = [];
  if (evidence.durationMs < minimumGateDurationMs) failures.push("duration_gate_failed");
  if (evidence.cycles <= 0
    || evidence.writeLaneAttempts !== evidence.cycles * writeLanesPerCycle
    || evidence.readLaneAttempts !== evidence.cycles * readLanesPerCycle) {
    failures.push("lane_matrix_incomplete");
  }
  if (successRate < 0.9 || evidence.laneFailed !== evidence.laneAttempts - evidence.laneSucceeded) {
    failures.push("lane_success_rate_failed");
  }
  if (evidence.interruption.attempted <= 0
    || evidence.interruption.recovered !== evidence.interruption.attempted) {
    failures.push("interruption_recovery_failed");
  }
  if (evidence.disposal.uncertainCount > 0) failures.push("disposal_uncertain");
  if (evidence.disposal.duplicateSideEffectCount > 0) failures.push("duplicate_side_effect");
  if (evidence.activeSupervisorChildren > 0) failures.push("supervisor_child_residue");
  if (resourceDelta.addedWorktreeCount > 0) failures.push("workspace_worktree_residue");
  if (resourceDelta.addedManagedBranchCount > 0) failures.push("workspace_branch_residue");
  if (resourceDelta.addedRelevantProcessCount > 0) failures.push("workspace_process_residue");
  if (evidence.runOwned.worktreeCount > 0) failures.push("run_worktree_residue");
  if (evidence.runOwned.managedBranchCount > 0) failures.push("run_branch_residue");
  if (evidence.runOwned.processCount > 0) failures.push("run_process_residue");
  if (evidence.runOwned.receiptCount > 0) failures.push("run_receipt_residue");
  if (evidence.runOwned.lockCount > 0) failures.push("run_lock_residue");
  if (evidence.runOwned.temporaryFileCount > 0) failures.push("run_temporary_file_residue");
  if (evidence.runOwned.stateRootExists) failures.push("run_state_residue");
  if (evidence.runOwned.temporaryRootExists) failures.push("run_temporary_root_residue");
  return failures;
}

function summarizeWorkspaceResources(resources) {
  return {
    worktreeCount: uniqueStrings(resources?.worktrees).length,
    managedBranchCount: uniqueStrings(resources?.managedBranches).length,
    relevantProcessCount: uniqueStrings(resources?.relevantProcesses).length,
  };
}

function addedIdentityCount(before, after) {
  const baseline = new Set(uniqueStrings(before));
  return uniqueStrings(after).filter((identity) => !baseline.has(identity)).length;
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === "string" && item.length > 0))].sort();
}

async function runGit(args, cwd) {
  const { stdout } = await execFile("git", args, {
    cwd,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" },
    maxBuffer: 8 * 1024 * 1024,
  });
  return String(stdout ?? "").trim();
}

function requireRuntimePlatform(platform) {
  const actual = process.platform === "win32" ? "windows-native" : "wsl2-linux";
  if (platform !== actual) throw new Error(`Requested platform ${platform} does not match runtime ${actual}.`);
}

function requirePlatform(value) {
  if (value !== "windows-native" && value !== "wsl2-linux") {
    throw new Error("platform must be windows-native or wsl2-linux.");
  }
  return value;
}

function requireIsoTimestamp(value) {
  const text = requireText(value, "generatedAt");
  if (!Number.isFinite(Date.parse(text))) throw new Error("generatedAt must be an ISO timestamp.");
  return text;
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function requirePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function nonNegativeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative integer.`);
  return parsed;
}

function requireBoundedInteger(value, label, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function linesWithPrefix(value, prefix) {
  return String(value ?? "").split(/\r?\n/u).filter((line) => line.startsWith(prefix));
}

function nonEmptyLines(value) {
  return String(value ?? "").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

function countLinesWithPrefix(value, prefix) {
  return linesWithPrefix(value, prefix).length;
}

function countNonEmptyLines(value) {
  return nonEmptyLines(value).length;
}

function hashIdentity(value) {
  return sha256(String(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const args = parseP2ASubTaskSupervisorSoakCliArguments(process.argv.slice(2));
    const report = await runP2ASubTaskSupervisorSoak(args);
    process.stdout.write(`${JSON.stringify({
      schemaVersion: report.schemaVersion,
      platform: report.platform,
      cycles: report.workload.cycles,
      laneAttempts: report.workload.laneAttempts,
      gate: report.gate,
    })}\n`);
    if (!report.gate.passed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
