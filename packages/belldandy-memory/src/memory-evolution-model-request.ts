import { OutboundRequestPolicy } from "@belldandy/protocol";

import { buildOpenAIChatCompletionsUrl } from "./openai-url.js";

export const MEMORY_EVOLUTION_MAX_RESPONSE_BYTES = 1024 * 1024;

export type MemoryEvolutionModelResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

export type MemoryEvolutionModelRequestOptions = {
  baseUrl: string;
  apiKey: string;
  payload: Record<string, unknown>;
  signal?: AbortSignal;
  idleTimeoutMs: number;
  outboundRequestPolicy?: Pick<OutboundRequestPolicy, "request">;
};

/**
 * 统一承担 durable extraction 模型请求的 endpoint admission 与 pinned transport。
 */
export async function requestMemoryEvolutionModel(
  options: MemoryEvolutionModelRequestOptions,
): Promise<MemoryEvolutionModelResponse> {
  const url = new URL(buildOpenAIChatCompletionsUrl(options.baseUrl));
  const outboundRequestPolicy = options.outboundRequestPolicy ?? new OutboundRequestPolicy({
    allowedHosts: [url.hostname],
    maxRedirects: 0,
  });
  const { response } = await outboundRequestPolicy.request({
    url,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify(options.payload),
    signal: options.signal,
    maxRedirects: 0,
    idleTimeoutMs: options.idleTimeoutMs,
  });
  const responseText = await readBoundedEvolutionResponse(response, options.signal);
  if (!response.ok) {
    throw new Error(`Evolution LLM call failed: ${response.status} ${responseText.slice(0, 200)}`);
  }
  return JSON.parse(responseText) as MemoryEvolutionModelResponse;
}

async function readBoundedEvolutionResponse(
  response: Pick<Response, "body" | "headers">,
  abortSignal?: AbortSignal,
): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null
    && /^\d+$/u.test(declaredLength.trim())
    && Number(declaredLength) > MEMORY_EVOLUTION_MAX_RESPONSE_BYTES
  ) {
    await cancelResponseBody(response);
    throw new Error(`Evolution LLM response exceeds ${MEMORY_EVOLUTION_MAX_RESPONSE_BYTES} byte limit.`);
  }
  if (abortSignal?.aborted) {
    await cancelResponseBody(response);
    throwIfAborted(abortSignal);
  }

  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let byteLength = 0;
  let completed = false;
  try {
    while (true) {
      throwIfAborted(abortSignal);
      const next = await readWithAbort(reader, abortSignal);
      if (next.done) {
        completed = true;
        break;
      }
      const chunk = Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength);
      byteLength += chunk.length;
      if (byteLength > MEMORY_EVOLUTION_MAX_RESPONSE_BYTES) {
        throw new Error(`Evolution LLM response exceeds ${MEMORY_EVOLUTION_MAX_RESPONSE_BYTES} byte limit.`);
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (!completed) await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  throwIfAborted(abortSignal);
  return Buffer.concat(chunks, byteLength).toString("utf8");
}

function readWithAbort<T>(
  reader: ReadableStreamDefaultReader<T>,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<T>> {
  throwIfAborted(signal);
  if (!signal) return reader.read();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      try {
        throwIfAborted(signal);
      } catch (error) {
        reject(error);
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error("Evolution LLM call was aborted.");
  error.name = "AbortError";
  throw error;
}

async function cancelResponseBody(response: Pick<Response, "body">): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 已决定拒绝正文，取消失败不得覆盖原始限界错误。
  }
}
