import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CODING_AGENT_BENCHMARK_BROWSER_SCREENSHOT_ARTIFACT,
  createCodingAgentBenchmarkV3SystemHarness,
} from "./coding-agent-benchmark-system-harness.mjs";
import { resolveRestartDeliveryProcessTimeoutMs } from "./coding-agent-benchmark-restart-delivery-harness.mjs";
import { runWorkflowBatch } from "../packages/belldandy-core/src/workflow-batch-runner.ts";
import { ManagedWorktreeRuntime } from "../packages/belldandy-core/src/managed-worktree.ts";
import { UserWorktreeRuntime } from "../packages/belldandy-core/src/user-worktree-runtime.ts";

const tempRoots = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })));
});

describe("coding agent benchmark native system harness", () => {
  it("allows WSL2 cold production-owner imports without weakening the Windows timeout", () => {
    expect(resolveRestartDeliveryProcessTimeoutMs("windows-native")).toBe(10_000);
    expect(resolveRestartDeliveryProcessTimeoutMs("wsl2-linux")).toBe(60_000);
    expect(resolveRestartDeliveryProcessTimeoutMs("wsl2-linux", 25_000)).toBe(25_000);
    expect(() => resolveRestartDeliveryProcessTimeoutMs("wsl2-linux", 0)).toThrow(/timeout/i);
  });

  it("advertises browser capability only when a local executable is available", async () => {
    const unavailable = await createCodingAgentBenchmarkV3SystemHarness({}, {
      resolveBrowserExecutable: async () => null,
      resolveWorkflowBatchRunner: async () => null,
      resolveRestartDeliveryRuntimes: async () => null,
    });
    expect(unavailable.capabilities).toEqual({
      browserBehavior: false,
      parallelReadIsolation: false,
      parallelWriteFanIn: false,
      restartDeliveryReconciliation: false,
    });
    await expect(unavailable.execute(browserHarnessInput("unavailable-browser")))
      .rejects.toThrow(/browser behavior harness is unavailable/i);

    const available = await createCodingAgentBenchmarkV3SystemHarness({}, {
      resolveBrowserExecutable: async () => "chrome-fixture",
      resolveWorkflowBatchRunner: async () => null,
      runBrowserScenario: async () => browserScenarioResult(),
    });
    expect(available.capabilities).toMatchObject({ browserBehavior: true });
  });

  it("writes a real screenshot artifact and binds it to the DOM and run", async () => {
    const input = await createBrowserHarnessInput("browser-windows-a1");
    const screenshot = Buffer.from("fixture-png-bytes");
    const harness = await createCodingAgentBenchmarkV3SystemHarness({}, {
      resolveBrowserExecutable: async () => "chrome-fixture",
      resolveWorkflowBatchRunner: async () => null,
      async runBrowserScenario(received) {
        expect(received).toMatchObject({
          executablePath: "chrome-fixture",
          runId: input.runId,
          platform: "windows-native",
          artifactDir: input.artifactDir,
        });
        return browserScenarioResult({ screenshot });
      },
    });

    const evidence = await harness.execute(input);
    const screenshotSha256 = sha256(screenshot);
    const domAfterSha256 = sha256("<output id=\"state\" data-state=\"verified\">verified</output>");
    expect(evidence).toMatchObject({
      schemaVersion: "coding-agent-benchmark-system-evidence/v1",
      taskId: "system.browser-behavior",
      runId: input.runId,
      platform: "windows-native",
      status: "passed",
      sensitiveFindingCount: 0,
      orphanResourceCount: 0,
      duplicateSideEffectCount: 0,
      observations: {
        pageLoaded: true,
        consoleErrorCount: 0,
        domChanged: true,
        domAfterSha256,
        requestStatus: 200,
        networkScope: "loopback-only",
        screenshotSha256,
        screenshotBindingSha256: sha256([
          "coding-agent-benchmark-browser-binding/v1",
          input.runId,
          screenshotSha256,
          domAfterSha256,
        ].join("\0")),
      },
    });
    await expect(fs.readFile(path.join(
      input.artifactDir,
      CODING_AGENT_BENCHMARK_BROWSER_SCREENSHOT_ARTIFACT,
    ))).resolves.toEqual(screenshot);
  });

  it("returns failed evidence for console, external-request, and duplicate-side-effect drift", async () => {
    const input = await createBrowserHarnessInput("browser-windows-failed");
    const harness = await createCodingAgentBenchmarkV3SystemHarness({}, {
      resolveBrowserExecutable: async () => "chrome-fixture",
      resolveWorkflowBatchRunner: async () => null,
      async runBrowserScenario() {
        return browserScenarioResult({
          consoleErrors: ["fixture console failure"],
          blockedExternalRequestCount: 1,
          probeRequestCount: 2,
        });
      },
    });

    await expect(harness.execute(input)).resolves.toMatchObject({
      status: "failed",
      duplicateSideEffectCount: 1,
      observations: {
        consoleErrorCount: 1,
        networkScope: "loopback-only",
      },
    });
  });

  it("runs three read children concurrently on one snapshot, budget, and binding", async () => {
    const input = await createParallelReadHarnessInput("parallel-read-windows-a1");
    const harness = await createCodingAgentBenchmarkV3SystemHarness({}, {
      resolveBrowserExecutable: async () => null,
      resolveWorkflowBatchRunner: async () => runWorkflowBatch,
    });

    expect(harness.capabilities).toMatchObject({
      browserBehavior: false,
      parallelReadIsolation: true,
    });
    const evidence = await harness.execute(input);
    expect(evidence).toMatchObject({
      schemaVersion: "coding-agent-benchmark-system-evidence/v1",
      taskId: "system.parallel-read-isolation",
      runId: input.runId,
      platform: "windows-native",
      status: "passed",
      sensitiveFindingCount: 0,
      orphanResourceCount: 0,
      duplicateSideEffectCount: 0,
      observations: {
        children: [
          { terminalStatus: "completed", mutationCount: 0 },
          { terminalStatus: "completed", mutationCount: 0 },
          { terminalStatus: "completed", mutationCount: 0 },
        ],
      },
    });
    const children = evidence.observations.children;
    expect(new Set(children.map((child) => child.childId)).size).toBe(3);
    expect(new Set(children.map((child) => child.snapshotSha256)).size).toBe(1);
    expect(new Set(children.map((child) => child.budgetId)).size).toBe(1);
    expect(new Set(children.map((child) => child.bindingId)).size).toBe(1);
    expect(new Set(children.map((child) => child.terminalEvidenceSha256)).size).toBe(3);
  });

  it("rejects a sequential runner that cannot satisfy the three-child barrier", async () => {
    const input = await createParallelReadHarnessInput("parallel-read-sequential");
    const sequentialRunner = async (options) => {
      const results = [];
      for (const [index, item] of options.items.entries()) {
        try {
          results.push({
            ok: true,
            value: await options.execute(item, index),
            taskId: `sequential-${index}`,
            durationMs: 0,
          });
        } catch (error) {
          results.push({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            taskId: `sequential-${index}`,
            durationMs: 0,
          });
        }
      }
      return results;
    };
    const harness = await createCodingAgentBenchmarkV3SystemHarness({
      parallelReadBarrierTimeoutMs: 25,
    }, {
      resolveBrowserExecutable: async () => null,
      resolveWorkflowBatchRunner: async () => sequentialRunner,
    });

    await expect(harness.execute(input)).rejects.toThrow(/parallel read.*did not complete/i);
  });

  it("returns failed evidence when the parallel read fixture is already dirty", async () => {
    const input = await createParallelReadHarnessInput("parallel-read-dirty");
    await fs.writeFile(path.join(input.workspace, "unexpected.txt"), "mutation\n", "utf-8");
    const harness = await createCodingAgentBenchmarkV3SystemHarness({}, {
      resolveBrowserExecutable: async () => null,
      resolveWorkflowBatchRunner: async () => runWorkflowBatch,
    });

    const evidence = await harness.execute(input);
    expect(evidence.status).toBe("failed");
    expect(evidence.observations.children.every((child) => child.mutationCount === 1)).toBe(true);
  });

  it("fans two isolated write lanes in only after a bound preview and confirmation", async () => {
    const input = await createParallelWriteHarnessInput("parallel-write-windows-a1");
    const harness = await createCodingAgentBenchmarkV3SystemHarness({}, {
      resolveBrowserExecutable: async () => null,
      resolveWorkflowBatchRunner: async () => runWorkflowBatch,
      resolveParallelWriteRuntimes: async () => ({ ManagedWorktreeRuntime, UserWorktreeRuntime }),
    });

    expect(harness.capabilities).toMatchObject({ parallelWriteFanIn: true });
    const evidence = await harness.execute(input);
    expect(evidence).toMatchObject({
      schemaVersion: "coding-agent-benchmark-system-evidence/v1",
      taskId: "system.parallel-write-fan-in",
      runId: input.runId,
      platform: "windows-native",
      status: "passed",
      sensitiveFindingCount: 0,
      orphanResourceCount: 0,
      duplicateSideEffectCount: 0,
      observations: {
        mainWorkspaceChangedBeforeFanIn: false,
        lanes: [
          { terminalStatus: "completed", mutationCount: 1 },
          { terminalStatus: "completed", mutationCount: 1 },
        ],
        conflict: {
          detected: true,
          path: "workspace/shared.txt",
          evidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        fanIn: {
          mode: "preview-confirm",
          previewSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          confirmed: true,
          status: "completed",
          resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      },
    });
    const lanes = evidence.observations.lanes;
    expect(new Set(lanes.map((lane) => lane.laneId)).size).toBe(2);
    expect(new Set(lanes.map((lane) => lane.worktreeId)).size).toBe(2);
    expect(new Set(lanes.map((lane) => lane.baselineSha256)).size).toBe(1);
    expect(runGit(input.workspace, ["status", "--porcelain=v1", "--untracked-files=all"])).toBe("");
    expect(runGit(input.workspace, ["worktree", "list", "--porcelain"])
      .split(/\r?\n/u).filter((line) => line.startsWith("worktree "))).toHaveLength(1);
    expect(runGit(input.workspace, ["branch", "--list", "belldandy-*"])).toBe("");
  }, 20_000);

  it("rejects a sequential runner before parallel write fan-in and removes prepared worktrees", async () => {
    const input = await createParallelWriteHarnessInput("parallel-write-sequential");
    const sequentialRunner = async (options) => {
      const results = [];
      for (const [index, item] of options.items.entries()) {
        try {
          results.push({
            ok: true,
            value: await options.execute(item, index),
            taskId: `sequential-write-${index}`,
            durationMs: 0,
          });
        } catch (error) {
          results.push({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            taskId: `sequential-write-${index}`,
            durationMs: 0,
          });
        }
      }
      return results;
    };
    const harness = await createCodingAgentBenchmarkV3SystemHarness({
      parallelWriteBarrierTimeoutMs: 25,
    }, {
      resolveBrowserExecutable: async () => null,
      resolveWorkflowBatchRunner: async () => sequentialRunner,
      resolveParallelWriteRuntimes: async () => ({ ManagedWorktreeRuntime, UserWorktreeRuntime }),
    });

    await expect(harness.execute(input)).rejects.toThrow(/parallel write.*did not complete/i);
    expect(runGit(input.workspace, ["worktree", "list", "--porcelain"])
      .split(/\r?\n/u).filter((line) => line.startsWith("worktree "))).toHaveLength(1);
    expect(runGit(input.workspace, ["branch", "--list", "belldandy-*"])).toBe("");
  });

  it("reattaches a completed side effect after a real process restart and delivers it locally once", async () => {
    const input = await createRestartDeliveryHarnessInput("restart-delivery-windows-a1");
    const harness = await createCodingAgentBenchmarkV3SystemHarness({
      sourceRoot: path.resolve("."),
    }, {
      resolveBrowserExecutable: async () => null,
      resolveWorkflowBatchRunner: async () => null,
      resolveParallelWriteRuntimes: async () => null,
    });

    expect(harness.capabilities).toMatchObject({ restartDeliveryReconciliation: true });
    const evidence = await harness.execute(input);
    expect(evidence).toMatchObject({
      schemaVersion: "coding-agent-benchmark-system-evidence/v1",
      taskId: "system.restart-delivery-reconciliation",
      generatorId: "restart-delivery-reconciliation-v1",
      fixtureVersion: 1,
      runId: input.runId,
      platform: "windows-native",
      status: "passed",
      sensitiveFindingCount: 0,
      orphanResourceCount: 0,
      duplicateSideEffectCount: 0,
      observations: {
        restartInjected: true,
        reattached: true,
        journalState: "applied",
        completedSideEffectCount: 1,
        replayedSideEffectCount: 0,
        localDeliveryStatus: "completed",
        remoteWriteCount: 0,
        terminalStatus: "completed",
        reconciliationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(evidence.observations.oldBindingId).not.toBe(evidence.observations.newBindingId);
    expect(runGit(input.workspace, ["status", "--porcelain=v1", "--untracked-files=all"])).toBe("");
    expect(runGit(input.workspace, ["worktree", "list", "--porcelain"])
      .split(/\r?\n/u).filter((line) => line.startsWith("worktree "))).toHaveLength(1);
    expect(runGit(input.workspace, ["branch", "--list", "belldandy-*"])).toBe("");
  }, 20_000);

  it("cleans the restart worktree and child after a post-restart reconciliation failure", async () => {
    const input = await createRestartDeliveryHarnessInput("restart-delivery-failed-cleanup");
    const harness = await createCodingAgentBenchmarkV3SystemHarness({
      sourceRoot: path.resolve("."),
      restartDeliveryFailurePhase: "after_restart",
    }, {
      resolveBrowserExecutable: async () => null,
      resolveWorkflowBatchRunner: async () => null,
      resolveParallelWriteRuntimes: async () => null,
    });

    await expect(harness.execute(input)).rejects.toThrow(/injected.*after restart/i);
    expect(runGit(input.workspace, ["status", "--porcelain=v1", "--untracked-files=all"])).toBe("");
    expect(runGit(input.workspace, ["worktree", "list", "--porcelain"])
      .split(/\r?\n/u).filter((line) => line.startsWith("worktree "))).toHaveLength(1);
    expect(runGit(input.workspace, ["branch", "--list", "belldandy-*"])).toBe("");
  }, 20_000);
});

async function createBrowserHarnessInput(runId) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-system-harness-"));
  tempRoots.push(root);
  const artifactDir = path.join(root, "artifacts");
  const workspace = path.join(root, "workspace");
  await Promise.all([
    fs.mkdir(artifactDir, { recursive: true }),
    fs.mkdir(workspace, { recursive: true }),
  ]);
  return browserHarnessInput(runId, { artifactDir, workspace });
}

async function createParallelReadHarnessInput(runId) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-parallel-read-"));
  tempRoots.push(root);
  const workspace = path.join(root, "workspace");
  const artifactDir = path.join(root, "artifacts");
  await fs.mkdir(path.join(workspace, "fixture"), { recursive: true });
  await fs.mkdir(artifactDir, { recursive: true });
  const scenario = {
    schemaVersion: "coding-agent-benchmark-system-scenario/v1",
    taskId: "system.parallel-read-isolation",
    generatorId: "parallel-read-isolation-v1",
    fixtureVersion: 1,
    platform: "windows-native",
    requiredCapability: "parallelReadIsolation",
    evidenceSchemaVersion: "coding-agent-benchmark-system-evidence/v1",
    invariants: [
      "run_and_platform_binding",
      "workspace_containment",
      "zero_sensitive_findings",
      "zero_orphan_resources",
      "zero_duplicate_side_effects",
    ],
  };
  await fs.writeFile(
    path.join(workspace, "fixture", "system-scenario.json"),
    `${JSON.stringify(scenario, null, 2)}\n`,
    "utf-8",
  );
  runGit(workspace, ["init"]);
  runGit(workspace, ["config", "user.email", "benchmark@example.invalid"]);
  runGit(workspace, ["config", "user.name", "Benchmark Fixture"]);
  runGit(workspace, ["add", "."]);
  runGit(workspace, ["commit", "-m", "benchmark fixture"]);
  const baselineCommit = runGit(workspace, ["rev-parse", "HEAD"]).trim();
  return {
    scenario,
    task: {
      id: "system.parallel-read-isolation",
      fixture: { generatorId: "parallel-read-isolation-v1", version: 1 },
    },
    runId,
    platform: "windows-native",
    workspace,
    artifactDir,
    stateDir: path.join(root, "state"),
    sourceRoot: path.resolve("."),
    baselineCommit,
    budgets: { timeoutMs: 300_000, maxTurns: 12, maxTokens: 24_000 },
  };
}

async function createParallelWriteHarnessInput(runId) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-parallel-write-"));
  tempRoots.push(root);
  const workspace = path.join(root, "workspace");
  const artifactDir = path.join(root, "artifacts");
  await fs.mkdir(path.join(workspace, "fixture"), { recursive: true });
  await fs.mkdir(path.join(workspace, "workspace"), { recursive: true });
  await fs.mkdir(artifactDir, { recursive: true });
  const scenario = {
    schemaVersion: "coding-agent-benchmark-system-scenario/v1",
    taskId: "system.parallel-write-fan-in",
    generatorId: "parallel-write-fan-in-v1",
    fixtureVersion: 1,
    platform: "windows-native",
    requiredCapability: "parallelWriteFanIn",
    evidenceSchemaVersion: "coding-agent-benchmark-system-evidence/v1",
    invariants: [
      "run_and_platform_binding",
      "workspace_containment",
      "zero_sensitive_findings",
      "zero_orphan_resources",
      "zero_duplicate_side_effects",
    ],
  };
  await Promise.all([
    fs.writeFile(
      path.join(workspace, "fixture", "system-scenario.json"),
      `${JSON.stringify(scenario, null, 2)}\n`,
      "utf-8",
    ),
    fs.writeFile(path.join(workspace, "workspace", "shared.txt"), "base\n", "utf-8"),
  ]);
  runGit(workspace, ["init"]);
  runGit(workspace, ["config", "user.email", "benchmark@example.invalid"]);
  runGit(workspace, ["config", "user.name", "Benchmark Fixture"]);
  runGit(workspace, ["add", "."]);
  runGit(workspace, ["commit", "-m", "benchmark fixture"]);
  const baselineCommit = runGit(workspace, ["rev-parse", "HEAD"]).trim();
  return {
    scenario,
    task: {
      id: "system.parallel-write-fan-in",
      fixture: { generatorId: "parallel-write-fan-in-v1", version: 1 },
    },
    runId,
    platform: "windows-native",
    workspace,
    artifactDir,
    stateDir: path.join(root, "state"),
    sourceRoot: path.resolve("."),
    baselineCommit,
    budgets: { timeoutMs: 300_000, maxTurns: 12, maxTokens: 24_000 },
  };
}

async function createRestartDeliveryHarnessInput(runId) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-restart-delivery-"));
  tempRoots.push(root);
  const workspace = path.join(root, "workspace");
  const artifactDir = path.join(root, "artifacts");
  await fs.mkdir(path.join(workspace, "fixture"), { recursive: true });
  await fs.mkdir(path.join(workspace, "workspace"), { recursive: true });
  await fs.mkdir(artifactDir, { recursive: true });
  const scenario = {
    schemaVersion: "coding-agent-benchmark-system-scenario/v1",
    taskId: "system.restart-delivery-reconciliation",
    generatorId: "restart-delivery-reconciliation-v1",
    fixtureVersion: 1,
    platform: "windows-native",
    requiredCapability: "restartDeliveryReconciliation",
    evidenceSchemaVersion: "coding-agent-benchmark-system-evidence/v1",
    invariants: [
      "run_and_platform_binding",
      "workspace_containment",
      "zero_sensitive_findings",
      "zero_orphan_resources",
      "zero_duplicate_side_effects",
    ],
  };
  await Promise.all([
    fs.writeFile(
      path.join(workspace, "fixture", "system-scenario.json"),
      `${JSON.stringify(scenario, null, 2)}\n`,
      "utf-8",
    ),
    fs.writeFile(path.join(workspace, "workspace", "durable.txt"), "side-effect-count=0\n", "utf-8"),
  ]);
  runGit(workspace, ["init"]);
  runGit(workspace, ["config", "user.email", "benchmark@example.invalid"]);
  runGit(workspace, ["config", "user.name", "Benchmark Fixture"]);
  runGit(workspace, ["add", "."]);
  runGit(workspace, ["commit", "-m", "benchmark fixture"]);
  const baselineCommit = runGit(workspace, ["rev-parse", "HEAD"]).trim();
  return {
    scenario,
    task: {
      id: "system.restart-delivery-reconciliation",
      fixture: { generatorId: "restart-delivery-reconciliation-v1", version: 1 },
    },
    runId,
    platform: "windows-native",
    workspace,
    artifactDir,
    stateDir: path.join(root, "state"),
    sourceRoot: path.resolve("."),
    baselineCommit,
    budgets: { timeoutMs: 300_000, maxTurns: 12, maxTokens: 24_000 },
  };
}

function browserHarnessInput(runId, overrides = {}) {
  return {
    scenario: {
      schemaVersion: "coding-agent-benchmark-system-scenario/v1",
      taskId: "system.browser-behavior",
      generatorId: "browser-behavior-v1",
      fixtureVersion: 1,
      platform: "windows-native",
      requiredCapability: "browserBehavior",
      evidenceSchemaVersion: "coding-agent-benchmark-system-evidence/v1",
      invariants: [
        "run_and_platform_binding",
        "workspace_containment",
        "zero_sensitive_findings",
        "zero_orphan_resources",
        "zero_duplicate_side_effects",
      ],
    },
    task: {
      id: "system.browser-behavior",
      fixture: { generatorId: "browser-behavior-v1", version: 1 },
    },
    runId,
    platform: "windows-native",
    workspace: "C:/fixture/workspace",
    artifactDir: "C:/fixture/artifact",
    stateDir: "C:/fixture/state",
    sourceRoot: "C:/fixture/source",
    ...overrides,
  };
}

function browserScenarioResult(overrides = {}) {
  return {
    pageLoaded: true,
    consoleErrors: [],
    domBefore: "<output id=\"state\" data-state=\"pending\">pending</output>",
    domAfter: "<output id=\"state\" data-state=\"verified\">verified</output>",
    requestStatus: 200,
    blockedExternalRequestCount: 0,
    probeRequestCount: 1,
    sensitiveFindingCount: 0,
    orphanResourceCount: 0,
    screenshot: Buffer.from("fixture-png-bytes"),
    ...overrides,
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function runGit(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `git ${args[0]} failed.`);
  return result.stdout.trim();
}
