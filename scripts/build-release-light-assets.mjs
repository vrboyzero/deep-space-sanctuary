import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  copyPackageNonDistBinArtifacts,
  resolveReleaseVersion,
} from "./artifact-contract.mjs";

const workspaceRoot = process.cwd();
const packageJsonPath = path.join(workspaceRoot, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
const versionArg = process.argv.find((arg) => arg.startsWith("--version="));
const version = resolveReleaseVersion({
  releaseName: "release-light",
  packageVersion: packageJson.version,
  requestedVersion: versionArg?.slice("--version=".length),
});

// 测试或并行调用方可提供唯一输出根，避免共享 generated artifact 目录互相清理；
// 正式发布未设置该变量时仍保持既有 artifacts/release-light 布局。
const configuredReleaseRoot = process.env.BELLDANDY_RELEASE_LIGHT_ROOT?.trim();
const releaseRoot = configuredReleaseRoot
  ? path.resolve(workspaceRoot, configuredReleaseRoot)
  : path.join(workspaceRoot, "artifacts", "release-light");
const versionRoot = path.join(releaseRoot, `v${version}`);
const packageRootName = `star-sanctuary-dist-v${version}`;
const packageRoot = path.join(versionRoot, packageRootName);
const zipPath = path.join(versionRoot, `${packageRootName}.zip`);
const tarGzPath = path.join(versionRoot, `${packageRootName}.tar.gz`);
const manifestPath = path.join(versionRoot, `${packageRootName}.manifest.json`);
const sha256Path = path.join(versionRoot, `${packageRootName}.sha256`);

const PACKAGE_DIST_EXCLUDE_PATTERNS = [
  /\.map$/i,
  /\.test\.[^.]+$/i,
  /\.smoke\.test\.[^.]+$/i,
];

const ROOT_FILE_PATHS = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".env.example",
  "install.ps1",
  "install.sh",
  "start.bat",
  "start.sh",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
];

const DIRECTORY_COPY_PLAN = [
  { source: "apps/web/public", destination: "apps/web/public" },
  { source: "packages/belldandy-agent/src/templates", destination: "packages/belldandy-agent/src/templates" },
  { source: "packages/star-sanctuary-distribution/src/templates", destination: "packages/star-sanctuary-distribution/src/templates" },
  { source: "packages/belldandy-skills/src/bundled-skills", destination: "packages/belldandy-skills/src/bundled-skills" },
];

const PACKAGE_JSON_PLAN = [
  "apps/web/package.json",
];

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function resetDir(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
  fs.mkdirSync(targetPath, { recursive: true });
}

function assertExists(relativePath) {
  const absolutePath = path.join(workspaceRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Required release-light input is missing: ${relativePath}`);
  }
  return absolutePath;
}

function copyFileRelative(sourceRelativePath, destinationRelativePath = sourceRelativePath) {
  const sourcePath = assertExists(sourceRelativePath);
  const destinationPath = path.join(packageRoot, destinationRelativePath);
  ensureDir(path.dirname(destinationPath));
  fs.copyFileSync(sourcePath, destinationPath);
}

function shouldExcludeDistFile(relativePath) {
  return PACKAGE_DIST_EXCLUDE_PATTERNS.some((pattern) => pattern.test(relativePath));
}

function copyDirectoryFiltered(sourceRelativePath, destinationRelativePath, shouldExclude) {
  const sourcePath = assertExists(sourceRelativePath);
  const destinationPath = path.join(packageRoot, destinationRelativePath);

  for (const entry of fs.readdirSync(sourcePath, { withFileTypes: true })) {
    const entrySourcePath = path.join(sourcePath, entry.name);
    const entryDestinationPath = path.join(destinationPath, entry.name);
    const entryRelativePath = path.relative(sourcePath, entrySourcePath).replaceAll("\\", "/");

    if (entry.isDirectory()) {
      copyDirectoryFiltered(
        path.relative(workspaceRoot, entrySourcePath),
        path.relative(packageRoot, entryDestinationPath),
        shouldExclude,
      );
      continue;
    }

    if (shouldExclude?.(entryRelativePath)) {
      continue;
    }

    ensureDir(path.dirname(entryDestinationPath));
    fs.copyFileSync(entrySourcePath, entryDestinationPath);
  }
}

function copyPackageDistTrees() {
  const packagesRoot = path.join(workspaceRoot, "packages");
  for (const entry of fs.readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageName = entry.name;
    const packageRootPath = path.join("packages", packageName);
    const distRelativePath = path.join(packageRootPath, "dist");
    const packageJsonRelativePath = path.join(packageRootPath, "package.json");

    copyFileRelative(packageJsonRelativePath);
    const packageJson = JSON.parse(fs.readFileSync(path.join(workspaceRoot, packageJsonRelativePath), "utf-8"));
    copyPackageNonDistBinArtifacts({
      sourcePackageDir: path.join(workspaceRoot, packageRootPath),
      destinationPackageDir: path.join(packageRoot, packageRootPath),
      packageJson,
    });
    const distAbsolutePath = assertExists(distRelativePath);
    const stat = fs.statSync(distAbsolutePath);
    if (!stat.isDirectory()) {
      throw new Error(`Expected dist directory but found non-directory: ${distRelativePath}`);
    }
    copyDirectoryFiltered(distRelativePath, distRelativePath, shouldExcludeDistFile);
  }
}

function writeReleaseReadme() {
  const targetPath = path.join(packageRoot, "README-release-light.md");
  const content = [
    "# Star Sanctuary Release-Light Asset",
    "",
    `Version: ${version}`,
    "",
    "This package is a lightweight release artifact for GitHub Releases and future package-manager integration.",
    "",
    "Included:",
    "- built dist outputs",
    "- Web static assets",
    "- templates and bundled skills",
    "- install/start scripts and environment example",
    "",
    "Not included:",
    "- Node runtime",
    "- node_modules",
    "- portable runtime payload",
    "- single-exe payload",
    "",
    "This asset is the default command-installer input.",
  ].join("\n");
  fs.writeFileSync(targetPath, content, "utf-8");
}

function collectStageSummary() {
  const files = [];
  const rootPrefix = `${packageRoot}${path.sep}`;
  for (const absolutePath of walkFiles(packageRoot)) {
    const relativePath = absolutePath.startsWith(rootPrefix)
      ? absolutePath.slice(rootPrefix.length).replaceAll("\\", "/")
      : path.relative(packageRoot, absolutePath).replaceAll("\\", "/");
    const stat = fs.statSync(absolutePath);
    files.push({
      path: relativePath,
      size: stat.size,
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const totalBytes = files.reduce((sum, item) => sum + item.size, 0);
  return {
    fileCount: files.length,
    totalBytes,
    files,
  };
}

function* walkFiles(rootPath) {
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(entryPath);
      continue;
    }
    if (entry.isFile()) {
      yield entryPath;
    }
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: versionRoot,
    stdio: "pipe",
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}\n${result.stderr || result.stdout}`);
  }
}

function createZipArchive() {
  fs.rmSync(zipPath, { force: true });
  if (process.platform === "win32") {
    runCommand("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${packageRootName}' -DestinationPath '${path.basename(zipPath)}' -CompressionLevel Optimal`,
    ]);
    return;
  }
  runCommand("zip", ["-qr", path.basename(zipPath), packageRootName]);
}

function createTarGzArchive() {
  fs.rmSync(tarGzPath, { force: true });
  runCommand("tar", ["-czf", path.basename(tarGzPath), packageRootName]);
}

function writeManifest(stageSummary) {
  const archives = [zipPath, tarGzPath].map((archivePath) => ({
    fileName: path.basename(archivePath),
    size: fs.statSync(archivePath).size,
    sha256: sha256File(archivePath),
    format: archivePath.endsWith(".zip") ? "zip" : "tar.gz",
  }));

  const manifest = {
    schemaVersion: 1,
    product: "star-sanctuary",
    version,
    releaseKind: "light",
    generatedAt: new Date().toISOString(),
    packageRoot: packageRootName,
    currentInstallerInput: "release-light-archive",
    intendedConsumers: [
      "github-release-download",
      "official-website-download",
      "official-command-installer",
      "future-package-manager-prep",
    ],
    includesRuntime: false,
    includesNodeModules: false,
    content: {
      fileCount: stageSummary.fileCount,
      totalBytes: stageSummary.totalBytes,
      includedRoots: [
        "packages/*/dist",
        "packages/*/package.json",
        "packages/*/bin (when referenced by package.json#bin)",
        "apps/web/public",
        "apps/web/package.json",
        "packages/belldandy-agent/src/templates",
        "packages/star-sanctuary-distribution/src/templates",
        "packages/belldandy-skills/src/bundled-skills",
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        ".env.example",
        "install.ps1",
        "install.sh",
        "start.bat",
        "start.sh",
        "README.md",
        "CHANGELOG.md",
        "LICENSE",
      ],
      exclusions: [
        "node_modules/**",
        "artifacts/portable/**",
        "artifacts/single-exe/**",
        "**/*.map",
        "**/*.test.*",
        "**/*.smoke.test.*",
      ],
    },
    archives,
  };

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
}

function writeSha256File() {
  const lines = [zipPath, tarGzPath, manifestPath].map((filePath) => `${sha256File(filePath)}  ${path.basename(filePath)}`);
  fs.writeFileSync(sha256Path, `${lines.join("\n")}\n`, "utf-8");
}

function main() {
  ensureDir(releaseRoot);
  resetDir(versionRoot);
  ensureDir(packageRoot);

  for (const relativePath of ROOT_FILE_PATHS) {
    copyFileRelative(relativePath);
  }

  for (const relativePath of PACKAGE_JSON_PLAN) {
    copyFileRelative(relativePath);
  }

  for (const plan of DIRECTORY_COPY_PLAN) {
    copyDirectoryFiltered(plan.source, plan.destination);
  }

  copyPackageDistTrees();
  writeReleaseReadme();

  const stageSummary = collectStageSummary();
  createZipArchive();
  createTarGzArchive();
  writeManifest(stageSummary);
  writeSha256File();

  console.log(`[build:release-light] created ${path.relative(workspaceRoot, zipPath)}`);
  console.log(`[build:release-light] created ${path.relative(workspaceRoot, tarGzPath)}`);
  console.log(`[build:release-light] created ${path.relative(workspaceRoot, manifestPath)}`);
  console.log(`[build:release-light] created ${path.relative(workspaceRoot, sha256Path)}`);
  console.log(
    `[build:release-light] staged ${stageSummary.fileCount} file(s), ${(stageSummary.totalBytes / (1024 * 1024)).toFixed(2)} MiB unpacked.`,
  );
}

main();
