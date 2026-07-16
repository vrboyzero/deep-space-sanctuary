import { describe, expect, it } from "vitest";
import { OutboundRequestPolicy } from "@belldandy/protocol";

import { validateBrowserUrl } from "./tools.js";

describe("browser URL policy", () => {
    it("rejects non-web schemes before a browser navigation is attempted", async () => {
        const result = await validateBrowserUrl("file:///etc/passwd", new OutboundRequestPolicy({
            dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        }));

        expect(result).toEqual({ ok: false, error: "浏览器仅支持 HTTP/HTTPS URL" });
    });

    it("rejects DNS results that resolve to a private network", async () => {
        const result = await validateBrowserUrl("https://example.test/path", new OutboundRequestPolicy({
            dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
        }));

        expect(result).toEqual({ ok: false, error: "浏览器禁止访问内网地址" });
    });

    it("allows a checked public HTTPS target", async () => {
        const result = await validateBrowserUrl("https://example.test/path", new OutboundRequestPolicy({
            dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        }));

        expect(result).toEqual({ ok: true });
    });
});
