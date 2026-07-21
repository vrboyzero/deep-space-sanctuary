import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_DELAY_MS = 25;
const DEFAULT_STALE_AFTER_MS = 30_000;
const RELEASE_ATTEMPTS = 3;
const RELEASE_RETRY_DELAY_MS = 10;

type CronStoreLockOwner = {
  token: string;
  pid: number;
  createdAtMs: number;
  released?: boolean;
};

export type CronStoreFileLockOptions = {
  timeoutMs?: number;
  retryDelayMs?: number;
  staleAfterMs?: number;
};

export class CronStoreLockTimeoutError extends Error {
  readonly code = "cron_store_lock_timeout";

  constructor() {
    super("Timed out waiting for the CronStore mutation lock.");
    this.name = "CronStoreLockTimeoutError";
  }
}

export class CronStoreLockReleaseError extends Error {
  readonly code = "cron_store_lock_release_failed";

  constructor() {
    super("Failed to release the CronStore mutation lock.");
    this.name = "CronStoreLockReleaseError";
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error
    && (error as NodeJS.ErrnoException).code === "EEXIST";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDuration(value: number | undefined, fallback: number, minimum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.floor(value));
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error
      && (error as NodeJS.ErrnoException).code === "ESRCH");
  }
}

function isCompleteOwner(
  owner: Partial<CronStoreLockOwner> | undefined,
): owner is CronStoreLockOwner {
  return typeof owner?.token === "string"
    && Number.isSafeInteger(owner.pid)
    && Number.isFinite(owner.createdAtMs);
}

async function cleanupStaleFile(stalePath: string): Promise<void> {
  for (let attempt = 1; attempt <= RELEASE_ATTEMPTS; attempt += 1) {
    try {
      await fs.unlink(stalePath);
      return;
    } catch (error) {
      if (error instanceof Error
        && (error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      if (attempt < RELEASE_ATTEMPTS) {
        await delay(RELEASE_RETRY_DELAY_MS);
      }
    }
  }
}

async function recoverStaleLock(
  lockPath: string,
  nowMs: number,
  staleAfterMs: number,
): Promise<boolean> {
  let modifiedAtMs: number;
  try {
    modifiedAtMs = (await fs.stat(lockPath)).mtimeMs;
  } catch {
    return false;
  }

  let owner: Partial<CronStoreLockOwner> | undefined;
  try {
    owner = JSON.parse(await fs.readFile(lockPath, "utf-8")) as Partial<CronStoreLockOwner>;
  } catch {
    owner = undefined;
  }

  const isStale = isCompleteOwner(owner)
    ? owner.released === true
      || (nowMs - owner.createdAtMs >= staleAfterMs && !isProcessAlive(owner.pid))
    : nowMs - modifiedAtMs >= staleAfterMs;
  if (!isStale) {
    return false;
  }

  const stalePath = `${lockPath}.${crypto.randomUUID()}.stale`;
  try {
    await fs.rename(lockPath, stalePath);
  } catch {
    return false;
  }
  await cleanupStaleFile(stalePath);
  return true;
}

async function releaseLock(lockPath: string, token: string): Promise<void> {
  let lastOwner: Partial<CronStoreLockOwner> | undefined;
  for (let attempt = 1; attempt <= RELEASE_ATTEMPTS; attempt += 1) {
    try {
      const owner = JSON.parse(await fs.readFile(lockPath, "utf-8")) as Partial<CronStoreLockOwner>;
      if (owner.token !== token) return;
      lastOwner = owner;
      await fs.unlink(lockPath);
      return;
    } catch (error) {
      if (error instanceof Error
        && (error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      if (attempt < RELEASE_ATTEMPTS) {
        await delay(RELEASE_RETRY_DELAY_MS);
      }
    }
  }
  if (lastOwner?.token === token) {
    await fs.writeFile(lockPath, JSON.stringify({ ...lastOwner, released: true }), "utf-8")
      .catch(() => {});
  }
  throw new CronStoreLockReleaseError();
}

/**
 * CronStore 单文件跨进程 mutation owner。锁内容只保存释放所需的随机 token、pid 与时间戳。
 */
export async function withCronStoreFileLock<T>(
  filePath: string,
  operation: () => Promise<T>,
  options: CronStoreFileLockOptions = {},
): Promise<T> {
  const lockPath = `${path.resolve(filePath)}.lock`;
  const owner: CronStoreLockOwner = {
    token: crypto.randomUUID(),
    pid: process.pid,
    createdAtMs: Date.now(),
  };
  const timeoutMs = normalizeDuration(options.timeoutMs, DEFAULT_LOCK_TIMEOUT_MS, 0);
  const retryDelayMs = normalizeDuration(options.retryDelayMs, DEFAULT_RETRY_DELAY_MS, 1);
  const staleAfterMs = normalizeDuration(options.staleAfterMs, DEFAULT_STALE_AFTER_MS, 0);
  const deadline = Date.now() + timeoutMs;
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  while (true) {
    try {
      const handle = await fs.open(lockPath, "wx");
      try {
        await handle.writeFile(JSON.stringify(owner), "utf-8");
      } catch (error) {
        await handle.close().catch(() => {});
        await fs.unlink(lockPath).catch(() => {});
        throw error;
      }
      await handle.close();
      break;
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      if (await recoverStaleLock(lockPath, Date.now(), staleAfterMs)) {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new CronStoreLockTimeoutError();
      }
      await delay(retryDelayMs);
    }
  }

  try {
    return await operation();
  } finally {
    await releaseLock(lockPath, owner.token);
  }
}
