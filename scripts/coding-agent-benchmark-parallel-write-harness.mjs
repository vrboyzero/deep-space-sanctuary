import { execFile as execFileCallback } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const SYSTEM_EVIDENCE_VERSION = "coding-agent-benchmark-system-evidence/v1";
const SYSTEM_SCENARIO_VERSION = "coding-agent-benchmark-system-scenario/v1";
const PARALLEL_WRITE_TASK_ID = "system.parallel-write-fan-in";
const PARALLEL_WRITE_CAPABILITY = "parallelWriteFanIn";
const PARALLEL_WRITE_GENERATOR_ID = "parallel-write-fan-in-v1";
const BASELINE_BINDING_VERSION = "coding-agent-benchmark-parallel-write-baseline/v1";
const CONFLICT_EVIDENCE_VERSION = "coding-agent-benchmark-parallel-write-conflict/v1";
const DEFAULT_BARRIER_TIMEOUT_MS = 5_000;
const LANE_COUNT = 2;
const CONFLICT_PATH = "workspace/shared.txt";
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const COMMIT_PATTERN = /^[a-f0-9]{40,64}$/;

export async function executeParallelWriteFanInHarness(input, dependencies) {
  assertParallelWriteHarnessInput(input);
  assertParallelWriteDependencies(dependencies);

  const workspace = path.resolve(input.workspace);
  const stateDir = path.resolve(input.stateDir);
  const scenarioPath = path.join(workspace, "fixture", "system-scenario.json");
  const sharedPath = path.join(workspace, ...CONFLICT_PATH.split("/"));
  const [scenarioBytes, initialContent] = await Promise.all([
    fs.readFile(scenarioPath),
    fs.readFile(sharedPath, "utf-8"),
  ]);
  const [initialHead, initialMutations] = await Promise.all([
    readGitHead(workspace),
    collectGitMutations(workspace),
  ]);
  if (initialHead !== input.baselineCommit) {
    throw new Error("Coding benchmark parallel write baseline commit does not match fixture HEAD.");
  }
  if (initialMutations.length > 0) {
    throw new Error("Coding benchmark parallel write fixture must be clean before lane preparation.");
  }
  const diskScenario = parseJsonObject(scenarioBytes, "parallel write system scenario");
  if (stableJson(diskScenario) !== stableJson(input.scenario)) {
    throw new Error("Coding benchmark parallel write system scenario drifted from the bound fixture.");
  }

  const baselineSha256 = sha256([
    BASELINE_BINDING_VERSION,
    input.baselineCommit,
    sha256(scenarioBytes),
    sha256(initialContent),
  ].join("\0"));
  const runtimeId = sha256(`${input.task.id}\0${input.runId}\0${input.platform}`).slice(0, 16);
  const managedWorktrees = new dependencies.ManagedWorktreeRuntime(stateDir);
  const userWorktrees = new dependencies.UserWorktreeRuntime(stateDir);
  const lanes = [];
  let resolutionWorktree;
  let evidence;
  let executionError;

  try {
    for (let index = 0; index < LANE_COUNT; index += 1) {
      const worktree = await managedWorktrees.prepare({
        id: `benchmark-write-${runtimeId}-lane-${index + 1}`,
        ownerKind: "workflow_call",
        cwd: workspace,
      });
      lanes.push({ index, worktree, artifact: undefined });
    }

    const barrier = createTwoLaneBarrier(resolveBarrierTimeoutMs(input.barrierTimeoutMs));
    let results;
    try {
      results = await dependencies.runWorkflowBatch({
        items: lanes.map((lane) => ({ index: lane.index })),
        maxConcurrent: LANE_COUNT,
        limits: {
          maxItems: LANE_COUNT,
          maxQueuedBytes: 16 * 1024,
          maxOutputBytes: 256 * 1024,
        },
        taskIdPrefix: "benchmark_parallel_write",
        async execute(item) {
          await barrier.arrive(item.index);
          const lane = lanes[item.index];
          const laneSharedPath = path.join(lane.worktree.worktreePath, ...CONFLICT_PATH.split("/"));
          await fs.writeFile(laneSharedPath, `lane-${item.index + 1}\n`, "utf-8");
          return {
            laneIndex: item.index,
            headCommit: await readGitHead(lane.worktree.worktreePath),
            mutations: await collectGitMutations(lane.worktree.worktreePath),
          };
        },
      });
    } finally {
      barrier.close();
    }

    if (!Array.isArray(results) || results.length !== LANE_COUNT
      || results.some((result) => result?.ok !== true)) {
      const errors = Array.isArray(results)
        ? results.filter((result) => result?.ok !== true).map((result) => result?.error).filter(Boolean)
        : [];
      throw new Error(
        `Coding benchmark parallel write batch did not complete the two-lane barrier${errors.length > 0 ? `: ${errors.join("; ")}` : "."}`,
      );
    }

    const laneEvidence = [];
    for (let index = 0; index < LANE_COUNT; index += 1) {
      const result = results[index];
      const lane = lanes[index];
      if (result.value?.laneIndex !== index || result.value?.headCommit !== input.baselineCommit
        || !Array.isArray(result.value?.mutations)
        || result.value.mutations.length !== 1
        || !result.value.mutations[0].endsWith(CONFLICT_PATH)) {
        throw new Error("Coding benchmark parallel write lane snapshot or mutation drifted.");
      }
      lane.artifact = await managedWorktrees.collectArtifact(lane.worktree);
      if (lane.artifact.status !== "complete"
        || lane.artifact.trackedChanges.length !== 1
        || lane.artifact.trackedChanges[0] !== CONFLICT_PATH
        || typeof lane.artifact.patchPath !== "string") {
        throw new Error("Coding benchmark parallel write lane artifact is incomplete.");
      }
      laneEvidence.push({
        laneId: requireBoundedString(result.taskId, "parallel write lane taskId", 300),
        worktreeId: lane.worktree.id,
        baselineSha256,
        terminalStatus: "completed",
        mutationCount: result.value.mutations.length,
      });
    }

    resolutionWorktree = await userWorktrees.create({
      cwd: workspace,
      owner: {
        conversationId: `benchmark-parallel-write-${runtimeId}`,
        runId: input.runId,
      },
    });
    if (resolutionWorktree.status !== "ready"
      || resolutionWorktree.baseCommit !== input.baselineCommit) {
      throw new Error("Coding benchmark parallel write resolution worktree is unavailable.");
    }

    await runGitApply(lanes[0].artifact.patchPath, resolutionWorktree.worktreePath);
    const conflictCheck = await requireGitApplyConflict(
      lanes[1].artifact.patchPath,
      resolutionWorktree.worktreePath,
    );
    const lanePatchSha256 = await Promise.all(lanes.map(async (lane) => {
      return sha256(await fs.readFile(lane.artifact.patchPath));
    }));
    const conflictEvidenceSha256 = sha256(stableJson({
      schemaVersion: CONFLICT_EVIDENCE_VERSION,
      path: CONFLICT_PATH,
      detected: true,
      exitCode: conflictCheck.exitCode,
      lanePatchSha256,
    }));

    const resolutionPath = path.join(resolutionWorktree.worktreePath, ...CONFLICT_PATH.split("/"));
    await fs.writeFile(resolutionPath, "lane-1\nlane-2\n", "utf-8");
    const preview = await userWorktrees.preview({
      operation: "apply",
      worktreeId: resolutionWorktree.worktreeId,
    });
    if (preview.canConfirm !== true || !preview.receipt?.receiptId
      || !preview.patch?.sha256 || preview.target?.head !== input.baselineCommit) {
      throw new Error("Coding benchmark parallel write fan-in preview is not confirmable.");
    }

    const [headBeforeFanIn, mutationsBeforeFanIn, contentBeforeFanIn] = await Promise.all([
      readGitHead(workspace),
      collectGitMutations(workspace),
      fs.readFile(sharedPath, "utf-8"),
    ]);
    const mainWorkspaceChangedBeforeFanIn = headBeforeFanIn !== input.baselineCommit
      || mutationsBeforeFanIn.length > 0
      || contentBeforeFanIn !== initialContent;
    if (mainWorkspaceChangedBeforeFanIn) {
      throw new Error("Coding benchmark parallel write changed the main workspace before fan-in.");
    }

    const confirmation = await userWorktrees.confirm({
      operation: "apply",
      worktreeId: resolutionWorktree.worktreeId,
      receiptId: preview.receipt.receiptId,
      confirm: true,
    });
    if (confirmation.outcome !== "succeeded" || confirmation.applied !== true) {
      throw new Error("Coding benchmark parallel write fan-in confirmation did not succeed.");
    }
    const resultContent = await fs.readFile(sharedPath, "utf-8");
    const normalizedResultContent = normalizeText(resultContent);
    if (normalizedResultContent !== "lane-1\nlane-2\n") {
      throw new Error("Coding benchmark parallel write fan-in result drifted.");
    }

    evidence = {
      schemaVersion: SYSTEM_EVIDENCE_VERSION,
      taskId: PARALLEL_WRITE_TASK_ID,
      generatorId: PARALLEL_WRITE_GENERATOR_ID,
      fixtureVersion: 1,
      runId: input.runId,
      platform: input.platform,
      status: "passed",
      sensitiveFindingCount: 0,
      orphanResourceCount: 0,
      duplicateSideEffectCount: 0,
      observations: {
        mainWorkspaceChangedBeforeFanIn,
        lanes: laneEvidence,
        conflict: {
          detected: true,
          path: CONFLICT_PATH,
          evidenceSha256: conflictEvidenceSha256,
        },
        fanIn: {
          mode: "preview-confirm",
          previewSha256: preview.patch.sha256,
          confirmed: true,
          status: "completed",
          resultSha256: sha256(normalizedResultContent),
        },
      },
    };
  } catch (error) {
    executionError = error;
  }

  const cleanupErrors = await cleanupParallelWriteHarness({
    workspace,
    managedWorktrees,
    userWorktrees,
    resolutionWorktree,
    lanes,
  });
  await assertParallelWriteCleanup(workspace, input.baselineCommit)
    .catch((error) => cleanupErrors.push(safeMessage(error)));
  if (executionError) {
    if (cleanupErrors.length > 0) {
      throw new Error(`${safeMessage(executionError)} Cleanup failed: ${cleanupErrors.join("; ")}`);
    }
    throw executionError;
  }
  if (cleanupErrors.length > 0) {
    throw new Error(`Coding benchmark parallel write cleanup failed: ${cleanupErrors.join("; ")}`);
  }
  return evidence;
}

async function cleanupParallelWriteHarness(input) {
  const errors = [];
  await restoreTrackedWorkspace(input.workspace).catch((error) => errors.push(safeMessage(error)));

  if (input.resolutionWorktree) {
    try {
      await restoreTrackedWorkspace(input.resolutionWorktree.worktreePath);
      const preview = await input.userWorktrees.preview({
        operation: "discard",
        worktreeId: input.resolutionWorktree.worktreeId,
      });
      if (preview.canConfirm !== true || !preview.receipt?.receiptId) {
        throw new Error(`resolution discard is blocked: ${preview.blockers?.join(", ") || "unknown"}`);
      }
      const result = await input.userWorktrees.confirm({
        operation: "discard",
        worktreeId: input.resolutionWorktree.worktreeId,
        receiptId: preview.receipt.receiptId,
        confirm: true,
      });
      if (result.outcome !== "succeeded" || result.applied !== true) {
        throw new Error(`resolution discard failed: ${result.blockers?.join(", ") || result.outcome}`);
      }
    } catch (error) {
      errors.push(safeMessage(error));
    }
  }

  for (const lane of [...input.lanes].reverse()) {
    try {
      const artifact = lane.artifact ?? await input.managedWorktrees.collectArtifact(lane.worktree);
      const cleanup = await input.managedWorktrees.cleanup(lane.worktree, artifact);
      if (cleanup.status !== "removed") {
        throw new Error(`${lane.worktree.id} ${cleanup.status}: ${cleanup.reason ?? "unknown"}`);
      }
    } catch (error) {
      errors.push(safeMessage(error));
    }
  }
  return errors;
}

async function assertParallelWriteCleanup(workspace, baselineCommit) {
  const [head, mutations, worktreeList, branches] = await Promise.all([
    readGitHead(workspace),
    collectGitMutations(workspace),
    runGit(["worktree", "list", "--porcelain"], workspace),
    runGit(["branch", "--list", "belldandy-*"], workspace),
  ]);
  const worktreeCount = worktreeList.split(/\r?\n/u).filter((line) => line.startsWith("worktree ")).length;
  if (head !== baselineCommit || mutations.length > 0 || worktreeCount !== 1 || branches.trim()) {
    throw new Error("Coding benchmark parallel write left repository or worktree state behind.");
  }
}

function assertParallelWriteHarnessInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Coding benchmark parallel write harness input must be an object.");
  }
  if (input.scenario?.schemaVersion !== SYSTEM_SCENARIO_VERSION
    || input.scenario?.taskId !== PARALLEL_WRITE_TASK_ID
    || input.scenario?.generatorId !== PARALLEL_WRITE_GENERATOR_ID
    || input.scenario?.fixtureVersion !== 1
    || input.scenario?.requiredCapability !== PARALLEL_WRITE_CAPABILITY
    || input.scenario?.evidenceSchemaVersion !== SYSTEM_EVIDENCE_VERSION) {
    throw new Error("Coding benchmark parallel write system scenario contract is invalid.");
  }
  if (input.task?.id !== PARALLEL_WRITE_TASK_ID
    || input.task?.fixture?.generatorId !== PARALLEL_WRITE_GENERATOR_ID
    || input.task?.fixture?.version !== 1) {
    throw new Error("Coding benchmark parallel write task contract is invalid.");
  }
  if (typeof input.runId !== "string" || input.runId.length > 200
    || !RUN_ID_PATTERN.test(input.runId)) {
    throw new Error("Coding benchmark parallel write runId must be path-safe.");
  }
  if ((input.platform !== "windows-native" && input.platform !== "wsl2-linux")
    || input.scenario.platform !== input.platform) {
    throw new Error("Coding benchmark parallel write platform binding is invalid.");
  }
  requireNonEmptyString(input.workspace, "parallel write workspace");
  requireNonEmptyString(input.stateDir, "parallel write stateDir");
  if (typeof input.baselineCommit !== "string" || !COMMIT_PATTERN.test(input.baselineCommit)) {
    throw new Error("Coding benchmark parallel write baselineCommit is invalid.");
  }
}

function assertParallelWriteDependencies(dependencies) {
  if (typeof dependencies?.runWorkflowBatch !== "function"
    || typeof dependencies?.ManagedWorktreeRuntime !== "function"
    || typeof dependencies?.UserWorktreeRuntime !== "function") {
    throw new Error("Coding benchmark parallel write production runtimes are unavailable.");
  }
}

function createTwoLaneBarrier(timeoutMs) {
  const arrivals = new Set();
  let release;
  let closed = false;
  const released = new Promise((resolve) => { release = resolve; });
  return {
    async arrive(index) {
      if (closed || !Number.isInteger(index) || index < 0 || index >= LANE_COUNT
        || arrivals.has(index)) {
        throw new Error("Coding benchmark parallel write barrier received an invalid lane arrival.");
      }
      arrivals.add(index);
      if (arrivals.size === LANE_COUNT) release();
      let timer;
      try {
        await Promise.race([
          released,
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error("parallel write barrier did not complete before timeout"));
            }, timeoutMs);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    close() {
      closed = true;
      release();
    },
  };
}

async function requireGitApplyConflict(patchPath, cwd) {
  try {
    await execFile("git", ["apply", "--check", "--binary", patchPath], gitOptions(cwd));
  } catch (error) {
    const stderr = String(error?.stderr ?? "");
    if (!stderr.replaceAll("\\", "/").includes(CONFLICT_PATH)) {
      throw new Error("Coding benchmark parallel write Git conflict did not identify the bound path.");
    }
    return { exitCode: Number.isInteger(error?.code) ? error.code : 1 };
  }
  throw new Error("Coding benchmark parallel write Git conflict was not detected.");
}

async function runGitApply(patchPath, cwd) {
  await execFile("git", ["apply", "--binary", patchPath], gitOptions(cwd));
}

async function restoreTrackedWorkspace(cwd) {
  await execFile(
    "git",
    ["restore", "--source", "HEAD", "--staged", "--worktree", "--", "."],
    gitOptions(cwd),
  );
}

async function readGitHead(cwd) {
  return (await runGit(["rev-parse", "HEAD"], cwd)).trim();
}

async function collectGitMutations(cwd) {
  const output = await runGit(["status", "--porcelain=v1", "--untracked-files=all"], cwd);
  return output.split(/\r?\n/u).map((line) => line.trimEnd()).filter(Boolean);
}

async function runGit(args, cwd) {
  const { stdout } = await execFile("git", args, gitOptions(cwd));
  return String(stdout ?? "");
}

function gitOptions(cwd) {
  return {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  };
}

function resolveBarrierTimeoutMs(value) {
  if (value === undefined) return DEFAULT_BARRIER_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || value <= 0 || value > 60_000) {
    throw new Error("Coding benchmark parallel write barrier timeout must be within 1-60000 ms.");
  }
  return value;
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

function requireBoundedString(value, label, maxLength) {
  const normalized = requireNonEmptyString(value, label);
  if (normalized.length > maxLength) {
    throw new Error(`Coding benchmark ${label} exceeds ${maxLength} characters.`);
  }
  return normalized;
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
