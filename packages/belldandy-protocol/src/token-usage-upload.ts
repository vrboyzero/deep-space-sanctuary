import { createHash } from "node:crypto";

import { readResponseTextBounded, redactSensitiveText, redactSensitiveUrl } from "./safe-output.js";

export type TokenUsageUploadConfig = {
  enabled: boolean;
  url?: string;
  token?: string;
  timeoutMs: number;
};

export type TokenUsageUploadLogger = {
  warn: (module: string, message: string, data?: unknown) => void;
};

export type TokenUsageUploadRequestInput = {
  url: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
  timeoutMs: number;
};

export type TokenUsageUploadRequest = (input: TokenUsageUploadRequestInput) => Promise<Response>;

export type TokenUsageUploadRuntimeSnapshot = {
  id: "token_usage_upload";
  activeCount: number;
  queuedCount: number;
  capacity: number;
};

export type TokenUsageUploadSchedulerOptions = {
  batchWindowMs?: number;
  maxConcurrentUploads?: number;
  maxConcurrentUploadsPerEndpoint?: number;
  maxTrackedKeys?: number;
  overflowWarnIntervalMs?: number;
  now?: () => number;
  request?: TokenUsageUploadRequest;
  setTimeoutFn?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
};

export type TokenUsageUploadScheduler = {
  upload: (input: TokenUsageUploadInput) => Promise<void>;
  getRuntimeSnapshot: () => TokenUsageUploadRuntimeSnapshot;
  reset: () => void;
};

export type TokenUsageUploadInput = {
  config: TokenUsageUploadConfig;
  userUuid?: string;
  conversationId: string;
  deltaTokens: number;
  source: string;
  log: TokenUsageUploadLogger;
};

type NormalizedUpload = {
  key: string;
  endpointId: string;
  config: Required<Pick<TokenUsageUploadConfig, "url" | "timeoutMs">> & Pick<TokenUsageUploadConfig, "token">;
  userUuid?: string;
  conversationId: string;
  deltaTokens: number;
  source: string;
  log: TokenUsageUploadLogger;
};

type UploadSlot = {
  key: string;
  endpointId: string;
  config: NormalizedUpload["config"];
  userUuid?: string;
  conversationId: string;
  source: string;
  log: TokenUsageUploadLogger;
  pendingDeltaTokens: number;
  pendingCompletion?: UploadCompletion;
  activeCompletion?: UploadCompletion;
  inFlight: boolean;
  timer?: ReturnType<typeof setTimeout>;
  controller?: AbortController;
};

type UploadCompletion = {
  promise: Promise<void>;
  resolve: () => void;
};

type OverflowAggregate = {
  droppedKeys: number;
  droppedTokens: number;
  lastWarnAt: number;
};

const TOKEN_USAGE_UPLOAD_BATCH_WINDOW_MS = 25;
const DEFAULT_MAX_CONCURRENT_UPLOADS = 4;
const DEFAULT_MAX_CONCURRENT_UPLOADS_PER_ENDPOINT = 1;
const DEFAULT_MAX_TRACKED_KEYS = 128;
const DEFAULT_OVERFLOW_WARN_INTERVAL_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 3_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_TRACKED_KEYS = 4_096;
const MAX_IDENTIFIER_LENGTH = 512;
const MAX_URL_LENGTH = 4_096;
const MAX_TOKEN_LENGTH = 8_192;
const MAX_DELTA_TOKENS = 1_000_000_000;
const MAX_OVERFLOW_ENDPOINTS = 16;
const MAX_ERROR_BODY_BYTES = 2_048;

async function requestTokenUsageUpload(input: TokenUsageUploadRequestInput): Promise<Response> {
  // endpoint 是 owner 配置且已有自托管 DNS/私网兼容契约；严格迁移到统一
  // OutboundRequestPolicy 需单独提供显式 trusted-private 配置迁移，不能在 P02 静默破坏上传。
  return fetch(input.url, {
    method: "POST",
    headers: input.headers,
    body: input.body,
    signal: input.signal,
  });
}

/**
 * 对 token usage 的 best-effort 出站建立有界单飞队列。Map key 仅保留摘要，
 * 真实 URL/token 只在有限 slot 的实际请求生命周期内保存，不能进入诊断面。
 */
export function createTokenUsageUploadScheduler(
  options: TokenUsageUploadSchedulerOptions = {},
): TokenUsageUploadScheduler {
  const batchWindowMs = normalizePositiveInt(options.batchWindowMs, TOKEN_USAGE_UPLOAD_BATCH_WINDOW_MS, MAX_TIMEOUT_MS);
  const maxConcurrentUploads = normalizePositiveInt(options.maxConcurrentUploads, DEFAULT_MAX_CONCURRENT_UPLOADS, MAX_TRACKED_KEYS);
  const maxConcurrentUploadsPerEndpoint = normalizePositiveInt(
    options.maxConcurrentUploadsPerEndpoint,
    DEFAULT_MAX_CONCURRENT_UPLOADS_PER_ENDPOINT,
    maxConcurrentUploads,
  );
  const maxTrackedKeys = normalizePositiveInt(options.maxTrackedKeys, DEFAULT_MAX_TRACKED_KEYS, MAX_TRACKED_KEYS);
  const overflowWarnIntervalMs = normalizePositiveInt(
    options.overflowWarnIntervalMs,
    DEFAULT_OVERFLOW_WARN_INTERVAL_MS,
    MAX_TIMEOUT_MS,
  );
  const now = options.now ?? Date.now;
  const request = options.request ?? requestTokenUsageUpload;
  const setTimeoutFn = options.setTimeoutFn ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearTimeoutFn = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle));
  const slots = new Map<string, UploadSlot>();
  const readyKeys = new Set<string>();
  const endpointActiveCounts = new Map<string, number>();
  const overflowByEndpoint = new Map<string, OverflowAggregate>();
  let activeCount = 0;

  function upload(input: TokenUsageUploadInput): Promise<void> {
    const normalized = normalizeUpload(input);
    if (!normalized) {
      return Promise.resolve();
    }

    let slot = slots.get(normalized.key);
    if (!slot) {
      if (slots.size >= maxTrackedKeys) {
        recordOverflow(normalized);
        return Promise.resolve();
      }
      slot = {
        key: normalized.key,
        endpointId: normalized.endpointId,
        config: normalized.config,
        userUuid: normalized.userUuid,
        conversationId: normalized.conversationId,
        source: normalized.source,
        log: normalized.log,
        pendingDeltaTokens: 0,
        inFlight: false,
      };
      slots.set(slot.key, slot);
    }

    slot.pendingDeltaTokens = Math.min(MAX_DELTA_TOKENS, slot.pendingDeltaTokens + normalized.deltaTokens);
    slot.pendingCompletion ??= createUploadCompletion();
    schedule(slot);
    return slot.pendingCompletion.promise;
  }

  function schedule(slot: UploadSlot): void {
    if (slot.timer || readyKeys.has(slot.key)) {
      return;
    }
    slot.timer = setTimeoutFn(() => {
      slot.timer = undefined;
      if (slots.get(slot.key) !== slot || slot.pendingDeltaTokens <= 0) {
        return;
      }
      readyKeys.add(slot.key);
      drain();
    }, batchWindowMs);
  }

  function drain(): void {
    while (activeCount < maxConcurrentUploads) {
      const slot = takeReadySlot();
      if (!slot) {
        return;
      }
      readyKeys.delete(slot.key);
      start(slot);
    }
  }

  function takeReadySlot(): UploadSlot | undefined {
    for (const key of readyKeys) {
      const slot = slots.get(key);
      if (!slot) {
        readyKeys.delete(key);
        continue;
      }
      if (slot.inFlight || slot.pendingDeltaTokens <= 0) {
        continue;
      }
      if ((endpointActiveCounts.get(slot.endpointId) ?? 0) >= maxConcurrentUploadsPerEndpoint) {
        continue;
      }
      return slot;
    }
    return undefined;
  }

  function start(slot: UploadSlot): void {
    const deltaTokens = slot.pendingDeltaTokens;
    slot.pendingDeltaTokens = 0;
    slot.inFlight = true;
    slot.activeCompletion = slot.pendingCompletion ?? createUploadCompletion();
    slot.pendingCompletion = undefined;
    activeCount += 1;
    endpointActiveCounts.set(slot.endpointId, (endpointActiveCounts.get(slot.endpointId) ?? 0) + 1);

    void execute(slot, deltaTokens).finally(() => {
      slot.inFlight = false;
      activeCount = Math.max(0, activeCount - 1);
      decrementEndpointActive(slot.endpointId);
      slot.activeCompletion?.resolve();
      slot.activeCompletion = undefined;

      if (slots.get(slot.key) === slot) {
        if (slot.pendingDeltaTokens > 0) {
          schedule(slot);
        } else {
          slots.delete(slot.key);
          readyKeys.delete(slot.key);
        }
      }
      drain();
    });
  }

  async function execute(slot: UploadSlot, deltaTokens: number): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (slot.config.token) {
      headers.Authorization = `Bearer ${slot.config.token}`;
    }
    const body: Record<string, unknown> = {
      deltaTokens,
      conversationId: slot.conversationId,
      source: slot.source,
    };
    if (slot.userUuid) {
      body.userUuid = slot.userUuid;
    }

    const controller = new AbortController();
    slot.controller = controller;
    let didTimeout = false;
    const timeout = setTimeoutFn(() => {
      didTimeout = true;
      controller.abort();
    }, slot.config.timeoutMs);
    try {
      const response = await request({
        url: slot.config.url,
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
        timeoutMs: slot.config.timeoutMs,
      });
      if (!response.ok) {
        const boundedBody = await readResponseTextBounded(response, { maxBytes: MAX_ERROR_BODY_BYTES });
        slot.log.warn("token-upload", "Token usage upload failed", {
          status: response.status,
          statusText: safeLogText(response.statusText, 160),
          body: boundedBody.text,
          bodyBytes: boundedBody.bytes,
          bodyTruncated: boundedBody.truncated,
        });
      } else {
        await discardResponseBody(response);
      }
    } catch (error) {
      if (didTimeout || controller.signal.aborted) {
        slot.log.warn("token-upload", "Token usage upload timeout", {
          timeoutMs: slot.config.timeoutMs,
        });
      } else {
        slot.log.warn("token-upload", "Token usage upload error", {
          error: safeLogText(String(error), 512),
        });
      }
    } finally {
      clearTimeoutFn(timeout);
      if (slot.controller === controller) {
        slot.controller = undefined;
      }
    }
  }

  function decrementEndpointActive(endpointId: string): void {
    const next = Math.max(0, (endpointActiveCounts.get(endpointId) ?? 0) - 1);
    if (next === 0) {
      endpointActiveCounts.delete(endpointId);
    } else {
      endpointActiveCounts.set(endpointId, next);
    }
  }

  function recordOverflow(input: NormalizedUpload): void {
    const overflowKey = overflowByEndpoint.has(input.endpointId) || overflowByEndpoint.size < MAX_OVERFLOW_ENDPOINTS
      ? input.endpointId
      : "other";
    const aggregate = overflowByEndpoint.get(overflowKey) ?? {
      droppedKeys: 0,
      droppedTokens: 0,
      lastWarnAt: 0,
    };
    aggregate.droppedKeys += 1;
    aggregate.droppedTokens = Math.min(MAX_DELTA_TOKENS, aggregate.droppedTokens + input.deltaTokens);
    overflowByEndpoint.set(overflowKey, aggregate);
    if (now() - aggregate.lastWarnAt < overflowWarnIntervalMs) {
      return;
    }
    aggregate.lastWarnAt = now();
    input.log.warn("token-upload", "Token usage upload queue is full; upload was aggregated and dropped", {
      endpointId: overflowKey,
      droppedKeys: aggregate.droppedKeys,
      droppedTokens: aggregate.droppedTokens,
      capacity: maxTrackedKeys,
    });
  }

  function getRuntimeSnapshot(): TokenUsageUploadRuntimeSnapshot {
    const queuedCount = [...slots.values()].filter((slot) => !slot.inFlight || slot.pendingDeltaTokens > 0).length;
    return {
      id: "token_usage_upload",
      activeCount,
      queuedCount,
      capacity: maxTrackedKeys,
    };
  }

  function reset(): void {
    for (const slot of slots.values()) {
      if (slot.timer) {
        clearTimeoutFn(slot.timer);
        slot.timer = undefined;
      }
      slot.controller?.abort();
      slot.pendingCompletion?.resolve();
      slot.activeCompletion?.resolve();
      slot.pendingCompletion = undefined;
      slot.activeCompletion = undefined;
    }
    slots.clear();
    readyKeys.clear();
    endpointActiveCounts.clear();
    overflowByEndpoint.clear();
    activeCount = 0;
  }

  return { upload, getRuntimeSnapshot, reset };
}

const defaultTokenUsageUploadScheduler = createTokenUsageUploadScheduler();

export function uploadTokenUsage(input: TokenUsageUploadInput): Promise<void> {
  return defaultTokenUsageUploadScheduler.upload(input);
}

export function getTokenUsageUploadRuntimeSnapshot(): TokenUsageUploadRuntimeSnapshot {
  return defaultTokenUsageUploadScheduler.getRuntimeSnapshot();
}

export function __resetTokenUsageUploadBatchingForTests(): void {
  defaultTokenUsageUploadScheduler.reset();
}

function normalizeUpload(input: TokenUsageUploadInput): NormalizedUpload | undefined {
  const { config, log } = input;
  const deltaTokens = Number(input.deltaTokens);
  if (!(Number.isSafeInteger(deltaTokens) && deltaTokens > 0 && deltaTokens <= MAX_DELTA_TOKENS)) {
    log.warn("token-upload", "Token usage upload delta is invalid or exceeds the limit");
    return undefined;
  }
  const url = typeof config.url === "string" ? config.url.trim() : "";
  if (!url) {
    log.warn("token-upload", "Token usage upload enabled but BELLDANDY_TOKEN_USAGE_UPLOAD_URL is not configured");
    return undefined;
  }
  if (url.length > MAX_URL_LENGTH || !isValidUrl(url)) {
    log.warn("token-upload", "Token usage upload URL is invalid or exceeds the limit");
    return undefined;
  }
  const token = typeof config.token === "string" ? config.token.trim() : undefined;
  if (token && token.length > MAX_TOKEN_LENGTH) {
    log.warn("token-upload", "Token usage upload credential exceeds the limit");
    return undefined;
  }
  const userUuid = normalizeOptionalIdentifier(input.userUuid);
  const conversationId = normalizeRequiredIdentifier(input.conversationId);
  const source = normalizeRequiredIdentifier(input.source);
  if (userUuid === null || !conversationId || !source) {
    log.warn("token-upload", "Token usage upload identity fields are invalid or exceed the limit");
    return undefined;
  }

  const endpointId = digest(`endpoint:${url}`);
  const credentialId = digest(`credential:${token ?? ""}`);
  return {
    key: digest([endpointId, credentialId, digest(userUuid ?? ""), digest(conversationId), digest(source)].join("\n")),
    endpointId,
    config: {
      url,
      ...(token ? { token } : {}),
      timeoutMs: normalizePositiveInt(config.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
    },
    ...(userUuid ? { userUuid } : {}),
    conversationId,
    deltaTokens,
    source,
    log,
  };
}

function normalizeOptionalIdentifier(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return normalizeRequiredIdentifier(value) || null;
}

function normalizeRequiredIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_IDENTIFIER_LENGTH) {
    return undefined;
  }
  return value;
}

function normalizePositiveInt(value: unknown, fallback: number, maximum: number): number {
  if (!Number.isFinite(value) || Number(value) <= 0) {
    return fallback;
  }
  return Math.min(maximum, Math.floor(Number(value)));
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function safeLogText(value: string, maxLength: number): string {
  const urlRedacted = value.replace(/\bhttps?:\/\/[^\s<>"']+/gi, (candidate) => redactSensitiveUrl(candidate));
  return redactSensitiveText(urlRedacted).slice(0, maxLength);
}

async function discardResponseBody(response: Pick<Response, "body">): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 成功响应没有正文或正文已被上游消费时无需影响 best-effort 上传。
  }
}

function createUploadCompletion(): UploadCompletion {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
