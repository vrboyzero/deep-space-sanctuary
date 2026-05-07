import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { createCLIContext } from "./context.js";
import { loadEnvFileIfExists, loadProjectEnvFiles, resolveEnvLocalPath } from "./env-loader.js";
import { resolveStateDirBootstrapEnvPath } from "../../../../star-sanctuary-distribution/src/state-dir-bootstrap.js";

const TRACKED_ENV_KEYS = [
  "BELLDANDY_AUTH_MODE",
  "BELLDANDY_AUTH_TOKEN",
  "BELLDANDY_PORT",
] as const;

const tempDirs = new Set<string>();

function snapshotTrackedEnv(): Record<string, string | undefined> {
  return Object.fromEntries(
    TRACKED_ENV_KEYS.map((key) => [key, process.env[key]]),
  );
}

function restoreTrackedEnv(snapshot: Record<string, string | undefined>) {
  for (const key of TRACKED_ENV_KEYS) {
    const value = snapshot[key];
    if (typeof value === "undefined") {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
}

async function createEnvDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-env-loader-"));
  tempDirs.add(dir);
  return {
    dir,
    envPath: path.join(dir, ".env"),
    envLocalPath: path.join(dir, ".env.local"),
  };
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs.clear();
});

test("explicit process env wins over .env for the same keys", async () => {
  const snapshot = snapshotTrackedEnv();
  const { envPath, envLocalPath } = await createEnvDir();

  try {
    process.env.BELLDANDY_AUTH_MODE = "token";
    process.env.BELLDANDY_AUTH_TOKEN = "setup-token";

    await fs.writeFile(
      envPath,
      [
        "BELLDANDY_AUTH_MODE=none",
        'BELLDANDY_AUTH_TOKEN="file-token"',
      ].join("\n"),
      "utf-8",
    );

    loadProjectEnvFiles({ envPath, envLocalPath });

    expect(process.env.BELLDANDY_AUTH_MODE).toBe("token");
    expect(process.env.BELLDANDY_AUTH_TOKEN).toBe("setup-token");
  } finally {
    restoreTrackedEnv(snapshot);
  }
});

test(".env.local overrides .env for the same auth keys when shell env is absent", async () => {
  const snapshot = snapshotTrackedEnv();
  const { envPath, envLocalPath } = await createEnvDir();

  try {
    delete process.env.BELLDANDY_AUTH_MODE;
    delete process.env.BELLDANDY_AUTH_TOKEN;

    await fs.writeFile(
      envPath,
      [
        "BELLDANDY_AUTH_MODE=token",
        "BELLDANDY_AUTH_TOKEN=env-token",
      ].join("\n"),
      "utf-8",
    );
    await fs.writeFile(
      envLocalPath,
      [
        "BELLDANDY_AUTH_MODE=none",
        "BELLDANDY_AUTH_TOKEN=local-token",
      ].join("\n"),
      "utf-8",
    );

    loadProjectEnvFiles({ envPath, envLocalPath });

    expect(process.env.BELLDANDY_AUTH_MODE).toBe("none");
    expect(process.env.BELLDANDY_AUTH_TOKEN).toBe("local-token");
  } finally {
    restoreTrackedEnv(snapshot);
  }
});

test("loadEnvFileIfExists strips quotes and export prefix", async () => {
  const snapshot = snapshotTrackedEnv();
  const { envPath } = await createEnvDir();

  try {
    delete process.env.BELLDANDY_AUTH_TOKEN;
    delete process.env.BELLDANDY_PORT;

    await fs.writeFile(
      envPath,
      [
        "export BELLDANDY_AUTH_TOKEN='quoted-token'",
        'BELLDANDY_PORT="38889"',
      ].join("\n"),
      "utf-8",
    );

    loadEnvFileIfExists(envPath);

    expect(process.env.BELLDANDY_AUTH_TOKEN).toBe("quoted-token");
    expect(process.env.BELLDANDY_PORT).toBe("38889");
  } finally {
    restoreTrackedEnv(snapshot);
  }
});

test("resolveEnvLocalPath uses explicit env dir when provided", () => {
  expect(resolveEnvLocalPath("E:/project/star-sanctuary/.star_sanctuary"))
    .toBe(path.resolve("E:/project/star-sanctuary/.star_sanctuary", ".env.local"));
});

test("createCLIContext resolves stateDir from bootstrap env when explicit stateDir is absent", async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-cli-bootstrap-"));
  tempDirs.add(homeDir);
  const bootstrapPath = resolveStateDirBootstrapEnvPath(homeDir);
  await fs.mkdir(path.dirname(bootstrapPath), { recursive: true });
  await fs.writeFile(bootstrapPath, 'BELLDANDY_STATE_DIR="H:/bootstrap-state"\n', "utf-8");

  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  const previousHomeDrive = process.env.HOMEDRIVE;
  const previousHomePath = process.env.HOMEPATH;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  process.env.HOMEDRIVE = path.parse(homeDir).root.replace(/[\\\/]+$/, "");
  process.env.HOMEPATH = homeDir.slice(path.parse(homeDir).root.length - 1).replace(/\//g, "\\");
  try {
    const ctx = createCLIContext({ json: true });
    expect(path.normalize(ctx.stateDir)).toBe(path.normalize("H:/bootstrap-state"));
    expect(path.normalize(ctx.envDir)).toBe(path.normalize("H:/bootstrap-state"));
    expect(ctx.stateDirSource).toBe("bootstrap_env");
    expect(ctx.stateDirBootstrapFilePath).toBe(bootstrapPath);
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
