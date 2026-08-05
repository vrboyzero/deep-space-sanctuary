import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  createTuiPerformancePlatformResult,
  createTuiPerformanceReport,
} from "./tui-performance-contract.mjs";
import { verifyTuiPerformanceReportData } from "./verify-tui-performance-report.mjs";

const workspaceRoot = path.resolve(import.meta.dirname, "..");

function sample(sequence) {
  return {
    sequence,
    durationsMs: {
      startup: 100 + sequence,
      resize: 20 + sequence,
      inputReplay: 10 + sequence,
      exit: 30 + sequence,
    },
    capturedBytes: 20_000,
    lifecycle: {
      firstFrame: true,
      narrowFallback: true,
      wideLayoutRestored: true,
      mouseTabNavigation: true,
      inputReplayRendered: true,
      ctrlCSent: true,
      bracketedPasteRestored: true,
      mouseTrackingRestored: true,
      sgrMouseRestored: true,
      alternateScreenRestored: true,
      inputModesRestoredBeforeScreen: true,
      exitCode: 0,
      timedOut: false,
      observedProcessCount: 1,
      residualProcessCount: 0,
      stateDirRemoved: true,
    },
  };
}

function fixtureReport() {
  const platform = createTuiPerformancePlatformResult({
    platform: "windows-native",
    environment: {
      platform: "win32",
      arch: "x64",
      release: "fixture",
      nodeVersion: "v22.12.0",
      terminalBackend: "conpty",
      wsl: false,
    },
    samples: Array.from({ length: 5 }, (_, index) => sample(index + 1)),
  });
  const metrics = Object.fromEntries(Object.entries(platform.metrics).map(([phase, summary]) => [phase, {
    p99Ms: summary.p99Ms,
    jitterRate: summary.jitterRate,
  }]));
  const baseline = {
    schemaVersion: "tui-performance-baseline/v1",
    minimumSampleCount: 5,
    regressionPolicy: {
      p99Ratio: 1.5,
      p99AllowanceMs: 100,
      jitterRateRatio: 2,
      jitterRateAllowance: 0.1,
    },
    platforms: {
      "windows-native": {
        capturedAt: "2026-08-04T00:00:00.000Z",
        sourceCommit: "fixture",
        metrics,
      },
    },
  };
  return {
    baseline,
    report: createTuiPerformanceReport({
      generatedAt: "2026-08-04T00:00:00.000Z",
      source: { commit: "fixture", workspaceDirty: true },
      fixture: { warmupRuns: 1, sampleRuns: 5, replayCharacterCount: 256 },
      platformResults: [platform],
      baseline,
      requiredPlatforms: ["windows-native"],
    }),
  };
}

describe("TUI performance report verifier", () => {
  it("recomputes summaries and the historical gate from raw samples", () => {
    const { baseline, report } = fixtureReport();
    expect(verifyTuiPerformanceReportData(report, baseline)).toEqual(report);
  });

  it("rejects a report whose published metrics do not match its raw samples", () => {
    const { baseline, report } = fixtureReport();
    report.platforms[0].metrics.startup.p99Ms += 1;
    expect(() => verifyTuiPerformanceReportData(report, baseline)).toThrow(/does not match recomputed/i);
  });

  it("publishes valid baseline/report schemas and repository command wiring", async () => {
    const [baselineSchema, reportSchema, baseline, packageJson, readme, projectMap] = await Promise.all([
      fs.readFile(path.join(workspaceRoot, "benchmarks/tui-performance/v1/baseline.schema.json"), "utf-8").then(JSON.parse),
      fs.readFile(path.join(workspaceRoot, "benchmarks/tui-performance/v1/report.schema.json"), "utf-8").then(JSON.parse),
      fs.readFile(path.join(workspaceRoot, "benchmarks/tui-performance/v1/baseline.json"), "utf-8").then(JSON.parse),
      fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8").then(JSON.parse),
      fs.readFile(path.join(workspaceRoot, "benchmarks/tui-performance/README.md"), "utf-8"),
      fs.readFile(path.join(workspaceRoot, "docs/project-map.md"), "utf-8"),
    ]);
    const compiledBaseline = compileOutputSchema(baselineSchema);
    const compiledReport = compileOutputSchema(reportSchema);
    expect(compiledBaseline.ok).toBe(true);
    expect(compiledReport.ok).toBe(true);
    if (!compiledBaseline.ok || !compiledReport.ok) return;
    expect(compiledBaseline.validator.validateOutput(JSON.stringify(baseline))).toMatchObject({ ok: true });
    expect(packageJson.scripts["benchmark:tui-performance"]).toContain("run-tui-performance-benchmark.mjs");
    expect(packageJson.scripts["benchmark:tui-performance:windows"]).toContain("--platform windows-native");
    expect(packageJson.scripts["benchmark:tui-performance:wsl"]).toContain("--platform wsl2-linux");
    expect(packageJson.scripts["verify:tui-performance"]).toContain("verify-tui-performance-report.mjs");
    expect(readme).toContain("tui-performance-report/v1");
    expect(readme).toContain("不会自动更新 baseline");
    expect(projectMap).toContain("scripts/run-tui-performance-benchmark.mjs");
    expect(projectMap).toContain("benchmarks/tui-performance/v1/baseline.json");
  });
});
