import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  CODE_INTEL_AGENT_UPLIFT_REPORT_VERSION,
  analyzeCodeIntelAgentUpliftCell,
  assertCodeIntelAgentUpliftPricingEnvironment,
  buildCodeIntelAgentUpliftAggregate,
  runCodeIntelAgentUpliftCohortPreflight,
  runCodeIntelAgentUpliftPlatform,
} from "./run-code-intel-agent-uplift.mjs";

const workspaceRoot = path.resolve(".");
const tempRoots = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("CodeIntel Agent uplift paired run", () => {
  it("fails closed unless all authorized DeepSeek pricing is injected exactly", () => {
    const pricing = {
      BELLDANDY_MODEL_INPUT_USD_PER_1M: "0.125",
      BELLDANDY_MODEL_CACHE_READ_USD_PER_1M: "0.0025",
      BELLDANDY_MODEL_OUTPUT_USD_PER_1M: "0.25",
    };
    expect(() => assertCodeIntelAgentUpliftPricingEnvironment((name) => pricing[name]))
      .not.toThrow();

    for (const name of Object.keys(pricing)) {
      expect(() => assertCodeIntelAgentUpliftPricingEnvironment(
        (candidate) => candidate === name ? undefined : pricing[candidate],
      )).toThrow(name);
      expect(() => assertCodeIntelAgentUpliftPricingEnvironment(
        (candidate) => candidate === name ? "0.5" : pricing[candidate],
      )).toThrow(name);
    }
  });

  it("measures only successful pre-mutation navigation and semantic-live adoption", () => {
    const cell = analyzeCodeIntelAgentUpliftCell({
      variant: "candidate",
      task: taskFixture("src/target.ts"),
      report: reportFixture({
        taskId: "real-ts.api-migration",
        profile: "workspace-write",
        profileCandidateId: "code-intel-semantic-live-v1",
      }),
      codingCiManifest: {
        mode: "workspace-write",
        profileCandidateId: "code-intel-semantic-live-v1",
        changedPaths: ["src/target.ts"],
      },
      events: [
        toolStarted("read-target", "file_read", { path: "src/target.ts" }),
        toolCompleted("read-target", "file_read", true, "target"),
        toolStarted("read-other", "file_read", { path: "src/other.ts" }),
        toolCompleted("read-other", "file_read", true, "other"),
        toolStarted("bounded", "file_read", { path: "src/third.ts", offset: 10, limit: 20 }),
        toolCompleted("bounded", "file_read", true, "bounded"),
        toolStarted("semantic", "code_intel", { operation: "symbols", query: "Target" }),
        toolCompleted("semantic", "code_intel", true, JSON.stringify({
          provenance: { capability: "semantic-live" },
        }), { capability: "semantic-live" }),
        toolStarted("failed", "text_search", { query: "ignored" }),
        toolCompleted("failed", "text_search", false, "not visible"),
        toolStarted("edit", "apply_patch", { patch: "fixture" }),
        toolCompleted("edit", "apply_patch", true, "edited"),
        toolStarted("late", "file_read", { path: "src/late.ts" }),
        toolCompleted("late", "file_read", true, "late"),
        usageEvent(),
        terminalEvent("run.completed"),
      ],
    });

    expect(cell.semantic).toEqual({
      successfulRun: true,
      successfulCallCount: 1,
      failedCallCount: 0,
      capabilities: ["semantic-live"],
    });
    expect(cell.contextWaste).toEqual({
      modelVisibleNavigationBytes: Buffer.byteLength(
        `targetotherbounded${JSON.stringify({ provenance: { capability: "semantic-live" } })}`,
        "utf-8",
      ),
      nonTargetWholeFileReadCalls: 1,
      firstMutationTool: "apply_patch",
    });
    expect(cell.outcomes).toEqual({
      taskSuccess: true,
      patchAcceptance: true,
      testSuccess: true,
      regressionCount: 0,
    });
    expect(cell.provider).toMatchObject({
      usageStatus: "provider_reported",
      failure: false,
      costUsd: 0.01,
    });
  });

  it("preflights the complete four-task cohort and provisions the frozen command profile", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-intel-uplift-cohort-preflight-"));
    tempRoots.push(root);
    const stateRoot = path.join(root, "state");
    const outputPath = path.join(root, "cohort-preflight.json");
    const calls = [];
    const pricing = {
      BELLDANDY_MODEL_INPUT_USD_PER_1M: "0.125",
      BELLDANDY_MODEL_CACHE_READ_USD_PER_1M: "0.0025",
      BELLDANDY_MODEL_OUTPUT_USD_PER_1M: "0.25",
    };

    const report = await runCodeIntelAgentUpliftCohortPreflight({
      platform: "windows-native",
      sourceRoot: workspaceRoot,
      stateRoot,
      outputPath,
      provisionAgentProfile: true,
      generatedAt: "2026-08-09T14:00:00.000Z",
      readEnv: (name) => pricing[name],
    }, {
      createPreflight: async (input) => {
        calls.push({ taskId: input.task.id, stateDir: input.stateDir });
        return cohortTaskPreflightFixture(input.task);
      },
    });

    expect(report).toMatchObject({
      schemaVersion: "code-intel-agent-uplift-cohort-preflight/v1",
      status: "passed",
      platform: "windows-native",
      providerCalls: 0,
      selectedTaskCount: 4,
      blockingFailures: [],
    });
    expect(calls.map((call) => call.taskId)).toEqual([
      "real-ts.api-migration",
      "real-ts.cross-package-refactor",
      "real-js.bug-fix",
      "real-js.failed-test-fix",
    ]);
    expect(calls.every((call) => call.stateDir === stateRoot)).toBe(true);
    expect(JSON.parse(await fs.readFile(path.join(stateRoot, "agents.json"), "utf-8"))).toEqual({
      agents: [{
        id: "coding-benchmark-command-control-v2",
        displayName: "Coding Benchmark Command Control v2",
        model: "primary",
        kind: "resident",
        maxHighRiskToolCalls: 5,
      }],
    });
    expect(JSON.parse(await fs.readFile(outputPath, "utf-8"))).toEqual(report);

    const schema = JSON.parse(await fs.readFile(path.join(
      workspaceRoot,
      "benchmarks/code-intel/v1/agent-uplift-cohort-preflight.schema.json",
    ), "utf-8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.validator.validateOutput(JSON.stringify(report))).toMatchObject({ ok: true });
      const taskOrderDrift = structuredClone(report);
      taskOrderDrift.tasks[3].taskId = "real-ts.api-migration";
      expect(compiled.validator.validateOutput(JSON.stringify(taskOrderDrift))).toMatchObject({ ok: false });
    }
  });

  it("blocks every selected cell when the cohort runtime preflight fails", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-intel-uplift-cohort-block-"));
    tempRoots.push(root);
    let executeCalls = 0;

    await expect(runCodeIntelAgentUpliftPlatform({
      platform: "windows-native",
      sourceRoot: workspaceRoot,
      readiness: readinessFixture("windows-native"),
      repositoryConfigPath: path.join(root, "repository-inputs.json"),
      fixtureRoot: path.join(root, "fixtures"),
      stateRoot: path.join(root, "state"),
      outputRoot: path.join(root, "output"),
      cohortPreflightOutputPath: path.join(root, "cohort-preflight.json"),
      provider: "openai",
      modelId: "deepseek-v4-flash",
      attempt: 8,
      maxTotalCostCny: 40,
      priorObservedCostCny: 0.20708056,
      generatedAt: "2026-08-09T14:00:00.000Z",
    }, {
      verifyReadiness: async () => {},
      runCohortPreflight: async () => ({
        schemaVersion: "code-intel-agent-uplift-cohort-preflight/v1",
        status: "failed",
        providerCalls: 0,
        blockingFailures: ["real-js.failed-test-fix:oci:runtime_unavailable"],
      }),
      executeCell: async () => {
        executeCalls += 1;
        throw new Error("must not execute");
      },
    })).rejects.toThrow(/cohort runtime preflight failed/i);

    expect(executeCalls).toBe(0);
    await expect(fs.stat(path.join(root, "output"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("persists a zero-call cohort report when one task preflight throws", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-intel-uplift-cohort-error-"));
    tempRoots.push(root);
    const calls = [];
    const pricing = {
      BELLDANDY_MODEL_INPUT_USD_PER_1M: "0.125",
      BELLDANDY_MODEL_CACHE_READ_USD_PER_1M: "0.0025",
      BELLDANDY_MODEL_OUTPUT_USD_PER_1M: "0.25",
    };

    const report = await runCodeIntelAgentUpliftCohortPreflight({
      platform: "windows-native",
      sourceRoot: workspaceRoot,
      stateRoot: path.join(root, "state"),
      outputPath: path.join(root, "cohort-preflight.json"),
      provisionAgentProfile: true,
      generatedAt: "2026-08-09T14:01:00.000Z",
      readEnv: (name) => pricing[name],
    }, {
      createPreflight: async (input) => {
        calls.push(input.task.id);
        if (input.task.id === "real-js.failed-test-fix") {
          throw new Error("OCI runtime unavailable");
        }
        return cohortTaskPreflightFixture(input.task);
      },
    });

    expect(calls).toHaveLength(4);
    expect(report).toMatchObject({
      status: "failed",
      providerCalls: 0,
      selectedTaskCount: 4,
    });
    expect(report.blockingFailures).toEqual([
      "real-js.failed-test-fix:runtimePreflight:preflight_exception_oci_runtime_unavailable",
    ]);
    expect(report.tasks.at(-1)).toMatchObject({
      taskId: "real-js.failed-test-fix",
      status: "failed",
    });
    await expect(fs.readFile(path.join(root, "cohort-preflight.json"), "utf-8"))
      .resolves.toContain('"providerCalls": 0');
  });

  it("executes each selected cell once and caps every child by the remaining global budget", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-intel-uplift-run-"));
    tempRoots.push(root);
    const calls = [];
    const readiness = readinessFixture("windows-native");
    const report = await runCodeIntelAgentUpliftPlatform({
      platform: "windows-native",
      sourceRoot: workspaceRoot,
      readiness,
      repositoryConfigPath: path.join(root, "repository-inputs.json"),
      fixtureRoot: path.join(root, "fixtures"),
      stateRoot: path.join(root, "state"),
      outputRoot: path.join(root, "output"),
      provider: "openai",
      modelId: "deepseek-v4-flash",
      attempt: 2,
      maxTotalCostCny: 40,
      priorObservedCostCny: 20,
      generatedAt: "2026-08-09T10:00:00.000Z",
    }, {
      verifyReadiness: async () => {},
      runCohortPreflight: async () => cohortPreflightFixture(),
      executeCell: async (input) => {
        calls.push({
          taskId: input.task.id,
          variant: input.variant,
          attempt: input.attempt,
          maxCostUsd: input.maxCostUsd,
        });
        return analyzedCellFixture(input.task.id, input.variant, 0.1, input.attempt);
      },
    });

    expect(calls).toHaveLength(8);
    expect(calls.map((call) => `${call.taskId}:${call.variant}`)).toEqual([
      "real-ts.api-migration:baseline",
      "real-ts.api-migration:candidate",
      "real-ts.cross-package-refactor:baseline",
      "real-ts.cross-package-refactor:candidate",
      "real-js.bug-fix:baseline",
      "real-js.bug-fix:candidate",
      "real-js.failed-test-fix:baseline",
      "real-js.failed-test-fix:candidate",
    ]);
    expect(calls[0].maxCostUsd).toBe(2.5);
    expect(calls.at(-1).maxCostUsd).toBe(1.8);
    expect(calls.every((call) => call.attempt === 2)).toBe(true);
    expect(report.attempt).toBe(2);
    expect(report.pairs.map((pair) => pair.pairId)).toEqual([
      "real-ts.api-migration:windows-native:a2",
      "real-ts.cross-package-refactor:windows-native:a2",
      "real-js.bug-fix:windows-native:a2",
      "real-js.failed-test-fix:windows-native:a2",
    ]);
    expect(report.authorization).toMatchObject({
      maxTotalCostCny: 40,
      priorObservedCostCny: 20,
      runCostCny: 6.4,
      remainingCostCny: 13.6,
    });
    expect(report.execution).toMatchObject({ selectedCellCount: 8, executedCellCount: 8, retryCount: 0 });
    expect(report.pairs).toHaveLength(4);
    const schema = JSON.parse(await fs.readFile(path.join(
      workspaceRoot,
      "benchmarks/code-intel/v1/agent-uplift-platform.schema.json",
    ), "utf-8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.validator.validateOutput(JSON.stringify(report))).toMatchObject({ ok: true });
    }
  });

  it("writes a blocked report when paired input identity drifts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-intel-uplift-identity-"));
    tempRoots.push(root);
    const outputRoot = path.join(root, "output");
    const report = await runCodeIntelAgentUpliftPlatform({
      platform: "windows-native",
      sourceRoot: workspaceRoot,
      readiness: readinessFixture("windows-native"),
      repositoryConfigPath: path.join(root, "repository-inputs.json"),
      fixtureRoot: path.join(root, "fixtures"),
      stateRoot: path.join(root, "state"),
      outputRoot,
      provider: "openai",
      modelId: "deepseek-v4-flash",
      attempt: 3,
      maxTotalCostCny: 40,
      generatedAt: "2026-08-09T10:00:00.000Z",
    }, {
      verifyReadiness: async () => {},
      runCohortPreflight: async () => cohortPreflightFixture(),
      executeCell: async (input) => {
        const cell = analyzedCellFixture(input.task.id, input.variant, 0.01, input.attempt);
        if (input.variant === "candidate") {
          cell.identity.fixtureBaselineCommit = "f".repeat(40);
        }
        return cell;
      },
    });

    expect(report).toMatchObject({
      status: "blocked",
      attempt: 3,
      authorization: { runCostCny: 0.16 },
      execution: { executedCellCount: 2, retryCount: 0 },
      blockingFailures: [
        "paired_input_identity_mismatch:real-ts.api-migration:windows-native:a3",
      ],
    });
    expect(report.pairs).toHaveLength(1);
    await expect(fs.readFile(
      path.join(outputRoot, "agent-uplift-platform.json"),
      "utf-8",
    )).resolves.toContain("paired_input_identity_mismatch");
  });

  it("keeps the uplift attempt independent from the frozen benchmark sample attempt", () => {
    const cell = analyzeCodeIntelAgentUpliftCell({
      variant: "baseline",
      attempt: 4,
      benchmarkAttempt: 1,
      task: taskFixture(),
      report: reportFixture(),
      codingCiManifest: { mode: "workspace-write", profileCandidateId: undefined },
      events: [usageEvent(), terminalEvent("run.completed")],
    });

    expect(cell.cellId).toBe("real-ts.api-migration:windows-native:a4:baseline");
  });

  it("persists a zero-cost blocked report when a selected cell cannot start", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-intel-uplift-start-block-"));
    tempRoots.push(root);
    const outputRoot = path.join(root, "output");
    const report = await runCodeIntelAgentUpliftPlatform({
      platform: "windows-native",
      sourceRoot: workspaceRoot,
      readiness: readinessFixture("windows-native"),
      repositoryConfigPath: path.join(root, "repository-inputs.json"),
      fixtureRoot: path.join(root, "fixtures"),
      stateRoot: path.join(root, "state"),
      outputRoot,
      provider: "openai",
      modelId: "deepseek-v4-flash",
      attempt: 4,
      maxTotalCostCny: 40,
      priorObservedCostCny: 0.08647368,
      generatedAt: "2026-08-09T11:49:00.000Z",
    }, {
      verifyReadiness: async () => {},
      runCohortPreflight: async () => cohortPreflightFixture(),
      executeCell: async () => {
        throw new Error("Stage 0B attempt must be within 1-3.");
      },
    });

    expect(report).toMatchObject({
      status: "blocked",
      attempt: 4,
      authorization: { runCostCny: 0, remainingCostCny: 39.91352632 },
      execution: { executedCellCount: 0, retryCount: 0 },
    });
    expect(report.pairs).toEqual([expect.objectContaining({
      pairId: "real-ts.api-migration:windows-native:a4",
    })]);
    expect(report.blockingFailures).toEqual([
      "cell_execution_error:real-ts.api-migration:windows-native:a4:baseline:stage_0b_attempt_must_be_within_1_3",
    ]);
    await expect(fs.readFile(
      path.join(outputRoot, "agent-uplift-platform.json"),
      "utf-8",
    )).resolves.toContain('"status": "blocked"');
  });

  it("passes the frozen eight-pair Gate and fails closed on binary regression", async () => {
    const windows = platformReportFixture("windows-native");
    const wsl = platformReportFixture("wsl2-linux");
    const aggregate = buildCodeIntelAgentUpliftAggregate({
      generatedAt: "2026-08-09T11:00:00.000Z",
      windows,
      wsl,
      maxTotalCostCny: 40,
    });

    expect(aggregate.schemaVersion).toBe(CODE_INTEL_AGENT_UPLIFT_REPORT_VERSION);
    expect(aggregate.gate.failures).toEqual([]);
    expect(aggregate.status).toBe("passed");
    expect(aggregate.gate).toMatchObject({
      passed: true,
      failures: [],
      semanticSuccessfulRuns: 8,
      providerFailureCount: 0,
      regressionCount: 0,
    });
    expect(aggregate.gate.contextWaste.modelVisibleNavigationBytes.relativeReduction).toBe(0.2);
    expect(aggregate.gate.contextWaste.improvementAlternativePassed).toBe(true);

    const regressed = structuredClone(wsl);
    regressed.pairs[0].candidate.outcomes.testSuccess = false;
    const blocked = buildCodeIntelAgentUpliftAggregate({
      generatedAt: "2026-08-09T11:01:00.000Z",
      windows,
      wsl: regressed,
      maxTotalCostCny: 40,
    });
    expect(blocked.status).toBe("blocked");
    expect(blocked.gate.failures).toContain("binary_outcome_regression");

    const attemptTwo = buildCodeIntelAgentUpliftAggregate({
      generatedAt: "2026-08-09T11:02:00.000Z",
      windows: platformReportFixture("windows-native", 2),
      wsl: platformReportFixture("wsl2-linux", 2),
      maxTotalCostCny: 40,
    });
    expect(attemptTwo.status).toBe("passed");
    expect(attemptTwo.attempt).toBe(2);
    expect(attemptTwo.pairs.every((pair) => pair.pairId.includes(":a2"))).toBe(true);

    const attemptMismatch = buildCodeIntelAgentUpliftAggregate({
      generatedAt: "2026-08-09T11:03:00.000Z",
      windows: platformReportFixture("windows-native", 2),
      wsl: platformReportFixture("wsl2-linux", 1),
      maxTotalCostCny: 40,
    });
    expect(attemptMismatch.status).toBe("blocked");
    expect(attemptMismatch.gate.failures).toContain("attempt_identity_mismatch");

    const schema = JSON.parse(await fs.readFile(path.join(
      workspaceRoot,
      "benchmarks/code-intel/v1/agent-uplift-report.schema.json",
    ), "utf-8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.validator.validateOutput(JSON.stringify(aggregate))).toMatchObject({ ok: true });
      expect(compiled.validator.validateOutput(JSON.stringify(blocked))).toMatchObject({ ok: true });
      expect(compiled.validator.validateOutput(JSON.stringify(attemptTwo))).toMatchObject({ ok: true });
    }
  });
});

function taskFixture(requiredPath = "src/target.ts") {
  return {
    id: "real-ts.api-migration",
    prompt: "fixture prompt",
    repositoryId: "vscode-languageserver-node",
    executionProfile: "workspace-write",
    acceptance: { requiredChangedPaths: [requiredPath] },
  };
}

function cohortTaskPreflightFixture(task) {
  const commandControl = task.executionProfile === "command-control";
  return {
    schemaVersion: "coding-agent-benchmark-preflight/v1",
    manifestRevision: "v3",
    taskId: task.id,
    runId: `cohort-preflight-${task.id}`,
    status: "passed",
    checks: {
      contractSource: { status: "passed", reason: null },
      workspaceWriteClosure: commandControl
        ? { status: "not_applicable", reason: "task_does_not_require_workspace_write_closure" }
        : { status: "passed", reason: null },
      agentProfile: commandControl
        ? { status: "passed", reason: null }
        : { status: "not_applicable", reason: "profile_uses_runtime_default" },
      executionBudget: { status: "passed", reason: null },
      pricing: { status: "passed", reason: null },
      oci: commandControl
        ? { status: "passed", reason: null }
        : { status: "not_applicable", reason: "profile_has_no_command_execution" },
      eventProjection: { status: "not_applicable", reason: "task_does_not_require_extended_event_output" },
      fault: { status: "not_applicable", reason: "task_has_no_fault_injection" },
    },
  };
}

function cohortPreflightFixture() {
  return {
    schemaVersion: "code-intel-agent-uplift-cohort-preflight/v1",
    status: "passed",
    providerCalls: 0,
    blockingFailures: [],
  };
}

function reportFixture(input = {}) {
  return {
    source: sourceIdentity("a"),
    harness: sourceIdentity("b"),
    runs: [{
      runId: `${input.taskId ?? "real-ts.api-migration"}-windows-a1`,
      taskId: input.taskId ?? "real-ts.api-migration",
      attempt: 1,
      platform: input.platform ?? "windows-native",
      fixture: { baselineCommit: "c".repeat(40) },
      status: "passed",
      failureCategory: null,
      execution: { profile: input.profile ?? "workspace-write", budgets: { maxTokens: 24000 } },
      environment: {
        model: { provider: "openai", id: "deepseek-v4-flash", credentialsConfigured: true },
      },
      evaluation: { taskCompleted: true, patchAccepted: true, testsPassed: true, regressionCount: 0 },
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        observation: { status: "provider_reported", costUsd: 0.01 },
      },
    }],
  };
}

function readinessFixture(platform) {
  const tasks = [
    ["real-ts.api-migration", "vscode-languageserver-node", "workspace-write"],
    ["real-ts.cross-package-refactor", "vscode-languageserver-node", "workspace-write"],
    ["real-js.bug-fix", "express", "workspace-write"],
    ["real-js.failed-test-fix", "express", "command-control"],
  ];
  return {
    schemaVersion: "code-intel-agent-uplift-readiness/v1",
    status: "ready_for_authorization",
    platform,
    candidateId: "code-intel-semantic-live-v1",
    gate: { id: "p1-a1-ts-js-agent-uplift-v1", sha256: "b6266e37cdc22bffb87e61ef0c7616cc9539ce01e35e061caf5556550fd4dfc9" },
    taskManifest: { sha256: "e3cac7c8b2786408af45dc3bfed718ee1a898388aa0fae4fbd5b1d38ab68bd22" },
    truthSet: { sha256: "f6d787ec2a20f446c69f90a467d3812c8ca9644517ee5c7acf328430f934500e" },
    sourceIdentity: { aggregateSha256: "a".repeat(64), files: [{ path: "source.mjs", sha256: "a".repeat(64) }] },
    runtimeIdentity: { aggregateSha256: "b".repeat(64), files: [{ path: "runtime.js", sha256: "b".repeat(64) }] },
    preparedPairs: tasks.map(([taskId, repositoryId, executionProfile]) => ({
      pairId: `${taskId}:${platform}:a1`,
      platform,
      attempt: 1,
      taskId,
      repositoryId,
      executionProfile,
      promptSha256: "c".repeat(64),
    })),
  };
}

function analyzedCellFixture(taskId, variant, costUsd, attempt = 1, platform = "windows-native") {
  return {
    cellId: `${taskId}:${platform}:a${attempt}:${variant}`,
    variant,
    taskId,
    runId: `${taskId}-${variant}`,
    status: "passed",
    failureCategory: null,
    identity: {
      promptSha256: "c".repeat(64),
      fixtureBaselineCommit: "d".repeat(40),
      repositoryReceiptSha256: "e".repeat(64),
      source: sourceIdentity("a"),
      harness: sourceIdentity("b"),
      model: { provider: "openai", id: "deepseek-v4-flash" },
      executionProfile: taskId === "real-js.failed-test-fix" ? "command-control" : "workspace-write",
      maxTokens: 24000,
    },
    outcomes: { taskSuccess: true, patchAcceptance: true, testSuccess: true, regressionCount: 0 },
    provider: { usageStatus: "provider_reported", inputTokens: 100, outputTokens: 20, costUsd, failure: false, terminalErrorCode: null },
    semantic: { successfulRun: variant === "candidate", successfulCallCount: variant === "candidate" ? 1 : 0, failedCallCount: 0, capabilities: variant === "candidate" ? ["semantic-live"] : [] },
    contextWaste: { modelVisibleNavigationBytes: variant === "candidate" ? 80 : 100, nonTargetWholeFileReadCalls: 0, firstMutationTool: "apply_patch" },
    artifacts: { report: { path: "report.json", sha256: "1".repeat(64) }, events: { path: "events.jsonl", sha256: "2".repeat(64) }, codingCiManifest: { path: "manifest.json", sha256: "3".repeat(64) }, patch: { path: "changes.patch", sha256: "4".repeat(64) }, result: { path: "result.json", sha256: "5".repeat(64) }, repositorySnapshotReceipt: { path: "receipt.json", sha256: "e".repeat(64) } },
  };
}

function platformReportFixture(platform, attempt = 1) {
  const readiness = readinessFixture(platform);
  return {
    schemaVersion: "code-intel-agent-uplift-platform/v1",
    generatedAt: "2026-08-09T10:00:00.000Z",
    status: "completed",
    platform,
    attempt,
    candidateId: "code-intel-semantic-live-v1",
    gate: readiness.gate,
    readiness: { sourceIdentity: readiness.sourceIdentity, runtimeIdentity: readiness.runtimeIdentity },
    authorization: { provider: "openai", modelId: "deepseek-v4-flash", maxTotalCostCny: 40, priorObservedCostCny: platform === "wsl2-linux" ? 0.8 : 0, runCostCny: 0.8, remainingCostCny: platform === "wsl2-linux" ? 38.4 : 39.2, exchangeRateCnyPerUsd: 8 },
    execution: { selectedPairCount: 4, selectedCellCount: 8, executedCellCount: 8, retryCount: 0 },
    pairs: readiness.preparedPairs.map((pair) => ({
      pairId: `${pair.taskId}:${platform}:a${attempt}`,
      taskId: pair.taskId,
      repositoryId: pair.repositoryId,
      executionProfile: pair.executionProfile,
      baseline: analyzedCellFixture(pair.taskId, "baseline", 0.1, attempt, platform),
      candidate: analyzedCellFixture(pair.taskId, "candidate", 0.1, attempt, platform),
    })),
    blockingFailures: [],
  };
}

function sourceIdentity(value) {
  return {
    commit: value.repeat(40),
    workspaceDirty: true,
    lockfileSha256: value.repeat(64),
    worktreeContentSha256: value.repeat(64),
  };
}

function toolStarted(id, name, args) {
  return { type: "tool.started", payload: { tool: { id, name, arguments: args } } };
}

function toolCompleted(id, name, success, output, metadata = {}) {
  return { type: "tool.completed", payload: { tool: { id, name, success, output, metadata } } };
}

function usageEvent() {
  return { type: "run.usage", payload: { usage: { source: "provider_reported" } } };
}

function terminalEvent(type) {
  return { type, payload: { usage: { status: "complete" } } };
}
