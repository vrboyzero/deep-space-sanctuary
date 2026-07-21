import type { HttpInstance, HttpRequestOptions } from "@larksuiteoapi/node-sdk";
import { OutboundRequestPolicy } from "@belldandy/protocol";
import type { OutboundRequestInit } from "@belldandy/protocol";
import { Readable } from "node:stream";

export const FEISHU_OPEN_API_BASE_URL = "https://open.feishu.cn";
export const FEISHU_JSON_MAX_RESPONSE_BYTES = 1024 * 1024;
export const FEISHU_RESOURCE_MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
export const FEISHU_HTTP_IDLE_TIMEOUT_MS = 30_000;

export type FeishuOutboundRequestPolicy = Pick<OutboundRequestPolicy, "request">;

export type FeishuHttpInstanceOptions = {
  baseUrl?: string;
  outboundRequestPolicy?: FeishuOutboundRequestPolicy;
  jsonMaxResponseBytes?: number;
  resourceMaxResponseBytes?: number;
  idleTimeoutMs?: number;
};

type FeishuRequestOptions<D = unknown> = HttpRequestOptions<D> & {
  signal?: AbortSignal;
};

type FeishuHttpErrorResponse = {
  status: number;
  statusText: string;
  data: unknown;
  headers: Record<string, string>;
};

export class FeishuHttpError extends Error {
  readonly name = "FeishuHttpError";

  constructor(
    message: string,
    readonly response: FeishuHttpErrorResponse,
  ) {
    super(message);
  }
}

/**
 * 适配 Lark SDK 的 axios-like HttpInstance，同时把真实 HTTP I/O 收口到统一 outbound policy。
 */
export function createFeishuHttpInstance(options: FeishuHttpInstanceOptions = {}): HttpInstance {
  const baseUrl = new URL(options.baseUrl ?? FEISHU_OPEN_API_BASE_URL);
  const outboundRequestPolicy = options.outboundRequestPolicy ?? new OutboundRequestPolicy({
    allowedHosts: [baseUrl.hostname],
    maxRedirects: 0,
  });
  const jsonMaxResponseBytes = normalizeByteLimit(
    options.jsonMaxResponseBytes,
    FEISHU_JSON_MAX_RESPONSE_BYTES,
  );
  const resourceMaxResponseBytes = normalizeByteLimit(
    options.resourceMaxResponseBytes,
    FEISHU_RESOURCE_MAX_RESPONSE_BYTES,
  );
  const idleTimeoutMs = normalizeIdleTimeout(options.idleTimeoutMs, FEISHU_HTTP_IDLE_TIMEOUT_MS);

  const execute = async <D>(requestOptions: FeishuRequestOptions<D>): Promise<unknown> => {
    if (!requestOptions.url) throw new TypeError("Feishu HTTP request URL is required.");
    const url = appendQueryParams(new URL(requestOptions.url, baseUrl), requestOptions);
    const headers = normalizeHeaders(requestOptions.headers);
    const body = normalizeRequestBody(requestOptions.data, headers);
    const signal = requestOptions.signal;
    const { response } = await outboundRequestPolicy.request({
      url,
      method: requestOptions.method,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body,
      signal,
      maxRedirects: 0,
      idleTimeoutMs: normalizeIdleTimeout(requestOptions.timeout, idleTimeoutMs),
    });
    const responseHeaders = Object.fromEntries(response.headers.entries());

    if (!response.ok) {
      const data = await readBoundedResponseValue(response, "json", jsonMaxResponseBytes, signal);
      throw new FeishuHttpError(
        `Feishu HTTP request failed with status ${response.status}.`,
        {
          status: response.status,
          statusText: response.statusText,
          data,
          headers: responseHeaders,
        },
      );
    }

    const data = requestOptions.responseType === "stream"
      ? await createBoundedResourceStream(response, resourceMaxResponseBytes, signal)
      : await readBoundedResponseValue(
          response,
          requestOptions.responseType ?? "json",
          jsonMaxResponseBytes,
          signal,
        );
    return requestOptions.$return_headers
      ? { data, headers: responseHeaders }
      : data;
  };

  const request = <T = any, R = T, D = any>(requestOptions: HttpRequestOptions<D>): Promise<R> => (
    execute(requestOptions as FeishuRequestOptions<D>) as Promise<R>
  );
  const withMethod = <T = any, R = T, D = any>(
    method: string,
    url: string,
    data: D | undefined,
    requestOptions: HttpRequestOptions<D> = {},
  ): Promise<R> => request<T, R, D>({ ...requestOptions, url, method, data });

  return {
    request,
    get: (url, requestOptions) => withMethod("GET", url, undefined, requestOptions),
    delete: (url, requestOptions) => withMethod("DELETE", url, undefined, requestOptions),
    head: (url, requestOptions) => withMethod("HEAD", url, undefined, requestOptions),
    options: (url, requestOptions) => withMethod("OPTIONS", url, undefined, requestOptions),
    post: (url, data, requestOptions) => withMethod("POST", url, data, requestOptions),
    put: (url, data, requestOptions) => withMethod("PUT", url, data, requestOptions),
    patch: (url, data, requestOptions) => withMethod("PATCH", url, data, requestOptions),
  };
}

function appendQueryParams<D>(url: URL, options: HttpRequestOptions<D>): URL {
  if (!options.params || Object.keys(options.params).length === 0) return url;
  const serialized = typeof options.paramsSerializer === "function"
    ? options.paramsSerializer(options.params)
    : serializeDefaultParams(options.params);
  if (!serialized) return url;
  const next = new URL(url);
  const query = serialized.startsWith("?") ? serialized.slice(1) : serialized;
  next.search = next.search ? `${next.search.slice(1)}&${query}` : query;
  return next;
}

function serializeDefaultParams(params: Record<string, unknown>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) searchParams.append(key, String(item));
    } else {
      searchParams.append(key, String(value));
    }
  }
  return searchParams.toString();
}

function normalizeHeaders(input: Record<string, unknown> | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (value === undefined || value === null) continue;
    headers[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return headers;
}

function normalizeRequestBody(
  data: unknown,
  headers: Record<string, string>,
): OutboundRequestInit["body"] {
  if (data === undefined || data === null) return undefined;
  if (typeof data === "string" || data instanceof Uint8Array || data instanceof Readable) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof URLSearchParams) {
    headers["content-type"] ??= "application/x-www-form-urlencoded;charset=UTF-8";
    return data.toString();
  }
  headers["content-type"] ??= "application/json";
  return JSON.stringify(data);
}

async function readBoundedResponseValue(
  response: Response,
  responseType: NonNullable<HttpRequestOptions<unknown>["responseType"]>,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const bytes = await readBoundedResponseBytes(response, maxBytes, "JSON", signal);
  if (responseType === "arraybuffer") return Buffer.from(bytes);
  if (responseType === "blob") return new Blob([copyToArrayBuffer(bytes)]);
  const text = Buffer.from(bytes).toString("utf8");
  if (responseType === "text" || responseType === "document") return text;
  if (responseType === "formdata") {
    return await new Response(copyToArrayBuffer(bytes), { headers: response.headers }).formData();
  }
  if (!text) return undefined;
  return JSON.parse(text);
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function createBoundedResourceStream(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Readable> {
  await validateDeclaredLength(response, maxBytes, "resource");
  if (!response.body) return Readable.from([]);

  const reader = response.body.getReader();
  let totalBytes = 0;
  let completed = false;
  async function* read(): AsyncGenerator<Uint8Array> {
    try {
      while (true) {
        throwIfAborted(signal);
        const next = await readWithAbort(reader, signal);
        if (next.done) {
          completed = true;
          return;
        }
        const chunk = new Uint8Array(next.value.buffer, next.value.byteOffset, next.value.byteLength);
        totalBytes += chunk.byteLength;
        if (totalBytes > maxBytes) {
          throw new Error(`Feishu resource response exceeds ${maxBytes} byte limit.`);
        }
        yield chunk;
      }
    } finally {
      if (!completed) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  return Readable.from(read());
}

async function readBoundedResponseBytes(
  response: Response,
  maxBytes: number,
  label: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  await validateDeclaredLength(response, maxBytes, label);
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
        throw new Error(`Feishu ${label} response exceeds ${maxBytes} byte limit.`);
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (!completed) await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function validateDeclaredLength(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<void> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength === null) return;
  if (!/^\d+$/u.test(declaredLength.trim())) {
    await cancelResponseBody(response);
    throw new Error(`Feishu ${label} response has invalid Content-Length.`);
  }
  if (Number(declaredLength) > maxBytes) {
    await cancelResponseBody(response);
    throw new Error(`Feishu ${label} response exceeds ${maxBytes} byte limit.`);
  }
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
  const error = new Error("Feishu HTTP request was aborted.");
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

function normalizeByteLimit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback;
}

function normalizeIdleTimeout(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}
