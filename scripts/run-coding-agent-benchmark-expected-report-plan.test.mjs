import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createCodingAgentBenchmarkCandidateExpectedReportPlan,
  parseCodingAgentBenchmarkExpectedReportPlanCliArguments,
  prepareCodingAgentBenchmarkCandidateExpectedReportPlan,
  resolveCodingAgentBenchmarkCandidateReportId,
  resolveCodingAgentBenchmarkCandidateReportPath,
  validateCodingAgentBenchmarkCandidateExpectedReportLaunch,
  validateCodingAgentBenchmarkCandidateExpectedReportRun,
  writeCodingAgentBenchmarkExpectedReportPlanFile,
} from "./run-coding-agent-benchmark-expected-report-plan.mjs";
import {
  hashCodingAgentBenchmarkManifestText,
  loadCodingAgentBenchmarkManifest,
  resolveCodingAgentBenchmarkManifestPath,
} from "./coding-agent-benchmark-contract.mjs";

const tempRoots = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("coding agent candidate expected-report plan", () => {
  it("pre-freezes the exact 24 by 2 by 3 candidate report matrix", async () => {
    const manifestPath = resolveCodingAgentBenchmarkManifestPath("v3");
    const [manifestText, manifest] = await Promise.all([
      fs.readFile(manifestPath, "utf-8"),
      loadCodingAgentBenchmarkManifest(manifestPath),
    ]);
    const reportRoot = path.resolve("candidate-formal-reports");
    const source = repositoryIdentity("a");
    const harness = repositoryIdentity("b");
    const plan = createCodingAgentBenchmarkCandidateExpectedReportPlan({
      candidateId: "candidate-20260903-a",
      manifest,
      manifestSha256: hashCodingAgentBenchmarkManifestText(manifestText),
      reportRoot,
      source,
      harness,
    });

    expect(plan).toMatchObject({
      schemaVersion: "coding-agent-benchmark-expected-report-plan/v1",
      candidate: { id: "candidate-20260903-a", source, harness },
    });
    expect(plan.reports).toHaveLength(144);
    expect(new Set(plan.reports.map((report) => report.reportId)).size).toBe(144);
    expect(new Set(plan.reports.map((report) => report.path)).size).toBe(144);
    for (const task of manifest.tasks) {
      for (const platform of manifest.suite.requiredPlatforms) {
        for (let attempt = 1; attempt <= manifest.suite.sampleRuns; attempt += 1) {
          expect(plan.reports).toContainEqual({
            reportId: resolveCodingAgentBenchmarkCandidateReportId({
              taskId: task.id,
              platform,
              attempt,
            }),
            taskId: task.id,
            platform,
            attempt,
            path: resolveCodingAgentBenchmarkCandidateReportPath({
              reportRoot,
              taskId: task.id,
              platform,
              attempt,
            }),
          });
        }
      }
    }
  });

  it("refuses overwrite, manifest drift, identity drift, and report path drift", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-agent-expected-report-plan-"));
    tempRoots.push(root);
    const manifestPath = resolveCodingAgentBenchmarkManifestPath("v3");
    const [manifestText, manifest] = await Promise.all([
      fs.readFile(manifestPath, "utf-8"),
      loadCodingAgentBenchmarkManifest(manifestPath),
    ]);
    const source = repositoryIdentity("c");
    const harness = repositoryIdentity("d");
    const reportRoot = path.join(root, "reports");
    const plan = createCodingAgentBenchmarkCandidateExpectedReportPlan({
      candidateId: "candidate-a",
      manifest,
      manifestSha256: hashCodingAgentBenchmarkManifestText(manifestText),
      reportRoot,
      source,
      harness,
    });
    const outputPath = path.join(root, "expected-report-plan.json");

    await expect(writeCodingAgentBenchmarkExpectedReportPlanFile({ plan, outputPath }))
      .resolves.toBe(outputPath);
    await expect(writeCodingAgentBenchmarkExpectedReportPlanFile({ plan, outputPath }))
      .rejects.toMatchObject({ code: "EEXIST" });
    await expect(fs.readFile(outputPath, "utf-8"))
      .resolves.toBe(`${JSON.stringify(plan, null, 2)}\n`);

    const runInput = {
      plan,
      candidateId: "candidate-a",
      manifest,
      manifestSha256: plan.manifestSha256,
      source,
      harness,
      taskId: "gateway.client-cancel",
      platform: "windows-native",
      attempt: 1,
      reportPath: resolveCodingAgentBenchmarkCandidateReportPath({
        reportRoot,
        taskId: "gateway.client-cancel",
        platform: "windows-native",
        attempt: 1,
      }),
    };
    expect(validateCodingAgentBenchmarkCandidateExpectedReportRun(runInput)).toMatchObject({
      taskId: "gateway.client-cancel",
      platform: "windows-native",
      attempt: 1,
    });
    expect(() => validateCodingAgentBenchmarkCandidateExpectedReportRun({
      ...runInput,
      manifestSha256: "e".repeat(64),
    })).toThrow(/manifest hash drifted/i);
    expect(() => validateCodingAgentBenchmarkCandidateExpectedReportRun({
      ...runInput,
      source: repositoryIdentity("f"),
    })).toThrow(/source identity drifted/i);
    expect(() => validateCodingAgentBenchmarkCandidateExpectedReportRun({
      ...runInput,
      reportPath: path.join(root, "unplanned", "benchmark-report.json"),
    })).toThrow(/report path.*not declared/i);
  });

  it("requires candidate and plan together before resolving repository identity", async () => {
    const resolveRepositoryIdentity = vi.fn();
    await expect(validateCodingAgentBenchmarkCandidateExpectedReportLaunch({
      candidateId: "candidate-a",
      manifestRevision: "v3",
      workspaceRoot: "E:/candidate/harness",
      artifactRoot: "E:/candidate/reports/windows-native/attempt-1/task",
      taskId: "rules.nested-precedence",
      attempt: 1,
      platform: "windows-native",
    }, { resolveRepositoryIdentity })).rejects.toThrow(
      /requires --candidate-id and --expected-report-plan together/i,
    );
    expect(resolveRepositoryIdentity).not.toHaveBeenCalled();
  });

  it("prepares a plan from frozen repositories and exposes a reproducible CLI", async () => {
    const manifestPath = resolveCodingAgentBenchmarkManifestPath("v3");
    const [manifestText, manifest] = await Promise.all([
      fs.readFile(manifestPath, "utf-8"),
      loadCodingAgentBenchmarkManifest(manifestPath),
    ]);
    const source = repositoryIdentity("1");
    const harness = repositoryIdentity("2");
    const resolveRepositoryIdentity = vi.fn(async (root) => (
      root.endsWith("source") ? source : harness
    ));
    const writePlan = vi.fn(async () => undefined);
    const input = parseCodingAgentBenchmarkExpectedReportPlanCliArguments([
      "--candidate-id", "candidate-20260903-b",
      "--report-root", "E:/candidate/reports",
      "--output", "E:/candidate/expected-report-plan.json",
      "--harness-root", "E:/candidate/harness",
      "--source-root", "E:/candidate/source",
      "--manifest", manifestPath,
    ]);

    const result = await prepareCodingAgentBenchmarkCandidateExpectedReportPlan(input, {
      resolvePath: (value) => path.win32.resolve(value),
      readFile: async () => manifestText,
      loadManifest: async () => manifest,
      resolveRepositoryIdentity,
      writePlan,
    });

    expect(result.plan).toMatchObject({
      candidate: { id: "candidate-20260903-b", source, harness },
      manifestSha256: hashCodingAgentBenchmarkManifestText(manifestText),
    });
    expect(result.plan.reports).toHaveLength(144);
    expect(writePlan).toHaveBeenCalledWith({
      plan: result.plan,
      outputPath: path.win32.resolve("E:/candidate/expected-report-plan.json"),
    });
    expect(() => parseCodingAgentBenchmarkExpectedReportPlanCliArguments([
      "--candidate-id", "candidate-a",
      "--candidate-id", "candidate-b",
      "--report-root", "reports",
      "--output", "plan.json",
    ])).toThrow(/only be provided once/i);
  });
});

function repositoryIdentity(seed) {
  return {
    commit: seed.repeat(40),
    workspaceDirty: false,
    lockfileSha256: seed.repeat(64),
    worktreeContentSha256: seed.repeat(64),
  };
}
