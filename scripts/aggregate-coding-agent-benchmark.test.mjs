import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  aggregateCodingAgentBenchmarkReports,
  createCodingAgentBenchmarkExpectedReportPlan,
  loadCodingAgentBenchmarkExpectedReportPlanFile,
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
import {
  qualifyCodingAgentBenchmarkCandidate,
  writeCodingAgentCandidateGlobalReceipt,
} from "./coding-agent-candidate-qualification.mjs";
import {
  runCodingAgentCandidateQualificationCommand,
  verifyCodingAgentCandidateQualificationReport,
  writeCodingAgentCandidateQualificationReport,
} from "./run-coding-agent-candidate-qualification.mjs";
import { runCodingAgentCandidateGlobalReceipt } from "./run-coding-agent-candidate-global-receipt.mjs";
import {
  createCodingAgentBenchmarkCandidateExpectedReportPlan,
  resolveCodingAgentBenchmarkCandidateReportPath,
} from "./run-coding-agent-benchmark-expected-report-plan.mjs";

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
  it("rejects exploration evidence before creating an aggregate", async () => {
    const root = await makeTempRoot();
    const sourceRoot = path.join(root, "exploration");
    const task = manifest.tasks.find((item) => item.id === "rules.nested-precedence");
    const reportPath = await writeSourceReport(sourceRoot, [createRun(task, "windows-native", 1)]);
    await fs.writeFile(`${sourceRoot}.candidate.json`, JSON.stringify({
      schemaVersion: "coding-agent-candidate-run-binding/v1", mode: "exploration", formal: false,
    }));
    const outputRoot = path.join(root, "aggregate");
    await expect(aggregateCodingAgentBenchmarkReports({ manifestPath, reportPaths: [reportPath], outputRoot }))
      .rejects.toThrow(/Exploration evidence/);
    await expect(fs.access(outputRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

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

describe("coding agent candidate qualification", { timeout: 15_000 }, () => {
  it("keeps a partial v3 aggregate not eligible and unscored", async () => {
    const root = await makeTempRoot();
    const outputRoot = path.join(root, "baseline");
    const task = manifestV3.tasks.find((item) => item.id === "real-js.bug-fix");
    const reportPath = await writeV3SourceReport(
      path.join(root, "source"),
      [createV3Run(task, "windows-native", 1)],
    );
    await aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [reportPath],
      outputRoot,
      generatedAt: "2026-09-01T00:00:00.000Z",
    });

    const qualification = await qualifyCodingAgentBenchmarkCandidate({ aggregateRoot: outputRoot });

    expect(qualification).toMatchObject({
      schemaVersion: "coding-agent-benchmark-candidate-qualification/v2",
      status: "not_eligible",
      generatedAt: "2026-09-01T00:00:00.000Z",
      coverage: {
        expectedRunCount: 144,
        collectedRunCount: 1,
        missingRunCount: 143,
      },
      scores: {
        dimensions: [
          { id: "context_retrieval", score: null, status: "unscored" },
          { id: "editing_testing", score: null, status: "unscored" },
          { id: "cli_tui", score: null, status: "unscored" },
          { id: "safety_recovery", score: null, status: "unscored" },
          { id: "session_long_running", score: null, status: "unscored" },
          { id: "headless_ecosystem", score: null, status: "unscored" },
          { id: "git_delivery", score: null, status: "unscored" },
        ],
        rawWeighted: null,
        status: "unscored",
      },
      blockingReasons: [
        {
          code: "incomplete_matrix",
          expectedRunCount: 144,
          collectedRunCount: 1,
          missingRunCount: 143,
        },
      ],
    });

    const artifact = await runCodingAgentCandidateQualificationCommand({
      aggregateRoot: outputRoot,
      verify: false,
    });
    expect(artifact).toMatchObject({
      schemaVersion: "coding-agent-benchmark-candidate-qualification-report/v2",
      generatedAt: "2026-09-01T00:00:00.000Z",
      source: {
        manifestSha256: manifestV3Sha256,
        reportSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        indexSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        scorecardSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        dimensionMappingSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        scoreEvaluationSchemaVersion:
          "coding-agent-benchmark-candidate-score-evaluation/v1",
        evidence: {
          schemaVersion: "coding-agent-benchmark-qualification-evidence-digest/v2",
          entryCount: expect.any(Number),
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      },
      decision: qualification,
    });
    const artifactText = await fs.readFile(
      path.join(outputRoot, "candidate-qualification.json"),
      "utf-8",
    );
    await expect(runCodingAgentCandidateQualificationCommand({
      aggregateRoot: outputRoot,
      verify: true,
    }))
      .resolves.toEqual(artifact);
    await expect(writeCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .rejects.toMatchObject({ code: "EEXIST" });
    await expect(fs.readFile(path.join(outputRoot, "candidate-qualification.json"), "utf-8"))
      .resolves.toBe(artifactText);
  });

  it("writes and verifies a partial qualification report through the production CLI", async () => {
    const root = await makeTempRoot();
    const outputRoot = path.join(root, "baseline");
    const task = manifestV3.tasks.find((item) => item.id === "real-js.bug-fix");
    const reportPath = await writeV3SourceReport(
      path.join(root, "source"),
      [createV3Run(task, "windows-native", 1)],
    );
    await aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [reportPath],
      outputRoot,
      generatedAt: "2026-09-01T00:00:00.000Z",
    });

    const writeResult = runCandidateQualificationCli(["--aggregate-root", outputRoot]);
    expect(writeResult.status).toBe(0);
    expect(writeResult.stdout).toMatch(/wrote coding-agent-benchmark-candidate-qualification-report\/v2 not_eligible/i);
    expect(writeResult.stderr).not.toMatch(/failed:/i);
    await expect(fs.readFile(path.join(outputRoot, "candidate-qualification.json"), "utf-8"))
      .resolves.toContain('"schemaVersion": "coding-agent-benchmark-candidate-qualification-report/v2"');

    const verifyResult = runCandidateQualificationCli(["--aggregate-root", outputRoot, "--verify"]);
    expect(verifyResult.status).toBe(0);
    expect(verifyResult.stdout).toMatch(/verified coding-agent-benchmark-candidate-qualification-report\/v2 not_eligible/i);
    expect(verifyResult.stderr).not.toMatch(/failed:/i);
  });

  it("rejects a schema-valid qualification report that no longer matches retained evidence", async () => {
    const root = await makeTempRoot();
    const outputRoot = path.join(root, "baseline");
    const task = manifestV3.tasks.find((item) => item.id === "real-js.bug-fix");
    const reportPath = await writeV3SourceReport(
      path.join(root, "source"),
      [createV3Run(task, "windows-native", 1)],
    );
    await aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [reportPath],
      outputRoot,
      generatedAt: "2026-09-01T00:00:00.000Z",
    });
    await writeCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot });
    const qualificationPath = path.join(outputRoot, "candidate-qualification.json");
    const qualification = JSON.parse(await fs.readFile(qualificationPath, "utf-8"));
    qualification.source.evidence.sha256 = "0".repeat(64);
    await fs.writeFile(qualificationPath, `${JSON.stringify(qualification, null, 2)}\n`, "utf-8");

    await expect(verifyCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .rejects.toThrow(/cannot be reconstructed from retained evidence/i);
  });

  it("rejects retained run-artifact drift through the production verify CLI", async () => {
    const root = await makeTempRoot();
    const outputRoot = path.join(root, "baseline");
    const task = manifestV3.tasks.find((item) => item.id === "real-js.bug-fix");
    const reportPath = await writeV3SourceReport(
      path.join(root, "source"),
      [createV3Run(task, "windows-native", 1)],
    );
    await aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [reportPath],
      outputRoot,
      generatedAt: "2026-09-01T00:00:00.000Z",
    });
    await writeCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot });
    const aggregateReport = JSON.parse(await fs.readFile(
      path.join(outputRoot, "benchmark-report.json"),
      "utf-8",
    ));
    const retainedEventPath = path.join(outputRoot, aggregateReport.runs[0].artifacts.events);
    await fs.appendFile(retainedEventPath, "retained evidence drift\n", "utf-8");

    const verifyResult = runCandidateQualificationCli([
      "--aggregate-root",
      outputRoot,
      "--verify",
    ]);
    expect(verifyResult.status).toBe(1);
    expect(verifyResult.stdout).not.toMatch(/verified/i);
    expect(verifyResult.stderr).toMatch(/failed:.*(artifact|retained|reconstruct)/i);
  });

  it("rejects dimension evidence reference drift through the production verify CLI", async () => {
    const root = await makeTempRoot();
    const outputRoot = path.join(root, "baseline");
    const task = manifestV3.tasks.find((item) => item.id === "real-js.bug-fix");
    const reportPath = await writeV3SourceReport(
      path.join(root, "source"),
      [createV3Run(task, "windows-native", 1)],
    );
    await aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [reportPath],
      outputRoot,
      generatedAt: "2026-09-01T00:00:00.000Z",
    });
    await writeCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot });
    await fs.writeFile(
      path.join(outputRoot, "candidate-dimension-evidence-reference.json"),
      "{}\n",
      "utf-8",
    );

    const verifyResult = runCandidateQualificationCli([
      "--aggregate-root",
      outputRoot,
      "--verify",
    ]);
    expect(verifyResult.status).toBe(1);
    expect(verifyResult.stderr).toMatch(/failed:.*reconstruct/i);
  });

  it("keeps a complete aggregate unscored when its candidate-global receipt is absent", async () => {
    const root = await makeTempRoot();
    const outputRoot = path.join(root, "baseline");
    const runs = manifestV3.tasks.flatMap((task) => task.platforms.flatMap((platform) => {
      return [1, 2, 3].map((attempt) => createV3Run(task, platform, attempt));
    }));
    const reportPath = await writeV3SourceReport(path.join(root, "source"), runs);
    await aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [reportPath],
      outputRoot,
      generatedAt: "2026-09-01T00:00:00.000Z",
    });

    const qualification = await qualifyCodingAgentBenchmarkCandidate({ aggregateRoot: outputRoot });

    expect(qualification).toMatchObject({
      status: "not_eligible",
      coverage: { expectedRunCount: 144, collectedRunCount: 144, missingRunCount: 0 },
      scores: { rawWeighted: null, status: "unscored" },
      blockingReasons: [{
        code: "candidate_global_receipt_missing",
        path: "candidate-global-receipt.json",
        schemaVersion: "coding-agent-benchmark-candidate-global-receipt/v1",
      }],
    });
    expect(qualification.scores.dimensions).toHaveLength(7);
    expect(qualification.scores.dimensions.every((dimension) => {
      return dimension.score === null && dimension.status === "unscored";
    })).toBe(true);
    await expect(writeCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
    await expect(verifyCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
  });

  it("fails the missing-report hard Gate independently from complete run coverage", async () => {
    const root = await makeTempRoot();
    const outputRoot = path.join(root, "baseline");
    const runs = manifestV3.tasks.flatMap((task) => task.platforms.flatMap((platform) => {
      return [1, 2, 3].map((attempt) => createV3Run(task, platform, attempt));
    }));
    const reportPath = await writeV3SourceReport(path.join(root, "source"), runs);
    const expectedReportPlan = createCodingAgentBenchmarkExpectedReportPlan({
      manifestSha256: manifestV3Sha256,
      reports: [
        { reportId: "candidate-native-matrix", path: reportPath },
        {
          reportId: "candidate-required-gates",
          path: path.join(root, "expected-but-missing", "benchmark-report.json"),
        },
      ],
    });
    await aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [reportPath],
      expectedReportPlan,
      outputRoot,
      generatedAt: "2026-09-01T00:00:00.000Z",
    });

    const qualification = await qualifyCodingAgentBenchmarkCandidate({ aggregateRoot: outputRoot });
    expect(qualification).toMatchObject({
      status: "not_eligible",
      coverage: { expectedRunCount: 144, collectedRunCount: 144, missingRunCount: 0 },
      scores: { rawWeighted: null, status: "unscored" },
      blockingReasons: [{
        code: "candidate_aggregate_hard_gate_failed",
        failedGates: [{
          id: "missingReportCountMaximum",
          observed: 1,
          maximum: 0,
        }],
      }],
    });
    await expect(writeCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
    await expect(verifyCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
  });

  it("keeps a complete aggregate unscored when its candidate-global receipt violates the schema", async () => {
    const root = await makeTempRoot();
    const outputRoot = path.join(root, "baseline");
    const runs = manifestV3.tasks.flatMap((task) => task.platforms.flatMap((platform) => {
      return [1, 2, 3].map((attempt) => createV3Run(task, platform, attempt));
    }));
    const reportPath = await writeV3SourceReport(path.join(root, "source"), runs);
    await aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [reportPath],
      outputRoot,
      generatedAt: "2026-09-01T00:00:00.000Z",
    });
    await fs.writeFile(path.join(outputRoot, "candidate-global-receipt.json"), "{}\n", "utf-8");

    const qualification = await qualifyCodingAgentBenchmarkCandidate({ aggregateRoot: outputRoot });

    expect(qualification).toMatchObject({
      status: "not_eligible",
      scores: { rawWeighted: null, status: "unscored" },
      blockingReasons: [{
        code: "candidate_global_receipt_invalid",
        path: "candidate-global-receipt.json",
        reason: "schema_validation_failed",
      }],
    });
    await expect(writeCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
    await expect(verifyCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
  });

  it("rejects a schema-valid candidate-global receipt bound to another aggregate", async () => {
    const root = await makeTempRoot();
    const outputRoot = path.join(root, "baseline");
    const runs = manifestV3.tasks.flatMap((task) => task.platforms.flatMap((platform) => {
      return [1, 2, 3].map((attempt) => createV3Run(task, platform, attempt));
    }));
    const reportPath = await writeV3SourceReport(path.join(root, "source"), runs);
    await aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [reportPath],
      outputRoot,
      generatedAt: "2026-09-01T00:00:00.000Z",
    });
    await fs.writeFile(
      path.join(outputRoot, "candidate-global-receipt.json"),
      `${JSON.stringify(createCandidateGlobalReceipt({
        manifestSha256: "1".repeat(64),
        reportSha256: "2".repeat(64),
        indexSha256: "3".repeat(64),
        source: versionedIdentity("4"),
        harness: versionedIdentity("5"),
      }), null, 2)}\n`,
      "utf-8",
    );

    const qualification = await qualifyCodingAgentBenchmarkCandidate({ aggregateRoot: outputRoot });

    expect(qualification).toMatchObject({
      status: "not_eligible",
      scores: { rawWeighted: null, status: "unscored" },
      blockingReasons: [{
        code: "candidate_global_receipt_invalid",
        path: "candidate-global-receipt.json",
        reason: "aggregate_binding_mismatch",
        mismatchedFields: [
          "aggregate.manifestSha256",
          "aggregate.reportSha256",
          "aggregate.indexSha256",
          "aggregate.source",
          "aggregate.harness",
        ],
      }],
    });
    await expect(writeCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
    await expect(verifyCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
  });

  it("fails non-compensable candidate-global sensitive and orphan-resource gates before scoring", async () => {
    const root = await makeTempRoot();
    const outputRoot = path.join(root, "baseline");
    const runs = manifestV3.tasks.flatMap((task) => task.platforms.flatMap((platform) => {
      return [1, 2, 3].map((attempt) => createV3Run(task, platform, attempt));
    }));
    const reportPath = await writeV3SourceReport(path.join(root, "source"), runs);
    await aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [reportPath],
      outputRoot,
      generatedAt: "2026-09-01T00:00:00.000Z",
    });
    const receipt = createCandidateGlobalReceipt(await readCandidateGlobalReceiptBinding(outputRoot));
    receipt.sensitiveScan.findingCount = 1;
    receipt.resourceSweeps[0].remainingOwnedProcessCount = 1;
    receipt.resourceSweeps[0].orphanResourceCount = 1;
    await fs.writeFile(
      path.join(outputRoot, "candidate-global-receipt.json"),
      `${JSON.stringify(receipt, null, 2)}\n`,
      "utf-8",
    );

    const qualification = await qualifyCodingAgentBenchmarkCandidate({ aggregateRoot: outputRoot });

    expect(qualification).toMatchObject({
      status: "not_eligible",
      scores: { rawWeighted: null, status: "unscored" },
      blockingReasons: [{
        code: "candidate_global_hard_gate_failed",
        failedGates: [
          { id: "sensitiveFindingCountMaximum", observed: 1, maximum: 0 },
          { id: "orphanResourceCountMaximum", observed: 1, maximum: 0 },
        ],
      }],
    });
    await expect(writeCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
    await expect(verifyCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
  });

  it("rejects a candidate-global receipt when the sensitive scan is incomplete", async () => {
    const root = await makeTempRoot();
    const outputRoot = path.join(root, "baseline");
    const runs = manifestV3.tasks.flatMap((task) => task.platforms.flatMap((platform) => {
      return [1, 2, 3].map((attempt) => createV3Run(task, platform, attempt));
    }));
    const reportPath = await writeV3SourceReport(path.join(root, "source"), runs);
    await aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [reportPath],
      outputRoot,
      generatedAt: "2026-09-01T00:00:00.000Z",
    });
    const receipt = createCandidateGlobalReceipt(await readCandidateGlobalReceiptBinding(outputRoot));
    receipt.sensitiveScan.unreadableFileCount = 1;
    await fs.writeFile(
      path.join(outputRoot, "candidate-global-receipt.json"),
      `${JSON.stringify(receipt, null, 2)}\n`,
      "utf-8",
    );

    const qualification = await qualifyCodingAgentBenchmarkCandidate({ aggregateRoot: outputRoot });

    expect(qualification).toMatchObject({
      status: "not_eligible",
      scores: { rawWeighted: null, status: "unscored" },
      blockingReasons: [{
        code: "candidate_global_receipt_invalid",
        path: "candidate-global-receipt.json",
        reason: "sensitive_scan_incomplete",
        unreadableFileCount: 1,
      }],
    });
    await expect(writeCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
    await expect(verifyCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
  });

  it("rejects a candidate-global receipt whose resource sweep hides a remaining resource", async () => {
    const root = await makeTempRoot();
    const outputRoot = path.join(root, "baseline");
    const runs = manifestV3.tasks.flatMap((task) => task.platforms.flatMap((platform) => {
      return [1, 2, 3].map((attempt) => createV3Run(task, platform, attempt));
    }));
    const reportPath = await writeV3SourceReport(path.join(root, "source"), runs);
    await aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [reportPath],
      outputRoot,
      generatedAt: "2026-09-01T00:00:00.000Z",
    });
    const receipt = createCandidateGlobalReceipt(await readCandidateGlobalReceiptBinding(outputRoot));
    receipt.resourceSweeps[0].remainingOwnedProcessCount = 1;
    await fs.writeFile(
      path.join(outputRoot, "candidate-global-receipt.json"),
      `${JSON.stringify(receipt, null, 2)}\n`,
      "utf-8",
    );

    const qualification = await qualifyCodingAgentBenchmarkCandidate({ aggregateRoot: outputRoot });

    expect(qualification).toMatchObject({
      status: "not_eligible",
      scores: { rawWeighted: null, status: "unscored" },
      blockingReasons: [{
        code: "candidate_global_receipt_invalid",
        path: "candidate-global-receipt.json",
        reason: "resource_sweep_inconsistent",
        platforms: ["windows-native"],
      }],
    });
    await expect(writeCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
    await expect(verifyCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
  });

  it("writes a candidate-global receipt with binding derived from a verified complete aggregate", async () => {
    const root = await makeTempRoot();
    const outputRoot = path.join(root, "baseline");
    const runs = manifestV3.tasks.flatMap((task) => task.platforms.flatMap((platform) => {
      return [1, 2, 3].map((attempt) => createV3Run(task, platform, attempt));
    }));
    const reportPath = await writeV3SourceReport(path.join(root, "source"), runs);
    await aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [reportPath],
      outputRoot,
      generatedAt: "2026-09-01T00:00:00.000Z",
    });

    const receipt = await writeCodingAgentCandidateGlobalReceipt({
      aggregateRoot: outputRoot,
      generatedAt: "2026-09-01T01:00:00.000Z",
      sensitiveScan: createCandidateGlobalReceipt({}).sensitiveScan,
      resourceSweeps: [
        createResourceSweep("windows-native"),
        createResourceSweep("wsl2-linux"),
      ],
    });

    expect(receipt).toMatchObject({
      schemaVersion: "coding-agent-benchmark-candidate-global-receipt/v1",
      generatedAt: "2026-09-01T01:00:00.000Z",
      aggregate: await readCandidateGlobalReceiptBinding(outputRoot),
      sensitiveScan: { findingCount: 0, unreadableFileCount: 0 },
      resourceSweeps: [
        { platform: "windows-native", orphanResourceCount: 0 },
        { platform: "wsl2-linux", orphanResourceCount: 0 },
      ],
    });
    await expect(fs.readFile(path.join(outputRoot, "candidate-global-receipt.json"), "utf-8"))
      .resolves.toBe(`${JSON.stringify(receipt, null, 2)}\n`);
    const qualification = await qualifyCodingAgentBenchmarkCandidate({ aggregateRoot: outputRoot });
    expect(qualification).toMatchObject({
      status: "not_eligible",
      scores: { rawWeighted: null, status: "unscored" },
      blockingReasons: [{
        code: "candidate_run_events_hard_gate_failed",
        failedGates: [
          { id: "incompleteTraceCountMaximum", observed: 144, maximum: 0 },
          { id: "incompleteProviderUsageCountMaximum", observed: 144, maximum: 0 },
        ],
      }],
    });
    await expect(writeCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
    await expect(verifyCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
  });

  it("collects real candidate-global evidence and writes its bound receipt in one zero-model run", async () => {
    const root = await makeTempRoot();
    const outputRoot = path.join(root, "baseline");
    const runs = manifestV3.tasks.flatMap((task) => task.platforms.flatMap((platform) => {
      return [1, 2, 3].map((attempt) => createV3Run(task, platform, attempt));
    }));
    const reportPath = await writeV3SourceReport(path.join(root, "source"), runs);
    await aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [reportPath],
      outputRoot,
      generatedAt: "2026-09-01T00:00:00.000Z",
    });
    const sensitiveRoot = path.join(root, "candidate-sensitive-root");
    const sensitiveValue = "candidate-global-runner-sensitive-value";
    await fs.mkdir(sensitiveRoot, { recursive: true });
    await fs.writeFile(path.join(sensitiveRoot, "safe.txt"), "safe fixture\n", "utf-8");

    const receipt = await runCodingAgentCandidateGlobalReceipt({
      aggregateRoot: outputRoot,
      generatedAt: "2026-09-01T01:00:00.000Z",
      sensitiveRoots: [sensitiveRoot],
      sensitiveValues: [sensitiveValue],
      wslDistribution: "Ubuntu-22.04",
      resourceInventories: {
        "windows-native": emptyCandidateResourceInventory(),
        "wsl2-linux": emptyCandidateResourceInventory(),
      },
    });

    expect(receipt).toMatchObject({
      schemaVersion: "coding-agent-benchmark-candidate-global-receipt/v1",
      aggregate: await readCandidateGlobalReceiptBinding(outputRoot),
      sensitiveScan: {
        regularFileCount: 1,
        unreadableFileCount: 0,
        findingCount: 0,
      },
      resourceSweeps: [
        { platform: "windows-native", orphanResourceCount: 0 },
        { platform: "wsl2-linux", orphanResourceCount: 0 },
      ],
    });
    const serialized = await fs.readFile(
      path.join(outputRoot, "candidate-global-receipt.json"),
      "utf-8",
    );
    expect(serialized).toBe(`${JSON.stringify(receipt, null, 2)}\n`);
    expect(serialized).not.toContain(sensitiveValue);
    expect(serialized).not.toContain(sensitiveRoot);
  });

  it("refuses to write a candidate-global receipt for a partial aggregate or over existing evidence", async () => {
    const root = await makeTempRoot();
    const partialOutputRoot = path.join(root, "partial-baseline");
    const task = manifestV3.tasks.find((item) => item.id === "real-js.bug-fix");
    const partialReportPath = await writeV3SourceReport(
      path.join(root, "partial-source"),
      [createV3Run(task, "windows-native", 1)],
    );
    await aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [partialReportPath],
      outputRoot: partialOutputRoot,
      generatedAt: "2026-09-01T00:00:00.000Z",
    });
    const producerInput = {
      aggregateRoot: partialOutputRoot,
      generatedAt: "2026-09-01T01:00:00.000Z",
      sensitiveScan: createCandidateGlobalReceipt({}).sensitiveScan,
      resourceSweeps: [
        createResourceSweep("windows-native"),
        createResourceSweep("wsl2-linux"),
      ],
    };

    await expect(writeCodingAgentCandidateGlobalReceipt(producerInput))
      .rejects.toThrow(/complete aggregate/i);
    await expect(fs.access(path.join(partialOutputRoot, "candidate-global-receipt.json")))
      .rejects.toMatchObject({ code: "ENOENT" });

    const completeOutputRoot = path.join(root, "complete-baseline");
    const runs = manifestV3.tasks.flatMap((candidateTask) => candidateTask.platforms.flatMap((platform) => {
      return [1, 2, 3].map((attempt) => createV3Run(candidateTask, platform, attempt));
    }));
    const completeReportPath = await writeV3SourceReport(path.join(root, "complete-source"), runs);
    await aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [completeReportPath],
      outputRoot: completeOutputRoot,
      generatedAt: "2026-09-01T00:00:00.000Z",
    });
    const completeInput = { ...producerInput, aggregateRoot: completeOutputRoot };
    const firstReceipt = await writeCodingAgentCandidateGlobalReceipt(completeInput);

    await expect(writeCodingAgentCandidateGlobalReceipt(completeInput)).rejects.toMatchObject({ code: "EEXIST" });
    await expect(fs.readFile(path.join(completeOutputRoot, "candidate-global-receipt.json"), "utf-8"))
      .resolves.toBe(`${JSON.stringify(firstReceipt, null, 2)}\n`);
  });

  it("separates a valid retained trace from incomplete terminal Provider usage", async () => {
    const root = await makeTempRoot();
    const outputRoot = path.join(root, "baseline");
    const runs = manifestV3.tasks.flatMap((task) => task.platforms.flatMap((platform) => {
      return [1, 2, 3].map((attempt) => createV3Run(task, platform, attempt));
    }));
    const reportPath = await writeV3SourceReport(path.join(root, "source"), runs, {}, {
      artifactTextFor({ run, artifactKey }) {
        return artifactKey === "events" ? createRunEventsJsonl(run, "incomplete") : undefined;
      },
    });
    await aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [reportPath],
      outputRoot,
      generatedAt: "2026-09-01T00:00:00.000Z",
    });
    await writeCodingAgentCandidateGlobalReceipt({
      aggregateRoot: outputRoot,
      generatedAt: "2026-09-01T01:00:00.000Z",
      sensitiveScan: createCandidateGlobalReceipt({}).sensitiveScan,
      resourceSweeps: [
        createResourceSweep("windows-native"),
        createResourceSweep("wsl2-linux"),
      ],
    });

    const qualification = await qualifyCodingAgentBenchmarkCandidate({ aggregateRoot: outputRoot });
    expect(qualification).toMatchObject({
      status: "not_eligible",
      scores: { rawWeighted: null, status: "unscored" },
      blockingReasons: [{
        code: "candidate_run_events_hard_gate_failed",
        failedGates: [
          { id: "incompleteProviderUsageCountMaximum", observed: 144, maximum: 0 },
        ],
      }],
    });
    await expect(writeCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
    await expect(verifyCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
  });

  it("fails the C critical Gate when complete run events retain invalid system evidence", async () => {
    const root = await makeTempRoot();
    const outputRoot = path.join(root, "baseline");
    const runs = manifestV3.tasks.flatMap((task) => task.platforms.flatMap((platform) => {
      return [1, 2, 3].map((attempt) => createV3Run(task, platform, attempt));
    }));
    const reportPath = await writeV3SourceReport(path.join(root, "source"), runs, {}, {
      artifactTextFor({ run, artifactKey }) {
        return artifactKey === "events" ? createRunEventsJsonl(run, "complete") : undefined;
      },
    });
    await aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [reportPath],
      outputRoot,
      generatedAt: "2026-09-01T00:00:00.000Z",
    });
    await writeCodingAgentCandidateGlobalReceipt({
      aggregateRoot: outputRoot,
      generatedAt: "2026-09-01T01:00:00.000Z",
      sensitiveScan: createCandidateGlobalReceipt({}).sensitiveScan,
      resourceSweeps: [
        createResourceSweep("windows-native"),
        createResourceSweep("wsl2-linux"),
      ],
    });

    const qualification = await qualifyCodingAgentBenchmarkCandidate({ aggregateRoot: outputRoot });
    expect(qualification).toMatchObject({
      status: "not_eligible",
      scores: { rawWeighted: null, status: "unscored" },
      blockingReasons: [{
        code: "candidate_layer_gate_failed",
        failedGates: [{
          layer: "C",
          id: "criticalGateRateMinimum",
          numerator: 0,
          denominator: 24,
          observed: 0,
          minimum: 1,
        }],
      }],
    });
    await expect(writeCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
    await expect(verifyCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
  });

  it("passes valid C critical evidence before enforcing all required A executions", async () => {
    const root = await makeTempRoot();
    const outputRoot = path.join(root, "baseline");
    const runs = manifestV3.tasks.flatMap((task) => task.platforms.flatMap((platform) => {
      return [1, 2, 3].map((attempt) => createV3Run(task, platform, attempt));
    }));
    const failedRun = runs.find((run) => {
      return manifestV3.tasks.find((task) => task.id === run.taskId)?.layer === "A";
    });
    failedRun.status = "failed";
    failedRun.failureCategory = "product_workflow";
    failedRun.evaluation.taskCompleted = false;
    failedRun.evaluation.testsPassed = false;
    failedRun.evaluation.regressionCount = 1;
    const reportPath = await writeV3SourceReport(path.join(root, "source"), runs, {}, {
      artifactTextFor({ run, artifactKey }) {
        if (artifactKey === "events") return createRunEventsJsonl(run, "complete");
        if (artifactKey === "systemEvidence") {
          return `${JSON.stringify(createSystemEvidence(run.taskId, run.runId, run.platform), null, 2)}\n`;
        }
        return undefined;
      },
    });
    await aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [reportPath],
      outputRoot,
      generatedAt: "2026-09-01T00:00:00.000Z",
    });
    await writeCodingAgentCandidateGlobalReceipt({
      aggregateRoot: outputRoot,
      generatedAt: "2026-09-01T01:00:00.000Z",
      sensitiveScan: createCandidateGlobalReceipt({}).sensitiveScan,
      resourceSweeps: [
        createResourceSweep("windows-native"),
        createResourceSweep("wsl2-linux"),
      ],
    });

    const qualification = await qualifyCodingAgentBenchmarkCandidate({ aggregateRoot: outputRoot });
    expect(qualification).toMatchObject({
      status: "not_eligible",
      scores: { rawWeighted: null, status: "unscored" },
      blockingReasons: [{
        code: "candidate_layer_gate_failed",
        failedGates: [{
          layer: "A",
          id: "requiredPassedExecutions",
          numerator: 71,
          denominator: 72,
          observed: 71,
          minimum: 72,
        }],
      }],
    });
    await expect(writeCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
    await expect(verifyCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
  });

  it("enforces the B success rate over exactly the 48 layer-B executions", async () => {
    const { outputRoot } = await createCompleteQualificationBaseline((runs) => {
      const failedEcosystems = new Set();
      for (const run of runs) {
        const task = manifestV3.tasks.find((candidate) => candidate.id === run.taskId);
        if (task?.layer !== "B") continue;
        const ecosystem = manifestV3.repositories.find((repository) => {
          return repository.id === task.repositoryId;
        })?.languageEcosystem;
        if (failedEcosystems.has(ecosystem)) continue;
        failedEcosystems.add(ecosystem);
        run.status = "failed";
        run.failureCategory = "product_workflow";
      }
    });

    const qualification = await qualifyCodingAgentBenchmarkCandidate({ aggregateRoot: outputRoot });
    expect(qualification).toMatchObject({
      status: "not_eligible",
      scores: { rawWeighted: null, status: "unscored" },
      blockingReasons: [{
        code: "candidate_layer_gate_failed",
        failedGates: [{
          layer: "B",
          id: "successRateMinimum",
          numerator: 44,
          denominator: 48,
          observed: 44 / 48,
          minimum: 0.92,
        }],
      }],
    });
    await expect(writeCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
    await expect(verifyCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
  });

  it("enforces the B success rate independently for every required language ecosystem", async () => {
    const { outputRoot } = await createCompleteQualificationBaseline((runs) => {
      let failedRunCount = 0;
      for (const run of runs) {
        const task = manifestV3.tasks.find((candidate) => candidate.id === run.taskId);
        const repository = manifestV3.repositories.find((candidate) => candidate.id === task?.repositoryId);
        if (repository?.languageEcosystem !== "typescript" || failedRunCount === 2) continue;
        run.status = "failed";
        run.failureCategory = "product_workflow";
        failedRunCount += 1;
      }
    });

    const qualification = await qualifyCodingAgentBenchmarkCandidate({ aggregateRoot: outputRoot });
    expect(qualification).toMatchObject({
      status: "not_eligible",
      scores: { rawWeighted: null, status: "unscored" },
      blockingReasons: [{
        code: "candidate_layer_gate_failed",
        failedGates: [{
          layer: "B",
          id: "requiredLanguageSuccessRateMinimum",
          ecosystem: "typescript",
          numerator: 10,
          denominator: 12,
          observed: 10 / 12,
          minimum: 0.9,
        }],
      }],
    });
    await expect(writeCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
    await expect(verifyCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
  });

  it("enforces the B test pass rate over only applicable layer-B evaluations", async () => {
    const { outputRoot } = await createCompleteQualificationBaseline((runs) => {
      let failedTestCount = 0;
      for (const run of runs) {
        const task = manifestV3.tasks.find((candidate) => candidate.id === run.taskId);
        if (task?.layer !== "B" || failedTestCount === 3) continue;
        run.evaluation.testsPassed = false;
        failedTestCount += 1;
      }
    });

    const qualification = await qualifyCodingAgentBenchmarkCandidate({ aggregateRoot: outputRoot });
    expect(qualification).toMatchObject({
      status: "not_eligible",
      scores: { rawWeighted: null, status: "unscored" },
      blockingReasons: [{
        code: "candidate_layer_gate_failed",
        failedGates: [{
          layer: "B",
          id: "testPassRateMinimum",
          numerator: 45,
          denominator: 48,
          observed: 0.9375,
          minimum: 0.95,
        }],
      }],
    });
    await expect(writeCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
    await expect(verifyCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
  });

  it("enforces the B patch acceptance rate over only applicable mutation evaluations", async () => {
    const { outputRoot } = await createCompleteQualificationBaseline((runs) => {
      let rejectedPatchCount = 0;
      for (const run of runs) {
        if (run.evaluation.patchAccepted === null || rejectedPatchCount === 2) continue;
        run.evaluation.patchAccepted = false;
        rejectedPatchCount += 1;
      }
    });

    const qualification = await qualifyCodingAgentBenchmarkCandidate({ aggregateRoot: outputRoot });
    expect(qualification).toMatchObject({
      status: "not_eligible",
      scores: { rawWeighted: null, status: "unscored" },
      blockingReasons: [{
        code: "candidate_layer_gate_failed",
        failedGates: [{
          layer: "B",
          id: "patchAcceptanceRateMinimum",
          numerator: 34,
          denominator: 36,
          observed: 34 / 36,
          minimum: 0.95,
        }],
      }],
    });
    await expect(writeCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
    await expect(verifyCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
  });

  it("rejects any retained layer-B regression even when all B rates pass", async () => {
    const { outputRoot } = await createCompleteQualificationBaseline((runs) => {
      const run = runs.find((candidate) => {
        return manifestV3.tasks.find((task) => task.id === candidate.taskId)?.layer === "B";
      });
      run.evaluation.regressionCount = 1;
    });

    const qualification = await qualifyCodingAgentBenchmarkCandidate({ aggregateRoot: outputRoot });
    expect(qualification).toMatchObject({
      status: "not_eligible",
      scores: { rawWeighted: null, status: "unscored" },
      blockingReasons: [{
        code: "candidate_layer_gate_failed",
        failedGates: [{
          layer: "B",
          id: "regressionCountMaximum",
          observed: 1,
          maximum: 0,
        }],
      }],
    });
    await expect(writeCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
    await expect(verifyCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
  });

  it("enforces C task success independently from valid critical system evidence", async () => {
    const { outputRoot } = await createCompleteQualificationBaseline((runs) => {
      let failedRunCount = 0;
      for (const run of runs) {
        const task = manifestV3.tasks.find((candidate) => candidate.id === run.taskId);
        if (task?.layer !== "C" || failedRunCount === 3) continue;
        run.status = "failed";
        run.failureCategory = "product_workflow";
        run.evaluation.taskCompleted = false;
        failedRunCount += 1;
      }
    });

    const qualification = await qualifyCodingAgentBenchmarkCandidate({ aggregateRoot: outputRoot });
    expect(qualification).toMatchObject({
      status: "not_eligible",
      scores: { rawWeighted: null, status: "unscored" },
      blockingReasons: [{
        code: "candidate_layer_gate_failed",
        failedGates: [{
          layer: "C",
          id: "otherSystemSuccessRateMinimum",
          numerator: 21,
          denominator: 24,
          observed: 0.875,
          minimum: 0.9,
        }],
      }],
    });
    await expect(writeCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
    await expect(verifyCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
  });

  it("rejects a selected infrastructure error before any layer Gate", async () => {
    const { outputRoot } = await createCompleteQualificationBaseline((runs) => {
      const run = runs.find((candidate) => {
        return manifestV3.tasks.find((task) => task.id === candidate.taskId)?.layer === "A";
      });
      run.status = "infrastructure_error";
      run.failureCategory = "infrastructure";
      run.evaluation.taskCompleted = false;
    });

    const qualification = await qualifyCodingAgentBenchmarkCandidate({ aggregateRoot: outputRoot });
    expect(qualification).toMatchObject({
      status: "not_eligible",
      scores: { rawWeighted: null, status: "unscored" },
      blockingReasons: [{
        code: "candidate_aggregate_hard_gate_failed",
        failedGates: [{
          id: "selectedInfrastructureErrorCountMaximum",
          observed: 1,
          maximum: 0,
        }],
      }],
    });
    await expect(writeCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
    await expect(verifyCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
  });

  it("does not interpret a legacy aggregate without expected-report evidence as zero missing reports", async () => {
    const { outputRoot } = await createCompleteQualificationBaseline();

    const qualification = await qualifyCodingAgentBenchmarkCandidate({ aggregateRoot: outputRoot });
    expect(qualification).toMatchObject({
      status: "not_eligible",
      scores: { rawWeighted: null, status: "unscored" },
      blockingReasons: [{
        code: "qualification_contract_incomplete",
        missingContracts: [
          "aggregate_missing_report_metric",
        ],
      }],
    });
    await expect(writeCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
    await expect(verifyCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
  });

  it("consumes an authoritative complete expected-report plan before leaving dimension evidence unscored", async () => {
    const root = await makeTempRoot();
    const runs = manifestV3.tasks.flatMap((task) => task.platforms.flatMap((platform) => {
      return [1, 2, 3].map((attempt) => createV3Run(task, platform, attempt));
    }));
    const reportPath = await writeV3SourceReport(path.join(root, "source"), runs, {}, {
      artifactTextFor({ run, artifactKey }) {
        if (artifactKey === "events") return createRunEventsJsonl(run, "complete");
        if (artifactKey === "systemEvidence") {
          return `${JSON.stringify(createSystemEvidence(run.taskId, run.runId, run.platform), null, 2)}\n`;
        }
        return undefined;
      },
    });
    const outputRoot = path.join(root, "baseline");
    const expectedReportPlan = createCodingAgentBenchmarkExpectedReportPlan({
      manifestSha256: manifestV3Sha256,
      reports: [{ reportId: "candidate-native-matrix", path: reportPath }],
    });
    await aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [reportPath],
      expectedReportPlan,
      outputRoot,
      generatedAt: "2026-09-01T00:00:00.000Z",
    });
    await writeCodingAgentCandidateGlobalReceipt({
      aggregateRoot: outputRoot,
      generatedAt: "2026-09-01T01:00:00.000Z",
      sensitiveScan: createCandidateGlobalReceipt({}).sensitiveScan,
      resourceSweeps: [
        createResourceSweep("windows-native"),
        createResourceSweep("wsl2-linux"),
      ],
    });

    const qualification = await qualifyCodingAgentBenchmarkCandidate({ aggregateRoot: outputRoot });
    expect(qualification).toMatchObject({
      status: "not_eligible",
      scores: { rawWeighted: null, status: "unscored" },
      blockingReasons: [{
        code: "candidate_dimension_evidence_incomplete",
      }],
    });
    await expect(writeCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
    await expect(verifyCodingAgentCandidateQualificationReport({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({ decision: qualification });
  });

  it("rejects Provider usage on a task declared as a local lifecycle fixture", async () => {
    const root = await makeTempRoot();
    const runs = manifestV3.tasks.flatMap((task) => task.platforms.flatMap((platform) => {
      return [1, 2, 3].map((attempt) => createV3Run(task, platform, attempt));
    }));
    const reportPath = await writeV3SourceReport(path.join(root, "source"), runs, {}, {
      artifactTextFor({ run, artifactKey }) {
        if (artifactKey === "events") {
          const eventRun = run.taskId === "gateway.client-cancel"
            ? { ...run, execution: { ...run.execution, modelExecution: "provider" } }
            : run;
          return createRunEventsJsonl(eventRun, "complete");
        }
        if (artifactKey === "systemEvidence") {
          return `${JSON.stringify(createSystemEvidence(run.taskId, run.runId, run.platform), null, 2)}\n`;
        }
        return undefined;
      },
    });
    const outputRoot = path.join(root, "baseline");
    const expectedReportPlan = createCodingAgentBenchmarkExpectedReportPlan({
      manifestSha256: manifestV3Sha256,
      reports: [{ reportId: "candidate-native-matrix", path: reportPath }],
    });
    await aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [reportPath],
      expectedReportPlan,
      outputRoot,
      generatedAt: "2026-09-03T00:00:00.000Z",
    });
    await writeCodingAgentCandidateGlobalReceipt({
      aggregateRoot: outputRoot,
      generatedAt: "2026-09-03T01:00:00.000Z",
      sensitiveScan: createCandidateGlobalReceipt({}).sensitiveScan,
      resourceSweeps: [
        createResourceSweep("windows-native"),
        createResourceSweep("wsl2-linux"),
      ],
    });

    await expect(qualifyCodingAgentBenchmarkCandidate({ aggregateRoot: outputRoot }))
      .resolves.toMatchObject({
        status: "not_eligible",
        blockingReasons: [{
          code: "candidate_run_events_hard_gate_failed",
          failedGates: [{
            id: "incompleteProviderUsageCountMaximum",
            observed: 6,
            maximum: 0,
          }],
        }],
      });
  });
});

describe("coding agent expected source-report plan", () => {
  it("counts a missing expected report independently from complete run coverage", async () => {
    const root = await makeTempRoot();
    const outputRoot = path.join(root, "baseline");
    const runs = manifestV3.tasks.flatMap((task) => task.platforms.flatMap((platform) => {
      return [1, 2, 3].map((attempt) => createV3Run(task, platform, attempt));
    }));
    const reportPath = await writeV3SourceReport(path.join(root, "source"), runs);
    const missingReportPath = path.join(root, "expected-but-missing", "benchmark-report.json");
    const expectedReportPlan = createCodingAgentBenchmarkExpectedReportPlan({
      manifestSha256: manifestV3Sha256,
      reports: [
        { reportId: "candidate-native-matrix", path: reportPath },
        { reportId: "candidate-required-gates", path: missingReportPath },
      ],
    });

    const result = await aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [reportPath],
      expectedReportPlan,
      outputRoot,
      generatedAt: "2026-09-01T00:00:00.000Z",
    });

    expect(result.baselineIndex.coverage.missingRunKeys).toEqual([]);
    expect(result.baselineIndex.expectedReports).toEqual({
      schemaVersion: "coding-agent-benchmark-expected-report-projection/v1",
      expectedReportCount: 2,
      collectedReportCount: 1,
      missingReportCount: 1,
      reports: [
        { reportId: "candidate-native-matrix", state: "collected" },
        { reportId: "candidate-required-gates", state: "missing" },
      ],
      plan: {
        path: "expected-reports.json",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });

    const expectedReportsText = await fs.readFile(
      path.join(outputRoot, "expected-reports.json"),
      "utf-8",
    );
    expect(JSON.parse(expectedReportsText)).toEqual({
      schemaVersion: "coding-agent-benchmark-expected-reports/v1",
      manifestSha256: manifestV3Sha256,
      reports: [
        { reportId: "candidate-native-matrix" },
        { reportId: "candidate-required-gates" },
      ],
    });
    expect(expectedReportsText).not.toContain(path.resolve(root));
    await expect(verifyCodingAgentBaselineArtifact({ outputRoot })).resolves.toMatchObject({
      baselineIndex: {
        coverage: { missingRunKeys: [] },
        expectedReports: { missingReportCount: 1 },
      },
    });

    const indexPath = path.join(outputRoot, "baseline-index.json");
    const index = JSON.parse(await fs.readFile(indexPath, "utf-8"));
    index.expectedReports = {
      ...index.expectedReports,
      collectedReportCount: 2,
      missingReportCount: 0,
      reports: index.expectedReports.reports.map((report) => ({
        ...report,
        state: "collected",
      })),
    };
    await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf-8");
    await expect(verifyCodingAgentBaselineArtifact({ outputRoot })).rejects.toThrow(
      /expected report.*reconstruct|baseline index cannot be reconstructed/i,
    );
  });
});

describe("coding agent candidate expected source-report plan", () => {
  it("retains candidate identity and the exact logical run matrix for offline verification", async () => {
    const root = await makeTempRoot();
    const source = versionedIdentity("c");
    const harness = versionedIdentity("b");
    const reportRoot = path.join(root, "reports");
    const task = manifestV3.tasks.find((item) => item.id === "gateway.client-cancel");
    const reportPath = resolveCodingAgentBenchmarkCandidateReportPath({
      reportRoot,
      taskId: task.id,
      platform: "windows-native",
      attempt: 1,
    });
    await writeV3SourceReport(
      path.dirname(reportPath),
      [createV3Run(task, "windows-native", 1)],
      { source, harness },
    );
    const expectedReportPlan = createCodingAgentBenchmarkCandidateExpectedReportPlan({
      candidateId: "candidate-20260903-a",
      manifest: manifestV3,
      manifestSha256: manifestV3Sha256,
      reportRoot,
      source,
      harness,
    });
    const outputRoot = path.join(root, "baseline");

    const result = await aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [reportPath],
      expectedReportPlan,
      outputRoot,
      generatedAt: "2026-09-03T00:00:00.000Z",
    });

    expect(result.baselineIndex.expectedReports).toMatchObject({
      expectedReportCount: 144,
      collectedReportCount: 1,
      missingReportCount: 143,
    });
    const retained = JSON.parse(await fs.readFile(
      path.join(outputRoot, "expected-reports.json"),
      "utf-8",
    ));
    expect(retained).toMatchObject({
      candidate: { id: "candidate-20260903-a", source, harness },
      reports: expect.arrayContaining([{
        reportId: "gateway.client-cancel.windows-native.a1",
        taskId: "gateway.client-cancel",
        platform: "windows-native",
        attempt: 1,
      }]),
    });
    expect(retained.reports).toHaveLength(144);
    await expect(verifyCodingAgentBaselineArtifact({ outputRoot })).resolves.toMatchObject({
      baselineIndex: { expectedReports: { missingReportCount: 143 } },
    });
  });

  it("rejects candidate source identity drift before writing an aggregate", async () => {
    const root = await makeTempRoot();
    const source = versionedIdentity("c");
    const harness = versionedIdentity("b");
    const reportRoot = path.join(root, "reports");
    const task = manifestV3.tasks[0];
    const reportPath = resolveCodingAgentBenchmarkCandidateReportPath({
      reportRoot,
      taskId: task.id,
      platform: "windows-native",
      attempt: 1,
    });
    await writeV3SourceReport(
      path.dirname(reportPath),
      [createV3Run(task, "windows-native", 1)],
      { source: versionedIdentity("d"), harness },
    );
    const expectedReportPlan = createCodingAgentBenchmarkCandidateExpectedReportPlan({
      candidateId: "candidate-20260903-a",
      manifest: manifestV3,
      manifestSha256: manifestV3Sha256,
      reportRoot,
      source,
      harness,
    });

    await expect(aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [reportPath],
      expectedReportPlan,
      outputRoot: path.join(root, "baseline"),
    })).rejects.toThrow(/source identity drifted/i);
    await expect(fs.stat(path.join(root, "baseline"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a report whose logical run does not match its planned slot", async () => {
    const root = await makeTempRoot();
    const source = versionedIdentity("c");
    const harness = versionedIdentity("b");
    const reportRoot = path.join(root, "reports");
    const plannedTask = manifestV3.tasks[0];
    const actualTask = manifestV3.tasks[1];
    const reportPath = resolveCodingAgentBenchmarkCandidateReportPath({
      reportRoot,
      taskId: plannedTask.id,
      platform: "windows-native",
      attempt: 1,
    });
    await writeV3SourceReport(
      path.dirname(reportPath),
      [createV3Run(actualTask, "windows-native", 1)],
      { source, harness },
    );
    const expectedReportPlan = createCodingAgentBenchmarkCandidateExpectedReportPlan({
      candidateId: "candidate-20260903-a",
      manifest: manifestV3,
      manifestSha256: manifestV3Sha256,
      reportRoot,
      source,
      harness,
    });

    await expect(aggregateCodingAgentBenchmarkReports({
      manifestRevision: "v3",
      reportPaths: [reportPath],
      expectedReportPlan,
      outputRoot: path.join(root, "baseline"),
    })).rejects.toThrow(/logical run.*planned slot/i);
  });
});

describe("coding agent baseline aggregation CLI", () => {
  it("loads a versioned expected-report plan and exposes it through the production CLI", async () => {
    const root = await makeTempRoot();
    const planPath = path.join(root, "expected-report-plan.json");
    await fs.writeFile(planPath, `${JSON.stringify({
      schemaVersion: "coding-agent-benchmark-expected-report-plan/v1",
      manifestSha256: manifestV3Sha256,
      reports: [
        { reportId: "candidate-windows", path: "reports/windows/benchmark-report.json" },
        { reportId: "candidate-wsl2", path: "reports/wsl2/benchmark-report.json" },
      ],
    }, null, 2)}\n`, "utf-8");

    await expect(loadCodingAgentBenchmarkExpectedReportPlanFile(planPath)).resolves.toEqual({
      schemaVersion: "coding-agent-benchmark-expected-report-plan/v1",
      manifestSha256: manifestV3Sha256,
      reports: [
        {
          reportId: "candidate-windows",
          path: path.join(root, "reports/windows/benchmark-report.json"),
        },
        {
          reportId: "candidate-wsl2",
          path: path.join(root, "reports/wsl2/benchmark-report.json"),
        },
      ],
    });
    expect(parseCodingAgentBenchmarkAggregationCliArguments([
      "--manifest-revision", "v3",
      "--report", "reports/windows/benchmark-report.json",
      "--expected-report-plan", planPath,
      "--dry-run",
    ])).toMatchObject({
      expectedReportPlanPath: planPath,
    });
  });

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
    expect(() => parseCodingAgentBenchmarkAggregationCliArguments([
      "--expected-report-plan", "first.json",
      "--expected-report-plan", "second.json",
    ])).toThrow(/expected-report-plan.*once/i);
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

async function writeV3SourceReport(root, runs, identities = {}, options = {}) {
  await fs.mkdir(root, { recursive: true });
  for (const run of runs) {
    for (const [artifactKey, artifactPath] of Object.entries(run.artifacts)) {
      const target = path.join(root, artifactPath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      const explicitText = options.artifactTextFor?.({ run, artifactKey, artifactPath });
      await fs.writeFile(
        target,
        explicitText ?? createDefaultV3ArtifactText(run, artifactKey) ?? (path.basename(artifactPath) === "browser-screenshot.png"
          ? V3_BROWSER_SCREENSHOT
          : "fixture artifact\n"),
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
      modelExecution: task.modelExecution,
      budgets: resolveCodingAgentBenchmarkTaskBudgets(manifestV3, task.id),
      infrastructureRetries: 0,
    },
    environment: {
      osRelease: platform === "windows-native" ? "Windows fixture" : "Linux fixture",
      arch: "x64",
      nodeVersion: "v22.23.1",
      packageManager: "pnpm@10.23.0",
      wsl: platform === "wsl2-linux" ? { distribution: "Ubuntu-22.04", version: 2 } : null,
      model: task.modelExecution === "local_fixture"
        ? { provider: "local_fixture", id: task.fixture.generatorId, credentialsConfigured: false }
        : { provider: "fixture", id: "v3-baseline-fixture", credentialsConfigured: false },
    },
    evaluation: {
      source: "machine",
      taskCompleted: true,
      testsPassed: task.layer === "C" ? null : true,
      patchAccepted: task.layer === "B" && task.acceptance.requiredChangedPaths.length > 0 ? true : null,
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

function runCandidateQualificationCli(args) {
  return spawnSync(process.execPath, [
    "--import",
    "tsx",
    path.join(workspaceRoot, "scripts/run-coding-agent-candidate-qualification.mjs"),
    ...args,
  ], {
    cwd: workspaceRoot,
    encoding: "utf-8",
    windowsHide: true,
  });
}

function versionedIdentity(seed) {
  return {
    commit: seed.repeat(40),
    workspaceDirty: false,
    lockfileSha256: seed.repeat(64),
    worktreeContentSha256: seed.repeat(64),
  };
}

function createCandidateGlobalReceipt(binding) {
  return {
    schemaVersion: "coding-agent-benchmark-candidate-global-receipt/v1",
    generatedAt: "2026-09-01T00:00:00.000Z",
    aggregate: binding,
    sensitiveScan: {
      status: "completed",
      scope: "candidate_declared_roots",
      linkPolicy: "count_do_not_follow",
      contentPolicy: "exact_values_non_echoing",
      rootCount: 4,
      regularFileCount: 12815,
      unreadableFileCount: 0,
      symlinkOrReparsePointCount: 38,
      findingCount: 0,
    },
    resourceSweeps: [
      createResourceSweep("windows-native"),
      createResourceSweep("wsl2-linux"),
    ],
  };
}

function createResourceSweep(platform) {
  return {
    platform,
    status: "completed",
    scope: "candidate_owned_resources",
    remainingListenerCount: 0,
    remainingOwnedProcessCount: 0,
    remainingRuntimeMarkerCount: 0,
    remainingRuntimeEnvFileCount: 0,
    orphanResourceCount: 0,
  };
}

function emptyCandidateResourceInventory() {
  return {
    listeners: [],
    processIds: [],
    runtimeMarkers: [],
    runtimeEnvFiles: [],
  };
}

function createRunEventsJsonl(run, usageStatus, agentRunId = run.runId) {
  const binding = { agentRunId, conversationId: `conversation-${run.runId}` };
  const capabilities = {
    schemaVersion: "coding-run-capabilities/v1",
    protocolVersion: "v1",
    eventStream: {
      sequence: "continuous",
      terminal: "exactly_one",
      usageCompleteness: "terminal",
    },
    observability: {
      trace: {
        schemaVersion: "coding-run-trace/v1",
        contentMode: "none",
        bodyFields: [],
      },
    },
  };
  const localFixture = run.execution?.modelExecution === "local_fixture" && usageStatus === "complete";
  const usage = !localFixture && usageStatus === "complete"
    ? {
        status: "complete",
        reason: "provider_reported_all_model_calls",
        modelCalls: 1,
        providerReportedModelCalls: 1,
      }
    : { status: "incomplete", reason: "usage_not_reported" };
  const terminal = localFixture && run.taskId === "gateway.client-cancel"
    ? {
        version: "v1",
        seq: 2,
        timestampMs: 2,
        source: "conversation",
        binding,
        type: "run.cancelled",
        payload: { reason: "fixture cancellation", hadPartialResponse: false, usage },
      }
    : localFixture && run.taskId === "gateway.process-restart"
      ? {
          version: "v1",
          seq: 2,
          timestampMs: 2,
          source: "conversation",
          binding,
          type: "run.failed",
          payload: { error: { code: "gateway_unavailable", message: "fixture restart" }, usage },
        }
      : {
          version: "v1",
          seq: 2,
          timestampMs: 2,
          source: "conversation",
          binding,
          type: "run.completed",
          payload: { usage },
        };
  const events = [
    {
      version: "v1",
      seq: 1,
      timestampMs: 1,
      source: "conversation",
      binding,
      type: "run.started",
      payload: { status: "running", capabilities },
    },
    terminal,
  ];
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function createDefaultV3ArtifactText(run, artifactKey) {
  if (artifactKey === "preflight" && run.execution?.modelExecution === "local_fixture") {
    return `${JSON.stringify({
      status: "passed",
      checks: { pricing: { status: "not_applicable", reason: "fixture_provider" } },
    }, null, 2)}\n`;
  }
  if (artifactKey === "cancelInjection" && run.taskId === "gateway.client-cancel") {
    return `${JSON.stringify({
      schemaVersion: "coding-agent-cancel-injection/v1",
      status: "confirmed",
      cancellationRequestCount: 1,
      terminalType: "run.cancelled",
    }, null, 2)}\n`;
  }
  if (artifactKey === "restartInjection" && run.taskId === "gateway.process-restart") {
    return `${JSON.stringify({
      schemaVersion: "coding-agent-restart-injection/v1",
      status: "confirmed",
      messageSendRequestCount: 1,
      cleanup: { managedGatewayProcessCount: 0 },
    }, null, 2)}\n`;
  }
  return undefined;
}

function createSystemEvidence(taskId, runId, platform) {
  const common = {
    schemaVersion: "coding-agent-benchmark-system-evidence/v1",
    taskId,
    generatorId: {
      "system.browser-behavior": "browser-behavior-v1",
      "system.parallel-read-isolation": "parallel-read-isolation-v1",
      "system.parallel-write-fan-in": "parallel-write-fan-in-v1",
      "system.restart-delivery-reconciliation": "restart-delivery-reconciliation-v1",
    }[taskId],
    fixtureVersion: 1,
    runId,
    platform,
    status: "passed",
    sensitiveFindingCount: 0,
    orphanResourceCount: 0,
    duplicateSideEffectCount: 0,
  };
  if (taskId === "system.browser-behavior") {
    const screenshotSha256 = "1".repeat(64);
    const domAfterSha256 = "2".repeat(64);
    return {
      ...common,
      observations: {
        pageLoaded: true,
        consoleErrorCount: 0,
        domChanged: true,
        domAfterSha256,
        requestStatus: 200,
        networkScope: "loopback-only",
        screenshotSha256,
        screenshotBindingSha256: crypto.createHash("sha256").update([
          "coding-agent-benchmark-browser-binding/v1",
          runId,
          screenshotSha256,
          domAfterSha256,
        ].join("\0")).digest("hex"),
      },
    };
  }
  if (taskId === "system.parallel-read-isolation") {
    const snapshotSha256 = "3".repeat(64);
    const budgetId = "budget-read-v1";
    const bindingId = "binding-read-v1";
    return {
      ...common,
      observations: {
        children: ["read-a", "read-b", "read-c"].map((childId, index) => ({
          childId,
          snapshotSha256,
          budgetId,
          bindingId,
          terminalStatus: "completed",
          mutationCount: 0,
          terminalEvidenceSha256: String(index + 4).repeat(64),
        })),
      },
    };
  }
  if (taskId === "system.parallel-write-fan-in") {
    return {
      ...common,
      observations: {
        mainWorkspaceChangedBeforeFanIn: false,
        lanes: ["lane-a", "lane-b"].map((laneId, index) => ({
          laneId,
          worktreeId: `worktree-${index + 1}`,
          baselineSha256: "7".repeat(64),
          terminalStatus: "completed",
          mutationCount: 1,
        })),
        conflict: {
          detected: true,
          path: "workspace/shared.txt",
          evidenceSha256: "8".repeat(64),
        },
        fanIn: {
          mode: "preview-confirm",
          previewSha256: "9".repeat(64),
          confirmed: true,
          status: "completed",
          resultSha256: "a".repeat(64),
        },
      },
    };
  }
  return {
    ...common,
    observations: {
      restartInjected: true,
      oldBindingId: "binding-before-restart",
      newBindingId: "binding-after-restart",
      reattached: true,
      journalState: "applied",
      completedSideEffectCount: 1,
      replayedSideEffectCount: 0,
      localDeliveryStatus: "completed",
      remoteWriteCount: 0,
      terminalStatus: "completed",
      reconciliationSha256: "b".repeat(64),
    },
  };
}

async function createCompleteQualificationBaseline(mutateRuns) {
  const root = await makeTempRoot();
  const outputRoot = path.join(root, "baseline");
  const runs = manifestV3.tasks.flatMap((task) => task.platforms.flatMap((platform) => {
    return [1, 2, 3].map((attempt) => createV3Run(task, platform, attempt));
  }));
  mutateRuns?.(runs);
  const reportPath = await writeV3SourceReport(path.join(root, "source"), runs, {}, {
    artifactTextFor({ run, artifactKey }) {
      if (artifactKey === "events") return createRunEventsJsonl(run, "complete");
      if (artifactKey === "systemEvidence") {
        return `${JSON.stringify(createSystemEvidence(run.taskId, run.runId, run.platform), null, 2)}\n`;
      }
      return undefined;
    },
  });
  await aggregateCodingAgentBenchmarkReports({
    manifestRevision: "v3",
    reportPaths: [reportPath],
    outputRoot,
    generatedAt: "2026-09-01T00:00:00.000Z",
  });
  await writeCodingAgentCandidateGlobalReceipt({
    aggregateRoot: outputRoot,
    generatedAt: "2026-09-01T01:00:00.000Z",
    sensitiveScan: createCandidateGlobalReceipt({}).sensitiveScan,
    resourceSweeps: [
      createResourceSweep("windows-native"),
      createResourceSweep("wsl2-linux"),
    ],
  });
  return { outputRoot, runs };
}

async function readCandidateGlobalReceiptBinding(outputRoot) {
  const [reportText, indexText] = await Promise.all([
    fs.readFile(path.join(outputRoot, "benchmark-report.json"), "utf-8"),
    fs.readFile(path.join(outputRoot, "baseline-index.json"), "utf-8"),
  ]);
  const report = JSON.parse(reportText);
  const baselineIndex = JSON.parse(indexText);
  return {
    manifestSha256: baselineIndex.manifestSha256,
    reportSha256: baselineIndex.report.sha256,
    indexSha256: crypto.createHash("sha256").update(indexText).digest("hex"),
    source: report.source,
    harness: report.harness,
  };
}
