import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const COMMIT_SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export const RELEASE_LIGHT_BUILD_GRAPH_INPUT_PATHS = Object.freeze([
  "scripts/artifact-contract.mjs",
  "scripts/build-release-light-assets.mjs",
  "scripts/release-content-manifest.mjs",
  "scripts/release-identity.mjs",
]);

function readNonEmptyString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function validateReleaseIdentity(identity) {
  if (!identity || typeof identity !== "object" || identity.schemaVersion !== 1) {
    throw new Error("Release identity has an unsupported schema version.");
  }
  if (!readNonEmptyString(identity.version)) {
    throw new Error("Release identity has an invalid version.");
  }
  if (!COMMIT_SHA_PATTERN.test(readNonEmptyString(identity.commitSha))) {
    throw new Error("Release identity has an invalid commit SHA.");
  }
  if (!SHA256_PATTERN.test(readNonEmptyString(identity.lockfileSha256))) {
    throw new Error("Release identity has an invalid lockfile SHA-256.");
  }
  if (!SHA256_PATTERN.test(readNonEmptyString(identity.buildGraphSha256))) {
    throw new Error("Release identity has an invalid BuildGraph SHA-256.");
  }
  return true;
}

function resolveBuildGraphSha256(workspaceRoot, inputPaths) {
  if (!Array.isArray(inputPaths) || inputPaths.length === 0) {
    throw new Error("Release identity BuildGraph inputs are missing.");
  }
  const inputs = inputPaths.map((inputPath) => {
    const normalizedInputPath = readNonEmptyString(inputPath).replaceAll("\\", "/");
    const absolutePath = path.resolve(workspaceRoot, normalizedInputPath);
    const relativePath = path.relative(workspaceRoot, absolutePath).replaceAll("\\", "/");
    if (
      !normalizedInputPath
      || path.isAbsolute(normalizedInputPath)
      || relativePath === ".."
      || relativePath.startsWith("../")
      || relativePath !== normalizedInputPath
    ) {
      throw new Error(`Release identity BuildGraph input escapes the workspace: ${normalizedInputPath || "(empty)"}`);
    }
    let content;
    try {
      content = fs.readFileSync(absolutePath);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to read ReleaseIdentity BuildGraph input ${normalizedInputPath}: ${detail}`);
    }
    return {
      path: normalizedInputPath,
      sha256: crypto.createHash("sha256").update(content).digest("hex"),
    };
  });
  inputs.sort((left, right) => (left.path === right.path ? 0 : (left.path < right.path ? -1 : 1)));
  return crypto.createHash("sha256")
    .update(JSON.stringify({ schemaVersion: 1, inputs }))
    .digest("hex");
}

function resolveGitCommitSha(workspaceRoot) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: workspaceRoot,
    encoding: "utf-8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.error?.message || "git rev-parse failed").trim();
    throw new Error(`Unable to resolve release commit SHA: ${detail}`);
  }
  return String(result.stdout || "").trim();
}

export function resolveReleaseIdentity({
  version,
  workspaceRoot,
  environment = process.env,
  buildGraphInputPaths = RELEASE_LIGHT_BUILD_GRAPH_INPUT_PATHS,
}) {
  const explicitCommitSha = readNonEmptyString(environment.BELLDANDY_RELEASE_COMMIT_SHA)
    || readNonEmptyString(environment.GITHUB_SHA);
  const lockfilePath = path.join(workspaceRoot, "pnpm-lock.yaml");
  let lockfileContent;
  try {
    lockfileContent = fs.readFileSync(lockfilePath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read release lockfile: ${detail}`);
  }

  const identity = {
    schemaVersion: 1,
    version: readNonEmptyString(version),
    commitSha: explicitCommitSha || resolveGitCommitSha(workspaceRoot),
    lockfileSha256: crypto.createHash("sha256").update(lockfileContent).digest("hex"),
    buildGraphSha256: resolveBuildGraphSha256(workspaceRoot, buildGraphInputPaths),
  };
  validateReleaseIdentity(identity);
  return identity;
}

export function assertReleaseIdentityMatches(actual, expected) {
  validateReleaseIdentity(actual);
  validateReleaseIdentity(expected);
  if (actual.version !== expected.version) {
    throw new Error(`Release identity version mismatch: expected ${expected.version}, got ${actual.version}`);
  }
  if (actual.commitSha !== expected.commitSha) {
    throw new Error(`Release identity commit SHA mismatch: expected ${expected.commitSha}, got ${actual.commitSha}`);
  }
  if (actual.lockfileSha256 !== expected.lockfileSha256) {
    throw new Error("Release identity lockfile SHA-256 mismatch.");
  }
  if (actual.buildGraphSha256 !== expected.buildGraphSha256) {
    throw new Error("Release identity BuildGraph SHA-256 mismatch.");
  }
  return true;
}
