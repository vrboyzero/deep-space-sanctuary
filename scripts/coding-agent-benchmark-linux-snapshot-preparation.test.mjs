import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  loadCodingAgentBenchmarkManifest,
  resolveCodingAgentBenchmarkManifestPath,
} from "./coding-agent-benchmark-contract.mjs";
import {
  CODING_AGENT_BENCHMARK_LINUX_SNAPSHOT_PREPARATION_VERSION,
  detectCodingAgentBenchmarkLinuxLibc,
  inspectCodingAgentBenchmarkLinuxPlatformDependencies,
  prepareCodingAgentBenchmarkV3LinuxSnapshots,
} from "./coding-agent-benchmark-linux-snapshot-preparation.mjs";

const tempRoots = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("coding agent benchmark Linux snapshot preparation", () => {
  it("requires applicable native packages and rejects foreign-platform packages", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-linux-platform-test-"));
    tempRoots.push(root);
    const lock = {
      packages: {
        "node_modules/@esbuild/linux-x64": {
          version: "0.25.8",
          os: ["linux"],
          cpu: ["x64"],
        },
        "node_modules/@esbuild/win32-x64": {
          version: "0.25.8",
          os: ["win32"],
          cpu: ["x64"],
        },
      },
    };

    await expect(inspectCodingAgentBenchmarkLinuxPlatformDependencies({
      lock,
      nodeModulesRoot: root,
      os: "linux",
      arch: "x64",
    })).resolves.toEqual({
      code: "platform_dependency_missing",
      detail: "node_modules/@esbuild/linux-x64@0.25.8",
    });

    await fs.mkdir(path.join(root, "@esbuild", "linux-x64"), { recursive: true });
    await expect(inspectCodingAgentBenchmarkLinuxPlatformDependencies({
      lock,
      nodeModulesRoot: root,
      os: "linux",
      arch: "x64",
    })).resolves.toBeNull();

    await fs.mkdir(path.join(root, "@esbuild", "win32-x64"), { recursive: true });
    await expect(inspectCodingAgentBenchmarkLinuxPlatformDependencies({
      lock,
      nodeModulesRoot: root,
      os: "linux",
      arch: "x64",
    })).resolves.toEqual({
      code: "foreign_platform_dependency_present",
      detail: "node_modules/@esbuild/win32-x64@0.25.8",
    });
  });

  it("applies package-lock libc constraints to native packages", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-linux-libc-test-"));
    tempRoots.push(root);
    const lock = {
      packages: {
        "node_modules/@oxfmt/binding-linux-x64-gnu": {
          version: "0.32.0",
          os: ["linux"],
          cpu: ["x64"],
          libc: ["glibc"],
        },
        "node_modules/@oxfmt/binding-linux-x64-musl": {
          version: "0.32.0",
          os: ["linux"],
          cpu: ["x64"],
          libc: ["musl"],
        },
      },
    };

    await expect(inspectCodingAgentBenchmarkLinuxPlatformDependencies({
      lock,
      nodeModulesRoot: root,
      os: "linux",
      arch: "x64",
      libc: "glibc",
    })).resolves.toEqual({
      code: "platform_dependency_missing",
      detail: "node_modules/@oxfmt/binding-linux-x64-gnu@0.32.0",
    });

    await expect(inspectCodingAgentBenchmarkLinuxPlatformDependencies({
      lock,
      nodeModulesRoot: root,
      os: "linux",
      arch: "x64",
      libc: "musl",
    })).resolves.toEqual({
      code: "platform_dependency_missing",
      detail: "node_modules/@oxfmt/binding-linux-x64-musl@0.32.0",
    });

    await fs.mkdir(path.join(root, "@oxfmt", "binding-linux-x64-gnu"), { recursive: true });
    await expect(inspectCodingAgentBenchmarkLinuxPlatformDependencies({
      lock,
      nodeModulesRoot: root,
      os: "linux",
      arch: "x64",
      libc: "glibc",
    })).resolves.toBeNull();
  });

  it("detects the Linux libc family from the Node runtime report", () => {
    expect(detectCodingAgentBenchmarkLinuxLibc({ glibcVersionRuntime: "2.35" })).toBe("glibc");
    expect(detectCodingAgentBenchmarkLinuxLibc({})).toBe("musl");
  });

  it("publishes only receipt-backed ready repositories and records exact blockers", async () => {
    const fixture = await createFixture();
    const dependencyCalls = [];

    const report = await prepareCodingAgentBenchmarkV3LinuxSnapshots({
      manifest: fixture.manifest,
      sourceRoots: fixture.sourceRoots,
      outputRoot: fixture.outputRoot,
      npmCacheRoot: fixture.npmCacheRoot,
      preparedAt: "2026-08-06T10:00:00.000Z",
    }, createDependencies({ dependencyCalls }));

    expect(report).toMatchObject({
      schemaVersion: CODING_AGENT_BENCHMARK_LINUX_SNAPSHOT_PREPARATION_VERSION,
      status: "partial",
      platform: {
        id: "wsl2-linux",
        os: "linux",
        arch: "x64",
        distribution: "Ubuntu-22.04",
      },
      toolchain: {
        node: "v22.22.2",
        npm: "10.9.7",
        git: "git version 2.34.1",
        go: null,
      },
      policy: {
        preparationNetwork: "offline-local-materials-only",
        executionNetwork: "disabled",
        npmArguments: [
          "ci",
          "--offline",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "--update-notifier=false",
        ],
        npmLockArguments: [
          "install",
          "--package-lock-only",
          "--offline",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "--update-notifier=false",
        ],
        outputRootMustNotExist: true,
      },
      summary: { ready: 2, blocked: 2 },
      repositories: [
        { repositoryId: "express", status: "ready", blocker: null },
        {
          repositoryId: "preact",
          status: "blocked",
          blocker: {
            code: "platform_dependency_missing",
            detail: "node_modules/@esbuild/linux-x64@0.25.8",
          },
        },
        {
          repositoryId: "spf13-cobra",
          status: "blocked",
          blocker: { code: "go_toolchain_unavailable", detail: "go is not available in PATH" },
        },
        { repositoryId: "vscode-languageserver-node", status: "ready", blocker: null },
      ],
    });

    expect(dependencyCalls).toHaveLength(4);
    for (const call of dependencyCalls) {
      expect(call.policy.npmArguments).toEqual(report.policy.npmArguments);
      expect(call.policy.executionNetwork).toBe("disabled");
    }
    const reportSchema = compileOutputSchema(await readJson(path.resolve(
      "benchmarks/coding-agent/v3/linux-snapshot-preparation.schema.json",
    )));
    expect(reportSchema).toMatchObject({ ok: true });
    if (reportSchema.ok) {
      const reportValidation = reportSchema.validator.validateOutput(JSON.stringify(report));
      expect(reportValidation, JSON.stringify(reportValidation)).toMatchObject({ ok: true });
    }

    const config = await readJson(path.join(fixture.outputRoot, "repository-inputs.json"));
    expect(config).toEqual({
      schemaVersion: "coding-agent-benchmark-repository-inputs/v1",
      repositories: [
        {
          repositoryId: "express",
          repositoryRoot: "sources/express",
          dependencyCacheRoot: "caches/express",
          receiptPath: "receipts/express.json",
        },
        {
          repositoryId: "vscode-languageserver-node",
          repositoryRoot: "sources/vscode-languageserver-node",
          dependencyCacheRoot: "caches/vscode-languageserver-node",
          receiptPath: "receipts/vscode-languageserver-node.json",
        },
      ],
    });
    await expect(readJson(path.join(fixture.outputRoot, "receipts", "express.json")))
      .resolves.toMatchObject({ repositoryId: "express" });
    await expect(readJson(path.join(
      fixture.outputRoot,
      "preflights",
      "real-js.bug-fix.json",
    ))).resolves.toMatchObject({ taskId: "real-js.bug-fix", status: "passed" });
    await expect(fs.stat(path.join(fixture.outputRoot, "receipts", "preact.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect(await listPreparationStages(fixture.root)).toEqual([]);
  });

  it("rejects non-Linux preparation before creating output", async () => {
    const fixture = await createFixture();
    const dependencies = createDependencies();
    dependencies.inspectEnvironment = async () => ({
      platform: { id: "windows-native", os: "win32", arch: "x64", distribution: null },
      toolchain: { node: "v22.22.2", npm: "10.9.7", git: "git version 2.47.1", go: null },
    });

    await expect(prepareCodingAgentBenchmarkV3LinuxSnapshots({
      manifest: fixture.manifest,
      sourceRoots: fixture.sourceRoots,
      outputRoot: fixture.outputRoot,
      npmCacheRoot: fixture.npmCacheRoot,
      preparedAt: "2026-08-06T10:00:00.000Z",
    }, dependencies)).rejects.toThrow(/must run on Linux/i);
    await expect(fs.stat(fixture.outputRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not overwrite an existing output root", async () => {
    const fixture = await createFixture();
    await fs.mkdir(fixture.outputRoot);
    await fs.writeFile(path.join(fixture.outputRoot, "sentinel.txt"), "keep\n", "utf-8");

    await expect(prepareCodingAgentBenchmarkV3LinuxSnapshots({
      manifest: fixture.manifest,
      sourceRoots: fixture.sourceRoots,
      outputRoot: fixture.outputRoot,
      npmCacheRoot: fixture.npmCacheRoot,
      preparedAt: "2026-08-06T10:00:00.000Z",
    }, createDependencies())).rejects.toThrow(/outputRoot must not already exist/i);
    await expect(fs.readFile(path.join(fixture.outputRoot, "sentinel.txt"), "utf-8"))
      .resolves.toBe("keep\n");
  });

  it("uses the mounted source only as a pinned object seed", async () => {
    const fixture = await createFixture();
    const dependencies = createDependencies();
    dependencies.inspectSourceSeed = async ({ repository }) => ({
      sourceUrl: repository.source.url,
      commit: repository.source.commit,
      workspaceDirty: true,
    });

    const report = await prepareCodingAgentBenchmarkV3LinuxSnapshots({
      manifest: fixture.manifest,
      sourceRoots: fixture.sourceRoots,
      outputRoot: fixture.outputRoot,
      npmCacheRoot: fixture.npmCacheRoot,
      preparedAt: "2026-08-06T10:00:00.000Z",
    }, dependencies);

    expect(report.status).toBe("partial");
    expect(report.repositories.every((repository) => repository.sourceRoot.startsWith("sources/")))
      .toBe(true);
  });

  it("removes its staging root after an unexpected adapter failure", async () => {
    const fixture = await createFixture();
    const dependencies = createDependencies();
    dependencies.cloneRepository = async () => {
      throw new Error("clone adapter failed");
    };

    await expect(prepareCodingAgentBenchmarkV3LinuxSnapshots({
      manifest: fixture.manifest,
      sourceRoots: fixture.sourceRoots,
      outputRoot: fixture.outputRoot,
      npmCacheRoot: fixture.npmCacheRoot,
      preparedAt: "2026-08-06T10:00:00.000Z",
    }, dependencies)).rejects.toThrow("clone adapter failed");
    await expect(fs.stat(fixture.outputRoot)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await listPreparationStages(fixture.root)).toEqual([]);
  });
});

async function createFixture() {
  const manifest = await loadCodingAgentBenchmarkManifest(
    resolveCodingAgentBenchmarkManifestPath("v3"),
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-linux-preparation-test-"));
  tempRoots.push(root);
  const sourceRoots = {};
  for (const repository of manifest.repositories) {
    const sourceRoot = path.join(root, "inputs", repository.id);
    await fs.mkdir(sourceRoot, { recursive: true });
    sourceRoots[repository.id] = sourceRoot;
  }
  const npmCacheRoot = path.join(root, "npm-cache");
  await fs.mkdir(npmCacheRoot);
  return { manifest, root, sourceRoots, npmCacheRoot, outputRoot: path.join(root, "prepared") };
}

function createDependencies(input = {}) {
  return {
    inspectEnvironment: async () => ({
      platform: {
        id: "wsl2-linux",
        os: "linux",
        arch: "x64",
        distribution: "Ubuntu-22.04",
      },
      toolchain: {
        node: "v22.22.2",
        npm: "10.9.7",
        git: "git version 2.34.1",
        go: null,
      },
    }),
    inspectSourceSeed: async ({ repository }) => createSourceIdentity(repository),
    inspectSource: async ({ repository }) => createSourceIdentity(repository),
    cloneRepository: async ({ targetRoot }) => {
      await fs.mkdir(targetRoot, { recursive: true });
    },
    prepareDependencyCache: async (call) => {
      input.dependencyCalls?.push(call);
      if (call.repository.id === "preact") {
        return {
          status: "blocked",
          blocker: {
            code: "platform_dependency_missing",
            detail: "node_modules/@esbuild/linux-x64@0.25.8",
          },
          provenance: {
            packageManager: "npm",
            dependencyLockSha256: "5".repeat(64),
            dependencySeedSha256: null,
          },
        };
      }
      if (call.repository.id === "spf13-cobra") {
        return {
          status: "blocked",
          blocker: { code: "go_toolchain_unavailable", detail: "go is not available in PATH" },
          provenance: {
            packageManager: "go",
            dependencyLockSha256: "6".repeat(64),
            dependencySeedSha256: null,
          },
        };
      }
      await fs.mkdir(path.join(call.cacheRoot, "node_modules"), { recursive: true });
      await fs.writeFile(
        path.join(call.cacheRoot, ".coding-benchmark-cache-key"),
        `${call.repository.id}-${call.repository.source.commit}-linux-x64\n`,
        "utf-8",
      );
      return {
        status: "ready",
        blocker: null,
        provenance: {
          packageManager: "npm",
          dependencyLockSha256: "7".repeat(64),
          dependencySeedSha256: null,
        },
      };
    },
    inspectPreparation: async ({ manifest, repositoryId, preparedAt }) => {
      const repository = manifest.repositories.find((candidate) => candidate.id === repositoryId);
      return createReceipt(repository, preparedAt);
    },
    evaluatePreflight: async ({ taskId, receipt }) => ({
      schemaVersion: "coding-agent-benchmark-snapshot-preflight/v1",
      taskId,
      repositoryId: receipt.repositoryId,
      status: "passed",
      checks: Object.fromEntries([
        "manifestBinding",
        "sourceIdentity",
        "license",
        "dependencyCache",
        "executionNetwork",
      ].map((key) => [key, { status: "passed", reason: null }])),
    }),
  };
}

function createSourceIdentity(repository) {
  return {
    sourceUrl: repository.source.url,
    commit: repository.source.commit,
    workspaceDirty: false,
    worktreeContentSha256: "1".repeat(64),
    dependencyInputsSha256: "2".repeat(64),
    licensePath: repository.license.path,
    licenseSha256: "3".repeat(64),
  };
}

function createReceipt(repository, preparedAt) {
  return {
    schemaVersion: "coding-agent-benchmark-snapshot-receipt/v1",
    repositoryId: repository.id,
    source: {
      url: repository.source.url,
      commit: repository.source.commit,
      workspaceDirty: false,
      worktreeContentSha256: "1".repeat(64),
      dependencyInputsSha256: "2".repeat(64),
    },
    license: {
      spdx: repository.license.spdx,
      path: repository.license.path,
      sha256: "3".repeat(64),
    },
    dependencyCache: {
      cacheKey: `${repository.id}-${repository.source.commit}-linux-x64`,
      contentSha256: "4".repeat(64),
    },
    policy: {
      preparationNetwork: repository.snapshot.preparationNetwork,
      executionNetwork: repository.snapshot.executionNetwork,
      dependencyPolicy: repository.snapshot.dependencyPolicy,
    },
    preparedAt,
  };
}

async function readJson(target) {
  return JSON.parse(await fs.readFile(target, "utf-8"));
}

async function listPreparationStages(root) {
  return (await fs.readdir(root)).filter((entry) => entry.startsWith(".prepared.stage-"));
}
