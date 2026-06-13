import crypto from "node:crypto";
import dns from "node:dns/promises";
import type { Tool, ToolContext, ToolCallResult } from "../types.js";
import { withToolContract } from "../tool-contract.js";
import {
  createLinkedAbortController,
  isAbortError,
  readAbortReason,
  throwIfAborted,
} from "../abort-utils.js";
import { buildFailureToolCallResult } from "../failure-kind.js";

export const fetchTool: Tool = withToolContract({
  definition: {
    name: "web_fetch",
    description: "获取指定 URL 的内容。仅支持 HTTP/HTTPS 协议，受域名白名单/黑名单限制，禁止访问内网地址。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "要访问的 URL" },
        method: {
          type: "string",
          description: "HTTP 方法（默认 GET）",
          enum: ["GET", "POST"],
        },
        headers: {
          type: "object",
          description: "请求头（可选）",
        },
        body: {
          type: "string",
          description: "请求体（POST 时使用）",
        },
      },
      required: ["url"],
    },
  },

  async execute(args, context): Promise<ToolCallResult> {
    const start = Date.now();
    const id = crypto.randomUUID();
    const name = "web_fetch";

    const makeError = (error: string, failureKind?: ToolCallResult["failureKind"]): ToolCallResult => (
      buildFailureToolCallResult({
        id,
        name,
        start,
        error,
        ...(failureKind ? { failureKind } : {}),
      })
    );

    // 参数校验
    try {
      throwIfAborted(context.abortSignal);
    } catch {
      return makeError(readAbortReason(context.abortSignal), "environment_error");
    }

    const urlStr = args.url;
    if (typeof urlStr !== "string" || !urlStr.trim()) {
      return makeError("参数错误：url 必须是非空字符串", "input_error");
    }

    let url: URL;
    try {
      url = new URL(urlStr);
    } catch {
      return makeError(`无效的 URL：${urlStr}`, "input_error");
    }

    // 安全检查 1：协议限制
    if (!["http:", "https:"].includes(url.protocol)) {
      return makeError(`不支持的协议：${url.protocol}（仅支持 http/https）`, "input_error");
    }

    const hostname = url.hostname.toLowerCase();

    // 安全检查 2：禁止内网地址
    if (isPrivateHost(hostname)) {
      return makeError(`禁止访问内网地址：${hostname}`, "permission_or_policy");
    }

    // 安全检查 3：域名黑名单
    const { deniedDomains, allowedDomains, maxTimeoutMs, maxResponseBytes } = context.policy;
    if (deniedDomains.length > 0) {
      const denied = deniedDomains.find(d => hostname === d || hostname.endsWith(`.${d}`));
      if (denied) {
        return makeError(`域名被禁止：${hostname}`, "permission_or_policy");
      }
    }

    // 安全检查 4：域名白名单（如果配置了白名单，则只允许白名单内的域名）
    if (allowedDomains.length > 0) {
      const allowed = allowedDomains.some(d => hostname === d || hostname.endsWith(`.${d}`));
      if (!allowed) {
        return makeError(`域名不在白名单中：${hostname}`, "permission_or_policy");
      }
    }

    // 准备请求
    const method = (typeof args.method === "string" ? args.method.toUpperCase() : "GET") as "GET" | "POST";
    const headers: Record<string, string> = {};

    if (args.headers && typeof args.headers === "object") {
      for (const [k, v] of Object.entries(args.headers as Record<string, unknown>)) {
        if (typeof v === "string") {
          headers[k] = v;
        }
      }
    }

    const body = method === "POST" && typeof args.body === "string" ? args.body : undefined;

    // [SECURITY] DNS 解析后二次校验（防 DNS Rebinding）
    try {
      throwIfAborted(context.abortSignal);
      const { address } = await dns.lookup(hostname);
      if (isPrivateIP(address)) {
          return makeError(`SSRF 防护：DNS 解析到内网地址 ${address}`, "permission_or_policy");
      }
    } catch (dnsErr) {
      if (context.abortSignal?.aborted) {
        return makeError(readAbortReason(context.abortSignal), "environment_error");
      }
      if (!shouldAllowFetchAfterDnsFailure(dnsErr)) {
        return makeError(buildDnsFailureRejectMessage(hostname, dnsErr), "permission_or_policy");
      }
    }

    // 执行请求
    const linkedAbort = createLinkedAbortController({
      signal: context.abortSignal,
      timeoutMs: maxTimeoutMs,
      timeoutReason: `Timeout after ${maxTimeoutMs}ms`,
    });

    try {
      const response = await fetch(url.toString(), {
        method,
        headers,
        body,
        signal: linkedAbort.controller.signal,
        redirect: "manual", // 禁止自动重定向（防 SSRF）
      });

      // 读取响应（限制大小）
      const reader = response.body?.getReader();
      if (!reader) {
        return {
          id,
          name,
          success: true,
          output: JSON.stringify({
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(Array.from(response.headers as unknown as Iterable<[string, string]>)),
            body: "",
          }),
          durationMs: Date.now() - start,
        };
      }

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      let truncated = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        if (totalBytes + value.length > maxResponseBytes) {
          // 截断
          const remaining = maxResponseBytes - totalBytes;
          if (remaining > 0) {
            chunks.push(value.slice(0, remaining));
          }
          truncated = true;
          reader.cancel();
          break;
        }

        chunks.push(value);
        totalBytes += value.length;
      }

      const bodyBuffer = new Uint8Array(Math.min(totalBytes, maxResponseBytes));
      let offset = 0;
      for (const chunk of chunks) {
        bodyBuffer.set(chunk, offset);
        offset += chunk.length;
      }

      const bodyText = new TextDecoder("utf-8", { fatal: false }).decode(bodyBuffer);

      return {
        id,
        name,
        success: true,
        output: JSON.stringify({
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(Array.from(response.headers as unknown as Iterable<[string, string]>)),
          body: bodyText,
          truncated,
          bytes: totalBytes,
        }),
        durationMs: Date.now() - start,
      };
    } catch (err) {
      if (isAbortError(err)) {
        if (context.abortSignal?.aborted) {
          return makeError(readAbortReason(context.abortSignal), "environment_error");
        }
        if (linkedAbort.wasTimedOut()) {
          return makeError(`请求超时（${maxTimeoutMs}ms）`, "environment_error");
        }
        return makeError(`请求超时（${maxTimeoutMs}ms）`, "environment_error");
      }

      return makeError(err instanceof Error ? err.message : String(err));
    } finally {
      linkedAbort.cleanup();
    }
  },
}, {
  family: "network-read",
  isReadOnly: true,
  isConcurrencySafe: true,
  needsPermission: false,
  riskLevel: "medium",
  channels: ["gateway", "web"],
  safeScopes: ["local-safe", "web-safe"],
  activityDescription: "Fetch content from an external HTTP or HTTPS URL",
  resultSchema: {
    kind: "json",
    description: "HTTP response metadata and truncated body content encoded as JSON text.",
  },
  outputPersistencePolicy: "conversation",
});

/** 检查是否为私有/内网地址 */
function isPrivateHost(hostname: string): boolean {
  // localhost
  if (hostname === "localhost") return true;

  // IPv4 私有地址
  if (hostname === "127.0.0.1") return true;
  if (hostname.startsWith("10.")) return true;
  if (hostname.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)) return true;

  // 链路本地
  if (hostname.startsWith("169.254.")) return true;

  // IPv6 本地
  if (hostname === "::1" || hostname === "[::1]") return true;
  if (hostname.startsWith("fe80:") || hostname.startsWith("[fe80:")) return true;

  // 0.0.0.0
  if (hostname === "0.0.0.0") return true;

  return false;
}

/** 检查 IP 是否为私有/内网地址（用于 DNS 解析后的二次校验） */
function isPrivateIP(ip: string): boolean {
  // IPv4 私有地址
  if (ip === "127.0.0.1" || ip.startsWith("127.")) return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
  if (ip.startsWith("169.254.")) return true;
  if (ip === "0.0.0.0") return true;

  // IPv6 本地
  if (ip === "::1" || ip.startsWith("fe80:")) return true;

  return false;
}

function shouldAllowFetchAfterDnsFailure(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  return code === "ENOTFOUND" || code === "ENODATA" || code === "EAI_NONAME";
}

function buildDnsFailureRejectMessage(hostname: string, error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const detail = error instanceof Error ? error.message : String(error);
  return code
    ? `SSRF 防护：DNS 解析 ${hostname} 失败（${code}），已拒绝请求：${detail}`
    : `SSRF 防护：DNS 解析 ${hostname} 失败，已拒绝请求：${detail}`;
}
