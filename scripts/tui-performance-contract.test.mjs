import { describe, expect, it } from "vitest";

import {
  createTuiPerformancePlatformResult,
  createTuiPerformanceReport,
  evaluateTuiPerformanceAgainstBaseline,
  summarizeTuiDurationSamples,
} from "./tui-performance-contract.mjs";

const PHASES = ["startup", "resize", "inputReplay", "exit"];

function sample(sequence, durationsMs = {}) {
  return {
    sequence,
    durationsMs: {
      startup: 10 + sequence,
      resize: 20 + sequence,
      inputReplay: 30 + sequence,
      exit: 5 + sequence,
      ...durationsMs,
    },
    capturedBytes: 10_000 + sequence,
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

function platformResult(platform = "windows-native", mutate) {
  const samples = Array.from({ length: 5 }, (_, index) => sample(index + 1));
  mutate?.(samples);
  return createTuiPerformancePlatformResult({
    platform,
    environment: {
      platform: platform === "windows-native" ? "win32" : "linux",
      arch: "x64",
      release: "fixture",
      nodeVersion: "v22.12.0",
      terminalBackend: platform === "windows-native" ? "conpty" : "unix-pty",
      wsl: platform === "wsl2-linux",
    },
    samples,
    minimumSampleCount: 5,
  });
}

function baselineFor(result, overrides = {}) {
  const metrics = Object.fromEntries(PHASES.map((phase) => [phase, {
    p99Ms: result.metrics[phase].p99Ms,
    jitterRate: result.metrics[phase].jitterRate,
  }]));
  return {
    schemaVersion: "tui-performance-baseline/v1",
    minimumSampleCount: 5,
    regressionPolicy: {
      p99Ratio: 1.5,
      p99AllowanceMs: 25,
      jitterRateRatio: 1.5,
      jitterRateAllowance: 0.25,
      ...overrides,
    },
    platforms: {
      [result.platform]: {
        capturedAt: "2026-08-04T00:00:00.000Z",
        sourceCommit: "fixture",
        metrics,
      },
    },
  };
}

describe("TUI performance contract", () => {
  it("uses nearest-rank p50/p95/p99 and a bounded p99-to-p50 jitter rate", () => {
    expect(summarizeTuiDurationSamples([100, 10, 40, 30, 20])).toEqual({
      unit: "milliseconds",
      sampleCount: 5,
      minMs: 10,
      maxMs: 100,
      meanMs: 40,
      p50Ms: 30,
      p95Ms: 100,
      p99Ms: 100,
      jitterRate: 2.333333,
      percentileMethod: "nearest-rank",
      jitterFormula: "(p99-p50)/max(p50,1ms)",
    });
  });

  it("builds separate platform summaries only from complete clean lifecycle samples", () => {
    const result = platformResult("wsl2-linux");
    expect(result.platform).toBe("wsl2-linux");
    expect(result.sampleCount).toBe(5);
    expect(result.metrics.startup).toMatchObject({ p50Ms: 13, p95Ms: 15, p99Ms: 15 });
    expect(result.lifecycle).toEqual({
      allSamplesPassed: true,
      observedProcessCount: 5,
      residualProcessCount: 0,
    });
  });

  it.each([
    ["residual process", (samples) => { samples[2].lifecycle.residualProcessCount = 1; }, /residualProcessCount/],
    ["terminal mode leak", (samples) => { samples[1].lifecycle.sgrMouseRestored = false; }, /sgrMouseRestored/],
    ["missing phase", (samples) => { delete samples[0].durationsMs.resize; }, /durationsMs\.resize/],
  ])("fails closed for %s evidence", (_label, mutate, expected) => {
    expect(() => platformResult("windows-native", mutate)).toThrow(expected);
  });

  it("requires at least five measured samples", () => {
    expect(() => createTuiPerformancePlatformResult({
      platform: "windows-native",
      environment: {
        platform: "win32",
        arch: "x64",
        release: "fixture",
        nodeVersion: "v22.12.0",
        terminalBackend: "conpty",
      },
      samples: [sample(1), sample(2), sample(3), sample(4)],
      minimumSampleCount: 5,
    })).toThrow(/at least 5/);
  });

  it("fails historical p99 and jitter regressions without borrowing another platform baseline", () => {
    const result = platformResult("windows-native", (samples) => {
      samples[4].durationsMs.resize = 500;
    });
    const baseline = baselineFor(platformResult("windows-native"), {
      p99Ratio: 1,
      p99AllowanceMs: 0,
      jitterRateRatio: 1,
      jitterRateAllowance: 0,
    });
    const evaluation = evaluateTuiPerformanceAgainstBaseline(result, baseline);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.failures).toEqual(expect.arrayContaining([
      expect.stringMatching(/resize p99/i),
      expect.stringMatching(/resize jitter/i),
    ]));

    expect(() => evaluateTuiPerformanceAgainstBaseline(
      platformResult("wsl2-linux"),
      baseline,
    )).toThrow(/wsl2-linux baseline/);
  });

  it("creates a versioned report with one gate result per requested platform", () => {
    const windows = platformResult("windows-native");
    const wsl = platformResult("wsl2-linux");
    const windowsBaseline = baselineFor(windows);
    const wslBaseline = baselineFor(wsl);
    const baseline = {
      ...windowsBaseline,
      platforms: {
        ...windowsBaseline.platforms,
        ...wslBaseline.platforms,
      },
    };
    const report = createTuiPerformanceReport({
      generatedAt: "2026-08-04T00:00:00.000Z",
      source: { commit: "fixture", workspaceDirty: true },
      fixture: { warmupRuns: 1, sampleRuns: 5, replayCharacterCount: 256 },
      platformResults: [windows, wsl],
      baseline,
      requiredPlatforms: ["windows-native", "wsl2-linux"],
    });
    expect(report.schemaVersion).toBe("tui-performance-report/v1");
    expect(report.gate).toEqual({ passed: true, failures: [] });
    expect(report.platforms.map((entry) => entry.platform)).toEqual(["windows-native", "wsl2-linux"]);
    expect(report.platforms.every((entry) => entry.gate.passed)).toBe(true);
  });
});
