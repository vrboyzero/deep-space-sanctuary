import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const { nativeExec, hostIdentity } = vi.hoisted(() => ({ nativeExec: vi.fn(), hostIdentity: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal();
  const { promisify } = await import("node:util");
  const execFile = () => { throw new Error("Expected promisified native verifier."); };
  execFile[promisify.custom] = nativeExec;
  return { ...actual, execFile };
});
vi.mock("./coding-agent-benchmark-preflight.mjs", async (importOriginal) => ({
  ...await importOriginal(), resolveBenchmarkRepositoryIdentity: hostIdentity,
}));

import { candidateSha256 } from "./coding-agent-candidate-config.mjs";
import { loadCandidateMaterials } from "./coding-agent-candidate-materials.mjs";

const roots = [];
afterEach(async () => {
  vi.resetAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "candidate-native-materials-"));
  roots.push(root);
  const harness = path.resolve(import.meta.dirname, "..");
  const identity = { commit: "a".repeat(40), workspaceDirty: false, lockfileSha256: "b".repeat(64), worktreeContentSha256: "c".repeat(64) };
  const contracts = { expectedReportPlan: null };
  for (const [label, relative] of Object.entries({ manifest: "v3/task-manifest.json", scorecard: "v3/scorecard.json",
    mapping: "v3/candidate-dimension-mapping.json", agents: "v2/agents.json" })) {
    const text = await fs.readFile(path.join(harness, "benchmarks/coding-agent", relative), "utf8");
    contracts[label] = candidateSha256(label === "manifest" ? text.replace(/\r\n?/g, "\n") : text);
  }
  const publish = async (name, value) => {
    const file = path.join(root, name);
    const text = JSON.stringify(value);
    await fs.writeFile(file, text);
    return { path: file, sha256: candidateSha256(text) };
  };
  const inputs = await publish("repository-inputs.json", {});
  await publish("preparation.json", { schemaVersion: "coding-agent-candidate-input-preparation/v1", status: "ready",
    platform: "linux", configSha256: inputs.sha256, identity });
  const costBaseline = await publish("cost-baseline.json", { schemaVersion: "p2c-candidate-global-cost-ledger/v2",
    providerReportedCostUsd: 0, reservedUnknownCostUsd: 0 });
  const linux = path.join(root, "linux");
  await fs.mkdir(linux);
  const schema = JSON.parse(await fs.readFile(path.join(harness, "benchmarks/coding-agent/v3/candidate-runner-config.schema.json"), "utf8"));
  const config = {
    schemaVersion: "coding-agent-candidate-runner-config/v1", id: "native-materials", mode: "exploration",
    workspaceRoot: root, windowsHarnessRoot: harness, identity,
    wsl: { distribution: "Ubuntu-22.04", harnessRoot: linux, toolchainBin: "/var/tmp/tools",
      chromePath: "/var/tmp/chrome", libraryPath: "/var/tmp/lib" },
    roots: Object.fromEntries(["artifacts", "fixtures", "state", "ledger"].map((name) => [name, path.join(root, name)])),
    repositoryConfigs: { "windows-native": inputs, "wsl2-linux": inputs },
    contracts, costBaseline, providerEnvPath: path.join(root, ".env.local"),
    selection: [{ taskId: "bug.reproducible-fix", platform: "wsl2-linux", attempt: 1 }],
    execution: { ...Object.fromEntries(Object.entries(schema.properties.execution.properties)
      .filter(([, value]) => "const" in value).map(([name, value]) => [name, value.const])), port: 28891 },
  };
  const configFile = await publish("config.json", config);
  hostIdentity.mockResolvedValue(identity);
  nativeExec.mockResolvedValueOnce({ stdout: "/var/tmp/native-harness\n" })
    .mockResolvedValueOnce({ stdout: "/var/tmp/native-inputs.json\n" });
  const verified = { identity, configSha256: inputs.sha256, repositories: 4, receipts: 4, preflights: 8 };
  return { configPath: configFile.path, config, verified };
}

it("verifies Linux identity on WSL without trusting a Windows Git view of executable bits", async () => {
  const f = await fixture();
  nativeExec.mockResolvedValueOnce({ stdout: JSON.stringify(f.verified) });
  await expect(loadCandidateMaterials(f.configPath)).resolves.toMatchObject({ config: f.config });
  expect(hostIdentity.mock.calls).toEqual([[f.config.windowsHarnessRoot]]);
  expect(nativeExec.mock.calls[2][1]).toContain("/var/tmp/native-harness/scripts/verify-coding-agent-candidate-inputs.mjs");
  expect(nativeExec.mock.calls[2][1]).toContain(candidateSha256(JSON.stringify(f.config.identity)));
});

it("rejects native identity drift even when host identity and input hashes match", async () => {
  const f = await fixture();
  nativeExec.mockResolvedValueOnce({ stdout: JSON.stringify({ ...f.verified, identity: { ...f.verified.identity, workspaceDirty: true } }) });
  await expect(loadCandidateMaterials(f.configPath)).rejects.toThrow(/native WSL harness identity drifted/);
});

it("fails closed when native verification rejects the source identity", async () => {
  const f = await fixture();
  nativeExec.mockRejectedValueOnce(new Error("Native source identity mismatch"));
  await expect(loadCandidateMaterials(f.configPath)).rejects.toThrow(/Native source identity mismatch/);
});

it("rejects an incomplete native input receipt set", async () => {
  const f = await fixture();
  nativeExec.mockResolvedValueOnce({ stdout: JSON.stringify({ ...f.verified, preflights: 7 }) });
  await expect(loadCandidateMaterials(f.configPath)).rejects.toThrow(/WSL repository verification is incomplete/);
});
