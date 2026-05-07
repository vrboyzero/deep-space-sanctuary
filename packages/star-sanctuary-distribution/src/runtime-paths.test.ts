import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { resolveGatewayRuntimePaths, resolvePreferredEnvDir, resolvePreferredEnvDirInfo } from "./runtime-paths.js";
import { resolveStateDirBootstrapEnvPath } from "./state-dir-bootstrap.js";

const tempDirs = new Set<string>();

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "star-runtime-paths-"));
  tempDirs.add(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs.clear();
});

test("resolvePreferredEnvDir prefers explicit envDir argument over state dir", () => {
  const envDir = resolvePreferredEnvDir({
    cwd: "E:/project/star-sanctuary",
    stateDir: "C:/Users/test/.star_sanctuary",
    envDir: "D:/legacy-env",
    runtimeDir: "E:/legacy-install/current",
    exists: () => true,
  });

  expect(envDir).toBe(path.resolve("D:/legacy-env"));
});

test("resolvePreferredEnvDirInfo reports explicit source when explicit envDir argument exists", () => {
  const result = resolvePreferredEnvDirInfo({
    cwd: "E:/project/star-sanctuary",
    stateDir: "C:/Users/test/.star_sanctuary",
    envDir: "D:/legacy-env",
    runtimeDir: "E:/legacy-install/current",
    exists: () => true,
  });

  expect(result.envDir).toBe(path.resolve("D:/legacy-env"));
  expect(result.source).toBe("explicit");
});

test("resolveGatewayRuntimePaths uses state-dir env for fresh installs", () => {
  const cwd = "E:/fresh-install/star-sanctuary";
  const runtimePaths = resolveGatewayRuntimePaths({
    cwd,
    stateDir: "C:/Users/test/.star_sanctuary",
    env: {},
  });

  expect(runtimePaths.envDir).toBe(path.resolve("C:/Users/test/.star_sanctuary"));
  expect(runtimePaths.stateDir).toBe(path.resolve("C:/Users/test/.star_sanctuary"));
  expect(runtimePaths.cwd).toBe(path.resolve(cwd));
  expect(runtimePaths.envSource).toBe("state_dir");
});

test("resolveGatewayRuntimePaths respects explicit env dir from process env", () => {
  const runtimePaths = resolveGatewayRuntimePaths({
    cwd: "E:/project/star-sanctuary",
    stateDir: "C:/Users/test/.star_sanctuary",
    runtimeDir: "E:/legacy-install/current",
    env: {
      STAR_SANCTUARY_ENV_DIR: "E:/explicit-env",
    },
  });

  expect(runtimePaths.envDir).toBe(path.resolve("E:/explicit-env"));
  expect(runtimePaths.stateDir).toBe(path.resolve("C:/Users/test/.star_sanctuary"));
  expect(runtimePaths.envSource).toBe("explicit");
});

test("resolveGatewayRuntimePaths honors bootstrap state dir when process env is absent", async () => {
  const homeDir = await createTempDir();
  const bootstrapPath = resolveStateDirBootstrapEnvPath(homeDir);
  await fs.mkdir(path.dirname(bootstrapPath), { recursive: true });
  await fs.writeFile(
    bootstrapPath,
    'BELLDANDY_STATE_DIR="H:/bootstrap-state"\nBELLDANDY_ENV_DIR="E:/should-not-be-used"\n',
    "utf-8",
  );

  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  const previousHomeDrive = process.env.HOMEDRIVE;
  const previousHomePath = process.env.HOMEPATH;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  process.env.HOMEDRIVE = path.parse(homeDir).root.replace(/[\\\/]+$/, "");
  process.env.HOMEPATH = homeDir.slice(path.parse(homeDir).root.length - 1).replace(/\//g, "\\");
  try {
    const runtimePaths = resolveGatewayRuntimePaths({
      cwd: "E:/project/star-sanctuary",
      env: {},
    });

    expect(runtimePaths.stateDir).toBe(path.resolve("H:/bootstrap-state"));
    expect(runtimePaths.envDir).toBe(path.resolve("H:/bootstrap-state"));
    expect(runtimePaths.stateDirSource).toBe("bootstrap_env");
    expect(runtimePaths.stateDirBootstrapFilePath).toBe(bootstrapPath);
    expect(runtimePaths.envSource).toBe("state_dir");
  } finally {
    if (typeof previousHome === "string") {
      process.env.HOME = previousHome;
    } else {
      delete process.env.HOME;
    }
    if (typeof previousUserProfile === "string") {
      process.env.USERPROFILE = previousUserProfile;
    } else {
      delete process.env.USERPROFILE;
    }
    if (typeof previousHomeDrive === "string") {
      process.env.HOMEDRIVE = previousHomeDrive;
    } else {
      delete process.env.HOMEDRIVE;
    }
    if (typeof previousHomePath === "string") {
      process.env.HOMEPATH = previousHomePath;
    } else {
      delete process.env.HOMEPATH;
    }
  }
});
