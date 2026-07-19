import { isIP } from "node:net";

import {
  OutboundRequestPolicy,
  type OutboundDnsLookup,
  type OutboundRequestAdapter,
  type OutboundRequestInit,
} from "@belldandy/protocol";

type ModelProxyFetch = (
  url: URL,
  init: RequestInit & { dispatcher?: unknown },
) => Promise<Response>;

type ModelProxyDispatcherFactory = (proxyUrl: string) => Promise<unknown | undefined>;

export type ModelRequestTransportOptions = {
  url: string | URL;
  init: RequestInit;
  idleTimeoutMs: number;
  proxyUrl?: string;
  outboundRequestPolicy?: Pick<OutboundRequestPolicy, "request">;
  dnsLookup?: OutboundDnsLookup;
  proxyDispatcherFactory?: ModelProxyDispatcherFactory;
  fetchImpl?: ModelProxyFetch;
};

const proxyDispatcherCache = new Map<string, unknown>();

/**
 * 模型请求的 configured-endpoint transport owner；failover client 只保留策略编排。
 */
export async function requestModelTransport(
  options: ModelRequestTransportOptions,
): Promise<Response> {
  const url = options.url instanceof URL ? options.url : new URL(options.url);
  const trustedLoopback = isExplicitLoopback(url.hostname);
  const proxyRequestAdapter = options.proxyUrl?.trim()
    ? createProxyRequestAdapter(options.proxyUrl, options)
    : undefined;
  const outboundRequestPolicy = options.outboundRequestPolicy ?? new OutboundRequestPolicy({
    allowedHosts: [url.hostname],
    allowInsecureHttp: trustedLoopback,
    allowPrivateNetwork: trustedLoopback,
    maxRedirects: 0,
    dnsLookup: options.dnsLookup,
    requestAdapter: proxyRequestAdapter,
  });
  const { response } = await outboundRequestPolicy.request({
    url,
    method: options.init.method,
    headers: normalizeHeaders(options.init.headers),
    body: normalizeBody(options.init.body),
    signal: options.init.signal ?? undefined,
    maxRedirects: 0,
    idleTimeoutMs: options.idleTimeoutMs,
  });
  return response;
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> | undefined {
  if (headers === undefined) return undefined;
  return Object.fromEntries(new Headers(headers).entries());
}

function normalizeBody(body: BodyInit | null | undefined): OutboundRequestInit["body"] {
  if (body === undefined || body === null || typeof body === "string" || body instanceof Uint8Array) {
    return body ?? undefined;
  }
  throw new TypeError("Model request transport only supports string or Uint8Array bodies.");
}

function isExplicitLoopback(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1").replace(/\.$/, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  if (normalized === "::1") return true;
  return isIP(normalized) === 4 && normalized.startsWith("127.");
}

function createProxyRequestAdapter(
  proxyUrl: string,
  options: ModelRequestTransportOptions,
): OutboundRequestAdapter {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch as ModelProxyFetch;

  return async (input) => {
    const dispatcher = await getProxyDispatcher(proxyUrl, options.proxyDispatcherFactory);
    if (!dispatcher) {
      throw new Error("Configured model proxy transport is unavailable.");
    }
    // ProxyAgent owns socket resolution, so policy admission remains local but the target address cannot be pinned here.
    const requestInit: RequestInit & { dispatcher?: unknown } = {
      method: input.init.method,
      headers: input.init.headers,
      body: input.init.body as BodyInit | undefined,
      signal: input.init.signal,
      redirect: "manual",
      dispatcher,
    };
    return fetchImpl(input.url, requestInit);
  };
}

async function getProxyDispatcher(
  proxyUrl: string,
  factory?: ModelProxyDispatcherFactory,
): Promise<unknown | undefined> {
  const normalized = proxyUrl.trim();
  if (factory) return factory(normalized);

  const cached = proxyDispatcherCache.get(normalized);
  if (cached) return cached;
  try {
    const moduleName = ["undici"].join("");
    const undici = await import(moduleName);
    const ProxyAgentCtor = (undici as { ProxyAgent?: new (url: string) => unknown }).ProxyAgent;
    if (typeof ProxyAgentCtor !== "function") return undefined;
    const dispatcher = new ProxyAgentCtor(normalized);
    proxyDispatcherCache.set(normalized, dispatcher);
    return dispatcher;
  } catch {
    return undefined;
  }
}
