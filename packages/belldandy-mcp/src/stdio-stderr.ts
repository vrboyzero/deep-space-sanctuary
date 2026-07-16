import { StringDecoder } from "node:string_decoder";

export const DEFAULT_STDIO_STDERR_MAX_LINE_BYTES = 16 * 1024;

export type BoundedStdioStderrLine = {
  line: string;
  truncatedBytes: number;
};

/**
 * 将外部 MCP stderr 按行释放，同时只保留每行有限的 UTF-8 字节。
 * StringDecoder 负责跨 chunk 的多字节字符，避免把截断点错误地当作文本边界。
 */
export class BoundedStdioStderrLineBuffer {
  private readonly decoder = new StringDecoder("utf8");
  private pending = "";
  private pendingBytes = 0;
  private truncatedBytes = 0;

  constructor(private readonly maxLineBytes = DEFAULT_STDIO_STDERR_MAX_LINE_BYTES) {}

  push(chunk: Buffer | Uint8Array | string): BoundedStdioStderrLine[] {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
    return this.consume(this.decoder.write(buffer));
  }

  finish(): BoundedStdioStderrLine[] {
    const lines = this.consume(this.decoder.end());
    if (this.pending || this.truncatedBytes > 0) {
      lines.push(this.flush());
    }
    return lines;
  }

  private consume(text: string): BoundedStdioStderrLine[] {
    const lines: BoundedStdioStderrLine[] = [];
    for (const character of text) {
      if (character === "\n") {
        lines.push(this.flush());
        continue;
      }

      const characterBytes = Buffer.byteLength(character, "utf8");
      if (this.pendingBytes + characterBytes <= this.maxLineBytes) {
        this.pending += character;
        this.pendingBytes += characterBytes;
      } else {
        this.truncatedBytes += characterBytes;
      }
    }
    return lines;
  }

  private flush(): BoundedStdioStderrLine {
    const line = this.pending.replace(/\r$/, "");
    const result = { line, truncatedBytes: this.truncatedBytes };
    this.pending = "";
    this.pendingBytes = 0;
    this.truncatedBytes = 0;
    return result;
  }
}
