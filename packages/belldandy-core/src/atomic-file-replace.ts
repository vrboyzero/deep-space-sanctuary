import fs from "node:fs/promises";

const RENAME_RETRIES = 3;
const RENAME_RETRY_DELAY_MS = 50;
const RETRYABLE_RENAME_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);

export async function replaceFileWithRetry(
  sourcePath: string,
  targetPath: string,
  beforeAttempt?: () => Promise<void>,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    await beforeAttempt?.();
    try {
      await fs.rename(sourcePath, targetPath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (!RETRYABLE_RENAME_CODES.has(String(code ?? "")) || attempt >= RENAME_RETRIES - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_DELAY_MS));
    }
  }
}
