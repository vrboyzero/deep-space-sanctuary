import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  FEISHU_HTTP_IDLE_TIMEOUT_MS,
  FEISHU_JSON_MAX_RESPONSE_BYTES,
  FEISHU_RESOURCE_MAX_RESPONSE_BYTES,
  createFeishuHttpInstance,
} from "./feishu-http-transport.js";

function createPolicy(responseFactory: () => Response) {
  const request = vi.fn(async (input: { url: string | URL }) => ({
    response: responseFactory(),
    url: new URL(input.url.toString()),
    addresses: [{ address: "93.184.216.34", family: 4 as const }],
    redirectCount: 0,
  }));
  return { request };
}

describe("FeishuHttpInstance", () => {
  it("serializes JSON and query params through the configured-host zero-redirect policy", async () => {
    const policy = createPolicy(() => new Response(JSON.stringify({ code: 0, data: { ok: true } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const httpInstance = createFeishuHttpInstance({
      baseUrl: "https://open.feishu.cn",
      outboundRequestPolicy: policy,
      idleTimeoutMs: 1_234,
    });

    await expect(httpInstance.post(
      "https://open.feishu.cn/open-apis/im/v1/messages",
      { receive_id: "chat-a" },
      { params: { receive_id_type: "chat_id" }, headers: { authorization: "Bearer token-a" } },
    )).resolves.toEqual({ code: 0, data: { ok: true } });

    expect(policy.request).toHaveBeenCalledWith(expect.objectContaining({
      url: new URL("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id"),
      method: "POST",
      maxRedirects: 0,
      idleTimeoutMs: 1_234,
      headers: expect.objectContaining({
        authorization: "Bearer token-a",
        "content-type": "application/json",
      }),
      body: JSON.stringify({ receive_id: "chat-a" }),
    }));
  });

  it("rejects an oversized JSON response before parsing and cancels its body", async () => {
    const cancel = vi.fn(async () => undefined);
    const policy = createPolicy(() => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-length": String(FEISHU_JSON_MAX_RESPONSE_BYTES + 1) }),
      body: { cancel },
    } as unknown as Response));
    const httpInstance = createFeishuHttpInstance({
      baseUrl: "https://open.feishu.cn",
      outboundRequestPolicy: policy,
    });

    await expect(httpInstance.get("https://open.feishu.cn/open-apis/test"))
      .rejects.toThrow(`Feishu JSON response exceeds ${FEISHU_JSON_MAX_RESPONSE_BYTES} byte limit`);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("keeps resource responses streaming and stops chunked bodies at the byte limit", async () => {
    const cancel = vi.fn();
    const resourceMaxResponseBytes = 8;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(resourceMaxResponseBytes));
        controller.enqueue(Uint8Array.of(1));
      },
      cancel,
    });
    const policy = createPolicy(() => new Response(source, { status: 200 }));
    const httpInstance = createFeishuHttpInstance({
      baseUrl: "https://open.feishu.cn",
      outboundRequestPolicy: policy,
      resourceMaxResponseBytes,
    });

    const response = await httpInstance.request<{ data: Readable }>({
      url: "https://open.feishu.cn/open-apis/im/v1/messages/msg-a/resources/file-a",
      method: "GET",
      responseType: "stream",
      $return_headers: true,
    });

    expect(response.data).toBeInstanceOf(Readable);
    await expect(async () => {
      for await (const _chunk of response.data) {
        // Consume until the bounded stream rejects.
      }
    }).rejects.toThrow(`Feishu resource response exceeds ${resourceMaxResponseBytes} byte limit`);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("forwards caller abort to the policy and cancels a pending JSON response", async () => {
    const cancel = vi.fn();
    let markResponseReady!: () => void;
    const responseReady = new Promise<void>((resolve) => {
      markResponseReady = resolve;
    });
    const source = new ReadableStream<Uint8Array>({
      pull() {
        markResponseReady();
        return new Promise<void>(() => {});
      },
      cancel,
    });
    const policy = createPolicy(() => new Response(source, { status: 200 }));
    const httpInstance = createFeishuHttpInstance({
      baseUrl: "https://open.feishu.cn",
      outboundRequestPolicy: policy,
    });
    const controller = new AbortController();

    const pending = httpInstance.request({
      url: "https://open.feishu.cn/open-apis/test",
      method: "GET",
      signal: controller.signal,
    } as any);
    await responseReady;
    controller.abort(new Error("caller stopped"));

    await expect(pending).rejects.toThrow("caller stopped");
    expect(policy.request).toHaveBeenCalledWith(expect.objectContaining({
      signal: controller.signal,
      maxRedirects: 0,
    }));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("falls back to safe defaults when configured limits are invalid", async () => {
    const cancel = vi.fn(async () => undefined);
    const policy = createPolicy(() => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-length": String(FEISHU_RESOURCE_MAX_RESPONSE_BYTES + 1) }),
      body: { cancel },
    } as unknown as Response));
    const httpInstance = createFeishuHttpInstance({
      baseUrl: "https://open.feishu.cn",
      outboundRequestPolicy: policy,
      jsonMaxResponseBytes: -1,
      resourceMaxResponseBytes: Number.NaN,
      idleTimeoutMs: 0,
    });

    await expect(httpInstance.request({
      url: "https://open.feishu.cn/open-apis/im/v1/messages/msg-a/resources/file-a",
      method: "GET",
      responseType: "stream",
    })).rejects.toThrow(
      `Feishu resource response exceeds ${FEISHU_RESOURCE_MAX_RESPONSE_BYTES} byte limit`,
    );
    expect(policy.request).toHaveBeenCalledWith(expect.objectContaining({
      idleTimeoutMs: FEISHU_HTTP_IDLE_TIMEOUT_MS,
    }));
    expect(cancel).toHaveBeenCalledOnce();
  });
});
