import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolvePortableArtifactRoot } from "../packages/star-sanctuary-distribution/scripts/distribution-mode.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "package.json"), "utf-8"));
const DEFAULT_PACKAGE_IDENTIFIER = "Vrboyzero.StarSanctuary";
const DEFAULT_PUBLISHER = "Vrboyzero";
const DEFAULT_MONIKER = "starsanctuary";
const DEFAULT_COMMAND_ALIAS = "star-sanctuary";
const DEFAULT_PACKAGE_LOCALE = "en-US";
const DEFAULT_MANIFEST_VERSION = "1.10.0";
const DEFAULT_PLATFORM = "win32";
const DEFAULT_ARCH = "x64";
const portableArtifactVerifierPath = path.join(
  workspaceRoot,
  "packages",
  "star-sanctuary-distribution",
  "scripts",
  "verify-portable-artifacts.mjs",
);

function getArg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function normalizeMode(value) {
  if (!value) return "slim";
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "slim" || normalized === "full") {
    return normalized;
  }
  throw new Error(`Unsupported winget mode: ${value}`);
}

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function resetDir(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
  fs.mkdirSync(targetPath, { recursive: true });
}

function readJson(targetPath) {
  return JSON.parse(fs.readFileSync(targetPath, "utf-8"));
}

function sha256File(targetPath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(targetPath));
  return hash.digest("hex").toUpperCase();
}

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "pipe",
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}\n${result.stderr || result.stdout}`);
  }
}

function verifyPortableArtifactForDerivedBuild(portableRoot, mode) {
  runCommand(process.execPath, [
    portableArtifactVerifierPath,
    `--mode=${mode}`,
    `--portable-root=${portableRoot}`,
  ], workspaceRoot);
}

function createZipArchive(versionRoot, stageRootName, zipFileName) {
  const zipPath = path.join(versionRoot, zipFileName);
  fs.rmSync(zipPath, { force: true });
  if (process.platform === "win32") {
    runCommand("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${stageRootName}' -DestinationPath '${zipFileName}' -CompressionLevel Optimal`,
    ], versionRoot);
    return;
  }
  runCommand("zip", ["-qr", zipFileName, stageRootName], versionRoot);
}

function shouldExcludePortableEntry(relativePath) {
  if (!relativePath) return false;
  const normalized = relativePath.replaceAll("\\", "/");
  const parts = normalized.split("/");
  const baseName = parts[parts.length - 1];

  if (baseName === ".env" || baseName === ".env.local") {
    return true;
  }
  if (/\.previous-\d+$/i.test(baseName)) {
    return true;
  }
  if (/\.portable-runtime-recovery-/i.test(baseName)) {
    return true;
  }
  if (/\.(stdout|stderr)\.log$/i.test(baseName)) {
    return true;
  }
  if (/(?:^|[-.])(smoke|verify|lifecycle|deps)-report\.json$/i.test(baseName)) {
    return true;
  }
  if (baseName === "Thumbs.db" || baseName === ".DS_Store") {
    return true;
  }
  return false;
}

function copyPortableTree(sourceRoot, destinationRoot) {
  fs.cpSync(sourceRoot, destinationRoot, {
    recursive: true,
    force: true,
    dereference: true,
    filter: (sourcePath) => {
      const relativePath = path.relative(sourceRoot, sourcePath);
      return !shouldExcludePortableEntry(relativePath);
    },
  });
}

function yamlScalar(value) {
  const text = String(value);
  if (/^[A-Za-z0-9._:/+-]+$/.test(text)) {
    return text;
  }
  return JSON.stringify(text);
}

function writeText(targetPath, content) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, `${content.trimEnd()}\n`, "utf-8");
}

function removePath(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function buildDefaultLocaleManifest(params) {
  const {
    packageIdentifier,
    version,
    packageLocale,
    publisher,
    publisherUrl,
    publisherSupportUrl,
    packageName,
    packageUrl,
    license,
    licenseUrl,
    shortDescription,
    description,
    moniker,
    releaseNotesUrl,
    manifestVersion,
  } = params;

  return [
    `PackageIdentifier: ${yamlScalar(packageIdentifier)}`,
    `PackageVersion: ${yamlScalar(version)}`,
    `PackageLocale: ${yamlScalar(packageLocale)}`,
    `Publisher: ${yamlScalar(publisher)}`,
    `PublisherUrl: ${yamlScalar(publisherUrl)}`,
    `PublisherSupportUrl: ${yamlScalar(publisherSupportUrl)}`,
    `PackageName: ${yamlScalar(packageName)}`,
    `PackageUrl: ${yamlScalar(packageUrl)}`,
    `License: ${yamlScalar(license)}`,
    `LicenseUrl: ${yamlScalar(licenseUrl)}`,
    `ShortDescription: ${yamlScalar(shortDescription)}`,
    `Description: ${yamlScalar(description)}`,
    `Moniker: ${yamlScalar(moniker)}`,
    "Tags:",
    "  - ai",
    "  - agent",
    "  - assistant",
    "  - automation",
    "  - local-first",
    `ReleaseNotesUrl: ${yamlScalar(releaseNotesUrl)}`,
    "ManifestType: defaultLocale",
    `ManifestVersion: ${yamlScalar(manifestVersion)}`,
  ].join("\n");
}

function buildInstallerManifest(params) {
  const {
    packageIdentifier,
    version,
    manifestVersion,
    nestedInstallerRelativeFilePath,
    portableCommandAlias,
    installerUrl,
    installerSha256,
  } = params;

  return [
    `PackageIdentifier: ${yamlScalar(packageIdentifier)}`,
    `PackageVersion: ${yamlScalar(version)}`,
    "InstallerType: zip",
    "NestedInstallerType: portable",
    "NestedInstallerFiles:",
    `  - RelativeFilePath: ${yamlScalar(nestedInstallerRelativeFilePath)}`,
    `    PortableCommandAlias: ${yamlScalar(portableCommandAlias)}`,
    "Installers:",
    "  - Architecture: x64",
    `    InstallerUrl: ${yamlScalar(installerUrl)}`,
    `    InstallerSha256: ${yamlScalar(installerSha256)}`,
    "ManifestType: installer",
    `ManifestVersion: ${yamlScalar(manifestVersion)}`,
  ].join("\n");
}

function buildVersionManifest(params) {
  const { packageIdentifier, version, packageLocale, manifestVersion } = params;
  return [
    `PackageIdentifier: ${yamlScalar(packageIdentifier)}`,
    `PackageVersion: ${yamlScalar(version)}`,
    `DefaultLocale: ${yamlScalar(packageLocale)}`,
    "ManifestType: version",
    `ManifestVersion: ${yamlScalar(manifestVersion)}`,
  ].join("\n");
}

function main() {
  const mode = normalizeMode(getArg("mode"));
  const platform = getArg("platform") || DEFAULT_PLATFORM;
  const arch = getArg("arch") || DEFAULT_ARCH;
  const portableRoot = path.resolve(
    getArg("portable-root")
      || resolvePortableArtifactRoot({
        workspaceRoot,
        platform,
        arch,
        mode,
      }),
  );
  const versionFilePath = path.join(portableRoot, "version.json");
  const executablePath = path.join(portableRoot, "star-sanctuary.exe");
  const runtimeManifestPath = path.join(portableRoot, "runtime-manifest.json");

  if (!fs.existsSync(portableRoot)) {
    throw new Error(`Portable root does not exist: ${portableRoot}`);
  }
  if (!fs.existsSync(versionFilePath) || !fs.existsSync(executablePath) || !fs.existsSync(runtimeManifestPath)) {
    throw new Error(`Portable artifact is incomplete at ${portableRoot}. Run 'corepack pnpm build:portable${mode === "full" ? ":full" : ""}' first.`);
  }

  const portableVersion = readJson(versionFilePath);
  const version = String(getArg("version") || portableVersion.version || packageJson.version || "").trim();
  if (!version) {
    throw new Error("Failed to resolve winget version.");
  }
  if (String(portableVersion.version || "").trim() !== version) {
    throw new Error(`Portable artifact version mismatch: expected ${version}, got ${String(portableVersion.version || "")}.`);
  }
  verifyPortableArtifactForDerivedBuild(portableRoot, mode);

  const distributionMode = String(portableVersion.distributionMode || mode || "slim").trim().toLowerCase();
  const modeSuffix = distributionMode === "full" ? "-full" : "";
  const assetBaseName = `star-sanctuary-portable-${platform}-${arch}${modeSuffix}-v${version}`;
  const versionRoot = path.join(workspaceRoot, "artifacts", "winget", `v${version}`);
  const stageRoot = path.join(versionRoot, assetBaseName);
  const zipPath = path.join(versionRoot, `${assetBaseName}.zip`);
  const sha256Path = path.join(versionRoot, `${assetBaseName}.sha256`);
  const metadataPath = path.join(versionRoot, `${assetBaseName}.metadata.json`);
  const packageIdentifier = getArg("package-id") || DEFAULT_PACKAGE_IDENTIFIER;
  const packageIdentifierParts = packageIdentifier.split(".");
  if (packageIdentifierParts.length < 2) {
    throw new Error(`PackageIdentifier must contain at least one dot: ${packageIdentifier}`);
  }
  const manifestVersion = getArg("manifest-version") || DEFAULT_MANIFEST_VERSION;
  const packageLocale = getArg("package-locale") || DEFAULT_PACKAGE_LOCALE;
  const publisher = getArg("publisher") || DEFAULT_PUBLISHER;
  const moniker = getArg("moniker") || DEFAULT_MONIKER;
  const portableCommandAlias = getArg("command-alias") || DEFAULT_COMMAND_ALIAS;
  const owner = getArg("repo-owner") || "vrboyzero";
  const repo = getArg("repo-name") || "star-sanctuary";
  const releaseDownloadBase = getArg("release-download-base") || `https://github.com/${owner}/${repo}/releases/download/v${version}`;
  const installerUrl = `${releaseDownloadBase}/${path.basename(zipPath)}`;
  const nestedInstallerRelativeFilePath = `${assetBaseName}/star-sanctuary.exe`;
  const manifestDir = path.join(
    versionRoot,
    "manifests",
    packageIdentifierParts[0][0].toLowerCase(),
    ...packageIdentifierParts,
    version,
  );
  const publisherUrl = getArg("publisher-url") || `https://github.com/${owner}`;
  const publisherSupportUrl = getArg("publisher-support-url") || `https://github.com/${owner}/${repo}/issues`;
  const packageUrl = getArg("package-url") || `https://github.com/${owner}/${repo}`;
  const license = getArg("license") || "MIT";
  const licenseUrl = getArg("license-url") || `https://github.com/${owner}/${repo}/blob/main/LICENSE`;
  const packageName = getArg("package-name") || "Star Sanctuary";
  const shortDescription = getArg("short-description")
    || "Local-first AI assistant with WebChat, tools, memory, and browser automation.";
  const description = getArg("description")
    || "Star Sanctuary is a local-first personal AI assistant that combines WebChat, agent tools, long-term memory, browser automation, and a local gateway runtime in one Windows package.";
  const releaseNotesUrl = getArg("release-notes-url") || `https://github.com/${owner}/${repo}/releases/tag/v${version}`;

  resetDir(versionRoot);
  copyPortableTree(portableRoot, stageRoot);
  createZipArchive(versionRoot, assetBaseName, path.basename(zipPath));
  removePath(stageRoot);

  const installerSha256 = sha256File(zipPath);
  writeText(sha256Path, `${installerSha256}  ${path.basename(zipPath)}`);

  const versionManifestPath = path.join(manifestDir, `${packageIdentifier}.yaml`);
  const installerManifestPath = path.join(manifestDir, `${packageIdentifier}.installer.yaml`);
  const localeManifestPath = path.join(manifestDir, `${packageIdentifier}.locale.${packageLocale}.yaml`);
  writeText(versionManifestPath, buildVersionManifest({
    packageIdentifier,
    version,
    packageLocale,
    manifestVersion,
  }));
  writeText(installerManifestPath, buildInstallerManifest({
    packageIdentifier,
    version,
    manifestVersion,
    nestedInstallerRelativeFilePath,
    portableCommandAlias,
    installerUrl,
    installerSha256,
  }));
  writeText(localeManifestPath, buildDefaultLocaleManifest({
    packageIdentifier,
    version,
    packageLocale,
    publisher,
    publisherUrl,
    publisherSupportUrl,
    packageName,
    packageUrl,
    license,
    licenseUrl,
    shortDescription,
    description,
    moniker,
    releaseNotesUrl,
    manifestVersion,
  }));

  const metadata = {
    schemaVersion: 1,
    product: "star-sanctuary",
    distributionKind: "winget-portable",
    packageIdentifier,
    publisher,
    version,
    distributionMode,
    platform,
    arch,
    portableRoot,
    generatedAt: new Date().toISOString(),
    stagingDirectoryRetained: false,
    asset: {
      fileName: path.basename(zipPath),
      path: path.relative(workspaceRoot, zipPath).replaceAll("\\", "/"),
      size: fs.statSync(zipPath).size,
      sha256: installerSha256,
      installerUrl,
      nestedInstallerRelativeFilePath,
      portableCommandAlias,
    },
    manifests: {
      manifestVersion,
      packageLocale,
      packageName,
      moniker,
      root: path.relative(workspaceRoot, manifestDir).replaceAll("\\", "/"),
      files: [
        path.relative(workspaceRoot, versionManifestPath).replaceAll("\\", "/"),
        path.relative(workspaceRoot, installerManifestPath).replaceAll("\\", "/"),
        path.relative(workspaceRoot, localeManifestPath).replaceAll("\\", "/"),
      ],
    },
  };
  writeText(metadataPath, JSON.stringify(metadata, null, 2));

  console.log(`[build:winget] created ${path.relative(workspaceRoot, zipPath)}`);
  console.log(`[build:winget] created ${path.relative(workspaceRoot, sha256Path)}`);
  console.log(`[build:winget] created ${path.relative(workspaceRoot, metadataPath)}`);
  console.log(`[build:winget] created ${path.relative(workspaceRoot, manifestDir)}`);
}

main();
