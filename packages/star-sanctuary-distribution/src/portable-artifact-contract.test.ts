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
const portableVerifierPath = path.join(
  workspaceRoot,
  "packages",
  "star-sanctuary-distribution",
  "scripts",
  "verify-portable-artifacts.mjs",
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
