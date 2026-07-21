import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, expect, test } from "vitest";

function resolveWorkspaceRoot(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, "..", "..", "..");
}

function readPackageVersion(workspaceRoot: string): string {
  const packageJsonPath = path.join(workspaceRoot, "package.json");
  const packageJson = JSON.parse(
    fs.readFileSync(packageJsonPath, "utf-8"),
  ) as { version?: string };
  const version = String(packageJson.version ?? "").trim();
  if (!version) {
    throw new Error("Failed to resolve workspace version for release-light test.");
  }
  return version;
}

function runNodeScript(
  workspaceRoot: string,
  relativeScriptPath: string,
  env: NodeJS.ProcessEnv,
): void {
  execFileSync(process.execPath, [relativeScriptPath], {
    cwd: workspaceRoot,
    env,
    stdio: "pipe",
    encoding: "utf-8",
  });
}

const workspaceRoot = resolveWorkspaceRoot();
const version = readPackageVersion(workspaceRoot);
let releaseRoot = "";

function releaseLightEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    BELLDANDY_RELEASE_LIGHT_ROOT: releaseRoot,
  };
}

beforeAll(async () => {
  releaseRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "star-release-light-test-"));
  runNodeScript(workspaceRoot, "scripts/build-release-light-assets.mjs", releaseLightEnvironment());
}, 120_000);

afterAll(async () => {
  await fsp.rm(releaseRoot, { recursive: true, force: true });
});

test("release-light asset keeps default env templates complete", async () => {
  runNodeScript(workspaceRoot, "scripts/verify-release-light-assets.mjs", releaseLightEnvironment());

  const sourceTemplatesRoot = path.join(
    workspaceRoot,
    "packages",
    "star-sanctuary-distribution",
    "src",
    "templates",
    "default-env",
  );
  const artifactTemplatesRoot = path.join(
    releaseRoot,
    `v${version}`,
    `star-sanctuary-dist-v${version}`,
    "packages",
    "star-sanctuary-distribution",
    "src",
    "templates",
    "default-env",
  );

  const [sourceEnv, sourceEnvLocal, artifactEnv, artifactEnvLocal] = await Promise.all([
    fsp.readFile(path.join(sourceTemplatesRoot, "runtime.env"), "utf-8"),
    fsp.readFile(path.join(sourceTemplatesRoot, "runtime.env.local"), "utf-8"),
    fsp.readFile(path.join(artifactTemplatesRoot, "runtime.env"), "utf-8"),
    fsp.readFile(path.join(artifactTemplatesRoot, "runtime.env.local"), "utf-8"),
  ]);

  expect(artifactEnv).toBe(sourceEnv);
  expect(artifactEnvLocal).toBe(sourceEnvLocal);
}, 120_000);

test("release-light verifier rejects staged file content identity drift", async () => {
  const stagedReadmePath = path.join(
    releaseRoot,
    `v${version}`,
    `star-sanctuary-dist-v${version}`,
    "README-release-light.md",
  );
  const original = await fsp.readFile(stagedReadmePath);
  await fsp.appendFile(stagedReadmePath, "\ntampered-after-manifest\n");

  try {
    const result = spawnSync(process.execPath, ["scripts/verify-release-light-assets.mjs"], {
      cwd: workspaceRoot,
      env: releaseLightEnvironment(),
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "release-light content SHA-256 mismatch for README-release-light.md",
    );
  } finally {
    await fsp.writeFile(stagedReadmePath, original);
  }
}, 120_000);

test("release-light verifier rejects staged Web asset lockfile identity drift", async () => {
  const versionRoot = path.join(releaseRoot, `v${version}`);
  const packageRootName = `star-sanctuary-dist-v${version}`;
  const manifestName = `${packageRootName}.manifest.json`;
  const manifestPath = path.join(versionRoot, manifestName);
  const sha256Path = path.join(versionRoot, `${packageRootName}.sha256`);
  const stagedLockfilePath = path.join(
    versionRoot,
    packageRootName,
    "pnpm-lock.yaml",
  );
  const [originalLockfile, originalManifest, originalSha256] = await Promise.all([
    fsp.readFile(stagedLockfilePath),
    fsp.readFile(manifestPath),
    fsp.readFile(sha256Path),
  ]);
  const tamperedLockfile = Buffer.concat([
    originalLockfile,
    Buffer.from("\n# tampered-web-asset-lockfile\n", "utf-8"),
  ]);
  const manifest = JSON.parse(originalManifest.toString("utf-8"));
  const lockfileEntry = manifest.content?.files?.find((entry: { path?: string }) => entry.path === "pnpm-lock.yaml");
  if (!lockfileEntry) throw new Error("release-light fixture is missing pnpm-lock.yaml.");
  lockfileEntry.sha256 = crypto.createHash("sha256").update(tamperedLockfile).digest("hex");
  lockfileEntry.size = tamperedLockfile.byteLength;
  manifest.content.totalBytes += tamperedLockfile.byteLength - originalLockfile.byteLength;
  const updatedManifest = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  const updatedManifestHash = crypto.createHash("sha256").update(updatedManifest).digest("hex");
  const updatedSha256 = originalSha256.toString("utf-8")
    .split(/\r?\n/)
    .map((line) => line.endsWith(`  ${manifestName}`) ? `${updatedManifestHash}  ${manifestName}` : line)
    .join("\n");
  await Promise.all([
    fsp.writeFile(stagedLockfilePath, tamperedLockfile),
    fsp.writeFile(manifestPath, updatedManifest),
    fsp.writeFile(sha256Path, updatedSha256),
  ]);

  try {
    const result = spawnSync(process.execPath, ["scripts/verify-release-light-assets.mjs"], {
      cwd: workspaceRoot,
      env: releaseLightEnvironment(),
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Web asset manifest lockfile SHA-256 mismatch");
  } finally {
    await Promise.all([
      fsp.writeFile(stagedLockfilePath, originalLockfile),
      fsp.writeFile(manifestPath, originalManifest),
      fsp.writeFile(sha256Path, originalSha256),
    ]);
  }
}, 120_000);

test("release-light verifier rejects a staged Web asset hash drift after outer manifest reconciliation", async () => {
  const versionRoot = path.join(releaseRoot, `v${version}`);
  const packageRootName = `star-sanctuary-dist-v${version}`;
  const packageRoot = path.join(versionRoot, packageRootName);
  const manifestName = `${packageRootName}.manifest.json`;
  const manifestPath = path.join(versionRoot, manifestName);
  const sha256Path = path.join(versionRoot, `${packageRootName}.sha256`);
  const webManifestPath = path.join(packageRoot, "apps", "web", "public", "assets", "web-assets-manifest.json");
  const [originalManifest, originalSha256, webManifest] = await Promise.all([
    fsp.readFile(manifestPath),
    fsp.readFile(sha256Path),
    fsp.readFile(webManifestPath, "utf-8"),
  ]);
  const markedAssetPath = path.join(
    packageRoot,
    "apps",
    "web",
    "public",
    `.${JSON.parse(webManifest).assets.marked.path}`,
  );
  const originalAsset = await fsp.readFile(markedAssetPath);
  const tamperedAsset = Buffer.concat([originalAsset, Buffer.from("\n// tampered-web-asset\n", "utf-8")]);
  const manifest = JSON.parse(originalManifest.toString("utf-8"));
  const assetRelativePath = path.relative(packageRoot, markedAssetPath).replaceAll("\\", "/");
  const assetEntry = manifest.content?.files?.find((entry: { path?: string }) => entry.path === assetRelativePath);
  if (!assetEntry) throw new Error("release-light fixture is missing the marked asset.");
  assetEntry.sha256 = crypto.createHash("sha256").update(tamperedAsset).digest("hex");
  assetEntry.size = tamperedAsset.byteLength;
  manifest.content.totalBytes += tamperedAsset.byteLength - originalAsset.byteLength;
  const updatedManifest = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  const updatedManifestHash = crypto.createHash("sha256").update(updatedManifest).digest("hex");
  const updatedSha256 = originalSha256.toString("utf-8")
    .split(/\r?\n/)
    .map((line) => line.endsWith(`  ${manifestName}`) ? `${updatedManifestHash}  ${manifestName}` : line)
    .join("\n");
  await Promise.all([
    fsp.writeFile(markedAssetPath, tamperedAsset),
    fsp.writeFile(manifestPath, updatedManifest),
    fsp.writeFile(sha256Path, updatedSha256),
  ]);

  try {
    const result = spawnSync(process.execPath, ["scripts/verify-release-light-assets.mjs"], {
      cwd: workspaceRoot,
      env: releaseLightEnvironment(),
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Web asset hash mismatch for marked");
  } finally {
    await Promise.all([
      fsp.writeFile(markedAssetPath, originalAsset),
      fsp.writeFile(manifestPath, originalManifest),
      fsp.writeFile(sha256Path, originalSha256),
    ]);
  }
}, 120_000);

test("release-light verifier rejects another source or BuildGraph identity with a valid outer manifest hash", async () => {
  const versionRoot = path.join(releaseRoot, `v${version}`);
  const packageRootName = `star-sanctuary-dist-v${version}`;
  const manifestName = `${packageRootName}.manifest.json`;
  const manifestPath = path.join(versionRoot, manifestName);
  const sha256Path = path.join(versionRoot, `${packageRootName}.sha256`);
  const originalManifest = await fsp.readFile(manifestPath);
  const originalSha256 = await fsp.readFile(sha256Path);
  const manifest = JSON.parse(originalManifest.toString("utf-8"));
  const currentCommitSha = String(manifest.releaseIdentity?.commitSha || "");
  const currentBuildGraphSha256 = String(manifest.releaseIdentity?.buildGraphSha256 || "");

  // 同步外层 hash，确保失败由 ReleaseIdentity owner 而不是 sha256 文件抢先触发。
  const writeManifestWithOuterHash = async () => {
    const content = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
    const contentSha256 = crypto.createHash("sha256").update(content).digest("hex");
    const sha256 = originalSha256.toString("utf-8")
      .split(/\r?\n/)
      .map((line) => line.endsWith(`  ${manifestName}`) ? `${contentSha256}  ${manifestName}` : line)
      .join("\n");
    await Promise.all([
      fsp.writeFile(manifestPath, content),
      fsp.writeFile(sha256Path, sha256),
    ]);
  };
  const runVerifier = () => spawnSync(process.execPath, ["scripts/verify-release-light-assets.mjs"], {
    cwd: workspaceRoot,
    env: releaseLightEnvironment(),
    encoding: "utf-8",
  });

  try {
    manifest.releaseIdentity.commitSha = (currentCommitSha.startsWith("0") ? "1" : "0")
      .repeat(currentCommitSha.length);
    await writeManifestWithOuterHash();
    const sourceResult = runVerifier();

    expect(sourceResult.status).toBe(1);
    expect(sourceResult.stderr).toContain("Release identity commit SHA mismatch");

    manifest.releaseIdentity.commitSha = currentCommitSha;
    manifest.releaseIdentity.buildGraphSha256 = (currentBuildGraphSha256.startsWith("0") ? "1" : "0")
      .repeat(currentBuildGraphSha256.length);
    await writeManifestWithOuterHash();
    const buildGraphResult = runVerifier();

    expect(buildGraphResult.status).toBe(1);
    expect(buildGraphResult.stderr).toContain("Release identity BuildGraph SHA-256 mismatch");
  } finally {
    await Promise.all([
      fsp.writeFile(manifestPath, originalManifest),
      fsp.writeFile(sha256Path, originalSha256),
    ]);
  }
}, 120_000);

test("release-light verifier rejects a staged package with a missing manifest bin", async () => {
  const sourceBinPath = path.join(
    workspaceRoot,
    "packages",
    "belldandy-browser",
    "bin",
    "relay.mjs",
  );
  const stagedBinPath = path.join(
    releaseRoot,
    `v${version}`,
    `star-sanctuary-dist-v${version}`,
    "packages",
    "belldandy-browser",
    "bin",
    "relay.mjs",
  );
  await fsp.rm(stagedBinPath);

  try {
    const result = spawnSync(process.execPath, ["scripts/verify-release-light-assets.mjs"], {
      cwd: workspaceRoot,
      env: releaseLightEnvironment(),
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "@belldandy/browser -> missing bin/relay.mjs (bin belldandy-relay)",
    );
  } finally {
    await fsp.copyFile(sourceBinPath, stagedBinPath);
  }
}, 120_000);
