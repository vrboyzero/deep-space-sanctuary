import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { candidateSha256, candidateSlotKey } from "./coding-agent-candidate-config.mjs";
import { claimCandidateSlot, completeCandidateSlot, closeCandidateSession } from "./coding-agent-candidate-session.mjs";
import { verifyCandidateResourceRecovery, writeCandidateResourceRecovery } from "./coding-agent-candidate-resource-recovery.mjs";

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "candidate-resource-recovery-")); roots.push(root);
  const schema = JSON.parse(await fs.readFile(new URL("../benchmarks/coding-agent/v3/candidate-runner-config.schema.json", import.meta.url), "utf8"));
  const reference = { path: path.join(root, "input.json"), sha256: "e".repeat(64) };
  const config = { schemaVersion: "coding-agent-candidate-runner-config/v1", id: "recovery-test", mode: "exploration",
    workspaceRoot: root, windowsHarnessRoot: path.join(root, "harness"),
    identity: { commit: "a".repeat(40), workspaceDirty: false, lockfileSha256: "b".repeat(64), worktreeContentSha256: "c".repeat(64) },
    wsl: { distribution: "Ubuntu-22.04", harnessRoot: path.join(root, "linux"), toolchainBin: "/var/tmp/tools",
      chromePath: "/var/tmp/chrome", libraryPath: "/var/tmp/lib" },
    roots: { artifacts: path.join(root, "artifacts"), fixtures: path.join(root, "fixtures"), state: path.join(root, "state"), ledger: path.join(root, "ledger") },
    repositoryConfigs: { "windows-native": reference, "wsl2-linux": reference },
    contracts: { manifest: "d".repeat(64), scorecard: "e".repeat(64), mapping: "f".repeat(64), agents: "a".repeat(64), expectedReportPlan: null },
    costBaseline: reference, selection: [{ taskId: "command.interactive-control", platform: "windows-native", attempt: 1 }],
    providerEnvPath: path.join(root, "provider.env"), execution: { ...Object.fromEntries(Object.entries(schema.properties.execution.properties)
      .filter(([, value]) => "const" in value).map(([key, value]) => [key, value.const])), port: 28891 } };
  const context = { workspaceRoot: root, ledgerRoot: config.roots.ledger, configSha256: candidateSha256(JSON.stringify(config)),
    costBaseline: reference, baseline: { providerReportedCostUsd: 2, reservedUnknownCostUsd: 1 }, slots: config.selection };
  const configPath = path.join(root, "config.json");
  await fs.writeFile(configPath, JSON.stringify(config));
  await fs.writeFile(config.providerEnvPath, "BELLDANDY_OPENAI_API_KEY=fixture-private-key");
  await claimCandidateSlot(context, context.slots[0]);
  await completeCandidateSlot(context, context.slots[0], { status: "unreported", reportSha256: null, artifactHashes: {},
    providerReportedCostUsd: 0, reservedUnknownCostUsd: 0.1, runnerExit: 1, resourcesClosed: false });
  const costBaseline = await closeCandidateSession(context, { lifecycle: "frozen", reasons: ["resources_uncertain"] });
  const stateRoot = path.join(config.roots.state, "w/a1/t01");
  await fs.mkdir(stateRoot, { recursive: true });
  await fs.writeFile(path.join(context.ledgerRoot, "slots", candidateSlotKey(context.slots[0]), "env-cleanup.json"),
    JSON.stringify({ stateRoot, status: "recycled", remaining: 0, action: "send_to_windows_recycle_bin" }));
  const dependencies = { checkResources: async () => ({ status: "passed", wslChecked: false, counts: [0, 0, 0, 0] }) };
  return { config, configPath, context, costBaseline, stateRoot, dependencies,
    verify: () => verifyCandidateResourceRecovery({ ledgerRoot: context.ledgerRoot, configSha256: context.configSha256,
      ledgerSha256: costBaseline.sha256 }, dependencies) };
}

describe("append-only candidate resource recovery", () => {
  it("verifies recovery without changing the failed closure or releasing unknown cost", async () => {
    const f = await fixture();
    const before = await fs.readFile(f.costBaseline.path);
    await writeCandidateResourceRecovery(f.configPath, f.dependencies);
    expect(await f.verify()).toMatchObject({ status: "verified", originalTerminalChanged: false });
    expect(await fs.readFile(f.costBaseline.path)).toEqual(before);
    expect(JSON.parse(before)).toMatchObject({ unreported: 1, reservedUnknownCostUsd: 1.1, resourceCleanupComplete: false });
    await expect(writeCandidateResourceRecovery(f.configPath, f.dependencies)).rejects.toThrow(/EEXIST/);
  });
  it("admits only a successor against the same final ledger after independent recovery verification", async () => {
    const f = await fixture();
    const successor = { ...f.context, configSha256: "f".repeat(64), ledgerRoot: path.join(f.context.workspaceRoot, "next-ledger"),
      costBaseline: f.costBaseline, baseline: { providerReportedCostUsd: 2, reservedUnknownCostUsd: 1.1 } };
    const verification = { verifyResourceRecovery: (input) => verifyCandidateResourceRecovery(input, f.dependencies) };
    await expect(claimCandidateSlot(successor, successor.slots[0], verification)).rejects.toThrow();
    await writeCandidateResourceRecovery(f.configPath, f.dependencies);
    await claimCandidateSlot(successor, successor.slots[0], verification);
    await expect(claimCandidateSlot(f.context, f.context.slots[0], verification)).rejects.toThrow();
    const original = JSON.parse(await fs.readFile(f.costBaseline.path, "utf8"));
    expect(original).toMatchObject({ lifecycle: "frozen", unreported: 1, reservedUnknownCostUsd: 1.1, resourceCleanupComplete: false });
  });
  it.each(["process", "env", "secret", "ledger", "config", "missing"]) ("rejects %s drift before successor admission", async (kind) => {
    const f = await fixture();
    const receipt = await writeCandidateResourceRecovery(f.configPath, f.dependencies);
    if (kind === "process") f.dependencies.checkResources = async () => ({ status: "passed", wslChecked: false, counts: [1, 0, 0, 0] });
    if (kind === "env") await fs.writeFile(path.join(f.stateRoot, ".env.local"), "unexpected=true");
    if (kind === "secret") await fs.writeFile(path.join(f.stateRoot, "output.log"), "fixture-private-key");
    if (kind === "ledger") await fs.appendFile(f.costBaseline.path, "\n");
    if (kind === "config") await fs.writeFile(f.configPath, JSON.stringify({ ...f.config, id: "changed" }));
    if (kind === "missing") await fs.rename(receipt.path, `${receipt.path}.retained`);
    await expect(f.verify()).rejects.toThrow();
  });
});
