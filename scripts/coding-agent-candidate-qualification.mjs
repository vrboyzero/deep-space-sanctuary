import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  CODING_RUN_TRACE_POLICY,
  isAgentRunEventV1,
  isCodingRunCapabilitiesV1,
  isCodingRunUsageCompletenessV1,
} from "../packages/belldandy-core/src/coding-run/contracts.ts";
import {
  projectCodingRunTraceEvents,
  validateCodingRunTraceEvents,
} from "../packages/belldandy-core/src/coding-run/trace.ts";
import { verifyCodingAgentBaselineArtifact } from "./aggregate-coding-agent-benchmark.mjs";
import {
  evaluateCodingAgentCandidateScores,
} from "./coding-agent-candidate-score-evaluator.mjs";
import {
  loadCodingAgentCandidateDimensionEvidence,
  loadCodingAgentCandidateDimensionMapping,
} from "./coding-agent-candidate-score.mjs";
import { loadCodingAgentBenchmarkScorecardV3 } from "./coding-agent-benchmark-v3-contract.mjs";
import { validateCodingAgentBenchmarkV3SystemEvidence } from "./coding-agent-benchmark-v3-fixtures.mjs";
import { validateAgentRunEvents } from "./run-coding-agent-ci.mjs";
import {
  CODING_AGENT_MODEL_EXECUTION_LOCAL_FIXTURE,
} from "./coding-agent-benchmark-local-fixture.mjs";

export const CODING_AGENT_CANDIDATE_QUALIFICATION_VERSION =
  "coding-agent-benchmark-candidate-qualification/v2";

export async function writeCodingAgentCandidateGlobalReceipt(input) {
  const aggregateRoot = path.resolve(requireInput(input?.aggregateRoot, "aggregateRoot"));
  const [{ report, baselineIndex }, scorecard] = await Promise.all([
    verifyCodingAgentBaselineArtifact({ outputRoot: aggregateRoot }),
    loadCodingAgentBenchmarkScorecardV3(input?.scorecardPath),
  ]);
  if (report.schemaVersion !== "coding-agent-benchmark-report/v3") {
    throw new Error("Coding benchmark candidate-global receipt requires a v3 aggregate.");
  }
  if (baselineIndex.coverage.missingRunKeys.length > 0) {
    throw new Error("Coding benchmark candidate-global receipt requires a complete aggregate.");
  }
  const generatedAt = requireTimestamp(input?.generatedAt, "generatedAt");
  const baselineIndexText = await fs.readFile(path.join(aggregateRoot, "baseline-index.json"), "utf-8");
  const receipt = {
    schemaVersion: scorecard.qualificationEvidence.sources.candidateGlobalReceipt.schemaVersion,
    generatedAt,
    aggregate: {
      manifestSha256: baselineIndex.manifestSha256,
      reportSha256: baselineIndex.report.sha256,
      indexSha256: sha256(baselineIndexText),
      source: structuredClone(report.source),
      harness: structuredClone(report.harness),
    },
    sensitiveScan: structuredClone(input?.sensitiveScan),
    resourceSweeps: structuredClone(input?.resourceSweeps),
  };
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  const validator = await loadCandidateGlobalReceiptValidator();
  if (!validator.validateOutput(serialized).ok) {
    throw new Error("Coding benchmark candidate-global receipt input does not match its schema.");
  }
  const receiptPath = path.join(
    aggregateRoot,
    scorecard.qualificationEvidence.sources.candidateGlobalReceipt.path,
  );
  await fs.writeFile(receiptPath, serialized, { encoding: "utf-8", flag: "wx" });
  return receipt;
}

export async function qualifyCodingAgentBenchmarkCandidate(input) {
  const aggregateRoot = path.resolve(requireInput(input?.aggregateRoot, "aggregateRoot"));
  const [{ report, baselineIndex }, scorecard] = await Promise.all([
    verifyCodingAgentBaselineArtifact({ outputRoot: aggregateRoot }),
    loadCodingAgentBenchmarkScorecardV3(input?.scorecardPath),
  ]);

  if (report.schemaVersion !== "coding-agent-benchmark-report/v3") {
    throw new Error("Coding benchmark candidate qualification requires a v3 aggregate.");
  }

  const coverage = baselineIndex.coverage;
  const scores = {
    dimensions: scorecard.targetVector.map((dimension) => ({
      id: dimension.id,
      score: null,
      status: "unscored",
    })),
    rawWeighted: null,
    status: "unscored",
  };
  if (coverage.missingRunKeys.length > 0) {
    return {
      schemaVersion: CODING_AGENT_CANDIDATE_QUALIFICATION_VERSION,
      status: "not_eligible",
      generatedAt: report.generatedAt,
      coverage: {
        expectedRunCount: coverage.expectedRunCount,
        collectedRunCount: coverage.collectedRunCount,
        missingRunCount: coverage.missingRunKeys.length,
      },
      scores,
      blockingReasons: [{
        code: "incomplete_matrix",
        expectedRunCount: coverage.expectedRunCount,
        collectedRunCount: coverage.collectedRunCount,
        missingRunCount: coverage.missingRunKeys.length,
      }],
    };
  }

  if (baselineIndex.expectedReports?.missingReportCount
    > scorecard.hardGates.missingReportCountMaximum) {
    return {
      schemaVersion: CODING_AGENT_CANDIDATE_QUALIFICATION_VERSION,
      status: "not_eligible",
      generatedAt: report.generatedAt,
      coverage: {
        expectedRunCount: coverage.expectedRunCount,
        collectedRunCount: coverage.collectedRunCount,
        missingRunCount: 0,
      },
      scores,
      blockingReasons: [{
        code: "candidate_aggregate_hard_gate_failed",
        failedGates: [{
          id: "missingReportCountMaximum",
          observed: baselineIndex.expectedReports.missingReportCount,
          maximum: scorecard.hardGates.missingReportCountMaximum,
        }],
      }],
    };
  }

  if (report.summary.infrastructureErrorRunCount
    > scorecard.hardGates.selectedInfrastructureErrorCountMaximum) {
    return {
      schemaVersion: CODING_AGENT_CANDIDATE_QUALIFICATION_VERSION,
      status: "not_eligible",
      generatedAt: report.generatedAt,
      coverage: {
        expectedRunCount: coverage.expectedRunCount,
        collectedRunCount: coverage.collectedRunCount,
        missingRunCount: 0,
      },
      scores,
      blockingReasons: [{
        code: "candidate_aggregate_hard_gate_failed",
        failedGates: [{
          id: "selectedInfrastructureErrorCountMaximum",
          observed: report.summary.infrastructureErrorRunCount,
          maximum: scorecard.hardGates.selectedInfrastructureErrorCountMaximum,
        }],
      }],
    };
  }

  const candidateGlobalReceipt = scorecard.qualificationEvidence.sources.candidateGlobalReceipt;
  const candidateGlobalReceiptPath = path.resolve(aggregateRoot, candidateGlobalReceipt.path);
  let candidateGlobalReceiptText;
  try {
    const receiptStat = await fs.stat(candidateGlobalReceiptPath);
    if (!receiptStat.isFile() || receiptStat.size > 1024 * 1024) {
      return createReceiptInvalidReport({
        report,
        coverage,
        scores,
        receipt: candidateGlobalReceipt,
        reason: "schema_validation_failed",
      });
    }
    candidateGlobalReceiptText = await fs.readFile(candidateGlobalReceiptPath, "utf-8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      schemaVersion: CODING_AGENT_CANDIDATE_QUALIFICATION_VERSION,
      status: "not_eligible",
      generatedAt: report.generatedAt,
      coverage: {
        expectedRunCount: coverage.expectedRunCount,
        collectedRunCount: coverage.collectedRunCount,
        missingRunCount: 0,
      },
      scores,
      blockingReasons: [{
        code: "candidate_global_receipt_missing",
        path: candidateGlobalReceipt.path,
        schemaVersion: candidateGlobalReceipt.schemaVersion,
      }],
    };
  }

  const candidateGlobalReceiptValidator = await loadCandidateGlobalReceiptValidator();
  if (!candidateGlobalReceiptValidator.validateOutput(candidateGlobalReceiptText).ok) {
    return createReceiptInvalidReport({
      report,
      coverage,
      scores,
      receipt: candidateGlobalReceipt,
      reason: "schema_validation_failed",
    });
  }
  const parsedCandidateGlobalReceipt = JSON.parse(candidateGlobalReceiptText);
  const baselineIndexText = await fs.readFile(path.join(aggregateRoot, "baseline-index.json"), "utf-8");
  const expectedReceiptBinding = {
    manifestSha256: baselineIndex.manifestSha256,
    reportSha256: baselineIndex.report.sha256,
    indexSha256: sha256(baselineIndexText),
    source: report.source,
    harness: report.harness,
  };
  const mismatchedFields = [
    "manifestSha256",
    "reportSha256",
    "indexSha256",
    "source",
    "harness",
  ].filter((field) => {
    return JSON.stringify(parsedCandidateGlobalReceipt.aggregate[field])
      !== JSON.stringify(expectedReceiptBinding[field]);
  }).map((field) => `aggregate.${field}`);
  if (mismatchedFields.length > 0) {
    return createReceiptInvalidReport({
      report,
      coverage,
      scores,
      receipt: candidateGlobalReceipt,
      reason: "aggregate_binding_mismatch",
      mismatchedFields,
    });
  }
  if (parsedCandidateGlobalReceipt.sensitiveScan.unreadableFileCount > 0) {
    return createReceiptInvalidReport({
      report,
      coverage,
      scores,
      receipt: candidateGlobalReceipt,
      reason: "sensitive_scan_incomplete",
      unreadableFileCount: parsedCandidateGlobalReceipt.sensitiveScan.unreadableFileCount,
    });
  }
  const inconsistentResourceSweepPlatforms = parsedCandidateGlobalReceipt.resourceSweeps
    .filter((sweep) => {
      const remainingResourceCount = sweep.remainingListenerCount
        + sweep.remainingOwnedProcessCount
        + sweep.remainingRuntimeMarkerCount
        + sweep.remainingRuntimeEnvFileCount;
      return remainingResourceCount > 0 && sweep.orphanResourceCount === 0;
    })
    .map((sweep) => sweep.platform);
  if (inconsistentResourceSweepPlatforms.length > 0) {
    return createReceiptInvalidReport({
      report,
      coverage,
      scores,
      receipt: candidateGlobalReceipt,
      reason: "resource_sweep_inconsistent",
      platforms: inconsistentResourceSweepPlatforms,
    });
  }
  const candidateGlobalFailedGates = [
    {
      id: "sensitiveFindingCountMaximum",
      observed: parsedCandidateGlobalReceipt.sensitiveScan.findingCount,
      maximum: scorecard.hardGates.sensitiveFindingCountMaximum,
    },
    {
      id: "orphanResourceCountMaximum",
      observed: parsedCandidateGlobalReceipt.resourceSweeps.reduce(
        (sum, sweep) => sum + sweep.orphanResourceCount,
        0,
      ),
      maximum: scorecard.hardGates.orphanResourceCountMaximum,
    },
  ].filter((gate) => gate.observed > gate.maximum);
  if (candidateGlobalFailedGates.length > 0) {
    return {
      schemaVersion: CODING_AGENT_CANDIDATE_QUALIFICATION_VERSION,
      status: "not_eligible",
      generatedAt: report.generatedAt,
      coverage: {
        expectedRunCount: coverage.expectedRunCount,
        collectedRunCount: coverage.collectedRunCount,
        missingRunCount: 0,
      },
      scores,
      blockingReasons: [{
        code: "candidate_global_hard_gate_failed",
        failedGates: candidateGlobalFailedGates,
      }],
    };
  }

  const manifest = JSON.parse(await fs.readFile(path.join(aggregateRoot, "task-manifest.json"), "utf-8"));
  const manifestTasksById = new Map(manifest.tasks.map((task) => [task.id, task]));
  const runEventGateCounts = await evaluateCandidateRunEventGates({
    aggregateRoot,
    runs: report.runs,
    manifestTasksById,
  });
  const runEventFailedGates = [
    {
      id: "incompleteTraceCountMaximum",
      observed: runEventGateCounts.incompleteTraceCount,
      maximum: scorecard.hardGates.incompleteTraceCountMaximum,
    },
    {
      id: "incompleteProviderUsageCountMaximum",
      observed: runEventGateCounts.incompleteProviderUsageCount,
      maximum: scorecard.hardGates.incompleteProviderUsageCountMaximum,
    },
  ].filter((gate) => gate.observed > gate.maximum);
  if (runEventFailedGates.length > 0) {
    return {
      schemaVersion: CODING_AGENT_CANDIDATE_QUALIFICATION_VERSION,
      status: "not_eligible",
      generatedAt: report.generatedAt,
      coverage: {
        expectedRunCount: coverage.expectedRunCount,
        collectedRunCount: coverage.collectedRunCount,
        missingRunCount: 0,
      },
      scores,
      blockingReasons: [{
        code: "candidate_run_events_hard_gate_failed",
        failedGates: runEventFailedGates,
      }],
    };
  }

  const cRuns = report.runs.filter((run) => run.taskId.startsWith("system."));
  let passedCriticalSystemEvidenceCount = 0;
  for (const run of cRuns) {
    try {
      const evidenceText = await fs.readFile(
        path.resolve(aggregateRoot, run.artifacts.systemEvidence),
        "utf-8",
      );
      const evidence = JSON.parse(evidenceText);
      const failures = validateCodingAgentBenchmarkV3SystemEvidence({
        evidence,
        task: manifestTasksById.get(run.taskId),
        runId: run.runId,
        platform: run.platform,
      });
      if (failures.length === 0) passedCriticalSystemEvidenceCount += 1;
    } catch {
      // Invalid or unreadable retained evidence remains a failed critical system observation.
    }
  }
  const cCriticalGateDenominator = cRuns.length;
  const cCriticalGateRate = cCriticalGateDenominator === 0
    ? 0
    : passedCriticalSystemEvidenceCount / cCriticalGateDenominator;
  if (cCriticalGateRate < scorecard.layerGates.C.criticalGateRateMinimum) {
    return {
      schemaVersion: CODING_AGENT_CANDIDATE_QUALIFICATION_VERSION,
      status: "not_eligible",
      generatedAt: report.generatedAt,
      coverage: {
        expectedRunCount: coverage.expectedRunCount,
        collectedRunCount: coverage.collectedRunCount,
        missingRunCount: 0,
      },
      scores,
      blockingReasons: [{
        code: "candidate_layer_gate_failed",
        failedGates: [{
          layer: "C",
          id: "criticalGateRateMinimum",
          numerator: passedCriticalSystemEvidenceCount,
          denominator: cCriticalGateDenominator,
          observed: cCriticalGateRate,
          minimum: scorecard.layerGates.C.criticalGateRateMinimum,
        }],
      }],
    };
  }

  const aRuns = report.runs.filter((run) => manifestTasksById.get(run.taskId)?.layer === "A");
  const passedARunCount = aRuns.filter((run) => run.status === "passed").length;
  if (passedARunCount < scorecard.layerGates.A.requiredPassedExecutions) {
    return {
      schemaVersion: CODING_AGENT_CANDIDATE_QUALIFICATION_VERSION,
      status: "not_eligible",
      generatedAt: report.generatedAt,
      coverage: {
        expectedRunCount: coverage.expectedRunCount,
        collectedRunCount: coverage.collectedRunCount,
        missingRunCount: 0,
      },
      scores,
      blockingReasons: [{
        code: "candidate_layer_gate_failed",
        failedGates: [{
          layer: "A",
          id: "requiredPassedExecutions",
          numerator: passedARunCount,
          denominator: aRuns.length,
          observed: passedARunCount,
          minimum: scorecard.layerGates.A.requiredPassedExecutions,
        }],
      }],
    };
  }

  // 用户授权的独立受控 canary lane（manifest.task.layerGateLane === "canary"）：
  // 结果照常保留，但不进入 B 层成功率、语言生态、测试与 patch 门槛分母。
  const isLayerGateCanaryTask = (task) => task?.layerGateLane === "canary";
  const bRuns = report.runs.filter((run) => {
    const task = manifestTasksById.get(run.taskId);
    return task?.layer === "B" && !isLayerGateCanaryTask(task);
  });
  const passedBRunCount = bRuns.filter((run) => run.status === "passed").length;
  const bSuccessRate = bRuns.length === 0 ? 0 : passedBRunCount / bRuns.length;
  if (bSuccessRate < scorecard.layerGates.B.successRateMinimum) {
    return {
      schemaVersion: CODING_AGENT_CANDIDATE_QUALIFICATION_VERSION,
      status: "not_eligible",
      generatedAt: report.generatedAt,
      coverage: {
        expectedRunCount: coverage.expectedRunCount,
        collectedRunCount: coverage.collectedRunCount,
        missingRunCount: 0,
      },
      scores,
      blockingReasons: [{
        code: "candidate_layer_gate_failed",
        failedGates: [{
          layer: "B",
          id: "successRateMinimum",
          numerator: passedBRunCount,
          denominator: bRuns.length,
          observed: bSuccessRate,
          minimum: scorecard.layerGates.B.successRateMinimum,
        }],
      }],
    };
  }

  const manifestRepositoriesById = new Map(
    manifest.repositories.map((repository) => [repository.id, repository]),
  );
  const requiredEcosystems = [...new Set(
    manifest.repositories.map((repository) => repository.languageEcosystem),
  )];
  const bEcosystemFailedGates = requiredEcosystems.map((ecosystem) => {
    const ecosystemRuns = bRuns.filter((run) => {
      const task = manifestTasksById.get(run.taskId);
      return manifestRepositoriesById.get(task.repositoryId)?.languageEcosystem === ecosystem;
    });
    const passedRunCount = ecosystemRuns.filter((run) => run.status === "passed").length;
    const successRate = ecosystemRuns.length === 0 ? 0 : passedRunCount / ecosystemRuns.length;
    return {
      layer: "B",
      id: "requiredLanguageSuccessRateMinimum",
      ecosystem,
      numerator: passedRunCount,
      denominator: ecosystemRuns.length,
      observed: successRate,
      minimum: scorecard.layerGates.B.requiredLanguageSuccessRateMinimum,
    };
  }).filter((gate) => gate.observed < gate.minimum);
  if (bEcosystemFailedGates.length > 0) {
    return {
      schemaVersion: CODING_AGENT_CANDIDATE_QUALIFICATION_VERSION,
      status: "not_eligible",
      generatedAt: report.generatedAt,
      coverage: {
        expectedRunCount: coverage.expectedRunCount,
        collectedRunCount: coverage.collectedRunCount,
        missingRunCount: 0,
      },
      scores,
      blockingReasons: [{
        code: "candidate_layer_gate_failed",
        failedGates: bEcosystemFailedGates,
      }],
    };
  }

  const bTestRuns = bRuns.filter((run) => run.evaluation.testsPassed !== null);
  const passedBTestCount = bTestRuns.filter((run) => run.evaluation.testsPassed === true).length;
  const bTestPassRate = bTestRuns.length === 0 ? 0 : passedBTestCount / bTestRuns.length;
  if (bTestPassRate < scorecard.layerGates.B.testPassRateMinimum) {
    return {
      schemaVersion: CODING_AGENT_CANDIDATE_QUALIFICATION_VERSION,
      status: "not_eligible",
      generatedAt: report.generatedAt,
      coverage: {
        expectedRunCount: coverage.expectedRunCount,
        collectedRunCount: coverage.collectedRunCount,
        missingRunCount: 0,
      },
      scores,
      blockingReasons: [{
        code: "candidate_layer_gate_failed",
        failedGates: [{
          layer: "B",
          id: "testPassRateMinimum",
          numerator: passedBTestCount,
          denominator: bTestRuns.length,
          observed: bTestPassRate,
          minimum: scorecard.layerGates.B.testPassRateMinimum,
        }],
      }],
    };
  }

  const bPatchRuns = bRuns.filter((run) => run.evaluation.patchAccepted !== null);
  const acceptedBPatchCount = bPatchRuns.filter((run) => run.evaluation.patchAccepted === true).length;
  const bPatchAcceptanceRate = bPatchRuns.length === 0
    ? 0
    : acceptedBPatchCount / bPatchRuns.length;
  if (bPatchAcceptanceRate < scorecard.layerGates.B.patchAcceptanceRateMinimum) {
    return {
      schemaVersion: CODING_AGENT_CANDIDATE_QUALIFICATION_VERSION,
      status: "not_eligible",
      generatedAt: report.generatedAt,
      coverage: {
        expectedRunCount: coverage.expectedRunCount,
        collectedRunCount: coverage.collectedRunCount,
        missingRunCount: 0,
      },
      scores,
      blockingReasons: [{
        code: "candidate_layer_gate_failed",
        failedGates: [{
          layer: "B",
          id: "patchAcceptanceRateMinimum",
          numerator: acceptedBPatchCount,
          denominator: bPatchRuns.length,
          observed: bPatchAcceptanceRate,
          minimum: scorecard.layerGates.B.patchAcceptanceRateMinimum,
        }],
      }],
    };
  }

  const bRegressionCount = bRuns.reduce(
    (sum, run) => sum + run.evaluation.regressionCount,
    0,
  );
  if (bRegressionCount > scorecard.layerGates.B.regressionCountMaximum) {
    return {
      schemaVersion: CODING_AGENT_CANDIDATE_QUALIFICATION_VERSION,
      status: "not_eligible",
      generatedAt: report.generatedAt,
      coverage: {
        expectedRunCount: coverage.expectedRunCount,
        collectedRunCount: coverage.collectedRunCount,
        missingRunCount: 0,
      },
      scores,
      blockingReasons: [{
        code: "candidate_layer_gate_failed",
        failedGates: [{
          layer: "B",
          id: "regressionCountMaximum",
          observed: bRegressionCount,
          maximum: scorecard.layerGates.B.regressionCountMaximum,
        }],
      }],
    };
  }

  const passedCRunCount = cRuns.filter((run) => run.status === "passed").length;
  const cSuccessRate = cRuns.length === 0 ? 0 : passedCRunCount / cRuns.length;
  if (cSuccessRate < scorecard.layerGates.C.otherSystemSuccessRateMinimum) {
    return {
      schemaVersion: CODING_AGENT_CANDIDATE_QUALIFICATION_VERSION,
      status: "not_eligible",
      generatedAt: report.generatedAt,
      coverage: {
        expectedRunCount: coverage.expectedRunCount,
        collectedRunCount: coverage.collectedRunCount,
        missingRunCount: 0,
      },
      scores,
      blockingReasons: [{
        code: "candidate_layer_gate_failed",
        failedGates: [{
          layer: "C",
          id: "otherSystemSuccessRateMinimum",
          numerator: passedCRunCount,
          denominator: cRuns.length,
          observed: cSuccessRate,
          minimum: scorecard.layerGates.C.otherSystemSuccessRateMinimum,
        }],
      }],
    };
  }

  if (baselineIndex.expectedReports === undefined) {
    return {
      schemaVersion: CODING_AGENT_CANDIDATE_QUALIFICATION_VERSION,
      status: "not_eligible",
      generatedAt: report.generatedAt,
      coverage: {
        expectedRunCount: coverage.expectedRunCount,
        collectedRunCount: coverage.collectedRunCount,
        missingRunCount: 0,
      },
      scores,
      blockingReasons: [{
        code: "qualification_contract_incomplete",
        missingContracts: ["aggregate_missing_report_metric"],
      }],
    };
  }

  const mapping = await loadCodingAgentCandidateDimensionMapping({ manifest, scorecard });
  const evidence = await loadCodingAgentCandidateDimensionEvidence({
    aggregateRoot,
    verifiedAggregate: { report, baselineIndex },
  });
  const scoreEvaluation = evaluateCodingAgentCandidateScores({
    report,
    mapping,
    evidence,
    scorecard,
  });
  if (scoreEvaluation.status === "failed") {
    throw new Error("Coding benchmark candidate score contract failed after all evidence completed.");
  }
  if (scoreEvaluation.status !== "passed") {
    const incompleteDimensions = evidence.dimensions
      .filter(({ status }) => status !== "complete")
      .map(({ id, status }) => ({ id, status }));
    const failedAggregateDimensionIds = scoreEvaluation.dimensions
      .filter(({ aggregateStatus }) => aggregateStatus === "failed")
      .map(({ id }) => id);
    return {
      schemaVersion: CODING_AGENT_CANDIDATE_QUALIFICATION_VERSION,
      status: "not_eligible",
      generatedAt: report.generatedAt,
      coverage: {
        expectedRunCount: coverage.expectedRunCount,
        collectedRunCount: coverage.collectedRunCount,
        missingRunCount: 0,
      },
      scores,
      blockingReasons: [incompleteDimensions.length > 0
        ? {
          code: "candidate_dimension_evidence_incomplete",
          dimensions: incompleteDimensions,
        }
        : {
          code: "candidate_dimension_aggregate_gate_failed",
          dimensionIds: failedAggregateDimensionIds,
        }],
    };
  }
  return createCodingAgentCandidateScoredDecision({
    generatedAt: report.generatedAt,
    coverage,
    scoreEvaluation,
  });
}

export function createCodingAgentCandidateScoredDecision(input) {
  if (input?.scoreEvaluation?.status !== "passed") {
    throw new Error("Coding benchmark candidate scored decision requires a passed evaluation.");
  }
  return {
    schemaVersion: CODING_AGENT_CANDIDATE_QUALIFICATION_VERSION,
    status: "eligible",
    generatedAt: input.generatedAt,
    coverage: {
      expectedRunCount: input.coverage.expectedRunCount,
      collectedRunCount: input.coverage.collectedRunCount,
      missingRunCount: 0,
    },
    scores: {
      dimensions: input.scoreEvaluation.dimensions.map((dimension) => ({
        id: dimension.id,
        score: dimension.score,
        minimum: dimension.minimum,
        weight: dimension.weight,
        status: "awarded",
      })),
      rawWeighted: input.scoreEvaluation.rawWeighted,
      rawWeightedMinimum: input.scoreEvaluation.rawWeightedMinimum,
      status: "scored",
    },
  };
}

export async function evaluateCandidateRunEventGates(input) {
  let incompleteTraceCount = 0;
  let incompleteProviderUsageCount = 0;
  for (const run of input.runs) {
    let events;
    let eventContract;
    try {
      const eventsText = await fs.readFile(path.resolve(input.aggregateRoot, run.artifacts.events), "utf-8");
      events = parseJsonl(eventsText);
      eventContract = validateAgentRunEvents(events, isAgentRunEventV1, {
        isCodingRunCapabilitiesV1,
        isCodingRunUsageCompletenessV1,
        expectedTracePolicy: CODING_RUN_TRACE_POLICY,
      });
    } catch {
      incompleteTraceCount += 1;
      incompleteProviderUsageCount += 1;
      continue;
    }

    const task = input.manifestTasksById.get(run.taskId);
    const localFixtureUsageIsComplete = await validateLocalFixtureUsageEvidence({
      aggregateRoot: input.aggregateRoot,
      task,
      run,
      events,
      eventContract,
    });
    const declaresLocalFixture = task?.modelExecution === CODING_AGENT_MODEL_EXECUTION_LOCAL_FIXTURE;
    if ((declaresLocalFixture && !localFixtureUsageIsComplete)
      || (!declaresLocalFixture && eventContract.usage.status !== "complete")) {
      incompleteProviderUsageCount += 1;
    }
    try {
      validateCodingRunTraceEvents(projectCodingRunTraceEvents(events));
    } catch {
      incompleteTraceCount += 1;
    }
  }
  return { incompleteTraceCount, incompleteProviderUsageCount };
}

async function validateLocalFixtureUsageEvidence(input) {
  const { task, run, events, eventContract } = input;
  if (task?.modelExecution !== CODING_AGENT_MODEL_EXECUTION_LOCAL_FIXTURE
    || run.execution?.modelExecution !== CODING_AGENT_MODEL_EXECUTION_LOCAL_FIXTURE
    || run.execution.maxCostUsd !== undefined
    || run.environment?.model?.provider !== CODING_AGENT_MODEL_EXECUTION_LOCAL_FIXTURE
    || run.environment.model.id !== task.fixture?.generatorId
    || run.environment.model.credentialsConfigured !== false
    || run.usage?.inputTokens !== null
    || run.usage?.outputTokens !== null
    || run.usage?.observation?.status !== "not_reached"
    || run.usage.observation.costUsd !== null
    || eventContract?.usage?.status !== "incomplete"
    || eventContract.usage.reason !== "usage_not_reported"
    || events.some((event) => event?.type === "run.usage")) {
    return false;
  }
  try {
    const preflight = JSON.parse(await fs.readFile(
      path.resolve(input.aggregateRoot, run.artifacts.preflight),
      "utf-8",
    ));
    if (preflight.status !== "passed"
      || preflight.checks?.pricing?.status !== "not_applicable"
      || preflight.checks.pricing.reason !== "fixture_provider") {
      return false;
    }
    if (run.taskId === "gateway.client-cancel") {
      const cancellation = JSON.parse(await fs.readFile(
        path.resolve(input.aggregateRoot, run.artifacts.cancelInjection),
        "utf-8",
      ));
      return eventContract.terminalType === "run.cancelled"
        && cancellation.status === "confirmed"
        && cancellation.cancellationRequestCount === 1
        && cancellation.terminalType === "run.cancelled";
    }
    if (run.taskId === "gateway.process-restart") {
      const restart = JSON.parse(await fs.readFile(
        path.resolve(input.aggregateRoot, run.artifacts.restartInjection),
        "utf-8",
      ));
      const terminal = events.at(-1);
      return eventContract.terminalType === "run.failed"
        && terminal?.payload?.error?.code === "gateway_unavailable"
        && restart.status === "confirmed"
        && restart.messageSendRequestCount === 1
        && restart.cleanup?.managedGatewayProcessCount === 0;
    }
  } catch {
    return false;
  }
  return false;
}

function parseJsonl(value) {
  const events = [];
  for (const line of value.split(/\r?\n/)) {
    if (!line.trim()) continue;
    events.push(JSON.parse(line));
  }
  return events;
}

function createReceiptInvalidReport(input) {
  return {
    schemaVersion: CODING_AGENT_CANDIDATE_QUALIFICATION_VERSION,
    status: "not_eligible",
    generatedAt: input.report.generatedAt,
    coverage: {
      expectedRunCount: input.coverage.expectedRunCount,
      collectedRunCount: input.coverage.collectedRunCount,
      missingRunCount: 0,
    },
    scores: input.scores,
    blockingReasons: [{
      code: "candidate_global_receipt_invalid",
      path: input.receipt.path,
      reason: input.reason,
      ...(input.mismatchedFields ? { mismatchedFields: input.mismatchedFields } : {}),
      ...(input.platforms ? { platforms: input.platforms } : {}),
      ...(input.unreadableFileCount !== undefined
        ? { unreadableFileCount: input.unreadableFileCount }
        : {}),
    }],
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function loadCandidateGlobalReceiptValidator() {
  const schemaPath = path.resolve(
    import.meta.dirname,
    "..",
    "benchmarks",
    "coding-agent",
    "v3",
    "candidate-global-receipt.schema.json",
  );
  const schema = JSON.parse(await fs.readFile(schemaPath, "utf-8"));
  const compiled = compileOutputSchema(schema);
  if (!compiled.ok) {
    throw new Error("Coding benchmark candidate-global receipt schema is invalid.");
  }
  return compiled.validator;
}

function requireTimestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Coding benchmark candidate-global receipt requires ${label}.`);
  }
  return value;
}

function requireInput(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Coding benchmark candidate qualification requires ${label}.`);
  }
  return value;
}
