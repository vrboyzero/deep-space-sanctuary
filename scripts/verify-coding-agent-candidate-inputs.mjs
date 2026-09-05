import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadCodingAgentBenchmarkManifest } from "./coding-agent-benchmark-contract.mjs";
import { resolveBenchmarkRepositoryIdentity } from "./coding-agent-benchmark-preflight.mjs";
import { evaluateCodingAgentBenchmarkV3SnapshotPreflight, inspectCodingAgentBenchmarkV3SnapshotPreparation,
  validateCodingAgentBenchmarkV3SnapshotReceipt } from "./coding-agent-benchmark-v3-fixtures.mjs";
import { assertCandidateOrdinaryPath, assertCandidatePathWithin, candidateSha256, readCandidateFile } from "./coding-agent-candidate-config.mjs";

export async function verifyCandidateRepositoryInputs({ manifest, configPath }, dependencies = {}) {
  const inputRoot = path.dirname(configPath);
  const text = await readCandidateFile(configPath, 1024 * 1024);
  const config = JSON.parse(text);
  assert.deepEqual(Object.keys(config).sort(), ["repositories", "schemaVersion"]);
  if (config.schemaVersion !== "coding-agent-benchmark-repository-inputs/v1"
    || !Array.isArray(config.repositories) || config.repositories.length !== manifest.repositories.length) {
    throw new Error("Candidate repository inputs are incomplete.");
  }
  const inspect = dependencies.inspectSnapshot ?? inspectCodingAgentBenchmarkV3SnapshotPreparation;
  const preflight = dependencies.evaluatePreflight ?? evaluateCodingAgentBenchmarkV3SnapshotPreflight;
  let receipts = 0;
  let preflights = 0;
  for (const repository of manifest.repositories) {
    const entries = config.repositories.filter((entry) => entry.repositoryId === repository.id);
    if (entries.length !== 1) throw new Error("Candidate repository binding is missing or duplicated.");
    const [entry] = entries;
    assert.deepEqual(Object.keys(entry).sort(), ["dependencyCacheRoot", "receiptPath", "repositoryId", "repositoryRoot"]);
    const resolve = (key) => {
      if (typeof entry[key] !== "string" || !entry[key]) throw new Error("Candidate repository path is invalid.");
      return path.resolve(inputRoot, entry[key]);
    };
    const repositoryRoot = resolve("repositoryRoot");
    const dependencyCacheRoot = resolve("dependencyCacheRoot");
    const receiptPath = resolve("receiptPath");
    assertCandidatePathWithin(inputRoot, receiptPath);
    for (const root of [repositoryRoot, dependencyCacheRoot]) {
      await assertCandidateOrdinaryPath(root);
      if (!(await fs.lstat(root)).isDirectory()) throw new Error("Candidate repository/cache must be ordinary directories.");
    }
    const receipt = JSON.parse(await readCandidateFile(receiptPath, 1024 * 1024));
    validateCodingAgentBenchmarkV3SnapshotReceipt(manifest, receipt);
    assert.deepEqual(await inspect({ manifest, repositoryId: repository.id, repositoryRoot,
      dependencyCacheRoot, preparedAt: receipt.preparedAt }), receipt, "Candidate snapshot/cache receipt drifted.");
    receipts += 1;
    for (const task of manifest.tasks.filter((item) => item.layer === "B" && item.repositoryId === repository.id)) {
      const stored = JSON.parse(await readCandidateFile(path.join(inputRoot, "preflights", `${task.id}.json`), 1024 * 1024));
      const actual = await preflight({ manifest, taskId: task.id, repositoryRoot, dependencyCacheRoot, receipt, executionNetwork: "disabled" });
      if (actual.status !== "passed") throw new Error("Candidate repository preflight failed.");
      assert.deepEqual(stored, actual, "Candidate stored preflight drifted.");
      preflights += 1;
    }
  }
  return { repositories: config.repositories.length, receipts, preflights, configSha256: candidateSha256(text) };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 6 || args[0] !== "--harness" || args[2] !== "--config" || args[4] !== "--identity-sha256") {
    throw new Error("Usage: node --import tsx scripts/verify-coding-agent-candidate-inputs.mjs --harness <root> --config <file> --identity-sha256 <hash>");
  }
  const identity = await resolveBenchmarkRepositoryIdentity(args[1]);
  if (candidateSha256(JSON.stringify(identity)) !== args[5]) throw new Error("Candidate repository verifier harness identity drifted.");
  const manifest = await loadCodingAgentBenchmarkManifest(path.join(args[1], "benchmarks/coding-agent/v3/task-manifest.json"));
  console.log(JSON.stringify({ ...await verifyCandidateRepositoryInputs({ manifest, configPath: args[3] }), identity }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error("Candidate repository inputs failed independent verification."); process.exitCode = 1; });
}
