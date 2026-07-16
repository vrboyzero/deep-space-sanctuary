import fs from "node:fs";
import path from "node:path";

function collectStringTargets(value, targets = []) {
  if (typeof value === "string") {
    targets.push(value);
    return targets;
  }
  if (!value || typeof value !== "object") return targets;
  for (const nested of Object.values(value)) {
    collectStringTargets(nested, targets);
  }
  return targets;
}

function normalizeTarget(relativePath) {
  return relativePath.replace(/^\.\//, "");
}

function collectPackageArtifactTargets(packageJson, packageName) {
  const targets = [];

  if (typeof packageJson?.main === "string") {
    targets.push({ relativePath: packageJson.main, label: "", kind: "entry" });
  }
  if (typeof packageJson?.types === "string") {
    targets.push({ relativePath: packageJson.types, label: "", kind: "entry" });
  }
  for (const relativePath of collectStringTargets(packageJson?.exports)) {
    targets.push({ relativePath, label: "", kind: "entry" });
  }

  if (typeof packageJson?.bin === "string") {
    targets.push({
      relativePath: packageJson.bin,
      label: `bin ${packageName}`,
      kind: "bin",
      commandName: packageName,
    });
  } else if (packageJson?.bin && typeof packageJson.bin === "object") {
    for (const [commandName, relativePath] of Object.entries(packageJson.bin)) {
      if (typeof relativePath === "string") {
        targets.push({
          relativePath,
          label: `bin ${commandName}`,
          kind: "bin",
          commandName,
        });
      }
    }
  }

  if (Array.isArray(packageJson?.files)) {
    for (const relativePath of packageJson.files) {
      if (typeof relativePath === "string") {
        targets.push({ relativePath, label: "files entry", kind: "resource" });
      }
    }
  }

  return targets;
}

export function resolveReleaseVersion({ releaseName, packageVersion, requestedVersion }) {
  const normalizedPackageVersion = String(packageVersion ?? "").trim();
  if (!normalizedPackageVersion) {
    throw new Error(`Failed to resolve ${releaseName} package version.`);
  }

  const normalizedRequestedVersion = String(requestedVersion ?? "").trim();
  if (normalizedRequestedVersion && normalizedRequestedVersion !== normalizedPackageVersion) {
    throw new Error(
      `${releaseName} version mismatch: package.json declares ${normalizedPackageVersion}, requested ${normalizedRequestedVersion}`,
    );
  }

  return normalizedPackageVersion;
}

function isPathWithinRoot(rootPath, targetPath) {
  const relativePath = path.relative(rootPath, targetPath);
  return relativePath === ""
    || (relativePath !== ".."
      && !relativePath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativePath));
}

export function collectPackageArtifactFailures({ packageDir, packageJson }) {
  const packageName = typeof packageJson?.name === "string" ? packageJson.name : "<unknown-package>";
  const targets = collectPackageArtifactTargets(packageJson, packageName);

  const failures = [];
  const seen = new Set();
  const resolvedPackageDir = path.resolve(packageDir);
  const realPackageDir = fs.realpathSync(resolvedPackageDir);
  for (const target of targets) {
    const normalized = normalizeTarget(target.relativePath);
    const identity = `${normalized}\0${target.label}`;
    if (seen.has(identity)) continue;
    seen.add(identity);

    const suffix = target.label ? ` (${target.label})` : "";
    // Resolve before checking existence so an existing path outside the package cannot satisfy the contract.
    const resolvedTarget = path.resolve(resolvedPackageDir, normalized);
    if (!isPathWithinRoot(resolvedPackageDir, resolvedTarget)) {
      failures.push(`${packageName} -> invalid ${normalized}${suffix}: target escapes package root`);
      continue;
    }

    if (!fs.existsSync(resolvedTarget)) {
      failures.push(`${packageName} -> missing ${normalized}${suffix}`);
      continue;
    }

    const realTarget = fs.realpathSync(resolvedTarget);
    if (!isPathWithinRoot(realPackageDir, realTarget)) {
      failures.push(`${packageName} -> invalid ${normalized}${suffix}: target resolves outside package root`);
    }
  }
  return failures;
}

export function collectPackageNonDistBinArtifacts({ packageDir, packageJson }) {
  const failures = collectPackageArtifactFailures({
    packageDir,
    packageJson,
  });
  if (failures.length > 0) {
    throw new Error(`Package artifact inventory is invalid:\n- ${failures.join("\n- ")}`);
  }

  const packageName = typeof packageJson?.name === "string" ? packageJson.name : "<unknown-package>";
  const sourceRoot = path.resolve(packageDir);
  const sourceDistRoot = path.join(sourceRoot, "dist");
  const inventory = [];

  for (const target of collectPackageArtifactTargets(packageJson, packageName)) {
    if (target.kind !== "bin") continue;

    const relativePath = normalizeTarget(target.relativePath);
    const sourcePath = path.resolve(sourceRoot, relativePath);
    if (isPathWithinRoot(sourceDistRoot, sourcePath)) {
      continue;
    }

    const sourceStat = fs.statSync(sourcePath);
    if (!sourceStat.isFile()) {
      throw new Error(`${packageName} -> invalid ${relativePath} (${target.label}): bin target must be a file`);
    }

    inventory.push({
      commandName: target.commandName,
      relativePath: relativePath.replaceAll("\\", "/"),
      sourcePath,
      sourceMode: sourceStat.mode,
    });
  }

  return inventory;
}

export function copyPackageNonDistBinArtifacts({
  sourcePackageDir,
  destinationPackageDir,
  packageJson,
}) {
  const packageName = typeof packageJson?.name === "string" ? packageJson.name : "<unknown-package>";
  const destinationRoot = path.resolve(destinationPackageDir);
  const copied = [];
  const copiedPaths = new Set();

  for (const asset of collectPackageNonDistBinArtifacts({
    packageDir: sourcePackageDir,
    packageJson,
  })) {
    if (copiedPaths.has(asset.relativePath)) continue;

    const destinationPath = path.resolve(destinationRoot, asset.relativePath);
    if (!isPathWithinRoot(destinationRoot, destinationPath)) {
      throw new Error(`${packageName} -> invalid ${asset.relativePath}: target escapes destination package root`);
    }

    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(asset.sourcePath, destinationPath);
    fs.chmodSync(destinationPath, asset.sourceMode & 0o777);
    copiedPaths.add(asset.relativePath);
    copied.push({
      commandName: asset.commandName,
      relativePath: asset.relativePath,
    });
  }

  return copied;
}
