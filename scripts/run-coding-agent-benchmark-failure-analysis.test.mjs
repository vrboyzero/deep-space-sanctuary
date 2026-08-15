import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  buildCodingAgentFailureAnalysis,
  parseCodingAgentFailureAnalysisCliArguments,
  runCodingAgentFailureAnalysis,
  verifyCodingAgentFailureAnalysis,
  writeCodingAgentFailureAnalysisArtifact,
} from "./run-coding-agent-benchmark-failure-analysis.mjs";

describe("coding agent benchmark failure analysis", () => {
  it("classifies every product failure without copying model-visible content", async () => {
    const input = fixture();
    const artifact = buildCodingAgentFailureAnalysis(input);

    expect(artifact).toMatchObject({
      schemaVersion: "coding-agent-benchmark-failure-analysis/v1",
      status: "completed",
      scope: {
        analyzedFailureCount: 5,
        modelMetadataPolicy: "excluded_untrusted_runner_declaration",
      },
      execution: {
        mode: "offline-analysis",
        modelCalls: 0,
        providerCalls: 0,
        networkCalls: 0,
        credentialsRead: false,
        aggregateModified: false,
        contentMode: "metadata_only",
      },
      summary: {
        analyzedFailureCount: 5,
        unknownCount: 0,
        failedEditCallCount: 1,
        changedRunCount: 1,
        nextAction: {
          status: "ready_for_improvement",
          targetFamily: "model_empty_content_at_length",
          reasonCode: "largest_cross_task_failure_family",
        },
      },
    });
    expect(artifact.families.map((item) => [item.id, item.runCount])).toEqual([
      ["model_empty_content_at_length", 1],
      ["completed_without_required_mutation", 1],
      ["patch_acceptance_failed", 1],
      ["token_budget_exhausted", 1],
      ["output_schema_invalid", 1],
    ]);
    expect(artifact.runs).toHaveLength(5);
    expect(JSON.stringify(artifact)).not.toContain("SECRET_TOOL_OUTPUT");
    expect(JSON.stringify(artifact)).not.toContain("reasoning_content=present");

    const schema = JSON.parse(await fs.readFile(path.join(
      path.resolve("."),
      "benchmarks/coding-agent/v3/failure-analysis.schema.json",
    ), "utf-8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.validator.validateOutput(JSON.stringify(artifact))).toMatchObject({ ok: true });
    }
  });

  it("fails closed on aggregate drift, duplicate evidence, or manifest mismatch", () => {
    const aggregateDrift = fixture();
    aggregateDrift.aggregateText = JSON.stringify({ ...aggregateDrift.aggregate, status: "partial" });
    expect(() => buildCodingAgentFailureAnalysis(aggregateDrift)).toThrow(/aggregate text/i);

    const duplicate = fixture();
    duplicate.artifactInputs.push(duplicate.artifactInputs[0]);
    expect(() => buildCodingAgentFailureAnalysis(duplicate)).toThrow(/duplicate/i);

    const manifestDrift = fixture();
    manifestDrift.artifactInputs[0] = {
      ...manifestDrift.artifactInputs[0],
      manifest: { ...manifestDrift.artifactInputs[0].manifest, taskId: "different-task" },
    };
    expect(() => buildCodingAgentFailureAnalysis(manifestDrift)).toThrow(/manifest/i);
  });

  it("marks unrecognized terminal evidence incomplete instead of inventing a family", () => {
    const input = fixture();
    input.artifactInputs[0] = {
      ...input.artifactInputs[0],
      events: [startedEvent("model-empty"), {
        type: "run.failed",
        payload: { error: { code: "internal", message: "unrecognized" } },
      }],
    };
    input.artifactInputs[0].eventsText = toJsonl(input.artifactInputs[0].events);

    const artifact = buildCodingAgentFailureAnalysis(input);
    expect(artifact.status).toBe("incomplete");
    expect(artifact.summary).toMatchObject({
      unknownCount: 1,
      nextAction: { status: "blocked_unknown_failure_evidence", targetFamily: null },
    });
  });

  it("classifies a failed edit followed by completion as patch acceptance failure", () => {
    const input = fixture();
    input.artifactInputs[1] = {
      ...input.artifactInputs[1],
      events: [
        startedEvent("completed-no-mutation"),
        toolStarted("edit-failed", "apply_patch"),
        toolCompleted("edit-failed", "apply_patch", false),
        completedEvent(0),
      ],
    };
    input.artifactInputs[1].eventsText = toJsonl(input.artifactInputs[1].events);

    const artifact = buildCodingAgentFailureAnalysis(input);
    expect(artifact.runs.find((run) => run.runId === "completed-no-mutation")?.family)
      .toBe("patch_acceptance_failed");
  });

  it("classifies bounded required-mutation recovery failures without guessing the inner budget", () => {
    const input = fixture();
    input.artifactInputs[0] = {
      ...input.artifactInputs[0],
      events: [
        startedEvent("model-empty"),
        failedEvent(
          "internal",
          "required workspace mutation was not completed: the mutation-only model call failed: "
            + "模型返回空内容。finish_reason=length，reasoning_content=present(4112)。",
        ),
      ],
    };
    input.artifactInputs[0].eventsText = toJsonl(input.artifactInputs[0].events);
    input.artifactInputs[1] = {
      ...input.artifactInputs[1],
      events: [
        startedEvent("completed-no-mutation"),
        failedEvent(
          "internal",
          "required workspace mutation was not completed: the ordinary model loop reached its budget gate "
            + "before an allowed bounded mutation-only request could be built.",
        ),
      ],
    };
    input.artifactInputs[1].eventsText = toJsonl(input.artifactInputs[1].events);
    input.artifactInputs[2] = {
      ...input.artifactInputs[2],
      events: [
        startedEvent("patch-rejected"),
        toolStarted("edit-2", "apply_patch"),
        toolCompleted("edit-2", "apply_patch", true),
        failedEvent(
          "internal",
          "required workspace mutation was not completed: the mutation-only model call failed: "
            + "模型返回空内容。finish_reason=length，reasoning_content=present(4112)。",
        ),
      ],
    };
    input.artifactInputs[2].eventsText = toJsonl(input.artifactInputs[2].events);

    const artifact = buildCodingAgentFailureAnalysis(input);
    expect(artifact.runs.filter((run) => run.family === "required_mutation_recovery_failed"))
      .toHaveLength(2);
    expect(artifact.runs.find((run) => run.runId === "patch-rejected")?.family)
      .toBe("patch_acceptance_failed");
  });

  it("parses an explicit aggregate/output pair and writes once", async () => {
    expect(parseCodingAgentFailureAnalysisCliArguments([
      "--aggregate-root", "artifacts/aggregate",
      "--output-root", "artifacts/analysis",
      "--generated-at", "2026-08-15T00:00:00.000Z",
    ])).toEqual({
      aggregateRoot: "artifacts/aggregate",
      outputRoot: "artifacts/analysis",
      generatedAt: "2026-08-15T00:00:00.000Z",
    });
    expect(() => parseCodingAgentFailureAnalysisCliArguments(["--unknown", "value"]))
      .toThrow(/unknown failure analysis argument/i);
    expect(parseCodingAgentFailureAnalysisCliArguments([
      "--verify",
      "--aggregate-root", "artifacts/aggregate",
      "--output-root", "artifacts/analysis",
    ])).toEqual({
      mode: "verify",
      aggregateRoot: "artifacts/aggregate",
      outputRoot: "artifacts/analysis",
    });
    expect(() => parseCodingAgentFailureAnalysisCliArguments([
      "--verify",
      "--aggregate-root", "artifacts/aggregate",
      "--output-root", "artifacts/analysis",
      "--generated-at", "2026-08-15T00:00:00.000Z",
    ])).toThrow(/does not accept --generated-at/i);

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-failure-analysis-"));
    await expect(runCodingAgentFailureAnalysis({
      aggregateRoot: root,
      outputRoot: path.join(root, "nested-output"),
    })).rejects.toThrow(/must not overlap/i);

    const outputRoot = path.join(root, "output");
    try {
      const artifact = buildCodingAgentFailureAnalysis(fixture());
      await writeCodingAgentFailureAnalysisArtifact(outputRoot, artifact);
      await expect(fs.readFile(path.join(outputRoot, "failure-analysis.json"), "utf-8"))
        .resolves.toContain("coding-agent-benchmark-failure-analysis/v1");
      await expect(writeCodingAgentFailureAnalysisArtifact(outputRoot, artifact))
        .rejects.toThrow(/already exists/i);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rebuilds the report from aggregate evidence and fails closed on source drift", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-failure-analysis-verify-"));
    const aggregateRoot = path.join(root, "aggregate");
    const outputRoot = path.join(root, "output");
    const input = fixture();
    try {
      await writeAggregateFixture(aggregateRoot, input);
      await runCodingAgentFailureAnalysis({
        aggregateRoot,
        outputRoot,
        generatedAt: input.generatedAt,
      });
      await expect(verifyCodingAgentFailureAnalysis({ aggregateRoot, outputRoot }))
        .resolves.toMatchObject({ status: "completed" });

      const eventsPath = path.join(aggregateRoot, input.aggregate.runs[0].artifacts.events);
      const driftedEvents = [startedEvent("model-empty"), failedEvent("internal", "drifted")];
      await fs.writeFile(eventsPath, toJsonl(driftedEvents));
      await expect(verifyCodingAgentFailureAnalysis({ aggregateRoot, outputRoot }))
        .rejects.toThrow(/drifted from the aggregate evidence/i);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

async function writeAggregateFixture(aggregateRoot, input) {
  await fs.mkdir(aggregateRoot, { recursive: true });
  await fs.writeFile(
    path.join(aggregateRoot, "benchmark-report.json"),
    input.aggregateText,
  );
  for (const artifact of input.artifactInputs) {
    const run = input.aggregate.runs.find((item) => item.runId === artifact.runId);
    const manifestPath = path.join(aggregateRoot, run.artifacts.manifest);
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await Promise.all([
      fs.writeFile(manifestPath, artifact.manifestText),
      fs.writeFile(path.join(aggregateRoot, run.artifacts.events), artifact.eventsText),
      fs.writeFile(path.join(aggregateRoot, run.artifacts.patch), artifact.patch),
    ]);
  }
}

function fixture() {
  const cases = [
    {
      runId: "model-empty",
      taskId: "real-js.bug-fix",
      events: [
        startedEvent("model-empty"),
        toolStarted("edit-1", "apply_patch"),
        toolCompleted("edit-1", "apply_patch", false),
        {
          type: "run.failed",
          payload: {
            error: {
              code: "internal",
              message: "模型返回空内容。finish_reason=length，reasoning_content=present(5141)。",
            },
          },
        },
      ],
      patch: Buffer.alloc(0),
      evaluation: evaluation(false, false, false, 1),
    },
    {
      runId: "completed-no-mutation",
      taskId: "real-ts.api-migration",
      events: [startedEvent("completed-no-mutation"), completedEvent(0)],
      patch: Buffer.alloc(0),
      evaluation: evaluation(false, false, false, 1),
    },
    {
      runId: "patch-rejected",
      taskId: "real-web.ui-regression",
      events: [
        startedEvent("patch-rejected"),
        toolStarted("edit-2", "apply_patch"),
        toolCompleted("edit-2", "apply_patch", true),
        completedEvent(1),
      ],
      patch: Buffer.from("fixture patch"),
      evaluation: evaluation(false, true, false, 0),
    },
    {
      runId: "budget",
      taskId: "real-js.failed-test-fix",
      events: [
        startedEvent("budget"),
        { type: "run.budget_exhausted", payload: { budget: { budget: "total_tokens", limit: 24_000, observed: 31_805 } } },
        failedEvent("budget_exhausted", "Token budget exhausted."),
      ],
      patch: Buffer.alloc(0),
      evaluation: evaluation(false, true, null, 0),
    },
    {
      runId: "schema",
      taskId: "system.restart-delivery-reconciliation",
      events: [startedEvent("schema"), failedEvent("output_schema_invalid", "Output schema invalid.")],
      patch: Buffer.alloc(0),
      evaluation: evaluation(false, null, null, 0),
    },
  ];
  const runs = cases.map((item, index) => benchmarkRun(item, index));
  const aggregate = {
    schemaVersion: "coding-agent-benchmark-report/v3",
    status: "completed",
    generatedAt: "2026-08-15T05:50:00.169Z",
    benchmark: { id: "ss-project-coding-v3", mode: "report_only", thresholdApplied: false },
    suite: {
      manifestSchemaVersion: "coding-agent-benchmark-manifest/v3",
      manifestSha256: "a".repeat(64),
      sampleRuns: 3,
      requiredPlatforms: ["windows-native", "wsl2-linux"],
    },
    harness: sourceIdentity(),
    source: sourceIdentity(),
    runs,
    summary: {
      runCount: 5,
      productRunCount: 5,
      infrastructureErrorRunCount: 0,
      eligibleForProductComparison: true,
      passedRunCount: 0,
      failuresByCategory: { product_workflow: 5 },
    },
  };
  return {
    generatedAt: "2026-08-15T08:00:00.000Z",
    aggregate,
    aggregateText: JSON.stringify(aggregate),
    artifactInputs: cases.map((item, index) => ({
      runId: item.runId,
      manifest: runs[index],
      manifestText: JSON.stringify(runs[index]),
      events: item.events,
      eventsText: toJsonl(item.events),
      patch: item.patch,
    })),
  };
}

function benchmarkRun(input, index) {
  const platform = index % 2 === 0 ? "windows-native" : "wsl2-linux";
  return {
    schemaVersion: "coding-agent-benchmark-run/v3",
    runId: input.runId,
    taskId: input.taskId,
    attempt: (index % 3) + 1,
    platform,
    fixture: { generatorId: `fixture-${index + 1}-v1`, version: 1, resetStrategy: "regenerate", baselineCommit: "b".repeat(40) },
    status: "failed",
    failureCategory: "product_workflow",
    execution: { profile: "workspace-write", budgets: { timeoutMs: 300_000, maxTurns: 12, maxTokens: 24_000 }, infrastructureRetries: 0 },
    environment: { osRelease: "fixture", arch: "x64", nodeVersion: "v22.0.0", packageManager: "pnpm@10", wsl: platform === "wsl2-linux" ? { distribution: "Ubuntu", version: 2 } : null, model: { provider: "fixture", id: "untrusted-declaration", credentialsConfigured: false } },
    evaluation: input.evaluation,
    usage: { durationMs: 1, inputTokens: 1, outputTokens: 1, observation: { status: "provider_reported", costUsd: 0 } },
    artifacts: {
      manifest: `${input.runId}/manifest.json`,
      events: `${input.runId}/events.jsonl`,
      result: `${input.runId}/result.json`,
      patch: `${input.runId}/changes.patch`,
      diagnostics: `${input.runId}/diagnostics.log`,
      status: `${input.runId}/status.txt`,
      preflight: `${input.runId}/preflight.json`,
    },
  };
}

function evaluation(taskCompleted, testsPassed, patchAccepted, regressionCount) {
  return {
    source: "machine",
    taskCompleted,
    testsPassed,
    patchAccepted,
    regressionCount,
    manualInterventionCount: 0,
    dangerousOperationBlocked: null,
    recoverySucceeded: null,
  };
}

function sourceIdentity() {
  return {
    commit: "c".repeat(40),
    workspaceDirty: false,
    lockfileSha256: "d".repeat(64),
    worktreeContentSha256: "e".repeat(64),
  };
}

function startedEvent(runId) {
  return { type: "run.started", binding: { agentRunId: runId }, payload: { status: "running" } };
}

function completedEvent(changedFileCount) {
  return {
    type: "run.completed",
    payload: { changes: { status: "available", changedFileCount } },
  };
}

function failedEvent(code, message) {
  return { type: "run.failed", payload: { error: { code, message } } };
}

function toolStarted(id, name) {
  return { type: "tool.started", payload: { tool: { id, name, arguments: {} } } };
}

function toolCompleted(id, name, success) {
  return {
    type: "tool.completed",
    payload: { tool: { id, name, success, output: "SECRET_TOOL_OUTPUT" } },
  };
}

function toJsonl(events) {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}
