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
