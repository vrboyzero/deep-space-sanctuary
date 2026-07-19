import fs from "node:fs/promises";

export const DEFAULT_CONVERSATION_TAIL_READ_CHUNK_BYTES = 64 * 1024;
export const DEFAULT_CONVERSATION_TAIL_READ_MAX_BYTES = 4 * 1024 * 1024;

export type BoundedTailLinesOptions = {
  maxLines: number;
  maxBytes?: number;
  chunkBytes?: number;
};

export type BoundedTailLinesResult = {
  lines: string[];
  bytesRead: number;
  /** 仅在字节预算耗尽且仍未读到文件开头时为 true。 */
  truncated: boolean;
};

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

function collectVisibleLines(chunks: readonly Buffer[], position: number): string[] {
  const rawLines = Buffer.concat(chunks).toString("utf-8").split("\n");
  // 尚未读到文件开头时，首项可能是被预算截断的半行，绝不能交给 JSON.parse。
  return (position > 0 ? rawLines.slice(1) : rawLines).filter((line) => line.trim());
}

function countLineBreaks(chunk: Buffer): number {
  let count = 0;
  for (const byte of chunk) {
    if (byte === 0x0a) count += 1;
  }
  return count;
}

/**
 * 从文件末尾读取有限数量的完整文本行。它只在固定字节预算内累积 Buffer，
 * 适合在线恢复最近对话，不替代完整 transcript 导出或离线修复读取。
 */
export async function readBoundedTailLines(
  filePath: string,
  options: BoundedTailLinesOptions,
): Promise<BoundedTailLinesResult> {
  const maxLines = normalizePositiveInteger(options.maxLines, 1);
  const maxBytes = normalizePositiveInteger(options.maxBytes, DEFAULT_CONVERSATION_TAIL_READ_MAX_BYTES);
  const chunkBytes = normalizePositiveInteger(options.chunkBytes, DEFAULT_CONVERSATION_TAIL_READ_CHUNK_BYTES);
  const handle = await fs.open(filePath, "r");

  try {
    const stat = await handle.stat();
    let position = stat.size;
    let bytesRead = 0;
    let lineBreakCount = 0;
    const chunks: Buffer[] = [];

    while (position > 0 && bytesRead < maxBytes) {
      const chunkSize = Math.min(chunkBytes, position, maxBytes - bytesRead);
      position -= chunkSize;

      const chunk = Buffer.allocUnsafe(chunkSize);
      const read = await handle.read(chunk, 0, chunkSize, position);
      if (read.bytesRead <= 0) break;

      const visibleChunk = chunk.subarray(0, read.bytesRead);
      chunks.unshift(visibleChunk);
      bytesRead += read.bytesRead;
      lineBreakCount += countLineBreaks(visibleChunk);
      // 超长无换行行在预算内无需反复 concat/UTF-8 解码；最后再一次性判定即可。
      if (position > 0 && lineBreakCount < maxLines) continue;
      const lines = collectVisibleLines(chunks, position);
      if (lines.length >= maxLines || position === 0) {
        return {
          lines: lines.slice(-maxLines),
          bytesRead,
          truncated: false,
        };
      }
    }

    const lines = collectVisibleLines(chunks, position);
    return {
      lines: lines.slice(-maxLines),
      bytesRead,
      truncated: position > 0,
    };
  } finally {
    await handle.close();
  }
}
