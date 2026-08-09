import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadCodingAgentBenchmarkManifest,
  resolveCodingAgentBenchmarkManifestPath,
} from "./coding-agent-benchmark-contract.mjs";
import {
  evaluateCodingAgentBenchmarkV3SnapshotPreflight,
  inspectCodingAgentBenchmarkV3RepositorySnapshotIdentity,
  inspectCodingAgentBenchmarkV3SnapshotPreparation,
} from "./coding-agent-benchmark-v3-fixtures.mjs";

export const CODING_AGENT_BENCHMARK_LINUX_SNAPSHOT_PREPARATION_VERSION =
  "coding-agent-benchmark-linux-snapshot-preparation/v1";

const REPOSITORY_INPUTS_VERSION = "coding-agent-benchmark-repository-inputs/v1";
const NPM_ARGUMENTS = Object.freeze([
  "ci",
  "--offline",
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
  "--update-notifier=false",
]);
const NPM_LOCK_ARGUMENTS = Object.freeze([
  "install",
  "--package-lock-only",
  "--offline",
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
  "--update-notifier=false",
]);
const COMMAND_TIMEOUT_MS = 300_000;
const MAX_COMMAND_OUTPUT_BYTES = 4 * 1024 * 1024;
const scriptPath = fileURLToPath(import.meta.url);

export async function prepareCodingAgentBenchmarkV3LinuxSnapshots(input, dependencies = {}) {
  const manifest = requireManifest(input?.manifest);
  const preparedAt = requireIsoTimestamp(input?.preparedAt, "preparedAt");
  const outputRoot = path.resolve(requireString(input?.outputRoot, "outputRoot"));
  const sourceRoots = requireSourceRoots(input?.sourceRoots, manifest);
  const npmCacheRoot = path.resolve(requireString(input?.npmCacheRoot, "npmCacheRoot"));
  const dependencySeedRoots = resolveOptionalRootMap(input?.dependencySeedRoots, manifest);
  const goModuleCacheRoot = input?.goModuleCacheRoot
    ? path.resolve(requireString(input.goModuleCacheRoot, "goModuleCacheRoot"))
    : null;

  await assertPathAbsent(outputRoot, "outputRoot");
  await Promise.all([
    ...Object.entries(sourceRoots).map(([repositoryId, root]) => (
      assertDirectory(root, `sourceRoots.${repositoryId}`)
    )),
    assertDirectory(npmCacheRoot, "npmCacheRoot"),
  ]);
  assertPreparationRootsDisjoint({
    outputRoot,
    sourceRoots,
    npmCacheRoot,
    dependencySeedRoots,
    goModuleCacheRoot,
  });

  const inspectEnvironment = dependencies.inspectEnvironment ?? inspectLinuxPreparationEnvironment;
  const environment = await inspectEnvironment();
  if (environment?.platform?.os !== "linux" || environment?.platform?.id !== "wsl2-linux") {
    throw new Error("Coding benchmark Linux snapshot preparation must run on Linux/WSL2.");
  }

  const stageRoot = path.join(
    path.dirname(outputRoot),
    `.${path.basename(outputRoot)}.stage-${crypto.randomUUID()}`,
  );
  await fs.mkdir(stageRoot, { recursive: false });
  try {
    const report = await prepareIntoStage({
      manifest,
      preparedAt,
      stageRoot,
      sourceRoots,
      npmCacheRoot,
      dependencySeedRoots,
      goModuleCacheRoot,
      environment,
    }, dependencies);
    await assertPathAbsent(outputRoot, "outputRoot");
    await fs.rename(stageRoot, outputRoot);
    return report;
  } catch (error) {
    await fs.rm(stageRoot, { recursive: true, force: true });
    throw error;
  }
}

async function prepareIntoStage(input, dependencies) {
  const inspectSource = dependencies.inspectSource
    ?? inspectCodingAgentBenchmarkV3RepositorySnapshotIdentity;
  const inspectSourceSeed = dependencies.inspectSourceSeed
    ?? (dependencies.inspectSource ? dependencies.inspectSource : inspectPinnedSourceSeed);
  const cloneRepository = dependencies.cloneRepository ?? clonePinnedRepository;
  const prepareDependencyCache = dependencies.prepareDependencyCache
    ?? prepareLinuxDependencyCache;
  const inspectPreparation = dependencies.inspectPreparation
    ?? inspectCodingAgentBenchmarkV3SnapshotPreparation;
  const evaluatePreflight = dependencies.evaluatePreflight
    ?? evaluateCodingAgentBenchmarkV3SnapshotPreflight;
  const policy = Object.freeze({
    preparationNetwork: "offline-local-materials-only",
    executionNetwork: "disabled",
    npmArguments: [...NPM_ARGUMENTS],
    npmLockArguments: [...NPM_LOCK_ARGUMENTS],
    outputRootMustNotExist: true,
  });

  await Promise.all([
    fs.mkdir(path.join(input.stageRoot, "sources"), { recursive: true }),
    fs.mkdir(path.join(input.stageRoot, "caches"), { recursive: true }),
    fs.mkdir(path.join(input.stageRoot, "receipts"), { recursive: true }),
    fs.mkdir(path.join(input.stageRoot, "preflights"), { recursive: true }),
    fs.mkdir(path.join(input.stageRoot, "logs"), { recursive: true }),
    fs.mkdir(path.join(input.stageRoot, ".scratch"), { recursive: true }),
  ]);

  const repositoryResults = [];
  const repositoryConfigEntries = [];
  for (const repository of input.manifest.repositories) {
    const sourceInputRoot = input.sourceRoots[repository.id];
    const sourceRoot = path.join(input.stageRoot, "sources", repository.id);
    const cacheRoot = path.join(input.stageRoot, "caches", repository.id);
    const inputIdentity = await inspectSourceSeed({ repositoryRoot: sourceInputRoot, repository });
    assertFrozenSourceSeed(repository, inputIdentity);
    await cloneRepository({
      repository,
      sourceRoot: sourceInputRoot,
      targetRoot: sourceRoot,
    });
    const clonedIdentity = await inspectSource({ repositoryRoot: sourceRoot, repository });
    assertFrozenSourceIdentity(repository, clonedIdentity, "cloned");

    const dependencyResult = await prepareDependencyCache({
      repository,
      sourceRoot,
      cacheRoot,
      npmCacheRoot: input.npmCacheRoot,
      dependencySeedRoot: input.dependencySeedRoots[repository.id] ?? null,
      goModuleCacheRoot: input.goModuleCacheRoot,
      scratchRoot: path.join(input.stageRoot, ".scratch", repository.id),
      logRoot: path.join(input.stageRoot, "logs"),
      environment: input.environment,
      policy,
    });
    assertDependencyPreparationResult(repository.id, dependencyResult);
    if (dependencyResult.status === "blocked") {
      await fs.rm(cacheRoot, { recursive: true, force: true });
      const finalIdentity = await inspectSource({ repositoryRoot: sourceRoot, repository });
      assertSameSourceContent(repository, clonedIdentity, finalIdentity);
      repositoryResults.push(createBlockedRepositoryResult(
        repository,
        dependencyResult,
        input.stageRoot,
        sourceRoot,
        finalIdentity,
      ));
      continue;
    }

    const finalIdentity = await inspectSource({ repositoryRoot: sourceRoot, repository });
    assertFrozenSourceIdentity(repository, finalIdentity, "prepared");
    assertSameSourceContent(repository, clonedIdentity, finalIdentity);
    const receipt = await inspectPreparation({
      manifest: input.manifest,
      repositoryId: repository.id,
      repositoryRoot: sourceRoot,
      dependencyCacheRoot: cacheRoot,
      preparedAt: input.preparedAt,
    });
    const receiptPath = path.join(input.stageRoot, "receipts", `${repository.id}.json`);
    await writeJsonExclusive(receiptPath, receipt);

    const preflightPaths = [];
    for (const task of input.manifest.tasks.filter((candidate) => (
      candidate.layer === "B" && candidate.repositoryId === repository.id
    ))) {
      const preflight = await evaluatePreflight({
        manifest: input.manifest,
        taskId: task.id,
        repositoryRoot: sourceRoot,
        dependencyCacheRoot: cacheRoot,
        receipt,
        executionNetwork: "disabled",
      });
      if (preflight?.status !== "passed") {
        throw new Error(
          `Coding benchmark Linux snapshot preflight failed for ${task.id}: ${preflight?.reason ?? "unknown"}.`,
        );
      }
      const preflightPath = path.join(input.stageRoot, "preflights", `${task.id}.json`);
      await writeJsonExclusive(preflightPath, preflight);
      preflightPaths.push(toPortableRelativePath(input.stageRoot, preflightPath));
    }

    const repositoryResult = {
      repositoryId: repository.id,
      status: "ready",
      blocker: null,
      sourceRoot: toPortableRelativePath(input.stageRoot, sourceRoot),
      dependencyCacheRoot: toPortableRelativePath(input.stageRoot, cacheRoot),
      receiptPath: toPortableRelativePath(input.stageRoot, receiptPath),
      preflightPaths,
      source: {
        url: finalIdentity.sourceUrl,
        commit: finalIdentity.commit,
        worktreeContentSha256: finalIdentity.worktreeContentSha256,
        dependencyInputsSha256: finalIdentity.dependencyInputsSha256,
      },
      provenance: dependencyResult.provenance,
    };
    repositoryResults.push(repositoryResult);
    repositoryConfigEntries.push({
      repositoryId: repository.id,
      repositoryRoot: repositoryResult.sourceRoot,
      dependencyCacheRoot: repositoryResult.dependencyCacheRoot,
      receiptPath: repositoryResult.receiptPath,
    });
  }

  let repositoryConfigPath = null;
  if (repositoryConfigEntries.length > 0) {
    repositoryConfigPath = "repository-inputs.json";
    await writeJsonExclusive(path.join(input.stageRoot, repositoryConfigPath), {
      schemaVersion: REPOSITORY_INPUTS_VERSION,
      repositories: repositoryConfigEntries,
    });
  }
  const ready = repositoryResults.filter((result) => result.status === "ready").length;
  const blocked = repositoryResults.length - ready;
  const report = {
    schemaVersion: CODING_AGENT_BENCHMARK_LINUX_SNAPSHOT_PREPARATION_VERSION,
    status: blocked === 0 ? "ready" : ready > 0 ? "partial" : "blocked",
    preparedAt: input.preparedAt,
    manifest: {
      schemaVersion: input.manifest.schemaVersion,
      contentSha256: sha256(Buffer.from(JSON.stringify(input.manifest), "utf-8")),
    },
    platform: input.environment.platform,
    toolchain: input.environment.toolchain,
    policy,
    repositoryConfigPath,
    summary: { ready, blocked },
    repositories: repositoryResults,
  };
  await fs.rm(path.join(input.stageRoot, ".scratch"), { recursive: true, force: true });
  await writeJsonExclusive(
    path.join(input.stageRoot, "linux-snapshot-preparation.json"),
    report,
  );
  return report;
}

async function inspectLinuxPreparationEnvironment() {
  const wslDistribution = process.env.WSL_DISTRO_NAME?.trim() || null;
  const platform = {
    id: process.platform === "linux" && wslDistribution
      ? "wsl2-linux"
      : process.platform === "win32"
        ? "windows-native"
        : "unsupported",
    os: process.platform,
    arch: process.arch,
    distribution: wslDistribution,
    ...(process.platform === "linux"
      ? { libc: detectCodingAgentBenchmarkLinuxLibc() }
      : {}),
  };
  return {
    platform,
    toolchain: {
      node: process.version,
      npm: runVersionCommand("npm", ["--version"], true),
      git: runVersionCommand("git", ["--version"], true),
      go: runVersionCommand("go", ["version"], false),
    },
  };
}

async function clonePinnedRepository(input) {
  runRequiredCommand("git", [
    "clone",
    "--no-hardlinks",
    "--no-checkout",
    "--quiet",
    input.sourceRoot,
    input.targetRoot,
  ], { cwd: path.dirname(input.targetRoot) });
  runRequiredCommand("git", [
    "checkout",
    "--detach",
    "--quiet",
    input.repository.source.commit,
  ], { cwd: input.targetRoot });
  runRequiredCommand("git", [
    "remote",
    "set-url",
    "origin",
    input.repository.source.url,
  ], { cwd: input.targetRoot });
}

function inspectPinnedSourceSeed(input) {
  const sourceUrl = String(runRequiredCommand("git", [
    "config",
    "--get",
    "remote.origin.url",
  ], { cwd: input.repositoryRoot }).stdout).trim();
  const commit = String(runRequiredCommand("git", [
    "rev-parse",
    "HEAD",
  ], { cwd: input.repositoryRoot }).stdout).trim();
  runRequiredCommand("git", [
    "cat-file",
    "-e",
    `${input.repository.source.commit}^{commit}`,
  ], { cwd: input.repositoryRoot });
  return { sourceUrl, commit };
}

async function prepareLinuxDependencyCache(input) {
  if (input.repository.languageEcosystem === "go") {
    return await prepareGoDependencyCache(input);
  }
  return await prepareNodeDependencyCache(input);
}

async function prepareNodeDependencyCache(input) {
  const packageJsonPath = path.join(input.sourceRoot, "package.json");
  const packageLockPath = path.join(input.sourceRoot, "package-lock.json");
  const packageJson = await readJson(packageJsonPath, `${input.repository.id} package.json`);
  let dependencySeedSha256 = null;
  let derivedLock = false;
  let lock;
  try {
    lock = await readJson(packageLockPath, `${input.repository.id} package-lock.json`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const seedPath = input.dependencySeedRoot
      ? path.join(input.dependencySeedRoot, "node_modules", ".package-lock.json")
      : null;
    const seed = seedPath ? await readJsonIfExists(seedPath) : null;
    if (!seed) {
      return blockedDependency("pinned_dependency_lock_unavailable", "package-lock.json and exact seed lock are unavailable", {
        packageManager: "npm",
        dependencyLockSha256: null,
        dependencySeedSha256: null,
      });
    }
    const seedContent = await fs.readFile(seedPath);
    dependencySeedSha256 = sha256(seedContent);
    await fs.copyFile(seedPath, packageLockPath);
    const lockResult = await runNpm(input, NPM_LOCK_ARGUMENTS, "lock");
    if (lockResult.status !== 0) {
      await fs.rm(packageLockPath, { force: true });
      return blockedDependency("offline_dependency_lock_failed", summarizeCommandFailure(lockResult), {
        packageManager: "npm",
        dependencyLockSha256: null,
        dependencySeedSha256,
      });
    }
    lock = await readJson(packageLockPath, `${input.repository.id} derived package-lock.json`);
    if (!samePinnedPackages(seed, lock) || !derivedLockMatchesPackageJson(lock, packageJson)) {
      await fs.rm(packageLockPath, { force: true });
      return blockedDependency("derived_dependency_lock_drift", "derived package-lock changed the exact seed package set", {
        packageManager: "npm",
        dependencyLockSha256: null,
        dependencySeedSha256,
      });
    }
    derivedLock = true;
  }

  const dependencyLockSha256 = sha256(await fs.readFile(packageLockPath));
  await fs.rm(path.join(input.sourceRoot, "node_modules"), { recursive: true, force: true });
  const installResult = await runNpm(input, NPM_ARGUMENTS, "install");
  if (installResult.status !== 0) {
    await fs.rm(path.join(input.sourceRoot, "node_modules"), { recursive: true, force: true });
    if (derivedLock) await fs.rm(packageLockPath, { force: true });
    return blockedDependency("offline_dependency_cache_incomplete", summarizeCommandFailure(installResult), {
      packageManager: "npm",
      dependencyLockSha256,
      dependencySeedSha256,
    });
  }

  const platformProblem = await inspectCodingAgentBenchmarkLinuxPlatformDependencies({
    lock,
    nodeModulesRoot: path.join(input.sourceRoot, "node_modules"),
    os: "linux",
    arch: input.environment.platform.arch,
    libc: input.environment.platform.libc,
  });
  if (platformProblem) {
    await fs.rm(path.join(input.sourceRoot, "node_modules"), { recursive: true, force: true });
    if (derivedLock) await fs.rm(packageLockPath, { force: true });
    return blockedDependency(platformProblem.code, platformProblem.detail, {
      packageManager: "npm",
      dependencyLockSha256,
      dependencySeedSha256,
    });
  }

  await fs.mkdir(input.cacheRoot, { recursive: false });
  await fs.rename(
    path.join(input.sourceRoot, "node_modules"),
    path.join(input.cacheRoot, "node_modules"),
  );
  if (derivedLock) await fs.rm(packageLockPath, { force: true });
  const cacheKey = createCacheKey(input.repository, input.environment, "npm");
  await fs.writeFile(
    path.join(input.cacheRoot, ".coding-benchmark-cache-key"),
    `${cacheKey}\n`,
    { encoding: "utf-8", flag: "wx" },
  );
  return {
    status: "ready",
    blocker: null,
    provenance: {
      packageManager: "npm",
      dependencyLockSha256,
      dependencySeedSha256,
    },
  };
}

async function prepareGoDependencyCache(input) {
  const lockContent = Buffer.concat([
    await fs.readFile(path.join(input.sourceRoot, "go.mod")),
    Buffer.from("\0", "utf-8"),
    await fs.readFile(path.join(input.sourceRoot, "go.sum")),
  ]);
  const provenance = {
    packageManager: "go",
    dependencyLockSha256: sha256(lockContent),
    dependencySeedSha256: null,
  };
  if (!input.environment.toolchain.go) {
    return blockedDependency("go_toolchain_unavailable", "go is not available in PATH", provenance);
  }
  if (!input.goModuleCacheRoot) {
    return blockedDependency("go_module_cache_seed_unavailable", "an offline Go module cache seed is required", provenance);
  }
  await assertDirectory(input.goModuleCacheRoot, "goModuleCacheRoot");
  provenance.dependencySeedSha256 = await hashDirectoryPortable(input.goModuleCacheRoot);
  await fs.mkdir(input.cacheRoot, { recursive: false });
  const moduleCacheRoot = path.join(input.cacheRoot, "gomodcache");
  await fs.cp(input.goModuleCacheRoot, moduleCacheRoot, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    force: false,
  });
  await fs.mkdir(input.scratchRoot, { recursive: true });
  const goEnvironment = {
    ...process.env,
    GOPROXY: "off",
    GOSUMDB: "off",
    GOMODCACHE: moduleCacheRoot,
    GOCACHE: path.join(input.scratchRoot, "go-build"),
    GOTMPDIR: path.join(input.scratchRoot, "go-tmp"),
    CGO_ENABLED: "0",
  };
  await Promise.all([
    fs.mkdir(goEnvironment.GOCACHE, { recursive: true }),
    fs.mkdir(goEnvironment.GOTMPDIR, { recursive: true }),
  ]);
  const downloadResult = runCommand("go", ["mod", "download", "all"], {
    cwd: input.sourceRoot,
    env: goEnvironment,
  });
  await writeCommandLog(input, "go-download", downloadResult);
  if (downloadResult.status !== 0) {
    await fs.rm(input.cacheRoot, { recursive: true, force: true });
    return blockedDependency("offline_go_module_cache_incomplete", summarizeCommandFailure(downloadResult), provenance);
  }
  const verifyResult = runCommand("go", ["mod", "verify"], {
    cwd: input.sourceRoot,
    env: goEnvironment,
  });
  await writeCommandLog(input, "go-verify", verifyResult);
  if (verifyResult.status !== 0) {
    await fs.rm(input.cacheRoot, { recursive: true, force: true });
    return blockedDependency("offline_go_module_verification_failed", summarizeCommandFailure(verifyResult), provenance);
  }
  const cacheKey = createCacheKey(input.repository, input.environment, "go");
  await fs.writeFile(
    path.join(input.cacheRoot, ".coding-benchmark-cache-key"),
    `${cacheKey}\n`,
    { encoding: "utf-8", flag: "wx" },
  );
  return { status: "ready", blocker: null, provenance };
}

async function runNpm(input, args, label) {
  const result = runCommand("npm", args, {
    cwd: input.sourceRoot,
    env: {
      ...process.env,
      npm_config_cache: input.npmCacheRoot,
      npm_config_offline: "true",
      npm_config_ignore_scripts: "true",
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_update_notifier: "false",
      npm_config_logs_dir: input.logRoot,
    },
  });
  await writeCommandLog(input, `npm-${label}`, result);
  return result;
}

export async function inspectCodingAgentBenchmarkLinuxPlatformDependencies(input) {
  const packages = Object.entries(input.lock?.packages ?? {});
  const requiresLibcIdentity = packages.some(([, descriptor]) => (
    Array.isArray(descriptor?.libc) && descriptor.libc.length > 0
  ));
  if (requiresLibcIdentity && !["glibc", "musl"].includes(input.libc)) {
    throw new Error("Coding benchmark Linux platform inspection requires glibc or musl identity.");
  }
  for (const [packagePath, descriptor] of packages) {
    if (!packagePath.startsWith("node_modules/") || !descriptor || typeof descriptor !== "object") continue;
    const matchesOs = matchesPlatformConstraint(descriptor.os, input.os);
    const matchesArch = matchesPlatformConstraint(descriptor.cpu, input.arch);
    const matchesLibc = matchesPlatformConstraint(descriptor.libc, input.libc);
    const installedPath = path.join(input.nodeModulesRoot, packagePath.slice("node_modules/".length));
    const installed = await pathExists(installedPath);
    if (matchesOs && matchesArch && matchesLibc && !installed) {
      return {
        code: "platform_dependency_missing",
        detail: `${packagePath}@${descriptor.version ?? "unknown"}`,
      };
    }
    if ((!matchesOs || !matchesArch || !matchesLibc) && installed) {
      return {
        code: "foreign_platform_dependency_present",
        detail: `${packagePath}@${descriptor.version ?? "unknown"}`,
      };
    }
  }
  return null;
}

function matchesPlatformConstraint(constraint, actual) {
  if (!Array.isArray(constraint) || constraint.length === 0) return true;
  if (constraint.includes(`!${actual}`)) return false;
  const positive = constraint.filter((item) => typeof item === "string" && !item.startsWith("!"));
  return positive.length === 0 || positive.includes(actual);
}

export function detectCodingAgentBenchmarkLinuxLibc(
  header = process.report.getReport().header,
) {
  return typeof header?.glibcVersionRuntime === "string" && header.glibcVersionRuntime.trim()
    ? "glibc"
    : "musl";
}

function samePinnedPackages(seed, derived) {
  if (!seed?.packages || !derived?.packages) return false;
  const derivedPackages = { ...derived.packages };
  delete derivedPackages[""];
  return JSON.stringify(seed.packages) === JSON.stringify(derivedPackages);
}

function derivedLockMatchesPackageJson(lock, packageJson) {
  const root = lock?.packages?.[""];
  if (!root || root.name !== packageJson.name || root.version !== packageJson.version) return false;
  for (const field of ["dependencies", "devDependencies", "engines"]) {
    if (JSON.stringify(root[field] ?? {}) !== JSON.stringify(packageJson[field] ?? {})) return false;
  }
  return true;
}

function createCacheKey(repository, environment, packageManager) {
  const toolVersion = packageManager === "go"
    ? environment.toolchain.go
    : `${environment.toolchain.node}-${environment.toolchain.npm}`;
  const portableToolVersion = String(toolVersion).replaceAll(/[^A-Za-z0-9._-]/g, "-");
  const libc = packageManager === "npm"
    ? `-${requireString(environment.platform.libc, "platform.libc")}`
    : "";
  return `${repository.id}-${repository.source.commit}-linux-${environment.platform.arch}${libc}-${packageManager}-${portableToolVersion}`;
}

function createBlockedRepositoryResult(
  repository,
  dependencyResult,
  stageRoot,
  sourceRoot,
  sourceIdentity,
) {
  return {
    repositoryId: repository.id,
    status: "blocked",
    blocker: dependencyResult.blocker,
    sourceRoot: toPortableRelativePath(stageRoot, sourceRoot),
    dependencyCacheRoot: null,
    receiptPath: null,
    preflightPaths: [],
    source: {
      url: sourceIdentity.sourceUrl,
      commit: sourceIdentity.commit,
      worktreeContentSha256: sourceIdentity.worktreeContentSha256,
      dependencyInputsSha256: sourceIdentity.dependencyInputsSha256,
    },
    provenance: dependencyResult.provenance,
  };
}

function blockedDependency(code, detail, provenance) {
  return {
    status: "blocked",
    blocker: {
      code: requireString(code, "blocker.code"),
      detail: requireString(detail, "blocker.detail").slice(0, 500),
    },
    provenance,
  };
}

function assertDependencyPreparationResult(repositoryId, result) {
  if (!result || !["ready", "blocked"].includes(result.status)) {
    throw new Error(`Coding benchmark Linux dependency adapter returned an invalid status for ${repositoryId}.`);
  }
  if (result.status === "ready" && result.blocker !== null) {
    throw new Error(`Coding benchmark Linux dependency adapter returned a blocker for ready repository ${repositoryId}.`);
  }
  if (result.status === "blocked"
    && (!result.blocker?.code || !result.blocker?.detail)) {
    throw new Error(`Coding benchmark Linux dependency adapter omitted the blocker for ${repositoryId}.`);
  }
  if (!result.provenance?.packageManager) {
    throw new Error(`Coding benchmark Linux dependency adapter omitted provenance for ${repositoryId}.`);
  }
}

function assertFrozenSourceIdentity(repository, identity, label) {
  if (identity?.sourceUrl !== repository.source.url
    || identity?.commit !== repository.source.commit
    || identity?.workspaceDirty !== false
    || identity?.licensePath !== repository.license.path) {
    throw new Error(`Coding benchmark Linux ${label} source identity drifted for ${repository.id}.`);
  }
}

function assertFrozenSourceSeed(repository, identity) {
  if (identity?.sourceUrl !== repository.source.url || identity?.commit !== repository.source.commit) {
    throw new Error(`Coding benchmark Linux input source seed drifted for ${repository.id}.`);
  }
}

function assertSameSourceContent(repository, expected, actual) {
  if (actual?.worktreeContentSha256 !== expected?.worktreeContentSha256
    || actual?.dependencyInputsSha256 !== expected?.dependencyInputsSha256
    || actual?.licenseSha256 !== expected?.licenseSha256) {
    throw new Error(`Coding benchmark Linux source content drifted for ${repository.id}.`);
  }
}

function requireManifest(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.repositories) || !Array.isArray(value.tasks)) {
    throw new Error("Coding benchmark Linux snapshot preparation requires manifest.");
  }
  return value;
}

function requireSourceRoots(value, manifest) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Coding benchmark Linux snapshot preparation requires sourceRoots.");
  }
  return Object.fromEntries(manifest.repositories.map((repository) => [
    repository.id,
    path.resolve(requireString(value[repository.id], `sourceRoots.${repository.id}`)),
  ]));
}

function resolveOptionalRootMap(value, manifest) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Coding benchmark Linux snapshot preparation dependencySeedRoots must be an object.");
  }
  return Object.fromEntries(manifest.repositories.flatMap((repository) => (
    value[repository.id]
      ? [[repository.id, path.resolve(requireString(
        value[repository.id],
        `dependencySeedRoots.${repository.id}`,
      ))]]
      : []
  )));
}

function assertPreparationRootsDisjoint(input) {
  const protectedRoots = [
    ...Object.entries(input.sourceRoots).map(([label, root]) => [`sourceRoots.${label}`, root]),
    ["npmCacheRoot", input.npmCacheRoot],
    ...Object.entries(input.dependencySeedRoots).map(([label, root]) => [
      `dependencySeedRoots.${label}`,
      root,
    ]),
    ...(input.goModuleCacheRoot ? [["goModuleCacheRoot", input.goModuleCacheRoot]] : []),
  ];
  for (const [label, root] of protectedRoots) {
    if (rootsOverlap(input.outputRoot, root)) {
      throw new Error(`Coding benchmark Linux outputRoot must be disjoint from ${label}.`);
    }
  }
}

function rootsOverlap(left, right) {
  const leftToRight = path.relative(left, right);
  const rightToLeft = path.relative(right, left);
  return !leftToRight
    || (!leftToRight.startsWith(`..${path.sep}`) && !path.isAbsolute(leftToRight))
    || (!rightToLeft.startsWith(`..${path.sep}`) && !path.isAbsolute(rightToLeft));
}

function runVersionCommand(command, args, required) {
  const result = runCommand(command, args, { cwd: process.cwd() });
  if (result.error?.code === "ENOENT" && !required) return null;
  if (result.status !== 0) {
    if (!required) return null;
    throw new Error(`Coding benchmark Linux required tool ${command} is unavailable.`);
  }
  return String(result.stdout).trim();
}

function runRequiredCommand(command, args, options) {
  const result = runCommand(command, args, options);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args[0]} failed: ${summarizeCommandFailure(result)}`);
  }
  return result;
}

function runCommand(command, args, options) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf-8",
    windowsHide: true,
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function writeCommandLog(input, label, result) {
  const content = [
    `command=${label}`,
    `status=${String(result.status)}`,
    "stdout:",
    String(result.stdout ?? ""),
    "stderr:",
    String(result.stderr ?? ""),
  ].join("\n").slice(0, MAX_COMMAND_OUTPUT_BYTES);
  await fs.writeFile(
    path.join(input.logRoot, `${input.repository.id}-${label}.log`),
    `${content}\n`,
    { encoding: "utf-8", flag: "wx" },
  );
}

function summarizeCommandFailure(result) {
  if (result.error?.code === "ETIMEDOUT") return "command timed out";
  if (result.error) return result.error.message;
  const lines = `${result.stderr ?? ""}\n${result.stdout ?? ""}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return (lines.at(-1) ?? `exit ${String(result.status)}`).slice(0, 500);
}

async function hashDirectoryPortable(root) {
  const hash = crypto.createHash("sha256");
  const pending = [""];
  while (pending.length > 0) {
    const relativeDirectory = pending.pop();
    const entries = await fs.readdir(path.join(root, relativeDirectory), { withFileTypes: true });
    entries.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
    for (const entry of entries) {
      const relativePath = path.join(relativeDirectory, entry.name);
      const portablePath = relativePath.replaceAll("\\", "/");
      const absolutePath = path.join(root, relativePath);
      if (entry.isDirectory()) {
        hash.update(`${portablePath}\0directory\0`);
        pending.push(relativePath);
      } else if (entry.isFile()) {
        hash.update(`${portablePath}\0file\0`);
        for await (const chunk of createReadStream(absolutePath)) hash.update(chunk);
        hash.update("\0");
      } else if (entry.isSymbolicLink()) {
        hash.update(`${portablePath}\0symlink\0${await fs.readlink(absolutePath)}\0`);
      } else {
        throw new Error(`Coding benchmark Linux cache seed contains unsupported entry ${portablePath}.`);
      }
    }
  }
  return hash.digest("hex");
}

async function readJson(target, label) {
  try {
    return JSON.parse(await fs.readFile(target, "utf-8"));
  } catch (error) {
    if (error?.code === "ENOENT") throw error;
    throw new Error(`Coding benchmark Linux ${label} is invalid JSON: ${safeMessage(error)}.`);
  }
}

async function readJsonIfExists(target) {
  try {
    return await readJson(target, target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function pathExists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function assertDirectory(target, label) {
  const stats = await fs.stat(target).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!stats?.isDirectory()) {
    throw new Error(`Coding benchmark Linux ${label} must be a directory.`);
  }
}

async function assertPathAbsent(target, label) {
  if (await pathExists(target)) {
    throw new Error(`Coding benchmark Linux ${label} must not already exist.`);
  }
}

function toPortableRelativePath(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Coding benchmark Linux artifact path escapes the preparation root.");
  }
  return relative.replaceAll("\\", "/");
}

async function writeJsonExclusive(target, value) {
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf-8",
    flag: "wx",
  });
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Coding benchmark Linux snapshot preparation requires ${label}.`);
  }
  return value.trim();
}

function requireIsoTimestamp(value, label) {
  const timestamp = requireString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp)
    || Number.isNaN(Date.parse(timestamp))) {
    throw new Error(`Coding benchmark Linux snapshot preparation ${label} must be ISO-8601 UTC.`);
  }
  return timestamp;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

export function parseCodingAgentBenchmarkLinuxPreparationArguments(argv) {
  const options = {
    manifestPath: resolveCodingAgentBenchmarkManifestPath("v3"),
    sourceRoot: null,
    npmCacheRoot: null,
    dependencySeedRoot: null,
    goModuleCacheRoot: null,
    outputRoot: null,
    preparedAt: new Date().toISOString(),
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Coding benchmark Linux preparation ${argument} requires a value.`);
    }
    if (argument === "--manifest") options.manifestPath = path.resolve(value);
    else if (argument === "--source-root") options.sourceRoot = path.resolve(value);
    else if (argument === "--npm-cache-root") options.npmCacheRoot = path.resolve(value);
    else if (argument === "--dependency-seed-root") options.dependencySeedRoot = path.resolve(value);
    else if (argument === "--go-module-cache-root") options.goModuleCacheRoot = path.resolve(value);
    else if (argument === "--output-root") options.outputRoot = path.resolve(value);
    else if (argument === "--prepared-at") options.preparedAt = value;
    else throw new Error(`Unknown coding benchmark Linux preparation argument: ${argument}`);
    index += 1;
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/coding-agent-benchmark-linux-snapshot-preparation.mjs \\
  --source-root <frozen-source-parent> \\
  --npm-cache-root <offline-npm-cache> \\
  --dependency-seed-root <prepared-cache-parent> \\
  --output-root <new-linux-ext4-root> [--go-module-cache-root <offline-go-cache>]`);
}

async function main() {
  const options = parseCodingAgentBenchmarkLinuxPreparationArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const manifest = await loadCodingAgentBenchmarkManifest(options.manifestPath);
  const sourceRoot = path.resolve(requireString(options.sourceRoot, "--source-root"));
  const dependencySeedRoots = options.dependencySeedRoot
    ? Object.fromEntries(manifest.repositories.map((repository) => [
      repository.id,
      path.join(options.dependencySeedRoot, `${repository.id}-${repository.source.commit}`),
    ]))
    : {};
  const report = await prepareCodingAgentBenchmarkV3LinuxSnapshots({
    manifest,
    sourceRoots: Object.fromEntries(manifest.repositories.map((repository) => [
      repository.id,
      path.join(sourceRoot, repository.id),
    ])),
    npmCacheRoot: requireString(options.npmCacheRoot, "--npm-cache-root"),
    dependencySeedRoots,
    goModuleCacheRoot: options.goModuleCacheRoot,
    outputRoot: requireString(options.outputRoot, "--output-root"),
    preparedAt: options.preparedAt,
  });
  console.log(
    `[coding-agent-linux-snapshot-preparation] ${report.status} ready=${report.summary.ready} blocked=${report.summary.blocked}`,
  );
  if (report.status !== "ready") process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(scriptPath)) {
  main().catch((error) => {
    console.error(`[coding-agent-linux-snapshot-preparation] failed: ${safeMessage(error)}`);
    process.exitCode = 1;
  });
}
