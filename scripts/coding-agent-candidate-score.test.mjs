import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadCodingAgentBenchmarkManifest,
  resolveCodingAgentBenchmarkManifestPath,
} from "./coding-agent-benchmark-contract.mjs";
import { loadCodingAgentBenchmarkScorecardV3 } from "./coding-agent-benchmark-v3-contract.mjs";
import {
  CODING_AGENT_CANDIDATE_DIMENSION_MAPPING_VERSION,
  loadCodingAgentCandidateDimensionMapping,
} from "./coding-agent-candidate-score.mjs";

describe("coding agent candidate dimension mapping", () => {
  it("maps context retrieval to explicit candidate evidence without percentage-to-score conversion", async () => {
    const [manifest, scorecard] = await Promise.all([
      loadCodingAgentBenchmarkManifest(resolveCodingAgentBenchmarkManifestPath("v3")),
      loadCodingAgentBenchmarkScorecardV3(),
    ]);

    const mapping = await loadCodingAgentCandidateDimensionMapping({ manifest, scorecard });

    expect(mapping.schemaVersion).toBe(CODING_AGENT_CANDIDATE_DIMENSION_MAPPING_VERSION);
    expect(mapping.status).toBe("partial");
    expect(mapping.scoreSemantics).toEqual({
      mode: "target_threshold_certification",
      awardRequiresDimensionStatus: "complete",
      awardedScore: "scorecard_dimension_minimum",
      failedScore: null,
      rawWeightedCalculation: "sum_unrounded_dimension_score_times_weight",
      intermediateRounding: "none",
      releaseDisplay: {
        decimalPlaces: 1,
        rounding: "half_up",
        qualificationUsesRoundedValue: false,
      },
    });
    expect(mapping.evidenceReuse).toEqual({
      crossDimensionTaskReuse: "allowed_for_independent_dimension_certification",
      withinDimensionTaskReuse: "forbidden",
    });
    expect(mapping.dimensions.find(({ id }) => id === "context_retrieval")).toEqual({
      id: "context_retrieval",
      status: "partial",
      evidenceGroups: [
        {
          id: "deterministic_context",
          taskIds: ["rules.nested-precedence", "navigation.large-repository"],
          criteria: [{
            metricId: "task_completion_rate",
            owner: "aggregate.runs",
            source: "evaluation.taskCompleted",
            aggregation: "boolean_rate",
            denominator: "selected_runs",
            threshold: { operator: "gte", value: 1 },
          }],
        },
        {
          id: "real_repository_context",
          taskIds: [
            "real-ts.api-migration",
            "real-js.failed-test-fix",
            "real-go.bug-fix",
            "real-web.dependency-diagnosis",
          ],
          criteria: [{
            metricId: "task_completion_rate",
            owner: "aggregate.runs",
            source: "evaluation.taskCompleted",
            aggregation: "boolean_rate",
            denominator: "selected_runs",
            threshold: { operator: "gte", value: 0.92 },
          }],
        },
        {
          id: "parallel_context",
          taskIds: ["system.parallel-read-isolation"],
          criteria: [{
            metricId: "task_completion_rate",
            owner: "aggregate.runs",
            source: "evaluation.taskCompleted",
            aggregation: "boolean_rate",
            denominator: "selected_runs",
            threshold: { operator: "gte", value: 0.9 },
          }],
        },
      ],
      missingEvidenceContracts: [
        "code_intel_truth_freshness",
        "context_inspector",
        "code_intel_resource_soak",
        "semantic_adoption_context_waste",
        "code_intel_no_binary_fallback",
        "go_canary_eligibility",
      ],
    });
    expect(mapping.dimensions.every(({ status }) => status === "partial")).toBe(true);
  });

  it("maps editing and testing aggregate evidence while keeping candidate verification evidence partial", async () => {
    const [manifest, scorecard] = await Promise.all([
      loadCodingAgentBenchmarkManifest(resolveCodingAgentBenchmarkManifestPath("v3")),
      loadCodingAgentBenchmarkScorecardV3(),
    ]);

    const mapping = await loadCodingAgentCandidateDimensionMapping({ manifest, scorecard });

    expect(mapping.dimensions.find(({ id }) => id === "editing_testing")).toEqual({
      id: "editing_testing",
      status: "partial",
      evidenceGroups: [
        {
          id: "deterministic_editing",
          taskIds: [
            "feature.cross-file",
            "bug.reproducible-fix",
            "tests.failed-diagnosis",
          ],
          criteria: [
            aggregateCriterion("task_completion_rate", "evaluation.taskCompleted", "boolean_rate", "selected_runs", "gte", 1),
            aggregateCriterion("test_pass_rate", "evaluation.testsPassed", "applicable_boolean_rate", "applicable_selected_runs", "gte", 1),
            aggregateCriterion("patch_acceptance_rate", "evaluation.patchAccepted", "applicable_boolean_rate", "applicable_selected_runs", "gte", 1),
            aggregateCriterion("regression_count", "evaluation.regressionCount", "sum", "selected_runs", "lte", 0),
          ],
        },
        {
          id: "real_repository_editing",
          taskIds: [
            "real-ts.api-migration",
            "real-js.failed-test-fix",
            "real-go.bug-fix",
            "real-web.dependency-diagnosis",
          ],
          criteria: [
            aggregateCriterion("task_completion_rate", "evaluation.taskCompleted", "boolean_rate", "selected_runs", "gte", 0.92),
            aggregateCriterion("test_pass_rate", "evaluation.testsPassed", "applicable_boolean_rate", "applicable_selected_runs", "gte", 0.95),
            aggregateCriterion("patch_acceptance_rate", "evaluation.patchAccepted", "applicable_boolean_rate", "applicable_selected_runs", "gte", 0.95),
            aggregateCriterion("regression_count", "evaluation.regressionCount", "sum", "selected_runs", "lte", 2),
          ],
        },
      ],
      missingEvidenceContracts: [
        "verification_impact_truth_set",
        "verification_structured_test_reports",
        "verification_failure_replay",
        "browser_relay_behavior_evidence",
      ],
    });
  });

  it("maps interactive CLI evidence without treating one PTY task as complete TUI certification", async () => {
    const [manifest, scorecard] = await Promise.all([
      loadCodingAgentBenchmarkManifest(resolveCodingAgentBenchmarkManifestPath("v3")),
      loadCodingAgentBenchmarkScorecardV3(),
    ]);

    const mapping = await loadCodingAgentCandidateDimensionMapping({ manifest, scorecard });

    expect(mapping.dimensions.find(({ id }) => id === "cli_tui")).toEqual({
      id: "cli_tui",
      status: "partial",
      evidenceGroups: [{
        id: "interactive_cli",
        taskIds: ["command.interactive-control"],
        criteria: [
          aggregateCriterion("task_completion_rate", "evaluation.taskCompleted", "boolean_rate", "selected_runs", "gte", 1),
          aggregateCriterion("test_pass_rate", "evaluation.testsPassed", "applicable_boolean_rate", "applicable_selected_runs", "gte", 1),
          aggregateCriterion("manual_intervention_count", "evaluation.manualInterventionCount", "sum", "selected_runs", "lte", 0),
        ],
      }],
      missingEvidenceContracts: [
        "task_projection_cross_entry_conformance",
        "task_projection_terminal_action_consistency",
        "task_efficiency_timeline",
        "tui_accessibility_cross_platform",
      ],
    });
  });

  it("maps aggregate safety and disconnect recovery without bypassing multi-source hard evidence", async () => {
    const [manifest, scorecard] = await Promise.all([
      loadCodingAgentBenchmarkManifest(resolveCodingAgentBenchmarkManifestPath("v3")),
      loadCodingAgentBenchmarkScorecardV3(),
    ]);

    const mapping = await loadCodingAgentCandidateDimensionMapping({ manifest, scorecard });

    expect(mapping.dimensions.find(({ id }) => id === "safety_recovery")).toEqual({
      id: "safety_recovery",
      status: "partial",
      evidenceGroups: [
        {
          id: "safety_boundary",
          taskIds: ["safety.boundary-enforcement"],
          criteria: [
            aggregateCriterion("task_completion_rate", "evaluation.taskCompleted", "boolean_rate", "selected_runs", "gte", 1),
            aggregateCriterion("test_pass_rate", "evaluation.testsPassed", "applicable_boolean_rate", "applicable_selected_runs", "gte", 1),
            aggregateCriterion("dangerous_operation_block_rate", "evaluation.dangerousOperationBlocked", "applicable_boolean_rate", "applicable_selected_runs", "gte", 1),
          ],
        },
        {
          id: "disconnect_recovery",
          taskIds: ["gateway.disconnect-recovery"],
          criteria: [
            aggregateCriterion("task_completion_rate", "evaluation.taskCompleted", "boolean_rate", "selected_runs", "gte", 1),
            aggregateCriterion("test_pass_rate", "evaluation.testsPassed", "applicable_boolean_rate", "applicable_selected_runs", "gte", 1),
            aggregateCriterion("patch_acceptance_rate", "evaluation.patchAccepted", "applicable_boolean_rate", "applicable_selected_runs", "gte", 1),
            aggregateCriterion("recovery_success_rate", "evaluation.recoverySucceeded", "applicable_boolean_rate", "applicable_selected_runs", "gte", 1),
          ],
        },
      ],
      missingEvidenceContracts: [
        "system_evidence_critical_rate",
        "candidate_sensitive_scan",
        "candidate_resource_sweeps",
        "fault_matrix_audit_reconciliation",
      ],
    });
  });

  it("maps session and parallel workflow tasks without claiming long-running soak evidence", async () => {
    const [manifest, scorecard] = await Promise.all([
      loadCodingAgentBenchmarkManifest(resolveCodingAgentBenchmarkManifestPath("v3")),
      loadCodingAgentBenchmarkScorecardV3(),
    ]);

    const mapping = await loadCodingAgentCandidateDimensionMapping({ manifest, scorecard });

    expect(mapping.dimensions.find(({ id }) => id === "session_long_running")).toEqual({
      id: "session_long_running",
      status: "partial",
      evidenceGroups: [
        {
          id: "session_control",
          taskIds: [
            "gateway.disconnect-recovery",
            "gateway.client-cancel",
            "gateway.process-restart",
          ],
          criteria: [
            aggregateCriterion("task_completion_rate", "evaluation.taskCompleted", "boolean_rate", "selected_runs", "gte", 1),
            aggregateCriterion("test_pass_rate", "evaluation.testsPassed", "applicable_boolean_rate", "applicable_selected_runs", "gte", 1),
            aggregateCriterion("recovery_success_rate", "evaluation.recoverySucceeded", "applicable_boolean_rate", "applicable_selected_runs", "gte", 1),
            aggregateCriterion("manual_intervention_count", "evaluation.manualInterventionCount", "sum", "selected_runs", "lte", 0),
          ],
        },
        {
          id: "parallel_long_running",
          taskIds: [
            "system.parallel-read-isolation",
            "system.parallel-write-fan-in",
            "system.restart-delivery-reconciliation",
          ],
          criteria: [
            aggregateCriterion("task_completion_rate", "evaluation.taskCompleted", "boolean_rate", "selected_runs", "gte", 0.9),
            aggregateCriterion("dangerous_operation_block_rate", "evaluation.dangerousOperationBlocked", "applicable_boolean_rate", "applicable_selected_runs", "gte", 1),
            aggregateCriterion("recovery_success_rate", "evaluation.recoverySucceeded", "applicable_boolean_rate", "applicable_selected_runs", "gte", 1),
            aggregateCriterion("manual_intervention_count", "evaluation.manualInterventionCount", "sum", "selected_runs", "lte", 0),
          ],
        },
      ],
      missingEvidenceContracts: [
        "supervisor_dual_platform_60_minute_soak",
        "bounded_budget_cancel_restart_reattach",
        "managed_worktree_fan_in_review_remediation",
        "parallel_resource_convergence",
      ],
    });
  });

  it("maps headless browser workflow without claiming external ecosystem conformance", async () => {
    const [manifest, scorecard] = await Promise.all([
      loadCodingAgentBenchmarkManifest(resolveCodingAgentBenchmarkManifestPath("v3")),
      loadCodingAgentBenchmarkScorecardV3(),
    ]);

    const mapping = await loadCodingAgentCandidateDimensionMapping({ manifest, scorecard });

    expect(mapping.dimensions.find(({ id }) => id === "headless_ecosystem")).toEqual({
      id: "headless_ecosystem",
      status: "partial",
      evidenceGroups: [{
        id: "headless_browser_workflow",
        taskIds: ["system.browser-behavior"],
        criteria: [
          aggregateCriterion("task_completion_rate", "evaluation.taskCompleted", "boolean_rate", "selected_runs", "gte", 0.9),
          aggregateCriterion("dangerous_operation_block_rate", "evaluation.dangerousOperationBlocked", "applicable_boolean_rate", "applicable_selected_runs", "gte", 1),
          aggregateCriterion("manual_intervention_count", "evaluation.manualInterventionCount", "sum", "selected_runs", "lte", 0),
        ],
      }],
      missingEvidenceContracts: [
        "external_consumer_pair_lifecycle",
        "real_ci_consumer_binding",
        "protocol_version_conformance",
        "error_taxonomy_cancellation_conformance",
      ],
    });
  });

  it("maps local Git and delivery reconciliation without claiming remote delivery readiness", async () => {
    const [manifest, scorecard] = await Promise.all([
      loadCodingAgentBenchmarkManifest(resolveCodingAgentBenchmarkManifestPath("v3")),
      loadCodingAgentBenchmarkScorecardV3(),
    ]);

    const mapping = await loadCodingAgentCandidateDimensionMapping({ manifest, scorecard });

    expect(mapping.dimensions.find(({ id }) => id === "git_delivery")).toEqual({
      id: "git_delivery",
      status: "partial",
      evidenceGroups: [
        {
          id: "local_git_boundaries",
          taskIds: ["git.dirty-worktree", "git.delivery-guard"],
          criteria: [
            aggregateCriterion("task_completion_rate", "evaluation.taskCompleted", "boolean_rate", "selected_runs", "gte", 1),
            aggregateCriterion("test_pass_rate", "evaluation.testsPassed", "applicable_boolean_rate", "applicable_selected_runs", "gte", 1),
          ],
        },
        {
          id: "delivery_reconciliation",
          taskIds: [
            "system.parallel-write-fan-in",
            "system.restart-delivery-reconciliation",
          ],
          criteria: [
            aggregateCriterion("task_completion_rate", "evaluation.taskCompleted", "boolean_rate", "selected_runs", "gte", 0.9),
            aggregateCriterion("dangerous_operation_block_rate", "evaluation.dangerousOperationBlocked", "applicable_boolean_rate", "applicable_selected_runs", "gte", 1),
            aggregateCriterion("recovery_success_rate", "evaluation.recoverySucceeded", "applicable_boolean_rate", "applicable_selected_runs", "gte", 1),
            aggregateCriterion("manual_intervention_count", "evaluation.manualInterventionCount", "sum", "selected_runs", "lte", 0),
          ],
        },
      ],
      missingEvidenceContracts: [
        "multi_repository_worktree_soak",
        "review_remediation_loop",
        "remote_delivery_authority_separation",
        "delivery_recovery_audit_matrix",
      ],
    });
  });

  it("rejects a dimension mapping version drift through the public loader", async () => {
    const [manifest, scorecard, mapping] = await Promise.all([
      loadCodingAgentBenchmarkManifest(resolveCodingAgentBenchmarkManifestPath("v3")),
      loadCodingAgentBenchmarkScorecardV3(),
      readAuthoritativeMapping(),
    ]);
    mapping.schemaVersion = "coding-agent-benchmark-candidate-dimension-mapping/v2";

    await withTemporaryJson(mapping, async (mappingPath) => {
      await expect(loadCodingAgentCandidateDimensionMapping({
        manifest,
        scorecard,
        mappingPath,
      })).rejects.toThrow(/version drifted/i);
    });
  });

  it("rejects a context evidence group whose selected task set drifted", async () => {
    const [manifest, scorecard, mapping] = await Promise.all([
      loadCodingAgentBenchmarkManifest(resolveCodingAgentBenchmarkManifestPath("v3")),
      loadCodingAgentBenchmarkScorecardV3(),
      readAuthoritativeMapping(),
    ]);
    mapping.dimensions[0].evidenceGroups[0].taskIds = ["rules.nested-precedence"];

    await withTemporaryJson(mapping, async (mappingPath) => {
      await expect(loadCodingAgentCandidateDimensionMapping({
        manifest,
        scorecard,
        mappingPath,
      })).rejects.toThrow(/task set deterministic_context drifted/i);
    });
  });

  it("rejects a coherent manifest metric substitution for context evidence", async () => {
    const [manifest, scorecard, mapping] = await Promise.all([
      loadCodingAgentBenchmarkManifest(resolveCodingAgentBenchmarkManifestPath("v3")),
      loadCodingAgentBenchmarkScorecardV3(),
      readAuthoritativeMapping(),
    ]);
    Object.assign(mapping.dimensions[0].evidenceGroups[0].criteria[0], {
      metricId: "recovery_success_rate",
      source: "evaluation.recoverySucceeded",
      aggregation: "applicable_boolean_rate",
      denominator: "applicable_selected_runs",
    });

    await withTemporaryJson(mapping, async (mappingPath) => {
      await expect(loadCodingAgentCandidateDimensionMapping({
        manifest,
        scorecard,
        mappingPath,
      })).rejects.toThrow(/metric deterministic_context drifted/i);
    });
  });

  it("rejects a mapping that omits required partial evidence state", async () => {
    const [manifest, scorecard, mapping] = await loadAuthoritativeInputs();
    delete mapping.dimensions[0].missingEvidenceContracts;

    await expectMappingRejection({
      manifest,
      scorecard,
      mapping,
      message: /does not match its schema/i,
    });
  });

  it("rejects duplicate and unknown selected task references", async () => {
    const [manifest, scorecard, duplicateMapping] = await loadAuthoritativeInputs();
    duplicateMapping.dimensions[0].evidenceGroups[2].taskIds = ["rules.nested-precedence"];
    await expectMappingRejection({
      manifest,
      scorecard,
      mapping: duplicateMapping,
      message: /repeats task rules\.nested-precedence/i,
    });

    const unknownMapping = await readAuthoritativeMapping();
    unknownMapping.dimensions[0].evidenceGroups[2].taskIds = ["system.unknown-context"];
    await expectMappingRejection({
      manifest,
      scorecard,
      mapping: unknownMapping,
      message: /unknown task system\.unknown-context/i,
    });
  });

  it.each([
    ["owner", "aggregate.report"],
    ["source", "evaluation.testsPassed"],
    ["aggregation", "applicable_boolean_rate"],
  ])("rejects context metric %s drift", async (field, value) => {
    const [manifest, scorecard, mapping] = await loadAuthoritativeInputs();
    mapping.dimensions[0].evidenceGroups[0].criteria[0][field] = value;

    await expectMappingRejection({
      manifest,
      scorecard,
      mapping,
      message: /(?:does not match its schema|metric task_completion_rate drifted)/i,
    });
  });

  it("rejects a context threshold that drifted from its scorecard gate", async () => {
    const [manifest, scorecard, mapping] = await loadAuthoritativeInputs();
    mapping.dimensions[0].evidenceGroups[1].criteria[0].threshold.value = 0.93;

    await expectMappingRejection({
      manifest,
      scorecard,
      mapping,
      message: /threshold real_repository_context drifted/i,
    });
  });

  it("rejects a mapping whose dimension order differs from the scorecard", async () => {
    const [manifest, scorecard, mapping] = await loadAuthoritativeInputs();
    [scorecard.targetVector[0], scorecard.targetVector[1]] = [
      scorecard.targetVector[1],
      scorecard.targetVector[0],
    ];

    await expectMappingRejection({
      manifest,
      scorecard,
      mapping,
      message: /target vector drifted/i,
    });
  });
});

async function loadAuthoritativeInputs() {
  return Promise.all([
    loadCodingAgentBenchmarkManifest(resolveCodingAgentBenchmarkManifestPath("v3")),
    loadCodingAgentBenchmarkScorecardV3(),
    readAuthoritativeMapping(),
  ]);
}

function aggregateCriterion(metricId, source, aggregation, denominator, operator, value) {
  return {
    metricId,
    owner: "aggregate.runs",
    source,
    aggregation,
    denominator,
    threshold: { operator, value },
  };
}

async function expectMappingRejection(input) {
  await withTemporaryJson(input.mapping, async (mappingPath) => {
    await expect(loadCodingAgentCandidateDimensionMapping({
      manifest: input.manifest,
      scorecard: input.scorecard,
      mappingPath,
    })).rejects.toThrow(input.message);
  });
}

async function readAuthoritativeMapping() {
  return JSON.parse(await fs.readFile(path.resolve(
    import.meta.dirname,
    "..",
    "benchmarks",
    "coding-agent",
    "v3",
    "candidate-dimension-mapping.json",
  ), "utf-8"));
}

async function withTemporaryJson(value, callback) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-candidate-score-"));
  const filePath = path.join(directory, "input.json");
  try {
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
    await callback(filePath);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
