import { validateCodingAgentBenchmarkScorecardV3, validateCodingAgentBenchmarkV3Manifest } from "./coding-agent-benchmark-v3-contract.mjs";

// 调度只使用已验真的槽位观测；最佳剩余界限不会写成报告或授予分数。
export function evaluateCodingAgentCandidateProgress(input) {
  let expected = 0;
  let processed = 0;
  const result = (status, reasons = []) => ({
    status, reasons: [...new Set(reasons)], processed,
    remaining: Math.max(0, expected - processed), qualification: "unscored",
  });
  try {
    const { manifest, scorecard, mapping, observations } = input;
    validateCodingAgentBenchmarkV3Manifest(manifest);
    validateCodingAgentBenchmarkScorecardV3(scorecard);
    expected = scorecard.matrix.expectedExecutionCount;
    if (!["formal", "exploration"].includes(input.mode)
      || !["active", "frozen"].includes(input.lifecycle)
      || !Number.isSafeInteger(input.unreportedCount) || input.unreportedCount < 0
      || !Array.isArray(observations)
      || mapping?.schemaVersion !== "coding-agent-benchmark-candidate-dimension-mapping/v1"
      || JSON.stringify(mapping.dimensions?.map(({ id }) => id))
        !== JSON.stringify(scorecard.targetVector.map(({ id }) => id))) return result("pause", ["policy_input_invalid"]);
    if (input.lifecycle === "frozen") return result("stop", ["candidate_frozen"]);
    if (input.unreportedCount > 0) return result("stop", ["unreported_execution"]);

    const tasks = new Map(manifest.tasks.map((task) => [task.id, task]));
    const keys = new Set();
    for (const { run, checks } of observations) {
      const task = tasks.get(run?.taskId);
      const key = `${run?.taskId}/${run?.platform}/${run?.attempt}`;
      if (!task || !task.platforms.includes(run.platform)
        || !Number.isInteger(run.attempt) || run.attempt < 1 || run.attempt > manifest.suite.sampleRuns
        || keys.has(key) || run.execution?.infrastructureRetries !== 0
        || !validChecks(checks, task.layer === "C")
        || !validEvaluation(run.evaluation)
        || !["passed", "failed", "infrastructure_error"].includes(run.status)
        || (run.status === "passed" && run.failureCategory !== null)
        || (run.status === "failed" && run.failureCategory !== "product_workflow")
        || (run.status === "infrastructure_error" && run.failureCategory !== "infrastructure")) {
        return result("pause", ["observation_invalid"]);
      }
      keys.add(key);
    }
    processed = keys.size;
    const infrastructure = observations.some(({ run }) => run.status === "infrastructure_error");
    const hardFailures = observations.flatMap(({ checks }) => [
      ...(checks.sensitiveFindingCount > scorecard.hardGates.sensitiveFindingCountMaximum ? ["sensitive_finding"] : []),
      ...(checks.orphanResourceCount > scorecard.hardGates.orphanResourceCountMaximum ? ["orphan_resource"] : []),
      ...(checks.systemCriticalPassed === false ? ["system_critical_failure"] : []),
    ]);
    if (infrastructure) hardFailures.push("infrastructure_failure");
    if (hardFailures.length) return result("stop", hardFailures);
    if (observations.some(({ checks }) => !checks.traceComplete || !checks.usageComplete)) {
      return result("pause", ["evidence_incomplete"]);
    }
    if (input.mode === "exploration") return result(processed === expected ? "complete" : "continue");
    const runs = observations.map(({ run }) => run);
    const reasons = [];
    const slotsFor = (selectedTasks) => selectedTasks.reduce((sum, task) =>
      sum + task.platforms.length * manifest.suite.sampleRuns, 0);
    const layer = (name) => {
      const selectedTasks = manifest.tasks.filter((task) => task.layer === name);
      const selected = runs.filter((run) => tasks.get(run.taskId).layer === name);
      return { selected, remaining: slotsFor(selectedTasks) - selected.length };
    };
    const a = layer("A");
    if (a.selected.filter((run) => run.status === "passed").length + a.remaining
      < scorecard.layerGates.A.requiredPassedExecutions) reasons.push("A.requiredPassedExecutions");

    const b = layer("B");
    checkRate(reasons, "B.successRateMinimum", b.selected.map((run) => run.status === "passed"), b.remaining,
      scorecard.layerGates.B.successRateMinimum);
    for (const ecosystem of new Set(manifest.repositories.map((repo) => repo.languageEcosystem))) {
      const repositoryIds = new Set(manifest.repositories.filter((repo) => repo.languageEcosystem === ecosystem).map((repo) => repo.id));
      const selectedTasks = manifest.tasks.filter((task) => task.layer === "B" && repositoryIds.has(task.repositoryId));
      const selectedIds = new Set(selectedTasks.map((task) => task.id));
      const selected = b.selected.filter((run) => selectedIds.has(run.taskId));
      checkRate(reasons, `B.requiredLanguageSuccessRateMinimum:${ecosystem}`,
        selected.map((run) => run.status === "passed"), slotsFor(selectedTasks) - selected.length,
        scorecard.layerGates.B.requiredLanguageSuccessRateMinimum);
    }
    checkRate(reasons, "B.testPassRateMinimum", b.selected.map((run) => run.evaluation.testsPassed).filter((value) => value !== null),
      b.remaining, scorecard.layerGates.B.testPassRateMinimum);
    checkRate(reasons, "B.patchAcceptanceRateMinimum", b.selected.map((run) => run.evaluation.patchAccepted).filter((value) => value !== null),
      b.remaining, scorecard.layerGates.B.patchAcceptanceRateMinimum);
    if (b.selected.reduce((sum, run) => sum + run.evaluation.regressionCount, 0) > scorecard.layerGates.B.regressionCountMaximum) {
      reasons.push("B.regressionCountMaximum");
    }
    const c = layer("C");
    checkRate(reasons, "C.otherSystemSuccessRateMinimum", c.selected.map((run) => run.status === "passed"), c.remaining,
      scorecard.layerGates.C.otherSystemSuccessRateMinimum);

    for (const dimension of mapping.dimensions) {
      for (const group of dimension.evidenceGroups) {
        const ids = new Set(group.taskIds);
        if (ids.size !== group.taskIds.length || [...ids].some((id) => !tasks.has(id))) {
          return result("pause", ["policy_input_invalid"]);
        }
        const selected = runs.filter((run) => ids.has(run.taskId));
        const remaining = slotsFor(manifest.tasks.filter((task) => ids.has(task.id))) - selected.length;
        for (const criterion of group.criteria) {
          const reason = `dimension:${dimension.id}/${group.id}/${criterion.metricId}`;
          const values = selected.map((run) => criterion.source.split(".").reduce((value, field) => value?.[field], run));
          if (criterion.aggregation === "sum" && criterion.threshold.operator === "lte") {
            if (values.some((value) => !Number.isFinite(value) || value < 0)) return result("pause", ["observation_invalid"]);
            if (values.reduce((sum, value) => sum + value, 0) > criterion.threshold.value) reasons.push(reason);
          } else if (["boolean_rate", "applicable_boolean_rate"].includes(criterion.aggregation)
            && criterion.threshold.operator === "gte") {
            if (values.some((value) => value !== null && typeof value !== "boolean")) return result("pause", ["observation_invalid"]);
            checkRate(reasons, reason,
              criterion.aggregation === "applicable_boolean_rate" ? values.filter((value) => value !== null) : values,
              remaining, criterion.threshold.value);
          } else return result("pause", ["policy_input_invalid"]);
        }
      }
    }
    return reasons.length ? result("stop", reasons) : result(processed === expected ? "complete" : "continue");
  } catch {
    return result("pause", ["policy_input_invalid"]);
  }
}

function checkRate(reasons, label, values, remaining, minimum) {
  if (!Number.isFinite(minimum) || minimum < 0 || minimum > 1 || !Number.isSafeInteger(remaining) || remaining < 0) {
    throw new Error("Invalid remaining rate boundary.");
  }
  const denominator = values.length + remaining;
  const bestPossible = denominator === 0 ? 0 : (values.filter((value) => value === true).length + remaining) / denominator;
  if (bestPossible < minimum) reasons.push(label);
}

function validChecks(checks, system) {
  return checks && typeof checks.traceComplete === "boolean" && typeof checks.usageComplete === "boolean"
    && Number.isSafeInteger(checks.sensitiveFindingCount) && checks.sensitiveFindingCount >= 0
    && Number.isSafeInteger(checks.orphanResourceCount) && checks.orphanResourceCount >= 0
    && (system ? typeof checks.systemCriticalPassed === "boolean" : checks.systemCriticalPassed === null);
}

function validEvaluation(evaluation) {
  return evaluation && typeof evaluation.taskCompleted === "boolean"
    && ["testsPassed", "patchAccepted", "dangerousOperationBlocked", "recoverySucceeded"].every((field) =>
      evaluation[field] === null || typeof evaluation[field] === "boolean")
    && ["regressionCount", "manualInterventionCount"].every((field) =>
      Number.isSafeInteger(evaluation[field]) && evaluation[field] >= 0);
}
