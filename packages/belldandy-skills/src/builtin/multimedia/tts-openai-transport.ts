import { OutboundRequestPolicy } from "@belldandy/protocol";

import { raceWithAbort, throwIfAborted } from "../../abort-utils.js";

export const TTS_OPENAI_MAX_ERROR_RESPONSE_BYTES = 1024 * 1024;

export type TtsOpenAIOutboundRequestPolicy = Pick<OutboundRequestPolicy, "request">;

export function createTtsOpenAIFetch(input: {
  baseURL: string;
  outboundRequestPolicy?: TtsOpenAIOutboundRequestPolicy;
}): typeof globalThis.fetch {
  const configuredUrl = new URL(input.baseURL);
  const outboundRequestPolicy = input.outboundRequestPolicy ?? new OutboundRequestPolicy({
    allowedHosts: [configuredUrl.hostname],
    maxRedirects: 0,
  });

  return async (requestInput, init) => {
    const { response } = await outboundRequestPolicy.request({
      url: resolveRequestUrl(requestInput),
      method: init?.method,
      headers: normalizeHeaders(init?.headers),
      body: normalizeRequestBody(init?.body),
      signal: init?.signal ?? undefined,
      maxRedirects: 0,
    });
    if (response.ok) return response;
    return await bufferBoundedErrorResponse(response, init?.signal ?? undefined);
  };
}

function resolveRequestUrl(input: string | URL | Request): URL {
  if (typeof input === "string" || input instanceof URL) return new URL(input);
  return new URL(input.url);
}

function normalizeHeaders(input: HeadersInit | undefined): Record<string, string> | undefined {
  if (!input) return undefined;
  const headers: Record<string, string> = {};
  new Headers(input).forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

function normalizeRequestBody(body: BodyInit | null | undefined): string | Uint8Array | undefined {
  if (body === null || body === undefined) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  throw new TypeError("OpenAI TTS request body must be buffered JSON.");
}

async function bufferBoundedErrorResponse(
  response: Response,
  signal?: AbortSignal,
): Promise<Response> {
  const bytes = await readBoundedErrorResponseBytes(response, signal);
  const headers = new Headers(response.headers);
  headers.set("content-length", String(bytes.byteLength));
  return new Response(Uint8Array.from(bytes).buffer, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function readBoundedErrorResponseBytes(
  response: Response,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength.trim())) {
      await cancelResponseBody(response);
      throw new Error("OpenAI TTS error response has invalid Content-Length.");
    }
    if (Number(declaredLength) > TTS_OPENAI_MAX_ERROR_RESPONSE_BYTES) {
      await cancelResponseBody(response);
      throw new Error(
        `OpenAI TTS error response exceeds ${TTS_OPENAI_MAX_ERROR_RESPONSE_BYTES} byte limit.`,
      );
    }
  }

  const body = response.body;
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let completed = false;
  try {
    while (true) {
      throwIfAborted(signal);
      const next = await raceWithAbort(reader.read(), signal);
      if (next.done) {
        completed = true;
        break;
      }
      const chunk = new Uint8Array(next.value.buffer, next.value.byteOffset, next.value.byteLength);
      byteLength += chunk.byteLength;
      if (byteLength > TTS_OPENAI_MAX_ERROR_RESPONSE_BYTES) {
        throw new Error(
          `OpenAI TTS error response exceeds ${TTS_OPENAI_MAX_ERROR_RESPONSE_BYTES} byte limit.`,
        );
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (!completed) await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  throwIfAborted(signal);
  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function cancelResponseBody(response: Pick<Response, "body">): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 已决定拒绝错误正文，取消失败不得覆盖原始限界错误。
  }
}
