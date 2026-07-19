import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";
import { resolveDistributionMode, resolvePortableArtifactRoot, resolveSingleExeArtifactRoot } from "./distribution-mode.mjs";
import { renderSingleExeGuide, renderSingleExeGuideZh } from "./distribution-user-guide.mjs";
import { guardedRemovePath } from "./sandbox-paths.mjs";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..", "..", "..");
const require = createRequire(import.meta.url);
const rootPackageJson = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "package.json"), "utf-8"));
const workspaceVersion = String(rootPackageJson.version || "0.0.0");
const platform = process.platform;
const arch = process.arch;
const distribution = resolveDistributionMode();
const { mode } = distribution;
const portableRoot = resolvePortableArtifactRoot({
  workspaceRoot,
  platform,
  arch,
  mode,
});
const singleExeRoot = resolveSingleExeArtifactRoot({
  workspaceRoot,
  platform,
  arch,
  mode,
});
const buildRoot = path.join(workspaceRoot, "artifacts", "_cache", "single-exe-build", path.basename(singleExeRoot));
const runtimeManifestPath = path.join(portableRoot, "runtime-manifest.json");
const portableVersionPath = path.join(portableRoot, "version.json");
const portableExecutablePath = path.join(portableRoot, "star-sanctuary.exe");
const distEntryPath = path.join(
  workspaceRoot,
  "packages",
  "star-sanctuary-distribution",
  "dist",
  "single-exe-entry.js",
);
const bundledMainPath = path.join(buildRoot, "single-exe-main.cjs");
const seaConfigPath = path.join(buildRoot, "sea-config.json");
const seaBlobPath = path.join(buildRoot, "sea-prep.blob");
const executablePath = path.join(singleExeRoot, "star-sanctuary-single.exe");
const metadataPath = path.join(singleExeRoot, "single-exe.json");
const readmePath = path.join(singleExeRoot, "README-single-exe.md");
const readmeZhPath = path.join(singleExeRoot, "README-single-exe-zh.md");
const envExamplePath = path.join(singleExeRoot, ".env.example");
const NODE_SEA_SENTINEL_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const embeddedNodeRuntimeAssetPath = path.join(buildRoot, "node-runtime.exe.gz");
const esbuildCliPath = require.resolve("esbuild/bin/esbuild");
const artifactsRoot = path.join(workspaceRoot, "artifacts");
const portableArtifactVerifierPath = path.join(
  workspaceRoot,
  "packages",
  "star-sanctuary-distribution",
  "scripts",
  "verify-portable-artifacts.mjs",
);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function archiveExistingDirectory(targetPath) {
  if (!fs.existsSync(targetPath)) return undefined;
  const archivePath = `${targetPath}.previous-${Date.now()}`;
  fs.renameSync(targetPath, archivePath);
  return archivePath;
}

function assertExists(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Missing ${label}: ${targetPath}`);
  }
}

function copyFile(src, dest) {
  assertExists(src, "file");
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function portableArtifactExists() {
  return (
    fs.existsSync(portableVersionPath)
    && fs.existsSync(runtimeManifestPath)
    && fs.existsSync(portableExecutablePath)
    && fs.existsSync(path.join(portableRoot, "runtime"))
  );
}

function assertPortableVersionMatchesWorkspace() {
  assertExists(portableVersionPath, "portable version metadata");
  const portableVersionFile = JSON.parse(fs.readFileSync(portableVersionPath, "utf-8"));
  const portableVersion = String(portableVersionFile.version || "");
  if (portableVersion !== workspaceVersion) {
    throw new Error(
      `Portable artifact version mismatch: expected ${workspaceVersion}, got ${portableVersion}. `
      + `Run 'corepack pnpm build:portable${mode === "full" ? ":full" : ""}' first.`,
    );
  }
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: workspaceRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}`);
  }
}

function verifyPortableArtifactForDerivedBuild() {
  runCommand(process.execPath, [
    portableArtifactVerifierPath,
    `--mode=${mode}`,
    `--portable-root=${portableRoot}`,
  ], {
    shell: false,
  });
}

function normalizeAssetKey(key) {
  return key.split(path.sep).join("/");
}

function writeEmbeddedNodeRuntimeAsset() {
  fs.writeFileSync(embeddedNodeRuntimeAssetPath, gzipSync(fs.readFileSync(portableExecutablePath)));
  return embeddedNodeRuntimeAssetPath;
}

function loadPortableRuntimeAssets() {
  const runtimeManifest = JSON.parse(fs.readFileSync(runtimeManifestPath, "utf-8"));
  const assets = {
    "portable/version.json": portableVersionPath,
    "portable/runtime-manifest.json": runtimeManifestPath,
    "portable/node-runtime.exe.gz": writeEmbeddedNodeRuntimeAsset(),
  };

  for (const entry of runtimeManifest.files) {
    if (entry.type !== "file") continue;
    const sourcePath = path.join(portableRoot, runtimeManifest.runtimeDir, ...entry.path.split("/"));
    assertExists(sourcePath, `runtime asset for ${entry.path}`);
    assets[normalizeAssetKey(path.join("portable", runtimeManifest.runtimeDir, entry.path))] = sourcePath;
  }

  return { runtimeManifest, assets };
}

function bundleSeaMain() {
  assertExists(distEntryPath, "single-exe dist entry");
  runCommand(process.execPath, [
    esbuildCliPath,
    distEntryPath,
    "--bundle",
    "--format=cjs",
    "--platform=node",
    "--target=node22",
    `--outfile=${bundledMainPath}`,
    "--legal-comments=none",
  ], {
    shell: false,
  });
}

function writeSeaConfig(assets) {
  const payload = {
    main: bundledMainPath,
    output: seaBlobPath,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    assets,
  };
  fs.writeFileSync(seaConfigPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

function injectSeaBlob() {
  fs.copyFileSync(process.execPath, executablePath);
  runCommand("corepack", [
    "pnpm",
    "exec",
    "postject",
    executablePath,
    "NODE_SEA_BLOB",
    seaBlobPath,
    "--sentinel-fuse",
    NODE_SEA_SENTINEL_FUSE,
  ]);
}

function writeSingleExeReadme(versionFile) {
  const versionKey = `${versionFile.version}-${versionFile.platform}-${versionFile.arch}`;
  const params = {
    executableName: path.basename(executablePath),
    distributionPolicy: versionFile.distributionPolicy,
    mode: versionFile.distributionMode ?? (versionFile.includeOptionalNative ? "full" : "slim"),
    runtimeHomeHint: `%LOCALAPPDATA%\\StarSanctuary\\runtime\\${versionKey}`,
  };
  fs.writeFileSync(readmePath, renderSingleExeGuide(params), "utf-8");
  fs.writeFileSync(readmeZhPath, renderSingleExeGuideZh(params), "utf-8");
}

function writeSingleExeMetadata(runtimeManifest) {
  const versionFile = JSON.parse(fs.readFileSync(portableVersionPath, "utf-8"));
  const payload = {
    productName: versionFile.productName,
    version: versionFile.version,
    distributionMode: versionFile.distributionMode ?? (versionFile.includeOptionalNative ? "full" : "slim"),
    distributionPolicy: versionFile.distributionPolicy,
    dependencySnapshot: versionFile.dependencySnapshot,
    platform,
    arch,
    builtAt: new Date().toISOString(),
    executable: {
      path: path.basename(executablePath),
      size: fs.statSync(executablePath).size,
    },
    documentation: {
      readme: path.basename(readmePath),
      readmeZh: path.basename(readmeZhPath),
      envExample: path.basename(envExamplePath),
    },
    embeddedRuntime: {
      manifestPath: path.basename(runtimeManifestPath),
      runtimeSummary: runtimeManifest.summary,
    },
    sourcePortableRoot: portableRoot,
  };
  fs.writeFileSync(metadataPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

async function main() {
  if (platform !== "win32") {
    throw new Error(`Single-exe build currently only targets Windows. Current platform: ${platform}`);
  }

  if (!portableArtifactExists()) {
    throw new Error(
      `Portable artifact is missing or incomplete at ${portableRoot}. Run 'corepack pnpm build:portable${mode === "full" ? ":full" : ""}' first.`,
    );
  }
  assertPortableVersionMatchesWorkspace();
  verifyPortableArtifactForDerivedBuild();

  const archivedRoot = archiveExistingDirectory(singleExeRoot);
  guardedRemovePath(buildRoot, {
    allowedRoots: [artifactsRoot],
    label: "reset single-exe build root",
  });
  ensureDir(singleExeRoot);
  ensureDir(buildRoot);

  try {
    const { runtimeManifest, assets } = loadPortableRuntimeAssets();
    bundleSeaMain();
    writeSeaConfig(assets);
    runCommand(process.execPath, ["--experimental-sea-config", seaConfigPath], {
      shell: false,
    });
    injectSeaBlob();
    const versionFile = JSON.parse(fs.readFileSync(portableVersionPath, "utf-8"));
    writeSingleExeReadme(versionFile);
    copyFile(path.join(workspaceRoot, ".env.example"), envExamplePath);
    writeSingleExeMetadata(runtimeManifest);
  } catch (error) {
    if (fs.existsSync(singleExeRoot)) {
      guardedRemovePath(singleExeRoot, {
        allowedRoots: [artifactsRoot],
        label: "cleanup failed single-exe artifact root",
      });
    }
    if (archivedRoot) {
      fs.renameSync(archivedRoot, singleExeRoot);
    }
    throw error;
  }

  if (archivedRoot) {
    guardedRemovePath(archivedRoot, {
      allowedRoots: [artifactsRoot],
      label: "cleanup archived single-exe artifact root",
    });
  }

  console.log(`[single-exe] Built Star Sanctuary single-exe at ${executablePath}`);
}

await main();
