import { getBenchmarkFixturePassMetricMinimums } from "./coding-agent-benchmark-fixtures.mjs";

export function findCandidateContractConflicts({ manifest, scorecard, mapping, accountingVersion }) {
  if (manifest.schemaVersion !== "coding-agent-benchmark-manifest/v3") {
    throw new Error("Candidate contract preflight requires a v3 manifest.");
  }
  const tasks = new Map(manifest.tasks.map((task) => [task.id, task]));
  const slotsFor = (task) => task.platforms.length * manifest.suite.sampleRuns;
  const layerASlots = manifest.tasks.filter((task) => task.layer === "A")
    .reduce((sum, task) => sum + slotsFor(task), 0);
  const allLayerARequired = scorecard.layerGates.A.requiredPassedExecutions === layerASlots;
  const minimums = new Map(manifest.tasks.map((task) => [task.id,
    getBenchmarkFixturePassMetricMinimums({ task, manifestRevision: "v3", accountingVersion })]));
  const conflicts = [];
  for (const dimension of mapping.dimensions) {
    for (const group of dimension.evidenceGroups) {
      const allGroupRunsRequired = group.criteria.some((criterion) =>
        criterion.source === "evaluation.taskCompleted" && criterion.aggregation === "boolean_rate"
        && criterion.threshold.operator === "gte" && criterion.threshold.value === 1);
      for (const criterion of group.criteria) {
        if (criterion.aggregation !== "sum" || criterion.threshold.operator !== "lte") continue;
        let minimum = 0;
        const taskIds = [];
        for (const taskId of group.taskIds) {
          const task = tasks.get(taskId);
          if (!task) throw new Error("Candidate contract group references an unknown task.");
          if (!allGroupRunsRequired && !(allLayerARequired && task.layer === "A")) continue;
          const bound = minimums.get(taskId).find((entry) => entry.source === criterion.source);
          if (!bound) continue;
          minimum += slotsFor(task) * bound.minimum;
          taskIds.push(taskId);
        }
        if (minimum > criterion.threshold.value) {
          conflicts.push({ dimensionId: dimension.id, groupId: group.id, metricId: criterion.metricId,
            taskIds, minimum, maximum: criterion.threshold.value });
        }
      }
    }
  }
  // 仅报告由 fixture 成功条件证明的矛盾；没有冲突不代表模型通过，也不授予候选资格。
  return conflicts;
}

export function assertCandidateContractConsistency(input) {
  const conflicts = findCandidateContractConflicts(input);
  if (conflicts.length > 0) {
    throw new Error(`Candidate contract conflict: ${conflicts.map((conflict) =>
      `${conflict.dimensionId}/${conflict.groupId}/${conflict.metricId} minimum=${conflict.minimum} maximum=${conflict.maximum}`
      + ` (${conflict.taskIds.join(", ")})`).join("; ")}.`);
  }
}
