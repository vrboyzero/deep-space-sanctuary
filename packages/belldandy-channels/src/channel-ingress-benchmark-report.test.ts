import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "vitest";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..", "..");

test("B00 Channel ingress benchmark reports fixed fake-adapter burst statistics without thresholds", async () => {
  // 复用公开 runner 的报告构造器，固定数据规模和无阈值语义，不依赖本机实际耗时。
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-channel-ingress-benchmark.mjs")).href,
  );
  const report = benchmarkModule.createChannelIngressBenchmarkReport({
    generatedAt: "2026-07-18T00:00:00.000Z",
    environment: {
      platform: "win32",
      arch: "x64",
      release: "test-release",
      nodeVersion: "v22.12.0",
      packageManager: "pnpm@10.23.0",
      cpuModel: "fixture-cpu",
      logicalCpuCount: 8,
      totalMemoryBytes: 16_000_000_000,
      channelsPackageVersion: "0.0.0",
      ci: false,
    },
    source: {
      commit: "fixture-commit",
      workspaceDirty: true,
      lockfileSha256: "fixture-lock-hash",
    },
    fixture: {
      warmupRuns: 1,
      sampleRuns: 5,
      payloadBytes: 256,
      channelCount: 4,
      maxConcurrent: 4,
      maxConcurrentPerChannel: 2,
    },
    scenarios: [
      {
        id: "burst_100",
        operation: "ChannelIngressScheduler.enqueue",
        messageCount: 100,
        sessionCount: 10,
        completedCount: 100,
        samplesMs: [10, 11, 12, 13, 14],
      },
      {
        id: "burst_1000",
        operation: "ChannelIngressScheduler.enqueue",
        messageCount: 1_000,
        sessionCount: 100,
        completedCount: 1_000,
        samplesMs: [20, 21, 22, 23, 24],
      },
    ],
  });

  expect(report).toMatchObject({
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    benchmark: {
      id: "channel-ingress-fake-adapter",
      mode: "report_only",
      adapter: "in_memory_fake",
      thresholdApplied: false,
    },
    fixture: {
      warmupRuns: 1,
      sampleRuns: 5,
      payloadBytes: 256,
      channelCount: 4,
    },
  });
  expect(report).not.toHaveProperty("thresholds");
  expect(report.scenarios[0].summary).toEqual({
    unit: "milliseconds",
    sampleCount: 5,
    min: 10,
    max: 14,
    mean: 12,
    median: 12,
    p95: 14,
    variance: 2,
    standardDeviation: 1.414,
    percentileMethod: "nearest-rank",
    varianceMethod: "population",
  });
  expect(report.scenarios[1]).toMatchObject({
    messageCount: 1_000,
    completedCount: 1_000,
  });
});

test("Channel ingress benchmark accepts pnpm's argument separator", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-channel-ingress-benchmark.mjs")).href,
  );

  expect(benchmarkModule.parseChannelIngressBenchmarkArgs([
    "--",
    "--sample-runs",
    "2",
  ])).toMatchObject({
    sampleRuns: 2,
  });
});

test("root exposes a tsx-backed Channel ingress benchmark command", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8")) as {
    scripts?: Record<string, string>;
  };

  expect(packageJson.scripts?.["benchmark:channel-ingress"])
    .toBe("node --import tsx scripts/run-channel-ingress-benchmark.mjs");
});
