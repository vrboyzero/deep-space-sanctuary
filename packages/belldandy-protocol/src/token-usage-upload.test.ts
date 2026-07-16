import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetTokenUsageUploadBatchingForTests,
  createTokenUsageUploadScheduler,
  uploadTokenUsage,
  type TokenUsageUploadConfig,
  type TokenUsageUploadLogger,
  type TokenUsageUploadRequest,
} from "./token-usage-upload.js";

const DEFAULT_CONFIG: TokenUsageUploadConfig = {
  enabled: true,
  url: "https://token-upload.example.test/usage",
  token: "token-upload-secret",
  timeoutMs: 60_000,
};

type TestLogger = TokenUsageUploadLogger & {
  warn: ReturnType<typeof vi.fn>;
};

function createLogger(): TestLogger {
  return { warn: vi.fn() } as TestLogger;
}

function createInput(input: {
  config?: Partial<TokenUsageUploadConfig>;
  userUuid?: string;
  conversationId?: string;
  deltaTokens?: number;
  source?: string;
  log?: TokenUsageUploadLogger;
} = {}) {
  return {
    config: { ...DEFAULT_CONFIG, ...input.config },
    userUuid: input.userUuid ?? "u-1",
    conversationId: input.conversationId ?? "conv-1",
    deltaTokens: input.deltaTokens ?? 3,
    source: input.source ?? "webchat",
    log: input.log ?? createLogger(),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("token usage upload", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    __resetTokenUsageUploadBatchingForTests();
  });

  it("batches adjacent uploads for the same conversation and source", async () => {
    const request = vi.fn<TokenUsageUploadRequest>().mockResolvedValue(new Response(null, { status: 204 }));
    const scheduler = createTokenUsageUploadScheduler({ batchWindowMs: 1, request });

    try {
      const first = scheduler.upload(createInput({ deltaTokens: 3 }));
      const second = scheduler.upload(createInput({ deltaTokens: 6 }));
      expect(second).toBe(first);
      await Promise.all([first, second]);

      expect(request).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(request.mock.calls[0]?.[0]?.body))).toMatchObject({
        userUuid: "u-1",
        conversationId: "conv-1",
        source: "webchat",
        deltaTokens: 9,
      });
    } finally {
      scheduler.reset();
    }
  });

  it("keeps one in-flight upload per key and flushes later deltas after it settles", async () => {
    vi.useFakeTimers();
    const requests: Array<ReturnType<typeof createDeferred<Response>>> = [];
    const request = vi.fn<TokenUsageUploadRequest>(() => {
      const deferred = createDeferred<Response>();
      requests.push(deferred);
      return deferred.promise;
    });
    const scheduler = createTokenUsageUploadScheduler({
      batchWindowMs: 1,
      maxTrackedKeys: 4,
      request,
    });

    try {
      const first = scheduler.upload(createInput({ deltaTokens: 3 }));
      await vi.advanceTimersByTimeAsync(1);
      expect(request).toHaveBeenCalledTimes(1);

      const second = scheduler.upload(createInput({ deltaTokens: 6 }));
      await vi.advanceTimersByTimeAsync(1);
      expect(request).toHaveBeenCalledTimes(1);
      expect(scheduler.getRuntimeSnapshot()).toEqual({
        id: "token_usage_upload",
        activeCount: 1,
        queuedCount: 1,
        capacity: 4,
      });

      requests[0]?.resolve(new Response(null, { status: 204 }));
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(0);
      expect(request).toHaveBeenCalledTimes(2);
      requests[1]?.resolve(new Response(null, { status: 204 }));

      await Promise.all([first, second]);
      expect(JSON.parse(String(request.mock.calls[1]?.[0]?.body))).toMatchObject({ deltaTokens: 6 });
    } finally {
      scheduler.reset();
    }
  });

  it("caps global and per-endpoint concurrency while allowing separate endpoints to progress", async () => {
    vi.useFakeTimers();
    const requests: Array<ReturnType<typeof createDeferred<Response>>> = [];
    const request = vi.fn<TokenUsageUploadRequest>(() => {
      const deferred = createDeferred<Response>();
      requests.push(deferred);
      return deferred.promise;
    });
    const scheduler = createTokenUsageUploadScheduler({
      batchWindowMs: 1,
      maxConcurrentUploads: 2,
      maxConcurrentUploadsPerEndpoint: 1,
      maxTrackedKeys: 4,
      request,
    });

    try {
      const firstEndpointFirst = scheduler.upload(createInput({ conversationId: "conv-a" }));
      const firstEndpointSecond = scheduler.upload(createInput({ conversationId: "conv-b" }));
      const secondEndpoint = scheduler.upload(createInput({
        config: { url: "https://second-upload.example.test/usage" },
        conversationId: "conv-c",
      }));
      await vi.advanceTimersByTimeAsync(1);

      expect(request).toHaveBeenCalledTimes(2);
      expect(scheduler.getRuntimeSnapshot()).toEqual({
        id: "token_usage_upload",
        activeCount: 2,
        queuedCount: 1,
        capacity: 4,
      });

      requests[1]?.resolve(new Response(null, { status: 204 }));
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(0);
      expect(request).toHaveBeenCalledTimes(2);

      requests[0]?.resolve(new Response(null, { status: 204 }));
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(0);
      expect(request).toHaveBeenCalledTimes(3);
      requests[2]?.resolve(new Response(null, { status: 204 }));

      await Promise.all([firstEndpointFirst, firstEndpointSecond, secondEndpoint]);
    } finally {
      scheduler.reset();
    }
  });

  it("bounds tracked keys and aggregates overflow diagnostics without retaining endpoint credentials", async () => {
    const log = createLogger();
    const scheduler = createTokenUsageUploadScheduler({
      batchWindowMs: 60_000,
      maxTrackedKeys: 2,
      request: vi.fn<TokenUsageUploadRequest>().mockResolvedValue(new Response(null, { status: 204 })),
    });

    try {
      const first = scheduler.upload(createInput({ conversationId: "conv-1", log }));
      const second = scheduler.upload(createInput({ conversationId: "conv-2", log }));
      await expect(scheduler.upload(createInput({ conversationId: "conv-3", deltaTokens: 7, log }))).resolves.toBeUndefined();

      expect(scheduler.getRuntimeSnapshot()).toEqual({
        id: "token_usage_upload",
        activeCount: 0,
        queuedCount: 2,
        capacity: 2,
      });
      expect(log.warn).toHaveBeenCalledWith(
        "token-upload",
        "Token usage upload queue is full; upload was aggregated and dropped",
        expect.objectContaining({ droppedKeys: 1, droppedTokens: 7 }),
      );
      expect(JSON.stringify(log.warn.mock.calls)).not.toContain("token-upload-secret");
      expect(JSON.stringify(log.warn.mock.calls)).not.toContain("token-upload.example.test");

      scheduler.reset();
      await Promise.all([first, second]);
    } finally {
      scheduler.reset();
    }
  });

  it("aborts timed-out work and bounds/redacts failed response bodies", async () => {
    vi.useFakeTimers();
    const timeoutLog = createLogger();
    const timeoutScheduler = createTokenUsageUploadScheduler({
      batchWindowMs: 1,
      request: ({ signal }) => new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(Object.assign(new Error("request aborted"), { name: "AbortError" })), { once: true });
      }),
    });

    try {
      const timedOut = timeoutScheduler.upload(createInput({ config: { timeoutMs: 10 }, log: timeoutLog }));
      await vi.advanceTimersByTimeAsync(11);
      await timedOut;
      expect(timeoutLog.warn).toHaveBeenCalledWith(
        "token-upload",
        "Token usage upload timeout",
        expect.objectContaining({ timeoutMs: 10 }),
      );
      expect(timeoutScheduler.getRuntimeSnapshot().activeCount).toBe(0);
    } finally {
      timeoutScheduler.reset();
    }

    const errorLog = createLogger();
    const errorScheduler = createTokenUsageUploadScheduler({
      batchWindowMs: 1,
      request: vi.fn<TokenUsageUploadRequest>().mockResolvedValue(new Response(
        `Authorization: Bearer response-secret\n${"x".repeat(8_192)}`,
        { status: 502, statusText: "Bad Gateway" },
      )),
    });
    try {
      const failedUpload = errorScheduler.upload(createInput({ log: errorLog }));
      await vi.advanceTimersByTimeAsync(1);
      await failedUpload;
      const failureData = errorLog.warn.mock.calls[0]?.[2] as Record<string, unknown>;
      expect(failureData).toMatchObject({ status: 502, bodyBytes: 2048, bodyTruncated: true });
      expect(JSON.stringify(failureData)).not.toContain("response-secret");
      expect(JSON.stringify(failureData)).not.toContain("token-upload-secret");
    } finally {
      errorScheduler.reset();
    }
  });

  it("keeps the default uploader best-effort when its URL is missing", async () => {
    const log = createLogger();

    await expect(uploadTokenUsage(createInput({ config: { url: undefined }, log }))).resolves.toBeUndefined();

    expect(log.warn).toHaveBeenCalledWith(
      "token-upload",
      "Token usage upload enabled but BELLDANDY_TOKEN_USAGE_UPLOAD_URL is not configured",
    );
  });

  it("redacts configured endpoint credentials from transport errors", async () => {
    vi.useFakeTimers();
    const log = createLogger();
    const scheduler = createTokenUsageUploadScheduler({
      batchWindowMs: 1,
      request: vi.fn<TokenUsageUploadRequest>().mockRejectedValue(new Error(
        "fetch failed for https://owner:password@token-upload.example.test/usage?token=endpoint-secret",
      )),
    });

    try {
      const upload = scheduler.upload(createInput({
        config: { url: "https://owner:password@token-upload.example.test/usage?token=endpoint-secret" },
        log,
      }));
      await vi.advanceTimersByTimeAsync(1);
      await upload;

      const errorData = log.warn.mock.calls[0]?.[2] as Record<string, unknown>;
      expect(JSON.stringify(errorData)).not.toContain("password");
      expect(JSON.stringify(errorData)).not.toContain("endpoint-secret");
    } finally {
      scheduler.reset();
    }
  });

  it("drops fractional token deltas before they can retain an idle queue slot", async () => {
    const log = createLogger();
    const scheduler = createTokenUsageUploadScheduler({ request: vi.fn<TokenUsageUploadRequest>() });

    try {
      await expect(scheduler.upload(createInput({ deltaTokens: 1.5, log }))).resolves.toBeUndefined();
      expect(scheduler.getRuntimeSnapshot()).toEqual({
        id: "token_usage_upload",
        activeCount: 0,
        queuedCount: 0,
        capacity: 128,
      });
      expect(log.warn).toHaveBeenCalledWith("token-upload", "Token usage upload delta is invalid or exceeds the limit");
    } finally {
      scheduler.reset();
    }
  });
});
