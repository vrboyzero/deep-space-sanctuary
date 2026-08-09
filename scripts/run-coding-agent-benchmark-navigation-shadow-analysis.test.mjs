import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  buildNavigationShadowAnalysis,
  parseNavigationShadowAnalysisCliArguments,
  writeNavigationShadowAnalysisArtifact,
} from "./run-coding-agent-benchmark-navigation-shadow-analysis.mjs";

describe("coding agent navigation shadow failure analysis", () => {
  it("rejects candidate v1 from two matching product failures without claiming new execution", async () => {
    const artifact = buildNavigationShadowAnalysis(fixture());

    expect(artifact).toMatchObject({
      status: "completed",
      candidateId: "workspace-write-navigation-candidate-v1",
      decision: {
        status: "do_not_promote",
        technicalDebtDecision: "split_task",
        requiresNewProviderAuthorization: true,
      },
      execution: {
        mode: "offline-analysis",
        modelCalls: 0,
        providerCostUsd: 0,
        v3AggregateModified: false,
      },
      crossPlatform: {
        sharedFailureSignature: true,
        sameRepositorySnapshotIdentity: true,
        providerUsageComplete: true,
        navigationToolsObserved: true,
        totalObservedCostCny: 0.03801976,
      },
      attribution: {
        primary: "model_navigation_strategy_not_constrained",
      },
    });
    expect(artifact.platforms).toEqual([
      expect.objectContaining({
        platform: "windows-native",
        comparison: expect.objectContaining({
          totalTokenDelta: 8443,
          modelVisibleResponseBytesDelta: 2232,
        }),
        tools: expect.objectContaining({
          textSearchReturnedCount: 13,
          ellipsizedResultCount: 3,
          fullTargetReadBeforeTextSearch: true,
        }),
      }),
      expect.objectContaining({
        platform: "wsl2-linux",
        comparison: expect.objectContaining({
          totalTokenDelta: 7095,
          modelVisibleResponseBytesDelta: 756,
        }),
      }),
    ]);

    const schema = JSON.parse(await fs.readFile(path.join(
      path.resolve("."),
      "benchmarks/coding-agent/v3/navigation-shadow-analysis.schema.json",
    ), "utf-8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.validator.validateOutput(JSON.stringify(artifact))).toMatchObject({ ok: true });
    }
  });

  it("fails closed on snapshot identity drift or denied host command evidence", () => {
    const identityDrift = fixture();
    identityDrift.platformInputs[1].shadowArtifact.source.repositorySnapshotIdentitySha256 =
      "9".repeat(64);
    expect(() => buildNavigationShadowAnalysis(identityDrift))
      .toThrow(/repository snapshot identity/i);

    const hostCommand = fixture();
    hostCommand.platformInputs[0].events.splice(-2, 0, {
      type: "tool.started",
      payload: { tool: { id: "host-1", name: "run_command", arguments: {} } },
    });
    expect(() => buildNavigationShadowAnalysis(hostCommand)).toThrow(/run_command/i);

    const preflightDrift = fixture();
    preflightDrift.platformInputs[0].preflight.runId = "different-run";
    expect(() => buildNavigationShadowAnalysis(preflightDrift)).toThrow(/preflight/i);
  });

  it("parses four explicit evidence roots and rejects unknown flags", () => {
    expect(parseNavigationShadowAnalysisCliArguments([
      "--windows-shadow-root", "artifacts/shadow/windows-native",
      "--windows-navigation-root", "artifacts/navigation/windows-native",
      "--wsl-shadow-root", "artifacts/shadow/wsl2-linux",
      "--wsl-navigation-root", "artifacts/navigation/wsl2-linux",
      "--output-root", "artifacts/analysis",
      "--generated-at", "2026-08-09T00:00:00.000Z",
    ])).toEqual({
      windowsShadowRoot: "artifacts/shadow/windows-native",
      windowsNavigationRoot: "artifacts/navigation/windows-native",
      wslShadowRoot: "artifacts/shadow/wsl2-linux",
      wslNavigationRoot: "artifacts/navigation/wsl2-linux",
      outputRoot: "artifacts/analysis",
      generatedAt: "2026-08-09T00:00:00.000Z",
    });
    expect(() => parseNavigationShadowAnalysisCliArguments(["--unknown", "value"]))
      .toThrow(/unknown navigation shadow analysis argument/i);
  });

  it("writes once to a new output root and rejects overwrite", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "navigation-shadow-analysis-"));
    const outputRoot = path.join(tempRoot, "output");
    try {
      const artifact = buildNavigationShadowAnalysis(fixture());
      await writeNavigationShadowAnalysisArtifact(outputRoot, artifact);
      await expect(fs.readFile(path.join(outputRoot, "navigation-shadow-analysis.json"), "utf-8"))
        .resolves.toContain("coding-agent-benchmark-navigation-shadow-analysis/v1");
      await expect(writeNavigationShadowAnalysisArtifact(outputRoot, artifact))
        .rejects.toThrow(/already exists/i);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});

function fixture() {
  const baseline = {
    runId: "baseline-run",
    inputTokens: 23078,
    outputTokens: 2773,
    totalTokens: 25851,
    modelCalls: 4,
    toolCallCount: 5,
    changedFileCount: 0,
    budgetExhausted: true,
    modelVisibleResponseBytes: 6141,
  };
  const offlineCandidate = {
    toolCallCount: 3,
    modelVisibleResponseBytes: 2212,
  };
  return {
    generatedAt: "2026-08-09T00:00:00.000Z",
    platformInputs: [
      platformFixture({
        platform: "windows-native",
        runId: "shadow-windows-a1",
        inputTokens: 32236,
        outputTokens: 2058,
        costUsd: 0.00255264,
        costCny: 0.02042112,
        responseBytes: [833, 359, 700, 2051, 2051, 328, 2051],
        returnedCount: 13,
        supplementalTool: "file_glob",
        supplementalReadPath: "test/req.subdomains.js",
        supplementalReadArguments: {},
        ellipsizedIndexes: [3, 4, 6],
        baseline,
        offlineCandidate,
      }),
      platformFixture({
        platform: "wsl2-linux",
        runId: "shadow-wsl-a1",
        inputTokens: 30481,
        outputTokens: 2465,
        costUsd: 0.00219983,
        costCny: 0.01759864,
        responseBytes: [833, 359, 700, 2051, 2051, 506, 397],
        returnedCount: 5,
        supplementalTool: "list_files",
        supplementalReadPath: "lib/request.js",
        supplementalReadArguments: { offset: 360, limit: 60 },
        ellipsizedIndexes: [3, 4],
        baseline,
        offlineCandidate,
      }),
    ],
  };
}

function platformFixture(input) {
  const navigationEvidence = {
    schemaVersion: "coding-agent-benchmark-navigation-efficiency/v1",
    platform: input.platform,
    status: "eligible_for_canary",
    profile: { id: "workspace-write-navigation-candidate-v1", manifestModified: false },
    source: { baselineRunId: input.baseline.runId, baselineCommit: "5".repeat(40) },
    baseline: input.baseline,
    candidate: input.offlineCandidate,
    comparison: { tokenImpact: { status: "not_measured", reason: "no_model_call" } },
  };
  const navigationEvidenceText = JSON.stringify(navigationEvidence);
  const calls = [
    { name: "list_files", arguments: { path: ".", depth: 2 } },
    { name: "file_glob", arguments: { include: "test/benchmark-v3/real-js-bug-fix.js" } },
    { name: "file_read", arguments: { path: "test/benchmark-v3/real-js-bug-fix.js" } },
    { name: "file_read", arguments: { path: "lib/request.js" } },
    { name: "text_search", arguments: { query: "subdomain offset", path: "." } },
    { name: input.supplementalTool, arguments: { path: "lib" } },
    {
      name: "file_read",
      arguments: { path: input.supplementalReadPath, ...input.supplementalReadArguments },
    },
  ];
  const events = [{ type: "run.started" }];
  calls.forEach((call, index) => {
    const id = `tool-${index}`;
    events.push({ type: "tool.started", payload: { tool: { id, ...call } } });
    events.push({
      type: "tool.completed",
      payload: {
        tool: {
          id,
          name: call.name,
          success: true,
          output: `${"x".repeat(Math.max(0, input.responseBytes[index] - 3))}${
            input.ellipsizedIndexes.includes(index) ? "\u2026" : "xxx"
          }`,
          ...(call.name === "text_search"
            ? { metadata: { returnedCount: input.returnedCount, ignoreOverride: false } }
            : {}),
        },
      },
    });
  });
  const totalTokens = input.inputTokens + input.outputTokens;
  events.push({
    type: "run.usage",
    payload: {
      usage: {
        source: "provider_reported",
        input: input.inputTokens,
        output: input.outputTokens,
        modelCalls: 5,
        providerReportedModelCalls: 5,
        costUsd: input.costUsd,
      },
    },
  });
  events.push({
    type: "run.budget_exhausted",
    payload: { budget: { budget: "total_tokens", limit: 24000, observed: totalTokens } },
  });
  events.push({
    type: "run.failed",
    payload: { changes: { changedFileCount: 0 } },
  });
  const eventsText = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
  const shadowArtifact = {
    schemaVersion: "coding-agent-benchmark-navigation-shadow-real/v1",
    status: "completed",
    taskId: "real-js.bug-fix",
    platform: input.platform,
    candidate: { id: "workspace-write-navigation-candidate-v1", manifestModified: false },
    authorization: {
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      runCostCny: input.costCny,
    },
    execution: {
      v3AggregateEligible: false,
      modelCalls: 5,
      toolCallCount: 7,
      enteredEditPhase: false,
      budgetExhausted: true,
      hostCommandToolCalls: 0,
    },
    outcome: {
      runId: input.runId,
      status: "failed",
      failureCategory: "product_workflow",
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      totalTokens,
      costUsd: input.costUsd,
      changedPaths: [],
      evaluation: {
        source: "machine",
        taskCompleted: false,
        testsPassed: false,
        patchAccepted: false,
        regressionCount: 1,
        manualInterventionCount: 0,
      },
    },
    comparison: { baseline: input.baseline },
    source: {
      navigationEvidenceSha256: sha256(navigationEvidenceText),
      manifestSha256: "a".repeat(64),
      baselineCommit: "5".repeat(40),
      candidateFixtureBaselineCommit: "6".repeat(40),
      repositorySnapshotIdentitySha256: "b".repeat(64),
      executionReportSha256: "c".repeat(64),
    },
    artifacts: { events: { path: `execution/${input.runId}/events.jsonl`, sha256: sha256(eventsText) } },
  };
  return {
    platform: input.platform,
    shadowArtifact,
    shadowArtifactText: JSON.stringify(shadowArtifact),
    navigationEvidence,
    navigationEvidenceText,
    events,
    eventsText,
    preflight: {
      schemaVersion: "coding-agent-benchmark-preflight/v1",
      manifestRevision: "v3",
      taskId: "real-js.bug-fix",
      runId: input.runId,
      status: "passed",
      checks: {
        contractSource: { status: "passed" },
        executionBudget: { status: "passed", maxTokens: 24000 },
      },
    },
    repositoryPreflight: {
      schemaVersion: "coding-agent-benchmark-snapshot-preflight/v1",
      taskId: "real-js.bug-fix",
      repositoryId: "express",
      status: "passed",
      checks: {
        manifestBinding: { status: "passed" },
        sourceIdentity: { status: "passed" },
        license: { status: "passed" },
        dependencyCache: { status: "passed" },
        executionNetwork: { status: "passed" },
      },
    },
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
