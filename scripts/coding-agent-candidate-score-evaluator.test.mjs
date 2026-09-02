import { describe, expect, it } from "vitest";

import {
  loadCodingAgentBenchmarkManifest,
  resolveCodingAgentBenchmarkManifestPath,
} from "./coding-agent-benchmark-contract.mjs";
import { loadCodingAgentBenchmarkScorecardV3 } from "./coding-agent-benchmark-v3-contract.mjs";
import {
  loadCodingAgentCandidateDimensionMapping,
} from "./coding-agent-candidate-score.mjs";
import {
  CODING_AGENT_CANDIDATE_SCORE_EVALUATION_VERSION,
  evaluateCodingAgentCandidateScores,
} from "./coding-agent-candidate-score-evaluator.mjs";
import {
  createCodingAgentCandidateScoredDecision,
} from "./coding-agent-candidate-qualification.mjs";

describe("coding agent candidate score evaluator", () => {
  it("awards only the frozen dimension minimums and preserves the unrounded weighted result", async () => {
    const input = await createCompleteInput();

    const result = evaluateCodingAgentCandidateScores(input);

    expect(result).toMatchObject({
      schemaVersion: CODING_AGENT_CANDIDATE_SCORE_EVALUATION_VERSION,
      status: "passed",
      rawWeighted: 9.51,
      rawWeightedMinimum: 9.5,
      rawWeightedPassed: true,
    });
    expect(result.dimensions.map(({ id, score, minimum, status }) => ({
      id,
      score,
      minimum,
      status,
    }))).toEqual(input.scorecard.targetVector.map(({ id, minimum }) => ({
      id,
      score: minimum,
      minimum,
      status: "awarded",
    })));
    expect(createCodingAgentCandidateScoredDecision({
      generatedAt: "2026-09-02T00:00:00.000Z",
      coverage: { expectedRunCount: 144, collectedRunCount: 144 },
      scoreEvaluation: result,
    })).toMatchObject({
      schemaVersion: "coding-agent-benchmark-candidate-qualification/v2",
      status: "eligible",
      coverage: { expectedRunCount: 144, collectedRunCount: 144, missingRunCount: 0 },
      scores: { rawWeighted: 9.51, rawWeightedMinimum: 9.5, status: "scored" },
    });
  });

  it("keeps the incomplete dimension and the aggregate result unscored", async () => {
    const input = await createCompleteInput();
    input.evidence.dimensions[2].status = "partial";

    const result = evaluateCodingAgentCandidateScores(input);

    expect(result.status).toBe("unscored");
    expect(result.rawWeighted).toBeNull();
    expect(result.dimensions.find(({ id }) => id === "cli_tui")).toMatchObject({
      evidenceStatus: "partial",
      aggregateStatus: "passed",
      score: null,
      status: "unscored",
    });
  });

  it("does not award a dimension whose aggregate metric misses its frozen threshold", async () => {
    const input = await createCompleteInput();
    for (const run of input.report.runs) {
      if (run.taskId === "command.interactive-control") run.evaluation.taskCompleted = false;
    }

    const result = evaluateCodingAgentCandidateScores(input);

    expect(result.status).toBe("unscored");
    expect(result.rawWeighted).toBeNull();
    const cliTui = result.dimensions.find(({ id }) => id === "cli_tui");
    expect(cliTui).toMatchObject({
      evidenceStatus: "complete",
      aggregateStatus: "failed",
      score: null,
      status: "unscored",
    });
    expect(cliTui.groups[0]).toMatchObject({ id: "interactive_cli", status: "failed" });
    expect(cliTui.groups[0].criteria[0]).toMatchObject({
      metricId: "task_completion_rate",
      numerator: 0,
      denominator: 6,
      observed: 0,
      passed: false,
    });
  });

  it("fails the raw weighted Gate without rounding when a valid scorecard threshold is higher", async () => {
    const input = await createCompleteInput();
    input.scorecard.rawWeightedMinimum = 9.52;

    const result = evaluateCodingAgentCandidateScores(input);

    expect(result).toMatchObject({
      status: "failed",
      rawWeighted: 9.51,
      rawWeightedMinimum: 9.52,
      rawWeightedPassed: false,
    });
  });

  it("rejects version or seven-dimension order drift at the public evaluator boundary", async () => {
    const versionDrift = await createCompleteInput();
    versionDrift.evidence.schemaVersion = "candidate-dimension-evidence-resolution/drifted";
    expect(() => evaluateCodingAgentCandidateScores(versionDrift)).toThrow(/version drifted/i);

    const orderDrift = await createCompleteInput();
    [orderDrift.evidence.dimensions[0], orderDrift.evidence.dimensions[1]] = [
      orderDrift.evidence.dimensions[1],
      orderDrift.evidence.dimensions[0],
    ];
    expect(() => evaluateCodingAgentCandidateScores(orderDrift)).toThrow(/dimension order drifted/i);
  });
});

async function createCompleteInput() {
  const [manifest, scorecard] = await Promise.all([
    loadCodingAgentBenchmarkManifest(resolveCodingAgentBenchmarkManifestPath("v3")),
    loadCodingAgentBenchmarkScorecardV3(),
  ]);
  const mapping = await loadCodingAgentCandidateDimensionMapping({ manifest, scorecard });
  const runs = manifest.tasks.flatMap((task) => task.platforms.flatMap((platform) => {
    return [1, 2, 3].map((attempt) => ({
      runId: `${task.id}-${platform}-${attempt}`,
      taskId: task.id,
      platform,
      evaluation: {
        taskCompleted: true,
        testsPassed: true,
        patchAccepted: true,
        regressionCount: 0,
        dangerousOperationBlocked: true,
        recoverySucceeded: true,
        manualInterventionCount: 0,
      },
    }));
  }));
  return {
    report: { schemaVersion: "coding-agent-benchmark-report/v3", runs },
    mapping,
    evidence: {
      schemaVersion: "coding-agent-benchmark-candidate-dimension-evidence-resolution/v1",
      dimensions: scorecard.targetVector.map(({ id }) => ({ id, status: "complete" })),
    },
    scorecard: structuredClone(scorecard),
  };
}
