import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadCodingAgentBenchmarkManifest } from "./coding-agent-benchmark-contract.mjs";
import { resolveBenchmarkRepositoryIdentity } from "./coding-agent-benchmark-preflight.mjs";
import { evaluateCodingAgentBenchmarkV3SnapshotPreflight, inspectCodingAgentBenchmarkV3SnapshotPreparation } from "./coding-agent-benchmark-v3-fixtures.mjs";
import { assertCandidateOrdinaryPath, candidateSha256, readCandidateFile } from "./coding-agent-candidate-config.mjs";
import { verifyCandidateRepositoryInputs } from "./verify-coding-agent-candidate-inputs.mjs";

export async function prepareCandidateRepositoryInputs({ manifest, sourceConfigPath, outputRoot, identity }, dependencies = {}) {
  await assertCandidateOrdinaryPath(outputRoot, true);
  const exists = await fs.lstat(outputRoot).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
  if (exists) throw new Error("Candidate input output already exists.");
  const config = JSON.parse(await readCandidateFile(sourceConfigPath, 1024 * 1024));
  assert.deepEqual(Object.keys(config).sort(), ["repositories", "schemaVersion"]);
  if (config.schemaVersion !== "coding-agent-benchmark-repository-inputs/v1" || config.repositories?.length !== manifest.repositories.length) {
    throw new Error("Candidate source/cache pointers are incomplete.");
  }
  const sources = manifest.repositories.map((repo) => {
    const matches = config.repositories.filter((entry) => entry.repositoryId === repo.id);
    if (matches.length !== 1) throw new Error("Candidate source/cache pointers are duplicated or missing.");
    const [entry] = matches;
    assert.deepEqual(Object.keys(entry).sort(), ["dependencyCacheRoot", "receiptPath", "repositoryId", "repositoryRoot"]);
    if (![entry.repositoryRoot, entry.dependencyCacheRoot].every((value) => typeof value === "string" && value)) {
      throw new Error("Candidate source/cache paths are invalid.");
    }
    return { repositoryId: repo.id,
      repositoryRoot: path.resolve(path.dirname(sourceConfigPath), entry.repositoryRoot),
      dependencyCacheRoot: path.resolve(path.dirname(sourceConfigPath), entry.dependencyCacheRoot),
      receiptPath: `receipts/${repo.id}.json` };
  });
  for (const entry of sources) {
    for (const root of [entry.repositoryRoot, entry.dependencyCacheRoot]) {
      await assertCandidateOrdinaryPath(root);
      if (!(await fs.lstat(root)).isDirectory()) throw new Error("Candidate source/cache must be ordinary directories.");
      const relation = path.relative(root, outputRoot);
      if (!relation || (!relation.startsWith(`..${path.sep}`) && relation !== ".." && !path.isAbsolute(relation))) {
        throw new Error("Candidate publication cannot write inside reused source/cache.");
      }
    }
  }
  await fs.mkdir(path.dirname(outputRoot), { recursive: true });
  const stage = `${outputRoot}.preparing-${crypto.randomUUID()}`;
  await fs.mkdir(stage);
  await fs.mkdir(path.join(stage, "receipts"));
  await fs.mkdir(path.join(stage, "preflights"));
  const write = async (name, value) => fs.writeFile(path.join(stage, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  const inspect = dependencies.inspectSnapshot ?? inspectCodingAgentBenchmarkV3SnapshotPreparation;
  const preflight = dependencies.evaluatePreflight ?? evaluateCodingAgentBenchmarkV3SnapshotPreflight;
  const preparedAt = new Date().toISOString();
  for (const entry of sources) {
    // 旧配置仅提供只读 source/cache 指针；receipt 和 preflight 由当前 owner 重新生成。
    const receipt = await inspect({ manifest, ...entry, preparedAt });
    await write(entry.receiptPath, receipt);
    for (const task of manifest.tasks.filter((item) => item.layer === "B" && item.repositoryId === entry.repositoryId)) {
      const result = await preflight({ manifest, ...entry, taskId: task.id, receipt, executionNetwork: "disabled" });
      if (result.status !== "passed") throw new Error("Candidate preparation preflight failed; staging evidence retained.");
      await write(`preflights/${task.id}.json`, result);
    }
  }
  await write("repository-inputs.json", { schemaVersion: config.schemaVersion, repositories: sources });
  const verified = await verifyCandidateRepositoryInputs({ manifest, configPath: path.join(stage, "repository-inputs.json") }, dependencies);
  await write("preparation.json", { schemaVersion: "coding-agent-candidate-input-preparation/v1", status: "ready", identity,
    preparedAt, platform: process.platform, ...verified });
  // 先独占发布目录；失败保留 stage 和输出，禁止下一次把部分发布误当作缓存。
  await fs.mkdir(outputRoot);
  for (const entry of ["receipts", "preflights", "repository-inputs.json", "preparation.json"]) {
    await fs.rename(path.join(stage, entry), path.join(outputRoot, entry));
  }
  return { ...verified, configPath: path.join(outputRoot, "repository-inputs.json"), retainedStage: stage };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 8 || args[0] !== "--harness" || args[2] !== "--source-config"
    || args[4] !== "--output-root" || args[6] !== "--identity-sha256") {
    throw new Error("Usage: --harness <root> --source-config <cache-pointers.json> --output-root <new-root> --identity-sha256 <hash>");
  }
  const identity = await resolveBenchmarkRepositoryIdentity(args[1]);
  if (identity.workspaceDirty || candidateSha256(JSON.stringify(identity)) !== args[7]) throw new Error("Candidate preparation identity drifted.");
  const manifest = await loadCodingAgentBenchmarkManifest(path.join(args[1], "benchmarks/coding-agent/v3/task-manifest.json"));
  console.log(JSON.stringify(await prepareCandidateRepositoryInputs({ manifest, sourceConfigPath: args[3], outputRoot: args[5], identity })));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error("Candidate input preparation failed; retain any partial staging for inspection."); process.exitCode = 1; });
}
