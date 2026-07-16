export type BoundedMediaFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type BoundedMediaReadOptions = {
  url: string;
  label: string;
  timeoutMs: number;
  maxBytes: number;
  fetchImpl?: BoundedMediaFetch;
};

function assertByteLimit(byteLength: number, options: BoundedMediaReadOptions): void {
  if (byteLength > options.maxBytes) {
    throw new Error(`${options.label} exceeds the ${options.maxBytes} byte limit: ${byteLength}`);
  }
}

function readDeclaredContentLength(response: Response): number | undefined {
  const headers = (response as Partial<Response>).headers;
  const rawValue = typeof headers?.get === "function" ? headers.get("content-length") : null;
  if (!rawValue?.trim()) return undefined;
  const parsed = Number(rawValue);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * 使用响应体流而非 `arrayBuffer()` 累积远端媒体，避免 header 到达后失去总 deadline 或突破内存上限。
 * URL/host 信任策略由上层 Adapter 决定；本模块只负责已批准请求的时间和字节边界。
 */
export async function readBoundedMediaBuffer(options: BoundedMediaReadOptions): Promise<Buffer> {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error(`Invalid media timeout for ${options.label}: ${options.timeoutMs}`);
  }
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) {
    throw new Error(`Invalid media byte limit for ${options.label}: ${options.maxBytes}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(options.url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to read ${options.label}: HTTP ${response.status}`);
    }

    const declaredContentLength = readDeclaredContentLength(response);
    if (declaredContentLength !== undefined) {
      assertByteLimit(declaredContentLength, options);
    }

    if (!response.body) {
      const arrayBuffer = (response as Partial<Response>).arrayBuffer;
      if (typeof arrayBuffer !== "function") {
        throw new Error(`Failed to read ${options.label}: response body is unavailable.`);
      }
      const buffer = Buffer.from(await arrayBuffer.call(response));
      assertByteLimit(buffer.length, options);
      return buffer;
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.length) continue;

        totalBytes += value.byteLength;
        assertByteLimit(totalBytes, options);
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks, totalBytes);
    } catch (error) {
      controller.abort();
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
  } finally {
    clearTimeout(timer);
  }
}
