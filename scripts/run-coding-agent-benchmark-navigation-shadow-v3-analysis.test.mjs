import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  buildNavigationShadowV3Analysis,
  parseNavigationShadowV3AnalysisCliArguments,
  writeNavigationShadowV3AnalysisArtifact,
} from "./run-coding-agent-benchmark-navigation-shadow-v3-analysis.mjs";

describe("coding agent navigation shadow v3 analysis", () => {
  it("recomputes baseline and three candidate generations before stopping the candidate line", async () => {
    const artifact = buildNavigationShadowV3Analysis(fixture());

    expect(artifact).toMatchObject({
      schemaVersion: "coding-agent-benchmark-navigation-shadow-v3-analysis/v1",
      status: "completed",
      candidateId: "workspace-write-navigation-candidate-v3",
      decision: {
        status: "do_not_promote",
        candidateLineStatus: "stopped",
        technicalDebtDecision: "split_task",
        nextAction: "separate-model-loop-budget-and-termination-contract",
        nextActionMode: "offline",
        providerExpansionAllowed: false,
        requiresNewProviderAuthorizationForAnyFutureCanary: true,
      },
      execution: {
        mode: "offline-analysis",
        modelCalls: 0,
        providerCostUsd: 0,
        networkCalls: 0,
        hostCommandToolCalls: 0,
        v3AggregateModified: false,
      },
      runtimeGuardBenefit: {
        globArgumentContractStable: true,
        responseBytesReducedVsBaselineOnBothPlatforms: true,
        responseBytesReducedVsV2OnBothPlatforms: true,
        taskOutcomeImproved: false,
        tokenUpliftObserved: false,
        v3ResponseBytesSpread: 10,
      },
      crossPlatform: {
        sharedFailureSignature: true,
        allCandidatesFailedBeforeEdit: true,
        providerUsageComplete: true,
        totalObservedCostCny: 0.08318752,
      },
      attribution: {
        primary: "tool_argument_guard_reduces_response_surface_but_not_model_loop_budget",
      },
    });
    expect(artifact.baseline).toMatchObject({
      totalTokens: 25851,
      modelVisibleResponseBytes: 6141,
      toolSequence: ["list_files", "file_read", "file_read", "file_read", "list_files"],
    });
    expect(artifact.platforms).toEqual([
      expect.objectContaining({
        platform: "windows-native",
        candidates: [
          expect.objectContaining({ candidateId: "workspace-write-navigation-candidate-v1", totalTokens: 34294 }),
          expect.objectContaining({ candidateId: "workspace-write-navigation-candidate-v2", totalTokens: 24580 }),
          expect.objectContaining({
            candidateId: "workspace-write-navigation-candidate-v3",
            totalTokens: 27813,
            modelVisibleResponseBytes: 2652,
          }),
        ],
        v3RuntimeContract: expect.objectContaining({
          compliant: true,
          cappedGlobCallCount: 1,
          navigationSequenceCompliant: false,
          repeatedCompleteFileReadCount: 1,
        }),
        comparison: expect.objectContaining({
          v3VsBaselineTotalTokenDelta: 1962,
          v3VsCandidateV1TotalTokenDelta: -6481,
          v3VsCandidateV2TotalTokenDelta: 3233,
          v3VsBaselineResponseBytesDelta: -3489,
          v3VsCandidateV2ResponseBytesDelta: -2896,
        }),
      }),
      expect.objectContaining({
        platform: "wsl2-linux",
        candidates: [
          expect.objectContaining({ candidateId: "workspace-write-navigation-candidate-v1", totalTokens: 32946 }),
          expect.objectContaining({ candidateId: "workspace-write-navigation-candidate-v2", totalTokens: 30701 }),
          expect.objectContaining({
            candidateId: "workspace-write-navigation-candidate-v3",
            totalTokens: 26166,
            modelVisibleResponseBytes: 2662,
          }),
        ],
        v3RuntimeContract: expect.objectContaining({
          compliant: true,
          cappedGlobCallCount: 2,
          navigationSequenceCompliant: true,
          repeatedCompleteFileReadCount: 0,
        }),
        comparison: expect.objectContaining({
          v3VsBaselineTotalTokenDelta: 315,
          v3VsCandidateV1TotalTokenDelta: -6780,
          v3VsCandidateV2TotalTokenDelta: -4535,
          v3VsBaselineResponseBytesDelta: -3479,
          v3VsCandidateV2ResponseBytesDelta: -6657,
        }),
      }),
    ]);

    const schema = JSON.parse(await fs.readFile(path.join(
      path.resolve("."),
      "benchmarks/coding-agent/v3/navigation-shadow-v3-analysis.schema.json",
    ), "utf-8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.validator.validateOutput(JSON.stringify(artifact))).toMatchObject({ ok: true });
    }
  });

  it("fails closed on source identity, usage, or denied host-command drift", () => {
    const identity = fixture();
    identity.platformInputs[1].v3Shadow.source.repositorySnapshotIdentitySha256 = "9".repeat(64);
    expect(() => buildNavigationShadowV3Analysis(identity))
      .toThrow(/repository snapshot identity/i);

    const usage = fixture();
    usage.platformInputs[0].v3Events.at(-3).payload.usage.source = "estimated";
    expect(() => buildNavigationShadowV3Analysis(usage)).toThrow(/provider usage/i);

    const hostCommand = fixture();
    hostCommand.platformInputs[0].v3Events.splice(-3, 0, {
      type: "tool.started",
      payload: { tool: { id: "host-1", name: "run_command", arguments: {} } },
    });
    expect(() => buildNavigationShadowV3Analysis(hostCommand)).toThrow(/run_command/i);
  });

  it("fails closed when runtime metadata or the shared failure evidence drifts", () => {
    const runtime = fixture();
    const completion = runtime.platformInputs[1].v3Events
      .find((event) => event.type === "tool.completed" && event.payload.tool.name === "file_glob");
    completion.payload.tool.metadata.argumentValidation.toolArgumentPolicy = "default";
    expect(() => buildNavigationShadowV3Analysis(runtime)).toThrow(/runtime contract/i);

    const outcome = fixture();
    outcome.platformInputs[1].v3Shadow.execution.enteredEditPhase = true;
    expect(() => buildNavigationShadowV3Analysis(outcome)).toThrow(/shared failure/i);
  });

  it("parses explicit roots and writes once to a new output root", async () => {
    expect(parseNavigationShadowV3AnalysisCliArguments([
      "--baseline-run-root", "artifacts/p0.17/baseline",
      "--v1-analysis-root", "artifacts/p0.21",
      "--v1-shadow-root", "artifacts/p0.20",
      "--v2-analysis-root", "artifacts/p0.24",
      "--v2-shadow-root", "artifacts/p0.23",
      "--v3-candidate-root", "artifacts/p0.25",
      "--v3-shadow-root", "artifacts/p0.26",
      "--output-root", "artifacts/p0.27",
      "--generated-at", "2026-08-09T00:00:00.000Z",
    ])).toEqual({
      baselineRunRoot: "artifacts/p0.17/baseline",
      v1AnalysisRoot: "artifacts/p0.21",
      v1ShadowRoot: "artifacts/p0.20",
      v2AnalysisRoot: "artifacts/p0.24",
      v2ShadowRoot: "artifacts/p0.23",
      v3CandidateRoot: "artifacts/p0.25",
      v3ShadowRoot: "artifacts/p0.26",
      outputRoot: "artifacts/p0.27",
      generatedAt: "2026-08-09T00:00:00.000Z",
    });
    expect(() => parseNavigationShadowV3AnalysisCliArguments(["--unknown", "value"]))
      .toThrow(/unknown navigation shadow v3 analysis argument/i);

    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "navigation-shadow-v3-analysis-"));
    const outputRoot = path.join(tempRoot, "output");
    try {
      const artifact = buildNavigationShadowV3Analysis(fixture());
      await writeNavigationShadowV3AnalysisArtifact(outputRoot, artifact);
      await expect(fs.readFile(
        path.join(outputRoot, "navigation-shadow-v3-analysis.json"),
        "utf-8",
      )).resolves.toContain("coding-agent-benchmark-navigation-shadow-v3-analysis/v1");
      await expect(writeNavigationShadowV3AnalysisArtifact(outputRoot, artifact))
        .rejects.toThrow(/already exists/i);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});

function fixture() {
  const baseline = {
    runId: "real-js-bug-fix-windows-a1-1786205121145",
    inputTokens: 23078,
    outputTokens: 2773,
    totalTokens: 25851,
    modelCalls: 4,
    toolCallCount: 5,
    changedFileCount: 0,
    budgetExhausted: true,
    modelVisibleResponseBytes: 6141,
  };
  const baselineCalls = [
    call("b1", "list_files", { path: ".", depth: 2 }, 833),
    call("b2", "file_read", { path: "test/benchmark-v3/real-js-bug-fix.js" }, 700),
    call("b3", "file_read", { path: "lib/request.js" }, 2051),
    call("b4", "file_read", { path: "lib/application.js" }, 2051),
    call("b5", "list_files", { path: "lib" }, 506),
  ];
  const baselineEvents = eventsFor({
    calls: baselineCalls,
    inputTokens: baseline.inputTokens,
    outputTokens: baseline.outputTokens,
    modelCalls: baseline.modelCalls,
    costUsd: 0.00280969,
  });
  const baselineEventsText = jsonLines(baselineEvents);
  const manifestSha256 = "2".repeat(64);
  const baselineCommit = "3".repeat(40);
  const repositorySnapshotIdentitySha256 = "5".repeat(64);

  const v1Raw = [
    rawCandidate({
      version: 1,
      platform: "windows-native",
      runId: "v1-windows",
      inputTokens: 32236,
      outputTokens: 2058,
      modelCalls: 5,
      costUsd: 0.00255264,
      costCny: 0.02042112,
      calls: [
        call("v1w1", "list_files", {}, 900),
        call("v1w2", "file_glob", {}, 700),
        call("v1w3", "file_read", { path: "test/benchmark-v3/real-js-bug-fix.js" }, 700),
        call("v1w4", "file_read", { path: "lib/request.js" }, 2051),
        call("v1w5", "text_search", {}, 1500),
        call("v1w6", "file_glob", {}, 1000),
        call("v1w7", "file_read", { path: "lib/application.js" }, 1522),
      ],
      manifestSha256,
      baselineCommit,
      repositorySnapshotIdentitySha256,
    }),
    rawCandidate({
      version: 1,
      platform: "wsl2-linux",
      runId: "v1-wsl",
      inputTokens: 30481,
      outputTokens: 2465,
      modelCalls: 5,
      costUsd: 0.00219983,
      costCny: 0.01759864,
      calls: [
        call("v1l1", "list_files", {}, 700),
        call("v1l2", "file_glob", {}, 600),
        call("v1l3", "file_read", { path: "test/benchmark-v3/real-js-bug-fix.js" }, 700),
        call("v1l4", "file_read", { path: "lib/request.js" }, 2051),
        call("v1l5", "text_search", {}, 1200),
        call("v1l6", "list_files", {}, 600),
        call("v1l7", "file_read", { path: "lib/application.js" }, 1046),
      ],
      manifestSha256,
      baselineCommit,
      repositorySnapshotIdentitySha256,
    }),
  ];
  const v1Analysis = analysisV1(baseline, v1Raw, manifestSha256, baselineCommit,
    repositorySnapshotIdentitySha256);
  const v1AnalysisText = JSON.stringify(v1Analysis);

  const v2Raw = [
    rawCandidate({
      version: 2,
      platform: "windows-native",
      runId: "v2-windows",
      inputTokens: 22493,
      outputTokens: 2087,
      modelCalls: 6,
      costUsd: 0.00126362,
      costCny: 0.01010896,
      calls: [
        failedCall("v2w1", "file_glob", { include: ["test/**/*.js"] }),
        failedCall("v2w2", "file_glob", { include: ["lib/**/*.js"] }),
        call("v2w3", "file_glob", { include: "test/**/*.js" }, 500),
        call("v2w4", "file_glob", { include: "lib/**/*.js" }, 500),
        call("v2w5", "file_read", { path: "test/benchmark-v3/real-js-bug-fix.js" }, 700),
        call("v2w6", "text_search", {}, 1900),
        call("v2w7", "text_search", {}, 1948),
      ],
      manifestSha256,
      baselineCommit,
      repositorySnapshotIdentitySha256,
      previousAnalysisSha256: sha256(v1AnalysisText),
      promptCompliant: true,
    }),
    rawCandidate({
      version: 2,
      platform: "wsl2-linux",
      runId: "v2-wsl",
      inputTokens: 28926,
      outputTokens: 1775,
      modelCalls: 5,
      costUsd: 0.00224061,
      costCny: 0.01792488,
      calls: [
        call("v2l1", "file_glob", {}, 2500, { returnedCount: 202 }),
        call("v2l2", "file_glob", {}, 2500, { returnedCount: 202 }),
        call("v2l3", "file_read", { path: "test/benchmark-v3/real-js-bug-fix.js" }, 700),
        call("v2l4", "text_search", {}, 1200),
        call("v2l5", "text_search", {}, 1200),
        call("v2l6", "file_read", { path: "lib/request.js", offset: 360, limit: 60 }, 1219),
      ],
      manifestSha256,
      baselineCommit,
      repositorySnapshotIdentitySha256,
      previousAnalysisSha256: sha256(v1AnalysisText),
      promptCompliant: false,
    }),
  ];
  const v2Analysis = analysisV2(baseline, v1Raw, v2Raw, sha256(v1AnalysisText));
  const v2AnalysisText = JSON.stringify(v2Analysis);

  const platformInputs = v2Raw.map((v2, index) => {
    const platform = v2.platform;
    const candidateEvidence = candidateV3Evidence({
      platform,
      analysisSha256: sha256(v2AnalysisText),
      previousCandidateEvidenceSha256: v2Analysis.platforms[index].source.candidateEvidenceSha256,
      previousShadowArtifactSha256: sha256(v2.artifactText),
      manifestSha256,
      baselineCommit,
      repositorySnapshotIdentitySha256,
    });
    const candidateEvidenceText = JSON.stringify(candidateEvidence);
    const v3Calls = platform === "windows-native"
      ? [
          runtimeGlob("v3w1", { include: "test/benchmark-v3/real-js-bug-fix.js" }, 359, true),
          runtimeGlob("v3w2", { include: "lib/**/*.js", maxResults: 20 }, 397, false),
          call("v3w3", "file_read", { path: "test/benchmark-v3/real-js-bug-fix.js" }, 503),
          call("v3w4", "text_search", boundedSearch("subdomains"), 503),
          call("v3w5", "file_read", { path: "lib/request.js", offset: 355, limit: 50 }, 387),
          call("v3w6", "file_read", { path: "lib/request.js", offset: 11000, limit: 1813 }, 503),
        ]
      : [
          runtimeGlob("v3l1", { include: "test/benchmark-v3/real-js-bug-fix.js" }, 359, true),
          runtimeGlob("v3l2", { include: "lib/**/*.js" }, 397, true),
          call("v3l3", "file_read", { path: "test/benchmark-v3/real-js-bug-fix.js" }, 503),
          call("v3l4", "text_search", boundedSearch("subdomains"), 503),
          call("v3l5", "text_search", { ...boundedSearch("offset"), contextLines: 8 }, 503),
          call("v3l6", "file_read", { path: "lib/request.js", offset: 360, limit: 60 }, 397),
        ];
    const v3Events = eventsFor({
      calls: v3Calls,
      inputTokens: platform === "windows-native" ? 24290 : 24888,
      outputTokens: platform === "windows-native" ? 3523 : 1278,
      modelCalls: 6,
      costUsd: platform === "windows-native" ? 0.00132981 : 0.00081193,
    });
    const v3EventsText = jsonLines(v3Events);
    const v3Shadow = shadowV3Artifact({
      platform,
      runId: platform === "windows-native" ? "v3-windows" : "v3-wsl",
      inputTokens: platform === "windows-native" ? 24290 : 24888,
      outputTokens: platform === "windows-native" ? 3523 : 1278,
      costUsd: platform === "windows-native" ? 0.00132981 : 0.00081193,
      costCny: platform === "windows-native" ? 0.01063848 : 0.00649544,
      v3Calls,
      v3EventsText,
      candidateEvidenceText,
      analysisSha256: sha256(v2AnalysisText),
      v2ArtifactSha256: sha256(v2.artifactText),
      v2CandidateEvidenceSha256: v2Analysis.platforms[index].source.candidateEvidenceSha256,
      manifestSha256,
      baselineCommit,
      repositorySnapshotIdentitySha256,
    });
    return {
      platform,
      v1Shadow: v1Raw[index].artifact,
      v1ShadowText: v1Raw[index].artifactText,
      v1Events: v1Raw[index].events,
      v1EventsText: v1Raw[index].eventsText,
      v1Preflight: passedPreflight(v1Raw[index].runId),
      v1RepositoryPreflight: passedRepositoryPreflight(),
      v2Shadow: v2.artifact,
      v2ShadowText: v2.artifactText,
      v2Events: v2.events,
      v2EventsText: v2.eventsText,
      v2Preflight: passedPreflight(v2.runId),
      v2RepositoryPreflight: passedRepositoryPreflight(),
      v3Candidate: candidateEvidence,
      v3CandidateText: candidateEvidenceText,
      v3Shadow,
      v3ShadowText: JSON.stringify(v3Shadow),
      v3Events,
      v3EventsText,
      v3Preflight: passedPreflight(v3Shadow.outcome.runId),
      v3RepositoryPreflight: passedRepositoryPreflight(),
    };
  });

  return {
    generatedAt: "2026-08-09T00:00:00.000Z",
    baselineEvents,
    baselineEventsText,
    baselinePreflight: passedPreflight(baseline.runId),
    v1Analysis,
    v1AnalysisText,
    v2Analysis,
    v2AnalysisText,
    platformInputs,
  };
}

function rawCandidate(input) {
  const events = eventsFor(input);
  const eventsText = jsonLines(events);
  const totalTokens = input.inputTokens + input.outputTokens;
  const artifact = {
    schemaVersion: `coding-agent-benchmark-navigation-shadow-real${input.version === 1 ? "" : "-v2"}/v1`,
    status: "completed",
    taskId: "real-js.bug-fix",
    platform: input.platform,
    candidate: {
      id: `workspace-write-navigation-candidate-v${input.version}`,
      manifestModified: false,
    },
    authorization: {
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      runCostCny: input.costCny,
    },
    execution: {
      v3AggregateEligible: false,
      hostCommandToolCalls: 0,
      modelCalls: input.modelCalls,
      toolCallCount: input.calls.length,
      toolCompletedCount: input.calls.length,
      enteredEditPhase: false,
      budgetExhausted: true,
    },
    ...(input.version === 2 ? {
      promptContract: {
        compliant: input.promptCompliant,
        fileGlobBeforeSourceRead: input.promptCompliant,
        regressionTestReadBeforeSourceInspection: true,
        boundedTextSearchObserved: true,
        fullTargetReadBeforeLocalization: false,
        repeatedCompleteFileReadCount: 0,
      },
    } : {}),
    outcome: {
      runId: input.runId,
      status: "failed",
      failureCategory: "product_workflow",
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      totalTokens,
      costUsd: input.costUsd,
      changedPaths: [],
      evaluation: failedEvaluation(),
    },
    source: {
      ...(input.previousAnalysisSha256 ? { analysisSha256: input.previousAnalysisSha256 } : {}),
      manifestSha256: input.manifestSha256,
      baselineCommit: input.baselineCommit,
      repositorySnapshotIdentitySha256: input.repositorySnapshotIdentitySha256,
    },
    artifacts: {
      events: { path: "execution/events.jsonl", sha256: sha256(eventsText) },
      preflight: { path: "execution/preflight.json", sha256: "6".repeat(64) },
      repositorySnapshotPreflight: {
        path: "execution/repository-snapshot-preflight.json",
        sha256: "7".repeat(64),
      },
    },
  };
  return {
    ...input,
    totalTokens,
    events,
    eventsText,
    artifact,
    artifactText: JSON.stringify(artifact),
  };
}

function analysisV1(baseline, raw, manifestSha256, baselineCommit, snapshotSha256) {
  return {
    schemaVersion: "coding-agent-benchmark-navigation-shadow-analysis/v1",
    status: "completed",
    taskId: "real-js.bug-fix",
    candidateId: "workspace-write-navigation-candidate-v1",
    model: { provider: "deepseek", id: "deepseek-v4-flash" },
    decision: { status: "do_not_promote", nextCandidate: "navigation-candidate-v2-required" },
    baseline,
    platforms: raw.map((item) => ({
      platform: item.platform,
      runId: item.runId,
      outcome: { status: "failed", failureCategory: "product_workflow" },
      usage: usageSummary(item),
      budget: { kind: "total_tokens", limit: 24000, observed: item.totalTokens },
      tools: {
        callCount: item.calls.length,
        completedCount: item.calls.length,
        allSucceeded: true,
        sequence: item.calls.map((callItem) => callItem.name),
        modelVisibleResponseBytes: sumResponseBytes(item.calls),
        editCallCount: 0,
      },
      execution: failedExecution(),
      evaluator: failedEvaluation(),
      source: {
        shadowArtifactSha256: sha256(item.artifactText),
        eventsSha256: sha256(item.eventsText),
        manifestSha256,
        baselineCommit,
        repositorySnapshotIdentitySha256: snapshotSha256,
      },
    })),
    crossPlatform: { totalObservedCostCny: 0.03801976 },
  };
}

function analysisV2(baseline, v1Raw, raw, v1AnalysisSha256) {
  return {
    schemaVersion: "coding-agent-benchmark-navigation-shadow-v2-analysis/v1",
    status: "completed",
    taskId: "real-js.bug-fix",
    candidateId: "workspace-write-navigation-candidate-v2",
    model: { provider: "deepseek", id: "deepseek-v4-flash" },
    decision: {
      status: "do_not_promote",
      nextCandidate: "navigation-candidate-v3-runtime-contract-required",
    },
    baseline,
    platforms: raw.map((item, index) => ({
      platform: item.platform,
      runId: item.runId,
      outcome: { status: "failed", failureCategory: "product_workflow" },
      usage: usageSummary(item),
      budget: { kind: "total_tokens", limit: 24000, observed: item.totalTokens },
      promptContract: {
        compliant: item.promptCompliant,
        enforcement: "prompt_contract",
        runtimeToolGuard: false,
      },
      tools: {
        callCount: item.calls.length,
        successfulCount: item.calls.filter((callItem) => callItem.success).length,
        failedCount: item.calls.filter((callItem) => !callItem.success).length,
        sequence: item.calls.map((callItem) => callItem.name),
        modelVisibleResponseBytes: sumResponseBytes(item.calls),
        editCallCount: 0,
      },
      execution: failedExecution(),
      evaluator: failedEvaluation(),
      source: {
        shadowArtifactSha256: sha256(item.artifactText),
        candidateEvidenceSha256: index === 0 ? "a".repeat(64) : "b".repeat(64),
        v1AnalysisSha256,
        eventsSha256: sha256(item.eventsText),
        manifestSha256: item.manifestSha256,
        baselineCommit: item.baselineCommit,
        repositorySnapshotIdentitySha256: item.repositorySnapshotIdentitySha256,
      },
      comparison: {
        vsCandidateV1TotalTokenDelta: item.totalTokens - v1Raw[index].totalTokens,
      },
    })),
    crossPlatform: { totalObservedCostCny: 0.02803384 },
  };
}

function candidateV3Evidence(input) {
  return {
    schemaVersion: "coding-agent-benchmark-navigation-candidate-v3/v1",
    status: "eligible_for_shadow_readiness",
    platform: input.platform,
    taskId: "real-js.bug-fix",
    candidate: {
      id: "workspace-write-navigation-candidate-v3",
      strategy: {
        id: "bounded-navigation-runtime-contract/v1",
        enforcement: "runtime_contract",
        runtimeToolGuard: true,
      },
      toolArgumentPolicy: "bounded-navigation-v1",
    },
    execution: { modelCalls: 0, networkCalls: 0, hostCommandToolCalls: 0 },
    replay: {
      toolCallCount: 4,
      modelVisibleResponseBytes: 2491,
      sequence: ["file_glob", "file_glob", "file_read", "text_search"],
    },
    comparison: { tokenImpact: { status: "not_measured", reason: "no_model_call" } },
    source: {
      analysisSha256: input.analysisSha256,
      candidateV2EvidenceSha256: input.previousCandidateEvidenceSha256,
      shadowV2ArtifactSha256: input.previousShadowArtifactSha256,
      manifestSha256: input.manifestSha256,
      baselineCommit: input.baselineCommit,
      repositorySnapshotIdentitySha256: input.repositorySnapshotIdentitySha256,
    },
  };
}

function shadowV3Artifact(input) {
  const totalTokens = input.inputTokens + input.outputTokens;
  const runtime = runtimeSummary(input.v3Calls);
  return {
    schemaVersion: "coding-agent-benchmark-navigation-shadow-real-v3/v1",
    status: "completed",
    taskId: "real-js.bug-fix",
    platform: input.platform,
    candidate: {
      id: "workspace-write-navigation-candidate-v3",
      manifestModified: false,
      strategy: {
        id: "bounded-navigation-runtime-contract/v1",
        enforcement: "runtime_contract",
        runtimeToolGuard: true,
      },
      toolArgumentPolicy: "bounded-navigation-v1",
    },
    authorization: {
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      runCostCny: input.costCny,
    },
    execution: {
      v3AggregateEligible: false,
      hostCommandToolCalls: 0,
      modelCalls: 6,
      toolCallCount: input.v3Calls.length,
      toolCompletedCount: input.v3Calls.length,
      enteredEditPhase: false,
      budgetExhausted: true,
    },
    runtimeContract: runtime,
    outcome: {
      runId: input.runId,
      status: "failed",
      failureCategory: "product_workflow",
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      totalTokens,
      costUsd: input.costUsd,
      changedPaths: [],
      evaluation: failedEvaluation(),
    },
    source: {
      candidateEvidenceSha256: sha256(input.candidateEvidenceText),
      analysisSha256: input.analysisSha256,
      previousCandidateEvidenceSha256: input.v2CandidateEvidenceSha256,
      previousShadowArtifactSha256: input.v2ArtifactSha256,
      manifestSha256: input.manifestSha256,
      baselineCommit: input.baselineCommit,
      baselineRunId: "real-js-bug-fix-windows-a1-1786205121145",
      repositorySnapshotIdentitySha256: input.repositorySnapshotIdentitySha256,
    },
    artifacts: {
      events: { path: "execution/events.jsonl", sha256: sha256(input.v3EventsText) },
      preflight: { path: "execution/preflight.json", sha256: "6".repeat(64) },
      repositorySnapshotPreflight: {
        path: "execution/repository-snapshot-preflight.json",
        sha256: "7".repeat(64),
      },
    },
  };
}

function eventsFor(input) {
  const events = [{ type: "run.started" }];
  for (const item of input.calls) {
    events.push({
      type: "tool.started",
      payload: { tool: { id: item.id, name: item.name, arguments: item.arguments } },
    });
    events.push({
      type: "tool.completed",
      payload: { tool: {
        id: item.id,
        name: item.name,
        success: item.success,
        output: item.success ? "x".repeat(item.responseBytes) : "",
        ...(item.error ? { error: item.error } : {}),
        ...(item.metadata ? { metadata: item.metadata } : {}),
      } },
    });
  }
  events.push({
    type: "run.usage",
    payload: { usage: {
      source: "provider_reported",
      input: input.inputTokens,
      output: input.outputTokens,
      modelCalls: input.modelCalls,
      providerReportedModelCalls: input.modelCalls,
      costUsd: input.costUsd,
      completeness: { status: "complete" },
    } },
  });
  events.push({
    type: "run.budget_exhausted",
    payload: { budget: {
      budget: "total_tokens",
      limit: 24000,
      observed: input.inputTokens + input.outputTokens,
    } },
  });
  events.push({ type: "run.failed" });
  return events;
}

function call(id, name, argumentsValue, responseBytes, input = {}) {
  return {
    id,
    name,
    arguments: argumentsValue,
    responseBytes,
    success: true,
    ...(input.returnedCount === undefined ? {} : {
      metadata: { returnedCount: input.returnedCount, ignoreOverride: false },
    }),
  };
}

function failedCall(id, name, argumentsValue) {
  return { id, name, arguments: argumentsValue, responseBytes: 0, success: false, error: "invalid" };
}

function runtimeGlob(id, argumentsValue, responseBytes, corrected) {
  return {
    ...call(id, "file_glob", argumentsValue, responseBytes),
    metadata: {
      returnedCount: 1,
      repairAction: "tool_arguments_corrected",
      argumentValidation: {
        corrected,
        blocked: false,
        toolArgumentPolicy: "bounded-navigation-v1",
      },
    },
  };
}

function runtimeSummary(calls) {
  const windows = calls.some((item) => item.id.startsWith("v3w"));
  return {
    strategyId: "bounded-navigation-runtime-contract/v1",
    enforcement: "runtime_contract",
    runtimeToolGuard: true,
    promptHashMatched: true,
    toolArgumentPolicy: "bounded-navigation-v1",
    compliant: true,
    policyMetadataObserved: true,
    invalidGlobCallsBlocked: true,
    invalidGlobCallCount: 0,
    blockedGlobCallCount: 0,
    cappedGlobCallCount: windows ? 1 : 2,
    navigationSequenceCompliant: !windows,
    fileGlobBeforeSourceRead: true,
    regressionTestReadBeforeSourceInspection: true,
    boundedTextSearchObserved: true,
    fullTargetReadBeforeLocalization: false,
    repeatedCompleteFileReadCount: windows ? 1 : 0,
    toolSequence: calls.map((item) => item.name),
  };
}

function boundedSearch(query) {
  return { query, path: "lib", glob: "**/*.js", maxResults: 4, contextLines: 5 };
}

function usageSummary(item) {
  return {
    source: "provider_reported",
    complete: true,
    inputTokens: item.inputTokens,
    outputTokens: item.outputTokens,
    totalTokens: item.totalTokens,
    modelCalls: item.modelCalls,
    costUsd: item.costUsd,
    costCny: item.costCny,
  };
}

function failedExecution() {
  return { enteredEditPhase: false, budgetExhausted: true, changedFileCount: 0, preflightsPassed: true };
}

function failedEvaluation() {
  return {
    source: "machine",
    taskCompleted: false,
    testsPassed: false,
    patchAccepted: false,
    regressionCount: 1,
    manualInterventionCount: 0,
  };
}

function passedPreflight(runId) {
  return {
    schemaVersion: "coding-agent-benchmark-preflight/v1",
    manifestRevision: "v3",
    taskId: "real-js.bug-fix",
    runId,
    status: "passed",
    checks: {
      contractSource: { status: "passed" },
      executionBudget: { status: "passed", maxTokens: 24000 },
    },
  };
}

function passedRepositoryPreflight() {
  return {
    schemaVersion: "coding-agent-benchmark-snapshot-preflight/v1",
    taskId: "real-js.bug-fix",
    repositoryId: "express",
    status: "passed",
    checks: Object.fromEntries([
      "manifestBinding", "sourceIdentity", "license", "dependencyCache", "executionNetwork",
    ].map((name) => [name, { status: "passed" }])),
  };
}

function sumResponseBytes(calls) {
  return calls.filter((item) => item.success).reduce((total, item) => total + item.responseBytes, 0);
}

function jsonLines(events) {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
