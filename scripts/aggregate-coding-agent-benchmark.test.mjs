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
} from "./coding-agent-benchmark-contract.mjs";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const manifestPath = path.join(workspaceRoot, "benchmarks/coding-agent/v1/task-manifest.json");
const tempRoots = [];
let manifest;
let manifestText;
let manifestSha256;

beforeAll(async () => {
  [manifestText, manifest] = await Promise.all([
    fs.readFile(manifestPath, "utf-8"),
    loadCodingAgentBenchmarkManifest(manifestPath),
  ]);
  manifestSha256 = hashCodingAgentBenchmarkManifestText(manifestText);
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
});

describe("coding agent baseline aggregation CLI", () => {
  it("selects the frozen v2 manifest explicitly while preserving the v1 default", () => {
    expect(resolveCodingAgentBenchmarkAggregationManifestPath({})).toBe(manifestPath);
    expect(resolveCodingAgentBenchmarkAggregationManifestPath({ manifestRevision: "v2" })).toBe(path.join(
      workspaceRoot,
      "benchmarks/coding-agent/v2/task-manifest.json",
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
  });

  it("rejects ambiguous or invalid manifest selection", () => {
    expect(() => parseCodingAgentBenchmarkAggregationCliArguments([
      "--manifest-revision", "v2",
      "--manifest-revision", "v1",
    ])).toThrow(/manifest-revision.*once/i);
    expect(() => parseCodingAgentBenchmarkAggregationCliArguments([
      "--manifest-revision", "v3",
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
