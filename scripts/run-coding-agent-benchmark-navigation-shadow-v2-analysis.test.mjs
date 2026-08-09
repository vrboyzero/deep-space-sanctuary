import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  buildNavigationShadowV2Analysis,
  parseNavigationShadowV2AnalysisCliArguments,
  writeNavigationShadowV2AnalysisArtifact,
} from "./run-coding-agent-benchmark-navigation-shadow-v2-analysis.mjs";

describe("coding agent navigation shadow v2 analysis", () => {
  it("attributes the cross-platform candidate v2 failure and rejects promotion", async () => {
    const artifact = buildNavigationShadowV2Analysis(fixture());

    expect(artifact).toMatchObject({
      schemaVersion: "coding-agent-benchmark-navigation-shadow-v2-analysis/v1",
      status: "completed",
      candidateId: "workspace-write-navigation-candidate-v2",
      decision: {
        status: "do_not_promote",
        technicalDebtDecision: "split_task",
        nextCandidate: "navigation-candidate-v3-runtime-contract-required",
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
        promptContractStable: false,
        tokenOutcomeStable: false,
        totalObservedCostCny: 0.02803384,
      },
      attribution: {
        primary: "prompt_only_navigation_contract_not_runtime_stable",
      },
    });
    expect(artifact.platforms).toEqual([
      expect.objectContaining({
        platform: "windows-native",
        promptContract: expect.objectContaining({ compliant: true }),
        tools: expect.objectContaining({
          callCount: 7,
          successfulCount: 5,
          failedCount: 2,
          invalidGlobArgumentFailureCount: 2,
          broadGlobReturnedCount: 0,
          modelVisibleResponseBytes: 5548,
        }),
        comparison: expect.objectContaining({
          vsBaselineTotalTokenDelta: -1271,
          vsCandidateV1TotalTokenDelta: -9714,
          actualVsOfflineResponseBytesDelta: 3336,
          budgetOverflowTokens: 580,
        }),
      }),
      expect.objectContaining({
        platform: "wsl2-linux",
        promptContract: expect.objectContaining({ compliant: false }),
        tools: expect.objectContaining({
          callCount: 6,
          successfulCount: 6,
          failedCount: 0,
          invalidGlobArgumentFailureCount: 0,
          broadGlobReturnedCount: 404,
          modelVisibleResponseBytes: 9319,
        }),
        comparison: expect.objectContaining({
          vsBaselineTotalTokenDelta: 4850,
          vsCandidateV1TotalTokenDelta: -2245,
          actualVsOfflineResponseBytesDelta: 7107,
          budgetOverflowTokens: 6701,
        }),
      }),
    ]);

    const schema = JSON.parse(await fs.readFile(path.join(
      path.resolve("."),
      "benchmarks/coding-agent/v3/navigation-shadow-v2-analysis.schema.json",
    ), "utf-8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.validator.validateOutput(JSON.stringify(artifact))).toMatchObject({ ok: true });
    }
  });

  it("fails closed on source identity, usage, or denied host-command drift", () => {
    const identity = fixture();
    identity.platformInputs[1].shadowArtifact.source.repositorySnapshotIdentitySha256 =
      "9".repeat(64);
    expect(() => buildNavigationShadowV2Analysis(identity))
      .toThrow(/repository snapshot identity/i);

    const usage = fixture();
    usage.platformInputs[0].events.at(-3).payload.usage.source = "estimated";
    expect(() => buildNavigationShadowV2Analysis(usage)).toThrow(/provider usage/i);

    const hostCommand = fixture();
    hostCommand.platformInputs[0].events.splice(-3, 0, {
      type: "tool.started",
      payload: { tool: { id: "host-1", name: "run_command", arguments: {} } },
    });
    expect(() => buildNavigationShadowV2Analysis(hostCommand)).toThrow(/run_command/i);
  });

  it("fails closed when evidence no longer supports the runtime-contract attribution", () => {
    const noRuntimeMismatch = fixture();
    for (const event of noRuntimeMismatch.platformInputs[0].events) {
      if (event.type === "tool.completed" && event.payload.tool.success === false) {
        event.payload.tool.success = true;
        event.payload.tool.error = null;
      }
    }
    expect(() => buildNavigationShadowV2Analysis(noRuntimeMismatch))
      .toThrow(/runtime-contract attribution/i);

    const stablePrompt = fixture();
    stablePrompt.platformInputs[1].shadowArtifact.promptContract.compliant = true;
    expect(() => buildNavigationShadowV2Analysis(stablePrompt))
      .toThrow(/prompt-contract instability/i);
  });

  it("parses explicit roots and writes once to a new output root", async () => {
    expect(parseNavigationShadowV2AnalysisCliArguments([
      "--v1-analysis-root", "artifacts/p0.21",
      "--windows-shadow-root", "artifacts/p0.23/windows-native",
      "--windows-candidate-root", "artifacts/p0.22/windows-native",
      "--wsl-shadow-root", "artifacts/p0.23/wsl2-linux",
      "--wsl-candidate-root", "artifacts/p0.22/wsl2-linux",
      "--output-root", "artifacts/p0.24",
      "--generated-at", "2026-08-09T00:00:00.000Z",
    ])).toEqual({
      v1AnalysisRoot: "artifacts/p0.21",
      windowsShadowRoot: "artifacts/p0.23/windows-native",
      windowsCandidateRoot: "artifacts/p0.22/windows-native",
      wslShadowRoot: "artifacts/p0.23/wsl2-linux",
      wslCandidateRoot: "artifacts/p0.22/wsl2-linux",
      outputRoot: "artifacts/p0.24",
      generatedAt: "2026-08-09T00:00:00.000Z",
    });
    expect(() => parseNavigationShadowV2AnalysisCliArguments(["--unknown", "value"]))
      .toThrow(/unknown navigation shadow v2 analysis argument/i);

    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "navigation-shadow-v2-analysis-"));
    const outputRoot = path.join(tempRoot, "output");
    try {
      const artifact = buildNavigationShadowV2Analysis(fixture());
      await writeNavigationShadowV2AnalysisArtifact(outputRoot, artifact);
      await expect(fs.readFile(
        path.join(outputRoot, "navigation-shadow-v2-analysis.json"),
        "utf-8",
      )).resolves.toContain("coding-agent-benchmark-navigation-shadow-v2-analysis/v1");
      await expect(writeNavigationShadowV2AnalysisArtifact(outputRoot, artifact))
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
  const v1Analysis = {
    schemaVersion: "coding-agent-benchmark-navigation-shadow-analysis/v1",
    status: "completed",
    taskId: "real-js.bug-fix",
    candidateId: "workspace-write-navigation-candidate-v1",
    baseline,
    platforms: [
      v1Platform("windows-native", 34294, 5, 7, 8373),
      v1Platform("wsl2-linux", 32946, 5, 7, 6897),
    ],
  };
  const v1AnalysisText = JSON.stringify(v1Analysis);
  const common = { baseline, v1AnalysisSha256: sha256(v1AnalysisText) };
  return {
    generatedAt: "2026-08-09T00:00:00.000Z",
    v1Analysis,
    v1AnalysisText,
    platformInputs: [
      platformFixture({
        ...common,
        platform: "windows-native",
        runId: "shadow-v2-windows-a1",
        inputTokens: 22493,
        outputTokens: 2087,
        modelCalls: 6,
        costUsd: 0.00126362,
        costCny: 0.01010896,
        promptCompliant: true,
        calls: [
          failedGlob("tool-0", ["test/benchmark-v3/real-js-bug-fix.js"]),
          failedGlob("tool-1", ["lib/**/*.js"]),
          call("tool-2", "file_glob", { include: "test/benchmark-v3/real-js-bug-fix.js" }, 359, 1),
          call("tool-3", "file_glob", { include: "lib/**/*.js" }, 397, 6),
          call("tool-4", "file_read", { path: "test/benchmark-v3/real-js-bug-fix.js" }, 700),
          call("tool-5", "text_search", boundedSearch("subdomains"), 2051, 4),
          call("tool-6", "text_search", boundedSearch("subdomains", { cursor: "next" }), 2041, 3, true),
        ],
      }),
      platformFixture({
        ...common,
        platform: "wsl2-linux",
        runId: "shadow-v2-wsl-a1",
        inputTokens: 28926,
        outputTokens: 1775,
        modelCalls: 5,
        costUsd: 0.00224061,
        costCny: 0.01792488,
        promptCompliant: false,
        calls: [
          call("tool-0", "file_glob", {}, 2065, 202),
          call("tool-1", "file_glob", {}, 2065, 202),
          call("tool-2", "file_read", { path: "test/benchmark-v3/real-js-bug-fix.js" }, 700),
          call("tool-3", "text_search", boundedSearch("subdomains"), 2051, 4),
          call("tool-4", "text_search", boundedSearch("subdomain offset"), 2051, 4),
          call("tool-5", "file_read", { path: "lib/request.js", offset: 355, limit: 50 }, 387),
        ],
      }),
    ],
  };
}

function v1Platform(platform, totalTokens, modelCalls, toolCallCount, modelVisibleResponseBytes) {
  return {
    platform,
    usage: { totalTokens, modelCalls },
    tools: { callCount: toolCallCount, modelVisibleResponseBytes },
  };
}

function platformFixture(input) {
  const candidateEvidence = {
    schemaVersion: "coding-agent-benchmark-navigation-candidate-v2/v1",
    status: "eligible_for_shadow_readiness",
    platform: input.platform,
    taskId: "real-js.bug-fix",
    candidate: { id: "workspace-write-navigation-candidate-v2" },
    replay: { toolCallCount: 3, modelVisibleResponseBytes: 2212 },
    comparison: { tokenImpact: { status: "not_measured", reason: "no_model_call" } },
    source: { analysisSha256: input.v1AnalysisSha256 },
  };
  const candidateEvidenceText = JSON.stringify(candidateEvidence);
  const events = [{ type: "run.started" }];
  for (const item of input.calls) {
    events.push({ type: "tool.started", payload: { tool: {
      id: item.id, name: item.name, arguments: item.arguments,
    } } });
    events.push({ type: "tool.completed", payload: { tool: {
      id: item.id,
      name: item.name,
      success: item.success,
      output: item.success ? sizedOutput(item.responseBytes, item.ellipsized) : "",
      ...(item.error ? { error: item.error } : {}),
      ...(item.returnedCount === undefined ? {} : {
        metadata: { returnedCount: item.returnedCount, ignoreOverride: false },
      }),
    } } });
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
  const eventsText = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  const shadowArtifact = {
    schemaVersion: "coding-agent-benchmark-navigation-shadow-real-v2/v1",
    status: "completed",
    taskId: "real-js.bug-fix",
    platform: input.platform,
    candidate: { id: "workspace-write-navigation-candidate-v2", manifestModified: false },
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
      enteredEditPhase: false,
      budgetExhausted: true,
    },
    promptContract: {
      compliant: input.promptCompliant,
      fileGlobBeforeSourceRead: input.promptCompliant,
      regressionTestReadBeforeSourceInspection: true,
      boundedTextSearchObserved: true,
      fullTargetReadBeforeLocalization: false,
      repeatedCompleteFileReadCount: 0,
    },
    outcome: {
      runId: input.runId,
      status: "failed",
      failureCategory: "product_workflow",
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      totalTokens: input.inputTokens + input.outputTokens,
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
    comparison: { baseline: { runId: input.baseline.runId, totalTokens: input.baseline.totalTokens } },
    source: {
      candidateEvidenceSha256: sha256(candidateEvidenceText),
      analysisSha256: input.v1AnalysisSha256,
      eventsSha256: sha256(eventsText),
      executionReportSha256: "1".repeat(64),
      manifestSha256: "2".repeat(64),
      baselineCommit: "3".repeat(40),
      candidateFixtureBaselineCommit: "4".repeat(40),
      repositorySnapshotIdentitySha256: "5".repeat(64),
    },
    artifacts: {
      events: { path: "execution/events.jsonl", sha256: sha256(eventsText) },
      preflight: { path: "execution/preflight.json", sha256: "6".repeat(64) },
      repositorySnapshotPreflight: {
        path: "execution/repository-snapshot-preflight.json", sha256: "7".repeat(64),
      },
    },
  };
  const shadowArtifactText = JSON.stringify(shadowArtifact);
  return {
    platform: input.platform,
    shadowArtifact,
    shadowArtifactText,
    candidateEvidence,
    candidateEvidenceText,
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
      checks: Object.fromEntries([
        "manifestBinding", "sourceIdentity", "license", "dependencyCache", "executionNetwork",
      ].map((name) => [name, { status: "passed" }])),
    },
  };
}

function call(id, name, argumentsValue, responseBytes, returnedCount, ellipsized = false) {
  return { id, name, arguments: argumentsValue, success: true, responseBytes, returnedCount, ellipsized };
}

function failedGlob(id, include) {
  return {
    id,
    name: "file_glob",
    arguments: { include },
    success: false,
    responseBytes: 0,
    error: "Tool argument preflight failed: include must be string.",
  };
}

function boundedSearch(query, extra = {}) {
  return { query, path: "lib", glob: "**/*.js", maxResults: 4, contextLines: 5, ...extra };
}

function sizedOutput(bytes, ellipsized) {
  if (!ellipsized) return "x".repeat(bytes);
  return `${"x".repeat(bytes - 3)}…`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
