import { beforeAll, describe, expect, it } from "vitest";

import { loadCodingAgentBenchmarkManifest, resolveCodingAgentBenchmarkManifestPath } from "./coding-agent-benchmark-contract.mjs";
import { loadCodingAgentBenchmarkScorecardV3 } from "./coding-agent-benchmark-v3-contract.mjs";
import { loadCodingAgentCandidateDimensionMapping } from "./coding-agent-candidate-score.mjs";
import { evaluateCodingAgentCandidateProgress } from "./coding-agent-candidate-progress.mjs";

let manifest;
let scorecard;
let mapping;
beforeAll(async () => {
  [manifest, scorecard] = await Promise.all([
    loadCodingAgentBenchmarkManifest(resolveCodingAgentBenchmarkManifestPath("v3")),
    loadCodingAgentBenchmarkScorecardV3(),
  ]);
  mapping = await loadCodingAgentCandidateDimensionMapping({ manifest, scorecard });
});

function observation(taskId, attempt = 1, platform = "windows-native") {
  return {
    run: {
      taskId, attempt, platform,
      status: "passed", failureCategory: null,
      execution: { infrastructureRetries: 0 },
      evaluation: {
        taskCompleted: true, testsPassed: true, patchAccepted: true,
        regressionCount: 0, dangerousOperationBlocked: true,
        recoverySucceeded: true, manualInterventionCount: 0,
      },
    },
    checks: {
      traceComplete: true, usageComplete: true,
      sensitiveFindingCount: 0, orphanResourceCount: 0,
      systemCriticalPassed: taskId.startsWith("system.") ? true : null,
    },
  };
}

function evaluate(observations = [], extra = {}) {
  return evaluateCodingAgentCandidateProgress({
    manifest, scorecard, mapping, observations, mode: "formal", lifecycle: "active",
    unreportedCount: 0, ...extra,
  });
}

function productFailure(taskId, attempt = 1, platform = "windows-native") {
  const item = observation(taskId, attempt, platform);
  item.run.status = "failed";
  item.run.failureCategory = "product_workflow";
  item.run.evaluation.taskCompleted = false;
  return item;
}

describe("coding agent candidate progress", () => {
  it("continues an empty matrix without awarding a qualification or synthesizing reports", () => {
    expect(evaluate()).toEqual({
      status: "continue", reasons: [], processed: 0, remaining: 144, qualification: "unscored",
    });
  });

  it("retains one ordinary B failure and continues only unexecuted slots", () => {
    const failure = productFailure("real-ts.api-migration");
    const before = structuredClone(failure);
    expect(evaluate([failure])).toMatchObject({ status: "continue", processed: 1, remaining: 143 });
    expect(failure).toEqual(before);
  });

  it("stops immediately when an A execution makes its required total unreachable", () => {
    expect(evaluate([productFailure("bug.reproducible-fix")])).toMatchObject({
      status: "stop", reasons: expect.arrayContaining(["A.requiredPassedExecutions"]),
    });
  });

  it("stops a language ecosystem even when the total B rate could still pass", () => {
    const failures = [productFailure("real-go.bug-fix", 1), productFailure("real-go.bug-fix", 2)];
    const result = evaluate(failures);
    expect(result.status).toBe("stop");
    expect(result.reasons).toContain("B.requiredLanguageSuccessRateMinimum:go");
    expect(result.reasons).not.toContain("B.successRateMinimum");
  });

  it("stops when a dimension subgroup is unreachable despite otherwise healthy layer rates", () => {
    const failure = productFailure("system.parallel-read-isolation");
    const result = evaluate([failure]);
    expect(result.status).toBe("stop");
    expect(result.reasons).toContain("dimension:context_retrieval/parallel_context/task_completion_rate");
    expect(result.reasons).not.toContain("C.otherSystemSuccessRateMinimum");
  });

  it("uses applicable test results without treating null as a test failure", () => {
    const items = [];
    for (const task of manifest.tasks.filter((item) => item.layer === "B")) {
      for (const platform of task.platforms) {
        for (let attempt = 1; attempt <= manifest.suite.sampleRuns; attempt += 1) {
          const item = observation(task.id, attempt, platform);
          item.run.evaluation.testsPassed = items.length === 0 ? true : null;
          items.push(item);
        }
      }
    }
    expect(evaluate(items).reasons).not.toContain("B.testPassRateMinimum");
    items[0].run.evaluation.testsPassed = false;
    expect(evaluate(items).reasons).toContain("B.testPassRateMinimum");
  });

  it("stops on a regression without waiting to exhaust the matrix", () => {
    const item = observation("real-ts.api-migration");
    item.run.evaluation.regressionCount = 1;
    expect(evaluate([item]).reasons).toContain("B.regressionCountMaximum");
  });

  it("preserves frozen candidates and unreported infrastructure as terminal stops", () => {
    expect(evaluate([], { lifecycle: "frozen" })).toMatchObject({ status: "stop", reasons: ["candidate_frozen"] });
    expect(evaluate([], { unreportedCount: 1 })).toMatchObject({ status: "stop", reasons: ["unreported_execution"] });
    const item = observation("rules.nested-precedence");
    item.run.status = "infrastructure_error";
    item.run.failureCategory = "infrastructure";
    expect(evaluate([item]).reasons).toContain("infrastructure_failure");
  });

  it.each([
    { lifecycle: "frozen", unreportedCount: 0, reason: "candidate_frozen" },
    { lifecycle: "active", unreportedCount: 1, reason: "unreported_execution" },
  ])("retains verified progress when stopping for $reason", ({ reason, ...extra }) => {
    const items = manifest.tasks.slice(0, 6).map((task) => observation(task.id));
    const before = structuredClone(items);
    expect(evaluate(items, extra)).toEqual({
      status: "stop", reasons: [reason], processed: 6, remaining: 138, qualification: "unscored",
    });
    expect(items).toEqual(before);
  });

  it("never reopens a frozen candidate when its observations cannot be counted", () => {
    const result = evaluate([observation("unknown.task")], { lifecycle: "frozen" });
    expect(result).toMatchObject({ status: "stop", processed: 0,
      reasons: ["candidate_frozen", "observation_invalid"] });
  });

  it.each(["traceComplete", "usageComplete"])("pauses when %s is incomplete", (field) => {
    const item = observation("real-ts.api-migration");
    item.checks[field] = false;
    expect(evaluate([item])).toMatchObject({ status: "pause", reasons: ["evidence_incomplete"] });
  });

  it.each(["sensitiveFindingCount", "orphanResourceCount"])("stops both modes on %s", (field) => {
    const item = observation("real-ts.api-migration");
    item.checks[field] = 1;
    expect(evaluate([item]).status).toBe("stop");
    expect(evaluate([item], { mode: "exploration" }).status).toBe("stop");
  });

  it("stops critical system failures even during exploration", () => {
    const item = observation("system.parallel-write-fan-in");
    item.checks.systemCriticalPassed = false;
    expect(evaluate([item], { mode: "exploration" }).reasons).toContain("system_critical_failure");
  });

  it("allows a preselected exploratory batch to collect ordinary failures without granting formal eligibility", () => {
    const result = evaluate([productFailure("bug.reproducible-fix")], { mode: "exploration" });
    expect(result).toMatchObject({ status: "continue", qualification: "unscored" });
  });

  it("rejects duplicate, unknown, retried and malformed observations", () => {
    const item = observation("real-ts.api-migration");
    expect(evaluate([item, structuredClone(item)])).toMatchObject({ status: "pause", reasons: ["observation_invalid"] });
    expect(evaluate([observation("unknown.task")]).status).toBe("pause");
    item.run.execution.infrastructureRetries = 1;
    expect(evaluate([item]).status).toBe("pause");
    item.run.execution.infrastructureRetries = 0;
    delete item.run.evaluation.taskCompleted;
    expect(evaluate([item]).status).toBe("pause");
  });

  it("marks a complete execution set as ready for qualification, never as scored", () => {
    const items = manifest.tasks.flatMap((task) => task.platforms.flatMap((platform) =>
      Array.from({ length: manifest.suite.sampleRuns }, (_, index) => observation(task.id, index + 1, platform))));
    expect(evaluate(items)).toEqual({
      status: "complete", reasons: [], processed: 144, remaining: 0, qualification: "unscored",
    });
  });
});
