import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { candidateRunPaths } from "./coding-agent-candidate-materials.mjs";
import { executeCandidateRuntime, prepareCandidateRuntime, recordCandidatePostRunResources, recycleCandidateRuntimeEnv } from "./coding-agent-candidate-runtime.mjs";
import { collectCodingAgentCandidateSensitiveScan } from "./coding-agent-candidate-evidence.mjs";

const execFile = promisify(execFileCallback);
const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    // 只有 env 回收闭合后才删除测试用的非敏感材料。
    const names = await fs.readdir(root, { recursive: true });
    if (names.some((name) => [".env", ".env.local"].includes(path.basename(name)))) {
      throw new Error("Test environment files require the authorized recycle helper.");
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function fixture(platform = "windows-native") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "candidate-runtime-test-"));
  roots.push(root);
  const slot = { taskId: "bug.reproducible-fix", platform, attempt: 1 };
  const config = {
    mode: "exploration", id: "explore-test", selection: [slot],
    windowsHarnessRoot: path.join(root, "harness"), providerEnvPath: path.join(root, "provider-placeholder"),
    wsl: { distribution: "Ubuntu-22.04", harnessRoot: path.join(root, "linux"), toolchainBin: "/var/tmp/tools", chromePath: "/var/tmp/chrome", libraryPath: "/var/tmp/lib" },
    roots: Object.fromEntries(["artifacts", "fixtures", "state", "ledger"].map((name) => [name, path.join(root, name)])),
    execution: { provider: "openai", modelId: "deepseek-v4-flash", port: 28891, singleRunMaxUsd: 0.1,
      inputUsdPerMillion: 0.125, outputUsdPerMillion: 0.25, cacheReadUsdPerMillion: 0.0025,
      ociImage: "node:22-bullseye@sha256:62f550497561d6285e10abd952730db89c905be990237eaf8744137929c72844" },
    repositoryConfigs: { [platform]: { path: path.join(root, "inputs.json") } },
  };
  const agents = path.join(root, "agents.json");
  await fs.writeFile(agents, "{}");
  const context = { config, configSha256: "a".repeat(64), paths: { agents } };
  const paths = candidateRunPaths(config, slot);
  await fs.mkdir(paths.journalRoot, { recursive: true });
  return { root, slot, context, paths };
}

describe("candidate runtime boundaries", () => {
  it("retains exact-secret scan evidence even when the resource sweep fails", async () => {
    const f = await fixture();
    await fs.mkdir(f.paths.stateRoot, { recursive: true });
    await fs.writeFile(path.join(f.paths.stateRoot, "output.log"), "safe output");
    await expect(recordCandidatePostRunResources(f.context, "fixture-config", f.paths, new Set(["private-fixture-value"]), {
      checkResources: async () => { throw new Error("container remains"); },
    })).rejects.toThrow();
    const record = JSON.parse(await fs.readFile(path.join(f.paths.journalRoot, "resources.json"), "utf8"));
    expect(record).toMatchObject({ status: "failed", failureCode: "resource_check_failed",
      sensitiveScan: { status: "completed", findingCount: 0, regularFileCount: 1 } });
    expect(JSON.stringify(record)).not.toContain("private-fixture-value");
  });

  it.each(["windows-native", "wsl2-linux"])("passes the fixed model, cost and platform to %s without a formal plan", async (platform) => {
    const f = await fixture(platform);
    let received;
    const fakeRunner = async (input, options) => { received = { input, options }; return 0; };
    expect(await executeCandidateRuntime(f.context, f.slot, f.paths, { candidateProviderReportedCostUsd: 0.002 }, new Set(), {
      loadRunner: async () => ({ runWindowsBenchmark: fakeRunner, runWslBenchmark: fakeRunner }),
    })).toBe(0);
    expect(received.input).toMatchObject({ modelId: "deepseek-v4-flash", infrastructureRetries: 0,
      priorObservedCostUsd: 0.002, maxTotalCostUsd: 0.10200000000000001 });
    expect(received.input).not.toHaveProperty("candidateId");
    expect(received.input).not.toHaveProperty("expectedReportPlanPath");
    expect(received.options.baseEnv.BELLDANDY_OPENAI_MAX_RETRIES).toBe("0");
    if (platform === "wsl2-linux") expect(received.input).toMatchObject({ gatewayWorkspaceRoot: f.context.config.windowsHarnessRoot, toolchainBin: "/var/tmp/tools" });
  });

  it.skipIf(process.platform !== "win32")("dry-runs, recycles only generated env files, and retains immutable cleanup evidence", async () => {
    const f = await fixture();
    await prepareCandidateRuntime(f.context, f.paths, f.slot);
    try {
      const { stdout } = await execFile("pwsh.exe", ["-NoProfile", "-File", path.join(import.meta.dirname, "recycle-coding-agent-candidate-env.ps1"),
        "-StateRoot", f.paths.stateRoot, "-LogPath", path.join(f.paths.journalRoot, "env-cleanup.json")], { windowsHide: true });
      expect(JSON.parse(stdout)).toMatchObject({ status: "dry_run", files: [expect.objectContaining({ sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })] });
      expect(await fs.stat(path.join(f.paths.stateRoot, ".env"))).toBeTruthy();
    } finally { await recycleCandidateRuntimeEnv(f.paths); }
    const result = JSON.parse(await fs.readFile(path.join(f.paths.journalRoot, "env-cleanup.json"), "utf8"));
    expect(result).toMatchObject({ status: "recycled", remaining: 0 });
    expect(JSON.parse(await fs.readFile(f.paths.bindingPath, "utf8"))).toMatchObject({ formal: false, mode: "exploration", slot: f.slot });
    await expect(recycleCandidateRuntimeEnv(f.paths)).rejects.toThrow();
  }, 30_000);

  it("scans real state/artifact bytes for exact secrets without returning their values", async () => {
    const f = await fixture();
    await fs.mkdir(f.paths.artifactRoot, { recursive: true });
    const value = "candidate-test-sensitive-value";
    await fs.writeFile(path.join(f.paths.artifactRoot, "trace.txt"), `prefix ${value} suffix`);
    const result = await collectCodingAgentCandidateSensitiveScan({ sensitiveRoots: [f.paths.artifactRoot], sensitiveValues: [value] });
    expect(result).toMatchObject({ status: "completed", findingCount: 1, unreadableFileCount: 0 });
    expect(JSON.stringify(result)).not.toContain(value);
  });
});
