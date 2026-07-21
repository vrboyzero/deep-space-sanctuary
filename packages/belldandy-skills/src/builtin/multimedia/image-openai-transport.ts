import { OutboundRequestPolicy } from "@belldandy/protocol";

import { raceWithAbort, throwIfAborted } from "../../abort-utils.js";

export const IMAGE_OPENAI_RESPONSE_ENVELOPE_BYTES = 1024 * 1024;

export type ImageOpenAIOutboundRequestPolicy = Pick<OutboundRequestPolicy, "request">;

export function calculateImageOpenAIMaxResponseBytes(maxOutputBytes: number): number {
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new Error("OpenAI image output byte limit must be a positive safe integer.");
  }
  const base64Bytes = Math.ceil(maxOutputBytes / 3) * 4;
  return Math.min(Number.MAX_SAFE_INTEGER, base64Bytes + IMAGE_OPENAI_RESPONSE_ENVELOPE_BYTES);
}

export function createImageOpenAIFetch(input: {
  baseURL: string;
  maxResponseBytes: number;
  outboundRequestPolicy?: ImageOpenAIOutboundRequestPolicy;
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
    return await bufferBoundedResponse(response, input.maxResponseBytes, init?.signal ?? undefined);
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
  throw new TypeError("OpenAI image request body must be buffered JSON.");
}

async function bufferBoundedResponse(
  response: Response,
  maxResponseBytes: number,
  signal?: AbortSignal,
): Promise<Response> {
  const bytes = await readBoundedResponseBytes(response, maxResponseBytes, signal);
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

async function readBoundedResponseBytes(
  response: Response,
  maxResponseBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!/^\d+$/u.test(declaredLength.trim()) || !Number.isSafeInteger(parsedLength)) {
      await cancelResponseBody(response);
      throw new Error("OpenAI image response has invalid Content-Length.");
    }
    if (parsedLength > maxResponseBytes) {
      await cancelResponseBody(response);
      throw new Error(`OpenAI image response exceeds ${maxResponseBytes} byte limit.`);
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
      if (byteLength > maxResponseBytes) {
        throw new Error(`OpenAI image response exceeds ${maxResponseBytes} byte limit.`);
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
