import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID,
  CODE_INTEL_AGENT_UPLIFT_GATE_SHA256,
  CODE_INTEL_AGENT_UPLIFT_READINESS_VERSION,
  CODE_INTEL_AGENT_UPLIFT_TASK_IDS,
  compareCodeIntelAgentUpliftReadinessReports,
  runCodeIntelAgentUpliftReadiness,
} from "./run-code-intel-agent-uplift-readiness.mjs";

const workspaceRoot = path.resolve(".");
const tempRoots = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("CodeIntel Agent uplift readiness", () => {
  it("freezes eight paired cells while preparing only the current platform without external execution", async () => {
    const fixture = await createReadinessFixture("windows-native");
    const report = await runCodeIntelAgentUpliftReadiness({
      platform: "windows-native",
      sourceRoot: fixture.sourceRoot,
      repositoryConfigPath: fixture.repositoryConfigPath,
      outputRoot: fixture.outputRoot,
      generatedAt: "2026-08-09T09:00:00.000Z",
    }, readinessDependencies("windows-native"));

    expect(report).toMatchObject({
      schemaVersion: CODE_INTEL_AGENT_UPLIFT_READINESS_VERSION,
      status: "ready_for_authorization",
      platform: "windows-native",
      candidateId: CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID,
      authorization: {
        status: "pending_explicit_user_authorization",
        providerAuthorizationRequired: true,
        previousP0AuthorizationApplicable: false,
        credentialsRead: false,
      },
      execution: {
        mode: "dry-run",
        gatewayCalls: 0,
        modelCalls: 0,
        paidProviderCalls: 0,
        codeIntelProviderQueries: 0,
        networkCalls: 0,
        hostCommandToolCalls: 0,
        credentialsRead: false,
        productionWorkspaceMutations: 0,
      },
    });
    expect(report.gate.sha256).toBe(CODE_INTEL_AGENT_UPLIFT_GATE_SHA256);
    expect(report.taskManifest.sha256).toBe("e3cac7c8b2786408af45dc3bfed718ee1a898388aa0fae4fbd5b1d38ab68bd22");
    expect(report.truthSet.sha256).toBe("f6d787ec2a20f446c69f90a467d3812c8ca9644517ee5c7acf328430f934500e");
    expect(report.pairMatrix).toHaveLength(8);
    expect(report.pairMatrix.filter((pair) => pair.platform === "windows-native")).toHaveLength(4);
    expect(report.pairMatrix.filter((pair) => pair.platform === "wsl2-linux")).toHaveLength(4);
    expect(report.preparedPairs.map((pair) => pair.taskId)).toEqual(CODE_INTEL_AGENT_UPLIFT_TASK_IDS);
    expect(report.repositories.map((repository) => repository.repositoryId))
      .toEqual(["express", "vscode-languageserver-node"]);
    expect(report.sourceIdentity.files.length).toBeGreaterThan(0);
    expect(report.runtimeIdentity.files.length).toBeGreaterThan(0);

    for (const binding of report.profileBindings) {
      const { toolAllow: baselineAllow, ...baselineRest } = binding.baseline;
      const { toolAllow: candidateAllow, ...candidateRest } = binding.candidate;
      expect(candidateRest).toEqual(baselineRest);
      expect(candidateAllow).toEqual([...baselineAllow, "code_intel"]);
      expect(binding.differences).toEqual([{
        path: "toolAllow",
        operation: "append",
        value: "code_intel",
      }]);
    }

    const schema = JSON.parse(await fs.readFile(path.join(
      workspaceRoot,
      "benchmarks/code-intel/v1/agent-uplift-readiness.schema.json",
    ), "utf-8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.validator.validateOutput(JSON.stringify(report))).toMatchObject({ ok: true });
    }
    await expect(runCodeIntelAgentUpliftReadiness({
      platform: "windows-native",
      sourceRoot: fixture.sourceRoot,
      repositoryConfigPath: fixture.repositoryConfigPath,
      outputRoot: fixture.outputRoot,
    }, readinessDependencies("windows-native"))).rejects.toThrow(/output root already exists/i);
  });

  it("compares cross-platform identities and fails closed on frozen input drift", async () => {
    const windows = await createReadinessFixture("windows-native");
    const wsl = await createReadinessFixture("wsl2-linux");
    const windowsReport = await runCodeIntelAgentUpliftReadiness({
      platform: "windows-native",
      sourceRoot: windows.sourceRoot,
      repositoryConfigPath: windows.repositoryConfigPath,
      outputRoot: windows.outputRoot,
      generatedAt: "2026-08-09T09:00:00.000Z",
    }, readinessDependencies("windows-native"));
    const wslReport = await runCodeIntelAgentUpliftReadiness({
      platform: "wsl2-linux",
      sourceRoot: wsl.sourceRoot,
      repositoryConfigPath: wsl.repositoryConfigPath,
      outputRoot: wsl.outputRoot,
      generatedAt: "2026-08-09T09:01:00.000Z",
    }, readinessDependencies("wsl2-linux"));

    expect(compareCodeIntelAgentUpliftReadinessReports(windowsReport, wslReport)).toEqual({
      passed: true,
      failures: [],
    });
    const drifted = structuredClone(wslReport);
    drifted.runtimeIdentity.aggregateSha256 = "f".repeat(64);
    expect(compareCodeIntelAgentUpliftReadinessReports(windowsReport, drifted)).toEqual({
      passed: false,
      failures: ["runtime_identity_mismatch"],
    });

    const drift = await createReadinessFixture("windows-native");
    await fs.appendFile(
      path.join(drift.sourceRoot, "benchmarks/coding-agent/v3/task-manifest.json"),
      " ",
    );
    await expect(runCodeIntelAgentUpliftReadiness({
      platform: "windows-native",
      sourceRoot: drift.sourceRoot,
      repositoryConfigPath: drift.repositoryConfigPath,
      outputRoot: drift.outputRoot,
    }, readinessDependencies("windows-native"))).rejects.toThrow(/task manifest identity drift/i);

    const gateDrift = await createReadinessFixture("windows-native");
    const gatePath = path.join(
      gateDrift.sourceRoot,
      "benchmarks/code-intel/v1/agent-uplift-gate.json",
    );
    const gate = JSON.parse(await fs.readFile(gatePath, "utf-8"));
    gate.gates.semanticAdoption.minimumSuccessfulRuns = 7;
    await fs.writeFile(gatePath, `${JSON.stringify(gate, null, 2)}\n`);
    await expect(runCodeIntelAgentUpliftReadiness({
      platform: "windows-native",
      sourceRoot: gateDrift.sourceRoot,
      repositoryConfigPath: gateDrift.repositoryConfigPath,
      outputRoot: gateDrift.outputRoot,
    }, readinessDependencies("windows-native"))).rejects.toThrow(/Gate identity drift/i);
  });
});

async function createReadinessFixture(platform) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `code-intel-uplift-${platform}-`));
  tempRoots.push(root);
  const sourceRoot = path.join(root, "source");
  const inputRoot = path.join(root, "inputs");
  const outputRoot = path.join(root, "artifacts", platform);
  const sourcePaths = [
    "scripts/run-code-intel-agent-uplift-readiness.mjs",
    "scripts/run-coding-agent-ci.mjs",
    "scripts/run-coding-agent-benchmark.mjs",
    "scripts/coding-agent-benchmark-contract.mjs",
    "packages/belldandy-core/src/bin/gateway-main.ts",
    "packages/belldandy-skills/src/executor.ts",
    "packages/belldandy-skills/src/builtin/code-intel.ts",
    "packages/belldandy-skills/src/code-intel/code-intel.ts",
    "packages/belldandy-skills/src/code-intel/typescript-provider.ts",
  ];
  const runtimePaths = [
    "packages/belldandy-core/dist/bin/bdd.js",
    "packages/belldandy-core/dist/bin/gateway-main.js",
    "packages/belldandy-skills/dist/executor.js",
    "packages/belldandy-skills/dist/builtin/code-intel.js",
    "packages/belldandy-skills/dist/code-intel/code-intel.js",
    "packages/belldandy-skills/dist/code-intel/typescript-provider.js",
  ];
  await Promise.all([
    fs.mkdir(path.join(sourceRoot, "benchmarks/coding-agent/v3"), { recursive: true }),
    fs.mkdir(path.join(sourceRoot, "benchmarks/code-intel/v1"), { recursive: true }),
    fs.mkdir(inputRoot, { recursive: true }),
    ...[...sourcePaths, ...runtimePaths].map(async (relativePath) => {
      const target = path.join(sourceRoot, relativePath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, `${relativePath}\n`, "utf-8");
    }),
  ]);
  for (const relativePath of [
    "benchmarks/coding-agent/v3/task-manifest.json",
    "benchmarks/code-intel/v1/truth-set.json",
    "benchmarks/code-intel/v1/agent-uplift-gate.json",
  ]) {
    await fs.copyFile(path.join(workspaceRoot, relativePath), path.join(sourceRoot, relativePath));
  }

  const repositories = [];
  for (const repositoryId of ["express", "vscode-languageserver-node"]) {
    const repositoryRoot = path.join(inputRoot, "sources", repositoryId);
    const dependencyCacheRoot = path.join(inputRoot, "caches", repositoryId);
    const receiptPath = path.join(inputRoot, "receipts", `${repositoryId}.json`);
    await Promise.all([
      fs.mkdir(repositoryRoot, { recursive: true }),
      fs.mkdir(dependencyCacheRoot, { recursive: true }),
      fs.mkdir(path.dirname(receiptPath), { recursive: true }),
    ]);
    await fs.writeFile(receiptPath, `${JSON.stringify(snapshotReceipt(repositoryId, platform), null, 2)}\n`);
    repositories.push({ repositoryId, repositoryRoot, dependencyCacheRoot, receiptPath });
  }
  const repositoryConfigPath = path.join(inputRoot, "repository-inputs.json");
  await fs.writeFile(repositoryConfigPath, `${JSON.stringify({
    schemaVersion: "coding-agent-benchmark-repository-inputs/v1",
    repositories,
  }, null, 2)}\n`);
  return { sourceRoot, repositoryConfigPath, outputRoot };
}

function readinessDependencies(runtimePlatform) {
  return {
    runtimePlatform,
    verifyRepositoryInput: async () => ({ status: "passed" }),
  };
}

function snapshotReceipt(repositoryId, platform) {
  const express = repositoryId === "express";
  return {
    schemaVersion: "coding-agent-benchmark-snapshot-receipt/v1",
    repositoryId,
    source: {
      url: express
        ? "https://github.com/expressjs/express.git"
        : "https://github.com/microsoft/vscode-languageserver-node.git",
      commit: express
        ? "a3714473feb3d2908add734d340e7755fd85e0a3"
        : "b6c62820ef4c0542e0c7118d7d64ba888e4cfee5",
      workspaceDirty: false,
      worktreeContentSha256: (express ? "a" : "b").repeat(64),
      dependencyInputsSha256: (express ? "c" : "d").repeat(64),
    },
    license: {
      spdx: "MIT",
      path: express ? "LICENSE" : "License.txt",
      sha256: (express ? "e" : "f").repeat(64),
    },
    dependencyCache: {
      cacheKey: `${repositoryId}-${platform}`,
      contentSha256: (platform === "windows-native" ? "1" : "2").repeat(64),
    },
    policy: {
      preparationNetwork: "allowlisted-source-only",
      executionNetwork: "disabled",
      dependencyPolicy: "pinned-cache-required",
    },
    preparedAt: "2026-08-09T08:00:00.000Z",
  };
}
