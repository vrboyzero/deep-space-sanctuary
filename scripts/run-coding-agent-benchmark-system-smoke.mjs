import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadCodingAgentBenchmarkManifest,
  resolveCodingAgentBenchmarkManifestPath,
  resolveCodingAgentBenchmarkTaskBudgets,
} from "./coding-agent-benchmark-contract.mjs";
import { evaluateBenchmarkContractSourcePreflight } from "./coding-agent-benchmark-preflight.mjs";
import { createCodingAgentBenchmarkV3SystemHarness } from "./coding-agent-benchmark-system-harness.mjs";
import { resolveCodingAgentBenchmarkV3FixtureProvider } from "./coding-agent-benchmark-v3-fixtures.mjs";

export const CODING_AGENT_BENCHMARK_SYSTEM_SMOKE_VERSION =
  "coding-agent-benchmark-system-smoke/v1";

const DEFAULT_TASK_IDS = Object.freeze([
  "system.parallel-read-isolation",
  "system.parallel-write-fan-in",
  "system.restart-delivery-reconciliation",
]);
const SUPPORTED_PLATFORMS = new Set(["windows-native", "wsl2-linux"]);
const scriptPath = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(scriptPath), "..");

export async function runCodingAgentBenchmarkSystemSmoke(input, dependencies = {}) {
  const platform = requirePlatform(input?.platform);
  const sourceRoot = path.resolve(requireString(input?.sourceRoot, "sourceRoot"));
  const outputRoot = path.resolve(requireString(input?.outputRoot, "outputRoot"));
  const temporaryRoot = path.resolve(requireString(input?.temporaryRoot, "temporaryRoot"));
  const browserExecutablePath = input?.browserExecutablePath === undefined
    ? undefined
    : path.resolve(requireString(input.browserExecutablePath, "browserExecutablePath"));
  const taskIds = normalizeTaskIds(input?.taskIds ?? DEFAULT_TASK_IDS);
  await assertDirectory(sourceRoot, "sourceRoot");
  await assertPathAbsent(outputRoot, "outputRoot");
  assertDisjointRoots(temporaryRoot, outputRoot, "temporaryRoot", "outputRoot");
  assertDisjointRoots(temporaryRoot, sourceRoot, "temporaryRoot", "sourceRoot");

  const loadManifest = dependencies.loadManifest ?? loadCodingAgentBenchmarkManifest;
  const resolveProvider = dependencies.resolveFixtureProvider
    ?? resolveCodingAgentBenchmarkV3FixtureProvider;
  const createHarness = dependencies.createSystemHarness
    ?? createCodingAgentBenchmarkV3SystemHarness;
  const evaluateSourcePreflight = dependencies.evaluateSourcePreflight
    ?? evaluateBenchmarkContractSourcePreflight;
  const manifest = await loadManifest(resolveCodingAgentBenchmarkManifestPath("v3"));
  const tasks = taskIds.map((taskId) => {
    const task = manifest.tasks.find((candidate) => candidate.id === taskId);
    if (!task || task.layer !== "C" || !task.platforms.includes(platform)) {
      throw new Error(`Coding benchmark system smoke task ${taskId} is invalid for ${platform}.`);
    }
    return task;
  });
  const harness = await createHarness({ sourceRoot, browserExecutablePath });
  if (!harness?.capabilities || typeof harness.execute !== "function") {
    throw new Error("Coding benchmark system smoke harness is invalid.");
  }

  await fs.mkdir(temporaryRoot, { recursive: true });
  await fs.mkdir(path.dirname(outputRoot), { recursive: true });
  await fs.mkdir(outputRoot);
  const results = [];
  for (const task of tasks) {
    results.push(await runSystemSmokeTask({
      manifest,
      task,
      platform,
      sourceRoot,
      outputRoot,
      temporaryRoot,
      harness,
      resolveProvider,
      evaluateSourcePreflight,
    }));
  }

  const artifact = {
    schemaVersion: CODING_AGENT_BENCHMARK_SYSTEM_SMOKE_VERSION,
    platform,
    status: summarizeStatus(results),
    capabilities: structuredClone(harness.capabilities),
    results,
  };
  await writeJsonExclusive(path.join(outputRoot, "system-smoke.json"), artifact);
  return artifact;
}

async function runSystemSmokeTask(input) {
  const taskOutputRoot = path.join(input.outputRoot, input.task.id);
  await fs.mkdir(taskOutputRoot);
  const sourcePreflight = await input.evaluateSourcePreflight({
    sourceRoot: input.sourceRoot,
    manifest: input.manifest,
    task: input.task,
    manifestRevision: "v3",
  });
  const provider = input.resolveProvider(input.manifest, input.task.id);
  const providerPreflight = await provider.preflight({
    manifest: input.manifest,
    taskId: input.task.id,
    platform: input.platform,
    systemCapabilities: input.harness.capabilities,
  });
  const preflight = { source: sourcePreflight, provider: providerPreflight };
  await writeJsonExclusive(path.join(taskOutputRoot, "preflight.json"), preflight);
  if (sourcePreflight?.status !== "passed") {
    return {
      taskId: input.task.id,
      status: "failed",
      preflight,
      evidenceSha256: null,
      diagnostics: [`Source preflight failed: ${sourcePreflight?.reason ?? "unknown"}.`],
    };
  }
  if (providerPreflight?.status !== "passed") {
    return {
      taskId: input.task.id,
      status: "unavailable",
      preflight,
      evidenceSha256: null,
      diagnostics: [`System capability unavailable: ${providerPreflight?.reason ?? "unknown"}.`],
    };
  }

  const taskTemporaryRoot = await fs.mkdtemp(path.join(
    input.temporaryRoot,
    `${input.task.id.replaceAll(".", "-")}-`,
  ));
  let result;
  try {
    const workspace = path.join(taskTemporaryRoot, "workspace");
    const stateDir = path.join(taskTemporaryRoot, "state");
    await fs.mkdir(stateDir);
    const fixture = await provider.generate({
      manifest: input.manifest,
      taskId: input.task.id,
      platform: input.platform,
      workspace,
      systemCapabilities: input.harness.capabilities,
    });
    await writeJsonExclusive(
      path.join(taskOutputRoot, "system-scenario.json"),
      fixture.systemScenario,
    );
    const runId = `system-smoke-${input.platform}-${crypto.randomUUID()}`;
    const evidence = await input.harness.execute({
      scenario: structuredClone(fixture.systemScenario),
      task: structuredClone(input.task),
      runId,
      platform: input.platform,
      workspace,
      artifactDir: taskOutputRoot,
      stateDir,
      sourceRoot: input.sourceRoot,
      baselineCommit: fixture.baselineCommit,
      budgets: resolveCodingAgentBenchmarkTaskBudgets(input.manifest, input.task.id),
    });
    const evidenceText = serializeJson(evidence);
    await fs.writeFile(
      path.join(taskOutputRoot, "system-evidence.json"),
      evidenceText,
      { encoding: "utf-8", flag: "wx" },
    );
    const verdict = await provider.evaluate({
      task: fixture.task,
      workspace,
      artifactDir: taskOutputRoot,
      runnerExitCode: evidence?.status === "passed" ? 0 : 1,
      manifestRevision: "v3",
      runId,
      platform: input.platform,
      result: { summary: "System harness smoke completed." },
      systemEvidence: evidence,
    });
    result = {
      taskId: input.task.id,
      status: verdict.status === "passed" ? "passed" : "failed",
      preflight,
      evidenceSha256: sha256(evidenceText),
      diagnostics: [...(verdict.diagnostics ?? [])],
    };
  } catch (error) {
    result = {
      taskId: input.task.id,
      status: "failed",
      preflight,
      evidenceSha256: null,
      diagnostics: [`System smoke execution failed: ${safeMessage(error)}.`],
    };
  } finally {
    try {
      await fs.rm(taskTemporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch (error) {
      result = {
        ...(result ?? {
          taskId: input.task.id,
          preflight,
          evidenceSha256: null,
          diagnostics: [],
        }),
        status: "failed",
        diagnostics: [
          ...(result?.diagnostics ?? []),
          `System smoke cleanup failed: ${safeMessage(error)}.`,
        ],
      };
    }
  }
  return result;
}

export function parseCodingAgentBenchmarkSystemSmokeCliArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!["--platform", "--source-root", "--output-root", "--temporary-root", "--task-id", "--browser-executable-path"]
      .includes(flag)) {
      throw new Error(`Unknown coding benchmark system smoke argument: ${String(flag)}.`);
    }
    if (options[flag] !== undefined) {
      throw new Error(`${flag} may only be provided once.`);
    }
    const value = requireString(argv[index + 1], flag);
    options[flag] = value;
    index += 1;
  }
  return {
    platform: options["--platform"] ?? (process.platform === "win32" ? "windows-native" : "wsl2-linux"),
    sourceRoot: options["--source-root"] ?? workspaceRoot,
    outputRoot: requireString(options["--output-root"], "--output-root"),
    temporaryRoot: options["--temporary-root"]
      ?? path.join(os.tmpdir(), "coding-agent-benchmark-system-smoke"),
    browserExecutablePath: options["--browser-executable-path"],
    taskIds: options["--task-id"]
      ? options["--task-id"].split(",").map((value) => value.trim()).filter(Boolean)
      : [...DEFAULT_TASK_IDS],
  };
}

function normalizeTaskIds(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Coding benchmark system smoke requires at least one taskId.");
  }
  const taskIds = value.map((taskId) => requireString(taskId, "taskId"));
  if (new Set(taskIds).size !== taskIds.length) {
    throw new Error("Coding benchmark system smoke taskIds must be unique.");
  }
  return taskIds;
}

function requirePlatform(value) {
  const platform = requireString(value, "platform");
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error("Coding benchmark system smoke platform must be windows-native or wsl2-linux.");
  }
  return platform;
}

function summarizeStatus(results) {
  if (results.some((result) => result.status === "failed")) return "failed";
  if (results.some((result) => result.status === "unavailable")) return "unavailable";
  return "passed";
}

async function assertDirectory(target, label) {
  const stats = await fs.stat(target).catch(() => null);
  if (!stats?.isDirectory()) throw new Error(`Coding benchmark system smoke ${label} must be a directory.`);
}

async function assertPathAbsent(target, label) {
  const stats = await fs.lstat(target).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (stats) throw new Error(`Coding benchmark system smoke ${label} must not already exist.`);
}

function assertDisjointRoots(left, right, leftLabel, rightLabel) {
  const leftToRight = path.relative(left, right);
  const rightToLeft = path.relative(right, left);
  const overlaps = !leftToRight
    || (!leftToRight.startsWith(`..${path.sep}`) && !path.isAbsolute(leftToRight))
    || (!rightToLeft.startsWith(`..${path.sep}`) && !path.isAbsolute(rightToLeft));
  if (overlaps) {
    throw new Error(`Coding benchmark system smoke ${leftLabel} and ${rightLabel} must be disjoint.`);
  }
}

async function writeJsonExclusive(target, value) {
  await fs.writeFile(target, serializeJson(value), { encoding: "utf-8", flag: "wx" });
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Coding benchmark system smoke requires ${label}.`);
  }
  return value.trim();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

async function main() {
  const artifact = await runCodingAgentBenchmarkSystemSmoke(
    parseCodingAgentBenchmarkSystemSmokeCliArguments(process.argv.slice(2)),
  );
  console.log(
    `[coding-agent-system-smoke] ${artifact.platform} ${artifact.status} ${artifact.results.length} task(s)`,
  );
  if (artifact.status !== "passed") process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(scriptPath)) {
  main().catch((error) => {
    console.error(`[coding-agent-system-smoke] failed: ${safeMessage(error)}`);
    process.exitCode = 1;
  });
}
