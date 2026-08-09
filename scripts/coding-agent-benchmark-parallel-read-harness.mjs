import { execFile as execFileCallback } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const SYSTEM_EVIDENCE_VERSION = "coding-agent-benchmark-system-evidence/v1";
const SYSTEM_SCENARIO_VERSION = "coding-agent-benchmark-system-scenario/v1";
const PARALLEL_READ_TASK_ID = "system.parallel-read-isolation";
const PARALLEL_READ_CAPABILITY = "parallelReadIsolation";
const PARALLEL_READ_GENERATOR_ID = "parallel-read-isolation-v1";
const SNAPSHOT_BINDING_VERSION = "coding-agent-benchmark-parallel-read-snapshot/v1";
const BUDGET_BINDING_VERSION = "coding-agent-benchmark-parallel-read-budget/v1";
const RUN_BINDING_VERSION = "coding-agent-benchmark-parallel-read-binding/v1";
const TERMINAL_EVIDENCE_VERSION = "coding-agent-benchmark-parallel-read-terminal/v1";
const DEFAULT_BARRIER_TIMEOUT_MS = 5_000;
const CHILD_COUNT = 3;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const COMMIT_PATTERN = /^[a-f0-9]{40,64}$/;

export async function executeParallelReadIsolationHarness(input, dependencies) {
  assertParallelReadHarnessInput(input);
  if (typeof dependencies?.runWorkflowBatch !== "function") {
    throw new Error("Coding benchmark parallel read workflow batch runner is unavailable.");
  }

  const workspace = path.resolve(input.workspace);
  const scenarioPath = path.join(workspace, "fixture", "system-scenario.json");
  const [scenarioBytes, headCommit, initialMutations] = await Promise.all([
    fs.readFile(scenarioPath),
    readGitHead(workspace),
    collectGitMutations(workspace),
  ]);
  if (headCommit !== input.baselineCommit) {
    throw new Error("Coding benchmark parallel read baseline commit does not match fixture HEAD.");
  }
  const diskScenario = parseJsonObject(scenarioBytes, "parallel read system scenario");
  if (stableJson(diskScenario) !== stableJson(input.scenario)) {
    throw new Error("Coding benchmark parallel read system scenario drifted from the bound fixture.");
  }

  const scenarioSha256 = sha256(scenarioBytes);
  const snapshotSha256 = sha256([
    SNAPSHOT_BINDING_VERSION,
    input.baselineCommit,
    scenarioSha256,
  ].join("\0"));
  const budgetId = `budget:${sha256(`${BUDGET_BINDING_VERSION}\0${stableJson(input.budgets)}`)}`;
  const bindingId = `binding:${sha256([
    RUN_BINDING_VERSION,
    input.task.id,
    input.runId,
    input.platform,
  ].join("\0"))}`;
  const barrier = createThreeChildBarrier(resolveBarrierTimeoutMs(input.barrierTimeoutMs));
  const items = Array.from({ length: CHILD_COUNT }, (_, index) => ({ index }));
  let results;
  try {
    results = await dependencies.runWorkflowBatch({
      items,
      maxConcurrent: CHILD_COUNT,
      limits: {
        maxItems: CHILD_COUNT,
        maxQueuedBytes: 16 * 1024,
        maxOutputBytes: 256 * 1024,
      },
      taskIdPrefix: "benchmark_parallel_read",
      async execute(item) {
        await barrier.arrive(item.index);
        const [observedScenario, observedHead, observedMutations] = await Promise.all([
          fs.readFile(scenarioPath),
          readGitHead(workspace),
          collectGitMutations(workspace),
        ]);
        return {
          childIndex: item.index,
          scenarioSha256: sha256(observedScenario),
          headCommit: observedHead,
          mutations: [...observedMutations],
        };
      },
    });
  } finally {
    barrier.close();
  }

  if (!Array.isArray(results) || results.length !== CHILD_COUNT
    || results.some((result) => result?.ok !== true)) {
    const errors = Array.isArray(results)
      ? results.filter((result) => result?.ok !== true).map((result) => result?.error).filter(Boolean)
      : [];
    throw new Error(
      `Coding benchmark parallel read batch did not complete the three-child barrier${errors.length > 0 ? `: ${errors.join("; ")}` : "."}`,
    );
  }

  const finalMutations = await collectGitMutations(workspace);
  const children = results.map((result, index) => {
    const value = result.value;
    if (!value || value.childIndex !== index || value.scenarioSha256 !== scenarioSha256
      || value.headCommit !== input.baselineCommit) {
      throw new Error("Coding benchmark parallel read child observed a different snapshot.");
    }
    const mutations = new Set([
      ...initialMutations,
      ...value.mutations,
      ...finalMutations,
    ]);
    const childId = requireBoundedString(result.taskId, "parallel read child taskId", 300);
    const mutationCount = mutations.size;
    return {
      childId,
      snapshotSha256,
      budgetId,
      bindingId,
      terminalStatus: "completed",
      mutationCount,
      terminalEvidenceSha256: sha256(stableJson({
        schemaVersion: TERMINAL_EVIDENCE_VERSION,
        childId,
        childIndex: index,
        snapshotSha256,
        budgetId,
        bindingId,
        terminalStatus: "completed",
        mutationCount,
      })),
    };
  });
  assertParallelReadChildBindings(children);

  return {
    schemaVersion: SYSTEM_EVIDENCE_VERSION,
    taskId: PARALLEL_READ_TASK_ID,
    generatorId: PARALLEL_READ_GENERATOR_ID,
    fixtureVersion: 1,
    runId: input.runId,
    platform: input.platform,
    status: children.every((child) => child.mutationCount === 0) ? "passed" : "failed",
    sensitiveFindingCount: 0,
    orphanResourceCount: 0,
    duplicateSideEffectCount: 0,
    observations: { children },
  };
}

function assertParallelReadHarnessInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Coding benchmark parallel read harness input must be an object.");
  }
  if (input.scenario?.schemaVersion !== SYSTEM_SCENARIO_VERSION
    || input.scenario?.taskId !== PARALLEL_READ_TASK_ID
    || input.scenario?.generatorId !== PARALLEL_READ_GENERATOR_ID
    || input.scenario?.fixtureVersion !== 1
    || input.scenario?.requiredCapability !== PARALLEL_READ_CAPABILITY
    || input.scenario?.evidenceSchemaVersion !== SYSTEM_EVIDENCE_VERSION) {
    throw new Error("Coding benchmark parallel read system scenario contract is invalid.");
  }
  if (input.task?.id !== PARALLEL_READ_TASK_ID
    || input.task?.fixture?.generatorId !== PARALLEL_READ_GENERATOR_ID
    || input.task?.fixture?.version !== 1) {
    throw new Error("Coding benchmark parallel read task contract is invalid.");
  }
  if (typeof input.runId !== "string" || input.runId.length > 200
    || !RUN_ID_PATTERN.test(input.runId)) {
    throw new Error("Coding benchmark parallel read runId must be path-safe.");
  }
  if ((input.platform !== "windows-native" && input.platform !== "wsl2-linux")
    || input.scenario.platform !== input.platform) {
    throw new Error("Coding benchmark parallel read platform binding is invalid.");
  }
  requireNonEmptyString(input.workspace, "parallel read workspace");
  if (typeof input.baselineCommit !== "string" || !COMMIT_PATTERN.test(input.baselineCommit)) {
    throw new Error("Coding benchmark parallel read baselineCommit is invalid.");
  }
  assertExactKeys(input.budgets, ["timeoutMs", "maxTurns", "maxTokens"], "parallel read budgets");
  for (const [name, value] of Object.entries(input.budgets)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Coding benchmark parallel read budget ${name} must be a positive safe integer.`);
    }
  }
}

function createThreeChildBarrier(timeoutMs) {
  const arrivals = new Set();
  let release;
  let closed = false;
  const released = new Promise((resolve) => { release = resolve; });
  return {
    async arrive(index) {
      if (closed || !Number.isInteger(index) || index < 0 || index >= CHILD_COUNT
        || arrivals.has(index)) {
        throw new Error("Coding benchmark parallel read barrier received an invalid child arrival.");
      }
      arrivals.add(index);
      if (arrivals.size === CHILD_COUNT) release();
      let timer;
      try {
        await Promise.race([
          released,
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error("parallel read barrier did not complete before timeout"));
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

function assertParallelReadChildBindings(children) {
  const childIds = new Set(children.map((child) => child.childId));
  const snapshots = new Set(children.map((child) => child.snapshotSha256));
  const budgets = new Set(children.map((child) => child.budgetId));
  const bindings = new Set(children.map((child) => child.bindingId));
  const terminalEvidence = new Set(children.map((child) => child.terminalEvidenceSha256));
  if (childIds.size !== CHILD_COUNT || snapshots.size !== 1 || budgets.size !== 1
    || bindings.size !== 1 || terminalEvidence.size !== CHILD_COUNT) {
    throw new Error("Coding benchmark parallel read child evidence bindings are invalid.");
  }
}

async function readGitHead(workspace) {
  const { stdout } = await execFile("git", ["rev-parse", "HEAD"], gitOptions(workspace));
  return stdout.trim();
}

async function collectGitMutations(workspace) {
  const { stdout } = await execFile(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    gitOptions(workspace),
  );
  return new Set(stdout.split(/\r?\n/u).map((line) => line.trimEnd()).filter(Boolean));
}

function gitOptions(cwd) {
  return {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  };
}

function resolveBarrierTimeoutMs(value) {
  if (value === undefined) return DEFAULT_BARRIER_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || value <= 0 || value > 60_000) {
    throw new Error("Coding benchmark parallel read barrier timeout must be within 1-60000 ms.");
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

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Coding benchmark ${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(required)) {
    throw new Error(`Coding benchmark ${label} fields are invalid.`);
  }
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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
