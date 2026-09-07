import { beforeAll, describe, expect, it } from "vitest";

import { loadCodingAgentBenchmarkManifest, resolveCodingAgentBenchmarkManifestPath } from "./coding-agent-benchmark-contract.mjs";
import { getBenchmarkFixturePassMetricMinimums } from "./coding-agent-benchmark-fixtures.mjs";
import { loadCodingAgentBenchmarkScorecardV3 } from "./coding-agent-benchmark-v3-contract.mjs";
import { loadCodingAgentCandidateDimensionMapping } from "./coding-agent-candidate-score.mjs";
import { assertCandidateContractConsistency, findCandidateContractConflicts } from "./coding-agent-candidate-contract-preflight.mjs";
import { BENCHMARK_APPROVAL_ACCOUNTING_VERSION } from "./coding-agent-benchmark-approval.mjs";

let input;
beforeAll(async () => {
  const manifest = await loadCodingAgentBenchmarkManifest(resolveCodingAgentBenchmarkManifestPath("v3"));
  const scorecard = await loadCodingAgentBenchmarkScorecardV3();
  const mapping = await loadCodingAgentCandidateDimensionMapping({ manifest, scorecard });
  input = { manifest, scorecard, mapping };
});

function interactiveGroup(mapping) {
  return mapping.dimensions.find((dimension) => dimension.id === "cli_tui")
    .evidenceGroups.find((group) => group.id === "interactive_cli");
}

describe("candidate contract preflight", () => {
  it("clears the contradiction only with the authorized accounting version without relaxing thresholds", () => {
    const before = structuredClone(input);
    expect(findCandidateContractConflicts({ ...input, accountingVersion: BENCHMARK_APPROVAL_ACCOUNTING_VERSION })).toEqual([]);
    expect(() => assertCandidateContractConsistency({ ...input, accountingVersion: "unknown" })).toThrow(/accounting version/);
    expect(input).toEqual(before);
  });
  it("waives the A-layer contradiction proof under the authorized tolerance gate", () => {
    // 用户授权的确定性组容差修订（2026-09-07）：A 门 72→70、确定性组判据
    // 1.0→0.8/0.85。A 层不再要求 100%，且已无 taskCompleted>=1 的强制组，
    // fixture 最小量矛盾检查在真实记分卡下空转（0 冲突）。
    const before = structuredClone(input);
    expect(findCandidateContractConflicts(input)).toEqual([]);
    expect(() => assertCandidateContractConsistency(input)).not.toThrow();
    const hypothetical = structuredClone(input);
    hypothetical.scorecard.layerGates.A.requiredPassedExecutions = 72;
    expect(findCandidateContractConflicts(hypothetical)).toEqual([{
      dimensionId: "cli_tui", groupId: "interactive_cli", metricId: "manual_intervention_count",
      taskIds: ["command.interactive-control"], minimum: 30, maximum: 2,
    }]);
    expect(input).toEqual(before);
  });

  it.each([[29, 1], [30, 0]])("compares a hypothetical maximum of %i against fixture requirements", (maximum, conflicts) => {
    const hypothetical = structuredClone(input);
    hypothetical.scorecard.layerGates.A.requiredPassedExecutions = 72;
    interactiveGroup(hypothetical.mapping).criteria.find((criterion) => criterion.aggregation === "sum")
      .threshold.value = maximum;
    expect(findCandidateContractConflicts(hypothetical)).toHaveLength(conflicts);
  });

  it("restores the A-layer proof only under a strict all-runs A gate", () => {
    const hypothetical = structuredClone(input);
    interactiveGroup(hypothetical.mapping).criteria.find((criterion) => criterion.source === "evaluation.taskCompleted")
      .threshold.value = 0;
    expect(findCandidateContractConflicts(hypothetical)).toEqual([]);
    hypothetical.scorecard.layerGates.A.requiredPassedExecutions = 72;
    expect(findCandidateContractConflicts(hypothetical)).toHaveLength(1);
  });

  it("reads corrected fixture requirements without applying them to legacy or unrelated tasks", () => {
    const task = input.manifest.tasks.find((entry) => entry.id === "safety.boundary-enforcement");
    expect(getBenchmarkFixturePassMetricMinimums({ task, manifestRevision: "v3" }))
      .toEqual([{ source: "evaluation.manualInterventionCount", minimum: 4 }]);
    expect(getBenchmarkFixturePassMetricMinimums({ task, manifestRevision: "v1" })).toEqual([]);
    expect(getBenchmarkFixturePassMetricMinimums({ task: input.manifest.tasks[0], manifestRevision: "v3" })).toEqual([]);
    expect(() => getBenchmarkFixturePassMetricMinimums({ task: { ...task, fixture: { ...task.fixture, version: 3 } }, manifestRevision: "v3" }))
      .toThrow(/fixture identity/);
  });

  it("rejects unsupported revisions and unknown group tasks", () => {
    const hypothetical = structuredClone(input);
    hypothetical.manifest.schemaVersion = "coding-agent-benchmark-manifest/v4";
    expect(() => findCandidateContractConflicts(hypothetical)).toThrow(/v3 manifest/);
    hypothetical.manifest = input.manifest;
    interactiveGroup(hypothetical.mapping).taskIds = ["unknown.task"];
    expect(() => findCandidateContractConflicts(hypothetical)).toThrow(/unknown task/);
  });
});
