import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { createCodingAgentBenchmarkReport, hashCodingAgentBenchmarkManifestText, loadCodingAgentBenchmarkManifest,
  resolveCodingAgentBenchmarkManifestPath, resolveCodingAgentBenchmarkTaskBudgets } from "./coding-agent-benchmark-contract.mjs";
import { assertCandidateTaskBudget, candidateRunPaths, readCandidateRunObservation } from "./coding-agent-candidate-materials.mjs";

const roots = [];
let manifest;
let manifestHash;
beforeAll(async () => {
  const file = resolveCodingAgentBenchmarkManifestPath("v3");
  manifest = await loadCodingAgentBenchmarkManifest(file);
  manifestHash = hashCodingAgentBenchmarkManifestText(await fs.readFile(file, "utf8"));
});
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "candidate-materials-test-"));
  roots.push(root);
  const task = manifest.tasks.find((item) => item.id === "bug.reproducible-fix");
  const slot = { taskId: task.id, platform: "windows-native", attempt: 1 };
  const identity = { commit: "a".repeat(40), workspaceDirty: false, lockfileSha256: "b".repeat(64), worktreeContentSha256: "c".repeat(64) };
  const config = {
    mode: "exploration", selection: [slot], identity, contracts: { manifest: manifestHash },
    roots: Object.fromEntries(["artifacts", "fixtures", "state", "ledger"].map((name) => [name, path.join(root, name)])),
    execution: { provider: "openai", modelId: "deepseek-v4-pro" },
  };
  const context = { config, configSha256: "d".repeat(64), manifest };
  const paths = candidateRunPaths(config, slot);
  await fs.mkdir(path.join(paths.artifactRoot, "fixture-run"), { recursive: true });
  await fs.mkdir(paths.journalRoot, { recursive: true });
  const artifacts = Object.fromEntries(["manifest", "events", "result", "patch", "diagnostics", "status", "preflight"].map((name) => [name, `fixture-run/${name}.txt`]));
  for (const relative of Object.values(artifacts)) await fs.writeFile(path.join(paths.artifactRoot, relative), "");
  const run = {
    schemaVersion: "coding-agent-benchmark-run/v3", runId: "fixture-run", ...slot,
    fixture: { generatorId: task.fixture.generatorId, version: task.fixture.version, resetStrategy: "regenerate", baselineCommit: "e".repeat(40) },
    status: "passed", failureCategory: null,
    execution: { profile: task.executionProfile, modelExecution: task.modelExecution,
      budgets: resolveCodingAgentBenchmarkTaskBudgets(manifest, task.id), infrastructureRetries: 0 },
    environment: { osRelease: "Windows fixture", arch: "x64", nodeVersion: process.version, packageManager: "pnpm fixture", wsl: null,
      model: { provider: "openai", id: "deepseek-v4-pro", credentialsConfigured: true } },
    evaluation: { source: "machine", taskCompleted: true, testsPassed: true, patchAccepted: null,
      dangerousOperationBlocked: null, recoverySucceeded: null, regressionCount: 0, manualInterventionCount: 0 },
    usage: { durationMs: 1, inputTokens: null, outputTokens: null, observation: { status: "not_reached", costUsd: null } }, artifacts,
  };
  const report = createCodingAgentBenchmarkReport({ manifest, manifestSha256: manifestHash, status: "partial",
    generatedAt: "2026-09-05T00:00:00.000Z", source: identity, harness: identity, runs: [run] });
  const reportPath = path.join(paths.artifactRoot, "benchmark-report.json");
  await fs.writeFile(reportPath, JSON.stringify(report));
  await fs.writeFile(paths.bindingPath, JSON.stringify({ schemaVersion: "coding-agent-candidate-run-binding/v1",
    formal: false, mode: "exploration", configSha256: context.configSha256, slot }));
  await fs.writeFile(path.join(paths.journalRoot, "env-cleanup.json"), JSON.stringify({ status: "recycled", stateRoot: paths.stateRoot, remaining: 0 }));
  await fs.writeFile(path.join(paths.journalRoot, "resources.json"), JSON.stringify({ status: "passed", configSha256: context.configSha256, counts: [0, 0, 0],
    sensitiveScan: { status: "completed", findingCount: 0, unreadableFileCount: 0, symlinkOrReparsePointCount: 0 } }));
  return { context, slot, paths, report, reportPath };
}

describe("candidate retained evidence", () => {
  it("rebuilds raw reports and keeps missing event usage reserved", async () => {
    const f = await fixture();
    const result = await readCandidateRunObservation(f.context, f.slot);
    expect(result.terminal).toMatchObject({ status: "reported", providerReportedCostUsd: 0, reservedUnknownCostUsd: 0.1 });
    expect(result.observation.checks.usageComplete).toBe(false);
    expect(await readCandidateRunObservation(f.context, f.slot, result.terminal)).toEqual(result);
  });

  it("detects artifact changes after the retained terminal without rerunning a slot", async () => {
    const f = await fixture();
    const result = await readCandidateRunObservation(f.context, f.slot);
    await fs.writeFile(path.join(f.paths.artifactRoot, "fixture-run/patch.txt"), "changed");
    await expect(readCandidateRunObservation(f.context, f.slot, result.terminal)).rejects.toThrow(/artifact hash/);
  });

  it("rejects a model or evidence-use change even when the report still rebuilds", async () => {
    const f = await fixture();
    await expect(readCandidateRunObservation({ ...f.context, config: { ...f.context.config, mode: "formal" } }, f.slot)).rejects.toThrow(/evidence use/);
    f.report.runs[0].environment.model.id = "other-model";
    await fs.writeFile(f.reportPath, JSON.stringify(f.report));
    await expect(readCandidateRunObservation(f.context, f.slot)).rejects.toThrow(/model drifted/);
  });

  it("rejects usage that disagrees with retained events", async () => {
    const f = await fixture();
    await fs.writeFile(path.join(f.paths.artifactRoot, "fixture-run/events.txt"), JSON.stringify({ type: "run.usage", payload: { usage: { inputTokens: 42 } } }));
    await expect(readCandidateRunObservation(f.context, f.slot)).rejects.toThrow(/usage differs/);
  });

  it("blocks frozen task overrides when the configuration has only the legacy 24000-token authorization", () => {
    const caps = { maxTurns: 12, maxTokens: 24000 };
    expect(() => assertCandidateTaskBudget(manifest, { taskId: "bug.reproducible-fix" }, caps)).not.toThrow();
    for (const taskId of ["command.interactive-control", "safety.boundary-enforcement", "real-go.public-api-migration"]) {
      expect(() => assertCandidateTaskBudget(manifest, { taskId }, caps)).toThrow(/authorized turn\/token cap/);
    }
  });

  it("allows explicitly approved task token caps while enforcing default tokens and turn limits", () => {
    const caps = { maxTurns: 12, maxTokens: 24000,
      taskTokenCaps: { "command.interactive-control": 36000, "safety.boundary-enforcement": 32000,
        "real-go.public-api-migration": 64000 } };
    for (const task of manifest.tasks) {
      expect(() => assertCandidateTaskBudget(manifest, { taskId: task.id }, caps)).not.toThrow();
    }
    expect(() => assertCandidateTaskBudget(manifest, { taskId: "command.interactive-control" }, { ...caps, maxTurns: 1 })).toThrow(/authorized turn\/token cap/);
    expect(() => assertCandidateTaskBudget(manifest, { taskId: "safety.boundary-enforcement" }, {
      ...caps, taskTokenCaps: { ...caps.taskTokenCaps, "safety.boundary-enforcement": 31999 },
    })).toThrow(/authorized turn\/token cap/);
    expect(() => assertCandidateTaskBudget(manifest, { taskId: "real-go.public-api-migration" }, {
      ...caps, taskTokenCaps: { "command.interactive-control": 36000, "safety.boundary-enforcement": 32000 },
    })).toThrow(/authorized turn\/token cap/);
    expect(() => assertCandidateTaskBudget(manifest, { taskId: "bug.reproducible-fix" }, { ...caps, maxTokens: 1 })).toThrow(/authorized turn\/token cap/);
  });
});
