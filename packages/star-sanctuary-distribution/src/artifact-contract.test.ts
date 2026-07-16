import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { afterEach, expect, test } from "vitest";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const verifierPath = path.join(workspaceRoot, "scripts", "verify-workspace-build.mjs");
const releaseLightBuilderPath = path.join(workspaceRoot, "scripts", "build-release-light-assets.mjs");
const releaseLightVerifierPath = path.join(workspaceRoot, "scripts", "verify-release-light-assets.mjs");
const tempDirs = new Set<string>();

async function createWorkspaceFixture(packageJson: Record<string, unknown>): Promise<string> {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "star-artifact-contract-"));
  tempDirs.add(fixtureRoot);
  await fs.writeFile(
    path.join(fixtureRoot, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf-8",
  );
  return fixtureRoot;
}

async function createPackageFixture(manifest: Record<string, unknown>): Promise<string> {
  const fixtureRoot = await createWorkspaceFixture({ name: "fixture-workspace", version: "1.0.0" });
  const packageDir = path.join(fixtureRoot, "packages", "fixture");
  await fs.mkdir(path.join(packageDir, "dist"), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(packageDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf-8"),
    fs.writeFile(path.join(packageDir, "dist", "index.js"), "export {};\n", "utf-8"),
    fs.writeFile(path.join(packageDir, "dist", "index.d.ts"), "export {};\n", "utf-8"),
  ]);
  return fixtureRoot;
}

function runWorkspaceVerifier(fixtureRoot: string) {
  return spawnSync(process.execPath, [verifierPath], {
    cwd: fixtureRoot,
    encoding: "utf-8",
  });
}

afterEach(async () => {
  await Promise.all([...tempDirs].map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs.clear();
});

test("workspace artifact contract rejects a missing package bin target", async () => {
  const fixtureRoot = await createPackageFixture({
    name: "@belldandy/fixture",
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      },
    },
    bin: {
      "fixture-cli": "./bin/fixture.mjs",
    },
  });

  const result = runWorkspaceVerifier(fixtureRoot);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("@belldandy/fixture -> missing bin/fixture.mjs (bin fixture-cli)");
});

test("workspace artifact contract rejects a package target outside the package root", async () => {
  const fixtureRoot = await createPackageFixture({
    name: "@belldandy/fixture",
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    bin: {
      "fixture-cli": "../../outside.mjs",
    },
  });
  await fs.writeFile(path.join(fixtureRoot, "outside.mjs"), "export {};\n", "utf-8");

  const result = runWorkspaceVerifier(fixtureRoot);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "@belldandy/fixture -> invalid ../../outside.mjs (bin fixture-cli): target escapes package root",
  );
});

test("workspace artifact contract rejects a missing declared package resource", async () => {
  const fixtureRoot = await createPackageFixture({
    name: "@belldandy/fixture",
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    files: ["dist", "runtime-assets"],
  });

  const result = runWorkspaceVerifier(fixtureRoot);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "@belldandy/fixture -> missing runtime-assets (files entry)",
  );
});

test("workspace artifact contract rejects a declared resource linked outside the package root", async () => {
  const fixtureRoot = await createPackageFixture({
    name: "@belldandy/fixture",
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    files: ["dist", "linked-assets"],
  });
  const packageDir = path.join(fixtureRoot, "packages", "fixture");
  const outsideDir = path.join(fixtureRoot, "outside-assets");
  await fs.mkdir(outsideDir);
  await fs.writeFile(path.join(outsideDir, "runtime.txt"), "fixture\n", "utf-8");
  await fs.symlink(
    outsideDir,
    path.join(packageDir, "linked-assets"),
    process.platform === "win32" ? "junction" : "dir",
  );

  const result = runWorkspaceVerifier(fixtureRoot);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "@belldandy/fixture -> invalid linked-assets (files entry): target resolves outside package root",
  );
});

test("release-light builder rejects a version that differs from package.json before staging", async () => {
  const fixtureRoot = await createWorkspaceFixture({
    name: "fixture-workspace",
    version: "1.0.0",
  });

  const result = spawnSync(process.execPath, [releaseLightBuilderPath, "--version=2.0.0"], {
    cwd: fixtureRoot,
    encoding: "utf-8",
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "release-light version mismatch: package.json declares 1.0.0, requested 2.0.0",
  );
  expect(existsSync(path.join(fixtureRoot, "artifacts"))).toBe(false);
});

test("release-light verifier rejects a version that differs from package.json", async () => {
  const fixtureRoot = await createWorkspaceFixture({
    name: "fixture-workspace",
    version: "1.0.0",
  });

  const result = spawnSync(process.execPath, [releaseLightVerifierPath, "--version=2.0.0"], {
    cwd: fixtureRoot,
    encoding: "utf-8",
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "release-light version mismatch: package.json declares 1.0.0, requested 2.0.0",
  );
});
