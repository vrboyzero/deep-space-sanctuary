import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";

import {
  CODING_AGENT_BENCHMARK_MANIFEST_VERSION,
  CODING_AGENT_BENCHMARK_REPORT_VERSION,
  createCodingAgentBenchmarkReport,
  hashCodingAgentBenchmarkManifestText,
  loadCodingAgentBenchmarkManifest,
  validateCodingAgentBenchmarkManifest,
} from "./coding-agent-benchmark-contract.mjs";

const EXPECTED_TASK_CATEGORIES = [
  "project_rules",
  "cross_file_feature",
  "bug_fix",
  "test_diagnosis",
  "large_repo_navigation",
  "interactive_command",
  "safety_boundary",
  "gateway_recovery",
  "gateway_client_cancellation",
  "gateway_process_restart",
  "git_dirty_worktree",
  "git_delivery_guard",
];
const EXPECTED_FAILURE_CATEGORIES = [
  "model",
  "tool",
  "permission",
  "platform",
  "product_workflow",
  "infrastructure",
  "fixture",
  "evaluator",
];
const EXPECTED_METRICS = [
  "task_completion_rate",
  "test_pass_rate",
  "patch_acceptance_rate",
  "regression_count",
  "manual_intervention_count",
  "dangerous_operation_block_rate",
  "recovery_success_rate",
  "duration_ms",
  "input_tokens",
  "output_tokens",
];

describe("coding agent benchmark contract", () => {
  it("hashes manifest text independently of platform line endings", () => {
    const lf = "{\n  \"schemaVersion\": \"coding-agent-benchmark-manifest/v2\"\n}\n";
    const crlf = lf.replaceAll("\n", "\r\n");
    const cr = lf.replaceAll("\n", "\r");

    expect(hashCodingAgentBenchmarkManifestText(crlf)).toBe(hashCodingAgentBenchmarkManifestText(lf));
    expect(hashCodingAgentBenchmarkManifestText(cr)).toBe(hashCodingAgentBenchmarkManifestText(lf));
  });

  it("loads a versioned task manifest that freezes the complete stage 0A task surface", async () => {
    const manifest = await loadCodingAgentBenchmarkManifest();

    expect(manifest.schemaVersion).toBe(CODING_AGENT_BENCHMARK_MANIFEST_VERSION);
    expect(manifest.suite).toMatchObject({
      id: "ss-project-coding-v1",
      sampleRuns: 3,
      artifactSchemaVersion: "coding-agent-benchmark-run/v1",
      reportSchemaVersion: CODING_AGENT_BENCHMARK_REPORT_VERSION,
      requiredPlatforms: ["windows-native", "wsl2-linux"],
      budgets: {
        timeoutMs: 300_000,
        maxTurns: 12,
        maxTokens: 24_000,
      },
      retryPolicy: {
        maxInfrastructureRetries: 1,
        retryModelFailures: false,
      },
    });
    expect(manifest.suite.executionProfiles).toEqual({
      plan: {
        permissionMode: "plan",
        toolAllow: ["file_read", "list_files"],
        toolDeny: ["run_command", "spawn_subagent"],
      },
      "navigation-read": {
        permissionMode: "plan",
        toolAllow: ["file_read", "list_files", "text_search", "file_glob"],
        toolDeny: ["run_command", "spawn_subagent"],
      },
      "workspace-write": {
        permissionMode: "acceptEdits",
        toolAllow: ["file_read", "list_files", "apply_patch", "file_write", "file_delete"],
        toolDeny: ["run_command", "spawn_subagent"],
      },
      "command-control": {
        permissionMode: "confirm",
        toolAllow: ["file_read", "list_files", "run_command"],
        toolDeny: ["spawn_subagent"],
      },
      "safety-probe": {
        permissionMode: "confirm",
        toolAllow: ["file_read", "list_files", "run_command"],
        toolDeny: ["spawn_subagent"],
      },
      "recovery-control": {
        permissionMode: "acceptEdits",
        toolAllow: ["file_read", "list_files", "apply_patch", "file_write"],
        toolDeny: ["run_command", "spawn_subagent", "file_delete"],
      },
      "git-local": {
        permissionMode: "confirm",
        toolAllow: ["file_read", "list_files", "run_command"],
        toolDeny: ["spawn_subagent", "apply_patch", "file_write", "file_delete"],
      },
    });
    expect(manifest.tasks).toHaveLength(12);
    expect(manifest.tasks.map((task) => task.category).sort()).toEqual(
      [...EXPECTED_TASK_CATEGORIES].sort(),
    );
    expect(new Set(manifest.tasks.map((task) => task.id)).size).toBe(manifest.tasks.length);
    expect(manifest.failureTaxonomy.map((item) => item.id)).toEqual(EXPECTED_FAILURE_CATEGORIES);
    expect(manifest.metrics.map((item) => item.id)).toEqual(EXPECTED_METRICS);
    expect(manifest.metrics.find((item) => item.id === "test_pass_rate")).toMatchObject({
      aggregation: "applicable_boolean_rate",
      source: "evaluation.testsPassed",
    });
    expect(manifest.metrics.find((item) => item.id === "dangerous_operation_block_rate")).toMatchObject({
      aggregation: "applicable_boolean_rate",
      source: "evaluation.dangerousOperationBlocked",
    });
    for (const task of manifest.tasks) {
      expect(task.fixture.generatorId).toMatch(/-v1$/);
      expect(task.fixture).toMatchObject({ version: 1, resetStrategy: "regenerate" });
      expect(task.prompt.trim().length).toBeGreaterThan(20);
      expect(task.evaluator).toMatchObject({ kind: "machine" });
      expect(task.evaluator.id).toMatch(/-v1$/);
      expect(task.platforms.length).toBeGreaterThan(0);
      expect(task.acceptance).toMatchObject({
        testCommands: expect.any(Array),
        requiredChangedPaths: expect.any(Array),
        allowedChangedPaths: expect.any(Array),
        forbiddenActions: expect.arrayContaining([
          "network_access",
          "external_path_write",
          "remote_git_write",
          "evidence_delete",
        ]),
      });
    }

    const rulesTask = manifest.tasks.find((task) => task.id === "rules.nested-precedence");
    expect(rulesTask.acceptance).toMatchObject({
      testCommands: [],
      requiredChangedPaths: [],
      allowedChangedPaths: [],
    });
    expect(rulesTask.acceptance.forbiddenActions).toContain("workspace_mutation");

    const featureTask = manifest.tasks.find((task) => task.id === "feature.cross-file");
    expect(featureTask.acceptance).toMatchObject({
      testCommands: [{ command: "node --test tests/feature.test.mjs", expectedExitCode: 0 }],
      requiredChangedPaths: ["src/feature.mjs", "src/index.mjs"],
      allowedChangedPaths: ["src/feature.mjs", "src/index.mjs"],
    });

    const diagnosisTask = manifest.tasks.find((task) => task.id === "tests.failed-diagnosis");
    expect(diagnosisTask.acceptance.testCommands).toEqual([
      { command: "node --test tests/failing.test.mjs", expectedExitCode: 1 },
    ]);

    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toMatch(/"(?:apiKey|accessToken|secret|password|authorization|cookie|sessionToken)"/i);
  });

  it("rejects ambiguous task identity, incomplete coverage, and credential fields", async () => {
    const manifest = await loadCodingAgentBenchmarkManifest();

    const duplicate = structuredClone(manifest);
    duplicate.tasks[1].id = duplicate.tasks[0].id;
    expect(() => validateCodingAgentBenchmarkManifest(duplicate)).toThrow(/duplicate.*task id/i);

    const incomplete = structuredClone(manifest);
    incomplete.tasks = incomplete.tasks.filter((task) => task.category !== "safety_boundary");
    expect(() => validateCodingAgentBenchmarkManifest(incomplete)).toThrow(/missing task category safety_boundary/i);

    const credentialBearing = structuredClone(manifest);
    credentialBearing.suite.apiKey = "must-not-be-persisted";
    expect(() => validateCodingAgentBenchmarkManifest(credentialBearing)).toThrow(/credential field/i);
  });

  it("rejects in-memory manifests that drift from the frozen v1 execution matrix", async () => {
    const manifest = await loadCodingAgentBenchmarkManifest();

    const sampleRunsDrift = structuredClone(manifest);
    sampleRunsDrift.suite.sampleRuns = 4;
    expect(() => validateCodingAgentBenchmarkManifest(sampleRunsDrift)).toThrow(/sampleRuns.*3/i);

    const budgetDrift = structuredClone(manifest);
    budgetDrift.suite.budgets.maxTurns = 13;
    expect(() => validateCodingAgentBenchmarkManifest(budgetDrift)).toThrow(/budgets.*frozen/i);

    const profileDrift = structuredClone(manifest);
    profileDrift.tasks[0].executionProfile = "unrestricted";
    expect(() => validateCodingAgentBenchmarkManifest(profileDrift)).toThrow(/execution profile/i);

    const platformDrift = structuredClone(manifest);
    platformDrift.tasks[0].platforms = ["windows-native"];
    expect(() => validateCodingAgentBenchmarkManifest(platformDrift)).toThrow(/platform matrix/i);

    const toolPolicyDrift = structuredClone(manifest);
    toolPolicyDrift.suite.executionProfiles ??= { plan: { toolAllow: [] } };
    toolPolicyDrift.suite.executionProfiles.plan.toolAllow.push("run_command");
    expect(() => validateCodingAgentBenchmarkManifest(toolPolicyDrift)).toThrow(/execution profiles.*frozen/i);

    const resetDrift = structuredClone(manifest);
    delete resetDrift.tasks[0].fixture.resetStrategy;
    expect(() => validateCodingAgentBenchmarkManifest(resetDrift)).toThrow(/reset strategy/i);
  });

  it("publishes a JSON Schema that accepts the frozen manifest and rejects an incomplete task", async () => {
    const manifest = await loadCodingAgentBenchmarkManifest();
    const schema = JSON.parse(await fs.readFile(path.resolve(
      "benchmarks/coding-agent/v1/task-manifest.schema.json",
    ), "utf-8"));
    const compiled = compileOutputSchema(schema);

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.validator.validateOutput(JSON.stringify(manifest))).toMatchObject({ ok: true });

    const incomplete = structuredClone(manifest);
    delete incomplete.tasks[0].evaluator;
    expect(compiled.validator.validateOutput(JSON.stringify(incomplete))).toMatchObject({ ok: false });

    const budgetDrift = structuredClone(manifest);
    budgetDrift.suite.budgets.timeoutMs = 1;
    expect(compiled.validator.validateOutput(JSON.stringify(budgetDrift))).toMatchObject({ ok: false });

    const toolPolicyDrift = structuredClone(manifest);
    toolPolicyDrift.suite.executionProfiles.plan.toolAllow.push("run_command");
    expect(compiled.validator.validateOutput(JSON.stringify(toolPolicyDrift))).toMatchObject({ ok: false });

    const missingResetStrategy = structuredClone(manifest);
    delete missingResetStrategy.tasks[0].fixture.resetStrategy;
    expect(compiled.validator.validateOutput(JSON.stringify(missingResetStrategy))).toMatchObject({ ok: false });
  });

  it("builds a machine-evaluated report with applicable metric denominators", async () => {
    const manifest = await loadCodingAgentBenchmarkManifest();
    const report = createCodingAgentBenchmarkReport({
      status: "partial",
      generatedAt: "2026-07-25T16:00:00.000Z",
      manifest,
      manifestSha256: "a".repeat(64),
      source: {
        commit: "b".repeat(40),
        workspaceDirty: false,
        lockfileSha256: "c".repeat(64),
      },
      runs: [
        runRecord({
          runId: "run-rules-1",
          taskId: "rules.nested-precedence",
          platform: "windows-native",
          taskCompleted: true,
          durationMs: 100,
          inputTokens: 10,
          outputTokens: 5,
        }),
        runRecord({
          runId: "run-bug-1",
          taskId: "bug.reproducible-fix",
          platform: "windows-native",
          status: "failed",
          failureCategory: "tool",
          taskCompleted: false,
          testsPassed: false,
          patchAccepted: false,
          regressionCount: 1,
          manualInterventionCount: 2,
          durationMs: 300,
        }),
        runRecord({
          runId: "run-safety-1",
          taskId: "safety.boundary-enforcement",
          platform: "wsl2-linux",
          taskCompleted: true,
          dangerousOperationBlocked: true,
          durationMs: 200,
          inputTokens: 8,
          outputTokens: 4,
        }),
        runRecord({
          runId: "run-recovery-1",
          taskId: "gateway.disconnect-recovery",
          platform: "wsl2-linux",
          status: "failed",
          failureCategory: "platform",
          taskCompleted: false,
          recoverySucceeded: false,
          durationMs: 400,
          inputTokens: 12,
          outputTokens: 6,
        }),
      ],
    });

    expect(report).toMatchObject({
      schemaVersion: CODING_AGENT_BENCHMARK_REPORT_VERSION,
      status: "partial",
      benchmark: {
        id: "ss-project-coding-v1",
        mode: "report_only",
        thresholdApplied: false,
      },
      suite: {
        manifestSchemaVersion: CODING_AGENT_BENCHMARK_MANIFEST_VERSION,
        manifestSha256: "a".repeat(64),
        sampleRuns: 3,
      },
      summary: {
        runCount: 4,
        passedRunCount: 2,
        failuresByCategory: { tool: 1, platform: 1 },
        metrics: {
          task_completion_rate: { numerator: 2, denominator: 4, value: 0.5 },
          test_pass_rate: { numerator: 0, denominator: 1, value: 0 },
          patch_acceptance_rate: { numerator: 0, denominator: 1, value: 0 },
          regression_count: { value: 1 },
          manual_intervention_count: { value: 2 },
          dangerous_operation_block_rate: { numerator: 1, denominator: 1, value: 1 },
          recovery_success_rate: { numerator: 0, denominator: 1, value: 0 },
          duration_ms: {
            sampleCount: 4,
            total: 1000,
            min: 100,
            max: 400,
            mean: 250,
            median: 200,
            p95: 400,
          },
          input_tokens: { sampleCount: 3, value: 30 },
          output_tokens: { sampleCount: 3, value: 15 },
        },
      },
    });
  });

  it("refuses to mark a report completed until every task and platform has all sample runs", async () => {
    const manifest = await loadCodingAgentBenchmarkManifest();

    expect(() => createCodingAgentBenchmarkReport({
      status: "completed",
      generatedAt: "2026-07-25T16:00:00.000Z",
      manifest,
      manifestSha256: "a".repeat(64),
      source: {
        commit: "b".repeat(40),
        workspaceDirty: false,
        lockfileSha256: "c".repeat(64),
      },
      runs: [
        runRecord({
          runId: "run-rules-1",
          taskId: "rules.nested-precedence",
          platform: "windows-native",
          taskCompleted: true,
          durationMs: 100,
        }),
      ],
    })).toThrow(/completed.*full task.*platform.*sample matrix/i);
  });

  it("aggregates only sanitized provider-reported costs and observation states", async () => {
    const manifest = await loadCodingAgentBenchmarkManifest();
    const providerReported = runRecord({
      runId: "run-usage-provider",
      taskId: "rules.nested-precedence",
      platform: "windows-native",
      taskCompleted: true,
      durationMs: 100,
    });
    providerReported.usage.observation = { status: "provider_reported", costUsd: 0.125 };
    providerReported.execution.maxCostUsd = 3;
    const unavailable = runRecord({
      runId: "run-usage-unavailable",
      taskId: "rules.nested-precedence",
      platform: "wsl2-linux",
      taskCompleted: true,
      durationMs: 100,
    });
    unavailable.usage.observation = { status: "unavailable", costUsd: null };

    const report = createCodingAgentBenchmarkReport({
      status: "partial",
      generatedAt: "2026-07-26T00:00:00.000Z",
      manifest,
      manifestSha256: "a".repeat(64),
      source: {
        commit: "b".repeat(40),
        workspaceDirty: false,
        lockfileSha256: "c".repeat(64),
      },
      runs: [providerReported, unavailable],
    });

    expect(report.summary).toMatchObject({
      usageObservation: {
        providerReportedRunCount: 1,
        unavailableRunCount: 1,
        notReachedRunCount: 0,
      },
      metrics: { cost_usd: { sampleCount: 1, value: 0.125 } },
    });
    const reportSchema = JSON.parse(await fs.readFile(
      path.resolve("benchmarks/coding-agent/v1/benchmark-report.schema.json"),
      "utf-8",
    ));
    const compiled = compileOutputSchema(reportSchema);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.validator.validateOutput(JSON.stringify(report))).toMatchObject({ ok: true });
    }
  });

  it("publishes a JSON Schema for report consumers", async () => {
    const manifest = await loadCodingAgentBenchmarkManifest();
    const report = createCodingAgentBenchmarkReport({
      status: "partial",
      generatedAt: "2026-07-25T16:00:00.000Z",
      manifest,
      manifestSha256: "a".repeat(64),
      source: {
        commit: "b".repeat(40),
        workspaceDirty: false,
        lockfileSha256: "c".repeat(64),
      },
      runs: [runRecord({
        runId: "run-rules-1",
        taskId: "rules.nested-precedence",
        platform: "windows-native",
        taskCompleted: true,
        durationMs: 100,
      })],
    });
    const schema = JSON.parse(await fs.readFile(path.resolve(
      "benchmarks/coding-agent/v1/benchmark-report.schema.json",
    ), "utf-8"));
    const compiled = compileOutputSchema(schema);

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.validator.validateOutput(JSON.stringify(report))).toMatchObject({ ok: true });

    const missingArtifact = structuredClone(report);
    delete missingArtifact.runs[0].artifacts.events;
    expect(compiled.validator.validateOutput(JSON.stringify(missingArtifact))).toMatchObject({ ok: false });

    const outOfRangeAttempt = structuredClone(report);
    outOfRangeAttempt.runs[0].attempt = 4;
    expect(compiled.validator.validateOutput(JSON.stringify(outOfRangeAttempt))).toMatchObject({ ok: false });

    const unsafeArtifact = structuredClone(report);
    unsafeArtifact.runs[0].artifacts.events = "../events.jsonl";
    expect(compiled.validator.validateOutput(JSON.stringify(unsafeArtifact))).toMatchObject({ ok: false });
  });

  it("rejects run records whose actual profile or budgets drift from the manifest", async () => {
    const manifest = await loadCodingAgentBenchmarkManifest();
    const mismatched = runRecord({
      runId: "run-rules-1",
      taskId: "rules.nested-precedence",
      platform: "windows-native",
      taskCompleted: true,
      durationMs: 100,
    });
    mismatched.execution.profile = "workspace-write";

    expect(() => createCodingAgentBenchmarkReport({
      status: "partial",
      generatedAt: "2026-07-25T16:00:00.000Z",
      manifest,
      manifestSha256: "a".repeat(64),
      source: {
        commit: "b".repeat(40),
        workspaceDirty: false,
        lockfileSha256: "c".repeat(64),
      },
      runs: [mismatched],
    })).toThrow(/execution profile.*manifest/i);
  });

  it("rejects duplicate run identities and attempts outside the frozen sample range", async () => {
    const manifest = await loadCodingAgentBenchmarkManifest();
    const duplicateRunId = [
      runRecord({
        runId: "duplicate-run-id",
        taskId: "rules.nested-precedence",
        platform: "windows-native",
        taskCompleted: true,
        durationMs: 100,
      }),
      runRecord({
        runId: "duplicate-run-id",
        taskId: "rules.nested-precedence",
        platform: "wsl2-linux",
        taskCompleted: true,
        durationMs: 100,
      }),
    ];

    expect(() => createCodingAgentBenchmarkReport({
      status: "partial",
      generatedAt: "2026-07-25T16:00:00.000Z",
      manifest,
      manifestSha256: "a".repeat(64),
      source: {
        commit: "b".repeat(40),
        workspaceDirty: false,
        lockfileSha256: "c".repeat(64),
      },
      runs: duplicateRunId,
    })).toThrow(/duplicate.*runId/i);

    const outOfRangeAttempt = runRecord({
      runId: "run-rules-4",
      taskId: "rules.nested-precedence",
      platform: "windows-native",
      attempt: 4,
      taskCompleted: true,
      durationMs: 100,
    });
    expect(() => createCodingAgentBenchmarkReport({
      status: "partial",
      generatedAt: "2026-07-25T16:00:00.000Z",
      manifest,
      manifestSha256: "a".repeat(64),
      source: {
        commit: "b".repeat(40),
        workspaceDirty: false,
        lockfileSha256: "c".repeat(64),
      },
      runs: [outOfRangeAttempt],
    })).toThrow(/attempt.*sampleRuns/i);
  });

  it("rejects incomplete environment fingerprints and unsafe artifact references", async () => {
    const manifest = await loadCodingAgentBenchmarkManifest();
    const reportInput = (run) => ({
      status: "partial",
      generatedAt: "2026-07-25T16:00:00.000Z",
      manifest,
      manifestSha256: "a".repeat(64),
      source: {
        commit: "b".repeat(40),
        workspaceDirty: false,
        lockfileSha256: "c".repeat(64),
      },
      runs: [run],
    });

    const missingEnvironmentField = runRecord({
      runId: "run-rules-1",
      taskId: "rules.nested-precedence",
      platform: "windows-native",
      taskCompleted: true,
      durationMs: 100,
    });
    delete missingEnvironmentField.environment.arch;
    expect(() => createCodingAgentBenchmarkReport(reportInput(missingEnvironmentField))).toThrow(
      /environment.*arch/i,
    );

    const mismatchedWslFingerprint = runRecord({
      runId: "run-rules-1",
      taskId: "rules.nested-precedence",
      platform: "wsl2-linux",
      taskCompleted: true,
      durationMs: 100,
    });
    mismatchedWslFingerprint.environment.wsl = null;
    expect(() => createCodingAgentBenchmarkReport(reportInput(mismatchedWslFingerprint))).toThrow(
      /WSL2.*fingerprint/i,
    );

    const unsafeArtifact = runRecord({
      runId: "run-rules-1",
      taskId: "rules.nested-precedence",
      platform: "windows-native",
      taskCompleted: true,
      durationMs: 100,
    });
    unsafeArtifact.artifacts.events = "../events.jsonl";
    expect(() => createCodingAgentBenchmarkReport(reportInput(unsafeArtifact))).toThrow(
      /artifact path.*run directory/i,
    );
  });

  it("publishes a standalone JSON Schema for each run artifact", async () => {
    const run = runRecord({
      runId: "run-rules-1",
      taskId: "rules.nested-precedence",
      platform: "windows-native",
      taskCompleted: true,
      durationMs: 100,
    });
    const schema = JSON.parse(await fs.readFile(path.resolve(
      "benchmarks/coding-agent/v1/benchmark-run.schema.json",
    ), "utf-8"));
    const compiled = compileOutputSchema(schema);

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.validator.validateOutput(JSON.stringify(run))).toMatchObject({ ok: true });

    const missingExecution = structuredClone(run);
    delete missingExecution.execution;
    expect(compiled.validator.validateOutput(JSON.stringify(missingExecution))).toMatchObject({ ok: false });

    const outOfRangeAttempt = structuredClone(run);
    outOfRangeAttempt.attempt = 4;
    expect(compiled.validator.validateOutput(JSON.stringify(outOfRangeAttempt))).toMatchObject({ ok: false });

    const unsafeArtifact = structuredClone(run);
    unsafeArtifact.artifacts.events = "../events.jsonl";
    expect(compiled.validator.validateOutput(JSON.stringify(unsafeArtifact))).toMatchObject({ ok: false });
  });
});

function runRecord(input) {
  return {
    schemaVersion: "coding-agent-benchmark-run/v1",
    runId: input.runId,
    taskId: input.taskId,
    attempt: input.attempt ?? 1,
    platform: input.platform,
    fixture: {
      generatorId: fixtureGeneratorForTask(input.taskId),
      version: 1,
      resetStrategy: "regenerate",
      baselineCommit: "d".repeat(40),
    },
    status: input.status ?? "passed",
    failureCategory: input.failureCategory ?? null,
    execution: {
      profile: executionProfileForTask(input.taskId),
      budgets: {
        timeoutMs: 300_000,
        maxTurns: 12,
        maxTokens: 24_000,
      },
      infrastructureRetries: 0,
    },
    environment: {
      osRelease: "fixture-release",
      arch: "x64",
      nodeVersion: "v22.23.1",
      packageManager: "pnpm@10.23.0",
      wsl: input.platform === "wsl2-linux"
        ? { distribution: "Ubuntu-22.04", version: 2 }
        : null,
      model: {
        provider: "fixture-provider",
        id: "fixture-model",
        credentialsConfigured: true,
      },
    },
    evaluation: {
      source: "machine",
      taskCompleted: input.taskCompleted,
      testsPassed: input.testsPassed ?? null,
      patchAccepted: input.patchAccepted ?? null,
      regressionCount: input.regressionCount ?? 0,
      manualInterventionCount: input.manualInterventionCount ?? 0,
      dangerousOperationBlocked: input.dangerousOperationBlocked ?? null,
      recoverySucceeded: input.recoverySucceeded ?? null,
    },
    usage: {
      durationMs: input.durationMs,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
    },
    artifacts: {
      manifest: `${input.runId}/manifest.json`,
      events: `${input.runId}/events.jsonl`,
      result: `${input.runId}/result.json`,
      patch: `${input.runId}/changes.patch`,
      diagnostics: `${input.runId}/diagnostics.log`,
      status: `${input.runId}/status.txt`,
      ...(input.taskId === "gateway.disconnect-recovery"
        ? { faultInjection: `${input.runId}/fault-injection.json` }
        : {}),
    },
  };
}

function executionProfileForTask(taskId) {
  if (taskId === "bug.reproducible-fix") return "workspace-write";
  if (taskId === "navigation.large-repository") return "navigation-read";
  if (taskId === "safety.boundary-enforcement") return "safety-probe";
  if (taskId === "gateway.disconnect-recovery") return "recovery-control";
  return "plan";
}

function fixtureGeneratorForTask(taskId) {
  if (taskId === "bug.reproducible-fix") return "reproducible-bug-v1";
  if (taskId === "safety.boundary-enforcement") return "safety-boundary-v1";
  if (taskId === "gateway.disconnect-recovery") return "gateway-recovery-v1";
  return "nested-rules-v1";
}
