import crypto from "node:crypto";
import { createPublicFailureEnvelope, redactSensitiveText } from "@belldandy/protocol";

type ChannelSafeLogSink = {
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
};

export type ChannelSafeLogInput = {
  channel: string;
  event: string;
  messageId?: string;
  accountId?: string;
  body?: string;
  decision?: string;
  failureKind?: string;
  durationMs?: number;
  context?: Record<string, string | number | boolean | undefined>;
};

const DEFAULT_LOG_SINK: ChannelSafeLogSink = {
  info: (message, data) => console.log(message, data ?? ""),
  warn: (message, data) => console.warn(message, data ?? ""),
  error: (message, data) => console.error(message, data ?? ""),
};

const UNSAFE_CONTEXT_KEY = /(?:arguments?|body|content|error|message|output|payload|result|text)/i;

/**
 * Channel ingress 可能包含用户正文、附件 URL 与 Tool 参数。日志默认只保留可
 * 聚合的 hash/字节数，不把原文放入长期 console 或外部日志 sink。
 */
export class ChannelSafeLogger {
  constructor(private readonly sink: ChannelSafeLogSink = DEFAULT_LOG_SINK) {}

  info(input: ChannelSafeLogInput): void {
    this.write("info", input);
  }

  warn(input: ChannelSafeLogInput): void {
    this.write("warn", input);
  }

  error(input: ChannelSafeLogInput): void {
    this.write("error", input);
  }

  private write(level: keyof ChannelSafeLogSink, input: ChannelSafeLogInput): void {
    const record = {
      channel: input.channel,
      event: input.event,
      ...(input.messageId ? { messageHash: hashChannelIdentifier(input.messageId) } : {}),
      ...(input.accountId ? { accountId: input.accountId } : {}),
      ...(input.body === undefined ? {} : {
        bodyBytes: Buffer.byteLength(input.body, "utf8"),
        bodyHash: hashChannelIdentifier(input.body),
      }),
      ...(input.decision ? { decision: input.decision } : {}),
      ...(input.failureKind ? { failureKind: input.failureKind } : {}),
      ...(typeof input.durationMs === "number" ? { durationMs: input.durationMs } : {}),
      ...(input.context ? { context: sanitizeContext(input.context) } : {}),
    };
    this.sink[level](`[channel:${input.channel}] ${input.event}`, record);
  }
}

export function createChannelApprovalPreview(value: string, maxBytes = 240): string {
  const safe = redactSensitiveText(value);
  const encoded = new TextEncoder().encode(safe);
  if (encoded.byteLength <= maxBytes) return safe;
  const marker = "[TRUNCATED]";
  const limit = Math.max(0, maxBytes - new TextEncoder().encode(marker).byteLength);
  let result = "";
  let used = 0;
  for (const character of safe) {
    const bytes = new TextEncoder().encode(character).byteLength;
    if (used + bytes > limit) break;
    result += character;
    used += bytes;
  }
  return `${result}${marker}`;
}

export function createChannelPublicFailureMessage(): string {
  return createPublicFailureEnvelope({ code: "internal_error" }).message;
}

function sanitizeContext(context: Record<string, string | number | boolean | undefined>): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined || UNSAFE_CONTEXT_KEY.test(key)) continue;
    if (typeof value === "string") {
      result[key] = redactSensitiveText(value).slice(0, 128);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function hashChannelIdentifier(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}
