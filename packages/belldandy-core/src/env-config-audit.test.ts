import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const MANUAL_ONLY_ENV_KEYS = [
  "AUTO_OPEN_BROWSER",
  "BELLDANDY_AGENT_CONFIG_FILE",
  "BELLDANDY_ENV_DIR",
  "BELLDANDY_IMAGE",
  "BELLDANDY_IMAGE_MAX_OUTPUT_BYTES",
  "BELLDANDY_MEMORY_DB",
  "BELLDANDY_MODEL_CONFIG_FILE",
  "BELLDANDY_OFFICE_MAX_DOWNLOAD_BYTES",
  "BELLDANDY_TOKEN_USAGE_UPLOAD_TOKEN",
  "BELLDANDY_TTS_MAX_OUTPUT_BYTES",
  "BELLDANDY_UNDERSTANDING_CACHE_MAX_BYTES",
  "BELLDANDY_UNDERSTANDING_CACHE_MAX_ENTRIES",
  "BELLDANDY_UNDERSTANDING_CACHE_TTL_MS",
  "SETUP_TOKEN",
  "STAR_SANCTUARY_ENV_DIR",
  "TAILSCALE_AUTH_KEY",
  "TAILSCALE_EXTRA_ARGS",
].sort();

const SETTINGS_EXEMPT_ENV_KEYS = [
  ...MANUAL_ONLY_ENV_KEYS,
  "BELLDANDY_MEMORY_BACKGROUND_MAX_RUNS",
  "BELLDANDY_MEMORY_BACKGROUND_MAX_TOKEN_UNITS",
  "BELLDANDY_MEMORY_BACKGROUND_WINDOW_MS",
  "BELLDANDY_MEMORY_DURABLE_EXTRACTION_CLOSE_DEADLINE_MS",
  "BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_INPUT_BYTES",
  "BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_MESSAGES",
  "BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_MESSAGE_BYTES",
  "BELLDANDY_MEMORY_PRIVATE_SUMMARY_REDACTOR",
  "BELLDANDY_MEMORY_PRIVATE_SUMMARY_TRUSTED_HOSTS",
  "BELLDANDY_FEISHU_HTTP_IDLE_TIMEOUT_MS",
  "BELLDANDY_FEISHU_JSON_MAX_RESPONSE_BYTES",
  "BELLDANDY_FEISHU_RESOURCE_MAX_RESPONSE_BYTES",
  "BELLDANDY_DISCORD_REST_MAX_RESPONSE_BYTES",
  "BELLDANDY_DISCORD_REST_TIMEOUT_MS",
].sort();

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function extractEnvExampleKeys(): string[] {
  const source = readFile(".env.example");
  return [...new Set(source.split(/\r?\n/).map((line) => {
    const match = line.match(/^\s*#?\s*([A-Z][A-Z0-9_]+)\s*=.*$/);
    return match ? match[1] : null;
  }).filter((value): value is string => Boolean(value)))].sort();
}

function extractWhitelistKeys(): string[] {
  const source = readFile("packages/belldandy-core/src/server-methods/config-channel.ts");
  return [...new Set(
    [...source.matchAll(/"([A-Z][A-Z0-9_]+)"/g)]
      .map((match) => match[1]),
  )].sort();
}

function extractSettingsKeys(): string[] {
  const settingsSource = readFile("apps/web/public/app/features/settings.js");
  const assistantSource = readFile("apps/web/public/app/features/assistant-mode-settings-config.js");
  const directKeys = [...settingsSource.matchAll(
    /(?:updates\["|assignSecretUpdate\(updates,\s*")([A-Z][A-Z0-9_]+)"/g,
  )].map((match) => match[1]);
  const aliyunTargetsMatch = settingsSource.match(/const aliyunApiKeyTargets = \[(.*?)\];/s);
  const aliyunKeys = aliyunTargetsMatch
    ? [...aliyunTargetsMatch[1].matchAll(/"([A-Z][A-Z0-9_]+)"/g)].map((match) => match[1])
    : [];
  const assistantKeys = [...assistantSource.matchAll(/([A-Z][A-Z0-9_]+):/g)]
    .map((match) => match[1])
    .filter((key) => key.startsWith("BELLDANDY_"));
  return [...new Set([...directKeys, ...aliyunKeys, ...assistantKeys])].sort();
}

function extractHotReloadKeys(): string[] {
  const source = readFile("packages/belldandy-core/src/config-hot-reload.ts");
  return [...new Set(
    [...source.matchAll(/"([A-Z][A-Z0-9_]+)"/g)]
      .map((match) => match[1])
      .filter((key) => key.startsWith("BELLDANDY_") || key === "DASHSCOPE_API_KEY"),
  )].sort();
}

describe("env config audit", () => {
  it(".env.example variables are either whitelist-managed or explicitly manual-only", () => {
    const envKeys = extractEnvExampleKeys();
    const whitelistKeys = extractWhitelistKeys();
    const missing = envKeys.filter((key) => !whitelistKeys.includes(key));
    expect(missing).toEqual(MANUAL_ONLY_ENV_KEYS);
  });

  it(".env.example variables are either exposed in settings or explicitly settings-exempt", () => {
    const envKeys = extractEnvExampleKeys();
    const settingsKeys = extractSettingsKeys();
    const missing = envKeys.filter((key) => !settingsKeys.includes(key));
    expect(missing).toEqual(SETTINGS_EXEMPT_ENV_KEYS);
  });

  it("hot reload env keys stay both whitelist-managed and settings-exposed", () => {
    const hotReloadKeys = extractHotReloadKeys();
    const whitelistKeys = extractWhitelistKeys();
    const settingsKeys = extractSettingsKeys();
    expect(hotReloadKeys.filter((key) => !whitelistKeys.includes(key))).toEqual([]);
    expect(hotReloadKeys.filter((key) => !settingsKeys.includes(key))).toEqual([]);
  });
});
