import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  createBenchmarkApprovalContract,
  serializeBenchmarkApprovalContract,
} from "./coding-agent-benchmark-approval.mjs";
import {
  loadCodingAgentBenchmarkManifest,
  resolveCodingAgentBenchmarkManifestPath,
} from "./coding-agent-benchmark-contract.mjs";
import {
  CODING_AGENT_BENCHMARK_SNAPSHOT_RECEIPT_VERSION,
  evaluateCodingAgentBenchmarkV3SnapshotPreflight,
  inspectCodingAgentBenchmarkV3RepositorySnapshotIdentity,
  inspectCodingAgentBenchmarkV3SnapshotPreparation,
  listCodingAgentBenchmarkV3FixtureProviders,
  resolveCodingAgentBenchmarkV3FixtureProvider,
  validateCodingAgentBenchmarkV3SnapshotReceipt,
} from "./coding-agent-benchmark-v3-fixtures.mjs";

const tempRoots = [];
const GO_MIGRATION_PATHS = [
  "bash_completions.go",
  "bash_completionsV2.go",
  "cobra.go",
  "completions.go",
  "doc/man_docs.go",
  "fish_completions.go",
  "powershell_completions.go",
  "zsh_completions.go",
];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("coding agent benchmark v3 fixture providers", () => {
  it("resolves exactly one layer-appropriate provider for every frozen task", async () => {
    const manifest = await loadCodingAgentBenchmarkManifest(
      resolveCodingAgentBenchmarkManifestPath("v3"),
    );

    const providers = listCodingAgentBenchmarkV3FixtureProviders(manifest);
    expect(providers).toHaveLength(24);
    expect(new Set(providers.map((provider) => provider.taskId))).toEqual(
      new Set(manifest.tasks.map((task) => task.id)),
    );

    for (const provider of providers) {
      const task = manifest.tasks.find((candidate) => candidate.id === provider.taskId);
      expect(provider).toMatchObject({
        taskId: task.id,
        layer: task.layer,
        generatorId: task.fixture.generatorId,
        evaluatorId: task.evaluator.id,
      });
      expect(resolveCodingAgentBenchmarkV3FixtureProvider(manifest, task.id)).toMatchObject({
        taskId: provider.taskId,
        layer: provider.layer,
        kind: provider.kind,
        sourceRevision: provider.sourceRevision,
        repositoryId: provider.repositoryId,
        generatorId: provider.generatorId,
        evaluatorId: provider.evaluatorId,
      });
      if (task.layer === "A") {
        expect(provider).toMatchObject({ kind: "deterministic", sourceRevision: "corrected-v2" });
        expect(provider.repositoryId).toBeNull();
        expect(provider.generate).toEqual(expect.any(Function));
        expect(provider.evaluate).toEqual(expect.any(Function));
      } else if (task.layer === "B") {
        expect(provider).toMatchObject({
          kind: "repository-snapshot",
          sourceRevision: "v3",
          repositoryId: task.repositoryId,
        });
      } else {
        expect(provider).toMatchObject({
          kind: "system",
          sourceRevision: "v3",
          repositoryId: null,
        });
      }
    }

    expect(() => resolveCodingAgentBenchmarkV3FixtureProvider(manifest, "unknown.task"))
      .toThrow(/unknown\.task.*provider/i);
  });

  it("reuses the corrected v2 fixtures for version-sensitive A-layer tasks", async () => {
    const manifest = await loadCodingAgentBenchmarkManifest(
      resolveCodingAgentBenchmarkManifestPath("v3"),
    );
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v3-a-layer-"));
    tempRoots.push(root);

    const interactive = await generateFixture(manifest, root, "command.interactive-control");
    expect(interactive.approvalPolicy).toMatchObject({ mode: "allow_exact_sequence" });
    expect(interactive.approvalPolicy.steps).toHaveLength(5);
    expect(interactive.approvalPolicy.steps.map((step) => step.toolName)).toEqual([
      "command_job",
      "command_job",
      "command_job",
      "command_job",
      "command_job",
    ]);
    expect(interactive.prompt).toContain("exactly five actions in this order: start, write, resize, read, cancel");

    const safety = await generateFixture(manifest, root, "safety.boundary-enforcement");
    expect(safety.approvalPolicy).toMatchObject({ mode: "deny_exact_set" });
    expect(safety.approvalPolicy.steps).toHaveLength(4);
    expect(safety.approvalPolicy.steps.every((step) => step.arguments?.commandPlan?.network === "none"))
      .toBe(true);
    const boundaryCases = JSON.parse(await fs.readFile(
      path.join(safety.workspace, "fixture", "boundary-cases.json"),
      "utf-8",
    ));
    expect(boundaryCases.every((item) => item.arguments?.commandPlan)).toBe(true);

    const recovery = await generateFixture(manifest, root, "gateway.disconnect-recovery");
    expect(recovery.prompt).toContain("Use file_write exactly once as your first and only tool action");
    await expect(fs.readFile(
      path.join(recovery.workspace, "tests", "verify-recovery.mjs"),
      "utf-8",
    )).resolves.toContain('new Set(["file_write"])');
  });

  it("keeps corrected-v2 evaluators bound to v3 approval artifacts", async () => {
    const manifest = await loadCodingAgentBenchmarkManifest(
      resolveCodingAgentBenchmarkManifestPath("v3"),
    );
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v3-approval-"));
    tempRoots.push(root);
    const provider = resolveCodingAgentBenchmarkV3FixtureProvider(
      manifest,
      "safety.boundary-enforcement",
    );
    const fixture = await provider.generate({
      manifest,
      taskId: "safety.boundary-enforcement",
      workspace: path.join(root, "workspace"),
    });
    const artifactDir = path.join(root, "artifacts");
    await fs.mkdir(artifactDir, { recursive: true });
    const runId = "safety-v3-approval-binding";
    const binding = {
      conversationId: `coding-benchmark-${runId}`,
      agentRunId: "agent-run-v3-approval",
    };
    const fixturePath = "fixture/boundary-cases.json";
    const fixtureContent = await fs.readFile(path.join(fixture.workspace, fixturePath));
    const contract = createBenchmarkApprovalContract({
      manifestRevision: "v3",
      taskId: fixture.task.id,
      runId,
      conversationId: binding.conversationId,
      fixture: {
        generatorId: fixture.task.fixture.generatorId,
        version: fixture.task.fixture.version,
        baselineCommit: fixture.baselineCommit,
        path: fixturePath,
        sha256: crypto.createHash("sha256").update(fixtureContent).digest("hex"),
      },
      policy: fixture.approvalPolicy,
    });
    const contractText = serializeBenchmarkApprovalContract(contract);
    const expectedRequestCount = fixture.approvalPolicy.steps.length;
    const evidence = {
      schemaVersion: "coding-agent-benchmark-approval-evidence/v1",
      manifestRevision: "v3",
      taskId: fixture.task.id,
      runId,
      contractSha256: crypto.createHash("sha256").update(contractText).digest("hex"),
      fixture: contract.fixture,
      policyMode: "deny_exact_set",
      status: "passed",
      binding,
      requests: [],
      summary: {
        expectedRequestCount,
        requestCount: expectedRequestCount,
        allowedCount: 0,
        deniedCount: expectedRequestCount,
        responseFailureCount: 0,
        issueCount: 0,
      },
    };
    await Promise.all([
      fs.writeFile(path.join(artifactDir, "approval-contract.json"), contractText),
      fs.writeFile(path.join(artifactDir, "approval-evidence.json"), JSON.stringify(evidence)),
      fs.writeFile(path.join(artifactDir, "coding-ci-manifest.json"), JSON.stringify({
        cliExitCode: 0,
        terminalType: "run.completed",
        checks: { eventContract: true, artifactPolicy: true },
        changedPaths: [],
        binding,
      })),
      fs.writeFile(path.join(artifactDir, "events.jsonl"), ""),
      fs.writeFile(path.join(artifactDir, "changes.patch"), ""),
      fs.writeFile(path.join(artifactDir, "result.json"), "{}"),
    ]);

    const accepted = await provider.evaluate({
      task: fixture.task,
      workspace: fixture.workspace,
      artifactDir,
      runnerExitCode: 0,
    });
    expect(accepted.diagnostics.join("\n")).not.toMatch(/approval evidence/i);

    await fs.writeFile(path.join(artifactDir, "approval-evidence.json"), JSON.stringify({
      ...evidence,
      manifestRevision: "v2",
    }));
    const drifted = await provider.evaluate({
      task: fixture.task,
      workspace: fixture.workspace,
      artifactDir,
      runnerExitCode: 0,
    });
    expect(drifted.diagnostics.join("\n")).toMatch(/approval evidence/i);
  });

  it("passes only a manifest-bound clean snapshot with a pinned dependency cache and disabled network", async () => {
    const manifest = await loadCodingAgentBenchmarkManifest(
      resolveCodingAgentBenchmarkManifestPath("v3"),
    );
    const repository = manifest.repositories.find((candidate) => candidate.id === "express");
    const receipt = createSnapshotReceipt(repository);
    expect(receipt.policy).not.toHaveProperty("strategy");
    const repositoryIdentity = {
      sourceUrl: repository.source.url,
      commit: repository.source.commit,
      workspaceDirty: false,
      worktreeContentSha256: "1".repeat(64),
      dependencyInputsSha256: "2".repeat(64),
      licensePath: repository.license.path,
      licenseSha256: "3".repeat(64),
    };
    const dependencyCacheIdentity = {
      cacheKey: `express-${repository.source.commit}`,
      contentSha256: "4".repeat(64),
    };
    const dependencies = {
      resolveRepositorySnapshotIdentity: async () => repositoryIdentity,
      resolveDependencyCacheIdentity: async () => dependencyCacheIdentity,
    };

    expect(validateCodingAgentBenchmarkV3SnapshotReceipt(manifest, receipt)).toBe(receipt);
    const preflight = await evaluateCodingAgentBenchmarkV3SnapshotPreflight({
      manifest,
      taskId: "real-js.bug-fix",
      receipt,
      repositoryRoot: "C:\\prepared\\express",
      dependencyCacheRoot: "C:\\prepared\\dependency-cache\\express",
      executionNetwork: "disabled",
    }, dependencies);
    expect(preflight).toMatchObject({
      schemaVersion: "coding-agent-benchmark-snapshot-preflight/v1",
      status: "passed",
      taskId: "real-js.bug-fix",
      repositoryId: "express",
      checks: {
        manifestBinding: { status: "passed", reason: null },
        sourceIdentity: { status: "passed", reason: null },
        license: { status: "passed", reason: null },
        dependencyCache: { status: "passed", reason: null },
        executionNetwork: { status: "passed", reason: null },
      },
    });

    const failures = [
      ["repository_worktree_dirty", { repositoryIdentity: { ...repositoryIdentity, workspaceDirty: true } }],
      ["repository_commit_mismatch", { repositoryIdentity: { ...repositoryIdentity, commit: "a".repeat(40) } }],
      ["repository_content_mismatch", { repositoryIdentity: { ...repositoryIdentity, worktreeContentSha256: "a".repeat(64) } }],
      ["dependency_inputs_mismatch", { repositoryIdentity: { ...repositoryIdentity, dependencyInputsSha256: "a".repeat(64) } }],
      ["license_content_mismatch", { repositoryIdentity: { ...repositoryIdentity, licenseSha256: "a".repeat(64) } }],
      ["dependency_cache_mismatch", { dependencyCacheIdentity: { ...dependencyCacheIdentity, contentSha256: "a".repeat(64) } }],
      ["execution_network_not_disabled", { executionNetwork: "enabled" }],
    ];
    for (const [reason, override] of failures) {
      const failed = await evaluateCodingAgentBenchmarkV3SnapshotPreflight({
        manifest,
        taskId: "real-js.bug-fix",
        receipt,
        repositoryRoot: "C:\\prepared\\express",
        dependencyCacheRoot: "C:\\prepared\\dependency-cache\\express",
        executionNetwork: override.executionNetwork ?? "disabled",
      }, {
        resolveRepositorySnapshotIdentity: async () => override.repositoryIdentity ?? repositoryIdentity,
        resolveDependencyCacheIdentity: async () => override.dependencyCacheIdentity ?? dependencyCacheIdentity,
      });
      expect(failed.status, reason).toBe("failed");
      expect(Object.values(failed.checks).map((check) => check.reason), reason).toContain(reason);
    }

    const driftedReceipt = { ...receipt, repositoryId: "preact" };
    expect(() => validateCodingAgentBenchmarkV3SnapshotReceipt(manifest, driftedReceipt))
      .toThrow(/repository.*receipt.*manifest/i);

    const schema = JSON.parse(await fs.readFile(path.resolve(
      "benchmarks/coding-agent/v3/repository-snapshot-receipt.schema.json",
    ), "utf-8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(schema.properties.schemaVersion.const).toBe(CODING_AGENT_BENCHMARK_SNAPSHOT_RECEIPT_VERSION);
      expect(compiled.validator.validateOutput(JSON.stringify(receipt))).toMatchObject({ ok: true });
      expect(compiled.validator.validateOutput(JSON.stringify({ ...receipt, unexpected: true })))
        .toMatchObject({ ok: false });
    }
  });

  it("keeps system providers fail closed until their explicit harness capability is present", async () => {
    const manifest = await loadCodingAgentBenchmarkManifest(
      resolveCodingAgentBenchmarkManifestPath("v3"),
    );
    const systemProvider = resolveCodingAgentBenchmarkV3FixtureProvider(
      manifest,
      "system.browser-behavior",
    );
    expect(systemProvider).toMatchObject({
      readiness: "ready",
      preflight: expect.any(Function),
    });
    await expect(systemProvider.preflight({ platform: "windows-native", systemCapabilities: {} }))
      .resolves.toEqual({
      status: "failed",
      reason: "browser_behavior_harness_unavailable",
    });
    await expect(systemProvider.generate({
      platform: "windows-native",
      systemCapabilities: {},
    })).rejects.toThrow(/browser behavior harness unavailable/i);
  });

  it("generates and evaluates all four bound system evidence scenarios", async () => {
    const manifest = await loadCodingAgentBenchmarkManifest(
      resolveCodingAgentBenchmarkManifestPath("v3"),
    );
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v3-system-"));
    tempRoots.push(root);
    const systemCapabilities = {
      browserBehavior: true,
      parallelReadIsolation: true,
      parallelWriteFanIn: true,
      restartDeliveryReconciliation: true,
    };
    const taskIds = [
      "system.browser-behavior",
      "system.parallel-read-isolation",
      "system.parallel-write-fan-in",
      "system.restart-delivery-reconciliation",
    ];
    const fixtures = new Map();
    const systemScenarioSchema = compileOutputSchema(JSON.parse(await fs.readFile(
      path.resolve("benchmarks/coding-agent/v3/system-scenario.schema.json"),
      "utf-8",
    )));
    const systemEvidenceSchema = compileOutputSchema(JSON.parse(await fs.readFile(
      path.resolve("benchmarks/coding-agent/v3/system-evidence.schema.json"),
      "utf-8",
    )));
    expect(systemScenarioSchema.ok).toBe(true);
    expect(systemEvidenceSchema.ok).toBe(true);

    for (const taskId of taskIds) {
      const provider = resolveCodingAgentBenchmarkV3FixtureProvider(manifest, taskId);
      expect(provider).toMatchObject({ readiness: "ready", kind: "system" });
      await expect(provider.preflight({
        platform: "windows-native",
        systemCapabilities,
      })).resolves.toEqual({ status: "passed", reason: null });
      const fixture = await provider.generate({
        manifest,
        taskId,
        platform: "windows-native",
        systemCapabilities,
        workspace: path.join(root, taskId),
      });
      fixtures.set(taskId, fixture);
      expect(fixture.baselineCommit).toMatch(/^[a-f0-9]{40}$/);
      expect(fixture.systemPreflight).toEqual({ status: "passed", reason: null });
      expect(fixture.systemScenario).toMatchObject({
        schemaVersion: "coding-agent-benchmark-system-scenario/v1",
        taskId,
        generatorId: fixture.task.fixture.generatorId,
        fixtureVersion: 1,
      });
      if (systemScenarioSchema.ok) {
        expect(systemScenarioSchema.validator.validateOutput(JSON.stringify(fixture.systemScenario)))
          .toMatchObject({ ok: true });
      }
      expect(compileOutputSchema(fixture.outputSchema)).toMatchObject({ ok: true });
      await expect(fs.readFile(
        path.join(fixture.workspace, "fixture", "system-scenario.json"),
        "utf-8",
      )).resolves.toContain(taskId);
      if (taskId === "system.restart-delivery-reconciliation") {
        await expect(fs.readFile(
          path.join(fixture.workspace, "workspace", "durable.txt"),
          "utf-8",
        )).resolves.toSatisfy((content) => content.replace(/\r\n/g, "\n") === "side-effect-count=0\n");
      }
      const runId = `${taskId}-windows-a1`;
      const systemEvidence = createSystemEvidence(taskId, runId);
      if (systemEvidenceSchema.ok) {
        expect(systemEvidenceSchema.validator.validateOutput(JSON.stringify(systemEvidence)))
          .toMatchObject({ ok: true });
      }
      const evaluation = await provider.evaluate({
        task: fixture.task,
        workspace: fixture.workspace,
        runnerExitCode: 0,
        runId,
        platform: "windows-native",
        result: { summary: `Verified ${taskId}.` },
        systemEvidence,
      });
      expect(evaluation).toMatchObject({
        status: "passed",
        failureCategory: null,
        evaluation: {
          taskCompleted: true,
          testsPassed: null,
          patchAccepted: null,
          dangerousOperationBlocked: true,
          recoverySucceeded: taskId === "system.restart-delivery-reconciliation" ? true : null,
          regressionCount: 0,
        },
      });
    }

    const browserFixture = fixtures.get("system.browser-behavior");
    const browserProvider = resolveCodingAgentBenchmarkV3FixtureProvider(
      manifest,
      "system.browser-behavior",
    );
    const mismatchedRun = await browserProvider.evaluate({
      task: browserFixture.task,
      workspace: browserFixture.workspace,
      runnerExitCode: 0,
      runId: "browser-windows-a1",
      platform: "windows-native",
      result: { summary: "Verified browser evidence." },
      systemEvidence: createSystemEvidence("system.browser-behavior", "other-run"),
    });
    expect(mismatchedRun).toMatchObject({
      status: "failed",
      failureCategory: "product_workflow",
      evaluation: { taskCompleted: false, dangerousOperationBlocked: false },
    });

    const writeFixture = fixtures.get("system.parallel-write-fan-in");
    const writeProvider = resolveCodingAgentBenchmarkV3FixtureProvider(
      manifest,
      "system.parallel-write-fan-in",
    );
    const duplicateEvidence = createSystemEvidence(
      "system.parallel-write-fan-in",
      "parallel-write-windows-a1",
    );
    duplicateEvidence.duplicateSideEffectCount = 1;
    const duplicateEvaluation = await writeProvider.evaluate({
      task: writeFixture.task,
      workspace: writeFixture.workspace,
      runnerExitCode: 0,
      runId: "parallel-write-windows-a1",
      platform: "windows-native",
      result: { summary: "Verified explicit fan-in." },
      systemEvidence: duplicateEvidence,
    });
    expect(duplicateEvaluation).toMatchObject({
      status: "failed",
      failureCategory: "product_workflow",
      evaluation: { taskCompleted: false, dangerousOperationBlocked: false },
    });

    await fs.writeFile(path.join(browserFixture.workspace, "unexpected.txt"), "mutation\n", "utf-8");
    const mutatedWorkspace = await browserProvider.evaluate({
      task: browserFixture.task,
      workspace: browserFixture.workspace,
      runnerExitCode: 0,
      runId: "browser-windows-a2",
      platform: "windows-native",
      result: { summary: "Verified browser evidence." },
      systemEvidence: createSystemEvidence("system.browser-behavior", "browser-windows-a2"),
    });
    expect(mutatedWorkspace).toMatchObject({
      status: "failed",
      failureCategory: "product_workflow",
      evaluation: { taskCompleted: false },
    });
  });

  it("inspects local Git identity and refuses a snapshot at a non-frozen commit", async () => {
    const manifest = await loadCodingAgentBenchmarkManifest(
      resolveCodingAgentBenchmarkManifestPath("v3"),
    );
    const repository = manifest.repositories.find((candidate) => candidate.id === "express");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v3-snapshot-"));
    tempRoots.push(root);
    const repositoryRoot = path.join(root, "express");
    const dependencyCacheRoot = path.join(root, "cache");
    await fs.mkdir(repositoryRoot, { recursive: true });
    await fs.mkdir(dependencyCacheRoot, { recursive: true });
    await fs.writeFile(path.join(repositoryRoot, "LICENSE"), "MIT fixture license\n", "utf-8");
    await fs.writeFile(
      path.join(repositoryRoot, "package.json"),
      '{"name":"express-fixture","dependencies":{"accepts":"^2.0.0"}}\n',
      "utf-8",
    );
    await fs.writeFile(path.join(repositoryRoot, "index.js"), "export const ready = true;\n", "utf-8");
    runGit(repositoryRoot, ["init", "--quiet"]);
    runGit(repositoryRoot, ["config", "user.email", "benchmark@example.invalid"]);
    runGit(repositoryRoot, ["config", "user.name", "Benchmark Fixture"]);
    runGit(repositoryRoot, ["remote", "add", "origin", repository.source.url]);
    runGit(repositoryRoot, ["add", "."]);
    runGit(repositoryRoot, ["commit", "--quiet", "-m", "fixture"]);
    const commit = runGit(repositoryRoot, ["rev-parse", "HEAD"]).trim();
    await fs.writeFile(
      path.join(dependencyCacheRoot, ".coding-benchmark-cache-key"),
      `express-${commit}\n`,
      "utf-8",
    );
    await fs.writeFile(path.join(dependencyCacheRoot, "cache-entry.txt"), "pinned cache\n", "utf-8");

    const identity = await inspectCodingAgentBenchmarkV3RepositorySnapshotIdentity({
      repositoryRoot,
      repository,
    });
    expect(identity).toMatchObject({
      sourceUrl: repository.source.url,
      commit,
      workspaceDirty: false,
      licensePath: "LICENSE",
    });
    expect(identity.worktreeContentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.dependencyInputsSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.licenseSha256).toMatch(/^[a-f0-9]{64}$/);

    await expect(inspectCodingAgentBenchmarkV3SnapshotPreparation({
      manifest,
      repositoryId: "express",
      repositoryRoot,
      dependencyCacheRoot,
      preparedAt: "2026-08-05T00:00:00.000Z",
    })).rejects.toThrow(/commit.*manifest/i);

    await fs.appendFile(path.join(repositoryRoot, "index.js"), "export const drifted = true;\n", "utf-8");
    const drifted = await inspectCodingAgentBenchmarkV3RepositorySnapshotIdentity({
      repositoryRoot,
      repository,
    });
    expect(drifted.workspaceDirty).toBe(true);
  });

  it("generates and evaluates the two Express overlays through the repository Provider seam", async () => {
    const manifest = await loadCodingAgentBenchmarkManifest(
      resolveCodingAgentBenchmarkManifestPath("v3"),
    );
    const repository = manifest.repositories.find((candidate) => candidate.id === "express");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v3-express-"));
    tempRoots.push(root);
    const sourceRoot = path.join(root, "source");
    const cacheRoot = path.join(root, "cache");
    await fs.mkdir(path.join(sourceRoot, "lib"), { recursive: true });
    await fs.mkdir(path.join(cacheRoot, "node_modules"), { recursive: true });
    await fs.writeFile(
      path.join(cacheRoot, "node_modules", "cached-dependency.js"),
      "module.exports = true;\n",
      "utf-8",
    );
    await fs.writeFile(path.join(sourceRoot, "LICENSE"), "MIT fixture license\n", "utf-8");
    await fs.writeFile(
      path.join(sourceRoot, "package.json"),
      '{"name":"express-fixture","scripts":{"test":"node -e \\"process.exit(0)\\""}}\n',
      "utf-8",
    );
    await fs.writeFile(
      path.join(sourceRoot, "lib", "request.js"),
      "function subdomains(hostname, offset) {\n  var parts = hostname.split('.').reverse();\n  return parts.slice(offset);\n}\n",
      "utf-8",
    );
    const receipt = createSnapshotReceipt(repository);
    const identityDependencies = {
      resolveRepositorySnapshotIdentity: async () => ({
        sourceUrl: repository.source.url,
        commit: repository.source.commit,
        workspaceDirty: false,
        worktreeContentSha256: "1".repeat(64),
        dependencyInputsSha256: "2".repeat(64),
        licensePath: repository.license.path,
        licenseSha256: "3".repeat(64),
      }),
      resolveDependencyCacheIdentity: async () => ({
        cacheKey: `express-${repository.source.commit}`,
        contentSha256: "4".repeat(64),
      }),
    };
    const providerInput = {
      manifest,
      receipt,
      repositoryRoot: sourceRoot,
      dependencyCacheRoot: cacheRoot,
      executionNetwork: "disabled",
    };

    const bugProvider = resolveCodingAgentBenchmarkV3FixtureProvider(manifest, "real-js.bug-fix");
    expect(bugProvider).toMatchObject({ readiness: "ready", kind: "repository-snapshot" });
    const bugFixture = await bugProvider.generate({
      ...providerInput,
      taskId: "real-js.bug-fix",
      workspace: path.join(root, "bug-workspace"),
    }, identityDependencies);
    expect(bugFixture.baselineCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(bugFixture.snapshotPreflight).toMatchObject({
      status: "passed",
      taskId: "real-js.bug-fix",
      repositoryId: "express",
    });
    expect(runGit(bugFixture.workspace, ["ls-files", "--", "node_modules"])).toBe("");
    await expect(fs.readFile(path.join(bugFixture.workspace, "lib", "request.js"), "utf-8"))
      .resolves.toContain("parts.slice(offset + 1)");
    await expect(fs.readFile(path.join(bugFixture.workspace, "test", "benchmark-v3", "real-js-bug-fix.js"), "utf-8"))
      .resolves.toContain("subdomains");
    await fs.writeFile(
      path.join(bugFixture.workspace, "lib", "request.js"),
      "function subdomains(hostname, offset) {\n  var parts = hostname.split('.').reverse();\n  return parts.slice(offset);\n}\n",
      "utf-8",
    );
    const bugEvaluation = await bugProvider.evaluate({
      task: bugFixture.task,
      workspace: bugFixture.workspace,
      runnerExitCode: 0,
      result: { summary: "Fixed Express subdomain offset regression." },
    });
    expect(bugEvaluation).toMatchObject({
      status: "passed",
      evaluation: { taskCompleted: true, testsPassed: true, patchAccepted: true },
    });
    const runnerFailure = await bugProvider.evaluate({
      task: bugFixture.task,
      workspace: bugFixture.workspace,
      runnerExitCode: 1,
      result: { summary: "Fixed Express subdomain offset regression." },
    }, {
      runTestCommands: async () => [{ command: "npm test -- test/benchmark-v3/real-js-bug-fix.js", exitCode: 0 }],
    });
    expect(runnerFailure).toMatchObject({
      status: "failed",
      failureCategory: "product_workflow",
      evaluation: { taskCompleted: false, testsPassed: true, patchAccepted: true },
    });
    await fs.writeFile(path.join(bugFixture.workspace, "unexpected.txt"), "out of scope\n", "utf-8");
    const outOfScopePatch = await bugProvider.evaluate({
      task: bugFixture.task,
      workspace: bugFixture.workspace,
      runnerExitCode: 0,
      result: { summary: "Fixed Express subdomain offset regression." },
    }, {
      runTestCommands: async () => [{ command: "npm test -- test/benchmark-v3/real-js-bug-fix.js", exitCode: 0 }],
    });
    expect(outOfScopePatch).toMatchObject({
      status: "failed",
      failureCategory: "product_workflow",
      evaluation: { taskCompleted: false, testsPassed: true, patchAccepted: false },
    });

    const diagnosisProvider = resolveCodingAgentBenchmarkV3FixtureProvider(
      manifest,
      "real-js.failed-test-fix",
    );
    const diagnosisFixture = await diagnosisProvider.generate({
      ...providerInput,
      taskId: "real-js.failed-test-fix",
      workspace: path.join(root, "diagnosis-workspace"),
    }, identityDependencies);
    const diagnosisEvaluation = await diagnosisProvider.evaluate({
      task: diagnosisFixture.task,
      workspace: diagnosisFixture.workspace,
      runnerExitCode: 0,
      result: {
        rootCause: "the failing assertion expects the public req.subdomains offset contract to include the registrable domain",
        sourcePath: "lib/request.js",
        testPath: "test/benchmark-v3/real-js-failed-test.js",
      },
    }, {
      runTestCommands: async () => [{ command: "npm test -- test/benchmark-v3/real-js-failed-test.js", exitCode: 1 }],
    });
    expect(diagnosisEvaluation).toMatchObject({
      status: "passed",
      evaluation: { taskCompleted: true, testsPassed: true, patchAccepted: null },
    });
    const wrongDiagnosisExitCode = await diagnosisProvider.evaluate({
      task: diagnosisFixture.task,
      workspace: diagnosisFixture.workspace,
      runnerExitCode: 0,
      result: {
        rootCause: "the failing assertion expects the public req.subdomains offset contract to include the registrable domain",
        sourcePath: "lib/request.js",
        testPath: "test/benchmark-v3/real-js-failed-test.js",
      },
    }, {
      runTestCommands: async () => [{ command: "npm test -- test/benchmark-v3/real-js-failed-test.js", exitCode: 0 }],
    });
    expect(wrongDiagnosisExitCode).toMatchObject({
      status: "failed",
      failureCategory: "product_workflow",
      evaluation: { taskCompleted: false, testsPassed: false, patchAccepted: null },
    });
    await fs.writeFile(path.join(diagnosisFixture.workspace, "unexpected.txt"), "mutation\n", "utf-8");
    const mutatedDiagnosis = await diagnosisProvider.evaluate({
      task: diagnosisFixture.task,
      workspace: diagnosisFixture.workspace,
      runnerExitCode: 0,
      result: {
        rootCause: "the failing assertion expects the public req.subdomains offset contract to include the registrable domain",
        sourcePath: "lib/request.js",
        testPath: "test/benchmark-v3/real-js-failed-test.js",
      },
    }, {
      runTestCommands: async () => [{ command: "npm test -- test/benchmark-v3/real-js-failed-test.js", exitCode: 1 }],
    });
    expect(mutatedDiagnosis).toMatchObject({
      status: "failed",
      failureCategory: "product_workflow",
      evaluation: { taskCompleted: false, testsPassed: true, patchAccepted: null },
    });
  });

  it("generates and evaluates the two Preact overlays through the repository Provider seam", async () => {
    const manifest = await loadCodingAgentBenchmarkManifest(
      resolveCodingAgentBenchmarkManifestPath("v3"),
    );
    const repository = manifest.repositories.find((candidate) => candidate.id === "preact");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v3-preact-"));
    tempRoots.push(root);
    const sourceRoot = path.join(root, "source");
    const cacheRoot = path.join(root, "cache");
    await fs.mkdir(path.join(sourceRoot, "src", "diff"), { recursive: true });
    await fs.mkdir(path.join(cacheRoot, "node_modules"), { recursive: true });
    await fs.writeFile(path.join(sourceRoot, "LICENSE"), "MIT fixture license\n", "utf-8");
    await fs.writeFile(path.join(sourceRoot, "package.json"), '{"name":"preact-fixture"}\n', "utf-8");
    await fs.writeFile(path.join(sourceRoot, "package-lock.json"), '{"lockfileVersion":3}\n', "utf-8");
    const propsSource = [
      "export function setProperty(dom, name, value) {",
      "  if (value != NULL && (value !== false || name[4] == '-')) {",
      "    dom.setAttribute(name, value);",
      "  } else {",
      "    dom.removeAttribute(name);",
      "  }",
      "}",
      "",
    ].join("\n");
    await fs.writeFile(path.join(sourceRoot, "src", "diff", "props.js"), propsSource, "utf-8");
    const receipt = createSnapshotReceipt(repository);
    const identityDependencies = {
      resolveRepositorySnapshotIdentity: async () => ({
        sourceUrl: repository.source.url,
        commit: repository.source.commit,
        workspaceDirty: false,
        worktreeContentSha256: "1".repeat(64),
        dependencyInputsSha256: "2".repeat(64),
        licensePath: repository.license.path,
        licenseSha256: "3".repeat(64),
      }),
      resolveDependencyCacheIdentity: async () => ({
        cacheKey: `preact-${repository.source.commit}`,
        contentSha256: "4".repeat(64),
      }),
    };
    const providerInput = {
      manifest,
      receipt,
      repositoryRoot: sourceRoot,
      dependencyCacheRoot: cacheRoot,
      executionNetwork: "disabled",
    };

    const uiProvider = resolveCodingAgentBenchmarkV3FixtureProvider(manifest, "real-web.ui-regression");
    expect(uiProvider).toMatchObject({ readiness: "ready", kind: "repository-snapshot" });
    const uiFixture = await uiProvider.generate({
      ...providerInput,
      taskId: "real-web.ui-regression",
      workspace: path.join(root, "ui-workspace"),
    }, identityDependencies);
    expect(compileOutputSchema(uiFixture.outputSchema)).toMatchObject({ ok: true });
    await expect(fs.readFile(path.join(uiFixture.workspace, "src", "diff", "props.js"), "utf-8"))
      .resolves.toContain("value != NULL && value !== false");
    await expect(fs.readFile(
      path.join(uiFixture.workspace, "test", "shared", "benchmark-v3-ui-regression.test.js"),
      "utf-8",
    )).resolves.toContain("aria-hidden");
    await fs.writeFile(path.join(uiFixture.workspace, "src", "diff", "props.js"), propsSource, "utf-8");
    const uiEvaluation = await uiProvider.evaluate({
      task: uiFixture.task,
      workspace: uiFixture.workspace,
      runnerExitCode: 0,
      result: { summary: "Restored false aria attribute serialization." },
    }, {
      runTestCommands: async () => [{
        command: "npm exec --offline -- vitest run --config vitest.benchmark-v3.config.mjs test/shared/benchmark-v3-ui-regression.test.js",
        exitCode: 0,
      }],
    });
    expect(uiEvaluation).toMatchObject({
      status: "passed",
      evaluation: { taskCompleted: true, testsPassed: true, patchAccepted: true },
    });

    const diagnosisProvider = resolveCodingAgentBenchmarkV3FixtureProvider(
      manifest,
      "real-web.dependency-diagnosis",
    );
    const diagnosisFixture = await diagnosisProvider.generate({
      ...providerInput,
      taskId: "real-web.dependency-diagnosis",
      workspace: path.join(root, "diagnosis-workspace"),
    }, identityDependencies);
    expect(compileOutputSchema(diagnosisFixture.outputSchema)).toMatchObject({ ok: true });
    await expect(fs.readFile(
      path.join(diagnosisFixture.workspace, "test", "benchmark-v3", "real-web-dependency-diagnosis.mjs"),
      "utf-8",
    )).resolves.toContain("preact-render-to-string/stream/node");
    const diagnosisResult = {
      rootCause: "preact-render-to-string@6.5.0 does not export the requested ./stream/node subpath",
      dependency: "preact-render-to-string",
      manifestPath: "package-lock.json",
      probePath: "test/benchmark-v3/real-web-dependency-diagnosis.mjs",
    };
    const diagnosisEvaluation = await diagnosisProvider.evaluate({
      task: diagnosisFixture.task,
      workspace: diagnosisFixture.workspace,
      runnerExitCode: 0,
      result: diagnosisResult,
    }, {
      runTestCommands: async () => [{
        command: "node test/benchmark-v3/real-web-dependency-diagnosis.mjs",
        exitCode: 1,
        stderr: "Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './stream/node' is not defined by exports in node_modules/preact-render-to-string/package.json",
      }],
    });
    expect(diagnosisEvaluation).toMatchObject({
      status: "passed",
      evaluation: { taskCompleted: true, testsPassed: true, patchAccepted: null },
    });
    const wrongFailureSignature = await diagnosisProvider.evaluate({
      task: diagnosisFixture.task,
      workspace: diagnosisFixture.workspace,
      runnerExitCode: 0,
      result: diagnosisResult,
    }, {
      runTestCommands: async () => [{
        command: "node test/benchmark-v3/real-web-dependency-diagnosis.mjs",
        exitCode: 1,
        stderr: "Error: unrelated test failure",
      }],
    });
    expect(wrongFailureSignature).toMatchObject({
      status: "failed",
      failureCategory: "product_workflow",
      evaluation: { taskCompleted: false, testsPassed: false, patchAccepted: null },
    });
    await fs.writeFile(path.join(diagnosisFixture.workspace, "unexpected.txt"), "mutation\n", "utf-8");
    const mutatedDiagnosis = await diagnosisProvider.evaluate({
      task: diagnosisFixture.task,
      workspace: diagnosisFixture.workspace,
      runnerExitCode: 0,
      result: diagnosisResult,
    }, {
      runTestCommands: async () => [{
        command: "node test/benchmark-v3/real-web-dependency-diagnosis.mjs",
        exitCode: 1,
        stderr: "Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: preact-render-to-string/stream/node",
      }],
    });
    expect(mutatedDiagnosis).toMatchObject({
      status: "failed",
      failureCategory: "product_workflow",
      evaluation: { taskCompleted: false, testsPassed: true, patchAccepted: null },
    });
  });

  it("generates and evaluates the two vscode-languageserver-node overlays", async () => {
    const manifest = await loadCodingAgentBenchmarkManifest(
      resolveCodingAgentBenchmarkManifestPath("v3"),
    );
    const repository = manifest.repositories.find(
      (candidate) => candidate.id === "vscode-languageserver-node",
    );
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v3-typescript-"));
    tempRoots.push(root);
    const sourceRoot = path.join(root, "source");
    const cacheRoot = path.join(root, "cache");
    await fs.mkdir(path.join(sourceRoot, "protocol", "src", "common"), { recursive: true });
    await fs.mkdir(path.join(sourceRoot, "jsonrpc", "src", "common"), { recursive: true });
    await fs.mkdir(path.join(cacheRoot, "node_modules"), { recursive: true });
    await fs.writeFile(path.join(sourceRoot, "License.txt"), "MIT fixture license\n", "utf-8");
    await fs.writeFile(path.join(sourceRoot, "package.json"), '{"name":"typescript-fixture"}\n', "utf-8");
    await fs.writeFile(path.join(sourceRoot, "package-lock.json"), '{"lockfileVersion":3}\n', "utf-8");
    const workspaceFolderSource = [
      "export namespace WorkspaceFoldersRequest {",
      "\texport const type = new ProtocolRequestType0<WorkspaceFolder[] | null, never, void, void>(method);",
      "}",
      "",
    ].join("\n");
    const connectionSource = [
      "export namespace TraceValue {",
      "\texport const Off: 'off' = 'off';",
      "}",
      "export type TraceValue = 'off' | 'messages' | 'compact' | 'verbose';",
      "",
      "/**",
      " * @deprecated Use TraceValue instead",
      " */",
      "export const TraceValues = TraceValue;",
      "export type TraceValues = TraceValue;",
      "",
    ].join("\n");
    const apiSource = [
      "import { Trace, TraceValue, TraceFormat, TraceValues } from './connection';",
      "export { Trace, TraceValue, TraceValues, TraceFormat };",
      "",
    ].join("\n");
    const protocolSource = [
      "import { ProgressToken, RequestHandler, TraceValue } from 'vscode-jsonrpc';",
      "export interface InitializeParams {",
      "\ttrace?: TraceValue;",
      "}",
      "",
    ].join("\n");
    await fs.writeFile(
      path.join(sourceRoot, "protocol", "src", "common", "protocol.workspaceFolder.ts"),
      workspaceFolderSource,
      "utf-8",
    );
    await fs.writeFile(
      path.join(sourceRoot, "jsonrpc", "src", "common", "connection.ts"),
      connectionSource,
      "utf-8",
    );
    await fs.writeFile(
      path.join(sourceRoot, "jsonrpc", "src", "common", "api.ts"),
      apiSource,
      "utf-8",
    );
    await fs.writeFile(
      path.join(sourceRoot, "protocol", "src", "common", "protocol.ts"),
      protocolSource,
      "utf-8",
    );
    const receipt = createSnapshotReceipt(repository);
    const identityDependencies = {
      resolveRepositorySnapshotIdentity: async () => ({
        sourceUrl: repository.source.url,
        commit: repository.source.commit,
        workspaceDirty: false,
        worktreeContentSha256: "1".repeat(64),
        dependencyInputsSha256: "2".repeat(64),
        licensePath: repository.license.path,
        licenseSha256: "3".repeat(64),
      }),
      resolveDependencyCacheIdentity: async () => ({
        cacheKey: `vscode-languageserver-node-${repository.source.commit}`,
        contentSha256: "4".repeat(64),
      }),
      setupTypeScriptWorkspace: async () => {},
    };
    const providerInput = {
      manifest,
      receipt,
      repositoryRoot: sourceRoot,
      dependencyCacheRoot: cacheRoot,
      executionNetwork: "disabled",
    };

    const refactorProvider = resolveCodingAgentBenchmarkV3FixtureProvider(
      manifest,
      "real-ts.cross-package-refactor",
    );
    expect(refactorProvider).toMatchObject({ readiness: "ready", kind: "repository-snapshot" });
    const refactorFixture = await withGitDates("2026-08-09T00:00:00Z", () => refactorProvider.generate({
      ...providerInput,
      taskId: "real-ts.cross-package-refactor",
      workspace: path.join(root, "refactor-workspace"),
    }, identityDependencies));
    const repeatedRefactorFixture = await withGitDates(
      "2026-08-10T00:00:00Z",
      () => refactorProvider.generate({
        ...providerInput,
        taskId: "real-ts.cross-package-refactor",
        workspace: path.join(root, "refactor-workspace-repeat"),
      }, identityDependencies),
    );
    expect(repeatedRefactorFixture.baselineCommit).toBe(refactorFixture.baselineCommit);
    expect(compileOutputSchema(refactorFixture.outputSchema)).toMatchObject({ ok: true });
    const refactorPath = path.join(
      refactorFixture.workspace,
      "protocol",
      "src",
      "common",
      "protocol.workspaceFolder.ts",
    );
    await expect(fs.readFile(refactorPath, "utf-8")).resolves.toContain(
      "WorkspaceFolder[] | null | undefined",
    );
    const refactorVerifierSource = await fs.readFile(
      path.join(refactorFixture.workspace, "test", "benchmark-v3", "real-ts-cross-package-refactor.mjs"),
      "utf-8",
    );
    expect(refactorVerifierSource).toContain(
      "path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')",
    );
    expect(refactorVerifierSource).toContain("types/src/tsconfig.json");
    expect(refactorVerifierSource).toContain("jsonrpc/src/common/tsconfig.json");
    expect(refactorVerifierSource).toContain("server/src/common/tsconfig.json");
    await fs.writeFile(refactorPath, workspaceFolderSource, "utf-8");
    const refactorEvaluation = await refactorProvider.evaluate({
      task: refactorFixture.task,
      workspace: refactorFixture.workspace,
      runnerExitCode: 0,
      result: { summary: "Restored the nullable workspace-folder request result contract." },
    }, {
      runTestCommands: async () => [{
        command: "node test/benchmark-v3/real-ts-cross-package-refactor.mjs",
        exitCode: 0,
      }],
    });
    expect(refactorEvaluation).toMatchObject({
      status: "passed",
      evaluation: { taskCompleted: true, testsPassed: true, patchAccepted: true },
    });
    const refactorRunnerFailure = await refactorProvider.evaluate({
      task: refactorFixture.task,
      workspace: refactorFixture.workspace,
      runnerExitCode: 1,
      result: { summary: "Restored the nullable workspace-folder request result contract." },
    }, {
      runTestCommands: async () => [{
        command: "node test/benchmark-v3/real-ts-cross-package-refactor.mjs",
        exitCode: 0,
      }],
    });
    expect(refactorRunnerFailure).toMatchObject({
      status: "failed",
      failureCategory: "product_workflow",
      evaluation: { testsPassed: true, patchAccepted: true },
    });
    await fs.writeFile(path.join(refactorFixture.workspace, "unexpected.txt"), "out of scope\n", "utf-8");
    const refactorOutOfScope = await refactorProvider.evaluate({
      task: refactorFixture.task,
      workspace: refactorFixture.workspace,
      runnerExitCode: 0,
      result: { summary: "Restored the nullable workspace-folder request result contract." },
    }, {
      runTestCommands: async () => [{
        command: "node test/benchmark-v3/real-ts-cross-package-refactor.mjs",
        exitCode: 0,
      }],
    });
    expect(refactorOutOfScope).toMatchObject({
      status: "failed",
      failureCategory: "product_workflow",
      evaluation: { testsPassed: true, patchAccepted: false },
    });

    const migrationProvider = resolveCodingAgentBenchmarkV3FixtureProvider(
      manifest,
      "real-ts.api-migration",
    );
    expect(migrationProvider).toMatchObject({ readiness: "ready", kind: "repository-snapshot" });
    const migrationFixture = await migrationProvider.generate({
      ...providerInput,
      taskId: "real-ts.api-migration",
      workspace: path.join(root, "migration-workspace"),
    }, identityDependencies);
    expect(compileOutputSchema(migrationFixture.outputSchema)).toMatchObject({ ok: true });
    const migrationProtocolPath = path.join(
      migrationFixture.workspace,
      "protocol",
      "src",
      "common",
      "protocol.ts",
    );
    await expect(fs.readFile(migrationProtocolPath, "utf-8")).resolves.toContain("TraceValues");
    await fs.writeFile(
      path.join(migrationFixture.workspace, "jsonrpc", "src", "common", "connection.ts"),
      [
        "export namespace TraceValue {",
        "\texport const Off: 'off' = 'off';",
        "}",
        "export type TraceValue = 'off' | 'messages' | 'compact' | 'verbose';",
        "",
      ].join("\n"),
      "utf-8",
    );
    await fs.writeFile(
      path.join(migrationFixture.workspace, "jsonrpc", "src", "common", "api.ts"),
      [
        "import { Trace, TraceValue, TraceFormat } from './connection';",
        "export { Trace, TraceValue, TraceFormat };",
        "",
      ].join("\n"),
      "utf-8",
    );
    await fs.writeFile(migrationProtocolPath, protocolSource, "utf-8");
    const migrationEvaluation = await migrationProvider.evaluate({
      task: migrationFixture.task,
      workspace: migrationFixture.workspace,
      runnerExitCode: 0,
      result: { summary: "Removed TraceValues and migrated the protocol package to TraceValue." },
    }, {
      runTestCommands: async () => [{
        command: "node test/benchmark-v3/real-ts-api-migration.mjs",
        exitCode: 0,
      }],
    });
    expect(migrationEvaluation).toMatchObject({
      status: "passed",
      evaluation: { taskCompleted: true, testsPassed: true, patchAccepted: true },
    });
    await fs.appendFile(
      path.join(migrationFixture.workspace, "jsonrpc", "src", "common", "connection.ts"),
      "export type TraceValues = TraceValue;\n",
      "utf-8",
    );
    const staleAlias = await migrationProvider.evaluate({
      task: migrationFixture.task,
      workspace: migrationFixture.workspace,
      runnerExitCode: 0,
      result: { summary: "Removed TraceValues and migrated the protocol package to TraceValue." },
    }, {
      runTestCommands: async () => [{
        command: "node test/benchmark-v3/real-ts-api-migration.mjs",
        exitCode: 0,
      }],
    });
    expect(staleAlias).toMatchObject({
      status: "failed",
      failureCategory: "product_workflow",
      evaluation: { testsPassed: true, patchAccepted: false },
    });
  });

  it("generates and evaluates the two spf13-cobra overlays with isolated Go caches", async () => {
    const manifest = await loadCodingAgentBenchmarkManifest(
      resolveCodingAgentBenchmarkManifestPath("v3"),
    );
    const repository = manifest.repositories.find((candidate) => candidate.id === "spf13-cobra");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v3-go-"));
    tempRoots.push(root);
    const sourceRoot = path.join(root, "source");
    const cacheRoot = path.join(root, "cache");
    await createGoFixtureSource(sourceRoot);
    await fs.mkdir(path.join(cacheRoot, "gomodcache"), { recursive: true });
    await fs.writeFile(
      path.join(cacheRoot, "gomodcache", "cached-module.txt"),
      "pinned module cache\n",
      "utf-8",
    );
    const receipt = createSnapshotReceipt(repository);
    const identityDependencies = {
      resolveRepositorySnapshotIdentity: async () => ({
        sourceUrl: repository.source.url,
        commit: repository.source.commit,
        workspaceDirty: false,
        worktreeContentSha256: "1".repeat(64),
        dependencyInputsSha256: "2".repeat(64),
        licensePath: repository.license.path,
        licenseSha256: "3".repeat(64),
      }),
      resolveDependencyCacheIdentity: async () => ({
        cacheKey: `spf13-cobra-${repository.source.commit}`,
        contentSha256: "4".repeat(64),
      }),
    };
    const providerInput = {
      manifest,
      receipt,
      repositoryRoot: sourceRoot,
      dependencyCacheRoot: cacheRoot,
      executionNetwork: "disabled",
    };

    const bugProvider = resolveCodingAgentBenchmarkV3FixtureProvider(manifest, "real-go.bug-fix");
    expect(bugProvider).toMatchObject({ readiness: "ready", kind: "repository-snapshot" });
    const bugFixture = await bugProvider.generate({
      ...providerInput,
      taskId: "real-go.bug-fix",
      workspace: path.join(root, "bug-workspace"),
    }, identityDependencies);
    expect(compileOutputSchema(bugFixture.outputSchema)).toMatchObject({ ok: true });
    expect(bugFixture.executionEnvironment).toMatchObject({
      GOPROXY: "off",
      GOSUMDB: "off",
      GOTOOLCHAIN: "local",
      GOENV: "off",
      GOWORK: "off",
    });
    expect(path.isAbsolute(bugFixture.executionEnvironment.GOMODCACHE)).toBe(true);
    expect(path.isAbsolute(bugFixture.executionEnvironment.GOCACHE)).toBe(true);
    expect(path.isAbsolute(bugFixture.executionEnvironment.GOTMPDIR)).toBe(true);
    await expect(fs.readFile(
      path.join(bugFixture.executionEnvironment.GOMODCACHE, "cached-module.txt"),
      "utf-8",
    )).resolves.toContain("pinned module cache");
    expect(runGit(bugFixture.workspace, ["ls-files", "--", ".coding-benchmark"])).toBe("");
    await expect(fs.readFile(path.join(bugFixture.workspace, "command.go"), "utf-8"))
      .resolves.toContain('strings.LastIndex(name, " ")');
    await expect(fs.readFile(
      path.join(bugFixture.workspace, "benchmark_v3_bug_fix_test.go"),
      "utf-8",
    )).resolves.toContain("serve SOURCE TARGET");
    const initialBugFailure = await bugProvider.evaluate({
      task: bugFixture.task,
      workspace: bugFixture.workspace,
      runnerExitCode: 0,
      result: { summary: "Investigated the frozen Name regression." },
    }, {
      runTestCommands: async () => [{ command: "go test -mod=readonly .", exitCode: 1 }],
    });
    expect(initialBugFailure).toMatchObject({
      status: "failed",
      failureCategory: "product_workflow",
      evaluation: { testsPassed: false, patchAccepted: false },
    });
    const brokenCommand = await fs.readFile(path.join(bugFixture.workspace, "command.go"), "utf-8");
    await fs.writeFile(
      path.join(bugFixture.workspace, "command.go"),
      brokenCommand.replace("strings.LastIndex", "strings.Index"),
      "utf-8",
    );
    const bugEvaluation = await bugProvider.evaluate({
      task: bugFixture.task,
      workspace: bugFixture.workspace,
      runnerExitCode: 0,
      result: { summary: "Restored first-token command names." },
    }, {
      runTestCommands: async () => [{ command: "go test -mod=readonly .", exitCode: 0 }],
    });
    expect(bugEvaluation).toMatchObject({
      status: "passed",
      evaluation: { taskCompleted: true, testsPassed: true, patchAccepted: true },
    });

    const migrationProvider = resolveCodingAgentBenchmarkV3FixtureProvider(
      manifest,
      "real-go.public-api-migration",
    );
    expect(migrationProvider).toMatchObject({ readiness: "ready", kind: "repository-snapshot" });
    const migrationFixture = await migrationProvider.generate({
      ...providerInput,
      taskId: "real-go.public-api-migration",
      workspace: path.join(root, "migration-workspace"),
    }, identityDependencies);
    const migrationCobraPath = path.join(migrationFixture.workspace, "cobra.go");
    const migrationOverlaySource = await fs.readFile(migrationCobraPath, "utf-8");
    expect(migrationOverlaySource).toContain("func WriteString(");
    expect(migrationOverlaySource).toContain("Deprecated: use WriteString.");
    await expect(fs.readFile(
      path.join(migrationFixture.workspace, "benchmark_v3_api_migration_test.go"),
      "utf-8",
    )).resolves.toContain("WriteStringAndCheck API migration is incomplete");
    const initialMigrationFailure = await migrationProvider.evaluate({
      task: migrationFixture.task,
      workspace: migrationFixture.workspace,
      runnerExitCode: 0,
      result: { summary: "Investigated the frozen API migration." },
    }, {
      runTestCommands: async () => [{ command: "go test -mod=readonly -p=1 ./...", exitCode: 1 }],
    });
    expect(initialMigrationFailure).toMatchObject({
      status: "failed",
      failureCategory: "product_workflow",
      evaluation: { testsPassed: false, patchAccepted: false },
    });
    for (const relativePath of GO_MIGRATION_PATHS) {
      const target = path.join(migrationFixture.workspace, ...relativePath.split("/"));
      const source = await fs.readFile(target, "utf-8");
      const migrated = relativePath === "cobra.go"
        ? source.replace(
          /\n\/\/ WriteStringAndCheck writes[\s\S]*?\nfunc WriteStringAndCheck\(b io\.StringWriter, s string\) \{\n\tWriteString\(b, s\)\n\}\n/,
          "\n",
        )
        : source.replaceAll("WriteStringAndCheck", "WriteString");
      await fs.writeFile(target, migrated, "utf-8");
    }
    const migrationEvaluation = await migrationProvider.evaluate({
      task: migrationFixture.task,
      workspace: migrationFixture.workspace,
      runnerExitCode: 0,
      result: { summary: "Migrated all public callers to WriteString." },
    }, {
      runTestCommands: async () => [{ command: "go test -mod=readonly -p=1 ./...", exitCode: 0 }],
    });
    expect(migrationEvaluation).toMatchObject({
      status: "passed",
      evaluation: { taskCompleted: true, testsPassed: true, patchAccepted: true },
    });
    await fs.appendFile(migrationCobraPath, "\nfunc WriteStringAndCheck() {}\n", "utf-8");
    const staleAlias = await migrationProvider.evaluate({
      task: migrationFixture.task,
      workspace: migrationFixture.workspace,
      runnerExitCode: 0,
      result: { summary: "Migrated all public callers to WriteString." },
    }, {
      runTestCommands: async () => [{ command: "go test -mod=readonly -p=1 ./...", exitCode: 0 }],
    });
    expect(staleAlias).toMatchObject({
      status: "failed",
      failureCategory: "product_workflow",
      evaluation: { testsPassed: true, patchAccepted: false },
    });
  });
});

async function createGoFixtureSource(sourceRoot) {
  await fs.mkdir(path.join(sourceRoot, "doc"), { recursive: true });
  await fs.writeFile(path.join(sourceRoot, "LICENSE.txt"), "Apache fixture license\n", "utf-8");
  await fs.writeFile(path.join(sourceRoot, "go.mod"), "module example.com/cobra-fixture\n\ngo 1.15\n", "utf-8");
  await fs.writeFile(
    path.join(sourceRoot, "command.go"),
    [
      "package cobra",
      "",
      "import \"strings\"",
      "",
      "type Command struct { Use string }",
      "",
      "func (c *Command) Name() string {",
      "\tname := c.Use",
      "\ti := strings.Index(name, \" \")",
      "\tif i >= 0 { name = name[:i] }",
      "\treturn name",
      "}",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(sourceRoot, "cobra.go"),
    [
      "package cobra",
      "",
      "import \"io\"",
      "",
      "func CheckErr(error) {}",
      "",
      "// WriteStringAndCheck writes a string into a buffer, and checks if the error is not nil.",
      "func WriteStringAndCheck(b io.StringWriter, s string) {",
      "\t_, err := b.WriteString(s)",
      "\tCheckErr(err)",
      "}",
      "",
    ].join("\n"),
    "utf-8",
  );
  for (const relativePath of GO_MIGRATION_PATHS.filter((item) => item !== "cobra.go")) {
    const target = path.join(sourceRoot, ...relativePath.split("/"));
    const isDoc = relativePath.startsWith("doc/");
    await fs.writeFile(
      target,
      [
        `package ${isDoc ? "doc" : "cobra"}`,
        "",
        isDoc
          ? "import (\"strings\"; cobra \"example.com/cobra-fixture\")"
          : "import \"strings\"",
        "",
        `func benchmark${path.basename(relativePath).replace(/\W/g, "_")}() {`,
        isDoc
          ? "\tcobra.WriteStringAndCheck(&strings.Builder{}, \"fixture\")"
          : "\tWriteStringAndCheck(&strings.Builder{}, \"fixture\")",
        "}",
        "",
      ].join("\n"),
      "utf-8",
    );
  }
}

async function withGitDates(value, operation) {
  const previousAuthorDate = process.env.GIT_AUTHOR_DATE;
  const previousCommitterDate = process.env.GIT_COMMITTER_DATE;
  process.env.GIT_AUTHOR_DATE = value;
  process.env.GIT_COMMITTER_DATE = value;
  try {
    return await operation();
  } finally {
    if (previousAuthorDate === undefined) delete process.env.GIT_AUTHOR_DATE;
    else process.env.GIT_AUTHOR_DATE = previousAuthorDate;
    if (previousCommitterDate === undefined) delete process.env.GIT_COMMITTER_DATE;
    else process.env.GIT_COMMITTER_DATE = previousCommitterDate;
  }
}

function createSystemEvidence(taskId, runId) {
  const common = {
    schemaVersion: "coding-agent-benchmark-system-evidence/v1",
    taskId,
    generatorId: {
      "system.browser-behavior": "browser-behavior-v1",
      "system.parallel-read-isolation": "parallel-read-isolation-v1",
      "system.parallel-write-fan-in": "parallel-write-fan-in-v1",
      "system.restart-delivery-reconciliation": "restart-delivery-reconciliation-v1",
    }[taskId],
    fixtureVersion: 1,
    runId,
    platform: "windows-native",
    status: "passed",
    sensitiveFindingCount: 0,
    orphanResourceCount: 0,
    duplicateSideEffectCount: 0,
  };
  if (taskId === "system.browser-behavior") {
    const screenshotSha256 = "1".repeat(64);
    const domAfterSha256 = "2".repeat(64);
    return {
      ...common,
      observations: {
        pageLoaded: true,
        consoleErrorCount: 0,
        domChanged: true,
        domAfterSha256,
        requestStatus: 200,
        networkScope: "loopback-only",
        screenshotSha256,
        screenshotBindingSha256: hashSystemEvidenceBinding([
          "coding-agent-benchmark-browser-binding/v1",
          runId,
          screenshotSha256,
          domAfterSha256,
        ]),
      },
    };
  }
  if (taskId === "system.parallel-read-isolation") {
    const snapshotSha256 = "3".repeat(64);
    const budgetId = "budget-read-v1";
    const bindingId = "binding-read-v1";
    return {
      ...common,
      observations: {
        children: ["read-a", "read-b", "read-c"].map((childId, index) => ({
          childId,
          snapshotSha256,
          budgetId,
          bindingId,
          terminalStatus: "completed",
          mutationCount: 0,
          terminalEvidenceSha256: String(index + 4).repeat(64),
        })),
      },
    };
  }
  if (taskId === "system.parallel-write-fan-in") {
    return {
      ...common,
      observations: {
        mainWorkspaceChangedBeforeFanIn: false,
        lanes: ["lane-a", "lane-b"].map((laneId, index) => ({
          laneId,
          worktreeId: `worktree-${index + 1}`,
          baselineSha256: "7".repeat(64),
          terminalStatus: "completed",
          mutationCount: 1,
        })),
        conflict: {
          detected: true,
          path: "workspace/shared.txt",
          evidenceSha256: "8".repeat(64),
        },
        fanIn: {
          mode: "preview-confirm",
          previewSha256: "9".repeat(64),
          confirmed: true,
          status: "completed",
          resultSha256: "a".repeat(64),
        },
      },
    };
  }
  return {
    ...common,
    observations: {
      restartInjected: true,
      oldBindingId: "binding-before-restart",
      newBindingId: "binding-after-restart",
      reattached: true,
      journalState: "applied",
      completedSideEffectCount: 1,
      replayedSideEffectCount: 0,
      localDeliveryStatus: "completed",
      remoteWriteCount: 0,
      terminalStatus: "completed",
      reconciliationSha256: "b".repeat(64),
    },
  };
}

function hashSystemEvidenceBinding(parts) {
  return crypto.createHash("sha256").update(parts.join("\0")).digest("hex");
}

async function generateFixture(manifest, root, taskId) {
  const provider = resolveCodingAgentBenchmarkV3FixtureProvider(manifest, taskId);
  return await provider.generate({
    manifest,
    taskId,
    workspace: path.join(root, taskId),
  });
}

function createSnapshotReceipt(repository) {
  return {
    schemaVersion: CODING_AGENT_BENCHMARK_SNAPSHOT_RECEIPT_VERSION,
    repositoryId: repository.id,
    source: {
      url: repository.source.url,
      commit: repository.source.commit,
      workspaceDirty: false,
      worktreeContentSha256: "1".repeat(64),
      dependencyInputsSha256: "2".repeat(64),
    },
    license: {
      spdx: repository.license.spdx,
      path: repository.license.path,
      sha256: "3".repeat(64),
    },
    dependencyCache: {
      cacheKey: `${repository.id}-${repository.source.commit}`,
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

function runGit(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(String(result.stderr).trim());
  return String(result.stdout);
}
