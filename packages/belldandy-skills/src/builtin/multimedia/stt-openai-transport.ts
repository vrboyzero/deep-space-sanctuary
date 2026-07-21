import { OutboundRequestPolicy } from "@belldandy/protocol";

import { raceWithAbort, throwIfAborted } from "../../abort-utils.js";

export const STT_OPENAI_MAX_RESPONSE_BYTES = 1024 * 1024;

export type SttOpenAIOutboundRequestPolicy = Pick<OutboundRequestPolicy, "request">;

export function createSttOpenAIFetch(input: {
  baseURL: string;
  outboundRequestPolicy?: SttOpenAIOutboundRequestPolicy;
}): typeof globalThis.fetch {
  const configuredUrl = new URL(input.baseURL);
  const outboundRequestPolicy = input.outboundRequestPolicy ?? new OutboundRequestPolicy({
    allowedHosts: [configuredUrl.hostname],
    maxRedirects: 0,
  });

  const fetch = async (requestInput: string | URL | Request, init?: RequestInit) => {
    const normalized = await normalizeRequest(requestInput, init);
    const { response } = await outboundRequestPolicy.request({
      url: normalized.url,
      method: normalized.method,
      headers: normalized.headers,
      body: normalized.body,
      signal: normalized.signal,
      maxRedirects: 0,
    });
    return await bufferBoundedResponse(response, normalized.signal);
  };

  // OpenAI v6 uses this marker to verify that the injected fetch supports native FormData.
  Object.defineProperty(fetch, "Response", { value: Response });
  return fetch as typeof globalThis.fetch;
}

async function normalizeRequest(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<{
  url: URL;
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  signal?: AbortSignal;
}> {
  const url = typeof input === "string" || input instanceof URL
    ? new URL(input)
    : new URL(input.url);
  const method = init?.method ?? (input instanceof Request ? input.method : undefined);
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined) ?? undefined;
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  const body = init?.body;

  if (body instanceof FormData) {
    throwIfAborted(signal);
    const serializedRequest = new Request(url, {
      method: method ?? "POST",
      headers,
      body,
      signal,
    });
    const serializedBody = new Uint8Array(await raceWithAbort(
      serializedRequest.arrayBuffer(),
      signal,
    ));
    throwIfAborted(signal);
    return {
      url,
      method,
      headers: normalizeHeaders(serializedRequest.headers),
      body: serializedBody,
      signal,
    };
  }

  return {
    url,
    method,
    headers: normalizeHeaders(headers),
    body: normalizeBufferedBody(body),
    signal,
  };
}

function normalizeHeaders(input: Headers): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  input.forEach((value, key) => {
    headers[key] = value;
  });
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function normalizeBufferedBody(body: BodyInit | null | undefined): string | Uint8Array | undefined {
  if (body === null || body === undefined) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  throw new TypeError("OpenAI-compatible STT request body must be multipart or buffered.");
}

async function bufferBoundedResponse(response: Response, signal?: AbortSignal): Promise<Response> {
  const bytes = await readBoundedResponseBytes(response, signal);
  const headers = new Headers(response.headers);
  headers.set("content-length", String(bytes.byteLength));
  const body = response.status === 204 || response.status === 205 || response.status === 304
    ? null
    : Uint8Array.from(bytes).buffer;
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function readBoundedResponseBytes(response: Response, signal?: AbortSignal): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength.trim())) {
      await cancelResponseBody(response);
      throw new Error("OpenAI-compatible STT response has invalid Content-Length.");
    }
    if (Number(declaredLength) > STT_OPENAI_MAX_RESPONSE_BYTES) {
      await cancelResponseBody(response);
      throw new Error(
        `OpenAI-compatible STT response exceeds ${STT_OPENAI_MAX_RESPONSE_BYTES} byte limit.`,
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
      if (byteLength > STT_OPENAI_MAX_RESPONSE_BYTES) {
        throw new Error(
          `OpenAI-compatible STT response exceeds ${STT_OPENAI_MAX_RESPONSE_BYTES} byte limit.`,
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
    // 已决定拒绝正文，取消失败不得覆盖原始限界错误。
  }
}
