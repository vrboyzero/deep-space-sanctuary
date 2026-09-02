export const CODING_AGENT_CANDIDATE_SCORE_EVALUATION_VERSION =
  "coding-agent-benchmark-candidate-score-evaluation/v1";

const EXPECTED_DIMENSION_IDS = Object.freeze([
  "context_retrieval",
  "editing_testing",
  "cli_tui",
  "safety_recovery",
  "session_long_running",
  "headless_ecosystem",
  "git_delivery",
]);

export function evaluateCodingAgentCandidateScores(input) {
  const report = requireObject(input?.report, "report");
  const mapping = requireObject(input?.mapping, "mapping");
  const evidence = requireObject(input?.evidence, "evidence");
  const scorecard = requireObject(input?.scorecard, "scorecard");
  validateInputBindings({ report, mapping, evidence, scorecard });
  const evidenceByDimension = new Map(
    requireArray(evidence.dimensions, "evidence.dimensions").map((dimension) => [
      dimension.id,
      dimension,
    ]),
  );
  const scorecardByDimension = new Map(
    requireArray(scorecard.targetVector, "scorecard.targetVector").map((dimension) => [
      dimension.id,
      dimension,
    ]),
  );

  const dimensions = requireArray(mapping.dimensions, "mapping.dimensions").map((dimension) => {
    const target = scorecardByDimension.get(dimension.id);
    const dimensionEvidence = evidenceByDimension.get(dimension.id);
    if (!target || !dimensionEvidence) {
      throw new Error(`Coding benchmark candidate score dimension ${dimension.id} drifted.`);
    }
    const evidenceStatus = requireStatus(dimensionEvidence.status, "dimension evidence");
    const groups = dimension.evidenceGroups.map((group) => {
      const selectedRuns = report.runs.filter((run) => group.taskIds.includes(run.taskId));
      if (selectedRuns.length === 0) {
        throw new Error(`Coding benchmark candidate score group ${group.id} selected no runs.`);
      }
      const criteria = group.criteria.map((criterion) => {
        return evaluateCriterion(selectedRuns, criterion);
      });
      return {
        id: group.id,
        status: criteria.every(({ passed }) => passed) ? "passed" : "failed",
        criteria,
      };
    });
    const aggregateStatus = groups.every(({ status }) => status === "passed")
      ? "passed"
      : "failed";
    const awarded = evidenceStatus === "complete" && aggregateStatus === "passed";
    return {
      id: dimension.id,
      evidenceStatus,
      aggregateStatus,
      groups,
      score: awarded ? target.minimum : null,
      minimum: target.minimum,
      weight: target.weight,
      status: awarded ? "awarded" : "unscored",
    };
  });

  const allAwarded = dimensions.every(({ status }) => status === "awarded");
  const rawWeighted = allAwarded
    ? sumDecimalProducts(dimensions.map((dimension) => [dimension.score, dimension.weight]))
    : null;
  const rawWeightedPassed = rawWeighted !== null
    && rawWeighted >= scorecard.rawWeightedMinimum;

  return {
    schemaVersion: CODING_AGENT_CANDIDATE_SCORE_EVALUATION_VERSION,
    status: !allAwarded
      ? "unscored"
      : rawWeightedPassed ? "passed" : "failed",
    dimensions,
    rawWeighted,
    rawWeightedMinimum: scorecard.rawWeightedMinimum,
    rawWeightedPassed,
  };
}

function validateInputBindings(input) {
  if (input.report.schemaVersion !== "coding-agent-benchmark-report/v3"
    || input.mapping.schemaVersion !== "coding-agent-benchmark-candidate-dimension-mapping/v1"
    || input.evidence.schemaVersion
      !== "coding-agent-benchmark-candidate-dimension-evidence-resolution/v1"
    || input.scorecard.schemaVersion !== "coding-agent-benchmark-scorecard/v3") {
    throw new Error("Coding benchmark candidate score input version drifted.");
  }
  for (const [label, dimensions] of [
    ["mapping", input.mapping.dimensions],
    ["evidence", input.evidence.dimensions],
    ["scorecard", input.scorecard.targetVector],
  ]) {
    const ids = requireArray(dimensions, `${label}.dimensions`).map(({ id }) => id);
    if (JSON.stringify(ids) !== JSON.stringify(EXPECTED_DIMENSION_IDS)) {
      throw new Error(`Coding benchmark candidate score ${label} dimension order drifted.`);
    }
  }
}

function sumDecimalProducts(products) {
  const terms = products.map(([left, right]) => {
    const leftDecimal = toDecimalInteger(left);
    const rightDecimal = toDecimalInteger(right);
    return {
      integer: leftDecimal.integer * rightDecimal.integer,
      scale: leftDecimal.scale + rightDecimal.scale,
    };
  });
  const scale = Math.max(...terms.map((term) => term.scale));
  const integer = terms.reduce((sum, term) => {
    return sum + (term.integer * (10n ** BigInt(scale - term.scale)));
  }, 0n);
  return Number(integer) / (10 ** scale);
}

function toDecimalInteger(value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Coding benchmark candidate score requires a non-negative decimal.");
  }
  const text = String(value);
  if (/e/i.test(text)) {
    throw new Error("Coding benchmark candidate score does not accept exponential decimals.");
  }
  const [whole, fraction = ""] = text.split(".");
  return {
    integer: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  };
}

function evaluateCriterion(runs, criterion) {
  const values = runs.map((run) => readSource(run, criterion.source));
  let numerator;
  let denominator;
  let observed;
  if (criterion.aggregation === "boolean_rate") {
    denominator = values.length;
    numerator = values.filter((value) => value === true).length;
    observed = numerator / denominator;
  } else if (criterion.aggregation === "applicable_boolean_rate") {
    const applicable = values.filter((value) => value !== null);
    denominator = applicable.length;
    numerator = applicable.filter((value) => value === true).length;
    observed = denominator === 0 ? 0 : numerator / denominator;
  } else if (criterion.aggregation === "sum") {
    denominator = values.length;
    numerator = values.reduce((sum, value) => sum + requireNumber(value, criterion.source), 0);
    observed = numerator;
  } else {
    throw new Error(
      `Coding benchmark candidate score aggregation ${criterion.aggregation} is unsupported.`,
    );
  }
  const passed = criterion.threshold.operator === "gte"
    ? observed >= criterion.threshold.value
    : observed <= criterion.threshold.value;
  return {
    metricId: criterion.metricId,
    aggregation: criterion.aggregation,
    numerator,
    denominator,
    observed,
    threshold: structuredClone(criterion.threshold),
    passed,
  };
}

function readSource(run, source) {
  const segments = source.split(".");
  let value = run;
  for (const segment of segments) value = value?.[segment];
  if (value === undefined) {
    throw new Error(`Coding benchmark candidate score source ${source} is missing.`);
  }
  return value;
}

function requireStatus(value, label) {
  if (!["partial", "failed", "complete"].includes(value)) {
    throw new Error(`Coding benchmark candidate score ${label} status drifted.`);
  }
  return value;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Coding benchmark candidate score requires ${label}.`);
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`Coding benchmark candidate score requires ${label}.`);
  }
  return value;
}

function requireNumber(value, label) {
  if (!Number.isFinite(value)) {
    throw new Error(`Coding benchmark candidate score requires numeric ${label}.`);
  }
  return value;
}
