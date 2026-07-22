import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "vitest";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..", "..");

function releasedResources() {
  return {
    responseBodyCount: 1,
    lockedResponseBodyCount: 0,
    activeRequestCount: 0,
    activeResponseCount: 0,
    openSocketCount: 0,
  };
}

function sample(overrides: Record<string, unknown> = {}) {
  return {
    requestCount: 1,
    requestStreamValues: [true],
    itemTypes: ["status", "delta", "usage", "final", "status"],
    deltaCount: 1,
    finalCount: 1,
    interruptedCount: 0,
    toolCallCount: 0,
    toolResultCount: 0,
    terminalStatus: "done",
    successfulCompletion: true,
    providerTtftMs: 10.1114,
    firstAgentDeltaMs: 11.2225,
    completionMs: 40.3336,
    resourceState: releasedResources(),
    ...overrides,
  };
}

test("A07 product report validates real streaming timing and failure/resource gates", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-agent-streaming-capability-benchmark.mjs")).href
  );
  const report = benchmarkModule.createAgentStreamingCapabilityReport({
    generatedAt: "2026-07-22T00:00:00.000Z",
    environment: {
      platform: "win32",
      arch: "x64",
      release: "test-release",
      nodeVersion: "v22.12.0",
      cpuModel: "fixture-cpu",
      logicalCpuCount: 8,
      totalMemoryBytes: 16_000_000_000,
      ci: false,
    },
    source: {
      commit: "fixture-commit",
      workspaceDirty: true,
      lockfileSha256: "fixture-lock-hash",
    },
    probe: {
      provider: "strict_local_mock",
      executionMode: "strict_local_sequential",
      warmupRuns: 1,
      sampleRuns: 1,
      firstContentDelayMs: 10,
      completionDelayMs: 30,
      scenarios: {
        normalCompletion: [sample()],
        callerCancel: [sample({
          itemTypes: ["status", "delta", "usage", "status"],
          finalCount: 0,
          terminalStatus: "stopped",
          successfulCompletion: false,
          completionMs: 12.3456,
        })],
        preCommitFailure: [sample({
          itemTypes: ["status", "usage", "final", "status"],
          deltaCount: 0,
          terminalStatus: "error",
          successfulCompletion: false,
          providerTtftMs: null,
          firstAgentDeltaMs: null,
          completionMs: 8.7654,
        })],
        postCommitFailure: [sample({
          itemTypes: ["status", "delta", "usage", "interrupted", "status"],
          finalCount: 0,
          interruptedCount: 1,
          terminalStatus: "error",
          successfulCompletion: false,
          completionMs: 16.7894,
        })],
      },
    },
  });

  expect(report).toMatchObject({
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    benchmark: {
      id: "agent-provider-streaming-product-gate",
      mode: "report_only",
      executionMode: "strict_local_sequential",
      thresholdApplied: true,
      provider: "strict_local_mock",
    },
    fixture: {
      warmupRuns: 1,
      sampleRuns: 1,
      firstContentDelayMs: 10,
      completionDelayMs: 30,
    },
    result: {
      streamingSupported: true,
      allGatesPassed: true,
      normalCompletion: {
        samples: [{
          requestStreamValues: [true],
          providerTtftMs: 10.111,
          firstAgentDeltaMs: 11.223,
          completionMs: 40.334,
        }],
        latency: {
          providerTtftMs: { sampleCount: 1, p95: 10.111 },
          firstAgentDeltaMs: { sampleCount: 1, p95: 11.223 },
          completionMs: { sampleCount: 1, p95: 40.334 },
        },
      },
      callerCancel: {
        samples: [{ terminalStatus: "stopped", finalCount: 0 }],
      },
      preCommitFailure: {
        samples: [{ deltaCount: 0, toolCallCount: 0, terminalStatus: "error" }],
      },
      postCommitFailure: {
        samples: [{ requestCount: 1, interruptedCount: 1, finalCount: 0 }],
      },
    },
  });
});

test("A07 product probe exercises normal, cancel, pre-commit, and post-commit paths", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-agent-streaming-capability-benchmark.mjs")).href
  );

  const probe = await benchmarkModule.probeToolAgentStreamingCapability({
    warmupRuns: 0,
    sampleRuns: 1,
    firstContentDelayMs: 5,
    completionDelayMs: 20,
  });

  expect(probe).toMatchObject({
    provider: "strict_local_mock",
    executionMode: "strict_local_sequential",
    warmupRuns: 0,
    sampleRuns: 1,
  });
  expect(Object.keys(probe.scenarios)).toEqual([
    "normalCompletion",
    "callerCancel",
    "preCommitFailure",
    "postCommitFailure",
  ]);
  for (const samples of Object.values(probe.scenarios) as Array<Array<Record<string, any>>>) {
    expect(samples).toHaveLength(1);
    expect(samples[0]?.requestStreamValues).toEqual([true]);
    expect(samples[0]?.resourceState).toEqual(expect.objectContaining({
      lockedResponseBodyCount: 0,
      activeRequestCount: 0,
      activeResponseCount: 0,
      openSocketCount: 0,
    }));
  }
  expect(probe.scenarios.normalCompletion[0]).toMatchObject({
    finalCount: 1,
    interruptedCount: 0,
    terminalStatus: "done",
    successfulCompletion: true,
  });
  expect(probe.scenarios.normalCompletion[0].providerTtftMs)
    .toBeLessThan(probe.scenarios.normalCompletion[0].completionMs);
  expect(probe.scenarios.normalCompletion[0].firstAgentDeltaMs)
    .toBeLessThan(probe.scenarios.normalCompletion[0].completionMs);
  expect(probe.scenarios.callerCancel[0]).toMatchObject({
    finalCount: 0,
    interruptedCount: 0,
    terminalStatus: "stopped",
  });
  expect(probe.scenarios.preCommitFailure[0]).toMatchObject({
    deltaCount: 0,
    toolCallCount: 0,
    successfulCompletion: false,
    terminalStatus: "error",
  });
  expect(probe.scenarios.postCommitFailure[0]).toMatchObject({
    requestCount: 1,
    finalCount: 0,
    interruptedCount: 1,
    terminalStatus: "error",
  });
});

test("root exposes the local-only A07 streaming product gate command", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8")) as {
    scripts?: Record<string, string>;
  };

  expect(packageJson.scripts?.["benchmark:agent-streaming-capability"])
    .toBe("node --import tsx scripts/run-agent-streaming-capability-benchmark.mjs");
});
