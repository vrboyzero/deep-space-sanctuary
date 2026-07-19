import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  OutboundRequestPolicy,
  OutboundRequestPolicyError,
} from "./outbound-request-policy.js";

describe("OutboundRequestPolicy", () => {
  it("rejects insecure schemes, credentials, and private literal addresses by default", async () => {
    const policy = new OutboundRequestPolicy({
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
    });

    await expect(policy.request({ url: "http://example.test" })).rejects.toMatchObject({
      code: "insecure_scheme",
    } satisfies Partial<OutboundRequestPolicyError>);
    await expect(policy.request({ url: "https://user:pass@example.test" })).rejects.toMatchObject({
      code: "userinfo_not_allowed",
    } satisfies Partial<OutboundRequestPolicyError>);
    await expect(policy.request({ url: "https://127.0.0.1/private" })).rejects.toMatchObject({
      code: "private_network_not_allowed",
    } satisfies Partial<OutboundRequestPolicyError>);
  });

  it("fails closed for DNS errors and mixed public/private DNS answers", async () => {
    const unavailable = new OutboundRequestPolicy({
      dnsLookup: async () => {
        throw new Error("resolver unavailable");
      },
    });
    const mixed = new OutboundRequestPolicy({
      dnsLookup: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "::ffff:127.0.0.1", family: 6 },
      ],
    });

    await expect(unavailable.request({ url: "https://example.test" })).rejects.toMatchObject({
      code: "dns_unavailable",
    } satisfies Partial<OutboundRequestPolicyError>);
    await expect(mixed.request({ url: "https://example.test" })).rejects.toMatchObject({
      code: "private_network_not_allowed",
    } satisfies Partial<OutboundRequestPolicyError>);
  });

  it.each([
    ["192.88.99.1", 4],
    ["198.18.0.1", 4],
    ["100::1", 6],
    ["2001:2::1", 6],
    ["2001:10::1", 6],
    ["2001:20::1", 6],
    ["3fff::1", 6],
    ["::ffff:127.0.0.1", 6],
  ] as const)("rejects special-use address %s outside the public unicast range", async (address, family) => {
    const policy = new OutboundRequestPolicy({
      dnsLookup: async () => [{ address, family }],
      requestAdapter: async () => new Response("unexpected transport", { status: 200 }),
    });

    await expect(policy.request({ url: "https://example.test" })).rejects.toMatchObject({
      code: "private_network_not_allowed",
    } satisfies Partial<OutboundRequestPolicyError>);
  });

  it.each([
    ["93.184.216.34", 4],
    ["198.51.99.1", 4],
    ["2606:4700:4700::1111", 6],
    ["::ffff:93.184.216.34", 6],
  ] as const)("allows public unicast address %s", async (address, family) => {
    const policy = new OutboundRequestPolicy({
      dnsLookup: async () => [{ address, family }],
      requestAdapter: async () => new Response("ok", { status: 200 }),
    });

    const result = await policy.request({ url: "https://example.test" });

    expect(await result.response.text()).toBe("ok");
    expect(result.addresses).toEqual([{ address, family }]);
  });

  it("pins the adapter input to checked addresses and rechecks redirect targets", async () => {
    const requests: Array<{ address: string; url: string }> = [];
    const policy = new OutboundRequestPolicy({
      dnsLookup: async (hostname) => hostname === "example.test"
        ? [{ address: "93.184.216.34", family: 4 }]
        : [{ address: "127.0.0.1", family: 4 }],
      requestAdapter: async (input) => {
        requests.push({ address: input.addresses[0]!.address, url: input.url.toString() });
        return new Response(null, {
          status: 302,
          headers: { location: "https://internal.test/redirected" },
        });
      },
    });

    await expect(policy.request({ url: "https://example.test/start" })).rejects.toMatchObject({
      code: "private_network_not_allowed",
    } satisfies Partial<OutboundRequestPolicyError>);
    expect(requests).toEqual([{ address: "93.184.216.34", url: "https://example.test/start" }]);
  });

  it("allows an explicit trusted-private profile without weakening the default profile", async () => {
    const requests: string[] = [];
    const policy = new OutboundRequestPolicy({
      allowInsecureHttp: true,
      allowPrivateNetwork: true,
      dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
      requestAdapter: async (input) => {
        requests.push(input.addresses[0]!.address);
        return new Response("ok", { status: 200 });
      },
    });

    const result = await policy.request({ url: "http://localhost:3000/health" });

    expect(await result.response.text()).toBe("ok");
    expect(requests).toEqual(["127.0.0.1"]);
  });

  it("streams a Readable request body through the pinned transport", async () => {
    let receivedBody = "";
    const server = http.createServer((request, response) => {
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        receivedBody += chunk;
      });
      request.on("end", () => {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("uploaded");
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address() as AddressInfo;
      const policy = new OutboundRequestPolicy({
        allowInsecureHttp: true,
        allowPrivateNetwork: true,
        dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
      });
      const result = await policy.request({
        url: `http://upload.test:${address.port}/files`,
        method: "POST",
        body: Readable.from(["streamed-", "body"]),
      });

      expect(await result.response.text()).toBe("uploaded");
      expect(receivedBody).toBe("streamed-body");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("does not replay a consumed Readable body across a 307 redirect", async () => {
    const requests: string[] = [];
    const policy = new OutboundRequestPolicy({
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      requestAdapter: async (input) => {
        requests.push(input.url.toString());
        for await (const _chunk of input.init.body as Readable) {
          // 消费首跳流，确保测试覆盖不可重放的真实请求体状态。
        }
        return new Response(null, {
          status: 307,
          headers: { location: "https://example.test/redirected" },
        });
      },
    });

    await expect(policy.request({
      url: "https://example.test/upload",
      method: "POST",
      body: Readable.from(["secret-body"]),
      maxRedirects: 1,
    })).rejects.toMatchObject({
      code: "redirect_limit",
    } satisfies Partial<OutboundRequestPolicyError>);
    expect(requests).toEqual(["https://example.test/upload"]);
  });
});
