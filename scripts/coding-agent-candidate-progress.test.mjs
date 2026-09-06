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
    // javascript 池（real-js.bug-fix、real-js.failed-test-fix、real-web.dependency-diagnosis）
    // 共 18 槽：单次失败后最好可达 17/18 >= 0.9，保持 continue。
    const failure = productFailure("real-js.bug-fix");
    const before = structuredClone(failure);
    expect(evaluate([failure])).toMatchObject({ status: "continue", processed: 1, remaining: 143 });
    expect(failure).toEqual(before);
  });

  it("stops when a single typescript B failure makes its 0.9 ecosystem gate unreachable", () => {
    // real-ts.cross-package-refactor 移入 canary lane 后，typescript 非 canary B 池
    // 仅剩 real-ts.api-migration 的 6 槽：单次失败最好可达 5/6 = 0.833 < 0.9。
    const result = evaluate([productFailure("real-ts.api-migration")]);
    expect(result.status).toBe("stop");
    expect(result.reasons).toContain("B.requiredLanguageSuccessRateMinimum:typescript");
    expect(result.reasons).not.toContain("B.successRateMinimum");
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

  it("keeps canary lane executions out of every B gate denominator", () => {
    // real-go.public-api-migration 是 layerGateLane=canary 的独立受控 lane：
    // 其失败既不影响 B.successRateMinimum，也不进入 go 语言生态门槛。
    const failures = [
      productFailure("real-go.public-api-migration", 1),
      productFailure("real-go.public-api-migration", 2),
      productFailure("real-go.public-api-migration", 3),
    ];
    const result = evaluate(failures);
    expect(result.status).toBe("continue");
    expect(result.reasons).not.toContain("B.successRateMinimum");
    expect(result.reasons).not.toContain("B.requiredLanguageSuccessRateMinimum:go");
    expect(result.processed).toBe(3);
  });

  it("counts canary lane slots as processed without changing matrix completion", () => {
    const items = manifest.tasks.flatMap((task) => task.platforms.flatMap((platform) =>
      Array.from({ length: manifest.suite.sampleRuns }, (_, index) => {
        const item = observation(task.id, index + 1, platform);
        if (task.id === "real-go.public-api-migration") {
          item.run.status = "failed";
          item.run.failureCategory = "product_workflow";
          item.run.evaluation.taskCompleted = false;
        }
        return item;
      })));
    expect(evaluate(items)).toEqual({
      status: "complete", reasons: [], processed: 144, remaining: 0, qualification: "unscored",
    });
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

  it("absorbs up to two B regressions and stops on the third", () => {
    // 用户授权的分层回归门：B.regressionCountMaximum=2（sum 口径）。
    const one = observation("real-ts.api-migration");
    one.run.evaluation.regressionCount = 1;
    expect(evaluate([one]).reasons).not.toContain("B.regressionCountMaximum");
    const two = observation("real-js.bug-fix");
    two.run.evaluation.regressionCount = 1;
    expect(evaluate([one, two]).reasons).not.toContain("B.regressionCountMaximum");
    const three = observation("real-js.failed-test-fix");
    three.run.evaluation.regressionCount = 1;
    expect(evaluate([one, two, three]).reasons).toContain("B.regressionCountMaximum");
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
