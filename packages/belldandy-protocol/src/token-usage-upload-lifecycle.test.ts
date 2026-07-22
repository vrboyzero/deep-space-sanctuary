import * as http from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it, vi } from "vitest";

import {
  createTokenUsageUploadScheduler,
  type TokenUsageUploadInput,
  type TokenUsageUploadRequest,
} from "./token-usage-upload.js";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createInput(deltaTokens: number, conversationId = "conversation-1"): TokenUsageUploadInput {
  return {
    config: {
      enabled: true,
      url: "https://token-upload.example.test/usage",
      token: "fixture-secret",
      timeoutMs: 60_000,
    },
    userUuid: "user-1",
    conversationId,
    deltaTokens,
    source: "webchat",
    log: { warn: vi.fn() },
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("token usage upload lifecycle", () => {
  it("fails closed for a private HTTP endpoint unless its dedicated trusted profile is explicit", async () => {
    let requests = 0;
    let receivedMethod = "";
    let receivedBody = "";
    const server = http.createServer((request, response) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        requests += 1;
        receivedMethod = request.method ?? "";
        receivedBody = Buffer.concat(chunks).toString("utf-8");
        response.writeHead(204);
        response.end();
      })();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    const log = { warn: vi.fn() };
    const endpoint = `http://127.0.0.1:${address.port}/api/internal/token-usage`;
    const defaultScheduler = createTokenUsageUploadScheduler({ batchWindowMs: 1 });
    const trustedScheduler = createTokenUsageUploadScheduler({ batchWindowMs: 1 });

    try {
      await defaultScheduler.upload({
        ...createInput(4),
        config: {
          enabled: true,
          url: endpoint,
          timeoutMs: 60_000,
        },
        log,
      });
      expect(requests).toBe(0);
      expect(log.warn).toHaveBeenCalledWith(
        "token-upload",
        "Token usage upload error",
        expect.objectContaining({ error: expect.stringContaining("private or reserved network targets are not allowed") }),
      );

      await trustedScheduler.upload({
        ...createInput(6, "conversation-2"),
        config: {
          enabled: true,
          url: endpoint,
          timeoutMs: 60_000,
          trustedPrivateEndpoint: true,
        },
      });
      expect(requests).toBe(1);
      expect(receivedMethod).toBe("POST");
      expect(JSON.parse(receivedBody)).toMatchObject({
        conversationId: "conversation-2",
        deltaTokens: 6,
      });
    } finally {
      defaultScheduler.reset();
      trustedScheduler.reset();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("flushes batching immediately and waits for in-flight plus later pending work", async () => {
    const requests: Array<ReturnType<typeof createDeferred<Response>>> = [];
    const request = vi.fn<TokenUsageUploadRequest>(() => {
      const deferred = createDeferred<Response>();
      requests.push(deferred);
      return deferred.promise;
    });
    const scheduler = createTokenUsageUploadScheduler({
      batchWindowMs: 60_000,
      request,
    });

    try {
      const firstUpload = scheduler.upload(createInput(3));
      const drain = scheduler.drain();
      await flushMicrotasks();

      expect(request).toHaveBeenCalledTimes(1);
      expect(scheduler.getRuntimeSnapshot()).toMatchObject({ activeCount: 1, queuedCount: 0 });

      const laterUpload = scheduler.upload(createInput(6));
      requests[0]?.resolve(new Response(null, { status: 204 }));
      await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
      requests[1]?.resolve(new Response(null, { status: 204 }));
      await Promise.all([firstUpload, laterUpload, drain]);
      expect(scheduler.getRuntimeSnapshot()).toMatchObject({ activeCount: 0, queuedCount: 0 });

      const reusableUpload = scheduler.upload(createInput(2, "conversation-2"));
      const reusableDrain = scheduler.drain();
      await flushMicrotasks();
      expect(request).toHaveBeenCalledTimes(3);
      requests[2]?.resolve(new Response(null, { status: 204 }));
      await Promise.all([reusableUpload, reusableDrain]);
    } finally {
      scheduler.reset();
    }
  });

  it("aborts owned requests and clears all watermarks when the drain signal expires", async () => {
    const log = { warn: vi.fn() };
    let requestSignal: AbortSignal | undefined;
    const request = vi.fn<TokenUsageUploadRequest>(({ signal }) => {
      requestSignal = signal;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    const scheduler = createTokenUsageUploadScheduler({
      batchWindowMs: 60_000,
      request,
    });
    const controller = new AbortController();
    const reason = new Error("shutdown deadline exceeded");

    try {
      const upload = scheduler.upload({ ...createInput(5), log });
      const drainResult = scheduler.drain(controller.signal).then(
        () => ({ outcome: "resolved" as const }),
        (error: unknown) => ({ outcome: "rejected" as const, error }),
      );
      await flushMicrotasks();
      expect(request).toHaveBeenCalledTimes(1);

      controller.abort(reason);

      await expect(drainResult).resolves.toEqual({ outcome: "rejected", error: reason });
      await expect(upload).resolves.toBeUndefined();
      expect(requestSignal?.aborted).toBe(true);
      expect(scheduler.getRuntimeSnapshot()).toEqual({
        id: "token_usage_upload",
        activeCount: 0,
        queuedCount: 0,
        capacity: 128,
      });
      expect(log.warn).not.toHaveBeenCalled();
    } finally {
      scheduler.reset();
    }
  });
});
