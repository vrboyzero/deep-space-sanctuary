import {
  FileMutationLockReleaseError,
  FileMutationLockTimeoutError,
  withFileMutationLock,
  type FileMutationLockOptions,
} from "../file-mutation-lock.js";

export type CronStoreFileLockOptions = FileMutationLockOptions;

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

/**
 * CronStore 领域 Adapter；保留既有错误契约，文件锁生命周期由 Core 中性 owner 持有。
 */
export async function withCronStoreFileLock<T>(
  filePath: string,
  operation: () => Promise<T>,
  options: CronStoreFileLockOptions = {},
): Promise<T> {
  try {
    return await withFileMutationLock(filePath, operation, options);
  } catch (error) {
    if (error instanceof FileMutationLockTimeoutError) {
      throw new CronStoreLockTimeoutError();
    }
    if (error instanceof FileMutationLockReleaseError) {
      throw new CronStoreLockReleaseError();
    }
    throw error;
  }
}
