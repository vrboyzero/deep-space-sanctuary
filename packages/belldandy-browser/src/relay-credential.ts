import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const RELAY_CREDENTIAL_FILENAME = "browser-relay-credential.json";
const RELAY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export type RelayCredentialSource = "configured" | "state" | "generated";

export type RelayCredential = {
  token: string;
  source: RelayCredentialSource;
};

type StoredRelayCredential = {
  version: 1;
  token: string;
  createdAt: string;
};

export function getRelayCredentialPath(stateDir: string): string {
  return path.join(stateDir, RELAY_CREDENTIAL_FILENAME);
}

export function assertValidRelayToken(value: string): string {
  const token = value.trim();
  if (!RELAY_TOKEN_PATTERN.test(token)) {
    throw new Error("Invalid relay credential. Expected a base64url token with at least 32 characters.");
  }
  return token;
}

/**
 * Relay 凭据只保存在 stateDir 的私有文件或显式环境配置中。读取到损坏文件时
 * 不静默重置，以免旧扩展在未知凭据下重新获得浏览器控制权。
 */
export async function resolveRelayCredential(input: {
  stateDir: string;
  configuredToken?: string;
}): Promise<RelayCredential> {
  const configuredToken = input.configuredToken?.trim();
  if (configuredToken) {
    return { token: assertValidRelayToken(configuredToken), source: "configured" };
  }

  const credentialPath = getRelayCredentialPath(input.stateDir);
  try {
    return { token: await readStoredRelayCredential(credentialPath), source: "state" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
      throw error;
    }
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const stored: StoredRelayCredential = {
    version: 1,
    token,
    createdAt: new Date().toISOString(),
  };
  await fs.mkdir(input.stateDir, { recursive: true, mode: 0o700 });
  try {
    await fs.writeFile(credentialPath, `${JSON.stringify(stored, null, 2)}\n`, {
      encoding: "utf-8",
      mode: 0o600,
      flag: "wx",
    });
    return { token, source: "generated" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== "EEXIST") {
      throw error;
    }
    return { token: await readStoredRelayCredential(credentialPath), source: "state" };
  }
}

async function readStoredRelayCredential(credentialPath: string): Promise<string> {
  const raw = await fs.readFile(credentialPath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Invalid relay credential state.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid relay credential state.");
  }
  const record = parsed as Partial<StoredRelayCredential>;
  if (record.version !== 1 || typeof record.token !== "string") {
    throw new Error("Invalid relay credential state.");
  }
  return assertValidRelayToken(record.token);
}
