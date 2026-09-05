import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { loadCodingAgentBenchmarkManifest, resolveCodingAgentBenchmarkManifestPath } from "./coding-agent-benchmark-contract.mjs";
import { verifyCandidateRepositoryInputs } from "./verify-coding-agent-candidate-inputs.mjs";
import { prepareCandidateRepositoryInputs } from "./prepare-coding-agent-candidate-inputs.mjs";

let manifest;
const roots = [];
beforeAll(async () => { manifest = await loadCodingAgentBenchmarkManifest(resolveCodingAgentBenchmarkManifestPath("v3")); });
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "candidate-inputs-test-"));
  roots.push(root);
  const receipts = new Map();
  const preflights = new Map();
  const repositories = [];
  await fs.mkdir(path.join(root, "preflights"));
  for (const repo of manifest.repositories) {
    const receipt = {
      schemaVersion: "coding-agent-benchmark-snapshot-receipt/v1", repositoryId: repo.id,
      source: { ...repo.source, workspaceDirty: false, worktreeContentSha256: "a".repeat(64), dependencyInputsSha256: "b".repeat(64) },
      license: { spdx: repo.license.spdx, path: repo.license.path, sha256: "c".repeat(64) },
      dependencyCache: { cacheKey: `${repo.id}-fixture`, contentSha256: "d".repeat(64) },
      policy: { preparationNetwork: repo.snapshot.preparationNetwork, executionNetwork: repo.snapshot.executionNetwork, dependencyPolicy: repo.snapshot.dependencyPolicy },
      preparedAt: "2026-09-05T00:00:00.000Z",
    };
    receipts.set(repo.id, receipt);
    const entry = { repositoryId: repo.id, repositoryRoot: `${repo.id}/repo`, dependencyCacheRoot: `${repo.id}/cache`, receiptPath: `${repo.id}/receipt.json` };
    repositories.push(entry);
    await fs.mkdir(path.join(root, entry.repositoryRoot), { recursive: true });
    await fs.mkdir(path.join(root, entry.dependencyCacheRoot));
    await fs.writeFile(path.join(root, entry.receiptPath), JSON.stringify(receipt));
    for (const task of manifest.tasks.filter((item) => item.repositoryId === repo.id)) {
      const result = { status: "passed", taskId: task.id };
      preflights.set(task.id, result);
      await fs.writeFile(path.join(root, "preflights", `${task.id}.json`), JSON.stringify(result));
    }
  }
  const config = { schemaVersion: "coding-agent-benchmark-repository-inputs/v1", repositories };
  const configPath = path.join(root, "repository-inputs.json");
  await fs.writeFile(configPath, JSON.stringify(config));
  return {
    root, config, input: { manifest, configPath },
    dependencies: {
      inspectSnapshot: vi.fn(async ({ repositoryId }) => receipts.get(repositoryId)),
      evaluatePreflight: vi.fn(async ({ taskId }) => preflights.get(taskId)),
    },
  };
}

describe("independent candidate repository verification", () => {
  it("publishes new receipts from reusable cache pointers and refuses a second publication", async () => {
    const f = await fixture();
    const outputRoot = path.join(f.root, "published");
    const input = { manifest, sourceConfigPath: f.input.configPath, outputRoot, identity: { fixture: true } };
    expect(await prepareCandidateRepositoryInputs(input, f.dependencies)).toMatchObject({ repositories: 4, receipts: 4, preflights: 8 });
    expect(await verifyCandidateRepositoryInputs({ manifest, configPath: path.join(outputRoot, "repository-inputs.json") }, f.dependencies))
      .toMatchObject({ repositories: 4, receipts: 4, preflights: 8 });
    const before = await fs.readFile(path.join(outputRoot, "repository-inputs.json"), "utf8");
    await expect(prepareCandidateRepositoryInputs(input, f.dependencies)).rejects.toThrow(/already exists/);
    expect(await fs.readFile(path.join(outputRoot, "repository-inputs.json"), "utf8")).toBe(before);
  });

  it("recomputes all four receipts and eight stored preflights", async () => {
    const f = await fixture();
    expect(await verifyCandidateRepositoryInputs(f.input, f.dependencies)).toMatchObject({ repositories: 4, receipts: 4, preflights: 8 });
    expect(f.dependencies.inspectSnapshot).toHaveBeenCalledTimes(4);
    expect(f.dependencies.evaluatePreflight).toHaveBeenCalledTimes(8);
  });

  it("rejects cache drift instead of trusting the existing receipt hash", async () => {
    const f = await fixture();
    const original = f.dependencies.inspectSnapshot.getMockImplementation();
    f.dependencies.inspectSnapshot.mockImplementation(async (input) => {
      const receipt = structuredClone(await original(input));
      receipt.dependencyCache.contentSha256 = "f".repeat(64);
      return receipt;
    });
    await expect(verifyCandidateRepositoryInputs(f.input, f.dependencies)).rejects.toThrow(/receipt drifted/);
  });

  it("rejects duplicated repositories and an unpassed current preflight", async () => {
    const f = await fixture();
    f.dependencies.evaluatePreflight.mockResolvedValue({ status: "blocked" });
    await expect(verifyCandidateRepositoryInputs(f.input, f.dependencies)).rejects.toThrow(/preflight failed/);
    f.config.repositories[1] = f.config.repositories[0];
    await fs.writeFile(f.input.configPath, JSON.stringify(f.config));
    await expect(verifyCandidateRepositoryInputs(f.input, f.dependencies)).rejects.toThrow(/duplicated/);
  });
});
