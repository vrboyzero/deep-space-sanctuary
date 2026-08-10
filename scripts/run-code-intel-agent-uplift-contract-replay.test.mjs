import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";

import {
  buildCodeIntelCandidateContractReplayArtifact,
  parseCodeIntelCandidateContractReplayCliArguments,
  replayCodeIntelCandidateContractFixtures,
  evaluateCodeIntelCandidateToolOutcome,
  replayCandidateBudgetTermination,
  runCodeIntelCandidateContractReplay,
} from "./run-code-intel-agent-uplift-contract-replay.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })));
});

describe("CodeIntel Agent uplift candidate/tool contract replay", () => {
  it("blocks a candidate that never invokes code_intel", () => {
    const outcome = evaluateCodeIntelCandidateToolOutcome({
      scenarioId: "tool-not-invoked",
      semantic: {
        successfulCallCount: 0,
        failedCallCount: 0,
        capabilities: [],
      },
      contextWaste: { firstMutationTool: null },
      provider: { terminalErrorCode: null },
    });

    expect(outcome).toEqual({
      scenarioId: "tool-not-invoked",
      observations: {
        toolInvoked: false,
        semanticLiveSucceeded: false,
        toolFailed: false,
        mutationObserved: false,
        budgetExhausted: false,
      },
      decision: {
        status: "blocked",
        primaryReason: "tool_not_invoked",
        taskUplift: "not_measured",
        nextAction: "require_semantic_tool_adoption",
        newAttemptEligible: false,
      },
    });
  });

  it("blocks a candidate whose code_intel call fails", () => {
    const outcome = evaluateCodeIntelCandidateToolOutcome({
      scenarioId: "tool-failed",
      semantic: {
        successfulCallCount: 0,
        failedCallCount: 1,
        capabilities: [],
      },
      contextWaste: { firstMutationTool: null },
      provider: { terminalErrorCode: null },
    });

    expect(outcome).toEqual({
      scenarioId: "tool-failed",
      observations: {
        toolInvoked: true,
        semanticLiveSucceeded: false,
        toolFailed: true,
        mutationObserved: false,
        budgetExhausted: false,
      },
      decision: {
        status: "blocked",
        primaryReason: "tool_failed",
        taskUplift: "not_measured",
        nextAction: "diagnose_semantic_tool_failure",
        newAttemptEligible: false,
      },
    });
  });

  it("does not count a successful semantic call without mutation as task uplift", () => {
    const outcome = evaluateCodeIntelCandidateToolOutcome({
      scenarioId: "tool-succeeded-without-mutation",
      semantic: {
        successfulCallCount: 1,
        failedCallCount: 0,
        capabilities: ["semantic-live"],
      },
      contextWaste: { firstMutationTool: null },
      provider: { terminalErrorCode: null },
    });

    expect(outcome).toEqual({
      scenarioId: "tool-succeeded-without-mutation",
      observations: {
        toolInvoked: true,
        semanticLiveSucceeded: true,
        toolFailed: false,
        mutationObserved: false,
        budgetExhausted: false,
      },
      decision: {
        status: "blocked",
        primaryReason: "tool_succeeded_without_mutation",
        taskUplift: "not_measured",
        nextAction: "require_post_tool_progress_or_safe_diagnosis",
        newAttemptEligible: false,
      },
    });
  });

  it("preserves budget exhaustion as a blocking terminal outcome", () => {
    const outcome = evaluateCodeIntelCandidateToolOutcome({
      scenarioId: "budget-exhausted",
      semantic: {
        successfulCallCount: 1,
        failedCallCount: 0,
        capabilities: ["semantic-live"],
      },
      contextWaste: { firstMutationTool: "file_edit" },
      provider: { terminalErrorCode: "budget_exhausted" },
    });

    expect(outcome).toEqual({
      scenarioId: "budget-exhausted",
      observations: {
        toolInvoked: true,
        semanticLiveSucceeded: true,
        toolFailed: false,
        mutationObserved: true,
        budgetExhausted: true,
      },
      decision: {
        status: "blocked",
        primaryReason: "budget_exhausted",
        taskUplift: "not_measured",
        nextAction: "terminate_without_task_uplift_claim",
        newAttemptEligible: false,
      },
    });
  });

  it("replays ordinary-profile token exhaustion through the production budget owner", () => {
    expect(replayCandidateBudgetTermination()).toEqual({
      policyEnabled: false,
      maxTotalTokens: 24_000,
      recordedTokens: 24_001,
      termination: {
        budget: "total_tokens",
        limit: 24_000,
        observed: 24_001,
      },
      providerDispatchAllowedAfterTermination: false,
      taskUplift: "not_measured",
    });
  });

  it("replays the four required candidate/tool outcomes without external calls", () => {
    const fixtures = replayCodeIntelCandidateContractFixtures();

    expect(fixtures.map((fixture) => fixture.outcome.decision.primaryReason)).toEqual([
      "tool_not_invoked",
      "tool_failed",
      "tool_succeeded_without_mutation",
      "budget_exhausted",
    ]);
    expect(fixtures.every((fixture) => fixture.outcome.decision.newAttemptEligible === false)).toBe(true);
    expect(fixtures.every((fixture) => fixture.outcome.decision.taskUplift === "not_measured")).toBe(true);
    expect(fixtures[3].budgetReplay.termination).toEqual({
      budget: "total_tokens",
      limit: 24_000,
      observed: 24_001,
    });
  });

  it("builds completed replay evidence without promoting the blocked candidate", () => {
    const upliftReport = makeUpliftReport();
    const upliftReportText = JSON.stringify(upliftReport);
    const artifact = buildCodeIntelCandidateContractReplayArtifact({
      platform: "windows-native",
      generatedAt: "2026-08-10T08:00:00.000Z",
      upliftReport,
      upliftReportText,
      runtimeSources: [
        { path: "scripts/run-code-intel-agent-uplift-contract-replay.mjs", sha256: "1".repeat(64) },
        { path: "scripts/run-code-intel-agent-uplift.mjs", sha256: "2".repeat(64) },
        { path: "packages/belldandy-agent/src/react-run-budget.ts", sha256: "3".repeat(64) },
        { path: "packages/belldandy-skills/src/builtin/code-intel.ts", sha256: "4".repeat(64) },
        { path: "packages/belldandy-skills/src/code-intel/typescript-provider.ts", sha256: "5".repeat(64) },
      ],
    });

    expect(artifact).toMatchObject({
      schemaVersion: "code-intel-agent-uplift-contract-replay/v1",
      status: "completed",
      platform: "windows-native",
      candidateId: "code-intel-semantic-live-v1",
      source: {
        upliftReportSha256: sha256(upliftReportText),
        upliftReportStatus: "blocked",
        attempt: 8,
        gateFailures: ["binary_outcome_regression", "semantic_adoption_below_gate"],
      },
      observedCoverage: {
        candidateCount: 8,
        toolNotInvokedCount: 5,
        toolFailedCount: 2,
        toolSucceededWithoutMutationCount: 1,
        budgetExhaustedCount: 8,
        allRequiredOutcomesCovered: true,
      },
      decision: {
        status: "blocked",
        taskUplift: "not_measured",
        candidatePromotionEligible: false,
        newAttemptEligible: false,
        nextAction: "fix_candidate_tool_and_budget_contract",
      },
      execution: {
        mode: "offline-replay",
        gatewayCalls: 0,
        modelCalls: 0,
        providerCalls: 0,
        providerCostCny: 0,
        networkCalls: 0,
        hostCommandToolCalls: 0,
        workspaceMutations: 0,
        credentialsRead: false,
        upliftReportModified: false,
      },
    });
    expect(artifact.fixtures).toHaveLength(4);
  });

  it("writes one hash-bound Schema-valid replay artifact without overwriting", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-intel-contract-replay-"));
    temporaryRoots.push(root);
    const upliftReport = makeUpliftReport();
    const upliftReportText = `${JSON.stringify(upliftReport, null, 2)}\n`;
    const upliftReportPath = path.join(root, "agent-uplift-report.json");
    const outputRoot = path.join(root, "output");
    await fs.writeFile(upliftReportPath, upliftReportText, "utf8");

    const artifact = await runCodeIntelCandidateContractReplay({
      platform: "windows-native",
      generatedAt: "2026-08-10T08:00:00.000Z",
      sourceRoot: workspaceRoot,
      upliftReportPath,
      expectedUpliftReportSha256: sha256(upliftReportText),
      outputRoot,
    });
    const artifactText = await fs.readFile(
      path.join(outputRoot, "candidate-contract-replay.json"),
      "utf8",
    );
    const schema = JSON.parse(await fs.readFile(path.join(
      workspaceRoot,
      "benchmarks/code-intel/v1/agent-uplift-contract-replay.schema.json",
    ), "utf8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.validator.validateOutput(artifactText)).toMatchObject({ ok: true });
    expect(artifact.source.upliftReportSha256).toBe(sha256(upliftReportText));
    expect(artifact.source.runtimeSources.map((source) => source.path)).toEqual([
      "scripts/run-code-intel-agent-uplift-contract-replay.mjs",
      "scripts/run-code-intel-agent-uplift.mjs",
      "packages/belldandy-agent/src/react-run-budget.ts",
      "packages/belldandy-skills/src/builtin/code-intel.ts",
      "packages/belldandy-skills/src/code-intel/typescript-provider.ts",
    ]);
    await expect(runCodeIntelCandidateContractReplay({
      platform: "windows-native",
      sourceRoot: workspaceRoot,
      upliftReportPath,
      expectedUpliftReportSha256: sha256(upliftReportText),
      outputRoot,
    })).rejects.toThrow(/output root.*already exists/i);
  });

  it("rejects an uplift report whose bytes drift from the expected digest", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-intel-contract-replay-"));
    temporaryRoots.push(root);
    const upliftReportPath = path.join(root, "agent-uplift-report.json");
    const outputRoot = path.join(root, "output");
    await fs.writeFile(upliftReportPath, JSON.stringify(makeUpliftReport()), "utf8");

    await expect(runCodeIntelCandidateContractReplay({
      platform: "windows-native",
      sourceRoot: workspaceRoot,
      upliftReportPath,
      expectedUpliftReportSha256: "0".repeat(64),
      outputRoot,
    })).rejects.toThrow(/uplift report SHA-256.*expected digest/i);
    await expect(fs.access(outputRoot)).rejects.toThrow();
  });

  it("rejects source reports whose a8 Gate or eight-pair identity drifts", () => {
    const gateDrift = makeUpliftReport();
    gateDrift.gate.failures.reverse();
    expect(() => buildCodeIntelCandidateContractReplayArtifact({
      platform: "windows-native",
      generatedAt: "2026-08-10T08:00:00.000Z",
      upliftReport: gateDrift,
      upliftReportText: JSON.stringify(gateDrift),
      runtimeSources: makeRuntimeSources(),
    })).toThrow(/failures drifted.*a8 Gate/i);

    const pairDrift = makeUpliftReport();
    pairDrift.pairs.pop();
    expect(() => buildCodeIntelCandidateContractReplayArtifact({
      platform: "windows-native",
      generatedAt: "2026-08-10T08:00:00.000Z",
      upliftReport: pairDrift,
      upliftReportText: JSON.stringify(pairDrift),
      runtimeSources: makeRuntimeSources(),
    })).toThrow(/must contain eight pairs/i);
  });

  it("rejects runtime source path drift", () => {
    const runtimeSources = makeRuntimeSources();
    runtimeSources[0].path = "scripts/unbound-replay.mjs";

    expect(() => buildCodeIntelCandidateContractReplayArtifact({
      platform: "windows-native",
      generatedAt: "2026-08-10T08:00:00.000Z",
      upliftReport: makeUpliftReport(),
      upliftReportText: JSON.stringify(makeUpliftReport()),
      runtimeSources,
    })).toThrow(/runtime source path drifted at index 0/i);
  });

  it("rejects incomplete candidate cells", () => {
    expect(() => evaluateCodeIntelCandidateToolOutcome({
      scenarioId: "incomplete-candidate-cell",
      contextWaste: { firstMutationTool: null },
      provider: { terminalErrorCode: null },
    })).toThrow(/semantic must be an object/i);
  });

  it("parses only the explicit offline replay CLI contract", () => {
    const parsed = parseCodeIntelCandidateContractReplayCliArguments([
      "--platform", "windows-native",
      "--source-root", workspaceRoot,
      "--uplift-report", "artifacts/a8/agent-uplift-report.json",
      "--expected-uplift-report-sha256", "a".repeat(64),
      "--output-root", "artifacts/contract-replay",
      "--generated-at", "2026-08-10T08:00:00.000Z",
    ]);

    expect(parsed).toEqual({
      platform: "windows-native",
      sourceRoot: workspaceRoot,
      upliftReportPath: path.resolve("artifacts/a8/agent-uplift-report.json"),
      expectedUpliftReportSha256: "a".repeat(64),
      outputRoot: path.resolve("artifacts/contract-replay"),
      generatedAt: "2026-08-10T08:00:00.000Z",
    });
    expect(() => parseCodeIntelCandidateContractReplayCliArguments([
      "--platform", "windows-native", "--platform", "wsl2-linux",
    ])).toThrow(/invalid.*argument/i);
  });
});

function makeUpliftReport() {
  const taskIds = [
    "real-ts.api-migration",
    "real-ts.cross-package-refactor",
    "real-js.bug-fix",
    "real-js.failed-test-fix",
  ];
  const pairs = ["windows-native", "wsl2-linux"].flatMap((platform) =>
    taskIds.map((taskId, taskIndex) => {
      const index = (platform === "windows-native" ? 0 : 4) + taskIndex;
      const semantic = index === 0
        ? { successfulCallCount: 1, failedCallCount: 0, capabilities: ["semantic-live"] }
        : index <= 2
          ? { successfulCallCount: 0, failedCallCount: 1, capabilities: [] }
          : { successfulCallCount: 0, failedCallCount: 0, capabilities: [] };
      return {
        pairId: `${taskId}:${platform}:a8`,
        candidate: {
          semantic,
          contextWaste: { firstMutationTool: null },
          provider: { terminalErrorCode: "budget_exhausted" },
        },
      };
    }));
  return {
    schemaVersion: "code-intel-agent-uplift-report/v1",
    status: "blocked",
    attempt: 8,
    candidateId: "code-intel-semantic-live-v1",
    gate: {
      failures: ["binary_outcome_regression", "semantic_adoption_below_gate"],
      pairCount: 8,
    },
    pairs,
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function makeRuntimeSources() {
  return [
    { path: "scripts/run-code-intel-agent-uplift-contract-replay.mjs", sha256: "1".repeat(64) },
    { path: "scripts/run-code-intel-agent-uplift.mjs", sha256: "2".repeat(64) },
    { path: "packages/belldandy-agent/src/react-run-budget.ts", sha256: "3".repeat(64) },
    { path: "packages/belldandy-skills/src/builtin/code-intel.ts", sha256: "4".repeat(64) },
    { path: "packages/belldandy-skills/src/code-intel/typescript-provider.ts", sha256: "5".repeat(64) },
  ];
}
