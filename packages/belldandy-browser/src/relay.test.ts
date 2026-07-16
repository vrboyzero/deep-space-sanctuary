import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { RelayServer } from "./relay.js";

describe("RelayServer", () => {
    const relays: RelayServer[] = [];
    const relayToken = "a".repeat(43);

    afterEach(async () => {
        await Promise.all(relays.splice(0).map((relay) => relay.stop()));
    });

    it("serializes debugged JSON responses only once per send", () => {
        const logger = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        const relay = new RelayServer(28892, { token: relayToken }, logger);
        const socket = {
            send: vi.fn(),
        };
        const stringifySpy = vi.spyOn(JSON, "stringify");

        try {
            (relay as any).sendJson(socket, { ok: true, value: 1 }, "Sending test payload");

            expect(stringifySpy).toHaveBeenCalledTimes(1);
            expect(socket.send).toHaveBeenCalledWith('{"ok":true,"value":1}');
            expect(logger.debug).toHaveBeenCalledWith("Sending test payload (bytes=21)");
        } finally {
            stringifySpy.mockRestore();
        }
    });

    it("requires a credential, preserves the first extension owner, and avoids disclosing it from unauthenticated discovery", async () => {
        const relay = new RelayServer(0, { token: relayToken, maxCdpClients: 1 });
        relays.push(relay);
        await relay.start();
        const baseUrl = `ws://127.0.0.1:${relay.port}`;

        const rejected = new WebSocket(`${baseUrl}/extension`, { origin: "chrome-extension://test-extension" });
        const rejectedClose = await new Promise<number>((resolve) => rejected.once("close", (code) => resolve(code)));
        expect(rejectedClose).toBe(4401);

        const extensionProtocol = `belldandy-relay-v1.${relayToken}`;
        const owner = new WebSocket(`${baseUrl}/extension`, extensionProtocol, { origin: "chrome-extension://test-extension" });
        await new Promise<void>((resolve, reject) => {
            owner.once("open", resolve);
            owner.once("error", reject);
        });

        const takeover = new WebSocket(`${baseUrl}/extension`, extensionProtocol, { origin: "chrome-extension://test-extension" });
        const takeoverClose = await new Promise<number>((resolve) => takeover.once("close", (code) => resolve(code)));
        expect(takeoverClose).toBe(4409);
        expect(owner.readyState).toBe(WebSocket.OPEN);

        const unauthenticatedVersion = await fetch(`http://127.0.0.1:${relay.port}/json/version`).then((response) => response.json()) as Record<string, unknown>;
        expect(unauthenticatedVersion.webSocketDebuggerUrl).toBeUndefined();
        const authenticatedVersion = await fetch(`http://127.0.0.1:${relay.port}/json/version`, {
            headers: { Authorization: `Bearer ${relayToken}` },
        }).then((response) => response.json()) as Record<string, unknown>;
        expect(authenticatedVersion.webSocketDebuggerUrl).toBe(`${baseUrl}/cdp`);

        const rejectedCdp = new WebSocket(`${baseUrl}/cdp`);
        expect(await new Promise<number>((resolve) => rejectedCdp.once("close", (code) => resolve(code)))).toBe(4401);
        const cdp = new WebSocket(`${baseUrl}/cdp`, { headers: { Authorization: `Bearer ${relayToken}` } });
        await new Promise<void>((resolve, reject) => {
            cdp.once("open", resolve);
            cdp.once("error", reject);
        });

        owner.close();
        cdp.close();
    });
});
