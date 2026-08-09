import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  buildNavigationShadowRealArtifact,
  parseNavigationShadowRealCliArguments,
} from "./run-coding-agent-benchmark-navigation-shadow-real.mjs";

describe("coding agent navigation shadow real contract", () => {
  it("builds a Schema-valid real Provider comparison without entering the v3 aggregate", async () => {
    const input = fixture();
    const artifact = buildNavigationShadowRealArtifact(input);

    expect(artifact).toMatchObject({
      status: "completed",
      platform: "windows-native",
      authorization: {
        status: "confirmed",
        maxTotalCostCny: 2,
        runCostCny: 0.024,
        remainingCostCny: 1.976,
      },
      execution: {
        mode: "real-provider-shadow",
        v3AggregateEligible: false,
        hostCommandToolCalls: 0,
        enteredEditPhase: true,
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
        baselineCommit: "5".repeat(40),
        candidateFixtureBaselineCommit: "6".repeat(40),
        repositorySnapshotIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });

    const schema = JSON.parse(await fs.readFile(path.join(
      path.resolve("."),
      "benchmarks/coding-agent/v3/navigation-shadow-real.schema.json",
    ), "utf-8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      const validation = compiled.validator.validateOutput(JSON.stringify(artifact));
      expect(validation).toMatchObject({ ok: true });
    }
  });

  it("fails closed on incomplete usage, denied host commands, or total-cost overflow", () => {
    const incomplete = fixture();
    incomplete.report.runs[0].usage.observation.status = "unavailable";
    incomplete.report.runs[0].usage.observation.costUsd = null;
    expect(() => buildNavigationShadowRealArtifact(incomplete)).toThrow(/provider-reported usage/i);

    const denied = fixture();
    denied.events.splice(-2, 0, {
      type: "tool.started",
      payload: { tool: { id: "host-1", name: "run_command" } },
    });
    expect(() => buildNavigationShadowRealArtifact(denied)).toThrow(/denied run_command/i);

    const overBudget = fixture();
    overBudget.priorObservedCostCny = 1.99;
    expect(() => buildNavigationShadowRealArtifact(overBudget)).toThrow(/authorized total CNY cost/i);
  });

  it("binds the historical and candidate runs by stable repository snapshot identity", () => {
    const input = fixture();
    expect(() => buildNavigationShadowRealArtifact(input)).not.toThrow();

    const drifted = fixture();
    const receipt = JSON.parse(drifted.repositorySnapshotReceiptText);
    receipt.source.commit = "7".repeat(40);
    drifted.repositorySnapshotReceiptText = JSON.stringify(receipt);
    expect(() => buildNavigationShadowRealArtifact(drifted))
      .toThrow(/repository snapshot identity drifted/i);

    const readinessDrifted = fixture();
    readinessDrifted.readiness.source.baselineRunId = "other-baseline-run";
    expect(() => buildNavigationShadowRealArtifact(readinessDrifted))
      .toThrow(/readiness baseline identity drifted/i);
  });

  it("parses explicit authorized roots and rejects unknown arguments", () => {
    expect(parseNavigationShadowRealCliArguments([
      "--platform", "wsl2-linux",
      "--source-root", "/mnt/e/project/star-sanctuary",
      "--readiness-root", "/mnt/e/project/star-sanctuary/artifacts/readiness/wsl2-linux",
      "--navigation-evidence-root", "/mnt/e/project/star-sanctuary/artifacts/navigation/wsl2-linux",
      "--baseline-run-root", "/mnt/e/project/star-sanctuary/artifacts/baseline-run",
      "--repository-config", "/var/tmp/prepared/repository-inputs.json",
      "--fixture-root", "/var/tmp/shadow/fixtures",
      "--gateway-fixture-root", "\\\\wsl.localhost\\Ubuntu-22.04\\var\\tmp\\shadow\\fixtures",
      "--state-root", "/mnt/e/project/star-sanctuary/tmp/shadow/state",
      "--output-root", "/var/tmp/shadow/output",
      "--provider", "deepseek",
      "--model-id", "deepseek-v4-flash",
      "--max-total-cost-cny", "2",
      "--prior-observed-cost-cny", "0.024",
      "--finalize-existing-execution", "true",
    ])).toMatchObject({
      platform: "wsl2-linux",
      maxTotalCostCny: 2,
      priorObservedCostCny: 0.024,
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      finalizeExistingExecution: true,
    });
    expect(() => parseNavigationShadowRealCliArguments(["--unknown", "value"]))
      .toThrow(/unknown navigation shadow real argument/i);
  });
});

function fixture() {
  const baselineManifestText = JSON.stringify({
    runId: "baseline-run",
    taskId: "real-js.bug-fix",
    fixture: { baselineCommit: "5".repeat(40) },
  });
  const baselineEventsText = `${JSON.stringify({ type: "run.failed" })}\n`;
  const baselineRepositorySnapshotReceiptText = JSON.stringify(snapshotReceipt({
    licenseSha256: "1".repeat(64),
    dependencyCacheKey: "express-windows",
    dependencyCacheSha256: "2".repeat(64),
  }));
  const repositorySnapshotReceiptText = JSON.stringify(snapshotReceipt({
    licenseSha256: "3".repeat(64),
    dependencyCacheKey: "express-linux",
    dependencyCacheSha256: "4".repeat(64),
  }));
  const navigationEvidence = {
    status: "eligible_for_canary",
    source: {
      baselineCommit: "5".repeat(40),
      baselineRunId: "baseline-run",
      baselineTaskId: "real-js.bug-fix",
      baselineManifestSha256: sha256(baselineManifestText),
      baselineEventsSha256: sha256(baselineEventsText),
    },
    profile: {
      id: "workspace-write-navigation-candidate-v1",
      baseProfile: "workspace-write",
      permissionMode: "acceptEdits",
      toolAllow: [
        "file_read",
        "list_files",
        "text_search",
        "file_glob",
        "file_edit",
        "apply_patch",
        "file_write",
        "file_delete",
      ],
      toolDeny: ["run_command", "spawn_subagent"],
      manifestModified: false,
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
  const readiness = {
    schemaVersion: "coding-agent-benchmark-navigation-shadow-canary/v1",
    status: "ready_for_authorization",
    platform: "windows-native",
    candidateId: "workspace-write-navigation-candidate-v1",
    frozen: {
      manifestModified: false,
      manifestSha256: "a".repeat(64),
      baselineCommit: "5".repeat(40),
    },
    authorization: {
      status: "pending_confirmation",
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      maxCostCny: 2,
      credentialsRead: false,
      requiresExplicitUserConfirmation: true,
    },
    execution: { mode: "dry-run", modelCalls: 0, providerCostUsd: 0 },
    source: {
      navigationEvidenceSha256: sha256(navigationEvidenceText),
      baselineRunId: "baseline-run",
      baselineTaskId: "real-js.bug-fix",
      baselineCommit: "5".repeat(40),
    },
  };
  return {
    platform: "windows-native",
    generatedAt: "2026-08-09T00:00:00.000Z",
    priorObservedCostCny: 0,
    readiness,
    readinessSha256: "b".repeat(64),
    navigationEvidence,
    navigationEvidenceText,
    baselineManifestText,
    baselineEventsText,
    baselineRepositorySnapshotReceiptText,
    repositorySnapshotReceiptText,
    executionReportSha256: "c".repeat(64),
    report: {
      suite: { manifestSha256: "a".repeat(64) },
      runs: [{
        runId: "shadow-windows-a1",
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
      profileCandidateId: "workspace-write-navigation-candidate-v1",
      changedPaths: ["lib/request.js"],
    },
    events: [
      { type: "run.started" },
      { type: "tool.started", payload: { tool: { id: "search-1", name: "text_search" } } },
      { type: "tool.completed", payload: { tool: { id: "search-1", name: "text_search", success: true } } },
      { type: "tool.started", payload: { tool: { id: "edit-1", name: "file_edit" } } },
      { type: "tool.completed", payload: { tool: { id: "edit-1", name: "file_edit", success: true } } },
      { type: "run.usage", payload: { usage: { modelCalls: 2 } } },
      { type: "run.completed" },
    ],
    artifactRefs: Object.fromEntries([
      "executionReport",
      "taskManifest",
      "events",
      "patch",
      "result",
      "codingCiManifest",
      "preflight",
      "repositorySnapshotPreflight",
      "repositorySnapshotReceipt",
    ].map((name, index) => [name, {
      path: `execution/${name}.json`,
      sha256: String(index + 1).repeat(64).slice(0, 64),
    }])),
  };
}

function snapshotReceipt(input) {
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
    license: {
      spdx: "MIT",
      path: "LICENSE",
      sha256: input.licenseSha256,
    },
    dependencyCache: {
      cacheKey: input.dependencyCacheKey,
      contentSha256: input.dependencyCacheSha256,
    },
    policy: {
      preparationNetwork: "allowlisted-source-only",
      executionNetwork: "disabled",
      dependencyPolicy: "pinned-cache-required",
    },
    preparedAt: "2026-08-09T00:00:00.000Z",
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
