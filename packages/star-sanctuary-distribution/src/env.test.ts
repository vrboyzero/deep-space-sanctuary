import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, expect, test, vi } from "vitest";

import {
  ensureDefaultEnvFile,
  ensureDefaultEnvFiles,
  loadRuntimeEnvFiles,
  readDefaultEnvTemplates,
  resolveRuntimeEnvDir,
  resolveDefaultEnvTemplatePaths,
} from "./env.js";
import { loadStateDirBootstrapInfo, resolveStateDirBootstrapEnvPath } from "./state-dir-bootstrap.js";

const tempDirs = new Set<string>();

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "star-env-bootstrap-"));
  tempDirs.add(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs.clear();
});

test("ensureDefaultEnvFile creates a default .env for fresh installs", async () => {
  const envDir = await createTempDir();

  const result = ensureDefaultEnvFile(envDir);

  expect(result.created).toBe(true);
  const content = await fs.readFile(result.envPath, "utf-8");
  expect(content).toContain("BELLDANDY_AGENT_PROVIDER=openai");
  expect(content).toContain("BELLDANDY_AUTH_MODE=none");
  expect(content).toContain("BELLDANDY_COMMUNITY_API_ENABLED=false");
});

test("ensureDefaultEnvFile still creates .env when only .env.local exists", async () => {
  const envDir = await createTempDir();
  const envLocalPath = path.join(envDir, ".env.local");
  await fs.writeFile(envLocalPath, "BELLDANDY_OPENAI_API_KEY=test-key\n", "utf-8");

  const result = ensureDefaultEnvFile(envDir);

  expect(result.created).toBe(true);
  const content = await fs.readFile(result.envPath, "utf-8");
  expect(content).toContain("BELLDANDY_AUTH_MODE=none");
  const localContent = await fs.readFile(envLocalPath, "utf-8");
  expect(localContent).toBe("BELLDANDY_OPENAI_API_KEY=test-key\n");
});

test("ensureDefaultEnvFiles creates both .env and .env.local for a fresh state dir", async () => {
  const envDir = await createTempDir();

  const result = ensureDefaultEnvFiles(envDir);

  expect(result.createdEnv).toBe(true);
  expect(result.createdEnvLocal).toBe(true);
  await expect(fs.readFile(result.envPath, "utf-8")).resolves.toContain("BELLDANDY_AGENT_PROVIDER=openai");
  const envLocalContent = await fs.readFile(result.envLocalPath, "utf-8");
  expect(envLocalContent).toContain('BELLDANDY_AGENT_PROVIDER="openai"');
  expect(envLocalContent).toContain('BELLDANDY_COMMUNITY_API_ENABLED="true"');
  expect(envLocalContent).not.toMatch(/BELLDANDY_AUTH_TOKEN=setup-[^\r\n]+/);
});

test("ensureDefaultEnvFiles only backfills the missing file", async () => {
  const envDir = await createTempDir();
  await fs.writeFile(path.join(envDir, ".env"), "BELLDANDY_PORT=9999\n", "utf-8");

  const result = ensureDefaultEnvFiles(envDir);

  expect(result.createdEnv).toBe(false);
  expect(result.createdEnvLocal).toBe(true);
  await expect(fs.readFile(result.envPath, "utf-8")).resolves.toBe("BELLDANDY_PORT=9999\n");
  const envLocalContent = await fs.readFile(result.envLocalPath, "utf-8");
  expect(envLocalContent).toContain('BELLDANDY_AGENT_PROVIDER="openai"');
  expect(envLocalContent).toContain('BELLDANDY_COMMUNITY_API_ENABLED="true"');
  expect(envLocalContent).not.toMatch(/BELLDANDY_AUTH_TOKEN=setup-[^\r\n]+/);
});

test("ensureDefaultEnvFiles prefers explicit runtime templates over bundle-relative fallback lookup", async () => {
  const rootDir = await createTempDir();
  const envDir = path.join(rootDir, "state");
  const runtimeDir = path.join(rootDir, "runtime");
  const templatesDir = path.join(runtimeDir, "templates", "default-env");
  await fs.mkdir(templatesDir, { recursive: true });
  await fs.writeFile(
    path.join(templatesDir, "runtime.env"),
    [
      "# custom full runtime env",
      "BELLDANDY_AGENT_PROVIDER=custom-runtime",
      "BELLDANDY_AUTH_MODE=token",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(templatesDir, "runtime.env.local"),
    [
      "# custom full runtime env.local",
      "BELLDANDY_OPENAI_MODEL=runtime-local-model",
      "",
    ].join("\n"),
    "utf-8",
  );

  const result = ensureDefaultEnvFiles(envDir, {
    runtimeDir,
    agentModuleUrl: pathToFileURL(path.join(rootDir, "bundle", "single-exe-main.cjs")).href,
  });

  const envContent = await fs.readFile(result.envPath, "utf-8");
  const envLocalContent = await fs.readFile(result.envLocalPath, "utf-8");
  expect(envContent).toContain("BELLDANDY_AGENT_PROVIDER=custom-runtime");
  expect(envContent).not.toContain("Star Sanctuary default bootstrap config");
  expect(envLocalContent).toContain("BELLDANDY_OPENAI_MODEL=runtime-local-model");
  expect(envLocalContent).not.toContain("Star Sanctuary local overrides");
  expect(envLocalContent).toMatch(/BELLDANDY_AUTH_TOKEN=setup-[A-Za-z0-9_-]{43}(?:\r?\n|$)/);
});

test("ensureDefaultEnvFiles skips template reads when both target files already exist", async () => {
  const envDir = await createTempDir();
  await fs.writeFile(path.join(envDir, ".env"), "BELLDANDY_PORT=38889\n", "utf-8");
  await fs.writeFile(path.join(envDir, ".env.local"), "BELLDANDY_AUTH_MODE=token\n", "utf-8");
  const readFileSyncSpy = vi.spyOn(fsSync, "readFileSync");

  try {
    const result = ensureDefaultEnvFiles(envDir);

    expect(result).toMatchObject({ createdEnv: false, createdEnvLocal: false });
    expect(readFileSyncSpy).not.toHaveBeenCalled();
  } finally {
    readFileSyncSpy.mockRestore();
  }
});

test("loadRuntimeEnvFiles preserves explicit base env values over .env defaults", async () => {
  const envDir = await createTempDir();
  await fs.writeFile(
    path.join(envDir, ".env"),
    [
      "BELLDANDY_HOST=127.0.0.1",
      "BELLDANDY_AGENT_PROVIDER=openai",
      "BELLDANDY_PORT=28889",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(envDir, ".env.local"),
    [
      "BELLDANDY_PORT=38889",
      "BELLDANDY_AUTH_MODE=token",
    ].join("\n"),
    "utf-8",
  );

  const env = loadRuntimeEnvFiles(
    {
      BELLDANDY_HOST: "0.0.0.0",
      BELLDANDY_AGENT_PROVIDER: "mock",
    },
    envDir,
  );

  expect(env.BELLDANDY_HOST).toBe("0.0.0.0");
  expect(env.BELLDANDY_AGENT_PROVIDER).toBe("mock");
  expect(env.BELLDANDY_PORT).toBe("38889");
  expect(env.BELLDANDY_AUTH_MODE).toBe("token");
});

test("resolveRuntimeEnvDir prefers explicit env dir over fallback state dir", () => {
  const envDir = resolveRuntimeEnvDir({
    baseEnv: {
      BELLDANDY_ENV_DIR: "/tmp/custom-env",
    },
    fallbackEnvDir: "/tmp/state-dir",
  });

  expect(envDir).toBe("/tmp/custom-env");
});

test("loadStateDirBootstrapInfo loads BELLDANDY_STATE_DIR from bootstrap env when process env is absent", async () => {
  const homeDir = await createTempDir();
  const bootstrapDir = path.dirname(resolveStateDirBootstrapEnvPath(homeDir));
  await fs.mkdir(bootstrapDir, { recursive: true });
  await fs.writeFile(
    resolveStateDirBootstrapEnvPath(homeDir),
    'BELLDANDY_STATE_DIR="H:/bootstrap-state"\nBELLDANDY_PORT=39999\n',
    "utf-8",
  );

  try {
    const result = loadStateDirBootstrapInfo({}, { homeDir });
    expect(result.source).toBe("bootstrap_env");
    expect(result.env.BELLDANDY_STATE_DIR).toBe("H:/bootstrap-state");
    expect(result.env.BELLDANDY_PORT).toBeUndefined();
    expect(result.bootstrapFilePath).toBe(resolveStateDirBootstrapEnvPath(homeDir));
  } finally {
  }
});

test("loadStateDirBootstrapInfo keeps explicit process env over bootstrap env", async () => {
  const homeDir = await createTempDir();
  const bootstrapDir = path.dirname(resolveStateDirBootstrapEnvPath(homeDir));
  await fs.mkdir(bootstrapDir, { recursive: true });
  await fs.writeFile(
    resolveStateDirBootstrapEnvPath(homeDir),
    'BELLDANDY_STATE_DIR="H:/bootstrap-state"\n',
    "utf-8",
  );

  try {
    const result = loadStateDirBootstrapInfo({
      BELLDANDY_STATE_DIR: "E:/process-state",
    }, { homeDir });
    expect(result.source).toBe("process_env");
    expect(result.env.BELLDANDY_STATE_DIR).toBe("E:/process-state");
  } finally {
  }
});

test("default env template loader resolves template asset paths", () => {
  const templatePaths = resolveDefaultEnvTemplatePaths();
  const templates = readDefaultEnvTemplates();

  expect(templatePaths.envTemplatePath).toContain(path.join("default-env", "runtime.env"));
  expect(templatePaths.envLocalTemplatePath).toContain(path.join("default-env", "runtime.env.local"));
  expect(templates.env).toContain("BELLDANDY_AGENT_PROVIDER=openai");
  expect(templates.envLocal).toContain('BELLDANDY_AGENT_PROVIDER="openai"');
});

test("default env.local template keeps community api enabled in local overrides", () => {
  const templates = readDefaultEnvTemplates();

  expect(templates.envLocal).toContain('BELLDANDY_COMMUNITY_API_ENABLED="true"');
  expect(templates.envLocal).not.toContain('BELLDANDY_COMMUNITY_API_ENABLED="false"');
});

test("memory background governance defaults stay aligned across env templates", async () => {
  const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const example = await fs.readFile(path.join(workspaceRoot, ".env.example"), "utf-8");
  const templates = readDefaultEnvTemplates();
  const defaults = [
    ["BELLDANDY_MEMORY_BACKGROUND_MAX_RUNS", ""],
    ["BELLDANDY_MEMORY_BACKGROUND_WINDOW_MS", "3600000"],
    ["BELLDANDY_MEMORY_BACKGROUND_MAX_TOKEN_UNITS", ""],
    ["BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_MESSAGES", "64"],
    ["BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_MESSAGE_BYTES", "16384"],
    ["BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_INPUT_BYTES", "49152"],
    ["BELLDANDY_MEMORY_DURABLE_EXTRACTION_CLOSE_DEADLINE_MS", "5000"],
    ["BELLDANDY_MEMORY_PRIVATE_SUMMARY_TRUSTED_HOSTS", ""],
    ["BELLDANDY_MEMORY_PRIVATE_SUMMARY_REDACTOR", "off"],
  ] as const;

  for (const [key, value] of defaults) {
    expect(example).toContain(`# ${key}=${value}`);
    expect(templates.env).toContain(`# ${key}=${value}`);
    expect(templates.envLocal).toContain(`${key}="${value}"`);
  }
});

test("Feishu HTTP governance defaults stay aligned across env templates", async () => {
  const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const example = await fs.readFile(path.join(workspaceRoot, ".env.example"), "utf-8");
  const templates = readDefaultEnvTemplates();
  const defaults = [
    ["BELLDANDY_FEISHU_JSON_MAX_RESPONSE_BYTES", "1048576"],
    ["BELLDANDY_FEISHU_RESOURCE_MAX_RESPONSE_BYTES", "20971520"],
    ["BELLDANDY_FEISHU_HTTP_IDLE_TIMEOUT_MS", "30000"],
  ] as const;

  for (const [key, value] of defaults) {
    expect(example).toContain(`# ${key}=${value}`);
    expect(templates.env).toContain(`# ${key}=${value}`);
    expect(templates.envLocal).toContain(`${key}="${value}"`);
  }
});

test("Discord REST governance defaults stay aligned across env templates", async () => {
  const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const example = await fs.readFile(path.join(workspaceRoot, ".env.example"), "utf-8");
  const templates = readDefaultEnvTemplates();
  const defaults = [
    ["BELLDANDY_DISCORD_REST_MAX_RESPONSE_BYTES", "1048576"],
    ["BELLDANDY_DISCORD_REST_TIMEOUT_MS", "15000"],
  ] as const;

  for (const [key, value] of defaults) {
    expect(example).toContain(`# ${key}=${value}`);
    expect(templates.env).toContain(`# ${key}=${value}`);
    expect(templates.envLocal).toContain(`${key}="${value}"`);
  }
});
