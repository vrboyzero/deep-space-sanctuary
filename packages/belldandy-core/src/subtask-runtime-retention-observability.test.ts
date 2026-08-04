import { describe, expect, it } from "vitest";

import { buildSubTaskRuntimeRetentionObservability } from "./subtask-runtime-retention-observability.js";

describe("buildSubTaskRuntimeRetentionObservability", () => {
  it("reports archived terminal volume and age without retaining task content", () => {
    const snapshot = buildSubTaskRuntimeRetentionObservability([
      { status: "running" },
      { status: "done" },
      { status: "error", archivedAt: 1_000 },
      { status: "timeout", archivedAt: 1_500 },
      { status: "pending", archivedAt: 2_000 },
    ], 3_000);

    expect(snapshot).toEqual({
      summary: {
        totalCount: 5,
        activeCount: 2,
        terminalCount: 3,
        archivedCount: 3,
        archivedTerminalCount: 2,
        archivedActiveCount: 1,
        unarchivedTerminalCount: 1,
        statusCounts: {
          pending: 1,
          running: 1,
          done: 1,
          error: 1,
          timeout: 1,
          stopped: 0,
          interrupted: 0,
        },
        oldestArchivedAt: 1_000,
        newestArchivedAt: 2_000,
        oldestArchivedAgeMs: 2_000,
        headline: "subtasks=5; active=2; terminal=3; archived=3 (terminal=2, active=1); unarchivedTerminal=1; oldestArchivedAgeMs=2000",
      },
    });
  });

  it("keeps an empty inventory stable and ignores invalid archive timestamps", () => {
    expect(buildSubTaskRuntimeRetentionObservability([
      { status: "done", archivedAt: Number.NaN },
      { status: "stopped", archivedAt: -1 },
    ], 1_000)).toEqual({
      summary: {
        totalCount: 2,
        activeCount: 0,
        terminalCount: 2,
        archivedCount: 0,
        archivedTerminalCount: 0,
        archivedActiveCount: 0,
        unarchivedTerminalCount: 2,
        statusCounts: {
          pending: 0,
          running: 0,
          done: 1,
          error: 0,
          timeout: 0,
          stopped: 1,
          interrupted: 0,
        },
        headline: "subtasks=2; active=0; terminal=2; archived=0 (terminal=0, active=0); unarchivedTerminal=2",
      },
    });
  });

  it("counts restart-lost records as interrupted terminal state", () => {
    expect(buildSubTaskRuntimeRetentionObservability([
      { status: "interrupted" },
    ], 1_000).summary).toMatchObject({
      totalCount: 1,
      activeCount: 0,
      terminalCount: 1,
      unarchivedTerminalCount: 1,
      statusCounts: {
        interrupted: 1,
      },
    });
  });
});
