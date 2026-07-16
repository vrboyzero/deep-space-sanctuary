import crypto from "node:crypto";
import {
  OutboundRequestPolicy,
  OutboundRequestPolicyError,
  redactSensitiveValue,
  type OutboundRequestPolicyOptions,
} from "@belldandy/protocol";
import type { Tool, ToolContext, ToolCallResult } from "../types.js";
import { withToolContract } from "../tool-contract.js";
import {
  createLinkedAbortController,
  isAbortError,
  readAbortReason,
  throwIfAborted,
} from "../abort-utils.js";
import { buildFailureToolCallResult } from "../failure-kind.js";

type FetchToolDependencies = {
  createOutboundRequestPolicy?: (options: OutboundRequestPolicyOptions) => Pick<OutboundRequestPolicy, "request">;
};

export const fetchTool: Tool = createFetchTool();

/** 供测试和受控 Adapter 注入出站 transport，生产默认使用 pinned Node HTTP(S) transport。 */
export function createFetchTool(dependencies: FetchToolDependencies = {}): Tool {
  return withToolContract({
    definition: {
      name: "web_fetch",
      description: "获取指定 URL 的内容。默认仅允许公网 HTTPS；HTTP 和内网地址需要显式受信配置。",
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

      try {
        throwIfAborted(context.abortSignal);
      } catch {
        return makeError(readAbortReason(context.abortSignal), "environment_error");
      }

      const url = args.url;
      if (typeof url !== "string" || !url.trim()) {
        return makeError("参数错误：url 必须是非空字符串", "input_error");
      }

      const method = normalizeMethod(args.method);
      if (!method) {
        return makeError("参数错误：method 仅支持 GET 或 POST", "input_error");
      }
      const headers = normalizeHeaders(args.headers);
      const body = method === "POST" && typeof args.body === "string" ? args.body : undefined;
      const { maxTimeoutMs, maxResponseBytes } = context.policy;
      const outboundPolicy = dependencies.createOutboundRequestPolicy?.({
        allowedHosts: context.policy.allowedDomains,
        deniedHosts: context.policy.deniedDomains,
        allowInsecureHttp: isExplicitlyEnabled("BELLDANDY_WEB_FETCH_ALLOW_INSECURE_HTTP"),
        allowPrivateNetwork: isExplicitlyEnabled("BELLDANDY_WEB_FETCH_ALLOW_PRIVATE_NETWORK"),
      }) ?? new OutboundRequestPolicy({
        allowedHosts: context.policy.allowedDomains,
        deniedHosts: context.policy.deniedDomains,
        allowInsecureHttp: isExplicitlyEnabled("BELLDANDY_WEB_FETCH_ALLOW_INSECURE_HTTP"),
        allowPrivateNetwork: isExplicitlyEnabled("BELLDANDY_WEB_FETCH_ALLOW_PRIVATE_NETWORK"),
      });
      const linkedAbort = createLinkedAbortController({
        signal: context.abortSignal,
        timeoutMs: maxTimeoutMs,
        timeoutReason: `Timeout after ${maxTimeoutMs}ms`,
      });

      try {
        const request = await outboundPolicy.request({
          url,
          method,
          headers,
          body,
          signal: linkedAbort.controller.signal,
          idleTimeoutMs: maxTimeoutMs,
        });
        const response = request.response;
        const contentLength = parseContentLength(response.headers.get("content-length"));
        if (contentLength !== undefined && contentLength > maxResponseBytes) {
          await cancelResponseBody(response);
          return buildFetchResult({
            id,
            name,
            start,
            response,
            body: "",
            bytes: 0,
            truncated: true,
            contentLength,
            finalUrl: request.url.toString(),
          });
        }

        const readResult = await readBoundedResponseText(response, maxResponseBytes);
        return buildFetchResult({
          id,
          name,
          start,
          response,
          body: readResult.body,
          bytes: readResult.bytes,
          truncated: readResult.truncated,
          finalUrl: request.url.toString(),
        });
      } catch (error) {
        if (error instanceof OutboundRequestPolicyError) {
          return makeError(
            formatOutboundPolicyError(error),
            isOutboundInputError(error) ? "input_error" : "permission_or_policy",
          );
        }
        if (isAbortError(error) || linkedAbort.wasTimedOut()) {
          if (context.abortSignal?.aborted) {
            return makeError(readAbortReason(context.abortSignal), "environment_error");
          }
          return makeError(`请求超时（${maxTimeoutMs}ms）`, "environment_error");
        }
        return makeError("请求失败，请稍后重试。", "environment_error");
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
}

function normalizeMethod(value: unknown): "GET" | "POST" | undefined {
  const method = typeof value === "string" ? value.trim().toUpperCase() : "GET";
  return method === "GET" || method === "POST" ? method : undefined;
}

function normalizeHeaders(value: unknown): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return headers;
  }
  for (const [key, headerValue] of Object.entries(value as Record<string, unknown>)) {
    if (typeof headerValue === "string") {
      headers[key] = headerValue;
    }
  }
  return headers;
}

async function readBoundedResponseText(
  response: Response,
  maxResponseBytes: number,
): Promise<{ body: string; bytes: number; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) {
    return { body: "", bytes: 0, truncated: false };
  }

  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      const remaining = maxResponseBytes - bytes;
      if (value.byteLength > remaining) {
        if (remaining > 0) {
          chunks.push(value.slice(0, remaining));
          bytes += remaining;
        }
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      bytes += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    body: new TextDecoder("utf-8", { fatal: false }).decode(buffer),
    bytes,
    truncated,
  };
}

function buildFetchResult(input: {
  id: string;
  name: string;
  start: number;
  response: Response;
  body: string;
  bytes: number;
  truncated: boolean;
  contentLength?: number;
  finalUrl: string;
}): ToolCallResult {
  return {
    id: input.id,
    name: input.name,
    success: true,
    output: JSON.stringify({
      status: input.response.status,
      statusText: input.response.statusText,
      headers: redactSensitiveValue(Object.fromEntries(input.response.headers.entries())),
      body: input.body,
      truncated: input.truncated,
      bytes: input.bytes,
      ...(input.contentLength === undefined ? {} : { contentLength: input.contentLength }),
      finalUrl: input.finalUrl,
    }),
    durationMs: Date.now() - input.start,
  };
}

function parseContentLength(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function formatOutboundPolicyError(error: OutboundRequestPolicyError): string {
  switch (error.code) {
    case "invalid_url":
      return "无效的 URL";
    case "unsupported_scheme":
      return "不支持的协议：仅支持 HTTP/HTTPS";
    case "insecure_scheme":
      return "HTTP 请求需要显式允许";
    case "userinfo_not_allowed":
      return "URL 不允许包含用户名或密码";
    case "host_denied":
      return "域名被禁止";
    case "host_not_allowed":
      return "域名不在白名单中";
    case "private_network_not_allowed":
      return "禁止访问内网地址";
    case "dns_unavailable":
      return "DNS 解析失败，已拒绝请求";
    case "redirect_limit":
    case "redirect_without_location":
      return "重定向不符合安全策略";
    case "idle_timeout":
      return "请求连接空闲超时";
  }
}

function isOutboundInputError(error: OutboundRequestPolicyError): boolean {
  return error.code === "invalid_url"
    || error.code === "unsupported_scheme"
    || error.code === "userinfo_not_allowed";
}

function isExplicitlyEnabled(name: string): boolean {
  return ["1", "true", "yes", "on"].includes(String(process.env[name] ?? "").trim().toLowerCase());
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Content-Length 已超过 hard limit；取消失败不允许继续读取正文。
  }
}
