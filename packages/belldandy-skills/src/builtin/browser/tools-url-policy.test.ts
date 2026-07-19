import { describe, expect, it } from "vitest";
import { OutboundRequestPolicy } from "@belldandy/protocol";

import {
    createBrowserOutboundRequestPolicy,
    resolveBrowserOutboundProfile,
    validateBrowserUrl,
} from "./tools.js";

describe("browser URL policy", () => {
    it("keeps the default public-web profile when only the legacy private boolean is set", async () => {
        const previousLegacyValue = process.env.BELLDANDY_BROWSER_ALLOW_PRIVATE_NETWORK;
        const previousProfile = process.env.BELLDANDY_BROWSER_OUTBOUND_PROFILE;
        try {
            process.env.BELLDANDY_BROWSER_ALLOW_PRIVATE_NETWORK = "true";
            delete process.env.BELLDANDY_BROWSER_OUTBOUND_PROFILE;

            expect(resolveBrowserOutboundProfile()).toBe("public-web");
            expect(resolveBrowserOutboundProfile("privileged-browser-typo")).toBe("public-web");
            const result = await validateBrowserUrl(
                "https://internal.example.test/path",
                createBrowserOutboundRequestPolicy(undefined, {
                    dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
                }),
            );

            expect(result).toEqual({ ok: false, error: "浏览器禁止访问内网地址" });
        } finally {
            if (previousLegacyValue === undefined) {
                delete process.env.BELLDANDY_BROWSER_ALLOW_PRIVATE_NETWORK;
            } else {
                process.env.BELLDANDY_BROWSER_ALLOW_PRIVATE_NETWORK = previousLegacyValue;
            }
            if (previousProfile === undefined) {
                delete process.env.BELLDANDY_BROWSER_OUTBOUND_PROFILE;
            } else {
                process.env.BELLDANDY_BROWSER_OUTBOUND_PROFILE = previousProfile;
            }
        }
    });

    it("allows private DNS only through the explicit privileged-local-browser profile", async () => {
        const previousProfile = process.env.BELLDANDY_BROWSER_OUTBOUND_PROFILE;
        try {
            process.env.BELLDANDY_BROWSER_OUTBOUND_PROFILE = "privileged-local-browser";
            const profile = resolveBrowserOutboundProfile();

            const result = await validateBrowserUrl(
                "https://internal.example.test/path",
                createBrowserOutboundRequestPolicy(profile, {
                    dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
                }),
            );

            expect(profile).toBe("privileged-local-browser");
            expect(result).toEqual({ ok: true });
        } finally {
            if (previousProfile === undefined) {
                delete process.env.BELLDANDY_BROWSER_OUTBOUND_PROFILE;
            } else {
                process.env.BELLDANDY_BROWSER_OUTBOUND_PROFILE = previousProfile;
            }
        }
    });

    it("keeps host allow and deny rules active in the privileged profile", async () => {
        const policy = createBrowserOutboundRequestPolicy("privileged-local-browser", {
            allowedHosts: ["internal.example.test"],
            deniedHosts: ["blocked.internal.example.test"],
            dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
        });

        const allowed = await validateBrowserUrl("https://internal.example.test/path", policy);
        const denied = await validateBrowserUrl("https://blocked.internal.example.test/path", policy);

        expect(allowed).toEqual({ ok: true });
        expect(denied).toEqual({ ok: false, error: "浏览器域名被禁止" });
    });

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
