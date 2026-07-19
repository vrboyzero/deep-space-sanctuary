export const REQUIRED_WEB_ASSET_PACKAGE_NAMES = Object.freeze([
  "@fontsource/jetbrains-mono",
  "@fontsource/outfit",
  "dagre",
  "dompurify",
  "marked",
]);

function readNonEmptyString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function validateWebAssetPackageProvenance(manifest) {
  if (!manifest || typeof manifest !== "object" || manifest.version !== 1) {
    throw new Error("Web asset manifest has an unsupported schema version.");
  }
  const lockfileSha256 = manifest.provenance?.lockfileSha256;
  if (typeof lockfileSha256 !== "string" || !/^[a-f0-9]{64}$/.test(lockfileSha256)) {
    throw new Error("Web asset manifest has an invalid lockfile SHA-256 identity.");
  }
  if (!Array.isArray(manifest.packages)) {
    throw new Error("Web asset manifest is missing its package inventory.");
  }

  const packageNames = new Set();
  for (const packageEntry of manifest.packages) {
    if (!packageEntry || typeof packageEntry !== "object") {
      throw new Error("Web asset manifest contains an invalid package entry.");
    }
    const name = readNonEmptyString(packageEntry.name);
    if (!name) {
      throw new Error("Web asset manifest contains an invalid package name.");
    }
    if (packageNames.has(name)) {
      throw new Error(`Web asset manifest contains a duplicate package: ${name}`);
    }
    packageNames.add(name);

    if (!readNonEmptyString(packageEntry.version)) {
      throw new Error(`Web asset manifest contains an invalid version for package: ${name}`);
    }
    const license = readNonEmptyString(packageEntry.license);
    if (!license || license.toUpperCase() === "UNSPECIFIED") {
      throw new Error(`Web asset manifest contains an invalid license for package: ${name}`);
    }
  }

  for (const requiredPackageName of REQUIRED_WEB_ASSET_PACKAGE_NAMES) {
    if (!packageNames.has(requiredPackageName)) {
      throw new Error(`Web asset manifest is missing required package: ${requiredPackageName}`);
    }
  }
  return true;
}
