import type { ClientOptions } from "discord.js";
import { Readable } from "node:stream";

import { OutboundRequestPolicy } from "@belldandy/protocol";
import type { OutboundRequestInit } from "@belldandy/protocol";

export const DISCORD_API_BASE_URL = "https://discord.com/api";
export const DISCORD_REST_MAX_RESPONSE_BYTES = 1024 * 1024;
export const DISCORD_REST_TIMEOUT_MS = 15_000;

export type DiscordRestOutboundRequestPolicy = Pick<OutboundRequestPolicy, "request">;

export type DiscordRestTransportOptions = {
  outboundRequestPolicy?: DiscordRestOutboundRequestPolicy;
  maxResponseBytes?: number;
  timeoutMs?: number;
};

type DiscordRestOptions = NonNullable<ClientOptions["rest"]>;
type DiscordRestMakeRequest = NonNullable<DiscordRestOptions["makeRequest"]>;
type DiscordRestRequestInit = Parameters<DiscordRestMakeRequest>[1];
type DiscordRestResponse = Awaited<ReturnType<DiscordRestMakeRequest>>;

/**
 * 只替换 discord.js REST I/O；SDK 继续持有 token、rate limit、retry 与 Gateway 生命周期。
 */
export function createDiscordRestMakeRequest(
  options: DiscordRestTransportOptions = {},
): DiscordRestMakeRequest {
  const apiBaseUrl = new URL(DISCORD_API_BASE_URL);
  const outboundRequestPolicy = options.outboundRequestPolicy ?? new OutboundRequestPolicy({
    allowedHosts: [apiBaseUrl.hostname],
    maxRedirects: 0,
  });
  const maxResponseBytes = normalizePositiveInt(
    options.maxResponseBytes,
    DISCORD_REST_MAX_RESPONSE_BYTES,
  );
  const timeoutMs = normalizePositiveInt(options.timeoutMs, DISCORD_REST_TIMEOUT_MS);

  return async (input, init) => {
    const url = new URL(input);
    assertOfficialApiUrl(url, apiBaseUrl);
    const { response } = await outboundRequestPolicy.request({
      url,
      method: init.method,
      headers: normalizeHeaders(init.headers),
      body: await normalizeRequestBody(init.body),
      signal: init.signal ?? undefined,
      maxRedirects: 0,
      idleTimeoutMs: timeoutMs,
    });
    return await bufferBoundedResponse(
      response,
      maxResponseBytes,
      init.signal ?? undefined,
    ) as DiscordRestResponse;
  };
}

export function createDiscordRestClientOptions(
  options: DiscordRestTransportOptions = {},
): Pick<DiscordRestOptions, "makeRequest" | "timeout"> {
  const timeout = normalizePositiveInt(options.timeoutMs, DISCORD_REST_TIMEOUT_MS);
  return {
    makeRequest: createDiscordRestMakeRequest({ ...options, timeoutMs: timeout }),
    timeout,
  };
}

function assertOfficialApiUrl(url: URL, apiBaseUrl: URL): void {
  const apiPath = apiBaseUrl.pathname.replace(/\/$/u, "");
  if (
    url.protocol !== apiBaseUrl.protocol
    || url.host !== apiBaseUrl.host
    || (url.pathname !== apiPath && !url.pathname.startsWith(`${apiPath}/`))
  ) {
    throw new TypeError("Discord REST requests must target the official Discord API endpoint.");
  }
}

function normalizeHeaders(input: DiscordRestRequestInit["headers"]): Record<string, string> | undefined {
  if (!input) return undefined;
  const headers: Record<string, string> = {};
  if (Symbol.iterator in Object(input)) {
    for (const [key, value] of input as Iterable<[string, string]>) {
      headers[key] = String(value);
    }
  } else {
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue;
      headers[key] = Array.isArray(value) ? value.join(", ") : String(value);
    }
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

async function normalizeRequestBody(
  body: DiscordRestRequestInit["body"],
): Promise<OutboundRequestInit["body"]> {
  if (body === null || body === undefined) return undefined;
  if (typeof body === "string" || body instanceof Uint8Array || body instanceof Readable) {
    return body;
  }
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  throw new TypeError("Discord REST request body must be buffered JSON or binary data.");
}

async function bufferBoundedResponse(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Response> {
  const bytes = await readBoundedResponseBytes(response, maxBytes, signal);
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
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength.trim())) {
      await cancelResponseBody(response);
      throw new Error("Discord REST response has invalid Content-Length.");
    }
    if (Number(declaredLength) > maxBytes) {
      await cancelResponseBody(response);
      throw new Error(`Discord REST response exceeds ${maxBytes} byte limit.`);
    }
  }

  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let completed = false;
  try {
    while (true) {
      throwIfAborted(signal);
      const next = await readWithAbort(reader, signal);
      if (next.done) {
        completed = true;
        break;
      }
      const chunk = new Uint8Array(next.value.buffer, next.value.byteOffset, next.value.byteLength);
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        throw new Error(`Discord REST response exceeds ${maxBytes} byte limit.`);
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
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
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
      reject(signal.reason instanceof Error ? signal.reason : createAbortError());
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
  throw signal.reason instanceof Error ? signal.reason : createAbortError();
}

function createAbortError(): Error {
  const error = new Error("Discord REST request was aborted.");
  error.name = "AbortError";
  return error;
}

async function cancelResponseBody(response: Pick<Response, "body">): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 已拒绝响应正文，取消失败不得覆盖原始限界错误。
  }
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;
}
