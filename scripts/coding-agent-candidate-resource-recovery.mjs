import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { candidateSha256, candidateSlotKey, loadCodingAgentCandidateConfig, readCandidateFile } from "./coding-agent-candidate-config.mjs";
import { collectCodingAgentCandidateSensitiveScan } from "./coding-agent-candidate-evidence.mjs";
import { checkCandidateResources } from "./coding-agent-candidate-runtime.mjs";
import { loadWindowsProviderEnvironment } from "./run-coding-agent-benchmark-windows.mjs";

const VERSION = "coding-agent-candidate-resource-recovery/v1";
const RECOVERY_FILE = "resource-recovery.json";

// 仅恢复后继会话的资源前置；不回写冻结终态、费用预留或原敏感值验证。
async function collectRecovery(configPath, dependencies = {}) {
  const { config, configSha256 } = await loadCodingAgentCandidateConfig(configPath);
  const ledgerPath = path.join(config.roots.ledger, "cost-ledger-final.json");
  const ledgerText = await readCandidateFile(ledgerPath);
  const ledger = JSON.parse(ledgerText);
  assert.equal(ledger.schemaVersion, "coding-agent-candidate-cost-ledger/v1");
  assert.equal(ledger.configSha256, configSha256);
  assert.equal(ledger.lifecycle, "frozen");
  assert.equal(ledger.resourceCleanupComplete, false);
  assert.equal(ledger.pending, 0);
  const binding = JSON.parse(await readCandidateFile(path.join(config.roots.ledger, "session-binding.json")));
  assert.equal(binding.configSha256, configSha256);
  assert.deepEqual(binding.slots, config.selection);
  const entries = [];
  const envCleanup = [];
  const sensitiveRoots = [];
  const tasks = [...new Set(config.selection.map((slot) => slot.taskId))];
  for (const slot of config.selection) {
    const journalRoot = path.join(config.roots.ledger, "slots", candidateSlotKey(slot));
    const intentText = await readCandidateFile(path.join(journalRoot, "intent.json")).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!intentText) continue;
    const intent = JSON.parse(intentText);
    const terminal = JSON.parse(await readCandidateFile(path.join(journalRoot, "terminal.json")));
    for (const [kind, record] of [["intent", intent], ["terminal", terminal]]) {
      assert.equal(record.configSha256, configSha256);
      assert.equal(record.kind, kind);
      assert.deepEqual(record.slot, slot);
    }
    entries.push({ slot, intent, terminal });
    const taskKey = `t${String(tasks.indexOf(slot.taskId) + 1).padStart(2, "0")}`;
    const stateRoot = path.join(config.roots.state, slot.platform === "windows-native" ? "w" : "l", `a${slot.attempt}`, taskKey);
    for (const name of [".env", ".env.local"]) {
      await assert.rejects(fs.lstat(path.join(stateRoot, name)), { code: "ENOENT" });
    }
    const cleanupPath = path.join(journalRoot, "env-cleanup.json");
    const cleanupText = await readCandidateFile(cleanupPath);
    const cleanup = JSON.parse(cleanupText);
    assert.equal(path.resolve(cleanup.stateRoot), stateRoot);
    assert.equal(cleanup.status, "recycled");
    assert.equal(cleanup.remaining, 0);
    assert.equal(cleanup.action, "send_to_windows_recycle_bin");
    envCleanup.push({ slot, sha256: candidateSha256(cleanupText) });
    sensitiveRoots.push(stateRoot);
    const artifactRoot = path.join(config.roots.artifacts, slot.platform, `attempt-${slot.attempt}`, slot.taskId);
    try { await fs.lstat(artifactRoot); sensitiveRoots.push(artifactRoot); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  assert.ok(entries.length > 0);
  assert.equal(entries.length, ledger.processed);
  assert.equal(candidateSha256(JSON.stringify(entries)), ledger.journalSha256);
  const resources = await (dependencies.checkResources ?? checkCandidateResources)(configPath);
  assert.equal(resources.status, "passed");
  assert.equal(resources.wslChecked, config.selection.some((slot) => slot.platform === "wsl2-linux"));
  assert.ok(Array.isArray(resources.counts) && resources.counts.length === (resources.wslChecked ? 8 : 4));
  assert.ok(resources.counts.every((value) => value === 0));
  const providerBytes = await readCandidateFile(config.providerEnvPath);
  const provider = await (dependencies.loadProvider ?? loadWindowsProviderEnvironment)(config.providerEnvPath);
  const values = Object.entries(provider).filter(([key, value]) => /(?:API_KEY|PASSWORD|SECRET)$/.test(key)
    && typeof value === "string" && value).map(([, value]) => value);
  assert.ok(values.length > 0);
  const sensitiveScan = await (dependencies.scan ?? collectCodingAgentCandidateSensitiveScan)({ sensitiveRoots, sensitiveValues: values });
  assert.equal(sensitiveScan.status, "completed");
  for (const key of ["findingCount", "unreadableFileCount", "symlinkOrReparsePointCount"]) assert.equal(sensitiveScan[key], 0);
  return { schemaVersion: VERSION, config: { path: path.resolve(configPath), sha256: configSha256 },
    ledger: { path: ledgerPath, sha256: candidateSha256(ledgerText), journalSha256: ledger.journalSha256 },
    scope: "successor_resource_admission_only", originalTerminalChanged: false, originalSensitiveScanRecovered: false,
    retiredEphemeralAuth: "gateway_stopped_not_reconstructed", providerEnvSha256: candidateSha256(providerBytes),
    resources, envCleanup, sensitiveScan: { coverage: "retained_provider_values_only", ...sensitiveScan } };
}

export async function writeCandidateResourceRecovery(configPath, dependencies = {}) {
  const recovery = await collectRecovery(configPath, dependencies);
  const outputPath = path.join(path.dirname(recovery.ledger.path), RECOVERY_FILE);
  await fs.writeFile(outputPath, `${JSON.stringify(recovery, null, 2)}\n`, { flag: "wx" });
  return { path: outputPath, sha256: candidateSha256(await readCandidateFile(outputPath)) };
}

export async function verifyCandidateResourceRecovery({ ledgerRoot, configSha256, ledgerSha256 }, dependencies = {}) {
  const text = await readCandidateFile(path.join(ledgerRoot, RECOVERY_FILE));
  const recovery = JSON.parse(text);
  assert.equal(recovery.schemaVersion, VERSION);
  assert.equal(recovery.config?.sha256, configSha256);
  assert.equal(recovery.ledger?.path, path.join(ledgerRoot, "cost-ledger-final.json"));
  assert.equal(recovery.ledger.sha256, ledgerSha256);
  const rebuilt = await collectRecovery(recovery.config.path, dependencies);
  assert.deepEqual(rebuilt, recovery);
  return { status: "verified", sha256: candidateSha256(text), originalTerminalChanged: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--config") {
    throw new Error("Usage: --config <frozen-candidate-config.json>");
  }
  writeCandidateResourceRecovery(args[1]).then((result) => console.log(JSON.stringify(result))).catch(() => {
    console.error("Candidate resource recovery remains unverified; original closure retained."); process.exitCode = 1;
  });
}
