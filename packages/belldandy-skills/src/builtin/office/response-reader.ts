import { raceWithAbort, throwIfAborted } from "../../abort-utils.js";

export interface BoundedOfficeJsonResponseOptions {
  response: Pick<Response, "body" | "headers">;
  maxBytes: number;
  abortSignal?: AbortSignal;
}

/** Office JSON 正文必须先经过原始字节限额，避免 `response.json()` 无界聚合。 */
export async function readBoundedOfficeJsonResponse(
  options: BoundedOfficeJsonResponseOptions,
): Promise<unknown> {
  return JSON.parse(await readBoundedOfficeResponseText(options));
}

export async function readBoundedOfficeResponseText(
  options: BoundedOfficeJsonResponseOptions,
): Promise<string> {
  const { response, maxBytes, abortSignal } = options;
  const body = response.body;
  if (!body) throw new Error("Office JSON response has no readable body");

  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength.trim())) {
      await cancelOfficeResponseBody(response);
      throw new Error("Office JSON response has invalid Content-Length");
    }
    if (Number(declaredLength) > maxBytes) {
      await cancelOfficeResponseBody(response);
      throw new Error(`Office JSON response exceeds ${maxBytes} byte limit`);
    }
  }

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let byteLength = 0;
  let completed = false;
  try {
    while (true) {
      throwIfAborted(abortSignal);
      const next = await raceWithAbort(reader.read(), abortSignal);
      if (next.done) {
        completed = true;
        break;
      }
      const chunk = Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength);
      byteLength += chunk.length;
      if (byteLength > maxBytes) {
        throw new Error(`Office JSON response exceeds ${maxBytes} byte limit`);
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (!completed) {
      await reader.cancel(error).catch(() => undefined);
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  throwIfAborted(abortSignal);
  return Buffer.concat(chunks, byteLength).toString("utf8");
}

async function cancelOfficeResponseBody(response: Pick<Response, "body">): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 已决定不再消费正文，取消失败不得覆盖原始状态或字节限额错误。
  }
}
