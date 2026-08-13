import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const RENAME_RETRIES = 3;
const RENAME_RETRY_DELAY_MS = 50;

export async function atomicWriteMarketplaceJson(
  targetPath: string,
  value: unknown,
  options: { trailingNewline?: boolean } = {},
): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${crypto.randomUUID()}.tmp`;
  const content = `${JSON.stringify(value, null, 2)}${options.trailingNewline ? "\n" : ""}`;
  await fs.writeFile(tempPath, content, "utf-8");
  try {
    await renameWithRetry(tempPath, targetPath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function renameWithRetry(sourcePath: string, targetPath: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(sourcePath, targetPath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      const retryable = code === "EPERM" || code === "EACCES" || code === "EBUSY";
      if (!retryable || attempt >= RENAME_RETRIES - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_DELAY_MS));
    }
  }
}
