import { describe, expect, it } from "vitest";

import {
  createTuiPerformanceReplayInput,
  hasAnsiInverseLabel,
  hasRequiredTuiLabels,
  isPathAbsent,
  parseTuiPerformanceBenchmarkArgs,
  stripAnsi,
} from "./run-tui-performance-benchmark.mjs";

describe("TUI performance benchmark runner", () => {
  it("defaults to a gated dual-platform run with enough samples", () => {
    expect(parseTuiPerformanceBenchmarkArgs([])).toEqual({
      platform: "all",
      output: "artifacts/benchmarks/p1b-tui-performance.json",
      baseline: "benchmarks/tui-performance/v1/baseline.json",
      warmupRuns: 1,
      sampleRuns: 7,
      startupTimeoutSeconds: 30,
      calibration: false,
      help: false,
    });
  });

  it("accepts an explicit single platform and calibration output", () => {
    expect(parseTuiPerformanceBenchmarkArgs([
      "--platform", "wsl2-linux",
      "--output", "artifacts/tui.json",
      "--warmup-runs", "0",
      "--sample-runs", "5",
      "--startup-timeout-seconds", "45",
      "--calibration",
    ])).toMatchObject({
      platform: "wsl2-linux",
      output: "artifacts/tui.json",
      warmupRuns: 0,
      sampleRuns: 5,
      startupTimeoutSeconds: 45,
      calibration: true,
    });
  });

  it.each([
    [["--platform", "linux"], /platform/],
    [["--sample-runs", "4"], /sample-runs/],
    [["--warmup-runs", "-1"], /warmup-runs/],
    [["--startup-timeout-seconds", "4"], /startup-timeout-seconds/],
    [["--unknown"], /Unknown argument/],
  ])("fails closed for invalid arguments %#", (args, expected) => {
    expect(() => parseTuiPerformanceBenchmarkArgs(args)).toThrow(expected);
  });

  it("creates a bounded deterministic replay whose tail can be observed in a narrow viewport", () => {
    const replay = createTuiPerformanceReplayInput(256);
    expect(replay).toHaveLength(256);
    expect(replay.endsWith("TUI_PERF_END")).toBe(true);
    expect(createTuiPerformanceReplayInput(12)).toBe("TUI_PERF_END");
    expect(() => createTuiPerformanceReplayInput(11)).toThrow(/at least 12/);
  });

  it("only treats ENOENT as proof that a temporary state path was removed", async () => {
    await expect(isPathAbsent("state", async () => {})).resolves.toBe(false);
    await expect(isPathAbsent("state", async () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    })).resolves.toBe(true);
    await expect(isPathAbsent("state", async () => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    })).rejects.toMatchObject({ code: "EACCES" });
  });

  it("recognizes keyboard focus only from a visible ANSI inverse label", () => {
    const frame = "Star Sanctuary CHAT \u001b[7mSESSIONS\u001b[27m CHANGES RUNTIME";
    expect(stripAnsi(frame)).toBe("Star Sanctuary CHAT SESSIONS CHANGES RUNTIME");
    expect(hasRequiredTuiLabels(frame)).toBe(true);
    expect(hasAnsiInverseLabel(frame, "SESSIONS")).toBe(true);
    expect(hasAnsiInverseLabel("Star Sanctuary CHAT SESSIONS CHANGES RUNTIME", "SESSIONS"))
      .toBe(false);
  });
});
