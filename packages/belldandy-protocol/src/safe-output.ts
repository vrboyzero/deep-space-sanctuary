/**
 * 跨 transport 的安全输出原语。
 *
 * 这里不记录原始异常，也不依赖具体日志实现，避免每个入口各自维护一套
 * 凭据字段名单或把内部错误直接透传给外部调用方。
 */
export const REDACTED_VALUE = "[REDACTED]";

export type PublicFailureCode =
  | "invalid_request"
  | "access_denied"
  | "not_found"
  | "request_timeout"
  | "upstream_unavailable"
  | "internal_error";

export type PublicFailureEnvelope = {
  code: PublicFailureCode;
  message: string;
  retryable: boolean;
};

export type RedactSensitiveValueOptions = {
  maxDepth?: number;
  maxKeys?: number;
  maxArrayEntries?: number;
  maxStringBytes?: number;
  maxTotalBytes?: number;
};

export type ReadResponseTextBoundedOptions = {
  maxBytes?: number;
};

export type BoundedResponseText = {
  text: string;
  bytes: number;
  truncated: boolean;
};

const DEFAULT_REDACTION_OPTIONS: Required<RedactSensitiveValueOptions> = {
  maxDepth: 6,
  maxKeys: 50,
  maxArrayEntries: 50,
  maxStringBytes: 2048,
  maxTotalBytes: 8192,
};

const SENSITIVE_KEY_PATTERN = /(?:api[_-]?key|access[_-]?key|authorization|auth(?:entication)?|bearer|cookie|credential|pass(?:word|phrase)?|private[_-]?key|secret|session|signature|token)/i;
const URL_VALUE_KEY_PATTERN = /(?:callback|endpoint|href|redirect|target|uri|url)$/i;
const SENSITIVE_QUERY_KEY_PATTERN = /(?:api[_-]?key|access[_-]?key|auth(?:entication)?|bearer|cookie|credential|pass(?:word|phrase)?|private[_-]?key|secret|session|signature|token)/i;

const PUBLIC_FAILURE_MESSAGES: Record<PublicFailureCode, Pick<PublicFailureEnvelope, "message" | "retryable">> = {
  invalid_request: { message: "请求参数无效，请检查后重试。", retryable: false },
  access_denied: { message: "当前请求未获授权。", retryable: false },
  not_found: { message: "请求的资源不存在或不可访问。", retryable: false },
  request_timeout: { message: "请求处理超时，请稍后重试。", retryable: true },
  upstream_unavailable: { message: "上游服务暂时不可用，请稍后重试。", retryable: true },
  internal_error: { message: "请求处理失败，请稍后重试。", retryable: true },
};

/**
 * 构造只包含稳定 code 与用户可见文案的失败信封。error 仅用于调用方的
 * 内部诊断决策，绝不能被写入返回对象。
 */
export function createPublicFailureEnvelope(input: {
  code: PublicFailureCode;
  error?: unknown;
  retryable?: boolean;
}): PublicFailureEnvelope {
  const definition = PUBLIC_FAILURE_MESSAGES[input.code];
  return {
    code: input.code,
    message: definition.message,
    retryable: input.retryable ?? definition.retryable,
  };
}

/** 将文本中的常见凭据形式替换为固定占位符。 */
export function redactSensitiveText(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, `$1${REDACTED_VALUE}`)
    .replace(/(proxy-authorization\s*[:=]\s*)(?:basic\s+)?[^\s,;]+/gi, `$1${REDACTED_VALUE}`)
    .replace(/\bbearer\s+[a-z0-9._~+/=-]+/gi, `Bearer ${REDACTED_VALUE}`)
    .replace(/\b(?:api[_-]?key|access[_-]?key|auth(?:entication)?|cookie|credential|pass(?:word|phrase)?|private[_-]?key|secret|session|signature|token)\s*([:=])\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi, (match, separator) => {
      const key = match.slice(0, match.indexOf(separator)).trim();
      return `${key}${separator}${REDACTED_VALUE}`;
    });
}

/**
 * 深层清洗用于日志/审计的未知值。遍历同时受 depth、collection 与 UTF-8
 * 字节预算约束，因此异常对象、循环引用或超长 Provider body 不会放大诊断面。
 */
export function redactSensitiveValue(
  value: unknown,
  inputOptions: RedactSensitiveValueOptions = {},
): unknown {
  const options = { ...DEFAULT_REDACTION_OPTIONS, ...inputOptions };
  const state = {
    remainingBytes: Math.max(0, options.maxTotalBytes),
    seen: new WeakSet<object>(),
  };
  return redactValue(value, options, state, 0);
}

export function redactSensitiveUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEY_PATTERN.test(key)) {
        url.searchParams.set(key, REDACTED_VALUE);
      }
    }
    return url.toString();
  } catch {
    return redactSensitiveText(value);
  }
}

/**
 * Provider 的错误正文也属于不可信输入。先以字节上限读取并取消剩余流，再对
 * 保留片段脱敏，防止 `response.text()` 在截断逻辑执行前耗尽内存。
 */
export async function readResponseTextBounded(
  response: Pick<Response, "body">,
  options: ReadResponseTextBoundedOptions = {},
): Promise<BoundedResponseText> {
  const maxBytes = normalizePositiveInteger(options.maxBytes, 2048);
  const reader = response.body?.getReader();
  if (!reader) {
    return { text: "", bytes: 0, truncated: false };
  }

  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      const remaining = maxBytes - bytes;
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
  } catch {
    // 错误正文不可读时只保留已经安全读取的前缀，不传播下游原始异常。
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
    text: redactSensitiveText(new TextDecoder("utf-8", { fatal: false }).decode(buffer)),
    bytes,
    truncated,
  };
}

function redactValue(
  value: unknown,
  options: Required<RedactSensitiveValueOptions>,
  state: { remainingBytes: number; seen: WeakSet<object> },
  depth: number,
  key?: string,
): unknown {
  if (key && SENSITIVE_KEY_PATTERN.test(key)) {
    return REDACTED_VALUE;
  }

  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const safeValue = key && URL_VALUE_KEY_PATTERN.test(key)
      ? redactSensitiveUrl(value)
      : redactSensitiveText(value);
    return takeBoundedText(safeValue, options.maxStringBytes, state);
  }

  if (typeof value === "bigint") {
    return takeBoundedText(value.toString(), options.maxStringBytes, state);
  }

  if (typeof value === "undefined") {
    return "[UNDEFINED]";
  }

  const valueType = typeof value;
  if (valueType === "function" || valueType === "symbol") {
    return `[${valueType.toUpperCase()}]`;
  }

  if (value instanceof Error) {
    return {
      name: takeBoundedText(value.name || "Error", options.maxStringBytes, state),
      message: takeBoundedText(redactSensitiveText(value.message), options.maxStringBytes, state),
    };
  }

  if (typeof value !== "object") {
    return "[UNSUPPORTED]";
  }

  if (state.seen.has(value)) {
    return "[CIRCULAR]";
  }
  if (depth >= options.maxDepth) {
    return "[MAX_DEPTH]";
  }
  state.seen.add(value);

  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const item of value.slice(0, options.maxArrayEntries)) {
      result.push(redactValue(item, options, state, depth + 1));
    }
    if (value.length > options.maxArrayEntries) {
      result.push("[TRUNCATED]");
    }
    return result;
  }

  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  const entries = Object.entries(record);
  for (const [entryKey, entryValue] of entries.slice(0, options.maxKeys)) {
    result[entryKey] = redactValue(entryValue, options, state, depth + 1, entryKey);
  }
  if (entries.length > options.maxKeys) {
    result.__truncated__ = "[TRUNCATED]";
  }
  return result;
}

function takeBoundedText(
  value: string,
  maxStringBytes: number,
  state: { remainingBytes: number },
): string {
  const allowedBytes = Math.min(Math.max(0, maxStringBytes), state.remainingBytes);
  if (allowedBytes <= 0) {
    return "[TRUNCATED]";
  }

  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= allowedBytes) {
    state.remainingBytes -= encoded.byteLength;
    return value;
  }

  const marker = "[TRUNCATED]";
  const markerBytes = new TextEncoder().encode(marker).byteLength;
  const bodyBudget = Math.max(0, allowedBytes - markerBytes);
  const truncated = truncateUtf8(value, bodyBudget);
  state.remainingBytes -= Math.min(allowedBytes, new TextEncoder().encode(`${truncated}${marker}`).byteLength);
  return `${truncated}${marker}`;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  let result = "";
  let usedBytes = 0;
  for (const character of value) {
    const nextBytes = new TextEncoder().encode(character).byteLength;
    if (usedBytes + nextBytes > maxBytes) break;
    result += character;
    usedBytes += nextBytes;
  }
  return result;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}
