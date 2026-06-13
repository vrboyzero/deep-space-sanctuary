import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  resolveDefaultStateDir,
  resolveNamedCompatDir,
  resolveStateDir,
  resolveWorkspaceStateDir,
} from "@belldandy/protocol";
export {
  DEFAULT_STATE_DIR_BASENAME,
  DEFAULT_STATE_DIR_DISPLAY,
  LEGACY_STATE_DIR_BASENAME,
  LEGACY_STATE_DIR_DISPLAY,
  STATE_DIR_WINDOWS_ENV_KEY,
  STATE_DIR_WSL_ENV_KEY,
  resolveDefaultStateDir,
  resolveNamedCompatDir,
  resolveStateDir,
  resolveWorkspaceStateDir,
} from "@belldandy/protocol";

export type AllowlistStore = {
  version: 1;
  allowFrom: string[];
};

export type PairingRequest = {
  clientId: string;
  code: string;
  createdAt: string;
};

export type PairingStore = {
  version: 1;
  pending: PairingRequest[];
};

export class SecurityStoreReadError extends Error {
  readonly filePath: string;
  readonly code?: string;

  constructor(filePath: string, message: string, code?: string, options?: { cause?: unknown }) {
    super(`Failed to read JSON store ${filePath}: ${message}`, options);
    this.name = "SecurityStoreReadError";
    this.filePath = filePath;
    this.code = code;
  }
}

const PAIRING_CODE_LENGTH = 8;
const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRING_TTL_MS = 60 * 60 * 1000;
const PAIRING_MAX_PENDING = 20;
const PAIRING_APPROVE_RETRIES = 5;
const PAIRING_APPROVE_RETRY_DELAY_MS = 20;

export function resolveAllowlistPath(stateDir: string): string {
  return path.join(stateDir, "allowlist.json");
}

export function resolvePairingPath(stateDir: string): string {
  return path.join(stateDir, "pairing.json");
}

export async function isClientAllowed(params: {
  clientId: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
  const stateDir = params.stateDir ?? resolveStateDir(params.env);
  const store = await readAllowlistStore(stateDir);
  return store.allowFrom.includes(params.clientId);
}

export async function approvePairingCode(params: {
  code: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ ok: true; clientId: string } | { ok: false; message: string }> {
  const stateDir = params.stateDir ?? resolveStateDir(params.env);
  let pairing = await readPairingStore(stateDir);
  let match = pairing.pending.find((p) => p.code === params.code);
  for (let attempt = 1; !match && attempt < PAIRING_APPROVE_RETRIES; attempt += 1) {
    await delay(PAIRING_APPROVE_RETRY_DELAY_MS);
    pairing = await readPairingStore(stateDir);
    match = pairing.pending.find((p) => p.code === params.code);
  }
  if (!match) return { ok: false, message: "pairing code not found or expired" };

  const allowlist = await readAllowlistStore(stateDir);
  if (!allowlist.allowFrom.includes(match.clientId)) {
    allowlist.allowFrom.push(match.clientId);
  }
  await writeAllowlistStore(stateDir, allowlist);

  pairing.pending = pairing.pending.filter((p) => p.code !== params.code);
  await writePairingStore(stateDir, pairing);

  return { ok: true, clientId: match.clientId };
}

export async function revokeClient(params: {
  clientId: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ ok: true; removed: boolean }> {
  const stateDir = params.stateDir ?? resolveStateDir(params.env);
  const allowlist = await readAllowlistStore(stateDir);
  const before = allowlist.allowFrom.length;
  allowlist.allowFrom = allowlist.allowFrom.filter((id) => id !== params.clientId);
  await writeAllowlistStore(stateDir, allowlist);
  return { ok: true, removed: allowlist.allowFrom.length !== before };
}

export async function ensurePairingCode(params: {
  clientId: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ code: string; createdAt: string }> {
  const stateDir = params.stateDir ?? resolveStateDir(params.env);
  const store = await readPairingStore(stateDir);
  const now = Date.now();

  store.pending = store.pending.filter((p) => now - Date.parse(p.createdAt) <= PAIRING_TTL_MS);

  const existing = store.pending.find((p) => p.clientId === params.clientId);
  if (existing) {
    await writePairingStore(stateDir, store);
    return { code: existing.code, createdAt: existing.createdAt };
  }

  const used = new Set(store.pending.map((p) => p.code));
  const code = generateUniqueCode(used);
  const createdAt = new Date().toISOString();
  store.pending.push({ clientId: params.clientId, code, createdAt });

  if (store.pending.length > PAIRING_MAX_PENDING) {
    store.pending = store.pending.slice(-PAIRING_MAX_PENDING);
  }

  await writePairingStore(stateDir, store);
  return { code, createdAt };
}

export async function cleanupPending(params: {
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
  dryRun?: boolean;
}): Promise<{ cleaned: PairingRequest[]; remaining: number }> {
  const stateDir = params.stateDir ?? resolveStateDir(params.env);
  const store = await readPairingStore(stateDir);
  const now = Date.now();

  const valid: PairingRequest[] = [];
  const expired: PairingRequest[] = [];

  for (const p of store.pending) {
    if (now - Date.parse(p.createdAt) <= PAIRING_TTL_MS) {
      valid.push(p);
    } else {
      expired.push(p);
    }
  }

  if (expired.length > 0 && !params.dryRun) {
    store.pending = valid;
    await writePairingStore(stateDir, store);
  }

  return { cleaned: expired, remaining: valid.length };
}

export async function readAllowlistStore(stateDir: string): Promise<AllowlistStore> {
  const filePath = resolveAllowlistPath(stateDir);
  const fallback: AllowlistStore = { version: 1, allowFrom: [] };
  return await readJson(filePath, fallback);
}

export async function writeAllowlistStore(stateDir: string, store: AllowlistStore): Promise<void> {
  const filePath = resolveAllowlistPath(stateDir);
  await writeJson(filePath, store);
}

export async function readPairingStore(stateDir: string): Promise<PairingStore> {
  const filePath = resolvePairingPath(stateDir);
  const fallback: PairingStore = { version: 1, pending: [] };
  return await readJson(filePath, fallback);
}

export async function writePairingStore(stateDir: string, store: PairingStore): Promise<void> {
  const filePath = resolvePairingPath(stateDir);
  await writeJson(filePath, store);
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return (parsed ?? fallback) as T;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ENOENT") return fallback;
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[security/store] Failed to read JSON store; refusing silent fallback.", {
      filePath,
      code,
      message,
    });
    throw new SecurityStoreReadError(filePath, message, code, { cause: err });
  }
}

const RENAME_RETRIES = 3;
const RENAME_RETRY_DELAY_MS = 50;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
  const content = `${JSON.stringify(value, null, 2)}\n`;

  await fs.promises.writeFile(tmp, content, "utf-8");
  try {
    await fs.promises.chmod(tmp, 0o600);
  } catch {
    /* Windows 可能不支持 chmod，忽略 */
  }

  let lastErr: NodeJS.ErrnoException | null = null;
  for (let i = 0; i < RENAME_RETRIES; i++) {
    try {
      await fs.promises.rename(tmp, filePath);
      return;
    } catch (err) {
      lastErr = err as NodeJS.ErrnoException;
      if (i < RENAME_RETRIES - 1) await delay(RENAME_RETRY_DELAY_MS);
    }
  }

  // 小型 JSON store 在少数环境中会在 rename 时遇到瞬时竞态，降级为直接写目标文件。
  if (lastErr && (lastErr.code === "ENOENT" || (process.platform === "win32" && (lastErr.code === "EPERM" || lastErr.code === "EBUSY")))) {
    try {
      await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
      await fs.promises.writeFile(filePath, content, "utf-8");
      await fs.promises.unlink(tmp).catch(() => {});
      return;
    } catch (fallbackErr) {
      await fs.promises.unlink(tmp).catch(() => {});
      throw fallbackErr;
    }
  }

  await fs.promises.unlink(tmp).catch(() => {});
  throw lastErr;
}

function randomCode(): string {
  let out = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    const idx = crypto.randomInt(0, PAIRING_CODE_ALPHABET.length);
    out += PAIRING_CODE_ALPHABET[idx];
  }
  return out;
}

function generateUniqueCode(existing: Set<string>): string {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const code = randomCode();
    if (!existing.has(code)) return code;
  }
  throw new Error("failed to generate unique pairing code");
}
