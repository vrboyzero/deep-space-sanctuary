import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  buildNavigationShadowRealV2Artifact,
  parseNavigationShadowRealV2CliArguments,
} from "./run-coding-agent-benchmark-navigation-shadow-real-v2.mjs";

describe("coding agent navigation shadow real v2 contract", () => {
  it("builds a Schema-valid candidate v2 result with prompt and source bindings", async () => {
    const artifact = buildNavigationShadowRealV2Artifact(fixture());

    expect(artifact).toMatchObject({
      schemaVersion: "coding-agent-benchmark-navigation-shadow-real-v2/v1",
      status: "completed",
      candidate: {
        id: "workspace-write-navigation-candidate-v2",
        strategy: {
          id: "bounded-localize-before-read/v1",
          enforcement: "prompt_contract",
          runtimeToolGuard: false,
        },
      },
      authorization: {
        status: "confirmed",
        maxTotalCostCny: 2,
        runCostCny: 0.024,
        remainingCostCny: 1.976,
      },
      execution: {
        v3AggregateEligible: false,
        hostCommandToolCalls: 0,
        enteredEditPhase: true,
      },
      promptContract: {
        promptHashMatched: true,
        compliant: true,
        fullTargetReadBeforeLocalization: false,
      },
      outcome: {
        status: "passed",
        totalTokens: 7800,
        changedPaths: ["lib/request.js"],
      },
      comparison: {
        totalTokenDelta: -18051,
        taskOutcomeImproved: true,
        tokenImpact: { status: "measured", source: "provider_reported" },
      },
      source: {
        analysisSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        previousShadowArtifactSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        candidateEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        repositorySnapshotIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });

    const schema = JSON.parse(await fs.readFile(path.join(
      path.resolve("."),
      "benchmarks/coding-agent/v3/navigation-shadow-real-v2.schema.json",
    ), "utf-8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.validator.validateOutput(JSON.stringify(artifact))).toMatchObject({ ok: true });
    }
  });

  it("fails closed on incomplete usage, denied host commands, or cumulative cost overflow", () => {
    const incomplete = fixture();
    incomplete.report.runs[0].usage.observation.status = "unavailable";
    incomplete.report.runs[0].usage.observation.costUsd = null;
    expect(() => buildNavigationShadowRealV2Artifact(incomplete))
      .toThrow(/provider-reported usage/i);

    const denied = fixture();
    denied.events.splice(-2, 0, {
      type: "tool.started",
      payload: { tool: { name: "run_command", arguments: { command: "npm test" } } },
    });
    expect(() => buildNavigationShadowRealV2Artifact(denied)).toThrow(/denied run_command/i);

    const overBudget = fixture();
    overBudget.priorObservedCostCny = 1.99;
    expect(() => buildNavigationShadowRealV2Artifact(overBudget))
      .toThrow(/authorized total CNY cost/i);
  });

  it("fails closed on candidate, prompt, historical source, or snapshot drift", () => {
    const candidate = fixture();
    candidate.candidateEvidence.candidate.id = "workspace-write-navigation-candidate-v1";
    expect(() => buildNavigationShadowRealV2Artifact(candidate)).toThrow(/candidate v2 evidence/i);

    const prompt = fixture();
    prompt.promptText = `${prompt.promptText}drift`;
    expect(() => buildNavigationShadowRealV2Artifact(prompt)).toThrow(/rendered prompt hash/i);

    const analysis = fixture();
    analysis.analysisText = JSON.stringify({ drifted: true });
    expect(() => buildNavigationShadowRealV2Artifact(analysis))
      .toThrow(/historical (source hashes|evidence versions)/i);

    const snapshot = fixture();
    const receipt = JSON.parse(snapshot.repositorySnapshotReceiptText);
    receipt.source.commit = "7".repeat(40);
    snapshot.repositorySnapshotReceiptText = JSON.stringify(receipt);
    expect(() => buildNavigationShadowRealV2Artifact(snapshot))
      .toThrow(/repository snapshot identity drifted/i);
  });

  it("records prompt-contract noncompliance without discarding the paid outcome", () => {
    const input = fixture();
    input.events.splice(3, 0,
      {
        type: "tool.started",
        payload: { tool: { name: "file_read", arguments: { path: "lib/request.js" } } },
      },
      {
        type: "tool.completed",
        payload: { tool: { name: "file_read", success: true } },
      },
    );

    const artifact = buildNavigationShadowRealV2Artifact(input);
    expect(artifact.status).toBe("completed");
    expect(artifact.promptContract).toMatchObject({
      compliant: false,
      fullTargetReadBeforeLocalization: true,
    });
  });

  it("parses the isolated v2 evidence roots and rejects unknown arguments", () => {
    expect(parseNavigationShadowRealV2CliArguments([
      "--platform", "wsl2-linux",
      "--source-root", "/mnt/e/project/star-sanctuary",
      "--candidate-evidence-root", "/mnt/e/project/star-sanctuary/artifacts/p0.22/wsl2-linux",
      "--analysis-root", "/mnt/e/project/star-sanctuary/artifacts/p0.21",
      "--previous-shadow-root", "/mnt/e/project/star-sanctuary/artifacts/p0.20/wsl2-linux",
      "--navigation-evidence-root", "/mnt/e/project/star-sanctuary/artifacts/p0.19/wsl2-linux",
      "--baseline-run-root", "/mnt/e/project/star-sanctuary/artifacts/baseline-run",
      "--repository-config", "/var/tmp/prepared/repository-inputs.json",
      "--fixture-root", "/var/tmp/shadow-v2/fixtures",
      "--gateway-fixture-root", "\\\\wsl.localhost\\Ubuntu-22.04\\var\\tmp\\shadow-v2\\fixtures",
      "--state-root", "/mnt/e/project/star-sanctuary/tmp/shadow-v2/state",
      "--output-root", "/var/tmp/shadow-v2/output",
      "--provider", "deepseek",
      "--model-id", "deepseek-v4-flash",
      "--max-total-cost-cny", "2",
      "--prior-observed-cost-cny", "0.024",
      "--finalize-existing-execution", "true",
    ])).toMatchObject({
      platform: "wsl2-linux",
      maxTotalCostCny: 2,
      priorObservedCostCny: 0.024,
      finalizeExistingExecution: true,
    });
    expect(() => parseNavigationShadowRealV2CliArguments(["--unknown", "value"]))
      .toThrow(/unknown navigation shadow real v2 argument/i);
  });
});

function fixture() {
  const manifest = {
    schemaVersion: "coding-agent-benchmark-manifest/v3",
    suite: {
      executionProfiles: {
        "workspace-write": {
          permissionMode: "acceptEdits",
          toolAllow: [
            "file_read", "list_files", "file_edit", "apply_patch",
            "file_write", "file_delete",
          ],
          toolDeny: ["run_command", "spawn_subagent"],
        },
        "navigation-read": { toolAllow: ["text_search", "file_glob"] },
      },
    },
  };
  const manifestText = JSON.stringify(manifest);
  const manifestSha256 = sha256(manifestText);
  const baselineManifestText = JSON.stringify({
    runId: "baseline-run",
    taskId: "real-js.bug-fix",
    fixture: { baselineCommit: "5".repeat(40) },
  });
  const baselineEventsText = `${JSON.stringify({ type: "run.failed" })}\n`;
  const baselineRepositorySnapshotReceiptText = JSON.stringify(snapshotReceipt());
  const repositorySnapshotReceiptText = JSON.stringify(snapshotReceipt());
  const snapshotIdentitySha256 = sha256(JSON.stringify(snapshotIdentity()));
  const navigationEvidence = {
    schemaVersion: "coding-agent-benchmark-navigation-efficiency/v1",
    status: "eligible_for_canary",
    platform: "windows-native",
    source: {
      baselineCommit: "5".repeat(40),
      baselineRunId: "baseline-run",
      baselineTaskId: "real-js.bug-fix",
      baselineManifestSha256: sha256(baselineManifestText),
      baselineEventsSha256: sha256(baselineEventsText),
    },
    baseline: {
      runId: "baseline-run",
      inputTokens: 23078,
      outputTokens: 2773,
      totalTokens: 25851,
      modelCalls: 4,
      toolCallCount: 5,
      changedFileCount: 0,
      budgetExhausted: true,
    },
  };
  const navigationEvidenceText = JSON.stringify(navigationEvidence);
  const analysisText = JSON.stringify({ schemaVersion: "coding-agent-benchmark-navigation-shadow-analysis/v1" });
  const previousShadowArtifactText = JSON.stringify({ schemaVersion: "coding-agent-benchmark-navigation-shadow-real/v1" });
  const promptText = "Fix the bug.\n\n## Navigation Budget Contract\nCandidate contract";
  const candidateEvidence = {
    schemaVersion: "coding-agent-benchmark-navigation-candidate-v2/v1",
    status: "eligible_for_shadow_readiness",
    platform: "windows-native",
    taskId: "real-js.bug-fix",
    candidate: {
      id: "workspace-write-navigation-candidate-v2",
      baseProfile: "workspace-write",
      permissionMode: "acceptEdits",
      toolAllow: [
        "file_read", "list_files", "text_search", "file_glob",
        "file_edit", "apply_patch", "file_write", "file_delete",
      ],
      toolDeny: ["run_command", "spawn_subagent"],
      manifestModified: false,
      strategy: {
        id: "bounded-localize-before-read/v1",
        enforcement: "prompt_contract",
        runtimeToolGuard: false,
      },
    },
    prompt: {
      strategyId: "bounded-localize-before-read/v1",
      enforcement: "prompt_contract",
      runtimeToolGuard: false,
      basePromptSha256: "b".repeat(64),
      contractSha256: "c".repeat(64),
      renderedPromptSha256: sha256(promptText),
    },
    execution: {
      mode: "offline-replay",
      modelCalls: 0,
      providerCostUsd: 0,
      networkCalls: 0,
      hostCommandToolCalls: 0,
      manifestModified: false,
      v3AggregateModified: false,
    },
    source: {
      analysisSha256: sha256(analysisText),
      shadowArtifactSha256: sha256(previousShadowArtifactText),
      navigationEvidenceSha256: sha256(navigationEvidenceText),
      manifestSha256,
      basePromptSha256: "b".repeat(64),
      baselineCommit: "5".repeat(40),
      candidateFixtureBaselineCommit: "6".repeat(40),
      repositorySnapshotIdentitySha256: snapshotIdentitySha256,
    },
    decision: {
      status: "eligible_for_shadow_readiness",
      requiresNewProviderAuthorization: true,
      tokenUpliftClaimed: false,
    },
  };
  const candidateEvidenceText = JSON.stringify(candidateEvidence);

  return {
    platform: "windows-native",
    generatedAt: "2026-08-09T00:00:00.000Z",
    priorObservedCostCny: 0,
    candidateEvidence,
    candidateEvidenceText,
    manifest,
    manifestText,
    provider: "deepseek",
    modelId: "deepseek-v4-flash",
    maxTotalCostCny: 2,
    analysisText,
    previousShadowArtifactText,
    navigationEvidence,
    navigationEvidenceText,
    baselineManifestText,
    baselineEventsText,
    baselineRepositorySnapshotReceiptText,
    repositorySnapshotReceiptText,
    promptText: `${promptText}\n`,
    executionReportSha256: "d".repeat(64),
    report: {
      suite: { manifestSha256 },
      runs: [{
        runId: "shadow-v2-windows-a1",
        taskId: "real-js.bug-fix",
        attempt: 1,
        platform: "windows-native",
        fixture: { baselineCommit: "6".repeat(40) },
        status: "passed",
        failureCategory: null,
        environment: {
          model: {
            provider: "deepseek",
            id: "deepseek-v4-flash",
            credentialsConfigured: true,
          },
        },
        evaluation: {
          source: "machine",
          taskCompleted: true,
          testsPassed: true,
          patchAccepted: true,
          regressionCount: 0,
          manualInterventionCount: 0,
          dangerousOperationBlocked: null,
          recoverySucceeded: null,
        },
        usage: {
          inputTokens: 7000,
          outputTokens: 800,
          observation: { status: "provider_reported", costUsd: 0.003 },
        },
      }],
    },
    codingCiManifest: {
      mode: "workspace-write",
      profileCandidateId: "workspace-write-navigation-candidate-v2",
      changedPaths: ["lib/request.js"],
    },
    events: [
      { type: "run.started" },
      {
        type: "tool.started",
        payload: { tool: { name: "file_glob", arguments: {
          include: ["test/benchmark-v3/real-js-bug-fix.js", "lib/**/*.js"],
        } } },
      },
      { type: "tool.completed", payload: { tool: { name: "file_glob", success: true } } },
      {
        type: "tool.started",
        payload: { tool: { name: "file_read", arguments: { path: "test/benchmark-v3/real-js-bug-fix.js" } } },
      },
      { type: "tool.completed", payload: { tool: { name: "file_read", success: true } } },
      {
        type: "tool.started",
        payload: { tool: { name: "text_search", arguments: {
          query: "this.app.get('subdomain offset')", mode: "fixed", path: "lib",
          glob: "**/*.js", maxResults: 4, contextLines: 5,
        } } },
      },
      { type: "tool.completed", payload: { tool: { name: "text_search", success: true } } },
      { type: "tool.started", payload: { tool: { name: "file_edit", arguments: { path: "lib/request.js" } } } },
      { type: "tool.completed", payload: { tool: { name: "file_edit", success: true } } },
      { type: "run.usage", payload: { usage: { modelCalls: 2 } } },
      { type: "run.completed" },
    ],
    artifactRefs: Object.fromEntries([
      "executionReport", "taskManifest", "events", "patch", "result", "codingCiManifest",
      "prompt", "preflight", "repositorySnapshotPreflight", "repositorySnapshotReceipt",
    ].map((name, index) => [name, {
      path: `execution/${name}.json`,
      sha256: String(index + 1).repeat(64).slice(0, 64),
    }])),
  };
}

function snapshotReceipt() {
  return {
    schemaVersion: "coding-agent-benchmark-snapshot-receipt/v1",
    repositoryId: "express",
    source: {
      url: "https://github.com/expressjs/express.git",
      commit: "a".repeat(40),
      workspaceDirty: false,
      worktreeContentSha256: "b".repeat(64),
      dependencyInputsSha256: "c".repeat(64),
    },
    policy: { executionNetwork: "disabled" },
  };
}

function snapshotIdentity() {
  return {
    schemaVersion: "coding-agent-benchmark-snapshot-receipt/v1",
    repositoryId: "express",
    source: {
      url: "https://github.com/expressjs/express.git",
      commit: "a".repeat(40),
      workspaceDirty: false,
      worktreeContentSha256: "b".repeat(64),
      dependencyInputsSha256: "c".repeat(64),
    },
    policy: { executionNetwork: "disabled" },
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
