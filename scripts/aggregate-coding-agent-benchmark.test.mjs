import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  aggregateCodingAgentBenchmarkReports,
  parseCodingAgentBenchmarkAggregationCliArguments,
  resolveCodingAgentBenchmarkAggregationManifestPath,
  verifyCodingAgentBaselineArtifact,
} from "./aggregate-coding-agent-benchmark.mjs";
import {
  createCodingAgentBenchmarkReport,
  hashCodingAgentBenchmarkManifestText,
  loadCodingAgentBenchmarkManifest,
  resolveCodingAgentBenchmarkTaskBudgets,
} from "./coding-agent-benchmark-contract.mjs";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const manifestPath = path.join(workspaceRoot, "benchmarks/coding-agent/v1/task-manifest.json");
const tempRoots = [];
let manifest;
let manifestText;
let manifestSha256;
let manifestV3;
let manifestV3Text;
let manifestV3Sha256;

beforeAll(async () => {
  [manifestText, manifest, manifestV3Text, manifestV3] = await Promise.all([
    fs.readFile(manifestPath, "utf-8"),
    loadCodingAgentBenchmarkManifest(manifestPath),
    fs.readFile(path.join(workspaceRoot, "benchmarks/coding-agent/v3/task-manifest.json"), "utf-8"),
    loadCodingAgentBenchmarkManifest(path.join(
      workspaceRoot,
      "benchmarks/coding-agent/v3/task-manifest.json",
    )),
  ]);
  manifestSha256 = hashCodingAgentBenchmarkManifestText(manifestText);
  manifestV3Sha256 = hashCodingAgentBenchmarkManifestText(manifestV3Text);
});

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })));
});

describe("coding agent baseline aggregation", () => {
  it("writes a partial baseline with an exact missing matrix and verifies it offline", async () => {
    const root = await makeTempRoot();
    const sourceRoot = path.join(root, "source");
    const outputRoot = path.join(root, "baseline");
    const task = manifest.tasks.find((item) => item.id === "rules.nested-precedence");
    const reportPath = await writeSourceReport(sourceRoot, [createRun(task, "windows-native", 1)]);

    const result = await aggregateCodingAgentBenchmarkReports({
      manifestPath,
      reportPaths: [reportPath],
      outputRoot,
      generatedAt: "2026-07-26T00:00:00.000Z",
    });

    expect(result.report.status).toBe("partial");
    expect(result.baselineIndex.coverage).toMatchObject({
      expectedRunCount: 72,
      collectedRunCount: 1,
      missingRunKeys: expect.arrayContaining([
        "rules.nested-precedence/windows-native/2",
        "gateway.process-restart/wsl2-linux/3",
      ]),
    });
    expect(result.baselineIndex.aggregates.byTask.find((item) => item.taskId === task.id)).toMatchObject({
      runCount: 1,
      passedRunCount: 1,
    });
    await expect(fs.readFile(path.join(outputRoot, "rules-nested-precedence-windows-native-a1", "events.jsonl"), "utf-8"))
      .resolves.toBe("fixture artifact\n");
    await expect(verifyCodingAgentBaselineArtifact({ outputRoot })).resolves.toMatchObject({
      report: { status: "partial" },
    });
  });

  it("fails closed before writing output when selected reports duplicate an attempt", async () => {
    const root = await makeTempRoot();
    const task = manifest.tasks.find((item) => item.id === "rules.nested-precedence");
    const firstReport = await writeSourceReport(path.join(root, "source-a"), [createRun(task, "windows-native", 1)]);
    const secondReport = await writeSourceReport(path.join(root, "source-b"), [createRun(task, "windows-native", 1)]);
    const outputRoot = path.join(root, "baseline");

    await expect(aggregateCodingAgentBenchmarkReports({
      manifestPath,
      reportPaths: [firstReport, secondReport],
      outputRoot,
    })).rejects.toThrow(/duplicate run attempt/i);
    await expect(fs.access(outputRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("marks the complete frozen matrix completed and recomputes it from retained source reports", async () => {
    const root = await makeTempRoot();
    const runs = manifest.tasks.flatMap((task) => task.platforms.flatMap((platform) => {
      return [1, 2, 3].map((attempt) => createRun(task, platform, attempt));
    }));
    const reportPath = await writeSourceReport(path.join(root, "source"), runs);
    const outputRoot = path.join(root, "baseline");

    const result = await aggregateCodingAgentBenchmarkReports({
      manifestPath,
      reportPaths: [reportPath],
      outputRoot,
      generatedAt: "2026-07-26T00:00:00.000Z",
    });

    expect(result.report).toMatchObject({ status: "completed", summary: { runCount: 72, passedRunCount: 72 } });
    expect(result.baselineIndex.coverage.missingRunKeys).toEqual([]);
    await expect(verifyCodingAgentBaselineArtifact({ outputRoot })).resolves.toMatchObject({
      report: { status: "completed" },
    });
  });

  it("rejects source identity drift before writing output", async () => {
    const root = await makeTempRoot();
    const task = manifest.tasks.find((item) => item.id === "rules.nested-precedence");
    const firstReport = await writeSourceReport(path.join(root, "source-a"), [createRun(task, "windows-native", 1)]);
    const secondReport = await writeSourceReport(path.join(root, "source-b"), [
      createRun(task, "windows-native", 2),
    ], { commit: "f".repeat(40), workspaceDirty: true, lockfileSha256: "d".repeat(64) });
    const outputRoot = path.join(root, "baseline");

    await expect(aggregateCodingAgentBenchmarkReports({
      manifestPath,
      reportPaths: [firstReport, secondReport],
      outputRoot,
    })).rejects.toThrow(/source identity drifted/i);
    await expect(fs.access(outputRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("aggregates and verifies v3 B/C artifacts against the native 144-run matrix", async () => {
    const root = await makeTempRoot();
    const sourceRoot = path.join(root, "source");
    const outputRoot = path.join(root, "baseline");
    const repositoryTask = manifestV3.tasks.find((item) => item.id === "real-js.bug-fix");
    const systemTask = manifestV3.tasks.find((item) => item.id === "system.browser-behavior");
    const reportPath = await writeV3SourceReport(sourceRoot, [
      createV3Run(repositoryTask, "windows-native", 1),
      createV3Run(systemTask, "windows-native", 1),
    ]);

    const result = await aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [reportPath],
      outputRoot,
      generatedAt: "2026-08-06T00:00:00.000Z",
    });

    expect(result.report).toMatchObject({
      schemaVersion: "coding-agent-benchmark-report/v3",
      status: "partial",
      summary: { runCount: 2, productRunCount: 2 },
    });
    expect(result.baselineIndex.coverage).toMatchObject({
      expectedRunCount: 144,
      collectedRunCount: 2,
      missingRunKeys: expect.arrayContaining([
        "real-js.bug-fix/windows-native/2",
        "system.restart-delivery-reconciliation/wsl2-linux/3",
      ]),
    });
    for (const [run, artifactName] of [
      [result.report.runs.find((item) => item.taskId === repositoryTask.id), "repository-snapshot-receipt.json"],
      [result.report.runs.find((item) => item.taskId === systemTask.id), "system-evidence.json"],
    ]) {
      await expect(fs.readFile(path.join(outputRoot, run.runId, artifactName), "utf-8"))
        .resolves.toBe("fixture artifact\n");
    }
    const browserRun = result.report.runs.find((item) => item.taskId === systemTask.id);
    await expect(fs.readFile(path.join(
      outputRoot,
      browserRun.artifacts.systemBrowserScreenshot,
    ))).resolves.toEqual(V3_BROWSER_SCREENSHOT);
    await expect(verifyCodingAgentBaselineArtifact({ outputRoot })).resolves.toMatchObject({
      report: { schemaVersion: "coding-agent-benchmark-report/v3", status: "partial" },
      baselineIndex: { coverage: { expectedRunCount: 144 } },
    });
  });

  it("marks the complete v3 144-run matrix completed without writing Provider output", async () => {
    const root = await makeTempRoot();
    const runs = manifestV3.tasks.flatMap((task) => task.platforms.flatMap((platform) => {
      return [1, 2, 3].map((attempt) => createV3Run(task, platform, attempt));
    }));
    const reportPath = await writeV3SourceReport(path.join(root, "source"), runs);

    const result = await aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [reportPath],
      writeOutput: false,
      generatedAt: "2026-08-06T00:00:00.000Z",
    });

    expect(result.report).toMatchObject({
      status: "completed",
      summary: { runCount: 144, passedRunCount: 144, eligibleForProductComparison: true },
    });
    expect(result.baselineIndex.coverage).toMatchObject({
      expectedRunCount: 144,
      collectedRunCount: 144,
      missingRunKeys: [],
    });
  });

  it("rejects v3 harness HEAD drift and missing layer-specific evidence before writing output", async () => {
    const root = await makeTempRoot();
    const task = manifestV3.tasks.find((item) => item.id === "real-js.bug-fix");
    const firstReport = await writeV3SourceReport(
      path.join(root, "source-a"),
      [createV3Run(task, "windows-native", 1)],
    );
    const secondReport = await writeV3SourceReport(
      path.join(root, "source-b"),
      [createV3Run(task, "windows-native", 2)],
      { harness: versionedIdentity("f") },
    );
    const driftOutputRoot = path.join(root, "baseline-drift");
    await expect(aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [firstReport, secondReport],
      outputRoot: driftOutputRoot,
    })).rejects.toThrow(/harness identity drifted/i);
    await expect(fs.access(driftOutputRoot)).rejects.toMatchObject({ code: "ENOENT" });

    const missingReport = await writeV3SourceReport(
      path.join(root, "source-missing"),
      [createV3Run(task, "wsl2-linux", 1)],
    );
    const parsed = JSON.parse(await fs.readFile(missingReport, "utf-8"));
    const missingPath = parsed.runs[0].artifacts.repositorySnapshotReceipt;
    await fs.rm(path.join(path.dirname(missingReport), missingPath));
    const missingOutputRoot = path.join(root, "baseline-missing");
    await expect(aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [missingReport],
      outputRoot: missingOutputRoot,
    })).rejects.toThrow(/source artifact is not a regular file/i);
    await expect(fs.access(missingOutputRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a v3 baseline when a retained layer-specific artifact is missing", async () => {
    const root = await makeTempRoot();
    const outputRoot = path.join(root, "baseline");
    const task = manifestV3.tasks.find((item) => item.id === "system.parallel-write-fan-in");
    const reportPath = await writeV3SourceReport(
      path.join(root, "source"),
      [createV3Run(task, "windows-native", 1)],
    );
    const result = await aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [reportPath],
      outputRoot,
      generatedAt: "2026-08-06T00:00:00.000Z",
    });
    const run = result.report.runs[0];
    await fs.rm(path.join(outputRoot, run.artifacts.systemEvidence));

    await expect(verifyCodingAgentBaselineArtifact({ outputRoot }))
      .rejects.toThrow(/artifact is not a regular file.*system-evidence\.json/i);
  });
});

describe("coding agent baseline aggregation CLI", () => {
  it("selects frozen v2/v3 manifests explicitly while preserving the v1 default", () => {
    expect(resolveCodingAgentBenchmarkAggregationManifestPath({})).toBe(manifestPath);
    expect(resolveCodingAgentBenchmarkAggregationManifestPath({ manifestRevision: "v2" })).toBe(path.join(
      workspaceRoot,
      "benchmarks/coding-agent/v2/task-manifest.json",
    ));
    expect(resolveCodingAgentBenchmarkAggregationManifestPath({ manifestRevision: "v3" })).toBe(path.join(
      workspaceRoot,
      "benchmarks/coding-agent/v3/task-manifest.json",
    ));
    expect(parseCodingAgentBenchmarkAggregationCliArguments([
      "--manifest-revision", "v2",
      "--report", "first-report.json",
      "--dry-run",
    ])).toMatchObject({
      manifestRevision: "v2",
      reportPaths: ["first-report.json"],
      writeOutput: false,
      verify: false,
    });
    expect(parseCodingAgentBenchmarkAggregationCliArguments([
      "--manifest-revision", "v3",
      "--report", "v3-report.json",
      "--dry-run",
    ])).toMatchObject({ manifestRevision: "v3", reportPaths: ["v3-report.json"] });
  });

  it("rejects ambiguous or invalid manifest selection", () => {
    expect(() => parseCodingAgentBenchmarkAggregationCliArguments([
      "--manifest-revision", "v2",
      "--manifest-revision", "v1",
    ])).toThrow(/manifest-revision.*once/i);
    expect(() => parseCodingAgentBenchmarkAggregationCliArguments([
      "--manifest-revision", "v4",
    ])).toThrow(/manifest revision/i);
    expect(() => resolveCodingAgentBenchmarkAggregationManifestPath({
      manifestPath,
      manifestRevision: "v2",
    })).toThrow(/manifestPath.*manifestRevision/i);
  });
});

async function makeTempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-agent-baseline-"));
  tempRoots.push(root);
  return root;
}

async function writeSourceReport(root, runs, source = defaultSource()) {
  await fs.mkdir(root, { recursive: true });
  for (const run of runs) {
    for (const artifactPath of Object.values(run.artifacts)) {
      const target = path.join(root, artifactPath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, "fixture artifact\n", "utf-8");
    }
  }
  const report = createCodingAgentBenchmarkReport({
    status: "partial",
    generatedAt: "2026-07-26T00:00:00.000Z",
    manifest,
    manifestSha256,
    source,
    runs,
  });
  const reportPath = path.join(root, "benchmark-report.json");
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  return reportPath;
}

function createRun(task, platform, attempt) {
  const runId = `${task.id.replace(/[^A-Za-z0-9]+/g, "-")}-${platform}-a${attempt}`;
  const artifacts = {
    manifest: `${runId}/manifest.json`,
    events: `${runId}/events.jsonl`,
    result: `${runId}/result.json`,
    patch: `${runId}/changes.patch`,
    diagnostics: `${runId}/diagnostics.log`,
    status: `${runId}/status.txt`,
  };
  if (task.id === "gateway.disconnect-recovery") {
    artifacts.faultInjection = `${runId}/fault-injection.json`;
  }
  if (task.id === "gateway.client-cancel") {
    artifacts.cancelInjection = `${runId}/cancel-injection.json`;
  }
  if (task.id === "gateway.process-restart") {
    artifacts.restartInjection = `${runId}/restart-injection.json`;
  }
  return {
    schemaVersion: "coding-agent-benchmark-run/v1",
    runId,
    taskId: task.id,
    attempt,
    platform,
    fixture: {
      generatorId: task.fixture.generatorId,
      version: 1,
      resetStrategy: "regenerate",
      baselineCommit: "a".repeat(40),
    },
    status: "passed",
    failureCategory: null,
    execution: {
      profile: task.executionProfile,
      budgets: structuredClone(manifest.suite.budgets),
      infrastructureRetries: 0,
    },
    environment: {
      osRelease: platform === "windows-native" ? "Windows fixture" : "Linux fixture",
      arch: "x64",
      nodeVersion: "v22.12.0",
      packageManager: "pnpm@10.23.0",
      wsl: platform === "wsl2-linux" ? { distribution: "Ubuntu-22.04", version: 2 } : null,
      model: { provider: "fixture", id: "baseline-fixture", credentialsConfigured: false },
    },
    evaluation: {
      source: "machine",
      taskCompleted: true,
      testsPassed: true,
      patchAccepted: task.executionProfile === "workspace-write" || task.id === "gateway.disconnect-recovery",
      dangerousOperationBlocked: task.id === "safety.boundary-enforcement" ? true : null,
      recoverySucceeded: task.id === "gateway.disconnect-recovery" ? true : null,
      regressionCount: 0,
      manualInterventionCount: 0,
    },
    usage: { durationMs: 1, inputTokens: null, outputTokens: null },
    artifacts,
  };
}

function defaultSource() {
  return { commit: "c".repeat(40), workspaceDirty: true, lockfileSha256: "d".repeat(64) };
}

async function writeV3SourceReport(root, runs, identities = {}) {
  await fs.mkdir(root, { recursive: true });
  for (const run of runs) {
    for (const artifactPath of Object.values(run.artifacts)) {
      const target = path.join(root, artifactPath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(
        target,
        path.basename(artifactPath) === "browser-screenshot.png"
          ? V3_BROWSER_SCREENSHOT
          : "fixture artifact\n",
      );
    }
  }
  const report = createCodingAgentBenchmarkReport({
    status: "partial",
    generatedAt: "2026-08-06T00:00:00.000Z",
    manifest: manifestV3,
    manifestSha256: manifestV3Sha256,
    harness: identities.harness ?? versionedIdentity("b"),
    source: identities.source ?? versionedIdentity("c"),
    runs,
  });
  const reportPath = path.join(root, "benchmark-report.json");
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  return reportPath;
}

function createV3Run(task, platform, attempt) {
  const runId = `${task.id.replace(/[^A-Za-z0-9]+/g, "-")}-${platform}-a${attempt}`;
  const artifacts = {
    manifest: `${runId}/manifest.json`,
    events: `${runId}/events.jsonl`,
    result: `${runId}/result.json`,
    patch: `${runId}/changes.patch`,
    diagnostics: `${runId}/diagnostics.log`,
    status: `${runId}/status.txt`,
    preflight: `${runId}/preflight.json`,
  };
  if (task.id === "command.interactive-control" || task.id === "safety.boundary-enforcement") {
    artifacts.approvalContract = `${runId}/approval-contract.json`;
    artifacts.approvalEvidence = `${runId}/approval-evidence.json`;
  }
  if (task.id === "gateway.disconnect-recovery") artifacts.faultInjection = `${runId}/fault-injection.json`;
  if (task.id === "gateway.client-cancel") artifacts.cancelInjection = `${runId}/cancel-injection.json`;
  if (task.id === "gateway.process-restart") artifacts.restartInjection = `${runId}/restart-injection.json`;
  if (task.layer === "B") {
    artifacts.repositorySnapshotPreflight = `${runId}/repository-snapshot-preflight.json`;
    artifacts.repositorySnapshotReceipt = `${runId}/repository-snapshot-receipt.json`;
  }
  if (task.layer === "C") {
    artifacts.systemScenario = `${runId}/system-scenario.json`;
    artifacts.systemEvidence = `${runId}/system-evidence.json`;
  }
  if (task.id === "system.browser-behavior") {
    artifacts.systemBrowserScreenshot = `${runId}/browser-screenshot.png`;
  }
  return {
    schemaVersion: "coding-agent-benchmark-run/v3",
    runId,
    taskId: task.id,
    attempt,
    platform,
    fixture: {
      generatorId: task.fixture.generatorId,
      version: task.fixture.version,
      resetStrategy: "regenerate",
      baselineCommit: "a".repeat(40),
    },
    status: "passed",
    failureCategory: null,
    execution: {
      profile: task.executionProfile,
      budgets: resolveCodingAgentBenchmarkTaskBudgets(manifestV3, task.id),
      infrastructureRetries: 0,
    },
    environment: {
      osRelease: platform === "windows-native" ? "Windows fixture" : "Linux fixture",
      arch: "x64",
      nodeVersion: "v22.23.1",
      packageManager: "pnpm@10.23.0",
      wsl: platform === "wsl2-linux" ? { distribution: "Ubuntu-22.04", version: 2 } : null,
      model: { provider: "fixture", id: "v3-baseline-fixture", credentialsConfigured: false },
    },
    evaluation: {
      source: "machine",
      taskCompleted: true,
      testsPassed: task.layer === "C" ? null : true,
      patchAccepted: task.layer === "B" ? true : null,
      dangerousOperationBlocked: task.id === "safety.boundary-enforcement" || task.layer === "C" ? true : null,
      recoverySucceeded: task.id === "gateway.disconnect-recovery"
        || task.id === "system.restart-delivery-reconciliation" ? true : null,
      regressionCount: 0,
      manualInterventionCount: 0,
    },
    usage: {
      durationMs: 1,
      inputTokens: null,
      outputTokens: null,
      observation: { status: "not_reached", costUsd: null },
    },
    artifacts,
  };
}

const V3_BROWSER_SCREENSHOT = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function versionedIdentity(seed) {
  return {
    commit: seed.repeat(40),
    workspaceDirty: false,
    lockfileSha256: seed.repeat(64),
    worktreeContentSha256: seed.repeat(64),
  };
}
