import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  CODING_AGENT_BENCHMARK_COMMAND_CONTROL_AGENT_PROFILE,
  resolveCodingAgentBenchmarkContract,
  resolveCodingAgentBenchmarkTaskBudgets,
} from "./coding-agent-benchmark-contract.mjs";

const OCI_IMAGE_DIGEST_PATTERN = /^.+@sha256:[a-f0-9]{64}$/i;
const BENCHMARK_TOOL_RESULT_EVENT_OUTPUT_CHAR_LIMIT = 2_048;

export async function createBenchmarkPreflightArtifact(input, dependencies = {}) {
  const contractSource = await evaluateBenchmarkContractSourcePreflight(input, dependencies);
  const pricing = evaluateBenchmarkPricingPreflight({
    required: input.pricingRequired === true,
    readEnv: input.readEnv,
  });
  const profile = input.task?.executionProfile
    ? input.manifest?.suite?.executionProfiles?.[input.task.executionProfile]
    : undefined;
  const agentProfile = await evaluateBenchmarkAgentProfilePreflight({
    stateDir: input.stateDir,
    profile,
  }, dependencies);
  const executionBudget = evaluateBenchmarkExecutionBudgetPreflight(input);
  const commandTools = input.task?.executionProfile
    ? profile?.toolAllow
    : undefined;
  const oci = await evaluateBenchmarkOciPreflight({
    required: Array.isArray(commandTools)
      && (commandTools.includes("run_command") || commandTools.includes("command_job")),
    readEnv: input.readEnv,
    probeImage: dependencies.probeImage,
  });
  const eventProjection = evaluateBenchmarkEventProjectionPreflight({
    required: input.task?.id === "command.interactive-control",
    readEnv: input.readEnv,
  });
  const fault = input.task?.id === "gateway.disconnect-recovery"
    || input.task?.id === "gateway.process-restart"
    ? { status: "not_applicable", reason: "deferred_runtime_precondition" }
    : { status: "not_applicable", reason: "task_has_no_fault_injection" };
  return {
    schemaVersion: "coding-agent-benchmark-preflight/v1",
    manifestRevision: input.manifestRevision,
    taskId: input.task?.id,
    runId: input.runId,
    status: [contractSource, agentProfile, executionBudget, pricing, oci, eventProjection]
      .some((check) => check.status === "failed") ? "failed" : "passed",
    checks: { contractSource, agentProfile, executionBudget, pricing, oci, eventProjection, fault },
  };
}

export function evaluateBenchmarkExecutionBudgetPreflight(input = {}) {
  try {
    const contract = resolveCodingAgentBenchmarkContract(input.manifestRevision);
    const taskId = requireNonEmptyString(input.task?.id, "task.id");
    const actual = resolveCodingAgentBenchmarkTaskBudgets(input.manifest, taskId);
    const expected = {
      ...contract.budgets,
      ...(contract.taskBudgetOverrides?.[taskId] ?? {}),
    };
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      return { status: "failed", reason: "execution_budget_mismatch" };
    }
    return { status: "passed", reason: null, taskId, ...actual };
  } catch {
    return { status: "failed", reason: "execution_budget_contract_invalid" };
  }
}

export function evaluateBenchmarkEventProjectionPreflight(input = {}) {
  if (input.required !== true) {
    return { status: "not_applicable", reason: "task_does_not_require_extended_event_output" };
  }
  const readEnv = input.readEnv ?? ((name) => process.env[name]);
  const raw = readEnv("BELLDANDY_TOOL_RESULT_EVENT_OUTPUT_CHAR_LIMIT");
  if (typeof raw !== "string" || raw.trim() !== String(BENCHMARK_TOOL_RESULT_EVENT_OUTPUT_CHAR_LIMIT)) {
    return { status: "failed", reason: "event_output_limit_mismatch" };
  }
  return { status: "passed", reason: null, limit: BENCHMARK_TOOL_RESULT_EVENT_OUTPUT_CHAR_LIMIT };
}

export async function evaluateBenchmarkAgentProfilePreflight(input = {}, dependencies = {}) {
  const agentId = typeof input.profile?.agentId === "string" ? input.profile.agentId.trim() : "";
  const maxHighRiskToolCalls = input.profile?.maxHighRiskToolCalls;
  if (!agentId && maxHighRiskToolCalls === undefined) {
    return { status: "not_applicable", reason: "profile_uses_runtime_default" };
  }
  if (!agentId || !Number.isInteger(maxHighRiskToolCalls) || maxHighRiskToolCalls < 0) {
    return { status: "failed", reason: "agent_profile_contract_invalid" };
  }

  const readFile = dependencies.readFile ?? fs.readFile;
  let raw;
  let parsed;
  try {
    raw = await readFile(path.join(requireNonEmptyString(input.stateDir, "stateDir"), "agents.json"));
    parsed = JSON.parse(String(raw));
  } catch {
    return { status: "failed", reason: "agent_profile_config_unavailable" };
  }
  const matches = Array.isArray(parsed?.agents)
    ? parsed.agents.filter((candidate) => candidate?.id === agentId)
    : [];
  if (matches.length !== 1) {
    return { status: "failed", reason: matches.length === 0 ? "agent_profile_missing" : "agent_profile_ambiguous" };
  }
  const selected = matches[0];
  if (selected?.maxHighRiskToolCalls !== maxHighRiskToolCalls) {
    return { status: "failed", reason: "agent_profile_budget_mismatch" };
  }
  if (!sameJsonObject(selected, CODING_AGENT_BENCHMARK_COMMAND_CONTROL_AGENT_PROFILE)) {
    return { status: "failed", reason: "agent_profile_contract_drift" };
  }
  return {
    status: "passed",
    reason: null,
    agentId,
    maxHighRiskToolCalls,
    configSha256: sha256(stableJson(selected)),
  };
}

export async function evaluateBenchmarkContractSourcePreflight(input, dependencies = {}) {
  const sourceRoot = path.resolve(requireNonEmptyString(input.sourceRoot, "sourceRoot"));
  const manifest = input.manifest;
  const task = input.task;
  const manifestRevision = input.manifestRevision;
  if (!manifest || !task || manifest.schemaVersion !== `coding-agent-benchmark-manifest/${manifestRevision}`) {
    return { status: "failed", reason: "manifest_revision_mismatch" };
  }
  const profile = manifest.suite?.executionProfiles?.[task.executionProfile];
  if (!profile || !Array.isArray(profile.toolAllow)) {
    return { status: "failed", reason: "profile_capability_missing" };
  }
  if (manifestRevision === "v2" && task.executionProfile === "command-control"
    && (!profile.toolAllow.includes("run_command") || !profile.toolAllow.includes("command_job"))) {
    return { status: "failed", reason: "profile_capability_missing" };
  }

  const entrypointPaths = {
    bdd: "packages/belldandy-core/dist/bin/bdd.js",
    gateway: "packages/belldandy-core/dist/server.js",
    contracts: "packages/belldandy-core/dist/coding-run/contracts.js",
  };
  const readFile = dependencies.readFile ?? fs.readFile;
  const entrypoints = {};
  try {
    for (const [name, relativePath] of Object.entries(entrypointPaths)) {
      const content = await readFile(path.join(sourceRoot, ...relativePath.split("/")));
      entrypoints[name] = { path: relativePath, sha256: sha256(content) };
    }
    const packageJson = JSON.parse(String(await readFile(path.join(sourceRoot, "package.json"))));
    if (typeof packageJson.packageManager !== "string" || !packageJson.packageManager.trim()) {
      return { status: "failed", reason: "package_manager_missing" };
    }
  } catch {
    return { status: "failed", reason: "source_build_unavailable" };
  }
  return {
    status: "passed",
    reason: null,
    manifestVersion: manifest.schemaVersion,
    profile: task.executionProfile,
    toolAllow: [...profile.toolAllow],
    entrypoints,
  };
}

export function evaluateBenchmarkPricingPreflight(input = {}) {
  if (input.required !== true) {
    return { status: "not_applicable", reason: "fixture_provider" };
  }
  const readEnv = input.readEnv ?? ((name) => process.env[name]);
  const inputRate = readFiniteNonNegativeRate(readEnv("BELLDANDY_MODEL_INPUT_USD_PER_1M"));
  const outputRate = readFiniteNonNegativeRate(readEnv("BELLDANDY_MODEL_OUTPUT_USD_PER_1M"));
  return inputRate === undefined || outputRate === undefined
    ? { status: "failed", reason: "pricing_unavailable" }
    : { status: "passed", reason: null };
}

export async function evaluateBenchmarkOciPreflight(input = {}) {
  if (input.required !== true) {
    return { status: "not_applicable", reason: "profile_has_no_command_execution" };
  }
  const readEnv = input.readEnv ?? ((name) => process.env[name]);
  const backend = readEnv("BELLDANDY_COMMAND_SANDBOX_BACKEND");
  const runtime = readEnv("BELLDANDY_COMMAND_SANDBOX_OCI_RUNTIME");
  const image = readEnv("BELLDANDY_COMMAND_SANDBOX_OCI_IMAGE");
  if (backend !== "oci" || !isSafeRuntimeName(runtime) || !OCI_IMAGE_DIGEST_PATTERN.test(String(image ?? ""))) {
    return { status: "failed", reason: "invalid_configuration" };
  }

  const probeImage = input.probeImage ?? inspectLocalOciImage;
  let probe;
  try {
    probe = await probeImage({ runtime, image });
  } catch {
    return { status: "failed", reason: "runtime_unavailable", runtime, image };
  }
  if (!probe?.available) {
    return { status: "failed", reason: "image_not_present", runtime, image };
  }
  const expectedRepoDigest = normalizeOciRepoDigest(image);
  const availableRepoDigests = Array.isArray(probe.repoDigests)
    ? probe.repoDigests.map(normalizeOciRepoDigest).filter(Boolean)
    : [];
  if (!expectedRepoDigest || !availableRepoDigests.includes(expectedRepoDigest)) {
    return { status: "failed", reason: "image_digest_mismatch", runtime, image };
  }
  return { status: "passed", reason: null, runtime, image };
}

function normalizeOciRepoDigest(reference) {
  if (typeof reference !== "string") return null;
  const separator = reference.lastIndexOf("@");
  if (separator <= 0) return null;
  const name = reference.slice(0, separator);
  const digest = reference.slice(separator + 1).toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) return null;
  const lastSlash = name.lastIndexOf("/");
  const lastColon = name.lastIndexOf(":");
  const repository = (lastColon > lastSlash ? name.slice(0, lastColon) : name).toLowerCase();
  return repository ? `${repository}@${digest}` : null;
}

export async function resolveBenchmarkRepositoryIdentity(repositoryRoot) {
  const root = path.resolve(requireNonEmptyString(repositoryRoot, "repositoryRoot"));
  const commit = runGit(root, ["rev-parse", "HEAD"]).toString("utf-8").trim();
  if (!/^[0-9a-f]{40}$/i.test(commit)) {
    throw new Error("Benchmark source must resolve to a full Git commit.");
  }
  const status = runGit(root, ["status", "--porcelain=v1", "--untracked-files=all", "-z"]);
  const lockfilePath = path.join(root, "pnpm-lock.yaml");
  let lockfile;
  try {
    lockfile = await fs.readFile(lockfilePath);
  } catch (error) {
    throw new Error(`Benchmark repository lockfile is unavailable: ${safeMessage(error)}`);
  }
  return {
    commit,
    workspaceDirty: status.length > 0,
    lockfileSha256: sha256(normalizeTextLineEndings(lockfile)),
    worktreeContentSha256: await hashRepositoryWorktree(root, status),
  };
}

async function inspectLocalOciImage({ runtime, image }) {
  const result = spawnSync(runtime, ["image", "inspect", "--format", "{{json .RepoDigests}}", image], {
    encoding: "utf-8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) return { available: false, repoDigests: [] };
  try {
    const repoDigests = JSON.parse(String(result.stdout ?? "").trim());
    return { available: true, repoDigests: Array.isArray(repoDigests) ? repoDigests : [] };
  } catch {
    return { available: false, repoDigests: [] };
  }
}

async function hashRepositoryWorktree(root, status) {
  const tracked = splitNull(runGit(root, ["ls-files", "-z"]));
  const untracked = splitNull(runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"]));
  const entries = [...new Set([...tracked, ...untracked])].sort(compareRepositoryPaths);
  const hash = crypto.createHash("sha256");
  hash.update("coding-agent-benchmark-worktree/v1\0");
  hash.update(status);
  const records = [];
  const regularFiles = [];
  for (const relativePath of entries) {
    const absolutePath = path.resolve(root, relativePath);
    const safeRelative = path.relative(root, absolutePath);
    if (!safeRelative || safeRelative.startsWith(`..${path.sep}`) || path.isAbsolute(safeRelative)) {
      throw new Error(`Benchmark worktree path escapes repository root: ${relativePath}.`);
    }
    let stats;
    try {
      stats = await fs.lstat(absolutePath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        records.push({ relativePath, kind: "missing" });
        continue;
      }
      throw error;
    }
    if (stats.isSymbolicLink()) {
      records.push({ relativePath, kind: "symlink", value: await fs.readlink(absolutePath) });
    } else if (stats.isFile()) {
      records.push({ relativePath, kind: "file" });
      regularFiles.push(relativePath);
    } else {
      records.push({ relativePath, kind: `other:${stats.mode}` });
    }
  }
  const objectIds = hashGitWorktreeFiles(root, regularFiles);
  let objectIndex = 0;
  for (const record of records) {
    hash.update(record.relativePath.replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(record.kind);
    hash.update("\0");
    if (record.kind === "file") {
      hash.update(objectIds[objectIndex]);
      hash.update("\0");
      objectIndex += 1;
    } else if (record.value !== undefined) {
      hash.update(record.value);
      hash.update("\0");
    }
  }
  return hash.digest("hex");
}

function hashGitWorktreeFiles(root, relativePaths) {
  if (relativePaths.length === 0) return [];
  if (relativePaths.some((relativePath) => /[\r\n]/.test(relativePath))) {
    throw new Error("Benchmark worktree paths containing newlines are unsupported.");
  }
  const input = Buffer.from(`${relativePaths.join("\n")}\n`, "utf-8");
  const output = String(runGit(root, ["hash-object", "--stdin-paths"], input)).trim();
  const objectIds = output ? output.split(/\r?\n/) : [];
  if (objectIds.length !== relativePaths.length
    || objectIds.some((objectId) => !/^[0-9a-f]{40,64}$/i.test(objectId))) {
    throw new Error("Benchmark worktree Git blob identity is incomplete.");
  }
  return objectIds;
}

function compareRepositoryPaths(left, right) {
  return Buffer.compare(Buffer.from(left, "utf-8"), Buffer.from(right, "utf-8"));
}

function normalizeTextLineEndings(value) {
  return Buffer.from(String(value).replaceAll("\r\n", "\n"), "utf-8");
}

function readFiniteNonNegativeRate(value) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= 0 ? rate : undefined;
}

function isSafeRuntimeName(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value);
}

function splitNull(value) {
  return String(value).split("\0").filter(Boolean);
}

function runGit(cwd, args, input) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "buffer",
    ...(input === undefined ? {} : { input }),
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(String(result.stderr ?? `git ${args[0]} failed with status ${result.status}.`).trim());
  }
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? "");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sameJsonObject(left, right) {
  return stableJson(left) === stableJson(right);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}
