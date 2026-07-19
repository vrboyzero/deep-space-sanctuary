import type { Readable } from "node:stream";

export type BoundedLineReaderOptions = {
  input: Readable;
  maxLineBytes: number;
  onLine: (line: string) => void;
  onLimitExceeded: (observedBytes: number) => void;
  onError?: (error: Error) => void;
};

/** 按原始字节切分 UTF-8 行，超限前停止累积，避免 readline 持有无界单行。 */
export class BoundedLineReader {
  private readonly input: Readable;
  private readonly maxLineBytes: number;
  private readonly onLine: (line: string) => void;
  private readonly onLimitExceeded: (observedBytes: number) => void;
  private readonly onError?: (error: Error) => void;
  private fragments: Buffer[] = [];
  private lineBytes = 0;
  private closed = false;

  constructor(options: BoundedLineReaderOptions) {
    this.input = options.input;
    this.maxLineBytes = Math.max(1, Math.floor(options.maxLineBytes));
    this.onLine = options.onLine;
    this.onLimitExceeded = options.onLimitExceeded;
    this.onError = options.onError;
    this.input.on("data", this.handleData);
    this.input.once("end", this.handleEnd);
    this.input.once("error", this.handleError);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.input.off("data", this.handleData);
    this.input.off("end", this.handleEnd);
    this.input.off("error", this.handleError);
    this.fragments = [];
    this.lineBytes = 0;
  }

  private readonly handleData = (data: Buffer | string): void => {
    if (this.closed) return;
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
    let start = 0;
    for (let index = 0; index < chunk.length; index += 1) {
      if (chunk[index] !== 0x0a) continue;
      if (!this.appendFragment(chunk.subarray(start, index))) return;
      this.emitLine();
      start = index + 1;
    }
    if (start < chunk.length) {
      this.appendFragment(chunk.subarray(start));
    }
  };

  private readonly handleEnd = (): void => {
    if (this.closed) return;
    if (this.lineBytes > 0) {
      this.emitLine();
    }
    this.close();
  };

  private readonly handleError = (error: Error): void => {
    if (this.closed) return;
    this.close();
    this.onError?.(error);
  };

  private appendFragment(fragment: Buffer): boolean {
    if (fragment.length === 0) return true;
    const observedBytes = this.lineBytes + fragment.length;
    if (observedBytes > this.maxLineBytes) {
      this.close();
      this.onLimitExceeded(observedBytes);
      return false;
    }
    this.fragments.push(fragment);
    this.lineBytes = observedBytes;
    return true;
  }

  private emitLine(): void {
    let line = Buffer.concat(this.fragments, this.lineBytes);
    if (line.length > 0 && line[line.length - 1] === 0x0d) {
      line = line.subarray(0, -1);
    }
    this.fragments = [];
    this.lineBytes = 0;
    this.onLine(line.toString("utf8"));
  }
}
