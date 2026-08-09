import { fork, spawn } from "node:child_process";
import crypto from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SYSTEM_EVIDENCE_VERSION = "coding-agent-benchmark-system-evidence/v1";
const SYSTEM_SCENARIO_VERSION = "coding-agent-benchmark-system-scenario/v1";
const RESTART_TASK_ID = "system.restart-delivery-reconciliation";
const RESTART_CAPABILITY = "restartDeliveryReconciliation";
const RESTART_GENERATOR_ID = "restart-delivery-reconciliation-v1";
const RECONCILIATION_BINDING_VERSION = "coding-agent-benchmark-restart-reconciliation/v1";
const DEFAULT_PROCESS_TIMEOUT_MS = 10_000;
const WSL2_PROCESS_TIMEOUT_MS = 60_000;
const MAX_PROCESS_TIMEOUT_MS = 300_000;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const COMMIT_PATTERN = /^[a-f0-9]{40,64}$/;
const childPath = fileURLToPath(new URL("./coding-agent-benchmark-restart-delivery-child.mjs", import.meta.url));

export async function executeRestartDeliveryReconciliationHarness(input, dependencies) {
  assertRestartHarnessInput(input);
  assertRestartDependencies(dependencies);
  const processTimeoutMs = resolveRestartDeliveryProcessTimeoutMs(
    input.platform,
    input.processTimeoutMs,
  );

  const workspace = path.resolve(input.workspace);
  const stateDir = path.resolve(input.stateDir);
  const scenarioPath = path.join(workspace, "fixture", "system-scenario.json");
  const durablePath = path.join(workspace, "workspace", "durable.txt");
  const [scenarioBytes, initialContent, initialHead, initialMutations] = await Promise.all([
    fs.readFile(scenarioPath),
    fs.readFile(durablePath, "utf-8"),
    readGitHead(workspace),
    collectGitMutations(workspace),
  ]);
  if (initialHead !== input.baselineCommit) {
    throw new Error("Coding benchmark restart delivery baseline commit does not match fixture HEAD.");
  }
  if (initialMutations.length > 0 || normalizeText(initialContent) !== "side-effect-count=0\n") {
    throw new Error("Coding benchmark restart delivery fixture must start at the clean zero-side-effect baseline.");
  }
  const diskScenario = parseJsonObject(scenarioBytes, "restart delivery system scenario");
  if (stableJson(diskScenario) !== stableJson(input.scenario)) {
    throw new Error("Coding benchmark restart delivery system scenario drifted from the bound fixture.");
  }

  await fs.mkdir(stateDir, { recursive: true });
  const runtimeId = sha256(`${input.task.id}\0${input.runId}\0${input.platform}`).slice(0, 20);
  const conversationId = `benchmark-restart-${runtimeId}`;
  const toolCallId = `restart-write-${runtimeId}`;
  const binding = { conversationId, agentRunId: input.runId };
  const childArguments = [
    stateDir,
    workspace,
    input.baselineCommit,
    conversationId,
    input.runId,
    toolCallId,
    dependencies.modulePaths.reconciliationJournal,
    dependencies.modulePaths.workspaceRevision,
    dependencies.modulePaths.userWorktreeRuntime,
    dependencies.modulePaths.fileTool,
  ];
  const children = new Set();
  const userWorktrees = new dependencies.UserWorktreeRuntime(stateDir);
  const journal = new dependencies.CodingRunReconciliationJournal(stateDir);
  let oldResult;
  let newResult;
  let restartInjected = false;
  let evidence;
  let executionError;

  try {
    const oldProcess = startRestartChild("before_restart", childArguments, children, processTimeoutMs);
    oldResult = await oldProcess.result;
    await terminateChild(oldProcess.child, children);
    restartInjected = true;

    if (input.failurePhase === "after_restart") {
      throw new Error("Injected restart delivery failure after restart.");
    }

    const newProcess = startRestartChild("after_restart", childArguments, children, processTimeoutMs);
    newResult = await newProcess.result;
    await waitForCleanExit(newProcess.child, newProcess.stderr, children);

    validateRestartResult(oldResult, newResult);
    const deliveredContent = await fs.readFile(durablePath, "utf-8");
    if (normalizeText(deliveredContent) !== "side-effect-count=1\n") {
      throw new Error("Coding benchmark restart delivery result drifted after local delivery.");
    }
    const reconciliationSha256 = sha256(stableJson({
      schemaVersion: RECONCILIATION_BINDING_VERSION,
      runId: input.runId,
      platform: input.platform,
      oldBindingId: oldResult.processBindingId,
      newBindingId: newResult.processBindingId,
      reconciliation: newResult.reconciliation,
      worktreeId: newResult.worktreeId,
    }));
    evidence = {
      schemaVersion: SYSTEM_EVIDENCE_VERSION,
      taskId: RESTART_TASK_ID,
      generatorId: RESTART_GENERATOR_ID,
      fixtureVersion: 1,
      runId: input.runId,
      platform: input.platform,
      status: "passed",
      sensitiveFindingCount: 0,
      orphanResourceCount: 0,
      duplicateSideEffectCount: newResult.replayedSideEffectCount,
      observations: {
        restartInjected,
        oldBindingId: oldResult.processBindingId,
        newBindingId: newResult.processBindingId,
        reattached: newResult.reattached,
        journalState: newResult.reconciliation.state,
        completedSideEffectCount: newResult.completedSideEffectCount,
        replayedSideEffectCount: newResult.replayedSideEffectCount,
        localDeliveryStatus: newResult.localDeliveryStatus,
        remoteWriteCount: newResult.remoteWriteCount,
        terminalStatus: "completed",
        reconciliationSha256,
      },
    };
  } catch (error) {
    executionError = error;
  }

  const cleanupErrors = [];
  for (const child of [...children]) {
    await terminateChild(child, children).catch((error) => cleanupErrors.push(safeMessage(error)));
  }
  await restoreTrackedWorkspace(workspace).catch((error) => cleanupErrors.push(safeMessage(error)));
  await cleanupUserWorktrees(userWorktrees, binding).catch((error) => cleanupErrors.push(safeMessage(error)));
  await journal.remove(binding).catch((error) => cleanupErrors.push(safeMessage(error)));
  await assertRestartCleanup(workspace, input.baselineCommit, children)
    .catch((error) => cleanupErrors.push(safeMessage(error)));

  if (executionError) {
    if (cleanupErrors.length > 0) {
      throw new Error(`${safeMessage(executionError)} Cleanup failed: ${cleanupErrors.join("; ")}`);
    }
    throw executionError;
  }
  if (cleanupErrors.length > 0) {
    throw new Error(`Coding benchmark restart delivery cleanup failed: ${cleanupErrors.join("; ")}`);
  }
  return evidence;
}

function startRestartChild(phase, args, children, processTimeoutMs) {
  const child = fork(childPath, [phase, ...args], {
    execArgv: [],
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    windowsHide: true,
  });
  children.add(child);
  let stderr = "";
  child.stderr?.setEncoding("utf-8");
  child.stderr?.on("data", (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-16_384);
  });
  return {
    child,
    get stderr() { return stderr; },
    result: waitForChildMessage(
      child,
      phase === "before_restart" ? "side_effect_completed" : "reconciliation_completed",
      () => stderr,
      processTimeoutMs,
    ),
  };
}

function waitForChildMessage(child, expectedType, readStderr, processTimeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Restart delivery child timed out waiting for ${expectedType}. ${readStderr()}`));
    }, processTimeoutMs);
    timer.unref?.();
    const onMessage = (message) => {
      if (message?.type === "error") {
        cleanup();
        reject(new Error(`Restart delivery child failed: ${String(message.message ?? "unknown error")}. ${readStderr()}`));
        return;
      }
      if (message?.type !== expectedType) return;
      cleanup();
      resolve(message);
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`Restart delivery child exited before ${expectedType} with code ${String(code)}. ${readStderr()}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
    };
    child.on("message", onMessage);
    child.on("exit", onExit);
  });
}

export function resolveRestartDeliveryProcessTimeoutMs(platform, configuredTimeoutMs) {
  if (configuredTimeoutMs !== undefined) {
    if (!Number.isInteger(configuredTimeoutMs)
      || configuredTimeoutMs <= 0
      || configuredTimeoutMs > MAX_PROCESS_TIMEOUT_MS) {
      throw new Error("Coding benchmark restart delivery process timeout is invalid.");
    }
    return configuredTimeoutMs;
  }
  if (platform === "wsl2-linux") return WSL2_PROCESS_TIMEOUT_MS;
  if (platform === "windows-native") return DEFAULT_PROCESS_TIMEOUT_MS;
  throw new Error("Coding benchmark restart delivery process timeout platform is invalid.");
}

async function waitForCleanExit(child, stderr, children) {
  if (child.exitCode === null) await once(child, "exit");
  children.delete(child);
  if (child.exitCode !== 0) {
    throw new Error(`Restart delivery child exited with code ${String(child.exitCode)}. ${stderr}`);
  }
}

async function terminateChild(child, children) {
  if (!children.delete(child) || child.exitCode !== null) return;
  const exited = once(child, "exit");
  if (process.platform === "win32" && typeof child.pid === "number") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    await once(killer, "exit");
  } else {
    child.kill("SIGKILL");
  }
  await exited;
}

function validateRestartResult(oldResult, newResult) {
  if (typeof oldResult?.processBindingId !== "string"
    || typeof newResult?.processBindingId !== "string"
    || oldResult.processBindingId === newResult.processBindingId
    || oldResult.worktreeId !== newResult.worktreeId
    || oldResult.completedSideEffectCount !== 1
    || newResult.reattached !== true
    || newResult.completedSideEffectCount !== 1
    || newResult.replayedSideEffectCount !== 0
    || newResult.localDeliveryStatus !== "completed"
    || newResult.remoteWriteCount !== 0
    || newResult.reconciliation?.state !== "applied"
    || newResult.reconciliation?.journalState !== "available"
    || newResult.reconciliation?.appliedOperationCount !== 1
    || newResult.reconciliation?.uncertainOperationCount !== 0) {
    throw new Error("Coding benchmark restart delivery process evidence is invalid.");
  }
}

async function cleanupUserWorktrees(runtime, owner) {
  const worktrees = (await runtime.listStatus()).filter((worktree) => (
    worktree.owner?.conversationId === owner.conversationId
      && worktree.owner?.runId === owner.agentRunId
  ));
  for (const worktree of worktrees) {
    await restoreTrackedWorkspace(worktree.worktreePath);
    const preview = await runtime.preview({ operation: "discard", worktreeId: worktree.worktreeId });
    if (preview.canConfirm !== true || !preview.receipt?.receiptId) {
      throw new Error(`Restart delivery discard is blocked: ${preview.blockers?.join(", ") || "unknown"}`);
    }
    const result = await runtime.confirm({
      operation: "discard",
      worktreeId: worktree.worktreeId,
      receiptId: preview.receipt.receiptId,
      confirm: true,
    });
    if (result.outcome !== "succeeded" || result.applied !== true) {
      throw new Error(`Restart delivery discard failed: ${result.blockers?.join(", ") || result.outcome}`);
    }
  }
}

async function assertRestartCleanup(workspace, baselineCommit, children) {
  const [head, mutations, worktreeList, branches] = await Promise.all([
    readGitHead(workspace),
    collectGitMutations(workspace),
    runGit(["worktree", "list", "--porcelain"], workspace),
    runGit(["branch", "--list", "belldandy-*"], workspace),
  ]);
  const worktreeCount = worktreeList.split(/\r?\n/u).filter((line) => line.startsWith("worktree ")).length;
  if (children.size !== 0 || head !== baselineCommit || mutations.length > 0
    || worktreeCount !== 1 || branches.trim()) {
    throw new Error("Coding benchmark restart delivery left process, repository, or worktree state behind.");
  }
}

function assertRestartHarnessInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Coding benchmark restart delivery harness input must be an object.");
  }
  if (input.scenario?.schemaVersion !== SYSTEM_SCENARIO_VERSION
    || input.scenario?.taskId !== RESTART_TASK_ID
    || input.scenario?.generatorId !== RESTART_GENERATOR_ID
    || input.scenario?.fixtureVersion !== 1
    || input.scenario?.requiredCapability !== RESTART_CAPABILITY
    || input.scenario?.evidenceSchemaVersion !== SYSTEM_EVIDENCE_VERSION) {
    throw new Error("Coding benchmark restart delivery system scenario contract is invalid.");
  }
  if (input.task?.id !== RESTART_TASK_ID
    || input.task?.fixture?.generatorId !== RESTART_GENERATOR_ID
    || input.task?.fixture?.version !== 1) {
    throw new Error("Coding benchmark restart delivery task contract is invalid.");
  }
  if (typeof input.runId !== "string" || input.runId.length > 200 || !RUN_ID_PATTERN.test(input.runId)) {
    throw new Error("Coding benchmark restart delivery runId must be path-safe.");
  }
  if ((input.platform !== "windows-native" && input.platform !== "wsl2-linux")
    || input.scenario.platform !== input.platform) {
    throw new Error("Coding benchmark restart delivery platform binding is invalid.");
  }
  requireNonEmptyString(input.workspace, "restart delivery workspace");
  requireNonEmptyString(input.stateDir, "restart delivery stateDir");
  if (typeof input.baselineCommit !== "string" || !COMMIT_PATTERN.test(input.baselineCommit)) {
    throw new Error("Coding benchmark restart delivery baselineCommit is invalid.");
  }
  if (input.failurePhase !== undefined && input.failurePhase !== "after_restart") {
    throw new Error("Coding benchmark restart delivery failure phase is invalid.");
  }
}

function assertRestartDependencies(dependencies) {
  if (typeof dependencies?.UserWorktreeRuntime !== "function"
    || typeof dependencies?.CodingRunReconciliationJournal !== "function"
    || !dependencies.modulePaths
    || ["reconciliationJournal", "workspaceRevision", "userWorktreeRuntime", "fileTool"]
      .some((name) => typeof dependencies.modulePaths[name] !== "string")) {
    throw new Error("Coding benchmark restart delivery production runtimes are unavailable.");
  }
}

async function restoreTrackedWorkspace(cwd) {
  await runGit(["restore", "--source", "HEAD", "--staged", "--worktree", "--", "."], cwd);
}

async function readGitHead(cwd) {
  return (await runGit(["rev-parse", "HEAD"], cwd)).trim();
}

async function collectGitMutations(cwd) {
  const output = await runGit(["status", "--porcelain=v1", "--untracked-files=all"], cwd);
  return output.split(/\r?\n/u).map((line) => line.trimEnd()).filter(Boolean);
}

async function runGit(args, cwd) {
  const { execFile } = await import("node:child_process");
  return await new Promise((resolve, reject) => {
    execFile("git", args, {
      cwd,
      encoding: "utf-8",
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(String(stderr || error.message)));
        return;
      }
      resolve(String(stdout ?? ""));
    });
  });
}

function parseJsonObject(value, label) {
  let parsed;
  try {
    parsed = JSON.parse(String(value));
  } catch {
    throw new Error(`Coding benchmark ${label} is not valid JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Coding benchmark ${label} must be an object.`);
  }
  return parsed;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Coding benchmark ${label} must be a non-empty string.`);
  }
  return value.trim();
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeText(value) {
  return String(value).replace(/\r\n/g, "\n");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}
