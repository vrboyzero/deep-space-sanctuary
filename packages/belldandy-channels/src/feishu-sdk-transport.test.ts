import * as lark from "@larksuiteoapi/node-sdk";
import { describe, expect, it, vi } from "vitest";

import { createFeishuHttpInstance } from "./feishu-http-transport.js";

function responseResult(url: string | URL, response: Response) {
  return {
    response,
    url: new URL(url.toString()),
    addresses: [{ address: "93.184.216.34", family: 4 as const }],
    redirectCount: 0,
  };
}

describe("Feishu SDK transport integration", () => {
  it("routes the real SDK token and reply requests through one pinned HTTP owner", async () => {
    const request = vi.fn(async (input: { url: string | URL }) => {
      const url = new URL(input.url.toString());
      if (url.pathname.endsWith("/tenant_access_token/internal")) {
        return responseResult(url, new Response(JSON.stringify({
          code: 0,
          tenant_access_token: "tenant-token-a",
          expire: 7200,
        }), { status: 200, headers: { "content-type": "application/json" } }));
      }
      return responseResult(url, new Response(JSON.stringify({
        code: 0,
        data: { message_id: "reply-a" },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    });
    const cache = {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
    };
    const client = new lark.Client({
      appId: "app-id",
      appSecret: "app-secret",
      cache: cache as unknown as lark.Cache,
      domain: "https://open.feishu.cn",
      httpInstance: createFeishuHttpInstance({
        baseUrl: "https://open.feishu.cn",
        outboundRequestPolicy: { request },
      }),
    });

    await expect(client.im.message.reply({
      path: { message_id: "message-a" },
      data: { msg_type: "text", content: JSON.stringify({ text: "hello" }) },
    })).resolves.toMatchObject({ code: 0, data: { message_id: "reply-a" } });

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      url: new URL("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"),
      maxRedirects: 0,
    }));
    expect(request.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      url: new URL("https://open.feishu.cn/open-apis/im/v1/messages/message-a/reply"),
      maxRedirects: 0,
      headers: expect.objectContaining({ authorization: "Bearer tenant-token-a" }),
    }));
  });

  it("preserves the real SDK message resource stream contract", async () => {
    const request = vi.fn(async (input: { url: string | URL }) => responseResult(
      input.url,
      new Response(Uint8Array.from([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-length": "4", "content-type": "audio/ogg" },
      }),
    ));
    const client = new lark.Client({
      appId: "app-id",
      appSecret: "app-secret",
      disableTokenCache: true,
      domain: "https://open.feishu.cn",
      httpInstance: createFeishuHttpInstance({
        baseUrl: "https://open.feishu.cn",
        outboundRequestPolicy: { request },
      }),
    });

    const resource = await client.im.messageResource.get({
      path: { message_id: "message-a", file_key: "file-a" },
      params: { type: "file" },
    });
    const chunks: Buffer[] = [];
    for await (const chunk of resource.getReadableStream()) {
      chunks.push(Buffer.from(chunk));
    }

    expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(resource.headers).toMatchObject({ "content-type": "audio/ogg" });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      url: new URL("https://open.feishu.cn/open-apis/im/v1/messages/message-a/resources/file-a?type=file"),
      method: "GET",
      maxRedirects: 0,
    }));
  });
});
