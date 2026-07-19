import { OutboundRequestPolicy } from "@belldandy/protocol";

const DEFAULT_GATEWAY_PORT = 28889;
const DEFAULT_GATEWAY_REACHABILITY_TIMEOUT_MS = 800;

export type GatewayRuntimeReachability = {
  reachable: boolean;
  healthUrl: string;
};

export type GatewayRuntimeReachabilityOptions = {
  timeoutMs?: number;
  outboundRequestPolicy?: Pick<OutboundRequestPolicy, "request">;
};

export function resolveGatewayBaseUrl(envValues: ReadonlyMap<string, string>): string {
  const rawHost = (envValues.get("BELLDANDY_HOST") ?? "127.0.0.1").trim() || "127.0.0.1";
  const host = rawHost === "0.0.0.0" ? "127.0.0.1" : rawHost;
  const portValue = Number(envValues.get("BELLDANDY_PORT") ?? String(DEFAULT_GATEWAY_PORT));
  const port = Number.isFinite(portValue) && portValue >= 1 && portValue <= 65535
    ? Math.floor(portValue)
    : DEFAULT_GATEWAY_PORT;
  return `http://${host}:${port}`;
}

/**
 * 本机 Gateway 明确允许明文和私网地址，但仍限定 configured host、固定 DNS 结果且禁止 redirect。
 */
export async function checkGatewayRuntimeReachability(
  envValues: ReadonlyMap<string, string>,
  options: GatewayRuntimeReachabilityOptions = {},
): Promise<GatewayRuntimeReachability> {
  const healthUrl = `${resolveGatewayBaseUrl(envValues).replace(/\/+$/, "")}/health`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_GATEWAY_REACHABILITY_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL(healthUrl);
    const outboundRequestPolicy = options.outboundRequestPolicy ?? new OutboundRequestPolicy({
      allowInsecureHttp: true,
      allowPrivateNetwork: true,
      allowedHosts: [url.hostname],
      maxRedirects: 0,
    });
    const { response } = await outboundRequestPolicy.request({
      url,
      method: "GET",
      signal: controller.signal,
      maxRedirects: 0,
      idleTimeoutMs: timeoutMs,
    });
    const reachable = response.ok;
    await response.body?.cancel().catch(() => {});
    return { reachable, healthUrl };
  } catch {
    return { reachable: false, healthUrl };
  } finally {
    clearTimeout(timeout);
  }
}
