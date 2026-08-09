import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  buildModelLoopRolloutAuditArtifact,
  parseModelLoopRolloutAuditCliArguments,
  runModelLoopRolloutAudit,
} from "./run-coding-agent-benchmark-model-loop-rollout-audit.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const p028Root = path.join(workspaceRoot, "artifacts/p0.28-model-loop-budget-termination-20260809");
const aggregatePath = path.join(
  workspaceRoot,
  "artifacts/p0.17-canary-20260809-partial-aggregate/benchmark-report.json",
);
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("model-loop rollout safety audit", () => {
  it("audits repair, steer, tool batch, follow-up, Gateway, and ordinary-profile boundaries", async () => {
    const artifact = await makeArtifact("windows-native");

    expect(artifact.rolloutDecision).toEqual({
      status: "hold_explicit_opt_in",
      defaultEnablementAllowed: false,
      realProviderCanaryAllowed: false,
      requiresFreshAuthorizationForProviderCanary: true,
      candidateCreated: false,
      candidateLineStatus: "stopped",
      budgetLimitRaised: false,
      totalTokenBudget: 24000,
      aggregateExpansionAllowed: false,
      totalMatrixTasks: 144,
      taskUplift: { status: "not_measured" },
    });
    expect(artifact.contracts.repairPreflight).toMatchObject({
      checkIsReadOnly: true,
      minimumOutputTokenReserve: 1024,
      projectedTokens: 24524,
      providerDispatchAllowed: false,
      termination: {
        policyId: "cost-containment-v1",
        stage: "before_model_call",
        reasonCode: "insufficient_remaining_tokens",
      },
    });
    expect(artifact.contracts.steering.blockedPreflight).toMatchObject({
      statusBeforePreflight: "queued",
      statusAfterPreflight: "queued",
      consumeCalled: false,
      providerDispatchAllowed: false,
      statusAfterRunClose: "failed",
    });
    expect(artifact.contracts.steering.admittedPreflight).toMatchObject({
      preflightPassed: true,
      consumeCalledAfterPreflight: true,
      statusAfterConsume: "delivered",
      providerDispatchAllowed: true,
    });
    expect(artifact.contracts.toolBatchTermination.fileRead).toMatchObject({
      executedTools: ["file_read", "file_read"],
      blockedRequestIndex: 3,
      subsequentToolExecuted: false,
    });
    expect(artifact.contracts.toolBatchTermination.textSearch).toMatchObject({
      executedTools: ["text_search", "text_search"],
      blockedRequestIndex: 3,
      subsequentToolExecuted: false,
    });
    expect(artifact.contracts.followUpIsolation).toMatchObject({
      newBudgetTrackerPerRun: true,
      policyInheritedByOrdinaryFollowUp: false,
      explicitReselectionRequired: true,
      ordinaryFollowUpReservationsAdmitted: 5,
      selectedFollowUpModelCallsAfterFirstAdmission: 1,
    });
    expect(artifact.contracts.gatewayProjection).toMatchObject({
      eventTypes: ["run.started", "run.budget_exhausted", "run.status", "run.failed"],
      terminalType: "run.failed",
      terminalErrorCode: "budget_exhausted",
      runCompletedEmitted: false,
    });
    expect(artifact.contracts.ordinaryProfileCompatibility).toMatchObject({
      policyEnabled: false,
      repairPreflightAllowedWithoutPolicyReserve: true,
      modelReservationsAdmitted: 5,
      toolReservationsAdmitted: 6,
    });
  });

  it("writes one Schema-valid artifact bound to both P0.28 sources and the frozen aggregate", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bdd-model-loop-rollout-audit-"));
    temporaryRoots.push(root);
    const outputRoot = path.join(root, "output");
    const artifact = await runModelLoopRolloutAudit({
      platform: "windows-native",
      generatedAt: "2026-08-09T09:00:00.000Z",
      sourceRoot: workspaceRoot,
      windowsBudgetArtifactRoot: path.join(p028Root, "windows-native"),
      wslBudgetArtifactRoot: path.join(p028Root, "wsl2-linux"),
      aggregateReport: aggregatePath,
      outputRoot,
    });
    const artifactText = await fs.readFile(path.join(outputRoot, "model-loop-rollout-audit.json"), "utf8");
    const schema = JSON.parse(await fs.readFile(path.join(
      workspaceRoot,
      "benchmarks/coding-agent/v3/model-loop-rollout-audit.schema.json",
    ), "utf8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.validator.validateOutput(artifactText)).toMatchObject({ ok: true });
    expect(artifact.source.p028Artifacts).toEqual([
      {
        platform: "windows-native",
        sha256: "c31bc494f46fbf8c9bcbb3678dfbb152e2670f566ee58e911675951f0e74b4df",
      },
      {
        platform: "wsl2-linux",
        sha256: "5404052627a007793679b15831ddda0a48e6cabb55ca15adb62010c6d7dd1724",
      },
    ]);
    expect(artifact.source.frozenAggregateSha256).toBe(
      "f008259be7068ed53e27202b1f9b21c7649ebe7e410b4468cafc75db3f12a994",
    );
    expect(artifact.source.runtimeSources).toHaveLength(5);
    expect(artifact.source.runtimeExecutables).toHaveLength(3);
    await expect(runModelLoopRolloutAudit({
      platform: "windows-native",
      sourceRoot: workspaceRoot,
      windowsBudgetArtifactRoot: path.join(p028Root, "windows-native"),
      wslBudgetArtifactRoot: path.join(p028Root, "wsl2-linux"),
      aggregateReport: aggregatePath,
      outputRoot,
    })).rejects.toThrow(/output root.*already exists/i);
  });

  it("fails closed when either P0.28 artifact hash drifts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bdd-model-loop-rollout-drift-"));
    temporaryRoots.push(root);
    const windowsRoot = path.join(root, "windows-native");
    const wslRoot = path.join(root, "wsl2-linux");
    await fs.mkdir(windowsRoot, { recursive: true });
    await fs.mkdir(wslRoot, { recursive: true });
    const windowsText = await fs.readFile(
      path.join(p028Root, "windows-native/model-loop-budget-termination.json"),
      "utf8",
    );
    const wslText = await fs.readFile(
      path.join(p028Root, "wsl2-linux/model-loop-budget-termination.json"),
      "utf8",
    );
    await fs.writeFile(path.join(windowsRoot, "model-loop-budget-termination.json"), `${windowsText}\n`);
    await fs.writeFile(path.join(wslRoot, "model-loop-budget-termination.json"), wslText);

    await expect(runModelLoopRolloutAudit({
      platform: "wsl2-linux",
      sourceRoot: workspaceRoot,
      windowsBudgetArtifactRoot: windowsRoot,
      wslBudgetArtifactRoot: wslRoot,
      aggregateReport: aggregatePath,
      outputRoot: path.join(root, "output"),
    })).rejects.toThrow(/Windows P0\.28 artifact SHA-256 drifted/i);
  });

  it("publishes a fail-closed rollout decision Schema", async () => {
    const artifact = await makeArtifact("wsl2-linux");
    const schema = JSON.parse(await fs.readFile(path.join(
      workspaceRoot,
      "benchmarks/coding-agent/v3/model-loop-rollout-audit.schema.json",
    ), "utf8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.validator.validateOutput(JSON.stringify(artifact))).toMatchObject({ ok: true });
    expect(compiled.validator.validateOutput(JSON.stringify({
      ...artifact,
      rolloutDecision: { ...artifact.rolloutDecision, defaultEnablementAllowed: true },
    }))).toMatchObject({ ok: false });
    expect(compiled.validator.validateOutput(JSON.stringify({
      ...artifact,
      contracts: {
        ...artifact.contracts,
        gatewayProjection: { ...artifact.contracts.gatewayProjection, runCompletedEmitted: true },
      },
    }))).toMatchObject({ ok: false });
  });

  it("parses the explicit dual-platform source roots", () => {
    expect(parseModelLoopRolloutAuditCliArguments([
      "--platform", "windows-native",
      "--windows-budget-artifact-root", "windows",
      "--wsl-budget-artifact-root", "wsl",
      "--aggregate-report", "aggregate.json",
      "--output-root", "output",
    ])).toMatchObject({
      platform: "windows-native",
      windowsBudgetArtifactRoot: "windows",
      wslBudgetArtifactRoot: "wsl",
      aggregateReport: "aggregate.json",
      outputRoot: "output",
      sourceRoot: process.cwd(),
    });
    expect(() => parseModelLoopRolloutAuditCliArguments(["--provider", "deepseek"])).toThrow(
      /Unknown CLI argument/i,
    );
  });
});

async function makeArtifact(platform) {
  const [p028Artifacts, aggregateText] = await Promise.all([
    loadP028Artifacts(),
    fs.readFile(aggregatePath, "utf8"),
  ]);
  return buildModelLoopRolloutAuditArtifact({
    platform,
    generatedAt: "2026-08-09T09:00:00.000Z",
    p028Artifacts,
    aggregate: JSON.parse(aggregateText),
    aggregateText,
    runtimeSources: makeRuntimeSources(),
    runtimeExecutables: makeRuntimeExecutables(),
  });
}

async function loadP028Artifacts() {
  return Promise.all(["windows-native", "wsl2-linux"].map(async (platform) => {
    const text = await fs.readFile(path.join(p028Root, platform, "model-loop-budget-termination.json"), "utf8");
    return { platform, artifact: JSON.parse(text), text };
  }));
}

function makeRuntimeSources() {
  return [
    "packages/belldandy-agent/src/react-run-budget.ts",
    "packages/belldandy-agent/src/index.ts",
    "packages/belldandy-agent/src/tool-agent.ts",
    "packages/belldandy-core/src/coding-run/conversation-steer-mailbox.ts",
    "packages/belldandy-core/src/coding-run/gateway-conversation-event-adapter.ts",
  ].map((sourcePath, index) => ({ sourcePath, sha256: String(index + 1).repeat(64).slice(0, 64) }));
}

function makeRuntimeExecutables() {
  return [
    "packages/belldandy-agent/dist/react-run-budget.js",
    "packages/belldandy-core/dist/coding-run/conversation-steer-mailbox.js",
    "packages/belldandy-core/dist/coding-run/gateway-conversation-event-adapter.js",
  ].map((sourcePath, index) => ({ sourcePath, sha256: String(index + 6).repeat(64).slice(0, 64) }));
}
