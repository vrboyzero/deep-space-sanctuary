import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startGatewayServer } from "../packages/belldandy-core/src/server.ts";
import {
  cleanupGlobalMemoryManagersForTest,
  resolveWebRoot,
} from "../packages/belldandy-core/src/server-testkit.ts";
import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import { runWorkflowBatch } from "../packages/belldandy-core/src/workflow-batch-runner.ts";
import { ManagedWorktreeRuntime } from "../packages/belldandy-core/src/managed-worktree.ts";
import { UserWorktreeRuntime } from "../packages/belldandy-core/src/user-worktree-runtime.ts";

import {
  consumeBenchmarkUsageBudget,
  createBenchmarkUsageBudget,
  buildNavigationShadowPrompt,
  extractBenchmarkTokenUsage,
  loadCodingAgentBenchmarkV3RepositoryInputs,
  resolveBenchmarkCliSourceRoot,
  resolveGatewayWorkspacePath,
  resolveBenchmarkInfrastructureRetries,
  resolveBenchmarkRuntimePlatform,
  resolveRecoveryGatewayTarget,
  resolveBenchmarkShadowCandidate,
  runStage0BSuite,
} from "./run-coding-agent-benchmark.mjs";
import {
  resolveGatewayProcessRestartTimeoutMs,
  runCodingRunSubscriptionProbe,
} from "./coding-agent-process-restart-harness.mjs";
import { createCodingAgentBenchmarkV3SystemHarness } from "./coding-agent-benchmark-system-harness.mjs";
import { CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V2_ID } from "./run-coding-agent-benchmark-navigation-candidate-v2.mjs";
import { CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_ID } from "./run-coding-agent-benchmark-navigation-candidate-v3.mjs";
import {
  CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID,
  CODE_INTEL_AGENT_UPLIFT_TASK_IDS,
} from "./run-code-intel-agent-uplift-readiness.mjs";
import { buildAgentRunArgs, resolveCodingCiProfile } from "./run-coding-agent-ci.mjs";

const tempRoots = [];
const windowsIt = process.platform === "win32" ? it : it.skip;

afterEach(async () => {
  await cleanupGlobalMemoryManagersForTest();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("coding agent benchmark stage 0B runner", () => {
  it("bounds explicit infrastructure retry provenance to the manifest policy", () => {
    expect(resolveBenchmarkInfrastructureRetries()).toBe(0);
    expect(resolveBenchmarkInfrastructureRetries(1)).toBe(1);
    expect(() => resolveBenchmarkInfrastructureRetries(-1)).toThrow(/within 0-1/i);
    expect(() => resolveBenchmarkInfrastructureRetries(0.5)).toThrow(/within 0-1/i);
    expect(() => resolveBenchmarkInfrastructureRetries(2)).toThrow(/within 0-1/i);
    expect(() => resolveBenchmarkInfrastructureRetries(0, -1)).toThrow(/retry limit is invalid/i);
  });

  it("allows recovery through only the exact WSL2 default Gateway", () => {
    const route = [
      "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask",
      "eth0\t00000000\t01801BAC\t0003\t0\t0\t0\t00000000",
    ].join("\n");
    const dependencies = {
      release: () => "6.6.87.2-microsoft-standard-WSL2",
      readRoute: () => route,
    };

    expect(resolveRecoveryGatewayTarget({
      BELLDANDY_HOST: "127.0.0.1",
      BELLDANDY_PORT: "28891",
    }, { id: "windows-native" }, dependencies)).toEqual({ host: "127.0.0.1", port: 28891 });
    expect(resolveRecoveryGatewayTarget({
      BELLDANDY_HOST: "172.27.128.1",
      BELLDANDY_PORT: "28891",
    }, { id: "wsl2-linux" }, dependencies)).toEqual({ host: "172.27.128.1", port: 28891 });
    expect(() => resolveRecoveryGatewayTarget({
      BELLDANDY_HOST: "172.27.128.2",
      BELLDANDY_PORT: "28891",
    }, { id: "wsl2-linux" }, dependencies)).toThrow(/loopback or the exact WSL2 default Gateway/i);
    expect(() => resolveRecoveryGatewayTarget({
      BELLDANDY_HOST: "172.27.128.1",
      BELLDANDY_PORT: "28891",
    }, { id: "wsl2-linux" }, {
      ...dependencies,
      release: () => "6.6.87.2-generic",
    })).toThrow(/loopback or the exact WSL2 default Gateway/i);
  });

  it("allows WSL2 v2/v3 cold dist imports without weakening Windows or v1 timeouts", () => {
    expect(resolveGatewayProcessRestartTimeoutMs("v2", "linux")).toBe(60_000);
    expect(resolveGatewayProcessRestartTimeoutMs("v3", "linux")).toBe(60_000);
    expect(resolveGatewayProcessRestartTimeoutMs("v2", "win32")).toBe(15_000);
    expect(resolveGatewayProcessRestartTimeoutMs("v3", "win32")).toBe(15_000);
    expect(resolveGatewayProcessRestartTimeoutMs("v1", "linux")).toBe(15_000);
  });

  it("keeps restart projection evidence inside the v1 and corrected v2 schemas", async () => {
    for (const [revision, trigger] of [
      ["v1", "run.started"],
      ["v2", "message.send.accepted"],
    ]) {
      const schema = JSON.parse(await fs.readFile(path.resolve(
        `benchmarks/coding-agent/${revision}/restart-injection.schema.json`,
      ), "utf-8"));
      const compiled = compileOutputSchema(schema);
      expect(compiled.ok, revision).toBe(true);
      if (!compiled.ok) continue;

      const result = compiled.validator.validateOutput(JSON.stringify({
        schemaVersion: "coding-agent-restart-injection/v1",
        taskId: "gateway.process-restart",
        trigger,
        status: "not_injected",
        observedStartedSeq: null,
        messageSendRequestCount: 0,
        binding: null,
        originalGateway: null,
        replacementGateway: null,
        subscription: { exitCode: null, errorCode: null, eventCount: 0, diagnostic: null },
        cancellation: { exitCode: null, accepted: null, state: null },
        projection: {
          beforeRestart: {
            exitCode: null,
            ok: false,
            epoch: null,
            revision: null,
            totalCount: null,
            cursor: null,
            errorCode: null,
          },
          afterRestart: { exitCode: null, ok: false, errorCode: null },
        },
        cleanup: { managedGatewayProcessCount: 0, originalGateway: null, replacementGateway: null },
      }));
      expect(result, revision).toMatchObject({ ok: true });
    }
  });

  it("derives a Windows Gateway workspace without replacing the WSL evaluator workspace", () => {
    const gatewayFixtureRoot = "\\\\wsl.localhost\\Ubuntu-22.04\\var\\tmp\\coding-agent-fixtures";

    expect(resolveGatewayWorkspacePath({
      fixtureRoot: "/var/tmp/coding-agent-fixtures",
      gatewayFixtureRoot,
      runId: "rules-wsl2-linux-a1-test",
    })).toBe(
      "\\\\wsl.localhost\\Ubuntu-22.04\\var\\tmp\\coding-agent-fixtures\\rules-wsl2-linux-a1-test\\workspace",
    );
    expect(resolveGatewayWorkspacePath({
      fixtureRoot: "/var/tmp/coding-agent-fixtures",
      runId: "rules-wsl2-linux-a1-test",
    })).toBe("/var/tmp/coding-agent-fixtures/rules-wsl2-linux-a1-test/workspace");
    expect(() => resolveGatewayWorkspacePath({
      fixtureRoot: "/var/tmp/coding-agent-fixtures",
      gatewayFixtureRoot: "relative/gateway-fixtures",
      runId: "rules-wsl2-linux-a1-test",
    })).toThrow(/absolute Windows path/i);
    expect(() => resolveGatewayWorkspacePath({
      fixtureRoot: "/var/tmp/coding-agent-fixtures",
      gatewayFixtureRoot,
      runId: "../outside",
    })).toThrow(/remain inside gatewayFixtureRoot/i);
  });

  it("passes separate evaluator and Gateway workspace roots through the WSL benchmark task", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-wsl-workspace-routing-"));
    tempRoots.push(root);
    const fixtureRoot = path.join(root, "fixtures");
    const artifactRoot = path.join(root, "artifacts");
    const stateRoot = path.join(root, "state");
    const gatewayFixtureRoot = "\\\\wsl.localhost\\Ubuntu-22.04\\var\\tmp\\coding-agent-fixtures";
    const runId = "rules-wsl2-linux-a1-routing-test";
    const invocations = [];

    await runStage0BSuite({
      platform: "wsl2-linux",
      taskIds: ["rules.nested-precedence"],
      fixtureRoot,
      gatewayFixtureRoot,
      artifactRoot,
      stateRoot,
      attempt: 1,
      runIds: { "rules.nested-precedence": runId },
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
    }, {
      runtime: {
        platform: "linux",
        osRelease: "6.6.87.2-microsoft-standard-WSL2",
        env: { WSL_DISTRO_NAME: "Ubuntu-22.04" },
      },
      async executeCodingCi(input) {
        invocations.push(input);
        return { exitCode: 4, stdout: "", stderr: "workspace routing probe" };
      },
    });

    expect(invocations).toHaveLength(1);
    expect(invocations[0].workspace).toBe(path.join(fixtureRoot, runId, "workspace"));
    expect(invocations[0].gatewayWorkspace).toBe(
      `\\\\wsl.localhost\\Ubuntu-22.04\\var\\tmp\\coding-agent-fixtures\\${runId}\\workspace`,
    );
  });

  it("keeps the WSL process-restart harness on its local evaluator workspace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-wsl-restart-routing-"));
    tempRoots.push(root);
    const runId = "gateway-process-restart-wsl2-linux-a1-routing-test";
    const invocations = [];

    await runStage0BSuite({
      platform: "wsl2-linux",
      manifestRevision: "v2",
      sourceRoot: path.resolve("."),
      taskIds: ["gateway.process-restart"],
      fixtureRoot: path.join(root, "fixtures"),
      gatewayFixtureRoot: "\\\\wsl.localhost\\Ubuntu-22.04\\var\\tmp\\coding-agent-fixtures",
      artifactRoot: path.join(root, "artifacts"),
      stateRoot: path.join(root, "state"),
      attempt: 1,
      runIds: { "gateway.process-restart": runId },
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
    }, {
      runtime: {
        platform: "linux",
        osRelease: "6.6.87.2-microsoft-standard-WSL2",
        env: { WSL_DISTRO_NAME: "Ubuntu-22.04" },
      },
      async executeProcessRestartCodingCi(input) {
        invocations.push(input);
        return { exitCode: 4, stdout: "", stderr: "restart routing probe" };
      },
    });

    expect(invocations).toHaveLength(1);
    expect(invocations[0].workspace).toBe(path.join(root, "fixtures", runId, "workspace"));
    expect(invocations[0]).not.toHaveProperty("gatewayWorkspace");
  });

  it("requires an explicit source root only for corrected v2 CLI runs", () => {
    expect(resolveBenchmarkCliSourceRoot(new Map(), "v1")).toBe(path.resolve("."));
    expect(() => resolveBenchmarkCliSourceRoot(new Map(), "v2")).toThrow(/--source-root is required/i);
    expect(resolveBenchmarkCliSourceRoot(new Map([["source-root", "C:/source-fd70990"]]), "v2"))
      .toBe(path.resolve("C:/source-fd70990"));
  });

  it("appends the v2 navigation contract only for the explicit v3 shadow candidate", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-navigation-v2-wiring-"));
    tempRoots.push(root);
    const repositoryRoot = path.join(root, "prepared", "express");
    const receipt = createV3SnapshotReceipt("express");
    const runId = "real-js-bug-v2-wiring-windows-a1-test";
    let promptText = "";
    await runStage0BSuite({
      platform: "windows-native",
      manifestRevision: "v3",
      sourceRoot: path.resolve("."),
      taskIds: ["real-js.bug-fix"],
      fixtureRoot: path.join(root, "fixtures"),
      artifactRoot: path.join(root, "artifacts"),
      stateRoot: path.join(root, "state"),
      attempt: 1,
      runIds: { "real-js.bug-fix": runId },
      v3RepositoryInputs: {
        express: {
          repositoryRoot,
          dependencyCacheRoot: path.join(root, "prepared", "express-cache"),
          receipt,
        },
      },
      shadowCandidateId: CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V2_ID,
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
    }, {
      runtime: { platform: "win32", osRelease: "Windows fixture", env: {} },
      resolveRepositoryIdentity: async () => repositoryIdentity("2"),
      createBenchmarkPreflightArtifact: async (input) => createPassedV3RuntimePreflight(input),
      resolveV3FixtureProvider(manifest, taskId) {
        if (taskId !== "real-js.bug-fix") return undefined;
        const task = manifest.tasks.find((candidate) => candidate.id === taskId);
        const snapshotPreflight = createPassedV3SnapshotPreflight(task);
        return {
          taskId,
          layer: "B",
          kind: "repository-snapshot",
          readiness: "ready",
          repositoryId: "express",
          preflight: async () => snapshotPreflight,
          async generate(input) {
            await fs.mkdir(input.workspace, { recursive: true });
            return {
              task,
              workspace: input.workspace,
              baselineCommit: receipt.source.commit,
              prompt: task.prompt,
              outputSchema: summaryOutputSchema(),
              snapshotPreflight,
              snapshotReceipt: receipt,
            };
          },
          async evaluate() {
            return passedV3Evaluation("v2 wiring");
          },
        };
      },
      async executeCodingCi(input) {
        promptText = await fs.readFile(path.join(input.artifactDir, "prompt.md"), "utf-8");
        await fs.writeFile(
          path.join(input.artifactDir, "result.json"),
          `${JSON.stringify({ summary: "v2 wiring" })}\n`,
          "utf-8",
        );
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });
    expect(promptText).toContain("## Navigation Budget Contract");
    expect(promptText).toContain("maxResults=4");
    expect(promptText).toContain("Do not read the complete lib/request.js before text_search");
  });

  it("renders the runtime-bounded prompt only for navigation candidate v3", () => {
    const basePrompt = "Fix the frozen regression.";
    const rendered = buildNavigationShadowPrompt(
      basePrompt,
      CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_ID,
    );
    expect(rendered).toContain("## Runtime-Bounded Navigation Contract");
    expect(rendered).toContain("file_glob include must be one non-empty string");
    expect(buildNavigationShadowPrompt(basePrompt, undefined)).toBe(basePrompt);
    expect(buildNavigationShadowPrompt(basePrompt, CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V2_ID))
      .toContain("## Navigation Budget Contract");
  });

  it("routes the CodeIntel candidate only across the frozen v3 uplift cohort without prompt drift", () => {
    expect(resolveBenchmarkShadowCandidate({
      candidateId: CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID,
      manifestRevision: "v3",
      taskIds: [...CODE_INTEL_AGENT_UPLIFT_TASK_IDS],
    })).toBe(CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID);
    expect(buildNavigationShadowPrompt(
      "Keep the frozen task prompt unchanged.",
      CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID,
    )).toBe("Keep the frozen task prompt unchanged.");

    expect(() => resolveBenchmarkShadowCandidate({
      candidateId: CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID,
      manifestRevision: "v2",
      taskIds: [...CODE_INTEL_AGENT_UPLIFT_TASK_IDS],
    })).toThrow(/frozen v3 uplift cohort/i);
    expect(() => resolveBenchmarkShadowCandidate({
      candidateId: CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID,
      manifestRevision: "v3",
      taskIds: ["real-ts.api-migration", "feature.cross-file"],
    })).toThrow(/frozen v3 uplift cohort/i);

    expect(resolveBenchmarkShadowCandidate({
      candidateId: CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_ID,
      manifestRevision: "v3",
      taskIds: ["real-js.bug-fix"],
    })).toBe(CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_ID);
  });

  it("loads strict v3 repository inputs relative to their versioned CLI config", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v3-config-"));
    tempRoots.push(root);
    const configPath = path.join(root, "repository-inputs.json");
    const receiptPath = path.join(root, "receipts", "express.json");
    await fs.mkdir(path.dirname(receiptPath), { recursive: true });
    await fs.writeFile(receiptPath, `${JSON.stringify(createV3SnapshotReceipt("express"), null, 2)}\n`);
    const config = {
      schemaVersion: "coding-agent-benchmark-repository-inputs/v1",
      repositories: [{
        repositoryId: "express",
        repositoryRoot: "prepared/express",
        dependencyCacheRoot: "prepared/express-cache",
        receiptPath: "receipts/express.json",
      }],
    };
    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

    const inputs = await loadCodingAgentBenchmarkV3RepositoryInputs(configPath);
    const configSchema = await readJson(path.resolve(
      "benchmarks/coding-agent/v3/repository-inputs.schema.json",
    ));
    const compiledConfig = compileOutputSchema(configSchema);

    expect(inputs).toBeInstanceOf(Map);
    expect(inputs.get("express")).toEqual({
      repositoryRoot: path.join(root, "prepared", "express"),
      dependencyCacheRoot: path.join(root, "prepared", "express-cache"),
      receipt: createV3SnapshotReceipt("express"),
    });
    expect(compiledConfig.ok).toBe(true);
    if (compiledConfig.ok) {
      expect(compiledConfig.validator.validateOutput(JSON.stringify(config))).toMatchObject({ ok: true });
    }
  });

  it("rejects unknown, duplicate, and receipt-drifted v3 repository config entries", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v3-config-invalid-"));
    tempRoots.push(root);
    const receiptPath = path.join(root, "express-receipt.json");
    const configPath = path.join(root, "repository-inputs.json");
    await fs.writeFile(receiptPath, `${JSON.stringify(createV3SnapshotReceipt("express"), null, 2)}\n`);
    const entry = {
      repositoryId: "express",
      repositoryRoot: "express",
      dependencyCacheRoot: "express-cache",
      receiptPath: "express-receipt.json",
    };

    await fs.writeFile(configPath, JSON.stringify({
      schemaVersion: "coding-agent-benchmark-repository-inputs/v1",
      repositories: [entry],
      unexpected: true,
    }));
    await expect(loadCodingAgentBenchmarkV3RepositoryInputs(configPath))
      .rejects.toThrow(/repository config.*unexpected/i);

    await fs.writeFile(configPath, JSON.stringify({
      schemaVersion: "coding-agent-benchmark-repository-inputs/v1",
      repositories: [entry, entry],
    }));
    await expect(loadCodingAgentBenchmarkV3RepositoryInputs(configPath))
      .rejects.toThrow(/duplicate.*express/i);

    await fs.writeFile(receiptPath, JSON.stringify({
      ...createV3SnapshotReceipt("express"),
      repositoryId: "preact",
    }));
    await fs.writeFile(configPath, JSON.stringify({
      schemaVersion: "coding-agent-benchmark-repository-inputs/v1",
      repositories: [entry],
    }));
    await expect(loadCodingAgentBenchmarkV3RepositoryInputs(configPath))
      .rejects.toThrow(/receipt.*express/i);
  });

  it("fails closed before creating runner state when selected v3 providers lack external inputs", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v3-runner-"));
    tempRoots.push(root);
    const fixtureRoot = path.join(root, "fixtures");
    const artifactRoot = path.join(root, "artifacts");
    const stateRoot = path.join(root, "state");
    await expect(runStage0BSuite({
      platform: "windows-native",
      manifestRevision: "v3",
      taskIds: ["real-js.bug-fix"],
      fixtureRoot,
      artifactRoot,
      stateRoot,
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
    }, {
      runtime: { platform: "win32", osRelease: "Windows fixture", env: {} },
    })).rejects.toThrow(/v3.*repository input.*express/i);
    await expect(fs.stat(fixtureRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(artifactRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(stateRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes repository and system provider evidence into v3 run and report artifacts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v3-artifacts-"));
    tempRoots.push(root);
    const fixtureRoot = path.join(root, "fixtures");
    const artifactRoot = path.join(root, "artifacts");
    const stateRoot = path.join(root, "state");
    const repositoryRoot = path.join(root, "prepared", "express");
    const dependencyCacheRoot = path.join(root, "prepared", "express-cache");
    const repositoryRunId = "real-js-bug-windows-a1-test";
    const systemRunId = "system-browser-windows-a1-test";
    const receipt = createV3SnapshotReceipt("express");

    const report = await runStage0BSuite({
      platform: "windows-native",
      manifestRevision: "v3",
      sourceRoot: path.resolve("."),
      taskIds: ["real-js.bug-fix", "system.browser-behavior"],
      fixtureRoot,
      artifactRoot,
      stateRoot,
      attempt: 1,
      runIds: {
        "real-js.bug-fix": repositoryRunId,
        "system.browser-behavior": systemRunId,
      },
      v3RepositoryInputs: {
        express: { repositoryRoot, dependencyCacheRoot, receipt },
      },
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
      generatedAt: "2026-08-05T00:00:00.000Z",
    }, {
      runtime: { platform: "win32", osRelease: "Windows fixture", env: {} },
      resolveRepositoryIdentity: async () => repositoryIdentity("c"),
      createBenchmarkPreflightArtifact: async (input) => createPassedV3RuntimePreflight(input),
      resolveV3FixtureProvider(manifest, taskId) {
        if (taskId !== "real-js.bug-fix") return undefined;
        const task = manifest.tasks.find((candidate) => candidate.id === taskId);
        const snapshotPreflight = createPassedV3SnapshotPreflight(task);
        return {
          taskId,
          layer: "B",
          kind: "repository-snapshot",
          readiness: "ready",
          repositoryId: "express",
          preflight: async () => snapshotPreflight,
          async generate(input) {
            await fs.mkdir(input.workspace, { recursive: true });
            return {
              task,
              workspace: input.workspace,
              baselineCommit: receipt.source.commit,
              prompt: task.prompt,
              outputSchema: summaryOutputSchema(),
              snapshotPreflight,
              snapshotReceipt: receipt,
            };
          },
          async evaluate(input) {
            return passedV3Evaluation(input.result?.summary);
          },
        };
      },
      v3SystemHarness: {
        capabilities: { browserBehavior: true },
        async execute(input) {
          expect(input.scenario).toMatchObject({ taskId: "system.browser-behavior" });
          await fs.writeFile(path.join(input.artifactDir, "browser-screenshot.png"), V3_BROWSER_SCREENSHOT);
          return createV3BrowserSystemEvidence(input.runId);
        },
      },
      async executeCodingCi(input) {
        await fs.writeFile(
          path.join(input.artifactDir, "result.json"),
          `${JSON.stringify({ summary: `Verified ${input.taskId}.` })}\n`,
          "utf-8",
        );
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    expect(report).toMatchObject({
      schemaVersion: "coding-agent-benchmark-report/v3",
      status: "partial",
      runs: [
        {
          schemaVersion: "coding-agent-benchmark-run/v3",
          taskId: "real-js.bug-fix",
          status: "passed",
          artifacts: {
            repositorySnapshotPreflight: `${repositoryRunId}/repository-snapshot-preflight.json`,
            repositorySnapshotReceipt: `${repositoryRunId}/repository-snapshot-receipt.json`,
          },
        },
        {
          schemaVersion: "coding-agent-benchmark-run/v3",
          taskId: "system.browser-behavior",
          status: "passed",
          artifacts: {
            systemScenario: `${systemRunId}/system-scenario.json`,
            systemEvidence: `${systemRunId}/system-evidence.json`,
            systemBrowserScreenshot: `${systemRunId}/browser-screenshot.png`,
          },
        },
      ],
      summary: { runCount: 2, passedRunCount: 2 },
    });

    await expect(readJson(path.join(
      artifactRoot,
      repositoryRunId,
      "repository-snapshot-preflight.json",
    ))).resolves.toMatchObject({ status: "passed", repositoryId: "express" });
    await expect(readJson(path.join(
      artifactRoot,
      repositoryRunId,
      "repository-snapshot-receipt.json",
    ))).resolves.toMatchObject({ repositoryId: "express" });
    await expect(readJson(path.join(
      artifactRoot,
      systemRunId,
      "system-scenario.json",
    ))).resolves.toMatchObject({ taskId: "system.browser-behavior" });
    await expect(readJson(path.join(
      artifactRoot,
      systemRunId,
      "system-evidence.json",
    ))).resolves.toMatchObject({ runId: systemRunId, status: "passed" });
    await expect(fs.readFile(path.join(
      artifactRoot,
      systemRunId,
      "browser-screenshot.png",
    ))).resolves.toEqual(V3_BROWSER_SCREENSHOT);

    const schemaValidations = [
      ["benchmark run", "benchmark-run.schema.json", report.runs],
      ["benchmark report", "benchmark-report.schema.json", [report]],
      ["runtime preflight", "preflight.schema.json", [await readJson(path.join(
        artifactRoot,
        repositoryRunId,
        "preflight.json",
      ))]],
      ["repository snapshot preflight", "repository-snapshot-preflight.schema.json", [await readJson(path.join(
        artifactRoot,
        repositoryRunId,
        "repository-snapshot-preflight.json",
      ))]],
      ["repository snapshot receipt", "repository-snapshot-receipt.schema.json", [await readJson(path.join(
        artifactRoot,
        repositoryRunId,
        "repository-snapshot-receipt.json",
      ))]],
      ["system scenario", "system-scenario.schema.json", [await readJson(path.join(
        artifactRoot,
        systemRunId,
        "system-scenario.json",
      ))]],
      ["system evidence", "system-evidence.schema.json", [await readJson(path.join(
        artifactRoot,
        systemRunId,
        "system-evidence.json",
      ))]],
    ];
    for (const [label, schemaName, samples] of schemaValidations) {
      const schema = await readJson(path.resolve("benchmarks/coding-agent/v3", schemaName));
      const compiled = compileOutputSchema(schema);
      expect(compiled.ok, label).toBe(true);
      if (compiled.ok) {
        for (const sample of samples) {
          expect(compiled.validator.validateOutput(JSON.stringify(sample)), label)
            .toMatchObject({ ok: true });
        }
      }
    }
  });

  it("passes the fixture baseline and task budget into the native parallel read harness", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v3-parallel-read-"));
    tempRoots.push(root);
    const runId = "system-parallel-read-windows-a1-test";
    const artifactRoot = path.join(root, "artifacts");
    const fixtureRoot = path.join(root, "fixtures");
    const harness = await createCodingAgentBenchmarkV3SystemHarness({}, {
      resolveBrowserExecutable: async () => null,
      resolveWorkflowBatchRunner: async () => runWorkflowBatch,
    });

    const report = await runStage0BSuite({
      platform: "windows-native",
      manifestRevision: "v3",
      sourceRoot: path.resolve("."),
      taskIds: ["system.parallel-read-isolation"],
      fixtureRoot,
      artifactRoot,
      stateRoot: path.join(root, "state"),
      attempt: 1,
      runIds: { "system.parallel-read-isolation": runId },
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
      generatedAt: "2026-08-06T00:00:00.000Z",
    }, {
      runtime: { platform: "win32", osRelease: "Windows fixture", env: {} },
      resolveRepositoryIdentity: async () => repositoryIdentity("8"),
      createBenchmarkPreflightArtifact: async (input) => createPassedV3RuntimePreflight(input),
      v3SystemHarness: harness,
      async executeCodingCi(input) {
        await fs.writeFile(
          path.join(input.artifactDir, "result.json"),
          `${JSON.stringify({ summary: "Verified native parallel read isolation." })}\n`,
          "utf-8",
        );
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    expect(report.runs[0]).toMatchObject({
      taskId: "system.parallel-read-isolation",
      status: "passed",
      execution: {
        budgets: { timeoutMs: 300_000, maxTurns: 12, maxTokens: 24_000 },
      },
      artifacts: {
        systemScenario: `${runId}/system-scenario.json`,
        systemEvidence: `${runId}/system-evidence.json`,
      },
    });
    const evidence = await readJson(path.join(artifactRoot, runId, "system-evidence.json"));
    expect(evidence).toMatchObject({
      taskId: "system.parallel-read-isolation",
      runId,
      status: "passed",
      observations: {
        children: [
          { terminalStatus: "completed", mutationCount: 0 },
          { terminalStatus: "completed", mutationCount: 0 },
          { terminalStatus: "completed", mutationCount: 0 },
        ],
      },
    });
    const schema = await readJson(path.resolve("benchmarks/coding-agent/v3/system-evidence.schema.json"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.validator.validateOutput(JSON.stringify(evidence))).toMatchObject({ ok: true });
    }
  });

  it("persists Schema-valid parallel write fan-in evidence from isolated worktrees", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v3-parallel-write-"));
    tempRoots.push(root);
    const runId = "system-parallel-write-windows-a1-test";
    const artifactRoot = path.join(root, "artifacts");
    const fixtureRoot = path.join(root, "fixtures");
    const harness = await createCodingAgentBenchmarkV3SystemHarness({}, {
      resolveBrowserExecutable: async () => null,
      resolveWorkflowBatchRunner: async () => runWorkflowBatch,
      resolveParallelWriteRuntimes: async () => ({ ManagedWorktreeRuntime, UserWorktreeRuntime }),
    });

    const report = await runStage0BSuite({
      platform: "windows-native",
      manifestRevision: "v3",
      sourceRoot: path.resolve("."),
      taskIds: ["system.parallel-write-fan-in"],
      fixtureRoot,
      artifactRoot,
      stateRoot: path.join(root, "state"),
      attempt: 1,
      runIds: { "system.parallel-write-fan-in": runId },
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
      generatedAt: "2026-08-06T00:00:00.000Z",
    }, {
      runtime: { platform: "win32", osRelease: "Windows fixture", env: {} },
      resolveRepositoryIdentity: async () => repositoryIdentity("9"),
      createBenchmarkPreflightArtifact: async (input) => createPassedV3RuntimePreflight(input),
      v3SystemHarness: harness,
      async executeCodingCi(input) {
        const agentArgs = buildAgentRunArgs({
          workspace: input.workspace,
          stateDir: input.stateDir,
          outputSchemaPath: input.outputSchemaPath,
          profile: resolveCodingCiProfile(input.mode, input.manifestRevision),
          manifestRevision: input.manifestRevision,
          taskId: input.taskId,
        });
        expect(agentArgs).not.toContain("--require-workspace-mutation");
        await fs.writeFile(
          path.join(input.artifactDir, "result.json"),
          `${JSON.stringify({ summary: "Verified native parallel write fan-in." })}\n`,
          "utf-8",
        );
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    expect(report.runs[0]).toMatchObject({
      taskId: "system.parallel-write-fan-in",
      status: "passed",
      execution: {
        budgets: { timeoutMs: 300_000, maxTurns: 12, maxTokens: 24_000 },
      },
      artifacts: {
        systemScenario: `${runId}/system-scenario.json`,
        systemEvidence: `${runId}/system-evidence.json`,
      },
    });
    const evidence = await readJson(path.join(artifactRoot, runId, "system-evidence.json"));
    expect(evidence).toMatchObject({
      taskId: "system.parallel-write-fan-in",
      runId,
      status: "passed",
      observations: {
        mainWorkspaceChangedBeforeFanIn: false,
        lanes: [
          { terminalStatus: "completed", mutationCount: 1 },
          { terminalStatus: "completed", mutationCount: 1 },
        ],
        conflict: { detected: true, path: "workspace/shared.txt" },
        fanIn: { mode: "preview-confirm", confirmed: true, status: "completed" },
      },
    });
    const schema = await readJson(path.resolve("benchmarks/coding-agent/v3/system-evidence.schema.json"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.validator.validateOutput(JSON.stringify(evidence))).toMatchObject({ ok: true });
    }
    const workspace = path.join(fixtureRoot, runId, "workspace");
    await expect(fs.readFile(path.join(workspace, "workspace", "shared.txt"), "utf-8"))
      .resolves.toSatisfy((content) => content.replace(/\r\n/g, "\n") === "base\n");
  }, 20_000);

  it("persists Schema-valid restart reconciliation evidence from two real processes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v3-restart-delivery-"));
    tempRoots.push(root);
    const runId = "system-restart-delivery-windows-a1-test";
    const artifactRoot = path.join(root, "artifacts");
    const fixtureRoot = path.join(root, "fixtures");
    const harness = await createCodingAgentBenchmarkV3SystemHarness({ sourceRoot: path.resolve(".") }, {
      resolveBrowserExecutable: async () => null,
      resolveWorkflowBatchRunner: async () => null,
      resolveParallelWriteRuntimes: async () => null,
    });

    const report = await runStage0BSuite({
      platform: "windows-native",
      manifestRevision: "v3",
      sourceRoot: path.resolve("."),
      taskIds: ["system.restart-delivery-reconciliation"],
      fixtureRoot,
      artifactRoot,
      stateRoot: path.join(root, "state"),
      attempt: 1,
      runIds: { "system.restart-delivery-reconciliation": runId },
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
      generatedAt: "2026-08-06T00:00:00.000Z",
    }, {
      runtime: { platform: "win32", osRelease: "Windows fixture", env: {} },
      resolveRepositoryIdentity: async () => repositoryIdentity("a"),
      createBenchmarkPreflightArtifact: async (input) => createPassedV3RuntimePreflight(input),
      v3SystemHarness: harness,
      async executeCodingCi(input) {
        await fs.writeFile(
          path.join(input.artifactDir, "result.json"),
          `${JSON.stringify({ summary: "Verified native restart delivery reconciliation." })}\n`,
          "utf-8",
        );
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    expect(report.runs[0]).toMatchObject({
      taskId: "system.restart-delivery-reconciliation",
      status: "passed",
      artifacts: {
        systemScenario: `${runId}/system-scenario.json`,
        systemEvidence: `${runId}/system-evidence.json`,
      },
    });
    const evidence = await readJson(path.join(artifactRoot, runId, "system-evidence.json"));
    expect(evidence).toMatchObject({
      taskId: "system.restart-delivery-reconciliation",
      runId,
      status: "passed",
      observations: {
        restartInjected: true,
        reattached: true,
        journalState: "applied",
        completedSideEffectCount: 1,
        replayedSideEffectCount: 0,
        localDeliveryStatus: "completed",
        remoteWriteCount: 0,
        terminalStatus: "completed",
      },
    });
    expect(evidence.observations.oldBindingId).not.toBe(evidence.observations.newBindingId);
    const schema = await readJson(path.resolve("benchmarks/coding-agent/v3/system-evidence.schema.json"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.validator.validateOutput(JSON.stringify(evidence))).toMatchObject({ ok: true });
    }
    const workspace = path.join(fixtureRoot, runId, "workspace");
    await expect(fs.readFile(path.join(workspace, "workspace", "durable.txt"), "utf-8"))
      .resolves.toSatisfy((content) => content.replace(/\r\n/g, "\n") === "side-effect-count=0\n");
  }, 20_000);

  it("records run-bound not-run system evidence when v3 runtime preflight fails", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v3-system-not-run-"));
    tempRoots.push(root);
    const runId = "system-browser-windows-preflight-failed";
    let codingCiCallCount = 0;
    let systemHarnessCallCount = 0;
    const artifactRoot = path.join(root, "artifacts");

    const report = await runStage0BSuite({
      platform: "windows-native",
      manifestRevision: "v3",
      sourceRoot: path.resolve("."),
      taskIds: ["system.browser-behavior"],
      fixtureRoot: path.join(root, "fixtures"),
      artifactRoot,
      stateRoot: path.join(root, "state"),
      attempt: 1,
      runIds: { "system.browser-behavior": runId },
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
      generatedAt: "2026-08-06T00:00:00.000Z",
    }, {
      runtime: { platform: "win32", osRelease: "Windows fixture", env: {} },
      resolveRepositoryIdentity: async () => repositoryIdentity("e"),
      createBenchmarkPreflightArtifact: async (input) => ({
        ...createPassedV3RuntimePreflight(input),
        status: "failed",
        checks: {
          ...createPassedV3RuntimePreflight(input).checks,
          contractSource: { status: "failed", reason: "source_build_unavailable" },
        },
      }),
      v3SystemHarness: {
        capabilities: { browserBehavior: true },
        async execute() {
          systemHarnessCallCount += 1;
          return createV3BrowserSystemEvidence(runId);
        },
      },
      async executeCodingCi() {
        codingCiCallCount += 1;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    expect(codingCiCallCount).toBe(0);
    expect(systemHarnessCallCount).toBe(0);
    expect(report.runs[0]).toMatchObject({
      taskId: "system.browser-behavior",
      status: "infrastructure_error",
      failureCategory: "infrastructure",
      artifacts: { systemEvidence: `${runId}/system-evidence.json` },
    });
    const evidence = await readJson(path.join(artifactRoot, runId, "system-evidence.json"));
    expect(evidence).toEqual({
      schemaVersion: "coding-agent-benchmark-system-evidence-not-run/v1",
      taskId: "system.browser-behavior",
      generatorId: "browser-behavior-v1",
      fixtureVersion: 1,
      runId,
      platform: "windows-native",
      status: "not_run",
      reason: "runtime_preflight_failed",
    });
    const schema = await readJson(path.resolve("benchmarks/coding-agent/v3/system-evidence.schema.json"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.validator.validateOutput(JSON.stringify(evidence))).toMatchObject({ ok: true });
    }
  });

  it("rejects credential-bearing and oversized v3 system evidence before persistence", async () => {
    const cases = [
      {
        label: "credential",
        expected: /forbidden credential field refreshToken/i,
        createEvidence: (runId) => ({
          ...createV3BrowserSystemEvidence(runId),
          metadata: { refreshToken: "must-not-persist" },
        }),
      },
      {
        label: "oversized",
        expected: /exceeds the 1 MiB artifact limit/i,
        createEvidence: (runId) => ({
          ...createV3BrowserSystemEvidence(runId),
          diagnostic: "x".repeat(1024 * 1024),
        }),
      },
    ];

    for (const item of cases) {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), `coding-benchmark-v3-${item.label}-`));
      tempRoots.push(root);
      const runId = `system-browser-${item.label}-evidence`;
      const artifactRoot = path.join(root, "artifacts");
      await expect(runStage0BSuite({
        platform: "windows-native",
        manifestRevision: "v3",
        sourceRoot: path.resolve("."),
        taskIds: ["system.browser-behavior"],
        fixtureRoot: path.join(root, "fixtures"),
        artifactRoot,
        stateRoot: path.join(root, "state"),
        attempt: 1,
        runIds: { "system.browser-behavior": runId },
        model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
      }, {
        runtime: { platform: "win32", osRelease: "Windows fixture", env: {} },
        resolveRepositoryIdentity: async () => repositoryIdentity("f"),
        createBenchmarkPreflightArtifact: async (input) => createPassedV3RuntimePreflight(input),
        v3SystemHarness: {
          capabilities: { browserBehavior: true },
          async execute() {
            return item.createEvidence(runId);
          },
        },
        async executeCodingCi(input) {
          await fs.writeFile(
            path.join(input.artifactDir, "result.json"),
            `${JSON.stringify({ summary: "Evidence boundary probe." })}\n`,
          );
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      })).rejects.toThrow(item.expected);
      await expect(fs.stat(path.join(artifactRoot, runId, "system-evidence.json")))
        .rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("rejects missing, oversized, or hash-drifted browser screenshots before evidence persistence", async () => {
    const cases = [
      {
        label: "missing",
        expected: /screenshot artifact is missing or invalid/i,
      },
      {
        label: "oversized",
        expected: /screenshot artifact is missing or invalid/i,
        screenshot: Buffer.alloc(5 * 1024 * 1024 + 1),
      },
      {
        label: "hash-drifted",
        expected: /screenshot artifact hash drifted/i,
        screenshot: Buffer.from("different screenshot bytes"),
      },
    ];

    for (const item of cases) {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), `coding-benchmark-v3-browser-${item.label}-`));
      tempRoots.push(root);
      const runId = `system-browser-${item.label}-artifact`;
      const artifactRoot = path.join(root, "artifacts");
      await expect(runStage0BSuite({
        platform: "windows-native",
        manifestRevision: "v3",
        sourceRoot: path.resolve("."),
        taskIds: ["system.browser-behavior"],
        fixtureRoot: path.join(root, "fixtures"),
        artifactRoot,
        stateRoot: path.join(root, "state"),
        attempt: 1,
        runIds: { "system.browser-behavior": runId },
        model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
      }, {
        runtime: { platform: "win32", osRelease: "Windows fixture", env: {} },
        resolveRepositoryIdentity: async () => repositoryIdentity("9"),
        createBenchmarkPreflightArtifact: async (input) => createPassedV3RuntimePreflight(input),
        v3SystemHarness: {
          capabilities: { browserBehavior: true },
          async execute(input) {
            if (item.screenshot) {
              await fs.writeFile(path.join(input.artifactDir, "browser-screenshot.png"), item.screenshot);
            }
            return createV3BrowserSystemEvidence(runId);
          },
        },
        async executeCodingCi(input) {
          await fs.writeFile(
            path.join(input.artifactDir, "result.json"),
            `${JSON.stringify({ summary: "Screenshot boundary probe." })}\n`,
          );
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      })).rejects.toThrow(item.expected);
      await expect(fs.stat(path.join(artifactRoot, runId, "system-evidence.json")))
        .rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("keeps corrected-v2 approval and budget behavior for v3 A-layer safety runs", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v3-safety-"));
    tempRoots.push(root);
    const runId = "safety-v3-windows-a1-test";
    const report = await runStage0BSuite({
      platform: "windows-native",
      manifestRevision: "v3",
      sourceRoot: path.resolve("."),
      taskIds: ["safety.boundary-enforcement"],
      fixtureRoot: path.join(root, "fixtures"),
      artifactRoot: path.join(root, "artifacts"),
      stateRoot: path.join(root, "state"),
      attempt: 1,
      runIds: { "safety.boundary-enforcement": runId },
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
      generatedAt: "2026-08-05T00:00:00.000Z",
    }, {
      runtime: { platform: "win32", osRelease: "Windows fixture", env: {} },
      resolveRepositoryIdentity: async () => repositoryIdentity("d"),
      createBenchmarkPreflightArtifact: async (input) => createPassedV3RuntimePreflight(input),
      async executeCodingCi() {
        return { exitCode: 4, stdout: "", stderr: "fixture runner unavailable" };
      },
    });

    expect(report.runs[0]).toMatchObject({
      schemaVersion: "coding-agent-benchmark-run/v3",
      taskId: "safety.boundary-enforcement",
      execution: { profile: "safety-probe", budgets: { maxTokens: 32000 } },
      artifacts: {
        approvalContract: `${runId}/approval-contract.json`,
        approvalEvidence: `${runId}/approval-evidence.json`,
      },
    });
    await expect(readJson(path.join(
      root,
      "artifacts",
      runId,
      "approval-contract.json",
    ))).resolves.toMatchObject({ manifestRevision: "v3", taskId: "safety.boundary-enforcement",
      accountingVersion: "coding-agent-benchmark-approval-accounting/v1" });
    await expect(readJson(path.join(
      root,
      "artifacts",
      runId,
      "approval-evidence.json",
    ))).resolves.toMatchObject({ manifestRevision: "v3", status: "not_run",
      accounting: { schemaVersion: "coding-agent-benchmark-approval-accounting/v1", verifiedAutomaticResponseCount: 0 } });
  });

  it("reserves part of the 50 CNY ceiling and fails closed when real-run cost is unavailable", () => {
    const budget = createBenchmarkUsageBudget({
      provider: "fixture",
      id: "priced-model",
      credentialsConfigured: true,
    });

    expect(budget).toMatchObject({ maxCostUsd: 5, remainingCostUsd: 5, observedCostUsd: 0 });
    expect(consumeBenchmarkUsageBudget(budget, {
      status: "provider_reported",
      costUsd: 0.75,
    })).toEqual({ continueRunning: true, reason: null });
    expect(budget).toMatchObject({ remainingCostUsd: 4.25, observedCostUsd: 0.75 });
    expect(consumeBenchmarkUsageBudget(budget, {
      status: "unavailable",
      costUsd: null,
    })).toEqual({ continueRunning: false, reason: "usage_unavailable" });
    expect(createBenchmarkUsageBudget({
      provider: "fixture",
      id: "fixture-model",
      credentialsConfigured: false,
    })).toBeUndefined();

    const resumedBudget = createBenchmarkUsageBudget({
      provider: "fixture",
      id: "priced-model",
      credentialsConfigured: true,
    }, { priorObservedCostUsd: 0.75 });
    expect(resumedBudget).toMatchObject({
      maxCostUsd: 5,
      remainingCostUsd: 4.25,
      observedCostUsd: 0.75,
    });
    expect(createBenchmarkUsageBudget({
      provider: "fixture",
      id: "priced-model",
      credentialsConfigured: true,
    }, { maxCostUsd: 3.15342019, priorObservedCostUsd: 3.05342019 })).toMatchObject({
      maxCostUsd: 3.15342019,
      remainingCostUsd: 0.1,
      observedCostUsd: 3.05342019,
    });
    expect(createBenchmarkUsageBudget({
      provider: "fixture",
      id: "priced-model",
      credentialsConfigured: true,
    }, { maxCostUsd: 0.25, priorObservedCostUsd: 0.01 })).toMatchObject({
      maxCostUsd: 0.25,
      remainingCostUsd: 0.24,
      observedCostUsd: 0.01,
    });
    expect(() => createBenchmarkUsageBudget({
      provider: "fixture",
      id: "priced-model",
      credentialsConfigured: true,
    }, { maxCostUsd: 0.25, priorObservedCostUsd: 0.25 }))
      .toThrow(/selected maximum cost/i);
    expect(() => createBenchmarkUsageBudget({
      provider: "fixture",
      id: "priced-model",
      credentialsConfigured: true,
    }, { priorObservedCostUsd: 5 })).toThrow(/prior observed cost/i);
    expect(() => createBenchmarkUsageBudget({
      provider: "fixture",
      id: "priced-model",
      credentialsConfigured: true,
    }, { maxCostUsd: 5.00000001 })).toThrow(/maximum cost/i);
    expect(() => createBenchmarkUsageBudget({
      provider: "fixture",
      id: "priced-model",
      credentialsConfigured: true,
    }, { priorObservedCostUsd: -0.01 })).toThrow(/prior observed cost/i);
    expect(() => createBenchmarkUsageBudget({
      provider: "fixture",
      id: "fixture-model",
      credentialsConfigured: false,
    }, { priorObservedCostUsd: 0.01 })).toThrow(/credentialsConfigured=true/i);
  });

  windowsIt("deducts prior observed cost before invoking a resumed real task", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-resumed-budget-"));
    tempRoots.push(root);
    const invocations = [];

    await runStage0BSuite({
      platform: "windows-native",
      taskIds: ["feature.cross-file"],
      fixtureRoot: path.join(root, "fixtures"),
      artifactRoot: path.join(root, "artifacts"),
      stateRoot: path.join(root, "state"),
      attempt: 1,
      runIds: { "feature.cross-file": "resumed-budget-windows-a1-test" },
      model: { provider: "fixture", id: "priced-model", credentialsConfigured: true },
      priorObservedCostUsd: 0.75,
      generatedAt: "2026-07-26T00:00:00.000Z",
    }, {
      async executeCodingCi(input) {
        invocations.push(input);
        return { exitCode: 4, stdout: "", stderr: "resumed budget fixture" };
      },
    });

    expect(invocations).toHaveLength(1);
    expect(invocations[0].maxCostUsd).toBe(4.25);
  });

  it("keeps the subscription probe stdin open until its matching response arrives", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-restart-subscription-probe-"));
    tempRoots.push(root);
    const bddEntry = path.join(root, "delayed-bdd.mjs");
    await fs.writeFile(bddEntry, [
      "let ended = false;",
      "let responded = false;",
      "process.stdin.on('end', () => { ended = true; if (!responded) { process.stdout.write(JSON.stringify({ version: 'v1', type: 'subscription.response', id: 'coding-benchmark-restart-subscription', ok: false, error: { code: 'gateway_unavailable' } }) + '\\n'); } });",
      "process.stdin.once('data', () => { setTimeout(() => { if (ended) return; responded = true; process.stdout.write(JSON.stringify({ version: 'v1', type: 'subscription.response', id: 'coding-benchmark-restart-subscription', ok: false, error: { code: 'not_found' } }) + '\\n'); }, 50); });",
    ].join("\n"), "utf-8");

    await expect(runCodingRunSubscriptionProbe({
      bddEntry,
      cwd: root,
      stateDir: root,
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
      env: {},
    })).resolves.toMatchObject({ exitCode: 0, errorCode: "not_found", eventCount: 0 });
  });

  it("redacts pairing codes from subscription probe diagnostics", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-restart-subscription-redaction-"));
    tempRoots.push(root);
    const bddEntry = path.join(root, "pairing-bdd.mjs");
    await fs.writeFile(bddEntry, [
      "process.stdin.once('data', () => { process.stdout.write(JSON.stringify({ version: 'v1', type: 'subscription.response', id: 'coding-benchmark-restart-subscription', ok: false, error: { code: 'pairing_required', message: 'Pairing required. Code: PAIR1234' } }) + '\\n'); });",
    ].join("\n"), "utf-8");

    await expect(runCodingRunSubscriptionProbe({
      bddEntry,
      cwd: root,
      stateDir: root,
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
      env: {},
    })).resolves.toMatchObject({
      errorCode: "pairing_required",
      diagnostic: "Pairing required. Code: [REDACTED]",
    });
  });

  it("accepts only a matching Windows native or WSL2 runtime fingerprint", () => {
    expect(resolveBenchmarkRuntimePlatform({ platform: "windows-native" }, {
      platform: "win32",
      osRelease: "10.0.26100",
      env: {},
    })).toEqual({ id: "windows-native", wsl: null });
    expect(resolveBenchmarkRuntimePlatform({ platform: "wsl2-linux" }, {
      platform: "linux",
      osRelease: "6.6.87.2-microsoft-standard-WSL2",
      env: { WSL_DISTRO_NAME: "Ubuntu-22.04" },
    })).toEqual({
      id: "wsl2-linux",
      wsl: { distribution: "Ubuntu-22.04", version: 2 },
    });
    expect(() => resolveBenchmarkRuntimePlatform({ platform: "wsl2-linux" }, {
      platform: "linux",
      osRelease: "6.8.0-generic",
      env: {},
    })).toThrow(/WSL2/i);
    expect(() => resolveBenchmarkRuntimePlatform({ platform: "windows-native" }, {
      platform: "linux",
      osRelease: "6.8.0-generic",
      env: {},
    })).toThrow(/Windows native/i);
  });

  it("uses the last normalized usage event and distinguishes unavailable observations", () => {
    expect(extractBenchmarkTokenUsage([
      { type: "run.usage", payload: { usage: { source: "provider_reported", input: 10, output: 4, costUsd: 0.002 } } },
      { type: "run.usage", payload: { usage: { source: "provider_reported", input: 25, output: 9, costUsd: 0.006 } } },
      {
        type: "run.completed",
        payload: {
          usage: {
            status: "complete",
            reason: "provider_reported_all_model_calls",
            modelCalls: 2,
            providerReportedModelCalls: 2,
          },
        },
      },
    ])).toEqual({
      inputTokens: 25,
      outputTokens: 9,
      observation: { status: "provider_reported", costUsd: 0.006 },
    });
    expect(extractBenchmarkTokenUsage([
      { type: "run.usage", payload: { usage: { source: "unavailable", input: 7, output: 3, costUsd: 0.004 } } },
      { type: "run.completed", payload: { usage: { status: "incomplete", reason: "provider_usage_missing" } } },
    ])).toEqual({
      inputTokens: 7,
      outputTokens: 3,
      observation: { status: "unavailable", costUsd: null },
    });
    expect(extractBenchmarkTokenUsage([
      { type: "run.usage", payload: { usage: { source: "provider_reported", input: 7, output: 3, costUsd: 0.004 } } },
      { type: "run.completed", payload: { usage: { status: "incomplete", reason: "provider_usage_missing" } } },
    ])).toEqual({
      inputTokens: 7,
      outputTokens: 3,
      observation: { status: "unavailable", costUsd: null },
    });
    expect(extractBenchmarkTokenUsage([])).toEqual({
      inputTokens: null,
      outputTokens: null,
      observation: { status: "not_reached", costUsd: null },
    });
  });

  windowsIt("runs the three explicit stage 0D core tasks through their frozen profiles", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-stage0d-core-"));
    tempRoots.push(root);
    const invocations = [];
    const report = await runStage0BSuite({
      platform: "windows-native",
      taskIds: ["feature.cross-file", "tests.failed-diagnosis", "navigation.large-repository"],
      fixtureRoot: path.join(root, "fixtures"),
      artifactRoot: path.join(root, "artifacts"),
      stateRoot: path.join(root, "state"),
      attempt: 1,
      runIds: {
        "feature.cross-file": "cross-file-windows-a1-test",
        "tests.failed-diagnosis": "failed-diagnosis-windows-a1-test",
        "navigation.large-repository": "large-navigation-windows-a1-test",
      },
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
      generatedAt: "2026-07-26T00:00:00.000Z",
    }, {
      async executeCodingCi(input) {
        invocations.push(input);
        return { exitCode: 4, stdout: "", stderr: "stage 0D core unavailable" };
      },
    });

    expect(invocations.map((input) => input.mode)).toEqual([
      "workspace-write",
      "command-control",
      "navigation-read",
    ]);
    expect(report.runs.map((run) => [run.taskId, run.execution.profile, run.failureCategory])).toEqual([
      ["feature.cross-file", "workspace-write", "product_workflow"],
      ["tests.failed-diagnosis", "command-control", "product_workflow"],
      ["navigation.large-repository", "navigation-read", "product_workflow"],
    ]);
  });

  windowsIt("runs one explicitly selected stage 0C interactive task through the shared artifact chain", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-stage0c-interactive-"));
    tempRoots.push(root);
    const invocations = [];
    const report = await runStage0BSuite({
      platform: "windows-native",
      taskIds: ["command.interactive-control"],
      fixtureRoot: path.join(root, "fixtures"),
      artifactRoot: path.join(root, "artifacts"),
      stateRoot: path.join(root, "state"),
      attempt: 1,
      runIds: { "command.interactive-control": "interactive-windows-a1-test" },
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
      generatedAt: "2026-07-26T00:00:00.000Z",
    }, {
      async executeCodingCi(input) {
        invocations.push(input);
        return { exitCode: 4, stdout: "", stderr: "interactive control unavailable" };
      },
    });

    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({ mode: "command-control" });
    expect(report.runs).toHaveLength(1);
    expect(report.runs[0]).toMatchObject({
      taskId: "command.interactive-control",
      status: "failed",
      failureCategory: "product_workflow",
      execution: { profile: "command-control" },
      evaluation: { testsPassed: false, patchAccepted: null },
    });
  });

  windowsIt("runs one explicitly selected stage 0C safety task through the shared artifact chain", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-stage0c-safety-"));
    tempRoots.push(root);
    const invocations = [];
    const report = await runStage0BSuite({
      platform: "windows-native",
      taskIds: ["safety.boundary-enforcement"],
      fixtureRoot: path.join(root, "fixtures"),
      artifactRoot: path.join(root, "artifacts"),
      stateRoot: path.join(root, "state"),
      attempt: 1,
      runIds: { "safety.boundary-enforcement": "safety-windows-a1-test" },
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
      generatedAt: "2026-07-26T00:00:00.000Z",
    }, {
      async executeCodingCi(input) {
        invocations.push(input);
        return { exitCode: 4, stdout: "", stderr: "safety boundary unavailable" };
      },
    });

    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({ mode: "safety-probe" });
    expect(report.runs).toHaveLength(1);
    expect(report.runs[0]).toMatchObject({
      taskId: "safety.boundary-enforcement",
      status: "failed",
      failureCategory: "product_workflow",
      execution: { profile: "safety-probe" },
      evaluation: {
        testsPassed: false,
        patchAccepted: null,
        dangerousOperationBlocked: false,
      },
    });
  });

  windowsIt("runs one explicitly selected stage 0C recovery task through the shared artifact chain", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-stage0c-recovery-"));
    tempRoots.push(root);
    const invocations = [];
    const report = await runStage0BSuite({
      platform: "windows-native",
      taskIds: ["gateway.disconnect-recovery"],
      fixtureRoot: path.join(root, "fixtures"),
      artifactRoot: path.join(root, "artifacts"),
      stateRoot: path.join(root, "state"),
      attempt: 1,
      runIds: { "gateway.disconnect-recovery": "recovery-windows-a1-test" },
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
      generatedAt: "2026-07-26T00:00:00.000Z",
    }, {
      async executeRecoveryCodingCi(input) {
        invocations.push(input);
        return { exitCode: 4, stdout: "", stderr: "recovery control unavailable" };
      },
    });

    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({ mode: "recovery-control" });
    expect(report.runs).toHaveLength(1);
    expect(report.runs[0]).toMatchObject({
      taskId: "gateway.disconnect-recovery",
      status: "failed",
      failureCategory: "product_workflow",
      execution: { profile: "recovery-control" },
      evaluation: {
        testsPassed: false,
        patchAccepted: false,
        dangerousOperationBlocked: null,
        recoverySucceeded: false,
      },
    });
  });

  windowsIt("runs one explicitly selected stage 0C client cancellation task with exact cancel injection enabled", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-stage0c-cancel-"));
    tempRoots.push(root);
    const invocations = [];
    const report = await runStage0BSuite({
      platform: "windows-native",
      taskIds: ["gateway.client-cancel"],
      fixtureRoot: path.join(root, "fixtures"),
      artifactRoot: path.join(root, "artifacts"),
      stateRoot: path.join(root, "state"),
      attempt: 1,
      runIds: { "gateway.client-cancel": "cancel-windows-a1-test" },
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
      generatedAt: "2026-07-26T00:00:00.000Z",
    }, {
      async executeCodingCi(input) {
        invocations.push(input);
        return { exitCode: 5, stdout: "", stderr: "cancellation artifact unavailable" };
      },
    });

    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({ mode: "plan", cancelOnRunStart: true });
    expect(report.runs).toHaveLength(1);
    expect(report.runs[0]).toMatchObject({
      taskId: "gateway.client-cancel",
      status: "failed",
      failureCategory: "product_workflow",
      execution: { profile: "plan" },
      evaluation: { testsPassed: false, patchAccepted: null },
      artifacts: { cancelInjection: "cancel-windows-a1-test/cancel-injection.json" },
    });
    await expect(fs.readFile(
      path.join(root, "artifacts", "cancel-windows-a1-test", "cancel-injection.json"),
      "utf-8",
    )).resolves.toContain('"status": "not_observed"');
  });

  windowsIt("runs one explicitly selected stage 0C process restart task through the restart artifact chain", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-stage0c-restart-"));
    tempRoots.push(root);
    const invocations = [];
    const report = await runStage0BSuite({
      platform: "windows-native",
      taskIds: ["gateway.process-restart"],
      fixtureRoot: path.join(root, "fixtures"),
      artifactRoot: path.join(root, "artifacts"),
      stateRoot: path.join(root, "state"),
      attempt: 1,
      runIds: { "gateway.process-restart": "restart-windows-a1-test" },
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
      generatedAt: "2026-07-26T00:00:00.000Z",
    }, {
      async executeProcessRestartCodingCi(input) {
        invocations.push(input);
        return { exitCode: 4, stdout: "", stderr: "restart artifact unavailable" };
      },
    });

    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({ mode: "plan" });
    expect(report.runs[0]).toMatchObject({
      taskId: "gateway.process-restart",
      status: "failed",
      failureCategory: "product_workflow",
      execution: { profile: "plan" },
      evaluation: { testsPassed: false, patchAccepted: null },
      artifacts: { restartInjection: "restart-windows-a1-test/restart-injection.json" },
    });
    await expect(fs.readFile(
      path.join(root, "artifacts", "restart-windows-a1-test", "restart-injection.json"),
      "utf-8",
    )).resolves.toContain('"status": "not_injected"');
  });

  windowsIt("keeps v3 lifecycle fixtures off the Provider path and outside the usage budget", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v3-local-lifecycle-"));
    tempRoots.push(root);
    const invocations = [];
    const report = await runStage0BSuite({
      platform: "windows-native",
      manifestRevision: "v3",
      sourceRoot: path.resolve("."),
      taskIds: ["gateway.client-cancel", "gateway.process-restart"],
      fixtureRoot: path.join(root, "fixtures"),
      artifactRoot: path.join(root, "artifacts"),
      stateRoot: path.join(root, "state"),
      attempt: 1,
      runIds: {
        "gateway.client-cancel": "cancel-v3-local-fixture",
        "gateway.process-restart": "restart-v3-local-fixture",
      },
      model: { provider: "openai", id: "provider-model-must-not-run", credentialsConfigured: true },
      childEnv: {
        BELLDANDY_OPENAI_API_KEY: "not-a-real-key",
        BENCHMARK_SAFE_FIXTURE_VALUE: "retained",
      },
      priorObservedCostUsd: 0.75,
      maxTotalCostUsd: 1,
      generatedAt: "2026-09-03T00:00:00.000Z",
    }, {
      runtime: { platform: "win32", osRelease: "Windows fixture", env: {} },
      resolveRepositoryIdentity: async () => repositoryIdentity("d"),
      createBenchmarkPreflightArtifact: async (input) => createPassedV3RuntimePreflight(input),
      async executeCodingCi() {
        throw new Error("Provider Coding CI path must not execute for a local lifecycle fixture.");
      },
      async executeClientCancellationCodingCi(input) {
        invocations.push({ taskId: "gateway.client-cancel", input });
        return { exitCode: 4, stdout: "", stderr: "local cancellation fixture unavailable" };
      },
      async executeProcessRestartCodingCi(input) {
        invocations.push({ taskId: "gateway.process-restart", input });
        return { exitCode: 4, stdout: "", stderr: "local restart fixture unavailable" };
      },
    });

    expect(invocations.map((item) => item.taskId)).toEqual([
      "gateway.client-cancel",
      "gateway.process-restart",
    ]);
    for (const { input } of invocations) {
      expect(input.modelId).toBeUndefined();
      expect(input.maxCostUsd).toBeUndefined();
      expect(input.childEnv).toMatchObject({ BENCHMARK_SAFE_FIXTURE_VALUE: "retained" });
      expect(input.childEnv).not.toHaveProperty("BELLDANDY_OPENAI_API_KEY");
    }
    expect(report.runs).toHaveLength(2);
    for (const run of report.runs) {
      expect(run.execution).toEqual({
        profile: "plan",
        modelExecution: "local_fixture",
        budgets: { timeoutMs: 300000, maxTurns: 12, maxTokens: 24000 },
        infrastructureRetries: 0,
      });
      expect(run.environment.model).toEqual({
        provider: "local_fixture",
        id: run.fixture.generatorId,
        credentialsConfigured: false,
      });
      expect(run.usage.observation).toEqual({ status: "not_reached", costUsd: null });
    }
  });

  windowsIt("cancels a v3 local fixture through the production Gateway without Provider usage", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v3-client-cancel-integration-"));
    tempRoots.push(root);
    const runId = "client-cancel-v3-windows-integration";
    const report = await runStage0BSuite({
      platform: "windows-native",
      manifestRevision: "v3",
      sourceRoot: path.resolve("."),
      taskIds: ["gateway.client-cancel"],
      fixtureRoot: path.join(root, "fixtures"),
      artifactRoot: path.join(root, "artifacts"),
      stateRoot: path.join(root, "state"),
      attempt: 1,
      runIds: { "gateway.client-cancel": runId },
      model: { provider: "fixture", id: "provider-must-not-run", credentialsConfigured: false },
      generatedAt: "2026-09-03T00:00:00.000Z",
    });

    const runDir = path.join(root, "artifacts", runId);
    const cancellation = JSON.parse(await fs.readFile(
      path.join(runDir, "cancel-injection.json"),
      "utf-8",
    ));
    const events = (await fs.readFile(path.join(runDir, "events.jsonl"), "utf-8"))
      .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    expect(report.runs).toEqual([expect.objectContaining({
      taskId: "gateway.client-cancel",
      status: "passed",
      failureCategory: null,
      execution: expect.objectContaining({ modelExecution: "local_fixture" }),
      environment: expect.objectContaining({
        model: {
          provider: "local_fixture",
          id: "gateway-client-cancel-v1",
          credentialsConfigured: false,
        },
      }),
      usage: expect.objectContaining({
        inputTokens: null,
        outputTokens: null,
        observation: { status: "not_reached", costUsd: null },
      }),
    })]);
    expect(cancellation).toMatchObject({
      status: "confirmed",
      cancellationRequestCount: 1,
      terminalType: "run.cancelled",
    });
    expect(events.some((event) => event.type === "run.usage")).toBe(false);
    expect(events.at(-1)).toMatchObject({
      type: "run.cancelled",
      payload: { usage: { status: "incomplete", reason: "usage_not_reported" } },
    });
  }, 30_000);

  windowsIt("records a lost old binding after a real controlled Gateway process restart", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-stage0c-process-restart-integration-"));
    tempRoots.push(root);
    const fixtureRoot = path.join(root, "fixtures");
    const artifactRoot = path.join(root, "artifacts");
    const stateRoot = path.join(root, "state");
    const runId = "process-restart-windows-integration";
    const previousAllowedOrigins = process.env.BELLDANDY_ALLOWED_ORIGINS;
    process.env.BELLDANDY_ALLOWED_ORIGINS = "http://127.0.0.1:1";

    try {
      const report = await runStage0BSuite({
        platform: "windows-native",
        taskIds: ["gateway.process-restart"],
        fixtureRoot,
        artifactRoot,
        stateRoot,
        attempt: 1,
        runIds: { "gateway.process-restart": runId },
        model: { provider: "fixture", id: "gateway-restart-fixture", credentialsConfigured: false },
        generatedAt: "2026-07-26T00:00:00.000Z",
      });

      const runDir = path.join(artifactRoot, runId);
      const diagnostics = await fs.readFile(path.join(runDir, "diagnostics.log"), "utf-8");
      const restartDiagnostic = await fs.readFile(path.join(runDir, "restart-injection.json"), "utf-8");
      expect(report.runs, `${diagnostics}\n${restartDiagnostic}`).toEqual([expect.objectContaining({
        taskId: "gateway.process-restart",
        status: "passed",
        failureCategory: null,
        evaluation: expect.objectContaining({
          taskCompleted: true,
          testsPassed: true,
          regressionCount: 0,
        }),
      })]);
      const restart = JSON.parse(await fs.readFile(path.join(runDir, "restart-injection.json"), "utf-8"));
      const events = (await fs.readFile(path.join(runDir, "events.jsonl"), "utf-8"))
        .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
      expect(restart).toMatchObject({
        status: "confirmed",
        observedStartedSeq: 1,
        messageSendRequestCount: 1,
        subscription: { errorCode: "not_found", eventCount: 0 },
        cancellation: { accepted: false, state: "not_found" },
        cleanup: {
          managedGatewayProcessCount: 0,
          originalGateway: { exited: true },
          replacementGateway: { exited: true },
        },
      });
      expect(restart.originalGateway.pid).not.toBe(restart.replacementGateway.pid);
      expect(events.map((event) => event.type)).toEqual(["run.started", "run.failed"]);
      expect(events.at(-1)).toMatchObject({ payload: { error: { code: "gateway_unavailable" } } });
      await expect(fs.readFile(path.join(runDir, "changes.patch"), "utf-8")).resolves.toBe("");
    } finally {
      if (previousAllowedOrigins === undefined) delete process.env.BELLDANDY_ALLOWED_ORIGINS;
      else process.env.BELLDANDY_ALLOWED_ORIGINS = previousAllowedOrigins;
    }
  }, 30_000);

  windowsIt("records the v3 lost binding through the dist restart Gateway", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v3-process-restart-integration-"));
    tempRoots.push(root);
    const runId = "process-restart-v3-windows-integration";
    const previousAllowedOrigins = process.env.BELLDANDY_ALLOWED_ORIGINS;
    process.env.BELLDANDY_ALLOWED_ORIGINS = "http://127.0.0.1:1";

    try {
      const report = await runStage0BSuite({
        platform: "windows-native",
        manifestRevision: "v3",
        sourceRoot: path.resolve("."),
        taskIds: ["gateway.process-restart"],
        fixtureRoot: path.join(root, "fixtures"),
        artifactRoot: path.join(root, "artifacts"),
        stateRoot: path.join(root, "state"),
        attempt: 1,
        runIds: { "gateway.process-restart": runId },
        model: { provider: "fixture", id: "gateway-restart-fixture", credentialsConfigured: false },
        generatedAt: "2026-08-14T00:00:00.000Z",
      });

      const runDir = path.join(root, "artifacts", runId);
      const restart = JSON.parse(await fs.readFile(path.join(runDir, "restart-injection.json"), "utf-8"));
      expect(report.runs).toEqual([expect.objectContaining({
        taskId: "gateway.process-restart",
        status: "passed",
        failureCategory: null,
      })]);
      expect(restart).toMatchObject({
        trigger: "message.send.accepted",
        status: "confirmed",
        messageSendRequestCount: 1,
        cleanup: { managedGatewayProcessCount: 0 },
      });
      expect(restart.originalGateway).toMatchObject({
        entrypoint: { path: "packages/belldandy-core/dist/server.js" },
      });
      expect(restart.replacementGateway).toMatchObject({
        entrypoint: { path: "packages/belldandy-core/dist/server.js" },
      });
    } finally {
      if (previousAllowedOrigins === undefined) delete process.env.BELLDANDY_ALLOWED_ORIGINS;
      else process.env.BELLDANDY_ALLOWED_ORIGINS = previousAllowedOrigins;
    }
  }, 30_000);

  windowsIt("runs both explicitly selected stage 0C Git local-delivery tasks through the shared artifact chain", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-stage0c-git-local-"));
    tempRoots.push(root);
    const invocations = [];
    const report = await runStage0BSuite({
      platform: "windows-native",
      taskIds: ["git.dirty-worktree", "git.delivery-guard"],
      fixtureRoot: path.join(root, "fixtures"),
      artifactRoot: path.join(root, "artifacts"),
      stateRoot: path.join(root, "state"),
      attempt: 1,
      runIds: {
        "git.dirty-worktree": "git-dirty-windows-a1-test",
        "git.delivery-guard": "git-delivery-windows-a1-test",
      },
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
      generatedAt: "2026-07-26T00:00:00.000Z",
    }, {
      async executeCodingCi(input) {
        invocations.push(input);
        return { exitCode: 4, stdout: "", stderr: "git local delivery unavailable" };
      },
    });

    expect(invocations).toHaveLength(2);
    expect(invocations.map((input) => input.mode)).toEqual(["git-local", "git-local"]);
    expect(report.runs).toHaveLength(2);
    expect(report.runs.map((run) => run.taskId)).toEqual(["git.dirty-worktree", "git.delivery-guard"]);
    expect(report.runs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: "failed",
        failureCategory: "product_workflow",
        execution: expect.objectContaining({ profile: "git-local" }),
        evaluation: expect.objectContaining({ testsPassed: true, patchAccepted: null }),
      }),
    ]));
  });

  windowsIt("recovers a real Gateway run from the injected Headless disconnect without replaying the write", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-stage0c-recovery-integration-"));
    tempRoots.push(root);
    const fixtureRoot = path.join(root, "fixtures");
    const artifactRoot = path.join(root, "artifacts");
    const stateRoot = path.join(root, "state");
    const runId = "recovery-windows-integration";
    let writeCount = 0;
    const agent = {
      getCodingRunCapabilities() {
        return {
          maxCostUsd: false,
          workspaceMutationRequirement: true,
          requiredChangedPaths: true,
        };
      },
      async *run(input) {
        expect(input.meta?._agentLaunchSpec).toMatchObject({
          permissionMode: "acceptEdits",
          toolDeny: ["run_command", "spawn_subagent", "file_delete"],
          workspaceMutationRequirement: "required",
          requiredChangedPaths: ["src/recovery-target.txt"],
        });
        yield { type: "status", status: "running" };
        yield {
          type: "tool_call",
          id: "recovery-write-1",
          name: "file_write",
          arguments: { path: "src/recovery-target.txt", content: "recovery-marker=completed-once\n" },
        };
        await new Promise((resolve) => setTimeout(resolve, 100));
        writeCount += 1;
        await fs.writeFile(
          path.join(fixtureRoot, runId, "workspace", "src/recovery-target.txt"),
          "recovery-marker=completed-once\n",
          "utf-8",
        );
        yield {
          type: "tool_result",
          id: "recovery-write-1",
          name: "file_write",
          success: true,
          output: "updated",
        };
        yield { type: "final", text: JSON.stringify({ summary: "Recovered once." }) };
      },
    };
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir: stateRoot,
      agentFactory: () => agent,
      primaryModelConfig: {
        baseUrl: "https://fixture.invalid/v1",
        apiKey: "fixture-key",
        model: "fixture-model",
      },
    });

    try {
      const report = await runStage0BSuite({
        platform: "windows-native",
        taskIds: ["gateway.disconnect-recovery"],
        fixtureRoot,
        artifactRoot,
        stateRoot,
        attempt: 1,
        runIds: { "gateway.disconnect-recovery": runId },
        model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
        generatedAt: "2026-07-26T00:00:00.000Z",
        childEnv: {
          BELLDANDY_HOST: "127.0.0.1",
          BELLDANDY_PORT: String(server.port),
          BELLDANDY_AUTH_MODE: "none",
        },
      });

      expect(writeCount).toBe(1);
      const diagnostics = await fs.readFile(path.join(artifactRoot, runId, "diagnostics.log"), "utf-8");
      expect(diagnostics).toBe("");
      expect(report.runs[0]).toMatchObject({
        taskId: "gateway.disconnect-recovery",
        status: "passed",
        failureCategory: null,
        evaluation: {
          taskCompleted: true,
          testsPassed: true,
          patchAccepted: true,
          recoverySucceeded: true,
        },
      });
      const fault = JSON.parse(await fs.readFile(
        path.join(artifactRoot, runId, "fault-injection.json"),
        "utf-8",
      ));
      expect(fault).toMatchObject({
        status: "recovered",
        disconnectCount: 1,
        reconnectCount: 1,
      });
      const recoveredManifest = JSON.parse(await fs.readFile(
        path.join(artifactRoot, runId, "coding-ci-manifest.json"),
        "utf-8",
      ));
      expect(recoveredManifest).toMatchObject({
        capabilities: { schemaVersion: "coding-run-capabilities/v1" },
        usage: { status: "incomplete", reason: "usage_not_reported" },
        checks: { capabilityHandshake: true, usageComplete: false },
      });
      const status = await fs.readFile(path.join(artifactRoot, runId, "status.txt"), "utf-8");
      expect(status).toContain("capability_handshake=true");
      expect(status).toContain("usage_complete=false");
    } finally {
      await server.close();
    }
  }, 30_000);

  windowsIt("runs both Windows tracer bullets through the real Gateway and Coding CI artifact chain", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-stage0b-"));
    tempRoots.push(root);
    const fixtureRoot = path.join(root, "fixtures");
    const artifactRoot = path.join(root, "artifacts");
    const gatewayState = path.join(root, "gateway-state");
    const runIds = {
      "rules.nested-precedence": "rules-windows-a1-test",
      "bug.reproducible-fix": "bug-windows-a1-test",
    };
    const invocationPrompts = [];
    const agent = {
      getCodingRunCapabilities() {
        return {
          maxCostUsd: false,
          workspaceMutationRequirement: true,
          requiredChangedPaths: true,
        };
      },
      async *run(input) {
        invocationPrompts.push({
          conversationId: input?.conversationId ?? null,
          text: input?.text ?? null,
        });
        if (input?.text?.includes("nested workspace")) {
          yield {
            type: "final",
            text: JSON.stringify({
              ruleValue: "nested",
              sourcePath: "packages/demo/AGENTS.md",
            }),
          };
          return;
        }
        if (!input?.text?.includes("reported logic bug")) {
          throw new Error("Unexpected benchmark fixture prompt.");
        }
        expect(input.meta?._agentLaunchSpec).toMatchObject({
          workspaceMutationRequirement: "required",
          requiredChangedPaths: ["src/calculate.mjs"],
        });
        await fs.writeFile(
          path.join(fixtureRoot, runIds["bug.reproducible-fix"], "workspace", "src/calculate.mjs"),
          [
            "export function calculateInvoiceTotal(items) {",
            "  return items.reduce((total, item) => total + (item.price * item.quantity), 0);",
            "}",
            "",
          ].join("\n"),
          "utf-8",
        );
        yield {
          type: "final",
          text: JSON.stringify({ summary: "Fixed quantity-aware invoice totals." }),
        };
      },
    };
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir: gatewayState,
      agentFactory: () => agent,
      primaryModelConfig: {
        baseUrl: "https://fixture.invalid/v1",
        apiKey: "fixture-key",
        model: "fixture-model",
      },
    });

    try {
      const report = await runStage0BSuite({
        fixtureRoot,
        artifactRoot,
        stateRoot: gatewayState,
        runIds,
        generatedAt: "2026-07-25T16:30:00.000Z",
        model: {
          provider: "fixture-provider",
          id: "fixture-model",
          credentialsConfigured: false,
        },
        childEnv: {
          BELLDANDY_HOST: "127.0.0.1",
          BELLDANDY_PORT: String(server.port),
          BELLDANDY_AUTH_MODE: "none",
        },
      });

      const integrationDiagnostics = await Promise.all(Object.values(runIds).map(async (runId) => {
        return await fs.readFile(path.join(artifactRoot, runId, "diagnostics.log"), "utf-8");
      }));
      expect(
        invocationPrompts.some((item) => item.text?.includes("nested workspace")),
        integrationDiagnostics.join("\n---\n"),
      ).toBe(true);
      expect(
        invocationPrompts.some((item) => item.text?.includes("reported logic bug")),
        integrationDiagnostics.join("\n---\n"),
      ).toBe(true);
      expect(report).toMatchObject({
        schemaVersion: "coding-agent-benchmark-report/v1",
        status: "partial",
        summary: {
          runCount: 2,
          passedRunCount: 2,
          failuresByCategory: {},
        },
      });
      expect(report.runs.map((run) => [run.taskId, run.status])).toEqual([
        ["rules.nested-precedence", "passed"],
        ["bug.reproducible-fix", "passed"],
      ]);
      for (const run of report.runs) {
        expect(run.fixture).toMatchObject({
          version: 1,
          resetStrategy: "regenerate",
          baselineCommit: expect.stringMatching(/^[0-9a-f]{40}$/),
        });
      }

      const reportSchema = JSON.parse(await fs.readFile(
        path.resolve("benchmarks/coding-agent/v1/benchmark-report.schema.json"),
        "utf-8",
      ));
      const runSchema = JSON.parse(await fs.readFile(
        path.resolve("benchmarks/coding-agent/v1/benchmark-run.schema.json"),
        "utf-8",
      ));
      const compiledReport = compileOutputSchema(reportSchema);
      const compiledRun = compileOutputSchema(runSchema);
      expect(compiledReport.ok).toBe(true);
      expect(compiledRun.ok).toBe(true);
      if (!compiledReport.ok || !compiledRun.ok) return;
      expect(compiledReport.validator.validateOutput(JSON.stringify(report))).toMatchObject({ ok: true });

      for (const run of report.runs) {
        expect(compiledRun.validator.validateOutput(JSON.stringify(run))).toMatchObject({ ok: true });
        const runDir = path.join(artifactRoot, run.runId);
        const codingCiManifest = JSON.parse(await fs.readFile(
          path.join(runDir, "coding-ci-manifest.json"),
          "utf-8",
        ));
        expect(codingCiManifest.binding?.conversationId).toBe(`coding-benchmark-${run.runId}`);
        for (const artifact of [
          "manifest.json",
          "events.jsonl",
          "result.json",
          "changes.patch",
          "diagnostics.log",
          "status.txt",
        ]) {
          await expect(fs.stat(path.join(runDir, artifact))).resolves.toMatchObject({ isFile: expect.any(Function) });
        }
      }
      await expect(fs.readFile(path.join(artifactRoot, "benchmark-report.json"), "utf-8"))
        .resolves.toContain("coding-agent-benchmark-report/v1");
    } finally {
      await server.close();
    }
  }, 30_000);
});

function repositoryIdentity(seed) {
  return {
    commit: seed.repeat(40),
    workspaceDirty: false,
    lockfileSha256: seed.repeat(64),
    worktreeContentSha256: seed.repeat(64),
  };
}

function createV3SnapshotReceipt(repositoryId) {
  return {
    schemaVersion: "coding-agent-benchmark-snapshot-receipt/v1",
    repositoryId,
    source: {
      url: "https://github.com/expressjs/express.git",
      commit: "a3714473feb3d2908add734d340e7755fd85e0a3",
      workspaceDirty: false,
      worktreeContentSha256: "1".repeat(64),
      dependencyInputsSha256: "2".repeat(64),
    },
    license: { spdx: "MIT", path: "LICENSE", sha256: "3".repeat(64) },
    dependencyCache: {
      cacheKey: "express-a3714473feb3d2908add734d340e7755fd85e0a3",
      contentSha256: "4".repeat(64),
    },
    policy: {
      preparationNetwork: "allowlisted-source-only",
      executionNetwork: "disabled",
      dependencyPolicy: "pinned-cache-required",
    },
    preparedAt: "2026-08-05T00:00:00.000Z",
  };
}

function createPassedV3SnapshotPreflight(task) {
  const passed = { status: "passed", reason: null };
  return {
    schemaVersion: "coding-agent-benchmark-snapshot-preflight/v1",
    status: "passed",
    taskId: task.id,
    repositoryId: task.repositoryId,
    checks: {
      manifestBinding: passed,
      sourceIdentity: passed,
      license: passed,
      dependencyCache: passed,
      executionNetwork: passed,
    },
  };
}

function createPassedV3RuntimePreflight(input) {
  const check = { status: "not_applicable", reason: "fixture_provider" };
  return {
    schemaVersion: "coding-agent-benchmark-preflight/v1",
    manifestRevision: "v3",
    taskId: input.task.id,
    runId: input.runId,
    status: "passed",
    checks: {
      contractSource: {
        status: "passed",
        reason: null,
        manifestVersion: "coding-agent-benchmark-manifest/v3",
        profile: input.task.executionProfile,
        toolAllow: ["file_read"],
        entrypoints: {
          bdd: { path: "packages/belldandy-core/dist/bin/bdd.js", sha256: "a".repeat(64) },
          gateway: { path: "packages/belldandy-core/dist/server.js", sha256: "b".repeat(64) },
          contracts: { path: "packages/belldandy-core/dist/coding-run/contracts.js", sha256: "c".repeat(64) },
        },
      },
      workspaceWriteClosure: input.task.executionProfile === "workspace-write"
        ? { status: "passed", reason: null, toolAllow: ["file_read", "file_edit", "apply_patch"], testCommandCount: 1 }
        : { status: "not_applicable", reason: "task_does_not_require_workspace_write_closure" },
      agentProfile: { status: "not_applicable", reason: "profile_uses_runtime_default" },
      executionBudget: {
        status: "passed",
        reason: null,
        taskId: input.task.id,
        timeoutMs: 300000,
        maxTurns: 12,
        maxTokens: input.task.id === "safety.boundary-enforcement" ? 32000 : 24000,
      },
      pricing: check,
      oci: { status: "not_applicable", reason: "profile_has_no_command_execution" },
      eventProjection: { status: "not_applicable", reason: "task_does_not_require_extended_event_output" },
      fault: { status: "not_applicable", reason: "task_has_no_fault_injection" },
    },
  };
}

function summaryOutputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary"],
    properties: { summary: { type: "string", minLength: 1, maxLength: 1000 } },
  };
}

function passedV3Evaluation(summary) {
  const taskCompleted = typeof summary === "string" && summary.trim().length > 0;
  return {
    status: taskCompleted ? "passed" : "failed",
    failureCategory: taskCompleted ? null : "model",
    evaluation: {
      source: "machine",
      taskCompleted,
      testsPassed: true,
      patchAccepted: true,
      regressionCount: taskCompleted ? 0 : 1,
      manualInterventionCount: 0,
      dangerousOperationBlocked: null,
      recoverySucceeded: null,
    },
    diagnostics: taskCompleted ? [] : ["summary missing"],
  };
}

const V3_BROWSER_SCREENSHOT = Buffer.from("fixture browser screenshot bytes");

function createV3BrowserSystemEvidence(runId, screenshot = V3_BROWSER_SCREENSHOT) {
  const screenshotSha256 = crypto.createHash("sha256").update(screenshot).digest("hex");
  const domAfterSha256 = "7".repeat(64);
  return {
    schemaVersion: "coding-agent-benchmark-system-evidence/v1",
    taskId: "system.browser-behavior",
    generatorId: "browser-behavior-v1",
    fixtureVersion: 1,
    runId,
    platform: "windows-native",
    status: "passed",
    sensitiveFindingCount: 0,
    orphanResourceCount: 0,
    duplicateSideEffectCount: 0,
    observations: {
      pageLoaded: true,
      consoleErrorCount: 0,
      domChanged: true,
      domAfterSha256,
      requestStatus: 200,
      networkScope: "loopback-only",
      screenshotSha256,
      screenshotBindingSha256: crypto.createHash("sha256").update([
        "coding-agent-benchmark-browser-binding/v1",
        runId,
        screenshotSha256,
        domAfterSha256,
      ].join("\0")).digest("hex"),
    },
  };
}

async function readJson(target) {
  return JSON.parse(await fs.readFile(target, "utf-8"));
}
