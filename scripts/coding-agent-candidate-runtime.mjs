import { execFile as execFileCallback, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { collectCodingAgentCandidateSensitiveScan } from "./coding-agent-candidate-evidence.mjs";
import { assertCandidateOrdinaryPath } from "./coding-agent-candidate-config.mjs";

const execFile = promisify(execFileCallback);

export async function checkCandidateResources(configPath) {
  const { stdout } = await execFile("pwsh.exe", [
    "-NoProfile", "-File", path.join(import.meta.dirname, "check-coding-agent-candidate-resources.ps1"),
    "-ConfigPath", configPath,
  ], { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });
  const result = JSON.parse(stdout);
  if (result.status !== "passed" || !Array.isArray(result.counts) || result.counts.length < 3 || result.counts.some((count) => count !== 0)) {
    throw new Error("Candidate resources are not quiescent.");
  }
  return result;
}

export async function prepareCandidateRuntime(context, paths, slot) {
  await assertCandidateOrdinaryPath(paths.bindingPath, true);
  await fs.mkdir(path.dirname(paths.bindingPath), { recursive: true });
  await fs.writeFile(paths.bindingPath, `${JSON.stringify({
    schemaVersion: "coding-agent-candidate-run-binding/v1", mode: context.config.mode,
    formal: context.config.mode === "formal", configSha256: context.configSha256, slot,
  }, null, 2)}\n`, { flag: "wx" });
  await assertCandidateOrdinaryPath(paths.stateRoot, true);
  await fs.mkdir(path.dirname(paths.stateRoot), { recursive: true });
  await fs.mkdir(paths.stateRoot);
  await fs.copyFile(context.paths.agents, path.join(paths.stateRoot, "agents.json"), fs.constants.COPYFILE_EXCL);
  await fs.writeFile(path.join(paths.stateRoot, ".env"), [
    "BELLDANDY_COMMAND_SANDBOX_BACKEND=oci",
    "BELLDANDY_COMMAND_SANDBOX_OCI_RUNTIME=docker",
    `BELLDANDY_COMMAND_SANDBOX_OCI_IMAGE=${context.config.execution.ociImage}`,
    "",
  ].join("\n"), { flag: "wx" });
}

export async function recycleCandidateRuntimeEnv(paths) {
  const args = [
    "-NoProfile", "-File", path.join(import.meta.dirname, "recycle-coding-agent-candidate-env.ps1"),
    "-StateRoot", paths.stateRoot, "-LogPath", path.join(paths.journalRoot, "env-cleanup.json"),
  ];
  const options = { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 };
  await execFile("pwsh.exe", args, options);
  await execFile("pwsh.exe", [...args, "-Execute"], options);
}

export async function executeCandidateRuntime(context, slot, paths, costs, sensitiveValues, dependencies = {}) {
  const { config } = context;
  const wsl = slot.platform === "wsl2-linux";
  const runnerPath = path.join(config.windowsHarnessRoot, `scripts/run-coding-agent-benchmark-${wsl ? "wsl" : "windows"}.mjs`);
  const runnerModule = await (dependencies.loadRunner ?? ((file) => import(pathToFileURL(file).href)))(runnerPath);
  const run = wsl ? runnerModule.runWslBenchmark : runnerModule.runWindowsBenchmark;
  const baseEnv = {
    ...process.env,
    BELLDANDY_MODEL_INPUT_USD_PER_1M: String(config.execution.inputUsdPerMillion),
    BELLDANDY_MODEL_OUTPUT_USD_PER_1M: String(config.execution.outputUsdPerMillion),
    BELLDANDY_MODEL_CACHE_READ_USD_PER_1M: String(config.execution.cacheReadUsdPerMillion),
    BELLDANDY_COMMAND_SANDBOX_BACKEND: "oci", BELLDANDY_COMMAND_SANDBOX_OCI_RUNTIME: "docker",
    BELLDANDY_COMMAND_SANDBOX_OCI_IMAGE: config.execution.ociImage,
    BELLDANDY_OPENAI_MAX_RETRIES: "0",
    ...(wsl ? { BELLDANDY_CHROME_PATH: config.wsl.chromePath, LD_LIBRARY_PATH: config.wsl.libraryPath } : {}),
  };
  const names = String(baseEnv.WSLENV ?? "").split(":").filter(Boolean);
  for (const name of ["BELLDANDY_CHROME_PATH", "LD_LIBRARY_PATH", "BELLDANDY_COMMAND_SANDBOX_BACKEND",
    "BELLDANDY_COMMAND_SANDBOX_OCI_RUNTIME", "BELLDANDY_COMMAND_SANDBOX_OCI_IMAGE", "BELLDANDY_OPENAI_MAX_RETRIES"]) {
    if (!names.some((entry) => entry.split("/")[0] === name)) names.push(name);
  }
  baseEnv.WSLENV = names.join(":");
  return run({
    workspaceRoot: wsl ? config.wsl.harnessRoot : config.windowsHarnessRoot,
    ...(wsl ? { distribution: config.wsl.distribution, gatewayWorkspaceRoot: config.windowsHarnessRoot, toolchainBin: config.wsl.toolchainBin } : {}),
    sourceRoot: wsl ? config.wsl.harnessRoot : config.windowsHarnessRoot,
    fixtureRoot: paths.fixtureRoot, artifactRoot: paths.artifactRoot, stateRoot: paths.stateRoot,
    provider: config.execution.provider, modelId: config.execution.modelId, credentialsConfigured: true,
    providerEnvFile: config.providerEnvPath, v3RepositoryConfig: config.repositoryConfigs[slot.platform].path,
    manifestRevision: "v3", taskId: slot.taskId, attempt: slot.attempt, infrastructureRetries: 0,
    port: config.execution.port, authMode: "token", ...(wsl ? {} : { host: "127.0.0.1" }),
    priorObservedCostUsd: costs.candidateProviderReportedCostUsd,
    maxTotalCostUsd: costs.candidateProviderReportedCostUsd + config.execution.singleRunMaxUsd,
    ...(config.mode === "formal" ? { candidateId: config.id, expectedReportPlanPath: config.contracts.expectedReportPlan.path } : {}),
  }, {
    baseEnv,
    spawn(command, args, options) {
      for (const [name, value] of Object.entries(options.env ?? {})) {
        if (/(?:API_KEY|AUTH_TOKEN|PASSWORD|SECRET)$/.test(name) && typeof value === "string" && value) sensitiveValues.add(value);
      }
      return spawn(command, args, options);
    },
  });
}

export async function recordCandidatePostRunResources(context, configPath, paths, sensitiveValues, dependencies = {}) {
  // 资源检查失败也要趁临时凭据仍在内存时完成扫描，保留两个独立失败面的证据。
  const resources = await (dependencies.checkResources ?? checkCandidateResources)(configPath)
    .catch(() => ({ status: "failed", failureCode: "resource_check_failed" }));
  const sensitiveRoots = [paths.stateRoot];
  const artifactStats = await fs.lstat(paths.artifactRoot).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (artifactStats) sensitiveRoots.push(paths.artifactRoot);
  const sensitiveScan = await collectCodingAgentCandidateSensitiveScan({ sensitiveRoots, sensitiveValues: [...sensitiveValues] });
  const record = { ...resources, configSha256: context.configSha256, sensitiveScan };
  await fs.writeFile(path.join(paths.journalRoot, "resources.json"), `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
  if (resources.status !== "passed") throw new Error("Candidate resource sweep requires investigation before another session.");
  if (sensitiveScan.status !== "completed" || sensitiveScan.findingCount !== 0
    || sensitiveScan.unreadableFileCount !== 0 || sensitiveScan.symlinkOrReparsePointCount !== 0) {
    throw new Error("Candidate sensitive scan requires investigation before another session.");
  }
  return record;
}
