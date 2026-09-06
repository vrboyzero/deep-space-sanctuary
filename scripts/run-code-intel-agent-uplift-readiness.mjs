import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  hashCanonicalText,
  resolveCodingAgentBenchmarkContract,
} from "./coding-agent-benchmark-contract.mjs";
import { validateCodingAgentBenchmarkV3Manifest } from "./coding-agent-benchmark-v3-contract.mjs";
import {
  evaluateCodingAgentBenchmarkV3SnapshotPreflight,
  validateCodingAgentBenchmarkV3SnapshotReceipt,
} from "./coding-agent-benchmark-v3-fixtures.mjs";

export const CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID = "code-intel-semantic-live-v1";
export const CODE_INTEL_AGENT_UPLIFT_READINESS_VERSION = "code-intel-agent-uplift-readiness/v1";
export const CODE_INTEL_AGENT_UPLIFT_GATE_SHA256 =
  "ce6eede224887cfb8e4ee2a5b64181c86500fb42c29504faedf12b87658560cf";
export const CODE_INTEL_AGENT_UPLIFT_TASK_IDS = Object.freeze([
  "real-ts.api-migration",
  "real-ts.cross-package-refactor",
  "real-js.bug-fix",
  "real-js.failed-test-fix",
]);

const SUPPORTED_PROFILE_MODES = new Set(["workspace-write", "command-control"]);
const REQUIRED_REPOSITORY_IDS = Object.freeze(["express", "vscode-languageserver-node"]);
const SUPPORTED_TASK_MANIFEST_SHA256 = new Set([
  "e8bea4cbbde7e3cd3b3714c6b37a2e014f82b37f8ef2229dfe6f9a9c0235e843",
  "dfaf7ebecaa3f6109e3427670b53b23606fae19535e00abf64212c6090daa1ba",
  "305692903ce117ccc24d4345a3ddfb6181851d7144b8059cd38e8cefbbf62352",
  "9039313b6b193cd12ae63bbb92aa55a79db76c07e2f68953c146a9629a67c1ea",
  "8c8b249e3647c10124f2198d06ee59e1a3656f56c0322cf9639e6baaa9c876f3",
  // 2026-09-06 用户授权的合同变更：real-go.public-api-migration 增加 layerGateLane=canary；
  // 对照四任务与仓库真值未变，仅重核对新增完整摘要。
  "aed0bcd54af52560fc16fb2fd2ddd07e49cd8c338e86f52ab1a6d6e4731006dd",
]);
const SOURCE_IDENTITY_PATHS = Object.freeze([
  "scripts/run-code-intel-agent-uplift-readiness.mjs",
  "scripts/run-coding-agent-ci.mjs",
  "scripts/run-coding-agent-benchmark.mjs",
  "scripts/coding-agent-benchmark-contract.mjs",
  "packages/belldandy-core/src/bin/gateway-main.ts",
  "packages/belldandy-skills/src/executor.ts",
  "packages/belldandy-skills/src/builtin/code-intel.ts",
  "packages/belldandy-skills/src/code-intel/code-intel.ts",
  "packages/belldandy-skills/src/code-intel/typescript-provider.ts",
]);
const RUNTIME_IDENTITY_PATHS = Object.freeze([
  "packages/belldandy-core/dist/bin/bdd.js",
  "packages/belldandy-core/dist/bin/gateway-main.js",
  "packages/belldandy-skills/dist/executor.js",
  "packages/belldandy-skills/dist/builtin/code-intel.js",
  "packages/belldandy-skills/dist/code-intel/code-intel.js",
  "packages/belldandy-skills/dist/code-intel/typescript-provider.js",
]);
const scriptPath = fileURLToPath(import.meta.url);
const defaultSourceRoot = path.resolve(path.dirname(scriptPath), "..");

export function isCodeIntelAgentUpliftTaskManifestSupported(sha256) {
  // 当前清单的四个对照任务及仓库真值未变；仅接受已核对的完整摘要，未知漂移仍拒绝。
  return SUPPORTED_TASK_MANIFEST_SHA256.has(sha256);
}

export function buildCodeIntelAgentUpliftCandidateProfile(baseProfile, mode) {
  if (!SUPPORTED_PROFILE_MODES.has(mode)) {
    throw new Error("CodeIntel uplift candidate requires v3 workspace-write or command-control mode.");
  }
  if (!baseProfile || typeof baseProfile !== "object" || Array.isArray(baseProfile)) {
    throw new Error("CodeIntel uplift candidate requires a frozen base profile.");
  }
  if (!Array.isArray(baseProfile.toolAllow) || !Array.isArray(baseProfile.toolDeny)) {
    throw new Error("CodeIntel uplift candidate requires frozen toolAllow and toolDeny arrays.");
  }
  if (baseProfile.toolAllow.includes("code_intel") || baseProfile.toolDeny.includes("code_intel")) {
    throw new Error("CodeIntel uplift candidate base profile must not mention code_intel.");
  }
  return {
    ...structuredClone(baseProfile),
    toolAllow: [...baseProfile.toolAllow, "code_intel"],
  };
}

export async function runCodeIntelAgentUpliftReadiness(input, dependencies = {}) {
  const platform = requireRuntimePlatform(input?.platform, dependencies.runtimePlatform);
  const sourceRoot = path.resolve(requireText(input?.sourceRoot ?? defaultSourceRoot, "sourceRoot"));
  const repositoryConfigPath = path.resolve(requireText(
    input?.repositoryConfigPath,
    "repositoryConfigPath",
  ));
  const outputRoot = path.resolve(requireText(input?.outputRoot, "outputRoot"));
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  await Promise.all([
    assertDirectory(sourceRoot, "sourceRoot"),
    assertPathAbsent(outputRoot, "output root"),
  ]);

  const gatePath = path.join(sourceRoot, "benchmarks/code-intel/v1/agent-uplift-gate.json");
  const manifestPath = path.join(sourceRoot, "benchmarks/coding-agent/v3/task-manifest.json");
  const truthSetPath = path.join(sourceRoot, "benchmarks/code-intel/v1/truth-set.json");
  const [gateSource, manifestSource, truthSetSource] = await Promise.all([
    readJsonSource(gatePath, "Agent uplift Gate"),
    readJsonSource(manifestPath, "v3 task manifest"),
    readJsonSource(truthSetPath, "CodeIntel truth set"),
  ]);
  validateCodingAgentBenchmarkV3Manifest(manifestSource.value);
  validateFrozenGate(gateSource, manifestSource, truthSetSource);

  const contract = resolveCodingAgentBenchmarkContract("v3");
  const profileBindings = [...SUPPORTED_PROFILE_MODES].map((mode) => {
    const baseline = structuredClone(contract.executionProfiles[mode]);
    return {
      mode,
      baseline,
      candidate: buildCodeIntelAgentUpliftCandidateProfile(baseline, mode),
      differences: [{ path: "toolAllow", operation: "append", value: "code_intel" }],
    };
  });
  const pairMatrix = buildPairMatrix(gateSource.value, manifestSource.value);
  const repositoryInputs = await loadPreparedRepositoryInputs(
    repositoryConfigPath,
    manifestSource.value,
    dependencies.verifyRepositoryInput,
  );
  const repositoryById = new Map(repositoryInputs.repositories.map((entry) => [
    entry.repositoryId,
    entry,
  ]));
  const preparedPairs = pairMatrix
    .filter((pair) => pair.platform === platform)
    .map((pair) => ({
      ...pair,
      receiptSha256: repositoryById.get(pair.repositoryId).receiptSha256,
    }));
  const [sourceIdentity, runtimeIdentity] = await Promise.all([
    hashIdentityFiles(sourceRoot, SOURCE_IDENTITY_PATHS),
    hashIdentityFiles(sourceRoot, RUNTIME_IDENTITY_PATHS),
  ]);

  const report = {
    schemaVersion: CODE_INTEL_AGENT_UPLIFT_READINESS_VERSION,
    generatedAt,
    status: "ready_for_authorization",
    platform,
    candidateId: CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID,
    gate: {
      id: gateSource.value.id,
      path: "benchmarks/code-intel/v1/agent-uplift-gate.json",
      sha256: gateSource.sha256,
    },
    taskManifest: {
      schemaVersion: manifestSource.value.schemaVersion,
      path: "benchmarks/coding-agent/v3/task-manifest.json",
      sha256: manifestSource.sha256,
    },
    truthSet: {
      id: truthSetSource.value.id,
      path: "benchmarks/code-intel/v1/truth-set.json",
      sha256: truthSetSource.sha256,
    },
    repositoryInputs: {
      schemaVersion: repositoryInputs.schemaVersion,
      sha256: repositoryInputs.sha256,
    },
    sourceIdentity,
    runtimeIdentity,
    profileBindings,
    pairMatrix,
    preparedPairs,
    repositories: repositoryInputs.repositories.map(({ repositoryRoot, dependencyCacheRoot, ...entry }) => ({
      ...entry,
      directories: {
        repositoryRoot: repositoryRoot ? "available" : "missing",
        dependencyCacheRoot: dependencyCacheRoot ? "available" : "missing",
      },
    })),
    authorization: {
      status: "pending_explicit_user_authorization",
      providerAuthorizationRequired: true,
      previousP0AuthorizationApplicable: false,
      credentialsRead: false,
    },
    execution: {
      mode: "dry-run",
      gatewayCalls: 0,
      modelCalls: 0,
      paidProviderCalls: 0,
      codeIntelProviderQueries: 0,
      networkCalls: 0,
      hostCommandToolCalls: 0,
      credentialsRead: false,
      productionWorkspaceMutations: 0,
    },
  };

  await fs.mkdir(path.dirname(outputRoot), { recursive: true });
  await fs.mkdir(outputRoot);
  await fs.writeFile(
    path.join(outputRoot, "agent-uplift-readiness.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { encoding: "utf-8", flag: "wx" },
  );
  return report;
}

export function compareCodeIntelAgentUpliftReadinessReports(windowsReport, wslReport) {
  const failures = [];
  if (windowsReport?.platform !== "windows-native" || wslReport?.platform !== "wsl2-linux") {
    failures.push("platform_pair_mismatch");
  }
  compareJsonField(failures, "gate_identity_mismatch", windowsReport?.gate, wslReport?.gate);
  compareJsonField(
    failures,
    "task_manifest_identity_mismatch",
    windowsReport?.taskManifest,
    wslReport?.taskManifest,
  );
  compareJsonField(failures, "truth_set_identity_mismatch", windowsReport?.truthSet, wslReport?.truthSet);
  compareJsonField(
    failures,
    "source_identity_mismatch",
    windowsReport?.sourceIdentity,
    wslReport?.sourceIdentity,
  );
  compareJsonField(
    failures,
    "runtime_identity_mismatch",
    windowsReport?.runtimeIdentity,
    wslReport?.runtimeIdentity,
  );
  compareJsonField(
    failures,
    "profile_binding_mismatch",
    windowsReport?.profileBindings,
    wslReport?.profileBindings,
  );
  compareJsonField(failures, "pair_matrix_mismatch", windowsReport?.pairMatrix, wslReport?.pairMatrix);
  compareJsonField(
    failures,
    "repository_source_identity_mismatch",
    summarizeRepositorySourceIdentities(windowsReport?.repositories),
    summarizeRepositorySourceIdentities(wslReport?.repositories),
  );
  return { passed: failures.length === 0, failures };
}

function buildPairMatrix(gate, manifest) {
  const tasks = new Map(manifest.tasks.map((task) => [task.id, task]));
  const matrix = [];
  for (const platform of gate.pairedRuns.platforms) {
    for (const cohortEntry of gate.cohort) {
      const task = tasks.get(cohortEntry.taskId);
      matrix.push({
        pairId: `${cohortEntry.taskId}:${platform}:a1`,
        platform,
        attempt: 1,
        taskId: cohortEntry.taskId,
        repositoryId: cohortEntry.repositoryId,
        executionProfile: cohortEntry.executionProfile,
        promptSha256: sha256(task.prompt),
        baseline: {
          cellId: `${cohortEntry.taskId}:${platform}:a1:baseline`,
          profileSource: gate.pairedRuns.baselineProfileSource,
        },
        candidate: {
          cellId: `${cohortEntry.taskId}:${platform}:a1:candidate`,
          profileId: gate.pairedRuns.candidateProfileId,
        },
      });
    }
  }
  return matrix;
}

async function loadPreparedRepositoryInputs(configPath, manifest, injectedVerifier) {
  const source = await readJsonSource(configPath, "repository input config");
  const config = source.value;
  if (config?.schemaVersion !== "coding-agent-benchmark-repository-inputs/v1"
    || !Array.isArray(config.repositories)) {
    throw new Error("CodeIntel uplift repository input config is invalid.");
  }
  const entries = new Map();
  for (const entry of config.repositories) {
    assertExactKeys(entry, [
      "repositoryId",
      "repositoryRoot",
      "dependencyCacheRoot",
      "receiptPath",
    ], "repository input entry");
    if (!REQUIRED_REPOSITORY_IDS.includes(entry.repositoryId) || entries.has(entry.repositoryId)) {
      throw new Error("CodeIntel uplift repository inputs must contain each required repository once.");
    }
    const repositoryRoot = path.resolve(path.dirname(configPath), requireText(entry.repositoryRoot, "repositoryRoot"));
    const dependencyCacheRoot = path.resolve(
      path.dirname(configPath),
      requireText(entry.dependencyCacheRoot, "dependencyCacheRoot"),
    );
    const receiptSource = await readJsonSource(
      path.resolve(path.dirname(configPath), requireText(entry.receiptPath, "receiptPath")),
      `${entry.repositoryId} receipt`,
    );
    validateCodingAgentBenchmarkV3SnapshotReceipt(manifest, receiptSource.value);
    if (receiptSource.value.repositoryId !== entry.repositoryId) {
      throw new Error(`CodeIntel uplift repository receipt binding drifted for ${entry.repositoryId}.`);
    }
    await Promise.all([
      assertDirectory(repositoryRoot, `${entry.repositoryId} repositoryRoot`),
      assertDirectory(dependencyCacheRoot, `${entry.repositoryId} dependencyCacheRoot`),
    ]);
    const receipt = receiptSource.value;
    const task = manifest.tasks.find((candidate) => (
      CODE_INTEL_AGENT_UPLIFT_TASK_IDS.includes(candidate.id)
      && candidate.repositoryId === entry.repositoryId
    ));
    const verifyRepositoryInput = injectedVerifier
      ?? (async (verificationInput) => await evaluateCodingAgentBenchmarkV3SnapshotPreflight(
        verificationInput,
      ));
    const preflight = await verifyRepositoryInput({
      manifest,
      taskId: task?.id,
      repositoryRoot,
      dependencyCacheRoot,
      receipt,
      executionNetwork: "disabled",
    });
    if (preflight?.status !== "passed") {
      throw new Error(`CodeIntel uplift repository preflight failed for ${entry.repositoryId}.`);
    }
    entries.set(entry.repositoryId, {
      repositoryId: entry.repositoryId,
      repositoryRoot,
      dependencyCacheRoot,
      receiptSha256: receiptSource.sha256,
      source: structuredClone(receipt.source),
      license: structuredClone(receipt.license),
      dependencyCache: structuredClone(receipt.dependencyCache),
      policy: structuredClone(receipt.policy),
      preflight: { status: "passed", taskId: task.id },
    });
  }
  if (entries.size !== REQUIRED_REPOSITORY_IDS.length
    || REQUIRED_REPOSITORY_IDS.some((repositoryId) => !entries.has(repositoryId))) {
    throw new Error("CodeIntel uplift repository inputs must contain express and vscode-languageserver-node.");
  }
  return {
    schemaVersion: config.schemaVersion,
    sha256: source.sha256,
    repositories: REQUIRED_REPOSITORY_IDS.map((repositoryId) => entries.get(repositoryId)),
  };
}

function validateFrozenGate(gateSource, manifestSource, truthSetSource) {
  const gate = gateSource.value;
  if (gate?.schemaVersion !== "code-intel-agent-uplift-gate/v1"
    || gate.id !== "p1-a1-ts-js-agent-uplift-v1"
    || gate.pairedRuns?.candidateProfileId !== CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID
    || gate.pairedRuns?.onlyAllowedCandidateDifference !== "append-code_intel-to-toolAllow"
    || gate.pairedRuns?.totalPairs !== 8
    || JSON.stringify(gate.pairedRuns?.platforms) !== JSON.stringify(["windows-native", "wsl2-linux"])
    || JSON.stringify(gate.cohort?.map((entry) => entry.taskId))
      !== JSON.stringify(CODE_INTEL_AGENT_UPLIFT_TASK_IDS)) {
    throw new Error("CodeIntel Agent uplift Gate drifted from the frozen readiness contract.");
  }
  if (gateSource.sha256 !== CODE_INTEL_AGENT_UPLIFT_GATE_SHA256) {
    throw new Error("CodeIntel Agent uplift Gate identity drift.");
  }
  if (!isCodeIntelAgentUpliftTaskManifestSupported(manifestSource.sha256)) {
    throw new Error("CodeIntel uplift task manifest identity drift.");
  }
  if (gate.sourceIdentity?.truthSet?.sha256 !== truthSetSource.sha256) {
    throw new Error("CodeIntel uplift truth set identity drift.");
  }
  const manifestTasks = new Map(manifestSource.value.tasks.map((task) => [task.id, task]));
  for (const entry of gate.cohort) {
    const task = manifestTasks.get(entry.taskId);
    if (!task
      || task.repositoryId !== entry.repositoryId
      || task.executionProfile !== entry.executionProfile) {
      throw new Error(`CodeIntel uplift task binding drift for ${entry.taskId}.`);
    }
  }
}

async function hashIdentityFiles(sourceRoot, relativePaths) {
  const files = [];
  for (const relativePath of relativePaths) {
    const resolved = resolveInside(sourceRoot, relativePath);
    files.push({
      path: relativePath,
      sha256: hashCanonicalText(await fs.readFile(resolved, "utf-8")),
    });
  }
  return { files, aggregateSha256: sha256(JSON.stringify(files)) };
}

function summarizeRepositorySourceIdentities(repositories) {
  if (!Array.isArray(repositories)) return null;
  return repositories.map((repository) => ({
    repositoryId: repository.repositoryId,
    source: repository.source,
    policy: repository.policy,
  }));
}

function compareJsonField(failures, code, left, right) {
  if (JSON.stringify(left) !== JSON.stringify(right)) failures.push(code);
}

async function readJsonSource(target, label) {
  let text;
  try {
    text = await fs.readFile(target, "utf-8");
  } catch (error) {
    throw new Error(`CodeIntel uplift ${label} is unavailable: ${safeMessage(error)}.`);
  }
  try {
    return { value: JSON.parse(text), sha256: hashCanonicalText(text) };
  } catch {
    throw new Error(`CodeIntel uplift ${label} is invalid JSON.`);
  }
}

function assertExactKeys(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`CodeIntel uplift ${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`CodeIntel uplift ${label} fields drifted.`);
  }
}

async function assertDirectory(target, label) {
  const stats = await fs.stat(target).catch(() => null);
  if (!stats?.isDirectory()) throw new Error(`CodeIntel uplift ${label} must be a directory.`);
}

async function assertPathAbsent(target, label) {
  const stats = await fs.lstat(target).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (stats) throw new Error(`CodeIntel uplift ${label} already exists.`);
}

function resolveInside(root, relativePath) {
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("CodeIntel uplift identity path escapes sourceRoot.");
  }
  return resolved;
}

function requireRuntimePlatform(value, injectedPlatform) {
  if (value !== "windows-native" && value !== "wsl2-linux") {
    throw new Error("CodeIntel uplift platform must be windows-native or wsl2-linux.");
  }
  const actual = injectedPlatform ?? (process.platform === "win32" ? "windows-native" : "wsl2-linux");
  if (value !== actual) {
    throw new Error(`CodeIntel uplift platform mismatch: expected ${actual}, received ${value}.`);
  }
  return value;
}

function requireIsoTimestamp(value) {
  const timestamp = requireText(value, "generatedAt");
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error("CodeIntel uplift generatedAt must be an ISO timestamp.");
  }
  return timestamp;
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`CodeIntel uplift requires ${label}.`);
  }
  return value.trim();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

export function parseCodeIntelAgentUpliftReadinessCliArguments(argv) {
  const values = new Map();
  const supported = new Set([
    "--platform",
    "--source-root",
    "--repository-config",
    "--output-root",
    "--generated-at",
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!supported.has(flag) || !value || value.startsWith("--") || values.has(flag)) {
      throw new Error(`Invalid CodeIntel uplift readiness argument near ${String(flag)}.`);
    }
    values.set(flag, value);
  }
  return {
    platform: requireText(values.get("--platform"), "--platform"),
    sourceRoot: path.resolve(values.get("--source-root") ?? defaultSourceRoot),
    repositoryConfigPath: path.resolve(requireText(
      values.get("--repository-config"),
      "--repository-config",
    )),
    outputRoot: path.resolve(requireText(values.get("--output-root"), "--output-root")),
    ...(values.has("--generated-at") ? { generatedAt: values.get("--generated-at") } : {}),
  };
}

async function main() {
  const report = await runCodeIntelAgentUpliftReadiness(
    parseCodeIntelAgentUpliftReadinessCliArguments(process.argv.slice(2)),
  );
  console.log(
    `[code-intel-agent-uplift-readiness] ${report.platform} ${report.status}; preparedPairs=${report.preparedPairs.length}`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(scriptPath)) {
  main().catch((error) => {
    console.error(`[code-intel-agent-uplift-readiness] failed: ${safeMessage(error)}`);
    process.exitCode = 1;
  });
}
