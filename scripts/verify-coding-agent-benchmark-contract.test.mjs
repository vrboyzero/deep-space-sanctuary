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

  it("fails closed when the public v3 schemas are absent", async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v3-contract-"));
    try {
      const failures = await collectCodingAgentBenchmarkContractFailures({ workspaceRoot: fixtureRoot });
      expect(failures).toEqual(expect.arrayContaining([
        expect.stringMatching(/v3\/task-manifest\.schema\.json is missing/i),
        expect.stringMatching(/v3\/benchmark-run\.schema\.json is missing/i),
        expect.stringMatching(/v3\/benchmark-report\.schema\.json is missing/i),
        expect.stringMatching(/v3\/scorecard\.schema\.json is missing/i),
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
