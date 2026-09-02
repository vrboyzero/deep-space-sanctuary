import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  validateCodingAgentBenchmarkWebUiTruthSet,
} from "./coding-agent-benchmark-v3-web-ui-truth-set.mjs";
import { collectCodingAgentBenchmarkContractFailures } from "./verify-coding-agent-benchmark-contract.mjs";

const workspaceRoot = path.resolve(import.meta.dirname, "..");

describe("coding agent benchmark repository contract", () => {
  it("keeps the WSL2 host launcher wired into the public benchmark contract", async () => {
    const [packageJsonText, readme, projectMap, gitAttributes] = await Promise.all([
      fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8"),
      fs.readFile(path.join(workspaceRoot, "benchmarks/coding-agent/README.md"), "utf-8"),
      fs.readFile(path.join(workspaceRoot, "docs/project-map.md"), "utf-8"),
      fs.readFile(path.join(workspaceRoot, ".gitattributes"), "utf-8"),
    ]);
    const packageJson = JSON.parse(packageJsonText);

    expect(packageJson.scripts["benchmark:coding-agent:stage0c:wsl"]).toBe(
      "node scripts/run-coding-agent-benchmark-wsl.mjs",
    );
    expect(packageJson.scripts["benchmark:coding-agent:stage0c:interactive:windows"]).toBe(
      "node scripts/run-coding-agent-benchmark.mjs --platform windows-native --task-id command.interactive-control",
    );
    expect(packageJson.scripts["benchmark:coding-agent:stage0c:interactive:wsl"]).toBe(
      "node scripts/run-coding-agent-benchmark-wsl.mjs --task-id command.interactive-control",
    );
    expect(packageJson.scripts["benchmark:coding-agent:stage0c:safety:windows"]).toBe(
      "node scripts/run-coding-agent-benchmark.mjs --platform windows-native --task-id safety.boundary-enforcement",
    );
    expect(packageJson.scripts["benchmark:coding-agent:stage0c:safety:wsl"]).toBe(
      "node scripts/run-coding-agent-benchmark-wsl.mjs --task-id safety.boundary-enforcement",
    );
    expect(packageJson.scripts["benchmark:coding-agent:stage0c:recovery:windows"]).toBe(
      "node scripts/run-coding-agent-benchmark.mjs --platform windows-native --task-id gateway.disconnect-recovery",
    );
    expect(packageJson.scripts["benchmark:coding-agent:stage0c:recovery:wsl"]).toBe(
      "node scripts/run-coding-agent-benchmark-wsl.mjs --task-id gateway.disconnect-recovery",
    );
    expect(packageJson.scripts["benchmark:coding-agent:stage0c:cancel:windows"]).toBe(
      "node scripts/run-coding-agent-benchmark.mjs --platform windows-native --task-id gateway.client-cancel",
    );
    expect(packageJson.scripts["benchmark:coding-agent:stage0c:cancel:wsl"]).toBe(
      "node scripts/run-coding-agent-benchmark-wsl.mjs --task-id gateway.client-cancel",
    );
    expect(packageJson.scripts["benchmark:coding-agent:stage0c:git:windows"]).toBe(
      "node scripts/run-coding-agent-benchmark.mjs --platform windows-native --task-id git.dirty-worktree,git.delivery-guard",
    );
    expect(packageJson.scripts["benchmark:coding-agent:stage0c:git:wsl"]).toBe(
      "node scripts/run-coding-agent-benchmark-wsl.mjs --task-id git.dirty-worktree,git.delivery-guard",
    );
    expect(packageJson.scripts["benchmark:coding-agent:stage0d:core:windows"]).toBe(
      "node scripts/run-coding-agent-benchmark.mjs --platform windows-native --task-id feature.cross-file,tests.failed-diagnosis,navigation.large-repository",
    );
    expect(packageJson.scripts["benchmark:coding-agent:stage0d:core:wsl"]).toBe(
      "node scripts/run-coding-agent-benchmark-wsl.mjs --task-id feature.cross-file,tests.failed-diagnosis,navigation.large-repository",
    );
    expect(packageJson.scripts["benchmark:coding-agent:v3:prepare-linux"]).toBe(
      "node scripts/coding-agent-benchmark-linux-snapshot-preparation.mjs",
    );
    expect(packageJson.scripts["benchmark:coding-agent:v3:navigation-efficiency"]).toBe(
      "node scripts/run-coding-agent-benchmark-navigation-efficiency.mjs",
    );
    expect(packageJson.scripts["benchmark:coding-agent:v3:navigation-shadow-dry-run"]).toBe(
      "node scripts/run-coding-agent-benchmark-navigation-shadow-canary.mjs",
    );
    expect(packageJson.scripts["benchmark:coding-agent:v3:navigation-shadow-real"]).toBe(
      "node scripts/run-coding-agent-benchmark-navigation-shadow-real.mjs",
    );
    expect(packageJson.scripts["benchmark:coding-agent:v3:navigation-shadow-real-v2"]).toBe(
      "node scripts/run-coding-agent-benchmark-navigation-shadow-real-v2.mjs",
    );
    expect(packageJson.scripts["benchmark:coding-agent:v3:navigation-shadow-real-v3"]).toBe(
      "node scripts/run-coding-agent-benchmark-navigation-shadow-real-v3.mjs",
    );
    expect(packageJson.scripts["benchmark:coding-agent:v3:navigation-shadow-analysis"]).toBe(
      "node scripts/run-coding-agent-benchmark-navigation-shadow-analysis.mjs",
    );
    expect(packageJson.scripts["benchmark:coding-agent:v3:navigation-shadow-v2-analysis"]).toBe(
      "node scripts/run-coding-agent-benchmark-navigation-shadow-v2-analysis.mjs",
    );
    expect(packageJson.scripts["benchmark:coding-agent:v3:navigation-shadow-v3-analysis"]).toBe(
      "node scripts/run-coding-agent-benchmark-navigation-shadow-v3-analysis.mjs",
    );
    expect(packageJson.scripts["benchmark:coding-agent:v3:model-loop-rollout-audit"]).toBe(
      "node scripts/run-coding-agent-benchmark-model-loop-rollout-audit.mjs",
    );
    expect(packageJson.scripts["benchmark:coding-agent:v3:navigation-candidate-v3"]).toBe(
      "node scripts/run-coding-agent-benchmark-navigation-candidate-v3.mjs",
    );
    expect(packageJson.scripts["aggregate:coding-agent:baseline"]).toBe(
      "node scripts/aggregate-coding-agent-benchmark.mjs",
    );
    expect(readme).toContain("benchmark:coding-agent:stage0c:wsl");
    expect(readme).toContain("benchmark:coding-agent:stage0c:wsl --manifest-revision v3");
    expect(readme).toContain("benchmark:coding-agent:stage0c:interactive:windows");
    expect(readme).toContain("benchmark:coding-agent:stage0c:interactive:wsl");
    expect(readme).toContain("benchmark:coding-agent:stage0c:safety:windows");
    expect(readme).toContain("benchmark:coding-agent:stage0c:safety:wsl");
    expect(readme).toContain("benchmark:coding-agent:stage0c:recovery:windows");
    expect(readme).toContain("benchmark:coding-agent:stage0c:recovery:wsl");
    expect(readme).toContain("benchmark:coding-agent:stage0c:cancel:windows");
    expect(readme).toContain("benchmark:coding-agent:stage0c:cancel:wsl");
    expect(readme).toContain("gateway.client-cancel");
    expect(readme).toContain("benchmark:coding-agent:stage0c:git:windows");
    expect(readme).toContain("benchmark:coding-agent:stage0c:git:wsl");
    expect(readme).toContain("benchmark:coding-agent:stage0d:core:windows");
    expect(readme).toContain("benchmark:coding-agent:stage0d:core:wsl");
    expect(readme).toContain("feature.cross-file");
    expect(readme).toContain("tests.failed-diagnosis");
    expect(readme).toContain("navigation.large-repository");
    expect(readme).toContain("aggregate:coding-agent:baseline");
    expect(readme).toContain("aggregate:coding-agent:baseline --manifest-revision v2");
    expect(readme).toContain("aggregate:coding-agent:baseline --manifest-revision v3");
    expect(readme).toContain("baseline-index.json");
    expect(readme).toContain("git.dirty-worktree");
    expect(readme).toContain("git.delivery-guard");
    expect(readme).toContain("回退到 primary");
    expect(readme).toContain("v2/agents.json");
    expect(readme).toContain("maxHighRiskToolCalls=5");
    expect(readme).toContain("systemBrowserScreenshot");
    expect(readme).toContain("browser-screenshot.png");
    expect(readme).toContain("coding-agent-benchmark-parallel-read-harness.mjs");
    expect(readme).toContain("coding-agent-benchmark-parallel-write-harness.mjs");
    expect(readme).toContain("coding-agent-benchmark-restart-delivery-harness.mjs");
    expect(readme).toContain("run-coding-agent-benchmark-system-smoke.mjs");
    expect(readme).toContain("coding-agent-benchmark-system-smoke/v1");
    expect(readme).toContain("coding-agent-benchmark-linux-snapshot-preparation.mjs");
    expect(readme).toContain("coding-agent-benchmark-linux-snapshot-preparation/v1");
    expect(readme).toContain("benchmark:coding-agent:v3:navigation-efficiency");
    expect(readme).toContain("coding-agent-benchmark-navigation-efficiency/v1");
    expect(readme).toContain("navigation-efficiency.schema.json");
    expect(readme).toContain("tokenImpact");
    expect(readme).toContain("no_model_call");
    expect(readme).toContain("benchmark:coding-agent:v3:navigation-shadow-dry-run");
    expect(readme).toContain("navigation-shadow-canary/v1");
    expect(readme).toContain("pending_confirmation");
    expect(readme).toContain("benchmark:coding-agent:v3:navigation-shadow-real");
    expect(readme).toContain("navigation-shadow-real/v1");
    expect(readme).toContain("coding-agent-benchmark-navigation-shadow-real-v2/v1");
    expect(readme).toContain("benchmark:coding-agent:v3:navigation-shadow-real-v3");
    expect(readme).toContain("coding-agent-benchmark-navigation-shadow-real-v3/v1");
    expect(readme).toContain("benchmark:coding-agent:v3:navigation-shadow-analysis");
    expect(readme).toContain("navigation-shadow-analysis/v1");
    expect(readme).toContain("benchmark:coding-agent:v3:navigation-shadow-v2-analysis");
    expect(readme).toContain("navigation-shadow-v2-analysis/v1");
    expect(readme).toContain("benchmark:coding-agent:v3:navigation-shadow-v3-analysis");
    expect(readme).toContain("coding-agent-benchmark-navigation-shadow-v3-analysis/v1");
    expect(readme).toContain("benchmark:coding-agent:v3:model-loop-budget-termination");
    expect(readme).toContain("coding-agent-benchmark-model-loop-budget-termination/v1");
    expect(readme).toContain("benchmark:coding-agent:v3:model-loop-rollout-audit");
    expect(readme).toContain("coding-agent-benchmark-model-loop-rollout-audit/v1");
    expect(readme).toContain("hold_explicit_opt_in");
    expect(readme).toContain("cost-containment-v1");
    expect(readme).toContain("taskUplift");
    expect(readme).toContain("benchmark:coding-agent:v3:navigation-candidate-v3");
    expect(readme).toContain("coding-agent-benchmark-navigation-candidate-v3/v1");
    expect(readme).toContain("bounded-navigation-v1");
    expect(readme).toContain("do_not_promote");
    expect(readme).toContain("workflowBatchRunner");
    expect(readme).toContain("managedWorktree");
    expect(readme).toContain("userWorktreeRuntime");
    expect(readme).toContain("reconciliationJournal");
    expect(readme).toContain("workspaceRevision");
    expect(readme).toContain("fileTool");
    expect(readme).toContain("coding-agent-benchmark-v3-web-ui-truth-set.mjs");
    expect(readme).toContain("coding-agent-benchmark-web-ui-truth-set/v1");
    expect(readme).toContain("real-web-ui-regression-truth-set.json");
    expect(readme).toContain("real-web-ui-regression-truth-set.schema.json");
    expect(projectMap).toContain("scripts/run-coding-agent-benchmark-wsl.mjs");
    expect(projectMap).toContain("scripts/coding-agent-benchmark-system-harness.mjs");
    expect(projectMap).toContain("scripts/coding-agent-benchmark-parallel-read-harness.mjs");
    expect(projectMap).toContain("scripts/coding-agent-benchmark-parallel-write-harness.mjs");
    expect(projectMap).toContain("scripts/coding-agent-benchmark-restart-delivery-harness.mjs");
    expect(projectMap).toContain("scripts/run-coding-agent-benchmark-system-smoke.mjs");
    expect(projectMap).toContain("scripts/coding-agent-benchmark-linux-snapshot-preparation.mjs");
    expect(projectMap).toContain("scripts/run-coding-agent-benchmark-navigation-efficiency.mjs");
    expect(projectMap).toContain("benchmarks/coding-agent/v3/navigation-efficiency.schema.json");
    expect(projectMap).toContain("scripts/run-coding-agent-benchmark-navigation-shadow-canary.mjs");
    expect(projectMap).toContain("benchmarks/coding-agent/v3/navigation-shadow-canary.schema.json");
    expect(projectMap).toContain("scripts/run-coding-agent-benchmark-navigation-shadow-real.mjs");
    expect(projectMap).toContain("benchmarks/coding-agent/v3/navigation-shadow-real.schema.json");
    expect(projectMap).toContain("scripts/run-coding-agent-benchmark-navigation-shadow-real-v2.mjs");
    expect(projectMap).toContain("benchmarks/coding-agent/v3/navigation-shadow-real-v2.schema.json");
    expect(projectMap).toContain("scripts/run-coding-agent-benchmark-navigation-shadow-real-v3.mjs");
    expect(projectMap).toContain("benchmarks/coding-agent/v3/navigation-shadow-real-v3.schema.json");
    expect(projectMap).toContain("scripts/run-coding-agent-benchmark-navigation-shadow-analysis.mjs");
    expect(projectMap).toContain("benchmarks/coding-agent/v3/navigation-shadow-analysis.schema.json");
    expect(projectMap).toContain("scripts/run-coding-agent-benchmark-navigation-shadow-v2-analysis.mjs");
    expect(projectMap).toContain("benchmarks/coding-agent/v3/navigation-shadow-v2-analysis.schema.json");
    expect(projectMap).toContain("scripts/run-coding-agent-benchmark-navigation-shadow-v3-analysis.mjs");
    expect(projectMap).toContain("benchmarks/coding-agent/v3/navigation-shadow-v3-analysis.schema.json");
    expect(projectMap).toContain("scripts/run-coding-agent-benchmark-model-loop-budget-termination.mjs");
    expect(projectMap).toContain("benchmarks/coding-agent/v3/model-loop-budget-termination.schema.json");
    expect(projectMap).toContain("scripts/run-coding-agent-benchmark-model-loop-rollout-audit.mjs");
    expect(projectMap).toContain("benchmarks/coding-agent/v3/model-loop-rollout-audit.schema.json");
    expect(projectMap).toContain("scripts/run-coding-agent-benchmark-navigation-candidate-v3.mjs");
    expect(projectMap).toContain("benchmarks/coding-agent/v3/navigation-candidate-v3.schema.json");
    expect(projectMap).toContain("benchmarks/coding-agent/v2/agents.json");
    expect(projectMap).toContain("scripts/coding-agent-benchmark-v3-web-ui-truth-set.mjs");
    expect(projectMap).toContain(
      "benchmarks/coding-agent/v3/real-web-ui-regression-truth-set.json",
    );
    expect(projectMap).toContain(
      "benchmarks/coding-agent/v3/real-web-ui-regression-truth-set.schema.json",
    );
    expect(projectMap).toContain("scripts/coding-agent-recovery-harness.mjs");
    expect(projectMap).toContain("scripts/aggregate-coding-agent-benchmark.mjs");
    expect(gitAttributes).toContain(
      "benchmarks/coding-agent/v3/real-web-ui-regression-truth-set.json text eol=lf",
    );
  });

  it("publishes a fail-closed Schema for the external Gateway fault artifact", async () => {
    const schema = JSON.parse(await fs.readFile(path.join(
      workspaceRoot,
      "benchmarks/coding-agent/v1/fault-injection.schema.json",
    ), "utf-8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const recovered = {
      schemaVersion: "coding-agent-fault-injection/v1",
      taskId: "gateway.disconnect-recovery",
      fault: "gateway_disconnect",
      status: "recovered",
      disconnectedAfterSeq: 4,
      resumedFromSeq: 4,
      disconnectCount: 1,
      reconnectCount: 1,
      binding: { conversationId: "conversation-recovery", agentRunId: "run-recovery" },
    };
    expect(compiled.validator.validateOutput(JSON.stringify(recovered))).toMatchObject({ ok: true });
    expect(compiled.validator.validateOutput(JSON.stringify({
      ...recovered,
      reconnectCount: 0,
    }))).toMatchObject({ ok: false });
  });

  it("publishes a fail-closed Schema for the external client cancellation artifact", async () => {
    const schema = JSON.parse(await fs.readFile(path.join(
      workspaceRoot,
      "benchmarks/coding-agent/v1/cancel-injection.schema.json",
    ), "utf-8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const confirmed = {
      schemaVersion: "coding-agent-cancel-injection/v1",
      trigger: "run.started",
      status: "confirmed",
      observedStartedSeq: 1,
      cancellationRequestCount: 1,
      cancelExitCode: 0,
      binding: { conversationId: "conversation-cancel", agentRunId: "run-cancel" },
      terminalType: "run.cancelled",
      terminalSeq: 2,
    };
    expect(compiled.validator.validateOutput(JSON.stringify(confirmed))).toMatchObject({ ok: true });
    expect(compiled.validator.validateOutput(JSON.stringify({
      ...confirmed,
      cancellationRequestCount: 0,
    }))).toMatchObject({ ok: false });
  });

  it("rejects Web UI truth cases that contradict the frozen attribute behavior", async () => {
    const truthSet = JSON.parse(await fs.readFile(path.join(
      workspaceRoot,
      "benchmarks/coding-agent/v3/real-web-ui-regression-truth-set.json",
    ), "utf-8"));
    truthSet.cases.push({
      id: "aria-expanded-false",
      attributeName: "aria-expanded",
      valueKind: "false",
      expected: { operation: "remove" },
    });

    expect(() => validateCodingAgentBenchmarkWebUiTruthSet(truthSet)).toThrow(
      /aria-expanded-false.*frozen behavior/i,
    );
  });

  it("rejects duplicate Web UI truth inputs even when their case ids differ", async () => {
    const truthSet = JSON.parse(await fs.readFile(path.join(
      workspaceRoot,
      "benchmarks/coding-agent/v3/real-web-ui-regression-truth-set.json",
    ), "utf-8"));
    truthSet.cases.push({
      ...truthSet.cases[0],
      id: "aria-false-duplicate",
    });

    expect(() => validateCodingAgentBenchmarkWebUiTruthSet(truthSet)).toThrow(
      /aria-false-duplicate.*duplicate input/i,
    );
  });

  it("requires ordinary false witnesses for both broad first-character families", async () => {
    const truthSet = JSON.parse(await fs.readFile(path.join(
      workspaceRoot,
      "benchmarks/coding-agent/v3/real-web-ui-regression-truth-set.json",
    ), "utf-8"));
    truthSet.cases = truthSet.cases.filter((testCase) => (
      testCase.id !== "ordinary-a-prefix-false"
        && testCase.id !== "ordinary-d-prefix-false"
    ));

    expect(() => validateCodingAgentBenchmarkWebUiTruthSet(truthSet)).toThrow(
      /ordinary a-prefix and d-prefix false witnesses/i,
    );
  });

  it("requires an ordinary ar-prefix false witness", async () => {
    const truthSet = JSON.parse(await fs.readFile(path.join(
      workspaceRoot,
      "benchmarks/coding-agent/v3/real-web-ui-regression-truth-set.json",
    ), "utf-8"));
    truthSet.cases = truthSet.cases.filter((testCase) => (
      testCase.id !== "ordinary-ar-prefix-false"
    ));

    expect(() => validateCodingAgentBenchmarkWebUiTruthSet(truthSet)).toThrow(
      /ordinary ar-prefix false witness/i,
    );
  });

  it("keeps the manifest, schemas, documentation, scripts, and cross-platform gate aligned", async () => {
    await expect(collectCodingAgentBenchmarkContractFailures({ workspaceRoot })).resolves.toEqual([]);
  });

  it("fails closed when the Web UI truth set SHA drifts from the task manifest", async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-web-ui-contract-"));
    const fixturePaths = [
      "benchmarks/coding-agent/v3/task-manifest.json",
      "benchmarks/coding-agent/v3/real-web-ui-regression-truth-set.json",
      "benchmarks/coding-agent/v3/real-web-ui-regression-truth-set.schema.json",
    ];
    try {
      for (const relativePath of fixturePaths) {
        const target = path.join(fixtureRoot, relativePath);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(path.join(workspaceRoot, relativePath), target);
      }
      const manifestPath = path.join(
        fixtureRoot,
        "benchmarks/coding-agent/v3/task-manifest.json",
      );
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
      const task = manifest.tasks.find((candidate) => candidate.id === "real-web.ui-regression");
      task.truthSet.sha256 = "0".repeat(64);
      await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");

      const failures = await collectCodingAgentBenchmarkContractFailures({ workspaceRoot: fixtureRoot });
      expect(failures).toEqual(expect.arrayContaining([
        expect.stringMatching(/Web UI truth set SHA-256 drifted/i),
      ]));
    } finally {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when the standalone run artifact Schema is missing", async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-contract-"));
    const fixturePaths = [
      "package.json",
      "benchmarks/coding-agent/v1/task-manifest.json",
      "benchmarks/coding-agent/v1/task-manifest.schema.json",
      "benchmarks/coding-agent/v1/benchmark-report.schema.json",
      "benchmarks/coding-agent/README.md",
      "docs/project-map.md",
      ".github/workflows/quality-gates.yml",
    ];
    try {
      for (const relativePath of fixturePaths) {
        const target = path.join(fixtureRoot, relativePath);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(path.join(workspaceRoot, relativePath), target);
      }

      const failures = await collectCodingAgentBenchmarkContractFailures({ workspaceRoot: fixtureRoot });
      expect(failures).toEqual(expect.arrayContaining([
        expect.stringMatching(/benchmark-run\.schema\.json is missing/i),
      ]));
    } finally {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when the candidate qualification report Schema does not compile", async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-qualification-schema-"));
    const schemaPath = path.join(
      fixtureRoot,
      "benchmarks",
      "coding-agent",
      "v3",
      "candidate-qualification-report.schema.json",
    );
    try {
      await fs.mkdir(path.dirname(schemaPath), { recursive: true });
      await fs.writeFile(schemaPath, JSON.stringify({ type: 7 }), "utf-8");

      const failures = await collectCodingAgentBenchmarkContractFailures({ workspaceRoot: fixtureRoot });
      expect(failures).toEqual(expect.arrayContaining([
        expect.stringMatching(/v3 candidate qualification report Schema does not compile/i),
      ]));
    } finally {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when candidate qualification report Schema versions drift", async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-qualification-version-"));
    const schemaPath = path.join(
      fixtureRoot,
      "benchmarks",
      "coding-agent",
      "v3",
      "candidate-qualification-report.schema.json",
    );
    const schema = JSON.parse(await fs.readFile(path.join(
      workspaceRoot,
      "benchmarks",
      "coding-agent",
      "v3",
      "candidate-qualification-report.schema.json",
    ), "utf-8"));
    try {
      await fs.mkdir(path.dirname(schemaPath), { recursive: true });

      const reportVersionDrift = structuredClone(schema);
      reportVersionDrift.properties.schemaVersion.const = "candidate-qualification-report/drifted";
      await fs.writeFile(schemaPath, JSON.stringify(reportVersionDrift), "utf-8");
      const reportFailures = await collectCodingAgentBenchmarkContractFailures({ workspaceRoot: fixtureRoot });
      expect(reportFailures).toEqual(expect.arrayContaining([
        expect.stringMatching(/candidate qualification report Schema version drifted/i),
      ]));

      const decisionVersionDrift = structuredClone(schema);
      decisionVersionDrift.$defs.partialDecision.properties.schemaVersion.const =
        "candidate-qualification/drifted";
      await fs.writeFile(schemaPath, JSON.stringify(decisionVersionDrift), "utf-8");
      const decisionFailures = await collectCodingAgentBenchmarkContractFailures({ workspaceRoot: fixtureRoot });
      expect(decisionFailures).toEqual(expect.arrayContaining([
        expect.stringMatching(/candidate qualification decision Schema version drifted/i),
      ]));

      const eligibleDecisionVersionDrift = structuredClone(schema);
      eligibleDecisionVersionDrift.$defs.eligibleDecision.properties.schemaVersion.const =
        "candidate-qualification/drifted";
      await fs.writeFile(schemaPath, JSON.stringify(eligibleDecisionVersionDrift), "utf-8");
      const eligibleDecisionFailures = await collectCodingAgentBenchmarkContractFailures({
        workspaceRoot: fixtureRoot,
      });
      expect(eligibleDecisionFailures).toEqual(expect.arrayContaining([
        expect.stringMatching(/eligible candidate qualification decision Schema version drifted/i),
      ]));

      const digestVersionDrift = structuredClone(schema);
      digestVersionDrift.$defs.source.properties.evidence.properties.schemaVersion.const =
        "qualification-evidence-digest/drifted";
      await fs.writeFile(schemaPath, JSON.stringify(digestVersionDrift), "utf-8");
      const digestFailures = await collectCodingAgentBenchmarkContractFailures({ workspaceRoot: fixtureRoot });
      expect(digestFailures).toEqual(expect.arrayContaining([
        expect.stringMatching(/qualification evidence digest Schema version drifted/i),
      ]));

      const scoreEvaluatorVersionDrift = structuredClone(schema);
      scoreEvaluatorVersionDrift.$defs.source.properties.scoreEvaluationSchemaVersion.const =
        "candidate-score-evaluation/drifted";
      await fs.writeFile(schemaPath, JSON.stringify(scoreEvaluatorVersionDrift), "utf-8");
      const scoreEvaluatorFailures = await collectCodingAgentBenchmarkContractFailures({
        workspaceRoot: fixtureRoot,
      });
      expect(scoreEvaluatorFailures).toEqual(expect.arrayContaining([
        expect.stringMatching(/qualification score evaluator Schema version drifted/i),
      ]));
    } finally {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when candidate qualification repository wiring is absent", async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-qualification-wiring-"));
    try {
      await fs.mkdir(path.join(fixtureRoot, "benchmarks", "coding-agent"), { recursive: true });
      await fs.mkdir(path.join(fixtureRoot, "docs"), { recursive: true });
      await fs.writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({ scripts: {} }), "utf-8");
      await fs.writeFile(path.join(fixtureRoot, "benchmarks", "coding-agent", "README.md"), "", "utf-8");
      await fs.writeFile(path.join(fixtureRoot, "docs", "project-map.md"), "", "utf-8");

      const failures = await collectCodingAgentBenchmarkContractFailures({ workspaceRoot: fixtureRoot });
      expect(failures).toEqual(expect.arrayContaining([
        "package.json must expose benchmark:coding-agent:v3:candidate-qualification.",
        "coding benchmark README must document benchmark:coding-agent:v3:candidate-qualification.",
        "coding benchmark README must document coding-agent-benchmark-candidate-qualification-report/v2.",
        "coding benchmark README must document candidate-qualification.json.",
        "docs/project-map.md must describe scripts/run-coding-agent-candidate-qualification.mjs.",
        "docs/project-map.md must describe benchmarks/coding-agent/v3/candidate-qualification-report.schema.json.",
      ]));
    } finally {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when candidate dimension and Supervisor repository wiring is absent", async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-dimension-wiring-"));
    try {
      await fs.mkdir(path.join(fixtureRoot, "benchmarks", "coding-agent"), { recursive: true });
      await fs.mkdir(path.join(fixtureRoot, "docs"), { recursive: true });
      await fs.writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({ scripts: {} }), "utf-8");
      await fs.writeFile(path.join(fixtureRoot, "benchmarks", "coding-agent", "README.md"), "", "utf-8");
      await fs.writeFile(path.join(fixtureRoot, "docs", "project-map.md"), "", "utf-8");

      const failures = await collectCodingAgentBenchmarkContractFailures({ workspaceRoot: fixtureRoot });
      expect(failures).toEqual(expect.arrayContaining([
        expect.stringMatching(/v3\/candidate-dimension-mapping\.json is missing/i),
        expect.stringMatching(/v3\/candidate-dimension-mapping\.schema\.json is missing/i),
        expect.stringMatching(/v3\/candidate-dimension-evidence-reference\.schema\.json is missing/i),
        expect.stringMatching(/v3\/candidate-supervisor-evidence-receipt\.schema\.json is missing/i),
        expect.stringMatching(/scripts\/coding-agent-candidate-score\.mjs is missing/i),
        "package.json must expose verify:p2a-supervisor-fault-audit.",
        "coding benchmark README must document candidate-dimension-mapping.json.",
        "coding benchmark README must document candidate-dimension-evidence-reference.json.",
        "coding benchmark README must document coding-agent-benchmark-candidate-supervisor-evidence-receipt/v1.",
        "coding benchmark README must document session_long_running.",
        "coding benchmark README must document supervisor_dual_platform_60_minute_soak.",
        "coding benchmark README must document bounded_budget_cancel_restart_reattach.",
        "coding benchmark README must document managed_worktree_fan_in_review_remediation.",
        "coding benchmark README must document parallel_resource_convergence.",
        "coding benchmark README must document verify:p2a-supervisor-fault-audit.",
        "docs/project-map.md must describe scripts/coding-agent-candidate-score.mjs.",
        "docs/project-map.md must describe benchmarks/coding-agent/v3/candidate-dimension-mapping.json.",
        "docs/project-map.md must describe benchmarks/coding-agent/v3/candidate-dimension-mapping.schema.json.",
        "docs/project-map.md must describe benchmarks/coding-agent/v3/candidate-dimension-evidence-reference.schema.json.",
        "docs/project-map.md must describe benchmarks/coding-agent/v3/candidate-supervisor-evidence-receipt.schema.json.",
      ]));
    } finally {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when the candidate CodeIntel receipt Schema is absent", async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-code-intel-schema-"));
    try {
      const failures = await collectCodingAgentBenchmarkContractFailures({ workspaceRoot: fixtureRoot });
      expect(failures).toEqual(expect.arrayContaining([
        expect.stringMatching(/v3\/candidate-code-intel-evidence-receipt\.schema\.json is missing/i),
      ]));
    } finally {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when candidate CodeIntel producer repository wiring is absent", async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-code-intel-wiring-"));
    try {
      await fs.mkdir(path.join(fixtureRoot, "benchmarks", "coding-agent"), { recursive: true });
      await fs.mkdir(path.join(fixtureRoot, "docs"), { recursive: true });
      await fs.writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({ scripts: {} }), "utf-8");
      await fs.writeFile(path.join(fixtureRoot, "benchmarks", "coding-agent", "README.md"), "", "utf-8");
      await fs.writeFile(path.join(fixtureRoot, "docs", "project-map.md"), "", "utf-8");

      const failures = await collectCodingAgentBenchmarkContractFailures({ workspaceRoot: fixtureRoot });
      expect(failures).toEqual(expect.arrayContaining([
        expect.stringMatching(/scripts\/coding-agent-candidate-code-intel-receipt\.mjs is missing/i),
        expect.stringMatching(/scripts\/run-coding-agent-candidate-code-intel-receipt\.mjs is missing/i),
        "package.json must expose benchmark:coding-agent:v3:candidate-code-intel-receipt.",
        "coding benchmark README must document benchmark:coding-agent:v3:candidate-code-intel-receipt.",
        "coding benchmark README must document coding-agent-benchmark-candidate-code-intel-evidence-receipt/v1.",
        "docs/project-map.md must describe scripts/run-coding-agent-candidate-code-intel-receipt.mjs.",
        "docs/project-map.md must describe candidateCodeIntelReceipt.",
      ]));
    } finally {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when the candidate CodeIntel receipt Schema version drifts", async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-code-intel-version-"));
    const schemaPath = path.join(
      fixtureRoot,
      "benchmarks",
      "coding-agent",
      "v3",
      "candidate-code-intel-evidence-receipt.schema.json",
    );
    try {
      const schema = JSON.parse(await fs.readFile(path.join(
        workspaceRoot,
        "benchmarks",
        "coding-agent",
        "v3",
        "candidate-code-intel-evidence-receipt.schema.json",
      ), "utf-8"));
      schema.properties.schemaVersion.const = "coding-agent-benchmark-candidate-code-intel-evidence-receipt/drifted";
      await fs.mkdir(path.dirname(schemaPath), { recursive: true });
      await fs.writeFile(schemaPath, JSON.stringify(schema), "utf-8");

      const failures = await collectCodingAgentBenchmarkContractFailures({ workspaceRoot: fixtureRoot });
      expect(failures).toEqual(expect.arrayContaining([
        "v3 candidate CodeIntel receipt Schema version drifted from the producer and score loader contracts.",
      ]));
    } finally {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when candidate CLI/TUI producer repository wiring is absent", async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-cli-tui-wiring-"));
    try {
      await fs.mkdir(path.join(fixtureRoot, "benchmarks", "coding-agent"), { recursive: true });
      await fs.mkdir(path.join(fixtureRoot, "docs"), { recursive: true });
      await fs.writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({ scripts: {} }), "utf-8");
      await fs.writeFile(path.join(fixtureRoot, "benchmarks", "coding-agent", "README.md"), "", "utf-8");
      await fs.writeFile(path.join(fixtureRoot, "docs", "project-map.md"), "", "utf-8");

      const failures = await collectCodingAgentBenchmarkContractFailures({ workspaceRoot: fixtureRoot });
      expect(failures).toEqual(expect.arrayContaining([
        expect.stringMatching(/scripts\/coding-agent-candidate-cli-tui-receipt\.mjs is missing/i),
        expect.stringMatching(/scripts\/run-coding-agent-candidate-cli-tui-receipt\.mjs is missing/i),
        "package.json must expose benchmark:coding-agent:v3:candidate-cli-tui-receipt.",
        "docs/project-map.md must describe candidateCliTuiReceipt.",
      ]));
    } finally {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when the candidate CLI/TUI receipt Schema version drifts", async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-cli-tui-version-"));
    const schemaPath = path.join(
      fixtureRoot,
      "benchmarks",
      "coding-agent",
      "v3",
      "candidate-cli-tui-evidence-receipt.schema.json",
    );
    try {
      const schema = JSON.parse(await fs.readFile(path.join(
        workspaceRoot,
        "benchmarks",
        "coding-agent",
        "v3",
        "candidate-cli-tui-evidence-receipt.schema.json",
      ), "utf-8"));
      schema.properties.schemaVersion.const =
        "coding-agent-benchmark-candidate-cli-tui-evidence-receipt/drifted";
      await fs.mkdir(path.dirname(schemaPath), { recursive: true });
      await fs.writeFile(schemaPath, JSON.stringify(schema), "utf-8");

      const failures = await collectCodingAgentBenchmarkContractFailures({ workspaceRoot: fixtureRoot });
      expect(failures).toEqual(expect.arrayContaining([
        "v3 candidate CLI/TUI receipt Schema version drifted from the producer and score loader contracts.",
      ]));
    } finally {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when candidate Verification repository wiring is absent", async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-verification-wiring-"));
    try {
      await fs.mkdir(path.join(fixtureRoot, "benchmarks", "coding-agent"), { recursive: true });
      await fs.mkdir(path.join(fixtureRoot, "docs"), { recursive: true });
      await fs.writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({ scripts: {} }), "utf-8");
      await fs.writeFile(path.join(fixtureRoot, "benchmarks", "coding-agent", "README.md"), "", "utf-8");
      await fs.writeFile(path.join(fixtureRoot, "docs", "project-map.md"), "", "utf-8");

      const failures = await collectCodingAgentBenchmarkContractFailures({ workspaceRoot: fixtureRoot });
      expect(failures).toEqual(expect.arrayContaining([
        expect.stringMatching(/v3\/candidate-verification-evidence-receipt\.schema\.json is missing/i),
        "package.json must expose verify:p1b-verification-audit.",
        "coding benchmark README must document coding-agent-benchmark-candidate-verification-evidence-receipt/v1.",
        "coding benchmark README must document verify:p1b-verification-audit.",
        "docs/project-map.md must describe benchmarks/coding-agent/v3/candidate-verification-evidence-receipt.schema.json.",
      ]));
    } finally {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when candidate coding-run client repository wiring is absent", async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-coding-run-client-wiring-"));
    try {
      await fs.mkdir(path.join(fixtureRoot, "benchmarks", "coding-agent"), { recursive: true });
      await fs.mkdir(path.join(fixtureRoot, "docs"), { recursive: true });
      await fs.writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({ scripts: {} }), "utf-8");
      await fs.writeFile(path.join(fixtureRoot, "benchmarks", "coding-agent", "README.md"), "", "utf-8");
      await fs.writeFile(path.join(fixtureRoot, "docs", "project-map.md"), "", "utf-8");

      const failures = await collectCodingAgentBenchmarkContractFailures({ workspaceRoot: fixtureRoot });
      expect(failures).toEqual(expect.arrayContaining([
        expect.stringMatching(/v3\/candidate-coding-run-client-evidence-receipt\.schema\.json is missing/i),
        expect.stringMatching(/v3\/candidate-coding-run-client-ci-evidence-receipt\.schema\.json is missing/i),
        expect.stringMatching(/v3\/coding-run-client-ci-lane-evidence\.schema\.json is missing/i),
        expect.stringMatching(/scripts\/run-coding-run-client-ci-lane-receipt\.mjs is missing/i),
        "package.json must expose verify:coding-run-client.",
        "coding benchmark README must document coding-agent-benchmark-candidate-coding-run-client-evidence-receipt/v1.",
        "coding benchmark README must document coding-agent-benchmark-candidate-coding-run-client-ci-evidence-receipt/v1.",
        "coding benchmark README must document coding-agent-benchmark-coding-run-client-ci-lane-evidence/v1.",
        "coding benchmark README must document headless_ecosystem.",
        "coding benchmark README must document external_consumer_pair_lifecycle.",
        "coding benchmark README must document protocol_version_conformance.",
        "coding benchmark README must document error_taxonomy_cancellation_conformance.",
        "coding benchmark README must document real_ci_consumer_binding.",
        "coding benchmark README must document verify:coding-run-client.",
        "docs/project-map.md must describe benchmarks/coding-agent/v3/candidate-coding-run-client-evidence-receipt.schema.json.",
        "docs/project-map.md must describe benchmarks/coding-agent/v3/candidate-coding-run-client-ci-evidence-receipt.schema.json.",
        "docs/project-map.md must describe benchmarks/coding-agent/v3/coding-run-client-ci-lane-evidence.schema.json.",
        "docs/project-map.md must describe scripts/run-coding-run-client-ci-lane-receipt.mjs.",
        "docs/project-map.md must describe candidateCodingRunClientReceipt.",
        "quality-gates.yml must produce coding-run client CI lane receipts after verification.",
        "quality-gates.yml must always upload both coding-run client CI evidence files.",
      ]));
    } finally {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when the public v3 schemas are absent", async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v3-contract-"));
    try {
      const failures = await collectCodingAgentBenchmarkContractFailures({ workspaceRoot: fixtureRoot });
      expect(failures).toEqual(expect.arrayContaining([
        expect.stringMatching(/v3\/task-manifest\.schema\.json is missing/i),
        expect.stringMatching(/v3\/benchmark-run\.schema\.json is missing/i),
        expect.stringMatching(/v3\/benchmark-report\.schema\.json is missing/i),
        expect.stringMatching(/v3\/scorecard\.schema\.json is missing/i),
        expect.stringMatching(/v3\/candidate-qualification-report\.schema\.json is missing/i),
        expect.stringMatching(/v3\/repository-inputs\.schema\.json is missing/i),
        expect.stringMatching(/v3\/linux-snapshot-preparation\.schema\.json is missing/i),
        expect.stringMatching(/v3\/preflight\.schema\.json is missing/i),
        expect.stringMatching(/v3\/repository-snapshot-preflight\.schema\.json is missing/i),
        expect.stringMatching(/v3\/repository-snapshot-receipt\.schema\.json is missing/i),
        expect.stringMatching(/v3\/system-scenario\.schema\.json is missing/i),
        expect.stringMatching(/v3\/system-evidence\.schema\.json is missing/i),
        expect.stringMatching(/v3\/navigation-efficiency\.schema\.json is missing/i),
        expect.stringMatching(/v3\/navigation-shadow-canary\.schema\.json is missing/i),
        expect.stringMatching(/v3\/navigation-shadow-real\.schema\.json is missing/i),
        expect.stringMatching(/v3\/navigation-shadow-real-v2\.schema\.json is missing/i),
        expect.stringMatching(/v3\/navigation-shadow-real-v3\.schema\.json is missing/i),
        expect.stringMatching(/v3\/navigation-shadow-analysis\.schema\.json is missing/i),
        expect.stringMatching(/v3\/navigation-shadow-v2-analysis\.schema\.json is missing/i),
        expect.stringMatching(/v3\/navigation-shadow-v3-analysis\.schema\.json is missing/i),
        expect.stringMatching(/v3\/model-loop-budget-termination\.schema\.json is missing/i),
        expect.stringMatching(/v3\/model-loop-rollout-audit\.schema\.json is missing/i),
        expect.stringMatching(/v3\/navigation-candidate-v3\.schema\.json is missing/i),
        expect.stringMatching(/v3\/real-web-ui-regression-truth-set\.json is missing/i),
        expect.stringMatching(/v3\/real-web-ui-regression-truth-set\.schema\.json is missing/i),
      ]));
    } finally {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});
