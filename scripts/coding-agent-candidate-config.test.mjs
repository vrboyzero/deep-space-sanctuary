import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadCodingAgentCandidateConfig, validateCodingAgentCandidateConfig } from "./coding-agent-candidate-config.mjs";

const tempRoots = [];
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "candidate-config-test-"));
  tempRoots.push(root);
  const schema = JSON.parse(await fs.readFile(new URL("../benchmarks/coding-agent/v3/candidate-runner-config.schema.json", import.meta.url), "utf8"));
  const file = (name) => ({ path: path.join(root, name), sha256: "a".repeat(64) });
  return {
    schemaVersion: "coding-agent-candidate-runner-config/v1", id: "explore-1", mode: "exploration",
    identity: { commit: "b".repeat(40), workspaceDirty: false, lockfileSha256: "c".repeat(64), worktreeContentSha256: "d".repeat(64) },
    workspaceRoot: root, windowsHarnessRoot: path.join(root, "windows"),
    wsl: { distribution: "Ubuntu-22.04", harnessRoot: path.join(root, "linux"), toolchainBin: "/var/tmp/tools", chromePath: "/var/tmp/chrome", libraryPath: "/var/tmp/lib" },
    roots: { artifacts: path.join(root, "artifacts"), fixtures: path.join(root, "fixtures"), state: path.join(root, "state"), ledger: path.join(root, "ledger") },
    repositoryConfigs: { "windows-native": file("windows-inputs.json"), "wsl2-linux": file("linux-inputs.json") },
    contracts: { manifest: "a".repeat(64), scorecard: "a".repeat(64), mapping: "a".repeat(64), agents: "a".repeat(64), expectedReportPlan: null },
    costBaseline: file("prior-ledger.json"), selection: [{ taskId: "bug.reproducible-fix", platform: "windows-native", attempt: 1 }],
    providerEnvPath: path.join(root, ".env.local"),
    execution: { ...Object.fromEntries(Object.entries(schema.properties.execution.properties).filter(([, value]) => "const" in value).map(([key, value]) => [key, value.const])), port: 28891 },
  };
}

describe("candidate runner configuration", () => {
  it("loads one fixed exploratory cohort and gives equivalent JSON the same configuration binding", async () => {
    const config = await fixture();
    const configPath = path.join(config.workspaceRoot, "config.json");
    await fs.writeFile(configPath, JSON.stringify(config));
    const loaded = await loadCodingAgentCandidateConfig(configPath);
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    expect((await loadCodingAgentCandidateConfig(configPath)).configSha256).toBe(loaded.configSha256);
    expect(loaded.config).toEqual(config);
  });

  it("rejects changed model, budgets, retries and undeclared credential fields", async () => {
    const config = await fixture();
    for (const change of [{ modelId: "other-model" }, { providerRetries: 1 }, { maxTokens: 24001 }, { singleRunMaxUsd: 0.11 }, { apiKey: "not-a-real-key" }]) {
      await expect(validateCodingAgentCandidateConfig({ ...config, execution: { ...config.execution, ...change } })).rejects.toThrow(/schema/);
    }
  });

  it("keeps exploratory observations out of formal plan inputs", async () => {
    const config = await fixture();
    await expect(validateCodingAgentCandidateConfig({ ...config, mode: "formal" })).rejects.toThrow(/144|frozen plan/);
    config.contracts.expectedReportPlan = { path: path.join(config.workspaceRoot, "plan.json"), sha256: "a".repeat(64) };
    await expect(validateCodingAgentCandidateConfig(config)).rejects.toThrow(/no formal plan/);
  });

  it("accepts only the two explicitly authorized task token caps without changing legacy configurations", async () => {
    const config = await fixture();
    delete config.execution.taskTokenCaps;
    expect(await validateCodingAgentCandidateConfig(config)).toEqual(config);
    const taskTokenCaps = { "command.interactive-control": 36000, "safety.boundary-enforcement": 32000 };
    const authorized = { ...config, execution: { ...config.execution, taskTokenCaps } };
    expect(await validateCodingAgentCandidateConfig(authorized)).toEqual(authorized);
    for (const caps of [
      { ...taskTokenCaps, "command.interactive-control": 36001 },
      { ...taskTokenCaps, "safety.boundary-enforcement": 32001 },
      { ...taskTokenCaps, "bug.reproducible-fix": 36000 },
    ]) {
      await expect(validateCodingAgentCandidateConfig({ ...config, execution: { ...config.execution, taskTokenCaps: caps } })).rejects.toThrow(/schema/);
    }
    await expect(validateCodingAgentCandidateConfig({ ...authorized, execution: { ...authorized.execution, maxTurns: 13 } })).rejects.toThrow(/schema/);
  });

  it("refuses a duplicate exploratory slot before any run can start", async () => {
    const config = await fixture();
    config.selection.push({ ...config.selection[0] });
    await expect(validateCodingAgentCandidateConfig(config)).rejects.toThrow(/duplicate/);
  });

  it("rejects path escape, overlapping output roots and source-tree outputs", async () => {
    const config = await fixture();
    await expect(validateCodingAgentCandidateConfig({ ...config, roots: { ...config.roots, artifacts: `${config.workspaceRoot}-sibling` } })).rejects.toThrow(/escaped/);
    await expect(validateCodingAgentCandidateConfig({ ...config, roots: { ...config.roots, fixtures: path.join(config.roots.artifacts, "fixture") } })).rejects.toThrow(/disjoint/);
    await expect(validateCodingAgentCandidateConfig({ ...config, roots: { ...config.roots, artifacts: path.join(config.windowsHarnessRoot, "artifacts") } })).rejects.toThrow(/source tree/);
    await expect(validateCodingAgentCandidateConfig(config, { systemTempRoot: path.join(config.workspaceRoot, "another-temp") })).rejects.toThrow(/escaped/);
  });

  it("rejects a directory as configuration without reading arbitrary children", async () => {
    const config = await fixture();
    await expect(loadCodingAgentCandidateConfig(config.workspaceRoot)).rejects.toThrow(/ordinary file/);
  });
});
