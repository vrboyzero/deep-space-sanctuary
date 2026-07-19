import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, expect, test } from "vitest";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const artifactContractPath = path.join(workspaceRoot, "scripts", "artifact-contract.mjs");
const portableBuilderPath = path.join(
  workspaceRoot,
  "packages",
  "star-sanctuary-distribution",
  "scripts",
  "build-portable.mjs",
);
const portableRuntimeCheckPath = path.join(
  workspaceRoot,
  "packages",
  "star-sanctuary-distribution",
  "scripts",
  "portable-runtime-check.mjs",
);
const portablePrefetchPath = path.join(
  workspaceRoot,
  "packages",
  "star-sanctuary-distribution",
  "scripts",
  "prefetch-portable-deps.mjs",
);
const portableVerifierPath = path.join(
  workspaceRoot,
  "packages",
  "star-sanctuary-distribution",
  "scripts",
  "verify-portable-artifacts.mjs",
);
const portableDepsVerifierPath = path.join(
  workspaceRoot,
  "packages",
  "star-sanctuary-distribution",
  "scripts",
  "verify-portable-deps.mjs",
);
const singleExeVerifierPath = path.join(
  workspaceRoot,
  "packages",
  "star-sanctuary-distribution",
  "scripts",
  "verify-single-exe-deps.mjs",
);
const wingetBuilderPath = path.join(workspaceRoot, "scripts", "build-winget-assets.mjs");
const tempDirs = new Set<string>();

async function createTempDir(prefix: string): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.add(tempDir);
  return tempDir;
}

afterEach(async () => {
  await Promise.all([...tempDirs].map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs.clear();
});

test("shared artifact inventory copies declared non-dist package bins", async () => {
  const fixtureRoot = await createTempDir("star-portable-assets-");
  const sourcePackageDir = path.join(fixtureRoot, "source");
  const destinationPackageDir = path.join(fixtureRoot, "portable", "packages", "browser");
  const packageJson = {
    name: "@belldandy/browser-fixture",
    bin: {
      "fixture-relay": "./bin/relay.mjs",
      "fixture-dist-cli": "./dist/cli.mjs",
    },
  };
  await Promise.all([
    fs.mkdir(path.join(sourcePackageDir, "bin"), { recursive: true }),
    fs.mkdir(path.join(sourcePackageDir, "dist"), { recursive: true }),
  ]);
  await Promise.all([
    fs.writeFile(path.join(sourcePackageDir, "bin", "relay.mjs"), "console.log('relay');\n", "utf-8"),
    fs.writeFile(path.join(sourcePackageDir, "dist", "cli.mjs"), "console.log('dist');\n", "utf-8"),
  ]);

  const artifactContract = await import(`${pathToFileURL(artifactContractPath).href}?portable-assets`);
  const inventory = artifactContract.copyPackageNonDistBinArtifacts({
    sourcePackageDir,
    destinationPackageDir,
    packageJson,
  }) as Array<{ commandName: string; relativePath: string }>;

  expect(inventory).toEqual([
    {
      commandName: "fixture-relay",
      relativePath: "bin/relay.mjs",
    },
  ]);
  await expect(fs.readFile(path.join(destinationPackageDir, "bin", "relay.mjs"), "utf-8"))
    .resolves.toBe("console.log('relay');\n");
  expect(existsSync(path.join(destinationPackageDir, "dist", "cli.mjs"))).toBe(false);
});

test("portable builder uses the shared non-dist bin copy policy", async () => {
  const source = await fs.readFile(portableBuilderPath, "utf-8");

  expect(source).toContain("copyPackageNonDistBinArtifacts");
  expect(source).not.toMatch(/packageName\s*===\s*["']belldandy-browser["']/);
});

test("portable builder packages the dependency report policy beside the runtime check", async () => {
  const [builderSource, runtimeCheckSource] = await Promise.all([
    fs.readFile(portableBuilderPath, "utf-8"),
    fs.readFile(portableRuntimeCheckPath, "utf-8"),
  ]);

  expect(runtimeCheckSource).toContain('from "./runtime-dependency-target-policy.mjs"');
  expect(runtimeCheckSource).toContain('from "./runtime-dependency-module-load-policy.mjs"');
  expect(runtimeCheckSource).toContain('from "./runtime-native-matrix-policy.mjs"');
  expect(runtimeCheckSource).toContain("createRuntimeNativeMatrix(result.target)");
  expect(runtimeCheckSource).toContain('const loadOptionalModules = result.mode === "full"');
  expect(runtimeCheckSource).toContain("inspectOptionalRuntimeModule(");
  expect(runtimeCheckSource).toContain("{ load: loadOptionalModules }");
  expect(builderSource).toContain('"runtime-dependency-report-policy.mjs"');
  expect(builderSource).toContain('"runtime-dependency-module-load-policy.mjs"');
  expect(builderSource).toContain('"runtime-native-matrix-policy.mjs"');
  expect(builderSource).toContain('"runtime-dependency-target-policy.mjs"');
  expect(builderSource).toContain(
    'path.join(runtimePackagesRoot, "star-sanctuary-distribution", "dist", "runtime-dependency-report-policy.mjs")',
  );
  expect(builderSource).toContain(
    'path.join(runtimePackagesRoot, "star-sanctuary-distribution", "dist", "runtime-dependency-module-load-policy.mjs")',
  );
  expect(builderSource).toContain(
    'path.join(runtimePackagesRoot, "star-sanctuary-distribution", "dist", "runtime-native-matrix-policy.mjs")',
  );
  expect(builderSource).toContain(
    'path.join(runtimePackagesRoot, "star-sanctuary-distribution", "dist", "runtime-dependency-target-policy.mjs")',
  );
});

test("portable builder consumes a prefetched lockfile and only performs frozen offline install", async () => {
  const [builderSource, prefetchSource] = await Promise.all([
    fs.readFile(portableBuilderPath, "utf-8"),
    fs.readFile(portablePrefetchPath, "utf-8"),
  ]);

  expect(builderSource).toContain('from "./runtime-dependency-assembler-policy.mjs"');
  expect(builderSource).toContain("createRuntimeDependencyInstallArgs");
  expect(builderSource).toContain("portablePrefetchLockfilePath");
  expect(builderSource).toContain("assertRuntimeDependencySnapshot(snapshot");
  expect(builderSource).toContain("createRuntimeDependencyStoreSnapshot(portablePnpmStoreDir)");
  expect(builderSource).toContain("resolveRuntimeBuildScriptPolicy");
  expect(builderSource).toContain("runtimeLockfile,");
  expect(builderSource).toContain("runtimeWorkspaceConfig,");
  expect(builderSource).not.toContain('"pnpm",\n    "fetch"');
  expect(builderSource).not.toContain('"--prefer-offline"');
  expect(builderSource).not.toContain('"--no-frozen-lockfile"');
  expect(prefetchSource).toContain('from "./runtime-dependency-assembler-policy.mjs"');
  expect(prefetchSource).toContain("createRuntimeDependencyPrefetchArgs");
  expect(prefetchSource).toContain("createRuntimeDependencyStoreSnapshot(portablePnpmStoreDir)");
  expect(prefetchSource).toContain("resolveRuntimeBuildScriptPolicy({ cwd: workspaceRoot, mode })");
  const prefetchIndex = prefetchSource.indexOf("prefetchRuntimeDependencies();");
  const snapshotPublishIndex = prefetchSource.indexOf("writeRuntimeDependencySnapshot();");
  const storeResetIndex = prefetchSource.indexOf("resetSandboxDir(portablePnpmStoreDir");
  expect(storeResetIndex).toBeGreaterThan(-1);
  expect(prefetchIndex).toBeGreaterThan(storeResetIndex);
  expect(prefetchIndex).toBeGreaterThan(-1);
  expect(snapshotPublishIndex).toBeGreaterThan(prefetchIndex);
});

test("portable and derived single-exe metadata preserve the verified dependency snapshot identity", async () => {
  const [builderSource, verifierSource, singleExeBuilderSource, singleExeVerifierSource] = await Promise.all([
    fs.readFile(portableBuilderPath, "utf-8"),
    fs.readFile(portableVerifierPath, "utf-8"),
    fs.readFile(path.join(
      workspaceRoot,
      "packages",
      "star-sanctuary-distribution",
      "scripts",
      "build-single-exe.mjs",
    ), "utf-8"),
    fs.readFile(singleExeVerifierPath, "utf-8"),
  ]);

  expect(builderSource).toContain("createRuntimeDependencySnapshotArtifactIdentity(snapshot)");
  expect(builderSource).toContain("dependencySnapshot,");
  expect(verifierSource).toContain("verifyRuntimeDependencySnapshotIdentity()");
  expect(verifierSource).toContain("assertRuntimeDependencySnapshotArtifactIdentity(versionFile.dependencySnapshot");
  expect(verifierSource).toContain("assertRuntimeDependencySnapshotArtifactIdentity(runtimeManifest.dependencySnapshot");
  expect(verifierSource).toContain("storeSnapshot: versionFile.dependencySnapshot?.storeSnapshot");
  expect(singleExeBuilderSource).toContain("dependencySnapshot: versionFile.dependencySnapshot");
  expect(singleExeVerifierSource).toContain("assertRuntimeDependencySnapshotArtifactIdentityEqual(");
  const identityGateIndex = singleExeVerifierSource.indexOf(
    "  verifyExtractedRuntimeDependencySnapshotIdentity();",
  );
  const runtimeCheckIndex = singleExeVerifierSource.indexOf(
    "  const report = await runExtractedRuntimeCheck();",
  );
  expect(identityGateIndex).toBeGreaterThan(-1);
  expect(runtimeCheckIndex).toBeGreaterThan(identityGateIndex);
});

test("portable artifact verifier rejects a missing Relay bin before probing", async () => {
  const portableRoot = await createTempDir("star-portable-verifier-");
  const browserPackageDir = path.join(
    portableRoot,
    "runtime",
    "packages",
    "belldandy-browser",
  );
  await fs.mkdir(browserPackageDir, { recursive: true });
  await fs.writeFile(
    path.join(browserPackageDir, "package.json"),
    `${JSON.stringify({
      name: "@belldandy/browser",
      bin: {
        "belldandy-relay": "./bin/relay.mjs",
      },
    }, null, 2)}\n`,
    "utf-8",
  );

  const result = spawnSync(process.execPath, [
    portableVerifierPath,
    `--portable-root=${portableRoot}`,
  ], {
    cwd: workspaceRoot,
    encoding: "utf-8",
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("portable package artifacts are incomplete");
  expect(result.stderr).toContain(
    "@belldandy/browser -> missing bin/relay.mjs (bin belldandy-relay)",
  );
});

test("single-exe dependency verification reuses the packaged runtime Relay probe", async () => {
  const source = await fs.readFile(singleExeVerifierPath, "utf-8");

  expect(source).toContain("verify-portable-artifacts.mjs");
  expect(source).toContain("--runtime-version-root=");
  expect(source).toContain("--runtime-executable=");
});

test("portable and single-exe dependency verifiers share the canonical report policy", async () => {
  const verifierSources = await Promise.all([
    fs.readFile(portableDepsVerifierPath, "utf-8"),
    fs.readFile(singleExeVerifierPath, "utf-8"),
  ]);

  for (const source of verifierSources) {
    expect(source).toContain('from "./runtime-dependency-report-policy.mjs"');
    expect(source).toContain("assertRuntimeDependencyReport(report");
    expect(source).toContain("nodeAbi: process.versions.modules");
  }
});

test("derived single-exe and winget builders require the portable artifact probe", async () => {
  const [singleExeBuilder, wingetBuilder] = await Promise.all([
    fs.readFile(path.join(
      workspaceRoot,
      "packages",
      "star-sanctuary-distribution",
      "scripts",
      "build-single-exe.mjs",
    ), "utf-8"),
    fs.readFile(wingetBuilderPath, "utf-8"),
  ]);

  for (const source of [singleExeBuilder, wingetBuilder]) {
    expect(source).toContain("verify-portable-artifacts.mjs");
    expect(source).toContain("--portable-root=");
  }
  expect(singleExeBuilder.lastIndexOf("verifyPortableArtifactForDerivedBuild()"))
    .toBeLessThan(singleExeBuilder.indexOf("archiveExistingDirectory(singleExeRoot)"));
  expect(wingetBuilder.lastIndexOf("verifyPortableArtifactForDerivedBuild(portableRoot, mode)"))
    .toBeLessThan(wingetBuilder.indexOf("resetDir(versionRoot)"));
});
