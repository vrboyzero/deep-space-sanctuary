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
});
