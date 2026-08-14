import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  buildModelLoopBudgetTerminationArtifact,
  runModelLoopBudgetTermination,
} from "./run-coding-agent-benchmark-model-loop-budget-termination.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoots = [];
const historicalArtifactPaths = [
  path.join(workspaceRoot, "artifacts/p0.27-navigation-shadow-v3-analysis-20260809/navigation-shadow-v3-analysis.json"),
  path.join(workspaceRoot, "artifacts/p0.17-canary-20260809-partial-aggregate/benchmark-report.json"),
];
const artifactBackedIt = await allPathsExist(historicalArtifactPaths) ? it : it.skip;

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("model-loop budget and termination offline evidence", () => {
  it("replays the opt-in limits and separates cost containment from task uplift", async () => {
    const analysis = makeAnalysis();
    const artifact = buildModelLoopBudgetTerminationArtifact({
      platform: "windows-native",
      generatedAt: "2026-08-09T08:00:00.000Z",
      analysis,
      analysisText: JSON.stringify(analysis),
      aggregate: makeAggregate(),
      aggregateText: JSON.stringify(makeAggregate()),
      runtimeSources: makeRuntimeSources(),
    });

    expect(artifact.policy).toMatchObject({
      id: "cost-containment-v1",
      objective: "cost_containment",
      scope: "explicit_opt_in",
      limits: {
        maxModelCalls: 4,
        maxFileReadCalls: 2,
        maxTextSearchCalls: 2,
        minimumOutputTokenReserve: 1024,
      },
      taskUplift: { status: "not_measured" },
      promotionEligible: false,
      candidateCreated: false,
      providerExpansionAllowed: false,
    });
    expect(artifact.replays.modelCallLimit).toMatchObject({
      attempted: 5,
      admitted: 4,
      wouldBlockProviderDispatch: true,
      termination: {
        budget: "model_calls",
        limit: 4,
        observed: 5,
        policyId: "cost-containment-v1",
        stage: "before_model_call",
        reasonCode: "model_call_limit",
      },
    });
    expect(artifact.replays.fileReadLimit.termination).toMatchObject({
      budget: "file_read_calls",
      observed: 3,
      stage: "before_tool_call",
      reasonCode: "file_read_call_limit",
    });
    expect(artifact.replays.textSearchLimit.termination).toMatchObject({
      budget: "text_search_calls",
      observed: 3,
      stage: "before_tool_call",
      reasonCode: "text_search_call_limit",
    });
    expect(artifact.replays.remainingTokenReserve).toMatchObject({
      consumedTokens: 22000,
      minimumNextInputTokens: 1500,
      minimumOutputTokenReserve: 1024,
      projectedTokens: 24524,
      wouldBlockProviderDispatch: true,
      termination: {
        budget: "total_tokens",
        observed: 24524,
        reasonCode: "insufficient_remaining_tokens",
      },
    });
    expect(artifact.replays.remainingCost).toMatchObject({
      wouldBlockProviderDispatch: true,
      termination: {
        budget: "cost_usd",
        reasonCode: "insufficient_remaining_cost",
      },
    });
    expect(artifact.ordinaryProfileCompatibility).toMatchObject({
      modelReservationsAttempted: 6,
      modelReservationsAdmitted: 6,
      allObservedToolsAdmitted: true,
      outputReserveApplied: false,
      budgetBehavior: "post_usage_budget_semantics_preserved",
    });
    expect(artifact.observedCandidate.policyCounterfactual.firstToolTermination).toMatchObject({
      budget: "file_read_calls",
      observed: 3,
    });
    expect(artifact.execution).toEqual({
      mode: "offline-replay",
      modelCalls: 0,
      providerCalls: 0,
      providerCostCny: 0,
      networkCalls: 0,
      hostCommandToolCalls: 0,
      credentialsRead: false,
      manifestModified: false,
      v3AggregateModified: false,
    });
  });

  it("keeps the WSL2 two-read/two-search trace below tool limits and stops on model calls", () => {
    const analysis = makeAnalysis();
    const artifact = buildModelLoopBudgetTerminationArtifact({
      platform: "wsl2-linux",
      generatedAt: "2026-08-09T08:00:00.000Z",
      analysis,
      analysisText: JSON.stringify(analysis),
      aggregate: makeAggregate(),
      aggregateText: JSON.stringify(makeAggregate()),
      runtimeSources: makeRuntimeSources(),
    });

    expect(artifact.observedCandidate.toolCounts).toEqual({ fileReadCalls: 2, textSearchCalls: 2 });
    expect(artifact.observedCandidate.policyCounterfactual).toMatchObject({
      modelTerminationBeforeCall: 5,
      admittedModelCalls: 4,
      firstToolTermination: null,
      allObservedToolsWithinLimits: true,
    });
  });

  artifactBackedIt("writes one Schema-valid artifact with source and frozen aggregate hashes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bdd-model-loop-budget-"));
    temporaryRoots.push(root);
    const analysisRoot = path.join(
      workspaceRoot,
      "artifacts/p0.27-navigation-shadow-v3-analysis-20260809",
    );
    const outputRoot = path.join(root, "output");
    const aggregatePath = path.join(
      workspaceRoot,
      "artifacts/p0.17-canary-20260809-partial-aggregate/benchmark-report.json",
    );
    const analysisText = await fs.readFile(
      path.join(analysisRoot, "navigation-shadow-v3-analysis.json"),
      "utf8",
    );
    const aggregateText = await fs.readFile(aggregatePath, "utf8");

    const artifact = await runModelLoopBudgetTermination({
      platform: "windows-native",
      generatedAt: "2026-08-09T08:00:00.000Z",
      sourceRoot: workspaceRoot,
      analysisRoot,
      aggregateReport: aggregatePath,
      outputRoot,
    });
    const artifactPath = path.join(outputRoot, "model-loop-budget-termination.json");
    const artifactText = await fs.readFile(artifactPath, "utf8");
    const schema = JSON.parse(await fs.readFile(path.join(
      workspaceRoot,
      "benchmarks/coding-agent/v3/model-loop-budget-termination.schema.json",
    ), "utf8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.validator.validateOutput(artifactText)).toMatchObject({ ok: true });
    expect(artifact.source.analysisSha256).toBe(sha256(analysisText));
    expect(artifact.source.frozenAggregateSha256).toBe(sha256(aggregateText));
    expect(artifact.source.runtimeSources).toHaveLength(6);
    await expect(runModelLoopBudgetTermination({
      platform: "windows-native",
      sourceRoot: workspaceRoot,
      analysisRoot,
      aggregateReport: aggregatePath,
      outputRoot,
    })).rejects.toThrow(/output root.*already exists/i);
  });

  it("fails closed on P0.27 decision, candidate trace, and aggregate drift", () => {
    const base = {
      platform: "windows-native",
      generatedAt: "2026-08-09T08:00:00.000Z",
      analysis: makeAnalysis(),
      analysisText: JSON.stringify(makeAnalysis()),
      aggregate: makeAggregate(),
      aggregateText: JSON.stringify(makeAggregate()),
      runtimeSources: makeRuntimeSources(),
    };
    expect(() => buildModelLoopBudgetTerminationArtifact({
      ...base,
      analysis: {
        ...base.analysis,
        decision: { ...base.analysis.decision, candidateLineStatus: "active" },
      },
    })).toThrow(/candidate line.*stopped/i);
    expect(() => buildModelLoopBudgetTerminationArtifact({
      ...base,
      analysis: {
        ...base.analysis,
        platforms: base.analysis.platforms.map((item) => item.platform === "windows-native"
          ? { ...item, candidates: [{ ...item.candidates[0], modelCalls: 5 }] }
          : item),
      },
    })).toThrow(/six model calls/i);
    expect(() => buildModelLoopBudgetTerminationArtifact({
      ...base,
      aggregate: { ...base.aggregate, summary: { ...base.aggregate.summary, runCount: 7 } },
    })).toThrow(/frozen aggregate.*6 runs/i);
  });
});

function makeAnalysis() {
  const candidate = (platform) => ({
    candidateId: "workspace-write-navigation-candidate-v3",
    runId: `real-js-bug-fix-${platform}`,
    modelCalls: 6,
    usage: {
      source: "provider_reported",
      complete: true,
      inputTokens: platform === "windows-native" ? 24290 : 24888,
      outputTokens: platform === "windows-native" ? 3523 : 1278,
      totalTokens: platform === "windows-native" ? 27813 : 26166,
      modelCalls: 6,
    },
    budget: {
      kind: "total_tokens",
      limit: 24000,
      observed: platform === "windows-native" ? 27813 : 26166,
    },
    tools: {
      sequence: platform === "windows-native"
        ? ["file_glob", "file_glob", "file_read", "text_search", "file_read", "file_read"]
        : ["file_glob", "file_glob", "file_read", "text_search", "text_search", "file_read"],
      editCallCount: 0,
    },
    execution: { enteredEditPhase: false, budgetExhausted: true, changedFileCount: 0 },
    evaluator: { taskCompleted: false, patchAccepted: false },
  });
  return {
    schemaVersion: "coding-agent-benchmark-navigation-shadow-v3-analysis/v1",
    taskId: "real-js.bug-fix",
    candidateId: "workspace-write-navigation-candidate-v3",
    decision: {
      status: "do_not_promote",
      candidateLineStatus: "stopped",
      nextAction: "separate-model-loop-budget-and-termination-contract",
      nextActionMode: "offline",
      providerExpansionAllowed: false,
    },
    execution: {
      mode: "offline-analysis",
      modelCalls: 0,
      networkCalls: 0,
      hostCommandToolCalls: 0,
      manifestModified: false,
      v3AggregateModified: false,
    },
    platforms: ["windows-native", "wsl2-linux"].map((platform) => ({
      platform,
      candidates: [candidate(platform)],
    })),
    crossPlatform: { totalObservedCostCny: 0.08318752 },
  };
}

function makeAggregate() {
  return {
    schemaVersion: "coding-agent-benchmark-report/v3",
    status: "partial",
    summary: { runCount: 6, passedRunCount: 2 },
  };
}

function makeRuntimeSources() {
  return [
    "packages/belldandy-agent/src/react-run-budget.ts",
    "packages/belldandy-agent/src/tool-agent.ts",
    "packages/belldandy-skills/src/executor.ts",
    "packages/belldandy-core/src/cli/commands/agent/run.ts",
    "packages/belldandy-protocol/src/index.ts",
    "packages/belldandy-core/src/coding-run/gateway-conversation-event-adapter.ts",
  ].map((sourcePath, index) => ({ sourcePath, sha256: String(index + 1).repeat(64).slice(0, 64) }));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function allPathsExist(paths) {
  const results = await Promise.all(paths.map(async (targetPath) => {
    try {
      await fs.access(targetPath);
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }));
  return results.every(Boolean);
}
