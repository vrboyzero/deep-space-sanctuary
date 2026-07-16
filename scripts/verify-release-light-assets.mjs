import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  collectPackageArtifactFailures,
  resolveReleaseVersion,
} from "./artifact-contract.mjs";

const workspaceRoot = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "package.json"), "utf-8"));
const versionArg = process.argv.find((arg) => arg.startsWith("--version="));
const version = resolveReleaseVersion({
  releaseName: "release-light",
  packageVersion: packageJson.version,
  requestedVersion: versionArg?.slice("--version=".length),
});

// 与 builder 使用同一可选输出根，保证隔离构建能在不触碰共享 artifacts 的情况下验收。
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
const defaultEnvTemplatePath = path.join(
  packageRoot,
  "packages",
  "star-sanctuary-distribution",
  "src",
  "templates",
  "default-env",
  "runtime.env",
);
const defaultEnvLocalTemplatePath = path.join(
  packageRoot,
  "packages",
  "star-sanctuary-distribution",
  "src",
  "templates",
  "default-env",
  "runtime.env.local",
);

function assertExists(targetPath) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Missing release-light artifact: ${path.relative(workspaceRoot, targetPath)}`);
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function collectStagedPackageArtifactFailures() {
  const failures = [];
  const packagesDir = path.join(packageRoot, "packages");
  if (!fs.existsSync(packagesDir)) {
    return ["release-light -> missing packages"];
  }

  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageDir = path.join(packagesDir, entry.name);
    const packageJsonPath = path.join(packageDir, "package.json");
    if (!fs.existsSync(packageJsonPath)) continue;
    const stagedPackageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    if (
      typeof stagedPackageJson.name !== "string"
      || (!stagedPackageJson.name.startsWith("@belldandy/")
        && !stagedPackageJson.name.startsWith("@star-sanctuary/"))
    ) {
      continue;
    }
    failures.push(...collectPackageArtifactFailures({ packageDir, packageJson: stagedPackageJson }));
  }

  return failures;
}

function main() {
  for (const requiredPath of [packageRoot, zipPath, tarGzPath, manifestPath, sha256Path]) {
    assertExists(requiredPath);
  }
  for (const requiredPath of [defaultEnvTemplatePath, defaultEnvLocalTemplatePath]) {
    assertExists(requiredPath);
  }

  const packageArtifactFailures = collectStagedPackageArtifactFailures();
  if (packageArtifactFailures.length > 0) {
    throw new Error(
      `release-light package artifacts are incomplete:\n- ${packageArtifactFailures.join("\n- ")}`,
    );
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  if (manifest.version !== version) {
    throw new Error(`release-light manifest version mismatch: expected ${version}, got ${String(manifest.version)}`);
  }
  if (manifest.releaseKind !== "light") {
    throw new Error(`release-light manifest kind mismatch: ${String(manifest.releaseKind)}`);
  }
  if (manifest.includesRuntime !== false || manifest.includesNodeModules !== false) {
    throw new Error("release-light manifest flags must declare no runtime and no node_modules.");
  }

  const shaLines = fs.readFileSync(sha256Path, "utf-8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const expectedFiles = new Map([
    [path.basename(zipPath), sha256File(zipPath)],
    [path.basename(tarGzPath), sha256File(tarGzPath)],
    [path.basename(manifestPath), sha256File(manifestPath)],
  ]);

  for (const line of shaLines) {
    const match = /^([a-f0-9]{64})\s+(.+)$/.exec(line);
    if (!match) {
      throw new Error(`Invalid sha256 line: ${line}`);
    }
    const [, actualHash, fileName] = match;
    const expectedHash = expectedFiles.get(fileName);
    if (!expectedHash) {
      throw new Error(`Unexpected file in sha256 manifest: ${fileName}`);
    }
    if (actualHash !== expectedHash) {
      throw new Error(`sha256 mismatch for ${fileName}`);
    }
    expectedFiles.delete(fileName);
  }

  if (expectedFiles.size > 0) {
    throw new Error(`sha256 file missing entries: ${[...expectedFiles.keys()].join(", ")}`);
  }

  console.log(`[verify:release-light] verified ${path.relative(workspaceRoot, versionRoot)}`);
}

main();
